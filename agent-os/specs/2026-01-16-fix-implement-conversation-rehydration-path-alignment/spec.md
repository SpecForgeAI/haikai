# Specification: Fix Implement Conversation Rehydration Path Alignment

## Goal
Ensure the Implement conversation rehydrates reliably by making the Gateway GET endpoint compute the exact same on-disk location as the PUT endpoint, using projectParentFolder, featureTitle, and featureId.

## User Stories
- As a developer, I want my Implement Assistant conversation to restore after navigating away and returning so that I do not lose context.
- As a developer, I want my conversation to restore after restarting the app so that my work persists across sessions.

## Specific Requirements

**GET endpoint must accept projectParentFolder and featureTitle query parameters**
- Current GET validation at lines 30-38 only requires projectId and featureId
- Must add validation for projectParentFolder (string, required, non-empty)
- Must add validation for featureTitle (string, required, non-empty)
- Return 400 with clear error message if any required param is missing
- projectId may remain for logging but MUST NOT affect pathing

**GET endpoint must use same path derivation as PUT**
- Current GET uses `deriveFolderName('', featureId)` at line 128 (empty string for title)
- Current GET uses `config.conversationPersistBasePath` at line 134 instead of projectParentFolder
- Must change to: `deriveFolderName(featureTitle, featureId)` to match PUT line 216
- Must use projectParentFolder as basePath to match PUT line 217
- Final path: `<projectParentFolder>/conversations/<derivedFolderName>/conversation.json`

**GET endpoint must NOT use fallback pathing**
- Current implementation falls back to `config.conversationPersistBasePath` (defaults to process.cwd)
- This causes path mismatch because PUT uses projectParentFolder directly
- Remove fallback logic entirely - require explicit projectParentFolder

**Frontend getImplementConversation must pass additional parameters**
- Current function signature at lines 336-339 only accepts projectId and featureId
- Must add projectParentFolder and featureTitle parameters
- Update URL construction at line 340 to include new query params
- URL format: `/api/implement-conversations?projectId=...&featureId=...&projectParentFolder=...&featureTitle=...`

**Frontend disk hydration useEffect must pass required parameters**
- Current call at line 313 only passes projectId and workItemId
- Must pass projectParentFolder from `activeProject?.projectParentFolder`
- Must pass featureTitle from `workItemTitle` prop
- Add guard clause to skip disk hydration if projectParentFolder is undefined

**Response format must remain unchanged**
- GET continues to return `{ exists: boolean, messages: MessageEntry[] }`
- PUT continues to return `{ success: boolean }`
- No changes to file format or folder naming logic

## Visual Design
No visual changes required.

## Existing Code to Leverage

**gateway/src/services/transcriptWriter.ts - deriveFolderName (lines 61-92)**
- Sanitizes workItemTitle to filesystem-safe format (lowercase, hyphens, no special chars)
- Appends first 8 chars of featureId as suffix for deterministic naming
- PUT already uses this correctly at line 216 of implementConversations.ts
- GET must call with same arguments: `deriveFolderName(featureTitle, featureId)`

**gateway/src/services/transcriptWriter.ts - buildTranscriptPath (lines 101-105)**
- Joins basePath with "conversations" folder and derived folder name
- Returns `{ dirPath, filePath }` where dirPath is the conversation folder
- PUT uses this at line 217 with projectParentFolder as basePath
- GET must use projectParentFolder instead of config.conversationPersistBasePath

**gateway/src/routes/implementConversations.ts - validatePutBody (lines 46-66)**
- Already validates projectParentFolder and featureTitle for PUT requests
- Same validation logic should be adapted for GET query params
- Reuse pattern: check string type, non-empty after trim

**frontend/src/contexts/ProjectContext.tsx - useProject hook**
- Already imported at line 83 of ImplementationAssistantPanel.tsx
- Provides `activeProject?.projectParentFolder` (absolute path string)
- Used successfully by PUT operations at line 637

**frontend/src/api/chatApi.ts - getImplementConversation (lines 336-351)**
- Existing function structure handles URL encoding and error handling
- Add parameters matching PutConversationRequest fields
- Extend URL query string construction pattern

## Out of Scope
- No changes to folder naming algorithm (deriveFolderName logic stays same)
- No changes to file format (conversation.json structure unchanged)
- No changes to PUT endpoint (already works correctly)
- No changes to architecture-model-service
- No changes to transcript file (full-conversation.txt)
- No database-backed conversation storage
- No UI redesign
- No changes to bootstrap phase logic
- No changes to context state hydration (in-memory, tab-switch persistence)
- No changes to how messages are converted between MessageEntry and ChatMessage
