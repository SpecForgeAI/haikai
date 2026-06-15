# Diagrams View v0.2 - Editable Canvas Specification

## Overview

Version 0.2 transforms the Diagrams view from read-only rendering to an editable canvas. Users can now:
- Select nodes
- Move nodes by dragging
- Resize rectangular nodes using handles
- Have changes automatically propagate to child nodes and attached edge points
- Persist all edits to JSON for round-trip save/reload

## Problem Statement

The v0.1 Diagrams view renders diagrams from JSON but provides no interactive editing capability. Users must manually edit JSON coordinates to reposition or resize diagram elements, which is tedious and error-prone. v0.2 adds direct manipulation of nodes on the canvas.

## Requirements

### 1. Node Selection and Visual Feedback

#### Selection Behavior

**Single-click selection:**
- When user clicks on a diagram node, that node becomes the "selected node"
- Only one node can be selected at a time (no multi-select in v0.2)
- Clicking on empty canvas area deselects the current selection
- Clicking on a different node changes selection to that node

**Visual feedback for selected nodes:**
- Draw a selection indicator (e.g., blue outline, 2px stroke)
- For rectangular nodes: also show resize handles
- For BUSINESS_USER stick-man nodes: show selection outline only (no resize handles)

#### Deselection

- Click on canvas background to deselect
- Click on another node to transfer selection

### 2. Resize Handles for Rectangular Nodes

#### Scope

Applies to ALL diagram_nodes EXCEPT nodes with `entity_type === "BUSINESS_USER"`.

#### Handle Configuration

Draw 8 small filled circles as resize handles around the selected node:

```
    [TL]----[TC]----[TR]
      |              |
    [ML]            [MR]
      |              |
    [BL]----[BC]----[BR]
```

- **TL**: Top-left corner
- **TC**: Top-center
- **TR**: Top-right corner
- **ML**: Middle-left
- **MR**: Middle-right
- **BL**: Bottom-left corner
- **BC**: Bottom-center
- **BR**: Bottom-right corner

**Handle appearance:**
- Size: 8px diameter circles
- Fill: solid blue (#1976D2)
- Stroke: white, 1px (for contrast)
- Positioned at the exact corners and edge midpoints of the node

#### Resize Behavior

When user presses mouse button on a handle and drags:

**During drag:**
- Node dimensions update in real-time as mouse moves
- Visual feedback shows the changing size

**On mouse up:**
- Final dimensions committed to diagram_node

**Handle-specific behaviors:**

| Handle | Adjusts | Behavior |
|--------|---------|----------|
| Top-left (TL) | pos_x, pos_y, width, height | Moves top-left corner; bottom-right stays anchored |
| Top-center (TC) | pos_y, height | Moves top edge; bottom stays anchored |
| Top-right (TR) | pos_y, width, height | Moves top-right corner; bottom-left stays anchored |
| Middle-left (ML) | pos_x, width | Moves left edge; right stays anchored |
| Middle-right (MR) | width | Moves right edge; left stays anchored |
| Bottom-left (BL) | pos_x, width, height | Moves bottom-left corner; top-right stays anchored |
| Bottom-center (BC) | height | Moves bottom edge; top stays anchored |
| Bottom-right (BR) | width, height | Moves bottom-right corner; top-left stays anchored |

#### Minimum Size Constraints

- Minimum width: 20px
- Minimum height: 20px
- Resize operations must not result in dimensions below these minimums
- If drag would make dimension smaller than minimum, clamp to minimum

#### Resize Calculations

**Top-left (TL) handle:**
```typescript
const dx = mouseX - dragStartX;
const dy = mouseY - dragStartY;

new_pos_x = original_pos_x + dx;
new_pos_y = original_pos_y + dy;
new_width = Math.max(MIN_WIDTH, original_width - dx);
new_height = Math.max(MIN_HEIGHT, original_height - dy);

// Clamp position if size hit minimum
if (new_width === MIN_WIDTH) new_pos_x = original_pos_x + original_width - MIN_WIDTH;
if (new_height === MIN_HEIGHT) new_pos_y = original_pos_y + original_height - MIN_HEIGHT;
```

**Top-center (TC) handle:**
```typescript
const dy = mouseY - dragStartY;

new_pos_y = original_pos_y + dy;
new_height = Math.max(MIN_HEIGHT, original_height - dy);

if (new_height === MIN_HEIGHT) new_pos_y = original_pos_y + original_height - MIN_HEIGHT;
```

**Top-right (TR) handle:**
```typescript
const dx = mouseX - dragStartX;
const dy = mouseY - dragStartY;

new_pos_y = original_pos_y + dy;
new_width = Math.max(MIN_WIDTH, original_width + dx);
new_height = Math.max(MIN_HEIGHT, original_height - dy);

if (new_height === MIN_HEIGHT) new_pos_y = original_pos_y + original_height - MIN_HEIGHT;
```

**Middle-left (ML) handle:**
```typescript
const dx = mouseX - dragStartX;

new_pos_x = original_pos_x + dx;
new_width = Math.max(MIN_WIDTH, original_width - dx);

if (new_width === MIN_WIDTH) new_pos_x = original_pos_x + original_width - MIN_WIDTH;
```

**Middle-right (MR) handle:**
```typescript
const dx = mouseX - dragStartX;

new_width = Math.max(MIN_WIDTH, original_width + dx);
```

**Bottom-left (BL) handle:**
```typescript
const dx = mouseX - dragStartX;
const dy = mouseY - dragStartY;

new_pos_x = original_pos_x + dx;
new_width = Math.max(MIN_WIDTH, original_width - dx);
new_height = Math.max(MIN_HEIGHT, original_height + dy);

if (new_width === MIN_WIDTH) new_pos_x = original_pos_x + original_width - MIN_WIDTH;
```

**Bottom-center (BC) handle:**
```typescript
const dy = mouseY - dragStartY;

new_height = Math.max(MIN_HEIGHT, original_height + dy);
```

**Bottom-right (BR) handle:**
```typescript
const dx = mouseX - dragStartX;
const dy = mouseY - dragStartY;

new_width = Math.max(MIN_WIDTH, original_width + dx);
new_height = Math.max(MIN_HEIGHT, original_height + dy);
```

### 3. Moving Nodes by Dragging

#### Scope

Applies to ALL diagram_nodes including BUSINESS_USER.

#### Move Behavior

**Initiation:**
- User clicks inside a node (not on a resize handle) and holds mouse button down
- Node enters "move" mode
- Cursor changes to indicate move operation (e.g., `cursor: move`)

**During drag:**
- Track mouse movement delta from drag start
- Update node position in real-time:
  ```typescript
  current_pos_x = original_pos_x + (mouseX - dragStartX);
  current_pos_y = original_pos_y + (mouseY - dragStartY);
  ```

**On mouse up:**
- Commit final position to diagram_node:
  ```typescript
  node.pos_x = original_pos_x + dx;
  node.pos_y = original_pos_y + dy;
  ```

#### Move vs Resize Discrimination

When mouse down occurs on a selected node:
- If mouse is over a resize handle → enter resize mode
- If mouse is inside node but not on handle → enter move mode

### 4. Cascading Movement to Child Nodes

#### Containment Relationship

When a parent node moves, all its children must move by the same delta.

**Definition:**
- A child node is any diagram_node where `child.parent_node_id === parent.id`
- This applies recursively for nested containment

**Behavior:**

When user drags a parent node by (dx, dy):

1. Update parent node position:
   ```typescript
   parent.pos_x = original_pos_x + dx;
   parent.pos_y = original_pos_y + dy;
   ```

2. Find all descendant nodes:
   ```typescript
   function getDescendants(nodeId: string, allNodes: DiagramNode[]): DiagramNode[] {
     const children = allNodes.filter(n => n.parent_node_id === nodeId);
     const descendants = [...children];
     for (const child of children) {
       descendants.push(...getDescendants(child.id, allNodes));
     }
     return descendants;
   }
   ```

3. Move all descendants by same delta:
   ```typescript
   for (const descendant of descendants) {
     descendant.pos_x = descendant.pos_x + dx;
     descendant.pos_y = descendant.pos_y + dy;
   }
   ```

**Example:**
- Application point "OMS System" contains business process "VaR Interrogation"
- User drags "OMS System" by (+10, +15)
- Result:
  - "OMS System" pos_x += 10, pos_y += 15
  - "VaR Interrogation" pos_x += 10, pos_y += 15

### 5. Cascading Movement to Attached Edge Points

#### Edge Point Attachment Definition

An edge point is considered "attached" to a node if it lies within a tolerance of the node's bounding box.

**Bounding box with tolerance:**
```typescript
const ATTACHMENT_TOLERANCE = 5; // pixels

function isPointAttachedToNode(
  point: { pos_x: number; pos_y: number },
  node: DiagramNode
): boolean {
  const nodeLeft = node.pos_x - ATTACHMENT_TOLERANCE;
  const nodeRight = node.pos_x + node.width + ATTACHMENT_TOLERANCE;
  const nodeTop = node.pos_y - ATTACHMENT_TOLERANCE;
  const nodeBottom = node.pos_y + node.height + ATTACHMENT_TOLERANCE;

  return (
    point.pos_x >= nodeLeft &&
    point.pos_x <= nodeRight &&
    point.pos_y >= nodeTop &&
    point.pos_y <= nodeBottom
  );
}
```

#### Behavior

When user moves a node by (dx, dy):

1. Move the node (and its descendants per section 4)

2. Find all attached edge points:
   ```typescript
   function getAttachedEdgePoints(
     node: DiagramNode,
     allEdges: DiagramEdge[]
   ): EdgePoint[] {
     const attachedPoints: EdgePoint[] = [];

     for (const edge of allEdges) {
       for (const point of edge.edge_points) {
         if (isPointAttachedToNode(point, node)) {
           attachedPoints.push(point);
         }
       }
     }

     return attachedPoints;
   }
   ```

3. Move all attached edge points by same delta:
   ```typescript
   for (const point of attachedPoints) {
     point.pos_x = point.pos_x + dx;
     point.pos_y = point.pos_y + dy;
   }
   ```

**Important:** Check attachment BEFORE moving the node (using original position).

#### Example

Data movement edge from "OMS System" to "Risk Engine":
- Edge has 4 points: start at OMS boundary, two waypoints, end at Risk boundary
- User moves "OMS System" by (+20, +10)
- Edge points near OMS boundary move by (+20, +10)
- Edge points near Risk boundary remain stationary (until Risk is moved)

### 6. Persistence Requirements

All editing operations must update the in-memory model and persist through save/reload.

#### In-Memory Updates

After any edit operation, update the diagram in state:

**For node move/resize:**
```typescript
// Update in diagrams array
const diagram = state.model.diagrams.find(d => d.id === diagramId);
const nodeIndex = diagram.diagram_nodes.findIndex(n => n.id === nodeId);
diagram.diagram_nodes[nodeIndex] = {
  ...diagram.diagram_nodes[nodeIndex],
  pos_x: newPosX,
  pos_y: newPosY,
  width: newWidth,
  height: newHeight
};
```

**For edge point updates:**
```typescript
const edgeIndex = diagram.diagram_edges.findIndex(e => e.id === edgeId);
diagram.diagram_edges[edgeIndex].edge_points = updatedEdgePoints;
```

#### State Management Actions

Add new action types to ArchitectureContext:

```typescript
type AppAction =
  | // ... existing actions ...
  | { type: 'UPDATE_DIAGRAM_NODE'; diagramId: string; nodeId: string; updates: Partial<DiagramNode> }
  | { type: 'UPDATE_DIAGRAM_EDGE_POINTS'; diagramId: string; edgeId: string; edgePoints: EdgePoint[] }
  | { type: 'MOVE_NODE_WITH_CASCADE'; diagramId: string; nodeId: string; dx: number; dy: number };
```

#### JSON Serialization

The existing save mechanism must serialize:
- Updated `diagram_nodes[].pos_x`, `pos_y`, `width`, `height`
- Updated `diagram_edges[].edge_points[].pos_x`, `pos_y`

No changes needed to fileOperations.ts if it already serializes these fields.

#### Round-Trip Verification

After save and reload:
- All nodes appear at their edited positions
- All nodes have their edited dimensions
- All edge points are at their updated positions
- Diagram renders exactly as last edited

### 7. BUSINESS_USER Special Case

#### Selection

- BUSINESS_USER nodes CAN be selected
- Show selection indicator (blue outline)

#### Resize

- BUSINESS_USER nodes do NOT show resize handles in v0.2
- Cannot be resized via drag handles
- Resizing BUSINESS_USER is out of scope for v0.2

#### Move

- BUSINESS_USER nodes CAN be moved by dragging
- Same move behavior as rectangular nodes
- Cascading to attached edge points applies

### 8. Cursor Feedback

Provide visual cursor feedback for different interaction states:

| State | Cursor |
|-------|--------|
| Hovering over node | `pointer` |
| Moving node (dragging) | `move` |
| Hovering over resize handle | Directional cursor based on handle |
| Resizing (dragging handle) | Same directional cursor |

**Resize handle cursors:**

| Handle | Cursor |
|--------|--------|
| Top-left, Bottom-right | `nwse-resize` |
| Top-center, Bottom-center | `ns-resize` |
| Top-right, Bottom-left | `nesw-resize` |
| Middle-left, Middle-right | `ew-resize` |

## Implementation Changes

### Files to Modify

1. **`frontend/src/components/DiagramsView/Canvas.tsx`**
   - Add selection state management
   - Render resize handles for selected rectangular nodes
   - Handle mouse events for selection, move, and resize
   - Implement drag operations with real-time updates
   - Call cascade functions for child nodes and edge points

2. **`frontend/src/contexts/ArchitectureContext.tsx`**
   - Add action types for diagram node updates
   - Add action types for edge point updates
   - Add action type for cascading move operation
   - Implement reducers for these actions

3. **`frontend/src/utils/rendering.ts`**
   - Add `getDescendantNodes()` function
   - Add `isPointAttachedToNode()` function
   - Add `getAttachedEdgePoints()` function

4. **`frontend/src/components/DiagramsView/DiagramsView.module.css`**
   - Add styles for selection indicator
   - Add styles for resize handles
   - Add cursor styles for different states

5. **`frontend/src/config/defaults.ts`**
   - Add resize handle configuration (size, color)
   - Add selection indicator configuration
   - Add minimum node size constants
   - Add edge attachment tolerance constant

### New Components/Utilities

Consider extracting:

1. **`ResizeHandles.tsx`** - Component rendering the 8 resize handles
2. **`SelectionIndicator.tsx`** - Component rendering selection outline
3. **`useDragOperation.ts`** - Custom hook for drag state management

### State Management

**Local component state for drag operations:**
```typescript
interface DragState {
  isDragging: boolean;
  dragType: 'move' | 'resize' | null;
  resizeHandle: HandlePosition | null;
  startX: number;
  startY: number;
  originalNode: DiagramNode;
}
```

**Selection state (can be in component or context):**
```typescript
const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
```

## Acceptance Criteria

### Node Selection

- [ ] Clicking on a node selects it
- [ ] Selected node shows visual indicator (blue outline)
- [ ] Only one node selected at a time
- [ ] Clicking canvas background deselects
- [ ] Clicking different node transfers selection

### Resize Handles

- [ ] 8 handles appear on selected rectangular node
- [ ] Handles positioned at correct corners/midpoints
- [ ] Handles have correct cursor on hover
- [ ] BUSINESS_USER nodes do not show resize handles

### Resize Operations

- [ ] Each handle resizes correctly per spec
- [ ] Real-time visual feedback during drag
- [ ] Minimum size constraints enforced (20px)
- [ ] Position updates correctly for top/left edge handles
- [ ] Final dimensions committed on mouse up

### Move Operations

- [ ] Dragging inside node moves it
- [ ] Real-time position update during drag
- [ ] Final position committed on mouse up
- [ ] Works for all node types including BUSINESS_USER

### Cascade to Children

- [ ] Moving parent moves all children
- [ ] Children maintain relative positions
- [ ] Works for nested containment hierarchies

### Cascade to Edge Points

- [ ] Edge points within tolerance move with node
- [ ] Attachment calculated before node moves
- [ ] Tolerance of 5px applied correctly
- [ ] Non-attached points remain stationary

### Persistence

- [ ] Node position persisted after move
- [ ] Node dimensions persisted after resize
- [ ] Child node positions persisted after cascade
- [ ] Edge point positions persisted after cascade
- [ ] Save JSON includes all updates
- [ ] Reload shows diagram exactly as edited

### Cursor Feedback

- [ ] Pointer cursor on node hover
- [ ] Move cursor during drag
- [ ] Correct resize cursor for each handle

## Out of Scope for v0.2

- Creating or deleting nodes via canvas
- Creating, editing, or deleting edges via canvas
- Snapping to grid
- Alignment tools
- Node locking
- Multi-select
- Resizing BUSINESS_USER stick-man nodes
- Undo/redo for diagram edits
- Keyboard shortcuts for diagram editing

## Testing

### Test 1: Node Selection

1. Click on a rectangular node
2. Verify selection indicator appears
3. Click on canvas background
4. Verify selection clears
5. Click on a different node
6. Verify selection transfers

### Test 2: Resize Operations

1. Select a rectangular node
2. Verify 8 handles appear
3. Drag bottom-right handle to increase size
4. Verify width and height increase
5. Drag top-left handle to resize
6. Verify pos_x, pos_y, width, height all update
7. Try to resize below minimum
8. Verify size clamps at 20px

### Test 3: Move Operations

1. Click and drag inside a node
2. Verify node follows mouse
3. Release mouse
4. Verify final position committed
5. Save JSON and reload
6. Verify node at new position

### Test 4: Child Node Cascade

1. Create diagram with parent containing child
2. Move parent node
3. Verify child moves by same delta
4. Save and reload
5. Verify both positions persisted

### Test 5: Edge Point Cascade

1. Create diagram with edge attached to node
2. Move the node
3. Verify attached edge points move
4. Verify non-attached points stay
5. Save and reload
6. Verify edge points at new positions

### Test 6: BUSINESS_USER Node

1. Select BUSINESS_USER node
2. Verify selection indicator shows
3. Verify no resize handles appear
4. Drag to move
5. Verify move works correctly

### Test 7: Round-Trip Persistence

1. Make multiple edits (move, resize)
2. Save JSON
3. Reload JSON
4. Verify all edits preserved exactly

## Configuration Constants

```typescript
// In frontend/src/config/defaults.ts

export const diagramEditing = {
  // Selection
  selectionColor: '#1976D2',
  selectionStrokeWidth: 2,

  // Resize handles
  handleSize: 8,
  handleFill: '#1976D2',
  handleStroke: '#FFFFFF',
  handleStrokeWidth: 1,

  // Constraints
  minNodeWidth: 20,
  minNodeHeight: 20,

  // Edge attachment
  attachmentTolerance: 5,
};
```

## Event Handling Flow

### Mouse Down on Canvas

```typescript
function handleMouseDown(event: React.MouseEvent) {
  const { x, y } = getCanvasCoordinates(event);

  // Check if clicked on resize handle of selected node
  if (selectedNode && isOverResizeHandle(x, y, selectedNode)) {
    startResizeDrag(event, handle);
    return;
  }

  // Check if clicked on a node
  const clickedNode = findNodeAtPoint(x, y, nodes);
  if (clickedNode) {
    setSelectedNodeId(clickedNode.id);
    startMoveDrag(event, clickedNode);
    return;
  }

  // Clicked on empty canvas - deselect
  setSelectedNodeId(null);
}
```

### Mouse Move (during drag)

```typescript
function handleMouseMove(event: React.MouseEvent) {
  if (!dragState.isDragging) return;

  const { x, y } = getCanvasCoordinates(event);
  const dx = x - dragState.startX;
  const dy = y - dragState.startY;

  if (dragState.dragType === 'move') {
    updateNodePosition(dragState.originalNode, dx, dy);
  } else if (dragState.dragType === 'resize') {
    updateNodeSize(dragState.originalNode, dragState.resizeHandle, dx, dy);
  }
}
```

### Mouse Up (end drag)

```typescript
function handleMouseUp(event: React.MouseEvent) {
  if (!dragState.isDragging) return;

  const { x, y } = getCanvasCoordinates(event);
  const dx = x - dragState.startX;
  const dy = y - dragState.startY;

  if (dragState.dragType === 'move') {
    commitNodeMove(dragState.originalNode.id, dx, dy);
  } else if (dragState.dragType === 'resize') {
    commitNodeResize(dragState.originalNode.id, finalDimensions);
  }

  resetDragState();
}
```
