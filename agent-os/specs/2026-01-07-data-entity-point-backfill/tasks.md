# Task Breakdown: Data Entity Point Backfill and Legacy Snapshot Compatibility

## Overview
Total Tasks: 18

This is Iteration 2 of the Data Entity Point feature, building on Iteration 1's infrastructure. This iteration focuses on:
- Backfilling existing database rows with Data Entity Points
- Enabling backward-compatible snapshot import for legacy snapshots
- Optional startup safety net for ensuring Data Entity Points exist

**Backend-only feature** - No frontend changes required.

## Task List

### Database Layer

#### Task Group 1: Liquibase Migration Backfill
**Dependencies:** None (builds on existing Iteration 1 schema)

- [x] 1.0 Complete database migration backfill
  - [x] 1.1 Write 3 focused tests for migration backfill functionality
    - Test 1: Verify logical entity points are created with correct ID format (`dep_log_<entity_id>`) after migration runs on database with existing logical entities but no points
    - Test 2: Verify physical entity points are created with correct ID format (`dep_phy_<entity_id>`) after migration runs on database with existing physical entities but no points
    - Test 3: Verify migration idempotency - running migration twice produces no duplicate points
  - [x] 1.2 Create migration file `021-data-entity-points-backfill.sql`
    - Location: `architecture-model-service/src/main/resources/db/changelog/sql/021-data-entity-points-backfill.sql`
    - Use `INSERT INTO ... SELECT ... WHERE NOT EXISTS` pattern for idempotency
    - Insert logical entity points:
      - ID: `'dep_log_' || logical_data_entities.id`
      - `point_kind = 'LOGICAL_ENTITY'`
      - `logical_entity_id = logical_data_entities.id`
      - `physical_entity_id = NULL`
    - Insert physical entity points:
      - ID: `'dep_phy_' || physical_data_entities.id`
      - `point_kind = 'PHYSICAL_ENTITY'`
      - `physical_entity_id = physical_data_entities.id`
      - `logical_entity_id = NULL`
    - Follow existing Postgres/Liquibase SQL patterns from other migration files
  - [x] 1.3 Update `db.changelog-master.yaml` with new changeset
    - Location: `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml`
    - Add changeset `021-data-entity-points-backfill`
    - Use `sqlFile` reference pattern from existing changesets
    - Configure `splitStatements` and `stripComments` as per existing pattern
  - [x] 1.4 Ensure migration tests pass
    - Run ONLY the 3 tests written in 1.1
    - Verify migration runs successfully on test database
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 3 tests written in 1.1 pass
- Migration creates points for all existing logical entities without points
- Migration creates points for all existing physical entities without points
- Migration is idempotent (safe to re-run)
- Changeset follows existing Liquibase patterns

### Service Layer

#### Task Group 2: Snapshot Import Compatibility
**Dependencies:** Task Group 1

- [x] 2.0 Complete snapshot import compatibility for legacy snapshots
  - [x] 2.1 Write 4 focused tests for snapshot import compatibility
    - Test 1: Import legacy snapshot JSON without `dataEntityPoints` field succeeds
    - Test 2: Legacy snapshot import generates Data Entity Points with correct deterministic IDs
    - Test 3: Import snapshot with explicit `dataEntityPoints` field preserves IDs and creates no duplicates
    - Test 4: Re-import same snapshot twice results in identical state (no duplicates, IDs unchanged)
  - [x] 2.2 Verify `MetaModelEntitiesDto.dataEntityPoints()` handles null gracefully
    - Location: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/MetaModelEntitiesDto.java`
    - Confirmed: Jackson defaults allow null/absent `dataEntityPoints` field - Java records allow null values
    - No additional annotation needed - field can be null in legacy snapshots
  - [x] 2.3 Review `ModelService.saveModel()` ensure service call
    - Location: `architecture-model-service/src/main/java/com/example/architecturemodel/service/ModelService.java`
    - Verified: `saveEntities()` already calls `DataEntityPointEnsureService.ensureDataEntityPoints()` (lines 774-778)
    - Confirmed: This handles the case when `dataEntityPoints` is null in incoming DTO
    - No code changes required - existing flow handles legacy imports
  - [x] 2.4 Modify `ProjectSnapshotImportService` if needed
    - Location: `architecture-model-service/src/main/java/com/example/architecturemodel/service/ProjectSnapshotImportService.java`
    - Reviewed: Current import flow calls `modelService.saveModel()` which calls `saveEntities()` which ensures points
    - No changes needed - existing flow handles legacy imports automatically
  - [x] 2.5 Ensure snapshot import tests pass
    - Run ONLY the 4 tests written in 2.1
    - Verify legacy snapshot imports succeed
    - Verify points are generated with correct IDs
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4 tests written in 2.1 pass
- Legacy snapshots without `dataEntityPoints` import successfully
- Data Entity Points are generated with deterministic IDs (`dep_log_`, `dep_phy_` prefixes)
- Snapshots with explicit `dataEntityPoints` preserve IDs
- Re-import is stable and idempotent

#### Task Group 3: Startup Backfill Runner
**Dependencies:** Task Group 2

- [x] 3.0 Complete startup backfill safety net
  - [x] 3.1 Write 3 focused tests for startup backfill runner
    - Test 1: Startup runner creates missing points for model files with entities but no points
    - Test 2: Startup runner is idempotent (running twice creates no duplicates)
    - Test 3: Startup runner respects config property `app.data-entity-points.startup-ensure=false` and skips execution when disabled
  - [x] 3.2 Add configuration property to `application.yml`
    - Location: `architecture-model-service/src/main/resources/application.yml`
    - Add property: `app.data-entity-points.startup-ensure: true`
    - Add comment explaining purpose: enables automatic Data Entity Point backfill on startup
    - Verify environment variable override works: `APP_DATA_ENTITY_POINTS_STARTUP_ENSURE`
  - [x] 3.3 Create `DataEntityPointBackfillRunner` class
    - Location: `architecture-model-service/src/main/java/com/example/architecturemodel/runner/DataEntityPointBackfillRunner.java`
    - Implement `ApplicationRunner` or `CommandLineRunner` interface
    - Inject `@Value("${app.data-entity-points.startup-ensure:true}")` for config property
    - Inject `ModelFileRepository` to query all model file IDs
    - Inject `DataEntityPointEnsureService` for ensure logic
    - Inject repositories to load logical/physical entities per model file
  - [x] 3.4 Implement backfill logic in runner
    - Guard execution with config property check (skip if false)
    - Query all model file IDs from `ModelFileRepository`
    - For each model file:
      - Load logical entities via repository
      - Load physical entities via repository
      - Call `DataEntityPointEnsureService.ensureDataEntityPoints(modelFileId, logicalEntities, physicalEntities)`
    - Track counts: logical points created, physical points created
    - Log summary at INFO level: "Data Entity Point startup backfill complete: created X logical points, Y physical points"
    - Must be non-destructive (never delete existing points)
  - [x] 3.5 Ensure startup runner tests pass
    - Run ONLY the 3 tests written in 3.1
    - Verify runner executes on startup when enabled
    - Verify runner skips execution when disabled
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 3 tests written in 3.1 pass
- Runner creates missing Data Entity Points on startup
- Runner is idempotent and non-destructive
- Runner respects configuration property
- Summary is logged after execution

### Testing

#### Task Group 4: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-3

- [x] 4.0 Review existing tests and fill critical gaps only
  - [x] 4.1 Review tests from Task Groups 1-3
    - Review the 3 tests written for migration backfill (Task 1.1)
    - Review the 4 tests written for snapshot import compatibility (Task 2.1)
    - Review the 3 tests written for startup runner (Task 3.1)
    - Total existing tests: 10 tests
  - [x] 4.2 Analyze test coverage gaps for THIS feature only
    - Identify critical integration workflows that lack coverage
    - Focus ONLY on Data Entity Point backfill and legacy snapshot compatibility
    - Prioritize end-to-end scenarios over unit test gaps
    - Consider: migration + import combined flow, error scenarios
  - [x] 4.3 Write up to 5 additional strategic tests maximum
    - Integration test: Full flow - apply migration on DB with existing entities, verify points exist, then import legacy snapshot, verify no duplicates
    - Integration test: Startup runner + migration interaction - verify runner does not duplicate points already created by migration
    - Test: Import snapshot with some entities having points and some missing - verify partial backfill works correctly
    - Test: Verify `point_kind` enum values are set correctly for both logical and physical points
    - Negative test: If applicable, verify clear error message surfaces when point creation fails due to constraint violation
  - [x] 4.4 Run feature-specific tests only
    - Run ONLY tests related to Data Entity Point backfill feature (tests from 1.1, 2.1, 3.1, and 4.3)
    - Expected total: approximately 15 tests maximum
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 15 tests total)
- Critical backfill and import workflows are covered
- No more than 5 additional tests added when filling in testing gaps
- Testing focused exclusively on this spec's feature requirements

## Execution Order

Recommended implementation sequence:

1. **Database Layer (Task Group 1)** - Create migration backfill first
   - This establishes the foundation for existing database rows
   - Migration must be in place before testing import compatibility

2. **Service Layer - Snapshot Import (Task Group 2)** - Enable legacy snapshot compatibility
   - Builds on migration layer
   - May require minimal changes if existing `saveModel()` flow already handles ensure

3. **Service Layer - Startup Runner (Task Group 3)** - Add startup safety net
   - Depends on ensure service (already exists from Iteration 1)
   - Provides additional safety for edge cases not covered by migration

4. **Test Review & Gap Analysis (Task Group 4)** - Final validation
   - Review all tests from previous groups
   - Fill critical integration gaps
   - Run comprehensive feature-specific test suite

## Files to Create/Modify

### New Files
- `architecture-model-service/src/main/resources/db/changelog/sql/021-data-entity-points-backfill.sql`
- `architecture-model-service/src/main/java/com/example/architecturemodel/runner/DataEntityPointBackfillRunner.java`
- `architecture-model-service/src/test/java/com/example/architecturemodel/migration/DataEntityPointBackfillMigrationTest.java`
- `architecture-model-service/src/test/java/com/example/architecturemodel/service/LegacySnapshotImportTest.java`
- `architecture-model-service/src/test/java/com/example/architecturemodel/runner/DataEntityPointBackfillRunnerTest.java`

### Files to Modify
- `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml` (add changeset reference)
- `architecture-model-service/src/main/resources/application.yml` (add startup-ensure property)
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/MetaModelEntitiesDto.java` (verify/add null handling annotation if needed)
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/ProjectSnapshotImportService.java` (conditional ensure call if needed)

## Existing Code to Leverage

- **DataEntityPointEnsureService** (`architecture-model-service/src/main/java/com/example/architecturemodel/service/DataEntityPointEnsureService.java`)
  - Already implements idempotent `ensureDataEntityPoints()` method
  - Uses deterministic ID generation matching spec requirements

- **DataEntityPointRepository** (`architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/DataEntityPointRepository.java`)
  - Provides existence check methods for deduplication

- **ModelService.saveEntities()** (`architecture-model-service/src/main/java/com/example/architecturemodel/service/ModelService.java`)
  - Already calls ensure service (lines 774-778) - may handle legacy imports automatically

## Notes

- This is Iteration 2 building on Iteration 1's Data Entity Point infrastructure
- No changes to Data Entity Point table schema (already created in Iteration 1)
- No changes to DataEntityPointEnsureService logic (reuse only)
- No changes to DataEntityPointRepository
- No new API endpoints
- No frontend changes
- No deletion of orphaned points (cleanup is a later iteration)
