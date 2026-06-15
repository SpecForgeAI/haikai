# Task Breakdown: RM Increment 6 -- Wire Confirmation, Save Roadmap + Success Message

## Overview
Total Tasks: 4 Task Groups, 27 sub-tasks

This spec completes the Roadmap PM end-to-end save flow. When a user confirms after `phase="ready"`, the gateway detects confirmation, extracts `proposedInitiatives` from conversation history, invokes `save_roadmap_structure` via the MCP tool, and returns a success message with a clickable link to the Roadmap tab. The frontend replaces the placeholder ready banner with a "Save Roadmap" button and renders the success link. No LLM generation call is needed -- the structured data already exists in conversation history.

## Task List

### Gateway Layer

#### Task Group 1: Confirmation Detection + Constants
**Dependencies:** None

- [x] 1.0 Complete roadmap confirmation detection and message constants
  - [x] 1.1 Write 4-6 focused tests for `isRoadmapConfirmation` and constants
    - **File:** `gateway/src/__tests__/isRoadmapConfirmation.test.ts`
    - Test `isRoadmapConfirmation` returns `true` when most recent assistant message is valid JSON with `phase === "ready"` and user message is "save"
    - Test `isRoadmapConfirmation` returns `true` for other confirmation words: "yes", "y", "ok", "okay", "proceed", "go ahead", "confirm" (case-insensitive, optional trailing punctuation)
    - Test `isRoadmapConfirmation` returns `false` when most recent assistant message has `phase !== "ready"` (e.g., `phase === "refining"`)
    - Test `isRoadmapConfirmation` returns `false` when user message is a full sentence containing a confirmation word (e.g., "Can you confirm this looks right?") -- regex anchors reject non-standalone matches
    - Test `isRoadmapConfirmation` returns `false` when most recent assistant message is not valid JSON
    - Test `isRoadmapConfirmation` returns `false` when `messages` array has no assistant messages
    - Mock `messages` array following the OpenAI message format (system, user, assistant entries)
  - [x] 1.2 Add `ROADMAP_CONFIRMATION_REGEX` constant
    - **File:** `gateway/src/routes/chat.ts`
    - Value: `/^\s*(yes|y|ok|okay|proceed|go ahead|confirm|save)\s*[.!]?\s*$/i`
    - Place near existing `BASELINE_CONFIRMATION_REGEX` (line 166) for consistency
    - Note: adds "save", removes "generate" compared to `BASELINE_CONFIRMATION_REGEX`
  - [x] 1.3 Add `RM_SAVE_SUCCESS_MESSAGE` and `RM_SAVE_FAILURE_MESSAGE` constants
    - **File:** `gateway/src/routes/chat.ts`
    - `RM_SAVE_SUCCESS_MESSAGE = 'Roadmap saved. You can review it here.'`
    - `RM_SAVE_FAILURE_MESSAGE = 'Roadmap save failed. Please review and try again.'`
    - Place near existing `SA_BASELINE_SUCCESS_MESSAGE` / `SA_BASELINE_FAILURE_MESSAGE` (lines 182-189) for consistency
  - [x] 1.4 Implement `isRoadmapConfirmation` function
    - **File:** `gateway/src/routes/chat.ts`
    - Export function: `export function isRoadmapConfirmation(messages: OpenAIMessage[], userMessage: string): boolean`
    - Clone structure from `isBaselineConfirmation()` (lines 322-350): reverse-iterate `messages` to find most recent assistant message, parse as JSON, check `phase === "ready"`, break at first assistant message
    - Test `userMessage` against `ROADMAP_CONFIRMATION_REGEX`
    - Place adjacent to `isBaselineConfirmation()` for discoverability
  - [x] 1.5 Ensure confirmation detection tests pass
    - Run ONLY the tests written in 1.1
    - Verify regex matching, phase detection, and edge cases
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- `ROADMAP_CONFIRMATION_REGEX` matches "yes", "y", "ok", "okay", "proceed", "go ahead", "confirm", "save" (case-insensitive, optional trailing punctuation)
- `isRoadmapConfirmation` correctly requires both conditions: `phase === "ready"` in most recent assistant message AND user message matches regex
- `RM_SAVE_SUCCESS_MESSAGE` and `RM_SAVE_FAILURE_MESSAGE` are defined with exact text from spec
- The 4-6 tests written in 1.1 all pass

---

#### Task Group 2: Gateway Save Branch (Short-Circuit + Transcript Persistence)
**Dependencies:** Task Group 1

- [x] 2.0 Complete the dedicated save branch in the chat route handler
  - [x] 2.1 Write 5-7 focused tests for the save branch behavior
    - **File:** `gateway/src/__tests__/rm-increment-6-save-branch.test.ts`
    - Test: when `isRoadmapConfirmation` returns true for a `roadmap_pm` context, the route returns `RM_SAVE_SUCCESS_MESSAGE` without calling `sendChatRequest` (mock `sendChatRequest` and verify it is NOT called)
    - Test: `proposedInitiatives` is extracted from the most recent assistant message's JSON and passed as `roadmapJson` to `executeTool` in the shape `{ initiatives: proposedInitiatives }`
    - Test: `executeTool` is called with tool name `'save_roadmap_structure'`, correct `projectId` from `context.filename`, and the serialized `roadmapJson`
    - Test: when `executeTool` returns `status: 200`, response message is `RM_SAVE_SUCCESS_MESSAGE`
    - Test: when `executeTool` returns non-200 status, response message is `RM_SAVE_FAILURE_MESSAGE`
    - Test: when an unexpected error is thrown during the save branch, response message is `RM_SAVE_FAILURE_MESSAGE` (catch-all handler)
    - Test: `externalRef` fields present on initiative/epic objects in the raw JSON are preserved through to `roadmapJson` (not stripped or auto-populated)
    - Mock: `executeTool`, `persistConversation`, `appendTranscriptEntry`, `flushTranscriptToDisk`, `updateSession`, `sendChatRequest`
  - [x] 2.2 Implement save branch call site in the chat route handler
    - **File:** `gateway/src/routes/chat.ts`
    - Place AFTER `buildMessagesForTurn()` (line 1057) but BEFORE `sendChatRequest()`
    - Gate with: `shouldValidateRoadmapPmResponse(context) && isRoadmapConfirmation(messages, message)`
    - Follow the structural pattern of the SA save branch (lines 1060-1282) but significantly simpler: no LLM generation, no JSON validation/corrective retry, no `ensureMinimumServices`
  - [x] 2.3 Implement proposedInitiatives extraction from conversation history
    - **File:** `gateway/src/routes/chat.ts` (within the save branch)
    - Reverse-iterate `messages` to find the most recent assistant message
    - Parse as JSON and read the `proposedInitiatives` field
    - Build `roadmapJson = JSON.stringify({ initiatives: proposedInitiatives })`
    - Preserve any `externalRef` fields already present on initiative/epic objects (do not strip or auto-populate)
  - [x] 2.4 Implement `executeTool` invocation and success/failure response
    - **File:** `gateway/src/routes/chat.ts` (within the save branch)
    - Call: `executeTool('save_roadmap_structure', { projectId: context.filename, roadmapJson }, session.mcpSessionId, requestId, effectiveSessionId)`
    - If `toolResult.status === 200`: respond with `{ sessionId: effectiveSessionId, assistant: { message: RM_SAVE_SUCCESS_MESSAGE } }`
    - Otherwise: log failure details server-side, respond with `{ sessionId: effectiveSessionId, assistant: { message: RM_SAVE_FAILURE_MESSAGE } }`
  - [x] 2.5 Implement transcript persistence for save branch
    - **File:** `gateway/src/routes/chat.ts` (within the save branch)
    - Follow SA save branch persistence pattern exactly (lines 1208-1226)
    - Build `messagesForPersistence`: `[messages[0], { role: 'user', content: message }, { role: 'assistant', content: chatResponse.assistant.message }]`
    - Exclude: `roadmapJson`, tool arguments, tool results, any intermediate data
    - Call `persistConversation(effectiveSessionId, messagesForPersistence)`
    - Call `appendTranscriptEntry` for USER and ASSISTANT (gated by `shouldAppendToTranscript(context)`)
    - Call `flushTranscriptToDisk(effectiveSessionId, context, requestId)`
    - Call `updateSession(effectiveSessionId, { filename: context?.filename || session.filename })`
  - [x] 2.6 Implement catch-all error handler and logging
    - **File:** `gateway/src/routes/chat.ts` (within the save branch)
    - Wrap entire branch in try/catch (following SA pattern, lines 1243-1281)
    - On unexpected error: log full error detail server-side, return `RM_SAVE_FAILURE_MESSAGE`, persist failure message to transcript
    - Log confirmation detection event with `requestId` and `sessionId`
    - Log tool invocation result (status, durationMs)
    - Log save branch completion (success/failure, durationMs)
  - [x] 2.7 Ensure save branch tests pass
    - Run ONLY the tests written in 2.1
    - Verify short-circuit behavior, tool invocation, success/failure responses, and transcript persistence
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- Save branch short-circuits normal chat flow: no `sendChatRequest` call is made
- `proposedInitiatives` is correctly extracted from conversation history and serialized as `roadmapJson`
- `externalRef` fields are preserved as-is from raw JSON
- `executeTool` is called with `'save_roadmap_structure'`, correct `projectId`, and serialized `roadmapJson`
- Success returns `RM_SAVE_SUCCESS_MESSAGE`; failure returns `RM_SAVE_FAILURE_MESSAGE`
- Transcript persists only system message, user confirmation, and assistant response
- Catch-all error handler returns `RM_SAVE_FAILURE_MESSAGE` and logs full error server-side
- The 5-7 tests written in 2.1 all pass

---

### Frontend Layer

#### Task Group 3: Save Button, Clickable Success Link, and CSS
**Dependencies:** Task Group 2 (gateway save branch must exist for end-to-end flow)

- [x] 3.0 Complete frontend Save Roadmap button and success link rendering
  - [x] 3.1 Write 4-6 focused tests for frontend components
    - **File:** `frontend/src/__tests__/rmIncrement6-frontend.test.ts`
    - Test: "Save Roadmap" button renders inside the `phase="ready"` block with `data-testid="rm-chat-save-roadmap"`
    - Test: clicking "Save Roadmap" button triggers a message send (verify `postChatMessage` is called with a confirmation word)
    - Test: "Save Roadmap" button is disabled when `loading` is true
    - Test: assistant message containing `RM_SUCCESS_LINK_MARKER` renders a clickable element with `data-testid="rm-roadmap-link"`
    - Test: clicking the roadmap link navigates to `?tab=roadmap` (verify URL or navigation callback)
    - Test: assistant message NOT containing the marker renders as plain text (no link element)
  - [x] 3.2 Define `RM_SUCCESS_LINK_MARKER` constant
    - **File:** `frontend/src/components/ProductView/RoadmapPmChatPanel.tsx`
    - Value: `'can review it here'` (substring of `RM_SAVE_SUCCESS_MESSAGE`)
    - Follow pattern of `SUCCESS_LINK_MARKER` at `SolutionArchitectChatPanel.tsx` line 52
  - [x] 3.3 Create `renderMessageContent` function for clickable "here" link
    - **File:** `frontend/src/components/ProductView/RoadmapPmChatPanel.tsx`
    - Follow the SA `renderMessageContent` pattern (lines 126-163 of `SolutionArchitectChatPanel.tsx`)
    - Detect `RM_SUCCESS_LINK_MARKER` in assistant messages
    - Split message around the last occurrence of "here"
    - Render "here" as a clickable `<span>` with: `role="link"`, `tabIndex={0}`, keyboard handler for Enter/Space, `data-testid="rm-roadmap-link"`
    - Navigation target: current pathname with `?tab=roadmap` query parameter (consistent with `ProductView.tsx` updateUrl pattern)
    - Non-matching messages render as plain text
  - [x] 3.4 Replace ready banner placeholder with "Save Roadmap" button
    - **File:** `frontend/src/components/ProductView/RoadmapPmChatPanel.tsx` (lines 449-453)
    - Replace the static text "Roadmap planning is complete. Save functionality coming in a future increment." with a "Save Roadmap" button
    - Button click sends a confirmation word (e.g., "save") through the existing `handleSend` mechanism: set `inputDraft` to "save" then call `handleSend`, or use a dedicated handler that calls `postChatMessage` directly
    - Button disabled while `loading` is true to prevent double-click
    - `data-testid="rm-chat-save-roadmap"`
    - Retain the `.readyBanner` container div around the button
  - [x] 3.5 Wire `renderMessageContent` into message rendering
    - **File:** `frontend/src/components/ProductView/RoadmapPmChatPanel.tsx`
    - Replace plain text `msg.content` rendering for assistant messages with `renderMessageContent(msg, navigateToRoadmap)` (or equivalent)
    - Ensure navigation callback uses `window.history.pushState` or React Router to navigate to `?tab=roadmap`
  - [x] 3.6 Add CSS styles for save button and roadmap link
    - **File:** `frontend/src/components/ProductView/RoadmapPmChatPanel.module.css`
    - Add `.saveButton` class: primary blue (`#1976D2`), white text, padding, border-radius, cursor pointer, matching `.sendButton` pattern but placed within the ready banner area
    - Add `.saveButton:hover` with darker shade
    - Add `.saveButton:disabled` with reduced opacity and default cursor
    - Add `.roadmapLink` class: `color: #0066cc`, `text-decoration: underline`, `cursor: pointer` (following `.architectureLink` pattern at `SolutionArchitectChatPanel.module.css` lines 262-270)
    - Add `.roadmapLink:hover` with darker shade (`#004999`)
  - [x] 3.7 Ensure frontend tests pass
    - Run ONLY the tests written in 3.1
    - Verify button rendering, click behavior, loading state, and link rendering
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- "Save Roadmap" button renders inside the `phase="ready"` block and triggers confirmation send on click
- Button is disabled during loading state
- Typed confirmation words ("yes", "y", "ok", "save", "confirm", etc.) still work alongside the button
- Assistant messages containing `RM_SUCCESS_LINK_MARKER` render "here" as a clickable link navigating to `?tab=roadmap`
- Non-success messages render as plain text
- CSS follows existing design system patterns
- The 4-6 tests written in 3.1 all pass

---

### Testing

#### Task Group 4: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-3

- [x] 4.0 Review existing tests and fill critical gaps only
  - [x] 4.1 Review tests from Task Groups 1-3
    - Review the 4-6 confirmation detection tests from Task 1.1
    - Review the 5-7 save branch tests from Task 2.1
    - Review the 4-6 frontend tests from Task 3.1
    - Total existing tests: approximately 13-19 tests
  - [x] 4.2 Analyze test coverage gaps for this feature only
    - Identify critical end-to-end workflows that lack coverage
    - Focus ONLY on gaps related to the RM Increment 6 save flow
    - Prioritize integration points: confirmation detection flowing into save branch, `proposedInitiatives` extraction accuracy, transcript persistence correctness
    - Do NOT assess entire application test coverage
  - [x] 4.3 Write up to 10 additional strategic tests maximum
    - **File:** `gateway/src/__tests__/rm-increment-6-gap-fill.test.ts` and/or `frontend/src/__tests__/rmIncrement6-gap-tests.test.ts`
    - Potential gap-fill tests (select based on actual gap analysis):
      - End-to-end: confirmation word "save" with `phase="ready"` triggers save branch and returns success message (integration of TG1 + TG2)
      - `proposedInitiatives` extraction handles missing or null `proposedInitiatives` field gracefully (falls through to failure)
      - `proposedInitiatives` with nested `externalRef` objects are preserved verbatim in `roadmapJson`
      - Save branch does NOT trigger when `context.mode` is not `roadmap_pm` (e.g., `solution_architect` mode with phase="ready" does not enter RM save branch)
      - Transcript persistence excludes `roadmapJson` and tool arguments (verify `messagesForPersistence` structure)
      - "Save Roadmap" button and typed "save" produce identical server-side behavior
      - Success link renders correctly and navigates to `?tab=roadmap`
      - Failure message does NOT contain any MCP tool error details (only the static message)
      - `ROADMAP_CONFIRMATION_REGEX` rejects "generate" (which is in the SA regex but NOT in the RM regex)
      - Multiple rapid clicks on "Save Roadmap" button while loading: verify only one request is sent (button disabled state)
  - [x] 4.4 Run feature-specific tests only
    - Run ALL test files related to this feature:
      - `gateway/src/__tests__/isRoadmapConfirmation.test.ts`
      - `gateway/src/__tests__/rm-increment-6-save-branch.test.ts`
      - `frontend/src/__tests__/rmIncrement6-frontend.test.ts`
      - `gateway/src/__tests__/rm-increment-6-gap-fill.test.ts`
      - `frontend/src/__tests__/rmIncrement6-gap-tests.test.ts` (if created)
    - Expected total: approximately 23-29 tests
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 23-29 tests total)
- Critical end-to-end flow is covered: confirmation detection -> save branch -> tool invocation -> success/failure response
- `proposedInitiatives` extraction and `externalRef` preservation are verified
- Transcript persistence correctness is verified (only system + user + assistant messages)
- No more than 10 additional tests added in gap analysis
- Testing focused exclusively on RM Increment 6 feature requirements

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Confirmation Detection + Constants** -- Must come first; the save branch depends on `isRoadmapConfirmation`, `ROADMAP_CONFIRMATION_REGEX`, and the message constants
2. **Task Group 2: Gateway Save Branch** -- Depends on confirmation detection from TG1; this is the core server-side logic
3. **Task Group 3: Frontend Save Button + Success Link** -- Depends on TG2 for end-to-end flow; the button triggers the gateway save branch and the success link renders the response
4. **Task Group 4: Test Review and Gap Analysis** -- Depends on all prior groups being complete

Note: Task Group 3 frontend tasks have no compile-time dependency on TG1/TG2 and could technically be implemented in parallel. However, they are sequenced after TG2 because the button and link behavior is meaningless without the gateway save branch, and end-to-end verification requires TG2 to be complete.

## Files Created or Modified

### New Files
| File | Task | Purpose |
|------|------|---------|
| `gateway/src/__tests__/isRoadmapConfirmation.test.ts` | 1.1 | Tests for confirmation detection function and regex |
| `gateway/src/__tests__/rm-increment-6-save-branch.test.ts` | 2.1 | Tests for gateway save branch behavior |
| `frontend/src/__tests__/rmIncrement6-frontend.test.ts` | 3.1 | Tests for Save Roadmap button and success link |
| `gateway/src/__tests__/rm-increment-6-gap-fill.test.ts` | 4.3 | Gap-fill tests for integration and edge cases |
| `frontend/src/__tests__/rmIncrement6-gap-tests.test.ts` | 4.3 | Gap-fill tests for frontend edge cases (if needed) |

### Modified Files
| File | Task | Change |
|------|------|--------|
| `gateway/src/routes/chat.ts` | 1.2, 1.3, 1.4, 2.2-2.6 | Add `ROADMAP_CONFIRMATION_REGEX`, `RM_SAVE_SUCCESS_MESSAGE`, `RM_SAVE_FAILURE_MESSAGE`, `isRoadmapConfirmation()`, and the dedicated save branch |
| `frontend/src/components/ProductView/RoadmapPmChatPanel.tsx` | 3.2, 3.3, 3.4, 3.5 | Add `RM_SUCCESS_LINK_MARKER`, `renderMessageContent()`, replace ready banner with Save Roadmap button, wire link rendering |
| `frontend/src/components/ProductView/RoadmapPmChatPanel.module.css` | 3.6 | Add `.saveButton`, `.saveButton:hover`, `.saveButton:disabled`, `.roadmapLink`, `.roadmapLink:hover` classes |
