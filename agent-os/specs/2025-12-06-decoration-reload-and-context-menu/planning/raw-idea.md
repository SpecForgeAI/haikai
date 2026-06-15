Title: Fix Decoration Reload Rendering and Override Browser Context Menu for Node Actions

Summary:
Two previously specified behaviours are still not working as intended:

1) Decorations are correctly saved into the JSON but are **not re-rendered** onto the canvas when a diagram is loaded.
2) Right-clicking a selected node still shows the **browser's default context menu**, instead of the tool's custom context menu with 5 options (auto_size toggle + 4 z-index actions).

This spec clarifies and tightens the required behaviour for both issues.

--------------------------------------------------------------------
1. Decorations: MUST be rendered on load

Current state:
- On save, decorations are serialized correctly into the `decorations` array in the diagram JSON.
- On load, nodes and edges are reconstructed and rendered.
- Decorations from the JSON are **not** instantiated or drawn, so they remain invisible after reload.

Required behaviour:
- The diagram load routine MUST:
  1. Read the `decorations` array from the JSON.
  2. For each decoration, create the corresponding in-memory decoration object.
  3. Render each decoration onto the canvas using its stored geometry and style.
  4. Ensure the decoration is fully interactive (selectable, resizable, context-menu enabled per previous specs).

Assume a decoration JSON shape along these lines:

decorations: [
  {
    "id": "dec-1",
    "type": "box" | "line" | "oval" | "diamond" | "parallelogram" | "arrow_single" | "arrow_double" | "circle" | "cylinder" | "trapezoid" | "hexagon",
    "x": 100,
    "y": 120,
    "width": 160,
    "height": 80,
    "points": [ ... ], // for lines/arrows
    "label": "Some text",
    "labelPosition": { "x": 120, "y": 140 },
    "style": {
      "strokeColor": "...",
      "fillColor": "...",
      "strokeWidth": 1,
      "textColor": "..."
    },
    "z_index": 5,
    "auto_size": false
  },
  ...
]

Specific requirements:

1.1 Load-time instantiation
- After nodes and edges are loaded, the loader MUST:
  - Iterate over `diagram.decorations`.
  - For each entry, call the appropriate factory / constructor to create a decoration object representing:
    - The correct shape according to `type`.
    - Geometry:
      - Area shapes: use `x`, `y`, `width`, `height`.
      - Lines/arrows: use `points` (or derive from `x`, `y`, `width`, `height` if that's the canonical format).
    - Style: apply `style` fields.
    - z-index: assign `z_index` so the drawing order matches saved state.

1.2 Integration into selection & editing
- Loaded decorations must behave identically to newly created ones:
  - Can be selected (click).
  - Show resize handles if shape, endpoint handles if line/arrow.
  - Respond to drag-move and resize.
  - Show the correct context menu on right-click (per earlier specs).
  - X/Y/W/H fields in the top toolbar enabled/disabled as per type.

1.3 No missing decoration after load
- Acceptance: After saving a diagram with decorations, then reloading:
  - Every decoration present before save must appear after load in the same position, size, and style.
  - There must be no decoration that exists in JSON but is missing on the canvas.

--------------------------------------------------------------------
2. Custom context menu MUST replace browser menu on right-click

Current state:
- Right-clicking on a diagram node still shows the **browser's default** context menu.
- Our tool's custom context menu for auto_size and z_index is not shown.

Required behaviour:
- When right-clicking on a selectable diagram element (nodes, edges, or decorations), the **tool's context menu** MUST be shown and the browser's default menu MUST be suppressed.

2.1 Global event handling for right-click

Implementation requirements:
- On the canvas (or the specific drawing layer that receives diagram events), the tool MUST:
  - Listen for the `contextmenu` event.
  - Call `event.preventDefault()` and `event.stopPropagation()` when the event is on:
    - A node
    - An edge
    - A decoration (shape or line/arrow)
  - Show the **custom** context menu at the mouse position, anchored to the element under the cursor.

2.2 Context menu content for different element types

For **nodes and non-line decoration shapes**:
- Right-click must show **5 menu items**:
  1. Enable Auto-Size / Disable Auto-Size
     - Text toggles depending on current `auto_size`:
       - `auto_size = false` → "Enable Auto-Size"
       - `auto_size = true`  → "Disable Auto-Size"
  2. Bring forward  → `z_index = z_index + 1`
  3. Bring to front → `z_index = (max z_index across all nodes, edges, decorations) + 1`
  4. Bring backward → `z_index = z_index - 1`
  5. Bring to back  → `z_index = (min z_index across all nodes, edges, decorations) - 1`

For **edges and line/arrow decorations**:
- Right-click must show **4 menu items**:
  1. Bring forward
  2. Bring to front
  3. Bring backward
  4. Bring to back
- No auto_size entry should appear for these.

2.3 Behaviour when nothing is under cursor
- When right-clicking:
  - If not on any selectable element, either:
    - Show a canvas-level context menu (if defined), OR
    - Show nothing.
  - In either case, still **suppress the browser default menu** over the canvas area.

2.4 Selection consistency
- Right-clicking on an element must:
  - Optionally select that element if it is not already selected.
  - The context menu's actions must apply to the element under the cursor (or the current selection if that is the design).

--------------------------------------------------------------------
3. Acceptance criteria

1. Save a diagram with decorations, reload it:
   - All saved decorations appear on the canvas at the correct positions and sizes.
   - Decorations can be selected and edited exactly as before save.

2. Right-click on:
   - A meta-model node → browser menu does not appear; the 5-item custom node menu does.
   - A shape decoration → browser menu does not appear; the 5-item custom node menu does.
   - A line/arrow (edge or decoration) → browser menu does not appear; the 4-item z-index menu does.

3. All context menu actions correctly update `auto_size` and `z_index` in the underlying JSON and update the rendering.

4. No regression:
   - Left-click selection and drag still work as before.
   - Non-diagram areas (e.g., outside canvas) still show the browser's normal context menu.

This spec ensures decorations are fully restored on load and that our custom context menu is consistently used for diagram interactions instead of the browser's default.
