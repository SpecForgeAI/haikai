# Spec Requirements: Questions Status Only Becomes Answered After Submit Success

## Initial Description
Fix the Questions table behavior so a question remains in Status="Open" while the user types an answer. A question must only transition to Status="Answered" after the user clicks "Answer Open Questions" and the answered rows are successfully dispatched to the backend/LLMs.

**Current Problem:**
- Typing the first character into an Answer field immediately flips the question's status to "Answered"
- This is incorrect; it bypasses the explicit submit step and breaks the workflow and auditability

**Scope Includes:**
- Remove any logic that marks questions Answered during Answer input typing
- Update submit handler so only successfully submitted Open+answered rows become Answered
- Ensure chat transcript only appends the Tool User "answers" message after successful dispatch
- Preserve existing question rendering, filtering, and role grouping behavior

**Out of Scope:**
- Any changes to question identity strategy (UUID assignment already implemented)
- Any changes to planner/implementer JSON contracts
- Any changes to persistence schema beyond the status update behavior

## Requirements Discussion

### First Round Questions

**Q1:** Questions Table Structure - columns are: Question text, Answer input field, and Status. Any additional columns needed?
**Answer:** Correct - columns are: Question text, Answer input field, and Status. No additional columns needed.

**Q2:** Answer Input Behavior - should there be any visual indicator (like "Draft" or "Pending") when the user is typing, or should the status simply remain "Open" until submit?
**Answer:** Remove the status update entirely from the input handler. No "Draft/Pending" indicator in this iteration - keep it simple.

**Q3:** Partial Success Handling - if some answers succeed and others fail during submit, how should we handle it?
**Answer:** Yes, handle partial success. Only the successfully submitted questions become Answered; failures remain Open (and show a non-blocking error).

**Q4:** Button Enable State - when should the "Answer Open Questions" button be enabled?
**Answer:** Enabled only when at least one Open question has a non-empty answer. Don't allow clicking if there's nothing to submit.

**Q5:** Loading & Success Feedback - should there be loading feedback during submission, and how should success be communicated?
**Answer:** Yes to loading feedback (spinner + disable button while submitting). After success, status updates are enough - no toast needed for success.

**Q6:** Chat Transcript Behavior - should the "Tool User answers" chat message be appended only after successful submit?
**Answer:** Correct. Append the "Tool User answers" chat message only after submit succeeds, and include only the questions that were successfully marked Answered.

**Q7:** What should be explicitly deferred or out of scope for this feature?
**Answer:** Deferred/Out of Scope:
- Submit timeouts/retries
- Undo after submit
- Editing answered questions
- Any "resend answers" flow
Keep it simple: one submit attempt, reflect success/partial success, leave failures Open.

### Existing Code to Reference
No similar existing features identified for reference.

### Follow-up Questions
None required - user provided comprehensive answers.

## Visual Assets

### Files Provided:
No visual assets provided.

### Visual Insights:
N/A

## Requirements Summary

### Functional Requirements
- Questions table has three columns: Question text, Answer input field, Status
- Typing in Answer field leaves Status as "Open" (no onChange status update)
- "Answer Open Questions" button is enabled only when at least one Open question has a non-empty trimmed answer
- Submit flow: Send answers to backend/LLMs, on success mark those rows "Answered", append chat message
- Partial failure handling: Only successful rows become "Answered", failed rows stay "Open", show non-blocking error
- Loading feedback: Spinner on button + button disabled while submit is in progress
- Success feedback: Status column updates to "Answered" (no toast needed)
- Failure feedback: Non-blocking error notification, statuses unchanged, no chat message appended
- Chat transcript: Append "Tool User answers" message only after submit succeeds, include only successfully answered questions

### Reusability Opportunities
No similar existing features identified by user for reference.

### Scope Boundaries
**In Scope:**
- Remove logic that marks questions Answered during Answer input typing
- Update submit handler to mark only successfully submitted Open+answered rows as Answered
- Ensure chat transcript only appends after successful dispatch
- Add loading state with spinner and disabled button during submission
- Handle partial success (some succeed, some fail)
- Non-blocking error display for failures
- Preserve existing question rendering, filtering, and role grouping behavior

**Out of Scope:**
- Changes to question identity strategy (UUID assignment already implemented)
- Changes to planner/implementer JSON contracts
- Changes to persistence schema beyond status update behavior
- Submit timeouts/retries
- Undo after submit
- Editing answered questions
- Any "resend answers" flow

### Technical Considerations
- Must integrate with existing backend/LLM dispatch mechanism
- Button enable logic requires checking: Open status + non-empty trimmed answer
- Need to track which specific questions succeeded vs failed during submit
- Chat message content must only include successfully answered questions
- Error display should be non-blocking (likely a notification/toast for errors, but not for success)
