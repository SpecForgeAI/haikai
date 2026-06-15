# Persistent Decorations + Expanded Decoration Palette + Resizable Shapes

## Summary
This update introduces full persistence and expanded functionality for diagram decorations. Decorations (boxes, lines, and new shapes) must now be saved into and restored from the diagram JSON. The left-hand palette is expanded to include multiple new shapes used in flowcharts and architecture diagrams. All decoration shapes become resizable with drag handles, and all of them optionally support text labels.

## Scope
- Diagram JSON persistence (save + load) for all decoration objects.
- Extended decoration palette with new shape types.
- Resizable behaviour for all decorations.
- Optional text labels for all decorations.

## Out of scope
- Decorations remain non-meta-model objects; they do not appear in RHS meta-model tables.
- Decorations do not participate in containment or relationship logic.

---

## 1. Add persistent decoration objects to diagram JSON

The diagram JSON schema MUST be extended to include a "decorations" array:

```javascript
diagram = {
  nodes: [...],          // existing meta-model nodes
  edges: [...],          // existing meta-model edges
  decorations: [         // NEW
    {
      id: string,        // unique per decoration
      type: enum(
        "box",
        "line",
        "oval",
        "diamond",
        "parallelogram",
        "arrow_single",
        "arrow_double",
        "circle",
        "cylinder",
        "trapezoid",
        "hexagon"
      ),
      x: number,
      y: number,
      width: number,     // for shapes that have area
      height: number,    // for shapes that have area
      points: [...]      // for lines/arrows (array of coordinate pairs)
      label: string | null,
      labelPosition: { x, y } | null,  // optional
      style: {
        strokeColor: string,
        fillColor: string,
        strokeWidth: number,
        textColor: string
      }
    }
  ]
}
```

### Requirements
1. Saving a diagram MUST include all decorations in the "decorations" array.
2. Loading a diagram MUST recreate each decoration using the stored geometry + label + style.
3. Decorations must survive save → load → edit → save cycles with no loss of fidelity.

---

## 2. Expand the left-hand decoration palette

Add the following new decoration options to the left-hand palette:

1. Oval (Terminator) → type: "oval"
2. Diamond (Decision) → type: "diamond"
3. Parallelogram (Input/Output) → type: "parallelogram"
4. Arrow (Flowline) → two separate palette items:
   a. Arrow (single head) → type: "arrow_single"
   b. Arrow (double head) → type: "arrow_double"
5. Circle (Connector) → type: "circle"
6. Cylinder (Database/Data Store) → type: "cylinder"
7. Trapezoid (Manual Operation) → type: "trapezoid"
8. Hexagon (Preparation/Initialization) → type: "hexagon"

### Palette Item Behavior
For each palette item:
- Clicking it puts the user into "placement mode".
- User clicks the diagram to place the shape at a default size.
- User may then edit size and/or label.

### Text Label Support
All shapes support an optional text label:
- Clicking a shape allows editing its label using the same mechanism as existing box text labels.
- If no label is entered, the shape remains unlabeled.

---

## 3. Resizable decoration behaviour

All decoration shapes MUST be resizable via drag handles.

### 3.1 When a decoration is selected:
- Show resize handles (small squares or circles) around the edges and corners.
- For line/arrows, show endpoint handles.

### 3.2 Resizing rules by shape type:
- **Area shapes** (box, oval, diamond, parallelogram, circle, cylinder, trapezoid, hexagon):
  - Resizable in both width and height.
  - Maintain shape semantics (e.g., diamond stays diamond-shaped; cylinder maintains top-ellipse aspect; hexagon angles preserved).
  - Real-time visual update during dragging.
- **Lines and arrows**:
  - Have draggable endpoints.
  - Arrowheads are repositioned dynamically according to new endpoints.
  - For arrow_double, arrowheads appear on both ends.

### 3.3 After resizing:
- Save updated geometry into the decoration object's width, height, x, y, or points[] fields.
- Persist this updated state into JSON on diagram save.

---

## 4. Interaction rules

1. Decorations never appear in the RHS meta-model sections.
2. Decorations do NOT participate in containment or relationship logic.
3. Decorations always render above the diagram background and below selection outlines.
4. Decorations must not interfere with selection of meta-model nodes.

---

## 5. Acceptance criteria

1. Saving a diagram containing decorations and reloading it later restores every decoration with identical position, size, shape, text, and style.
2. Each new shape type is available in the left-side decoration palette and behaves consistently with existing box/line placement.
3. Every decoration shape can be resized using visible resize handles.
4. Arrow and line decorations can be reshaped by dragging endpoints.
5. Optional text labels work for every decoration and persist across save/load.
6. No decoration disappears or loses geometry after any save/load cycle.

---

This completes the specification for persistent, fully resizable, multi-shape diagram decorations.
