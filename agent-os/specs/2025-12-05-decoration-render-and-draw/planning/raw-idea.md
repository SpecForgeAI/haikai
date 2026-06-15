Title: Decorations – render on load and enable drawing of new shapes/arrows

Summary:
Decorations are now saved correctly into the diagram JSON and the new decoration types appear in the left-hand palette, but two issues remain:
1) Decorations stored in JSON are **not re-drawn** on the canvas when a diagram is loaded.
2) The new decoration types (oval, diamond, parallelogram, circle, cylinder, trapezoid, hexagon, arrow, double arrow) appear in the palette but **do not create shapes** when the user click-drags on the canvas (only a temporary dashed selection box appears).

This update fixes both issues by:
- Ensuring decorations from JSON are instantiated and rendered on load.
- Making all decoration tools behave like the existing Box/Line tools: click in palette, then click-drag on canvas to create the corresponding decoration object with correct geometry.

Scope:
- Diagram load/render pipeline for decorations.
- Decoration drawing interaction for new shape/arrow types.
- No changes to the decoration JSON schema itself (reuse existing fields).

Out of scope:
- Changes to decoration styling, resize behaviour, or text editing (those are already defined).
- Any meta-model nodes/edges behaviour.

--------------------------------------------------------------------
1. Render decorations from JSON on load

Current behaviour:
- On file load, meta-model nodes and edges are re-created, but decoration entries in JSON are ignored for rendering.

Required behaviour:
- The diagram load routine MUST:
  - Parse the `decorations` array from the JSON.
  - For each decoration object, instantiate the correct drawing primitive and add it to the canvas.

Assume existing decoration JSON shape (as per earlier spec):

decorations: [
  {
    id: string,
    type: "box" | "line" | "oval" | "diamond" | "parallelogram" | "arrow_single" | "arrow_double" | "circle" | "cylinder" | "trapezoid" | "hexagon",
    x: number,
    y: number,
    width: number,
    height: number,
    points: [ ... ],        // for lines/arrows
    label: string | null,
    labelPosition: { x, y } | null,
    style: { ... }
  },
  ...
]

### 1.1 Load-time instantiation

For each decoration in JSON:

- Determine the drawing primitive based on `type`:
  - "box" → rectangle
  - "oval" → ellipse/rounded shape
  - "diamond" → rhombus
  - "parallelogram" → slanted rectangle
  - "circle" → circle (width/height may be unified)
  - "cylinder" → database symbol
  - "trapezoid" → trapezoid
  - "hexagon" → hexagon
  - "line" → straight line from `points` or from `(x,y)` with `width`
  - "arrow_single" / "arrow_double" → line segments with appropriate arrowheads

- Create the decoration on the canvas with:
  - Geometry:
    - Area shapes: use `x`, `y`, `width`, `height`
    - Lines/arrows: use `points` or equivalent
  - Style: from `style` fields (stroke, fill, etc.).
  - Label: use `label` and `labelPosition` if present.

### 1.2 Selection and editing

- Loaded decorations must behave identically to decorations created in the current session:
  - Selectable.
  - Resizable (for shapes).
  - Drag endpoints (for lines/arrows).
  - Label editable.
  - Position/size editable via top POSITION bar, where applicable.
  - Z-index and auto_size controllable via context menu per earlier specs.

--------------------------------------------------------------------
2. Enable drawing of new decoration shapes/arrows (click-drag behaviour)

Current behaviour:
- Palette shows all shapes and line/arrow tools.
- Box and Line tools work:
  - Select tool → click-drag on canvas → corresponding decoration created.
- New shapes (oval, diamond, parallelogram, circle, cylinder, trapezoid, hexagon) and arrow tools:
  - Tool can be selected.
  - Click-drag on canvas shows only a temporary dashed selection rectangle.
  - No decoration is created when mouse is released.

Required behaviour:
- All decoration tools must support the same **click-drag to create** interaction as Box and Line.

### 2.1 Unified decoration drawing interaction

When a decoration tool is active:

1. User clicks on a decoration type in the left panel (e.g. Oval, Diamond, Arrow).
2. Cursor changes to the drawing mode for that tool.
3. User presses mouse down on the canvas (start point).
4. User drags to a second point (current position).
5. While dragging, show a live preview of the shape:
   - For area shapes, preview the shape's outline based on start/end rectangle.
   - For lines/arrows, preview the line between start and current point with arrowheads where applicable.
6. On mouse up:
   - Create a new decoration object in memory and in the diagram state.
   - Persist it with an `id`, `type`, and geometry:
     - Area shapes: `x`, `y`, `width`, `height` based on the bounding rectangle formed by start and end.
     - Lines/arrows: `points` or equivalent, with arrow_head property derived from tool type.
   - Render the new decoration as a normal, selectable decoration.

### 2.2 Shape-specific geometry rules

- Box / Parallelogram / Trapezoid / Hexagon / Cylinder:
  - Use the bounding rectangle defined by drag start/end.
  - Handle drag in any direction (top-left ↔ bottom-right, etc.) by normalizing coordinates.

- Oval:
  - Draw an ellipse within the bounding rectangle.

- Circle:
  - Use the minimal dimension of width/height to maintain a circle, center within the drag rectangle.

- Diamond:
  - Draw a rhombus inscribed in the bounding rectangle.

- Line:
  - Store start and end points directly.

- Arrow:
  - Arrow (single) = line with arrow head at end.
  - Double Arrow = arrow heads at both ends.
  - Geometry still stored via `points` (e.g., [startX, startY, endX, endY]) and an internal flag for head(s).

### 2.3 Consistency with existing tools

- For Box and Line, existing behaviour is preserved; implementation may be refactored to share a common path with new shapes.
- The dashed selection box that currently appears when drawing new shapes must be replaced by the correct live preview and final decoration creation.

### 2.4 Default size on click-only (optional)

If the user simply clicks (without significant drag) while a decoration tool is active:
- Optionally create a decoration with a default size centered at the click position.
- This is consistent with Box/Line behaviour if already supported.

--------------------------------------------------------------------
3. Acceptance criteria

1. Save a diagram containing various decorations (existing and new types). Reload the JSON:
   - All decorations reappear on the canvas in their correct positions, sizes, shapes, styles, and with labels intact.
   - Decorations behave identically to those created in the same session (select, move, resize, context menu, etc.).

2. For each decoration tool in the left-hand panel (Box, Oval, Diamond, Parallelogram, Circle, Cylinder, Trapezoid, Hexagon, Line, Arrow, Double Arrow):
   - Select tool → click-drag on canvas → a new decoration is created and rendered using the expected shape and arrowhead configuration.
   - The temporary dashed-selection-only behaviour is removed for these tools.

3. Resizing and editing:
   - Newly created decorations can be resized, repositioned, and labeled as per existing decoration behaviour.
   - Their updated geometry and label are correctly persisted on subsequent saves/loads.

This spec ensures that decorations both persist across file loads and that all new decoration tools are fully usable for drawing on the canvas.
