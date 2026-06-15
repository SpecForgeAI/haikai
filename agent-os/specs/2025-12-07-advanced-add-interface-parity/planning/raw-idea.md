Title: Make Advanced Add use Interface custom visualisation (same as "Add with all children")

Summary:
The Interface custom visualisation works correctly when the user chooses **"Add with all children"** from the Interface context menu, but NOT when using **Advanced Add…**. In Advanced Add, selecting an Application → Component → Service → Interface → Logical Entities + Attributes + Endpoints still produces the generic stacked child boxes instead of the custom Interface layout.

This spec fixes Advanced Add so that whenever an Interface and its children are selected, the diagram produced is **identical** to "Add with all children".

------------------------------------------------------------
1. Current behaviour vs desired behaviour

Current:
- Context menu "Add with all children" on an Interface:
  - Produces the correct custom layout:
    - Interface box wraps:
      - Header (Interface name)
      - Endpoints as numbered lines
      - ER-style entity boxes (with attributes) inside the Interface.

- Advanced Add:
  - When a full chain is selected (Application → Component → Service → Interface → Entities + Attributes + Endpoints):
    - Creates separate nodes for:
      - Interface
      - Endpoint boxes
      - Logical Entity boxes
    - Lays them out as generic stacked children, not as the custom Interface composite.

Desired:
- Advanced Add MUST call the **same code path** as "Add with all children" for the Interface part, so both paths yield exactly the same visual result.

------------------------------------------------------------
2. Refactor: single helper for Interface composite creation

Introduce or enforce a **single helper function** (name illustrative):

- `buildInterfaceCompositeNode(interfaceId, selectedChildIds, options)`

Responsibilities:
- Given:
  - An Interface id
  - The set of selected children for that Interface:
    - Selected endpoint ids
    - Selected logical entity ids and their selected attributes
  - Layout options (spacing, child columns, child width)
- It MUST:
  - Create exactly **one** diagram node for the Interface:
    - With metadata indicating "custom interface layout enabled"
    - Including:
      - A list of endpoint ids to render in the text list
      - A list of logical entity ids and attribute ids to render as ER boxes
  - NOT create separate diagram nodes for endpoints or attributes.
  - Return the Interface composite node with its measured width/height.

"Add with all children" MUST call this helper.
**Advanced Add MUST also call this helper** when the Interface qualifies for custom layout (see Section 3).

------------------------------------------------------------
3. Advanced Add: detection of custom Interface case

Update the Advanced Add logic so that before creating diagram nodes it:

1. Walks the selection tree per Interface.
2. For each Interface node:
   - If the Interface itself is selected AND
   - At least one of the following is selected under it:
     - One or more Endpoints
     - One or more Logical Entities (with or without attributes)

   THEN:
   - Treat this Interface as a "custom interface composite".
   - Do NOT create plain child nodes for its endpoints or entities.
   - Instead, call `buildInterfaceCompositeNode(...)` with:
     - interfaceId = this Interface's id
     - selectedChildIds = the selected endpoints + selected entities + selected attributes.
   - Insert the returned composite Interface node into the diagram's node list as the **only** node representing that Interface and its contract.

3. For Interfaces where:
   - The Interface is selected but **no** endpoints or entities are selected,
   - Keep existing behaviour (plain Interface node, no custom layout).

------------------------------------------------------------
4. Node creation rules for Advanced Add

When processing the full Application chain in Advanced Add:

- Application / Application Component / Service:
  - Continue to be created as standard wrapper nodes, per existing recursive layout.

- Interface:
  - If it meets the custom case (Section 3):
    - Create only the composite Interface node from `buildInterfaceCompositeNode`.
    - Do not separately add:
      - Endpoint nodes
      - Logical entity nodes
      - Attribute nodes
  - If not, fall back to the generic behaviour.

- The parent wrapper logic (Service wrapping Interface, Component wrapping Service, Application wrapping Component) MUST treat the composite Interface node as a single child with its measured width/height.

------------------------------------------------------------
5. Layout behaviour

The composite Interface node returned from `buildInterfaceCompositeNode` must:

- Compute its own internal layout:
  - Header
  - Endpoint text list
  - ER-style entity boxes and their attributes
- Return its final width/height to the generic layout engine.
- When Advanced Add positions children inside Service/Component/Application, it must respect these dimensions so that the nesting:

  My App → My Component → My Svc → My API (custom composite)

  matches exactly what "Add with all children" currently produces.

------------------------------------------------------------
6. JSON / persistence behaviour

- The diagram JSON produced from Advanced Add MUST match the JSON produced by "Add with all children" for the Interface portion:
  - Exactly one node for the Interface with metadata describing:
    - endpoints used
    - entities used
    - attributes used
  - No separate endpoint or attribute nodes.

- This ensures that:
  - Load/save cycles behave the same regardless of whether the diagram was built via "Add with all children" or Advanced Add.

------------------------------------------------------------
7. Acceptance criteria

AC1 – "Add with all children" unchanged:
- Existing context menu behaviour for Interface remains as-is (still correct).

AC2 – Advanced Add full chain:
- When a full chain Application → Component → Service → Interface → Entities + Attributes + Endpoints is selected:
  - The final diagram shows:
    - Application wrapping Component
    - Component wrapping Service
    - Service wrapping a **custom Interface node** that:
      - Has header + numbered endpoints list
      - Contains ER-style entity boxes with attributes inside its border.
  - There are no separate endpoint boxes or separate logical entity boxes outside the Interface.

AC3 – Visual parity:
- Capturing the same selection via "Add with all children" and via Advanced Add produces **identical** Interface JSON and visually indistinguishable diagrams.

AC4 – Partial selection:
- If only the Interface and some of its endpoints/entities are selected in Advanced Add:
  - The custom Interface layout includes only the selected children.
  - No unexpected plain child boxes are created.

This spec ensures that Advanced Add truly reuses the Interface custom visualisation and no longer diverges from "Add with all children".
