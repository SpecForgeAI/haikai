Title: Render Temporary Architecture Diagrams in Frontend (Increment 4)

Objective:
Implement the frontend rendering pipeline for temporary architecture diagrams that were saved via the MCP endpoint (Increment 3). This increment bridges the gap between the saved TemporaryArchitectureDiagram data and the existing diagram canvas rendering system.

This is Increment 4 in the series:
- Increment 1: Contract definition (complete) - TemporaryArchitectureDiagram TypeScript interfaces
- Increment 2: Architect task framework (complete) - LLM task that generates diagram payloads
- Increment 3: MCP endpoint for saving (complete) - Backend persistence and retrieval endpoints
- Increment 4: Frontend rendering (THIS increment)

This increment must:
- Fetch a saved TemporaryArchitectureDiagram from the backend via the existing GET endpoint
- Transform/map the temporary diagram contract into a renderable format compatible with the existing Canvas component
- Render the diagram using the existing ERD-style rendering pipeline (for ER diagram_kind)
- Provide a way for the user to navigate to and view the temporary diagram
- NOT modify the existing native diagram persistence or meta-model
- NOT implement finalization/confirmation (converting temporary to permanent)

---

Problem Context:
The Architect task (via MCP tool) can now generate and save TemporaryArchitectureDiagram payloads. However, there is currently no way for the user to see these generated diagrams in the UI. The temporary diagram data uses a name-based contract (ref_name fields) rather than internal entity IDs, and uses a different structure (compartments instead of embedded_attribute_ids) than what the existing Canvas/ERD rendering expects.

The rendering pipeline needs to:
1. Fetch the temporary diagram data from the backend
2. Map the TemporaryArchitectureDiagram structure into the format the existing Canvas component can render
3. Display it using the existing ERD-style rendering (for ER diagrams)
4. Handle edges with ER symbols, cardinality labels, and polyline routing

---

Key Technical Challenges:
1. The Canvas expects native DiagramNode/DiagramEdge types with entity_id, relationship_id, etc.
   The temporary contract uses ref_name, compartments, and nested labels instead.
2. The ERD rendering currently looks up attributes from the meta-model via embedded_attribute_ids.
   The temporary contract has self-contained compartment items with display_name and metadata.
3. The edge rendering uses flat source_label_text/source_label_pos_x fields.
   The temporary contract uses nested source_label/target_label objects.
4. Navigation: The user needs a way to get to the temporary diagram view.

---

Scope:
1. Gateway proxy route for the GET endpoint (frontend -> gateway -> architecture-model-service)
2. Frontend API client for fetching temporary diagrams
3. Mapping/transformation logic: TemporaryArchitectureDiagram -> renderable format
4. Rendering component or adaptation layer that uses existing Canvas/ERD rendering
5. Navigation entry point (how the user accesses the temporary diagram)
6. Read-only view (no editing of temporary diagrams in this increment)

---

Non-Goals:
- Finalization/confirmation modal to convert temporary -> permanent diagram
- Editing capabilities on the temporary diagram
- Architecture ID resolution/mapping (ref_name -> entity_id)
- Modifications to the native diagram persistence schema
- Support for non-ER diagram kinds
