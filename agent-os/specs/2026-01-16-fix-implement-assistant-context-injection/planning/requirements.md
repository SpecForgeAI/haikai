```yaml
title: Fix Implement Assistant Context Injection: Bootstrap Summaries + Resolved Highlighted Entities

context:
  The Implement Assistant (mode=implement_feature) must provide the Planner LLM with correct
  business and technical context. Two defects currently prevent this:
    1) In phase=bootstrap, the system prompt shows:
         "PRODUCT BACKLOG SUMMARY: No product backlog available"
         "ARCHITECTURE META-MODEL SUMMARY: No architecture context available"
       even when the active project has saved backlog and architecture meta-model data.
    2) In phase=refine, when the user highlights/attaches architecture entities (e.g. services,
       interfaces, physical data entities), the system sends only raw IDs. The implement-context
       resolution endpoint expects typed IDs in the format "<entityType>::<id>", so entities
       cannot be resolved to names/attributes (e.g. database table names), and the LLM sees only IDs.

goal:
  - Bootstrap must inject real Product Book of Work summary and Architecture Meta-Model summary
    into the LLM prompt when data exists.
  - Highlighted entity context must be sent as typed IDs so the model service can resolve entity
    names/attributes, enabling the LLM to discuss concrete items (e.g. DB tables).

scope:
  - Frontend + Gateway + architecture-model-service integration (no schema changes)
  - No changes to UI selection mechanics beyond formatting IDs for resolution
  - No changes to diagram rendering or persistence

requirements:
  1_bootstrap_context_injection:
    gateway:
      - For POST /api/chat requests where:
          mode == "implement_feature" AND phase == "bootstrap"
        the Gateway MUST fetch and include:
          a) Product backlog/book-of-work summary for the active project
          b) Architecture meta-model summary for the active project
      - Use the canonical project/model identifier already used by the system (projectId or
        filename, whichever the current gateway-to-model-service contract requires).
      - Inject the fetched summaries into the bootstrap system prompt under clearly labeled
        sections:
          "PRODUCT BACKLOG SUMMARY"
          "ARCHITECTURE META-MODEL SUMMARY"
      - If either summary is unavailable or empty:
          - show an explicit "No ... available" line for that section
          - log a diagnostic indicating which fetch failed (without failing the chat)

    architecture-model-service:
      - Ensure stable endpoints exist and return non-empty summaries when data exists:
          - product/backlog summary (initiatives/epics/features high-level)
          - architecture meta-model summary (services, data entities, interfaces, relationships)
      - If endpoints already exist, do not change response shapes; only fix wiring and empty
        results if caused by incorrect project/model lookup.

  2_typed_entity_ids_for_resolution_preferred_fix:
    frontend:
      - When sending highlighted/attached architecture entities in Implement Assistant chat
        requests (phase=refine), the frontend MUST send entity IDs in typed form:
          "<entityType>::<id>"
      - The entityType MUST match the architecture-model-service resolution expectations.
      - The frontend MUST use the entity's known type from the selection tree/context model
        (do not infer from id prefixes).
      - Example (illustrative only):
          "physical_data_entity::pde-123"
          "application::app-456"
          "service::svc-789"
          "interface::ifc-abc"

    gateway:
      - Pass the typed entity IDs through unchanged to the implement-context resolution call.
      - After resolving, inject a dedicated section into the refine-phase system prompt:
          "HIGHLIGHTED FEATURE CONTEXT"
        containing resolved entity names/types and key summary fields (especially for physical
        data entities: table name, key fields, relationships when available).
      - If resolution fails:
          - proceed with chat (do not crash)
          - log a diagnostic
          - include raw typed IDs as a fallback (clearly labeled)

acceptance_criteria:
  - Bootstrap:
      - With an active project that has backlog and architecture meta-model data,
        the bootstrap prompt no longer shows "No ... available" for those sections and instead
        contains meaningful summaries.
      - If the project truly has no data, the "No ... available" messages remain appropriate.
  - Highlighted resolution:
      - When the user highlights/attaches physical data entities and asks about "table names",
        the assistant can reference the resolved table/entity names (not just IDs).
      - The refine-phase prompt includes a "HIGHLIGHTED FEATURE CONTEXT" section listing resolved
        entities by name/type with relevant fields.
  - Existing chat functionality remains stable; failures to fetch/resolve do not break chat.

non_goals:
  - No changes to how selections are stored in DB
  - No changes to diagrams or adding new context sources beyond the two fixes above
  - No transcript persistence changes
```
