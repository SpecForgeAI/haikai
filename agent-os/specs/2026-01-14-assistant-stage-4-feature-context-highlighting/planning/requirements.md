---
title: Implement Assistant Stage 4 — Feature-Specific Context Highlighting (Resolved Entities + Diagrams)

context:
  The Implement Assistant (mode=implement_feature) supports selecting architecture entities
  and diagrams as context for a specific feature/work item. The assistant also supports a
  bootstrap phase that provides broad background context. What is missing is a reliable,
  explicit way to treat user selections (entities + diagrams) as "highlighted feature-specific
  context" and ensure the Planner LLM receives a resolved, human-readable summary of those
  selections on subsequent refine-phase chat requests.

goal:
  When a user highlights/selects specific architecture meta-model items and diagrams for a
  feature, every refine-phase chat request must include a dedicated "HIGHLIGHTED CONTEXT"
  section containing resolved summaries of:
    - the selected architecture entities
    - the selected diagrams (including key referenced entities when available)
  This context is used to emphasize relevance for the current feature and must not be sent
  as raw IDs.

scope:
  - Frontend, Gateway, and architecture-model-service changes
  - Applies only to mode=implement_feature and phase=refine
  - Adds diagram context as feature-specific highlighted context (diagrams are NOT part of
    the bootstrap background context)
  - No changes to diagram rendering, persistence, or selection UX beyond what is required
    to convey and resolve the highlighted selections
  - No transcript persistence

requirements:
  frontend:
    - Continue to allow the user to select/attach:
        - architecture meta-model entities
        - diagrams
      as context for a specific feature/work item.
    - Ensure every refine-phase chat request includes a stable, explicit list of highlighted
      selections for the current feature:
        - highlightedEntityIds: string[]
        - highlightedDiagramIds: string[]
      (These may be carried in the existing architectureContext structure, but they MUST be
      present deterministically on each request after selection.)
    - No requirement to send additional resolved details from the frontend.

  gateway:
    - For mode=implement_feature and phase=refine:
        - If highlightedEntityIds or highlightedDiagramIds are non-empty:
            - Call the architecture-model-service implement-context resolution endpoint to
              resolve the selected ids into LLM-friendly summaries.
            - Inject the resolved output into the Planner LLM system prompt (or equivalent)
              under a clearly labelled section:
                "HIGHLIGHTED FEATURE CONTEXT"
        - If no highlighted selections exist:
            - Do not include the highlighted section (or include it as "none").
    - The highlighted section MUST include:
        - Entities:
            - name, type/kind, and key summary fields (e.g. main attributes, primary keys,
              relationships where available)
        - Diagrams:
            - diagram name and diagram type
            - key referenced entities (resolved to names/types) if available from resolution
    - The highlighted context MUST be additive to existing background context (bootstrap-provided
      product + meta-model summaries), and must be clearly separated from it.
    - Resolution failures must not break the chat:
        - Log a clear server-side diagnostic
        - Proceed without highlighted resolved context rather than crashing

  architecture-model-service:
    - Ensure the implement-context resolution endpoint can accept:
        - projectId (or the canonical project identifier used by the system)
        - highlightedEntityIds
        - highlightedDiagramIds
      and return a structured response containing resolved entity and diagram summaries suitable
      for direct prompt injection.
    - Ensure diagram resolution can provide referenced entity ids and (where feasible) resolved
      referenced entity names/types.

assistant_behavior_guidance:
  - Update the refine-phase system prompt for mode=implement_feature to instruct the assistant:
      - that the highlighted context represents items the user considers most relevant to the
        current feature
      - to prioritize these items in reasoning and questions
      - to avoid inventing architecture not present in the background + highlighted context

acceptance_criteria:
  - When the user highlights one or more entities and/or diagrams for a feature:
      - The next refine-phase chat request includes those highlighted IDs.
      - The Gateway resolves them and injects a "HIGHLIGHTED FEATURE CONTEXT" section that
        contains human-readable names/types and useful summary details.
      - The Planner LLM demonstrates awareness of the highlighted entities/diagrams by
        referencing them by name and using their details appropriately.
  - When the user clears highlighted selections:
      - Subsequent refine-phase chat requests do not include highlighted resolved context.
  - The chat continues functioning if resolution fails, with errors logged server-side.

non_goals:
  - No changes to the bootstrap phase content
  - No new conversation phases
  - No automatic synchronization of UI selection state with assistant messages
  - No transcript persistence to disk
  - No changes to implementation/execution behavior triggered by the Implement button
---
