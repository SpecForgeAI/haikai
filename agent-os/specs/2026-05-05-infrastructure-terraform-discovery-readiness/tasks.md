# Task Breakdown: Infrastructure Terraform & Discovery Readiness

## Overview
Total Tasks: 7 task groups covering 4 Liquibase changesets (118-121), 2 new JPA entities (1 entity-shaped + 1 relationship-shaped), 11 new field-additions per 12 existing Infrastructure entity classes (6 provenance + 5 readiness), 6 new field-additions per 3 existing Infra-internal relationship entity classes, 2 new DTO records + 15 existing-DTO field-extensions, 2 new repositories, EntityMapper extensions, MetaModelEntitiesDto + MetaModelRelationshipsDto extensions, ModelService save/load/delete-and-replace integration, ArchitectureCloneService Block A/B append, ArchitectureElementInventoryService extension, frontend types/grids/serialisation wiring (NO diagram or inspector wiring), and 1 frontend Vitest config test.

This is **spec 7 of 7** in the Infrastructure delivery sequence and the finale of the V1 Infrastructure work. Full-stack but **trimmed**: backend is comprehensive (4 changesets across 17 tables, 2 new + 15 extended entity classes, 2 new + 15 extended DTOs, full ModelService wiring); frontend is **tables-only** (2 new grid configs, 6 new picklists, 2 backfill lines) with **NO** diagram palette work, **NO** new InspectorPanel arms, **NO** Gateway/MCP/Discovery code.

**Locked contract from prior specs (do not violate):**
- All locked decisions from specs 1-6 apply.
- Liquibase: changesets `118-` through `121-` only — never edit any applied changeset (per `feedback_liquibase_immutable_changesets.md`).
- Snake_case names everywhere (DB columns, DTO `@JsonProperty`, TypeScript field names, grid `field` keys).
- `confidence DECIMAL(4,3) NULL` with no DB CHECK on `iac_resource_bindings`.
- `description TEXT NOT NULL`, `tags TEXT NOT NULL` on the 2 new tables (`iac_sources`, `iac_resource_bindings`).
- 6 provenance fields on existing tables are all nullable `TEXT`; 5 readiness fields on existing entity tables include nullable `BOOLEAN terraform_ready` + 4 nullable `TEXT`. `terraform_variable_hints` is `TEXT` (raw JSON string), NOT `JSONB`.
- Reuse existing `infrastructure_point_picker` cellType from spec 4 — NO new cellType. NO `allowedKinds` restriction on `iac_resource_bindings.infrastructure_point_id`.
- Separate `iacSourceProviderOptions` array (includes `MULTI`) — do NOT extend or modify existing spec-4 `providerOptions`.
- NO new diagram palette sections, NO node shape, NO edge type, NO `RELATIONSHIP_EDGE_TYPES` entry, NO `relationshipUtils.ts` arm, NO `rendering.ts` arm, NO `SelectionInspector.tsx` arm for `iac_resource_bindings`.
- NO per-entity provenance/readiness grid columns added to the existing 12 Infra entity gridConfigs (Q4 trim).
- NO per-relationship provenance grid columns added to the existing 3 Infra-internal relationship gridConfigs (Q4 trim).
- NO Gateway / MCP / Discovery code changes (Q7) — `spec.md` future-contract section is narrative only.

**Carry-forward test-failure context (do not investigate during this spec):**
- Pre-existing failures listed in project memory remain.
- ~108 broken backend test files plus ~9 broken `ModelService*Test` files from spec 1 still need the broken-tests staging workaround when running targeted backend tests (move out, run targeted tests, move back).

**Implementer note — Group 2 is the heaviest:** adding 11 fields to 12 existing entity classes + 6 fields to 3 relationship entity classes is mechanical but extensive (192 net new field declarations across 15 files). Plan accordingly.

---

## Task List

### Backend — Database Layer

#### Task Group 1: Liquibase Migrations (Changesets 118-121)
**Dependencies:** None

- [x] 1.0 Author 4 sequential Liquibase changesets and register them in the master changelog
  - [x] 1.1 Write 1 focused `@DataJpaTest` for FK + envelope constraints on the 2 new tables
    - One test asserting that:
      - inserting `iac_resource_bindings` with a non-existent `iac_source_id` raises `DataIntegrityViolationException`;
      - inserting `iac_resource_bindings` with a non-existent `infrastructure_point_id` raises `DataIntegrityViolationException`;
      - inserting `iac_sources` with `description` NULL or `tags` NULL raises `DataIntegrityViolationException`;
      - inserting `iac_resource_bindings` with `description` NULL or `tags` NULL raises `DataIntegrityViolationException`.
    - Bundle into a single test method (or 2-4 tightly grouped methods). Total tests in this file: 1-4 max.
    - **File:** `architecture-model-service/src/test/java/com/example/architecturemodel/repository/entity/InfrastructureTerraformReadinessFkConstraintTest.java`
    - Use the `@DataJpaTest` slice.
  - [x] 1.2 Create changeset `118-iac-sources.sql`
    - Columns: `id TEXT PK`, `model_file_id TEXT NOT NULL → model_files(id) ON DELETE CASCADE`, `name TEXT NOT NULL`, `description TEXT NOT NULL`, `tags TEXT NOT NULL`, `valid_from TEXT NULL`, `valid_to TEXT NULL`, `environment_id TEXT NULL → environments(id)`, `source_type TEXT NULL`, `repository_url TEXT NULL`, `repository_provider TEXT NULL`, `branch TEXT NULL`, `commit_sha TEXT NULL`, `path TEXT NULL`, `workspace TEXT NULL`, `module_name TEXT NULL`, `module_path TEXT NULL`, `provider TEXT NULL`, `owner TEXT NULL`, `last_scanned_at TEXT NULL`, `last_imported_at TEXT NULL`.
    - Index: `idx_iac_sources_model_file ON (model_file_id)`.
    - `preConditions: onFail: MARK_RAN` + `not: tableExists` for idempotency.
    - **File:** `architecture-model-service/src/main/resources/db/changelog/sql/118-iac-sources.sql`
    - **Reference:** spec 1's `EnvironmentEntity` table changeset for envelope (`id`/`model_file_id`/`name`/`description`/`tags`/`valid_from`/`valid_to`); spec 6's `114-application-compute-deployments.sql` for current changeset shape.
  - [x] 1.3 Create changeset `119-iac-resource-bindings.sql`
    - Columns: `id TEXT PK`, `model_file_id TEXT NOT NULL → model_files(id) ON DELETE CASCADE`, `iac_source_id TEXT NOT NULL → iac_sources(id)`, `infrastructure_point_id TEXT NOT NULL → infrastructure_points(id)`, `environment_id TEXT NULL → environments(id)`, `iac_address TEXT NULL`, `iac_resource_type TEXT NULL`, `iac_resource_name TEXT NULL`, `provider TEXT NULL`, `file_path TEXT NULL`, `start_line INTEGER NULL`, `end_line INTEGER NULL`, `state_resource_id TEXT NULL`, `external_id TEXT NULL`, `binding_status TEXT NULL`, `confidence DECIMAL(4,3) NULL` (no DB CHECK), `last_seen_at TEXT NULL`, `description TEXT NOT NULL`, `tags TEXT NOT NULL`.
    - **No `name` column** (relationship envelope).
    - Index: `idx_iac_resource_bindings_model_file ON (model_file_id)`.
    - `preConditions: onFail: MARK_RAN` + `not: tableExists`.
    - **File:** `architecture-model-service/src/main/resources/db/changelog/sql/119-iac-resource-bindings.sql`
    - **Reference:** spec 6's `114-application-compute-deployments.sql` for relationship envelope (no `name`, `confidence DECIMAL(4,3)`); spec 1's spec-4 polymorphic-target via `infrastructure_point_id`.
  - [x] 1.4 Create changeset `120-infrastructure-provenance-fields.sql`
    - For each of 15 tables, append 6 nullable columns: `source_origin TEXT`, `source_system TEXT`, `source_reference TEXT`, `generation_status TEXT`, `generation_notes TEXT`, `last_verified_at TEXT`.
    - 12 entity tables: `environments`, `cloud_accounts`, `locations`, `networks`, `subnets`, `compute_clusters`, `compute_resources`, `deployment_units`, `load_balancers`, `listeners`, `data_store_instances`, `infrastructure_resources`.
    - 3 Infra-internal relationship tables: `resource_subnet_hostings`, `deployment_unit_compute_resources`, `load_balancer_resource_routes`.
    - 4 spec-6 cross-domain relationship tables (`application_compute_deployments`, `data_entity_data_store_hostings`, `application_infrastructure_resource_uses`, `application_load_balancer_exposures`) are **NOT** extended (per Q2).
    - Use `preConditions: onFail: MARK_RAN` + `not: columnExists` per `ALTER TABLE ADD COLUMN` for idempotency. Group changes into multiple `<changeSet>` blocks within the file (one per table, or one per group), matching repo convention.
    - **File:** `architecture-model-service/src/main/resources/db/changelog/sql/120-infrastructure-provenance-fields.sql`
  - [x] 1.5 Create changeset `121-infrastructure-terraform-readiness-fields.sql`
    - For each of 12 entity tables ONLY (not the 3 Infra-internal relationship tables), append 5 nullable columns: `terraform_ready BOOLEAN`, `terraform_module_hint TEXT`, `terraform_resource_hint TEXT`, `terraform_variable_hints TEXT` (raw JSON string, **not** JSONB), `terraform_notes TEXT`.
    - Same 12 tables as Group 1.4 (entity tables only — relationships excluded per Q2).
    - Use `preConditions: onFail: MARK_RAN` + `not: columnExists` per `ALTER TABLE ADD COLUMN` for idempotency.
    - **File:** `architecture-model-service/src/main/resources/db/changelog/sql/121-infrastructure-terraform-readiness-fields.sql`
  - [x] 1.6 Register all 4 changesets in `db.changelog-master.yaml`
    - Append entries `118-` through `121-` in numeric order, after the existing `117-application-load-balancer-exposures.sql` reference.
    - **File:** `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml`
    - **Critical:** never edit applied changesets (≤ 117); only add new lines.
  - [x] 1.7 Verify Java compiles + targeted tests pass
    - Apply broken-tests staging workaround (move ~108 broken backend test files plus ~9 broken `ModelService*Test` files temporarily out of `src/test/java`) before running.
    - Run `mvn liquibase:update` against a fresh DB and verify all 4 changesets apply cleanly.
    - Run ONLY the test from 1.1.
    - Restore the broken test files.
    - Do NOT run the entire backend test suite.

**Acceptance Criteria:**
- The 1-4 tests written in 1.1 pass.
- All 4 changesets apply idempotently against a fresh DB.
- `iac_sources` has `name`/`description`/`tags` NOT NULL; standard envelope present; FK to `environments(id)` enforced; FK to `model_files(id)` enforced with cascade.
- `iac_resource_bindings` has `description`/`tags` NOT NULL; **no `name` column**; FK to `iac_sources(id)`, `infrastructure_points(id)`, `environments(id)` (nullable), `model_files(id)` enforced; `confidence DECIMAL(4,3)` with no DB CHECK; `start_line`/`end_line` are `INTEGER NULL`.
- 6 nullable provenance columns added to all 15 documented tables (12 entity + 3 Infra-internal relationship); 4 spec-6 cross-domain relationship tables NOT touched.
- 5 nullable readiness columns added to 12 entity tables only; relationships NOT touched.
- `terraform_variable_hints` is `TEXT` not `JSONB`.
- No applied changeset (≤ 117) was modified.

---

### Backend — Persistence Layer

#### Task Group 2: JPA Entity Classes (2 new + 15 extended)
**Dependencies:** Task Group 1

**Note:** This is the heaviest mechanical group. 11 fields × 12 existing entity classes + 6 fields × 3 existing relationship entity classes + 2 new entity classes = 192 net new field declarations across 17 files.

- [x] 2.0 Create 2 new JPA entity classes and extend 15 existing entity classes
  - [x] 2.1 Write 1-2 focused tests for entity field mapping
    - Test that `IaCSourceEntity` round-trips through JPA with full envelope (`name`/`description`/`tags`) plus a representative source-specific field (`commit_sha`, `provider`).
    - Test that `IaCResourceBindingEntity` round-trips with `confidence` as `BigDecimal` scale 3, `start_line`/`end_line` as nullable `Integer`, and `description`/`tags` as non-null strings.
    - Optionally include a smoke check that `ComputeResourceEntity` round-trips the 6 provenance + 5 readiness fields, and that `DeploymentUnitComputeResourceEntity` round-trips the 6 provenance fields. (May be deferred to the round-trip integration test in Group 4 if file size pressure is high.)
    - **File:** `architecture-model-service/src/test/java/com/example/architecturemodel/model/entity/InfrastructureTerraformReadinessEntityMappingTest.java`
    - Total tests: 1-2 max.
  - [x] 2.2 Create `IaCSourceEntity` (entity-shaped, mirrors spec 1 envelope)
    - Annotations: `@Entity`, `@Table(name = "iac_sources")`, `@Getter`, `@Setter`, `@NoArgsConstructor`, `@AllArgsConstructor`, `@Builder`.
    - Fields (all `@Column(name = "snake_case")`):
      - Envelope: `id String`, `modelFileId String`, `name String` (non-null), `description String` (non-null), `tags String` (non-null), `validFrom String` (nullable), `validTo String` (nullable).
      - Source-specific (all nullable boxed types): `environmentId String`, `sourceType String`, `repositoryUrl String`, `repositoryProvider String`, `branch String`, `commitSha String`, `path String`, `workspace String`, `moduleName String`, `modulePath String`, `provider String`, `owner String`, `lastScannedAt String`, `lastImportedAt String`.
    - All FK fields stored as raw `String` columns matching the spec 1/2 pattern.
    - Provenance + readiness fields are **NOT** added to `IaCSourceEntity` itself — `IaCSourceEntity` is an IaC source, not an Infra entity.
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/IaCSourceEntity.java`
    - **Reference:** spec 1's `EnvironmentEntity` for full entity envelope.
  - [x] 2.3 Create `IaCResourceBindingEntity` (relationship-shaped, mirrors spec 2/6 pattern)
    - Annotations: `@Entity`, `@Table(name = "iac_resource_bindings")`, `@Getter`, `@Setter`, `@NoArgsConstructor`, `@AllArgsConstructor`, `@Builder`.
    - Fields (all `@Column(name = "snake_case")`):
      - Envelope: `id String`, `modelFileId String`, `description String` (non-null), `tags String` (non-null). **No `name` column**.
      - Required FKs: `iacSourceId String`, `infrastructurePointId String`.
      - Optional FK: `environmentId String` (nullable).
      - Source-specific (all nullable boxed types): `iacAddress String`, `iacResourceType String`, `iacResourceName String`, `provider String`, `filePath String`, `startLine Integer`, `endLine Integer`, `stateResourceId String`, `externalId String`, `bindingStatus String`, `confidence BigDecimal`, `lastSeenAt String`.
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/IaCResourceBindingEntity.java`
    - **Reference:** spec 6's `ApplicationComputeDeploymentEntity` for relationship envelope; spec 4's polymorphic-target shape via `infrastructure_point_id`.
  - [x] 2.4 Extend the 12 existing Infrastructure entity classes with 11 new fields each
    - Files (each gets 6 provenance + 5 readiness fields appended):
      - `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/EnvironmentEntity.java`
      - `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/CloudAccountEntity.java`
      - `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/LocationEntity.java`
      - `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/NetworkEntity.java`
      - `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/SubnetEntity.java`
      - `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/ComputeClusterEntity.java`
      - `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/ComputeResourceEntity.java`
      - `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/DeploymentUnitEntity.java`
      - `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/LoadBalancerEntity.java`
      - `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/ListenerEntity.java`
      - `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/DataStoreInstanceEntity.java`
      - `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/InfrastructureResourceEntity.java`
    - Provenance fields per class (all nullable `String` with `@Column(name = "snake_case")`): `sourceOrigin`, `sourceSystem`, `sourceReference`, `generationStatus`, `generationNotes`, `lastVerifiedAt`.
    - Readiness fields per class: `terraformReady Boolean` (nullable), `terraformModuleHint String` (nullable), `terraformResourceHint String` (nullable), `terraformVariableHints String` (nullable, raw JSON string), `terraformNotes String` (nullable).
    - Append fields at end of each class, after existing fields, to keep diffs minimal.
  - [x] 2.5 Extend the 3 existing Infra-internal relationship entity classes with 6 new fields each
    - Files (each gets 6 provenance fields appended):
      - `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/ResourceSubnetHostingEntity.java`
      - `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/DeploymentUnitComputeResourceEntity.java`
      - `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/LoadBalancerResourceRouteEntity.java`
    - Provenance fields per class (all nullable `String`): `sourceOrigin`, `sourceSystem`, `sourceReference`, `generationStatus`, `generationNotes`, `lastVerifiedAt`.
    - **No** readiness fields on relationships (per Q2).
    - The 4 spec-6 cross-domain relationship entity classes (`ApplicationComputeDeploymentEntity`, `DataEntityDataStoreHostingEntity`, `ApplicationInfrastructureResourceUseEntity`, `ApplicationLoadBalancerExposureEntity`) are **NOT** extended.
  - [x] 2.6 Verify Java compiles + targeted tests pass
    - Apply broken-tests staging workaround.
    - Run ONLY the tests from 2.1.
    - Restore broken tests.

**Acceptance Criteria:**
- The 1-2 tests written in 2.1 pass.
- 2 new entity classes compile and persist via Hibernate against the schema from Task Group 1.
- `IaCSourceEntity` mirrors spec 1 entity envelope (with `name`); `IaCResourceBindingEntity` mirrors spec 2/6 relationship envelope (no `name`); both have `description`/`tags` non-null.
- `IaCResourceBindingEntity.confidence` is `BigDecimal` nullable; `startLine`/`endLine` are `Integer` nullable.
- 12 entity classes each have 11 new fields appended (6 provenance + 5 readiness) with correct `@Column(name = "...")` mappings.
- 3 Infra-internal relationship classes each have 6 new provenance fields appended.
- 4 spec-6 cross-domain relationship classes NOT modified.
- `IaCSourceEntity` does **not** carry provenance/readiness fields.

---

#### Task Group 3: DTO Records and Repositories (2 new DTOs + 15 extended DTOs + 2 repositories)
**Dependencies:** Task Group 2

- [x] 3.0 Create 2 new DTO records, extend 15 existing DTOs, and create 2 Spring Data JPA repositories
  - [x] 3.1 Write 1-2 focused tests for DTO JSON serialisation
    - Test `IaCSourceDto` round-trips through Jackson with snake_case JSON property names (`model_file_id` excluded from output, `repository_url`, `commit_sha`, `last_scanned_at`).
    - Test `IaCResourceBindingDto` serialises `confidence` as decimal scale 3, `start_line`/`end_line` as integer JSON, `iac_source_id`/`infrastructure_point_id` as snake_case, and does NOT include `model_file_id`.
    - **File:** `architecture-model-service/src/test/java/com/example/architecturemodel/model/dto/InfrastructureTerraformReadinessDtoSerialisationTest.java`
    - Total tests: 1-2 max.
  - [x] 3.2 Create `IaCSourceDto` (Java record)
    - All fields use `@JsonProperty("snake_case")` matching DB column names exactly.
    - Components: `id String`, `name String`, `description String`, `tags String`, `valid_from String`, `valid_to String`, `environment_id String`, `source_type String`, `repository_url String`, `repository_provider String`, `branch String`, `commit_sha String`, `path String`, `workspace String`, `module_name String`, `module_path String`, `provider String`, `owner String`, `last_scanned_at String`, `last_imported_at String`.
    - Do NOT include `model_file_id` (server-side only).
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/IaCSourceDto.java`
    - **Reference:** spec 1's `EnvironmentDto` for envelope; spec 2 entity DTO conventions.
  - [x] 3.3 Create `IaCResourceBindingDto` (Java record)
    - Components: `id String`, `iac_source_id String`, `infrastructure_point_id String`, `environment_id String`, `iac_address String`, `iac_resource_type String`, `iac_resource_name String`, `provider String`, `file_path String`, `start_line Integer`, `end_line Integer`, `state_resource_id String`, `external_id String`, `binding_status String`, `confidence BigDecimal`, `last_seen_at String`, `description String`, `tags String`.
    - **No `name` field** (relationship envelope).
    - Do NOT include `model_file_id`.
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/relationship/IaCResourceBindingDto.java`
    - **Reference:** spec 6's `ApplicationComputeDeploymentDto`.
  - [x] 3.4 Extend the 12 existing Infrastructure entity DTO records with 11 new fields each
    - Each DTO gets 6 provenance + 5 readiness fields appended as record components, all with `@JsonProperty("snake_case")`.
    - Provenance components: `source_origin String`, `source_system String`, `source_reference String`, `generation_status String`, `generation_notes String`, `last_verified_at String`.
    - Readiness components: `terraform_ready Boolean`, `terraform_module_hint String`, `terraform_resource_hint String`, `terraform_variable_hints String`, `terraform_notes String`.
    - Files (under `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/`):
      - `EnvironmentDto.java`, `CloudAccountDto.java`, `LocationDto.java`, `NetworkDto.java`, `SubnetDto.java`, `ComputeClusterDto.java`, `ComputeResourceDto.java`, `DeploymentUnitDto.java`, `LoadBalancerDto.java`, `ListenerDto.java`, `DataStoreInstanceDto.java`, `InfrastructureResourceDto.java`.
    - Append components at the end of each record's component list to keep diffs minimal.
  - [x] 3.5 Extend the 3 existing Infra-internal relationship DTO records with 6 new fields each
    - Each DTO gets 6 provenance components appended (no readiness on relationships).
    - Files (under `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/relationship/`):
      - `ResourceSubnetHostingDto.java`, `DeploymentUnitComputeResourceDto.java`, `LoadBalancerResourceRouteDto.java`.
    - The 4 spec-6 cross-domain DTOs are **NOT** extended.
  - [x] 3.6 Create 2 Spring Data JPA repositories
    - Each `extends JpaRepository<TEntity, String>`, `@Repository` annotation.
    - Methods: `List<TEntity> findByModelFileId(String modelFileId)`, `void deleteByModelFileId(String modelFileId)`.
    - No additional finders.
    - Files:
      - `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/IaCSourceRepository.java`
      - `architecture-model-service/src/main/java/com/example/architecturemodel/repository/relationship/IaCResourceBindingRepository.java`
  - [x] 3.7 Verify Java compiles + targeted tests pass
    - Apply broken-tests staging workaround.
    - Run ONLY the tests from 3.1.
    - Restore broken tests.

**Acceptance Criteria:**
- The 1-2 tests written in 3.1 pass.
- 2 new DTOs are Java records with `@JsonProperty("snake_case")` on every field; neither exposes `model_file_id`.
- `IaCSourceDto` carries the entity envelope (`id`/`name`/`description`/`tags`/`valid_from`/`valid_to`); `IaCResourceBindingDto` carries the relationship envelope (no `name`).
- 12 entity DTOs each have 11 new fields appended; 3 Infra-internal relationship DTOs each have 6 new fields appended.
- 4 spec-6 cross-domain DTOs NOT modified.
- 2 repositories provide `findByModelFileId` and `deleteByModelFileId`.

---

### Backend — Service Layer

#### Task Group 4: EntityMapper, MetaModelEntitiesDto, MetaModelRelationshipsDto, ModelService, ArchitectureCloneService, ArchitectureElementInventoryService + Round-Trip Test
**Dependencies:** Task Groups 2, 3

- [x] 4.0 Wire the 2 new tables and the 11/6 new fields-per-existing-table through the full save/load/delete-and-replace pipeline + clone + inventory services
  - [x] 4.1 Write 1 focused round-trip integration test class
    - One `InfrastructureTerraformReadinessRoundTripTest.java` covering:
      - save/load round-trip + delete-and-replace + projectId/architectureId scoping for `iac_sources` and `iac_resource_bindings`;
      - smoke check that the 6 provenance + 5 readiness fields round-trip on a representative entity (`compute_resources`);
      - smoke check that the 6 provenance fields round-trip on a representative Infra-internal relationship (`deployment_unit_compute_resources`).
    - Bundle into 4-6 tightly-scoped test methods inside the file.
    - **File:** `architecture-model-service/src/test/java/com/example/architecturemodel/integration/InfrastructureTerraformReadinessRoundTripTest.java`
    - **Reference:** spec 6's `InfrastructureCrossDomainRelationshipsRoundTripTest.java` as direct template.
    - Total tests: 4-6 max.
  - [x] 4.2 Extend `EntityMapper` with 2 new bidirectional arms + extend 15 existing arms
    - Append `toDto(IaCSourceEntity)` and `toEntity(IaCSourceDto, modelFileId)`.
    - Append `toDto(IaCResourceBindingEntity)` and `toEntity(IaCResourceBindingDto, modelFileId)`.
    - Each `toEntity` accepts `modelFileId` as a parameter and sets it server-side; each `toDto` strips `modelFileId`.
    - Extend the existing 12 entity arms (`toDto`/`toEntity` for `Environment`, `CloudAccount`, `Location`, `Network`, `Subnet`, `ComputeCluster`, `ComputeResource`, `DeploymentUnit`, `LoadBalancer`, `Listener`, `DataStoreInstance`, `InfrastructureResource`) to map the 11 new fields each (6 provenance + 5 readiness) bidirectionally.
    - Extend the existing 3 Infra-internal relationship arms (`toDto`/`toEntity` for `ResourceSubnetHosting`, `DeploymentUnitComputeResource`, `LoadBalancerResourceRoute`) to map the 6 new provenance fields each bidirectionally.
    - **Reference:** spec 6 arms for new-table pattern; spec 1/2 arms for the existing 15 entity/relationship arms (to know where to append fields in each arm).
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/mapper/EntityMapper.java` (or wherever the existing arms live; mapping may be inline in `ModelService` per existing convention).
  - [x] 4.3 Extend `MetaModelEntitiesDto`
    - Append 1 new `List<IaCSourceDto>` field with `@JsonProperty("iac_sources")`.
    - Default to empty list (not null) on serialisation.
    - Append at the end (after the 12 spec 1 entity entries) — do not reorder existing fields.
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/MetaModelEntitiesDto.java`
  - [x] 4.4 Extend `MetaModelRelationshipsDto`
    - Append 1 new `List<IaCResourceBindingDto>` field with `@JsonProperty("iac_resource_bindings")`.
    - Default to empty list (not null) on serialisation.
    - Append at the end (after the 3 spec 2 Infra-internal entries and the 4 spec 6 cross-domain entries) — do not reorder existing fields.
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/MetaModelRelationshipsDto.java`
  - [x] 4.5 Extend `ModelService.saveEntities(...)`, `saveRelationships(...)`, `loadModelByFileId(...)`, `deleteAllDataForModelFile(...)`
    - Inject the 2 new repositories (`IaCSourceRepository`, `IaCResourceBindingRepository`) via constructor parameters / fields, matching existing style.
    - **Save order (entities → relationships):** existing entities → `iac_sources` (new arm) → existing relationships → `iac_resource_bindings` (new arm).
    - **Load:** append 1 arm in entities assembly (calling `IaCSourceRepository.findByModelFileId(...)`, mapping to `IaCSourceDto`, assigning to `MetaModelEntitiesDto.iac_sources`); append 1 arm in relationships assembly (mirror for `iac_resource_bindings`).
    - **Delete-and-replace order (reverse, dependent first):** `iac_resource_bindings` deleted first (depends on `iac_sources` AND `infrastructure_points`) → existing relationships → `iac_sources` → existing entities.
    - Pattern strictly mirrors spec 2 + spec 6 arms.
    - Existing Business / Application / Data / Behavioural / UI / Infrastructure-V1 / Infrastructure-cross-domain (spec 6) behaviour remains unchanged.
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/service/ModelService.java`
  - [x] 4.6 Extend `ArchitectureCloneService.IN_SCOPE_TABLES_IN_ORDER`
    - **Block A (BASE entities):** append `iac_sources` after the 12 spec 1/2 Infra entity tables.
    - **Block B (DEPENDENT relationships):** append `iac_resource_bindings` at the **very end**, after the 3 spec 2 Infra-internal relationship tables AND after the 4 spec 6 cross-domain relationship tables (since `iac_resource_bindings` depends on `iac_sources` AND `infrastructure_points`).
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/service/ArchitectureCloneService.java`
  - [x] 4.7 Extend `ArchitectureElementInventoryService`
    - `TABLES_BY_DOMAIN.Infrastructure` += `iac_sources`, `iac_resource_bindings` (append to existing Infrastructure entry).
    - `DISPLAY_NAME_FALLBACK_TABLES` += `iac_resource_bindings` (relationship, no `name` column).
    - `iac_sources` is **NOT** added to `DISPLAY_NAME_FALLBACK_TABLES` (it has a `name` column).
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/service/ArchitectureElementInventoryService.java`
  - [x] 4.8 Verify Java compiles + targeted tests pass
    - Apply broken-tests staging workaround (move ~108 broken backend test files plus ~9 broken `ModelService*Test` files temporarily out of `src/test/java`).
    - Run ONLY the round-trip test class from 4.1 plus the targeted tests from 1.1, 2.1, 3.1.
    - Total expected: ~7-14 tests.
    - Restore broken tests.
    - Do NOT run the entire backend test suite.

**Acceptance Criteria:**
- The 4-6 tests in 4.1 pass plus all earlier targeted tests still pass.
- DTO ↔ Entity mapping preserves every spec'd field with no loss for both new tables and all 15 extended tables.
- `MetaModelEntitiesDto` exposes 1 new `iac_sources` list with snake_case JSON name; existing 12 entity lists unchanged.
- `MetaModelRelationshipsDto` exposes 1 new `iac_resource_bindings` list with snake_case JSON name; existing 3 + 4 = 7 relationship lists unchanged.
- `ModelService` save/load/delete-and-replace correctly persists, retrieves, and clears the 2 new tables AND the 11/6 new fields-per-existing-table, scoped by `projectId` + `architectureId`.
- Save order: existing entities → `iac_sources` → existing relationships → `iac_resource_bindings`. Delete order is the reverse.
- `ArchitectureCloneService.IN_SCOPE_TABLES_IN_ORDER` Block A includes `iac_sources` after the 12 spec 1/2 entity tables; Block B includes `iac_resource_bindings` at the very end.
- `ArchitectureElementInventoryService` lists both new tables under Infrastructure; `DISPLAY_NAME_FALLBACK_TABLES` includes `iac_resource_bindings` only.
- Existing Business / Application / Data / Behavioural / UI / Infrastructure-V1 / Infrastructure-cross-domain behaviour is regression-safe.

---

### Frontend — Types and Configuration

#### Task Group 5: Frontend Types, Defaults, Relationship Definitions, Domain Mappings, Serialisation Backfill
**Dependencies:** Task Group 4 (logical — frontend can run in parallel with backend service-layer work, but contract must be agreed)

- [x] 5.0 Extend frontend types, RELATIONSHIP_DEFINITIONS, ENTITY_TYPE_TO_DOMAIN, DOMAIN_TO_ENTITY_TYPES / DOMAIN_TO_RELATIONSHIP_TYPES, defaults, and modelSerialization
  - [x] 5.1 No targeted tests in this group — verification is via Vitest config test in Task Group 7 plus `npx tsc --noEmit`.
  - [x] 5.2 Extend `frontend/src/types/model.ts`
    - Add 2 new TypeScript interfaces (PascalCase, snake_case fields):
      - `IaCSource`: `id: string`, `name: string`, `description: string`, `tags: string`, `valid_from?: string`, `valid_to?: string`, `environment_id?: string`, `source_type?: string`, `repository_url?: string`, `repository_provider?: string`, `branch?: string`, `commit_sha?: string`, `path?: string`, `workspace?: string`, `module_name?: string`, `module_path?: string`, `provider?: string`, `owner?: string`, `last_scanned_at?: string`, `last_imported_at?: string`.
      - `IaCResourceBinding`: `id: string`, `iac_source_id: string`, `infrastructure_point_id: string`, `environment_id?: string`, `iac_address?: string`, `iac_resource_type?: string`, `iac_resource_name?: string`, `provider?: string`, `file_path?: string`, `start_line?: number`, `end_line?: number`, `state_resource_id?: string`, `external_id?: string`, `binding_status?: string`, `confidence?: number`, `last_seen_at?: string`, `description: string`, `tags: string`.
    - Extend `MetaModelEntities` with `iac_sources: IaCSource[]`.
    - Extend `MetaModelRelationships` with `iac_resource_bindings: IaCResourceBinding[]`.
    - Extend `EntityType` and `AnyEntity` unions with `IaCSource` (entity-side, per Q3).
    - Extend `RelationshipType` and `AnyRelationship` unions with `IaCResourceBinding` (relationship-side, per Q3).
    - Extend the **12 existing Infrastructure entity TypeScript interfaces** (`Environment`, `CloudAccount`, `Location`, `Network`, `Subnet`, `ComputeCluster`, `ComputeResource`, `DeploymentUnit`, `LoadBalancer`, `Listener`, `DataStoreInstance`, `InfrastructureResource`) with 11 new optional fields each: `source_origin?: string`, `source_system?: string`, `source_reference?: string`, `generation_status?: string`, `generation_notes?: string`, `last_verified_at?: string`, `terraform_ready?: boolean`, `terraform_module_hint?: string`, `terraform_resource_hint?: string`, `terraform_variable_hints?: string`, `terraform_notes?: string`.
    - Extend the **3 existing Infra-internal relationship TypeScript interfaces** (`ResourceSubnetHosting`, `DeploymentUnitComputeResource`, `LoadBalancerResourceRoute`) with 6 new optional fields each: `source_origin?: string`, `source_system?: string`, `source_reference?: string`, `generation_status?: string`, `generation_notes?: string`, `last_verified_at?: string`.
    - **Do NOT** add a new `RELATIONSHIP_EDGE_TYPES` constant for `IaCResourceBinding` (per Q5 — no diagram support).
    - **File:** `frontend/src/types/model.ts`
  - [x] 5.3 Extend `frontend/src/config/relationshipDefinitions.ts`
    - Append 1 new `RELATIONSHIP_DEFINITIONS` entry for `iac_resource_bindings` with:
      - Display name / tab label: `"IaC Source ↔ Infrastructure"` (or `"IaC Binding"`, whichever matches repo convention).
      - `endpointEntityTypes` mixing `iac_sources` (source side) with the 12 Infra entity types as targets (via the polymorphic `infrastructure_point_id` shape).
    - Append the new tab label to `RELATIONSHIP_TAB_ORDER` after the spec 6 cross-domain entries.
    - **File:** `frontend/src/config/relationshipDefinitions.ts`
  - [x] 5.4 Extend `frontend/src/types/architectureDomain.ts`
    - `ENTITY_TYPE_TO_DOMAIN.iac_sources = 'infrastructure'` (entity-side wiring per Q3 + Q11).
    - **File:** `frontend/src/types/architectureDomain.ts`
  - [x] 5.5 Extend `frontend/src/utils/contextPickerDomainMappings.ts`
    - `DOMAIN_TO_ENTITY_TYPES.infrastructure` += `'iac_sources'`.
    - `DOMAIN_TO_RELATIONSHIP_TYPES.infrastructure` += `'iac_resource_bindings'`.
    - Do NOT alter Business / Application / Data / Behavioural / UI / Infrastructure existing entries.
    - **File:** `frontend/src/utils/contextPickerDomainMappings.ts`
  - [x] 5.6 Extend `frontend/src/config/defaults.ts`
    - Add 6 new picklist option arrays (verbatim values per spec):
      ```ts
      export const sourceOriginOptions = ['MANUAL', 'DISCOVERED', 'IMPORTED', 'GENERATED', 'SUGGESTED', 'OTHER'];
      export const generationStatusOptions = ['NOT_READY', 'READY', 'GENERATED', 'BLOCKED', 'NOT_APPLICABLE', 'UNKNOWN'];
      export const iacSourceTypeOptions = ['TERRAFORM', 'OPENTOFU', 'CLOUDFORMATION', 'BICEP', 'PULUMI', 'KUBERNETES', 'HELM', 'OTHER'];
      export const repositoryProviderOptions = ['GITHUB', 'GITLAB', 'BITBUCKET', 'AZURE_DEVOPS', 'OTHER'];
      export const iacSourceProviderOptions = ['GCP', 'AWS', 'AZURE', 'ON_PREM', 'MULTI', 'OTHER'];
      export const bindingStatusOptions = ['PLANNED', 'SUGGESTED', 'CONFIRMED', 'STALE', 'REMOVED', 'UNKNOWN'];
      ```
    - **Do NOT** redeclare or modify existing spec-4 `providerOptions`. `iacSourceProviderOptions` is intentionally separate (per Q6) due to the `MULTI` value.
    - Append `iac_sources: []` to `emptyModel.entities`.
    - Append `iac_resource_bindings: []` to `emptyModel.relationships`.
    - **File:** `frontend/src/config/defaults.ts`
  - [x] 5.7 Extend `frontend/src/api/modelSerialization.ts`
    - Append 2 new `??=` lines in `normalizeModelFromApi`, in the appropriate sections:
      - `model.entities.iac_sources ??= [];`
      - `model.relationships.iac_resource_bindings ??= [];`
    - Provenance/readiness fields on existing tables need NO backfill (nullable columns; missing reads as `undefined` cleanly).
    - **File:** `frontend/src/api/modelSerialization.ts`
  - [x] 5.8 Verify TypeScript compiles
    - Run `npx tsc --noEmit` from `frontend/`.
    - Verify zero new TypeScript errors introduced.
    - Do NOT run Vitest yet (full sweep happens in Task Group 7).

**Acceptance Criteria:**
- 2 new TypeScript interfaces (`IaCSource`, `IaCResourceBinding`) compile with correct snake_case fields and `description: string` / `tags: string` non-optional on both.
- 12 existing Infrastructure entity interfaces extended with 11 new optional fields each.
- 3 existing Infra-internal relationship interfaces extended with 6 new optional fields each.
- 4 spec-6 cross-domain relationship interfaces NOT modified.
- `MetaModelEntities` extended with `iac_sources: IaCSource[]`; `MetaModelRelationships` extended with `iac_resource_bindings: IaCResourceBinding[]`.
- `EntityType` + `AnyEntity` unions extended with `IaCSource`; `RelationshipType` + `AnyRelationship` unions extended with `IaCResourceBinding`.
- **No** new `RELATIONSHIP_EDGE_TYPES` constant added.
- 1 new `RELATIONSHIP_DEFINITIONS` entry wired with correct `endpointEntityTypes` mixing `iac_sources` and the 12 Infra entity types.
- `RELATIONSHIP_TAB_ORDER` includes the new tab after spec 6 cross-domain entries.
- `ENTITY_TYPE_TO_DOMAIN.iac_sources === 'infrastructure'`.
- `DOMAIN_TO_ENTITY_TYPES.infrastructure` includes `'iac_sources'`; `DOMAIN_TO_RELATIONSHIP_TYPES.infrastructure` includes `'iac_resource_bindings'`.
- 6 new picklist arrays exported from `defaults.ts` with verbatim values; `providerOptions` NOT redeclared/modified.
- `emptyModel.entities.iac_sources = []`; `emptyModel.relationships.iac_resource_bindings = []`.
- `normalizeModelFromApi` has 2 new `??=` backfill lines.
- `npx tsc --noEmit` reports zero new errors.

---

### Frontend — Tables UI

#### Task Group 6: Grid Configurations
**Dependencies:** Task Group 5

- [x] 6.0 Append 2 new grid configs to `gridConfigs.ts` and update tab maps + domain groupings
  - [x] 6.1 No targeted tests in this group — verification is via Vitest config test in Task Group 7 plus `npx tsc --noEmit`.
  - [x] 6.2 Append grid config for `iac_sources`
    - Columns (in order):
      - `name` cellType `'text'`, **required**.
      - `source_type` cellType `'dropdown'`, options `iacSourceTypeOptions`, optional.
      - `provider` cellType `'dropdown'`, options `iacSourceProviderOptions`, optional.
      - `repository_url` cellType `'text'`.
      - `repository_provider` cellType `'dropdown'`, options `repositoryProviderOptions`, optional.
      - `branch` cellType `'text'`.
      - `commit_sha` cellType `'text'`.
      - `path` cellType `'text'`.
      - `workspace` cellType `'text'`.
      - `module_name` cellType `'text'`.
      - `module_path` cellType `'text'`.
      - `environment_id` cellType `'fk_typeahead'`, fkTarget `'environments'`, optional.
      - `owner` cellType `'text'`.
      - `last_scanned_at` cellType `'text'`.
      - `last_imported_at` cellType `'text'`.
      - `description` cellType `'text'`.
      - `tags` cellType `'tags'`.
      - `valid_from` cellType `'text'`.
      - `valid_to` cellType `'text'`.
    - **File:** `frontend/src/config/gridConfigs.ts`
  - [x] 6.3 Append grid config for `iac_resource_bindings`
    - Columns (in order):
      - `infrastructure_point_id` cellType `'infrastructure_point_picker'` (reused from spec 4 with **NO `allowedKinds` restriction** — bindings can target any of the 12 Infra entity kinds), **required**.
      - `iac_source_id` cellType `'fk_typeahead'`, fkTarget `'iac_sources'`, **required**.
      - `environment_id` cellType `'fk_typeahead'`, fkTarget `'environments'`, optional.
      - `iac_address` cellType `'text'`.
      - `iac_resource_type` cellType `'text'`.
      - `iac_resource_name` cellType `'text'`.
      - `provider` cellType `'dropdown'`, options `iacSourceProviderOptions`, optional.
      - `file_path` cellType `'text'`.
      - `start_line` cellType `'text'` (numeric-as-text per spec 4 precedent).
      - `end_line` cellType `'text'` (numeric-as-text).
      - `state_resource_id` cellType `'text'`.
      - `external_id` cellType `'text'`.
      - `binding_status` cellType `'dropdown'`, options `bindingStatusOptions`, optional.
      - `confidence` cellType `'text'` (numeric-as-text).
      - `last_seen_at` cellType `'text'`.
      - `description` cellType `'text'`.
      - `tags` cellType `'tags'`.
    - **File:** `frontend/src/config/gridConfigs.ts`
  - [x] 6.4 Append entries to tab maps
    - `tabToEntityType`: append `'IaC Sources' → 'iac_sources'`.
    - `entityTabNames`: append `"IaC Sources"`.
    - `relationshipTabToType`: append `'IaC Resource Bindings' → 'iac_resource_bindings'`.
    - `relationshipTabNames`: append `"IaC Resource Bindings"`.
    - **File:** `frontend/src/config/gridConfigs.ts`
  - [x] 6.5 Extend domain groupings
    - `domainGroupings.infrastructure`: append 1 visible entry `"IaC Sources"`.
    - `DOMAIN_ENTITY_TYPES.infrastructure`: append `'iac_sources'`.
    - The `iac_resource_bindings` tab surfaces under Infrastructure automatically via `getRelationshipsForDomain` derivation from `endpointEntityTypes` (no manual entry needed in `domainGroupings`).
    - **File:** `frontend/src/config/gridConfigs.ts`
  - [x] 6.6 Confirm NO edits to existing 15 Infra grid configs
    - Per Q4 trim: NO new columns added to any of the 12 existing Infra entity gridConfigs.
    - Per Q4 trim: NO new columns added to any of the 3 existing Infra-internal relationship gridConfigs.
    - Per Q4 + Q13: NO edits to any of the 4 existing spec-6 cross-domain relationship gridConfigs.
    - Provenance/readiness data round-trips through save/load but is not displayed in V1 grids.
  - [x] 6.7 Verify TypeScript compiles
    - Run `npx tsc --noEmit` from `frontend/`.
    - Verify zero new TypeScript errors introduced.

**Acceptance Criteria:**
- 2 new grid configs (`iac_sources`, `iac_resource_bindings`) compile with the column shapes above.
- `iac_sources.name`, `iac_resource_bindings.infrastructure_point_id`, and `iac_resource_bindings.iac_source_id` marked `required: true`.
- Reuse only existing cellTypes (`infrastructure_point_picker`, `fk_typeahead`, `dropdown`, `text`, `tags`) — **no new cellType**.
- `infrastructure_point_picker` is reused **without `allowedKinds` restriction** on `iac_resource_bindings`.
- `tabToEntityType`, `entityTabNames`, `relationshipTabToType`, `relationshipTabNames` each have the documented entries appended.
- `domainGroupings.infrastructure` includes `"IaC Sources"`; `DOMAIN_ENTITY_TYPES.infrastructure` includes `'iac_sources'`.
- All 12 existing Infra entity gridConfigs, 3 existing Infra-internal relationship gridConfigs, and 4 existing spec-6 cross-domain gridConfigs are **unchanged**.
- `npx tsc --noEmit` reports zero new errors.

---

### Verification

#### Task Group 7: Frontend Vitest Config Test + Full Verification Sweep
**Dependencies:** Task Groups 1-6

- [x] 7.0 Verify the full feature end-to-end via one focused Vitest config test plus a full Vitest sweep with net-new-failures = 0
  - [x] 7.1 Review existing tests from Task Groups 1-6
    - Backend: 1.1 (1-4 tests), 2.1 (1-2 tests), 3.1 (1-2 tests), 4.1 (4-6 tests). Backend total: ~7-14 tests.
    - Frontend: no targeted tests in Task Groups 5-6 (verification deferred to this group).
    - Total existing tests so far: ~7-14 backend tests + 0 frontend tests.
  - [x] 7.2 Analyse test coverage gaps for THIS feature only
    - Backend round-trip is already covered by 4.1; no additional backend test needed.
    - Frontend has no targeted test yet — gap is the Vitest config test asserting all wiring is present.
    - Do NOT assess entire-app coverage; focus only on this spec's surface.
  - [x] 7.3 Write the frontend Vitest config test (1 file, up to 6 grouped assertions)
    - **File:** `frontend/src/config/__tests__/infrastructureTerraformReadinessConfig.test.ts`
    - Assertions:
      1. 2 new `gridConfigs` entries (`iac_sources`, `iac_resource_bindings`) exist with their required-field columns (`iac_sources.name` required; `iac_resource_bindings.infrastructure_point_id` and `iac_resource_bindings.iac_source_id` required).
      2. `ENTITY_TYPE_TO_DOMAIN.iac_sources === 'infrastructure'`.
      3. `DOMAIN_TO_RELATIONSHIP_TYPES.infrastructure` includes `'iac_resource_bindings'`; `DOMAIN_TO_ENTITY_TYPES.infrastructure` includes `'iac_sources'`.
      4. `iac_resource_bindings` is wired in `RELATIONSHIP_DEFINITIONS` with `endpointEntityTypes` mixing `iac_sources` and the 12 Infra entity types.
      5. All 6 new picklist arrays (`sourceOriginOptions`, `generationStatusOptions`, `iacSourceTypeOptions`, `repositoryProviderOptions`, `iacSourceProviderOptions`, `bindingStatusOptions`) exist in `defaults.ts` with the documented verbatim values.
      6. `emptyModel.entities.iac_sources` and `emptyModel.relationships.iac_resource_bindings` are present and default to `[]`.
    - Bundle into 4-6 tightly-scoped test cases. Total tests in this file: 4-6 max.
    - **Reference:** spec 6's `infrastructureCrossDomainConfig.test.ts` as direct template.
  - [x] 7.4 Run targeted verification sweep
    - **Backend:** apply broken-tests staging workaround. Run ONLY the targeted tests from 1.1, 2.1, 3.1, 4.1. Restore broken tests.
    - **Frontend:** run `npx tsc --noEmit` from `frontend/`. Run the new Vitest test from 7.3 in isolation first to verify it passes.
    - **Frontend full sweep:** run the entire Vitest suite. Confirm net new failures = 0 (compare against pre-existing failures captured in project memory).
    - Expected total feature-specific tests: backend ~7-14 + frontend ~4-6 = ~11-20.

**Acceptance Criteria:**
- The 4-6 tests in 7.3 pass.
- All earlier targeted backend tests (Task Groups 1-4) still pass.
- `npx tsc --noEmit` from `frontend/` reports zero errors.
- Full Vitest sweep on `frontend/` shows net new failures = 0 (only previously-known pre-existing failures remain).
- No more than 6 additional Vitest tests added in this group.
- Testing focused exclusively on this spec's feature requirements; no broader application test-coverage work attempted.

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Liquibase Migrations (118-121)** — schema first; everything else depends on these tables/columns existing.
2. **Task Group 2: JPA Entity Classes (2 new + 15 extended)** — maps the 2 new tables and the 11/6 new field-additions into Java; required by repositories and mappers. **Heaviest mechanical group.**
3. **Task Group 3: DTO Records and Repositories (2 new DTOs + 15 extended DTOs + 2 repositories)** — DTOs and repositories depend on Task Group 2.
4. **Task Group 4: EntityMapper, MetaModelEntitiesDto, MetaModelRelationshipsDto, ModelService, ArchitectureCloneService, ArchitectureElementInventoryService + Round-Trip Test** — wires the 2 new tables and the 11/6 field-additions through the full backend pipeline; depends on Task Groups 2 and 3.
5. **Task Group 5: Frontend Types, Defaults, Relationship Definitions, Domain Mappings, Serialisation Backfill** — frontend type-system foundation; can run in parallel with Task Group 4 once the contract is locked.
6. **Task Group 6: Grid Configurations** — depends on Task Group 5 (types and picklist arrays).
7. **Task Group 7: Frontend Vitest Config Test + Full Verification Sweep** — depends on all previous groups; closes out the spec with `tsc --noEmit`, the Vitest config test, and the full-sweep net-new-failures check.

---

## File Summary

### Backend Files to Create (8)

**Liquibase changesets (4):**
- `architecture-model-service/src/main/resources/db/changelog/sql/118-iac-sources.sql`
- `architecture-model-service/src/main/resources/db/changelog/sql/119-iac-resource-bindings.sql`
- `architecture-model-service/src/main/resources/db/changelog/sql/120-infrastructure-provenance-fields.sql`
- `architecture-model-service/src/main/resources/db/changelog/sql/121-infrastructure-terraform-readiness-fields.sql`

**JPA entities (2):**
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/IaCSourceEntity.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/IaCResourceBindingEntity.java`

**DTOs (2):**
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/IaCSourceDto.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/relationship/IaCResourceBindingDto.java`

**Repositories (2):**
- `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/IaCSourceRepository.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/repository/relationship/IaCResourceBindingRepository.java`

### Backend Files to Modify (22)

**Master changelog (1):**
- `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml` (register 4 new changesets)

**Existing entity classes — add 11 fields each (12):**
- `EnvironmentEntity.java`, `CloudAccountEntity.java`, `LocationEntity.java`, `NetworkEntity.java`, `SubnetEntity.java`, `ComputeClusterEntity.java`, `ComputeResourceEntity.java`, `DeploymentUnitEntity.java`, `LoadBalancerEntity.java`, `ListenerEntity.java`, `DataStoreInstanceEntity.java`, `InfrastructureResourceEntity.java` (under `model/entity/`).

**Existing Infra-internal relationship entity classes — add 6 fields each (3):**
- `ResourceSubnetHostingEntity.java`, `DeploymentUnitComputeResourceEntity.java`, `LoadBalancerResourceRouteEntity.java` (under `model/entity/`).

**Existing entity DTO records — add 11 fields each (12):**
- `EnvironmentDto.java`, `CloudAccountDto.java`, `LocationDto.java`, `NetworkDto.java`, `SubnetDto.java`, `ComputeClusterDto.java`, `ComputeResourceDto.java`, `DeploymentUnitDto.java`, `LoadBalancerDto.java`, `ListenerDto.java`, `DataStoreInstanceDto.java`, `InfrastructureResourceDto.java` (under `model/dto/entity/`).

**Existing Infra-internal relationship DTO records — add 6 fields each (3):**
- `ResourceSubnetHostingDto.java`, `DeploymentUnitComputeResourceDto.java`, `LoadBalancerResourceRouteDto.java` (under `model/dto/relationship/`).

**Service layer (5):**
- `architecture-model-service/src/main/java/com/example/architecturemodel/mapper/EntityMapper.java` (append 2 new toDto + 2 toEntity arms; extend 12 entity arms + 3 Infra-internal relationship arms with the new fields).
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/MetaModelEntitiesDto.java` (append `iac_sources` list).
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/MetaModelRelationshipsDto.java` (append `iac_resource_bindings` list).
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/ModelService.java` (inject 2 repos; append save / load / delete-and-replace arms for both new tables).
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/ArchitectureCloneService.java` (append `iac_sources` to Block A; append `iac_resource_bindings` to Block B at very end).
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/ArchitectureElementInventoryService.java` (extend `TABLES_BY_DOMAIN.Infrastructure` and `DISPLAY_NAME_FALLBACK_TABLES`).

### Backend Test Files to Create (4)
- `architecture-model-service/src/test/java/com/example/architecturemodel/repository/entity/InfrastructureTerraformReadinessFkConstraintTest.java`
- `architecture-model-service/src/test/java/com/example/architecturemodel/model/entity/InfrastructureTerraformReadinessEntityMappingTest.java`
- `architecture-model-service/src/test/java/com/example/architecturemodel/model/dto/InfrastructureTerraformReadinessDtoSerialisationTest.java`
- `architecture-model-service/src/test/java/com/example/architecturemodel/integration/InfrastructureTerraformReadinessRoundTripTest.java`

### Frontend Files to Modify (6)
- `frontend/src/types/model.ts` (2 new interfaces; extend `MetaModelEntities`, `MetaModelRelationships`, `EntityType`, `AnyEntity`, `RelationshipType`, `AnyRelationship`; extend 12 Infra entity interfaces with 11 new fields each; extend 3 Infra-internal relationship interfaces with 6 new fields each; **NO** new `RELATIONSHIP_EDGE_TYPES`).
- `frontend/src/config/relationshipDefinitions.ts` (append 1 `RELATIONSHIP_DEFINITIONS` entry for `iac_resource_bindings`; append to `RELATIONSHIP_TAB_ORDER`).
- `frontend/src/types/architectureDomain.ts` (`ENTITY_TYPE_TO_DOMAIN.iac_sources = 'infrastructure'`).
- `frontend/src/utils/contextPickerDomainMappings.ts` (extend `DOMAIN_TO_ENTITY_TYPES.infrastructure` and `DOMAIN_TO_RELATIONSHIP_TYPES.infrastructure`).
- `frontend/src/config/defaults.ts` (6 new picklist arrays; append `iac_sources: []` and `iac_resource_bindings: []` to `emptyModel`; **NO** edits to `providerOptions`).
- `frontend/src/api/modelSerialization.ts` (2 new `??=` backfill lines).
- `frontend/src/config/gridConfigs.ts` (2 new grid configs; tab map updates; `domainGroupings.infrastructure` + `DOMAIN_ENTITY_TYPES.infrastructure` updates).

### Frontend Test Files to Create (1)
- `frontend/src/config/__tests__/infrastructureTerraformReadinessConfig.test.ts`

### Files Explicitly NOT to Touch
- `frontend/src/utils/relationshipUtils.ts` — no edge logic for `iac_resource_bindings` (per Q5).
- `frontend/src/utils/rendering.ts` — no edge defaults for `iac_resource_bindings`.
- `frontend/src/utils/paletteData.ts` — no new diagram palette sections (per Q5; only add minimal registration stubs **if** the codebase requires them for type recognition, otherwise omit).
- `frontend/src/components/SelectionInspector/SelectionInspector.tsx` — no edge inspector arm.
- All 12 existing Infra entity gridConfig entries.
- All 3 existing Infra-internal relationship gridConfig entries.
- All 4 existing spec-6 cross-domain relationship gridConfig entries.
- The 4 spec-6 cross-domain entity classes, DTOs, and repositories — none receive provenance/readiness fields (per Q2).
- `gateway/`, `mcp-server/`, `discovery-service/` — zero code changes (per Q7).
- Existing Liquibase changesets `001-` through `117-` — never amend.
- `providerOptions` in `defaults.ts` — separate `iacSourceProviderOptions` array per Q6.

---

## Reference Patterns

### Existing Code to Follow
- **Spec 1 entity stack** (`EnvironmentEntity`, `ComputeResourceEntity`, etc.) — direct template for `IaCSourceEntity`: full entity envelope (`id`/`model_file_id`/`name`/`description`/`tags`/`valid_from`/`valid_to`) plus type-specific fields with `@Column(name = "...")` and FKs as raw `String` columns.
- **Spec 2 + Spec 6 relationship stack** (`ResourceSubnetHostingEntity`, `ApplicationComputeDeploymentEntity`) — direct template for `IaCResourceBindingEntity` (relationship envelope without `name`, polymorphic-target via `infrastructure_point_id`, `BigDecimal` confidence, `Integer` line-number columns) AND for the `EntityMapper` arm, repository, `MetaModelRelationshipsDto` field, `ModelService` save/load/delete arm, and `ArchitectureCloneService` Block B append.
- **Spec 4 `infrastructure_point_picker` cellType** — reused unchanged for `iac_resource_bindings.infrastructure_point_id`. NO `allowedKinds` restriction.
- **Spec 4 `gridConfigs.ts` patterns** (Infra entity grids and Infra-internal relationship grids) — direct template for the 2 new grid configs: column shapes, `cellType: 'fk_typeahead'` patterns, dropdown patterns, numeric-as-text precedent for `confidence`/`start_line`/`end_line`.
- **Spec 4 `defaults.ts` picklist conventions** — direct template for the 6 new arrays (verbatim arrays, snake_case key reused as the `field`).
- **Spec 6 round-trip test class** (`InfrastructureCrossDomainRelationshipsRoundTripTest.java`) — direct template for `InfrastructureTerraformReadinessRoundTripTest.java`.
- **Spec 6 Vitest config test** (`infrastructureCrossDomainConfig.test.ts`) — direct template for `infrastructureTerraformReadinessConfig.test.ts`.
- **Existing `getRelationshipsForDomain` derivation** — automatically surfaces `iac_resource_bindings` under the Infrastructure domain tab via `endpointEntityTypes` (no manual `domainGroupings` entry needed for the relationship tab).

### Key Decisions to Honour (Locked Contract)
- **Q1**: Full ambition — both new concepts + provenance fields + readiness fields, all round-trippable.
- **Q2**: Provenance/readiness fields apply to **12 Infra entity tables + 3 Infra-internal relationship tables only**. Readiness fields apply to **12 entities only**. The 4 spec-6 cross-domain relationship tables are **NOT** extended.
- **Q3**: `iac_sources` is an entity (in `MetaModelEntitiesDto`, `EntityType`, `ENTITY_TYPE_TO_DOMAIN`); `iac_resource_bindings` is a relationship (in `MetaModelRelationshipsDto`, `RelationshipType`, `DOMAIN_TO_RELATIONSHIP_TYPES`).
- **Q4**: Frontend = backend + DTOs + roundtrip + 2 new table tabs only. **NO** per-entity provenance/readiness columns added to existing 12 entity grids. **NO** per-relationship provenance columns added to existing 3 Infra-internal relationship grids.
- **Q5**: Tables-only for V1 — **NO** diagram palette section, **NO** node shape, **NO** edge type, **NO** `RELATIONSHIP_EDGE_TYPES` entry, **NO** `relationshipUtils.ts` arm, **NO** `rendering.ts` arm, **NO** `SelectionInspector.tsx` arm.
- **Q6**: Separate `iacSourceProviderOptions = ['GCP', 'AWS', 'AZURE', 'ON_PREM', 'MULTI', 'OTHER']`. Do **NOT** add `MULTI` to existing spec-4 `providerOptions`.
- **Q7**: Zero Gateway / MCP / Discovery code changes. `spec.md` future-contract section is narrative only.
- **Q8**: 4 separate changesets `118-` through `121-`, in numeric order.
- **Q9**: `terraform_variable_hints` is `TEXT` (raw JSON string), **not** `JSONB`.
- **Q10**: Test scope locked — 1 backend round-trip test class + 1 frontend Vitest config test (+ small targeted entity/DTO/FK tests in Groups 1-3). **NO** renderer / component / picker-cell / diagram-interaction tests.
- **Q11**: `ENTITY_TYPE_TO_DOMAIN.iac_sources = 'infrastructure'`; `DOMAIN_TO_RELATIONSHIP_TYPES.infrastructure` += `'iac_resource_bindings'`. Existing 12 Infra entity entries unchanged.
- **Q12**: Clone block A: append `iac_sources` after the 12 spec 1/2 Infra entity tables. Block B: append `iac_resource_bindings` at the very end (after spec 2 Infra-internal AND spec 6 cross-domain). Inventory: extend `TABLES_BY_DOMAIN.Infrastructure` with both; extend `DISPLAY_NAME_FALLBACK_TABLES` with `iac_resource_bindings` only.
- **Q13**: 3 explicit additional exclusions: no per-entity provenance/readiness grid columns in V1, no IaC diagram support in V1, no Gateway / MCP / Discovery code.
- **Liquibase ordering**: never edit applied changesets (≤ 117); only add new files numbered 118-121.
- **Snake_case everywhere** — DB columns, DTO `@JsonProperty`, TypeScript interface fields, grid `field` keys all use snake_case matching DB column names exactly.
- **`confidence DECIMAL(4,3) NULL`** — no DB CHECK, no JPA validation.
- **`description NOT NULL`, `tags NOT NULL`** on the 2 new tables.
- **`infrastructure_point_picker` reused unchanged** — no new cellType, no `allowedKinds` restriction.
- **Carry-forward test failures** — pre-existing failures, ~108 broken backend test files, and ~9 broken `ModelService*Test` files persist. Use the broken-tests staging workaround when running targeted backend tests; do not investigate during this spec.
