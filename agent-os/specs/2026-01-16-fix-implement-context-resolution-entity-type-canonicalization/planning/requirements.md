```yaml
title: Fix Implement Context Resolution for Physical Data Entities by Canonicalizing Entity Type Keys

context:
  The Implement Assistant attaches "highlighted context" as typed entity identifiers in the
  form "<entityType>::<id>" and uses the architecture-model-service resolve endpoint to
  convert these into human-readable entities (names/types/fields). Currently, certain entity
  types—most critically physical data entities—are not being resolved. The attached IDs use
  snake_case type keys (e.g. "physical_data_entities") while the resolver expects canonical
  meta-model keys (e.g. "physicalDataEntities"). As a result, the resolver treats those
  types as unknown and drops them from the resolved entity list.

goal:
  Ensure all highlighted entity types—including physical data entities—resolve correctly by:
    1) canonicalizing entity type keys to the resolver's expected canonical strings before
       invoking resolution, and
    2) adding backwards-compatible alias handling in the model service resolver so both
       snake_case and canonical forms resolve successfully.

scope:
  - Frontend/Gateway: normalize entityType strings used in typed IDs
  - architecture-model-service: accept aliases for common non-canonical entityType strings
  - No changes to storage schema or selection UX
  - No changes to diagrams or other assistant behavior

requirements:
  canonical_entity_type_mapping:
    - Define a single canonical mapping table for meta-model entity type keys used in typed IDs.
    - The canonical type keys MUST match the strings expected by the model-service resolver.
    - At minimum include these mappings:
        - "physical_data_entities" -> "physicalDataEntities"
        - "logical_data_entities"  -> "logicalDataEntities"
        - "app_components"         -> "appComponents"
        - "applications"           -> "applications"
        - "services"               -> "services"
        - "interfaces"             -> "interfaces"
        - "endpoints"              -> "endpoints"
      (Add any other meta-model categories present in the selection tree that differ by casing.)

  gateway_normalization_preferred:
    - Implement normalization in the Gateway (preferred) so the resolver receives canonical
      types regardless of frontend behavior.
    - Before calling the implement-context resolve endpoint:
        - Parse each typed ID "<entityType>::<id>"
        - Normalize entityType using the canonical mapping table
        - Reconstruct the typed ID with the canonical entityType
    - If a typed ID has an unknown entityType:
        - Leave it unchanged
        - Log a diagnostic indicating an unmapped type was encountered

  model_service_alias_support:
    - In ImplementContextResolutionService (or equivalent resolver):
        - Add alias handling so that known snake_case types are treated as equivalents of the
          canonical types.
        - The alias support MUST include at minimum:
            - "physical_data_entities" as alias of "physicalDataEntities"
            - "logical_data_entities"  as alias of "logicalDataEntities"
            - "app_components"         as alias of "appComponents"
    - Alias handling must occur before the resolver switch/dispatch logic so that resolution
      reuses existing canonical resolution code paths.
    - Unknown types must continue to be safely ignored (no crashes).

  prompt_output:
    - After this fix, resolved context returned from the resolve endpoint MUST include physical
      data entities when they are selected, including their resolved "name" (table/entity name)
      and key fields/attributes if available in the resolver output.

acceptance_criteria:
  - Given a selection containing multiple physical data entity IDs encoded as:
      "physical_data_entities::pde-..."
    the resolve endpoint returns these entities in the resolved entity list with:
      - id matching the original pde id
      - name populated (table/entity name)
      - type indicating the canonical category (physicalDataEntities or equivalent)
  - Mixed selections of applications/services/interfaces/endpoints plus physical data entities
    resolve all entities (no missing PDEs).
  - The Implement Assistant can reference the resolved table/entity names rather than only IDs.
  - No chat failures occur when unknown types are present; they are logged and skipped.

non_goals:
  - No changes to how entity selections are stored in DB
  - No changes to diagram resolution behavior
  - No changes to backlog/meta-model bootstrap injection
```
