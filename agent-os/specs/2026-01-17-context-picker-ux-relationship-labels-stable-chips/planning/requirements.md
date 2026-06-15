context:
  The Implement "Add Context" modal (Context Picker) now supports selecting entities and
  relationships, but several UX and correctness issues remain:
    - Modal is not tall enough for deep trees.
    - Relationship rows display unreadable IDs (e.g. "interface_logical_entities ile-...").
    - After navigating away and returning, selected context chips sometimes regress to showing
      raw IDs instead of friendly labels (names/relationship descriptors).
  The relationship selection must display consistent, human-readable labels for all 9
  relationship types, with correct handling of optional relationship participants.

goal:
  1) Resize Context Picker modal to 90% viewport height.
  2) Render relationship rows using a deterministic, human-readable label format:
        "<NameA> [<TypeA>] | <NameB> [<TypeB>] | ..."
     for all 9 relationship types, respecting optional participants for certain types.
  3) Ensure selected context summary chips always display desired values (never IDs), including
     after navigation/reload, with aggregation rules based on counts per type and different
     colors for entities/relationships/diagrams.

scope:
  - Frontend only
  - Applies to Context Picker modal and Work Item context summary chips
  - No backend changes required (assumes entity/relationship endpoints can be resolved to names
    already in the loaded architecture state)
  - No changes to selection persistence schema beyond storing sufficient info to render labels
    consistently (see requirements)

requirements:
  1_modal_height:
    - Set Context Picker modal height to 90% of browser viewport height (90vh).
    - Ensure modal body scrolls internally and footer actions (Cancel/Apply) remain visible.

  2_relationship_row_labeling_for_all_9_types:
    - For ALL relationship rows in the Context Picker, do NOT display IDs.
    - Instead, display a computed label composed of relationship participant entities:
        token = "<name> [<TYPE>]"
        label = token1 + " | " + token2 + (" | " + token3 ... as applicable)
    - If a participant entity cannot be resolved to a name:
        - display "Unknown [<TYPE>]" (never an id)
    - Use the following exact label composition rules per relationship type:

    relationship_label_rules:
      1) business_user_business_points:
         - "<BusinessUser.name> [BUSINESS_USER] | <BusinessPoint.name> [BUSINESS_POINT]"
         - Order: BusinessUser, BusinessPoint
         - Optional participants: none

      2) application_point_business_points:
         - "<ApplicationPoint.name> [APPLICATION_POINT] | <BusinessPoint.name> [BUSINESS_POINT]"
         - Order: ApplicationPoint, BusinessPoint
         - Optional participants: none

      3) interactions (optional participants):
         - Include whichever participants exist, in this strict order:
           a) "<BusinessUser.name> [BUSINESS_USER]"
           b) "<AppBusinessPoint.name> [APP_BUSINESS_POINT]"
           c) "<ApplicationPoint.name> [APPLICATION_POINT]"
         - Omit any missing participant(s) but preserve ordering of remaining tokens.

      4) logical_data_entity_relationships (optional participants):
         - Include whichever participants exist, in this strict order:
           a) "<LogicalDataEntity.name> [LOGICAL_DATA_ENTITY]"
           b) "<PhysicalDataEntity.name> [PHYSICAL_DATA_ENTITY]"
           c) "<DataEntityPoint.name> [DATA_ENTITY_POINT]"
         - Omit missing participant(s) but preserve ordering.

      5) logical_data_entity_physical_data_entities:
         - "<LogicalDataEntity.name> [LOGICAL_DATA_ENTITY] | <PhysicalDataEntity.name> [PHYSICAL_DATA_ENTITY]"
         - Order: LogicalDataEntity, PhysicalDataEntity
         - Optional participants: none

      6) logical_data_attribute_physical_data_attributes:
         - "<LogicalDataAttribute.name> [LOGICAL_DATA_ATTRIBUTE] | <PhysicalDataAttribute.name> [PHYSICAL_DATA_ATTRIBUTE]"
         - Order: LogicalDataAttribute, PhysicalDataAttribute
         - Optional participants: none

      7) interface_logical_entities (optional participants):
         - Include whichever participants exist, in this strict order:
           a) "<Interface.name> [INTERFACE]"
           b) "<LogicalDataEntity.name> [LOGICAL_DATA_ENTITY]"
           c) "<PhysicalDataEntity.name> [PHYSICAL_DATA_ENTITY]"
           d) "<DataEntityPoint.name> [DATA_ENTITY_POINT]"
         - Omit missing participant(s) but preserve ordering.

      8) data_movements (optional participants):
         - Include whichever participants exist, in this strict order:
           a) "<SourceApplicationPoint.name> [APPLICATION_POINT]"
           b) "<TargetApplicationPoint.name> [APPLICATION_POINT]"
           c) "<DataEntityPoint.name> [DATA_ENTITY_POINT]"
           d) "<Interface.name> [INTERFACE]"
         - Omit missing participant(s) but preserve ordering.

      9) application_point_business_logics (optional participants):
         - "<ApplicationPoint.name> [APPLICATION_POINT] | <BusinessLogic.name> [BUSINESS_LOGIC]"
         - Order: ApplicationPoint, BusinessLogic
         - Optionality note: if one side is missing, render the remaining token only (do not show id).

    - Ensure the relationship type list shown in each domain's "Relationships" section uses these
      computed labels for row display.

  3_context_summary_chips_never_show_ids_and_follow_new_rules:
    - In the Work Item panel "CONTEXT" summary area, selected items must always display desired
      values and must never regress to raw IDs after navigation/reload.

    desired_value_rules:
      A) diagrams:
         - Render each selected diagram as a purple chip.
         - Chip label must be the diagram name (not id).

      B) entities/relationships single-item display:
         - For architecture domain ENTITIES:
             - if exactly 1 selected of a given entity type, show one BLUE chip with label:
                 "<Entity.name>"
         - For architecture domain RELATIONSHIPS:
             - if exactly 1 selected of a given relationship type, show one GREEN chip with label:
                 computed relationship label from section (2) above.

      C) entities/relationships multi-item aggregation:
         - If >1 selected of a given entity type:
             - show one BLUE aggregated chip: "<N> <PluralTypeName>"
               (e.g., "2 Applications", "3 Physical Data Entities")
         - If >1 selected of a given relationship type:
             - show one GREEN aggregated chip: "<N> <RelationshipTypeLabel>"
               (e.g., "3 Interface <-> Entity")
             - RelationshipTypeLabel must be a human-friendly label per relationship type
               (map relationship type key -> label string).

  4_persistence_and_rehydration_for_labels:
    - Ensure context summary chips can render desired values after navigation/reload without
      relying on transient UI state.
    - Persist (or be able to derive) enough information to re-render:
        - For entity chips: entity name must be resolvable from stored entity_id via loaded
          architecture state; if not yet loaded, render a placeholder then refresh once loaded.
        - For relationship chips: the relationship record must be retrievable from stored
          relationship id/type and then resolved to participant names; do not display ids.
        - For diagrams: diagram name resolved from diagram id.
    - If architecture/diagram data is not yet available at render time:
        - temporarily show "Loading…" for that chip label
        - replace it with desired value once data is available
        - do not permanently fall back to ids.

acceptance_criteria:
  - Context Picker modal height is 90vh and remains usable with internal scrolling.
  - All relationship rows show human-readable labels in the pipe-separated "<name> [<TYPE>]" format
    for all 9 relationship types, with correct handling of optional participants.
  - After selecting context, navigating away and back does not change chips to ids; chips always
    show desired values (or "Loading…" briefly until names resolve).
  - Diagram chips are purple and show diagram names.
  - Entity chips are blue, relationship chips are green, and multi-select aggregation rules apply.

non_goals:
  - No backend expansion logic changes in this spec
  - No changes to Planner prompt contents in this spec
  - No new relationship types beyond the 9 listed
