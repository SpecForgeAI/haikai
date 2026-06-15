# Task Breakdown: Infrastructure Domain Diagram Support

## Overview
Total Tasks: 7 task groups covering 7-9 frontend file edits (1 created, 6-8 modified), all additive.

This spec is **diagram-config and minimal-inspector only** — it wires the new Infrastructure domain into the hand-rolled SVG diagram engine on top of the type/config foundation that specs 3 and 4 landed. There are no backend, gateway, MCP, discovery, Terraform, or save-pipeline changes; round-trip already works through spec 3's `normalizeModelFromApi`. There is no React Flow — all wiring threads through the existing `Canvas.tsx` + `rendering.ts` + `nodeCreation.ts` + `relationshipUtils.ts` pipeline. Native nesting via `parent_node_id` is already first-class.

The spec touches these files:
- **Modified (6-8):**
  - `frontend/src/types/diagramType.ts` — `DiagramType` union extended with `'Infrastructure'` plus 3 register-table updates.
  - `frontend/src/types/model.ts` — 3 new `RELATIONSHIP_EDGE_TYPES` constants (~line 1418).
  - `frontend/src/utils/paletteData.ts` — `DOMAIN_ENTITY_SECTIONS.infrastructure`, `domainToPaletteSections.infrastructure`, `DIAGRAM_TYPE_PALETTE_RULES.Infrastructure`, `entitySections` (12 entries), `getEntityTypeConstant` (12 mappings), and either explicit `relationshipSections` entries or auto-derivation from `RELATIONSHIP_DEFINITIONS` (implementer's call).
  - `frontend/src/config/defaults.ts` — 12 new `entityColors` entries; 6 container default-dimension overrides (or inlined in `nodeCreation.ts` instead — implementer's call).
  - `frontend/src/utils/relationshipUtils.ts` — 2 new `createRelationshipEdge` switch cases; 3 new `isRelationshipRowEnabled` arms; `infrastructurePointsOnDiagram: Set<string>` field added to `getEntitiesOnDiagram`.
  - `frontend/src/utils/rendering.ts` — 2-3 entries in the `relationshipColors` lookup; 2 new switch arms in `getRelationshipEdgeDefaults` (~line 447).
  - `frontend/src/components/DiagramsView/PalettePanel.tsx` (or analogous post-add hook) — containment plumbing for `resource_subnet_hostings` (sets `parent_node_id`; no edge drawn).
  - `frontend/src/components/DiagramsView/SelectionInspector.tsx` — 12 minimal entity arms (`name` + `description`); 3 minimal relationship-edge arms (`description` + `tags`).
- **Created (1):**
  - `frontend/src/config/__tests__/infrastructureDiagramConfig.test.ts` — Vitest config test modelled on spec 4's `infrastructureTablesConfig.test.ts`.

**Key sequencing pivot:** Group 1 lands the type-level foundations that everything else depends on (`'Infrastructure'` in `DiagramType` union; 3 new `RELATIONSHIP_EDGE_TYPES` constants). Groups 2 and 3 are independent runs over palette wiring + colours/dimensions and edge styling/rendering; both consume the constants from Group 1. Group 4 extends `getEntitiesOnDiagram` and the `isRelationshipRowEnabled` switch with polymorphic-point resolution; depends on Groups 1 + 2 (entity-type constants) and 3 (edge constants for the row-enable arms). Group 5 wires the `resource_subnet_hostings` containment plumbing; depends on Group 4. Group 6 lands the 12 + 3 minimal `SelectionInspector` arms; depends only on Group 1. Group 7 adds the single Vitest config test and runs the verification sweep.

## Two Implementer-Time Decisions to Flag

These decisions are explicitly left to the implementer at write-time per the spec; either choice is acceptable and the user-visible behaviour is identical.

1. **Default-dimension overrides for the 6 container-like types** (`ENVIRONMENT`, `CLOUD_ACCOUNT`, `LOCATION`, `NETWORK`, `SUBNET`, `COMPUTE_CLUSTER`, all 320x200 instead of the 120x60 default). Two options:
   - **(a) Extend a default-dimensions config table in `frontend/src/config/defaults.ts`** — preferred if a `defaultNodeDimensions` (or similarly-named) `Record<string, {width, height}>` lookup already exists.
   - **(b) Inline override in `frontend/src/utils/nodeCreation.ts`** — preferred if no such config table exists; add a small `if (CONTAINER_TYPES.has(entity_type)) { ... }` branch in `createDiagramNodeFromEntity` to override `width`/`height` before returning.
   - Spec text (~line 29 of spec.md) explicitly says "Implementer chooses ... either is fine."

2. **Relationship-section derivation in `paletteData.ts`** — does the existing `paletteData.ts` derive relationship sections from `RELATIONSHIP_DEFINITIONS` (spec 3 already populated those), or is there an explicit `relationshipSections` array literal that needs 3 new entries appended? Two options:
   - **(a) Auto-derivation already in place** — verify at write-time; if so, no edits to a `relationshipSections` array are needed beyond ensuring `domainToPaletteSections.infrastructure` and `DIAGRAM_TYPE_PALETTE_RULES.Infrastructure` list the 3 relationship section IDs (Group 2.2 and 2.3).
   - **(b) Explicit array literal** — append 3 entries to `relationshipSections` mapping each to the matching `metaModel.entities.<rel_key>` rows.
   - Spec text (~line 24 of spec.md) explicitly says "or the `RELATIONSHIP_DEFINITIONS`-driven derivation, whichever is in use." User-visible result is identical.

## Pre-Existing Failing Tests — Implementer Convention

Per project memory, the following Vitest/Jest suites have pre-existing failures unrelated to this spec:
- `bootstrap-summary-fetching.test.ts` (1 fail: URL assertion)
- `conversation-memory-edge-cases.test.ts`
- `dashboardSummary*.test.ts` (metric value assertions)
- `hub-bootstrap-4-task-definition.test.ts` (2 fails: availableFrom)
- `chatV2-panel-integration.test.ts` (3 fails: availableFrom)
- `chatV2-panel-context-and-filtering.test.ts` (1 fail: availableFrom)

This spec must **NOT** modify or attempt to fix any of these. Verification in Group 7 is: `npx tsc --noEmit` is clean (zero new errors), the new `infrastructureDiagramConfig.test.ts` passes, and the existing failing-test inventory has not grown.

## Task List

### Type Registration Layer

#### Task Group 1: Register `'Infrastructure'` `DiagramType` and 3 new `RELATIONSHIP_EDGE_TYPES` constants
**Dependencies:** None

- [x] 1.0 Land the type-level foundations that every subsequent group depends on: extend the `DiagramType` union with `'Infrastructure'` and add 3 new `RELATIONSHIP_EDGE_TYPES` constants. Both files are pure additions; existing entries are preserved verbatim.
  - [x] 1.1 Extend `DiagramType` union and registers in `frontend/src/types/diagramType.ts`
    - **File:** `frontend/src/types/diagramType.ts`
    - Append `| 'Infrastructure'` to the existing `DiagramType` union. Final union members: `'General' | 'ER' | 'Sequence' | 'Activity' | 'State' | 'UI_Workflow' | 'UI_SCREEN' | 'USER_JOURNEY' | 'USER_JOURNEY_OVERVIEW' | 'Infrastructure'`.
    - Append `'Infrastructure'` to the `CREATABLE_DIAGRAM_TYPES` array (it IS user-creatable, unlike the two generated user-journey types).
    - Append `Infrastructure: 'Infrastructure'` to the `DIAGRAM_TYPE_LABELS` `Record<DiagramType, string>` (label exactly `'Infrastructure'`).
    - Append a case-insensitive normalisation key to `DIAGRAM_TYPE_MAP` so legacy / loose-cased `diagram_type` strings normalise to `'Infrastructure'`. Mirror the casing convention of existing entries (e.g. lowercase keys mapping to canonical PascalCase value).
    - Touch nothing else in the file; preserve all existing entries verbatim.
  - [x] 1.2 Add 3 new `RELATIONSHIP_EDGE_TYPES` constants in `frontend/src/types/model.ts`
    - **File:** `frontend/src/types/model.ts` (~line 1418, the `RELATIONSHIP_EDGE_TYPES` constant-object location)
    - Append 3 new keys (preserve all existing keys verbatim):
      - `RESOURCE_SUBNET_HOSTING: 'RESOURCE_SUBNET_HOSTING'` — containment-only; constant exists for symmetry with `RELATIONSHIP_DEFINITIONS`. The engine NEVER enters an edge-draw path for this type (Groups 3 and 5 do not add a `createRelationshipEdge` case for it).
      - `DEPLOYMENT_UNIT_COMPUTE_RESOURCE: 'DEPLOYMENT_UNIT_COMPUTE_RESOURCE'` — required.
      - `LOAD_BALANCER_RESOURCE_ROUTE: 'LOAD_BALANCER_RESOURCE_ROUTE'` — required.
    - Constant values are SCREAMING_SNAKE_CASE strings exactly matching the keys.
  - [x] 1.3 Verify TS compiles and targeted test scope holds
    - From `frontend/`, run `npx tsc --noEmit`.
    - Expected: zero new errors. The new `DiagramType` union member is reachable but has no consumers yet — Groups 2-6 light up in turn. The 3 new `RELATIONSHIP_EDGE_TYPES` constants are pure additions; consumers are added in Groups 3 and 4.

**Acceptance Criteria:**
- `'Infrastructure'` is a member of the `DiagramType` union in `frontend/src/types/diagramType.ts`, present in `CREATABLE_DIAGRAM_TYPES`, has a `DIAGRAM_TYPE_LABELS['Infrastructure']` entry, and has a case-insensitive normalisation key in `DIAGRAM_TYPE_MAP`.
- `RESOURCE_SUBNET_HOSTING`, `DEPLOYMENT_UNIT_COMPUTE_RESOURCE`, and `LOAD_BALANCER_RESOURCE_ROUTE` are keys in `RELATIONSHIP_EDGE_TYPES` in `frontend/src/types/model.ts` (~line 1418), with SCREAMING_SNAKE_CASE string values matching their keys.
- All existing `DiagramType` values, `CREATABLE_DIAGRAM_TYPES` entries, `DIAGRAM_TYPE_LABELS` entries, `DIAGRAM_TYPE_MAP` entries, and `RELATIONSHIP_EDGE_TYPES` constants are preserved verbatim.
- `npx tsc --noEmit` passes with zero new errors.

---

### Palette + Colour + Dimension Layer

#### Task Group 2: Wire palette data, entity colours, and container default dimensions
**Dependencies:** Task Group 1

- [x] 2.0 Populate the palette wiring in `paletteData.ts` (12 entity sections + 3 relationship sections + diagram-type filter row + 12 entity-type-constant mappings), then append 12 new `entityColors` entries to `defaults.ts` and add default-dimension overrides for the 6 container-like types (per the implementer-time decision flagged above).
  - [x] 2.1 Replace `DOMAIN_ENTITY_SECTIONS.infrastructure: []` placeholder in `frontend/src/utils/paletteData.ts`
    - **File:** `frontend/src/utils/paletteData.ts` (~line 86)
    - Spec 3 left `infrastructure: []` as a placeholder. Replace with the 12 entity-section IDs in **containment-friendly order** (locked in spec.md ~line 20):
      `['environments', 'cloud_accounts', 'locations', 'networks', 'subnets', 'compute_clusters', 'compute_resources', 'deployment_units', 'load_balancers', 'listeners', 'data_store_instances', 'infrastructure_resources']`.
  - [x] 2.2 Replace `domainToPaletteSections.infrastructure: []` placeholder
    - **File:** `frontend/src/utils/paletteData.ts` (~line 147)
    - Replace with the 12 entity sections from 2.1 PLUS the 3 relationship sections in `RELATIONSHIP_TAB_ORDER` order (locked in spec 3): `'resource_subnet_hostings'`, `'deployment_unit_compute_resources'`, `'load_balancer_resource_routes'`.
    - Final array length: 15 entries.
  - [x] 2.3 Add `DIAGRAM_TYPE_PALETTE_RULES.Infrastructure` row
    - **File:** `frontend/src/utils/paletteData.ts` (the `DIAGRAM_TYPE_PALETTE_RULES` table)
    - Add a new row keyed by `'Infrastructure'` listing the same 12 entity + 3 relationship section IDs (15 entries total, same as 2.2). Mirror the structural shape of existing rows (e.g. `'ER'`, `'State'`, `'Activity'`).
  - [x] 2.4 Extend `entitySections` array literal with 12 new entries
    - **File:** `frontend/src/utils/paletteData.ts` (~line 351, the `entitySections` array literal)
    - Append 12 new entries, one per Infra entity type, mirroring the structural shape of existing entries: `{ id: 'environments', label: 'Environments', items: metaModel.entities.environments.map(e => ({ id: e.id, name: e.name })), type: 'entity' }` and the 11 analogous entries for `cloud_accounts`, `locations`, `networks`, `subnets`, `compute_clusters`, `compute_resources`, `deployment_units`, `load_balancers`, `listeners`, `data_store_instances`, `infrastructure_resources`.
    - Display labels match spec 4's `entityTabNames` strings: "Environments", "Cloud Accounts", "Locations", "Networks", "Subnets", "Compute Clusters", "Compute Resources", "Deployment Units", "Load Balancers", "Listeners", "Data Stores", "Infrastructure Resources".
  - [x] 2.5 Decide and act on relationship-section derivation (implementer-time decision #2)
    - **File:** `frontend/src/utils/paletteData.ts`
    - Inspect at write-time whether `paletteData.ts` derives relationship sections from `RELATIONSHIP_DEFINITIONS` (spec 3 already populated the 3 Infra entries) or whether 3 explicit entries must be appended to a `relationshipSections` array literal.
    - **(a) Auto-derivation in place:** no array edit required; verify by inspection that the 3 Infra `RELATIONSHIP_DEFINITIONS` entries surface naturally once 2.2 and 2.3 list their section IDs.
    - **(b) Explicit array literal:** append 3 new entries mapping `metaModel.entities.resource_subnet_hostings`, `deployment_unit_compute_resources`, `load_balancer_resource_routes` to `{id, label, items, type: 'relationship'}` shape, mirroring existing relationship entries.
    - Document the chosen path with a 1-line code comment if non-obvious.
  - [x] 2.6 Extend `getEntityTypeConstant` with 12 new section-ID-to-SCREAMING_SNAKE_CASE-constant mappings
    - **File:** `frontend/src/utils/paletteData.ts` (the `getEntityTypeConstant` function)
    - Add 12 new section-ID-to-constant mappings:
      - `'environments' -> 'ENVIRONMENT'`
      - `'cloud_accounts' -> 'CLOUD_ACCOUNT'`
      - `'locations' -> 'LOCATION'`
      - `'networks' -> 'NETWORK'`
      - `'subnets' -> 'SUBNET'`
      - `'compute_clusters' -> 'COMPUTE_CLUSTER'`
      - `'compute_resources' -> 'COMPUTE_RESOURCE'`
      - `'deployment_units' -> 'DEPLOYMENT_UNIT'`
      - `'load_balancers' -> 'LOAD_BALANCER'`
      - `'listeners' -> 'LISTENER'`
      - `'data_store_instances' -> 'DATA_STORE_INSTANCE'`
      - `'infrastructure_resources' -> 'INFRASTRUCTURE_RESOURCE'`
    - These constants exactly match `InfrastructurePointKind` discriminator values (spec 3) and the new `entityColors` keys (Task 2.7).
  - [x] 2.7 Append 12 new `entityColors` entries in `frontend/src/config/defaults.ts`
    - **File:** `frontend/src/config/defaults.ts` (~line 417, the `entityColors: Record<string, EntityColors>` map)
    - Append 12 new entries keyed by the SCREAMING_SNAKE_CASE constants from 2.6. Each entry: `{ background: '<hex>', border: '<hex>' }` with visually distinct hues following existing palette conventions.
    - Suggested hue families (implementer adjusts at write-time for visual harmony with existing palette):
      - `ENVIRONMENT` — slate / outermost-container shade.
      - `CLOUD_ACCOUNT` — slightly lighter slate or cool-grey.
      - `LOCATION` — sand / region neutral.
      - `NETWORK` — cool blue.
      - `SUBNET` — paler blue (subnet sits inside network).
      - `COMPUTE_CLUSTER` — warm yellow.
      - `COMPUTE_RESOURCE` — saturated yellow / amber.
      - `DEPLOYMENT_UNIT` — purple / package shade.
      - `LOAD_BALANCER` — green.
      - `LISTENER` — paler green / chartreuse.
      - `DATA_STORE_INSTANCE` — teal / database shade.
      - `INFRASTRUCTURE_RESOURCE` — neutral grey-blue (catch-all bucket).
    - **Do NOT** edit any existing `entityColors` entry. The lookup falls back to `#f5f5f5/#616161` for unknown types — this fallback is preserved.
  - [x] 2.8 Add default-dimension overrides for the 6 container-like types (implementer-time decision #1)
    - **6 container-like types:** `ENVIRONMENT`, `CLOUD_ACCOUNT`, `LOCATION`, `NETWORK`, `SUBNET`, `COMPUTE_CLUSTER`. Spec text mandates 320x200 default size (vs the 120x60 default).
    - **(a) Config-table option:** if `frontend/src/config/defaults.ts` has a `defaultNodeDimensions: Record<string, {width, height}>` (or similarly-named) lookup, append 6 new entries keyed by the SCREAMING_SNAKE_CASE constants, each `{ width: 320, height: 200 }`.
    - **(b) Inline-override option:** otherwise, in `frontend/src/utils/nodeCreation.ts` `createDiagramNodeFromEntity`, add a small `CONTAINER_TYPES = new Set(['ENVIRONMENT', 'CLOUD_ACCOUNT', 'LOCATION', 'NETWORK', 'SUBNET', 'COMPUTE_CLUSTER'])` constant and an `if (CONTAINER_TYPES.has(entity_type))` branch overriding `width = 320, height = 200` before the node is returned. The remaining 6 Infra entity types continue to use the existing `DEFAULT_NODE_WIDTH=120` / `DEFAULT_NODE_HEIGHT=60` defaults.
    - Document the chosen path with a 1-line code comment.
  - [x] 2.9 Verify TS compiles and palette data is reachable
    - From `frontend/`, run `npx tsc --noEmit`.
    - Expected: zero new errors. The 12 new `entityColors` keys, the populated `DOMAIN_ENTITY_SECTIONS.infrastructure`, the populated `domainToPaletteSections.infrastructure`, the new `DIAGRAM_TYPE_PALETTE_RULES.Infrastructure`, the 12 new `entitySections` entries, and the 12 new `getEntityTypeConstant` mappings all type-check against existing structures.
    - Spot-check: import `getPaletteSections` and call it with `(metaModel, '', 'infrastructure', 'Infrastructure')` mentally — does it return 15 sections (12 entity + 3 relationship)? Verify by inspection only (no runtime test).

**Acceptance Criteria:**
- `DOMAIN_ENTITY_SECTIONS.infrastructure` contains the 12 entity-section IDs in containment-friendly order.
- `domainToPaletteSections.infrastructure` contains the 12 entity sections + 3 relationship sections (15 total).
- `DIAGRAM_TYPE_PALETTE_RULES.Infrastructure` lists the same 15 section IDs.
- `entitySections` array literal has 12 new Infra entries; `relationshipSections` either auto-derives the 3 Infra entries from `RELATIONSHIP_DEFINITIONS` (path a) or has 3 new explicit entries (path b) — implementer's choice documented in code comment.
- `getEntityTypeConstant` resolves all 12 new section IDs to the matching SCREAMING_SNAKE_CASE constants.
- `entityColors` has 12 new entries keyed by the SCREAMING_SNAKE_CASE constants from `InfrastructurePointKind`. No existing `entityColors` entry is edited.
- The 6 container-like types (`ENVIRONMENT`, `CLOUD_ACCOUNT`, `LOCATION`, `NETWORK`, `SUBNET`, `COMPUTE_CLUSTER`) spawn at 320x200 (via either config table or `nodeCreation.ts` inline override — implementer's choice documented).
- The remaining 6 Infra entity types use the existing 120x60 default.
- `npx tsc --noEmit` passes with zero new errors.

---

### Edge Creation + Rendering Layer

#### Task Group 3: Add `createRelationshipEdge` cases, `getEdgeColor` entries, and `getRelationshipEdgeDefaults` arms
**Dependencies:** Task Group 1

- [x] 3.0 Add 2 new switch cases in `createRelationshipEdge` for the 2 edge-drawing relationships (DASHED no-arrow + "runs on" label; SOLID + ARROW + `protocol target_port` label). Add corresponding `relationshipColors` palette entries and 2 new switch arms in `getRelationshipEdgeDefaults`. NO case is added for `RESOURCE_SUBNET_HOSTING` — the engine never enters an edge-draw path for it.
  - [x] 3.1 Add `DEPLOYMENT_UNIT_COMPUTE_RESOURCE` case in `createRelationshipEdge`
    - **File:** `frontend/src/utils/relationshipUtils.ts` (~line 874, the `createRelationshipEdge` switch on `relationshipEdgeType`)
    - **Template:** the existing `APP_POINT_BUSINESS_POINT` case (~line 899) — closest line-style precedent (V1 wants DASHED + no-arrow rather than the existing case's exact styling, so adapt accordingly).
    - **Edge styling:** `line_type: 'DASHED'`, `arrow_end: 'NONE'`, label = the relationship row's `version` field if non-empty, else the static string `"runs on"`.
    - **Label position:** midpoint via existing `calculateMidpointLabelPosition`.
  - [x] 3.2 Add `LOAD_BALANCER_RESOURCE_ROUTE` case in `createRelationshipEdge`
    - **File:** `frontend/src/utils/relationshipUtils.ts` (~line 874, same switch)
    - **Template:** the existing `DATA_MOVEMENT` case (~line 929) — direct precedent for SOLID + ARROW + label-from-fields.
    - **Edge styling:** `line_type: 'SOLID'`, `arrow_end: 'ARROW'`, label = `${protocol} ${target_port}` (e.g. `"HTTPS 443"`). Read `protocol` and `target_port` from the relationship row.
    - **Label position:** midpoint via `calculateMidpointLabelPosition`.
  - [x] 3.3 Do NOT add a `RESOURCE_SUBNET_HOSTING` case
    - **Verification only:** containment-only relationship; the engine never enters the edge-draw path. The `RELATIONSHIP_EDGE_TYPES` constant from Task 1.2 exists for symmetry with `RELATIONSHIP_DEFINITIONS` only.
  - [x] 3.4 Add `relationshipColors` entries in `frontend/src/utils/rendering.ts`
    - **File:** `frontend/src/utils/rendering.ts` (`relationshipColors` lookup used by `getEdgeColor` ~line 436)
    - Add 2 entries (or 3 for symmetry — implementer's call):
      - `DEPLOYMENT_UNIT_COMPUTE_RESOURCE: '<hex>'` — pick a colour consistent with the new entity palette (e.g. dashed-grey or compute-yellow tint).
      - `LOAD_BALANCER_RESOURCE_ROUTE: '<hex>'` — pick a colour consistent with the LOAD_BALANCER green family.
      - `RESOURCE_SUBNET_HOSTING` — optional; will never be looked up since no edge is drawn, but adding a placeholder colour costs nothing and keeps the lookup symmetric.
    - The fallback `#616161` is preserved for unknown types.
  - [x] 3.5 Add 2 new `getRelationshipEdgeDefaults` switch arms
    - **File:** `frontend/src/utils/rendering.ts` (~line 447, the `getRelationshipEdgeDefaults` switch)
    - Add arm for `DEPLOYMENT_UNIT_COMPUTE_RESOURCE` returning V1 styling (DASHED line, no arrow, label `"runs on"` default).
    - Add arm for `LOAD_BALANCER_RESOURCE_ROUTE` returning V1 styling (SOLID line, ARROW at target, label `protocol target_port` template default).
    - Do NOT add an arm for `RESOURCE_SUBNET_HOSTING` (no edge drawn).
  - [x] 3.6 Verify TS compiles
    - From `frontend/`, run `npx tsc --noEmit`.
    - Expected: zero new errors. The 2 new `createRelationshipEdge` cases reach the new `RELATIONSHIP_EDGE_TYPES` constants from 1.2; `relationshipColors` entries and `getRelationshipEdgeDefaults` arms type-check against the existing return shape.

**Acceptance Criteria:**
- `createRelationshipEdge` has a `DEPLOYMENT_UNIT_COMPUTE_RESOURCE` case returning DASHED + no-arrow styling with label resolving to relationship row's `version` if non-empty else `"runs on"`.
- `createRelationshipEdge` has a `LOAD_BALANCER_RESOURCE_ROUTE` case returning SOLID + ARROW styling with label `${protocol} ${target_port}`, positioned at midpoint via `calculateMidpointLabelPosition`.
- `createRelationshipEdge` has NO `RESOURCE_SUBNET_HOSTING` case (containment-only).
- `relationshipColors` has entries for the 2 (or 3) new edge types with colours consistent with the new entity palette.
- `getRelationshipEdgeDefaults` has 2 new switch arms returning the V1 styling per the rules above.
- All existing `createRelationshipEdge` cases, `relationshipColors` entries, and `getRelationshipEdgeDefaults` arms are preserved verbatim.
- `npx tsc --noEmit` passes with zero new errors.

---

### Polymorphic Point Resolution Layer

#### Task Group 4: Extend `getEntitiesOnDiagram` and add 3 `isRelationshipRowEnabled` arms
**Dependencies:** Task Groups 1, 2, 3

- [x] 4.0 Extend `getEntitiesOnDiagram` with `infrastructurePointsOnDiagram: Set<string>` (mirroring the existing `application_points` block) and add 3 new switch arms in `isRelationshipRowEnabled` for the 3 Infra relationship-type keys, each honouring the locked `allowedKinds` from spec 4.
  - [x] 4.1 Extend `getEntitiesOnDiagram` with `infrastructurePointsOnDiagram` field
    - **File:** `frontend/src/utils/relationshipUtils.ts` (~line 94, the `getEntitiesOnDiagram(metaModel, diagram)` function)
    - **Template:** the existing `application_points` block (~lines 130-160) — direct precedent for polymorphic-point Set construction (BUSINESS_POINT pattern).
    - Add a new field `infrastructurePointsOnDiagram: Set<string>` to the function's return shape and the result object.
    - **Population logic:** iterate each on-canvas concrete-entity node (only those whose `entity_type` is one of the 12 SCREAMING_SNAKE_CASE Infra constants from Task 2.6: `ENVIRONMENT`, `CLOUD_ACCOUNT`, `LOCATION`, `NETWORK`, `SUBNET`, `COMPUTE_CLUSTER`, `COMPUTE_RESOURCE`, `DEPLOYMENT_UNIT`, `LOAD_BALANCER`, `LISTENER`, `DATA_STORE_INSTANCE`, `INFRASTRUCTURE_RESOURCE`). For each, look up `metaModel.entities.infrastructure_points` for the row whose typed FK column (`environment_id`, `cloud_account_id`, `location_id`, `network_id`, `subnet_id`, `compute_cluster_id`, `compute_resource_id`, `deployment_unit_id`, `load_balancer_id`, `listener_id`, `data_store_instance_id`, `infrastructure_resource_id`) matches the node's `entity_id`. Add the matched `infrastructure_points.id` to the Set.
    - **Critical:** NO `INFRASTRUCTURE_POINT` nodes are ever drawn on the canvas — concrete entity nodes only (locked Q4). The Set is plumbing-only at edge-eligibility time.
    - **Honour locked snake_case JSON keys:** typed FK column names are exactly as listed; do NOT camelCase them.
  - [x] 4.2 Add `'resource_subnet_hostings'` arm in `isRelationshipRowEnabled`
    - **File:** `frontend/src/utils/relationshipUtils.ts` (~line 329, the `isRelationshipRowEnabled` switch)
    - **Enabled iff:** the row's `subnet_id` resolves to an on-canvas Subnet node AND the row's `infrastructure_point_id` resolves (via the new `infrastructurePointsOnDiagram` Set from 4.1) to an on-canvas concrete-entity node.
    - **`allowedKinds` enforcement:** honour the locked `allowedKinds: ['COMPUTE_RESOURCE', 'DATA_STORE_INSTANCE', 'LOAD_BALANCER', 'INFRASTRUCTURE_RESOURCE']` from spec 4. Resolve the polymorphic point to its concrete `point_kind` before deciding eligibility.
    - **Locked snake_case FK names** per spec 1/4: `subnet_id`, `infrastructure_point_id`.
  - [x] 4.3 Add `'deployment_unit_compute_resources'` arm in `isRelationshipRowEnabled`
    - **Enabled iff:** the row's `deployment_unit_id` resolves to an on-canvas Deployment Unit node AND the row's `compute_infrastructure_point_id` resolves (via `infrastructurePointsOnDiagram`) to an on-canvas concrete-entity node.
    - **`allowedKinds` enforcement:** honour the locked `allowedKinds: ['COMPUTE_RESOURCE', 'COMPUTE_CLUSTER']` from spec 4.
    - **Locked snake_case FK names:** `deployment_unit_id`, `compute_infrastructure_point_id`.
  - [x] 4.4 Add `'load_balancer_resource_routes'` arm in `isRelationshipRowEnabled`
    - **Enabled iff:** the row's `load_balancer_id` resolves to an on-canvas Load Balancer node AND the row's `target_infrastructure_point_id` resolves (via `infrastructurePointsOnDiagram`) to an on-canvas concrete-entity node.
    - **`allowedKinds` enforcement:** honour the locked `allowedKinds: ['COMPUTE_RESOURCE', 'COMPUTE_CLUSTER', 'DATA_STORE_INSTANCE', 'INFRASTRUCTURE_RESOURCE']` from spec 4.
    - **Locked snake_case FK names:** `load_balancer_id`, `target_infrastructure_point_id`.
  - [x] 4.5 Verify TS compiles
    - From `frontend/`, run `npx tsc --noEmit`.
    - Expected: zero new errors. The new `infrastructurePointsOnDiagram` field type-checks against the existing `getEntitiesOnDiagram` return shape; the 3 new `isRelationshipRowEnabled` arms type-check against the existing return type (likely `'enabled' | 'endpoints_missing' | ...`).

**Acceptance Criteria:**
- `getEntitiesOnDiagram` returns an `infrastructurePointsOnDiagram: Set<string>` field, populated by mirroring the existing `application_points` block over the 12 typed FK columns of `metaModel.entities.infrastructure_points`.
- NO `INFRASTRUCTURE_POINT` node-rendering code is added (concrete-entity nodes only — Q4).
- `isRelationshipRowEnabled` has 3 new arms for `'resource_subnet_hostings'`, `'deployment_unit_compute_resources'`, `'load_balancer_resource_routes'`, each:
  - using `infrastructurePointsOnDiagram` for polymorphic resolution,
  - honouring the locked `allowedKinds` array per relationship,
  - using the locked snake_case FK names from spec 1/4 (`infrastructure_point_id`, `compute_infrastructure_point_id`, `target_infrastructure_point_id`).
- All existing `getEntitiesOnDiagram` fields and `isRelationshipRowEnabled` arms are preserved verbatim.
- `npx tsc --noEmit` passes with zero new errors.

---

### Containment Plumbing Layer

#### Task Group 5: Wire `resource_subnet_hostings` containment via `parent_node_id`
**Dependencies:** Task Group 4

- [x] 5.0 When a `resource_subnet_hostings` row is added (palette click) and BOTH the resolved concrete resource node and the target Subnet node are on the canvas, set the resource node's `parent_node_id` to the Subnet node's id. NO `DiagramEdge` is created for this relationship type. The existing `compoundLayout.ts` parent-with-children sizing handles the Subnet container resize automatically.
  - [x] 5.1 Locate the post-add hook in the relationship-add path
    - **Primary suspect:** `frontend/src/components/DiagramsView/PalettePanel.tsx` `handleItemClick` (~line 1674) — single click-to-add entry point. Existing inline auto-parent-wrapping for known parent/child pairs (`APPLICATION` -> `APP_COMPONENT`, `BUSINESS_PROCESS` -> `PROCESS_ACTIVITY`, `INTERFACE` -> `ENDPOINT`) is the direct pattern to mirror.
    - **Fallback:** if relationship-add dispatches through `nodeCreation.ts` or a centralised sync helper, locate the analogous post-add hook there. Implementer locates at write-time.
    - Document the chosen location in a 1-line code comment when the change lands.
  - [x] 5.2 Implement the containment plumbing for `resource_subnet_hostings`
    - **Trigger:** when the user clicks a `resource_subnet_hostings` row in the palette (relationship-section, click-to-add path).
    - **Resolution sequence:**
      1. Resolve the row's `infrastructure_point_id` to the matching `infrastructure_points` row.
      2. Resolve the `infrastructure_points` row to its concrete-entity (one of `compute_resources`, `data_store_instances`, `load_balancers`, `infrastructure_resources` per the locked `allowedKinds`) via the typed FK on the row (e.g. `compute_resource_id`).
      3. Look up the on-canvas `DiagramNode` whose `entity_type` is the matching SCREAMING_SNAKE_CASE constant AND whose `entity_id` equals the concrete-entity's id.
      4. Look up the on-canvas Subnet `DiagramNode` whose `entity_id` equals the row's `subnet_id`.
    - **Guard:** if EITHER lookup fails (resource node not on canvas, or Subnet not on canvas), no-op. The relationship row exists in the model but the diagram is unchanged.
    - **Action when both resolve:** set the resource node's `parent_node_id` to the Subnet node's id. The existing compound-layout code resizes the Subnet container automatically.
    - **Crucially:** NO `DiagramEdge` is created for this relationship type. NO call to `createRelationshipEdge` for `RESOURCE_SUBNET_HOSTING`.
    - **Out of scope:** do NOT auto-create containment for pre-existing rows on diagram open (locked Q10 — opt-in via user palette click only). Do NOT re-derive on every render; this is a one-shot post-add hook.
  - [x] 5.3 Verify TS compiles
    - From `frontend/`, run `npx tsc --noEmit`.
    - Expected: zero new errors. The handler reaches the existing `DiagramNode.parent_node_id` setter and reads `metaModel.entities.infrastructure_points`, both pre-existing surfaces.

**Acceptance Criteria:**
- When a user clicks a `resource_subnet_hostings` palette row AND both the resolved concrete resource node and the target Subnet node are on the canvas, the resource node's `parent_node_id` is set to the Subnet node's id.
- When EITHER lookup fails, the action is a no-op (no error, no partial state).
- NO `DiagramEdge` is created for `RESOURCE_SUBNET_HOSTING` in any code path.
- The handler is wired in a single post-add hook (PalettePanel `handleItemClick` or analogous helper) — NOT re-derived on every render.
- Pre-existing rows on diagram open are NOT auto-converted (out of scope).
- `npx tsc --noEmit` passes with zero new errors.

---

### SelectionInspector Layer

#### Task Group 6: Add 12 minimal entity arms + 3 minimal relationship-edge arms
**Dependencies:** Task Group 1

- [x] 6.0 Add 12 minimal entity arms in `SelectionInspector.tsx` (each showing editable `name` + `description` only, mirroring the existing `LOGICAL_DATA_ENTITY` arm) and 3 minimal relationship-edge arms (each showing editable `description` + `tags` only, mirroring existing relationship arms like `STATE_TRANSITION` / `ACTIVITY_FLOW`). Edits flow through the existing entity / relationship update dispatch — no new save plumbing.
  - [x] 6.1 Add 12 entity arms in `frontend/src/components/DiagramsView/SelectionInspector.tsx`
    - **File:** `frontend/src/components/DiagramsView/SelectionInspector.tsx`
    - **Template:** the existing `LOGICAL_DATA_ENTITY` arm — minimal precedent (just `name` + `description`).
    - **The 12 entity arms** (one per Infra entity type), each branching on `entity_type`:
      - `'ENVIRONMENT'` -> `name` + `description`
      - `'CLOUD_ACCOUNT'` -> `name` + `description`
      - `'LOCATION'` -> `name` + `description`
      - `'NETWORK'` -> `name` + `description`
      - `'SUBNET'` -> `name` + `description`
      - `'COMPUTE_CLUSTER'` -> `name` + `description`
      - `'COMPUTE_RESOURCE'` -> `name` + `description`
      - `'DEPLOYMENT_UNIT'` -> `name` + `description`
      - `'LOAD_BALANCER'` -> `name` + `description`
      - `'LISTENER'` -> `name` + `description`
      - `'DATA_STORE_INSTANCE'` -> `name` + `description`
      - `'INFRASTRUCTURE_RESOURCE'` -> `name` + `description`
    - **Implementation note:** if the existing arms are individual `case` blocks, add 12 new `case` blocks. If multiple entity types share a single arm, consolidate the 12 into one shared block dispatched on a `Set` membership check (implementer's call — match the local convention).
    - **Edits flow** through the existing entity update dispatch — the same dispatch the `LOGICAL_DATA_ENTITY` arm uses. NO new save plumbing.
    - Do NOT cover the remaining ~150 fields per entity — power users edit those in the Tables UI from spec 4.
  - [x] 6.2 Add 3 relationship-edge arms
    - **Templates:** the existing `STATE_TRANSITION` and `ACTIVITY_FLOW` arms — minimal-relationship precedents (typically `description` + `tags`).
    - **The 3 relationship-edge arms** (one per Infra relationship type), each branching on `relationship_type`:
      - `'resource_subnet_hostings'` -> `description` + `tags`
      - `'deployment_unit_compute_resources'` -> `description` + `tags`
      - `'load_balancer_resource_routes'` -> `description` + `tags`
    - **Note:** even though `resource_subnet_hostings` is rendered as containment (no `DiagramEdge` drawn), the relationship row still surfaces in the inspector when a containment relationship is selected via the model-side selection path. Add the arm for completeness; if the engine's selection flow never reaches this branch for `resource_subnet_hostings`, the arm is harmless.
    - **Edits flow** through the existing relationship update dispatch.
    - Do NOT add `name`, `valid_from`, `valid_to` fields (relationships have no `name` per spec 4); edit only `description` + `tags`.
  - [x] 6.3 Verify TS compiles
    - From `frontend/`, run `npx tsc --noEmit`.
    - Expected: zero new errors. The 12 new entity arms and 3 new relationship-edge arms type-check against the existing `entity_type` / `relationship_type` discriminants, the existing `name` / `description` / `tags` field shapes from spec 3, and the existing entity / relationship update dispatch.

**Acceptance Criteria:**
- `SelectionInspector.tsx` has 12 new entity arms, one per Infra entity type, each rendering editable `name` + `description` only.
- `SelectionInspector.tsx` has 3 new relationship-edge arms, one per Infra relationship type, each rendering editable `description` + `tags` only.
- All edits flow through the existing entity / relationship update dispatch — no new save plumbing.
- All existing `SelectionInspector` arms are preserved verbatim.
- No remaining ~150 fields are added (power users edit those in spec 4's Tables UI).
- `npx tsc --noEmit` passes with zero new errors.

---

### Verification Layer

#### Task Group 7: Vitest config test + final TS + Vitest sweep
**Dependencies:** Task Groups 1-6

- [x] 7.0 Add the single Vitest config test asserting all 5 wiring contracts from spec.md ~line 71 are met (`'Infrastructure'` registered in `DiagramType` / `CREATABLE_DIAGRAM_TYPES` / `DIAGRAM_TYPE_LABELS`; `DOMAIN_ENTITY_SECTIONS.infrastructure` and `domainToPaletteSections.infrastructure` and `DIAGRAM_TYPE_PALETTE_RULES.Infrastructure` populated; all 12 SCREAMING_SNAKE_CASE Infra entity-type keys exist in `entityColors`; the 3 new `RELATIONSHIP_EDGE_TYPES` constants exist). Run the final `npx tsc --noEmit` and Vitest sweep to confirm zero new failures.
  - [x] 7.1 Write 5 focused tests for the new infrastructure diagram config
    - **File:** `frontend/src/config/__tests__/infrastructureDiagramConfig.test.ts` (NEW)
    - **Template:** `frontend/src/config/__tests__/infrastructureTablesConfig.test.ts` from spec 4 — Vitest convention, `describe` block per concern, `expect(...).toContain(...)`.
    - Limit to 5 tests covering only the spec-mandated wiring contracts (no renderer tests, no interaction tests, no save-roundtrip tests, no inspector-component tests):
      1. **Test 1 — `'Infrastructure'` is registered in the `DiagramType` system:** assert `'Infrastructure'` is in `CREATABLE_DIAGRAM_TYPES`, `DIAGRAM_TYPE_LABELS['Infrastructure']` is defined (string), and `DIAGRAM_TYPE_MAP` normalises a lowercase / mixed-case input to `'Infrastructure'`. (Runtime check on `DIAGRAM_TYPE_LABELS` doubles as a presence check on the union member.)
      2. **Test 2 — `DOMAIN_ENTITY_SECTIONS.infrastructure` contains the 12 entity-section IDs in containment-friendly order:** assert the array length is 12 and contains each of `'environments'`, `'cloud_accounts'`, `'locations'`, `'networks'`, `'subnets'`, `'compute_clusters'`, `'compute_resources'`, `'deployment_units'`, `'load_balancers'`, `'listeners'`, `'data_store_instances'`, `'infrastructure_resources'`.
      3. **Test 3 — `domainToPaletteSections.infrastructure` and `DIAGRAM_TYPE_PALETTE_RULES.Infrastructure` both contain the 12 entity + 3 relationship section IDs:** for each of the two structures, assert the 15 section IDs are present (12 from Test 2 + the 3 relationship section IDs `'resource_subnet_hostings'`, `'deployment_unit_compute_resources'`, `'load_balancer_resource_routes'`).
      4. **Test 4 — All 12 SCREAMING_SNAKE_CASE Infra entity-type keys exist in `entityColors`:** iterate the 12 keys (`'ENVIRONMENT'`, `'CLOUD_ACCOUNT'`, `'LOCATION'`, `'NETWORK'`, `'SUBNET'`, `'COMPUTE_CLUSTER'`, `'COMPUTE_RESOURCE'`, `'DEPLOYMENT_UNIT'`, `'LOAD_BALANCER'`, `'LISTENER'`, `'DATA_STORE_INSTANCE'`, `'INFRASTRUCTURE_RESOURCE'`) and assert each has a `{background, border}` entry in `entityColors` with both fields as strings starting with `'#'`.
      5. **Test 5 — The 3 new `RELATIONSHIP_EDGE_TYPES` constants exist:** assert `RELATIONSHIP_EDGE_TYPES.RESOURCE_SUBNET_HOSTING`, `RELATIONSHIP_EDGE_TYPES.DEPLOYMENT_UNIT_COMPUTE_RESOURCE`, and `RELATIONSHIP_EDGE_TYPES.LOAD_BALANCER_RESOURCE_ROUTE` are all defined and equal their SCREAMING_SNAKE_CASE string values.
    - **Imports:** `CREATABLE_DIAGRAM_TYPES`, `DIAGRAM_TYPE_LABELS`, `DIAGRAM_TYPE_MAP` from `../../types/diagramType`; `DOMAIN_ENTITY_SECTIONS`, `domainToPaletteSections`, `DIAGRAM_TYPE_PALETTE_RULES` from `../../utils/paletteData`; `entityColors` from `../defaults`; `RELATIONSHIP_EDGE_TYPES` from `../../types/model`.
    - **Out of scope for tests:** no renderer/interaction tests, no save-roundtrip tests, no `SelectionInspector` component tests, no containment-plumbing integration tests, no `getEntitiesOnDiagram` polymorphic-resolution tests.
  - [x] 7.2 Run the new Vitest config test and confirm it passes
    - From `frontend/`, run only the new test file: e.g. `npx vitest run src/config/__tests__/infrastructureDiagramConfig.test.ts`.
    - Expected: 5 passing tests. Do **NOT** run the entire test suite at this stage.
  - [x] 7.3 Run `npx tsc --noEmit` for the full frontend
    - From `frontend/`, run `npx tsc --noEmit`.
    - Expected: zero new errors. Any remaining errors must already exist on `master` and not have been introduced by this spec.
  - [x] 7.4 Run the existing Vitest sweep and confirm zero new failures
    - From `frontend/`, run the full Vitest suite (e.g. `npx vitest run`).
    - Expected outcome: the only failures are the pre-existing failing tests already documented in the project memory:
      - `bootstrap-summary-fetching.test.ts` (1 fail)
      - `conversation-memory-edge-cases.test.ts`
      - `dashboardSummary*.test.ts`
      - `hub-bootstrap-4-task-definition.test.ts` (2 fails)
      - `chatV2-panel-integration.test.ts` (3 fails)
      - `chatV2-panel-context-and-filtering.test.ts` (1 fail)
    - **Newly passing:** `infrastructureDiagramConfig.test.ts` (5 tests).
    - **No** new failures introduced by this spec; **no** previously-passing tests now failing.
    - **DO NOT** modify or attempt to fix any pre-existing failing test.
  - [x] 7.5 Confirm scope discipline
    - **Verification only:** confirm edits only touched the 7-9 files in scope:
      1. `frontend/src/types/diagramType.ts` (modified — Group 1.1)
      2. `frontend/src/types/model.ts` (modified — Group 1.2)
      3. `frontend/src/utils/paletteData.ts` (modified — Group 2.1-2.6)
      4. `frontend/src/config/defaults.ts` (modified — Group 2.7, optional 2.8a)
      5. `frontend/src/utils/nodeCreation.ts` (optionally modified — Group 2.8b)
      6. `frontend/src/utils/relationshipUtils.ts` (modified — Groups 3.1-3.3, 4.1-4.4)
      7. `frontend/src/utils/rendering.ts` (modified — Groups 3.4-3.5)
      8. `frontend/src/components/DiagramsView/PalettePanel.tsx` (or analogous post-add hook — modified, Group 5.1-5.2)
      9. `frontend/src/components/DiagramsView/SelectionInspector.tsx` (modified — Group 6.1-6.2)
      10. `frontend/src/config/__tests__/infrastructureDiagramConfig.test.ts` (created — Group 7.1)
    - Confirm no edits to `frontend/src/types/architectureDomain.ts`, `frontend/src/config/relationshipDefinitions.ts`, `frontend/src/api/modelSerialization.ts`, `frontend/src/config/gridConfigs.ts`, `frontend/src/components/Grid/InfrastructurePointPickerCell.tsx`, `frontend/src/utils/infrastructurePointDerivation.ts`, `frontend/src/components/DiagramsView/Canvas.tsx`, or any backend/gateway/MCP/discovery code.
    - Confirm no new shape primitives were added to `shapeRendering.ts` (per spec — provider-neutral, no new SVG paths).
    - Confirm no `INFRASTRUCTURE_POINT` rendering code was added (concrete-entity nodes only).
    - Confirm `DiagramEdge` was NOT created for `RESOURCE_SUBNET_HOSTING` in any code path.

**Acceptance Criteria:**
- `frontend/src/config/__tests__/infrastructureDiagramConfig.test.ts` exists with exactly 5 focused tests covering: (a) `'Infrastructure'` registered in `DiagramType` system, (b) `DOMAIN_ENTITY_SECTIONS.infrastructure` 12 entries, (c) `domainToPaletteSections.infrastructure` and `DIAGRAM_TYPE_PALETTE_RULES.Infrastructure` 15 entries each, (d) 12 SCREAMING_SNAKE_CASE Infra keys in `entityColors`, (e) 3 new `RELATIONSHIP_EDGE_TYPES` constants exist.
- All 5 new tests pass.
- `npx tsc --noEmit` is clean (zero new errors).
- Vitest sweep shows: 5 newly-passing tests (`infrastructureDiagramConfig.test.ts`) + identical pre-existing failure inventory + zero regressions.
- Exactly 7-9 frontend files touched (1 created, 6-8 modified — `nodeCreation.ts` only if implementer chose path 2.8b).
- No edits to spec-3-owned files, spec-4-owned files, `Canvas.tsx`, `shapeRendering.ts`, or any backend/gateway/MCP/discovery code.
- No `INFRASTRUCTURE_POINT` rendering code, no new shape primitives, no `DiagramEdge` for `RESOURCE_SUBNET_HOSTING`.

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Type registrations** — extend `DiagramType` union and add 3 new `RELATIONSHIP_EDGE_TYPES` constants. Foundation for every subsequent group.
2. **Task Group 2: Palette + colour + dimension wiring** — depends on Group 1's `DiagramType` for `DIAGRAM_TYPE_PALETTE_RULES.Infrastructure`. Implementer-time decision #1 (dimensions: config table vs `nodeCreation.ts` inline) lands here.
3. **Task Group 3: Edge creation + rendering** — depends on Group 1's `RELATIONSHIP_EDGE_TYPES` constants. Independent of Group 2; could run in parallel with Group 2 in practice.
4. **Task Group 4: Polymorphic point resolution** — depends on Group 1 (for the new constants used in `isRelationshipRowEnabled` arm dispatch via the relationship-type string keys), Group 2 (for the SCREAMING_SNAKE_CASE entity-type constants used in `getEntitiesOnDiagram`'s typed-FK lookup logic), and Group 3 (for the relationship-edge constants the row-enable arms reference).
5. **Task Group 5: Containment plumbing** — depends on Group 4 (uses `infrastructurePointsOnDiagram` resolution chain). Single post-add hook in PalettePanel `handleItemClick` (or analogous helper).
6. **Task Group 6: SelectionInspector** — depends only on Group 1's `DiagramType` registration; pure UI arms. Could run in parallel with Groups 2-5 in practice.
7. **Task Group 7: Verification** — single Vitest config test (5 tests), final `tsc --noEmit`, full Vitest sweep, scope discipline check.

Group 1 must run first. Groups 2 and 3 can run in parallel after Group 1. Group 4 depends on 1+2+3. Group 5 depends on Group 4. Group 6 can run in parallel with Groups 2-5 after Group 1 lands. Group 7 must run last.

---

## File Summary

### Files to Modify (6-8)
1. `frontend/src/types/diagramType.ts` — `DiagramType` union extended with `'Infrastructure'`; entries added to `CREATABLE_DIAGRAM_TYPES`, `DIAGRAM_TYPE_LABELS`, `DIAGRAM_TYPE_MAP`.
2. `frontend/src/types/model.ts` — 3 new `RELATIONSHIP_EDGE_TYPES` constants (`RESOURCE_SUBNET_HOSTING`, `DEPLOYMENT_UNIT_COMPUTE_RESOURCE`, `LOAD_BALANCER_RESOURCE_ROUTE`).
3. `frontend/src/utils/paletteData.ts` — `DOMAIN_ENTITY_SECTIONS.infrastructure` (12 entries), `domainToPaletteSections.infrastructure` (15 entries), `DIAGRAM_TYPE_PALETTE_RULES.Infrastructure` (15 entries), `entitySections` (12 new entries), `getEntityTypeConstant` (12 new mappings); optionally `relationshipSections` (3 new entries) if not auto-derived.
4. `frontend/src/config/defaults.ts` — 12 new `entityColors` entries; optionally 6 default-dimension overrides if a config table exists (decision 2.8a).
5. `frontend/src/utils/nodeCreation.ts` — optionally 6 inline default-dimension overrides if no config table exists (decision 2.8b).
6. `frontend/src/utils/relationshipUtils.ts` — 2 new `createRelationshipEdge` cases; 3 new `isRelationshipRowEnabled` arms; `infrastructurePointsOnDiagram: Set<string>` field added to `getEntitiesOnDiagram`.
7. `frontend/src/utils/rendering.ts` — 2-3 entries in `relationshipColors`; 2 new `getRelationshipEdgeDefaults` switch arms.
8. `frontend/src/components/DiagramsView/PalettePanel.tsx` (or analogous post-add hook) — containment plumbing for `resource_subnet_hostings`.
9. `frontend/src/components/DiagramsView/SelectionInspector.tsx` — 12 minimal entity arms; 3 minimal relationship-edge arms.

### Files to Create (1)
10. `frontend/src/config/__tests__/infrastructureDiagramConfig.test.ts` — Vitest config test (5 tests) modelled on `infrastructureTablesConfig.test.ts`.

### Files NOT to Touch
- `frontend/src/types/architectureDomain.ts` — done by spec 3.
- `frontend/src/config/relationshipDefinitions.ts` — done by spec 3.
- `frontend/src/api/modelSerialization.ts` — done by spec 3 (round-trip already wired).
- `frontend/src/config/gridConfigs.ts` — done by spec 4.
- `frontend/src/components/Grid/InfrastructurePointPickerCell.tsx` — done by spec 4.
- `frontend/src/utils/infrastructurePointDerivation.ts` — done by spec 4.
- `frontend/src/utils/formatters.ts` — done by spec 4 (`infrastructurePointDisplayFormatter` already there).
- `frontend/src/components/DiagramsView/Canvas.tsx` — domain-agnostic; renders via `entityColors` lookup, no per-domain edits needed.
- `frontend/src/utils/shapeRendering.ts` — provider-neutral mandate, no new shape primitives.
- `frontend/src/utils/compoundLayout.ts` — already supports any `parent_node_id` chain; no new layout code needed.
- Any backend, gateway, MCP, discovery, Terraform, save-pipeline, or test fixture beyond the new config test.

---

## Reference Patterns

### Existing Code to Follow

- **`paletteData.ts` `entitySections` array literal** (~line 351) — direct structural template for the 12 new Infra entries; mirror existing entries' `{id, label, items, type: 'entity'}` shape.

- **`paletteData.ts` `getEntityTypeConstant`** — direct template for the 12 new section-ID-to-SCREAMING_SNAKE_CASE-constant mappings.

- **`PalettePanel.handleItemClick`** (`frontend/src/components/DiagramsView/PalettePanel.tsx:1674`) — single click-to-add entry point. Existing inline auto-parent-wrapping for `APPLICATION` -> `APP_COMPONENT`, `BUSINESS_PROCESS` -> `PROCESS_ACTIVITY`, `INTERFACE` -> `ENDPOINT` is the direct pattern for the new `resource_subnet_hostings` containment plumbing (Group 5).

- **`relationshipUtils.ts` `DATA_MOVEMENT` case** (~line 929) — direct template for `LOAD_BALANCER_RESOURCE_ROUTE` (SOLID + ARROW + label-from-fields).

- **`relationshipUtils.ts` `APP_POINT_BUSINESS_POINT` case** (~line 899) — closest line-style template for `DEPLOYMENT_UNIT_COMPUTE_RESOURCE` (V1 wants DASHED + no-arrow + label `"runs on"`; mirror the line-style structure but adapt the styling values).

- **`relationshipUtils.ts` `getEntitiesOnDiagram` `application_points` block** (~lines 130-160) — direct template for the new `infrastructurePointsOnDiagram` Set construction. BUSINESS_POINT polymorphic-resolution precedent. Extend with the 12 typed FK columns.

- **`SelectionInspector.tsx` `LOGICAL_DATA_ENTITY` arm** — minimal-inspector template (just `name` + `description`) for all 12 new Infra entity arms.

- **`SelectionInspector.tsx` `STATE_TRANSITION` / `ACTIVITY_FLOW` arms** — minimal-relationship template (typically `description` + `tags`) for the 3 new relationship-edge arms.

- **APPLICATION -> APP_COMPONENT containment auto-resize** — directly analogous template for any Infra parent/child chain via `parent_node_id`.

- **`infrastructureTablesConfig.test.ts`** (spec 4) — Vitest pattern for the new `infrastructureDiagramConfig.test.ts`.

### Key Decisions to Honour

- **Single `'Infrastructure'` `DiagramType`** — NOT split into Network/Compute sub-types (Q1).
- **Pure cosmetic split for container vs node** — bigger default size + colour for the 6 container-like types; NO new SVG paths, NO new shape primitives (Q2).
- **Hybrid edge/containment per relationship:** `resource_subnet_hostings` containment-only (no edge); `deployment_unit_compute_resources` and `load_balancer_resource_routes` are edges (Q3).
- **Polymorphic InfrastructurePoint endpoints are plumbing-only** — concrete-entity nodes are drawn on the canvas; NO `INFRASTRUCTURE_POINT` nodes ever drawn (Q4).
- **Minimal SelectionInspector** — `name` + `description` for entities, `description` + `tags` for relationships; ~150 fields stay in Tables UI (Q5).
- **Click-to-add only, NO canvas draw mode** — palette lists existing relationships from Tables UI; no source-then-target draw UX (Q6).
- **Edge styling is locked per Q7** — DASHED no-arrow + `"runs on"` (or `version`) for `deployment_unit_compute_resources`; SOLID + ARROW + `${protocol} ${target_port}` for `load_balancer_resource_routes`.
- **No auto-layout** — spawn at `(100, 100)`, manual drag thereafter (Q8).
- **Locked snake_case JSON keys** per spec 1/4: `infrastructure_point_id`, `target_infrastructure_point_id`, `compute_infrastructure_point_id`. Polymorphic FK names are NOT camelCased.
- **Locked `allowedKinds` per relationship** (spec 4):
  - `resource_subnet_hostings.infrastructure_point_id` -> `['COMPUTE_RESOURCE', 'DATA_STORE_INSTANCE', 'LOAD_BALANCER', 'INFRASTRUCTURE_RESOURCE']`.
  - `deployment_unit_compute_resources.compute_infrastructure_point_id` -> `['COMPUTE_RESOURCE', 'COMPUTE_CLUSTER']`.
  - `load_balancer_resource_routes.target_infrastructure_point_id` -> `['COMPUTE_RESOURCE', 'COMPUTE_CLUSTER', 'DATA_STORE_INSTANCE', 'INFRASTRUCTURE_RESOURCE']`.
- **`entityColors` keys are SCREAMING_SNAKE_CASE matching `InfrastructurePointKind` discriminator values** — exact match to the spec 3 `point_kind` constants.
- **Backward compatibility — additive only** — no edits to existing `DiagramType` values, `entityColors` entries, `RELATIONSHIP_EDGE_TYPES` constants, `createRelationshipEdge` cases, `isRelationshipRowEnabled` arms, or `SelectionInspector` arms.
- **Save/load round-trip already handled by spec 3** — `normalizeModelFromApi` and the full-model PUT endpoint cover diagram nodes/edges; no save-pipeline changes.
- **No provider iconography** — provider-neutral mandate; no GCP/AWS/Azure indicator badges (Q10).
- **No automatic containment creation from existing model data on diagram open** — opt-in via user palette click only (Q10).
- **No automatic relationship inference** (Q10).
- **No advanced grouping/layout rules** — no enforced hierarchy validation, no auto-grid/swimlane layout (Q10).
- **Tests are limited** — only one new test file (5 focused tests on config wiring). No renderer/interaction tests, no save-roundtrip tests, no `SelectionInspector` component tests, no containment-plumbing integration tests.
