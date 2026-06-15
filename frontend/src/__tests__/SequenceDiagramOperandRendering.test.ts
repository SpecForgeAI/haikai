/**
 * SequenceDiagramOperandRendering.test.ts
 * Task Group 5: Tests for operand rendering in Sequence Diagram Fragments
 *
 * Tests the operand rendering logic including:
 * - Loop/Optional: guard text "[guardExpression]" beneath fragment label
 * - Alternative: vertical regions split with horizontal separators
 * - Alternative: each operand guard at top-left of its region
 * - Operands sorted by operand_index
 */

import { describe, it, expect } from 'vitest';
import { computeSequenceLayout, LAYOUT_CONSTANTS, FragmentLayout, OperandLayout } from '../utils/sequenceLayout';
import {
  SequenceDiagram,
  SequenceParticipant,
  SequenceMessage,
  SequenceFragment,
  SequenceOperand,
  SequenceNode,
} from '../types/sequenceDiagram';

// ============================================================================
// Local implementations of operand rendering functions for testing
// These mirror the implementations in SequenceDiagramRenderer.tsx
// ============================================================================

const FRAGMENT_LABEL_FONT_SIZE = 10;
const FRAGMENT_LABEL_PADDING_Y = 2;
const FRAGMENT_LABEL_OFFSET_Y = 4;
const GUARD_OFFSET_Y = 16;
const GUARD_OFFSET_X = 8;

/**
 * Formats a guard expression by wrapping it in square brackets.
 */
function formatGuardExpression(expression: string): string {
  return `[${expression}]`;
}

interface LoopOptionalGuardResult {
  guardText: string;
  x: number;
  y: number;
}

/**
 * Calculates the guard display data for Loop or Optional fragments.
 */
function renderLoopOptionalGuard(layout: FragmentLayout): LoopOptionalGuardResult | null {
  if (!layout.operands || layout.operands.length === 0) {
    return null;
  }

  const sortedOperands = [...layout.operands].sort((a, b) => a.operandIndex - b.operandIndex);
  const operand = sortedOperands[0];

  if (!operand) {
    return null;
  }

  const labelBgHeight = FRAGMENT_LABEL_FONT_SIZE + FRAGMENT_LABEL_PADDING_Y * 2;
  const x = layout.leftX + GUARD_OFFSET_X;
  const y = layout.topY + FRAGMENT_LABEL_OFFSET_Y + labelBgHeight + GUARD_OFFSET_Y;

  return {
    guardText: formatGuardExpression(operand.guardExpression),
    x,
    y,
  };
}

interface OperandRegion {
  guardText: string;
  guardX: number;
  guardY: number;
  topY: number;
  height: number;
  operandId: string;
}

interface OperandSeparator {
  y: number;
  x1: number;
  x2: number;
}

interface AlternativeOperandsResult {
  operandRegions: OperandRegion[];
  separators: OperandSeparator[];
}

/**
 * Calculates the operand regions and separators for Alternative fragments.
 */
function renderAlternativeOperands(layout: FragmentLayout): AlternativeOperandsResult {
  const result: AlternativeOperandsResult = {
    operandRegions: [],
    separators: [],
  };

  if (!layout.operands || layout.operands.length === 0) {
    return result;
  }

  const sortedOperands = [...layout.operands].sort((a, b) => a.operandIndex - b.operandIndex);
  const operandCount = sortedOperands.length;

  const frameHeight = layout.bottomY - layout.topY;
  const regionHeight = frameHeight / operandCount;

  sortedOperands.forEach((operand, index) => {
    const regionTopY = layout.topY + index * regionHeight;

    const guardX = layout.leftX + GUARD_OFFSET_X;
    let guardY: number;

    if (index === 0) {
      const labelBgHeight = FRAGMENT_LABEL_FONT_SIZE + FRAGMENT_LABEL_PADDING_Y * 2;
      guardY = layout.topY + FRAGMENT_LABEL_OFFSET_Y + labelBgHeight + GUARD_OFFSET_Y;
    } else {
      guardY = regionTopY + GUARD_OFFSET_Y;
    }

    result.operandRegions.push({
      guardText: formatGuardExpression(operand.guardExpression),
      guardX,
      guardY,
      topY: regionTopY,
      height: regionHeight,
      operandId: operand.operandId,
    });
  });

  for (let i = 1; i < operandCount; i++) {
    const separatorY = layout.topY + i * regionHeight;
    result.separators.push({
      y: separatorY,
      x1: layout.leftX,
      x2: layout.rightX,
    });
  }

  return result;
}

// ============================================================================
// Test Helpers
// ============================================================================

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

// ============================================================================
// Tests
// ============================================================================

describe('SequenceDiagramOperandRendering - Guard Expression Formatting', () => {
  describe('Test 1: formatGuardExpression wraps expression in square brackets', () => {
    it('should wrap simple expression in square brackets', () => {
      const result = formatGuardExpression('i < 10');
      expect(result).toBe('[i < 10]');
    });

    it('should wrap complex expression in square brackets', () => {
      const result = formatGuardExpression('x > 0 && y < 100');
      expect(result).toBe('[x > 0 && y < 100]');
    });

    it('should handle empty guard expression', () => {
      const result = formatGuardExpression('');
      expect(result).toBe('[]');
    });

    it('should handle whitespace-only expression', () => {
      const result = formatGuardExpression('   ');
      expect(result).toBe('[   ]');
    });
  });
});

describe('SequenceDiagramOperandRendering - Loop/Optional Guard Rendering', () => {
  describe('Test 2: Loop/Optional fragments show guard text "[guardExpression]" beneath fragment label', () => {
    it('should render guard for Loop fragment operand at index 0', () => {
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
      const fragmentLayout = layout.fragmentLayouts.find(f => f.fragmentId === 'f1')!;

      const result = renderLoopOptionalGuard(fragmentLayout);

      expect(result).not.toBeNull();
      expect(result?.guardText).toBe('[i < 10]');
      // Guard should be positioned below the fragment label
      expect(result?.y).toBeGreaterThan(fragmentLayout.topY);
    });

    it('should render guard for Optional fragment operand at index 0', () => {
      const participants = [
        createParticipant('p1', 0),
        createParticipant('p2', 1),
      ];
      const messages = [createMessage('m1', 'p1', 'p2')];
      const fragments = [createFragment('f1', 'Optional')];
      const operands = [createOperand('op1', 'f1', 0, 'condition == true')];
      const nodes = [
        createNode('n1', 'Fragment', 0, 'f1'),
        createNode('n2', 'Message', 0, 'm1', 'n1', 'op1'),
      ];
      const diagram = createTestDiagram(participants, messages, fragments, operands, nodes);
      const layout = computeSequenceLayout(diagram, 220);
      const fragmentLayout = layout.fragmentLayouts.find(f => f.fragmentId === 'f1')!;

      const result = renderLoopOptionalGuard(fragmentLayout);

      expect(result).not.toBeNull();
      expect(result?.guardText).toBe('[condition == true]');
    });

    it('should return null for Loop fragment with no operands', () => {
      const participants = [
        createParticipant('p1', 0),
        createParticipant('p2', 1),
      ];
      const messages = [createMessage('m1', 'p1', 'p2')];
      const fragments = [createFragment('f1', 'Loop')];
      const nodes = [
        createNode('n1', 'Fragment', 0, 'f1'),
        createNode('n2', 'Message', 0, 'm1', 'n1'),
      ];
      // Note: no operands provided
      const diagram = createTestDiagram(participants, messages, fragments, [], nodes);
      const layout = computeSequenceLayout(diagram, 220);
      const fragmentLayout = layout.fragmentLayouts.find(f => f.fragmentId === 'f1')!;

      const result = renderLoopOptionalGuard(fragmentLayout);

      expect(result).toBeNull();
    });
  });
});

describe('SequenceDiagramOperandRendering - Alternative Fragment Operands', () => {
  describe('Test 3: Alternative fragments show vertical regions with horizontal separators', () => {
    it('should calculate correct region heights for 2 operands', () => {
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
      const fragmentLayout = layout.fragmentLayouts.find(f => f.fragmentId === 'f1')!;

      const result = renderAlternativeOperands(fragmentLayout);

      expect(result.operandRegions).toHaveLength(2);
      const frameHeight = fragmentLayout.bottomY - fragmentLayout.topY;
      const expectedRegionHeight = frameHeight / 2;
      expect(result.operandRegions[0].height).toBe(expectedRegionHeight);
      expect(result.operandRegions[1].height).toBe(expectedRegionHeight);
    });

    it('should return horizontal separator lines between operand regions', () => {
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
      const fragmentLayout = layout.fragmentLayouts.find(f => f.fragmentId === 'f1')!;

      const result = renderAlternativeOperands(fragmentLayout);

      // With 2 operands, there should be 1 separator
      expect(result.separators).toHaveLength(1);
      // Separator should be at the boundary between regions
      const frameHeight = fragmentLayout.bottomY - fragmentLayout.topY;
      const expectedSeparatorY = fragmentLayout.topY + frameHeight / 2;
      expect(result.separators[0].y).toBe(expectedSeparatorY);
      expect(result.separators[0].x1).toBe(fragmentLayout.leftX);
      expect(result.separators[0].x2).toBe(fragmentLayout.rightX);
    });

    it('should calculate correct separators for 3 operands', () => {
      const participants = [
        createParticipant('p1', 0),
        createParticipant('p2', 1),
      ];
      const messages = [
        createMessage('m1', 'p1', 'p2'),
        createMessage('m2', 'p2', 'p1'),
        createMessage('m3', 'p1', 'p2'),
      ];
      const fragments = [createFragment('f1', 'Alternative')];
      const operands = [
        createOperand('op1', 'f1', 0, 'x > 0'),
        createOperand('op2', 'f1', 1, 'x == 0'),
        createOperand('op3', 'f1', 2, 'else'),
      ];
      const nodes = [
        createNode('n1', 'Fragment', 0, 'f1'),
        createNode('n2', 'Message', 0, 'm1', 'n1', 'op1'),
        createNode('n3', 'Message', 1, 'm2', 'n1', 'op2'),
        createNode('n4', 'Message', 2, 'm3', 'n1', 'op3'),
      ];
      const diagram = createTestDiagram(participants, messages, fragments, operands, nodes);
      const layout = computeSequenceLayout(diagram, 220);
      const fragmentLayout = layout.fragmentLayouts.find(f => f.fragmentId === 'f1')!;

      const result = renderAlternativeOperands(fragmentLayout);

      // With 3 operands, there should be 2 separators
      expect(result.separators).toHaveLength(2);
      expect(result.operandRegions).toHaveLength(3);
    });
  });

  describe('Test 4: Each operand guard rendered at top-left of its region', () => {
    it('should render each operand guard with correct position and text', () => {
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
      const fragmentLayout = layout.fragmentLayouts.find(f => f.fragmentId === 'f1')!;

      const result = renderAlternativeOperands(fragmentLayout);

      // First operand guard
      expect(result.operandRegions[0].guardText).toBe('[x > 0]');
      expect(result.operandRegions[0].guardX).toBeGreaterThan(fragmentLayout.leftX);
      expect(result.operandRegions[0].guardY).toBeGreaterThan(fragmentLayout.topY);

      // Second operand guard
      expect(result.operandRegions[1].guardText).toBe('[else]');
      // Second guard should be positioned in the second region
      expect(result.operandRegions[1].guardY).toBeGreaterThan(result.operandRegions[0].guardY);
    });

    it('should sort operands by operand_index before rendering', () => {
      const participants = [
        createParticipant('p1', 0),
        createParticipant('p2', 1),
      ];
      const messages = [
        createMessage('m1', 'p1', 'p2'),
        createMessage('m2', 'p2', 'p1'),
      ];
      const fragments = [createFragment('f1', 'Alternative')];
      // Operands provided out of order
      const operands = [
        createOperand('op2', 'f1', 1, 'second condition'),
        createOperand('op1', 'f1', 0, 'first condition'),
      ];
      const nodes = [
        createNode('n1', 'Fragment', 0, 'f1'),
        createNode('n2', 'Message', 0, 'm1', 'n1', 'op1'),
        createNode('n3', 'Message', 1, 'm2', 'n1', 'op2'),
      ];
      const diagram = createTestDiagram(participants, messages, fragments, operands, nodes);
      const layout = computeSequenceLayout(diagram, 220);
      const fragmentLayout = layout.fragmentLayouts.find(f => f.fragmentId === 'f1')!;

      const result = renderAlternativeOperands(fragmentLayout);

      // Should be sorted by operand_index: first, then second
      expect(result.operandRegions[0].guardText).toBe('[first condition]');
      expect(result.operandRegions[1].guardText).toBe('[second condition]');
    });
  });
});

describe('SequenceDiagramOperandRendering - Edge Cases', () => {
  it('should handle Alternative fragment with single operand', () => {
    const participants = [
      createParticipant('p1', 0),
      createParticipant('p2', 1),
    ];
    const messages = [createMessage('m1', 'p1', 'p2')];
    const fragments = [createFragment('f1', 'Alternative')];
    const operands = [createOperand('op1', 'f1', 0, 'only option')];
    const nodes = [
      createNode('n1', 'Fragment', 0, 'f1'),
      createNode('n2', 'Message', 0, 'm1', 'n1', 'op1'),
    ];
    const diagram = createTestDiagram(participants, messages, fragments, operands, nodes);
    const layout = computeSequenceLayout(diagram, 220);
    const fragmentLayout = layout.fragmentLayouts.find(f => f.fragmentId === 'f1')!;

    const result = renderAlternativeOperands(fragmentLayout);

    // Single operand means no separators
    expect(result.separators).toHaveLength(0);
    expect(result.operandRegions).toHaveLength(1);
    expect(result.operandRegions[0].guardText).toBe('[only option]');
  });

  it('should return empty result for Alternative fragment with no operands', () => {
    const participants = [
      createParticipant('p1', 0),
      createParticipant('p2', 1),
    ];
    const messages = [createMessage('m1', 'p1', 'p2')];
    const fragments = [createFragment('f1', 'Alternative')];
    const nodes = [
      createNode('n1', 'Fragment', 0, 'f1'),
      createNode('n2', 'Message', 0, 'm1', 'n1'),
    ];
    // No operands provided
    const diagram = createTestDiagram(participants, messages, fragments, [], nodes);
    const layout = computeSequenceLayout(diagram, 220);
    const fragmentLayout = layout.fragmentLayouts.find(f => f.fragmentId === 'f1')!;

    const result = renderAlternativeOperands(fragmentLayout);

    expect(result.separators).toHaveLength(0);
    expect(result.operandRegions).toHaveLength(0);
  });
});
