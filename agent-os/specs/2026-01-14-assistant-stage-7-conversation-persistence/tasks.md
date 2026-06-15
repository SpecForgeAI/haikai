# Task Breakdown: Implement Assistant Stage 7 - Full Conversation and Execution Persistence to Disk

## Overview
Total Tasks: 28 (across 5 task groups)
**Status: COMPLETE - All tasks verified implemented**

This feature adds full conversation and execution persistence for Implement Assistant sessions. It captures all system prompts, user messages, assistant responses, handoff plans, and orchestration execution details into a human-readable file on disk.

## Implementation Status Summary

Based on code review, this feature has been **fully implemented** in the codebase. All core components exist and are integrated:

| Component | File | Status |
|-----------|------|--------|
| Type Definitions | `gateway/src/types/transcript.ts` | Complete |
| In-Memory Store | `gateway/src/services/transcriptStore.ts` | Complete |
| Transcript Writer | `gateway/src/services/transcriptWriter.ts` | Complete |
| Chat Route Integration | `gateway/src/routes/chat.ts` | Complete |
| Orchestrations Route Integration | `gateway/src/routes/orchestrations.ts` | Complete |
| Config Support | `gateway/src/config.ts` | Complete |
| Service Exports | `gateway/src/services/index.ts` | Complete |
| Unit Tests | `gateway/src/__tests__/transcript-*.test.ts` | Complete |

## Key Files Modified/Created

**New Files:**
- `gateway/src/services/transcriptStore.ts` - In-memory transcript buffer storage
- `gateway/src/services/transcriptWriter.ts` - Filesystem write logic
- `gateway/src/types/transcript.ts` - Type definitions for transcript entries
- `gateway/src/__tests__/transcript-store.test.ts` - Unit tests for transcript store
- `gateway/src/__tests__/transcript-writer.test.ts` - Unit tests for transcript writer
- `gateway/src/__tests__/transcript-chat-integration.test.ts` - Chat route integration tests
- `gateway/src/__tests__/transcript-orchestration-integration.test.ts` - Orchestration route integration tests
- `gateway/src/__tests__/transcript-e2e.test.ts` - End-to-end integration tests

**Files Modified:**
- `gateway/src/config.ts` - Added CONVERSATION_PERSIST_BASE_PATH config
- `gateway/src/routes/chat.ts` - Insert transcript appending calls
- `gateway/src/routes/orchestrations.ts` - Insert orchestration entry and trigger file write
- `gateway/src/services/index.ts` - Export transcript functions
- `gateway/src/types/index.ts` - Re-export TranscriptPhase type

## Task List

### Data Layer

#### Task Group 1: Transcript Types and In-Memory Store
**Dependencies:** None
**Status: COMPLETE**

- [x] 1.0 Complete transcript data layer
  - [x] 1.1 Write 4-6 focused tests for transcript store functionality
    - Test TranscriptEntry type structure validation
    - Test transcript buffer initialization for new session
    - Test appending entries to existing buffer
    - Test buffer retrieval by sessionId
    - Test buffer cleanup on session expiry
    - Test getOrCreate pattern returns existing buffer
    - **Location:** `gateway/src/__tests__/transcript-store.test.ts` (12 tests)
  - [x] 1.2 Create transcript types in `gateway/src/types/transcript.ts`
    - Define `TranscriptRole` type: 'SYSTEM' | 'USER' | 'ASSISTANT' | 'PLANNER_HANDOFF' | 'ORCHESTRATION' (lines 23-28)
    - Define `TranscriptPhase` type: 'bootstrap' | 'refine' | 'handoff' (line 40)
    - Define `TranscriptEntry` interface with: timestamp (ISO-8601), phase, role, content (lines 51-60)
    - Define `ConversationTranscript` interface with: sessionId, entries array, createdAt (lines 71-78)
    - Export types from `gateway/src/types/index.ts`
  - [x] 1.3 Create transcript store in `gateway/src/services/transcriptStore.ts`
    - Follow `InMemorySessionStore` class pattern from `sessionStore.ts`
    - Create `InMemoryTranscriptStore` class with Map<string, ConversationTranscript> (lines 28-186)
    - Implement `get(sessionId)` method returning transcript or null (lines 37-52)
    - Implement `getOrCreate(sessionId)` method with lazy initialization (lines 59-73)
    - Implement `appendEntry(sessionId, entry)` method (lines 81-90)
    - Implement `delete(sessionId)` method (lines 97-103)
    - Implement `cleanup()` method using same TTL as session store (lines 109-133)
    - Start cleanup interval on module load (match session store pattern)
  - [x] 1.4 Add helper functions to transcript store
    - Create `initializeTranscript(sessionId)` function (lines 200-202)
    - Create `getTranscript(sessionId)` function (lines 209-211)
    - Create `appendTranscriptEntry(sessionId, role, phase, content)` function (lines 221-234)
    - Create `deleteTranscript(sessionId)` function (lines 241-243)
    - Export all functions from `gateway/src/services/index.ts` (lines 64-76)
  - [x] 1.5 Ensure transcript store tests pass
    - All 12 tests in transcript-store.test.ts pass

**Acceptance Criteria:**
- [x] The tests written in 1.1 pass
- [x] TranscriptEntry and ConversationTranscript types are properly defined
- [x] Transcript store follows same patterns as sessionStore.ts
- [x] Buffer cleanup matches session TTL timing


### Chat Route Integration

#### Task Group 2: Chat Route Transcript Appending
**Dependencies:** Task Group 1
**Status: COMPLETE**

- [x] 2.0 Complete chat route integration
  - [x] 2.1 Write 4-6 focused tests for chat route transcript appending
    - Test SYSTEM entry appended when system prompt is built (mode=implement_feature)
    - Test USER entry appended when user message is received (mode=implement_feature)
    - Test ASSISTANT entry appended when LLM response is returned (mode=implement_feature)
    - Test phase value is included in every entry
    - Test no entries appended when mode is NOT implement_feature
    - Test PLANNER_HANDOFF entry appended on successful handoff validation
    - **Location:** `gateway/src/__tests__/transcript-chat-integration.test.ts` (6 tests)
  - [x] 2.2 Add transcript appending for system prompt in chat.ts
    - Import transcript store functions
    - After `buildSystemPrompt()` call, append SYSTEM entry (lines 200-205)
    - Only append when `context?.mode === 'implement_feature'`
    - Include phase from `context.phase` (default to 'refine' if absent)
    - Content is the full system prompt string
  - [x] 2.3 Add transcript appending for user message in chat.ts
    - After receiving user message from request body
    - Append USER entry with message content (lines 211-216)
    - Only append when `context?.mode === 'implement_feature'`
    - Include phase from `context.phase`
  - [x] 2.4 Add transcript appending for assistant response in chat.ts
    - After `sendChatRequest()` returns
    - Append ASSISTANT entry with response.content (lines 318-323)
    - Only append when `context?.mode === 'implement_feature'`
    - Include phase from `context.phase`
  - [x] 2.5 Add transcript appending for handoff plan in chat.ts
    - After handoff validation succeeds
    - Append PLANNER_HANDOFF entry (lines 426-431)
    - Content is full HandoffPlanResponse JSON with 2-space indentation
    - Only append when phase === 'handoff' and validation succeeded
  - [x] 2.6 Add helper functions for transcript mode checking
    - `shouldAppendToTranscript(context)` - checks mode === 'implement_feature' (lines 72-74)
    - `getTranscriptPhase(context)` - returns phase or defaults to 'refine' (lines 84-86)
  - [x] 2.7 Ensure chat route integration tests pass
    - All 6 tests in transcript-chat-integration.test.ts pass

**Acceptance Criteria:**
- [x] The tests written in 2.1 pass
- [x] Transcript entries are appended at correct points in chat flow
- [x] Entries are only created for mode=implement_feature
- [x] Phase is correctly captured in each entry
- [x] Handoff plan JSON is properly formatted


### Orchestration Route Integration

#### Task Group 3: Orchestration Entry and File Write Trigger
**Dependencies:** Task Groups 1, 2
**Status: COMPLETE**

- [x] 3.0 Complete orchestration route integration
  - [x] 3.1 Write 4-6 focused tests for orchestration integration
    - Test ORCHESTRATION entry appended with correct metadata (endpoint, company, project, count, timestamp)
    - Test response data included in entry (status code, body)
    - Test response body truncated to 8000 chars with "[TRUNCATED]" marker
    - Test file write triggered after orchestration completes
    - Test sessionId passed through request body
    - Test no entry appended when sessionId not provided
    - **Location:** `gateway/src/__tests__/transcript-orchestration-integration.test.ts` (6 tests)
  - [x] 3.2 Update orchestrations request type to include sessionId
    - Add optional `sessionId` field to `ExecuteOrchestrationRequest` interface (line 49)
    - SessionId used to look up transcript buffer
  - [x] 3.3 Implement helper functions for orchestration entry
    - `truncateContent(content, maxLength)` - truncates to 8000 chars with [TRUNCATED] marker (lines 18-23)
    - `buildOrchestrationEntryContent(project, count, result)` - builds structured JSON entry (lines 25-47)
  - [x] 3.4 Add transcript appending for orchestration execution
    - After `executeOrchestration()` returns (lines 149-155)
    - Append ORCHESTRATION entry with structured content
    - Only append if sessionId is provided in request body
    - Content includes: endpoint path, company, project, feature_descriptions_count, timestamp, response
  - [x] 3.5 Trigger file write after orchestration completes
    - Call `writeTranscriptToFile` after appending orchestration entry (lines 157-166)
    - Pass transcript and featureTitle for folder name derivation
    - Handle errors gracefully (catch and log, don't throw)
  - [x] 3.6 Ensure orchestration integration tests pass
    - All 6 tests in transcript-orchestration-integration.test.ts pass

**Acceptance Criteria:**
- [x] The tests written in 3.1 pass
- [x] Orchestration entry contains all required metadata
- [x] Response body is properly truncated when over 8000 chars
- [x] File write is triggered on orchestration completion


### Filesystem Write Layer

#### Task Group 4: Transcript Writer and Configuration
**Dependencies:** Task Groups 1, 2, 3
**Status: COMPLETE**

- [x] 4.0 Complete filesystem write layer
  - [x] 4.1 Write 4-6 focused tests for transcript writer
    - Test folder name derivation (lowercase, hyphens, special chars removed, sessionId suffix)
    - Test file path construction: `<base>/conversations/<feature_name_and_id>/full-conversation.txt`
    - Test atomic write pattern (temp file + rename)
    - Test human-readable format with section headers and role markers
    - Test non-blocking error handling (errors logged, not thrown)
    - Test partial persistence logging when rename fails
    - **Location:** `gateway/src/__tests__/transcript-writer.test.ts` (12 tests)
  - [x] 4.2 Add configuration for persistence base path
    - Add `conversationPersistBasePath` field to Config interface in `config.ts` (line 28)
    - Parse from `CONVERSATION_PERSIST_BASE_PATH` environment variable (line 131)
    - Default to process.cwd() if not specified
  - [x] 4.3 Create transcript writer in `gateway/src/services/transcriptWriter.ts`
    - Import fs/promises for async file operations
    - Import path for path manipulation
    - Import getConfig for base path
    - Import logger for error logging
  - [x] 4.4 Implement folder name derivation function
    - Create `deriveFolderName(workItemTitle: string, sessionId: string): string` (lines 18-36)
    - Convert title to lowercase
    - Replace spaces with hyphens
    - Remove special characters (keep alphanumeric and hyphens only)
    - Collapse multiple hyphens into one
    - Truncate to 50 chars before suffix
    - Append first 8 characters of sessionId as suffix
    - Fallback to "conversation-{sessionId_prefix}" if title empty or sanitizes to empty
  - [x] 4.5 Implement file path construction
    - Create `buildTranscriptPath(basePath: string, folderName: string)` (lines 38-42)
    - Returns object with dirPath and filePath
    - Construct: `<basePath>/conversations/<folderName>/full-conversation.txt`
  - [x] 4.6 Implement human-readable format builder
    - Create `formatTranscript(transcript: ConversationTranscript): string` (lines 44-67)
    - Begin with header: `=== IMPLEMENT ASSISTANT CONVERSATION TRANSCRIPT ===`
    - Add Generated timestamp, Session ID, Created timestamp
    - Add clear section label before PLANNER_HANDOFF: `=== FINAL HANDOFF PLAN (PLANNER OUTPUT) ===`
    - Add clear section label before ORCHESTRATION: `=== ORCHESTRATION EXECUTION ===`
    - Format entries with: `--- [ROLE] (phase: <phase>) @ <timestamp> ---`
    - Use blank lines between entries for readability
  - [x] 4.7 Implement atomic file write function
    - Create `writeTranscriptToFile(transcript, workItemTitle): Promise<void>` (lines 69-103)
    - Derive folder name using deriveFolderName()
    - Build file path using buildTranscriptPath()
    - Format transcript content using formatTranscript()
    - Create directory with recursive: true option
    - Write to temp file with .tmp suffix
    - Rename temp file to final path
    - All operations wrapped in try-catch (non-blocking)
    - Log success with full path and sessionId
    - On directory creation failure: warn, skip write
    - On write failure: error log, return gracefully
    - On rename failure: log as "Partial persistence"
  - [x] 4.8 Export transcript writer functions from services index
    - Export writeTranscriptToFile, deriveFolderName, buildTranscriptPath, formatTranscript (lines 79-84)
  - [x] 4.9 Ensure filesystem write layer tests pass
    - All 12 tests in transcript-writer.test.ts pass

**Acceptance Criteria:**
- [x] The tests written in 4.1 pass
- [x] Configuration value is properly loaded from environment
- [x] Folder name derivation handles edge cases correctly
- [x] File format is human-readable with clear section markers
- [x] Atomic write pattern prevents partial file corruption
- [x] All errors are logged but never block response


### Testing

#### Task Group 5: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-4
**Status: COMPLETE**

- [x] 5.0 Review existing tests and fill critical gaps only
  - [x] 5.1 Review tests from Task Groups 1-4
    - Review the 12 tests written by Task Group 1 (transcript store)
    - Review the 6 tests written by Task Group 2 (chat route integration)
    - Review the 6 tests written by Task Group 3 (orchestration integration)
    - Review the 12 tests written by Task Group 4 (filesystem write)
    - Total existing tests: 36 tests
  - [x] 5.2 Analyze test coverage gaps for THIS feature only
    - Identify critical end-to-end workflow gaps
    - Focus on: bootstrap -> refine -> handoff -> orchestration -> file write flow
    - Verify transcript cleanup on session expiry is tested
    - Verify concurrent session handling
  - [x] 5.3 Write additional strategic tests
    - **Location:** `gateway/src/__tests__/transcript-e2e.test.ts` (6 tests)
    - Test: full conversation flow produces file
    - Test: transcript cleanup on session delete
    - Test: multiple sessions produce separate transcript files
    - Test: handling very large assistant responses (no truncation in transcript)
    - Test: orchestration fails but file still written
  - [x] 5.4 Run feature-specific tests only
    - Total tests: 42 tests across 5 test files
    - All feature-specific tests pass

**Acceptance Criteria:**
- [x] All feature-specific tests pass (42 tests total)
- [x] Critical user workflows for conversation persistence are covered
- [x] Testing focused exclusively on this spec's feature requirements


## Execution Order

Implementation was completed in this sequence:

1. **Task Group 1: Transcript Types and In-Memory Store**
   - Foundation for all other work
   - No external dependencies
   - Creates types and storage mechanism

2. **Task Group 4: Filesystem Write Layer** (partial - configuration)
   - Add conversationPersistBasePath config early

3. **Task Group 2: Chat Route Transcript Appending**
   - Depends on Task Group 1 for transcript store
   - Captures system prompts, user messages, assistant responses
   - Integrates with existing chat.ts flow

4. **Task Group 3: Orchestration Entry and File Write Trigger**
   - Depends on Task Groups 1-2
   - Captures orchestration execution details
   - Triggers file write

5. **Task Group 4: Filesystem Write Layer** (complete)
   - Implements formatting and atomic write
   - Called by Task Group 3 to complete persistence

6. **Task Group 5: Test Review and Gap Analysis**
   - Final validation step
   - Reviews all prior tests
   - Fills critical integration gaps


## Verification Checklist

### Functional Verification
- [x] Transcript types correctly defined with all required fields
- [x] In-memory store provides O(1) access and TTL-based cleanup
- [x] Chat route appends SYSTEM, USER, ASSISTANT entries for implement_feature mode
- [x] Chat route appends PLANNER_HANDOFF entry on successful handoff validation
- [x] Orchestrations route appends ORCHESTRATION entry with metadata
- [x] Orchestrations route triggers file write after completion
- [x] File written to correct path: `{basePath}/conversations/{folderName}/full-conversation.txt`
- [x] Atomic write pattern used (temp file + rename)
- [x] Errors do not block execution or propagate to frontend

### File Format Verification
The generated `full-conversation.txt` file contains:
- [x] Header: "=== IMPLEMENT ASSISTANT CONVERSATION TRANSCRIPT ==="
- [x] Metadata: Generated timestamp, Session ID, Created timestamp
- [x] Role markers: `--- [ROLE] (phase: phase_value) @ timestamp ---`
- [x] Section header before PLANNER_HANDOFF: "=== FINAL HANDOFF PLAN (PLANNER OUTPUT) ==="
- [x] Section header before ORCHESTRATION: "=== ORCHESTRATION EXECUTION ==="
- [x] Blank lines between entries for readability

### Error Handling Verification
- [x] Directory creation failure: logged as warning, file write skipped
- [x] File write failure: logged as error, returns gracefully
- [x] Rename failure: logged as "Partial persistence" error
- [x] All errors wrapped in try-catch to prevent propagation


## Notes

### Patterns Followed
- **Session Store Pattern**: Transcript store follows `gateway/src/services/sessionStore.ts` for in-memory storage
- **Conversation Service Pattern**: Follows `gateway/src/services/conversation.ts` for non-blocking persistence
- **Logging Pattern**: Uses `logger` from services with sessionId context
- **Config Pattern**: Follows existing config.ts for new environment variables

### Key Integration Points
- `chat.ts` lines 200-205: After `buildSystemPrompt()` - append SYSTEM entry
- `chat.ts` lines 211-216: After receiving message - append USER entry
- `chat.ts` lines 318-323: After `sendChatRequest()` - append ASSISTANT entry
- `chat.ts` lines 426-431: After handoff validation - append PLANNER_HANDOFF entry
- `orchestrations.ts` lines 149-155: After `executeOrchestration()` - append ORCHESTRATION entry
- `orchestrations.ts` lines 157-166: Trigger file write

### Error Handling Behavior
- All filesystem operations wrapped in try-catch
- Errors logged but never thrown to block orchestration response
- Partial persistence (temp file exists but rename failed) explicitly logged

### Out of Scope (Not Implemented)
- UI for browsing or replaying persisted conversations
- Database-backed conversation storage
- Job polling or status tracking persistence
- Regeneration or re-execution from persisted files
- Frontend changes of any kind
- Streaming endpoint support (GET /api/chat/stream)
- Persisting oas_assistant mode conversations
- Compression or archiving of conversation files
- Retention policy or automatic cleanup of old conversation files
- Multi-tenant isolation or access control for conversation files
