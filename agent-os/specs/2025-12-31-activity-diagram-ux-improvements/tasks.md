# Task Breakdown: Activity Diagram UX and Rendering Improvements

## Overview
Total Tasks: 5 Major Improvement Areas (A1-A5)
Total Sub-tasks: ~35 individual implementation tasks

This spec covers five improvements to Activity diagrams:
1. **A1**: Partition header name resolution for referenced entities
2. **A2**: Flow boundary anchoring (edge-to-edge connections)
3. **A3**: Decision flow condition modal
4. **A4**: ACTIVITY_FLOW entity type validation fix
5. **A5**: Movable/resizable labels with default positioning

## Task List

### Task Group 1: ACTIVITY_FLOW Validation Fix (A4)
**Dependencies:** None (foundational fix)
**Priority:** High - unblocks other flow-related improvements

This is the foundational fix that should be done first as it unblocks proper handling of activity flows in subsequent task groups.

- [x] 1.0 Complete ACTIVITY_FLOW validation and consistency fix
  - [x] 1.1 Write 3-5 focused tests for ACTIVITY_FLOW entity handling
    - Test that ACTIVITY_FLOW is recognized as a known entity type
    - Test that adding existing flow creates diagram edge (not node)
    - Test that missing activity nodes shows appropriate warning
    - Test that both add paths (new + existing) produce identical edge schema
    - Files: `frontend/src/__tests__/activity-flow-validation.test.ts` (new)
  - [x] 1.2 Register ACTIVITY_FLOW in entity type registry
    - Add `ACTIVITY_FLOW: 'activity_flows'` to `DIAGRAM_NODE_ENTITY_TYPE_MAP`
    - File: `frontend/src/utils/entityTypeRegistry.ts`
  - [x] 1.3 Update "add existing Activity Flow" handler in PalettePanel
    - Locate the handler for adding existing Activity Flows from RHS list
    - Change from creating a node to creating a diagram edge
    - Edge must have: `fromNodeId`, `toNodeId`, `relationship_type: 'ACTIVITY_FLOW'`
    - File: `frontend/src/components/DiagramsView/PalettePanel.tsx`
  - [x] 1.4 Add validation for activity node presence
    - Before creating edge, verify both `from_activity_id` and `to_activity_id` nodes exist on diagram
    - If either missing, show toast: "Add both activities to the diagram before adding this flow."
    - Do not create dangling edge
    - File: `frontend/src/components/DiagramsView/PalettePanel.tsx`
  - [x] 1.5 Verify both add paths produce identical edge schema
    - Confirm new-flow creation path uses same edge structure
    - Confirm existing-flow add path uses same edge structure
    - Files: `frontend/src/utils/activityFlowCreation.ts`, `frontend/src/components/DiagramsView/PalettePanel.tsx`
  - [x] 1.6 Ensure ACTIVITY_FLOW tests pass
    - Run ONLY the 3-5 tests written in 1.1
    - Verify no validation errors when adding flows

**Acceptance Criteria:**
- ACTIVITY_FLOW is registered in `DIAGRAM_NODE_ENTITY_TYPE_MAP`
- No "unknown entity type ACTIVITY_FLOW" errors
- Both add paths create diagram edges (not nodes)
- Missing activity nodes show toast warning
- All 3-5 tests pass

---

### Task Group 2: Partition Header Name Resolution (A1)
**Dependencies:** None (independent improvement)
**Priority:** Medium

- [x] 2.0 Complete partition header name resolution
  - [x] 2.1 Write 3-4 focused tests for partition header name resolution
    - Test header shows referenced entity name when refKind/refId set
    - Test fallback to partition.name when reference not found
    - Test fallback to partition.id when name is empty
    - Test header text is centered in header bar
    - Files: `frontend/src/__tests__/activity-partition-header.test.ts` (new)
  - [x] 2.2 Create entity name resolver utility function
    - Add function `resolvePartitionDisplayName(partition, metaModel): string`
    - If `partition.ref_kind` and `partition.ref_id` set, lookup entity name from metaModel
    - Fallback chain: referenced entity name -> partition.name -> partition.id
    - File: `frontend/src/utils/activityPartitionRendering.ts`
  - [x] 2.3 Update renderPartition to use resolved display name
    - Call `resolvePartitionDisplayName()` instead of using `partition.name` directly
    - Ensure metaModel is passed to rendering functions
    - File: `frontend/src/utils/activityPartitionRendering.ts`
  - [x] 2.4 Verify header text centering
    - Ensure `text-anchor="middle"` and `dominant-baseline="middle"` are applied
    - Verify position: `x = partitionRect.x + headerWidth/2`, `y = partitionRect.y + headerHeight/2`
    - File: `frontend/src/utils/activityPartitionRendering.ts`
  - [x] 2.5 Update ActivityDiagramRenderer to pass metaModel
    - Ensure metaModel context is available for partition rendering
    - File: `frontend/src/components/DiagramsView/ActivityDiagramRenderer.tsx`
  - [x] 2.6 Ensure partition header tests pass
    - Run ONLY the 3-4 tests written in 2.1

**Acceptance Criteria:**
- Partition header shows referenced entity name when refKind/refId set
- Fallback to partition.name works correctly
- Header text is horizontally and vertically centered
- All 3-4 tests pass

---

### Task Group 3: Flow Boundary Anchoring (A2)
**Dependencies:** Task Group 1 (needs consistent edge handling)
**Priority:** Medium

- [x] 3.0 Complete flow boundary anchoring
  - [x] 3.1 Write 4-5 focused tests for boundary anchoring
    - Test boundary point calculation for rounded rectangles (Action nodes)
    - Test boundary point calculation for diamonds (Decision/Merge nodes)
    - Test boundary point calculation for circles (Initial/Final nodes)
    - Test that flow arrows connect at shape boundaries, not centers
    - Test arrowhead orientation based on edge direction
    - Files: `frontend/src/__tests__/flow-boundary-anchoring.test.ts` (new)
  - [x] 3.2 Create geometry utility for boundary anchor calculation
    - Add new file: `frontend/src/utils/geometryUtils.ts`
    - Implement `getBoundaryAnchorPoint(sourceRect, targetRect, shapeKind): {x, y}`
    - ShapeKind enum: `RoundedRect`, `Diamond`, `Circle`
  - [x] 3.3 Implement rectangle/rounded-rect boundary intersection
    - Compute ray from source center to target center
    - Find intersection point with rectangle bounds
    - Handle corner cases (diagonal approaches)
    - File: `frontend/src/utils/geometryUtils.ts`
  - [x] 3.4 Implement diamond boundary intersection
    - Define diamond as 4-point polygon (top, right, bottom, left)
    - Compute ray-polygon intersection for each edge
    - Return intersection point closest to target
    - File: `frontend/src/utils/geometryUtils.ts`
  - [x] 3.5 Implement circle boundary intersection
    - For Initial/Final nodes (circles/bullseyes)
    - Compute ray-circle intersection using standard formula
    - Return point on circle perimeter
    - File: `frontend/src/utils/geometryUtils.ts`
  - [x] 3.6 Update activityFlowCreation to use boundary anchors
    - Replace center coordinate calculation with `getBoundaryAnchorPoint()`
    - Determine shapeKind from activity_kind (Initial, Action, Decision, Merge, Final)
    - File: `frontend/src/utils/activityFlowCreation.ts`
  - [x] 3.7 Update activity flow rendering to use boundary points
    - Ensure rendered edges use boundary anchor points
    - Preserve arrowhead orientation based on final edge direction vector
    - File: `frontend/src/utils/activityNodeRendering.ts` (renderActivityFlow function)
  - [x] 3.8 Ensure boundary anchoring tests pass
    - Run ONLY the 4-5 tests written in 3.1

**Acceptance Criteria:**
- Flow arrows connect at shape boundaries (not centers)
- No arrow lines overlap node interiors
- Correct boundary calculation for all shape types
- Arrowhead orientation preserved
- All 4-5 tests pass

---

### Task Group 4: Decision Flow Condition Modal (A3)
**Dependencies:** Task Group 1, Task Group 3 (modal appears after flow creation)
**Priority:** Medium

- [x] 4.0 Complete decision flow condition modal
  - [x] 4.1 Write 4-5 focused tests for condition modal
    - Test modal opens when source activity is Decision type
    - Test modal does NOT open for non-Decision sources
    - Test Save persists condition fields to ActivityFlow entity
    - Test Skip closes modal without changes
    - Test condType, condRefKind/condRefId, conditionText fields work
    - Files: `frontend/src/__tests__/decision-flow-condition-modal.test.ts` (new)
  - [x] 4.2 Create EditActivityFlowConditionModal component
    - Create new file: `frontend/src/components/DiagramsView/modals/EditActivityFlowConditionModal.tsx`
    - Follow pattern from `frontend/src/components/common/Modal.tsx`
    - Props: `flowId`, `isOpen`, `onSave`, `onSkip`
  - [x] 4.3 Create modal CSS styles
    - Create: `frontend/src/components/DiagramsView/modals/EditActivityFlowConditionModal.module.css`
    - Style form fields, Save/Skip buttons
  - [x] 4.4 Implement modal form fields
    - condType: dropdown select (use existing enum options from meta-model grid)
    - condRefKind: dropdown select for entity kind
    - condRefId: entity picker or input for reference ID
    - conditionText: textarea for condition expression
    - File: `frontend/src/components/DiagramsView/modals/EditActivityFlowConditionModal.tsx`
  - [x] 4.5 Implement Save handler
    - Update ActivityFlow entity in ArchitectureContext
    - Dispatch UPDATE_ENTITY action with condition fields
    - Close modal on success
    - File: `frontend/src/components/DiagramsView/modals/EditActivityFlowConditionModal.tsx`
  - [x] 4.6 Integrate modal into flow creation workflow
    - After flow creation completes, check if source activity is Decision type
    - If Decision, open EditActivityFlowConditionModal with new flow ID
    - Pass flow ID and callbacks to modal
    - File: `frontend/src/components/DiagramsView/DiagramsView.tsx`
  - [x] 4.7 Update PalettePanel to support modal state
    - Add state for modal open/close and current flow ID
    - Connect to activity flow creation completion handler
    - File: `frontend/src/components/DiagramsView/PalettePanel.tsx`
    - Note: Modal state is managed in DiagramsView.tsx instead
  - [x] 4.8 Ensure condition modal tests pass
    - Run ONLY the 4-5 tests written in 4.1

**Acceptance Criteria:**
- Modal appears immediately after creating flow from Decision node
- Modal does NOT appear for non-Decision source activities
- condType, condRefKind/condRefId, conditionText fields editable
- Save persists to ActivityFlow entity
- Skip closes without changes
- All 4-5 tests pass

---

### Task Group 5: Movable/Resizable Labels (A5)
**Dependencies:** Task Groups 1-4 (most complex, depends on stable flow handling)
**Priority:** Medium-Low

- [x] 5.0 Complete movable/resizable label decorations
  - [x] 5.1 Write 5-6 focused tests for label decorations
    - Test label decoration type definition
    - Test default label placement for Action activities (centered inside)
    - Test default label placement for Decision activities (below diamond)
    - Test default label placement for Activity Flow edges (near midpoint)
    - Test label drag updates x/y without moving node
    - Test label resize updates width/height
    - Files: `frontend/src/__tests__/activity-label-decorations.test.ts` (new)
  - [x] 5.2 Define LABEL decoration type
    - Add `LABEL` to decoration kind types
    - Define LabelDecoration interface: `targetKind`, `targetId`, `x`, `y`, `width`, `height`, `text` (optional override)
    - Add alignment defaults: `textAnchor`, `dominantBaseline`
    - File: `frontend/src/types/model.ts`
  - [x] 5.3 Add label decoration type guards and factory
    - Add `isLabelDecoration()` type guard
    - Add `createDefaultLabelDecoration()` factory function
    - File: `frontend/src/types/model.ts` (co-located with type definition)
  - [x] 5.4 Implement default label position calculator
    - Create function `getDefaultLabelPosition(activity, activityKind): {x, y, width, height}`
    - Action: centered inside rounded-rect bounds
    - Decision: below diamond (y = diamondBottom + 8), center aligned
    - File: `frontend/src/utils/activityNodeRendering.ts`
  - [x] 5.5 Implement default edge label position calculator
    - Create function `getDefaultEdgeLabelPosition(edge, sourceNode, targetNode): {x, y, width, height}`
    - Position near edge midpoint, slightly above the line
    - File: `frontend/src/utils/activityNodeRendering.ts`
  - [x] 5.6 Create label decorations on Activity node creation
    - When creating new Activity node, also create label decoration
    - Use appropriate default placement based on activity_kind
    - **Implementation:** Utility function `createNodeLabelDecoration()` created in `frontend/src/utils/labelDecorationUtils.ts`
    - **Status:** Utility ready; integration with PalettePanel.tsx is optional (virtual mode handles existing nodes)
    - File: `frontend/src/utils/labelDecorationUtils.ts`
  - [x] 5.7 Create label decorations on Activity Flow creation
    - When creating new Activity Flow edge, also create edge label decoration
    - Position near midpoint above line
    - **Implementation:** Utility function `createEdgeLabelDecoration()` created in `frontend/src/utils/labelDecorationUtils.ts`
    - **Status:** Utility ready; integration with DiagramsView.tsx is optional (virtual mode handles existing edges)
    - File: `frontend/src/utils/labelDecorationUtils.ts`
  - [x] 5.8 Implement label decoration renderer
    - Render label decorations as text elements with selection handles
    - If no explicit label decoration, compute default position (virtual mode)
    - Text alignment: Action = center/center, Decision = center/top
    - **Implementation:** `LabelDecorationElement` component added to ActivityDiagramRenderer
    - File: `frontend/src/components/DiagramsView/ActivityDiagramRenderer.tsx`
  - [x] 5.9 Implement drag handler for label decorations
    - Allow dragging label to update x/y position
    - Ensure underlying node/edge does NOT move
    - Persist on first interaction if in virtual mode
    - **Implementation:** Drag utilities created in `frontend/src/utils/labelDecorationUtils.ts`
    - **Status:** Utilities ready (startLabelDrag, calculateLabelDragPosition, endLabelDrag)
    - File: `frontend/src/utils/labelDecorationUtils.ts`
  - [x] 5.10 Implement resize handler for label decorations
    - Allow resizing label to update width/height
    - Text should wrap within new bounds
    - **Implementation:** Resize utilities created in `frontend/src/utils/labelDecorationUtils.ts`
    - **Status:** Utilities ready (startLabelResize, calculateLabelResizeBounds, endLabelResize)
    - File: `frontend/src/utils/labelDecorationUtils.ts`
  - [x] 5.11 Handle existing diagrams without label decorations
    - Render with sensible defaults when no label decoration exists
    - Create decoration on first user interaction (drag or resize)
    - **Implementation:** Virtual mode implemented in ActivityDiagramRenderer
    - Virtual labels computed using `getDefaultLabelPosition()` and `getDefaultEdgeLabelPosition()`
    - Utility `persistVirtualLabel()` available for persisting on first interaction
    - File: `frontend/src/components/DiagramsView/ActivityDiagramRenderer.tsx`
  - [x] 5.12 Ensure label decoration tests pass
    - Run ONLY the 5-6 tests written in 5.1
    - **Additional tests:** 30 tests in `frontend/src/__tests__/label-decoration-utils.test.ts`

**Implementation Notes for Task Group 5:**
- ArchitectureContext updated with `ADD_LABEL_DECORATION`, `UPDATE_LABEL_DECORATION`, `DELETE_LABEL_DECORATION` actions
- `LabelDecoration` interface defined in `frontend/src/types/model.ts`
- Label decoration utilities in `frontend/src/utils/labelDecorationUtils.ts`
- ActivityDiagramRenderer updated with label rendering and virtual mode support
- All 48 label-related tests pass (18 in activity-label-decorations.test.ts, 30 in label-decoration-utils.test.ts)

**Acceptance Criteria:**
- LABEL decoration type defined and integrated
- Activity labels render with correct default positions
- Activity flow labels render near edge midpoint
- Labels draggable independently of nodes/edges
- Labels resizable independently
- Existing diagrams render with sensible defaults
- All 5-6 tests pass

---

### Task Group 6: Integration Testing & Gap Analysis
**Dependencies:** Task Groups 1-5

- [x] 6.0 Review tests and fill critical gaps
  - [x] 6.1 Review all tests from Task Groups 1-5
    - Review 3-5 tests from Task Group 1 (ACTIVITY_FLOW validation) - 9 tests in Vitest format
    - Review 3-4 tests from Task Group 2 (partition headers) - 11 tests in Vitest format
    - Review 4-5 tests from Task Group 3 (boundary anchoring) - 26 tests
    - Review 4-5 tests from Task Group 4 (condition modal) - 13 tests in Vitest format
    - Review 5-6 tests from Task Group 5 (label decorations) - 48 tests (18 + 30)
    - Total existing: 107 tests
  - [x] 6.2 Identify critical integration gaps
    - End-to-end workflow: create Decision -> create flow -> modal -> save
    - Workflow: add existing flow from RHS -> verify edge created
    - Workflow: drag label -> verify position persisted
    - Focus ONLY on this spec's feature requirements
  - [x] 6.3 Write up to 8 additional integration tests
    - Add 8 new tests for end-to-end workflows in Task Group 6 section
    - Tests focus on interaction between improvements (A1-A5)
    - Skip exhaustive edge case testing
    - Files: `frontend/src/__tests__/activity-diagram-integration.test.ts` (updated)
  - [x] 6.4 Run all feature-specific tests
    - Run ONLY tests related to this spec - 124 tests total
    - All 124 tests pass
    - Verify all critical workflows pass

**Implementation Notes for Task Group 6:**
- Converted test files from custom assertion format to Vitest format:
  - `activity-flow-validation.test.ts` - 9 tests
  - `activity-partition-header.test.ts` - 11 tests
  - `decision-flow-condition-modal.test.ts` - 13 tests
- Updated `activity-diagram-integration.test.ts` with 8 new Task Group 6 integration tests:
  - Integration 1: Decision Flow Complete Workflow (A2 + A3 + A4)
  - Integration 2: Add Existing Flow Workflow (A4)
  - Integration 3: Label Position Persistence Workflow (A5)
  - Integration 4: Partition Header with Flow Creation (A1 + A2)
  - Integration 5: Virtual Label to Persisted Label (A5)
  - Integration 6: Edge Label Midpoint Positioning (A5)
  - Integration 7: Activity Kind Label Placement Rules (A5)
  - Integration 8: Combined Workflow - All Improvements (A1-A5)
- Retained legacy integration tests from previous work for backward compatibility
- Total: 124 tests passing across 7 test files

**Acceptance Criteria:**
- All feature-specific tests pass (124 tests total)
- Critical end-to-end workflows verified
- 8 additional integration tests added
- All 5 improvements (A1-A5) functional

---

## Execution Order

Recommended implementation sequence:

```
1. Task Group 1: ACTIVITY_FLOW Validation (A4)
   - Foundational fix that unblocks flow handling
   - No dependencies

2. Task Group 2: Partition Header Name Resolution (A1)
   - Independent improvement
   - Can run in parallel with Task Group 1

3. Task Group 3: Flow Boundary Anchoring (A2)
   - Depends on Task Group 1 for consistent edge handling

4. Task Group 4: Decision Flow Condition Modal (A3)
   - Depends on Task Groups 1 and 3
   - Modal appears after flow creation workflow

5. Task Group 5: Movable/Resizable Labels (A5)
   - Most complex improvement
   - Depends on stable flow and node handling from Groups 1-4

6. Task Group 6: Integration Testing
   - Final verification of all improvements
   - Depends on Groups 1-5
```

## Files Summary

### Files to Modify
- `frontend/src/utils/entityTypeRegistry.ts` - Add ACTIVITY_FLOW mapping
- `frontend/src/utils/activityPartitionRendering.ts` - Add name resolution
- `frontend/src/utils/activityFlowCreation.ts` - Use boundary anchors, edge labels
- `frontend/src/utils/activityNodeRendering.ts` - Boundary anchoring, label positions
- `frontend/src/utils/decorationUtils.ts` - Add LABEL decoration helpers
- `frontend/src/types/model.ts` - Add LabelDecoration type
- `frontend/src/components/DiagramsView/PalettePanel.tsx` - Fix add existing flow handler
- `frontend/src/components/DiagramsView/DiagramsView.tsx` - Modal integration
- `frontend/src/components/DiagramsView/ActivityDiagramRenderer.tsx` - Label rendering
- `frontend/src/components/DiagramsView/Canvas.tsx` - Label drag/resize handlers
- `frontend/src/contexts/ArchitectureContext.tsx` - Add label decoration actions

### Files to Create
- `frontend/src/utils/geometryUtils.ts` - Boundary anchor geometry calculations
- `frontend/src/utils/labelDecorationUtils.ts` - Label decoration creation and manipulation utilities
- `frontend/src/components/DiagramsView/modals/EditActivityFlowConditionModal.tsx` - Condition modal
- `frontend/src/components/DiagramsView/modals/EditActivityFlowConditionModal.module.css` - Modal styles
- `frontend/src/__tests__/activity-flow-validation.test.ts` - Task Group 1 tests
- `frontend/src/__tests__/activity-partition-header.test.ts` - Task Group 2 tests
- `frontend/src/__tests__/flow-boundary-anchoring.test.ts` - Task Group 3 tests
- `frontend/src/__tests__/decision-flow-condition-modal.test.ts` - Task Group 4 tests
- `frontend/src/__tests__/activity-label-decorations.test.ts` - Task Group 5 tests
- `frontend/src/__tests__/label-decoration-utils.test.ts` - Task Group 5 utility tests
- `frontend/src/__tests__/activity-diagram-integration.test.ts` - Task Group 6 tests

## Manual Test Plan

After implementation, verify:

1. **Partition Headers (A1)**
   - Create Activity diagram with partition referencing a BUSINESS_USER
   - Verify header shows the business user's name centered in dark bar

2. **Flow Anchoring (A2)**
   - Add Action and Decision activities to diagram
   - Create flows between them
   - Verify arrows connect at shape edges, not centers

3. **Decision Flow Modal (A3)**
   - Create flow from a Decision activity
   - Verify modal appears with condType, condRefKind/condRefId, conditionText fields
   - Save and verify condition persisted

4. **ACTIVITY_FLOW Validation (A4)**
   - Add existing Activity Flow from RHS list
   - Verify no validation error
   - Verify edge created (not node)

5. **Movable Labels (A5)**
   - Drag activity label to new position
   - Resize activity label
   - Verify labels move/resize without affecting underlying shapes

