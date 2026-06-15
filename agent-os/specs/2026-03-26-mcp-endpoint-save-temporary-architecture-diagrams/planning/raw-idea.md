Title: Implement MCP Endpoint for Saving Temporary Architecture Diagrams

Objective:
Implement a backend/MCP endpoint that accepts a TemporaryArchitectureDiagram payload (from Increment 1 and 2), validates it, persists it as a temporary diagram resource, and returns a reference that the frontend can later use to load and render the diagram.

This is Increment 3 in the series:
- Increment 1: Contract definition (complete)
- Increment 2: Architect task framework (complete)
- Increment 3: MCP endpoint for saving (THIS increment)

This endpoint must:
- Accept only the TemporaryArchitectureDiagram contract (no native diagram payloads)
- Perform structural validation and basic semantic validation
- Store the diagram as a temporary (non-finalized) artifact
- NOT perform any mapping to architecture IDs
- NOT convert to native diagram format yet
- Be accessible to the Architect task via MCP tool call

---

Scope:

1. Define MCP Tool/Endpoint:
   - Name: saveTemporaryArchitectureDiagram
   - Method: POST
   - Input: TemporaryArchitectureDiagram
   - Output: TemporaryArchitectureDiagramSaveResponse

2. Add server-side validation for the TemporaryArchitectureDiagram contract

3. Persist the diagram in a temporary storage mechanism

4. Return a reference identifier for later retrieval

---

API Definition:

Request:
POST /api/v1/temporary-diagrams

Body:
TemporaryArchitectureDiagram

Response:
TemporaryArchitectureDiagramSaveResponse
- id: string
- status: "saved"
- created_at: string (ISO timestamp)

---

Validation Rules:

1. Required Fields: id, diagram_kind, source_architecture_domain, view_mode, nodes[], edges[]

2. Diagram Constraints:
- diagram_kind MUST be "ER" (only supported type in this increment)
- source_architecture_domain MUST be "DATA"
- view_mode MUST be "LOGICAL" or "PHYSICAL"

3. Node Validation:
- id must be unique across nodes
- ref_name must be non-empty
- semantic_type must match view_mode (LOGICAL → LOGICAL_DATA_ENTITY, PHYSICAL → PHYSICAL_DATA_ENTITY)
- pos_x, pos_y, width, height must be present

4. Attribute Validation:
- Each node must have at most one ATTRIBUTES compartment
- Attribute ref_name must be non-empty
- No duplicate attribute names within a node

5. Edge Validation:
- id must be unique across edges
- source_node_id and target_node_id must exist in nodes
- source_ref_name and target_ref_name must match node ref_names
- edge_points must contain at least 2 points
- sequence_order must be contiguous starting from 0

6. General Rules:
- NO architecture IDs allowed
- All names must be strings (no null/undefined)

---

Persistence Strategy:
Store diagrams as TEMPORARY, not part of model.diagrams.
Suggested: In-memory store (for initial increment) OR database table: temporary_diagrams

Data to persist: id, full JSON payload, created_at timestamp, optional user/session reference

No mapping or transformation occurs here.

---

MCP Integration:
Tool Name: saveTemporaryArchitectureDiagram
Tool Input: TemporaryArchitectureDiagram JSON
Tool Behavior: Validate input, Persist diagram, Return response with id and status

---

Error Handling:
Return 400 if: Required fields missing, Invalid view_mode or diagram_kind, Node/edge reference errors, Invalid structure
Return 500 if: Persistence failure
Error Response: message: string, details?: string[]

---

Deliverables:
1. New endpoint: /api/v1/temporary-diagrams (POST)
2. MCP tool registration: saveTemporaryArchitectureDiagram
3. Validation logic
4. Temporary storage implementation
5. Response type definition: TemporaryArchitectureDiagramSaveResponse

---

Acceptance Criteria:
- Endpoint accepts valid TemporaryArchitectureDiagram payloads
- Invalid payloads are rejected with clear errors
- Diagrams are stored and retrievable by id
- MCP tool successfully invokes endpoint
- No conversion to native diagram format occurs
- No architecture ID mapping occurs
- Compatible with Increment 2 task output

---

Out of Scope:
- Rendering in UI
- Diagram retrieval endpoint
- Mapping to architecture entities/attributes
- Modal or UX behavior
- Final diagram persistence in model.diagrams
