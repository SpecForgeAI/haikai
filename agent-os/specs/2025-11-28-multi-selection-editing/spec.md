# Specification: Multi-Selection Editing Capabilities

## Goal
Enable users to efficiently edit multiple diagram elements by adding drag-selection (box-select), group movement of selected elements, and keyboard-based deletion of nodes and edges.

## User Stories
- As a diagram author, I want to drag-select multiple nodes and edges at once so that I can efficiently manipulate groups of elements without multiple Ctrl+clicks.
- As a diagram author, I want to move a group of selected elements together so that I can reposition entire diagram sections while preserving their relative layout.
- As a diagram author, I want to delete selected nodes and edges with a single keypress so that I can quickly remove unwanted elements.

## Specific Requirements

**Box-select activation and rectangle rendering**
- Drag-selection begins when user clicks on empty canvas area (not on node, edge, label, or handle) and moves the mouse while holding
- A selection rectangle appears immediately on mouse move, rendered as a thin dashed outline (strokeDasharray: "4,4")
- Rectangle color should match diagramEditing.selectionColor (#1976D2)
- Fill should be semi-transparent (rgba with 0.1 alpha) for visibility
- Rectangle must render above all diagram content (append to SVG last or use higher z-index)
- Track start coordinates on mousedown and current coordinates on mousemove to compute rectangle bounds

**Box-select completion and element selection**
- On mouseup, the selection rectangle disappears
- Nodes are selected if their entire bounding box (pos_x, pos_y, width, height) is fully inside the rectangle
- Edges are selected if their edge_points polyline bounding box is fully inside the rectangle
- Compute edge bounding box by finding min/max of all edge_point pos_x/pos_y values
- Without Ctrl held: replace current selection entirely with box-selected elements
- With Ctrl held during drag: add box-selected elements to existing selection (union)

**Selection state integration**
- Use existing selectedNodeIds: Set<string> and selectedEdgeIds: Set<string> from DiagramsView
- Call existing onNodeSelect/onEdgeSelect callbacks or set selection state directly via new bulk callback
- All selected nodes display blue selection outline; primary (first) selected node shows resize handles
- All selected edges show edge_point handles for the primary selected edge only
- BUSINESS_USER nodes do not show resize handles (existing behavior preserved)

**Group movement trigger and delta calculation**
- When dragging any selected node, all selected elements move together
- Movement delta (dx, dy) calculated from the dragged node's cursor movement
- Dragging a non-selected node should NOT trigger group movement (single-select behavior)
- Need to track original positions of all selected nodes and edges at drag start
- Preview state should show all selected elements moving during drag

**Group movement for nodes**
- All selected nodes have pos_x and pos_y updated by (dx, dy)
- Descendant nodes of selected nodes (via parent_node_id) also move with their parent
- Use getDescendantNodes() utility to find child hierarchies
- Each selected node's descendants move regardless of whether descendants are selected

**Group movement for edges and attachment logic**
- All selected edges have ALL their edge_points moved by (dx, dy)
- For each moved node (selected or descendant), apply attachment detection using isPointAttachedToNode()
- Non-selected edges with points attached to moved nodes must have those attached points moved
- This preserves existing single-node cascade behavior but extends to all nodes in the selection
- Edge labels for 2-point edges adjust proportionally (half delta if one endpoint moves, full delta if both)

**Delete key handler setup**
- Add keydown event listener to handle Delete and Backspace keys
- Event listener should be on the canvas container or document with proper focus management
- Only trigger deletion when canvas has focus or is the active editing context
- Prevent default browser behavior (e.g., Backspace navigation)

**Node deletion with cascade**
- Remove deleted nodes from diagram.diagram_nodes array
- When a node is deleted, find all edges referencing it via source_node_id or target_node_id
- Automatically delete those dependent edges (dangling edges not permitted)
- Process deletions in correct order: collect all nodes to delete, then edges, then apply

**Edge deletion**
- Remove deleted edges from diagram.diagram_edges array
- Edge deletion does not cascade to nodes (nodes remain even if all their edges are deleted)
- Remove the entire edge including all edge_points

**Palette panel refresh after deletion**
- PalettePanel receives diagram prop with diagram_nodes array
- PalettePanel uses nodeExistsForEntity() to determine which entities are already on diagram
- When nodes are deleted, the diagram state updates and PalettePanel re-renders automatically
- Deleted entities become selectable again in the palette (add capability restored)
- No additional wiring needed if deletion properly updates state.model.diagrams

**New reducer actions for group operations**
- Add MOVE_NODES_WITH_CASCADE action for group movement (multiple nodes with edge attachment)
- Add DELETE_DIAGRAM_ELEMENTS action that accepts nodeIds and edgeIds to delete
- Reducer must handle cascading edge deletion when nodes are removed
- Both actions update diagram_nodes and diagram_edges arrays immutably

## Visual Design
No visual mockups provided. Implementation should follow existing selection visual patterns:
- Selection rectangle: dashed blue outline with semi-transparent blue fill
- Selected node indicator: blue outline (existing selectionColor)
- Resize handles: blue circles on primary node only
- Edge point handles: blue circles on primary edge only

## Existing Code to Leverage

**Canvas.tsx mouse event handlers**
- handleMouseDown, handleMouseMove, handleMouseUp patterns for drag operations
- getCanvasCoordinates() for converting client coordinates to canvas space
- findNodeAtPoint() for hit testing nodes
- DragState and EdgeDragState interfaces for tracking drag operations

**DiagramsView.tsx selection state management**
- selectedNodeIds and selectedEdgeIds as Set<string> with useState
- handleNodeSelect and handleEdgeSelect callbacks with isMultiSelect parameter
- handleClearSelection for resetting selection
- Selection state passed to Canvas and InspectorPanel components

**ArchitectureContext.tsx reducer patterns**
- MOVE_NODE_WITH_CASCADE action: pattern for moving node with edge attachment detection
- isPointAttachedToNode() usage for finding attached edge points
- getDescendantNodes() for finding child node hierarchies
- Immutable state update patterns for diagram_nodes and diagram_edges

**rendering.ts utility functions**
- getNodesInRenderOrder() and getEdgesForDiagram() for getting current diagram elements
- isPointAttachedToNode() for 5px tolerance attachment detection
- getDescendantNodes() for parent-child cascade logic
- isPointInsideNode() pattern for bounding box checks

**config/defaults.ts constants**
- diagramEditing.selectionColor, selectionStrokeWidth for visual styling
- diagramEditing.attachmentTolerance (5px) for edge attachment
- diagramEditing.minNodeWidth/minNodeHeight for constraints

## Out of Scope
- Undo/redo functionality for deletions or moves
- Copy/paste of selected elements
- Duplicate selected elements
- Group alignment tools (align left, distribute evenly, etc.)
- Marquee selection with Shift key for subtractive selection
- Selection via click-drag on nodes (move takes precedence)
- Resize handles on multi-selected nodes (only primary node has handles)
- Multi-node resize operations
- Snap-to-grid during group movement
- Keyboard arrow key nudging of selection
- Context menu for selected elements
- Visual indication of which edges will be cascade-deleted when deleting nodes
