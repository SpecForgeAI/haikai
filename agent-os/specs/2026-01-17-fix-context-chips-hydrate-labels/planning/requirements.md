# Fix Context Chips Flipping Between Names and IDs (Hydrate Labels After Context Reload)

context:
  The Work Item "CONTEXT" summary chips sometimes display human-readable names (e.g. "Portal Database")
  and sometimes display raw IDs (e.g. "svc-...") depending on navigation. Specifically:
    - Immediately after selecting context via the Add Context modal, chips show names.
    - After navigating away and returning (or reloading the page), chips revert to IDs.
  This is caused by the context rehydration path mapping backend DTOs to refs where label == id,
  and the UI never re-resolves those labels back to names.

goal:
  Ensure context chips always show the desired human-readable labels (names / computed relationship
  labels) and never regress to IDs after navigation or reload. While data is loading, show a
  temporary "Loading…" label rather than an id.

scope:
  - Frontend only
  - Applies to Work Item context summary rendering and context state hydration after fetch
  - No backend changes required
  - Covers: entity refs, diagram refs, and relationship refs (if present)

requirements:
  1_add_label_hydration_utility:
    - Introduce a utility function:
        hydrateContextLabels(contextState, architectureState) -> ContextState
      that returns a new ContextState where each ref.label is populated with the correct
      human-readable label.
    - The function must support:
        a) Entity refs:
           - Resolve by entity_type + entity_id from the in-memory architecture meta-model state.
           - Set label = entity.name.
           - If not found yet, set label = "Loading…" (not the id).
           - If definitively missing (meta-model loaded but id not found), set:
               "Unknown [<ENTITY_TYPE>]"
        b) Diagram refs:
           - Resolve diagram name from loaded diagram list/state.
           - If not found yet, label = "Loading…"
           - If missing after diagrams loaded, label = "Unknown [DIAGRAM]"
        c) Relationship refs (if present in ContextState):
           - Compute label using the relationship display rules already specified:
               "<NameA> [<TypeA>] | <NameB> [<TypeB>] | ..."
             with strict ordering and optional participants per relationship type.
           - If participants not resolved yet, label = "Loading…"
           - If missing after model loaded, label includes "Unknown [...]" tokens (never ids).

  2_use_hydration_on_context_reload_and_on_model_ready:
    - In the Implement screen (and anywhere else that fetches persisted context for a work item):
        - After fetchImplementContext(...) resolves, immediately call hydrateContextLabels(...)
          before setting the context state used for rendering chips.
    - Additionally, because architecture/diagram state may load after context:
        - When architecture meta-model and diagrams become available/updated, re-run hydration
          against the current ContextState and update state only if labels change.
        - Guard against infinite render loops by:
            - comparing previous vs new hydrated labels and only calling setState when different.

  3_remove_id_fallback_in_rendering:
    - Ensure the chip rendering component never falls back to displaying entity_id/diagram_id
      when label is missing.
    - If label is empty/undefined, display "Loading…" rather than an id.

  4_regression_tests:
    - Add tests to prevent reintroduction:
        a) Given a ContextState loaded from backend where labels == ids, and a loaded meta-model
           containing those ids with names, hydrateContextLabels returns labels == names.
        b) Given diagrams loaded, diagram labels hydrate to diagram.name.
        c) Navigation simulation: context fetched -> hydrated -> displayed; on re-mount and re-fetch,
           displayed labels remain names, not ids.

acceptance_criteria:
  - After selecting context, chips show names as before.
  - After navigating away and returning, chips still show the same names (not ids).
  - After full refresh/app restart, chips show "Loading…" briefly (if needed) then hydrate to names.
  - No "Maximum update depth exceeded" warnings are introduced (hydration setState is guarded).

non_goals:
  - No changes to backend DTOs or persistence format
  - No changes to planner prompt context
