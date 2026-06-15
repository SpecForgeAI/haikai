# Spec: Implement Click Sends "Generate Implementation Plan" Message and Optimistic Chat Bubble

**Spec ID:** 2026-01-25-implement-click-sends-generate-plan-message-and-optimistic-chat-bubble
**Created:** 2026-01-25
**Status:** Draft
**Product Area:** Product & Delivery
**Screen:** Implement Feature
**Services:** Frontend (primary), Gateway (contract verification only)

---

## Problem Statement

When the user clicks the "Implement" button on the Implement Feature screen, the current implementation calls `generateImplementationPlan()` which sends an **empty message** to the `POST /api/chat` endpoint with `phase: 'implementation_planning'`. This creates two problems:

1. **No user message in Team Chat transcript**: The chat transcript shows no record of the user's intent to generate a plan. Users cannot see that they initiated this action, and the conversation flow appears disjointed (assistant messages appear without corresponding user input).

2. **Gateway validation concerns**: Sending an empty message to the chat endpoint may conflict with message validation rules or make debugging more difficult since there's no explicit user request in the transcript.

The expected behavior is that clicking "Implement" should:
1. Immediately display a "You" message bubble in Team Chat saying "Generate implementation plan"
2. Send this non-empty message to the Gateway so it appears in the conversation transcript

---

## Solution Overview

Modify the `generateImplementationPlan()` callback in `ImplementationAssistantPanel.tsx` to:

1. **Insert an optimistic user message** with content "Generate implementation plan" immediately when called (before the API request)
2. **Send the message "Generate implementation plan"** to `POST /api/chat` instead of an empty string
3. **Preserve existing behavior** for the 3-phase button enablement, warning modal, and in-flight state guards

This follows the established optimistic message pattern already used in `handleSend()` (lines 1498-1505) and `handleSubmitAnswers()` (lines 793-805) where user messages are appended to state immediately before the API call.

---

## Detailed Requirements

### 1. Message Text

**Requirement:** The message content must be exactly `"Generate implementation plan"` (case-sensitive, no trailing punctuation, no additional context like feature name).

**Rationale:** This matches the button's action semantically and provides a consistent transcript record. Keeping it simple avoids coupling to work item metadata.

### 2. Optimistic Bubble Behavior

**Requirement:** The user message bubble should appear immediately when `generateImplementationPlan()` is invoked, rendered as a normal "You" message with no special loading indicator or pending state styling.

**Details:**
- Message role: `'user'`
- Renders using existing `ChatMessageList` component
- Uses existing `generateMessageId()` function for unique ID
- Timestamp set to `new Date()` at insertion time
- No visual distinction from other user messages

### 3. Warning Modal Timing

**Requirement:** When the warning modal (`ImplementConfirmationModal`) is shown (Phase 2 - planner present with unanswered questions), the optimistic bubble and API call should only occur **after** the user confirms by clicking "Continue".

**Flow:**
1. User clicks "Implement" button
2. `handleImplementClick()` checks `openQuestionCount > 0`
3. Modal opens (`setIsConfirmModalOpen(true)`)
4. User clicks "Cancel" - modal closes, nothing happens
5. User clicks "Continue" - `handleModalConfirm()` is called
6. `handleModalConfirm()` calls `generateImplementationPlan()`
7. `generateImplementationPlan()` inserts optimistic bubble and sends API request

The optimistic bubble must NOT appear before user confirmation.

### 4. In-Flight Rejection / Duplicate Prevention

**Requirement:** If `generateImplementationPlan()` is called while already in-flight (`isImplementing === true`), silently return early without adding duplicate messages or API calls.

**Details:**
- The existing guard `if (isImplementing || !workItemId) return;` at line 1574 already handles this
- No additional user feedback required for rejected clicks
- This prevents race conditions from rapid double-clicks

### 5. API Payload

**Requirement:** The `POST /api/chat` request should use the same endpoint and payload structure as normal chat messages. The only change is replacing the empty string message with `"Generate implementation plan"`.

**Current code (line 1587):**
```typescript
message: '', // Empty message for plan generation
```

**New code:**
```typescript
message: 'Generate implementation plan',
```

**No changes required to:**
- Endpoint URL
- Context structure (`ImplementChatContext`)
- Phase (`'implementation_planning'`)
- Session ID handling
- Response processing

### 6. Error Handling

**Requirement:** Keep the existing error handling behavior. If the API call fails, display the error as an assistant message in the chat. The optimistic user message remains in the transcript.

**Existing behavior (lines 1621-1631):**
```typescript
catch (err) {
  const errorText = err instanceof Error ? err.message : 'Unknown error occurred';
  const errorMessage: ChatMessage = {
    id: generateMessageId(),
    role: 'assistant',
    content: `Failed to generate implementation plan: ${errorText}`,
    timestamp: new Date(),
  };
  setMessages((prev) => [...prev, errorMessage]);
  // ...
}
```

This behavior is preserved unchanged.

### 7. Explicit Exclusions

The following are explicitly **out of scope** for this spec:

- **No orchestration changes**: The orchestration API (`startOrchestration`, `executeOrchestration`) is not modified
- **No gateway functional changes**: Gateway routing, prompt construction, and response parsing remain unchanged
- **No planner response parsing changes**: How the planner response is processed remains unchanged
- **No planner response handling changes**: Do not touch any code that processes or renders planner responses
- **No chat infrastructure refactoring**: Keep changes narrowly focused to the implement-plan trigger message + optimistic insertion; do not refactor existing chat message handling patterns
- **No new error states or UX**: Existing error handling patterns are preserved

---

## Code Changes

### File: `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`

#### Change 1: Insert Optimistic User Message in `generateImplementationPlan()`

**Location:** Inside the `generateImplementationPlan` callback, after the guard clause and before the `try` block (around line 1577-1583).

**Before:**
```typescript
const generateImplementationPlan = useCallback(async () => {
  // Prevent duplicate submissions
  if (isImplementing || !workItemId) return;

  // Set implementing state to show loading indicator
  setIsImplementing(true);
  setError(null);
  setCurrentPhase('implementation_planning');

  // Build context with phase: 'implementation_planning'
  const context = buildContext('normal_chat', 'implementation_planning');

  try {
    const response = await postChatMessage({
      sessionId: sessionId || undefined,
      message: '', // Empty message for plan generation
      context,
    });
    // ...
```

**After:**
```typescript
const generateImplementationPlan = useCallback(async () => {
  // Prevent duplicate submissions
  if (isImplementing || !workItemId) return;

  // Set implementing state to show loading indicator
  setIsImplementing(true);
  setError(null);
  setCurrentPhase('implementation_planning');

  // Spec 2026-01-25: Insert optimistic user message immediately
  // This appears in Team Chat before the API call completes
  const userMessage: ChatMessage = {
    id: generateMessageId(),
    role: 'user',
    content: 'Generate implementation plan',
    timestamp: new Date(),
  };
  setMessages((prev) => [...prev, userMessage]);

  // Build context with phase: 'implementation_planning'
  const context = buildContext('normal_chat', 'implementation_planning');

  try {
    const response = await postChatMessage({
      sessionId: sessionId || undefined,
      message: 'Generate implementation plan', // Spec 2026-01-25: Non-empty message
      context,
    });
    // ...
```

#### Change 2: Update Comment in File Header

**Location:** Add to the changelog comments at the top of the file (around line 175-189).

**Add:**
```typescript
 * Spec 2026-01-25: Implement Click Sends "Generate implementation plan" Message
 * Task Group 1: Optimistic User Message
 * - generateImplementationPlan() now inserts optimistic user message immediately
 * - Message content: "Generate implementation plan"
 * - Message sent to API (replaces empty string)
 * - Follows same pattern as handleSend() and handleSubmitAnswers()
```

---

## Test Requirements

### Test File: `frontend/src/__tests__/implementClickOptimisticMessage.test.tsx`

#### Test 1: Optimistic bubble appears immediately on Implement click

```typescript
describe('Spec 2026-01-25: Implement Click Optimistic Message', () => {
  it('appends a user chat bubble with "Generate implementation plan" immediately on click', () => {
    // Setup: Mock generateImplementationPlan to capture the message insertion
    // Arrange: Render component with valid planner definition (Phase 3 - no unanswered questions)
    // Act: Click Implement button
    // Assert: messages array contains a user message with content "Generate implementation plan"
    // Assert: Message has role: 'user'
  });
});
```

#### Test 2: API request contains the correct message

```typescript
it('sends /api/chat request with message === "Generate implementation plan"', async () => {
  // Setup: Mock postChatMessage
  // Arrange: Component in Phase 3 state
  // Act: Click Implement button
  // Assert: postChatMessage was called with { message: 'Generate implementation plan', ... }
});
```

#### Test 3: Confirm flow produces exactly one optimistic bubble

```typescript
describe('Warning modal confirm flow', () => {
  it('produces exactly one optimistic bubble and one API request after user confirms', async () => {
    // Setup: Component in Phase 2 (planner present + unanswered questions)
    // Act: Click Implement -> Modal appears
    // Act: Click "Continue" on modal
    // Assert: Exactly one user message with "Generate implementation plan" in messages
    // Assert: postChatMessage called exactly once
  });

  it('does not add optimistic bubble if user cancels the modal', async () => {
    // Setup: Component in Phase 2
    // Act: Click Implement -> Modal appears
    // Act: Click "Cancel" on modal
    // Assert: No user message with "Generate implementation plan" was added
    // Assert: postChatMessage was not called
  });
});
```

#### Test 4: In-flight state prevents duplicates

```typescript
describe('Duplicate prevention', () => {
  it('does not add duplicate messages when isImplementing is true', () => {
    // Setup: Component with isImplementing = true (simulate in-flight)
    // Act: Attempt to call generateImplementationPlan (or click button if it were enabled)
    // Assert: No new messages added
    // Assert: No additional API calls
  });
});
```

---

## Implementation Notes

### Pattern Reference

The optimistic message insertion follows the exact pattern used in:

1. **`handleSend()` (lines 1498-1505):**
   ```typescript
   const userMessage: ChatMessage = {
     id: generateMessageId(),
     role: 'user',
     content: message,
     timestamp: new Date(),
   };
   setMessages((prev) => [...prev, userMessage]);
   ```

2. **`handleSubmitAnswers()` PO path (lines 793-805):**
   ```typescript
   const userMessage: ChatMessage = {
     id: generateMessageId(),
     role: 'user',
     content: userMessageContent,
     timestamp: new Date(),
   };
   setMessages(prev => [...prev, userMessage]);
   ```

### Existing Code to Reference

| Component | Path | Relevance |
|-----------|------|-----------|
| `generateImplementationPlan` callback | `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx` (lines 1572-1636) | Primary modification target |
| `handleImplementClick` callback | Same file (lines 1646-1661) | Entry point, shows modal or calls generateImplementationPlan |
| `handleModalConfirm` callback | Same file (lines 1675-1679) | Calls generateImplementationPlan after user confirms |
| `handleSend` callback | Same file (lines 1494-1560) | Reference for optimistic message pattern |
| `handleSubmitAnswers` callback | Same file (lines 771-1059) | Reference for optimistic message pattern |
| `ImplementConfirmationModal` | `frontend/src/components/ProductView/ImplementConfirmationModal.tsx` | Modal component (no changes needed) |
| `postChatMessage` | `frontend/src/api/chatApi.ts` | API function (no changes needed) |
| `ChatMessage` type | `frontend/src/api/chatApi.ts` | Message structure (no changes needed) |
| `generateMessageId` | `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx` (lines 404-406) | ID generation utility |

### Gateway Contract Verification

No gateway changes are required. The existing `POST /api/chat` endpoint already accepts non-empty messages. The change from empty string to `"Generate implementation plan"` is backwards-compatible.

Verify by inspection:
- `gateway/src/routes/chat.ts` - handles message field
- `gateway/src/services/plannerResponseValidator.ts` - validates responses, not requests

---

## Acceptance Criteria

1. [ ] Clicking "Implement" (when enabled, Phase 3) immediately shows a "You" message bubble with text "Generate implementation plan"
2. [ ] The `POST /api/chat` request body contains `message: "Generate implementation plan"` instead of empty string
3. [ ] Warning modal flow: bubble only appears after user clicks "Continue", not before
4. [ ] Warning modal flow: clicking "Cancel" does not produce any bubble or API call
5. [ ] Rapid clicks while in-flight (`isImplementing === true`) do not produce duplicate bubbles or requests
6. [ ] Error responses still appear as assistant messages (existing behavior preserved)
7. [ ] All existing tests continue to pass
8. [ ] New tests cover the four scenarios described above

---

## Task Groups

### Task Group 1: Optimistic User Message in generateImplementationPlan

**Files:**
- `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`

**Changes:**
1. Add optimistic user message insertion after guard clause in `generateImplementationPlan()`
2. Change `message: ''` to `message: 'Generate implementation plan'` in postChatMessage call
3. Add spec documentation comment to file header

**Estimated effort:** XS (< 1 hour)

### Task Group 2: Unit Tests

**Files:**
- `frontend/src/__tests__/implementClickOptimisticMessage.test.tsx` (new file)

**Tests:**
1. Optimistic bubble appears immediately on Implement click
2. API request contains correct message
3. Confirm flow produces exactly one bubble after Continue
4. Cancel flow produces no bubble
5. In-flight state prevents duplicates

**Estimated effort:** S (2-3 hours)

---

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Duplicate messages if guard fails | Low | Medium | Existing `isImplementing` guard already prevents this |
| Message appears in wrong order | Low | Low | React state batching ensures synchronous updates |
| Tests break due to new message | Medium | Low | Tests may need adjustment to expect the new user message |

---

## Dependencies

- None. This is a self-contained frontend change.

---

## Rollback Plan

If issues arise, revert the changes to `generateImplementationPlan()`:
1. Remove the optimistic message insertion code
2. Restore `message: ''` in the postChatMessage call

The feature is non-destructive and can be safely reverted without data migration.
