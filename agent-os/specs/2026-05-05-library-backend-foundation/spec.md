# Specification: Library Backend Foundation

## Goal
Add the backend persistence and meta-model foundation for a `Library` entity (parallel to `Service`) and a `code_unit_dependencies` relationship in the Spring Boot `architecture-model-service`, fully integrated with the existing save/load/delete-and-replace pipeline. This is Spec 1 of 3 in the Library arc.

## User Stories
- As an architect, I want the backend to persist and return Library entities and Service/Library code-unit dependencies as part of the architecture meta-model so that future spec increments can build the frontend (Spec 2) and discovery integration (Spec 3) against a stable backend contract.
- As a backend developer, I want `code_unit_dependencies` to reuse the existing `ApplicationPoint` polymorphic supertype with a relaxed `target_type` CHECK so that no new polymorphic point table is introduced and Service/Library sources and Library targets share a single edge shape.

## Specific Requirements

**`libraries` table — entity (changeset 122)**
- Standard envelope: `id TEXT PK`, `model_file_id TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE`, `name TEXT NOT NULL`, `description TEXT NULL`, `tags TEXT NULL`, `valid_from TEXT NULL`, `valid_to TEXT NULL`. No `created_at`/`updated_at`.
- Library-specific fields: `ecosystem TEXT NULL` (doc-only allowed values `MAVEN`/`NPM`/`PYPI`/`NUGET`/`GO`/`OTHER`, no DB CHECK), `repo_location TEXT NULL`, `repo_subfolder TEXT NULL`, `core_tech TEXT NULL` — mirrors `services` exactly.
- Tech-hints columns (5, mirror `services` verbatim): `core_tech_resolved JSONB NULL`, `core_tech_language_pack VARCHAR(100) NULL`, `core_tech_framework_packs JSONB NULL`, `core_tech_resolution_confidence VARCHAR(20) NULL` with CHECK `(IS NULL OR IN ('high','low','none','tech-only','manual-override'))` (lowercase, lifted verbatim from `services`), `core_tech_resolved_at TIMESTAMP WITH TIME ZONE NULL`.
- Provenance columns (6, mirror Infrastructure spec-7 verbatim): `source_origin TEXT NULL`, `source_system TEXT NULL`, `source_reference TEXT NULL`, `generation_status TEXT NULL`, `generation_notes TEXT NULL`, `last_verified_at TIMESTAMP WITH TIME ZONE NULL`. Note: `last_verified_at`, **not** `last_scanned_at`.
- Package set FK: `package_set_id TEXT NULL REFERENCES package_sets(id) ON DELETE SET NULL` (mirrors `services.package_set_id`).
- Performance index on `(model_file_id)`.
- **No** DB UNIQUE on `(name, ecosystem)` — Library identity `(name, ecosystem)` is enforced at the resolver layer in Spec 3, not at the DB.

**`code_unit_dependencies` table — relationship (changeset 123)**
- `id TEXT PK`, `model_file_id TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE`.
- Polymorphic endpoints via existing `ApplicationPoint`: `source_application_point_id TEXT NOT NULL REFERENCES application_points(id)`, `target_application_point_id TEXT NOT NULL REFERENCES application_points(id)`. Both default `NO ACTION`.
- Declared coordinates: `declared_name TEXT NULL`, `declared_version TEXT NULL`, `declared_version_range TEXT NULL`.
- `scope TEXT NULL` (manifest-language-specific values stored verbatim — Maven `COMPILE`/`RUNTIME`/`TEST`/`PROVIDED`/`OPTIONAL`, npm `RUNTIME`/`DEV`/`PEER`/`OPTIONAL`; **no** DB CHECK).
- Manifest provenance: `manifest_path TEXT NULL`, `manifest_line INTEGER NULL`.
- Edge metadata: `evidence_source TEXT NULL`, `confidence DECIMAL(4,3) NULL` (no DB CHECK, no JPA validation, range 0.0–1.0 doc-only).
- `description TEXT NULL`, `tags TEXT NULL` — both nullable per existing relationship convention (overrides raw idea's NOT NULL).
- Performance index on `(model_file_id)`.
- Doc-only constraints: `target_application_point_id` must reference an ApplicationPoint with `target_type = 'LIBRARY'`; `source_application_point_id` must reference an ApplicationPoint with `target_type IN ('SERVICE','LIBRARY')`. **No** DB trigger, **no** denormalised type column, **no** extra CHECK — covered by integration test only.

**`application_points.target_type` CHECK relax (changeset 124)**
- DROP existing CHECK constraint `chk_application_point_target_type` (defined in changeset 016 as `IN ('SERVICE','CLASS','METHOD')`).
- ADD new CHECK: `target_type IS NULL OR target_type IN ('SERVICE','CLASS','METHOD','LIBRARY')`.
- **No** Java code change — `ApplicationPointEntity.targetType` is plain `String`, no enum class, no application-layer allowed-values list.
- Existing rows unaffected; existing target types continue to work unchanged.

**JPA entities**
- `LibraryEntity` in `model/entity/` — mirrors `ServiceEntity` style: Lombok, `@Entity`, `@Table(name = "libraries")`, `@Column(name = "snake_case")` on every field. JSONB columns mapped per Hibernate convention used by `ServiceEntity` (`@JdbcTypeCode(SqlTypes.JSON)` or matching pattern — copy verbatim).
- `CodeUnitDependencyEntity` in `model/entity/` — mirrors `DataMovementEntity` style.
- All snake_case column names; all IDs are `String`; all booleans nullable boxed `Boolean` (none introduced this spec, but pattern preserved).

**DTOs (Java records)**
- `LibraryDto` in `model/dto/entity/` — record with `@JsonProperty("snake_case")` on every field; `model_file_id` is server-side only and **not** exposed in the DTO. Mirrors `ServiceDto` field-for-field plus the 6 provenance fields.
- `CodeUnitDependencyDto` in `model/dto/relationship/` — record with `@JsonProperty("snake_case")` on every field. `confidence` is `BigDecimal` (nullable). Mirrors existing relationship DTO style.

**Repositories**
- `LibraryRepository extends JpaRepository<LibraryEntity, String>` in `repository/entity/` with `findByModelFileId(String)` and `deleteByModelFileId(String)`.
- `CodeUnitDependencyRepository extends JpaRepository<CodeUnitDependencyEntity, String>` in `repository/relationship/` with the same two methods.
- No additional finders introduced this spec.

**`EntityMapper` extension**
- Bidirectional mapping for `LibraryEntity ↔ LibraryDto` and `CodeUnitDependencyEntity ↔ CodeUnitDependencyDto`: `toEntity(TDto, String modelFileId)` / `toDto(TEntity)`.
- `model_file_id` is set server-side from the supplied `modelFileId` argument — never read from the DTO.

**`MetaModelEntitiesDto` and `MetaModelRelationshipsDto` extension**
- Add 1 new list to `MetaModelEntitiesDto`: `libraries` with `@JsonProperty("libraries") List<LibraryDto>`, appended after `iac_sources` (the last spec-7 entity).
- Add 1 new list to `MetaModelRelationshipsDto`: `code_unit_dependencies` with `@JsonProperty("code_unit_dependencies") List<CodeUnitDependencyDto>`, appended after `iac_resource_bindings` (the last spec-7 relationship).
- Do not restructure existing fields. Lists default to empty (not null) on serialisation, matching existing convention.

**`ModelService` save / load / delete-and-replace integration**
- Inject `LibraryRepository` and `CodeUnitDependencyRepository`.
- Save order in `saveEntities(...)`: existing application-domain entities → `libraries` (immediately after `services`). Save order in `saveRelationships(...)`: existing relationships → `code_unit_dependencies` (last).
- Load order in `loadModelByFileId(...)`: append both new repos' `findByModelFileId(modelFileId)` calls in the same positions, populating `libraries` and `code_unit_dependencies` on the assembled DTOs.
- Delete order in `deleteAllDataForModelFile(...)`: `code_unit_dependencies` first, then existing relationships, then existing entities, then `libraries` last (reverse of save).
- Existing Business, Application, Data, Behavioural, UI, and Infrastructure domain save/load behaviour remains unchanged.

**`ArchitectureCloneService.IN_SCOPE_TABLES_IN_ORDER`**
- Block A (entities): insert `libraries` immediately after `services` (before `interfaces`). Rationale: `libraries.package_set_id → package_sets(id)` so `libraries` must be after `package_sets`; no other table depends on `libraries` so position is otherwise free.
- Block B (relationships): append `code_unit_dependencies` at the end.

**`ArchitectureElementInventoryService`**
- `TABLES_BY_DOMAIN.get("Applications")`: append `("libraries","Libraries")` and `("code_unit_dependencies","Code Unit Dependencies")` to the Applications domain entry list.
- `DISPLAY_NAME_FALLBACK_TABLES`: add `code_unit_dependencies` only (no `name` column). `libraries` has a `name` column and is **not** added here.

**3 Liquibase changesets `122-` through `124-`**
- Sequential `NNN-name.sql` files in `architecture-model-service/src/main/resources/db/changelog/sql/`, registered in `db.changelog-master.yaml` in order. Latest applied is `121-infrastructure-terraform-readiness-fields.sql`.
- Each changeSet uses `preConditions: onFail: MARK_RAN` with `not: tableExists` (122, 123) or matching idempotency for the CHECK swap (124). Never edit applied changesets (≤121).
- File order: 122 `122-libraries.sql` (creates `libraries` + perf index + tech-hints CHECK + `package_set_id` FK + `model_file_id` cascade FK), 123 `123-code-unit-dependencies.sql` (creates `code_unit_dependencies` + perf index + 2 ApplicationPoint FKs + `model_file_id` cascade FK), 124 `124-application-points-target-type-library.sql` (drops + recreates `chk_application_point_target_type`).
- 124 ordered last for clarity; the CHECK update is independent of 122/123 but unblocks `LIBRARY` ApplicationPoint rows that the new relationship references.

**Backend tests**
- One round-trip integration test class covering: save/load round-trip for a populated `MetaModelEntitiesDto` + `MetaModelRelationshipsDto` with **1 internal Library** (with `repo_location` + `repo_subfolder` set), **1 external Library** (without), **1 Service→Library** `code_unit_dependency`, and **1 Library→Library** `code_unit_dependency`.
- Delete-and-replace: save a populated model, call `saveModel(...)` again with a smaller payload, assert prior libraries and dependencies are gone.
- Polymorphic ApplicationPoint extension: assert that an `ApplicationPoint` with `target_type = 'LIBRARY'` is accepted at the DB layer; existing target types (`SERVICE`, `CLASS`, `METHOD`) continue to work unchanged.
- Per-`modelFileId` scoping: rows from a different `modelFileId` are not returned by `findByModelFileId`.
- Existing test suite must continue to pass with no modifications to existing tests.

## Visual Design
N/A — backend-only spec, no UI artefacts. Reference design is `ServiceEntity` + `services` table for the Library entity, and existing `ApplicationPoint`-typed relationships for the polymorphic relationship pattern.

## Existing Code to Leverage

**`ServiceEntity` and the `services` table**
- Authoritative blueprint for `LibraryEntity`. Copy `repo_location`, `repo_subfolder`, `core_tech`, the 5 tech-hints columns (with the `core_tech_resolution_confidence` CHECK lifted verbatim — lowercase 5-value list), and the `package_set_id` FK shape verbatim. Source: `architecture-model-service/src/main/java/.../model/entity/ServiceEntity.java` and changesets `014-service-core-tech.sql`, `017-package-sets.sql`, `080-service-repo-location-subfolder.sql`, `2026-04-20-tech-hints-resolved.sql`.
- The Service tech-hints CHECK is the only value-list CHECK introduced by this spec (verbatim copy, no edits).

**Infrastructure spec-7 6-column provenance block (changeset 120 family)**
- Authoritative blueprint for the 6 provenance columns on `libraries`. Copy column names, types, and nullability verbatim. Note: column is `last_verified_at`, not `last_scanned_at`.

**`ApplicationPointEntity` + `application_points` table + changeset 016**
- Existing supertype is fully reused for `code_unit_dependencies` source and target. The CHECK at line `chk_application_point_target_type` is the migration target for changeset 124 — drop and recreate to add `LIBRARY`.
- No new polymorphic supertype is introduced. Do **not** model after `DataEntityPointEntity` / `InfrastructurePointEntity` — those are typed-FK-per-target patterns; `ApplicationPoint` already covers Service/Class/Method/Library via its `target_type`/`target_ref_id` shape.

**DTO record + repository skeletons**
- Copy from `ServiceDto` for `LibraryDto` (entity DTO style with `@JsonProperty("snake_case")`); copy from `DataMovementDto` or any existing relationship DTO for `CodeUnitDependencyDto`.
- Copy `findByModelFileId` + `deleteByModelFileId` skeleton from any existing `*Repository` in `repository/entity/` and `repository/relationship/`.

**`ModelService.saveModel`, `loadModelByFileId`, `deleteAllDataForModelFile`**
- Per-domain repository invocation loops are the integration points. Add 1 new entity call (`libraries`) and 1 new relationship call (`code_unit_dependencies`) into the existing iteration order; do not restructure. Reverse-order delete already established by spec 7.

## Out of Scope
- Frontend TypeScript types, frontend tables, gridConfigs (Spec 2 of the Library arc).
- Discovery service deterministic resolvers, preflight modal, transitive walker, right-click menu items, progress UX (Spec 3 of the Library arc).
- Per-version Library rows — versions stay on the `code_unit_dependencies` edge (`declared_version`, `declared_version_range`).
- LLM tech-hints resolution wiring for Libraries — columns round-trip this spec, resolver wiring is Spec 3.
- Save-time LLM `core_tech` resolve hook on Library.
- DB-level enforcement of `target_application_point_id.target_type = 'LIBRARY'` (doc-only this spec).
- DB UNIQUE constraint on `(libraries.name, libraries.ecosystem)` (resolver-layer dedup in Spec 3).
- Gateway proxies, MCP tool surface, security/IAM modelling.
- Editing any applied Liquibase changeset (≤121) — only NEW changesets (`122-`, `123-`, `124-`).
