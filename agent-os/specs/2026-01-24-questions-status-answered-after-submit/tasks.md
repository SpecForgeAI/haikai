# Task Breakdown: Questions Status Only Becomes Answered After Submit Success

## Overview
Total Tasks: 24 (across 4 task groups)

This spec fixes the Questions table behavior so questions remain in Status="Open" while the user types answers. Status transitions to "Answered" only after clicking "Answer Open Questions" and successful dispatch.

## Task List

### Task Group 1: Fix Status Derivation Logic
**Dependencies:** None

This group removes the answer-based status derivation from `deriveQuestions()` and `combinedQuestions`, ensuring status is managed explicitly rather than derived from answer presence.

- [x] 1.0 Complete status derivation fix
  - [x] 1.1 Write 4-6 focused tests for status derivation changes
    - Test that `deriveQuestions()` returns questions with status="Open" even when answer is non-empty
    - Test that `combinedQuestions` memo does not flip status based on answer presence
    - Test that PO questions maintain explicit status independent of answer text
    - Test that SA questions maintain explicit status independent of answer text
    - Test initial question state: all questions from backend/LLM start as "Open"
  - [x] 1.2 Add `questionStatuses` state to ImplementationAssistantPanel
    - Add state: `const [questionStatuses, setQuestionStatuses] = useState<Map<string, 'Open' | 'Answered'>>(new Map());`
    - Initialize all questions as "Open" when they arrive from backend/LLM
    - Add to state reset logic in hydration useEffect (lines 842-919)
    - Location: `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`
  - [x] 1.3 Modify `deriveQuestions()` in FeatureDefinitionPanel to use explicit status
    - Current location: lines 456-471 of `FeatureDefinitionPanel.tsx`
    - Remove: `const status = answer.trim() ? 'Answered' : 'Open';`
    - Change to accept a statuses map parameter: `deriveQuestions(openQuestions, answers, statuses: Map<string, 'Open' | 'Answered'>)`
    - Use explicit status from map: `const status = statuses.get(oq.id) ?? 'Open';`
  - [x] 1.4 Update FeatureDefinitionPanel props to receive questionStatuses
    - Add prop: `questionStatuses: Map<string, 'Open' | 'Answered'>`
    - Pass questionStatuses to `deriveQuestions()` call on line 653
    - Update `FeatureDefinitionPanelProps` interface (lines 375-444)
  - [x] 1.5 Modify `combinedQuestions` memo to use explicit status
    - Current location: lines 586-613 of `ImplementationAssistantPanel.tsx`
    - For PO questions (lines 588-598): Remove `const status = answer.trim() ? 'Answered' : 'Open';`
    - Replace with: `const status = questionStatuses.get(oq.id) ?? 'Open';`
    - For SA questions (lines 602-610): Remove `const status = answer.trim() ? 'Answered' : 'Open';`
    - Replace with: `const status = questionStatuses.get(q.id) ?? q.status;`
  - [x] 1.6 Update ImplementationAssistantPanel to pass questionStatuses to FeatureDefinitionPanel
    - Update the `<FeatureDefinitionPanel>` component call (lines 1739-1757)
    - Add prop: `questionStatuses={questionStatuses}`
  - [x] 1.7 Ensure status derivation tests pass
    - Run ONLY the 4-6 tests written in 1.1
    - Verify questions retain "Open" status while typing
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-6 tests written in 1.1 pass
- Typing in answer field does not change question status
- All new questions from backend/LLM initialize with status="Open"
- `questionStatuses` state tracks explicit status independently from answers

### Task Group 2: Update Button Enable Logic
**Dependencies:** Task Group 1

This group changes the "Answer Open Questions" button logic from `every()` to `some()`, enabling partial answer submission.

- [x] 2.0 Complete button enable logic update
  - [x] 2.1 Write 4 focused tests for button enable logic
    - Test button enabled when at least 1 Open question has non-empty answer (currently disabled)
    - Test button disabled when no Open questions have answers
    - Test button enabled when 2 of 3 Open questions have answers (partial)
    - Test button state ignores Answered questions (only considers Open)
  - [x] 2.2 Modify button enable logic in QuestionsTable
    - Current location: lines 109-112 of `QuestionsTable.tsx`
    - Change from: `const allOpenQuestionsAnswered = openQuestions.every(q => q.answer.trim().length > 0);`
    - Change to: `const hasOpenQuestionWithAnswer = openQuestions.some(q => q.answer.trim().length > 0);`
    - Update variable name for clarity
  - [x] 2.3 Update button disabled attribute
    - Current: `disabled={!allOpenQuestionsAnswered}` (line 141)
    - Change to: `disabled={!hasOpenQuestionWithAnswer}`
  - [x] 2.4 Ensure button enable logic tests pass
    - Run ONLY the 4 tests written in 2.1
    - Verify button enables with at least one answered Open question
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4 tests written in 2.1 pass
- Button enables when at least one Open question has a non-empty answer
- Button remains disabled when no Open questions have answers
- Partial answer submission is now possible

### Task Group 3: Update Submit Flow with Success-Based Status Transition
**Dependencies:** Task Groups 1 and 2

This group updates `handleSubmitAnswers` to mark questions as "Answered" only after successful dispatch, handles partial failures, adds loading state, and fixes chat transcript logic.

- [x] 3.0 Complete submit flow update
  - [x] 3.1 Write 6-8 focused tests for submit flow
    - Test that clicking submit collects only Open questions with non-empty answers
    - Test that successful dispatch updates status to "Answered" for submitted questions
    - Test that partial failure: successful questions become "Answered", failed stay "Open"
    - Test that complete failure: no status changes, error notification shown
    - Test loading state: spinner shown and button disabled during submission
    - Test chat transcript: message appended only after success with successful questions only
    - Test that inputs are disabled during submission (isSubmittingAnswers=true)
  - [x] 3.2 Refactor handleSubmitAnswers to collect submittable questions
    - Current location: lines 635-784 of `ImplementationAssistantPanel.tsx`
    - Before API call: Filter combinedQuestions for status="Open" AND answer.trim().length > 0
    - Store list of question IDs being submitted for tracking success/failure
  - [x] 3.3 Implement success-based status update logic
    - After successful API response: call `setQuestionStatuses()` to mark submitted questions as "Answered"
    - Only update status for questions that were successfully submitted
    - Keep failed questions as "Open"
  - [x] 3.4 Handle partial failure scenario
    - If API returns partial success (some questions failed):
      - Mark successful questions as "Answered"
      - Keep failed questions as "Open"
      - Show non-blocking error notification for failures
  - [x] 3.5 Handle complete failure scenario
    - If API call fails entirely:
      - No status changes (all questions remain "Open")
      - Show non-blocking error notification
      - No chat message appended
  - [x] 3.6 Add loading state UI enhancements
    - `isSubmittingAnswers` state already exists (line 544)
    - Add spinner to "Answer Open Questions" button during submission
    - Ensure button is disabled while `isSubmittingAnswers=true`
    - Ensure answer inputs are disabled while `isSubmittingAnswers=true` (via QuestionsTableRow)
  - [x] 3.7 Update composeAnswersMessage to accept explicit question list
    - Current location: lines 367-375 of `ImplementationAssistantPanel.tsx`
    - Modify signature: `composeAnswersMessage(successfulQuestions: Question[]): string`
    - Remove internal filter for `status === 'Answered'`
    - Compose message from the provided array directly (already answered, successful)
  - [x] 3.8 Update chat transcript append logic
    - Move chat message append to AFTER successful status update
    - Pass only the successfully submitted questions to `composeAnswersMessage()`
    - Only append message if at least one question was successfully submitted
  - [x] 3.9 Pass isSubmittingAnswers to QuestionsTable for input disabling
    - Add prop to QuestionsTable: `isSubmitting?: boolean`
    - Pass `isSubmittingAnswers` from ImplementationAssistantPanel
    - Disable answer inputs in QuestionsTableRow when `isSubmitting=true`
  - [x] 3.10 Ensure submit flow tests pass
    - Run ONLY the 6-8 tests written in 3.1
    - Verify success-based status transitions
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 6-8 tests written in 3.1 pass
- Status transitions to "Answered" only after successful submit
- Partial failures: only successful questions become "Answered"
- Complete failures: no status changes, error shown
- Loading spinner displayed during submission
- Button and inputs disabled during submission
- Chat message appended only after success with only successful questions

### Task Group 4: Tests and Verification
**Dependencies:** Task Groups 1, 2, and 3

This group reviews all tests, identifies critical gaps, and performs final integration verification.

- [x] 4.0 Review existing tests and fill critical gaps only
  - [x] 4.1 Review tests from Task Groups 1-3
    - Review the 4-6 tests written for status derivation (Task 1.1)
    - Review the 4 tests written for button enable logic (Task 2.1)
    - Review the 6-8 tests written for submit flow (Task 3.1)
    - Total existing tests: approximately 14-18 tests
  - [x] 4.2 Analyze test coverage gaps for THIS feature only
    - Identify any critical user workflows that lack test coverage
    - Focus ONLY on gaps related to this spec's feature requirements
    - Prioritize end-to-end workflows over unit test gaps
  - [x] 4.3 Write up to 6 additional strategic tests if necessary
    - Potential gap: Integration test for full workflow (type answer -> submit -> verify status)
    - Potential gap: Test that questionStatuses persists correctly across tab switches
    - Potential gap: Test interaction between PO and SA questions in combined view
    - Potential gap: Test QuestionsTableRow input disabled state during submission
    - Maximum 6 new tests to fill identified critical gaps
  - [x] 4.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature (tests from 1.1, 2.1, 3.1, and 4.3)
    - Expected total: approximately 20-24 tests maximum
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 20-24 tests total)
- Critical user workflows for this feature are covered
- No more than 6 additional tests added when filling in testing gaps
- Testing focused exclusively on this spec's feature requirements

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Fix Status Derivation Logic** (Foundation)
   - Must be completed first as it introduces the `questionStatuses` state
   - All other groups depend on explicit status management

2. **Task Group 2: Update Button Enable Logic** (Independent after Group 1)
   - Simple change with no dependencies on Group 3
   - Can be verified independently

3. **Task Group 3: Update Submit Flow** (Depends on Groups 1 and 2)
   - Uses `questionStatuses` from Group 1
   - Uses new button logic from Group 2
   - Core business logic for success-based transitions

4. **Task Group 4: Tests and Verification** (Final)
   - Depends on all previous groups
   - Ensures complete feature coverage
   - Final integration verification

## File Change Summary

| File | Changes |
|------|---------|
| `frontend/src/components/ProductView/FeatureDefinitionPanel.tsx` | Modify `deriveQuestions()` to accept explicit status map, update props interface |
| `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx` | Add `questionStatuses` state, modify `combinedQuestions` memo, update `handleSubmitAnswers`, update `composeAnswersMessage`, pass new props |
| `frontend/src/components/ProductView/QuestionsTable.tsx` | Change `every()` to `some()` for button enable logic, add `isSubmitting` prop |
| `frontend/src/components/ProductView/QuestionsTableRow.tsx` | Accept and respect `isSubmitting` prop for input disabling |

## Notes

- The `Question` interface in `chatApi.ts` (lines 309-330) already has the correct `status: 'Open' | 'Answered'` field - no changes needed there
- The existing `isSubmittingAnswers` state (line 544) can be reused for loading state
- Error notifications should use existing patterns in the codebase (non-blocking, likely via `setError`)
- SA questions already have `incrementId` field for filtering - no changes needed for SA question handling

## Test Summary

Tests written for this spec:
- `frontend/src/__tests__/questions-status-derivation.test.tsx` - 7 tests for Task Group 1
- `frontend/src/__tests__/questions-button-enable.test.tsx` - 5 tests for Task Group 2
- `frontend/src/__tests__/questions-submit-flow.test.tsx` - 11 tests for Task Group 3

Total: 23 tests (all passing)
