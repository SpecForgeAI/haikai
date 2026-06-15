/**
 * Label Decoration Utilities
 * Spec 2025-12-31 (A5): Movable/Resizable Labels for Activity Diagrams
 *
 * This module provides utilities for creating and managing LabelDecoration elements
 * for Activity nodes and Activity Flow edges.
 *
 * Tasks implemented:
 * - 5.6: Create label decorations on Activity node creation
 * - 5.7: Create label decorations on Activity Flow creation
 * - 5.9: Drag handler for label decorations
 * - 5.10: Resize handler for label decorations
 * - 5.11: Handle existing diagrams without label decorations (virtual mode)
 */

import {
  LabelDecoration,
  DiagramNode,
  Activity,
  ActivityKind,
  createDefaultLabelDecoration,
} from '../types/model';
import {
  getDefaultLabelPosition,
  getDefaultEdgeLabelPosition,
} from './activityNodeRendering';

// ============================================================================
// Task 5.6: Create Label Decoration for Activity Node
// ============================================================================

/**
 * Determines if an Activity node should have a label decoration.
 * Only Action and Decision nodes show labels.
 *
 * @param activityKind - The kind of activity
 * @returns true if the activity kind should show a label
 */
export function shouldCreateNodeLabelDecoration(activityKind: ActivityKind): boolean {
  return activityKind === 'Action' || activityKind === 'Decision';
}

/**
 * Creates a LabelDecoration for an Activity node.
 *
 * Task 5.6: When creating new Activity node, also create label decoration
 * Uses appropriate default placement based on activity_kind:
 * - Action: label centered inside the rounded-rect
 * - Decision: label below the diamond
 *
 * @param nodeId - The diagram node ID
 * @param nodeBounds - The bounding box of the node {x, y, width, height}
 * @param activityKind - The kind of activity
 * @param activityName - Optional activity name for the label text
 * @returns A new LabelDecoration, or null if this activity kind doesn't show labels
 */
export function createNodeLabelDecoration(
  nodeId: string,
  nodeBounds: { x: number; y: number; width: number; height: number },
  activityKind: ActivityKind,
  activityName?: string
): LabelDecoration | null {
  // Only create labels for Action and Decision nodes
  if (!shouldCreateNodeLabelDecoration(activityKind)) {
    return null;
  }

  // Calculate default label position
  const labelPos = getDefaultLabelPosition(nodeBounds, activityKind);

  // Create the label decoration
  return createDefaultLabelDecoration(
    'NODE',
    nodeId,
    labelPos.x,
    labelPos.y,
    labelPos.width,
    labelPos.height,
    activityName // Optional text - if undefined, derived from entity at render time
  );
}

// ============================================================================
// Task 5.7: Create Label Decoration for Activity Flow Edge
// ============================================================================

/**
 * Creates a LabelDecoration for an Activity Flow edge.
 *
 * Task 5.7: When creating new Activity Flow edge, also create edge label decoration
 * Position near midpoint above line.
 *
 * @param edgeId - The diagram edge ID
 * @param sourceNode - The source activity DiagramNode
 * @param targetNode - The target activity DiagramNode
 * @param labelText - Optional label text for the flow
 * @returns A new LabelDecoration for the edge
 */
export function createEdgeLabelDecoration(
  edgeId: string,
  sourceNode: DiagramNode,
  targetNode: DiagramNode,
  labelText?: string
): LabelDecoration {
  // Calculate default edge label position
  const labelPos = getDefaultEdgeLabelPosition(sourceNode, targetNode);

  // Create the label decoration
  return createDefaultLabelDecoration(
    'EDGE',
    edgeId,
    labelPos.x,
    labelPos.y,
    labelPos.width,
    labelPos.height,
    labelText
  );
}

// ============================================================================
// Task 5.9: Drag Handler Types and Helpers
// ============================================================================

/**
 * Drag state for label decoration dragging
 */
export interface LabelDragState {
  /** Whether a drag is currently in progress */
  isDragging: boolean;
  /** The ID of the label decoration being dragged */
  labelDecorationId: string | null;
  /** Starting X position of the drag (label position) */
  startX: number;
  /** Starting Y position of the drag (label position) */
  startY: number;
  /** Starting mouse X position */
  mouseStartX: number;
  /** Starting mouse Y position */
  mouseStartY: number;
}

/**
 * Initial state for label drag operations
 */
export const initialLabelDragState: LabelDragState = {
  isDragging: false,
  labelDecorationId: null,
  startX: 0,
  startY: 0,
  mouseStartX: 0,
  mouseStartY: 0,
};

/**
 * Start a label decoration drag operation.
 *
 * Task 5.9: Allow dragging label to update x/y position.
 *
 * @param labelDecoration - The label decoration being dragged
 * @param mouseX - Current mouse X position (in diagram coordinates)
 * @param mouseY - Current mouse Y position (in diagram coordinates)
 * @returns New drag state with drag started
 */
export function startLabelDrag(
  labelDecoration: LabelDecoration,
  mouseX: number,
  mouseY: number
): LabelDragState {
  return {
    isDragging: true,
    labelDecorationId: labelDecoration.id,
    startX: labelDecoration.x,
    startY: labelDecoration.y,
    mouseStartX: mouseX,
    mouseStartY: mouseY,
  };
}

/**
 * Calculate new label position during drag.
 *
 * Task 5.9: Ensure underlying node/edge does NOT move.
 *
 * @param dragState - Current drag state
 * @param currentMouseX - Current mouse X position
 * @param currentMouseY - Current mouse Y position
 * @returns New label position {x, y}
 */
export function calculateLabelDragPosition(
  dragState: LabelDragState,
  currentMouseX: number,
  currentMouseY: number
): { x: number; y: number } {
  const dx = currentMouseX - dragState.mouseStartX;
  const dy = currentMouseY - dragState.mouseStartY;

  return {
    x: dragState.startX + dx,
    y: dragState.startY + dy,
  };
}

/**
 * End a label decoration drag operation.
 *
 * @returns Reset drag state
 */
export function endLabelDrag(): LabelDragState {
  return { ...initialLabelDragState };
}

// ============================================================================
// Task 5.10: Resize Handler Types and Helpers
// ============================================================================

/**
 * Resize handle position type
 */
export type ResizeHandle = 'nw' | 'ne' | 'sw' | 'se';

/**
 * Resize state for label decoration resizing
 */
export interface LabelResizeState {
  /** Whether a resize is currently in progress */
  isResizing: boolean;
  /** The ID of the label decoration being resized */
  labelDecorationId: string | null;
  /** Which handle is being dragged */
  handle: ResizeHandle | null;
  /** Starting X position of the label */
  startX: number;
  /** Starting Y position of the label */
  startY: number;
  /** Starting width of the label */
  startWidth: number;
  /** Starting height of the label */
  startHeight: number;
  /** Starting mouse X position */
  mouseStartX: number;
  /** Starting mouse Y position */
  mouseStartY: number;
}

/**
 * Initial state for label resize operations
 */
export const initialLabelResizeState: LabelResizeState = {
  isResizing: false,
  labelDecorationId: null,
  handle: null,
  startX: 0,
  startY: 0,
  startWidth: 0,
  startHeight: 0,
  mouseStartX: 0,
  mouseStartY: 0,
};

/**
 * Start a label decoration resize operation.
 *
 * Task 5.10: Allow resizing label to update width/height.
 *
 * @param labelDecoration - The label decoration being resized
 * @param handle - Which resize handle was clicked
 * @param mouseX - Current mouse X position (in diagram coordinates)
 * @param mouseY - Current mouse Y position (in diagram coordinates)
 * @returns New resize state with resize started
 */
export function startLabelResize(
  labelDecoration: LabelDecoration,
  handle: ResizeHandle,
  mouseX: number,
  mouseY: number
): LabelResizeState {
  return {
    isResizing: true,
    labelDecorationId: labelDecoration.id,
    handle,
    startX: labelDecoration.x,
    startY: labelDecoration.y,
    startWidth: labelDecoration.width,
    startHeight: labelDecoration.height,
    mouseStartX: mouseX,
    mouseStartY: mouseY,
  };
}

/** Minimum label dimensions */
const MIN_LABEL_WIDTH = 20;
const MIN_LABEL_HEIGHT = 14;

/**
 * Calculate new label dimensions during resize.
 *
 * Task 5.10: Text should wrap within new bounds.
 *
 * @param resizeState - Current resize state
 * @param currentMouseX - Current mouse X position
 * @param currentMouseY - Current mouse Y position
 * @returns New label bounds {x, y, width, height}
 */
export function calculateLabelResizeBounds(
  resizeState: LabelResizeState,
  currentMouseX: number,
  currentMouseY: number
): { x: number; y: number; width: number; height: number } {
  const dx = currentMouseX - resizeState.mouseStartX;
  const dy = currentMouseY - resizeState.mouseStartY;

  let newX = resizeState.startX;
  let newY = resizeState.startY;
  let newWidth = resizeState.startWidth;
  let newHeight = resizeState.startHeight;

  switch (resizeState.handle) {
    case 'nw':
      // Top-left corner: adjust x, y, width, height
      newX = resizeState.startX + dx;
      newY = resizeState.startY + dy;
      newWidth = resizeState.startWidth - dx;
      newHeight = resizeState.startHeight - dy;
      break;

    case 'ne':
      // Top-right corner: adjust y, width, height
      newY = resizeState.startY + dy;
      newWidth = resizeState.startWidth + dx;
      newHeight = resizeState.startHeight - dy;
      break;

    case 'sw':
      // Bottom-left corner: adjust x, width, height
      newX = resizeState.startX + dx;
      newWidth = resizeState.startWidth - dx;
      newHeight = resizeState.startHeight + dy;
      break;

    case 'se':
      // Bottom-right corner: adjust width, height only
      newWidth = resizeState.startWidth + dx;
      newHeight = resizeState.startHeight + dy;
      break;
  }

  // Enforce minimum dimensions
  if (newWidth < MIN_LABEL_WIDTH) {
    if (resizeState.handle === 'nw' || resizeState.handle === 'sw') {
      // Resizing from left - fix x position
      newX = resizeState.startX + resizeState.startWidth - MIN_LABEL_WIDTH;
    }
    newWidth = MIN_LABEL_WIDTH;
  }

  if (newHeight < MIN_LABEL_HEIGHT) {
    if (resizeState.handle === 'nw' || resizeState.handle === 'ne') {
      // Resizing from top - fix y position
      newY = resizeState.startY + resizeState.startHeight - MIN_LABEL_HEIGHT;
    }
    newHeight = MIN_LABEL_HEIGHT;
  }

  return { x: newX, y: newY, width: newWidth, height: newHeight };
}

/**
 * End a label decoration resize operation.
 *
 * @returns Reset resize state
 */
export function endLabelResize(): LabelResizeState {
  return { ...initialLabelResizeState };
}

// ============================================================================
// Task 5.11: Virtual Mode Helpers
// ============================================================================

/**
 * Check if a click position is within a virtual label area.
 * Used to detect when user clicks on a virtual label to persist it.
 *
 * Task 5.11: Create decoration on first user interaction (drag or resize).
 *
 * @param clickX - Click X position
 * @param clickY - Click Y position
 * @param labelBounds - Virtual label bounds {x, y, width, height}
 * @returns true if click is within the virtual label area
 */
export function isClickOnVirtualLabel(
  clickX: number,
  clickY: number,
  labelBounds: { x: number; y: number; width: number; height: number }
): boolean {
  return (
    clickX >= labelBounds.x &&
    clickX <= labelBounds.x + labelBounds.width &&
    clickY >= labelBounds.y &&
    clickY <= labelBounds.y + labelBounds.height
  );
}

/**
 * Create a LabelDecoration from virtual label data.
 *
 * Task 5.11: Persist on first interaction if in virtual mode.
 *
 * @param targetKind - 'NODE' or 'EDGE'
 * @param targetId - The node or edge ID
 * @param virtualBounds - The virtual label bounds
 * @param text - Optional label text
 * @returns A new LabelDecoration
 */
export function persistVirtualLabel(
  targetKind: 'NODE' | 'EDGE',
  targetId: string,
  virtualBounds: { x: number; y: number; width: number; height: number },
  text?: string
): LabelDecoration {
  return createDefaultLabelDecoration(
    targetKind,
    targetId,
    virtualBounds.x,
    virtualBounds.y,
    virtualBounds.width,
    virtualBounds.height,
    text
  );
}

// ============================================================================
// Utility: Find label decoration by target
// ============================================================================

/**
 * Find a label decoration for a specific node or edge.
 *
 * @param labelDecorations - Array of label decorations
 * @param targetKind - 'NODE' or 'EDGE'
 * @param targetId - The node or edge ID to find
 * @returns The label decoration if found, undefined otherwise
 */
export function findLabelDecoration(
  labelDecorations: LabelDecoration[],
  targetKind: 'NODE' | 'EDGE',
  targetId: string
): LabelDecoration | undefined {
  return labelDecorations.find(
    (ld) => ld.targetKind === targetKind && ld.targetId === targetId
  );
}
