# Spec Requirements: Infrastructure Domain Diagram Support

## Initial Description

Add diagram support for the new Infrastructure Architecture domain — the fifth spec in the seven-spec Infrastructure delivery. Specs 3 and 4 landed the TypeScript interfaces, the `ArchitectureDomain.infrastructure` registration, the 16 `gridConfigs` entries, the picker cell + derivation helper, the `RELATIONSHIP_DEFINITIONS` entries, and the `infrastructure_points` plumbing. **Diagram-side wiring (`DiagramType` union, palette sections, `entityColors`, edge-type constants, `createRelationshipEdge` cases, `isRelationshipRowEnabled` cases, polymorphic point resolution at edge time, and `SelectionInspector` minimal field sets) was deliberately deferred to THIS spec.**

This spec adds:
- A new `'Infrastructure'` value to the `DiagramType` union, registered in `CREATABLE_DIAGRAM_TYPES`, `DIAGRAM_TYPE_LABELS`, and `DIAGRAM_TYPE_MAP`.
- 12 new entries in `DOMAIN_ENTITY_SECTIONS.infrastructure` and the matching 12 entity sections + 3 relationship sections in `domainToPaletteSections.infrastructure`, plus a new `DIAGRAM_TYPE_PALETTE_RULES.Infrastructure` row listing the 12 entity + 3 relationship section IDs.
- 12 new `entityColors` entries in `defaults.ts`, plus default-dimension overrides for the 6 container-like types (Environment, CloudAccount, Location, Network, Subnet, ComputeCluster) so they spawn larger.
- 3 new `RELATIONSHIP_EDGE_TYPES` constants in `model.ts` with corresponding switch cases in `createRelationshipEdge` (style + label) and a `getEdgeColor` palette entry. `resource_subnet_hostings` is rendered as containment-only (no edge drawn) — its constant may still be required for `RELATIONSHIP_DEFINITIONS` consistency, but no styling case is added.
- 3 new `isRelationshipRowEnabled` arms with polymorphic `infrastructure_points` resolution (mirroring the existing `application_points` mapping in `getEntitiesOnDiagram`).
- Containment plumbing for `resource_subnet_hostings` so its presence sets the resource node's `parent_node_id` to the Subnet node — no edge drawn.
- Minimal `SelectionInspector` additions: 12 entity arms showing `name` + `description`; 3 relationship-edge arms showing `description` + `tags`. Power users edit the rest in the Tables UI.
- One Vitest config test asserting the wiring is complete.

No backend, gateway, MCP, discovery, Terraform, save-pipeline, auto-layout, canvas-draw-edge-mode, or full-inspector changes. Save/load already round-trips through the spec 3 `MetaModel*` shapes.

The full raw idea is preserved at `agent-os/specs/2026-05-05-infrastructure-domain-diagram-support/planning/00-raw-idea.md`. Codebase conventions and the diagram-engine reality check are preserved at `planning/codebase-grounding.md`.

## Requirements Discussion

### First Round Questions

**Q1: Diagram type name and granularity — one `'Infrastructure'` value or split sub-types?**
**Answer:** Single `'Infrastructure'` value (NOT `'Infrastructure_Architecture'`). One diagram type covers V1; sub-typing (e.g. Network vs Compute) is deferred. Extends the `DiagramType` union and registers in `CREATABLE_DIAGRAM_TYPES`, `DIAGRAM_TYPE_LABELS`, and the `DIAGRAM_TYPE_MAP` normaliser.

**Q2: Container vs node — special rendering or just bigger size + colour + nesting?**
**Answer:** Pure cosmetic split via `entityColors` + larger default dimensions for the 6 container-like types (Environment, CloudAccount, Location, Network, Subnet, ComputeCluster). NO new SVG paths, NO new shape primitives in V1. All 12 entity types render as standard rounded rectangles, differentiated by colour + label, and rely on the existing `parent_node_id` nesting plumbing.

**Q3: Hybrid rendering of the three V1 relationships — edge vs containment?**
**Answer:**
- `resource_subnet_hostings` → containment-only via `parent_node_id` (resource node's `parent_node_id` set to the Subnet node id when the relationship exists). NO edge drawn.
- `deployment_unit_compute_resources` → edge.
- `load_balancer_resource_routes` → edge.

**Q4: Polymorphic InfrastructurePoint endpoints on the diagram — point nodes drawn, or concrete entity nodes only?**
**Answer:** Mirror the BUSINESS_POINT pattern. Concrete entity nodes are drawn on the canvas (one of the 12 infra entity types); `infrastructure_points` resolution is plumbing-only at edge-creation/eligibility time. NO `INFRASTRUCTURE_POINT` nodes ever drawn. `getEntitiesOnDiagram` is extended with an `infrastructurePointsOnDiagram` Set populated by mapping each on-canvas concrete-entity node to the `infrastructure_points` rows whose typed FK matches its `entity_id`.

**Q5: SelectionInspector scope — minimal or full?**
**Answer:** Minimal V1.
- Entity nodes (all 12 types): show `name` + `description` editable, mirroring the existing LOGICAL_DATA_ENTITY behaviour.
- Relationship edges (all 3 types): show `description` + `tags` editable.
- Power users edit the remaining ~150 fields in the Tables UI.

**Q6: Edge creation UX — palette-list-of-existing-relationships click-to-add, or canvas-click-source-then-target draw mode?**
**Answer:** Pattern (a) only — palette lists existing relationships from Tables UI, click to add. NO canvas-draw mode in spec 5. This matches the existing data-movement / ER-relationship UX already in PalettePanel.

**Q7: Edge styling per relationship — line type, arrow, label?**
**Answer:**
- `resource_subnet_hostings` → containment only (no edge drawn). The `RELATIONSHIP_EDGE_TYPES` constant may still need to exist for `RELATIONSHIP_DEFINITIONS` consistency — implementer decides at write-time. **Verification: not strictly required since `createRelationshipEdge` uses string keys and the engine never enters an edge-draw path for this relationship; however, defining `RESOURCE_SUBNET_HOSTING` as a constant keeps the convention symmetric.**
- `deployment_unit_compute_resources` → DASHED line, no arrow, label "runs on" (or `version` if available). New constant `DEPLOYMENT_UNIT_COMPUTE_RESOURCE`.
- `load_balancer_resource_routes` → SOLID line + ARROW at target, label `protocol target_port` (e.g. "HTTPS 443"). New constant `LOAD_BALANCER_RESOURCE_ROUTE`.

3 (or 2 strictly required) new `RELATIONSHIP_EDGE_TYPES` constants + switch cases in `createRelationshipEdge` + `getEdgeColor` palette entries.

**Q8: Auto-layout for newly added shapes?**
**Answer:** No auto-layout. Spawn at `(100, 100)` (existing `nodeCreation.ts` default), manual drag thereafter. Matches the existing convention for all other diagram types. The raw idea explicitly lists "Advanced automatic layout beyond existing diagram capabilities" as out of scope.

**Q9: Test scope?**
**Answer:** One Vitest config test at `frontend/src/config/__tests__/infrastructureDiagramConfig.test.ts` covering:
- `'Infrastructure'` registered in `DiagramType` union, `CREATABLE_DIAGRAM_TYPES`, and `DIAGRAM_TYPE_LABELS`.
- `DOMAIN_ENTITY_SECTIONS.infrastructure` populated with the 12 entity sections.
- `domainToPaletteSections.infrastructure` populated with the 12 entity sections + 3 relationship sections.
- `DIAGRAM_TYPE_PALETTE_RULES.Infrastructure` lists the 12 + 3 sections.
- All 12 infra entity types have entries in `entityColors`.
- The 2-3 new `RELATIONSHIP_EDGE_TYPES` constants exist (at minimum `DEPLOYMENT_UNIT_COMPUTE_RESOURCE` and `LOAD_BALANCER_RESOURCE_ROUTE`; `RESOURCE_SUBNET_HOSTING` only if the implementer adds it).

NO renderer/interaction tests, NO save-roundtrip tests, NO inspector-component tests.

**Q10: Anything else explicitly out of scope beyond the raw idea's existing list?**
**Answer:** Yes — also exclude:
- No special cloud-provider iconography (provider-neutral mandate; no GCP/AWS/Azure indicator badges in V1).
- No automatic containment creation from existing model data on diagram open (containment is opt-in via `parent_node_id` set when the user adds related entities).
- No automatic relationship inference (e.g. "subnet contains resource" not auto-suggested).
- No canvas draw-mode edge creation (palette-click only — Q6).
- No full inspector field coverage (minimal `name` + `description` for entities, `description` + `tags` for relationships — Q5).
- No advanced grouping/layout rules (no enforced hierarchy validation, no auto-grid/swimlane layout).
- No `INFRASTRUCTURE_POINT` canvas rendering (concrete-entity nodes only — Q4).

### Inferred Decisions (all 10 accepted as-is)

These were inferred from the codebase grounding and accepted by the user without override:

1. **Custom SVG engine, not React Flow** — no new diagram-engine dependencies. All wiring goes through the existing `Canvas.tsx` + `rendering.ts` + `nodeCreation.ts` + `relationshipUtils.ts` files.
2. **`parent_node_id` is already first-class** — the Environment > CloudAccount > Location > Network > Subnet > resource hierarchy maps onto repeated `parent_node_id` chains. No new engine code needed; container vs node distinction is purely cosmetic.
3. **Click-to-add, not drag-drop** — `PalettePanel.handleItemClick` is the single entry point. Dispatches to `createDiagramNodeFromEntity(entity_type, entity_id, existingNodes, viewportCenter)`. New entity-type-to-constant mappings are auto-discovered through palette section IDs.
4. **Diagram serialization already wired** — `Diagram.diagram_nodes`/`diagram_edges` round-trip via the full-model PUT endpoint. Spec 3's `normalizeModelFromApi` already backfills the 13 + 3 Infra arrays. No save-pipeline changes needed.
5. **Concrete-entity nodes carry the entity-type as SCREAMING_SNAKE_CASE** matching the spec 3 `InfrastructurePointKind` discriminator values (e.g. `'COMPUTE_RESOURCE'`, `'DATA_STORE_INSTANCE'`). New `entityColors` keys use these same SCREAMING_SNAKE_CASE values.
6. **Palette-section IDs match the table-config tab keys** (e.g. `'environments'`, `'compute_resources'`, `'resource_subnet_hostings'`). `getEntityTypeConstant` extension maps each section ID to the matching SCREAMING_SNAKE_CASE constant.
7. **`RELATIONSHIP_DEFINITIONS` already complete** (spec 3) — palette `relationshipSections` derivation will pick up the 3 Infra entries the moment we add the section IDs to `domainToPaletteSections.infrastructure` and `DIAGRAM_TYPE_PALETTE_RULES.Infrastructure`.
8. **`getEntitiesOnDiagram` extension is the natural plumbing point** for polymorphic-point resolution — mirror the existing `application_points` block (lines 130-160) with an analogous block iterating `metaModel.entities.infrastructure_points` and matching each row's typed FK against the on-canvas concrete-entity nodes.
9. **`SelectionInspector` is hand-rolled per entity type, NOT `gridConfigs`-driven** — adding the 12 + 3 minimal arms is straightforward branching on `entity_type` / `relationship_type`. Existing entity update dispatch handles the save flow.
10. **`compoundLayout.ts` parent-with-children sizing already works** for the existing parent/child entity pairs and will work for any new Infra parent/child chains the user creates manually. No new layout code needed; the user drags shapes into containers and the existing auto-resize-on-children behaviour kicks in.

### Existing Code to Reference

The codebase grounding identified the following reference points:

- **`frontend/src/types/diagramType.ts`** — `DiagramType` union, `CREATABLE_DIAGRAM_TYPES`, `DIAGRAM_TYPE_LABELS`, `DIAGRAM_TYPE_MAP`.
- **`frontend/src/utils/paletteData.ts`** — `getPaletteSections(metaModel, search, domain?, diagramType?)`. `entitySections` array literal (~line 351), `DOMAIN_ENTITY_SECTIONS` (~line 86 with `infrastructure: []` placeholder), `domainToPaletteSections` (~line 147), `DIAGRAM_TYPE_PALETTE_RULES`. `getEntityTypeConstant`.
- **`frontend/src/components/DiagramsView/PalettePanel.tsx`** — `handleItemClick` (~line 1674) is the click-to-add entry point.
- **`frontend/src/utils/nodeCreation.ts`** — `createDiagramNodeFromEntity`. Default spawn at `(100, 100)`, `DEFAULT_NODE_WIDTH=120`, `DEFAULT_NODE_HEIGHT=60`, `parent_node_id: null`.
- **`frontend/src/config/defaults.ts`** — `entityColors` (~line 417). Add 12 new entries keyed by SCREAMING_SNAKE_CASE entity-type constants.
- **`frontend/src/utils/rendering.ts:436`** — `getEdgeColor(relationshipType)`. Returns `relationshipColors[relationshipType] || '#616161'`. Add palette entries for the 2-3 new edge types.
- **`frontend/src/utils/rendering.ts:447`** — `getRelationshipEdgeDefaults(relationshipType)`. Add 2-3 new switch arms returning the V1 edge styling per Q7.
- **`frontend/src/types/model.ts:1418`** — `RELATIONSHIP_EDGE_TYPES` constant object. Add 2-3 new keys: `RESOURCE_SUBNET_HOSTING` (optional, plumbing-only), `DEPLOYMENT_UNIT_COMPUTE_RESOURCE`, `LOAD_BALANCER_RESOURCE_ROUTE`.
- **`frontend/src/utils/relationshipUtils.ts:874`** — `createRelationshipEdge(relationship, edgeType, sourceNode, targetNode, options)` switch on `relationshipEdgeType`. Add 2 new cases (DASHED no-arrow + label "runs on"; SOLID + ARROW + label `protocol target_port`).
- **`frontend/src/utils/relationshipUtils.ts:329`** — `isRelationshipRowEnabled` switch on `relationshipType`. Add 3 new cases for the 3 Infra relationship-type keys (`resource_subnet_hostings`, `deployment_unit_compute_resources`, `load_balancer_resource_routes`).
- **`frontend/src/utils/relationshipUtils.ts:94`** — `getEntitiesOnDiagram(metaModel, diagram)`. Existing block (~lines 130-160) maps APPLICATION/APP_COMPONENT/SERVICE nodes to `application_points` ids; mirror this block to produce an `infrastructurePointsOnDiagram: Set<string>` mapped from each of the 12 concrete-entity types via `metaModel.entities.infrastructure_points`.
- **`frontend/src/components/DiagramsView/SelectionInspector.tsx`** — hand-rolled per-entity-type / per-relationship-type field arms. Existing minimal precedent: LOGICAL_DATA_ENTITY (just name + description). Add 12 entity arms + 3 relationship-edge arms following the same minimal pattern.
- **`frontend/src/utils/compoundLayout.ts`** — `calculateChildPositionWithHeights`, `calculateParentSizeWithHeights`. Already used by APPLICATION>APP_COMPONENT and BUSINESS_PROCESS>PROCESS_ACTIVITY; will pick up Infra parent/child chains automatically once the user drags a child into a parent.
- **Existing precedents to mirror:**
  - APPLICATION>APP_COMPONENT containment (Application domain) — directly analogous to Subnet>resource containment for `resource_subnet_hostings`.
  - DATA_MOVEMENT edge (`relationshipUtils.ts:929`) — directly analogous to `load_balancer_resource_routes` (SOLID + ARROW + label).
  - APP_POINT_BUSINESS_POINT edge (`relationshipUtils.ts:899`) — analogous styling style for `deployment_unit_compute_resources` (will use DASHED no-arrow per Q7 instead).
  - `application_points` polymorphic mapping in `getEntitiesOnDiagram` — direct template for `infrastructure_points` mapping.
- **`frontend/src/config/__tests__/infrastructureTablesConfig.test.ts`** (spec 4) — Vitest pattern to follow for the new diagram config test.

### Follow-up Questions

No follow-up questions were required. The user provided concrete answers on all 10 open questions and accepted all 10 inferred decisions.

## Visual Assets

### Files Provided

Bash check on `agent-os/specs/2026-05-05-infrastructure-domain-diagram-support/planning/visuals/` returned no image/PDF files.

No visual assets provided.

### Visual Insights

N/A — diagram-config and minimal-inspector spec, no UI mockups required. Reference UX is the existing `Canvas.tsx` rendering against the existing `entityColors` palette and the existing `PalettePanel` flow. The 6 container-like types lean on the established APPLICATION>APP_COMPONENT and BUSINESS_PROCESS>PROCESS_ACTIVITY containment precedent.

## Requirements Summary

### Functional Requirements

The frontend must:

1. **Extend the `DiagramType` union with `'Infrastructure'`** in `frontend/src/types/diagramType.ts`. Add to `CREATABLE_DIAGRAM_TYPES`, `DIAGRAM_TYPE_LABELS` (label e.g. `'Infrastructure'`), and `DIAGRAM_TYPE_MAP` (case-insensitive normalisation key).
2. **Populate the palette wiring** in `frontend/src/utils/paletteData.ts`:
   - Replace `DOMAIN_ENTITY_SECTIONS.infrastructure: []` placeholder with the 12 entity-section IDs (`environments`, `cloud_accounts`, `locations`, `networks`, `subnets`, `compute_clusters`, `compute_resources`, `deployment_units`, `load_balancers`, `listeners`, `data_store_instances`, `infrastructure_resources`).
   - Replace `domainToPaletteSections.infrastructure: []` placeholder with the same 12 entity sections + the 3 relationship sections (`resource_subnet_hostings`, `deployment_unit_compute_resources`, `load_balancer_resource_routes`).
   - Add `DIAGRAM_TYPE_PALETTE_RULES.Infrastructure` row listing the 12 + 3 section IDs.
   - Extend `entitySections` array literal with 12 new entries mapping each `metaModel.entities.<key>` to `{id, name}` items.
   - Extend `relationshipSections` array literal with 3 new entries (or rely on `RELATIONSHIP_DEFINITIONS`-driven derivation if that pattern already exists — verify at write-time).
   - Extend `getEntityTypeConstant` mapping with 12 new section-ID-to-SCREAMING_SNAKE_CASE-constant entries.
3. **Add 12 new `entityColors` entries** in `frontend/src/config/defaults.ts` keyed by SCREAMING_SNAKE_CASE entity-type values (`ENVIRONMENT`, `CLOUD_ACCOUNT`, `LOCATION`, `NETWORK`, `SUBNET`, `COMPUTE_CLUSTER`, `COMPUTE_RESOURCE`, `DEPLOYMENT_UNIT`, `LOAD_BALANCER`, `LISTENER`, `DATA_STORE_INSTANCE`, `INFRASTRUCTURE_RESOURCE`). Each entry: `{ background: hex, border: hex }`. Pick visually distinct hues following existing palette conventions.
4. **Add default-dimension overrides for the 6 container-like types** (Environment, CloudAccount, Location, Network, Subnet, ComputeCluster) so they spawn larger than the default 120x60. Implementation note: if a config table for default dimensions already exists, add 6 entries; otherwise add a small lookup helper or inline override in `nodeCreation.ts` for these 6 entity types.
5. **Add 2-3 new `RELATIONSHIP_EDGE_TYPES` constants** in `frontend/src/types/model.ts:1418`:
   - `RESOURCE_SUBNET_HOSTING` (optional — plumbing-only, no edge drawn; add if symmetry with `RELATIONSHIP_DEFINITIONS` is preferred).
   - `DEPLOYMENT_UNIT_COMPUTE_RESOURCE` (required).
   - `LOAD_BALANCER_RESOURCE_ROUTE` (required).
6. **Add switch cases in `createRelationshipEdge`** in `frontend/src/utils/relationshipUtils.ts:874`:
   - `DEPLOYMENT_UNIT_COMPUTE_RESOURCE`: `line_type = 'DASHED'`, `arrow_end = 'NONE'`, label "runs on" (or `version` from the relationship row if non-empty).
   - `LOAD_BALANCER_RESOURCE_ROUTE`: `line_type = 'SOLID'`, `arrow_end = 'ARROW'`, label `${protocol} ${target_port}` (e.g. "HTTPS 443"). Position label at midpoint via existing `calculateMidpointLabelPosition`.
   - `RESOURCE_SUBNET_HOSTING`: NO case added (no edge drawn).
7. **Add `getEdgeColor` palette entries** in `frontend/src/utils/rendering.ts` for the 2 new edge types (and optionally the 3rd). Pick colours consistent with the entity colour palette.
8. **Add `getRelationshipEdgeDefaults` switch arms** in `frontend/src/utils/rendering.ts:447` for the 2 new edge types.
9. **Add 3 new `isRelationshipRowEnabled` cases** in `frontend/src/utils/relationshipUtils.ts:329`:
   - `'resource_subnet_hostings'`: enabled iff the resolved `infrastructure_point` resource AND the `subnet_id` Subnet are both on the diagram.
   - `'deployment_unit_compute_resources'`: enabled iff the `deployment_unit_id` AND the resolved `compute_infrastructure_point_id` concrete entity are both on the diagram.
   - `'load_balancer_resource_routes'`: enabled iff the `load_balancer_id` AND the resolved `target_infrastructure_point_id` concrete entity are both on the diagram.
   - Use the new `infrastructurePointsOnDiagram` Set for polymorphic resolution.
10. **Extend `getEntitiesOnDiagram`** in `frontend/src/utils/relationshipUtils.ts:94` with an `infrastructurePointsOnDiagram: Set<string>` field, populated by iterating `metaModel.entities.infrastructure_points` and adding each row's id when its corresponding typed FK matches an on-canvas entity-type-and-id pair (12 concrete entity types). Mirror the existing `application_points` mapping block.
11. **Wire containment for `resource_subnet_hostings`** so that when the relationship exists between an on-canvas resource node and an on-canvas Subnet node, the resource node's `parent_node_id` is set to the Subnet node id. Implementation point: PalettePanel's add-relationship handler (or an analogous post-add hook). NO `DiagramEdge` is created.
12. **Add minimal `SelectionInspector` arms** in `frontend/src/components/DiagramsView/SelectionInspector.tsx`:
    - 12 entity arms (one per entity type): show editable `name` + `description` only. Mirror the existing LOGICAL_DATA_ENTITY arm.
    - 3 relationship-edge arms (one per relationship type): show editable `description` + `tags` only.
    - Edits flow through existing entity / relationship update dispatch.
13. **Add one Vitest config test** at `frontend/src/config/__tests__/infrastructureDiagramConfig.test.ts` asserting:
    - `'Infrastructure'` is present in the `DiagramType` union, `CREATABLE_DIAGRAM_TYPES`, and `DIAGRAM_TYPE_LABELS`.
    - `DOMAIN_ENTITY_SECTIONS.infrastructure` contains the 12 section IDs.
    - `domainToPaletteSections.infrastructure` contains the 12 entity sections + 3 relationship sections.
    - `DIAGRAM_TYPE_PALETTE_RULES.Infrastructure` lists the 12 + 3 sections.
    - All 12 infra entity types have entries in `entityColors`.
    - `DEPLOYMENT_UNIT_COMPUTE_RESOURCE` and `LOAD_BALANCER_RESOURCE_ROUTE` exist in `RELATIONSHIP_EDGE_TYPES` (and `RESOURCE_SUBNET_HOSTING` if added).
    Modelled on `infrastructureTablesConfig.test.ts`. NO renderer/interaction tests.
14. **Preserve existing behaviour** for all non-Infrastructure diagram types and domains. No edits to existing `entityColors` entries, existing `RELATIONSHIP_EDGE_TYPES`, existing `createRelationshipEdge` cases, or existing `SelectionInspector` arms.

### Concrete Change-Surface List

| # | File | Change |
|---|---|---|
| 1 | `frontend/src/types/diagramType.ts` | Extend `DiagramType` union with `'Infrastructure'`. Add to `CREATABLE_DIAGRAM_TYPES`, `DIAGRAM_TYPE_LABELS`, `DIAGRAM_TYPE_MAP`. |
| 2 | `frontend/src/utils/paletteData.ts` | Populate `DOMAIN_ENTITY_SECTIONS.infrastructure` (12), `domainToPaletteSections.infrastructure` (12 entity + 3 relationship), `DIAGRAM_TYPE_PALETTE_RULES.Infrastructure`. Extend `entitySections` array with 12 new entries. Extend `relationshipSections` array with 3 new entries (or verify `RELATIONSHIP_DEFINITIONS`-driven derivation suffices). Extend `getEntityTypeConstant` mapping. |
| 3 | `frontend/src/config/defaults.ts` | Add 12 new `entityColors` entries. Add default-dimension overrides for the 6 container-like types (Environment, CloudAccount, Location, Network, Subnet, ComputeCluster) — implementation depends on whether a default-dimensions config table exists; otherwise inline in `nodeCreation.ts`. |
| 4 | `frontend/src/types/model.ts` | Add 2-3 new `RELATIONSHIP_EDGE_TYPES` constants (`DEPLOYMENT_UNIT_COMPUTE_RESOURCE`, `LOAD_BALANCER_RESOURCE_ROUTE`, optional `RESOURCE_SUBNET_HOSTING`). Confirmed location: line 1418. |
| 5 | `frontend/src/utils/relationshipUtils.ts` | Add 2 new switch cases in `createRelationshipEdge`. Add 3 new switch cases in `isRelationshipRowEnabled`. Extend `getEntitiesOnDiagram` with `infrastructurePointsOnDiagram` Set populated from the 12 concrete-entity-type nodes via `metaModel.entities.infrastructure_points`. |
| 6 | `frontend/src/utils/rendering.ts` | Add 2-3 entries to `relationshipColors` lookup (used by `getEdgeColor`). Add 2 new `getRelationshipEdgeDefaults` switch arms. |
| 7 | `frontend/src/utils/nodeCreation.ts` (if no defaults table exists in `defaults.ts`) | Inline default-dimension overrides for the 6 container-like types. |
| 8 | Containment plumbing for `resource_subnet_hostings` | Wire so that when the relationship is added (palette click), the resource node's `parent_node_id` is set to the Subnet node id. NO `DiagramEdge` created. Likely lives in `PalettePanel.tsx` add-relationship handler or an analogous hook. |
| 9 | `frontend/src/components/DiagramsView/SelectionInspector.tsx` | Add 12 minimal entity arms (`name` + `description`) and 3 minimal relationship-edge arms (`description` + `tags`). |
| 10 | **NEW** `frontend/src/config/__tests__/infrastructureDiagramConfig.test.ts` | Vitest config test per Q9. |

**Files NOT to touch** (already done by spec 3 / 4 or out of scope):
- `frontend/src/types/architectureDomain.ts` — done by spec 3.
- `frontend/src/config/relationshipDefinitions.ts` — done by spec 3.
- `frontend/src/api/modelSerialization.ts` — done by spec 3.
- `frontend/src/config/gridConfigs.ts` — done by spec 4.
- `frontend/src/components/Grid/InfrastructurePointPickerCell.tsx` — done by spec 4.
- `frontend/src/utils/infrastructurePointDerivation.ts` — done by spec 4.
- `frontend/src/components/DiagramsView/Canvas.tsx` — domain-agnostic; renders via `entityColors` lookup, no per-domain edits needed.

### Reusability Opportunities

- **`createDiagramNodeFromEntity`** in `nodeCreation.ts` — already handles the new entity types once they appear in `getEntityTypeConstant`. No new node-creation code needed beyond default-dimension overrides for containers.
- **`compoundLayout.ts`** — parent-with-children sizing already works for any `parent_node_id` chain. Used by APPLICATION>APP_COMPONENT and BUSINESS_PROCESS>PROCESS_ACTIVITY today; will work for Infra parent/child chains automatically.
- **`PalettePanel.handleItemClick`** — single click-to-add entry point. Auto-discovers new sections via the palette derivation. New entity types light up in the palette the moment they're added to `DOMAIN_ENTITY_SECTIONS.infrastructure`.
- **DATA_MOVEMENT edge styling** at `relationshipUtils.ts:929` — directly analogous template for `LOAD_BALANCER_RESOURCE_ROUTE` (SOLID + ARROW + label).
- **APP_POINT_BUSINESS_POINT edge styling** at `relationshipUtils.ts:899` — analogous template for `DEPLOYMENT_UNIT_COMPUTE_RESOURCE` (line-type style only; differs in that V1 wants DASHED + label "runs on").
- **`application_points` mapping** in `getEntitiesOnDiagram` (lines 130-160) — direct template for the new `infrastructurePointsOnDiagram` block.
- **APPLICATION>APP_COMPONENT containment auto-resize** — directly analogous template for any Infra parent>child chain.
- **LOGICAL_DATA_ENTITY inspector arm** — minimal-inspector template (name + description only) for all 12 Infra entity arms.
- **`infrastructureTablesConfig.test.ts`** (spec 4) — Vitest pattern for the new diagram config test.

### Scope Boundaries

**In Scope:**
- `'Infrastructure'` value in `DiagramType` union + registration in `CREATABLE_DIAGRAM_TYPES`, `DIAGRAM_TYPE_LABELS`, `DIAGRAM_TYPE_MAP`.
- 12 entity sections in `DOMAIN_ENTITY_SECTIONS.infrastructure` and `domainToPaletteSections.infrastructure`.
- 3 relationship sections in `domainToPaletteSections.infrastructure`.
- `DIAGRAM_TYPE_PALETTE_RULES.Infrastructure` row.
- 12 new `entityColors` entries.
- Default-dimension overrides for 6 container-like types.
- 2-3 new `RELATIONSHIP_EDGE_TYPES` constants.
- 2 new `createRelationshipEdge` switch cases (DASHED no-arrow + label "runs on"; SOLID + ARROW + label `protocol target_port`).
- 2-3 new `getEdgeColor` / `relationshipColors` entries + `getRelationshipEdgeDefaults` arms.
- 3 new `isRelationshipRowEnabled` cases with polymorphic-point resolution.
- `infrastructurePointsOnDiagram` Set extension in `getEntitiesOnDiagram`.
- Containment plumbing for `resource_subnet_hostings` (sets `parent_node_id`; no edge drawn).
- 12 minimal entity arms + 3 minimal relationship-edge arms in `SelectionInspector` (name + description for entities; description + tags for relationships).
- One Vitest config test.

**Out of Scope** (raw idea exclusions plus the 7 new exclusions in Q10):
- Terraform import / export / generation (raw idea).
- Automatic diagram generation from Terraform (raw idea).
- Discovery-service integration (raw idea).
- Gateway changes (raw idea).
- MCP tools (raw idea).
- Security group / firewall / IAM diagramming (raw idea).
- Traffic Flow relationship (raw idea).
- Infrastructure Resource dependency relationship (raw idea).
- Data entity hosted on Data Store relationship (raw idea).
- Detailed network routing / firewall visualization (raw idea).
- Live cloud inventory integration (raw idea).
- Cost, monitoring, IAM, policy, or compliance views (raw idea).
- Advanced automatic layout beyond existing diagram capabilities (raw idea).
- **No special cloud-provider iconography** — provider-neutral mandate; no GCP/AWS/Azure indicator badges (Q10).
- **No automatic containment creation** from existing model data on diagram open (Q10).
- **No automatic relationship inference** (Q10).
- **No canvas draw-mode edge creation** — palette-click only (Q6, Q10).
- **No full inspector field coverage** — minimal `name` + `description` for entities, `description` + `tags` for relationships (Q5, Q10).
- **No advanced grouping/layout rules** — no enforced hierarchy validation, no auto-grid/swimlane layout (Q10).
- **No `INFRASTRUCTURE_POINT` canvas rendering** — concrete-entity nodes only (Q4, Q10).
- **No auto-layout** — spawn at `(100, 100)`, manual drag (Q8).
- **No renderer/interaction tests, no save-roundtrip tests, no inspector-component tests** — config test only (Q9).

### Technical Considerations

- **Custom SVG engine, not React Flow** — all wiring goes through existing files; no new diagram-engine dependencies.
- **`parent_node_id` is first-class** — containment is achieved via the existing nesting plumbing. Container vs node distinction is purely cosmetic (default size + colour).
- **Polymorphic point resolution is plumbing-only** — concrete-entity nodes are drawn on the canvas; `infrastructure_points` rows are looked up in `getEntitiesOnDiagram` and `isRelationshipRowEnabled` to determine eligibility.
- **`resource_subnet_hostings` is containment-only** — no `DiagramEdge` created. The `RELATIONSHIP_EDGE_TYPES` constant for it is optional (implementer's call); only the containment plumbing is required.
- **Edge styling is locked per Q7** — DASHED no-arrow + "runs on" label for `deployment_unit_compute_resources`; SOLID + ARROW + `protocol target_port` for `load_balancer_resource_routes`.
- **No backend, gateway, MCP, discovery, or save-pipeline changes** — diagram nodes/edges already round-trip via the full-model PUT endpoint (spec 3 plumbing).
- **Backward compatibility** — existing diagrams without Infrastructure shapes continue to load and render unchanged. Existing non-Infrastructure entity colours, edge types, and inspector arms are not edited.
- **`DiagramNode.entity_type`** carries SCREAMING_SNAKE_CASE values matching the `InfrastructurePointKind` discriminator (spec 3). New `entityColors` keys use these same values.
- **Default node spawn at `(100, 100)`** — no auto-layout. The 6 container-like types get larger default dimensions so user-driven nesting visually works without immediate manual resize.
- **Relationship-section derivation** — verify at write-time whether `paletteData.ts` derives relationship sections from `RELATIONSHIP_DEFINITIONS` (spec 3 already populated those) or whether 3 explicit entries must be added to `relationshipSections` array literal. Either way, the user-visible result is the 3 sections appearing under the Infrastructure palette category.

## Acceptance Criteria

(Copied from raw idea; preserved verbatim.)

- Users can create an Infrastructure Architecture Diagram.
- Infrastructure Architecture Diagrams can be opened, edited, saved, reloaded, and deleted.
- The Infrastructure palette/category includes shapes for all 12 Infrastructure entity types.
- Infrastructure shapes can be added to the canvas using existing diagram interaction patterns.
- Infrastructure shapes reference or create underlying Infrastructure model entities consistently with existing diagram behaviour.
- Infrastructure diagrams support the three V1 Infrastructure relationships.
- Resource hosted in Subnet / Segment can be visualized as containment/grouping or a placement edge. (V1 choice: containment-only via `parent_node_id`; no edge drawn — Q3.)
- Deployment Unit runs on Compute can be visualized as nesting/attachment or an edge. (V1 choice: edge with DASHED line, label "runs on" — Q7.)
- Load Balancer routes to Compute / Resource can be visualized as a directed routing edge. (V1: SOLID + ARROW + label `protocol target_port` — Q7.)
- Selecting Infrastructure shapes and edges shows editable details in the existing inspector pattern. (V1: minimal — name+description for entities, description+tags for relationships — Q5.)
- Diagram save/reload preserves Infrastructure shapes, edges, and model references.
- Existing non-Infrastructure diagrams continue to work unchanged.
- No Terraform, Gateway, MCP, Discovery, security/IAM/firewall, or live cloud integration is included in this spec.
