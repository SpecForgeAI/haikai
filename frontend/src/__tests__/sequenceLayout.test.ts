/**
 * sequenceLayout.test.ts
 * Task Group 1: Tests for computeSequenceLayout pure function
 *
 * Tests the layout calculation engine for Sequence Diagrams including:
 * - Participant X position calculations
 * - Lifeline X centerline calculation
 * - Message row assignment via DFS traversal
 * - Fragment vertical extent calculation
 * - Edge cases (empty participants, fragments without messages)
 * - Self-message loop spacing
 */

import { describe, it, expect } from 'vitest';
import {
  computeSequenceLayout,
  LAYOUT_CONSTANTS,
  SELF_MESSAGE_LOOP_HEIGHT,
  ParticipantLayout,
  MessageLayout,
  FragmentLayout,
  SequenceLayoutResult,
} from '../utils/sequenceLayout';
import {
  SequenceDiagram,
  SequenceParticipant,
  SequenceMessage,
  SequenceFragment,
  SequenceOperand,
  SequenceNode,
} from '../types/sequenceDiagram';

/**
 * Helper function to create a minimal SequenceDiagram for testing
 */
function createTestDiagram(
  participants: SequenceParticipant[] = [],
  messages: SequenceMessage[] = [],
  fragments: SequenceFragment[] = [],
  operands: SequenceOperand[] = [],
  sequenceNodes: SequenceNode[] = []
): SequenceDiagram {
  return {
    id: 'test-diagram-1',
    model_file_id: 'test-model-1',
    name: 'Test Sequence Diagram',
    type: 'Sequence',
    participants,
    messages,
    fragments,
    operands,
    sequence_nodes: sequenceNodes,
  };
}

/**
 * Helper to create a participant
 */
function createParticipant(
  id: string,
  orderIndex: number,
  refKind: 'Application' | 'BusinessUser' | 'Service' = 'Application'
): SequenceParticipant {
  return {
    id,
    ref_kind: refKind,
    ref_id: `ref-${id}`,
    order_index: orderIndex,
  };
}

/**
 * Helper to create a message
 */
function createMessage(
  id: string,
  fromId: string,
  toId: string,
  exchangeRole: 'Request' | 'Response' = 'Request'
): SequenceMessage {
  return {
    id,
    exchange_id: `exchange-${id}`,
    exchange_role: exchangeRole,
    from_participant_id: fromId,
    to_participant_id: toId,
    label_text: `Message ${id}`,
  };
}

/**
 * Helper to create a fragment
 */
function createFragment(
  id: string,
  fragmentKind: 'Loop' | 'Optional' | 'Alternative' = 'Loop'
): SequenceFragment {
  return {
    id,
    fragment_kind: fragmentKind,
    label_text: `Fragment ${id}`,
  };
}

/**
 * Helper to create an operand
 */
function createOperand(
  id: string,
  fragmentId: string,
  operandIndex: number,
  guardExpression: string = 'condition'
): SequenceOperand {
  return {
    id,
    fragment_id: fragmentId,
    guard_expression: guardExpression,
    operand_index: operandIndex,
  };
}

/**
 * Helper to create a sequence node
 */
function createNode(
  id: string,
  nodeKind: 'Message' | 'Fragment',
  orderIndex: number,
  refId: string,
  parentNodeId: string | null = null,
  parentOperandId: string | null = null
): SequenceNode {
  const node: SequenceNode = {
    id,
    node_kind: nodeKind,
    order_index: orderIndex,
  };
  if (nodeKind === 'Message') {
    node.message_id = refId;
  } else {
    node.fragment_id = refId;
  }
  if (parentNodeId) {
    node.parent_node_id = parentNodeId;
  }
  if (parentOperandId) {
    node.parent_operand_id = parentOperandId;
  }
  return node;
}

describe('computeSequenceLayout - Layout Engine', () => {
  describe('Test 1: Participant X position calculations with varying spacing values', () => {
    it('should compute correct participantX positions with default spacing', () => {
      const participants = [
        createParticipant('p1', 0),
        createParticipant('p2', 1),
        createParticipant('p3', 2),
      ];
      const diagram = createTestDiagram(participants);

      const layout = computeSequenceLayout(diagram, 220);

      // participantX[i] = leftMargin + i * participantSpacing
      // With leftMargin=60, spacing=220:
      // p1: 60 + 0*220 = 60
      // p2: 60 + 1*220 = 280
      // p3: 60 + 2*220 = 500
      expect(layout.participantLayouts).toHaveLength(3);
      expect(layout.participantLayouts[0].x).toBe(60);
      expect(layout.participantLayouts[1].x).toBe(280);
      expect(layout.participantLayouts[2].x).toBe(500);
    });

    it('should compute correct participantX positions with minimum spacing (120)', () => {
      const participants = [
        createParticipant('p1', 0),
        createParticipant('p2', 1),
      ];
      const diagram = createTestDiagram(participants);

      const layout = computeSequenceLayout(diagram, 120);

      // p1: 60 + 0*120 = 60
      // p2: 60 + 1*120 = 180
      expect(layout.participantLayouts[0].x).toBe(60);
      expect(layout.participantLayouts[1].x).toBe(180);
    });

    it('should compute correct participantX positions with maximum spacing (600)', () => {
      const participants = [
        createParticipant('p1', 0),
        createParticipant('p2', 1),
      ];
      const diagram = createTestDiagram(participants);

      const layout = computeSequenceLayout(diagram, 600);

      // p1: 60 + 0*600 = 60
      // p2: 60 + 1*600 = 660
      expect(layout.participantLayouts[0].x).toBe(60);
      expect(layout.participantLayouts[1].x).toBe(660);
    });

    it('should sort participants by order_index regardless of array order', () => {
      const participants = [
        createParticipant('p3', 2),
        createParticipant('p1', 0),
        createParticipant('p2', 1),
      ];
      const diagram = createTestDiagram(participants);

      const layout = computeSequenceLayout(diagram, 220);

      // Should be sorted by order_index: p1 (0), p2 (1), p3 (2)
      expect(layout.participantLayouts[0].participantId).toBe('p1');
      expect(layout.participantLayouts[1].participantId).toBe('p2');
      expect(layout.participantLayouts[2].participantId).toBe('p3');
    });
  });

  describe('Test 2: Lifeline X centerline calculation for different participant counts', () => {
    it('should compute lifelineX as centerline of header box (participantX + headerBoxWidth/2)', () => {
      const participants = [
        createParticipant('p1', 0),
        createParticipant('p2', 1),
      ];
      const diagram = createTestDiagram(participants);

      const layout = computeSequenceLayout(diagram, 220);

      // lifelineX = participantX + headerBoxWidth/2 = participantX + 150/2 = participantX + 75
      // p1: 60 + 75 = 135
      // p2: 280 + 75 = 355
      expect(layout.participantLayouts[0].lifelineX).toBe(135);
      expect(layout.participantLayouts[1].lifelineX).toBe(355);
    });

    it('should compute same lifelineX formula for BusinessUser participants', () => {
      const participants = [
        createParticipant('p1', 0, 'BusinessUser'),
        createParticipant('p2', 1, 'Application'),
      ];
      const diagram = createTestDiagram(participants);

      const layout = computeSequenceLayout(diagram, 220);

      // Both use same formula: participantX + headerBoxWidth/2
      expect(layout.participantLayouts[0].lifelineX).toBe(135);
      expect(layout.participantLayouts[1].lifelineX).toBe(355);
    });

    it('should compute lifelineTopY correctly based on header area height', () => {
      const participants = [createParticipant('p1', 0)];
      const diagram = createTestDiagram(participants);

      const layout = computeSequenceLayout(diagram, 220);

      // lifelineTopY = topMargin + headerAreaHeight + 10
      // headerAreaHeight = max(headerBoxHeight, userHeaderHeight) = max(50, 70) = 70
      // lifelineTopY = 40 + 70 + 10 = 120
      expect(layout.lifelineTopY).toBe(120);
    });
  });

  describe('Test 3: Message row assignment via DFS traversal of sequenceNodes', () => {
    it('should assign sequential row indices to top-level message nodes', () => {
      const participants = [
        createParticipant('p1', 0),
        createParticipant('p2', 1),
      ];
      const messages = [
        createMessage('m1', 'p1', 'p2'),
        createMessage('m2', 'p2', 'p1'),
        createMessage('m3', 'p1', 'p2'),
      ];
      const nodes = [
        createNode('n1', 'Message', 0, 'm1'),
        createNode('n2', 'Message', 1, 'm2'),
        createNode('n3', 'Message', 2, 'm3'),
      ];
      const diagram = createTestDiagram(participants, messages, [], [], nodes);

      const layout = computeSequenceLayout(diagram, 220);

      // Messages should be assigned rows 0, 1, 2 in order
      expect(layout.messageLayouts).toHaveLength(3);
      expect(layout.messageLayouts[0].rowIndex).toBe(0);
      expect(layout.messageLayouts[1].rowIndex).toBe(1);
      expect(layout.messageLayouts[2].rowIndex).toBe(2);
    });

    it('should compute correct Y position based on row index', () => {
      const participants = [
        createParticipant('p1', 0),
        createParticipant('p2', 1),
      ];
      const messages = [
        createMessage('m1', 'p1', 'p2'),
        createMessage('m2', 'p2', 'p1'),
      ];
      const nodes = [
        createNode('n1', 'Message', 0, 'm1'),
        createNode('n2', 'Message', 1, 'm2'),
      ];
      const diagram = createTestDiagram(participants, messages, [], [], nodes);

      const layout = computeSequenceLayout(diagram, 220);

      // y = messageStartY + rowIndex * rowHeight
      // messageStartY = lifelineTopY + 30 = 120 + 30 = 150
      // m1: 150 + 0*60 = 150
      // m2: 150 + 1*60 = 210
      expect(layout.messageLayouts[0].y).toBe(150);
      expect(layout.messageLayouts[1].y).toBe(210);
    });

    it('should sort nodes by order_index during DFS traversal', () => {
      const participants = [
        createParticipant('p1', 0),
        createParticipant('p2', 1),
      ];
      const messages = [
        createMessage('m1', 'p1', 'p2'),
        createMessage('m2', 'p2', 'p1'),
      ];
      // Nodes out of array order but with correct order_index
      const nodes = [
        createNode('n2', 'Message', 1, 'm2'),
        createNode('n1', 'Message', 0, 'm1'),
      ];
      const diagram = createTestDiagram(participants, messages, [], [], nodes);

      const layout = computeSequenceLayout(diagram, 220);

      // m1 (order_index 0) should be row 0, m2 (order_index 1) should be row 1
      const m1Layout = layout.messageLayouts.find((m) => m.messageId === 'm1');
      const m2Layout = layout.messageLayouts.find((m) => m.messageId === 'm2');
      expect(m1Layout?.rowIndex).toBe(0);
      expect(m2Layout?.rowIndex).toBe(1);
    });

    it('should handle nested messages inside fragments correctly', () => {
      const participants = [
        createParticipant('p1', 0),
        createParticipant('p2', 1),
      ];
      const messages = [
        createMessage('m1', 'p1', 'p2'),
        createMessage('m2', 'p2', 'p1'),
        createMessage('m3', 'p1', 'p2'),
      ];
      const fragments = [createFragment('f1', 'Loop')];
      const operands = [createOperand('op1', 'f1', 0, 'i < 10')];
      // m1 top-level, then fragment f1 containing m2, then m3 after fragment
      const nodes = [
        createNode('n1', 'Message', 0, 'm1'),
        createNode('n2', 'Fragment', 1, 'f1'),
        createNode('n3', 'Message', 0, 'm2', 'n2', 'op1'),
        createNode('n4', 'Message', 2, 'm3'),
      ];
      const diagram = createTestDiagram(
        participants,
        messages,
        fragments,
        operands,
        nodes
      );

      const layout = computeSequenceLayout(diagram, 220);

      // DFS order: m1 (row 0), then fragment n2 (no row), then m2 inside (row 1), then m3 (row 2)
      const m1Layout = layout.messageLayouts.find((m) => m.messageId === 'm1');
      const m2Layout = layout.messageLayouts.find((m) => m.messageId === 'm2');
      const m3Layout = layout.messageLayouts.find((m) => m.messageId === 'm3');
      expect(m1Layout?.rowIndex).toBe(0);
      expect(m2Layout?.rowIndex).toBe(1);
      expect(m3Layout?.rowIndex).toBe(2);
    });
  });

  describe('Test 4: Fragment vertical extent calculation (startRow/endRow)', () => {
    it('should compute fragment startRow and endRow from descendant messages', () => {
      const participants = [
        createParticipant('p1', 0),
        createParticipant('p2', 1),
      ];
      const messages = [
        createMessage('m1', 'p1', 'p2'),
        createMessage('m2', 'p2', 'p1'),
        createMessage('m3', 'p1', 'p2'),
      ];
      const fragments = [createFragment('f1', 'Loop')];
      const operands = [createOperand('op1', 'f1', 0)];
      // Fragment contains m1 and m2, m3 is after
      const nodes = [
        createNode('n1', 'Fragment', 0, 'f1'),
        createNode('n2', 'Message', 0, 'm1', 'n1', 'op1'),
        createNode('n3', 'Message', 1, 'm2', 'n1', 'op1'),
        createNode('n4', 'Message', 1, 'm3'),
      ];
      const diagram = createTestDiagram(
        participants,
        messages,
        fragments,
        operands,
        nodes
      );

      const layout = computeSequenceLayout(diagram, 220);

      const f1Layout = layout.fragmentLayouts.find((f) => f.fragmentId === 'f1');
      expect(f1Layout).toBeDefined();
      // startRow = first descendant message = m1 at row 0
      // endRow = last descendant message = m2 at row 1
      expect(f1Layout?.startRow).toBe(0);
      expect(f1Layout?.endRow).toBe(1);
    });

    it('should compute correct topY and bottomY from row extents', () => {
      const participants = [
        createParticipant('p1', 0),
        createParticipant('p2', 1),
      ];
      const messages = [
        createMessage('m1', 'p1', 'p2'),
        createMessage('m2', 'p2', 'p1'),
      ];
      const fragments = [createFragment('f1', 'Loop')];
      const operands = [createOperand('op1', 'f1', 0)];
      const nodes = [
        createNode('n1', 'Fragment', 0, 'f1'),
        createNode('n2', 'Message', 0, 'm1', 'n1', 'op1'),
        createNode('n3', 'Message', 1, 'm2', 'n1', 'op1'),
      ];
      const diagram = createTestDiagram(
        participants,
        messages,
        fragments,
        operands,
        nodes
      );

      const layout = computeSequenceLayout(diagram, 220);

      const f1Layout = layout.fragmentLayouts.find((f) => f.fragmentId === 'f1');
      // topY = yAtRow(startRow) - 30 = (messageStartY + 0*60) - 30 = 150 - 30 = 120
      // bottomY = yAtRow(endRow) + 30 = (150 + 1*60) + 30 = 210 + 30 = 240
      expect(f1Layout?.topY).toBe(120);
      expect(f1Layout?.bottomY).toBe(240);
    });
  });

  describe('Test 5: Edge case - empty participants array returns minimal layout', () => {
    it('should return empty layout arrays when no participants', () => {
      const diagram = createTestDiagram([], [], [], [], []);

      const layout = computeSequenceLayout(diagram, 220);

      expect(layout.participantLayouts).toHaveLength(0);
      expect(layout.messageLayouts).toHaveLength(0);
      expect(layout.fragmentLayouts).toHaveLength(0);
    });

    it('should still compute basic layout values with empty participants', () => {
      const diagram = createTestDiagram([], [], [], [], []);

      const layout = computeSequenceLayout(diagram, 220);

      // Constants should still be computed
      expect(layout.lifelineTopY).toBe(120);
      expect(layout.messageStartY).toBe(150);
      expect(layout.lifelineBottomY).toBeGreaterThan(0);
    });

    it('should use minimum lifeline height with no messages', () => {
      const participants = [createParticipant('p1', 0)];
      const diagram = createTestDiagram(participants, [], [], [], []);

      const layout = computeSequenceLayout(diagram, 220);

      // lifelineBottomY = messageStartY + max(1, messageRowCount) * rowHeight + 60
      // With 0 messages: max(1, 0) = 1
      // lifelineBottomY = 150 + 1*60 + 60 = 270
      expect(layout.lifelineBottomY).toBe(270);
    });
  });

  describe('Test 6: Edge case - fragment with no messages returns placeholder height', () => {
    it('should assign placeholder extent of 1 row for empty fragment', () => {
      const participants = [
        createParticipant('p1', 0),
        createParticipant('p2', 1),
      ];
      const fragments = [createFragment('f1', 'Loop')];
      const operands = [createOperand('op1', 'f1', 0)];
      // Fragment node with no child message nodes
      const nodes = [createNode('n1', 'Fragment', 0, 'f1')];
      const diagram = createTestDiagram(
        participants,
        [],
        fragments,
        operands,
        nodes
      );

      const layout = computeSequenceLayout(diagram, 220);

      const f1Layout = layout.fragmentLayouts.find((f) => f.fragmentId === 'f1');
      expect(f1Layout).toBeDefined();
      // Empty fragment should have startRow = endRow = 0 (placeholder)
      expect(f1Layout?.startRow).toBe(0);
      expect(f1Layout?.endRow).toBe(0);
    });

    it('should compute minimal frame height for empty fragment', () => {
      const participants = [
        createParticipant('p1', 0),
        createParticipant('p2', 1),
      ];
      const fragments = [createFragment('f1', 'Loop')];
      const operands = [createOperand('op1', 'f1', 0)];
      const nodes = [createNode('n1', 'Fragment', 0, 'f1')];
      const diagram = createTestDiagram(
        participants,
        [],
        fragments,
        operands,
        nodes
      );

      const layout = computeSequenceLayout(diagram, 220);

      const f1Layout = layout.fragmentLayouts.find((f) => f.fragmentId === 'f1');
      // With placeholder row 0:
      // topY = yAtRow(0) - 30 = 150 - 30 = 120
      // bottomY = yAtRow(0) + 30 = 150 + 30 = 180
      // Frame height = 180 - 120 = 60 (one row height)
      expect(f1Layout?.topY).toBe(120);
      expect(f1Layout?.bottomY).toBe(180);
      expect((f1Layout?.bottomY ?? 0) - (f1Layout?.topY ?? 0)).toBe(60);
    });
  });
});

describe('computeSequenceLayout - Lifeline Height Calculation', () => {
  it('should compute lifelineBottomY based on message count', () => {
    const participants = [
      createParticipant('p1', 0),
      createParticipant('p2', 1),
    ];
    const messages = [
      createMessage('m1', 'p1', 'p2'),
      createMessage('m2', 'p2', 'p1'),
      createMessage('m3', 'p1', 'p2'),
    ];
    const nodes = [
      createNode('n1', 'Message', 0, 'm1'),
      createNode('n2', 'Message', 1, 'm2'),
      createNode('n3', 'Message', 2, 'm3'),
    ];
    const diagram = createTestDiagram(participants, messages, [], [], nodes);

    const layout = computeSequenceLayout(diagram, 220);

    // lifelineBottomY = messageStartY + max(1, messageRowCount) * rowHeight + 60
    // With 3 messages: messageStartY + 3*60 + 60 = 150 + 180 + 60 = 390
    expect(layout.lifelineBottomY).toBe(390);
  });

  it('should use minimum of 1 row for lifeline height when no messages', () => {
    const participants = [createParticipant('p1', 0)];
    const diagram = createTestDiagram(participants, [], [], [], []);

    const layout = computeSequenceLayout(diagram, 220);

    // lifelineBottomY = messageStartY + max(1, 0) * rowHeight + 60 = 150 + 60 + 60 = 270
    expect(layout.lifelineBottomY).toBe(270);
  });
});

describe('computeSequenceLayout - Layout Constants', () => {
  it('should export correct layout constants', () => {
    expect(LAYOUT_CONSTANTS.headerBoxWidth).toBe(150);
    expect(LAYOUT_CONSTANTS.headerBoxHeight).toBe(50);
    expect(LAYOUT_CONSTANTS.userHeaderHeight).toBe(70);
    expect(LAYOUT_CONSTANTS.topMargin).toBe(40);
    expect(LAYOUT_CONSTANTS.leftMargin).toBe(60);
    expect(LAYOUT_CONSTANTS.rowHeight).toBe(60);
  });
});

// ============================================================================
// Self-Loop Spacing Tests
// Fix: Self-referencing messages must reserve extra vertical space
// ============================================================================

describe('computeSequenceLayout - Self-Loop Spacing', () => {
  const { rowHeight } = LAYOUT_CONSTANTS;
  // messageStartY = lifelineTopY + 30 = 120 + 30 = 150
  const messageStartY = 150;

  it('should increment currentRow by 1.5 for self-messages (not 1.0)', () => {
    const participants = [createParticipant('p1', 0)];
    // Self-message: from p1 to p1
    const messages = [
      createMessage('m-self', 'p1', 'p1'),
      createMessage('m-next', 'p1', 'p1'),
    ];
    const nodes = [
      createNode('n1', 'Message', 0, 'm-self'),
      createNode('n2', 'Message', 1, 'm-next'),
    ];
    const diagram = createTestDiagram(participants, messages, [], [], nodes);

    const layout = computeSequenceLayout(diagram, 220);

    // m-self at row 0, then currentRow becomes 0 + 1 + 0.5 = 1.5
    // m-next at row 1.5
    const selfLayout = layout.messageLayouts.find((m) => m.messageId === 'm-self');
    const nextLayout = layout.messageLayouts.find((m) => m.messageId === 'm-next');
    expect(selfLayout?.rowIndex).toBe(0);
    expect(nextLayout?.rowIndex).toBe(1.5);
  });

  it('should increment currentRow by exactly 1.0 for non-self-messages', () => {
    const participants = [
      createParticipant('p1', 0),
      createParticipant('p2', 1),
    ];
    const messages = [
      createMessage('m1', 'p1', 'p2'),
      createMessage('m2', 'p2', 'p1'),
    ];
    const nodes = [
      createNode('n1', 'Message', 0, 'm1'),
      createNode('n2', 'Message', 1, 'm2'),
    ];
    const diagram = createTestDiagram(participants, messages, [], [], nodes);

    const layout = computeSequenceLayout(diagram, 220);

    // Non-self messages: row 0, row 1 (increment by exactly 1)
    expect(layout.messageLayouts[0].rowIndex).toBe(0);
    expect(layout.messageLayouts[1].rowIndex).toBe(1);
  });

  it('should position message following a self-message with 90px gap (not 60px)', () => {
    const participants = [
      createParticipant('p1', 0),
      createParticipant('p2', 1),
    ];
    // Self-message followed by a normal message
    const messages = [
      createMessage('m-self', 'p1', 'p1'),
      createMessage('m-after', 'p1', 'p2'),
    ];
    const nodes = [
      createNode('n1', 'Message', 0, 'm-self'),
      createNode('n2', 'Message', 1, 'm-after'),
    ];
    const diagram = createTestDiagram(participants, messages, [], [], nodes);

    const layout = computeSequenceLayout(diagram, 220);

    const selfLayout = layout.messageLayouts.find((m) => m.messageId === 'm-self');
    const afterLayout = layout.messageLayouts.find((m) => m.messageId === 'm-after');

    // m-self Y = messageStartY + 0 * 60 = 150
    // m-after row = 1.5, Y = messageStartY + 1.5 * 60 = 150 + 90 = 240
    // Gap = 240 - 150 = 90px (60px row + 30px extra for self-loop)
    expect(selfLayout?.y).toBe(messageStartY);
    expect(afterLayout?.y).toBe(messageStartY + 1.5 * rowHeight);
    expect((afterLayout?.y ?? 0) - (selfLayout?.y ?? 0)).toBe(90);
  });

  it('should account for self-loop in fragment bottom Y when last message is self-message', () => {
    const participants = [createParticipant('p1', 0)];
    // Fragment containing a single self-message
    const messages = [createMessage('m-self', 'p1', 'p1')];
    const fragments = [createFragment('f1', 'Loop')];
    const operands = [createOperand('op1', 'f1', 0)];
    const nodes = [
      createNode('n1', 'Fragment', 0, 'f1'),
      createNode('n2', 'Message', 0, 'm-self', 'n1', 'op1'),
    ];
    const diagram = createTestDiagram(participants, messages, fragments, operands, nodes);

    const layout = computeSequenceLayout(diagram, 220);

    const f1Layout = layout.fragmentLayouts.find((f) => f.fragmentId === 'f1');
    expect(f1Layout).toBeDefined();

    // endRow = currentRow - 1 after self-message
    // After m-self: currentRow = 0 + 1 + 0.5 = 1.5, so endRow = 1.5 - 1 = 0.5
    // bottomY = messageStartY + 0.5 * 60 + 30 = 150 + 30 + 30 = 210
    // This is 30px more than a non-self-message fragment bottom (which would be 150 + 0*60 + 30 = 180)
    expect(f1Layout?.endRow).toBe(0.5);
    expect(f1Layout?.bottomY).toBe(messageStartY + 0.5 * rowHeight + 30);
  });
});
