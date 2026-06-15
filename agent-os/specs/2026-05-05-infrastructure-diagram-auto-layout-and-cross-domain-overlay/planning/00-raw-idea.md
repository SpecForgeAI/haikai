# Infrastructure Diagram V2: Auto-Layout & Cross-Domain Overlay

This is a follow-on to the Infrastructure 7-spec arc (specs at `agent-os/specs/2026-05-04-infrastructure-domain-backend-foundation/` through `2026-05-05-infrastructure-terraform-discovery-readiness/`).

## Background

Spec 5 introduced the `'Infrastructure'` DiagramType but, as built, it's effectively "General DiagramType with a filtered palette and bigger default rectangles." Every other non-General DiagramType has a distinct *reason* for existing (Sequence is auto-drawn from interactions, ER is structured around data entities, User Journey is auto-drawn from journey data, etc.) — Infrastructure today doesn't earn that distinction.

This spec replaces the Infrastructure DiagramType's behaviour with an **environment-rooted, auto-laid-out, view-mostly diagram** that uses the data already captured by specs 1-6 (Infrastructure entities, relationships, cross-domain links) to produce a meaningful runtime-topology view automatically.

## Goal

When a user opens an Infrastructure diagram, they pick an Environment and see the runtime topology of that environment auto-laid-out from the model data:
- Containment hierarchy (Environment > CloudAccount > Location > Network > Subnet > Compute Resource).
- Compute Clusters as dashed-border containers when present, with their Compute Resources (e.g. pods) nested inside.
- **Services from the Application Architecture domain rendered as child cards inside their Compute Resources** (via spec 6 `application_compute_deployments`).
- **Data entities rendered as chips inside their Data Store Instance** (via spec 6 `data_entity_data_store_hostings`).
- Load Balancers / Listeners drawn at a tier above the network, with `routes-to` edges into the relevant Compute Resources.
- Infrastructure Resources (buckets, queues, caches, etc.) on a regional "shelf" beside the network.
- Cross-domain edges (Service → Load Balancer, Service → Infrastructure Resource) drawn after main layout, toggleable in the header.

## Key design decisions (locked through discussion)

### Layout

- **Lenient hierarchy**: render with whatever is defined. Walk each entity's parent chain (FKs and `resource_subnet_hostings`) and place at the deepest defined container. Skip undefined intermediate levels. Empty containers are hidden. Header chips softly note missing layers ("No Cloud Accounts defined") without blocking rendering.
- **Tier overlays** for things that don't fit in pure containment:
  - Load Balancers placed at a tier above their Network.
  - Listeners drawn inside their Load Balancer box.
  - Infrastructure Resources placed in a "Regional Resources" shelf below/beside the Network.
- **Re-layout** discards manual positions and re-runs the algorithm fresh. User-dragged positions persist for the session but are not stored back to the model.

### Compute Clusters

- Render as **dashed-border containers** labeled with `platform_type` (e.g. "GKE", "Cloud Run", "VMware") and `version` if set.
- `Compute Resource.cluster_id IS NOT NULL` → render Compute Resource (pod) nested inside Cluster container.
- `cluster_id IS NULL` (Cloud Run service, standalone VM) → render Compute Resource directly in its Subnet/Network.
- Cluster spans subnets (common for GKE multi-subnet node pools) → cluster container placed at the parent Network level, pods nested inside; cluster is NOT split across subnets visually.

### Cross-domain integration

- `application_compute_deployments` → Service card rendered inside each Compute Resource it's deployed to (per multi-deployment decision: render in each, no canonical pick).
- `data_entity_data_store_hostings` → Data entity names render as chips inside the Data Store box.
- `application_load_balancer_exposures` → edges Service → Listener/LB drawn, **ON by default**.
- `application_infrastructure_resource_uses` → edges Service → IR drawn, **OFF by default** (noisy at scale).

### Authoring posture: view-mostly

- **Allowed**: drag nodes to nudge (session-only), inspector to edit attributes (writes back to model), toggle filter chips in header, Re-layout button, switch Environment via header dropdown.
- **Disallowed**: no palette to add entities, no canvas drag-to-add, no drawing edges to create relationships. Authoring is the Tables UI's job (spec 4); General DiagramType remains the free-form authoring playground.

### Filter chips (header)

- `[✓ Compute] [✓ Data Stores] [✓ Load Balancers] [✓ Infrastructure Resources] [✓ Services] [✓ S→LB edges] [☐ S→IR edges]`
- Each toggles a layer on/off without re-running layout.

### Environment selection

- Header dropdown: `Environment: [PROD ▾]`. Switching scope re-runs layout.
- One Environment per diagram session.

## Visual mockup (ASCII)

```
┌────────────────────── ENVIRONMENT: PROD ────────────────────────────────┐
│  ┌──────────── Cloud Account: acme-prod-gcp ────────────────────────┐   │
│  │  ┌──────── Location: europe-west1 ───────────────────────────┐   │   │
│  │  │   ┌─ Load Balancer: orders-lb (EXTERNAL_HTTPS) ─────────┐  │   │   │
│  │  │   │   Listener: orders-listener  HTTPS 443  /api/*       │  │   │   │
│  │  │   └─────────────────────┬──────────────────────────────────┘  │   │   │
│  │  │                          │ routes-to                            │   │   │
│  │  │  ┌─ Network: vpc-prod (10.0.0.0/16) ──────────────────────┐    │   │   │
│  │  │  │  ┌─ Subnet: app-subnet ────────────────────────────┐   │    │   │   │
│  │  │  │  │  ┌─ Compute: orders-cr (CLOUD_RUN_SERVICE) ──┐  │   │    │   │   │
│  │  │  │  │  │  ┌─ ▶ Service: orders-service ────────┐   │  │   │    │   │   │
│  │  │  │  │  │  │   role: PRIMARY                    │   │  │   │    │   │   │
│  │  │  │  │  │  │   via DU: orders 1.4.2             │   │  │   │    │   │   │
│  │  │  │  │  │  └──────────────────────────────────────┘   │  │   │    │   │   │
│  │  │  │  │  └──────────────────────────────────────────────┘  │   │    │   │   │
│  │  │  │  └────────────────────────────────────────────────┘   │    │   │   │
│  │  │  │  ┌─ Subnet: data-subnet ───────────────────────────┐   │    │   │   │
│  │  │  │  │  ┌─ Data Store: orders-db (POSTGRES) ──────┐   │   │    │   │   │
│  │  │  │  │  │   hosts: [Order] [Customer] [Address]    │   │   │    │   │   │
│  │  │  │  │  └────────────────────────────────────────────┘   │   │    │   │   │
│  │  │  │  └────────────────────────────────────────────────┘   │    │   │   │
│  │  │  └─────────────────────────────────────────────────────┘    │   │   │
│  │  │  ┌─ Regional Infrastructure Resources ─────────────────────┐  │   │   │
│  │  │  │   ◇ orders-events (MESSAGE_TOPIC)                       │  │   │   │
│  │  │  │   ◇ orders-bucket (OBJECT_BUCKET)                       │  │   │   │
│  │  │  │   ◇ orders-cache (CACHE)                                │  │   │   │
│  │  │  └──────────────────────────────────────────────────────────┘  │   │   │
│  │  └────────────────────────────────────────────────────────────────┘   │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────────────┘

GKE example (within a Subnet):

┌─ Compute Cluster: orders-gke (GKE, v1.28) ────────────────┐
│                                                            │
│  ┌─ Compute: orders-pod (KUBERNETES_WORKLOAD) ──────────┐ │
│  │  ┌─ ▶ Service: orders-service (PRIMARY) ────────┐    │ │
│  │  │   via Deployment Unit: orders-img:1.4.2       │    │ │
│  │  └────────────────────────────────────────────────┘    │ │
│  └────────────────────────────────────────────────────────┘ │
│  ┌─ Compute: invoices-pod (KUBERNETES_WORKLOAD) ────────┐ │
│  │  ┌─ ▶ Service: invoices-service ──────────────────┐  │ │
│  │  └──────────────────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────┘

Cross-domain edges (drawn, not nested):
   orders-service ──── uses (PUBLISHES_TO) ────▶ orders-events
   orders-listener ─── routes-to ───────────────▶ orders-cr
```

## Layout algorithm (sketch)

1. **Pick Environment** (header dropdown, default to first by order).
2. **Build containment tree**: Environment → CloudAccounts → Locations → Networks → Subnets → ComputeResources, walking up each entity's parent chain to find deepest defined container. Compute Resources also branch via `cluster_id` and `resource_subnet_hostings`.
3. **Hierarchical layout pass** (dagre-style or hand-rolled):
   - Each container = bounded rectangle, header at top.
   - Siblings packed horizontally at each level.
   - Containers grow to fit children.
   - Empty containers hidden.
4. **Tier overlays** (after main pass):
   - Load Balancers placed above their network (`network_id` if set, else above the entire region).
   - Listeners drawn inside their Load Balancer box.
   - Infrastructure Resources placed in "Regional Resources" shelf, sorted by `resource_type`.
   - Data Stores in their hosting subnet (deduced from `resource_subnet_hostings`); hosted data entity chips render inside.
5. **Cross-domain Service cards** rendered as children inside their Compute Resource (from `application_compute_deployments`). Visual treatment: subtle "Application domain" border (different color than infra) to signal cross-domain origin.
6. **Cross-domain edges** drawn last (Service→LB/Listener default ON, Service→IR default OFF), routed around containers via header toggles.
7. **Manual nudging is session-only** — clicking Re-layout discards manual positions; full re-run on every Environment switch.

## Out of scope

- Authoring on the canvas (use Tables UI or General DiagramType).
- Cost / monitoring / IAM / compliance overlays.
- Live cloud provider integration.
- Drift detection between model and actual cloud state.
- Sequence-style auto-arrangement of cross-domain edges (basic routing only).
- Multi-environment side-by-side comparison.

## Acceptance criteria

- Selecting `'Infrastructure'` DiagramType opens an environment picker (or auto-selects if only one Environment exists).
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
