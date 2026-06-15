# Task Breakdown: Line Enhancements - Labels and Bend Points

## Overview
Total Tasks: 20 (across 4 task groups)

This feature implements two enhancements to ALL line-based elements in the diagram canvas:
1. Make decorative line labels selectable and draggable (matching relationship edge label behaviour)
2. Allow adding bend points via mid-segment handles on all lines (decorative and relationship edges)

## Files to Modify

| File | Purpose | Task Groups |
|------|---------|-------------|
| `frontend/src/components/DiagramsView/Canvas.tsx` | Main canvas rendering and interaction | 1, 2, 3 |
| `frontend/src/utils/decorationUtils.ts` | Decoration utility functions | 1, 2, 3 |
| `frontend/src/utils/rendering.ts` | Rendering utilities | 1, 2, 3 |
| `frontend/src/contexts/ArchitectureContext.tsx` | State management and reducer | 2, 3 |
| `frontend/src/config/defaults.ts` | Configuration constants | 2 |

## Task List

### Interaction Layer

#### Task Group 1: Decorative Line Label Selection and Dragging
**Dependencies:** None

This task group implements selectable and draggable labels for decorative lines (LINE decorations), matching the existing behaviour of relationship edge labels.

- [x] 1.0 Complete decorative line label selection and dragging
  - [x] 1.1 Write 4-6 focused tests for decorative line label interactions
    - Test: Label hit testing correctly identifies clicks on decorative line labels
    - Test: Clicking a decorative line label selects it
    - Test: Selected decorative line label shows visual highlight
    - Test: Dragging a selected label updates `label_pos_x` and `label_pos_y`
    - Test: Auto-centering calculates correct midpoint from all `line_points`
    - Test: Manual positioning overrides auto-centering
  - [x] 1.2 Implement label hit testing for decorative lines
    - Extend `findDecorationAtPoint()` in `decorationUtils.ts` to include label hit testing
    - Add `isPointOnDecorationLabel()` function to check if click is on a LINE decoration's label
    - Use `measureTextWidth()` from `rendering.ts` for accurate label bounds
    - Consider font size, font weight, and font style from decoration properties
  - [x] 1.3 Add label selection state for decorative lines
    - Add `selectedDecorationLabelId` state to Canvas.tsx (similar to `selectedLabelEdgeId`)
    - Update mouse down handler to detect clicks on decorative line labels
    - Set selection state when label is clicked
    - Clear selection when clicking elsewhere
  - [x] 1.4 Implement label selection visual highlight
    - In `renderLineDecoration()` in `rendering.ts`, add selection highlight data
    - Apply same highlight style as relationship edge labels (from `edgeInteraction.selectedLabelColor`)
    - Return `isLabelSelected` boolean in render result for conditional styling
  - [x] 1.5 Implement label drag handling
    - Add `decorationLabelDragState` interface in Canvas.tsx
    - Track drag start position and original label position
    - On mouse move, update preview position
    - On mouse up, dispatch `UPDATE_DECORATION` with new `label_pos_x` and `label_pos_y`
  - [x] 1.6 Update auto-centering calculation
    - Modify `calculateLineLabelPosition()` in `decorationUtils.ts` to use average of ALL points
    - Formula: `x = average(line_points.x)`, `y = average(line_points.y)`
    - Only apply auto-centering when `label_pos_x`/`label_pos_y` are undefined
  - [x] 1.7 Ensure decorative line label tests pass
    - Run ONLY the 4-6 tests written in 1.1
    - Verify label selection, dragging, and auto-centering work correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-6 tests written in 1.1 pass
- Labels on decorative lines can be clicked to select them
- Selected labels show visual highlight matching edge labels
- Labels can be dragged to update position
- Auto-centering works with all line points
- Manual positioning overrides auto-centering

**Key Files:**
- `frontend/src/components/DiagramsView/Canvas.tsx` - Mouse handling and state
- `frontend/src/utils/decorationUtils.ts` - Hit testing and label position calculation
- `frontend/src/utils/rendering.ts` - Label rendering with selection state

---

#### Task Group 2: Mid-Segment Handle Rendering
**Dependencies:** None (can run in parallel with Task Group 1)

This task group adds visual mid-segment handles (squares) that appear between consecutive points when a line is selected. These handles will be used to insert new bend points in Task Group 3.

- [x] 2.0 Complete mid-segment handle rendering
  - [x] 2.1 Write 4-5 focused tests for mid-segment handle rendering
    - Test: Mid-segment handles are not rendered when line is not selected
    - Test: Correct number of mid-segment handles rendered (n-1 handles for n points)
    - Test: Mid-segment handles positioned at exact midpoint of each segment
    - Test: Mid-segment handles rendered as squares (distinct from endpoint circles)
    - Test: Mid-segment handles rendered for both LINE decorations and relationship edges
  - [x] 2.2 Add mid-segment handle configuration constants
    - Add to `defaults.ts` under `edgeInteraction`:
      - `midSegmentHandleSize: 6` (6px side for square)
      - `midSegmentHandleFill: '#FFFFFF'` (white fill)
      - `midSegmentHandleStroke: '#4a90d9'` (blue stroke)
      - `midSegmentHandleStrokeWidth: 1`
    - Add cursor style: `pointer` or `crosshair`
  - [x] 2.3 Implement mid-segment position calculation
    - Create `calculateMidSegmentPositions()` function in `decorationUtils.ts`
    - Input: array of points (either `line_points` or `edge_points`)
    - Output: array of `{ x, y, segmentIndex }` for each midpoint
    - Formula: `midpoint = ((P[i].x + P[i+1].x) / 2, (P[i].y + P[i+1].y) / 2)`
  - [x] 2.4 Render mid-segment handles for selected LINE decorations
    - In Canvas.tsx `renderDecoration()` function, add mid-segment handle rendering
    - Only render when `isPrimary` (primary selected decoration)
    - Render as `<rect>` elements (squares) at calculated positions
    - Apply configured styling from `edgeInteraction`
  - [x] 2.5 Render mid-segment handles for selected relationship edges
    - In Canvas.tsx edge rendering section, add mid-segment handle rendering
    - Only render when edge is primary selected (`primarySelectedEdge`)
    - Render as `<rect>` elements (squares) at calculated positions
    - Apply same styling as LINE decoration handles for consistency
  - [x] 2.6 Ensure mid-segment handle rendering tests pass
    - Run ONLY the 4-5 tests written in 2.1
    - Verify handles render correctly for both line types
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-5 tests written in 2.1 pass
- Mid-segment handles are squares (visually distinct from endpoint circles)
- Handles appear only when a line is selected
- Handles are positioned at exact midpoints of segments
- Handle count is always (number of points - 1)
- Consistent styling between LINE decorations and relationship edges

**Key Files:**
- `frontend/src/config/defaults.ts` - Configuration constants
- `frontend/src/utils/decorationUtils.ts` - Mid-segment position calculation
- `frontend/src/components/DiagramsView/Canvas.tsx` - Handle rendering

---

#### Task Group 3: Bend Point Insertion
**Dependencies:** Task Group 2 (requires mid-segment handles to be rendered)

This task group implements the interaction to insert new bend points by dragging mid-segment handles. This applies to both LINE decorations and relationship edges.

- [x] 3.0 Complete bend point insertion functionality
  - [x] 3.1 Write 5-6 focused tests for bend point insertion
    - Test: Clicking and dragging a mid-segment handle inserts a new point
    - Test: New point is inserted at correct index (between segment endpoints)
    - Test: Line geometry updates in real-time during drag
    - Test: Updated points array is committed on drag end
    - Test: Auto-centered labels recalculate position with new points
    - Test: Manual label positions are preserved after adding bend points
  - [x] 3.2 Add mid-segment handle hit testing
    - Create `getMidSegmentHandleAtPoint()` function in `decorationUtils.ts`
    - Input: click coordinates, array of mid-segment positions, handle size
    - Output: segment index if hit, null otherwise
    - Use square hit testing (check if point is within handle bounds)
  - [x] 3.3 Implement bend point insertion state for LINE decorations
    - Add `bendPointInsertState` interface in Canvas.tsx:
      ```typescript
      interface BendPointInsertState {
        isInserting: boolean;
        decorationType: 'LINE' | 'EDGE';
        targetId: string;  // decoration ID or edge ID
        segmentIndex: number;
        startX: number;
        startY: number;
        currentX: number;
        currentY: number;
      }
      ```
    - Track insertion state separately from existing drag states
  - [x] 3.4 Handle mouse down on mid-segment handle for LINE decorations
    - In Canvas.tsx `handleMouseDown`, check for mid-segment handle clicks
    - When detected, initialize `bendPointInsertState`
    - Create preview with new point inserted at `segmentIndex + 1`
    - Set preview decoration state
  - [x] 3.5 Handle mouse move during bend point insertion
    - In Canvas.tsx `handleMouseMove`, update preview point position
    - New point follows cursor coordinates
    - Update preview decoration with modified `line_points`
  - [x] 3.6 Commit bend point insertion on mouse up
    - In Canvas.tsx `handleMouseUp`, finalize insertion
    - Dispatch `UPDATE_DECORATION` action with updated `line_points`
    - Reset `bendPointInsertState`
    - Clear preview state
  - [x] 3.7 Implement bend point insertion for relationship edges
    - Add reducer action `INSERT_EDGE_POINT` in `ArchitectureContext.tsx`:
      ```typescript
      | {
          type: 'INSERT_EDGE_POINT';
          diagramId: string;
          edgeId: string;
          segmentIndex: number;
          pos_x: number;
          pos_y: number;
        }
      ```
    - Generate new edge point ID using existing pattern
    - Update `sequence_order` for all subsequent points
    - Insert new point at correct position in `edge_points` array
  - [x] 3.8 Handle mouse down/move/up for edge mid-segment handles
    - Apply same pattern as LINE decorations
    - Use `INSERT_EDGE_POINT` action instead of `UPDATE_DECORATION`
    - Maintain preview state during drag
  - [x] 3.9 Ensure bend point insertion tests pass
    - Run ONLY the 5-6 tests written in 3.1
    - Verify insertion works for both LINE decorations and relationship edges
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 5-6 tests written in 3.1 pass
- Dragging a mid-segment handle inserts a new point
- New points are inserted at the correct position in the array
- Line geometry updates live during drag
- Updated points are committed to state on drag end
- Auto-centered labels recalculate with new points
- Manual label positions are preserved
- Works identically for LINE decorations and relationship edges

**Key Files:**
- `frontend/src/utils/decorationUtils.ts` - Mid-segment hit testing
- `frontend/src/components/DiagramsView/Canvas.tsx` - Mouse handling and state
- `frontend/src/contexts/ArchitectureContext.tsx` - New `INSERT_EDGE_POINT` action

---

### Testing

#### Task Group 4: Test Review and Gap Analysis
**Dependencies:** Task Groups 1, 2, 3

- [x] 4.0 Review existing tests and fill critical gaps only
  - [x] 4.1 Review tests from Task Groups 1-3
    - Review the 4-6 tests written in Task Group 1 (label selection/dragging)
    - Review the 4-5 tests written in Task Group 2 (mid-segment handle rendering)
    - Review the 5-6 tests written in Task Group 3 (bend point insertion)
    - Total existing tests: approximately 13-17 tests
  - [x] 4.2 Analyze test coverage gaps for THIS feature only
    - Identify critical user workflows that lack test coverage
    - Focus ONLY on gaps related to Line Enhancements feature requirements
    - Do NOT assess entire application test coverage
    - Priority areas:
      - Unified behaviour between LINE decorations and relationship edges
      - Edge cases for label auto-centering with many points
      - JSON serialization correctness
  - [x] 4.3 Write up to 8 additional strategic tests maximum
    - Add maximum of 8 new tests to fill identified critical gaps
    - Focus on:
      - Integration: Label selection + bend point insertion combined workflow
      - Unified behaviour: Verify identical behaviour for LINE and EDGE types
      - Serialization: Verify `line_points` and `edge_points` update correctly
      - Edge cases: Lines with 10+ points, rapid bend point insertion
    - Do NOT write comprehensive coverage for all scenarios
    - Skip edge cases that are unlikely in normal usage
  - [x] 4.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature (tests from 1.1, 2.1, 3.1, and 4.3)
    - Expected total: approximately 21-25 tests maximum
    - Do NOT run the entire application test suite
    - Verify critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 21-25 tests total)
- Critical user workflows for Line Enhancements are covered
- No more than 8 additional tests added when filling in testing gaps
- Testing focused exclusively on this spec's feature requirements
- Unified behaviour verified between LINE decorations and relationship edges

**Test File Location:**
- `frontend/src/__tests__/line-enhancements.test.ts` (new file)

---

## Execution Order

Recommended implementation sequence:

```
Phase 1: Foundation (can run in parallel)
  |
  +-- Task Group 1: Decorative Line Label Selection and Dragging
  |
  +-- Task Group 2: Mid-Segment Handle Rendering
  |
  v
Phase 2: Core Functionality
  |
  +-- Task Group 3: Bend Point Insertion (depends on Task Group 2)
  |
  v
Phase 3: Validation
  |
  +-- Task Group 4: Test Review & Gap Analysis
```

**Parallel Execution Notes:**
- Task Groups 1 and 2 can be implemented in parallel as they modify different aspects of the code
- Task Group 3 must wait for Task Group 2 (requires mid-segment handles to exist)
- Task Group 4 runs after all implementation is complete

## Implementation Notes

### Unified Line Abstraction

To ensure consistent behaviour between LINE decorations and relationship edges, consider creating shared utility functions:

```typescript
// In decorationUtils.ts or a new lineUtils.ts

interface LinePoints {
  getPoints(): Array<{ x: number; y: number }>;
  setPoints(points: Array<{ x: number; y: number }>): void;
}

// Adapter for LINE decoration
function createLineDecorationAdapter(line: LineDecoration): LinePoints {
  return {
    getPoints: () => line.line_points,
    setPoints: (points) => { line.line_points = points; }
  };
}

// Adapter for relationship edge
function createEdgeAdapter(edge: DiagramEdge): LinePoints {
  return {
    getPoints: () => edge.edge_points.map(ep => ({ x: ep.pos_x, y: ep.pos_y })),
    // setPoints handled via reducer action
  };
}
```

### Handle Styling Reference

```
Endpoint Handles (existing circles):
  - Shape: Circle
  - Size: 8px diameter (diagramEditing.handleSize)
  - Fill: #1976D2 (diagramEditing.handleFill)
  - Stroke: #FFFFFF (diagramEditing.handleStroke)
  - Cursor: Move

Mid-Segment Handles (new squares):
  - Shape: Square (rect element)
  - Size: 6px side
  - Fill: #FFFFFF
  - Stroke: #4a90d9
  - Cursor: Pointer/Crosshair
```

### Label Position Calculation

```typescript
// Auto-centering formula for labels
function calculateAutoLabelPosition(points: Array<{ x: number; y: number }>) {
  if (points.length === 0) return { x: 0, y: 0 };

  const sumX = points.reduce((sum, p) => sum + p.x, 0);
  const sumY = points.reduce((sum, p) => sum + p.y, 0);

  return {
    x: sumX / points.length,
    y: sumY / points.length
  };
}
```

## Out of Scope

The following are explicitly NOT part of this implementation:
- Removing bend points (delete functionality)
- Snapping bend points to grid or other elements
- Curved lines or bezier segments
- Automatic line routing around obstacles
- Undo/redo for bend point operations
- Keyboard shortcuts for adding/removing points
- Context menu actions for line editing

## Risk Considerations

1. **Performance with Many Points**: Lines with many bend points may impact rendering performance. Consider virtualization if issues arise.

2. **Hit Testing Complexity**: With multiple handle types (endpoints, mid-segments, labels), hit testing priority must be clear. Recommended order:
   1. Endpoint handles
   2. Mid-segment handles
   3. Labels
   4. Line body

3. **State Consistency**: Ensure preview state and actual state remain synchronized during complex drag operations.
