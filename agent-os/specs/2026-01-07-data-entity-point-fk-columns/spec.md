# Specification: Add Data Entity Point FK Columns to Logical ER and Data Movements

## Goal

Introduce new relationship-side foreign key columns that reference the Data Entity Point superclass for Logical ER and Data Movement relationships, supporting dual-write/dual-read compatibility so both legacy fields and new point-id fields can coexist during transition, without breaking existing data, UI, or legacy snapshots.

## User Stories

- As a system administrator, I want database migrations to add FK columns additively so that existing data remains intact and production deployments are low-risk.
- As a backend developer, I want the save pipeline to dual-write legacy and new point-id fields so that the UI can continue sending legacy fields while the backend prepares for future migration.

## Specific Requirements

**DB Migration: Add FK Columns to logical_data_entity_relationships**
- Add nullable columns: `from_data_entity_point_id` and `to_data_entity_point_id` (varchar/TEXT)
- Add foreign key constraints referencing `data_entity_points(id)` for both columns
- Add indexes on both new columns for query performance
- Do NOT drop or modify existing columns: `from_ref_kind`, `from_ref_id`, `to_ref_kind`, `to_ref_id`
- Use precondition check (columnExists) to make migration idempotent
- Follow existing pattern from 009-logical-er-polymorphic-endpoints.sql for column additions

**DB Migration: Add FK Column to data_movements**
- Add nullable column: `data_entity_point_id` (varchar/TEXT)
- Add foreign key constraint referencing `data_entity_points(id)`
- Add index on the new column
- Do NOT drop or modify existing column: `data_entity_id`
- Use precondition check to make migration idempotent

**DB Backfill: Populate New Columns for Existing Rows**
- For `logical_data_entity_relationships`: if `from_data_entity_point_id` is null and `from_ref_kind`/`from_ref_id` present, compute `from_data_entity_point_id` = `'dep_log_' || from_ref_id` when kind=LOGICAL_ENTITY, or `'dep_phy_' || from_ref_id` when kind=PHYSICAL_ENTITY
- Apply same logic for `to_data_entity_point_id`
- For `data_movements`: if `data_entity_point_id` is null and `data_entity_id` present, set `data_entity_point_id` = `'dep_log_' || data_entity_id`
- Use UPDATE with WHERE clause to ensure idempotency (safe to re-run)
- Rely on prior migration 021-data-entity-points-backfill ensuring points exist

**JPA Entity Updates: LogicalDataEntityRelationshipEntity**
- Add String fields: `fromDataEntityPointId` and `toDataEntityPointId` with @Column annotations
- Keep all existing legacy fields intact: `fromRefKind`, `fromRefId`, `toRefKind`, `toRefId`
- Map as simple String columns (consistent with existing pattern for relationship entities)
- Optional: add @ManyToOne relation to DataEntityPointEntity if needed for joins

**JPA Entity Updates: DataMovementEntity**
- Add String field: `dataEntityPointId` with @Column annotation
- Keep existing legacy field: `dataEntityId`
- Map as simple String column

**DTO Updates: LogicalDataEntityRelationshipDto**
- Add optional fields: `fromDataEntityPointId` and `toDataEntityPointId` with @JsonProperty annotations
- Java records with nullable String fields will deserialize successfully when absent
- Keep existing fields: `fromRefKind`, `fromRefId`, `toRefKind`, `toRefId`

**DTO Updates: DataMovementDto**
- Add optional field: `dataEntityPointId` with @JsonProperty annotation
- Keep existing field: `dataEntityId`

**EntityMapper Updates**
- Update `toDto(LogicalDataEntityRelationshipEntity)` to include new point-id fields
- Update `toEntity(LogicalDataEntityRelationshipDto, modelFileId)` to map new fields
- Update `toDto(DataMovementEntity)` to include new point-id field
- Update `toEntity(DataMovementDto, modelFileId)` to map new field
- Follow existing mapper patterns with field-by-field mapping

**Dual-Write Logic in ModelService.saveRelationships**
- For Logical ER rows: if `fromDataEntityPointId` is null but `fromRefKind`/`fromRefId` present, compute deterministic point id and set it before saving
- Apply same logic for `toDataEntityPointId`
- For Data Movement rows: if `dataEntityPointId` is null but `dataEntityId` present, set `dataEntityPointId` = `'dep_log_' + dataEntityId`
- Validate: any non-null point id must exist in `data_entity_points`; if computed point id does not exist, call `DataEntityPointEnsureService` and retry once
- Add validation logic similar to existing `validateLogicalDataEntityRelationship` method

**Snapshot Export: Dual Representation**
- Export BOTH legacy and new fields for Logical ER rows (from/to_ref_kind/_id + from/toDataEntityPointId)
- Export BOTH legacy and new fields for Data Movement rows (dataEntityId + dataEntityPointId)
- This ensures older frontends/tools can still understand the snapshot while newer ones can migrate
- No changes needed to ProjectSnapshotService; EntityMapper handles field inclusion automatically

**Snapshot Import: Dual-Read Compatibility**
- Accept legacy-only, new-only, or mixed payload shapes
- Prefer new point-id fields if present; else derive from legacy fields
- Always persist new point-id columns (dual-write) regardless of which fields were provided
- Preserve legacy columns as provided (do not delete/overwrite)
- ModelService.saveModel with dual-write logic handles this automatically

**Tests: Schema and Migration**
- Verify new columns exist with correct types and constraints
- Verify foreign keys reference data_entity_points(id)
- Verify backfill populates new columns for existing rows
- Verify backfill is idempotent (running twice produces same result)

**Tests: Service-Level Dual-Write**
- saveModel with legacy-only ER fields results in new point-id fields being persisted
- saveModel with legacy-only dataMovement fields sets dataEntityPointId
- saveModel with new-only point ids persists without requiring legacy fields
- Validation fails if computed point id does not exist after ensure attempt

**Tests: Snapshot Import/Export**
- Export includes both legacy and new fields
- Import legacy-only snapshot fills new point-id fields
- Import new-only snapshot succeeds
- Re-import same snapshot produces stable results (no duplicates, consistent ids)

## Existing Code to Leverage

**DataEntityPointEnsureService**
- Already provides deterministic ID generation: `dep_log_` + logicalEntityId and `dep_phy_` + physicalEntityId
- Can be invoked from ModelService to ensure points exist before saving relationships
- Pattern for validation with retry (ensure, then re-lookup)

**Migration 021-data-entity-points-backfill.sql**
- Template for idempotent backfill using `INSERT INTO ... SELECT ... WHERE NOT EXISTS` pattern
- Demonstrates deterministic ID generation in SQL: `'dep_log_' || lde.id`
- Relies on prior migration creating the data_entity_points table

**Migration 009-logical-er-polymorphic-endpoints.sql**
- Template for adding columns with ALTER TABLE statements
- Pattern for adding CHECK constraints and pairwise null constraints
- Demonstrates data migration with UPDATE statements

**EntityMapper (lines 1303-1418)**
- Existing toDto/toEntity methods for LogicalDataEntityRelationshipEntity and DataMovementEntity
- Field-by-field mapping pattern that should be extended with new fields
- Follow same style for adding new point-id field mappings

**ModelService.saveRelationships (lines 876-939)**
- Existing save logic for relationships including validation
- Pattern for adding pre-save logic (compute derived fields before persisting)
- validateLogicalDataEntityRelationship method provides template for new validation

## Out of Scope

- No frontend picker changes or UI modifications
- No removal of legacy relationship columns (from_ref_kind/_id, to_ref_kind/_id, dataEntityId) - that is a future iteration
- No expansion of Data Movements UI semantics; backend supports point FK but UI remains unchanged
- No changes to other relationships beyond Logical ER and Data Movements
- No addition of @ManyToOne JPA relations unless explicitly needed for queries (simple String mapping preferred)
- No modification of DataEntityPointEntity or DataEntityPointDto
- No changes to the data_entity_points table schema
- No frontend snapshot import/export UI changes
- No Project Snapshot DTO structure changes (existing structure supports new fields automatically)
- No changes to ProjectSnapshotService or ProjectSnapshotImportService (they delegate to ModelService)
