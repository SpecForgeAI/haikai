# Specification: Implement Assistant Conversation Persistence and Rehydration

## Goal
Enable durable, per-feature conversation persistence and rehydration so that Implement Assistant chat conversations survive navigation away from the screen and app restarts, with saves occurring after every chat turn.

## User Stories
- As a developer using the Implement Assistant, I want my conversation to persist when I navigate away and return so that I can continue where I left off without re-explaining context.
- As a developer, I want my conversation to survive app restarts so that closing my browser does not lose my clarification dialog progress.

## Specific Requirements

**Gateway GET /api/implement-conversations endpoint**
- Create new route file `gateway/src/routes/implementConversations.ts`
- Accepts query parameters: `projectId` (string, required), `featureId` (string, required)
- Returns JSON: `{ exists: boolean, messages: MessageEntry[] }`
- Uses `deriveFolderName()` from `transcriptWriter.ts` to compute the folder path
- Reads `conversation.json` from `<projectParentFolder>/conversations/<folder_name>/conversation.json`
- Returns `exists: false` with empty messages array if file does not exist
- Must NOT fail if the file is missing or unreadable (graceful degradation)

**Gateway PUT /api/implement-conversations endpoint**
- Add to same route file `gateway/src/routes/implementConversations.ts`
- Request body: `{ projectId, featureId, projectParentFolder, featureTitle, messages: MessageEntry[] }`
- Writes `conversation.json` (machine-readable JSON array of messages) atomically (temp file + rename)
- Also writes `full-conversation.txt` (human-readable format using existing `formatTranscript()` logic)
- Response: `{ success: boolean }`
- Persistence failures must be logged but NOT break the endpoint (return success: false with logged error)

**MessageEntry data model for conversation.json**
- Define in `gateway/src/types/transcript.ts` alongside existing types
- Structure: `{ role: "system" | "user" | "assistant", phase: TranscriptPhase, content: string, timestamp: string }`
- This aligns with existing `TranscriptEntry` but uses lowercase role names for JSON serialization
- The GET endpoint returns this format; the PUT endpoint accepts this format

**Automatic persistence on POST /api/chat for implement_feature mode**
- Modify `gateway/src/routes/chat.ts` to write `conversation.json` alongside `full-conversation.txt`
- Extend `flushTranscriptToDisk()` to also write `conversation.json` using the transcript store entries
- Ensure both files are updated atomically after each ASSISTANT entry
- Leverage existing `deriveFolderName()` and `buildTranscriptPath()` from `transcriptWriter.ts`

**Frontend hydration on Implement screen mount**
- Modify `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`
- Add new `useEffect` hook that calls GET `/api/implement-conversations` on mount when messages are empty
- If `exists: true`, hydrate messages state from returned data and set `hasBootstrapped: true`
- If `exists: false`, proceed with normal bootstrap flow (existing behavior)
- Hydration must happen BEFORE bootstrap trigger to avoid duplicate initial messages

**Frontend API client for conversation endpoints**
- Add functions to `frontend/src/api/chatApi.ts`:
  - `getImplementConversation(projectId: string, featureId: string): Promise<{ exists: boolean, messages: MessageEntry[] }>`
  - `putImplementConversation(params: { projectId, featureId, projectParentFolder, featureTitle, messages }): Promise<{ success: boolean }>`
- Use `GATEWAY_BASE` constant for URL construction (same pattern as `postChatMessage`)

**Frontend in-memory state keying by projectId + featureId**
- The existing `ProductUiStateContext.tsx` already keys `implementChatState` by `projectKey` (derived from projectId) and `workItemId` (featureId)
- Ensure hydration from GET endpoint populates this context state so tab switches restore from memory
- On unmount/remount, check context state first, then fall back to GET endpoint if context is empty

**Route registration in gateway**
- Add `implementConversationsRouter` export to `gateway/src/routes/index.ts`
- Mount at `/api/implement-conversations` in `gateway/src/server.ts`

## Visual Design
No visual assets provided.

## Existing Code to Leverage

**`gateway/src/services/transcriptWriter.ts`**
- `deriveFolderName(workItemTitle, featureId)` creates deterministic, filesystem-safe folder names
- `buildTranscriptPath(basePath, folderName)` returns `{ dirPath, filePath }` for the conversations folder
- `formatTranscript(transcript)` formats entries as human-readable text for `full-conversation.txt`
- Atomic write pattern using temp file + rename is already implemented
- Extend to also write `conversation.json` using the same atomic pattern

**`gateway/src/services/transcriptStore.ts`**
- `getTranscript(sessionId)` retrieves in-memory transcript entries
- `ConversationTranscript` interface with `entries: TranscriptEntry[]`
- Each `TranscriptEntry` has `{ timestamp, phase, role, content }`
- Use this data source for building `conversation.json` content

**`gateway/src/routes/chat.ts` - `flushTranscriptToDisk()`**
- Already calls `writeTranscriptToFile()` after each ASSISTANT entry for implement_feature mode
- Extend to also write JSON format; both files should be written in the same flush operation
- Existing error handling logs failures without breaking the chat request

**`frontend/src/contexts/ProductUiStateContext.tsx`**
- `ImplementChatUiState` interface stores `sessionId`, `messages`, `hasBootstrapped`, etc.
- `getImplementChatState(projectKey, workItemId)` retrieves stored state
- `setImplementChatState(projectKey, workItemId, chatState)` persists state
- This in-memory context survives tab switches but not app restarts

**`frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`**
- Existing hydration `useEffect` at line 208 restores from context on mount
- Bootstrap `useEffect` at line 376 triggers initial context loading when messages empty
- Modify hydration to check disk persistence (via GET endpoint) before bootstrap

## Out of Scope
- Multi-user synchronization or concurrent editing of conversations
- UI for browsing all conversations across features (conversation list view)
- Database-backed conversation storage (file-based only in this stage)
- Changes to architecture-model-service schemas or endpoints
- Changes to LLM prompts or Planner behavior
- Migration of existing in-memory-only conversations to disk
- Compression or archival of old conversations
- Encryption of conversation files at rest
- Conversation search or filtering functionality
- Exporting conversations to external formats (PDF, etc.)
