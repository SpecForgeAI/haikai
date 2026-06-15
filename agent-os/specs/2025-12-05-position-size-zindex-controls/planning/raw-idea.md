Title: Direct Editing of Position/Size Fields + Auto-Size Toggle + Z-Index Controls for Nodes, Edges, and Decorations

Summary:
This change introduces two new mechanisms for editing diagram element properties that already exist in JSON but were not directly user-editable:

1. **Top Bar POSITION Controls** (X, Y, W, H)
   - Allow precise numeric editing of position and size when a single box-like element is selected.
   - Automatically update the underlying JSON values (`pos_x`, `pos_y`, `width`, `height`) as the user types.

2. **Right-Click Context Menu Controls**
   - Allow toggling `auto_size` (for nodes and non-line decorations only).
   - Allow controlling `z_index` stack ordering with "forward", "backward", "to front", and "to back" actions.

This applies to:
- Meta-model diagram nodes
- Decoration shapes
- Node edges (relationships)
- Decorative lines/arrows

Behaviour varies slightly per type.

--------------------------------------------------------------------
1. Top Bar POSITION Controls (X, Y, W, H)

Add a new POSITION group to the top toolbar:

> FONT SIZE | FONT STYLES | BOX ALIGNMENT | COLOUR | **POSITION**

Inside POSITION show four numeric fields:

- `X: [____]`  → maps to `pos_x`
- `Y: [____]`  → maps to `pos_y`
- `W: [____]`  → maps to `width`
- `H: [____]`  → maps to `height`

Each field has:
- Maximum of 4 digits
- Numeric-only input
- On edit → updates the underlying JSON immediately
- On change → diagram re-renders the element at the new size/position

### 1.1 Enable/Disable Logic

POSITION controls are **enabled only when:**
- Exactly **one** element is selected, AND
- The selected element is a **node** (meta-model node) or **non-line decoration shape** (box, oval, diamond, etc.)

POSITION controls are **disabled** when:
- No element is selected
- More than one element is selected
- A **line or arrow** (node_edge or decorative line) is selected
  - Lines/arrows are resized by dragging endpoints, not numeric width/height

--------------------------------------------------------------------
2. Context Menu (Right-Click) Controls

Right-clicking elements opens a context menu whose options depend on the element type.

### 2.1 Nodes & Non-Line Decoration Shapes
(Applies to Applications, Components, Services, Business Processes, etc., and decoration shapes like boxes, ovals, diamonds, cylinders, hexagons, trapezoids, parallelograms, circles.)

Context menu MUST show **5 items**:

1. **Enable Auto-Size** / **Disable Auto-Size**
   - Toggle based on current `auto_size` value in JSON.
   - If `auto_size = false` → show "Enable Auto-Size"
   - If `auto_size = true`  → show "Disable Auto-Size"
   - Updating this value immediately applies the auto-size rule.

2. **Bring forward**
   - `z_index = z_index + 1`

3. **Bring to front**
   - `z_index = (max z_index among ALL nodes, edges, decorations) + 1`

4. **Bring backward**
   - `z_index = z_index - 1`

5. **Bring to back**
   - `z_index = (min z_index among ALL nodes, edges, decorations) - 1`

These 5 items apply to all box-like elements (meta-model nodes + non-line decorations).

### 2.2 Node Edges & Line/Arrow Decorations

This category includes:
- Relationship edges between meta-model nodes
- Decorative arrows (single and double head)
- Decorative lines

Context menu MUST show **only 4 items** (no auto-size):

1. **Bring forward**
2. **Bring to front**
3. **Bring backward**
4. **Bring to back**

Line/arrow elements:
- Do not have an auto-size concept
- Are controlled via endpoints rather than numeric X/Y/W/H
- Therefore top bar POSITION is disabled for them

--------------------------------------------------------------------
3. JSON Updates

The following fields are directly editable by these UI mechanisms:

- `pos_x` (updated via X field)
- `pos_y` (updated via Y field)
- `width` (updated via W field)
- `height` (updated via H field)
- `auto_size` (updated via context menu toggle)
- `z_index` (updated via context menu ordering operations)

These must be immediately written into the diagram JSON structure, and preserved across save/load.

--------------------------------------------------------------------
4. Acceptance Criteria

1. Selecting a node or non-line decoration shape enables the POSITION controls; selecting a line/arrow or multiple elements disables them.
2. Changing X/Y/W/H in the top bar immediately updates the element's JSON and re-renders it in the new position/size.
3. Right-clicking nodes and shape decorations shows 5 context menu items including the auto-size toggle.
4. Right-clicking edges or line/arrow decorations shows only 4 z-index items.
5. Z-index changes correctly adjust draw order across all diagram elements.
6. Auto-size toggling updates `auto_size` in JSON and applies the expected resizing behaviour for that shape.
7. All changes persist correctly when the diagram is saved and reloaded.

This completes the specification for editable position/size, auto-size toggling, and z-index control across all diagram elements.
