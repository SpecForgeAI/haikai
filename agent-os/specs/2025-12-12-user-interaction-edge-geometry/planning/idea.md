# Idea: User Interaction Edge Geometry - USER_LINK to Midpoint and Border Anchoring

## Summary

User Interactions are now rendering correctly with the MAIN dotted line between two App nodes visible. Two final geometry corrections are required:

1. **USER_LINK to Midpoint (Case A)**: When both primary and secondary AppBusinessPoints exist, a second dotted USER_LINK line should render from the User node to the midpoint of the MAIN interaction line. This USER_LINK should be independently deletable.

2. **Border Anchoring**: The MAIN dotted line currently stores node center positions in its edge_points. It should instead anchor to the border/edge of each box so the line terminates at the rectangle boundary (not inside the boxes).

## Current Implementation Issues

### Issue 1: USER_LINK Edge Not Rendering
- `createUserInteractionUserLinkEdge()` exists in `userInteractionUtils.ts` (lines 531-568)
- Uses `target_node_id: "midpoint-${interaction.id}"` (virtual node that doesn't exist)
- Rendering likely fails silently because there's no actual node to resolve

### Issue 2: Center-to-Center Line Drawing
- `createUserInteractionMainEdge()` stores node center positions directly in `edge_points`
- Other relationship types use `calculateEdgePoints()` from `relationshipUtils.ts` which calculates border anchors
- USER_INTERACTION edges bypass this border calculation

## Desired Behaviour

### Case A (Primary + Secondary AppBusinessPoint)
When adding interaction:
1. MAIN dotted line anchored to box borders of primary and secondary nodes
2. USER_LINK dotted line from User node border to MAIN edge midpoint
3. Label at MAIN edge midpoint

### Border Anchoring
- All USER_INTERACTION edges should use border-to-border anchoring
- Leverage existing `calculateEdgePoints()` infrastructure from `relationshipUtils.ts`
- Or apply border calculation at render time

### Deletion Semantics
- Interaction is "on diagram" if MAIN edge exists (regardless of USER_LINK)
- USER_LINK can be deleted independently without removing interaction
- Delete action removes both MAIN and USER_LINK

## Key Files

| File | Relevance |
|------|-----------|
| `frontend/src/utils/userInteractionUtils.ts` | Edge creation (lines 464-568) |
| `frontend/src/utils/relationshipUtils.ts` | Border anchor calculation (lines 544-643) |
| `frontend/src/components/DiagramsView/Canvas.tsx` | Edge rendering (lines 2375-2445) |
| `frontend/src/types/model.ts` | DiagramEdge type (lines 902-969) |

## Acceptance Criteria

1. Case A renders both MAIN and USER_LINK dotted lines
2. USER_LINK targets MAIN edge midpoint (not a node)
3. MAIN line anchors to box borders (no excess line inside rectangles)
4. USER_LINK can be deleted independently
5. Palette shows "Delete" as long as MAIN exists
