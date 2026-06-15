/**
 * State Transition Creation Utilities
 * Task Group 5: RHS Palette State Transition Creation and Inspector
 *
 * This module provides utilities for creating StateTransition entities
 * and their associated DiagramEdge elements.
 */

import { StateTransition, DiagramEdge, DiagramNode, State } from '../types/model';
import { generatePrefixedId } from './idGenerator';
import {
  getEdgeBoundaryPoints,
  getShapeKindFromStateKind,
  ShapeKind,
  Rect,
} from './geometryUtils';

// ============================================================================
// Transition Creation Mode Type
// ============================================================================

/**
 * Interface for transition creation mode state.
 * Tracks whether the user is in the process of creating a transition
 * and which state node has been selected as the source.
 */
export interface TransitionCreationMode {
  /** Whether transition creation mode is active */
  active: boolean;
  /** The diagram node ID of the selected source state (null if none selected) */
  sourceStateNodeId: string | null;
}

/**
 * Initial state for transition creation mode
 */
export const initialTransitionCreationMode: TransitionCreationMode = {
  active: false,
  sourceStateNodeId: null,
};

// ============================================================================
// StateTransition Entity Creation
// ============================================================================

/**
 * Create a new StateTransition entity.
 *
 * @param fromStateId - The ID of the source State entity
 * @param toStateId - The ID of the target State entity
 * @returns A new StateTransition entity with all fields initialized
 */
export function createStateTransitionEntity(
  fromStateId: string,
  toStateId: string
): StateTransition {
  return {
    id: generatePrefixedId('transition'),
    from_state_id: fromStateId,
    to_state_id: toStateId,
    // Trigger fields - optional, initially undefined
    trigger_ref_kind: undefined,
    trigger_ref_id: undefined,
    trigger_label_text: undefined,
    // Guard fields - optional, initially undefined
    guard_ref_kind: undefined,
    guard_ref_id: undefined,
    guard_expression: undefined,
    // Effect fields - optional, initially undefined
    effect_ref_kind: undefined,
    effect_ref_id: undefined,
    effect_label_text: undefined,
  };
}

// ============================================================================
// DiagramEdge Creation for StateTransition
// ============================================================================

/**
 * Create a DiagramEdge for a StateTransition.
 *
 * Sets initial edge_points at boundary positions (where the line visually
 * exits/enters the source/target nodes) rather than at node centers.
 *
 * @param transitionId - The ID of the StateTransition entity
 * @param sourceNodeId - The diagram node ID of the source state
 * @param targetNodeId - The diagram node ID of the target state
 * @param sourceNode - The source DiagramNode for position calculation
 * @param targetNode - The target DiagramNode for position calculation
 * @param sourceState - Optional source State entity for shape kind lookup
 * @param targetState - Optional target State entity for shape kind lookup
 * @returns A new DiagramEdge connecting the two state nodes
 */
export function createTransitionDiagramEdge(
  transitionId: string,
  sourceNodeId: string,
  targetNodeId: string,
  sourceNode: DiagramNode,
  targetNode: DiagramNode,
  sourceState?: State,
  targetState?: State
): DiagramEdge {
  const edgeId = generatePrefixedId('edge');

  // Build rects for boundary calculation
  const sourceRect: Rect = {
    x: sourceNode.pos_x,
    y: sourceNode.pos_y,
    width: sourceNode.width,
    height: sourceNode.height,
  };
  const targetRect: Rect = {
    x: targetNode.pos_x,
    y: targetNode.pos_y,
    width: targetNode.width,
    height: targetNode.height,
  };

  // Determine shape kinds for boundary calculation
  const sourceShapeKind = sourceState
    ? getShapeKindFromStateKind(sourceState.state_kind)
    : ShapeKind.RoundedRect;
  const targetShapeKind = targetState
    ? getShapeKindFromStateKind(targetState.state_kind)
    : ShapeKind.RoundedRect;

  // Calculate boundary points
  const boundaryPoints = getEdgeBoundaryPoints(
    sourceRect,
    targetRect,
    sourceShapeKind,
    targetShapeKind
  );

  return {
    id: edgeId,
    relationship_type: 'STATE_TRANSITION',
    relationship_id: transitionId,
    source_node_id: sourceNodeId,
    target_node_id: targetNodeId,
    edge_points: [
      {
        id: generatePrefixedId('ep'),
        sequence_order: 0,
        pos_x: boundaryPoints.source.x,
        pos_y: boundaryPoints.source.y,
      },
      {
        id: generatePrefixedId('ep'),
        sequence_order: 1,
        pos_x: boundaryPoints.target.x,
        pos_y: boundaryPoints.target.y,
      },
    ],
  };
}

// ============================================================================
// Creation Mode Handlers
// ============================================================================

/**
 * Enter transition creation mode.
 * Resets the source state selection.
 *
 * @returns New transition creation mode state with active=true
 */
export function enterTransitionCreationMode(): TransitionCreationMode {
  return {
    active: true,
    sourceStateNodeId: null,
  };
}

/**
 * Exit transition creation mode.
 *
 * @returns Initial transition creation mode state
 */
export function exitTransitionCreationMode(): TransitionCreationMode {
  return { ...initialTransitionCreationMode };
}

/**
 * Set the source state in transition creation mode.
 *
 * @param currentMode - The current transition creation mode state
 * @param sourceNodeId - The diagram node ID of the source state
 * @returns Updated transition creation mode state with source set
 */
export function setTransitionSourceState(
  currentMode: TransitionCreationMode,
  sourceNodeId: string
): TransitionCreationMode {
  if (!currentMode.active || currentMode.sourceStateNodeId !== null) {
    // Not in active mode or source already set - return unchanged
    return currentMode;
  }

  return {
    ...currentMode,
    sourceStateNodeId: sourceNodeId,
  };
}

/**
 * Check if a node click should complete the transition creation.
 *
 * @param currentMode - The current transition creation mode state
 * @returns true if mode is active and source is set (ready for target)
 */
export function isReadyForTargetState(
  currentMode: TransitionCreationMode
): boolean {
  return currentMode.active && currentMode.sourceStateNodeId !== null;
}

/**
 * Get hint text for the current transition creation mode state.
 *
 * @param currentMode - The current transition creation mode state
 * @returns Hint text to display to the user
 */
export function getTransitionModeHintText(
  currentMode: TransitionCreationMode
): string {
  if (!currentMode.active) {
    return '';
  }

  if (currentMode.sourceStateNodeId === null) {
    return 'Click a state to select as source. Press Escape to cancel.';
  }

  return 'Click another state to create the transition. Press Escape to cancel.';
}
