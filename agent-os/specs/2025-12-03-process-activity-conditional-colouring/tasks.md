# Task Breakdown: Process Activity Conditional Colouring

## Overview
Total Tasks: 16

This spec fixes Process Activity diagram nodes to display correct background colours based on their `user_interaction_level` attribute, enabling live updates when metadata changes.

**Root Cause:** Canvas.tsx uses static `node.background_color || colors.background` instead of calling the existing `getNodeFillColor(node, state.model)` function which already contains Process Activity colour logic.

**Solution:** Single-line fix in Canvas.tsx plus verification that creation paths do not set hardcoded `background_color` on PROCESS_ACTIVITY nodes.

## Task List

### Infrastructure Verification

#### Task Group 1: Verify Existing Colour Infrastructure
**Dependencies:** None

- [x] 1.0 Complete infrastructure verification
  - [x] 1.1 Write 3 focused tests for colour infrastructure
    - Test 1: `getProcessActivityDefaultFill` returns correct colour for each UserInteractionLevel value (AUTOMATED, MINIMAL, MODERATE, SIGNIFICANT)
    - Test 2: `getProcessActivityDefaultFill` defaults to AUTOMATED colour when `user_interaction_level` is undefined
    - Test 3: `getNodeFillColor` correctly delegates to `getProcessActivityDefaultFill` for PROCESS_ACTIVITY nodes
  - [x] 1.2 Verify `processActivityColors` in `defaults.ts` (lines 305-310)
    - Confirm mapping: AUTOMATED=#a5d6a7, MINIMAL=#c8e6c9, MODERATE=#fff9c4, SIGNIFICANT=#ffcdd2
    - Confirm it is keyed by `UserInteractionLevel` type
  - [x] 1.3 Verify `getProcessActivityDefaultFill` in `defaults.ts` (lines 319-322)
    - Confirm it reads `activity.user_interaction_level`
    - Confirm fallback to AUTOMATED colour when field missing
  - [x] 1.4 Verify `getNodeFillColor` in `rendering.ts` (lines 257-276)
    - Confirm it checks `node.entity_type === ENTITY_TYPES.PROCESS_ACTIVITY`
    - Confirm it looks up ProcessActivity from model by `entity_id`
    - Confirm it calls `getProcessActivityDefaultFill(activity)` for colour
    - Confirm fallback to entity type default for non-PROCESS_ACTIVITY nodes
  - [x] 1.5 Ensure infrastructure tests pass
    - Run ONLY the 3 tests written in 1.1
    - Verify all existing helper functions work correctly

**Acceptance Criteria:**
- The 3 tests written in 1.1 pass
- `processActivityColors` mapping is verified correct
- `getProcessActivityDefaultFill` correctly returns colours based on `user_interaction_level`
- `getNodeFillColor` correctly handles PROCESS_ACTIVITY special case

**Files to reference:**
- `frontend/src/config/defaults.ts` - lines 305-322
- `frontend/src/utils/rendering.ts` - lines 257-276
- `frontend/src/types/model.ts` - ProcessActivity type, UserInteractionLevel type

---

### Canvas Rendering Fix

#### Task Group 2: Canvas.tsx Core Fix
**Dependencies:** Task Group 1

- [x] 2.0 Complete Canvas.tsx rendering fix
  - [x] 2.1 Write 4 focused tests for Canvas colour rendering
    - Test 1: PROCESS_ACTIVITY node with `user_interaction_level='AUTOMATED'` renders with #a5d6a7 fill
    - Test 2: PROCESS_ACTIVITY node with `user_interaction_level='SIGNIFICANT'` renders with #ffcdd2 fill
    - Test 3: Non-PROCESS_ACTIVITY node continues to use entity type default colour
    - Test 4: PROCESS_ACTIVITY node without explicit `background_color` derives colour from entity metadata
  - [x] 2.2 Add `getNodeFillColor` to imports from `utils/rendering`
    - Location: Canvas.tsx line ~3-28 (rendering imports block)
    - Add `getNodeFillColor` to the existing import statement
  - [x] 2.3 Replace static colour lookup with dynamic colour derivation
    - Location: Canvas.tsx line ~2111
    - Current: `const nodeBackgroundColor = node.background_color || colors.background;`
    - Replace with: `const nodeBackgroundColor = getNodeFillColor(node, state.model);`
    - Note: `getNodeFillColor` already handles custom `background_color` override internally (line 259-261 in rendering.ts)
  - [x] 2.4 Ensure Canvas rendering tests pass
    - Run ONLY the 4 tests written in 2.1
    - Verify Process Activity nodes now render with correct dynamic colours

**Acceptance Criteria:**
- The 4 tests written in 2.1 pass
- `getNodeFillColor` is imported in Canvas.tsx
- Line ~2111 uses `getNodeFillColor(node, state.model)` instead of static lookup
- PROCESS_ACTIVITY nodes render with colours derived from `user_interaction_level`

**Files to modify:**
- `frontend/src/components/DiagramsView/Canvas.tsx` - lines 3-28 (imports), line ~2111 (colour assignment)

---

### Node Creation Path Verification

#### Task Group 3: Verify No background_color Overrides on Creation
**Dependencies:** Task Group 2

- [x] 3.0 Complete creation path verification
  - [x] 3.1 Write 4 focused tests for node creation paths
    - Test 1: Simple Add from PalettePanel creates PROCESS_ACTIVITY without `background_color` property
    - Test 2: "Add with Process Activities" creates child nodes without `background_color` property
    - Test 3: AdvancedAddDialog creates PROCESS_ACTIVITY nodes without `background_color` property
    - Test 4: buildWrappedNodeHierarchy creates PROCESS_ACTIVITY nodes without `background_color` property
  - [x] 3.2 Verify PalettePanel.tsx Simple Add path
    - Location: `handleAddProcessActivity` function (lines ~738-903)
    - Confirm `childNode` creation (line ~835-847) does NOT set `background_color`
    - Current code creates node with `style_override: {}` - this is correct, verify it remains empty
  - [x] 3.3 Verify PaletteContextMenu.tsx "Add with Process Activities" path
    - Location: `handleAddWithProcessActivities` callback in PalettePanel.tsx (lines ~1366-1539)
    - Confirm child PROCESS_ACTIVITY nodes (line ~1467-1481) do NOT set `background_color`
  - [x] 3.4 Verify AdvancedAddDialog.tsx creation path
    - Location: `buildWrappedNodeHierarchy` function in PalettePanel.tsx (lines ~147-389)
    - Confirm `newNode` creation (lines ~295-314) does NOT set `background_color`
    - Confirm child nodes created via recursive wrapping do NOT set `background_color`
  - [x] 3.5 Verify createDiagramNodeFromEntity utility
    - Location: `utils/nodeCreation.ts` (if exists)
    - Confirm base node creation does NOT set `background_color` for PROCESS_ACTIVITY
  - [x] 3.6 Ensure creation path tests pass
    - Run ONLY the 4 tests written in 3.1
    - Verify no hardcoded `background_color` on any PROCESS_ACTIVITY creation path

**Acceptance Criteria:**
- The 4 tests written in 3.1 pass
- No creation path sets `background_color` on PROCESS_ACTIVITY nodes
- PROCESS_ACTIVITY nodes rely entirely on runtime colour derivation

**Files to verify:**
- `frontend/src/components/DiagramsView/PalettePanel.tsx` - lines 738-903, 1366-1539, 147-389
- `frontend/src/components/DiagramsView/PaletteContextMenu.tsx`
- `frontend/src/components/DiagramsView/AdvancedAddDialog.tsx`

---

### Live Update Verification

#### Task Group 4: Verify Live Update Behaviour
**Dependencies:** Task Groups 2, 3

- [x] 4.0 Complete live update verification
  - [x] 4.1 Write 3 focused tests for live update behaviour
    - Test 1: Changing `user_interaction_level` from AUTOMATED to SIGNIFICANT updates node fill immediately
    - Test 2: Canvas re-renders when `state.model` updates via `UPDATE_ENTITY` dispatch
    - Test 3: Colour change does not require page refresh, modal close, or manual reload
  - [x] 4.2 Verify ArchitectureContext UPDATE_ENTITY action flow
    - Confirm grid cell edit dispatches `UPDATE_ENTITY` with updated ProcessActivity
    - Confirm `UPDATE_ENTITY` updates `state.model.metaModel.entities.process_activities`
    - Confirm Canvas receives updated state via `useArchitecture()` hook
  - [x] 4.3 Verify Canvas re-render triggers colour recalculation
    - Confirm `getNodeFillColor(node, state.model)` is called on each render
    - Confirm fresh `user_interaction_level` is read from updated entity
    - Confirm correct colour is returned from `processActivityColors` mapping
  - [x] 4.4 Ensure live update tests pass
    - Run ONLY the 3 tests written in 4.1
    - Verify immediate visual feedback when metadata changes

**Acceptance Criteria:**
- The 3 tests written in 4.1 pass
- Editing `user_interaction_level` in RHS panel immediately updates diagram colour
- No refresh, reload, or modal close required for colour update
- React re-render cycle correctly propagates state changes to Canvas

**Files to verify:**
- `frontend/src/contexts/ArchitectureContext.tsx` - UPDATE_ENTITY reducer
- `frontend/src/components/DiagramsView/Canvas.tsx` - useArchitecture hook usage

---

### Testing

#### Task Group 5: Test Review & Gap Analysis
**Dependencies:** Task Groups 1-4

- [x] 5.0 Review existing tests and fill critical gaps only
  - [x] 5.1 Review tests from Task Groups 1-4
    - Review the 3 tests written by infrastructure verification (Task 1.1)
    - Review the 4 tests written by Canvas fix (Task 2.1)
    - Review the 4 tests written by creation path verification (Task 3.1)
    - Review the 3 tests written by live update verification (Task 4.1)
    - Total existing tests: approximately 14 tests
  - [x] 5.2 Analyze test coverage gaps for THIS feature only
    - Identify any critical user workflows lacking coverage
    - Focus ONLY on gaps related to Process Activity colouring
    - Prioritize end-to-end colour rendering workflows
  - [x] 5.3 Write up to 6 additional strategic tests maximum IF NECESSARY
    - Potential gap: Nested PROCESS_ACTIVITY nodes (child colours independent of parent)
    - Potential gap: Mixed node types on same diagram (only PROCESS_ACTIVITY gets dynamic colour)
    - Potential gap: Entity with no `user_interaction_level` (graceful fallback to AUTOMATED)
    - Do NOT write comprehensive coverage for all scenarios
    - Skip edge cases and performance tests unless business-critical
  - [x] 5.4 Run feature-specific tests only
    - Run ONLY tests related to Process Activity colouring (tests from 1.1, 2.1, 3.1, 4.1, and 5.3)
    - Expected total: approximately 14-20 tests maximum
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 14-20 tests total)
- Critical Process Activity colouring workflows are covered
- No more than 6 additional tests added when filling in testing gaps
- Testing focused exclusively on this spec's feature requirements

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Infrastructure Verification** - Confirm existing colour infrastructure is correct
2. **Task Group 2: Canvas.tsx Core Fix** - Single-line fix to enable dynamic colour derivation
3. **Task Group 3: Creation Path Verification** - Ensure no hardcoded colours on node creation
4. **Task Group 4: Live Update Verification** - Confirm immediate visual feedback on metadata change
5. **Task Group 5: Test Review & Gap Analysis** - Review coverage and fill critical gaps

---

## Key Code References

### Colour Infrastructure (Already Implemented)
```typescript
// defaults.ts lines 305-310
export const processActivityColors: Record<UserInteractionLevel, string> = {
  AUTOMATED: '#a5d6a7',    // Medium green
  MINIMAL: '#c8e6c9',      // Light green
  MODERATE: '#fff9c4',     // Light yellow
  SIGNIFICANT: '#ffcdd2',  // Light red
};

// defaults.ts lines 319-322
export function getProcessActivityDefaultFill(activity: ProcessActivity): string {
  const userInteractionLevel = activity.user_interaction_level || 'AUTOMATED';
  return processActivityColors[userInteractionLevel] || processActivityColors.AUTOMATED;
}

// rendering.ts lines 257-276
export function getNodeFillColor(node: DiagramNode, model?: ArchitectureModel): string {
  if (node.background_color) {
    return node.background_color;
  }
  if (node.entity_type === ENTITY_TYPES.PROCESS_ACTIVITY && model) {
    const activity = model.metaModel.entities.process_activities.find(
      (a: ProcessActivity) => a.id === node.entity_id
    );
    if (activity) {
      return getProcessActivityDefaultFill(activity);
    }
  }
  const colors = entityColors[node.entity_type];
  return colors?.background || '#FFFFFF';
}
```

### Canvas.tsx Fix Location
```typescript
// Canvas.tsx line ~2111
// BEFORE:
const nodeBackgroundColor = node.background_color || colors.background;

// AFTER:
const nodeBackgroundColor = getNodeFillColor(node, state.model);
```

### Import Addition
```typescript
// Canvas.tsx lines 3-28, add to existing import block:
import {
  getNodesInRenderOrder,
  getEdgesForDiagram,
  getEntityLabel,
  getEntityColor,
  getNodeFillColor,  // <-- ADD THIS
  // ... rest of imports
} from '../../utils/rendering';
```

---

## Out of Scope

- Changes to Business Process node colours or any other entity type styling
- Changes to `user_interaction_level` enum values
- Changes to diagram layout, positioning, or wrapping algorithms
- Backend/API changes (frontend-only scope)
- Changes to the Activities grid UI columns
- Migration logic for old `is_manual`/`user_input_amount` fields
- Performance optimizations beyond standard React re-render
- Persisting computed colours to `node.background_color` (colours must be derived, not stored)

---

## Implementation Summary

**Completed: 2025-12-03**

All 5 task groups have been implemented successfully:

### Changes Made:

1. **Canvas.tsx** (`frontend/src/components/DiagramsView/Canvas.tsx`):
   - Added `getNodeFillColor` to imports from `../../utils/rendering` (line 28)
   - Changed line 2112 from:
     ```typescript
     const nodeBackgroundColor = node.background_color || colors.background;
     ```
     to:
     ```typescript
     const nodeBackgroundColor = getNodeFillColor(node, state.model);
     ```

2. **Test File Created** (`frontend/src/__tests__/process-activity-conditional-colouring.test.ts`):
   - 25 tests covering all 5 task groups
   - All tests pass

### Verification:

- **Colour Infrastructure**: Verified `processActivityColors` mapping and `getProcessActivityDefaultFill` function work correctly
- **Canvas Fix**: `getNodeFillColor` is now called for every node render, enabling dynamic colour derivation
- **Creation Paths**: Verified no creation path (PalettePanel, PaletteContextMenu, AdvancedAddDialog, nodeCreation utility) sets `background_color` on PROCESS_ACTIVITY nodes
- **Live Updates**: Canvas consumes `state.model` via `useArchitecture()` hook; when `UPDATE_ENTITY` dispatches, React re-renders and `getNodeFillColor` reads fresh `user_interaction_level`

### Test Results:
```
25 tests passing (7ms)
- Task Group 1: 7 tests (infrastructure verification)
- Task Group 2: 5 tests (Canvas colour rendering)
- Task Group 3: 4 tests (node creation paths)
- Task Group 4: 3 tests (live update behaviour)
- Task Group 5: 6 tests (gap analysis - additional strategic tests)
```
