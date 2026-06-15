# Specification: Questions Status Only Becomes Answered After Submit Success

## Goal
Fix the Questions table behavior so a question remains in Status="Open" while the user types an answer. A question must only transition to Status="Answered" after clicking "Answer Open Questions" and the dispatch succeeds.

## User Stories
- As a Product Owner, I want question status to remain "Open" while I am typing an answer so that my work-in-progress is not prematurely marked as complete.
- As a Product Owner, I want to see which questions were successfully submitted so that I can trust the status reflects actual backend state.

## Specific Requirements

**Remove status update from answer onChange handler**
- Currently `deriveQuestions()` in `FeatureDefinitionPanel.tsx` derives status from answer presence: non-empty answer = "Answered"
- This logic must be removed; status should be stored/managed explicitly rather than derived from answer text
- `handleAnswerChange()` in `ImplementationAssistantPanel.tsx` should only update the answer text, not affect status
- The `combinedQuestions` memo that applies answers to questions should not flip status based on answer presence

**Introduce explicit question status state**
- Add state to track question statuses independently from answers (e.g., `questionStatuses: Map<string, 'Open' | 'Answered'>`)
- Initialize all questions as "Open" when they arrive from the backend/LLM
- Status only transitions to "Answered" via explicit state update after successful submit

**Button enable logic change**
- Current: "Answer Open Questions" enabled when all Open questions have non-empty trimmed answers
- New: Button enabled when at least one Open question has a non-empty trimmed answer
- Rationale: Allows partial answer submission (user can answer some questions now, others later)
- Button remains disabled when no Open questions have answers to submit

**Submit flow with success-based status transition**
- On button click: collect all Open questions that have non-empty trimmed answers
- Call API to dispatch answers (existing `handleSubmitAnswers()` in `ImplementationAssistantPanel.tsx`)
- On success: update status to "Answered" only for the questions that were submitted
- On partial failure: only successfully submitted questions become "Answered"; failed ones stay "Open"
- Show non-blocking error notification for any failures

**Loading state during submission**
- Set `isSubmittingAnswers` to true before API call (already exists)
- Show spinner on "Answer Open Questions" button during submission
- Disable button and answer inputs while submitting
- Clear loading state on completion (success or failure)

**Chat transcript append logic**
- Current `composeAnswersMessage()` filters for `status === 'Answered'` before composing the message
- This must be updated to compose message from the questions that were just successfully submitted
- The "Tool User answers" message should only be appended after submit succeeds
- Message content should include only the questions/answers that successfully transitioned to "Answered"

**Error handling**
- On complete failure: show non-blocking error notification, no status changes, no chat message
- On partial failure: mark successful questions as "Answered", show error for failures, append chat message with only successful answers
- Error display should not block user from retrying or continuing to work

## Existing Code to Leverage

**FeatureDefinitionPanel.tsx - deriveQuestions function (lines 456-471)**
- Currently derives status from answer.trim() presence
- Needs modification to accept explicit status from state rather than deriving
- Pattern can be reused for merging answers with questions, just without status derivation

**QuestionsTable.tsx - button enable logic (lines 109-112)**
- Current logic: `allOpenQuestionsAnswered = openQuestions.every(q => q.answer.trim().length > 0)`
- Change to: `hasOpenQuestionWithAnswer = openQuestions.some(q => q.answer.trim().length > 0)`
- Same location, minor logic change

**ImplementationAssistantPanel.tsx - handleSubmitAnswers (lines 635-784)**
- Already has `isSubmittingAnswers` state and loading management
- Already calls API and handles responses
- Needs modification to: collect answerable questions, track success per question, update statuses explicitly
- Current `composeAnswersMessage()` call happens before status update; needs to happen after with success list

**ImplementationAssistantPanel.tsx - combinedQuestions memo (lines 586-613)**
- Currently derives status from answer presence for both PO and SA questions
- Needs to use explicit status state instead of deriving from answer text

**chatApi.ts - Question interface (lines 309-330)**
- Already has `status: 'Open' | 'Answered'` field
- No changes needed to interface, just how status is managed in component state

## Out of Scope
- Changes to question identity strategy (UUID assignment already implemented)
- Changes to planner/implementer JSON contracts
- Changes to persistence schema beyond status update behavior
- Submit timeouts or automatic retries
- Undo after submit functionality
- Editing previously answered questions (answer input already disabled when Answered)
- Any "resend answers" flow for failed submissions
- Toast/notification component implementation (use existing patterns)
- Changes to QuestionsTableRow component styling or layout
- SA question flow changes beyond the status management fix
