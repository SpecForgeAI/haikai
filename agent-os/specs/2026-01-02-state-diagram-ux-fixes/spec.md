# Specification: State Diagram UX Fixes

## Goal
Implement three UX fixes for State diagrams: (1) StateTransition edges anchor at node borders instead of centers, (2) State node labels default to centered alignment with H/V alignment control support, and (3) RHS palette rows reflect on-diagram status with Add/Delete context menu toggle and cascading delete for dependent edges.

## User Stories
- As a diagram author, I want state transition arrows to start and end at the visual boundary of state nodes so my diagrams look professionally rendered without overlapping lines.
- As a diagram author, I want newly created State node labels to be centered by default and adjustable via the existing alignment toolbar so I have consistent visual control.
- As a diagram author, I want the RHS palette to show which States and State Transitions are already on my diagram (greyed out) with right-click options to remove them, so I can easily manage diagram composition.

## Specific Requirements

**Edge-to-edge border anchoring for StateTransition edges**
- StateTransition edges must start at source node boundary and end at target node boundary, not at node centers
- Arrowhead must be placed at the target boundary point with correct angle based on final segment direction
- Works correctly when nodes are resized or moved (boundary points recalculated dynamically)
- Hit-testing/selection geometry must match the rendered anchored path
- Reuse existing geometry utilities from `geometryUtils.ts` (getBoundaryAnchorPoint, getRectangleBoundaryPoint, getCircleBoundaryPoint)
- StateKind-to-ShapeKind mapping: Initial/Final -> Circle, Normal -> RoundedRect

**State label default alignment (CENTER/MIDDLE)**
- Newly created State nodes must have `text_h_align: 'CENTER'` and `text_v_align: 'MIDDLE'` set by default
- These defaults apply only to Normal state nodes (Initial/Final nodes do not display labels)
- Settings must be persisted on the DiagramNode, not applied via CSS-only styling

**State label alignment controls integration**
- When a Normal State node is selected, pressing H alignment buttons [L/C/R] updates `text_h_align` field on the DiagramNode
- When a Normal State node is selected, pressing V alignment buttons [T/M/B] updates `text_v_align` field on the DiagramNode
- StateDiagramRenderer already respects these fields via `getTextAnchor`, `getTextX`, `getTextY` helper functions
- Alignment settings must persist after deselect/reselect and after save/reload

**RHS grey-out for on-diagram items**
- Compute on-diagram status from diagram contents: stateOnDiagram(stateId) checks if any node in diagram_nodes references that state entity_id
- Compute on-diagram status for transitions: transitionOnDiagram(transitionId) checks if any edge in diagram_edges references that transition relationship_id
- Apply greyed-out/disabled styling to RHS rows for items already present on the diagram
- Row must remain right-clickable even when greyed out

**RHS context menu Add/Delete toggle**
- If item is on diagram: context menu shows "Delete" (not "Add")
- If item is not on diagram: context menu shows "Add"
- Remove any conflicting menu items (no "Add" for already-present items)

**Delete behaviour (diagram only)**
- Delete State: remove the corresponding DiagramNode from diagram_nodes
- Delete State cascades: also remove any DiagramEdges (StateTransition edges) where source_node_id or target_node_id references the deleted node
- Delete StateTransition: remove the corresponding DiagramEdge from diagram_edges
- Meta-model entities remain unchanged (diagram-only operation)
- After deletion, row styling reverts to normal and context menu shows "Add"

**Add behaviour (diagram only)**
- Add State: create DiagramNode at spawn position (100,100) with default dimensions and appropriate z-index
- Add StateTransition: create DiagramEdge referencing source/target nodes; if source or target node not on diagram, block with toast "Add source/target states first"
- Keep behaviour consistent with existing State diagram palette add logic

## Visual Design
No visual mockups provided.

## Existing Code to Leverage

**`frontend/src/utils/geometryUtils.ts` - Boundary anchor calculation**
- `getBoundaryAnchorPoint(sourceRect, targetRect, shapeKind)` calculates intersection point on shape boundary
- `getRectangleBoundaryPoint(sourceRect, targetCenter)` for Normal state nodes (rounded rectangles)
- `getCircleBoundaryPoint(circleRect, targetCenter)` for Initial/Final state nodes (circles)
- `getEdgeBoundaryPoints(sourceRect, targetRect, sourceShapeKind, targetShapeKind)` convenience wrapper
- ShapeKind enum: RoundedRect, Diamond, Circle already defined

**`frontend/src/components/DiagramsView/StateDiagramRenderer.tsx` - State diagram rendering**
- StateTransitionElement component currently uses center-to-center rendering (lines 322-330)
- StateNodeElement component already applies text_h_align/text_v_align via getTextAnchor, getTextX, getTextY helpers (lines 124-188)
- nodeMap lookup available for resolving source/target nodes from edge references

**`frontend/src/utils/stateTransitionRendering.ts` - Transition edge rendering**
- renderStateTransition(sourcePosition, targetPosition, label) creates line path and arrowhead
- calculateArrowhead utility from rendering.ts used for arrowhead geometry
- Update to accept boundary points instead of center points

**`frontend/src/components/DiagramsView/PalettePanel.tsx` - RHS palette logic**
- Existing pattern for checking if entities are on diagram (nodeExistsForEntity utility)
- Context menu state management via contextMenuState/setContextMenuState
- onAddNode, onDeleteNode, onDeleteEdges callbacks available for diagram mutations
- TransitionCreationMode state pattern for State Transition creation flow

**`frontend/src/utils/nodeCreation.ts` - Node creation utilities**
- createDiagramNodeFromEntity(entity_type, entity_id, existingNodes) creates DiagramNode at fixed spawn position (100,100)
- calculateZIndex(existingNodes) ensures proper z-ordering
- Extend to set default text_h_align/text_v_align for STATE entity type

## Out of Scope
- No backend/persistence layer changes
- No changes to Sequence diagram behaviour
- No changes to ER diagram behaviour
- No changes to Activity diagram behaviour
- No new diagram types
- No new persistence formats
- No changes to meta-model entity structures
- No changes to other entity type RHS behaviour (only States and State Transitions affected)
- No auto-add of missing states when adding a StateTransition (block with toast instead)
- No changes to diagram_type detection or filtering logic
