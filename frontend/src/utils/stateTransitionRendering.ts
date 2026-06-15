/**
 * State Transition Edge Rendering Functions
 * Task Group 3: State Transition Edge Rendering and Label Resolution
 *
 * Provides rendering functions for state transition edges:
 * - renderStateTransition: Renders edge between states with arrowhead
 * - resolveTransitionLabel: Resolves label from trigger/guard/effect fields
 *
 * Label resolution follows priority order:
 * - Priority 1: triggerRefKind/triggerRefId -> Method or Event name
 * - Priority 2: triggerLabelText if present
 * - Priority 3: guardExpression wrapped in square brackets
 * - Priority 4: effectRefKind/effectRefId -> Method name
 * - Combined format: trigger [guard] / effect
 *
 * Follows patterns from activityNodeRendering.ts (renderActivityFlow)
 */

import { calculateArrowhead } from './rendering';
import { StateTransition, MetaModel, Method, Event } from '../types/model';

/**
 * Position interface for edge endpoints
 */
export interface EdgePosition {
  x: number;
  y: number;
}

/**
 * Result interface for state transition rendering
 * Following ActivityFlowRenderResult pattern
 */
export interface StateTransitionRenderResult {
  /** SVG path data for the line */
  linePath: string;
  /** SVG path data for the arrowhead */
  arrowheadPath: string;
  /** Stroke color for the line */
  strokeColor: string;
  /** Stroke width for the line */
  strokeWidth: number;
  /** Fill color for the arrowhead (same as stroke color) */
  arrowheadFill: string;
  /** Label position (midpoint of edge) */
  labelPosition?: { x: number; y: number };
  /** Label text (resolved from transition entity) */
  labelText?: string;
  /** Label font size */
  labelFontSize: number;
  /** Label offset from midpoint */
  labelOffset: number;
}

// Default styling constants for state transitions
const STATE_TRANSITION_DEFAULTS = {
  strokeColor: '#333333',
  strokeWidth: 2,
  arrowSize: 8,
  labelFontSize: 11,
  labelOffset: 5,
};

/**
 * Calculate the midpoint position for state transition label placement
 *
 * @param sourcePosition - Source state center position
 * @param targetPosition - Target state center position
 * @returns Position at the midpoint of the edge
 */
export function calculateTransitionLabelPosition(
  sourcePosition: EdgePosition,
  targetPosition: EdgePosition
): EdgePosition {
  return {
    x: (sourcePosition.x + targetPosition.x) / 2,
    y: (sourcePosition.y + targetPosition.y) / 2,
  };
}

/**
 * Resolve trigger label from StateTransition
 * Priority 1: triggerRefKind/triggerRefId -> Method or Event name
 * Priority 2: triggerLabelText
 *
 * @param transition - The StateTransition entity
 * @param metaModel - The MetaModel for entity lookups
 * @returns Resolved trigger string or undefined
 */
function resolveTrigger(
  transition: StateTransition,
  metaModel: MetaModel
): string | undefined {
  // Priority 1: Trigger reference (Method or Event)
  if (transition.trigger_ref_kind && transition.trigger_ref_id) {
    if (transition.trigger_ref_kind === 'Method') {
      const method = metaModel.entities.methods.find(
        (m: Method) => m.id === transition.trigger_ref_id
      );
      if (method) {
        return method.name;
      }
    } else if (transition.trigger_ref_kind === 'Event') {
      const event = metaModel.entities.events.find(
        (e: Event) => e.id === transition.trigger_ref_id
      );
      if (event) {
        return event.name;
      }
    }
    // Reference not found - fall through to label text
  }

  // Priority 2: Trigger label text
  if (transition.trigger_label_text) {
    return transition.trigger_label_text;
  }

  return undefined;
}

/**
 * Resolve guard label from StateTransition
 * Priority: guardRefKind/guardRefId -> Method name, then guardExpression
 *
 * @param transition - The StateTransition entity
 * @param metaModel - The MetaModel for entity lookups
 * @returns Resolved guard string (without brackets) or undefined
 */
function resolveGuard(
  transition: StateTransition,
  metaModel: MetaModel
): string | undefined {
  // Priority: Guard reference (Method)
  if (transition.guard_ref_kind && transition.guard_ref_id) {
    if (transition.guard_ref_kind === 'Method') {
      const method = metaModel.entities.methods.find(
        (m: Method) => m.id === transition.guard_ref_id
      );
      if (method) {
        return method.name;
      }
    }
    // Reference not found - fall through to expression
  }

  // Guard expression
  if (transition.guard_expression) {
    return transition.guard_expression;
  }

  return undefined;
}

/**
 * Resolve effect label from StateTransition
 * Priority: effectRefKind/effectRefId -> Method name, then effectLabelText
 *
 * @param transition - The StateTransition entity
 * @param metaModel - The MetaModel for entity lookups
 * @returns Resolved effect string or undefined
 */
function resolveEffect(
  transition: StateTransition,
  metaModel: MetaModel
): string | undefined {
  // Priority: Effect reference (Method)
  if (transition.effect_ref_kind && transition.effect_ref_id) {
    if (transition.effect_ref_kind === 'Method') {
      const method = metaModel.entities.methods.find(
        (m: Method) => m.id === transition.effect_ref_id
      );
      if (method) {
        return method.name;
      }
    }
    // Reference not found - fall through to label text
  }

  // Effect label text
  if (transition.effect_label_text) {
    return transition.effect_label_text;
  }

  return undefined;
}

/**
 * Resolve complete transition label from StateTransition entity
 *
 * Combines trigger, guard, and effect according to UML state machine notation:
 * - Format: trigger [guard] / effect
 * - Each part is optional
 * - Guard is wrapped in square brackets
 * - Effect is prefixed with "/ "
 *
 * @param transition - The StateTransition entity
 * @param metaModel - The MetaModel for entity lookups
 * @returns Combined label string or undefined if no content
 */
export function resolveTransitionLabel(
  transition: StateTransition,
  metaModel: MetaModel
): string | undefined {
  const trigger = resolveTrigger(transition, metaModel);
  const guard = resolveGuard(transition, metaModel);
  const effect = resolveEffect(transition, metaModel);

  // Build label parts
  const parts: string[] = [];

  // Add trigger if present
  if (trigger) {
    parts.push(trigger);
  }

  // Add guard wrapped in brackets if present
  if (guard) {
    parts.push(`[${guard}]`);
  }

  // Add effect prefixed with "/ " if present
  if (effect) {
    parts.push(`/ ${effect}`);
  }

  // Return combined string or undefined
  if (parts.length === 0) {
    return undefined;
  }

  // Join parts with spaces
  return parts.join(' ');
}

/**
 * Render a state transition edge between two states
 *
 * Task Group 3: State Transition Edge Rendering
 *
 * Specifications:
 * - Render as straight line connecting source and target state nodes
 * - Arrowhead points to target state
 * - Label position at midpoint, slightly above line
 * - Solid line styling
 *
 * @param sourcePosition - Source state center position
 * @param targetPosition - Target state center position
 * @param labelText - Optional label text for the transition
 * @returns StateTransitionRenderResult with line and arrowhead path data
 */
export function renderStateTransition(
  sourcePosition: EdgePosition,
  targetPosition: EdgePosition,
  labelText?: string
): StateTransitionRenderResult {
  const defaults = STATE_TRANSITION_DEFAULTS;

  // Calculate arrowhead using existing utility from rendering.ts
  const arrowheadPath = calculateArrowhead(
    sourcePosition.x,
    sourcePosition.y,
    targetPosition.x,
    targetPosition.y,
    defaults.arrowSize
  );

  // Create line path from source to target (straight line)
  const linePath = `M ${sourcePosition.x} ${sourcePosition.y} L ${targetPosition.x} ${targetPosition.y}`;

  // Calculate label position at midpoint
  const labelPosition = calculateTransitionLabelPosition(sourcePosition, targetPosition);

  return {
    linePath,
    arrowheadPath,
    strokeColor: defaults.strokeColor,
    strokeWidth: defaults.strokeWidth,
    arrowheadFill: defaults.strokeColor,
    labelPosition,
    labelText,
    labelFontSize: defaults.labelFontSize,
    labelOffset: defaults.labelOffset,
  };
}

/**
 * Render a state transition edge as a polyline through multiple points.
 *
 * Builds an SVG path through all provided points, calculates the arrowhead
 * from the last two points, and places the label at the polyline midpoint.
 *
 * @param points - Array of 2+ edge positions defining the polyline
 * @param labelText - Optional label text for the transition
 * @returns StateTransitionRenderResult with polyline path and arrowhead
 */
export function renderStateTransitionPolyline(
  points: EdgePosition[],
  labelText?: string
): StateTransitionRenderResult {
  const defaults = STATE_TRANSITION_DEFAULTS;

  // Build SVG path: M p0 L p1 L p2 ... L pN
  const linePath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
    .join(' ');

  // Arrowhead from the last two points
  const lastIdx = points.length - 1;
  const arrowheadPath = calculateArrowhead(
    points[lastIdx - 1].x,
    points[lastIdx - 1].y,
    points[lastIdx].x,
    points[lastIdx].y,
    defaults.arrowSize
  );

  // Label position: midpoint of the middle segment
  const midSegIndex = Math.floor((points.length - 1) / 2);
  const labelPosition: EdgePosition = {
    x: (points[midSegIndex].x + points[midSegIndex + 1].x) / 2,
    y: (points[midSegIndex].y + points[midSegIndex + 1].y) / 2,
  };

  return {
    linePath,
    arrowheadPath,
    strokeColor: defaults.strokeColor,
    strokeWidth: defaults.strokeWidth,
    arrowheadFill: defaults.strokeColor,
    labelPosition,
    labelText,
    labelFontSize: defaults.labelFontSize,
    labelOffset: defaults.labelOffset,
  };
}
