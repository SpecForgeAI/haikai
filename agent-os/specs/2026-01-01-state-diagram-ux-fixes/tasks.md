# Task Breakdown: State Diagram UX Fixes

## Overview
Total Tasks: 25

This spec brings State diagram UX/rendering in line with Activity diagrams by implementing:
1. Resize-driven shape rendering with square constraints for Initial/Final states
2. StateTransition 2-click creation mode via [+ New State Transition] button
3. Normal state label alignment defaults and toolbar controls

## Task List

### Utility Layer

#### Task Group 1: State Node Resize Helpers
**Dependencies:** None
**Files:** `frontend/src/utils/stateNodeRendering.ts`

- [x] 1.0 Complete state node resize helper functions
  - [x] 1.1 Write 4-6 focused tests for state resize helpers
    - Test `getStateKindForNode()` returns correct StateKind for STATE nodes
    - Test `getStateKindForNode()` returns null for non-STATE nodes
    - Test `isSymbolStateKind()` returns true for Initial/Final
    - Test `isSymbolStateKind()` returns false for Normal
    - Test `calculateSquareResizeForState()` enforces square aspect ratio
    - Test `calculateSquareResizeForState()` allows size below standard minimums
  - [x] 1.2 Add `getStateKindForNode(node, metaModel): StateKind | null` helper
    - Mirror `getActivityKindForNode()` pattern from activityNodeRendering.ts
    - Check `node.entity_type === 'STATE'`
    - Look up State entity via `metaModel.entities.states?.find()`
    - Return `state.state_kind || 'Normal'`
  - [x] 1.3 Add `SYMBOL_STATE_KINDS` constant set
    - Include 'Initial' and 'Final' kinds
    - Mirror `SYMBOL_ACTIVITY_KINDS` pattern
  - [x] 1.4 Add `isSymbolStateKind(stateKind: StateKind | null): boolean` helper
    - Return true if stateKind is in SYMBOL_STATE_KINDS
    - Mirror `isSymbolActivityKind()` pattern
  - [x] 1.5 Add `calculateSquareResizeForState()` function
    - Copy `calculateSquareResize()` logic from activityNodeRendering.ts
    - Minimum size = 1 (no minimum constraints)
    - Handle all 8 resize handles (TL, TC, TR, ML, MR, BL, BC, BR)
    - Maintain square aspect ratio (width === height)
  - [x] 1.6 Export all new functions from stateNodeRendering.ts
  - [x] 1.7 Ensure resize helper tests pass
    - Run ONLY the 4-6 tests written in 1.1
    - Verify all helper functions work correctly

**Acceptance Criteria:**
- `getStateKindForNode()` correctly identifies STATE nodes and returns their kind
- `isSymbolStateKind()` returns true only for Initial and Final
- `calculateSquareResizeForState()` enforces square resize with no minimum constraints
- The 4-6 tests written in 1.1 pass

---

### Rendering Layer

#### Task Group 2: State Node Rendering with Custom Dimensions
**Dependencies:** Task Group 1
**Files:** `frontend/src/utils/stateNodeRendering.ts`, `frontend/src/components/DiagramsView/StateDiagramRenderer.tsx`

- [x] 2.0 Complete state node rendering with custom dimensions
  - [x] 2.1 Write 4-6 focused tests for dimension-aware rendering
    - Test `renderInitialStateNode()` uses customWidth/customHeight for radius
    - Test `renderNormalStateNode()` uses customWidth/customHeight for bounds
    - Test `renderFinalStateNode()` scales outer/inner radii proportionally
    - Test `renderStateNode()` dispatcher passes dimensions correctly
    - Test StateDiagramRenderer passes node.width/height to render functions
  - [x] 2.2 Update `renderInitialStateNode()` signature
    - Add `customWidth?: number`, `customHeight?: number` parameters
    - Calculate radius = `min(customWidth, customHeight) / 2` when provided
    - Fall back to default diameter when not provided
  - [x] 2.3 Update `renderNormalStateNode()` to use provided dimensions
    - Already accepts customWidth/customHeight (verify working correctly)
    - Ensure rounded rectangle uses node bounds, not fixed values
  - [x] 2.4 Update `renderFinalStateNode()` signature
    - Add `customWidth?: number`, `customHeight?: number` parameters
    - Calculate outer radius = `min(width, height) / 2`
    - Calculate inner radius proportionally using default ratio
    - Update outerPathData and innerPathData accordingly
  - [x] 2.5 Update `renderStateNode()` dispatcher
    - Add `customWidth?: number`, `customHeight?: number` parameters
    - Pass dimensions to Initial, Normal, and Final render functions
  - [x] 2.6 Update StateDiagramRenderer to pass node dimensions
    - In `stateRenderResults` computation, pass `node.width` and `node.height`
    - Change from `renderStateNode(state, centerPosition)` to include dimensions
  - [x] 2.7 Ensure rendering tests pass
    - Run ONLY the 4-6 tests written in 2.1
    - Verify rendered shapes scale with node bounds

**Acceptance Criteria:**
- Initial state circle radius scales with node bounds
- Normal state rounded rectangle uses node dimensions
- Final state bullseye scales proportionally with node bounds
- StateDiagramRenderer correctly passes dimensions to render functions
- The 4-6 tests written in 2.1 pass

---

### Canvas Integration Layer

#### Task Group 3: Canvas Resize Constraints for State Nodes
**Dependencies:** Task Groups 1-2
**Files:** `frontend/src/components/DiagramsView/Canvas.tsx`

- [x] 3.0 Complete Canvas resize constraint integration
  - [x] 3.1 Write 3-5 focused tests for Canvas resize handling
    - Test Initial state resize maintains square aspect ratio
    - Test Final state resize maintains square aspect ratio
    - Test Normal state resize allows rectangular dimensions
    - Test Initial/Final resize allows small sizes (below minWidth/minHeight)
    - Test resize handler uses correct function based on state kind
  - [x] 3.2 Import state resize helpers in Canvas.tsx
    - Add import for `getStateKindForNode`, `isSymbolStateKind`, `calculateSquareResizeForState`
    - Import from `'../../utils/stateNodeRendering'`
  - [x] 3.3 Add state resize branch in resize drag handler
    - Locate the existing Activity resize branch (around line 140-150)
    - Add parallel branch for `node.entity_type === 'STATE'`
    - Call `getStateKindForNode(originalNode, metaModel)` to get state kind
  - [x] 3.4 Implement state-specific resize logic
    - If `isSymbolStateKind(stateKind)` is true (Initial/Final):
      - Call `calculateSquareResizeForState()` instead of `calculateResize()`
      - No minimum size constraints
    - Else (Normal):
      - Use existing `calculateResize()` with standard minWidth/minHeight
  - [x] 3.5 Ensure resize tests pass
    - Run ONLY the 3-5 tests written in 3.1
    - Verify Initial/Final enforce square, Normal allows rectangular

**Acceptance Criteria:**
- Initial state nodes resize as squares with no minimums
- Final state nodes resize as squares with no minimums
- Normal state nodes resize rectangularly with standard minimums
- The 3-5 tests written in 3.1 pass

---

### State Transition Creation Layer

#### Task Group 4: StateTransition 2-Click Creation Mode
**Dependencies:** None (leverages existing stateTransitionCreation.ts utilities)
**Files:** `frontend/src/components/DiagramsView/PalettePanel.tsx`, `frontend/src/components/DiagramsView/Canvas.tsx`

- [x] 4.0 Complete StateTransition 2-click creation mode
  - [x] 4.1 Write 4-6 focused tests for transition creation mode
    - Test [+ New State Transition] button toggles creation mode
    - Test first STATE node click sets sourceStateNodeId
    - Test second STATE node click creates transition and exits mode
    - Test clicking non-STATE node is ignored
    - Test Escape key cancels creation mode
    - Test button text changes to [Cancel Transition] when active
  - [x] 4.2 Verify PalettePanel state and handlers exist
    - Confirm `transitionCreationMode` state is initialized
    - Confirm `handleEnterTransitionCreationMode` handler exists
    - Confirm `handleExitTransitionCreationMode` handler exists
    - Confirm Escape key handler is wired up
  - [x] 4.3 Wire [+ New State Transition] button click
    - In RHS palette button rendering, detect STATE_TRANSITION entity type
    - On click: toggle `transitionCreationMode` via enter/exit handlers
    - Button text: show "[Cancel Transition]" when `transitionCreationMode.active`
    - Display hint text using `getTransitionModeHintText(transitionCreationMode)`
  - [x] 4.4 Add Canvas click handler for transition creation mode
    - Check if `transitionCreationMode.active` is true
    - Only accept clicks on nodes where `node.entity_type === 'STATE'`
    - First click: call `setTransitionSourceState()` to set source
    - Second click: create transition and exit mode
  - [x] 4.5 Implement transition creation on second click
    - Get source node from `transitionCreationMode.sourceStateNodeId`
    - Get target node from clicked node
    - Look up source/target State entity IDs from nodes
    - Call `createStateTransitionEntity(fromStateId, toStateId)`
    - Call `createTransitionDiagramEdge(transitionId, sourceNodeId, targetNodeId, sourceNode, targetNode)`
    - Dispatch ADD_RELATIONSHIP action for StateTransition
    - Dispatch diagram update to add edge
    - Call `exitTransitionCreationMode()`
  - [x] 4.6 Ensure transition creation tests pass
    - Run ONLY the 4-6 tests written in 4.1
    - Verify full 2-click flow works end-to-end

**Acceptance Criteria:**
- [+ New State Transition] button enters/exits creation mode
- First STATE node click sets source
- Second STATE node click creates transition and edge
- Non-STATE clicks are ignored
- Escape cancels mode
- Button shows [Cancel Transition] and hint text when active
- The 4-6 tests written in 4.1 pass

---

### Label Alignment Layer

#### Task Group 5: Normal State Label Alignment Defaults
**Dependencies:** None
**Files:** `frontend/src/utils/nodeCreation.ts`, `frontend/src/config/defaults.ts`

- [x] 5.0 Complete Normal state label alignment defaults
  - [x] 5.1 Write 2-4 focused tests for label alignment defaults
    - Test new Normal state node has text_align_h = 'CENTER'
    - Test new Normal state node has text_align_v = 'MIDDLE'
    - Test Initial state node has showLabel = false (no alignment needed)
    - Test Final state node has showLabel = false (no alignment needed)
  - [x] 5.2 Locate state node creation in nodeCreation.ts
    - Find `createDiagramNodeFromEntity()` or equivalent for STATE entities
    - Identify where default node properties are set
  - [x] 5.3 Add label alignment defaults for Normal states
    - When creating STATE node with state_kind = 'Normal':
      - Set `text_align_h = 'CENTER'`
      - Set `text_align_v = 'MIDDLE'`
    - Mirror pattern used for Action activity nodes
  - [x] 5.4 Verify Initial/Final do not show labels
    - Confirm STATE_NODE_DEFAULTS.Initial has showLabel: false
    - Confirm STATE_NODE_DEFAULTS.Final has showLabel: false
    - No alignment defaults needed for these kinds
  - [x] 5.5 Ensure label alignment tests pass
    - Run ONLY the 2-4 tests written in 5.1
    - Verify defaults are applied on node creation

**Acceptance Criteria:**
- New Normal state nodes default to center/middle alignment
- Initial/Final states do not show labels
- The 2-4 tests written in 5.1 pass

---

#### Task Group 6: Toolbar Alignment Controls for Normal States
**Dependencies:** Task Group 5
**Files:** `frontend/src/components/DiagramsView/DiagramsView.tsx`, `frontend/src/components/DiagramsView/StateDiagramRenderer.tsx`

- [x] 6.0 Complete toolbar alignment controls for Normal states
  - [x] 6.1 Write 3-5 focused tests for toolbar alignment controls
    - Test toolbar H alignment buttons are enabled for Normal state selection
    - Test toolbar V alignment buttons are enabled for Normal state selection
    - Test clicking H alignment button updates node.text_align_h
    - Test clicking V alignment button updates node.text_align_v
    - Test alignment controls are disabled for Initial/Final states
  - [x] 6.2 Locate toolbar alignment handler in DiagramsView.tsx
    - Find existing alignment button click handlers
    - Identify pattern used for Action activity nodes
  - [x] 6.3 Enable alignment controls for Normal STATE nodes
    - In toolbar button enablement logic:
      - Check if selected node is STATE entity type
      - Get state_kind using `getStateKindForNode()`
      - Enable H/V buttons only if state_kind === 'Normal'
  - [x] 6.4 Implement alignment update handler for STATE nodes
    - On H alignment button click: update `node.text_align_h`
    - On V alignment button click: update `node.text_align_v`
    - Dispatch diagram node update action
    - Mirror Action activity alignment handler pattern
  - [x] 6.5 Update StateDiagramRenderer to use alignment settings
    - In StateNodeElement, read `node.text_align_h` and `node.text_align_v`
    - Apply textAnchor based on text_align_h: 'start'|'middle'|'end'
    - Calculate text y position based on text_align_v: 'TOP'|'MIDDLE'|'BOTTOM'
    - Mirror label rendering pattern from Activity Action nodes
  - [x] 6.6 Ensure toolbar alignment tests pass
    - Run ONLY the 3-5 tests written in 6.1
    - Verify alignment controls work for Normal states

**Acceptance Criteria:**
- Toolbar H/V alignment buttons enabled for Normal state selection
- Alignment buttons disabled for Initial/Final states
- Clicking alignment buttons updates node properties
- Label renders according to alignment settings
- The 3-5 tests written in 6.1 pass

---

### Integration Testing

#### Task Group 7: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-6

- [x] 7.0 Review existing tests and fill critical gaps
  - [x] 7.1 Review tests from Task Groups 1-6
    - Review the 4-6 tests written by Task Group 1 (resize helpers)
    - Review the 4-6 tests written by Task Group 2 (rendering)
    - Review the 3-5 tests written by Task Group 3 (Canvas resize)
    - Review the 4-6 tests written by Task Group 4 (transition creation)
    - Review the 2-4 tests written by Task Group 5 (label defaults)
    - Review the 3-5 tests written by Task Group 6 (toolbar alignment)
    - Total existing tests: approximately 20-32 tests
  - [x] 7.2 Analyze test coverage gaps for this feature only
    - Identify critical end-to-end workflows lacking coverage
    - Focus ONLY on gaps related to this spec's features
    - Prioritize integration points over unit test gaps
  - [x] 7.3 Write up to 8 additional strategic tests maximum
    - E2E: Resize Initial state, verify square and scaled shape
    - E2E: Resize Final state, verify square and scaled bullseye
    - E2E: Resize Normal state, verify rectangular and scaled bounds
    - E2E: Create transition via 2-click, verify edge appears
    - E2E: Cancel transition creation with Escape
    - E2E: Create Normal state, verify center/middle label alignment
    - E2E: Change Normal state H alignment, verify label position changes
    - E2E: Change Normal state V alignment, verify label position changes
  - [x] 7.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's features
    - Expected total: approximately 28-40 tests maximum
    - Do NOT run the entire application test suite
    - Verify critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 28-40 tests total)
- Critical user workflows for this feature are covered
- No more than 8 additional tests added when filling in testing gaps
- Testing focused exclusively on this spec's feature requirements

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: State Node Resize Helpers** (utility layer)
   - No dependencies
   - Provides foundation for resize constraints

2. **Task Group 2: State Node Rendering with Custom Dimensions** (rendering layer)
   - Depends on Task Group 1 for state kind detection
   - Enables rendered shapes to scale with node bounds

3. **Task Group 5: Normal State Label Alignment Defaults** (parallel track)
   - No dependencies
   - Can be implemented in parallel with Groups 2-3

4. **Task Group 3: Canvas Resize Constraints for State Nodes** (Canvas integration)
   - Depends on Task Groups 1-2
   - Integrates resize logic into Canvas

5. **Task Group 4: StateTransition 2-Click Creation Mode** (parallel track)
   - No dependencies (uses existing utilities)
   - Can be implemented in parallel with Groups 2-3

6. **Task Group 6: Toolbar Alignment Controls for Normal States** (UI integration)
   - Depends on Task Group 5
   - Completes label alignment feature

7. **Task Group 7: Test Review and Gap Analysis** (final validation)
   - Depends on all other groups
   - Validates complete feature implementation

---

## Key Files Reference

### Files to Modify
| File | Task Groups | Changes |
|------|-------------|---------|
| `frontend/src/utils/stateNodeRendering.ts` | 1, 2 | Add resize helpers, update render function signatures |
| `frontend/src/components/DiagramsView/Canvas.tsx` | 3, 4 | Add resize constraints, add click handler for transitions |
| `frontend/src/components/DiagramsView/PalettePanel.tsx` | 4 | Wire [+ New State Transition] button |
| `frontend/src/components/DiagramsView/StateDiagramRenderer.tsx` | 2, 6 | Pass dimensions, apply label alignment |
| `frontend/src/utils/nodeCreation.ts` | 5 | Add label alignment defaults for Normal states |
| `frontend/src/components/DiagramsView/DiagramsView.tsx` | 6 | Enable/disable toolbar alignment for STATE nodes |

### Existing Code Patterns to Mirror
| Pattern | Source File | Target |
|---------|-------------|--------|
| `getActivityKindForNode()` | `activityNodeRendering.ts` | `getStateKindForNode()` |
| `isSymbolActivityKind()` | `activityNodeRendering.ts` | `isSymbolStateKind()` |
| `calculateSquareResize()` | `activityNodeRendering.ts` | `calculateSquareResizeForState()` |
| Activity resize branch | `Canvas.tsx` | State resize branch |
| Activity Flow 2-click | `PalettePanel.tsx`, `Canvas.tsx` | State Transition 2-click |
| Action label alignment | `DiagramsView.tsx` | Normal state label alignment |

### Existing Utilities to Leverage
| Utility | File | Usage |
|---------|------|-------|
| `TransitionCreationMode` | `stateTransitionCreation.ts` | Mode state interface |
| `enterTransitionCreationMode()` | `stateTransitionCreation.ts` | Enter mode |
| `exitTransitionCreationMode()` | `stateTransitionCreation.ts` | Exit mode |
| `createStateTransitionEntity()` | `stateTransitionCreation.ts` | Create entity |
| `createTransitionDiagramEdge()` | `stateTransitionCreation.ts` | Create edge |
| `getTransitionModeHintText()` | `stateTransitionCreation.ts` | UI hint text |
