# Diagrams Edge Interactions - Specification

## Overview

This specification extends the editable Diagrams view (v0.2) with richer interactions for diagram_edges:
1. Selecting edges and showing draggable edge_point handles
2. Dragging edge labels by clicking the text
3. Auto-adjusting label position when moving endpoints of straight-line edges
4. Persisting all changes to JSON for round-trip save/reload

## Problem Statement

The current v0.2 Diagrams view allows selecting, moving, and resizing nodes, but diagram_edges are not directly manipulable. Users cannot:
- Adjust edge routing by dragging edge_points
- Reposition edge labels for better readability
- Have labels automatically stay centered on straight-line edges

These capabilities are essential for creating well-organized architecture diagrams.

## Requirements

### 1. Edge Selection and Draggable Edge Point Handles

#### Edge Selection Behavior

**Click-to-select:**
- When user clicks on a diagram_edge polyline (within hit tolerance):
  - That edge becomes the "selected edge"
  - Show visual selection indicator (e.g., thicker stroke, different color)
  - Display point handles at each edge_point position

**Hit tolerance:**
- Use a reasonable tolerance for clicking the line (e.g., 4-6px from the line)
- User should not need to click exact pixel

**Selection state:**
- Only one edge can be selected at a time (in addition to one node)
- Clicking on canvas background deselects edge
- Clicking on another edge transfers edge selection
- Edge selection is separate from node selection (both can exist simultaneously)

#### Edge Point Handles

**Visual appearance:**
- Small filled circles at each edge_point position
- Size: 6px diameter
- Fill: #1976D2 (selection blue)
- Stroke: white, 1px
- Drawn on top of the polyline for visibility

**Handle rendering:**
```typescript
// For selected edge, render handle at each edge_point
for (const point of edge.edge_points) {
  renderCircle(point.pos_x, point.pos_y, handleRadius, handleStyles);
}
```

#### Edge Point Dragging

**Initiation:**
- When edge is selected and user clicks on a point handle:
  - Enter "edge point drag" mode for that specific edge_point
  - Cursor changes to indicate drag (e.g., `cursor: move`)

**During drag:**
- Track mouse movement
- Update edge_point position in real-time:
  ```typescript
  point.pos_x = mouseX;
  point.pos_y = mouseY;
  ```
- Re-render polyline continuously with updated positions

**On mouse up:**
- Commit final position to diagram_edge.edge_points[]
- Update in-memory model

**Hit testing for handles:**
- Use radius-based hit detection (e.g., 6px radius)
- Check if click point is within radius of any handle center:
  ```typescript
  function isPointOnHandle(clickX, clickY, handleX, handleY, radius = 6): boolean {
    const dx = clickX - handleX;
    const dy = clickY - handleY;
    return (dx * dx + dy * dy) <= (radius * radius);
  }
  ```

### 2. Edge Label Dragging

#### Label Selection

**Click-to-select:**
- When user clicks directly on edge label text:
  - That label becomes selected
  - Show visual highlight (e.g., blue text color or subtle blue outline)

**Visual feedback:**
```typescript
// Selected label styling
const labelStyle = isSelected
  ? { fill: '#1976D2', fontWeight: 'bold' }  // Selected state
  : { fill: '#333', fontWeight: 'normal' };   // Normal state
```

**Selection state:**
- Label selection is separate from edge selection
- Clicking label selects label (for dragging)
- Clicking line selects edge (for point handles)
- Both can coexist

#### Label Dragging

**Initiation:**
- When label is selected and user presses mouse on it:
  - Enter "label drag" mode
  - Cursor changes to `move`

**During drag:**
- Track movement delta from drag start
- Update label position in real-time:
  ```typescript
  new_label_pos_x = original_label_pos_x + (mouseX - dragStartX);
  new_label_pos_y = original_label_pos_y + (mouseY - dragStartY);
  ```

**On mouse up:**
- Commit final position:
  ```typescript
  edge.label_pos_x = final_x;
  edge.label_pos_y = final_y;
  ```
- Update in-memory model

#### Label Hit Testing

- Calculate text bounding box based on:
  - Text content
  - Font size
  - Text anchor position
- Check if click point is within bounding box:
  ```typescript
  function isPointOnLabel(
    clickX: number,
    clickY: number,
    labelX: number,
    labelY: number,
    textWidth: number,
    textHeight: number
  ): boolean {
    // Assuming text anchor is start (left-aligned)
    return (
      clickX >= labelX &&
      clickX <= labelX + textWidth &&
      clickY >= labelY - textHeight &&
      clickY <= labelY
    );
  }
  ```

### 3. Auto-Adjust Label Position for Straight-Line Edges

#### Definition

A "straight-line edge" is a diagram_edge where:
```typescript
edge.edge_points.length === 2
```

#### Auto-Adjustment Behavior

When user drags an edge_point of a straight-line edge:

1. Apply movement delta (dx, dy) to the edge_point
2. Also adjust label position by half the delta:
   ```typescript
   edge.label_pos_x += dx / 2;
   edge.label_pos_y += dy / 2;
   ```

**Rationale:**
- Keeps label roughly centered between the two endpoints
- Moving one endpoint by 20px moves label by 10px toward that end

#### Example

Before move:
- edge_points[0]: (100, 100)
- edge_points[1]: (200, 100)
- label: (150, 90) - centered between endpoints

User drags edge_points[1] by (+40, +20):
- edge_points[1] becomes (240, 120)
- label becomes (150 + 20, 90 + 10) = (170, 100)

The label shifts halfway toward the moved endpoint, staying relatively centered.

#### Implementation

```typescript
function moveEdgePointWithLabelAdjust(
  edge: DiagramEdge,
  pointIndex: number,
  dx: number,
  dy: number
): void {
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

#### Interaction with Manual Label Dragging

- Auto-adjustment applies even if label was manually positioned before
- User can always override by manually dragging label after moving endpoint
- No "lock" or "auto-center" toggle in this version

### 4. Persistence Requirements

All edge interactions must update the in-memory model and persist through save/reload.

#### In-Memory Updates

**For edge point moves:**
```typescript
// Update edge_points array in diagram
const diagram = state.model.diagrams.find(d => d.id === diagramId);
const edge = diagram.diagram_edges.find(e => e.id === edgeId);
edge.edge_points[pointIndex].pos_x = newX;
edge.edge_points[pointIndex].pos_y = newY;
```

**For label moves:**
```typescript
edge.label_pos_x = newLabelX;
edge.label_pos_y = newLabelY;
```

#### State Management Actions

Add new action types to ArchitectureContext:

```typescript
type AppAction =
  | // ... existing actions ...
  | {
      type: 'UPDATE_EDGE_POINT';
      diagramId: string;
      edgeId: string;
      pointIndex: number;
      pos_x: number;
      pos_y: number;
      adjustLabel?: boolean; // For straight-line auto-adjust
    }
  | {
      type: 'UPDATE_EDGE_LABEL_POSITION';
      diagramId: string;
      edgeId: string;
      label_pos_x: number;
      label_pos_y: number
    };
```

#### JSON Round-Trip

The existing save mechanism must serialize:
- `diagram_edges[].edge_points[].pos_x`, `pos_y`
- `diagram_edges[].label_pos_x`, `label_pos_y`

After save and reload:
- Edges render with updated point positions
- Labels render at updated positions
- All changes preserved exactly

## Implementation Changes

### Files to Modify

1. **`frontend/src/components/DiagramsView/Canvas.tsx`**
   - Add edge selection state (`selectedEdgeId`)
   - Add label selection state (`selectedLabelEdgeId`)
   - Render edge point handles for selected edge
   - Handle mouse events for edge/label selection and dragging
   - Implement edge point drag operations
   - Implement label drag operations
   - Apply straight-line label auto-adjustment

2. **`frontend/src/contexts/ArchitectureContext.tsx`**
   - Add `UPDATE_EDGE_POINT` action and reducer
   - Add `UPDATE_EDGE_LABEL_POSITION` action and reducer
   - Handle label auto-adjustment in edge point reducer

3. **`frontend/src/utils/rendering.ts`**
   - Add `isPointOnLine()` function for edge hit testing
   - Add `getTextBoundingBox()` function for label hit testing
   - Add `isPointOnHandle()` function for handle hit testing

4. **`frontend/src/components/DiagramsView/DiagramsView.module.css`**
   - Add styles for edge point handles
   - Add styles for selected edge (highlight)
   - Add styles for selected label (highlight)

5. **`frontend/src/config/defaults.ts`**
   - Add edge interaction configuration:
     - `edgePointHandleSize`: 6
     - `edgeHitTolerance`: 5
     - `labelHandleRadius`: 6

### Selection State Management

```typescript
// In Canvas.tsx
const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
const [selectedLabelEdgeId, setSelectedLabelEdgeId] = useState<string | null>(null);

// Drag state extension
interface EdgeDragState {
  isDragging: boolean;
  dragType: 'edgePoint' | 'label' | null;
  edgeId: string;
  pointIndex?: number;  // For edge point drag
  startX: number;
  startY: number;
  originalValue: { pos_x: number; pos_y: number };
}
```

### Event Handling Flow

#### Mouse Down

```typescript
function handleMouseDown(event: React.MouseEvent) {
  const { x, y } = getCanvasCoordinates(event);

  // Priority order for hit testing:
  // 1. Resize handles on selected node
  // 2. Edge point handles on selected edge
  // 3. Label of any edge
  // 4. Node body
  // 5. Edge line
  // 6. Empty canvas

  // Check edge point handles
  if (selectedEdgeId) {
    const pointIndex = getEdgePointHandleAtPoint(x, y, selectedEdge);
    if (pointIndex !== null) {
      startEdgePointDrag(event, selectedEdge, pointIndex);
      return;
    }
  }

  // Check labels
  const labelEdge = findLabelAtPoint(x, y, edges);
  if (labelEdge) {
    setSelectedLabelEdgeId(labelEdge.id);
    startLabelDrag(event, labelEdge);
    return;
  }

  // Check nodes (existing logic)
  // ...

  // Check edge lines
  const clickedEdge = findEdgeAtPoint(x, y, edges);
  if (clickedEdge) {
    setSelectedEdgeId(clickedEdge.id);
    setSelectedLabelEdgeId(null);
    return;
  }

  // Empty canvas - deselect
  setSelectedEdgeId(null);
  setSelectedLabelEdgeId(null);
}
```

### Edge Hit Testing

```typescript
// Check if point is near polyline
function isPointNearPolyline(
  px: number,
  py: number,
  points: Array<{ pos_x: number; pos_y: number }>,
  tolerance: number = 5
): boolean {
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];

    if (distanceToLineSegment(px, py, p1.pos_x, p1.pos_y, p2.pos_x, p2.pos_y) <= tolerance) {
      return true;
    }
  }
  return false;
}

// Distance from point to line segment
function distanceToLineSegment(
  px: number, py: number,
  x1: number, y1: number,
  x2: number, y2: number
): number {
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

## Acceptance Criteria

### Edge Selection

- [ ] Clicking on edge line selects the edge
- [ ] Selected edge shows visual highlight
- [ ] Point handles appear at each edge_point position
- [ ] Clicking canvas background deselects edge
- [ ] Clicking different edge transfers selection

### Edge Point Dragging

- [ ] Can drag edge point handles
- [ ] Polyline updates in real-time during drag
- [ ] Final position committed on mouse up
- [ ] Position persisted to JSON on save
- [ ] Reload shows edge with updated points

### Label Selection and Dragging

- [ ] Clicking on label text selects it
- [ ] Selected label shows visual highlight
- [ ] Can drag label to new position
- [ ] Label position updates in real-time
- [ ] Final position committed on mouse up
- [ ] Position persisted to JSON on save
- [ ] Reload shows label at updated position

### Straight-Line Auto-Adjust

- [ ] Moving endpoint of 2-point edge auto-adjusts label
- [ ] Label moves by half the endpoint delta
- [ ] Works for both edge_points[0] and edge_points[1]
- [ ] Manual label drag can override auto-position
- [ ] Only applies to edges with exactly 2 points

### Persistence

- [ ] Edge point positions persist after save/reload
- [ ] Label positions persist after save/reload
- [ ] All edge changes round-trip correctly

### Interaction Consistency

- [ ] Edge selection separate from node selection
- [ ] Label selection separate from edge selection
- [ ] Cursor feedback for all drag operations
- [ ] Hit testing works reliably

## Out of Scope

- Adding or deleting edge_points
- Creating or deleting edges
- Automatic edge routing
- Curved edges or bezier paths
- Label rotation
- Multi-edge selection

## Testing

### Test 1: Edge Selection

1. Click on an edge polyline
2. Verify selection indicator appears
3. Verify point handles appear at all edge_points
4. Click on canvas background
5. Verify selection clears and handles disappear

### Test 2: Edge Point Dragging

1. Select an edge
2. Drag one of the point handles
3. Verify polyline updates in real-time
4. Release mouse
5. Save JSON and reload
6. Verify edge shape preserved

### Test 3: Label Selection and Dragging

1. Click on edge label text
2. Verify label highlight appears
3. Drag label to new position
4. Verify label follows cursor
5. Release mouse
6. Save JSON and reload
7. Verify label at new position

### Test 4: Straight-Line Auto-Adjust

1. Create edge with exactly 2 edge_points
2. Note label position (roughly centered)
3. Drag one endpoint 40px to the right
4. Verify label moves 20px to the right
5. Save and reload
6. Verify both edge and label positions preserved

### Test 5: Combined Interactions

1. Select an edge and move a point
2. Then drag the label manually
3. Then move another point
4. Verify all changes work correctly
5. Save and reload
6. Verify complete state preserved

### Test 6: Selection Priority

1. Have overlapping edge, label, and node
2. Click on label area - verify label selected
3. Click on edge line - verify edge selected
4. Click on node - verify node selected
5. Verify correct behavior for each target

## Configuration Constants

```typescript
// Add to frontend/src/config/defaults.ts

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

## Visual Reference

### Edge Selection State

```
Normal edge:
    ●───────────●───────────●
         "Label"

Selected edge with handles:
    ⬤───────────⬤───────────⬤  (blue circles at points)
         "Label"

Selected label:
    ●───────────●───────────●
        ["Label"]  (blue highlight)
```

### Straight-Line Label Auto-Adjust

```
Before: A─────────[Label]─────────B
        │                         │
        ●                         ●

After moving B right by 40px:
        A─────────────[Label]───────────B'
        │                   │           │
        ●                   +20px       ●
```
