# Task Breakdown: Diagrams View v0.2 - Editable Canvas

## Overview

**Total Tasks:** 9 Task Groups, 54 Subtasks
**Estimated Total Effort:** Large (L)

This specification transforms the Diagrams view from read-only rendering to an editable canvas with node selection, resize handles, drag-to-move, cascade behaviors, and persistence.

## Key Constants Reference

```typescript
// Configuration constants to be added to frontend/src/config/defaults.ts
export const diagramEditing = {
  // Selection
  selectionColor: '#1976D2',
  selectionStrokeWidth: 2,

  // Resize handles
  handleSize: 8,              // 8px diameter circles
  handleFill: '#1976D2',
  handleStroke: '#FFFFFF',
  handleStrokeWidth: 1,

  // Constraints
  minNodeWidth: 20,
  minNodeHeight: 20,

  // Edge attachment
  attachmentTolerance: 5,     // pixels
};
```

## Task List

---

### Configuration Layer

#### Task Group 1: Configuration Constants and Types
**Dependencies:** None
**Effort:** Small (S)
**Assigned Specialization:** Frontend Engineer

- [x] 1.0 Complete configuration layer
  - [x] 1.1 Write 3-4 focused tests for configuration validation
    - Test that all required configuration keys exist
    - Test that numeric values are positive and within reasonable bounds
    - Test type exports are accessible
  - [x] 1.2 Add editing configuration constants to defaults.ts
    - File: `frontend/src/config/defaults.ts`
    - Add `diagramEditing` object with all constants from spec
    - Selection: `selectionColor`, `selectionStrokeWidth`
    - Handles: `handleSize`, `handleFill`, `handleStroke`, `handleStrokeWidth`
    - Constraints: `minNodeWidth`, `minNodeHeight`
    - Edge attachment: `attachmentTolerance`
  - [x] 1.3 Add TypeScript types for drag operations
    - Add `HandlePosition` type: `'TL' | 'TC' | 'TR' | 'ML' | 'MR' | 'BL' | 'BC' | 'BR'`
    - Add `DragType` type: `'move' | 'resize' | null`
    - Add `DragState` interface with properties: `isDragging`, `dragType`, `resizeHandle`, `startX`, `startY`, `originalNode`
  - [x] 1.4 Add cursor mapping constants
    - Map each `HandlePosition` to its cursor style
    - TL/BR: `nwse-resize`
    - TC/BC: `ns-resize`
    - TR/BL: `nesw-resize`
    - ML/MR: `ew-resize`
  - [x] 1.5 Ensure configuration tests pass
    - Run ONLY the 3-4 tests written in 1.1

**Acceptance Criteria:**
- All configuration constants are accessible and correctly typed
- Type definitions compile without errors
- Configuration tests pass (3-4 tests)

---

### State Management Layer

#### Task Group 2: Context Actions and Reducers
**Dependencies:** Task Group 1
**Effort:** Medium (M)
**Assigned Specialization:** Frontend State Engineer

- [x] 2.0 Complete state management layer
  - [x] 2.1 Write 4-6 focused tests for context actions
    - Test `UPDATE_DIAGRAM_NODE` action updates node properties
    - Test `UPDATE_DIAGRAM_EDGE_POINTS` action updates edge points
    - Test `MOVE_NODE_WITH_CASCADE` action moves node and descendants
    - Test cascade action updates attached edge points
  - [x] 2.2 Add new action types to ArchitectureContext
    - File: `frontend/src/contexts/ArchitectureContext.tsx`
    - Add `UPDATE_DIAGRAM_NODE`: `{ type: 'UPDATE_DIAGRAM_NODE'; diagramId: string; nodeId: string; updates: Partial<DiagramNode> }`
    - Add `UPDATE_DIAGRAM_EDGE_POINTS`: `{ type: 'UPDATE_DIAGRAM_EDGE_POINTS'; diagramId: string; edgeId: string; edgePoints: EdgePoint[] }`
    - Add `MOVE_NODE_WITH_CASCADE`: `{ type: 'MOVE_NODE_WITH_CASCADE'; diagramId: string; nodeId: string; dx: number; dy: number }`
  - [x] 2.3 Implement UPDATE_DIAGRAM_NODE reducer
    - Find diagram by diagramId
    - Find node by nodeId within diagram
    - Merge updates into existing node properties
    - Return updated state immutably
  - [x] 2.4 Implement UPDATE_DIAGRAM_EDGE_POINTS reducer
    - Find diagram by diagramId
    - Find edge by edgeId within diagram
    - Replace edge_points array with new array
    - Return updated state immutably
  - [x] 2.5 Implement MOVE_NODE_WITH_CASCADE reducer
    - Import cascade utility functions (from Task Group 4)
    - Update target node position by dx, dy
    - Get all descendant nodes using `getDescendantNodes()`
    - Move all descendants by same dx, dy
    - Get all attached edge points using `getAttachedEdgePoints()` (check BEFORE moving)
    - Move all attached edge points by same dx, dy
    - Return updated state immutably
  - [x] 2.6 Ensure state management tests pass
    - Run ONLY the 4-6 tests written in 2.1

**Acceptance Criteria:**
- All three action types properly defined
- Reducers correctly update state immutably
- Cascade reducer integrates with utility functions
- State management tests pass (4-6 tests)

---

### Utility Functions Layer

#### Task Group 3: Cascade Utility Functions
**Dependencies:** Task Group 1
**Effort:** Small (S)
**Assigned Specialization:** Frontend Utility Engineer

- [x] 3.0 Complete utility functions for cascade operations
  - [x] 3.1 Write 4-6 focused tests for cascade utilities
    - Test `getDescendantNodes` returns direct children
    - Test `getDescendantNodes` returns nested descendants recursively
    - Test `isPointAttachedToNode` correctly identifies points within tolerance
    - Test `getAttachedEdgePoints` returns only attached points from edges
    - Test edge case: node with no children returns empty array
    - Test edge case: point exactly on tolerance boundary
  - [x] 3.2 Implement getDescendantNodes function
    - File: `frontend/src/utils/rendering.ts`
    - Signature: `function getDescendantNodes(nodeId: string, allNodes: DiagramNode[]): DiagramNode[]`
    - Find all nodes where `parent_node_id === nodeId`
    - Recursively find descendants of each child
    - Return flat array of all descendants
    - Algorithm from spec:
      ```typescript
      function getDescendantNodes(nodeId: string, allNodes: DiagramNode[]): DiagramNode[] {
        const children = allNodes.filter(n => n.parent_node_id === nodeId);
        const descendants = [...children];
        for (const child of children) {
          descendants.push(...getDescendantNodes(child.id, allNodes));
        }
        return descendants;
      }
      ```
  - [x] 3.3 Implement isPointAttachedToNode function
    - File: `frontend/src/utils/rendering.ts`
    - Signature: `function isPointAttachedToNode(point: { pos_x: number; pos_y: number }, node: DiagramNode, tolerance?: number): boolean`
    - Use tolerance from config (default 5px)
    - Check if point within expanded bounding box
    - Algorithm from spec:
      ```typescript
      const nodeLeft = node.pos_x - tolerance;
      const nodeRight = node.pos_x + node.width + tolerance;
      const nodeTop = node.pos_y - tolerance;
      const nodeBottom = node.pos_y + node.height + tolerance;
      return (
        point.pos_x >= nodeLeft &&
        point.pos_x <= nodeRight &&
        point.pos_y >= nodeTop &&
        point.pos_y <= nodeBottom
      );
      ```
  - [x] 3.4 Implement getAttachedEdgePoints function
    - File: `frontend/src/utils/rendering.ts`
    - Signature: `function getAttachedEdgePoints(node: DiagramNode, allEdges: DiagramEdge[]): EdgePoint[]`
    - Iterate through all edges and their edge_points
    - Collect points where `isPointAttachedToNode` returns true
    - Return array of attached EdgePoint references
  - [x] 3.5 Export all utility functions
    - Ensure all functions are exported from rendering.ts
    - Add JSDoc comments for function documentation
  - [x] 3.6 Ensure utility function tests pass
    - Run ONLY the 4-6 tests written in 3.1

**Acceptance Criteria:**
- `getDescendantNodes` correctly traverses parent-child hierarchy
- `isPointAttachedToNode` correctly applies tolerance
- `getAttachedEdgePoints` returns correct points from all edges
- Utility tests pass (4-6 tests)

---

### UI Layer - Selection

#### Task Group 4: Node Selection and Visual Feedback
**Dependencies:** Task Groups 1, 2
**Effort:** Medium (M)
**Assigned Specialization:** UI Designer

- [x] 4.0 Complete selection behavior and visual feedback
  - [x] 4.1 Write 4-6 focused tests for selection behavior
    - Test clicking node sets selectedNodeId
    - Test clicking canvas clears selection
    - Test clicking different node transfers selection
    - Test selected node renders with selection indicator
    - Test only one node can be selected at a time
  - [x] 4.2 Add selection state to Canvas component
    - File: `frontend/src/components/DiagramsView/Canvas.tsx`
    - Add state: `const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)`
  - [x] 4.3 Add CSS styles for selection indicator
    - File: `frontend/src/components/DiagramsView/DiagramsView.module.css`
    - Add `.selectionIndicator` class
    - Blue outline: `stroke: #1976D2`, `stroke-width: 2px`, `fill: none`
    - Positioned around node bounding box
  - [x] 4.4 Implement click-to-select behavior
    - Add `handleMouseDown` handler to Canvas
    - Check if click is on a node using `findNodeAtPoint` utility
    - If node clicked, call `setSelectedNodeId(node.id)`
    - If empty canvas clicked, call `setSelectedNodeId(null)`
  - [x] 4.5 Render selection indicator for selected node
    - When `selectedNodeId` is set, render selection rectangle/outline
    - Use `diagramEditing.selectionColor` and `diagramEditing.selectionStrokeWidth`
    - Position indicator around node bounds
  - [x] 4.6 Add pointer cursor on node hover
    - Add CSS for `cursor: pointer` when hovering over nodes
    - Use conditional styling or data attributes
  - [x] 4.7 Ensure selection tests pass
    - Run ONLY the 4-6 tests written in 4.1

**Acceptance Criteria:**
- Clicking node selects it (blue outline appears)
- Clicking canvas background deselects
- Clicking different node transfers selection
- Only one node selected at a time
- Selection tests pass (4-6 tests)

---

### UI Layer - Resize Handles

#### Task Group 5: Resize Handles Rendering
**Dependencies:** Task Group 4
**Effort:** Medium (M)
**Assigned Specialization:** UI Designer

- [x] 5.0 Complete resize handles rendering
  - [x] 5.1 Write 4-6 focused tests for resize handles
    - Test 8 handles appear when rectangular node selected
    - Test handles positioned at correct corners/midpoints
    - Test BUSINESS_USER nodes do NOT show resize handles
    - Test correct cursor displays on handle hover
  - [x] 5.2 Create resize handle position calculator
    - File: `frontend/src/components/DiagramsView/Canvas.tsx`
    - Function to calculate 8 handle positions from node bounds
    - Handle positions:
      - TL: `(pos_x, pos_y)`
      - TC: `(pos_x + width/2, pos_y)`
      - TR: `(pos_x + width, pos_y)`
      - ML: `(pos_x, pos_y + height/2)`
      - MR: `(pos_x + width, pos_y + height/2)`
      - BL: `(pos_x, pos_y + height)`
      - BC: `(pos_x + width/2, pos_y + height)`
      - BR: `(pos_x + width, pos_y + height)`
  - [x] 5.3 Add CSS styles for resize handles
    - File: `frontend/src/components/DiagramsView/DiagramsView.module.css`
    - Add `.resizeHandle` class
    - Size: 8px diameter (width/height: 8px, border-radius: 50%)
    - Fill: `#1976D2`, Stroke: white 1px
    - Center handle on calculated position
  - [x] 5.4 Render 8 handles for selected rectangular nodes
    - Check `entity_type !== 'BUSINESS_USER'` before rendering handles
    - Render circle elements at each of 8 positions
    - Apply handle styles and cursor styles
  - [x] 5.5 Add cursor styles for each handle type
    - Add CSS classes or inline styles for handle cursors
    - `.handleTL, .handleBR { cursor: nwse-resize; }`
    - `.handleTC, .handleBC { cursor: ns-resize; }`
    - `.handleTR, .handleBL { cursor: nesw-resize; }`
    - `.handleML, .handleMR { cursor: ew-resize; }`
  - [x] 5.6 Implement isOverResizeHandle detection
    - Function to detect if point is over any of the 8 handles
    - Returns `HandlePosition | null`
    - Use handle size for hit detection
  - [x] 5.7 Ensure resize handle tests pass
    - Run ONLY the 4-6 tests written in 5.1

**Acceptance Criteria:**
- 8 handles appear on selected rectangular node
- Handles positioned correctly at corners and midpoints
- BUSINESS_USER nodes show selection but no handles
- Correct resize cursor on each handle hover
- Resize handle tests pass (4-6 tests)

---

### Interaction Layer - Resize Operations

#### Task Group 6: Resize Drag Operations
**Dependencies:** Task Groups 3, 5
**Effort:** Large (L)
**Assigned Specialization:** Frontend Interaction Engineer

- [x] 6.0 Complete resize drag operations
  - [x] 6.1 Write 6-8 focused tests for resize operations
    - Test BR handle drag increases width and height
    - Test TL handle drag adjusts pos_x, pos_y, width, height
    - Test minimum size constraint (20px) is enforced
    - Test position clamps correctly when hitting minimum
    - Test real-time visual feedback during drag
    - Test final dimensions committed on mouse up
  - [x] 6.2 Add drag state for resize operations
    - File: `frontend/src/components/DiagramsView/Canvas.tsx`
    - Add `DragState` using useState or useReducer
    - Track: `isDragging`, `dragType: 'resize'`, `resizeHandle`, `startX`, `startY`, `originalNode`
  - [x] 6.3 Implement startResizeDrag function
    - Called when mousedown detected on resize handle
    - Store original node state (pos_x, pos_y, width, height)
    - Store drag start position
    - Set `dragType: 'resize'` and `resizeHandle` position
  - [x] 6.4 Implement resize calculation for each handle
    - Create function `calculateResize(handle, originalNode, dx, dy)`
    - Implement all 8 handle behaviors from spec:
      - **TL**: `new_width = max(20, original_width - dx)`, clamp pos_x
      - **TC**: `new_height = max(20, original_height - dy)`, clamp pos_y
      - **TR**: `new_width = max(20, original_width + dx)`, `new_height = max(20, original_height - dy)`
      - **ML**: `new_width = max(20, original_width - dx)`, clamp pos_x
      - **MR**: `new_width = max(20, original_width + dx)`
      - **BL**: `new_width = max(20, original_width - dx)`, `new_height = max(20, original_height + dy)`
      - **BC**: `new_height = max(20, original_height + dy)`
      - **BR**: `new_width = max(20, original_width + dx)`, `new_height = max(20, original_height + dy)`
  - [x] 6.5 Implement updateNodeSize for visual feedback
    - Called during mousemove while resizing
    - Calculate new dimensions using 6.4 function
    - Update local/preview state for real-time feedback
    - Do NOT commit to context during drag
  - [x] 6.6 Implement commitNodeResize function
    - Called on mouseup to finalize resize
    - Calculate final dimensions
    - Dispatch `UPDATE_DIAGRAM_NODE` action with final values
    - Reset drag state
  - [x] 6.7 Wire resize handlers to mouse events
    - In `handleMouseDown`: detect if over handle, call startResizeDrag
    - In `handleMouseMove`: if resizing, call updateNodeSize
    - In `handleMouseUp`: if resizing, call commitNodeResize
    - Add cursor style during resize drag
  - [x] 6.8 Ensure resize operation tests pass
    - Run ONLY the 6-8 tests written in 6.1

**Acceptance Criteria:**
- All 8 handles resize correctly per spec
- Minimum size (20px) enforced on all handles
- Position clamps correctly for TL/TC/TR/ML/BL handles
- Real-time visual feedback during drag
- Final dimensions committed on mouse up
- Resize operation tests pass (6-8 tests)

---

### Interaction Layer - Move Operations

#### Task Group 7: Move Drag Operations
**Dependencies:** Task Groups 2, 3, 4
**Effort:** Medium (M)
**Assigned Specialization:** Frontend Interaction Engineer

- [x] 7.0 Complete move drag operations
  - [x] 7.1 Write 5-7 focused tests for move operations
    - Test dragging node updates position
    - Test move cursor displays during drag
    - Test move works for BUSINESS_USER nodes
    - Test children move with parent (cascade)
    - Test attached edge points move with node (cascade)
    - Test unattached edge points remain stationary
  - [x] 7.2 Add drag state for move operations
    - Extend existing drag state to support `dragType: 'move'`
    - Track original node position before drag
  - [x] 7.3 Implement startMoveDrag function
    - Called when mousedown inside node (not on handle)
    - Store original node state
    - Store drag start position
    - Set `dragType: 'move'`
    - Change cursor to `move`
  - [x] 7.4 Implement updateNodePosition for visual feedback
    - Called during mousemove while moving
    - Calculate: `current_pos = original_pos + (mouse - dragStart)`
    - Update local/preview state for real-time feedback
  - [x] 7.5 Implement commitNodeMove function
    - Called on mouseup to finalize move
    - Calculate final dx, dy
    - Dispatch `MOVE_NODE_WITH_CASCADE` action
    - This action handles: node move, child cascade, edge point cascade
    - Reset drag state
  - [x] 7.6 Discriminate between move and resize on mousedown
    - In `handleMouseDown`:
      - First check if over resize handle -> resize mode
      - Else if inside node -> move mode
      - Else -> deselect
  - [x] 7.7 Wire move handlers to mouse events
    - In `handleMouseDown`: call startMoveDrag if inside node
    - In `handleMouseMove`: if moving, call updateNodePosition
    - In `handleMouseUp`: if moving, call commitNodeMove
  - [x] 7.8 Ensure move operation tests pass
    - Run ONLY the 5-7 tests written in 7.1

**Acceptance Criteria:**
- Dragging inside node moves it
- Real-time position update during drag
- Move cursor displays during drag operation
- Works for all node types including BUSINESS_USER
- Cascade to children and edge points occurs on commit
- Move operation tests pass (5-7 tests)

---

### Integration Layer

#### Task Group 8: Persistence and Round-Trip Verification
**Dependencies:** Task Groups 6, 7
**Effort:** Small (S)
**Assigned Specialization:** Frontend Integration Engineer

- [x] 8.0 Complete persistence integration
  - [x] 8.1 Write 3-5 focused tests for persistence
    - Test node position persisted after move
    - Test node dimensions persisted after resize
    - Test edge point positions persisted after cascade
    - Test save and reload shows diagram exactly as edited
  - [x] 8.2 Verify existing save mechanism serializes all fields
    - Check `fileOperations.ts` serializes: `diagram_nodes[].pos_x`, `pos_y`, `width`, `height`
    - Check it serializes: `diagram_edges[].edge_points[].pos_x`, `pos_y`
    - No changes needed if already complete
  - [x] 8.3 Test round-trip persistence
    - Make multiple edits (move, resize)
    - Save JSON via existing mechanism
    - Reload JSON
    - Verify all edits preserved exactly
  - [x] 8.4 Verify child node positions persist after cascade
    - Move parent node with children
    - Save and reload
    - Verify children at expected positions
  - [x] 8.5 Ensure persistence tests pass
    - Run ONLY the 3-5 tests written in 8.1

**Acceptance Criteria:**
- Node positions persist after move
- Node dimensions persist after resize
- Child node positions persist after cascade
- Edge point positions persist after cascade
- Round-trip save/reload preserves exact layout
- Persistence tests pass (3-5 tests)

---

### Testing Layer

#### Task Group 9: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-8
**Effort:** Medium (M)
**Assigned Specialization:** QA Engineer

- [x] 9.0 Review existing tests and fill critical gaps only
  - [x] 9.1 Review tests from Task Groups 1-8
    - Group 1: Configuration tests (3-4 tests)
    - Group 2: State management tests (4-6 tests)
    - Group 3: Utility function tests (4-6 tests)
    - Group 4: Selection tests (4-6 tests)
    - Group 5: Resize handle tests (4-6 tests)
    - Group 6: Resize operation tests (6-8 tests)
    - Group 7: Move operation tests (5-7 tests)
    - Group 8: Persistence tests (3-5 tests)
    - Total existing tests: approximately 33-48 tests
  - [x] 9.2 Analyze test coverage gaps for THIS feature only
    - Review spec acceptance criteria not covered
    - Focus on end-to-end workflows
    - Identify critical integration gaps
    - Do NOT assess entire application coverage
  - [x] 9.3 Write up to 10 additional strategic tests maximum
    - Priority 1: End-to-end workflow tests
      - Full flow: select -> resize -> save -> reload -> verify
      - Full flow: select -> move parent -> verify children cascaded -> save
    - Priority 2: Integration tests
      - Edge attachment detection during move
      - Handle position updates during resize
    - Priority 3: Edge cases
      - Nested containment (grandchild cascade)
      - Multiple edge points attached to same node
  - [x] 9.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's editable canvas feature
    - Expected total: approximately 43-58 tests maximum
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass
  - [x] 9.5 Document any test gaps deferred to future versions
    - Note tests skipped due to scope (no multi-select, no undo/redo)
    - Document for v0.3 planning

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 43-58 tests total)
- Critical user workflows covered
- End-to-end persistence verified
- No more than 10 additional tests added
- Testing focused exclusively on editable canvas feature

---

## Execution Order

Recommended implementation sequence:

```
Phase 1: Foundation
  1. Configuration Constants and Types (Group 1)
  2. Cascade Utility Functions (Group 3)
  3. Context Actions and Reducers (Group 2)

Phase 2: Selection UI
  4. Node Selection and Visual Feedback (Group 4)

Phase 3: Resize Handles
  5. Resize Handles Rendering (Group 5)
  6. Resize Drag Operations (Group 6)

Phase 4: Move Operations
  7. Move Drag Operations (Group 7)

Phase 5: Integration
  8. Persistence and Round-Trip Verification (Group 8)
  9. Test Review and Gap Analysis (Group 9)
```

**Dependency Graph:**

```
Group 1 (Config) ─────┬────► Group 2 (Context) ─────┬────► Group 7 (Move Ops)
                      │                              │
                      ▼                              │
               Group 3 (Utils) ──────────────────────┤
                      │                              │
                      ▼                              │
               Group 4 (Selection) ──────────────────┤
                      │                              │
                      ▼                              │
               Group 5 (Handle Render) ──────────────┤
                      │                              │
                      ▼                              │
               Group 6 (Resize Ops) ─────────────────┴────► Group 8 (Persist)
                                                                   │
                                                                   ▼
                                                           Group 9 (Tests)
```

---

## Files Summary

| File | Task Groups | Changes |
|------|-------------|---------|
| `frontend/src/config/defaults.ts` | 1 | Add `diagramEditing` config object, types |
| `frontend/src/contexts/ArchitectureContext.tsx` | 2 | Add 3 action types and reducers |
| `frontend/src/utils/rendering.ts` | 3 | Add 3 cascade utility functions |
| `frontend/src/components/DiagramsView/Canvas.tsx` | 4, 5, 6, 7 | Selection state, handles, mouse events, drag ops |
| `frontend/src/components/DiagramsView/DiagramsView.module.css` | 4, 5 | Selection indicator, handle styles, cursors |

---

## Algorithm Quick Reference

### Resize Calculations (from spec)

**Bottom-Right (simplest):**
```typescript
new_width = Math.max(MIN_WIDTH, original_width + dx);
new_height = Math.max(MIN_HEIGHT, original_height + dy);
```

**Top-Left (most complex):**
```typescript
new_pos_x = original_pos_x + dx;
new_pos_y = original_pos_y + dy;
new_width = Math.max(MIN_WIDTH, original_width - dx);
new_height = Math.max(MIN_HEIGHT, original_height - dy);

// Clamp position if size hit minimum
if (new_width === MIN_WIDTH) new_pos_x = original_pos_x + original_width - MIN_WIDTH;
if (new_height === MIN_HEIGHT) new_pos_y = original_pos_y + original_height - MIN_HEIGHT;
```

### Edge Attachment Detection

```typescript
const TOLERANCE = 5; // pixels
const nodeLeft = node.pos_x - TOLERANCE;
const nodeRight = node.pos_x + node.width + TOLERANCE;
const nodeTop = node.pos_y - TOLERANCE;
const nodeBottom = node.pos_y + node.height + TOLERANCE;

return point.pos_x >= nodeLeft && point.pos_x <= nodeRight &&
       point.pos_y >= nodeTop && point.pos_y <= nodeBottom;
```

### Cascade Order (Important)

1. **Check attachment BEFORE moving** - use original node position
2. Move parent node
3. Move all descendants
4. Move all attached edge points

---

## Risk Notes

- **High complexity in Task Group 6**: The 8 different resize handle behaviors require careful implementation. Consider implementing BR first (simplest) and working backward to TL (most complex).
- **State synchronization**: During drag operations, local preview state must stay in sync with what will be committed. Consider using `useReducer` for complex drag state.
- **Performance**: For diagrams with many edge points, the attachment check could be slow. Consider early termination optimizations if needed.

---

## Implementation Status

**COMPLETED** - All 9 task groups have been implemented.

### Summary of Changes:

1. **`frontend/src/config/defaults.ts`** - Added `diagramEditing` configuration object with all constants, `HandlePosition` type, `DragType` type, `DragState` interface, and `handleCursors` mapping.

2. **`frontend/src/contexts/ArchitectureContext.tsx`** - Added three new action types (`UPDATE_DIAGRAM_NODE`, `UPDATE_DIAGRAM_EDGE_POINTS`, `MOVE_NODE_WITH_CASCADE`) and their corresponding reducers with full cascade support.

3. **`frontend/src/utils/rendering.ts`** - Added three cascade utility functions (`getDescendantNodes`, `isPointAttachedToNode`, `getAttachedEdgePoints`) with JSDoc documentation.

4. **`frontend/src/components/DiagramsView/Canvas.tsx`** - Complete rewrite with:
   - Selection state management
   - Drag state for move and resize operations
   - Preview state for real-time visual feedback
   - Mouse event handlers (mousedown, mousemove, mouseup, mouseleave)
   - All 8 resize handle calculations with minimum size constraints
   - Handle position calculator
   - Node hit detection
   - Selection indicator and resize handles rendering
   - Cursor feedback based on drag state

5. **`frontend/src/components/DiagramsView/DiagramsView.module.css`** - Added selection indicator styles, resize handle styles, cursor styles for all handle types.

### Key Features Implemented:

- Single node selection with blue outline indicator
- 8 resize handles at corners and midpoints
- BUSINESS_USER nodes can be selected and moved but not resized
- All 8 resize behaviors with minimum size constraints (20px)
- Position clamping when hitting minimum size
- Real-time visual feedback during drag operations
- Move operations with cascade to children and attached edge points
- Edge point attachment detection with 5px tolerance
- Proper cursor feedback for all interaction states
- Build compiles successfully with no TypeScript errors
