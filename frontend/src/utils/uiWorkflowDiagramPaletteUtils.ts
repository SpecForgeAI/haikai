/**
 * UI Workflow Diagram Palette Utilities
 * Spec 2026-01-02: Phase 1 UI Architecture - Increment 1
 * Task Group 9: RHS Palette Behavior Layer
 *
 * Helper functions for the RHS palette when working with UI_Workflow diagrams:
 * - uiScreenOnDiagram: Check if a UIScreen entity has a node on the diagram
 * - uiWorkflowTransitionOnDiagram: Check if a UIWorkflowTransition has an edge on the diagram
 * - findConnectedUIWorkflowTransitionEdges: Find edges connected to a node (for cascade delete)
 * - canAddUIWorkflowTransition: Validate if a transition can be added (endpoints check)
 */

import type { DiagramNode, DiagramEdge, UIWorkflowTransition } from '../types/model';

// ============================================================================
// On-Diagram Detection Helpers
// ============================================================================

/**
 * Check if a UIScreen entity has a corresponding DiagramNode on the diagram.
 *
 * @param screenId - The ID of the UIScreen entity
 * @param diagramNodes - Array of DiagramNodes on the current diagram
 * @returns true if the screen has a node on the diagram
 */
export function uiScreenOnDiagram(screenId: string, diagramNodes: DiagramNode[]): boolean {
  return diagramNodes.some(
    (node) => node.entity_type === 'UI_SCREEN' && node.entity_id === screenId
  );
}

/**
 * Check if a UIWorkflowTransition entity has a corresponding DiagramEdge on the diagram.
 *
 * @param transitionId - The ID of the UIWorkflowTransition entity
 * @param diagramEdges - Array of DiagramEdges on the current diagram
 * @returns true if the transition has an edge on the diagram
 */
export function uiWorkflowTransitionOnDiagram(
  transitionId: string,
  diagramEdges: DiagramEdge[]
): boolean {
  return diagramEdges.some(
    (edge) =>
      edge.relationship_type === 'UI_WORKFLOW_TRANSITION' &&
      edge.relationship_id === transitionId
  );
}

// ============================================================================
// Connected Edge Detection (for Delete Cascade)
// ============================================================================

/**
 * Find all UIWorkflowTransition edges connected to a given node.
 * Used for cascade deletion - when a UIScreen node is deleted, all connected
 * transition edges should also be removed from the diagram.
 *
 * @param nodeId - The ID of the DiagramNode being deleted
 * @param diagramEdges - Array of DiagramEdges on the current diagram
 * @returns Array of DiagramEdges that connect to the specified node
 */
export function findConnectedUIWorkflowTransitionEdges(
  nodeId: string,
  diagramEdges: DiagramEdge[]
): DiagramEdge[] {
  return diagramEdges.filter(
    (edge) =>
      edge.relationship_type === 'UI_WORKFLOW_TRANSITION' &&
      (edge.source_node_id === nodeId || edge.target_node_id === nodeId)
  );
}

// ============================================================================
// Add Transition Validation
// ============================================================================

/**
 * Result of canAddUIWorkflowTransition validation
 */
export interface AddUIWorkflowTransitionValidationResult {
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
 * Validate whether a UIWorkflowTransition can be added to the diagram.
 * A transition can only be added if both its source and target screens
 * have nodes on the diagram.
 *
 * @param transition - The UIWorkflowTransition entity to validate
 * @param diagramNodes - Array of DiagramNodes on the current diagram
 * @returns Validation result with canAdd flag and node IDs if found
 */
export function canAddUIWorkflowTransition(
  transition: UIWorkflowTransition,
  diagramNodes: DiagramNode[]
): AddUIWorkflowTransitionValidationResult {
  // Find the source screen node
  const sourceNode = diagramNodes.find(
    (node) =>
      node.entity_type === 'UI_SCREEN' && node.entity_id === transition.source_screen_id
  );

  // Find the target screen node
  const targetNode = diagramNodes.find(
    (node) =>
      node.entity_type === 'UI_SCREEN' && node.entity_id === transition.target_screen_id
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
 * Create a UIWorkflowTransition DiagramEdge.
 *
 * @param edgeId - Unique ID for the new edge
 * @param transitionId - The UIWorkflowTransition entity ID
 * @param sourceNodeId - The source DiagramNode ID
 * @param targetNodeId - The target DiagramNode ID
 * @returns A new DiagramEdge for the UIWorkflowTransition
 */
export function createUIWorkflowTransitionEdge(
  edgeId: string,
  transitionId: string,
  sourceNodeId: string,
  targetNodeId: string
): DiagramEdge {
  return {
    id: edgeId,
    relationship_type: 'UI_WORKFLOW_TRANSITION',
    relationship_id: transitionId,
    source_node_id: sourceNodeId,
    target_node_id: targetNodeId,
    edge_points: [],
    arrow_end: 'ARROW',
    z_index: 110, // Above UI screen nodes (z-index 100)
  };
}
