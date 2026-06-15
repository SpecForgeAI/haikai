---
title: Implement Assistant Stage 3 — Bootstrap Phase with Rich Background Context

context:
  The Implement Assistant currently begins with an empty or generic chat state, requiring
  the user to manually establish both business and technical context. This leads to poor
  initial understanding by the Planner LLM and repetitive clarification. The system already
  supports implement_feature mode and phased conversations (refine / handoff), but does not
  yet support a dedicated bootstrap phase where the LLM is preloaded with background context
  before the user begins interacting.

goal:
  Introduce a new bootstrap phase for implement_feature conversations that automatically
  provides the Planner LLM with rich background context on conversation load, so the assistant
  starts informed about the product, the current feature, and the existing architecture
  meta-model before any user-authored messages.

scope:
  - Frontend, Gateway, and architecture-model-service changes
  - Applies only to mode=implement_feature
  - No diagram or design artefact injection at this stage
  - No conversation persistence to disk
  - No changes to execution / Implement button behavior

bootstrap_context_definition:
  The bootstrap phase MUST provide the following background context to the LLM:
    - A high-level summary of the Product Book of Work:
        - initiatives, epics, and features
        - concise, summarised form suitable for LLM consumption
    - The current feature:
        - feature id
        - feature name
        - feature description
    - The full architecture meta-model captured so far:
        - services
        - data entities (logical and physical)
        - interfaces
        - relationships / associations
      This meta-model MUST be resolved into a human-readable, LLM-friendly structure and
      MUST NOT be sent as raw IDs.

requirements:
  frontend:
    - On entering the Implement screen for a specific feature/work item:
        - Automatically issue a chat request with:
            mode: implement_feature
            phase: bootstrap
        - This request is sent without requiring any user input.
    - The frontend must NOT send any diagram selections during bootstrap.
    - The response from the bootstrap request MUST be displayed as the first assistant
      message in the Implement Assistant chat UI.
    - After bootstrap completes, subsequent user messages MUST use:
        phase: refine

  gateway:
    - Accept and handle phase=bootstrap for mode=implement_feature.
    - For phase=bootstrap requests:
        - Do not expect or require user-authored chat messages.
        - Assemble the bootstrap background context by:
            - Fetching a summarised Product Book of Work
            - Including the current feature name and description
            - Fetching and resolving the full architecture meta-model
        - Inject this background context into the system prompt (or equivalent structured
          context) sent to the Planner LLM under clearly labelled sections, e.g.:
            - PRODUCT BACKLOG SUMMARY
            - CURRENT FEATURE
            - ARCHITECTURE META-MODEL SUMMARY
    - Use a bootstrap-specific system prompt that instructs the LLM to:
        - Acknowledge the feature being implemented
        - Acknowledge receipt of product and architecture context
        - Respond with a short, summarised welcome message
        - Ask the user whether they want to highlight specific architecture or diagrams
          that are especially relevant to this feature
    - The bootstrap response MUST NOT:
        - Ask detailed implementation questions
        - Propose solutions
        - Attempt to refine requirements

  architecture-model-service:
    - Provide a stable way to retrieve:
        - A summarised view of the Product Book of Work for a project
        - The full architecture meta-model resolved into an LLM-friendly representation
    - The resolved meta-model MUST:
        - Be scoped to the active project
        - Include names, types, and key descriptive fields
        - Avoid excessive verbosity unsuitable for LLM context windows

acceptance_criteria:
  - Opening the Implement screen automatically triggers a bootstrap request.
  - The first assistant message clearly indicates:
        - Awareness of the current feature
        - Awareness of the broader product and architecture context
  - The assistant invites the user to highlight relevant context without asking
    detailed implementation questions.
  - Subsequent user messages proceed using phase=refine and normal chat behavior.
  - No diagrams or feature-specific selections are included unless the user explicitly
    adds them after bootstrap.

non_goals:
  - No diagram or design artefact injection during bootstrap
  - No persistence of the conversation transcript to disk
  - No feature refinement or assumption validation in bootstrap
  - No changes to Implement button or execution flow
---
