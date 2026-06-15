# Task Breakdown: Diagrams Edge Interactions

## Overview
Total Tasks: 36
Estimated Total Effort: Medium-Large

This specification extends the editable Diagrams view with edge interactions including edge selection with draggable point handles, label dragging, and automatic label adjustment for straight-line edges.

## Key Constants Reference

```typescript
// Edge interaction configuration (to be added to defaults.ts)
export const edgeInteraction = {
  // Edge point handles
  pointHandleSize: 6,        // 6px diameter circles
  pointHandleFill: '#1976D2',
  pointHandleStroke: '#FFFFFF',
  pointHandleStrokeWidth: 1,

  // Hit testing
  edgeHitTolerance: 5,       // pixels from line
  handleHitRadius: 6,        // pixels from handle center

  // Selected edge styling
  selectedEdgeColor: '#1976D2',
  selectedEdgeWidth: 3,

  // Selected label styling
  selectedLabelColor: '#1976D2',
};
```

## Task List

### Configuration Layer

#### Task Group 1: Configuration and Types
**Dependencies:** None
**Effort:** Small

- [x] 1.0 Complete configuration and type definitions
  - [x] 1.1 Write 3-4 focused tests for edge interaction configuration
    - Test that edgeInteraction constants are defined with correct values
    - Test that EdgeDragState interface has required properties
    - Test edge interaction cursor mappings
  - [x] 1.2 Add edge interaction configuration to `frontend/src/config/defaults.ts`
    - Add `edgeInteraction` object with all constants from spec
    - Include `pointHandleSize`, `pointHandleFill`, `pointHandleStroke`, `pointHandleStrokeWidth`
    - Include `edgeHitTolerance`, `handleHitRadius`
    - Include `selectedEdgeColor`, `selectedEdgeWidth`, `selectedLabelColor`
  - [x] 1.3 Add EdgeDragState interface to `frontend/src/config/defaults.ts`
    - Define interface with `isDragging`, `dragType`, `edgeId`, `pointIndex`, `startX`, `startY`, `originalValue`
    - Export type for use in Canvas.tsx
  - [x] 1.4 Ensure configuration tests pass
    - Run ONLY the 3-4 tests written in 1.1
    - Verify all constants are properly exported

**Acceptance Criteria:**
- The 3-4 tests written in 1.1 pass
- All edge interaction constants are exported and accessible
- EdgeDragState interface properly typed
- Configuration matches spec requirements

---

### Utility Layer

#### Task Group 2: Hit Testing Utility Functions
**Dependencies:** Task Group 1
**Effort:** Medium

- [x] 2.0 Complete hit testing utility functions
  - [x] 2.1 Write 6-8 focused tests for hit testing utilities
    - Test `distanceToLineSegment` with point on line (distance = 0)
    - Test `distanceToLineSegment` with point away from line
    - Test `distanceToLineSegment` with point near endpoint
    - Test `isPointNearPolyline` returns true within tolerance
    - Test `isPointNearPolyline` returns false outside tolerance
    - Test `isPointOnHandle` returns true when within radius
    - Test `isPointOnHandle` returns false when outside radius
    - Test `isPointOnLabel` with text bounding box hit
  - [x] 2.2 Implement `distanceToLineSegment` function in `frontend/src/utils/rendering.ts`
    - Parameters: `px, py, x1, y1, x2, y2`
    - Handle zero-length segment (point at endpoint)
    - Calculate projection parameter `t` clamped to [0,1]
    - Return Euclidean distance to nearest point on segment
    - Algorithm from spec lines 408-428
  - [x] 2.3 Implement `isPointNearPolyline` function in `frontend/src/utils/rendering.ts`
    - Parameters: `px, py, points[], tolerance`
    - Iterate through consecutive point pairs
    - Use `distanceToLineSegment` for each segment
    - Return true if any segment within tolerance (default 5px)
    - Algorithm from spec lines 390-405
  - [x] 2.4 Implement `isPointOnHandle` function in `frontend/src/utils/rendering.ts`
    - Parameters: `clickX, clickY, handleX, handleY, radius`
    - Calculate squared distance
    - Return true if within radius squared (default radius 6px)
    - Algorithm from spec lines 83-88
  - [x] 2.5 Implement `isPointOnLabel` function in `frontend/src/utils/rendering.ts`
    - Parameters: `clickX, clickY, labelX, labelY, textWidth, textHeight`
    - Check if click within bounding box
    - Account for text anchor position (start alignment)
    - Algorithm from spec lines 144-160
  - [x] 2.6 Ensure hit testing utility tests pass
    - Run ONLY the 6-8 tests written in 2.1
    - Verify algorithms match spec behavior

**Acceptance Criteria:**
- The 6-8 tests written in 2.1 pass
- `distanceToLineSegment` handles all edge cases correctly
- `isPointNearPolyline` works with any number of points
- `isPointOnHandle` uses radius-based detection
- `isPointOnLabel` calculates correct bounding box

---

### State Management Layer

#### Task Group 3: Context Actions for Edge Updates
**Dependencies:** Task Group 1
**Effort:** Medium

- [x] 3.0 Complete context actions for edge and label updates
  - [x] 3.1 Write 5-6 focused tests for context actions
    - Test `UPDATE_EDGE_POINT` updates correct point position
    - Test `UPDATE_EDGE_POINT` with `adjustLabel: true` moves label by half delta
    - Test `UPDATE_EDGE_POINT` only auto-adjusts for 2-point edges
    - Test `UPDATE_EDGE_LABEL_POSITION` updates label coordinates
    - Test actions handle invalid diagramId/edgeId gracefully
  - [x] 3.2 Add `UPDATE_EDGE_POINT` action type to `frontend/src/contexts/ArchitectureContext.tsx`
    - Add action to AppAction union type
    - Parameters: `diagramId, edgeId, pointIndex, pos_x, pos_y, adjustLabel?`
    - As specified in spec lines 255-263
  - [x] 3.3 Add `UPDATE_EDGE_LABEL_POSITION` action type to `frontend/src/contexts/ArchitectureContext.tsx`
    - Add action to AppAction union type
    - Parameters: `diagramId, edgeId, label_pos_x, label_pos_y`
    - As specified in spec lines 264-269
  - [x] 3.4 Implement `UPDATE_EDGE_POINT` reducer case
    - Find diagram and edge by IDs
    - Update specific edge_point by pointIndex
    - If `adjustLabel: true` and edge has exactly 2 points:
      - Calculate dx/dy from old to new position
      - Update label_pos_x += dx/2, label_pos_y += dy/2
    - Return new state with immutable updates
  - [x] 3.5 Implement `UPDATE_EDGE_LABEL_POSITION` reducer case
    - Find diagram and edge by IDs
    - Update label_pos_x and label_pos_y
    - Return new state with immutable updates
  - [x] 3.6 Ensure context action tests pass
    - Run ONLY the 5-6 tests written in 3.1
    - Verify state updates correctly

**Acceptance Criteria:**
- The 5-6 tests written in 3.1 pass
- Both actions properly update state immutably
- Auto-label adjustment only applies to 2-point edges
- Label moves by exactly half the point delta

---

### UI Components Layer

#### Task Group 4: Edge Selection and Point Handle Rendering
**Dependencies:** Task Groups 1, 2, 3
**Effort:** Medium

- [x] 4.0 Complete edge selection and handle rendering
  - [x] 4.1 Write 4-5 focused tests for edge selection
    - Test clicking on edge polyline selects edge
    - Test point handles render at each edge_point when selected
    - Test clicking canvas deselects edge
    - Test clicking different edge transfers selection
    - Test edge selection separate from node selection
  - [x] 4.2 Add edge selection state to `frontend/src/components/DiagramsView/Canvas.tsx`
    - Add `selectedEdgeId` state variable
    - Initialize to null
    - Import necessary utilities from rendering.ts
  - [x] 4.3 Implement edge finding in mouse down handler
    - After checking nodes, check edge polylines
    - Use `isPointNearPolyline` for hit testing
    - Use `edgeHitTolerance` (5px) from config
    - Set `selectedEdgeId` on hit
    - Clear label selection when selecting edge
  - [x] 4.4 Render point handles for selected edge
    - When edge is selected, iterate through edge_points
    - Render circle at each point position
    - Use `pointHandleSize` (6px diameter)
    - Use `pointHandleFill` (#1976D2), `pointHandleStroke` (#FFFFFF)
    - Draw on top of polyline
  - [x] 4.5 Render selected edge highlight
    - Apply different stroke color when selected
    - Use `selectedEdgeColor` (#1976D2)
    - Use `selectedEdgeWidth` (3px)
  - [x] 4.6 Ensure edge selection tests pass
    - Run ONLY the 4-5 tests written in 4.1
    - Verify visual feedback appears correctly

**Acceptance Criteria:**
- The 4-5 tests written in 4.1 pass
- Edge selection uses 5px hit tolerance
- Point handles appear as 6px blue circles
- Selected edge shows visual highlight
- Selection clears on empty canvas click

---

#### Task Group 5: Edge Point Drag Operations
**Dependencies:** Task Group 4
**Effort:** Medium

- [x] 5.0 Complete edge point drag operations
  - [x] 5.1 Write 4-5 focused tests for edge point dragging
    - Test clicking handle initiates drag
    - Test polyline updates during drag
    - Test position commits on mouse up
    - Test straight-line auto-adjust moves label by half delta
    - Test cursor changes to 'move' during drag
  - [x] 5.2 Add edge drag state to Canvas.tsx
    - Create state for tracking edge point drag
    - Track edgeId, pointIndex, startX, startY, originalValue
    - Use EdgeDragState interface from config
  - [x] 5.3 Implement edge point handle hit detection
    - Check handle hits before edge line hits
    - Use `isPointOnHandle` with `handleHitRadius` (6px)
    - Return pointIndex of hit handle
    - Prioritize handles over edge line selection
  - [x] 5.4 Implement drag initiation on handle mousedown
    - When handle hit, set dragType to 'edgePoint'
    - Store original point position
    - Set cursor to 'move'
    - Prevent default event
  - [x] 5.5 Implement real-time point update during drag
    - On mousemove, calculate new position
    - Update preview state for visual feedback
    - Re-render polyline with updated point
  - [x] 5.6 Implement drag commit on mouseup
    - Calculate final position
    - Dispatch `UPDATE_EDGE_POINT` action
    - Set `adjustLabel: true` for 2-point edges
    - Reset drag state
  - [x] 5.7 Ensure edge point drag tests pass
    - Run ONLY the 4-5 tests written in 5.1
    - Verify drag operations work correctly

**Acceptance Criteria:**
- The 4-5 tests written in 5.1 pass
- Handle drag updates polyline in real-time
- Position persists to model on mouse up
- Straight-line edges auto-adjust label
- Cursor feedback during drag

---

#### Task Group 6: Label Selection and Drag Operations
**Dependencies:** Task Groups 2, 3, 4
**Effort:** Medium

- [x] 6.0 Complete label selection and drag operations
  - [x] 6.1 Write 5-6 focused tests for label dragging
    - Test clicking on label text selects it
    - Test selected label shows visual highlight
    - Test label drag updates position in real-time
    - Test position commits on mouse up
    - Test label selection separate from edge selection
  - [x] 6.2 Add label selection state to Canvas.tsx
    - Add `selectedLabelEdgeId` state variable
    - Initialize to null
    - Can coexist with edge selection
  - [x] 6.3 Implement label hit detection in mouse down
    - Check labels before edge lines (higher priority)
    - Use `isPointOnLabel` utility
    - Calculate text bounding box from label properties
    - Account for `textAnchor="middle"` positioning
  - [x] 6.4 Implement label selection visual feedback
    - Apply different fill color when selected
    - Use `selectedLabelColor` (#1976D2)
    - May also apply fontWeight: 'bold'
    - As specified in spec lines 100-105
  - [x] 6.5 Implement label drag initiation
    - When label hit, set dragType to 'label'
    - Store original label position (label_pos_x, label_pos_y)
    - Set cursor to 'move'
  - [x] 6.6 Implement real-time label position update
    - On mousemove, calculate delta from drag start
    - Update preview position: new = original + delta
    - Re-render label at preview position
  - [x] 6.7 Implement label drag commit on mouseup
    - Calculate final position
    - Dispatch `UPDATE_EDGE_LABEL_POSITION` action
    - Reset drag state
  - [x] 6.8 Ensure label drag tests pass
    - Run ONLY the 5-6 tests written in 6.1
    - Verify label operations work correctly

**Acceptance Criteria:**
- The 5-6 tests written in 6.1 pass
- Label selection shows visual highlight
- Drag updates label position in real-time
- Position persists to model on mouse up
- Can drag label independently of edge points

---

### Styling Layer

#### Task Group 7: CSS Styles for Edge Interactions
**Dependencies:** Task Group 4
**Effort:** Small

- [x] 7.0 Complete CSS styles for edge interactions
  - [x] 7.1 Write 2-3 focused tests for CSS styles
    - Test edge handle styles applied correctly
    - Test selected edge styles applied correctly
    - Test selected label styles applied correctly
  - [x] 7.2 Add edge point handle styles to `frontend/src/components/DiagramsView/DiagramsView.module.css`
    - Define `.edgePointHandle` class
    - fill: #1976D2, stroke: #FFFFFF, strokeWidth: 1px
    - cursor: move
  - [x] 7.3 Add selected edge styles to CSS
    - Define `.selectedEdge` class
    - stroke: #1976D2, strokeWidth: 3px
  - [x] 7.4 Add selected label styles to CSS
    - Define `.selectedLabel` class
    - fill: #1976D2, fontWeight: bold
  - [x] 7.5 Ensure CSS tests pass
    - Run ONLY the 2-3 tests written in 7.1
    - Verify styles render correctly

**Acceptance Criteria:**
- The 2-3 tests written in 7.1 pass
- Edge handles styled as blue circles with white stroke
- Selected edge has thicker blue stroke
- Selected label has blue text color

---

### Integration Layer

#### Task Group 8: Mouse Event Priority and Integration
**Dependencies:** Task Groups 4, 5, 6
**Effort:** Small

- [x] 8.0 Complete event priority and integration
  - [x] 8.1 Write 3-4 focused tests for event priority
    - Test priority order: resize handles > edge handles > labels > nodes > edges > canvas
    - Test overlapping elements select correct target
    - Test cursor updates correctly for each interaction type
  - [x] 8.2 Implement hit testing priority order in mousedown
    - Order as specified in spec lines 341-383:
      1. Resize handles on selected node
      2. Edge point handles on selected edge
      3. Labels of any edge
      4. Node body
      5. Edge line
      6. Empty canvas
  - [x] 8.3 Implement cursor feedback for all drag types
    - 'move' cursor for node move, edge point drag, label drag
    - Resize cursors for resize handles
    - 'default' cursor otherwise
  - [x] 8.4 Ensure integration tests pass
    - Run ONLY the 3-4 tests written in 8.1
    - Verify priority order works correctly

**Acceptance Criteria:**
- The 3-4 tests written in 8.1 pass
- Hit testing follows correct priority order
- Cursor feedback consistent across interactions
- All drag types work without interference

---

### Testing Layer

#### Task Group 9: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-8
**Effort:** Medium

- [x] 9.0 Review existing tests and fill critical gaps only
  - [x] 9.1 Review tests from Task Groups 1-8
    - Review configuration tests (3-4 tests from Task 1.1)
    - Review hit testing tests (6-8 tests from Task 2.1)
    - Review context action tests (5-6 tests from Task 3.1)
    - Review edge selection tests (4-5 tests from Task 4.1)
    - Review edge drag tests (4-5 tests from Task 5.1)
    - Review label drag tests (5-6 tests from Task 6.1)
    - Review CSS tests (2-3 tests from Task 7.1)
    - Review integration tests (3-4 tests from Task 8.1)
    - Total existing tests: approximately 32-41 tests
  - [x] 9.2 Analyze test coverage gaps for edge interactions feature
    - Identify critical end-to-end workflows lacking coverage
    - Focus on persistence round-trip (save/reload)
    - Check combined interaction scenarios
    - Verify straight-line auto-adjust edge cases
  - [x] 9.3 Write up to 8 additional strategic tests maximum
    - Test edge point position persists after save/reload
    - Test label position persists after save/reload
    - Test combined: select edge, move point, then drag label
    - Test straight-line auto-adjust with both endpoints
    - Test manual label drag overrides auto-position
    - Test deselection clears all selection states
    - Test multiple edge interactions in sequence
    - Test interaction state cleanup on diagram switch
  - [x] 9.4 Run feature-specific tests only
    - Run ONLY tests related to edge interactions feature
    - Expected total: approximately 40-49 tests maximum
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 40-49 tests total)
- Edge point persistence verified
- Label position persistence verified
- Straight-line auto-adjust tested comprehensively
- Combined interactions work correctly
- No more than 8 additional tests added

---

## Execution Order

Recommended implementation sequence:

1. **Configuration Layer** (Task Group 1)
   - Foundation for all other groups
   - No dependencies

2. **Utility Layer** (Task Group 2)
   - Provides hit testing functions
   - Depends on configuration constants

3. **State Management Layer** (Task Group 3)
   - Provides state update actions
   - Depends on configuration for constants

4. **UI Components Layer - Edge Selection** (Task Group 4)
   - Core selection and rendering
   - Depends on utilities and state management

5. **UI Components Layer - Edge Point Drag** (Task Group 5)
   - Extends selection with drag operations
   - Depends on edge selection

6. **UI Components Layer - Label Drag** (Task Group 6)
   - Independent from edge point drag
   - Can be parallelized with Task Group 5

7. **Styling Layer** (Task Group 7)
   - Can be done in parallel with Task Groups 5-6
   - Low dependency

8. **Integration Layer** (Task Group 8)
   - Combines all interactions
   - Depends on Task Groups 4-6

9. **Testing Layer** (Task Group 9)
   - Final validation
   - Depends on all previous groups

---

## Files to Modify Summary

| File | Task Groups | Changes |
|------|-------------|---------|
| `frontend/src/config/defaults.ts` | 1 | Add edgeInteraction config, EdgeDragState interface |
| `frontend/src/utils/rendering.ts` | 2 | Add hit testing utility functions |
| `frontend/src/contexts/ArchitectureContext.tsx` | 3 | Add UPDATE_EDGE_POINT, UPDATE_EDGE_LABEL_POSITION actions |
| `frontend/src/components/DiagramsView/Canvas.tsx` | 4, 5, 6, 8 | Edge/label selection, handle rendering, drag operations |
| `frontend/src/components/DiagramsView/DiagramsView.module.css` | 7 | Edge handle and label selection styles |

---

## Algorithm References

### Distance to Line Segment (Spec lines 408-428)
```typescript
function distanceToLineSegment(px, py, x1, y1, x2, y2): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSq = dx * dx + dy * dy;

  if (lengthSq === 0) {
    return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);
  }

  let t = ((px - x1) * dx + (py - y1) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));

  const nearestX = x1 + t * dx;
  const nearestY = y1 + t * dy;

  return Math.sqrt((px - nearestX) ** 2 + (py - nearestY) ** 2);
}
```

### Straight-Line Label Auto-Adjust (Spec lines 199-218)
```typescript
function moveEdgePointWithLabelAdjust(edge, pointIndex, dx, dy): void {
  // Move the edge point
  edge.edge_points[pointIndex].pos_x += dx;
  edge.edge_points[pointIndex].pos_y += dy;

  // Auto-adjust label for straight-line edges
  if (edge.edge_points.length === 2 && edge.label_pos_x !== undefined) {
    edge.label_pos_x += dx / 2;
    edge.label_pos_y += dy / 2;
  }
}
```

### Is Point On Handle (Spec lines 83-88)
```typescript
function isPointOnHandle(clickX, clickY, handleX, handleY, radius = 6): boolean {
  const dx = clickX - handleX;
  const dy = clickY - handleY;
  return (dx * dx + dy * dy) <= (radius * radius);
}
```

---

## Notes

- Edge selection is separate from node selection (both can exist simultaneously)
- Label selection is separate from edge selection
- Only one edge can be selected at a time
- Auto-label adjustment applies only to edges with exactly 2 edge_points
- All changes persist to JSON through existing save mechanism
- Hit tolerance for edge lines: 5px from the line
- Hit tolerance for handles: 6px radius from center
