/**
 * Temporal Splitting Utilities for Diagram-Level Temporality
 *
 * This module provides utilities for splitting diagram elements (nodes, edges, decorations)
 * into temporal versions when editing in a different time period than the element's validity.
 *
 * Key concepts:
 * - Elements have valid_from/valid_to fields defining when they are visible
 * - When editing in a future period, the old version gets closed (valid_to set) and a new version opens
 * - When editing in a past period, a new past version is created and the old version's valid_from is adjusted
 * - Null/undefined temporal fields mean "always valid" (timeless)
 */

import type { DiagramNode, DiagramEdge, Decoration, TemporalDiagramElement } from '../types/model';
import { compareQuarters, getPreviousQuarter, getNextQuarter, isDiagramElementVisibleInPeriod } from './quarterUtils';

/**
 * Generate a unique ID for a new element version
 * Uses the original ID with a timestamp suffix
 * @param originalId - The ID of the original element
 * @returns A new unique ID
 */
export function generateVersionId(originalId: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `${originalId}_v${timestamp}_${random}`;
}

/**
 * Check if an edit would require splitting an element into temporal versions
 *
 * A split is triggered when:
 * 1. The current editing period is outside the element's current validity
 * 2. OR the element has no temporal fields (timeless) and we're editing in a specific period
 *    (in this case, we may want to start versioning)
 *
 * @param element - The diagram element being edited
 * @param currentPeriod - The period in which editing is occurring (e.g., "2026-Q4")
 * @returns True if the edit should trigger a temporal split
 */
export function shouldTriggerSplit(
  element: TemporalDiagramElement,
  currentPeriod: string
): boolean {
  const { valid_from, valid_to } = element;

  // If element is timeless (no temporal fields), no split needed
  // Timeless elements remain timeless unless explicitly versioned
  if (!valid_from && !valid_to) {
    return false;
  }

  // If element is already visible in the current period, no split needed
  if (isDiagramElementVisibleInPeriod(element, currentPeriod)) {
    return false;
  }

  // Element is not visible in current period, split is needed
  return true;
}

/**
 * Determine if an edit is a "future" edit (editing after element's validity)
 * or a "past" edit (editing before element's validity)
 *
 * @param element - The diagram element being edited
 * @param currentPeriod - The period in which editing is occurring
 * @returns 'future' if editing after element's validity, 'past' if before, 'current' if within
 */
export function getEditDirection(
  element: TemporalDiagramElement,
  currentPeriod: string
): 'future' | 'past' | 'current' {
  const { valid_from, valid_to } = element;

  // If timeless, treat as current
  if (!valid_from && !valid_to) {
    return 'current';
  }

  // Check if editing in the future (after valid_to)
  if (valid_to) {
    try {
      if (compareQuarters(currentPeriod, valid_to) >= 0) {
        return 'future';
      }
    } catch {
      // Invalid format, treat as current
    }
  }

  // Check if editing in the past (before valid_from)
  if (valid_from) {
    try {
      if (compareQuarters(currentPeriod, valid_from) < 0) {
        return 'past';
      }
    } catch {
      // Invalid format, treat as current
    }
  }

  return 'current';
}

/**
 * Split result interface for diagram nodes
 */
export interface SplitDiagramNodeResult {
  /** The original node with updated temporal bounds */
  originalNode: DiagramNode;
  /** The new version of the node with applied changes */
  newVersion: DiagramNode;
}

/**
 * Split a diagram node into temporal versions when editing in a different period
 *
 * Splitting logic:
 * - FUTURE edit (editing after element's valid_to):
 *   - Original: valid_to = period_before(currentPeriod)
 *   - New version: valid_from = currentPeriod, valid_to = null (open-ended)
 *
 * - PAST edit (editing before element's valid_from):
 *   - Original: valid_from = period_after(currentPeriod)
 *   - New version: valid_from = null (or original's valid_from), valid_to = period_after(currentPeriod)
 *
 * @param node - The original diagram node
 * @param currentPeriod - The period in which editing is occurring
 * @param changes - Partial changes to apply to the new version
 * @returns Object containing the modified original and new version
 */
export function splitDiagramNode(
  node: DiagramNode,
  currentPeriod: string,
  changes: Partial<DiagramNode>
): SplitDiagramNodeResult {
  const editDirection = getEditDirection(node, currentPeriod);

  // Clone the node for the new version
  const newVersion: DiagramNode = {
    ...node,
    id: generateVersionId(node.id),
    ...changes,
  };

  // Clone the original node for modification
  const originalNode: DiagramNode = { ...node };

  if (editDirection === 'future') {
    // FUTURE edit: close the old version, open the new version
    originalNode.valid_to = getPreviousQuarter(currentPeriod);
    newVersion.valid_from = currentPeriod;
    newVersion.valid_to = undefined; // Open-ended into the future
  } else if (editDirection === 'past') {
    // PAST edit: create a past version, adjust original's start
    // New version covers the past period
    newVersion.valid_from = node.valid_from; // Keep original start if it had one
    newVersion.valid_to = currentPeriod; // Ends at the edit period (exclusive)
    // Original now starts after the edit period
    originalNode.valid_from = getNextQuarter(currentPeriod);
  } else {
    // CURRENT edit: shouldn't reach here if shouldTriggerSplit was used correctly
    // Just apply changes without splitting
    Object.assign(originalNode, changes);
    return { originalNode, newVersion: originalNode };
  }

  return { originalNode, newVersion };
}

/**
 * Split result interface for diagram edges
 */
export interface SplitDiagramEdgeResult {
  /** The original edge with updated temporal bounds */
  originalEdge: DiagramEdge;
  /** The new version of the edge with applied changes */
  newVersion: DiagramEdge;
}

/**
 * Split a diagram edge into temporal versions when editing in a different period
 *
 * @param edge - The original diagram edge
 * @param currentPeriod - The period in which editing is occurring
 * @param changes - Partial changes to apply to the new version
 * @returns Object containing the modified original and new version
 */
export function splitDiagramEdge(
  edge: DiagramEdge,
  currentPeriod: string,
  changes: Partial<DiagramEdge>
): SplitDiagramEdgeResult {
  const editDirection = getEditDirection(edge, currentPeriod);

  // Clone the edge for the new version
  // Need to deep clone edge_points array
  const newVersion: DiagramEdge = {
    ...edge,
    id: generateVersionId(edge.id),
    edge_points: edge.edge_points.map(ep => ({ ...ep })),
    ...changes,
  };

  // Clone the original edge for modification
  const originalEdge: DiagramEdge = {
    ...edge,
    edge_points: edge.edge_points.map(ep => ({ ...ep })),
  };

  if (editDirection === 'future') {
    // FUTURE edit: close the old version, open the new version
    originalEdge.valid_to = getPreviousQuarter(currentPeriod);
    newVersion.valid_from = currentPeriod;
    newVersion.valid_to = undefined;
  } else if (editDirection === 'past') {
    // PAST edit: create a past version, adjust original's start
    newVersion.valid_from = edge.valid_from;
    newVersion.valid_to = currentPeriod;
    originalEdge.valid_from = getNextQuarter(currentPeriod);
  } else {
    // CURRENT edit: just apply changes
    Object.assign(originalEdge, changes);
    return { originalEdge, newVersion: originalEdge };
  }

  return { originalEdge, newVersion };
}

/**
 * Split result interface for decorations
 */
export interface SplitDecorationResult {
  /** The original decoration with updated temporal bounds */
  originalDecoration: Decoration;
  /** The new version of the decoration with applied changes */
  newVersion: Decoration;
}

/**
 * Split a decoration into temporal versions when editing in a different period
 *
 * @param decoration - The original decoration
 * @param currentPeriod - The period in which editing is occurring
 * @param changes - Partial changes to apply to the new version
 * @returns Object containing the modified original and new version
 */
export function splitDecoration(
  decoration: Decoration,
  currentPeriod: string,
  changes: Partial<Decoration>
): SplitDecorationResult {
  const editDirection = getEditDirection(decoration, currentPeriod);

  // Clone the decoration for the new version
  // Handle line_points array for line-based decorations
  let newVersion: Decoration;
  if ('line_points' in decoration) {
    newVersion = {
      ...decoration,
      id: generateVersionId(decoration.id),
      line_points: decoration.line_points.map(p => ({ ...p })),
      ...changes,
    } as Decoration;
  } else {
    newVersion = {
      ...decoration,
      id: generateVersionId(decoration.id),
      ...changes,
    } as Decoration;
  }

  // Clone the original decoration for modification
  let originalDecoration: Decoration;
  if ('line_points' in decoration) {
    originalDecoration = {
      ...decoration,
      line_points: decoration.line_points.map(p => ({ ...p })),
    } as Decoration;
  } else {
    originalDecoration = { ...decoration } as Decoration;
  }

  if (editDirection === 'future') {
    // FUTURE edit: close the old version, open the new version
    originalDecoration.valid_to = getPreviousQuarter(currentPeriod);
    newVersion.valid_from = currentPeriod;
    newVersion.valid_to = undefined;
  } else if (editDirection === 'past') {
    // PAST edit: create a past version, adjust original's start
    newVersion.valid_from = decoration.valid_from;
    newVersion.valid_to = currentPeriod;
    originalDecoration.valid_from = getNextQuarter(currentPeriod);
  } else {
    // CURRENT edit: just apply changes
    Object.assign(originalDecoration, changes);
    return { originalDecoration, newVersion: originalDecoration };
  }

  return { originalDecoration, newVersion };
}

/**
 * Initialize temporal fields on an element if it's currently timeless
 * Used when starting to version a previously timeless element
 *
 * @param element - Element to initialize temporal fields on
 * @param currentPeriod - The current editing period
 * @returns Element with temporal fields initialized
 */
export function initializeTemporalFields<T extends TemporalDiagramElement>(
  element: T,
  currentPeriod: string
): T {
  if (element.valid_from || element.valid_to) {
    // Already has temporal fields, return as-is
    return element;
  }

  // Initialize as valid from current period onwards
  return {
    ...element,
    valid_from: currentPeriod,
    valid_to: undefined,
  };
}

/**
 * Create a new temporal version of an element that starts from a specific period
 * This is used for "fork" operations where you want to create a new branch from the current state
 *
 * @param element - The element to create a version from
 * @param startPeriod - The period when the new version should start
 * @param changes - Optional changes to apply to the new version
 * @returns New version of the element
 */
export function createNewTemporalVersion<T extends TemporalDiagramElement & { id: string }>(
  element: T,
  startPeriod: string,
  changes?: Partial<T>
): T {
  return {
    ...element,
    id: generateVersionId(element.id),
    valid_from: startPeriod,
    valid_to: undefined,
    ...changes,
  };
}

/**
 * Close an element's temporal validity at a specific period
 * Sets valid_to to one period before the given period
 *
 * @param element - The element to close
 * @param closePeriod - The period at which to close (valid_to will be set to previous quarter)
 * @returns Element with valid_to set
 */
export function closeTemporalValidity<T extends TemporalDiagramElement>(
  element: T,
  closePeriod: string
): T {
  return {
    ...element,
    valid_to: getPreviousQuarter(closePeriod),
  };
}
