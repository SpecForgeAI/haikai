# Multi-Selection Editing Capabilities - Requirements

## Overview
Add three major editing capabilities to the diagram canvas:
1. Drag-selection (box-select)
2. Group movement of multiple selected elements
3. Deletion of selected elements (nodes and/or edges)

---

## 1) Drag-selection (box-select) on the canvas

### Goal
Allow users to select multiple diagram elements at once by dragging out a selection rectangle.

### Behaviour

#### 1.1 Activation
- Drag-selection begins when:
  - The user clicks on an EMPTY area of the canvas (i.e., not on a node, edge, label, or handle),
  - And holds the mouse button down,
  - And moves the cursor.
- As soon as the user moves the mouse, a temporary "selection rectangle" appears.

#### 1.2 Rectangle rendering
- The selection rectangle must be:
  - A thin, dashed/dotted outline,
  - Semi-transparent fill optional,
  - Displayed above all diagram content.

#### 1.3 Selection logic when mouse is released
- When the user releases the mouse button:
  - The rectangle disappears.
  - Any diagram element that lies **fully inside** the rectangle becomes selected.
    - For nodes: the entire bounding box must be fully inside.
    - For edges:
      - Use the bounding box of the edge's polyline (computed from its edge_points).
      - If the entire bounding box is inside the selection rectangle, the edge becomes selected.
  - This behaves exactly the same as multi-select with Ctrl-click, except performed in bulk.

#### 1.4 Integration with existing selection model
- If the user used box-select:
  - This replaces the previous selection set (unless Ctrl is held; see below).
- Ctrl + drag-select:
  - If Ctrl is held during the drag-selection:
    - All elements inside the rectangle are **added** to the existing selection.
    - Already-selected elements remain selected.
- All selected elements must show their usual selection indicators:
  - Nodes → 8 resize handles.
  - Edges → edge_points handles.

---

## 2) Group movement for multi-selection

When multiple elements are selected:

### 2.1 Movement trigger
- If the user clicks and drags **any selected node**, the entire selection group must move together.
- Movement delta (dx, dy) is determined by the dragged node's movement between cursor-down and cursor-move.

### 2.2 What moves together
- For every selected node:
  - Update pos_x and pos_y by (dx, dy).
  - The node moves visually and in the underlying in-memory JSON.

- For every selected edge:
  - Update every edge_point of that edge by (dx, dy),
    UNLESS the point is not intended to be moved based on the "attached edge_point" logic for that edge.
  - For v0.2+ we must preserve existing semantics:
    - If moving a node causes certain attached edge_points to move (per our 5px tolerance rule), then group move must reproduce that logic *for each node* that moves.

### 2.3 Movement semantics for edges attached to moved nodes
- Apply the **same logic** as for single-node movement, but now for every moved node:
  - For each moved node in the selection:
    - Detect edge_points attached to that node (via tolerance rule).
    - Move those points by (dx, dy).
  - Edge_points that belong to selected edges must move by (dx, dy) regardless of attachment.
  - Edge_points belonging to non-selected edges but attached to moved nodes must **still be updated** (to maintain connections), preserving current behaviour.

### 2.4 Persistence
- After a group move:
  - All updated node positions and edge_point positions are written back into the in-memory diagram.
  - On Save JSON, these updated values must be persisted.
  - On Load JSON, reloaded diagrams must match the moved layout.

---

## 3) Delete selected elements with Delete/Backspace

### Goal
Allow removal of nodes and edges from a diagram using keyboard input.

### 3.1 Trigger
- When one or more diagram elements are selected:
  - Pressing **Delete** or **Backspace** deletes them.

### 3.2 What deletion means
- For nodes:
  - Remove the diagram_node entry from diagrams[diagram_index].diagram_nodes.
  - Remove associated diagram-edge endpoints:
    - Option A (recommended):
      - Automatically delete any diagram_edge whose source_node_id or target_node_id is the deleted node.
    - Option B (later enhancement):
      - Support dangling edges; but NOT allowed for now. All broken edges MUST be removed.
  - Remove the node from the canvas immediately.

- For edges:
  - Remove the diagram_edge from diagrams[diagram_index].diagram_edges.
  - Remove all its edge_points.
  - Remove the edge immediately from the canvas.

### 3.3 Multi-delete
- If multiple nodes and/or edges are selected:
  - Pressing Delete removes all of them in one operation.
  - Nodes and edges may be interdependent (e.g., deleting a node deletes an edge referencing it even if that edge was not selected). This is expected and required.

### 3.4 Palette update (right-hand entity/relationship panel)
- After deletion of diagram_nodes or diagram_edges:
  - The right-hand palette panel must refresh its state so that:
    - Entities whose diagram_nodes were deleted become selectable again.
    - Relationships whose diagram_edges were deleted become selectable again.
- The palette must detect diagram membership dynamically from diagrams[].

### 3.5 Persistence
- Deleted nodes/edges must no longer appear in the JSON after Save.
- Reloading JSON must not restore previously deleted elements.

---

## 4) Acceptance criteria

- User can drag on empty canvas to create a dotted rectangle; releasing selects all fully enclosed elements.
- Ctrl + drag-select adds to existing selection; without Ctrl, selection replaces previous.
- Multi-selected nodes/edges move together when dragging any selected node.
- All edge_point movement behaviour works identically for group moves as for single moves (honoring the node-attachment tolerance rule).
- Pressing Delete/Backspace removes selected nodes/edges and any now-invalid edges.
- JSON save/load cycles correctly reflect deletions.
- The right-hand palette panel updates immediately, enabling re-adding deleted entities/relationships.
