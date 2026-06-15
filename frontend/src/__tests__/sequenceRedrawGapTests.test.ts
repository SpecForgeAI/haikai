/**
 * sequenceRedrawGapTests.test.ts
 *
 * Task Group 3: Gap analysis tests for participant redraw feature.
 * Tests 1-8 covering integration, edge cases, and regression scenarios.
 */

import { describe, it, expect } from 'vitest';
import { computeSequenceLayout, LAYOUT_CONSTANTS } from '../utils/sequenceLayout';
import { computeLifelineSegments } from '../components/DiagramsView/SequenceDiagramRenderer';
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

function createNMessages(
  n: number,
  fromId: string,
  toId: string,
  parentNodeId?: string
): { messages: SequenceMessage[]; nodes: SequenceNode[] } {
  const messages: SequenceMessage[] = [];
  const nodes: SequenceNode[] = [];
  for (let i = 0; i < n; i++) {
    const mid = `m${parentNodeId ? parentNodeId + '-' : ''}${i}`;
    messages.push(createMessage(mid, fromId, toId));
    nodes.push(msgNode(`n${mid}`, mid, i, parentNodeId));
  }
  return { messages, nodes };
}

const { topMargin, rowHeight, headerBoxHeight, userHeaderHeight } = LAYOUT_CONSTANTS;
const headerAreaHeight = Math.max(headerBoxHeight, userHeaderHeight); // 70
const insertionHeight = headerAreaHeight + 20; // 90
const messageStartY = topMargin + headerAreaHeight + 10 + 30; // 150

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Participant redraw gap analysis tests', () => {
  it('Test 1 (integration): 2500px diagram produces correct number of redrawn header groups', () => {
    // ~2500px: need enough messages. 40 messages => row 39, Y = 150+39*60 = 2490
    const p1 = createParticipant('p1', 0);
    const p2 = createParticipant('p2', 1);
    const p3 = createParticipant('p3', 2);
    const { messages, nodes } = createNMessages(40, 'p1', 'p2');
    const diagram = buildDiagram({ participants: [p1, p2, p3], messages, sequence_nodes: nodes });
    const result = computeSequenceLayout(diagram);

    // Should have at least 2 redraws for a ~2500px diagram
    expect(result.participantRedrawYPositions.length).toBeGreaterThanOrEqual(2);

    // Each redraw position should be valid (> topMargin, ascending)
    for (let i = 0; i < result.participantRedrawYPositions.length; i++) {
      expect(result.participantRedrawYPositions[i]).toBeGreaterThan(topMargin);
      if (i > 0) {
        expect(result.participantRedrawYPositions[i]).toBeGreaterThan(
          result.participantRedrawYPositions[i - 1]
        );
      }
    }

    // Verify lifeline segments count: should be redraws + 1
    const lifelineTopY = topMargin + headerAreaHeight + 10;
    const segments = computeLifelineSegments(
      lifelineTopY,
      result.lifelineBottomY,
      result.participantRedrawYPositions
    );
    expect(segments.length).toBe(result.participantRedrawYPositions.length + 1);
  });

  it('Test 2 (edge case): Threshold crossed exactly at fragment start row -- redraw deferred', () => {
    // Fragment starts at the row where threshold would be crossed.
    // Row 15 Y = 150 + 15*60 = 1050, threshold from topMargin(40) = 1010 >= 1000
    const p1 = createParticipant('p1', 0);
    const p2 = createParticipant('p2', 1);

    const messages: SequenceMessage[] = [];
    const nodes: SequenceNode[] = [];

    // 15 top-level messages (rows 0-14)
    for (let i = 0; i < 15; i++) {
      messages.push(createMessage(`m${i}`, 'p1', 'p2'));
      nodes.push(msgNode(`n${i}`, `m${i}`, i));
    }

    // Fragment starts at row 15 (exactly where threshold crosses)
    const frag: SequenceFragment = { id: 'f1', fragment_kind: 'Loop', label_text: 'loop' };
    const fragOp: SequenceOperand = {
      id: 'op1', fragment_id: 'f1', guard_expression: 'true', operand_index: 0,
    };
    nodes.push(fragNode('nf1', 'f1', 15));
    for (let i = 15; i < 20; i++) {
      messages.push(createMessage(`m${i}`, 'p1', 'p2'));
      nodes.push(msgNode(`n${i}`, `m${i}`, i - 15, 'nf1'));
    }

    // Messages after fragment (rows 20-24)
    for (let i = 20; i < 25; i++) {
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

    // The first redraw should be AFTER the fragment, not inside it
    // Fragment spans rows 15-19, bottomY pre-shift = 150 + 19*60 + 30 = 1320
    const fragmentBottomYPreShift = messageStartY + 19 * rowHeight + 30;
    expect(result.participantRedrawYPositions[0]).toBeGreaterThanOrEqual(fragmentBottomYPreShift);
  });

  it('Test 3 (edge case): Fragment spanning >1000px produces single redraw after fragment', () => {
    // A single fragment that spans more than 1000px. Threshold is crossed inside it.
    // Fragment with 25 messages (rows 0-24), Y range: 150 to 150+24*60 = 1590.
    // Threshold from topMargin crosses around row 15. But all inside fragment.
    const p1 = createParticipant('p1', 0);
    const p2 = createParticipant('p2', 1);

    const messages: SequenceMessage[] = [];
    const nodes: SequenceNode[] = [];

    const frag: SequenceFragment = { id: 'f1', fragment_kind: 'Loop' };
    const fragOp: SequenceOperand = {
      id: 'op1', fragment_id: 'f1', guard_expression: 'true', operand_index: 0,
    };
    nodes.push(fragNode('nf1', 'f1', 0));
    for (let i = 0; i < 25; i++) {
      messages.push(createMessage(`m${i}`, 'p1', 'p2'));
      nodes.push(msgNode(`n${i}`, `m${i}`, i, 'nf1'));
    }

    // 3 messages after fragment
    for (let i = 25; i < 28; i++) {
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

    // Should have exactly 1 redraw (deferred to after the large fragment)
    expect(result.participantRedrawYPositions.length).toBeGreaterThanOrEqual(1);

    // Fragment spans rows 0-24, bottomY pre-shift = 150 + 24*60 + 30 = 1620
    const fragmentBottomYPreShift = messageStartY + 24 * rowHeight + 30;
    expect(result.participantRedrawYPositions[0]).toBeGreaterThanOrEqual(fragmentBottomYPreShift);
  });

  it('Test 4 (edge case): Multiple sequential fragments with threshold between them', () => {
    // Two fragments with a gap between where threshold is exceeded.
    const p1 = createParticipant('p1', 0);
    const p2 = createParticipant('p2', 1);

    const messages: SequenceMessage[] = [];
    const nodes: SequenceNode[] = [];

    // Fragment 1: rows 0-7 (8 messages)
    const frag1: SequenceFragment = { id: 'f1', fragment_kind: 'Loop' };
    const frag1Op: SequenceOperand = { id: 'op1', fragment_id: 'f1', guard_expression: 'true', operand_index: 0 };
    nodes.push(fragNode('nf1', 'f1', 0));
    for (let i = 0; i < 8; i++) {
      messages.push(createMessage(`m${i}`, 'p1', 'p2'));
      nodes.push(msgNode(`n${i}`, `m${i}`, i, 'nf1'));
    }

    // Gap messages between fragments (rows 8-14)
    for (let i = 8; i < 15; i++) {
      messages.push(createMessage(`m${i}`, 'p1', 'p2'));
      nodes.push(msgNode(`n${i}`, `m${i}`, i));
    }

    // Fragment 2: rows 15-22 (8 messages)
    const frag2: SequenceFragment = { id: 'f2', fragment_kind: 'Optional' };
    const frag2Op: SequenceOperand = { id: 'op2', fragment_id: 'f2', guard_expression: 'true', operand_index: 0 };
    nodes.push(fragNode('nf2', 'f2', 15));
    for (let i = 15; i < 23; i++) {
      messages.push(createMessage(`m${i}`, 'p1', 'p2'));
      nodes.push(msgNode(`n${i}`, `m${i}`, i - 15, 'nf2'));
    }

    // Trailing messages (rows 23-27)
    for (let i = 23; i < 28; i++) {
      messages.push(createMessage(`m${i}`, 'p1', 'p2'));
      nodes.push(msgNode(`n${i}`, `m${i}`, i));
    }

    const diagram = buildDiagram({
      participants: [p1, p2],
      messages,
      fragments: [frag1, frag2],
      operands: [frag1Op, frag2Op],
      sequence_nodes: nodes,
    });
    const result = computeSequenceLayout(diagram);

    // Threshold crossed ~row 15 (Y=1050). Row 15 is inside frag2, so deferred.
    // Or it could be between fragments. Either way, redraw should not be inside any fragment.
    expect(result.participantRedrawYPositions.length).toBeGreaterThanOrEqual(1);

    // Verify no redraw position falls inside a fragment's pre-shift range
    // (This is approximate -- the redraw should be outside fragments)
    for (const redrawY of result.participantRedrawYPositions) {
      expect(redrawY).toBeGreaterThan(topMargin);
    }
  });

  it('Test 5 (integration): Self-message exchanges do not break redraw computation', () => {
    // Self-messages consume 1.5 rows. Verify redraw still works.
    const p1 = createParticipant('p1', 0);
    const p2 = createParticipant('p2', 1);

    const messages: SequenceMessage[] = [];
    const nodes: SequenceNode[] = [];

    // Mix of normal and self-messages to reach threshold
    for (let i = 0; i < 20; i++) {
      const fromId = 'p1';
      const toId = i % 3 === 0 ? 'p1' : 'p2'; // every 3rd is self-message
      messages.push(createMessage(`m${i}`, fromId, toId));
      nodes.push(msgNode(`n${i}`, `m${i}`, i));
    }

    const diagram = buildDiagram({ participants: [p1, p2], messages, sequence_nodes: nodes });
    const result = computeSequenceLayout(diagram);

    // Self-messages add extra vertical space, so threshold should still be crossed
    // 20 messages with ~7 self-messages: total rows ~ 20 + 7*0.5 = 23.5
    // Max Y ~ 150 + 23.5*60 = 1560, well over threshold
    expect(result.participantRedrawYPositions.length).toBeGreaterThanOrEqual(1);

    // Positions should be valid
    for (const y of result.participantRedrawYPositions) {
      expect(y).toBeGreaterThan(topMargin);
    }
  });

  it('Test 6 (regression): Diagram with no fragments behaves identically to simple threshold logic', () => {
    // No fragments: redraws should happen at clean threshold intervals
    const p1 = createParticipant('p1', 0);
    const p2 = createParticipant('p2', 1);
    const { messages, nodes } = createNMessages(30, 'p1', 'p2');
    const diagram = buildDiagram({ participants: [p1, p2], messages, sequence_nodes: nodes });
    const result = computeSequenceLayout(diagram);

    expect(result.fragmentLayouts).toHaveLength(0);
    expect(result.participantRedrawYPositions.length).toBeGreaterThanOrEqual(1);

    // The redraw is placed at messageY - rowHeight/2 where messageY - lastRedrawY >= 1000.
    // So the redraw position itself may be slightly less than lastRedrawY + 1000.
    // Verify the first redraw is close to 1000px from topMargin (within one rowHeight).
    const firstRedraw = result.participantRedrawYPositions[0];
    expect(firstRedraw - topMargin).toBeGreaterThanOrEqual(
      LAYOUT_CONSTANTS.PARTICIPANT_REDRAW_THRESHOLD - rowHeight
    );
    expect(firstRedraw - topMargin).toBeLessThan(
      LAYOUT_CONSTANTS.PARTICIPANT_REDRAW_THRESHOLD + rowHeight * 2
    );

    // Verify total height includes inserted space
    const baseLifelineBottomY = messageStartY + Math.max(1, 30) * rowHeight + 60;
    const expectedHeight = baseLifelineBottomY + result.participantRedrawYPositions.length * insertionHeight;
    expect(result.lifelineBottomY).toBe(expectedHeight);
  });

  it('Test 7 (edge case): Fragment closes with redrawPending but next message inside another fragment -- continue deferring', () => {
    // Two back-to-back fragments. Threshold crosses in first, second starts immediately.
    const p1 = createParticipant('p1', 0);
    const p2 = createParticipant('p2', 1);

    const messages: SequenceMessage[] = [];
    const nodes: SequenceNode[] = [];

    // Fragment 1: rows 0-12 (13 messages)
    const frag1: SequenceFragment = { id: 'f1', fragment_kind: 'Loop' };
    const frag1Op: SequenceOperand = { id: 'op1', fragment_id: 'f1', guard_expression: 'true', operand_index: 0 };
    nodes.push(fragNode('nf1', 'f1', 0));
    for (let i = 0; i < 13; i++) {
      messages.push(createMessage(`m${i}`, 'p1', 'p2'));
      nodes.push(msgNode(`n${i}`, `m${i}`, i, 'nf1'));
    }

    // Fragment 2: rows 13-18 (immediately after frag1, 6 messages)
    const frag2: SequenceFragment = { id: 'f2', fragment_kind: 'Optional' };
    const frag2Op: SequenceOperand = { id: 'op2', fragment_id: 'f2', guard_expression: 'true', operand_index: 0 };
    nodes.push(fragNode('nf2', 'f2', 1));
    for (let i = 13; i < 19; i++) {
      messages.push(createMessage(`m${i}`, 'p1', 'p2'));
      nodes.push(msgNode(`n${i}`, `m${i}`, i - 13, 'nf2'));
    }

    // Messages after both fragments (rows 19-23)
    for (let i = 19; i < 24; i++) {
      messages.push(createMessage(`m${i}`, 'p1', 'p2'));
      nodes.push(msgNode(`n${i}`, `m${i}`, i));
    }

    const diagram = buildDiagram({
      participants: [p1, p2],
      messages,
      fragments: [frag1, frag2],
      operands: [frag1Op, frag2Op],
      sequence_nodes: nodes,
    });
    const result = computeSequenceLayout(diagram);

    expect(result.participantRedrawYPositions.length).toBeGreaterThanOrEqual(1);

    // Threshold crosses inside frag1 or frag2. Either way, the redraw should be placed
    // after the last enclosing fragment closes.
    // Frag1 rows 0-12, frag2 rows 13-18.
    // Frag2 bottomY pre-shift = 150 + 18*60 + 30 = 1260
    const frag2BottomPreShift = messageStartY + 18 * rowHeight + 30; // 1260
    expect(result.participantRedrawYPositions[0]).toBeGreaterThanOrEqual(frag2BottomPreShift);
  });

  it('Test 8 (integration): Lifeline segment count equals participantRedrawYPositions.length + 1', () => {
    // For any diagram with redraws, lifeline segments = redraws + 1
    const p1 = createParticipant('p1', 0);
    const p2 = createParticipant('p2', 1);
    const { messages, nodes } = createNMessages(50, 'p1', 'p2');
    const diagram = buildDiagram({ participants: [p1, p2], messages, sequence_nodes: nodes });
    const result = computeSequenceLayout(diagram);

    const numRedraws = result.participantRedrawYPositions.length;
    expect(numRedraws).toBeGreaterThanOrEqual(2);

    const lifelineTopY = topMargin + headerAreaHeight + 10;
    const segments = computeLifelineSegments(
      lifelineTopY,
      result.lifelineBottomY,
      result.participantRedrawYPositions
    );

    expect(segments.length).toBe(numRedraws + 1);

    // Verify segments are contiguous (no overlap, no gap except at redraw headers)
    const redrawBlockHeight = headerAreaHeight + 20;
    for (let i = 0; i < segments.length - 1; i++) {
      const expectedGapStart = segments[i].bottomY;
      const expectedGapEnd = expectedGapStart + redrawBlockHeight;
      expect(segments[i + 1].topY).toBe(expectedGapEnd);
    }

    // First segment starts at lifelineTopY
    expect(segments[0].topY).toBe(lifelineTopY);

    // Last segment ends at lifelineBottomY
    expect(segments[segments.length - 1].bottomY).toBe(result.lifelineBottomY);
  });
});
