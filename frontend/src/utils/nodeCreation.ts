import { DiagramNode, MetaModel, ENTITY_TYPES } from '../types/model';
import { DiagramType } from '../types/diagramType';
import { generatePrefixedId } from './idGenerator';
import {
  getAttributesForEntity,
  calculateERDNodeSize,
} from './erdUtils';

/**
 * Default node dimensions used when creating new nodes
 */
export const DEFAULT_NODE_WIDTH = 120;
export const DEFAULT_NODE_HEIGHT = 60;

/**
 * Spec 2026-05-05: Infrastructure Domain Diagram Support
 *
 * The 6 container-like Infrastructure entity types spawn at 320x200 instead of
 * the default 120x60 so they can visually accommodate nested children via the
 * existing parent_node_id chain (Environment > CloudAccount > Location > Network
 * > Subnet > ComputeCluster > resources). The remaining 6 Infra entity types
 * (COMPUTE_RESOURCE, DEPLOYMENT_UNIT, LOAD_BALANCER, LISTENER, DATA_STORE_INSTANCE,
 * INFRASTRUCTURE_RESOURCE) keep the standard 120x60 default.
 *
 * Implementer chose the inline-override path (path 2.8b in tasks.md) since
 * defaults.ts has no defaultNodeDimensions config table to extend.
 */
export const INFRASTRUCTURE_CONTAINER_NODE_WIDTH = 320;
export const INFRASTRUCTURE_CONTAINER_NODE_HEIGHT = 200;

const INFRASTRUCTURE_CONTAINER_TYPES: ReadonlySet<string> = new Set([
  'ENVIRONMENT',
  'CLOUD_ACCOUNT',
  'LOCATION',
  'NETWORK',
  'SUBNET',
  'COMPUTE_CLUSTER',
]);

/**
 * Fixed spawn position for all generic add flows.
 * All new nodes spawn at this position (100,100) regardless of viewport.
 * This provides deterministic, predictable node placement.
 */
export const DEFAULT_NODE_SPAWN_ORIGIN = { x: 100, y: 100 };

/**
 * Check if a node already exists in the diagram for the given entity
 */
export function nodeExistsForEntity(
  nodes: DiagramNode[],
  entity_type: string,
  entity_id: string
): boolean {
  return nodes.some(
    (node) => node.entity_type === entity_type && node.entity_id === entity_id
  );
}

/**
 * Calculate placement position for a new node.
 * Returns the fixed spawn position (100,100) for all cases.
 *
 * Note: The existingNodes parameter is kept for backward compatibility
 * but is no longer used for position calculation.
 */
export function calculateNodePlacement(
  _existingNodes: DiagramNode[]
): { pos_x: number; pos_y: number } {
  // Fixed spawn position at (100,100)
  return {
    pos_x: DEFAULT_NODE_SPAWN_ORIGIN.x,
    pos_y: DEFAULT_NODE_SPAWN_ORIGIN.y,
  };
}

/**
 * Calculate z-index for new node (above all existing nodes)
 */
export function calculateZIndex(existingNodes: DiagramNode[]): number {
  if (existingNodes.length === 0) {
    return 1;
  }

  const maxZIndex = Math.max(
    ...existingNodes.map((node) => node.z_index || 0)
  );

  // Cap at reasonable max
  return Math.min(maxZIndex + 1, 9999);
}

/**
 * ViewportCenter type for node positioning
 * Note: This parameter is kept for API compatibility but is ignored.
 * All nodes now spawn at the fixed position DEFAULT_NODE_SPAWN_ORIGIN (100,100).
 */
export interface ViewportCenter {
  x: number;
  y: number;
}

/**
 * Create a complete DiagramNode from an entity.
 *
 * All nodes are positioned at the fixed spawn origin (100,100) regardless of
 * the viewportCenter parameter. The viewportCenter parameter is kept for
 * backward API compatibility but its value is ignored.
 *
 * Spec 2026-01-02 Task Group 2: STATE nodes get default label alignment:
 * - text_h_align: 'CENTER'
 * - text_v_align: 'MIDDLE'
 *
 * Task Group 7: UI_SCREEN nodes get default label alignment:
 * - text_h_align: 'CENTER'
 * - text_v_align: 'MIDDLE'
 *
 * @param entity_type - The type of entity (e.g., 'APPLICATION', 'BUSINESS_PROCESS')
 * @param entity_id - The ID of the entity
 * @param existingNodes - Array of existing nodes in the diagram (for z-index calculation)
 * @param viewportCenter - Optional viewport center point (ignored - kept for API compatibility)
 * @returns A complete DiagramNode ready to be added to the diagram
 *
 * @example
 * // Node always spawns at (100, 100) regardless of viewportCenter
 * const node = createDiagramNodeFromEntity('APPLICATION', 'app-1', nodes, { x: 500, y: 400 });
 * // node.pos_x === 100, node.pos_y === 100
 */
export function createDiagramNodeFromEntity(
  entity_type: string,
  entity_id: string,
  existingNodes: DiagramNode[],
  _viewportCenter?: ViewportCenter
): DiagramNode {
  const nodeId = generatePrefixedId('node');
  const zIndex = calculateZIndex(existingNodes);

  // Default dimensions
  // Spec 2026-05-05: Infrastructure Domain Diagram Support - 6 container-like types
  // (ENVIRONMENT, CLOUD_ACCOUNT, LOCATION, NETWORK, SUBNET, COMPUTE_CLUSTER) spawn at 320x200
  // so they can host nested children via parent_node_id chains.
  const isInfrastructureContainer = INFRASTRUCTURE_CONTAINER_TYPES.has(entity_type);
  const width = isInfrastructureContainer ? INFRASTRUCTURE_CONTAINER_NODE_WIDTH : DEFAULT_NODE_WIDTH;
  const height = isInfrastructureContainer ? INFRASTRUCTURE_CONTAINER_NODE_HEIGHT : DEFAULT_NODE_HEIGHT;

  // Fixed spawn position at (100,100)
  const pos_x = DEFAULT_NODE_SPAWN_ORIGIN.x;
  const pos_y = DEFAULT_NODE_SPAWN_ORIGIN.y;

  // Base node properties
  const baseNode: DiagramNode = {
    id: nodeId,
    entity_type,
    entity_id,
    pos_x,
    pos_y,
    width,
    height,
    auto_size: false,
    z_index: zIndex,
    parent_node_id: null,
    style_override: {},
  };

  // Spec 2026-01-02 Task Group 2: STATE nodes get default label alignment
  // This ensures Normal state labels are centered by default
  if (entity_type === ENTITY_TYPES.STATE) {
    return {
      ...baseNode,
      text_h_align: 'CENTER',
      text_v_align: 'MIDDLE',
    };
  }

  // Task Group 7: UI_SCREEN nodes get default label alignment
  // This ensures UI Screen labels are centered by default
  if (entity_type === ENTITY_TYPES.UI_SCREEN) {
    return {
      ...baseNode,
      text_h_align: 'CENTER',
      text_v_align: 'MIDDLE',
    };
  }

  return baseNode;
}

// ============================================================================
// ERD Node Creation Utilities
// ============================================================================

/**
 * Check if a node should be created with ERD-style rendering.
 *
 * ERD-style nodes are created when:
 * 1. The diagram type is 'ER'
 * 2. The entity type is LOGICAL_DATA_ENTITY or PHYSICAL_DATA_ENTITY
 *
 * @param entityType - The type of entity being created
 * @param diagramType - The type of diagram the node is being added to
 * @returns True if the node should be created with render_style: 'erd'
 */
export function shouldCreateERDNode(
  entityType: string,
  diagramType: DiagramType | string
): boolean {
  // Only ER diagrams get ERD-style nodes
  if (diagramType !== 'ER') {
    return false;
  }

  // Only LOGICAL_DATA_ENTITY and PHYSICAL_DATA_ENTITY support ERD rendering
  return (
    entityType === ENTITY_TYPES.LOGICAL_DATA_ENTITY ||
    entityType === ENTITY_TYPES.PHYSICAL_DATA_ENTITY
  );
}

/**
 * Get the entity name from the meta-model for ERD node sizing.
 *
 * @param metaModel - The meta-model containing entity data
 * @param entityType - The type of entity
 * @param entityId - The ID of the entity
 * @returns The entity name, or 'Entity' if not found
 */
function getEntityNameForERD(
  metaModel: MetaModel,
  entityType: string,
  entityId: string
): string {
  if (entityType === ENTITY_TYPES.LOGICAL_DATA_ENTITY) {
    const entity = metaModel.entities.logical_data_entities.find(
      e => e.id === entityId
    );
    return entity?.name || 'Entity';
  }

  if (entityType === ENTITY_TYPES.PHYSICAL_DATA_ENTITY) {
    const entity = metaModel.entities.physical_data_entities.find(
      e => e.id === entityId
    );
    return entity?.name || 'Entity';
  }

  return 'Entity';
}

/**
 * Create an ERD-style DiagramNode from an entity.
 *
 * ERD-style nodes have:
 * - render_style: 'erd'
 * - embedded_attribute_ids: Array of attribute IDs to display
 * - Calculated dimensions based on entity name and attribute count
 *
 * All nodes are positioned at the fixed spawn origin (100,100) regardless of
 * the viewportCenter parameter. The viewportCenter parameter is kept for
 * backward API compatibility but its value is ignored.
 *
 * This function should be used when:
 * - The diagram type is 'ER'
 * - The entity type is LOGICAL_DATA_ENTITY or PHYSICAL_DATA_ENTITY
 *
 * Use shouldCreateERDNode() to check if this function should be called.
 *
 * @param entityType - The type of entity (LOGICAL_DATA_ENTITY or PHYSICAL_DATA_ENTITY)
 * @param entityId - The ID of the entity
 * @param existingNodes - Array of existing nodes in the diagram (for z-index calculation)
 * @param metaModel - The meta-model containing entity and attribute data
 * @param viewportCenter - Optional viewport center point (ignored - kept for API compatibility)
 * @returns A complete ERD-style DiagramNode, or null if entity not found
 *
 * @example
 * // Node always spawns at (100, 100) regardless of viewportCenter
 * const node = createERDNodeFromEntity(
 *   ENTITY_TYPES.LOGICAL_DATA_ENTITY,
 *   'lde-1',
 *   diagram.diagram_nodes,
 *   metaModel,
 *   { x: 500, y: 400 }
 * );
 * // node.pos_x === 100, node.pos_y === 100
 */
export function createERDNodeFromEntity(
  entityType: string,
  entityId: string,
  existingNodes: DiagramNode[],
  metaModel: MetaModel,
  _viewportCenter?: ViewportCenter
): DiagramNode | null {
  // Get entity name for sizing calculation
  const entityName = getEntityNameForERD(metaModel, entityType, entityId);

  // Get attributes for this entity
  const attributes = getAttributesForEntity(metaModel, entityId, entityType);
  const attributeIds = attributes.map(attr => attr.id);

  // Calculate node dimensions based on content
  const { width, height } = calculateERDNodeSize(entityName, attributes);

  // Generate node ID and calculate z-index
  const nodeId = generatePrefixedId('node');
  const zIndex = calculateZIndex(existingNodes);

  // Fixed spawn position at (100,100)
  const pos_x = DEFAULT_NODE_SPAWN_ORIGIN.x;
  const pos_y = DEFAULT_NODE_SPAWN_ORIGIN.y;

  return {
    id: nodeId,
    entity_type: entityType,
    entity_id: entityId,
    pos_x,
    pos_y,
    width,
    height,
    auto_size: false,
    z_index: zIndex,
    parent_node_id: null,
    style_override: {},
    // ERD-specific fields
    render_style: 'erd',
    embedded_attribute_ids: attributeIds,
  };
}
