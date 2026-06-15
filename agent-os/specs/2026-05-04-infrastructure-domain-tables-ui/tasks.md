# Task Breakdown: Infrastructure Domain Tables UI

## Overview
Total Tasks: 6 task groups covering 8 frontend file edits (4 modified + 4 created), all additive.

This spec is **table-config and component-shell only** — it builds the table UI surface for the Infrastructure domain on top of the type/config foundation that spec 3 landed. There are no backend, gateway, MCP, discovery, or Terraform changes. There are no diagram, palette, or save-pipeline changes. The save/load round-trip already works through spec 3's normalisation.

The spec touches these files:
- **Modified (4):**
  - `frontend/src/types/config.ts` — `CellType` union extended with `'infrastructure_point_picker'`.
  - `frontend/src/components/Grid/GridCell.tsx` — new `case 'infrastructure_point_picker'` arm.
  - `frontend/src/config/defaults.ts` — 23 new picklist option-array exports.
  - `frontend/src/config/gridConfigs.ts` — 16 new `gridConfigs` entries + 6 tab/domain map updates.
  - `frontend/src/utils/formatters.ts` — append `infrastructurePointDisplayFormatter`.
- **Created (3):**
  - `frontend/src/components/Grid/InfrastructurePointPickerCell.tsx` — new picker component.
  - `frontend/src/utils/infrastructurePointDerivation.ts` — new find-or-create helper.
  - `frontend/src/config/__tests__/infrastructureTablesConfig.test.ts` — Vitest config test.

**Key sequencing pivot:** Group 1 lands the foundation (cellType union, derivation helper, display formatter) that Groups 2-5 depend on. Group 2 adds the picker component and the dispatch arm. Group 3 lands all 23 picklist option arrays (no compile-time dependency on Group 1, but logically grouped before gridConfigs which references them). Groups 4-5 build the 16 `gridConfigs` entries plus the 6 tab/domain map updates. Group 6 adds the single Vitest config test and runs the verification sweep.

## Pre-Existing Failing Tests — Implementer Convention

Per project memory, the following Vitest/Jest suites have pre-existing failures unrelated to this spec:
- `bootstrap-summary-fetching.test.ts` (1 fail: URL assertion)
- `conversation-memory-edge-cases.test.ts`
- `dashboardSummary*.test.ts` (metric value assertions)
- `hub-bootstrap-4-task-definition.test.ts` (2 fails: availableFrom)
- `chatV2-panel-integration.test.ts` (3 fails: availableFrom)
- `chatV2-panel-context-and-filtering.test.ts` (1 fail: availableFrom)

This spec must **NOT** modify or attempt to fix any of these. Verification in Group 6 is: `npx tsc --noEmit` is clean (zero new errors), the new `infrastructureTablesConfig.test.ts` passes, and the existing failing-test inventory has not grown.

## Task List

### Foundation Layer

#### Task Group 1: Add `'infrastructure_point_picker'` cellType, derivation helper, and display formatter
**Dependencies:** None

- [x] 1.0 Land the foundational primitives that the picker component (Group 2) and the relationship `gridConfigs` entries (Group 5) will depend on: extend the `CellType` union, create the `infrastructurePointDerivation.ts` helper, and append `infrastructurePointDisplayFormatter` to `formatters.ts`.
  - [x] 1.1 Extend the `CellType` union in `frontend/src/types/config.ts`
    - **File:** `frontend/src/types/config.ts` (lines 59-70)
    - Append `| 'infrastructure_point_picker'` to the existing union.
    - Final union members: `'text' | 'tags' | 'boolean' | 'dropdown' | 'fk_typeahead' | 'text_with_suggestions' | 'application_point_picker' | 'package_set_dropdown' | 'data_entity_point_picker' | 'free_text_typeahead_single_token' | 'tech_hints_cell' | 'infrastructure_point_picker'`.
    - No other type changes — `GridColumnConfig.allowedKinds?: string[]` already exists (used by `application_point_picker`) and is reused for the new cellType.
  - [x] 1.2 Create `frontend/src/utils/infrastructurePointDerivation.ts`
    - **Template:** `frontend/src/utils/applicationPointDerivation.ts` (find-or-create derived row pattern). Mirror the file structure 1:1.
    - **Export signature** (replicating the application-point shape): a function that takes (model, raw entity, raw entity type) and returns an `InfrastructurePoint` id.
    - **Find-or-create logic:** look up `metaModel.entities.infrastructure_points` for an existing row whose typed FK matches the raw entity's id (`compute_resource_id`, `data_store_instance_id`, etc., dispatched on the raw entity type). If found, return its `id`. If not, create a new `InfrastructurePoint` row with:
      - `id`: newly-generated UUID (use the same UUID helper `applicationPointDerivation.ts` uses).
      - `point_kind`: the matching `InfrastructurePointKind` constant — `compute_resources` -> `'COMPUTE_RESOURCE'`, `compute_clusters` -> `'COMPUTE_CLUSTER'`, `data_store_instances` -> `'DATA_STORE_INSTANCE'`, `load_balancers` -> `'LOAD_BALANCER'`, `infrastructure_resources` -> `'INFRASTRUCTURE_RESOURCE'`, `environments` -> `'ENVIRONMENT'`, `cloud_accounts` -> `'CLOUD_ACCOUNT'`, `locations` -> `'LOCATION'`, `networks` -> `'NETWORK'`, `subnets` -> `'SUBNET'`, `deployment_units` -> `'DEPLOYMENT_UNIT'`, `listeners` -> `'LISTENER'`.
      - The corresponding typed FK field set to the raw entity id (e.g. `compute_resource_id: <rawId>`); all other 11 typed FKs remain undefined.
      - `name`: copy from the source entity's `name` (display continuity).
      - `description`: copy from the source entity's `description` (or `''` if absent).
      - `tags`: `''` (empty string — matches `tags: string` shape).
      - `valid_from` / `valid_to`: undefined.
    - **Mutates the model in-place** by pushing into `metaModel.entities.infrastructure_points` (mirrors `applicationPointDerivation.ts` mutation convention).
  - [x] 1.3 Append `infrastructurePointDisplayFormatter` to `frontend/src/utils/formatters.ts`
    - **Template:** the existing `applicationPointDisplayFormatter` in the same file. Mirror the function signature and the missing-row fallback strategy.
    - **Behaviour:** given a point id and the model, find the matching row in `metaModel.entities.infrastructure_points`. If missing, return `'(missing)'`. Otherwise dispatch on `point_kind` to look up the typed FK target (e.g. `point_kind === 'COMPUTE_RESOURCE'` -> look up `compute_resources` by `compute_resource_id`) and return the target's `name`. If the typed FK target is missing, return the point's own `name` as a fallback.
    - All 12 `point_kind` values must be handled in the dispatch.
  - [x] 1.4 Verify TS compiles
    - From `frontend/`, run `npx tsc --noEmit`.
    - Expected: zero new errors. The new cellType union member is reachable from any existing column config but has no consumers yet — Group 2's `GridCell.tsx` switch arm is what will exhaustively match on it. The derivation helper and formatter are pure additions.

**Acceptance Criteria:**
- `'infrastructure_point_picker'` is a member of `CellType` in `config.ts`.
- `frontend/src/utils/infrastructurePointDerivation.ts` exists, modelled on `applicationPointDerivation.ts`, exporting a find-or-create function that maps each of the 12 raw entity types to the matching `InfrastructurePointKind` and typed FK field.
- `infrastructurePointDisplayFormatter` is exported from `frontend/src/utils/formatters.ts`, dispatching on all 12 `point_kind` values, with a `'(missing)'` fallback for missing points and a `name`-fallback for missing FK targets.
- `npx tsc --noEmit` passes with zero new errors.

---

### Picker Component Layer

#### Task Group 2: Create `InfrastructurePointPickerCell.tsx` and wire it into `GridCell.tsx`
**Dependencies:** Task Group 1

- [x] 2.0 Create the new `InfrastructurePointPickerCell.tsx` component (modelled directly on `ApplicationPointPickerCell.tsx`) and add a `case 'infrastructure_point_picker'` arm to the dispatch switch in `GridCell.tsx`.
  - [x] 2.1 Create `frontend/src/components/Grid/InfrastructurePointPickerCell.tsx`
    - **Template:** `frontend/src/components/Grid/ApplicationPointPickerCell.tsx` (~622 lines). Mirror the file structure 1:1: imports, component signature, hooks, grouped-dropdown layout, search/filter UX, `allowedKinds?: string[]` filter logic, on-select derivation call, missing-target fallback rendering.
    - **Source arrays (12 infrastructure entity types):** read from current model state — `metaModel.entities.environments`, `cloud_accounts`, `locations`, `networks`, `subnets`, `compute_clusters`, `compute_resources`, `deployment_units`, `load_balancers`, `listeners`, `data_store_instances`, `infrastructure_resources`. Group display labels match `entityTabNames` strings ("Environments", "Cloud Accounts", "Locations", "Networks", "Subnets", "Compute Clusters", "Compute Resources", "Deployment Units", "Load Balancers", "Listeners", "Data Stores", "Infrastructure Resources").
    - **`allowedKinds` filter:** when `column.allowedKinds` is a non-empty array, restrict the visible groups to those whose `point_kind` constant is in the array. When absent or empty, show all 12 groups. Each option's underlying value is the corresponding `point_kind` constant plus the raw entity id.
    - **On selection of a raw entity:** call `infrastructurePointDerivation` (from Group 1.2) to find-or-create the matching `InfrastructurePoint` row in `metaModel.entities.infrastructure_points` and return its `id` as the cell value.
    - **Display:** use `infrastructurePointDisplayFormatter` (from Group 1.3) to render the picked entity's `name` in the closed-cell view.
    - **Display fallback:** if the stored point id is missing or its target is missing, render a safe `(missing)` placeholder rather than crashing — matches existing `ApplicationPointPickerCell` degrade-gracefully behaviour.
    - **Props parity:** match the prop shape that `ApplicationPointPickerCell` accepts (value, row, column, onChange, model context). The dispatch in `GridCell.tsx` will forward identical props.
  - [x] 2.2 Add the `case 'infrastructure_point_picker'` arm to `frontend/src/components/Grid/GridCell.tsx`
    - **Location:** the dispatch `switch` statement that maps `cellType` to a rendered cell component. Place the new arm immediately after the existing `case 'application_point_picker':` arm so the structurally-similar pickers stay co-located.
    - **Body:** render `<InfrastructurePointPickerCell />` and forward the same props the `'application_point_picker'` arm forwards (value, row, column, onChange, plus any model-context props the existing arm passes).
    - **Import:** add an `import` for the new component at the top of the file.
  - [x] 2.3 Verify TS compiles
    - From `frontend/`, run `npx tsc --noEmit`.
    - Expected: zero new errors. The exhaustive switch in `GridCell.tsx` now matches the extended `CellType` union from Group 1.1.

**Acceptance Criteria:**
- `frontend/src/components/Grid/InfrastructurePointPickerCell.tsx` exists, mirrors the `ApplicationPointPickerCell` structure, supports `allowedKinds?: string[]` filtering across all 12 infrastructure entity groups, calls `infrastructurePointDerivation` on raw-entity selection, and uses `infrastructurePointDisplayFormatter` for closed-cell display.
- `GridCell.tsx` has a `case 'infrastructure_point_picker'` arm rendering the new component with the same prop forwarding shape as `'application_point_picker'`.
- Missing-point and missing-FK-target cases render `(missing)` rather than crashing.
- `npx tsc --noEmit` passes with zero new errors.

---

### Picklist Options Layer

#### Task Group 3: Add 23 picklist option arrays to `defaults.ts`
**Dependencies:** None

- [x] 3.0 Append 23 new `string[]` exports to `frontend/src/config/defaults.ts` covering every Infrastructure picklist enum. All values mirror spec 1's documented enum lists verbatim (uppercase snake_case constants); UI labels are derived at render time via `formatOptionLabel: snakeCaseToTitleCase`.
  - [x] 3.1 Append the 23 option arrays below the existing option arrays
    - **File:** `frontend/src/config/defaults.ts` (append below the existing option-array block at line 959+, alongside `appTypeOptions`, `statusOptions`, `serviceTypeOptions`, etc.).
    - **Pattern:** `export const <name>Options = ['VAL_A', 'VAL_B', ...];` — plain `string[]`. No `Array<{ value, label }>` shape.
    - **The 23 arrays (verbatim from spec 1's documented enums, captured in `requirements.md` lines 484-543):**
      ```ts
      export const environmentTypeOptions = ['DEV', 'TEST', 'STAGING', 'PROD', 'DR', 'CURRENT_STATE', 'TARGET_STATE', 'OTHER'];
      export const lifecycleStateOptions = ['PLANNED', 'ACTIVE', 'DEPRECATED', 'RETIRED'];
      export const criticalityOptions = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
      export const providerOptions = ['GCP', 'AWS', 'AZURE', 'ON_PREM', 'OTHER'];
      export const locationTypeOptions = ['CLOUD_REGION', 'CLOUD_ZONE', 'DATA_CENTRE', 'OFFICE', 'EDGE_SITE', 'OTHER'];
      export const networkTypeOptions = ['VPC', 'VNET', 'ON_PREM_NETWORK', 'LAN', 'WAN', 'OTHER'];
      export const routingModeOptions = ['REGIONAL', 'GLOBAL', 'STATIC', 'DYNAMIC', 'OTHER'];
      export const subnetTypeOptions = ['PUBLIC', 'PRIVATE', 'APP', 'DATA', 'MANAGEMENT', 'DMZ', 'OTHER'];
      export const subnetVisibilityOptions = ['PUBLIC', 'PRIVATE', 'ISOLATED', 'INTERNAL', 'OTHER'];
      export const platformTypeOptions = ['GKE', 'KUBERNETES', 'CLOUD_RUN', 'VMWARE', 'OPENSHIFT', 'SERVER_FARM', 'OTHER'];
      export const operatingModelOptions = ['MANAGED', 'SELF_MANAGED', 'HYBRID', 'OTHER'];
      export const computeTypeOptions = ['VM', 'PHYSICAL_SERVER', 'CONTAINER_SERVICE', 'KUBERNETES_WORKLOAD', 'SERVERLESS_FUNCTION', 'CLOUD_RUN_SERVICE', 'BATCH_JOB', 'OTHER'];
      export const deploymentUnitTypeOptions = ['CONTAINER_IMAGE', 'VM_IMAGE', 'FUNCTION_BUNDLE', 'JAR', 'WAR', 'STATIC_BUNDLE', 'PACKAGE', 'OTHER'];
      export const loadBalancerTypeOptions = ['EXTERNAL_HTTP', 'EXTERNAL_HTTPS', 'INTERNAL_HTTP', 'INTERNAL_TCP', 'INGRESS_CONTROLLER', 'F5', 'NGINX', 'API_GATEWAY', 'OTHER'];
      export const exposureOptions = ['PUBLIC', 'PRIVATE', 'INTERNAL', 'OTHER'];
      export const protocolOptions = ['HTTP', 'HTTPS', 'TCP', 'UDP', 'TLS', 'GRPC', 'OTHER'];
      export const dataStoreTypeOptions = ['RELATIONAL_DB', 'DOCUMENT_DB', 'KEY_VALUE', 'CACHE', 'DATA_WAREHOUSE', 'OBJECT_STORAGE_AS_DATASTORE', 'OTHER'];
      export const engineOptions = ['POSTGRES', 'MYSQL', 'ORACLE', 'SQLSERVER', 'BIGQUERY', 'REDIS', 'MONGODB', 'OTHER'];
      export const resourceTypeOptions = ['OBJECT_BUCKET', 'MESSAGE_TOPIC', 'MESSAGE_QUEUE', 'CACHE', 'SECRET_STORE', 'SCHEDULER', 'EVENT_BUS', 'CDN', 'REGISTRY', 'OTHER'];
      export const infrastructurePointKindOptions = ['ENVIRONMENT', 'CLOUD_ACCOUNT', 'LOCATION', 'NETWORK', 'SUBNET', 'COMPUTE_CLUSTER', 'COMPUTE_RESOURCE', 'DEPLOYMENT_UNIT', 'LOAD_BALANCER', 'LISTENER', 'DATA_STORE_INSTANCE', 'INFRASTRUCTURE_RESOURCE'];
      export const relationshipRoleOptions = ['PRIMARY_PLACEMENT', 'PRIVATE_CONNECTIVITY', 'BACKEND_PLACEMENT', 'OTHER'];
      export const deploymentStatusOptions = ['PLANNED', 'DEPLOYED', 'DEPRECATED', 'FAILED', 'UNKNOWN'];
      export const routingTypeOptions = ['DEFAULT', 'HOST_BASED', 'PATH_BASED', 'WEIGHTED', 'FAILOVER', 'OTHER'];
      ```
    - **Reuse note:** `lifecycleStateOptions` is reused by `environments.lifecycle_state` and `compute_resources.lifecycle_state`. `criticalityOptions` is reused by `environments` and `infrastructure_resources`. `exposureOptions` is reused by `load_balancers` and `listeners`. `protocolOptions` is reused by `listeners` and `load_balancer_resource_routes`. Single shared array per dedupe — do NOT create per-table duplicates.
  - [x] 3.2 Confirm no `gridConfigs` entries or `emptyModel` edits sneak in
    - **Verification only:** the spec 3 `emptyModel` block is untouched; new gridConfigs are landed in Groups 4-5, not here.
    - Do NOT touch any other block in `defaults.ts`.
  - [x] 3.3 Verify TS compiles
    - From `frontend/`, run `npx tsc --noEmit`.
    - Expected: zero new errors. The 23 new exports are pure additions; no consumers reference them yet (Groups 4-5 will).

**Acceptance Criteria:**
- 23 new `<name>Options` exports exist in `frontend/src/config/defaults.ts`, each as a plain `string[]` of uppercase snake_case constants.
- Values match spec 1's documented enums verbatim per the table in `requirements.md` lines 546-577.
- Single shared array for `lifecycleStateOptions`, `criticalityOptions`, `exposureOptions`, and `protocolOptions` (no duplicates).
- `npx tsc --noEmit` passes with zero new errors.

---

### Entity GridConfigs Layer

#### Task Group 4: Add 12 entity `gridConfigs` entries + `infrastructure_points` + entity tab maps
**Dependencies:** Task Groups 1 and 3

- [x] 4.0 Add 12 entity `gridConfigs` entries + 1 hidden `infrastructure_points` entry to `frontend/src/config/gridConfigs.ts`, plus the entity-side tab map updates: 13 new keys in `tabToEntityType` (12 visible + 1 hidden), 12 names appended to `entityTabNames`, the `domainGroupings.infrastructure` placeholder replaced with the 12 visible names, and the `DOMAIN_ENTITY_TYPES.infrastructure` placeholder replaced with the 13 entity-type strings.
  - [x] 4.1 Add `gridConfigs.environments`
    - **File:** `frontend/src/config/gridConfigs.ts` (append below the existing populated entries)
    - Columns (per spec.md per-table table): `name`(text*200), `environment_type`(dropdown,environmentTypeOptions,160,formatOptionLabel: snakeCaseToTitleCase), `lifecycle_state`(dropdown,lifecycleStateOptions,160,formatOptionLabel), `is_current_state`(boolean,80), `is_target_state`(boolean,80), `owner`(text,160), `criticality`(dropdown,criticalityOptions,120,formatOptionLabel), `description`(text,250), `tags`(tags,200), `valid_from`(text,100), `valid_to`(text,100).
    - `name` is the only `required: true` field; all others `required: false`.
  - [x] 4.2 Add `gridConfigs.cloud_accounts`
    - Columns: `name`(text*200), `environment_id`(fk_typeahead,fkTarget:'environments',200), `provider`(dropdown,providerOptions,140,formatOptionLabel) [ONLY table where `provider` is dropdown], `external_account_id`(text,180), `parent_org_id`(text,180), `billing_owner`(text,160), `technical_owner`(text,160), `landing_zone_name`(text,160), `description`(text,250), `tags`(tags,200), `valid_from`(text,100), `valid_to`(text,100).
  - [x] 4.3 Add `gridConfigs.locations`
    - Columns: `name`(text*200), `environment_id`(fk_typeahead,environments,200), `cloud_account_id`(fk_typeahead,cloud_accounts,200), `location_type`(dropdown,locationTypeOptions,160,formatOptionLabel), `provider`(text,140) [freetext, NOT dropdown], `provider_region_code`(text,140), `provider_zone_code`(text,140), `country`(text,120), `city`(text,140), `address`(text,200), envelope (`description`/`tags`/`valid_from`/`valid_to`).
  - [x] 4.4 Add `gridConfigs.networks`
    - Columns: `name`(text*200), `environment_id`(fk,environments,200), `cloud_account_id`(fk,cloud_accounts,200), `location_id`(fk,locations,200), `network_type`(dropdown,networkTypeOptions,140,formatOptionLabel), `provider`(text,140), `cidr`(text,140), `external_id`(text,160), `is_shared`(boolean,80), `routing_mode`(dropdown,routingModeOptions,140,formatOptionLabel), envelope.
  - [x] 4.5 Add `gridConfigs.subnets`
    - Columns: `name`(text*200), `environment_id`(fk,environments,200), `network_id`(fk,networks,200), `location_id`(fk,locations,200), `cidr`(text,140), `subnet_type`(dropdown,subnetTypeOptions,140,formatOptionLabel), `visibility`(dropdown,subnetVisibilityOptions,140,formatOptionLabel), `provider_region_code`(text,140), `provider_zone_code`(text,140), `external_id`(text,160), `gateway_address`(text,160), envelope.
  - [x] 4.6 Add `gridConfigs.compute_clusters`
    - Columns: `name`(text*200), `environment_id`(fk,environments,200), `cloud_account_id`(fk,cloud_accounts,200), `location_id`(fk,locations,200), `network_id`(fk,networks,200), `platform_type`(dropdown,platformTypeOptions,160,formatOptionLabel), `provider`(text,140), `version`(text,120), `external_id`(text,160), `owner`(text,160), `operating_model`(dropdown,operatingModelOptions,160,formatOptionLabel), envelope.
  - [x] 4.7 Add `gridConfigs.compute_resources`
    - Columns: `name`(text*200), `environment_id`(fk,environments,200), `cloud_account_id`(fk,cloud_accounts,200), `location_id`(fk,locations,200), `cluster_id`(fk,compute_clusters,200), `compute_type`(dropdown,computeTypeOptions,180,formatOptionLabel), `provider`(text,140), `hostname`(text,160), `fqdn`(text,200), `private_ip`(text,140), `public_ip`(text,140), `os`(text,120), `runtime`(text,140), `instance_size`(text,140), `scaling_min`(text,100), `scaling_max`(text,100), `external_id`(text,160), `lifecycle_state`(dropdown,lifecycleStateOptions,160,formatOptionLabel) [reused array], `owner`(text,160), envelope.
  - [x] 4.8 Add `gridConfigs.deployment_units`
    - Columns: `name`(text*200), **`service_id`**(fk,services,200) [NOT `application_entity_id` — locked spec 1/3 contract], `deployment_unit_type`(dropdown,deploymentUnitTypeOptions,180,formatOptionLabel), `version`(text,120), `artifact_uri`(text,220), `image_name`(text,200), `image_tag`(text,140), `source_repository`(text,220), `source_commit`(text,160), `build_pipeline`(text,200), `owner`(text,160), envelope.
    - `runtime_config` is NOT exposed (Q10 — round-trips via save/load only).
  - [x] 4.9 Add `gridConfigs.load_balancers`
    - Columns: `name`(text*200), `environment_id`(fk,environments,200), `cloud_account_id`(fk,cloud_accounts,200), `location_id`(fk,locations,200), `network_id`(fk,networks,200), `load_balancer_type`(dropdown,loadBalancerTypeOptions,200,formatOptionLabel), `provider`(text,140), `exposure`(dropdown,exposureOptions,140,formatOptionLabel), `scheme`(text,120), `dns_name`(text,200), `ip_address`(text,140), `external_id`(text,160), `owner`(text,160), envelope.
  - [x] 4.10 Add `gridConfigs.listeners`
    - Columns: `name`(text*200), `environment_id`(fk,environments,200), `load_balancer_id`(fk,load_balancers,200), **`compute_resource_id`**(fk,compute_resources,200) [direct typed FK per spec 1 A1, NOT polymorphic], `protocol`(dropdown,protocolOptions,120,formatOptionLabel), `port`(text,100) [numeric-as-text per `endpoints.port` precedent], `host_name`(text,200), `path_pattern`(text,200), `exposure`(dropdown,exposureOptions,140,formatOptionLabel) [reused array], `is_public`(boolean,80), `certificate_reference`(text,200), `external_id`(text,160), envelope.
  - [x] 4.11 Add `gridConfigs.data_store_instances`
    - Columns: `name`(text*200), `environment_id`(fk,environments,200), `cloud_account_id`(fk,cloud_accounts,200), `location_id`(fk,locations,200), `data_store_type`(dropdown,dataStoreTypeOptions,180,formatOptionLabel), `engine`(dropdown,engineOptions,140,formatOptionLabel), `engine_version`(text,140), `provider`(text,140), `host`(text,200), `port`(text,100), `external_id`(text,160), `encrypted`(boolean,80), `ha_enabled`(boolean,80), `backup_enabled`(boolean,80), `owner`(text,160), envelope.
  - [x] 4.12 Add `gridConfigs.infrastructure_resources`
    - Columns: `name`(text*200), `environment_id`(fk,environments,200), `cloud_account_id`(fk,cloud_accounts,200), `location_id`(fk,locations,200), `resource_type`(dropdown,resourceTypeOptions,180,formatOptionLabel), `provider`(text,140), `provider_resource_type`(text,180), `endpoint`(text,220), `external_id`(text,160), `criticality`(dropdown,criticalityOptions,120,formatOptionLabel) [reused array], `owner`(text,160), envelope.
  - [x] 4.13 Add hidden `gridConfigs.infrastructure_points`
    - Columns: `name`(text*200,required), `point_kind`(dropdown,infrastructurePointKindOptions,180,formatOptionLabel,required), `description`(text,250), `tags`(tags,200), `valid_from`(text,100), `valid_to`(text,100).
    - **Critical:** the 12 typed FK columns (`environment_id`, `cloud_account_id`, ..., `infrastructure_resource_id`) are **NOT** exposed as grid columns — they are populated by `infrastructurePointDerivation.ts` when the picker auto-creates a row. Mirrors how `application_points` is wired today.
  - [x] 4.14 Append 13 keys to `tabToEntityType`
    - **File:** `frontend/src/config/gridConfigs.ts` (lines 606-641 region)
    - 12 visible: `'Environments' -> 'environments'`, `'Cloud Accounts' -> 'cloud_accounts'`, `'Locations' -> 'locations'`, `'Networks' -> 'networks'`, `'Subnets' -> 'subnets'`, `'Compute Clusters' -> 'compute_clusters'`, `'Compute Resources' -> 'compute_resources'`, `'Deployment Units' -> 'deployment_units'`, `'Load Balancers' -> 'load_balancers'`, `'Listeners' -> 'listeners'`, `'Data Stores' -> 'data_store_instances'`, `'Infrastructure Resources' -> 'infrastructure_resources'`.
    - 1 hidden: `'Infrastructure Points' -> 'infrastructure_points'` (so model-update plumbing can dispatch to it via the picker).
  - [x] 4.15 Append 12 names to `entityTabNames`
    - **File:** `frontend/src/config/gridConfigs.ts` (lines 663-695 region)
    - Append: `'Environments'`, `'Cloud Accounts'`, `'Locations'`, `'Networks'`, `'Subnets'`, `'Compute Clusters'`, `'Compute Resources'`, `'Deployment Units'`, `'Load Balancers'`, `'Listeners'`, `'Data Stores'`, `'Infrastructure Resources'`.
    - Do **NOT** append `'Infrastructure Points'` — it's hidden.
  - [x] 4.16 Replace `domainGroupings.infrastructure` placeholder
    - **File:** `frontend/src/config/gridConfigs.ts` (line 710)
    - Spec 3 left `infrastructure: []` as a placeholder. Replace with the 12 visible names in the locked containment-driven order (Q13):
      `['Environments', 'Cloud Accounts', 'Locations', 'Networks', 'Subnets', 'Compute Clusters', 'Compute Resources', 'Deployment Units', 'Load Balancers', 'Listeners', 'Data Stores', 'Infrastructure Resources']`.
  - [x] 4.17 Replace `DOMAIN_ENTITY_TYPES.infrastructure` placeholder
    - **File:** `frontend/src/config/gridConfigs.ts` (line 732)
    - Spec 3 left `infrastructure: []` as a placeholder. Replace with all 13 entity-type strings (12 visible + 1 hidden):
      `['environments', 'cloud_accounts', 'locations', 'networks', 'subnets', 'compute_clusters', 'compute_resources', 'deployment_units', 'load_balancers', 'listeners', 'data_store_instances', 'infrastructure_resources', 'infrastructure_points']`.
  - [x] 4.18 Verify TS compiles
    - From `frontend/`, run `npx tsc --noEmit`.
    - Expected: zero new errors. All 13 new `gridConfigs` keys are typed against `Record<string, GridColumnConfig[]>`; tab maps are `Record<string, string>`; the two domain-keyed records satisfy `Record<ArchitectureDomain, string[]>` now that `infrastructure` has real values.

**Acceptance Criteria:**
- 13 new `gridConfigs` entries (12 visible + `infrastructure_points` hidden) exist in `frontend/src/config/gridConfigs.ts`, with the per-table column shapes from spec.md / requirements.md.
- `name` is the only `required: true` column on the 12 visible entities; on `infrastructure_points`, `name` AND `point_kind` are `required: true`.
- `provider` is `cellType: 'dropdown'` with `providerOptions` ONLY on `cloud_accounts`; everywhere else `provider` is `cellType: 'text'`.
- `deployment_units.service_id` (NOT `application_entity_id`) is a typed FK to `services`; `listeners.compute_resource_id` is a direct typed FK to `compute_resources`.
- Numeric fields (`port`, `scaling_min/max`) use `cellType: 'text'`; boolean fields (`is_current_state`, `is_target_state`, `is_shared`, `is_public`, `encrypted`, `ha_enabled`, `backup_enabled`) use `cellType: 'boolean'`.
- All `dropdown` columns set `formatOptionLabel: snakeCaseToTitleCase`.
- `tabToEntityType` has 13 new keys (12 visible + `'Infrastructure Points' -> 'infrastructure_points'`); `entityTabNames` has 12 new names (no `'Infrastructure Points'`).
- `domainGroupings.infrastructure` is the 12-name array in containment order; `DOMAIN_ENTITY_TYPES.infrastructure` is the 13-string array.
- `npx tsc --noEmit` passes with zero new errors.

---

### Relationship GridConfigs Layer

#### Task Group 5: Add 3 relationship `gridConfigs` entries with polymorphic point pickers + relationship tab maps
**Dependencies:** Task Groups 1, 3, and 4

- [x] 5.0 Add the 3 relationship `gridConfigs` entries with polymorphic `infrastructure_point_picker` columns and per-relationship `allowedKinds` filters, plus the relationship-side tab map updates: 3 new keys in `relationshipTabToType`, 3 names appended to `relationshipTabNames`. Relationships do NOT have `name`, `valid_from`, or `valid_to` columns.
  - [x] 5.1 Add `gridConfigs.resource_subnet_hostings`
    - **File:** `frontend/src/config/gridConfigs.ts`
    - Columns: `infrastructure_point_id`(infrastructure_point_picker, required, `allowedKinds: ['COMPUTE_RESOURCE', 'DATA_STORE_INSTANCE', 'LOAD_BALANCER', 'INFRASTRUCTURE_RESOURCE']`, 280), `subnet_id`(fk_typeahead, required, fkTarget: 'subnets', 200), `environment_id`(fk_typeahead, required, fkTarget: 'environments', 200), `relationship_role`(dropdown, relationshipRoleOptions, 180, formatOptionLabel: snakeCaseToTitleCase), `primary_ip`(text, 140), `private_ip`(text, 140), `public_ip`(text, 140), `evidence_source`(text, 180), `confidence`(text, 100), `description`(text, 250), `tags`(tags, 200).
    - No `name` column; no `valid_from` / `valid_to` columns.
  - [x] 5.2 Add `gridConfigs.deployment_unit_compute_resources`
    - Columns: `deployment_unit_id`(fk_typeahead, required, fkTarget: 'deployment_units', 220), `compute_infrastructure_point_id`(infrastructure_point_picker, required, `allowedKinds: ['COMPUTE_RESOURCE', 'COMPUTE_CLUSTER']`, 280), `environment_id`(fk_typeahead, required, fkTarget: 'environments', 200), `version`(text, 120), `desired_instances`(text, 100), `min_instances`(text, 100), `max_instances`(text, 100), `deployment_status`(dropdown, deploymentStatusOptions, 160, formatOptionLabel), `evidence_source`(text, 180), `confidence`(text, 100), `description`(text, 250), `tags`(tags, 200).
    - `runtime_config` is NOT exposed as a grid column (Q10).
  - [x] 5.3 Add `gridConfigs.load_balancer_resource_routes`
    - Columns: `load_balancer_id`(fk_typeahead, required, fkTarget: 'load_balancers', 200), `listener_id`(fk_typeahead, fkTarget: 'listeners', 200), `target_infrastructure_point_id`(infrastructure_point_picker, required, `allowedKinds: ['COMPUTE_RESOURCE', 'COMPUTE_CLUSTER', 'DATA_STORE_INSTANCE', 'INFRASTRUCTURE_RESOURCE']`, 280), `environment_id`(fk_typeahead, required, fkTarget: 'environments', 200), `protocol`(dropdown, protocolOptions, 120, formatOptionLabel) [reused array], `target_port`(text, 100), `host_name`(text, 200), `path_pattern`(text, 200), `routing_type`(dropdown, routingTypeOptions, 160, formatOptionLabel), `weight`(text, 100), `health_check_path`(text, 200), `description`(text, 250), `tags`(tags, 200).
  - [x] 5.4 Append 3 keys to `relationshipTabToType`
    - **File:** `frontend/src/config/gridConfigs.ts` (lines 647-658 region)
    - Append: `'Resource <-> Subnet' -> 'resource_subnet_hostings'`, `'Deployment Unit <-> Compute' -> 'deployment_unit_compute_resources'`, `'Load Balancer Routes' -> 'load_balancer_resource_routes'`.
    - These display names exactly match the `displayName` values spec 3 added to `RELATIONSHIP_DEFINITIONS` and `RELATIONSHIP_TAB_ORDER`.
  - [x] 5.5 Append 3 names to `relationshipTabNames`
    - **File:** `frontend/src/config/gridConfigs.ts` (lines 739-750 region)
    - Append: `'Resource <-> Subnet'`, `'Deployment Unit <-> Compute'`, `'Load Balancer Routes'`.
  - [x] 5.6 Verify TS compiles
    - From `frontend/`, run `npx tsc --noEmit`.
    - Expected: zero new errors. The 3 new `gridConfigs` entries reference the new `'infrastructure_point_picker'` cellType (Group 1.1), the new option arrays (Group 3), and FK targets to entity tables (Group 4).

**Acceptance Criteria:**
- 3 new relationship `gridConfigs` entries exist with the per-table column shapes from spec.md / requirements.md.
- Polymorphic FK columns use `cellType: 'infrastructure_point_picker'` with the correct per-relationship `allowedKinds` array (Q4):
  - `resource_subnet_hostings.infrastructure_point_id` -> `['COMPUTE_RESOURCE', 'DATA_STORE_INSTANCE', 'LOAD_BALANCER', 'INFRASTRUCTURE_RESOURCE']`.
  - `deployment_unit_compute_resources.compute_infrastructure_point_id` -> `['COMPUTE_RESOURCE', 'COMPUTE_CLUSTER']`.
  - `load_balancer_resource_routes.target_infrastructure_point_id` -> `['COMPUTE_RESOURCE', 'COMPUTE_CLUSTER', 'DATA_STORE_INSTANCE', 'INFRASTRUCTURE_RESOURCE']`.
- All concrete-FK endpoints (`subnet_id`, `deployment_unit_id`, `load_balancer_id`) plus `environment_id` on each relationship are `required: true` (backend NOT NULL columns).
- Relationships have NO `name`, `valid_from`, or `valid_to` columns.
- `runtime_config` is NOT exposed on `deployment_unit_compute_resources` (round-trips via save/load).
- `relationshipTabToType` has 3 new keys; `relationshipTabNames` has 3 new names — exact matches to spec 3's `RELATIONSHIP_TAB_ORDER` strings.
- `npx tsc --noEmit` passes with zero new errors.

---

### Verification Layer

#### Task Group 6: Vitest config test + final TS + Vitest sweep
**Dependencies:** Task Groups 1-5

- [x] 6.0 Add the single Vitest config test asserting all 16 `gridConfigs` entries are wired correctly (entries exist with required fields, tab maps populated, domain groupings populated, `DOMAIN_ENTITY_TYPES.infrastructure` populated). Run the final `npx tsc --noEmit` and Vitest sweep to confirm zero new failures.
  - [x] 6.1 Write 4 focused tests for the new infrastructure tables config
    - **File:** `frontend/src/config/__tests__/infrastructureTablesConfig.test.ts`
    - **Template:** `frontend/src/config/__tests__/userJourneyLinksConfig.test.ts` — Vitest convention, `describe` block per concern, `expect(gridConfigs).toHaveProperty(...)`, `expect(domainGroupings.<domain>).toContain(...)`.
    - Limit to 4 tests covering only the critical wiring contracts (no exhaustive per-column assertions, no rendering tests, no save-pipeline tests):
      1. **Test 1 — `gridConfigs` entries exist for all 16 keys with required-field columns:** assert `gridConfigs` has all 13 entity keys (`environments`, `cloud_accounts`, `locations`, `networks`, `subnets`, `compute_clusters`, `compute_resources`, `deployment_units`, `load_balancers`, `listeners`, `data_store_instances`, `infrastructure_resources`, `infrastructure_points`) and 3 relationship keys (`resource_subnet_hostings`, `deployment_unit_compute_resources`, `load_balancer_resource_routes`). For each entity, assert a `name` column exists with `required: true`. For `infrastructure_points`, additionally assert `point_kind` is `required: true`. For each relationship, assert the `infrastructure_point_picker` columns exist with the expected `allowedKinds` arrays and the documented required FK columns are `required: true`.
      2. **Test 2 — 12 entity tabs are wired through `tabToEntityType` and listed in `domainGroupings.infrastructure`:** iterate the 12 visible tab names; for each, assert `tabToEntityType[name]` resolves to the matching entity-type string and `domainGroupings.infrastructure` contains it. Additionally assert `tabToEntityType['Infrastructure Points'] === 'infrastructure_points'` AND `domainGroupings.infrastructure` does NOT contain `'Infrastructure Points'` (hidden tab assertion).
      3. **Test 3 — 3 relationship tabs are wired through `relationshipTabToType` and present in `RELATIONSHIP_TAB_ORDER`:** iterate the 3 relationship display names (`'Resource <-> Subnet'`, `'Deployment Unit <-> Compute'`, `'Load Balancer Routes'`); for each, assert `relationshipTabToType[name]` resolves to the matching relationship-type string and `RELATIONSHIP_TAB_ORDER` contains it. Also assert `relationshipTabNames` contains all 3.
      4. **Test 4 — `DOMAIN_ENTITY_TYPES.infrastructure` is populated with all 13 entity-type strings:** assert the array has length 13 and contains each of the 12 visible entity types plus `'infrastructure_points'`.
    - **Imports:** `gridConfigs`, `tabToEntityType`, `relationshipTabToType`, `relationshipTabNames`, `domainGroupings`, `DOMAIN_ENTITY_TYPES` from `../gridConfigs`; `RELATIONSHIP_TAB_ORDER` from `../relationshipDefinitions` (or wherever it lives per spec 3).
    - **Out of scope for tests:** no rendering tests for `InfrastructurePointPickerCell`, no save-pipeline tests, no exhaustive per-column shape tests, no derivation-helper tests, no formatter tests.
  - [x] 6.2 Run the new Vitest config test and confirm it passes
    - From `frontend/`, run only the new test file: e.g. `npx vitest run src/config/__tests__/infrastructureTablesConfig.test.ts`.
    - Expected: 4 passing tests. Do **NOT** run the entire test suite at this stage.
  - [x] 6.3 Run `npx tsc --noEmit` for the full frontend
    - From `frontend/`, run `npx tsc --noEmit`.
    - Expected: zero new errors. Any remaining errors must already exist on `master` and not have been introduced by this spec.
  - [x] 6.4 Run the existing Vitest sweep and confirm zero new failures
    - From `frontend/`, run the full Vitest suite (e.g. `npx vitest run`).
    - Expected outcome: the only failures are the pre-existing failing tests already documented in the project memory:
      - `bootstrap-summary-fetching.test.ts` (1 fail)
      - `conversation-memory-edge-cases.test.ts`
      - `dashboardSummary*.test.ts`
      - `hub-bootstrap-4-task-definition.test.ts` (2 fails)
      - `chatV2-panel-integration.test.ts` (3 fails)
      - `chatV2-panel-context-and-filtering.test.ts` (1 fail)
    - **Newly passing:** `infrastructureTablesConfig.test.ts` (4 tests).
    - **No** new failures introduced by this spec; **no** previously-passing tests now failing.
    - **DO NOT** modify or attempt to fix any pre-existing failing test.
    - **Note:** the existing `domain-relationship-filtering.test.ts` will iterate the new `relationshipTabToType` entries and naturally assert the new `gridConfigs` keys exist — it should pass automatically with no edits required.
  - [x] 6.5 Confirm scope discipline
    - **Verification only:** confirm edits only touched the 8 files in scope:
      1. `frontend/src/types/config.ts` (modified — Group 1.1)
      2. `frontend/src/utils/infrastructurePointDerivation.ts` (created — Group 1.2)
      3. `frontend/src/utils/formatters.ts` (modified — Group 1.3)
      4. `frontend/src/components/Grid/InfrastructurePointPickerCell.tsx` (created — Group 2.1)
      5. `frontend/src/components/Grid/GridCell.tsx` (modified — Group 2.2)
      6. `frontend/src/config/defaults.ts` (modified — Group 3.1)
      7. `frontend/src/config/gridConfigs.ts` (modified — Groups 4 + 5)
      8. `frontend/src/config/__tests__/infrastructureTablesConfig.test.ts` (created — Group 6.1)
    - Confirm no edits to `MetaModelView.tsx`, `paletteData.ts`, `model.ts`, `architectureDomain.ts`, `relationshipDefinitions.ts`, `contextPickerDomainMappings.ts`, `useCurrentView.ts`, `modelSerialization.ts`, or any backend/gateway/MCP/discovery code.
    - Confirm no `paletteData.ts` real palette sections were added (placeholders stay `[]`).

**Acceptance Criteria:**
- `frontend/src/config/__tests__/infrastructureTablesConfig.test.ts` exists with exactly 4 focused tests covering: (a) 16 `gridConfigs` entries exist with required-field columns, (b) 12 visible entity tabs wired via `tabToEntityType` and present in `domainGroupings.infrastructure`, (c) 3 relationship tabs wired via `relationshipTabToType` and present in `RELATIONSHIP_TAB_ORDER`, (d) `DOMAIN_ENTITY_TYPES.infrastructure` has all 13 entity-type strings.
- All 4 new tests pass.
- `npx tsc --noEmit` is clean (zero new errors).
- Vitest sweep shows: 4 newly-passing tests (`infrastructureTablesConfig.test.ts`) + identical pre-existing failure inventory + zero regressions.
- Exactly 8 frontend files touched (4 modified, 3 created via Groups 1-2, 1 created via Group 6).
- No edits to `MetaModelView.tsx`, `paletteData.ts`, or any spec-3-owned files; no backend/gateway/MCP/discovery changes.

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Foundation** — extend `CellType` union, create `infrastructurePointDerivation.ts`, append `infrastructurePointDisplayFormatter`. Foundation for the picker component (Group 2) and the relationship `gridConfigs` (Group 5).
2. **Task Group 2: Picker component** — create `InfrastructurePointPickerCell.tsx` and add the dispatch arm in `GridCell.tsx`. Depends on Group 1.
3. **Task Group 3: Picklist option arrays** — append 23 `<name>Options` exports to `defaults.ts`. Independent of Groups 1-2 but logically grouped before `gridConfigs` so the dropdown columns (Groups 4-5) can reference them.
4. **Task Group 4: Entity gridConfigs + entity tab maps** — add 13 entity entries (12 visible + hidden `infrastructure_points`), 13 keys in `tabToEntityType`, 12 names in `entityTabNames`, replace `domainGroupings.infrastructure` and `DOMAIN_ENTITY_TYPES.infrastructure` placeholders. Depends on Groups 1 and 3.
5. **Task Group 5: Relationship gridConfigs + relationship tab maps** — add 3 relationship entries with polymorphic pickers, 3 keys in `relationshipTabToType`, 3 names in `relationshipTabNames`. Depends on Groups 1, 3, and 4 (FK targets to entity tables must exist first).
6. **Task Group 6: Verification** — single Vitest config test (4 tests), final `tsc --noEmit`, full Vitest sweep, scope discipline check.

Groups 1 and 3 are independent and could run in parallel. Group 2 depends on Group 1. Group 4 depends on Groups 1 and 3. Group 5 depends on Groups 1, 3, and 4. Group 6 must run last.

---

## File Summary

### Files to Modify (5)
1. `frontend/src/types/config.ts` — `CellType` union extended with `'infrastructure_point_picker'`.
2. `frontend/src/utils/formatters.ts` — append `infrastructurePointDisplayFormatter`.
3. `frontend/src/components/Grid/GridCell.tsx` — add `case 'infrastructure_point_picker'` arm + import.
4. `frontend/src/config/defaults.ts` — append 23 new picklist option arrays.
5. `frontend/src/config/gridConfigs.ts` — add 16 new `gridConfigs` entries (12 entity + 1 hidden + 3 relationship); 13 new keys in `tabToEntityType`; 12 new names in `entityTabNames`; 3 new keys in `relationshipTabToType`; 3 new names in `relationshipTabNames`; replace `domainGroupings.infrastructure` placeholder with 12 visible names; replace `DOMAIN_ENTITY_TYPES.infrastructure` placeholder with 13 entity-type strings.

### Files to Create (3)
6. `frontend/src/utils/infrastructurePointDerivation.ts` — find-or-create helper modelled on `applicationPointDerivation.ts`.
7. `frontend/src/components/Grid/InfrastructurePointPickerCell.tsx` — picker component modelled on `ApplicationPointPickerCell.tsx`.
8. `frontend/src/config/__tests__/infrastructureTablesConfig.test.ts` — Vitest config test (4 tests) modelled on `userJourneyLinksConfig.test.ts`.

### Files NOT to Touch
- `frontend/src/types/model.ts` — done by spec 3.
- `frontend/src/types/architectureDomain.ts` — done by spec 3.
- `frontend/src/config/relationshipDefinitions.ts` — done by spec 3.
- `frontend/src/utils/contextPickerDomainMappings.ts` — done by spec 3.
- `frontend/src/utils/paletteData.ts` — placeholders stay `[]`.
- `frontend/src/api/modelSerialization.ts` — done by spec 3.
- `frontend/src/components/MetaModelView/MetaModelView.tsx` — already domain-agnostic.
- `frontend/src/hooks/useCurrentView.ts` — done by spec 3.
- `frontend/src/config/defaults.ts` `emptyModel` — done by spec 3 (only the option-arrays section is touched here).
- Any backend, gateway, MCP, discovery, Terraform, or test fixture beyond the new config test.

---

## Reference Patterns

### Existing Code to Follow

- **`ApplicationPointPickerCell.tsx`** (`frontend/src/components/Grid/ApplicationPointPickerCell.tsx`, ~622 lines)
  - Primary template for `InfrastructurePointPickerCell.tsx`. Already implements grouped dropdown across multiple entity types, search/filter UX, `allowedKinds?: string[]` filter, and auto-derive on selection. Mirror file structure 1:1; replace 5 application source arrays with 12 infrastructure source arrays; replace `applicationPointDerivation` calls with `infrastructurePointDerivation`; replace `applicationPointDisplayFormatter` with `infrastructurePointDisplayFormatter`.

- **`applicationPointDerivation.ts`** (template for `infrastructurePointDerivation.ts`)
  - Find-or-create logic. Replicate but write to `metaModel.entities.infrastructure_points` and dispatch on raw entity type to set `point_kind` + the matching one of 12 typed FK fields.

- **`applicationPointDisplayFormatter`** in `frontend/src/utils/formatters.ts` (template for `infrastructurePointDisplayFormatter`)
  - Mirror function signature and missing-row fallback. Dispatch on all 12 `point_kind` values.

- **Existing populated `gridConfigs` entries** (`frontend/src/config/gridConfigs.ts`)
  - The 7 existing entries (`business_*`, `applications`, `services`, `endpoints`, `data_*`, `user_journey*`) are the structural template — copy column-shape conventions for envelope columns, FK columns, dropdown columns, boolean columns wholesale.

- **`user_journey_links.relationship_type`** (`gridConfigs.ts:589`) — exact pattern for `cellType: 'dropdown'` + `formatOptionLabel: snakeCaseToTitleCase`.

- **`endpoints.port` / `data_movements.sequence_order`** — pattern for numeric-as-text columns (`cellType: 'text'` for all numeric fields per the no-`'number'`-cellType convention).

- **`applications.is_internal`** (line 120) / **`services.is_internal`** (line 167) — boolean cellType precedent.

- **`appTypeOptions`, `statusOptions`, `serviceTypeOptions`** in `defaults.ts:959+` — pattern for the 23 new option arrays (plain `string[]`, no per-entry label).

- **`userJourneyLinksConfig.test.ts`** — Vitest pattern for the new `infrastructureTablesConfig.test.ts`.

### Key Decisions to Honour

- **Locked field contract is authoritative** — `deployment_units.service_id` (NOT `application_entity_id`); `listeners.compute_resource_id` is a direct typed FK (NOT polymorphic); relationship polymorphic FKs are `infrastructure_point_id` / `compute_infrastructure_point_id` / `target_infrastructure_point_id`.
- **Snake_case field names everywhere** — exact match to spec 3 TypeScript interface field names.
- **`name` is the only `required: true` column on entities** (plus `point_kind` on the hidden `infrastructure_points`); on relationships, the picker FK + concrete FKs + `environment_id` are `required: true` (backend NOT NULL).
- **`provider` dropdown only on `cloud_accounts`** — everywhere else it is freetext `cellType: 'text'` (judgement call documented in `requirements.md` Q12).
- **Reuse single shared option arrays** — `lifecycleStateOptions`, `criticalityOptions`, `exposureOptions`, `protocolOptions` are reused across multiple tables; do not duplicate.
- **No `'number'` cellType** — all numeric fields use `cellType: 'text'`.
- **No multiline edit cell** — `description` is single-line `cellType: 'text'` everywhere.
- **`infrastructure_points` is hidden** — registered in `tabToEntityType` and `gridConfigs` for internal wiring (picker writes back via the same model-update plumbing) but excluded from `entityTabNames` and `domainGroupings.infrastructure`. The 12 typed FK columns are NOT exposed.
- **`runtime_config` is NOT exposed** as a grid column on `deployment_unit_compute_resources` (Q10) — round-trips via save/load through spec 3 normalisation.
- **`allowedKinds` enforcement is UI-only** — filtering happens inside `InfrastructurePointPickerCell.tsx`. No backend or DB validation.
- **Backward compatibility** — additive only. The 7 existing populated `gridConfigs` keys are untouched. `MetaModelView.tsx` is untouched (already domain-agnostic). Save/load round-trip already works via spec 3 normalisation. Existing pre-existing failing tests remain unchanged.
- **Tests are limited** — only one new test file (4 focused tests on config wiring). No table-component rendering tests, no save-pipeline tests, no `InfrastructurePointPickerCell` component tests, no derivation-helper tests, no formatter tests.
