/**
 * sequenceLayoutRedraw.test.ts
 *
 * Tests for participant redraw position computation in the layout engine.
 * Covers threshold logic, fragment deferral, nested fragments, and Y-shift.
 */

import { describe, it, expect } from 'vitest';
import { computeSequenceLayout, LAYOUT_CONSTANTS } from '../utils/sequenceLayout';
import {
  SequenceDiagram,
  SequenceParticipant,
  SequenceMessage,
  SequenceFragment,
  SequenceOperand,
  SequenceNode,
} from '../types/sequenceDiagram';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createParticipant(
  id: string,
  orderIndex: number,
  refKind: 'Application' | 'BusinessUser' | 'Service' = 'Application'
): SequenceParticipant {
  return { id, ref_kind: refKind, ref_id: `ref-${id}`, order_index: orderIndex };
}

function createMessage(
  id: string,
  fromId: string,
  toId: string,
  exchangeRole: 'Request' | 'Response' = 'Request'
): SequenceMessage {
  return {
    id,
    exchange_id: `ex-${id}`,
    exchange_role: exchangeRole,
    from_participant_id: fromId,
    to_participant_id: toId,
    label_text: `msg-${id}`,
  };
}

function msgNode(
  nodeId: string,
  messageId: string,
  orderIndex: number,
  parentNodeId?: string
): SequenceNode {
  return {
    id: nodeId,
    node_kind: 'Message',
    message_id: messageId,
    order_index: orderIndex,
    parent_node_id: parentNodeId,
  };
}

function fragNode(
  nodeId: string,
  fragmentId: string,
  orderIndex: number,
  parentNodeId?: string
): SequenceNode {
  return {
    id: nodeId,
    node_kind: 'Fragment',
    fragment_id: fragmentId,
    order_index: orderIndex,
    parent_node_id: parentNodeId,
  };
}

function buildDiagram(opts: {
  participants?: SequenceParticipant[];
  messages?: SequenceMessage[];
  fragments?: SequenceFragment[];
  operands?: SequenceOperand[];
  sequence_nodes?: SequenceNode[];
}): SequenceDiagram {
  return {
    id: 'diag-1',
    model_file_id: 'mf-1',
    name: 'Test',
    type: 'Sequence',
    participants: opts.participants ?? [],
    messages: opts.messages ?? [],
    fragments: opts.fragments ?? [],
    operands: opts.operands ?? [],
    sequence_nodes: opts.sequence_nodes ?? [],
  };
}

/**
 * Create N simple messages between p1 and p2 with corresponding nodes.
 */
function createNMessages(
  n: number,
  fromId: string,
  toId: string
): { messages: SequenceMessage[]; nodes: SequenceNode[] } {
  const messages: SequenceMessage[] = [];
  const nodes: SequenceNode[] = [];
  for (let i = 0; i < n; i++) {
    const mid = `m${i}`;
    messages.push(createMessage(mid, fromId, toId));
    nodes.push(msgNode(`n${i}`, mid, i));
  }
  return { messages, nodes };
}

// Constants for readability
const { topMargin, rowHeight, headerBoxHeight, userHeaderHeight } = LAYOUT_CONSTANTS;
const headerAreaHeight = Math.max(headerBoxHeight, userHeaderHeight); // 70
const lifelineTopY = topMargin + headerAreaHeight + 10; // 120
const messageStartY = lifelineTopY + 30; // 150
const insertionHeight = headerAreaHeight + 20; // 90

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Participant redraw position computation', () => {
  it('Test 1: short diagram returns empty participantRedrawYPositions', () => {
    // 5 messages => rows 0-4, max Y = 150 + 4*60 = 390 which is < 1000
    const p1 = createParticipant('p1', 0);
    const p2 = createParticipant('p2', 1);
    const { messages, nodes } = createNMessages(5, 'p1', 'p2');
    const diagram = buildDiagram({ participants: [p1, p2], messages, sequence_nodes: nodes });
    const result = computeSequenceLayout(diagram);
    expect(result.participantRedrawYPositions).toEqual([]);
  });

  it('Test 2: ~2000px tall diagram produces exactly one redraw position', () => {
    // We need messages whose Y spans > 1000px from topMargin (40).
    // messageY = 150 + row * 60. Threshold = messageY - 40 >= 1000 => messageY >= 1040 => row >= (1040-150)/60 = 14.83 => row 15
    // So 16 messages (rows 0-15), row 15 Y = 150 + 15*60 = 1050 which is 1050-40=1010 >= 1000
    // But we also want it not to be >2000 total. 20 messages => row 19 Y = 150+19*60=1290. Fine.
    const p1 = createParticipant('p1', 0);
    const p2 = createParticipant('p2', 1);
    const { messages, nodes } = createNMessages(20, 'p1', 'p2');
    const diagram = buildDiagram({ participants: [p1, p2], messages, sequence_nodes: nodes });
    const result = computeSequenceLayout(diagram);

    expect(result.participantRedrawYPositions).toHaveLength(1);
    // The redraw should happen before the message at row 15 (first to exceed threshold)
    // Row 15 Y = 150 + 15*60 = 1050, redrawY = 1050 - 30 = 1020
    // But note: after shift, the redraw position itself is at its post-adjustment value
    expect(result.participantRedrawYPositions[0]).toBeGreaterThan(topMargin);
  });

  it('Test 3: ~3500px tall diagram produces multiple redraw positions', () => {
    // 50 messages => row 49 Y = 150+49*60 = 3090. lifelineBottomY before redraws = 150+50*60+60 = 3210
    // First redraw around row ~15 (Y~1050), second around row ~30 after first shift
    const p1 = createParticipant('p1', 0);
    const p2 = createParticipant('p2', 1);
    const { messages, nodes } = createNMessages(50, 'p1', 'p2');
    const diagram = buildDiagram({ participants: [p1, p2], messages, sequence_nodes: nodes });
    const result = computeSequenceLayout(diagram);

    expect(result.participantRedrawYPositions.length).toBeGreaterThanOrEqual(2);
    // Positions should be in ascending order
    for (let i = 1; i < result.participantRedrawYPositions.length; i++) {
      expect(result.participantRedrawYPositions[i]).toBeGreaterThan(
        result.participantRedrawYPositions[i - 1]
      );
    }
  });

  it('Test 4: redraw deferred when threshold exceeded inside a fragment', () => {
    // Create a fragment that spans rows where the threshold would be crossed.
    // Fragment covers rows 10-18 (messages inside it). Threshold crossed at row ~15.
    // Redraw should appear AFTER the fragment closes, not at row 15.
    const p1 = createParticipant('p1', 0);
    const p2 = createParticipant('p2', 1);

    const messages: SequenceMessage[] = [];
    const nodes: SequenceNode[] = [];

    // 10 top-level messages (rows 0-9)
    for (let i = 0; i < 10; i++) {
      messages.push(createMessage(`m${i}`, 'p1', 'p2'));
      nodes.push(msgNode(`n${i}`, `m${i}`, i));
    }

    // Fragment with 9 messages (rows 10-18)
    const frag: SequenceFragment = { id: 'f1', fragment_kind: 'Loop', label_text: 'loop' };
    const fragOp: SequenceOperand = {
      id: 'op1', fragment_id: 'f1', guard_expression: 'true', operand_index: 0,
    };
    nodes.push(fragNode('nf1', 'f1', 10));
    for (let i = 10; i < 19; i++) {
      messages.push(createMessage(`m${i}`, 'p1', 'p2'));
      nodes.push(msgNode(`n${i}`, `m${i}`, i - 10, 'nf1'));
    }

    // 5 messages after fragment (rows 19-23)
    for (let i = 19; i < 24; i++) {
      messages.push(createMessage(`m${i}`, 'p1', 'p2'));
      nodes.push(msgNode(`n${i}`, `m${i}`, i));
    }

    const diagram = buildDiagram({
      participants: [p1, p2],
      messages,
      fragments: [frag],
      operands: [fragOp],
      sequence_nodes: nodes,
    });
    const result = computeSequenceLayout(diagram);

    expect(result.participantRedrawYPositions.length).toBeGreaterThanOrEqual(1);

    // The fragment's bottomY (pre-shift) = messageStartY + 18*60 + 30 = 150 + 1080 + 30 = 1260
    // Redraw should be placed after fragment close, not inside the fragment rows.
    // First message after fragment is row 19, Y = 150 + 19*60 = 1290
    // The redraw Y should be > fragment bottomY
    const fragmentBottomYPreShift = messageStartY + 18 * rowHeight + 30; // 1260
    // The redraw is at pendingFragmentBottomY + rowHeight/2 = 1260 + 30 = 1290 (pre-shift)
    // Post shift it stays at 1290 (it's the insertion point itself)
    expect(result.participantRedrawYPositions[0]).toBeGreaterThanOrEqual(fragmentBottomYPreShift);
  });

  it('Test 5: nested fragments -- redraw deferred until outermost closes', () => {
    const p1 = createParticipant('p1', 0);
    const p2 = createParticipant('p2', 1);

    const messages: SequenceMessage[] = [];
    const nodes: SequenceNode[] = [];

    // 10 top-level messages (rows 0-9)
    for (let i = 0; i < 10; i++) {
      messages.push(createMessage(`m${i}`, 'p1', 'p2'));
      nodes.push(msgNode(`n${i}`, `m${i}`, i));
    }

    // Outer fragment with inner fragment
    const outerFrag: SequenceFragment = { id: 'fo', fragment_kind: 'Loop' };
    const innerFrag: SequenceFragment = { id: 'fi', fragment_kind: 'Optional' };
    const outerOp: SequenceOperand = {
      id: 'opo', fragment_id: 'fo', guard_expression: 'true', operand_index: 0,
    };
    const innerOp: SequenceOperand = {
      id: 'opi', fragment_id: 'fi', guard_expression: 'true', operand_index: 0,
    };

    // Outer fragment node at order 10
    nodes.push(fragNode('nfo', 'fo', 10));

    // 3 messages in outer fragment before inner (rows 10-12)
    for (let i = 10; i < 13; i++) {
      messages.push(createMessage(`m${i}`, 'p1', 'p2'));
      nodes.push(msgNode(`n${i}`, `m${i}`, i - 10, 'nfo'));
    }

    // Inner fragment node inside outer
    nodes.push(fragNode('nfi', 'fi', 3, 'nfo'));

    // 5 messages in inner fragment (rows 13-17)
    for (let i = 13; i < 18; i++) {
      messages.push(createMessage(`m${i}`, 'p1', 'p2'));
      nodes.push(msgNode(`n${i}`, `m${i}`, i - 13, 'nfi'));
    }

    // 2 messages in outer fragment after inner closes (rows 18-19)
    for (let i = 18; i < 20; i++) {
      messages.push(createMessage(`m${i}`, 'p1', 'p2'));
      nodes.push(msgNode(`n${i}`, `m${i}`, i - 10 + 1, 'nfo'));
    }

    // 3 messages after outer fragment (rows 20-22)
    for (let i = 20; i < 23; i++) {
      messages.push(createMessage(`m${i}`, 'p1', 'p2'));
      nodes.push(msgNode(`n${i}`, `m${i}`, i));
    }

    const diagram = buildDiagram({
      participants: [p1, p2],
      messages,
      fragments: [outerFrag, innerFrag],
      operands: [outerOp, innerOp],
      sequence_nodes: nodes,
    });
    const result = computeSequenceLayout(diagram);

    expect(result.participantRedrawYPositions.length).toBeGreaterThanOrEqual(1);

    // Outer fragment spans rows 10-19. Its bottomY (pre-shift) = 150 + 19*60 + 30 = 1320
    // Inner fragment spans rows 13-17. Its bottomY = 150 + 17*60 + 30 = 1200
    // Redraw should NOT happen at inner fragment close (row 17 area, still inside outer).
    // It should happen after outer closes.
    const outerBottomYPreShift = messageStartY + 19 * rowHeight + 30; // 1320
    // Redraw placed at outerBottomY + rowHeight/2 = 1320 + 30 = 1350
    expect(result.participantRedrawYPositions[0]).toBeGreaterThanOrEqual(outerBottomYPreShift);
  });

  it('Test 6: Y positions after redraw are shifted by cumulative inserted space', () => {
    // Use 20 messages -- one redraw expected. Verify messages after the redraw are shifted.
    const p1 = createParticipant('p1', 0);
    const p2 = createParticipant('p2', 1);
    const { messages, nodes } = createNMessages(20, 'p1', 'p2');
    const diagram = buildDiagram({ participants: [p1, p2], messages, sequence_nodes: nodes });

    // Compute layout without redraw for comparison (use a diagram with few messages)
    const resultWithRedraw = computeSequenceLayout(diagram);

    expect(resultWithRedraw.participantRedrawYPositions.length).toBe(1);

    const redrawY = resultWithRedraw.participantRedrawYPositions[0];

    // All messages after the redraw insertion point should be shifted by insertionHeight
    // Check that lifelineBottomY increased by insertionHeight compared to unshifted value
    const unshiftedLifelineBottomY = messageStartY + Math.max(1, 20) * rowHeight + 60;
    expect(resultWithRedraw.lifelineBottomY).toBe(unshiftedLifelineBottomY + insertionHeight);

    // Messages before the redraw insertion should be at their original Y
    // Messages at or after should be shifted by insertionHeight
    for (const ml of resultWithRedraw.messageLayouts) {
      const originalY = messageStartY + ml.rowIndex * rowHeight;
      if (originalY < redrawY) {
        // Not shifted (original Y is below insertion, but insertion point is the redraw position)
        // Actually, the redraw position was computed from original Y values, so messages
        // with original Y < redrawY should keep their original Y
        expect(ml.y).toBe(originalY);
      } else {
        // Shifted by insertionHeight
        expect(ml.y).toBe(originalY + insertionHeight);
      }
    }
  });
});
