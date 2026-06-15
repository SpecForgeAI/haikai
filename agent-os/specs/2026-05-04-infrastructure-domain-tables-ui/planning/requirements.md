# Spec Requirements: Infrastructure Domain Tables UI

## Initial Description

Add table-based UI support for the new Infrastructure Architecture domain — the fourth spec in the seven-spec Infrastructure delivery. Spec 3 (`2026-05-04-infrastructure-domain-frontend-types`) landed the 16 TypeScript interfaces, the `InfrastructurePointKind` discriminator, the `ArchitectureDomain` extension, the `emptyModel` arrays, the `RELATIONSHIP_DEFINITIONS` entries, the `paletteData.ts` empty-placeholder entries, the `contextPickerDomainMappings.ts` infrastructure arrays, and the `modelSerialization.ts` backfill block. **`gridConfigs.ts` was deliberately NOT extended in spec 3 — that is THIS spec's job.**

This spec adds:
- 16 new `gridConfigs` entries (12 entity tables + 3 relationship tables + 1 hidden `infrastructure_points` registration).
- ~20 new option arrays in `defaults.ts` for the Infrastructure picklist fields, sourced verbatim from spec 1's documented enum values.
- A new `'infrastructure_point_picker'` cellType + `InfrastructurePointPickerCell.tsx` + `infrastructurePointDerivation.ts` mirroring the existing `application_point_picker` pattern.
- Tab-map entries (`tabToEntityType`, `relationshipTabToType`, `entityTabNames`, `relationshipTabNames`) and populated `domainGroupings.infrastructure` + `DOMAIN_ENTITY_TYPES.infrastructure`.
- One Vitest config test asserting the wiring is complete.

No backend, gateway, MCP, discovery, Terraform, palette, diagram, or save-pipeline changes. Save/load already round-trips through the spec 3 `MetaModel*` shapes.

The full raw idea is preserved at `agent-os/specs/2026-05-04-infrastructure-domain-tables-ui/planning/00-raw-idea.md`. Codebase conventions and the locked field contract are preserved at `planning/codebase-grounding.md`.

## Requirements Discussion

### First Round Questions

**Q1: `Deployment Unit` table — should `application_entity_id` (raw idea name) be replaced with `service_id` to match the locked spec 1 / spec 3 contract, and what cellType should it use?**
**Answer:** Yes. Use `{ field: 'service_id', cellType: 'fk_typeahead', fkTarget: 'services', required: false }`. The raw idea's `application_entity_id` is drift; spec 1 + spec 3 lock this as a direct typed FK to `services`. `fk_typeahead` is the existing pattern for typed single-target FK columns.

**Q2: Picklist enum fields — hard `'dropdown'` against `defaults.ts` option arrays matching spec 1 enum values verbatim, with `formatOptionLabel: snakeCaseToTitleCase`?**
**Answer:** Yes. Hard `'dropdown'` cellType, option arrays defined in `defaults.ts` with values matching spec 1 verbatim (uppercase snake_case constants), and `formatOptionLabel: snakeCaseToTitleCase` so users see "Compute Resource" while the underlying value remains `COMPUTE_RESOURCE`. Mirrors the existing `user_journey_links.relationship_type` pattern.

**Q3: `InfrastructurePoint` editing — new dedicated `'infrastructure_point_picker'` cellType modelled on `application_point_picker`?**
**Answer:** Yes. Add a new `'infrastructure_point_picker'` cellType to the `CellType` union plus a new `InfrastructurePointPickerCell.tsx` component and an `infrastructurePointDerivation.ts` helper. Modelled on `ApplicationPointPickerCell.tsx` because that one already supports the `allowedKinds?: string[]` filter we need to restrict per-relationship endpoint kinds. Auto-creates a derived `InfrastructurePoint` row when a raw entity is picked.

**Q4: `allowedKinds` per relationship — what are the valid `point_kind` values at each polymorphic FK end?**
**Answer:** Confirmed:
- `resource_subnet_hostings.infrastructure_point_id` → `['COMPUTE_RESOURCE', 'DATA_STORE_INSTANCE', 'LOAD_BALANCER', 'INFRASTRUCTURE_RESOURCE']` (the four kinds that can be subnet-hosted in V1).
- `deployment_unit_compute_resources.compute_infrastructure_point_id` → `['COMPUTE_RESOURCE', 'COMPUTE_CLUSTER']` (matches spec 1 R2 documented restriction).
- `load_balancer_resource_routes.target_infrastructure_point_id` → `['COMPUTE_RESOURCE', 'COMPUTE_CLUSTER', 'DATA_STORE_INSTANCE', 'INFRASTRUCTURE_RESOURCE']` (typical LB target kinds in V1).

**Q5: `infrastructure_points` registration — should it appear in `tabToEntityType` and `gridConfigs` even though there is no user-visible tab for it?**
**Answer:** Yes, register it in `tabToEntityType` and `gridConfigs` for internal wiring (the picker cell needs to write back to the `infrastructure_points` array via the same model-update plumbing other entities use), but **omit it from `domainGroupings.infrastructure`** so users never see it as a tab. This mirrors how `application_points` is wired today.

**Q6: Required `name` on every entity?**
**Answer:** Yes. `name` is `required: true` on all 12 entities + `infrastructure_points`. Matches spec 1's `name TEXT NOT NULL where applicable`. Note: relationship tables don't have a `name` column.

**Q7: `description` cellType — single-line `'text'` everywhere?**
**Answer:** Yes. `description` is a single-line `cellType: 'text'` on all 16 new tables, matching the existing convention (`business_processes`, `applications`, `services`, etc. all use `cellType: 'text'` for description — there is no multiline edit cell in the codebase).

**Q8: Boolean fields — `cellType: 'boolean'`?**
**Answer:** Yes. `is_current_state`, `is_target_state`, `is_shared`, `is_public`, `encrypted`, `ha_enabled`, `backup_enabled` all use `cellType: 'boolean'`. Matches existing `applications.is_internal` / `services.is_internal` pattern.

**Q9: Numeric fields — there is no `'number'` cellType in the codebase. What cellType?**
**Answer:** `cellType: 'text'`. Matches existing `port` and `sequence_order` precedent in `endpoints` and `data_movements`. Applies to `scaling_min`, `scaling_max`, `port`, `target_port`, `weight`, `desired_instances`, `min_instances`, `max_instances`, and `confidence`. No special numeric validation in this spec (raw idea: "Do not add heavy validation").

**Q10: `runtime_config` (Record<string, unknown> | null) on `deployment_unit_compute_resources` — how to expose it?**
**Answer:** Hidden from V1 grid. The structured value round-trips via save/load (per spec 3 normalisation) but is not edited via the table UI in V1. Adding a JSON-blob editor is out of scope. No `gridConfig` column for `runtime_config`.

**Q11: `tags` field — expose via `cellType: 'tags'` on every new table?**
**Answer:** Yes. `cellType: 'tags'` on all 16 new tables (12 entities + 3 relationships + `infrastructure_points`). Matches the existing convention — every other entity in the codebase exposes `tags` via `cellType: 'tags'`.

**Q12: `valid_from` / `valid_to` — include on every entity table?**
**Answer:** Yes — on all 12 entities + `infrastructure_points`, with `cellType: 'text'`, `required: false`, `width: 100`. Omit from the 3 relationship tables (relationships don't have `valid_from` / `valid_to` in the spec 1 / spec 3 shape). Matches existing `business_processes` / `applications` precedent (cellType 'text', no special date type).

**Q13: Entity tab order in `domainGroupings.infrastructure`?**
**Answer:** Logical containment-driven order: **Environments | Cloud Accounts | Locations | Networks | Subnets | Compute Clusters | Compute Resources | Deployment Units | Load Balancers | Listeners | Data Stores | Infrastructure Resources**. Relationship tab order is locked by spec 3's `RELATIONSHIP_TAB_ORDER` (3 entries already added — Resource <-> Subnet, Deployment Unit <-> Compute, Load Balancer Routes).

**Q14: New tests?**
**Answer:** One Vitest config test at `frontend/src/config/__tests__/infrastructureTablesConfig.test.ts` asserting:
- 16 `gridConfigs` entries exist for the new keys.
- 12 entity tabs are wired through `tabToEntityType` and present in `domainGroupings.infrastructure`.
- 3 relationship tabs are wired through `relationshipTabToType` and present in `RELATIONSHIP_TAB_ORDER`.
- `DOMAIN_ENTITY_TYPES.infrastructure` is populated with all 13 entity-type strings (12 visible + `infrastructure_points` hidden).

Modelled on `userJourneyLinksConfig.test.ts`. No table-component rendering tests, no save-pipeline tests, no picker-component tests in this spec.

**Q15: Anything else explicitly out of scope beyond the raw idea's existing list?**
**Answer:** Yes — also exclude:
- No diagram palette additions (placeholders stay `[]`).
- No Gateway changes.
- No MCP tool changes.
- No Discovery-service integration.
- No Terraform import/export/generation.
- No `MetaModelSummary` extension.
- No per-row validation beyond required-field markers (`required: true` on `name` is the only validation).
- No save-plumbing changes (round-trip already works through spec 3 contracts).
- No XLSX import/export wiring (handled in a later spec if at all).
- No `InfrastructurePointPickerCell` test (config test only).

### Inferred Decisions (all 16 accepted)

These were inferred from the codebase grounding and accepted by the user without override:

1. **Locked field contract is authoritative** — wherever the raw idea drifts (`application_entity_id`, `hosted_resource_point_id`, `target_point_id`, `compute_resource_id` on the runs-on relationship), the gridConfig field name follows the spec 1 + spec 3 contract.
2. **Snake_case field names everywhere** — all `field` keys in `gridConfigs` entries are snake_case, exactly matching the TypeScript interface field names from spec 3.
3. **`required: true` only on backend NOT NULL columns + `name`** — every other field is `required: false`. Picker fields on relationships are `required: true` because backend FK is NOT NULL. `environment_id` on the 3 relationships is `required: true` (backend NOT NULL per spec 1).
4. **FK columns to entity tables use `cellType: 'fk_typeahead'`** with the appropriate `fkTarget`. Matches existing single-target FK patterns (e.g. `data_movements.source_entity_id`).
5. **Polymorphic FK columns use the new `'infrastructure_point_picker'` cellType** with `allowedKinds` configured per Q4.
6. **`width` hints** — follow existing conventions: name 200, description 250, FK columns 200, dropdown columns 160-200, boolean 80, text-numeric 100, valid_from/valid_to 100, tags 200. These are guidance only; the spec-writer can refine.
7. **`formatOptionLabel: snakeCaseToTitleCase`** on every `dropdown` cell so uppercase enum values display as "Compute Resource" / "Path Based" etc.
8. **Tab display names** use Title Case with " / " separators matching the raw idea phrasing where helpful: "Cloud Accounts", "Locations", "Compute Clusters", "Compute Resources", "Deployment Units", "Load Balancers", "Data Stores" (shortened from "Data Store Instances" for table tabs), "Infrastructure Resources". Internal entity-type keys stay snake_case plural.
9. **`tabToEntityType` keys** use the same display names as `entityTabNames`. `relationshipTabToType` keys use the displayName values from spec 3's `RELATIONSHIP_DEFINITIONS` ("Resource <-> Subnet", "Deployment Unit <-> Compute", "Load Balancer Routes").
10. **`DOMAIN_ENTITY_TYPES.infrastructure`** includes all 13 entity-type strings (12 visible + `infrastructure_points` hidden) so context-picker logic and any internal iteration sees the full shape.
11. **`domainGroupings.infrastructure`** includes only the 12 visible tab names (no `infrastructure_points`).
12. **`provider` field is freetext on most tables** — although spec 1 lists `GCP, AWS, AZURE, ON_PREM, OTHER` for `cloud_accounts.provider`, the same `provider` field on `locations`, `networks`, `compute_clusters`, `compute_resources`, etc. is documented as nullable freetext (no enum). Therefore `provider` uses `cellType: 'dropdown'` with `providerOptions` only on `cloud_accounts`; everywhere else `provider` is `cellType: 'text'`. This avoids over-constraining freetext-by-design backend columns.
13. **`lifecycle_state`** on `environments` uses `lifecycleStateOptions = ['PLANNED', 'ACTIVE', 'DEPRECATED', 'RETIRED']`. The same field on `compute_resources.lifecycle_state` reuses the same option array.
14. **`exposure`** on `load_balancers` and `listeners` reuses the same `exposureOptions` array.
15. **`criticality`** on `environments` and `infrastructure_resources` reuses the same `criticalityOptions` array.
16. **No XOR groups, no `dynamicFkTargetField`/`dynamicFkTargetMap`** — the polymorphic editing is handled inside `InfrastructurePointPickerCell`, not via the existing dynamic-FK column primitives.

### Existing Code to Reference

The codebase grounding identified the following reference points:

- **`gridConfigs.ts`** at `frontend/src/config/gridConfigs.ts` (752 lines) — exports `gridConfigs`, `tabToEntityType`, `relationshipTabToType`, `entityTabNames`, `relationshipTabNames`, `domainGroupings`, `DOMAIN_ENTITY_TYPES`. Spec 3 already added empty `infrastructure: []` placeholders in `domainGroupings` (line 710) and `DOMAIN_ENTITY_TYPES` (line 732); this spec replaces both with real values.
- **`config.ts` `CellType` union** at `frontend/src/types/config.ts:59-70` — extend with `'infrastructure_point_picker'`.
- **`GridCell.tsx`** at `frontend/src/components/Grid/GridCell.tsx` — add a `case 'infrastructure_point_picker'` arm rendering the new cell component.
- **`ApplicationPointPickerCell.tsx`** at `frontend/src/components/Grid/ApplicationPointPickerCell.tsx` (622 lines) — primary template for `InfrastructurePointPickerCell.tsx`. Already supports `allowedKinds?: string[]`.
- **`applicationPointDerivation.ts`** — template for `infrastructurePointDerivation.ts` (auto-creates a derived point row with the correct `point_kind` and the corresponding typed FK populated).
- **`formatters.ts`** — append an `infrastructurePointDisplayFormatter` mirroring the existing `applicationPointDisplayFormatter` (optional).
- **`defaults.ts`** at `frontend/src/config/defaults.ts:959+` — pattern for option arrays (`appTypeOptions`, `statusOptions`, `serviceTypeOptions`, etc.).
- **`user_journey_links.relationship_type`** at `gridConfigs.ts:589` — example of `dropdown` + `formatOptionLabel: snakeCaseToTitleCase`.
- **`userJourneyLinksConfig.test.ts`** — Vitest pattern to follow for the new infrastructure tables config test.
- **`endpoints` / `data_movements` configs** — pattern for `port` / `sequence_order` numeric-as-text columns.
- **`applications.is_internal` / `services.is_internal`** — boolean cellType precedent.

### Follow-up Questions

No follow-up questions were required. The user provided concrete answers on all 15 open questions and accepted all 16 inferred decisions.

## Visual Assets

### Files Provided

Bash check on `agent-os/specs/2026-05-04-infrastructure-domain-tables-ui/planning/visuals/` returned no image/PDF files.

No visual assets provided.

### Visual Insights

N/A — table-config and component-shell spec, no UI artefacts. Reference UX is the existing per-domain `MetaModelView` rendering against `gridConfigs[<key>]`.

## Requirements Summary

### Functional Requirements

The frontend must:

1. **Add 16 new `gridConfigs` entries** in `frontend/src/config/gridConfigs.ts`:
   - 12 entity entries (`environments`, `cloud_accounts`, `locations`, `networks`, `subnets`, `compute_clusters`, `compute_resources`, `deployment_units`, `load_balancers`, `listeners`, `data_store_instances`, `infrastructure_resources`).
   - 3 relationship entries (`resource_subnet_hostings`, `deployment_unit_compute_resources`, `load_balancer_resource_routes`).
   - 1 hidden internal entry (`infrastructure_points`) for the polymorphic supertype.
2. **Wire 12 entity tabs through `tabToEntityType` and `entityTabNames`**, plus add `infrastructure_points` to `tabToEntityType` only (no entry in `entityTabNames`).
3. **Wire 3 relationship tabs through `relationshipTabToType` and `relationshipTabNames`** (display names already present in spec 3's `RELATIONSHIP_TAB_ORDER`).
4. **Populate `domainGroupings.infrastructure`** with the 12 visible entity tab names in the agreed order (Q13).
5. **Populate `DOMAIN_ENTITY_TYPES.infrastructure`** with all 13 entity-type strings (12 visible + `infrastructure_points`).
6. **Add a new `'infrastructure_point_picker'` cellType** to the `CellType` union in `frontend/src/types/config.ts`.
7. **Add a `case 'infrastructure_point_picker'` arm** to `frontend/src/components/Grid/GridCell.tsx` rendering the new cell component.
8. **Implement `frontend/src/components/Grid/InfrastructurePointPickerCell.tsx`** modelled on `ApplicationPointPickerCell.tsx` — grouped dropdown across the 12 infrastructure entity types, `allowedKinds?: string[]` filter, auto-create a derived `InfrastructurePoint` row on selection.
9. **Implement `frontend/src/utils/infrastructurePointDerivation.ts`** modelled on `applicationPointDerivation.ts` — small helper creating an `InfrastructurePoint` row with the correct `point_kind` and the corresponding typed FK populated.
10. **Add ~23 option arrays** to `frontend/src/config/defaults.ts` covering all infrastructure picklist enums (see **Picklist Option Arrays** below).
11. **Add one Vitest config test** at `frontend/src/config/__tests__/infrastructureTablesConfig.test.ts` asserting (a) 16 `gridConfigs` entries, (b) 12 entity tabs wired and listed in `domainGroupings.infrastructure`, (c) 3 relationship tabs wired, (d) `DOMAIN_ENTITY_TYPES.infrastructure` populated.
12. **Preserve existing behaviour** for all non-Infrastructure domains; no edits to the seven `gridConfigs` entries already populated (`business_*`, `applications`, `services`, `endpoints`, `data_*`, `user_journey*`, etc.). No edits to `MetaModelView.tsx`.

### Per-Table Column Specifications

All entity tables include the standard envelope: `name` (required, text), `description` (text), `tags` (tags), `valid_from` (text, width 100), `valid_to` (text, width 100). Listed once here and not repeated per entity. All FK columns use `cellType: 'fk_typeahead'` unless otherwise noted. All dropdowns use `formatOptionLabel: snakeCaseToTitleCase`.

#### Entity 1: `environments`

| field | cellType | required | options / fkTarget / config | width |
|---|---|---|---|---|
| name | text | true | — | 200 |
| environment_type | dropdown | false | `environmentTypeOptions` | 160 |
| lifecycle_state | dropdown | false | `lifecycleStateOptions` | 160 |
| is_current_state | boolean | false | — | 80 |
| is_target_state | boolean | false | — | 80 |
| owner | text | false | — | 160 |
| criticality | dropdown | false | `criticalityOptions` | 120 |
| description | text | false | — | 250 |
| tags | tags | false | — | 200 |
| valid_from | text | false | — | 100 |
| valid_to | text | false | — | 100 |

#### Entity 2: `cloud_accounts`

| field | cellType | required | options / fkTarget | width |
|---|---|---|---|---|
| name | text | true | — | 200 |
| environment_id | fk_typeahead | false | `fkTarget: 'environments'` | 200 |
| provider | dropdown | false | `providerOptions` | 140 |
| external_account_id | text | false | — | 180 |
| parent_org_id | text | false | — | 180 |
| billing_owner | text | false | — | 160 |
| technical_owner | text | false | — | 160 |
| landing_zone_name | text | false | — | 160 |
| description | text | false | — | 250 |
| tags | tags | false | — | 200 |
| valid_from | text | false | — | 100 |
| valid_to | text | false | — | 100 |

#### Entity 3: `locations`

| field | cellType | required | options / fkTarget | width |
|---|---|---|---|---|
| name | text | true | — | 200 |
| environment_id | fk_typeahead | false | `fkTarget: 'environments'` | 200 |
| cloud_account_id | fk_typeahead | false | `fkTarget: 'cloud_accounts'` | 200 |
| location_type | dropdown | false | `locationTypeOptions` | 160 |
| provider | text | false | — | 140 |
| provider_region_code | text | false | — | 140 |
| provider_zone_code | text | false | — | 140 |
| country | text | false | — | 120 |
| city | text | false | — | 140 |
| address | text | false | — | 200 |
| description | text | false | — | 250 |
| tags | tags | false | — | 200 |
| valid_from | text | false | — | 100 |
| valid_to | text | false | — | 100 |

#### Entity 4: `networks`

| field | cellType | required | options / fkTarget | width |
|---|---|---|---|---|
| name | text | true | — | 200 |
| environment_id | fk_typeahead | false | `fkTarget: 'environments'` | 200 |
| cloud_account_id | fk_typeahead | false | `fkTarget: 'cloud_accounts'` | 200 |
| location_id | fk_typeahead | false | `fkTarget: 'locations'` | 200 |
| network_type | dropdown | false | `networkTypeOptions` | 140 |
| provider | text | false | — | 140 |
| cidr | text | false | — | 140 |
| external_id | text | false | — | 160 |
| is_shared | boolean | false | — | 80 |
| routing_mode | dropdown | false | `routingModeOptions` | 140 |
| description | text | false | — | 250 |
| tags | tags | false | — | 200 |
| valid_from | text | false | — | 100 |
| valid_to | text | false | — | 100 |

#### Entity 5: `subnets`

| field | cellType | required | options / fkTarget | width |
|---|---|---|---|---|
| name | text | true | — | 200 |
| environment_id | fk_typeahead | false | `fkTarget: 'environments'` | 200 |
| network_id | fk_typeahead | false | `fkTarget: 'networks'` | 200 |
| location_id | fk_typeahead | false | `fkTarget: 'locations'` | 200 |
| cidr | text | false | — | 140 |
| subnet_type | dropdown | false | `subnetTypeOptions` | 140 |
| visibility | dropdown | false | `subnetVisibilityOptions` | 140 |
| provider_region_code | text | false | — | 140 |
| provider_zone_code | text | false | — | 140 |
| external_id | text | false | — | 160 |
| gateway_address | text | false | — | 160 |
| description | text | false | — | 250 |
| tags | tags | false | — | 200 |
| valid_from | text | false | — | 100 |
| valid_to | text | false | — | 100 |

#### Entity 6: `compute_clusters`

| field | cellType | required | options / fkTarget | width |
|---|---|---|---|---|
| name | text | true | — | 200 |
| environment_id | fk_typeahead | false | `fkTarget: 'environments'` | 200 |
| cloud_account_id | fk_typeahead | false | `fkTarget: 'cloud_accounts'` | 200 |
| location_id | fk_typeahead | false | `fkTarget: 'locations'` | 200 |
| network_id | fk_typeahead | false | `fkTarget: 'networks'` | 200 |
| platform_type | dropdown | false | `platformTypeOptions` | 160 |
| provider | text | false | — | 140 |
| version | text | false | — | 120 |
| external_id | text | false | — | 160 |
| owner | text | false | — | 160 |
| operating_model | dropdown | false | `operatingModelOptions` | 160 |
| description | text | false | — | 250 |
| tags | tags | false | — | 200 |
| valid_from | text | false | — | 100 |
| valid_to | text | false | — | 100 |

#### Entity 7: `compute_resources`

| field | cellType | required | options / fkTarget | width |
|---|---|---|---|---|
| name | text | true | — | 200 |
| environment_id | fk_typeahead | false | `fkTarget: 'environments'` | 200 |
| cloud_account_id | fk_typeahead | false | `fkTarget: 'cloud_accounts'` | 200 |
| location_id | fk_typeahead | false | `fkTarget: 'locations'` | 200 |
| cluster_id | fk_typeahead | false | `fkTarget: 'compute_clusters'` | 200 |
| compute_type | dropdown | false | `computeTypeOptions` | 180 |
| provider | text | false | — | 140 |
| hostname | text | false | — | 160 |
| fqdn | text | false | — | 200 |
| private_ip | text | false | — | 140 |
| public_ip | text | false | — | 140 |
| os | text | false | — | 120 |
| runtime | text | false | — | 140 |
| instance_size | text | false | — | 140 |
| scaling_min | text | false | — | 100 |
| scaling_max | text | false | — | 100 |
| external_id | text | false | — | 160 |
| lifecycle_state | dropdown | false | `lifecycleStateOptions` | 160 |
| owner | text | false | — | 160 |
| description | text | false | — | 250 |
| tags | tags | false | — | 200 |
| valid_from | text | false | — | 100 |
| valid_to | text | false | — | 100 |

#### Entity 8: `deployment_units`

| field | cellType | required | options / fkTarget | width |
|---|---|---|---|---|
| name | text | true | — | 200 |
| **service_id** | **fk_typeahead** | false | **`fkTarget: 'services'`** (Q1) | 200 |
| deployment_unit_type | dropdown | false | `deploymentUnitTypeOptions` | 180 |
| version | text | false | — | 120 |
| artifact_uri | text | false | — | 220 |
| image_name | text | false | — | 200 |
| image_tag | text | false | — | 140 |
| source_repository | text | false | — | 220 |
| source_commit | text | false | — | 160 |
| build_pipeline | text | false | — | 200 |
| owner | text | false | — | 160 |
| description | text | false | — | 250 |
| tags | tags | false | — | 200 |
| valid_from | text | false | — | 100 |
| valid_to | text | false | — | 100 |

#### Entity 9: `load_balancers`

| field | cellType | required | options / fkTarget | width |
|---|---|---|---|---|
| name | text | true | — | 200 |
| environment_id | fk_typeahead | false | `fkTarget: 'environments'` | 200 |
| cloud_account_id | fk_typeahead | false | `fkTarget: 'cloud_accounts'` | 200 |
| location_id | fk_typeahead | false | `fkTarget: 'locations'` | 200 |
| network_id | fk_typeahead | false | `fkTarget: 'networks'` | 200 |
| load_balancer_type | dropdown | false | `loadBalancerTypeOptions` | 200 |
| provider | text | false | — | 140 |
| exposure | dropdown | false | `exposureOptions` | 140 |
| scheme | text | false | — | 120 |
| dns_name | text | false | — | 200 |
| ip_address | text | false | — | 140 |
| external_id | text | false | — | 160 |
| owner | text | false | — | 160 |
| description | text | false | — | 250 |
| tags | tags | false | — | 200 |
| valid_from | text | false | — | 100 |
| valid_to | text | false | — | 100 |

#### Entity 10: `listeners`

| field | cellType | required | options / fkTarget | width |
|---|---|---|---|---|
| name | text | true | — | 200 |
| environment_id | fk_typeahead | false | `fkTarget: 'environments'` | 200 |
| load_balancer_id | fk_typeahead | false | `fkTarget: 'load_balancers'` | 200 |
| compute_resource_id | fk_typeahead | false | `fkTarget: 'compute_resources'` (direct FK per spec 1 A1) | 200 |
| protocol | dropdown | false | `protocolOptions` | 120 |
| port | text | false | — | 100 |
| host_name | text | false | — | 200 |
| path_pattern | text | false | — | 200 |
| exposure | dropdown | false | `exposureOptions` | 140 |
| is_public | boolean | false | — | 80 |
| certificate_reference | text | false | — | 200 |
| external_id | text | false | — | 160 |
| description | text | false | — | 250 |
| tags | tags | false | — | 200 |
| valid_from | text | false | — | 100 |
| valid_to | text | false | — | 100 |

#### Entity 11: `data_store_instances`

| field | cellType | required | options / fkTarget | width |
|---|---|---|---|---|
| name | text | true | — | 200 |
| environment_id | fk_typeahead | false | `fkTarget: 'environments'` | 200 |
| cloud_account_id | fk_typeahead | false | `fkTarget: 'cloud_accounts'` | 200 |
| location_id | fk_typeahead | false | `fkTarget: 'locations'` | 200 |
| data_store_type | dropdown | false | `dataStoreTypeOptions` | 180 |
| engine | dropdown | false | `engineOptions` | 140 |
| engine_version | text | false | — | 140 |
| provider | text | false | — | 140 |
| host | text | false | — | 200 |
| port | text | false | — | 100 |
| external_id | text | false | — | 160 |
| encrypted | boolean | false | — | 80 |
| ha_enabled | boolean | false | — | 80 |
| backup_enabled | boolean | false | — | 80 |
| owner | text | false | — | 160 |
| description | text | false | — | 250 |
| tags | tags | false | — | 200 |
| valid_from | text | false | — | 100 |
| valid_to | text | false | — | 100 |

#### Entity 12: `infrastructure_resources`

| field | cellType | required | options / fkTarget | width |
|---|---|---|---|---|
| name | text | true | — | 200 |
| environment_id | fk_typeahead | false | `fkTarget: 'environments'` | 200 |
| cloud_account_id | fk_typeahead | false | `fkTarget: 'cloud_accounts'` | 200 |
| location_id | fk_typeahead | false | `fkTarget: 'locations'` | 200 |
| resource_type | dropdown | false | `resourceTypeOptions` | 180 |
| provider | text | false | — | 140 |
| provider_resource_type | text | false | — | 180 |
| endpoint | text | false | — | 220 |
| external_id | text | false | — | 160 |
| criticality | dropdown | false | `criticalityOptions` | 120 |
| owner | text | false | — | 160 |
| description | text | false | — | 250 |
| tags | tags | false | — | 200 |
| valid_from | text | false | — | 100 |
| valid_to | text | false | — | 100 |

#### Entity 13 (hidden): `infrastructure_points`

Registered in `tabToEntityType` and `gridConfigs` for internal wiring; **not** listed in `entityTabNames` or `domainGroupings.infrastructure`. Per Q5.

| field | cellType | required | options / fkTarget | width |
|---|---|---|---|---|
| name | text | true | — | 200 |
| point_kind | dropdown | true | `infrastructurePointKindOptions` | 180 |
| description | text | false | — | 250 |
| tags | tags | false | — | 200 |
| valid_from | text | false | — | 100 |
| valid_to | text | false | — | 100 |

The 12 typed FK columns on `infrastructure_points` are not exposed as grid columns — they are populated by `infrastructurePointDerivation.ts` based on the chosen `point_kind` when the point picker auto-creates a row.

#### Relationship 1: `resource_subnet_hostings`

| field | cellType | required | options / config | width |
|---|---|---|---|---|
| infrastructure_point_id | infrastructure_point_picker | true | `allowedKinds: ['COMPUTE_RESOURCE', 'DATA_STORE_INSTANCE', 'LOAD_BALANCER', 'INFRASTRUCTURE_RESOURCE']` (Q4) | 280 |
| subnet_id | fk_typeahead | true | `fkTarget: 'subnets'` | 200 |
| environment_id | fk_typeahead | true | `fkTarget: 'environments'` | 200 |
| relationship_role | dropdown | false | `relationshipRoleOptions` | 180 |
| primary_ip | text | false | — | 140 |
| private_ip | text | false | — | 140 |
| public_ip | text | false | — | 140 |
| evidence_source | text | false | — | 180 |
| confidence | text | false | — | 100 |
| description | text | false | — | 250 |
| tags | tags | false | — | 200 |

#### Relationship 2: `deployment_unit_compute_resources`

| field | cellType | required | options / config | width |
|---|---|---|---|---|
| deployment_unit_id | fk_typeahead | true | `fkTarget: 'deployment_units'` | 220 |
| compute_infrastructure_point_id | infrastructure_point_picker | true | `allowedKinds: ['COMPUTE_RESOURCE', 'COMPUTE_CLUSTER']` (Q4) | 280 |
| environment_id | fk_typeahead | true | `fkTarget: 'environments'` | 200 |
| version | text | false | — | 120 |
| desired_instances | text | false | — | 100 |
| min_instances | text | false | — | 100 |
| max_instances | text | false | — | 100 |
| deployment_status | dropdown | false | `deploymentStatusOptions` | 160 |
| evidence_source | text | false | — | 180 |
| confidence | text | false | — | 100 |
| description | text | false | — | 250 |
| tags | tags | false | — | 200 |

`runtime_config` is **not** exposed as a grid column (Q10). It round-trips via save/load through spec 3 normalisation.

#### Relationship 3: `load_balancer_resource_routes`

| field | cellType | required | options / config | width |
|---|---|---|---|---|
| load_balancer_id | fk_typeahead | true | `fkTarget: 'load_balancers'` | 200 |
| listener_id | fk_typeahead | false | `fkTarget: 'listeners'` | 200 |
| target_infrastructure_point_id | infrastructure_point_picker | true | `allowedKinds: ['COMPUTE_RESOURCE', 'COMPUTE_CLUSTER', 'DATA_STORE_INSTANCE', 'INFRASTRUCTURE_RESOURCE']` (Q4) | 280 |
| environment_id | fk_typeahead | true | `fkTarget: 'environments'` | 200 |
| protocol | dropdown | false | `protocolOptions` | 120 |
| target_port | text | false | — | 100 |
| host_name | text | false | — | 200 |
| path_pattern | text | false | — | 200 |
| routing_type | dropdown | false | `routingTypeOptions` | 160 |
| weight | text | false | — | 100 |
| health_check_path | text | false | — | 200 |
| description | text | false | — | 250 |
| tags | tags | false | — | 200 |

### Picklist Option Arrays (to add in `defaults.ts`)

All values mirror spec 1's documented enum lists verbatim. 23 arrays total. Each is a `string[]` of uppercase snake_case constants. UI labels are derived at render time via `formatOptionLabel: snakeCaseToTitleCase`.

```ts
// Environment
export const environmentTypeOptions = ['DEV', 'TEST', 'STAGING', 'PROD', 'DR', 'CURRENT_STATE', 'TARGET_STATE', 'OTHER'];

// Lifecycle (used by environments + compute_resources)
export const lifecycleStateOptions = ['PLANNED', 'ACTIVE', 'DEPRECATED', 'RETIRED'];

// Criticality (used by environments + infrastructure_resources)
export const criticalityOptions = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

// Cloud account provider
export const providerOptions = ['GCP', 'AWS', 'AZURE', 'ON_PREM', 'OTHER'];

// Location
export const locationTypeOptions = ['CLOUD_REGION', 'CLOUD_ZONE', 'DATA_CENTRE', 'OFFICE', 'EDGE_SITE', 'OTHER'];

// Network
export const networkTypeOptions = ['VPC', 'VNET', 'ON_PREM_NETWORK', 'LAN', 'WAN', 'OTHER'];
export const routingModeOptions = ['REGIONAL', 'GLOBAL', 'STATIC', 'DYNAMIC', 'OTHER'];

// Subnet
export const subnetTypeOptions = ['PUBLIC', 'PRIVATE', 'APP', 'DATA', 'MANAGEMENT', 'DMZ', 'OTHER'];
export const subnetVisibilityOptions = ['PUBLIC', 'PRIVATE', 'ISOLATED', 'INTERNAL', 'OTHER'];

// Compute Cluster
export const platformTypeOptions = ['GKE', 'KUBERNETES', 'CLOUD_RUN', 'VMWARE', 'OPENSHIFT', 'SERVER_FARM', 'OTHER'];
export const operatingModelOptions = ['MANAGED', 'SELF_MANAGED', 'HYBRID', 'OTHER'];

// Compute Resource
export const computeTypeOptions = ['VM', 'PHYSICAL_SERVER', 'CONTAINER_SERVICE', 'KUBERNETES_WORKLOAD', 'SERVERLESS_FUNCTION', 'CLOUD_RUN_SERVICE', 'BATCH_JOB', 'OTHER'];

// Deployment Unit
export const deploymentUnitTypeOptions = ['CONTAINER_IMAGE', 'VM_IMAGE', 'FUNCTION_BUNDLE', 'JAR', 'WAR', 'STATIC_BUNDLE', 'PACKAGE', 'OTHER'];

// Load Balancer
export const loadBalancerTypeOptions = ['EXTERNAL_HTTP', 'EXTERNAL_HTTPS', 'INTERNAL_HTTP', 'INTERNAL_TCP', 'INGRESS_CONTROLLER', 'F5', 'NGINX', 'API_GATEWAY', 'OTHER'];

// Exposure (used by load_balancers + listeners)
export const exposureOptions = ['PUBLIC', 'PRIVATE', 'INTERNAL', 'OTHER'];

// Listener
export const protocolOptions = ['HTTP', 'HTTPS', 'TCP', 'UDP', 'TLS', 'GRPC', 'OTHER'];

// Data Store Instance
export const dataStoreTypeOptions = ['RELATIONAL_DB', 'DOCUMENT_DB', 'KEY_VALUE', 'CACHE', 'DATA_WAREHOUSE', 'OBJECT_STORAGE_AS_DATASTORE', 'OTHER'];
export const engineOptions = ['POSTGRES', 'MYSQL', 'ORACLE', 'SQLSERVER', 'BIGQUERY', 'REDIS', 'MONGODB', 'OTHER'];

// Infrastructure Resource
export const resourceTypeOptions = ['OBJECT_BUCKET', 'MESSAGE_TOPIC', 'MESSAGE_QUEUE', 'CACHE', 'SECRET_STORE', 'SCHEDULER', 'EVENT_BUS', 'CDN', 'REGISTRY', 'OTHER'];

// InfrastructurePoint discriminator
export const infrastructurePointKindOptions = ['ENVIRONMENT', 'CLOUD_ACCOUNT', 'LOCATION', 'NETWORK', 'SUBNET', 'COMPUTE_CLUSTER', 'COMPUTE_RESOURCE', 'DEPLOYMENT_UNIT', 'LOAD_BALANCER', 'LISTENER', 'DATA_STORE_INSTANCE', 'INFRASTRUCTURE_RESOURCE'];

// Resource <-> Subnet relationship
export const relationshipRoleOptions = ['PRIMARY_PLACEMENT', 'PRIVATE_CONNECTIVITY', 'BACKEND_PLACEMENT', 'OTHER'];

// Deployment Unit <-> Compute relationship
export const deploymentStatusOptions = ['PLANNED', 'DEPLOYED', 'DEPRECATED', 'FAILED', 'UNKNOWN'];

// Load Balancer Routes relationship
export const routingTypeOptions = ['DEFAULT', 'HOST_BASED', 'PATH_BASED', 'WEIGHTED', 'FAILOVER', 'OTHER'];
```

### Spec 1 Enum Verification Pass

Cross-checked all 23 option arrays above against spec 1's documented values (`agent-os/specs/2026-05-04-infrastructure-domain-backend-foundation/planning/requirements.md`):

| Field | Spec 1 source | Status |
|---|---|---|
| `environmentTypeOptions` | line 125 | Match |
| `lifecycleStateOptions` (environments) | line 126 | Match |
| `criticalityOptions` (environments + infrastructure_resources) | line 130, 271 | Match (single shared array) |
| `providerOptions` (cloud_accounts) | line 134 | Match |
| `locationTypeOptions` | line 144 | Match |
| `networkTypeOptions` | line 156 | Match |
| `routingModeOptions` | line 161 | Match |
| `subnetTypeOptions` | line 168 | Match |
| `subnetVisibilityOptions` | line 169 | Match |
| `platformTypeOptions` | line 180 | Match |
| `operatingModelOptions` | line 185 | Match |
| `computeTypeOptions` | line 192 | Match |
| `deploymentUnitTypeOptions` | line 209 | Match |
| `loadBalancerTypeOptions` | line 224 | Match |
| `exposureOptions` (load_balancers + listeners) | lines 226, 241 | Match (identical sets in spec 1; single shared array) |
| `protocolOptions` (listeners + LB routes) | line 237 | Match. **Judgement call**: spec 1 lists this only on `listeners.protocol`; `load_balancer_resource_routes.protocol` is documented as TEXT NULL with no enum (line 339). Nevertheless we reuse `protocolOptions` for that column too since the practical value space is identical. If the user wants pure freetext on the LB-route side, drop the dropdown to `cellType: 'text'` for that one column. **Captured as the only deviation from "freetext-by-design backend columns stay text"**.
| `dataStoreTypeOptions` | line 250 | Match |
| `engineOptions` | line 251 | Match |
| `resourceTypeOptions` | line 266 | Match |
| `infrastructurePointKindOptions` | line 277 | Match |
| `relationshipRoleOptions` | line 298 | Match |
| `deploymentStatusOptions` | line 322 | Match |
| `routingTypeOptions` | line 343 | Match |
| `lifecycleStateOptions` reuse on `compute_resources.lifecycle_state` | line 204 (TEXT NULL, no documented enum in spec 1) | **Judgement call**: spec 1 does not list explicit enum values for `compute_resources.lifecycle_state`, but `environments.lifecycle_state` enumerates `PLANNED, ACTIVE, DEPRECATED, RETIRED`. Reusing the same array is the natural choice; users always have "OTHER" as the practical escape hatch via free-typing if needed. **Captured as the second judgement call.** |

**No discrepancies** between the option arrays and spec 1's documented enum values. Two judgement calls flagged above (the LB-route `protocol` reuse and the `compute_resources.lifecycle_state` reuse) — both default to reusing existing arrays for consistency; spec-writer can flip either to plain `cellType: 'text'` if the implementer prefers.

### File Touch Summary

| # | File | Change |
|---|---|---|
| 1 | `frontend/src/config/gridConfigs.ts` | Add 16 new `gridConfigs` entries (12 entities + 3 relationships + `infrastructure_points`). Add 12 entries to `tabToEntityType` (+ 1 hidden for `infrastructure_points`), 3 entries to `relationshipTabToType`, 12 names to `entityTabNames`, 3 names to `relationshipTabNames`. Replace `domainGroupings.infrastructure: []` placeholder (line 710) with the 12 visible tab names in Q13 order. Replace `DOMAIN_ENTITY_TYPES.infrastructure: []` placeholder (line 732) with the 13 entity-type strings. |
| 2 | `frontend/src/config/defaults.ts` | Add 23 new picklist option arrays (see **Picklist Option Arrays**). |
| 3 | `frontend/src/types/config.ts` | Extend `CellType` union with `'infrastructure_point_picker'`. |
| 4 | `frontend/src/components/Grid/GridCell.tsx` | Add `case 'infrastructure_point_picker'` arm rendering the new cell component. |
| 5 | **NEW** `frontend/src/components/Grid/InfrastructurePointPickerCell.tsx` | New component modelled on `ApplicationPointPickerCell.tsx` (~600 lines). Grouped dropdown across 12 entity types, `allowedKinds?: string[]` filter, auto-create derived `InfrastructurePoint` row on selection. |
| 6 | **NEW** `frontend/src/utils/infrastructurePointDerivation.ts` | New helper modelled on `applicationPointDerivation.ts`. Creates an `InfrastructurePoint` row with the correct `point_kind` and the corresponding typed FK populated. |
| 7 | **NEW (optional)** `frontend/src/utils/formatters.ts` | Append `infrastructurePointDisplayFormatter` mirroring existing `applicationPointDisplayFormatter`. |
| 8 | **NEW** `frontend/src/config/__tests__/infrastructureTablesConfig.test.ts` | Vitest config test asserting 16 `gridConfigs` entries + 12 entity tabs + 3 relationship tabs + populated `DOMAIN_ENTITY_TYPES.infrastructure`. Modelled on `userJourneyLinksConfig.test.ts`. |

**Files NOT to touch** (already done by spec 3 or out of scope):
- `frontend/src/types/model.ts` — done by spec 3.
- `frontend/src/types/architectureDomain.ts` — done by spec 3.
- `frontend/src/config/relationshipDefinitions.ts` — done by spec 3.
- `frontend/src/utils/contextPickerDomainMappings.ts` — done by spec 3.
- `frontend/src/utils/paletteData.ts` — placeholders stay empty (no diagram palette in this spec).
- `frontend/src/api/modelSerialization.ts` — done by spec 3.
- `frontend/src/components/MetaModelView/MetaModelView.tsx` — already domain-agnostic.
- `frontend/src/hooks/useCurrentView.ts` — done by spec 3.
- `frontend/src/config/defaults.ts` `emptyModel` — done by spec 3.

### Reusability Opportunities

- **Existing `gridConfigs` entries** for `business_*`, `applications`, `services`, `endpoints`, `data_*`, `user_journey*` — copy column-shape patterns wholesale (envelope columns, FK columns, dropdown columns, boolean columns).
- **`ApplicationPointPickerCell.tsx`** — primary template for `InfrastructurePointPickerCell.tsx`. Already implements `allowedKinds?: string[]` filtering and auto-derive on selection.
- **`applicationPointDerivation.ts`** — template for `infrastructurePointDerivation.ts`.
- **`user_journey_links.relationship_type` config** (line 589) — exact pattern for `dropdown` + `formatOptionLabel: snakeCaseToTitleCase`.
- **`endpoints.port` / `data_movements.sequence_order`** — pattern for numeric-as-text columns.
- **`applications.is_internal` / `services.is_internal`** — boolean cellType precedent.
- **`appTypeOptions`, `statusOptions`, `serviceTypeOptions`** in `defaults.ts:959+` — shape pattern for the 23 new option arrays.
- **`userJourneyLinksConfig.test.ts`** — Vitest pattern for the new infrastructure tables config test.

### Scope Boundaries

**In Scope:**
- 16 new `gridConfigs` entries (12 entities + 3 relationships + `infrastructure_points`).
- Tab map extensions in `gridConfigs.ts` (`tabToEntityType`, `relationshipTabToType`, `entityTabNames`, `relationshipTabNames`, `domainGroupings.infrastructure`, `DOMAIN_ENTITY_TYPES.infrastructure`).
- 23 new picklist option arrays in `defaults.ts`.
- New `'infrastructure_point_picker'` cellType + `InfrastructurePointPickerCell.tsx` + `infrastructurePointDerivation.ts`.
- One Vitest config test.
- Optional `infrastructurePointDisplayFormatter` in `formatters.ts`.

**Out of Scope** (raw idea exclusions plus the additional Q15 items):
- Infrastructure diagram rendering (raw idea).
- Infrastructure diagram palette / shapes (raw idea).
- Terraform import / export / generation (raw idea).
- Discovery-service integration (raw idea).
- Gateway changes (raw idea).
- MCP tools (raw idea).
- Security group / firewall / IAM modelling (raw idea).
- Traffic flow relationship (raw idea).
- Data entity hosted on data store relationship (raw idea).
- Infrastructure resource dependency relationship (raw idea).
- Advanced validation against real cloud provider constraints (raw idea).
- Automatic diagram generation from table rows (raw idea).
- **No diagram palette additions** — `paletteData.ts` placeholders stay `[]` (Q15).
- **No Gateway changes** (Q15).
- **No MCP tool changes** (Q15).
- **No Discovery-service integration** (Q15).
- **No Terraform import/export/generation** (Q15).
- **No `MetaModelSummary` extension** (Q15).
- **No per-row validation** beyond required-field markers (Q15).
- **No save-pipeline plumbing changes** — round-trip already works through spec 3 contracts (Q15).
- **No XLSX import/export wiring** (Q15).
- **No `InfrastructurePointPickerCell` component test** — config test only (Q15).
- **No `runtime_config` grid editor** — round-trips via save/load only (Q10).

### Technical Considerations

- **Locked field contract** — every grid `field` key matches the spec 3 TypeScript interface field name exactly. The raw idea's drift names (`application_entity_id`, `hosted_resource_point_id`, `target_point_id`, `compute_resource_id` on the runs-on relationship) are not used.
- **No `'number'` cellType in the codebase** — all numeric fields (`port`, `target_port`, `weight`, `scaling_min/max`, `desired/min/max_instances`, `confidence`) use `cellType: 'text'` per existing precedent. No special numeric validation in this spec.
- **No multiline edit cell in the codebase** — `description` uses single-line `cellType: 'text'` everywhere.
- **`infrastructure_points` is hidden from users** but registered in `tabToEntityType` and `gridConfigs` for internal wiring — same pattern as `application_points`.
- **`runtime_config` round-trips via save/load** — spec 3 normalisation already handles `Record<string, unknown> | null`. Hidden from V1 grid (Q10).
- **`allowedKinds` per polymorphic FK** is enforced inside `InfrastructurePointPickerCell.tsx` via filtering; no DB- or backend-level enforcement in V1 (matches spec 1 design — relationship-level allowed-kinds is documentation/UI-only).
- **Backward compatibility** — old saved models without infra arrays still load cleanly because of spec 3's `??=` backfill. Existing non-Infrastructure domains are untouched.
- **No new tests beyond one config test** — picker component, derivation helper, and existing tab/grid plumbing rely on TypeScript compile + the existing `domain-relationship-filtering.test.ts` (which iterates `relationshipTabToType` + `domainGroupings` and naturally asserts the new entries).

## Acceptance Criteria

(Copied from raw idea; preserved verbatim.)

- Infrastructure appears as a first-class domain/section in the model table UI.
- Users can view, add, edit, and delete the 12 Infrastructure entity types.
- Users can view, add, edit, and delete the 3 Infrastructure relationship types.
- FK fields use human-readable lookup/select behaviour where existing UI patterns support it.
- InfrastructurePoint-compatible relationship fields allow valid infrastructure target selection.
- Infrastructure table edits update frontend model state.
- Infrastructure table edits are included in the existing model save flow.
- Existing architectures without Infrastructure data load without errors and show empty Infrastructure tables.
- Existing Business, Application, Data, Behavioural, and UI table behaviour remains unchanged.
- No diagram, Terraform, Gateway, MCP, or Discovery implementation is included in this spec.
