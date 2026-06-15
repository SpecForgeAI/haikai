/**
 * State Diagram Palette Utilities
 * Spec 2026-01-02: State Diagram UX Fixes
 * Task Group 3: RHS Palette Layer
 *
 * Helper functions for the RHS palette when working with State diagrams:
 * - stateOnDiagram: Check if a State entity has a node on the diagram
 * - transitionOnDiagram: Check if a StateTransition has an edge on the diagram
 * - findConnectedStateTransitionEdges: Find edges connected to a node (for cascade delete)
 * - canAddStateTransition: Validate if a transition can be added (endpoints check)
 */

import type { DiagramNode, DiagramEdge, StateTransition } from '../types/model';

// ============================================================================
// On-Diagram Detection Helpers
// ============================================================================

/**
 * Check if a State entity has a corresponding DiagramNode on the diagram.
 *
 * @param stateId - The ID of the State entity
 * @param diagramNodes - Array of DiagramNodes on the current diagram
 * @returns true if the state has a node on the diagram
 */
export function stateOnDiagram(stateId: string, diagramNodes: DiagramNode[]): boolean {
  return diagramNodes.some(
    (node) => node.entity_type === 'STATE' && node.entity_id === stateId
  );
}

/**
 * Check if a StateTransition entity has a corresponding DiagramEdge on the diagram.
 *
 * @param transitionId - The ID of the StateTransition entity
 * @param diagramEdges - Array of DiagramEdges on the current diagram
 * @returns true if the transition has an edge on the diagram
 */
export function transitionOnDiagram(transitionId: string, diagramEdges: DiagramEdge[]): boolean {
  return diagramEdges.some(
    (edge) =>
      edge.relationship_type === 'STATE_TRANSITION' &&
      edge.relationship_id === transitionId
  );
}

// ============================================================================
// Connected Edge Detection (for Delete Cascade)
// ============================================================================

/**
 * Find all StateTransition edges connected to a given node.
 * Used for cascade deletion - when a State node is deleted, all connected
 * transition edges should also be removed from the diagram.
 *
 * @param nodeId - The ID of the DiagramNode being deleted
 * @param diagramEdges - Array of DiagramEdges on the current diagram
 * @returns Array of DiagramEdges that connect to the specified node
 */
export function findConnectedStateTransitionEdges(
  nodeId: string,
  diagramEdges: DiagramEdge[]
): DiagramEdge[] {
  return diagramEdges.filter(
    (edge) =>
      edge.relationship_type === 'STATE_TRANSITION' &&
      (edge.source_node_id === nodeId || edge.target_node_id === nodeId)
  );
}

// ============================================================================
// Add Transition Validation
// ============================================================================

/**
 * Result of canAddStateTransition validation
 */
export interface AddTransitionValidationResult {
  /** Whether the transition can be added */
  canAdd: boolean;
  /** The source node ID if found on diagram */
  sourceNodeId?: string;
  /** The target node ID if found on diagram */
  targetNodeId?: string;
  /** Which endpoint is missing: 'source', 'target', or 'both' */
  missingEndpoint?: 'source' | 'target' | 'both';
}

/**
 * Validate whether a StateTransition can be added to the diagram.
 * A transition can only be added if both its source and target states
 * have nodes on the diagram.
 *
 * @param transition - The StateTransition entity to validate
 * @param diagramNodes - Array of DiagramNodes on the current diagram
 * @returns Validation result with canAdd flag and node IDs if found
 */
export function canAddStateTransition(
  transition: StateTransition,
  diagramNodes: DiagramNode[]
): AddTransitionValidationResult {
  // Find the source state node
  const sourceNode = diagramNodes.find(
    (node) =>
      node.entity_type === 'STATE' && node.entity_id === transition.from_state_id
  );

  // Find the target state node
  const targetNode = diagramNodes.find(
    (node) =>
      node.entity_type === 'STATE' && node.entity_id === transition.to_state_id
  );

  // Determine which endpoints are missing
  const sourcePresent = !!sourceNode;
  const targetPresent = !!targetNode;

  if (sourcePresent && targetPresent) {
    return {
      canAdd: true,
      sourceNodeId: sourceNode.id,
      targetNodeId: targetNode.id,
    };
  }

  // Determine which endpoint is missing
  let missingEndpoint: 'source' | 'target' | 'both';
  if (!sourcePresent && !targetPresent) {
    missingEndpoint = 'both';
  } else if (!sourcePresent) {
    missingEndpoint = 'source';
  } else {
    missingEndpoint = 'target';
  }

  return {
    canAdd: false,
    sourceNodeId: sourceNode?.id,
    targetNodeId: targetNode?.id,
    missingEndpoint,
  };
}

// ============================================================================
// Edge Creation Helper
// ============================================================================

/**
 * Create a StateTransition DiagramEdge.
 *
 * @param edgeId - Unique ID for the new edge
 * @param transitionId - The StateTransition entity ID
 * @param sourceNodeId - The source DiagramNode ID
 * @param targetNodeId - The target DiagramNode ID
 * @returns A new DiagramEdge for the StateTransition
 */
export function createStateTransitionEdge(
  edgeId: string,
  transitionId: string,
  sourceNodeId: string,
  targetNodeId: string
): DiagramEdge {
  return {
    id: edgeId,
    relationship_type: 'STATE_TRANSITION',
    relationship_id: transitionId,
    source_node_id: sourceNodeId,
    target_node_id: targetNodeId,
    edge_points: [],
    z_index: 110, // Above state nodes (z-index 100)
  };
}
