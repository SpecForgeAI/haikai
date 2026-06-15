# Task Breakdown: Activity Diagram Shape Bounds and Interactive Labels

## Overview
Total Tasks: 35

This specification addresses four interrelated fixes for Activity diagrams:
- Part A: Unify visual shapes with node bounds (resize behavior)
- Part B: ActivityFlow boundary anchoring against true shapes
- Part C: Decision labels as independent DiagramDecorations
- Part D: ActivityFlow edge labels - clickable and draggable

## Task List

### Shape Rendering Layer

#### Task Group 1: Shape Rendering from Node Bounds
**Dependencies:** None

This group modifies shape rendering functions to use node.width/node.height instead of hardcoded dimensions, ensuring visible shapes match the resizable bounding box.

- [x] 1.0 Complete shape rendering from node bounds
  - [x] 1.1 Write 2-6 focused tests for shape rendering with custom dimensions
    - Test renderDecisionNode() produces diamond points from width/height parameters
    - Test renderMergeNode() produces diamond scaled to smaller default dimensions
    - Test renderInitialNode() uses radius = min(width, height) / 2
    - Test renderFinalNode() uses radius = min(width, height) / 2 for both circles
    - Test that diamond polygon points match formula: [(w/2,0), (w,h/2), (w/2,h), (0,h/2)]
  - [x] 1.2 Update renderDecisionNode() to accept width/height parameters
    - File: `frontend/src/utils/activityNodeRendering.ts`
    - Add optional customWidth and customHeight parameters (matching renderActionNode pattern)
    - Compute diamond polygon from passed dimensions: points = [(w/2,0), (w,h/2), (w/2,h), (0,h/2)]
    - Retain ACTIVITY_NODE_DEFAULTS.Decision as fallback when no parameters provided
  - [x] 1.3 Update renderMergeNode() to accept width/height parameters
    - File: `frontend/src/utils/activityNodeRendering.ts`
    - Add optional customWidth and customHeight parameters
    - Apply same diamond polygon formula as Decision
    - Default size remains smaller (20x20 vs 60x60 for Decision)
  - [x] 1.4 Update renderInitialNode() to accept width/height parameters
    - File: `frontend/src/utils/activityNodeRendering.ts`
    - Add optional customWidth and customHeight parameters
    - Calculate radius = min(width, height) / 2
    - Center circle within bounds
  - [x] 1.5 Update renderFinalNode() to accept width/height parameters
    - File: `frontend/src/utils/activityNodeRendering.ts`
    - Add optional customWidth and customHeight parameters
    - Calculate outer radius = min(width, height) / 2
    - Calculate inner radius proportionally (innerDiameter / diameter ratio preserved)
    - Both circles centered within bounds
  - [x] 1.6 Update renderActivityNode() dispatcher to pass node dimensions
    - File: `frontend/src/utils/activityNodeRendering.ts`
    - Accept optional width/height in addition to position
    - Pass dimensions to shape-specific functions
    - Maintain backward compatibility when dimensions not provided
  - [x] 1.7 Ensure shape rendering tests pass
    - Run ONLY the 2-6 tests written in 1.1
    - Verify diamond polygon formula produces correct points
    - Verify circle radius calculations are correct

**Acceptance Criteria:**
- The 2-6 tests written in 1.1 pass
- renderDecisionNode() and renderMergeNode() produce diamonds from width/height
- renderInitialNode() and renderFinalNode() produce circles from width/height
- No hardcoded pixel sizes remain in shape rendering functions

---

### Renderer Integration Layer

#### Task Group 2: ActivityDiagramRenderer Integration with Node Bounds
**Dependencies:** Task Group 1

This group updates ActivityDiagramRenderer to pass node.width and node.height to shape rendering functions.

- [x] 2.0 Complete renderer integration with node bounds
  - [x] 2.1 Write 2-4 focused tests for renderer shape sizing
    - Test ActivityNodeElement renders diamond matching node.width/node.height
    - Test ActivityNodeElement renders circle inscribed in node bounds
    - Test resized node produces appropriately sized visible shape
  - [x] 2.2 Update ActivityNodeElement to pass node dimensions to renderActivityNode
    - File: `frontend/src/components/DiagramsView/ActivityDiagramRenderer.tsx`
    - Modify call to renderActivityNode() to include node.width and node.height
    - Ensure renderResult reflects actual node dimensions, not defaults
  - [x] 2.3 Update activityRenderResults computation to use node dimensions
    - File: `frontend/src/components/DiagramsView/ActivityDiagramRenderer.tsx`
    - Pass node.width and node.height when calling renderActivityNode()
    - Ensure renderResult.width and renderResult.height match node dimensions
  - [x] 2.4 Ensure renderer integration tests pass
    - Run ONLY the 2-4 tests written in 2.1
    - Verify visible shapes match node bounding box

**Acceptance Criteria:**
- The 2-4 tests written in 2.1 pass
- Diamond shapes fill their node bounds exactly
- Circle shapes are inscribed (radius = min(w,h)/2) within bounds
- Resize operations immediately reflect in visible shape

---

### Boundary Anchoring Layer

#### Task Group 3: ActivityFlow Boundary Anchoring
**Dependencies:** Task Group 1

This group ensures ActivityFlow edges anchor at the true visible shape boundary, not the invisible bounding box rectangle.

- [x] 3.0 Complete boundary anchoring integration
  - [x] 3.1 Write 2-4 focused tests for boundary anchoring
    - Test edge connecting to Decision node touches diamond boundary, not rectangle
    - Test edge connecting to Initial node touches circle perimeter
    - Test edge connecting to Action node touches rounded-rect boundary
    - Test calculateFlowBoundaryPoints returns shape-aware anchor points
  - [x] 3.2 Verify getShapeKindFromActivityKind mapping is correct
    - File: `frontend/src/utils/geometryUtils.ts`
    - Confirm: Initial -> Circle, Action -> RoundedRect, Decision -> Diamond, Merge -> Diamond, Final -> Circle
    - No changes expected if mapping is already correct
  - [x] 3.3 Verify getBoundaryAnchorPoint dispatches correctly for all shapes
    - File: `frontend/src/utils/geometryUtils.ts`
    - Confirm Diamond boundary uses getDiamondBoundaryPoint
    - Confirm Circle boundary uses getCircleBoundaryPoint
    - Confirm RoundedRect boundary uses getRectangleBoundaryPoint
  - [x] 3.4 Verify ActivityDiagramRenderer passes correct activity kinds
    - File: `frontend/src/components/DiagramsView/ActivityDiagramRenderer.tsx`
    - Confirm flowEdgeData includes sourceActivityKind and targetActivityKind
    - Confirm ActivityFlowElement receives and uses these kinds
  - [x] 3.5 Verify renderActivityFlowWithBoundary uses shape-aware anchoring
    - File: `frontend/src/utils/activityNodeRendering.ts`
    - Confirm calculateFlowBoundaryPoints is called with activity kinds
    - Confirm resulting anchor points are used for line path
  - [x] 3.6 Ensure boundary anchoring tests pass
    - Run ONLY the 2-4 tests written in 3.1
    - Verify edges touch visible shape boundaries

**Acceptance Criteria:**
- The 2-4 tests written in 3.1 pass
- Edges to Decision/Merge nodes touch diamond boundary
- Edges to Initial/Final nodes touch circle perimeter
- No edges pass through node interiors

---

### Decision Label Layer

#### Task Group 4: Decision Labels as DiagramDecoration
**Dependencies:** Task Group 1

This group implements Decision node labels as independently draggable DiagramDecorations positioned below the diamond.

- [x] 4.0 Complete Decision label decoration implementation
  - [x] 4.1 Write 3-5 focused tests for Decision label decorations
    - Test Decision node suppresses inline text rendering
    - Test LabelDecoration auto-created when Decision node is created
    - Test LabelDecoration position defaults to below diamond (y = node.y + node.h + 8)
    - Test LabelDecoration has targetKind='NODE' and targetId=node.id
    - Test backfill creates label decorations for existing Decision nodes on diagram load
  - [x] 4.2 Suppress inline text rendering for Decision nodes
    - File: `frontend/src/components/DiagramsView/ActivityDiagramRenderer.tsx`
    - Modify ActivityNodeElement to skip text rendering when activityKind === 'Decision'
    - Decision diamond should have no internal label text
  - [x] 4.3 Create helper function to generate Decision label decoration
    - File: `frontend/src/utils/activityNodeRendering.ts` (or new file)
    - Function: createDecisionLabelDecoration(node: DiagramNode, text: string): LabelDecoration
    - Position: x = node.pos_x + node.width/2 - defaultWidth/2, y = node.pos_y + node.height + 8
    - Set targetKind='NODE', targetId=node.id
    - Use LABEL_DECORATION_DEFAULTS for styling
  - [x] 4.4 Integrate label decoration creation in Decision node creation flow
    - File: `frontend/src/components/DiagramsView/Canvas.tsx` or node creation handler
    - When creating a Decision activity node, also create corresponding LabelDecoration
    - Add LabelDecoration to diagram.label_decorations array
  - [x] 4.5 Implement backfill logic for existing diagrams
    - File: `frontend/src/components/DiagramsView/ActivityDiagramRenderer.tsx` or diagram load handler
    - On diagram load, check for Decision nodes without corresponding label decorations
    - Auto-generate in-memory decorations for missing labels
    - Matching rule: decoration.targetId === node.id
  - [x] 4.6 Ensure Decision label tests pass
    - Run ONLY the 3-5 tests written in 4.1
    - Verify Decision labels appear below diamond
    - Verify labels are selectable and draggable

**Acceptance Criteria:**
- The 3-5 tests written in 4.1 pass
- Decision diamonds have no internal text
- Decision labels appear below diamond with 8px offset
- Labels are independently draggable
- Existing diagrams show labels via backfill

---

### ActivityFlow Label Layer

#### Task Group 5: ActivityFlow Edge Labels - Draggable and Persistent
**Dependencies:** Task Group 3

This group makes ActivityFlow edge labels clickable, draggable, and persistent via edge.label_pos_x/y fields.

- [x] 5.0 Complete ActivityFlow edge label implementation
  - [x] 5.1 Write 3-5 focused tests for edge label interaction
    - Test default label position at edge midpoint with -8px y offset
    - Test persisted label_pos_x/y used when available
    - Test getEdgeDisplayLabel returns condition_expression or trigger_label_text
    - Test edge label is clickable (findLabelAtPoint detects it)
    - Test dragging updates edge.label_pos_x/y
  - [x] 5.2 Extend getEdgeDisplayLabel() to support ACTIVITY_FLOW
    - File: `frontend/src/utils/rendering.ts`
    - Add case for relationship_type === 'ACTIVITY_FLOW'
    - Return flow.condition_expression if present, else flow.trigger_label_text, else empty
    - Lookup ActivityFlow entity from metaModel by edge.relationship_id
  - [x] 5.3 Set default label position on ActivityFlow edge creation
    - File: `frontend/src/utils/activityFlowCreation.ts`
    - When creating DiagramEdge for ACTIVITY_FLOW:
    - Calculate midpoint of source/target boundary points
    - Set edge.label_pos_x = midpoint.x, edge.label_pos_y = midpoint.y - 8
  - [x] 5.4 Ensure ActivityFlowElement uses persisted label position
    - File: `frontend/src/components/DiagramsView/ActivityDiagramRenderer.tsx`
    - Already implemented: labelX = edge.label_pos_x ?? flowResult.labelPosition?.x
    - Verify this logic works correctly
  - [x] 5.5 Integrate with Canvas edge label drag infrastructure
    - File: `frontend/src/components/DiagramsView/Canvas.tsx`
    - Verify findLabelAtPoint detects ACTIVITY_FLOW labels
    - Verify UPDATE_DIAGRAM_EDGE action updates label_pos_x/y
    - Ensure no type filtering excludes ACTIVITY_FLOW edges from label dragging
  - [x] 5.6 Ensure edge label tests pass
    - Run ONLY the 3-5 tests written in 5.1
    - Verify labels are clickable and draggable
    - Verify positions persist across save/load

**Acceptance Criteria:**
- The 3-5 tests written in 5.1 pass
- Flow labels default to midpoint with -8px y offset
- Dragged label positions persist in edge.label_pos_x/y
- Labels display condition_expression or trigger_label_text

---

### Testing Layer

#### Task Group 6: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-5

This group reviews existing tests and fills critical gaps to ensure feature completeness.

- [x] 6.0 Review existing tests and fill critical gaps only
  - [x] 6.1 Review tests from Task Groups 1-5
    - Review the 2-6 tests from Task 1.1 (shape rendering)
    - Review the 2-4 tests from Task 2.1 (renderer integration)
    - Review the 2-4 tests from Task 3.1 (boundary anchoring)
    - Review the 3-5 tests from Task 4.1 (Decision labels)
    - Review the 3-5 tests from Task 5.1 (edge labels)
    - Total existing tests: approximately 12-24 tests
  - [x] 6.2 Analyze test coverage gaps for this feature only
    - Identify critical end-to-end workflows lacking coverage
    - Focus ONLY on gaps related to this spec's requirements
    - Prioritize integration points between task groups
  - [x] 6.3 Write up to 10 additional strategic tests maximum
    - Add tests for integration between shape rendering and boundary anchoring
    - Add tests for Decision label persistence across diagram save/load
    - Add tests for edge label drag with boundary-anchored edges
    - Do NOT write exhaustive unit tests for all edge cases
  - [x] 6.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature
    - Expected total: approximately 22-34 tests maximum
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 22-34 tests total)
- Critical user workflows for this feature are covered
- No more than 10 additional tests added
- Testing focused exclusively on this spec's feature requirements

---

## Execution Order

Recommended implementation sequence:

1. **Shape Rendering Layer** (Task Group 1)
   - Foundation: Update shape functions to use width/height parameters
   - Must complete before renderer integration

2. **Renderer Integration Layer** (Task Group 2)
   - Connect renderer to new shape rendering
   - Enables visible shape resizing

3. **Boundary Anchoring Layer** (Task Group 3)
   - Verify and integrate shape-aware anchoring
   - Depends on shape bounds being correctly rendered

4. **Decision Label Layer** (Task Group 4)
   - Implement Decision labels as decorations
   - Can proceed in parallel with Task Group 3 after Task Group 1

5. **ActivityFlow Label Layer** (Task Group 5)
   - Implement edge label dragging
   - Depends on Task Group 3 for correct anchor points

6. **Testing Layer** (Task Group 6)
   - Final verification and gap analysis
   - Depends on all previous groups

---

## Key Files to Modify

| File | Task Groups | Changes |
|------|-------------|---------|
| `frontend/src/utils/activityNodeRendering.ts` | 1, 4 | Shape functions accept width/height; Decision label helper |
| `frontend/src/components/DiagramsView/ActivityDiagramRenderer.tsx` | 2, 4 | Pass node dimensions; suppress Decision inline text; backfill |
| `frontend/src/utils/geometryUtils.ts` | 3 | Verify shape-to-boundary mapping (likely no changes) |
| `frontend/src/utils/activityFlowCreation.ts` | 5 | Set default label position on edge creation |
| `frontend/src/utils/rendering.ts` | 5 | Extend getEdgeDisplayLabel for ACTIVITY_FLOW |
| `frontend/src/components/DiagramsView/Canvas.tsx` | 4, 5 | Decision decoration creation; edge label drag integration |

---

## Out of Scope (per spec)

- No edge routing or path avoidance algorithms
- No snap-to-grid behavior
- No changes to State or Sequence diagram rendering
- No backend or database schema changes
- No changes to ActivityPartition swimlane rendering
- No changes to Action node label rendering (already uses alignment properties)
- No automatic label repositioning when nodes move
- No multi-line label wrapping for Decision labels
- No inline text editing for labels
- No undo/redo for label drag operations

---

## Implementation Summary

**Completed:** 2026-01-01

All 6 task groups have been implemented and tested:

1. **Task Group 1**: Shape rendering functions (renderDecisionNode, renderMergeNode, renderInitialNode, renderFinalNode) now accept optional width/height parameters and derive visible shapes from node bounds. 14 tests pass.

2. **Task Group 2**: ActivityDiagramRenderer now passes node.width and node.height to renderActivityNode, ensuring visible shapes match node bounding boxes. 6 tests pass.

3. **Task Group 3**: ActivityFlow boundary anchoring verified - edges connect at shape boundaries (diamond, circle, rounded-rect) using shape-aware anchor point calculations. 14 tests pass.

4. **Task Group 4**: Decision label decoration helper (createDecisionLabelDecoration) implemented. Labels are positioned below diamond with 8px offset. 8 tests pass.

5. **Task Group 5**: ActivityFlow edge labels now have default position (midpoint - 8px y offset) set on edge creation. getEdgeDisplayLabel extended to support ACTIVITY_FLOW. 7 tests pass.

6. **Task Group 6**: Test review complete. 49 total tests across 5 new test files, all passing.

**Test Files Created:**
- `frontend/src/__tests__/activity-shape-bounds-rendering.test.ts` (14 tests)
- `frontend/src/__tests__/activity-renderer-integration.test.ts` (6 tests)
- `frontend/src/__tests__/activity-boundary-anchoring.test.ts` (14 tests)
- `frontend/src/__tests__/activity-decision-labels.test.ts` (8 tests)
- `frontend/src/__tests__/activity-edge-labels.test.ts` (7 tests)
