Title: Enable "Endpoint" Nodes in Diagram View (Palette Section, Node Type Registration, Validation Fix)

Summary:
The new meta-model entity **Endpoint** has been added to the Meta-model view, but the Diagram view does not yet recognise it:
- There is **no "Endpoints" section** in the diagram palette (RHS under Application Architecture).
- Loading a diagram containing an Endpoint node causes a validation error:
  "Node ... has unknown entity type ENDPOINT".

This spec wires the Endpoint entity into the diagram layer so that:
- The Diagram view recognises `ENDPOINT` as a valid node type.
- An **Endpoints** section appears under **Interfaces** in the diagram palette.
- Diagrams with Endpoint nodes load without error and render correctly.

--------------------------------------------------------------------
1. Register ENDPOINT as a valid diagram node type

Update the diagram node type registry / validation logic:

1.1 Add `ENDPOINT` to the list of recognised entity types for diagram nodes.

- Wherever node types are enumerated (e.g. `APPLICATION`, `APPLICATION_COMPONENT`, `SERVICE`, `INTERFACE`, `LOGICAL_ENTITY`, etc.), add:

  - `ENDPOINT`

1.2 Validation:
- During diagram load, when validating nodes:
  - If `node.entityType === "ENDPOINT"`, it MUST be treated as a valid type.
  - The previous "unknown entity type ENDPOINT" error must no longer occur.

1.3 JSON shape:
- Endpoint nodes in diagram JSON should follow the same structure as other nodes:

  {
    "id": "node-123",
    "entityType": "ENDPOINT",
    "entityId": "<endpoint_meta_model_id>",
    "pos_x": ...,
    "pos_y": ...,
    "width": ...,
    "height": ...,
    "auto_size": false,
    "z_index": 0,
    ...
  }

- Load and save logic must treat these exactly like any other node type.

--------------------------------------------------------------------
2. Add "Endpoints" section to Diagram palette (Application Architecture)

In the Diagram view palette (RHS), where Application Architecture entities appear, update to include **Endpoints**:

- Current structure (example):
  - Applications
  - App Components
  - Services
  - Interfaces
  - Logical Entities
  - ...

- Required structure:

  - Applications
  - App Components
  - Services
  - Interfaces
  - **Endpoints**
  - Logical Entities
  - Physical Entities
  - ...

2.1 Endpoints palette section:

- Label: **"Endpoints"**
- Content:
  - List of Endpoint rows associated with the selected period / filter, similar to how Interfaces and Logical Entities are listed.
  - Each row corresponds to a meta-model Endpoint record.

2.2 Drag / right-click behaviour:

- Dragging an Endpoint row (if supported) onto the canvas creates a diagram node:
  - entityType: `ENDPOINT`
  - entityId: that Endpoint's id.

- Right-click on an Endpoint row should (at minimum) support:
  - "Add" → adds a single Endpoint node to the diagram.
- Additional context actions (e.g., "Advanced Add…") can be introduced separately.

--------------------------------------------------------------------
3. Rendering behaviour for Endpoint nodes (baseline)

This spec only requires a **baseline visual representation** so that diagrams load and display without errors:

3.1 Base style:

- Endpoint node uses a simple box node style similar to Interfaces/Services, e.g.:
  - Box with border and background.
  - Text inside showing `Endpoint.name`.
- It may reuse the style for Interface or have a new colour; visual details are not critical for this fix as long as it's consistent and legible.

3.2 Positioning, resizing, z_index, auto_size:

- Endpoint nodes must fully participate in existing node behaviours:
  - Can be moved (pos_x/pos_y updated).
  - Can be resized (width/height updated).
  - Respect `auto_size` rules like other nodes.
  - Respect z_index ordering and context menu actions as per previous specs.

3.3 Advanced Add:

- If Advanced Add already produces nodes for Endpoints (using Interface → Endpoint parent/child), the resulting nodes must render correctly using the above style.

--------------------------------------------------------------------
4. Load/Save behaviour for diagrams containing Endpoints

4.1 Load:

- When a diagram JSON contains nodes with `entityType: "ENDPOINT"`:
  - No validation error must be thrown.
  - Nodes must be instantiated and rendered on the canvas.
  - Any existing diagram using Endpoint nodes must now load successfully.

4.2 Save:

- Saving a diagram with Endpoint nodes must preserve their node entries exactly as for other node types.

--------------------------------------------------------------------
5. Acceptance Criteria

1. Diagram view palette shows an **Endpoints** section under **Interfaces** in the Application Architecture group.
2. Creating an Endpoint node (via palette or Advanced Add) succeeds and the node appears on the canvas with a reasonable box style.
3. Moving/resizing/z-index/auto-size on Endpoint nodes behaves the same as for other nodes.
4. Loading a JSON file that contains Endpoint nodes no longer raises "unknown entity type ENDPOINT"; the nodes are rendered on the canvas.
5. Saving and reloading a diagram with Endpoints preserves their presence and layout.

This spec fully wires the new Endpoint meta-model entity into the Diagram view so that it is a first-class diagram node type.
