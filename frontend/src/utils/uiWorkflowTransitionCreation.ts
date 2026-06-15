/**
 * UI Workflow Transition Creation Flow Utilities
 *
 * Task Group 8: Implements the 2-click source/target selection flow for creating
 * UIWorkflowTransition edges between UIScreen nodes on UI_Workflow diagrams.
 *
 * Pattern: Follows stateTransitionCreation.ts pattern for consistency.
 *
 * Flow:
 * 1. User clicks UIWorkflowTransition in palette
 * 2. Mode enters 'selecting-source', cursor changes
 * 3. User clicks source UIScreen node -> mode enters 'selecting-target'
 * 4. User clicks target UIScreen node -> creates transition, exits mode
 * 5. Escape at any point cancels and exits mode
 */

import { generatePrefixedId } from './idGenerator';
import { UIWorkflowTransition, DiagramNode, DiagramEdge, ENTITY_TYPES, RELATIONSHIP_EDGE_TYPES } from '../types/model';

// ============================================================================
// Types for UI Workflow Transition Creation Mode
// ============================================================================

/**
 * WorkflowTransitionCreationMode - tracks the state of the transition creation flow.
 *
 * States:
 * - 'idle': Not in creation mode
 * - 'selecting-source': Waiting for user to click source UIScreen node
 * - 'selecting-target': Source selected, waiting for user to click target UIScreen node
 */
export type WorkflowTransitionCreationStep = 'idle' | 'selecting-source' | 'selecting-target';

/**
 * WorkflowTransitionCreationMode interface - full state for the creation flow.
 */
export interface WorkflowTransitionCreationMode {
  /** Current step in the creation flow */
  step: WorkflowTransitionCreationStep;
  /** ID of the selected source UIScreen node (set in selecting-target step) */
  sourceNodeId?: string;
  /** ID of the selected source UIScreen entity (set in selecting-target step) */
  sourceScreenId?: string;
}

/**
 * WorkflowTransitionCreationResult - result of completing the creation flow.
 */
export interface WorkflowTransitionCreationResult {
  /** The new UIWorkflowTransition relationship entity */
  transition: UIWorkflowTransition;
  /** The new DiagramEdge for the transition */
  edge: DiagramEdge;
}

// ============================================================================
// Creation Mode State Helpers
// ============================================================================

/**
 * Creates the initial creation mode state for starting the flow.
 * @returns Initial WorkflowTransitionCreationMode in 'selecting-source' step
 */
export function createInitialWorkflowTransitionMode(): WorkflowTransitionCreationMode {
  return {
    step: 'selecting-source',
  };
}

/**
 * Creates the idle mode state (not in creation mode).
 * @returns WorkflowTransitionCreationMode in 'idle' step
 */
export function createIdleWorkflowTransitionMode(): WorkflowTransitionCreationMode {
  return {
    step: 'idle',
  };
}

/**
 * Advances the creation mode from source selection to target selection.
 * @param _mode Current creation mode state (unused, kept for API consistency)
 * @param sourceNodeId ID of the selected source node
 * @param sourceScreenId ID of the source UIScreen entity
 * @returns Updated WorkflowTransitionCreationMode in 'selecting-target' step
 */
export function advanceToTargetSelection(
  _mode: WorkflowTransitionCreationMode,
  sourceNodeId: string,
  sourceScreenId: string
): WorkflowTransitionCreationMode {
  return {
    step: 'selecting-target',
    sourceNodeId,
    sourceScreenId,
  };
}

/**
 * Checks if a node is a valid UIScreen node for selection.
 * @param node The DiagramNode to check
 * @returns true if the node is a UIScreen entity
 */
export function isValidUIScreenNode(node: DiagramNode): boolean {
  return node.entity_type === ENTITY_TYPES.UI_SCREEN;
}

/**
 * Gets the cursor style for the current creation mode step.
 * @param step Current creation step
 * @returns CSS cursor style string
 */
export function getWorkflowTransitionCursor(step: WorkflowTransitionCreationStep): string {
  switch (step) {
    case 'selecting-source':
      return 'crosshair';
    case 'selecting-target':
      return 'crosshair';
    case 'idle':
    default:
      return 'default';
  }
}

/**
 * Gets the status message for the current creation mode step.
 * @param step Current creation step
 * @returns User-facing status message
 */
export function getWorkflowTransitionStatusMessage(step: WorkflowTransitionCreationStep): string {
  switch (step) {
    case 'selecting-source':
      return 'Click a UI Screen to set as the source of the transition';
    case 'selecting-target':
      return 'Click a UI Screen to set as the target of the transition';
    case 'idle':
    default:
      return '';
  }
}

// ============================================================================
// Entity and Edge Creation
// ============================================================================

/**
 * Creates a new UIWorkflowTransition entity.
 *
 * @param sourceScreenId ID of the source UIScreen
 * @param targetScreenId ID of the target UIScreen
 * @param name Optional name for the transition
 * @param trigger Optional trigger text (e.g., "Click Submit")
 * @param guard Optional guard condition (e.g., "isValid")
 * @returns New UIWorkflowTransition entity
 */
export function createUIWorkflowTransition(
  sourceScreenId: string,
  targetScreenId: string,
  name?: string,
  trigger?: string,
  guard?: string
): UIWorkflowTransition {
  const transitionId = generatePrefixedId('transition');

  return {
    id: transitionId,
    name: name || `Transition ${transitionId.substring(11, 19)}`,
    source_screen_id: sourceScreenId,
    target_screen_id: targetScreenId,
    trigger,
    guard,
  };
}

/**
 * Creates a DiagramEdge for a UIWorkflowTransition.
 *
 * The edge connects source UIScreen node to target UIScreen node.
 * Uses border-to-border anchoring (edge points at node boundaries).
 *
 * @param transition The UIWorkflowTransition entity
 * @param sourceNodeId ID of the source DiagramNode
 * @param targetNodeId ID of the target DiagramNode
 * @param sourceNode Source DiagramNode for position calculation
 * @param targetNode Target DiagramNode for position calculation
 * @returns New DiagramEdge for the transition
 */
export function createUIWorkflowTransitionEdge(
  transition: UIWorkflowTransition,
  sourceNodeId: string,
  targetNodeId: string,
  sourceNode: DiagramNode,
  targetNode: DiagramNode
): DiagramEdge {
  const edgeId = generatePrefixedId('edge');

  // Calculate border-to-border edge points
  const edgePoints = calculateBorderToBorderEdgePoints(sourceNode, targetNode);

  // Calculate label position at midpoint
  const labelPos = calculateLabelPosition(edgePoints);

  // Build label text from trigger if present
  const labelText = transition.trigger || transition.name;

  return {
    id: edgeId,
    relationship_type: RELATIONSHIP_EDGE_TYPES.UI_WORKFLOW_TRANSITION,
    relationship_id: transition.id,
    source_node_id: sourceNodeId,
    target_node_id: targetNodeId,
    label_text: labelText,
    label_pos_x: labelPos.x,
    label_pos_y: labelPos.y,
    arrow_end: 'ARROW',
    edge_points: edgePoints,
    z_index: 110,
  };
}

// ============================================================================
// Geometry Helpers
// ============================================================================

/**
 * Calculates border-to-border edge points between two nodes.
 *
 * Determines the optimal connection points on node boundaries based on
 * relative positions of the nodes.
 *
 * @param sourceNode Source DiagramNode
 * @param targetNode Target DiagramNode
 * @returns Array of EdgePoint with source and target positions
 */
function calculateBorderToBorderEdgePoints(
  sourceNode: DiagramNode,
  targetNode: DiagramNode
): Array<{ id: string; sequence_order: number; pos_x: number; pos_y: number }> {
  // Calculate centers
  const sourceCenter = {
    x: sourceNode.pos_x + sourceNode.width / 2,
    y: sourceNode.pos_y + sourceNode.height / 2,
  };
  const targetCenter = {
    x: targetNode.pos_x + targetNode.width / 2,
    y: targetNode.pos_y + targetNode.height / 2,
  };

  // Calculate direction vector
  const dx = targetCenter.x - sourceCenter.x;
  const dy = targetCenter.y - sourceCenter.y;

  // Determine exit/entry sides based on direction
  const sourcePoint = getNodeBorderPoint(sourceNode, dx, dy, true);
  const targetPoint = getNodeBorderPoint(targetNode, dx, dy, false);

  return [
    { id: generatePrefixedId('ep'), sequence_order: 0, pos_x: sourcePoint.x, pos_y: sourcePoint.y },
    { id: generatePrefixedId('ep'), sequence_order: 1, pos_x: targetPoint.x, pos_y: targetPoint.y },
  ];
}

/**
 * Gets the border point on a node based on direction.
 *
 * @param node The DiagramNode
 * @param dx Direction X component
 * @param dy Direction Y component
 * @param isSource true if this is the source node, false for target
 * @returns Point on the node border
 */
function getNodeBorderPoint(
  node: DiagramNode,
  dx: number,
  dy: number,
  isSource: boolean
): { x: number; y: number } {
  const center = {
    x: node.pos_x + node.width / 2,
    y: node.pos_y + node.height / 2,
  };

  // For source, we want to exit in the direction of the target
  // For target, we want to enter from the direction of the source
  const effectiveDx = isSource ? dx : -dx;
  const effectiveDy = isSource ? dy : -dy;

  // Determine which side to use based on angle
  const angle = Math.atan2(effectiveDy, effectiveDx);
  const absAngle = Math.abs(angle);

  // Angles: 0 = right, PI/2 = bottom, PI = left, -PI/2 = top
  if (absAngle < Math.PI / 4) {
    // Exit/enter from right
    return { x: node.pos_x + node.width, y: center.y };
  } else if (absAngle > 3 * Math.PI / 4) {
    // Exit/enter from left
    return { x: node.pos_x, y: center.y };
  } else if (angle > 0) {
    // Exit/enter from bottom
    return { x: center.x, y: node.pos_y + node.height };
  } else {
    // Exit/enter from top
    return { x: center.x, y: node.pos_y };
  }
}

/**
 * Calculates the label position at the midpoint of the edge.
 *
 * @param edgePoints The edge points array
 * @returns Position for the edge label
 */
function calculateLabelPosition(
  edgePoints: Array<{ pos_x: number; pos_y: number }>
): { x: number; y: number } {
  if (edgePoints.length < 2) {
    return { x: 0, y: 0 };
  }

  const first = edgePoints[0];
  const last = edgePoints[edgePoints.length - 1];

  return {
    x: (first.pos_x + last.pos_x) / 2,
    y: (first.pos_y + last.pos_y) / 2 - 10, // Offset slightly above the line
  };
}

// ============================================================================
// Complete Creation Flow
// ============================================================================

/**
 * Completes the UI Workflow Transition creation flow.
 *
 * Creates both the UIWorkflowTransition entity and the DiagramEdge.
 *
 * @param mode Current creation mode state (must be in selecting-target step)
 * @param targetNodeId ID of the selected target node
 * @param targetScreenId ID of the target UIScreen entity
 * @param sourceNode Source DiagramNode
 * @param targetNode Target DiagramNode
 * @param name Optional name for the transition
 * @param trigger Optional trigger text
 * @param guard Optional guard condition
 * @returns WorkflowTransitionCreationResult with transition entity and edge
 * @throws Error if mode is not in selecting-target step
 */
export function completeWorkflowTransitionCreation(
  mode: WorkflowTransitionCreationMode,
  targetNodeId: string,
  targetScreenId: string,
  sourceNode: DiagramNode,
  targetNode: DiagramNode,
  name?: string,
  trigger?: string,
  guard?: string
): WorkflowTransitionCreationResult {
  if (mode.step !== 'selecting-target' || !mode.sourceNodeId || !mode.sourceScreenId) {
    throw new Error('Invalid creation mode state: must be in selecting-target step with source selected');
  }

  // Create the transition entity
  const transition = createUIWorkflowTransition(
    mode.sourceScreenId,
    targetScreenId,
    name,
    trigger,
    guard
  );

  // Create the diagram edge
  const edge = createUIWorkflowTransitionEdge(
    transition,
    mode.sourceNodeId,
    targetNodeId,
    sourceNode,
    targetNode
  );

  return { transition, edge };
}

// ============================================================================
// Cascading Delete Helper
// ============================================================================

/**
 * Gets all UIWorkflowTransition IDs that reference a given UIScreen.
 *
 * Used for cascading delete: when a UIScreen is deleted, all transitions
 * that reference it (as source or target) must also be deleted.
 *
 * @param screenId ID of the UIScreen being deleted
 * @param transitions All UIWorkflowTransition relationships
 * @returns Array of transition IDs to delete
 */
export function getTransitionsReferencingScreen(
  screenId: string,
  transitions: UIWorkflowTransition[]
): string[] {
  return transitions
    .filter(t => t.source_screen_id === screenId || t.target_screen_id === screenId)
    .map(t => t.id);
}

/**
 * Gets all DiagramEdge IDs for transitions that reference a given UIScreen.
 *
 * Used for cascading delete: when a UIScreen is deleted, all edges
 * representing transitions to/from that screen must also be deleted.
 *
 * @param screenId ID of the UIScreen being deleted
 * @param transitions All UIWorkflowTransition relationships
 * @param edges All DiagramEdge instances
 * @returns Array of edge IDs to delete
 */
export function getEdgesForScreenTransitions(
  screenId: string,
  transitions: UIWorkflowTransition[],
  edges: DiagramEdge[]
): string[] {
  const transitionIds = new Set(getTransitionsReferencingScreen(screenId, transitions));

  return edges
    .filter(e =>
      e.relationship_type === RELATIONSHIP_EDGE_TYPES.UI_WORKFLOW_TRANSITION &&
      transitionIds.has(e.relationship_id)
    )
    .map(e => e.id);
}
