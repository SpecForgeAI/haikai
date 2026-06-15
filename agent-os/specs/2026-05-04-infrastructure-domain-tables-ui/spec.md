# Specification: Infrastructure Domain Tables UI

## Goal
Add table-based UI support for the Infrastructure domain by extending `gridConfigs.ts`, `defaults.ts`, and the cell-component layer with 16 new grid configurations, 23 picklist option arrays, and a new polymorphic `'infrastructure_point_picker'` cellType, so users can manually view, add, edit, and delete the 12 entities + 3 relationships through the existing `MetaModelView` UI.

## User Stories
- As an architect, I want Infrastructure to appear as a first-class domain tab containing 12 entity tables and 3 relationship tables so that I can manually model environments, networks, compute, deployment units, load balancers, data stores, and their hostings/routings without diagrams or Terraform.
- As an architect editing a polymorphic Infrastructure relationship (resource-to-subnet, deployment-unit-to-compute, load-balancer-route), I want a grouped picker that restricts me to the legal endpoint kinds for that relationship and auto-creates the underlying `InfrastructurePoint` row so I never need to manage the supertype directly.

## Specific Requirements

**12 entity `gridConfigs` entries with locked snake_case field names**
- Add `gridConfigs.environments`, `gridConfigs.cloud_accounts`, `gridConfigs.locations`, `gridConfigs.networks`, `gridConfigs.subnets`, `gridConfigs.compute_clusters`, `gridConfigs.compute_resources`, `gridConfigs.deployment_units`, `gridConfigs.load_balancers`, `gridConfigs.listeners`, `gridConfigs.data_store_instances`, `gridConfigs.infrastructure_resources` matching the per-table column lists in the per-table tables section below.
- Every entity carries the standard envelope: `name` (`text`, required, width 200), `description` (`text`, width 250), `tags` (`tags`, width 200), `valid_from` (`text`, width 100), `valid_to` (`text`, width 100). `name` is the only `required: true` field on entities.
- All FK columns use `cellType: 'fk_typeahead'` with the matching `fkTarget`. `deployment_units.service_id` (NOT `application_entity_id`) targets `services`. `listeners.compute_resource_id` is a direct typed FK to `compute_resources` (per spec 1 A1, NOT polymorphic).
- All enum-style fields use `cellType: 'dropdown'` with `formatOptionLabel: snakeCaseToTitleCase` and a `defaults.ts` option array. All numeric-by-nature fields (`port`, `target_port`, `weight`, `scaling_min`, `scaling_max`, `desired_instances`, `min_instances`, `max_instances`, `confidence`) use `cellType: 'text'` (no `'number'` cellType exists; matches `endpoints.port` precedent). All boolean fields (`is_current_state`, `is_target_state`, `is_shared`, `is_public`, `encrypted`, `ha_enabled`, `backup_enabled`) use `cellType: 'boolean'`.
- `provider` is `cellType: 'dropdown'` with `providerOptions` only on `cloud_accounts`; on every other entity (`locations`, `networks`, `compute_clusters`, `compute_resources`, `load_balancers`, `data_store_instances`, `infrastructure_resources`) `provider` is `cellType: 'text'` because the backend column is documented as freetext-by-design.

**Hidden `infrastructure_points` registration**
- Add `gridConfigs.infrastructure_points` with columns `name` (text, required), `point_kind` (dropdown, required, `infrastructurePointKindOptions`, width 180), `description`, `tags`, `valid_from`, `valid_to`.
- Add a `tabToEntityType` entry for `infrastructure_points` (so model-update plumbing can dispatch to it) but DO NOT add it to `entityTabNames`, `domainGroupings.infrastructure`, or any visible tab list. The 12 typed FK columns are NOT exposed in the grid; they are populated by `infrastructurePointDerivation.ts` based on the chosen `point_kind`. Mirrors how `application_points` is wired today.

**3 relationship `gridConfigs` entries with polymorphic point pickers**
- Add `gridConfigs.resource_subnet_hostings`: `infrastructure_point_id` (`infrastructure_point_picker`, required, `allowedKinds: ['COMPUTE_RESOURCE', 'DATA_STORE_INSTANCE', 'LOAD_BALANCER', 'INFRASTRUCTURE_RESOURCE']`, width 280), `subnet_id` (`fk_typeahead`, required, `fkTarget: 'subnets'`), `environment_id` (`fk_typeahead`, required, `fkTarget: 'environments'`), `relationship_role` (`dropdown`, `relationshipRoleOptions`), `primary_ip`, `private_ip`, `public_ip`, `evidence_source`, `confidence`, `description`, `tags`.
- Add `gridConfigs.deployment_unit_compute_resources`: `deployment_unit_id` (`fk_typeahead`, required, `fkTarget: 'deployment_units'`), `compute_infrastructure_point_id` (`infrastructure_point_picker`, required, `allowedKinds: ['COMPUTE_RESOURCE', 'COMPUTE_CLUSTER']`, width 280), `environment_id` (`fk_typeahead`, required, `fkTarget: 'environments'`), `version`, `desired_instances`, `min_instances`, `max_instances`, `deployment_status` (`dropdown`, `deploymentStatusOptions`), `evidence_source`, `confidence`, `description`, `tags`. `runtime_config` is NOT exposed as a grid column; it round-trips via spec 3 normalisation.
- Add `gridConfigs.load_balancer_resource_routes`: `load_balancer_id` (`fk_typeahead`, required, `fkTarget: 'load_balancers'`), `listener_id` (`fk_typeahead`, `fkTarget: 'listeners'`), `target_infrastructure_point_id` (`infrastructure_point_picker`, required, `allowedKinds: ['COMPUTE_RESOURCE', 'COMPUTE_CLUSTER', 'DATA_STORE_INSTANCE', 'INFRASTRUCTURE_RESOURCE']`, width 280), `environment_id` (`fk_typeahead`, required, `fkTarget: 'environments'`), `protocol` (`dropdown`, `protocolOptions`), `target_port`, `host_name`, `path_pattern`, `routing_type` (`dropdown`, `routingTypeOptions`), `weight`, `health_check_path`, `description`, `tags`. Relationships have NO `name`, `valid_from`, or `valid_to` columns.

**Tab/domain map population in `gridConfigs.ts`**
- Add 13 keys to `tabToEntityType`: 12 visible (`'Environments' -> 'environments'`, `'Cloud Accounts' -> 'cloud_accounts'`, `'Locations' -> 'locations'`, `'Networks' -> 'networks'`, `'Subnets' -> 'subnets'`, `'Compute Clusters' -> 'compute_clusters'`, `'Compute Resources' -> 'compute_resources'`, `'Deployment Units' -> 'deployment_units'`, `'Load Balancers' -> 'load_balancers'`, `'Listeners' -> 'listeners'`, `'Data Stores' -> 'data_store_instances'`, `'Infrastructure Resources' -> 'infrastructure_resources'`) + 1 hidden (`'Infrastructure Points' -> 'infrastructure_points'`).
- Add 3 keys to `relationshipTabToType`: `'Resource <-> Subnet' -> 'resource_subnet_hostings'`, `'Deployment Unit <-> Compute' -> 'deployment_unit_compute_resources'`, `'Load Balancer Routes' -> 'load_balancer_resource_routes'`.
- Append the 12 visible entity tab names to `entityTabNames`. Append the 3 relationship tab names to `relationshipTabNames`.
- Replace the `domainGroupings.infrastructure: []` placeholder (currently at line 710) with the 12 visible names in containment order: `['Environments', 'Cloud Accounts', 'Locations', 'Networks', 'Subnets', 'Compute Clusters', 'Compute Resources', 'Deployment Units', 'Load Balancers', 'Listeners', 'Data Stores', 'Infrastructure Resources']`.
- Replace the `DOMAIN_ENTITY_TYPES.infrastructure: []` placeholder (currently at line 732) with the 13 entity-type strings (12 visible + `'infrastructure_points'`).

**23 picklist option arrays in `defaults.ts`**
- Append the following 23 `string[]` exports below the existing option arrays (`appTypeOptions`, etc., from line 959). All values are uppercase snake_case and mirror spec 1's documented enums verbatim:
  - `environmentTypeOptions = ['DEV','TEST','STAGING','PROD','DR','CURRENT_STATE','TARGET_STATE','OTHER']`
  - `lifecycleStateOptions = ['PLANNED','ACTIVE','DEPRECATED','RETIRED']` (reused by `environments.lifecycle_state` and `compute_resources.lifecycle_state`)
  - `criticalityOptions = ['LOW','MEDIUM','HIGH','CRITICAL']` (reused by `environments` and `infrastructure_resources`)
  - `providerOptions = ['GCP','AWS','AZURE','ON_PREM','OTHER']` (only used on `cloud_accounts.provider`)
  - `locationTypeOptions = ['CLOUD_REGION','CLOUD_ZONE','DATA_CENTRE','OFFICE','EDGE_SITE','OTHER']`
  - `networkTypeOptions = ['VPC','VNET','ON_PREM_NETWORK','LAN','WAN','OTHER']`
  - `routingModeOptions = ['REGIONAL','GLOBAL','STATIC','DYNAMIC','OTHER']`
  - `subnetTypeOptions = ['PUBLIC','PRIVATE','APP','DATA','MANAGEMENT','DMZ','OTHER']`
  - `subnetVisibilityOptions = ['PUBLIC','PRIVATE','ISOLATED','INTERNAL','OTHER']`
  - `platformTypeOptions = ['GKE','KUBERNETES','CLOUD_RUN','VMWARE','OPENSHIFT','SERVER_FARM','OTHER']`
  - `operatingModelOptions = ['MANAGED','SELF_MANAGED','HYBRID','OTHER']`
  - `computeTypeOptions = ['VM','PHYSICAL_SERVER','CONTAINER_SERVICE','KUBERNETES_WORKLOAD','SERVERLESS_FUNCTION','CLOUD_RUN_SERVICE','BATCH_JOB','OTHER']`
  - `deploymentUnitTypeOptions = ['CONTAINER_IMAGE','VM_IMAGE','FUNCTION_BUNDLE','JAR','WAR','STATIC_BUNDLE','PACKAGE','OTHER']`
  - `loadBalancerTypeOptions = ['EXTERNAL_HTTP','EXTERNAL_HTTPS','INTERNAL_HTTP','INTERNAL_TCP','INGRESS_CONTROLLER','F5','NGINX','API_GATEWAY','OTHER']`
  - `exposureOptions = ['PUBLIC','PRIVATE','INTERNAL','OTHER']` (reused by `load_balancers.exposure` and `listeners.exposure`)
  - `protocolOptions = ['HTTP','HTTPS','TCP','UDP','TLS','GRPC','OTHER']` (reused by `listeners.protocol` and `load_balancer_resource_routes.protocol`)
  - `dataStoreTypeOptions = ['RELATIONAL_DB','DOCUMENT_DB','KEY_VALUE','CACHE','DATA_WAREHOUSE','OBJECT_STORAGE_AS_DATASTORE','OTHER']`
  - `engineOptions = ['POSTGRES','MYSQL','ORACLE','SQLSERVER','BIGQUERY','REDIS','MONGODB','OTHER']`
  - `resourceTypeOptions = ['OBJECT_BUCKET','MESSAGE_TOPIC','MESSAGE_QUEUE','CACHE','SECRET_STORE','SCHEDULER','EVENT_BUS','CDN','REGISTRY','OTHER']`
  - `infrastructurePointKindOptions = ['ENVIRONMENT','CLOUD_ACCOUNT','LOCATION','NETWORK','SUBNET','COMPUTE_CLUSTER','COMPUTE_RESOURCE','DEPLOYMENT_UNIT','LOAD_BALANCER','LISTENER','DATA_STORE_INSTANCE','INFRASTRUCTURE_RESOURCE']`
  - `relationshipRoleOptions = ['PRIMARY_PLACEMENT','PRIVATE_CONNECTIVITY','BACKEND_PLACEMENT','OTHER']`
  - `deploymentStatusOptions = ['PLANNED','DEPLOYED','DEPRECATED','FAILED','UNKNOWN']`
  - `routingTypeOptions = ['DEFAULT','HOST_BASED','PATH_BASED','WEIGHTED','FAILOVER','OTHER']`

**New `'infrastructure_point_picker'` cellType**
- Extend the `CellType` string union in `frontend/src/types/config.ts` (lines 59-70) with `'infrastructure_point_picker'`, appended to the existing list. No other type changes.
- Add a `case 'infrastructure_point_picker'` arm to the dispatch `switch` in `frontend/src/components/Grid/GridCell.tsx`, rendering the new `<InfrastructurePointPickerCell />` and forwarding the same props the `'application_point_picker'` arm does (value, row, column, onChange, model context).

**New `InfrastructurePointPickerCell.tsx` component**
- Create `frontend/src/components/Grid/InfrastructurePointPickerCell.tsx` modelled directly on `ApplicationPointPickerCell.tsx` (~600 lines). Reuse the same grouped-dropdown layout, search/filter UX, and `allowedKinds?: string[]` filter logic.
- Source options from the 12 visible Infrastructure entity arrays (`environments`, `cloud_accounts`, `locations`, `networks`, `subnets`, `compute_clusters`, `compute_resources`, `deployment_units`, `load_balancers`, `listeners`, `data_store_instances`, `infrastructure_resources`) on the current model state. Group by entity type with display labels matching `entityTabNames`.
- Apply `column.allowedKinds` to filter visible groups; if absent, show all 12 groups. Each option's underlying value is the corresponding `point_kind` constant (e.g. `COMPUTE_RESOURCE` for compute resources) plus the raw entity id.
- On selection of a raw entity, call `infrastructurePointDerivation.ts` to find-or-create the matching `InfrastructurePoint` row in `metaModel.entities.infrastructure_points` and return its `id` as the cell value. Display the picked entity's `name` via `infrastructurePointDisplayFormatter`.
- Display fallback: if the stored point id is missing or its target is missing, render a safe "(missing)" placeholder rather than crashing — matches existing `ApplicationPointPickerCell` degrade-gracefully behaviour.

**New `infrastructurePointDerivation.ts` helper**
- Create `frontend/src/utils/infrastructurePointDerivation.ts` modelled on `applicationPointDerivation.ts`.
- Export a function that takes (model, raw entity, raw entity type) and returns an `InfrastructurePoint` id, creating a new row in `metaModel.entities.infrastructure_points` only if no existing point with that typed FK exists.
- The created row must set `point_kind` to the matching `InfrastructurePointKind` and populate the corresponding typed FK column (e.g. picking a `compute_resources` row sets `point_kind: 'COMPUTE_RESOURCE'` and `compute_resource_id: <rawId>`). All other typed FKs remain undefined.
- Copy `name`/`description` from the source entity for display continuity, leave `tags` empty string, leave `valid_from`/`valid_to` undefined.

**New `infrastructurePointDisplayFormatter` in `formatters.ts`**
- Append `infrastructurePointDisplayFormatter` to `frontend/src/utils/formatters.ts`, mirroring the existing `applicationPointDisplayFormatter`.
- Given a point id and the model, resolve to the underlying typed-FK target and return its `name`. If the point is missing, return `'(missing)'`. If the typed FK target is missing, return the point's own `name` as fallback.

**One Vitest config test**
- Create `frontend/src/config/__tests__/infrastructureTablesConfig.test.ts` modelled on `userJourneyLinksConfig.test.ts`.
- Assert: (a) all 16 keys (12 entity + 3 relationship + `infrastructure_points`) exist in `gridConfigs` with at least the required-field columns present; (b) the 12 visible entity tab names exist in both `tabToEntityType` and `domainGroupings.infrastructure`; (c) the 3 relationship tab names exist in both `relationshipTabToType` and `RELATIONSHIP_TAB_ORDER`; (d) `DOMAIN_ENTITY_TYPES.infrastructure` contains exactly the 13 entity-type strings.
- No table-component rendering tests, no save-pipeline tests, no `InfrastructurePointPickerCell` component tests in this spec.

**Backward compatibility and non-regression**
- All changes are additive. The 7 existing populated `gridConfigs` keys (`business_*`, `applications`, `services`, `endpoints`, `data_*`, `user_journey*`, etc.) are untouched. `MetaModelView.tsx` is untouched (already domain-agnostic). Save/load round-trip already works via spec 3 normalisation.
- Existing pre-existing failing tests (per project memory) remain unchanged.

## Per-Table Column Shape (carried verbatim from requirements.md)

**Entity 1: `environments`** — `name`(text*200), `environment_type`(dropdown,environmentTypeOptions,160), `lifecycle_state`(dropdown,lifecycleStateOptions,160), `is_current_state`(boolean,80), `is_target_state`(boolean,80), `owner`(text,160), `criticality`(dropdown,criticalityOptions,120), `description`(text,250), `tags`(tags,200), `valid_from`(text,100), `valid_to`(text,100).

**Entity 2: `cloud_accounts`** — `name`*, `environment_id`(fk,environments,200), `provider`(dropdown,providerOptions,140), `external_account_id`(text,180), `parent_org_id`(text,180), `billing_owner`(text,160), `technical_owner`(text,160), `landing_zone_name`(text,160), `description`, `tags`, `valid_from`, `valid_to`.

**Entity 3: `locations`** — `name`*, `environment_id`(fk,environments), `cloud_account_id`(fk,cloud_accounts), `location_type`(dropdown,locationTypeOptions,160), `provider`(text,140), `provider_region_code`(text,140), `provider_zone_code`(text,140), `country`(text,120), `city`(text,140), `address`(text,200), `description`, `tags`, `valid_from`, `valid_to`.

**Entity 4: `networks`** — `name`*, `environment_id`(fk,environments), `cloud_account_id`(fk,cloud_accounts), `location_id`(fk,locations), `network_type`(dropdown,networkTypeOptions,140), `provider`(text,140), `cidr`(text,140), `external_id`(text,160), `is_shared`(boolean,80), `routing_mode`(dropdown,routingModeOptions,140), `description`, `tags`, `valid_from`, `valid_to`.

**Entity 5: `subnets`** — `name`*, `environment_id`(fk,environments), `network_id`(fk,networks), `location_id`(fk,locations), `cidr`(text,140), `subnet_type`(dropdown,subnetTypeOptions,140), `visibility`(dropdown,subnetVisibilityOptions,140), `provider_region_code`(text,140), `provider_zone_code`(text,140), `external_id`(text,160), `gateway_address`(text,160), `description`, `tags`, `valid_from`, `valid_to`.

**Entity 6: `compute_clusters`** — `name`*, `environment_id`(fk,environments), `cloud_account_id`(fk,cloud_accounts), `location_id`(fk,locations), `network_id`(fk,networks), `platform_type`(dropdown,platformTypeOptions,160), `provider`(text,140), `version`(text,120), `external_id`(text,160), `owner`(text,160), `operating_model`(dropdown,operatingModelOptions,160), `description`, `tags`, `valid_from`, `valid_to`.

**Entity 7: `compute_resources`** — `name`*, `environment_id`(fk,environments), `cloud_account_id`(fk,cloud_accounts), `location_id`(fk,locations), `cluster_id`(fk,compute_clusters), `compute_type`(dropdown,computeTypeOptions,180), `provider`(text,140), `hostname`(text,160), `fqdn`(text,200), `private_ip`(text,140), `public_ip`(text,140), `os`(text,120), `runtime`(text,140), `instance_size`(text,140), `scaling_min`(text,100), `scaling_max`(text,100), `external_id`(text,160), `lifecycle_state`(dropdown,lifecycleStateOptions,160), `owner`(text,160), `description`, `tags`, `valid_from`, `valid_to`.

**Entity 8: `deployment_units`** — `name`*, `service_id`(fk,services,200) [NOT `application_entity_id`], `deployment_unit_type`(dropdown,deploymentUnitTypeOptions,180), `version`(text,120), `artifact_uri`(text,220), `image_name`(text,200), `image_tag`(text,140), `source_repository`(text,220), `source_commit`(text,160), `build_pipeline`(text,200), `owner`(text,160), `description`, `tags`, `valid_from`, `valid_to`. `runtime_config` NOT exposed.

**Entity 9: `load_balancers`** — `name`*, `environment_id`(fk,environments), `cloud_account_id`(fk,cloud_accounts), `location_id`(fk,locations), `network_id`(fk,networks), `load_balancer_type`(dropdown,loadBalancerTypeOptions,200), `provider`(text,140), `exposure`(dropdown,exposureOptions,140), `scheme`(text,120), `dns_name`(text,200), `ip_address`(text,140), `external_id`(text,160), `owner`(text,160), `description`, `tags`, `valid_from`, `valid_to`.

**Entity 10: `listeners`** — `name`*, `environment_id`(fk,environments), `load_balancer_id`(fk,load_balancers), `compute_resource_id`(fk,compute_resources) [direct typed FK, NOT polymorphic], `protocol`(dropdown,protocolOptions,120), `port`(text,100), `host_name`(text,200), `path_pattern`(text,200), `exposure`(dropdown,exposureOptions,140), `is_public`(boolean,80), `certificate_reference`(text,200), `external_id`(text,160), `description`, `tags`, `valid_from`, `valid_to`.

**Entity 11: `data_store_instances`** — `name`*, `environment_id`(fk,environments), `cloud_account_id`(fk,cloud_accounts), `location_id`(fk,locations), `data_store_type`(dropdown,dataStoreTypeOptions,180), `engine`(dropdown,engineOptions,140), `engine_version`(text,140), `provider`(text,140), `host`(text,200), `port`(text,100), `external_id`(text,160), `encrypted`(boolean,80), `ha_enabled`(boolean,80), `backup_enabled`(boolean,80), `owner`(text,160), `description`, `tags`, `valid_from`, `valid_to`.

**Entity 12: `infrastructure_resources`** — `name`*, `environment_id`(fk,environments), `cloud_account_id`(fk,cloud_accounts), `location_id`(fk,locations), `resource_type`(dropdown,resourceTypeOptions,180), `provider`(text,140), `provider_resource_type`(text,180), `endpoint`(text,220), `external_id`(text,160), `criticality`(dropdown,criticalityOptions,120), `owner`(text,160), `description`, `tags`, `valid_from`, `valid_to`.

**Entity 13 (hidden): `infrastructure_points`** — `name`*(text,200), `point_kind`*(dropdown,infrastructurePointKindOptions,180), `description`, `tags`, `valid_from`, `valid_to`. The 12 typed FK columns are NOT exposed in the grid; populated by `infrastructurePointDerivation.ts`.

**Relationship 1: `resource_subnet_hostings`** — `infrastructure_point_id`*(infrastructure_point_picker, allowedKinds: COMPUTE_RESOURCE/DATA_STORE_INSTANCE/LOAD_BALANCER/INFRASTRUCTURE_RESOURCE, 280), `subnet_id`*(fk,subnets,200), `environment_id`*(fk,environments,200), `relationship_role`(dropdown,relationshipRoleOptions,180), `primary_ip`(text,140), `private_ip`(text,140), `public_ip`(text,140), `evidence_source`(text,180), `confidence`(text,100), `description`(text,250), `tags`(tags,200).

**Relationship 2: `deployment_unit_compute_resources`** — `deployment_unit_id`*(fk,deployment_units,220), `compute_infrastructure_point_id`*(infrastructure_point_picker, allowedKinds: COMPUTE_RESOURCE/COMPUTE_CLUSTER, 280), `environment_id`*(fk,environments,200), `version`(text,120), `desired_instances`(text,100), `min_instances`(text,100), `max_instances`(text,100), `deployment_status`(dropdown,deploymentStatusOptions,160), `evidence_source`(text,180), `confidence`(text,100), `description`(text,250), `tags`(tags,200). `runtime_config` NOT exposed.

**Relationship 3: `load_balancer_resource_routes`** — `load_balancer_id`*(fk,load_balancers,200), `listener_id`(fk,listeners,200), `target_infrastructure_point_id`*(infrastructure_point_picker, allowedKinds: COMPUTE_RESOURCE/COMPUTE_CLUSTER/DATA_STORE_INSTANCE/INFRASTRUCTURE_RESOURCE, 280), `environment_id`*(fk,environments,200), `protocol`(dropdown,protocolOptions,120), `target_port`(text,100), `host_name`(text,200), `path_pattern`(text,200), `routing_type`(dropdown,routingTypeOptions,160), `weight`(text,100), `health_check_path`(text,200), `description`(text,250), `tags`(tags,200).

## Visual Design
N/A — table-config and component-shell spec, no UI artefacts. Reference UX is the existing per-domain `MetaModelView` rendering against `gridConfigs[<key>]`.

## Existing Code to Leverage

**`gridConfigs.ts` existing entries (`frontend/src/config/gridConfigs.ts`, 752 lines)**
- The 7 existing populated entries (`business_*`, `applications`, `services`, `endpoints`, `data_*`, `user_journey*`) are the structural template — copy column-shape conventions for envelope columns, FK columns, dropdown columns, boolean columns wholesale.
- `user_journey_links.relationship_type` (line 589) is the exact pattern for `cellType: 'dropdown'` + `formatOptionLabel: snakeCaseToTitleCase`.
- `endpoints.port` and `data_movements.sequence_order` are precedent for numeric-as-text columns (no `'number'` cellType in the codebase).
- `applications.is_internal` (line 120) and `services.is_internal` (line 167) are precedent for `cellType: 'boolean'`.

**`ApplicationPointPickerCell.tsx` (`frontend/src/components/Grid/ApplicationPointPickerCell.tsx`, 622 lines)**
- Primary template for `InfrastructurePointPickerCell.tsx`. Already implements grouped dropdown across multiple entity types, search filtering, `allowedKinds?: string[]` column-config filter, and auto-derive on selection.
- Mirror the file structure 1:1: replace the 5 application source arrays with the 12 infrastructure source arrays, replace `applicationPointDerivation` calls with `infrastructurePointDerivation` calls, replace `applicationPointDisplayFormatter` with `infrastructurePointDisplayFormatter`.

**`applicationPointDerivation.ts` (find-or-create derived row)**
- Template for `infrastructurePointDerivation.ts`. Replicate the find-or-create logic but write to `metaModel.entities.infrastructure_points` and set `point_kind` + the matching one of 12 typed FK fields based on the source entity type.

**`defaults.ts` option-array conventions (`frontend/src/config/defaults.ts:959+`)**
- Pattern shape: `export const <name>Options = ['VAL_A', 'VAL_B', ...]` — plain `string[]` for raw values; `formatOptionLabel: snakeCaseToTitleCase` handles display labels at render time.

**`userJourneyLinksConfig.test.ts` (`frontend/src/config/__tests__/userJourneyLinksConfig.test.ts`)**
- Vitest pattern for the new `infrastructureTablesConfig.test.ts`. Replicate the structure: `describe` block per concern (gridConfigs entries, tab maps, domain groupings), `expect(gridConfigs).toHaveProperty(...)`, `expect(domainGroupings.<domain>).toContain(...)`, etc.

## Out of Scope
- Infrastructure diagram rendering, palette, shapes, or layout — `paletteData.ts` placeholders stay `[]`.
- Backend, Gateway, MCP, or Discovery-service changes.
- Terraform / IaC import, export, or generation.
- `MetaModelSummary` extension for Infrastructure metrics.
- Per-row validation beyond `required: true` markers (no cloud-provider value validation, no CIDR format checks, no IP-format checks).
- Save-pipeline plumbing changes — the existing pipeline picks up new tabs automatically via spec 3 contracts.
- XLSX import/export wiring beyond auto-discovery via `tabToEntityType` / `relationshipTabToType` iteration.
- `runtime_config` JSON-blob editor on `deployment_unit_compute_resources` — round-trips via save/load only.
- `InfrastructurePointPickerCell` component test — config test only in this spec.
