# Task Breakdown: Data Entity Point Superclass

## Overview
Total Tasks: 25 (across 5 task groups)

This feature introduces a polymorphic reference wrapper entity (Data Entity Point) for Logical and Physical Data Entities. The implementation is backend-only, covering database schema, JPA entities, repositories, DTOs, mappers, ensure service, snapshot export/import, and tests.

## Task List

### Database Layer

#### Task Group 1: Database Migration
**Dependencies:** None

- [x] 1.0 Complete database migration for data_entity_points table
  - [x] 1.1 Create migration file `020-data-entity-points.sql`
    - Location: `architecture-model-service/src/main/resources/db/changelog/sql/020-data-entity-points.sql`
    - Follow pattern from: `017-package-sets.sql`
  - [x] 1.2 Define table structure with all columns
    - id (TEXT PRIMARY KEY)
    - model_file_id (TEXT NOT NULL)
    - point_kind (TEXT NOT NULL)
    - logical_entity_id (TEXT NULL)
    - physical_entity_id (TEXT NULL)
    - description (TEXT NULL)
    - tags (TEXT NULL)
    - valid_from (TEXT NULL)
    - valid_to (TEXT NULL)
  - [x] 1.3 Add foreign key constraints
    - model_file_id REFERENCES model_files(id) ON DELETE CASCADE
    - logical_entity_id REFERENCES logical_data_entities(id)
    - physical_entity_id REFERENCES physical_data_entities(id)
  - [x] 1.4 Add CHECK constraints
    - Exactly one FK set: `((logical_entity_id IS NOT NULL AND physical_entity_id IS NULL) OR (logical_entity_id IS NULL AND physical_entity_id IS NOT NULL))`
    - Enum validation: `point_kind IN ('LOGICAL_ENTITY', 'PHYSICAL_ENTITY')`
  - [x] 1.5 Add unique partial indexes for determinism
    - `CREATE UNIQUE INDEX idx_data_entity_points_logical ON data_entity_points(model_file_id, logical_entity_id) WHERE logical_entity_id IS NOT NULL`
    - `CREATE UNIQUE INDEX idx_data_entity_points_physical ON data_entity_points(model_file_id, physical_entity_id) WHERE physical_entity_id IS NOT NULL`
  - [x] 1.6 Add performance indexes
    - `CREATE INDEX idx_data_entity_points_model_file ON data_entity_points(model_file_id)`
    - `CREATE INDEX idx_data_entity_points_logical_entity ON data_entity_points(logical_entity_id)`
    - `CREATE INDEX idx_data_entity_points_physical_entity ON data_entity_points(physical_entity_id)`
  - [x] 1.7 Register migration in db.changelog-master.yaml
    - Add entry for `sql/020-data-entity-points.sql`

**Acceptance Criteria:**
- Migration runs successfully without errors
- Table `data_entity_points` exists with all columns
- All FK constraints are enforced
- CHECK constraints reject invalid data
- Unique partial indexes prevent duplicate mappings

---

### JPA Entity & Repository Layer

#### Task Group 2: JPA Entity and Repository
**Dependencies:** Task Group 1

- [x] 2.0 Complete JPA entity and repository implementation
  - [x] 2.1 Write 4-6 focused repository integration tests
    - Location: `architecture-model-service/src/test/java/com/example/architecturemodel/repository/DataEntityPointRepositoryTest.java`
    - Test: Save and retrieve by modelFileId
    - Test: Find by modelFileId and logicalEntityId
    - Test: Find by modelFileId and physicalEntityId
    - Test: Delete by modelFileId cascades correctly
    - Test: Unique constraint violation when duplicate logical FK
    - Test: CHECK constraint rejects point with both FKs set
  - [x] 2.2 Create DataEntityPointEntity.java
    - Package: `com.example.architecturemodel.model.entity`
    - Use Lombok annotations: @Entity, @Table, @Getter, @Setter, @NoArgsConstructor, @AllArgsConstructor, @Builder
    - Map all columns: id, modelFileId, pointKind, logicalEntityId, physicalEntityId, description, tags, validFrom, validTo
    - Follow pattern from: `LogicalDataEntityEntity.java`
  - [x] 2.3 Create DataEntityPointRepository.java
    - Package: `com.example.architecturemodel.repository.entity`
    - Extend JpaRepository<DataEntityPointEntity, String>
    - Methods:
      - `List<DataEntityPointEntity> findByModelFileId(String modelFileId)`
      - `Optional<DataEntityPointEntity> findByModelFileIdAndLogicalEntityId(String modelFileId, String logicalEntityId)`
      - `Optional<DataEntityPointEntity> findByModelFileIdAndPhysicalEntityId(String modelFileId, String physicalEntityId)`
      - `void deleteByModelFileId(String modelFileId)`
    - Follow pattern from: `LogicalDataEntityRepository.java`
  - [x] 2.4 Ensure repository integration tests pass
    - Run ONLY the 4-6 tests written in 2.1
    - Verify all CRUD operations work correctly
    - Verify constraint violations are properly enforced

**Acceptance Criteria:**
- The 4-6 tests written in 2.1 pass
- Entity correctly maps all database columns
- Repository methods return expected results
- Constraint violations throw appropriate exceptions

---

### DTO & Mapper Layer

#### Task Group 3: DTO and EntityMapper Extensions
**Dependencies:** Task Group 2

- [x] 3.0 Complete DTO and mapper implementation
  - [x] 3.1 Write 3-4 focused unit tests for DTO and mapper
    - Location: `architecture-model-service/src/test/java/com/example/architecturemodel/mapper/DataEntityPointMapperTest.java`
    - Test: toDto correctly maps all entity fields
    - Test: toEntity correctly maps all DTO fields with modelFileId
    - Test: Null handling for optional fields (description, tags, validFrom, validTo)
  - [x] 3.2 Create DataEntityPointDto.java
    - Package: `com.example.architecturemodel.model.dto.entity`
    - Create as Java record with @JsonProperty annotations
    - Fields: id, pointKind (point_kind), logicalEntityId (logical_entity_id), physicalEntityId (physical_entity_id), description, tags, validFrom (valid_from), validTo (valid_to)
    - Follow pattern from: `LogicalDataEntityDto.java`
  - [x] 3.3 Add mapper methods to EntityMapper.java
    - Add `toDto(DataEntityPointEntity entity)` method
    - Add `toEntity(DataEntityPointDto dto, String modelFileId)` method
    - Place in "Data Domain Entity Mappings" section (after line 417)
    - Follow existing toDto/toEntity patterns
  - [x] 3.4 Extend MetaModelEntitiesDto.java
    - Add field: `@JsonProperty("data_entity_points") List<DataEntityPointDto> dataEntityPoints`
    - Position: after physicalDataAttributes field (line 55) to maintain logical grouping with data entities
    - Update record constructor parameter order
  - [x] 3.5 Ensure DTO and mapper tests pass
    - Run ONLY the 3-4 tests written in 3.1
    - Verify bidirectional mapping correctness

**Acceptance Criteria:**
- The 3-4 tests written in 3.1 pass
- DTO serializes/deserializes correctly with JSON snake_case
- EntityMapper methods follow existing patterns
- MetaModelEntitiesDto includes dataEntityPoints in correct position

---

### Service Layer

#### Task Group 4: Ensure Service and ModelService Integration
**Dependencies:** Task Group 3

- [x] 4.0 Complete ensure service and ModelService integration
  - [x] 4.1 Write 5-7 focused tests for ensure service and integration
    - Location: `architecture-model-service/src/test/java/com/example/architecturemodel/service/DataEntityPointEnsureServiceTest.java`
    - Test: Creates dep_log_<id> for logical entity
    - Test: Creates dep_phy_<id> for physical entity
    - Test: Idempotency - running twice produces same result, no duplicates
    - Test: Does not recreate existing points
    - Test: Handles empty entity lists gracefully
    - Test: Throws exception if point exists with both FKs set (invariant violation)
    - Test: Integration with ModelService.saveEntities()
  - [x] 4.2 Create DataEntityPointEnsureService.java
    - Package: `com.example.architecturemodel.service`
    - Inject: DataEntityPointRepository
    - Implement method: `ensureDataEntityPoints(String modelFileId, List<LogicalDataEntityDto> logicalEntities, List<PhysicalDataEntityDto> physicalEntities)`
    - ID generation: `dep_log_` + logicalEntityId for logical, `dep_phy_` + physicalEntityId for physical
    - Upsert logic: lookup existing by modelFileId + FK, create only if missing
    - Validation: fail with clear exception if point exists with both FKs set
  - [x] 4.3 Integrate into ModelService.loadEntities()
    - Inject: DataEntityPointRepository
    - Add loading: `dataEntityPointRepository.findByModelFileId(modelFileId)`
    - Map to DTOs and include in MetaModelEntitiesDto constructor
  - [x] 4.4 Integrate into ModelService.saveEntities()
    - Inject: DataEntityPointEnsureService
    - Call `ensureDataEntityPoints()` AFTER logical/physical entities are saved
    - Pass the saved logical and physical entity lists
  - [x] 4.5 Integrate into ModelService.deleteAllDataForModelFile()
    - Add `dataEntityPointRepository.deleteByModelFileId(modelFileId)`
    - Execute BEFORE logical/physical entity deletion (dependency order)
  - [x] 4.6 Ensure service layer tests pass
    - Run ONLY the 5-7 tests written in 4.1
    - Verify ensure service idempotency
    - Verify ModelService integration works end-to-end

**Acceptance Criteria:**
- The 5-7 tests written in 4.1 pass
- Ensure service creates deterministic IDs
- Running ensure twice produces identical results
- ModelService correctly loads, saves, and deletes data entity points
- Deletion order respects FK dependencies

---

### Snapshot Export/Import Layer

#### Task Group 5: Snapshot Export/Import Integration
**Dependencies:** Task Group 4

- [x] 5.0 Complete snapshot export/import integration
  - [x] 5.1 Write 4-6 focused tests for snapshot round-trip
    - Location: `architecture-model-service/src/test/java/com/example/architecturemodel/service/DataEntityPointSnapshotTest.java`
    - Test: Export includes dataEntityPoints array in JSON
    - Test: Import restores dataEntityPoints from snapshot
    - Test: Re-import same snapshot does not duplicate points
    - Test: Import with logical/physical entities automatically creates points via ensure service
    - Test: Empty dataEntityPoints array imports successfully
  - [x] 5.2 Update ProjectSnapshotService.createEmptyModel()
    - Add `List.of()` for dataEntityPoints parameter in MetaModelEntitiesDto constructor
    - Ensure empty model has empty dataEntityPoints list
  - [x] 5.3 Verify export flow (no changes needed)
    - Data Entity Points are automatically included via ModelService.loadModel()
    - loadModel() populates metaModel.entities.dataEntityPoints from repository
    - Confirm export JSON contains data_entity_points array
  - [x] 5.4 Verify import flow (no changes needed)
    - ModelService.saveModel() calls saveEntities()
    - saveEntities() invokes DataEntityPointEnsureService
    - Data Entity Points from snapshot JSON are persisted via standard entity save flow
    - Ensure service runs after to guarantee points exist for all entities
  - [x] 5.5 Ensure snapshot tests pass
    - Run ONLY the 4-6 tests written in 5.1
    - Verify round-trip export/import consistency
    - Verify deterministic ID generation prevents duplicates

**Acceptance Criteria:**
- The 4-6 tests written in 5.1 pass
- Snapshot export JSON contains data_entity_points array
- Snapshot import restores data entity points correctly
- Re-importing same snapshot produces identical database state
- No duplicate data entity points created on repeated imports

---

### Test Review & Gap Analysis

#### Task Group 6: Test Review & Critical Gap Analysis
**Dependencies:** Task Groups 1-5

- [x] 6.0 Review existing tests and fill critical gaps only
  - [x] 6.1 Review tests from Task Groups 2-5
    - Review the 4-6 repository tests from Task 2.1
    - Review the 3-4 mapper tests from Task 3.1
    - Review the 5-7 service tests from Task 4.1
    - Review the 4-6 snapshot tests from Task 5.1
    - Total existing tests: approximately 16-23 tests
  - [x] 6.2 Analyze test coverage gaps for THIS feature only
    - Identify critical workflows lacking coverage
    - Focus on integration points between components
    - Check constraint violation edge cases
    - Verify deterministic ID generation across all scenarios
  - [x] 6.3 Write up to 8 additional strategic tests maximum
    - Location: `architecture-model-service/src/test/java/com/example/architecturemodel/integration/DataEntityPointIntegrationTest.java`
    - Focus areas:
      - End-to-end flow: create logical entity -> save -> verify point created
      - End-to-end flow: create physical entity -> save -> verify point created
      - Constraint tests: insert point with neither FK set (should fail)
      - Constraint tests: insert point with both FKs set (should fail)
      - Delete cascade: delete model file cascades to points
      - ID stability: same entity produces same point ID across saves
  - [x] 6.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature
    - Expected total: approximately 24-31 tests maximum
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 24-31 tests total)
- Critical constraint violations are tested
- End-to-end integration workflows verified
- No more than 8 additional tests added
- Deterministic ID generation confirmed across all scenarios

---

## Execution Order

Recommended implementation sequence:

1. **Database Layer** (Task Group 1)
   - Create migration file first as all other layers depend on the table

2. **JPA Entity & Repository Layer** (Task Group 2)
   - Implement entity and repository after DB is ready
   - Write tests to verify constraint enforcement

3. **DTO & Mapper Layer** (Task Group 3)
   - Create DTO and mapper methods
   - Extend MetaModelEntitiesDto to include new field

4. **Service Layer** (Task Group 4)
   - Implement DataEntityPointEnsureService
   - Integrate with ModelService for load/save/delete operations

5. **Snapshot Export/Import Layer** (Task Group 5)
   - Update ProjectSnapshotService for empty model creation
   - Verify export/import flows work correctly

6. **Test Review & Gap Analysis** (Task Group 6)
   - Review all tests from previous groups
   - Fill critical gaps with integration tests

---

## Key Implementation Notes

### Deterministic ID Scheme
- Logical Data Entity Points: `dep_log_<logical_data_entity_id>`
- Physical Data Entity Points: `dep_phy_<physical_data_entity_id>`
- IDs remain stable across export/import cycles

### Deletion Order (in deleteAllDataForModelFile)
1. Delete data_entity_points (depends on logical/physical entities)
2. Then delete logical_data_entities and physical_data_entities

### Save Order (in saveEntities)
1. Save logical_data_entities and physical_data_entities first
2. Then call DataEntityPointEnsureService.ensureDataEntityPoints()

### Files to Create
- `architecture-model-service/src/main/resources/db/changelog/sql/020-data-entity-points.sql`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/DataEntityPointEntity.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/DataEntityPointRepository.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/DataEntityPointDto.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/DataEntityPointEnsureService.java`

### Files to Modify
- `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml`
- `architecture-model-service/src/main/java/com/example/architecturemodel/mapper/EntityMapper.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/MetaModelEntitiesDto.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/ModelService.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/ProjectSnapshotService.java`

### Test Files to Create
- `architecture-model-service/src/test/java/com/example/architecturemodel/repository/DataEntityPointRepositoryTest.java`
- `architecture-model-service/src/test/java/com/example/architecturemodel/mapper/DataEntityPointMapperTest.java`
- `architecture-model-service/src/test/java/com/example/architecturemodel/service/DataEntityPointEnsureServiceTest.java`
- `architecture-model-service/src/test/java/com/example/architecturemodel/service/DataEntityPointSnapshotTest.java`
- `architecture-model-service/src/test/java/com/example/architecturemodel/integration/DataEntityPointIntegrationTest.java`
