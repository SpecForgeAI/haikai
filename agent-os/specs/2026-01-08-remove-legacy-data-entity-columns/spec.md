# Specification: Remove Legacy Data Entity Relationship Columns (Finalize Data Entity Point Migration)

## Goal
Finalize the Data Entity Point migration by removing legacy relationship columns (fromRefKind/fromRefId/toRefKind/toRefId for Logical ER, dataEntityId for Data Movements) and all dual-read/dual-write compatibility logic, making Data Entity Point IDs the single canonical reference.

## User Stories
- As a developer, I want the database schema to be clean and canonical so that there is no ambiguity about which columns hold the authoritative data.
- As an API consumer, I want clear error messages when submitting invalid payloads so that integration issues are caught early.

## Specific Requirements

**DB Migration: Enforce NOT NULL on point-id columns before dropping legacy columns**
- Add precondition check for logical_data_entity_relationships: fail migration if any row has null from_data_entity_point_id OR null to_data_entity_point_id
- Add precondition check for data_movements: fail migration if any row has null data_entity_point_id
- ALTER logical_data_entity_relationships columns from_data_entity_point_id and to_data_entity_point_id to NOT NULL
- ALTER data_movements column data_entity_point_id to NOT NULL
- Migration must fail fast with clear error message if preconditions not met

**DB Migration: Drop legacy columns and constraints from Logical ER**
- Drop columns: from_ref_kind, from_ref_id, to_ref_kind, to_ref_id from logical_data_entity_relationships
- Drop any indexes associated with these legacy columns (idx patterns from migration 009)
- No changes to data_entity_points table or its FK constraints

**DB Migration: Drop legacy column and constraint from Data Movements**
- Drop column: data_entity_id from data_movements
- Drop FK constraint fk_data_movements_entity referencing logical_data_entities
- Drop any indexes associated with data_entity_id column

**Backend JPA Entities: Remove legacy fields**
- Update LogicalDataEntityRelationshipEntity: remove fromRefKind, fromRefId, toRefKind, toRefId fields and their @Column annotations
- Update LogicalDataEntityRelationshipEntity: add nullable=false to @Column for fromDataEntityPointId and toDataEntityPointId
- Update DataMovementEntity: remove dataEntityId field and its @Column annotation
- Update DataMovementEntity: add nullable=false to @Column for dataEntityPointId

**Backend DTOs: Remove legacy fields and enforce required point-id fields**
- Update LogicalDataEntityRelationshipDto record: remove fromRefKind, fromRefId, toRefKind, toRefId parameters
- Update DataMovementDto record: remove dataEntityId parameter
- Ensure fromDataEntityPointId, toDataEntityPointId, and dataEntityPointId are NOT optional in API contract
- Add @JsonIgnoreProperties(ignoreUnknown = false) or similar to ensure legacy field submissions cause 400 errors

**Backend EntityMapper: Remove dual-write logic**
- Update toDto(LogicalDataEntityRelationshipEntity): remove legacy field mappings
- Update toEntity(LogicalDataEntityRelationshipDto): remove legacy field mappings
- Update toDto(DataMovementEntity): remove dataEntityId mapping
- Update toEntity(DataMovementDto): remove dataEntityId mapping

**Backend ModelService: Remove compatibility logic**
- Remove applyDualWriteToRelationship method entirely
- Remove applyDualWriteToDataMovement method entirely
- Remove computeFromDataEntityPointId, computeToDataEntityPointId, computeDataMovementPointId helper methods
- Remove DEP_LOGICAL_PREFIX and DEP_PHYSICAL_PREFIX constants (if not used elsewhere)
- Update saveRelationships: remove .map(this::applyDualWriteToRelationship) and .map(this::applyDualWriteToDataMovement) transformations
- Add validation in saveRelationships: throw 400 if point-id fields are null/blank for these relationship types

**Backend validation: Add service-level validation for point-id fields**
- Add validateLogicalDataEntityRelationshipPointIds method: require fromDataEntityPointId and toDataEntityPointId be present
- Add validateDataMovementPointId method: require dataEntityPointId be present
- Throw IllegalArgumentException with clear error message including relationship ID context
- FK constraints will enforce existence, but service-level checks provide clearer error messages

**Snapshot Export: Point-id only output**
- LogicalDataEntityRelationshipDto in export contains only: id, fromDataEntityPointId, toDataEntityPointId, cardinality, relationship, description, tags, validFrom, validTo
- DataMovementDto in export contains only: id, sourceApplicationPointId, targetApplicationPointId, dataEntityPointId, movementType, description, tags, validFrom, validTo
- Remove any legacy field population from ProjectSnapshotService and related export code

**Snapshot Import: Require point-id fields**
- Reject imports containing legacy fields (fromRefKind, fromRefId, toRefKind, toRefId, dataEntityId)
- Require point-id fields (fromDataEntityPointId, toDataEntityPointId, dataEntityPointId) in import payload
- Return 400 error with clear message if legacy fields detected or point-id fields missing

**Frontend: Remove legacy normalization utilities**
- Delete frontend/src/utils/dataEntityPointNormalization.ts entirely
- Remove normalizeDataEntityPointIds, normalizeLogicalERDataEntityPointIds, normalizeDataMovementDataEntityPointIds functions
- Remove any imports and calls to these functions in fileOperations.ts or model loading paths
- Remove deriveDataEntityPointIdFromEndpoint helper function

**Frontend TypeScript Types: Remove legacy fields**
- Update LogicalDataEntityRelationship interface: remove from_ref_kind, from_ref_id, to_ref_kind, to_ref_id fields
- Update DataMovement interface: remove data_entity_id field
- Keep fromDataEntityPointId, toDataEntityPointId, and dataEntityPointId as required (non-optional) strings

**Frontend Error Handling: Surface data corruption clearly**
- In grid rendering for Logical ER and Data Movements, check for missing point-id fields
- Display validation banner or error state if point-id fields are missing (treat as data corruption)
- Do not silently guess or derive values from missing data

## Existing Code to Leverage

**Database Migrations 022-023**
- Location: architecture-model-service/src/main/resources/db/changelog/sql/022-data-entity-point-fk-columns.sql
- Provides existing FK constraint names (fk_lder_from_data_entity_point, fk_lder_to_data_entity_point, fk_dm_data_entity_point)
- Provides existing index names (idx_lder_from_dep_id, idx_lder_to_dep_id, idx_dm_dep_id)
- Reference these for understanding current schema state

**EntityMapper toDto/toEntity patterns**
- Location: architecture-model-service/src/main/java/com/example/architecturemodel/mapper/EntityMapper.java
- Lines 1308-1354 (LogicalDataEntityRelationship) and 1414-1451 (DataMovement) show current dual-mapping
- Follow existing record constructor pattern when removing parameters

**ModelService validation patterns**
- Location: architecture-model-service/src/main/java/com/example/architecturemodel/service/ModelService.java
- validateLogicalDataEntityRelationship method (lines 1263-1283) shows current pairwise validation pattern
- validateUIWorkflowTransition method (lines 1295-1309) shows required field validation pattern
- Reuse these patterns for point-id validation

**Frontend dataEntityPointNormalization.ts**
- Location: frontend/src/utils/dataEntityPointNormalization.ts
- Document what to remove: normalizeDataEntityPointIds function and its dependencies
- DATA_ENTITY_POINT_PREFIXES constant may be needed elsewhere; check before removing

**Frontend model.ts type definitions**
- Location: frontend/src/types/model.ts
- Lines 1079-1107 (LogicalDataEntityRelationship) and 1158-1181 (DataMovement) show current interface structure
- Remove legacy fields marked with comments about backward compatibility

## Out of Scope
- Changes to data_entity_points table structure or ID generation logic
- Changes to DataEntityPointEntity, DataEntityPointDto, or DataEntityPointEnsureService
- Changes to LogicalDataEntityPhysicalDataEntity or other relationship tables
- Changes to Logical-to-Physical mapping relationships
- Changes to frontend dropdown/picker components (DataEntityPointSelect)
- Addition of new features or UI/UX enhancements
- Changes to diagram rendering or canvas behavior
- Backfill logic (assumed already completed in prior iteration)
- Changes to PackageSet, Package, or other unrelated entities
- Performance optimizations beyond removing unused code
