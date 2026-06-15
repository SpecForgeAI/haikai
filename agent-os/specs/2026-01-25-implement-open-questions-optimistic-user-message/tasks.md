# Task Breakdown: Open Questions Optimistic User Message

## Overview
Total Tasks: 15 (across 4 task groups)

This feature adds optimistic UI rendering for user messages when submitting answers to open questions. The user's Q&A message appears immediately in the Team Chat window on button click, rather than waiting for the LLM response. This applies to both Product Owner (PO) and Solution Architect (SA) question submission paths.

## Task List

### Foundation

#### Task Group 1: Understand Existing Patterns and Add Guard
**Dependencies:** None

- [x] 1.0 Complete foundation work
  - [x] 1.1 Review existing `handleSend` optimistic pattern
    - File: `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`
    - Study lines 1451-1517 to understand the reference implementation
    - Note the pattern: create ChatMessage with `role: 'user'`, append to messages state, then await API
    - Document how error handling keeps user message and appends error as assistant message
  - [x] 1.2 Review `handleSubmitAnswers` current implementation
    - File: `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`
    - Identify PO path (lines ~820-826 post-success user message)
    - Identify SA path (lines ~938-944 post-success user message)
    - Understand the branching logic based on `currentPhase` and `activeIncrementId`
  - [x] 1.3 Add early-return guard for duplicate prevention
    - File: `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`
    - Add `if (isSubmittingAnswers) return;` at the top of `handleSubmitAnswers`
    - This prevents multiple optimistic messages on rapid clicks before button disables

**Acceptance Criteria:**
- Developer has documented understanding of handleSend pattern
- Developer has identified exact line numbers for PO and SA user message insertions
- Early-return guard added to handleSubmitAnswers
- Rapid double-clicks cannot trigger multiple submissions

---

### PO Questions Path

#### Task Group 2: Optimistic Message for Product Owner Path
**Dependencies:** Task Group 1

- [x] 2.0 Complete PO path optimistic message
  - [x] 2.1 Construct optimistic user message at start of PO path
    - File: `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`
    - In the PO branch (when `currentPhase !== 'implementation_clarification'` or `!activeIncrementId`)
    - Before the `await postChatMessage()` call, construct user message:
      ```typescript
      const userMessageContent = composeAnswersMessage(submittableQuestions);
      const userMessage: ChatMessage = {
        id: generateMessageId(),
        role: 'user',
        content: userMessageContent,
        timestamp: new Date()
      };
      ```
  - [x] 2.2 Insert optimistic message into state immediately
    - File: `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`
    - Call `setMessages(prev => [...prev, userMessage])` immediately after construction
    - This must happen BEFORE the `await postChatMessage()` call
  - [x] 2.3 Remove post-success user message insertion in PO path
    - File: `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`
    - Remove the existing code that creates and appends `userMessage` after API success (lines ~820-826)
    - Keep only the assistant response message append after API success
    - Verify error handling still appends error as assistant message (do not modify)

**Acceptance Criteria:**
- PO path user message appears immediately on button click (before API resolves)
- Message uses `role: 'user'` and renders with "You" styling
- Message content matches `composeAnswersMessage()` output
- No duplicate user message after API success
- Error handling preserved (error appears as assistant message, user message stays)
- Message ordering correct: User message -> Assistant response

---

### SA Questions Path

#### Task Group 3: Optimistic Message for Solution Architect Path
**Dependencies:** Task Group 1

- [x] 3.0 Complete SA path optimistic message
  - [x] 3.1 Construct optimistic user message at start of SA path
    - File: `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`
    - In the SA branch (when `currentPhase === 'implementation_clarification'` AND `activeIncrementId` is set)
    - Before the `await postChatMessage()` call, construct user message:
      ```typescript
      const userMessageContent = composeAnswersMessage(submittableQuestions);
      const userMessage: ChatMessage = {
        id: generateMessageId(),
        role: 'user',
        content: userMessageContent,
        timestamp: new Date()
      };
      ```
  - [x] 3.2 Insert optimistic message into state immediately
    - File: `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`
    - Call `setMessages(prev => [...prev, userMessage])` immediately after construction
    - This must happen BEFORE the `await postChatMessage()` call
  - [x] 3.3 Remove post-success user message insertion in SA path
    - File: `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`
    - Remove the existing code that creates and appends `userMessage` after API success (lines ~938-944)
    - Keep only the assistant response message append after API success
    - Verify error handling still appends error as assistant message (do not modify)

**Acceptance Criteria:**
- SA path user message appears immediately on button click (before API resolves)
- Message uses `role: 'user'` and renders with "You" styling
- Message content matches `composeAnswersMessage()` output
- No duplicate user message after API success
- Error handling preserved (error appears as assistant message, user message stays)
- Message ordering correct: User message -> Assistant response

---

### Test Coverage

#### Task Group 4: Test Suite for Optimistic Message Behavior
**Dependencies:** Task Groups 2, 3

- [x] 4.0 Complete test coverage
  - [x] 4.1 Write tests for optimistic message insertion
    - File: `frontend/src/__tests__/optimisticUserMessage.test.tsx` (new file)
    - Test 1: Clicking "Answer Open Questions" adds a "You" message to transcript immediately (mock API to delay/not resolve)
    - Test 2: User message content matches `composeAnswersMessage()` output format
    - Test 3: User message has `role: 'user'` for proper styling
    - Test 4: Message appears before API call resolves (use delayed mock)
  - [x] 4.2 Write tests for message ordering
    - File: `frontend/src/__tests__/optimisticUserMessage.test.tsx`
    - Test 5: After API success, assistant response appears after user message (correct order)
    - Test 6: No duplicate user message after API success (only one user message in transcript)
  - [x] 4.3 Write tests for duplicate prevention
    - File: `frontend/src/__tests__/optimisticUserMessage.test.tsx`
    - Test 7: Double-click while submission in-flight does not create duplicate user message
    - Test 8: `isSubmittingAnswers` guard prevents re-entry into handleSubmitAnswers
  - [x] 4.4 Write tests for error handling
    - File: `frontend/src/__tests__/optimisticUserMessage.test.tsx`
    - Test 9: On API error, user message remains visible in transcript
    - Test 10: On API error, error is appended as assistant message after user message
  - [x] 4.5 Write tests for both paths (PO and SA)
    - File: `frontend/src/__tests__/optimisticUserMessage.test.tsx`
    - Test 11: PO path (non-implementation_clarification phase) shows optimistic message
    - Test 12: SA path (implementation_clarification phase with activeIncrementId) shows optimistic message
  - [x] 4.6 Run all optimistic message tests
    - Run ONLY the tests in `optimisticUserMessage.test.tsx`
    - Verify all 12 tests pass
    - Do NOT run the entire frontend test suite

**Acceptance Criteria:**
- All 12 tests written and passing
- Tests cover: immediate insertion, correct format, correct role, ordering, no duplicates, guard behavior, error handling, both paths
- Tests use appropriate mocking for API calls (delayed resolution, rejection scenarios)
- Test file follows existing test patterns in the codebase

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Foundation** - Understand patterns, add guard
   - Must be completed first to establish understanding and safety guard

2. **Task Group 2: PO Path** and **Task Group 3: SA Path** - Can be done in parallel
   - Both depend only on Task Group 1
   - Independent of each other
   - Recommended: Do PO path first as reference, then SA path

3. **Task Group 4: Test Coverage** - Final validation
   - Depends on Task Groups 2 and 3 being complete
   - Validates all behavior works correctly

## Files Modified

| File | Task Groups | Changes |
|------|-------------|---------|
| `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx` | 1, 2, 3 | Add guard, add optimistic messages, remove post-success duplicates |
| `frontend/src/__tests__/optimisticUserMessage.test.tsx` | 4 | New test file |

## Key Code References

- **handleSend pattern**: Lines 1451-1517 of ImplementationAssistantPanel.tsx
- **composeAnswersMessage**: Lines 403-407 of ImplementationAssistantPanel.tsx
- **generateMessageId**: Lines 389-391 of ImplementationAssistantPanel.tsx
- **isSubmittingAnswers state**: Lines 604-605 of ImplementationAssistantPanel.tsx
- **ChatMessage interface**: Lines 502-507 of chatApi.ts
- **PO post-success message**: Lines ~820-826 of ImplementationAssistantPanel.tsx
- **SA post-success message**: Lines ~938-944 of ImplementationAssistantPanel.tsx
- **PO error handling**: Lines 850-856 of ImplementationAssistantPanel.tsx
- **SA error handling**: Lines 1006-1012 of ImplementationAssistantPanel.tsx

## Out of Scope Reminders

- No backend/API changes
- No change to message formatting beyond reusing `composeAnswersMessage()`
- No retry workflow improvements beyond existing behavior
- No UI redesign of QuestionsTable or chat area
- No toast/banner error indicators
- No changes to submit button text or styling
- No changes to question status update logic
- No message removal or rollback on error
- No duplicate prevention across separate retries (only in-flight guard)
- No changes to `persistChatState` or persistence logic
