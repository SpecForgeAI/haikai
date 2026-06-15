# Task Breakdown: User Interaction Edge Geometry - USER_LINK to Midpoint and Border Anchoring

## Overview
Total Tasks: 18
Estimated Complexity: Medium

## Context

### Current State
- USER_INTERACTION MAIN edge is created and renders between App nodes
- MAIN edge stores node CENTER positions in edge_points (line runs through box interiors)
- USER_LINK edge is created but uses invalid `target_node_id: "midpoint-${interaction.id}"` (fails to render)
- Border anchor calculation exists in `calculateEdgePoints()` (`relationshipUtils.ts:544-643`)
- "On diagram" check looks for ANY USER_INTERACTION edge, not specifically MAIN edge (lines 2124-2127, 2151-2154 in PalettePanel.tsx)

### What Needs to Change
1. Fix USER_LINK to render by using empty target_node_id (edge_points already contain coordinates)
2. Apply border anchoring to MAIN edge using existing `calculateEdgePoints()` infrastructure
3. Apply border anchoring to USER_LINK source (user node border toward midpoint)
4. Update "on diagram" check to look for MAIN edge specifically (add `edge.subType === 'MAIN'`)
5. Ensure USER_LINK can be deleted independently without affecting MAIN edge

## Task List

### Utility Layer

#### Task Group 1: Add Border Anchor Helper Function
**Dependencies:** None

- [x] 1.0 Complete border anchor helper
  - [x] 1.1 Write 4 focused tests for calculateBorderAnchorPoint()
    - File: `frontend/src/__tests__/user-interaction-edge-geometry.test.ts`
    - Test 1: Returns right edge center when target point is to the right of node
    - Test 2: Returns left edge center when target point is to the left of node
    - Test 3: Returns bottom edge center when target point is below node
    - Test 4: Returns top edge center when target point is above node
  - [x] 1.2 Add calculateBorderAnchorPoint() to relationshipUtils.ts
    - File: `frontend/src/utils/relationshipUtils.ts`
    - Location: Add after `calculateEdgePoints()` function (after line 644)
    - Function signature: `(node: DiagramNode, targetPoint: Point) => Point`
    - Logic: Extract single-node portion from existing `calculateEdgePoints()`:
      ```typescript
      export function calculateBorderAnchorPoint(
        node: DiagramNode,
        targetPoint: { x: number; y: number }
      ): { x: number; y: number } {
        const nodeCenter = {
          x: node.pos_x + node.width / 2,
          y: node.pos_y + node.height / 2,
        };
        const dx = targetPoint.x - nodeCenter.x;
        const dy = targetPoint.y - nodeCenter.y;

        if (Math.abs(dx) > Math.abs(dy)) {
          // Horizontal - use left or right edge
          return dx > 0
            ? { x: node.pos_x + node.width, y: nodeCenter.y }
            : { x: node.pos_x, y: nodeCenter.y };
        } else {
          // Vertical - use top or bottom edge
          return dy > 0
            ? { x: nodeCenter.x, y: node.pos_y + node.height }
            : { x: nodeCenter.x, y: node.pos_y };
        }
      }
      ```
  - [x] 1.3 Export function and run tests
    - Add export to file
    - Run: `npm test -- --testPathPattern="user-interaction-edge-geometry" --testNamePattern="calculateBorderAnchorPoint"`
    - Verify all 4 tests pass

**Acceptance Criteria:**
- calculateBorderAnchorPoint() returns correct border positions for all 4 directions
- Function is exported and available for import in userInteractionUtils.ts

**Files to Modify:**
- `frontend/src/utils/relationshipUtils.ts` (add function)
- `frontend/src/__tests__/user-interaction-edge-geometry.test.ts` (create)

---

### Edge Creation Layer

#### Task Group 2: Fix USER_LINK Rendering
**Dependencies:** Task Group 1

- [x] 2.0 Complete USER_LINK rendering fix
  - [x] 2.1 Write 3 focused tests for USER_LINK edge creation
    - File: `frontend/src/__tests__/user-interaction-edge-geometry.test.ts`
    - Test 1: USER_LINK edge has empty string target_node_id (not virtual midpoint ID)
    - Test 2: USER_LINK edge_points[0] is at user node border (not center)
    - Test 3: USER_LINK edge_points[1] is at MAIN edge midpoint coordinates
  - [x] 2.2 Update createUserInteractionUserLinkEdge() target_node_id
    - File: `frontend/src/utils/userInteractionUtils.ts`
    - Location: Line 561
    - Change: `target_node_id: \`midpoint-${interaction.id}\`` to `target_node_id: ''`
    - Rationale: Edge renders from edge_points, not from node lookups
  - [x] 2.3 Update function signature to accept DiagramNode
    - File: `frontend/src/utils/userInteractionUtils.ts`
    - Location: Lines 531-536
    - Change parameter: `userNodePos: Point` to `userNode: DiagramNode`
    - Add import: `import { calculateBorderAnchorPoint } from './relationshipUtils';`
  - [x] 2.4 Apply border anchor calculation to source position
    - File: `frontend/src/utils/userInteractionUtils.ts`
    - Location: Lines 537-551
    - Calculate: `const userBorderPoint = calculateBorderAnchorPoint(userNode, midpoint);`
    - Update edge_points[0]: Use `userBorderPoint.x`, `userBorderPoint.y` instead of `userNodePos.x`, `userNodePos.y`
  - [x] 2.5 Update caller in addUserInteractionToDiagram()
    - File: `frontend/src/utils/userInteractionUtils.ts`
    - Location: Lines 644-649
    - Change: Pass `userNode` DiagramNode instead of `userPos` Point
    - Before: `createUserInteractionUserLinkEdge(interaction, userNode.id, midpoint, userPos)`
    - After: `createUserInteractionUserLinkEdge(interaction, userNode.id, midpoint, userNode)`
  - [x] 2.6 Run USER_LINK tests
    - Run: `npm test -- --testPathPattern="user-interaction-edge-geometry" --testNamePattern="USER_LINK"`
    - Verify all 3 tests pass

**Acceptance Criteria:**
- USER_LINK edge renders correctly (no longer has invalid target_node_id)
- Source position is at user node border (not center)
- Target position is at MAIN edge midpoint

**Files to Modify:**
- `frontend/src/utils/userInteractionUtils.ts`

---

#### Task Group 3: Apply Border Anchoring to MAIN Edge
**Dependencies:** None (can run in parallel with Task Group 1)

- [x] 3.0 Complete MAIN edge border anchoring
  - [x] 3.1 Write 3 focused tests for MAIN edge border anchoring
    - File: `frontend/src/__tests__/user-interaction-edge-geometry.test.ts`
    - Test 1: MAIN edge_points[0] is at source node border (not center)
    - Test 2: MAIN edge_points[1] is at target node border (not center)
    - Test 3: MAIN edge label position is at midpoint of border-anchored points
  - [x] 3.2 Update createUserInteractionMainEdge() function signature
    - File: `frontend/src/utils/userInteractionUtils.ts`
    - Location: Lines 464-469
    - Change parameters from:
      ```typescript
      sourceNodeId: string,
      targetNodeId: string,
      sourcePos: Point,
      targetPos: Point
      ```
      to:
      ```typescript
      sourceNode: DiagramNode,
      targetNode: DiagramNode
      ```
    - Add import at top: `import { calculateEdgePoints } from './relationshipUtils';`
  - [x] 3.3 Replace manual edge_points with calculateEdgePoints()
    - File: `frontend/src/utils/userInteractionUtils.ts`
    - Location: Lines 474-488
    - Replace manual edge_points creation with:
      ```typescript
      const edgePoints = calculateEdgePoints(sourceNode, targetNode);
      ```
    - Update midpoint calculation to use border-anchored points:
      ```typescript
      const midpoint = {
        x: (edgePoints[0].pos_x + edgePoints[1].pos_x) / 2,
        y: (edgePoints[0].pos_y + edgePoints[1].pos_y) / 2,
      };
      ```
  - [x] 3.4 Update node ID references in edge creation
    - Location: Lines 490-495
    - Change: `source_node_id: sourceNodeId` to `source_node_id: sourceNode.id`
    - Change: `target_node_id: targetNodeId` to `target_node_id: targetNode.id`
  - [x] 3.5 Update callers in addUserInteractionToDiagram()
    - File: `frontend/src/utils/userInteractionUtils.ts`
    - Location: Lines 626-636 (Case A) and Lines 661-670 (Case B)
    - Case A - Change:
      ```typescript
      // Before
      createUserInteractionMainEdge(interaction, primaryNode.id, secondaryNode.id, primaryPos, secondaryPos)
      // After
      createUserInteractionMainEdge(interaction, primaryNode, secondaryNode)
      ```
    - Case B - Change:
      ```typescript
      // Before
      createUserInteractionMainEdge(interaction, userNode.id, primaryNode.id, userPos, primaryPos)
      // After
      createUserInteractionMainEdge(interaction, userNode, primaryNode)
      ```
    - Remove unused `getNodeCenter()` calls for MAIN edge (keep for USER_LINK midpoint if needed)
  - [x] 3.6 Update USER_LINK midpoint calculation
    - File: `frontend/src/utils/userInteractionUtils.ts`
    - Location: Lines 640-641
    - The midpoint for USER_LINK should now be calculated from border-anchored positions
    - Get midpoint from MAIN edge creation result or recalculate:
      ```typescript
      const mainEdgePoints = calculateEdgePoints(primaryNode, secondaryNode);
      const midpoint = {
        x: (mainEdgePoints[0].pos_x + mainEdgePoints[1].pos_x) / 2,
        y: (mainEdgePoints[0].pos_y + mainEdgePoints[1].pos_y) / 2,
      };
      ```
  - [x] 3.7 Run MAIN edge border tests
    - Run: `npm test -- --testPathPattern="user-interaction-edge-geometry" --testNamePattern="MAIN"`
    - Verify all 3 tests pass

**Acceptance Criteria:**
- MAIN edge line starts/ends at node borders (not centers/inside boxes)
- Label positioned at midpoint of border-anchored line
- Both Case A and Case B work correctly

**Files to Modify:**
- `frontend/src/utils/userInteractionUtils.ts`

---

### UI Layer

#### Task Group 4: Update "On Diagram" Check for MAIN Edge
**Dependencies:** None (can run in parallel with Groups 1-3)

- [x] 4.0 Complete "on diagram" check update
  - [x] 4.1 Write 4 focused tests for "on diagram" determination
    - File: `frontend/src/__tests__/user-interaction-edge-geometry.test.ts`
    - Test 1: Interaction with MAIN edge returns action='delete'
    - Test 2: Interaction with only USER_LINK edge returns action='add' (not 'delete')
    - Test 3: Interaction with both MAIN and USER_LINK returns action='delete'
    - Test 4: Interaction with no edges returns action='add'
  - [x] 4.2 Update handleAddRelationship() "on diagram" check
    - File: `frontend/src/components/DiagramsView/PalettePanel.tsx`
    - Location: Lines 864-868
    - Change filter to include subType check:
      ```typescript
      // Before
      const existingEdges = (diagram.diagram_edges || []).filter(
        edge =>
          edge.relationship_type === RELATIONSHIP_EDGE_TYPES.USER_INTERACTION &&
          edge.relationship_id === item.id
      );

      // After
      const mainEdgeExists = (diagram.diagram_edges || []).some(
        edge =>
          edge.relationship_type === RELATIONSHIP_EDGE_TYPES.USER_INTERACTION &&
          edge.relationship_id === item.id &&
          edge.subType === 'MAIN'
      );

      if (mainEdgeExists) {
        handleDeleteUserInteraction(item);
      } else {
        handleAddUserInteraction(item);
      }
      ```
  - [x] 4.3 Update getContextMenuRelationshipAction() check
    - File: `frontend/src/components/DiagramsView/PalettePanel.tsx`
    - Location: Lines 2151-2157
    - Change filter to check for MAIN edge subType:
      ```typescript
      // Before
      const existingEdges = (diagram.diagram_edges || []).filter(
        edge =>
          edge.relationship_type === RELATIONSHIP_EDGE_TYPES.USER_INTERACTION &&
          edge.relationship_id === contextMenuState.item.id
      );
      return existingEdges.length > 0 ? 'delete' : 'add';

      // After
      const mainEdgeExists = (diagram.diagram_edges || []).some(
        edge =>
          edge.relationship_type === RELATIONSHIP_EDGE_TYPES.USER_INTERACTION &&
          edge.relationship_id === contextMenuState.item.id &&
          edge.subType === 'MAIN'
      );
      return mainEdgeExists ? 'delete' : 'add';
      ```
  - [x] 4.4 Update isRelationshipContextMenuEnabled() check
    - File: `frontend/src/components/DiagramsView/PalettePanel.tsx`
    - Location: Lines 2124-2132
    - Update the "edges exist" check to look for MAIN edge specifically:
      ```typescript
      // Before
      const existingEdges = (diagram.diagram_edges || []).filter(
        edge =>
          edge.relationship_type === RELATIONSHIP_EDGE_TYPES.USER_INTERACTION &&
          edge.relationship_id === contextMenuState.item.id
      );
      if (existingEdges.length > 0) {
        return true;
      }

      // After
      const mainEdgeExists = (diagram.diagram_edges || []).some(
        edge =>
          edge.relationship_type === RELATIONSHIP_EDGE_TYPES.USER_INTERACTION &&
          edge.relationship_id === contextMenuState.item.id &&
          edge.subType === 'MAIN'
      );
      if (mainEdgeExists) {
        return true; // Enabled for delete action
      }
      ```
  - [x] 4.5 Run "on diagram" tests
    - Run: `npm test -- --testPathPattern="user-interaction-edge-geometry" --testNamePattern="on diagram"`
    - Verify palette shows correct action based on MAIN edge presence

**Acceptance Criteria:**
- Palette shows "Delete" when MAIN edge exists
- Palette shows "Delete" even if only MAIN exists (no USER_LINK)
- Palette shows "Add" if only USER_LINK exists (no MAIN) - edge case for data consistency
- Palette shows "Add" if no edges exist

**Files to Modify:**
- `frontend/src/components/DiagramsView/PalettePanel.tsx`

---

#### Task Group 5: USER_LINK Independent Deletion
**Dependencies:** Task Groups 2, 3, and 4

- [x] 5.0 Complete USER_LINK independent deletion verification
  - [x] 5.1 Write 3 focused tests for deletion semantics
    - File: `frontend/src/__tests__/user-interaction-edge-geometry.test.ts`
    - Test 1: Deleting USER_LINK edge via Canvas selection does not delete MAIN edge
    - Test 2: After USER_LINK deletion, palette still shows "Delete" (MAIN exists)
    - Test 3: Palette Delete action removes both MAIN and USER_LINK edges
  - [x] 5.2 Verify Canvas edge deletion allows USER_LINK-only delete
    - File: `frontend/src/components/DiagramsView/Canvas.tsx`
    - Verify that edge deletion handler does NOT have special logic preventing USER_LINK deletion
    - Check `shouldCascadeDeleteUserLink()` in `userInteractionUtils.ts` (lines 701-708)
    - This function should return null when deleting USER_LINK (only cascades when deleting MAIN)
  - [x] 5.3 Verify handleDeleteUserInteraction() removes both edges
    - File: `frontend/src/components/DiagramsView/PalettePanel.tsx`
    - Location: Lines 793-807
    - Current implementation already filters ALL edges for the interaction (both MAIN and USER_LINK)
    - This is correct behavior - no changes needed
  - [x] 5.4 Run deletion tests
    - Run: `npm test -- --testPathPattern="user-interaction-edge-geometry" --testNamePattern="deletion"`
    - Verify all deletion scenarios work correctly

**Acceptance Criteria:**
- USER_LINK can be deleted via edge selection without affecting MAIN
- Palette Delete action removes both MAIN and USER_LINK edges
- "On diagram" status correctly reflects MAIN edge presence after partial deletion
- `shouldCascadeDeleteUserLink()` only cascades when MAIN is deleted

**Files to Verify (likely no changes needed):**
- `frontend/src/components/DiagramsView/Canvas.tsx` (edge deletion handler)
- `frontend/src/utils/userInteractionUtils.ts` (`shouldCascadeDeleteUserLink()`)
- `frontend/src/components/DiagramsView/PalettePanel.tsx` (`handleDeleteUserInteraction`)

---

### Testing Layer

#### Task Group 6: Test Review and Integration Testing
**Dependencies:** Task Groups 1-5

- [x] 6.0 Complete integration testing
  - [x] 6.1 Review all tests from Task Groups 1-5
    - Task 1.1: 4 tests for calculateBorderAnchorPoint()
    - Task 2.1: 3 tests for USER_LINK edge creation
    - Task 3.1: 3 tests for MAIN edge border anchoring
    - Task 4.1: 4 tests for "on diagram" determination
    - Task 5.1: 3 tests for deletion semantics
    - Total: 17 tests
  - [x] 6.2 Write 1 integration test for full Case A workflow
    - File: `frontend/src/__tests__/user-interaction-edge-geometry.test.ts`
    - Test: Add interaction with User node present creates both MAIN and USER_LINK with correct geometry
      - MAIN edge: border-to-border between primary and secondary nodes
      - USER_LINK edge: user node border to MAIN midpoint
      - Both edges have correct relationship_id and subTypes
  - [x] 6.3 Run all feature-specific tests
    - Run: `npm test -- --testPathPattern="user-interaction-edge-geometry"`
    - Expected: 18 tests pass
    - Do NOT run the entire application test suite
  - [x] 6.4 Manual verification checklist
    - [x] Add User Interaction in Case A scenario (P + S + U all on diagram)
    - [x] Verify MAIN dotted line anchored to box borders (no line inside rectangles)
    - [x] Verify USER_LINK dotted line from user node border to MAIN midpoint
    - [x] Select and delete USER_LINK via Canvas, verify MAIN remains
    - [x] Verify palette still shows "Delete" after USER_LINK-only deletion
    - [x] Use palette Delete action, verify both edges removed
    - [x] Verify palette shows "Add" after full deletion

**Acceptance Criteria:**
- All 18 automated tests pass
- Manual verification confirms correct geometry and deletion behavior
- No regressions in other relationship edge types

**Files:**
- `frontend/src/__tests__/user-interaction-edge-geometry.test.ts`

---

## Execution Order

```
Phase 1 (Parallel):
  - Task Group 1: Add Border Anchor Helper Function
  - Task Group 3: Apply Border Anchoring to MAIN Edge (can start, uses existing calculateEdgePoints)
  - Task Group 4: Update "On Diagram" Check for MAIN Edge

Phase 2 (Depends on Group 1):
  - Task Group 2: Fix USER_LINK Rendering (needs calculateBorderAnchorPoint)

Phase 3 (Depends on Groups 2, 3, 4):
  - Task Group 5: USER_LINK Independent Deletion

Phase 4 (Final):
  - Task Group 6: Test Review and Integration Testing
```

---

## File Summary

### Files to Modify

| File | Change Description |
|------|-------------------|
| `frontend/src/utils/relationshipUtils.ts` | Add `calculateBorderAnchorPoint()` helper function |
| `frontend/src/utils/userInteractionUtils.ts` | Update edge creation: border anchors, fix USER_LINK target_node_id |
| `frontend/src/components/DiagramsView/PalettePanel.tsx` | Update "on diagram" checks to use MAIN edge subType (3 locations) |

### Files to Create

| File | Purpose |
|------|---------|
| `frontend/src/__tests__/user-interaction-edge-geometry.test.ts` | 18 tests for edge geometry and deletion semantics |

### Files to Verify (likely no changes)

| File | Verification |
|------|-------------|
| `frontend/src/components/DiagramsView/Canvas.tsx` | Confirm edge rendering handles empty target_node_id (uses edge_points) |
| `frontend/src/utils/userInteractionUtils.ts` | Verify `shouldCascadeDeleteUserLink()` cascades only for MAIN deletion |

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Empty target_node_id causes render crash | Low | High | Canvas.tsx already renders from edge_points, not node lookups |
| Existing node move handlers don't update border anchors | Medium | Medium | Test node movement after implementation |
| Breaking other relationship edge rendering | Low | High | Changes scoped to USER_INTERACTION only |
| calculateEdgePoints format incompatibility | Low | Low | Same function already used elsewhere |

---

## Success Criteria

The implementation is successful when:

1. **USER_LINK Renders (AC1)**
   - Case A interactions show USER_LINK dotted line from user node to MAIN midpoint
   - USER_LINK starts at user node border, not center
   - USER_LINK uses empty target_node_id (not virtual midpoint ID)

2. **Border Anchoring Works (AC2)**
   - MAIN dotted line starts/ends at box borders
   - No "excess line" visible inside node rectangles
   - USER_LINK starts at user node border

3. **Deletion Semantics Correct (AC3)**
   - USER_LINK can be deleted independently via Canvas edge selection
   - After USER_LINK deletion, palette still shows "Delete" (MAIN exists)
   - Palette Delete action removes both MAIN and USER_LINK

4. **Tests Pass (AC4)**
   - All 18 feature-specific tests in `user-interaction-edge-geometry.test.ts` pass

---

## Technical Notes

### Key Insight: Edge Rendering Uses edge_points Directly

The Canvas renderer draws edges using the `edge_points` array directly (Canvas.tsx lines 2377-2395):
```typescript
const edgePoints = edge.edge_points || [];
const displayPoints = edgePoints.map((_, index) => {
  const displayPoint = getDisplayEdgePoint(edgeData, index);
  return { x: displayPoint.pos_x, y: displayPoint.pos_y };
});

const pathData = displayPoints
  .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
  .join(' ');
```

This means:
1. `target_node_id` can be empty if `edge_points` contains correct coordinates
2. Border positions must be stored in `edge_points` at creation time
3. When nodes move, `edge_points` must be updated (handled by existing node move handlers)

### Existing Infrastructure to Reuse

The `calculateEdgePoints()` function in `relationshipUtils.ts` (lines 544-643) implements:
- Direction detection (angle between centers)
- 4-directional anchor selection (N, S, E, W based on dx vs dy)
- Border intersection calculation

This should be reused for MAIN edge. The new `calculateBorderAnchorPoint()` helper extracts single-node logic for USER_LINK source.

### "On Diagram" Check Locations

Three places in PalettePanel.tsx check for existing USER_INTERACTION edges:
1. `handleAddRelationship()` (line 864-868) - determines add vs delete action
2. `getContextMenuRelationshipAction()` (lines 2151-2157) - context menu action label
3. `isRelationshipContextMenuEnabled()` (lines 2124-2132) - enables menu when edges exist

All three need the `edge.subType === 'MAIN'` condition added.
