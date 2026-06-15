# Spec Requirements: Relationship Visualisation and RHS Palette Behaviour

## Initial Description

We need to correct and standardise how meta-model relationships are visualised on the diagram and how the right-hand side (RHS) Relationships palette behaves when a user adds relationships to a diagram.

This is a refinement of the existing diagram behaviour, not a brand-new feature. The goal is:

- Ensure each relationship type renders in a specific, well-defined visual pattern (lines, containment, labels, arrow-heads).
- Ensure each RHS relationship row is correctly enabled/disabled based on whether its endpoint nodes are already present on the current diagram.
- Ensure a relationship can be added either by:
  - **Left-clicking** the RHS row, OR
  - **Right-click → "Add"** via the context menu.
- When a row is disabled, both left-click and right-click "Add" must be blocked and visually indicated as disabled.

We are *not* changing the underlying meta-model; this is purely a UI/diagram-behaviour update.

## Relationship Visualisation Rules

For all rules below, any text label (multiplicity labels, data movement labels, etc.) must:

- Be rendered as text on the diagram.
- Be individually selectable.
- Be draggable to a new position.
- Persist its position in the diagram JSON.

We have 6 main relationship categories:

### 1. User ↔ Process

Meta-model: business_user_processes

Visualisation:

- Draw a **dashed line** between:
  - The User stick-man node, and
  - The green Business Process node.

Details:

- The line should connect to the **outside edge** of each node, not the centre.
- Style:
  - `line_type = DASHED`
  - Reasonable default dash pattern (existing line-style system).
- No extra arrow-heads or multiplicity for this relationship.

### 2. App Point ↔ Process

Meta-model: application_point_business_processes

Visualisation:

- Represented as **containment**, not a visible line.
- The Business Process must appear as a green box **inside** the blue Application Point node, where the Application Point represents either:
  - Application
  - Application Component
  - Service

Additional rules:

- The Application Point box must auto-size to contain its child process boxes, following the same rules we already use for **"Add with business processes"**:
  - 5px horizontal padding left and right.
  - 5px vertical padding above first process and below last process.
  - 5px vertical gap between stacked process boxes.
- When adding a single business process via this relationship:
  - If other child processes already exist, place the new one below the existing ones with the same vertical gap.

### 3. Logical ER

Meta-model: logical_data_entity_relationships

Visualisation:

- Draw a line between the **source logical entity** and **target logical entity**.
- Display **two multiplicity labels** on the line:
  - One near the **source entity**.
  - One near the **target entity**.

Multiplicity labels:

- Use the relationship's cardinality type to determine labels:
  - ONE_TO_ONE: `1` near source, `1` near target.
  - ONE_TO_MANY: `1` near source, `m` near target.
  - MANY_TO_ONE: `m` near source, `1` near target.
  - MANY_TO_MANY: `m` near source, `m` near target.

Positioning:

- Default placement:
  - Source multiplicity label: on the line close to the source entity's edge.
  - Target multiplicity label: on the line close to the target entity's edge.
- Both labels must be draggable and individually selectable.

### 4. Logical ↔ Physical Entities

Meta-model: logical_data_entity_physical_data_entities

Visualisation:

- Draw a simple line between the **logical entity node** and the **physical entity node**.

No multiplicity labels are required by default, but the line should support the same styling system as other edges.

### 5. Logical ↔ Physical Attributes

Meta-model: logical_data_attribute_physical_data_attributes

Visualisation:

- Draw a line between the **logical attribute node** and the **physical attribute node**.
- This is likely used rarely but should behave consistently with other simple "A ↔ B" relationships.

### 6. Data Movements

Meta-model: data_movements

Visualisation:

- Draw a **solid line with an arrow head** from the **source Application Point** to the **target Application Point**.
- The arrow head must be at the **target** end of the line.
- The default text label in the middle of the line is the **Logical Data Entity's name** for the associated data_movement.

Details:

- When creating the edge:
  - `relationship_type = DATA_MOVEMENT`
  - `arrow_end = ARROW` (or whatever enum we use).
  - `line_type = SOLID` (unless overridden by style).
- Label behaviour:
  - Default text:
    - `label_text = logical_data_entity.name` corresponding to `data_movement.logical_data_entity_id`.
  - Initial position:
    - Roughly at the midpoint of the line (average of edge_points).
  - Label is selectable and draggable.
  - Supports existing font/colour styling controls.

## RHS Relationships Panel: Enable/Disable Logic

The RHS "Relationships" palette currently shows relationship rows greyed out or enabled in a way that does not match the logic above. We need to:

- Correctly **enable** rows when the relationship can be drawn with existing nodes on the diagram.
- Correctly **disable** rows when it cannot.
- Ensure that **adding a relationship** can be triggered by:
  - Left-clicking the row, OR
  - Right-click → "Add" in the context menu.
- If a row is disabled:
  - Both left-click and right-click "Add" must be NO-OP and visually disabled (e.g., greyed text, disabled menu item).

Notation below:
- "On diagram" = there is a diagram_node already present referencing the meta-model record.

### User ↔ Process (business_user_processes)

Enable rule:

- The row is **enabled** if BOTH:
  - The User (business_user) is on the diagram, and
  - The Process (business_process) is on the diagram.

Disabled rule:

- If either endpoint is missing (User or Process not on the diagram), the row is **disabled**.

Add behaviour (row enabled):

- On left-click OR right-click → "Add":
  - Create a diagram_edge between the User node and Process node.
  - Style:
    - Dashed line.
    - No arrow-head.
  - Place edge_points so that the line connects the outer edges of the two nodes.
  - Save label positions if any are later moved by the user.

### App Point ↔ Process (application_point_business_processes)

We have three cases based on what's already on the diagram:

Let:
- A = Application Point node
- P = Process node

Case A: A present, P missing

- Row is **enabled**.
- "Add" should:
  - Create a new Process diagram_node inside the existing Application Point node.
  - Place the process box with:
    - Same horizontal alignment as other child processes of A (if any).
    - Stacked vertically with 5px gaps.
  - Auto-resize the Application Point box using the same rules as "Add with business processes" (5px padding and correct height calculation).

Case B: Neither A nor P present

- Row is **enabled**.
- "Add" should:
  - Create the Application Point node.
  - Create **this single** Process node as a child inside it.
  - Position A and P together in the centre of the visible canvas area (consistent with existing "Add with business processes" behaviour but applied for one process).
  - Apply the same auto-size rules.

Case C: Both A and P already on the diagram

- The user has already constructed the containment for this relationship.
- Row should be **disabled** (no further action when clicked).

Note: we are not drawing a line for App Point ↔ Process; containment is the visual representation.

### Logical ER (logical_data_entity_relationships)

Enable rule:

- Row is **enabled** if BOTH logical entities (source and target) in the relationship are on the diagram.

Disabled rule:

- If either logical entity is missing from the diagram, row is **disabled**.

Add behaviour (row enabled):

- On "Add":
  - Create a diagram_edge between the two logical entity nodes.
  - Add multiplicity labels as per section 1.3:
    - Source side label near the source entity.
    - Target side label near the target entity.
  - Ensure both labels are stored in the JSON (with positions) and are draggable.

### Logical ↔ Physical Entities

Enable rule:

- Row is **enabled** if BOTH:
  - The logical entity node, and
  - The physical entity node
  are present on the diagram.

Disabled rule:

- If either is missing, row is **disabled**.

Add behaviour (row enabled):

- On "Add":
  - Create a diagram_edge between the logical and physical entity nodes.
  - Use default line style (solid, no arrow, unless user overrides later).

### Logical ↔ Physical Attributes

Enable rule:

- Row is **enabled** if BOTH:
  - The logical attribute node, and
  - The physical attribute node
  are present on the diagram.

Disabled rule:

- If either attribute node is missing, row is **disabled**.

Add behaviour (row enabled):

- On "Add":
  - Create a diagram_edge between the two attribute nodes (simple line as above).

### Data Movements (data_movements)

Endpoint interpretation:

- Each data_movement has:
  - `source_application_point_id`
  - `target_application_point_id`
- These map to Application Point nodes representing Application / Component / Service.

Enable rule:

- Row is **enabled** if BOTH:
  - Source Application Point node is on the diagram, and
  - Target Application Point node is on the diagram.

Disabled rule:

- If either endpoint is missing, row is **disabled**.

Add behaviour (row enabled):

- On "Add":
  - Create a diagram_edge between the source and target Application Point nodes.
  - Set:
    - `relationship_type = DATA_MOVEMENT`
    - `arrow_end = ARROW` so that the arrow head is drawn at the **target** node end.
    - `line_type = SOLID` (unless user changes style later).
  - Compute default edge_points so the line connects the nodes (simple straight line by default).
  - Set the label:
    - `label_text = logical_data_entities[data_movement.logical_data_entity_id].name`
    - Initial position: midpoint of the line (average of edge_points).
  - The label must:
    - Be selectable and draggable.
    - Support existing font style / colour configuration.

## Interaction Model for Adding Relationships

For all relationship rows (when enabled):

- **Left-click on the row:**
  - Immediately performs the "Add relationship to current diagram" behaviour described above.

- **Right-click on the row → context menu:**
  - Show menu options:
    - "Add" (enabled only if the row itself is enabled).
    - "Delete from diagram" (if we later support removing just this visual link; out of scope now unless already implemented).
  - Selecting "Add" must perform the same operation as left-click.

For disabled rows:

- Visual state:
  - Row appears greyed/disabled.
  - Any "Add" menu item appears disabled.
- Behaviour:
  - Left-click: no action.
  - Right-click "Add": no action.

## JSON Persistence

- All new edges and labels created by these interactions must be reflected in the diagram's JSON in the same way as edges/labels created by earlier interactive features:
  - `diagram_edges[]` entries for lines.
  - `edge_points[]` for line geometry.
  - Label position fields (`label_pos_x`, `label_pos_y`) for line labels.
- Containment for App Point ↔ Process should continue to use:
  - `diagram_nodes[].parent_node_id` to reflect that a Process node sits inside an Application Point node.
- No changes are required to the meta-model schema; only the diagram-level JSON needs to be updated for these visuals.

## Testing Requirements

Add / update tests (unit and/or integration) to cover:

1) Relationship enable/disable logic in the RHS panel:
   - For each relationship type, verify that the row is enabled only when both endpoints are present as described.
2) Diagram mutations when adding relationships:
   - Verify the correct `diagram_edges` and `diagram_nodes` are created.
   - Verify multiplicity labels for Logical ER.
   - Verify arrow head is on the target for Data Movements.
   - Verify containment of Process inside Application Point for App Point ↔ Process.
3) Click vs context-menu:
   - Left-click and right-click "Add" result in identical diagram changes.
4) Label draggability:
   - Moving a label updates its stored coordinates and round-trips correctly via JSON save/load.

## Visual Assets

No visual assets provided.

## Scope Boundaries

### In Scope

- Relationship visualisation rendering for all 6 relationship types
- RHS Relationships panel enable/disable logic
- Left-click and right-click "Add" functionality
- Multiplicity labels for Logical ER relationships
- Data movement labels with entity names
- Label selection and dragging
- JSON persistence for edges and label positions
- Auto-sizing for Application Point containment

### Out of Scope

- Changes to the underlying meta-model schema
- New relationship types
- "Delete from diagram" functionality (unless already implemented)
- Backend API changes
- Changes to how relationships are created/edited in the meta-model
