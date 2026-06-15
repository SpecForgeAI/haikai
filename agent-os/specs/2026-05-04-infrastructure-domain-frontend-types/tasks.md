# Task Breakdown: Infrastructure Domain Frontend Types

## Overview
Total Tasks: 6 task groups covering 7 frontend file edits, all additive.

This spec is **type/configuration-only** — no React components, no diagram UI, no palette UI, no routes/pages/tabs, no new tests beyond what TypeScript compilation forces. Every change mirrors the locked backend JSON contract from spec 1+2 in snake_case.

The spec touches 7 files in a strict additive way:
- `frontend/src/types/model.ts` — 16 new interfaces + meta-model + union extensions.
- `frontend/src/types/architectureDomain.ts` — `'infrastructure'` added to the union, label, and Lucide `Server` icon.
- `frontend/src/config/relationshipDefinitions.ts` — 3 new `RELATIONSHIP_DEFINITIONS` entries + 13 new `ENTITY_TYPE_TO_DOMAIN` mappings + 3 new `RELATIONSHIP_TAB_ORDER` entries.
- `frontend/src/utils/contextPickerDomainMappings.ts` — `infrastructure: [...]` entries on both records (TS-forced).
- `frontend/src/utils/paletteData.ts` — `infrastructure: []` empty placeholders on both records (TS-forced).
- `frontend/src/config/defaults.ts` — `emptyModel` extended with 13 + 3 new `<key>: []` lines.
- `frontend/src/api/modelSerialization.ts` — `normalizeModelFromApi` backfill extended with 16 new `??=` lines + a `relationships ??= {}` container guard.

**Key TypeScript-forcing pivot:** Group 2 adds `'infrastructure'` to `ArchitectureDomain`. The compiler will then immediately fail in every `Record<ArchitectureDomain, ...>` site — those sites are addressed in Group 3 to restore a clean compile before Groups 4-5 build on top.

## Pre-Existing Failing Tests — Implementer Convention

Per project memory, the following Vitest/Jest suites have pre-existing failures unrelated to this spec:
- `bootstrap-summary-fetching.test.ts` (1 fail: URL assertion)
- `conversation-memory-edge-cases.test.ts`
- `dashboardSummary*.test.ts` (metric value assertions)
- `hub-bootstrap-4-task-definition.test.ts` (2 fails: availableFrom)
- `chatV2-panel-integration.test.ts` (3 fails: availableFrom)
- `chatV2-panel-context-and-filtering.test.ts` (1 fail: availableFrom)

This spec must **NOT** modify or attempt to fix any of these. Verification in Group 6 is: `npx tsc --noEmit` is clean (zero new errors), and the existing failing-test inventory has not grown. Existing pre-existing failures remain unchanged.

This is a type/configuration-only spec — **no new tests are added**. TypeScript is the verification surface.

## Task List

### Type Layer

#### Task Group 1: Add 16 interfaces and extend meta-model + entity/relationship unions in `model.ts`
**Dependencies:** None

- [x] 1.0 Add the 12 Infrastructure entity interfaces, `InfrastructurePoint`, `InfrastructurePointKind`, and 3 relationship interfaces to `frontend/src/types/model.ts`, then extend `MetaModelEntities`, `MetaModelRelationships`, `EntityType`, `RelationshipType`, `AnyEntity`, and `AnyRelationship` so the type layer is shape-complete for Infrastructure.
  - [x] 1.1 Declare the 12 Infrastructure entity interfaces
    - **File:** `frontend/src/types/model.ts`
    - **Insertion point:** alongside the existing entity interfaces (style-match `BusinessPoint` at lines 237-252 and `DataMovement` at line 1325). A coherent location is just after the existing Behavioural/UI entity interfaces and before `MetaModelEntities`.
    - **Standard envelope** for every entity (per `requirements.md` "TypeScript Type Inventory"): `id: string`, `name: string`, `description: string`, `tags: string`, `valid_from?: string`, `valid_to?: string`. Do **NOT** include `model_file_id` — that is server-side only.
    - Per-entity fields (locked, snake_case, mirroring backend exactly):
      - `Environment`: `environment_type?`, `lifecycle_state?`, `is_current_state?: boolean`, `is_target_state?: boolean`, `owner?`, `criticality?`.
      - `CloudAccount`: `environment_id?`, `provider?`, `external_account_id?`, `parent_org_id?`, `billing_owner?`, `technical_owner?`, `landing_zone_name?`.
      - `Location`: `environment_id?`, `cloud_account_id?`, `location_type?`, `provider?`, `provider_region_code?`, `provider_zone_code?`, `country?`, `city?`, `address?`.
      - `Network`: `environment_id?`, `cloud_account_id?`, `location_id?`, `network_type?`, `provider?`, `cidr?`, `external_id?`, `is_shared?: boolean`, `routing_mode?`.
      - `Subnet`: `environment_id?`, `network_id?`, `location_id?`, `cidr?`, `subnet_type?`, `visibility?`, `provider_region_code?`, `provider_zone_code?`, `external_id?`, `gateway_address?`.
      - `ComputeCluster`: `environment_id?`, `cloud_account_id?`, `location_id?`, `network_id?`, `platform_type?`, `provider?`, `version?`, `external_id?`, `owner?`, `operating_model?`.
      - `ComputeResource`: `environment_id?`, `cloud_account_id?`, `location_id?`, `cluster_id?`, `compute_type?`, `provider?`, `hostname?`, `fqdn?`, `private_ip?`, `public_ip?`, `os?`, `runtime?`, `instance_size?`, `scaling_min?: number`, `scaling_max?: number`, `external_id?`, `lifecycle_state?`, `owner?`.
      - `DeploymentUnit`: `service_id?` (NOT `application_entity_id` — backend wins), `deployment_unit_type?`, `version?`, `artifact_uri?`, `image_name?`, `image_tag?`, `source_repository?`, `source_commit?`, `build_pipeline?`, `owner?`.
      - `LoadBalancer`: `environment_id?`, `cloud_account_id?`, `location_id?`, `network_id?`, `load_balancer_type?`, `provider?`, `exposure?`, `scheme?`, `dns_name?`, `ip_address?`, `external_id?`, `owner?`.
      - `Listener`: `environment_id?`, `load_balancer_id?`, `compute_resource_id?` (direct FK, mirrors backend), `protocol?`, `port?: number`, `host_name?`, `path_pattern?`, `exposure?`, `is_public?: boolean`, `certificate_reference?`, `external_id?`.
      - `DataStoreInstance`: `environment_id?`, `cloud_account_id?`, `location_id?`, `data_store_type?`, `engine?`, `engine_version?`, `provider?`, `host?`, `port?: number`, `external_id?`, `encrypted?: boolean`, `ha_enabled?: boolean`, `backup_enabled?: boolean`, `owner?`.
      - `InfrastructureResource`: `environment_id?`, `cloud_account_id?`, `location_id?`, `resource_type?`, `provider?`, `provider_resource_type?`, `endpoint?`, `external_id?`, `criticality?`, `owner?`.
    - **Convention reminder:** all enum-style TEXT fields are typed `?: string` — do **NOT** introduce string-literal unions for them. Boolean fields are `?: boolean`. Number fields are `?: number`.
  - [x] 1.2 Declare `InfrastructurePointKind` and `InfrastructurePoint`
    - **File:** `frontend/src/types/model.ts`
    - **Template:** `BusinessPoint` (model.ts:237-252). Do **NOT** copy `ApplicationPoint`'s deprecated `target_type` / `target_ref_id` / `point_type` legacy fields.
    - Declare `InfrastructurePointKind` as a string-literal union of the 12 backend values:
      ```ts
      export type InfrastructurePointKind =
        | 'ENVIRONMENT' | 'CLOUD_ACCOUNT' | 'LOCATION' | 'NETWORK' | 'SUBNET'
        | 'COMPUTE_CLUSTER' | 'COMPUTE_RESOURCE' | 'DEPLOYMENT_UNIT'
        | 'LOAD_BALANCER' | 'LISTENER' | 'DATA_STORE_INSTANCE' | 'INFRASTRUCTURE_RESOURCE';
      ```
    - This is the **only** string-literal union introduced in this spec.
    - Declare `InfrastructurePoint`:
      - `id: string`, `name: string` (**required**, mirrors `BusinessPoint`), `description: string`.
      - `point_kind: InfrastructurePointKind` discriminator.
      - 12 optional typed FK fields: `environment_id?`, `cloud_account_id?`, `location_id?`, `network_id?`, `subnet_id?`, `compute_cluster_id?`, `compute_resource_id?`, `deployment_unit_id?`, `load_balancer_id?`, `listener_id?`, `data_store_instance_id?`, `infrastructure_resource_id?`.
      - `tags: string`, `valid_from?: string`, `valid_to?: string`.
  - [x] 1.3 Declare the 3 Infrastructure relationship interfaces
    - **File:** `frontend/src/types/model.ts`
    - **Template:** `DataMovement` (model.ts:1325) — snake_case fields, required `description`, required FKs where backend is NOT NULL, `tags: string`, optional fields with `?`.
    - `ResourceSubnetHosting` (key on `MetaModelRelationships` → `resource_subnet_hostings`):
      - Required: `id: string`, `description: string`, `infrastructure_point_id: string` (polymorphic source), `subnet_id: string`, `environment_id: string`, `tags: string`.
      - Optional: `relationship_role?`, `primary_ip?`, `private_ip?`, `public_ip?`, `evidence_source?`, `confidence?: number`.
    - `DeploymentUnitComputeResource` (key on `MetaModelRelationships` → `deployment_unit_compute_resources`):
      - Required: `id: string`, `description: string`, `deployment_unit_id: string`, `compute_infrastructure_point_id: string` (polymorphic compute target), `environment_id: string`, `tags: string`.
      - Optional: `version?`, `runtime_config?: Record<string, unknown> | null` (JSONB precedent — `Service.core_tech_resolved` at model.ts:387), `desired_instances?: number`, `min_instances?: number`, `max_instances?: number`, `deployment_status?`, `evidence_source?`, `confidence?: number`.
    - `LoadBalancerResourceRoute` (key on `MetaModelRelationships` → `load_balancer_resource_routes`):
      - Required: `id: string`, `description: string`, `load_balancer_id: string`, `target_infrastructure_point_id: string` (polymorphic target), `environment_id: string`, `tags: string`.
      - Optional: `listener_id?`, `protocol?`, `target_port?: number`, `host_name?`, `path_pattern?`, `routing_type?`, `weight?: number`, `health_check_path?`.
  - [x] 1.4 Extend `MetaModelEntities` with 13 new array fields
    - **File:** `frontend/src/types/model.ts` (lines 2151-2188 region)
    - Append, in this snake_case order: `environments: Environment[]`, `cloud_accounts: CloudAccount[]`, `locations: Location[]`, `networks: Network[]`, `subnets: Subnet[]`, `compute_clusters: ComputeCluster[]`, `compute_resources: ComputeResource[]`, `deployment_units: DeploymentUnit[]`, `load_balancers: LoadBalancer[]`, `listeners: Listener[]`, `data_store_instances: DataStoreInstance[]`, `infrastructure_resources: InfrastructureResource[]`, `infrastructure_points: InfrastructurePoint[]`.
    - Required (not `?:`) — every `MetaModelEntities` field in the existing declaration is required.
  - [x] 1.5 Extend `MetaModelRelationships` with 3 new array fields
    - **File:** `frontend/src/types/model.ts` (lines 2190-2206 region)
    - Append: `resource_subnet_hostings: ResourceSubnetHosting[]`, `deployment_unit_compute_resources: DeploymentUnitComputeResource[]`, `load_balancer_resource_routes: LoadBalancerResourceRoute[]`.
  - [x] 1.6 Extend `EntityType` and `RelationshipType` string unions
    - **File:** `frontend/src/types/model.ts` (lines 2220-2266 region)
    - Append to `EntityType` (13 new strings): `'environments' | 'cloud_accounts' | 'locations' | 'networks' | 'subnets' | 'compute_clusters' | 'compute_resources' | 'deployment_units' | 'load_balancers' | 'listeners' | 'data_store_instances' | 'infrastructure_resources' | 'infrastructure_points'`.
    - Append to `RelationshipType` (3 new strings): `'resource_subnet_hostings' | 'deployment_unit_compute_resources' | 'load_balancer_resource_routes'`.
  - [x] 1.7 Extend `AnyEntity` and `AnyRelationship` discriminated unions
    - **File:** `frontend/src/types/model.ts` (lines 2269-2313 region)
    - Append the 13 new entity interfaces to `AnyEntity` (each as a union branch).
    - Append the 3 new relationship interfaces to `AnyRelationship`.
  - [x] 1.8 Verify `model.ts` compiles in isolation
    - Run `npx tsc --noEmit` from `frontend/`.
    - At this point, expected new errors come **only** from `Record<ArchitectureDomain, ...>` sites (which still reference 5 domains, not 6) — those will be triggered in Group 2 and resolved in Group 3.
    - Verify there are no new errors *inside* `model.ts` itself (interface field references, union members, no typos in snake_case keys).

**Acceptance Criteria:**
- 12 entity interfaces + `InfrastructurePoint` + 3 relationship interfaces are declared with the locked field shapes.
- `point_kind` is the only string-literal union introduced; all other enum-style fields are `?: string`.
- All field names are snake_case and mirror backend JSON keys exactly. `model_file_id` does **not** appear on any frontend interface.
- `DeploymentUnit.service_id?` (NOT `application_entity_id`) and `Listener.compute_resource_id?` (direct FK) are declared correctly.
- `MetaModelEntities` has 13 new array fields; `MetaModelRelationships` has 3 new array fields.
- `EntityType` (13 new), `RelationshipType` (3 new), `AnyEntity` (13 new branches), `AnyRelationship` (3 new branches) are extended.
- `npx tsc --noEmit` shows no new errors *originating in* `model.ts`.

---

### Domain Layer

#### Task Group 2: Add `'infrastructure'` to `ArchitectureDomain` (and trigger TS compile errors)
**Dependencies:** Task Group 1 (uses no symbols from it, but ordering is cleaner)

- [x] 2.0 Extend `ArchitectureDomain` with `'infrastructure'`, the `Server` icon, and the `'Infrastructure'` label. Adding this single union member is the deliberate trigger for the TypeScript-forced compile errors that Group 3 will resolve.
  - [x] 2.1 Add `'infrastructure'` to the `ArchitectureDomain` union
    - **File:** `frontend/src/types/architectureDomain.ts` (full file, 59 lines)
    - Update the union from `'business' | 'application' | 'data' | 'behavioural' | 'ui'` to add `| 'infrastructure'`.
  - [x] 2.2 Append `'infrastructure'` to `ALL_DOMAINS`
    - **File:** `frontend/src/types/architectureDomain.ts`
    - Append after the existing entries.
  - [x] 2.3 Add `infrastructure: 'Infrastructure'` to `DOMAIN_LABELS`
    - **File:** `frontend/src/types/architectureDomain.ts`
    - Mirror the existing label-string convention.
  - [x] 2.4 Import `Server` from `lucide-react` and add `infrastructure: Server` to `DOMAIN_ICONS`
    - **File:** `frontend/src/types/architectureDomain.ts`
    - Add `Server` alongside the existing icon imports at the top of the file.
    - Add `infrastructure: Server` to the `DOMAIN_ICONS` record.
  - [x] 2.5 Verify the compiler now flags exactly the expected sites
    - Run `npx tsc --noEmit` from `frontend/`.
    - Expected new errors: missing `infrastructure` key on `Record<ArchitectureDomain, ...>` declarations in:
      - `frontend/src/config/relationshipDefinitions.ts` — `ENTITY_TYPE_TO_DOMAIN`, `RELATIONSHIP_TAB_ORDER` (if typed against domain), and any other domain-keyed records.
      - `frontend/src/utils/contextPickerDomainMappings.ts` — `DOMAIN_TO_ENTITY_TYPES`, `DOMAIN_TO_RELATIONSHIP_TYPES`.
      - `frontend/src/utils/paletteData.ts` — `DOMAIN_ENTITY_SECTIONS`, `domainToPaletteSections`.
    - The compiler error list **is** the to-do list for Group 3. If errors appear elsewhere, treat that as additional grounding to address there too.

**Acceptance Criteria:**
- `ArchitectureDomain` union, `ALL_DOMAINS`, `DOMAIN_LABELS`, and `DOMAIN_ICONS` all include `'infrastructure'`.
- `DOMAIN_ICONS['infrastructure']` is the Lucide `Server` icon.
- `DOMAIN_LABELS['infrastructure']` is `'Infrastructure'`.
- `npx tsc --noEmit` errors are limited to the expected `Record<ArchitectureDomain, ...>` sites listed in 2.5 (no other surprise errors).

---

### Domain-Keyed Record Layer

#### Task Group 3: Resolve every `Record<ArchitectureDomain, ...>` compile error introduced by Group 2
**Dependencies:** Task Groups 1 and 2

- [x] 3.0 Restore a clean `tsc --noEmit` by populating every `Record<ArchitectureDomain, ...>` site with `infrastructure` entries, plus the appended config additions in `relationshipDefinitions.ts` (3 new `RELATIONSHIP_DEFINITIONS`, 13 new `ENTITY_TYPE_TO_DOMAIN` mappings, 3 new `RELATIONSHIP_TAB_ORDER` entries).
  - [x] 3.1 Append 3 entries to `RELATIONSHIP_DEFINITIONS`
    - **File:** `frontend/src/config/relationshipDefinitions.ts` (lines 51-112 region)
    - **Template:** existing `data_movements` entry (closest match — mixes a polymorphic point type alongside concrete entity types in `endpointEntityTypes`).
    - Append (Q7 confirmed):
      - `resource_subnet_hostings` — `displayName: 'Resource <-> Subnet'`, `endpointEntityTypes: ['infrastructure_points', 'subnets']`.
      - `deployment_unit_compute_resources` — `displayName: 'Deployment Unit <-> Compute'`, `endpointEntityTypes: ['deployment_units', 'infrastructure_points']`.
      - `load_balancer_resource_routes` — `displayName: 'Load Balancer Routes'`, `endpointEntityTypes: ['load_balancers', 'listeners', 'infrastructure_points']`.
  - [x] 3.2 Append 13 entity-type mappings to `ENTITY_TYPE_TO_DOMAIN`
    - **File:** `frontend/src/config/relationshipDefinitions.ts` (lines 146-189 region)
    - Append, each mapped to `'infrastructure'`: `environments`, `cloud_accounts`, `locations`, `networks`, `subnets`, `compute_clusters`, `compute_resources`, `deployment_units`, `load_balancers`, `listeners`, `data_store_instances`, `infrastructure_resources`, `infrastructure_points`.
  - [x] 3.3 Append 3 display names to `RELATIONSHIP_TAB_ORDER`
    - **File:** `frontend/src/config/relationshipDefinitions.ts` (lines 237-248 region)
    - Append: `'Resource <-> Subnet'`, `'Deployment Unit <-> Compute'`, `'Load Balancer Routes'`. Keep these strings exactly aligned with the `displayName` values from 3.1.
  - [x] 3.4 Add `infrastructure: [...]` to `DOMAIN_TO_ENTITY_TYPES`
    - **File:** `frontend/src/utils/contextPickerDomainMappings.ts` (full file, 75 lines)
    - Add: `infrastructure: ['environments', 'cloud_accounts', 'locations', 'networks', 'subnets', 'compute_clusters', 'compute_resources', 'deployment_units', 'load_balancers', 'listeners', 'data_store_instances', 'infrastructure_resources', 'infrastructure_points']`.
  - [x] 3.5 Add `infrastructure: [...]` to `DOMAIN_TO_RELATIONSHIP_TYPES`
    - **File:** `frontend/src/utils/contextPickerDomainMappings.ts`
    - Add: `infrastructure: ['resource_subnet_hostings', 'deployment_unit_compute_resources', 'load_balancer_resource_routes']`.
  - [x] 3.6 Add `infrastructure: []` empty placeholders to `DOMAIN_ENTITY_SECTIONS` and `domainToPaletteSections`
    - **File:** `frontend/src/utils/paletteData.ts` (full file, 655 lines)
    - Add `infrastructure: []` to **both** records. No real palette sections — that belongs to a later spec.
  - [x] 3.7 Verify the compiler is clean
    - Run `npx tsc --noEmit` from `frontend/`.
    - Expected: zero new errors. All `Record<ArchitectureDomain, ...>` sites now have an `infrastructure` key.
    - If any site is still flagged, return to 3.1-3.6 — the compiler error list dictates what is missing.

**Acceptance Criteria:**
- 3 new entries in `RELATIONSHIP_DEFINITIONS` with the agreed display names and `endpointEntityTypes`.
- 13 new entries in `ENTITY_TYPE_TO_DOMAIN`, all mapping to `'infrastructure'`.
- 3 new display names in `RELATIONSHIP_TAB_ORDER`, exactly matching the `displayName` values from 3.1.
- `DOMAIN_TO_ENTITY_TYPES` has an `infrastructure` array of 13 entity type strings.
- `DOMAIN_TO_RELATIONSHIP_TYPES` has an `infrastructure` array of 3 relationship type strings.
- `DOMAIN_ENTITY_SECTIONS` and `domainToPaletteSections` have `infrastructure: []` empty placeholders.
- `npx tsc --noEmit` passes with no new errors.

---

### Defaults Layer

#### Task Group 4: Extend `emptyModel` with 13 + 3 new empty arrays
**Dependencies:** Task Group 1

- [x] 4.0 Append 16 new `<key>: []` lines to `emptyModel` in `frontend/src/config/defaults.ts` so the default model state is always shape-complete with the new `MetaModelEntities` and `MetaModelRelationships` keys declared in Task Group 1.
  - [x] 4.1 Append 13 entity-array entries to `emptyModel.metaModel.entities`
    - **File:** `frontend/src/config/defaults.ts` (lines 1217-1270 region)
    - Append: `environments: []`, `cloud_accounts: []`, `locations: []`, `networks: []`, `subnets: []`, `compute_clusters: []`, `compute_resources: []`, `deployment_units: []`, `load_balancers: []`, `listeners: []`, `data_store_instances: []`, `infrastructure_resources: []`, `infrastructure_points: []`.
    - Mirror the existing `<key>: []` formatting style.
  - [x] 4.2 Append 3 relationship-array entries to `emptyModel.metaModel.relationships`
    - **File:** `frontend/src/config/defaults.ts`
    - Append: `resource_subnet_hostings: []`, `deployment_unit_compute_resources: []`, `load_balancer_resource_routes: []`.
  - [x] 4.3 Confirm no `gridConfigs` or `<field>Options` arrays are added
    - **Verification only:** the spec excludes `gridConfigs` entries and field-options arrays — these belong to a later table-UI spec.
    - Do NOT touch `gridConfigs.ts` or other defaults beyond `emptyModel`.
  - [x] 4.4 Verify `defaults.ts` compiles
    - Run `npx tsc --noEmit` from `frontend/`.
    - Expected: zero new errors. `emptyModel` now satisfies the extended `MetaModelEntities` and `MetaModelRelationships` shapes.

**Acceptance Criteria:**
- `emptyModel.metaModel.entities` has 13 new empty-array entries.
- `emptyModel.metaModel.relationships` has 3 new empty-array entries.
- No `gridConfigs` entries and no `<field>Options` arrays are added.
- `npx tsc --noEmit` passes.

---

### Serialization Layer

#### Task Group 5: Extend `normalizeModelFromApi` backfill in `modelSerialization.ts`
**Dependencies:** Task Groups 1 and 4

- [x] 5.0 Extend the existing `??=` backfill block in `normalizeModelFromApi` so older saved projects (that pre-date the Infrastructure domain) load cleanly. Add a `relationships ??= {}` container guard alongside the existing `entities` guard, then 13 new entity-array `??=` lines and 3 new relationship-array `??=` lines.
  - [x] 5.1 Add `relationships` container guard
    - **File:** `frontend/src/api/modelSerialization.ts` (function `normalizeModelFromApi` at line 57; existing UI-array backfill at lines 78-81)
    - Locate the existing guard that ensures `cloned.metaModel.entities` exists.
    - Add a sibling guard immediately before the new relationship `??=` lines:
      ```ts
      if (!cloned.metaModel.relationships) cloned.metaModel.relationships = {};
      ```
    - Without this guard, the new relationship `??=` lines would crash on payloads where `relationships` is absent (the type already declares the container as optional).
  - [x] 5.2 Append 13 new entity-array `??=` lines
    - **File:** `frontend/src/api/modelSerialization.ts`
    - Style-match the existing UI-array backfill (lines 78-81).
    - For each new `MetaModelEntities` field, default to `[]`:
      ```ts
      cloned.metaModel.entities.environments ??= [];
      cloned.metaModel.entities.cloud_accounts ??= [];
      cloned.metaModel.entities.locations ??= [];
      cloned.metaModel.entities.networks ??= [];
      cloned.metaModel.entities.subnets ??= [];
      cloned.metaModel.entities.compute_clusters ??= [];
      cloned.metaModel.entities.compute_resources ??= [];
      cloned.metaModel.entities.deployment_units ??= [];
      cloned.metaModel.entities.load_balancers ??= [];
      cloned.metaModel.entities.listeners ??= [];
      cloned.metaModel.entities.data_store_instances ??= [];
      cloned.metaModel.entities.infrastructure_resources ??= [];
      cloned.metaModel.entities.infrastructure_points ??= [];
      ```
  - [x] 5.3 Append 3 new relationship-array `??=` lines
    - **File:** `frontend/src/api/modelSerialization.ts`
    - Place immediately after the `relationships ??= {}` guard from 5.1:
      ```ts
      cloned.metaModel.relationships.resource_subnet_hostings ??= [];
      cloned.metaModel.relationships.deployment_unit_compute_resources ??= [];
      cloned.metaModel.relationships.load_balancer_resource_routes ??= [];
      ```
  - [x] 5.4 Confirm non-Infra normalisation behaviour is unchanged
    - **Verification only:** the original 4 UI-array `??=` lines are untouched.
    - The `entities` container guard is untouched.
    - All new lines are purely additive.
  - [x] 5.5 Verify `modelSerialization.ts` compiles
    - Run `npx tsc --noEmit` from `frontend/`.
    - Expected: zero new errors. The 16 new `??=` lines satisfy the extended `MetaModelEntities` and `MetaModelRelationships` shapes from Group 1.

**Acceptance Criteria:**
- `relationships ??= {}` (or equivalent `if (!...) ... = {}`) container guard added alongside the existing `entities` guard.
- 13 new entity-array `??=` lines added, defaulting each to `[]`.
- 3 new relationship-array `??=` lines added, defaulting each to `[]`.
- Existing UI-array backfill (lines 78-81) is unchanged.
- Older saved projects without Infrastructure fields load cleanly via this backfill (verified at compile time; runtime verification deferred until later UI/integration specs).
- `npx tsc --noEmit` passes.

---

### Build Verification

#### Task Group 6: Final `tsc --noEmit` and existing-test sweep
**Dependencies:** Task Groups 1-5

- [x] 6.0 Confirm the full frontend codebase compiles cleanly with the additive Infrastructure changes, and confirm the pre-existing failing-test inventory has not grown.
  - [x] 6.1 Run `npx tsc --noEmit` for the full frontend
    - From `frontend/`, run `npx tsc --noEmit`.
    - Expected: zero new errors. Any remaining errors must already exist on `master` and not have been introduced by this spec.
  - [x] 6.2 (If present) Run Vitest with no spec-introduced changes to test files
    - From `frontend/`, run the existing test suite (e.g. `npx vitest run` or whatever the `package.json` script is).
    - Expected outcome: the only failures are the pre-existing failing tests already documented in the project memory:
      - `bootstrap-summary-fetching.test.ts` (1 fail)
      - `conversation-memory-edge-cases.test.ts`
      - `dashboardSummary*.test.ts`
      - `hub-bootstrap-4-task-definition.test.ts` (2 fails)
      - `chatV2-panel-integration.test.ts` (3 fails)
      - `chatV2-panel-context-and-filtering.test.ts` (1 fail)
    - **NO** new failures introduced by this spec. **NO** previously-passing tests now failing.
    - **DO NOT** modify or attempt to fix any pre-existing failing test.
  - [x] 6.3 Confirm scope discipline
    - **Verification only:** confirm no edits were made to any file outside the 7 listed:
      1. `frontend/src/types/model.ts`
      2. `frontend/src/types/architectureDomain.ts`
      3. `frontend/src/config/relationshipDefinitions.ts`
      4. `frontend/src/utils/contextPickerDomainMappings.ts`
      5. `frontend/src/utils/paletteData.ts`
      6. `frontend/src/config/defaults.ts`
      7. `frontend/src/api/modelSerialization.ts`
    - Confirm no new test files were added.
    - Confirm no `gridConfigs` entries, no real palette sections, no UI components, no routes/pages/tabs.
  - [x] 6.4 Additional cleanup sites beyond the original 7-file scope (surfaced by the type-extension pivot)
    - **Note:** Extending `MetaModelEntities`, `MetaModelRelationships`, `EntityType`, and `ArchitectureDomain` triggered exhaustiveness errors in additional sites that were not originally identified in spec.md. These were resolved minimally and additively (no logic changes, only key additions).
    - **Domain-keyed records (Category A) — additional sites:**
      - `frontend/src/config/gridConfigs.ts` — `domainGroupings` (line 704) and `DOMAIN_ENTITY_TYPES` (line 725) extended with `infrastructure: []` empty placeholders.
      - `frontend/src/hooks/useCurrentView.ts` — `MetaModelDomainUrlValue` union, `META_MODEL_DOMAIN_URL_VALUES` array, `URL_TO_INTERNAL_DOMAIN` and `INTERNAL_DOMAIN_TO_URL` records all extended with `'infrastructure'`.
    - **Production code with partial `MetaModel` literals (Category B) — additional sites:**
      - `frontend/src/utils/fileOperations.ts` lines 326 + 361 — extended with the 16 new typed `getArrayOrDefault` lines.
      - `frontend/src/utils/sanitize.ts` lines 59 + 94 — extended with the 16 new `sanitizeArray` lines.
      - `frontend/src/utils/validation.ts` line 32 — `ENTITY_TYPE_DISPLAY_NAMES` extended with 13 SCREAMING_SNAKE_CASE display strings.
    - **Test fixtures (compile-only fix) — minimal extension to keep test files compiling:**
      - `frontend/src/components/DiagramsView/__tests__/MappingConfirmationModal.test.tsx`
      - `frontend/src/components/DiagramsView/SequenceEditor/__tests__/gapAnalysis.test.tsx`
      - `frontend/src/components/DiagramsView/SequenceEditor/__tests__/participantEdit.test.tsx`
      - `frontend/src/utils/mappingConfirmationUtils.test.ts`
      - `frontend/src/utils/temporaryDiagramMapping.test.ts`
    - All cleanup sites are purely additive — no behavioural changes, no test-logic edits.

**Acceptance Criteria:**
- `npx tsc --noEmit` is clean (zero new errors).
- The Vitest inventory of failures is identical to the pre-existing list documented in the project memory — no new failures, no regressions.
- Exactly 7 frontend files modified, all additively.
- No new test files added.
- No `gridConfigs`, no palette UI, no diagram UI, no routes — out-of-scope items confirmed absent.

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: `model.ts` extensions** — declare 16 interfaces, extend meta-model containers and entity/relationship unions. Foundation for everything else.
2. **Task Group 2: `architectureDomain.ts` extension** — add `'infrastructure'` to the union, label, and `Server` icon. This is the deliberate trigger for the TS-forced compile errors that Group 3 will resolve.
3. **Task Group 3: domain-keyed record sites** — populate `ENTITY_TYPE_TO_DOMAIN`, `RELATIONSHIP_TAB_ORDER`, `RELATIONSHIP_DEFINITIONS`, `DOMAIN_TO_ENTITY_TYPES`, `DOMAIN_TO_RELATIONSHIP_TYPES`, `DOMAIN_ENTITY_SECTIONS`, and `domainToPaletteSections`. Restores a clean `tsc`.
4. **Task Group 4: `emptyModel` extension** — append 13 + 3 empty arrays in `defaults.ts`. Depends on Group 1 (uses the new field shapes).
5. **Task Group 5: `normalizeModelFromApi` backfill** — extend the `??=` block in `modelSerialization.ts` with a relationships container guard plus 16 new lines. Depends on Groups 1 and 4.
6. **Task Group 6: build verification** — run `tsc --noEmit` and Vitest to confirm zero regressions.

Groups 1 and 2 are independent and could run in parallel, but in practice Group 1 should run first so `model.ts` symbol references in Group 2's downstream consumers (Group 3) are resolvable. Group 4 is independent of Group 3 but should follow Group 1. Group 5 should follow Group 4. Group 6 must run last.

---

## File Summary

### Files to Modify (7, all additive)
1. `frontend/src/types/model.ts` — 16 new interfaces, `InfrastructurePointKind` union, `MetaModelEntities` (+13), `MetaModelRelationships` (+3), `EntityType` (+13), `RelationshipType` (+3), `AnyEntity` (+13 branches), `AnyRelationship` (+3 branches).
2. `frontend/src/types/architectureDomain.ts` — `'infrastructure'` added to `ArchitectureDomain` union, `ALL_DOMAINS`, `DOMAIN_LABELS`, `DOMAIN_ICONS` (with `Server` from `lucide-react`).
3. `frontend/src/config/relationshipDefinitions.ts` — 3 new `RELATIONSHIP_DEFINITIONS` entries, 13 new `ENTITY_TYPE_TO_DOMAIN` mappings, 3 new `RELATIONSHIP_TAB_ORDER` entries.
4. `frontend/src/utils/contextPickerDomainMappings.ts` — `infrastructure: [13 entity type strings]` on `DOMAIN_TO_ENTITY_TYPES`; `infrastructure: [3 relationship type strings]` on `DOMAIN_TO_RELATIONSHIP_TYPES`.
5. `frontend/src/utils/paletteData.ts` — `infrastructure: []` empty placeholders on `DOMAIN_ENTITY_SECTIONS` and `domainToPaletteSections`.
6. `frontend/src/config/defaults.ts` — `emptyModel` extended with 13 + 3 new `<key>: []` lines.
7. `frontend/src/api/modelSerialization.ts` — `normalizeModelFromApi` backfill extended with a `relationships ??= {}` container guard plus 16 new `??=` lines.

### Test Files to Create (0)
None. This spec is type/configuration-only — verification is via `npx tsc --noEmit` plus the existing-test sweep.

---

## Reference Patterns

### Existing Code to Follow

- **`BusinessPoint`** (`frontend/src/types/model.ts:237-252`)
  - Primary template for `InfrastructurePoint`: `id`, required `name`, `description`, kind discriminator, multiple optional typed FKs, `tags: string`, `valid_from?`, `valid_to?`. Mirror field ordering and optionality verbatim.

- **`ApplicationPoint`** (`frontend/src/types/model.ts:475-520`)
  - Secondary reference, but **skip** the deprecated `target_type` / `target_ref_id` / `point_type` legacy fields. The `InfrastructurePoint` shape is `BusinessPoint`-style, not `ApplicationPoint`-style.

- **`DataMovement`** (`frontend/src/types/model.ts:1325`)
  - Template for the 3 new relationship interfaces: snake_case fields, required `description`, required FKs where backend is NOT NULL, `tags: string`, optional fields with `?`. Closest existing pattern that mixes a polymorphic `*_point_id` reference with concrete entity FKs.

- **`Service.core_tech_resolved`** (`frontend/src/types/model.ts:387`)
  - JSONB-bearing field precedent. Use `Record<string, unknown> | null` for `runtime_config` on `DeploymentUnitComputeResource`.

- **`normalizeModelFromApi` UI-array backfill** (`frontend/src/api/modelSerialization.ts:57`, `78-81`)
  - Exact `??=` pattern to replicate for the 13 new entity arrays + 3 new relationship arrays.
  - Existing function only guards `entities`. Add a `relationships` container guard alongside it before the new relationship `??=` lines.

- **Existing `data_movements` `RELATIONSHIP_DEFINITIONS` entry** (`frontend/src/config/relationshipDefinitions.ts:51-112`)
  - Closest model for an `endpointEntityTypes` array that mixes a polymorphic point type alongside concrete entity types — copy its shape for the 3 new entries.

- **`emptyModel`** (`frontend/src/config/defaults.ts:1217-1270`)
  - Pure additive list of `<key>: []` lines — copy any existing line and adjust the key.

### Key Decisions to Honour

- **Backend contract is authoritative** — wherever the raw idea drifted (`application_entity_id`, `hosted_resource_point_id`, `target_point_id`, `compute_resource_id` on the runs-on relationship), the TypeScript shape mirrors the locked backend contract from spec 1+2, not the raw idea.
- **`model_file_id` is server-side only** — does NOT appear on any frontend interface.
- **Snake_case everywhere** — field names match backend JSON keys exactly.
- **`point_kind` is the only string-literal union** — all other enum-style fields are `?: string`.
- **`tags: string`** on every new entity and relationship (single TEXT blob; not optional, not array, not Record).
- **`environment_id: string`** (required) on all 3 relationships — backend column is NOT NULL.
- **`runtime_config: Record<string, unknown> | null`** — JSONB precedent following `Service.core_tech_resolved`.
- **`confidence?: number`** on `ResourceSubnetHosting` and `DeploymentUnitComputeResource` (DECIMAL(4,3) on backend).
- **No `gridConfigs` entries, no real palette sections, no table UI, no diagram UI** — empty placeholders only in `paletteData.ts`. Real UI surface is deferred to later specs.
- **No new tests** — TypeScript compilation is the verification surface. Pre-existing failing tests remain unchanged.
- **All extensions are additive** — existing behaviour for Business / Application / Data / Behavioural / UI domains MUST remain byte-identical.
