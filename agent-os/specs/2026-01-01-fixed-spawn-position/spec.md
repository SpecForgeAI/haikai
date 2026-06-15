# Specification: Fixed Node Spawn Position at (100,100)

## Goal
Replace viewport/canvas-centered node spawning with a deterministic fixed position of (100,100) for all generic add flows on General, ER, Activity, and State diagrams, while preserving Sequence diagram positioning and existing child-layout rules.

## User Stories
- As a diagram author, I want new nodes to appear at a predictable position (100,100) so that I can immediately see and work with them without scrolling
- As a user adding multiple entities, I want consistent node placement so that nodes appear in a known location regardless of my current viewport scroll position

## Specific Requirements

**Introduce DEFAULT_NODE_SPAWN_ORIGIN constant**
- Add `export const DEFAULT_NODE_SPAWN_ORIGIN = { x: 100, y: 100 }` to `frontend/src/utils/nodeCreation.ts`
- This constant serves as the single source of truth for generic node spawn position
- Update `calculateNodePlacement()` to return `{ pos_x: 100, pos_y: 100 }` unconditionally
- Remove the cascading offset calculation based on existingNodes.length

**Update createDiagramNodeFromEntity to ignore viewportCenter**
- Modify `createDiagramNodeFromEntity()` in `frontend/src/utils/nodeCreation.ts`
- Always set `pos_x = DEFAULT_NODE_SPAWN_ORIGIN.x` and `pos_y = DEFAULT_NODE_SPAWN_ORIGIN.y`
- Keep the `viewportCenter` parameter in the function signature for backward compatibility
- Remove the conditional logic that calculates position from viewportCenter

**Update createERDNodeFromEntity to ignore viewportCenter**
- Modify `createERDNodeFromEntity()` in `frontend/src/utils/nodeCreation.ts`
- Always set `pos_x = DEFAULT_NODE_SPAWN_ORIGIN.x` and `pos_y = DEFAULT_NODE_SPAWN_ORIGIN.y`
- Keep the `viewportCenter` parameter for API compatibility but ignore its value
- Preserve all ERD-specific logic (embedded_attribute_ids, render_style, sizing)

**Update parent node placement in PalettePanel**
- In `frontend/src/components/DiagramsView/PalettePanel.tsx`, update `handleAddProcessActivity`
- Replace viewport-center-based parent positioning with fixed `pos_x = 100` and `pos_y = 100`
- Update the `isNewParent` block where parent position is calculated from `getCurrentViewportCenter()`
- Keep all child positioning logic unchanged (calculateChildPositionWithHeights)

**Update Application wrapper placement in PalettePanel**
- In `handleAddWithBusinessProcesses`, replace parent centering logic with fixed (100,100)
- Replace `center.x - newSize.width / 2` with `100` for pos_x
- Replace `center.y - newSize.height / 2` with `100` for pos_y
- Preserve child recalculation logic that runs after parent positioning

**Remove CASCADE_OFFSET from generic node creation**
- In `handleCreateAndPlace`, remove the `cascadeState.count * CASCADE_OFFSET` position adjustment
- The `offsetPosition` calculation should be replaced with direct spawn at (100,100)
- The `cascadeState` tracking can remain but will no longer affect position

**Update layoutAdvancedAddSelection for fixed root origin**
- In `frontend/src/utils/compoundLayout.ts`, update `layoutAdvancedAddSelection()`
- Replace `rootX = viewportCenter.x - measuredRoot.measuredWidth / 2` with `rootX = 100`
- Replace `rootY = viewportCenter.y - measuredRoot.measuredHeight / 2` with `rootY = 100`
- Apply this change to BOTH the grid layout and standard layout branches
- Keep all spacing preset logic and child measurement logic unchanged

**Preserve Sequence diagram positioning**
- Do NOT modify any Sequence diagram-related positioning code
- SequenceDiagramRenderer, SequenceEditorPanel, and sequence layout utilities are explicitly out of scope
- Participant and message positioning remain unchanged

## Visual Design
No visual mockups provided. The change is purely positional - nodes spawn at canvas coordinates (100,100) instead of viewport center.

## Existing Code to Leverage

**frontend/src/utils/nodeCreation.ts**
- Contains `createDiagramNodeFromEntity()` and `createERDNodeFromEntity()` that calculate node positions
- Has existing `calculateNodePlacement()` function that should be simplified to return (100,100)
- Already defines `ViewportCenter` interface which can be kept for compatibility

**frontend/src/components/DiagramsView/PalettePanel.tsx**
- Contains `handleCreateAndPlace`, `handleAddProcessActivity`, `handleAddWithBusinessProcesses`
- Has `getCurrentViewportCenter()` helper that is currently used for positioning
- Defines `CASCADE_OFFSET` constant that should be ignored for positioning

**frontend/src/utils/compoundLayout.ts**
- Contains `layoutAdvancedAddSelection()` which positions the root node for Advanced Add flows
- Has both grid and standard layout branches that calculate rootX/rootY from viewportCenter
- Child layout logic within this file should remain unchanged

**frontend/src/__tests__/create-and-place-flow.test.ts**
- Contains existing tests for viewport-centered positioning that need updating
- Has cascade offset tests that should be removed or rewritten
- Test structure can be reused for validating fixed (100,100) positioning

## Out of Scope
- Sequence diagram placement logic (participants, messages, fragments, layout)
- Child node positioning within parent containers (padding, margins, stacking)
- Diagram persistence format or backend API changes
- New auto-layout features beyond anchoring to (100,100)
- Multi-node child placement calculations (only parent/root origin changes)
- Viewport center utility functions (viewportUtils.ts) - these may still be used elsewhere
- Any changes to node sizing or dimension calculations
- Edge/relationship placement logic
- Zoom or scroll behavior modifications
- Canvas size or coordinate system changes
