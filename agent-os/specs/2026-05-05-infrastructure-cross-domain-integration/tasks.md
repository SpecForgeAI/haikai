# Task Breakdown: Infrastructure Cross-Domain Integration

## Overview
Total Tasks: 8 task groups covering 4 Liquibase changesets (114-117), 4 JPA relationship entities, 4 DTOs, 4 repositories, EntityMapper extensions, MetaModelRelationshipsDto extension, ModelService save/load/delete-and-replace integration, ArchitectureCloneService Block B append, ArchitectureElementInventoryService extension, frontend types/grids/diagrams/inspector wiring, plus targeted backend round-trip and frontend Vitest config tests.

This is spec 6 of 7 in the Infrastructure delivery sequence and is the largest spec in the series — full-stack across the Spring Boot `architecture-model-service` and the React/TypeScript `frontend`. It adds 4 cross-domain relationships connecting Application/Data to the Infrastructure domain landed by specs 1-5.

**Locked contract from prior specs (do not violate):**
- All locked decisions from specs 1-5 apply.
- Liquibase: changesets `114-` through `117-` only — never edit any applied changeset (per `feedback_liquibase_immutable_changesets.md`).
- Snake_case names everywhere (DB columns, DTO `@JsonProperty`, TypeScript field names, grid `field` keys).
- `confidence DECIMAL(4,3) NULL` with no DB CHECK.
- `description TEXT NOT NULL`, `tags TEXT NOT NULL` on all 4 relationships.
- `environment_id TEXT NULL` on all 4 cross-domain relationships (differs from spec 1's NOT NULL choice on Infra-internal relationships).
- No new cellType — reuse existing `application_point_picker` (Rels 1, 3, 4) and `data_entity_point_picker` (Rel 2).
- Reuse existing `exposureOptions` and `protocolOptions` from spec 4's `defaults.ts` — do NOT redeclare.

**Carry-forward test-failure context (do not investigate during this spec):**
- Pre-existing failures listed in project memory remain.
- Approximately 9 broken `ModelService*Test` files from spec 1 still need the broken-tests staging workaround when running targeted backend tests (move out, run targeted tests, move back).

---

## Task List

### Backend — Database Layer

#### Task Group 1: Liquibase Migrations (Changesets 114-117)
**Dependencies:** None

- [x] 1.0 Author 4 sequential Liquibase changesets and register them in the master changelog
  - [x] 1.1 Write 1 focused `@DataJpaTest` for cross-table FK constraints
    - One test asserting that inserting a row into each of the 4 new tables with a non-existent FK target (e.g. `compute_resource_id` referencing a non-existent `compute_resources(id)`) raises `DataIntegrityViolationException`.
    - Bundle all 4 cross-domain FK assertions into a single test method (or 4 tightly grouped methods) — keep the file small.
    - **File:** `architecture-model-service/src/test/java/com/example/architecturemodel/repository/entity/InfrastructureCrossDomainFkConstraintTest.java`
    - Use the `@DataJpaTest` slice. Total tests in this file: 1-4 max.
  - [x] 1.2 Create changeset `114-application-compute-deployments.sql`
    - Columns: `id TEXT PK`, `model_file_id TEXT NOT NULL → model_files(id) ON DELETE CASCADE`, `application_point_id TEXT NOT NULL → application_points(id)`, `compute_resource_id TEXT NOT NULL → compute_resources(id)`, `deployment_unit_id TEXT NULL → deployment_units(id)`, `environment_id TEXT NULL → environments(id)`, `deployment_role TEXT NULL`, `runtime_name TEXT NULL`, `runtime_version TEXT NULL`, `evidence_source TEXT NULL`, `confidence DECIMAL(4,3) NULL` (no DB CHECK), `description TEXT NOT NULL`, `tags TEXT NOT NULL`.
    - Index: `idx_application_compute_deployments_model_file ON (model_file_id)`.
    - `preConditions: onFail: MARK_RAN` + `not: tableExists` for idempotency.
    - **File:** `architecture-model-service/src/main/resources/db/changelog/sql/114-application-compute-deployments.sql`
  - [x] 1.3 Create changeset `115-data-entity-data-store-hostings.sql`
    - Columns: `id TEXT PK`, `model_file_id TEXT NOT NULL CASCADE`, `data_entity_point_id TEXT NOT NULL → data_entity_points(id)`, `data_store_instance_id TEXT NOT NULL → data_store_instances(id)`, `environment_id TEXT NULL → environments(id)`, `database_name TEXT NULL`, `schema_name TEXT NULL`, `table_or_collection_name TEXT NULL`, `hosting_role TEXT NULL`, `evidence_source TEXT NULL`, `confidence DECIMAL(4,3) NULL`, `description TEXT NOT NULL`, `tags TEXT NOT NULL`.
    - Index on `model_file_id`.
    - **File:** `architecture-model-service/src/main/resources/db/changelog/sql/115-data-entity-data-store-hostings.sql`
  - [x] 1.4 Create changeset `116-application-infrastructure-resource-uses.sql`
    - Columns: `id TEXT PK`, `model_file_id TEXT NOT NULL CASCADE`, `application_point_id TEXT NOT NULL → application_points(id)`, `infrastructure_resource_id TEXT NOT NULL → infrastructure_resources(id)`, `environment_id TEXT NULL → environments(id)`, `dependency_type TEXT NULL`, `protocol TEXT NULL`, `endpoint_or_topic TEXT NULL`, `access_mode TEXT NULL`, `evidence_source TEXT NULL`, `confidence DECIMAL(4,3) NULL`, `description TEXT NOT NULL`, `tags TEXT NOT NULL`.
    - Index on `model_file_id`.
    - **File:** `architecture-model-service/src/main/resources/db/changelog/sql/116-application-infrastructure-resource-uses.sql`
  - [x] 1.5 Create changeset `117-application-load-balancer-exposures.sql`
    - Columns: `id TEXT PK`, `model_file_id TEXT NOT NULL CASCADE`, `application_point_id TEXT NOT NULL → application_points(id)`, `load_balancer_id TEXT NOT NULL → load_balancers(id)`, `listener_id TEXT NULL → listeners(id)`, `environment_id TEXT NULL → environments(id)`, `host_name TEXT NULL`, `path_pattern TEXT NULL`, `protocol TEXT NULL`, `target_port INTEGER NULL`, `exposure TEXT NULL`, `evidence_source TEXT NULL`, `confidence DECIMAL(4,3) NULL`, `description TEXT NOT NULL`, `tags TEXT NOT NULL`.
    - Index on `model_file_id`.
    - **File:** `architecture-model-service/src/main/resources/db/changelog/sql/117-application-load-balancer-exposures.sql`
    - Note: `target_port` is `INTEGER` at the DB level even though grid presents it as numeric-as-text per spec 4 precedent.
  - [x] 1.6 Register all 4 changesets in `db.changelog-master.yaml`
    - Append entries `114-` through `117-` in numeric order, after the existing `113-load-balancer-resource-routes.sql` reference.
    - **File:** `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml`
    - **Critical:** never edit applied changesets (≤ 113); only add new lines.
  - [x] 1.7 Verify Java compiles + targeted tests pass
    - Use the broken-tests staging workaround (move ~9 broken `ModelService*Test` files temporarily out of `src/test/java`) before running.
    - Run `mvn liquibase:update` against a fresh DB and verify all 4 changesets apply cleanly.
    - Run ONLY the test from 1.1.
    - Restore the broken `ModelService*Test` files.
    - Do NOT run the entire backend test suite.

**Acceptance Criteria:**
- The 1-4 tests written in 1.1 pass.
- All 4 changesets apply idempotently against a fresh DB.
- All FK constraints (`application_points`, `compute_resources`, `deployment_units`, `data_entity_points`, `data_store_instances`, `infrastructure_resources`, `load_balancers`, `listeners`, `environments`, `model_files`) are enforced.
- `description` and `tags` are NOT NULL; `environment_id` is NULL on all 4.
- `confidence` is `DECIMAL(4,3)` with no DB CHECK.
- No applied changeset (≤ 113) was modified.

---

### Backend — Persistence Layer

#### Task Group 2: JPA Entity Classes (4 relationship entities)
**Dependencies:** Task Group 1

- [x] 2.0 Create 4 JPA relationship entity classes
  - [x] 2.1 Write 1-2 focused tests for entity field mapping
    - Test that `ApplicationLoadBalancerExposureEntity` round-trips through JPA with optional `listener_id` set and `target_port` as `Integer`.
    - Test that `ApplicationComputeDeploymentEntity` round-trips with `confidence` as `BigDecimal` scale 3 and `description`/`tags` as non-null strings.
    - **File:** `architecture-model-service/src/test/java/com/example/architecturemodel/model/entity/InfrastructureCrossDomainEntityMappingTest.java`
    - Total tests: 1-2 max.
  - [x] 2.2 Create `ApplicationComputeDeploymentEntity`
    - Annotations: `@Entity`, `@Table(name = "application_compute_deployments")`, `@Getter`, `@Setter`, `@NoArgsConstructor`, `@AllArgsConstructor`, `@Builder`.
    - Fields (all `@Column(name = "snake_case")`): `id String`, `modelFileId String`, `applicationPointId String`, `computeResourceId String`, `deploymentUnitId String` (nullable), `environmentId String` (nullable), `deploymentRole String` (nullable), `runtimeName String` (nullable), `runtimeVersion String` (nullable), `evidenceSource String` (nullable), `confidence BigDecimal` (nullable), `description String` (non-null), `tags String` (non-null).
    - All FK fields stored as raw `String` columns matching the spec 2 `DataMovementEntity` pattern.
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/DataEntityDataStoreHostingEntity.java` ... wait — actually:
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/ApplicationComputeDeploymentEntity.java`
    - **Reference:** `DataMovementEntity` for shape; `ResourceSubnetHostingEntity` (spec 2) for the relationship-entity precedent.
  - [x] 2.3 Create `DataEntityDataStoreHostingEntity`
    - Fields: `id`, `modelFileId`, `dataEntityPointId`, `dataStoreInstanceId`, `environmentId` (nullable), `databaseName` (nullable), `schemaName` (nullable), `tableOrCollectionName` (nullable), `hostingRole` (nullable), `evidenceSource` (nullable), `confidence BigDecimal` (nullable), `description` (non-null), `tags` (non-null).
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/DataEntityDataStoreHostingEntity.java`
  - [x] 2.4 Create `ApplicationInfrastructureResourceUseEntity`
    - Fields: `id`, `modelFileId`, `applicationPointId`, `infrastructureResourceId`, `environmentId` (nullable), `dependencyType` (nullable), `protocol` (nullable), `endpointOrTopic` (nullable), `accessMode` (nullable), `evidenceSource` (nullable), `confidence BigDecimal` (nullable), `description` (non-null), `tags` (non-null).
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/ApplicationInfrastructureResourceUseEntity.java`
  - [x] 2.5 Create `ApplicationLoadBalancerExposureEntity`
    - Fields: `id`, `modelFileId`, `applicationPointId`, `loadBalancerId`, `listenerId` (nullable), `environmentId` (nullable), `hostName` (nullable), `pathPattern` (nullable), `protocol` (nullable), `targetPort Integer` (nullable), `exposure` (nullable), `evidenceSource` (nullable), `confidence BigDecimal` (nullable), `description` (non-null), `tags` (non-null).
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/ApplicationLoadBalancerExposureEntity.java`
  - [x] 2.6 Verify Java compiles + targeted tests pass
    - Apply broken-tests staging workaround.
    - Run ONLY the tests from 2.1.
    - Restore broken tests.

**Acceptance Criteria:**
- The 1-2 tests written in 2.1 pass.
- All 4 entity classes compile and persist via Hibernate against the schema from Task Group 1.
- All entities mirror `DataMovementEntity` / spec 2 relationship entity shape.
- `description` and `tags` are non-null `String`; `confidence` is nullable `BigDecimal`; `targetPort` (Rel 4) is nullable `Integer`.

---

#### Task Group 3: DTO Records and Repositories (4 DTOs + 4 repositories)
**Dependencies:** Task Group 2

- [x] 3.0 Create 4 DTO records and 4 Spring Data JPA repositories
  - [x] 3.1 Write 1-2 focused tests for DTO JSON serialisation
    - Test `ApplicationComputeDeploymentDto` round-trips through Jackson with snake_case JSON property names (`application_point_id`, `compute_resource_id`, `deployment_unit_id`, `runtime_name`, `runtime_version`).
    - Test `ApplicationLoadBalancerExposureDto` serialises `target_port` as integer JSON, `confidence` as decimal scale 3, and does NOT include `model_file_id`.
    - **File:** `architecture-model-service/src/test/java/com/example/architecturemodel/model/dto/InfrastructureCrossDomainDtoSerialisationTest.java`
    - Total tests: 1-2 max.
  - [x] 3.2 Create `ApplicationComputeDeploymentDto` (Java record)
    - All fields use `@JsonProperty("snake_case")` matching DB column names exactly.
    - Components: `id String`, `application_point_id`, `compute_resource_id`, `deployment_unit_id`, `environment_id`, `deployment_role`, `runtime_name`, `runtime_version`, `evidence_source`, `confidence BigDecimal`, `description`, `tags`.
    - Do NOT include `model_file_id` (server-side only).
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/relationship/ApplicationComputeDeploymentDto.java`
    - **Reference:** spec 2's `DeploymentUnitComputeResourceDto`.
  - [x] 3.3 Create `DataEntityDataStoreHostingDto` (Java record)
    - Components: `id`, `data_entity_point_id`, `data_store_instance_id`, `environment_id`, `database_name`, `schema_name`, `table_or_collection_name`, `hosting_role`, `evidence_source`, `confidence BigDecimal`, `description`, `tags`.
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/relationship/DataEntityDataStoreHostingDto.java`
  - [x] 3.4 Create `ApplicationInfrastructureResourceUseDto` (Java record)
    - Components: `id`, `application_point_id`, `infrastructure_resource_id`, `environment_id`, `dependency_type`, `protocol`, `endpoint_or_topic`, `access_mode`, `evidence_source`, `confidence BigDecimal`, `description`, `tags`.
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/relationship/ApplicationInfrastructureResourceUseDto.java`
  - [x] 3.5 Create `ApplicationLoadBalancerExposureDto` (Java record)
    - Components: `id`, `application_point_id`, `load_balancer_id`, `listener_id`, `environment_id`, `host_name`, `path_pattern`, `protocol`, `target_port Integer`, `exposure`, `evidence_source`, `confidence BigDecimal`, `description`, `tags`.
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/relationship/ApplicationLoadBalancerExposureDto.java`
  - [x] 3.6 Create 4 Spring Data JPA repositories
    - Each `extends JpaRepository<TEntity, String>`, `@Repository` annotation.
    - Methods: `List<TEntity> findByModelFileId(String modelFileId)`, `void deleteByModelFileId(String modelFileId)`.
    - No additional finders.
    - Files:
      - `architecture-model-service/src/main/java/com/example/architecturemodel/repository/relationship/ApplicationComputeDeploymentRepository.java`
      - `architecture-model-service/src/main/java/com/example/architecturemodel/repository/relationship/DataEntityDataStoreHostingRepository.java`
      - `architecture-model-service/src/main/java/com/example/architecturemodel/repository/relationship/ApplicationInfrastructureResourceUseRepository.java`
      - `architecture-model-service/src/main/java/com/example/architecturemodel/repository/relationship/ApplicationLoadBalancerExposureRepository.java`
  - [x] 3.7 Verify Java compiles + targeted tests pass
    - Apply broken-tests staging workaround.
    - Run ONLY the tests from 3.1.
    - Restore broken tests.

**Acceptance Criteria:**
- The 1-2 tests written in 3.1 pass.
- All 4 DTOs are Java records with `@JsonProperty("snake_case")` on every field.
- No DTO exposes `model_file_id`.
- All 4 repositories provide `findByModelFileId` and `deleteByModelFileId`.

---

### Backend — Service Layer

#### Task Group 4: EntityMapper, MetaModelRelationshipsDto, ModelService, ArchitectureCloneService, ArchitectureElementInventoryService + Round-Trip Test
**Dependencies:** Task Groups 2, 3

- [x] 4.0 Wire the 4 new relationships through the full save/load/delete-and-replace pipeline and clone/inventory services
  - [x] 4.1 Write 1 focused round-trip integration test class
    - One `InfrastructureCrossDomainRelationshipsRoundTripTest.java` covering save/load round-trip + delete-and-replace + projectId/architectureId scoping for all 4 relationships.
    - Bundle into 4-6 tightly-scoped test methods inside the file (one round-trip per relationship + one delete-and-replace + one scoping check).
    - **File:** `architecture-model-service/src/test/java/com/example/architecturemodel/integration/InfrastructureCrossDomainRelationshipsRoundTripTest.java`
    - **Reference:** the spec 2 Infra-internal round-trip test as direct template.
    - Total tests: 4-6 max.
  - [x] 4.2 Extend `EntityMapper` with 4 new bidirectional arms
    - Append `toDto(ApplicationComputeDeploymentEntity)` and `toEntity(ApplicationComputeDeploymentDto, modelFileId)`.
    - Append `toDto(DataEntityDataStoreHostingEntity)` and `toEntity(DataEntityDataStoreHostingDto, modelFileId)`.
    - Append `toDto(ApplicationInfrastructureResourceUseEntity)` and `toEntity(ApplicationInfrastructureResourceUseDto, modelFileId)`.
    - Append `toDto(ApplicationLoadBalancerExposureEntity)` and `toEntity(ApplicationLoadBalancerExposureDto, modelFileId)`.
    - Each `toEntity` accepts `modelFileId` as a parameter and sets it server-side; each `toDto` strips `modelFileId`.
    - **Reference:** the spec 2 arms for `resource_subnet_hostings`, `deployment_unit_compute_resources`, `load_balancer_resource_routes`.
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/mapper/EntityMapper.java` (or inline in `ModelService` if existing convention is inline for relationships)
  - [x] 4.3 Extend `MetaModelRelationshipsDto`
    - Append 4 new `List<...Dto>` fields with `@JsonProperty` snake_case names matching the table names: `application_compute_deployments`, `data_entity_data_store_hostings`, `application_infrastructure_resource_uses`, `application_load_balancer_exposures`.
    - Each list defaults to empty (not null) on serialisation.
    - Append at the end (after the spec 2 entries) — do not reorder existing fields.
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/MetaModelRelationshipsDto.java`
  - [x] 4.4 Extend `ModelService.saveRelationships(...)`, `loadModelByFileId(...)`, `deleteAllDataForModelFile(...)`
    - Inject the 4 new repositories via constructor parameters / fields, matching existing style.
    - **Save:** append 4 arms that map each DTO → entity (setting `modelFileId`) → `saveAll`.
    - **Load:** append 4 arms calling `findByModelFileId(modelFileId)` and assigning the mapped DTO list to the corresponding `MetaModelRelationshipsDto` field.
    - **Delete-and-replace:** append 4 `deleteByModelFileId(modelFileId)` calls. Order: cross-domain relationships are deleted **before** the entity tables they reference (Application/Data and Infrastructure entity tables), so they go at the **start** of the relationship-deletion block (before the spec 2 Infra-internal relationships) — verify against existing convention.
    - Pattern strictly mirrors the 3 spec 2 Infra-internal relationship arms.
    - Existing Business / Application / Data / Behavioural / UI / Infrastructure-V1 behaviour remains unchanged (additive only).
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/service/ModelService.java`
  - [x] 4.5 Extend `ArchitectureCloneService.IN_SCOPE_TABLES_IN_ORDER`
    - Append the 4 new table names to **Block B (DEPENDENT)** at the **end**, after the 3 spec 2 Infra-internal relationship tables AND after the Application/Data tables they reference.
    - Order: `application_compute_deployments`, `data_entity_data_store_hostings`, `application_infrastructure_resource_uses`, `application_load_balancer_exposures`.
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/service/ArchitectureCloneService.java`
  - [x] 4.6 Extend `ArchitectureElementInventoryService`
    - Extend `TABLES_BY_DOMAIN.Infrastructure` with the 4 new relationship table names (cross-domain relationships sit once under Infrastructure here; per-domain visibility is derivation-based via `getRelationshipsForDomain`).
    - Extend `DISPLAY_NAME_FALLBACK_TABLES` with all 4 (none of the 4 has a `name` column).
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/service/ArchitectureElementInventoryService.java`
  - [x] 4.7 Verify Java compiles + targeted tests pass
    - Apply broken-tests staging workaround (move ~9 broken `ModelService*Test` files temporarily out of `src/test/java`).
    - Run ONLY the round-trip test class from 4.1 plus the targeted tests from 1.1, 2.1, 3.1.
    - Total expected: ~7-14 tests.
    - Restore broken tests.
    - Do NOT run the entire backend test suite.

**Acceptance Criteria:**
- The 4-6 tests in 4.1 pass plus all earlier targeted tests still pass.
- DTO ↔ Entity mapping preserves every spec'd field with no loss.
- `MetaModelRelationshipsDto` exposes 4 new lists with correct snake_case JSON names; existing 3 spec 2 lists unchanged.
- `ModelService` save/load/delete-and-replace correctly persists, retrieves, and clears the 4 new relationships scoped by `projectId` + `architectureId`.
- `ArchitectureCloneService.IN_SCOPE_TABLES_IN_ORDER` Block B includes the 4 new tables at the end in the documented order.
- `ArchitectureElementInventoryService` lists all 4 new tables under Infrastructure and in `DISPLAY_NAME_FALLBACK_TABLES`.
- Existing Business / Application / Data / Behavioural / UI / Infrastructure-V1 behaviour is regression-safe.

---

### Frontend — Types and Configuration

#### Task Group 5: Frontend Types, Defaults, Relationship Definitions, Domain Mappings, Serialisation Backfill
**Dependencies:** Task Group 4 (logical — frontend can run in parallel with backend service-layer work, but contract must be agreed)

- [x] 5.0 Extend frontend types, RELATIONSHIP_DEFINITIONS, DOMAIN_TO_RELATIONSHIP_TYPES, defaults, and modelSerialization
  - [x] 5.1 No targeted tests in this group — verification is via Vitest config test in Task Group 8 plus `npx tsc --noEmit`.
  - [x] 5.2 Extend `frontend/src/types/model.ts`
    - Add 4 new TypeScript interfaces (PascalCase, snake_case fields):
      - `ApplicationComputeDeployment`: `id: string`, `application_point_id: string`, `compute_resource_id: string`, `deployment_unit_id?: string`, `environment_id?: string`, `deployment_role?: string`, `runtime_name?: string`, `runtime_version?: string`, `evidence_source?: string`, `confidence?: number`, `description: string`, `tags: string`.
      - `DataEntityDataStoreHosting`: `id`, `data_entity_point_id`, `data_store_instance_id`, `environment_id?`, `database_name?`, `schema_name?`, `table_or_collection_name?`, `hosting_role?`, `evidence_source?`, `confidence?`, `description`, `tags`.
      - `ApplicationInfrastructureResourceUse`: `id`, `application_point_id`, `infrastructure_resource_id`, `environment_id?`, `dependency_type?`, `protocol?`, `endpoint_or_topic?`, `access_mode?`, `evidence_source?`, `confidence?`, `description`, `tags`.
      - `ApplicationLoadBalancerExposure`: `id`, `application_point_id`, `load_balancer_id`, `listener_id?`, `environment_id?`, `host_name?`, `path_pattern?`, `protocol?`, `target_port?: number`, `exposure?`, `evidence_source?`, `confidence?`, `description`, `tags`.
    - Extend `MetaModelRelationships` with 4 new array fields (snake_case names matching the table names): `application_compute_deployments: ApplicationComputeDeployment[]`, `data_entity_data_store_hostings: DataEntityDataStoreHosting[]`, `application_infrastructure_resource_uses: ApplicationInfrastructureResourceUse[]`, `application_load_balancer_exposures: ApplicationLoadBalancerExposure[]`.
    - Extend `RelationshipType` and `AnyRelationship` unions with 4 new entries (one per relationship).
    - Add 4 new `RELATIONSHIP_EDGE_TYPES` constants: `APPLICATION_COMPUTE_DEPLOYMENT`, `DATA_ENTITY_DATA_STORE_HOSTING`, `APPLICATION_INFRASTRUCTURE_RESOURCE_USE`, `APPLICATION_LOAD_BALANCER_EXPOSURE`.
    - **File:** `frontend/src/types/model.ts`
  - [x] 5.3 Extend `frontend/src/config/relationshipDefinitions.ts`
    - Append 4 new `RELATIONSHIP_DEFINITIONS` entries with `endpointEntityTypes` mixing the source-side Application/Data entity types with the target-side Infrastructure entity types per relationship:
      - Rel 1: `application` + `compute_resource` (+ optional `deployment_unit`).
      - Rel 2: `data_entity` + `data_store_instance`.
      - Rel 3: `application` + `infrastructure_resource`.
      - Rel 4: `application` + `load_balancer` (+ optional `listener`).
    - Tab labels: `"App ↔ Compute"`, `"Data Entity ↔ Data Store"`, `"App ↔ Infrastructure Resource"`, `"App ↔ Load Balancer"`.
    - Append the 4 new tab labels to `RELATIONSHIP_TAB_ORDER` after the spec 3 entries (`Resource ↔ Subnet`, `Deployment Unit ↔ Compute`, `Load Balancer Routes`), in the order above.
    - **File:** `frontend/src/config/relationshipDefinitions.ts`
  - [x] 5.4 Extend `frontend/src/utils/contextPickerDomainMappings.ts`
    - Update `DOMAIN_TO_RELATIONSHIP_TYPES`:
      - `application`: append Rels 1, 3, 4.
      - `data`: append Rel 2.
      - `infrastructure`: append all 4.
    - Do NOT extend `behavioural` or `ui` (deferred to spec 7 per Q12).
    - **File:** `frontend/src/utils/contextPickerDomainMappings.ts`
  - [x] 5.5 Extend `frontend/src/config/defaults.ts`
    - Add 4 new picklist option arrays:
      ```ts
      export const deploymentRoleOptions = ['PRIMARY','SECONDARY','WORKER','BATCH','ADMIN','OTHER'];
      export const hostingRoleOptions = ['PRIMARY','REPLICA','CACHE','ARCHIVE','ANALYTICS','OTHER'];
      export const dependencyTypeOptions = ['READS_FROM','WRITES_TO','PUBLISHES_TO','SUBSCRIBES_TO','USES','STORES_IN','RETRIEVES_FROM','OTHER'];
      export const accessModeOptions = ['READ','WRITE','READ_WRITE','EXECUTE','ADMIN','OTHER'];
      ```
    - **Reuse** existing `exposureOptions` and `protocolOptions` from spec 4 — do NOT redeclare.
    - Append 4 new `[]` fields to `emptyModel.relationships`: one per new relationship array.
    - **File:** `frontend/src/config/defaults.ts`
  - [x] 5.6 Extend `frontend/src/api/modelSerialization.ts`
    - Append 4 `??=` lines in `normalizeModelFromApi`, one per new relationship array, so older saved models without these arrays load as `[]`.
    - **File:** `frontend/src/api/modelSerialization.ts`
  - [x] 5.7 Verify TypeScript compiles
    - Run `npx tsc --noEmit` from `frontend/`.
    - Verify zero TypeScript errors introduced.
    - Do NOT run Vitest yet (full sweep happens in Task Group 8).

**Acceptance Criteria:**
- 4 new TypeScript interfaces compile with correct snake_case fields.
- `MetaModelRelationships`, `RelationshipType`, and `AnyRelationship` unions extended with 4 new entries.
- 4 new `RELATIONSHIP_EDGE_TYPES` constants exported.
- 4 new `RELATIONSHIP_DEFINITIONS` entries wired with correct `endpointEntityTypes`.
- `RELATIONSHIP_TAB_ORDER` includes the 4 new tabs after spec 3 entries.
- `DOMAIN_TO_RELATIONSHIP_TYPES.application` / `.data` / `.infrastructure` extended; `behavioural` / `ui` untouched.
- 4 new picklist arrays exported from `defaults.ts`; `exposureOptions` / `protocolOptions` not redeclared.
- `emptyModel.relationships` has 4 new `[]` fields.
- `normalizeModelFromApi` has 4 new `??=` backfill lines.
- `npx tsc --noEmit` reports zero new errors.

---

### Frontend — Tables UI

#### Task Group 6: Grid Configurations
**Dependencies:** Task Group 5

- [x] 6.0 Append 4 new grid configs to `gridConfigs.ts` and update tab maps
  - [x] 6.1 No targeted tests in this group — verification is via Vitest config test in Task Group 8 plus `npx tsc --noEmit`.
  - [x] 6.2 Append grid config for `application_compute_deployments`
    - Columns:
      - `application_point_id` cellType `'application_point_picker'`, required.
      - `compute_resource_id` cellType `'fk_typeahead'`, fkTarget `'compute_resources'`, required.
      - `deployment_unit_id` cellType `'fk_typeahead'`, fkTarget `'deployment_units'`, optional.
      - `environment_id` cellType `'fk_typeahead'`, fkTarget `'environments'`, optional.
      - `deployment_role` cellType `'dropdown'`, options `deploymentRoleOptions`, optional.
      - `runtime_name` cellType `'text'`.
      - `runtime_version` cellType `'text'`.
      - `evidence_source` cellType `'text'`.
      - `confidence` cellType `'text'` (numeric-as-text per spec 4 precedent).
      - `description` cellType `'text'`.
      - `tags` cellType `'tags'`.
    - **File:** `frontend/src/config/gridConfigs.ts`
  - [x] 6.3 Append grid config for `data_entity_data_store_hostings`
    - Columns: `data_entity_point_id` cellType `'data_entity_point_picker'` required, `data_store_instance_id` `fk_typeahead`/`data_store_instances` required, `environment_id` `fk_typeahead`/`environments` optional, `database_name` text, `schema_name` text, `table_or_collection_name` text, `hosting_role` dropdown `hostingRoleOptions`, `evidence_source` text, `confidence` text, `description` text, `tags` tags.
    - **File:** `frontend/src/config/gridConfigs.ts`
  - [x] 6.4 Append grid config for `application_infrastructure_resource_uses`
    - Columns: `application_point_id` `application_point_picker` required, `infrastructure_resource_id` `fk_typeahead`/`infrastructure_resources` required, `environment_id` `fk_typeahead`/`environments` optional, `dependency_type` dropdown `dependencyTypeOptions`, `protocol` dropdown `protocolOptions` (reused), `endpoint_or_topic` text, `access_mode` dropdown `accessModeOptions`, `evidence_source` text, `confidence` text, `description` text, `tags` tags.
    - **File:** `frontend/src/config/gridConfigs.ts`
  - [x] 6.5 Append grid config for `application_load_balancer_exposures`
    - Columns: `application_point_id` `application_point_picker` required, `load_balancer_id` `fk_typeahead`/`load_balancers` required, `listener_id` `fk_typeahead`/`listeners` optional, `environment_id` `fk_typeahead`/`environments` optional, `host_name` text, `path_pattern` text, `protocol` dropdown `protocolOptions` (reused), `target_port` text (numeric-as-text), `exposure` dropdown `exposureOptions` (reused), `evidence_source` text, `confidence` text, `description` text, `tags` tags.
    - **File:** `frontend/src/config/gridConfigs.ts`
  - [x] 6.6 Append 4 entries to `relationshipTabToType` and `relationshipTabNames`
    - `relationshipTabToType`: `'App ↔ Compute' → 'application_compute_deployments'`, `'Data Entity ↔ Data Store' → 'data_entity_data_store_hostings'`, `'App ↔ Infrastructure Resource' → 'application_infrastructure_resource_uses'`, `'App ↔ Load Balancer' → 'application_load_balancer_exposures'`.
    - `relationshipTabNames`: append the 4 same labels.
    - **File:** `frontend/src/config/gridConfigs.ts`
  - [x] 6.7 Verify TypeScript compiles
    - Run `npx tsc --noEmit` from `frontend/`.
    - Verify zero TypeScript errors introduced.

**Acceptance Criteria:**
- 4 new grid configs compile with the column shapes above.
- All required-field columns (per-relationship source + primary target) marked `required: true`.
- Reuse only existing cellTypes (`application_point_picker`, `data_entity_point_picker`, `fk_typeahead`, `dropdown`, `text`, `tags`) — no new cellType.
- `relationshipTabToType` and `relationshipTabNames` each have 4 new entries with the documented labels.
- `npx tsc --noEmit` reports zero new errors.

---

### Frontend — Diagram Support

#### Task Group 7: Palette, Edge Creation, Edge Defaults, SelectionInspector
**Dependencies:** Task Groups 5, 6

- [x] 7.0 Wire the 4 cross-domain relationships into the diagram palette, edge utils, edge defaults, and selection inspector
  - [x] 7.1 No targeted tests in this group — verification is via Vitest config test in Task Group 8 plus `npx tsc --noEmit`.
  - [x] 7.2 Extend `frontend/src/utils/paletteData.ts`
    - Append 4 new `relationshipSections` entries (one per relationship), each referencing the matching `RELATIONSHIP_EDGE_TYPES` constant and a tab label.
    - Extend `DIAGRAM_TYPE_PALETTE_RULES`:
      - Infrastructure diagrams: include all 4 cross-domain relationships.
      - Application diagrams: include Rels 1, 3, 4.
      - Data diagrams: include Rel 2.
    - `domainToPaletteSections.application` / `.data` / `.infrastructure` updated through the existing derivation (no manual restructuring).
    - **File:** `frontend/src/utils/paletteData.ts`
  - [x] 7.3 Extend `frontend/src/utils/relationshipUtils.ts`
    - Append 4 new arms to `createRelationshipEdge`, one per relationship, each producing a solid + arrow edge with the documented default labels:
      - Rel 1 (`APPLICATION_COMPUTE_DEPLOYMENT`): label = `deployment_role` (e.g. `"PRIMARY"`).
      - Rel 2 (`DATA_ENTITY_DATA_STORE_HOSTING`): label = `hosting_role` (e.g. `"REPLICA"`).
      - Rel 3 (`APPLICATION_INFRASTRUCTURE_RESOURCE_USE`): label = `dependency_type` (fall back to `access_mode` if `dependency_type` unset; e.g. `"READS_FROM"`).
      - Rel 4 (`APPLICATION_LOAD_BALANCER_EXPOSURE`): label = `protocol target_port` (e.g. `"HTTPS 443"`; falls back gracefully when either is unset).
    - Append 4 new arms to `getRelationshipEligibility` validating that both endpoints exist on the active canvas before allowing an edge (resolve via existing `applicationPointsOnDiagram` / `dataEntityPointsOnDiagram` / `infrastructurePointsOnDiagram` Sets and concrete-target Sets).
    - **File:** `frontend/src/utils/relationshipUtils.ts`
  - [x] 7.4 Extend `frontend/src/utils/rendering.ts`
    - Append 4 new `getRelationshipEdgeDefaults` arms keyed by the 4 new `RELATIONSHIP_EDGE_TYPES` constants.
    - Each arm provides a distinct stroke colour (and dash pattern where appropriate) so the four cross-domain edges are visually distinguishable from each other and from the spec 5 Infra-internal edges.
    - **File:** `frontend/src/utils/rendering.ts`
  - [x] 7.5 Extend `frontend/src/components/SelectionInspector/SelectionInspector.tsx`
    - Append 4 new minimal V1 edge arms (one per relationship) exposing `description` + `tags` only.
    - Mirrors spec 5's minimum. Full attribute editing remains via the relationship grid tabs.
    - **File:** `frontend/src/components/SelectionInspector/SelectionInspector.tsx`
  - [x] 7.6 Verify TypeScript compiles
    - Run `npx tsc --noEmit` from `frontend/`.
    - Verify zero TypeScript errors introduced.

**Acceptance Criteria:**
- 4 new palette sections appear under Infrastructure diagrams (all 4), Application diagrams (Rels 1, 3, 4), and Data diagrams (Rel 2).
- 4 new `createRelationshipEdge` arms produce edges with the documented default labels and solid-arrow style.
- 4 new `getRelationshipEligibility` arms correctly gate edge creation by canvas-presence of both endpoints.
- 4 new `getRelationshipEdgeDefaults` arms produce visually distinct edges (distinct stroke colour and/or dash).
- 4 new `SelectionInspector` arms expose `description` + `tags` only.
- `npx tsc --noEmit` reports zero new errors.

---

### Verification

#### Task Group 8: Frontend Vitest Config Test + Full Verification Sweep
**Dependencies:** Task Groups 1-7

- [x] 8.0 Verify the full feature end-to-end via one focused Vitest config test plus a full Vitest sweep with net-new-failures = 0
  - [x] 8.1 Review existing tests from Task Groups 1-7
    - Backend: 1.1 (1-4 tests), 2.1 (1-2 tests), 3.1 (1-2 tests), 4.1 (4-6 tests). Backend total: ~7-14 tests.
    - Frontend: no targeted tests in Task Groups 5-7 (verification deferred to this group).
    - Total existing tests so far: ~7-14 backend tests + 0 frontend tests.
  - [x] 8.2 Analyse test coverage gaps for THIS feature only
    - Backend round-trip is already covered by 4.1; no additional backend test needed.
    - Frontend has no targeted test yet — gap is the Vitest config test asserting all wiring is present.
    - Do NOT assess entire-app coverage; focus only on this spec's surface.
  - [x] 8.3 Write the frontend Vitest config test (1 file, up to 4-6 grouped assertions)
    - **File:** `frontend/src/config/__tests__/infrastructureCrossDomainConfig.test.ts`
    - Assertions:
      1. 4 new `gridConfigs` entries exist with correct keys, and each has its required-field columns (`application_point_id` / `data_entity_point_id` source-side required, primary target FK column required).
      2. 4 new `RELATIONSHIP_DEFINITIONS` entries are wired with correct tab labels and `endpointEntityTypes` per Task Group 5.
      3. 4 new keys exist in `relationshipTabToType` mapping to the 4 table names; 4 new entries appended to `RELATIONSHIP_TAB_ORDER` in the documented order.
      4. `DOMAIN_TO_RELATIONSHIP_TYPES.application` includes Rels 1, 3, 4; `.data` includes Rel 2; `.infrastructure` includes all 4; `.behavioural` and `.ui` are NOT extended.
    - Bundle into 4-6 tightly-scoped test cases. Total tests in this file: 4-6 max.
  - [x] 8.4 Run targeted verification sweep
    - **Backend:** apply broken-tests staging workaround. Run ONLY the targeted tests from 1.1, 2.1, 3.1, 4.1. Restore broken tests.
    - **Frontend:** run `npx tsc --noEmit` from `frontend/`. Run the new Vitest test from 8.3 in isolation first to verify it passes.
    - **Frontend full sweep:** run the entire Vitest suite. Confirm net new failures = 0 (compare against pre-existing failures captured in project memory).
    - Expected total feature-specific tests: backend ~7-14 + frontend ~4-6 = ~11-20.

**Acceptance Criteria:**
- The 4-6 tests in 8.3 pass.
- All earlier targeted backend tests (Task Groups 1-4) still pass.
- `npx tsc --noEmit` from `frontend/` reports zero errors.
- Full Vitest sweep on `frontend/` shows net new failures = 0 (only previously-known pre-existing failures remain).
- No more than 6 additional Vitest tests added in this group.
- Testing focused exclusively on this spec's feature requirements; no broader application test-coverage work attempted.

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Liquibase Migrations (114-117)** — schema first; everything else depends on these tables existing.
2. **Task Group 2: JPA Entity Classes** — maps the 4 new tables into Java; required by repositories and mappers.
3. **Task Group 3: DTO Records and Repositories** — DTOs are independent of repositories but easier to author together; both depend on Task Group 2.
4. **Task Group 4: EntityMapper, MetaModelRelationshipsDto, ModelService, ArchitectureCloneService, ArchitectureElementInventoryService + Round-Trip Test** — wires the 4 relationships through the full backend pipeline; depends on Task Groups 2 and 3.
5. **Task Group 5: Frontend Types, Defaults, Relationship Definitions, Domain Mappings, Serialisation Backfill** — frontend type-system foundation; can run in parallel with Task Group 4 once the contract is locked.
6. **Task Group 6: Grid Configurations** — depends on Task Group 5 (types and picklist arrays).
7. **Task Group 7: Palette, Edge Creation, Edge Defaults, SelectionInspector** — depends on Task Groups 5 and 6 (uses `RELATIONSHIP_EDGE_TYPES` constants and grid-config field shapes).
8. **Task Group 8: Frontend Vitest Config Test + Full Verification Sweep** — depends on all previous groups; closes out the spec with `tsc --noEmit`, the Vitest config test, and the full-sweep net-new-failures check.

---

## File Summary

### Backend Files to Create (10)

**Liquibase changesets (4):**
- `architecture-model-service/src/main/resources/db/changelog/sql/114-application-compute-deployments.sql`
- `architecture-model-service/src/main/resources/db/changelog/sql/115-data-entity-data-store-hostings.sql`
- `architecture-model-service/src/main/resources/db/changelog/sql/116-application-infrastructure-resource-uses.sql`
- `architecture-model-service/src/main/resources/db/changelog/sql/117-application-load-balancer-exposures.sql`

**JPA entities (4):**
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/ApplicationComputeDeploymentEntity.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/DataEntityDataStoreHostingEntity.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/ApplicationInfrastructureResourceUseEntity.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/ApplicationLoadBalancerExposureEntity.java`

**DTOs (4):**
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/relationship/ApplicationComputeDeploymentDto.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/relationship/DataEntityDataStoreHostingDto.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/relationship/ApplicationInfrastructureResourceUseDto.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/relationship/ApplicationLoadBalancerExposureDto.java`

**Repositories (4):**
- `architecture-model-service/src/main/java/com/example/architecturemodel/repository/relationship/ApplicationComputeDeploymentRepository.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/repository/relationship/DataEntityDataStoreHostingRepository.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/repository/relationship/ApplicationInfrastructureResourceUseRepository.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/repository/relationship/ApplicationLoadBalancerExposureRepository.java`

### Backend Files to Modify (5)
- `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml` (register 4 new changesets)
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/MetaModelRelationshipsDto.java` (append 4 new lists)
- `architecture-model-service/src/main/java/com/example/architecturemodel/mapper/EntityMapper.java` (append 4 toDto + 4 toEntity arms)
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/ModelService.java` (inject 4 repos; append save / load / delete-and-replace arms)
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/ArchitectureCloneService.java` (append 4 table names to Block B)
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/ArchitectureElementInventoryService.java` (extend `TABLES_BY_DOMAIN.Infrastructure` and `DISPLAY_NAME_FALLBACK_TABLES`)

### Backend Test Files to Create (4)
- `architecture-model-service/src/test/java/com/example/architecturemodel/repository/entity/InfrastructureCrossDomainFkConstraintTest.java`
- `architecture-model-service/src/test/java/com/example/architecturemodel/model/entity/InfrastructureCrossDomainEntityMappingTest.java`
- `architecture-model-service/src/test/java/com/example/architecturemodel/model/dto/InfrastructureCrossDomainDtoSerialisationTest.java`
- `architecture-model-service/src/test/java/com/example/architecturemodel/integration/InfrastructureCrossDomainRelationshipsRoundTripTest.java`

### Frontend Files to Modify (10)
- `frontend/src/types/model.ts` (4 new interfaces; extend `MetaModelRelationships`, `RelationshipType`, `AnyRelationship`; 4 new `RELATIONSHIP_EDGE_TYPES`)
- `frontend/src/config/relationshipDefinitions.ts` (append 4 `RELATIONSHIP_DEFINITIONS`; append 4 `RELATIONSHIP_TAB_ORDER`)
- `frontend/src/utils/contextPickerDomainMappings.ts` (extend `DOMAIN_TO_RELATIONSHIP_TYPES.application`, `.data`, `.infrastructure`)
- `frontend/src/config/defaults.ts` (4 new picklist arrays; 4 new `[]` in `emptyModel.relationships`)
- `frontend/src/api/modelSerialization.ts` (4 new `??=` backfill lines)
- `frontend/src/config/gridConfigs.ts` (4 new grid configs; 4 new `relationshipTabToType` keys; 4 new `relationshipTabNames`)
- `frontend/src/utils/paletteData.ts` (4 new `relationshipSections`; updated `DIAGRAM_TYPE_PALETTE_RULES`)
- `frontend/src/utils/relationshipUtils.ts` (4 new `createRelationshipEdge` arms; 4 new `getRelationshipEligibility` arms)
- `frontend/src/utils/rendering.ts` (4 new `getRelationshipEdgeDefaults` arms)
- `frontend/src/components/SelectionInspector/SelectionInspector.tsx` (4 new minimal edge arms)

### Frontend Test Files to Create (1)
- `frontend/src/config/__tests__/infrastructureCrossDomainConfig.test.ts`

---

## Reference Patterns

### Existing Code to Follow
- **Spec 2 Infra-internal relationship backend** — direct template for the entire Backend stack: changeset shape, JPA entity, DTO record, repository, EntityMapper arm, MetaModelRelationshipsDto field, ModelService save/load/delete-and-replace arm, ArchitectureCloneService Block B append.
  - `architecture-model-service/src/main/resources/db/changelog/sql/111-resource-subnet-hostings.sql`
  - `architecture-model-service/src/main/resources/db/changelog/sql/112-deployment-unit-compute-resources.sql`
  - `architecture-model-service/src/main/resources/db/changelog/sql/113-load-balancer-resource-routes.sql`
  - The 3 corresponding JPA entities, DTOs, repositories.
- **Spec 4 grid configs for the 3 Infra-internal relationships** — direct template for the 4 new grid configs in `frontend/src/config/gridConfigs.ts`.
- **Spec 5 frontend diagram wiring** — direct template for palette, edge utils, edge defaults, and SelectionInspector arms.
  - `frontend/src/utils/paletteData.ts`
  - `frontend/src/utils/relationshipUtils.ts`
  - `frontend/src/utils/rendering.ts`
  - `frontend/src/components/SelectionInspector/SelectionInspector.tsx`
- **Existing `ApplicationPointEntity`** (hybrid `target_type`/`target_ref_id`) — reused unchanged for Rels 1, 3, 4.
- **Existing `DataEntityPointEntity`** (typed-FK + discriminator) — reused unchanged for Rel 2.
- **Existing `application_point_picker` and `data_entity_point_picker` cellTypes** — reused without modification; no new cellType.
- **Existing `exposureOptions` and `protocolOptions` in `frontend/src/config/defaults.ts`** — reused verbatim; do NOT redeclare.

### Key Decisions to Honour (Locked Contract)
- **Q1**: 4 relationship table names + tab labels are locked: `application_compute_deployments` / "App ↔ Compute", `data_entity_data_store_hostings` / "Data Entity ↔ Data Store", `application_infrastructure_resource_uses` / "App ↔ Infrastructure Resource", `application_load_balancer_exposures` / "App ↔ Load Balancer".
- **Q2**: Rel 4 endpoint shape is `load_balancer_id NOT NULL` + `listener_id NULL` (NOT polymorphic, NOT both-nullable).
- **Q3**: Rels 1, 3, 4 use `application_point_id NOT NULL`; Rel 2 uses `data_entity_point_id NOT NULL`. No new point types.
- **Q4**: Infra-side targets are concrete FKs only (no `InfrastructurePoint` polymorphic picker for cross-domain relationships).
- **Q5**: `description` + `tags` envelope only — no `notes` column. `description NOT NULL`, `tags NOT NULL`.
- **Q6**: 4 new picklist arrays defined verbatim. Reuse `exposureOptions` and `protocolOptions` from spec 4.
- **Q7**: `environment_id` is **NULL** on all 4 cross-domain relationships (differs from spec 1's NOT NULL on Infra-internal relationships).
- **Q8**: Palette extension lands in this spec — Infrastructure diagrams get all 4, Application diagrams get Rels 1/3/4, Data diagrams get Rel 2.
- **Q9**: Distinct edge styles per relationship + documented default edge labels (Rel 1 → `deployment_role`; Rel 2 → `hosting_role`; Rel 3 → `dependency_type` with `access_mode` fallback; Rel 4 → `protocol target_port`).
- **Q10**: SelectionInspector V1 minimum — `description` + `tags` only.
- **Q11**: Test scope locked — one backend round-trip test class + one frontend Vitest config test. No renderer / component / picker-cell / diagram-interaction tests.
- **Q12**: Behavioural and UI domain extensions are deferred to spec 7. Do NOT extend `DOMAIN_TO_RELATIONSHIP_TYPES.behavioural` or `.ui`.
- **Liquibase ordering**: never edit applied changesets (≤ 113); only add new files numbered 114-117.
- **Snake_case everywhere** — DB columns, DTO `@JsonProperty`, TypeScript interface fields, grid `field` keys all use snake_case matching DB column names exactly.
- **`confidence DECIMAL(4,3) NULL`** — no DB CHECK, no JPA validation.
- **Carry-forward test failures** — pre-existing failures and ~9 broken `ModelService*Test` files persist. Use the broken-tests staging workaround when running targeted backend tests; do not investigate during this spec.
