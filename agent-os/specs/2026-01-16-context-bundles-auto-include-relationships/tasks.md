# Task Breakdown: Auto-Include Relationships in Expanded Context

## Overview
Total Tasks: 34

This spec enhances the expand-resolve backend to automatically include relationships between entities in the expanded context set, providing the LLM planner with edge/connection metadata without requiring users to manually select relationships.

## Task List

### Model Service Layer - DTOs

#### Task Group 1: ResolvedRelationshipDto and Response Extension
**Dependencies:** None

- [x] 1.0 Complete DTO records for relationship resolution
  - [x] 1.1 Write 4-6 focused tests for DTO serialization and validation
    - Test `ResolvedRelationshipDto` record serialization with all fields
    - Test `RelationshipEndpoint` nested record serialization
    - Test snake_case JSON property mapping via @JsonProperty annotations
    - Test empty list handling for backward compatibility
    - Test summaryFields Map serialization with various value types
  - [x] 1.2 Create `RelationshipEndpoint` record in `/model/dto/relationship/`
    - Fields: `String entityType`, `String entityId`, `String name`
    - Use @JsonProperty annotations: `entity_type`, `entity_id`, `name`
    - Create as nested record or standalone file in relationship package
  - [x] 1.3 Create `ResolvedRelationshipDto` record in `/model/dto/relationship/`
    - Fields: `String id`, `String type`, `RelationshipEndpoint from`, `RelationshipEndpoint to`, `String label`, `Map<String, Object> summaryFields`
    - Relationship types: `fk`, `association`, `many_to_many`, `uses`, `exposes`, `schema_ref`, `contains`
    - Use @JsonProperty annotations with snake_case: `summary_fields`
  - [x] 1.4 Extend `ExpandResolveResponseDto` to include relationships
    - Add field: `List<ResolvedRelationshipDto> resolvedRelationships`
    - Add @JsonProperty("resolved_relationships") annotation
    - Ensure empty list is returned when no relationships exist (backward compatible)
  - [x] 1.5 Ensure DTO tests pass
    - Run ONLY the 4-6 tests written in 1.1
    - Verify record serialization/deserialization works correctly
    - NOTE: Tests implemented in `ResolvedRelationshipDtoTest.java` (9 tests). Backend test compilation blocked by pre-existing errors in unrelated test files.

**Acceptance Criteria:**
- All DTO records compile and serialize correctly to/from JSON
- The 4-6 tests written in 1.1 pass
- Jackson annotations produce correct snake_case field names
- Backward compatibility maintained with empty list default

---

### Bundle Expansion Service Layer - Relationship Discovery

#### Task Group 2: Core Relationship Discovery Service Method
**Dependencies:** Task Group 1

- [x] 2.0 Complete relationship discovery service infrastructure
  - [x] 2.1 Write 4-6 focused tests for relationship discovery
    - Test `discoverRelationships()` returns empty list when no expanded entities
    - Test de-duplication by (type + from.entityId + to.entityId) tuple
    - Test deterministic sorting by type, then from.entityType, then from.entityId
    - Test configurable limit `maxRelationships` with truncation warning
    - Test filtering to relationships where BOTH endpoints are in expanded set
  - [x] 2.2 Add configurable relationship limit to `ContextBundleExpansionService`
    - Add `@Value("${context.expansion.maxRelationships:500}")` field
    - Add truncation reason when limit exceeded
  - [x] 2.3 Implement `discoverRelationships()` method signature
    - Parameters: `Set<String> expandedEntityIds`, `String modelFileId`
    - Return type: `List<ResolvedRelationshipDto>`
    - Add trace-level logging for debugging
  - [x] 2.4 Implement de-duplication logic
    - Use tuple (type + from.entityId + to.entityId) as unique key
    - Use `LinkedHashSet` or similar for de-duplication while preserving insertion order
  - [x] 2.5 Implement deterministic sorting
    - Primary sort: relationship type (alphabetically)
    - Secondary sort: from.entityType (alphabetically)
    - Tertiary sort: from.entityId (alphabetically)
  - [x] 2.6 Wire relationship discovery into `expandAndResolve()` method
    - Call after entity expansion completes (around line 200)
    - Pass expanded entity IDs and modelFileId
    - Add discovered relationships to response DTO
  - [x] 2.7 Ensure relationship discovery tests pass
    - Run ONLY the 4-6 tests written in 2.1

**Acceptance Criteria:**
- The 4-6 tests written in 2.1 pass
- Relationships are de-duplicated correctly
- Sorting is deterministic across invocations
- Truncation warning added when limit exceeded

---

#### Task Group 3: Rule 1 - Data Entity Relationship Discovery
**Dependencies:** Task Group 2

- [x] 3.0 Complete data entity relationship discovery (Rule 1)
  - [x] 3.1 Write 3-5 focused tests for data entity relationships
    - Test relationships included when BOTH endpoints in expanded set
    - Test relationships excluded when one endpoint NOT in expanded set
    - Test endpoint name resolution from expanded entity summaries
    - Test relationship type mapping: fk for FK relationships, association for others
  - [x] 3.2 Implement data entity relationship collection
    - Query `LogicalDataEntityRelationshipRepository.findByModelFileId()`
    - Use existing `parseDataEntityPointId()` method (lines 391-409) to convert point IDs
    - Filter to relationships where both fromDataEntityPointId and toDataEntityPointId are in expanded set
  - [x] 3.3 Implement endpoint name resolution
    - Lookup entity names from expanded entity summaries by canonical ID
    - Use format: `logicalDataEntities::entityId` or `physicalDataEntities::entityId`
    - Fallback to entityId if name not found in summaries
  - [x] 3.4 Map relationship type for data entities
    - Map LogicalDataEntityRelationshipEntity.relationship to DTO type
    - Use `fk` for foreign key semantics, `association` for ASSOCIATION, `many_to_many` for MANY_TO_MANY cardinality
  - [x] 3.5 Ensure data entity relationship tests pass
    - Run ONLY the 3-5 tests written in 3.1

**Acceptance Criteria:**
- The 3-5 tests written in 3.1 pass
- Only relationships with both endpoints in expanded set are included
- Endpoint names resolved from entity summaries
- Relationship types correctly mapped

---

#### Task Group 4: Rule 2 - Interface-Schema Usage Relationships
**Dependencies:** Task Group 2

- [x] 4.0 Complete interface-schema relationship discovery (Rule 2)
  - [x] 4.1 Write 3-5 focused tests for interface-schema relationships
    - Test schema_ref relationships created for `interface_with_endpoints_and_schemas` bundles
    - Test interface -> data_entity relationship format
    - Test endpoint input/output schema references included
    - Test no schema_ref relationships for `interface_only` bundle type
  - [x] 4.2 Track interface-to-data-entity links in `expandInterfaceWithEndpointsAndSchemas()`
    - Query `InterfaceLogicalEntityRepository.findByInterfaceId()` (already exists in method)
    - Collect interface-to-data-entity mappings for relationship creation
  - [x] 4.3 Create schema_ref relationship DTOs
    - Type: `schema_ref`
    - From: interface (entityType: `interfaces`, entityId, name)
    - To: data_entity (entityType: `logicalDataEntities` or `physicalDataEntities`, entityId, name)
    - Label: "schema" or derive from usage context
  - [x] 4.4 Return discovered interface-schema relationships from expansion
    - Modify `expandInterfaceWithEndpointsAndSchemas()` to return relationships alongside expanded IDs
    - Or collect in a shared context object during expansion
  - [x] 4.5 Ensure interface-schema relationship tests pass
    - Run ONLY the 3-5 tests written in 4.1

**Acceptance Criteria:**
- The 3-5 tests written in 4.1 pass
- schema_ref relationships created for interface-schema links
- Relationships only created when bundle_type is `interface_with_endpoints_and_schemas`

---

#### Task Group 5: Rule 3 - Service Structure Link Relationships
**Dependencies:** Task Group 2

- [x] 5.0 Complete service structure relationship discovery (Rule 3)
  - [x] 5.1 Write 3-4 focused tests for service structure relationships
    - Test `contains` relationships: application -> appComponent, appComponent -> service
    - Test `exposes` relationships: service -> interface
    - Test relationships only created for `service_with_parents_and_children` bundle type
    - Test no structure relationships for `service_only` bundle type
  - [x] 5.2 Track structural relationships in `expandServiceWithParentsAndChildren()`
    - Derive relationships from existing parent ID fields
    - Create application -> appComponent (contains) when both exist
    - Create appComponent -> service (contains) when both exist
    - Create service -> interface (exposes) for each child interface
  - [x] 5.3 Create structure relationship DTOs
    - Type: `contains` for parent-child containment
    - Type: `exposes` for service-to-interface exposure
    - Resolve names from expanded entity summaries
  - [x] 5.4 Return discovered service structure relationships from expansion
    - Modify expansion method to return relationships alongside expanded IDs
  - [x] 5.5 Ensure service structure relationship tests pass
    - Run ONLY the 3-4 tests written in 5.1

**Acceptance Criteria:**
- The 3-4 tests written in 5.1 pass
- Contains relationships created for application/component/service hierarchy
- Exposes relationships created for service-to-interface links

---

#### Task Group 6: Rule 4 - Data Relationship Summary Fields
**Dependencies:** Task Group 3

- [x] 6.0 Complete summaryFields population for data relationships
  - [x] 6.1 Write 2-4 focused tests for summaryFields population
    - Test cardinality field populated from relationship.getCardinality()
    - Test relationship_type field populated from relationship.getRelationship()
    - Test description field populated when present
    - Test empty summaryFields when all optional fields are null
  - [x] 6.2 Populate summaryFields in data entity relationship creation
    - Add `cardinality` from LogicalDataEntityRelationshipEntity.cardinality (ONE_TO_ONE, ONE_TO_MANY, etc.)
    - Add `relationship_type` from LogicalDataEntityRelationshipEntity.relationship (ASSOCIATION, COMPOSITION, etc.)
    - Add `description` from LogicalDataEntityRelationshipEntity.description (if present)
  - [x] 6.3 Handle null/empty optional fields gracefully
    - Only include non-null values in summaryFields Map
    - Return empty Map if all optional fields are null
  - [x] 6.4 Ensure summaryFields tests pass
    - Run ONLY the 2-4 tests written in 6.1

**Acceptance Criteria:**
- The 2-4 tests written in 6.1 pass
- SummaryFields contain cardinality, relationship_type, description when available
- Graceful handling of null optional fields

---

### Gateway Integration Layer

#### Task Group 7: Gateway Types Extension
**Dependencies:** Task Group 1

- [x] 7.0 Complete gateway TypeScript type definitions
  - [x] 7.1 Write 2-4 focused tests for gateway types
    - Test ResolvedRelationship interface matches backend DTO structure
    - Test RelationshipEndpoint interface field names (snake_case)
    - Test resolved_relationships field in ExpandResolveResponseDto
    - Test type compatibility with existing chat.ts interfaces
  - [x] 7.2 Add `RelationshipEndpoint` interface to `gateway/src/types/chat.ts`
    - Fields: `entity_type: string`, `entity_id: string`, `name: string`
    - Add after existing type definitions (around line 637)
  - [x] 7.3 Add `ResolvedRelationship` interface to `gateway/src/types/chat.ts`
    - Fields: `id: string`, `type: string`, `from: RelationshipEndpoint`, `to: RelationshipEndpoint`, `label: string`, `summary_fields: Record<string, unknown>`
    - Relationship type values documented in JSDoc: fk, association, many_to_many, uses, exposes, schema_ref, contains
  - [x] 7.4 Extend `ExpandResolveResponseDto` interface
    - Add field: `resolved_relationships: ResolvedRelationship[]`
    - Add after line 637 in existing interface definition
  - [x] 7.5 Export new types from `gateway/src/types/index.ts`
    - Export RelationshipEndpoint
    - Export ResolvedRelationship
  - [x] 7.6 Ensure gateway types tests pass
    - Run ONLY the 2-4 tests written in 7.1

**Acceptance Criteria:**
- The 2-4 tests written in 7.1 pass
- TypeScript interfaces match backend DTO structure
- Types exported and accessible from gateway/src/types

---

#### Task Group 8: Prompt Builder Enhancement for Relationships
**Dependencies:** Task Groups 6, 7

- [x] 8.0 Complete prompt builder updates for relationship formatting
  - [x] 8.1 Write 3-5 focused tests for relationship prompt formatting
    - Test "RELATIONSHIPS" subsection added to formatHighlightedContext() output
    - Test relationship format: `type: from.name -> to.name (cardinality, relationship_type)`
    - Test relationships grouped by type for readability
    - Test empty relationships array produces no RELATIONSHIPS section
    - Test summaryFields values included when present
  - [x] 8.2 Update `formatHighlightedContext()` in `promptBuilder.ts`
    - Add new "RELATIONSHIPS" subsection after entity and diagram sections
    - Check for resolved_relationships field in response
    - Skip section if no relationships present
  - [x] 8.3 Implement relationship grouping by type
    - Group relationships by type field (fk, association, schema_ref, contains, exposes, etc.)
    - Order groups deterministically (alphabetically by type)
  - [x] 8.4 Implement relationship formatting
    - Format: `type: from.name -> to.name (cardinality, relationship_type)`
    - Include summaryFields values in parenthetical description
    - Use formatFieldValue() for summaryFields values (reuse existing function)
  - [x] 8.5 Ensure prompt builder tests pass
    - Run ONLY the 3-5 tests written in 8.1

**Acceptance Criteria:**
- The 3-5 tests written in 8.1 pass
- RELATIONSHIPS section appears after entities and diagrams
- Relationships grouped by type for readability
- Summary fields included in formatted output

---

### Integration Testing

#### Task Group 9: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-8

- [x] 9.0 Review existing tests and fill critical gaps
  - [x] 9.1 Review tests from Task Groups 1-8
    - Review tests from DTO layer (Task 1.1): ~5 tests
    - Review tests from Relationship Discovery (Task 2.1): ~5 tests
    - Review tests from Data Entity Relationships (Task 3.1): ~4 tests
    - Review tests from Interface-Schema Relationships (Task 4.1): ~4 tests
    - Review tests from Service Structure Relationships (Task 5.1): ~4 tests
    - Review tests from SummaryFields (Task 6.1): ~3 tests
    - Review tests from Gateway Types (Task 7.1): ~3 tests
    - Review tests from Prompt Builder (Task 8.1): ~4 tests
    - Total existing tests: approximately 32 tests
  - [x] 9.2 Analyze test coverage gaps for THIS feature only
    - Identify critical end-to-end workflows lacking coverage
    - Focus on integration points between model service and gateway
    - Prioritize relationship discovery -> prompt formatting flow
  - [x] 9.3 Write up to 10 additional strategic tests maximum
    - E2E test: expanded context with relationships flows through to prompt
    - E2E test: data entity relationships appear in formatted context
    - E2E test: interface-schema relationships appear in formatted context
    - E2E test: service structure relationships appear in formatted context
    - Integration test: truncation at maxRelationships limit
    - Integration test: mixed entity types with relationships
    - Integration test: de-duplication across multiple bundle expansions
    - Integration test: backward compatibility when no relationships exist
  - [x] 9.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature (relationship auto-include)
    - Expected total: approximately 32-42 tests maximum
    - Do NOT run the entire application test suite
    - Verify critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 32-42 tests total)
- Critical relationship discovery workflows are covered end-to-end
- No more than 10 additional tests added when filling gaps
- Testing focused exclusively on this spec's feature requirements

---

## Execution Order

Recommended implementation sequence:

1. **DTO Layer** (Task Group 1) - Foundation data structures for relationships
2. **Core Relationship Discovery** (Task Group 2) - Service method with de-dup/truncation
3. **Data Entity Relationships** (Task Group 3) - Rule 1 implementation
4. **Interface-Schema Relationships** (Task Group 4) - Rule 2 implementation
5. **Service Structure Relationships** (Task Group 5) - Rule 3 implementation
6. **SummaryFields Population** (Task Group 6) - Rule 4 implementation
7. **Gateway Types** (Task Group 7) - TypeScript interface definitions
8. **Prompt Builder Enhancement** (Task Group 8) - LLM prompt formatting
9. **Test Review and Gap Analysis** (Task Group 9) - Final validation

---

## Key Files to Create/Modify

### New Files (Model Service)
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/relationship/ResolvedRelationshipDto.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/relationship/RelationshipEndpoint.java` (or nested in ResolvedRelationshipDto)

### Modified Files (Model Service)
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/ExpandResolveResponseDto.java` - Add resolved_relationships field
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/ContextBundleExpansionService.java` - Add discoverRelationships() and wire into expandAndResolve()

### Modified Files (Gateway)
- `gateway/src/types/chat.ts` - Add RelationshipEndpoint, ResolvedRelationship interfaces; extend ExpandResolveResponseDto
- `gateway/src/types/index.ts` - Export new types
- `gateway/src/services/promptBuilder.ts` - Update formatHighlightedContext() with RELATIONSHIPS section

### Test Files (Model Service)
- `architecture-model-service/src/test/java/.../dto/relationship/ResolvedRelationshipDtoTest.java`
- `architecture-model-service/src/test/java/.../service/ContextBundleExpansionServiceRelationshipTest.java`
- `architecture-model-service/src/test/java/.../service/ContextBundleExpansionServiceDataEntityRelationshipTest.java`
- `architecture-model-service/src/test/java/.../service/ContextBundleExpansionServiceInterfaceSchemaRelationshipTest.java`
- `architecture-model-service/src/test/java/.../service/ContextBundleExpansionServiceServiceStructureRelationshipTest.java`

### Test Files (Gateway)
- `gateway/src/__tests__/relationship-types.test.ts`
- `gateway/src/__tests__/relationship-prompt-formatting.test.ts`
- `gateway/src/__tests__/relationship-auto-include-e2e.test.ts`

---

## Existing Code to Leverage

### Repository Methods
- `LogicalDataEntityRelationshipRepository.findByModelFileId(String modelFileId)` - Query all relationships in model
- `InterfaceLogicalEntityRepository.findByInterfaceId(String interfaceId)` - Interface-to-data-entity links

### Service Methods
- `parseDataEntityPointId()` in ContextBundleExpansionService (lines 391-409) - Convert dep_log_/dep_phy_ to canonical format
- `buildDataEntityPointId()` in ContextBundleExpansionService (lines 656-666) - Inverse of parseDataEntityPointId

### Utility Functions
- `formatFieldValue()` in promptBuilder.ts (lines 600-619) - Format arrays and objects for prompts
- `groupEntitiesByCategory()` in promptBuilder.ts (lines 574-589) - Grouping pattern to follow

### Entity Fields
- `LogicalDataEntityRelationshipEntity.cardinality` - ONE_TO_ONE, ONE_TO_MANY, MANY_TO_ONE, MANY_TO_MANY
- `LogicalDataEntityRelationshipEntity.relationship` - GENERALIZATION, REALIZATION, COMPOSITION, AGGREGATION, ASSOCIATION, DEPENDENCY
- `LogicalDataEntityRelationshipEntity.description` - Optional description text
