# Raw Idea

title: Fix Add Context Relationship Labels Rendering as "Unknown Relationship" (Pass Entity Lookup)

context:
  In the Implement screen "Add Context" modal, relationship rows (e.g. INTERFACE_LOGICAL_ENTITIES)
  currently render as "Unknown Relationship" instead of the required human-readable format:
    "<NameA> [<TypeA>] | <NameB> [<TypeB>] | ..."
  The relationship label formatter requires access to the meta-model entity map to resolve FK
  participant IDs to names/types. The Implement screen relationship pick-list is currently built
  without providing the entity map, causing the formatter to fall back to the generic
  "Unknown Relationship" label.

goal:
  Ensure all relationships in the Add Context modal render using resolved participant names/types
  in the pipe-separated "<name> [<TYPE>]" format (never "Unknown Relationship" when entities exist).

scope:
  - Frontend only (Implement screen context picker list building)
  - No backend changes
  - Applies to all relationship types shown in the Add Context modal

requirements:
  pass_entities_into_relationship_picklist_builder:
    - Update the code path that builds the relationship options for the Add Context modal in the
      Implement screen to pass the meta-model entities map into the relationship pick-list builder.
    - The pick-list builder must use the entity lookup when computing relationship labels so that
      FK participant IDs resolve to entity names and types.

  do_not_use_fallback_when_entities_available:
    - When the entities map is present and contains the relationship's participant entities, the
      UI must not display "Unknown Relationship".
    - If a participant entity cannot be resolved (missing), only then use the placeholder token
      rule ("Unknown [<TYPE>]") within the composed label, rather than replacing the whole row
      with "Unknown Relationship".

  regression_checks:
    - Verify that INTERFACE_LOGICAL_ENTITIES relationship rows render as:
        "<Interface.name> [INTERFACE] | <Logical/PhysicalEntity.name> [LOGICAL_DATA_ENTITY/PHYSICAL_DATA_ENTITY] ..."
      (pipe-separated, ordered, no IDs)
    - Verify at least one additional relationship type renders with resolved names (not "Unknown Relationship").

acceptance_criteria:
  - In the Add Context modal, relationship rows no longer show "Unknown Relationship" for existing
    relationship records where referenced entities are present in the meta-model.
  - Relationship rows display the required pipe-separated "<name> [<TYPE>]" format.
  - No regression to showing raw IDs in relationship rows.

non_goals:
  - No changes to backend relationship DTOs
  - No changes to relationship selection persistence
  - No UI redesign of the modal beyond label correctness
