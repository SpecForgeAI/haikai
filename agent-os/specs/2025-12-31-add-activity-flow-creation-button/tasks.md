# Task Breakdown: Add Activity Flow Creation Button

## Overview
Total Tasks: 24

This feature adds a "+ New Activity Flow" creation button to the Activity diagram RHS palette that enables a two-click flow creation mode where users select source and target Activity nodes to create an ActivityFlow entity and its corresponding diagram edge.

## Task List

### Utility Layer

#### Task Group 1: Activity Flow Creation Utility Module
**Dependencies:** None

- [x] 1.0 Complete activity flow creation utility module
  - [x] 1.1 Write 4-6 focused tests for activityFlowCreation.ts
    - Test `createActivityFlowEntity()` creates entity with correct fields
    - Test `createActivityFlowDiagramEdge()` creates edge with proper structure
    - Test `enterActivityFlowCreationMode()` returns correct state
    - Test `exitActivityFlowCreationMode()` resets state properly
    - Test `getActivityFlowModeHintText()` returns correct hints for each state
    - Test `isReadyForTargetActivity()` returns correct boolean
  - [x] 1.2 Create `frontend/src/utils/activityFlowCreation.ts` module
    - Copy structure from `frontend/src/utils/stateTransitionCreation.ts`
    - Export `ActivityFlowCreationMode` interface with `active: boolean` and `sourceActivityNodeId: string | null`
    - Export `initialActivityFlowCreationMode` constant
  - [x] 1.3 Implement mode management functions
    - Implement `enterActivityFlowCreationMode()` returning `{ active: true, sourceActivityNodeId: null }`
    - Implement `exitActivityFlowCreationMode()` returning initial state
    - Implement `setActivityFlowSourceNode()` to set source when in active mode
    - Implement `isReadyForTargetActivity()` to check if source is set
  - [x] 1.4 Implement entity creation function
    - Implement `createActivityFlowEntity(fromActivityId: string, toActivityId: string)`
    - Generate ID using `generatePrefixedId('flow')`
    - Set `from_activity_id` and `to_activity_id` fields
    - Set `flow_kind` to 'Control' as default
    - Initialize optional fields (trigger, condition) as undefined
  - [x] 1.5 Implement diagram edge creation function
    - Implement `createActivityFlowDiagramEdge(flowId, sourceNodeId, targetNodeId, sourceNode, targetNode)`
    - Generate edge ID using `generatePrefixedId('edge')`
    - Set `relationship_type` to 'ACTIVITY_FLOW'
    - Set `relationship_id` to the flow entity ID
    - Calculate edge_points from source and target node centers
  - [x] 1.6 Implement hint text helper function
    - Implement `getActivityFlowModeHintText(currentMode: ActivityFlowCreationMode): string`
    - Return empty string when not active
    - Return "Click an activity to select as source. Press Escape to cancel." when no source selected
    - Return "Click another activity to create the flow. Press Escape to cancel." when source is set
  - [x] 1.7 Ensure utility module tests pass
    - Run ONLY the 4-6 tests written in 1.1
    - Verify all exported functions work correctly

**Acceptance Criteria:**
- The 4-6 tests written in 1.1 pass
- All functions are exported and properly typed
- Module follows same patterns as `stateTransitionCreation.ts`
- Entity and edge creation produces valid structures

**Files to create/modify:**
- Create: `frontend/src/utils/activityFlowCreation.ts`
- Create: `frontend/src/__tests__/activityFlowCreation.test.ts`

---

### UI Layer

#### Task Group 2: PalettePanel State Management
**Dependencies:** Task Group 1

- [x] 2.0 Complete state management integration in PalettePanel
  - [x] 2.1 Write 3-4 focused tests for activity flow creation mode state
    - Test state initializes correctly
    - Test entering mode sets active to true
    - Test exiting mode resets to initial state
    - Test Escape key exits mode
  - [x] 2.2 Add activityFlowCreationMode state to PalettePanel.tsx
    - Import `ActivityFlowCreationMode`, `initialActivityFlowCreationMode` from activityFlowCreation.ts
    - Add `useState<ActivityFlowCreationMode>(initialActivityFlowCreationMode)` following transitionCreationMode pattern (line 809)
  - [x] 2.3 Implement enter and exit handlers
    - Create `handleEnterActivityFlowCreationMode` callback following `handleEnterTransitionCreationMode` pattern (lines 923-929)
    - Create `handleExitActivityFlowCreationMode` callback following `handleExitTransitionCreationMode` pattern (lines 935-937)
  - [x] 2.4 Implement Escape key handler
    - Add useEffect hook listening for Escape key when `activityFlowCreationMode.active` is true
    - Follow exact pattern from State Transition keyboard handler (lines 942-955)
    - Call `handleExitActivityFlowCreationMode` on Escape press
    - Remove event listener on cleanup
  - [x] 2.5 Ensure state management tests pass
    - Run ONLY the 3-4 tests written in 2.1
    - Verify state transitions work correctly

**Acceptance Criteria:**
- The 3-4 tests written in 2.1 pass
- State management follows same patterns as transitionCreationMode
- Escape key properly cancels mode
- Mode resets when diagram changes

**Files to modify:**
- `frontend/src/components/DiagramsView/PalettePanel.tsx`

---

#### Task Group 3: Button and UI Integration
**Dependencies:** Task Group 2

- [x] 3.0 Complete button and UI integration
  - [x] 3.1 Write 3-4 focused tests for button behavior
    - Test button appears in Activity diagram CREATE section
    - Test button click toggles activity flow creation mode
    - Test button shows "Cancel Flow" when mode is active
    - Test button is disabled when no active diagram
  - [x] 3.2 Add "+ New Activity Flow" button to getCreateSectionButtons
    - In `getCreateSectionButtons()` function (line 2520), extend Activity case (lines 2532-2536)
    - Add third button: `{ label: '+ New Activity Flow', entityType: 'ACTIVITY_FLOW', title: 'Create Activity Flow' }`
    - Button appears after "+ New Partition" and "+ New Activity"
  - [x] 3.3 Extend handleCreateButtonClick for ACTIVITY_FLOW
    - In `handleCreateButtonClick` (line 961), add handling for 'ACTIVITY_FLOW' entity type
    - Toggle `activityFlowCreationMode` when button is clicked (same pattern as STATE_TRANSITION)
    - Call `handleExitActivityFlowCreationMode()` if mode is active, else `handleEnterActivityFlowCreationMode()`
  - [x] 3.4 Update button rendering for activity flow mode
    - In button rendering loop (lines 2591-2611), add special handling for 'ACTIVITY_FLOW' button
    - Track `isActivityFlowButton` and `isActive` state similar to transition button
    - Show 'x' icon when active, '+' when inactive
    - Change text to "Cancel Flow" when active
  - [x] 3.5 Add hint text display for activity flow mode
    - Import `getActivityFlowModeHintText` from activityFlowCreation.ts (already done in Task Group 2)
    - After button rendering, add conditional hint display when `activityFlowCreationMode.active` is true
    - Use `styles.transitionModeHint` class (or create equivalent `activityFlowModeHint`)
    - Follow pattern from lines 2613-2617
  - [x] 3.6 Ensure button and UI tests pass
    - Run ONLY the 3-4 tests written in 3.1
    - Verify button rendering and interactions work correctly

**Acceptance Criteria:**
- The 3-4 tests written in 3.1 pass
- Button appears in Activity diagram CREATE section
- Button toggles mode on click
- Hint text displays during creation mode
- Button disabled without active diagram

**Files to modify:**
- `frontend/src/components/DiagramsView/PalettePanel.tsx`

---

### Integration Layer

#### Task Group 4: Node Click Handling and Flow Creation
**Dependencies:** Task Group 3

- [x] 4.0 Complete node click handling and flow creation integration
  - [x] 4.1 Write 4-6 focused integration tests
    - Test clicking Activity node in mode sets source
    - Test clicking second Activity node creates flow and edge
    - Test clicking non-Activity node is ignored
    - Test clicking same node as source prevents self-loop
    - Test mode exits after successful flow creation
    - Test hint text updates after source selection
  - [x] 4.2 Wire activity flow creation mode to DiagramsView
    - Pass `activityFlowCreationMode` state from PalettePanel to DiagramsView (via props or context)
    - Pass `setActivityFlowCreationMode` setter for state updates
    - Pass `handleExitActivityFlowCreationMode` callback
  - [x] 4.3 Implement node click handler for activity flow mode
    - In the node click handler, check if `activityFlowCreationMode.active` is true
    - Validate clicked node has `entity_type === 'ACTIVITY'` (ignore ACTIVITY_PARTITION etc.)
    - If no source selected: store node ID in `sourceActivityNodeId` using `setActivityFlowSourceNode()`
    - If source already selected: proceed to create flow
  - [x] 4.4 Implement flow and edge creation on target click
    - Get source node from `activityFlowCreationMode.sourceActivityNodeId`
    - Validate target is different from source (prevent self-loops)
    - Resolve entity IDs from diagram nodes
    - Call `createActivityFlowEntity()` with source and target entity IDs
    - Dispatch `ADD_ENTITY` action with entityType 'activity_flows'
    - Call `createActivityFlowDiagramEdge()` with flow ID and node information
    - Dispatch `ADD_DIAGRAM_EDGE` action with the new edge
    - Call `handleExitActivityFlowCreationMode()` to reset state
  - [x] 4.5 Reset activity flow mode on diagram change
    - Add useEffect to watch `currentDiagramId` changes
    - Exit activity flow creation mode when diagram changes
    - Follow same pattern as any existing diagram change handlers
  - [x] 4.6 Ensure integration tests pass
    - Run ONLY the 4-6 tests written in 4.1
    - Verify end-to-end flow creation works correctly

**Acceptance Criteria:**
- The 4-6 tests written in 4.1 pass
- Two-click flow creation works end-to-end
- Non-Activity nodes are ignored
- Self-loops are prevented
- Mode exits after successful creation
- Mode resets on diagram change

**Files to modify:**
- `frontend/src/components/DiagramsView/PalettePanel.tsx`
- `frontend/src/components/DiagramsView/DiagramsView.tsx` (if node click handling is there)
- `frontend/src/components/DiagramsView/Canvas.tsx` (if node click handling is there)

---

### Testing

#### Task Group 5: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-4

- [x] 5.0 Review existing tests and fill critical gaps only
  - [x] 5.1 Review tests from Task Groups 1-4
    - Review the 4-6 tests from Task Group 1 (utility module)
    - Review the 3-4 tests from Task Group 2 (state management)
    - Review the 3-4 tests from Task Group 3 (button/UI)
    - Review the 4-6 tests from Task Group 4 (integration)
    - Total existing tests: approximately 14-20 tests
  - [x] 5.2 Analyze test coverage gaps for this feature only
    - Identify any critical user workflows lacking coverage
    - Focus ONLY on gaps related to Activity Flow creation
    - Prioritize end-to-end workflow tests
  - [x] 5.3 Write up to 6 additional strategic tests if needed
    - Add maximum of 6 new tests to fill critical gaps
    - Focus on edge cases specific to Activity Flow creation:
      - Flow creation with different flow_kind values (if applicable)
      - Multiple consecutive flow creations
      - Flow creation after cancellation
    - Do NOT write comprehensive coverage for all scenarios
  - [x] 5.4 Run feature-specific tests only
    - Run ONLY tests related to Activity Flow creation feature
    - Expected total: approximately 14-26 tests maximum
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 14-26 tests total)
- Critical user workflows for Activity Flow creation are covered
- No more than 6 additional tests added when filling gaps
- Testing focused exclusively on this spec's feature requirements

**Files to create/modify:**
- `frontend/src/__tests__/activityFlowCreation.test.ts` (review/extend)
- `frontend/src/__tests__/activity-flow-edge-cases.test.ts` (created for gap coverage)

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Utility Layer** - Create the `activityFlowCreation.ts` module with all helper functions and types
2. **Task Group 2: State Management** - Add activity flow creation mode state to PalettePanel
3. **Task Group 3: Button and UI** - Add the button and wire up click handlers and hint text
4. **Task Group 4: Integration** - Wire node click handling and complete the flow creation logic
5. **Task Group 5: Test Review** - Review all tests and fill critical gaps

## Key Files Reference

| File | Purpose |
|------|---------|
| `frontend/src/utils/activityFlowCreation.ts` | NEW - Utility module for activity flow creation |
| `frontend/src/utils/stateTransitionCreation.ts` | Template to follow for utility module |
| `frontend/src/components/DiagramsView/PalettePanel.tsx` | Main file for button, state, and UI changes |
| `frontend/src/components/DiagramsView/DiagramsView.tsx` | May need changes for node click handling |
| `frontend/src/types/model.ts` | Contains ActivityFlow interface (lines 567-587) |
| `frontend/src/utils/idGenerator.ts` | ID generation utilities |

## Notes

- This is a frontend-only implementation - no backend changes required
- Follow the existing State Transition creation pattern closely
- The ActivityFlow entity uses `from_activity_id` and `to_activity_id` fields
- Edge rendering should work automatically if using `relationship_type: 'ACTIVITY_FLOW'`
- Visual highlighting of source node during selection is out of scope
