# Requirements Decisions

## 1. Message format
Yes - use the exact same `composeAnswersMessage()` Q&A format that is currently shown after the API response. No new formatting.

## 2. Error display on failure
Keep the optimistic user message visible. For the error, keep the current pattern (append an assistant/error message) for now to minimize UX churn. No special message-level styling required in this iteration.

## 3. Duplicate prevention
Yes - rely on the existing `isSubmittingAnswers` state (button disabled) to prevent double submits. Also ensure no additional optimistic message is appended if a submit is already in-flight.

## 4. Both paths
Yes - apply the optimistic message behavior to BOTH:
- Product Owner open questions submission
- Solution Architect / implementation_clarification questions submission

The UX should be consistent.

## 5. Message role
Yes - add the optimistic message with `role: 'user'` so it renders with the "You" styling/persona.

## 6. Ordering
Yes - rely on natural append order: optimistic user message first, then assistant response when it arrives.

## 7. Error indicator preference
Current pattern - append the error as an assistant message (as it already does). No toast/banner required.

## 8. Explicit exclusions
- No backend/API changes.
- No change to message formatting beyond reusing `composeAnswersMessage()`.
- No retry workflow improvements beyond existing behavior (and no dedupe-across-retry beyond the in-flight guard).
- No UI redesign of QuestionsTable or chat area; only adjust when the user message is appended.

## Visual Assets
None provided.
