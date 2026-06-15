# Spec Requirements: Infrastructure Domain Frontend Types

## Initial Description

Add frontend TypeScript type and model integration for the new Infrastructure Architecture domain (a sixth Architecture domain alongside Business, Application, Data, Behavioural, and UI). The backend foundation spec introduces `InfrastructurePoint`, 12 Infrastructure entities, 3 Infrastructure relationships, and meta-model persistence through `MetaModelEntitiesDto` / `MetaModelRelationshipsDto`. This spec makes the React/TypeScript frontend aware of the new shapes so it can safely load, hold, edit, and save Infrastructure data through the existing architecture model APIs — **without** adding tables, diagrams, palette UI, routes/pages/tabs, or any other UI surface.

The full raw idea is preserved at `agent-os/specs/2026-05-04-infrastructure-domain-frontend-types/planning/00-raw-idea.md`. Codebase conventions and the locked backend JSON contract are preserved at `planning/codebase-grounding.md`.

## Requirements Discussion

### First Round Questions

**Q1: Field naming — mirror the locked backend contract exactly, or follow the (drifted) raw idea names?**
**Answer:** TypeScript mirrors the locked backend contract exactly. Use `infrastructure_point_id` (on `resource_subnet_hostings`), `target_infrastructure_point_id` (on `load_balancer_resource_routes`), `compute_infrastructure_point_id` (on `deployment_unit_compute_resources`), and `service_id` (on `deployment_units`). Ignore the raw idea's `hosted_resource_point_id`, `target_point_id`, `compute_resource_id` (on the relationship — the entity field stays), and `application_entity_id` — these are raw idea drift.

**Q2: `InfrastructurePoint` shape — `BusinessPoint`-style envelope with `point_kind` discriminator + 12 typed FK fields, with `name` required?**
**Answer:** Yes — `BusinessPoint` style. Fields: `id: string`, `name: string` (**required**, matches `BusinessPoint`), `description: string`, `point_kind` discriminator as a 12-value string-literal union, 12 optional typed FK fields (one per target entity), `tags: string`, `valid_from?: string`, `valid_to?: string`. **Do not** copy `ApplicationPoint`'s deprecated `target_type` / `target_ref_id` / `point_type` legacy fields.

**Q3: How should `runtime_config` (JSONB on backend) be typed on the frontend?**
**Answer:** `Record<string, unknown> | null`. Matches the existing `Service.core_tech_resolved` precedent (`model.ts:387`).

**Q4: How should `tags` be typed on every new entity and relationship?**
**Answer:** `tags: string` on every new entity and every new relationship. Single TEXT-blob string. Mirrors the existing convention (no Record, no array, not optional).

**Q5: Which Lucide icon for the `infrastructure` domain in `DOMAIN_ICONS`?**
**Answer:** `Server`.

**Q6: Palette/diagram visibility — full palette sections, or empty placeholders so TypeScript compiles?**
**Answer:** Empty placeholders. Add `infrastructure: []` entries in `paletteData.ts` for both `DOMAIN_ENTITY_SECTIONS` and `domainToPaletteSections`. No real palette UI in this spec — that belongs to a later diagram spec.

**Q7: Relationship definitions in `relationshipDefinitions.ts` — confirm proposed `displayName` and `endpointEntityTypes`?**
**Answer:** Confirmed as proposed:
- `resource_subnet_hostings` -> displayName **"Resource <-> Subnet"**, endpointEntityTypes `['infrastructure_points', 'subnets']`.
- `deployment_unit_compute_resources` -> displayName **"Deployment Unit <-> Compute"**, endpointEntityTypes `['deployment_units', 'infrastructure_points']`.
- `load_balancer_resource_routes` -> displayName **"Load Balancer Routes"**, endpointEntityTypes `['load_balancers', 'listeners', 'infrastructure_points']`.

**Q8: Should `normalizeModelFromApi` backfill the new entity and relationship arrays the same way it backfills the four UI arrays today?**
**Answer:** Yes. Add a 16-line backfill block (13 new entity arrays + 3 new relationship arrays) following the existing `??=` pattern at `modelSerialization.ts:78-81`. This guarantees older saved projects load without errors.

**Q9: Anything else explicitly out of scope beyond the raw idea's existing list?**
**Answer:** Yes — also exclude (Q10):
- No `gridConfigs` entries.
- No real palette sections (placeholders only).
- No table or diagram UI.
- No new tests beyond what TypeScript compilation forces.

**Q10: Any further exclusions to lock in?**
**Answer:** Also exclude:
- Changes to backend contracts.
- Changes to relationship semantics.
- Cross-domain relationships.
- Terraform / IaC readiness fields.
- Discovery-service / Gateway / MCP integrations.
- UI navigation for Infrastructure tables or diagrams.

### Inferred Decisions (all 18 accepted)

These were inferred from the codebase grounding and accepted by the user without override:

1. **Locked backend JSON contract is authoritative** — wherever the raw idea drifts (e.g. `application_entity_id`, `hosted_resource_point_id`, `target_point_id`, `compute_resource_id` on the runs-on relationship), the TypeScript shape follows the backend contract from spec 1+2 grounding, not the raw idea.
2. **Snake_case field names everywhere** — every entity and relationship field uses snake_case, exactly matching backend JSON keys (e.g. `environment_id`, `cloud_account_id`, `model_file_id` is **server-side only** and is not exposed in DTOs so does not appear in frontend types).
3. **No string-literal unions for entity-internal enums** — all enum-style TEXT fields are typed `?: string` on the entity interface; allowed-value lists belong in `defaults.ts` `<field>Options` arrays for grid use, not in `model.ts`. (`InfrastructurePoint.point_kind` is the **only** string-literal union introduced — it is the discriminator.)
4. **Required vs optional** — fields backed by NOT NULL backend columns are required (`string` / `boolean` / `number`); fields backed by nullable backend columns are optional (`?: string` / `?: boolean` / `?: number`). `name` and `description` follow the existing frontend convention: `name: string`, `description: string` (both required, default empty string in code where backend is nullable).
5. **`tags: string`** on every new entity and every new relationship (Q4) — matches the existing TEXT-blob convention used in every other domain.
6. **`valid_from?: string`, `valid_to?: string`** on every new entity (where the backend has them).
7. **`InfrastructurePoint` shape mirrors `BusinessPoint`** — `id`, `name` (required), `description`, `point_kind` discriminator, 12 optional typed FK fields, `tags: string`, `valid_from?`, `valid_to?`. No `ApplicationPoint`-style legacy fields.
8. **`point_kind` discriminator** is a string-literal union of the 12 backend `point_kind` values (uppercase, snake_case style as enum constants): `ENVIRONMENT | CLOUD_ACCOUNT | LOCATION | NETWORK | SUBNET | COMPUTE_CLUSTER | COMPUTE_RESOURCE | DEPLOYMENT_UNIT | LOAD_BALANCER | LISTENER | DATA_STORE_INSTANCE | INFRASTRUCTURE_RESOURCE`.
9. **`runtime_config: Record<string, unknown> | null`** — JSONB precedent (Q3) following `Service.core_tech_resolved`.
10. **`confidence?: number`** on `resource_subnet_hostings` and `deployment_unit_compute_resources` — DECIMAL(4,3) on backend maps to `number` on frontend.
11. **`environment_id: string`** (required, not optional) on **all 3 relationships** — backend column is NOT NULL.
12. **`MetaModelEntities` extension** — add 13 new array fields (12 entities + `infrastructure_points`) using snake_case keys.
13. **`MetaModelRelationships` extension** — add 3 new array fields using snake_case keys.
14. **`EntityType` and `RelationshipType` string unions** in `model.ts` extended with the 13 new entity types and 3 new relationship types.
15. **`AnyEntity` and `AnyRelationship` discriminated unions** in `model.ts` extended with the 13 new entity interfaces and 3 new relationship interfaces.
16. **`emptyModel`** in `defaults.ts` extended with 13 + 3 new `<key>: []` lines.
17. **`ArchitectureDomain` extension** in `architectureDomain.ts` — add `'infrastructure'` to the union, `ALL_DOMAINS` array, `DOMAIN_LABELS` record, and `DOMAIN_ICONS` record. `DOMAIN_ICONS['infrastructure'] = Server` (Q5).
18. **TypeScript-forced updates** — extending `ArchitectureDomain` forces compile-time additions to `DOMAIN_TO_ENTITY_TYPES`, `DOMAIN_TO_RELATIONSHIP_TYPES` (in `contextPickerDomainMappings.ts`), `DOMAIN_ENTITY_SECTIONS`, and `domainToPaletteSections` (in `paletteData.ts`), plus `ENTITY_TYPE_TO_DOMAIN` (13 new mappings to `'infrastructure'`) and `RELATIONSHIP_TAB_ORDER` (3 new display names) in `relationshipDefinitions.ts`.

### Existing Code to Reference

The codebase grounding identified the following reference points (no new pointers from the user beyond what's already in `codebase-grounding.md`):

- **`BusinessPoint`** at `frontend/src/types/model.ts:237-252` — primary template for `InfrastructurePoint`.
- **`ApplicationPoint`** at `frontend/src/types/model.ts:475-520` — secondary template; **skip** the deprecated `target_type` / `target_ref_id` / `point_type` legacy fields.
- **`DataMovement`** at `frontend/src/types/model.ts:1325` — template for the 3 new relationship interfaces.
- **`Service.core_tech_resolved`** at `frontend/src/types/model.ts:387` — JSONB precedent for `runtime_config`.
- **`MetaModelEntities`** at `frontend/src/types/model.ts:2151-2188` — extend with 13 new entity arrays.
- **`MetaModelRelationships`** at `frontend/src/types/model.ts:2190-2206` — extend with 3 new relationship arrays.
- **`EntityType` / `RelationshipType`** unions at `frontend/src/types/model.ts:2220-2266`.
- **`AnyEntity` / `AnyRelationship`** unions at `frontend/src/types/model.ts:2269-2313`.
- **`emptyModel`** at `frontend/src/config/defaults.ts:1217-1270`.
- **`RELATIONSHIP_DEFINITIONS`** at `frontend/src/config/relationshipDefinitions.ts:51-112`.
- **`ENTITY_TYPE_TO_DOMAIN`** at `frontend/src/config/relationshipDefinitions.ts:146-189`.
- **`RELATIONSHIP_TAB_ORDER`** at `frontend/src/config/relationshipDefinitions.ts:237-248`.
- **`ArchitectureDomain`** at `frontend/src/types/architectureDomain.ts` (full file, 59 lines).
- **`DOMAIN_TO_ENTITY_TYPES` / `DOMAIN_TO_RELATIONSHIP_TYPES`** at `frontend/src/utils/contextPickerDomainMappings.ts` (full file, 75 lines).
- **`DOMAIN_ENTITY_SECTIONS` / `domainToPaletteSections`** at `frontend/src/utils/paletteData.ts`.
- **`normalizeModelFromApi` UI-array backfill block** at `frontend/src/api/modelSerialization.ts:57` (function start) and lines `78-81` (the four UI `??=` lines) — exact pattern to copy for the 16 new infra arrays.

### Follow-up Questions

No follow-up questions were required. The user provided concrete answers on all 10 open questions and accepted all 18 inferred decisions.

## Visual Assets

### Files Provided

Bash check on `agent-os/specs/2026-05-04-infrastructure-domain-frontend-types/planning/visuals/` returned no image/PDF files.

No visual assets provided.

### Visual Insights

N/A — type/configuration-only spec, no UI artefacts. Reference shapes are existing TypeScript declarations in `frontend/src/types/model.ts`.

## Requirements Summary

### Functional Requirements

The frontend must:

1. **Declare 12 new entity interfaces** in `frontend/src/types/model.ts` matching the backend JSON contract exactly (locked field shapes below).
2. **Declare a new `InfrastructurePoint` interface** with a `BusinessPoint`-style envelope and a 12-value `point_kind` discriminator union.
3. **Declare 3 new relationship interfaces** in `frontend/src/types/model.ts` with snake_case fields, required `environment_id`, polymorphic `infrastructure_points` references where the backend uses them, and a JSON-shaped `runtime_config: Record<string, unknown> | null` on `deployment_unit_compute_resources`.
4. **Extend `MetaModelEntities`** with 13 new array fields (12 entities + `infrastructure_points`) and **`MetaModelRelationships`** with 3 new array fields.
5. **Extend the `EntityType` and `RelationshipType` string unions** with the 13 new entity types and 3 new relationship types.
6. **Extend the `AnyEntity` and `AnyRelationship` discriminated unions** to include the 13 new entity interfaces and 3 new relationship interfaces.
7. **Extend `emptyModel`** in `defaults.ts` with 13 + 3 new `<key>: []` lines so default model state is always shape-complete.
8. **Backfill 13 + 3 new arrays** in `normalizeModelFromApi` (modelSerialization.ts) following the existing `??=` UI-array pattern, so older saved models load without errors.
9. **Extend `ArchitectureDomain`** with `'infrastructure'` and update `ALL_DOMAINS`, `DOMAIN_LABELS`, and `DOMAIN_ICONS` (`Server` icon).
10. **Add 13 entries to `ENTITY_TYPE_TO_DOMAIN`** mapping each new entity type string to `'infrastructure'`.
11. **Add 3 entries to `RELATIONSHIP_DEFINITIONS`** with the agreed `displayName` and `endpointEntityTypes` (Q7).
12. **Add 3 display names to `RELATIONSHIP_TAB_ORDER`**.
13. **Add `infrastructure: [...]` entries to `DOMAIN_TO_ENTITY_TYPES` and `DOMAIN_TO_RELATIONSHIP_TYPES`** so `contextPickerDomainMappings.ts` compiles.
14. **Add `infrastructure: []` empty placeholder entries** to `DOMAIN_ENTITY_SECTIONS` and `domainToPaletteSections` in `paletteData.ts` so the file compiles (no real palette UI yet).
15. **Preserve existing behaviour** for all non-Infrastructure domains; no changes to existing types, defaults, normalisation, relationship definitions, or palette data beyond additive entries.

### TypeScript Type Inventory (locked field shapes)

All field names are snake_case to match the backend JSON. All entity interfaces include the standard envelope (`id: string`, `name: string`, `description: string`, `tags: string`, optional `valid_from?: string`, `valid_to?: string`) — listed once here and not repeated per entity. `model_file_id` is server-side and **does not appear** in any frontend type.

#### Entity 1: `Environment`

- Standard envelope.
- `environment_type?: string`
- `lifecycle_state?: string`
- `is_current_state?: boolean`
- `is_target_state?: boolean`
- `owner?: string`
- `criticality?: string`

#### Entity 2: `CloudAccount`

- Standard envelope.
- `environment_id?: string`
- `provider?: string`
- `external_account_id?: string`
- `parent_org_id?: string`
- `billing_owner?: string`
- `technical_owner?: string`
- `landing_zone_name?: string`

#### Entity 3: `Location`

- Standard envelope.
- `environment_id?: string`
- `cloud_account_id?: string`
- `location_type?: string`
- `provider?: string`
- `provider_region_code?: string`
- `provider_zone_code?: string`
- `country?: string`
- `city?: string`
- `address?: string`

#### Entity 4: `Network`

- Standard envelope.
- `environment_id?: string`
- `cloud_account_id?: string`
- `location_id?: string`
- `network_type?: string`
- `provider?: string`
- `cidr?: string`
- `external_id?: string`
- `is_shared?: boolean`
- `routing_mode?: string`

#### Entity 5: `Subnet`

- Standard envelope.
- `environment_id?: string`
- `network_id?: string`
- `location_id?: string`
- `cidr?: string`
- `subnet_type?: string`
- `visibility?: string`
- `provider_region_code?: string`
- `provider_zone_code?: string`
- `external_id?: string`
- `gateway_address?: string`

#### Entity 6: `ComputeCluster`

- Standard envelope.
- `environment_id?: string`
- `cloud_account_id?: string`
- `location_id?: string`
- `network_id?: string`
- `platform_type?: string`
- `provider?: string`
- `version?: string`
- `external_id?: string`
- `owner?: string`
- `operating_model?: string`

#### Entity 7: `ComputeResource`

- Standard envelope.
- `environment_id?: string`
- `cloud_account_id?: string`
- `location_id?: string`
- `cluster_id?: string`
- `compute_type?: string`
- `provider?: string`
- `hostname?: string`
- `fqdn?: string`
- `private_ip?: string`
- `public_ip?: string`
- `os?: string`
- `runtime?: string`
- `instance_size?: string`
- `scaling_min?: number`
- `scaling_max?: number`
- `external_id?: string`
- `lifecycle_state?: string`
- `owner?: string`

#### Entity 8: `DeploymentUnit`

- Standard envelope.
- **`service_id?: string`** — direct typed FK, mirroring backend (Q1; **not** `application_entity_id`).
- `deployment_unit_type?: string`
- `version?: string`
- `artifact_uri?: string`
- `image_name?: string`
- `image_tag?: string`
- `source_repository?: string`
- `source_commit?: string`
- `build_pipeline?: string`
- `owner?: string`

#### Entity 9: `LoadBalancer`

- Standard envelope.
- `environment_id?: string`
- `cloud_account_id?: string`
- `location_id?: string`
- `network_id?: string`
- `load_balancer_type?: string`
- `provider?: string`
- `exposure?: string`
- `scheme?: string`
- `dns_name?: string`
- `ip_address?: string`
- `external_id?: string`
- `owner?: string`

#### Entity 10: `Listener`

- Standard envelope.
- `environment_id?: string`
- `load_balancer_id?: string`
- **`compute_resource_id?: string`** — direct FK (mirrors backend A1; Listener attaches to a Compute Resource directly).
- `protocol?: string`
- `port?: number`
- `host_name?: string`
- `path_pattern?: string`
- `exposure?: string`
- `is_public?: boolean`
- `certificate_reference?: string`
- `external_id?: string`

#### Entity 11: `DataStoreInstance`

- Standard envelope.
- `environment_id?: string`
- `cloud_account_id?: string`
- `location_id?: string`
- `data_store_type?: string`
- `engine?: string`
- `engine_version?: string`
- `provider?: string`
- `host?: string`
- `port?: number`
- `external_id?: string`
- `encrypted?: boolean`
- `ha_enabled?: boolean`
- `backup_enabled?: boolean`
- `owner?: string`

#### Entity 12: `InfrastructureResource`

- Standard envelope.
- `environment_id?: string`
- `cloud_account_id?: string`
- `location_id?: string`
- `resource_type?: string`
- `provider?: string`
- `provider_resource_type?: string`
- `endpoint?: string`
- `external_id?: string`
- `criticality?: string`
- `owner?: string`

#### Polymorphic Supertype: `InfrastructurePoint`

- `id: string`
- `name: string` (**required** per Q2)
- `description: string`
- `point_kind: InfrastructurePointKind` — string-literal union: `'ENVIRONMENT' | 'CLOUD_ACCOUNT' | 'LOCATION' | 'NETWORK' | 'SUBNET' | 'COMPUTE_CLUSTER' | 'COMPUTE_RESOURCE' | 'DEPLOYMENT_UNIT' | 'LOAD_BALANCER' | 'LISTENER' | 'DATA_STORE_INSTANCE' | 'INFRASTRUCTURE_RESOURCE'`.
- 12 optional typed FK fields:
  - `environment_id?: string`
  - `cloud_account_id?: string`
  - `location_id?: string`
  - `network_id?: string`
  - `subnet_id?: string`
  - `compute_cluster_id?: string`
  - `compute_resource_id?: string`
  - `deployment_unit_id?: string`
  - `load_balancer_id?: string`
  - `listener_id?: string`
  - `data_store_instance_id?: string`
  - `infrastructure_resource_id?: string`
- `tags: string`
- `valid_from?: string`
- `valid_to?: string`

#### Relationship 1: `ResourceSubnetHosting` (key: `resource_subnet_hostings`)

- `id: string`
- `description: string`
- **`infrastructure_point_id: string`** — required (Q1; backend NOT NULL). Polymorphic source via `InfrastructurePoint`.
- `subnet_id: string` — required (backend NOT NULL).
- `environment_id: string` — required (backend NOT NULL).
- `relationship_role?: string`
- `primary_ip?: string`
- `private_ip?: string`
- `public_ip?: string`
- `evidence_source?: string`
- `confidence?: number`
- `tags: string`

#### Relationship 2: `DeploymentUnitComputeResource` (key: `deployment_unit_compute_resources`)

- `id: string`
- `description: string`
- `deployment_unit_id: string` — required (backend NOT NULL).
- **`compute_infrastructure_point_id: string`** — required (Q1; backend NOT NULL). Polymorphic compute target via `InfrastructurePoint`. Allowed `point_kind` at this end: `COMPUTE_RESOURCE` or `COMPUTE_CLUSTER` (documentation-only — not enforced by TypeScript).
- `environment_id: string` — required (backend NOT NULL).
- `version?: string`
- **`runtime_config?: Record<string, unknown> | null`** — JSONB on backend; matches `Service.core_tech_resolved` precedent (Q3).
- `desired_instances?: number`
- `min_instances?: number`
- `max_instances?: number`
- `deployment_status?: string`
- `evidence_source?: string`
- `confidence?: number`
- `tags: string`

#### Relationship 3: `LoadBalancerResourceRoute` (key: `load_balancer_resource_routes`)

- `id: string`
- `description: string`
- `load_balancer_id: string` — required (backend NOT NULL).
- `listener_id?: string`
- **`target_infrastructure_point_id: string`** — required (Q1; backend NOT NULL). Polymorphic target via `InfrastructurePoint`.
- `environment_id: string` — required (backend NOT NULL).
- `protocol?: string`
- `target_port?: number`
- `host_name?: string`
- `path_pattern?: string`
- `routing_type?: string`
- `weight?: number`
- `health_check_path?: string`
- `tags: string`

### File Touch Points

| # | File | Change |
|---|---|---|
| 1 | `frontend/src/types/model.ts` | Add 12 entity interfaces, `InfrastructurePoint` interface, `InfrastructurePointKind` union, 3 relationship interfaces. Extend `MetaModelEntities` (13 new array fields), `MetaModelRelationships` (3 new array fields), `EntityType` union (13 new strings), `RelationshipType` union (3 new strings), `AnyEntity` union (13 new branches), `AnyRelationship` union (3 new branches). |
| 2 | `frontend/src/types/architectureDomain.ts` | Add `'infrastructure'` to `ArchitectureDomain` union; extend `ALL_DOMAINS`, `DOMAIN_LABELS`, `DOMAIN_ICONS` (use `Server` Lucide icon — Q5). |
| 3 | `frontend/src/config/defaults.ts` | Extend `emptyModel` with 13 + 3 new `<key>: []` lines. |
| 4 | `frontend/src/config/relationshipDefinitions.ts` | Add 3 entries to `RELATIONSHIP_DEFINITIONS` (Q7 displayNames + endpointEntityTypes); add 13 entity-type-to-`'infrastructure'` mappings to `ENTITY_TYPE_TO_DOMAIN`; add 3 displayName entries to `RELATIONSHIP_TAB_ORDER`. |
| 5 | `frontend/src/utils/contextPickerDomainMappings.ts` | Add `infrastructure: [13 entity type strings]` to `DOMAIN_TO_ENTITY_TYPES`; add `infrastructure: [3 relationship type strings]` to `DOMAIN_TO_RELATIONSHIP_TYPES` (TypeScript-forced by extending `ArchitectureDomain`). |
| 6 | `frontend/src/utils/paletteData.ts` | Add `infrastructure: []` empty-placeholder entries to `DOMAIN_ENTITY_SECTIONS` and `domainToPaletteSections` (TypeScript-forced; no real palette UI). |
| 7 | **`frontend/src/api/modelSerialization.ts`** | Inside `normalizeModelFromApi` (line 57), extend the existing `??=` backfill block (currently lines 78-81 covering 4 UI arrays) with 13 new entity-array `??=` lines and 3 new relationship-array `??=` lines. Note: relationship arrays live under `cloned.metaModel.relationships` — ensure that container is also guaranteed to exist before backfilling (the existing code only guarantees `cloned.metaModel.entities`). |

`normalizeModelFromApi` location confirmed at `frontend/src/api/modelSerialization.ts:57` (function start) with the UI backfill block at lines 78-81 — exactly as the grounding noted.

### Reusability Opportunities

- **`BusinessPoint`** (`model.ts:237`) — primary template for `InfrastructurePoint` shape.
- **`DataMovement`** (`model.ts:1325`) — template for the 3 relationship interfaces (snake_case fields, required `description`, `tags: string`, optional fields with `?`).
- **`Service.core_tech_resolved`** (`model.ts:387`) — JSONB precedent for `runtime_config`.
- **`normalizeModelFromApi` UI-array backfill** (`modelSerialization.ts:78-81`) — exact `??=` pattern to copy for the 16 new infra arrays.
- **`emptyModel`** extension is purely additive — copy any existing `<key>: []` line and adjust the key.
- **`RELATIONSHIP_DEFINITIONS`** existing `data_movements` entry — closest model (mixed endpointEntityTypes including a polymorphic point type alongside concrete entity types).

### Scope Boundaries

**In Scope:**
- 12 new entity TypeScript interfaces in `model.ts`.
- 1 new `InfrastructurePoint` interface + `InfrastructurePointKind` union.
- 3 new relationship TypeScript interfaces.
- `MetaModelEntities` and `MetaModelRelationships` extension.
- `EntityType`, `RelationshipType`, `AnyEntity`, `AnyRelationship` extensions.
- `emptyModel` extension (13 + 3 new empty arrays).
- `normalizeModelFromApi` backfill extension (16 new `??=` lines).
- `ArchitectureDomain` extension (`'infrastructure'` + Lucide `Server` icon).
- 3 new `RELATIONSHIP_DEFINITIONS` entries; 13 new `ENTITY_TYPE_TO_DOMAIN` mappings; 3 new `RELATIONSHIP_TAB_ORDER` entries.
- `DOMAIN_TO_ENTITY_TYPES` and `DOMAIN_TO_RELATIONSHIP_TYPES` extension (TypeScript-forced).
- `DOMAIN_ENTITY_SECTIONS` and `domainToPaletteSections` extension (TypeScript-forced empty placeholders).

**Out of Scope** (raw idea exclusions plus the 6 new explicit exclusions from Q10):
- Infrastructure table UI (raw idea).
- Infrastructure diagram UI (raw idea).
- New routes / pages / tabs for Infrastructure (raw idea).
- Gateway changes (raw idea).
- MCP tools (raw idea).
- Discovery-service changes (raw idea).
- Terraform import / export / generation (raw idea).
- Security group / firewall / IAM modelling (raw idea).
- Traffic flow relationship (raw idea).
- Data entity hosted on data store relationship (raw idea).
- Infrastructure resource dependency relationship (raw idea).
- **No `gridConfigs` entries** (Q9).
- **No real palette sections** — placeholders only (Q9).
- **No table or diagram UI** (Q9).
- **No new tests beyond what TypeScript compilation forces** (Q9).
- **No changes to backend contracts** (Q10).
- **No changes to relationship semantics** (Q10).
- **No cross-domain relationships** (Q10).
- **No Terraform / IaC readiness fields** (Q10).
- **No Discovery / Gateway / MCP integrations** (Q10).
- **No UI navigation for Infrastructure tables / diagrams** (Q10).

### Technical Considerations

- **Backend contract is authoritative**. Where the raw idea uses different field names (`application_entity_id`, `hosted_resource_point_id`, `target_point_id`, `compute_resource_id` on the runs-on relationship), the frontend follows the locked backend names. This is by explicit user decision (Q1).
- **`runtime_config` typing** — JSONB on backend, raw JSON `String` in the backend DTO. Frontend uses `Record<string, unknown> | null` per the `Service.core_tech_resolved` precedent. The serialization path will preserve the structured value end-to-end without further parsing in this spec.
- **`normalizeModelFromApi` relationships container** — the existing function backfills only `cloned.metaModel.entities` keys. Adding 3 relationship-array backfills requires also guaranteeing `cloned.metaModel.relationships` exists (the type already declares it optional). Implementer should add an `if (!cloned.metaModel.relationships) cloned.metaModel.relationships = {};` guard alongside the existing `entities` guard before the new `??=` lines.
- **No string-literal unions for entity-internal enums** — `point_kind` is the only string-literal union introduced; all other enum-style fields are `?: string` on the entity interface.
- **TypeScript-forced palette/context updates** — extending `ArchitectureDomain` causes compile errors in `paletteData.ts` and `contextPickerDomainMappings.ts` until the new `'infrastructure'` keys are added. Empty arrays (`infrastructure: []`) are sufficient to make TypeScript pass; downstream UI panels won't render an Infrastructure section yet.
- **No new tests** — pure type-and-config additions; verification is via successful `tsc` compile and existing tests continuing to pass. Pre-existing failing tests (per project memory) are unrelated and remain untouched.
- **Backward compatibility** — old saved models without infra arrays load cleanly because of the `??=` backfill; old saves without the new entity/relationship types are unaffected because all new `MetaModel*` entries default to `[]`.

## Acceptance Criteria

(Copied from raw idea; preserved verbatim.)

- Frontend TypeScript types include all 12 Infrastructure entities.
- Frontend TypeScript types include all 3 Infrastructure relationships.
- Frontend TypeScript types include `InfrastructurePoint` in a style consistent with existing point abstractions.
- Full architecture model type includes Infrastructure entity arrays.
- Full architecture model type includes Infrastructure relationship arrays.
- Default/empty model state includes empty Infrastructure arrays.
- Loading an older model payload without Infrastructure fields does not break the frontend.
- Saving a model preserves Infrastructure fields when present.
- Existing non-Infrastructure model load/save behaviour remains unchanged.
- Relationship definitions/configuration include the three Infrastructure relationships.
- No Infrastructure tables, diagrams, Terraform import, Gateway, MCP, or Discovery implementation is included in this spec.
