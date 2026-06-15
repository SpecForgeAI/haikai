# Task Breakdown: Library Backend Foundation

## Overview
Total Tasks: 4 task groups covering 3 Liquibase changesets, 2 new JPA entities, 2 new DTOs, 2 new repositories, EntityMapper extension, MetaModel DTO extensions, ModelService integration, ArchitectureCloneService + ArchitectureElementInventoryService updates, and 1 round-trip integration test class.

This is **Spec 1 of 3** in the Library arc — backend-only Spring Boot work in `architecture-model-service`. It introduces a `Library` entity (parallel to `Service`) and a `code_unit_dependencies` relationship that reuses the existing `ApplicationPoint` polymorphic supertype, plus a relaxed `application_points.target_type` CHECK to admit the new `LIBRARY` value.

This spec is backend-only — no frontend, gateway, MCP, or discovery changes. Visual assets are intentionally absent (Spec 2 of the arc covers the frontend; Spec 3 covers discovery).

### Locked Contract (do not deviate)
- All JSON property names are **snake_case** via `@JsonProperty("snake_case")` on every record component.
- `confidence` is `DECIMAL(4,3) NULL` with **no DB CHECK** and **no JPA validation** (range 0.0–1.0 doc-only).
- `core_tech_resolution_confidence` CHECK is lifted **verbatim** from `services` — lowercase 5-value list `('high','low','none','tech-only','manual-override')`.
- `description` and `tags` are **nullable** on both new tables (overrides raw idea).
- **No** DB UNIQUE on `(libraries.name, libraries.ecosystem)`.
- Doc-only (test-enforced) target-type rules on `code_unit_dependencies` — no triggers, no denorm columns, no extra DB CHECKs.
- **Only NEW changesets** (`122-`, `123-`, `124-`). **Never edit** applied changesets (≤121).
- **No** save-time LLM `core_tech` resolve hook on Library this spec (deferred to Spec 3).

### Carry-Forward Note (pre-existing broken tests)
There are approximately 108 pre-existing broken backend test files in `architecture-model-service/src/test/java/...`. **Do not** attempt to fix them as part of this spec. Use the staging workaround already established by recent backend specs: when running tests, scope the run to the new test classes added by this spec only (e.g. `mvn -Dtest=LibraryConstraintTest,...,LibraryDomainIntegrationTest test`). The acceptance bar is that the new tests pass and that the existing-suite failure list does not grow.

---

## Task List

### Database Layer

#### Task Group 1: Liquibase Migrations (Changesets 122–124)
**Dependencies:** None

- [x] 1.0 Author 3 sequential Liquibase changesets and register them in the master changelog
  - [x] 1.1 Write 2-4 focused tests for FK + CHECK constraint enforcement
    - Test that a `libraries` row with a `package_set_id` referencing a non-existent `package_sets(id)` is rejected (FK violation).
    - Test that a `libraries` row with `core_tech_resolution_confidence = 'HIGH'` (uppercase) is rejected and `'high'` (lowercase) is accepted (CHECK enforcement).
    - Test that a `code_unit_dependencies` row with a `source_application_point_id` or `target_application_point_id` referencing a non-existent `application_points(id)` is rejected (FK violation).
    - Test that an `application_points` row with `target_type = 'LIBRARY'` is accepted (positive case for the relaxed CHECK in changeset 124) and that an invalid value such as `'FOO'` is rejected (negative case).
    - **File:** `architecture-model-service/src/test/java/com/example/architecturemodel/repository/entity/LibraryConstraintTest.java`
    - Use the existing `@DataJpaTest` test slice; assert `DataIntegrityViolationException` / `ConstraintViolationException` propagation.
  - [x] 1.2 Create changeset `122-libraries.sql`
    - Standard envelope: `id TEXT PRIMARY KEY`, `model_file_id TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE`, `name TEXT NOT NULL`, `description TEXT NULL`, `tags TEXT NULL`, `valid_from TEXT NULL`, `valid_to TEXT NULL`. (No `created_at` / `updated_at`.)
    - Library-specific fields: `ecosystem TEXT NULL` (no CHECK — doc-only `MAVEN`/`NPM`/`PYPI`/`NUGET`/`GO`/`OTHER`), `repo_location TEXT NULL`, `repo_subfolder TEXT NULL`, `core_tech TEXT NULL`.
    - Tech-hints columns (5, mirror `services` verbatim): `core_tech_resolved JSONB NULL`, `core_tech_language_pack VARCHAR(100) NULL`, `core_tech_framework_packs JSONB NULL`, `core_tech_resolution_confidence VARCHAR(20) NULL` **with CHECK `(core_tech_resolution_confidence IS NULL OR core_tech_resolution_confidence IN ('high','low','none','tech-only','manual-override'))`** (lowercase, lifted verbatim from `services`), `core_tech_resolved_at TIMESTAMP WITH TIME ZONE NULL`.
    - Provenance columns (6, mirror Infrastructure spec-7 verbatim): `source_origin TEXT NULL`, `source_system TEXT NULL`, `source_reference TEXT NULL`, `generation_status TEXT NULL`, `generation_notes TEXT NULL`, `last_verified_at TIMESTAMP WITH TIME ZONE NULL`. (Column is `last_verified_at`, **not** `last_scanned_at`.)
    - Package set FK: `package_set_id TEXT NULL REFERENCES package_sets(id) ON DELETE SET NULL` (mirrors `services.package_set_id`).
    - Performance index: `CREATE INDEX idx_libraries_model_file ON libraries (model_file_id)`.
    - **No** DB UNIQUE on `(name, ecosystem)` — resolver-layer dedup in Spec 3.
    - `preConditions: onFail: MARK_RAN` + `not: tableExists tableName="libraries"` for idempotency.
    - **Reference:** copy column shapes verbatim from changesets `014-service-core-tech.sql`, `017-package-sets.sql` (or wherever `services.package_set_id` is added), `080-service-repo-location-subfolder.sql`, `2026-04-20-tech-hints-resolved.sql`, and the Infrastructure spec-7 provenance changeset (changeset 120 family).
    - **File:** `architecture-model-service/src/main/resources/db/changelog/sql/122-libraries.sql`
  - [x] 1.3 Create changeset `123-code-unit-dependencies.sql`
    - Columns: `id TEXT PRIMARY KEY`, `model_file_id TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE`.
    - Polymorphic endpoints (both default `NO ACTION`): `source_application_point_id TEXT NOT NULL REFERENCES application_points(id)`, `target_application_point_id TEXT NOT NULL REFERENCES application_points(id)`.
    - Declared coordinates: `declared_name TEXT NULL`, `declared_version TEXT NULL`, `declared_version_range TEXT NULL`.
    - `scope TEXT NULL` (no CHECK — doc-only Maven/npm values stored verbatim).
    - Manifest provenance: `manifest_path TEXT NULL`, `manifest_line INTEGER NULL`.
    - Edge metadata: `evidence_source TEXT NULL`, `confidence DECIMAL(4,3) NULL` (no CHECK).
    - `description TEXT NULL`, `tags TEXT NULL` (both nullable per codebase convention; overrides raw idea's NOT NULL).
    - Performance index: `CREATE INDEX idx_code_unit_dependencies_model_file ON code_unit_dependencies (model_file_id)`.
    - **No** DB trigger, **no** denormalised type column, **no** extra CHECK for the polymorphic target-type doc rule.
    - `preConditions: onFail: MARK_RAN` + `not: tableExists tableName="code_unit_dependencies"` for idempotency.
    - **File:** `architecture-model-service/src/main/resources/db/changelog/sql/123-code-unit-dependencies.sql`
  - [x] 1.4 Create changeset `124-application-points-target-type-library.sql` (**CAREFUL — drops + recreates an existing CHECK**)
    - **Step 1**: verify the existing CHECK constraint name. Open `architecture-model-service/src/main/resources/db/changelog/sql/016-application-point-targeting.sql` (or `016-application-points.sql` — whichever is the actual filename in the master changelog) and confirm the constraint name is `chk_application_point_target_type`. If the constraint name differs, use the **actual** name from changeset 016 verbatim. Do **not** assume.
    - **Step 2**: `ALTER TABLE application_points DROP CONSTRAINT chk_application_point_target_type`.
    - **Step 3**: `ALTER TABLE application_points ADD CONSTRAINT chk_application_point_target_type CHECK (target_type IS NULL OR target_type IN ('SERVICE','CLASS','METHOD','LIBRARY'))`.
    - Idempotency: `preConditions: onFail: MARK_RAN` with `sqlCheck` (or equivalent) verifying that the CHECK currently lacks `LIBRARY` — for example, an `EXISTS` query against `pg_constraint` / `information_schema.check_constraints` whose result-count condition guards re-application. If the existing-constraint detection is unreliable, fall back to a `MARK_RAN` `not: changeSetExecuted` style guard so the change is applied exactly once on each environment.
    - **No** Java code change required — `ApplicationPointEntity.targetType` is plain `String`, no enum class, no application-layer allowed-values list.
    - Existing rows are unaffected; existing target types continue to work unchanged.
    - **File:** `architecture-model-service/src/main/resources/db/changelog/sql/124-application-points-target-type-library.sql`
  - [x] 1.5 Register all 3 changesets in `db.changelog-master.yaml`
    - Append entries `122-libraries.sql`, `123-code-unit-dependencies.sql`, `124-application-points-target-type-library.sql` in numeric order, after the existing `121-infrastructure-terraform-readiness-fields.sql` reference.
    - **File:** `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml`
    - **Critical:** never edit applied changesets (≤121); only add new lines.
  - [x] 1.6 Verify Java compiles + targeted tests pass
    - Run `mvn -pl architecture-model-service compile` to confirm no compilation regression (no Java changes yet, but Liquibase YAML must parse).
    - Run ONLY the 2-4 tests written in 1.1 plus a manual `mvn liquibase:update` against a fresh DB.
    - Verify all 3 changesets apply cleanly with no errors and that the relaxed CHECK accepts `LIBRARY`.
    - Do NOT run the entire test suite at this stage.

**Acceptance Criteria:**
- The 2-4 tests written in 1.1 pass.
- All 3 changesets apply idempotently against a fresh DB.
- `libraries.core_tech_resolution_confidence` CHECK rejects values outside the lowercase 5-value list.
- `code_unit_dependencies` rejects rows referencing non-existent `application_points(id)`.
- `application_points.target_type = 'LIBRARY'` is accepted; `'SERVICE'`, `'CLASS'`, `'METHOD'`, NULL continue to be accepted; an invalid value such as `'FOO'` is rejected.
- The constraint name in changeset 124 matches the name actually defined in changeset 016 verbatim.
- No applied changeset (≤121) was modified.

---

### Persistence Layer

#### Task Group 2: JPA Entity Classes (`LibraryEntity`, `CodeUnitDependencyEntity`)
**Dependencies:** Task Group 1

- [x] 2.0 Create 2 JPA entity classes
  - [x] 2.1 Write 2-4 focused tests for entity field mapping
    - Test `LibraryEntity` round-trips through JPA with the standard envelope, `repo_location` + `repo_subfolder` populated (internal library), the 5 tech-hints columns, the 6 provenance columns, and `package_set_id` set.
    - Test `LibraryEntity` round-trips with `repo_location` and `repo_subfolder` both NULL (external library) and `core_tech_resolved` JSONB string blob round-trips intact.
    - Test `CodeUnitDependencyEntity` round-trips with all declared coordinate fields, `confidence` as a `BigDecimal` with scale 3 (e.g. `0.875`), and both `source_application_point_id` and `target_application_point_id` set.
    - **File:** `architecture-model-service/src/test/java/com/example/architecturemodel/model/entity/LibraryEntityMappingTest.java`
  - [x] 2.2 Create `LibraryEntity` in `model/entity/`
    - Annotations: `@Entity`, `@Table(name = "libraries")`, `@Getter`, `@Setter`, `@NoArgsConstructor`, `@AllArgsConstructor`, `@Builder`.
    - All fields use `@Column(name = "snake_case")`; ID is `String`; booleans (none in this entity) would be boxed `Boolean`.
    - JSONB columns (`core_tech_resolved`, `core_tech_framework_packs`) mapped per the existing `ServiceEntity` convention — copy the annotation pattern verbatim (`@JdbcTypeCode(SqlTypes.JSON)` or whichever Hibernate type pattern `ServiceEntity` uses; do **not** invent a new pattern).
    - `model_file_id` mapped as a plain `String` column (not a JPA association), matching every existing entity.
    - Mirror `ServiceEntity` field-for-field for the shared columns; add the 6 provenance fields after the tech-hints block.
    - **Reference:** `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/ServiceEntity.java`.
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/LibraryEntity.java`
  - [x] 2.3 Create `CodeUnitDependencyEntity` in `model/entity/`
    - Annotations: same Lombok + JPA stack as `DataMovementEntity`.
    - Fields: `id`, `modelFileId`, `sourceApplicationPointId`, `targetApplicationPointId`, `declaredName`, `declaredVersion`, `declaredVersionRange`, `scope`, `manifestPath`, `manifestLine` (`Integer`), `evidenceSource`, `confidence` (`BigDecimal`), `description`, `tags`.
    - All `@Column(name = "snake_case")`.
    - `model_file_id` is a plain `String` column (not a JPA association).
    - **Reference:** `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/DataMovementEntity.java`.
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/CodeUnitDependencyEntity.java`
  - [x] 2.4 Verify Java compiles + targeted tests pass
    - Run `mvn -pl architecture-model-service compile`.
    - Run ONLY the 2-4 tests written in 2.1.
    - Do NOT run the entire test suite at this stage.

**Acceptance Criteria:**
- The 2-4 tests written in 2.1 pass.
- `LibraryEntity` mirrors `ServiceEntity` style (same Lombok stack, same JSONB annotation pattern, same naming convention).
- `CodeUnitDependencyEntity` mirrors `DataMovementEntity` style.
- Both entities compile and persist via Hibernate against the schema from Task Group 1.
- `confidence` is `BigDecimal` and round-trips with scale 3 intact.

---

### DTO + Repository Layer

#### Task Group 3: DTO Records and Repositories
**Dependencies:** Task Group 2

- [x] 3.0 Create 2 DTO records and 2 repositories
  - [x] 3.1 Write 2-4 focused tests for DTO serialisation and repository scoping
    - Test `LibraryDto` round-trips through Jackson with snake_case JSON property names (e.g. `repo_location`, `core_tech_resolution_confidence`, `last_verified_at`, `package_set_id`).
    - Test `LibraryDto` JSON does **not** include `model_file_id` (server-side only).
    - Test `LibraryRepository.findByModelFileId(modelFileId)` returns only rows for that model file (no cross-`modelFileId` leakage).
    - Test `CodeUnitDependencyRepository.deleteByModelFileId(modelFileId)` removes only the matching rows and `confidence` (`BigDecimal`) round-trips intact.
    - **File:** `architecture-model-service/src/test/java/com/example/architecturemodel/model/dto/LibraryDtoAndRepositoryTest.java`
  - [x] 3.2 Create `LibraryDto` in `model/dto/entity/`
    - Java record. Components are: `id`, `name`, `description`, `tags`, `valid_from`, `valid_to`, `ecosystem`, `repo_location`, `repo_subfolder`, `core_tech`, `core_tech_resolved`, `core_tech_language_pack`, `core_tech_framework_packs`, `core_tech_resolution_confidence`, `core_tech_resolved_at`, `source_origin`, `source_system`, `source_reference`, `generation_status`, `generation_notes`, `last_verified_at`, `package_set_id`.
    - Every field has `@JsonProperty("snake_case")`.
    - **Do not** include `model_file_id` (server-side only).
    - JSONB fields are typed as `String` (raw JSON) or whatever shape `ServiceDto` uses — copy `ServiceDto` verbatim for the tech-hints fields.
    - **Reference:** `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/ServiceDto.java`.
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/LibraryDto.java`
  - [x] 3.3 Create `CodeUnitDependencyDto` in `model/dto/relationship/`
    - Java record. Components are: `id`, `source_application_point_id`, `target_application_point_id`, `declared_name`, `declared_version`, `declared_version_range`, `scope`, `manifest_path`, `manifest_line` (`Integer`), `evidence_source`, `confidence` (`BigDecimal`), `description`, `tags`.
    - Every field has `@JsonProperty("snake_case")`.
    - **Do not** include `model_file_id`.
    - **Reference:** `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/relationship/DataMovementDto.java`.
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/relationship/CodeUnitDependencyDto.java`
  - [x] 3.4 Create `LibraryRepository` in `repository/entity/`
    - `@Repository` annotated interface extending `JpaRepository<LibraryEntity, String>`.
    - Methods: `List<LibraryEntity> findByModelFileId(String modelFileId)`, `void deleteByModelFileId(String modelFileId)`.
    - **Reference:** any existing `*Repository` in `repository/entity/` (e.g. `ServiceRepository`).
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/LibraryRepository.java`
  - [x] 3.5 Create `CodeUnitDependencyRepository` in `repository/relationship/`
    - `@Repository` annotated interface extending `JpaRepository<CodeUnitDependencyEntity, String>`.
    - Methods: `List<CodeUnitDependencyEntity> findByModelFileId(String modelFileId)`, `void deleteByModelFileId(String modelFileId)`.
    - **Reference:** any existing `*Repository` in `repository/relationship/` (e.g. `DataMovementRepository`).
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/repository/relationship/CodeUnitDependencyRepository.java`
  - [x] 3.6 Verify Java compiles + targeted tests pass
    - Run `mvn -pl architecture-model-service compile`.
    - Run ONLY the 2-4 tests written in 3.1.
    - Do NOT run the entire test suite at this stage.

**Acceptance Criteria:**
- The 2-4 tests written in 3.1 pass.
- Both DTOs are Java records with `@JsonProperty("snake_case")` on every component.
- Neither DTO exposes `model_file_id`.
- `LibraryDto` field set + JSON names mirror `ServiceDto` for shared fields and add the 6 provenance fields verbatim.
- Both repositories provide `findByModelFileId` and `deleteByModelFileId`.
- Scoping is correctly enforced (no cross-model-file leakage).

---

### Mapping, Service, and Integration Layer

#### Task Group 4: EntityMapper, MetaModel DTOs, ModelService, Clone, Inventory, Integration Test
**Dependencies:** Task Groups 1, 2, 3

- [x] 4.0 Wire the new entities and DTOs through every integration point and verify with one end-to-end integration test
  - [x] 4.1 Write the round-trip integration test class (2-8 tests, focused)
    - Single integration test class covering all critical end-to-end behaviours for this spec.
    - **Test 1 — round-trip with both library variants and both edge variants**: build a `MetaModelEntitiesDto` + `MetaModelRelationshipsDto` populated with: 1 internal Library (with `repo_location` + `repo_subfolder` set, `package_set_id` set, all 5 tech-hints columns set, all 6 provenance columns set), 1 external Library (without `repo_location` / `repo_subfolder`), 1 `code_unit_dependencies` Service→Library edge, 1 `code_unit_dependencies` Library→Library edge. Call `ModelService.saveModel(...)`, then `ModelService.loadModelByFileId(...)`, deep-equal assert on every field of both libraries and both dependencies.
    - **Test 2 — `application_points.target_type = 'LIBRARY'` is accepted (positive case)**: insert an `ApplicationPoint` row with `target_type = 'LIBRARY'` directly via the JPA layer; assert it persists without `DataIntegrityViolationException`.
    - **Test 3 — invalid `target_type` is rejected (negative case)**: insert an `ApplicationPoint` row with `target_type = 'FOO'` directly via the JPA layer; assert that a `DataIntegrityViolationException` (or `ConstraintViolationException`) is thrown by the relaxed CHECK from changeset 124.
    - **Test 4 — existing target types continue to work unchanged**: insert `ApplicationPoint` rows with `target_type IN ('SERVICE','CLASS','METHOD')` and NULL; assert all four persist without error.
    - **Test 5 — delete-and-replace**: save a populated model (libraries + dependencies present), then call `ModelService.saveModel(...)` again with a smaller `MetaModelEntitiesDto`/`MetaModelRelationshipsDto` (libraries and dependencies empty); assert via `LibraryRepository.findByModelFileId` and `CodeUnitDependencyRepository.findByModelFileId` that all prior libraries and dependencies are gone for that `modelFileId`.
    - **Test 6 — per-`modelFileId` scoping**: save two models with different `modelFileId` values, each containing distinct libraries and dependencies; assert `findByModelFileId` for each `modelFileId` returns only that model's rows (no cross-leakage).
    - **File:** `architecture-model-service/src/test/java/com/example/architecturemodel/integration/LibraryDomainIntegrationTest.java`
    - Use the existing integration-test slice convention (Spring Boot test with the test profile pointing at the migrated DB).
  - [x] 4.2 Extend `EntityMapper` with bidirectional mappings for both new types
    - Add `LibraryEntity toEntity(LibraryDto dto, String modelFileId)` — populates `modelFileId` from the parameter (never read from the DTO); copies every other field one-to-one.
    - Add `LibraryDto toDto(LibraryEntity entity)` — strips `modelFileId`; copies every other field one-to-one.
    - Add `CodeUnitDependencyEntity toEntity(CodeUnitDependencyDto dto, String modelFileId)` and `CodeUnitDependencyDto toDto(CodeUnitDependencyEntity entity)`.
    - Preserve `BigDecimal confidence` exactly (no scale truncation).
    - If existing relationship mapping is conventionally inline in `ModelService` rather than in `EntityMapper`, follow that precedent (e.g. follow whatever `DataMovementEntity` ↔ `DataMovementDto` does).
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/mapper/EntityMapper.java` (or inline in `ModelService` per existing convention)
  - [x] 4.3 Extend `MetaModelEntitiesDto` and `MetaModelRelationshipsDto`
    - Add `List<LibraryDto> libraries` to `MetaModelEntitiesDto` with `@JsonProperty("libraries")`, **appended after `iac_sources`** (the last spec-7 entity field). Default to empty list (not null) on serialisation, matching existing convention.
    - Add `List<CodeUnitDependencyDto> code_unit_dependencies` to `MetaModelRelationshipsDto` with `@JsonProperty("code_unit_dependencies")`, **appended after `iac_resource_bindings`** (the last spec-7 relationship field). Default to empty list.
    - **Do not** restructure any existing fields. Existing Business / Application / Data / Behavioural / UI / Infrastructure JSON shapes must remain unchanged (regression-safe).
    - **Files:**
      - `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/MetaModelEntitiesDto.java`
      - `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/MetaModelRelationshipsDto.java`
  - [x] 4.4 Extend `ModelService` save / load / delete-and-replace integration
    - Inject `LibraryRepository` and `CodeUnitDependencyRepository` via constructor (matching existing style).
    - In `saveEntities(...)`: invoke `libraryRepository.saveAll(...)` **immediately after the existing `services` save call** (no other ordering constraint).
    - In `saveRelationships(...)`: invoke `codeUnitDependencyRepository.saveAll(...)` **last** (after every existing relationship save).
    - In `loadModelByFileId(...)`: append `libraryRepository.findByModelFileId(modelFileId)` (mapped to DTOs and assigned to `entitiesDto.libraries`) immediately after the existing services load. Append `codeUnitDependencyRepository.findByModelFileId(modelFileId)` (mapped to DTOs and assigned to `relationshipsDto.code_unit_dependencies`) last.
    - In `deleteAllDataForModelFile(...)`: delete order is **reverse of save** — `codeUnitDependencyRepository.deleteByModelFileId(...)` **first** (before existing relationships), then existing relationships, then existing entities, then `libraryRepository.deleteByModelFileId(...)` **last**.
    - **Do not** modify any existing per-domain repo invocations. New code is additive only.
    - **Important:** do **not** add a save-time LLM `core_tech` resolve hook on Library this spec — the tech-hints columns round-trip raw values only; resolver wiring is Spec 3.
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/service/ModelService.java`
  - [x] 4.5 Extend `ArchitectureCloneService.IN_SCOPE_TABLES_IN_ORDER`
    - Block A (entities): insert `"libraries"` immediately **after `"services"`** (before `"interfaces"`). Rationale: `libraries.package_set_id → package_sets(id)` so `libraries` must be after `package_sets`; no other table depends on `libraries`, so the position is otherwise free.
    - Block B (relationships): append `"code_unit_dependencies"` **at the end**.
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/service/ArchitectureCloneService.java`
  - [x] 4.6 Extend `ArchitectureElementInventoryService`
    - `TABLES_BY_DOMAIN.get("Applications")`: append `("libraries","Libraries")` and `("code_unit_dependencies","Code Unit Dependencies")` to the existing Applications-domain entry list.
    - `DISPLAY_NAME_FALLBACK_TABLES`: add `"code_unit_dependencies"` only (relationship has no `name` column). **Do not** add `"libraries"` — it has a `name` column and uses the standard display path.
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/service/ArchitectureElementInventoryService.java`
  - [x] 4.7 Verify Java compiles + targeted tests pass
    - Run `mvn -pl architecture-model-service compile` to confirm all wiring compiles.
    - Run ONLY the tests added by Task Groups 1-4 (the test classes from 1.1, 2.1, 3.1, and 4.1). Use the staging workaround: scope the run with `-Dtest=LibraryConstraintTest,LibraryEntityMappingTest,LibraryDtoAndRepositoryTest,LibraryDomainIntegrationTest`.
    - Expected total: approximately 12-22 tests (2-4 per task group across groups 1-3, plus 4-6 in the integration test class).
    - **Do NOT** run the entire backend test suite — there are ~108 pre-existing broken tests that this spec must not be blocked by.
    - Verify the existing pre-existing-failure list does not grow: the only failures expected are the carry-forward set already known before this spec started.

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 12-22 tests total).
- `EntityMapper` (or its equivalent) round-trips `LibraryDto ↔ LibraryEntity` and `CodeUnitDependencyDto ↔ CodeUnitDependencyEntity` with no field loss; `model_file_id` is set server-side and never read from the DTO.
- `MetaModelEntitiesDto.libraries` is appended after `iac_sources`; `MetaModelRelationshipsDto.code_unit_dependencies` is appended after `iac_resource_bindings`. Both default to empty list. Existing fields are unchanged in shape and order.
- `ModelService` save / load / delete-and-replace correctly handles the new entity and relationship in the documented order; existing domain behaviour is regression-safe.
- `ArchitectureCloneService.IN_SCOPE_TABLES_IN_ORDER` Block A includes `"libraries"` after `"services"` and Block B ends with `"code_unit_dependencies"`.
- `ArchitectureElementInventoryService` Applications-domain entry includes both new tables; `DISPLAY_NAME_FALLBACK_TABLES` includes `"code_unit_dependencies"` only.
- Integration test verifies all four locked end-to-end behaviours: internal+external library round-trip, Service→Library + Library→Library polymorphic edges, `target_type='LIBRARY'` accepted (positive) **and** an invalid value rejected (negative), delete-and-replace, per-`modelFileId` scoping.
- Existing Business / Application / Data / Behavioural / UI / Infrastructure domain behaviour is regression-safe (no edits to existing per-domain calls; the carry-forward broken-test list does not grow).

---

## Execution Order

Recommended implementation sequence (strictly sequential — each group depends on the previous):

1. **Task Group 1: Liquibase Migrations (122–124)**
   - Lands the schema first; everything else depends on the tables existing and the relaxed `application_points.target_type` CHECK being in place.
   - **Special care on changeset 124**: verify the existing constraint name in changeset 016 verbatim before writing the DROP statement.

2. **Task Group 2: JPA Entity Classes**
   - Maps the schema into Java; required by repositories and mappers.

3. **Task Group 3: DTO Records and Repositories**
   - Together because the DTO + repository pair is a single shared-style increment per entity, and both are unblocked by Task Group 2.

4. **Task Group 4: EntityMapper, MetaModel DTOs, ModelService, Clone, Inventory, Integration Test**
   - Final wiring increment — everything from mapper through inventory plus the round-trip integration test that exercises the whole pipeline. Closes out the spec.

---

## File Summary

### Liquibase Files to Create (3)
- `architecture-model-service/src/main/resources/db/changelog/sql/122-libraries.sql`
- `architecture-model-service/src/main/resources/db/changelog/sql/123-code-unit-dependencies.sql`
- `architecture-model-service/src/main/resources/db/changelog/sql/124-application-points-target-type-library.sql`

### JPA Entity Files to Create (2)
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/LibraryEntity.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/CodeUnitDependencyEntity.java`

### DTO Files to Create (2)
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/LibraryDto.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/relationship/CodeUnitDependencyDto.java`

### Repository Files to Create (2)
- `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/LibraryRepository.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/repository/relationship/CodeUnitDependencyRepository.java`

### Files to Modify (5)
- `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml` (register 3 new changesets)
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/MetaModelEntitiesDto.java` (append `libraries` list)
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/MetaModelRelationshipsDto.java` (append `code_unit_dependencies` list)
- `architecture-model-service/src/main/java/com/example/architecturemodel/mapper/EntityMapper.java` (or follow existing relationship-mapping convention) — bidirectional mapping for both new types
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/ModelService.java` (inject 2 repos, extend save / load / delete in documented order)
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/ArchitectureCloneService.java` (`IN_SCOPE_TABLES_IN_ORDER` Block A insert + Block B append)
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/ArchitectureElementInventoryService.java` (`TABLES_BY_DOMAIN.Applications` += 2 entries; `DISPLAY_NAME_FALLBACK_TABLES` += `code_unit_dependencies`)

### Test Files to Create (4)
- `architecture-model-service/src/test/java/com/example/architecturemodel/repository/entity/LibraryConstraintTest.java`
- `architecture-model-service/src/test/java/com/example/architecturemodel/model/entity/LibraryEntityMappingTest.java`
- `architecture-model-service/src/test/java/com/example/architecturemodel/model/dto/LibraryDtoAndRepositoryTest.java`
- `architecture-model-service/src/test/java/com/example/architecturemodel/integration/LibraryDomainIntegrationTest.java`

---

## Reference Patterns

### Existing Code to Follow
- **`LibraryEntity` blueprint (authoritative):**
  - `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/ServiceEntity.java`
  - Liquibase changesets: `014-service-core-tech.sql`, `017-package-sets.sql` (or wherever `services.package_set_id` is added), `080-service-repo-location-subfolder.sql`, `2026-04-20-tech-hints-resolved.sql`.
- **6-column provenance block (authoritative):**
  - Infrastructure spec-7 changeset 120 family — copy column names, types, and nullability verbatim. The column is `last_verified_at`, **not** `last_scanned_at`.
- **`CodeUnitDependencyEntity` blueprint:**
  - `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/DataMovementEntity.java`
- **DTO record + `@JsonProperty("snake_case")` style:**
  - `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/ServiceDto.java` (for `LibraryDto`)
  - `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/relationship/DataMovementDto.java` (for `CodeUnitDependencyDto`)
- **Repository skeleton (`findByModelFileId`, `deleteByModelFileId`):**
  - any existing file in `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/` or `repository/relationship/`.
- **`application_points` relaxed CHECK source of truth:**
  - `architecture-model-service/src/main/resources/db/changelog/sql/016-application-point-targeting.sql` (or whichever filename in the master changelog) — verify the constraint name `chk_application_point_target_type` verbatim before writing changeset 124.
- **`ModelService` integration points:**
  - `architecture-model-service/src/main/java/com/example/architecturemodel/service/ModelService.java` — methods `saveModel`, `loadModelByFileId`, `deleteAllDataForModelFile`, `saveEntities`, `saveRelationships`.
- **`ArchitectureCloneService` integration:**
  - `architecture-model-service/src/main/java/com/example/architecturemodel/service/ArchitectureCloneService.java` — `IN_SCOPE_TABLES_IN_ORDER` Block A (entities) and Block B (relationships).
- **`ArchitectureElementInventoryService` integration:**
  - `architecture-model-service/src/main/java/com/example/architecturemodel/service/ArchitectureElementInventoryService.java` — `TABLES_BY_DOMAIN`, `DISPLAY_NAME_FALLBACK_TABLES`.
- **Liquibase master changelog:**
  - `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml` — latest applied: `121-infrastructure-terraform-readiness-fields.sql`. Append new entries `122-`, `123-`, `124-`; never edit applied changesets.

### Key Decisions to Honour (Locked Contract)
- **Snake_case JSON** on every DTO field via `@JsonProperty("snake_case")`.
- **`confidence DECIMAL(4,3) NULL`** — no DB CHECK, no JPA validation; range guidance is doc-only.
- **`core_tech_resolution_confidence` CHECK** — lifted **verbatim** from `services`: lowercase 5-value list `('high','low','none','tech-only','manual-override')` plus NULL. This is the only value-list CHECK introduced by this spec.
- **`description` and `tags` are nullable** on both new tables (overrides raw idea's NOT NULL — matches codebase convention).
- **No DB UNIQUE on `(libraries.name, libraries.ecosystem)`** — resolver-layer dedup in Spec 3.
- **Doc-only target-type rules** on `code_unit_dependencies` — no triggers, no denormalised columns, no extra CHECKs. Integration test enforces.
- **Only NEW changesets** (`122-`, `123-`, `124-`). Never edit applied changesets (≤121).
- **Changeset 124 is CAREFUL** — DROPs the existing `chk_application_point_target_type` and ADDs a new one with the wider value list. Verify the constraint name matches what is in `016-application-point-targeting.sql` verbatim before writing the DROP.
- **No save-time LLM `core_tech` resolve hook** on Library this spec. The tech-hints columns round-trip raw values only; resolver wiring is Spec 3.
- **`last_verified_at`**, not `last_scanned_at` — the provenance column name is `last_verified_at` per Infrastructure spec-7.
- **`MetaModel*Dto` extension is additive** — append `libraries` after `iac_sources`, append `code_unit_dependencies` after `iac_resource_bindings`. Never restructure existing fields.
- **Carry-forward**: do not run the full backend test suite. Scope test runs to the new test classes only; the acceptance bar is that the new tests pass and the carry-forward broken-test list does not grow.
