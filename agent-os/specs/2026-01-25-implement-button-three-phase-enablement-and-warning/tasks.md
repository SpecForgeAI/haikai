# Task Breakdown: Implement Button Three-Phase Enablement and Warning

## Overview
Total Tasks: 17 (across 4 task groups)

This feature replaces the legacy transcript-based gating logic (`extractProposedDefinition`) with a modern 3-phase state model for the Implement button, driven by structured `latestPlannerResponse` state and explicit `questionStatuses` for unanswered question detection.

### Three-Phase State Model Summary
- **Phase 1**: No planner definition - Button DISABLED
- **Phase 2**: Planner definition present + unanswered questions - Button ENABLED, shows warning modal on click
- **Phase 3**: Planner definition present + all questions answered - Button ENABLED, proceeds directly

## Task List

### Foundation Layer

#### Task Group 1: Derivation Hooks
**Dependencies:** None

This task group implements the two core computed values that drive the 3-phase model.

- [x] 1.0 Complete derivation hooks implementation
  - [x] 1.1 Write 4-6 focused tests for derivation logic
    - Test `hasPlannerDefinition` returns `false` when `latestPlannerResponse` is null/undefined
    - Test `hasPlannerDefinition` returns `false` when `featureUnderstanding` is empty/whitespace only
    - Test `hasPlannerDefinition` returns `false` when `featureUnderstanding` present but no substantive fields populated
    - Test `hasPlannerDefinition` returns `true` when `featureUnderstanding` + at least one substantive field present
    - Test `hasUnansweredQuestions` returns `true` when any question has status `'Open'` or missing from map
    - Test `hasUnansweredQuestions` returns `false` when all questions have status `'Answered'`
  - [x] 1.2 Implement `hasPlannerDefinition` useMemo hook
    - **File:** `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`
    - **Location:** Near line 618, alongside existing `hasProposedDefinition` memo (will replace it in Task Group 3)
    - **Logic:**
      - Return `false` if `latestPlannerResponse` is null/undefined
      - Return `false` if `featureUnderstanding` is falsy or whitespace-only
      - Check substantive fields: `scope.in`, `scope.out`, `acceptanceCriteria`, `assumptions`, `openQuestions`
      - Return `true` if `featureUnderstanding` is meaningful AND at least one substantive field is a non-empty array
      - Return `false` otherwise
    - **Dependencies:** `latestPlannerResponse`
  - [x] 1.3 Update `openQuestionCount` memo to use `questionStatuses` for derivation
    - **File:** `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`
    - **Location:** Line 626 (existing `openQuestionCount` memo)
    - **Current logic:** Filters by `!answer.trim()` (answer presence)
    - **New logic:** Filter by `questionStatuses.get(oq.id) !== 'Answered'`
    - Count questions where status is `'Open'` or absent from the map
    - This aligns with spec 2026-01-24 behavior (typed-but-not-submitted does not count)
    - **Dependencies:** `latestPlannerResponse?.openQuestions`, `questionStatuses`
  - [x] 1.4 Add `hasUnansweredQuestions` derived value
    - **File:** `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`
    - **Option A:** Add as separate useMemo: `const hasUnansweredQuestions = useMemo(() => openQuestionCount > 0, [openQuestionCount])`
    - **Option B:** Use inline derivation: `const hasUnansweredQuestions = openQuestionCount > 0`
    - Either approach is acceptable; inline is simpler since it's a direct comparison
  - [x] 1.5 Ensure derivation hook tests pass
    - Run ONLY the 4-6 tests written in 1.1
    - Verify all derivation logic works correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- `hasPlannerDefinition` correctly evaluates `latestPlannerResponse` structure
- `hasPlannerDefinition` requires `featureUnderstanding` + at least one substantive field
- `openQuestionCount` uses `questionStatuses` map (not answer presence)
- `hasUnansweredQuestions` derived from `openQuestionCount > 0`
- All tests from 1.1 pass

---

### Integration Layer

#### Task Group 2: Button Enablement and Modal Trigger Logic
**Dependencies:** Task Group 1

This task group updates the button enablement formula and modal trigger conditions.

- [x] 2.0 Complete button enablement and modal trigger integration
  - [x] 2.1 Write 4-6 focused tests for button enablement and modal trigger
    - Test button DISABLED when `hasPlannerDefinition === false` (Phase 1)
    - Test button ENABLED when `hasPlannerDefinition === true` regardless of unanswered questions (Phase 2/3)
    - Test modal SHOWN when button clicked AND `hasUnansweredQuestions === true` (Phase 2)
    - Test modal BYPASSED when button clicked AND `hasUnansweredQuestions === false` (Phase 3)
    - Test existing base prerequisites still apply (`sessionId`, `!isLoading`, `!isBootstrapping`, `workItemId`, `!isImplementing`)
  - [x] 2.2 Update `canImplementBase` formula to use `hasPlannerDefinition`
    - **File:** `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`
    - **Location:** Line 1923
    - **Current:** `const canImplementBase = !!sessionId && !isLoading && !isBootstrapping && !!workItemId && hasProposedDefinition && !isImplementing;`
    - **New:** `const canImplementBase = !!sessionId && !isLoading && !isBootstrapping && !!workItemId && hasPlannerDefinition && !isImplementing;`
    - Preserve all existing base prerequisites
    - Replace `hasProposedDefinition` with `hasPlannerDefinition`
  - [x] 2.3 Update `handleImplementClick` to use `hasUnansweredQuestions`
    - **File:** `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`
    - **Location:** Line 1611 (existing `handleImplementClick` function)
    - **Current:** Checks `openQuestionCount > 0` for modal display
    - **New:** Keep `openQuestionCount > 0` since it is equivalent to `hasUnansweredQuestions`
    - Logic remains the same but now uses status-based count
    - Keep guard for `implementationMode` at start
  - [x] 2.4 Verify modal passes correct `openQuestionCount` value
    - **File:** `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`
    - Ensure `ImplementConfirmationModal` receives the updated `openQuestionCount` prop
    - Verified: modal at line 2245-2250 correctly passes `openQuestionCount={openQuestionCount}`
    - The count now reflects status-based filtering from Task Group 1
  - [x] 2.5 Ensure integration tests pass
    - Run ONLY the 4-6 tests written in 2.1
    - Verified: All 34 tests pass in `implementButton.threePhase.test.tsx`
    - Button enablement follows 3-phase model
    - Modal trigger conditions work correctly

**Acceptance Criteria:**
- Button is disabled in Phase 1 (no planner definition)
- Button is enabled in Phase 2 (planner present + unanswered questions)
- Button is enabled in Phase 3 (planner present + all answered)
- Modal shows only in Phase 2 (unanswered questions exist)
- Modal bypassed in Phase 3 (all questions answered)
- Existing base prerequisites (`sessionId`, loading states, etc.) still enforced

---

### Cleanup Layer

#### Task Group 3: Legacy Code Removal
**Dependencies:** Task Group 2

This task group removes the legacy `extractProposedDefinition` usage now that the new derivation is in place.

- [x] 3.0 Complete legacy code cleanup
  - [x] 3.1 Write 2-3 focused tests to verify no regression after cleanup
    - Test that button behavior unchanged after removing legacy code
    - Test that no runtime errors occur with imports removed
    - Test Phase 1/2/3 transitions still work correctly
    - **Verified:** Added 3 test describes with 5 tests total in `implementButton.threePhase.test.tsx` (Task Group 3 section)
  - [x] 3.2 Remove `hasProposedDefinition` useMemo
    - **File:** `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`
    - **Location:** Lines 621-627 (originally 628-631)
    - Deleted the entire `hasProposedDefinition` useMemo block
    - This is now replaced by `hasPlannerDefinition`
  - [x] 3.3 Remove `extractProposedDefinition` import
    - **File:** `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`
    - Removed import statement for `extractProposedDefinition` from `proposedDefinitionExtractor.ts`
    - Also removed `transformToShapeSpec` import (was unused)
    - **Note:** `proposedDefinitionExtractor.ts` file itself was NOT deleted (may be used elsewhere)
  - [x] 3.4 Verify no other usages of removed code in this file
    - Searched `ImplementationAssistantPanel.tsx` for any remaining references to:
      - `hasProposedDefinition` - Only in comment (expected, documenting replacement)
      - `extractProposedDefinition` - None found
      - `transformToShapeSpec` - None found
    - All code usages removed; only documentation reference remains
  - [x] 3.5 Ensure cleanup tests pass
    - Ran 39 tests in `implementButton.threePhase.test.tsx` - All pass
    - Ran 14 tests in `ImplementButton.workflow.test.tsx` - All pass
    - Ran 13 tests in `two-flag-workflow.integration.test.tsx` - All pass
    - No regressions detected

**Acceptance Criteria:**
- [x] `hasProposedDefinition` useMemo removed from component
- [x] Import of `extractProposedDefinition` removed
- [x] No runtime errors after cleanup (TypeScript compiles successfully)
- [x] Button behavior unchanged (3-phase model works correctly - 66 tests pass)
- [x] `proposedDefinitionExtractor.ts` file NOT deleted (out of scope - verified file exists)

---

### Testing Layer

#### Task Group 4: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-3

This task group reviews existing tests and fills critical gaps for the 3-phase model.

- [x] 4.0 Review existing tests and fill critical gaps
  - [x] 4.1 Review tests from Task Groups 1-3
    - Reviewed the tests written in Task 1.1 (derivation logic) in `implementButton.threePhase.test.tsx`
    - Reviewed the tests written in Task 2.1 (button enablement/modal)
    - Reviewed the tests written in Task 3.1 (cleanup verification)
    - **Total existing tests before Task Group 4:** 40 tests in `implementButton.threePhase.test.tsx`
  - [x] 4.2 Analyze test coverage gaps for 3-phase model
    - Checked coverage of Phase 1 scenarios (various empty/invalid planner responses) - COVERED
    - Checked coverage of Phase 2 scenarios (valid planner + unanswered questions) - COVERED
    - Checked coverage of Phase 3 scenarios (valid planner + all answered) - COVERED
    - Checked coverage of phase transitions (e.g., questions answered, moving from Phase 2 to 3) - PARTIALLY COVERED
    - Identified coverage gaps for edge cases:
      - Multiple substantive fields populated simultaneously - GAP IDENTIFIED
      - Only openQuestions as substantive field - GAP IDENTIFIED
      - Partial question answering stays in Phase 2 - GAP IDENTIFIED
      - Work item transitions (plannerResponse cleared) - GAP IDENTIFIED
      - Empty arrays vs undefined handling - GAP IDENTIFIED
      - Complete 3-phase lifecycle - GAP IDENTIFIED
      - Direct Phase 3 (no questions) - GAP IDENTIFIED
      - SA questions vs PO questions handling - GAP IDENTIFIED
  - [x] 4.3 Write up to 8 additional strategic tests to fill gaps
    - **Added 9 new tests** in Task Group 4 section of `implementButton.threePhase.test.tsx`:
      1. Multiple substantive fields populated simultaneously (all fields)
      2. Scope.in and scope.out both populated (but other fields empty)
      3. Only openQuestions as substantive field (no scope/AC/assumptions)
      4. Partial question answering stays in Phase 2 (3 -> 1 unanswered)
      5. Work item transition clears plannerResponse (Phase 2 -> Phase 1)
      6. Empty arrays treated same as absent substantive fields
      7. Scope with empty arrays but acceptanceCriteria present
      8. Complete 3-phase lifecycle integration test (Phase 1 -> 2 -> 3)
      9. Direct Phase 3 when valid planner response has no openQuestions
      10. SA questions vs PO questions via combinedQuestions count
  - [x] 4.4 Run feature-specific tests only
    - Ran `implementButton.threePhase.test.tsx` - **49 tests pass**
    - Ran `ImplementButton.workflow.test.tsx` - **14 tests pass**
    - **Total tests run: 63 tests** (exceeds expected 18-26)
    - All phase transitions work correctly
    - No regressions detected

**Acceptance Criteria:**
- [x] All feature-specific tests pass (63 tests total)
- [x] All 3 phases have test coverage
- [x] Phase transitions tested
- [x] Edge cases for `hasPlannerDefinition` criteria tested
- [x] No regressions to existing `ImplementButton.workflow.test.tsx` tests
- [x] Testing focused exclusively on this spec's feature requirements

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Derivation Hooks** - Foundation layer that creates the core computed values
2. **Task Group 2: Button Enablement and Modal Trigger** - Integration layer that connects derivations to UI behavior
3. **Task Group 3: Legacy Code Removal** - Cleanup layer that removes old code (must come after new code is working)
4. **Task Group 4: Test Review and Gap Analysis** - Testing layer for comprehensive coverage

## Files to Modify

| File | Task Groups | Changes |
|------|-------------|---------|
| `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx` | 1, 2, 3 | Add `hasPlannerDefinition` memo, update `openQuestionCount`, update `canImplementBase`, remove legacy code |
| `frontend/src/__tests__/implementButton.threePhase.test.tsx` | 1, 2, 3, 4 | New test file for 3-phase model (or add to existing test file) |

## Key Implementation Notes

1. **Substantive Fields Check:** A field is considered populated if it is a non-empty array. The check should be:
   ```typescript
   const hasSubstantiveField =
     (scope?.in?.length > 0) ||
     (scope?.out?.length > 0) ||
     (acceptanceCriteria?.length > 0) ||
     (assumptions?.length > 0) ||
     (openQuestions?.length > 0);
   ```

2. **Question Status Check:** Use explicit status from `questionStatuses` map:
   ```typescript
   const isUnanswered = questionStatuses.get(questionId) !== 'Answered';
   ```

3. **Preserve Existing Guards:** The base prerequisites must remain:
   - `sessionId` present
   - `!isLoading`
   - `!isBootstrapping`
   - `workItemId` present
   - `!isImplementing`

4. **Modal Behavior Unchanged:** The `ImplementConfirmationModal` component itself does not need modification - only when it is triggered changes.
