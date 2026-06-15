# Specification: Logical ER Meta-Model Upgrade

## Goal
Upgrade the LogicalDataEntityRelationship meta-model to support UML-style relationship semantics (cardinality + relationship type enums) and enable polymorphic endpoints that can connect LogicalEntity and/or PhysicalEntity nodes.

## User Stories
- As an architect, I want to specify relationship types (GENERALIZATION, COMPOSITION, etc.) so that I can model ER diagrams with proper UML semantics.
- As an architect, I want to connect LogicalEntity to PhysicalEntity nodes so that I can visualize cross-domain data relationships.

## Specific Requirements

**Liquibase Migration (009-logical-er-polymorphic-endpoints.sql)**
- Create new changelog file following existing pattern in db/changelog/sql/
- Rename column relationship_type to cardinality
- Add columns: from_ref_kind, from_ref_id, to_ref_kind, to_ref_id, relationship
- Migrate existing data: set from_ref_kind='LOGICAL_ENTITY', from_ref_id=source_entity_id, to_ref_kind='LOGICAL_ENTITY', to_ref_id=target_entity_id
- Drop legacy columns source_entity_id and target_entity_id after data migration
- Add CHECK constraints for enum values and pairwise null/non-null validation
- Include in db.changelog-master.yaml as changeSet id: 009-logical-er-polymorphic-endpoints

**Cardinality Enum Definition**
- Values: ONE_TO_ONE, ONE_TO_MANY, MANY_TO_ONE, MANY_TO_MANY
- Stored as TEXT in database, validated via CHECK constraint
- Replaces the old relationship_type field which had values like 'one-to-one'
- Field is nullable to allow partial relationship definition

**Relationship Enum Definition**
- Values: GENERALIZATION, REALIZATION, COMPOSITION, AGGREGATION, ASSOCIATION, DEPENDENCY
- New field for specifying UML relationship semantics
- Field is nullable; defaults to ASSOCIATION conceptually in rendering (out of scope)

**Endpoint Kind Enum Definition**
- Values: LOGICAL_ENTITY, PHYSICAL_ENTITY
- Used by from_ref_kind and to_ref_kind fields
- Determines which entity table the ref_id references

**JPA Entity Update (LogicalDataEntityRelationshipEntity.java)**
- Remove fields: sourceEntityId, targetEntityId
- Add fields: fromRefKind (String), fromRefId (String), toRefKind (String), toRefId (String), relationship (String)
- Rename field: relationshipType to cardinality
- Update @Column annotations to match new database column names

**DTO Update (LogicalDataEntityRelationshipDto.java)**
- Remove record parameters: sourceEntityId, targetEntityId
- Add record parameters: fromRefKind, fromRefId, toRefKind, toRefId, relationship
- Rename parameter: relationshipType to cardinality
- Update @JsonProperty annotations for snake_case API contract

**EntityMapper Update**
- Update toDto() method to map new fields from entity to DTO
- Update toEntity() method to map new fields from DTO to entity
- Remove sourceEntityId/targetEntityId mapping, add polymorphic field mapping

**Frontend TypeScript Type Update (model.ts)**
- Remove fields: source_entity_id, target_entity_id
- Add fields: from_ref_kind, from_ref_id, to_ref_kind, to_ref_id, relationship
- Rename field: relationship_type to cardinality
- Add new type aliases: LogicalERCardinality, LogicalERRelationship, LogicalEREndpointKind

**Frontend Grid Configuration Update (gridConfigs.ts)**
- Update logical_data_entity_relationships config to remove source_entity_id and target_entity_id columns
- Add from_ref_kind dropdown with LOGICAL_ENTITY/PHYSICAL_ENTITY options
- Add from_ref_id as fk_typeahead (dynamic target based on ref_kind - implementation detail)
- Add to_ref_kind and to_ref_id columns similarly
- Replace relationship_type dropdown with cardinality dropdown using new enum options
- Add relationship dropdown with new enum options

**Frontend Defaults Update (defaults.ts)**
- Add cardinalityOptions array: ['ONE_TO_ONE', 'ONE_TO_MANY', 'MANY_TO_ONE', 'MANY_TO_MANY']
- Add logicalERRelationshipOptions array: ['GENERALIZATION', 'REALIZATION', 'COMPOSITION', 'AGGREGATION', 'ASSOCIATION', 'DEPENDENCY']
- Add logicalEREndpointKindOptions array: ['LOGICAL_ENTITY', 'PHYSICAL_ENTITY']
- Remove or deprecate existing relationshipTypeOptions (currently ['one-to-one', 'one-to-many', 'many-to-many'])

## Existing Code to Leverage

**LogicalDataEntityRelationshipEntity.java**
- Located at: architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/LogicalDataEntityRelationshipEntity.java
- Current structure has id, modelFileId, sourceEntityId, targetEntityId, relationshipType, description, tags, validFrom, validTo
- Uses Lombok @Builder, @Getter, @Setter annotations - follow same pattern for new fields

**LogicalDataEntityRelationshipDto.java**
- Located at: architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/relationship/LogicalDataEntityRelationshipDto.java
- Uses Java record syntax with @JsonProperty annotations for snake_case mapping
- Follow existing pattern for new fields

**EntityMapper.java**
- Located at: architecture-model-service/src/main/java/com/example/architecturemodel/mapper/EntityMapper.java
- Has existing toDto/toEntity methods for LogicalDataEntityRelationship at lines 874-899
- Update these methods to handle renamed and new fields

**Liquibase Migration Pattern**
- Existing migrations in: architecture-model-service/src/main/resources/db/changelog/sql/
- Follow pattern from 004-states-state-transitions.sql for CHECK constraints
- Include in db.changelog-master.yaml following existing changeSet pattern (preconditions, sqlFile reference)

**Frontend gridConfigs.ts**
- Located at: frontend/src/config/gridConfigs.ts
- Current logical_data_entity_relationships config at lines 313-322
- Uses fk_typeahead cellType for FK references, dropdown cellType for enums

## Out of Scope
- ER diagram canvas rendering changes (arrow heads, line styles for different relationship types)
- ER diagram RHS palette changes
- Diagram edge schema changes - diagram_edges will continue to reference relationship by ID only
- FK constraint enforcement at database level for polymorphic refs (runtime validation only)
- UI for dynamically filtering ref_id dropdown based on selected ref_kind
- Backward compatibility layer for old API contract (breaking change)
- Data validation for orphaned relationships after migration
- Frontend validation for pairwise ref_kind/ref_id constraints
- Integration with existing diagram edge rendering logic
