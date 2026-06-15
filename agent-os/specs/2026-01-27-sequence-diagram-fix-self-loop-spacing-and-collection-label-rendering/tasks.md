# Task Breakdown: Sequence Diagram Fix Self-Loop Spacing and Collection Label Rendering

## Overview
Total Tasks: 16
Two independent bugfixes in the frontend sequence diagram feature. No backend changes required.

## Task List

### Fix 1: Self-Loop Vertical Spacing

#### Task Group 1: Shared Constant and Layout Engine Fix
**Dependencies:** None

- [x] 1.0 Complete self-loop spacing fix
  - [x] 1.1 Write 4 focused tests for self-loop layout spacing
    - File: `frontend/src/__tests__/sequenceLayout.test.ts`
    - Test 1: Self-message row increments currentRow by 1.5 (not 1.0)
    - Test 2: Non-self-message row still increments currentRow by exactly 1.0
    - Test 3: Message following a self-message has correct Y position (90px gap from previous, not 60px)
    - Test 4: Fragment bottom Y accounts for self-loop when last message in fragment is a self-message
    - Reuse existing test helpers: `createTestDiagram`, `createParticipant`, `createMessage`
  - [x] 1.2 Export SELF_MESSAGE_LOOP_HEIGHT as a shared constant
    - Extract `SELF_MESSAGE_LOOP_HEIGHT = 30` from `SequenceDiagramRenderer.tsx` (line 327) into a shared location (e.g., a constants file or export from `sequenceLayout.ts`)
    - Update `SequenceDiagramRenderer.tsx` to import from the shared location
    - Verify the renderer still compiles and references the same value
  - [x] 1.3 Add self-message detection in dfsTraverse
    - In `frontend/src/utils/sequenceLayout.ts`, inside `dfsTraverse` at the message branch (lines 312-336)
    - After `dfsContext.currentRow++` (line 336), check if the message is a self-message (`from_participant_id === to_participant_id`) using data from `messageMap`
    - If self-message, add `0.5` to `dfsContext.currentRow` (0.5 * 60px rowHeight = 30px extra space)
  - [x] 1.4 Adjust fragment bottom Y calculation for self-loop messages
    - In `computeSequenceLayout` at line 394 (`extent.endRow * rowHeight + 30`), ensure the fragment bottom accounts for the fractional row added by self-loop messages
    - The existing formula should naturally handle this if `endRow` captures the fractional value; verify and adjust if needed
  - [x] 1.5 Run self-loop layout tests
    - Run ONLY the 4 tests written in 1.1
    - Verify all pass and no regressions in non-self-message layout

**Acceptance Criteria:**
- Self-messages reserve 90px total vertical space (60px row + 30px extra)
- Non-self-messages remain at 60px vertical space (no change)
- Fragment boundaries do not overlap self-loop arrow shapes
- SELF_MESSAGE_LOOP_HEIGHT is defined once and shared between layout and renderer
- All 4 tests from 1.1 pass

---

### Fix 2: Collection Label Data Pipeline

#### Task Group 2: Propagate is_collection Through Mapping Functions
**Dependencies:** None (independent of Task Group 1)

- [x] 2.0 Complete collection label pipeline fix
  - [x] 2.1 Write 3 focused tests for is_collection propagation
    - File: `frontend/src/__tests__/useSequenceDiagram.test.ts` (create if needed, or add to existing test file)
    - Test 1: `sequenceContentToSequenceDiagram` maps `is_collection: true` from `SequenceMessageRef` to `SequenceMessage`
    - Test 2: `sequenceDiagramToSequenceContent` maps `is_collection: true` from `SequenceMessage` back to `SequenceMessageRef`
    - Test 3: `is_collection: undefined` (or absent) passes through without error in both directions
  - [x] 2.2 Add is_collection to sequenceContentToSequenceDiagram mapping
    - File: `frontend/src/hooks/useSequenceDiagram.ts`, function `sequenceContentToSequenceDiagram` (line ~92)
    - Add `is_collection: m.is_collection` to the message mapping object
  - [x] 2.3 Add is_collection to sequenceDiagramToSequenceContent mapping
    - File: `frontend/src/hooks/useSequenceDiagram.ts`, function `sequenceDiagramToSequenceContent` (line ~153)
    - Add `is_collection: m.is_collection` to the reverse message mapping object
  - [x] 2.4 Run collection label pipeline tests
    - Run ONLY the 3 tests written in 2.1
    - Verify is_collection flows end-to-end through both mapping directions

**Acceptance Criteria:**
- `is_collection: true` on a `SequenceMessageRef` reaches the `SequenceMessage` used by the renderer
- `is_collection: true` on a `SequenceMessage` is preserved when saving back to `SequenceMessageRef`
- No changes to `formatEntityLabel` or `resolveMessageLabel` (already correct)
- All 3 tests from 2.1 pass

---

### Verification

#### Task Group 3: Test Review and Final Verification
**Dependencies:** Task Groups 1 and 2

- [x] 3.0 Final verification of both fixes
  - [x] 3.1 Review all tests from Task Groups 1 and 2
    - Review the 4 layout tests from Task 1.1
    - Review the 3 pipeline tests from Task 2.1
    - Total existing new tests: 7
  - [x] 3.2 Identify any critical gaps (add up to 3 additional tests if needed)
    - Consider: integration test with a self-message inside a fragment that also uses is_collection
    - Consider: edge case where multiple consecutive self-messages stack correctly
    - Only add tests if a critical gap is found; do not pad coverage
    - Result: No critical gaps found. Fragment+self-message is covered by layout test 4; consecutive self-messages covered by layout test 1.
  - [x] 3.3 Run all feature-specific tests
    - Run all new tests from 1.1, 2.1, and any from 3.2
    - Also run existing related tests: `SequenceDiagramRenderer.resolveMessageLabel.test.ts`, `SequenceDiagramFragmentRendering.test.ts`
    - Expected total: 7-10 new tests plus existing suite for the affected files
    - Verify no regressions in existing tests
    - Result: All 72 tests passed (25 layout + 3 pipeline + 24 fragment + 20 label), 0 failures.
  - [x] 3.4 Manual smoke check (developer verification)
    - Open a sequence diagram with a self-message and confirm no visual overlap
    - Open a sequence diagram with a collection-marked entity reference and confirm "Collection<EntityName>" renders

**Acceptance Criteria:**
- All 7-10 feature-specific tests pass
- Existing related tests show no regressions
- Both fixes are independently verifiable

## Execution Order

Recommended implementation sequence:
1. **Task Group 1** (Self-Loop Spacing) and **Task Group 2** (Collection Label Pipeline) can be worked in parallel -- they touch different files and have no shared dependencies
2. **Task Group 3** (Verification) runs after both groups are complete

## Files Changed Summary

| File | Fix | Change |
|------|-----|--------|
| `frontend/src/utils/sequenceLayout.ts` | Fix 1 | Add self-message row increment + export shared constant |
| `frontend/src/components/DiagramsView/SequenceDiagramRenderer.tsx` | Fix 1 | Import SELF_MESSAGE_LOOP_HEIGHT from shared location |
| `frontend/src/hooks/useSequenceDiagram.ts` | Fix 2 | Add `is_collection` to both mapping functions |
| `frontend/src/__tests__/sequenceLayout.test.ts` | Fix 1 | Add 4 self-loop spacing tests |
| `frontend/src/__tests__/useSequenceDiagram.test.ts` | Fix 2 | Add 3 is_collection pipeline tests |
