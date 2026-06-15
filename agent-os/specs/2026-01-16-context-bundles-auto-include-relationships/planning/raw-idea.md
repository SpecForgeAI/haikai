# Context Picker Iteration 3 — Auto-Include Relationships in Expanded Context (No Relationship Selection UI)

## Requirements

```
context:
  Context bundle expansion (Iteration 2) expands selected root items into a set of relevant
  entities and diagrams. However, relationships between included entities (e.g., foreign keys,
  associations, interface/schema links, dependency edges) are not consistently surfaced to the
  Planner LLM. Users should not manually select relationships. Instead, relationships must be
  auto-included as part of the expanded context whenever they connect or explain the selected
  entities.

goal:
  Enhance backend expansion/resolution so that relationships are automatically included and
  returned as structured relationship metadata whenever they are relevant to the expanded
  entity set. The Context Picker UI remains unchanged (relationships are not selectable).

scope:
  - architecture-model-service: expand-resolve output extended to include relationships
  - gateway: inject relationship metadata into highlighted context section
  - frontend: no relationship UI additions and no selection contract changes required
  - No condensed DTO payloads yet (relationships returned as structured metadata)

definitions:
  - Relationship (for this iteration): a structured edge connecting two entities in the
    architecture meta-model, including:
      - data relationships (FK/association, join entities)
      - interface/schema references (endpoint input/output schema usage)
      - service/interface membership links (service exposes interface; interface has endpoints)
      - dependency links where explicitly modelled (uses/calls/depends_on)
  - Auto-included: relationships are derived by the backend; users do not select them.

requirements:
  architecture-model-service_api:
    - Extend the existing expand-resolve response to include relationships:
        {
          ...
          "resolved_relationships": [
            {
              "id": string,
              "type": string,                 # e.g., fk, association, many_to_many, uses, exposes, schema_ref
              "from": { "entityType": string, "entityId": string, "name": string },
              "to":   { "entityType": string, "entityId": string, "name": string },
              "label": string,                # human-friendly short label
              "summaryFields": object         # relationship-specific details (see below)
            }
          ]
        }
    - Backward compatibility:
        - If no relationships exist, return an empty array.

  relationship_inclusion_rules:
    - The service MUST auto-include relationships using these rules:

    rule_1_connectivity:
      - Include any explicit relationship where BOTH endpoints are in the expanded entity set.
      - This applies to data entity relationships and any other explicit meta-model relationship.

    rule_2_interface_schema_usage:
      - For interface bundles that include endpoints and schemas:
          - Include relationships that describe endpoint input/output schema usage:
              - endpoint -> schema (input)
              - endpoint -> schema (output)
          - If schemas are data entities, include the relevant schema_ref relationships.

    rule_3_service_structure_links:
      - For service bundles that include parents/children:
          - Include structural relationships:
              - application -> app_component
              - app_component -> service
              - service -> interface (exposes/implements)
              - interface -> endpoint (contains)
      - These can be derived from explicit links in the meta-model; if the model stores them
        as fields rather than relationship objects, represent them as relationship metadata in
        the response anyway.

    rule_4_data_relationship_details:
      - For physical/logical data entities included via entity_with_attributes_and_relationships:
          - Include direct relationships (depth=1):
              - foreign keys / associations
              - join entities for many-to-many
          - summaryFields SHOULD include:
              - join columns / key fields (if available)
              - cardinality (if available)
              - join entity name (if applicable)

    - The service MUST de-duplicate relationships (same endpoints + type).
    - The service MUST NOT traverse beyond the expanded entity set (no automatic inclusion of
      new entities solely because a relationship exists), except:
        - If the relationship is a many-to-many join entity and the join entity is explicitly
          modelled and NOT already included, it MAY be included only when required to explain
          the relationship, subject to max expansion limits.

  bounding_and_safety:
    - Add response limits:
        - maxResolvedRelationships (configurable, default 500)
    - If truncated, indicate truncation in a response warning field.

  gateway_integration:
    - When the expand-resolve response includes resolved_relationships:
        - Inject them into the "HIGHLIGHTED FEATURE CONTEXT" prompt section under a clear
          "RELATIONSHIPS" subsection.
        - Present relationships in a compact, readable format (type + from.name -> to.name + key fields).

acceptance_criteria:
  - Selecting multiple physical data entities that are related results in resolved_relationships
    containing those FK/association links, using resolved entity names (not IDs).
  - Selecting an interface bundle with endpoints and schemas results in relationships describing:
      - interface contains endpoints
      - endpoints use input/output schemas
  - Selecting a service bundle with parents/children results in structural relationships included:
      - application -> component -> service -> interface -> endpoint
  - No relationship selection UI is introduced; all relationships appear automatically in resolved output.
  - Relationship output is de-duplicated and bounded; system remains stable for large graphs.

non_goals:
  - No UI for manually selecting relationships
  - No condensed LLM DTO payload format yet
  - No deep multi-hop graph traversal beyond the expanded set (except optional join entity handling)
```
