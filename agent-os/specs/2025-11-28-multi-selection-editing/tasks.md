# Task Breakdown: Multi-Selection Editing Capabilities

## Overview
Total Tasks: 36

This feature adds three major editing capabilities to the diagram canvas:
1. **Box-select (drag-selection)** - Select multiple elements by dragging a rectangle
2. **Group movement** - Move all selected elements together while maintaining edge attachments
3. **Delete key handling** - Remove selected nodes and edges with cascade logic

## Execution Order

Recommended implementation sequence:
1. Foundation Layer (Task Group 1) - Utility functions and type definitions
2. Context/State Layer (Task Group 2) - Reducer actions for group operations
3. Box-Select Feature (Task Group 3) - Canvas selection rectangle
4. Group Movement Feature (Task Group 4) - Multi-element dragging
5. Delete Feature (Task Group 5) - Keyboard deletion with cascade
6. Test Review & Gap Analysis (Task Group 6) - Verification and test coverage

---

## Task List

### Foundation Layer

#### Task Group 1: Utility Functions and Type Definitions
**Dependencies:** None

- [x] 1.0 Complete foundation layer
  - [x] 1.1 Write 4-6 focused tests for utility functions
    - Test `isNodeInsideRect()` with fully enclosed node
    - Test `isNodeInsideRect()` with partially overlapping node (should return false)
    - Test `computeEdgeBoundingBox()` with multi-point edge
    - Test `computeEdgeBoundingBox()` with 2-point edge
    - Test `isEdgeInsideRect()` with enclosed edge
    - Test bounding box rectangle math (min/max coordinates)
  - [x] 1.2 Add BoxSelectState interface to `config/defaults.ts`
    - Add `BoxSelectState` interface with fields: `isSelecting`, `startX`, `startY`, `currentX`, `currentY`
    - Add `initialBoxSelectState` constant
    - Add `boxSelectConfig` with: `strokeDasharray: "4,4"`, `fillAlpha: 0.1`, `strokeWidth: 1`
    - Reference existing `diagramEditing.selectionColor` for color (#1976D2)
  - [x] 1.3 Create `isNodeInsideRect()` utility in `utils/rendering.ts`
    - Parameters: `node: DiagramNode`, `rect: {x1, y1, x2, y2}`
    - Returns true if node's entire bounding box is inside rectangle
    - Use `node.pos_x`, `node.pos_y`, `node.width`, `node.height`
    - Handle case where rect coordinates may be inverted (startX > currentX)
  - [x] 1.4 Create `computeEdgeBoundingBox()` utility in `utils/rendering.ts`
    - Parameters: `edge: DiagramEdge`
    - Returns `{minX, minY, maxX, maxY}` from all edge_points
    - Handle empty edge_points array gracefully
  - [x] 1.5 Create `isEdgeInsideRect()` utility in `utils/rendering.ts`
    - Parameters: `edge: DiagramEdge`, `rect: {x1, y1, x2, y2}`
    - Compute edge bounding box using `computeEdgeBoundingBox()`
    - Returns true if entire edge bounding box is inside rectangle
  - [x] 1.6 Create `normalizeRect()` helper in `utils/rendering.ts`
    - Parameters: `x1, y1, x2, y2`
    - Returns `{minX, minY, maxX, maxY}` with proper min/max ordering
    - Handles drag direction in any direction (right-to-left, bottom-to-top)
  - [x] 1.7 Ensure foundation layer tests pass
    - Run ONLY the 4-6 tests written in 1.1
    - Verify utility functions work correctly

**Acceptance Criteria:**
- The 4-6 tests written in 1.1 pass
- Utility functions correctly identify enclosed elements
- Bounding box calculations handle edge cases
- Rectangle normalization works for all drag directions

---

### Context/State Layer

#### Task Group 2: Reducer Actions for Group Operations
**Dependencies:** Task Group 1

- [x] 2.0 Complete context/state layer
  - [x] 2.1 Write 4-6 focused tests for reducer actions
    - Test `MOVE_NODES_WITH_CASCADE` moves multiple nodes by delta
    - Test `MOVE_NODES_WITH_CASCADE` moves descendant nodes
    - Test `MOVE_NODES_WITH_CASCADE` moves attached edge points for all moved nodes
    - Test `DELETE_DIAGRAM_ELEMENTS` removes specified nodes
    - Test `DELETE_DIAGRAM_ELEMENTS` cascades edge deletion for removed nodes
    - Test `DELETE_DIAGRAM_ELEMENTS` removes specified edges without node cascade
  - [x] 2.2 Add `MOVE_NODES_WITH_CASCADE` action type to `ArchitectureContext.tsx`
    - Add to `AppAction` union type: `{ type: 'MOVE_NODES_WITH_CASCADE'; diagramId: string; nodeIds: string[]; dx: number; dy: number }`
    - Action moves all specified nodes and their descendants
    - Action updates attached edge points for all moved nodes (not just selected edges)
  - [x] 2.3 Implement `MOVE_NODES_WITH_CASCADE` reducer case
    - Collect all nodes to move: selected nodes + descendants of each
    - For each node being moved, check attachment for all edges using `isPointAttachedToNode()`
    - Move attached edge points by (dx, dy) - same as single-node cascade logic
    - Adjust labels for 2-point edges when endpoints move (half delta if one, full if both)
    - Follow immutable update pattern from existing `MOVE_NODE_WITH_CASCADE`
  - [x] 2.4 Add `DELETE_DIAGRAM_ELEMENTS` action type to `ArchitectureContext.tsx`
    - Add to `AppAction` union type: `{ type: 'DELETE_DIAGRAM_ELEMENTS'; diagramId: string; nodeIds: string[]; edgeIds: string[] }`
    - Action removes specified nodes and edges from diagram
    - Action cascades: finds edges referencing deleted nodes and removes them too
  - [x] 2.5 Implement `DELETE_DIAGRAM_ELEMENTS` reducer case
    - Collect all edges to delete: explicitly specified + edges referencing deleted nodes (source_node_id or target_node_id)
    - Remove nodes from `diagram.diagram_nodes` array
    - Remove edges from `diagram.diagram_edges` array
    - Return updated state with modified diagram
  - [x] 2.6 Add `SET_BULK_SELECTION` action type to `DiagramsView.tsx`
    - Create callback `handleBulkSelect(nodeIds: Set<string>, edgeIds: Set<string>, addToExisting: boolean)`
    - If `addToExisting` is true, union with current selection
    - If `addToExisting` is false, replace current selection
    - Pass callback to Canvas component
  - [x] 2.7 Ensure context layer tests pass
    - Run ONLY the 4-6 tests written in 2.1
    - Verify reducer actions work correctly

**Acceptance Criteria:**
- The 4-6 tests written in 2.1 pass
- `MOVE_NODES_WITH_CASCADE` moves all nodes with proper edge attachment
- `DELETE_DIAGRAM_ELEMENTS` removes nodes/edges with cascade logic
- State updates are immutable

---

### Box-Select Feature

#### Task Group 3: Canvas Box-Select Implementation
**Dependencies:** Task Groups 1, 2

- [x] 3.0 Complete box-select feature
  - [x] 3.1 Write 4-6 focused tests for box-select behavior
    - Test selection rectangle appears on empty canvas drag
    - Test rectangle disappears on mouse up
    - Test nodes fully inside rectangle are selected
    - Test nodes partially inside rectangle are NOT selected
    - Test edges fully inside rectangle are selected
    - Test Ctrl+drag adds to existing selection (union)
  - [x] 3.2 Add box-select state to Canvas component
    - Add `boxSelectState` using `useState<BoxSelectState>(initialBoxSelectState)`
    - State tracks: `isSelecting`, `startX`, `startY`, `currentX`, `currentY`
    - Import `BoxSelectState` and `initialBoxSelectState` from config/defaults
  - [x] 3.3 Update `handleMouseDown` to detect empty canvas click
    - After checking all hit tests (handles, labels, nodes, edges), if nothing hit:
    - Instead of just calling `onClearSelection()`, also initiate box-select
    - Set `boxSelectState` with `isSelecting: true`, capture start coordinates
    - Store whether Ctrl is held: `isCtrlHeld` for later union logic
  - [x] 3.4 Update `handleMouseMove` for box-select rectangle
    - If `boxSelectState.isSelecting` is true:
    - Update `currentX`, `currentY` from mouse position
    - Selection rectangle will render based on these coordinates
  - [x] 3.5 Implement selection rectangle SVG rendering
    - Add `<rect>` element at end of SVG (above all other content)
    - Only render when `boxSelectState.isSelecting` is true
    - Use `normalizeRect()` to compute proper x, y, width, height
    - Style: `stroke={diagramEditing.selectionColor}`, `strokeDasharray="4,4"`, `fill` with 0.1 alpha
    - `strokeWidth={1}`, `pointerEvents="none"`
  - [x] 3.6 Update `handleMouseUp` to complete box-select
    - If `boxSelectState.isSelecting` is true:
    - Compute normalized rectangle bounds
    - Find all nodes fully inside using `isNodeInsideRect()`
    - Find all edges fully inside using `isEdgeInsideRect()`
    - Call `onBulkSelect()` with found elements, passing `isCtrlHeld` for addToExisting
    - Reset `boxSelectState` to initial
  - [x] 3.7 Handle box-select cancellation on mouse leave
    - If `boxSelectState.isSelecting` and mouse leaves canvas:
    - Reset `boxSelectState` to initial (cancel selection)
  - [x] 3.8 Ensure box-select tests pass
    - Run ONLY the 4-6 tests written in 3.1
    - Verify box-select works correctly

**Acceptance Criteria:**
- The 4-6 tests written in 3.1 pass
- Dashed rectangle appears during drag on empty canvas
- Only fully enclosed elements are selected
- Ctrl+drag adds to existing selection
- Selection rectangle renders above all diagram content

---

### Group Movement Feature

#### Task Group 4: Multi-Selection Group Movement
**Dependencies:** Task Groups 1, 2, 3

- [x] 4.0 Complete group movement feature
  - [x] 4.1 Write 4-6 focused tests for group movement
    - Test dragging selected node moves all selected nodes
    - Test dragging non-selected node does NOT move group
    - Test selected edges move all their edge_points
    - Test non-selected edges with attached points still update
    - Test descendant nodes move with selected parent
    - Test edge labels adjust correctly during group move
  - [x] 4.2 Add group movement state to Canvas component
    - Add `groupDragState` with: `isDragging`, `originalPositions: Map<string, {pos_x, pos_y}>`
    - Track original positions of all selected nodes + descendants at drag start
    - Track original edge_points for preview during drag
  - [x] 4.3 Update `handleMouseDown` for group drag initiation
    - When clicking on a node that IS in `selectedNodeIds`:
    - Set `groupDragState.isDragging = true`
    - Store original positions of ALL selected nodes (not just clicked one)
    - Store original positions of descendants for each selected node
    - When clicking on a node NOT in `selectedNodeIds`:
    - Existing single-node drag behavior (select and drag that one node)
  - [x] 4.4 Add preview state for group movement
    - Add `previewNodes: Map<string, DiagramNode>` for all moving nodes
    - Add `previewEdges: Map<string, DiagramEdge>` for edges with moving points
    - Update `getDisplayNode()` to check `previewNodes` map
    - Update edge rendering to use preview edge_points
  - [x] 4.5 Update `handleMouseMove` for group drag preview
    - If `groupDragState.isDragging`:
    - Calculate delta from start position
    - Update `previewNodes` for all nodes in group (selected + descendants)
    - Calculate which edge points are attached to moving nodes
    - Update `previewEdges` with moved edge_points for attached points
    - Include points from selected edges moving by delta
  - [x] 4.6 Update `handleMouseUp` to commit group movement
    - If `groupDragState.isDragging`:
    - Calculate final delta
    - Dispatch `MOVE_NODES_WITH_CASCADE` with all selected nodeIds and delta
    - Reset `groupDragState` and clear preview state
  - [x] 4.7 Preserve edge attachment detection during group move
    - For each node being moved (selected or descendant):
    - Use `isPointAttachedToNode()` to find attached edge points
    - Non-selected edges with attached points must have those points moved
    - This extends single-node cascade to multi-node scenario
  - [x] 4.8 Ensure group movement tests pass
    - Run ONLY the 4-6 tests written in 4.1
    - Verify group movement works correctly

**Acceptance Criteria:**
- The 4-6 tests written in 4.1 pass
- Dragging any selected node moves entire selection group
- Edge points attached to moving nodes update correctly
- Descendants of selected nodes move with their parents
- Dragging non-selected node behaves as single-select drag

---

### Delete Feature

#### Task Group 5: Delete Key Handling with Cascade
**Dependencies:** Task Groups 1, 2

- [x] 5.0 Complete delete feature
  - [x] 5.1 Write 4-6 focused tests for deletion behavior
    - Test Delete key removes selected nodes
    - Test Delete key removes selected edges
    - Test deleting node cascades to remove connected edges
    - Test deleting edge does NOT remove connected nodes
    - Test Backspace key also triggers deletion
    - Test palette updates after node deletion (entity becomes selectable)
  - [x] 5.2 Add keydown event listener to Canvas container
    - Use `useEffect` to add/remove event listener
    - Listen on document or canvas container for 'keydown'
    - Only handle when canvas is active context (focus management)
  - [x] 5.3 Implement Delete/Backspace key handler
    - Check if event.key is 'Delete' or 'Backspace'
    - Prevent default browser behavior (e.g., Backspace navigation)
    - Only trigger if `selectedNodeIds.size > 0 || selectedEdgeIds.size > 0`
  - [x] 5.4 Dispatch DELETE_DIAGRAM_ELEMENTS action
    - Convert `selectedNodeIds` Set to array
    - Convert `selectedEdgeIds` Set to array
    - Dispatch action with diagramId, nodeIds, edgeIds
    - Clear selection after deletion: call `onClearSelection()`
  - [x] 5.5 Add focus management for keyboard events
    - Canvas container needs `tabIndex={0}` for focus
    - Add `onFocus` and `onBlur` handlers if needed
    - Consider using `document.activeElement` check
    - Ensure Delete only fires when canvas has focus (not when editing inspector)
  - [x] 5.6 Verify palette panel refresh after deletion
    - PalettePanel receives `diagram` prop with `diagram_nodes`
    - When nodes deleted, diagram state updates trigger re-render
    - `nodeExistsForEntity()` returns false for deleted entities
    - Deleted entities become selectable again in palette
    - No additional wiring needed - state flow already handles this
  - [x] 5.7 Ensure delete feature tests pass
    - Run ONLY the 4-6 tests written in 5.1
    - Verify deletion works correctly with cascade

**Acceptance Criteria:**
- The 4-6 tests written in 5.1 pass
- Delete and Backspace keys remove selected elements
- Deleting nodes cascades to remove connected edges
- Palette panel updates to show deleted entities as available
- Focus management prevents accidental deletions

---

### Testing & Integration

#### Task Group 6: Test Review & Gap Analysis
**Dependencies:** Task Groups 1-5

- [x] 6.0 Review existing tests and fill critical gaps only
  - [x] 6.1 Review tests from Task Groups 1-5
    - Review the 4-6 tests written for utilities (Task 1.1)
    - Review the 4-6 tests written for reducer actions (Task 2.1)
    - Review the 4-6 tests written for box-select (Task 3.1)
    - Review the 4-6 tests written for group movement (Task 4.1)
    - Review the 4-6 tests written for deletion (Task 5.1)
    - Total existing tests: approximately 20-30 tests
  - [x] 6.2 Analyze test coverage gaps for this feature only
    - Identify critical user workflows that lack test coverage
    - Focus ONLY on gaps related to multi-selection editing requirements
    - Prioritize end-to-end workflows over unit test gaps
    - Key workflows to verify:
      - Box-select -> group move -> save/load persistence
      - Box-select -> delete -> palette refresh
      - Ctrl+click multi-select -> group move
  - [x] 6.3 Write up to 10 additional strategic tests maximum
    - Focus on integration points between features
    - Test persistence: moved positions saved correctly in JSON
    - Test persistence: deleted elements not present after reload
    - Test state consistency: selection cleared after deletion
    - Test edge cases: empty selection delete (no-op)
    - Test edge cases: box-select with no elements inside
  - [x] 6.4 Run feature-specific tests only
    - Run ONLY tests related to multi-selection editing feature
    - Expected total: approximately 30-40 tests maximum
    - Do NOT run the entire application test suite
    - Verify critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 30-40 tests total)
- Critical user workflows for multi-selection editing are covered
- No more than 10 additional tests added when filling in testing gaps
- Testing focused exclusively on this spec's feature requirements

---

## File Modification Summary

### Files to Modify
| File | Changes |
|------|---------|
| `frontend/src/config/defaults.ts` | Add `BoxSelectState` interface and config |
| `frontend/src/utils/rendering.ts` | Add utility functions for rect/node/edge containment |
| `frontend/src/contexts/ArchitectureContext.tsx` | Add `MOVE_NODES_WITH_CASCADE` and `DELETE_DIAGRAM_ELEMENTS` actions |
| `frontend/src/components/DiagramsView/DiagramsView.tsx` | Add `handleBulkSelect` callback, pass to Canvas |
| `frontend/src/components/DiagramsView/Canvas.tsx` | Add box-select state, group drag state, key handlers, selection rectangle rendering |

### Files to Create
| File | Purpose |
|------|---------|
| `frontend/src/__tests__/box-select.test.ts` | Tests for box-select functionality |
| `frontend/src/__tests__/group-movement.test.ts` | Tests for group movement |
| `frontend/src/__tests__/delete-elements.test.ts` | Tests for deletion with cascade |
| `frontend/src/__tests__/multi-selection-integration.test.ts` | Integration tests |

---

## Technical Notes

### Existing Patterns to Follow
- **State management**: Follow `MOVE_NODE_WITH_CASCADE` pattern for group movement
- **Immutable updates**: Use spread operators and map/filter for state modifications
- **Hit testing**: Follow `findNodeAtPoint()` pattern for coordinate checks
- **Preview state**: Follow `previewNode` pattern for drag visualization

### Key Utilities to Leverage
- `getDescendantNodes()` - Find child hierarchies for group movement
- `isPointAttachedToNode()` - 5px tolerance attachment detection
- `getNodesInRenderOrder()` / `getEdgesForDiagram()` - Current diagram elements
- `getCanvasCoordinates()` - Convert mouse to canvas coordinates

### Configuration Values
- Selection color: `diagramEditing.selectionColor` (#1976D2)
- Attachment tolerance: `diagramEditing.attachmentTolerance` (5px)
- Box-select rectangle: stroke-dasharray "4,4", fill alpha 0.1
