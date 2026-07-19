/**
 * Security Summary diagram generation (Security health dashboard, 2026-07-19;
 * service-level association second wave, Spec C of 3).
 *
 * Derives the persisted "Security Summary" diagram from the architecture
 * model according to the DISPLAY-LEVELS config (a chain-ordered non-empty
 * subset of Application -> Application Component -> Service, persisted on the
 * diagram's settings): one box per entity of the outermost displayed level,
 * with deeper displayed levels NESTED inside via {@code parent_node_id}
 * containment (hidden intermediate levels are skipped -- e.g. displaying
 * App -> Service puts service boxes directly inside application boxes).
 *
 * Edges are data movements rolled to the NEAREST DISPLAYED level: each
 * movement endpoint resolves through application points to its
 * service/component/application chain, then to the deepest displayed box on
 * that chain; distinct directed pairs only; same-box loops dropped.
 *
 * Regeneration preserves the user's work:
 *   - surviving OUTERMOST boxes keep their position (sizes recompute to fit
 *     children); children re-lay deterministically inside;
 *   - derived nodes keep their node ids across regenerations (entity-keyed),
 *     so user-added edges referencing them stay valid;
 *   - user-added nodes (entity types outside the hierarchy) survive verbatim,
 *     as do their edges and any non-derived edges between surviving nodes;
 *   - DATA_MOVEMENT edges always re-derive from the model (movements added in
 *     the Diagrams area edit the model, so they become derived and survive by
 *     construction), reusing the existing edge object per pair so styling
 *     tweaks persist.
 *
 * Severity circles are NEVER part of the diagram content -- the Security
 * Overview computes them at render time via
 * {@link aggregateSecurityCountsToDisplayedEntities}
 * (nearest-displayed-ancestor rule).
 */

import type { Diagram, DiagramEdge, DiagramNode, MetaModel } from '../types/model';
import { ENTITY_TYPES } from '../types/model';
import { generatePrefixedId } from './idGenerator';
import { LEVEL_ORDER, SecurityAssociationLevel } from './securityLevels';

export const SECURITY_SUMMARY_DIAGRAM_TYPE = 'SECURITY_SUMMARY';
export const SECURITY_SUMMARY_DIAGRAM_NAME = 'Security Summary';

const LEAF_WIDTH = 200;
const LEAF_HEIGHT = 96;
const PARENT_TITLE_BAND = 34;
const PARENT_PADDING = 16;
const CHILD_GAP = 14;
const GRID_GAP_X = 70;
const GRID_GAP_Y = 60;
const GRID_ORIGIN_X = 60;
const GRID_ORIGIN_Y = 60;

const LEVEL_ENTITY_TYPE: Record<SecurityAssociationLevel, string> = {
  application: ENTITY_TYPES.APPLICATION,
  application_component: ENTITY_TYPES.APP_COMPONENT,
  service: ENTITY_TYPES.SERVICE,
};

const HIERARCHY_ENTITY_TYPES = new Set<string>(Object.values(LEVEL_ENTITY_TYPE));

/** Chain-ordered, non-empty display levels (falls back to application-only). */
export function normalizeDisplayLevels(
  levels: SecurityAssociationLevel[] | null | undefined,
): SecurityAssociationLevel[] {
  const ordered = LEVEL_ORDER.filter((l) => levels?.includes(l));
  return ordered.length > 0 ? ordered : ['application'];
}

/** The service/component/application ancestry chain of one model entity. */
interface EntityChain {
  applicationId: string | null;
  applicationComponentId: string | null;
  serviceId: string | null;
}

/** Resolve every model entity's chain once (services inherit app via component). */
function buildChains(metaModel: MetaModel): Map<string, EntityChain> {
  const chains = new Map<string, EntityChain>();
  const compById = new Map(metaModel.entities.app_components.map((c) => [c.id, c]));
  for (const app of metaModel.entities.applications) {
    chains.set(app.id, { applicationId: app.id, applicationComponentId: null, serviceId: null });
  }
  for (const comp of metaModel.entities.app_components) {
    chains.set(comp.id, {
      applicationId: comp.application_id ?? null,
      applicationComponentId: comp.id,
      serviceId: null,
    });
  }
  for (const service of metaModel.entities.services) {
    const comp = service.app_component_id ? compById.get(service.app_component_id) : undefined;
    chains.set(service.id, {
      applicationId: service.application_id || comp?.application_id || null,
      applicationComponentId: service.app_component_id ?? null,
      serviceId: service.id,
    });
  }
  return chains;
}

/** One generated hierarchy box before layout. */
interface TreeBox {
  entityId: string;
  entityType: string;
  level: SecurityAssociationLevel;
  children: TreeBox[];
  width: number;
  height: number;
}

/** Build the displayed tree: outermost level's entities with nested displayed descendants. */
function buildDisplayTree(
  metaModel: MetaModel,
  displayLevels: SecurityAssociationLevel[],
  chains: Map<string, EntityChain>,
): TreeBox[] {
  const levelIds: Record<SecurityAssociationLevel, { id: string; name: string }[]> = {
    application: metaModel.entities.applications.map((a) => ({ id: a.id, name: a.name })),
    application_component: metaModel.entities.app_components.map((c) => ({ id: c.id, name: c.name })),
    service: metaModel.entities.services.map((s) => ({ id: s.id, name: s.name })),
  };
  const sortByName = (arr: { id: string; name: string }[]) =>
    [...arr].sort((a, b) => a.name.localeCompare(b.name));

  const childField: Record<SecurityAssociationLevel, keyof EntityChain> = {
    application: 'applicationId',
    application_component: 'applicationComponentId',
    service: 'serviceId',
  };

  const buildLevel = (levelIndex: number, parentLevel: SecurityAssociationLevel | null, parentId: string | null): TreeBox[] => {
    const level = displayLevels[levelIndex];
    const entities = sortByName(levelIds[level]).filter((entity) => {
      if (parentLevel === null) return true;
      const chain = chains.get(entity.id);
      return chain?.[childField[parentLevel]] === parentId;
    });
    return entities.map((entity) => {
      const children =
        levelIndex + 1 < displayLevels.length
          ? buildLevel(levelIndex + 1, level, entity.id)
          : [];
      return {
        entityId: entity.id,
        entityType: LEVEL_ENTITY_TYPE[level],
        level,
        children,
        width: LEAF_WIDTH,
        height: LEAF_HEIGHT,
      };
    });
  };
  return buildLevel(0, null, null);
}

/** Bottom-up sizing: parents grow to fit their children's grid. */
function sizeTree(box: TreeBox): void {
  if (box.children.length === 0) {
    box.width = LEAF_WIDTH;
    box.height = LEAF_HEIGHT;
    return;
  }
  box.children.forEach(sizeTree);
  const cols = Math.max(1, Math.ceil(Math.sqrt(box.children.length)));
  const rows = Math.ceil(box.children.length / cols);
  const cellWidth = Math.max(...box.children.map((c) => c.width));
  const cellHeight = Math.max(...box.children.map((c) => c.height));
  box.width = Math.max(
    LEAF_WIDTH,
    cols * cellWidth + (cols - 1) * CHILD_GAP + 2 * PARENT_PADDING,
  );
  box.height =
    PARENT_TITLE_BAND + rows * cellHeight + (rows - 1) * CHILD_GAP + PARENT_PADDING;
}

/** Emit nodes depth-first with ABSOLUTE positions; children grid inside parent. */
function emitNodes(
  box: TreeBox,
  x: number,
  y: number,
  parentNodeId: string | null,
  nodeIdFor: (entityType: string, entityId: string) => string,
  out: DiagramNode[],
): void {
  const nodeId = nodeIdFor(box.entityType, box.entityId);
  out.push({
    id: nodeId,
    entity_type: box.entityType,
    entity_id: box.entityId,
    pos_x: x,
    pos_y: y,
    width: box.width,
    height: box.height,
    parent_node_id: parentNodeId,
  });
  if (box.children.length === 0) return;
  const cols = Math.max(1, Math.ceil(Math.sqrt(box.children.length)));
  const cellWidth = Math.max(...box.children.map((c) => c.width));
  const cellHeight = Math.max(...box.children.map((c) => c.height));
  box.children.forEach((child, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    emitNodes(
      child,
      x + PARENT_PADDING + col * (cellWidth + CHILD_GAP),
      y + PARENT_TITLE_BAND + row * (cellHeight + CHILD_GAP),
      nodeId,
      nodeIdFor,
      out,
    );
  });
}

/**
 * Roll every data movement up to a directed pair of DISPLAYED entity ids
 * (deepest displayed box on each endpoint's chain). Distinct pairs only;
 * unresolvable endpoints and same-box loops dropped.
 */
export function rollUpDataMovementsToDisplayedPairs(
  metaModel: MetaModel,
  displayLevels: SecurityAssociationLevel[],
  displayedEntityIds: Set<string>,
): { sourceEntityId: string; targetEntityId: string }[] {
  const chains = buildChains(metaModel);
  const pointChain = (applicationPointId: string): EntityChain | null => {
    const point = metaModel.entities.application_points.find((ap) => ap.id === applicationPointId);
    if (!point) return null;
    const anchor = point.service_id ?? point.application_component_id ?? point.application_id;
    return anchor ? chains.get(anchor) ?? null : null;
  };
  const deepestDisplayed = (chain: EntityChain | null): string | null => {
    if (!chain) return null;
    const byLevel: Record<SecurityAssociationLevel, string | null> = {
      application: chain.applicationId,
      application_component: chain.applicationComponentId,
      service: chain.serviceId,
    };
    for (let i = displayLevels.length - 1; i >= 0; i--) {
      const candidate = byLevel[displayLevels[i]];
      if (candidate && displayedEntityIds.has(candidate)) return candidate;
    }
    return null;
  };
  const seen = new Set<string>();
  const pairs: { sourceEntityId: string; targetEntityId: string }[] = [];
  for (const movement of metaModel.relationships.data_movements) {
    const source = deepestDisplayed(pointChain(movement.source_application_point_id));
    const target = deepestDisplayed(pointChain(movement.target_application_point_id));
    if (!source || !target || source === target) continue;
    const key = `${source}->${target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push({ sourceEntityId: source, targetEntityId: target });
  }
  return pairs;
}

/**
 * Generate (or REgenerate) the Security Summary diagram from the model for
 * the given display levels. See the module doc for the preservation rules.
 */
export function generateSecuritySummaryDiagram(
  metaModel: MetaModel,
  displayLevels: SecurityAssociationLevel[],
  existing?: Diagram | null,
): Diagram {
  const levels = normalizeDisplayLevels(displayLevels);
  const chains = buildChains(metaModel);
  const tree = buildDisplayTree(metaModel, levels, chains);
  tree.forEach(sizeTree);

  // Entity-keyed node-id reuse keeps user-added edges valid across regens.
  const existingNodeByEntity = new Map<string, DiagramNode>();
  const userNodes: DiagramNode[] = [];
  for (const node of existing?.diagram_nodes ?? []) {
    if (HIERARCHY_ENTITY_TYPES.has(node.entity_type)) {
      existingNodeByEntity.set(`${node.entity_type}:${node.entity_id}`, node);
    } else {
      userNodes.push({ ...node });
    }
  }
  const nodeIdFor = (entityType: string, entityId: string): string =>
    existingNodeByEntity.get(`${entityType}:${entityId}`)?.id ?? generatePrefixedId('node');

  // Top-level layout: surviving outermost boxes keep their POSITION (sizes
  // recompute to fit children); new boxes grid BELOW the preserved layout.
  const nodes: DiagramNode[] = [];
  const preservedTop = tree.filter((box) =>
    existingNodeByEntity.has(`${box.entityType}:${box.entityId}`));
  const preservedBottom = preservedTop.length === 0
    ? GRID_ORIGIN_Y - GRID_GAP_Y
    : Math.max(...preservedTop.map((box) => {
        const prior = existingNodeByEntity.get(`${box.entityType}:${box.entityId}`)!;
        return prior.pos_y + box.height;
      }));
  const columns = Math.max(1, Math.ceil(Math.sqrt(tree.length)));
  const cellWidth = tree.length ? Math.max(...tree.map((b) => b.width)) : LEAF_WIDTH;
  const cellHeight = tree.length ? Math.max(...tree.map((b) => b.height)) : LEAF_HEIGHT;
  let gridSlot = 0;
  for (const box of tree) {
    const prior = existingNodeByEntity.get(`${box.entityType}:${box.entityId}`);
    let x: number;
    let y: number;
    if (prior) {
      x = prior.pos_x;
      y = prior.pos_y;
    } else {
      const col = gridSlot % columns;
      const row = Math.floor(gridSlot / columns);
      gridSlot++;
      x = GRID_ORIGIN_X + col * (cellWidth + GRID_GAP_X);
      y = preservedBottom + GRID_GAP_Y + row * (cellHeight + GRID_GAP_Y);
    }
    emitNodes(box, x, y, null, nodeIdFor, nodes);
  }
  // User-added nodes survive verbatim (re-parented to root if their parent left).
  const derivedNodeIds = new Set(nodes.map((n) => n.id));
  for (const userNode of userNodes) {
    if (userNode.parent_node_id && !derivedNodeIds.has(userNode.parent_node_id)) {
      userNode.parent_node_id = null;
    }
    nodes.push(userNode);
  }

  const nodeIdByEntity = new Map<string, string>();
  for (const node of nodes) {
    if (HIERARCHY_ENTITY_TYPES.has(node.entity_type)) {
      nodeIdByEntity.set(node.entity_id, node.id);
    }
  }

  // Edges: DATA_MOVEMENT re-derived at the displayed level (existing pair
  // edges reused so styling persists); user-added non-derived edges kept when
  // both endpoints survive.
  const allNodeIds = new Set(nodes.map((n) => n.id));
  const existingEdgeByPair = new Map<string, DiagramEdge>();
  const userEdges: DiagramEdge[] = [];
  for (const edge of existing?.diagram_edges ?? []) {
    if (edge.relationship_type === 'DATA_MOVEMENT') {
      existingEdgeByPair.set(`${edge.source_node_id}->${edge.target_node_id}`, edge);
    } else if (allNodeIds.has(edge.source_node_id) && allNodeIds.has(edge.target_node_id)) {
      userEdges.push({ ...edge });
    }
  }
  const edges: DiagramEdge[] = [];
  const displayedEntityIds = new Set(nodeIdByEntity.keys());
  for (const pair of rollUpDataMovementsToDisplayedPairs(metaModel, levels, displayedEntityIds)) {
    const sourceNodeId = nodeIdByEntity.get(pair.sourceEntityId);
    const targetNodeId = nodeIdByEntity.get(pair.targetEntityId);
    if (!sourceNodeId || !targetNodeId) continue;
    const preserved = existingEdgeByPair.get(`${sourceNodeId}->${targetNodeId}`);
    if (preserved) {
      edges.push({ ...preserved });
      continue;
    }
    edges.push({
      id: generatePrefixedId('edge'),
      relationship_type: 'DATA_MOVEMENT',
      relationship_id: '',
      source_node_id: sourceNodeId,
      target_node_id: targetNodeId,
      arrow_end: 'arrow',
      edge_points: [],
    });
  }
  edges.push(...userEdges);

  return {
    id: existing?.id ?? generatePrefixedId('diag'),
    name: existing?.name ?? SECURITY_SUMMARY_DIAGRAM_NAME,
    description:
      existing?.description ??
      'Generated department security summary: applications + data movements. ' +
        'Severity overlays are computed live on the Security Overview screen.',
    diagram_type: SECURITY_SUMMARY_DIAGRAM_TYPE,
    settings: { ...(existing?.settings ?? {}), security_display_levels: levels },
    diagram_nodes: nodes,
    diagram_edges: edges,
  } as Diagram;
}

/**
 * Nearest-displayed-ancestor aggregation for the Overview circles: attach
 * each rollup entry's counts to the deepest DISPLAYED box on its ancestor
 * chain. Entries whose whole chain is undisplayed (model drift) are dropped
 * -- the report totals still show them.
 */
export function aggregateSecurityCountsToDisplayedEntities(
  entries: {
    level: string;
    entity_id: string;
    application_id: string | null;
    application_component_id: string | null;
    counts: Record<string, number>;
  }[],
  displayLevels: SecurityAssociationLevel[],
  displayedEntityIds: Set<string>,
): Map<string, Record<string, number>> {
  const levels = normalizeDisplayLevels(displayLevels);
  const out = new Map<string, Record<string, number>>();
  for (const entry of entries) {
    const byLevel: Record<SecurityAssociationLevel, string | null> = {
      application: entry.application_id,
      application_component: entry.application_component_id,
      service: entry.level === 'service' ? entry.entity_id : null,
    };
    if (entry.level === 'application') byLevel.application = entry.entity_id;
    if (entry.level === 'application_component') byLevel.application_component = entry.entity_id;
    let target: string | null = null;
    for (let i = levels.length - 1; i >= 0; i--) {
      const candidate = byLevel[levels[i]];
      if (candidate && displayedEntityIds.has(candidate)) {
        target = candidate;
        break;
      }
    }
    if (!target) continue;
    const bucket = out.get(target) ?? {};
    for (const [severity, count] of Object.entries(entry.counts)) {
      bucket[severity] = (bucket[severity] ?? 0) + count;
    }
    out.set(target, bucket);
  }
  return out;
}
