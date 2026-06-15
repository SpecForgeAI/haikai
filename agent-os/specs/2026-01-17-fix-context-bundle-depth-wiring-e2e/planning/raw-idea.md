title: Fix Context Bundle + Depth Wiring End-to-End (Ensure Physical Data Entity Attributes Included at Depth 1+)

context:
  The Implement Assistant supports "Context Bundles" (bundle_type) and optional data-entity depth.
  The architecture-model-service exposes an expand+resolve endpoint intended to expand bundle
  selections and return resolved entities including attributes and relationships. However, the
  Planner LLM is currently receiving only ID-level context (names/types only) and does not receive
  physical data entity attributes even when entities are selected with depth >= 1 (including depth 2).
  This is caused by missing end-to-end wiring: the frontend chat payload does not send bundle/depth
  selections, and the backend request DTO does not support depth. The system falls back to the old
  ID-only resolver path.

goal:
  Ensure that when the user selects physical data entities with depth >= 1 (and/or bundle types),
  every refine-phase chat request uses the expand-resolve path and the LLM receives resolved context
  containing, at minimum:
    - physical data entity/table names
    - attribute lists (name + type at minimum) EVEN at depth 1
    - relationships metadata when depth >= 1 (and expanded further when depth == 2)

scope:
  - Frontend: include bundle selections + depth in Implement chat payload
  - Gateway: prefer expand-resolve when bundle selections exist; validate response; inject enriched context
  - architecture-model-service: add depth field to request DTO and ensure attributes are returned at depth>=1
  - No changes to UI selection UX beyond ensuring depth/bundle values are persisted and used
  - No condensed DTO redesign; use existing condensed section if already implemented, but ensure attributes exist

requirements:
  1_frontend_send_bundle_and_depth_in_chat_payload:
    - Update Implement Assistant chat request construction so it sends structured selections, not only raw IDs.
    - For mode=implement_feature (phase=refine and phase=handoff where highlighted context is used),
      include in the POST /api/chat payload a structure like:
        architectureContext:
          entities: [
            { entity_type: string, entity_id: string, bundle_type: string, depth?: number }
          ]
          diagrams: [
            { diagram_id: string, bundle_type: string }
          ]
    - Source these values from the persisted context picker selections for the current work item:
        - entity_type MUST be the canonical category key used by the resolver (or a key that can be normalized)
        - entity_id is the raw id (e.g. pde-...)
        - bundle_type is the stored bundle selection (Iteration 1)
        - depth is the stored depth (Iteration 5) when applicable; default to 1 for entity bundles that
          imply attributes/relationships
    - Maintain backward compatibility:
        - also include legacy entityIds/diagramIds arrays if currently required by other code, but the
          gateway must prefer the structured selections when present.

  2_gateway_prefer_expand_resolve_and_require_attributes_for_pdes:
    - In the gateway /api/chat handling for mode=implement_feature:
        - If architectureContext.entities is present and non-empty:
            - call architecture-model-service expand-resolve endpoint (Iteration 2 path)
            - do NOT use the legacy resolve endpoint for highlighted context
        - Normalize entity_type keys before sending to model service (canonicalize snake_case if needed).
    - Validate expand-resolve response:
        - For any selected physical data entity included in expanded/resolved entities:
            - resolved summary MUST include an attribute list (name/type at minimum)
        - If attributes are missing:
            - log an error specifying which entity ids lacked attributes
            - include a warning marker in the injected prompt context so the issue is visible
            - do NOT silently downgrade to ID-only context
    - Inject the expanded/resolved result into the prompt under the highlighted context section.
      If condensed DTO injection exists, it may be used, but must include attributes.

  3_model_service_add_depth_and_return_attributes_at_depth_1:
    - Extend expand-resolve request DTO for entity selections to include:
        - depth: integer (optional; allowed 1 or 2; default 1)
    - Implement depth semantics for data entities:
        - depth >= 1:
            - ALWAYS include attributes for included logical/physical data entities
              in the resolved entity output (name + type at minimum)
            - include direct (1-hop) relationship metadata where available
        - depth == 2:
            - MAY include second-hop related entities/relationships, subject to max limits,
              but MUST still include attributes for all included entities
    - Ensure physical data entities are resolved with their attributes from the stored model:
        - If attributes are stored in the model under physicalDataEntities[*].attributes, map them
          directly into resolved output summaryFields.
    - Add deterministic truncation limits if needed, but attributes for selected/root physical data
      entities must be prioritized and not omitted.

  4_contract_alignment_and_tests:
    - Update any shared types/interfaces between frontend and gateway to represent the new structured
      architectureContext.entities/diagrams contract.
    - Add automated tests:
        a) Frontend: selecting a physical data entity with bundle_type entity_with_attributes_and_relationships
           and depth 2 results in chat payload containing entities[] with depth=2 and correct bundle_type.
        b) Gateway: when entities[] provided, gateway calls expand-resolve (not legacy resolve).
        c) Model service: expand-resolve for a physical data entity at depth=1 returns attributes in response.
        d) End-to-end (integration): a refine chat with selected PDEs injects context where PDE entries include
           attribute lists; assertion on presence of at least one known attribute name.

acceptance_criteria:
  - With 10 physical data entities selected and depth set to 1:
      - The Planner LLM prompt includes the names of those entities AND their attributes (name/type).
  - With depth set to 2:
      - The prompt still includes attributes and also includes expanded relationships/related entities
        where available (bounded).
  - The gateway uses expand-resolve whenever structured selections are provided.
  - The system no longer falls back to ID-only context for highlighted selections.
  - A regression test suite fails if PDE attributes are missing at depth 1.

non_goals:
  - No relationship manual selection UI
  - No new bundle types
  - No changes to persistence of conversations or orchestrations
