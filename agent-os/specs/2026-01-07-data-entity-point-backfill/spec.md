# Specification: Data Entity Point Backfill and Legacy Snapshot Compatibility

## Goal
Backfill Data Entity Points for all existing logical and physical data entities in the database, and enable backward-compatible snapshot import for legacy snapshots that do not contain `dataEntityPoints`.

## User Stories
- As a system administrator, I want existing databases to automatically have Data Entity Points created for all logical/physical entities so that the system is consistent after deploying Iteration 2.
- As a developer importing a legacy snapshot, I want the import to succeed and automatically generate missing Data Entity Points so that I do not need to manually update old snapshots.

## Specific Requirements

**DB migration: backfill existing rows into data_entity_points**
- Create new Liquibase SQL changelog file `021-data-entity-points-backfill.sql`
- Insert missing logical entity points using `INSERT INTO ... SELECT ... WHERE NOT EXISTS` pattern
- ID format: `'dep_log_' || logical_data_entities.id`
- Set `point_kind = 'LOGICAL_ENTITY'`, `logical_entity_id = logical_data_entities.id`, `physical_entity_id = NULL`
- Insert missing physical entity points using same pattern
- ID format: `'dep_phy_' || physical_data_entities.id`
- Set `point_kind = 'PHYSICAL_ENTITY'`, `physical_entity_id = physical_data_entities.id`, `logical_entity_id = NULL`
- Migration must be idempotent (safe to re-run without creating duplicates)

**Liquibase changelog master update**
- Add changeset `021-data-entity-points-backfill` to `db.changelog-master.yaml`
- Use precondition that checks if backfill has already run (e.g., custom SQL check or always run with idempotent SQL)
- Follow existing changeset pattern with `sqlFile` reference

**Snapshot import compatibility: tolerate missing dataEntityPoints**
- In `ProjectSnapshotImportService.importSnapshot()`, handle the case where `snapshot.model.metaModel.entities.dataEntityPoints` is null or absent
- `MetaModelEntitiesDto.dataEntityPoints()` must gracefully return null when not present in JSON (already supported by Jackson defaults)
- After `ModelService.saveModel()` completes, if `dataEntityPoints` was absent from the snapshot, invoke `DataEntityPointEnsureService.ensureDataEntityPoints()` for the imported model file
- Order: import logical/physical entities first, then ensure points exist

**Modify ProjectSnapshotImportService for conditional ensure call**
- After calling `modelService.saveModel(newProjectName, request.snapshot().model())`, check if original snapshot had `dataEntityPoints`
- If `dataEntityPoints` was null/empty in the snapshot, call ensure service with the model's logical and physical entities
- Retrieve the model file ID from the saved model or by querying by project name
- Pass logical/physical entity lists from `snapshot.model.metaModel.entities` to ensure service

**Application startup backfill check (optional safety net)**
- Create new `DataEntityPointBackfillRunner` implementing `ApplicationRunner` or `CommandLineRunner`
- Guard execution with config property `app.data-entity-points.startup-ensure` (default: `true`)
- Query all model file IDs from `ModelFileRepository`
- For each model file, load logical/physical entities and call `DataEntityPointEnsureService.ensureDataEntityPoints()`
- Log summary: count of logical points created, count of physical points created
- Must be idempotent and non-destructive (never deletes existing points)

**Configuration property for startup ensure**
- Add property `app.data-entity-points.startup-ensure=true` to `application.yml`
- Allow override via environment variable `APP_DATA_ENTITY_POINTS_STARTUP_ENSURE`
- Document property in application.yml with comment explaining purpose

**Unit and integration tests**
- Test backfill migration: given existing logical/physical entities without points, verify points are created with correct IDs after migration
- Test migration idempotency: running migration twice produces no duplicates
- Test legacy snapshot import: import JSON without `dataEntityPoints` field, verify points are generated
- Test new snapshot import: import JSON with explicit `dataEntityPoints`, verify no duplicates and IDs preserved
- Test re-import stability: importing same snapshot twice results in identical state
- Test startup runner: verify startup ensure creates missing points and logs summary

## Existing Code to Leverage

**DataEntityPointEnsureService**
- Located at `architecture-model-service/src/main/java/com/example/architecturemodel/service/DataEntityPointEnsureService.java`
- Already implements idempotent `ensureDataEntityPoints(modelFileId, logicalEntities, physicalEntities)` method
- Uses deterministic ID generation: `dep_log_` + logicalEntityId, `dep_phy_` + physicalEntityId
- Validates "exactly one FK set" invariant on existing points

**DataEntityPointRepository**
- Located at `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/DataEntityPointRepository.java`
- Provides `findByModelFileIdAndLogicalEntityId()` and `findByModelFileIdAndPhysicalEntityId()` for existence checks
- Provides `findByModelFileId()` for loading all points per model

**ProjectSnapshotImportService**
- Located at `architecture-model-service/src/main/java/com/example/architecturemodel/service/ProjectSnapshotImportService.java`
- Orchestrates snapshot import with transactional boundary
- Calls `modelService.saveModel()` to persist the model (which already calls ensure service during save)
- Note: `saveModel()` already calls ensure service, so import with present dataEntityPoints should work; need to verify behavior when absent

**ModelService.saveModel() and saveEntities()**
- Located at `architecture-model-service/src/main/java/com/example/architecturemodel/service/ModelService.java`
- `saveEntities()` already calls `dataEntityPointEnsureService.ensureDataEntityPoints()` after saving logical/physical entities (lines 774-778)
- This means even legacy snapshot imports should auto-generate points via the existing flow

**Liquibase changelog pattern**
- Master file at `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml`
- SQL files at `architecture-model-service/src/main/resources/db/changelog/sql/`
- Follow pattern: precondition check, sqlFile reference with splitStatements and stripComments

## Out of Scope
- No changes to relationship schema or DTOs (other than optional field handling)
- No frontend changes
- No UI updates
- No deletion of orphaned or invalid data entity points (cleanup is a later iteration)
- No changes to the Data Entity Point table schema (already created in Iteration 1)
- No changes to the DataEntityPointEnsureService logic beyond reuse
- No changes to the DataEntityPointRepository
- No new API endpoints
- No changes to export functionality (export already includes dataEntityPoints when present)
