# Decorations – Render on Load and Enable Drawing of New Shapes/Arrows

## Overview

This specification fixes two issues with the decoration system:

1. **Decorations not rendering on load** - Decorations stored in JSON are parsed but not visually rendered on the canvas
2. **New decoration tools not creating shapes** - The new shape types (oval, diamond, parallelogram, circle, cylinder, trapezoid, hexagon) and arrow types appear in the palette but don't create decorations when click-dragged

The root cause is that `Canvas.tsx` only handles BOX and LINE decoration types in both the **gesture handling** (mouse interaction) and **rendering** code paths.

---

## Current State Analysis

### What Works (BOX and LINE)

1. **InspectorPanel.tsx** - Palette buttons trigger `onAddModeChange('BOX')` or `onAddModeChange('LINE')`
2. **Canvas.tsx** - Gesture handlers check:
   - `if (decorationAddMode === 'BOX')` → initializes box gesture state
   - `else if (decorationAddMode === 'LINE')` → initializes line gesture state
3. **Mouse up** → Calls `createDefaultBoxDecoration()` or `createDefaultLineDecoration()`
4. **Dispatch** → `ADD_DECORATION` action adds to diagram state
5. **Rendering** → `renderDecoration()` handles BOX via `renderBoxDecoration()` and LINE via `renderLineDecoration()`

### What's Broken (New Shape Types)

1. **Type Constraint** (`Canvas.tsx:65`):
   ```typescript
   export type DecorationAddMode = null | 'BOX' | 'LINE';
   ```
   This restricts the mode to only BOX and LINE, preventing new types from being processed.

2. **Gesture Handling** (`Canvas.tsx:764-820`):
   - No `else if` blocks for OVAL, DIAMOND, PARALLELOGRAM, etc.
   - New types fall through to default behavior (dashed selection box)

3. **Rendering** (`Canvas.tsx:1908-2060`):
   - `renderDecoration()` only handles type === 'BOX' and type === 'LINE'
   - All other types return `null` (not rendered)

### Existing Infrastructure (Ready to Use)

| Component | Status | Location |
|-----------|--------|----------|
| Factory functions for all 11 types | ✓ Complete | `decorationUtils.ts:150-526` |
| Shape rendering functions | ✓ Complete | `shapeRendering.ts:58-353` |
| Default values for all shapes | ✓ Complete | `config/defaults.ts` |
| Palette buttons for all types | ✓ Complete | `InspectorPanel.tsx:107-116` |
| State management (ADD_DECORATION) | ✓ Complete | `ArchitectureContext.tsx:1341-1361` |

---

## Specification

### 1. Fix Type Constraint in Canvas.tsx

**Current** (`Canvas.tsx:65`):
```typescript
export type DecorationAddMode = null | 'BOX' | 'LINE';
```

**Required**: Remove this local type and import from InspectorPanel.tsx:
```typescript
import { DecorationAddMode } from './InspectorPanel';
// Which is defined as: type DecorationAddMode = null | DecorationType;
```

This allows all 11 decoration types to flow through the Canvas component.

---

### 2. Add Gesture Handling for New Shape Types

**Location**: `Canvas.tsx` in `handleMouseDown` function (around lines 764-820)

#### 2.1 Shape Types (OVAL, DIAMOND, PARALLELOGRAM, CIRCLE, CYLINDER, TRAPEZOID, HEXAGON)

These 7 shapes use the same **bounding box** drawing gesture as BOX:
- Mouse down → record start point
- Mouse move → preview shape within bounding rectangle
- Mouse up → create decoration with final geometry

Add gesture handling:
```typescript
// After existing BOX and LINE handling
const SHAPE_DECORATION_TYPES = ['OVAL', 'DIAMOND', 'PARALLELOGRAM', 'CIRCLE', 'CYLINDER', 'TRAPEZOID', 'HEXAGON'];

if (decorationAddMode && SHAPE_DECORATION_TYPES.includes(decorationAddMode)) {
  // Use same gesture state as BOX (bounding box approach)
  setBoxAddGestureState({
    isDrawing: true,
    startX: canvasX,
    startY: canvasY,
    currentX: canvasX,
    currentY: canvasY,
    shapeType: decorationAddMode,  // Track which shape type
  });
  return;
}
```

#### 2.2 Arrow Types (ARROW_SINGLE, ARROW_DOUBLE)

These use the same **two-point** drawing gesture as LINE:
- First click → record start point
- Second click → create line with arrowheads

Add gesture handling:
```typescript
const ARROW_TYPES = ['ARROW_SINGLE', 'ARROW_DOUBLE'];

if (decorationAddMode && ARROW_TYPES.includes(decorationAddMode)) {
  // Use same gesture state as LINE (two-point approach)
  if (!lineAddGestureState.isDrawing) {
    setLineAddGestureState({
      isDrawing: true,
      points: [{ x: canvasX, y: canvasY }],
      arrowType: decorationAddMode,  // Track which arrow type
    });
  } else {
    // Second click - complete the arrow
    const startPoint = lineAddGestureState.points[0];
    const endPoint = { x: canvasX, y: canvasY };

    const decoration = createLineTypeDecoration(
      decorationAddMode,
      [startPoint, endPoint]
    );

    dispatch({ type: 'ADD_DECORATION', diagramId, decoration });
    setDecorationAddMode(null);
    setLineAddGestureState({ isDrawing: false, points: [] });
  }
  return;
}
```

---

### 3. Add Creation Logic on Mouse Up

**Location**: `Canvas.tsx` in `handleMouseUp` function (around lines 1447-1500)

When shape drawing gesture completes:

```typescript
// After existing BOX creation logic
if (boxAddGestureState.isDrawing && boxAddGestureState.shapeType) {
  const { startX, startY, currentX, currentY, shapeType } = boxAddGestureState;

  // Normalize coordinates (handle drag in any direction)
  const x = Math.min(startX, currentX);
  const y = Math.min(startY, currentY);
  const width = Math.abs(currentX - startX);
  const height = Math.abs(currentY - startY);

  // Minimum size threshold
  if (width > 5 && height > 5) {
    const decoration = createShapeDecoration(shapeType, x, y, width, height);
    dispatch({ type: 'ADD_DECORATION', diagramId, decoration });
  }

  setBoxAddGestureState({ isDrawing: false, startX: 0, startY: 0, currentX: 0, currentY: 0, shapeType: null });
  setDecorationAddMode(null);
}
```

---

### 4. Add Rendering for New Shape Types

**Location**: `Canvas.tsx` in `renderDecoration` function (around lines 1908-2060)

#### 4.1 Shape Decoration Rendering

Add after existing BOX rendering:
```typescript
// Import at top of file
import { renderShape, isShapeDecorationType } from '../utils/shapeRendering';

// In renderDecoration function
if (isShapeDecoration(decoration) && decoration.type !== 'BOX') {
  // Render using shapeRendering.ts functions
  const shapePath = renderShape(decoration.type, decoration);

  return (
    <g key={decoration.id} onClick={() => onDecorationSelect(decoration.id)}>
      <path
        d={shapePath.path}
        fill={shapePath.fill}
        stroke={shapePath.stroke}
        strokeWidth={shapePath.strokeWidth}
      />
      {/* Selection indicator if selected */}
      {isSelected && (
        <path
          d={shapePath.path}
          fill="none"
          stroke="#2196f3"
          strokeWidth={2}
          strokeDasharray="5,5"
        />
      )}
      {/* Resize handles if selected */}
      {isSelected && renderResizeHandles(decoration)}
      {/* Text label if present */}
      {decoration.text && renderDecorationText(decoration)}
    </g>
  );
}
```

#### 4.2 Arrow Decoration Rendering

The existing LINE rendering already supports arrows via `arrow_start` and `arrow_end` properties. Ensure ARROW_SINGLE and ARROW_DOUBLE decorations are routed through the LINE rendering path:

```typescript
// In renderDecoration function
if (isLineBasedDecoration(decoration)) {
  // Existing LINE rendering handles arrows automatically
  return renderLineDecoration(decoration, isSelected, ...);
}
```

---

### 5. Update Gesture State Interface

**Location**: `Canvas.tsx` state definitions

Extend the box gesture state to track shape type:
```typescript
interface BoxAddGestureState {
  isDrawing: boolean;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  shapeType: ShapeDecorationType | null;  // ADD THIS
}
```

Extend the line gesture state to track arrow type:
```typescript
interface LineAddGestureState {
  isDrawing: boolean;
  points: Array<{ x: number; y: number }>;
  arrowType: LineDecorationType | null;  // ADD THIS
}
```

---

### 6. Preview During Drawing

**Location**: `Canvas.tsx` in `handleMouseMove` and rendering

While drawing a shape, show a preview:

```typescript
// In handleMouseMove
if (boxAddGestureState.isDrawing) {
  setBoxAddGestureState(prev => ({
    ...prev,
    currentX: canvasX,
    currentY: canvasY,
  }));
}

// In render (after main decorations)
{boxAddGestureState.isDrawing && boxAddGestureState.shapeType && (
  <ShapePreview
    type={boxAddGestureState.shapeType}
    startX={boxAddGestureState.startX}
    startY={boxAddGestureState.startY}
    currentX={boxAddGestureState.currentX}
    currentY={boxAddGestureState.currentY}
  />
)}
```

The preview should show the actual shape outline (not a dashed rectangle) based on the selected tool.

---

### 7. Files to Modify

| File | Changes |
|------|---------|
| `frontend/src/components/DiagramsView/Canvas.tsx` | Remove local DecorationAddMode type, add gesture handling for 9 new types, add rendering dispatch for shapes |
| `frontend/src/utils/shapeRendering.ts` | Ensure renderShape() returns SVG-compatible path data |

**No new files needed** - all infrastructure exists.

---

### 8. Decoration Types Summary

| Type | Gesture | Factory Function | Render Function |
|------|---------|------------------|-----------------|
| BOX | Bounding box | createDefaultBoxDecoration | renderBoxDecoration |
| LINE | Two-point | createDefaultLineDecoration | renderLineDecoration |
| OVAL | Bounding box | createOvalDecoration | renderOval |
| DIAMOND | Bounding box | createDiamondDecoration | renderDiamond |
| PARALLELOGRAM | Bounding box | createParallelogramDecoration | renderParallelogram |
| CIRCLE | Bounding box | createCircleDecoration | renderCircle |
| CYLINDER | Bounding box | createCylinderDecoration | renderCylinder |
| TRAPEZOID | Bounding box | createTrapezoidDecoration | renderTrapezoid |
| HEXAGON | Bounding box | createHexagonDecoration | renderHexagon |
| ARROW_SINGLE | Two-point | createArrowSingleDecoration | renderLineDecoration |
| ARROW_DOUBLE | Two-point | createArrowDoubleDecoration | renderLineDecoration |

---

### 9. Acceptance Criteria

1. **Rendering on Load**
   - Save a diagram with decorations of all 11 types
   - Reload the diagram
   - All decorations render correctly with proper shapes, positions, sizes, and labels
   - Decorations are selectable, movable, and resizable

2. **Drawing New Shapes**
   - For each shape tool (Box, Oval, Diamond, Parallelogram, Circle, Cylinder, Trapezoid, Hexagon):
     - Select tool in palette
     - Click-drag on canvas
     - Shape is created with correct geometry
     - Shape preview shows during drag (not dashed rectangle)

3. **Drawing Lines and Arrows**
   - For each line tool (Line, Arrow, Double Arrow):
     - Select tool in palette
     - Click start point, click end point
     - Line/arrow is created with correct arrowheads

4. **Persistence**
   - All newly created decorations save to JSON
   - Reload preserves all decoration properties
   - Edit → save → reload cycle maintains full fidelity

5. **Interaction Consistency**
   - New decorations behave identically to BOX/LINE:
     - Selectable
     - Movable via drag
     - Resizable via handles (shapes) or endpoint drag (lines)
     - Right-click context menu works
     - POSITION controls work (for shapes)

---

### 10. Implementation Notes

1. **Reuse Existing Gesture States**: The box and line gesture states can be extended with a `shapeType` field rather than creating 11 separate gesture states.

2. **Unified Shape Drawing**: All 7 new shapes use the same bounding-box gesture as BOX. The only difference is the final shape type passed to the factory function.

3. **Arrow Types Are Lines**: ARROW_SINGLE and ARROW_DOUBLE are LINE decorations with `arrow_start` and `arrow_end` properties set. They should use the LINE gesture and rendering code paths.

4. **Shape Preview**: Replace the generic dashed rectangle preview with actual shape outlines for better UX. This may require calling `renderShape()` with preview coordinates.

5. **Circle Special Case**: For CIRCLE, the width and height should be equalized (use min dimension) to ensure a perfect circle rather than an ellipse.

---

### 11. Summary

This specification addresses the gap in `Canvas.tsx` where only BOX and LINE decorations were handled. By:

1. **Fixing the type constraint** to allow all DecorationType values
2. **Adding gesture handling** for 7 new shapes and 2 arrow types
3. **Adding rendering dispatch** to call shapeRendering.ts functions

All 11 decoration types will be fully functional for both:
- Loading from JSON (rendering on load)
- Creating via click-drag interaction (drawing new shapes)

The implementation leverages existing infrastructure (factory functions, rendering functions, state management) and requires changes only to `Canvas.tsx`.
