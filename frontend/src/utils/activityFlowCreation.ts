/**
 * Activity Flow Creation Utilities
 * Task Group 1: Activity Flow Creation Utility Module
 * Task Group 3: Flow Boundary Anchoring (A2)
 * Spec 2026-01-01 (D): Default edge label positioning
 *
 * This module provides utilities for creating ActivityFlow entities
 * and their associated DiagramEdge elements.
 *
 * Updated to use boundary anchor points for edge connections
 * instead of center coordinates.
 *
 * Spec 2026-01-01 (D): On edge creation, default label position is set
 * to the edge midpoint with -8px y offset.
 */

import { ActivityFlow, DiagramEdge, DiagramNode, ActivityKind } from '../types/model';
import { generatePrefixedId } from './idGenerator';
import {
  getBoundaryAnchorPoint,
  getShapeKindFromActivityKind,
  Rect,
  ShapeKind,
} from './geometryUtils';

// ============================================================================
// Activity Flow Creation Mode Type
// ============================================================================

/**
 * Interface for activity flow creation mode state.
 * Tracks whether the user is in the process of creating an activity flow
 * and which activity node has been selected as the source.
 */
export interface ActivityFlowCreationMode {
  /** Whether activity flow creation mode is active */
  active: boolean;
  /** The diagram node ID of the selected source activity (null if none selected) */
  sourceActivityNodeId: string | null;
}

/**
 * Initial state for activity flow creation mode
 */
export const initialActivityFlowCreationMode: ActivityFlowCreationMode = {
  active: false,
  sourceActivityNodeId: null,
};

// ============================================================================
// ActivityFlow Entity Creation
// ============================================================================

/**
 * Create a new ActivityFlow entity.
 *
 * @param fromActivityId - The ID of the source Activity entity
 * @param toActivityId - The ID of the target Activity entity
 * @returns A new ActivityFlow entity with all fields initialized
 */
export function createActivityFlowEntity(
  fromActivityId: string,
  toActivityId: string
): ActivityFlow {
  return {
    id: generatePrefixedId('flow'),
    from_activity_id: fromActivityId,
    to_activity_id: toActivityId,
    // Flow kind - default to Control
    flow_kind: 'Control',
    // Trigger fields - optional, initially undefined
    trigger_ref_kind: undefined,
    trigger_ref_id: undefined,
    trigger_label_text: undefined,
    // Condition fields - optional, initially undefined
    condition_ref_kind: undefined,
    condition_ref_id: undefined,
    condition_expression: undefined,
  };
}

// ============================================================================
// DiagramEdge Creation for ActivityFlow
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
 * Get the ShapeKind for a diagram node based on its activity_kind.
 * Falls back to RoundedRect if activity information is not available.
 *
 * @param activityKind - The activity kind from the Activity entity (optional)
 * @returns The ShapeKind for boundary calculation
 */
function getNodeShapeKind(activityKind?: ActivityKind): ShapeKind {
  if (!activityKind) {
    return ShapeKind.RoundedRect; // Default for backward compatibility
  }
  return getShapeKindFromActivityKind(activityKind);
}

/** Default y offset for edge labels (above the line) */
const EDGE_LABEL_Y_OFFSET = -8;

/**
 * Create a DiagramEdge for an ActivityFlow.
 *
 * Task Group 3: Updated to use boundary anchor points instead of center coordinates.
 * Flow arrows now connect at shape boundaries for professional diagram appearance.
 *
 * Spec 2026-01-01 (D): Sets default label_pos_x/y at midpoint with -8px y offset.
 *
 * @param flowId - The ID of the ActivityFlow entity
 * @param sourceNodeId - The diagram node ID of the source activity
 * @param targetNodeId - The diagram node ID of the target activity
 * @param sourceNode - The source DiagramNode for position calculation
 * @param targetNode - The target DiagramNode for position calculation
 * @param sourceActivityKind - Optional activity kind for source (for boundary calculation)
 * @param targetActivityKind - Optional activity kind for target (for boundary calculation)
 * @returns A new DiagramEdge connecting the two activity nodes
 */
export function createActivityFlowDiagramEdge(
  flowId: string,
  sourceNodeId: string,
  targetNodeId: string,
  sourceNode: DiagramNode,
  targetNode: DiagramNode,
  sourceActivityKind?: ActivityKind,
  targetActivityKind?: ActivityKind
): DiagramEdge {
  const edgeId = generatePrefixedId('edge');

  // Convert nodes to rectangles for geometry calculation
  const sourceRect = nodeToRect(sourceNode);
  const targetRect = nodeToRect(targetNode);

  // Determine shape kinds for boundary calculation
  const sourceShapeKind = getNodeShapeKind(sourceActivityKind);
  const targetShapeKind = getNodeShapeKind(targetActivityKind);

  // Calculate boundary anchor points (Task Group 3: A2)
  // Flow arrows connect at shape boundaries, not centers
  const sourceBoundary = getBoundaryAnchorPoint(sourceRect, targetRect, sourceShapeKind);
  const targetBoundary = getBoundaryAnchorPoint(targetRect, sourceRect, targetShapeKind);

  // Spec 2026-01-01 (D): Calculate default label position at midpoint with -8px y offset
  const labelPosX = (sourceBoundary.x + targetBoundary.x) / 2;
  const labelPosY = (sourceBoundary.y + targetBoundary.y) / 2 + EDGE_LABEL_Y_OFFSET;

  return {
    id: edgeId,
    relationship_type: 'ACTIVITY_FLOW',
    relationship_id: flowId,
    source_node_id: sourceNodeId,
    target_node_id: targetNodeId,
    edge_points: [
      {
        id: generatePrefixedId('ep'),
        sequence_order: 0,
        pos_x: sourceBoundary.x,
        pos_y: sourceBoundary.y,
      },
      {
        id: generatePrefixedId('ep'),
        sequence_order: 1,
        pos_x: targetBoundary.x,
        pos_y: targetBoundary.y,
      },
    ],
    // Spec 2026-01-01 (D): Default label position at midpoint with -8px y offset
    label_pos_x: labelPosX,
    label_pos_y: labelPosY,
  };
}

/**
 * Create a DiagramEdge for an ActivityFlow using center points.
 * This is the legacy implementation kept for backward compatibility.
 *
 * @deprecated Use createActivityFlowDiagramEdge with activity kinds for boundary anchoring
 */
export function createActivityFlowDiagramEdgeLegacy(
  flowId: string,
  sourceNodeId: string,
  targetNodeId: string,
  sourceNode: DiagramNode,
  targetNode: DiagramNode
): DiagramEdge {
  const edgeId = generatePrefixedId('edge');

  // Calculate center points for source and target nodes (legacy behavior)
  const sourceCenterX = sourceNode.pos_x + sourceNode.width / 2;
  const sourceCenterY = sourceNode.pos_y + sourceNode.height / 2;
  const targetCenterX = targetNode.pos_x + targetNode.width / 2;
  const targetCenterY = targetNode.pos_y + targetNode.height / 2;

  // Legacy: Calculate default label position at midpoint with -8px y offset
  const labelPosX = (sourceCenterX + targetCenterX) / 2;
  const labelPosY = (sourceCenterY + targetCenterY) / 2 + EDGE_LABEL_Y_OFFSET;

  return {
    id: edgeId,
    relationship_type: 'ACTIVITY_FLOW',
    relationship_id: flowId,
    source_node_id: sourceNodeId,
    target_node_id: targetNodeId,
    edge_points: [
      {
        id: generatePrefixedId('ep'),
        sequence_order: 0,
        pos_x: sourceCenterX,
        pos_y: sourceCenterY,
      },
      {
        id: generatePrefixedId('ep'),
        sequence_order: 1,
        pos_x: targetCenterX,
        pos_y: targetCenterY,
      },
    ],
    label_pos_x: labelPosX,
    label_pos_y: labelPosY,
  };
}

// ============================================================================
// Creation Mode Handlers
// ============================================================================

/**
 * Enter activity flow creation mode.
 * Resets the source activity selection.
 *
 * @returns New activity flow creation mode state with active=true
 */
export function enterActivityFlowCreationMode(): ActivityFlowCreationMode {
  return {
    active: true,
    sourceActivityNodeId: null,
  };
}

/**
 * Exit activity flow creation mode.
 *
 * @returns Initial activity flow creation mode state
 */
export function exitActivityFlowCreationMode(): ActivityFlowCreationMode {
  return { ...initialActivityFlowCreationMode };
}

/**
 * Set the source activity in flow creation mode.
 *
 * @param currentMode - The current activity flow creation mode state
 * @param sourceNodeId - The diagram node ID of the source activity
 * @returns Updated activity flow creation mode state with source set
 */
export function setActivityFlowSourceNode(
  currentMode: ActivityFlowCreationMode,
  sourceNodeId: string
): ActivityFlowCreationMode {
  if (!currentMode.active || currentMode.sourceActivityNodeId !== null) {
    // Not in active mode or source already set - return unchanged
    return currentMode;
  }

  return {
    ...currentMode,
    sourceActivityNodeId: sourceNodeId,
  };
}

/**
 * Check if a node click should complete the flow creation.
 *
 * @param currentMode - The current activity flow creation mode state
 * @returns true if mode is active and source is set (ready for target)
 */
export function isReadyForTargetActivity(
  currentMode: ActivityFlowCreationMode
): boolean {
  return currentMode.active && currentMode.sourceActivityNodeId !== null;
}

/**
 * Get hint text for the current activity flow creation mode state.
 *
 * @param currentMode - The current activity flow creation mode state
 * @returns Hint text to display to the user
 */
export function getActivityFlowModeHintText(
  currentMode: ActivityFlowCreationMode
): string {
  if (!currentMode.active) {
    return '';
  }

  if (currentMode.sourceActivityNodeId === null) {
    return 'Click an activity to select as source. Press Escape to cancel.';
  }

  return 'Click another activity to create the flow. Press Escape to cancel.';
}
