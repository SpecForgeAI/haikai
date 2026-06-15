# Task Breakdown: Activity Diagram UX Fixes

## Overview
Total Tasks: 32 sub-tasks across 5 task groups

This spec addresses five UX/rendering defects in Activity diagrams:
1. Square-only resize for symbol nodes (Initial/Decision/Merge/Final)
2. Correct edge anchoring to visible shape boundaries
3. RHS palette greying and delete context menu for items already on diagram
4. Draggable ActivityFlow edge labels
5. Draggable Decision node labels (positioned below diamond)

## Task List

### Canvas Resize and Geometry Layer

#### Task Group 1: Square-Only Resize for Symbol Nodes
**Dependencies:** None

- [x] 1.0 Complete square-only resize enforcement for Activity symbol nodes
  - [x] 1.1 Write 4-6 focused tests for square resize behavior
    - Test 1: Verify corner resize (TL/TR/BL/BR) maintains square aspect ratio
    - Test 2: Verify edge resize (TC/BC/ML/MR) applies delta to both dimensions
    - Test 3: Verify no minimum size constraints for Initial/Decision/Merge/Final kinds
    - Test 4: Verify Action nodes retain standard rectangular resize behavior
    - Test 5: Verify resized node bounds match rendered symbol dimensions
    - Skip exhaustive tests for all handle combinations and edge cases
  - [x] 1.2 Add helper function getActivityKindForNode in Canvas.tsx or activityNodeRendering.ts
    - Function signature: `getActivityKindForNode(node: DiagramNode, metaModel: MetaModel): ActivityKind | null`
    - Check if node.entity_type === 'ACTIVITY'
    - Lookup activity entity by node.entity_id from metaModel.entities.activities
    - Return activity.activity_kind or null if not found
  - [x] 1.3 Modify calculateResize function in Canvas.tsx for Activity symbol kinds
    - Detect if resizing node is an ACTIVITY entity_type
    - Call getActivityKindForNode to get the activity_kind
    - For kinds in {Initial, Decision, Merge, Final}:
      - Bypass minWidth/minHeight constraints (treat as 0)
      - Enforce square: for corner handles use max(|dx|, |dy|) for both dimensions
      - For edge handles apply delta to perpendicular dimension as well
    - For 'Action' kind: retain standard rectangular resize with min constraints
  - [x] 1.4 Verify activityNodeRendering.ts shape functions use node.width/height
    - Confirm renderInitialNode uses min(width, height)/2 for radius
    - Confirm renderDecisionNode/renderMergeNode diamond fills bounds
    - Confirm renderFinalNode bullseye scales with bounds
    - Remove any hardcoded size clamps that bypass node bounds
  - [x] 1.5 Ensure square resize tests pass
    - Run ONLY the 4-6 tests written in 1.1
    - Verify resize handles enforce square for symbol kinds
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- Initial/Decision/Merge/Final nodes maintain square aspect ratio during resize
- No minimum size enforcement for symbol kinds
- Rendered symbols fill the node bounds accurately
- Action nodes retain standard rectangular resize behavior

---

### Edge Anchoring Layer

#### Task Group 2: Correct Edge Anchoring to Shape Boundaries
**Dependencies:** None (can run in parallel with Task Group 1)

- [x] 2.0 Complete boundary-anchored edge rendering for ActivityFlow edges
  - [x] 2.1 Write 4-6 focused tests for edge boundary anchoring
    - Test 1: Verify edge to/from Action node anchors at rounded-rect boundary
    - Test 2: Verify edge to/from Decision/Merge node anchors at diamond vertices
    - Test 3: Verify edge to/from Initial/Final node anchors at circle perimeter
    - Test 4: Verify arrow endpoints use boundary points, not node centers
    - Test 5: Verify renderActivityFlowWithBoundary is used for all flows
    - Skip exhaustive tests for all edge angle combinations
  - [x] 2.2 Verify geometryUtils.ts has correct boundary functions
    - Confirm getBoundaryAnchorPoint dispatches by ShapeKind
    - Confirm getShapeKindFromActivityKind mapping:
      - Initial/Final -> ShapeKind.Circle
      - Decision/Merge -> ShapeKind.Diamond
      - Action -> ShapeKind.RoundedRect
    - Confirm getRectangleBoundaryPoint, getDiamondBoundaryPoint, getCircleBoundaryPoint work correctly
  - [x] 2.3 Verify ActivityDiagramRenderer uses renderActivityFlowWithBoundary
    - Check ActivityFlowElement component calls renderActivityFlowWithBoundary
    - Verify calculateFlowBoundaryPoints is called with correct activity kinds
    - Confirm source/target activity kinds are looked up from metaModel
  - [x] 2.4 Verify arrow endpoints use boundary points
    - Confirm linePath uses boundary source and target points
    - Confirm arrowheadPath orientation is based on boundary-to-boundary vector
    - Verify visual appearance matches professional UML connectors
  - [x] 2.5 Ensure edge anchoring tests pass
    - Run ONLY the 4-6 tests written in 2.1
    - Verify edges anchor at visible shape boundaries
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- All ActivityFlow edges anchor at visible symbol boundaries
- Arrow endpoints touch shape perimeter, not bounding box
- Edge direction vector computed from boundary points for arrowhead orientation

---

### Palette UX Layer

#### Task Group 3: RHS Palette Greying and Delete Context Menu
**Dependencies:** None (can run in parallel with Task Groups 1-2)

- [x] 3.0 Complete RHS palette item state management for Activity elements
  - [x] 3.1 Write 4-6 focused tests for palette greying and delete behavior
    - Test 1: Verify isActivityOnDiagram returns true when Activity node exists
    - Test 2: Verify isActivityFlowOnDiagram returns true when edge exists
    - Test 3: Verify greyed styling applied to rows for items on diagram
    - Test 4: Verify context menu shows "Delete from diagram" for existing items
    - Test 5: Verify default click on greyed row does nothing or selects element
    - Skip exhaustive tests for all entity types and edge cases
  - [x] 3.2 Add helper functions in PalettePanel.tsx for "already on diagram" detection
    - Add `isActivityOnDiagram(activityId: string, diagram: Diagram): boolean`
      - Check diagram.diagram_nodes for entity_type === 'ACTIVITY' and entity_id match
    - Add `isActivityFlowOnDiagram(flowId: string, diagram: Diagram): boolean`
      - Check diagram.diagram_edges for relationship_type === 'ACTIVITY_FLOW' and relationship_id match
    - Add `isActivityPartitionOnDiagram(partitionId: string, diagram: Diagram): boolean`
      - Check diagram.diagram_nodes for entity_type === 'ACTIVITY_PARTITION' and entity_id match
  - [x] 3.3 Apply greyed/disabled styling to palette rows
    - In Activities/ActivityFlows/ActivityPartitions sections:
      - Call appropriate helper to check if item is on diagram
      - Apply CSS class for disabled state: opacity: 0.5, cursor: default
    - Use existing styles in PalettePanel.module.css or add new disabled class
  - [x] 3.4 Modify default left-click behavior for greyed rows
    - If item is already on diagram:
      - Prevent add action (do nothing)
      - Optionally: select/highlight the existing element on canvas
    - If item is not on diagram:
      - Retain existing add behavior
  - [x] 3.5 Modify context menu for greyed rows
    - If item is already on diagram:
      - Show "Delete from diagram" instead of "Add to diagram"
      - On delete: dispatch REMOVE_NODE or REMOVE_EDGE action
    - If item is not on diagram:
      - Show "Add to diagram" as normal
  - [x] 3.6 Ensure palette greying/delete tests pass
    - Run ONLY the 4-6 tests written in 3.1
    - Verify greyed styling and context menu behavior
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- Activity/ActivityFlow/ActivityPartition items grey out when on diagram
- Left-click on greyed items does not add duplicates
- Right-click shows "Delete from diagram" for existing items
- Delete action removes the element via dispatch

---

### Label Drag Layer

#### Task Group 4: Draggable ActivityFlow Edge Labels
**Dependencies:** Task Groups 1-2 (edge rendering must be complete)

- [x] 4.0 Complete draggable ActivityFlow edge labels
  - [x] 4.1 Write 4-6 focused tests for edge label dragging
    - Test 1: Verify default label position at edge midpoint when label_pos not set
    - Test 2: Verify label renders at stored label_pos_x/y when set
    - Test 3: Verify label hit-testing detects clicks within label bounds
    - Test 4: Verify drag updates edge.label_pos_x/y and dispatches UPDATE_EDGE
    - Test 5: Verify label position persists after save/reload
    - Skip exhaustive tests for all drag directions and edge cases
  - [x] 4.2 Ensure DiagramEdge uses label_pos_x/label_pos_y fields
    - Verify DiagramEdge type in model.ts includes label_pos_x?: number, label_pos_y?: number
    - These fields store persisted label positions for edges
  - [x] 4.3 Compute default label position when not set
    - In ActivityDiagramRenderer.tsx ActivityFlowElement:
      - If edge.label_pos_x/y is null/undefined:
        - Call calculateDefaultActivityFlowLabelPosition from activityNodeRendering.ts
        - Use returned {x, y} for rendering
    - Verify existing code: `edge.label_pos_x ?? flowResult.labelPosition?.x`
  - [x] 4.4 Extend Canvas.tsx label hit-testing for ActivityFlow edges
    - Locate existing edge label drag logic (selectedLabelEdgeId, previewLabelPos)
    - Add hit-testing for ActivityFlow edges:
      - Check if mouse is within label bounds (use measureTextWidth for width)
      - If edge.label_pos is not set, use computed default for hit-testing
    - On mouse down within label bounds:
      - If label_pos not set, initialize to computed default position
      - Enter label drag mode
  - [x] 4.5 Handle label drag move and end
    - On drag move: update previewLabelPos state
    - On drag end: dispatch UPDATE_EDGE with new label_pos_x/y values
    - Ensure label position is persisted to edge data
  - [x] 4.6 Ensure edge label drag tests pass
    - Run ONLY the 4-6 tests written in 4.1
    - Verify labels are draggable and positions persist
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- ActivityFlow labels render at stored position or computed default
- Labels are click-draggable to any position
- Drag updates edge.label_pos_x/y via UPDATE_EDGE dispatch
- Label positions persist after save/reload

---

#### Task Group 5: Draggable Decision Node Labels
**Dependencies:** Task Groups 1-2 (node rendering must be complete)

- [x] 5.0 Complete draggable Decision node labels below diamond shape
  - [x] 5.1 Write 4-6 focused tests for Decision label positioning and dragging
    - Test 1: Verify Decision label defaults below diamond (y = node.bottom + 8px)
    - Test 2: Verify LabelDecoration is created for Decision nodes on placement
    - Test 3: Verify inline label suppressed when LabelDecoration exists
    - Test 4: Verify label drag updates LabelDecoration.x/y
    - Test 5: Verify dragging label does not move the Decision node
    - Skip exhaustive tests for all label positions and edge cases
  - [x] 5.2 Verify LabelDecoration mechanism for Decision labels
    - Confirm LABEL_DECORATION_DEFAULTS includes decisionLabelOffset (8px)
    - Confirm createDecisionLabelDecoration in activityNodeRendering.ts creates proper decoration
    - LabelDecoration fields: targetKind='NODE', targetId=node.id, x/y position
  - [x] 5.3 Auto-create LabelDecoration on Decision node placement
    - In Canvas.tsx or nodeCreation.ts when DECISION activity node is created:
      - Call createDecisionLabelDecoration with node position/dimensions
      - Add LabelDecoration to diagram.decorations via dispatch
    - Default position: x = node center, y = node.pos_y + node.height + 8
  - [x] 5.4 Suppress inline label for Decision nodes with LabelDecoration
    - In ActivityDiagramRenderer.tsx:
      - Build nodeLabelDecMap: Map<nodeId, LabelDecoration>
      - For Decision nodes: check if hasExplicitLabel = nodeLabelDecMap.has(node.id)
      - If hasExplicitLabel: skip inline label rendering (showLabel = false)
      - Render via LabelDecorationElement component instead
  - [x] 5.5 Render Decision labels via LabelDecorationElement
    - In ActivityDiagramRenderer.tsx:
      - Filter LabelDecorations with targetKind='NODE' and targetId = Decision node
      - Render using LabelDecorationElement with selection handles
      - Apply onClick handler for selection
  - [x] 5.6 Extend Canvas.tsx label drag for NODE-targeted LabelDecorations
    - Add hit-testing for Decision node labels (LabelDecoration bounds)
    - Leverage existing decorationDragState for move operations
    - On drag: update LabelDecoration.x/y
    - On drag end: dispatch UPDATE_LABEL_DECORATION or UPDATE_DECORATION
    - Ensure dragging label does NOT move the node itself
  - [x] 5.7 Ensure Decision label tests pass
    - Run ONLY the 4-6 tests written in 5.1
    - Verify labels position below diamond and are draggable
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- Decision labels render below diamond shape by default
- LabelDecoration created automatically on Decision node placement
- Inline label suppressed when explicit decoration exists
- Labels are independently draggable without moving the node
- Label positions persist via LabelDecoration mechanism

---

### Testing

#### Task Group 6: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-5

- [x] 6.0 Review existing tests and fill critical gaps only
  - [x] 6.1 Review tests from Task Groups 1-5
    - Review the 4-6 tests written by Task 1.1 (square resize)
    - Review the 4-6 tests written by Task 2.1 (edge anchoring)
    - Review the 4-6 tests written by Task 3.1 (palette greying)
    - Review the 4-6 tests written by Task 4.1 (edge label drag)
    - Review the 4-6 tests written by Task 5.1 (Decision label drag)
    - Total existing tests: approximately 20-30 tests
  - [x] 6.2 Analyze test coverage gaps for THIS feature only
    - Identify critical user workflows that lack test coverage:
      - Resize then connect flow (verify boundary anchoring after resize)
      - Delete from palette then re-add
      - Label drag then undo
    - Focus ONLY on gaps related to this spec's feature requirements
    - Do NOT assess entire application test coverage
    - Prioritize end-to-end workflows over unit test gaps
  - [x] 6.3 Write up to 8 additional strategic tests maximum
    - Add maximum of 8 new tests to fill identified critical gaps
    - Focus on integration points:
      - Resize Decision node -> verify label follows (or stays at stored position)
      - Edge anchoring after node resize
      - Palette delete -> verify node/edge removed from canvas
    - Do NOT write comprehensive coverage for all scenarios
    - Skip performance tests and accessibility tests unless business-critical
  - [x] 6.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature:
      - Tests from 1.1, 2.1, 3.1, 4.1, 5.1, and 6.3
    - Expected total: approximately 28-38 tests maximum
    - Do NOT run the entire application test suite
    - Verify critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 28-38 tests total)
- Critical user workflows for this feature are covered
- No more than 8 additional tests added when filling in testing gaps
- Testing focused exclusively on this spec's feature requirements

---

## Execution Order

Recommended implementation sequence:

1. **Task Groups 1, 2, 3 (in parallel):**
   - Task Group 1: Square-Only Resize for Symbol Nodes (Canvas.tsx, activityNodeRendering.ts)
   - Task Group 2: Edge Anchoring (geometryUtils.ts, ActivityDiagramRenderer.tsx)
   - Task Group 3: RHS Palette Greying/Delete (PalettePanel.tsx)

   These three groups have no dependencies on each other and can be developed in parallel by different engineers.

2. **Task Groups 4, 5 (after Groups 1-2):**
   - Task Group 4: Draggable ActivityFlow Labels (Canvas.tsx, ActivityDiagramRenderer.tsx)
   - Task Group 5: Draggable Decision Labels (Canvas.tsx, ActivityDiagramRenderer.tsx)

   These depend on edge rendering (Group 2) and node bounds (Group 1) being correct.

3. **Task Group 6: Test Review and Gap Analysis (after Groups 1-5)**
   - Review all tests from prior groups
   - Fill critical integration test gaps
   - Final verification run

---

## Key Files to Modify

| File | Task Groups | Changes |
|------|-------------|---------|
| `frontend/src/components/DiagramsView/Canvas.tsx` | 1, 4, 5 | calculateResize square constraint, label hit-testing and drag |
| `frontend/src/components/DiagramsView/ActivityDiagramRenderer.tsx` | 2, 4, 5 | Verify boundary rendering, label position fallback, Decision label suppression |
| `frontend/src/components/DiagramsView/PalettePanel.tsx` | 3 | isOnDiagram helpers, greyed styling, context menu swap |
| `frontend/src/utils/activityNodeRendering.ts` | 1, 4, 5 | getActivityKindForNode helper, verify shape rendering from bounds |
| `frontend/src/utils/geometryUtils.ts` | 2 | Verify boundary functions, no new changes expected |
| `frontend/src/types/model.ts` | 4, 5 | Verify DiagramEdge.label_pos_x/y, LabelDecoration types |
| `frontend/src/components/DiagramsView/PalettePanel.module.css` | 3 | Add disabled row styling |

---

## Notes and Guidance

- **Centralized geometry:** The geometryUtils.ts boundary functions are already implemented; verify they work correctly before adding new code.
- **Existing patterns:** Leverage existing edge label drag infrastructure (selectedLabelEdgeId, previewLabelPos) in Canvas.tsx for ActivityFlow labels.
- **LabelDecoration reuse:** The Decision label mechanism uses the same LabelDecoration pattern as existing decorations; extend rather than create new patterns.
- **No backend changes:** This spec is frontend-only; no API or schema changes required.
- **State diagram reuse:** Keep boundary intersection logic centralized so State diagram can reuse later (already in geometryUtils.ts).
