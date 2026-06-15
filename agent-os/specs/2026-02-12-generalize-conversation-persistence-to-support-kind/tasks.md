# Task Breakdown: Generalize Conversation Persistence to Support Kind

## Overview
Total Tasks: 27 (across 4 task groups)

This spec introduces a conversation "kind" directory level into the existing gateway conversation persistence mechanism. The persist path changes from `<projectParentFolder>/conversations/<derivedFolderName>/` to `<projectParentFolder>/conversations/<kind>/<derivedFolderName>/`. The change spans the gateway service layer, two route handlers, the chat transcript flushing path, and the frontend API callers.

## Task List

### Gateway Service Layer

#### Task Group 1: Transcript Writer Utilities and Service Exports
**Dependencies:** None

This group creates the `normalizeKind` helper and updates all path-building and write utilities in `transcriptWriter.ts`. Because `buildTranscriptPath` is the single centralized path-derivation function consumed by both route handlers and `writeTranscriptToFile`, these changes must land first.

- [x] 1.0 Complete transcript writer utility updates
  - [x] 1.1 Write 6 focused tests for normalizeKind and updated path utilities
    - **File:** `gateway/src/__tests__/transcript-writer-kind.test.ts` (new file)
    - Follow the existing test patterns in `gateway/src/__tests__/transcript-writer.test.ts` (mock config, import from `../services/transcriptWriter`)
    - Test 1: `normalizeKind()` returns `"implement"` when called with `undefined`
    - Test 2: `normalizeKind("")` returns `"implement"` when called with empty string
    - Test 3: `normalizeKind("Product")` returns `"product"` (case normalization)
    - Test 4: `normalizeKind("design")` throws with message containing `"Invalid kind"` and `"Allowed values: implement, product"`
    - Test 5: `buildTranscriptPath(basePath, folderName, "product")` produces `dirPath` ending with `/conversations/product/<folderName>`
    - Test 6: `buildTranscriptPath(basePath, folderName)` (no kind) produces `dirPath` ending with `/conversations/implement/<folderName>` (backward-compatible default)
  - [x] 1.2 Create `normalizeKind` helper function
    - **File:** `gateway/src/services/transcriptWriter.ts`
    - Add new exported function `normalizeKind(inputKind?: string): string` before `buildTranscriptPath` (around line 100)
    - When `inputKind` is `undefined`, `null`, or empty string, return `"implement"`
    - Normalize via `.toLowerCase()` before validation
    - Validate against allowlist `["implement", "product"]`
    - If not in allowlist, throw `Error("Invalid kind '<value>'. Allowed values: implement, product")`
  - [x] 1.3 Update `buildTranscriptPath` to accept optional `kind` parameter
    - **File:** `gateway/src/services/transcriptWriter.ts`, line 107
    - Change signature from `(basePath: string, folderName: string)` to `(basePath: string, folderName: string, kind?: string)`
    - Default `kind` to `"implement"` when not provided
    - Change `dirPath` construction from `path.join(basePath, CONVERSATIONS_FOLDER, folderName)` to `path.join(basePath, CONVERSATIONS_FOLDER, kind, folderName)`
    - `CONVERSATIONS_FOLDER` constant remains unchanged
  - [x] 1.4 Update `writeConversationJson` to accept optional `kind` parameter
    - **File:** `gateway/src/services/transcriptWriter.ts`, line 255
    - Add optional fourth parameter `kind?: string` (default `"implement"`)
    - Replace inline `dirPath` construction `path.join(basePath, CONVERSATIONS_FOLDER, folderName)` with delegation to `buildTranscriptPath(basePath, folderName, kind)` for DRY path derivation
    - Preserve existing atomic write pattern (temp file + rename) exactly as-is
  - [x] 1.5 Update `writeDisplayedConversation` to accept optional `kind` parameter
    - **File:** `gateway/src/services/transcriptWriter.ts`, line 341
    - Add optional fourth parameter `kind?: string` (default `"implement"`)
    - Replace inline `dirPath` construction with delegation to `buildTranscriptPath(basePath, folderName, kind)`
    - Preserve existing atomic write pattern exactly as-is
  - [x] 1.6 Update `writeTranscriptToFile` to thread `kind` through all internal calls
    - **File:** `gateway/src/services/transcriptWriter.ts`, line 418
    - Add optional `kind?: string` parameter after `projectParentFolder` and before `displayedMessages`
    - New signature: `(transcript, workItemTitle, featureId, projectParentFolder?, kind?, displayedMessages?)`
    - Default to `"implement"` when not provided
    - Pass `kind` to `buildTranscriptPath(basePath, folderName, kind)` at line 435
    - Pass `kind` to `writeConversationJson(messages, basePath, folderName, kind)` at line 484
    - Pass `kind` to `writeDisplayedConversation(displayedMessages, basePath, folderName, kind)` at line 488
  - [x] 1.7 Export `normalizeKind` from the services barrel file
    - **File:** `gateway/src/services/index.ts`, line 112-121
    - Add `normalizeKind` to the existing `transcriptWriter` re-export block alongside `writeTranscriptToFile`, `deriveFolderName`, `buildTranscriptPath`, etc.
  - [x] 1.8 Ensure transcript writer utility tests pass
    - Run ONLY the 6 tests written in 1.1: `npx jest gateway/src/__tests__/transcript-writer-kind.test.ts`
    - Verify all 6 tests pass
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 6 tests from 1.1 all pass
- `normalizeKind` correctly defaults, normalizes case, validates against allowlist, and throws descriptive errors
- `buildTranscriptPath` produces paths with the `<kind>` segment between `conversations/` and `<folderName>/`
- `writeConversationJson`, `writeDisplayedConversation`, and `writeTranscriptToFile` all accept and propagate the optional `kind` parameter
- `normalizeKind` is importable via `gateway/src/services/index.ts`
- All existing callers that omit the `kind` parameter continue to work with the `"implement"` default
- Atomic write patterns (temp file + rename) are preserved unchanged

---

### Gateway Route Handlers

#### Task Group 2: Route Handler Updates (implementConversations and implementState)
**Dependencies:** Task Group 1

This group updates both route handlers to extract, validate, and pass the `kind` parameter through to `buildTranscriptPath`. Both routes must be updated in lockstep so that conversation JSON and implementation state JSON remain co-located under the same `conversations/<kind>/<folderName>/` directory.

- [x] 2.0 Complete route handler updates
  - [x] 2.1 Write 8 focused tests for route handler kind parameter handling
    - **File:** `gateway/src/__tests__/implement-routes-kind.test.ts` (new file)
    - Follow existing patterns from `gateway/src/__tests__/implement-conversations-route.test.ts` and `gateway/src/__tests__/implement-conversations-path-alignment-integration.test.ts`
    - Test 1: GET `/api/implement-conversations?...&kind=product` uses the correct kind-prefixed path (mock `fs.readFile` and verify the path argument contains `/conversations/product/`)
    - Test 2: GET `/api/implement-conversations` without `kind` defaults to `"implement"` path segment
    - Test 3: PUT `/api/implement-conversations` with `body.kind="product"` writes to kind-prefixed path
    - Test 4: PUT `/api/implement-conversations` with invalid `kind="design"` returns HTTP 400 with error message
    - Test 5: GET `/api/implement-state?...&kind=product` uses the correct kind-prefixed path
    - Test 6: GET `/api/implement-state` without `kind` defaults to `"implement"` path segment
    - Test 7: PUT `/api/implement-state` with `body.kind="product"` writes to kind-prefixed path
    - Test 8: PUT `/api/implement-state` with `body.kind` taking precedence over `query.kind` when both provided
  - [x] 2.2 Update `implementConversations` GET handler to accept and validate `kind`
    - **File:** `gateway/src/routes/implementConversations.ts`
    - Add import of `normalizeKind` from `../services/transcriptWriter` (extend the existing import at line 20)
    - In GET handler (line 128): extract `kind` from `req.query.kind` as `string | undefined`
    - Wrap `normalizeKind(kind)` in try/catch; if it throws, return `res.status(400).json({ error: e.message })`
    - Pass the resolved kind to `buildTranscriptPath(basePath, folderName, kind)` at line 161
    - Do NOT add `kind` to the `validateGetParams` function
    - Do NOT echo kind in the response
  - [x] 2.3 Update `implementConversations` PUT handler to accept and validate `kind`
    - **File:** `gateway/src/routes/implementConversations.ts`
    - In PUT handler (line 222): resolve kind using precedence `req.body.kind ?? (req.query.kind as string | undefined) ?? undefined`
    - Validate via `normalizeKind(resolvedKind)` with same 400 error pattern
    - Pass resolved kind to `buildTranscriptPath(projectParentFolder, folderName, kind)` at line 248
    - Do NOT add `kind` to the `validatePutBody` function
    - Do NOT echo kind in the response
  - [x] 2.4 Update `implementState` GET handler to accept and validate `kind`
    - **File:** `gateway/src/routes/implementState.ts`
    - Add import of `normalizeKind` from `../services/transcriptWriter` (extend the existing import at line 18)
    - In GET handler (line 94): extract `kind` from `req.query.kind` as `string | undefined`
    - Wrap `normalizeKind(kind)` in try/catch; if it throws, return `res.status(400).json({ error: e.message })`
    - Pass the resolved kind to `buildTranscriptPath(basePath, folderName, kind)` at line 122
    - Do NOT add `kind` to `validateGetParams`
  - [x] 2.5 Update `implementState` PUT handler to accept and validate `kind`
    - **File:** `gateway/src/routes/implementState.ts`
    - In PUT handler (line 180): resolve kind using precedence `req.body.kind ?? (req.query.kind as string | undefined) ?? undefined`
    - Validate via `normalizeKind(resolvedKind)` with same 400 error pattern
    - Pass resolved kind to `buildTranscriptPath(projectParentFolder, folderName, kind)` at line 204
    - Do NOT add `kind` to `validatePutBody`
  - [x] 2.6 Update `chat.ts` flushTranscriptToDisk to pass kind to `writeTranscriptToFile`
    - **File:** `gateway/src/routes/chat.ts`, line 233
    - In the `writeTranscriptToFile` call, insert `"implement"` as the new `kind` parameter after `projectParentFolder` and before `context.displayedMessages`
    - Current call: `writeTranscriptToFile(transcript, featureTitle || '', featureId || '', projectParentFolder, context.displayedMessages)`
    - Updated call: `writeTranscriptToFile(transcript, featureTitle || '', featureId || '', projectParentFolder, "implement", context.displayedMessages)`
    - Hard-coded `"implement"` is correct because the chat route only handles `implement_feature` mode conversations
  - [x] 2.7 Ensure route handler tests pass
    - Run ONLY the 8 tests written in 2.1: `npx jest gateway/src/__tests__/implement-routes-kind.test.ts`
    - Verify all 8 tests pass
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 8 tests from 2.1 all pass
- Both implementConversations and implementState routes accept `kind` as an optional query/body parameter
- Invalid `kind` values return HTTP 400 with a descriptive error message
- Omitting `kind` defaults to `"implement"` (backward compatible)
- PUT precedence rule is `body.kind > query.kind > default "implement"`
- The resolved `kind` value is NOT echoed in any response
- `chat.ts` correctly passes `"implement"` as the kind to `writeTranscriptToFile`
- Both routes produce paths under `conversations/<kind>/<folderName>/`
- Conversation JSON and implementation state JSON remain co-located in the same directory

---

### Frontend API and Component Layer

#### Task Group 3: Frontend API Functions and Component Call Sites
**Dependencies:** Task Group 2

This group updates the four frontend API functions in `chatApi.ts` to accept an optional `kind` parameter, and updates the `ImplementationAssistantPanel` call sites to pass `"implement"` explicitly.

- [x] 3.0 Complete frontend updates
  - [x] 3.1 Write 4 focused tests for frontend API kind parameter handling
    - **File:** `frontend/src/api/__tests__/chatApi-kind.test.ts` (new file, or add to existing test file if one exists for chatApi)
    - Test 1: `getImplementConversation` with `kind="product"` appends `&kind=product` to the URL query string
    - Test 2: `getImplementConversation` without `kind` does NOT include `kind` in the URL
    - Test 3: `putImplementConversation` with `kind: "product"` in the request body includes `kind` in the serialized JSON
    - Test 4: `putImplementState` with `kind: "implement"` in the request body includes `kind` in the serialized JSON
  - [x] 3.2 Add optional `kind` field to `PutConversationRequest` interface
    - **File:** `frontend/src/api/chatApi.ts`, line 636
    - Add `kind?: string` field to the `PutConversationRequest` interface
    - This field is serialized into the PUT body automatically via `JSON.stringify(params)`
  - [x] 3.3 Add optional `kind` field to `PutImplementStateRequest` interface
    - **File:** `frontend/src/api/chatApi.ts`, line 813
    - Add `kind?: string` field to the `PutImplementStateRequest` interface
  - [x] 3.4 Update `getImplementConversation` to accept optional `kind` parameter
    - **File:** `frontend/src/api/chatApi.ts`, line 698
    - Add fifth parameter `kind?: string` to the function signature
    - When `kind` is provided and non-empty, append `&kind=${encodeURIComponent(kind)}` to the URL query string
    - When `kind` is omitted, do not append anything (gateway defaults to `"implement"`)
  - [x] 3.5 Update `putImplementConversation` -- no function signature change needed
    - **File:** `frontend/src/api/chatApi.ts`, line 726
    - No function signature change required; the `kind` field added to `PutConversationRequest` in 3.2 is automatically serialized via `JSON.stringify(params)`
    - Verify the function body needs no modifications
  - [x] 3.6 Update `getImplementState` to accept optional `kind` parameter
    - **File:** `frontend/src/api/chatApi.ts`, line 840
    - Add fifth parameter `kind?: string` to the function signature
    - When `kind` is provided and non-empty, append `&kind=${encodeURIComponent(kind)}` to the URL query string
  - [x] 3.7 Update `putImplementState` -- no function signature change needed
    - **File:** `frontend/src/api/chatApi.ts`, line 868
    - No function signature change required; the `kind` field added to `PutImplementStateRequest` in 3.3 is automatically serialized
    - Verify the function body needs no modifications
  - [x] 3.8 Update `ImplementationAssistantPanel` call sites to pass `kind="implement"` explicitly
    - **File:** `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`
    - At the `getImplementState` call (line ~956): pass `"implement"` as the fifth argument
      - Current: `getImplementState(projectId, workItemId, activeProject.projectParentFolder, workItemTitle)`
      - Updated: `getImplementState(projectId, workItemId, activeProject.projectParentFolder, workItemTitle, "implement")`
    - At the `getImplementConversation` call (line ~999): pass `"implement"` as the fifth argument
      - Current: `getImplementConversation(projectId, workItemId, activeProject.projectParentFolder, workItemTitle)`
      - Updated: `getImplementConversation(projectId, workItemId, activeProject.projectParentFolder, workItemTitle, "implement")`
    - At the `putImplementState` call (line ~1100): add `kind: "implement"` to the request object
      - Add `kind: "implement"` property to the object passed to `putImplementState({ projectId, featureId: workItemId, ..., kind: "implement" })`
    - These explicit values make intent clear and future-proof for product-kind conversations
  - [x] 3.9 Ensure frontend API tests pass
    - Run ONLY the 4 tests written in 3.1
    - Verify all 4 tests pass
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4 tests from 3.1 all pass
- All four API functions (`getImplementConversation`, `putImplementConversation`, `getImplementState`, `putImplementState`) accept an optional `kind` parameter
- GET functions append `kind` to the URL query string only when provided
- PUT functions include `kind` in the request body only when provided
- `ImplementationAssistantPanel` passes `"implement"` explicitly at all three call sites
- Existing callers that omit `kind` continue to work (backward compatible)

---

### Cross-Cutting Test Review

#### Task Group 4: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-3

- [x] 4.0 Review existing tests and fill critical gaps only
  - [x] 4.1 Review tests from Task Groups 1-3
    - Review the 6 tests from Task Group 1 (`gateway/src/__tests__/transcript-writer-kind.test.ts`)
    - Review the 8 tests from Task Group 2 (`gateway/src/__tests__/implement-routes-kind.test.ts`)
    - Review the 4 tests from Task Group 3 (`frontend/src/api/__tests__/chatApi-kind.test.ts`)
    - Total existing tests: 18
  - [x] 4.2 Verify no regressions in existing test files
    - Run existing transcript writer tests: `npx jest gateway/src/__tests__/transcript-writer.test.ts`
    - Run existing conversation route tests: `npx jest gateway/src/__tests__/implement-conversations-route.test.ts`
    - Run existing path alignment tests: `npx jest gateway/src/__tests__/implement-conversations-path-alignment-integration.test.ts`
    - Run existing conversation persistence E2E tests: `npx jest gateway/src/__tests__/conversation-persistence-e2e.test.ts`
    - Run existing chat transcript flushing tests: `npx jest gateway/src/__tests__/chat-transcript-flushing.test.ts`
    - Any failures indicate regressions from the `kind` parameter additions and must be fixed (likely signature mismatches in mocked calls)
  - [x] 4.3 Analyze test coverage gaps for THIS feature only
    - Identify critical workflows not covered by Task Groups 1-3 tests
    - Focus on: end-to-end path derivation with kind, chat.ts transcript flushing with kind, backward compatibility of existing callers that omit kind
  - [x] 4.4 Write up to 8 additional strategic tests to fill gaps
    - **File:** `gateway/src/__tests__/kind-integration.test.ts` (new file)
    - Potential gap tests (write only what is needed after 4.3 analysis):
      - End-to-end: `writeTranscriptToFile` with `kind="product"` produces files under `conversations/product/<folderName>/`
      - End-to-end: `writeTranscriptToFile` without `kind` produces files under `conversations/implement/<folderName>/`
      - Integration: `flushTranscriptToDisk` call in chat.ts passes `"implement"` through to `writeTranscriptToFile`
      - Regression: existing `buildTranscriptPath` callers in tests that do not pass `kind` still produce valid paths
      - Boundary: `normalizeKind(null as any)` returns `"implement"` (null coercion safety)
      - Boundary: `normalizeKind("  Product  ")` -- whitespace handling (trim before toLowerCase, or just toLowerCase)
      - Integration: PUT `/api/implement-conversations` with `body.kind="IMPLEMENT"` (uppercase) succeeds after normalization
      - Integration: PUT `/api/implement-state` without kind, then GET without kind, returns the same state (co-location verified)
  - [x] 4.5 Run all feature-specific tests
    - Run all new test files: `npx jest gateway/src/__tests__/transcript-writer-kind.test.ts gateway/src/__tests__/implement-routes-kind.test.ts gateway/src/__tests__/kind-integration.test.ts`
    - Run frontend tests if applicable
    - Run existing related tests from 4.2 to confirm no regressions
    - Expected total for this feature: approximately 18-26 tests
    - Do NOT run the entire application test suite

**Acceptance Criteria:**
- All 18 tests from Task Groups 1-3 continue to pass
- No regressions in existing test files (`transcript-writer.test.ts`, `implement-conversations-route.test.ts`, `chat-transcript-flushing.test.ts`, etc.)
- No more than 8 additional tests added to fill gaps
- All feature-specific tests pass (approximately 18-26 total)
- Testing is focused exclusively on the kind parameter feature

---

## Files Modified (Summary)

| File | Change Type |
|------|-------------|
| `gateway/src/services/transcriptWriter.ts` | Modified -- add `normalizeKind`, update `buildTranscriptPath`, `writeConversationJson`, `writeDisplayedConversation`, `writeTranscriptToFile` |
| `gateway/src/services/index.ts` | Modified -- add `normalizeKind` to re-exports |
| `gateway/src/routes/implementConversations.ts` | Modified -- import `normalizeKind`, update GET and PUT handlers |
| `gateway/src/routes/implementState.ts` | Modified -- import `normalizeKind`, update GET and PUT handlers |
| `gateway/src/routes/chat.ts` | Modified -- pass `"implement"` kind to `writeTranscriptToFile` call |
| `frontend/src/api/chatApi.ts` | Modified -- add `kind` to interfaces and function signatures |
| `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx` | Modified -- pass `"implement"` at 3 call sites |
| `gateway/src/__tests__/transcript-writer-kind.test.ts` | New -- 6 tests for normalizeKind and buildTranscriptPath |
| `gateway/src/__tests__/implement-routes-kind.test.ts` | New -- 8 tests for route handler kind parameter handling |
| `frontend/src/api/__tests__/chatApi-kind.test.ts` | New -- 4 tests for frontend API kind parameter handling |
| `gateway/src/__tests__/kind-integration.test.ts` | New -- up to 8 gap-filling integration tests |

## Execution Order

Recommended implementation sequence:

1. **Gateway Service Layer** (Task Group 1) -- `normalizeKind` helper and `transcriptWriter.ts` utility updates. This is the foundation; all other groups depend on these functions.
2. **Gateway Route Handlers** (Task Group 2) -- Route handler updates for `implementConversations`, `implementState`, and `chat.ts`. Depends on the updated `buildTranscriptPath` and `normalizeKind` from Task Group 1.
3. **Frontend API and Components** (Task Group 3) -- Frontend API function signature updates and `ImplementationAssistantPanel` call site changes. Depends on route handler changes from Task Group 2 being in place for integration.
4. **Test Review and Gap Analysis** (Task Group 4) -- Cross-cutting regression check and integration test gap filling. Depends on all implementation being complete.
