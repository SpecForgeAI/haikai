# Fix Advanced Add parent wrapping for custom Interface composite (Application → Component → Service → Interface)

## Summary

After the latest changes:
1. The Interface custom layout (header + endpoints list + ER-style entities) renders correctly.
2. Advanced Add correctly includes Application, Component, and Service in the hierarchy.

However:
- The Application, Component, and Service boxes do NOT resize to wrap the custom Interface composite.
- Their heights remain at minimal/default sizes, so the Interface appears visually outside or much larger than its ancestors.

We must update the layout measurement logic so that parent nodes (Service, Component, Application) always size themselves based on the **actual measured dimensions** of their children, including custom composite nodes, using the existing spacing presets (Spacious / Normal / Tight).

------------------------------------------------------------

## 1. Problem statement (precise)

Current Advanced Add flow:

- Nodes are created for:
  - Application (root)
  - Application Component (child of Application)
  - Service (child of Component)
  - Interface (child of Service, with custom composite layout)
- The Interface composite node correctly computes its own width and height, based on:
  - Header
  - Endpoints list
  - Entity ER boxes

But:

- The layout algorithm that sizes the parent wrappers (Service, Component, Application) does NOT use the composite Interface's measured size.
- Instead, it uses:
  - A fixed/minimum node size, or
  - A pre-composite size, or
  - Ignores the composite child when computing the parent bounding box.

Result:
- Parent nodes are too small and do not visually wrap their child Interface composite.

------------------------------------------------------------

## 2. Canonical parent sizing rules (what MUST happen)

For any parent node P with a set of children C = {c1, c2, …, cn}, **regardless** of how the children were created (plain nodes or composites):

- Let `PADDING_X`, `PADDING_Y`, `CHILD_VERTICAL_GAP` come from the Spacing preset (Spacious / Normal / Tight).
- Each child ci has a final measured size: `width_i`, `height_i`.

The parent width MUST be:

- `parentWidth = max(width_i for all i) + 2 * PADDING_X`,
  with optional enforcement of a minimum width based on label text.

The parent height MUST be:

- For vertically stacked children:
  - `childrenHeight = sum(height_i for all i) + (n - 1) * CHILD_VERTICAL_GAP`
  - `parentHeight = childrenHeight + 2 * PADDING_Y`

These rules must apply to:
- Service wrapping Interface
- Application Component wrapping Service
- Application wrapping Application Component

No special cases: the Interface composite is just "another child" with a larger width/height.

------------------------------------------------------------

## 3. Ensure the composite Interface node is used in parent measurement

Update the Advanced Add node-building logic so that:

- When the Interface qualifies for the custom composite layout, and `buildInterfaceCompositeNode(...)` is called:
  - The **resulting composite node instance** is attached as the SINGLE child of Service in the tree structure used by the layout engine:
    - `service.children = [interfaceCompositeNode]`
  - That Service node instance is then attached to Component:
    - `component.children = [serviceNode]`
  - That Component node instance is attached to Application:
    - `application.children = [componentNode]`

The key point:
- The same node instances used for rendering MUST be the ones passed into the recursive measure/assignPositions algorithm.
- There MUST NOT be a separate "shadow" node or stale copy of Interface used for Service measurement.

------------------------------------------------------------

## 4. Layout algorithm behaviour (measure + assignPositions)

We already have a recursive layout algorithm (measure + assignPositions). We must enforce the following invariants:

### 4.1 Measure phase:

- For each node N:
  - If N has **no children**:
    - Measure its size from:
      - Label/text
      - Min width/height rules (Spacious/Normal/Tight presets).
  - If N has children:
    - Recursively `measure(child)` for each child.
    - Compute N's width/height using the canonical rules in Section 2, based on the children's measured sizes.
    - For nodes with custom internal layout (Interface composite), the node's own measure logic sets its width/height before parent computation.

Specifically for Service, Component, Application:
- They MUST **not** override `height` with a hard-coded minimum once children are present.
- Instead, they must honour the computed `childrenHeight + padding`, even when there is only 1 child (the Interface composite).

### 4.2 Position phase (assignPositions):

- For a parent node P with children stacked vertically:
  - Starting at `innerY = P.y + PADDING_Y`,
  - Each child ci is positioned at:
    - `ci.x = P.x + PADDING_X + (parentWidth - 2 * PADDING_X - width_i) / 2` (centered horizontally)
    - `ci.y = currentY`
  - `currentY` is incremented by `height_i + CHILD_VERTICAL_GAP` for each child.

This logic already exists; ensure **it is being used for Service, Component, and Application when built via Advanced Add** with the composite Interface as a child.

------------------------------------------------------------

## 5. Specific fix for Advanced Add hierarchy

In the Advanced Add implementation:

- After constructing the Application → Component → Service → Interface tree:
  - Ensure a single call:

    `measure(applicationNode, spacingPreset, childColumns, childWidth)`

  - Then:

    `assignPositions(applicationNode, originX, originY)`

- Do not skip or short-circuit measurement for:
  - Service
  - Component
  - Application

Because the Interface composite has a larger height and width, these measurements propagate upward:

- Application.height >= Component.height + 2 * PADDING_Y
- Component.height >= Service.height + 2 * PADDING_Y
- Service.height >= InterfaceComposite.height + 2 * PADDING_Y

------------------------------------------------------------

## 6. Acceptance criteria

**AC1 – Custom Interface (Add with all children) remains correct:**
- Interface box continues to wrap endpoints list and entity ER boxes correctly.

**AC2 – Advanced Add full chain wraps correctly:**
- With Application → Component → Service → Interface → Entities + Attributes + Endpoints selected in Advanced Add:
  - The resulting diagram shows:
    - Application wrapping Component.
    - Component wrapping Service.
    - Service wrapping the **custom Interface composite**.
  - All parent boxes are **taller and wider than the Interface** according to the spacing preset (Spacious / Normal / Tight).
  - No parent node appears smaller than its child Interface composite.

**AC3 – Spacing presets respected:**
- Switching Spacing between Tight / Normal / Spacious in Advanced Add affects:
  - Vertical padding between parent border and children.
  - Vertical gap between Interface composite and any siblings (if present).
  - The Application/Component/Service boxes expand/contract accordingly.

**AC4 – JSON representation:**
- The diagram JSON produced by Advanced Add contains:
  - One node for Application, one for Component, one for Service, one for Interface composite.
  - Each parent's width/height reflects the layout computed during measurement.
  - No extra "placeholder" or zero-sized nodes.

This spec ensures that the parent wrapper nodes in Advanced Add correctly wrap the custom Interface composite, producing the same intuitive nesting you see in other wrapped layouts (e.g., Application wrapping Components) and bringing Advanced Add fully in line with the intended visual behaviour.
