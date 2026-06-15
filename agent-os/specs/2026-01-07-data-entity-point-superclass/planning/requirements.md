# Add Data Entity Point superclass (DB + backend model + snapshot support) without changing relationships

## Title
Add Data Entity Point superclass (DB + backend model + snapshot support) without changing relationships

## Intent
- Introduce a new first-class meta-model superclass entity: Data Entity Point.
- Ensure every Logical Data Entity and Physical Data Entity has a corresponding Data Entity Point record in the DB.
- Include Data Entity Points in project snapshot export/import.
- Do not modify any existing relationship tables or UI in this iteration.

## Scope
- Backend only (architecture-model-service): schema, JPA entities, repositories, DTOs/mappers, snapshot export/import, and tests.
- No frontend changes.
- No relationship column changes.

## Constraints
- DB remains the source of truth.
- Deterministic, repeatable imports: importing the same snapshot twice must not create duplicates.
- One active project at a time assumption remains unchanged.
- No breaking changes to existing endpoints.

## Design
- New table: data_entity_points
- A Data Entity Point links to exactly one of:
  - logical_data_entities OR physical_data_entities
- Deterministic ID scheme to avoid collisions:
  - Logical:  dep_log_<logical_data_entity_id>
  - Physical: dep_phy_<physical_data_entity_id>
  (IDs must be stable across export/import and across re-imports.)

## Work

### 1) Database migration: create data_entity_points table
- Add a new Liquibase changelog file (next in sequence) to create table `data_entity_points` with columns:
  - id                  varchar(...) primary key
  - model_file_id        varchar(...) not null  (FK to model_files.id, same pattern as other meta-model tables)
  - point_kind           varchar(...) not null  (enum-like string; values: LOGICAL_ENTITY, PHYSICAL_ENTITY)
  - logical_entity_id    varchar(...) null      (FK to logical_data_entities.id)
  - physical_entity_id   varchar(...) null      (FK to physical_data_entities.id)
  - tags                 text/null (match conventions of other entities if present; optional)
  - description          text/null (optional)
  - valid_from           timestamptz/null (optional, consistent with other tables if used)
  - valid_to             timestamptz/null
- Constraints:
  - FK: model_file_id -> model_files(id) ON DELETE CASCADE (match existing conventions)
  - FK: logical_entity_id -> logical_data_entities(id)
  - FK: physical_entity_id -> physical_data_entities(id)
  - CHECK constraint enforcing exactly one FK is set:
    - (logical_entity_id is not null AND physical_entity_id is null) OR
      (logical_entity_id is null AND physical_entity_id is not null)
  - UNIQUE constraints for determinism:
    - unique (model_file_id, logical_entity_id) where logical_entity_id is not null
    - unique (model_file_id, physical_entity_id) where physical_entity_id is not null
  - Indexes:
    - index on model_file_id
    - index on logical_entity_id
    - index on physical_entity_id

### 2) JPA entity + repository
- Add entity class: DataEntityPointEntity (package consistent with other persistence entities)
  - fields mapping all columns above
  - many-to-one relationship to ModelFileEntity (if that's your pattern)
  - optional many-to-one to LogicalDataEntityEntity and PhysicalDataEntityEntity (only one populated)
- Add Spring Data repository: DataEntityPointRepository
  - findByModelFileIdAndLogicalEntityId(...)
  - findByModelFileIdAndPhysicalEntityId(...)
  - findAllByModelFileId(...)

### 3) Snapshot DTO + mapper inclusion
- Extend ProjectSnapshotDto / ModelDto structures to include:
  - dataEntityPoints: DataEntityPointDto[]
- Add DataEntityPointDto with:
  - id
  - modelFileId
  - pointKind (LOGICAL_ENTITY|PHYSICAL_ENTITY)
  - logicalEntityId (nullable)
  - physicalEntityId (nullable)
  - description (optional if column exists)
  - tags (optional if column exists)
  - validFrom/validTo (if used elsewhere; keep consistent)
- Update snapshot export mapping so:
  - data_entity_points rows are included for the active project's model file(s).
- Update snapshot import mapping so:
  - dataEntityPoints are imported deterministically (upsert/merge behavior)
  - repeated imports do not duplicate (rely on IDs + unique constraints)
  - import order ensures referenced logical/physical entities are inserted before points

### 4) "Ensure points exist" mapping for entities (no relationship changes)
- Add a service: DataEntityPointEnsureService (or add to existing Model save pipeline) that guarantees:
  - For each logical_data_entity in the model file, a point exists with:
    - id = "dep_log_" + logicalEntityId
    - pointKind = LOGICAL_ENTITY
    - logical_entity_id = logicalEntityId
  - For each physical_data_entity in the model file, a point exists with:
    - id = "dep_phy_" + physicalEntityId
    - pointKind = PHYSICAL_ENTITY
    - physical_entity_id = physicalEntityId
- Integrate the ensure step into:
  - ModelService.saveModel(...) AFTER entities are persisted (logical/physical entities) and BEFORE transaction commit.
  - Snapshot import flow AFTER importing logical/physical entities and BEFORE finishing import (so snapshot becomes internally consistent).
- Implementation rules:
  - Use repository lookups by (modelFileId, logicalEntityId)/(modelFileId, physicalEntityId) to detect missing points.
  - Create only missing points; do not delete points in this iteration.
  - If a point exists but violates invariants (e.g. both FKs set), fail import/save with a clear validation exception.

### 5) Tests
- Add migration test / repository integration test:
  - creating logical entity then running ensure creates dep_log_<id> in same model file
  - creating physical entity then running ensure creates dep_phy_<id>
  - ensure is idempotent (running twice does not create duplicates)
- Snapshot export/import tests:
  - export includes dataEntityPoints array
  - import of snapshot containing logical/physical entities + points succeeds
  - re-import same snapshot does not duplicate points and remains consistent
- Negative constraint tests:
  - attempt to insert a point with both logical_entity_id and physical_entity_id set fails
  - attempt to insert a point with neither set fails

## Non-Goals
- No UI dropdown changes.
- No relationship table/DTO changes (Logical ER and Data Movements remain as-is in this iteration).
- No backfill/migration of existing data beyond ensuring points on save/import (true backfill can come in Iteration 2).

## Acceptance Criteria
- `data_entity_points` table exists with correct constraints and indexes.
- Saving a model that includes logical/physical entities results in corresponding deterministic Data Entity Points being present in DB.
- Snapshot export includes Data Entity Points; snapshot import restores them deterministically.
- No existing relationship behavior is changed and no existing endpoints break.
