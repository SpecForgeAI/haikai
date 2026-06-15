# Spec Requirements: Data Movement Rendering and Palette Synchronisation Fix

## Initial Description

We need to fix a bug in the Diagram view where **Data Movement** relationships are not being drawn on the canvas even though both endpoint applications are present, and we must tighten the rules for when relationship palette rows are enabled/disabled.

## Context / Current Behaviour

- Meta-model:
  - A `Data Movement` row links:
    - `source_application_point_id`
    - `target_application_point_id`
    - `logical_data_entity_id` (used for the label text only in this diagram)
- Diagram:
  - Two Applications ("My App" and "Your App") are present on a diagram.
  - One Logical Data Entity ("Our Data") is defined in the meta-model but **not** on the diagram.
  - One Data Movement exists in the meta-model with:
    - source = "My App"
    - target = "Your App"
    - data entity = "Our Data"
  - In the right-hand Palette panel (Relationships → Data Movements):
    - The Data Movement row is **enabled** (correct), and right-click → "Add" is available.
    - After choosing "Add", **nothing appears** on the canvas.
- Time-based visibility is enabled for nodes and relationships, but in this example all valid_from / valid_to fields are empty, so time filtering should not hide anything.

## Desired Behaviour (Clarified Rules)

### A. General rules for Data Movements (visualisation)

1) A Data Movement relationship should be visualised as:
   - A **solid line** between the source and target Application Point nodes.
   - An **arrow head at the target end** (arrow_end = ARROW, arrow_start = NONE).
   - A **single label** on the line whose text is the name of the associated Logical Data Entity (e.g. "Our Data").
   - Label is centred initially (midpoint of the polyline) but remains **draggable** afterwards as today.

2) **The logical data entity does NOT need to be on the diagram as a node** for the Data Movement to be visualised.
   - The logical entity is used **only for label text** (and maybe future styling), not as a required diagram node.

### B. Palette row enabled/disabled rules (per diagram)

For each relationship type, the enabled/disabled state of the Palette row must be recomputed whenever:
- The selected diagram changes.
- Nodes are added/removed from the selected diagram.
- Nodes are deleted from the meta-model.
- The time period / effective date changes (because nodes can appear/disappear).

#### Specific per-relationship rules:

**1) User ↔ Process**
- Row is **enabled** if both endpoint nodes (User and Process) are on the current diagram and visible for the current time period.
- Row is **disabled** otherwise, with tooltip: "Both endpoints must be on this diagram to add this relationship".
- "Add" creates a dashed line between the outer bounds of the two nodes; label behaviour unchanged.

**2) App Point ↔ Process**
- Row is:
  - **Enabled** if either:
    a) Endpoint Application Point is on the diagram but Process is not; OR
    b) Neither is on the diagram.
    (Because we may need to add/resize the Application Point and place the Process inside it.)
  - **Disabled** if both Application Point and Process are already on the diagram and the relationship is already visualised there.
- When "Add" is triggered:
  - If App Point exists on the diagram but Process does not:
    - Add the Process node **inside** the App Point node.
    - Resize the App Point box using the same algorithm as "Add with business processes" but just for this single Process.
  - If neither App Point nor Process is on the diagram:
    - Add both as nodes (App Point outer box, Process inner green box) using the same placement and sizing rules as "Add with business processes" but only for this pair.
  - If both are already on the diagram and the relationship is not yet visualised:
    - Treat it like "Add with business processes" for a single process: ensure the Process is inside the App Point and the parent auto-sizes correctly.
- The final visual result matches our existing "Add with business processes" layout for a single process.

**3) Logical ER, Logical ↔ Physical Entities, Logical ↔ Physical Attributes**
- Row is **enabled** if both endpoint entities are on the current diagram and visible for the current time period.
- Row is **disabled** otherwise (same tooltip as User ↔ Process).
- "Add" creates the appropriate line (and cardinality markers for Logical ER) between the two nodes, as per existing logic/spec.

**4) Data Movements (CRITICAL FIX)**
- Row is **enabled** if and only if:
  - The source Application Point node is present on the current diagram, AND
  - The target Application Point node is present on the current diagram, AND
  - The Data Movement relationship itself is effective for the current time period.
- Row is **disabled** in all other cases, with tooltip: "Source and target Applications must be on this diagram to add this data movement".
- **Logical Data Entity node presence must NOT be required** for enabling the row.

When user left-clicks the Data Movement row, or right-clicks → "Add":
- If row is enabled:
  1. Create (or update, if already present) a `diagram_edge` with:
     - `relationship_type = DATA_MOVEMENT`
     - `relationship_id = <this data movement id>`
     - `source_node_id` = diagram node id of the source Application Point
     - `target_node_id` = diagram node id of the target Application Point
     - `arrow_end = ARROW`, `arrow_start = NONE`
     - If the edge has no points yet:
       - Create two edge_points: one anchored near the centre of each node's edge (current behaviour for connecting nodes).
     - `label_text`:
       - If explicit label_text already exists in the diagram_edge, keep it.
       - Otherwise, default to the logical data entity name:
         - `label_text = logical_data_entities[data_movements[relationship_id].logical_data_entity_id].name`
     - Set initial `label_pos_x`, `label_pos_y` to the midpoint of the edge polyline if unset.
  2. Ensure the edge is **not filtered out** by rendering/time filters as long as both endpoint nodes are visible for the current period (see next section).
- If row is disabled and user attempts to add via right-click → Add:
  - Show the same tooltip message in a non-blocking way (e.g. toast or small inline warning) and do nothing.

### C. Rendering / filtering logic fix

We identified TWO bugs causing Data Movement edges not to render:

**Bug 1: getRelationshipEndpointEntities includes Logical Data Entity**
- Location: `frontend/src/utils/rendering.ts`, function `getRelationshipEndpointEntities`
- The DATA_MOVEMENT case was returning `[sourceApp, targetApp, dataEntity]`
- When `getEdgesForDiagram` checks temporal visibility, the Logical Data Entity fails because it's not on the diagram
- **Fix:** Remove the dataEntity from the returned array - return only `[sourceApp, targetApp]`

**Bug 2: getDataMovementNodes only looks for APPLICATION_POINT nodes**
- Location: `frontend/src/utils/relationshipUtils.ts`, function `getDataMovementNodes` (lines 921-959)
- The function used `findAppPointNode()` which only finds nodes with `entity_type === 'APPLICATION_POINT'`
- When users add an "Application" from the palette, it creates a node with `entity_type = 'APPLICATION'` (not `APPLICATION_POINT`)
- The eligibility check (`isDataMovementEnabledWithSets`) correctly maps APPLICATION → application_points, so the row shows as **enabled**
- But `getDataMovementNodes()` then returns null because it can't find `APPLICATION_POINT` nodes, so no edge is created
- **Fix:** Update `getDataMovementNodes()` to check for all node types that can represent an application:
  1. Direct `APPLICATION` node matching by `application_id`
  2. `APPLICATION_POINT` node where `ap.application_id` matches
  3. `APP_COMPONENT` node where `ap.application_component_id` matches
  4. `SERVICE` node where `ap.service_id` matches
- This mirrors the same abstraction logic used in `getEntitiesOnDiagram()` for the enabled/disabled eligibility check

We must ensure:

1) For **DATA_MOVEMENT** edges, an edge is considered renderable if:
   - Its `relationship_id` resolves to an existing Data Movement in `metaModel.relationships.data_movements`.
   - Both source and target Application Point entities for that relationship are present on the current diagram (i.e., there exist `diagram_nodes` whose `entity_type` is some Application Point type and whose `entity_id` matches the source/target Application Point ids), and those nodes are effective for the current period.
   - Time filtering rules for the Data Movement itself are satisfied (valid_from/valid_to, if present).
   - **We must NOT require the logical_data_entity to be present as a diagram node**.

2) For non-DATA_MOVEMENT relationships, existing filtering rules remain unchanged (still require both endpoint nodes to be present and visible for the current period).

3) If an Add operation creates an edge but the renderer would drop it due to some condition, we should log a **clear console warning** to aid debugging:
   - Example: `console.warn("Filtered out data movement edge", { edgeId, reason: "missing source node on diagram" })`

### D. Synchronisation of Palette state with diagram

We must ensure that the Palette enabled/disabled states are **recomputed whenever**:
- The selected diagram changes.
- A node is added/removed from the selected diagram.
- A node or relationship is deleted from the meta-model.
- Time period / effective date changes.

Implementation guidance:
- Introduce a single helper (e.g. `getRelationshipAvailabilityForDiagram(diagram, metaModel, currentPeriod)`) that returns, for each relationship type/id, one of:
  - `"enabled"`, `"disabled_missing_endpoints"`, `"disabled_already_present"`, etc.
- Use this helper both:
  - In the Palette component to control row enabled/disabled and tooltip text.
  - In the Add handlers to **short-circuit** if a relationship is not currently eligible to be added, even if the UI state somehow falls out of sync.

## Acceptance Criteria

1) With two apps "My App" and "Your App" on diagram "Sample", and a Data Movement from My App → Your App for logical entity "Our Data":
   - In the RHS Palette, Data Movements section:
     - The relationship row is **enabled**.
   - Left-clicking the row, or right-click → "Add":
     - Draws a solid line from "My App" to "Your App".
     - The line has an arrow head pointing to "Your App".
     - A label "Our Data" appears roughly at the midpoint of that line.
   - Changing the period (with all valid_from/to empty) does not hide this edge.

2) If we create a second blank diagram and switch to it:
   - Even though the same Data Movement exists in the meta-model:
     - The Data Movement row is **disabled** in the Palette for this second diagram.
     - Tooltip: "Source and target Applications must be on this diagram to add this data movement".

3) If we then add "My App" only to the second diagram:
   - The Data Movement row remains **disabled** (only one endpoint present).

4) If we then add "Your App" to the second diagram:
   - The Data Movement row becomes **enabled**, and Add behaves as in (1).

5) If we delete "My App" from a diagram that currently shows the Data Movement:
   - The Data Movement edge disappears from the canvas.
   - The Palette row becomes **disabled** for that diagram.
   - No stale edge remains in the JSON after save/reload.

6) On DevTools console, no silent failures occur when adding relationships:
   - If a relationship cannot be rendered due to missing endpoints or time filtering, a clear warning is logged as described above.

## Visual Assets

No visual assets provided.

## Scope Boundaries

### In Scope

- Fix Data Movement edge rendering (remove logical entity node requirement from getRelationshipEndpointEntities)
- Fix getDataMovementNodes to find APPLICATION/APP_COMPONENT/SERVICE nodes (not just APPLICATION_POINT)
- Fix Palette enabled/disabled synchronisation with diagram state
- Add console warnings for filtered-out edges
- Update edge filtering logic for DATA_MOVEMENT relationship type
- Ensure time filtering works correctly for Data Movements
- Add tests for all acceptance criteria

### Out of Scope

- Changes to other relationship type rendering logic
- Meta-model schema changes
- UI styling changes beyond ensuring arrow renders correctly
- Performance optimisations for palette state computation
