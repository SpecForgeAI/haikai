/**
 * sequenceLayout.ts
 *
 * Pure function for computing Sequence Diagram layout.
 * This module calculates positions, dimensions, and row indices for all
 * sequence diagram elements (participants, messages, fragments).
 *
 * The layout engine:
 * - Computes participant X positions based on spacing
 * - Computes lifeline centerlines
 * - Performs DFS traversal of sequence nodes for row assignment
 * - Calculates fragment vertical extents
 * - Handles edge cases (empty diagrams, fragments without messages)
 * - Computes participant redraw positions for tall diagrams
 * - Supports dynamic per-message row heights for multi-line labels
 */

import {
  SequenceDiagram,
  SequenceMessage,
  SequenceFragment,
  SequenceOperand,
  SequenceNode,
} from '../types/sequenceDiagram';

// ============================================================================
// Layout Constants
// ============================================================================

/**
 * Constants used for layout calculations.
 * These values define the spacing and sizing of sequence diagram elements.
 */
export const LAYOUT_CONSTANTS = {
  /** Width of the participant header box */
  headerBoxWidth: 150,
  /** Height of the participant header box (for non-user participants) */
  headerBoxHeight: 50,
  /** Height of the user participant header (stickman + label) */
  userHeaderHeight: 70,
  /** Top margin from canvas top to header area */
  topMargin: 40,
  /** Left margin from canvas left to first participant */
  leftMargin: 60,
  /** Height of each message row (default for 1-line labels) */
  rowHeight: 60,
  /** Vertical distance threshold before redrawing participant headers */
  PARTICIPANT_REDRAW_THRESHOLD: 1000,
} as const;

/**
 * Vertical height of the self-message loopback arrow.
 * Shared between the layout engine and the renderer to avoid duplication.
 */
export const SELF_MESSAGE_LOOP_HEIGHT = 30;

/**
 * Computes the row height for a message based on its label line count.
 * Default 60px for 1 line; ~70px for 2 lines; ~80px for 3 lines.
 *
 * @param lineCount - Number of label lines (0 or 1 = default)
 * @returns Row height in pixels
 */
export function computeRowHeight(lineCount: number): number {
  if (lineCount <= 1) return LAYOUT_CONSTANTS.rowHeight;
  // Add 10px per additional line beyond the first
  return LAYOUT_CONSTANTS.rowHeight + (lineCount - 1) * 10;
}

// ============================================================================
// Layout Result Interfaces
// ============================================================================

/**
 * Layout information for a single participant.
 * Contains position and dimension data for rendering.
 */
export interface ParticipantLayout {
  /** ID of the participant */
  participantId: string;
  /** Reference kind (e.g., 'Application', 'BusinessUser') */
  refKind: string;
  /** Reference ID for entity lookup */
  refId: string;
  /** X position of the participant header (top-left) */
  x: number;
  /** Y position of the participant header (top-left) */
  y: number;
  /** Width of the header box */
  width: number;
  /** Height of the header box */
  height: number;
  /** X position of the lifeline (centerline) */
  lifelineX: number;
  /** Order index for sorting */
  orderIndex: number;
}

/**
 * Layout information for a single message.
 * Contains position and row index data for rendering.
 */
export interface MessageLayout {
  /** ID of the message */
  messageId: string;
  /** ID of the source participant */
  fromParticipantId: string;
  /** ID of the target participant */
  toParticipantId: string;
  /** Exchange role (Request or Response) */
  exchangeRole: string;
  /** Exchange ID for grouping request/response pairs */
  exchangeId: string;
  /** Reference kind for entity lookup (optional) */
  refKind?: string;
  /** Reference ID for entity lookup (optional) */
  refId?: string;
  /** Free-text label (optional) */
  labelText?: string;
  /** Row index (0-based) from DFS traversal */
  rowIndex: number;
  /** Y position of the message arrow */
  y: number;
  /** X position of the source lifeline */
  fromX: number;
  /** X position of the target lifeline */
  toX: number;
}

/**
 * Layout information for a single fragment.
 * Contains position, extent, and operand data for rendering.
 */
export interface FragmentLayout {
  /** ID of the fragment */
  fragmentId: string;
  /** Fragment kind (Loop, Optional, Alternative) */
  fragmentKind: string;
  /** Optional label text */
  labelText?: string;
  /** Node ID of this fragment in the sequence tree */
  nodeId: string;
  /** Starting row index (first descendant message) */
  startRow: number;
  /** Ending row index (last descendant message) */
  endRow: number;
  /** Top Y position of the frame */
  topY: number;
  /** Bottom Y position of the frame */
  bottomY: number;
  /** Left X position of the frame */
  leftX: number;
  /** Right X position of the frame */
  rightX: number;
  /** Operands for this fragment (sorted by operand_index) */
  operands: OperandLayout[];
}

/**
 * Layout information for a single operand within a fragment.
 */
export interface OperandLayout {
  /** ID of the operand */
  operandId: string;
  /** Guard expression text */
  guardExpression: string;
  /** Operand index for ordering */
  operandIndex: number;
}

/**
 * Complete layout result for a sequence diagram.
 * Contains all computed layout data for rendering.
 */
export interface SequenceLayoutResult {
  /** Layout data for all participants */
  participantLayouts: ParticipantLayout[];
  /** Layout data for all messages */
  messageLayouts: MessageLayout[];
  /** Layout data for all fragments */
  fragmentLayouts: FragmentLayout[];
  /** Y position where lifelines start (below headers) */
  lifelineTopY: number;
  /** Y position where messages start */
  messageStartY: number;
  /** Y position where lifelines end */
  lifelineBottomY: number;
  /** Total message row count */
  messageRowCount: number;
  /** Lookup map: participantId -> lifelineX */
  lifelineXMap: Map<string, number>;
  /** Y positions where participant headers should be redrawn */
  participantRedrawYPositions: number[];
}

// ============================================================================
// Helper Types
// ============================================================================

/**
 * Internal type for tracking DFS traversal state.
 */
interface DFSContext {
  currentRow: number;
  /** Cumulative Y offset from message start (accounts for dynamic row heights) */
  currentYOffset: number;
  messageLayouts: MessageLayout[];
  fragmentRowExtents: Map<string, { startRow: number; endRow: number }>;
}

// ============================================================================
// Main Layout Function
// ============================================================================

/**
 * Computes the complete layout for a sequence diagram.
 *
 * This is a pure function with no side effects. It takes the sequence diagram
 * data and spacing configuration, and returns all computed layout information
 * needed for rendering.
 *
 * @param sequenceDiagram - The sequence diagram data to layout
 * @param participantSpacing - Horizontal spacing between participants (default: 220)
 * @param messageLabelLineCounts - Optional map of messageId to label line count for dynamic row heights
 * @returns Complete layout result with all positions and dimensions
 */
export function computeSequenceLayout(
  sequenceDiagram: SequenceDiagram,
  participantSpacing: number = 220,
  messageLabelLineCounts?: Map<string, number>
): SequenceLayoutResult {
  const {
    headerBoxWidth,
    headerBoxHeight,
    userHeaderHeight,
    topMargin,
    leftMargin,
    rowHeight,
    PARTICIPANT_REDRAW_THRESHOLD,
  } = LAYOUT_CONSTANTS;

  // -------------------------------------------------------------------------
  // Step 1: Compute participant layouts
  // -------------------------------------------------------------------------

  // Sort participants by order_index ascending
  const sortedParticipants = [...sequenceDiagram.participants].sort(
    (a, b) => a.order_index - b.order_index
  );

  // Compute header area height (max of box and user header heights)
  const headerAreaHeight = Math.max(headerBoxHeight, userHeaderHeight);

  // Compute lifelineTopY and messageStartY
  const lifelineTopY = topMargin + headerAreaHeight + 10;
  const messageStartY = lifelineTopY + 30;

  // Build participant layouts and lifelineX lookup map
  const lifelineXMap = new Map<string, number>();
  const participantLayouts: ParticipantLayout[] = sortedParticipants.map(
    (participant, index) => {
      const x = leftMargin + index * participantSpacing;
      const lifelineX = x + headerBoxWidth / 2;
      const isUser = participant.ref_kind === 'BusinessUser';
      const height = isUser ? userHeaderHeight : headerBoxHeight;

      lifelineXMap.set(participant.id, lifelineX);

      return {
        participantId: participant.id,
        refKind: participant.ref_kind,
        refId: participant.ref_id,
        x,
        y: topMargin,
        width: headerBoxWidth,
        height,
        lifelineX,
        orderIndex: participant.order_index,
      };
    }
  );

  // -------------------------------------------------------------------------
  // Step 2: Build lookup maps for messages, fragments, operands
  // -------------------------------------------------------------------------

  const messageMap = new Map<string, SequenceMessage>();
  for (const msg of sequenceDiagram.messages) {
    messageMap.set(msg.id, msg);
  }

  const fragmentMap = new Map<string, SequenceFragment>();
  for (const frag of sequenceDiagram.fragments) {
    fragmentMap.set(frag.id, frag);
  }

  const operandsByFragmentId = new Map<string, SequenceOperand[]>();
  for (const operand of sequenceDiagram.operands) {
    const list = operandsByFragmentId.get(operand.fragment_id) || [];
    list.push(operand);
    operandsByFragmentId.set(operand.fragment_id, list);
  }
  // Sort operands by operand_index
  for (const [, operands] of operandsByFragmentId) {
    operands.sort((a, b) => a.operand_index - b.operand_index);
  }

  // -------------------------------------------------------------------------
  // Step 3: Build node tree for DFS traversal
  // -------------------------------------------------------------------------

  // Group nodes by parent (null for top-level, nodeId for children)
  const nodesByParent = new Map<string | null, SequenceNode[]>();
  for (const node of sequenceDiagram.sequence_nodes) {
    const parentKey = node.parent_node_id ?? null;
    const list = nodesByParent.get(parentKey) || [];
    list.push(node);
    nodesByParent.set(parentKey, list);
  }
  // Sort each group by order_index
  for (const [, nodes] of nodesByParent) {
    nodes.sort((a, b) => a.order_index - b.order_index);
  }

  // -------------------------------------------------------------------------
  // Step 4: DFS traversal to assign row indices (with dynamic row heights)
  // -------------------------------------------------------------------------

  const dfsContext: DFSContext = {
    currentRow: 0,
    currentYOffset: 0,
    messageLayouts: [],
    fragmentRowExtents: new Map(),
  };

  // Track fragment node IDs for later lookup
  const fragmentNodeIdMap = new Map<string, string>();

  function dfsTraverse(parentNodeId: string | null): void {
    const children = nodesByParent.get(parentNodeId) || [];

    for (const node of children) {
      if (node.node_kind === 'Message' && node.message_id) {
        // Message node consumes 1 row
        const message = messageMap.get(node.message_id);
        if (message) {
          const rowIndex = dfsContext.currentRow;
          const y = messageStartY + dfsContext.currentYOffset;
          const fromX = lifelineXMap.get(message.from_participant_id) ?? 0;
          const toX = lifelineXMap.get(message.to_participant_id) ?? 0;

          // Get dynamic row height based on label line count
          const lineCount = messageLabelLineCounts?.get(message.id) ?? 1;
          const msgRowHeight = computeRowHeight(lineCount);

          dfsContext.messageLayouts.push({
            messageId: message.id,
            fromParticipantId: message.from_participant_id,
            toParticipantId: message.to_participant_id,
            exchangeRole: message.exchange_role,
            exchangeId: message.exchange_id,
            refKind: message.ref_kind,
            refId: message.ref_id,
            labelText: message.label_text,
            rowIndex,
            y,
            fromX,
            toX,
          });

          dfsContext.currentRow++;
          dfsContext.currentYOffset += msgRowHeight;

          // Self-messages need extra vertical space for the loopback arrow
          if (message.from_participant_id === message.to_participant_id) {
            dfsContext.currentRow += 0.5;
            dfsContext.currentYOffset += SELF_MESSAGE_LOOP_HEIGHT;
          }
        }
      } else if (node.node_kind === 'Fragment' && node.fragment_id) {
        // Fragment node consumes 0 rows itself (boundary only)
        // Record the starting row before traversing children
        const startRow = dfsContext.currentRow;

        // Store node ID for this fragment
        fragmentNodeIdMap.set(node.fragment_id, node.id);

        // Recursively traverse children
        dfsTraverse(node.id);

        // Compute end row (last row used by descendants)
        // If no messages were added (empty fragment), use placeholder
        let endRow = dfsContext.currentRow - 1;
        if (endRow < startRow) {
          // Empty fragment - use placeholder extent of 1 row
          endRow = startRow;
          // Note: we don't increment currentRow for placeholder since
          // the fragment itself doesn't consume a row
        }

        dfsContext.fragmentRowExtents.set(node.fragment_id, {
          startRow,
          endRow,
        });
      }
    }
  }

  // Start DFS from root (parent_node_id === null)
  dfsTraverse(null);

  // -------------------------------------------------------------------------
  // Step 5: Build fragment layouts from computed extents
  // -------------------------------------------------------------------------

  // Compute horizontal span: first participant lifelineX - 80 to last lifelineX + 80
  const firstLifelineX = participantLayouts.length > 0
    ? participantLayouts[0].lifelineX
    : leftMargin + headerBoxWidth / 2;
  const lastLifelineX = participantLayouts.length > 0
    ? participantLayouts[participantLayouts.length - 1].lifelineX
    : leftMargin + headerBoxWidth / 2;
  const frameLeftX = firstLifelineX - 80;
  const frameRightX = lastLifelineX + 80;

  // Build a Y lookup from messageLayouts for fragment positioning
  const messageYByRow = new Map<number, number>();
  for (const ml of dfsContext.messageLayouts) {
    messageYByRow.set(ml.rowIndex, ml.y);
  }

  const fragmentLayouts: FragmentLayout[] = [];
  for (const [fragmentId, extent] of dfsContext.fragmentRowExtents) {
    const fragment = fragmentMap.get(fragmentId);
    if (!fragment) continue;

    const nodeId = fragmentNodeIdMap.get(fragmentId) ?? '';
    const operands = operandsByFragmentId.get(fragmentId) || [];

    // Compute vertical span using actual Y positions from message layouts
    const startMsgY = messageYByRow.get(extent.startRow) ?? (messageStartY + extent.startRow * rowHeight);
    const endMsgY = messageYByRow.get(extent.endRow) ?? (messageStartY + extent.endRow * rowHeight);
    const topY = startMsgY - 30;
    const bottomY = endMsgY + 30;

    fragmentLayouts.push({
      fragmentId,
      fragmentKind: fragment.fragment_kind,
      labelText: fragment.label_text,
      nodeId,
      startRow: extent.startRow,
      endRow: extent.endRow,
      topY,
      bottomY,
      leftX: frameLeftX,
      rightX: frameRightX,
      operands: operands.map((op) => ({
        operandId: op.id,
        guardExpression: op.guard_expression,
        operandIndex: op.operand_index,
      })),
    });
  }

  // -------------------------------------------------------------------------
  // Step 6: Compute lifeline height
  // -------------------------------------------------------------------------

  const messageRowCount = dfsContext.currentRow;
  const totalYOffset = dfsContext.currentYOffset;
  // lifelineBottomY uses the actual accumulated Y offset
  let lifelineBottomY =
    messageStartY + Math.max(rowHeight, totalYOffset) + 60;

  // -------------------------------------------------------------------------
  // Step 7: Compute participant redraw positions
  // -------------------------------------------------------------------------

  const participantRedrawYPositions: number[] = [];

  // Build a sorted list of fragment row extents for quick "inside fragment" checks
  const fragmentExtentsList = Array.from(dfsContext.fragmentRowExtents.values());

  // Sort message layouts by rowIndex for the walk
  const sortedMessages = [...dfsContext.messageLayouts].sort(
    (a, b) => a.rowIndex - b.rowIndex
  );

  if (sortedMessages.length > 0) {
    let lastRedrawY = topMargin;
    let redrawPending = false;
    // Track the bottomY of the outermost pending fragment
    let pendingFragmentBottomY = 0;

    for (const msg of sortedMessages) {
      const messageY = msg.y;

      // Check if this message's row is inside any fragment
      const insideFragment = fragmentExtentsList.some(
        (ext) => msg.rowIndex >= ext.startRow && msg.rowIndex <= ext.endRow
      );

      if (messageY - lastRedrawY >= PARTICIPANT_REDRAW_THRESHOLD) {
        if (!insideFragment) {
          // Record redraw between rows
          const redrawY = messageY - rowHeight / 2;
          participantRedrawYPositions.push(redrawY);
          lastRedrawY = redrawY;
          redrawPending = false;
        } else {
          // Defer -- find outermost fragment containing this row
          redrawPending = true;
          let maxBottomRow = -1;
          for (const ext of fragmentExtentsList) {
            if (msg.rowIndex >= ext.startRow && msg.rowIndex <= ext.endRow) {
              if (ext.endRow > maxBottomRow) {
                maxBottomRow = ext.endRow;
              }
            }
          }
          // Compute the bottomY of that outermost fragment
          const endY = messageYByRow.get(maxBottomRow) ?? (messageStartY + maxBottomRow * rowHeight);
          pendingFragmentBottomY = endY + 30;
        }
      }

      // Check if we just exited the pending fragment
      if (redrawPending && !insideFragment) {
        // Place redraw after the fragment's bottomY
        const redrawY = pendingFragmentBottomY + rowHeight / 2;
        participantRedrawYPositions.push(redrawY);
        lastRedrawY = redrawY;
        redrawPending = false;
      }
    }

    // If redrawPending is still true after all messages, place redraw after the last fragment
    if (redrawPending) {
      const redrawY = pendingFragmentBottomY + rowHeight / 2;
      participantRedrawYPositions.push(redrawY);
    }
  }

  // -------------------------------------------------------------------------
  // Step 8: Second pass -- shift Y coordinates below each redraw insertion
  // -------------------------------------------------------------------------

  const insertionHeight = headerAreaHeight + 20;

  if (participantRedrawYPositions.length > 0) {
    let cumulativeShift = 0;

    for (let r = 0; r < participantRedrawYPositions.length; r++) {
      // The raw insertion point (pre-shift for this redraw, but accounting for prior shifts)
      const rawInsertionY = participantRedrawYPositions[r] + cumulativeShift;

      // Shift all message Y values below this insertion point
      for (const ml of dfsContext.messageLayouts) {
        if (ml.y >= rawInsertionY) {
          ml.y += insertionHeight;
        }
      }

      // Shift all fragment topY/bottomY below this insertion point
      for (const fl of fragmentLayouts) {
        if (fl.topY >= rawInsertionY) {
          fl.topY += insertionHeight;
        }
        if (fl.bottomY >= rawInsertionY) {
          fl.bottomY += insertionHeight;
        }
      }

      // Shift lifelineBottomY
      if (lifelineBottomY >= rawInsertionY) {
        lifelineBottomY += insertionHeight;
      }

      // Update this redraw position to its post-adjustment value
      participantRedrawYPositions[r] = rawInsertionY;

      cumulativeShift += insertionHeight;
    }
  }

  // -------------------------------------------------------------------------
  // Return complete layout result
  // -------------------------------------------------------------------------

  return {
    participantLayouts,
    messageLayouts: dfsContext.messageLayouts,
    fragmentLayouts,
    lifelineTopY,
    messageStartY,
    lifelineBottomY,
    messageRowCount,
    lifelineXMap,
    participantRedrawYPositions,
  };
}
