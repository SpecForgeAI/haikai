/**
 * Interface Custom Renderer Utilities
 *
 * Task Group 3: Interface Custom Renderer Layer
 *
 * This module provides utilities for rendering Interface nodes with
 * embedded Endpoint information displayed as text lines inside the node.
 *
 * Endpoint Line Format:
 * "<index>. <operation_verb> <path_or_address> - <endpoint_name>"
 *
 * Examples:
 * - "1. GET /customers/{id} - Get customer by id"
 * - "2. POST /orders - Create order"
 * - "3. customers.events.v1 - Customer Message" (no verb)
 */

import { Endpoint, MetaModel, DiagramNode, ENTITY_TYPES } from '../types/model';

// =============================================================================
// Constants for Endpoint Section Rendering
// =============================================================================

/** Height of a single endpoint line in pixels */
export const ENDPOINT_LINE_HEIGHT = 16;

/** Vertical padding above and below the endpoint section */
export const ENDPOINT_SECTION_PADDING = 4;

/** Font size for endpoint lines */
export const ENDPOINT_FONT_SIZE = 11;

/** Left padding for endpoint text */
export const ENDPOINT_TEXT_PADDING = 5;

// =============================================================================
// Constants for Interface with Entities Rendering (Task Group 1)
// =============================================================================

/** Height of the Interface header section in pixels */
export const INTERFACE_HEADER_HEIGHT = 24;

/** Gap between endpoints section and entities section */
export const INTERFACE_ENTITIES_SECTION_GAP = 8;

/** Vertical gap between entity boxes */
export const INTERFACE_ENTITY_GAP = 10;

/** Horizontal padding inside Interface for entity boxes */
export const INTERFACE_PADDING_X = 10;

/** Vertical padding at top and bottom of Interface */
export const INTERFACE_PADDING_Y = 10;

// =============================================================================
// Core Formatting Functions
// =============================================================================

/**
 * Format an endpoint as a single display line.
 *
 * Format: "<index>. <operation_verb> <path_or_address> - <name>"
 *
 * Examples:
 * - "1. GET /customers/{id} - Get customer by id"
 * - "2. POST /orders - Create order"
 * - "3. customers.events.v1 - Customer Message" (when no verb)
 * - "4. PUT - Legacy Transfer" (when no path)
 * - "5. Unknown Endpoint" (when no verb and no path)
 *
 * @param endpoint - The endpoint entity to format
 * @param index - The 1-based index for display numbering
 * @returns Formatted endpoint line string
 */
export function formatEndpointLine(endpoint: Endpoint, index: number): string {
  const parts: string[] = [];

  // Start with index
  parts.push(`${index}.`);

  // Add verb if present
  if (endpoint.operation_verb && endpoint.operation_verb.trim() !== '') {
    parts.push(endpoint.operation_verb);
  }

  // Add path if present
  if (endpoint.path_or_address && endpoint.path_or_address.trim() !== '') {
    parts.push(endpoint.path_or_address);
  }

  // If we have any verb or path, add separator and name
  // Otherwise, just add the name
  if (parts.length > 1) {
    // We have more than just the index
    return `${parts.join(' ')} - ${endpoint.name}`;
  } else {
    // Only index, add name directly
    return `${parts[0]} ${endpoint.name}`;
  }
}

/**
 * Get formatted endpoint lines for an Interface entity.
 *
 * Retrieves all endpoints that belong to the specified interface
 * and formats them as display lines.
 *
 * @param interfaceId - The ID of the interface entity
 * @param metaModel - The MetaModel containing endpoints
 * @returns Array of formatted endpoint line strings
 */
export function getEndpointLinesForInterface(
  interfaceId: string,
  metaModel: MetaModel
): string[] {
  const endpoints = metaModel.entities.endpoints || [];

  // Filter endpoints belonging to this interface
  const interfaceEndpoints = endpoints.filter(
    (ep: Endpoint) => ep.interface_id === interfaceId
  );

  // Format each endpoint with 1-based index
  return interfaceEndpoints.map((ep, idx) => formatEndpointLine(ep, idx + 1));
}

/**
 * Get formatted endpoint lines for specific endpoint IDs.
 *
 * Used when a DiagramNode specifies embedded_endpoint_ids to display
 * only selected endpoints rather than all endpoints of the interface.
 *
 * @param endpointIds - Array of endpoint IDs to include
 * @param metaModel - The MetaModel containing endpoints
 * @returns Array of formatted endpoint line strings
 */
export function getEndpointLinesForIds(
  endpointIds: string[],
  metaModel: MetaModel
): string[] {
  const endpoints = metaModel.entities.endpoints || [];

  // Filter endpoints by ID and preserve order
  const selectedEndpoints = endpointIds
    .map(id => endpoints.find((ep: Endpoint) => ep.id === id))
    .filter((ep): ep is Endpoint => ep !== undefined);

  // Format each endpoint with 1-based index
  return selectedEndpoints.map((ep, idx) => formatEndpointLine(ep, idx + 1));
}

/**
 * Calculate the height needed for the endpoint section.
 *
 * The height is calculated as:
 * - (number of lines * line height) + (2 * padding)
 *
 * Returns 0 if there are no endpoint lines to display.
 *
 * @param endpointLines - Array of endpoint line strings
 * @returns Height in pixels
 */
export function calculateEndpointSectionHeight(endpointLines: string[]): number {
  if (endpointLines.length === 0) {
    return 0;
  }

  return (endpointLines.length * ENDPOINT_LINE_HEIGHT) + (2 * ENDPOINT_SECTION_PADDING);
}

/**
 * Calculate the total height for an Interface node with embedded endpoints.
 *
 * This includes:
 * - Header height (for interface name)
 * - Endpoint section height
 *
 * @param headerHeight - Height of the header/title section
 * @param endpointLines - Array of endpoint line strings
 * @returns Total height in pixels
 */
export function calculateInterfaceNodeHeight(
  headerHeight: number,
  endpointLines: string[]
): number {
  const endpointSectionHeight = calculateEndpointSectionHeight(endpointLines);
  return headerHeight + endpointSectionHeight;
}

// =============================================================================
// Size Calculation Functions for Interface with Entities (Task Group 1)
// =============================================================================

/**
 * Calculate the total height for an Interface node with embedded endpoints and entities.
 *
 * The height includes:
 * - Top padding
 * - Header height (for interface name)
 * - Endpoint section height (if endpoints exist)
 * - Entities section gap (if entities exist)
 * - Total entity boxes height with gaps
 * - Bottom padding
 *
 * @param headerHeight - Height of the header/title section
 * @param numEndpoints - Number of endpoint lines (or number of endpoints)
 * @param entityHeights - Array of heights for each entity box
 * @param paddingY - Vertical padding (top and bottom)
 * @returns Total height in pixels
 */
export function calculateInterfaceWithEntitiesHeight(
  headerHeight: number,
  numEndpoints: number,
  entityHeights: number[],
  paddingY: number = INTERFACE_PADDING_Y
): number {
  // Endpoint section height
  const endpointSectionHeight = numEndpoints > 0
    ? (numEndpoints * ENDPOINT_LINE_HEIGHT) + (2 * ENDPOINT_SECTION_PADDING)
    : 0;

  // Entities section height (with gaps between entities)
  let entitiesSectionHeight = 0;
  if (entityHeights.length > 0) {
    entitiesSectionHeight = INTERFACE_ENTITIES_SECTION_GAP +
      entityHeights.reduce((sum, h) => sum + h, 0) +
      (entityHeights.length - 1) * INTERFACE_ENTITY_GAP;
  }

  // Total height: padding + header + endpoints + entities + padding
  return paddingY + headerHeight + endpointSectionHeight + entitiesSectionHeight + paddingY;
}

/**
 * Calculate the width for an Interface node to accommodate all content.
 *
 * The width is determined by the maximum of:
 * - Header text width
 * - Maximum endpoint line width
 * - Maximum entity box width
 *
 * Plus horizontal padding on both sides.
 *
 * @param headerWidth - Width needed for the header text
 * @param endpointLineWidths - Array of widths for each endpoint line
 * @param entityWidths - Array of widths for each entity box
 * @param paddingX - Horizontal padding (left and right)
 * @returns Total width in pixels
 */
export function calculateInterfaceWithEntitiesWidth(
  headerWidth: number,
  endpointLineWidths: number[],
  entityWidths: number[],
  paddingX: number = INTERFACE_PADDING_X
): number {
  // Find maximum content width
  const maxEndpointWidth = endpointLineWidths.length > 0
    ? Math.max(...endpointLineWidths)
    : 0;

  const maxEntityWidth = entityWidths.length > 0
    ? Math.max(...entityWidths)
    : 0;

  const maxContentWidth = Math.max(headerWidth, maxEndpointWidth, maxEntityWidth);

  // Total width: content + 2 * padding
  return maxContentWidth + 2 * paddingX;
}

// =============================================================================
// Node Detection Functions
// =============================================================================

/**
 * Check if a DiagramNode should use custom Interface rendering.
 *
 * A node should use custom rendering when:
 * 1. Its entity_type is INTERFACE
 * 2. It has embedded_endpoint_ids with at least one entry
 *
 * @param node - The diagram node to check
 * @returns true if the node should use custom Interface rendering
 */
export function isInterfaceWithCustomRendering(node: DiagramNode): boolean {
  if (node.entity_type !== ENTITY_TYPES.INTERFACE) {
    return false;
  }

  return Array.isArray(node.embedded_endpoint_ids) && node.embedded_endpoint_ids.length > 0;
}

/**
 * Check if a DiagramNode has embedded entities (for custom rendering with child entities).
 *
 * A node has embedded entities when:
 * 1. Its entity_type is INTERFACE
 * 2. It has embedded_entity_ids with at least one entry
 *
 * @param node - The diagram node to check
 * @returns true if the node has embedded entities
 */
export function hasEmbeddedEntities(node: DiagramNode): boolean {
  if (node.entity_type !== ENTITY_TYPES.INTERFACE) {
    return false;
  }

  return Array.isArray(node.embedded_entity_ids) && node.embedded_entity_ids.length > 0;
}

/**
 * Get the endpoint lines to render for an Interface node.
 *
 * If the node has embedded_endpoint_ids, uses those.
 * Otherwise, gets all endpoints for the interface.
 *
 * @param node - The diagram node (must be INTERFACE type)
 * @param metaModel - The MetaModel containing endpoints
 * @returns Array of formatted endpoint line strings
 */
export function getEndpointLinesForNode(
  node: DiagramNode,
  metaModel: MetaModel
): string[] {
  if (node.entity_type !== ENTITY_TYPES.INTERFACE) {
    return [];
  }

  // If embedded_endpoint_ids is specified, use those
  if (Array.isArray(node.embedded_endpoint_ids) && node.embedded_endpoint_ids.length > 0) {
    return getEndpointLinesForIds(node.embedded_endpoint_ids, metaModel);
  }

  // Otherwise, get all endpoints for the interface
  return getEndpointLinesForInterface(node.entity_id, metaModel);
}

/**
 * Get child entity nodes for an Interface node.
 *
 * Returns an array of DiagramNode objects for entities that have
 * their parent_node_id set to the Interface node's ID.
 *
 * @param interfaceNode - The Interface diagram node
 * @param allNodes - All diagram nodes on the canvas
 * @param metaModel - The MetaModel for entity lookups
 * @returns Array of DiagramNode objects for child entities
 */
export function getChildEntityNodesForInterface(
  interfaceNode: DiagramNode,
  allNodes: DiagramNode[],
  _metaModel: MetaModel
): DiagramNode[] {
  if (interfaceNode.entity_type !== ENTITY_TYPES.INTERFACE) {
    return [];
  }

  // Find all nodes with parent_node_id matching this Interface
  return allNodes.filter(node =>
    node.parent_node_id === interfaceNode.id &&
    (node.entity_type === ENTITY_TYPES.LOGICAL_DATA_ENTITY ||
     node.entity_type === ENTITY_TYPES.PHYSICAL_DATA_ENTITY)
  );
}
