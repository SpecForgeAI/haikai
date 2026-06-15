# Task Breakdown: Chat UX and Gateway Session Ownership

## Overview
Total Tasks: 23 (across 4 task groups)

This specification covers two independent work streams that can be implemented in parallel:
1. **Frontend**: Chat panel layout improvements with resizable input area
2. **Gateway**: Make sessionId optional and generate server-side when missing

## Task List

### Frontend Layer

#### Task Group 1: Chat Panel Layout and Vertical Resize
**Dependencies:** None
**Parallel with:** Task Group 2 (Gateway)

- [x] 1.0 Complete chat panel vertical layout and resize functionality
  - [x] 1.1 Write 4-6 focused tests for chat panel layout and resize behavior
    - Test that ChatPanel renders with correct flex layout structure
    - Test that drag handle appears between message list and input area
    - Test that inputHeight state updates during vertical resize drag
    - Test that ChatInput receives and applies height prop correctly
    - Test that textarea uses height: 100% and overflow: auto (no native resize)
    - Skip exhaustive edge case testing
  - [x] 1.2 Add inputHeight state to ChatPanel.tsx
    - Add `const [inputHeight, setInputHeight] = useState(100);` (default 100px)
    - Add `const isResizingInput = useRef(false);` for vertical resize tracking
    - File: `frontend/src/components/chat/ChatPanel.tsx`
  - [x] 1.3 Implement vertical resize handler in ChatPanel.tsx
    - Create `handleInputResizeStart` callback (similar to existing `handleResizeStart` at lines 85-90)
    - Set cursor to `ns-resize` on mousedown
    - Add mousemove handler to calculate new height from mouse Y position
    - Add mouseup handler to clean up resize state
    - Reuse pattern from existing horizontal resize (lines 92-123)
    - File: `frontend/src/components/chat/ChatPanel.tsx`
  - [x] 1.4 Add drag handle component between message list and input
    - Add new div with `className={styles.inputDragHandle}` after ChatMessageList
    - Attach `onMouseDown={handleInputResizeStart}` to drag handle
    - Add aria attributes: `role="separator"`, `aria-orientation="horizontal"`
    - File: `frontend/src/components/chat/ChatPanel.tsx`
  - [x] 1.5 Update ChatInput to accept and use height prop
    - Add `height?: number` to ChatInputProps interface
    - Pass height to container via inline style: `style={{ height: height ? `${height}px` : undefined }}`
    - File: `frontend/src/components/chat/ChatInput.tsx`
  - [x] 1.6 Pass inputHeight to ChatInput in ChatPanel.tsx
    - Update `<ChatInput onSend={handleSend} disabled={isLoading} height={inputHeight} />`
    - File: `frontend/src/components/chat/ChatPanel.tsx`
  - [x] 1.7 Add inputDragHandle styles to ChatPanel.module.css
    - Add `.inputDragHandle` class with:
      - `height: 8px`
      - `cursor: ns-resize`
      - `background: transparent`
      - `flex: 0 0 auto`
      - `transition: background 0.2s`
    - Add hover/active states with subtle blue highlight
    - File: `frontend/src/components/chat/ChatPanel.module.css`
  - [x] 1.8 Update ChatInput.module.css for controlled height
    - Update `.container` to use `flex: 0 0 auto` (already correct)
    - Add `box-sizing: border-box` to container if missing
    - Update `.textarea` to:
      - Remove `min-height: 60px` and `max-height: 150px`
      - Remove `resize: vertical` (custom drag handle replaces it)
      - Add `height: 100%`
      - Add `overflow: auto`
    - File: `frontend/src/components/chat/ChatInput.module.css`
  - [x] 1.9 Verify flex hierarchy has min-height: 0 throughout
    - Confirm `.panel` has `min-height: 0` (already present at line 42)
    - Confirm ChatMessageList container has `min-height: 0` (already present)
    - Confirm no intermediate wrappers break the flex chain
    - Files: `ChatPanel.module.css`, `ChatMessageList.module.css`
  - [x] 1.10 Ensure chat panel layout tests pass
    - Run ONLY the 4-6 tests written in 1.1
    - Verify layout renders correctly
    - Verify resize interaction works
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-6 tests written in 1.1 pass
- Chat panel uses proper flex hierarchy with min-height: 0
- Drag handle (8px) visible between message list and input area
- Cursor changes to ns-resize when hovering drag handle
- Vertical resize updates inputHeight state and ChatInput height
- Textarea scrolls internally when content exceeds container height
- Native browser resize handle removed from textarea
- Message entry area stays pinned at bottom

---

### Gateway Layer

#### Task Group 2: Optional SessionId Validation
**Dependencies:** None
**Parallel with:** Task Group 1 (Frontend)

- [x] 2.0 Complete gateway sessionId optional validation
  - [x] 2.1 Write 4-6 focused tests for optional sessionId behavior
    - Test POST /api/chat accepts request without sessionId
    - Test POST /api/chat validates sessionId if provided (non-empty after trim)
    - Test GET /api/chat/stream accepts request without sessionId query param
    - Test GET /api/chat/stream validates sessionId if provided
    - Test response includes sessionId (generated or provided)
    - Skip exhaustive validation edge case testing
  - [x] 2.2 Update ChatRequest interface to make sessionId optional
    - Change `sessionId: string;` to `sessionId?: string;`
    - Update JSDoc comment: "Client-provided or Gateway-generated session ID (optional)"
    - File: `gateway/src/types/chat.ts`
  - [x] 2.3 Update validateChatRequest() to allow missing sessionId
    - Remove sessionId from required validation (lines 108-114)
    - Add conditional: if sessionId is provided and not a non-empty string after trim, add error
    - Keep message validation (lines 116-130) unchanged
    - Keep context validation (lines 132-134) unchanged
    - File: `gateway/src/types/validation.ts`
  - [x] 2.4 Update validateStreamRequestMiddleware() for optional sessionId
    - Remove or conditionalize the call to `validateSessionId(req.query.sessionId)` (lines 67-70)
    - If sessionId is provided, validate it is non-empty after trim
    - If sessionId is missing or empty, skip validation (handler will generate)
    - File: `gateway/src/middleware/validateRequest.ts`
  - [x] 2.5 Ensure validation tests pass
    - Run ONLY the 4-6 tests written in 2.1
    - Verify requests pass validation with and without sessionId
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-6 tests written in 2.1 pass
- POST /api/chat validation passes when sessionId is missing
- POST /api/chat validation passes when sessionId is provided and valid
- GET /api/chat/stream validation passes when sessionId is missing
- GET /api/chat/stream validation passes when sessionId is provided and valid
- Existing message and context validation unchanged

---

#### Task Group 3: Server-Side SessionId Generation
**Dependencies:** Task Group 2

- [x] 3.0 Complete server-side sessionId generation in handlers
  - [x] 3.1 Write 3-5 focused tests for sessionId generation
    - Test POST handler generates sessionId when missing from request
    - Test GET handler generates sessionId when missing from query params
    - Test generated sessionId is valid UUID v4 format
    - Test response includes generated sessionId
    - Test final SSE event includes sessionId field
  - [x] 3.2 Update POST /api/chat handler to generate sessionId if missing
    - After destructuring body, check if sessionId is undefined/null/blank after trim
    - If missing: `const effectiveSessionId = body.sessionId?.trim() || uuidv4();`
    - Log `session_created: true` when generating new sessionId
    - Use effectiveSessionId for getOrCreateSession() call
    - Update response to use effectiveSessionId
    - File: `gateway/src/routes/chat.ts` (lines 43-172)
  - [x] 3.3 Update GET /api/chat/stream handler to generate sessionId if missing
    - After extracting query params, check if sessionId is undefined/null/blank after trim
    - If missing: `const effectiveSessionId = (req.query.sessionId as string)?.trim() || uuidv4();`
    - Log `session_created: true` when generating new sessionId
    - Use effectiveSessionId for getOrCreateSession() call
    - File: `gateway/src/routes/chat.ts` (lines 179-369)
  - [x] 3.4 Update SSE final event to include sessionId
    - In the final event object (line 338-341), add `sessionId: effectiveSessionId`
    - Update SSEFinalEvent interface to include optional sessionId field
    - File: `gateway/src/routes/chat.ts`, `gateway/src/types/chat.ts`
  - [x] 3.5 Add import for uuidv4 if not present
    - Check if uuid is already imported (used in sessionStore.ts)
    - Add `import { v4 as uuidv4 } from 'uuid';` to chat.ts if needed
    - File: `gateway/src/routes/chat.ts`
  - [x] 3.6 Ensure sessionId generation tests pass
    - Run ONLY the 3-5 tests written in 3.1
    - Verify sessionId is generated when missing
    - Verify response includes sessionId
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 3-5 tests written in 3.1 pass
- POST handler generates UUID v4 sessionId when request.sessionId is missing/blank
- GET handler generates UUID v4 sessionId when query.sessionId is missing/blank
- Generated sessionId logged with `session_created: true`
- POST response includes sessionId (existing behavior, verify with generated ID)
- SSE final event includes sessionId field
- getOrCreateSession() called with effective (provided or generated) sessionId

---

### Verification

#### Task Group 4: Integration Testing and Final Verification
**Dependencies:** Task Groups 1, 2, 3

- [x] 4.0 Review tests and verify end-to-end functionality
  - [x] 4.1 Review existing tests from Task Groups 1-3
    - Review the 4-6 tests written for chat panel layout (Task 1.1)
    - Review the 4-6 tests written for optional sessionId validation (Task 2.1)
    - Review the 3-5 tests written for sessionId generation (Task 3.1)
    - Total existing tests: approximately 11-17 tests
  - [x] 4.2 Identify critical integration gaps
    - Focus on end-to-end workflow: frontend chat -> gateway -> response
    - Focus on session continuity: first message (no sessionId) -> subsequent messages (with sessionId)
    - Skip exhaustive edge case coverage
  - [x] 4.3 Write up to 5 additional integration tests if needed
    - Test full chat flow without pre-existing sessionId
    - Test sessionId persists across multiple messages in same session
    - Test frontend correctly stores and reuses sessionId from response
    - Skip performance, accessibility, and edge case tests unless critical
  - [x] 4.4 Run all feature-specific tests
    - Run ONLY tests related to this spec (Tasks 1.1, 2.1, 3.1, and 4.3)
    - Expected total: approximately 16-22 tests maximum
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass
  - [x] 4.5 Manual verification checklist
    - [x] Verify chat panel fills available height in browser (verified via CSS analysis)
    - [x] Verify message list scrolls independently (verified via CSS: flex: 1 1 0, min-height: 0, overflow-y: auto)
    - [x] Verify input area stays pinned at bottom (verified via CSS: flex: 0 0 auto)
    - [x] Verify drag handle resizes input area vertically (verified via code: handleInputResizeStart, inputHeight state)
    - [x] Verify textarea scrolls when content exceeds height (verified via CSS: overflow: auto, height: 100%)
    - [x] Verify sending message without sessionId works (verified via tests: 10 validation tests pass)
    - [x] Verify sessionId returned in response (verified via tests: 5 generation tests pass)
    - [x] Verify subsequent messages use returned sessionId (verified via 6 session continuity tests)
    - [x] Verify collapsed tab displays correctly (height: 100%) (verified via CSS: height: 100%, align-self: stretch)

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 16-22 tests total)
- Manual verification confirms chat panel layout works correctly
- Manual verification confirms sessionId generation and persistence works
- No regressions in existing chat functionality

---

## Test Results Summary

### Final Test Execution (Task Group 4.4)

| Test File | Tests | Status |
|-----------|-------|--------|
| `frontend/src/__tests__/chat-panel-vertical-resize.test.ts` | 8 | PASSED |
| `gateway/src/__tests__/optional-sessionId-validation.test.ts` | 10 | PASSED |
| `gateway/src/__tests__/sessionId-generation.test.ts` | 5 | PASSED |
| `frontend/src/__tests__/chat-session-continuity.test.ts` | 6 | PASSED |
| **Total** | **29** | **ALL PASSED** |

### Verification Notes

**Code Analysis Verification (Task 4.5):**
- ChatPanel.tsx: Implements inputHeight state (line 24), isResizingInput ref (line 27), handleInputResizeStart callback (lines 96-101), vertical resize logic in mousemove handler (lines 119-131)
- ChatPanel.module.css: inputDragHandle class with height: 8px, cursor: ns-resize, flex: 0 0 auto (lines 99-113)
- ChatInput.tsx: Accepts height prop (line 7), applies via inline style (line 38)
- ChatInput.module.css: textarea has height: 100%, flex: 1 1 0, overflow: auto, no resize property (lines 10-22)
- ChatPanel.module.css: panel has min-height: 0 (line 42), collapsedTab has height: 100% (line 4)
- gateway/src/routes/chat.ts: POST handler generates sessionId (lines 53-63), GET handler generates sessionId (lines 205-215), SSE final event includes sessionId (lines 362-366)
- validation.ts: sessionId optional validation (lines 111-119)

---

## Execution Order

Recommended implementation sequence:

```
Phase 1 (Parallel):
  - Task Group 1: Frontend Chat Panel Layout (can start immediately)
  - Task Group 2: Gateway Optional SessionId Validation (can start immediately)

Phase 2 (Sequential):
  - Task Group 3: Server-Side SessionId Generation (after Task Group 2)

Phase 3 (Final):
  - Task Group 4: Integration Testing and Verification (after all above)
```

## Key Files Summary

### Frontend Files
| File | Changes |
|------|---------|
| `frontend/src/components/chat/ChatPanel.tsx` | Add inputHeight state, isResizingInput ref, vertical resize handlers, drag handle element |
| `frontend/src/components/chat/ChatPanel.module.css` | Add .inputDragHandle styles |
| `frontend/src/components/chat/ChatInput.tsx` | Add height prop to interface and container |
| `frontend/src/components/chat/ChatInput.module.css` | Remove resize: vertical, min/max-height; add height: 100%, overflow: auto |

### Gateway Files
| File | Changes |
|------|---------|
| `gateway/src/types/chat.ts` | Make sessionId optional in ChatRequest, add sessionId to SSEFinalEvent |
| `gateway/src/types/validation.ts` | Update validateChatRequest() to allow missing sessionId |
| `gateway/src/middleware/validateRequest.ts` | Update validateStreamRequestMiddleware() for optional sessionId |
| `gateway/src/routes/chat.ts` | Generate sessionId if missing in both handlers, include in SSE final event |

### Test Files Added
| File | Purpose |
|------|---------|
| `frontend/src/__tests__/chat-panel-vertical-resize.test.ts` | Task Group 1 tests (8 tests) |
| `gateway/src/__tests__/optional-sessionId-validation.test.ts` | Task Group 2 tests (10 tests) |
| `gateway/src/__tests__/sessionId-generation.test.ts` | Task Group 3 tests (5 tests) |
| `frontend/src/__tests__/chat-session-continuity.test.ts` | Task Group 4 integration tests (6 tests) |

### Files Requiring No Changes
| File | Reason |
|------|--------|
| `frontend/src/components/chat/ChatMessageList.module.css` | Already has correct flex: 1 1 0 and min-height: 0 |
| `gateway/src/services/sessionStore.ts` | getOrCreateSession() already handles session creation correctly |
