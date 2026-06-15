# Task Breakdown: Fix Implement Assistant Conversation Persistence

## Overview
Total Tasks: 4 Task Groups with approximately 20 sub-tasks

This spec fixes the existing conversation persistence mechanism so that implement_feature transcripts are written to the active project's parent folder after every chat turn (not just during orchestration).

## Task List

### Gateway Types Layer

#### Task Group 1: Extend Chat Types with Persistence Metadata
**Dependencies:** None

- [x] 1.0 Complete Gateway types extension for persistence metadata
  - [x] 1.1 Write 3-5 focused tests for ChatContext persistence fields
    - Test that `ChatContext` accepts `projectParentFolder` as optional string
    - Test that `ChatContext` accepts `featureId` as optional string
    - Test that `ChatContext` accepts `featureTitle` as optional string
    - Test backward compatibility: existing requests without new fields still work
  - [x] 1.2 Extend `ChatContext` interface in `gateway/src/types/chat.ts`
    - Add `projectParentFolder?: string` - absolute path to project's parent folder
    - Add `featureId?: string` - work item unique identifier
    - Add `featureTitle?: string` - work item title for folder naming
    - Add JSDoc comments explaining these are REQUIRED for mode=implement_feature persistence
  - [x] 1.3 Ensure Gateway types tests pass
    - Run ONLY the 3-5 tests written in 1.1
    - Verify TypeScript compilation succeeds

**Acceptance Criteria:**
- The 3-5 tests written in 1.1 pass
- `ChatContext` interface includes all three new optional fields
- TypeScript compilation succeeds
- Existing code continues to compile without changes

**Files to modify:**
- `gateway/src/types/chat.ts` (lines 71-113: ChatContext interface)

---

### Gateway Services Layer

#### Task Group 2: Update Transcript Writer for Project Parent Folder
**Dependencies:** Task Group 1

- [x] 2.0 Complete transcript writer modifications
  - [x] 2.1 Write 4-6 focused tests for `writeTranscriptToFile` with projectParentFolder
    - Test that `writeTranscriptToFile` uses `projectParentFolder` as base path when provided
    - Test that `writeTranscriptToFile` falls back to `config.conversationPersistBasePath` when `projectParentFolder` is not provided
    - Test that `deriveFolderName` uses `featureId` prefix instead of `sessionId` suffix when provided
    - Test folder name construction: `<sanitized_title>-<featureId_prefix>` format
    - Test atomic write behavior preserved (temp file then rename)
  - [x] 2.2 Modify `deriveFolderName` function signature in `gateway/src/services/transcriptWriter.ts`
    - Change from `deriveFolderName(workItemTitle: string, sessionId: string)`
    - To `deriveFolderName(workItemTitle: string, featureId: string)`
    - Use `featureId` (first 8 chars) as suffix instead of `sessionId`
    - This makes folder names deterministic across sessions for the same feature
  - [x] 2.3 Modify `writeTranscriptToFile` function signature
    - Change from `writeTranscriptToFile(transcript, workItemTitle)`
    - To `writeTranscriptToFile(transcript, workItemTitle, featureId, projectParentFolder?)`
    - Add `featureId: string` parameter (required)
    - Add `projectParentFolder?: string` parameter (optional)
  - [x] 2.4 Implement projectParentFolder path resolution
    - If `projectParentFolder` is provided and non-empty, use it as base path
    - Otherwise fall back to `config.conversationPersistBasePath`
    - Update `buildTranscriptPath` call to use the resolved base path
  - [x] 2.5 Update error logging to include new parameters
    - Log `featureId` in all error scenarios
    - Log `projectParentFolder` (or "not provided") in all error scenarios
    - Existing: already logs `sessionId` and error messages
  - [x] 2.6 Ensure transcript writer tests pass
    - Run ONLY the 4-6 tests written in 2.1
    - Verify all path resolution logic works correctly

**Acceptance Criteria:**
- The 4-6 tests written in 2.1 pass
- `deriveFolderName` uses `featureId` for deterministic folder naming
- `writeTranscriptToFile` accepts and uses `projectParentFolder` parameter
- Fallback to config base path works when `projectParentFolder` not provided
- Error logs include `featureId` and `projectParentFolder` for debugging

**Files to modify:**
- `gateway/src/services/transcriptWriter.ts` (lines 18-36: deriveFolderName, lines 69-103: writeTranscriptToFile)

---

### Gateway Routes Layer

#### Task Group 3: Flush Transcript After Every Chat Turn
**Dependencies:** Task Group 2

- [x] 3.0 Complete chat route transcript flushing
  - [x] 3.1 Write 4-6 focused tests for POST /api/chat transcript flushing
    - Test that transcript is written to disk after ASSISTANT entry for mode=implement_feature
    - Test that transcript is NOT written for mode=oas_assistant (no persistence for OAS mode)
    - Test that missing `projectParentFolder` logs warning but chat succeeds
    - Test that missing `featureId` or `featureTitle` logs warning but chat succeeds
    - Test that filesystem errors do not cause chat request to fail
  - [x] 3.2 Add transcript flush after ASSISTANT entry in `gateway/src/routes/chat.ts`
    - After `appendTranscriptEntry(effectiveSessionId, 'ASSISTANT', phase, ...)` (around line 322)
    - Call `getTranscript(effectiveSessionId)` to retrieve full transcript
    - Call `writeTranscriptToFile(transcript, featureTitle, featureId, projectParentFolder)`
    - Extract `featureId`, `featureTitle`, `projectParentFolder` from `context`
  - [x] 3.3 Implement persistence metadata validation and warning logging
    - Check if `context?.mode === 'implement_feature'` before attempting persistence
    - If `featureId`, `featureTitle`, or `projectParentFolder` are missing:
      - Log warning: "Transcript persistence skipped: missing required fields"
      - Include which fields are missing in log
      - Continue with chat response (do not fail)
  - [x] 3.4 Wrap writeTranscriptToFile in try/catch with error logging
    - Catch any filesystem errors from `writeTranscriptToFile`
    - Log error with: `sessionId`, `featureId`, `projectParentFolder`, error message
    - Do NOT throw or fail the chat request
    - Return chat response normally
  - [x] 3.5 Import `writeTranscriptToFile` in chat.ts
    - Add import: `import { writeTranscriptToFile } from '../services/transcriptWriter';`
    - Ensure `getTranscript` is already imported from services (it is)
  - [x] 3.6 Ensure chat route tests pass
    - Run ONLY the 4-6 tests written in 3.1
    - Verify chat responses work correctly
    - Verify transcript flushing occurs at correct point

**Acceptance Criteria:**
- The 4-6 tests written in 3.1 pass
- Transcript is flushed to disk after every ASSISTANT response in implement_feature mode
- Missing persistence metadata logs warning but does not fail chat
- Filesystem errors are caught and logged but do not fail chat
- Chat response is returned normally in all scenarios

**Files to modify:**
- `gateway/src/routes/chat.ts` (after line 322, add transcript flush logic)

---

#### Task Group 4: Update Orchestration Route for Consistency
**Dependencies:** Task Group 2

- [x] 4.0 Complete orchestration route transcript consistency
  - [x] 4.1 Write 3-4 focused tests for orchestration route persistence
    - Test that orchestration route accepts `projectParentFolder` in request body
    - Test that orchestration uses `projectParentFolder` when calling `writeTranscriptToFile`
    - Test that orchestration falls back correctly when `projectParentFolder` not provided
  - [x] 4.2 Extend `ExecuteOrchestrationRequest` interface in `gateway/src/routes/orchestrations.ts`
    - Add `projectParentFolder?: string` to the request interface (line 48-54)
    - This is optional to maintain backward compatibility
  - [x] 4.3 Update `writeTranscriptToFile` call in orchestration route
    - Current call at line 159: `writeTranscriptToFile(transcript, body.featureTitle)`
    - Change to: `writeTranscriptToFile(transcript, body.featureTitle, body.featureId, body.projectParentFolder)`
    - Pass `featureId` and `projectParentFolder` from request body
  - [x] 4.4 Ensure orchestration route tests pass
    - Run ONLY the 3-4 tests written in 4.1
    - Verify orchestration persistence works with new parameters

**Acceptance Criteria:**
- The 3-4 tests written in 4.1 pass
- Orchestration route accepts `projectParentFolder` in request
- Orchestration writes to same location as chat route for same feature
- Backward compatibility maintained (missing projectParentFolder uses fallback)

**Files to modify:**
- `gateway/src/routes/orchestrations.ts` (lines 48-54: ExecuteOrchestrationRequest, line 159: writeTranscriptToFile call)

---

### Frontend Layer

#### Task Group 5: Send Persistence Metadata with Chat Requests
**Dependencies:** Task Groups 1-4 (Gateway must be ready)

- [x] 5.0 Complete frontend persistence metadata integration
  - [x] 5.1 Write 4-6 focused tests for frontend persistence metadata
    - Test that `ImplementChatContext` includes `projectParentFolder` field
    - Test that `ImplementChatContext` includes `featureId` field
    - Test that `ImplementChatContext` includes `featureTitle` field
    - Test that `buildContext()` populates all persistence fields
    - Test that chat requests include persistence metadata
  - [x] 5.2 Extend `ImplementChatContext` interface in `frontend/src/api/chatApi.ts`
    - Add `projectParentFolder?: string` - absolute path to project parent folder
    - Add `featureId?: string` - work item ID for folder naming
    - Add `featureTitle?: string` - work item title for folder naming
    - These are optional to maintain backward compatibility during rollout
  - [x] 5.3 Obtain `projectParentFolder` from project metadata
    - Implemented using `useProject()` hook from ProjectContext
    - Access `activeProject?.projectParentFolder` for the project's parent folder
  - [x] 5.4 Update `buildContext()` in `ImplementationAssistantPanel.tsx`
    - Current function at lines 266-289
    - Add `projectParentFolder` to returned context object
    - Add `featureId: workItemId` to returned context object
    - Add `featureTitle: workItemTitle` to returned context object
    - `workItemId` and `workItemTitle` already available as props
  - [x] 5.5 Verify persistence metadata flows through all chat paths
    - Check `handleSend()` passes context with persistence fields
    - Check `handleImplement()` passes context with persistence fields
    - Check `triggerBootstrap()` passes context with persistence fields
  - [x] 5.6 Ensure frontend tests pass
    - Run ONLY the 4-6 tests written in 5.1
    - Verify TypeScript compilation succeeds
    - Verify chat requests include new fields

**Acceptance Criteria:**
- The 4-6 tests written in 5.1 pass
- `ImplementChatContext` interface includes persistence fields
- `buildContext()` populates all persistence metadata fields
- All chat request paths include persistence metadata
- TypeScript compilation succeeds

**Files to modify:**
- `frontend/src/api/chatApi.ts` (lines 67-93: ImplementChatContext interface)
- `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx` (lines 266-289: buildContext function)
- `frontend/src/api/orchestrationApi.ts` (added sessionId and projectParentFolder to request)

---

### Integration Testing

#### Task Group 6: End-to-End Verification
**Dependencies:** Task Groups 1-5

- [x] 6.0 Complete end-to-end integration verification
  - [x] 6.1 Write 3-5 integration tests for full persistence flow
    - Test: Send bootstrap message -> verify transcript file created in projectParentFolder
    - Test: Send refine message -> verify transcript file updated with new entries
    - Test: Send handoff message -> verify transcript includes handoff content
    - Test: Execute orchestration -> verify orchestration entry appended to same file
    - Test: Missing projectParentFolder -> verify chat works and warning logged
  - [x] 6.2 Verify folder structure matches specification
    - Path: `<projectParentFolder>/conversations/<feature_name_and_id>/full-conversation.txt`
    - Folder name format: `<sanitized_title>-<featureId_prefix>` (e.g., `add-user-login-feat123`)
    - Verify folder name is filesystem-safe: lowercase, hyphens, no special chars
  - [x] 6.3 Verify file content format
    - Check header: "=== IMPLEMENT ASSISTANT CONVERSATION TRANSCRIPT ==="
    - Check each entry has: timestamp, phase, role marker, content
    - Check entries in chronological order: SYSTEM, USER, ASSISTANT
    - Check file is UTF-8 plain text
  - [x] 6.4 Verify atomic write behavior
    - Check that temp file is created first
    - Check that final file appears atomically (no partial writes visible)
    - Check that interrupted writes do not corrupt existing file
  - [x] 6.5 Run all feature-specific tests
    - Run tests from Task Groups 1-5 plus integration tests from 6.1
    - Expected total: approximately 20-30 tests
    - Verify all tests pass

**Acceptance Criteria:**
- All integration tests pass
- Transcript files created in correct location under projectParentFolder
- File format is human-readable and includes all required fields
- Chat functionality works correctly with and without persistence
- Orchestration appends to same transcript file

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Gateway Types** - Extend ChatContext with persistence fields (no dependencies)
2. **Task Group 2: Gateway Services** - Update transcriptWriter for new parameters (depends on 1)
3. **Task Group 3: Gateway Chat Route** - Add transcript flush after every chat turn (depends on 2)
4. **Task Group 4: Gateway Orchestration Route** - Update for consistency (depends on 2, parallel with 3)
5. **Task Group 5: Frontend** - Send persistence metadata with requests (depends on 1-4)
6. **Task Group 6: Integration Testing** - End-to-end verification (depends on all)

**Parallel Execution Opportunities:**
- Task Groups 3 and 4 can be implemented in parallel (both depend on 2)
- Task Group 5 frontend work can start after Task Group 1 types are complete, with full testing after Gateway work

---

## Key Code References

| File | Current State | Required Changes |
|------|---------------|------------------|
| `gateway/src/types/chat.ts` | ChatContext at lines 71-113 | Add 3 new optional fields |
| `gateway/src/services/transcriptWriter.ts` | deriveFolderName uses sessionId | Change to use featureId |
| `gateway/src/services/transcriptWriter.ts` | writeTranscriptToFile uses config base path | Add projectParentFolder param |
| `gateway/src/routes/chat.ts` | appendTranscriptEntry at line 322 | Add writeTranscriptToFile call after |
| `gateway/src/routes/orchestrations.ts` | writeTranscriptToFile at line 159 | Pass featureId and projectParentFolder |
| `frontend/src/api/chatApi.ts` | ImplementChatContext at lines 67-93 | Add 3 new optional fields |
| `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx` | buildContext at lines 266-289 | Add persistence metadata |

---

## Risk Areas and Considerations

1. **projectParentFolder Sourcing**: The spec requires frontend to send the project's parent folder path. Need to verify how project metadata (including parent folder) is accessed in the frontend.

2. **Path Handling**: Windows vs Unix path separators. Ensure `path.join` is used consistently for cross-platform compatibility.

3. **Atomic Writes on Windows**: The temp-file-then-rename approach should work on Windows, but verify that `fs.rename` behaves atomically across the filesystem.

4. **Error Resilience**: All write errors must be caught and logged without failing the chat request. Verify error handling is comprehensive.

5. **Backward Compatibility**: New fields are optional in interfaces. Verify existing code continues to work without changes.

---

## Implementation Summary

All 6 Task Groups have been successfully implemented:

**Test Files Created:**
- `gateway/src/__tests__/chat-context-persistence-fields.test.ts` (6 tests)
- `gateway/src/__tests__/transcript-writer-persistence.test.ts` (12 tests)
- `gateway/src/__tests__/chat-transcript-flushing.test.ts` (6 tests)
- `gateway/src/__tests__/orchestration-persistence.test.ts` (4 tests)
- `gateway/src/__tests__/persistence-e2e.test.ts` (10 tests)
- `frontend/src/__tests__/frontend-persistence-metadata.test.ts` (6 tests)

**Total Tests: 57 tests passing**

**Files Modified:**
- `gateway/src/types/chat.ts` - Added projectParentFolder, featureId, featureTitle to ChatContext
- `gateway/src/services/transcriptWriter.ts` - Updated deriveFolderName to use featureId, added projectParentFolder parameter
- `gateway/src/routes/chat.ts` - Added flushTranscriptToDisk function after ASSISTANT entry
- `gateway/src/routes/orchestrations.ts` - Added projectParentFolder to request and writeTranscriptToFile call
- `frontend/src/api/chatApi.ts` - Added persistence fields to ImplementChatContext
- `frontend/src/api/orchestrationApi.ts` - Added sessionId and projectParentFolder to request
- `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx` - Updated buildContext and handleExecute with persistence metadata
