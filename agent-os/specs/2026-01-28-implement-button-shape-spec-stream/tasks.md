# Task Breakdown: Implement Button Starts Shape-Spec Stream

## Overview
Total Tasks: 24
Estimated Complexity: Medium

This spec replaces the current Implement button behavior to initiate a new Shape-Spec streaming conversation with the Software Architect (Claude Code proxy), using the Planner LLM's final spec intent as input, and rendering streamed content live in the chat UI.

## Task List

### Utility Layer

#### Task Group 1: SSE Stream Utility Hook
**Dependencies:** None

This task group creates a reusable SSE streaming utility that handles POST-based SSE consumption using the fetch API with ReadableStream.

- [x] 1.0 Complete SSE streaming utility
  - [x] 1.1 Write 4-6 focused tests for SSE stream hook
    - Test successful stream consumption with content events
    - Test handling of `done` event completing the stream
    - Test `skill_invoked` events are ignored (no callback)
    - Test connection error handling
    - Test malformed JSON parsing error handling
    - Test stream cleanup on unmount/abort
  - [x] 1.2 Create `useShapeSpecStream` hook in `frontend/src/hooks/useShapeSpecStream.ts`
    - Define TypeScript interfaces for SSE event types:
      - `ShapeSpecStreamEvent` union type
      - `SkillInvokedEvent: { type: 'skill_invoked', skill: string }`
      - `ContentEvent: { type: 'content', delta: string }`
      - `DoneEvent: { type: 'done' }`
    - Define hook return type with:
      - `startStream(params: ShapeSpecStreamParams): void`
      - `isStreaming: boolean`
      - `error: string | null`
      - `abort(): void`
  - [x] 1.3 Implement SSE line parsing logic
    - Parse lines starting with `data:` to extract JSON payload
    - Handle empty lines (SSE delimiter)
    - Handle lines without `data:` prefix (ignore)
    - Parse JSON and validate `type` field exists
  - [x] 1.4 Implement fetch-based ReadableStream consumption
    - Use `fetch` API with POST method for SSE (not EventSource)
    - Configure request with `Content-Type: application/json`
    - Read response body as stream using `getReader()`
    - Decode chunks with `TextDecoder`
    - Handle partial line buffering across chunks
  - [x] 1.5 Implement event routing based on `type` field
    - `skill_invoked`: Ignore (no callback invocation)
    - `content`: Call `onContent(delta: string)` callback
    - `done`: Call `onDone()` callback, stop stream
    - Unknown types: Log warning, continue processing
  - [x] 1.6 Implement error handling
    - Network error: Set error state, call `onError(message)` callback
    - JSON parse error: Set error state, call `onError(message)` callback
    - Unexpected stream close: Set error state, call `onError(message)` callback
  - [x] 1.7 Implement cleanup and abort functionality
    - Create AbortController for stream cancellation
    - Expose `abort()` function to callers
    - Clean up on component unmount (useEffect cleanup)
    - Reset `isStreaming` state on completion/error/abort
  - [x] 1.8 Ensure SSE utility tests pass
    - Run ONLY the 4-6 tests written in 1.1
    - Verify all event types handled correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- Hook correctly parses SSE `data:` lines
- `content` events trigger `onContent` callback
- `done` events complete the stream
- `skill_invoked` events are silently ignored
- Error states are properly set and reported
- Stream can be aborted manually
- Cleanup occurs on unmount

**Files to Create:**
- `frontend/src/hooks/useShapeSpecStream.ts` [CREATED]
- `frontend/src/hooks/useShapeSpecStream.test.ts` [CREATED]

---

### Composition Layer

#### Task Group 2: Spec Intent Composition Function
**Dependencies:** None (can run in parallel with Task Group 1)

This task group creates the function to compose the spec intent message from `latestPlannerResponse`.

- [x] 2.0 Complete spec intent composition
  - [x] 2.1 Write 3-5 focused tests for spec intent composition
    - Test composition from full PlannerResponse with all fields populated
    - Test composition with empty arrays (scope.in=[], assumptions=[], etc.)
    - Test output is prefixed with `/shape-spec `
    - Test output is LLM-friendly string format
    - Test null/undefined handling returns null or appropriate fallback
  - [x] 2.2 Create `composeSpecIntent` function in `frontend/src/utils/specIntentComposer.ts`
    - Input: `PlannerResponse | null`
    - Output: `string | null` (null if input is null)
    - Extract fields: `featureUnderstanding`, `scope.in`, `scope.out`, `assumptions`, `acceptanceCriteria`
  - [x] 2.3 Implement LLM-friendly string formatting
    - Prefix entire output with `/shape-spec `
    - Format `featureUnderstanding` as feature description section
    - Format `scope.in` as bulleted "In Scope" list
    - Format `scope.out` as bulleted "Out of Scope" list
    - Format `assumptions` as bulleted "Assumptions" list
    - Format `acceptanceCriteria` as bulleted "Acceptance Criteria" list
    - Use clear section headers and markdown-style formatting
  - [x] 2.4 Ensure spec intent composition tests pass
    - Run ONLY the 3-5 tests written in 2.1
    - Verify output format matches expected structure
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- Function extracts all required fields from PlannerResponse
- Output is prefixed with `/shape-spec `
- Empty arrays result in empty sections (not omitted)
- Null input returns null output
- Format is clean and LLM-parseable

**Files to Create:**
- `frontend/src/utils/specIntentComposer.ts` [CREATED]
- `frontend/src/utils/specIntentComposer.test.ts` [CREATED]

---

### API Layer

#### Task Group 3: Shape-Spec Stream API Integration
**Dependencies:** Task Groups 1, 2

This task group creates the API function to build and send the shape-spec stream request.

- [x] 3.0 Complete shape-spec stream API
  - [x] 3.1 Write 3-4 focused tests for API request building
    - Test request body structure matches spec: `{ company, project, message, session_mode: "new" }`
    - Test endpoint URL uses environment variable with fallback
    - Test request method is POST with JSON content type
    - Test error thrown on non-2xx response
  - [x] 3.2 Create `startShapeSpecStream` function in `frontend/src/api/shapeSpecApi.ts`
    - Define `ShapeSpecStreamRequest` interface: `{ company: string, project: string, message: string, session_mode: 'new' }`
    - Configure base URL from `VITE_SHAPE_SPEC_BASE_URL` env var with `http://localhost:8000` fallback
    - Endpoint path: `/api/v1/shape-spec/stream`
    - Method: POST
    - Headers: `Content-Type: application/json`
    - Return: `Response` object for ReadableStream access
  - [x] 3.3 Implement request construction
    - Accept `ShapeSpecStreamRequest` parameter
    - Build fetch request with proper headers
    - Return raw Response for stream handling by hook
    - Throw error if response not OK (network/server errors)
  - [x] 3.4 Ensure API tests pass
    - Run ONLY the 3-4 tests written in 3.1
    - Verify request structure and error handling
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- Request body matches spec exactly
- Environment variable configuration works
- Fallback URL works when env var not set
- Non-2xx responses throw appropriate errors

**Files to Create:**
- `frontend/src/api/shapeSpecApi.ts` [CREATED]
- `frontend/src/api/shapeSpecApi.test.ts` [CREATED]

---

### Integration Layer

#### Task Group 4: Implement Button Handler Replacement
**Dependencies:** Task Groups 1, 2, 3

This task group modifies `ImplementationAssistantPanel.tsx` to replace the current Implement button behavior with the new shape-spec stream flow.

- [x] 4.0 Complete Implement button handler replacement
  - [x] 4.1 Write 4-6 focused tests for Implement button integration
    - Test clicking Implement button initiates stream when `canImplementBase` is true
    - Test button is disabled during active stream (`isStreaming` state)
    - Test company/project names are derived correctly from context
    - Test error handling shows error message in chat
    - Test successful stream creates Software Architect chat message
    - Test `done` event finalizes message and re-enables button
  - [x] 4.2 Add streaming state to ImplementationAssistantPanel
    - Add `isStreaming` boolean state (distinct from `isImplementing`)
    - Add `streamingMessageId` state to track the in-progress message
    - Add `streamedContent` state to accumulate delta content
  - [x] 4.3 Create `startShapeSpecStream` callback in component
    - Derive company name: `getOrganisationById(activeProject.organisationId)?.name || 'Unknown Organisation'`
    - Derive project name: `activeProject?.name || projectId`
    - Compose spec intent: `composeSpecIntent(latestPlannerResponse)`
    - Validate spec intent is non-null before proceeding
  - [x] 4.4 Implement stream initiation on Implement click
    - Replace `generateImplementationPlan()` call with `startShapeSpecStream()`
    - Remove calls to `startOrchestration` and `generateImplementationPlan` from Implement flow
    - Keep existing `canImplementBase` logic for button enablement
    - Add `isStreaming` check to disable button: `disabled={!canImplementBase || isImplementing || isStreaming}`
  - [x] 4.5 Implement stream callbacks
    - `onStart`: Create initial Software Architect message, set `isStreaming: true`
    - `onContent`: Accumulate delta to `streamedContent`, update message in `messages` array
    - `onDone`: Finalize message, set `isStreaming: false`
    - `onError`: Show error in chat, set `isStreaming: false`
  - [x] 4.6 Ensure Implement button integration tests pass
    - Run ONLY the 4-6 tests written in 4.1
    - Verify complete flow from button click to message display
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- Implement button triggers shape-spec stream instead of old flow
- Button is disabled during streaming
- Company/project names derived from active project context
- Stream content accumulates in single chat message
- Errors are displayed in chat bubbles
- Stream completion re-enables button

**Files to Modify:**
- `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`

**Files to Create:**
- `frontend/src/components/ProductView/ImplementationAssistantPanel.test.tsx` (new tests) [CREATED]

---

### UI Layer

#### Task Group 5: Streaming Chat Message Rendering
**Dependencies:** Task Group 4

This task group implements the live rendering of streamed content in the chat UI.

- [x] 5.0 Complete streaming chat message rendering
  - [x] 5.1 Write 3-4 focused tests for streaming UI
    - Test Software Architect message is created with correct persona/color
    - Test content updates during streaming (incremental appending)
    - Test auto-scroll behavior during streaming
    - Test message finalization on stream complete
  - [x] 5.2 Implement streaming message creation
    - Create message with `role: 'assistant'` at stream start
    - Use persona="Software Architect" and personaColor="purple"
    - Initial content: empty string or loading indicator
    - Store message ID in `streamingMessageId` state
  - [x] 5.3 Implement incremental content updates
    - On `onContent` callback: append `delta` to `streamedContent`
    - Update message in `messages` array using `setMessages` with map
    - Find message by `streamingMessageId` and update content
    - Consider debouncing if performance is a concern (optional)
  - [x] 5.4 Implement message finalization
    - On `onDone`: Clear `streamingMessageId` and `streamedContent`
    - Message remains in `messages` array (persisted)
    - Reset streaming state flags
  - [x] 5.5 Verify ChatMessageList compatibility
    - Confirm `currentPhase="implementation_clarification"` routes to Software Architect
    - Confirm auto-scroll works with incrementally updating message
    - Confirm existing `ChatBubble` styling applies correctly
  - [x] 5.6 Ensure streaming UI tests pass
    - Run ONLY the 3-4 tests written in 5.1
    - Verify visual rendering matches requirements
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- Single Software Architect message created at stream start
- Content appends incrementally during stream
- Persona and color are correct (purple)
- Auto-scroll works during streaming
- Message persists after stream completion

**Files to Modify:**
- `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`
- `frontend/src/components/chat/ChatMessageList.tsx` [MODIFIED - Enhanced auto-scroll for streaming]

**Files to Create:**
- `frontend/src/components/chat/ChatMessageList.test.tsx` [CREATED]

---

### Error Handling Layer

#### Task Group 6: Stream Error Handling
**Dependencies:** Task Groups 4, 5

This task group implements minimal error handling for stream failures.

- [x] 6.0 Complete stream error handling
  - [x] 6.1 Write 3-4 focused tests for error handling
    - Test connection failure shows error message in chat
    - Test JSON parse failure shows error message in chat
    - Test unexpected stream end shows error message in chat
    - Test error resets `isStreaming` state to false
  - [x] 6.2 Implement error message display
    - On stream error: Create assistant message with error content
    - Use existing error message pattern from `handleSend` error handling
    - Format: `Error: [error description]`
    - Add to `messages` array like normal chat messages
  - [x] 6.3 Implement error state management
    - Set `isStreaming: false` on any error
    - Clear `streamingMessageId` and `streamedContent`
    - Optionally set `error` state for component-level visibility
  - [x] 6.4 Ensure no retry logic is implemented
    - Verify no automatic retry on failure
    - Verify no error categorization beyond simple message display
    - User must manually click Implement again to retry
  - [x] 6.5 Ensure error handling tests pass
    - Run ONLY the 3-4 tests written in 6.1
    - Verify errors display correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- Connection failures show error in chat
- Parse failures show error in chat
- Unexpected stream end shows error in chat
- No retry logic implemented
- Streaming state resets on error

**Files to Modify:**
- `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`

---

### Environment Configuration

#### Task Group 7: Environment Variable Setup
**Dependencies:** None (can run in parallel with any group)

This task group ensures the environment variable for the shape-spec endpoint is properly configured.

- [x] 7.0 Complete environment configuration
  - [x] 7.1 Add `VITE_SHAPE_SPEC_BASE_URL` to environment configuration
    - Add to `.env.development` with default value `http://localhost:8000`
    - Add TypeScript declaration in `frontend/src/vite-env.d.ts` if needed
    - Document the variable in relevant configuration docs
  - [x] 7.2 Verify environment variable is used in API module
    - Confirm `shapeSpecApi.ts` reads from `import.meta.env.VITE_SHAPE_SPEC_BASE_URL`
    - Confirm fallback to `http://localhost:8000` works

**Acceptance Criteria:**
- Environment variable is documented
- TypeScript recognizes the variable
- Fallback works when variable is not set

**Files to Modify:**
- `frontend/.env.development` (modified - added VITE_SHAPE_SPEC_BASE_URL)
- `frontend/src/vite-env.d.ts` (modified - added TypeScript declaration for VITE_SHAPE_SPEC_BASE_URL)

---

### Testing

#### Task Group 8: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-6

This task group reviews all tests written during development and fills critical gaps.

- [x] 8.0 Review existing tests and fill critical gaps only
  - [x] 8.1 Review tests from Task Groups 1-6
    - Review the 4-6 tests written by Task Group 1 (SSE utility) - Found 6 tests
    - Review the 3-5 tests written by Task Group 2 (spec intent composition) - Found 6 tests
    - Review the 3-4 tests written by Task Group 3 (API) - Found 6 tests
    - Review the 4-6 tests written by Task Group 4 (Implement button) - Found 20 tests
    - Review the 3-4 tests written by Task Group 5 (streaming UI) - Included in Task Group 4 tests
    - Review the 3-4 tests written by Task Group 6 (error handling) - Included in Task Group 4 tests
    - Review ChatMessageList tests - Found 6 tests
    - Total existing tests: 44 tests
  - [x] 8.2 Analyze test coverage gaps for THIS feature only
    - Identified gap: HTTP error response handling (non-2xx status codes)
    - Identified gap: Unknown event type handling (forward compatibility)
    - Identified gap: Empty featureUnderstanding string handling
    - Identified gap: Undefined scope.in/out arrays handling
    - Identified gap: Special characters in content preservation
  - [x] 8.3 Write up to 6 additional strategic tests maximum
    - Added 2 tests to useShapeSpecStream.test.ts (HTTP error, unknown event types)
    - Added 3 tests to specIntentComposer.test.ts (empty featureUnderstanding, undefined scope, special characters)
    - Total new tests added: 5 (within the maximum of 6)
  - [x] 8.4 Run feature-specific tests only
    - Ran tests for: useShapeSpecStream, specIntentComposer, shapeSpecApi, ImplementationAssistantPanel, ChatMessageList
    - Final test count: 49 tests (8 + 9 + 6 + 20 + 6)
    - All 49 tests pass

**Acceptance Criteria:**
- All feature-specific tests pass - VERIFIED (49/49 passing)
- Critical user workflows for this feature are covered - VERIFIED
- No more than 6 additional tests added when filling gaps - VERIFIED (5 tests added)
- Testing focused exclusively on this spec's feature requirements - VERIFIED

---

## Execution Order

Recommended implementation sequence:

```
Phase 1 (Parallel):
  - Task Group 1: SSE Stream Utility Hook [COMPLETE]
  - Task Group 2: Spec Intent Composition Function [COMPLETE]
  - Task Group 7: Environment Configuration [COMPLETE]

Phase 2 (After Phase 1):
  - Task Group 3: Shape-Spec Stream API Integration [COMPLETE]

Phase 3 (After Task Group 3):
  - Task Group 4: Implement Button Handler Replacement [COMPLETE]

Phase 4 (After Task Group 4):
  - Task Group 5: Streaming Chat Message Rendering [COMPLETE]
  - Task Group 6: Stream Error Handling [COMPLETE]

Phase 5 (After All Above):
  - Task Group 8: Test Review and Gap Analysis [COMPLETE]
```

## Key Files Summary

**New Files to Create:**
- `frontend/src/hooks/useShapeSpecStream.ts` - SSE streaming hook [CREATED]
- `frontend/src/hooks/useShapeSpecStream.test.ts` - SSE hook tests [CREATED]
- `frontend/src/utils/specIntentComposer.ts` - Spec intent composition [CREATED]
- `frontend/src/utils/specIntentComposer.test.ts` - Composition tests [CREATED]
- `frontend/src/api/shapeSpecApi.ts` - Shape-spec API client [CREATED]
- `frontend/src/api/shapeSpecApi.test.ts` - API tests [CREATED]
- `frontend/src/components/ProductView/ImplementationAssistantPanel.test.tsx` - Integration tests [CREATED]
- `frontend/src/components/chat/ChatMessageList.test.tsx` - ChatMessageList tests [CREATED]

**Files to Modify:**
- `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx` - Main integration [MODIFIED]
- `frontend/src/components/chat/ChatMessageList.tsx` - Enhanced auto-scroll for streaming [MODIFIED]
- `frontend/.env.development` - Environment variable documentation [MODIFIED]
- `frontend/src/vite-env.d.ts` - TypeScript env declarations [MODIFIED]

## Reference Patterns

**Existing patterns to follow:**
- `handleSend()` in ImplementationAssistantPanel - message creation pattern
- `handleSubmitAnswers()` - optimistic message + error handling pattern
- `getOrganisationById()` usage in `handleImplement()` - company name derivation
- `ChatBubble` with `persona="Software Architect"` and `personaColor="purple"` - persona styling
- `generateMessageId()` - unique ID generation

**Key interfaces:**
- `PlannerResponse` in `chatApi.ts` - source for spec intent composition
- `ChatMessage` in `chatApi.ts` - message structure for UI
