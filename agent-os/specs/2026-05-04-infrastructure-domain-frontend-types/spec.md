# Specification: Infrastructure Domain Frontend Types

## Goal
Make the React/TypeScript frontend type-aware of the new Infrastructure domain so it can safely load, hold, and save Infrastructure data via the existing architecture model APIs, with no UI surface (tables, diagrams, palette sections, routes) introduced in this spec.

## User Stories
- As a frontend developer, I want TypeScript interfaces and meta-model arrays for the 12 Infrastructure entities, `InfrastructurePoint`, and 3 relationships so the existing model API client can carry Infrastructure data end-to-end without `any` casts.
- As a user with an older saved project, I want loading my project to keep working after the Infrastructure domain ships so that missing Infrastructure arrays are normalised to empty arrays instead of crashing.

## Specific Requirements

**12 entity interfaces + `InfrastructurePoint` + 3 relationship interfaces in `model.ts`**
- Add 12 entity interfaces (`Environment`, `CloudAccount`, `Location`, `Network`, `Subnet`, `ComputeCluster`, `ComputeResource`, `DeploymentUnit`, `LoadBalancer`, `Listener`, `DataStoreInstance`, `InfrastructureResource`) with the standard envelope (`id: string`, `name: string`, `description: string`, `tags: string`, `valid_from?: string`, `valid_to?: string`) plus the per-entity fields locked in `requirements.md` "TypeScript Type Inventory".
- All field names are snake_case to match backend JSON keys exactly. `model_file_id` is server-side only and MUST NOT appear on any frontend interface.
- `DeploymentUnit` exposes `service_id?: string` (NOT `application_entity_id`); `Listener` exposes a direct `compute_resource_id?: string`.
- Add `InfrastructurePoint` modelled on `BusinessPoint` (model.ts:237): `id`, required `name`, `description`, 12 optional typed FK fields, `tags: string`, `valid_from?`, `valid_to?`, plus a `point_kind: InfrastructurePointKind` discriminator. Do NOT copy `ApplicationPoint`'s deprecated `target_type` / `target_ref_id` / `point_type` legacy fields.
- Declare `InfrastructurePointKind` as a string-literal union of the 12 backend values: `'ENVIRONMENT' | 'CLOUD_ACCOUNT' | 'LOCATION' | 'NETWORK' | 'SUBNET' | 'COMPUTE_CLUSTER' | 'COMPUTE_RESOURCE' | 'DEPLOYMENT_UNIT' | 'LOAD_BALANCER' | 'LISTENER' | 'DATA_STORE_INSTANCE' | 'INFRASTRUCTURE_RESOURCE'`. This is the only string-literal union introduced; all other enum-style fields are `?: string`.
- Add 3 relationship interfaces using `DataMovement` (model.ts:1325) as template: `ResourceSubnetHosting` (key `resource_subnet_hostings`, polymorphic source via `infrastructure_point_id: string`), `DeploymentUnitComputeResource` (key `deployment_unit_compute_resources`, polymorphic via `compute_infrastructure_point_id: string`, plus `runtime_config?: Record<string, unknown> | null`), `LoadBalancerResourceRoute` (key `load_balancer_resource_routes`, polymorphic via `target_infrastructure_point_id: string`). All three require `environment_id: string` (backend NOT NULL) and `tags: string`.
- `confidence?: number` on `ResourceSubnetHosting` and `DeploymentUnitComputeResource` (DECIMAL(4,3) on backend → `number` on frontend).

**Meta-model + union type extensions in `model.ts`**
- Extend `MetaModelEntities` (lines 2151-2188) with 13 new array fields: `environments`, `cloud_accounts`, `locations`, `networks`, `subnets`, `compute_clusters`, `compute_resources`, `deployment_units`, `load_balancers`, `listeners`, `data_store_instances`, `infrastructure_resources`, `infrastructure_points`.
- Extend `MetaModelRelationships` (lines 2190-2206) with 3 new array fields: `resource_subnet_hostings`, `deployment_unit_compute_resources`, `load_balancer_resource_routes`.
- Extend the `EntityType` string union (lines 2220-2266) with the 13 new entity type strings, and `RelationshipType` with the 3 new relationship type strings.
- Extend the `AnyEntity` discriminated union (lines 2269-2313) with the 13 new entity interfaces and `AnyRelationship` with the 3 new relationship interfaces.

**`ArchitectureDomain` extension in `architectureDomain.ts`**
- Add `'infrastructure'` to the `ArchitectureDomain` union, the `ALL_DOMAINS` array, the `DOMAIN_LABELS` record, and the `DOMAIN_ICONS` record.
- Use Lucide `Server` for `DOMAIN_ICONS['infrastructure']`. Import `Server` alongside the existing icon imports.

**`emptyModel` extension in `defaults.ts`**
- Append 13 + 3 new `<key>: []` lines to `emptyModel` (lines 1217-1270) — one for each new `MetaModelEntities` and `MetaModelRelationships` field — so default model state is shape-complete.
- No `gridConfigs` entries, no field-options arrays.

**Relationship config in `relationshipDefinitions.ts`**
- Append 3 entries to `RELATIONSHIP_DEFINITIONS` (lines 51-112), copying the `data_movements` style (mixed concrete + `infrastructure_points` polymorphic endpoints):
  - `resource_subnet_hostings` — `displayName: 'Resource <-> Subnet'`, `endpointEntityTypes: ['infrastructure_points', 'subnets']`.
  - `deployment_unit_compute_resources` — `displayName: 'Deployment Unit <-> Compute'`, `endpointEntityTypes: ['deployment_units', 'infrastructure_points']`.
  - `load_balancer_resource_routes` — `displayName: 'Load Balancer Routes'`, `endpointEntityTypes: ['load_balancers', 'listeners', 'infrastructure_points']`.
- Append 13 entries to `ENTITY_TYPE_TO_DOMAIN` (lines 146-189), each mapping a new entity type string to `'infrastructure'`.
- Append 3 display names to `RELATIONSHIP_TAB_ORDER` (lines 237-248): `'Resource <-> Subnet'`, `'Deployment Unit <-> Compute'`, `'Load Balancer Routes'`.

**TypeScript-forced compile-time updates**
- In `frontend/src/utils/contextPickerDomainMappings.ts` add `infrastructure: [<13 entity type strings>]` to `DOMAIN_TO_ENTITY_TYPES` and `infrastructure: [<3 relationship type strings>]` to `DOMAIN_TO_RELATIONSHIP_TYPES`. Forced because both records are typed `Record<ArchitectureDomain, string[]>`.
- In `frontend/src/utils/paletteData.ts` add `infrastructure: []` empty placeholders to both `DOMAIN_ENTITY_SECTIONS` and `domainToPaletteSections`. No real palette sections — that belongs to a later spec.

**`normalizeModelFromApi` backfill in `modelSerialization.ts`**
- Locate the existing `??=` backfill block at `modelSerialization.ts:78-81` (inside `normalizeModelFromApi`, line 57) which today guards the four UI arrays.
- The existing function only ensures `cloned.metaModel.entities` exists — add a sibling guard `if (!cloned.metaModel.relationships) cloned.metaModel.relationships = {};` immediately before the new relationship `??=` lines.
- Append 13 new entity-array `??=` lines (one per new `MetaModelEntities` field) and 3 new relationship-array `??=` lines (one per new `MetaModelRelationships` field), defaulting each to `[]`.
- Result: older saved projects without Infrastructure fields load cleanly; behaviour for non-Infrastructure domains is unchanged.

**Backward compatibility and non-regression**
- All extensions are additive; existing entity, relationship, default-model, normalisation, and palette behaviour for Business / Application / Data / Behavioural / UI domains MUST remain byte-identical.
- No new tests are added; verification is `tsc` clean compile + existing test suite continuing to pass. Pre-existing failing tests (per project memory) remain unchanged.

## Visual Design
N/A — type/configuration-only spec, no UI artefacts. Reference shapes are existing TypeScript declarations in `frontend/src/types/model.ts`.

## Existing Code to Leverage

**`BusinessPoint` (frontend/src/types/model.ts:237-252)**
- Primary template for `InfrastructurePoint` envelope: `id`, required `name`, `description`, discriminator union, multiple optional typed FKs, `tags: string`, `valid_from?`, `valid_to?`.
- Mirror the field ordering and optionality pattern verbatim.

**`DataMovement` (frontend/src/types/model.ts:1325)**
- Template for the 3 new relationship interfaces: snake_case fields, `id`, required `description`, required FKs where backend is NOT NULL, `tags: string`, optional fields with `?`.
- Closest existing pattern for a relationship that mixes concrete entity FKs with a polymorphic `*_point_id` reference.

**`Service.core_tech_resolved` (frontend/src/types/model.ts:387)**
- JSONB-bearing field precedent. Use `Record<string, unknown> | null` for `runtime_config` on `DeploymentUnitComputeResource`.

**`normalizeModelFromApi` UI-array backfill (frontend/src/api/modelSerialization.ts:57, 78-81)**
- Exact `??=` pattern to replicate for the 13 new entity arrays and 3 new relationship arrays.
- Add a `relationships ??= {}` guard alongside the existing `entities` guard before the new relationship `??=` lines (existing function only guards `entities`).

**`emptyModel` (frontend/src/config/defaults.ts:1217-1270) and existing `RELATIONSHIP_DEFINITIONS` `data_movements` entry**
- `emptyModel` extension is purely additive — copy any existing `<key>: []` line and adjust the key.
- The existing `data_movements` `RELATIONSHIP_DEFINITIONS` entry is the closest model for an `endpointEntityTypes` array that mixes a polymorphic point type alongside concrete entity types — copy its shape for the 3 new entries.

## Out of Scope
- Infrastructure table UI and `gridConfigs` entries (later spec in the 7-spec series).
- Infrastructure diagram UI and real palette sections (placeholders only in this spec).
- New routes, pages, or tabs for Infrastructure.
- Cross-domain relationships (e.g. data entity hosted on data store, traffic flow, infrastructure resource dependency).
- Backend contract changes, relationship semantics changes, or DTO renames.
- Gateway, MCP, or discovery-service integration for the Infrastructure domain.
- Terraform / IaC import, export, or generation, and any IaC readiness fields.
- Security group / firewall / IAM modelling entities or relationships.
- New tests beyond what TypeScript compilation forces; no changes to pre-existing failing tests.
