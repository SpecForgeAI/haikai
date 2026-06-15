# Codebase Grounding — Infrastructure Diagram V2 (Auto-Layout & Cross-Domain Overlay)

Pass A grounding notes. Cross-checks the locked design in `00-raw-idea.md` against the current frontend.

## 1. Prior 7-spec Infrastructure arc — confirmed locked surface

| # | Spec folder | Surface relevant to V2 |
|---|---|---|
| 1 | `2026-05-04-infrastructure-domain-backend-foundation` | 12 entity tables + `infrastructure_points` polymorphic supertype + 3 Infra-internal relationships. `compute_resources.cluster_id` (nullable FK) and `resource_subnet_hostings` (polymorphic via `infrastructure_point_id` + `subnet_id`) confirmed present. |
| 2 | `2026-05-04-infrastructure-domain-backend-api` | Per-domain REST layer; round-trip works through full-model PUT. |
| 3 | `2026-05-04-infrastructure-domain-frontend-types` | `frontend/src/types/model.ts` exports `Environment`, `CloudAccount`, `Location`, `Network`, `Subnet`, `ComputeCluster`, `ComputeResource`, `LoadBalancer`, `Listener`, `DataStoreInstance`, `InfrastructureResource`, `InfrastructurePoint`, `ResourceSubnetHosting`, `DeploymentUnitComputeResource`, `LoadBalancerResourceRoute`. All FKs (`environment_id`, `cloud_account_id`, `location_id`, `network_id`, `cluster_id`, `compute_resource_id`, `load_balancer_id`) are nullable on the entity types. `Subnet.network_id` is nullable. `ComputeResource.cluster_id` is nullable. |
| 4 | `2026-05-04-infrastructure-domain-tables-ui` | Tables UI is the authoring path for Infra entities — V2 keeps it as the only authoring surface. |
| 5 | `2026-05-05-infrastructure-domain-diagram-support` | Registered `'Infrastructure'` `DiagramType`, palette wiring, 12 `entityColors`, container default-dimension overrides, 3 relationship edge types + `createRelationshipEdge` cases for `DEPLOYMENT_UNIT_COMPUTE_RESOURCE` and `LOAD_BALANCER_RESOURCE_ROUTE`, polymorphic `infrastructurePointsOnDiagram` Set in `getEntitiesOnDiagram`, 12 + 3 minimal `SelectionInspector` arms. **This is the surface V2 replaces.** |
| 6 | `2026-05-05-infrastructure-cross-domain-integration` | 4 cross-domain relationships fully wired both backend + frontend: `application_compute_deployments`, `data_entity_data_store_hostings`, `application_infrastructure_resource_uses`, `application_load_balancer_exposures`. All four have `createRelationshipEdge` cases, edge defaults, and minimal inspector arms. **V2 reads these tables to render Service cards inside Compute Resources, Data entity chips inside Data Stores, S→LB and S→IR cross-domain edges.** |
| 7 | `2026-05-05-infrastructure-terraform-discovery-readiness` | Adds 11 provenance + readiness fields per Infra entity and 6 provenance fields per Infra-internal relationship. **V2 ignores these fields** — orthogonal. |

## 2. Frontend diagram engine — current behaviour

### Canvas + DiagramsView
- `Canvas.tsx` (3,782 lines) is the generic SVG renderer for `DiagramNode[]` + `DiagramEdge[]`.
- `DiagramsView.tsx` (4,977 lines) at line 4756–4807 dispatches: temporary-diagram banner > journey review > overview review > generic Canvas. **Canvas is used for every non-Sequence/non-UI_SCREEN diagram, including Infrastructure as built by spec 5.**
- Right-side panel swap (line 4817): `isSequenceDiagram` → `SequenceEditorPanel`, `isUIScreenDiagram` → `UIScreenDiagramEditorPanel`, else `PalettePanel`. **Adding a third branch for `isInfrastructureDiagram` is the established pattern** if we want a different right panel (or simply to hide it).

### Drag → persistence flow
- `Canvas.tsx` line 2194: drag commit dispatches `UPDATE_DIAGRAM_NODE` action with `updates: finalDimensions`. **This goes through the reducer and writes `pos_x`/`pos_y` into the `Diagram.diagram_nodes` array, which is persisted to the backend on save.**
- For "session-only" infrastructure positions, we need a different mechanism: keep nodes in component state, NOT in the `Diagram.diagram_nodes` array. Or: persist them but discard on Re-layout / Environment-switch / re-open.
- **Realistic V1**: keep the auto-laid-out nodes in transient component state on the V2 renderer; manual drags update only that local state; never dispatch `UPDATE_DIAGRAM_NODE` from this view. This means **`diagram.diagram_nodes` stays empty for Infrastructure-V2 diagrams** — the renderer owns the layout entirely.

### Diagram type-conditional rendering
- `PalettePanel.tsx` line 933: already extracts `diagramType = getDiagramType(fullDiagram)` and passes it to `getPaletteSections`. **For V2: simplest path is to short-circuit `PalettePanel` when `diagramType === 'Infrastructure'` and render a different panel (or nothing).**
- `Diagram.settings?: Record<string, unknown>` (model.ts:2094) is the precedent for diagram-type-specific persistent metadata — already used by `journeyDiagram` and `overviewDiagram` in `diagramExtractionUtils.ts`. **Recommended slot for `infrastructure_environment_id` and filter chip state**: `diagram.settings.infrastructure = { environment_id: '...', filters: { compute: true, data_stores: true, ... } }`.

### Auto-derive precedent (Sequence)
- `SequenceDiagramRenderer.tsx` (1,556 lines) — reads `sequenceDiagram.participants` and `messages` from the diagram's `typedContent` envelope, NOT from `diagram_nodes`/`diagram_edges`. Layout is computed in the renderer (participants spaced horizontally by `participantSpacing`, lifelines drop vertically, messages positioned by sequence). **V2 Infrastructure can follow this pattern but reading from the meta-model + Environment selection rather than from `typedContent`** — meta-model is the source of truth, no per-diagram content snapshot needed.

### Layout libraries
- **No `dagre`, `elkjs`, `cytoscape`, or any other graph layout library is in `frontend/package.json`.** All existing layouts (Sequence, ER, Activity, State, User Journey, UI Workflow) are hand-rolled. The 6 container types from spec 5 (`ENVIRONMENT`, `CLOUD_ACCOUNT`, `LOCATION`, `NETWORK`, `SUBNET`, `COMPUTE_CLUSTER`) get 320×200 default dimensions and use the existing `parent_node_id` compound-layout from `Canvas.tsx`. **A hand-rolled hierarchical pass is consistent with this codebase's posture.** Adding `elkjs` (~500KB) or `dagre` (~80KB) for a single diagram type is overkill given the structure is pure containment + a few tier overlays.

## 3. Container hierarchy — feasibility

The locked hierarchy is `Environment > CloudAccount > Location > Network > Subnet > Compute Cluster > Compute Resource > Service-card`. Walking parent FKs from `frontend/src/types/model.ts`:

- `ComputeResource`: `environment_id`, `cloud_account_id`, `location_id`, `cluster_id`. **No direct `subnet_id` FK.** Subnet hosting comes from `resource_subnet_hostings.infrastructure_point_id → infrastructure_points.compute_resource_id`. This is the polymorphic precedent the layout pass must walk.
- `ComputeCluster`: `environment_id`, `cloud_account_id`, `location_id`, `network_id` (cluster sits at network level — confirms locked decision that cluster-spans-subnets renders at parent Network).
- `Subnet`: `environment_id`, `network_id`, `location_id`. So Subnet → Network → (Location | CloudAccount | Environment) walk is straightforward.
- `Network`: `environment_id`, `cloud_account_id`, `location_id`.
- `Location`: `environment_id`, `cloud_account_id`.
- `CloudAccount`: `environment_id`.
- `LoadBalancer`: `environment_id`, `cloud_account_id`, `location_id`, `network_id`. Sits at Network tier.
- `Listener`: `load_balancer_id`, `compute_resource_id`. Renders inside its LB box.
- `DataStoreInstance`: `environment_id`, `cloud_account_id`, `location_id`. **No direct subnet FK** — subnet hosting via `resource_subnet_hostings` polymorphic.
- `InfrastructureResource`: `environment_id`, `cloud_account_id`, `location_id`. Goes on the regional shelf.

`ComputeResource.cluster_id` is nullable, supporting the locked "cluster_id IS NULL → render at Subnet level" branch directly.

## 4. Cross-domain data hooks

All four cross-domain relationship arrays are on `MetaModelRelationships` after spec 6:
- `application_compute_deployments` — has `application_point_id` (resolves through `application_points` polymorphic to `applications` or `services`) + `compute_resource_id` + optional `deployment_unit_id`. **Source-side resolution: `application_points.target_type ∈ {APPLICATION, SERVICE}` + `target_ref_id` → name.**
- `data_entity_data_store_hostings` — `data_entity_point_id` + `data_store_instance_id`. Renders entity name as a chip inside the Data Store box.
- `application_infrastructure_resource_uses` — `application_point_id` + `infrastructure_resource_id`. Cross-domain edge S→IR.
- `application_load_balancer_exposures` — `application_point_id` + `load_balancer_id` + optional `listener_id`. Cross-domain edge S→LB.

All four have `createRelationshipEdge` cases already wired by spec 6, so the **edge-drawing path is already there**. V2 just needs to (a) suppress these edges by default for S→IR, (b) toggle them via filter chips, (c) ensure they target the auto-rendered Compute / LB / IR / DataStore nodes.

## 5. Spec 5's palette — what V2 must override

Spec 5 populated:
- `DOMAIN_ENTITY_SECTIONS.infrastructure` = 12 entity sections.
- `DIAGRAM_TYPE_PALETTE_RULES.Infrastructure` = 12 entity + 3 relationship sections.
- `domainToPaletteSections.infrastructure` = same 15.

For V2 "view-mostly", **simplest override: in `DiagramsView.tsx` add `isInfrastructureDiagram` flag and short-circuit the `PalettePanel` render branch** (mirroring `isSequenceDiagram`/`isUIScreenDiagram`) — render either a thin info panel or nothing. **No need to gut spec 5's palette wiring**: it stays in place, the General DiagramType still uses it for Infra entity types if a user adds one to a free-form diagram.

## 6. Cross-domain Service rendering — virtual node decision space

A Service card inside a Compute Resource representing an `application_compute_deployments` row is **not a real `DiagramNode`** in V2 — it's a render-time visual. Two implementation paths:

- **(a) Pure virtual rendering**: layout pass computes a `LayoutNode[]` array (separate from `DiagramNode`) including the Service cards as children of the Compute Resource layout node. Renderer paints them. No `DiagramNode` row ever created. Aligned with spec 5's locked decision that `INFRASTRUCTURE_POINT` nodes are NOT drawn — concrete-entity nodes only — and that V2 doesn't write to `diagram_nodes`.
- **(b) Auto-created `DiagramNode` rows on diagram open**: synthesize on first open, save back. Fragile (multi-deployment Service appears once per CR; renaming a Service requires diagram update; deleted deployment leaves orphan node).

Spec 5's polymorphic `infrastructure_points` precedent already establishes "concrete entities on canvas, supertype resolved at edge-eligibility time." **(a) is the consistent choice.** Recommend baking this in.

## 7. Header bar — room for V2 controls

`DiagramsView.tsx` line 3899 has a `headerBar` with `toolbarRow1` (DiagramSelector, period, zoom) and conditional `toolbarRow2` (styling controls when `showRow2`). **Pattern for V2: add a third conditional row (or a section in row 1) that renders only when `isInfrastructureDiagram`** — Environment dropdown, filter chips, Re-layout button. Existing precedent: the temporary-diagram banner and journey-review banner both replace row 1 contents conditionally. This is non-invasive.

## 8. Open feasibility risks (none blocking)

- **Compound-layout container resize**: Canvas already grows containers to fit children when `parent_node_id` is set (per spec 5 "existing compound-layout code resizes the Subnet container automatically"). V2's auto-layout writes computed `width`/`height` directly, so this auto-resize is bypassed — fine.
- **Drag without persistence**: requires the V2 renderer to maintain its own node state map separate from `diagram.diagram_nodes` and intercept the Canvas drag-commit dispatch, OR replace Canvas with a V2-specific renderer for this DiagramType. The cleanest path is **a dedicated `InfrastructureDiagramRenderer.tsx` (mirroring `SequenceDiagramRenderer` / `UserJourneyDiagramRenderer`) wired into the Canvas branch in `DiagramsView`**, bypassing Canvas.tsx's generic node/edge rendering entirely. This isolates V2 from the standard drag→persist path.
- **Cross-domain edge routing**: `createRelationshipEdge` returns SVG path data; routing around containers is currently straight-line + edge-points. For V2's nested Service-card-inside-CR-inside-Subnet-inside-Network case, edges from a deeply-nested Service to a tier-overlay LB go through many container boundaries. Out-of-the-box straight lines may visually clip through containers. **Acceptable for V1**: raw idea explicitly says "basic routing only" is in scope.

## 9. Recommended implementation shape (informs Pass C inferred decisions)

1. New `InfrastructureDiagramRenderer.tsx` parallel to `SequenceDiagramRenderer.tsx`. Reads `metaModel` + `diagram.settings.infrastructure.environment_id` + filter state. Emits SVG (containers, tiers, Service cards, edges) directly.
2. `DiagramsView.tsx` adds `isInfrastructureDiagram` flag. Canvas branch swaps to the new renderer for this DiagramType. PalettePanel branch short-circuited to either a slim info panel or nothing.
3. Header row gets a conditional Infrastructure-controls section: Environment dropdown, 5 layer filter chips + 2 edge-overlay chips, Re-layout button.
4. `Diagram.settings.infrastructure` schema: `{ environment_id?: string; filters?: { compute?: boolean; dataStores?: boolean; loadBalancers?: boolean; infrastructureResources?: boolean; services?: boolean; serviceLbEdges?: boolean; serviceIrEdges?: boolean; } }`. Persisted on the Diagram row through the existing `UPDATE_DIAGRAM` action.
5. Auto-layout is hand-rolled hierarchical: containment tree → measure children bottom-up → pack siblings left-to-right with padding → tier overlays placed after main pass. No npm dep.
6. Manual drag positions live in renderer-local React state, NOT in `diagram.diagram_nodes`. Re-layout button clears this state. Environment switch clears this state.
7. SelectionInspector continues to work — clicking a rendered Compute Resource selects the underlying entity by id, inspector shows the spec 5 `COMPUTE_RESOURCE` arm. No changes needed there.
