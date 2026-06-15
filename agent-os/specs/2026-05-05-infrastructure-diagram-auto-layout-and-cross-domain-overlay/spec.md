# Specification: Infrastructure Diagram V2 — Auto-Layout & Cross-Domain Overlay

## Goal
Replace the runtime behaviour of the spec 5 `'Infrastructure'` `DiagramType` with an environment-rooted, auto-laid-out, view-mostly diagram that materialises containment, tier overlays, cross-domain Service cards, Data entity chips, and cross-domain edges from the meta-model at render time — so an Infrastructure diagram earns a distinct reason to exist alongside Sequence and User Journey.

## User Stories
- As an architect, I want to open an Infrastructure diagram, pick an Environment, and immediately see the runtime topology of that environment auto-laid-out from the model so that I get a meaningful runtime view without hand-placing nodes.
- As an architect, I want Services from the Application domain to appear as cards inside their Compute Resources and Data entities to appear as chips inside their Data Stores so that I can read cross-domain placement without leaving the diagram.

## Specific Requirements

**New `InfrastructureDiagramRenderer.tsx`**
- Create at `frontend/src/components/DiagramsView/InfrastructureDiagramRenderer.tsx`, parallel to `SequenceDiagramRenderer.tsx` and `UserJourneyDiagramRenderer.tsx`.
- Reads `metaModel.entities.*` and `diagram.settings.infrastructure` (Environment id + filter state).
- Calls `infrastructureLayout(metaModel, environmentId, filters)` to compute the virtual node tree.
- Renders SVG output: containers, virtual nodes, cross-domain Service cards, Data entity chips, cross-domain edges.
- Owns header bar with Environment dropdown, 5 layer chips, 2 edge-overlay chips, Re-layout button.
- Persists Environment + filter changes to `diagram.settings.infrastructure` via the existing `UPDATE_DIAGRAM` reducer action.
- Bypasses `Canvas.tsx`; never dispatches `UPDATE_DIAGRAM_NODE` and never writes to `diagram.diagram_nodes` / `diagram.diagram_edges` (both stay `[]`).
- Owns drag state in component-local `useState<Record<string, {x, y}>>` — session-only nudges, cleared on Environment switch and Re-layout click.
- Selection dispatches into the existing `SelectionInspector` arms from spec 5 (no inspector code changes).

**New `infrastructureLayout.ts` pure-function helper**
- Create at `frontend/src/utils/infrastructureLayout.ts`. Pure function: `(metaModel, environmentId, filters) -> { nodes, edges }`.
- Step 1 — Lenient containment tree: walk each entity's parent chain (FKs + `resource_subnet_hostings`) and attach at the deepest defined container; skip undefined intermediate levels; hide empty containers.
- Step 2 — Compute Cluster handling: render as dashed-border container labelled with `platform_type` + optional `version`; nest Compute Resources via `cluster_id`; cluster-spans-subnets case places the cluster at the parent Network level (not split across subnets).
- Step 3 — Tier overlays: Load Balancers placed above their Network with Listeners drawn inside the LB box; Infrastructure Resources placed in a "Regional Resources" shelf sorted by `resource_type`; Data Stores placed in their hosting Subnet via `resource_subnet_hostings`, with hosted Data entity chips inside via `data_entity_data_store_hostings`.
- Step 4 — Cross-domain Service cards: for each `application_compute_deployments` row, render a Service card inside each Compute Resource the Service is deployed to (multi-deployment renders one card per Compute Resource; no canonical pick). Visual treatment: subtle "Application domain" border to signal cross-domain origin.
- Step 5 — Cross-domain edges: emit Service → LB/Listener edges from `application_load_balancer_exposures` and Service → IR edges from `application_infrastructure_resource_uses`; filter by edge-overlay chip state; basic routing only (straight / simple orthogonal), no advanced edge layout.
- Hand-rolled hierarchical pass: containers grow to fit children, siblings packed horizontally at each level, header at top of each container; no new npm dependency.

**`DiagramsView.tsx` branch addition**
- Add `isInfrastructureDiagram` flag derived from `diagramType === 'Infrastructure'`, mirroring `isSequenceDiagram` / `isJourneyDiagram` / `isOverviewDiagram`.
- When true, swap the Canvas branch to `<InfrastructureDiagramRenderer>` and short-circuit the `PalettePanel` branch.
- Preserve existing branches and behaviour for all other diagram types.

**`PalettePanel.tsx` short-circuit**
- Hide / short-circuit when `diagramType === 'Infrastructure'`. Spec 5's palette wiring (`DOMAIN_ENTITY_SECTIONS.infrastructure`, `domainToPaletteSections.infrastructure`, `DIAGRAM_TYPE_PALETTE_RULES.Infrastructure`, `entityColors`, relationship sections, `getEntityTypeConstant` mappings) stays intact and additive — used by the General `DiagramType` authoring playground.

**`Diagram.settings.infrastructure` persisted shape**
- No `model.ts` change required — `Diagram.settings?: Record<string, unknown>` already accepts the new key.
- Shape: `{ environment_id?: string, filters?: { compute?: boolean, data_stores?: boolean, load_balancers?: boolean, infrastructure_resources?: boolean, services?: boolean, service_to_lb_edges?: boolean, service_to_ir_edges?: boolean } }`.
- Default-on chips treated as `true` if undefined; `service_to_ir_edges` treated as `false` if undefined.
- Renderer narrows the `unknown` value at the boundary with a small type guard; typed sub-shape (if desired) lives inside the renderer or layout module, not in `model.ts`.

**Header controls**
- Environment dropdown — populated from `metaModel.entities.environments`; default to first by `name` ascending; empty-state message when zero environments ("Create an Environment in the Tables UI to populate this diagram"); switching re-runs layout and clears manual nudges.
- 5 layer chips (Compute, Data Stores, Load Balancers, Infrastructure Resources, Services), all default ON; toggling hides/shows the layer without re-running layout.
- 2 edge-overlay chips (S→LB default ON, S→IR default OFF); toggling hides/shows edges without re-running layout.
- Re-layout button — discards manual nudges and re-runs the layout pass with current Environment scope and current chip state; does NOT reset filter chips.

**Selection and authoring posture**
- Selecting a virtual node or edge dispatches into the existing spec 5 `SelectionInspector` arms (12 entity arms + 3 relationship arms) plus the spec 6 cross-domain relationship arms; inspector edits flow through the existing entity-update dispatch and write back to model entities, never to the diagram.
- No palette, no canvas-drag-to-add, no draw-edges-to-create-relationships. Authoring stays in the Tables UI (spec 4) and the General `DiagramType`.

**Cross-domain edge wiring**
- Reuse the existing spec 6 `createRelationshipEdge` arms for `application_load_balancer_exposures` and `application_infrastructure_resource_uses` to emit edge geometry; no new edge types.
- Edges target the auto-rendered virtual Compute / LB / Listener / IR nodes by entity id.
- Routing is basic (straight or simple orthogonal); container clipping is acceptable for V1 per the raw idea.

**Tests**
- `frontend/src/utils/__tests__/infrastructureLayout.test.ts` — layout-pass unit test against a fixture meta-model: asserts lenient hierarchy walk (skip undefined levels, hide empty containers), Compute Cluster handling (dashed container, `cluster_id` nesting, cluster-spans-subnets case), and cross-domain Service card placement (one card per Compute Resource for multi-deployment Services).
- `frontend/src/components/DiagramsView/__tests__/InfrastructureDiagramRenderer.test.tsx` — renderer smoke test: mounts the component with a fixture diagram + meta-model, asserts the Environment dropdown and 5 layer chips + 2 edge-overlay chips render.

**Backward compatibility**
- Spec 5 wiring intact and additive; no retirement.
- Existing diagrams of any type continue to render unchanged.
- General `DiagramType` keeps the full Infrastructure entity palette for free-form authoring.
- `diagram.diagram_nodes` and `diagram.diagram_edges` always `[]` for Infrastructure-V2 diagrams; round-trip via the existing model PUT carries only `settings.infrastructure`.

## Visual Design

**`planning/00-raw-idea.md` ASCII mockup (lines 62-114)**
- Outer container is the Environment, labelled "ENVIRONMENT: PROD".
- Nested rectangles for Cloud Account → Location → Network → Subnet → Compute Resource, each with a header label at the top.
- Load Balancer + Listener tier sits ABOVE the Network with a `routes-to` edge dropping into the relevant Compute Resource.
- Compute Resources contain Service cards rendered with a distinct border colour to mark cross-domain origin (Application domain); each card shows Service name, role, and DU reference.
- Data Stores sit inside a Subnet and contain Data entity chips (`[Order] [Customer] [Address]`).
- "Regional Infrastructure Resources" is a separate shelf below/beside the Network listing IRs as small diamond-marked rows sorted by `resource_type`.
- GKE example shows Compute Cluster as a dashed-border container labelled with `platform_type` + version, Compute Resources nested inside.
- Cross-domain edges are drawn over the top of containers, labelled (`uses (PUBLISHES_TO)`, `routes-to`).

## Existing Code to Leverage

**`frontend/src/components/DiagramsView/SequenceDiagramRenderer.tsx`**
- Closest architectural template: parallel renderer that bypasses `Canvas.tsx`, computes layout from typed model data, owns its own SVG output and header.
- New `InfrastructureDiagramRenderer.tsx` follows this shape but reads from `metaModel.entities.*` keyed by `environment_id` instead of from `typedContent`.

**`frontend/src/components/DiagramsView/DiagramsView.tsx`**
- Existing `isSequenceDiagram` / `isJourneyDiagram` / `isOverviewDiagram` branch points (Canvas branch ~line 4756–4807, right-panel branch ~line 4817) are the precedent for the new `isInfrastructureDiagram` branch.
- Header bar (line 3899) with `toolbarRow1` / conditional `toolbarRow2` is the pattern for the conditional Infrastructure-controls row (Environment dropdown, chips, Re-layout).

**`frontend/src/components/DiagramsView/SelectionInspector.tsx`**
- Spec 5's 12 Infra entity arms + 3 Infra-internal relationship arms and spec 6's 4 cross-domain relationship arms are reused as-is when V2 selects a virtual node / edge — no inspector duplication.

**`frontend/src/types/model.ts:2094` `Diagram.settings?: Record<string, unknown>`**
- Already accepts the new `infrastructure` key. Direct precedent: `journeyDiagram` and `overviewDiagram` settings keys used by `diagramExtractionUtils.ts`.

**Spec 6 cross-domain relationship arrays on `metaModel.entities`**
- `application_compute_deployments`, `data_entity_data_store_hostings`, `application_load_balancer_exposures`, `application_infrastructure_resource_uses` are already populated and have `createRelationshipEdge` arms; V2 reads them at render time.
- `resource_subnet_hostings` (spec 3) is the source for Subnet placement of Compute Resources, Data Stores, LBs, and IRs via the polymorphic walk.

## Out of Scope
- Adding a new `DiagramType` value (V2 replaces the runtime behaviour of spec 5's `'Infrastructure'`, no new type).
- Backend / Gateway / MCP / Discovery / Terraform / save-pipeline changes.
- New entity types or relationship types.
- Changes to the Tables UI or `gridConfigs`.
- Authoring on the V2 canvas: no palette, no drag-to-add, no edge drawing.
- Persisting manual drag positions to the model (session-only `useState` only).
- Auto-relayout on entity rename or model edits (refresh in place; Re-layout is explicit user action).
- Materialising `DiagramNode` / `DiagramEdge` rows for V2 elements.
- Cost / monitoring / IAM / compliance overlays; live cloud integration; drift detection; multi-environment side-by-side comparison.
- New npm dependencies (no React Flow / dagre / elkjs / cytoscape — hand-rolled layout).
- Sequence-style auto-arrangement of cross-domain edges (basic routing only).
- Cloud-provider iconography (provider-neutral mandate from spec 5 stays).
- Retirement of any spec 5 wiring; modifications to `Canvas.tsx`, `paletteData.ts`, `defaults.ts`, `relationshipUtils.ts`, or `SelectionInspector.tsx`.
