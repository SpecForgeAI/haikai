# Spec Requirements: Infrastructure Domain Backend Foundation

## Initial Description

Add the backend model foundation for a sixth Architecture domain: Infrastructure, in the Spring Boot `architecture-model-service`. This includes:

- 12 new entities: Environment, Cloud Account, Location, Network, Subnet, Compute Cluster, Compute Resource, Deployment Unit, Load Balancer, Listener, Data Store Instance, Infrastructure Resource.
- A new polymorphic supertype `InfrastructurePoint` (analogous to `ApplicationPoint`, `BusinessPoint`, `DataEntityPoint`) that can reference any of the 12 entities.
- 3 new relationships: Resource hosted in Subnet, Deployment Unit runs on Compute, Load Balancer routes to Compute / Resource.
- Full save/load/delete-and-replace integration with `ModelService`, `MetaModelEntitiesDto`, `MetaModelRelationshipsDto`.
- Liquibase migrations starting at `098-` following existing `NNN-name.sql` conventions.

The full raw idea is preserved at `agent-os/specs/2026-05-04-infrastructure-domain-backend-foundation/planning/00-raw-idea.md`. Codebase conventions discovered during grounding are preserved at `planning/codebase-grounding.md`.

## Requirements Discussion

### First Round Questions

**Q1: Deployment Unit application linkage — direct typed FK to `services`, or polymorphic via `ApplicationPoint`?**
**Answer:** Use a direct typed FK `service_id` (FK to existing `services` table — the deployable service), nullable. **Not** `ApplicationPoint`.

**Q2: InfrastructurePoint discriminator style — `DataEntityPoint`-style typed-FK-per-target, or `ApplicationPoint`-style hybrid (typed FKs + opaque `target_type`/`target_ref_id`)?**
**Answer:** `DataEntityPoint`-style: `point_kind TEXT NOT NULL` discriminator + 12 nullable typed FK columns + DB-level `CHECK` constraint enforcing exactly one FK is set + per-FK partial unique indexes + a performance index on `model_file_id`. No opaque `target_type`/`target_ref_id` fallback.

**Q3: Where to use `InfrastructurePoint` versus a direct typed FK?**
**Answer:** Wherever a FK could sensibly be polymorphic (could reference more than one infrastructure entity type), use `InfrastructurePoint`. Where it is unambiguously one type, use a direct FK. The two FKs in the raw idea that explicitly call for `InfrastructurePoint` (`resource_subnet_hostings.infrastructure_point_id` for the hosted source, and `load_balancer_resource_routes.target_infrastructure_point_id` for the route target) are confirmed as polymorphic. Two further FKs flagged during the spec scan have now been resolved by the user (see **FK Ambiguity Decisions** below): `listeners.compute_resource_id` stays direct, `deployment_unit_compute_resources.compute_resource_id` is promoted to `InfrastructurePoint` (renamed `compute_infrastructure_point_id`).

**Q4: `confidence` column type and validation?**
**Answer:** `DECIMAL(4,3)`, nullable. **No** DB `CHECK` constraint. **No** JPA validation. Range guidance (0.0 - 1.0) is documentation only, enforced by callers if at all.

**Q5: `runtime_config` on `Deployment Unit runs on Compute` — JSONB or text blob (existing `tags` convention)?**
**Answer:** Postgres `JSONB` column, nullable. **This is a deliberate deviation** from the existing TEXT-blob `tags` convention used elsewhere in the service. It is the **only** JSONB column introduced by this spec. Rationale: `runtime_config` is structured key/value config that benefits from native JSONB query/index support; `tags` remains TEXT to match every other domain.

**Q6: Delete semantics — per-row cascade rules, or rely on existing `deleteAllDataForModelFile` delete-and-replace?**
**Answer:** Match existing domains. `model_file_id` FK uses `ON DELETE CASCADE`. All other (sibling) FKs use the default `NO ACTION` and rely on `ModelService.deleteAllDataForModelFile(modelFileId)` to delete in dependency order. No per-row cascade beyond `model_file_id`.

**Q7: `environment_id` on the three relationships — keep on every relationship, or hoist to the entity end and drop from the relationship?**
**Answer:** Keep `environment_id` on **all three relationships** (matching the raw idea exactly). Rationale:
1. The raw idea is explicit about it.
2. It makes environment-scoped relationship queries cheap without additional joins.
3. It is consistent with the user's pattern of carrying environment scope on infrastructure data.
Caller is responsible for cross-row consistency (e.g. that `relationship.environment_id` matches its endpoints' environments). No DB-level cross-row check is added.

**Q8: Anything else explicitly out of scope beyond the raw idea's existing list?**
**Answer:** Nothing else. The raw idea's Out of Scope list is the complete set of exclusions.

### Inferred Decisions (all 17 accepted)

These were inferred from the codebase grounding and accepted by the user without override:

1. **`model_file_id` scoping** — every new entity and relationship table has `model_file_id TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE`. No `project_id` / `architecture_id` columns on the tables themselves (scoping is indirect via `model_files`).
2. **Standard entity columns** — `name` NOT NULL where applicable, `description` TEXT nullable, `tags` TEXT nullable, `valid_from` TEXT nullable, `valid_to` TEXT nullable. No `created_at` / `updated_at`.
3. **`tags` storage** — single TEXT column (not JSON, not link table). Consumers serialise structured data as a string. Matches every other entity.
4. **ID typing** — all primary keys are `String` (TEXT) at DTO and entity level. No `UUID`.
5. **DTO style** — Java records in `model/dto/entity/` and `model/dto/relationship/`, with `@JsonProperty("snake_case")` on every field.
6. **Boolean DTO style** — boxed `Boolean` (nullable) at the DTO level (per `DataMovementDto.biDirectional`).
7. **`model_file_id` is server-side only** — not exposed in DTOs.
8. **Repositories** — extend `JpaRepository<TEntity, String>`; provide `findByModelFileId(String)` and `deleteByModelFileId(String)` plus targeted finders as needed.
9. **`InfrastructurePoint` modelled after `DataEntityPointEntity`** (typed-FK-per-target + discriminator + CHECK + partial unique indexes + perf index on `model_file_id`), **not** after `ApplicationPointEntity`.
10. **Polymorphic CHECK constraint** — exactly one of the 12 typed FKs on `infrastructure_points` must be set per row.
11. **Partial unique indexes per typed FK on `infrastructure_points`** — one row per `(model_file_id, target_id)` for each target FK, matching `data_entity_points` style.
12. **Performance index** on `infrastructure_points(model_file_id)`.
13. **Snake_case plural table names and JSON names** (`environments`, `cloud_accounts`, `locations`, `networks`, `subnets`, `compute_clusters`, `compute_resources`, `deployment_units`, `load_balancers`, `listeners`, `data_store_instances`, `infrastructure_resources`, `infrastructure_points`, `resource_subnet_hostings`, `deployment_unit_compute_resources`, `load_balancer_resource_routes`).
14. **Liquibase changelog convention** — sequential `NNN-name.sql` files in `src/main/resources/db/changelog/sql/`, registered in `db.changelog-master.yaml`. Start at `098-` (latest applied is `097-architecture-id-auto-derive-trigger.sql`). Each changeSet uses `preConditions: onFail: MARK_RAN` with `not: tableExists`. Never edit applied changesets.
15. **Save pipeline integration** — `ModelService.saveModel(...)` calls `deleteAllDataForModelFile(modelFileId)` then `saveEntities(...)`/`saveRelationships(...)`/`saveDiagrams(...)`. New infra repositories must be invoked in both halves.
16. **Load pipeline integration** — `loadModelByFileId(modelFileId)` populates `MetaModelEntitiesDto` (extended with 13 new lists) and `MetaModelRelationshipsDto` (extended with 3 new lists), each via `findByModelFileId`.
17. **Cross-entity FK delete behaviour** — sibling FKs default to `NO ACTION`; only `model_file_id` cascades. `ModelService.deleteAllDataForModelFile` is responsible for delete order.

### Existing Code to Reference

The user did not provide explicit paths but the codebase grounding identified the following reference points:

- **Polymorphic point reference design**: `architecture-model-service/src/main/java/.../entity/DataEntityPointEntity.java` and changeset `data_entity_points` table — the authoritative pattern for `InfrastructurePoint`.
- **DTO record pattern**: `architecture-model-service/src/main/java/.../model/dto/entity/*.java` (e.g. `BusinessProcessDto`, `ApplicationDto`, `DataEntityPointDto`).
- **Relationship DTO pattern**: `architecture-model-service/src/main/java/.../model/dto/relationship/*.java` (e.g. `DataMovementDto`).
- **Repository pattern**: `architecture-model-service/src/main/java/.../repository/entity/*Repository.java` and `.../repository/relationship/*Repository.java`.
- **Save/load pipeline**: `architecture-model-service/src/main/java/.../service/ModelService.java` (`saveModel`, `loadModelByFileId`, `deleteAllDataForModelFile`, `saveEntities`, `saveRelationships`).
- **Meta-model DTOs**: `MetaModelEntitiesDto`, `MetaModelRelationshipsDto` (must be extended).
- **Liquibase master**: `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml`. Latest applied changeset: `097-architecture-id-auto-derive-trigger.sql`.

The user explicitly delegated FK / direct-vs-polymorphic ambiguity to the spec-research scan; the two flagged FKs are now resolved in **FK Ambiguity Decisions** below.

### Follow-up Questions

No follow-up questions were asked beyond the eight above; the user accepted all 17 inferred decisions and provided concrete answers on all eight open questions. The two FK ambiguities flagged during the scan have since been resolved (see **FK Ambiguity Decisions**).

## Visual Assets

### Files Provided

Bash check on `agent-os/specs/2026-05-04-infrastructure-domain-backend-foundation/planning/visuals/` returned no image/PDF files.

No visual assets provided.

### Visual Insights

N/A — backend-only spec, no UI artefacts. Reference design is the existing `data_entity_points` table and `DataEntityPointEntity` Java sources.

## Requirements Summary

### Functional Requirements

The backend service must support:

1. **Persisting and returning** the 12 new infrastructure entities as part of the architecture meta-model.
2. **Persisting and returning** the 3 new infrastructure relationships as part of the architecture meta-model.
3. **`InfrastructurePoint`** as a polymorphic supertype able to reference any of the 12 infrastructure entities, using the `DataEntityPoint`-style design.
4. **Polymorphic relationship references** via `InfrastructurePoint` on all three relationships:
   - `resource_subnet_hostings.infrastructure_point_id` (hosted source).
   - `deployment_unit_compute_resources.compute_infrastructure_point_id` (compute target — Compute Resource OR Compute Cluster).
   - `load_balancer_resource_routes.target_infrastructure_point_id` (route target).
5. **Save / load / delete-and-replace** integration with `ModelService` matching every other domain's behaviour.
6. **`MetaModelEntitiesDto` extension** with 13 new lists (12 entity types + `infrastructure_points`) using snake_case JSON names.
7. **`MetaModelRelationshipsDto` extension** with 3 new relationship lists using snake_case JSON names.
8. **Project + architecture scoping** preserved via `model_file_id` (no new `project_id` / `architecture_id` columns on infra tables).
9. **Backward compatibility** — existing Business, Application, Data, Behavioural, and UI domains' load/save behaviour unchanged; existing tests continue to pass.
10. **Liquibase migrations** create the new tables idempotently without breaking existing data.
11. **New backend tests** cover (a) basic save/load round-trip for the infrastructure domain and (b) at least one relationship using `InfrastructurePoint` polymorphically.

### Entity Specifications

All entities include the standard envelope: `id TEXT PRIMARY KEY`, `model_file_id TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE`, `name TEXT NOT NULL` (where applicable), `description TEXT NULL`, `tags TEXT NULL`, `valid_from TEXT NULL`, `valid_to TEXT NULL`. Additional columns are listed below. All enum-style columns are stored as TEXT (no DB enum types). All booleans are nullable `Boolean` at the DTO level.

#### 1. `environments`
- `environment_type` TEXT — DEV, TEST, STAGING, PROD, DR, CURRENT_STATE, TARGET_STATE, OTHER
- `lifecycle_state` TEXT — PLANNED, ACTIVE, DEPRECATED, RETIRED
- `is_current_state` BOOLEAN
- `is_target_state` BOOLEAN
- `owner` TEXT NULL
- `criticality` TEXT NULL — LOW, MEDIUM, HIGH, CRITICAL

#### 2. `cloud_accounts`
- `environment_id` TEXT NOT NULL → `environments(id)`
- `provider` TEXT — GCP, AWS, AZURE, ON_PREM, OTHER
- `external_account_id` TEXT NULL
- `parent_org_id` TEXT NULL
- `billing_owner` TEXT NULL
- `technical_owner` TEXT NULL
- `landing_zone_name` TEXT NULL

#### 3. `locations`
- `environment_id` TEXT NOT NULL → `environments(id)`
- `cloud_account_id` TEXT NULL → `cloud_accounts(id)`
- `location_type` TEXT — CLOUD_REGION, CLOUD_ZONE, DATA_CENTRE, OFFICE, EDGE_SITE, OTHER
- `provider` TEXT NULL
- `provider_region_code` TEXT NULL
- `provider_zone_code` TEXT NULL
- `country` TEXT NULL
- `city` TEXT NULL
- `address` TEXT NULL

#### 4. `networks`
- `environment_id` TEXT NOT NULL → `environments(id)`
- `cloud_account_id` TEXT NULL → `cloud_accounts(id)`
- `location_id` TEXT NULL → `locations(id)`
- `network_type` TEXT — VPC, VNET, ON_PREM_NETWORK, LAN, WAN, OTHER
- `provider` TEXT NULL
- `cidr` TEXT NULL
- `external_id` TEXT NULL
- `is_shared` BOOLEAN
- `routing_mode` TEXT NULL — REGIONAL, GLOBAL, STATIC, DYNAMIC, OTHER

#### 5. `subnets`
- `environment_id` TEXT NOT NULL → `environments(id)`
- `network_id` TEXT NOT NULL → `networks(id)`
- `location_id` TEXT NULL → `locations(id)`
- `cidr` TEXT NULL
- `subnet_type` TEXT — PUBLIC, PRIVATE, APP, DATA, MANAGEMENT, DMZ, OTHER
- `visibility` TEXT — PUBLIC, PRIVATE, ISOLATED, INTERNAL, OTHER
- `provider_region_code` TEXT NULL
- `provider_zone_code` TEXT NULL
- `external_id` TEXT NULL
- `gateway_address` TEXT NULL

#### 6. `compute_clusters`
- `environment_id` TEXT NOT NULL → `environments(id)`
- `cloud_account_id` TEXT NULL → `cloud_accounts(id)`
- `location_id` TEXT NULL → `locations(id)`
- `network_id` TEXT NULL → `networks(id)`
- `platform_type` TEXT — GKE, KUBERNETES, CLOUD_RUN, VMWARE, OPENSHIFT, SERVER_FARM, OTHER
- `provider` TEXT NULL
- `version` TEXT NULL
- `external_id` TEXT NULL
- `owner` TEXT NULL
- `operating_model` TEXT NULL — MANAGED, SELF_MANAGED, HYBRID, OTHER

#### 7. `compute_resources`
- `environment_id` TEXT NOT NULL → `environments(id)`
- `cloud_account_id` TEXT NULL → `cloud_accounts(id)`
- `location_id` TEXT NULL → `locations(id)`
- `cluster_id` TEXT NULL → `compute_clusters(id)`
- `compute_type` TEXT — VM, PHYSICAL_SERVER, CONTAINER_SERVICE, KUBERNETES_WORKLOAD, SERVERLESS_FUNCTION, CLOUD_RUN_SERVICE, BATCH_JOB, OTHER
- `provider` TEXT NULL
- `hostname` TEXT NULL
- `fqdn` TEXT NULL
- `private_ip` TEXT NULL
- `public_ip` TEXT NULL
- `os` TEXT NULL
- `runtime` TEXT NULL
- `instance_size` TEXT NULL
- `scaling_min` INTEGER NULL
- `scaling_max` INTEGER NULL
- `external_id` TEXT NULL
- `lifecycle_state` TEXT NULL
- `owner` TEXT NULL

#### 8. `deployment_units`
- **`service_id` TEXT NULL → `services(id)`** — direct typed FK (Q1 decision; **not** `ApplicationPoint`).
- `deployment_unit_type` TEXT — CONTAINER_IMAGE, VM_IMAGE, FUNCTION_BUNDLE, JAR, WAR, STATIC_BUNDLE, PACKAGE, OTHER
- `version` TEXT NULL
- `artifact_uri` TEXT NULL
- `image_name` TEXT NULL
- `image_tag` TEXT NULL
- `source_repository` TEXT NULL
- `source_commit` TEXT NULL
- `build_pipeline` TEXT NULL
- `owner` TEXT NULL

#### 9. `load_balancers`
- `environment_id` TEXT NOT NULL → `environments(id)`
- `cloud_account_id` TEXT NULL → `cloud_accounts(id)`
- `location_id` TEXT NULL → `locations(id)`
- `network_id` TEXT NULL → `networks(id)`
- `load_balancer_type` TEXT — EXTERNAL_HTTP, EXTERNAL_HTTPS, INTERNAL_HTTP, INTERNAL_TCP, INGRESS_CONTROLLER, F5, NGINX, API_GATEWAY, OTHER
- `provider` TEXT NULL
- `exposure` TEXT — PUBLIC, PRIVATE, INTERNAL, OTHER
- `scheme` TEXT NULL
- `dns_name` TEXT NULL
- `ip_address` TEXT NULL
- `external_id` TEXT NULL
- `owner` TEXT NULL

#### 10. `listeners`
- `environment_id` TEXT NOT NULL → `environments(id)`
- `load_balancer_id` TEXT NULL → `load_balancers(id)`
- **`compute_resource_id` TEXT NULL → `compute_resources(id)`** — direct typed FK (A1 decision: kept direct, **not** promoted to `InfrastructurePoint`). Listener attaches only to a Compute Resource; polymorphic routing targets are covered by `load_balancer_resource_routes.target_infrastructure_point_id`.
- `protocol` TEXT — HTTP, HTTPS, TCP, UDP, TLS, GRPC, OTHER
- `port` INTEGER NULL
- `host_name` TEXT NULL
- `path_pattern` TEXT NULL
- `exposure` TEXT — PUBLIC, PRIVATE, INTERNAL, OTHER
- `is_public` BOOLEAN
- `certificate_reference` TEXT NULL
- `external_id` TEXT NULL

#### 11. `data_store_instances`
- `environment_id` TEXT NOT NULL → `environments(id)`
- `cloud_account_id` TEXT NULL → `cloud_accounts(id)`
- `location_id` TEXT NULL → `locations(id)`
- `data_store_type` TEXT — RELATIONAL_DB, DOCUMENT_DB, KEY_VALUE, CACHE, DATA_WAREHOUSE, OBJECT_STORAGE_AS_DATASTORE, OTHER
- `engine` TEXT NULL — POSTGRES, MYSQL, ORACLE, SQLSERVER, BIGQUERY, REDIS, MONGODB, OTHER
- `engine_version` TEXT NULL
- `provider` TEXT NULL
- `host` TEXT NULL
- `port` INTEGER NULL
- `external_id` TEXT NULL
- `encrypted` BOOLEAN
- `ha_enabled` BOOLEAN
- `backup_enabled` BOOLEAN
- `owner` TEXT NULL

#### 12. `infrastructure_resources`
- `environment_id` TEXT NOT NULL → `environments(id)`
- `cloud_account_id` TEXT NULL → `cloud_accounts(id)`
- `location_id` TEXT NULL → `locations(id)`
- `resource_type` TEXT — OBJECT_BUCKET, MESSAGE_TOPIC, MESSAGE_QUEUE, CACHE, SECRET_STORE, SCHEDULER, EVENT_BUS, CDN, REGISTRY, OTHER
- `provider` TEXT NULL
- `provider_resource_type` TEXT NULL
- `endpoint` TEXT NULL
- `external_id` TEXT NULL
- `criticality` TEXT NULL
- `owner` TEXT NULL

#### 13. `infrastructure_points` (polymorphic supertype)
- `id` TEXT PRIMARY KEY
- `model_file_id` TEXT NOT NULL → `model_files(id) ON DELETE CASCADE`
- `point_kind` TEXT NOT NULL — discriminator, one of: `ENVIRONMENT`, `CLOUD_ACCOUNT`, `LOCATION`, `NETWORK`, `SUBNET`, `COMPUTE_CLUSTER`, `COMPUTE_RESOURCE`, `DEPLOYMENT_UNIT`, `LOAD_BALANCER`, `LISTENER`, `DATA_STORE_INSTANCE`, `INFRASTRUCTURE_RESOURCE`
- 12 nullable typed FK columns: `environment_id`, `cloud_account_id`, `location_id`, `network_id`, `subnet_id`, `compute_cluster_id`, `compute_resource_id`, `deployment_unit_id`, `load_balancer_id`, `listener_id`, `data_store_instance_id`, `infrastructure_resource_id` — each FK references the corresponding entity table.
- DB-level `CHECK` constraint enforcing exactly one of the 12 FK columns is non-null (and that the non-null FK matches `point_kind`).
- 12 partial unique indexes — one per FK column — `UNIQUE (model_file_id, <fk_id>) WHERE <fk_id> IS NOT NULL`.
- Performance index on `infrastructure_points(model_file_id)`.

### Relationship Specifications

All three relationships include: `id` TEXT PRIMARY KEY, `model_file_id` TEXT NOT NULL → `model_files(id) ON DELETE CASCADE`, `tags` TEXT NULL.

All three relationships use `InfrastructurePoint` on at least one end. See the **InfrastructurePoint usage summary** below.

#### R1. `resource_subnet_hostings`

| Column | Type | Nullable | References | Notes |
|---|---|---|---|---|
| `id` | TEXT | NO (PK) | — | |
| `model_file_id` | TEXT | NO | `model_files(id) ON DELETE CASCADE` | |
| `infrastructure_point_id` | TEXT | NO | `infrastructure_points(id)` | Polymorphic source (the hosted resource). Allowed `point_kind` values: any infrastructure entity that can be subnet-hosted (callers are responsible for choosing meaningful kinds; not enforced at DB level). |
| `subnet_id` | TEXT | NO | `subnets(id)` | |
| `environment_id` | TEXT | NO | `environments(id)` | Kept per Q7. |
| `relationship_role` | TEXT | YES | — | PRIMARY_PLACEMENT, PRIVATE_CONNECTIVITY, BACKEND_PLACEMENT, OTHER. |
| `primary_ip` | TEXT | YES | — | |
| `private_ip` | TEXT | YES | — | |
| `public_ip` | TEXT | YES | — | |
| `evidence_source` | TEXT | YES | — | |
| `confidence` | DECIMAL(4,3) | YES | — | No DB CHECK; no JPA validation. |
| `tags` | TEXT | YES | — | |

#### R2. `deployment_unit_compute_resources`

This is the **second** of the three relationships using `InfrastructurePoint` (alongside `resource_subnet_hostings` and `load_balancer_resource_routes`). Per A2, the compute end is polymorphic to allow attachment at either Compute Resource or Compute Cluster level.

| Column | Type | Nullable | References | Notes |
|---|---|---|---|---|
| `id` | TEXT | NO (PK) | — | |
| `model_file_id` | TEXT | NO | `model_files(id) ON DELETE CASCADE` | |
| `deployment_unit_id` | TEXT | NO | `deployment_units(id)` | |
| `compute_infrastructure_point_id` | TEXT | NO | `infrastructure_points(id)` | **Polymorphic compute target** (A2 decision; renamed from `compute_resource_id`). Allowed `point_kind` values for this relationship: **`COMPUTE_RESOURCE`** or **`COMPUTE_CLUSTER`**. This relationship-level allowed-kinds restriction is documented here for callers/spec-writer; it does **not** require a separate DB CHECK in this spec — the existing exactly-one-FK CHECK on `infrastructure_points` is sufficient at the point row level. JSON property name: `compute_infrastructure_point_id`. |
| `environment_id` | TEXT | NO | `environments(id)` | Kept per Q7. |
| `version` | TEXT | YES | — | |
| `runtime_config` | JSONB | YES | — | **Only JSONB column in this spec** — deviation from TEXT-blob convention (Q5). |
| `desired_instances` | INTEGER | YES | — | |
| `min_instances` | INTEGER | YES | — | |
| `max_instances` | INTEGER | YES | — | |
| `deployment_status` | TEXT | YES | — | PLANNED, DEPLOYED, DEPRECATED, FAILED, UNKNOWN. |
| `evidence_source` | TEXT | YES | — | |
| `confidence` | DECIMAL(4,3) | YES | — | No DB CHECK; no JPA validation. |
| `tags` | TEXT | YES | — | |

DTO field name: `compute_infrastructure_point_id` (`@JsonProperty("compute_infrastructure_point_id")`). Java field: `computeInfrastructurePointId`.

#### R3. `load_balancer_resource_routes`

| Column | Type | Nullable | References | Notes |
|---|---|---|---|---|
| `id` | TEXT | NO (PK) | — | |
| `model_file_id` | TEXT | NO | `model_files(id) ON DELETE CASCADE` | |
| `load_balancer_id` | TEXT | NO | `load_balancers(id)` | |
| `listener_id` | TEXT | YES | `listeners(id)` | |
| `target_infrastructure_point_id` | TEXT | NO | `infrastructure_points(id)` | Polymorphic target (Compute Resource, Compute Cluster, Deployment Unit, Infrastructure Resource, etc. — caller's choice). |
| `environment_id` | TEXT | NO | `environments(id)` | Kept per Q7. |
| `protocol` | TEXT | YES | — | |
| `target_port` | INTEGER | YES | — | |
| `host_name` | TEXT | YES | — | |
| `path_pattern` | TEXT | YES | — | |
| `routing_type` | TEXT | YES | — | DEFAULT, HOST_BASED, PATH_BASED, WEIGHTED, FAILOVER, OTHER. |
| `weight` | INTEGER | YES | — | |
| `health_check_path` | TEXT | YES | — | |
| `tags` | TEXT | YES | — | |

### InfrastructurePoint usage summary

After the FK ambiguity decisions, **all 3 of 3 relationships** use `InfrastructurePoint` on at least one end:

| Relationship | InfrastructurePoint column | Allowed `point_kind` values (relationship-level guidance) |
|---|---|---|
| `resource_subnet_hostings` | `infrastructure_point_id` | Caller's choice across infrastructure entity kinds. |
| `deployment_unit_compute_resources` | `compute_infrastructure_point_id` | `COMPUTE_RESOURCE` or `COMPUTE_CLUSTER` only. |
| `load_balancer_resource_routes` | `target_infrastructure_point_id` | Caller's choice across infrastructure entity kinds. |

The `InfrastructurePoint` row itself is governed by the exactly-one-FK CHECK on `infrastructure_points`. Relationship-level allowed-kinds restrictions (e.g. R2's `COMPUTE_RESOURCE | COMPUTE_CLUSTER`) are documented here for spec-writer/test-writer reference and are **not** enforced by an additional DB CHECK in this spec.

### Liquibase Changeset Plan

Sequential filenames in `architecture-model-service/src/main/resources/db/changelog/sql/`, each registered in `db.changelog-master.yaml`. Each changeSet uses `preConditions: onFail: MARK_RAN` with `not: tableExists`. Never edit applied changesets.

| # | Filename | Purpose |
|---|---|---|
| 098 | `098-environments.sql` | `environments` table |
| 099 | `099-cloud-accounts.sql` | `cloud_accounts` table |
| 100 | `100-locations.sql` | `locations` table |
| 101 | `101-networks.sql` | `networks` table |
| 102 | `102-subnets.sql` | `subnets` table |
| 103 | `103-compute-clusters.sql` | `compute_clusters` table |
| 104 | `104-compute-resources.sql` | `compute_resources` table |
| 105 | `105-deployment-units.sql` | `deployment_units` table (with `service_id` FK) |
| 106 | `106-load-balancers.sql` | `load_balancers` table |
| 107 | `107-listeners.sql` | `listeners` table (with direct `compute_resource_id` FK per A1) |
| 108 | `108-data-store-instances.sql` | `data_store_instances` table |
| 109 | `109-infrastructure-resources.sql` | `infrastructure_resources` table |
| 110 | `110-infrastructure-points.sql` | `infrastructure_points` table (12 typed FKs + CHECK + 12 partial unique indexes + perf index) |
| 111 | `111-resource-subnet-hostings.sql` | `resource_subnet_hostings` relationship (`infrastructure_point_id` polymorphic source) |
| 112 | `112-deployment-unit-compute-resources.sql` | `deployment_unit_compute_resources` relationship — **`compute_infrastructure_point_id` FK to `infrastructure_points`** (A2), JSONB `runtime_config`, plus `deployment_unit_id`, `environment_id`, version/scaling/status/evidence/confidence/tags columns. No additional DB CHECK on point_kind; relationship-level allowed-kinds (`COMPUTE_RESOURCE` / `COMPUTE_CLUSTER`) is documentation-only. |
| 113 | `113-load-balancer-resource-routes.sql` | `load_balancer_resource_routes` relationship (`target_infrastructure_point_id` polymorphic target) |

Order rationale: each table's typed sibling FKs reference earlier-created tables (Environment first, then CloudAccount/Location which depend on Environment, etc.). `infrastructure_points` is created after all 12 entity tables it references. Relationships come last because they reference both entity tables and `infrastructure_points`.

### Reusability Opportunities

- **`DataEntityPointEntity` + `data_entity_points` table** as the authoritative blueprint for `InfrastructurePointEntity` + `infrastructure_points`. Copy the partial-unique-index pattern, the CHECK constraint pattern, and the discriminator column verbatim.
- **DTO records and `@JsonProperty("snake_case")` style** from `model/dto/entity/` and `model/dto/relationship/`.
- **Repository skeletons** (`findByModelFileId`, `deleteByModelFileId`) from any existing `*Repository` in `repository/entity/` or `repository/relationship/`.
- **`ModelService` save/load slots** — the existing loop iterating per-domain repositories during `saveModel` / `loadModelByFileId` / `deleteAllDataForModelFile` is the integration point; add 13 new entity calls and 3 new relationship calls.
- **`MetaModelEntitiesDto` / `MetaModelRelationshipsDto`** — extend with new lists; do not restructure.

### Scope Boundaries

**In Scope:**
- 12 new entity tables + JPA entities + DTOs + repositories.
- 1 new polymorphic supertype table `infrastructure_points` + entity + DTO + repository.
- 3 new relationship tables + JPA entities + DTOs + repositories — all 3 use `InfrastructurePoint` on at least one end.
- `MetaModelEntitiesDto` and `MetaModelRelationshipsDto` extension with snake_case JSON names.
- `ModelService` integration for save / load / delete-and-replace.
- 16 Liquibase changesets (`098-` through `113-`).
- Backend tests for save/load round-trip and at least one polymorphic `InfrastructurePoint` relationship use.

**Out of Scope** (verbatim from raw idea, plus user confirmation that nothing else is excluded):
- Frontend TypeScript types.
- Frontend tables.
- Frontend diagrams.
- Gateway changes.
- MCP tools.
- Discovery-service changes.
- Terraform parsing/import/export.
- GCP-specific provisioning.
- Security group / firewall / IAM modelling.
- Data entity hosted on data store relationship.
- Traffic flow relationship.
- Infrastructure resource dependency relationship.

### Technical Considerations

- **JSONB deviation**: `deployment_unit_compute_resources.runtime_config` is the only JSONB column introduced. All other "tags/metadata: object/map" fields use the existing TEXT `tags` convention.
- **No DB-level `confidence` validation**: `DECIMAL(4,3)` only; no CHECK; no JPA `@DecimalMin/@DecimalMax`. Range guidance is documentation-only.
- **`environment_id` consistency**: caller-enforced. No DB cross-row check on relationships.
- **Indexes**: per-`model_file_id` indexes on entity tables follow whatever the existing convention does for sibling entity tables (the spec author should mirror existing tables on this point; if there is no consistent convention, add one perf index per new table to support `findByModelFileId`).
- **Polymorphic CHECK on `infrastructure_points`** must enforce both (a) exactly-one-FK-set and (b) consistency between `point_kind` and the set FK.
- **Relationship-level allowed `point_kind` values** (e.g. R2's `COMPUTE_RESOURCE | COMPUTE_CLUSTER`) are documentation-only; they are not enforced by an additional DB CHECK in this spec. Test coverage should include at least one valid kind for each restricted relationship and may optionally assert caller-side rejection of disallowed kinds.

## Acceptance Criteria

(Copied from raw idea; preserved verbatim.)

- The backend can persist and return the new Infrastructure entities as part of the architecture meta-model.
- The backend can persist and return the three Infrastructure relationships as part of the architecture meta-model.
- `InfrastructurePoint` exists and follows the same architectural style as the existing point/supertype abstractions.
- Infrastructure relationships can use `InfrastructurePoint` where polymorphic infrastructure references are required.
- Existing Business, Application, Data, Behavioural, and UI model load/save behavior remains unchanged.
- Existing tests continue to pass.
- New backend tests cover basic save/load round trip for the Infrastructure domain model.
- New backend tests cover at least one relationship that references `InfrastructurePoint` polymorphically.
- Migrations create the required persistence structures without breaking existing data.
- Terraform import/generation is left for a later spec.

## FK Ambiguity Decisions (resolved)

The Q3 scan across all FKs found two FKs that were genuinely ambiguous between "direct typed FK" and "`InfrastructurePoint` polymorphic FK". The user has now resolved both. All other FKs in the spec are clearly single-target and are direct.

### A1. `listeners.compute_resource_id` — DECISION: **direct FK (kept)**

- **Outcome**: `compute_resource_id TEXT NULL → compute_resources(id)`. Listener attaches only to a Compute Resource directly.
- **Rationale (accepted)**: The raw idea explicitly types it that way. Polymorphic routing targets are already covered by `load_balancer_resource_routes.target_infrastructure_point_id` — a Listener that needs to expose multiple kinds of targets does so via routes. Promoting Listener's compute attachment to polymorphic adds complexity without a concrete V1 use case.
- **Impact**: No change to the draft. Column, JSON name, and Java field remain `compute_resource_id` / `computeResourceId`. Listener's Liquibase changeset (`107-listeners.sql`) authors a direct FK to `compute_resources`.

### A2. `deployment_unit_compute_resources.compute_resource_id` — DECISION: **promote to `InfrastructurePoint`**

- **Outcome**: Column renamed to **`compute_infrastructure_point_id TEXT NOT NULL → infrastructure_points(id)`**.
- **Allowed `point_kind` values for this relationship**: **`COMPUTE_RESOURCE`** or **`COMPUTE_CLUSTER`** only. This is a relationship-level restriction documented in requirements; it is **not** enforced by a separate DB CHECK in this spec. The existing exactly-one-FK CHECK on `infrastructure_points` already enforces correctness at the point row level.
- **JSON property name**: `compute_infrastructure_point_id`. Java field: `computeInfrastructurePointId`.
- **Rationale (accepted)**: The relationship is verbally "runs on **Compute**" (not "runs on Compute Resource"). For container/Kubernetes/serverless deployment models, attaching a deployment unit at cluster level without a specific resource is a real and common case in V1. Promoting now avoids a future migration.
- **Impact**:
  - This is the second of three relationships using `InfrastructurePoint`; combined with `resource_subnet_hostings` and `load_balancer_resource_routes`, **all 3 of 3 relationships use `InfrastructurePoint` on at least one end**.
  - Relationship attribute table for `deployment_unit_compute_resources` (above) updated.
  - Liquibase changeset `112-deployment-unit-compute-resources.sql` authors `compute_infrastructure_point_id` as a NOT NULL FK to `infrastructure_points(id)` (no separate DB CHECK on `point_kind`).
  - DTO and entity field renamed accordingly.
  - `MetaModelRelationshipsDto` list shape unchanged (still one list for this relationship); only the inner DTO field name differs from the original draft.
