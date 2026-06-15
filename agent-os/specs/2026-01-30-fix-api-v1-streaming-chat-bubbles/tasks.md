# Task Breakdown: Fix /api/v1 Streaming Chat Bubbles

## Overview
Total Tasks: 14
Single File: `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`

This is a **BUG FIX** spec with two core changes:
- **A) Force persona stamping** on all /api/v1 sourced messages
- **B) Split streaming into multiple bubbles** (one per delta, not accumulating)

---

## Task List

### Part A: Persona Stamping

#### Task Group 1: Force Persona on /api/v1 Messages
**Dependencies:** None

- [x] 1.0 Complete persona stamping for all /api/v1 message creation points
  - [x] 1.1 Write 3-4 focused tests for persona stamping
    - Test that `startShapeSpecStreamCallback` onContent creates messages with `persona: 'Software Architect'`
    - Test that `handleAnswerStreamedQuestions` onContent creates messages with `persona: 'Software Architect'`
    - Test that `triggerOrchestration` success/error messages have `persona: 'Software Architect'`
    - Test that user messages (composed Q/A) do NOT have persona field set
  - [x] 1.2 Update `startShapeSpecStreamCallback` onContent handler
    - Currently creates message without persona (line 1494-1499 initialMessage, line 1527-1533 setMessages map)
    - Add `persona: 'Software Architect'` to every ChatMessage created in onContent
    - Ensure persona field is preserved when mapping messages in setMessages
  - [x] 1.3 Update `handleAnswerStreamedQuestions` onContent handler
    - Currently creates message without persona (line 1345-1350 initialMessage, line 1379-1385 setMessages map)
    - Add `persona: 'Software Architect'` to every ChatMessage created in onContent
    - Ensure user message (composed Q/A at line 1361-1366) does NOT have persona (user messages never have persona)
  - [x] 1.4 Update `triggerOrchestration` success and error messages
    - Line 1216-1222: Missing folder error message - add `persona: 'Software Architect'`
    - Line 1258-1263: Success message ("Okay, I'll start implementing...") - add `persona: 'Software Architect'`
    - Line 1266-1273: Failure response message - add `persona: 'Software Architect'`
    - Line 1278-1284: Catch error message - add `persona: 'Software Architect'`
  - [x] 1.5 Run persona stamping tests
    - Run ONLY the 3-4 tests written in 1.1
    - Verify all /api/v1 messages have persona stamped at creation time
    - Verify user messages do NOT have persona

**Acceptance Criteria:**
- All ChatMessages created in /api/v1 streaming flows have `persona: 'Software Architect'`
- User messages in Q&A flows do NOT have persona field
- Persona is stamped at message creation time (not post-stream mutation)
- Tests from 1.1 pass

---

### Part B: Split Streaming Into Multiple Bubbles

#### Task Group 2: Streaming Refactor - New Message Per Delta
**Dependencies:** Task Group 1

- [x] 2.0 Complete streaming refactor to create new message per delta
  - [x] 2.1 Write 4-5 focused tests for multi-bubble streaming behavior
    - Test that each non-empty content delta creates a NEW ChatMessage
    - Test that empty/whitespace-only deltas are skipped (no message created)
    - Test that `streamingMessageId` and `streamedContentRef` state/refs are removed
    - Test that onDone handlers complete without referencing removed accumulator state
    - Test that onError handlers complete without referencing removed accumulator state
  - [x] 2.2 Update `startShapeSpecStreamCallback` onContent to create new message per delta
    - Remove accumulation pattern: `streamedContentRef.current += delta` (line 1524)
    - Remove message update pattern: `setMessages.map(msg => msg.id === messageId ? ...)` (line 1527-1533)
    - Instead: create NEW ChatMessage for each delta with:
      - `id: generateMessageId()` (unique per delta)
      - `role: 'assistant'`
      - `persona: 'Software Architect'` (from Task Group 1)
      - `content: delta` (just the delta, not accumulated)
      - `timestamp: new Date()`
    - Skip creating message if delta is empty or whitespace-only: `if (!delta || !delta.trim()) return`
  - [x] 2.3 Update `handleAnswerStreamedQuestions` onContent to create new message per delta
    - Same changes as 2.2 but in handleAnswerStreamedQuestions (line 1377-1385)
    - Remove accumulation pattern
    - Create NEW ChatMessage per delta with persona stamped
    - Skip empty/whitespace-only deltas
  - [x] 2.4 Remove accumulator state and refs
    - Remove `streamingMessageId` state variable (line 418)
    - Remove `streamedContentRef` ref (line 419)
    - Remove `setStreamingMessageId(messageId)` calls in startShapeSpecStreamCallback (line 1503) and handleAnswerStreamedQuestions (line 1354)
    - Remove `streamedContentRef.current = ''` initialization calls
    - Remove initial empty message creation pattern (lines 1494-1499 in startShapeSpecStreamCallback, lines 1345-1350 in handleAnswerStreamedQuestions)
    - Remove the `setMessages((prev) => [...prev, initialMessage])` that adds the empty initial message
  - [x] 2.5 Update onDone handlers to not reference accumulator state
    - `startShapeSpecStreamCallback` onDone (line 1540-1567): Remove `setStreamingMessageId(null)` (line 1550)
    - `handleAnswerStreamedQuestions` onDone (line 1389-1414): Remove `setStreamingMessageId(null)` (line 1399)
    - Keep other state updates (setIsStreaming, receivedQuestionsInTurn, streamedQuestions, etc.)
  - [x] 2.6 Update onError handlers to not reference accumulator state
    - `startShapeSpecStreamCallback` onError (line 1570-1583):
      - Remove `setStreamingMessageId(null)` (line 1581)
      - Remove `streamedContentRef.current = ''` (line 1582)
      - Remove message update pattern that references messageId
      - Instead: create a new error message with `persona: 'Software Architect'`
    - `handleAnswerStreamedQuestions` onError (line 1417-1428):
      - Remove `setStreamingMessageId(null)` (line 1426)
      - Remove `streamedContentRef.current = ''` (line 1427)
      - Remove message update pattern that references messageId
      - Instead: create a new error message with `persona: 'Software Architect'`
  - [x] 2.7 Update workItemId change reset logic
    - Remove references to `setStreamingMessageId(null)` in reset blocks (lines 602, 658)
    - Remove references to `streamedContentRef.current = ''` in reset blocks (lines 603, 659)
  - [x] 2.8 Run streaming refactor tests
    - Run ONLY the 4-5 tests written in 2.1
    - Verify each delta creates a new bubble
    - Verify empty deltas are skipped
    - Verify accumulator state is fully removed

**Acceptance Criteria:**
- Each `{type:"content", delta}` SSE event creates a NEW ChatMessage
- Empty/whitespace-only deltas do not create messages
- `streamingMessageId` state and `streamedContentRef` ref are completely removed
- onDone/onError handlers work correctly without accumulator references
- Tests from 2.1 pass

---

### Part C: Integration Testing

#### Task Group 3: Integration Test Review and Gap Analysis
**Dependencies:** Task Groups 1-2

- [x] 3.0 Review existing tests and verify end-to-end behavior
  - [x] 3.1 Review tests from Task Groups 1 and 2
    - Review the 3-4 tests from persona stamping (Task 1.1)
    - Review the 4-5 tests from streaming refactor (Task 2.1)
    - Total existing tests: approximately 7-9 tests
  - [x] 3.2 Analyze integration gaps for this bug fix only
    - Identify any critical user workflows that lack coverage
    - Focus ONLY on the two bug fixes in this spec (persona + multi-bubble)
    - Do NOT assess entire application test coverage
  - [x] 3.3 Write up to 3 additional integration tests if needed
    - Test complete flow: Implement button click -> stream starts -> multiple bubbles appear with persona
    - Test Q&A continuation flow: Answer questions -> stream continues -> new bubbles with persona
    - Test error scenarios preserve persona on error messages
  - [x] 3.4 Run all feature-specific tests
    - Run ONLY tests related to this bug fix (tests from 1.1, 2.1, and 3.3)
    - Expected total: approximately 10-12 tests maximum
    - Do NOT run the entire application test suite
    - Verify all tests pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 10-12 tests total)
- Critical user workflows for streaming chat bubbles are covered
- No more than 3 additional tests added for integration gaps
- Bug fix behaves correctly in integration scenarios

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Persona Stamping** - Add persona field to all /api/v1 message creation points
2. **Task Group 2: Streaming Refactor** - Change from accumulating to multi-bubble pattern
3. **Task Group 3: Integration Testing** - Verify end-to-end behavior

**Rationale:**
- Persona stamping is a simpler, lower-risk change that can be done first
- Streaming refactor depends on understanding where messages are created (informed by Task Group 1)
- Integration testing validates both changes work together correctly

---

## File Reference

**Single file to modify:** `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`

**Key locations:**
- Lines 418-419: `streamingMessageId` state and `streamedContentRef` ref (to remove)
- Lines 1207-1287: `triggerOrchestration` function (persona stamping)
- Lines 1318-1434: `handleAnswerStreamedQuestions` function (persona stamping + multi-bubble)
- Lines 1461-1590: `startShapeSpecStreamCallback` function (persona stamping + multi-bubble)
- Lines 584-672: workItemId change reset logic (cleanup accumulator references)

**Existing helpers to leverage:**
- Line 274-276: `generateMessageId()` - reuse for each new delta message
- ChatMessage interface already has optional `persona?: ChatMessagePersona` field
- ChatMessageList already checks `message.persona` first before phase fallback
