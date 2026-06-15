# Codebase Grounding Notes — Library Backend Foundation (Spec 1 of 3)

Purpose: confirm/refute assumptions in `00-raw-idea.md` against the live
codebase before writing the spec. Drives the focused clarifying questions.

## Liquibase numbering

- Latest applied changeset: `121-infrastructure-terraform-readiness-fields.sql`.
- New changesets start at **122**. Confirmed via
  `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml`
  tail — last entry is `121-infrastructure-terraform-readiness-fields`.

## `application_points.target_type` — actual existing values

**FLAG — raw idea is incorrect.** Raw idea says "already accepts
`APPLICATION`, `APPLICATION_COMPONENT`, `SERVICE`."

Reality (changeset 016, the only place where the CHECK is defined):

```sql
ALTER TABLE application_points ADD CONSTRAINT chk_application_point_target_type
    CHECK (target_type IS NULL OR target_type IN ('SERVICE', 'CLASS', 'METHOD'));
```

So the existing allowed values are **`SERVICE`, `CLASS`, `METHOD`** (plus
NULL). The Java field is also TEXT-mapped (`@Column(name = "target_type")
private String targetType;`) — no enum class, no application-layer
allowed-values list found.

Implication: the migration to add `LIBRARY` is a single Liquibase
changeset that drops `chk_application_point_target_type` and re-creates
it with `LIBRARY` added. **No** Java code change strictly required (the
field is a String) other than documentation.

## Service entity — fields to mirror on Library

`ServiceEntity.java` (16 columns + 5 tech-hints columns):

- Envelope: `id`, `model_file_id`, `name`, `description`, `tags`,
  `valid_from`, `valid_to` — standard.
- Hierarchy: `application_id` NOT NULL, `application_component_id` NULL.
- Service-specific: `service_type`, `is_internal`.
- Repo + tech: `repo_location`, `repo_subfolder`, `core_tech`.
- Package set: `package_set_id` (TEXT, FK `→ package_sets(id) ON DELETE
  SET NULL` per changeset 017).
- Tech-hints (5 columns from `2026-04-20-tech-hints-resolved.sql`):
  - `core_tech_resolved JSONB NULL`
  - `core_tech_language_pack VARCHAR(100) NULL`
  - `core_tech_framework_packs JSONB NULL`
  - `core_tech_resolution_confidence VARCHAR(20) NULL` **with a DB CHECK
    constraint:**
    ```sql
    CHECK (core_tech_resolution_confidence IS NULL
           OR core_tech_resolution_confidence IN
              ('high','low','none','tech-only','manual-override'));
    ```
    Note: lowercase values, NOT `'HIGH','MEDIUM','LOW',...` as the
    orchestrator brief speculated.
  - `core_tech_resolved_at TIMESTAMP WITH TIME ZONE NULL`

For Library we mirror the 6 columns above (raw `core_tech` + 5 resolved
columns) verbatim — same types, same nullability, same CHECK constraint
on `core_tech_resolution_confidence`.

## Service does NOT have provenance columns

**FLAG — raw idea is misleading.** Raw idea says Library "Reuses spec-7
`source_origin` + `last_scanned_at` to distinguish stub vs scanned."

Reality:

- The provenance columns (`source_origin`, `source_system`,
  `source_reference`, `generation_status`, `generation_notes`,
  `last_verified_at`) were added by changeset 120 (spec 7) **only to
  Infrastructure entity / relationship tables**. Service does NOT have
  them. Note also: the column is `last_verified_at`, not
  `last_scanned_at`.
- If Library wants the same stub-vs-scanned distinction, the spec must
  add those columns explicitly to `libraries` (and they would NOT be
  inherited from any pre-existing pattern on `Service`).

Three reasonable options for the spec to consider:

1. Add the same 6-column Infrastructure-style provenance block to
   `libraries`. Most expressive, mirrors spec-7 pattern.
2. Add only `source_origin` + `last_verified_at` (subset). Lighter.
3. Skip provenance columns entirely in Spec 1; defer to Spec 3
   (discovery integration). Cleanest scope.

Recommendation in the questions: **option 1** (full 6-column block,
mirroring spec 7) — it's effectively free at table-create time and gives
discovery (Spec 3) a clean target without further migrations.

## Liquibase / DB convention quirks confirmed

- `services.package_set_id`: `TEXT REFERENCES package_sets(id) ON DELETE
  SET NULL` (changeset 017). Mirror exactly on `libraries`.
- `repo_location`, `repo_subfolder`: TEXT, NULL.
- `core_tech`: TEXT, NULL.
- Existing convention: enum-style columns are TEXT with no DB CHECK
  (the `core_tech_resolution_confidence` CHECK is the only example I
  saw of a value-list CHECK on a single-table TEXT enum, and it was
  introduced because the resolver writes a small fixed set of values).
- `confidence DECIMAL(4,3) NULL` with no DB CHECK on range — confirmed
  per spec-7 convention: range guidance is doc-only.

## MetaModelEntitiesDto / MetaModelRelationshipsDto

- Both records take additive lists at the end. Existing pattern is to
  append new lists with a section comment, no shape changes to existing
  fields. New `libraries` and `code_unit_dependencies` slots in
  identically.
- After spec 7 `MetaModelEntitiesDto` ends with `iac_sources`. Add
  `libraries` after that.
- After spec 7 `MetaModelRelationshipsDto` ends with
  `iac_resource_bindings`. Add `code_unit_dependencies` after that.

## ModelService save / load / delete

`ModelService.java`:

- `saveModel(...)` → `saveEntities(...)` + `saveRelationships(...)`.
  Each calls `repository.saveAll(entities.<list>().stream()...)` for
  every list.
- `loadModelByFileId(...)` → calls `findByModelFileId(modelFileId)` on
  every repo and assembles the DTOs.
- `deleteAllDataForModelFile(...)` → calls `deleteByModelFileId` on
  every repo in dependency-safe order: relationships first, polymorphic
  point types next, then base entity tables in reverse-FK order.

For Library:
- Save order: existing application-domain entities → `libraries`
  → existing relationships → `code_unit_dependencies`.
- Delete order: `code_unit_dependencies` → existing relationships →
  existing application-domain entities → `libraries`.

## ArchitectureCloneService.IN_SCOPE_TABLES_IN_ORDER

- Block A (entities) — APPLICATION domain currently:
  `applications`, `application_components`, `package_sets`, `packages`,
  `package_set_default_rules`, `package_set_standards_import_status`,
  `services`, `interfaces`, `endpoints`, `application_points`,
  `classes`, `methods`.
- Insert `libraries` immediately after `services` (before `interfaces`).
  Rationale: `libraries.package_set_id` references `package_sets(id)`
  same as `services` does, so it must be after `package_sets`. It does
  not need to be before any existing table.
- Block B (relationships) — append `code_unit_dependencies` at the end.

## ArchitectureElementInventoryService

- `TABLES_BY_DOMAIN.get("Applications")`: append `("libraries",
  "Libraries")` and `("code_unit_dependencies", "Code Unit
  Dependencies")` to the Applications domain entry list.
- `DISPLAY_NAME_FALLBACK_TABLES`: add `code_unit_dependencies` only
  (no `name` column). `libraries` HAS a `name` column, so it does NOT
  go here.

## Test pattern

- Round-trip integration test class: build a populated
  `MetaModelEntitiesDto` with at least one Library row (internal: with
  `repo_location`/`repo_subfolder`; external: without) and one
  `code_unit_dependencies` row, call `ModelService.saveModel(...)`,
  then `loadModelByFileId(...)`, deep-equal assert.
- Plus delete-and-replace test (smaller payload), plus polymorphic
  ApplicationPoint test (Service→Library and Library→Library edges).

## DTO naming convention

- Existing pattern: `record FooDto(...)` with `@JsonProperty("snake_case")`.
- Booleans: nullable boxed `Boolean`.
- IDs: `String`.
- `model_file_id`: not exposed in DTOs (server-side only).

## Java package layout

- Entities: `com.example.architecturemodel.model.entity.LibraryEntity`,
  `CodeUnitDependencyEntity`.
- DTOs: `com.example.architecturemodel.model.dto.entity.LibraryDto`,
  `com.example.architecturemodel.model.dto.relationship.CodeUnitDependencyDto`.
- Repos: `com.example.architecturemodel.repository.entity.LibraryRepository`,
  `com.example.architecturemodel.repository.relationship.CodeUnitDependencyRepository`.
- Mapper: extend `EntityMapper.java` bidirectionally for both new types.
