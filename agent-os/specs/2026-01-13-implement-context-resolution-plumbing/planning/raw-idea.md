---
title: Implement Assistant Stage 1 — Fix Implement Context Resolution Plumbing

context:
  The Implement Assistant chat (mode=implement_feature) supports selecting architecture
  entities and diagrams as "context" for a feature/work item. Currently, the LLM is not
  receiving meaningful context because the frontend sends only raw IDs and the Gateway
  cannot resolve them into human-readable summaries (e.g. because required identifiers
  like projectId/filename are missing in the chat request context). The architecture-model-service
  already exposes implement-context resolution endpoints; the missing work is wiring and
  ensuring the resolved context is injected into the LLM prompt.

goal:
  When a user has selected architecture entities and/or diagrams for a work item and sends
  a message to the Implement Assistant, the Gateway must resolve those selections into
  readable summaries via the architecture-model-service and include the resolved results
  in the system prompt (or equivalent structured context) sent to the Planner LLM.

scope:
  - Frontend + Gateway + architecture-model-service integration wiring
  - No staged lifecycle/phase changes (remain in current implement_feature behavior)
  - No transcript persistence
  - No changes to diagram rendering or selection UI mechanics beyond what is required
    to pass identifiers needed for resolution

requirements:
  frontend:
    - Ensure every Implement Assistant chat request includes the identifiers required
      for implement-context resolution.
    - The request payload MUST include:
        - projectId (the active project id)
        - (If the Gateway currently uses a "filename" identifier for the project/model,
          then the frontend must supply the correct value; otherwise migrate the Gateway
          to use projectId consistently for resolution.)
    - Continue to send architectureContext as selected IDs:
        - entityIds: list of selected architecture entity ids
        - diagramIds: list of selected diagram ids
    - Do NOT send full resolved model content from the frontend.

  gateway:
    - For mode=implement_feature requests that include architectureContext selections:
        - Attempt to resolve the selections into human-readable summaries by calling
          the architecture-model-service implement-context resolve endpoint.
    - The resolution attempt MUST NOT depend on optional/missing fields; resolution must
      be possible using the canonical project identifier (projectId) and the provided ids.
    - If resolution succeeds:
        - Inject the resolved context into the Planner LLM system prompt (or equivalent)
          in a dedicated clearly labelled section, e.g. "HIGHLIGHTED ARCHITECTURE CONTEXT".
        - Ensure the prompt includes enough structured detail for the LLM to describe:
            - what the selected entities are (names/types)
            - key fields/attributes for data entities (when available)
            - relationships/associations where present in the resolved output
            - selected diagram summaries (name/type) and referenced entity names (if available)
    - If resolution fails for any reason:
        - Do not crash the chat.
        - Include a short internal diagnostic string in server logs indicating which field
          was missing or which call failed.
        - Proceed with the chat using no resolved context (maintain current behavior),
          but still include raw IDs in the prompt as a fallback.

  architecture-model-service:
    - Ensure there is a stable endpoint that can resolve:
        - a list of entity IDs and diagram IDs
        - scoped to a specific project (projectId)
      into a structured response consumable by the Gateway.
    - If the existing endpoint requires a "filename" rather than projectId:
        - Add/extend an endpoint (or accept both identifiers) so the Gateway can resolve
          using projectId alone.
    - The resolved response MUST include (at minimum):
        - resolvedEntities: [{ id, name, kind/type, summaryFields }]
        - resolvedDiagrams: [{ id, name, diagramType, referencedEntities: [...] }]
      where summaryFields is an LLM-friendly compact representation.

acceptance_criteria:
  - Given a work item with selected architecture entities and/or diagrams in the Implement UI:
      - Sending a message causes the Gateway to call implement-context resolve successfully.
      - The LLM response demonstrates awareness of the selected items by name/type and can
        reference key attributes/relationships where present.
  - Resolution works consistently across page refresh and navigation, as long as the selections
    exist for the work item.
  - When no selections exist, the Gateway does not call resolve (or calls it with empty lists)
    and the chat still works normally.
  - When the model service is unavailable or resolution errors:
      - The chat request still completes successfully.
      - A clear error is logged server-side.

non_goals:
  - No "phase" introduction or staged conversation lifecycle
  - No automatic bootstrap context injection
  - No conversation persistence to disk
  - No UI changes to selection components beyond passing required identifiers
---
