Title: Add Architecture Diagram Generation Task Framework (ER First)

Objective:
Introduce a new Architect persona task that generates a TemporaryArchitectureDiagram (as defined in Increment 1) from an already saved architecture meta-model, using a structured 4-question flow, and saves the result via an MCP tool call.

This is the first implementation of a generic "architecture → diagram view" capability, with ER diagrams as the initial supported diagram_kind.

This increment focuses ONLY on:
- task definition
- prompt/system behavior
- input context injection
- enforcing the TemporaryArchitectureDiagram output contract
- invoking MCP to save the temporary diagram

It does NOT implement:
- MCP persistence logic
- rendering
- mapping
- modal UX
- final diagram conversion

---

Scope:

1. Add a new Architect persona task for diagram generation:
   Suggested name: "generate-architecture-diagram"

2. This task must:
   - Ask exactly 4 questions (if not already answered)
   - Use injected architecture context + explainer
   - Produce a TemporaryArchitectureDiagram payload
   - Call MCP tool to save it
   - Stop

3. The task must use the TemporaryArchitectureDiagram contract defined in Increment 1.

---

Task Inputs (Context Injection):

At task start, inject:

1. Architecture Explainer (full MD)
   - Defines architecture meta-model concepts
   - Explicitly includes rules:
     - physical_data_entities / logical_data_entities are the real entities
     - *_points wrapper entities are backend-managed and MUST NOT be created by the LLM
     - relationship types available in the model

2. Current Architecture Data Slice
   - logical_data_entities (if present)
   - logical_data_attributes
   - physical_data_entities
   - physical_data_attributes
   - relevant relationship data
   - sufficient fields to identify: names, PK/FK flags, data types (optional)

3. TemporaryArchitectureDiagram Contract Definition
   - Either inline or summarized
   - MUST include: required fields, naming rules, ER-specific constraints, "no IDs" rule

---

Conversation Flow:

The Architect MUST follow this exact sequence:

Step 1: Ask Questions (if not already answered)
Ask exactly these four questions:
1. "Should this be a logical or physical ER diagram?"
2. "Which entities should be included: all entities or a specific subset?"
3. "Which attributes should be shown: all, none, or key attributes (primary and foreign keys)?"
4. "Should relationship cardinalities be shown?"

Rules:
- Do not proceed until all 4 are answered
- Do not ask additional questions in this increment

Step 2: Confirm Understanding (light confirmation)
The Architect should briefly restate: diagram_kind = ER, view_mode, entity selection, attribute selection mode, cardinality preference.
Do NOT re-derive architecture — only confirm configuration.

Step 3: Generate TemporaryArchitectureDiagram
Build a TemporaryArchitectureDiagram object with all required fields, nodes, compartments, edges, layout positions.

Step 4: MCP Tool Call
Call the MCP tool to save the temporary diagram. Pass the TemporaryArchitectureDiagram payload as the request body.

Step 5: Termination
After the MCP call, the Architect must STOP. No further explanation or UI instructions.

---

Strict Behavioral Rules:
- Use ONLY provided architecture data (no hallucinated entities or attributes)
- Use EXACT entity and attribute names
- NEVER abbreviate or rename
- NEVER create data_entity_points, application_points, or any *_points wrapper entities
- NEVER create/update/delete architecture entities in this task
- NEVER output native diagram JSON
- ONLY output TemporaryArchitectureDiagram via MCP call

---

Error Handling:
- If required architecture data is missing: respond with a clarification request
- If entity subset is specified but invalid: ask for clarification before proceeding

---

Deliverables:
1. New task definition in persona/task registry
2. System prompt content (role definition, rules, 4-question flow, contract summary)
3. Wiring to inject architecture explainer, data slice, contract definition
4. Tool call integration (placeholder MCP call)

---

Acceptance Criteria:
- Task asks exactly the 4 defined questions
- Task does not proceed until answers are provided
- Output strictly conforms to TemporaryArchitectureDiagram structure
- No architecture IDs appear anywhere in output
- Entity and attribute names match exactly with input context
- Diagram includes nodes, compartments, and edges with geometry
- MCP tool is invoked with the generated payload
- Task terminates immediately after tool call

---

Out of Scope:
- MCP endpoint implementation
- Diagram rendering
- Auto-mapping
- Matching modal
- Final diagram persistence
- Support for non-ER diagram kinds
