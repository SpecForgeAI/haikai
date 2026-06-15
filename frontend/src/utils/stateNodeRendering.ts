/**
 * State Node Shape Rendering Functions
 * Task Group 2: State Node Shape Rendering Functions
 * Spec 2026-01-01: State Diagram UX Fixes
 *   - Task Group 1: State Node Resize Helpers
 *   - Task Group 2: State Node Rendering with Custom Dimensions
 *
 * Provides rendering functions for all state node types:
 * - Initial: Solid filled black circle (uses node bounds for radius)
 * - Normal: Rounded rectangle with moderate corner radius (uses node bounds)
 * - Final: Bullseye shape (uses node bounds for radii)
 *
 * And resize helpers:
 * - getStateKindForNode: Get StateKind from a DiagramNode
 * - isSymbolStateKind: Check if StateKind requires square resize
 * - calculateSquareResizeForState: Calculate square-constrained resize dimensions
 *
 * Follows patterns from activityNodeRendering.ts and shapeRendering.ts
 */

import { ShapeRenderResult } from './shapeRendering';
import { STATE_NODE_DEFAULTS, HandlePosition } from '../config/defaults';
import { State, StateKind, DiagramNode, MetaModel } from '../types/model';

/**
 * Extended result interface for state node rendering
 * Adds showLabel flag and optional dimension properties
 * Following ActivityNodeRenderResult pattern exactly
 */
export interface StateNodeRenderResult extends ShapeRenderResult {
  /** Whether the node should display a label */
  showLabel: boolean;
  /** Width of the node (for rectangles) */
  width?: number;
  /** Height of the node (for rectangles) */
  height?: number;
  /** Outer circle path data (for bullseye/Final nodes) */
  outerPathData?: string;
  /** Inner circle path data (for bullseye/Final nodes) */
  innerPathData?: string;
}

/**
 * Position interface for node placement
 */
export interface NodePosition {
  x: number;
  y: number;
}

// ============================================================================
// Spec 2026-01-01 Task Group 1: State Node Resize Helpers
// ============================================================================

/**
 * State kinds that require square aspect ratio during resize.
 * These are the "symbol" nodes that have fixed aspect ratios (1:1).
 * Mirrors SYMBOL_ACTIVITY_KINDS from activityNodeRendering.ts
 */
export const SYMBOL_STATE_KINDS: Set<StateKind> = new Set([
  'Initial',
  'Final',
]);

/**
 * Get the StateKind for a DiagramNode.
 *
 * Spec 2026-01-01 Task Group 1: Helper for resize constraint detection.
 * Mirrors getActivityKindForNode() pattern from activityNodeRendering.ts
 *
 * @param node - The DiagramNode to check
 * @param metaModel - The MetaModel containing State entities
 * @returns The StateKind if node is a STATE, null otherwise
 */
export function getStateKindForNode(
  node: DiagramNode,
  metaModel: MetaModel
): StateKind | null {
  // Only STATE entity types have state_kind
  if (node.entity_type !== 'STATE') {
    return null;
  }

  // Look up the state entity
  const state = metaModel.entities.states?.find(
    (s) => s.id === node.entity_id
  );

  if (!state) {
    return null;
  }

  // Return the state_kind, defaulting to 'Normal' if not specified
  return state.state_kind || 'Normal';
}

/**
 * Check if a StateKind requires square aspect ratio.
 *
 * Spec 2026-01-01 Task Group 1: Symbol nodes (Initial/Final)
 * must maintain square (1:1) aspect ratio during resize.
 * Mirrors isSymbolActivityKind() pattern from activityNodeRendering.ts
 *
 * @param stateKind - The StateKind to check (or null)
 * @returns true if the kind requires square resize, false otherwise
 */
export function isSymbolStateKind(stateKind: StateKind | null): boolean {
  if (!stateKind) {
    return false;
  }
  return SYMBOL_STATE_KINDS.has(stateKind);
}

/**
 * Calculate square-constrained resize dimensions for State symbol nodes.
 *
 * Spec 2026-01-01 Task Group 1:
 * - For corner handles (TL/TR/BL/BR): use max(|dx|, |dy|) for both dimensions
 * - For edge handles (TC/BC/ML/MR): apply delta to both dimensions
 * - No minimum size constraints (allow very small symbols)
 * - Prevent negative dimensions (minimum 1x1)
 *
 * Mirrors calculateSquareResize() from activityNodeRendering.ts
 *
 * @param handle - The resize handle being dragged
 * @param originalNode - The original node state before drag
 * @param dx - Delta X from drag start
 * @param dy - Delta Y from drag start
 * @returns New { pos_x, pos_y, width, height } maintaining square aspect ratio
 */
export function calculateSquareResizeForState(
  handle: HandlePosition,
  originalNode: DiagramNode,
  dx: number,
  dy: number
): { pos_x: number; pos_y: number; width: number; height: number } {
  let pos_x = originalNode.pos_x;
  let pos_y = originalNode.pos_y;
  let size = originalNode.width; // Start with current width (should equal height for squares)

  // Minimum size to prevent negative/zero dimensions
  const minSize = 1;

  // Determine the dominant delta for corner handles
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);

  switch (handle) {
    // Corner handles: use max of |dx|, |dy| for uniform scaling
    case 'TL': {
      // Top-left: dragging up-left increases size, down-right decreases
      const dominantDelta = Math.max(absDx, absDy);
      // If dx < 0 or dy < 0, we're expanding (moving up-left)
      const expanding = dx < 0 || dy < 0;
      const sizeDelta = expanding ? dominantDelta : -dominantDelta;
      size = Math.max(originalNode.width + sizeDelta, minSize);
      // Adjust position to keep bottom-right corner fixed
      pos_x = originalNode.pos_x + originalNode.width - size;
      pos_y = originalNode.pos_y + originalNode.height - size;
      break;
    }
    case 'TR': {
      // Top-right: dragging up-right increases size, down-left decreases
      const dominantDelta = Math.max(absDx, absDy);
      // If dx > 0 or dy < 0, we're expanding
      const expanding = dx > 0 || dy < 0;
      const sizeDelta = expanding ? dominantDelta : -dominantDelta;
      size = Math.max(originalNode.width + sizeDelta, minSize);
      // Adjust position to keep bottom-left corner fixed
      pos_y = originalNode.pos_y + originalNode.height - size;
      break;
    }
    case 'BL': {
      // Bottom-left: dragging down-left increases size, up-right decreases
      const dominantDelta = Math.max(absDx, absDy);
      // If dx < 0 or dy > 0, we're expanding
      const expanding = dx < 0 || dy > 0;
      const sizeDelta = expanding ? dominantDelta : -dominantDelta;
      size = Math.max(originalNode.width + sizeDelta, minSize);
      // Adjust position to keep top-right corner fixed
      pos_x = originalNode.pos_x + originalNode.width - size;
      break;
    }
    case 'BR': {
      // Bottom-right: dragging down-right increases size, up-left decreases
      const dominantDelta = Math.max(absDx, absDy);
      // If dx > 0 or dy > 0, we're expanding
      const expanding = dx > 0 || dy > 0;
      const sizeDelta = expanding ? dominantDelta : -dominantDelta;
      size = Math.max(originalNode.width + sizeDelta, minSize);
      // Position stays the same (top-left is anchor)
      break;
    }

    // Edge handles: apply the edge's delta to both dimensions
    case 'TC': {
      // Top center: dragging up increases size
      const sizeDelta = -dy; // Negative dy = moving up = increase
      size = Math.max(originalNode.height + sizeDelta, minSize);
      // Adjust position to keep bottom edge fixed, center horizontally
      pos_y = originalNode.pos_y + originalNode.height - size;
      // Center the node horizontally (width changes too)
      const widthDelta = size - originalNode.width;
      pos_x = originalNode.pos_x - widthDelta / 2;
      break;
    }
    case 'BC': {
      // Bottom center: dragging down increases size
      const sizeDelta = dy;
      size = Math.max(originalNode.height + sizeDelta, minSize);
      // Position stays (top edge is anchor), center horizontally
      const widthDelta = size - originalNode.width;
      pos_x = originalNode.pos_x - widthDelta / 2;
      break;
    }
    case 'ML': {
      // Middle left: dragging left increases size
      const sizeDelta = -dx; // Negative dx = moving left = increase
      size = Math.max(originalNode.width + sizeDelta, minSize);
      // Adjust position to keep right edge fixed, center vertically
      pos_x = originalNode.pos_x + originalNode.width - size;
      const heightDelta = size - originalNode.height;
      pos_y = originalNode.pos_y - heightDelta / 2;
      break;
    }
    case 'MR': {
      // Middle right: dragging right increases size
      const sizeDelta = dx;
      size = Math.max(originalNode.width + sizeDelta, minSize);
      // Position stays (left edge is anchor), center vertically
      const heightDelta = size - originalNode.height;
      pos_y = originalNode.pos_y - heightDelta / 2;
      break;
    }
  }

  return {
    pos_x,
    pos_y,
    width: size,
    height: size, // Always equal for square
  };
}

// ============================================================================
// Shape Rendering Functions
// Spec 2026-01-01 Task Group 2: Updated to accept custom dimensions
// ============================================================================

/**
 * Render an Initial state node - solid filled black circle
 *
 * Spec 2026-01-01: Shape uses radius = min(width, height) / 2
 *
 * Specifications:
 * - Diameter derived from node bounds: min(width, height)
 * - Fill: black (#000000)
 * - Stroke: black (#000000)
 * - No label
 *
 * @param position - Center position of the node
 * @param customWidth - Optional custom width from node bounds
 * @param customHeight - Optional custom height from node bounds
 * @returns StateNodeRenderResult with circle path data
 */
export function renderInitialStateNode(
  position: NodePosition,
  customWidth?: number,
  customHeight?: number
): StateNodeRenderResult {
  const defaults = STATE_NODE_DEFAULTS.Initial;
  const defaultDiameter = defaults.diameter || 18;

  // Use custom dimensions if provided, otherwise use default diameter
  const width = customWidth ?? defaultDiameter;
  const height = customHeight ?? defaultDiameter;

  // Circle radius = min(width, height) / 2
  const radius = Math.min(width, height) / 2;
  const { x: cx, y: cy } = position;

  // Create circle path using arc commands (M, A, A, Z pattern)
  // M (start left), A (arc to right), A (arc back to start)
  const pathData = `M ${cx - radius} ${cy} ` +
    `A ${radius} ${radius} 0 1 1 ${cx + radius} ${cy} ` +
    `A ${radius} ${radius} 0 1 1 ${cx - radius} ${cy} Z`;

  return {
    pathData,
    fill: defaults.fill,
    stroke: defaults.stroke,
    strokeWidth: defaults.stroke_width,
    strokeDasharray: '',
    textPosition: { x: cx, y: cy },
    showLabel: false,
  };
}

/**
 * Render a Normal state node - rounded rectangle with moderate corner radius
 *
 * Specifications:
 * - Dimensions: 140x50px (default)
 * - Corner radius: 8px (moderate, different from Activity Action pill-like)
 * - Fill: entityColors.STATE.background (light green)
 * - Stroke: entityColors.STATE.border (green)
 * - Label: centered
 *
 * @param position - Center position of the node
 * @param customWidth - Optional custom width
 * @param customHeight - Optional custom height
 * @returns StateNodeRenderResult with rounded rectangle path data
 */
export function renderNormalStateNode(
  position: NodePosition,
  customWidth?: number,
  customHeight?: number
): StateNodeRenderResult {
  const defaults = STATE_NODE_DEFAULTS.Normal;
  const width = customWidth ?? defaults.width ?? 140;
  const height = customHeight ?? defaults.height ?? 50;
  const cornerRadius = defaults.cornerRadius || 8;
  const { x: cx, y: cy } = position;

  // Calculate bounds from center position
  const left = cx - width / 2;
  const top = cy - height / 2;
  const right = cx + width / 2;
  const bottom = cy + height / 2;

  // Limit corner radius to half of the smallest dimension
  const rx = Math.min(cornerRadius, width / 2, height / 2);
  const ry = rx;

  // Create rounded rectangle path with corner arcs
  // Starting from top-left corner after the arc, going clockwise
  const pathData =
    // Move to start of top edge (after top-left corner arc)
    `M ${left + rx} ${top} ` +
    // Top edge
    `L ${right - rx} ${top} ` +
    // Top-right corner arc
    `A ${rx} ${ry} 0 0 1 ${right} ${top + ry} ` +
    // Right edge
    `L ${right} ${bottom - ry} ` +
    // Bottom-right corner arc
    `A ${rx} ${ry} 0 0 1 ${right - rx} ${bottom} ` +
    // Bottom edge
    `L ${left + rx} ${bottom} ` +
    // Bottom-left corner arc
    `A ${rx} ${ry} 0 0 1 ${left} ${bottom - ry} ` +
    // Left edge
    `L ${left} ${top + ry} ` +
    // Top-left corner arc
    `A ${rx} ${ry} 0 0 1 ${left + rx} ${top} Z`;

  return {
    pathData,
    fill: defaults.fill,
    stroke: defaults.stroke,
    strokeWidth: defaults.stroke_width,
    strokeDasharray: '',
    textPosition: { x: cx, y: cy },
    showLabel: true,
    width,
    height,
  };
}

/**
 * Render a Final state node - bullseye shape (outer stroke circle + inner filled circle)
 *
 * Spec 2026-01-01: Both circles use radius derived from node bounds.
 * Outer radius = min(width, height) / 2
 * Inner radius proportionally scaled to maintain ratio.
 *
 * Specifications:
 * - Outer circle: stroke only, radius from node bounds
 * - Inner circle: filled black, proportionally sized
 * - Fill: black (#000000) for inner circle
 * - Stroke: black (#000000) for outer circle
 * - No label
 *
 * @param position - Center position of the node
 * @param customWidth - Optional custom width from node bounds
 * @param customHeight - Optional custom height from node bounds
 * @returns StateNodeRenderResult with bullseye path data (outerPathData and innerPathData)
 */
export function renderFinalStateNode(
  position: NodePosition,
  customWidth?: number,
  customHeight?: number
): StateNodeRenderResult {
  const defaults = STATE_NODE_DEFAULTS.Final;
  const defaultOuterDiameter = defaults.diameter || 22;
  const defaultInnerDiameter = defaults.innerDiameter || 14;

  // Calculate the ratio of inner to outer diameter from defaults
  const innerOuterRatio = defaultInnerDiameter / defaultOuterDiameter;

  // Use custom dimensions if provided, otherwise use default diameter
  const width = customWidth ?? defaultOuterDiameter;
  const height = customHeight ?? defaultOuterDiameter;

  // Outer radius = min(width, height) / 2
  const outerRadius = Math.min(width, height) / 2;

  // Inner radius proportionally scaled
  const innerRadius = Math.round(outerRadius * innerOuterRatio);

  const { x: cx, y: cy } = position;

  // Create outer circle path (stroke only)
  const outerPathData = `M ${cx - outerRadius} ${cy} ` +
    `A ${outerRadius} ${outerRadius} 0 1 1 ${cx + outerRadius} ${cy} ` +
    `A ${outerRadius} ${outerRadius} 0 1 1 ${cx - outerRadius} ${cy} Z`;

  // Create inner circle path (filled)
  const innerPathData = `M ${cx - innerRadius} ${cy} ` +
    `A ${innerRadius} ${innerRadius} 0 1 1 ${cx + innerRadius} ${cy} ` +
    `A ${innerRadius} ${innerRadius} 0 1 1 ${cx - innerRadius} ${cy} Z`;

  // Combined path data (outer then inner)
  // The pathData field contains combined path for backward compatibility
  const pathData = outerPathData + ' ' + innerPathData;

  return {
    pathData,
    fill: defaults.fill,
    stroke: defaults.stroke,
    strokeWidth: defaults.stroke_width,
    strokeDasharray: '',
    textPosition: { x: cx, y: cy },
    showLabel: false,
    outerPathData,
    innerPathData,
  };
}

/**
 * Main dispatcher function to render any state node type
 * Routes to appropriate rendering function based on state.state_kind
 *
 * Spec 2026-01-01: Now accepts optional width/height to pass to shape functions.
 *
 * Backward compatibility: Defaults to Normal node if state_kind is missing or unknown
 *
 * @param state - The State entity to render
 * @param position - Center position of the node
 * @param customWidth - Optional custom width from node bounds
 * @param customHeight - Optional custom height from node bounds
 * @returns StateNodeRenderResult for the appropriate node type
 */
export function renderStateNode(
  state: State,
  position: NodePosition,
  customWidth?: number,
  customHeight?: number
): StateNodeRenderResult {
  // Get state kind, defaulting to 'Normal' for backward compatibility
  const stateKind: StateKind = state.state_kind || 'Normal';

  switch (stateKind) {
    case 'Initial':
      return renderInitialStateNode(position, customWidth, customHeight);
    case 'Normal':
      return renderNormalStateNode(position, customWidth, customHeight);
    case 'Final':
      return renderFinalStateNode(position, customWidth, customHeight);
    default:
      // Fallback to Normal node for unknown kinds (backward compatibility)
      return renderNormalStateNode(position, customWidth, customHeight);
  }
}
