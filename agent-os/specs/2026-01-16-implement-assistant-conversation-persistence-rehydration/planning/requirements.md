```yaml
title: Persist and Reload Implement Assistant Conversations Per Feature (Across Navigation and App Restarts)

context:
  The Implement Assistant conversation for a feature/work item must not be lost when users:
    - navigate away from the Implement screen and return, or
    - close and reopen the application.
  The conversation must be continuously persisted after every user message and every assistant
  response, in addition to being written to disk under:
    <project_parent_folder>/conversations/<feature_name_and_id>/full-conversation.txt
  The UI must rehydrate the conversation from durable storage on load so the thread appears
  exactly as it was for that feature.

goal:
  Implement durable, per-feature conversation persistence and rehydration so that:
    - the Implement chat is not wiped on navigation
    - the Implement chat reloads after app restart
    - saves occur after every chat turn (user send + assistant reply)

scope:
  - Frontend + Gateway changes
  - File-based persistence via Gateway (browser cannot write to arbitrary folders)
  - No changes to architecture-model-service schemas/endpoints
  - No change to Planner LLM behavior/prompt content besides storing what was sent/received

data_model:
  - Define a conversation as an ordered list of message entries, each with:
      - role: "system" | "user" | "assistant"
      - phase: "bootstrap" | "refine" | "handoff" (when applicable)
      - content: string
      - timestamp: ISO-8601 string (server-generated preferred)
  - Conversation identity MUST be scoped by:
      - projectId
      - featureId (work item id)
    and optionally a sessionId if your current chat pipeline uses one.

gateway_api:
  - Add endpoints for conversation persistence and retrieval:

    1) GET /api/implement-conversations
       Query params:
         - projectId
         - featureId
       Response:
         - { exists: boolean, messages: MessageEntry[] }

    2) PUT /api/implement-conversations
       Request body:
         - projectId
         - featureId
         - projectParentFolder (required for disk persistence path)
         - featureTitle (required for deterministic folder naming)
         - messages: MessageEntry[]  # full ordered transcript
       Response:
         - { success: boolean }

  - The Gateway MUST persist conversations to disk in:
      <projectParentFolder>/conversations/<feature_name_and_id>/conversation.json
    where <feature_name_and_id> is deterministic and filesystem-safe (featureId + sanitized title).
  - The Gateway MUST continue to maintain and write the human-readable transcript file:
      .../full-conversation.txt
    and MUST keep it consistent with conversation.json.

persistence_behavior:
  - On every implement_feature chat request (POST /api/chat):
      - append the system/user/assistant entries to the in-memory transcript (if used)
      - write updated state to disk immediately:
          - update conversation.json (machine-readable, full transcript)
          - update full-conversation.txt (human-readable transcript)
  - Writes MUST be atomic (temp file + rename).
  - Persistence failures MUST NOT break chat; they must be logged.

frontend_behavior:
  - On entering the Implement screen for a given featureId:
      - Call GET /api/implement-conversations?projectId=...&featureId=...
      - If exists=true:
          - hydrate the chat UI from returned messages (render in order)
          - do NOT trigger bootstrap again unless explicitly requested
      - If exists=false:
          - proceed with normal bootstrap flow (phase=bootstrap), then display first message

  - After every successful chat interaction:
      - Maintain chat state locally in the UI
      - Call PUT /api/implement-conversations with the full transcript (messages array)
        OR rely on the gateway chat route to persist automatically (preferred).
      - If relying on gateway automatic persistence:
          - the frontend must still request hydration via GET on load.

navigation_state:
  - The Implement chat UI must store conversation state keyed by projectId + featureId so that
    switching tabs/screens does not clear it before persistence/rehydration occurs.
  - On unmount/remount of Implement screen, it must rehydrate from:
      - in-memory UI state if present, otherwise
      - GET /api/implement-conversations.

acceptance_criteria:
  - Start a conversation on Implement screen for a feature, send messages, receive replies.
  - Navigate away to another screen/tab and return:
      - the full conversation is still displayed exactly as before.
  - Close the app, reopen, open the same feature Implement screen:
      - the full conversation is restored without loss.
  - On disk, under:
      <project_parent_folder>/conversations/<feature_name_and_id>/
    both files exist and update after each chat turn:
      - conversation.json (full ordered message entries)
      - full-conversation.txt (human-readable transcript)

non_goals:
  - No multi-user synchronization or concurrent editing
  - No UI for browsing all conversations across features
  - No database-backed conversation storage in this stage
```
