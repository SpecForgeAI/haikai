# Spec Requirements: Infrastructure Diagram V2 — Auto-Layout & Cross-Domain Overlay

## Initial Description

Follow-on to the Infrastructure 7-spec arc (specs `2026-05-04-infrastructure-domain-backend-foundation/` through `2026-05-05-infrastructure-terraform-discovery-readiness/`). Spec 5 introduced the `'Infrastructure'` `DiagramType` but, as built, behaves as "General DiagramType with a filtered palette and bigger default rectangles." Every other non-General DiagramType has a distinct *reason* for existing (Sequence is auto-drawn from interactions, ER is structured around data entities, User Journey is auto-drawn from journey data) — Infrastructure today does not earn that distinction.

This spec replaces the `'Infrastructure'` DiagramType's runtime behaviour with an **environment-rooted, auto-laid-out, view-mostly diagram** that uses the data already captured by specs 1-6 (Infrastructure entities, relationships, cross-domain links from Application and Data domains) to produce a meaningful runtime-topology view automatically.

Key shifts vs. spec 5:
- **Auto-layout from model data** (no `diagram_nodes` / `diagram_edges` rows; everything materialised at render time from `metaModel.entities.*` for the chosen Environment).
- **Environment-rooted scope** with a header dropdown for switching scope.
- **Cross-domain Service cards** rendered inside Compute Resources via `application_compute_deployments`.
- **Cross-domain Data entity chips** rendered inside Data Store boxes via `data_entity_data_store_hostings`.
- **Tier overlays** for Load Balancers / Listeners / Infrastructure Resources that don't fit pure containment.
- **Filter chips** in the header (5 layer chips + 2 edge-overlay chips).
- **View-mostly authoring posture** — no palette, no canvas-drag-to-add, no draw-edges. Authoring stays in the Tables UI (spec 4) and the General DiagramType remains the free-form playground.

Spec 5's wiring is left intact and additive — V2 is enhancement only, no retirement.

The full raw idea is preserved at `agent-os/specs/2026-05-05-infrastructure-diagram-auto-layout-and-cross-domain-overlay/planning/00-raw-idea.md`. Codebase grounding is preserved at `planning/codebase-grounding.md`.

## Requirements Discussion

### First Round Questions

**Q1: Renderer architecture — extend `Canvas.tsx` with an Infrastructure-V2 mode, or build a dedicated parallel renderer?**
**Answer:** Dedicated new `frontend/src/components/DiagramsView/InfrastructureDiagramRenderer.tsx` parallel to `SequenceDiagramRenderer.tsx`. `DiagramsView.tsx` swaps to it for `'Infrastructure'` `DiagramType`. Bypasses `Canvas.tsx`'s generic node/edge rendering and drag-persist dispatch (since manual drags are session-only and never written back to the model).

**Q2: Persistence — how is Environment scope and filter-chip state persisted across diagram open/close?**
**Answer:** Persisted via the existing `Diagram.settings` slot pattern (same as `journeyDiagram` / `overviewDiagram`). Shape: `diagram.settings.infrastructure = { environment_id, filters: {...} }`. Reopening the diagram preserves Environment scope and filter chip choices. No new persistence pipeline; piggybacks on the model save/load round-trip already done by spec 3.

**Q3: Default Environment selection when zero or many exist?**
**Answer:**
- **Zero environments**: empty-state message ("Create an Environment in the Tables UI to populate this diagram"). No layout pass attempted.
- **Many environments**: default to the first by `name` ascending. User switches via the header dropdown.

**Q4: Diagram-row arrays — do we materialise `DiagramNode` / `DiagramEdge` rows for the auto-laid-out elements?**
**Answer:** No. Virtual Service cards, Data entity chips, and auto-laid-out containers exist only at render time. `diagram.diagram_nodes` and `diagram.diagram_edges` stay `[]` always for Infrastructure-V2 diagrams. No `DiagramNode` rows are ever created for the auto-laid-out elements; the renderer materialises them from `metaModel.entities.*` keyed by the chosen `environment_id`.

**Q5: General DiagramType palette — keep spec 5's Infra entity types in General's palette?**
**Answer:** Keep them. General is the free-form authoring playground; users can still place Infrastructure-domain entities on a General diagram by hand. Spec 5's palette wiring is unchanged.

**Q6: Spec 5 wiring retirement?**
**Answer:** Leave intact and additive. V2 is enhancement only — no retirement of any existing wiring (`DOMAIN_ENTITY_SECTIONS.infrastructure`, `domainToPaletteSections.infrastructure`, `DIAGRAM_TYPE_PALETTE_RULES.Infrastructure`, `entityColors`, the 2-3 `RELATIONSHIP_EDGE_TYPES` constants, `createRelationshipEdge` cases, `getEntitiesOnDiagram` polymorphic block, the `SelectionInspector` arms, etc., all stay). The V2 renderer simply short-circuits the `Canvas.tsx` path for `'Infrastructure'` `DiagramType`; the underlying wiring is still useful for the spec 5 authoring fallback should it be re-enabled later.

**Q7: Re-layout button scope — does it reset filter-chip state or only positions?**
**Answer:** Positions only. Filter-chip state is independent persistent state and is **not** reset by Re-layout. Re-layout discards manual session-only nudges and re-runs the layout algorithm with the current Environment scope and current chip state.

### Inferred Decisions (all 10 accepted as-is)

These were inferred from the codebase grounding and the spec 5 precedent, and accepted by the user without override:

1. **Custom SVG renderer, no new diagram-engine dependency** — `InfrastructureDiagramRenderer.tsx` is a standalone React component drawing SVG, parallel to `SequenceDiagramRenderer.tsx`. No React Flow / dagre / cytoscape dependency added.
2. **Hand-rolled layout helper, pure function** — extracted to `frontend/src/utils/infrastructureLayout.ts`. Takes `(metaModel, environmentId, filters)` and returns a positioned tree of virtual nodes + cross-domain edges. No npm dependency.
3. **PalettePanel hidden / short-circuited for V2** — when the active diagram is Infrastructure-V2, the palette is collapsed or hidden. Authoring posture is view-mostly per the raw idea.
4. **`SelectionInspector` reused from spec 5** — when V2 selects a virtual node, the existing spec 5 entity-type / relationship-type inspector arms are reused. No inspector duplication. Edits flow through the existing entity-update dispatch.
5. **Manual drag state is component-local** — `InfrastructureDiagramRenderer.tsx` owns `useState<Record<string, {x, y}>>` for session-only nudges. Never persisted. Cleared on Environment switch and on Re-layout click.
6. **Filter chips toggle layer visibility post-layout** — chips do NOT re-run layout; they hide/show layers without recomputing positions. Environment switch re-runs layout.
7. **Lenient containment** — walk each entity's parent chain (FKs and `resource_subnet_hostings`) and place at the deepest defined container. Skip undefined intermediate levels. Empty containers hidden. Sparse models render usefully.
8. **Cross-domain edges drawn last** — Service→LB/Listener edges (default ON), Service→IR edges (default OFF). Routed around containers via basic edge routing; no advanced sequence-style auto-arrangement (raw idea out-of-scope item).
9. **Multi-deployment Service cards** — when a Service has multiple `application_compute_deployments` rows, render one Service card inside each Compute Resource it's deployed to (no canonical pick). Matches the multi-deployment decision from the raw idea.
10. **Test scope is layout helper + renderer smoke** — likely 1 test for `infrastructureLayout.ts` (pure function, easy to test against fixture metaModels) + 1 test for `InfrastructureDiagramRenderer.tsx` rendering. No backend, no save-roundtrip, no full-canvas interaction tests.

### Existing Code to Reference

The codebase grounding identified the following reference points for V2:

- **`frontend/src/components/DiagramsView/SequenceDiagramRenderer.tsx`** — closest architectural precedent for a parallel, auto-laid-out, view-mostly renderer that bypasses `Canvas.tsx`. New `InfrastructureDiagramRenderer.tsx` follows this template.
- **`frontend/src/components/DiagramsView/DiagramsView.tsx`** — branch point. Existing `isSequenceDiagram` / `isJourneyDiagram` / `isOverviewDiagram` branches are the precedent for the new `isInfrastructureDiagram` branch.
- **`frontend/src/components/DiagramsView/Canvas.tsx`** — bypassed for V2. Used for spec 5 authoring fallback only (left in place per Q6).
- **`frontend/src/components/DiagramsView/PalettePanel.tsx`** — short-circuited / hidden for V2 (per inferred decision 3).
- **`frontend/src/components/DiagramsView/SelectionInspector.tsx`** — the 12 entity arms + 3 relationship arms from spec 5 are reused when a V2 virtual node / edge is selected (per inferred decision 4).
- **`frontend/src/types/model.ts:2094`** — `Diagram.settings?: Record<string, unknown>` — already accepts arbitrary keyed settings; `infrastructure` key fits without any schema change. Optional typed sub-shape can be added (see Section "Type-Shape Verification" below).
- **Existing `Diagram.settings` users**:
  - `journeyDiagram` settings (User Journey diagrams) — direct precedent for environment-scoped, filter-state-persisted settings.
  - `overviewDiagram` settings (Overview diagrams) — direct precedent for view-mostly auto-laid-out settings.
- **`metaModel.entities.application_compute_deployments`** (spec 6) — source of truth for Service cards rendered inside Compute Resources.
- **`metaModel.entities.data_entity_data_store_hostings`** (spec 6) — source of truth for Data entity chips rendered inside Data Store boxes.
- **`metaModel.entities.application_load_balancer_exposures`** (spec 6) — source of truth for Service → LB/Listener edges.
- **`metaModel.entities.application_infrastructure_resource_uses`** (spec 6) — source of truth for Service → Infrastructure Resource edges.
- **`metaModel.entities.resource_subnet_hostings`** (spec 3) — used by lenient containment walk to attach resources to subnets.
- **`metaModel.entities.compute_resources` with `cluster_id`** (spec 3) — drives Compute Cluster nesting (dashed-border container).

### Follow-up Questions

No follow-up questions were required. All 7 open questions answered concretely; all 10 inferred decisions accepted as-is.

## Visual Assets

### Files Provided

Bash check on `agent-os/specs/2026-05-05-infrastructure-diagram-auto-layout-and-cross-domain-overlay/planning/visuals/` returned no image / PDF files.

No visual assets provided.

### Visual Insights

N/A — the raw idea contains an ASCII mockup that fully captures the V2 layout intent (Environment > CloudAccount > Location > Network > Subnet > ComputeResource hierarchy with LB/Listener tier above, IR shelf to the side, Cluster as dashed container, Service cards inside Compute Resources, Data entity chips inside Data Stores, cross-domain edges on top). The ASCII mockup at `00-raw-idea.md` lines 62-114 is the design source.

## Component Architecture Summary

V2 introduces a parallel renderer track alongside the spec 5 wiring (which stays intact for the General-DiagramType authoring playground use case).

**Component layout for Infrastructure-V2 diagrams:**

1. **`InfrastructureDiagramRenderer.tsx`** (NEW) — parallel to `SequenceDiagramRenderer.tsx`. Owns:
   - Layout invocation via `infrastructureLayout(metaModel, environmentId, filters)`.
   - Manual drag state (`useState<Record<string, {x, y}>>`, session-only).
   - SVG rendering of containers, virtual nodes, cross-domain edges.
   - Header controls (Environment dropdown, 5 layer chips, 2 edge-overlay chips, Re-layout button).
   - Selection dispatch into the reused `SelectionInspector`.
2. **`DiagramsView.tsx`** (MODIFY) — add `isInfrastructureDiagram` branch parallel to existing `isSequenceDiagram` / `isJourneyDiagram` / `isOverviewDiagram` branches. When true, swap to `<InfrastructureDiagramRenderer>` instead of `<Canvas>`.
3. **`PalettePanel.tsx`** (MODIFY) — short-circuit / hide when `diagramType === 'Infrastructure'`. Authoring is disallowed; palette has no role.
4. **`SelectionInspector.tsx`** (UNCHANGED) — V2 dispatches to the same 12 entity arms + 3 relationship-edge arms from spec 5 when a virtual node / edge is selected. No new inspector code.
5. **`Canvas.tsx`** (UNCHANGED) — bypassed for V2. Still used for the General DiagramType authoring playground (where Infra entities can still be placed manually) and for any other non-Infrastructure DiagramType.

## Layout Algorithm Specification

Pulled verbatim from raw idea, lines 116-132:

1. **Pick Environment** — header dropdown, default to first by `name` ascending if many, empty-state if zero.
2. **Build lenient containment tree** — Environment → CloudAccounts → Locations → Networks → Subnets → ComputeResources, walking up each entity's parent chain (FKs + `resource_subnet_hostings`) to find the deepest defined container. Compute Resources also branch via `cluster_id`. Skip undefined intermediate levels; empty containers hidden.
3. **Hierarchical layout pass** — hand-rolled (no new npm dep). Each container = bounded rectangle, header at top. Siblings packed horizontally at each level. Containers grow to fit children.
4. **Tier overlays** (after main pass):
   - **Load Balancers** placed at a tier above their Network (`network_id` if set, else above the entire region).
   - **Listeners** drawn inside their Load Balancer box.
   - **Infrastructure Resources** placed in a "Regional Resources" shelf below/beside the Network, sorted by `resource_type`.
   - **Data Stores** placed in their hosting Subnet (deduced from `resource_subnet_hostings`); hosted Data entity chips render inside.
5. **Cross-domain Service cards** — rendered as children inside their Compute Resource (from `application_compute_deployments`). Multi-deployment: one Service card in each Compute Resource the Service is deployed to (no canonical pick). Visual treatment: subtle "Application domain" border (different colour than infra) to signal cross-domain origin.
6. **Cross-domain edges** drawn last — Service → LB/Listener (default ON), Service → IR (default OFF). Routed around containers via basic routing only; no advanced sequence-style auto-arrangement (raw idea out-of-scope item).
7. **Manual nudges** — session-only `useState`. Re-layout button discards them. Environment switch also discards them.

### Compute Cluster Handling

- **Render as dashed-border container** labelled with `platform_type` (e.g. "GKE", "Cloud Run", "VMware") and `version` if set.
- **`Compute Resource.cluster_id IS NOT NULL`** → render Compute Resource (pod) nested inside Cluster container.
- **`cluster_id IS NULL`** (Cloud Run service, standalone VM) → render Compute Resource directly in its Subnet/Network.
- **Cluster spans subnets** (common for GKE multi-subnet node pools) → cluster container placed at the parent **Network** level, pods nested inside; cluster is **NOT** split across subnets visually.

### Header Controls Layout

Header (left → right):

| Control | Default | Behaviour |
|---|---|---|
| Environment dropdown | First Environment by `name` ascending | Switching re-runs layout, clears manual nudges |
| Compute layer chip | ON | Toggles Compute Resource visibility (no relayout) |
| Data Stores layer chip | ON | Toggles Data Store visibility (no relayout) |
| Load Balancers layer chip | ON | Toggles LB + Listener visibility (no relayout) |
| Infrastructure Resources layer chip | ON | Toggles IR shelf visibility (no relayout) |
| Services layer chip | ON | Toggles Service-card overlay visibility (no relayout) |
| S→LB edges chip | ON | Toggles Service→LB/Listener edges (no relayout) |
| S→IR edges chip | OFF | Toggles Service→IR edges (no relayout) |
| Re-layout button | — | Discards manual nudges, re-runs layout. **Does not** reset filter chips. |

### Settings Persistence Shape

```ts
diagram.settings.infrastructure = {
  environment_id?: string,
  filters?: {
    compute?: boolean,                   // default ON  (true if undefined)
    data_stores?: boolean,               // default ON  (true if undefined)
    load_balancers?: boolean,            // default ON  (true if undefined)
    infrastructure_resources?: boolean,  // default ON  (true if undefined)
    services?: boolean,                  // default ON  (true if undefined)
    service_to_lb_edges?: boolean,       // default ON  (true if undefined)
    service_to_ir_edges?: boolean,       // default OFF (false if undefined)
  },
};
```

- Default-on chips treated as `true` if their key is undefined.
- Default-off chips (only `service_to_ir_edges`) treated as `false` if undefined.
- Persistence rides on existing `Diagram.settings` save/load — no backend or schema changes needed (see "Type-Shape Verification" below).

## Type-Shape Verification

`frontend/src/types/model.ts:2094` declares:

```ts
settings?: Record<string, unknown>;
```

This already accepts the new `infrastructure` key without any model.ts edit. Two implementation options:

- **Option A — no model.ts change**: the V2 renderer reads/writes `diagram.settings.infrastructure` as `unknown`, narrowing at the renderer boundary with a small type guard. Simpler diff; matches existing `journeyDiagram` / `overviewDiagram` settings handling style.
- **Option B — typed sub-shape in model.ts**: declare an `InfrastructureDiagramSettings` interface and intersect into `Diagram.settings`. Slightly more invasive (requires model.ts edit, possibly tightens existing settings shape).

**Recommendation: Option A.** No model.ts change is strictly required. If a typed sub-shape is desired for ergonomic narrowing, the type can live in `InfrastructureDiagramRenderer.tsx` or `infrastructureLayout.ts` without touching `model.ts`. Spec-writer to confirm at write-time.

## Requirements Summary

### Functional Requirements

The frontend must:

1. **Add `isInfrastructureDiagram` branch in `DiagramsView.tsx`** that swaps to `<InfrastructureDiagramRenderer>` when `diagramType === 'Infrastructure'`. Existing branches for Sequence / Journey / Overview are the template.
2. **Create `InfrastructureDiagramRenderer.tsx`** as a new SVG renderer parallel to `SequenceDiagramRenderer.tsx`. Owns layout invocation, manual drag state, header controls, selection dispatch.
3. **Create `infrastructureLayout.ts`** as a pure-function layout helper, taking `(metaModel, environmentId, filters)` and returning a positioned virtual-node tree + cross-domain edge list. Implements the 7-step algorithm above.
4. **Render Environment dropdown** in the header — populated from `metaModel.entities.environments`. Empty-state if zero. Default to first by `name` ascending if many. Switching re-runs layout and clears manual nudges.
5. **Render 5 layer filter chips** (Compute, Data Stores, Load Balancers, Infrastructure Resources, Services) — all default ON. Toggling hides/shows the layer without re-running layout.
6. **Render 2 edge-overlay chips** (S→LB default ON, S→IR default OFF). Toggling hides/shows edges without re-running layout.
7. **Render Re-layout button** — discards manual nudges and re-runs the layout pass with current Environment scope and current chip state. Does NOT reset filter chips.
8. **Build lenient containment tree** — walk each entity's parent chain (FKs + `resource_subnet_hostings`) and place at deepest defined container. Skip undefined intermediate levels. Empty containers hidden. Sparse models render usefully.
9. **Render Compute Clusters as dashed-border containers** labelled with `platform_type` + optional `version`. Compute Resources with `cluster_id` nested inside; without `cluster_id` rendered directly in Subnet/Network. Cluster-spans-subnets case: cluster placed at parent Network level, pods nested inside.
10. **Render Tier 1 — Load Balancers** at a tier above the Network with Listeners drawn inside the LB box. Routes-to edges drawn from Listener/LB to target Compute Resource.
11. **Render Tier 2 — Infrastructure Resources** in a "Regional Resources" shelf below/beside the Network, sorted by `resource_type`.
12. **Render Tier 3 — Data Stores** in their hosting Subnet (via `resource_subnet_hostings`); render hosted Data entity chips inside the Data Store box (via `data_entity_data_store_hostings`).
13. **Render cross-domain Service cards** as children inside Compute Resources via `application_compute_deployments`. Multi-deployment: one card in each Compute Resource. Visual: subtle "Application domain" border colour to signal cross-domain origin.
14. **Render cross-domain edges last** — Service → LB/Listener edges (default ON via `application_load_balancer_exposures`); Service → IR edges (default OFF via `application_infrastructure_resource_uses`). Basic routing around containers; no advanced edge layout.
15. **Allow manual drag-to-nudge** — session-only `useState<Record<string, {x, y}>>`. Never persisted. Cleared on Environment switch and Re-layout click.
16. **Disallow palette-driven authoring** — `PalettePanel.tsx` short-circuits / hides for `'Infrastructure'` `DiagramType`. No canvas-drag-to-add. No draw-edges-to-create-relationships.
17. **Reuse `SelectionInspector` arms** from spec 5 — selecting a virtual node or edge dispatches to the existing 12 entity arms + 3 relationship arms. Inspector edits flow through the existing entity-update dispatch (writing back to model entities, not to the diagram).
18. **Persist Environment scope and filter-chip state** in `diagram.settings.infrastructure = { environment_id, filters: {...} }`. Reopening the diagram restores both. No backend / schema changes.
19. **`diagram.diagram_nodes` and `diagram.diagram_edges` stay `[]`** for Infrastructure-V2 diagrams. No `DiagramNode` rows ever created for the auto-laid-out elements.
20. **Leave spec 5 wiring intact** — V2 is enhancement only. Existing palette wiring, `entityColors`, `RELATIONSHIP_EDGE_TYPES`, `createRelationshipEdge` cases, polymorphic point resolution, and inspector arms all stay (used by the General DiagramType authoring fallback).
21. **Keep spec 5's Infra entity types in the General DiagramType palette** — General is the free-form authoring playground; Infra entities can still be placed manually there.
22. **Add ~2 Vitest tests**:
    - 1 layout-pass test against `infrastructureLayout.ts` with a fixture `metaModel` (containment tree, cluster handling, sparse model).
    - 1 renderer rendering test asserting the renderer produces SVG output for a representative `metaModel + environmentId`.
23. **Preserve existing behaviour** for all non-Infrastructure diagram types and the General DiagramType. No regressions.

### File-Touch Summary

| # | File | Action |
|---|---|---|
| 1 | `frontend/src/components/DiagramsView/InfrastructureDiagramRenderer.tsx` | **CREATE** — main component, owns layout invocation + drag state + header controls + SVG render. |
| 2 | `frontend/src/utils/infrastructureLayout.ts` | **CREATE** — hand-rolled layout helper, pure function. Implements 7-step algorithm. |
| 3 | `frontend/src/components/DiagramsView/DiagramsView.tsx` | **MODIFY** — add `isInfrastructureDiagram` branch; swap to new renderer. |
| 4 | `frontend/src/components/DiagramsView/PalettePanel.tsx` | **MODIFY** — short-circuit / hide for `'Infrastructure'` `DiagramType`. |
| 5 | `frontend/src/types/model.ts` | **OPTIONAL** — only if a typed `InfrastructureDiagramSettings` sub-shape is desired. Existing `settings?: Record<string, unknown>` already accepts the new key without changes. |
| 6 | `frontend/src/utils/__tests__/infrastructureLayout.test.ts` | **CREATE** — layout-pass test. |
| 7 | `frontend/src/components/DiagramsView/__tests__/InfrastructureDiagramRenderer.test.tsx` | **CREATE** — renderer rendering test. |

**Files NOT to touch** (left intact per Q6):
- `frontend/src/types/diagramType.ts` — `'Infrastructure'` already in `DiagramType` union (spec 5).
- `frontend/src/utils/paletteData.ts` — spec 5 wiring stays.
- `frontend/src/config/defaults.ts` — spec 5 `entityColors` + container-dimension overrides stay.
- `frontend/src/utils/relationshipUtils.ts` — spec 5 `createRelationshipEdge` cases, `isRelationshipRowEnabled` cases, `getEntitiesOnDiagram` polymorphic block all stay.
- `frontend/src/components/DiagramsView/SelectionInspector.tsx` — spec 5 entity + relationship arms reused as-is.
- `frontend/src/components/DiagramsView/Canvas.tsx` — bypassed for V2; still used elsewhere.

### Reusability Opportunities

- **`SequenceDiagramRenderer.tsx`** — closest architectural template. Same parallel-renderer-bypassing-Canvas pattern, same view-mostly authoring posture, same auto-layout-from-model-data shape.
- **`Diagram.settings` slot pattern** (used by `journeyDiagram`, `overviewDiagram`) — direct precedent for environment-scoped, filter-state-persisted settings.
- **`SelectionInspector.tsx` spec 5 arms** — reused without modification; V2 dispatches into the same arms when virtual nodes/edges are selected.
- **`metaModel.entities.application_compute_deployments` / `data_entity_data_store_hostings` / `application_load_balancer_exposures` / `application_infrastructure_resource_uses`** (spec 6) — already populated; V2 just reads them at render time.

### Scope Boundaries

**In Scope:**
- New `InfrastructureDiagramRenderer.tsx` parallel renderer with header controls, SVG layout, manual drag (session-only).
- New `infrastructureLayout.ts` pure-function layout helper implementing the 7-step algorithm.
- `isInfrastructureDiagram` branch in `DiagramsView.tsx`.
- PalettePanel short-circuit for `'Infrastructure'` `DiagramType`.
- Lenient containment tree, tier overlays (LB/Listener, IR shelf, Data Store + entity chips).
- Compute Cluster as dashed-border container, including spans-subnets case.
- Cross-domain Service cards (multi-deployment: one per Compute Resource).
- Cross-domain Service → LB/Listener edges (default ON) and Service → IR edges (default OFF).
- Header dropdown for Environment (default first by `name` asc; empty-state if zero).
- 5 layer filter chips + 2 edge-overlay chips (default-on/default-off per Q-spec).
- Re-layout button (positions only; chip state untouched).
- Persistence of Environment scope + filter state in `diagram.settings.infrastructure`.
- Reuse of spec 5 `SelectionInspector` arms.
- ~2 Vitest tests (layout helper + renderer smoke).

**Out of Scope** (raw idea exclusions):
- Authoring on the canvas (use Tables UI or General DiagramType).
- Cost / monitoring / IAM / compliance overlays.
- Live cloud provider integration.
- Drift detection between model and actual cloud state.
- Sequence-style auto-arrangement of cross-domain edges (basic routing only).
- Multi-environment side-by-side comparison.
- Retirement of spec 5 wiring (left intact and additive — Q6).
- Materialising `DiagramNode` / `DiagramEdge` rows for V2 (Q4).
- Persisting manual drag positions back to the model (session-only — Q1, raw idea).
- Backend / Gateway / MCP / Discovery / Terraform / save-pipeline changes.
- New diagram-engine npm dependencies (hand-rolled layout — inferred decision 2).
- New cloud-provider iconography (provider-neutral mandate from spec 5).

### Technical Considerations

- **Custom SVG renderer; no React Flow / dagre dependency** — stays consistent with `SequenceDiagramRenderer.tsx`.
- **Hand-rolled layout** in `infrastructureLayout.ts` — pure function, easy to unit-test against fixture metaModels.
- **`Diagram.settings?: Record<string, unknown>`** already accepts the new `infrastructure` key without model.ts edits (Option A above). Typed sub-shape (Option B) is optional ergonomic upgrade.
- **`diagram_nodes` / `diagram_edges` stay `[]`** for V2 — virtual nodes are render-time only. Save/load via existing model PUT round-trip; only `settings.infrastructure` carries V2-specific state.
- **Manual nudges are session-only `useState`** in `InfrastructureDiagramRenderer.tsx`. Never written back. Cleared on Environment switch + Re-layout.
- **Spec 5 wiring stays intact** — General DiagramType authoring playground continues to support manually-placed Infra entities. V2 is a parallel track, not a replacement.
- **Cross-domain edge routing is basic** — straight lines or simple orthogonal routing, sidestepping container rectangles. No advanced edge layout / collision avoidance / waypoint editing.
- **Multi-deployment Services render once per Compute Resource** — no canonical pick, matches the `application_compute_deployments` decision from raw idea.
- **Sparse models render usefully** — lenient containment walk skips undefined levels; empty containers hidden; header chips softly note missing layers without blocking render.
- **Backward compatibility** — existing diagrams (Infrastructure spec 5 authored, or any other type) continue to work unchanged. Spec 5 General-DiagramType authoring of Infra entities continues to work via the unchanged spec 5 wiring.

## Acceptance Criteria

(Pulled from raw idea, lines 143-161, preserved verbatim.)

- Selecting `'Infrastructure'` `DiagramType` opens an environment picker (or auto-selects if only one Environment exists).
- The diagram renders the containment hierarchy from the model data, skipping undefined levels.
- Compute Clusters render as dashed-border containers with their Compute Resources nested inside.
- Compute Resources without a cluster render directly in their Subnet (or deeper-defined parent).
- Cluster-spans-subnets case renders the cluster at the parent Network level, not split.
- Service entities (cross-domain via `application_compute_deployments`) render as nested cards inside each Compute Resource they're deployed to.
- Data entities (cross-domain via `data_entity_data_store_hostings`) render as chips inside their Data Store box.
- Load Balancers and Listeners render at a tier above the network with `routes-to` edges to targets.
- Infrastructure Resources render in a regional shelf.
- Service → Load Balancer edges render by default; Service → Infrastructure Resource edges hidden by default; both toggleable in header.
- Filter chips in the header toggle each layer (Compute, Data Stores, LBs, IRs, Services) on/off without re-running layout.
- Environment dropdown switches scope and re-runs layout.
- Re-layout button discards manual positions and re-runs algorithm.
- User can drag nodes (session-only positions); cannot add entities or draw new edges from canvas.
- Existing General DiagramType continues to work as the free-form authoring playground.
- Sparse models (e.g. Environment + Compute Resources only, no Cloud Account/Network/Subnet defined) render usefully.
- Existing non-Infrastructure diagrams continue to work unchanged.
