# Task Breakdown: Data Entity Point FK Columns for Logical ER and Data Movements

## Overview
Total Tasks: 30 (across 4 task groups)

This feature introduces new foreign key columns referencing the Data Entity Point superclass for Logical ER and Data Movement relationships. The implementation supports dual-write/dual-read compatibility, allowing both legacy fields and new point-id fields to coexist during the transition period.

## File Locations Summary

**Database Migrations:**
- `architecture-model-service/src/main/resources/db/changelog/sql/022-data-entity-point-fk-columns.sql`
- `architecture-model-service/src/main/resources/db/changelog/sql/023-data-entity-point-fk-backfill.sql`
- `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml`

**JPA Entities:**
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/LogicalDataEntityRelationshipEntity.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/DataMovementEntity.java`

**DTOs:**
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/relationship/LogicalDataEntityRelationshipDto.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/relationship/DataMovementDto.java`

**Mappers and Services:**
- `architecture-model-service/src/main/java/com/example/architecturemodel/mapper/EntityMapper.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/ModelService.java`

**Tests:**
- `architecture-model-service/src/test/java/com/example/architecturemodel/migration/DataEntityPointFkColumnsMigrationTest.java`
- `architecture-model-service/src/test/java/com/example/architecturemodel/service/DataEntityPointFkDualWriteTest.java`
- `architecture-model-service/src/test/java/com/example/architecturemodel/integration/DataEntityPointFkSnapshotIntegrationTest.java`

---

## Task List

### Database Layer

#### Task Group 1: Database Migrations for FK Columns
**Dependencies:** None (must run after existing migration 021-data-entity-points-backfill)

- [x] 1.0 Complete database migration layer for Data Entity Point FK columns
  - [x] 1.1 Write 4-6 focused tests for migration functionality
    - Test: Verify `from_data_entity_point_id` column exists in `logical_data_entity_relationships` table
    - Test: Verify `to_data_entity_point_id` column exists in `logical_data_entity_relationships` table
    - Test: Verify `data_entity_point_id` column exists in `data_movements` table
    - Test: Verify foreign key constraints reference `data_entity_points(id)` for all new columns
    - Test: Verify indexes exist on new columns for query performance
    - Test: Verify migration is idempotent (running twice produces no errors)
    - File: `architecture-model-service/src/test/java/com/example/architecturemodel/migration/DataEntityPointFkColumnsMigrationTest.java`
  - [x] 1.2 Create migration 022-data-entity-point-fk-columns.sql
    - Add nullable column `from_data_entity_point_id` (TEXT) to `logical_data_entity_relationships`
    - Add nullable column `to_data_entity_point_id` (TEXT) to `logical_data_entity_relationships`
    - Add nullable column `data_entity_point_id` (TEXT) to `data_movements`
    - Add foreign key constraints referencing `data_entity_points(id)` for all three columns
    - Add indexes: `idx_lder_from_dep_id`, `idx_lder_to_dep_id`, `idx_dm_dep_id`
    - Do NOT drop or modify existing columns: `from_ref_kind`, `from_ref_id`, `to_ref_kind`, `to_ref_id`, `data_entity_id`
    - Use precondition pattern (check columnExists) for idempotency
    - Follow pattern from `009-logical-er-polymorphic-endpoints.sql`
    - File: `architecture-model-service/src/main/resources/db/changelog/sql/022-data-entity-point-fk-columns.sql`
  - [x] 1.3 Create migration 023-data-entity-point-fk-backfill.sql
    - For `logical_data_entity_relationships`:
      - UPDATE `from_data_entity_point_id` = `'dep_log_' || from_ref_id` WHERE `from_ref_kind` = 'LOGICAL_ENTITY' AND `from_data_entity_point_id` IS NULL
      - UPDATE `from_data_entity_point_id` = `'dep_phy_' || from_ref_id` WHERE `from_ref_kind` = 'PHYSICAL_ENTITY' AND `from_data_entity_point_id` IS NULL
      - Apply same logic for `to_data_entity_point_id`
    - For `data_movements`:
      - UPDATE `data_entity_point_id` = `'dep_log_' || data_entity_id` WHERE `data_entity_id` IS NOT NULL AND `data_entity_point_id` IS NULL
    - Use WHERE clause to ensure idempotency (safe to re-run)
    - Rely on prior migration 021-data-entity-points-backfill ensuring points exist
    - Follow pattern from `021-data-entity-points-backfill.sql`
    - File: `architecture-model-service/src/main/resources/db/changelog/sql/023-data-entity-point-fk-backfill.sql`
  - [x] 1.4 Register migrations in db.changelog-master.yaml
    - Add changeSet 022-data-entity-point-fk-columns with precondition: NOT columnExists `from_data_entity_point_id` in `logical_data_entity_relationships`
    - Add changeSet 023-data-entity-point-fk-backfill with precondition: tableExists `data_entity_points`
    - File: `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml`
  - [x] 1.5 Ensure database migration tests pass
    - Run ONLY the 4-6 tests written in 1.1
    - Verify migrations run successfully without errors
    - Verify backfill populates new columns for existing rows
    - Verify backfill is idempotent (running twice produces same result)
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-6 tests written in 1.1 pass
- New columns exist with correct nullable TEXT type
- Foreign key constraints properly reference `data_entity_points(id)`
- Indexes exist on all new columns
- Existing data remains intact (legacy columns unchanged)
- Backfill correctly populates new columns based on legacy column values
- Migration is idempotent (safe to run multiple times)

---

### JPA Entity and DTO Layer

#### Task Group 2: JPA Entities and DTOs for New FK Fields
**Dependencies:** Task Group 1

- [x] 2.0 Complete JPA entity and DTO updates for new FK fields
  - [x] 2.1 Write 4-6 focused tests for entity/DTO mapping
    - Test: `LogicalDataEntityRelationshipEntity` has `fromDataEntityPointId` field mapped correctly
    - Test: `LogicalDataEntityRelationshipEntity` has `toDataEntityPointId` field mapped correctly
    - Test: `DataMovementEntity` has `dataEntityPointId` field mapped correctly
    - Test: `LogicalDataEntityRelationshipDto` serializes/deserializes new fields alongside legacy fields
    - Test: `DataMovementDto` serializes/deserializes new field alongside legacy field
    - Test: DTOs deserialize successfully when new fields are absent (backward compatibility)
    - File: `architecture-model-service/src/test/java/com/example/architecturemodel/mapper/DataEntityPointFkMapperTest.java`
  - [x] 2.2 Update LogicalDataEntityRelationshipEntity
    - Add `@Column(name = "from_data_entity_point_id") private String fromDataEntityPointId;`
    - Add `@Column(name = "to_data_entity_point_id") private String toDataEntityPointId;`
    - Keep all existing legacy fields intact: `fromRefKind`, `fromRefId`, `toRefKind`, `toRefId`
    - Map as simple String columns (consistent with existing pattern)
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/LogicalDataEntityRelationshipEntity.java`
  - [x] 2.3 Update DataMovementEntity
    - Add `@Column(name = "data_entity_point_id") private String dataEntityPointId;`
    - Keep existing legacy field: `dataEntityId`
    - Map as simple String column
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/DataMovementEntity.java`
  - [x] 2.4 Update LogicalDataEntityRelationshipDto
    - Add `@JsonProperty("from_data_entity_point_id") String fromDataEntityPointId` to record parameters
    - Add `@JsonProperty("to_data_entity_point_id") String toDataEntityPointId` to record parameters
    - Keep existing fields: `fromRefKind`, `fromRefId`, `toRefKind`, `toRefId`
    - Java records with nullable String fields will deserialize successfully when absent
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/relationship/LogicalDataEntityRelationshipDto.java`
  - [x] 2.5 Update DataMovementDto
    - Add `@JsonProperty("data_entity_point_id") String dataEntityPointId` to record parameters
    - Keep existing field: `dataEntityId`
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/relationship/DataMovementDto.java`
  - [x] 2.6 Update EntityMapper for LogicalDataEntityRelationship
    - Update `toDto(LogicalDataEntityRelationshipEntity)` to include `fromDataEntityPointId` and `toDataEntityPointId`
    - Update `toEntity(LogicalDataEntityRelationshipDto, modelFileId)` to map `fromDataEntityPointId` and `toDataEntityPointId`
    - Follow existing field-by-field mapping pattern (lines 1303-1340)
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/mapper/EntityMapper.java`
  - [x] 2.7 Update EntityMapper for DataMovement
    - Update `toDto(DataMovementEntity)` to include `dataEntityPointId`
    - Update `toEntity(DataMovementDto, modelFileId)` to map `dataEntityPointId`
    - Follow existing field-by-field mapping pattern (lines 1392-1419)
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/mapper/EntityMapper.java`
  - [x] 2.8 Ensure entity/DTO layer tests pass
    - Run ONLY the 4-6 tests written in 2.1
    - Verify entity field mappings work correctly
    - Verify DTO serialization/deserialization works with new fields
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-6 tests written in 2.1 pass
- JPA entities have new fields with correct @Column annotations
- DTOs have new fields with correct @JsonProperty annotations
- EntityMapper correctly maps all new fields in both directions
- Backward compatibility maintained (DTOs deserialize when new fields absent)
- All existing legacy fields remain intact and functional

---

### Service Layer - Dual-Write Logic

#### Task Group 3: Dual-Write Logic in ModelService
**Dependencies:** Task Group 2

- [x] 3.0 Complete dual-write logic in ModelService
  - [x] 3.1 Write 6-8 focused tests for dual-write functionality
    - Test: saveModel with legacy-only ER fields (`fromRefKind`/`fromRefId`) results in `fromDataEntityPointId` being computed and persisted
    - Test: saveModel with legacy-only ER fields (`toRefKind`/`toRefId`) results in `toDataEntityPointId` being computed and persisted
    - Test: saveModel with legacy-only DataMovement field (`dataEntityId`) results in `dataEntityPointId` being computed and persisted
    - Test: saveModel with new-only point ids persists without requiring legacy fields
    - Test: saveModel with both legacy and new fields preserves the provided new field values
    - Test: Dual-write computes `dep_log_` prefix when `fromRefKind` = 'LOGICAL_ENTITY'
    - Test: Dual-write computes `dep_phy_` prefix when `fromRefKind` = 'PHYSICAL_ENTITY'
    - Test: Validation fails gracefully if computed point id does not exist after ensure attempt
    - File: `architecture-model-service/src/test/java/com/example/architecturemodel/service/DataEntityPointFkDualWriteTest.java`
  - [x] 3.2 Add helper method for computing Data Entity Point IDs
    - Create private method `computeDataEntityPointId(String refKind, String refId)` in ModelService
    - Return `"dep_log_" + refId` when refKind = 'LOGICAL_ENTITY'
    - Return `"dep_phy_" + refId` when refKind = 'PHYSICAL_ENTITY'
    - Return null if refKind or refId is null/blank
    - Follow pattern from `DataEntityPointEnsureService` (LOGICAL_PREFIX, PHYSICAL_PREFIX constants)
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/service/ModelService.java`
  - [x] 3.3 Implement dual-write logic for LogicalDataEntityRelationship in saveRelationships
    - Before saving, iterate through `logicalDataEntityRelationships` list
    - For each DTO: if `fromDataEntityPointId` is null but `fromRefKind`/`fromRefId` present, compute and set `fromDataEntityPointId`
    - For each DTO: if `toDataEntityPointId` is null but `toRefKind`/`toRefId` present, compute and set `toDataEntityPointId`
    - Since Java records are immutable, create new DTO instances with computed values
    - Add after existing validation loop (line 891-893) and before repository.saveAll (line 894)
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/service/ModelService.java`
  - [x] 3.4 Implement dual-write logic for DataMovement in saveRelationships
    - Before saving, iterate through `dataMovements` list
    - For each DTO: if `dataEntityPointId` is null but `dataEntityId` present, compute and set `dataEntityPointId` = `"dep_log_" + dataEntityId`
    - Since Java records are immutable, create new DTO instances with computed values
    - Add before repository.saveAll (line 913)
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/service/ModelService.java`
  - [x] 3.5 Add validation for point-id existence
    - For any non-null `fromDataEntityPointId`, `toDataEntityPointId`, or `dataEntityPointId`, verify it exists in `data_entity_points`
    - If computed point id does not exist, invoke `DataEntityPointEnsureService.ensureDataEntityPoints` with appropriate entities
    - After ensure attempt, re-check existence; if still not found, throw validation error
    - Add validation method similar to existing `validateLogicalDataEntityRelationship` (line 941+)
    - Inject `DataEntityPointEnsureService` dependency if not already present
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/service/ModelService.java`
  - [x] 3.6 Ensure dual-write logic tests pass
    - Run ONLY the 6-8 tests written in 3.1
    - Verify legacy-only input results in new fields being populated
    - Verify new-only input works without requiring legacy fields
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 6-8 tests written in 3.1 pass
- Legacy-only payloads result in new point-id fields being computed and persisted
- New-only payloads persist successfully without requiring legacy fields
- Mixed payloads preserve explicitly provided point-id values
- Correct prefix used based on entity type (dep_log_ vs dep_phy_)
- Validation error thrown if point-id cannot be resolved after ensure attempt

---

### Integration Testing - Snapshot Import/Export

#### Task Group 4: Test Review and Snapshot Integration Tests
**Dependencies:** Task Groups 1-3

- [x] 4.0 Review existing tests and add snapshot integration tests
  - [x] 4.1 Review tests from Task Groups 1-3
    - Review the 4-6 migration tests from Task 1.1
    - Review the 4-6 entity/DTO mapping tests from Task 2.1
    - Review the 6-8 dual-write tests from Task 3.1
    - Total existing tests: approximately 14-20 tests
  - [x] 4.2 Analyze test coverage gaps for THIS feature only
    - Identify critical user workflows that lack test coverage
    - Focus ONLY on gaps related to dual-write, snapshot export, and snapshot import
    - Prioritize end-to-end snapshot roundtrip workflows
    - Do NOT assess entire application test coverage
  - [x] 4.3 Write up to 10 additional strategic tests maximum
    - Test: Snapshot export includes BOTH legacy fields AND new point-id fields for LogicalDataEntityRelationship
    - Test: Snapshot export includes BOTH legacy field AND new point-id field for DataMovement
    - Test: Import legacy-only snapshot (without point-id fields) fills new point-id fields via dual-write
    - Test: Import new-only snapshot (with only point-id fields) succeeds
    - Test: Import mixed snapshot (some records with legacy, some with new) succeeds
    - Test: Re-import same snapshot produces stable results (no duplicates, consistent ids)
    - Test: Snapshot roundtrip (export -> import -> export) produces identical output
    - Test: Backward compatibility - old frontend snapshot without new fields imports successfully
    - File: `architecture-model-service/src/test/java/com/example/architecturemodel/integration/DataEntityPointFkSnapshotIntegrationTest.java`
  - [x] 4.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature:
      - `DataEntityPointFkColumnsMigrationTest` (Task 1.1)
      - `DataEntityPointFkMapperTest` (Task 2.1)
      - `DataEntityPointFkDualWriteTest` (Task 3.1)
      - `DataEntityPointFkSnapshotIntegrationTest` (Task 4.3)
    - Expected total: approximately 22-30 tests maximum
    - Do NOT run the entire application test suite
    - Verify critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 22-30 tests total)
- Snapshot export includes both legacy and new fields
- Snapshot import handles legacy-only, new-only, and mixed payloads
- Re-import produces stable, consistent results
- No more than 10 additional tests added for gap filling
- Testing focused exclusively on this spec's feature requirements

---

## Execution Order

Recommended implementation sequence:

1. **Database Layer (Task Group 1)** - Must complete first
   - Migrations add columns that all other layers depend on
   - No code dependencies on other task groups

2. **JPA Entity and DTO Layer (Task Group 2)** - Depends on Task Group 1
   - Entities map to database columns from Task Group 1
   - DTOs support API serialization for new fields

3. **Service Layer - Dual-Write Logic (Task Group 3)** - Depends on Task Group 2
   - Uses updated entities and DTOs from Task Group 2
   - Implements core dual-write business logic

4. **Integration Testing (Task Group 4)** - Depends on Task Groups 1-3
   - Validates end-to-end snapshot workflows
   - Confirms backward compatibility

---

## Notes

### Dual-Write Strategy
The dual-write approach ensures:
- Existing frontends can continue sending legacy fields
- Backend computes and persists new point-id fields automatically
- Future migration can switch to point-id-only once all clients are updated
- No data loss during transition period

### ID Generation Convention
Consistent with `DataEntityPointEnsureService` and migration 021:
- Logical entity points: `"dep_log_" + entityId`
- Physical entity points: `"dep_phy_" + entityId`

### Backward Compatibility
- All existing legacy columns remain untouched
- DTOs accept payloads with or without new fields
- Snapshots export both formats for cross-version compatibility
- Imports handle any combination of legacy/new field presence

### Out of Scope (per spec)
- No frontend changes
- No removal of legacy columns
- No changes to DataEntityPointEntity or DataEntityPointDto
- No changes to ProjectSnapshotService (delegates to ModelService)
