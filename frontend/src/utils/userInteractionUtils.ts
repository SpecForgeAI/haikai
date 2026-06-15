/**
 * User Interaction Utilities
 *
 * Task Group 2: Enable/Disable Logic for User Interaction Rows
 * Task Group 3: Adding User Interaction Edges (Case A and Case B)
 * Task Group 5: Edge Deletion with Cascade Logic
 *
 * This module provides utilities for:
 * - Determining User Interaction case (A or B)
 * - Checking if User Interaction edges exist on diagram
 * - Enable/disable logic for RHS palette User Interaction rows
 * - Resolving AppBusinessPoint IDs to diagram node IDs
 * - Temporal validity checks for Interactions
 * - Creating User Interaction edges (MAIN and USER_LINK)
 * - Cascade deletion logic for User Interaction edges
 *
 * Case A: Interaction has both primary AND secondary App_Business_Point (P + S)
 *   - Row enabled when P and S nodes on diagram, no edges exist
 *   - User node NOT required for enablement
 *   - Creates MAIN edge between P and S
 *   - Optionally creates USER_LINK edge from User to MAIN midpoint
 *
 * Case B: Interaction has ONLY primary App_Business_Point (no secondary)
 *   - Row enabled when P and U (User) nodes on diagram, no edges exist
 *   - User node IS required for enablement
 *   - Creates MAIN edge between User and Primary
 *
 * Edge Deletion Cascade Logic:
 *   - Deleting MAIN edge cascades to delete orphaned USER_LINK with same interaction_id
 *   - Deleting USER_LINK only does NOT cascade to MAIN
 *   - After all edges deleted, RHS row becomes re-enabled
 */

import {
  Interaction,
  Diagram,
  DiagramNode,
  DiagramEdge,
  MetaModel,
  ENTITY_TYPES,
  RELATIONSHIP_EDGE_TYPES,
  LINE_DASHES_DOTTED,
} from '../types/model';
import { findNodeForEntity, calculateEdgePoints, calculateBorderAnchorPoint } from './relationshipUtils';
import { generatePrefixedId } from './idGenerator';

// ============================================================================
// Type Definitions for Edge Creation
// ============================================================================

/**
 * Point interface for position calculations
 */
export interface Point {
  x: number;
  y: number;
}

/**
 * Result of adding a User Interaction to the diagram
 */
export interface AddUserInteractionResult {
  mainEdge: DiagramEdge;
  userLinkEdge?: DiagramEdge;
}

// ============================================================================
// Task 2.3: isUserInteractionCase Helper
// ============================================================================

/**
 * Determine whether an Interaction is Case A or Case B.
 *
 * Case A: Both primary and secondary app_business_point_id are non-null
 * Case B: Only primary is non-null, secondary is null/undefined
 *
 * @param interaction - The Interaction entity to check
 * @returns 'A' for Case A, 'B' for Case B
 */
export function isUserInteractionCase(interaction: Interaction): 'A' | 'B' {
  if (
    interaction.primary_app_business_point_id &&
    interaction.secondary_app_business_point_id
  ) {
    return 'A';
  }
  return 'B';
}

// ============================================================================
// Task 2.4: getInteractionEdgesOnDiagram Helper
// ============================================================================

/**
 * Get all USER_INTERACTION edges for a specific Interaction ID on the diagram.
 *
 * Filters edges where:
 * - relationship_type === 'USER_INTERACTION'
 * - relationship_id === interactionId
 *
 * @param interactionId - The Interaction entity ID
 * @param edges - Array of DiagramEdge from the diagram
 * @returns Array of matching DiagramEdge objects (MAIN and/or USER_LINK)
 */
export function getInteractionEdgesOnDiagram(
  interactionId: string,
  edges: DiagramEdge[]
): DiagramEdge[] {
  return edges.filter(
    edge =>
      edge.relationship_type === RELATIONSHIP_EDGE_TYPES.USER_INTERACTION &&
      edge.relationship_id === interactionId
  );
}

// ============================================================================
// Task 2.7: Temporal Validity Check
// ============================================================================

/**
 * Check if an Interaction is visible at a given time T.
 *
 * An Interaction is visible if: valid_from <= T <= valid_to
 * - Null/undefined valid_from means "always valid from the beginning" (open-ended start)
 * - Null/undefined valid_to means "always valid until the end" (open-ended end)
 *
 * @param interaction - The Interaction entity to check
 * @param viewQuarter - The diagram's view_quarter (format: "YYYY-Qn", e.g., "2024-Q4")
 * @returns true if the Interaction is visible at time T
 */
export function isInteractionVisibleAtTime(
  interaction: Interaction & { valid_from?: string; valid_to?: string },
  viewQuarter: string
): boolean {
  const { valid_from, valid_to } = interaction;

  // Parse quarter strings for comparison
  // Format: "YYYY-Qn" -> numeric value for comparison
  const parseQuarter = (q: string): number => {
    const match = q.match(/^(\d{4})-Q([1-4])$/);
    if (!match) return 0;
    const year = parseInt(match[1], 10);
    const quarter = parseInt(match[2], 10);
    return year * 10 + quarter; // e.g., "2024-Q3" -> 20243
  };

  const tValue = parseQuarter(viewQuarter);

  // Check valid_from constraint (if set)
  if (valid_from) {
    const fromValue = parseQuarter(valid_from);
    if (tValue < fromValue) {
      return false;
    }
  }

  // Check valid_to constraint (if set)
  if (valid_to) {
    const toValue = parseQuarter(valid_to);
    if (tValue > toValue) {
      return false;
    }
  }

  return true;
}

// ============================================================================
// Task 2.6: getAppBusinessPointNodeId Helper
// ============================================================================

/**
 * Resolve an AppBusinessPoint ID to its corresponding diagram node ID.
 *
 * This function finds the diagram node that represents the underlying entity
 * for a given AppBusinessPoint. The search is based on the ABP's kind:
 *
 * Search priority by ABP kind:
 * - APPLICATION: Find APPLICATION node with matching source_entity_id
 * - APP_COMPONENT: Find APP_COMPONENT node with matching source_entity_id
 * - SERVICE: Find SERVICE node with matching source_entity_id
 * - INTERFACE: Find INTERFACE node with matching source_entity_id
 * - BUSINESS_PROCESS: Find BUSINESS_PROCESS node with matching source_entity_id
 * - PROCESS_ACTIVITY: Find PROCESS_ACTIVITY node with matching source_entity_id
 *
 * @param abpId - The AppBusinessPoint ID (format: "abp_{source_entity_id}")
 * @param nodes - Array of DiagramNode from the diagram
 * @param metaModel - The MetaModel for ABP lookup
 * @returns The diagram node ID if found, null otherwise
 */
export function getAppBusinessPointNodeId(
  abpId: string,
  nodes: DiagramNode[],
  metaModel: MetaModel
): string | null {
  // Find the AppBusinessPoint in the meta-model
  const abp = metaModel.entities.app_business_points?.find(
    a => a.id === abpId
  );

  if (!abp) {
    return null;
  }

  // Map ABP kind to entity type constant
  const kindToEntityType: Record<string, string> = {
    APPLICATION: ENTITY_TYPES.APPLICATION,
    APP_COMPONENT: ENTITY_TYPES.APP_COMPONENT,
    SERVICE: ENTITY_TYPES.SERVICE,
    INTERFACE: ENTITY_TYPES.INTERFACE,
    BUSINESS_PROCESS: ENTITY_TYPES.BUSINESS_PROCESS,
    PROCESS_ACTIVITY: ENTITY_TYPES.PROCESS_ACTIVITY,
  };

  const entityType = kindToEntityType[abp.kind];
  if (!entityType) {
    return null;
  }

  // Find the diagram node for this entity
  const node = findNodeForEntity(nodes, entityType, abp.source_entity_id);

  return node ? node.id : null;
}

// ============================================================================
// Task 2.5: isUserInteractionRowEnabled Function
// ============================================================================

/**
 * Determine if a User Interaction row should be enabled in the RHS palette.
 *
 * The enable/disable logic depends on the Interaction case:
 *
 * **Case A** (Both P and S AppBusinessPoints exist):
 * - Row ENABLED when:
 *   1. P (Primary ABP) node exists on diagram
 *   2. S (Secondary ABP) node exists on diagram
 *   3. NO interaction edges (MAIN or USER_LINK) for this Interaction exist
 * - User node presence is NOT required for enablement
 *
 * **Case B** (Only P AppBusinessPoint exists):
 * - Row ENABLED when:
 *   1. P (Primary ABP) node exists on diagram
 *   2. U (User) node exists on diagram
 *   3. NO interaction edges for this Interaction exist
 * - User node IS required for enablement
 *
 * @param interaction - The Interaction entity to check
 * @param diagram - The current Diagram
 * @param metaModel - The MetaModel for entity lookups
 * @returns true if the row should be enabled (clickable)
 */
export function isUserInteractionRowEnabled(
  interaction: Interaction,
  diagram: Diagram,
  metaModel: MetaModel
): boolean {
  const nodes = diagram.diagram_nodes || [];
  const edges = diagram.diagram_edges || [];

  // Check if any edges already exist for this interaction (MAIN or USER_LINK)
  const existingEdges = getInteractionEdgesOnDiagram(interaction.id, edges);
  if (existingEdges.length > 0) {
    // Edges exist -> row is disabled
    return false;
  }

  // Determine case
  const interactionCase = isUserInteractionCase(interaction);

  // Get Primary ABP node
  const primaryNodeId = getAppBusinessPointNodeId(
    interaction.primary_app_business_point_id,
    nodes,
    metaModel
  );

  if (!primaryNodeId) {
    // Primary ABP node not on diagram -> disabled
    return false;
  }

  if (interactionCase === 'A') {
    // Case A: Need P and S nodes
    const secondaryNodeId = getAppBusinessPointNodeId(
      interaction.secondary_app_business_point_id!,
      nodes,
      metaModel
    );

    if (!secondaryNodeId) {
      // Secondary ABP node not on diagram -> disabled
      return false;
    }

    // Both P and S on diagram, no edges exist -> enabled
    return true;
  } else {
    // Case B: Need P and U nodes
    // Find the User node
    const userNode = findNodeForEntity(
      nodes,
      ENTITY_TYPES.BUSINESS_USER,
      interaction.user_id
    );

    if (!userNode) {
      // User node not on diagram -> disabled
      return false;
    }

    // Both P and U on diagram, no edges exist -> enabled
    return true;
  }
}

// ============================================================================
// Additional Helper: Get User Node for Interaction
// ============================================================================

/**
 * Find the User node on the diagram for a given Interaction.
 *
 * @param interaction - The Interaction entity
 * @param nodes - Array of DiagramNode from the diagram
 * @returns The DiagramNode for the user, or null if not found
 */
export function getUserNodeForInteraction(
  interaction: Interaction,
  nodes: DiagramNode[]
): DiagramNode | null {
  const node = findNodeForEntity(
    nodes,
    ENTITY_TYPES.BUSINESS_USER,
    interaction.user_id
  );
  return node || null;
}

// ============================================================================
// Additional Helper: Get Nodes for User Interaction Visualization
// ============================================================================

/**
 * Get all relevant nodes for visualizing a User Interaction.
 *
 * For Case A:
 * - Returns { primary: P node, secondary: S node, user?: U node (optional) }
 *
 * For Case B:
 * - Returns { primary: P node, user: U node }
 *
 * @param interaction - The Interaction entity
 * @param diagram - The current Diagram
 * @param metaModel - The MetaModel for entity lookups
 * @returns Object with node references, or null if required nodes are missing
 */
export function getNodesForUserInteraction(
  interaction: Interaction,
  diagram: Diagram,
  metaModel: MetaModel
): {
  primary: DiagramNode;
  secondary?: DiagramNode;
  user?: DiagramNode;
} | null {
  const nodes = diagram.diagram_nodes || [];
  const interactionCase = isUserInteractionCase(interaction);

  // Get Primary node
  const primaryNodeId = getAppBusinessPointNodeId(
    interaction.primary_app_business_point_id,
    nodes,
    metaModel
  );
  if (!primaryNodeId) return null;

  const primaryNode = nodes.find(n => n.id === primaryNodeId);
  if (!primaryNode) return null;

  // Get User node (always look it up, may be optional in Case A)
  const userNode = findNodeForEntity(
    nodes,
    ENTITY_TYPES.BUSINESS_USER,
    interaction.user_id
  );

  if (interactionCase === 'A') {
    // Case A: Need P and S
    const secondaryNodeId = getAppBusinessPointNodeId(
      interaction.secondary_app_business_point_id!,
      nodes,
      metaModel
    );
    if (!secondaryNodeId) return null;

    const secondaryNode = nodes.find(n => n.id === secondaryNodeId);
    if (!secondaryNode) return null;

    return {
      primary: primaryNode,
      secondary: secondaryNode,
      user: userNode || undefined,
    };
  } else {
    // Case B: Need P and U
    if (!userNode) return null;

    return {
      primary: primaryNode,
      user: userNode,
    };
  }
}

// ============================================================================
// Task 3.4: calculateEdgeMidpoint Helper
// ============================================================================

/**
 * Calculate the geometric center (midpoint) between two positions.
 *
 * Used for positioning labels at the center of edges and for determining
 * the target position of USER_LINK edges.
 *
 * @param sourcePos - The source position { x, y }
 * @param targetPos - The target position { x, y }
 * @returns The midpoint position { x, y }
 */
export function calculateEdgeMidpoint(sourcePos: Point, targetPos: Point): Point {
  return {
    x: (sourcePos.x + targetPos.x) / 2,
    y: (sourcePos.y + targetPos.y) / 2,
  };
}

// ============================================================================
// Task 3.2: createUserInteractionMainEdge Function
// ============================================================================

/**
 * Create the MAIN edge for a User Interaction.
 *
 * The MAIN edge connects:
 * - Case A: Primary (P) and Secondary (S) App_Business_Point nodes
 * - Case B: User (U) and Primary (P) App_Business_Point nodes
 *
 * Edge properties:
 * - relationship_type: 'USER_INTERACTION'
 * - relationship_id: interaction.id
 * - subType: 'MAIN'
 * - line_dashes: '4,4' (dotted styling)
 * - label_text: interaction.name
 * - label positioned at geometric center of border-anchored edge points
 *
 * @param interaction - The Interaction entity
 * @param sourceNode - The source DiagramNode
 * @param targetNode - The target DiagramNode
 * @returns A new DiagramEdge for the MAIN interaction edge
 */
export function createUserInteractionMainEdge(
  interaction: Interaction,
  sourceNode: DiagramNode,
  targetNode: DiagramNode
): DiagramEdge {
  // Use calculateEdgePoints for border-anchored edge points
  const edgePoints = calculateEdgePoints(sourceNode, targetNode);

  // Calculate midpoint from border-anchored positions for label placement
  const midpoint = calculateEdgeMidpoint(
    { x: edgePoints[0].pos_x, y: edgePoints[0].pos_y },
    { x: edgePoints[1].pos_x, y: edgePoints[1].pos_y }
  );

  const edge: DiagramEdge = {
    id: generatePrefixedId('edge'),
    relationship_type: RELATIONSHIP_EDGE_TYPES.USER_INTERACTION,
    relationship_id: interaction.id,
    source_node_id: sourceNode.id,
    target_node_id: targetNode.id,
    subType: 'MAIN',
    line_dashes: LINE_DASHES_DOTTED,
    label_text: interaction.name,
    label_pos_x: midpoint.x,
    label_pos_y: midpoint.y,
    edge_points: edgePoints,
  };

  return edge;
}

// ============================================================================
// Task 3.3: createUserInteractionUserLinkEdge Function
// ============================================================================

/**
 * Create the USER_LINK edge for a User Interaction (Case A only).
 *
 * The USER_LINK edge connects the User node to the midpoint of the MAIN edge.
 * This creates a visual representation of the user's relationship to the
 * interaction between two App_Business_Points.
 *
 * Edge properties:
 * - relationship_type: 'USER_INTERACTION'
 * - relationship_id: interaction.id
 * - subType: 'USER_LINK'
 * - line_dashes: '4,4' (dotted styling)
 * - Target is the midpoint of the MAIN edge (virtual target position)
 *
 * @param interaction - The Interaction entity
 * @param userNodeId - ID of the User diagram node
 * @param midpoint - The midpoint of the MAIN edge (target position)
 * @param userNodePos - Position of the User node (source position)
 * @returns A new DiagramEdge for the USER_LINK edge
 */
export function createUserInteractionUserLinkEdge(
  interaction: Interaction,
  userNode: DiagramNode,
  midpoint: Point
): DiagramEdge {
  // Calculate border anchor point on user node toward the midpoint
  const userBorderPoint = calculateBorderAnchorPoint(userNode, midpoint);

  // Create edge points for the line (from user border to midpoint)
  const edgePoints = [
    {
      id: generatePrefixedId('ep'),
      sequence_order: 0,
      pos_x: userBorderPoint.x,
      pos_y: userBorderPoint.y,
    },
    {
      id: generatePrefixedId('ep'),
      sequence_order: 1,
      pos_x: midpoint.x,
      pos_y: midpoint.y,
    },
  ];

  // For USER_LINK edges, the target is a virtual midpoint position
  // We use a special target_node_id format to indicate this
  const edge: DiagramEdge = {
    id: generatePrefixedId('edge'),
    relationship_type: RELATIONSHIP_EDGE_TYPES.USER_INTERACTION,
    relationship_id: interaction.id,
    source_node_id: userNode.id,
    // Target is virtual (midpoint) - use empty string
    target_node_id: '',
    subType: 'USER_LINK',
    line_dashes: LINE_DASHES_DOTTED,
    edge_points: edgePoints,
  };

  return edge;
}

// ============================================================================
// Task 3.5: addUserInteractionToDiagram Orchestration Function
// ============================================================================

/**
 * Add a User Interaction to the diagram by creating appropriate edges.
 *
 * This is the main orchestration function that:
 * 1. Determines Case A or Case B
 * 2. Finds required nodes using getAppBusinessPointNodeId
 * 3. Creates the MAIN edge
 * 4. For Case A: Optionally creates USER_LINK if User node is present
 *
 * **Case A** (P + S):
 * - Creates MAIN edge between Primary and Secondary App_Business_Point nodes
 * - If User node present, also creates USER_LINK edge from User to MAIN midpoint
 *
 * **Case B** (P only):
 * - Creates MAIN edge between User and Primary App_Business_Point nodes
 * - No separate USER_LINK edge needed (User is already the source)
 *
 * @param interaction - The Interaction entity to add
 * @param diagram - The current Diagram
 * @param metaModel - The MetaModel for entity lookups
 * @returns Object containing the created edges: { mainEdge, userLinkEdge? }
 * @throws Error if required nodes are not on diagram
 */
export function addUserInteractionToDiagram(
  interaction: Interaction,
  diagram: Diagram,
  metaModel: MetaModel
): AddUserInteractionResult {
  const interactionCase = isUserInteractionCase(interaction);

  // Get required nodes
  const interactionNodes = getNodesForUserInteraction(interaction, diagram, metaModel);

  if (!interactionNodes) {
    throw new Error('Required nodes for User Interaction are not on the diagram');
  }


  if (interactionCase === 'A') {
    // Case A: MAIN edge between P and S, optional USER_LINK
    const primaryNode = interactionNodes.primary;
    const secondaryNode = interactionNodes.secondary!;
    const userNode = interactionNodes.user;

        // Create MAIN edge between P and S
    const mainEdge = createUserInteractionMainEdge(
      interaction,
      primaryNode,
      secondaryNode
    );

    // Optionally create USER_LINK edge if User node is present
    let userLinkEdge: DiagramEdge | undefined;
    if (userNode) {
      // Get midpoint from border-anchored MAIN edge points
      const midpoint = calculateEdgeMidpoint(
        { x: mainEdge.edge_points[0].pos_x, y: mainEdge.edge_points[0].pos_y },
        { x: mainEdge.edge_points[1].pos_x, y: mainEdge.edge_points[1].pos_y }
      );

      userLinkEdge = createUserInteractionUserLinkEdge(
        interaction,
        userNode,
        midpoint
      );
    }

    return {
      mainEdge,
      userLinkEdge,
    };
  } else {
    // Case B: MAIN edge between U and P
    const primaryNode = interactionNodes.primary;
    const userNode = interactionNodes.user!;

        // Create MAIN edge between User and Primary
    const mainEdge = createUserInteractionMainEdge(
      interaction,
      userNode,
      primaryNode
    );

    // No USER_LINK edge in Case B (User is already the source of MAIN)
    return {
      mainEdge,
    };
  }
}

// ============================================================================
// Task 5.2: shouldCascadeDeleteUserLink Helper Function
// ============================================================================

/**
 * Determine if deleting an edge should cascade to delete a USER_LINK edge.
 *
 * Cascade deletion logic:
 * - If the deleted edge is a USER_INTERACTION edge with subType 'MAIN'
 * - Find any USER_LINK edge with the same relationship_id (interaction_id)
 * - Return that USER_LINK edge if found, null otherwise
 *
 * This function does NOT cascade when:
 * - The deleted edge is not a USER_INTERACTION type
 * - The deleted edge is a USER_LINK (deleting USER_LINK does not cascade to MAIN)
 * - No matching USER_LINK edge exists
 *
 * @param deletedEdge - The edge being deleted
 * @param diagramEdges - All edges currently on the diagram
 * @returns The USER_LINK edge to cascade delete, or null if no cascade needed
 */
export function shouldCascadeDeleteUserLink(
  deletedEdge: DiagramEdge,
  diagramEdges: DiagramEdge[]
): DiagramEdge | null {
  // Only cascade for USER_INTERACTION edges
  if (deletedEdge.relationship_type !== RELATIONSHIP_EDGE_TYPES.USER_INTERACTION) {
    return null;
  }

  // Only cascade when deleting a MAIN edge
  if (deletedEdge.subType !== 'MAIN') {
    return null;
  }

  // Find the USER_LINK edge with the same relationship_id (interaction_id)
  const interactionId = deletedEdge.relationship_id;
  const userLinkEdge = diagramEdges.find(
    edge =>
      edge.relationship_type === RELATIONSHIP_EDGE_TYPES.USER_INTERACTION &&
      edge.relationship_id === interactionId &&
      edge.subType === 'USER_LINK' &&
      edge.id !== deletedEdge.id // Don't match the edge being deleted
  );

  return userLinkEdge || null;
}

// ============================================================================
// Task 5.4: getInteractionEdgeCountForInteraction Helper Function
// ============================================================================

/**
 * Count the number of USER_INTERACTION edges for a specific interaction.
 *
 * This counts edges where:
 * - relationship_type is USER_INTERACTION
 * - relationship_id matches the interactionId
 *
 * Used to determine if an interaction is still visualised on the diagram.
 * After deletion, if count is 0, the RHS row should become re-enabled.
 *
 * @param interactionId - The Interaction entity ID
 * @param edges - Array of DiagramEdge from the diagram
 * @returns Number of USER_INTERACTION edges for this interaction
 */
export function getInteractionEdgeCountForInteraction(
  interactionId: string,
  edges: DiagramEdge[]
): number {
  return edges.filter(
    edge =>
      edge.relationship_type === RELATIONSHIP_EDGE_TYPES.USER_INTERACTION &&
      edge.relationship_id === interactionId
  ).length;
}

// ============================================================================
// Task 5.3: Helper for Edge Deletion with Cascade
// ============================================================================

/**
 * Get edges to delete when deleting a USER_INTERACTION edge.
 *
 * This function determines all edges that should be deleted when
 * a USER_INTERACTION edge is deleted, including cascade deletions.
 *
 * Cascade rules:
 * - Deleting MAIN edge: Also delete any USER_LINK with same interaction_id
 * - Deleting USER_LINK: Only delete the USER_LINK, MAIN remains
 *
 * @param edgeToDelete - The edge being explicitly deleted
 * @param diagramEdges - All edges currently on the diagram
 * @returns Array of edge IDs to delete (includes the original edge and any cascaded edges)
 */
export function getEdgesToDeleteWithCascade(
  edgeToDelete: DiagramEdge,
  diagramEdges: DiagramEdge[]
): string[] {
  const edgeIdsToDelete: string[] = [edgeToDelete.id];

  // Check for cascade deletion
  const cascadeEdge = shouldCascadeDeleteUserLink(edgeToDelete, diagramEdges);
  if (cascadeEdge) {
    edgeIdsToDelete.push(cascadeEdge.id);
  }

  return edgeIdsToDelete;
}
