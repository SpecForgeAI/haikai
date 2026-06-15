/**
 * User Interaction Edge Rendering Utilities
 *
 * Task Group 4: Edge Rendering and Label Handling
 *
 * This module provides utilities for rendering USER_INTERACTION edges:
 * - Determining if an edge is a USER_INTERACTION edge
 * - Getting stroke style for dotted line rendering
 * - Calculating USER_LINK midpoint targets
 * - Visual distinction for MAIN vs USER_LINK edges
 *
 * USER_INTERACTION edges render as dotted lines:
 * - MAIN edge: Primary dotted line connecting App_Business_Point nodes
 * - USER_LINK edge: Secondary dotted line from User node to MAIN edge midpoint
 */

import {
  DiagramEdge,
  DiagramNode,
  RELATIONSHIP_EDGE_TYPES,
  LINE_DASHES_DOTTED,
} from '../types/model';
import { Point } from './userInteractionUtils';

// ============================================================================
// Constants for User Interaction Edge Styling
// ============================================================================

/**
 * Default stroke color for USER_INTERACTION edges
 * Purple color to visually distinguish from other relationship edges
 */
export const USER_INTERACTION_STROKE_COLOR = '#8E44AD';

/**
 * Default stroke width for USER_INTERACTION edges
 */
export const USER_INTERACTION_STROKE_WIDTH = 1.5;

/**
 * Opacity for USER_LINK edges (slightly lower for visual hierarchy)
 * MAIN edge is primary, USER_LINK is secondary
 */
export const USER_LINK_OPACITY = 0.75;

/**
 * Opacity for MAIN edges
 */
export const MAIN_EDGE_OPACITY = 1.0;

// ============================================================================
// Edge Type Identification
// ============================================================================

/**
 * Check if an edge is a USER_INTERACTION edge.
 *
 * @param edge - The DiagramEdge to check
 * @returns true if the edge is a USER_INTERACTION edge
 */
export function isUserInteractionEdge(edge: DiagramEdge): boolean {
  return edge.relationship_type === RELATIONSHIP_EDGE_TYPES.USER_INTERACTION;
}

/**
 * Check if an edge is a MAIN USER_INTERACTION edge.
 *
 * @param edge - The DiagramEdge to check
 * @returns true if the edge is a MAIN USER_INTERACTION edge
 */
export function isMainInteractionEdge(edge: DiagramEdge): boolean {
  return isUserInteractionEdge(edge) && edge.subType === 'MAIN';
}

/**
 * Check if an edge is a USER_LINK USER_INTERACTION edge.
 *
 * @param edge - The DiagramEdge to check
 * @returns true if the edge is a USER_LINK USER_INTERACTION edge
 */
export function isUserLinkEdge(edge: DiagramEdge): boolean {
  return isUserInteractionEdge(edge) && edge.subType === 'USER_LINK';
}

// ============================================================================
// Edge Styling
// ============================================================================

/**
 * Style information for rendering USER_INTERACTION edges
 */
export interface UserInteractionEdgeStyle {
  /** SVG stroke-dasharray value for dotted line */
  strokeDasharray: string;
  /** Whether the edge is dotted */
  isDotted: boolean;
  /** Stroke color */
  strokeColor: string;
  /** Stroke width */
  strokeWidth: number;
  /** Opacity (0-1) */
  opacity: number;
}

/**
 * Get the rendering style for a USER_INTERACTION edge.
 *
 * Returns style information including:
 * - strokeDasharray for dotted line
 * - strokeColor for the edge line
 * - strokeWidth for line thickness
 * - opacity for visual hierarchy (MAIN vs USER_LINK)
 *
 * @param edge - The DiagramEdge to get style for
 * @returns Style object for rendering
 */
export function getUserInteractionEdgeStyle(edge: DiagramEdge): UserInteractionEdgeStyle {
  if (!isUserInteractionEdge(edge)) {
    // Return default solid style for non-USER_INTERACTION edges
    return {
      strokeDasharray: '',
      isDotted: false,
      strokeColor: edge.line_color || '#616161',
      strokeWidth: 1.5,
      opacity: 1.0,
    };
  }

  // Determine opacity based on subType
  const isUserLink = edge.subType === 'USER_LINK';
  const opacity = isUserLink ? USER_LINK_OPACITY : MAIN_EDGE_OPACITY;

  // Use stored line_dashes or default to dotted
  const strokeDasharray = edge.line_dashes || LINE_DASHES_DOTTED;

  return {
    strokeDasharray,
    isDotted: true,
    strokeColor: edge.line_color || USER_INTERACTION_STROKE_COLOR,
    strokeWidth: edge.line_weight ? parseFloat(edge.line_weight) : USER_INTERACTION_STROKE_WIDTH,
    opacity,
  };
}

// ============================================================================
// Midpoint Calculation for USER_LINK Edges
// ============================================================================

/**
 * Calculate the target position for a USER_LINK edge.
 *
 * USER_LINK edges connect from the User node to the midpoint of the MAIN edge.
 * This function calculates that midpoint based on the MAIN edge's source and
 * target positions.
 *
 * @param mainEdgeStart - Start position of the MAIN edge (primary node center)
 * @param mainEdgeEnd - End position of the MAIN edge (secondary node center)
 * @returns The midpoint position for USER_LINK target
 */
export function calculateUserLinkMidpointTarget(
  mainEdgeStart: Point,
  mainEdgeEnd: Point
): Point {
  return {
    x: (mainEdgeStart.x + mainEdgeEnd.x) / 2,
    y: (mainEdgeStart.y + mainEdgeEnd.y) / 2,
  };
}

/**
 * Get the node center position for edge endpoint calculation.
 *
 * @param node - The DiagramNode to get center for
 * @returns The center point of the node
 */
export function getNodeCenter(node: DiagramNode): Point {
  return {
    x: node.pos_x + node.width / 2,
    y: node.pos_y + node.height / 2,
  };
}

/**
 * Find the MAIN edge for a given interaction ID.
 *
 * @param interactionId - The interaction ID to find MAIN edge for
 * @param edges - Array of all diagram edges
 * @returns The MAIN edge if found, null otherwise
 */
export function findMainEdgeForInteraction(
  interactionId: string,
  edges: DiagramEdge[]
): DiagramEdge | null {
  return edges.find(
    edge =>
      edge.relationship_type === RELATIONSHIP_EDGE_TYPES.USER_INTERACTION &&
      edge.relationship_id === interactionId &&
      edge.subType === 'MAIN'
  ) || null;
}

/**
 * Find the USER_LINK edge for a given interaction ID.
 *
 * @param interactionId - The interaction ID to find USER_LINK edge for
 * @param edges - Array of all diagram edges
 * @returns The USER_LINK edge if found, null otherwise
 */
export function findUserLinkEdgeForInteraction(
  interactionId: string,
  edges: DiagramEdge[]
): DiagramEdge | null {
  return edges.find(
    edge =>
      edge.relationship_type === RELATIONSHIP_EDGE_TYPES.USER_INTERACTION &&
      edge.relationship_id === interactionId &&
      edge.subType === 'USER_LINK'
  ) || null;
}

/**
 * Calculate the dynamic midpoint for a USER_LINK edge based on the MAIN edge.
 *
 * This is used when rendering to ensure the USER_LINK endpoint follows
 * the MAIN edge midpoint even when nodes are moved.
 *
 * @param interactionId - The interaction ID
 * @param edges - Array of all diagram edges
 * @returns The midpoint position if MAIN edge exists, null otherwise
 */
export function getDynamicUserLinkMidpoint(
  interactionId: string,
  edges: DiagramEdge[]
): Point | null {
  const mainEdge = findMainEdgeForInteraction(interactionId, edges);
  if (!mainEdge || mainEdge.edge_points.length < 2) {
    return null;
  }

  const startPoint = mainEdge.edge_points[0];
  const endPoint = mainEdge.edge_points[mainEdge.edge_points.length - 1];

  return calculateUserLinkMidpointTarget(
    { x: startPoint.pos_x, y: startPoint.pos_y },
    { x: endPoint.pos_x, y: endPoint.pos_y }
  );
}

// ============================================================================
// Label Position Handling
// ============================================================================

/**
 * Get the label position for a USER_INTERACTION edge.
 *
 * Returns the stored label position if available, otherwise returns null.
 *
 * @param edge - The DiagramEdge to get label position for
 * @returns The label position { x, y } or null if not available
 */
export function getInteractionEdgeLabelPosition(
  edge: DiagramEdge
): Point | null {
  if (edge.label_pos_x !== undefined && edge.label_pos_y !== undefined) {
    return {
      x: edge.label_pos_x,
      y: edge.label_pos_y,
    };
  }
  return null;
}

/**
 * Calculate new label position after drag.
 *
 * @param originalPosition - Original label position
 * @param deltaX - Horizontal drag distance
 * @param deltaY - Vertical drag distance
 * @returns New label position
 */
export function calculateDraggedLabelPosition(
  originalPosition: Point,
  deltaX: number,
  deltaY: number
): Point {
  return {
    x: originalPosition.x + deltaX,
    y: originalPosition.y + deltaY,
  };
}

// ============================================================================
// Edge Rendering Helpers
// ============================================================================

/**
 * Check if an edge should be rendered as a USER_INTERACTION dotted line.
 *
 * This is the primary check used by Canvas.tsx to determine if special
 * rendering logic should be applied.
 *
 * @param edge - The edge to check
 * @returns true if the edge should use USER_INTERACTION rendering
 */
export function shouldRenderAsUserInteractionEdge(edge: DiagramEdge): boolean {
  return (
    edge.relationship_type === RELATIONSHIP_EDGE_TYPES.USER_INTERACTION &&
    (edge.subType === 'MAIN' || edge.subType === 'USER_LINK')
  );
}

/**
 * Get the display points for a USER_LINK edge, with dynamic midpoint calculation.
 *
 * For USER_LINK edges, the target endpoint should be calculated dynamically
 * based on the current MAIN edge positions, not stored statically.
 *
 * Note: The `nodes` parameter is reserved for future use but currently
 * the midpoint is calculated from MAIN edge points rather than node positions.
 *
 * @param userLinkEdge - The USER_LINK edge
 * @param allEdges - All diagram edges (to find MAIN edge)
 * @param _nodes - All diagram nodes (reserved for future use)
 * @returns Array of display points with dynamic midpoint
 */
export function getUserLinkDisplayPoints(
  userLinkEdge: DiagramEdge,
  allEdges: DiagramEdge[],
  _nodes: DiagramNode[]
): Array<{ x: number; y: number }> {
  if (!isUserLinkEdge(userLinkEdge)) {
    // Return stored edge points for non-USER_LINK edges
    return userLinkEdge.edge_points.map(p => ({ x: p.pos_x, y: p.pos_y }));
  }

  // Get the interaction ID from the edge
  const interactionId = userLinkEdge.relationship_id;

  // Find the MAIN edge for dynamic midpoint calculation
  const mainEdge = findMainEdgeForInteraction(interactionId, allEdges);

  if (!mainEdge || mainEdge.edge_points.length < 2) {
    // Fallback to stored points if MAIN edge not found
    return userLinkEdge.edge_points.map(p => ({ x: p.pos_x, y: p.pos_y }));
  }

  // Calculate dynamic midpoint from MAIN edge
  const mainStart = mainEdge.edge_points[0];
  const mainEnd = mainEdge.edge_points[mainEdge.edge_points.length - 1];
  const midpoint = calculateUserLinkMidpointTarget(
    { x: mainStart.pos_x, y: mainStart.pos_y },
    { x: mainEnd.pos_x, y: mainEnd.pos_y }
  );

  // Return points: source from stored, target from calculated midpoint
  if (userLinkEdge.edge_points.length >= 1) {
    const sourcePoint = userLinkEdge.edge_points[0];
    return [
      { x: sourcePoint.pos_x, y: sourcePoint.pos_y },
      { x: midpoint.x, y: midpoint.y },
    ];
  }

  return [{ x: midpoint.x, y: midpoint.y }];
}
