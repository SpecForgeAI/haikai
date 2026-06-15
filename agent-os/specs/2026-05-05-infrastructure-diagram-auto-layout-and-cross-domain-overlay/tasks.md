# Task Breakdown: Infrastructure Diagram V2 — Auto-Layout & Cross-Domain Overlay

## Overview
Total Tasks: 4 task groups covering ~5 frontend file edits (2 created, 2 modified, 2 test files created), all additive.

This spec is a **frontend-only follow-on to spec 5** — it replaces the *runtime behaviour* of the spec 5 `'Infrastructure'` `DiagramType` with an environment-rooted, auto-laid-out, view-mostly diagram while leaving every spec 5 wiring decision (`DiagramType` registration, palette wiring, `entityColors`, `RELATIONSHIP_EDGE_TYPES`, `createRelationshipEdge` cases, polymorphic `infrastructurePointsOnDiagram` resolution, `SelectionInspector` arms) intact and additive. There are no backend, gateway, MCP, discovery, Terraform, or save-pipeline changes; round-trip rides on the existing `Diagram.settings` slot pattern. There is no new npm dependency — auto-layout is hand-rolled hierarchical (consistent with `SequenceDiagramRenderer.tsx` and `UserJourneyDiagramRenderer.tsx`).

The spec touches these files:
- **Created (2):**
  - `frontend/src/utils/infrastructureLayout.ts` — pure-function layout helper. Lenient containment walk + Compute Cluster handling + tier overlays + cross-domain Service cards + cross-domain edges. Returns `{ nodes, edges }` for SVG render.
  - `frontend/src/components/DiagramsView/InfrastructureDiagramRenderer.tsx` — parallel renderer (template: `SequenceDiagramRenderer.tsx` / `UserJourneyDiagramRenderer.tsx`). Bypasses `Canvas.tsx`. Owns header (Environment dropdown + 5 layer chips + 2 edge-overlay chips + Re-layout button), session-only drag state, SVG render of containers/nodes/edges/Service-cards/Data-entity-chips, selection dispatch into the existing spec 5 / spec 6 `SelectionInspector` arms.
- **Modified (2):**
  - `frontend/src/components/DiagramsView/DiagramsView.tsx` — add `isInfrastructureDiagram` flag derived from `diagramType === 'Infrastructure'`; swap Canvas branch to `<InfrastructureDiagramRenderer>`; short-circuit `PalettePanel` branch.
  - `frontend/src/components/DiagramsView/PalettePanel.tsx` — short-circuit/hide for `diagramType === 'Infrastructure'` (spec 5 wiring stays additive — used by the General `DiagramType` authoring playground).
- **Created tests (2):**
  - `frontend/src/utils/__tests__/infrastructureLayout.test.ts` — Vitest unit test against a fixture `metaModel`. Asserts lenient hierarchy walk, Compute Cluster handling, cross-domain Service card placement.
  - `frontend/src/components/DiagramsView/__tests__/InfrastructureDiagramRenderer.test.tsx` — Vitest renderer smoke test. Mounts component with a fixture diagram + meta-model; asserts Environment dropdown + 5 layer chips + 2 edge-overlay chips render.

**Key sequencing pivot:** Group 1 lands the pure-function layout helper that the renderer depends on. Group 2 builds the renderer (header controls + SVG output + drag state + selection dispatch + persistence to `diagram.settings.infrastructure`). Group 3 wires the renderer into `DiagramsView.tsx` and short-circuits `PalettePanel.tsx`. Group 4 verifies (TS clean + targeted Vitest sweep + scope discipline). Groups are sequenced by hard dependency — Group 1 first, then Group 2, then Group 3, then Group 4.

## Locked Contract Reminders

These are immutable contract decisions from the spec, requirements, and grounding notes. Implementer must honour all of them at write-time:

- **snake_case for backend JSON fields** when reading `metaModel.entities.*` (e.g. `cluster_id`, `network_id`, `subnet_id`, `infrastructure_point_id`, `compute_resource_id`, `application_point_id`, `data_entity_point_id`, `data_store_instance_id`, `load_balancer_id`, `listener_id`, `target_infrastructure_point_id`, `compute_infrastructure_point_id`, `protocol`, `target_port`, `platform_type`, `version`, `resource_type`).
- **`Diagram.settings: Record<string, unknown>`** (model.ts:2094) already accommodates the new `infrastructure` key — **no `model.ts` change**. Renderer narrows the `unknown` value at the boundary with a small in-file type guard.
- **`diagram.diagram_nodes` / `diagram.diagram_edges` stay `[]`** for V2 diagrams. Computed at render time from `metaModel.entities.*` keyed by chosen `environment_id`. NEVER dispatch `UPDATE_DIAGRAM_NODE` from V2.
- **No new npm deps** — auto-layout is hand-rolled hierarchical. Do NOT add `dagre`, `elkjs`, `cytoscape`, `react-flow`, or any other layout library.
- **Existing spec 5 + spec 6 wiring NOT to be modified:**
  - `frontend/src/utils/paletteData.ts` (`DOMAIN_ENTITY_SECTIONS.infrastructure`, `domainToPaletteSections.infrastructure`, `DIAGRAM_TYPE_PALETTE_RULES.Infrastructure`, `entityColors`, `getEntityTypeConstant`).
  - `frontend/src/utils/relationshipUtils.ts` (`createRelationshipEdge` cases, `isRelationshipRowEnabled` arms, `getEntitiesOnDiagram` polymorphic block).
  - `frontend/src/components/DiagramsView/SelectionInspector.tsx` (12 entity arms + 3 Infra-internal relationship arms + 4 spec 6 cross-domain relationship arms).
  - `frontend/src/components/DiagramsView/Canvas.tsx` (bypassed for V2, still used elsewhere).
  - `frontend/src/config/defaults.ts` (12 `entityColors` + 6 container default-dimension overrides).
  - `frontend/src/types/model.ts` (no change — `settings: Record<string, unknown>` is sufficient).
  - `frontend/src/types/diagramType.ts` (no change — `'Infrastructure'` already in union).
- **General `DiagramType` keeps full Infra palette** — free-form authoring playground. Spec 5 wiring is the source of that, and stays untouched.
- **Selection dispatches into existing arms** — clicking a virtual node or edge in V2 triggers the existing spec 5 + spec 6 `SelectionInspector` arms via the existing entity-update / relationship-update dispatch. NO inspector code changes.
- **No palette, no canvas-drag-to-add, no draw-edges** in V2 — authoring stays in the Tables UI (spec 4) and the General `DiagramType`.
- **Manual drag state is component-local `useState<Record<string, {x, y}>>`** — never written back to the model. Cleared on Environment switch and on Re-layout click. Selection-only filter chips do NOT clear drag state.
- **Settings persistence shape:** `diagram.settings.infrastructure = { environment_id?: string, filters?: { compute?: boolean, data_stores?: boolean, load_balancers?: boolean, infrastructure_resources?: boolean, services?: boolean, service_to_lb_edges?: boolean, service_to_ir_edges?: boolean } }`. Default-on chips (5 layers + S→LB) treated as `true` if undefined. Default-off chip (`service_to_ir_edges`) treated as `false` if undefined.

## Pre-Existing Failing Tests — Implementer Convention

Per project memory (carry-forward from spec 5 and earlier), the following Vitest/Jest suites have pre-existing failures unrelated to this spec:
- `bootstrap-summary-fetching.test.ts` (1 fail: URL assertion)
- `conversation-memory-edge-cases.test.ts`
- `dashboardSummary*.test.ts` (metric value assertions)
- `hub-bootstrap-4-task-definition.test.ts` (2 fails: availableFrom)
- `chatV2-panel-integration.test.ts` (3 fails: availableFrom)
- `chatV2-panel-context-and-filtering.test.ts` (1 fail: availableFrom)

This spec must **NOT** modify or attempt to fix any of these. Verification in Group 4 is: `npx tsc --noEmit` clean (zero new errors), the new Vitest tests pass, and the existing failing-test inventory has not grown (net new failures = 0).

---

## Task List

### Layout Helper Layer

#### Task Group 1: Pure-function `infrastructureLayout.ts` helper + unit tests
**Dependencies:** None

- [x] 1.0 Create the pure-function layout helper at `frontend/src/utils/infrastructureLayout.ts`. Implements the 7-step algorithm (pick Environment → lenient containment tree → hierarchical pass → tier overlays → cross-domain Service cards → cross-domain edges). Returns a `LayoutResult` with positioned virtual nodes and cross-domain edges. Hand-rolled — no npm dependency. Pure function — easy to unit-test.
  - [x] 1.1 Write 4-6 focused tests for `infrastructureLayout.ts`
    - **File:** `frontend/src/utils/__tests__/infrastructureLayout.test.ts` (NEW)
    - **Vitest convention:** `describe('layoutInfrastructureDiagram', ...)` + `it(...)` blocks. Use a small inline fixture `metaModel` (one Environment, a couple of Cloud Accounts, Networks, Subnets, Compute Resources, a Compute Cluster, a Service in `application_compute_deployments` deployed twice).
    - **Imports:** `layoutInfrastructureDiagram` from `../infrastructureLayout`; `MetaModel` type from `../../types/model`.
    - Limit to 4-6 highly focused tests covering only the spec-mandated layout contracts (no full hierarchical-pass geometry assertions, no SVG output checks, no edge-routing geometry):
      1. **Test 1 — Lenient hierarchy walk skips undefined intermediate levels:** fixture has an Environment + Compute Resource with `environment_id` set but `cloud_account_id`, `location_id`, `network_id`, and no `resource_subnet_hostings` row. Assert the Compute Resource is attached at the Environment node (deepest defined parent), and that Cloud Account / Location / Network / Subnet container nodes are NOT in the result (empty containers hidden).
      2. **Test 2 — Compute Cluster renders as dashed-border container with `cluster_id` nesting:** fixture has a Compute Cluster (`platform_type: 'GKE'`, `version: '1.28'`) inside a Subnet with two Compute Resources whose `cluster_id` matches the Cluster id. Assert the result has a node with kind `'compute_cluster'` (or equivalent layout-node discriminator) marked as a dashed-container, labelled with the platform_type + version, parented inside the Subnet, with both Compute Resources nested as its children.
      3. **Test 3 — Cluster-spans-subnets case places cluster at parent Network level:** fixture has a Compute Cluster with `network_id` set but no `subnet_id` (or with member Compute Resources distributed across 2 Subnets via `resource_subnet_hostings`). Assert the cluster container's parent is the Network, NOT a Subnet, and that the cluster is not duplicated across subnets.
      4. **Test 4 — Cross-domain Service card placement: one card per Compute Resource for multi-deployment Services:** fixture has 1 Service with 2 `application_compute_deployments` rows (deployed to 2 different Compute Resources). Assert the result includes 2 Service-card nodes — one parented inside each Compute Resource — and that the Service card carries the cross-domain "Application domain" visual marker (e.g. an `isCrossDomain: true` flag or analogous).
      5. **Test 5 — `data_entity_data_store_hostings` renders Data entity chips inside Data Stores:** fixture has 1 Data Store and 2 Data entities hosted via `data_entity_data_store_hostings`. Assert the result includes 2 Data-entity-chip nodes parented inside the Data Store.
      6. **Test 6 (optional) — Cross-domain edge resolution:** fixture has 1 Service deployed inside a Compute Resource, 1 LB, 1 `application_load_balancer_exposures` row connecting the Service to the LB. Assert the result has an edge from the Service-card node id to the LB node id with the appropriate kind discriminator.
    - **Out of scope for tests:** no full hierarchical-pass geometry (x/y coordinate assertions); no SVG path assertions; no React component mounting; no edge-routing collision checks; no manual-drag-state tests (renderer-owned, not layout-helper-owned).
  - [x] 1.2 Define `LayoutResult` shape and module exports
    - **File:** `frontend/src/utils/infrastructureLayout.ts` (NEW)
    - Define internal types:
      - `LayoutNode = { id: string, kind: 'environment' | 'cloud_account' | 'location' | 'network' | 'subnet' | 'compute_cluster' | 'compute_resource' | 'load_balancer' | 'listener' | 'data_store' | 'infrastructure_resource' | 'service_card' | 'data_entity_chip', entity_id: string | null, label: string, sublabel?: string, x: number, y: number, width: number, height: number, parent_id: string | null, isContainer: boolean, isDashed?: boolean, isCrossDomain?: boolean, children?: LayoutNode[] }`.
      - `LayoutEdge = { id: string, kind: 'service_to_lb' | 'service_to_ir' | 'listener_to_compute', source_node_id: string, target_node_id: string, label?: string, dashed?: boolean }`.
      - `LayoutResult = { nodes: LayoutNode[], edges: LayoutEdge[] }`.
      - `InfrastructureFilters = { compute: boolean, data_stores: boolean, load_balancers: boolean, infrastructure_resources: boolean, services: boolean, service_to_lb_edges: boolean, service_to_ir_edges: boolean }` (all booleans, narrowed at the renderer boundary).
    - Export `layoutInfrastructureDiagram(metaModel: MetaModel, environmentId: string, filters: InfrastructureFilters): LayoutResult` as the single public function.
    - **Note:** the typed shapes can also live alongside the renderer in `InfrastructureDiagramRenderer.tsx` — implementer's call. Easiest is to keep them in `infrastructureLayout.ts` and re-import from the renderer.
  - [x] 1.3 Implement Step 1 — Lenient containment tree
    - **File:** `frontend/src/utils/infrastructureLayout.ts` `layoutInfrastructureDiagram`.
    - Filter every entity array on `metaModel.entities.*` by `environment_id === environmentId` to scope to the chosen Environment.
    - For each scoped concrete entity (Compute Resource, Data Store, LB, IR, Subnet, Network, Location, Cloud Account, Cluster), walk its parent chain in this order, picking the deepest defined parent:
      1. **For Compute Resources / Data Stores / LBs / IRs:** look up `resource_subnet_hostings` for a row matching `infrastructure_points` polymorphic to this entity → if found, parent is the `subnet_id` Subnet.
      2. If no subnet hosting, fall back to `network_id` (if set on entity) → Network.
      3. If no network, fall back to `location_id` (if set on entity) → Location.
      4. If no location, fall back to `cloud_account_id` (if set on entity) → Cloud Account.
      5. If no cloud account, fall back to Environment as the parent.
    - For Compute Cluster: same walk, but `cluster_id`-spans-subnets case (cluster has Compute Resources whose `resource_subnet_hostings` rows span 2+ different `subnet_id` values, OR cluster has `network_id` set with no `subnet_id`) places the cluster at the Network level, not a Subnet.
    - **Skip undefined intermediate levels** — do not synthesise empty Cloud Account / Location / Network / Subnet containers.
    - **Hide empty containers** — after the walk, prune any container with zero children (sparse-model resilience).
    - **Honour `cluster_id`** — Compute Resources with `cluster_id IS NOT NULL` are nested inside the Cluster container, not directly inside the Subnet.
  - [x] 1.4 Implement Step 2 — Hand-rolled hierarchical pass (containers grow to fit children)
    - In the same `layoutInfrastructureDiagram` function, after the containment tree is built:
    - Walk the tree bottom-up. For each leaf node (Compute Resource, Service card, Data entity chip, IR shelf row), assign default dimensions.
    - For each container, pack siblings horizontally with a fixed gutter (e.g. 16px), add a header strip at top (e.g. 24px) for the container label, and grow the container to fit children + padding.
    - Containers' `x` / `y` positioned relative to their parent's interior origin; root nodes (Environment) start at `(0, 0)`.
    - **Important:** Compute Cluster container (dashed-border) is sized like any container — the dashed flag is purely visual (rendered by the SVG component, not by the layout helper).
  - [x] 1.5 Implement Step 3 — Tier overlays (LB above Network, IR shelf, Data Store + Data entity chips)
    - **Load Balancers:** placed at a tier ABOVE their `network_id` Network (or above the entire region if no network). Listeners drawn nested inside their LB box (Listener has `load_balancer_id`).
    - **Infrastructure Resources:** placed in a "Regional Resources" shelf BELOW or BESIDE the Network, sorted by `resource_type` ascending. The shelf is itself a container labelled "Regional Resources".
    - **Data Stores:** placed inside their hosting Subnet via `resource_subnet_hostings` (already handled by Step 1's lenient walk for Data Stores).
    - **Data entity chips:** for each `data_entity_data_store_hostings` row in the scoped Environment, render a chip-kind node parented inside the matched Data Store.
    - Toggling filter chips (5 layer chips) post-layout hides/shows these tier overlays at render time WITHOUT re-running the layout pass — the layout helper produces the full tree; filters are applied by the renderer.
  - [x] 1.6 Implement Step 4 — Cross-domain Service cards
    - For each `application_compute_deployments` row scoped to the Environment (resolve via the row's `compute_resource_id` → Compute Resource → `environment_id`):
    - Resolve the row's `application_point_id` → `application_points` row → `target_type === 'SERVICE'` → `target_ref_id` → `services` row.
    - Render one Service-card node parented inside the `compute_resource_id` Compute Resource. Multi-deployment renders one card per Compute Resource (no canonical pick).
    - Mark the card with `isCrossDomain: true` (or analogous flag) so the renderer applies the subtle "Application domain" border colour.
    - Skip rows where `target_type !== 'SERVICE'` (Application target type is out of scope per spec — Service cards only).
  - [x] 1.7 Implement Step 5 — Cross-domain edges
    - For each `application_load_balancer_exposures` row scoped to the Environment: emit a `LayoutEdge` of kind `'service_to_lb'` from the Service-card node id (resolved through `application_point_id`) to the `load_balancer_id` LB node id. If `listener_id` is set, target the Listener node instead.
    - For each `application_infrastructure_resource_uses` row scoped to the Environment: emit a `LayoutEdge` of kind `'service_to_ir'` from the Service-card node id to the `infrastructure_resource_id` IR node id.
    - **No advanced routing** — straight or simple orthogonal lines; container clipping is acceptable for V1 per the raw idea.
    - Edges are emitted unconditionally by the layout helper; filter-chip toggles (`service_to_lb_edges`, `service_to_ir_edges`) hide/show them at render time WITHOUT re-running layout.
  - [x] 1.8 Ensure layout helper tests pass
    - From `frontend/`, run ONLY the new test file: `npx vitest run src/utils/__tests__/infrastructureLayout.test.ts`.
    - Expected: 4-6 passing tests. Do NOT run the entire test suite at this stage.
    - Run `npx tsc --noEmit` from `frontend/` and confirm zero new errors.

**Acceptance Criteria:**
- The 4-6 tests written in 1.1 pass.
- `frontend/src/utils/infrastructureLayout.ts` exports a single pure function `layoutInfrastructureDiagram(metaModel, environmentId, filters): LayoutResult`.
- Implements the 5 layout steps (containment tree + hierarchical pass + tier overlays + cross-domain Service cards + cross-domain edges).
- Lenient containment walk skips undefined intermediate levels and hides empty containers.
- Compute Cluster handling: dashed-border container, `cluster_id` nesting, cluster-spans-subnets case parents the cluster at Network level.
- Multi-deployment Service rendering: one card per Compute Resource (no canonical pick).
- Data entity chips parented inside Data Stores via `data_entity_data_store_hostings`.
- Cross-domain edges emitted unconditionally; filter-chip gating happens at render time, not in the layout helper.
- snake_case JSON field names honoured at every metaModel access point.
- No npm dependency added.
- `npx tsc --noEmit` passes with zero new errors.

---

### Renderer Layer

#### Task Group 2: `InfrastructureDiagramRenderer.tsx` parallel renderer + smoke test
**Dependencies:** Task Group 1

- [x] 2.0 Create the renderer at `frontend/src/components/DiagramsView/InfrastructureDiagramRenderer.tsx`. Mirrors `SequenceDiagramRenderer.tsx` and `UserJourneyDiagramRenderer.tsx` shape. Calls `layoutInfrastructureDiagram` from Group 1; renders SVG (containers, virtual nodes, virtual Service cards, Data entity chips, cross-domain edges); owns header (Environment dropdown + 5 layer chips + 2 edge-overlay chips + Re-layout button); persists Environment + filter changes via `UPDATE_DIAGRAM` reducer to `diagram.settings.infrastructure`; owns drag state in component-local `useState`; dispatches selections into the existing `SelectionInspector` arms.
  - [x] 2.1 Write 2-4 focused renderer smoke tests
    - **File:** `frontend/src/components/DiagramsView/__tests__/InfrastructureDiagramRenderer.test.tsx` (NEW)
    - **Vitest convention:** `describe('InfrastructureDiagramRenderer', ...)` + `it(...)` blocks. Mount with `@testing-library/react`. Use a fixture diagram (`{ id, project_id, name, type: 'Infrastructure', diagram_nodes: [], diagram_edges: [], settings: { infrastructure: { environment_id: '<fixture-env-id>' } } }`) and a small fixture `metaModel` (1 Environment, 1 Compute Resource).
    - **Mocks:** mock `ArchitectureContext` (or whichever context provides `metaModel` + `dispatch`), and any other context the renderer reads. Pattern: copy the mock setup used by `SequenceDiagramRenderer.test.tsx` if it exists, else mirror the spec-5 frontend Vitest mock pattern.
    - Limit to 2-4 focused tests covering only critical render contracts:
      1. **Test 1 — Mounts and renders Environment dropdown + 5 layer chips + 2 edge-overlay chips:** assert the Environment `<select>` (or analogous) is in the document with at least one option matching the fixture environment name; assert 5 layer-chip controls exist (Compute, Data Stores, Load Balancers, Infrastructure Resources, Services); assert 2 edge-overlay-chip controls exist (S→LB, S→IR); assert Re-layout button exists.
      2. **Test 2 — Empty-state when zero environments:** mount with a meta-model that has zero environments. Assert the empty-state message ("Create an Environment in the Tables UI to populate this diagram") is rendered. Assert no SVG `<svg>` root for the layout is rendered.
      3. **Test 3 (optional) — Default Environment selection: first by name ascending:** mount with 3 environments (`'prod'`, `'dev'`, `'staging'`) and no `settings.infrastructure.environment_id`. Assert the Environment dropdown shows `'dev'` selected (first by name asc).
      4. **Test 4 (optional) — Filter chip toggle dispatches `UPDATE_DIAGRAM`:** mount, click the Compute layer chip, assert `dispatch` was called with `type: 'UPDATE_DIAGRAM'` payload that includes `settings.infrastructure.filters.compute === false`.
    - **Out of scope for tests:** no SVG geometry assertions; no edge-routing assertions; no drag-interaction tests; no full layout-helper integration tests (those are Group 1's domain); no `SelectionInspector` integration (that's spec 5/6, unchanged).
  - [x] 2.2 Scaffold the renderer component
    - **File:** `frontend/src/components/DiagramsView/InfrastructureDiagramRenderer.tsx` (NEW)
    - **Template:** `frontend/src/components/DiagramsView/SequenceDiagramRenderer.tsx` and `frontend/src/components/DiagramsView/UserJourneyDiagramRenderer.tsx` — closest architectural precedent. Match the import pattern, prop signature, and overall component shape.
    - Props: `{ diagram: Diagram, ... }` mirroring how `SequenceDiagramRenderer` is invoked from `DiagramsView.tsx`.
    - Read `metaModel` and `dispatch` from the existing `ArchitectureContext` (or wherever `SequenceDiagramRenderer` reads them).
    - Top-level local state:
      - `manualNudges: Record<string, { x: number, y: number }>` via `useState`.
      - Read `settings.infrastructure` (typed-narrowed via in-file type guard) from `diagram.settings`.
  - [x] 2.3 Implement settings narrow + default resolution
    - Add a small in-file type guard `narrowInfrastructureSettings(value: unknown): InfrastructureSettings` returning `{ environment_id: string | undefined, filters: InfrastructureFilters }`.
    - **Defaults applied after narrowing:**
      - `environment_id` undefined → first environment by `name` ascending (from `metaModel.entities.environments`).
      - `filters.compute` / `data_stores` / `load_balancers` / `infrastructure_resources` / `services` / `service_to_lb_edges` undefined → `true`.
      - `filters.service_to_ir_edges` undefined → `false`.
    - **Empty environments:** if `metaModel.entities.environments.length === 0`, render the empty-state message ("Create an Environment in the Tables UI to populate this diagram") and skip the layout pass entirely (no SVG render).
  - [x] 2.4 Implement header bar
    - **Layout:** left-to-right — Environment dropdown, 5 layer chips, 2 edge-overlay chips, Re-layout button.
    - **Environment dropdown:** populated from `metaModel.entities.environments`. Default-selected by `name` ascending if `settings.infrastructure.environment_id` is undefined. On change: clear `manualNudges` (set to `{}`) AND dispatch `UPDATE_DIAGRAM` with merged `settings.infrastructure.environment_id`.
    - **5 layer chips** (Compute, Data Stores, Load Balancers, Infrastructure Resources, Services), all default ON: on toggle, dispatch `UPDATE_DIAGRAM` with merged `settings.infrastructure.filters.<key>`. Do NOT clear `manualNudges`. Do NOT re-run layout (filters are applied at render time).
    - **2 edge-overlay chips** (S→LB default ON, S→IR default OFF): same dispatch pattern. Do NOT clear `manualNudges`. Do NOT re-run layout.
    - **Re-layout button:** clear `manualNudges` (set to `{}`). Does NOT reset filter chips. Layout helper is called fresh on every render anyway, so simply clearing `manualNudges` triggers a clean re-render.
    - **Style note:** match the visual conventions of the existing `headerBar` in `DiagramsView.tsx` line 3899 (toolbar row pattern).
  - [x] 2.5 Invoke layout helper and render SVG
    - In the render body, call `layoutInfrastructureDiagram(metaModel, resolvedEnvironmentId, resolvedFilters)` to get `{ nodes, edges }`.
    - Apply `manualNudges` per-node-id as a positional offset over the layout helper's computed `(x, y)`.
    - Apply filter-chip gating: skip rendering of nodes whose kind is gated off (e.g. if `filters.compute === false`, skip Compute Resource and Service-card descendants); skip edges of kind `'service_to_lb'` if `filters.service_to_lb_edges === false`; skip edges of kind `'service_to_ir'` if `filters.service_to_ir_edges === false`.
    - Render an `<svg>` root sized to the layout's bounding box. For each `LayoutNode`:
      - Container nodes (Environment, Cloud Account, Location, Network, Subnet, Compute Cluster): `<rect>` + header strip with label. Compute Cluster gets `stroke-dasharray` for dashed border. Use the existing spec 5 `entityColors` lookup for fill/border (consistency with the General authoring playground).
      - Concrete leaf nodes (Compute Resource, Data Store, LB, Listener, IR): `<rect>` + label.
      - Service card: `<rect>` with the cross-domain "Application domain" border colour.
      - Data entity chip: small `<rect>` or rounded chip with the entity name.
      - "Regional Resources" shelf: a sibling container of the Network's parent.
    - For each `LayoutEdge`:
      - `<path>` or `<line>` from source to target. Basic straight or simple orthogonal routing — no advanced collision avoidance. Container clipping is acceptable for V1.
      - Style: solid + arrow at target for both edge kinds; label ` ` (route-to) or analogous.
    - **No drag persistence to model** — drag handlers update `manualNudges` only; never dispatch `UPDATE_DIAGRAM_NODE`.
    - **Drag handlers:** `onMouseDown` on a node sets a drag-source ref; `onMouseMove` updates `manualNudges[node.id]`; `onMouseUp` ends drag. Mirror the lightweight pattern used in `SequenceDiagramRenderer` if any drag exists, else implement directly.
  - [x] 2.6 Implement selection dispatch
    - On click of a virtual node or edge, dispatch the same selection actions the existing spec 5 / spec 6 `SelectionInspector` arms expect.
    - **For concrete-entity nodes** (Compute Resource, Data Store, LB, Listener, IR, Subnet, Network, Location, Cloud Account, Cluster, Environment): dispatch a selection of `entity_type: '<MATCHING_SCREAMING_SNAKE_CASE>'` + `entity_id: <node.entity_id>`. The existing 12 spec 5 `SelectionInspector` arms light up.
    - **For Service cards:** dispatch a selection of `entity_type: 'SERVICE'` + `entity_id: <service.id>` (the Application domain `SERVICE` arm — already wired in the existing inspector).
    - **For Data entity chips:** dispatch a selection of `entity_type: 'LOGICAL_DATA_ENTITY'` (or whichever discriminator matches the data entity model) + `entity_id`.
    - **For cross-domain edges:** dispatch a selection of `relationship_type: 'application_load_balancer_exposures'` or `'application_infrastructure_resource_uses'` + `relationship_id: <row.id>`. The existing spec 6 cross-domain inspector arms light up.
    - **NO inspector code changes.** Implementer finds the existing dispatch action shape (`SET_SELECTED_ENTITY` / `SET_SELECTED_RELATIONSHIP` or analogous) by inspecting `Canvas.tsx` and `SequenceDiagramRenderer.tsx` selection paths.
  - [x] 2.7 Ensure renderer smoke tests pass
    - From `frontend/`, run ONLY the new test file: `npx vitest run src/components/DiagramsView/__tests__/InfrastructureDiagramRenderer.test.tsx`.
    - Expected: 2-4 passing tests. Do NOT run the entire test suite at this stage.
    - Run `npx tsc --noEmit` from `frontend/` and confirm zero new errors.

**Acceptance Criteria:**
- The 2-4 tests written in 2.1 pass.
- `frontend/src/components/DiagramsView/InfrastructureDiagramRenderer.tsx` exists, mirrors `SequenceDiagramRenderer.tsx` shape.
- Renderer reads `metaModel` and `diagram.settings.infrastructure`; calls `layoutInfrastructureDiagram` from Group 1; renders SVG (containers, virtual nodes, Service cards, Data entity chips, cross-domain edges).
- Header has Environment dropdown + 5 layer chips + 2 edge-overlay chips + Re-layout button.
- Default-on chips treated as `true` if undefined; `service_to_ir_edges` treated as `false` if undefined.
- Empty-state message when zero environments; no layout pass attempted.
- Environment switch and Re-layout click clear `manualNudges`. Filter-chip toggles do NOT clear `manualNudges`.
- Settings persistence: Environment + filter changes dispatch `UPDATE_DIAGRAM` with merged `settings.infrastructure`. `diagram.diagram_nodes` and `diagram.diagram_edges` stay `[]`.
- Drag handlers update component-local `manualNudges` only — NEVER dispatch `UPDATE_DIAGRAM_NODE`.
- Selection dispatches into existing spec 5 + spec 6 `SelectionInspector` arms — NO inspector code changes.
- snake_case JSON field names honoured at every metaModel access.
- No new npm dependency added.
- `npx tsc --noEmit` passes with zero new errors.

---

### Wiring Layer

#### Task Group 3: `DiagramsView.tsx` branch + `PalettePanel.tsx` short-circuit
**Dependencies:** Task Group 2

- [x] 3.0 Wire the renderer into `DiagramsView.tsx` via a new `isInfrastructureDiagram` flag (Canvas branch swap + right-panel short-circuit) and short-circuit `PalettePanel.tsx` for `diagramType === 'Infrastructure'`. Spec 5 wiring stays intact and additive.
  - [x] 3.1 Add `isInfrastructureDiagram` flag and Canvas-branch swap in `DiagramsView.tsx`
    - **File:** `frontend/src/components/DiagramsView/DiagramsView.tsx`
    - **Template:** existing `isSequenceDiagram` / `isJourneyDiagram` / `isOverviewDiagram` flag definitions and their conditional Canvas-branch swaps (~lines 4756-4807).
    - Define `const isInfrastructureDiagram = diagramType === 'Infrastructure';` near the existing `isSequenceDiagram` / `isJourneyDiagram` / `isOverviewDiagram` flag definitions.
    - In the Canvas-branch render (~line 4756-4807), add a new branch BEFORE the generic `<Canvas>` fallback: when `isInfrastructureDiagram` is true, render `<InfrastructureDiagramRenderer diagram={...} />` (with the same prop signature pattern as the other renderers) instead of `<Canvas>`. Preserve all existing branches verbatim.
    - In the right-side panel branch (~line 4817), add an `isInfrastructureDiagram` short-circuit alongside the existing `isSequenceDiagram` / `isUIScreenDiagram` short-circuits — render either nothing or a slim info panel (implementer's call; spec recommends nothing). PalettePanel must NOT render for V2.
    - Add the import: `import { InfrastructureDiagramRenderer } from './InfrastructureDiagramRenderer';` near the existing renderer imports.
  - [x] 3.2 Short-circuit `PalettePanel.tsx` for `'Infrastructure'` `DiagramType`
    - **File:** `frontend/src/components/DiagramsView/PalettePanel.tsx`
    - **Reference point:** line 933 already extracts `diagramType = getDiagramType(fullDiagram)`.
    - Add an early return at the top of the component body (or wherever the existing per-type short-circuit pattern lives — implementer mirrors local convention): when `diagramType === 'Infrastructure'`, return `null` (or a slim info panel). Spec 5 wiring (`DOMAIN_ENTITY_SECTIONS.infrastructure`, `domainToPaletteSections.infrastructure`, `DIAGRAM_TYPE_PALETTE_RULES.Infrastructure`, `entityColors`, relationship sections, `getEntityTypeConstant` mappings) stays intact and additive — used by the General `DiagramType` authoring playground.
    - **Defensive:** if `DiagramsView.tsx` Group 3.1 right-panel short-circuit already prevents `PalettePanel` from rendering for V2, this 3.2 edit is belt-and-braces. Land it anyway for resilience against future `DiagramsView.tsx` refactors.
  - [x] 3.3 Verify TS compiles
    - From `frontend/`, run `npx tsc --noEmit`.
    - Expected: zero new errors. The new `<InfrastructureDiagramRenderer>` import, `isInfrastructureDiagram` flag, and Canvas/PalettePanel short-circuits all type-check against existing surfaces.

**Acceptance Criteria:**
- `DiagramsView.tsx` has an `isInfrastructureDiagram = diagramType === 'Infrastructure'` flag.
- When true, the Canvas branch swaps to `<InfrastructureDiagramRenderer>`.
- When true, the right-side panel branch short-circuits — `PalettePanel` does NOT render for V2.
- `PalettePanel.tsx` defensively returns `null` (or a slim info panel) when `diagramType === 'Infrastructure'`.
- Spec 5 palette wiring (`DOMAIN_ENTITY_SECTIONS.infrastructure`, `domainToPaletteSections.infrastructure`, `DIAGRAM_TYPE_PALETTE_RULES.Infrastructure`, `entityColors`, `getEntityTypeConstant`) is NOT modified — used by General `DiagramType` authoring playground.
- `Canvas.tsx`, `SelectionInspector.tsx`, `relationshipUtils.ts`, `paletteData.ts`, `defaults.ts`, `model.ts`, `diagramType.ts` are NOT modified.
- All other diagram type branches (Sequence, Journey, Overview, UI Workflow, UI Screen, ER, Activity, State, General) are preserved verbatim.
- `npx tsc --noEmit` passes with zero new errors.

---

### Verification Layer

#### Task Group 4: Final TS + targeted Vitest sweep + scope discipline
**Dependencies:** Task Groups 1-3

- [x] 4.0 Run the final `npx tsc --noEmit` and targeted Vitest sweep (only the new tests + any tests touching the modified `DiagramsView.tsx` / `PalettePanel.tsx` paths). Confirm zero new failures and that the pre-existing failure inventory has not grown. Confirm scope discipline (only the 4-5 in-scope files were touched).
  - [x] 4.1 Run `npx tsc --noEmit` for the full frontend
    - From `frontend/`, run `npx tsc --noEmit`.
    - Expected: zero new errors. Any remaining errors must already exist on `master` and not have been introduced by this spec.
  - [x] 4.2 Run feature-specific Vitest tests
    - From `frontend/`, run only the spec's new tests:
      - `npx vitest run src/utils/__tests__/infrastructureLayout.test.ts`
      - `npx vitest run src/components/DiagramsView/__tests__/InfrastructureDiagramRenderer.test.tsx`
    - Expected: all 6-10 tests across both files pass.
    - Do NOT run the entire Vitest suite at this stage.
  - [x] 4.3 Run the wider frontend Vitest sweep and confirm zero new failures
    - From `frontend/`, run the full Vitest suite (e.g. `npx vitest run`).
    - Expected outcome: the only failures are the pre-existing failing tests already documented in project memory:
      - `bootstrap-summary-fetching.test.ts` (1 fail)
      - `conversation-memory-edge-cases.test.ts`
      - `dashboardSummary*.test.ts`
      - `hub-bootstrap-4-task-definition.test.ts` (2 fails)
      - `chatV2-panel-integration.test.ts` (3 fails)
      - `chatV2-panel-context-and-filtering.test.ts` (1 fail)
    - **Newly passing:** `infrastructureLayout.test.ts` + `InfrastructureDiagramRenderer.test.tsx`.
    - **No** new failures introduced by this spec; **no** previously-passing tests now failing.
    - **DO NOT** modify or attempt to fix any pre-existing failing test.
  - [x] 4.4 Confirm scope discipline
    - **Verification only:** confirm edits only touched the 4 in-scope source/test files:
      1. `frontend/src/utils/infrastructureLayout.ts` (CREATED — Group 1)
      2. `frontend/src/utils/__tests__/infrastructureLayout.test.ts` (CREATED — Group 1)
      3. `frontend/src/components/DiagramsView/InfrastructureDiagramRenderer.tsx` (CREATED — Group 2)
      4. `frontend/src/components/DiagramsView/__tests__/InfrastructureDiagramRenderer.test.tsx` (CREATED — Group 2)
      5. `frontend/src/components/DiagramsView/DiagramsView.tsx` (MODIFIED — Group 3.1)
      6. `frontend/src/components/DiagramsView/PalettePanel.tsx` (MODIFIED — Group 3.2)
    - Confirm NO edits to:
      - `frontend/src/types/model.ts` (no `Diagram.settings` typed sub-shape; renderer narrows `unknown` at boundary).
      - `frontend/src/types/diagramType.ts` (`'Infrastructure'` already in union from spec 5).
      - `frontend/src/utils/paletteData.ts` (spec 5 wiring intact and additive).
      - `frontend/src/config/defaults.ts` (spec 5 `entityColors` + container default-dimension overrides intact).
      - `frontend/src/utils/relationshipUtils.ts` (spec 5 `createRelationshipEdge`, `isRelationshipRowEnabled`, `getEntitiesOnDiagram` intact).
      - `frontend/src/utils/rendering.ts` (spec 5 `relationshipColors`, `getRelationshipEdgeDefaults` intact).
      - `frontend/src/components/DiagramsView/SelectionInspector.tsx` (spec 5 + spec 6 inspector arms reused as-is).
      - `frontend/src/components/DiagramsView/Canvas.tsx` (bypassed for V2; still used elsewhere).
      - `frontend/src/utils/nodeCreation.ts`, `frontend/src/utils/compoundLayout.ts`, `frontend/src/utils/shapeRendering.ts`, or any backend/gateway/MCP/discovery code.
    - Confirm NO new npm dependencies were added to `frontend/package.json` (no `dagre`, `elkjs`, `cytoscape`, `react-flow`, etc.).
    - Confirm `diagram.diagram_nodes` and `diagram.diagram_edges` are NEVER written by V2 (no `UPDATE_DIAGRAM_NODE` dispatch from `InfrastructureDiagramRenderer.tsx`).
    - Confirm the renderer dispatches into the EXISTING `SelectionInspector` arms (no new inspector code).

**Acceptance Criteria:**
- All feature-specific tests pass (~6-10 tests total across both new test files).
- `npx tsc --noEmit` is clean (zero new errors).
- Vitest sweep shows: ~6-10 newly-passing tests + identical pre-existing failure inventory + zero regressions.
- Exactly 6 frontend files touched (4 created, 2 modified).
- No edits to spec 5 / spec 6 / spec 3 / spec 4 source files; no `Canvas.tsx`, `SelectionInspector.tsx`, `relationshipUtils.ts`, or backend/gateway/MCP/discovery code edits.
- No new npm dependencies.
- `diagram.diagram_nodes` / `diagram.diagram_edges` stay `[]` for V2.
- Selection dispatches into existing spec 5 + spec 6 `SelectionInspector` arms with NO inspector code changes.
- General `DiagramType` continues to render the full Infra palette (free-form authoring playground intact).
- All pre-existing diagrams (Sequence, Journey, Overview, ER, Activity, State, UI Workflow, UI Screen, General) continue to render unchanged.

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Layout helper (pure function)** — `frontend/src/utils/infrastructureLayout.ts` + 4-6 unit tests. Foundation for the renderer; pure function, easy to test in isolation.
2. **Task Group 2: Renderer component** — `frontend/src/components/DiagramsView/InfrastructureDiagramRenderer.tsx` + 2-4 smoke tests. Depends on Group 1's `layoutInfrastructureDiagram` import.
3. **Task Group 3: Wiring** — `DiagramsView.tsx` `isInfrastructureDiagram` branch + `PalettePanel.tsx` short-circuit. Depends on Group 2's renderer export.
4. **Task Group 4: Verification** — final `tsc --noEmit`, targeted Vitest sweep, full Vitest sweep, scope discipline check.

Group 1 must run first (renderer imports `layoutInfrastructureDiagram` from it). Group 2 depends on Group 1. Group 3 depends on Group 2 (imports the renderer). Group 4 must run last.

---

## File Summary

### Files to Create (4)
1. `frontend/src/utils/infrastructureLayout.ts` — pure-function layout helper. Exports `layoutInfrastructureDiagram(metaModel, environmentId, filters): LayoutResult`. Implements 5-step algorithm (containment + hierarchical pass + tier overlays + cross-domain Service cards + cross-domain edges).
2. `frontend/src/utils/__tests__/infrastructureLayout.test.ts` — Vitest unit test (4-6 focused tests against fixture metaModel).
3. `frontend/src/components/DiagramsView/InfrastructureDiagramRenderer.tsx` — parallel renderer component. Mirrors `SequenceDiagramRenderer.tsx` / `UserJourneyDiagramRenderer.tsx`. Owns header (Environment dropdown + 5 layer chips + 2 edge-overlay chips + Re-layout button), session-only drag state, SVG render, selection dispatch.
4. `frontend/src/components/DiagramsView/__tests__/InfrastructureDiagramRenderer.test.tsx` — Vitest renderer smoke test (2-4 focused tests).

### Files to Modify (2)
5. `frontend/src/components/DiagramsView/DiagramsView.tsx` — add `isInfrastructureDiagram` flag; Canvas branch swap; right-panel short-circuit.
6. `frontend/src/components/DiagramsView/PalettePanel.tsx` — defensive short-circuit for `diagramType === 'Infrastructure'`.

### Files NOT to Touch
- `frontend/src/types/model.ts` — `Diagram.settings: Record<string, unknown>` (line 2094) already accommodates the new `infrastructure` key. Renderer narrows the `unknown` at the boundary.
- `frontend/src/types/diagramType.ts` — `'Infrastructure'` already in `DiagramType` union (spec 5).
- `frontend/src/utils/paletteData.ts` — spec 5 palette wiring intact and additive (used by General `DiagramType` authoring playground).
- `frontend/src/config/defaults.ts` — spec 5 `entityColors` + container default-dimension overrides intact.
- `frontend/src/utils/relationshipUtils.ts` — spec 5 `createRelationshipEdge`, `isRelationshipRowEnabled`, `getEntitiesOnDiagram` intact (V2 doesn't draw edges through this path; layout helper emits its own `LayoutEdge` objects).
- `frontend/src/utils/rendering.ts` — spec 5 `relationshipColors`, `getRelationshipEdgeDefaults` intact.
- `frontend/src/components/DiagramsView/SelectionInspector.tsx` — spec 5 (12 entity arms + 3 Infra-internal relationship arms) + spec 6 (4 cross-domain relationship arms) reused as-is.
- `frontend/src/components/DiagramsView/Canvas.tsx` — bypassed for V2; still used for every non-V2 DiagramType, including General `DiagramType` Infra authoring playground.
- `frontend/src/utils/nodeCreation.ts`, `frontend/src/utils/compoundLayout.ts`, `frontend/src/utils/shapeRendering.ts` — not needed; V2 owns its own SVG output.
- Any backend, gateway, MCP, discovery, Terraform, or save-pipeline code.
- `frontend/package.json` — no new npm dependencies.

---

## Reference Patterns

### Existing Code to Follow

- **`frontend/src/components/DiagramsView/SequenceDiagramRenderer.tsx`** — closest architectural template. Parallel renderer that bypasses `Canvas.tsx`, computes layout from typed model data, owns its own SVG output, header, and selection dispatch. New `InfrastructureDiagramRenderer.tsx` follows this shape but reads from `metaModel.entities.*` keyed by `environment_id` instead of from `typedContent`.

- **`frontend/src/components/DiagramsView/UserJourneyDiagramRenderer.tsx`** — additional parallel-renderer precedent with header controls and view-mostly authoring posture. Useful template for header layout (filter chips, dropdown, action button).

- **`frontend/src/components/DiagramsView/DiagramsView.tsx`** branch points (lines 4756-4807 Canvas branch; line 4817 right-panel branch) — direct pattern for the new `isInfrastructureDiagram` branch alongside existing `isSequenceDiagram` / `isJourneyDiagram` / `isOverviewDiagram` flags.

- **`frontend/src/components/DiagramsView/PalettePanel.tsx`** line 933 — already extracts `diagramType`; existing per-type short-circuit pattern is the precedent for the new `'Infrastructure'` short-circuit.

- **`frontend/src/types/model.ts:2094`** `Diagram.settings: Record<string, unknown>` — direct precedent: existing `journeyDiagram` and `overviewDiagram` settings keys used by `diagramExtractionUtils.ts`. New `infrastructure` key fits without `model.ts` edits.

- **Spec 6 cross-domain relationship arrays on `metaModel.entities`** — `application_compute_deployments`, `data_entity_data_store_hostings`, `application_load_balancer_exposures`, `application_infrastructure_resource_uses` are already populated. Layout helper reads them at render time.

- **`metaModel.entities.resource_subnet_hostings`** (spec 3) — source for Subnet placement of Compute Resources, Data Stores, LBs, IRs via the polymorphic walk.

- **`metaModel.entities.compute_resources` with `cluster_id`** (spec 3) — drives Compute Cluster nesting (dashed-border container).

- **Existing `application_points` resolution pattern** in `relationshipUtils.ts` `getEntitiesOnDiagram` (~lines 130-160) — direct precedent for resolving a polymorphic `application_point_id` through `application_points` to a concrete `services` row, used by Service-card rendering and cross-domain edge resolution.

### Key Decisions to Honour

- **Auto-layout from model data** — no `DiagramNode` / `DiagramEdge` rows; everything materialised at render time from `metaModel.entities.*` keyed by chosen Environment.
- **Environment-rooted scope** — header dropdown switches scope; default first by `name` ascending; empty-state if zero.
- **Cross-domain Service cards rendered inside Compute Resources** via `application_compute_deployments` (multi-deployment: one card per Compute Resource, no canonical pick).
- **Cross-domain Data entity chips rendered inside Data Store boxes** via `data_entity_data_store_hostings`.
- **Tier overlays** — LB above Network with Listeners drawn inside; "Regional Resources" shelf for IRs sorted by `resource_type`; Data Stores in their hosting Subnet.
- **5 layer filter chips + 2 edge-overlay chips** in the header — toggle visibility post-layout WITHOUT re-running layout. Environment switch re-runs layout.
- **Default-on chips** treated as `true` if undefined; **`service_to_ir_edges`** treated as `false` if undefined.
- **Re-layout button** discards manual nudges only — does NOT reset filter chips.
- **Manual drag state is component-local `useState<Record<string, {x, y}>>`** — never persisted. Cleared on Environment switch and Re-layout click.
- **`diagram.diagram_nodes` and `diagram.diagram_edges` stay `[]`** for V2 — virtual nodes are render-time only.
- **Settings persistence rides on existing `Diagram.settings` slot** — `diagram.settings.infrastructure = { environment_id, filters: {...} }`. No backend / schema changes.
- **No palette, no canvas-drag-to-add, no draw-edges-to-create-relationships** in V2 — authoring stays in Tables UI (spec 4) and General `DiagramType`.
- **Spec 5 wiring intact and additive** — General `DiagramType` keeps full Infra palette for free-form authoring.
- **snake_case JSON keys** at every metaModel access (`cluster_id`, `network_id`, `subnet_id`, `infrastructure_point_id`, `compute_resource_id`, `application_point_id`, `data_entity_point_id`, `data_store_instance_id`, `load_balancer_id`, `listener_id`, `target_infrastructure_point_id`, `compute_infrastructure_point_id`, `protocol`, `target_port`, `platform_type`, `version`, `resource_type`).
- **No new npm dependency** — hand-rolled hierarchical layout pass, consistent with all existing renderers (Sequence, ER, Activity, State, User Journey, UI Workflow).
- **Selection dispatches into existing `SelectionInspector` arms** — 12 spec 5 entity arms + 3 spec 5 Infra-internal relationship arms + 4 spec 6 cross-domain relationship arms; no inspector code changes.
- **Backward compatibility — additive only** — no edits to existing `DiagramType` values, palette wiring, `entityColors`, `RELATIONSHIP_EDGE_TYPES`, `createRelationshipEdge` cases, `isRelationshipRowEnabled` arms, `getEntitiesOnDiagram` resolution, or `SelectionInspector` arms.
