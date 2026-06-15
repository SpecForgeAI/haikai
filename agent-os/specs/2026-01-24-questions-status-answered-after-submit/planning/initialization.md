# Spec Initialization

## Title
Implement Screen Change 2 — Questions Status Only Becomes Answered After Submit Success

## Description
Fix the Questions table behavior so a question remains in Status="Open" while the user types an
answer. A question must only transition to Status="Answered" after the user clicks
"Answer Open Questions" and the answered rows are successfully dispatched to the backend/LLMs.

## Current Problem
- Typing the first character into an Answer field immediately flips the question's status to "Answered"
- This is incorrect; it bypasses the explicit submit step and breaks the workflow and auditability

## Scope Includes
- Remove any logic that marks questions Answered during Answer input typing
- Update submit handler so only successfully submitted Open+answered rows become Answered
- Ensure chat transcript only appends the Tool User "answers" message after successful dispatch
- Preserve existing question rendering, filtering, and role grouping behavior

## Out of Scope
- Any changes to question identity strategy (UUID assignment already implemented)
- Any changes to planner/implementer JSON contracts
- Any changes to persistence schema beyond the status update behavior

## Created
2026-01-24
