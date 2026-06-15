# Specification: Auto-Include Relationships in Expanded Context

## Goal
Enhance the expand-resolve backend to automatically include relationships between entities in the expanded context set, providing the LLM planner with edge/connection metadata without requiring users to manually select relationships.

## User Stories
- As a planner LLM, I want to see relationships (FK, associations, interface-schema links) between expanded entities so that I can understand how they connect and produce better implementation plans.
- As a user selecting data entities for context, I want related FK/association links to be automatically included so that I do not have to manually identify and select them.

## Specific Requirements

**New ResolvedRelationship DTO**
- Create new DTO at `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/relationship/ResolvedRelationshipDto.java`
- Fields: id (String), type (String: fk, association, many_to_many, uses, exposes, schema_ref, contains), from (RelationshipEndpoint), to (RelationshipEndpoint), label (String), summaryFields (Map<String, Object>)
- Create nested RelationshipEndpoint record with: entityType (String), entityId (String), name (String)
- Use @JsonProperty annotations with snake_case for API consistency

**Extend ExpandResolveResponseDto**
- Add new field `resolved_relationships` of type `List<ResolvedRelationshipDto>` to `ExpandResolveResponseDto.java` (line 21-39)
- Add @JsonProperty("resolved_relationships") annotation
- Update record constructor at line 21 to include the new parameter
- Ensure empty list is returned when no relationships exist (backward compatible)

**Rule 1: Connectivity - Data Entity Relationships**
- In `ContextBundleExpansionService.java`, after entity expansion completes (around line 196), collect all data entity relationships where BOTH endpoints are in the expanded entity set
- Query `LogicalDataEntityRelationshipRepository.findByModelFileId()` to get all relationships
- Filter to relationships where both fromDataEntityPointId and toDataEntityPointId parse to IDs in the expanded set
- Resolve endpoint names by looking up entity names from the expanded entity summaries

**Rule 2: Interface-Schema Usage Relationships**
- For interfaces expanded with bundle_type `interface_with_endpoints_and_schemas`, include schema_ref relationships
- In `expandInterfaceWithEndpointsAndSchemas()` method (lines 349-379), track the interface-to-data-entity links from `InterfaceLogicalEntityRepository.findByInterfaceId()`
- Create schema_ref type relationships: interface -> data_entity (schema)
- Include endpoint input/output schema references by checking endpoint configurations

**Rule 3: Service Structure Links**
- For services expanded with bundle_type `service_with_parents_and_children`, include structural relationships
- In `expandServiceWithParentsAndChildren()` method (lines 473-519), create relationships for:
  - application -> appComponent (contains)
  - appComponent -> service (contains)
  - service -> interface (exposes)
- Derive from existing parent ID fields (applicationId, applicationComponentId, serviceId)

**Rule 4: Data Relationship Details in summaryFields**
- For LogicalDataEntityRelationshipEntity relationships, populate summaryFields with:
  - cardinality (from relationship.getCardinality())
  - relationship type (from relationship.getRelationship() - ASSOCIATION, COMPOSITION, etc.)
  - description (if present)
- These fields exist on `LogicalDataEntityRelationshipEntity.java` (lines 53-70)

**Relationship Discovery Service Method**
- Add new method `discoverRelationships(Set<String> expandedEntityIds, String modelFileId)` to `ContextBundleExpansionService.java`
- Return `List<ResolvedRelationshipDto>` with de-duplicated relationships
- Call this method after entity expansion, before building the response (around line 200)
- Use existing `parseDataEntityPointId()` method (lines 391-409) to convert point IDs to canonical IDs

**De-duplication and Bounds**
- Add configurable limit `@Value("${context.expansion.maxRelationships:500}")` for max relationships
- De-duplicate by (type + from.entityId + to.entityId) tuple
- Add truncation warning to truncationReasons if relationship limit exceeded
- Sort relationships deterministically by type, then from.entityType, then from.entityId

**Gateway Types Extension**
- Add ResolvedRelationship interface to `gateway/src/types/chat.ts` after line 637
- Add RelationshipEndpoint interface with: entity_type (string), entity_id (string), name (string)
- Add resolved_relationships field to ExpandResolveResponseDto interface (line 624-637)

**Gateway Prompt Formatting**
- In `promptBuilder.ts`, update `formatHighlightedContext()` function (lines 639-693)
- Add new "RELATIONSHIPS" subsection after entity and diagram sections
- Format as: `type: from.name -> to.name (cardinality, relationship_type)`
- Group relationships by type for readability

## Existing Code to Leverage

**LogicalDataEntityRelationshipRepository (lines 1-15)**
- Already has `findByModelFileId(String modelFileId)` method for querying all relationships in a model
- Entity contains fromDataEntityPointId, toDataEntityPointId, cardinality, relationship fields

**InterfaceLogicalEntityRepository (lines 1-17)**
- Has `findByInterfaceId(String interfaceId)` for interface-to-data-entity links
- Entity contains dataEntityPointId for schema references

**parseDataEntityPointId() in ContextBundleExpansionService (lines 391-409)**
- Converts dep_log_/dep_phy_ prefixed IDs to canonical entityType::entityId format
- Reuse for relationship endpoint resolution

**buildDataEntityPointId() in ContextBundleExpansionService (lines 656-666)**
- Inverse of parseDataEntityPointId, builds point IDs from entityType + entityId
- Useful for matching relationships to expanded entities

**formatFieldValue() in promptBuilder.ts (lines 600-619)**
- Already handles arrays and objects for prompt formatting
- Reuse for formatting relationship summaryFields

## Out of Scope
- UI for manually selecting relationships (relationships are auto-included only)
- Condensed/abbreviated DTO payload format for LLM tokens
- Multi-hop graph traversal beyond depth=1 relationships
- Join entity auto-inclusion (only include if already in expanded set)
- Relationship selection checkboxes or UI controls
- Relationship filtering or exclusion by user
- Cross-model-file relationship discovery
- Real-time relationship updates or WebSocket notifications
- Relationship caching or memoization layer
- Relationship validation or integrity checking
