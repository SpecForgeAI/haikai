/**
 * SequenceDiagramFragmentRendering.test.ts
 * Task Group 4: Tests for fragment frame rendering in Sequence Diagrams
 *
 * Tests the fragment frame rendering logic including:
 * - Frame rectangle with correct horizontal span (firstLifelineX - 80 to lastLifelineX + 80)
 * - Frame vertical span (topY = yAtRow(startRow) - 30, bottomY = yAtRow(endRow) + 30)
 * - Fragment label in top-left (lowercase fragmentKind: "loop", "opt", "alt")
 * - Empty fragment renders with minimal 1-row placeholder height
 * - Fragment label display with optional user-defined label text
 */

import { describe, it, expect } from 'vitest';
import { computeSequenceLayout, LAYOUT_CONSTANTS } from '../utils/sequenceLayout';
import { getFragmentLabel } from '../components/DiagramsView/SequenceDiagramRenderer';
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

describe('SequenceDiagramFragmentRendering - Fragment Frame Rendering', () => {
  describe('Test 1: Frame rectangle with correct horizontal span (firstLifelineX - 80 to lastLifelineX + 80)', () => {
    it('should compute horizontal span from first participant lifelineX - 80 to last lifelineX + 80', () => {
      const participants = [
        createParticipant('p1', 0),
        createParticipant('p2', 1),
        createParticipant('p3', 2),
      ];
      const messages = [
        createMessage('m1', 'p1', 'p2'),
        createMessage('m2', 'p2', 'p3'),
      ];
      const fragments = [createFragment('f1', 'Loop')];
      const operands = [createOperand('op1', 'f1', 0)];
      const nodes = [
        createNode('n1', 'Fragment', 0, 'f1'),
        createNode('n2', 'Message', 0, 'm1', 'n1', 'op1'),
        createNode('n3', 'Message', 1, 'm2', 'n1', 'op1'),
      ];
      const diagram = createTestDiagram(participants, messages, fragments, operands, nodes);

      const layout = computeSequenceLayout(diagram, 220);

      const f1Layout = layout.fragmentLayouts.find(f => f.fragmentId === 'f1');
      expect(f1Layout).toBeDefined();

      // First participant lifelineX: 60 + 75 = 135
      // Last participant lifelineX: 60 + 2*220 + 75 = 575
      // leftX = 135 - 80 = 55
      // rightX = 575 + 80 = 655
      expect(f1Layout?.leftX).toBe(55);
      expect(f1Layout?.rightX).toBe(655);
    });

    it('should compute correct horizontal span with two participants', () => {
      const participants = [
        createParticipant('p1', 0),
        createParticipant('p2', 1),
      ];
      const messages = [createMessage('m1', 'p1', 'p2')];
      const fragments = [createFragment('f1', 'Loop')];
      const operands = [createOperand('op1', 'f1', 0)];
      const nodes = [
        createNode('n1', 'Fragment', 0, 'f1'),
        createNode('n2', 'Message', 0, 'm1', 'n1', 'op1'),
      ];
      const diagram = createTestDiagram(participants, messages, fragments, operands, nodes);

      const layout = computeSequenceLayout(diagram, 220);

      const f1Layout = layout.fragmentLayouts.find(f => f.fragmentId === 'f1');

      // First participant lifelineX: 60 + 75 = 135
      // Last participant lifelineX: 60 + 1*220 + 75 = 355
      // leftX = 135 - 80 = 55
      // rightX = 355 + 80 = 435
      expect(f1Layout?.leftX).toBe(55);
      expect(f1Layout?.rightX).toBe(435);
    });

    it('should have frame width equal to (lastLifelineX - firstLifelineX + 160)', () => {
      const participants = [
        createParticipant('p1', 0),
        createParticipant('p2', 1),
      ];
      const messages = [createMessage('m1', 'p1', 'p2')];
      const fragments = [createFragment('f1', 'Optional')];
      const operands = [createOperand('op1', 'f1', 0)];
      const nodes = [
        createNode('n1', 'Fragment', 0, 'f1'),
        createNode('n2', 'Message', 0, 'm1', 'n1', 'op1'),
      ];
      const diagram = createTestDiagram(participants, messages, fragments, operands, nodes);

      const layout = computeSequenceLayout(diagram, 220);

      const f1Layout = layout.fragmentLayouts.find(f => f.fragmentId === 'f1');
      const frameWidth = (f1Layout?.rightX ?? 0) - (f1Layout?.leftX ?? 0);

      // Expected: (355 - 135) + 160 = 220 + 160 = 380
      expect(frameWidth).toBe(380);
    });
  });

  describe('Test 2: Frame vertical span (topY = yAtRow(startRow) - 30, bottomY = yAtRow(endRow) + 30)', () => {
    it('should compute topY and bottomY based on contained message rows', () => {
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
      const diagram = createTestDiagram(participants, messages, fragments, operands, nodes);

      const layout = computeSequenceLayout(diagram, 220);

      const f1Layout = layout.fragmentLayouts.find(f => f.fragmentId === 'f1');

      // messageStartY = 150, rowHeight = 60
      // startRow = 0, endRow = 1
      // topY = yAtRow(0) - 30 = 150 - 30 = 120
      // bottomY = yAtRow(1) + 30 = (150 + 1*60) + 30 = 240
      expect(f1Layout?.topY).toBe(120);
      expect(f1Layout?.bottomY).toBe(240);
      expect(f1Layout?.startRow).toBe(0);
      expect(f1Layout?.endRow).toBe(1);
    });

    it('should compute correct vertical span for fragment with single message', () => {
      const participants = [
        createParticipant('p1', 0),
        createParticipant('p2', 1),
      ];
      const messages = [createMessage('m1', 'p1', 'p2')];
      const fragments = [createFragment('f1', 'Optional')];
      const operands = [createOperand('op1', 'f1', 0)];
      const nodes = [
        createNode('n1', 'Fragment', 0, 'f1'),
        createNode('n2', 'Message', 0, 'm1', 'n1', 'op1'),
      ];
      const diagram = createTestDiagram(participants, messages, fragments, operands, nodes);

      const layout = computeSequenceLayout(diagram, 220);

      const f1Layout = layout.fragmentLayouts.find(f => f.fragmentId === 'f1');

      // startRow = 0, endRow = 0
      // topY = 150 - 30 = 120
      // bottomY = 150 + 30 = 180
      expect(f1Layout?.topY).toBe(120);
      expect(f1Layout?.bottomY).toBe(180);
    });

    it('should compute correct vertical span for fragment starting at row 1', () => {
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
      // m1 is outside fragment, m2 and m3 are inside
      const nodes = [
        createNode('n0', 'Message', 0, 'm1'),
        createNode('n1', 'Fragment', 1, 'f1'),
        createNode('n2', 'Message', 0, 'm2', 'n1', 'op1'),
        createNode('n3', 'Message', 1, 'm3', 'n1', 'op1'),
      ];
      const diagram = createTestDiagram(participants, messages, fragments, operands, nodes);

      const layout = computeSequenceLayout(diagram, 220);

      const f1Layout = layout.fragmentLayouts.find(f => f.fragmentId === 'f1');

      // startRow = 1 (m2), endRow = 2 (m3)
      // topY = yAtRow(1) - 30 = (150 + 1*60) - 30 = 180
      // bottomY = yAtRow(2) + 30 = (150 + 2*60) + 30 = 300
      expect(f1Layout?.startRow).toBe(1);
      expect(f1Layout?.endRow).toBe(2);
      expect(f1Layout?.topY).toBe(180);
      expect(f1Layout?.bottomY).toBe(300);
    });
  });

  describe('Test 3: Fragment label in top-left (lowercase fragmentKind: "loop", "opt", "alt")', () => {
    it('should store fragmentKind for Loop fragments', () => {
      const participants = [
        createParticipant('p1', 0),
        createParticipant('p2', 1),
      ];
      const messages = [createMessage('m1', 'p1', 'p2')];
      const fragments = [createFragment('f1', 'Loop')];
      const operands = [createOperand('op1', 'f1', 0, 'i < 10')];
      const nodes = [
        createNode('n1', 'Fragment', 0, 'f1'),
        createNode('n2', 'Message', 0, 'm1', 'n1', 'op1'),
      ];
      const diagram = createTestDiagram(participants, messages, fragments, operands, nodes);

      const layout = computeSequenceLayout(diagram, 220);

      const f1Layout = layout.fragmentLayouts.find(f => f.fragmentId === 'f1');
      expect(f1Layout?.fragmentKind).toBe('Loop');
      // When rendering, this should display as "loop"
      expect(f1Layout?.fragmentKind.toLowerCase()).toBe('loop');
    });

    it('should store fragmentKind for Optional fragments', () => {
      const participants = [
        createParticipant('p1', 0),
        createParticipant('p2', 1),
      ];
      const messages = [createMessage('m1', 'p1', 'p2')];
      const fragments = [createFragment('f1', 'Optional')];
      const operands = [createOperand('op1', 'f1', 0, 'condition')];
      const nodes = [
        createNode('n1', 'Fragment', 0, 'f1'),
        createNode('n2', 'Message', 0, 'm1', 'n1', 'op1'),
      ];
      const diagram = createTestDiagram(participants, messages, fragments, operands, nodes);

      const layout = computeSequenceLayout(diagram, 220);

      const f1Layout = layout.fragmentLayouts.find(f => f.fragmentId === 'f1');
      expect(f1Layout?.fragmentKind).toBe('Optional');
      // When rendering, Optional displays as "opt"
      expect(f1Layout?.fragmentKind === 'Optional' ? 'opt' : f1Layout?.fragmentKind.toLowerCase()).toBe('opt');
    });

    it('should store fragmentKind for Alternative fragments', () => {
      const participants = [
        createParticipant('p1', 0),
        createParticipant('p2', 1),
      ];
      const messages = [
        createMessage('m1', 'p1', 'p2'),
        createMessage('m2', 'p2', 'p1'),
      ];
      const fragments = [createFragment('f1', 'Alternative')];
      const operands = [
        createOperand('op1', 'f1', 0, 'x > 0'),
        createOperand('op2', 'f1', 1, 'else'),
      ];
      const nodes = [
        createNode('n1', 'Fragment', 0, 'f1'),
        createNode('n2', 'Message', 0, 'm1', 'n1', 'op1'),
        createNode('n3', 'Message', 1, 'm2', 'n1', 'op2'),
      ];
      const diagram = createTestDiagram(participants, messages, fragments, operands, nodes);

      const layout = computeSequenceLayout(diagram, 220);

      const f1Layout = layout.fragmentLayouts.find(f => f.fragmentId === 'f1');
      expect(f1Layout?.fragmentKind).toBe('Alternative');
      // When rendering, Alternative displays as "alt"
      expect(f1Layout?.fragmentKind === 'Alternative' ? 'alt' : f1Layout?.fragmentKind.toLowerCase()).toBe('alt');
    });

    it('should include operands in fragment layout for rendering guards', () => {
      const participants = [
        createParticipant('p1', 0),
        createParticipant('p2', 1),
      ];
      const messages = [createMessage('m1', 'p1', 'p2')];
      const fragments = [createFragment('f1', 'Loop')];
      const operands = [createOperand('op1', 'f1', 0, 'i < 10')];
      const nodes = [
        createNode('n1', 'Fragment', 0, 'f1'),
        createNode('n2', 'Message', 0, 'm1', 'n1', 'op1'),
      ];
      const diagram = createTestDiagram(participants, messages, fragments, operands, nodes);

      const layout = computeSequenceLayout(diagram, 220);

      const f1Layout = layout.fragmentLayouts.find(f => f.fragmentId === 'f1');
      expect(f1Layout?.operands).toHaveLength(1);
      expect(f1Layout?.operands[0].guardExpression).toBe('i < 10');
    });
  });

  describe('Test 4: Empty fragment renders with minimal 1-row placeholder height', () => {
    it('should assign placeholder extent of 1 row for empty fragment', () => {
      const participants = [
        createParticipant('p1', 0),
        createParticipant('p2', 1),
      ];
      const fragments = [createFragment('f1', 'Loop')];
      const operands = [createOperand('op1', 'f1', 0)];
      // Fragment node with no child message nodes
      const nodes = [createNode('n1', 'Fragment', 0, 'f1')];
      const diagram = createTestDiagram(participants, [], fragments, operands, nodes);

      const layout = computeSequenceLayout(diagram, 220);

      const f1Layout = layout.fragmentLayouts.find(f => f.fragmentId === 'f1');
      expect(f1Layout).toBeDefined();
      // Empty fragment should have startRow = endRow = 0 (placeholder)
      expect(f1Layout?.startRow).toBe(0);
      expect(f1Layout?.endRow).toBe(0);
    });

    it('should compute minimal frame height (60px = 1 row height) for empty fragment', () => {
      const participants = [
        createParticipant('p1', 0),
        createParticipant('p2', 1),
      ];
      const fragments = [createFragment('f1', 'Optional')];
      const operands = [createOperand('op1', 'f1', 0)];
      const nodes = [createNode('n1', 'Fragment', 0, 'f1')];
      const diagram = createTestDiagram(participants, [], fragments, operands, nodes);

      const layout = computeSequenceLayout(diagram, 220);

      const f1Layout = layout.fragmentLayouts.find(f => f.fragmentId === 'f1');
      // With placeholder row 0:
      // topY = yAtRow(0) - 30 = 150 - 30 = 120
      // bottomY = yAtRow(0) + 30 = 150 + 30 = 180
      // Frame height = 180 - 120 = 60 (one row height)
      expect(f1Layout?.topY).toBe(120);
      expect(f1Layout?.bottomY).toBe(180);
      expect((f1Layout?.bottomY ?? 0) - (f1Layout?.topY ?? 0)).toBe(60);
    });

    it('should still include horizontal span for empty fragment', () => {
      const participants = [
        createParticipant('p1', 0),
        createParticipant('p2', 1),
      ];
      const fragments = [createFragment('f1', 'Loop')];
      const operands = [createOperand('op1', 'f1', 0)];
      const nodes = [createNode('n1', 'Fragment', 0, 'f1')];
      const diagram = createTestDiagram(participants, [], fragments, operands, nodes);

      const layout = computeSequenceLayout(diagram, 220);

      const f1Layout = layout.fragmentLayouts.find(f => f.fragmentId === 'f1');
      // Should still span from first to last lifeline
      // leftX = 135 - 80 = 55
      // rightX = 355 + 80 = 435
      expect(f1Layout?.leftX).toBe(55);
      expect(f1Layout?.rightX).toBe(435);
    });
  });
});

describe('SequenceDiagramFragmentRendering - Fragment Label Display Strings', () => {
  /**
   * Helper function to convert fragmentKind to display label (legacy local version).
   * This mirrors the logic that should be implemented in the renderer.
   */
  function getFragmentLabelLegacy(fragmentKind: string): string {
    if (fragmentKind === 'Optional') return 'opt';
    if (fragmentKind === 'Alternative') return 'alt';
    return fragmentKind.toLowerCase();
  }

  it('should display "loop" for Loop fragments', () => {
    expect(getFragmentLabelLegacy('Loop')).toBe('loop');
  });

  it('should display "opt" for Optional fragments', () => {
    expect(getFragmentLabelLegacy('Optional')).toBe('opt');
  });

  it('should display "alt" for Alternative fragments', () => {
    expect(getFragmentLabelLegacy('Alternative')).toBe('alt');
  });
});

// ============================================================================
// New Tests: getFragmentLabel with user-defined label text
// Spec: Sequence Diagram Fragment Header Label Display
// ============================================================================

describe('getFragmentLabel with user label', () => {
  it('should return only kind when labelText is null', () => {
    expect(getFragmentLabel('Loop', null)).toBe('loop');
    expect(getFragmentLabel('Optional', null)).toBe('opt');
    expect(getFragmentLabel('Alternative', null)).toBe('alt');
  });

  it('should return only kind when labelText is undefined', () => {
    expect(getFragmentLabel('Loop', undefined)).toBe('loop');
    expect(getFragmentLabel('Optional', undefined)).toBe('opt');
    expect(getFragmentLabel('Alternative', undefined)).toBe('alt');
  });

  it('should return only kind when labelText is empty string', () => {
    expect(getFragmentLabel('Loop', '')).toBe('loop');
    expect(getFragmentLabel('Optional', '')).toBe('opt');
    expect(getFragmentLabel('Alternative', '')).toBe('alt');
  });

  it('should return only kind when labelText is whitespace-only', () => {
    expect(getFragmentLabel('Loop', '   ')).toBe('loop');
    expect(getFragmentLabel('Optional', '  \t  ')).toBe('opt');
    expect(getFragmentLabel('Alternative', '\n')).toBe('alt');
  });

  it('should append trimmed label when labelText has content', () => {
    expect(getFragmentLabel('Loop', 'Retry upload')).toBe('loop - Retry upload');
    expect(getFragmentLabel('Optional', 'Has permission')).toBe('opt - Has permission');
    expect(getFragmentLabel('Alternative', 'User type')).toBe('alt - User type');
  });

  it('should trim leading/trailing whitespace from label', () => {
    expect(getFragmentLabel('Loop', '  Retry upload  ')).toBe('loop - Retry upload');
  });
});

// ============================================================================
// Integration Tests: FragmentFrame label rendering via layout
// ============================================================================

describe('FragmentFrame label rendering integration', () => {
  it('should include labelText in fragment layout when labelText is provided', () => {
    const participants = [
      createParticipant('p1', 0),
      createParticipant('p2', 1),
    ];
    const messages = [createMessage('m1', 'p1', 'p2')];
    const fragments = [createFragment('f1', 'Loop', 'Retry upload')];
    const operands = [createOperand('op1', 'f1', 0, 'retries < 3')];
    const nodes = [
      createNode('n1', 'Fragment', 0, 'f1'),
      createNode('n2', 'Message', 0, 'm1', 'n1', 'op1'),
    ];
    const diagram = createTestDiagram(participants, messages, fragments, operands, nodes);

    const layout = computeSequenceLayout(diagram, 220);

    const f1Layout = layout.fragmentLayouts.find(f => f.fragmentId === 'f1');
    expect(f1Layout).toBeDefined();
    expect(f1Layout?.labelText).toBe('Retry upload');

    // Verify combined label using the actual getFragmentLabel function
    const displayLabel = getFragmentLabel(f1Layout!.fragmentKind, f1Layout?.labelText);
    expect(displayLabel).toBe('loop - Retry upload');
  });

  it('should render only kind abbreviation when labelText is empty/null in layout', () => {
    const participants = [
      createParticipant('p1', 0),
      createParticipant('p2', 1),
    ];
    const messages = [createMessage('m1', 'p1', 'p2')];
    // Fragment without labelText
    const fragments = [createFragment('f1', 'Optional')];
    const operands = [createOperand('op1', 'f1', 0, 'condition')];
    const nodes = [
      createNode('n1', 'Fragment', 0, 'f1'),
      createNode('n2', 'Message', 0, 'm1', 'n1', 'op1'),
    ];
    const diagram = createTestDiagram(participants, messages, fragments, operands, nodes);

    const layout = computeSequenceLayout(diagram, 220);

    const f1Layout = layout.fragmentLayouts.find(f => f.fragmentId === 'f1');
    expect(f1Layout).toBeDefined();
    expect(f1Layout?.labelText).toBeUndefined();

    // Verify label using the actual getFragmentLabel function - should be only kind
    const displayLabel = getFragmentLabel(f1Layout!.fragmentKind, f1Layout?.labelText);
    expect(displayLabel).toBe('opt');
  });
});
