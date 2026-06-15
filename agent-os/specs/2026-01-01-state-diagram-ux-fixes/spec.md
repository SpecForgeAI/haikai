# Specification: State Diagram UX Fixes

## Goal
Bring State diagram UX/rendering in line with Activity diagrams by making node resize change the rendered shape, implementing [+ New State Transition] creation via 2-click source/target selection, and ensuring Normal state labels default to center/middle with toolbar alignment controls.

## User Stories
- As a diagram author, I want to resize state nodes and see the rendered shape scale proportionally so that I can customize my diagram layout without shapes staying fixed size.
- As a diagram author, I want to click [+ New State Transition], then click a source state and target state, so that I can create transitions using the same intuitive 2-click flow as Activity diagrams.

## Specific Requirements

**A. Square-only resize for Initial and Final states**
- When resizing an Initial or Final state node, enforce width == height (square aspect ratio)
- Do NOT enforce minimum size constraints for Initial/Final states (allow very small symbols)
- Use the dominant resize delta (max of |dx|, |dy|) for uniform square scaling
- Add `getStateKindForNode(node, metaModel): StateKind | null` helper following the pattern of `getActivityKindForNode()`
- Add `isSymbolStateKind(stateKind)` returning true for Initial and Final kinds
- Add `calculateSquareResizeForState()` function mirroring `calculateSquareResize()` from activityNodeRendering.ts

**B. Rectangular resize for Normal states**
- Normal state nodes resize rectangularly (width and height can differ)
- Apply standard min width/height constraints from `appConfig.node.minWidth/minHeight`
- Use existing `calculateResize()` function in Canvas.tsx (no changes needed for rectangular resize)

**C. Rendered shape scales with node bounds**
- Modify `StateDiagramRenderer.tsx` to pass node.width and node.height to `renderStateNode()`
- Update `renderStateNode()` signature to accept optional customWidth/customHeight parameters
- Update `renderInitialStateNode()` to compute radius from `min(width, height) / 2`
- Update `renderNormalStateNode()` to use node dimensions for rounded rectangle bounds
- Update `renderFinalStateNode()` to compute outer/inner radii from node bounds proportionally

**D. Canvas.tsx resize constraint integration**
- In the resize drag handler, detect if selected node is a STATE entity type
- Look up State entity to get state_kind using `getStateKindForNode()`
- If state_kind is Initial or Final, call `calculateSquareResizeForState()` instead of `calculateResize()`
- For Normal states, use existing `calculateResize()` with standard minWidth/minHeight

**E. StateTransition 2-click creation mode**
- Wire [+ New State Transition] button click in PalettePanel.tsx to toggle `transitionCreationMode`
- Existing `enterTransitionCreationMode()` and `exitTransitionCreationMode()` utilities already exist in stateTransitionCreation.ts
- Button text changes to [Cancel Transition] when mode is active; display hint text from `getTransitionModeHintText()`
- Escape key cancels mode (handler already implemented in PalettePanel.tsx useEffect)

**F. Canvas click handling for StateTransition creation**
- In Canvas.tsx, when `transitionCreationMode.active` is true, intercept node clicks
- Only accept clicks on nodes where `node.entity_type === 'STATE'`
- First valid STATE node click sets `sourceStateNodeId` via `setTransitionSourceState()`
- Second valid STATE node click triggers transition creation and exits mode
- Use `createStateTransitionEntity()` to create StateTransition entity with from/to state IDs
- Use `createTransitionDiagramEdge()` to create DiagramEdge with relationship_type='STATE_TRANSITION'
- Dispatch ADD_RELATIONSHIP and diagram update actions

**G. Normal state default label alignment**
- When creating a new Normal state node via createDiagramNodeFromEntity, set `text_align_h = 'CENTER'` and `text_align_v = 'MIDDLE'`
- Initial and Final states do not display labels (showLabel: false in defaults)

**H. Toolbar H/V alignment controls for Normal states**
- When a STATE node is selected and state_kind is Normal, toolbar H/V alignment buttons should be enabled
- Clicking alignment buttons updates node.text_align_h or node.text_align_v using existing toolbar alignment handler pattern
- For Initial/Final states, alignment controls should be disabled or ignored (no visible label)
- Mirror the implementation pattern used for Action activity nodes in DiagramsView.tsx

## Visual Design
No visual mockups provided.

## Existing Code to Leverage

**activityNodeRendering.ts - Square resize pattern**
- `getActivityKindForNode(node, metaModel)` - pattern to replicate for State entities
- `isSymbolActivityKind(activityKind)` - pattern for checking if kind requires square resize
- `calculateSquareResize(handle, originalNode, dx, dy)` - exact implementation to mirror for State nodes
- Rendering functions accept customWidth/customHeight parameters - same pattern needed for stateNodeRendering.ts

**stateTransitionCreation.ts - Creation mode utilities**
- `TransitionCreationMode` interface with active and sourceStateNodeId fields
- `enterTransitionCreationMode()` and `exitTransitionCreationMode()` mode state helpers
- `createStateTransitionEntity(fromStateId, toStateId)` creates StateTransition entity
- `createTransitionDiagramEdge()` creates DiagramEdge for the transition
- `getTransitionModeHintText()` returns user-facing hint strings

**stateNodeRendering.ts - Current rendering implementation**
- `renderStateNode(state, position)` dispatches to Initial/Normal/Final renderers
- Needs signature update to accept optional width/height
- `renderInitialStateNode()`, `renderNormalStateNode()`, `renderFinalStateNode()` need dimension parameters

**geometryUtils.ts - Boundary anchor calculations**
- `getCircleBoundaryPoint()` for Initial/Final state edge anchoring
- `getRectangleBoundaryPoint()` for Normal state edge anchoring
- `ShapeKind.Circle` and `ShapeKind.RoundedRect` shape type constants

**Canvas.tsx - Resize and click handling**
- `calculateResize()` function for rectangular resize (lines 367-419)
- `getHandleAtPoint()` and `getHandlePositions()` for resize handle detection
- Existing Activity resize constraint branch can be extended for State nodes
- Node click handling can be extended for transition creation mode

## Out of Scope
- Backend schema or API changes
- State diagram creation via meta-model view
- Self-referencing transitions (same source and target state)
- Transition routing or bend points
- Guard condition modal or trigger/effect editing UI
- Multi-selection state transition creation
- Undo/redo for transition creation
- State transition deletion via 2-click mode
- Composite states or nested state machines
- Activity Partition-style swimlanes for State diagrams
