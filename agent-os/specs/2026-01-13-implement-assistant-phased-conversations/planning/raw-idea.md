---
title: Implement Assistant Stage 2 — Introduce Phased Conversations for implement_feature Mode

context:
  The Implement Assistant chat currently operates as a single, undifferentiated conversation
  flow under mode=implement_feature. All messages are treated the same, regardless of whether
  they are early exploratory discussion, refinement, or final handoff for implementation.
  This makes it difficult to control assistant behavior deterministically and to evolve the
  assistant toward a staged, intent-locking workflow.

goal:
  Introduce an explicit "phase" concept for Implement Assistant conversations while preserving
  existing behavior. This change lays the groundwork for future staged interactions (bootstrap,
  refinement, handoff) without yet introducing new context sources or altering user-visible
  functionality.

scope:
  - Frontend and Gateway changes only
  - No new data sources or context injection
  - No persistence of phase to disk or database
  - No changes to implement-context resolution logic
  - No UX changes beyond invisible request metadata

requirements:
  frontend:
    - Extend all Implement Assistant chat requests to include a "phase" field.
    - For this stage, the default phase MUST be:
        phase: "refine"
    - When the user clicks the "Implement" button to generate implementation instructions:
        - Send the chat request with:
            phase: "handoff"
    - No other phases are introduced or used at this stage.
    - Phase selection logic must be deterministic and not depend on chat history content.

  gateway:
    - Accept the new "phase" field on chat requests for mode=implement_feature.
    - Route implement_feature requests through the same execution path as today.
    - Select the system prompt template based on the phase value:
        - phase=refine:
            - Use the existing implement_feature planner prompt with no semantic changes.
        - phase=handoff:
            - Use the existing implement_feature "generate specs" prompt with no semantic changes.
    - If an unknown or missing phase value is received:
        - Default to phase=refine.
    - Phase handling must not affect:
        - message ordering
        - chat history inclusion
        - token budgeting
        - model selection

acceptance_criteria:
  - All existing Implement Assistant chat behavior continues to work exactly as before.
  - Chat requests for normal discussion include phase=refine.
  - Chat requests triggered by the Implement button include phase=handoff.
  - The Gateway successfully distinguishes between refine and handoff requests without errors.
  - No user-visible UI changes are introduced at this stage.

non_goals:
  - No bootstrap or background context injection
  - No change in assistant tone or conversational behavior
  - No new phases beyond "refine" and "handoff"
  - No persistence of phase state beyond a single request
  - No conversation transcript recording
---
