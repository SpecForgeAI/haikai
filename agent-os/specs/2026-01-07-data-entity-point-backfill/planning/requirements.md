---
# Backfill Data Entity Points for existing data + accept legacy snapshots without points (no relationship changes)

## Title
Backfill Data Entity Points for existing data + accept legacy snapshots without points (no relationship changes)

## Intent
- Ensure all existing projects/models in the database have Data Entity Points created for every logical and physical data entity (backfill).
- Make snapshot import backward-compatible: if a snapshot JSON does not contain `dataEntityPoints`, the system must still import successfully and then generate the missing points deterministically.
- Do not change any existing relationship tables, DTOs (other than optional snapshot field presence), or UI in this iteration.

## Scope
- Backend only (architecture-model-service): DB migration backfill, snapshot import compatibility, tests.
- No frontend changes.
- No relationship column changes.

## Constraints
- Deterministic and repeatable:
  - Backfill must be idempotent (safe to re-run).
  - Importing the same snapshot twice must not create duplicates.
- Data Entity Point IDs remain deterministic per Iteration 1:
  - dep_log_<logical_entity_id>
  - dep_phy_<physical_entity_id>
- No breaking changes to existing endpoints.

## Work

### 1) DB migration: backfill existing rows into data_entity_points (idempotent)
- Add a new Liquibase changelog that inserts missing Data Entity Points for all existing model files.
- Insert missing logical points:
  - For each row in logical_data_entities (per model_file_id), insert into data_entity_points:
    - id = 'dep_log_' || logical_data_entities.id
    - model_file_id = logical_data_entities.model_file_id
    - point_kind = 'LOGICAL_ENTITY'
    - logical_entity_id = logical_data_entities.id
    - physical_entity_id = null
  - Only when a corresponding data_entity_points row does not already exist for that (model_file_id, logical_entity_id).
- Insert missing physical points:
  - For each row in physical_data_entities (per model_file_id), insert into data_entity_points:
    - id = 'dep_phy_' || physical_data_entities.id
    - model_file_id = physical_data_entities.model_file_id
    - point_kind = 'PHYSICAL_ENTITY'
    - physical_entity_id = physical_data_entities.id
    - logical_entity_id = null
  - Only when a corresponding data_entity_points row does not already exist for that (model_file_id, physical_entity_id).
- Use SQL patterns compatible with Postgres and Liquibase, e.g. INSERT INTO ... SELECT ... WHERE NOT EXISTS (...).

### 2) Snapshot import compatibility: tolerate missing dataEntityPoints
- In snapshot import DTO parsing / mapping:
  - Treat `dataEntityPoints` as optional (null/absent should not fail validation).
- In ProjectSnapshotImportService (or equivalent import orchestration):
  - If dataEntityPoints is present:
    - Import as in Iteration 1 (upsert/merge; deterministic IDs; no duplicates).
  - If dataEntityPoints is absent:
    - After importing logical_data_entities and physical_data_entities for each model_file:
      - Invoke the same DataEntityPointEnsureService used on save/import to generate all missing points.
- Ensure import order remains:
  - model files -> logical/physical entities -> (optional points import) -> ensure points

### 3) Optional safety net: application startup backfill check (non-destructive)
- Add a lightweight startup task (guarded by config flag defaulting to enabled) that:
  - Runs the ensure/backfill logic per model_file_id to catch any DB states that predate the migration.
  - Must be idempotent and not delete anything.
  - Logs summary counts (created logical points, created physical points).
- Provide config property (e.g. `app.data-entity-points.startup-ensure=true`) so it can be disabled.

### 4) Tests
- Migration/backfill integration tests (using testcontainers or existing DB test harness):
  - Given existing logical/physical entities without points, after applying migrations points exist with correct deterministic IDs.
  - Backfill is idempotent (apply migration twice / run ensure twice does not create duplicates).
- Snapshot import tests:
  - Import legacy snapshot missing `dataEntityPoints` succeeds and results in generated points.
  - Import snapshot with explicit points still succeeds and does not duplicate.
  - Re-import same snapshot remains stable (no duplicates; IDs unchanged).
- Negative tests:
  - If legacy snapshot has entities but DB constraints prevent point creation (shouldn't happen), surface clear error message.

## Non-Goals
- No relationship schema/DTO changes.
- No UI changes.
- No deletion of orphaned/invalid points (cleanup can be a later iteration).

## Acceptance Criteria
- After deploying migrations, all existing model files have Data Entity Points for every logical and physical entity.
- Snapshot import works for both:
  - new snapshots that include `dataEntityPoints`
  - legacy snapshots that omit `dataEntityPoints`
- Backfill/ensure operations are idempotent and deterministic.
---
