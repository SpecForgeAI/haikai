title: Questions System v1 — Structured Questions Table + Answer Workflow

intent: |
  Introduce a first-class Questions system to support structured clarification between the Tool User
  and assistant roles (Product Owner and Software Architect). Replace ad-hoc question lists with a
  table-based workflow that allows questions to be tracked, answered, and sent back deterministically,
  while preserving conversational continuity in Team Chat.

scope:
  in:
    - Render a Questions table below the Feature Definition area.
    - Support questions from multiple roles (Product Owner, Software Architect).
    - Allow the Tool User to enter answers inline.
    - Implement a controlled "Answer Open Questions" workflow.
    - Track question status (Open / Answered) deterministically.
  out:
    - Implementation planning (implementationPlan display).
    - Execution pipeline (shape-spec/write-spec/etc.).
    - Persistence guarantees beyond in-session state (separate phase).
    - Automatic rewording or merging of questions.

User decisions from shaping:
- Question ID: Backend-assigned UUID (gateway assigns UUIDs to each question)
- Table Position: After Acceptance Criteria in FeatureDefinitionPanel
- Answer Input: Inline text field in same row as question
- Multi-role Send: Single combined message with sections per role
- Empty State: Show answered questions read-only (grayed out)
- Gateway Scope: Include gateway changes in this spec
