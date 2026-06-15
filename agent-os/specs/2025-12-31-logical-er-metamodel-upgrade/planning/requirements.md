# Requirements: Logical ER Meta-Model Upgrade

## Title
Logical ER meta-model upgrade: cardinality + relationship enums and polymorphic endpoints (Logical/Physical)

## Scope

### In Scope
- architecture-model-service: DB schema (Liquibase), JPA entities, DTOs, mappers, service/controller validation
- frontend: Meta-model table for "Logical ER" (fields + editors), types, API DTO alignment

### Out of Scope
- ER diagram canvas rendering changes (symbols/lines)
- ER diagram RHS palette changes
- diagram edge schema changes (diagram will continue to reference LogicalER by id only)

## Goals

1. Rename LogicalER field "type" -> "cardinality" and make it an enum.
2. Add new LogicalER field "relationship" and make it an enum with 6 values.
3. Change LogicalER endpoints from "logical-only" IDs to polymorphic endpoint refs so a LogicalER can connect:
   - LogicalEntity <-> LogicalEntity
   - PhysicalEntity <-> PhysicalEntity
   - LogicalEntity <-> PhysicalEntity

## Definitions

### Cardinality enum (server + client)
- ONE_TO_ONE
- ONE_TO_MANY
- MANY_TO_ONE
- MANY_TO_MANY

### Relationship enum (server + client)
- GENERALIZATION
- REALIZATION
- COMPOSITION
- AGGREGATION
- ASSOCIATION
- DEPENDENCY

### Endpoint kind enum (server + client)
- LOGICAL_ENTITY
- PHYSICAL_ENTITY

## Data Model Changes

### Current LogicalER (logical_data_entity_relationships table)
- id TEXT PK
- model_file_id TEXT FK
- source_entity_id TEXT NOT NULL (FK to logical_data_entities)
- target_entity_id TEXT NOT NULL (FK to logical_data_entities)
- relationship_type TEXT NOT NULL
- description TEXT
- tags TEXT
- valid_from TEXT
- valid_to TEXT

### Target LogicalER columns
- id TEXT PK (unchanged)
- model_file_id TEXT FK (unchanged)
- from_ref_kind TEXT NULL (values constrained to endpoint kind enum)
- from_ref_id TEXT NULL (id of referenced entity table)
- to_ref_kind TEXT NULL
- to_ref_id TEXT NULL
- cardinality TEXT NULL (values constrained to Cardinality enum)
- relationship TEXT NULL (values constrained to Relationship enum)
- description TEXT (unchanged)
- tags TEXT (unchanged)
- valid_from TEXT (unchanged)
- valid_to TEXT (unchanged)

### Notes
- Endpoints are NULLABLE to allow creating relationship rows before wiring endpoints.
- If either ref_kind is non-null, the corresponding ref_id MUST be non-null (pairwise required).
- If ref_id is set, ref_kind MUST be set.

## Backend Implementation Details

### 1. Liquibase migration
Add a new changelog file in the existing liquibase directory and include it in master.

Steps:
a) logical_data_entity_relationships: rename column "relationship_type" -> "cardinality"
b) add columns: from_ref_kind, from_ref_id, to_ref_kind, to_ref_id, relationship
c) data migration: migrate existing logical entity IDs to polymorphic refs:
   - from_ref_kind = 'LOGICAL_ENTITY', from_ref_id = source_entity_id
   - to_ref_kind = 'LOGICAL_ENTITY', to_ref_id = target_entity_id
d) drop legacy columns (source_entity_id, target_entity_id) after migration
e) CHECK constraints for enum values and pairwise constraints

### 2. JPA entity update
Update LogicalDataEntityRelationshipEntity with:
- New fields: fromRefKind, fromRefId, toRefKind, toRefId, relationship
- Rename relationshipType -> cardinality
- Remove sourceEntityId, targetEntityId

### 3. DTO + API contract update
Update LogicalDataEntityRelationshipDto with:
- New fields: from_ref_kind, from_ref_id, to_ref_kind, to_ref_id, relationship
- Rename relationship_type -> cardinality
- Remove source_entity_id, target_entity_id

### 4. Mapper updates
Update EntityMapper to map new fields

### 5. Validation in service/controller
Add validation for pairwise constraints (ref_kind + ref_id must both be set or both null)

### 6. Tests updates
Update ModelServiceSaveTest, ModelServiceLoadTest, etc.

## Frontend Implementation Details

### 1. TypeScript type updates
Update LogicalDataEntityRelationship interface in model.ts:
- New fields: from_ref_kind, from_ref_id, to_ref_kind, to_ref_id, relationship
- Rename relationship_type -> cardinality
- Remove source_entity_id, target_entity_id

Add new enum types:
- LogicalERCardinality
- LogicalERRelationship
- LogicalEREndpointKind

### 2. Meta-model "Logical ER" table UI with dropdowns
Update gridConfigs.ts logical_data_entity_relationships config:
- Replace source_entity_id/target_entity_id with polymorphic endpoint selectors
- Replace relationship_type dropdown with cardinality dropdown
- Add relationship dropdown

Update defaults.ts:
- Add cardinalityOptions array
- Add logicalERRelationshipOptions array
- Add logicalEREndpointKindOptions array

### 3. API alignment
Ensure frontend types match backend DTO structure
