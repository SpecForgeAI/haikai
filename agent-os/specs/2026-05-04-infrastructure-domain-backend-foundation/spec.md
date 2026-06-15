# Specification: Infrastructure Domain Backend Foundation

## Goal
Add the backend persistence and meta-model foundation for a sixth Architecture domain (Infrastructure) in the Spring Boot `architecture-model-service`, comprising 12 entities, a polymorphic `InfrastructurePoint` supertype, and 3 relationships, fully integrated with the existing save/load/delete-and-replace pipeline.

## User Stories
- As an architect, I want the backend to persist and return Infrastructure entities and relationships as part of the architecture meta-model so that future spec increments can build the frontend, diagrams, and Terraform tooling against a stable backend contract.
- As a backend developer, I want `InfrastructurePoint` to follow the same `DataEntityPoint`-style polymorphic pattern already in the codebase so that infrastructure relationships can reference any of the 12 infrastructure entity types without ad-hoc `source_type`/`source_id` columns.

## Specific Requirements

**12 new entity tables, JPA entities, DTOs and repositories**
- Create `environments`, `cloud_accounts`, `locations`, `networks`, `subnets`, `compute_clusters`, `compute_resources`, `deployment_units`, `load_balancers`, `listeners`, `data_store_instances`, `infrastructure_resources` per the column lists in `requirements.md` Entity Specifications.
- Every table has the standard envelope: `id TEXT PRIMARY KEY`, `model_file_id TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE`, `name TEXT NOT NULL` (where applicable), `description TEXT NULL`, `tags TEXT NULL`, `valid_from TEXT NULL`, `valid_to TEXT NULL`. No `created_at`/`updated_at`.
- All enum-style columns stored as `TEXT` (no DB enum types). All booleans nullable boxed `Boolean` at DTO level. All IDs are `String`.
- Sibling FKs (`environment_id`, `cloud_account_id`, `location_id`, `network_id`, `cluster_id`, `service_id`) use default `NO ACTION`; only `model_file_id` cascades.
- `deployment_units.service_id` is a direct typed FK to `services(id)`, nullable (Q1 decision — **not** `ApplicationPoint`).
- `listeners.compute_resource_id` is a direct typed FK to `compute_resources(id)`, nullable (A1 decision — kept direct, **not** promoted to `InfrastructurePoint`).
- Add one perf index per table on `model_file_id` to support `findByModelFileId`.
- DTOs are Java records in `model/dto/entity/` with `@JsonProperty("snake_case")` on every field; `model_file_id` is server-side only and not exposed in DTOs.

**`infrastructure_points` polymorphic supertype table**
- Model after `DataEntityPointEntity` / `data_entity_points` (typed-FK-per-target + discriminator + CHECK + partial unique indexes), **not** after `ApplicationPointEntity`.
- Columns: `id TEXT PK`, `model_file_id TEXT NOT NULL → model_files(id) ON DELETE CASCADE`, `point_kind TEXT NOT NULL`, plus 12 nullable typed FK columns (`environment_id`, `cloud_account_id`, `location_id`, `network_id`, `subnet_id`, `compute_cluster_id`, `compute_resource_id`, `deployment_unit_id`, `load_balancer_id`, `listener_id`, `data_store_instance_id`, `infrastructure_resource_id`).
- DB-level `CHECK` constraint enforcing (a) exactly one of the 12 typed FK columns is non-null, AND (b) the non-null FK matches `point_kind` (e.g. `point_kind = 'COMPUTE_RESOURCE'` iff `compute_resource_id IS NOT NULL`).
- 12 partial unique indexes — one per FK column — `UNIQUE (model_file_id, <fk_id>) WHERE <fk_id> IS NOT NULL`, matching `data_entity_points` style.
- Performance index on `infrastructure_points(model_file_id)`.
- `point_kind` discriminator values: `ENVIRONMENT`, `CLOUD_ACCOUNT`, `LOCATION`, `NETWORK`, `SUBNET`, `COMPUTE_CLUSTER`, `COMPUTE_RESOURCE`, `DEPLOYMENT_UNIT`, `LOAD_BALANCER`, `LISTENER`, `DATA_STORE_INSTANCE`, `INFRASTRUCTURE_RESOURCE`.
- `InfrastructurePointDto` exposes the discriminator and 12 nullable typed FK ids; no opaque `target_type`/`target_ref_id` fallback.

**3 new relationship tables, JPA entities, DTOs and repositories**
- `resource_subnet_hostings`: polymorphic source via `infrastructure_point_id NOT NULL → infrastructure_points(id)`, plus `subnet_id NOT NULL`, `environment_id NOT NULL`, `relationship_role`, `primary_ip`, `private_ip`, `public_ip`, `evidence_source`, `confidence DECIMAL(4,3)`, `tags`.
- `deployment_unit_compute_resources`: polymorphic compute target via `compute_infrastructure_point_id NOT NULL → infrastructure_points(id)` (A2 decision — renamed from `compute_resource_id`), plus `deployment_unit_id NOT NULL`, `environment_id NOT NULL`, `version`, `runtime_config JSONB`, `desired_instances`, `min_instances`, `max_instances`, `deployment_status`, `evidence_source`, `confidence DECIMAL(4,3)`, `tags`.
- `load_balancer_resource_routes`: polymorphic target via `target_infrastructure_point_id NOT NULL → infrastructure_points(id)`, plus `load_balancer_id NOT NULL`, `listener_id NULL`, `environment_id NOT NULL`, `protocol`, `target_port`, `host_name`, `path_pattern`, `routing_type`, `weight`, `health_check_path`, `tags`.
- `environment_id` is preserved on **all three** relationships per Q7; cross-row consistency (relationship's environment matching its endpoints') is caller-enforced — no DB-level check.
- All three relationships use `model_file_id TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE` and `tags TEXT NULL`. Sibling FKs default `NO ACTION`.
- Relationship-level allowed `point_kind` values (e.g. R2 restricts to `COMPUTE_RESOURCE` or `COMPUTE_CLUSTER`) are documentation-only — **not** enforced by an additional DB CHECK in this spec.
- DTO field naming: `compute_infrastructure_point_id` JSON / `computeInfrastructurePointId` Java; `target_infrastructure_point_id` JSON / `targetInfrastructurePointId` Java.

**`runtime_config` JSONB column (sole JSONB deviation)**
- `deployment_unit_compute_resources.runtime_config` is `JSONB NULL` — the **only** JSONB column introduced by this spec.
- This is a deliberate deviation from the existing TEXT-blob `tags` convention because `runtime_config` is structured key/value config that benefits from native JSONB query/index support.
- All other "tags/metadata: object/map" fields in the raw idea are persisted as `TEXT` per existing convention; consumers serialise structured data as a string.
- DTO field: nullable `String` (raw JSON serialised by caller); JPA mapping uses Hibernate's JSONB support for `@Column(columnDefinition = "jsonb")`. Defer richer typing to a future spec.
- No DB-level schema validation on the JSONB content in this spec.

**`confidence` decimal column convention**
- `confidence` columns on `resource_subnet_hostings` and `deployment_unit_compute_resources` are `DECIMAL(4,3) NULL`.
- **No** DB `CHECK` constraint on range. **No** JPA `@DecimalMin`/`@DecimalMax` validation.
- Range guidance (0.0 – 1.0) is documentation-only, enforced by callers if at all (Q4 decision).
- DTO field is `BigDecimal` (nullable) with `@JsonProperty("confidence")`.

**`MetaModelEntitiesDto` and `MetaModelRelationshipsDto` extension**
- Add 13 new lists to `MetaModelEntitiesDto`: `environments`, `cloud_accounts`, `locations`, `networks`, `subnets`, `compute_clusters`, `compute_resources`, `deployment_units`, `load_balancers`, `listeners`, `data_store_instances`, `infrastructure_resources`, `infrastructure_points` — each with `@JsonProperty("snake_case")`.
- Add 3 new lists to `MetaModelRelationshipsDto`: `resource_subnet_hostings`, `deployment_unit_compute_resources`, `load_balancer_resource_routes`.
- Do not restructure existing fields; existing Business, Application, Data, Behavioural, and UI domain JSON shapes remain unchanged.
- Lists default to empty (not null) on serialisation, matching existing convention.

**`ModelService` save / load / delete-and-replace integration**
- Extend `saveModel(...)` so that after `deleteAllDataForModelFile(modelFileId)`, `saveEntities(...)` invokes the 13 new infrastructure entity repositories (12 entity types + `infrastructure_points`) and `saveRelationships(...)` invokes the 3 new relationship repositories.
- Extend `loadModelByFileId(modelFileId)` so the assembled `MetaModelEntitiesDto` and `MetaModelRelationshipsDto` populate the 13 + 3 new lists via each repository's `findByModelFileId(modelFileId)`.
- Extend `deleteAllDataForModelFile(modelFileId)` to invoke `deleteByModelFileId(modelFileId)` on the 16 new repositories in dependency-safe order: relationships first (3), then `infrastructure_points`, then 12 entity tables in reverse-dependency order (deepest dependants like `subnets`, `compute_resources`, `listeners`, etc. before their parents `networks`, `compute_clusters`, `cloud_accounts`, `environments`).
- All new repositories extend `JpaRepository<TEntity, String>` with `findByModelFileId(String)` and `deleteByModelFileId(String)`, located in `repository/entity/` and `repository/relationship/`.
- Existing Business, Application, Data, Behavioural, and UI domain save/load behaviour remains unchanged.

**16 Liquibase changesets `098-` through `113-`**
- Sequential `NNN-name.sql` files in `architecture-model-service/src/main/resources/db/changelog/sql/`, registered in `db.changelog-master.yaml` in order. Latest applied is `097-architecture-id-auto-derive-trigger.sql`.
- Each changeSet uses `preConditions: onFail: MARK_RAN` with `not: tableExists`. Never edit applied changesets.
- File order and FK creation order: 098 environments, 099 cloud_accounts, 100 locations, 101 networks, 102 subnets, 103 compute_clusters, 104 compute_resources, 105 deployment_units (with `service_id` FK to `services`), 106 load_balancers, 107 listeners (with direct `compute_resource_id` FK), 108 data_store_instances, 109 infrastructure_resources, 110 infrastructure_points (12 typed FKs + CHECK + 12 partial unique indexes + perf index on `model_file_id`), 111 resource_subnet_hostings, 112 deployment_unit_compute_resources (JSONB `runtime_config` + `compute_infrastructure_point_id`), 113 load_balancer_resource_routes.
- Each entity changeset adds a perf index on `model_file_id` to support `findByModelFileId`.
- `infrastructure_points` CHECK enforces exactly-one-FK-set AND consistency between `point_kind` and the set FK.
- `113-load-balancer-resource-routes.sql` adds FKs to `load_balancers`, `listeners` (nullable), `infrastructure_points`, `environments`, and `model_files` cascade.

**Backend tests**
- Round-trip test: build a `MetaModelEntitiesDto` + `MetaModelRelationshipsDto` populated with at least one row of each of the 12 entity types and the 3 relationships (including `InfrastructurePoint` rows), call `ModelService.saveModel(...)`, then `loadModelByFileId(...)`, and assert the returned DTOs are deep-equal on all infrastructure fields.
- Polymorphic relationship test: persist a `deployment_unit_compute_resources` row whose `compute_infrastructure_point_id` references an `InfrastructurePoint` with `point_kind = 'COMPUTE_CLUSTER'` (not `COMPUTE_RESOURCE`), and assert it loads correctly. Optionally cover the `COMPUTE_RESOURCE` case as a second test.
- Delete-and-replace test: save a populated model, call `saveModel(...)` again with a smaller payload, and assert the prior infrastructure rows are gone.
- Polymorphic CHECK test: assert at the JPA layer that an `InfrastructurePoint` with zero or multiple FK columns set, or with `point_kind` mismatched against the set FK, is rejected (constraint violation propagates).
- Existing test suite must continue to pass with no modifications to existing tests.

## Visual Design
N/A — backend-only spec, no UI artefacts. The reference design is the existing `data_entity_points` table and `DataEntityPointEntity` Java sources.

## Existing Code to Leverage

**`DataEntityPointEntity` and `data_entity_points` Liquibase changeset**
- Authoritative blueprint for `InfrastructurePointEntity` and `infrastructure_points`: copy the discriminator column shape, the exactly-one-FK CHECK constraint pattern, the 12 partial unique indexes pattern (`UNIQUE (model_file_id, <fk_id>) WHERE <fk_id> IS NOT NULL`), and the performance index on `model_file_id` verbatim.
- Do **not** copy `ApplicationPointEntity`'s hybrid `target_type`/`target_ref_id` style — that is the older design.

**Existing entity DTOs in `model/dto/entity/`**
- `BusinessProcessDto`, `ApplicationDto`, `DataEntityPointDto` are the records-with-`@JsonProperty("snake_case")` template for all 13 new entity DTOs.
- Booleans are nullable boxed `Boolean` per `DataMovementDto.biDirectional`; IDs are `String`; `model_file_id` is not exposed in DTOs.

**Existing relationship DTOs in `model/dto/relationship/`**
- `DataMovementDto` is the template for `ResourceSubnetHostingDto`, `DeploymentUnitComputeResourceDto`, and `LoadBalancerResourceRouteDto` — same record shape, same JSON property naming.

**Existing repositories in `repository/entity/` and `repository/relationship/`**
- Each existing repository extends `JpaRepository<TEntity, String>` and exposes `findByModelFileId` and `deleteByModelFileId` — copy this skeleton for all 16 new repositories. Add targeted finders only as tests demand.

**`ModelService.saveModel`, `loadModelByFileId`, `deleteAllDataForModelFile`**
- The per-domain repository invocation loops in these three methods are the integration points. Add 13 new entity repository calls and 3 new relationship repository calls into the existing iteration order; do not restructure.
- Existing delete order across `data_entity_points` → typed entity tables is the precedent for the infrastructure delete order (relationships → `infrastructure_points` → 12 entity tables in reverse dependency order).

## Out of Scope
- Frontend TypeScript types, frontend tables, frontend diagrams (separate spec increments 2-7 of this 7-spec series).
- Gateway proxies and routes for infrastructure endpoints.
- MCP tool surface for the infrastructure domain.
- Discovery-service changes (entity extraction, hint mapping, etc.).
- Terraform parsing, import, export, or generation.
- GCP-specific provisioning logic.
- Security group, firewall, or IAM modelling entities/relationships.
- "Data entity hosted on data store" relationship.
- Traffic flow relationship.
- Infrastructure resource dependency relationship.
