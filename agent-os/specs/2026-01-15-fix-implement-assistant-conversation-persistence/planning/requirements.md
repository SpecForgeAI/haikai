```yaml
title: Fix Implement Assistant Conversation Persistence (Write After Every Chat Turn to Project Parent Folder)

context:
  Implement Assistant conversations (mode=implement_feature) must be persisted to disk as a
  human-readable transcript. The intended behavior is to append to the transcript file on
  every interaction (each user message and each assistant response). Persistence must occur
  under the active project's parent folder, which is set during project creation:
    <project_parent_folder>/conversations/<feature_name_and_id>/full-conversation.txt

problem:
  Conversation persistence is currently unreliable because:
    - transcript flushing occurs only during orchestration execution rather than each chat turn
    - orchestration execution may not include a session identifier required for persistence
    - the gateway defaults to writing under its working directory rather than the active
      project parent folder
    - the gateway cannot compute <project_parent_folder> unless it is explicitly provided

goal:
  Persist the full implement_feature planner conversation to disk after every chat request
  (user -> assistant), writing to the active project's parent folder. The transcript must be
  updated during normal chat (no orchestration/execution required) and must include all
  system prompts, injected context, user messages, assistant messages, and phase markers.

scope:
  - Frontend and Gateway changes
  - No changes required to architecture-model-service data models
  - No changes to planner behavior beyond ensuring system prompt text is persisted
  - No changes to orchestration execution beyond optionally including sessionId for consistency

requirements:
  request_contract:
    - Extend the frontend -> gateway chat request payload (POST /api/chat) to include:
        - projectId (string)
        - projectParentFolder (string)  # absolute path as configured during project creation
        - featureId (string)
        - featureTitle (string)
      These values MUST be present for mode=implement_feature requests.
    - If any of these fields are missing, the gateway must still process chat but must log
      that persistence could not run due to missing fields.

  frontend:
    - When sending an Implement Assistant chat request:
        - Include projectParentFolder for the active project.
        - Include featureId and featureTitle for the active work item.
        - Include sessionId if the UI already uses a stable session identifier; otherwise
          generate a stable session id per feature conversation and include it.
    - Ensure the same sessionId is reused for the entire feature conversation.

  gateway_persistence_behavior:
    - For every successful POST /api/chat request where mode=implement_feature:
        - Append transcript entries in memory in strict chronological order:
            - SYSTEM prompt used for that request
            - USER message (if present)
            - ASSISTANT response
            - phase for the request
        - Immediately flush the full transcript to disk after the assistant response is produced.
    - The flush MUST write to:
        <projectParentFolder>/conversations/<feature_name_and_id>/full-conversation.txt
      where <feature_name_and_id> is deterministic and filesystem-safe, constructed from:
        - featureId
        - featureTitle (sanitized)
    - The write MUST be atomic:
        - write to a temp file in the same directory
        - rename/replace full-conversation.txt

  gateway_file_format:
    - The file MUST be UTF-8 plain text and human readable.
    - Each entry MUST clearly include:
        - timestamp (if available)
        - phase (bootstrap/refine/handoff)
        - role marker: SYSTEM, USER, ASSISTANT
        - content
    - Sections MUST be appended/rewritten so the file always reflects the latest full transcript.

  gateway_error_handling:
    - If filesystem write fails (permissions, invalid path, missing directory):
        - Do NOT fail the chat request
        - Log an error with enough detail to diagnose the problem
    - The gateway must ensure directories exist before writing:
        - create <projectParentFolder>/conversations/<feature_name_and_id>/ if missing

  orchestration_consistency:
    - If an orchestration execution route exists, ensure it also accepts:
        - sessionId
        - projectParentFolder
        - featureId/featureTitle
      so that orchestration request/response entries can be appended to the same transcript file.
    - Orchestration persistence must be additive and must not be the only time persistence happens.

acceptance_criteria:
  - When the user opens an Implement Assistant conversation and sends a message:
      - A directory is created at:
          <project_parent_folder>/conversations/<feature_name_and_id>/
      - A file exists at:
          .../full-conversation.txt
      - The file contains the system prompt, the user message, and the assistant response.
  - After each subsequent user message and assistant response:
      - full-conversation.txt is updated to include the new entries in order.
  - Persistence occurs without requiring any orchestration execution step.
  - If projectParentFolder is missing, chat still works and a clear log message indicates
    persistence was skipped due to missing required fields.

non_goals:
  - No UI for browsing transcripts
  - No database persistence of transcripts
  - No job polling/status tracking persistence
```
