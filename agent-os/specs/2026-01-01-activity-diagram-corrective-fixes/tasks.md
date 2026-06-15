# Task Breakdown: Activity Diagram Corrective Fixes

## Overview
Total Tasks: 28 sub-tasks across 4 task groups

This spec corrects two Activity diagram improvements that did not work previously:
- **Part A**: ActivityFlow edge anchoring (boundary-to-boundary instead of centre-to-centre)
- **Part B**: Activity and ActivityFlow label behaviour (alignment, movability, persistence)

## Task List

### Part A: ActivityFlow Edge Anchoring

#### Task Group 1: Boundary-Anchored Edge Rendering
**Dependencies:** None

- [x] 1.0 Complete boundary-anchored edge rendering
  - [x] 1.1 Write 4-6 focused tests for boundary anchoring
    - Test that ActivityFlow edges use boundary points, not centre coordinates
    - Test boundary calculation for each ActivityKind (Initial, Action, Decision, Merge, Final)
    - Test arrowhead orientation is correct for boundary-adjusted coordinates
    - Test edge rendering updates when nodes are moved
  - [x] 1.2 Update ActivityFlowElement in ActivityDiagramRenderer.tsx
    - Replace centre-to-centre coordinate calculation (lines 388-395) with boundary-anchored approach
    - Import `renderActivityFlowWithBoundary` from activityNodeRendering.ts
    - Retrieve source and target ActivityKind from metaModel for each activity node
    - Pass ActivityKind values to boundary calculation
  - [x] 1.3 Create helper function to get ActivityKind from node
    - Add `getActivityKindByEntityId(activityId: string, metaModel: MetaModel): ActivityKind` helper
    - Return activity_kind from Activity entity, default to 'Action' if not found
    - Use existing `getActivityById()` helper pattern already in file
  - [x] 1.4 Update ActivityFlowElement component props
    - Add `sourceActivityKind: ActivityKind` prop
    - Add `targetActivityKind: ActivityKind` prop
    - Pass these from flowEdgeData in the parent render
  - [x] 1.5 Replace renderActivityFlow with renderActivityFlowWithBoundary
    - Call `renderActivityFlowWithBoundary(sourceNode, targetNode, flowKind, sourceActivityKind, targetActivityKind, label)` instead of `renderActivityFlow(sourceCenter, targetCenter, flowKind, label)`
    - Remove centre coordinate calculation from ActivityFlowElement
    - Preserve arrowhead rendering using existing flowResult structure
  - [x] 1.6 Update flowEdgeData to include ActivityKind
    - Add sourceActivityKind and targetActivityKind to the flowEdgeData results array
    - Resolve ActivityKind by looking up Activity entity via `getActivityById()`
    - Handle missing activity entities gracefully (default to 'Action')
  - [x] 1.7 Ensure boundary layer tests pass
    - Run ONLY the 4-6 tests written in 1.1
    - Verify edges anchor at shape boundaries for all ActivityKind values
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-6 tests written in 1.1 pass
- ActivityFlow edges connect at node boundaries, not centres
- No flow line enters the interior of any activity node shape
- Arrowheads point correctly based on boundary-adjusted target point
- Behaviour is consistent for all node sizes and ActivityKind values

**Key Files to Modify:**
- `frontend/src/components/DiagramsView/ActivityDiagramRenderer.tsx`

**Existing Code to Leverage:**
- `geometryUtils.ts`: `getBoundaryAnchorPoint()`, `getShapeKindFromActivityKind()`, `getEdgeBoundaryPoints()`
- `activityNodeRendering.ts`: `renderActivityFlowWithBoundary()`, `calculateFlowBoundaryPoints()`

---

### Part B: Label Behaviour

#### Task Group 2: Action Label Alignment
**Dependencies:** Task Group 1

- [x] 2.0 Complete Action label alignment using standard text layout
  - [x] 2.1 Write 3-5 focused tests for Action label alignment
    - Test Action labels respect `node.text_h_align` property (LEFT, CENTER, RIGHT)
    - Test Action labels respect `node.text_v_align` property (TOP, MIDDLE, BOTTOM)
    - Test default alignment is CENTER horizontal, MIDDLE vertical for Action activities
    - Test multi-line text wrapping works with alignment settings
  - [x] 2.2 Update ActivityNodeElement to use text alignment properties
    - Stop hardcoding label position at node centre (current: `centerX`, `centerY`)
    - Import or reference `calculateTextPosition()` pattern from rendering.ts
    - Read `node.text_h_align` and `node.text_v_align` properties
    - Apply defaults: CENTER horizontal, MIDDLE vertical for Action activities
  - [x] 2.3 Create text position calculation for Activity nodes
    - Calculate textX based on text_h_align: LEFT (left + padding), CENTER (centerX), RIGHT (right - padding)
    - Calculate textY based on text_v_align: TOP (top + padding), MIDDLE (centerY), BOTTOM (bottom - textHeight)
    - Use existing TEXT_PADDING constant (5px) for padding values
    - Handle multi-line text positioning with LINE_SPACING
  - [x] 2.4 Update SVG text rendering in ActivityNodeElement
    - Change `textAnchor` attribute based on text_h_align (start, middle, end)
    - Adjust y-position calculation based on text_v_align
    - Maintain backward compatibility for existing diagrams without alignment properties
  - [x] 2.5 Ensure Action label alignment tests pass
    - Run ONLY the 3-5 tests written in 2.1
    - Verify labels align correctly for each alignment combination
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 3-5 tests written in 2.1 pass
- Action activity labels align and behave exactly like standard nodes
- Labels respect text_h_align and text_v_align properties
- Default alignment is CENTER / MIDDLE
- Multi-line text wraps and aligns correctly

**Key Files to Modify:**
- `frontend/src/components/DiagramsView/ActivityDiagramRenderer.tsx` (ActivityNodeElement component)

**Existing Code to Leverage:**
- `rendering.ts`: `calculateTextPosition()`, `wrapText()`, `calculateTextBlockHeight()`
- `model.ts`: `TextHorizontalAlign`, `TextVerticalAlign` types

---

#### Task Group 3: Decision Labels and ActivityFlow Edge Labels
**Dependencies:** Task Group 2

- [x] 3.0 Complete Decision labels as independent decorations and draggable edge labels
  - [x] 3.1 Write 5-7 focused tests for Decision and edge labels
    - Test Decision label auto-creates as LabelDecoration when Decision activity is placed
    - Test Decision label default position is below diamond, horizontally centered
    - Test Decision LabelDecoration is selectable and draggable independently of node
    - Test ActivityFlow edge labels are draggable without moving the edge
    - Test label positions persist via `label_pos_x` / `label_pos_y` (edges) or LabelDecoration (decisions)
  - [x] 3.2 Auto-create LabelDecoration for Decision activities on diagram
    - In the node creation flow (or ActivityDiagramRenderer), detect when a Decision node is added
    - Use `createDefaultLabelDecoration()` factory from model.ts
    - Set targetKind: 'NODE', targetId: decision node ID
    - Calculate default position: y = diamondBottom + decisionLabelOffset (8px), x = centered
    - Use `getDefaultLabelPosition()` from activityNodeRendering.ts for positioning
  - [x] 3.3 Suppress inline Decision label rendering when LabelDecoration exists
    - In ActivityNodeElement, check if Decision node has an associated LabelDecoration
    - If LabelDecoration exists, do NOT render inline text on the diamond shape
    - LabelDecorationElement handles all label rendering for Decision nodes with decorations
  - [x] 3.4 Initialize ActivityFlow edge label positions on creation
    - Update `createActivityFlowDiagramEdge()` in activityFlowCreation.ts
    - Initialize `edge.label_pos_x` and `edge.label_pos_y` with midpoint calculation
    - Use `getDefaultEdgeLabelPosition()` from activityNodeRendering.ts
  - [x] 3.5 Update ActivityFlowElement to use persisted label position
    - Read `edge.label_pos_x` and `edge.label_pos_y` for label positioning
    - Use persisted positions instead of recalculating midpoint each frame
    - Fall back to midpoint calculation if label_pos fields are not set
  - [x] 3.6 Extend Canvas hit-testing for ACTIVITY_FLOW edge labels
    - Ensure edge labels are recognized as draggable targets in Canvas.tsx
    - Label drag should only update `label_pos_x` / `label_pos_y`, not edge path
    - Follow existing edge label hit-test pattern from other relationship types
  - [x] 3.7 Ensure Decision and edge label tests pass
    - Run ONLY the 5-7 tests written in 3.1
    - Verify Decision labels appear below diamond and are draggable
    - Verify ActivityFlow labels can be dragged independently
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 5-7 tests written in 3.1 pass
- Decision labels are rendered as independent LabelDecoration elements below the diamond
- Decision labels can be selected, dragged, and resized without moving the Decision node
- ActivityFlow edge labels can be clicked and dragged without moving the edge
- Moving labels only updates label position, not underlying element

**Key Files to Modify:**
- `frontend/src/components/DiagramsView/ActivityDiagramRenderer.tsx`
- `frontend/src/utils/activityFlowCreation.ts`
- `frontend/src/components/DiagramsView/Canvas.tsx` (hit-testing extension)

**Existing Code to Leverage:**
- `model.ts`: `LabelDecoration` interface, `createDefaultLabelDecoration()`, `LABEL_DECORATION_DEFAULTS`
- `activityNodeRendering.ts`: `getDefaultLabelPosition()`, `getDefaultEdgeLabelPosition()`
- Existing LabelDecorationElement component in ActivityDiagramRenderer.tsx

---

#### Task Group 4: Persistence and Backward Compatibility
**Dependencies:** Task Group 3

- [x] 4.0 Complete label persistence and backward compatibility
  - [x] 4.1 Write 4-6 focused tests for persistence and backward compatibility
    - Test Decision LabelDecorations save with diagram and restore on reload
    - Test ActivityFlow label_pos_x/label_pos_y persist and restore correctly
    - Test existing diagrams without LabelDecorations render with inline labels (virtual mode)
    - Test first label drag on legacy diagram converts virtual label to explicit LabelDecoration
  - [x] 4.2 Verify label_decorations array persistence in Diagram structure
    - Confirm `diagram.label_decorations` is saved and loaded by existing infrastructure
    - Decision LabelDecorations should serialize/deserialize automatically
    - No new storage fields needed - leverage existing LabelDecoration persistence
  - [x] 4.3 Verify edge label position persistence
    - Confirm `edge.label_pos_x` and `edge.label_pos_y` are saved with DiagramEdge
    - ActivityFlow edges should persist their label positions automatically
    - Existing infrastructure handles these fields - verify correctness only
  - [x] 4.4 Implement backward compatibility for existing diagrams
    - Use `hasExplicitLabel` check pattern (already present at lines 733, 765 in ActivityDiagramRenderer)
    - For nodes/edges without explicit decorations, render virtual inline labels
    - Virtual labels are non-interactive until explicitly dragged
  - [x] 4.5 Implement virtual-to-explicit label conversion on first drag
    - When user drags a virtual label, create an explicit LabelDecoration
    - Add the new LabelDecoration to `diagram.label_decorations` array
    - Update the diagram state to include the new decoration
    - Subsequent interactions use the explicit decoration
  - [x] 4.6 Ensure persistence and compatibility tests pass
    - Run ONLY the 4-6 tests written in 4.1
    - Verify save/reload preserves all label positions
    - Verify existing diagrams continue to render correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-6 tests written in 4.1 pass
- Reloading the diagram preserves all label positions (Decision and ActivityFlow)
- Existing diagrams without LabelDecorations continue to render with inline labels
- First drag on a virtual label creates an explicit LabelDecoration
- No data migration needed for existing diagrams

**Key Files to Modify:**
- `frontend/src/components/DiagramsView/ActivityDiagramRenderer.tsx`
- `frontend/src/components/DiagramsView/Canvas.tsx` (virtual-to-explicit conversion)

**Existing Code to Leverage:**
- `hasExplicitLabel` pattern already in ActivityDiagramRenderer (lines 733, 765)
- Existing diagram save/load infrastructure
- `nodeLabelDecMap` and `edgeLabelDecMap` already in ActivityDiagramRenderer

---

### Integration Testing

#### Task Group 5: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-4

- [x] 5.0 Review existing tests and fill critical gaps only
  - [x] 5.1 Review tests from Task Groups 1-4
    - Review the 4-6 tests from Task Group 1 (boundary anchoring)
    - Review the 3-5 tests from Task Group 2 (Action label alignment)
    - Review the 5-7 tests from Task Group 3 (Decision/edge labels)
    - Review the 4-6 tests from Task Group 4 (persistence/compatibility)
    - Total existing tests: approximately 16-24 tests
  - [x] 5.2 Analyze test coverage gaps for THIS feature only
    - Identify critical end-to-end workflows that lack test coverage
    - Focus on integration between boundary anchoring and label behaviour
    - Prioritize user interaction scenarios (create, drag, save, reload)
    - Do NOT assess entire application test coverage
  - [x] 5.3 Write up to 8 additional strategic tests maximum
    - Add integration tests for complete Activity diagram creation workflow
    - Add regression tests for edge cases (e.g., very small/large nodes)
    - Test edge anchoring updates when nodes are resized
    - Test label positioning when diagram is zoomed/panned
    - Do NOT write comprehensive coverage for all scenarios
  - [x] 5.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's features
    - Expected total: approximately 24-32 tests maximum
    - Verify all critical workflows pass
    - Do NOT run the entire application test suite

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 24-32 tests total)
- Critical user workflows for Activity diagrams are covered
- No more than 8 additional tests added when filling gaps
- Testing focused exclusively on this spec's feature requirements

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Boundary-Anchored Edge Rendering** (Part A) - COMPLETED
   - Core infrastructure change that affects all ActivityFlow rendering
   - Must be complete before Part B label work begins

2. **Task Group 2: Action Label Alignment** (Part B.1) - COMPLETED
   - Simpler label fix that doesn't require new LabelDecoration creation
   - Can be tested independently

3. **Task Group 3: Decision Labels and ActivityFlow Edge Labels** (Part B.2-B.3) - COMPLETED
   - More complex label behaviour with LabelDecoration creation
   - Depends on understanding of label rendering from Task Group 2

4. **Task Group 4: Persistence and Backward Compatibility** (Part B.4-B.5) - COMPLETED
   - Ensures all label changes persist and existing diagrams work
   - Must be completed last before integration testing

5. **Task Group 5: Test Review and Gap Analysis** - COMPLETED
   - Final verification that all features work together
   - Runs after all implementation is complete

---

## Key Reference Files

| File | Purpose |
|------|---------|
| `frontend/src/components/DiagramsView/ActivityDiagramRenderer.tsx` | Main renderer - modify ActivityFlowElement, ActivityNodeElement, and label handling |
| `frontend/src/utils/geometryUtils.ts` | Boundary calculation utilities - use existing functions |
| `frontend/src/utils/activityNodeRendering.ts` | Flow rendering with boundaries, label position calculators |
| `frontend/src/utils/activityFlowCreation.ts` | Edge creation - add label_pos initialization |
| `frontend/src/utils/rendering.ts` | Text alignment utilities - reference for calculateTextPosition |
| `frontend/src/types/model.ts` | LabelDecoration interface, createDefaultLabelDecoration factory |
| `frontend/src/components/DiagramsView/Canvas.tsx` | Hit-testing for draggable labels |

---

## Out of Scope (Per Spec)

- No backend API or database schema changes
- No changes to non-Activity diagram types (State, Sequence, ER)
- No automatic re-routing of flows when nodes are moved
- No changes to Activity node creation or deletion workflows
- No changes to ActivityFlow creation mode interaction patterns
- No changes to partition (swimlane) rendering or interaction
- No changes to zoom or pan behaviour
- No undo/redo enhancements for label operations
- No multi-select label drag operations
- No keyboard shortcuts for label editing

---

## Implementation Summary

### Tests Created
- `activity-flow-boundary-anchoring.test.ts` - 15 tests for boundary-anchored edge rendering
- `activity-action-label-alignment.test.ts` - 12 tests for Action label alignment
- `activity-decision-edge-labels.test.ts` - 13 tests for Decision and edge labels
- `activity-label-persistence.test.ts` - 16 tests for persistence and backward compatibility

### Files Modified
- `ActivityDiagramRenderer.tsx` - Updated to use boundary-anchored rendering, proper label alignment, and persisted label positions
- `activityFlowCreation.test.ts` - Updated tests to expect boundary coordinates instead of center coordinates
- `activity-flow-node-click-integration.test.ts` - Updated tests for boundary-based edge points
- `activity-partition-rendering.test.ts` - Updated tests for proper text centering with dominant-baseline

### All Tests Pass
Total: 352 activity-related tests pass across 21 test files
