/**
 * ERD/UML-Style Rendering Utilities
 * Task Group 2: Utility functions for ERD node rendering
 * Task Group 5: Added Interface contract rendering utilities
 *
 * These utilities support rendering Logical and Physical Data Entities
 * in ERD/UML class-box style with header, divider, and attribute rows.
 * Also supports Interface contract rendering with endpoints and entities sections.
 */

import {
  MetaModel,
  MetaModelEntities,
  MetaModelRelationships,
  ENTITY_TYPES,
  Endpoint,
  EndpointDirection,
  EndpointLifecycleStatus,
  LogicalDataEntity,
} from '../types/model';
import { SpacingPreset, SPACING_PRESETS } from '../types/advancedAdd';

// ============================================================================
// ERD Rendering Constants
// ============================================================================

/** Fixed height for the entity name header compartment (in pixels) */
export const ERD_HEADER_HEIGHT = 30;

/** Fixed height per attribute row (in pixels) */
export const ERD_ATTRIBUTE_ROW_HEIGHT = 20;

/** Minimum width for ERD nodes (in pixels) */
export const ERD_MIN_WIDTH = 150;

/** Default padding at bottom of ERD node */
const ERD_BOTTOM_PADDING = 10;

/** Padding on left/right for text inside ERD node */
const ERD_TEXT_PADDING_X = 16;

// ============================================================================
// Interface Contract Rendering Constants (Task Group 5)
// ============================================================================

/** Fixed height for the interface contract header compartment (in pixels) */
export const CONTRACT_HEADER_HEIGHT = 32;

/** Fixed height per endpoint row in contract rendering (in pixels) */
export const CONTRACT_ENDPOINT_ROW_HEIGHT = 18;

/** Fixed height per entity box in contract rendering (in pixels) */
export const CONTRACT_ENTITY_ROW_HEIGHT = 24;

/** Minimum width for contract-style Interface nodes (in pixels) */
export const CONTRACT_MIN_WIDTH = 200;

/** Spacing between endpoints and entities sections */
export const CONTRACT_SECTION_SPACING = 8;

/** Padding at bottom of contract node */
export const CONTRACT_BOTTOM_PADDING = 10;

// ============================================================================
// Attribute Data Types
// ============================================================================

/**
 * Normalized attribute structure returned by query functions.
 * Contains the minimal fields needed for ERD rendering.
 */
export interface ERDAttribute {
  /** Unique attribute ID */
  id: string;
  /** Attribute name */
  name: string;
  /** Data type (e.g., "INTEGER", "VARCHAR(100)") - may be undefined */
  data_type?: string;
}

// ============================================================================
// Endpoint Data Types (Task Group 5)
// ============================================================================

/**
 * Normalized endpoint structure for Interface contract rendering.
 * Contains the minimal fields needed for displaying endpoint rows.
 */
export interface ERDEndpoint {
  /** Unique endpoint ID */
  id: string;
  /** Endpoint name */
  name: string;
  /** Path or address (e.g., "/api/v1/customers/{id}") */
  path_or_address: string;
  /** HTTP verb or operation type (e.g., "GET", "POST") */
  operation_verb?: string;
  /** Direction of data flow */
  direction?: EndpointDirection;
  /** Lifecycle status */
  lifecycle_status?: EndpointLifecycleStatus;
}

// ============================================================================
// Attribute Query Functions
// ============================================================================

/**
 * Get all attributes for a given entity from the meta-model.
 *
 * @param metaModel - The meta-model containing entity and attribute data
 * @param entityId - ID of the parent entity (logical or physical)
 * @param entityType - Entity type constant (LOGICAL_DATA_ENTITY or PHYSICAL_DATA_ENTITY)
 * @returns Array of attributes belonging to the entity
 */
export function getAttributesForEntity(
  metaModel: MetaModel,
  entityId: string,
  entityType: string
): ERDAttribute[] {
  if (entityType === ENTITY_TYPES.LOGICAL_DATA_ENTITY) {
    return metaModel.entities.logical_data_attributes
      .filter(attr => attr.logical_entity_id === entityId)
      .map(attr => ({
        id: attr.id,
        name: attr.name,
        data_type: attr.data_type,
      }));
  }

  if (entityType === ENTITY_TYPES.PHYSICAL_DATA_ENTITY) {
    return metaModel.entities.physical_data_attributes
      .filter(attr => attr.physical_entity_id === entityId)
      .map(attr => ({
        id: attr.id,
        name: attr.name,
        data_type: attr.data_type,
      }));
  }

  // Other entity types don't have attributes in the ERD sense
  return [];
}

/**
 * Get attributes by their IDs from the meta-model.
 * Used to retrieve embedded attributes for ERD-style rendering.
 *
 * @param metaModel - The meta-model containing entity and attribute data
 * @param attributeIds - Array of attribute IDs to retrieve
 * @param parentEntityType - Entity type of the parent (determines which attribute table to query)
 * @returns Array of matching attributes
 */
export function getAttributesByIds(
  metaModel: MetaModel,
  attributeIds: string[],
  parentEntityType: string
): ERDAttribute[] {
  const idSet = new Set(attributeIds);

  if (parentEntityType === ENTITY_TYPES.LOGICAL_DATA_ENTITY) {
    return metaModel.entities.logical_data_attributes
      .filter(attr => idSet.has(attr.id))
      .map(attr => ({
        id: attr.id,
        name: attr.name,
        data_type: attr.data_type,
      }));
  }

  if (parentEntityType === ENTITY_TYPES.PHYSICAL_DATA_ENTITY) {
    return metaModel.entities.physical_data_attributes
      .filter(attr => idSet.has(attr.id))
      .map(attr => ({
        id: attr.id,
        name: attr.name,
        data_type: attr.data_type,
      }));
  }

  return [];
}

// ============================================================================
// Attribute Formatting
// ============================================================================

/**
 * Format an attribute for display in ERD-style rendering.
 * Returns "name : type" if type exists, otherwise just "name".
 *
 * @param attr - Attribute with name and optional data_type
 * @returns Formatted attribute string
 */
export function formatAttribute(attr: { name: string; data_type?: string }): string {
  if (attr.data_type && attr.data_type.trim() !== '') {
    return `${attr.name} : ${attr.data_type}`;
  }
  return attr.name;
}

// ============================================================================
// Endpoint Query Functions (Task Group 5)
// ============================================================================

/**
 * Get all endpoints for a specific interface.
 *
 * @param interfaceId - ID of the interface
 * @param endpoints - Array of all endpoints from the meta-model
 * @returns Array of endpoints belonging to the interface
 */
export function getEndpointsForInterface(
  interfaceId: string,
  endpoints: Endpoint[]
): Endpoint[] {
  return endpoints.filter(ep => ep.interface_id === interfaceId);
}

/**
 * Get all logical data entities linked to an interface via interface_logical_entities.
 *
 * @param interfaceId - ID of the interface
 * @param entities - MetaModelEntities containing logical_data_entities
 * @param relationships - MetaModelRelationships containing interface_logical_entities
 * @returns Array of LogicalDataEntity objects linked to the interface
 */
export function getLogicalEntitiesForInterface(
  interfaceId: string,
  entities: MetaModelEntities,
  relationships: MetaModelRelationships
): LogicalDataEntity[] {
  // Get the logical entity IDs from the relationship table
  const linkedEntityIds = new Set(
    relationships.interface_logical_entities
      .filter(ile => ile.interface_id === interfaceId)
      .map(ile => ile.logical_entity_id)
  );

  // Return the actual logical data entities
  return entities.logical_data_entities.filter(lde => linkedEntityIds.has(lde.id));
}

// ============================================================================
// Endpoint Formatting (Task Group 5)
// ============================================================================

/**
 * Format an endpoint for display in Interface contract rendering.
 * Returns "[verb] path (direction, status)" format.
 *
 * Examples:
 * - "GET /api/v1/customers/{id} (INBOUND, ACTIVE)"
 * - "/api/v1/orders (OUTBOUND, DEPRECATED)"
 * - "SUBSCRIBE orders.created.v1"
 *
 * @param endpoint - Endpoint to format
 * @returns Formatted endpoint string
 */
export function formatEndpointRow(endpoint: Endpoint): string {
  const parts: string[] = [];

  // Add verb if present
  if (endpoint.operation_verb) {
    parts.push(endpoint.operation_verb);
  }

  // Add path/address
  parts.push(endpoint.path_or_address);

  // Build metadata suffix
  const metadata: string[] = [];
  if (endpoint.direction) {
    metadata.push(endpoint.direction);
  }
  if (endpoint.lifecycle_status) {
    metadata.push(endpoint.lifecycle_status);
  }

  if (metadata.length > 0) {
    parts.push(`(${metadata.join(', ')})`);
  }

  return parts.join(' ');
}

// ============================================================================
// ERD Node Sizing
// ============================================================================

/**
 * Estimate text width using a simple character-based calculation.
 * This is a fallback when canvas measurement is not available.
 *
 * @param text - Text to measure
 * @param fontSize - Font size in pixels
 * @param isBold - Whether the text is bold
 * @returns Estimated width in pixels
 */
function estimateTextWidth(text: string, fontSize: number, isBold: boolean): number {
  // Average character width is roughly 0.5-0.6 of font size for proportional fonts
  // Bold text is about 5-10% wider
  const avgCharWidth = fontSize * 0.55;
  const boldMultiplier = isBold ? 1.08 : 1.0;
  return text.length * avgCharWidth * boldMultiplier;
}

/**
 * Measure text width using canvas context if available.
 * Falls back to estimation if canvas is not available.
 *
 * @param text - Text to measure
 * @param fontSize - Font size in pixels
 * @param fontWeight - Font weight ('normal' or 'bold')
 * @returns Width in pixels
 */
function measureTextWidth(text: string, fontSize: number, fontWeight: string): number {
  // Try to use canvas for accurate measurement
  if (typeof document !== 'undefined') {
    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.font = `${fontWeight} ${fontSize}px sans-serif`;
        return ctx.measureText(text).width;
      }
    } catch {
      // Fall back to estimation
    }
  }

  // Fallback estimation
  return estimateTextWidth(text, fontSize, fontWeight === 'bold');
}

/**
 * Calculate the dimensions for an ERD-style node based on its content.
 *
 * The node consists of:
 * - Header compartment (entity name, bold, centered) - fixed height
 * - Divider line (1px)
 * - Attribute rows (one per attribute, left-aligned) - fixed height per row
 * - Bottom padding
 *
 * Width is calculated to fit the longest text (entity name or formatted attribute).
 *
 * @param entityName - Name of the entity (displayed in header)
 * @param attributes - Array of attributes to display
 * @param spacingPreset - Spacing preset for padding values (default: 'normal')
 * @returns Object with width and height in pixels
 */
export function calculateERDNodeSize(
  entityName: string,
  attributes: Array<{ name: string; data_type?: string }>,
  spacingPreset: SpacingPreset = 'normal'
): { width: number; height: number } {
  const config = SPACING_PRESETS[spacingPreset];
  const paddingX = config.paddingX;

  // Font sizes for measurement
  const headerFontSize = 12;
  const attributeFontSize = 11;

  // Measure header (entity name) width - bold font
  const headerWidth = measureTextWidth(entityName, headerFontSize, 'bold');

  // Measure attribute widths - normal font
  let maxAttributeWidth = 0;
  for (const attr of attributes) {
    const formattedText = formatAttribute(attr);
    const attrWidth = measureTextWidth(formattedText, attributeFontSize, 'normal');
    if (attrWidth > maxAttributeWidth) {
      maxAttributeWidth = attrWidth;
    }
  }

  // Calculate width: max of header or attributes + padding on both sides
  const contentWidth = Math.max(headerWidth, maxAttributeWidth);
  const calculatedWidth = contentWidth + (2 * (paddingX + ERD_TEXT_PADDING_X));
  const width = Math.max(ERD_MIN_WIDTH, Math.ceil(calculatedWidth));

  // Calculate height: header + attribute rows + padding
  const headerHeight = ERD_HEADER_HEIGHT;
  const attributesHeight = attributes.length * ERD_ATTRIBUTE_ROW_HEIGHT;
  const height = headerHeight + attributesHeight + ERD_BOTTOM_PADDING;

  return { width, height };
}

// ============================================================================
// Interface Contract Node Sizing (Task Group 5)
// ============================================================================

/**
 * Calculate the dimensions for an Interface contract-style node.
 *
 * The contract node consists of:
 * - Header compartment (interface name, bold, centered) - fixed height
 * - Divider line
 * - Endpoints section: formatted endpoint rows
 * - Divider line (if entities present)
 * - Entities section: entity name boxes
 * - Bottom padding
 *
 * @param numEndpoints - Number of endpoints to display
 * @param numEntities - Number of logical entities to display
 * @returns Object with width and height in pixels
 */
export function calculateInterfaceContractSize(
  numEndpoints: number,
  numEntities: number
): { width: number; height: number } {
  // Start with header height
  let height = CONTRACT_HEADER_HEIGHT;

  // Add endpoints section height
  if (numEndpoints > 0) {
    height += numEndpoints * CONTRACT_ENDPOINT_ROW_HEIGHT;
    height += CONTRACT_SECTION_SPACING;
  }

  // Add entities section height
  if (numEntities > 0) {
    height += numEntities * CONTRACT_ENTITY_ROW_HEIGHT;
    height += CONTRACT_SECTION_SPACING;
  }

  // Add bottom padding
  height += CONTRACT_BOTTOM_PADDING;

  // Use minimum width (actual width calculated during rendering based on content)
  const width = CONTRACT_MIN_WIDTH;

  return { width, height };
}

// ============================================================================
// ERD/Contract Type Checking
// ============================================================================

/**
 * Check if an entity type supports ERD-style rendering.
 *
 * @param entityType - Entity type constant
 * @returns True if the entity type can be rendered in ERD style
 */
export function supportsERDRendering(entityType: string): boolean {
  return (
    entityType === ENTITY_TYPES.LOGICAL_DATA_ENTITY ||
    entityType === ENTITY_TYPES.PHYSICAL_DATA_ENTITY
  );
}

/**
 * Check if an entity type supports contract-style rendering (Task Group 5).
 * Only INTERFACE entities support contract rendering.
 *
 * @param entityType - Entity type constant
 * @returns True if the entity type can be rendered in contract style
 */
export function supportsContractRendering(entityType: string): boolean {
  return entityType === ENTITY_TYPES.INTERFACE;
}

/**
 * Check if a node should be rendered in ERD style.
 * A node should be rendered as ERD if:
 * 1. It has render_style === 'erd'
 * 2. It is a LOGICAL_DATA_ENTITY or PHYSICAL_DATA_ENTITY
 *
 * @param node - DiagramNode to check
 * @returns True if the node should render in ERD style
 */
export function shouldRenderAsERD(node: {
  entity_type: string;
  render_style?: 'standard' | 'erd' | 'contract';
}): boolean {
  return (
    node.render_style === 'erd' &&
    supportsERDRendering(node.entity_type)
  );
}

/**
 * Check if a node should be rendered in contract style (Task Group 5).
 * A node should be rendered as contract if:
 * 1. It has render_style === 'contract'
 * 2. It is an INTERFACE entity
 *
 * @param node - DiagramNode to check
 * @returns True if the node should render in contract style
 */
export function shouldRenderAsContract(node: {
  entity_type: string;
  render_style?: 'standard' | 'erd' | 'contract';
}): boolean {
  return (
    node.render_style === 'contract' &&
    supportsContractRendering(node.entity_type)
  );
}
