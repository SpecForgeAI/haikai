/**
 * Interface Composite Builder Utility
 *
 * Task Group 1: Shared helper for creating Interface nodes with embedded endpoints
 * and child entity nodes.
 *
 * This module provides the buildInterfaceCompositeNodes function that creates
 * a complete Interface composite structure including:
 * - Interface node with render_style: 'contract'
 * - embedded_endpoint_ids for endpoint rows
 * - embedded_entity_ids for entity boxes
 * - Child ERD-style entity nodes positioned inside the Interface
 *
 * This helper is used by both:
 * - "Add with all children" context menu action
 * - Advanced Add dialog for Interface custom layout candidates
 *
 * Spec: Fix Advanced Add Interface Schema Entities (Task Groups 2.3, 2.4)
 * - Renamed getLogicalEntityIdsForInterface to getDataEntityIdsForInterface
 * - Updated to use resolveDataEntitiesForInterface() shared utility
 * - Updated buildInterfaceCompositeNodes to handle both logical and physical entity types
 */

import { DiagramNode, MetaModel, ENTITY_TYPES } from '../types/model';
import { generatePrefixedId } from './idGenerator';
import { getAttributesForEntity, calculateERDNodeSize } from './erdUtils';
import {
  calculateInterfaceWithEntitiesHeight,
  calculateInterfaceWithEntitiesWidth,
  INTERFACE_HEADER_HEIGHT,
  INTERFACE_ENTITIES_SECTION_GAP,
  INTERFACE_ENTITY_GAP,
  INTERFACE_PADDING_X,
  INTERFACE_PADDING_Y,
  ENDPOINT_LINE_HEIGHT,
  ENDPOINT_SECTION_PADDING,
} from './interfaceCustomRenderer';
import { resolveDataEntitiesForInterface, ResolvedDataEntitiesForInterface } from './dataEntityPointOptions';

// ============================================================================
// Types
// ============================================================================

/**
 * Result of building an Interface composite structure.
 * Contains the Interface node and its child entity nodes.
 */
export interface InterfaceCompositeResult {
  /** The Interface diagram node with render_style: 'contract' */
  interfaceNode: DiagramNode;
  /** Child entity nodes (ERD-style) positioned inside the Interface */
  entityNodes: DiagramNode[];
}

/**
 * Configuration for Interface composite building.
 * Contains position, z-index, and parent parameters.
 */
export interface InterfaceCompositeConfig {
  /** Base X,Y position for the Interface (typically viewport center) */
  basePosition: { x: number; y: number };
  /** Base z-index for the Interface (children will have higher z-index) */
  baseZIndex: number;
  /** Parent node ID if Interface is inside another container (e.g., Service) */
  parentNodeId: string | null;
}

/**
 * Grouped data entity IDs for Interface schema.
 * Spec: Fix Advanced Add Interface Schema Entities (Task Group 2.3)
 */
export interface DataEntityIdsForInterface {
  /** IDs of logical data entities linked to the interface */
  logicalEntityIds: string[];
  /** IDs of physical data entities linked to the interface */
  physicalEntityIds: string[];
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get data entity IDs for an interface via the interface_logical_entities relationship.
 *
 * Spec: Fix Advanced Add Interface Schema Entities (Task Group 2.3)
 * - Renamed from getLogicalEntityIdsForInterface to getDataEntityIdsForInterface
 * - Now uses resolveDataEntitiesForInterface() shared utility
 * - Returns grouped IDs for both logical and physical entity types
 *
 * @param interfaceId - The ID of the interface
 * @param metaModel - The meta-model containing relationships
 * @returns Object with logicalEntityIds and physicalEntityIds arrays
 */
export function getDataEntityIdsForInterface(
  interfaceId: string,
  metaModel: MetaModel
): DataEntityIdsForInterface {
  // Use shared utility from dataEntityPointOptions.ts
  return resolveDataEntitiesForInterface(metaModel, interfaceId);
}

/**
 * @deprecated Use getDataEntityIdsForInterface instead.
 * This function is kept for backwards compatibility but delegates to the new implementation.
 *
 * Get logical entity IDs for an interface via the interface_logical_entities relationship.
 * Note: This only returns logical entity IDs. Use getDataEntityIdsForInterface() to get both types.
 *
 * @param interfaceId - The ID of the interface
 * @param metaModel - The meta-model containing relationships
 * @returns Array of logical entity IDs linked to the interface
 */
export function getLogicalEntityIdsForInterface(
  interfaceId: string,
  metaModel: MetaModel
): string[] {
  const result = getDataEntityIdsForInterface(interfaceId, metaModel);
  return result.logicalEntityIds;
}

/**
 * Calculate vertical stacking positions for entity boxes inside an Interface.
 *
 * Accounts for:
 * - Header height
 * - Endpoint section height
 * - Padding and gaps
 *
 * @param entityHeights - Array of heights for each entity box
 * @param interfaceBounds - Bounds of the Interface node
 * @param headerHeight - Height of the Interface header section
 * @param endpointSectionHeight - Height of the endpoints section
 * @returns Array of { x, y } positions for each entity
 */
export function calculateEntityPositionsInInterface(
  entityHeights: number[],
  interfaceBounds: { x: number; y: number; width: number; height: number },
  headerHeight: number,
  endpointSectionHeight: number
): Array<{ x: number; y: number }> {
  const positions: Array<{ x: number; y: number }> = [];

  if (entityHeights.length === 0) {
    return positions;
  }

  // Starting Y position for first entity (inside Interface)
  let currentY = interfaceBounds.y +
    INTERFACE_PADDING_Y +
    headerHeight +
    endpointSectionHeight +
    INTERFACE_ENTITIES_SECTION_GAP;

  for (let i = 0; i < entityHeights.length; i++) {
    // Position entity left-aligned with padding offset
    // The actual centering will happen when we know the entity width
    const entityX = interfaceBounds.x + INTERFACE_PADDING_X;

    positions.push({ x: entityX, y: currentY });

    // Move Y position down for next entity
    currentY += entityHeights[i] + INTERFACE_ENTITY_GAP;
  }

  return positions;
}

// ============================================================================
// Main Builder Function
// ============================================================================

/**
 * Build Interface composite nodes including the Interface and its child entity nodes.
 *
 * This function creates:
 * 1. An Interface node with render_style: 'contract', embedded_endpoint_ids, and embedded_entity_ids
 * 2. Child ERD-style entity nodes positioned inside the Interface with parent_node_id set
 *
 * Spec: Fix Advanced Add Interface Schema Entities (Task Group 2.4)
 * - Updated to accept DataEntityIdsForInterface object with both logical and physical IDs
 * - Creates child nodes for both entity types with appropriate styling
 *
 * @param interfaceId - ID of the interface entity
 * @param selectedEndpointIds - IDs of endpoints to embed in the Interface
 * @param selectedDataEntityIds - Object with logicalEntityIds and physicalEntityIds arrays
 * @param selectedAttributeIdsByEntity - Map of entity ID to selected attribute IDs (empty = all attributes)
 * @param metaModel - The meta-model for entity lookups
 * @param basePosition - X,Y position for the Interface (will be centered)
 * @param baseZIndex - Base z-index (Interface gets this, children get higher)
 * @param parentNodeId - Parent node ID if Interface is inside a container
 * @returns InterfaceCompositeResult with interfaceNode and entityNodes
 */
export function buildInterfaceCompositeNodes(
  interfaceId: string,
  selectedEndpointIds: string[],
  selectedDataEntityIds: DataEntityIdsForInterface,
  selectedAttributeIdsByEntity: Map<string, string[]>,
  metaModel: MetaModel,
  basePosition: { x: number; y: number },
  baseZIndex: number,
  parentNodeId: string | null
): InterfaceCompositeResult {
  // Get the interface entity from the meta-model
  const interfaceEntity = metaModel.entities.interfaces.find(i => i.id === interfaceId);
  const interfaceName = interfaceEntity?.name || 'Interface';

  // Get endpoints for this interface (for dimension calculation)
  const endpoints = metaModel.entities.endpoints.filter(
    ep => selectedEndpointIds.includes(ep.id)
  );

  // Calculate entity box sizes first (to determine Interface dimensions)
  // Now handles both logical and physical entity types
  const entityBoxes: Array<{
    id: string;
    width: number;
    height: number;
    name: string;
    attributeIds: string[];
    entityType: string;
  }> = [];

  // Process logical data entities
  for (const logicalEntityId of selectedDataEntityIds.logicalEntityIds) {
    const logicalEntity = metaModel.entities.logical_data_entities.find(
      e => e.id === logicalEntityId
    );
    if (!logicalEntity) continue;

    // Determine which attributes to include
    let attributeIds: string[];
    if (selectedAttributeIdsByEntity.has(logicalEntityId)) {
      // Use specifically selected attributes
      attributeIds = selectedAttributeIdsByEntity.get(logicalEntityId) || [];
    } else {
      // Use all attributes for this entity
      const allAttributes = getAttributesForEntity(metaModel, logicalEntityId, ENTITY_TYPES.LOGICAL_DATA_ENTITY);
      attributeIds = allAttributes.map(a => a.id);
    }

    // Get attribute data for dimension calculation
    const attributes = getAttributesForEntity(metaModel, logicalEntityId, ENTITY_TYPES.LOGICAL_DATA_ENTITY)
      .filter(a => attributeIds.includes(a.id));

    // Calculate ERD node size
    const { width: entityWidth, height: entityHeight } = calculateERDNodeSize(logicalEntity.name, attributes);

    entityBoxes.push({
      id: logicalEntityId,
      width: entityWidth,
      height: entityHeight,
      name: logicalEntity.name,
      attributeIds,
      entityType: ENTITY_TYPES.LOGICAL_DATA_ENTITY,
    });
  }

  // Process physical data entities
  for (const physicalEntityId of selectedDataEntityIds.physicalEntityIds) {
    const physicalEntity = metaModel.entities.physical_data_entities.find(
      e => e.id === physicalEntityId
    );
    if (!physicalEntity) continue;

    // Determine which attributes to include
    let attributeIds: string[];
    if (selectedAttributeIdsByEntity.has(physicalEntityId)) {
      // Use specifically selected attributes
      attributeIds = selectedAttributeIdsByEntity.get(physicalEntityId) || [];
    } else {
      // Use all attributes for this entity
      const allAttributes = getAttributesForEntity(metaModel, physicalEntityId, ENTITY_TYPES.PHYSICAL_DATA_ENTITY);
      attributeIds = allAttributes.map(a => a.id);
    }

    // Get attribute data for dimension calculation
    const attributes = getAttributesForEntity(metaModel, physicalEntityId, ENTITY_TYPES.PHYSICAL_DATA_ENTITY)
      .filter(a => attributeIds.includes(a.id));

    // Calculate ERD node size
    const { width: entityWidth, height: entityHeight } = calculateERDNodeSize(physicalEntity.name, attributes);

    entityBoxes.push({
      id: physicalEntityId,
      width: entityWidth,
      height: entityHeight,
      name: physicalEntity.name,
      attributeIds,
      entityType: ENTITY_TYPES.PHYSICAL_DATA_ENTITY,
    });
  }

  // Calculate Interface dimensions to wrap all content
  const headerHeight = INTERFACE_HEADER_HEIGHT;
  const entityHeights = entityBoxes.map(e => e.height);
  const entityWidths = entityBoxes.map(e => e.width);

  // Calculate header width (estimate based on interface name)
  const headerWidth = Math.max(100, interfaceName.length * 8);

  // Calculate endpoint line widths (rough estimate)
  const endpointLineWidths = endpoints.map(ep => {
    const lineText = `${ep.operation_verb || ''} ${ep.path_or_address || ''} - ${ep.name}`;
    return lineText.length * 6;
  });

  // Calculate Interface total height and width
  const interfaceHeight = calculateInterfaceWithEntitiesHeight(
    headerHeight,
    endpoints.length,
    entityHeights,
    INTERFACE_PADDING_Y
  );

  const interfaceWidth = Math.max(
    300, // Minimum width
    calculateInterfaceWithEntitiesWidth(
      headerWidth,
      endpointLineWidths,
      entityWidths,
      INTERFACE_PADDING_X
    )
  );

  // Collect all entity IDs for embedded_entity_ids
  const allEmbeddedEntityIds = [
    ...selectedDataEntityIds.logicalEntityIds,
    ...selectedDataEntityIds.physicalEntityIds,
  ];

  // Create Interface node with custom rendering
  const interfaceNodeId = generatePrefixedId('node');
  const interfaceNode: DiagramNode = {
    id: interfaceNodeId,
    entity_type: ENTITY_TYPES.INTERFACE,
    entity_id: interfaceId,
    pos_x: basePosition.x - interfaceWidth / 2,
    pos_y: basePosition.y - interfaceHeight / 2,
    width: interfaceWidth,
    height: interfaceHeight,
    auto_size: false,
    z_index: baseZIndex,
    parent_node_id: parentNodeId,
    style_override: {},
    render_style: 'contract',
    embedded_endpoint_ids: selectedEndpointIds,
    embedded_entity_ids: allEmbeddedEntityIds,
  };

  // Calculate endpoint section height
  const endpointSectionHeight = endpoints.length > 0
    ? (endpoints.length * ENDPOINT_LINE_HEIGHT) + (2 * ENDPOINT_SECTION_PADDING)
    : 0;

  // Calculate entities area width (inside the Interface, excluding padding)
  const entitiesAreaWidth = interfaceWidth - 2 * INTERFACE_PADDING_X;

  // Starting Y position for first entity (inside Interface)
  let currentEntityY = interfaceNode.pos_y +
    INTERFACE_PADDING_Y +
    headerHeight +
    endpointSectionHeight +
    (entityBoxes.length > 0 ? INTERFACE_ENTITIES_SECTION_GAP : 0);

  // Create child ERD nodes for all entities - positioned INSIDE the Interface
  const entityNodes: DiagramNode[] = [];

  for (let childIndex = 0; childIndex < entityBoxes.length; childIndex++) {
    const entityBox = entityBoxes[childIndex];

    // Center entity horizontally within the entities area
    const childPosX = interfaceNode.pos_x + INTERFACE_PADDING_X +
      (entitiesAreaWidth - entityBox.width) / 2;

    const entityNode: DiagramNode = {
      id: generatePrefixedId('node'),
      entity_type: entityBox.entityType,
      entity_id: entityBox.id,
      pos_x: childPosX,
      pos_y: currentEntityY,
      width: entityBox.width,
      height: entityBox.height,
      auto_size: false,
      z_index: baseZIndex + childIndex + 1,
      parent_node_id: interfaceNodeId,
      style_override: {},
      render_style: 'erd',
      embedded_attribute_ids: entityBox.attributeIds,
    };

    entityNodes.push(entityNode);

    // Move Y position down for next entity
    currentEntityY += entityBox.height + INTERFACE_ENTITY_GAP;
  }

  return {
    interfaceNode,
    entityNodes,
  };
}
