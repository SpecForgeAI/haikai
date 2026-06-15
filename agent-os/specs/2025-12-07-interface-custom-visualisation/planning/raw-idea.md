Title: Custom Interface Visualisation (Endpoints + Entities) + Advanced Add Child Layout Controls

Summary:
Introduce a custom visualisation for Interfaces that shows:
- Interface header
- A numbered list of its Endpoints (as text, not boxes)
- ER-style entity boxes (entities + attributes) beneath the endpoint list

Provide this via:
1) A new Interface context menu item: "Add with all children"
2) Advanced Add… when an Interface and its children are selected

Additionally, add generic layout enhancements:
A) Text in child nodes wraps when the node width is reduced
B) Advanced Add gains two layout controls:
   - Child columns (1–10)
   - Child node width (10–1000 px)

--------------------------------------------------------------------
1. New Interface context menu: "Add with all children"

In the RHS "Interfaces" section:

- When right-clicking an Interface row, add a new context menu item:

  **"Add with all children"**

Behaviour:
- Adds the Interface to the diagram (if not already present).
- Includes:
  - All Endpoints for that Interface (children via Interface → Endpoint parent/child).
  - All relevant Logical/Physical Entities and their attributes (via existing relationships + "with attributes" behaviour).
- Renders the Interface using the new custom layout defined in Section 2.

This is distinct from any existing "Add" or "Advanced Add…" actions.

--------------------------------------------------------------------
2. Custom Interface layout (Interface + Endpoints + Entities)

When an Interface is added via:
- "Add with all children", OR
- Advanced Add… with the Interface and its children selected (Section 3),

the Interface node MUST render with the following internal structure:

2.1 Interface header
- Top area: Interface name
- Same styling as current Interface header (bold, appropriately padded).

2.2 Endpoints list (text rows, not boxes)
- Immediately below the header, render all Endpoints belonging to this Interface as a vertical list of text lines.
- Do NOT create separate box nodes for Endpoints in this custom view.
- Each endpoint line is formatted as:

  `<index>. <operation_verb> <path_or_address> - <endpoint_name>`

  Where:
  - `index` = 1-based ordinal (1, 2, 3, …) in some deterministic order (e.g., by name, id, or explicit order field).
  - `operation_verb` = Endpoint.operation_verb (e.g. GET, POST, PUBLISH).
  - `path_or_address` = Endpoint.path_or_address.
  - `endpoint_name` = Endpoint.name.

  Example:
  - `1. GET /customers/{id} - Get customer by id`
  - `2. POST /customers - Create customer`
  - `3. PUBLISH CustomerEventsQueue - Publish customer events`

- Endpoints list area must respect text wrapping rules (see Section 4).

2.3 Entity boxes (ERD-style) below endpoints
- Beneath the endpoints list, draw all Logical / Physical Entities for this Interface using the existing ERD/UML-style box:
  - Entity name in a header compartment.
  - Divider line.
  - Attribute rows: `<attributeName> : <dataType>`.

- These entity boxes are children inside the Interface box.
- Their layout (columns, width, spacing) is controlled by the Advanced Add layout settings (Spacing, Child Columns, Child Node Width).

2.4 Endpoint-only or entity-only cases
- If there are no Endpoints:
  - Skip the endpoint list section and render entities only.
- If there are no entities:
  - Render only the Interface header + endpoint list.

--------------------------------------------------------------------
3. Advanced Add – Interface custom view parity

In the Advanced Add dialog:

- When the user selects an Interface and its children (Endpoints + Entities + Attributes) in the tree, and clicks "Add to Diagram":

  - The resulting diagram must use the same custom layout as "Add with all children":
    - Interface header
    - Endpoint list as text lines (no endpoint boxes)
    - ERD-style entity boxes with attributes below.

- Attribute selections behave as previously specified:
  - Selected attributes appear as rows inside the entity box.
  - Unselected attributes are omitted from the ERD-style view.
- No separate Endpoint, Logical Data Attribute, or Physical Data Attribute nodes are created.

--------------------------------------------------------------------
4. Generic enhancement A – Text wrapping in child nodes

Requirement:
- All node types that display textual content (e.g. Endpoints list, Entity boxes, Interface header, etc.) must support text wrapping when the node's width is reduced.

Behaviour:
- When the width of a node is decreased (by user resize or layout algorithm):
  - Long text that exceeds the available width must wrap onto multiple lines within the node.
  - The node's height must grow as needed to accommodate wrapped lines, subject to spacing presets (Spacious / Normal / Tight).
- This applies to:
  - Endpoint list lines inside Interface.
  - Entity headers and attribute lines.
  - Any other nodes that show text inside a bounded box.

Implementation note:
- The measure() pass for layout must:
  - Compute label dimensions using wrapped text (given the available width).
  - Update node height accordingly based on wrapped line count.

--------------------------------------------------------------------
5. Generic enhancement B – Advanced Add child layout controls

Enhance the Advanced Add dialog footer:

Existing controls:
- Spacing: [Spacious | Normal | Tight]
- Cancel
- Add to Diagram

Update to:

- Spacing: [Spacious | Normal | Tight]
- **Child columns:** [1–10] (numeric dropdown)
- **Child node width:** [10–1000] (numeric input; default reasonable value, e.g. 160)
- Cancel
- Add to Diagram

5.1 Child columns

- Control label: "Child columns"
- Type: numeric dropdown with values 1–10.
- Default: 1.

Meaning:
- For each parent node in the Advanced Add layout:
  - Its immediate children are arranged in a grid with N = child_columns columns.
  - Children are assigned row-by-row:
    - Example: 8 children, child_columns = 2 → 2 columns × 4 rows.
  - The layout algorithm must compute X/Y positions so that children fit within the parent's inner area, using spacing presets and child node width.

5.2 Child node width

- Control label: "Child node width"
- Type: numeric input.
- Allowed range: 10–1000 pixels.
- Default: existing or a new sensible default (e.g. 160).

Meaning:
- The layout algorithm should treat this as the **target width** for child nodes when measuring and placing them:
  - For each child, desired width = max(child_node_width, minimum width from text).
  - Node's measuredWidth must respect this target, subject to content-based minimums.

Interaction with text wrapping:
- Changing child_node_width affects:
  - How much text can fit on each line.
  - How many lines are used (wrapped text).
  - Therefore, node height.

--------------------------------------------------------------------
6. Layout integration and consistency

- The existing recursive layout algorithm (measure + assignPositions) must incorporate:
  - Spacing preset (PADDING_X, PADDING_Y, CHILD_VERTICAL_GAP, etc.).
  - child_columns (grid layout for children).
  - child_node_width (target width for child boxes).
  - Text wrapping effects on label height.

- For the Interface custom layout:
  - Endpoints list + entity boxes inside the Interface must respect these settings for spacing and columns.

--------------------------------------------------------------------
7. Acceptance Criteria

1. Right-click on an Interface in the RHS → "Add with all children":
   - Interface is rendered with:
     - Header name.
     - Endpoint list as numbered text lines with verb + path_or_address + name.
     - ERD-style entity boxes with attributes below.
   - No separate endpoint boxes are drawn in this custom view.

2. In Advanced Add, selecting an Interface and its children and clicking "Add to Diagram" produces the same custom Interface layout as "Add with all children".

3. Reducing the width of a node (e.g., an entity box) causes long text to wrap inside the box, and the box height increases accordingly. No text overflows beyond the node boundary.

4. Advanced Add dialog shows:
   - Spacing dropdown.
   - Child columns (1–10) dropdown.
   - Child node width (10–1000) numeric input.

5. Changing Child columns:
   - Alters how many child boxes are arranged per row inside each parent (e.g. 2 columns instead of 1).

6. Changing Child node width:
   - Changes the width of child boxes in the resulting layout.
   - Wrapped text and node heights respond accordingly.

7. The Interface custom view integrates correctly with existing layout rules, z_index, and interaction behaviour (selection, movement, etc.).

This spec introduces a richer Interface visualisation and more flexible Advanced Add layout controls, leveraging the existing ERD-style entity rendering.
