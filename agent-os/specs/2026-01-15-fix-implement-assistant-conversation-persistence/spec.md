# Specification: Fix Implement Assistant Conversation Persistence

## Goal

Fix the existing conversation persistence mechanism so that implement_feature transcripts are written to the active project's parent folder after every chat turn (not just during orchestration), ensuring reliable human-readable conversation logging.

## User Stories

- As a developer, I want the Implementation Assistant conversation to be saved to disk after every chat exchange so that I can review the full conversation history later.
- As a developer, I want the transcript saved under my project folder (not the gateway working directory) so that it is colocated with my project files.

## Specific Requirements

**Extend ChatRequest with persistence metadata**
- Add `projectParentFolder` (string) to `ChatRequest.context` in `gateway/src/types/chat.ts`
- Add `featureId` (string) to `ChatRequest.context`
- Add `featureTitle` (string) to `ChatRequest.context`
- These fields are REQUIRED for mode=implement_feature requests
- If fields are missing, chat must still work but log a warning that persistence was skipped

**Frontend sends persistence metadata with every chat request**
- Modify `ImplementChatContext` in `frontend/src/api/chatApi.ts` to include `projectParentFolder`, `featureId`, and `featureTitle`
- Modify `buildContext()` in `ImplementationAssistantPanel.tsx` to populate these fields
- `projectParentFolder` must be the absolute path to the project's parent folder (from project metadata)
- `featureId` is already available as `workItemId` prop
- `featureTitle` is already available as `workItemTitle` prop

**Obtain projectParentFolder from project metadata**
- The architecture model stores project metadata including the parent folder path set during project creation
- Frontend must retrieve this value and pass it with each implement_feature chat request
- If projectParentFolder is not available, send the request without it (chat still works, persistence skipped)

**Gateway flushes transcript after every chat turn**
- In `gateway/src/routes/chat.ts`, after appending the ASSISTANT transcript entry, call `writeTranscriptToFile()`
- This must happen for every successful POST /api/chat where mode=implement_feature
- The flush must occur BEFORE returning the response (not deferred)
- Do NOT wait for orchestration execution to flush transcript

**Modify writeTranscriptToFile to accept projectParentFolder parameter**
- Change signature from `writeTranscriptToFile(transcript, workItemTitle)` to `writeTranscriptToFile(transcript, workItemTitle, featureId, projectParentFolder)`
- Use `projectParentFolder` as the base path instead of `config.conversationPersistBasePath`
- If `projectParentFolder` is not provided, fall back to `config.conversationPersistBasePath`
- Update `deriveFolderName()` to use `featureId` instead of `sessionId` for folder suffix (more deterministic)

**Folder naming convention**
- Output path: `<projectParentFolder>/conversations/<feature_name_and_id>/full-conversation.txt`
- `<feature_name_and_id>` constructed from sanitized featureTitle + featureId prefix (e.g., `add-user-login-feat123`)
- Folder name must be filesystem-safe: lowercase, hyphens instead of spaces, no special chars
- Use featureId (not sessionId) for deterministic folder naming across sessions

**Atomic file writes**
- The existing `writeTranscriptToFile` already writes to a temp file then renames
- Preserve this behavior: write to `.tmp` file, then `fs.rename()` to final path
- Create directories recursively with `fs.mkdir({ recursive: true })` if missing

**Error handling: do not fail chat on write errors**
- If filesystem write fails (permissions, invalid path, missing directory), log error but return chat response normally
- Log must include: sessionId, featureId, projectParentFolder, error message

**Update orchestration route for consistency**
- Modify `gateway/src/routes/orchestrations.ts` to accept `projectParentFolder` in request body
- Pass `projectParentFolder` to `writeTranscriptToFile()` when flushing after orchestration
- This ensures orchestration entries are appended to the same transcript file

## Visual Design

No visual assets provided.

## Existing Code to Leverage

**gateway/src/types/transcript.ts**
- Defines `TranscriptEntry`, `ConversationTranscript`, `TranscriptRole`, `TranscriptPhase`
- Types are well-defined and should be reused without modification

**gateway/src/services/transcriptStore.ts**
- In-memory storage for transcript entries via `appendTranscriptEntry()` and `getTranscript()`
- Already called from chat.ts to append SYSTEM, USER, ASSISTANT entries
- No changes needed; just ensure `getTranscript(sessionId)` is called before `writeTranscriptToFile()`

**gateway/src/services/transcriptWriter.ts**
- Contains `writeTranscriptToFile()`, `deriveFolderName()`, `buildTranscriptPath()`, `formatTranscript()`
- `deriveFolderName()` currently uses sessionId for suffix; change to use featureId
- `writeTranscriptToFile()` currently uses `config.conversationPersistBasePath`; add parameter to override with projectParentFolder

**gateway/src/routes/chat.ts**
- Already appends SYSTEM, USER, ASSISTANT entries via `appendTranscriptEntry()`
- Already imports `getTranscript` from services
- Missing: call to `writeTranscriptToFile()` after ASSISTANT entry is appended

**frontend/src/components/ProductView/ImplementationAssistantPanel.tsx**
- Contains `buildContext()` function that constructs `ImplementChatContext`
- Already has access to `workItemId`, `workItemTitle`, `projectId` props
- Need to add projectParentFolder (must be sourced from project metadata)

## Out of Scope

- No UI for browsing or viewing transcripts
- No database persistence of transcripts (file system only)
- No transcript deletion or cleanup functionality
- No transcript search or filtering functionality
- No changes to planner/LLM behavior or prompts
- No changes to bootstrap, refine, or handoff phase logic
- No streaming endpoint changes (streaming does not support implement_feature mode)
- No changes to session expiration or cleanup logic
- No transcript encryption or security measures
- No cross-project or cross-feature transcript aggregation
