/**
 * Interaction Rendering Utilities
 *
 * Phase 3: Diagram Rendering (Task Group 5)
 * Utility functions for rendering user interaction dotted lines on diagrams.
 *
 * These utilities calculate positions and paths for:
 * - Dotted lines between primary and secondary App_Business_Point nodes
 * - User-to-midpoint lines when both points are present
 * - User-to-primary lines when only one point is present
 *
 * Task Group 6: Added calculateDefaultLabelPosition for edge label positioning
 */

import { DiagramNode, DiagramUserInteraction, Diagram } from '../types/model';

// ============================================================================
// Position Types
// ============================================================================

/**
 * A simple 2D point
 */
export interface Point {
  x: number;
  y: number;
}

/**
 * Result of calculating interaction line paths
 */
export interface InteractionLinePaths {
  /** Line between primary and secondary nodes (if secondary exists) */
  primaryToSecondaryLine: { start: Point; end: Point } | null;
  /** Line from user node to midpoint (if both primary and secondary exist) or to primary (if only primary exists) */
  userToTargetLine: { start: Point; end: Point } | null;
}

// ============================================================================
// Core Calculation Functions
// ============================================================================

/**
 * Calculate the center point of a node
 *
 * @param node - The diagram node
 * @returns The center point {x, y} of the node
 */
export function getNodeCenter(node: DiagramNode): Point {
  return {
    x: node.pos_x + node.width / 2,
    y: node.pos_y + node.height / 2,
  };
}

/**
 * Calculate the midpoint between two positions
 *
 * @param pos1 - First position
 * @param pos2 - Second position
 * @returns The midpoint {x, y} between the two positions
 */
export function calculateMidpoint(pos1: Point, pos2: Point): Point {
  return {
    x: (pos1.x + pos2.x) / 2,
    y: (pos1.y + pos2.y) / 2,
  };
}

/**
 * Task Group 6.7: Calculate the default label position for a new interaction edge
 *
 * Returns the midpoint of the main edge segment, which is the default
 * position for the interaction label.
 *
 * @param source - Source point (start of edge)
 * @param target - Target point (end of edge)
 * @returns The default label position {x, y}
 */
export function calculateDefaultLabelPosition(source: Point, target: Point): Point {
  return calculateMidpoint(source, target);
}

/**
 * Calculate the line path from user node to target point
 *
 * @param userNodePosition - Center position of the user node
 * @param targetPoint - Target point (midpoint or primary node center)
 * @returns Line path with start and end points
 */
export function calculateUserToMidpointLine(
  userNodePosition: Point,
  targetPoint: Point
): { start: Point; end: Point } {
  return {
    start: userNodePosition,
    end: targetPoint,
  };
}

/**
 * Calculate the primary interaction line path
 *
 * Case 1: Two points - line between primary and secondary node centers
 * Case 2: One point - no primary line (user connects directly to primary)
 *
 * @param primaryNodePosition - Center position of the primary App_Business_Point node
 * @param secondaryNodePosition - Center position of the secondary App_Business_Point node (optional)
 * @returns Line path with start and end points, or null if no secondary node
 */
export function calculateInteractionLinePath(
  primaryNodePosition: Point,
  secondaryNodePosition?: Point
): { start: Point; end: Point } | null {
  if (!secondaryNodePosition) {
    // Case 2: Only primary point - no primary line needed
    return null;
  }

  // Case 1: Two points - line between primary and secondary
  return {
    start: primaryNodePosition,
    end: secondaryNodePosition,
  };
}

// ============================================================================
// Diagram-Level Functions
// ============================================================================

/**
 * Find a diagram node by ID
 *
 * @param nodeId - The node ID to find
 * @param nodes - Array of diagram nodes
 * @returns The node if found, null otherwise
 */
export function findNodeById(nodeId: string, nodes: DiagramNode[]): DiagramNode | null {
  return nodes.find(n => n.id === nodeId) || null;
}

/**
 * Calculate all line paths for a user interaction
 *
 * Handles both cases:
 * - Case 1 (Two App_Business_Points): Dotted line between primary and secondary, user to midpoint
 * - Case 2 (One App_Business_Point): Dotted line from user to primary
 *
 * @param interaction - The DiagramUserInteraction to calculate paths for
 * @param nodes - Array of diagram nodes
 * @returns InteractionLinePaths with calculated line paths, or null values if nodes are missing
 */
export function calculateInteractionPaths(
  interaction: DiagramUserInteraction,
  nodes: DiagramNode[]
): InteractionLinePaths {
  const result: InteractionLinePaths = {
    primaryToSecondaryLine: null,
    userToTargetLine: null,
  };

  // Find the primary node (required)
  const primaryNode = findNodeById(interaction.primary_node_id, nodes);
  if (!primaryNode) {
    // Primary node not on diagram - cannot render any lines
    console.warn(`Interaction ${interaction.id}: Primary node ${interaction.primary_node_id} not found on diagram`);
    return result;
  }

  const primaryCenter = getNodeCenter(primaryNode);

  // Find secondary node (optional)
  const secondaryNode = interaction.secondary_node_id
    ? findNodeById(interaction.secondary_node_id, nodes)
    : null;

  // Find user node (optional)
  const userNode = interaction.user_node_id
    ? findNodeById(interaction.user_node_id, nodes)
    : null;

  if (secondaryNode) {
    // Case 1: Two App_Business_Points
    const secondaryCenter = getNodeCenter(secondaryNode);

    // Primary-to-secondary line
    result.primaryToSecondaryLine = calculateInteractionLinePath(primaryCenter, secondaryCenter);

    // User-to-midpoint line (if user is on diagram)
    if (userNode) {
      const userCenter = getNodeCenter(userNode);
      const midpoint = calculateMidpoint(primaryCenter, secondaryCenter);
      result.userToTargetLine = calculateUserToMidpointLine(userCenter, midpoint);
    }
  } else {
    // Case 2: Only primary App_Business_Point
    // User-to-primary line (if user is on diagram)
    if (userNode) {
      const userCenter = getNodeCenter(userNode);
      result.userToTargetLine = calculateUserToMidpointLine(userCenter, primaryCenter);
    }
  }

  return result;
}

/**
 * Get all interaction paths for a diagram
 *
 * @param diagram - The diagram containing user_interactions
 * @returns Array of objects containing interaction and calculated paths
 */
export function getAllInteractionPaths(
  diagram: Diagram
): Array<{ interaction: DiagramUserInteraction; paths: InteractionLinePaths }> {
  const userInteractions = diagram.user_interactions || [];

  return userInteractions.map(interaction => ({
    interaction,
    paths: calculateInteractionPaths(interaction, diagram.diagram_nodes),
  }));
}

// ============================================================================
// SVG Path Generation Helpers
// ============================================================================

/**
 * Generate an SVG path string for a straight line
 *
 * @param start - Start point
 * @param end - End point
 * @returns SVG path d attribute string
 */
export function generateLinePath(start: Point, end: Point): string {
  return `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
}

/**
 * Get the stroke-dasharray value for dotted or solid line style
 *
 * @param style - Line style ('dotted' or 'solid')
 * @returns SVG stroke-dasharray value
 */
export function getStrokeDasharray(style: 'dotted' | 'solid'): string {
  if (style === 'dotted') {
    return '4,4'; // 4px dash, 4px gap for dotted style
  }
  return 'none'; // solid line
}
