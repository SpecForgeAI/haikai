---
title: Implement Assistant Stage 5 — Structured Refinement Loop for Feature Intent Locking

context:
  The Implement Assistant (mode=implement_feature, phase=refine) currently behaves as a
  general-purpose chat assistant. For implementation planning, the assistant must guide the
  user through a disciplined refinement loop that converges on a clear, unambiguous feature
  definition. This stage introduces a structured conversational protocol in the refine phase
  so that the assistant reliably:
    - replays the user's feature description
    - states explicit assumptions
    - asks focused questions
    - iterates until intent is locked

goal:
  Make phase=refine interactions follow a consistent "intent refinement loop" that produces
  an unambiguous, implementation-ready feature definition without changing other phases
  (bootstrap, handoff) or introducing new data sources.

scope:
  - Gateway prompt behavior changes for mode=implement_feature and phase=refine
  - Optional minimal frontend UI affordances to support the loop (non-breaking), but no new
    phases or routing
  - No changes to implement-context resolution, bootstrap content, or Implement button behavior
  - No transcript persistence

requirements:
  gateway:
    - Update the system prompt for:
        mode: implement_feature
        phase: refine
      to enforce the following assistant protocol on every assistant response after any user
      message that contains feature requirements, clarifications, or answers:

      protocol:
        1. Restate (Replay) the current understood feature definition in concise, structured form:
            - feature goal / user value
            - scope (in-scope / out-of-scope)
            - primary flows (happy path)
            - key edge cases (if mentioned)
            - dependencies / integrations (if mentioned)
        2. List explicit assumptions the assistant is making (if any), each as a bullet.
        3. Ask a small set of focused questions that are blocking implementation (if any):
            - Questions must be specific and answerable
            - Prefer 3–7 questions max; fewer if possible
        4. If there are no blocking questions and assumptions are confirmed:
            - Present a "Proposed Final Feature Definition" section that is ready for handoff,
              written as a single coherent description suitable for an implementor.
            - Do NOT automatically transition to phase=handoff; only the user action (Implement
              button) triggers handoff.

    - The prompt MUST instruct the assistant to:
        - Avoid speculative implementation details unless requested
        - Avoid introducing new requirements
        - Use background context and highlighted context (if present) to ground clarifications
        - Prefer clarity and determinism over verbosity

    - Ensure that any injected background context or highlighted context remains clearly separated
      from the assistant's replay/assumptions/questions sections (so responses remain readable).

  frontend (optional, non-breaking):
    - No required UI changes.
    - If the UI already has a "generate specs" / Implement action, keep it unchanged.
    - Do not add new phases or buttons in this stage.

acceptance_criteria:
  - In phase=refine, after the user describes a feature, the assistant responds with:
      - a concise replay of the feature as understood
      - an explicit assumptions list (when applicable)
      - a short list of focused questions (when applicable)
  - After the user answers questions and confirms assumptions, the assistant produces a
    "Proposed Final Feature Definition" that is:
      - consistent with the conversation
      - grounded in provided context
      - suitable to be used as the basis for implementation
  - The assistant does not silently switch phases and does not execute implementation steps
    during refine.
  - Existing behavior for phase=bootstrap and phase=handoff remains unchanged.

non_goals:
  - No new phases (e.g., finalize) introduced in this stage
  - No automatic "ready" detection that triggers handoff
  - No conversation transcript persistence to disk
  - No changes to backend domain models or storage
---
