---
title: Implement Assistant Stage 7 — Full Conversation and Execution Persistence to Disk

context:
  Implement Assistant conversations are first-class artefacts in a Specification-Driven
  Development (SDD) workflow. They must capture not only the interactive planning discussion,
  but also the final handoff plan and the execution event that follows. With the introduction
  of staged handoff planning (single vs multiple sub-intents) and execution via an external
  Orchestration Service, persistence must reflect the full lifecycle from bootstrap through
  execution.

goal:
  Persist a complete, deterministic, human-readable record of:
    - the full Planner LLM conversation
    - all system prompts and injected context
    - the final validated handoff plan (handoff_intents array)
    - the external orchestration execution request and response
  into a single on-disk artefact per feature.

scope:
  - Gateway persistence and filesystem logic only
  - Applies only to mode=implement_feature conversations
  - Covers all phases: bootstrap, refine, handoff, execution
  - File-based persistence only (no database)
  - No UI changes required

persistence_location:
  - All artefacts MUST be written under:
      <project_parent_folder>/conversations/<feature_name_and_id>/
  - The primary file MUST be:
      full-conversation.txt
  - <feature_name_and_id> MUST be deterministic and filesystem-safe.

persisted_content_definition:
  The persisted artefact MUST include, in strict chronological order:

  1. Conversation transcript
     - Every system prompt sent to the Planner LLM
     - Every background context injection (bootstrap, highlighted context)
     - Every user-authored message
     - Every assistant response
     - Each entry MUST include the phase (bootstrap / refine / handoff)

  2. Final handoff plan (canonical)
     - The exact validated JSON object returned by the Planner LLM in phase=handoff
       (including is_split, handoff_plan_summary, and handoff_intents[])
     - This section MUST be clearly labelled, e.g.:
         "FINAL HANDOFF PLAN (PLANNER OUTPUT)"

  3. Orchestration execution record
     - A clearly labelled section, e.g.:
         "ORCHESTRATION EXECUTION"
     - Include:
         - target endpoint path (/api/v1/orchestrations)
         - company value used
         - project name used
         - number of feature_descriptions sent
         - execution timestamp
     - Include the orchestration response:
         - HTTP status code
         - response body (full body if reasonable size, otherwise truncated with marker)

requirements:
  gateway:
    - Maintain an in-memory transcript buffer for each implement_feature conversation that
      appends entries for:
        - system prompt
        - user message
        - assistant response
        - phase
    - On receipt of a valid phase=handoff Planner response:
        - Append the validated handoff plan JSON to the transcript buffer as a dedicated entry.
    - On execution via the external Orchestration Service:
        - Append an execution record entry to the transcript buffer containing request metadata
          and response data as defined above.
    - On completion of orchestration execution (success or failure):
        - Flush the entire transcript buffer to:
            <project_parent_folder>/conversations/<feature_name_and_id>/full-conversation.txt
        - File write MUST be atomic (write temp file, then rename).

  formatting:
    - The persisted file MUST be UTF-8 plain text.
    - The file MUST be human-readable and clearly structured, including:
        - Section headers
        - Phase markers
        - Clear role markers:
            SYSTEM
            USER
            ASSISTANT
            PLANNER_HANDOFF
            ORCHESTRATION
    - Timestamps SHOULD be included for each entry if available.

  error_handling:
    - Failure to write the conversation file MUST NOT:
        - block orchestration execution
        - block returning results to the frontend
    - All persistence failures MUST be logged with sufficient detail to diagnose filesystem
      or permission issues.
    - Partial persistence is acceptable only if explicitly logged as such.

acceptance_criteria:
  - After a complete Implement Assistant flow ending in execution:
      - A full-conversation.txt file exists at the correct path.
  - The file contains:
      - bootstrap system prompt and assistant welcome message
      - all refine-phase exchanges
      - the final Planner handoff plan JSON
      - the orchestration execution request metadata and response
  - The ordering of entries matches the real execution order.
  - Execution and UI behavior are unaffected if persistence fails.

non_goals:
  - No UI for browsing or replaying conversations
  - No database-backed conversation storage
  - No job polling or status tracking persistence
  - No regeneration or re-execution from persisted files
