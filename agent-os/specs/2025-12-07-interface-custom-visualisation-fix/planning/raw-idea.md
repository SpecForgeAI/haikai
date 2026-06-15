Title: Fix Interface Custom Visualisation – Parent Wrapping and Advanced Add Integration

Summary:
The Interface custom visualisation is partially working but has two issues:

1. When "Add with all children" is used, the Interface box does NOT fully wrap its child entity boxes; the entity boxes appear visually outside the Interface border instead of inside it.

2. In Advanced Add…, when a full chain is selected from Application → Component → Service → Interface → Logical Entities → Logical Attributes → Endpoints, the resulting diagram renders the Interface and its children as separate, stacked boxes (standard layout), instead of using the **custom Interface layout** (header, numbered endpoints list, ER-style entities inside the Interface box).

This spec corrects both behaviours so that:
- The Interface node becomes a true parent container that wraps endpoints + entities.
- Advanced Add uses the same custom layout as "Add with all children" whenever the Interface and its children are selected.

--------------------------------------------------------------------
1. Interface box MUST wrap its children in the custom layout

Scope:
- Applies to the existing Interface custom layout introduced earlier:
  - Interface header (name)
  - Endpoints rendered as numbered text lines
  - ER-style entity boxes (entities + attributes) rendered below inside Interface.

Current problem:
- The Interface header + endpoint list are rendered as one box, but the ER-style entity boxes are positioned visually below it and are not enclosed by the Interface's border rectangle.

Required behaviour:
1.1 Parent sizing
- When rendering an Interface with the custom layout:
  - Compute Interface inner content height as:

    `innerHeight = headerHeight + endpointListHeight + entitiesAreaHeight + verticalPadding`

  - The Interface node's overall height MUST be:

    `interfaceHeight = innerHeight + topPadding + bottomPadding`

  - The Interface node's width MUST be at least:
    - The maximum width of:
      - Header text width
      - Endpoint list width
      - Entity boxes area width
    - plus left/right paddings.

1.2 Child placement inside Interface
- Endpoints and entity boxes MUST be placed within the Interface's content area:

  - Interface box defines an inner rectangle:

    - `innerX = interfaceX + paddingX`
    - `innerY = interfaceY + paddingY`

  - Endpoints list is drawn starting at `(innerX, innerY + headerHeight)` and occupies its measured height.

  - Entity boxes are laid out **below** the endpoints area, starting at:

    - `entitiesStartY = innerY + headerHeight + endpointListHeight + sectionGap`

  - All entity boxes' positions MUST be relative to this inner area, so that their borders are fully inside the Interface border.

1.3 Drawing order
- Interface background and border must be drawn first.
- Then header, endpoint text, and entity boxes must be drawn inside it.
- z_index rules still apply as per earlier specs, but visually the entity boxes must never appear outside the Interface border.

Result:
- The Interface rectangle fully wraps its endpoints and entities, producing a single, cohesive composite node, as illustrated by the desired design (Interface header with list, and entities contained within).

--------------------------------------------------------------------
2. Advanced Add MUST use the Interface custom layout when Interface + children are selected

Current problem:
- In Advanced Add…, when the user selects a full chain:
  - Application → Component → Service → Interface → Logical Entities + Attributes → Endpoints
- The resulting diagram renders:
  - Application wrapping Component
  - Component wrapping Service
  - Service wrapping Interface
  - Inside the Interface: Endpoint boxes and Logical Entity boxes as separate normal nodes, not using the custom Interface visualisation.

Required behaviour:
2.1 Detection of "custom Interface" selection in Advanced Add

- In the Advanced Add tree:

  - If an Interface node is selected, and:
    - At least one Endpoint child is selected, OR
    - At least one Logical Entity child is selected (with or without its attributes), OR
    - Both endpoints and entities are selected,

  THEN Advanced Add MUST treat this Interface as a **custom Interface composite node**, not as a plain node with standard child boxes.

2.2 Node creation semantics for Interface in Advanced Add

- When the above condition holds, Advanced Add MUST:

  - Create exactly **one** diagram node for the Interface:
    - `entityType: INTERFACE`
    - `entityId: <interface_id>`
    - With a flag/metadata indicating "custom interface layout enabled".

  - Do NOT create separate diagram nodes for:
    - Endpoints (no endpoint boxes in this layout)
    - Logical Data Attributes (attributes are rows inside entities, as per ER layout)

  - Create diagram nodes for Logical Entities as children inside the Interface, but rendered using the ER-style entity/attributes visual, NOT as generic boxes.

2.3 Rendering parity with "Add with all children"

- The visual result of Advanced Add for an Interface that meets the custom layout condition MUST be identical to using the Interface context menu action:

  - "Add with all children"

Specifically:
- Interface header at the top.
- Endpoints as numbered list lines (1. VERB path - name).
- ER-style entity boxes (with attributes) below the endpoints, all wrapped by the Interface border.
- Application, Component, and Service nodes wrap this Interface composite node according to the existing parent/child layout rules (recursive wrapping from leaf to root).

2.4 Mixed selections and partial children

- If the Interface is selected but **no** endpoints or entities are selected:
  - Advanced Add may still create a plain Interface node (non-custom layout).
- If some endpoints/entities are selected:
  - The custom layout should include only those selected children:
    - Endpoints list only includes selected endpoints.
    - Entity ER boxes only include selected entities and their selected attributes (same semantics as "Add with attributes").

--------------------------------------------------------------------
3. Layout integration

- The existing recursive layout algorithm (measure → assignPositions) must be updated so that:

  - When visiting an Interface node marked with "custom interface layout":
    - It performs the custom measurement and positioning described in Section 1.
    - It treats endpoints as internal text-only children and logical entities as internal ER boxes.
    - It returns a bounding box that includes all of these so that parent containers (Service, Component, Application) can wrap it correctly.

- Parent wrappers (Service, Application Component, Application) must treat the custom Interface node as a single child with its computed width/height, as they do for other child nodes, ensuring the final nested layout (App → Component → Service → Interface-with-custom-layout) matches the intended visualization.

--------------------------------------------------------------------
4. Acceptance Criteria

1. Using the Interface context menu "Add with all children":
   - The Interface box fully wraps:
     - The endpoint list lines.
     - All entity ER boxes.
   - No entity boxes appear visually outside the Interface border.

2. In Advanced Add, when a full chain Application → Component → Service → Interface → Entities+Attributes → Endpoints is selected:
   - The resulting diagram shows:
     - Application wrapping Component.
     - Component wrapping Service.
     - Service wrapping a **custom Interface** node that:
       - Has header + numbered endpoints list.
       - Contains ER-style entity boxes with attributes inside its border.
   - There are no separate endpoint boxes drawn outside this custom Interface container.

3. In Advanced Add, selecting subsets of endpoints/entities for an Interface:
   - Only the selected children appear in the custom layout.
   - Attributes selection still controls which attribute rows appear in the ER boxes.

4. The custom Interface layout is always used when the detection condition in 2.1 is met, and never regresses back to the generic "stacked child boxes" layout.

This completes the Interface custom visualisation so that:
- The Interface properly wraps its endpoint and entity children.
- Advanced Add behaves consistently with the "Add with all children" context action.
