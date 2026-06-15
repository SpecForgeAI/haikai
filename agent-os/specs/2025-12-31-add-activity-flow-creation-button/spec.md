# Specification: Add Activity Flow Creation Button

## Goal
Add a "+ New Activity Flow" creation button to the Activity diagram RHS palette that enables a two-click flow creation mode where users select source and target Activity nodes to create an ActivityFlow entity and its corresponding diagram edge.

## User Stories
- As a diagram editor, I want to create activity flows directly from the Activity diagram palette so that I can connect Activity nodes without switching to a different view.
- As a user in flow creation mode, I want clear visual feedback and the ability to cancel (Escape key or re-click button) so that I can maintain control over the creation process.

## Specific Requirements

**Add "+ New Activity Flow" button to Activity diagram CREATE section**
- In `PalettePanel.tsx`, add a third button to the Activity diagram case in `getCreateSectionButtons()` function
- Button label: "+ New Activity Flow"
- Entity type identifier: 'ACTIVITY_FLOW' (similar to 'STATE_TRANSITION' pattern)
- Button appears after "+ New Partition" and "+ New Activity" buttons
- Button is disabled when no active diagram is selected

**Add Activity Flow creation mode state management**
- Add `activityFlowCreationMode` state in `PalettePanel.tsx` following the exact `TransitionCreationMode` interface pattern
- State shape: `{ active: boolean; sourceActivityNodeId: string | null }`
- Initial state: `{ active: false, sourceActivityNodeId: null }`
- State toggles when button is clicked (enter/exit mode)
- State resets when mode exits (completion, cancel, or diagram change)

**Wire button click handler for Activity Flow creation**
- Extend `handleCreateButtonClick` to handle 'ACTIVITY_FLOW' entity type
- Toggle `activityFlowCreationMode.active` when button is clicked
- Reset `sourceActivityNodeId` to null when entering mode
- Follow same pattern as STATE_TRANSITION button handling
- Button text changes to "Cancel Flow" when mode is active

**Display hint text during Activity Flow creation mode**
- Show hint text below the button when `activityFlowCreationMode.active` is true
- Initial hint: "Click an activity to select as source. Press Escape to cancel."
- After source selected: "Click another activity to create the flow. Press Escape to cancel."
- Create `getActivityFlowModeHintText()` helper function following `getTransitionModeHintText()` pattern

**Implement Escape key handler for Activity Flow creation mode**
- Add useEffect hook to listen for Escape key when `activityFlowCreationMode.active` is true
- On Escape press: exit mode and reset state
- Follow exact pattern from State Transition keyboard handler (lines 942-955)
- Remove event listener on cleanup

**Create activityFlowCreation.ts utility module**
- New file: `frontend/src/utils/activityFlowCreation.ts`
- Export `ActivityFlowCreationMode` interface mirroring `TransitionCreationMode`
- Export `initialActivityFlowCreationMode` constant
- Export `enterActivityFlowCreationMode()` and `exitActivityFlowCreationMode()` functions
- Export `createActivityFlowEntity()` to create ActivityFlow with proper fields
- Export `createActivityFlowDiagramEdge()` to create DiagramEdge referencing the flow

**Create ActivityFlow entity with proper structure**
- Generate ID using `generatePrefixedId('flow')`
- Set `from_activity_id` to source Activity's entity_id
- Set `to_activity_id` to target Activity's entity_id
- Set `flow_kind` to 'Control' as default
- Initialize optional fields (trigger, condition) as undefined
- Dispatch ADD_ENTITY action with entityType 'activity_flows'

**Create diagram edge for ActivityFlow**
- Generate edge ID using `generatePrefixedId('edge')`
- Set `relationship_type` to 'ACTIVITY_FLOW'
- Set `relationship_id` to the created ActivityFlow entity ID
- Set `source_node_id` and `target_node_id` to the clicked diagram nodes
- Calculate edge_points from source and target node centers (following `createTransitionDiagramEdge` pattern)
- Dispatch ADD_DIAGRAM_EDGE action with the new edge

**Validate node clicks during Activity Flow creation mode**
- Only accept clicks on nodes with `entity_type === 'ACTIVITY'`
- Ignore clicks on non-Activity nodes (ACTIVITY_PARTITION, etc.)
- Prevent self-loops: if target node equals source node, reset and exit (no-op)
- On valid source click: store node ID in `sourceActivityNodeId`
- On valid target click: create flow and edge, then exit mode

## Visual Design
No visual mockups provided. Follow existing State Transition creation button styling:
- Button uses same `styles.createButton` / `styles.createButtonActive` classes
- Icon shows '+' normally, 'x' when active
- Hint text uses `styles.transitionModeHint` class (or create equivalent `activityFlowModeHint`)

## Existing Code to Leverage

**`frontend/src/utils/stateTransitionCreation.ts`**
- Direct template for the new `activityFlowCreation.ts` module
- Copy `TransitionCreationMode` interface -> `ActivityFlowCreationMode`
- Copy `enterTransitionCreationMode()` -> `enterActivityFlowCreationMode()`
- Adapt `createStateTransitionEntity()` -> `createActivityFlowEntity()` with ActivityFlow fields
- Adapt `createTransitionDiagramEdge()` -> `createActivityFlowDiagramEdge()` with ACTIVITY_FLOW type

**`frontend/src/components/DiagramsView/PalettePanel.tsx` (lines 808-973)**
- `transitionCreationMode` state management pattern (line 809-811)
- `handleEnterTransitionCreationMode` handler (lines 923-929)
- `handleExitTransitionCreationMode` handler (lines 935-937)
- Escape key useEffect (lines 942-955)
- `handleCreateButtonClick` routing logic (lines 961-973)
- Button rendering with active state toggle (lines 2591-2617)

**`frontend/src/components/DiagramsView/PalettePanel.tsx` (lines 2520-2540)**
- `getCreateSectionButtons()` switch statement for diagram types
- Activity case (lines 2532-2536) to extend with new button

**`frontend/src/types/model.ts` (lines 567-587)**
- `ActivityFlow` interface definition with all required fields
- `ActivityFlowKind` type ('Control' | 'Data')
- `ENTITY_TYPES.ACTIVITY_FLOW` constant for entity type

**`frontend/src/utils/idGenerator.ts`**
- `generatePrefixedId()` function for ID generation
- Use prefix 'flow' for ActivityFlow entities, 'edge' for diagram edges

## Out of Scope
- Backend schema changes or API modifications
- Complex flow routing with waypoints or bend points
- Swimlane/partition-aware flow routing
- Activity Flow editing or deletion from palette
- Visual highlighting of source node during selection
- Validation against existing flows (duplicate detection)
- Activity Flow property inspector panel
- Data flow vs Control flow selection during creation
- Guard/condition expression editing during creation
- Integration with Canvas click handlers (handled separately)
