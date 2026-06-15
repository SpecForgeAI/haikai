# Spec Requirements: Architecture Diagram Generation Task Framework

## Initial Description
Introduce a new Architect persona task that generates a TemporaryArchitectureDiagram (as defined in Increment 1) from an already saved architecture meta-model, using a structured 4-question flow, and saves the result via an MCP tool call.

This is the first implementation of a generic "architecture -> diagram view" capability, with ER diagrams as the initial supported diagram_kind.

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

## Requirements Discussion

### First Round Questions

**Q1:** Task mode: "workflow" vs a new mode? The raw idea describes a strict 4-question-then-generate-then-MCP-call-then-stop flow. Two existing tasks use `mode: "workflow"` (architect--oas-spec and product-manager--implement-support), while most structured Q&A tasks use `mode: "discovery"` with `responseFormat` for structured JSON output. Since this task has a rigid multi-step structure but does NOT need JSON-formatted responses during the Q&A phase, should it use `mode: "workflow"` with the sequence enforced via prompt instructions (not via responseFormat schema), or `mode: "discovery"` with a structured responseFormat?
**Answer:** Use `mode: "workflow"` and enforce the full 4-question -> generate -> save -> stop sequence in the prompt and task orchestration, not via responseFormat.

**Q2:** MCP tool invocation pattern: LLM-initiated vs server-side post-processing? Two patterns exist in the codebase: (A) v1 OAS agent loop in chat.ts where the LLM is given tool definitions and autonomously issues tool_use calls, and (B) v2 save-artifact in chatV2.ts where server-side code explicitly calls executeToolCall after extracting content from the LLM's response. The chatV2 main conversation path does NOT pass tools to the LLM. Which pattern should be used?
**Answer:** Use Pattern B (server-side extraction/execution): the LLM should produce the TemporaryArchitectureDiagram payload in its response, and server-side code should extract it and call the save tool/MCP endpoint explicitly; do not rely on direct LLM tool_use for this task.

**Q3:** New MCP tool needed: `save_temporary_diagram`? The existing TOOL_DEFINITIONS and ALLOWED_TOOL_NAMES in tools.ts do not include a temporary diagram save tool. Should this spec define the new tool's name, parameters, and tool definition (to be added to tools.ts), define the new MCP endpoint mapping (to be added to toolExecutor.ts), and wire the chatV2 route to invoke it -- but NOT implement the actual MCP endpoint on the architecture-model-service side?
**Answer:** Yes -- define the save tool contract now (name, parameters, executor wiring shape), but do not implement the downstream architecture-model-service endpoint in this increment; use a clear name aligned with Increment 3, preferably `saveTemporaryArchitectureDiagram`.

**Q4:** Architecture context: full model data vs filtered data slice? The existing `buildArchitectureContextSection()` fetches the FULL architecture model (minus diagrams) and injects ALL of it. For ER diagram generation, the full model includes a lot of irrelevant data (applications, services, interfaces, business processes, UI screens, etc.) that wastes tokens and could confuse the LLM. Should we create a filtered context builder or reuse the existing one with prompt instructions?
**Answer:** Create a filtered context builder for this task (e.g. `buildDataModelContextSection()`) and inject only the relevant data-architecture slice rather than the full architecture model.

**Q5:** TemporaryArchitectureDiagram contract: inline in prompt vs referenced from file? The contract is currently defined as TypeScript interfaces in `frontend/src/types/temporaryArchitectureDiagram.ts` (723 lines with extensive JSDoc). Should we create a condensed markdown summary of the contract or dump the entire TypeScript file into the prompt?
**Answer:** Use a condensed markdown contract summary in prompt assets rather than inlining the full TypeScript file; keep it human-readable and aligned to the canonical TypeScript contract from Increment 1.

**Q6:** Thread persistence: "panel" scope? Since this diagram generation task is a one-shot workflow, should it use `persistence: "panel"` and should `availableFrom` be `["panel"]` only, or also `["hub"]`?
**Answer:** Use `persistence: "panel"` and `availableFrom: ["panel"]` only for this first implementation.

**Q7:** The "stop after MCP call" behavior -- how is termination enforced? In chatV2, there is no built-in "task complete" mechanism. Should termination be enforced purely by prompt instructions, or via a server-side mechanism?
**Answer:** Enforce termination primarily server-side: once the payload is extracted and the save call is executed, treat the task turn as complete and do not continue the workflow with additional LLM-generated follow-up in that turn; the prompt should also instruct the model to stop after generation.

**Q8:** Is there anything this task should explicitly NOT do that is not already covered in the "Out of Scope" section?
**Answer:** Yes -- explicitly prohibit modifying the architecture model, explicitly limit this increment to ER diagrams only, and require the task to decline generation when there are no relevant logical/physical data entities available in the injected context.

### Existing Code to Reference

**Similar Features Identified:**
- Feature: Architecture Context Builder - Path: `gateway/src/services/architectureContextBuilder.ts` -- context injection patterns (fetchFullArchitectureContext, loadArchitectureExplainer, buildArchitectureContextSection)
- Feature: OAS Spec Task (closest workflow-mode task) - Path: `gateway/src/config/tasks/architect--oas-spec.json` + `gateway/src/config/prompts/architect.oas-spec.task.md`
- Feature: Detailed Data Model Task (task using full architecture context) - Path: `gateway/src/config/tasks/architect--detailed-data-model.json` + `gateway/src/config/prompts/architect.detailed-data-model.task.md`
- Feature: Architecture Meta-Model Explainer - Path: `gateway/src/config/prompts/shared/architecture-context-explainer.md`
- Feature: TemporaryArchitectureDiagram Contract (Increment 1) - Path: `frontend/src/types/temporaryArchitectureDiagram.ts` + `frontend/src/types/temporaryArchitectureDiagramValidation.ts`
- Feature: chatV2 Context Assembly Blocks - Path: `gateway/src/routes/chatV2.ts` (lines ~2930-3005) -- inline context assembly for detailed-data-model and other tasks
- Feature: Prompt Composition Pipeline - Path: `gateway/src/services/promptComposer.ts` -- composeSystemPrompt() assembles identity + task + context + responseFormat
- Feature: Context Resolver Registry - Path: `gateway/src/services/contextResolvers.ts` -- resolver interface, KNOWN_CONTEXT_KEYS, registry initialization
- Feature: Tool Definitions and Executor - Path: `gateway/src/types/tools.ts` (TOOL_DEFINITIONS, ALLOWED_TOOL_NAMES, ToolName union) + `gateway/src/services/toolExecutor.ts` (TOOL_ENDPOINTS, executeToolCall)
- Feature: Architect Persona Definition - Path: `gateway/src/config/personas/architect.json` -- tasks array to be extended
- Feature: Architect Identity Prompt - Path: `gateway/src/config/prompts/architect.identity.md`
- Feature: Registry Loader - Path: `gateway/src/services/registryLoader.ts` -- loads persona and task JSON at startup
- Feature: Save-Artifact Endpoint (Pattern B reference) - Path: `gateway/src/routes/chatV2.ts` (lines ~1935-2260) -- server-side tool execution after LLM content extraction

### Follow-up Questions

No follow-up questions were needed. All 8 questions received clear, actionable answers.

## Visual Assets

### Files Provided:
No visual assets provided. Mandatory bash check of the visuals folder confirmed no image files present.

### Visual Insights:
N/A -- no visual assets to analyze.

## Requirements Summary

### Functional Requirements
- New Architect persona task `architect--generate-architecture-diagram` registered in the task registry
- Task added to the architect persona's tasks array in `architect.json`
- Task uses `mode: "workflow"`, `responseFormat: null`, `persistence: "panel"`, `availableFrom: ["panel"]`
- Task prompt enforces a strict 4-question conversational flow:
  1. "Should this be a logical or physical ER diagram?"
  2. "Which entities should be included: all entities or a specific subset?"
  3. "Which attributes should be shown: all, none, or key attributes (primary and foreign keys)?"
  4. "Should relationship cardinalities be shown?"
- Task does not proceed until all 4 questions are answered
- After answers, the LLM briefly confirms configuration (diagram_kind=ER, view_mode, entity selection, attribute mode, cardinality preference)
- The LLM generates a TemporaryArchitectureDiagram JSON payload conforming to the Increment 1 contract
- Server-side code extracts the diagram payload from the LLM response
- Server-side code invokes the `saveTemporaryArchitectureDiagram` MCP tool with the extracted payload
- Server-side termination: after payload extraction and save call, the task turn is treated as complete with no further LLM follow-up
- Prompt also instructs the LLM to stop after generation

### Context Injection Requirements
- New filtered context builder `buildDataModelContextSection(projectId)` that extracts ONLY data-related entities from the full architecture model:
  - logical_data_entities and logical_data_attributes
  - physical_data_entities and physical_data_attributes
  - Relevant relationship data (logical_data_entity_relationships, logical_data_entity_physical_data_entities)
  - Sufficient fields to identify: names, PK/FK flags, data types
- Architecture Meta-Model Explainer (`architecture-context-explainer.md`) injected as context
- New condensed markdown contract summary of TemporaryArchitectureDiagram (to live in `gateway/src/config/prompts/shared/`) -- human-readable, aligned to the canonical TypeScript contract from Increment 1
- Context assembly wired in chatV2.ts as a new inline block (following the pattern of existing task-specific blocks at lines ~2930-3005)

### New Tool Definition Requirements
- New tool name: `saveTemporaryArchitectureDiagram`
- Added to `ToolName` union type in `tools.ts`
- Added to `ALLOWED_TOOL_NAMES` array
- New `ToolDefinition` entry in `TOOL_DEFINITIONS` with parameter schema (projectId, diagramJson)
- New MCP endpoint mapping in `toolExecutor.ts` TOOL_ENDPOINTS
- New required params in `TOOL_REQUIRED_PARAMS`
- Actual MCP endpoint on architecture-model-service is NOT implemented in this increment

### New Prompt Assets
- Task prompt file: `gateway/src/config/prompts/architect.generate-architecture-diagram.task.md`
  - Defines the 4-question flow with strict ordering
  - Includes behavioral rules (use ONLY provided data, exact names, no hallucination, no abbreviation)
  - Includes prohibitions (no *_points wrapper entities, no architecture model modifications, ER only)
  - Includes TemporaryArchitectureDiagram output requirements
  - Instructs the LLM to stop after generating the payload
- Contract summary: `gateway/src/config/prompts/shared/temporary-diagram-contract.md`
  - Condensed markdown version of the TypeScript interfaces
  - Covers: required fields, naming rules, ER-specific constraints, "no IDs" rule, node/edge/compartment structure

### Behavioral Rules (enforced via prompt)
- Use ONLY provided architecture data (no hallucinated entities or attributes)
- Use EXACT entity and attribute names -- NEVER abbreviate or rename
- NEVER create data_entity_points, application_points, or any *_points wrapper entities
- NEVER create/update/delete architecture entities in this task
- NEVER output native diagram JSON -- ONLY output TemporaryArchitectureDiagram
- Explicitly limited to ER diagrams only in this increment -- decline non-ER requests
- Decline generation when no relevant logical/physical data entities exist in the injected context
- No architecture IDs anywhere in output
- Entity and attribute names must match exactly with input context

### Error Handling
- If required architecture data is missing (no data entities): respond with a clear message declining generation
- If entity subset is specified but invalid: ask for clarification before proceeding
- If the data model context builder fails: graceful degradation (log warning, task can still inform the user)

### Reusability Opportunities
- `buildDataModelContextSection()` can be reused by future diagram tasks for other diagram_kind values
- The `saveTemporaryArchitectureDiagram` tool definition can be reused across all future diagram generation tasks
- The condensed contract markdown (`temporary-diagram-contract.md`) can be referenced by future tasks that produce TemporaryArchitectureDiagram payloads
- The server-side payload extraction + MCP call + termination pattern can serve as a template for future workflow tasks that produce structured payloads
- The architect.identity.md is already shared across all architect tasks and will be reused unchanged

### Scope Boundaries

**In Scope:**
- Task JSON definition (`architect--generate-architecture-diagram.json`)
- Architect persona JSON update (add task ID to tasks array)
- Task prompt markdown file
- Condensed TemporaryArchitectureDiagram contract summary markdown
- Filtered data model context builder function
- chatV2.ts context assembly wiring for the new task
- chatV2.ts server-side payload extraction logic for diagram generation
- chatV2.ts server-side MCP tool invocation and termination enforcement
- Tool definition, type, and executor wiring for `saveTemporaryArchitectureDiagram`
- Unit tests for the filtered context builder
- Unit tests for payload extraction logic

**Out of Scope:**
- MCP endpoint implementation on architecture-model-service
- Diagram rendering (canvas, SVG, etc.)
- Auto-mapping (name-to-ID resolution)
- Matching modal UX
- Final diagram persistence (converting temporary to native diagram)
- Support for non-ER diagram kinds (Sequence, Activity, State, etc.)
- Frontend UI changes
- Hub-level availability of this task

### Technical Considerations
- The task uses chatV2 infrastructure exclusively (not v1 chat.ts)
- Pattern B (server-side extraction) means the LLM response must contain the JSON payload in a parseable format -- the prompt and extraction logic must agree on a delimited format (e.g., JSON block within the response)
- The `buildDataModelContextSection()` function should follow the same patterns as `buildArchitectureContextSection()` in `architectureContextBuilder.ts` -- fetch full model, then filter to data-related keys
- Tool name uses camelCase (`saveTemporaryArchitectureDiagram`) consistent with existing tool naming convention
- The `contextNeeds` array on the task JSON may be empty (like OAS spec) if all context injection is handled by inline assembly blocks in chatV2.ts, OR it may include new context keys if resolver-based injection is preferred -- this is an implementation decision
- The TemporaryArchitectureDiagram contract version is 1 (from `TEMPORARY_ARCHITECTURE_DIAGRAM_VERSION` constant)
- The prompt composition pipeline in `promptComposer.ts` handles Layer 1 (identity) + Layer 2 (task prompt) + Layer 3 (resolved context sections) automatically -- the new task only needs to ensure its context sections are populated in `resolvedContext` before `composeSystemPrompt()` is called
