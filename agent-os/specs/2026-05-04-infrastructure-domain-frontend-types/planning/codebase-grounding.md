# Codebase Grounding — Infrastructure Domain Frontend Types (Spec 3 of 7)

## Locked Backend JSON Contract (from spec 1 + spec 2)

13 new entity lists on `MetaModelEntities` (snake_case JSON):
`environments`, `cloud_accounts`, `locations`, `networks`, `subnets`,
`compute_clusters`, `compute_resources`, `deployment_units`, `load_balancers`,
`listeners`, `data_store_instances`, `infrastructure_resources`, `infrastructure_points`.

3 new relationship lists on `MetaModelRelationships`:
`resource_subnet_hostings`, `deployment_unit_compute_resources`, `load_balancer_resource_routes`.

Locked decisions to honour (raw idea drift exists — backend wins):

- `deployment_units.service_id` direct FK to `services` (raw idea: `application_entity_id` — wrong).
- `listeners.compute_resource_id` stays direct FK (A1).
- `deployment_unit_compute_resources.compute_infrastructure_point_id` polymorphic via `InfrastructurePoint` (A2 — raw idea: `compute_resource_id`).
- `resource_subnet_hostings.infrastructure_point_id` polymorphic (raw idea: `hosted_resource_point_id` — wrong).
- `load_balancer_resource_routes.target_infrastructure_point_id` polymorphic (raw idea: `target_point_id` — wrong).
- `runtime_config` on `deployment_unit_compute_resources` is JSONB. Backend DTO field is `String` (raw JSON). Frontend precedent (Service.core_tech_resolved) is `Record<string, unknown> | null`.
- `confidence` is DECIMAL(4,3) on `resource_subnet_hostings` and `deployment_unit_compute_resources` → `number` on frontend.
- `environment_id` is NOT NULL on all 3 relationships.
- `tags` is TEXT (single string blob) on every backend table — matches existing frontend convention.
- `InfrastructurePoint` style: 12 nullable typed FK columns + `point_kind` discriminator (DataEntityPoint-style, NOT ApplicationPoint hybrid).
- `point_kind` discriminator values: ENVIRONMENT, CLOUD_ACCOUNT, LOCATION, NETWORK, SUBNET, COMPUTE_CLUSTER, COMPUTE_RESOURCE, DEPLOYMENT_UNIT, LOAD_BALANCER, LISTENER, DATA_STORE_INSTANCE, INFRASTRUCTURE_RESOURCE.

## Frontend Type Layer Findings

### `frontend/src/types/model.ts` (2313 lines)

`MetaModelEntities` (lines 2151-2188) — flat object of `<key>: TEntity[]` arrays. Includes `interfaces`, `endpoints`, `app_business_points`, `business_points`, `application_points`, `events`, `states`, `state_transitions`, `activities`, `activity_flows`, `activity_partitions`, `business_logics`, `ui_screens`, `ui_components`, `ui_actions`, `ui_characteristics`, `package_sets`, `packages`, `user_journeys`, `activity_steps`, `package_set_default_rules?`. **Notably absent: `data_entity_points`** — referenced in `relationshipDefinitions.ts` and `gridConfigs.ts` but not declared as an entity array on `MetaModelEntities` and no `DataEntityPoint` interface exists in `model.ts`. This is a pre-existing gap, not in scope here.

`MetaModelRelationships` (lines 2190-2206) — flat object of `<key>: TRelationship[]` arrays.

`EntityType` and `RelationshipType` string unions exist (lines 2220-2266) and must be extended.

`AnyEntity` and `AnyRelationship` discriminated-union types (lines 2269-2313) must be extended.

### Existing Point Type Style (template for `InfrastructurePoint`)

`BusinessPoint` (lines 237-252) and `ApplicationPoint` (lines 475-520) both use:
- `id: string`, `name: string`, `description: string`
- `kind: <SomeKindUnion>` discriminator
- Multiple typed FK fields, all but the primary one optional (`?`)
- `tags: string` (single TEXT blob)
- `valid_from?: string`, `valid_to?: string`
- `ApplicationPoint` also has the older `target_type` + `target_ref_id` hybrid + a deprecated `point_type` field — these are application-specific legacy and **should not** be copied for `InfrastructurePoint`.

The DataEntityPoint-style (per backend spec 1) is therefore expressed on the frontend as: 12 optional typed FK fields + `point_kind: InfrastructurePointKind` discriminator + standard envelope. No opaque `target_type`/`target_ref_id`.

### Conventions Observed (mirror these for new entities)

- IDs: `id: string` (required).
- Names: `name: string` (required where backend has NOT NULL).
- `description: string` (required, not optional — defaults to empty string in code).
- `tags: string` (required, single TEXT blob — not optional, not array, not Record).
- Sibling FKs: `<entity>_id?: string` if backend column is nullable; required `string` if backend column is NOT NULL.
- Boolean fields: `<flag>?: boolean` (nullable boxed Boolean on backend → optional on frontend).
- Enum-style TEXT columns: `<field>?: string` (no string-literal union types in `model.ts` for entity-internal enums; they live in `defaults.ts` as `<field>Options` arrays for grid use).
- Number fields: `<field>?: number`.
- Temporal: `valid_from?: string`, `valid_to?: string`.
- JSONB precedent: `Service.core_tech_resolved?: Record<string, unknown> | null` (line 387) — so `runtime_config` should follow this style.

### `frontend/src/config/defaults.ts` (1270 lines)

`emptyModel` (lines 1217-1270) initialises every `MetaModelEntities` and `MetaModelRelationships` array to `[]`. Must add 13 + 3 new empty arrays.

### `frontend/src/config/relationshipDefinitions.ts` (262 lines)

`RELATIONSHIP_DEFINITIONS` (lines 51-112) — 10 entries, each with `relationshipKey`, `displayName`, `endpointEntityTypes: string[]`. Add 3 new entries.

`ENTITY_TYPE_TO_DOMAIN` (lines 146-189) — flat `Record<string, ArchitectureDomain>`. Need to add 13 mappings to `'infrastructure'`.

`RELATIONSHIP_TAB_ORDER` (lines 237-248) — array of display names; add 3 new display names.

### `frontend/src/types/architectureDomain.ts` (59 lines)

`ArchitectureDomain` is currently `'business' | 'application' | 'data' | 'behavioural' | 'ui'` — does **NOT** include `'infrastructure'`. Must extend:
- The union type itself
- `ALL_DOMAINS` array
- `DOMAIN_LABELS` record
- `DOMAIN_ICONS` record (need to pick a Lucide icon — `Server`, `Cloud`, `Network` are candidates).

### `frontend/src/utils/contextPickerDomainMappings.ts` (75 lines)

`DOMAIN_TO_ENTITY_TYPES` and `DOMAIN_TO_RELATIONSHIP_TYPES` are `Record<ArchitectureDomain, string[]>`. Both will fail TypeScript compilation as soon as `'infrastructure'` is added to `ArchitectureDomain` unless we add an `infrastructure: [...]` entry. **Forced update.**

### `frontend/src/utils/paletteData.ts` (655 lines)

`DOMAIN_ENTITY_SECTIONS` and `domainToPaletteSections` are `Record<ArchitectureDomain, string[]>`. Same TypeScript force: must add `infrastructure: [...]` entries. Raw idea says "no diagram UI" — minimum viable is empty arrays (`infrastructure: []`) so the type compiles; downstream palette panels won't render an Infrastructure section until a later spec.

### `frontend/src/api/modelApi.ts` (210 lines)

Two main functions: `loadModelByFilename` and `loadModelByProjectAndArchitecture`, both return `ArchitectureModel` after `normalizeModelFromApi(raw)`. The API client passes through whatever `MetaModelEntities` / `MetaModelRelationships` shape is in `model.ts` — no separate request/response DTOs. **No API client type changes needed beyond the `model.ts` extensions.**

### `frontend/src/api/modelSerialization.ts` (138 lines)

`normalizeModelFromApi` deep-clones, ensures `metaModel.entities` exists, and **explicitly backfills** four UI arrays: `ui_screens`, `ui_components`, `ui_actions`, `ui_workflow_transitions` (lines 78-81). Comment: "Prevents crashes when loading older saved projects that don't have UI entities". **Same backfill pattern is needed for the 13 new infrastructure entity arrays + 3 new relationship arrays** so that older saved projects load without errors.

### `frontend/src/config/gridConfigs.ts` (750 lines)

`gridConfigs: Record<string, GridColumnConfig[]>` — column definitions for tables. Raw idea says "do not add full table column configuration unless required by existing frontend patterns for type registration". The `Record<string, ...>` typing means missing keys won't break TypeScript; only consumers that look up specific keys (e.g. table renderers) would notice. **Skip in this spec** unless TypeScript or a global registry forces inclusion. Verified no global registry forces it.

## Test Patterns

- Vitest (per project memory).
- No existing tests exercise `MetaModelEntities`, `emptyModel`, or `RELATIONSHIP_DEFINITIONS` directly (`grep -l` returned empty).
- Adding new arrays/records to existing types/exports is type-only and config-only — no test scaffolding needs to change.
- Pre-existing failing tests (per project memory) are unrelated and should be left alone.

## Reusability Opportunities

- `BusinessPoint` (model.ts:237) — closest template for `InfrastructurePoint` shape.
- `ApplicationPoint` (model.ts:475) — secondary template, but skip the deprecated `target_type` / `target_ref_id` / `point_type` legacy fields.
- `DataMovement` (model.ts:1325) — template for the 3 new relationship interface declarations (snake_case fields, `description`, `tags: string`, optional fields with `?`).
- `Service.core_tech_resolved` (model.ts:387) — JSONB-bearing field precedent for `runtime_config`.
- `normalizeModelFromApi` UI-array backfill block (modelSerialization.ts:78-81) — exact pattern to copy for the 16 new infra arrays.
- `emptyModel` extension — pure additive list of `<key>: []` lines.
- `RELATIONSHIP_DEFINITIONS` 3 new entries — copy `data_movements` style (mixed endpoint entity types: `infrastructure_points` + concrete entity types).
