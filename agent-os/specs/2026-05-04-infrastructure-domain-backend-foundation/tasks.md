# Task Breakdown: Infrastructure Domain Backend Foundation

## Overview
Total Tasks: 8 task groups covering 16 Liquibase changesets, 13 JPA entities, 3 relationship entities, 16 DTOs, 16 repositories, EntityMapper extensions, MetaModel DTO extensions, ModelService integration, and tests.

This spec adds a sixth Architecture domain (Infrastructure) to the Spring Boot `architecture-model-service`, comprising 12 new entities, a polymorphic `InfrastructurePoint` supertype (modelled after `DataEntityPointEntity`), and 3 new relationships, all wired through the existing save/load/delete-and-replace pipeline.

This is a backend-only spec — no frontend, gateway, MCP, discovery, or Terraform changes. Visual assets are intentionally absent.

## Task List

### Database Layer

#### Task Group 1: Liquibase Migrations (Changesets 098–113)
**Dependencies:** None

- [x] 1.0 Author 16 sequential Liquibase changesets and register them in the master changelog
  - [x] 1.1 Write 2-4 focused tests for the polymorphic CHECK constraint and partial unique indexes
    - Test that an `infrastructure_points` row with zero typed FKs set is rejected (constraint violation).
    - Test that an `infrastructure_points` row with two typed FKs set is rejected.
    - Test that an `infrastructure_points` row whose `point_kind` mismatches the set FK (e.g. `point_kind='COMPUTE_RESOURCE'` but `compute_cluster_id` is set) is rejected.
    - Test that a partial unique index rejects a duplicate `(model_file_id, compute_resource_id)` pair while allowing duplicate NULLs.
    - **File:** `architecture-model-service/src/test/java/com/example/architecturemodel/repository/entity/InfrastructurePointConstraintTest.java`
    - Use the existing `@DataJpaTest` test slice; assert `DataIntegrityViolationException` / `ConstraintViolationException` propagation.
  - [x] 1.2 Create changeset `098-environments.sql`
    - Columns: `id TEXT PK`, `model_file_id TEXT NOT NULL → model_files(id) ON DELETE CASCADE`, `name TEXT NOT NULL`, `description TEXT NULL`, `tags TEXT NULL`, `valid_from TEXT NULL`, `valid_to TEXT NULL`, `environment_type TEXT`, `lifecycle_state TEXT`, `is_current_state BOOLEAN`, `is_target_state BOOLEAN`, `owner TEXT NULL`, `criticality TEXT NULL`.
    - Index: `idx_environments_model_file ON (model_file_id)`.
    - `preConditions: onFail: MARK_RAN` + `not: tableExists` for idempotency.
    - **File:** `architecture-model-service/src/main/resources/db/changelog/sql/098-environments.sql`
  - [x] 1.3 Create changeset `099-cloud-accounts.sql`
    - Standard envelope + `environment_id TEXT NOT NULL → environments(id)`, `provider TEXT`, `external_account_id TEXT NULL`, `parent_org_id TEXT NULL`, `billing_owner TEXT NULL`, `technical_owner TEXT NULL`, `landing_zone_name TEXT NULL`.
    - Index on `model_file_id`.
    - **File:** `architecture-model-service/src/main/resources/db/changelog/sql/099-cloud-accounts.sql`
  - [x] 1.4 Create changeset `100-locations.sql`
    - Standard envelope + `environment_id` (NOT NULL FK), `cloud_account_id` (NULL FK), `location_type`, `provider`, `provider_region_code`, `provider_zone_code`, `country`, `city`, `address`.
    - Index on `model_file_id`.
    - **File:** `architecture-model-service/src/main/resources/db/changelog/sql/100-locations.sql`
  - [x] 1.5 Create changeset `101-networks.sql`
    - Standard envelope + `environment_id` (NOT NULL FK), `cloud_account_id` (NULL FK), `location_id` (NULL FK), `network_type`, `provider`, `cidr`, `external_id`, `is_shared BOOLEAN`, `routing_mode`.
    - Index on `model_file_id`.
    - **File:** `architecture-model-service/src/main/resources/db/changelog/sql/101-networks.sql`
  - [x] 1.6 Create changeset `102-subnets.sql`
    - Standard envelope + `environment_id` (NOT NULL FK), `network_id` (NOT NULL FK), `location_id` (NULL FK), `cidr`, `subnet_type`, `visibility`, `provider_region_code`, `provider_zone_code`, `external_id`, `gateway_address`.
    - Index on `model_file_id`.
    - **File:** `architecture-model-service/src/main/resources/db/changelog/sql/102-subnets.sql`
  - [x] 1.7 Create changeset `103-compute-clusters.sql`
    - Standard envelope + `environment_id` (NOT NULL FK), `cloud_account_id` (NULL FK), `location_id` (NULL FK), `network_id` (NULL FK), `platform_type`, `provider`, `version`, `external_id`, `owner`, `operating_model`.
    - Index on `model_file_id`.
    - **File:** `architecture-model-service/src/main/resources/db/changelog/sql/103-compute-clusters.sql`
  - [x] 1.8 Create changeset `104-compute-resources.sql`
    - Standard envelope + `environment_id` (NOT NULL FK), `cloud_account_id` (NULL FK), `location_id` (NULL FK), `cluster_id` (NULL FK to `compute_clusters`), `compute_type`, `provider`, `hostname`, `fqdn`, `private_ip`, `public_ip`, `os`, `runtime`, `instance_size`, `scaling_min INTEGER NULL`, `scaling_max INTEGER NULL`, `external_id`, `lifecycle_state`, `owner`.
    - Index on `model_file_id`.
    - **File:** `architecture-model-service/src/main/resources/db/changelog/sql/104-compute-resources.sql`
  - [x] 1.9 Create changeset `105-deployment-units.sql`
    - Standard envelope + `service_id TEXT NULL → services(id)` (Q1: direct FK, **not** ApplicationPoint), `deployment_unit_type`, `version`, `artifact_uri`, `image_name`, `image_tag`, `source_repository`, `source_commit`, `build_pipeline`, `owner`.
    - Index on `model_file_id`.
    - **File:** `architecture-model-service/src/main/resources/db/changelog/sql/105-deployment-units.sql`
  - [x] 1.10 Create changeset `106-load-balancers.sql`
    - Standard envelope + `environment_id` (NOT NULL FK), `cloud_account_id` (NULL FK), `location_id` (NULL FK), `network_id` (NULL FK), `load_balancer_type`, `provider`, `exposure`, `scheme`, `dns_name`, `ip_address`, `external_id`, `owner`.
    - Index on `model_file_id`.
    - **File:** `architecture-model-service/src/main/resources/db/changelog/sql/106-load-balancers.sql`
  - [x] 1.11 Create changeset `107-listeners.sql`
    - Standard envelope + `environment_id` (NOT NULL FK), `load_balancer_id` (NULL FK), `compute_resource_id TEXT NULL → compute_resources(id)` (A1: direct FK, **not** InfrastructurePoint), `protocol`, `port INTEGER NULL`, `host_name`, `path_pattern`, `exposure`, `is_public BOOLEAN`, `certificate_reference`, `external_id`.
    - Index on `model_file_id`.
    - **File:** `architecture-model-service/src/main/resources/db/changelog/sql/107-listeners.sql`
  - [x] 1.12 Create changeset `108-data-store-instances.sql`
    - Standard envelope + `environment_id` (NOT NULL FK), `cloud_account_id` (NULL FK), `location_id` (NULL FK), `data_store_type`, `engine`, `engine_version`, `provider`, `host`, `port INTEGER NULL`, `external_id`, `encrypted BOOLEAN`, `ha_enabled BOOLEAN`, `backup_enabled BOOLEAN`, `owner`.
    - Index on `model_file_id`.
    - **File:** `architecture-model-service/src/main/resources/db/changelog/sql/108-data-store-instances.sql`
  - [x] 1.13 Create changeset `109-infrastructure-resources.sql`
    - Standard envelope + `environment_id` (NOT NULL FK), `cloud_account_id` (NULL FK), `location_id` (NULL FK), `resource_type`, `provider`, `provider_resource_type`, `endpoint`, `external_id`, `criticality`, `owner`.
    - Index on `model_file_id`.
    - **File:** `architecture-model-service/src/main/resources/db/changelog/sql/109-infrastructure-resources.sql`
  - [x] 1.14 Create changeset `110-infrastructure-points.sql`
    - Reference design: copy structure verbatim from `020-data-entity-points.sql` / `022-data-entity-point-fk-columns.sql`.
    - Columns: `id TEXT PK`, `model_file_id TEXT NOT NULL → model_files(id) ON DELETE CASCADE`, `point_kind TEXT NOT NULL`, plus 12 nullable typed FK columns: `environment_id`, `cloud_account_id`, `location_id`, `network_id`, `subnet_id`, `compute_cluster_id`, `compute_resource_id`, `deployment_unit_id`, `load_balancer_id`, `listener_id`, `data_store_instance_id`, `infrastructure_resource_id`.
    - DB-level `CHECK` constraint named `chk_infrastructure_points_exactly_one_fk`: enforces (a) exactly one of the 12 FK columns is non-null AND (b) `point_kind` matches the set FK (12-way disjunction with consistency).
    - 12 partial unique indexes, one per FK: `CREATE UNIQUE INDEX uq_infra_points_<fk>_per_model ON infrastructure_points (model_file_id, <fk_id>) WHERE <fk_id> IS NOT NULL`.
    - Performance index `idx_infrastructure_points_model_file ON (model_file_id)`.
    - **File:** `architecture-model-service/src/main/resources/db/changelog/sql/110-infrastructure-points.sql`
  - [x] 1.15 Create changeset `111-resource-subnet-hostings.sql`
    - Columns: `id TEXT PK`, `model_file_id TEXT NOT NULL CASCADE`, `infrastructure_point_id TEXT NOT NULL → infrastructure_points(id)`, `subnet_id TEXT NOT NULL → subnets(id)`, `environment_id TEXT NOT NULL → environments(id)`, `relationship_role TEXT NULL`, `primary_ip TEXT NULL`, `private_ip TEXT NULL`, `public_ip TEXT NULL`, `evidence_source TEXT NULL`, `confidence DECIMAL(4,3) NULL` (no CHECK), `tags TEXT NULL`.
    - Index on `model_file_id`.
    - **File:** `architecture-model-service/src/main/resources/db/changelog/sql/111-resource-subnet-hostings.sql`
  - [x] 1.16 Create changeset `112-deployment-unit-compute-resources.sql`
    - Columns: `id TEXT PK`, `model_file_id TEXT NOT NULL CASCADE`, `deployment_unit_id TEXT NOT NULL → deployment_units(id)`, `compute_infrastructure_point_id TEXT NOT NULL → infrastructure_points(id)` (A2: renamed from `compute_resource_id`), `environment_id TEXT NOT NULL → environments(id)`, `version TEXT NULL`, `runtime_config JSONB NULL` (the **only** JSONB column in this spec), `desired_instances INTEGER NULL`, `min_instances INTEGER NULL`, `max_instances INTEGER NULL`, `deployment_status TEXT NULL`, `evidence_source TEXT NULL`, `confidence DECIMAL(4,3) NULL`, `tags TEXT NULL`.
    - No additional DB CHECK on `point_kind` — relationship-level allowed kinds (`COMPUTE_RESOURCE` / `COMPUTE_CLUSTER`) are documentation-only.
    - Index on `model_file_id`.
    - **File:** `architecture-model-service/src/main/resources/db/changelog/sql/112-deployment-unit-compute-resources.sql`
  - [x] 1.17 Create changeset `113-load-balancer-resource-routes.sql`
    - Columns: `id TEXT PK`, `model_file_id TEXT NOT NULL CASCADE`, `load_balancer_id TEXT NOT NULL → load_balancers(id)`, `listener_id TEXT NULL → listeners(id)`, `target_infrastructure_point_id TEXT NOT NULL → infrastructure_points(id)`, `environment_id TEXT NOT NULL → environments(id)`, `protocol TEXT NULL`, `target_port INTEGER NULL`, `host_name TEXT NULL`, `path_pattern TEXT NULL`, `routing_type TEXT NULL`, `weight INTEGER NULL`, `health_check_path TEXT NULL`, `tags TEXT NULL`.
    - Index on `model_file_id`.
    - **File:** `architecture-model-service/src/main/resources/db/changelog/sql/113-load-balancer-resource-routes.sql`
  - [x] 1.18 Register all 16 changesets in `db.changelog-master.yaml`
    - Append entries `098-` through `113-` in numeric order, after the existing `097-architecture-id-auto-derive-trigger.sql` reference.
    - **File:** `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml`
    - **Critical:** never edit applied changesets (097 and earlier); only add new lines.
  - [x] 1.19 Ensure migration tests pass
    - Run ONLY the 2-4 tests written in 1.1 plus a manual `mvn liquibase:update` against a fresh DB.
    - Verify all 16 changesets apply cleanly with no errors and that the polymorphic CHECK + partial unique indexes are enforced.
    - Do NOT run the entire test suite at this stage.

**Acceptance Criteria:**
- The 2-4 tests written in 1.1 pass.
- All 16 changesets apply idempotently against a fresh DB.
- `infrastructure_points` rejects rows that violate the exactly-one-FK or `point_kind` consistency rule.
- Partial unique indexes prevent duplicate `(model_file_id, <fk_id>)` per FK.
- No applied changeset (≤ 097) was modified.

---

### Persistence Layer

#### Task Group 2: JPA Entity Classes (12 entities + InfrastructurePoint + 3 relationships)
**Dependencies:** Task Group 1

- [x] 2.0 Create 16 JPA entity classes
  - [x] 2.1 Write 2-4 focused tests for entity field mapping
    - Test `InfrastructurePointEntity` round-trips through JPA with `point_kind = 'COMPUTE_RESOURCE'` and only `compute_resource_id` set.
    - Test `EnvironmentEntity` round-trips with all standard envelope fields populated.
    - Test `DeploymentUnitComputeResourceEntity.runtimeConfig` round-trips a JSONB string blob.
    - Test `ResourceSubnetHostingEntity.confidence` round-trips a `BigDecimal` with scale 3 (e.g. `0.875`).
    - **File:** `architecture-model-service/src/test/java/com/example/architecturemodel/model/entity/InfrastructureEntityMappingTest.java`
  - [x] 2.2 Create the 12 infrastructure entity classes in `model/entity/`
    - `EnvironmentEntity`, `CloudAccountEntity`, `LocationEntity`, `NetworkEntity`, `SubnetEntity`, `ComputeClusterEntity`, `ComputeResourceEntity`, `DeploymentUnitEntity`, `LoadBalancerEntity`, `ListenerEntity`, `DataStoreInstanceEntity`, `InfrastructureResourceEntity`.
    - Annotations: `@Entity`, `@Table(name = "<snake_plural>")`, `@Getter`, `@Setter`, `@NoArgsConstructor`, `@AllArgsConstructor`, `@Builder`.
    - All fields use `@Column(name = "snake_case")`; IDs are `String`; booleans are boxed `Boolean`; `INTEGER` columns are `Integer`.
    - `model_file_id` is mapped as a plain `String` column (not a JPA association), matching the existing `DataEntityPointEntity` pattern.
    - **Path:** `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/`
  - [x] 2.3 Create `InfrastructurePointEntity`
    - Mirror `DataEntityPointEntity` verbatim for structure: `id`, `modelFileId`, `pointKind`, plus 12 nullable typed FK columns as `String` fields.
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/InfrastructurePointEntity.java`
  - [x] 2.4 Create the 3 relationship entity classes in `model/entity/`
    - `ResourceSubnetHostingEntity` — fields per spec, including `infrastructurePointId`, `subnetId`, `environmentId`, `confidence` (`BigDecimal`).
    - `DeploymentUnitComputeResourceEntity` — fields per spec, including `computeInfrastructurePointId`, `runtimeConfig` (mapped with `@Column(columnDefinition = "jsonb")` and Hibernate JSONB type, stored as `String`), `confidence` (`BigDecimal`).
    - `LoadBalancerResourceRouteEntity` — fields per spec, including `targetInfrastructurePointId`, optional `listenerId`.
    - **Path:** `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/`
    - **Reference:** `DataMovementEntity.java` for relationship entity shape.
  - [x] 2.5 Ensure entity layer tests pass
    - Run ONLY the 2-4 tests written in 2.1.
    - Do NOT run the entire test suite at this stage.

**Acceptance Criteria:**
- The 2-4 tests written in 2.1 pass.
- All 16 entity classes compile and persist via Hibernate against the schema from Task Group 1.
- `InfrastructurePointEntity` mirrors `DataEntityPointEntity` shape exactly (typed-FK-per-target + discriminator).
- JSONB column is correctly mapped on `DeploymentUnitComputeResourceEntity.runtimeConfig`.

---

#### Task Group 3: DTO Records (12 entity DTOs + InfrastructurePoint DTO + 3 relationship DTOs)
**Dependencies:** Task Group 2 (logical — DTO records can be written in parallel but it is easier to author after entities are stable)

- [x] 3.0 Create 16 DTO Java records
  - [x] 3.1 Write 2-4 focused tests for DTO JSON serialisation
    - Test `EnvironmentDto` round-trips through Jackson with snake_case JSON property names (e.g. `valid_from`, `is_current_state`).
    - Test `InfrastructurePointDto` serialises `point_kind` and the 12 nullable typed FK fields as snake_case (`compute_resource_id`, etc.).
    - Test `DeploymentUnitComputeResourceDto.compute_infrastructure_point_id` is the JSON property name (Java field `computeInfrastructurePointId`).
    - Test `LoadBalancerResourceRouteDto.target_infrastructure_point_id` JSON name and Java field name match the spec.
    - **File:** `architecture-model-service/src/test/java/com/example/architecturemodel/model/dto/InfrastructureDtoSerialisationTest.java`
  - [x] 3.2 Create 12 entity DTO records in `model/dto/entity/`
    - `EnvironmentDto`, `CloudAccountDto`, `LocationDto`, `NetworkDto`, `SubnetDto`, `ComputeClusterDto`, `ComputeResourceDto`, `DeploymentUnitDto`, `LoadBalancerDto`, `ListenerDto`, `DataStoreInstanceDto`, `InfrastructureResourceDto`.
    - All fields are Java record components with `@JsonProperty("snake_case")` on every field.
    - Booleans are nullable boxed `Boolean`; IDs are `String`.
    - **Do not include `model_file_id`** in any DTO (server-side only).
    - **Reference:** `BusinessProcessDto`, `ApplicationDto`, `DataEntityPointDto`.
    - **Path:** `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/`
  - [x] 3.3 Create `InfrastructurePointDto`
    - Fields: `id`, `point_kind`, plus the 12 nullable typed FK fields (each `String`).
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/InfrastructurePointDto.java`
    - **Reference:** `DataEntityPointDto`.
  - [x] 3.4 Create 3 relationship DTO records in `model/dto/relationship/`
    - `ResourceSubnetHostingDto` — fields: `id`, `infrastructure_point_id`, `subnet_id`, `environment_id`, `relationship_role`, `primary_ip`, `private_ip`, `public_ip`, `evidence_source`, `confidence` (`BigDecimal`), `tags`.
    - `DeploymentUnitComputeResourceDto` — fields: `id`, `deployment_unit_id`, `compute_infrastructure_point_id` (Java: `computeInfrastructurePointId`), `environment_id`, `version`, `runtime_config` (`String`, raw JSON), `desired_instances`, `min_instances`, `max_instances`, `deployment_status`, `evidence_source`, `confidence` (`BigDecimal`), `tags`.
    - `LoadBalancerResourceRouteDto` — fields: `id`, `load_balancer_id`, `listener_id`, `target_infrastructure_point_id` (Java: `targetInfrastructurePointId`), `environment_id`, `protocol`, `target_port`, `host_name`, `path_pattern`, `routing_type`, `weight`, `health_check_path`, `tags`.
    - **Reference:** `DataMovementDto`.
    - **Path:** `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/relationship/`
  - [x] 3.5 Ensure DTO layer tests pass
    - Run ONLY the 2-4 tests written in 3.1.
    - Do NOT run the entire test suite at this stage.

**Acceptance Criteria:**
- The 2-4 tests written in 3.1 pass.
- All 16 DTOs are Java records with `@JsonProperty("snake_case")` on every field.
- No DTO exposes `model_file_id`.
- `compute_infrastructure_point_id` and `target_infrastructure_point_id` JSON names match A2 / R3 exactly.

---

#### Task Group 4: Repository Interfaces (16 repositories)
**Dependencies:** Task Group 2

- [x] 4.0 Create 16 Spring Data JPA repository interfaces
  - [x] 4.1 Write 2-4 focused tests for repository scoping behaviour
    - Test `EnvironmentRepository.findByModelFileId(modelFileId)` returns only rows for that model file.
    - Test `InfrastructurePointRepository.findByModelFileId(modelFileId)` returns rows across multiple `point_kind` values.
    - Test `DeploymentUnitComputeResourceRepository.deleteByModelFileId(modelFileId)` removes only the matching rows.
    - **File:** `architecture-model-service/src/test/java/com/example/architecturemodel/repository/InfrastructureRepositoryTest.java`
  - [x] 4.2 Create 12 entity repositories in `repository/entity/`
    - `EnvironmentRepository`, `CloudAccountRepository`, `LocationRepository`, `NetworkRepository`, `SubnetRepository`, `ComputeClusterRepository`, `ComputeResourceRepository`, `DeploymentUnitRepository`, `LoadBalancerRepository`, `ListenerRepository`, `DataStoreInstanceRepository`, `InfrastructureResourceRepository`.
    - Each: `extends JpaRepository<TEntity, String>`, `@Repository` annotation.
    - Methods: `List<TEntity> findByModelFileId(String modelFileId)`, `void deleteByModelFileId(String modelFileId)`.
    - **Reference:** any existing `*Repository` in `repository/entity/`.
    - **Path:** `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/`
  - [x] 4.3 Create `InfrastructurePointRepository`
    - Same shape as the others.
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/InfrastructurePointRepository.java`
  - [x] 4.4 Create 3 relationship repositories in `repository/relationship/`
    - `ResourceSubnetHostingRepository`, `DeploymentUnitComputeResourceRepository`, `LoadBalancerResourceRouteRepository`.
    - **Path:** `architecture-model-service/src/main/java/com/example/architecturemodel/repository/relationship/`
  - [x] 4.5 Ensure repository layer tests pass
    - Run ONLY the 2-4 tests written in 4.1.
    - Do NOT run the entire test suite at this stage.

**Acceptance Criteria:**
- The 2-4 tests written in 4.1 pass.
- All 16 repositories provide `findByModelFileId` and `deleteByModelFileId`.
- Scoping is correctly enforced (no cross-model-file leakage).

---

### Mapping & Service Layer

#### Task Group 5: EntityMapper Extensions (DTO ↔ Entity)
**Dependencies:** Task Groups 2, 3

- [x] 5.0 Extend `EntityMapper` with 16 new bidirectional mappings
  - [x] 5.1 Write 2-4 focused tests for DTO ↔ Entity mapping
    - Test `EntityMapper.toEntity(EnvironmentDto, modelFileId)` populates `modelFileId` server-side and copies all envelope fields.
    - Test `EntityMapper.toDto(InfrastructurePointEntity)` produces a DTO with the correct `point_kind` and exactly one non-null typed FK.
    - Test `EntityMapper.toEntity(DeploymentUnitComputeResourceDto, modelFileId)` correctly maps `computeInfrastructurePointId` and `runtimeConfig` JSONB.
    - **File:** `architecture-model-service/src/test/java/com/example/architecturemodel/mapper/InfrastructureEntityMapperTest.java`
  - [x] 5.2 Add `toEntity` and `toDto` methods for the 12 infrastructure entities to `EntityMapper`
    - Each `toEntity` accepts `(TDto dto, String modelFileId)` and sets `modelFileId` from the parameter.
    - Each `toDto` strips `modelFileId` (DTOs do not expose it).
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/mapper/EntityMapper.java`
  - [x] 5.3 Add `toEntity` and `toDto` methods for `InfrastructurePoint`
    - Map all 12 typed FK fields one-to-one.
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/mapper/EntityMapper.java`
  - [x] 5.4 Add `toEntity` and `toDto` methods for the 3 relationships
    - `ResourceSubnetHosting`, `DeploymentUnitComputeResource`, `LoadBalancerResourceRoute`.
    - Preserve `BigDecimal` confidence and JSONB `runtimeConfig` exactly.
    - If relationship mapping is conventionally elsewhere (e.g. inline in `ModelService`), follow the existing precedent set by `DataMovementEntity` / `DataMovementDto` rather than forcing it into `EntityMapper`.
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/mapper/EntityMapper.java` (or inline in `ModelService` per existing convention)
  - [x] 5.5 Ensure mapper layer tests pass
    - Run ONLY the 2-4 tests written in 5.1.
    - Do NOT run the entire test suite at this stage.

**Acceptance Criteria:**
- The 2-4 tests written in 5.1 pass.
- DTO ↔ Entity mapping preserves every spec'd field with no loss.
- `model_file_id` is set server-side and never read from the DTO.

---

#### Task Group 6: MetaModel DTO Extensions
**Dependencies:** Task Group 3

- [x] 6.0 Extend `MetaModelEntitiesDto` and `MetaModelRelationshipsDto`
  - [x] 6.1 Write 2-4 focused tests for MetaModel DTO shape
    - Test `MetaModelEntitiesDto` JSON includes the 13 new lists (`environments`, `cloud_accounts`, …, `infrastructure_resources`, `infrastructure_points`) with snake_case names.
    - Test `MetaModelRelationshipsDto` JSON includes the 3 new lists (`resource_subnet_hostings`, `deployment_unit_compute_resources`, `load_balancer_resource_routes`).
    - Test new lists default to empty (not null) on serialisation.
    - Test existing Business / Application / Data / Behavioural / UI fields are unchanged in shape and order.
    - **File:** `architecture-model-service/src/test/java/com/example/architecturemodel/model/dto/MetaModelDtoExtensionTest.java`
  - [x] 6.2 Add 13 new lists to `MetaModelEntitiesDto`
    - `List<EnvironmentDto> environments` (`@JsonProperty("environments")`).
    - `List<CloudAccountDto> cloud_accounts` (`@JsonProperty("cloud_accounts")`).
    - `List<LocationDto>`, `List<NetworkDto>`, `List<SubnetDto>`, `List<ComputeClusterDto>`, `List<ComputeResourceDto>`, `List<DeploymentUnitDto>`, `List<LoadBalancerDto>`, `List<ListenerDto>`, `List<DataStoreInstanceDto>`, `List<InfrastructureResourceDto>`.
    - `List<InfrastructurePointDto> infrastructure_points` (`@JsonProperty("infrastructure_points")`).
    - Each list defaults to `List.of()` (or empty `ArrayList` per existing convention) — never null on serialisation.
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/MetaModelEntitiesDto.java`
  - [x] 6.3 Add 3 new lists to `MetaModelRelationshipsDto`
    - `List<ResourceSubnetHostingDto> resource_subnet_hostings`.
    - `List<DeploymentUnitComputeResourceDto> deployment_unit_compute_resources`.
    - `List<LoadBalancerResourceRouteDto> load_balancer_resource_routes`.
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/MetaModelRelationshipsDto.java`
  - [x] 6.4 Do NOT restructure existing fields
    - Existing Business, Application, Data, Behavioural, and UI domain JSON shapes must remain unchanged.
    - Add new fields at the end of each record's component list (or wherever existing convention puts new domains) — do not reorder existing fields.
  - [x] 6.5 Ensure MetaModel DTO tests pass
    - Run ONLY the 2-4 tests written in 6.1.
    - Do NOT run the entire test suite at this stage.

**Acceptance Criteria:**
- The 2-4 tests written in 6.1 pass.
- 13 new entity lists + 3 new relationship lists are present with snake_case JSON names.
- Existing domain JSON shapes are unchanged (regression-safe).

---

#### Task Group 7: ModelService Save/Load/Delete-and-Replace Integration
**Dependencies:** Task Groups 4, 5, 6

- [x] 7.0 Wire the 16 new repositories into `ModelService`
  - [x] 7.1 Write 2-4 focused tests for ModelService integration plumbing
    - Test `ModelService.saveModel(...)` invokes each of the 16 new repository `saveAll`/`save` calls when the relevant DTO list is populated.
    - Test `ModelService.loadModelByFileId(...)` populates all 13 entity lists and 3 relationship lists from `findByModelFileId`.
    - Test `ModelService.deleteAllDataForModelFile(...)` invokes `deleteByModelFileId` on the 16 new repositories in dependency-safe order (relationships → infrastructure_points → 12 entity tables in reverse-dependency order).
    - **File:** `architecture-model-service/src/test/java/com/example/architecturemodel/service/ModelServiceInfrastructureWiringTest.java`
    - Use Mockito to verify call order and arguments.
  - [x] 7.2 Inject the 16 new repositories into `ModelService`
    - Add `@Autowired` constructor parameters (or fields, matching existing style) for the 12 entity repos + `InfrastructurePointRepository` + 3 relationship repos.
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/service/ModelService.java`
  - [x] 7.3 Extend `saveEntities(...)` to persist the 13 new entity lists
    - For each list on `MetaModelEntitiesDto`, map each DTO to an entity (setting `modelFileId`), then `saveAll`.
    - Save order: parents first — `environments` → `cloud_accounts` → `locations` → `networks` → `subnets` → `compute_clusters` → `compute_resources` → `deployment_units` → `load_balancers` → `listeners` → `data_store_instances` → `infrastructure_resources` → `infrastructure_points`.
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/service/ModelService.java`
  - [x] 7.4 Extend `saveRelationships(...)` to persist the 3 new relationship lists
    - `resource_subnet_hostings`, `deployment_unit_compute_resources`, `load_balancer_resource_routes`.
    - Map each DTO with `modelFileId` from context; `saveAll`.
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/service/ModelService.java`
  - [x] 7.5 Extend `loadModelByFileId(...)` to populate the 13 + 3 new lists
    - Call `findByModelFileId(modelFileId)` on each of the 16 new repos.
    - Map entities to DTOs and assign to the corresponding list on `MetaModelEntitiesDto` / `MetaModelRelationshipsDto`.
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/service/ModelService.java`
  - [x] 7.6 Extend `deleteAllDataForModelFile(...)` with the new repos
    - Delete order (dependency-safe): **relationships first** — `load_balancer_resource_routes`, `deployment_unit_compute_resources`, `resource_subnet_hostings` — then `infrastructure_points`, then the 12 entity tables in reverse-dependency order: `infrastructure_resources`, `data_store_instances`, `listeners`, `load_balancers`, `deployment_units`, `compute_resources`, `compute_clusters`, `subnets`, `networks`, `locations`, `cloud_accounts`, `environments`.
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/service/ModelService.java`
  - [x] 7.7 Verify existing domain save/load behaviour is unchanged
    - Do not modify any existing per-domain repo invocations in `saveEntities` / `loadModelByFileId` / `deleteAllDataForModelFile`.
    - New code is additive only.
  - [x] 7.8 Ensure ModelService integration tests pass
    - Run ONLY the 2-4 tests written in 7.1.
    - Do NOT run the entire test suite at this stage.

**Acceptance Criteria:**
- The 2-4 tests written in 7.1 pass.
- All 16 new repos are invoked in correct order during save / load / delete.
- Existing domain behaviour is regression-safe (no edits to existing per-domain calls).

---

### Integration Testing

#### Task Group 8: End-to-End Tests and Test Coverage Gap Analysis
**Dependencies:** Task Groups 1-7

- [x] 8.0 Author end-to-end tests covering save/load round-trip, polymorphism, delete-and-replace, and CHECK enforcement
  - [x] 8.1 Review existing tests from Task Groups 1-7
    - Review the 2-4 tests written by migrations layer (Task 1.1).
    - Review the 2-4 tests written by entity layer (Task 2.1).
    - Review the 2-4 tests written by DTO layer (Task 3.1).
    - Review the 2-4 tests written by repository layer (Task 4.1).
    - Review the 2-4 tests written by mapper layer (Task 5.1).
    - Review the 2-4 tests written by MetaModel DTO layer (Task 6.1).
    - Review the 2-4 tests written by ModelService wiring layer (Task 7.1).
    - Total existing tests: approximately 14-28 tests.
  - [x] 8.2 Analyse test coverage gaps for THIS feature only
    - Identify critical end-to-end workflows that lack test coverage.
    - Focus ONLY on infrastructure-domain gaps; do NOT assess the entire application.
    - Priority gaps:
      - Full save → load round-trip with at least one row of each of the 13 entity types and 3 relationships.
      - Polymorphic relationship case where `compute_infrastructure_point_id` references an `InfrastructurePoint` with `point_kind = 'COMPUTE_CLUSTER'` (the non-default kind for R2).
      - Delete-and-replace: save populated model, save smaller model, assert prior infra rows are gone.
      - Polymorphic CHECK enforcement at the JPA layer (zero / multiple / mismatched FKs).
      - Existing test suite continues to pass with no modifications to existing tests (regression).
  - [x] 8.3 Write up to 6 additional strategic tests maximum
    - **Round-trip test** (1 test): build a `MetaModelEntitiesDto` + `MetaModelRelationshipsDto` populated with at least one row of each of the 12 entity types, an `InfrastructurePoint` row, and one row of each of the 3 relationships; call `ModelService.saveModel(...)`, then `loadModelByFileId(...)`; assert deep equality on all infrastructure fields.
    - **Polymorphic R2 test** (1 test): persist a `deployment_unit_compute_resources` row whose `compute_infrastructure_point_id` references an `InfrastructurePoint` with `point_kind = 'COMPUTE_CLUSTER'`; assert it loads correctly.
    - **Polymorphic R2 secondary test** (1 test, optional): same but with `point_kind = 'COMPUTE_RESOURCE'`.
    - **Delete-and-replace test** (1 test): save a populated model, call `saveModel(...)` again with a payload empty of infra; assert all prior infrastructure rows are gone via direct repository queries.
    - **CHECK constraint propagation test** (1 test): assert at the JPA layer that an `InfrastructurePoint` with zero, multiple, or mismatched FKs causes a `DataIntegrityViolationException` to surface to the caller.
    - **Existing-suite regression test** (1 test): a single sanity test that loads a pre-existing fixture model (Business + Application + Data + Behavioural + UI only) and asserts all existing domain lists are populated identically to before the spec.
    - **File:** `architecture-model-service/src/test/java/com/example/architecturemodel/integration/InfrastructureDomainIntegrationTest.java`
  - [x] 8.4 Run feature-specific tests only
    - Run ONLY the tests from Task Groups 1.1, 2.1, 3.1, 4.1, 5.1, 6.1, 7.1, and 8.3.
    - Expected total: approximately 20-34 tests.
    - Do NOT run the entire application test suite.
    - Verify all critical workflows pass.

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 20-34 tests total).
- Save/load/delete-and-replace round-trip is fully verified for the infrastructure domain.
- Polymorphic `InfrastructurePoint` use is tested for at least the R2 `COMPUTE_CLUSTER` case.
- DB-level CHECK on `infrastructure_points` is verified end-to-end.
- Existing Business / Application / Data / Behavioural / UI domain behaviour is regression-safe.
- No more than 6 additional tests added when filling gaps.

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Liquibase Migrations (098–113)**
   - Lands the schema first; everything else depends on the tables existing.
   - Order within the group is FK-dependency-driven: 098 → 099 → … → 113.

2. **Task Group 2: JPA Entity Classes**
   - Maps the schema into Java; required by repositories and mappers.

3. **Task Group 3: DTO Records** (can run in parallel with Task Group 4)
   - Independent of repositories; only depends on understanding the column shape.

4. **Task Group 4: Repository Interfaces** (can run in parallel with Task Group 3)
   - Depends on entities (Task Group 2).

5. **Task Group 5: EntityMapper Extensions**
   - Depends on Task Groups 2 + 3 (needs both sides of the map).

6. **Task Group 6: MetaModel DTO Extensions**
   - Depends on Task Group 3.

7. **Task Group 7: ModelService Integration**
   - Depends on Task Groups 4, 5, 6.

8. **Task Group 8: End-to-End Tests and Gap Analysis**
   - Depends on all previous groups; closes out the spec.

---

## File Summary

### Liquibase Files to Create (16)
- `architecture-model-service/src/main/resources/db/changelog/sql/098-environments.sql`
- `architecture-model-service/src/main/resources/db/changelog/sql/099-cloud-accounts.sql`
- `architecture-model-service/src/main/resources/db/changelog/sql/100-locations.sql`
- `architecture-model-service/src/main/resources/db/changelog/sql/101-networks.sql`
- `architecture-model-service/src/main/resources/db/changelog/sql/102-subnets.sql`
- `architecture-model-service/src/main/resources/db/changelog/sql/103-compute-clusters.sql`
- `architecture-model-service/src/main/resources/db/changelog/sql/104-compute-resources.sql`
- `architecture-model-service/src/main/resources/db/changelog/sql/105-deployment-units.sql`
- `architecture-model-service/src/main/resources/db/changelog/sql/106-load-balancers.sql`
- `architecture-model-service/src/main/resources/db/changelog/sql/107-listeners.sql`
- `architecture-model-service/src/main/resources/db/changelog/sql/108-data-store-instances.sql`
- `architecture-model-service/src/main/resources/db/changelog/sql/109-infrastructure-resources.sql`
- `architecture-model-service/src/main/resources/db/changelog/sql/110-infrastructure-points.sql`
- `architecture-model-service/src/main/resources/db/changelog/sql/111-resource-subnet-hostings.sql`
- `architecture-model-service/src/main/resources/db/changelog/sql/112-deployment-unit-compute-resources.sql`
- `architecture-model-service/src/main/resources/db/changelog/sql/113-load-balancer-resource-routes.sql`

### JPA Entity Files to Create (16)
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
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/InfrastructurePointEntity.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/ResourceSubnetHostingEntity.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/DeploymentUnitComputeResourceEntity.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/LoadBalancerResourceRouteEntity.java`

### DTO Files to Create (16)
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/EnvironmentDto.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/CloudAccountDto.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/LocationDto.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/NetworkDto.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/SubnetDto.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/ComputeClusterDto.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/ComputeResourceDto.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/DeploymentUnitDto.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/LoadBalancerDto.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/ListenerDto.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/DataStoreInstanceDto.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/InfrastructureResourceDto.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/InfrastructurePointDto.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/relationship/ResourceSubnetHostingDto.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/relationship/DeploymentUnitComputeResourceDto.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/relationship/LoadBalancerResourceRouteDto.java`

### Repository Files to Create (16)
- `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/EnvironmentRepository.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/CloudAccountRepository.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/LocationRepository.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/NetworkRepository.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/SubnetRepository.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/ComputeClusterRepository.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/ComputeResourceRepository.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/DeploymentUnitRepository.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/LoadBalancerRepository.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/ListenerRepository.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/DataStoreInstanceRepository.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/InfrastructureResourceRepository.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/InfrastructurePointRepository.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/repository/relationship/ResourceSubnetHostingRepository.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/repository/relationship/DeploymentUnitComputeResourceRepository.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/repository/relationship/LoadBalancerResourceRouteRepository.java`

### Files to Modify
- `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml` (register 16 new changesets)
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/MetaModelEntitiesDto.java` (add 13 new lists)
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/MetaModelRelationshipsDto.java` (add 3 new lists)
- `architecture-model-service/src/main/java/com/example/architecturemodel/mapper/EntityMapper.java` (add toEntity / toDto for 16 new types)
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/ModelService.java` (inject 16 repos, extend save / load / delete)

### Test Files to Create (8)
- `architecture-model-service/src/test/java/com/example/architecturemodel/repository/entity/InfrastructurePointConstraintTest.java`
- `architecture-model-service/src/test/java/com/example/architecturemodel/model/entity/InfrastructureEntityMappingTest.java`
- `architecture-model-service/src/test/java/com/example/architecturemodel/model/dto/InfrastructureDtoSerialisationTest.java`
- `architecture-model-service/src/test/java/com/example/architecturemodel/repository/InfrastructureRepositoryTest.java`
- `architecture-model-service/src/test/java/com/example/architecturemodel/mapper/InfrastructureEntityMapperTest.java`
- `architecture-model-service/src/test/java/com/example/architecturemodel/model/dto/MetaModelDtoExtensionTest.java`
- `architecture-model-service/src/test/java/com/example/architecturemodel/service/ModelServiceInfrastructureWiringTest.java`
- `architecture-model-service/src/test/java/com/example/architecturemodel/integration/InfrastructureDomainIntegrationTest.java`

---

## Reference Patterns

### Existing Code to Follow
- **Polymorphic point reference design** (authoritative blueprint for `InfrastructurePoint`):
  - `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/DataEntityPointEntity.java`
  - `architecture-model-service/src/main/resources/db/changelog/sql/020-data-entity-points.sql`
  - `architecture-model-service/src/main/resources/db/changelog/sql/022-data-entity-point-fk-columns.sql`
  - **Do NOT** copy `ApplicationPointEntity`'s hybrid `target_type`/`target_ref_id` style.
- **DTO record + `@JsonProperty("snake_case")` style:**
  - `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/BusinessProcessDto.java`
  - `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/ApplicationDto.java`
  - `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/DataEntityPointDto.java`
- **Relationship DTO pattern:**
  - `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/relationship/DataMovementDto.java`
- **Relationship entity pattern:**
  - `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/DataMovementEntity.java`
- **Repository skeleton (`findByModelFileId`, `deleteByModelFileId`):**
  - any existing file in `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/` or `repository/relationship/`.
- **ModelService integration points:**
  - `architecture-model-service/src/main/java/com/example/architecturemodel/service/ModelService.java` — methods `saveModel`, `loadModelByFileId`, `deleteAllDataForModelFile`, `saveEntities`, `saveRelationships`.
- **Liquibase master changelog:**
  - `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml` — latest applied: `097-architecture-id-auto-derive-trigger.sql`. Append new entries; never edit applied changesets.

### Key Decisions to Honour
- **Q1**: `deployment_units.service_id` is a direct FK to `services(id)` — **not** ApplicationPoint.
- **Q2**: `InfrastructurePoint` uses `DataEntityPoint`-style typed-FK + discriminator + CHECK + partial unique indexes — **not** the hybrid `target_type`/`target_ref_id` style.
- **A1**: `listeners.compute_resource_id` stays a direct FK — **not** promoted to `InfrastructurePoint`.
- **A2**: `deployment_unit_compute_resources.compute_infrastructure_point_id` (renamed from `compute_resource_id`) is polymorphic via `InfrastructurePoint`; allowed `point_kind` is `COMPUTE_RESOURCE` or `COMPUTE_CLUSTER` (documentation-only, no extra DB CHECK).
- **Q4**: `confidence` is `DECIMAL(4,3)` nullable — no DB CHECK, no JPA validation.
- **Q5**: `runtime_config` is the **only** JSONB column in this spec; everything else is TEXT.
- **Q7**: `environment_id` is preserved on **all three** relationships; cross-row consistency is caller-enforced.
- **Liquibase ordering**: never edit applied changesets (≤ 097); only add new files numbered 098–113.
