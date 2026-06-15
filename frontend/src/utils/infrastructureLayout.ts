/**
 * infrastructureLayout.ts
 *
 * Spec 2026-05-05: Infrastructure Diagram V2 -- Auto-Layout & Cross-Domain Overlay
 * Task Group 1: Pure-function layout helper.
 *
 * Computes a positioned, hierarchical virtual-node tree (containers + leaves)
 * plus a cross-domain edge list for an Infrastructure-V2 diagram, given:
 *   - the full meta-model (`MetaModel`)
 *   - a chosen Environment id
 *   - a filter map (5 layer chips + 2 edge-overlay chips)
 *
 * Implements the 5-step algorithm:
 *   1. Lenient containment tree (Env > CloudAccount > Location > Network > Subnet > ComputeResource).
 *   2. Hand-rolled hierarchical pass: containers grow to fit children; siblings packed horizontally.
 *   3. Tier overlays (LBs above Network with Listeners nested; IR shelf; Data Stores in Subnet via
 *      `resource_subnet_hostings`; hosted Data entity chips inside via `data_entity_data_store_hostings`).
 *   4. Cross-domain Service cards rendered inside Compute Resources via `application_compute_deployments`.
 *   5. Cross-domain edges (Service -> LB/Listener; Service -> IR).
 *
 * Snake_case JSON field names honoured at every metaModel access.
 * No npm dependency added.
 */

import type {
  MetaModel,
  ApplicationPoint,
  ResourceSubnetHosting,
  ApplicationComputeDeployment,
  ApplicationLoadBalancerExposure,
  ApplicationInfrastructureResourceUse,
  DataEntityDataStoreHosting,
} from '../types/model';

// ============================================================================
// Public Types
// ============================================================================

export type LayoutNodeKind =
  | 'environment'
  | 'cloud_account'
  | 'location'
  | 'network'
  | 'subnet'
  | 'compute_cluster'
  | 'compute_resource'
  | 'load_balancer'
  | 'listener'
  | 'data_store'
  | 'infrastructure_resource'
  | 'regional_resources_shelf'
  | 'service_card'
  | 'data_entity_chip';

export interface LayoutNode {
  /** Unique id for the layout node (typically the underlying entity id; service_cards include compute id suffix). */
  id: string;
  kind: LayoutNodeKind;
  /** Underlying entity id (the row id from `metaModel.entities.<collection>`). Null for synthetic shelves. */
  entity_id: string | null;
  /** Maps to the SCREAMING_SNAKE_CASE entity type used by SelectionInspector arms. */
  entity_type: string | null;
  label: string;
  sublabel?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  parent_id: string | null;
  isContainer: boolean;
  isDashed?: boolean;
  isCrossDomain?: boolean;
  children: LayoutNode[];
}

export type LayoutEdgeKind = 'service_to_lb' | 'service_to_ir' | 'listener_to_compute';

export interface LayoutEdge {
  id: string;
  kind: LayoutEdgeKind;
  source_node_id: string;
  target_node_id: string;
  /** Underlying relationship type (snake_case collection key) for SelectionInspector dispatch. */
  relationship_type?: string;
  /** Underlying relationship row id. */
  relationship_id?: string;
  label?: string;
  dashed?: boolean;
}

export interface InfrastructureFilters {
  compute: boolean;
  data_stores: boolean;
  load_balancers: boolean;
  infrastructure_resources: boolean;
  services: boolean;
  service_to_lb_edges: boolean;
  service_to_ir_edges: boolean;
}

export interface LayoutResult {
  /** Flat list of every layout node produced (containers + leaves). */
  nodes: LayoutNode[];
  /** Cross-domain edges (filter-chip gating happens at render time, not here). */
  edges: LayoutEdge[];
  /** The single root node (Environment) -- handy for renderers that want a tree walk. */
  root: LayoutNode | null;
}

// ============================================================================
// Layout Constants
// ============================================================================

const HEADER_HEIGHT = 28;
const PADDING = 16;
const SIBLING_GAP = 16;
const ROW_GAP = 16;
const CONTAINER_MIN_WIDTH = 200;
const CONTAINER_MIN_HEIGHT = 80;

const LEAF_DIMENSIONS: Record<LayoutNodeKind, { width: number; height: number }> = {
  environment: { width: 320, height: 200 },
  cloud_account: { width: 280, height: 160 },
  location: { width: 260, height: 160 },
  network: { width: 240, height: 160 },
  subnet: { width: 220, height: 140 },
  compute_cluster: { width: 220, height: 120 },
  compute_resource: { width: 200, height: 100 },
  load_balancer: { width: 200, height: 80 },
  listener: { width: 160, height: 36 },
  data_store: { width: 200, height: 100 },
  infrastructure_resource: { width: 180, height: 36 },
  regional_resources_shelf: { width: 220, height: 100 },
  service_card: { width: 160, height: 50 },
  data_entity_chip: { width: 110, height: 26 },
};

// ============================================================================
// Public Entry Point
// ============================================================================

/**
 * Pure-function layout helper. Returns the positioned virtual node tree and cross-domain edges.
 *
 * The function does NOT apply filter-chip gating to the output -- emitting the full tree and
 * full edge list is correct for callers that want to gate post-layout. The renderer applies
 * the 5 layer chips + 2 edge-overlay chips at render time.
 */
export function layoutInfrastructureDiagram(
  metaModel: MetaModel,
  environmentId: string,
  // filters is part of the public API (per spec) but the helper does not gate output on it;
  // included for symmetry and future-proofing.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _filters: InfrastructureFilters,
): LayoutResult {
  const env = metaModel.entities.environments.find((e) => e.id === environmentId);
  if (!env) {
    return { nodes: [], edges: [], root: null };
  }

  // --------------------------------------------------------------------------
  // Step 1: Build the lenient containment tree.
  // --------------------------------------------------------------------------

  const nodeById = new Map<string, LayoutNode>();
  const childrenByParent = new Map<string, LayoutNode[]>();

  const root: LayoutNode = makeNode({
    id: env.id,
    kind: 'environment',
    entity_id: env.id,
    entity_type: 'ENVIRONMENT',
    label: env.name,
    sublabel: env.environment_type,
    parent_id: null,
    isContainer: true,
  });
  nodeById.set(root.id, root);
  childrenByParent.set(root.id, []);

  // Cloud Accounts in this environment
  for (const ca of metaModel.entities.cloud_accounts) {
    if (ca.environment_id !== environmentId) continue;
    const node = makeNode({
      id: ca.id,
      kind: 'cloud_account',
      entity_id: ca.id,
      entity_type: 'CLOUD_ACCOUNT',
      label: ca.name,
      sublabel: ca.provider,
      parent_id: root.id,
      isContainer: true,
    });
    nodeById.set(node.id, node);
    childrenByParent.set(node.id, []);
  }

  // Locations
  for (const loc of metaModel.entities.locations) {
    if (loc.environment_id !== environmentId) continue;
    const parentId = pickDeepestDefined([loc.cloud_account_id, environmentId], nodeById);
    const node = makeNode({
      id: loc.id,
      kind: 'location',
      entity_id: loc.id,
      entity_type: 'LOCATION',
      label: loc.name,
      sublabel: loc.provider_region_code,
      parent_id: parentId,
      isContainer: true,
    });
    nodeById.set(node.id, node);
    childrenByParent.set(node.id, []);
  }

  // Networks
  for (const net of metaModel.entities.networks) {
    if (net.environment_id !== environmentId) continue;
    const parentId = pickDeepestDefined(
      [net.location_id, net.cloud_account_id, environmentId],
      nodeById,
    );
    const node = makeNode({
      id: net.id,
      kind: 'network',
      entity_id: net.id,
      entity_type: 'NETWORK',
      label: net.name,
      sublabel: net.network_type,
      parent_id: parentId,
      isContainer: true,
    });
    nodeById.set(node.id, node);
    childrenByParent.set(node.id, []);
  }

  // Subnets
  for (const sn of metaModel.entities.subnets) {
    if (sn.environment_id !== environmentId) continue;
    const parentId = pickDeepestDefined(
      [sn.network_id, sn.location_id, environmentId],
      nodeById,
    );
    const node = makeNode({
      id: sn.id,
      kind: 'subnet',
      entity_id: sn.id,
      entity_type: 'SUBNET',
      label: sn.name,
      sublabel: sn.cidr,
      parent_id: parentId,
      isContainer: true,
    });
    nodeById.set(node.id, node);
    childrenByParent.set(node.id, []);
  }

  // Build polymorphic resource_subnet_hostings index: infrastructure_point_id -> subnet_id.
  // The entity-side resolution is done via the `infrastructure_points` table whose rows
  // expose the typed FK back to the concrete entity (compute_resource_id, data_store_instance_id,
  // load_balancer_id, infrastructure_resource_id).
  const subnetByInfraPointId = new Map<string, string>();
  for (const row of metaModel.relationships.resource_subnet_hostings) {
    subnetByInfraPointId.set(row.infrastructure_point_id, row.subnet_id);
  }

  // For each concrete entity that supports subnet-hosting, resolve its hosting subnet (if any).
  function subnetHostingFor(
    entityId: string | undefined,
    entityKind:
      | 'compute_resource_id'
      | 'data_store_instance_id'
      | 'load_balancer_id'
      | 'infrastructure_resource_id',
  ): string | undefined {
    if (!entityId) return undefined;
    const ip = metaModel.entities.infrastructure_points.find(
      (p) => p[entityKind] === entityId,
    );
    if (!ip) return undefined;
    return subnetByInfraPointId.get(ip.id);
  }

  // Compute Clusters
  for (const cl of metaModel.entities.compute_clusters) {
    if (cl.environment_id !== environmentId) continue;

    // Detect "spans subnets" case: compute resources of this cluster have rsh rows with
    // 2+ distinct subnet ids, OR cluster has network_id set with no member-defined subnet.
    const memberCRs = metaModel.entities.compute_resources.filter(
      (c) => c.cluster_id === cl.id && c.environment_id === environmentId,
    );
    const memberSubnetIds = new Set<string>();
    for (const cr of memberCRs) {
      const sn = subnetHostingFor(cr.id, 'compute_resource_id');
      if (sn) memberSubnetIds.add(sn);
    }

    let parentId: string;
    if (memberSubnetIds.size === 1) {
      // All members in a single subnet -- nest cluster inside that subnet.
      const onlySubnet = Array.from(memberSubnetIds)[0];
      parentId = pickDeepestDefined(
        [onlySubnet, cl.network_id, cl.location_id, cl.cloud_account_id, environmentId],
        nodeById,
      );
    } else {
      // Cluster spans subnets, OR has no subnet info -- nest at the network level (or fallback).
      parentId = pickDeepestDefined(
        [cl.network_id, cl.location_id, cl.cloud_account_id, environmentId],
        nodeById,
      );
    }

    const labelBits: string[] = [];
    if (cl.platform_type) labelBits.push(cl.platform_type);
    if (cl.version) labelBits.push(cl.version);
    const node = makeNode({
      id: cl.id,
      kind: 'compute_cluster',
      entity_id: cl.id,
      entity_type: 'COMPUTE_CLUSTER',
      label: cl.name,
      sublabel: labelBits.join(' ') || undefined,
      parent_id: parentId,
      isContainer: true,
      isDashed: true,
    });
    nodeById.set(node.id, node);
    childrenByParent.set(node.id, []);
  }

  // Compute Resources
  for (const cr of metaModel.entities.compute_resources) {
    if (cr.environment_id !== environmentId) continue;

    // Walk: cluster_id (if defined) > subnet hosting > network/location/cloud account/env.
    let parentId: string;
    if (cr.cluster_id && nodeById.has(cr.cluster_id)) {
      parentId = cr.cluster_id;
    } else {
      const hostingSubnet = subnetHostingFor(cr.id, 'compute_resource_id');
      parentId = pickDeepestDefined(
        [hostingSubnet, cr.location_id, cr.cloud_account_id, environmentId],
        nodeById,
      );
    }

    const node = makeNode({
      id: cr.id,
      kind: 'compute_resource',
      entity_id: cr.id,
      entity_type: 'COMPUTE_RESOURCE',
      label: cr.name,
      sublabel: cr.compute_type,
      parent_id: parentId,
      isContainer: true,
    });
    nodeById.set(node.id, node);
    childrenByParent.set(node.id, []);
  }

  // Data Stores -- placed inside hosting Subnet (or shallower fallback)
  for (const ds of metaModel.entities.data_store_instances) {
    if (ds.environment_id !== environmentId) continue;
    const hostingSubnet = subnetHostingFor(ds.id, 'data_store_instance_id');
    const parentId = pickDeepestDefined(
      [hostingSubnet, ds.location_id, ds.cloud_account_id, environmentId],
      nodeById,
    );
    const node = makeNode({
      id: ds.id,
      kind: 'data_store',
      entity_id: ds.id,
      entity_type: 'DATA_STORE_INSTANCE',
      label: ds.name,
      sublabel: ds.engine,
      parent_id: parentId,
      isContainer: true,
    });
    nodeById.set(node.id, node);
    childrenByParent.set(node.id, []);
  }

  // Load Balancers -- tier OVERLAY parented at the same level as their Network's parent
  // (so they sit above the Network visually). If no network_id, parent at Environment.
  for (const lb of metaModel.entities.load_balancers) {
    if (lb.environment_id !== environmentId) continue;
    let parentId: string;
    if (lb.network_id && nodeById.has(lb.network_id)) {
      const networkNode = nodeById.get(lb.network_id)!;
      parentId = networkNode.parent_id ?? environmentId;
    } else {
      parentId = pickDeepestDefined(
        [lb.location_id, lb.cloud_account_id, environmentId],
        nodeById,
      );
    }
    const node = makeNode({
      id: lb.id,
      kind: 'load_balancer',
      entity_id: lb.id,
      entity_type: 'LOAD_BALANCER',
      label: lb.name,
      sublabel: lb.load_balancer_type,
      parent_id: parentId,
      isContainer: true,
    });
    nodeById.set(node.id, node);
    childrenByParent.set(node.id, []);
  }

  // Listeners -- nested inside their LoadBalancer
  for (const ln of metaModel.entities.listeners) {
    if (ln.environment_id !== environmentId) continue;
    if (!ln.load_balancer_id || !nodeById.has(ln.load_balancer_id)) continue;
    const node = makeNode({
      id: ln.id,
      kind: 'listener',
      entity_id: ln.id,
      entity_type: 'LISTENER',
      label: ln.name,
      sublabel: formatListenerSublabel(ln.protocol, ln.port),
      parent_id: ln.load_balancer_id,
      isContainer: false,
    });
    nodeById.set(node.id, node);
    childrenByParent.set(node.id, []);
  }

  // Infrastructure Resources -- "Regional Resources" shelf per parent (Environment or CloudAccount).
  // Spec: shelf BELOW or BESIDE the Network. Implementation: one shelf per Environment as the
  // simplest realisation, with IRs sorted by `resource_type` ascending.
  const irs = metaModel.entities.infrastructure_resources
    .filter((r) => r.environment_id === environmentId)
    .sort((a, b) =>
      (a.resource_type || '').localeCompare(b.resource_type || '')
        || a.name.localeCompare(b.name),
    );
  if (irs.length > 0) {
    const shelfId = `__shelf__:${environmentId}`;
    const shelfNode = makeNode({
      id: shelfId,
      kind: 'regional_resources_shelf',
      entity_id: null,
      entity_type: null,
      label: 'Regional Resources',
      parent_id: environmentId,
      isContainer: true,
    });
    nodeById.set(shelfId, shelfNode);
    childrenByParent.set(shelfId, []);

    for (const ir of irs) {
      const node = makeNode({
        id: ir.id,
        kind: 'infrastructure_resource',
        entity_id: ir.id,
        entity_type: 'INFRASTRUCTURE_RESOURCE',
        label: ir.name,
        sublabel: ir.resource_type,
        parent_id: shelfId,
        isContainer: false,
      });
      nodeById.set(node.id, node);
      childrenByParent.set(node.id, []);
    }
  }

  // --------------------------------------------------------------------------
  // Step 4: Cross-domain Service cards inside Compute Resources.
  // --------------------------------------------------------------------------

  const serviceCardNodeIds = new Map<string, string>(); // key: `${serviceId}::${computeResourceId}` -> nodeId
  // Resolve application_points service_id by id for fast lookup.
  const apById = new Map<string, ApplicationPoint>();
  for (const ap of metaModel.entities.application_points) {
    apById.set(ap.id, ap);
  }

  for (const dep of metaModel.relationships.application_compute_deployments as ApplicationComputeDeployment[]) {
    const cr = metaModel.entities.compute_resources.find((c) => c.id === dep.compute_resource_id);
    if (!cr) continue;
    if (cr.environment_id !== environmentId) continue;
    if (!nodeById.has(cr.id)) continue;

    const ap = apById.get(dep.application_point_id);
    if (!ap) continue;
    // Service-only per spec; skip Application targets.
    if (ap.target_type !== 'SERVICE' || !ap.target_ref_id) continue;
    const svc = metaModel.entities.services.find((s) => s.id === ap.target_ref_id);
    if (!svc) continue;

    const cardId = `service_card::${svc.id}::${cr.id}`;
    if (nodeById.has(cardId)) continue;
    const node = makeNode({
      id: cardId,
      kind: 'service_card',
      entity_id: svc.id,
      entity_type: 'SERVICE',
      label: svc.name,
      sublabel: svc.service_type,
      parent_id: cr.id,
      isContainer: false,
      isCrossDomain: true,
    });
    nodeById.set(cardId, node);
    childrenByParent.set(cardId, []);
    serviceCardNodeIds.set(`${svc.id}::${cr.id}`, cardId);
  }

  // --------------------------------------------------------------------------
  // Step 3 (continued): Data entity chips inside Data Stores.
  // --------------------------------------------------------------------------

  // Resolve data_entity_points by id (both logical_data_entity and physical_data_entity targets
  // can be referenced via data_entity_point_id; render entity name from whichever exists).
  for (const row of metaModel.relationships
    .data_entity_data_store_hostings as DataEntityDataStoreHosting[]) {
    const ds = metaModel.entities.data_store_instances.find(
      (d) => d.id === row.data_store_instance_id,
    );
    if (!ds) continue;
    if (ds.environment_id !== environmentId) continue;
    if (!nodeById.has(ds.id)) continue;

    // Resolve the data entity name via either logical or physical data entity points.
    // Codebase has `logical_data_entities` and `physical_data_entities` collections;
    // the cross-domain hosting row references a polymorphic point id. We try both.
    const lookupId = row.data_entity_point_id;
    let entityName: string | undefined;
    let entityType: string | null = null;
    let entityId: string | null = null;
    const logicalMatch = metaModel.entities.logical_data_entities.find(
      (e) => e.id === lookupId,
    );
    if (logicalMatch) {
      entityName = logicalMatch.name;
      entityType = 'LOGICAL_DATA_ENTITY';
      entityId = logicalMatch.id;
    } else {
      const physMatch = metaModel.entities.physical_data_entities.find(
        (e) => e.id === lookupId,
      );
      if (physMatch) {
        entityName = physMatch.name;
        entityType = 'PHYSICAL_DATA_ENTITY';
        entityId = physMatch.id;
      }
    }
    if (!entityName) {
      // Fallback chip with the row id (preserves visibility even if name resolution fails).
      entityName = row.table_or_collection_name || 'Data entity';
    }

    const chipId = `data_chip::${row.id}`;
    const node = makeNode({
      id: chipId,
      kind: 'data_entity_chip',
      entity_id: entityId,
      entity_type: entityType,
      label: entityName,
      parent_id: ds.id,
      isContainer: false,
      isCrossDomain: true,
    });
    nodeById.set(chipId, node);
    childrenByParent.set(chipId, []);
  }

  // --------------------------------------------------------------------------
  // Build childrenByParent properly from nodeById parent_id field.
  // --------------------------------------------------------------------------

  for (const [, n] of nodeById) {
    if (n.parent_id && childrenByParent.has(n.parent_id)) {
      const list = childrenByParent.get(n.parent_id)!;
      if (!list.includes(n)) list.push(n);
    }
  }

  // --------------------------------------------------------------------------
  // Hide empty containers by pruning bottom-up.
  // --------------------------------------------------------------------------

  // A container is "empty" if it has no children AFTER pruning.
  // Containers that hold no real children but have entity_id are still pruned
  // when they're intermediate-only (Cloud Accounts / Locations / Networks / Subnets).
  // The Environment root is never pruned.
  // Compute Cluster with zero member CRs is pruned.
  const PRUNABLE_KINDS: LayoutNodeKind[] = [
    'cloud_account',
    'location',
    'network',
    'subnet',
    'compute_cluster',
    'regional_resources_shelf',
  ];

  function pruneEmpty(nodeId: string): boolean {
    const node = nodeById.get(nodeId);
    if (!node) return false;
    const children = childrenByParent.get(nodeId) ?? [];
    // Recurse children first
    for (const child of [...children]) {
      const removed = pruneEmpty(child.id);
      if (removed) {
        const idx = children.indexOf(child);
        if (idx >= 0) children.splice(idx, 1);
        nodeById.delete(child.id);
        childrenByParent.delete(child.id);
      }
    }
    // Now decide if THIS node should be pruned
    if (node.id === root.id) return false;
    if (!PRUNABLE_KINDS.includes(node.kind)) return false;
    return children.length === 0;
  }
  pruneEmpty(root.id);

  // --------------------------------------------------------------------------
  // Step 2: Hand-rolled hierarchical pass -- bottom-up sizing, top-down placement.
  // --------------------------------------------------------------------------

  // Recursive size + layout: returns { width, height } for the node.
  function layoutSubtree(nodeId: string): { width: number; height: number } {
    const node = nodeById.get(nodeId);
    if (!node) return { width: 0, height: 0 };
    const children = childrenByParent.get(nodeId) ?? [];
    if (!node.isContainer || children.length === 0) {
      // Leaf -- use kind defaults (or current size if already set).
      const dims = LEAF_DIMENSIONS[node.kind];
      node.width = Math.max(node.width, dims.width);
      node.height = Math.max(node.height, dims.height);
      // Special-case: containers with no children but isContainer=true (e.g. an empty Compute
      // Resource in spec-driven sparse models) keep the leaf default.
      return { width: node.width, height: node.height };
    }

    // Container with children: lay out children left-to-right in rows.
    // Wrap rows when row width exceeds the container's "preferred" width.
    // We pack into a single row by default; multi-row wrapping kicks in only if many children.
    const childSizes: Array<{ child: LayoutNode; w: number; h: number }> = [];
    for (const child of children) {
      const s = layoutSubtree(child.id);
      childSizes.push({ child, w: s.width, h: s.height });
    }

    // Pack into rows (single-row when small, wrap to a max row width otherwise).
    const maxRowWidth = 1400; // soft wrap
    const rows: Array<Array<{ child: LayoutNode; w: number; h: number }>> = [];
    let currentRow: Array<{ child: LayoutNode; w: number; h: number }> = [];
    let currentRowWidth = 0;
    for (const cs of childSizes) {
      const widthIfAdded = currentRow.length === 0 ? cs.w : currentRowWidth + SIBLING_GAP + cs.w;
      if (currentRow.length > 0 && widthIfAdded > maxRowWidth) {
        rows.push(currentRow);
        currentRow = [cs];
        currentRowWidth = cs.w;
      } else {
        currentRow.push(cs);
        currentRowWidth = widthIfAdded;
      }
    }
    if (currentRow.length > 0) rows.push(currentRow);

    // Position children within the container, header strip on top.
    let cursorY = HEADER_HEIGHT + PADDING;
    let contentMaxWidth = 0;
    for (const row of rows) {
      let cursorX = PADDING;
      let rowMaxHeight = 0;
      for (const cs of row) {
        cs.child.x = cursorX;
        cs.child.y = cursorY;
        cursorX += cs.w + SIBLING_GAP;
        if (cs.h > rowMaxHeight) rowMaxHeight = cs.h;
      }
      const rowWidth = cursorX - SIBLING_GAP; // last gap doesn't count
      if (rowWidth > contentMaxWidth) contentMaxWidth = rowWidth;
      cursorY += rowMaxHeight + ROW_GAP;
    }
    // Remove trailing row gap, add bottom padding.
    cursorY = cursorY - ROW_GAP + PADDING;

    const containerWidth = Math.max(
      CONTAINER_MIN_WIDTH,
      contentMaxWidth + PADDING, // contentMaxWidth already starts at PADDING
    );
    const containerHeight = Math.max(CONTAINER_MIN_HEIGHT, cursorY);

    node.width = containerWidth;
    node.height = containerHeight;
    return { width: containerWidth, height: containerHeight };
  }

  layoutSubtree(root.id);

  // Set root x/y to 0/0
  root.x = 0;
  root.y = 0;

  // --------------------------------------------------------------------------
  // Materialise children arrays on each node for tree-walking by callers.
  // --------------------------------------------------------------------------

  for (const [id, n] of nodeById) {
    n.children = childrenByParent.get(id) ?? [];
  }

  // --------------------------------------------------------------------------
  // Step 5: Cross-domain edges.
  // --------------------------------------------------------------------------

  const edges: LayoutEdge[] = [];

  // Service -> LB / Listener
  for (const exp of metaModel.relationships.application_load_balancer_exposures as ApplicationLoadBalancerExposure[]) {
    const lb = metaModel.entities.load_balancers.find((l) => l.id === exp.load_balancer_id);
    if (!lb) continue;
    if (lb.environment_id !== environmentId) continue;
    const ap = apById.get(exp.application_point_id);
    if (!ap) continue;
    if (ap.target_type !== 'SERVICE' || !ap.target_ref_id) continue;
    const serviceId = ap.target_ref_id;

    // Find each Service-card node for this service (multi-deployment renders 1 card per CR).
    for (const [key, cardId] of serviceCardNodeIds) {
      if (!key.startsWith(`${serviceId}::`)) continue;
      const targetId = exp.listener_id && nodeById.has(exp.listener_id)
        ? exp.listener_id
        : (nodeById.has(lb.id) ? lb.id : null);
      if (!targetId) continue;
      edges.push({
        id: `edge::lb::${exp.id}::${cardId}`,
        kind: 'service_to_lb',
        source_node_id: cardId,
        target_node_id: targetId,
        relationship_type: 'application_load_balancer_exposures',
        relationship_id: exp.id,
        label: 'routes-to',
      });
    }
  }

  // Service -> IR
  for (const use of metaModel.relationships.application_infrastructure_resource_uses as ApplicationInfrastructureResourceUse[]) {
    const ir = metaModel.entities.infrastructure_resources.find(
      (r) => r.id === use.infrastructure_resource_id,
    );
    if (!ir) continue;
    if (ir.environment_id !== environmentId) continue;
    if (!nodeById.has(ir.id)) continue;
    const ap = apById.get(use.application_point_id);
    if (!ap) continue;
    if (ap.target_type !== 'SERVICE' || !ap.target_ref_id) continue;
    const serviceId = ap.target_ref_id;
    for (const [key, cardId] of serviceCardNodeIds) {
      if (!key.startsWith(`${serviceId}::`)) continue;
      edges.push({
        id: `edge::ir::${use.id}::${cardId}`,
        kind: 'service_to_ir',
        source_node_id: cardId,
        target_node_id: ir.id,
        relationship_type: 'application_infrastructure_resource_uses',
        relationship_id: use.id,
        label: 'uses',
        dashed: true,
      });
    }
  }

  // Final: produce a flat node list (in deterministic insertion order)
  const nodes: LayoutNode[] = [];
  // BFS from root so containers come before leaves
  const queue: string[] = [root.id];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const n = nodeById.get(id);
    if (!n) continue;
    nodes.push(n);
    const childList = childrenByParent.get(id) ?? [];
    for (const c of childList) queue.push(c.id);
  }

  return { nodes, edges, root };
}

// ============================================================================
// Helpers
// ============================================================================

function makeNode(seed: {
  id: string;
  kind: LayoutNodeKind;
  entity_id: string | null;
  entity_type: string | null;
  label: string;
  sublabel?: string;
  parent_id: string | null;
  isContainer: boolean;
  isDashed?: boolean;
  isCrossDomain?: boolean;
}): LayoutNode {
  const dims = LEAF_DIMENSIONS[seed.kind];
  return {
    id: seed.id,
    kind: seed.kind,
    entity_id: seed.entity_id,
    entity_type: seed.entity_type,
    label: seed.label,
    sublabel: seed.sublabel,
    x: 0,
    y: 0,
    width: dims.width,
    height: dims.height,
    parent_id: seed.parent_id,
    isContainer: seed.isContainer,
    isDashed: seed.isDashed,
    isCrossDomain: seed.isCrossDomain,
    children: [],
  };
}

/**
 * Walk a list of candidate parent ids in deepest-first order; return the first one
 * that exists in the layout-node map. Falls back to environmentId if none found
 * (the Environment root always exists as the last fallback).
 *
 * The caller MUST include `environmentId` as the final entry.
 */
function pickDeepestDefined(
  candidates: Array<string | null | undefined>,
  nodeById: Map<string, LayoutNode>,
): string {
  for (const c of candidates) {
    if (typeof c === 'string' && nodeById.has(c)) return c;
  }
  // Should never hit since environmentId is the final fallback and root is always present;
  // Defensive: throw to surface bugs in dev.
  throw new Error('infrastructureLayout: no parent candidate matched (missing environment root?)');
}

function formatListenerSublabel(protocol?: string, port?: number): string | undefined {
  const bits: string[] = [];
  if (protocol) bits.push(protocol);
  if (typeof port === 'number') bits.push(String(port));
  return bits.length > 0 ? bits.join(':') : undefined;
}

// ============================================================================
// Default-filter helper (renderer-side convenience export).
// ============================================================================

/** Build the default filter map (5 layer chips ON, S->LB ON, S->IR OFF). */
export function defaultInfrastructureFilters(): InfrastructureFilters {
  return {
    compute: true,
    data_stores: true,
    load_balancers: true,
    infrastructure_resources: true,
    services: true,
    service_to_lb_edges: true,
    service_to_ir_edges: false,
  };
}

/**
 * Apply a partial filters object on top of defaults.
 * - 5 layer chips + S->LB default ON if undefined.
 * - S->IR default OFF if undefined.
 */
export function resolveInfrastructureFilters(
  partial: Partial<InfrastructureFilters> | undefined,
): InfrastructureFilters {
  const def = defaultInfrastructureFilters();
  if (!partial) return def;
  return {
    compute: partial.compute ?? def.compute,
    data_stores: partial.data_stores ?? def.data_stores,
    load_balancers: partial.load_balancers ?? def.load_balancers,
    infrastructure_resources: partial.infrastructure_resources ?? def.infrastructure_resources,
    services: partial.services ?? def.services,
    service_to_lb_edges: partial.service_to_lb_edges ?? def.service_to_lb_edges,
    service_to_ir_edges: partial.service_to_ir_edges ?? def.service_to_ir_edges,
  };
}

// Re-export rsh for unit-test convenience
export type { ResourceSubnetHosting };
