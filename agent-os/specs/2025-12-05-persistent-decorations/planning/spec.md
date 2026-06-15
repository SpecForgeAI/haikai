# Persistent Decorations + Expanded Decoration Palette + Resizable Shapes

## Overview

This specification extends the diagram decoration system with:
1. Full persistence of decorations in diagram JSON (already partially implemented)
2. Expanded decoration palette with new flowchart and architecture shapes
3. Resizable behaviour for all decoration types via drag handles
4. Optional text labels for all decoration types

## Current State Analysis

### Existing Implementation

The codebase already has a decoration system with:

1. **Type Definitions** (`frontend/src/types/model.ts`):
   - `BoxDecoration` - Rectangle with position, size, text, and styling
   - `LineDecoration` - Polyline with points, optional arrows, and label
   - `Decoration = BoxDecoration | LineDecoration` union type
   - `Diagram.decorations?: Decoration[]` - Already in schema

2. **Utility Functions** (`frontend/src/utils/decorationUtils.ts`):
   - `createDefaultBoxDecoration()` / `createDefaultLineDecoration()` - Factory functions
   - `isPointInsideBoxDecoration()` / `isPointNearLineDecoration()` - Hit testing
   - `getBoxHandlePositions()` - Returns 8 resize handle positions for boxes
   - `calculateMidSegmentPositions()` - For line bend point insertion

3. **UI Components**:
   - `InspectorPanel.tsx` - Left panel with "Add Box" and "Add Line" buttons
   - `DecorationsPanel.tsx` - Bottom panel (currently placeholder, decoration tools moved to left panel)

4. **Persistence**: The `Diagram` interface already includes `decorations?: Decoration[]`, so persistence is partially implemented. Need to verify save/load works correctly.

### Current Limitations

1. **Limited Shape Types**: Only BOX and LINE types exist
2. **No Visual Resize Handles**: `getBoxHandlePositions()` exists but no visible resize UI
3. **Line Endpoint Resizing**: No UI for dragging line endpoints
4. **Persistence**: Need to verify decorations persist correctly through save/load cycles

---

## Specification

### 1. Expand Decoration Type System

#### 1.1 New DecorationType Enum

Extend the decoration type to include new shapes:

```typescript
// New decoration types (in model.ts)
export type DecorationType =
  | 'BOX'           // Existing - rectangle
  | 'LINE'          // Existing - polyline
  | 'OVAL'          // New - ellipse/oval (terminator)
  | 'DIAMOND'       // New - rhombus (decision)
  | 'PARALLELOGRAM' // New - slanted rectangle (input/output)
  | 'ARROW_SINGLE'  // New - line with single arrowhead
  | 'ARROW_DOUBLE'  // New - line with arrowheads on both ends
  | 'CIRCLE'        // New - perfect circle (connector)
  | 'CYLINDER'      // New - database/data store shape
  | 'TRAPEZOID'     // New - manual operation shape
  | 'HEXAGON';      // New - preparation/initialization shape
```

#### 1.2 Shape Decoration Interface

Create a unified interface for area-based shapes:

```typescript
// Base for all area-based shapes (extends DecorationBase)
export interface ShapeDecoration extends DecorationBase {
  type: 'BOX' | 'OVAL' | 'DIAMOND' | 'PARALLELOGRAM' | 'CIRCLE' | 'CYLINDER' | 'TRAPEZOID' | 'HEXAGON';
  pos_x: number;
  pos_y: number;
  width: number;
  height: number;
  text_h_align?: DecorationHAlign;
  text_v_align?: DecorationVAlign;
  background_color?: string;
}

// Line-based decorations (LINE, ARROW_SINGLE, ARROW_DOUBLE)
export interface LineDecoration extends DecorationBase {
  type: 'LINE' | 'ARROW_SINGLE' | 'ARROW_DOUBLE';
  line_points: Array<{ x: number; y: number }>;
  label_pos_x?: number;
  label_pos_y?: number;
  arrow_start?: ArrowType;
  arrow_end?: ArrowType;
}

// Updated union type
export type Decoration = ShapeDecoration | LineDecoration;
```

#### 1.3 Type Guards

Add type guards for the new shape categories:

```typescript
// Check if decoration is an area-based shape
export function isShapeDecoration(d: Decoration): d is ShapeDecoration {
  return ['BOX', 'OVAL', 'DIAMOND', 'PARALLELOGRAM', 'CIRCLE', 'CYLINDER', 'TRAPEZOID', 'HEXAGON'].includes(d.type);
}

// Check if decoration is a line-based shape
export function isLineBasedDecoration(d: Decoration): d is LineDecoration {
  return ['LINE', 'ARROW_SINGLE', 'ARROW_DOUBLE'].includes(d.type);
}
```

---

### 2. Expand Decoration Palette UI

#### 2.1 Updated InspectorPanel Layout

The left panel (`InspectorPanel.tsx`) should display all decoration options:

```
┌─────────────────────────────┐
│ << Decorations              │
├─────────────────────────────┤
│ Add Decorations             │
│ ┌─────┐ ┌─────┐ ┌─────┐    │
│ │ Box │ │Oval │ │Diam │    │
│ └─────┘ └─────┘ └─────┘    │
│ ┌─────┐ ┌─────┐ ┌─────┐    │
│ │Para │ │Circ │ │Cyl  │    │
│ └─────┘ └─────┘ └─────┘    │
│ ┌─────┐ ┌─────┐            │
│ │Trap │ │Hex  │            │
│ └─────┘ └─────┘            │
│ Lines & Arrows             │
│ ┌─────┐ ┌─────┐ ┌─────┐    │
│ │Line │ │Arr→ │ │←Arr→│    │
│ └─────┘ └─────┘ └─────┘    │
├─────────────────────────────┤
│ Decoration Text             │
│ ┌─────────────────────────┐ │
│ │ [textarea]              │ │
│ └─────────────────────────┘ │
└─────────────────────────────┘
```

#### 2.2 Palette Button Data Structure

```typescript
interface DecorationPaletteItem {
  type: DecorationType;
  label: string;
  icon: ReactNode; // SVG icon
  tooltip: string;
}

const SHAPE_PALETTE_ITEMS: DecorationPaletteItem[] = [
  { type: 'BOX', label: 'Box', icon: <BoxIcon />, tooltip: 'Rectangle shape' },
  { type: 'OVAL', label: 'Oval', icon: <OvalIcon />, tooltip: 'Oval/Ellipse (Terminator)' },
  { type: 'DIAMOND', label: 'Diamond', icon: <DiamondIcon />, tooltip: 'Diamond (Decision)' },
  { type: 'PARALLELOGRAM', label: 'Parallelogram', icon: <ParallelogramIcon />, tooltip: 'Parallelogram (I/O)' },
  { type: 'CIRCLE', label: 'Circle', icon: <CircleIcon />, tooltip: 'Circle (Connector)' },
  { type: 'CYLINDER', label: 'Cylinder', icon: <CylinderIcon />, tooltip: 'Cylinder (Database)' },
  { type: 'TRAPEZOID', label: 'Trapezoid', icon: <TrapezoidIcon />, tooltip: 'Trapezoid (Manual Op)' },
  { type: 'HEXAGON', label: 'Hexagon', icon: <HexagonIcon />, tooltip: 'Hexagon (Preparation)' },
];

const LINE_PALETTE_ITEMS: DecorationPaletteItem[] = [
  { type: 'LINE', label: 'Line', icon: <LineIcon />, tooltip: 'Simple line' },
  { type: 'ARROW_SINGLE', label: 'Arrow', icon: <ArrowSingleIcon />, tooltip: 'Arrow (single head)' },
  { type: 'ARROW_DOUBLE', label: 'Bi-Arrow', icon: <ArrowDoubleIcon />, tooltip: 'Arrow (double head)' },
];
```

#### 2.3 Placement Mode

Update `DecorationAddMode` to include all types:

```typescript
export type DecorationAddMode = null | DecorationType;
```

When user clicks a palette button:
1. Set `addMode` to the selected type
2. Change cursor to crosshair
3. On canvas click/drag, create decoration at that position with default size

---

### 3. Canvas Rendering for New Shapes

#### 3.1 Shape Rendering Functions

Add rendering functions in `rendering.ts` or a new `shapeRendering.ts`:

```typescript
// Render functions for each shape type
function renderOval(ctx: CanvasRenderingContext2D, shape: ShapeDecoration): void;
function renderDiamond(ctx: CanvasRenderingContext2D, shape: ShapeDecoration): void;
function renderParallelogram(ctx: CanvasRenderingContext2D, shape: ShapeDecoration): void;
function renderCircle(ctx: CanvasRenderingContext2D, shape: ShapeDecoration): void;
function renderCylinder(ctx: CanvasRenderingContext2D, shape: ShapeDecoration): void;
function renderTrapezoid(ctx: CanvasRenderingContext2D, shape: ShapeDecoration): void;
function renderHexagon(ctx: CanvasRenderingContext2D, shape: ShapeDecoration): void;
```

#### 3.2 Shape Geometry

| Shape | Description | Geometry |
|-------|-------------|----------|
| OVAL | Ellipse inscribed in bounding box | `ctx.ellipse(cx, cy, rx, ry, 0, 0, 2*PI)` |
| DIAMOND | Rhombus with vertices at midpoints | 4 points: top, right, bottom, left |
| PARALLELOGRAM | Slanted rectangle (15° skew) | 4 points with horizontal offset |
| CIRCLE | Perfect circle (use min dimension) | `ctx.arc(cx, cy, r, 0, 2*PI)` |
| CYLINDER | Rounded rectangle with ellipse top | Body + top ellipse + bottom arc |
| TRAPEZOID | Top narrower than bottom | 4 points with top indented |
| HEXAGON | Regular hexagon | 6 points at 60° intervals |

#### 3.3 Arrow Rendering for ARROW_SINGLE and ARROW_DOUBLE

```typescript
// ARROW_SINGLE: arrow_end = 'ARROW', arrow_start = 'NONE'
// ARROW_DOUBLE: arrow_end = 'ARROW', arrow_start = 'ARROW'
function createArrowSingleDecoration(points): LineDecoration {
  return {
    ...createDefaultLineDecoration(points),
    type: 'ARROW_SINGLE',
    arrow_start: 'NONE',
    arrow_end: 'ARROW',
  };
}

function createArrowDoubleDecoration(points): LineDecoration {
  return {
    ...createDefaultLineDecoration(points),
    type: 'ARROW_DOUBLE',
    arrow_start: 'ARROW',
    arrow_end: 'ARROW',
  };
}
```

---

### 4. Resizable Decoration Behaviour

#### 4.1 Resize Handle Visibility

When a decoration is selected, show resize handles:

**Area Shapes (8 handles)**:
```
TL ── TC ── TR
│           │
ML         MR
│           │
BL ── BC ── BR
```

**Line-based (endpoint handles)**:
```
○────●────○
P0   mid   P1
```

#### 4.2 Handle Hit Testing

```typescript
// Get handle at point for shape decorations
function getShapeHandleAtPoint(
  x: number, y: number,
  shape: ShapeDecoration,
  handleSize: number
): HandlePosition | null;

// Get point index at point for line decorations
function getLinePointAtPoint(
  x: number, y: number,
  line: LineDecoration,
  handleSize: number
): number | null; // Returns point index or null
```

#### 4.3 Resize Interaction

1. **Mouse Down on Handle**: Start resize operation
   - Store initial shape geometry
   - Store which handle is being dragged

2. **Mouse Move**: Update shape geometry
   - For shapes: Calculate new bounds based on handle position
   - For lines: Update the specific point being dragged

3. **Mouse Up**: Finalize resize
   - Update decoration in state
   - Clear resize operation

#### 4.4 Resize Constraints

| Shape | Constraint |
|-------|------------|
| BOX | None (free resize) |
| OVAL | None (free resize) |
| DIAMOND | Maintains diamond shape (center preserved) |
| PARALLELOGRAM | Maintains parallelogram angle |
| CIRCLE | Maintains aspect ratio 1:1 |
| CYLINDER | Maintains cylinder proportions |
| TRAPEZOID | Maintains trapezoid proportions |
| HEXAGON | Maintains regular hexagon angles |
| LINE/ARROWS | Endpoints move freely |

---

### 5. Text Labels for All Decorations

#### 5.1 Text Support

All decorations support optional text:
- `text?: string` - The label text
- `text_h_align?: DecorationHAlign` - Horizontal alignment
- `text_v_align?: DecorationVAlign` - Vertical alignment
- `text_font_size?: number`
- `text_font_weight?: string`
- `text_color?: string`

#### 5.2 Text Rendering Position

| Shape | Default Text Position |
|-------|----------------------|
| BOX | Center of rectangle |
| OVAL | Center of ellipse |
| DIAMOND | Center of diamond |
| PARALLELOGRAM | Center of shape |
| CIRCLE | Center of circle |
| CYLINDER | Center of body |
| TRAPEZOID | Center of shape |
| HEXAGON | Center of hexagon |
| LINE/ARROWS | Midpoint (or explicit label_pos_x/y) |

#### 5.3 Text Editing

Use existing mechanism from InspectorPanel:
1. Select decoration
2. Edit text in "Decoration Text" textarea
3. Text updates in real-time on canvas

---

### 6. Persistence Verification

#### 6.1 Save Operation

When saving a diagram, ensure `decorations` array is included:

```typescript
const diagramToSave: Diagram = {
  id: diagram.id,
  name: diagram.name,
  description: diagram.description,
  diagram_nodes: diagram.diagram_nodes,
  diagram_edges: diagram.diagram_edges,
  decorations: diagram.decorations || [], // MUST include
  view_quarter: diagram.view_quarter,
};
```

#### 6.2 Load Operation

When loading a diagram, restore decorations:

```typescript
const loadedDiagram: Diagram = {
  ...savedData,
  decorations: savedData.decorations || [], // Default to empty array
};
```

#### 6.3 Migration

For existing diagrams without `decorations` field, default to empty array.

---

### 7. Files to Modify

| File | Changes |
|------|---------|
| `frontend/src/types/model.ts` | Add new shape types, update `Decoration` union, add `ShapeDecoration` interface |
| `frontend/src/utils/decorationUtils.ts` | Add factory functions for new shapes, update type guards, add handle utilities |
| `frontend/src/utils/rendering.ts` | Add rendering functions for new shapes |
| `frontend/src/components/DiagramsView/InspectorPanel.tsx` | Expand palette with new shape buttons |
| `frontend/src/components/DiagramsView/Canvas.tsx` | Add resize handle rendering, resize interaction logic |
| `frontend/src/config/defaults.ts` | Add defaults for new decoration types |
| `frontend/src/contexts/ArchitectureContext.tsx` | Verify persistence includes decorations |

---

### 8. Acceptance Criteria

1. **Persistence**
   - Saving a diagram includes all decorations in JSON
   - Loading a diagram restores all decorations with correct geometry, text, and style
   - Save → load → edit → save cycle preserves all decoration data

2. **Expanded Palette**
   - All 11 decoration types available in left panel
   - Clicking a palette item enables placement mode
   - Placing creates decoration with default size at click position

3. **Resizable Shapes**
   - Selected area shapes show 8 resize handles
   - Dragging handles resizes shape in real-time
   - Shape semantics preserved during resize (circle stays circular, etc.)

4. **Resizable Lines**
   - Selected lines show endpoint handles
   - Dragging endpoints repositions line points
   - Arrowheads update automatically

5. **Text Labels**
   - All decoration types support optional text
   - Text displays centered in shape
   - Text persists through save/load

6. **Non-interference**
   - Decorations don't appear in RHS meta-model tables
   - Decorations don't affect node containment or relationships
   - Meta-model nodes remain selectable over decorations

---

### 9. Visual Reference

#### Shape Icons for Palette

```
BOX:           ┌──────┐
               │      │
               └──────┘

OVAL:          ╭──────╮
               │      │
               ╰──────╯

DIAMOND:          ◇
               ◁    ▷
                  ◇

PARALLELOGRAM: ╱──────╲
               ╲──────╱

CIRCLE:           ○

CYLINDER:      ╭────╮
               │    │
               ╰────╯

TRAPEZOID:     ╱────╲
               │    │
               └────┘

HEXAGON:       ⬡

LINE:          ────────

ARROW_SINGLE:  ────────▶

ARROW_DOUBLE:  ◀────────▶
```

---

### 10. Summary

This specification adds:

1. **9 new decoration types**: OVAL, DIAMOND, PARALLELOGRAM, ARROW_SINGLE, ARROW_DOUBLE, CIRCLE, CYLINDER, TRAPEZOID, HEXAGON

2. **Resizable decorations**: All shapes show resize handles when selected

3. **Full persistence**: Decorations save/load with complete fidelity

4. **Text labels**: All decorations support optional text

5. **Expanded palette UI**: Left panel shows all decoration options organized by category

The implementation maintains backward compatibility with existing BOX and LINE decorations while significantly expanding the visual vocabulary available for diagram authoring.
