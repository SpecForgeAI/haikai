/**
 * Security Summary diagram generation (Security health dashboard, 2026-07-19,
 * Spec 3 of 3).
 *
 * Derives the persisted "Security Summary" diagram from the architecture
 * model: one box per application (grid auto-layout) plus data-movement edges
 * rolled UP to application level through application points (movements whose
 * endpoints resolve to components/services attribute to the parent
 * application; one edge per distinct directed application pair; self-loops
 * dropped).
 *
 * The result is a REAL diagram (nodes reference APPLICATION entities by id,
 * edges carry relationship_type DATA_MOVEMENT), persisted via the normal
 * model save, so it opens in the Diagrams area with move/resize editing.
 * Severity circles are NEVER part of the diagram content -- the Security
 * Overview computes them at render time from the latest findings report.
 *
 * Regeneration preserves the user's layout: boxes whose application still
 * exists keep their position/size; newly appeared applications get grid slots
 * appended; boxes whose application vanished are removed.
 */

import type { Application, Diagram, DiagramEdge, DiagramNode, MetaModel } from '../types/model';
import { generatePrefixedId } from './idGenerator';

export const SECURITY_SUMMARY_DIAGRAM_TYPE = 'SECURITY_SUMMARY';
export const SECURITY_SUMMARY_DIAGRAM_NAME = 'Security Summary';

const NODE_WIDTH = 220;
const NODE_HEIGHT = 110;
const GRID_GAP_X = 80;
const GRID_GAP_Y = 70;
const GRID_ORIGIN_X = 60;
const GRID_ORIGIN_Y = 60;

/**
 * Resolve an application point to its owning application id, walking
 * component/service endpoints up to the parent application. Null when the
 * point cannot be resolved (dangling reference).
 */
export function resolveApplicationPointToApplication(
  metaModel: MetaModel,
  applicationPointId: string,
): string | null {
  const point = metaModel.entities.application_points.find(
    (ap) => ap.id === applicationPointId,
  );
  if (!point) return null;
  if (point.application_id && point.application_id.length > 0) {
    return point.application_id;
  }
  if (point.application_component_id) {
    const component = metaModel.entities.app_components.find(
      (c) => c.id === point.application_component_id,
    );
    if (component?.application_id) return component.application_id;
  }
  if (point.service_id) {
    const service = metaModel.entities.services.find((s) => s.id === point.service_id);
    if (service?.application_id) return service.application_id;
    if (service?.app_component_id) {
      const component = metaModel.entities.app_components.find(
        (c) => c.id === service.app_component_id,
      );
      if (component?.application_id) return component.application_id;
    }
  }
  return null;
}

/**
 * Roll every data movement up to a directed (sourceApplicationId,
 * targetApplicationId) pair. Distinct pairs only; self-loops and unresolvable
 * endpoints dropped.
 */
export function rollUpDataMovementsToApplicationPairs(
  metaModel: MetaModel,
): { sourceApplicationId: string; targetApplicationId: string }[] {
  const seen = new Set<string>();
  const pairs: { sourceApplicationId: string; targetApplicationId: string }[] = [];
  for (const movement of metaModel.relationships.data_movements) {
    const source = resolveApplicationPointToApplication(
      metaModel,
      movement.source_application_point_id,
    );
    const target = resolveApplicationPointToApplication(
      metaModel,
      movement.target_application_point_id,
    );
    if (!source || !target || source === target) continue;
    const key = `${source}->${target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push({ sourceApplicationId: source, targetApplicationId: target });
  }
  return pairs;
}

/**
 * Generate (or REgenerate) the Security Summary diagram from the model.
 *
 * @param metaModel the loaded architecture meta-model
 * @param existing  the current Security Summary diagram, when regenerating --
 *                  surviving applications keep their node position/size
 * @returns a complete Diagram ready for ADD_DIAGRAM / UPDATE_DIAGRAM + save
 */
export function generateSecuritySummaryDiagram(
  metaModel: MetaModel,
  existing?: Diagram | null,
): Diagram {
  const applications: Application[] = [...metaModel.entities.applications].sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  const existingNodeByEntity = new Map<string, DiagramNode>();
  if (existing) {
    for (const node of existing.diagram_nodes) {
      if (node.entity_type === 'APPLICATION') {
        existingNodeByEntity.set(node.entity_id, node);
      }
    }
  }

  const columns = Math.max(1, Math.ceil(Math.sqrt(applications.length)));
  const nodes: DiagramNode[] = [];
  const nodeIdByApplication = new Map<string, string>();
  let gridSlot = 0;
  for (const app of applications) {
    const preserved = existingNodeByEntity.get(app.id);
    if (preserved) {
      // Surviving application: the user's layout wins verbatim.
      nodes.push({ ...preserved });
      nodeIdByApplication.set(app.id, preserved.id);
      continue;
    }
    const column = gridSlot % columns;
    const row = Math.floor(gridSlot / columns);
    gridSlot++;
    const node: DiagramNode = {
      id: generatePrefixedId('node'),
      entity_type: 'APPLICATION',
      entity_id: app.id,
      pos_x: GRID_ORIGIN_X + column * (NODE_WIDTH + GRID_GAP_X),
      pos_y: GRID_ORIGIN_Y + row * (NODE_HEIGHT + GRID_GAP_Y),
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      parent_node_id: null,
    };
    nodes.push(node);
    nodeIdByApplication.set(app.id, node.id);
  }

  // Push new-node rows below the preserved layout so regeneration never
  // stacks fresh boxes onto user-arranged ones.
  if (existingNodeByEntity.size > 0 && gridSlot > 0) {
    const preservedBottom = Math.max(
      0,
      ...Array.from(existingNodeByEntity.values()).map((n) => n.pos_y + n.height),
    );
    const offset = preservedBottom + GRID_GAP_Y - GRID_ORIGIN_Y;
    for (const node of nodes) {
      if (!existingNodeByEntity.has(node.entity_id)) {
        node.pos_y += offset;
      }
    }
  }

  const edges: DiagramEdge[] = [];
  const existingEdgeByPair = new Map<string, DiagramEdge>();
  if (existing) {
    for (const edge of existing.diagram_edges) {
      existingEdgeByPair.set(`${edge.source_node_id}->${edge.target_node_id}`, edge);
    }
  }
  for (const pair of rollUpDataMovementsToApplicationPairs(metaModel)) {
    const sourceNodeId = nodeIdByApplication.get(pair.sourceApplicationId);
    const targetNodeId = nodeIdByApplication.get(pair.targetApplicationId);
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

  return {
    id: existing?.id ?? generatePrefixedId('diag'),
    name: existing?.name ?? SECURITY_SUMMARY_DIAGRAM_NAME,
    description:
      existing?.description ??
      'Generated department security summary: applications + data movements. ' +
        'Severity overlays are computed live on the Security Overview screen.',
    diagram_type: SECURITY_SUMMARY_DIAGRAM_TYPE,
    settings: existing?.settings ?? {},
    diagram_nodes: nodes,
    diagram_edges: edges,
  } as Diagram;
}
