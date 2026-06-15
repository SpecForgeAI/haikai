# Specification: Open Questions Optimistic User Message

## Goal
Immediately render the user's Q&A message bubble in the Team Chat window when clicking "Answer Open Questions", instead of waiting for the Product Owner/LLM response.

## User Stories
- As a user answering open questions, I want to see my submitted answers appear immediately in the chat so that I have instant visual feedback that my action was registered.
- As a user, I want the chat message order preserved (my message followed by the assistant response) so that the conversation flow remains logical.

## Specific Requirements

**Optimistic user message insertion before API call**
- Construct the user message using `composeAnswersMessage(submittableQuestions)` at the start of `handleSubmitAnswers`, before the `await postChatMessage()` call
- Create a `ChatMessage` object with `role: 'user'` to render with "You" styling
- Use `generateMessageId()` for the message ID
- Call `setMessages(prev => [...prev, userMessage])` immediately after constructing the message
- This mirrors the existing pattern in `handleSend` (lines 1455-1462 of ImplementationAssistantPanel.tsx)

**Apply to both PO and SA submission paths**
- PO path: when `currentPhase !== 'implementation_clarification'` or `!activeIncrementId`
- SA path: when `currentPhase === 'implementation_clarification'` and `activeIncrementId` is set
- Both paths must insert the optimistic message before their respective `postChatMessage` calls

**Duplicate prevention using isSubmittingAnswers guard**
- The existing `isSubmittingAnswers` state already disables the submit button during submission
- Add an early-return guard at the top of `handleSubmitAnswers`: `if (isSubmittingAnswers) return;`
- This prevents multiple optimistic messages if the user clicks rapidly before the button disables

**Remove post-success user message insertion**
- Currently both paths create and append `userMessage` after API success (PO: lines 820-826, SA: lines 938-944)
- These existing `userMessage` insertions must be removed since the message is now added optimistically
- Only the assistant response message should be appended after API success

**Error handling preserves optimistic message**
- On API failure, the optimistic user message remains in the chat (do not remove it)
- The error is appended as an assistant message (existing pattern at lines 850-856 and 1006-1012)
- No additional error UI (toast/banner) is required beyond the existing error message pattern

**Natural message ordering via append order**
- Optimistic user message is appended first (before API call)
- Assistant response is appended when API resolves (after API call)
- This automatically preserves the correct order: You -> Product Owner/Software Architect

## Visual Design
None provided.

## Existing Code to Leverage

**handleSend optimistic pattern (lines 1451-1517)**
- Shows the correct pattern: create `ChatMessage` with `role: 'user'`, append to messages state immediately, then await API
- Error handling appends error as assistant message, keeps user message
- Use this as the reference implementation for the change

**composeAnswersMessage function (lines 403-407)**
- Already used in both PO and SA paths to format Q&A content
- Takes `Question[]` and returns formatted string: `Q: [question]\nA: [answer]` for each
- No changes needed to this function

**ChatMessage interface (chatApi.ts lines 502-507)**
- Structure: `{ id: string, role: 'user' | 'assistant', content: string, timestamp: Date }`
- User messages render with "You" styling via `role: 'user'`

**generateMessageId function (lines 389-391)**
- Creates unique message IDs: `msg-${Date.now()}-${random}`
- Already used throughout the component

**isSubmittingAnswers state (lines 604-605)**
- Boolean state for loading/submission guard
- Already passed to FeatureDefinitionPanel for button disable state

## Out of Scope
- No backend/API changes required
- No change to message formatting beyond reusing `composeAnswersMessage()`
- No retry workflow improvements beyond existing behavior
- No UI redesign of QuestionsTable or chat area
- No toast/banner error indicators (use existing assistant message pattern)
- No changes to the submit button text or styling
- No changes to how question statuses are updated (still only on success)
- No message removal or rollback on error
- No duplicate prevention across separate retries (only in-flight guard)
- No changes to the `persistChatState` function or persistence logic
