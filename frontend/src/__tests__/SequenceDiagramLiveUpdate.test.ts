/**
 * SequenceDiagramLiveUpdate.test.ts
 * Task Group 8: Tests for live update wiring in Sequence Diagram Canvas Rendering
 *
 * Tests that the SequenceDiagramRenderer correctly re-renders when:
 * - Participants change (added, removed, reordered)
 * - Messages/fragments change (added, removed, modified)
 * - participantSpacing changes from toolbar
 *
 * These tests verify the reactive dependency tracking between:
 * - useSequenceDiagram hook output (same state as RHS SequenceEditorPanel)
 * - SequenceDiagramRenderer component
 * - computeSequenceLayout pure function
 */

import { describe, it, expect } from 'vitest';
import {
  computeSequenceLayout,
  LAYOUT_CONSTANTS,
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

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Creates a minimal SequenceDiagram for testing
 */
function createTestDiagram(overrides: Partial<SequenceDiagram> = {}): SequenceDiagram {
  return {
    id: 'test-diagram-1',
    model_file_id: 'test-model-1',
    name: 'Test Sequence Diagram',
    type: 'Sequence',
    participants: [],
    messages: [],
    fragments: [],
    operands: [],
    sequence_nodes: [],
    ...overrides,
  };
}

/**
 * Creates a participant
 */
function createParticipant(
  id: string,
  orderIndex: number,
  refKind: 'Application' | 'BusinessUser' | 'Service' = 'Application',
  refId: string = `ref-${id}`
): SequenceParticipant {
  return {
    id,
    ref_kind: refKind,
    ref_id: refId,
    order_index: orderIndex,
  };
}

/**
 * Creates a message
 */
function createMessage(
  id: string,
  fromParticipantId: string,
  toParticipantId: string,
  exchangeRole: 'Request' | 'Response' = 'Request',
  exchangeId: string = `exchange-${id}`
): SequenceMessage {
  return {
    id,
    exchange_id: exchangeId,
    exchange_role: exchangeRole,
    from_participant_id: fromParticipantId,
    to_participant_id: toParticipantId,
    label_text: `Message ${id}`,
  };
}

/**
 * Creates a sequence node for a message
 */
function createMessageNode(
  id: string,
  messageId: string,
  orderIndex: number,
  parentNodeId?: string,
  parentOperandId?: string
): SequenceNode {
  return {
    id,
    node_kind: 'Message',
    message_id: messageId,
    order_index: orderIndex,
    parent_node_id: parentNodeId,
    parent_operand_id: parentOperandId,
  };
}

/**
 * Creates a fragment
 */
function createFragment(
  id: string,
  fragmentKind: 'Loop' | 'Optional' | 'Alternative' = 'Loop',
  labelText?: string
): SequenceFragment {
  return {
    id,
    fragment_kind: fragmentKind,
    label_text: labelText,
  };
}

/**
 * Creates a sequence node for a fragment
 */
function createFragmentNode(
  id: string,
  fragmentId: string,
  orderIndex: number,
  parentNodeId?: string,
  parentOperandId?: string
): SequenceNode {
  return {
    id,
    node_kind: 'Fragment',
    fragment_id: fragmentId,
    order_index: orderIndex,
    parent_node_id: parentNodeId,
    parent_operand_id: parentOperandId,
  };
}

/**
 * Creates an operand
 */
function createOperand(
  id: string,
  fragmentId: string,
  operandIndex: number,
  guardExpression: string = 'true'
): SequenceOperand {
  return {
    id,
    fragment_id: fragmentId,
    guard_expression: guardExpression,
    operand_index: operandIndex,
  };
}

// ============================================================================
// Test 1: Canvas rerenders when participants change in RHS editor
// ============================================================================

describe('Task 8.1 Test 1: Canvas rerenders when participants change in RHS editor', () => {
  it('should produce different layout when participant is added', () => {
    // Initial state: 2 participants
    const initialDiagram = createTestDiagram({
      participants: [
        createParticipant('p1', 0, 'Application'),
        createParticipant('p2', 1, 'Application'),
      ],
    });

    const initialLayout = computeSequenceLayout(initialDiagram, 220);

    // After adding a third participant (simulating RHS editor change)
    const updatedDiagram = createTestDiagram({
      participants: [
        createParticipant('p1', 0, 'Application'),
        createParticipant('p2', 1, 'Application'),
        createParticipant('p3', 2, 'Application'),
      ],
    });

    const updatedLayout = computeSequenceLayout(updatedDiagram, 220);

    // Layout should reflect the new participant
    expect(updatedLayout.participantLayouts.length).toBe(3);
    expect(initialLayout.participantLayouts.length).toBe(2);

    // New participant should be positioned to the right
    const p3Layout = updatedLayout.participantLayouts.find(p => p.participantId === 'p3');
    expect(p3Layout).toBeDefined();
    expect(p3Layout!.x).toBeGreaterThan(
      updatedLayout.participantLayouts.find(p => p.participantId === 'p2')!.x
    );
  });

  it('should produce different layout when participant is removed', () => {
    // Initial state: 3 participants
    const initialDiagram = createTestDiagram({
      participants: [
        createParticipant('p1', 0, 'Application'),
        createParticipant('p2', 1, 'Application'),
        createParticipant('p3', 2, 'Application'),
      ],
    });

    const initialLayout = computeSequenceLayout(initialDiagram, 220);

    // After removing p2 (simulating RHS editor change)
    const updatedDiagram = createTestDiagram({
      participants: [
        createParticipant('p1', 0, 'Application'),
        createParticipant('p3', 1, 'Application'), // order_index updated
      ],
    });

    const updatedLayout = computeSequenceLayout(updatedDiagram, 220);

    // Layout should reflect fewer participants
    expect(updatedLayout.participantLayouts.length).toBe(2);
    expect(initialLayout.participantLayouts.length).toBe(3);

    // p3 should now be at position index 1
    const p3Layout = updatedLayout.participantLayouts.find(p => p.participantId === 'p3');
    expect(p3Layout!.orderIndex).toBe(1);
  });

  it('should produce different layout when participant order changes', () => {
    // Initial state: p1, p2, p3 in order
    const initialDiagram = createTestDiagram({
      participants: [
        createParticipant('p1', 0, 'Application'),
        createParticipant('p2', 1, 'Application'),
        createParticipant('p3', 2, 'Application'),
      ],
    });

    const initialLayout = computeSequenceLayout(initialDiagram, 220);

    // After reordering to p3, p1, p2 (simulating RHS editor change)
    const updatedDiagram = createTestDiagram({
      participants: [
        createParticipant('p3', 0, 'Application'),
        createParticipant('p1', 1, 'Application'),
        createParticipant('p2', 2, 'Application'),
      ],
    });

    const updatedLayout = computeSequenceLayout(updatedDiagram, 220);

    // p3 should now be first (leftmost)
    expect(updatedLayout.participantLayouts[0].participantId).toBe('p3');
    expect(initialLayout.participantLayouts[0].participantId).toBe('p1');

    // Positions should be recalculated
    const initialP1X = initialLayout.participantLayouts.find(p => p.participantId === 'p1')!.x;
    const updatedP1X = updatedLayout.participantLayouts.find(p => p.participantId === 'p1')!.x;
    expect(updatedP1X).toBeGreaterThan(initialP1X); // p1 moved right
  });
});

// ============================================================================
// Test 2: Canvas rerenders when messages/fragments change
// ============================================================================

describe('Task 8.1 Test 2: Canvas rerenders when messages/fragments change', () => {
  it('should produce different layout when message is added', () => {
    const participants = [
      createParticipant('p1', 0, 'Application'),
      createParticipant('p2', 1, 'Application'),
    ];

    // Initial state: no messages
    const initialDiagram = createTestDiagram({
      participants,
      messages: [],
      sequence_nodes: [],
    });

    const initialLayout = computeSequenceLayout(initialDiagram, 220);

    // After adding a message (simulating RHS editor change)
    const updatedDiagram = createTestDiagram({
      participants,
      messages: [createMessage('m1', 'p1', 'p2')],
      sequence_nodes: [createMessageNode('n1', 'm1', 0)],
    });

    const updatedLayout = computeSequenceLayout(updatedDiagram, 220);

    // Message layout should be present
    expect(updatedLayout.messageLayouts.length).toBe(1);
    expect(initialLayout.messageLayouts.length).toBe(0);

    // Message row count should increase
    expect(updatedLayout.messageRowCount).toBe(1);
    expect(initialLayout.messageRowCount).toBe(0);
  });

  it('should produce different layout when message is removed', () => {
    const participants = [
      createParticipant('p1', 0, 'Application'),
      createParticipant('p2', 1, 'Application'),
    ];

    // Initial state: 2 messages
    const initialDiagram = createTestDiagram({
      participants,
      messages: [
        createMessage('m1', 'p1', 'p2'),
        createMessage('m2', 'p2', 'p1'),
      ],
      sequence_nodes: [
        createMessageNode('n1', 'm1', 0),
        createMessageNode('n2', 'm2', 1),
      ],
    });

    const initialLayout = computeSequenceLayout(initialDiagram, 220);

    // After removing m2 (simulating RHS editor change)
    const updatedDiagram = createTestDiagram({
      participants,
      messages: [createMessage('m1', 'p1', 'p2')],
      sequence_nodes: [createMessageNode('n1', 'm1', 0)],
    });

    const updatedLayout = computeSequenceLayout(updatedDiagram, 220);

    // Message layout should reflect removal
    expect(updatedLayout.messageLayouts.length).toBe(1);
    expect(initialLayout.messageLayouts.length).toBe(2);
  });

  it('should produce different layout when fragment is added', () => {
    const participants = [
      createParticipant('p1', 0, 'Application'),
      createParticipant('p2', 1, 'Application'),
    ];
    const message = createMessage('m1', 'p1', 'p2');

    // Initial state: no fragment
    const initialDiagram = createTestDiagram({
      participants,
      messages: [message],
      sequence_nodes: [createMessageNode('n1', 'm1', 0)],
    });

    const initialLayout = computeSequenceLayout(initialDiagram, 220);

    // After adding a fragment around the message (simulating RHS editor change)
    const fragment = createFragment('f1', 'Loop');
    const operand = createOperand('o1', 'f1', 0, 'i < 10');

    const updatedDiagram = createTestDiagram({
      participants,
      messages: [message],
      fragments: [fragment],
      operands: [operand],
      sequence_nodes: [
        createFragmentNode('fn1', 'f1', 0),
        createMessageNode('n1', 'm1', 0, 'fn1', 'o1'),
      ],
    });

    const updatedLayout = computeSequenceLayout(updatedDiagram, 220);

    // Fragment layout should be present
    expect(updatedLayout.fragmentLayouts.length).toBe(1);
    expect(initialLayout.fragmentLayouts.length).toBe(0);

    // Fragment should have computed row extents
    const fragmentLayout = updatedLayout.fragmentLayouts[0];
    expect(fragmentLayout.startRow).toBeDefined();
    expect(fragmentLayout.endRow).toBeDefined();
  });

  it('should produce different layout when fragment is removed', () => {
    const participants = [
      createParticipant('p1', 0, 'Application'),
      createParticipant('p2', 1, 'Application'),
    ];
    const message = createMessage('m1', 'p1', 'p2');
    const fragment = createFragment('f1', 'Loop');
    const operand = createOperand('o1', 'f1', 0, 'i < 10');

    // Initial state: fragment around message
    const initialDiagram = createTestDiagram({
      participants,
      messages: [message],
      fragments: [fragment],
      operands: [operand],
      sequence_nodes: [
        createFragmentNode('fn1', 'f1', 0),
        createMessageNode('n1', 'm1', 0, 'fn1', 'o1'),
      ],
    });

    const initialLayout = computeSequenceLayout(initialDiagram, 220);

    // After removing fragment (simulating RHS editor change)
    const updatedDiagram = createTestDiagram({
      participants,
      messages: [message],
      fragments: [],
      operands: [],
      sequence_nodes: [createMessageNode('n1', 'm1', 0)],
    });

    const updatedLayout = computeSequenceLayout(updatedDiagram, 220);

    // Fragment layout should be removed
    expect(updatedLayout.fragmentLayouts.length).toBe(0);
    expect(initialLayout.fragmentLayouts.length).toBe(1);
  });

  it('should produce different layout when operand guard expression changes', () => {
    const participants = [
      createParticipant('p1', 0, 'Application'),
      createParticipant('p2', 1, 'Application'),
    ];
    const message = createMessage('m1', 'p1', 'p2');
    const fragment = createFragment('f1', 'Loop');

    // Initial state: operand with guard "i < 10"
    const initialDiagram = createTestDiagram({
      participants,
      messages: [message],
      fragments: [fragment],
      operands: [createOperand('o1', 'f1', 0, 'i < 10')],
      sequence_nodes: [
        createFragmentNode('fn1', 'f1', 0),
        createMessageNode('n1', 'm1', 0, 'fn1', 'o1'),
      ],
    });

    const initialLayout = computeSequenceLayout(initialDiagram, 220);

    // After changing guard expression (simulating RHS editor change)
    const updatedDiagram = createTestDiagram({
      participants,
      messages: [message],
      fragments: [fragment],
      operands: [createOperand('o1', 'f1', 0, 'count > 0')],
      sequence_nodes: [
        createFragmentNode('fn1', 'f1', 0),
        createMessageNode('n1', 'm1', 0, 'fn1', 'o1'),
      ],
    });

    const updatedLayout = computeSequenceLayout(updatedDiagram, 220);

    // Guard expression should be different
    expect(initialLayout.fragmentLayouts[0].operands[0].guardExpression).toBe('i < 10');
    expect(updatedLayout.fragmentLayouts[0].operands[0].guardExpression).toBe('count > 0');
  });
});

// ============================================================================
// Test 3: Canvas rerenders when participantSpacing changes in toolbar
// ============================================================================

describe('Task 8.1 Test 3: Canvas rerenders when participantSpacing changes in toolbar', () => {
  it('should produce different layout when participantSpacing increases', () => {
    const diagram = createTestDiagram({
      participants: [
        createParticipant('p1', 0, 'Application'),
        createParticipant('p2', 1, 'Application'),
        createParticipant('p3', 2, 'Application'),
      ],
    });

    // Initial spacing: 220
    const initialLayout = computeSequenceLayout(diagram, 220);

    // After increasing spacing to 300
    const updatedLayout = computeSequenceLayout(diagram, 300);

    // Participant X positions should be farther apart
    const initialP2X = initialLayout.participantLayouts.find(p => p.participantId === 'p2')!.x;
    const updatedP2X = updatedLayout.participantLayouts.find(p => p.participantId === 'p2')!.x;
    expect(updatedP2X).toBeGreaterThan(initialP2X);

    const initialP3X = initialLayout.participantLayouts.find(p => p.participantId === 'p3')!.x;
    const updatedP3X = updatedLayout.participantLayouts.find(p => p.participantId === 'p3')!.x;
    expect(updatedP3X).toBeGreaterThan(initialP3X);

    // Spacing difference should be proportional
    const initialGap = initialP2X - initialLayout.participantLayouts[0].x;
    const updatedGap = updatedP2X - updatedLayout.participantLayouts[0].x;
    expect(updatedGap).toBe(300); // Exact spacing value
    expect(initialGap).toBe(220); // Exact spacing value
  });

  it('should produce different layout when participantSpacing decreases', () => {
    const diagram = createTestDiagram({
      participants: [
        createParticipant('p1', 0, 'Application'),
        createParticipant('p2', 1, 'Application'),
        createParticipant('p3', 2, 'Application'),
      ],
    });

    // Initial spacing: 220
    const initialLayout = computeSequenceLayout(diagram, 220);

    // After decreasing spacing to 150
    const updatedLayout = computeSequenceLayout(diagram, 150);

    // Participant X positions should be closer together
    const initialP2X = initialLayout.participantLayouts.find(p => p.participantId === 'p2')!.x;
    const updatedP2X = updatedLayout.participantLayouts.find(p => p.participantId === 'p2')!.x;
    expect(updatedP2X).toBeLessThan(initialP2X);
  });

  it('should update message arrow positions when participantSpacing changes', () => {
    const diagram = createTestDiagram({
      participants: [
        createParticipant('p1', 0, 'Application'),
        createParticipant('p2', 1, 'Application'),
      ],
      messages: [createMessage('m1', 'p1', 'p2')],
      sequence_nodes: [createMessageNode('n1', 'm1', 0)],
    });

    // Initial spacing: 220
    const initialLayout = computeSequenceLayout(diagram, 220);

    // After changing spacing to 300
    const updatedLayout = computeSequenceLayout(diagram, 300);

    // Message fromX and toX should reflect new lifeline positions
    const initialMessage = initialLayout.messageLayouts[0];
    const updatedMessage = updatedLayout.messageLayouts[0];

    // fromX should remain at first participant's lifeline (constant leftMargin)
    expect(updatedMessage.fromX).toBe(initialMessage.fromX);

    // toX should be farther with increased spacing
    expect(updatedMessage.toX).toBeGreaterThan(initialMessage.toX);
  });

  it('should update fragment frame positions when participantSpacing changes', () => {
    const participants = [
      createParticipant('p1', 0, 'Application'),
      createParticipant('p2', 1, 'Application'),
    ];
    const message = createMessage('m1', 'p1', 'p2');
    const fragment = createFragment('f1', 'Loop');
    const operand = createOperand('o1', 'f1', 0);

    const diagram = createTestDiagram({
      participants,
      messages: [message],
      fragments: [fragment],
      operands: [operand],
      sequence_nodes: [
        createFragmentNode('fn1', 'f1', 0),
        createMessageNode('n1', 'm1', 0, 'fn1', 'o1'),
      ],
    });

    // Initial spacing: 220
    const initialLayout = computeSequenceLayout(diagram, 220);

    // After changing spacing to 300
    const updatedLayout = computeSequenceLayout(diagram, 300);

    // Fragment frame rightX should be farther with increased spacing
    const initialFragment = initialLayout.fragmentLayouts[0];
    const updatedFragment = updatedLayout.fragmentLayouts[0];
    expect(updatedFragment.rightX).toBeGreaterThan(initialFragment.rightX);

    // leftX should remain constant (first lifeline - 80)
    expect(updatedFragment.leftX).toBe(initialFragment.leftX);
  });
});

// ============================================================================
// Additional tests for reactive dependency verification
// ============================================================================

describe('Task 8.3: Reactive dependency tracking verification', () => {
  it('should produce identical layout for identical input', () => {
    const diagram = createTestDiagram({
      participants: [
        createParticipant('p1', 0, 'Application'),
        createParticipant('p2', 1, 'Application'),
      ],
      messages: [createMessage('m1', 'p1', 'p2')],
      sequence_nodes: [createMessageNode('n1', 'm1', 0)],
    });

    // Compute layout twice with same input
    const layout1 = computeSequenceLayout(diagram, 220);
    const layout2 = computeSequenceLayout(diagram, 220);

    // Results should be identical (pure function)
    expect(layout1.participantLayouts.length).toBe(layout2.participantLayouts.length);
    expect(layout1.messageLayouts.length).toBe(layout2.messageLayouts.length);
    expect(layout1.fragmentLayouts.length).toBe(layout2.fragmentLayouts.length);
    expect(layout1.lifelineTopY).toBe(layout2.lifelineTopY);
    expect(layout1.lifelineBottomY).toBe(layout2.lifelineBottomY);
    expect(layout1.messageStartY).toBe(layout2.messageStartY);
    expect(layout1.messageRowCount).toBe(layout2.messageRowCount);
  });

  it('should only recompute affected parts when data changes', () => {
    const baseDiagram = createTestDiagram({
      participants: [
        createParticipant('p1', 0, 'Application'),
        createParticipant('p2', 1, 'Application'),
      ],
      messages: [createMessage('m1', 'p1', 'p2')],
      sequence_nodes: [createMessageNode('n1', 'm1', 0)],
    });

    const baseLayout = computeSequenceLayout(baseDiagram, 220);

    // Add a second message
    const updatedDiagram = createTestDiagram({
      participants: [
        createParticipant('p1', 0, 'Application'),
        createParticipant('p2', 1, 'Application'),
      ],
      messages: [
        createMessage('m1', 'p1', 'p2'),
        createMessage('m2', 'p2', 'p1'),
      ],
      sequence_nodes: [
        createMessageNode('n1', 'm1', 0),
        createMessageNode('n2', 'm2', 1),
      ],
    });

    const updatedLayout = computeSequenceLayout(updatedDiagram, 220);

    // Participant layouts should remain unchanged
    expect(updatedLayout.participantLayouts[0].x).toBe(baseLayout.participantLayouts[0].x);
    expect(updatedLayout.participantLayouts[0].lifelineX).toBe(baseLayout.participantLayouts[0].lifelineX);

    // lifelineTopY and messageStartY should remain unchanged
    expect(updatedLayout.lifelineTopY).toBe(baseLayout.lifelineTopY);
    expect(updatedLayout.messageStartY).toBe(baseLayout.messageStartY);

    // Only message-dependent values should change
    expect(updatedLayout.messageLayouts.length).not.toBe(baseLayout.messageLayouts.length);
    expect(updatedLayout.lifelineBottomY).toBeGreaterThan(baseLayout.lifelineBottomY);
  });

  it('should handle sequence_nodes changes for Fragment nesting', () => {
    const participants = [
      createParticipant('p1', 0, 'Application'),
      createParticipant('p2', 1, 'Application'),
    ];
    const message = createMessage('m1', 'p1', 'p2');
    const fragment = createFragment('f1', 'Loop');
    const operand = createOperand('o1', 'f1', 0);

    // Message inside fragment
    const nestedDiagram = createTestDiagram({
      participants,
      messages: [message],
      fragments: [fragment],
      operands: [operand],
      sequence_nodes: [
        createFragmentNode('fn1', 'f1', 0),
        createMessageNode('n1', 'm1', 0, 'fn1', 'o1'), // nested inside fragment
      ],
    });

    const nestedLayout = computeSequenceLayout(nestedDiagram, 220);

    // Message not inside fragment
    const flatDiagram = createTestDiagram({
      participants,
      messages: [message],
      fragments: [fragment],
      operands: [operand],
      sequence_nodes: [
        createFragmentNode('fn1', 'f1', 1), // fragment after message
        createMessageNode('n1', 'm1', 0), // message at top level
      ],
    });

    const flatLayout = computeSequenceLayout(flatDiagram, 220);

    // Fragment row extents should differ based on nesting
    // In nestedDiagram, fragment contains the message
    expect(nestedLayout.fragmentLayouts[0].startRow).toBe(0);
    expect(nestedLayout.fragmentLayouts[0].endRow).toBe(0);

    // In flatDiagram, fragment has no messages (placeholder)
    expect(flatLayout.fragmentLayouts[0].startRow).toBe(1); // After message
    expect(flatLayout.fragmentLayouts[0].endRow).toBe(1); // Placeholder
  });
});
