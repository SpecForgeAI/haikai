/**
 * Activity Node Shape Rendering Functions
 * Task Group 2: Activity Node Shape Functions
 * Task Group 3: Flow Boundary Anchoring (A2)
 * Task Group 4: Activity Flow Edge Rendering Functions
 * Task Group 5: Movable/Resizable Labels (A5) - Label Position Calculators
 * Spec 2026-01-01: Shape Rendering from Node Bounds
 * Spec 2026-01-01: Activity Diagram UX Fixes
 *   - Square-only resize for symbol nodes (Initial/Decision/Merge/Final)
 *   - No minimum size constraints for symbol nodes
 *
 * Provides rendering functions for all activity node types:
 * - Initial: Solid filled black circle (uses node bounds for radius)
 * - Action: Rounded rectangle with pill-like corners (uses node bounds)
 * - Decision: Diamond shape (uses node bounds for polygon)
 * - Merge: Diamond shape (uses node bounds, smaller default than Decision)
 * - Final: Bullseye shape (uses node bounds for radii)
 *
 * All shape rendering functions now accept optional width/height parameters
 * to derive visible shapes from node bounds, enabling proper resize behavior.
 *
 * And activity flow edge rendering:
 * - renderActivityFlow: Renders edge between activities with arrowhead
 * - renderActivityFlowWithBoundary: Renders edge using boundary anchor points
 * - calculateFlowLabelPosition: Calculates midpoint for label placement
 *
 * And label position calculation:
 * - getDefaultLabelPosition: Calculate default label position for Activity nodes
 * - getDefaultEdgeLabelPosition: Calculate default label position for Activity Flow edges
 * - createDecisionLabelDecoration: Create LabelDecoration for Decision nodes
 *
 * And resize helpers:
 * - getActivityKindForNode: Get ActivityKind from a DiagramNode
 * - isSymbolActivityKind: Check if ActivityKind requires square resize
 * - calculateSquareResize: Calculate square-constrained resize dimensions
 *
 * Follows patterns from shapeRendering.ts and rendering.ts
 */

import { ShapeRenderResult } from './shapeRendering';
import { ACTIVITY_NODE_DEFAULTS, ACTIVITY_FLOW_DEFAULTS, HandlePosition } from '../config/defaults';
import { Activity, ActivityKind, ActivityFlowKind, DiagramNode, LABEL_DECORATION_DEFAULTS, LabelDecoration, createDefaultLabelDecoration, MetaModel } from '../types/model';
import { calculateArrowhead } from './rendering';
import {
  getBoundaryAnchorPoint,
  getShapeKindFromActivityKind,
  Rect,
  ShapeKind,
} from './geometryUtils';

/**
 * Extended result interface for activity node rendering
 * Adds showLabel flag and optional dimension properties
 */
export interface ActivityNodeRenderResult extends ShapeRenderResult {
  /** Whether the node should display a label */
  showLabel: boolean;
  /** Width of the node (for rectangles and diamonds) */
  width?: number;
  /** Height of the node (for rectangles and diamonds) */
  height?: number;
  /** Outer diameter (for bullseye/Final nodes) */
  outerDiameter?: number;
  /** Inner diameter (for bullseye/Final nodes) */
  innerDiameter?: number;
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

/**
 * Result interface for activity flow rendering
 * Task Group 4: Activity Flow Edge Component
 */
export interface ActivityFlowRenderResult {
  /** SVG path data for the line */
  linePath: string;
  /** SVG path data for the arrowhead */
  arrowheadPath: string;
  /** Stroke color for the line */
  strokeColor: string;
  /** Stroke width for the line */
  strokeWidth: number;
  /** Stroke dasharray for the line (empty for solid, dash pattern for dashed) */
  strokeDasharray: string;
  /** Fill color for the arrowhead (same as stroke color) */
  arrowheadFill: string;
  /** Optional label position (midpoint of edge) */
  labelPosition?: { x: number; y: number };
  /** Optional label text */
  labelText?: string;
  /** Label font size */
  labelFontSize: number;
  /** Label offset from midpoint */
  labelOffset: number;
}

/**
 * Label position result interface
 * Task Group 5: Label Position Calculation
 */
export interface LabelPositionResult {
  /** X position of the label (top-left corner of bounding box) */
  x: number;
  /** Y position of the label (top-left corner of bounding box) */
  y: number;
  /** Width of the label bounding box */
  width: number;
  /** Height of the label bounding box */
  height: number;
}

/**
 * Node bounds interface for label position calculation
 */
export interface NodeBounds {
  /** X position of the node (top-left corner) */
  x: number;
  /** Y position of the node (top-left corner) */
  y: number;
  /** Width of the node */
  width: number;
  /** Height of the node */
  height: number;
}

// ============================================================================
// Spec 2026-01-01: Square-Only Resize Helper Functions
// ============================================================================

/**
 * Activity kinds that require square aspect ratio during resize.
 * These are the "symbol" nodes that have fixed aspect ratios (1:1).
 */
const SYMBOL_ACTIVITY_KINDS: Set<ActivityKind> = new Set([
  'Initial',
  'Decision',
  'Merge',
  'Final',
]);

/**
 * Get the ActivityKind for a DiagramNode.
 *
 * Spec 2026-01-01 Task Group 1: Helper for resize constraint detection.
 *
 * @param node - The DiagramNode to check
 * @param metaModel - The MetaModel containing Activity entities
 * @returns The ActivityKind if node is an ACTIVITY, null otherwise
 */
export function getActivityKindForNode(
  node: DiagramNode,
  metaModel: MetaModel
): ActivityKind | null {
  // Only ACTIVITY entity types have activity_kind
  if (node.entity_type !== 'ACTIVITY') {
    return null;
  }

  // Look up the activity entity
  const activity = metaModel.entities.activities?.find(
    (a) => a.id === node.entity_id
  );

  if (!activity) {
    return null;
  }

  return activity.activity_kind || 'Action';
}

/**
 * Check if an ActivityKind requires square aspect ratio.
 *
 * Spec 2026-01-01 Task Group 1: Symbol nodes (Initial/Decision/Merge/Final)
 * must maintain square (1:1) aspect ratio during resize.
 *
 * @param activityKind - The ActivityKind to check (or null)
 * @returns true if the kind requires square resize, false otherwise
 */
export function isSymbolActivityKind(activityKind: ActivityKind | null): boolean {
  if (!activityKind) {
    return false;
  }
  return SYMBOL_ACTIVITY_KINDS.has(activityKind);
}

/**
 * Calculate square-constrained resize dimensions for Activity symbol nodes.
 *
 * Spec 2026-01-01 Task Group 1:
 * - For corner handles (TL/TR/BL/BR): use max(|dx|, |dy|) for both dimensions
 * - For edge handles (TC/BC/ML/MR): apply delta to both dimensions
 * - No minimum size constraints (allow very small symbols)
 * - Prevent negative dimensions (minimum 1x1)
 *
 * @param handle - The resize handle being dragged
 * @param originalNode - The original node state before drag
 * @param dx - Delta X from drag start
 * @param dy - Delta Y from drag start
 * @returns New { pos_x, pos_y, width, height } maintaining square aspect ratio
 */
export function calculateSquareResize(
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
// ============================================================================

/**
 * Render an Initial node - solid filled black circle
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
 * @returns ActivityNodeRenderResult with circle path data
 */
export function renderInitialNode(
  position: NodePosition,
  customWidth?: number,
  customHeight?: number
): ActivityNodeRenderResult {
  const defaults = ACTIVITY_NODE_DEFAULTS.Initial;
  const defaultDiameter = defaults.diameter || 18;

  // Use custom dimensions if provided, otherwise use default diameter
  const width = customWidth ?? defaultDiameter;
  const height = customHeight ?? defaultDiameter;

  // Circle radius = min(width, height) / 2
  const radius = Math.min(width, height) / 2;
  const { x: cx, y: cy } = position;

  // Create circle path using arc commands (same pattern as shapeRendering.ts)
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
 * Render an Action node - rounded rectangle with pill-like corners
 *
 * Specifications:
 * - Dimensions: 140x50px (default)
 * - Corner radius: 25px (pill-like)
 * - Fill: entityColors.ACTIVITY.background (green theme)
 * - Stroke: entityColors.ACTIVITY.border (green theme)
 * - Label: centered
 *
 * @param position - Center position of the node
 * @param customWidth - Optional custom width
 * @param customHeight - Optional custom height
 * @returns ActivityNodeRenderResult with rounded rectangle path data
 */
export function renderActionNode(
  position: NodePosition,
  customWidth?: number,
  customHeight?: number
): ActivityNodeRenderResult {
  const defaults = ACTIVITY_NODE_DEFAULTS.Action;
  const width = customWidth ?? defaults.width ?? 140;
  const height = customHeight ?? defaults.height ?? 50;
  const cornerRadius = defaults.cornerRadius || 25;
  const { x: cx, y: cy } = position;

  // Calculate bounds from center position
  const left = cx - width / 2;
  const top = cy - height / 2;
  const right = cx + width / 2;
  const bottom = cy + height / 2;

  // Limit corner radius to half of the smallest dimension
  const rx = Math.min(cornerRadius, width / 2, height / 2);
  const ry = rx;

  // Create rounded rectangle path
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
 * Render a Decision node - diamond shape
 *
 * Spec 2026-01-01: Diamond polygon fills node bounds using formula:
 * points = [(w/2,0), (w,h/2), (w/2,h), (0,h/2)]
 *
 * Specifications:
 * - Dimensions: 60x60px (default)
 * - Fill: white (#FFFFFF)
 * - Stroke: black (#000000)
 * - Label: optional (centered or below via LabelDecoration)
 *
 * @param position - Center position of the node
 * @param customWidth - Optional custom width from node bounds
 * @param customHeight - Optional custom height from node bounds
 * @returns ActivityNodeRenderResult with diamond path data
 */
export function renderDecisionNode(
  position: NodePosition,
  customWidth?: number,
  customHeight?: number
): ActivityNodeRenderResult {
  const defaults = ACTIVITY_NODE_DEFAULTS.Decision;
  const width = customWidth ?? defaults.width ?? 60;
  const height = customHeight ?? defaults.height ?? 60;
  const { x: cx, y: cy } = position;

  // Calculate vertex positions (midpoints of each edge of bounding box)
  // Diamond polygon formula: [(w/2,0), (w,h/2), (w/2,h), (0,h/2)]
  // Translated to center position:
  const top = { x: cx, y: cy - height / 2 };      // (w/2, 0) -> (cx, cy - h/2)
  const right = { x: cx + width / 2, y: cy };     // (w, h/2) -> (cx + w/2, cy)
  const bottom = { x: cx, y: cy + height / 2 };   // (w/2, h) -> (cx, cy + h/2)
  const left = { x: cx - width / 2, y: cy };      // (0, h/2) -> (cx - w/2, cy)

  // Create diamond path (same pattern as shapeRendering.ts renderDiamond)
  const pathData = `M ${top.x} ${top.y} ` +
    `L ${right.x} ${right.y} ` +
    `L ${bottom.x} ${bottom.y} ` +
    `L ${left.x} ${left.y} Z`;

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
 * Render a Merge node - diamond shape (smaller than Decision)
 *
 * Spec 2026-01-01: Same diamond formula as Decision but with smaller default size.
 *
 * Specifications:
 * - Dimensions: 20x20px (significantly smaller than Decision at 60x60)
 * - Fill: white (#FFFFFF)
 * - Stroke: black (#000000)
 * - No label by default
 *
 * @param position - Center position of the node
 * @param customWidth - Optional custom width from node bounds
 * @param customHeight - Optional custom height from node bounds
 * @returns ActivityNodeRenderResult with diamond path data
 */
export function renderMergeNode(
  position: NodePosition,
  customWidth?: number,
  customHeight?: number
): ActivityNodeRenderResult {
  const defaults = ACTIVITY_NODE_DEFAULTS.Merge;
  const width = customWidth ?? defaults.width ?? 20;
  const height = customHeight ?? defaults.height ?? 20;
  const { x: cx, y: cy } = position;

  // Calculate vertex positions (midpoints of each edge of bounding box)
  const top = { x: cx, y: cy - height / 2 };
  const right = { x: cx + width / 2, y: cy };
  const bottom = { x: cx, y: cy + height / 2 };
  const left = { x: cx - width / 2, y: cy };

  // Create diamond path
  const pathData = `M ${top.x} ${top.y} ` +
    `L ${right.x} ${right.y} ` +
    `L ${bottom.x} ${bottom.y} ` +
    `L ${left.x} ${left.y} Z`;

  return {
    pathData,
    fill: defaults.fill,
    stroke: defaults.stroke,
    strokeWidth: defaults.stroke_width,
    strokeDasharray: '',
    textPosition: { x: cx, y: cy },
    showLabel: false,
    width,
    height,
  };
}

/**
 * Render a Final node - bullseye shape (outer circle stroke + inner filled circle)
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
 * @returns ActivityNodeRenderResult with bullseye path data
 */
export function renderFinalNode(
  position: NodePosition,
  customWidth?: number,
  customHeight?: number
): ActivityNodeRenderResult {
  const defaults = ACTIVITY_NODE_DEFAULTS.Final;
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
    outerDiameter: outerRadius * 2,
    innerDiameter: innerRadius * 2,
    outerPathData,
    innerPathData,
  };
}

/**
 * Main dispatcher function to render any activity node type
 * Routes to appropriate rendering function based on activity.activity_kind
 *
 * Spec 2026-01-01: Now accepts optional width/height to pass to shape functions.
 *
 * Backward compatibility: Defaults to Action node if activityKind is missing
 *
 * @param activity - The Activity entity to render
 * @param position - Center position of the node
 * @param customWidth - Optional custom width from node bounds
 * @param customHeight - Optional custom height from node bounds
 * @returns ActivityNodeRenderResult for the appropriate node type
 */
export function renderActivityNode(
  activity: Activity,
  position: NodePosition,
  customWidth?: number,
  customHeight?: number
): ActivityNodeRenderResult {
  // Get activity kind, defaulting to 'Action' for backward compatibility
  const activityKind: ActivityKind = activity.activity_kind || 'Action';

  switch (activityKind) {
    case 'Initial':
      return renderInitialNode(position, customWidth, customHeight);
    case 'Action':
      return renderActionNode(position, customWidth, customHeight);
    case 'Decision':
      return renderDecisionNode(position, customWidth, customHeight);
    case 'Merge':
      return renderMergeNode(position, customWidth, customHeight);
    case 'Final':
      return renderFinalNode(position, customWidth, customHeight);
    default:
      // Fallback to Action node for unknown kinds
      return renderActionNode(position, customWidth, customHeight);
  }
}

// ============================================================================
// Task Group 3: Flow Boundary Anchoring Helper Functions
// ============================================================================

/**
 * Convert a DiagramNode to a Rect for geometry calculations
 */
function nodeToRect(node: DiagramNode): Rect {
  return {
    x: node.pos_x,
    y: node.pos_y,
    width: node.width,
    height: node.height,
  };
}

/**
 * Calculate boundary anchor points for activity flow edge rendering.
 *
 * Task Group 3: A2 - Flow arrows connect at shape boundaries, not centers.
 *
 * @param sourceNode - The source activity DiagramNode
 * @param targetNode - The target activity DiagramNode
 * @param sourceActivityKind - The activity kind of the source activity
 * @param targetActivityKind - The activity kind of the target activity
 * @returns Object with source and target boundary points
 */
export function calculateFlowBoundaryPoints(
  sourceNode: DiagramNode,
  targetNode: DiagramNode,
  sourceActivityKind?: ActivityKind,
  targetActivityKind?: ActivityKind
): { source: NodePosition; target: NodePosition } {
  // Convert nodes to rectangles
  const sourceRect = nodeToRect(sourceNode);
  const targetRect = nodeToRect(targetNode);

  // Determine shape kinds
  const sourceShapeKind = sourceActivityKind
    ? getShapeKindFromActivityKind(sourceActivityKind)
    : ShapeKind.RoundedRect;
  const targetShapeKind = targetActivityKind
    ? getShapeKindFromActivityKind(targetActivityKind)
    : ShapeKind.RoundedRect;

  // Calculate boundary anchor points
  const sourceBoundary = getBoundaryAnchorPoint(sourceRect, targetRect, sourceShapeKind);
  const targetBoundary = getBoundaryAnchorPoint(targetRect, sourceRect, targetShapeKind);

  return {
    source: sourceBoundary,
    target: targetBoundary,
  };
}

// ============================================================================
// Task Group 4: Activity Flow Edge Rendering Functions
// ============================================================================

/**
 * Calculate the midpoint position for activity flow label placement
 *
 * @param sourcePosition - Source activity center position
 * @param targetPosition - Target activity center position
 * @returns Position at the midpoint of the edge
 */
export function calculateFlowLabelPosition(
  sourcePosition: NodePosition,
  targetPosition: NodePosition
): NodePosition {
  return {
    x: (sourcePosition.x + targetPosition.x) / 2,
    y: (sourcePosition.y + targetPosition.y) / 2,
  };
}

/**
 * Render an activity flow edge between two activities
 *
 * Task Group 4: Activity Flow Edge Component
 *
 * Specifications:
 * - Render as straight line connecting source and target activity nodes
 * - Arrowhead points to target activity
 * - Optional label at midpoint if flow has condition or trigger text
 * - Control flow: solid line
 * - Data flow: dashed line
 *
 * @param sourcePosition - Source activity center position
 * @param targetPosition - Target activity center position
 * @param flowKind - Type of flow (Control or Data)
 * @param labelText - Optional label text (condition/trigger)
 * @returns ActivityFlowRenderResult with line and arrowhead path data
 */
export function renderActivityFlow(
  sourcePosition: NodePosition,
  targetPosition: NodePosition,
  flowKind: ActivityFlowKind,
  labelText?: string
): ActivityFlowRenderResult {
  const defaults = ACTIVITY_FLOW_DEFAULTS;

  // Calculate arrowhead using existing utility from rendering.ts
  const arrowheadPath = calculateArrowhead(
    sourcePosition.x,
    sourcePosition.y,
    targetPosition.x,
    targetPosition.y,
    defaults.arrow_size
  );

  // Create line path from source to target
  const linePath = `M ${sourcePosition.x} ${sourcePosition.y} L ${targetPosition.x} ${targetPosition.y}`;

  // Determine stroke dasharray based on flow kind
  // Control flow: solid line (empty string)
  // Data flow: dashed line
  const strokeDasharray = flowKind === 'Data' ? '6,4' : '';

  // Calculate label position at midpoint
  const labelPosition = labelText ? calculateFlowLabelPosition(sourcePosition, targetPosition) : undefined;

  return {
    linePath,
    arrowheadPath,
    strokeColor: defaults.line_color,
    strokeWidth: defaults.line_width,
    strokeDasharray,
    arrowheadFill: defaults.line_color,
    labelPosition,
    labelText,
    labelFontSize: defaults.label_font_size,
    labelOffset: defaults.label_offset,
  };
}

/**
 * Render an activity flow edge using boundary anchor points.
 *
 * Task Group 3: A2 - Flow Boundary Anchoring
 *
 * This function calculates boundary anchor points for the source and target
 * nodes based on their activity kinds, ensuring that flow arrows connect
 * at shape boundaries rather than centers.
 *
 * Specifications:
 * - Flow arrows connect at shape boundaries, not centers
 * - Arrowhead orientation preserved based on final edge direction vector
 * - Control flow: solid line
 * - Data flow: dashed line
 *
 * @param sourceNode - The source activity DiagramNode
 * @param targetNode - The target activity DiagramNode
 * @param flowKind - Type of flow (Control or Data)
 * @param sourceActivityKind - The activity kind of the source activity
 * @param targetActivityKind - The activity kind of the target activity
 * @param labelText - Optional label text (condition/trigger)
 * @returns ActivityFlowRenderResult with line and arrowhead path data
 */
export function renderActivityFlowWithBoundary(
  sourceNode: DiagramNode,
  targetNode: DiagramNode,
  flowKind: ActivityFlowKind,
  sourceActivityKind?: ActivityKind,
  targetActivityKind?: ActivityKind,
  labelText?: string
): ActivityFlowRenderResult {
  // Calculate boundary anchor points (Task Group 3: A2)
  const boundaryPoints = calculateFlowBoundaryPoints(
    sourceNode,
    targetNode,
    sourceActivityKind,
    targetActivityKind
  );

  // Use the boundary points for rendering
  return renderActivityFlow(
    boundaryPoints.source,
    boundaryPoints.target,
    flowKind,
    labelText
  );
}

// ============================================================================
// Task Group 5: Label Position Calculators (A5 - Movable/Resizable Labels)
// ============================================================================

/**
 * Calculate default label position for an Activity node.
 *
 * Task Group 5: A5 - Movable/Resizable Labels
 *
 * Label placement rules by activity kind:
 * - Action: Centered inside the rounded-rect bounds
 * - Decision: Below the diamond, center aligned (y = diamondBottom + 8px)
 * - Initial, Merge, Final: No label by default (returns center position anyway)
 *
 * @param bounds - The bounding box of the activity node {x, y, width, height}
 * @param activityKind - The kind of activity ('Initial', 'Action', 'Decision', 'Merge', 'Final')
 * @returns LabelPositionResult with x, y, width, height
 */
export function getDefaultLabelPosition(
  bounds: NodeBounds,
  activityKind: ActivityKind
): LabelPositionResult {
  const defaultWidth = LABEL_DECORATION_DEFAULTS.width;
  const defaultHeight = LABEL_DECORATION_DEFAULTS.height;
  const decisionLabelOffset = LABEL_DECORATION_DEFAULTS.decisionLabelOffset;

  // Calculate center of the node bounds
  const nodeCenterX = bounds.x + bounds.width / 2;
  const nodeCenterY = bounds.y + bounds.height / 2;

  // Default: label centered inside the node
  let labelX = nodeCenterX - defaultWidth / 2;
  let labelY = nodeCenterY - defaultHeight / 2;
  let labelWidth: number = defaultWidth;
  let labelHeight: number = defaultHeight;

  switch (activityKind) {
    case 'Action':
      // Action: Centered inside the rounded-rect bounds
      // Label width constrained to node width with padding
      labelWidth = Math.min(defaultWidth, bounds.width - 10);
      labelX = nodeCenterX - labelWidth / 2;
      labelY = nodeCenterY - defaultHeight / 2;
      break;

    case 'Decision':
      // Decision: Below the diamond, center aligned
      // y = diamondBottom + offset
      const diamondBottom = bounds.y + bounds.height;
      labelX = nodeCenterX - defaultWidth / 2;
      labelY = diamondBottom + decisionLabelOffset;
      break;

    case 'Initial':
    case 'Merge':
    case 'Final':
      // These nodes don't show labels by default, but return center position
      // in case a label is explicitly created
      labelX = nodeCenterX - defaultWidth / 2;
      labelY = nodeCenterY - defaultHeight / 2;
      break;

    default:
      // Default fallback: center position
      labelX = nodeCenterX - defaultWidth / 2;
      labelY = nodeCenterY - defaultHeight / 2;
      break;
  }

  return {
    x: labelX,
    y: labelY,
    width: labelWidth,
    height: labelHeight,
  };
}

/**
 * Calculate default label position for an Activity Flow edge.
 *
 * Task Group 5: A5 - Movable/Resizable Labels
 *
 * Label is positioned near the edge midpoint, slightly above the line.
 *
 * @param sourceNode - The source activity DiagramNode
 * @param targetNode - The target activity DiagramNode
 * @returns LabelPositionResult with x, y, width, height
 */
export function getDefaultEdgeLabelPosition(
  sourceNode: DiagramNode,
  targetNode: DiagramNode
): LabelPositionResult {
  const defaultWidth = LABEL_DECORATION_DEFAULTS.width;
  const defaultHeight = LABEL_DECORATION_DEFAULTS.height;
  const edgeLabelOffset = LABEL_DECORATION_DEFAULTS.edgeLabelOffset;

  // Calculate center points of source and target nodes
  const sourceCenterX = sourceNode.pos_x + sourceNode.width / 2;
  const sourceCenterY = sourceNode.pos_y + sourceNode.height / 2;
  const targetCenterX = targetNode.pos_x + targetNode.width / 2;
  const targetCenterY = targetNode.pos_y + targetNode.height / 2;

  // Calculate midpoint of the edge
  const midpointX = (sourceCenterX + targetCenterX) / 2;
  const midpointY = (sourceCenterY + targetCenterY) / 2;

  // Calculate label position: centered horizontally, slightly above the midpoint
  // The label's bottom should be at or above the midpoint
  const labelX = midpointX - defaultWidth / 2;
  const labelY = midpointY - defaultHeight - edgeLabelOffset;

  return {
    x: labelX,
    y: labelY,
    width: defaultWidth,
    height: defaultHeight,
  };
}

// ============================================================================
// Task Group 4: Decision Label Decoration Helper (Spec 2026-01-01)
// ============================================================================

/**
 * Create a LabelDecoration for a Decision node.
 *
 * Spec 2026-01-01 (C): Decision labels as DiagramDecoration
 *
 * Creates a LabelDecoration positioned below the diamond shape with:
 * - targetKind: 'NODE'
 * - targetId: node.id
 * - Position: y = node.pos_y + node.height + 8
 *
 * @param nodeId - The ID of the Decision node
 * @param nodePosX - The X position of the node (top-left)
 * @param nodePosY - The Y position of the node (top-left)
 * @param nodeWidth - The width of the node
 * @param nodeHeight - The height of the node
 * @param text - The label text (usually activity name)
 * @returns A new LabelDecoration for the Decision node
 */
export function createDecisionLabelDecoration(
  nodeId: string,
  nodePosX: number,
  nodePosY: number,
  nodeWidth: number,
  nodeHeight: number,
  text: string
): LabelDecoration {
  const defaultWidth = LABEL_DECORATION_DEFAULTS.width;
  const defaultHeight = LABEL_DECORATION_DEFAULTS.height;
  const decisionLabelOffset = LABEL_DECORATION_DEFAULTS.decisionLabelOffset;

  // Calculate center X of the node
  const nodeCenterX = nodePosX + nodeWidth / 2;

  // Position: below the diamond, center aligned
  const labelX = nodeCenterX - defaultWidth / 2;
  const labelY = nodePosY + nodeHeight + decisionLabelOffset;

  return createDefaultLabelDecoration(
    'NODE',
    nodeId,
    labelX,
    labelY,
    defaultWidth,
    defaultHeight,
    text
  );
}

/**
 * Calculate default ActivityFlow edge label position for edge.label_pos_x/y.
 *
 * Spec 2026-01-01 (D): Default label position at edge midpoint with -8px y offset.
 *
 * @param sourceNode - The source activity DiagramNode
 * @param targetNode - The target activity DiagramNode
 * @param sourceActivityKind - Optional source activity kind for boundary calculation
 * @param targetActivityKind - Optional target activity kind for boundary calculation
 * @returns Object with x and y for edge.label_pos_x and edge.label_pos_y
 */
export function calculateDefaultActivityFlowLabelPosition(
  sourceNode: DiagramNode,
  targetNode: DiagramNode,
  sourceActivityKind?: ActivityKind,
  targetActivityKind?: ActivityKind
): { x: number; y: number } {
  // Calculate boundary points for accurate midpoint
  const boundaryPoints = calculateFlowBoundaryPoints(
    sourceNode,
    targetNode,
    sourceActivityKind,
    targetActivityKind
  );

  // Calculate midpoint of boundary-anchored edge
  const midpointX = (boundaryPoints.source.x + boundaryPoints.target.x) / 2;
  const midpointY = (boundaryPoints.source.y + boundaryPoints.target.y) / 2;

  // Default label position: midpoint with -8px y offset (above the line)
  return {
    x: midpointX,
    y: midpointY - 8,
  };
}
