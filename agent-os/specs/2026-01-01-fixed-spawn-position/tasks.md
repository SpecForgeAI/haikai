# Task Breakdown: Fixed Node Spawn Position at (100,100)

## Overview
Total Tasks: 24

This spec replaces viewport-centered node spawning with a deterministic fixed position of (100,100) for all generic add flows on General, ER, Activity, and State diagrams. Sequence diagram positioning and child node positioning within parents remain unchanged.

## Task List

### Core Utilities Layer

#### Task Group 1: Node Creation Utilities
**Dependencies:** None

- [x] 1.0 Complete node creation utilities updates
  - [x] 1.1 Write 4 focused tests for fixed spawn position
    - Test that `createDiagramNodeFromEntity()` returns pos_x=100, pos_y=100 regardless of viewportCenter input
    - Test that `createERDNodeFromEntity()` returns pos_x=100, pos_y=100 regardless of viewportCenter input
    - Test that passing various viewportCenter values (e.g., {x:600, y:500}) still produces (100,100)
    - Test that `calculateNodePlacement()` returns {pos_x: 100, pos_y: 100} unconditionally
  - [x] 1.2 Add DEFAULT_NODE_SPAWN_ORIGIN constant to nodeCreation.ts
    - File: `frontend/src/utils/nodeCreation.ts`
    - Add: `export const DEFAULT_NODE_SPAWN_ORIGIN = { x: 100, y: 100 };`
    - Place near other constants (DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT)
  - [x] 1.3 Update calculateNodePlacement() to return fixed (100,100)
    - File: `frontend/src/utils/nodeCreation.ts`
    - Replace cascading offset calculation with: `return { pos_x: 100, pos_y: 100 };`
    - Remove the `existingNodes.length * 30` offset logic
    - Keep function signature for backward compatibility
  - [x] 1.4 Update createDiagramNodeFromEntity() to use fixed spawn position
    - File: `frontend/src/utils/nodeCreation.ts`
    - Remove conditional logic checking `if (viewportCenter)`
    - Always set: `pos_x = DEFAULT_NODE_SPAWN_ORIGIN.x` and `pos_y = DEFAULT_NODE_SPAWN_ORIGIN.y`
    - Keep `viewportCenter` parameter in signature for API compatibility (but ignore its value)
    - Preserve all other node properties (id, width, height, z_index, etc.)
  - [x] 1.5 Update createERDNodeFromEntity() to use fixed spawn position
    - File: `frontend/src/utils/nodeCreation.ts`
    - Remove conditional logic checking `if (viewportCenter)`
    - Always set: `pos_x = DEFAULT_NODE_SPAWN_ORIGIN.x` and `pos_y = DEFAULT_NODE_SPAWN_ORIGIN.y`
    - Keep `viewportCenter` parameter in signature for API compatibility
    - Preserve all ERD-specific logic (embedded_attribute_ids, render_style, sizing)
  - [x] 1.6 Ensure node creation utility tests pass
    - Run ONLY the 4 tests written in 1.1
    - Verify all fixed spawn position assertions pass
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- DEFAULT_NODE_SPAWN_ORIGIN constant exported with value { x: 100, y: 100 }
- calculateNodePlacement() always returns { pos_x: 100, pos_y: 100 }
- createDiagramNodeFromEntity() always places nodes at (100,100) regardless of viewportCenter
- createERDNodeFromEntity() always places nodes at (100,100) regardless of viewportCenter
- All 4 tests from 1.1 pass

---

### Compound Layout Layer

#### Task Group 2: Advanced Add Layout Utilities
**Dependencies:** Task Group 1

- [x] 2.0 Complete compound layout updates
  - [x] 2.1 Write 3 focused tests for fixed root origin in layoutAdvancedAddSelection
    - Test that grid layout branch produces rootX=100, rootY=100 (ignore viewportCenter)
    - Test that standard layout branch produces rootX=100, rootY=100 (ignore viewportCenter)
    - Test that child positioning relative to root remains unchanged
  - [x] 2.2 Update layoutAdvancedAddSelection() grid layout branch
    - File: `frontend/src/utils/compoundLayout.ts`
    - Replace: `const rootX = viewportCenter.x - measuredRoot.measuredWidth / 2;` with `const rootX = 100;`
    - Replace: `const rootY = viewportCenter.y - measuredRoot.measuredHeight / 2;` with `const rootY = 100;`
    - Keep all child positioning and spacing logic unchanged
  - [x] 2.3 Update layoutAdvancedAddSelection() standard layout branch
    - File: `frontend/src/utils/compoundLayout.ts`
    - Replace: `const rootX = viewportCenter.x - measuredRoot.measuredWidth / 2;` with `const rootX = 100;`
    - Replace: `const rootY = viewportCenter.y - measuredRoot.measuredHeight / 2;` with `const rootY = 100;`
    - Keep spacing preset logic and measure/assignPositions calls unchanged
  - [x] 2.4 Ensure compound layout tests pass
    - Run ONLY the 3 tests written in 2.1
    - Verify root origin assertions pass
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- layoutAdvancedAddSelection() places root node at (100,100) in grid layout mode
- layoutAdvancedAddSelection() places root node at (100,100) in standard layout mode
- Child node positioning relative to root remains correct
- All 3 tests from 2.1 pass

---

### UI Component Layer

#### Task Group 3: PalettePanel Component Updates
**Dependencies:** Task Groups 1-2

- [x] 3.0 Complete PalettePanel updates
  - [x] 3.1 Write 5 focused tests for PalettePanel fixed positioning
    - Test that handleCreateAndPlace produces nodes at (100,100) without cascade offset
    - Test that handleAddProcessActivity places new parent at (100,100)
    - Test that handleAddWithBusinessProcesses places new Application wrapper at (100,100)
    - Test that child positioning within new parents uses existing child layout helpers unchanged
    - Test that palette add (handleAddExistingEntity) produces nodes at (100,100)
  - [x] 3.2 Update handleCreateAndPlace to remove cascade offset
    - File: `frontend/src/components/DiagramsView/PalettePanel.tsx`
    - Remove: `cascadeState.count * CASCADE_OFFSET` position adjustment from offsetPosition calculation
    - Nodes will spawn at (100,100) via updated createDiagramNodeFromEntity/createERDNodeFromEntity
    - The cascadeState tracking can remain but will no longer affect position
  - [x] 3.3 Update handleAddProcessActivity parent positioning
    - File: `frontend/src/components/DiagramsView/PalettePanel.tsx`
    - In the `isNewParent` block, replace viewport-center-based parent positioning
    - Replace: `center.x - newSize.width / 2` with `100` for pos_x
    - Replace: `center.y - newSize.height / 2` with `100` for pos_y
    - Keep all child positioning logic unchanged (calculateChildPositionWithHeights)
  - [x] 3.4 Update handleAddWithBusinessProcesses wrapper positioning
    - File: `frontend/src/components/DiagramsView/PalettePanel.tsx`
    - Replace Application wrapper parent centering logic with fixed (100,100)
    - Replace: `center.x - newSize.width / 2` with `100` for pos_x
    - Replace: `center.y - newSize.height / 2` with `100` for pos_y
    - Preserve child recalculation logic that runs after parent positioning
  - [x] 3.5 Update handleContextMenuAdd positioning (if applicable)
    - File: `frontend/src/components/DiagramsView/PalettePanel.tsx`
    - Remove viewport-center intent; node positioning will use updated node creation utilities
    - Node will spawn at (100,100) via createDiagramNodeFromEntity
  - [x] 3.6 Ensure PalettePanel component tests pass
    - Run ONLY the 5 tests written in 3.1
    - Verify all fixed positioning assertions pass
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- handleCreateAndPlace produces nodes at (100,100) without cascade offset
- handleAddProcessActivity places new parent containers at (100,100)
- handleAddWithBusinessProcesses places new Application wrappers at (100,100)
- handleContextMenuAdd produces nodes at (100,100)
- Child positioning within parents remains unchanged
- All 5 tests from 3.1 pass

---

### Test Updates Layer

#### Task Group 4: Update Existing Tests
**Dependencies:** Task Groups 1-3

- [x] 4.0 Update existing tests to reflect fixed spawn position
  - [x] 4.1 Update create-and-place-flow.test.ts viewport-centered tests
    - File: `frontend/src/__tests__/create-and-place-flow.test.ts`
    - Update "Viewport-Centered Node Positioning" describe block
    - Change assertions from viewport-centered calculations to expect pos_x=100, pos_y=100
    - Add test to verify viewportCenter parameter is ignored (pass {x:600, y:500}, expect 100,100)
  - [x] 4.2 Remove or rewrite cascade offset tests
    - File: `frontend/src/__tests__/create-and-place-flow.test.ts`
    - Remove "Cascade Offset for Consecutive Creates" describe block entirely
    - OR rewrite to confirm cascade offset no longer affects generic node placement
    - Preferred: remove the cascade tests since behavior is no longer desired
  - [x] 4.3 Update Advanced Add interface layout tests
    - File: `frontend/src/__tests__/advanced-add-interface-layout.test.ts`
    - Update expectations so root/top-level node origin is anchored at (100,100)
    - Recompute absolute X/Y assertions assuming rootX=100, rootY=100
    - Keep relative positioning expectations intact (children offsets relative to root)
  - [x] 4.4 Update Advanced Add parent wrapping tests
    - File: `frontend/src/__tests__/advanced-add-interface-parent-wrapping.test.ts`
    - Update expectations for root node position to (100,100)
    - Verify parent correctly wraps children at new fixed origin
    - Keep child positioning relative to parent unchanged
  - [x] 4.5 Update Advanced Add parity integration tests
    - File: `frontend/src/__tests__/advanced-add-interface-parity-integration.test.ts`
    - Update any assertions that assumed viewport-centered root positioning
    - Verify root nodes are placed at (100,100)
    - Ensure integration scenarios pass with new positioning

**Acceptance Criteria:**
- create-and-place-flow.test.ts passes with updated fixed position assertions
- Cascade offset tests removed or updated to reflect no-cascade behavior
- Advanced Add layout tests pass with root at (100,100)
- All updated tests correctly assert (100,100) positioning for root/top-level nodes

---

### Verification Layer

#### Task Group 5: Test Review and Final Verification
**Dependencies:** Task Groups 1-4

- [x] 5.0 Review all tests and verify feature completeness
  - [x] 5.1 Review tests from Task Groups 1-4
    - Review the 4 tests written for node creation utilities (Task 1.1)
    - Review the 3 tests written for compound layout (Task 2.1)
    - Review the 5 tests written for PalettePanel (Task 3.1)
    - Review updated existing tests (Task Group 4)
    - Total new tests: approximately 12 tests
  - [x] 5.2 Analyze test coverage gaps for this feature only
    - Identify any critical user workflows that lack test coverage
    - Focus ONLY on gaps related to fixed spawn position feature
    - Prioritize: General diagram add, ER diagram add, Activity diagram add, State diagram add
    - Verify Sequence diagram positioning is NOT tested/affected
  - [x] 5.3 Write up to 5 additional strategic tests if necessary
    - Add tests for any critical gaps identified in 5.2
    - Focus on integration points between node creation and UI components
    - Verify ERD nodes with attributes spawn at (100,100)
    - Do NOT write comprehensive coverage for all scenarios
  - [x] 5.4 Run feature-specific tests only
    - Run all tests related to fixed spawn position feature
    - Expected total: approximately 12-17 tests
    - Verify all critical workflows pass
    - Do NOT run the entire application test suite

**Acceptance Criteria:**
- All feature-specific tests pass
- Critical user workflows for fixed spawn position are covered:
  - Single node add from palette -> (100,100)
  - Create-and-place flow -> (100,100)
  - ERD node creation -> (100,100)
  - Multi-node parent creation -> parent at (100,100), children correctly laid out
- Sequence diagram positioning confirmed unchanged
- No more than 5 additional tests added when filling gaps

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Node Creation Utilities** - Foundation layer; introduces constant and updates core positioning functions
2. **Task Group 2: Advanced Add Layout Utilities** - Updates compound layout to use fixed root origin
3. **Task Group 3: PalettePanel Component Updates** - Updates UI layer to remove viewport-center and cascade offset logic
4. **Task Group 4: Update Existing Tests** - Aligns existing test assertions with new behavior
5. **Task Group 5: Test Review and Final Verification** - Ensures complete coverage and all tests pass

---

## Files Modified

| File | Task Groups | Changes |
|------|-------------|---------|
| `frontend/src/utils/nodeCreation.ts` | 1 | Add DEFAULT_NODE_SPAWN_ORIGIN, update calculateNodePlacement, createDiagramNodeFromEntity, createERDNodeFromEntity |
| `frontend/src/utils/compoundLayout.ts` | 2 | Update layoutAdvancedAddSelection for both grid and standard layout branches |
| `frontend/src/components/DiagramsView/PalettePanel.tsx` | 3 | Update handleCreateAndPlace, handleAddProcessActivity, handleAddWithBusinessProcesses, handleContextMenuAdd |
| `frontend/src/__tests__/create-and-place-flow.test.ts` | 4 | Update viewport-centered tests, remove cascade offset tests |
| `frontend/src/__tests__/advanced-add-interface-layout.test.ts` | 4 | Update root origin expectations |
| `frontend/src/__tests__/advanced-add-interface-parent-wrapping.test.ts` | 4 | Update parent positioning expectations |
| `frontend/src/__tests__/advanced-add-interface-parity-integration.test.ts` | 4 | Update integration test assertions |

---

## Out of Scope Reminders

- Do NOT modify any Sequence diagram-related positioning code
- Do NOT change child node positioning logic within parent containers
- Do NOT modify diagram persistence format or backend APIs
- Do NOT change viewport center utility functions (they may be used elsewhere)
- Do NOT modify node sizing or dimension calculations
- Do NOT modify edge/relationship placement logic

---

## Implementation Summary

All task groups have been successfully implemented:

### New Test Files Created:
- `frontend/src/__tests__/fixed-spawn-position.test.ts` - 11 tests for node creation utilities
- `frontend/src/__tests__/fixed-spawn-position-compound-layout.test.ts` - 5 tests for compound layout
- `frontend/src/__tests__/fixed-spawn-position-palette-panel.test.ts` - 8 tests for PalettePanel

### Files Modified:
- `frontend/src/utils/nodeCreation.ts` - Added DEFAULT_NODE_SPAWN_ORIGIN constant, updated calculateNodePlacement, createDiagramNodeFromEntity, createERDNodeFromEntity
- `frontend/src/utils/compoundLayout.ts` - Added FIXED_ROOT_ORIGIN constants, updated layoutAdvancedAddSelection for both grid and standard layout branches
- `frontend/src/components/DiagramsView/PalettePanel.tsx` - Removed CASCADE_OFFSET, updated handleCreateAndPlace, handleAddProcessActivity, handleAddWithBusinessProcesses, handleAddWithAttributes, handleAddInterfaceWithRelated
- `frontend/src/__tests__/create-and-place-flow.test.ts` - Updated to expect fixed spawn position (100,100) instead of viewport-centered positioning
- `frontend/src/__tests__/create-and-place-integration.test.ts` - Updated to expect fixed spawn position (100,100)

### Test Results:
- Total tests passing: 107 tests across 6 test files
- All fixed spawn position tests pass
- All create-and-place tests updated and passing
