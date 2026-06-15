# Codebase Grounding Notes (Pass A)

These notes record the conventions discovered in `architecture-model-service/`
that will inform the Infrastructure-domain backend spec.

## Scoping convention
- All entity tables use a single `model_file_id TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE` column.
- Project + architecture scoping is achieved indirectly via `model_files`. There is NO `project_id` or `architecture_id` column on entity tables themselves — confirmed via `BusinessProcessEntity`, `ApplicationPointEntity`, `DataEntityPointEntity`.
- Therefore all new infrastructure entity + relationship tables should follow the same pattern: `model_file_id TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE`.

## Audit/metadata fields convention
- Standard fields on every entity: `name` (where applicable, NOT NULL), `description` TEXT nullable, `tags` TEXT nullable, `valid_from` TEXT nullable, `valid_to` TEXT nullable.
- There is NO `created_at` / `updated_at` audit column convention on entity tables. The raw idea's reference to "standard audit/metadata fields" maps to `tags`, `valid_from`, `valid_to` only.
- `tags` is stored as a single TEXT column (not a JSON column, not a separate tag-link table). Confirmed across `ApplicationEntity`, `BusinessProcessEntity`, `DataEntityPointEntity`, `InterfaceLogicalEntityDto`, etc. So the raw idea's "tags/metadata: object/map" should be persisted as a TEXT column (consumers serialise structured data into it as a string if needed) — matching existing convention.

## Polymorphic point pattern (the reference design)
`DataEntityPointEntity` is the closest analogue to the proposed `InfrastructurePointEntity`:
- Single table with one row per "pointed-at" entity.
- `point_kind` TEXT NOT NULL discriminator (e.g. `LOGICAL_ENTITY`, `PHYSICAL_ENTITY`).
- One nullable FK column per target type (`logical_entity_id`, `physical_entity_id`).
- DB-level CHECK constraint enforcing exactly one FK is set.
- Unique partial indexes per target FK (one row per (model_file_id, target_id)).
- Performance index on `model_file_id`.

`ApplicationPointEntity` uses a slightly different style: it stores `kind` plus `target_type` + `target_ref_id` (untyped string ref) in addition to typed FK columns for application/component/service/interface. It is hybrid (typed + opaque) and was extended in spec 016 retroactively — it is the older design.

→ Recommendation: model `InfrastructurePointEntity` after `DataEntityPointEntity` (typed-FK-per-target + discriminator + CHECK + partial unique indexes), not after `ApplicationPointEntity`.

## DTO conventions
- DTOs are Java records in `model/dto/entity/` (entity DTOs) and `model/dto/relationship/` (relationship DTOs).
- All fields use `@JsonProperty("snake_case")`.
- Booleans are nullable `Boolean` (boxed) at the DTO level (see `DataMovementDto.biDirectional`).
- IDs are always `String` at the DTO and entity level. No `UUID` typing.
- `model_file_id` is NOT exposed in DTOs — it is set server-side from the model file context.

## Repository conventions
- Located in `repository/entity/` (for entity tables) and `repository/relationship/` (for relationship tables).
- Each repository extends `JpaRepository<TEntity, String>`.
- Standard methods: `findByModelFileId(String modelFileId)`, `deleteByModelFileId(String modelFileId)`, plus targeted finders as needed.

## Liquibase changelog conventions
- Master file: `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml`.
- SQL files: `architecture-model-service/src/main/resources/db/changelog/sql/NNN-name.sql` with a sequential numeric prefix.
- Latest sequential prefix as of this spec: `097-architecture-id-auto-derive-trigger.sql` (currently 98 changeSets in master).
- One additional ad-hoc filename uses date prefix (`2026-04-20-tech-hints-resolved.sql`) but the dominant convention is `NNN-`.
- Each changeSet uses `preConditions: onFail: MARK_RAN` + `not: tableExists` (or `not: columnExists`) to be idempotent.
- → New infrastructure changesets should start at `098-` and follow the `NNN-name.sql` convention. Never edit applied changesets.

## ModelService save/load shape
- `ModelService.saveModel(...)` resolves a `modelFileId`, calls `deleteAllDataForModelFile(modelFileId)` (delete-and-replace semantics), then `saveEntities(...)`, `saveRelationships(...)`, `saveDiagrams(...)`.
- `loadModelByFileId(modelFileId)` builds a `MetaModelEntitiesDto` and `MetaModelRelationshipsDto` by calling `findByModelFileId(modelFileId)` on each repository.
- → All new infrastructure repositories must support `findByModelFileId` and `deleteByModelFileId` to slot into both halves of this loop.

## Application-domain target candidates for `Deployment Unit.application_entity`
The Application domain has these top-level entities (per `MetaModelEntitiesDto`):
- `applications` → `ApplicationDto`
- `app_components` → `ApplicationComponentDto`
- `services` → `ServiceDto`
- `application_points` → `ApplicationPointDto` (polymorphic across the above three)

`ApplicationPoint` is already the polymorphic-reference convention for "any application-domain thing" and is exactly the kind of FK target a deployment unit should use, mirroring how relationships across the codebase reference application-domain things via `application_point_id` rather than directly to `application_id` / `service_id`.

→ Recommendation: `Deployment Unit.application_point_id` (FK to `application_points.id`), nullable. This matches existing relationship conventions and avoids forcing a single application-domain type.

## Confidence / decimal conventions
- No existing entity uses a `confidence` decimal column. Closest precedent is in the discovery-service domain (`DiscoveryEvidenceEntity`, `DiscoveryRelationshipEntity`) which is out of scope for this spec.
- → No prior precedent inside the architecture-model-service to copy. Need a deliberate choice (DECIMAL precision, range validation behaviour).

## Cascade/delete semantics
- All entity FKs to `model_files(id)` use `ON DELETE CASCADE`.
- Cross-entity FKs (e.g. `data_entity_points.logical_entity_id REFERENCES logical_data_entities(id)`) use the default (NO ACTION) — relying on `ModelService.deleteAllDataForModelFile` to delete in the right order.
- → New infra tables follow same: `model_file_id` cascade; sibling FKs default NO ACTION.

## Naming preference
- Existing entity/table names are snake_case plural (`logical_data_entities`, `application_points`, `data_movements`). Suggested JSON names in the raw idea (`environments`, `cloud_accounts`, `subnets`, `compute_resources`, `deployment_units`, `load_balancers`, `listeners`, `data_store_instances`, `infrastructure_resources`, `infrastructure_points`, `resource_subnet_hostings`, `deployment_unit_compute_resources`, `load_balancer_resource_routes`) are consistent with this convention. Use as-is.
