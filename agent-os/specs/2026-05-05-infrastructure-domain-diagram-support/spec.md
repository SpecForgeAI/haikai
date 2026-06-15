# Specification: Infrastructure Domain Diagram Support

## Goal
Wire diagram support for the new Infrastructure domain into the existing hand-rolled SVG diagram engine by registering an `'Infrastructure'` `DiagramType`, populating palette sections for the 12 entity types and 3 relationship types, adding entity colours and container default-dimension overrides, declaring 3 new relationship edge types with V1 styling, and extending polymorphic-point resolution and minimal `SelectionInspector` arms — so users can compose Infrastructure diagrams using existing click-to-add and `parent_node_id`-nesting patterns.

## User Stories
- As an architect, I want to create an Infrastructure Architecture Diagram and add the 12 Infrastructure entity types from the palette so that I can sketch high-level cloud topology (environments, networks, compute, deployment units, load balancers, data stores) for target-state agreement.
- As an architect, I want existing `resource_subnet_hostings`, `deployment_unit_compute_resources`, and `load_balancer_resource_routes` rows from the Tables UI to render as containment or labelled edges on the canvas so that I can visualise placement and routing without re-entering the data.

## Specific Requirements

**Register the `'Infrastructure'` DiagramType**
- Extend the `DiagramType` union in `frontend/src/types/diagramType.ts` with `'Infrastructure'`.
- Add `'Infrastructure'` to `CREATABLE_DIAGRAM_TYPES`.
- Add `Infrastructure: 'Infrastructure'` (or equivalent label) to `DIAGRAM_TYPE_LABELS`.
- Add a case-insensitive normalisation key to `DIAGRAM_TYPE_MAP`.
- Touch nothing else in the file; preserve all existing entries.

**Populate palette wiring in `paletteData.ts`**
- Replace the `DOMAIN_ENTITY_SECTIONS.infrastructure: []` placeholder with 12 entity-section IDs in containment-friendly order: `environments`, `cloud_accounts`, `locations`, `networks`, `subnets`, `compute_clusters`, `compute_resources`, `deployment_units`, `load_balancers`, `listeners`, `data_store_instances`, `infrastructure_resources`.
- Replace the `domainToPaletteSections.infrastructure: []` placeholder with the same 12 entity sections plus the 3 relationship sections: `resource_subnet_hostings`, `deployment_unit_compute_resources`, `load_balancer_resource_routes`.
- Add a `DIAGRAM_TYPE_PALETTE_RULES.Infrastructure` row listing the 12 entity + 3 relationship section IDs.
- Extend the `entitySections` array literal with 12 new entries mapping each `metaModel.entities.<key>` to `{id, name}` items, mirroring existing entries.
- Extend the `relationshipSections` array literal (or the `RELATIONSHIP_DEFINITIONS`-driven derivation, whichever is in use) with the 3 Infra relationship sections.
- Extend `getEntityTypeConstant` with 12 new section-ID-to-SCREAMING_SNAKE_CASE-constant mappings (`environments` -> `ENVIRONMENT`, `cloud_accounts` -> `CLOUD_ACCOUNT`, etc.).

**Add 12 `entityColors` entries and container default-dimension overrides**
- Append 12 new `entityColors` entries in `frontend/src/config/defaults.ts` keyed by SCREAMING_SNAKE_CASE constants matching `InfrastructurePointKind` discriminator values: `ENVIRONMENT`, `CLOUD_ACCOUNT`, `LOCATION`, `NETWORK`, `SUBNET`, `COMPUTE_CLUSTER`, `COMPUTE_RESOURCE`, `DEPLOYMENT_UNIT`, `LOAD_BALANCER`, `LISTENER`, `DATA_STORE_INSTANCE`, `INFRASTRUCTURE_RESOURCE`. Each entry: `{ background: hex, border: hex }` with visually distinct hues.
- Add a default-dimension override of 320x200 for the 6 container-like types (`ENVIRONMENT`, `CLOUD_ACCOUNT`, `LOCATION`, `NETWORK`, `SUBNET`, `COMPUTE_CLUSTER`) so they spawn larger than the 120x60 default. Implementer chooses between extending an existing config table in `defaults.ts` or inlining an override in `nodeCreation.ts`. The remaining 6 entity types use the existing 120x60 default.
- No changes to existing `entityColors` entries; no new shape primitives.

**Add 3 new `RELATIONSHIP_EDGE_TYPES` constants in `model.ts`**
- Add `RESOURCE_SUBNET_HOSTING` (containment-only; constant exists for symmetry with `RELATIONSHIP_DEFINITIONS`, but the engine never enters an edge-draw path for it).
- Add `DEPLOYMENT_UNIT_COMPUTE_RESOURCE`.
- Add `LOAD_BALANCER_RESOURCE_ROUTE`.
- Append at the existing constant-object location (~line 1418); preserve all existing keys.

**Add `createRelationshipEdge` switch cases in `relationshipUtils.ts`**
- Add a case for `DEPLOYMENT_UNIT_COMPUTE_RESOURCE`: dashed line, no arrow, label `"runs on"` or the relationship row's `version` field if non-empty. Mirror the line-style structure of the `APP_POINT_BUSINESS_POINT` case (~line 899).
- Add a case for `LOAD_BALANCER_RESOURCE_ROUTE`: solid line, arrow at target, label composed as `${protocol} ${target_port}` (e.g. `"HTTPS 443"`). Mirror the `DATA_MOVEMENT` case (~line 929) and use `calculateMidpointLabelPosition` for the label.
- Do NOT add a case for `RESOURCE_SUBNET_HOSTING` — it never reaches the edge-draw path.

**Add `getEdgeColor` and `getRelationshipEdgeDefaults` entries in `rendering.ts`**
- Add `relationshipColors` entries for `DEPLOYMENT_UNIT_COMPUTE_RESOURCE` and `LOAD_BALANCER_RESOURCE_ROUTE`. Pick colours consistent with the new entity palette.
- Add 2 new switch arms in `getRelationshipEdgeDefaults` (~line 447) returning the V1 styling per the rules above.

**Polymorphic point resolution in `getEntitiesOnDiagram`**
- Extend `getEntitiesOnDiagram` (`relationshipUtils.ts:94`) with an `infrastructurePointsOnDiagram: Set<string>` field. Mirror the existing `application_points` block (~lines 130-160).
- For each on-canvas concrete-entity node whose `entity_type` is one of the 12 SCREAMING_SNAKE_CASE Infra constants, look up the `metaModel.entities.infrastructure_points` row whose typed FK column (`environment_id`, `cloud_account_id`, ..., `infrastructure_resource_id`) matches the node's `entity_id`. Add the matched `infrastructure_points.id` to the Set.
- No `INFRASTRUCTURE_POINT` nodes are drawn on the canvas — concrete entity nodes only.

**Add 3 `isRelationshipRowEnabled` cases in `relationshipUtils.ts:329`**
- `'resource_subnet_hostings'`: enabled iff the `subnet_id` is on the diagram AND the row's `infrastructure_point_id` resolves (via `infrastructurePointsOnDiagram`) to an on-canvas concrete-entity node. Honour the locked `allowedKinds: ['COMPUTE_RESOURCE', 'DATA_STORE_INSTANCE', 'LOAD_BALANCER', 'INFRASTRUCTURE_RESOURCE']` from spec 4.
- `'deployment_unit_compute_resources'`: enabled iff the `deployment_unit_id` AND the resolved `compute_infrastructure_point_id` concrete entity are both on the diagram. Honour `allowedKinds: ['COMPUTE_RESOURCE', 'COMPUTE_CLUSTER']`.
- `'load_balancer_resource_routes'`: enabled iff the `load_balancer_id` AND the resolved `target_infrastructure_point_id` concrete entity are both on the diagram. Honour `allowedKinds: ['COMPUTE_RESOURCE', 'COMPUTE_CLUSTER', 'DATA_STORE_INSTANCE', 'INFRASTRUCTURE_RESOURCE']`.

**Containment plumbing for `resource_subnet_hostings`**
- When a `resource_subnet_hostings` row is added (palette click) and BOTH the resolved concrete resource node and the target Subnet node are on the canvas, set the resource node's `parent_node_id` to the Subnet node's id. The existing compound-layout code resizes the Subnet container automatically.
- NO `DiagramEdge` is created for this relationship type.
- Wire this in `PalettePanel.handleItemClick` (or the analogous post-add hook used by the relationship-add path); do not re-derive on every render.
- Do not auto-create containment for pre-existing rows on diagram open (out of scope).

**Minimal `SelectionInspector` additions**
- Add 12 entity arms in `frontend/src/components/DiagramsView/SelectionInspector.tsx`, one per Infra entity type, each showing editable `name` and `description` only — mirror the existing `LOGICAL_DATA_ENTITY` arm.
- Add 3 relationship-edge arms, one per Infra relationship type, each showing editable `description` and `tags` only.
- Edits flow through the existing entity / relationship update dispatch; no new save plumbing.
- Do NOT cover the remaining ~150 fields — power users edit those in the Tables UI from spec 4.

**One Vitest config test**
- Create `frontend/src/config/__tests__/infrastructureDiagramConfig.test.ts`, modelled on `infrastructureTablesConfig.test.ts` from spec 4.
- Assert: `'Infrastructure'` is registered in the `DiagramType` union (via runtime check on `DIAGRAM_TYPE_LABELS`), `CREATABLE_DIAGRAM_TYPES`, and `DIAGRAM_TYPE_LABELS`; `DOMAIN_ENTITY_SECTIONS.infrastructure` contains the 12 section IDs; `domainToPaletteSections.infrastructure` contains the 12 entity + 3 relationship section IDs; `DIAGRAM_TYPE_PALETTE_RULES.Infrastructure` lists the 12 + 3 sections; all 12 SCREAMING_SNAKE_CASE Infra entity-type keys exist in `entityColors`; `DEPLOYMENT_UNIT_COMPUTE_RESOURCE`, `LOAD_BALANCER_RESOURCE_ROUTE`, and `RESOURCE_SUBNET_HOSTING` exist in `RELATIONSHIP_EDGE_TYPES`.
- No renderer/interaction tests, no save-roundtrip tests, no inspector-component tests.

**Backward compatibility**
- All changes are additive. No edits to existing `DiagramType` values, `entityColors` entries, `RELATIONSHIP_EDGE_TYPES` constants, `createRelationshipEdge` cases, `isRelationshipRowEnabled` cases, or `SelectionInspector` arms.
- Existing diagrams without Infrastructure shapes load and render unchanged. Non-Infrastructure diagram types are not edited.
- Save/load round-trip already handled by spec 3's `normalizeModelFromApi` and the full-model PUT endpoint; no save-pipeline changes.
- Honour locked snake_case JSON keys: `infrastructure_point_id`, `target_infrastructure_point_id`, `compute_infrastructure_point_id`.

## Visual Design
N/A — diagram-config and minimal-inspector spec; no visual assets provided. Reference UX is the existing `Canvas.tsx` rendering against the new `entityColors` entries and the existing `PalettePanel` click-to-add flow. The 6 container-like types lean on the established `APPLICATION` -> `APP_COMPONENT` and `BUSINESS_PROCESS` -> `PROCESS_ACTIVITY` containment precedent.

## Existing Code to Leverage

**`paletteData.ts` (`frontend/src/utils/paletteData.ts`)**
- `DOMAIN_ENTITY_SECTIONS.infrastructure: []` (~line 86) and `domainToPaletteSections.infrastructure: []` (~line 147) are the placeholders to populate.
- `entitySections` array literal (~line 351) is the structural template for the 12 new entries.
- `getEntityTypeConstant` is the section-ID-to-constant mapping to extend.
- `DIAGRAM_TYPE_PALETTE_RULES` is the per-diagram-type filter table.

**`PalettePanel.handleItemClick` (`frontend/src/components/DiagramsView/PalettePanel.tsx:1674`)**
- Single click-to-add entry point. Auto-discovers new sections via palette derivation.
- Existing inline auto-parent-wrapping for known parent/child pairs (`APPLICATION` -> `APP_COMPONENT`, `BUSINESS_PROCESS` -> `PROCESS_ACTIVITY`, `INTERFACE` -> `ENDPOINT`) is the pattern for the new `resource_subnet_hostings` containment plumbing.

**`relationshipUtils.ts` precedents**
- `createRelationshipEdge` at line 874 with `DATA_MOVEMENT` (line 929, solid + arrow + label) is the direct template for `LOAD_BALANCER_RESOURCE_ROUTE`.
- `APP_POINT_BUSINESS_POINT` (line 899) is the closest line-style template for `DEPLOYMENT_UNIT_COMPUTE_RESOURCE` (V1 wants dashed + no-arrow + `"runs on"` label).
- `getEntitiesOnDiagram` (line 94) `application_points` block (~lines 130-160) is the direct template for `infrastructurePointsOnDiagram` Set construction — BUSINESS_POINT polymorphic-resolution precedent.
- `isRelationshipRowEnabled` switch (line 329) is the location to add the 3 new arms.

**`SelectionInspector.tsx` (`frontend/src/components/DiagramsView/SelectionInspector.tsx`)**
- The `LOGICAL_DATA_ENTITY` arm is the minimal template (name + description only) for all 12 new Infra entity arms.
- Existing relationship-edge arms (e.g. `STATE_TRANSITION`, `ACTIVITY_FLOW`) are the template for the 3 new minimal relationship arms (description + tags only).

**`infrastructureTablesConfig.test.ts` (spec 4)**
- Vitest pattern (`describe` per concern, `expect(...).toContain(...)`, etc.) — replicate structure for the new `infrastructureDiagramConfig.test.ts`.

## Out of Scope
- Special cloud-provider iconography — no GCP/AWS/Azure indicator badges; provider-neutral mandate.
- Automatic containment creation from existing model data on diagram open — containment only set when user adds related entities via palette click.
- Automatic relationship inference (e.g. "subnet contains resource" not auto-suggested).
- Canvas draw-mode edge creation (no click-source-then-target UX) — palette-click only.
- Full inspector field coverage — Tables UI from spec 4 covers full editing of the remaining ~150 fields.
- Advanced grouping/layout rules — no enforced hierarchy validation, no auto-grid/swimlane layout, no auto-layout.
- `INFRASTRUCTURE_POINT` canvas rendering — concrete-entity nodes only.
- Renderer or interaction tests, save-roundtrip tests, inspector-component tests — config test only.
- Terraform / Discovery / Gateway / MCP / security-IAM / firewall / Traffic Flow / Infrastructure Resource dependency / Data entity hosted on Data Store relationships.
