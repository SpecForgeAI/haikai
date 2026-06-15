# Task Breakdown: Decorations – Render on Load and Enable Drawing of New Shapes/Arrows

## Overview
Total Tasks: 18 sub-tasks across 4 task groups

This feature fixes two issues:
1. Decorations not rendering when diagram is loaded from JSON
2. New decoration types (oval, diamond, etc.) not creating shapes when click-dragged

The root cause is that Canvas.tsx only handles BOX and LINE in gesture handling and rendering.

## Task List

### Type and State Layer

#### Task Group 1: Fix Type Constraints and Extend Gesture State
**Dependencies:** None

- [x] 1.0 Complete type and state extensions
  - [x] 1.1 Write 4-5 focused tests for type and state changes
    - Test DecorationAddMode accepts all DecorationType values
    - Test BoxAddGestureState includes shapeType field
    - Test LineAddGestureState includes arrowType field
    - Test SHAPE_DECORATION_TYPES array contains all 7 shape types
    - Test LINE_DECORATION_TYPES array contains LINE, ARROW_SINGLE, ARROW_DOUBLE
    - **Test file:** `frontend/src/__tests__/decoration-gesture-types.test.ts`
  - [x] 1.2 Remove local DecorationAddMode type from Canvas.tsx
    - Delete line 65: `export type DecorationAddMode = null | 'BOX' | 'LINE';`
    - Import from InspectorPanel.tsx: `import { DecorationAddMode } from './InspectorPanel';`
  - [x] 1.3 Extend BoxAddGestureState interface
    - Add `shapeType: ShapeDecorationType | null` field
    - Update initial state to include `shapeType: null`
  - [x] 1.4 Extend LineAddGestureState interface
    - Add `arrowType: LineDecorationType | null` field
    - Update initial state to include `arrowType: null`
  - [x] 1.5 Add type constants for decoration categories
    - Add `SHAPE_DECORATION_TYPES = ['BOX', 'OVAL', 'DIAMOND', 'PARALLELOGRAM', 'CIRCLE', 'CYLINDER', 'TRAPEZOID', 'HEXAGON']`
    - Add `LINE_DECORATION_TYPES = ['LINE', 'ARROW_SINGLE', 'ARROW_DOUBLE']`
  - [x] 1.6 Ensure Task Group 1 tests pass
    - Run: `cd frontend && npm test -- decoration-gesture-types.test.ts`

**Acceptance Criteria:**
- Canvas.tsx accepts all decoration types via props
- Gesture states can track the specific shape/line type being drawn
- Type constants correctly categorize decoration types

**Files to modify:**
- `frontend/src/components/DiagramsView/Canvas.tsx`
- `frontend/src/__tests__/decoration-gesture-types.test.ts` (new)

---

### Gesture Handling Layer

#### Task Group 2: Add Gesture Handling for New Decoration Types
**Dependencies:** Task Group 1

- [x] 2.0 Complete gesture handling for all decoration types
  - [x] 2.1 Write 5-6 focused tests for gesture handling
    - Test handleMouseDown with OVAL mode initializes boxAddGestureState with shapeType='OVAL'
    - Test handleMouseDown with ARROW_SINGLE initializes lineAddGestureState
    - Test handleMouseMove updates gesture state coordinates
    - Test handleMouseUp with shape creates decoration via createShapeDecoration
    - Test handleMouseUp with arrow creates decoration via createLineTypeDecoration
    - Test gesture state resets after decoration creation
    - **Test file:** `frontend/src/__tests__/decoration-gesture-handling.test.ts`
  - [x] 2.2 Add shape gesture handling in handleMouseDown
    - Check if `decorationAddMode` is in SHAPE_DECORATION_TYPES (excluding BOX which has existing handling)
    - Initialize boxAddGestureState with shapeType set to decorationAddMode
    - Match existing BOX gesture pattern
  - [x] 2.3 Add arrow gesture handling in handleMouseDown
    - Check if `decorationAddMode` is ARROW_SINGLE or ARROW_DOUBLE
    - Use LINE gesture pattern (two-click: start point, then end point)
    - Track arrowType in lineAddGestureState
  - [x] 2.4 Update handleMouseMove for shape preview
    - Extend existing BOX preview logic to work with all shape types
    - Update currentX/currentY in boxAddGestureState
  - [x] 2.5 Add shape creation in handleMouseUp
    - Check if boxAddGestureState.shapeType is set
    - Calculate normalized x, y, width, height from gesture
    - Call createShapeDecoration(shapeType, x, y, width, height)
    - Dispatch ADD_DECORATION action
    - Reset gesture state and decoration mode
  - [x] 2.6 Add arrow creation in handleMouseDown (second click)
    - On second click when drawing arrow, create decoration
    - Call createLineTypeDecoration(arrowType, [startPoint, endPoint])
    - Set appropriate arrow_start and arrow_end based on type
    - Dispatch ADD_DECORATION action
  - [x] 2.7 Ensure Task Group 2 tests pass
    - Run: `cd frontend && npm test -- decoration-gesture-handling.test.ts`

**Acceptance Criteria:**
- Click-drag with any shape tool creates the correct shape
- Two-click with arrow tools creates lines with correct arrowheads
- Gesture states properly initialize and reset

**Files to modify:**
- `frontend/src/components/DiagramsView/Canvas.tsx`
- `frontend/src/__tests__/decoration-gesture-handling.test.ts` (new)

---

### Rendering Layer

#### Task Group 3: Add Rendering for New Decoration Types
**Dependencies:** Task Groups 1-2

- [x] 3.0 Complete rendering for all decoration types
  - [x] 3.1 Write 5-6 focused tests for decoration rendering
    - Test renderDecoration handles OVAL type
    - Test renderDecoration handles DIAMOND type
    - Test renderDecoration handles ARROW_SINGLE as LINE with arrow_end
    - Test all 11 decoration types render without returning null
    - Test decorations render with correct SVG paths
    - Test selected decorations show selection indicator
    - **Test file:** `frontend/src/__tests__/decoration-canvas-rendering.test.ts`
  - [x] 3.2 Import shapeRendering utilities in Canvas.tsx
    - Import renderShape from shapeRendering.ts
    - Import isShapeDecorationType helper (or use SHAPE_DECORATION_TYPES)
  - [x] 3.3 Add rendering dispatch for shape decorations
    - In renderDecoration function, add case for non-BOX shape types
    - Call renderShape(decoration.type, decoration) to get SVG path data
    - Render SVG `<path>` element with fill, stroke, strokeWidth
    - Include selection indicator if selected
    - Include resize handles if selected
    - Include text label if present
  - [x] 3.4 Ensure arrow types route to LINE rendering
    - ARROW_SINGLE and ARROW_DOUBLE are LINE decorations with arrow properties
    - Verify existing renderLineDecoration handles arrow_start and arrow_end
    - Add type check to route these to LINE rendering path
  - [x] 3.5 Add shape preview rendering during drawing
    - When boxAddGestureState.isDrawing && shapeType is set
    - Render preview shape using renderShape with preview coordinates
    - Use dashed stroke or semi-transparent fill for preview
  - [x] 3.6 Ensure Task Group 3 tests pass
    - Run: `cd frontend && npm test -- decoration-canvas-rendering.test.ts`

**Acceptance Criteria:**
- All 11 decoration types render correctly on canvas
- Shape previews show actual shape (not dashed rectangle)
- Selected decorations show handles and selection indicator

**Files to modify:**
- `frontend/src/components/DiagramsView/Canvas.tsx`
- `frontend/src/__tests__/decoration-canvas-rendering.test.ts` (new)

---

### Integration and Persistence Layer

#### Task Group 4: Integration Testing and Persistence Verification
**Dependencies:** Task Groups 1-3

- [x] 4.0 Complete integration and persistence verification
  - [x] 4.1 Write 5-6 focused integration tests
    - Test creating decoration via palette + canvas interaction
    - Test decoration persists in diagram state after creation
    - Test save diagram includes all decoration types in JSON
    - Test load diagram renders all decoration types
    - Test save -> load -> edit -> save cycle preserves decorations
    - Test loaded decorations are selectable and editable
    - **Test file:** `frontend/src/__tests__/decoration-integration.test.ts`
  - [x] 4.2 Verify end-to-end creation flow
    - Select tool -> click-drag -> decoration created and rendered
    - Test with each of the 11 decoration types
  - [x] 4.3 Verify decoration persistence
    - Create decorations of all types
    - Save diagram to JSON
    - Verify decorations array includes all created decorations
    - Verify each decoration has correct type, geometry, and properties
  - [x] 4.4 Verify decoration loading
    - Load diagram with decorations from JSON
    - Verify all decorations render on canvas
    - Verify decorations are interactive (selectable, movable, resizable)
  - [x] 4.5 Verify decoration editing after load
    - Load diagram with decorations
    - Select and move a decoration
    - Resize a shape decoration
    - Drag endpoints of a line/arrow decoration
    - Verify changes persist on next save
  - [x] 4.6 Ensure Task Group 4 tests pass
    - Run: `cd frontend && npm test -- decoration-integration.test.ts`

**Acceptance Criteria:**
- Full creation -> render -> save -> load -> edit cycle works for all types
- No decorations lost through save/load cycle
- Loaded decorations behave identically to newly created ones

**Files to modify:**
- `frontend/src/__tests__/decoration-integration.test.ts` (new)

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Types and State** - Fix type constraints, extend gesture state
2. **Task Group 2: Gesture Handling** - Add mouse interaction for new types
3. **Task Group 3: Rendering** - Add canvas rendering for new types
4. **Task Group 4: Integration** - Verify end-to-end flow and persistence

## Files Summary

| File | Changes |
|------|---------|
| `frontend/src/components/DiagramsView/Canvas.tsx` | Remove local type, extend gesture states, add gesture handlers, add rendering dispatch |

**New Test Files:**
| File | Purpose |
|------|---------|
| `frontend/src/__tests__/decoration-gesture-types.test.ts` | Type and state tests |
| `frontend/src/__tests__/decoration-gesture-handling.test.ts` | Gesture handling tests |
| `frontend/src/__tests__/decoration-canvas-rendering.test.ts` | Rendering tests |
| `frontend/src/__tests__/decoration-integration.test.ts` | End-to-end integration tests |

## Key Implementation Notes

1. **Unified Gesture Approach**: All 7 shape types use the same bounding-box gesture as BOX. Only difference is the `shapeType` tracked in state.

2. **Arrow Types Are Lines**: ARROW_SINGLE and ARROW_DOUBLE use LINE gesture and rendering, with arrow_start/arrow_end properties.

3. **Factory Functions Ready**: All factory functions exist in decorationUtils.ts:
   - `createShapeDecoration(type, x, y, w, h)` - dispatch for shapes
   - `createLineTypeDecoration(type, points)` - dispatch for lines/arrows

4. **Shape Rendering Ready**: All render functions exist in shapeRendering.ts:
   - `renderShape(type, decoration)` - dispatch for shape SVG paths

5. **Circle Special Case**: For CIRCLE type, width and height should be equalized using min dimension.

6. **Coordinate Normalization**: Handle drag in any direction by normalizing:
   ```typescript
   const x = Math.min(startX, currentX);
   const y = Math.min(startY, currentY);
   const width = Math.abs(currentX - startX);
   const height = Math.abs(currentY - startY);
   ```

7. **Minimum Size Threshold**: Only create decoration if width > 5 && height > 5 to avoid accidental tiny shapes.

## Test Count Summary

| Task Group | Test Count | Focus Area |
|------------|------------|------------|
| TG1: Types/State | 14 tests | Type constraints, gesture state |
| TG2: Gesture | 16 tests | Mouse interaction, creation |
| TG3: Rendering | 21 tests | Canvas rendering, preview |
| TG4: Integration | 16 tests | End-to-end, persistence |
| **Total** | **67 tests** | Full feature coverage |

## Implementation Summary

All 4 task groups have been successfully implemented:

### Canvas.tsx Changes:
1. Imported `DecorationAddMode` from InspectorPanel.tsx instead of defining locally
2. Extended `BoxAddGestureState` interface with `shapeType: ShapeDecorationType | null` field
3. Extended `LineAddGestureState` interface with `arrowType: LineDecorationType | null` field
4. Added `isShapeType()` and `isLineType()` helper functions using the type constants from model.ts
5. Updated `handleMouseDown` to handle all shape types (BOX, OVAL, DIAMOND, etc.) and line types (LINE, ARROW_SINGLE, ARROW_DOUBLE)
6. Updated `handleMouseMove` to track gesture coordinates for shape preview
7. Updated `handleMouseUp` to create decorations using `createShapeDecoration` and `createLineTypeDecoration`
8. Updated `renderDecoration` to handle all 11 decoration types using `renderShapeDecoration` and `renderLineDecoration`
9. Added shape preview rendering using `renderShape` during drawing gestures
10. Added line preview rendering during two-click arrow creation

### Test Files Created:
1. `decoration-gesture-types.test.ts` - 14 tests for type constraints and gesture state structures
2. `decoration-gesture-handling.test.ts` - 16 tests for mouse gesture handling and creation flow
3. `decoration-canvas-rendering.test.ts` - 21 tests for SVG rendering of all shape/line types
4. `decoration-integration.test.ts` - 16 tests for end-to-end creation, persistence, and editing
