# Spec Requirements: Library Backend Foundation

## Initial Description

This is **Spec 1 of 3** in the Library arc — a follow-on to the Infrastructure 7-spec arc. The Library arc introduces a "Library" concept in the Application Architecture domain (parallel to `Service`), captures dependencies between code units, and prepares the discovery service to populate libraries automatically.

Spec 1 lands the **backend model**:

- A new `Library` entity (parallel to `Service`) with the standard envelope, library-specific fields, the same 5-column tech-hints block as `Service`, a 6-column provenance block mirroring Infrastructure spec-7, and `package_set_id` FK.
- A new `code_unit_dependencies` relationship — polymorphic source (`Service` or `Library`) and `Library` target via the existing `ApplicationPoint`.
- An update to the existing `application_points.target_type` CHECK constraint to add `LIBRARY` as an allowed value.
- Full integration with `ModelService` save / load / delete-and-replace, `ArchitectureCloneService.IN_SCOPE_TABLES_IN_ORDER`, and `ArchitectureElementInventoryService`.
- Extension of `MetaModelEntitiesDto` (+1 list `libraries`) and `MetaModelRelationshipsDto` (+1 list `code_unit_dependencies`).
- One round-trip integration test class covering save/load/delete-and-replace + polymorphic ApplicationPoint extension.

The full raw idea is preserved at `agent-os/specs/2026-05-05-library-backend-foundation/planning/00-raw-idea.md`. Codebase conventions and conflict findings are preserved at `agent-os/specs/2026-05-05-library-backend-foundation/planning/codebase-grounding.md`.

Frontend, tables UI, gridConfigs (Spec 2) and discovery integration (Spec 3) are explicitly out of scope.

## Requirements Discussion

### First Round Questions

**Q1: `application_points.target_type` CHECK — drop and recreate, or some other approach? Confirm the new allowed-values list.**
**Answer:** Confirmed. New Liquibase changeset drops the existing `chk_application_point_target_type` CHECK and re-creates it with the allowed list `IN ('SERVICE','CLASS','METHOD','LIBRARY')` plus NULL. **No Java code change required** — `ApplicationPointEntity.target_type` is a TEXT-mapped `String`, no enum class, no application-layer allowed-values list.

**Q2: Provenance columns on `libraries` — full 6-column spec-7 block, lighter subset, or skip until Spec 3?**
**Answer:** Option (a) — **full 6-column spec-7 block**: `source_origin`, `source_system`, `source_reference`, `generation_status`, `generation_notes`, `last_verified_at`. Mirrors Infrastructure entities exactly. It is effectively free at table-create time and gives discovery (Spec 3) a clean target without further migrations.

**Q3: `core_tech_resolution_confidence` CHECK on `libraries` — mirror Service verbatim?**
**Answer:** Confirmed. Mirror Service verbatim: `CHECK (core_tech_resolution_confidence IS NULL OR core_tech_resolution_confidence IN ('high','low','none','tech-only','manual-override'))`. **Lowercase values**, exactly as on `services`.

**Q4: Library uniqueness — DB UNIQUE constraint on `(name, ecosystem)`, or dedup at the resolver layer?**
**Answer:** Confirmed: **NO DB UNIQUE constraint** on `(name, ecosystem)`. Dedup happens at the resolver layer in Spec 3 (discovery integration). Multiple library rows with the same `(name, ecosystem)` are technically permitted by the DB; the resolver is responsible for upsert-style behaviour.

**Q5: `ecosystem` and `scope` enums — add DB CHECK or keep allowed values as documentation only?**
**Answer:** Confirmed: **TEXT NULL**, no DB CHECK on either column. Allowed values are documentation-only (matches the existing convention for enum-style columns elsewhere in the service — only `core_tech_resolution_confidence` has a value-list CHECK). Manifest-language-specific scope values are stored verbatim.
- `ecosystem` allowed values (doc-only): `MAVEN`, `NPM`, `PYPI`, `NUGET`, `GO`, `OTHER`.
- `scope` allowed values (doc-only): `COMPILE`, `RUNTIME`, `TEST`, `PROVIDED`, `OPTIONAL` (Maven); `RUNTIME`, `DEV`, `PEER`, `OPTIONAL` (npm).

**Q6: `code_unit_dependencies.target_application_point_id.target_type = 'LIBRARY'` — enforce at DB level (trigger, denorm column + CHECK), or doc-only?**
**Answer:** Confirmed: **doc-only constraint**. No DB-level trigger, no denormalised `target_target_type` column with a CHECK, no FK indirection. The relationship's spec text and the integration test cover that the target ApplicationPoint must have `target_type = 'LIBRARY'`. This matches the existing convention for analogous polymorphic-via-`ApplicationPoint` relationships.

### Locked-decision corrections from grounding (Pass A conflict resolutions)

The following three corrections override the raw idea where it conflicted with codebase reality. All three were confirmed by the user.

1. **`application_points.target_type` existing values (raw idea was wrong).** Raw idea claimed the CHECK already accepts `APPLICATION`, `APPLICATION_COMPONENT`, `SERVICE`. Reality (changeset 016): the existing CHECK is `IN ('SERVICE', 'CLASS', 'METHOD')` plus NULL. The migration therefore drops the existing CHECK and re-creates it as `IN ('SERVICE','CLASS','METHOD','LIBRARY')` plus NULL.
2. **`Library.description` and `Library.tags` nullability (override raw idea).** Raw idea said `description TEXT NOT NULL`, `tags TEXT NOT NULL`. The codebase convention (every other entity, including Service) is **nullable** `description` and `tags`. **Use `TEXT NULL` for both.** The same correction applies to `code_unit_dependencies.description` and `code_unit_dependencies.tags` — both `TEXT NULL`.
3. **Provenance columns are 6, with `last_verified_at` (not `last_scanned_at`).** Raw idea referred to `source_origin + last_scanned_at`. Reality (changeset 120 / spec 7): the provenance block is exactly 6 columns — `source_origin`, `source_system`, `source_reference`, `generation_status`, `generation_notes`, `last_verified_at`. `Library` mirrors that exact 6-column block.

### Inferred Decisions (all 10 accepted)

These were inferred from the codebase grounding and accepted by the user without override:

1. **Liquibase numbering starts at 122.** Latest applied changeset is `121-infrastructure-terraform-readiness-fields.sql`.
2. **`model_file_id` scoping.** Both new tables have `model_file_id TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE`. No `project_id` / `architecture_id` columns directly on the tables.
3. **Standard entity envelope.** `id TEXT PRIMARY KEY`, `name TEXT NOT NULL` (where applicable), `description TEXT NULL`, `tags TEXT NULL`, `valid_from TEXT NULL`, `valid_to TEXT NULL`. No `created_at` / `updated_at`.
4. **Tags storage.** Single TEXT column (not JSON, not link table). Matches every other entity.
5. **ID typing.** All primary keys are `String` (TEXT) at DTO and entity level. No UUID.
6. **DTO style.** Java records in `model/dto/entity/` and `model/dto/relationship/` with `@JsonProperty("snake_case")` on every field. `model_file_id` not exposed in DTOs (server-side only).
7. **Repositories.** Extend `JpaRepository<TEntity, String>`; provide `findByModelFileId(String)` and `deleteByModelFileId(String)`.
8. **`package_set_id` FK convention.** Mirror `services.package_set_id`: `TEXT REFERENCES package_sets(id) ON DELETE SET NULL`.
9. **`confidence` column.** `DECIMAL(4,3) NULL`, no DB CHECK, no JPA validation. Range guidance is documentation-only — same as every other relationship since spec 7.
10. **MetaModel DTO extension is additive.** Append `libraries` to `MetaModelEntitiesDto` after the spec-7 `iac_sources` field; append `code_unit_dependencies` to `MetaModelRelationshipsDto` after the spec-7 `iac_resource_bindings` field. No shape changes to existing fields.

### Existing Code to Reference

The codebase grounding identified the following authoritative reference points:

- **`ServiceEntity` and the `services` table** (`architecture-model-service/src/main/java/.../entity/ServiceEntity.java` and changesets `014-service-core-tech.sql`, `017-package-sets.sql` (or wherever `package_set_id` is added), `080-service-repo-location-subfolder.sql`, `2026-04-20-tech-hints-resolved.sql`) — the authoritative pattern for `LibraryEntity`. Library mirrors `repo_location`, `repo_subfolder`, `core_tech`, the 5-column tech-hints block, and `package_set_id` exactly.
- **Service tech-hints CHECK** (`2026-04-20-tech-hints-resolved.sql`) — verbatim source for `libraries.core_tech_resolution_confidence` CHECK.
- **`ApplicationPointEntity` + `application_points` table** + changeset `016-application-points.sql` (or wherever the CHECK is defined) — defines the existing CHECK that needs to be dropped and re-created.
- **Infrastructure provenance block** (changeset 120, `2026-05-04-…-provenance-fields.sql` family) — the authoritative 6-column block to copy onto `libraries`.
- **DTO record pattern** (`model/dto/entity/*.java`, e.g. `ServiceDto`) — `LibraryDto` mirrors this. Relationship DTO pattern (`model/dto/relationship/*.java`, e.g. `DataMovementDto`) — `CodeUnitDependencyDto` mirrors this.
- **Repository pattern** (`repository/entity/*Repository.java`, `repository/relationship/*Repository.java`) — standard `findByModelFileId` / `deleteByModelFileId` skeleton.
- **`ModelService`** (`service/ModelService.java`) — `saveModel`, `loadModelByFileId`, `deleteAllDataForModelFile`, `saveEntities`, `saveRelationships`. New repos must be invoked in both halves.
- **`ArchitectureCloneService`** (`service/ArchitectureCloneService.java`) — `IN_SCOPE_TABLES_IN_ORDER` Block A (entities) and Block B (relationships).
- **`ArchitectureElementInventoryService`** — `TABLES_BY_DOMAIN.Applications`, `DISPLAY_NAME_FALLBACK_TABLES`.
- **`MetaModelEntitiesDto` / `MetaModelRelationshipsDto`** — extend with new lists; do not restructure.
- **Liquibase master**: `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml`. Latest applied: `121-infrastructure-terraform-readiness-fields.sql`. New changesets start at `122-`.

### Follow-up Questions

No follow-up questions were needed. All 6 first-round questions were answered, all 10 inferred decisions were accepted, and the 3 Pass A conflict resolutions were confirmed.

## Visual Assets

### Files Provided

Bash check on `agent-os/specs/2026-05-05-library-backend-foundation/planning/visuals/` returned no image/PDF files.

No visual assets provided.

### Visual Insights

N/A — backend-only spec, no UI artefacts. Reference design is `ServiceEntity` + `services` table for the entity, and the existing `ApplicationPoint`-typed relationships for the polymorphic relationship pattern.

## Requirements Summary

### Functional Requirements

The backend service must support:

1. **Persisting and returning** the `Library` entity as part of the architecture meta-model.
2. **Persisting and returning** the `code_unit_dependencies` relationship as part of the architecture meta-model.
3. **Polymorphic source** on `code_unit_dependencies` via `ApplicationPoint` — the source ApplicationPoint must have `target_type IN ('SERVICE','LIBRARY')` (caller-/test-enforced; doc-only DB constraint).
4. **Library-only target** on `code_unit_dependencies` — the target ApplicationPoint must have `target_type = 'LIBRARY'` (caller-/test-enforced; doc-only DB constraint).
5. **`application_points.target_type` extension** — drop existing CHECK and re-create with `LIBRARY` added.
6. **Save / load / delete-and-replace** integration with `ModelService` matching every other domain's behaviour.
7. **`MetaModelEntitiesDto` extension** with `libraries` list (snake_case JSON name, appended after `iac_sources`).
8. **`MetaModelRelationshipsDto` extension** with `code_unit_dependencies` list (snake_case JSON name, appended after `iac_resource_bindings`).
9. **`ArchitectureCloneService` integration** — `libraries` after `services` in Block A; `code_unit_dependencies` at end of Block B.
10. **`ArchitectureElementInventoryService` integration** — `Applications` domain += `("libraries","Libraries")` and `("code_unit_dependencies","Code Unit Dependencies")`; `DISPLAY_NAME_FALLBACK_TABLES` += `code_unit_dependencies` (only — `libraries` has `name`).
11. **Project + architecture scoping** preserved via `model_file_id` (no new `project_id` / `architecture_id` columns on the new tables).
12. **Backward compatibility** — existing Service / AppComponent / Application / related Application-domain relationships unchanged; existing tests continue to pass.
13. **Liquibase migrations** create the new tables and update the existing CHECK idempotently without breaking existing data.
14. **New backend tests** cover (a) save/load/delete-and-replace round-trip for `libraries` + `code_unit_dependencies`, (b) internal vs. external library variants (with/without `repo_location`+`repo_subfolder`), (c) Service→Library and Library→Library polymorphic edges, (d) `application_points.target_type = 'LIBRARY'` is accepted.

### Per-Table Column Shapes (verbatim, with types)

#### Table: `libraries`

Standard envelope:

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | TEXT | NO (PK) | |
| `model_file_id` | TEXT | NO | `REFERENCES model_files(id) ON DELETE CASCADE` |
| `name` | TEXT | NO | The library's identity (`group:artifact` for Maven, package name for npm). Combined with `ecosystem` for the doc-only uniqueness key. |
| `description` | TEXT | YES | Nullable per codebase convention (overrides raw idea's NOT NULL). |
| `tags` | TEXT | YES | Nullable per codebase convention (overrides raw idea's NOT NULL). |
| `valid_from` | TEXT | YES | |
| `valid_to` | TEXT | YES | |

Library-specific fields:

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `ecosystem` | TEXT | YES | Doc-only allowed values: `MAVEN`, `NPM`, `PYPI`, `NUGET`, `GO`, `OTHER`. **No DB CHECK.** |
| `repo_location` | TEXT | YES | Set if internal/scannable. |
| `repo_subfolder` | TEXT | YES | Set if internal/scannable. |
| `core_tech` | TEXT | YES | Raw text, LLM-resolved (mirrors `Service.core_tech`). |

Tech-hints columns (5, mirror `services` verbatim — same types, same nullability, same CHECK):

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `core_tech_resolved` | JSONB | YES | Full resolver response JSON. |
| `core_tech_language_pack` | VARCHAR(100) | YES | Denormalised language pack ID. |
| `core_tech_framework_packs` | JSONB | YES | Denormalised framework pack IDs (string array). |
| `core_tech_resolution_confidence` | VARCHAR(20) | YES | **CHECK `(IS NULL OR IN ('high','low','none','tech-only','manual-override'))`** — lowercase, mirrors Service verbatim. |
| `core_tech_resolved_at` | TIMESTAMP WITH TIME ZONE | YES | |

Provenance columns (6, mirror Infrastructure spec-7 verbatim):

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `source_origin` | TEXT | YES | |
| `source_system` | TEXT | YES | |
| `source_reference` | TEXT | YES | |
| `generation_status` | TEXT | YES | |
| `generation_notes` | TEXT | YES | |
| `last_verified_at` | TIMESTAMP WITH TIME ZONE | YES | Note: column is `last_verified_at`, **not** `last_scanned_at`. |

Package set FK:

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `package_set_id` | TEXT | YES | `REFERENCES package_sets(id) ON DELETE SET NULL` (mirrors `services.package_set_id`). |

Indexes / constraints on `libraries`:

- PK on `id`.
- FK on `model_file_id` with `ON DELETE CASCADE`.
- FK on `package_set_id` with `ON DELETE SET NULL`.
- CHECK on `core_tech_resolution_confidence` (verbatim from Service).
- **No** DB UNIQUE on `(name, ecosystem)` — dedup happens at the resolver layer in Spec 3.
- Performance index on `(model_file_id)` to support `findByModelFileId`.

#### Table: `code_unit_dependencies`

| Column | Type | Nullable | References | Notes |
|---|---|---|---|---|
| `id` | TEXT | NO (PK) | — | |
| `model_file_id` | TEXT | NO | `model_files(id) ON DELETE CASCADE` | |
| `source_application_point_id` | TEXT | NO | `application_points(id)` | Polymorphic source. The referenced ApplicationPoint must have `target_type IN ('SERVICE','LIBRARY')`. **Doc-only** — no DB trigger, no denorm column, no extra CHECK. |
| `target_application_point_id` | TEXT | NO | `application_points(id)` | Library target. The referenced ApplicationPoint must have `target_type = 'LIBRARY'`. **Doc-only** — no DB trigger, no denorm column, no extra CHECK. |
| `declared_name` | TEXT | YES | — | E.g. `com.example:lib-foo`. |
| `declared_version` | TEXT | YES | — | E.g. `1.4.2`. |
| `declared_version_range` | TEXT | YES | — | E.g. `^1.2.0`, `[1.0,2.0)`. |
| `scope` | TEXT | YES | — | Doc-only allowed values: Maven (`COMPILE`, `RUNTIME`, `TEST`, `PROVIDED`, `OPTIONAL`) / npm (`RUNTIME`, `DEV`, `PEER`, `OPTIONAL`). Manifest-language-specific values stored verbatim. **No DB CHECK.** |
| `manifest_path` | TEXT | YES | — | E.g. `pom.xml`, `services/orders/package.json`. |
| `manifest_line` | INTEGER | YES | — | |
| `evidence_source` | TEXT | YES | — | |
| `confidence` | DECIMAL(4,3) | YES | — | No DB CHECK; no JPA validation. |
| `description` | TEXT | YES | — | Nullable per codebase convention (overrides raw idea's NOT NULL). |
| `tags` | TEXT | YES | — | Nullable per codebase convention (overrides raw idea's NOT NULL). |

Indexes / constraints on `code_unit_dependencies`:

- PK on `id`.
- FK on `model_file_id` with `ON DELETE CASCADE`.
- FKs on `source_application_point_id` and `target_application_point_id` to `application_points(id)` (default `NO ACTION`; cleanup via `deleteAllDataForModelFile`).
- Performance index on `(model_file_id)` to support `findByModelFileId`.

### Liquibase Changeset List

Three new sequential changesets in `architecture-model-service/src/main/resources/db/changelog/sql/`, each registered in `db.changelog-master.yaml`. Each changeSet uses `preConditions: onFail: MARK_RAN` with `not: tableExists` (where applicable). Never edit applied changesets.

| # | Filename | Purpose |
|---|---|---|
| 122 | `122-libraries.sql` | Create `libraries` table — standard envelope + library-specific fields (`ecosystem`, `repo_location`, `repo_subfolder`, `core_tech`) + 5 tech-hints columns (with `core_tech_resolution_confidence` CHECK) + 6 provenance columns + `package_set_id` FK to `package_sets(id) ON DELETE SET NULL` + perf index on `(model_file_id)`. No UNIQUE on `(name, ecosystem)`. |
| 123 | `123-code-unit-dependencies.sql` | Create `code_unit_dependencies` table — standard envelope (with nullable `description`/`tags`) + `source_application_point_id` and `target_application_point_id` FKs to `application_points(id)` + declared coordinates (`declared_name`, `declared_version`, `declared_version_range`) + `scope` + `manifest_path`/`manifest_line` + evidence/confidence + perf index on `(model_file_id)`. |
| 124 | `124-application-points-target-type-library.sql` | Drop existing `chk_application_point_target_type` CHECK and re-create it as `CHECK (target_type IS NULL OR target_type IN ('SERVICE','CLASS','METHOD','LIBRARY'))`. **No** Java code change; existing rows unaffected. |

Order rationale: `libraries` (122) is created first because `code_unit_dependencies` does not depend on it directly (the dependency is via `application_points`, which already exists), but it is the parent entity for the relationship and must exist before the relationship can be saved. `code_unit_dependencies` (123) is created next. The CHECK update (124) is independent of both new tables and could be ordered anywhere among 122/123/124, but is placed last for clarity (the CHECK update unblocks `LIBRARY` ApplicationPoint rows that the new relationship references).

### File-Touch Summary (backend)

#### New files

- `architecture-model-service/src/main/resources/db/changelog/sql/122-libraries.sql`
- `architecture-model-service/src/main/resources/db/changelog/sql/123-code-unit-dependencies.sql`
- `architecture-model-service/src/main/resources/db/changelog/sql/124-application-points-target-type-library.sql`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/LibraryEntity.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/CodeUnitDependencyEntity.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/LibraryDto.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/relationship/CodeUnitDependencyDto.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/LibraryRepository.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/repository/relationship/CodeUnitDependencyRepository.java`
- One round-trip integration test class under `architecture-model-service/src/test/java/...` covering save/load/delete-and-replace + scoping + polymorphic ApplicationPoint extension (Service→Library and Library→Library + `target_type='LIBRARY'` acceptance).

#### Modified files

- `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml` — register `122-libraries.sql`, `123-code-unit-dependencies.sql`, `124-application-points-target-type-library.sql`.
- `architecture-model-service/src/main/java/.../model/dto/MetaModelEntitiesDto.java` — append `libraries` list after `iac_sources`.
- `architecture-model-service/src/main/java/.../model/dto/MetaModelRelationshipsDto.java` — append `code_unit_dependencies` list after `iac_resource_bindings`.
- `architecture-model-service/src/main/java/.../model/EntityMapper.java` — extend bidirectionally for `LibraryEntity ↔ LibraryDto` and `CodeUnitDependencyEntity ↔ CodeUnitDependencyDto`.
- `architecture-model-service/src/main/java/.../service/ModelService.java` — invoke new repos in `saveEntities`, `saveRelationships`, `loadModelByFileId`, `deleteAllDataForModelFile`. Order: existing application-domain entities → `libraries` → existing relationships → `code_unit_dependencies` (save); reverse on delete.
- `architecture-model-service/src/main/java/.../service/ArchitectureCloneService.java` — `IN_SCOPE_TABLES_IN_ORDER`: insert `libraries` after `services` in Block A; append `code_unit_dependencies` at end of Block B.
- `architecture-model-service/src/main/java/.../service/ArchitectureElementInventoryService.java` — `TABLES_BY_DOMAIN.Applications` += `("libraries","Libraries")` and `("code_unit_dependencies","Code Unit Dependencies")`; `DISPLAY_NAME_FALLBACK_TABLES` += `code_unit_dependencies` only.

### Reusability Opportunities

- **`ServiceEntity` + `services` table**: authoritative blueprint for `LibraryEntity`. Copy `repo_location`, `repo_subfolder`, `core_tech`, the 5 tech-hints columns (with the `core_tech_resolution_confidence` CHECK lifted verbatim), and `package_set_id` FK shape verbatim.
- **Infrastructure spec-7 6-column provenance block**: copy the column names, types, and nullability verbatim onto `libraries`.
- **`ApplicationPoint`**: existing supertype is fully reused. Only the CHECK is updated. No new polymorphic supertype is introduced.
- **DTO record + `@JsonProperty("snake_case")` style**: copy from `ServiceDto` for `LibraryDto`; copy from any existing relationship DTO for `CodeUnitDependencyDto`.
- **Repository skeletons**: `findByModelFileId` + `deleteByModelFileId` from any existing `*Repository`.
- **`ModelService` save/load/delete loop**: existing per-domain repository iteration is the integration point; add 1 entity call and 1 relationship call to each half.
- **`MetaModelEntitiesDto` / `MetaModelRelationshipsDto`**: extend additively; do not restructure.

### Scope Boundaries

**In Scope:**

- 1 new entity table `libraries` + JPA entity + DTO + repository.
- 1 new relationship table `code_unit_dependencies` + JPA entity + DTO + repository.
- 1 update to `application_points.target_type` CHECK (drop and recreate to add `LIBRARY`).
- `MetaModelEntitiesDto` and `MetaModelRelationshipsDto` extension with snake_case JSON names.
- `EntityMapper` bidirectional extension for both new types.
- `ModelService` integration for save / load / delete-and-replace.
- `ArchitectureCloneService.IN_SCOPE_TABLES_IN_ORDER` extension (Block A and Block B).
- `ArchitectureElementInventoryService` extension (`TABLES_BY_DOMAIN.Applications`, `DISPLAY_NAME_FALLBACK_TABLES`).
- 3 Liquibase changesets (`122-`, `123-`, `124-`).
- One round-trip integration test class covering save/load/delete-and-replace + scoping + polymorphic ApplicationPoint extension (Service→Library and Library→Library) + `target_type='LIBRARY'` acceptance.

**Out of Scope** (verbatim from raw idea):

- Frontend TypeScript types (Spec 2).
- Tables UI / gridConfigs (Spec 2).
- Discovery service deterministic resolvers, preflight modal, transitive walker, right-click menu items, progress UX (Spec 3).
- Per-version Library rows (versions stay on the edge).
- `core_tech` LLM resolution wiring for Libraries (the columns are added but resolver wiring stays generic; Spec 3 connects discovery's tech-hints resolver to libraries the same way it does for services).
- Gateway / MCP changes.

### Technical Considerations

- **No DB UNIQUE on `(libraries.name, libraries.ecosystem)`** — dedup is the resolver's responsibility (Spec 3). The DB will technically allow duplicates; tests should not assert DB-level rejection.
- **No DB-level `confidence` validation** — `DECIMAL(4,3)` only; no CHECK; no JPA validation. Range guidance is doc-only (matches every other relationship since spec 7).
- **No DB-level enforcement of `target_application_point_id.target_type = 'LIBRARY'`** — doc-only constraint; integration test covers it.
- **No DB-level enforcement of `source_application_point_id.target_type IN ('SERVICE','LIBRARY')`** — doc-only constraint; integration test covers Service→Library and Library→Library variants.
- **`description` and `tags` are nullable** on both `libraries` and `code_unit_dependencies` (override of raw idea's NOT NULL — matches codebase convention).
- **`core_tech_resolution_confidence` CHECK** must use **lowercase** values exactly: `'high','low','none','tech-only','manual-override'`. This is the only value-list CHECK introduced by this spec.
- **Provenance column name is `last_verified_at`**, not `last_scanned_at` (raw idea was wrong).
- **Cross-entity FK delete behaviour**: `model_file_id` cascades; sibling FKs (`package_set_id`, `source_application_point_id`, `target_application_point_id`) default to `NO ACTION`; cleanup via `ModelService.deleteAllDataForModelFile`.
- **`package_set_id` deviates** to `ON DELETE SET NULL` (mirrors `services.package_set_id`).
- **MetaModel DTO list naming**: `libraries` (snake_case JSON) and `code_unit_dependencies` (snake_case JSON), each appended at the end of its respective DTO.

## Acceptance Criteria

(Copied verbatim from raw idea.)

- Backend supports Library records scoped by project and architecture.
- Backend supports CodeUnitDependency records scoped by project and architecture.
- Source side of dependency can be a Service or a Library via `ApplicationPoint`.
- Target side of dependency must be a Library (validated at the data layer via the polymorphic point's `target_type` constraint).
- Internal libraries (with `repo_location`/`repo_subfolder` set) and external libraries (without) round-trip cleanly.
- Library identity is `(name, ecosystem)`; multiple library rows with the same `name` but different `ecosystem` coexist.
- Edge declared coordinates (`declared_name`, `declared_version`, `declared_version_range`, `scope`, `manifest_path`, `manifest_line`) round-trip cleanly.
- Full-model save/load/delete-and-replace integrates Libraries and dependencies via existing `ModelService`.
- `ArchitectureCloneService` and `ArchitectureElementInventoryService` correctly include the new tables.
- `application_points.target_type = 'LIBRARY'` is accepted; existing target types continue to work unchanged.
- Existing Application-domain behaviour (Service, AppComponent, Application, related relationships) remains unchanged.
- New backend tests cover round-trip + scoping + polymorphic ApplicationPoint extension.
- No frontend changes, no discovery service changes, no gateway / MCP changes.
