# Codebase Grounding — Infrastructure Domain Tables UI (Spec 4 of 7)

## Prior spec context (locked)

- Spec 1 (`2026-05-04-infrastructure-domain-backend-foundation`): backend model + locked JSON contract. Suggested enum picklist values are documented per field (e.g. `environment_type` -> `DEV, TEST, STAGING, PROD, DR, CURRENT_STATE, TARGET_STATE, OTHER`).
- Spec 2 (`2026-05-04-infrastructure-domain-backend-api`): backend API + clone/inventory wiring.
- Spec 3 (`2026-05-04-infrastructure-domain-frontend-types`): frontend types/config landed:
  - `model.ts` — 16 TS interfaces (12 entities + `InfrastructurePoint` + 3 relationships) plus `InfrastructurePointKind` union, `EntityType` / `RelationshipType` / `AnyEntity` / `AnyRelationship` extended; `MetaModelEntities` and `MetaModelRelationships` extended with 13 + 3 array fields.
  - `architectureDomain.ts` — `'infrastructure'` added to `ArchitectureDomain`, `ALL_DOMAINS`, `DOMAIN_LABELS`, `DOMAIN_ICONS` (Lucide `Server`).
  - `defaults.ts` `emptyModel` — 13 + 3 new `<key>: []` arrays.
  - `relationshipDefinitions.ts` — 3 new `RELATIONSHIP_DEFINITIONS` entries; 13 new `ENTITY_TYPE_TO_DOMAIN` mappings; 3 new `RELATIONSHIP_TAB_ORDER` entries.
  - `paletteData.ts` — `infrastructure: []` placeholders in `DOMAIN_ENTITY_SECTIONS` and `domainToPaletteSections`. **Palette stays empty in this spec** (no diagram UI here).
  - `contextPickerDomainMappings.ts` — full `infrastructure` arrays (13 entity types, 3 relationship types).
  - `useCurrentView.ts` — `META_MODEL_DOMAIN_URL_VALUES` accepts `'infrastructure'`; URL `/metamodel/infrastructure` already routes.
  - `modelSerialization.ts` — backfill block extended for the 16 new arrays.

**`gridConfigs.ts` was deliberately NOT extended in spec 3 — that is THIS spec's job.**

## Locked field contract (must match exactly)

- `Listener.compute_resource_id` — direct typed FK to `compute_resources` (NOT polymorphic).
- `DeploymentUnit.service_id` — direct typed FK to `services` (NOT `application_entity_id`; the raw idea drift). Confirmed in spec 3 requirements.md as locked.
- Relationship FKs to `infrastructure_points`:
  - `resource_subnet_hostings.infrastructure_point_id`
  - `deployment_unit_compute_resources.compute_infrastructure_point_id`
  - `load_balancer_resource_routes.target_infrastructure_point_id`
- `DeploymentUnitComputeResource.runtime_config?: Record<string, unknown> | null`.
- `confidence?: number` on `resource_subnet_hostings` and `deployment_unit_compute_resources`.
- `tags: string` on every entity and relationship (single TEXT-blob convention).
- Required FKs: every relationship has `environment_id: string` (NOT NULL backend) plus its concrete-FK endpoints (e.g. `subnet_id`, `deployment_unit_id`, `load_balancer_id`).

## Existing tables-UI surface (mapped)

### `frontend/src/config/gridConfigs.ts` (752 lines)

- Exports `gridConfigs: Record<string, GridColumnConfig[]>` keyed by entity/relationship type string (e.g. `business_users`, `data_movements`).
- `GridColumnConfig` is defined in `frontend/src/types/config.ts` (lines 87-171). Key fields: `field`, `displayName`, `cellType`, `required: boolean`, `width: number`, `options?: string[]`, `fkTarget?: string`, `autoGenerate?: boolean`, `displayFormatter?`, `allowedKinds?: string[]`, `xorGroup?`, `dynamicFkTargetField?`, `dynamicFkTargetMap?`.
- `CellType` union (config.ts:59-70): `'text' | 'tags' | 'boolean' | 'dropdown' | 'fk_typeahead' | 'text_with_suggestions' | 'application_point_picker' | 'package_set_dropdown' | 'data_entity_point_picker' | 'free_text_typeahead_single_token' | 'tech_hints_cell'`.
- **No `'number'` cellType** — numeric fields (`port`, `sequence_order`) use `cellType: 'text'`. Confidence/decimals have no existing precedent in any grid config.
- **No multiline edit cell** — every entity exposes `description` as `cellType: 'text'` (single-line). e.g. `business_processes` line 56, `applications` line 116, `services` line 153.
- `tags` is exposed on essentially every entity (`cellType: 'tags'`, single-line under the hood — `TextCell` is rendered for both `text` and `tags` per `GridCell.tsx:167-176`).
- `valid_from` / `valid_to` rendered via `cellType: 'text'` (e.g. `business_processes` lines 57-58, `applications` lines 122-123). No special date type.
- Booleans use `cellType: 'boolean'` (e.g. `applications.is_internal` line 120, `services.is_internal` line 167).

### Domain wiring

The same file also exports the four maps that the `MetaModelView` reads to render its tabs:

- `tabToEntityType: Record<string, string>` (lines 606-641) — display tab name -> entity-type key.
- `relationshipTabToType: Record<string, string>` (lines 647-658) — display tab name -> relationship-type key.
- `entityTabNames: string[]` (lines 663-695) — flat list of entity tab display names.
- `relationshipTabNames: string[]` (lines 739-750) — flat list of relationship tab display names.
- `domainGroupings: Record<ArchitectureDomain, string[]>` (lines 704-711) — domain -> visible entity tab names. **Spec 3 already added `infrastructure: []` placeholder** (line 710). This spec must replace it with real tab names.
- `DOMAIN_ENTITY_TYPES: Record<ArchitectureDomain, string[]>` (lines 726-733) — same shape but for ALL entity types per domain (including hidden super-entities). **Spec 3 already added `infrastructure: []` placeholder** (line 732). Same — needs real values.

### `frontend/src/components/MetaModelView/MetaModelView.tsx` (336 lines)

- The user picks a domain via `<DomainSelector />` (which reads URL `:domain` param). Once selected, `MetaModelView` reads `domainGroupings[internalDomain]` for entity tab names and `getOrderedRelationshipDisplayNamesForDomain(internalDomain)` for relationship tab names.
- Entity tab click -> `<Grid entityType={tabToEntityType[selectedTab]} />`.
- Relationship tab click -> `<RelationshipGrid relationshipType={relationshipTabToType[selectedTab]} />`.
- Both grids look up `gridConfigs[<key>]` for column metadata.
- Conclusion: extending `infrastructure` requires (a) entries in `gridConfigs` for all 16 new keys, (b) tab-name additions to `tabToEntityType`, `relationshipTabToType`, `entityTabNames`, `relationshipTabNames`, (c) populating `domainGroupings.infrastructure` and `DOMAIN_ENTITY_TYPES.infrastructure`. No `MetaModelView.tsx` edits required.

### Polymorphic point-picker patterns

Two existing dedicated cellTypes serve as the reference for `InfrastructurePoint` editing:

- **`application_point_picker`** (`ApplicationPointPickerCell.tsx`, 622 lines):
  - Grouped dropdown over Applications, App Components, Services, Classes, Methods.
  - Optional `allowedKinds?: string[]` column-config filter to restrict the picker to a subset of kinds (e.g. business_logic UI restricts to `['APPLICATION', 'APP_COMPONENT', 'SERVICE']`).
  - Auto-creates a derived ApplicationPoint when a raw entity is picked.
  - Used by `data_movements.source_application_point_id` and `data_movements.target_application_point_id`.

- **`data_entity_point_picker`** (`DataEntityPointSelect.tsx`, 364 lines):
  - Unified picker over logical and physical data entities, returning a `data_entity_points` row id.
  - Used by `data_movements.dataEntityPointId` and `endpoints.request_data_entity_point_id` etc.

There is **no existing `infrastructure_point_picker`** — this spec must add it (a new cellType + a new dedicated cell component, modelled on `ApplicationPointPickerCell` because that one already has an `allowedKinds` filter, which we'll reuse to restrict per-relationship endpoint kinds).

### `frontend/src/config/defaults.ts` (1288 lines)

- Exports option arrays for dropdowns: `appTypeOptions`, `statusOptions`, `serviceTypeOptions`, `pointTypeOptions`, `physicalTypeOptions`, `techTypeOptions`, `applicationPointTargetTypeOptions`, `businessLogicTypeOptions`, `movementTypeOptions`, etc.
- Convention: simple `string[]` for plain values (e.g. `appTypeOptions = ['Web', 'Batch', 'API', 'Desktop', 'Mobile']` — line 959); `Array<{ value, label }>` only when a friendly label is needed.
- `formatOptionLabel` column config supports converting raw values to title-case labels at render time (`snakeCaseToTitleCase` in `GridCell.tsx`); used by `user_journey_links.relationship_type` (line 589).
- This spec needs to add new option arrays for: `environmentTypeOptions`, `lifecycleStateOptions`, `criticalityOptions`, `providerOptions`, `locationTypeOptions`, `networkTypeOptions`, `routingModeOptions`, `subnetTypeOptions`, `subnetVisibilityOptions`, `platformTypeOptions`, `operatingModelOptions`, `computeTypeOptions`, `deploymentUnitTypeOptions`, `loadBalancerTypeOptions`, `exposureOptions`, `protocolOptions`, `dataStoreTypeOptions`, `engineOptions`, `resourceTypeOptions`, `infrastructurePointKindOptions`, `relationshipRoleOptions`, `deploymentStatusOptions`, `routingTypeOptions`. All sourced from spec 1's documented enum values.

### Existing tests touching gridConfigs

- `frontend/src/__tests__/domain-relationship-filtering.test.ts` — checks that every `relationshipTabToType` value resolves to a `gridConfigs[<key>]` entry, and that `domainGroupings` tabs all map back to entity types.
- `frontend/src/__tests__/endpoint-config.test.ts`, `endpoint-integration.test.ts` — pattern tests for one entity type's grid config (good template for an Infrastructure config test).
- `frontend/src/__tests__/excel-worksheet-names.test.ts` — iterates `tabToEntityType` and `relationshipTabToType`.
- `frontend/src/config/__tests__/userJourneyLinksConfig.test.ts` — pattern for asserting a new tab is wired through `tabToEntityType`/`relationshipTabToType`/`relationshipTabNames` and that `gridConfigs[<key>]` has all expected columns. Vitest convention.

Adding 16 new gridConfigs entries plus the tab-map entries WILL almost certainly cause `domain-relationship-filtering.test.ts` to assert positively across the new entries — the test iterates the data, so as long as the new `gridConfigs[key]` entries exist, the test passes naturally. No edits required to existing tests.

### Pre-existing failing tests (project memory)

Per project memory, these are pre-existing failures and **leave alone**:
- `bootstrap-summary-fetching.test.ts`, `conversation-memory-edge-cases.test.ts`, `dashboardSummary*.test.ts`, `hub-bootstrap-4-task-definition.test.ts`, `chatV2-panel-integration.test.ts`, `chatV2-panel-context-and-filtering.test.ts`.

### Files NOT to touch in this spec

- `paletteData.ts` — `infrastructure: []` placeholders stay; no diagram palette in this spec (raw idea: "Diagram support comes later").
- `MetaModelView.tsx` — no edits required (it's already domain-agnostic).
- `architectureDomain.ts`, `relationshipDefinitions.ts`, `useCurrentView.ts`, `modelSerialization.ts`, `model.ts`, `defaults.ts emptyModel` — already done by spec 3.

## Files this spec WILL touch

1. `frontend/src/config/gridConfigs.ts` — add 12 entity gridConfigs + 3 relationship gridConfigs + 1 `infrastructure_points` gridConfig (16 total). Also extend the 6 tab/domain maps (`tabToEntityType`, `relationshipTabToType`, `entityTabNames`, `relationshipTabNames`, `domainGroupings.infrastructure`, `DOMAIN_ENTITY_TYPES.infrastructure`).
2. `frontend/src/config/defaults.ts` — add ~20 new option arrays for the Infrastructure picklist fields, sourced verbatim from spec 1's documented enum values.
3. `frontend/src/types/config.ts` — extend the `CellType` string union with `'infrastructure_point_picker'`.
4. `frontend/src/components/Grid/GridCell.tsx` — add a `case 'infrastructure_point_picker'` arm rendering the new cell component.
5. **NEW** `frontend/src/components/Grid/InfrastructurePointPickerCell.tsx` — modelled on `ApplicationPointPickerCell.tsx`. Grouped dropdown over the 12 infrastructure entity types, `allowedKinds?: string[]` filter, auto-create a derived `InfrastructurePoint` row on selection of a raw entity (using a small `infrastructurePointDerivation.ts` helper).
6. **NEW** `frontend/src/utils/infrastructurePointDerivation.ts` — small helper modelled on `applicationPointDerivation.ts`, creating an `InfrastructurePoint` row with the correct `point_kind` and the corresponding typed FK populated.
7. **NEW (optional)** `frontend/src/utils/formatters.ts` — append an `infrastructurePointDisplayFormatter` mirroring the existing `applicationPointDisplayFormatter`.
8. **NEW** `frontend/src/config/__tests__/infrastructureTablesConfig.test.ts` — Vitest config test asserting all 16 keys exist in `gridConfigs`, expected fields per entity, tab maps, `domainGroupings.infrastructure` populated, etc. Modeled on `userJourneyLinksConfig.test.ts`.

No backend, gateway, MCP, discovery, or Terraform changes.
