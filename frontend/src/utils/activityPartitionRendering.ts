/**
 * Activity Partition Swimlane Rendering Functions
 * Task Group 3: Partition Swimlane Component
 *
 * Provides rendering functions for activity partition swimlanes:
 * - renderPartition: Main function to render a partition with header/body
 * - resolvePartitionDisplayName: Resolves display name from referenced entity or fallback
 * - Supports VERTICAL orientation (header at top, lane extends down)
 * - Supports HORIZONTAL orientation (header on left, lane extends right)
 *
 * Visual specifications from spec:
 * - VERTICAL: Header at top, lane extends top-to-bottom, multiple partitions arranged left-to-right
 * - HORIZONTAL: Header on left, lane extends left-to-right, partitions arranged top-to-bottom
 * - Header background subtly distinct from body (e.g., slightly darker or different hue)
 * - Clear border around full partition with divider line between header and body
 *
 * Spec 2025-12-31 (A1): Added resolvePartitionDisplayName for referenced entity name resolution
 */

import { ACTIVITY_PARTITION_DEFAULTS } from '../config/defaults';
import { ActivityPartition, ActivityDiagramOrientation, Activity, MetaModel, ActivityPartitionRefKind } from '../types/model';
import { wrapText } from './rendering';

/**
 * Position interface for partition placement
 */
export interface PartitionPosition {
  x: number;
  y: number;
}

/**
 * Dimensions interface for partition sizing
 */
export interface PartitionDimensions {
  width: number;
  height: number;
}

/**
 * Props interface for partition rendering
 * Spec 2025-12-31 (A1): Added optional metaModel for name resolution
 */
export interface PartitionRenderProps {
  /** The partition entity to render */
  partition: ActivityPartition;
  /** Top-left position of the partition */
  position: PartitionPosition;
  /** Total dimensions of the partition */
  dimensions: PartitionDimensions;
  /** Orientation of the partition (default: VERTICAL) */
  orientation?: ActivityDiagramOrientation;
  /** Child activities within this partition (for containment reference) */
  children?: Activity[];
  /** MetaModel for resolving referenced entity names (optional) */
  metaModel?: MetaModel;
}

/**
 * Rectangle definition for SVG rendering
 */
export interface RectDef {
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
}

/**
 * Line definition for SVG rendering
 */
export interface LineDef {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stroke: string;
  strokeWidth: number;
  strokeDasharray?: string;
}

/**
 * Text element definition for SVG rendering
 */
export interface TextElementDef {
  content: string;
  x: number;
  y: number;
  textAnchor: 'start' | 'middle' | 'end';
  dominantBaseline?: 'middle' | 'auto';
  fontSize: number;
  fontWeight: string;
  fill: string;
  /** Optional rotation angle for vertical text in HORIZONTAL orientation */
  rotation?: number;
}

/**
 * Result interface for partition rendering
 * Contains all SVG element definitions needed to render a partition
 */
export interface PartitionRenderResult {
  /** Header rectangle (distinct background for partition name) */
  headerRect: RectDef;
  /** Body rectangle (swimlane area for activities) */
  bodyRect: RectDef;
  /** Divider line between header and body */
  dividerLine: LineDef;
  /** Full border rectangle around the entire partition */
  fullBorderRect: RectDef;
  /** Text element for partition name in header */
  textElement: TextElementDef;
  /** Data attributes for selection and interaction */
  dataAttributes: Record<string, string>;
}

// ============================================================================
// Spec 2025-12-31 (A1): Partition Display Name Resolution
// ============================================================================

/**
 * Resolve the display name for a partition header.
 *
 * Resolution chain:
 * 1. If partition.ref_kind and partition.ref_id are set, lookup entity name from metaModel
 * 2. If reference not found or not set, fall back to partition.name
 * 3. If partition.name is empty/undefined, fall back to partition.id
 *
 * @param partition - The ActivityPartition entity
 * @param metaModel - The MetaModel for entity lookup
 * @returns The resolved display name string
 */
export function resolvePartitionDisplayName(
  partition: ActivityPartition,
  metaModel: MetaModel | null | undefined
): string {
  // Try to resolve from referenced entity first
  if (partition.ref_kind && partition.ref_id && metaModel) {
    const resolvedName = lookupReferencedEntityName(
      partition.ref_kind,
      partition.ref_id,
      metaModel
    );
    if (resolvedName) {
      return resolvedName;
    }
  }

  // Fallback to partition.name
  if (partition.name && partition.name.trim() !== '') {
    return partition.name;
  }

  // Final fallback to partition.id
  return partition.id;
}

/**
 * Lookup the name of a referenced entity by kind and id.
 *
 * @param refKind - The type of entity being referenced
 * @param refId - The ID of the referenced entity
 * @param metaModel - The MetaModel containing entity data
 * @returns The entity name or undefined if not found
 */
function lookupReferencedEntityName(
  refKind: ActivityPartitionRefKind,
  refId: string,
  metaModel: MetaModel
): string | undefined {
  switch (refKind) {
    case 'BusinessUser': {
      const entity = metaModel.entities.business_users?.find(e => e.id === refId);
      return entity?.name;
    }
    case 'Application': {
      const entity = metaModel.entities.applications?.find(e => e.id === refId);
      return entity?.name;
    }
    case 'ApplicationComponent': {
      const entity = metaModel.entities.app_components?.find(e => e.id === refId);
      return entity?.name;
    }
    case 'Service': {
      const entity = metaModel.entities.services?.find(e => e.id === refId);
      return entity?.name;
    }
    case 'Interface': {
      const entity = metaModel.entities.interfaces?.find(e => e.id === refId);
      return entity?.name;
    }
    case 'Class': {
      const entity = metaModel.entities.classes?.find(e => e.id === refId);
      return entity?.name;
    }
    default:
      return undefined;
  }
}

// ============================================================================
// Internal Rendering Functions
// ============================================================================

/**
 * Get divider stroke dasharray based on divider_style
 */
function getDividerDasharray(style: 'solid' | 'dashed' | 'dotted'): string {
  switch (style) {
    case 'dashed':
      return '6 4';
    case 'dotted':
      return '2 4';
    default:
      return '';
  }
}

/**
 * Render header rect for VERTICAL orientation
 * Header is at the top, spanning full width
 */
function renderVerticalHeaderRect(
  position: PartitionPosition,
  dimensions: PartitionDimensions
): RectDef {
  const { header_height, header_background, border_color, border_width } = ACTIVITY_PARTITION_DEFAULTS;

  return {
    x: position.x,
    y: position.y,
    width: dimensions.width,
    height: header_height,
    fill: header_background,
    stroke: border_color,
    strokeWidth: border_width,
  };
}

/**
 * Render body rect for VERTICAL orientation
 * Body extends from below header to bottom of partition
 */
function renderVerticalBodyRect(
  position: PartitionPosition,
  dimensions: PartitionDimensions
): RectDef {
  const { header_height, body_background, border_color, border_width } = ACTIVITY_PARTITION_DEFAULTS;

  return {
    x: position.x,
    y: position.y + header_height,
    width: dimensions.width,
    height: dimensions.height - header_height,
    fill: body_background,
    stroke: border_color,
    strokeWidth: border_width,
  };
}

/**
 * Render divider line for VERTICAL orientation
 * Horizontal line between header and body
 */
function renderVerticalDividerLine(
  position: PartitionPosition,
  dimensions: PartitionDimensions
): LineDef {
  const { header_height, border_color, border_width, divider_style } = ACTIVITY_PARTITION_DEFAULTS;

  return {
    x1: position.x,
    y1: position.y + header_height,
    x2: position.x + dimensions.width,
    y2: position.y + header_height,
    stroke: border_color,
    strokeWidth: border_width,
    strokeDasharray: getDividerDasharray(divider_style),
  };
}

/**
 * Render text element for VERTICAL orientation
 * Text is centered in the header with text-anchor="middle" and dominant-baseline="middle"
 *
 * Spec 2025-12-31 (A1): Position text at center of header bar
 * - x = partitionRect.x + width/2
 * - y = partitionRect.y + headerHeight/2
 */
function renderVerticalTextElement(
  position: PartitionPosition,
  dimensions: PartitionDimensions,
  partitionName: string
): TextElementDef {
  const { header_height } = ACTIVITY_PARTITION_DEFAULTS;
  const fontSize = 12; // Default font size for partition names

  // Spec 2025-12-31 (A1): Center X in header
  const centerX = position.x + dimensions.width / 2;
  // Spec 2025-12-31 (A1): Center Y in header (using dominant-baseline: middle)
  const centerY = position.y + header_height / 2;

  return {
    content: partitionName,
    x: centerX,
    y: centerY,
    textAnchor: 'middle',
    dominantBaseline: 'middle',
    fontSize,
    fontWeight: 'bold',
    fill: '#333333',
  };
}

/**
 * Render header rect for HORIZONTAL orientation
 * Header is on the left, spanning full height
 */
function renderHorizontalHeaderRect(
  position: PartitionPosition,
  dimensions: PartitionDimensions
): RectDef {
  const { header_height, header_background, border_color, border_width } = ACTIVITY_PARTITION_DEFAULTS;
  // For horizontal orientation, header_height acts as header width
  const headerWidth = header_height;

  return {
    x: position.x,
    y: position.y,
    width: headerWidth,
    height: dimensions.height,
    fill: header_background,
    stroke: border_color,
    strokeWidth: border_width,
  };
}

/**
 * Render body rect for HORIZONTAL orientation
 * Body extends from right of header to right edge of partition
 */
function renderHorizontalBodyRect(
  position: PartitionPosition,
  dimensions: PartitionDimensions
): RectDef {
  const { header_height, body_background, border_color, border_width } = ACTIVITY_PARTITION_DEFAULTS;
  // For horizontal orientation, header_height acts as header width
  const headerWidth = header_height;

  return {
    x: position.x + headerWidth,
    y: position.y,
    width: dimensions.width - headerWidth,
    height: dimensions.height,
    fill: body_background,
    stroke: border_color,
    strokeWidth: border_width,
  };
}

/**
 * Render divider line for HORIZONTAL orientation
 * Vertical line between header and body
 */
function renderHorizontalDividerLine(
  position: PartitionPosition,
  dimensions: PartitionDimensions
): LineDef {
  const { header_height, border_color, border_width, divider_style } = ACTIVITY_PARTITION_DEFAULTS;
  // For horizontal orientation, header_height acts as header width
  const headerWidth = header_height;

  return {
    x1: position.x + headerWidth,
    y1: position.y,
    x2: position.x + headerWidth,
    y2: position.y + dimensions.height,
    stroke: border_color,
    strokeWidth: border_width,
    strokeDasharray: getDividerDasharray(divider_style),
  };
}

/**
 * Render text element for HORIZONTAL orientation
 * Text is centered in the header (which is on the left)
 *
 * Spec 2025-12-31 (A1): Position text at center of header bar
 */
function renderHorizontalTextElement(
  position: PartitionPosition,
  dimensions: PartitionDimensions,
  partitionName: string
): TextElementDef {
  const { header_height } = ACTIVITY_PARTITION_DEFAULTS;
  // For horizontal orientation, header_height acts as header width
  const headerWidth = header_height;
  const fontSize = 12; // Default font size for partition names

  // Center X in header (left side)
  const centerX = position.x + headerWidth / 2;
  // Center Y in header (vertically centered)
  const centerY = position.y + dimensions.height / 2;

  return {
    content: partitionName,
    x: centerX,
    y: centerY,
    textAnchor: 'middle',
    dominantBaseline: 'middle',
    fontSize,
    fontWeight: 'bold',
    fill: '#333333',
    // For horizontal orientation, text might need rotation for long names
    // Currently rendering normally; can add rotation if needed
  };
}

/**
 * Render full border rectangle around the entire partition
 * This is a stroke-only rectangle to ensure complete border
 */
function renderFullBorderRect(
  position: PartitionPosition,
  dimensions: PartitionDimensions
): RectDef {
  const { border_color, border_width } = ACTIVITY_PARTITION_DEFAULTS;

  return {
    x: position.x,
    y: position.y,
    width: dimensions.width,
    height: dimensions.height,
    fill: 'none', // Transparent fill - border only
    stroke: border_color,
    strokeWidth: border_width,
  };
}

// ============================================================================
// Main Rendering Function
// ============================================================================

/**
 * Main partition rendering function
 * Renders a partition swimlane with header, body, divider, and text
 *
 * Spec 2025-12-31 (A1): Updated to use resolvePartitionDisplayName
 * - Uses metaModel to resolve referenced entity names
 * - Falls back to partition.name, then partition.id
 *
 * @param props - PartitionRenderProps containing partition, position, dimensions, orientation, metaModel
 * @returns PartitionRenderResult with all SVG element definitions
 */
export function renderPartition(props: PartitionRenderProps): PartitionRenderResult {
  const {
    partition,
    position,
    dimensions,
    orientation = ACTIVITY_PARTITION_DEFAULTS.orientation as ActivityDiagramOrientation,
    metaModel,
  } = props;

  // Spec 2025-12-31 (A1): Use resolvePartitionDisplayName instead of partition.name directly
  const partitionName = resolvePartitionDisplayName(partition, metaModel);

  // Determine if vertical or horizontal layout
  const isVertical = orientation === 'VERTICAL';

  // Render components based on orientation
  const headerRect = isVertical
    ? renderVerticalHeaderRect(position, dimensions)
    : renderHorizontalHeaderRect(position, dimensions);

  const bodyRect = isVertical
    ? renderVerticalBodyRect(position, dimensions)
    : renderHorizontalBodyRect(position, dimensions);

  const dividerLine = isVertical
    ? renderVerticalDividerLine(position, dimensions)
    : renderHorizontalDividerLine(position, dimensions);

  const textElement = isVertical
    ? renderVerticalTextElement(position, dimensions, partitionName)
    : renderHorizontalTextElement(position, dimensions, partitionName);

  const fullBorderRect = renderFullBorderRect(position, dimensions);

  // Build data attributes for selection/interaction
  const dataAttributes: Record<string, string> = {
    'data-partition-id': partition.id,
    'data-entity-type': 'ACTIVITY_PARTITION',
  };

  return {
    headerRect,
    bodyRect,
    dividerLine,
    fullBorderRect,
    textElement,
    dataAttributes,
  };
}

/**
 * Helper function to wrap long partition names
 * Uses wrapText from rendering.ts
 *
 * @param name - Partition name to wrap
 * @param maxWidth - Maximum width for text wrapping
 * @param fontSize - Font size for text measurement
 * @returns Array of wrapped text lines
 */
export function wrapPartitionName(
  name: string,
  maxWidth: number,
  fontSize: number = 12
): string[] {
  if (!name) return [];
  return wrapText(name, maxWidth, fontSize, 'bold');
}
