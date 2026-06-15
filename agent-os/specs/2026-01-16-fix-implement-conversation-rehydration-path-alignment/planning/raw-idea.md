# Fix Implement Conversation Rehydration by Aligning GET/PUT Disk Path (Require projectParentFolder + featureTitle)

## Context
Implement Assistant conversations are persisted to disk by the Gateway under the active project's parent folder:
```
<projectParentFolder>/conversations/<feature_name_and_id>/conversation.json
```
and a human-readable transcript:
```
.../full-conversation.txt
```

However, when the user navigates away from the Implement screen and returns (or restarts the app), the UI loads a new conversation instead of rehydrating the saved one. This is caused by the Gateway GET endpoint reading from a different base path and/or different folder name than what the PUT endpoint writes.

## Goal
Ensure the Implement conversation rehydrates reliably by making the Gateway GET endpoint compute the exact same on-disk location as the PUT endpoint, using the same inputs:
- projectParentFolder (base folder)
- featureTitle + featureId (deterministic folder name)

## Scope
- Gateway API contract update for conversation retrieval
- Frontend update to supply required parameters on GET
- No changes to persistence format, folder naming logic, or file content
- No changes to architecture-model-service

## Requirements

### Gateway API Contract
- Update GET conversation retrieval endpoint to accept the required location inputs:
  ```
  GET /api/implement-conversations
  Query params (required):
    - projectParentFolder: string
    - featureId: string
    - featureTitle: string
  ```
  (projectId may remain optional for logging, but MUST NOT be relied on for pathing.)

- The Gateway MUST compute the folder path using the same logic as PUT:
  - base path = projectParentFolder
  - folder name = deriveFolderName(featureTitle, featureId)  # same sanitization rules
  - file path = <base>/conversations/<folder>/conversation.json

- The GET response MUST remain:
  ```
  { exists: boolean, messages: MessageEntry[] }
  ```
  where exists=false when the file is not present.

### Gateway Behavior
- GET must read conversation.json from the computed path above.
- GET must NOT use process.cwd() or CONVERSATION_PERSIST_BASE_PATH for implement conversation rehydration pathing.
- If required query params are missing:
  - return a 400 with a clear error message indicating missing params
  - do not attempt fallback pathing that could read the wrong conversation

### Frontend
- On entering the Implement screen for a feature/work item:
  - Call GET /api/implement-conversations with:
    - projectParentFolder (from active project configuration)
    - featureId
    - featureTitle
- If exists=true:
  - hydrate the chat UI with returned messages
  - do NOT trigger bootstrap
- If exists=false:
  - proceed with normal bootstrap

## Acceptance Criteria
- After a conversation has been persisted via PUT (conversation.json exists on disk), navigating away from Implement and returning rehydrates the same conversation.
- After restarting the app, opening the same project + feature Implement screen rehydrates the same conversation.
- The Gateway GET endpoint reads from:
  ```
  <projectParentFolder>/conversations/<feature_name_and_id>/conversation.json
  ```
  using the same folder name derivation logic as PUT.
- If projectParentFolder/featureTitle/featureId are missing, the system fails fast with 400 and does not silently create a new conversation.

## Non-Goals
- No changes to folder naming scheme or file formats
- No UI redesign
- No database-backed conversation storage
