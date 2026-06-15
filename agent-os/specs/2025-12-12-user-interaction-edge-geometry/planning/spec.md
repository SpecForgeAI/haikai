# Specification: User Interaction Edge Geometry - USER_LINK to Midpoint and Border Anchoring

## 1. Overview

### 1.1 Problem Statement

User Interactions now render the MAIN dotted line between App nodes. Two geometry issues remain:

1. **Missing USER_LINK Edge**: In Case A (both primary and secondary AppBusinessPoints), a second dotted line should connect the User node to the midpoint of the MAIN edge. The current implementation creates a USER_LINK edge with `target_node_id: "midpoint-${interaction.id}"`, but this virtual node doesn't exist, causing silent rendering failure.

2. **Center-to-Center Anchoring**: The MAIN edge stores node center positions in `edge_points`, resulting in lines that run through the inside of node boxes. Other relationship types use `calculateEdgePoints()` for border-to-border anchoring.

### 1.2 Current Implementation

**USER_INTERACTION Edge Creation**: `frontend/src/utils/userInteractionUtils.ts`

```typescript
// createUserInteractionMainEdge (lines 464-505)
// Stores node CENTER positions directly in edge_points
const edgePoints = [
  { pos_x: sourcePos.x, pos_y: sourcePos.y },  // sourcePos is node center
  { pos_x: targetPos.x, pos_y: targetPos.y },  // targetPos is node center
];

// createUserInteractionUserLinkEdge (lines 531-568)
// Uses virtual target_node_id that doesn't resolve
target_node_id: `midpoint-${interaction.id}`,  // No such node exists
```

**Existing Border Anchor System**: `frontend/src/utils/relationshipUtils.ts`

```typescript
// calculateEdgePoints (lines 544-643)
// Already implements 8-direction border anchoring for other edge types
// Uses angle between centers to determine optimal border anchor point
```

### 1.3 Goals

1. Make USER_LINK edge render correctly by targeting MAIN edge midpoint coordinates
2. Apply border-to-border anchoring for all USER_INTERACTION edges
3. Define clear deletion semantics (USER_LINK independent, MAIN defines "on diagram")
4. Leverage existing infrastructure where possible

### 1.4 Non-Goals

- Changing border anchoring for non-USER_INTERACTION edges (already working)
- Modifying existing `calculateEdgePoints()` function
- Adding complex midpoint anchor node infrastructure (use simpler coordinate approach)

## 2. Technical Design

### 2.1 USER_LINK Midpoint Targeting (Recommended Approach)

**Approach: Store midpoint coordinates directly in USER_LINK edge_points**

Instead of using a virtual `target_node_id`, store the MAIN edge midpoint coordinates directly in the USER_LINK edge's `edge_points[1]` position. This eliminates the need for special target resolution.

**File**: `frontend/src/utils/userInteractionUtils.ts`

**Current Implementation** (lines 531-568):
```typescript
export function createUserInteractionUserLinkEdge(
  interaction: Interaction,
  userNodeId: string,
  midpoint: Point,
  userNodePos: Point
): DiagramEdge {
  const edgePoints = [
    { pos_x: userNodePos.x, pos_y: userNodePos.y },
    { pos_x: midpoint.x, pos_y: midpoint.y },  // Already stores midpoint!
  ];

  return {
    // ...
    source_node_id: userNodeId,
    target_node_id: `midpoint-${interaction.id}`,  // Problem: doesn't exist
    // ...
  };
}
```

**Fix**: Remove the invalid `target_node_id` or set it to empty string:
```typescript
return {
  // ...
  source_node_id: userNodeId,
  target_node_id: '',  // No target node - uses edge_points directly
  // ...
};
```

**Rendering**: The edge already has correct coordinates in `edge_points`. The renderer (`Canvas.tsx`) draws from `edge_points` array, not from node lookups. Setting `target_node_id` to empty prevents failed node resolution.

### 2.2 Border Anchoring for USER_INTERACTION Edges

**Approach: Apply border calculation at edge creation time**

Use the existing `calculateEdgePoints()` function or implement equivalent logic when creating USER_INTERACTION edges.

**Option A: Reuse calculateEdgePoints() (Preferred)**

**File**: `frontend/src/utils/userInteractionUtils.ts`

```typescript
import { calculateEdgePoints } from './relationshipUtils';

export function createUserInteractionMainEdge(
  interaction: Interaction,
  sourceNode: DiagramNode,  // Change: pass full node, not just position
  targetNode: DiagramNode,
  // Remove sourcePos, targetPos - calculate from nodes
): DiagramEdge {
  // Calculate border-anchored edge points
  const edgePoints = calculateEdgePoints(sourceNode, targetNode);

  // Calculate midpoint from border positions for label placement
  const midpoint = {
    x: (edgePoints[0].pos_x + edgePoints[1].pos_x) / 2,
    y: (edgePoints[0].pos_y + edgePoints[1].pos_y) / 2,
  };

  return {
    id: generatePrefixedId('edge'),
    relationship_type: RELATIONSHIP_EDGE_TYPES.USER_INTERACTION,
    relationship_id: interaction.id,
    source_node_id: sourceNode.id,
    target_node_id: targetNode.id,
    subType: 'MAIN',
    line_dashes: LINE_DASHES_DOTTED,
    label_text: interaction.name,
    label_pos_x: midpoint.x,
    label_pos_y: midpoint.y,
    edge_points: edgePoints,
  };
}
```

**Option B: Apply border calculation at render time**

Alternatively, keep center-to-center storage but apply border calculation in the renderer. This is more complex and not recommended since other edge types already store border positions.

### 2.3 USER_LINK Border Anchoring

For USER_LINK, the source is a User node (border anchor needed) and the target is the MAIN midpoint (a point, not a node).

**File**: `frontend/src/utils/userInteractionUtils.ts`

```typescript
export function createUserInteractionUserLinkEdge(
  interaction: Interaction,
  userNode: DiagramNode,  // Change: pass full node
  mainEdgeMidpoint: Point
): DiagramEdge {
  // Calculate border anchor on user node toward midpoint
  const userBorderPoint = calculateBorderAnchorPoint(
    userNode,
    mainEdgeMidpoint
  );

  const edgePoints = [
    {
      id: generatePrefixedId('ep'),
      sequence_order: 0,
      pos_x: userBorderPoint.x,
      pos_y: userBorderPoint.y,
    },
    {
      id: generatePrefixedId('ep'),
      sequence_order: 1,
      pos_x: mainEdgeMidpoint.x,
      pos_y: mainEdgeMidpoint.y,
    },
  ];

  return {
    id: generatePrefixedId('edge'),
    relationship_type: RELATIONSHIP_EDGE_TYPES.USER_INTERACTION,
    relationship_id: interaction.id,
    source_node_id: userNode.id,
    target_node_id: '',  // No target node - midpoint is a coordinate
    subType: 'USER_LINK',
    line_dashes: LINE_DASHES_DOTTED,
    edge_points: edgePoints,
  };
}
```

### 2.4 Border Anchor Helper Function

Extract a single-node border calculation helper from `calculateEdgePoints()`:

**File**: `frontend/src/utils/relationshipUtils.ts` (new function)

```typescript
/**
 * Calculate the border anchor point on a rectangular node
 * toward a target point.
 */
export function calculateBorderAnchorPoint(
  node: DiagramNode,
  targetPoint: Point
): Point {
  const nodeCenter = {
    x: node.pos_x + node.width / 2,
    y: node.pos_y + node.height / 2,
  };

  const dx = targetPoint.x - nodeCenter.x;
  const dy = targetPoint.y - nodeCenter.y;

  // Determine if horizontal or vertical anchor is closer
  if (Math.abs(dx) > Math.abs(dy)) {
    // Horizontal - use left or right edge
    if (dx > 0) {
      return { x: node.pos_x + node.width, y: nodeCenter.y };  // Right edge
    } else {
      return { x: node.pos_x, y: nodeCenter.y };  // Left edge
    }
  } else {
    // Vertical - use top or bottom edge
    if (dy > 0) {
      return { x: nodeCenter.x, y: node.pos_y + node.height };  // Bottom edge
    } else {
      return { x: nodeCenter.x, y: node.pos_y };  // Top edge
    }
  }
}
```

### 2.5 Midpoint Recalculation on Node Move

When nodes are moved, edge endpoints should update. The current approach stores static positions.

**Options:**
1. **Render-time calculation**: Store node IDs, calculate positions during render
2. **Update on move**: Recalculate edge_points when nodes move

**Recommendation**: Option 2 is consistent with existing codebase. When nodes move, update associated edge_points. This may already be implemented for other edges - verify and reuse.

### 2.6 Deletion Semantics

**Interaction "on diagram" definition**:
```typescript
function isInteractionOnDiagram(
  interactionId: string,
  diagramEdges: DiagramEdge[]
): boolean {
  return diagramEdges.some(
    edge =>
      edge.relationship_type === 'USER_INTERACTION' &&
      edge.relationship_id === interactionId &&
      edge.subType === 'MAIN'
  );
}
```

**File**: `frontend/src/utils/advancedAddRelationships.ts` or `PalettePanel.tsx`

Update the logic that determines "action" (add vs delete) to check for MAIN edge specifically:

```typescript
// Current (may check for any edge):
const existingEdges = diagramEdges.filter(
  edge => edge.relationship_id === interaction.id
);
const action = existingEdges.length > 0 ? 'delete' : 'add';

// Updated (check for MAIN edge specifically):
const mainEdgeExists = diagramEdges.some(
  edge =>
    edge.relationship_type === 'USER_INTERACTION' &&
    edge.relationship_id === interaction.id &&
    edge.subType === 'MAIN'
);
const action = mainEdgeExists ? 'delete' : 'add';
```

**Delete action behavior**:
- On Delete: Remove both MAIN and USER_LINK edges for the interaction
- On USER_LINK-only delete (via edge selection): Remove only USER_LINK

## 3. Implementation Plan

### Phase 1: Fix USER_LINK Target Resolution
1. Update `createUserInteractionUserLinkEdge()` to use empty `target_node_id`
2. Verify edge renders using `edge_points` directly

### Phase 2: Apply Border Anchoring
1. Add `calculateBorderAnchorPoint()` helper to `relationshipUtils.ts`
2. Update `createUserInteractionMainEdge()` to use `calculateEdgePoints()`
3. Update `createUserInteractionUserLinkEdge()` to use border anchor for source
4. Update callers to pass full `DiagramNode` objects instead of positions

### Phase 3: Deletion Semantics
1. Update "on diagram" check to look for MAIN edge specifically
2. Verify USER_LINK can be deleted independently
3. Verify Delete action removes both edges

## 4. Acceptance Criteria

### AC1 - USER_LINK Creation and Rendering
- In Case A, when User node exists:
  - Adding interaction produces:
    - MAIN dotted line between the two app nodes
    - USER_LINK dotted line from user node to midpoint of MAIN
    - Label with interaction name at MAIN midpoint

### AC2 - USER_LINK Independent Deletion
- Deleting only USER_LINK:
  - Removes only the user-to-midpoint dotted line
  - MAIN remains
  - Palette/context menu still shows Delete (interaction still "on diagram")

### AC3 - Border Anchoring
- MAIN dotted line begins/ends at box borders (no excess inside rectangles)
- USER_LINK begins at user node border and ends at MAIN midpoint

### AC4 - Delete Action Removes Both
- Using palette/context menu Delete removes:
  - MAIN edge
  - USER_LINK edge
  - Label

## 5. Files Summary

### Files to Modify

| File | Change Description |
|------|-------------------|
| `frontend/src/utils/userInteractionUtils.ts` | Update edge creation to use border anchors, fix USER_LINK target |
| `frontend/src/utils/relationshipUtils.ts` | Add `calculateBorderAnchorPoint()` helper |
| `frontend/src/components/DiagramsView/PalettePanel.tsx` | Update "on diagram" check to use MAIN edge |
| `frontend/src/utils/advancedAddRelationships.ts` | Update relationship action determination if needed |

### Files to Verify

| File | Verification |
|------|-------------|
| `frontend/src/components/DiagramsView/Canvas.tsx` | Ensure edge rendering handles empty target_node_id |
| `frontend/src/types/model.ts` | Verify DiagramEdge type supports changes |

## 6. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Empty target_node_id causes render issues | Low | High | Test rendering with empty target_node_id |
| Existing edge update logic doesn't handle border points | Medium | Medium | Verify node move handlers |
| Breaking other relationship edge rendering | Low | High | Use isolated changes for USER_INTERACTION only |

## 7. Technical Notes

### 7.1 Why Not Use Virtual Midpoint Node?

The spec mentioned Option B (hidden anchor node). This is not recommended because:
1. Adds complexity to diagram state management
2. Requires special handling in node operations (move, delete, save)
3. The current edge_points approach already stores coordinates directly

### 7.2 Edge Rendering Flow

```
DiagramEdge.edge_points[0] → Source position (border anchor)
DiagramEdge.edge_points[1] → Target position (border anchor or midpoint)
Canvas.renderEdge() → Draws SVG path from edge_points
```

The renderer doesn't require valid `target_node_id` - it uses `edge_points` array directly for line drawing.

### 7.3 Existing Infrastructure

The `calculateEdgePoints()` function in `relationshipUtils.ts` (lines 544-643) already implements full border anchor calculation. This should be reused rather than reimplemented.
