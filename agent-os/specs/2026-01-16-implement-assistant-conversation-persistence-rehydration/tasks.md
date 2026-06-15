# Task Breakdown: Implement Assistant Conversation Persistence and Rehydration

## Overview
Total Tasks: 20 (across 4 task groups)

This feature enables durable, per-feature conversation persistence and rehydration so that Implement Assistant chat conversations survive navigation away from the screen and app restarts. Conversations are saved after every chat turn and can be reloaded when the user returns to a feature.

## Architecture Summary

**New Components:**
- `gateway/src/routes/implementConversations.ts` - GET and PUT endpoints for conversation persistence
- `frontend/src/api/chatApi.ts` - New client functions for conversation endpoints

**Modified Components:**
- `gateway/src/services/transcriptWriter.ts` - Extended to write `conversation.json` alongside `full-conversation.txt`
- `gateway/src/routes/chat.ts` - Extended `flushTranscriptToDisk()` to write JSON format
- `gateway/src/routes/index.ts` - Export new router
- `gateway/src/server.ts` - Mount new route
- `gateway/src/types/transcript.ts` - Add `MessageEntry` type for JSON serialization
- `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx` - Add hydration from GET endpoint

## Task List

### Gateway Data Layer

#### Task Group 1: MessageEntry Type and Transcript Writer Extension
**Dependencies:** None

- [x] 1.0 Complete data model and transcript writer extension
  - [x] 1.1 Write 4-6 focused tests for conversation.json writing
    - Test `MessageEntry` type structure with lowercase role names
    - Test `writeConversationJson()` produces valid JSON array
    - Test atomic write pattern (temp file + rename) for JSON
    - Test `formatMessagesFromTranscript()` converts `TranscriptEntry[]` to `MessageEntry[]`
    - Test JSON file is written alongside `full-conversation.txt`
    - **Location:** `gateway/src/__tests__/conversation-json-writer.test.ts`
  - [x] 1.2 Define `MessageEntry` type in `gateway/src/types/transcript.ts`
    - Structure: `{ role: "system" | "user" | "assistant", phase: TranscriptPhase, content: string, timestamp: string }`
    - Uses lowercase role names for JSON serialization (differs from `TranscriptRole` uppercase)
    - Export from `gateway/src/types/index.ts`
  - [x] 1.3 Add `formatMessagesFromTranscript()` to `gateway/src/services/transcriptWriter.ts`
    - Converts `TranscriptEntry[]` to `MessageEntry[]`
    - Maps `TranscriptRole` to lowercase role: `SYSTEM` -> `"system"`, `USER` -> `"user"`, `ASSISTANT` -> `"assistant"`
    - Filters out `PLANNER_HANDOFF` and `ORCHESTRATION` entries (not needed for rehydration)
    - Preserves `phase`, `content`, and `timestamp` fields
  - [x] 1.4 Add `writeConversationJson()` function to `gateway/src/services/transcriptWriter.ts`
    - Accepts `messages: MessageEntry[]`, `basePath`, `folderName`
    - Writes to `<basePath>/conversations/<folderName>/conversation.json`
    - Uses same atomic write pattern (temp file + rename)
    - Non-blocking error handling (logs errors, never throws)
  - [x] 1.5 Extend `writeTranscriptToFile()` to also write `conversation.json`
    - After writing `full-conversation.txt`, call `writeConversationJson()`
    - Convert transcript entries using `formatMessagesFromTranscript()`
    - Both files written in same operation
  - [x] 1.6 Export new functions from `gateway/src/services/index.ts`
    - Export `formatMessagesFromTranscript`, `writeConversationJson`
  - [x] 1.7 Ensure data layer tests pass
    - Run ONLY the 4-6 tests written in 1.1
    - Verify `conversation.json` is written correctly

**Acceptance Criteria:**
- The tests written in 1.1 pass
- `MessageEntry` type correctly defined with lowercase role names
- `conversation.json` is written atomically alongside `full-conversation.txt`
- Errors are logged but do not fail the parent operation

---

### Gateway API Layer

#### Task Group 2: Implement Conversations Route (GET and PUT)
**Dependencies:** Task Group 1

- [x] 2.0 Complete implement conversations API endpoints
  - [x] 2.1 Write 6-8 focused tests for conversation endpoints
    - Test GET returns `{ exists: true, messages: [...] }` when file exists
    - Test GET returns `{ exists: false, messages: [] }` when file missing
    - Test GET handles unreadable file gracefully (returns exists: false)
    - Test GET validates required query parameters (projectId, featureId)
    - Test PUT writes `conversation.json` atomically
    - Test PUT writes `full-conversation.txt` using `formatTranscript()` pattern
    - Test PUT returns `{ success: false }` on write failure without throwing
    - Test PUT validates required body fields
    - **Location:** `gateway/src/__tests__/implement-conversations-route.test.ts`
  - [x] 2.2 Create `gateway/src/routes/implementConversations.ts`
    - Import express Router, fs/promises, path
    - Import `deriveFolderName`, `buildTranscriptPath` from transcriptWriter
    - Import `MessageEntry` from types
    - Define `CONVERSATION_JSON_FILENAME = 'conversation.json'`
  - [x] 2.3 Implement GET `/` endpoint
    - Accept query parameters: `projectId` (string, required), `featureId` (string, required)
    - Use `deriveFolderName()` to compute folder path (featureTitle not needed for GET - use empty string)
    - Read `conversation.json` from computed path
    - Return `{ exists: true, messages: MessageEntry[] }` on success
    - Return `{ exists: false, messages: [] }` if file not found or unreadable
    - Log errors but never fail the request
  - [x] 2.4 Implement PUT `/` endpoint
    - Request body: `{ projectId, featureId, projectParentFolder, featureTitle, messages: MessageEntry[] }`
    - Validate required fields, return 400 if missing
    - Use `deriveFolderName(featureTitle, featureId)` for folder
    - Use `buildTranscriptPath(projectParentFolder, folderName)` for paths
    - Write `conversation.json` atomically (temp file + rename)
    - Write `full-conversation.txt` using transcript format
    - Return `{ success: true }` on success
    - Return `{ success: false }` on failure (with logged error)
  - [x] 2.5 Add route export to `gateway/src/routes/index.ts`
    - Export `implementConversationsRouter` from `./implementConversations`
  - [x] 2.6 Mount route in `gateway/src/server.ts`
    - Import `implementConversationsRouter`
    - Mount at `/api/implement-conversations`
  - [x] 2.7 Ensure API layer tests pass
    - Run ONLY the 6-8 tests written in 2.1
    - Verify GET and PUT endpoints work correctly

**Acceptance Criteria:**
- The tests written in 2.1 pass
- GET endpoint returns correct response for existing/missing files
- PUT endpoint writes both JSON and text files atomically
- Graceful error handling - no request failures from file errors
- Route is mounted and accessible at `/api/implement-conversations`

---

### Frontend Layer

#### Task Group 3: API Client and Hydration Logic
**Dependencies:** Task Group 2 (completed)

- [x] 3.0 Complete frontend API client and hydration
  - [x] 3.1 Write 4-6 focused tests for frontend hydration
    - Test `getImplementConversation()` calls correct endpoint with query params
    - Test `putImplementConversation()` sends correct body to PUT endpoint
    - Test hydration useEffect calls GET on mount when messages empty
    - Test hydration sets `hasBootstrapped: true` when `exists: true`
    - Test hydration proceeds with bootstrap when `exists: false`
    - Test hydration checks context state before calling GET endpoint
    - **Location:** `frontend/src/__tests__/conversation-rehydration.test.ts`
  - [x] 3.2 Add `getImplementConversation()` to `frontend/src/api/chatApi.ts`
    - Signature: `getImplementConversation(projectId: string, featureId: string): Promise<{ exists: boolean, messages: MessageEntry[] }>`
    - Use `GATEWAY_BASE` constant for URL construction
    - Build URL: `${GATEWAY_BASE}/api/implement-conversations?projectId=${projectId}&featureId=${featureId}`
    - Return parsed JSON response
  - [x] 3.3 Add `putImplementConversation()` to `frontend/src/api/chatApi.ts`
    - Signature: `putImplementConversation(params: { projectId, featureId, projectParentFolder, featureTitle, messages }): Promise<{ success: boolean }>`
    - Use `GATEWAY_BASE` constant for URL construction
    - PUT to `${GATEWAY_BASE}/api/implement-conversations`
    - Send JSON body with all fields
    - Return parsed JSON response
  - [x] 3.4 Add `MessageEntry` type to `frontend/src/api/chatApi.ts`
    - Structure: `{ role: "system" | "user" | "assistant", phase: ImplementChatPhase, content: string, timestamp: string }`
    - Used by both `getImplementConversation` and `putImplementConversation`
  - [x] 3.5 Add hydration useEffect in `ImplementationAssistantPanel.tsx`
    - New useEffect hook that runs on mount
    - Check context state first using `getImplementChatState(projectKey, workItemId)`
    - If context state exists, use it (existing behavior)
    - If context state is empty and messages are empty, call `getImplementConversation(projectId, workItemId)`
    - If `exists: true`, convert `MessageEntry[]` to `ChatMessage[]` and hydrate state
    - Set `hasBootstrapped: true` when hydrating from disk
    - If `exists: false`, proceed with normal bootstrap flow
    - Hydration must happen BEFORE bootstrap trigger
  - [x] 3.6 Add `convertMessageEntryToChatMessage()` helper function
    - Converts `MessageEntry` to `ChatMessage` format used by UI
    - Maps role directly (both use lowercase)
    - Converts timestamp string to Date object
    - Generates unique ID for each message
  - [x] 3.7 Ensure frontend tests pass
    - Run ONLY the 4-6 tests written in 3.1
    - Verify API client and hydration work correctly

**Acceptance Criteria:**
- The tests written in 3.1 pass
- API client functions correctly call Gateway endpoints
- Hydration loads conversation from disk when context state is empty
- `hasBootstrapped` is set correctly to prevent duplicate bootstrap
- Existing in-memory context state takes precedence over disk

---

### Testing

#### Task Group 4: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-3

- [x] 4.0 Review existing tests and fill critical gaps only
  - [x] 4.1 Review tests from Task Groups 1-3
    - Review the 4-6 tests written by Task Group 1 (conversation JSON writer)
    - Review the 6-8 tests written by Task Group 2 (API endpoints)
    - Review the 4-6 tests written by Task Group 3 (frontend hydration)
    - Total existing tests: approximately 14-20 tests
  - [x] 4.2 Analyze test coverage gaps for THIS feature only
    - Identify critical end-to-end workflow gaps
    - Focus on: save on chat turn -> navigate away -> return -> hydrate flow
    - Verify error handling paths are covered
    - Check concurrent save scenarios (multiple rapid chat turns)
  - [x] 4.3 Write up to 6 additional strategic tests maximum
    - Test: full save-navigate-hydrate round trip
    - Test: hydration prefers context state over disk
    - Test: multiple features have separate conversation files
    - Test: corrupt JSON file handled gracefully on GET
    - Test: missing featureId returns 400 on PUT
    - Test: chat turn persistence writes both files
    - **Location:** `gateway/src/__tests__/conversation-persistence-e2e.test.ts`
  - [x] 4.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature
    - Expected total: approximately 20-26 tests maximum
    - Do NOT run the entire application test suite
    - Verify critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 20-26 tests total)
- Critical user workflows for conversation persistence are covered
- No more than 6 additional tests added when filling gaps
- Testing focused exclusively on this spec's feature requirements

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: MessageEntry Type and Transcript Writer Extension**
   - Foundation for persistence format
   - Extends existing transcriptWriter.ts
   - No dependencies on other task groups

2. **Task Group 2: Implement Conversations Route (GET and PUT)**
   - Depends on Task Group 1 for file reading/writing patterns
   - Provides backend API for frontend to call
   - New route file and server mounting

3. **Task Group 3: API Client and Hydration Logic**
   - Depends on Task Group 2 for backend endpoints
   - Frontend client and hydration useEffect
   - Integrates with existing ImplementationAssistantPanel

4. **Task Group 4: Test Review and Gap Analysis**
   - Final validation step
   - Reviews all prior tests
   - Fills critical integration gaps

---

## Files to Create

| File | Purpose |
|------|---------|
| `gateway/src/routes/implementConversations.ts` | GET and PUT endpoints for conversation persistence |
| `gateway/src/__tests__/conversation-json-writer.test.ts` | Tests for JSON file writing |
| `gateway/src/__tests__/implement-conversations-route.test.ts` | Tests for API endpoints |
| `gateway/src/__tests__/conversation-persistence-e2e.test.ts` | End-to-end integration tests |
| `frontend/src/__tests__/conversation-rehydration.test.ts` | Tests for frontend hydration |

## Files to Modify

| File | Change |
|------|--------|
| `gateway/src/types/transcript.ts` | Add `MessageEntry` interface |
| `gateway/src/types/index.ts` | Export `MessageEntry` type |
| `gateway/src/services/transcriptWriter.ts` | Add `formatMessagesFromTranscript()`, `writeConversationJson()`, extend `writeTranscriptToFile()` |
| `gateway/src/services/index.ts` | Export new transcriptWriter functions |
| `gateway/src/routes/index.ts` | Export `implementConversationsRouter` |
| `gateway/src/server.ts` | Mount `/api/implement-conversations` route |
| `frontend/src/api/chatApi.ts` | Add `MessageEntry`, `getImplementConversation()`, `putImplementConversation()` |
| `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx` | Add hydration useEffect, helper functions |

---

## Key Integration Points

### Gateway: chat.ts -> transcriptWriter.ts
- `flushTranscriptToDisk()` already calls `writeTranscriptToFile()` after each ASSISTANT entry
- `writeTranscriptToFile()` will be extended to also write `conversation.json`
- No changes needed to `chat.ts` - extension happens in `transcriptWriter.ts`

### Gateway: New Route -> Existing Infrastructure
- New `implementConversations.ts` route uses existing `deriveFolderName()` and `buildTranscriptPath()`
- Leverages existing atomic write pattern from `transcriptWriter.ts`
- Mounts in `server.ts` alongside existing routes

### Frontend: Hydration Order
1. Check `ProductUiStateContext` for in-memory state (tab switches)
2. If empty, call `GET /api/implement-conversations` (app restarts/navigation)
3. If `exists: true`, hydrate from disk and set `hasBootstrapped: true`
4. If `exists: false`, proceed with bootstrap phase (existing behavior)

### Data Flow: Chat Turn Persistence
1. User sends message -> Gateway receives request
2. Gateway appends USER and ASSISTANT entries to transcript store
3. `flushTranscriptToDisk()` called after ASSISTANT entry
4. `writeTranscriptToFile()` writes both `full-conversation.txt` AND `conversation.json`
5. Both files available for later rehydration

---

## Error Handling Behavior

- **GET endpoint failures**: Return `{ exists: false, messages: [] }` - never expose errors to frontend
- **PUT endpoint failures**: Return `{ success: false }` - log error server-side
- **File read errors**: Graceful degradation - treat as missing file
- **File write errors**: Log and continue - do not fail the chat request
- **Corrupt JSON**: Treat as missing file on read, overwrite on write

---

## Out of Scope

Per spec requirements, the following are explicitly out of scope:
- Multi-user synchronization or concurrent editing
- UI for browsing all conversations
- Database-backed storage (file-based only)
- Changes to architecture-model-service
- Changes to LLM prompts
- Migration of existing conversations
- Compression/archival of old conversations
- Encryption at rest
- Search/filtering functionality
- Export to PDF or other formats
