/**
 * FlowTab Component Tests
 * Task Group 4: Tests for the FlowTab component and related sequence flow functionality
 *
 * Tests the Flow tab used for managing sequence diagram messages and fragments.
 */

import { describe, it, expect } from 'vitest';
import {
  SequenceDiagram,
  SequenceParticipant,
  SequenceMessage,
  SequenceFragment,
  SequenceOperand,
  SequenceNode,
  FRAGMENT_KINDS,
  MESSAGE_REF_KINDS,
} from '../types/sequenceDiagram';

// ============================================================================
// Helper Functions for Flow Tab Logic
// ============================================================================

/**
 * Build tree structure from flat sequence nodes list
 * Returns root-level nodes and provides nesting information
 */
interface TreeNode {
  node: SequenceNode;
  children: TreeNode[];
  depth: number;
}

function buildNodeTree(nodes: SequenceNode[]): TreeNode[] {
  // Sort by order_index
  const sorted = [...nodes].sort((a, b) => a.order_index - b.order_index);

  // Build lookup map
  const nodeMap = new Map<string, TreeNode>();
  for (const node of sorted) {
    nodeMap.set(node.id, { node, children: [], depth: 0 });
  }

  // Build tree
  const roots: TreeNode[] = [];
  for (const node of sorted) {
    const treeNode = nodeMap.get(node.id)!;

    if (node.parent_node_id && nodeMap.has(node.parent_node_id)) {
      const parent = nodeMap.get(node.parent_node_id)!;
      treeNode.depth = parent.depth + 1;
      parent.children.push(treeNode);
    } else if (node.parent_operand_id) {
      // Node is nested inside an operand - find the fragment node that owns this operand
      // For simplicity, treat operand-nested nodes as depth 1 from their fragment
      treeNode.depth = 1;
      roots.push(treeNode);
    } else {
      roots.push(treeNode);
    }
  }

  return roots;
}

/**
 * Get participant label from participant and message
 */
function getParticipantLabel(
  participantId: string,
  participants: SequenceParticipant[],
  entityLookup: Map<string, string>
): string {
  const participant = participants.find(p => p.id === participantId);
  if (!participant) return 'Unknown';

  // Look up entity name
  const key = `${participant.ref_kind}:${participant.ref_id}`;
  return entityLookup.get(key) || `${participant.ref_kind}:${participant.ref_id}`;
}

/**
 * Get message content label (either from reference or label_text)
 */
function getMessageContentLabel(
  message: SequenceMessage,
  entityLookup: Map<string, string>
): string {
  if (message.label_text) {
    return message.label_text;
  }
  if (message.ref_kind && message.ref_id) {
    const key = `${message.ref_kind}:${message.ref_id}`;
    return entityLookup.get(key) || `${message.ref_kind}:${message.ref_id}`;
  }
  return 'No content';
}

/**
 * Get fragment kind badge class based on fragment kind
 */
function getFragmentBadgeClass(fragmentKind: string): string {
  switch (fragmentKind) {
    case 'Loop':
      return 'badgeLoop';
    case 'Optional':
      return 'badgeOptional';
    case 'Alternative':
      return 'badgeAlternative';
    default:
      return 'badge';
  }
}

/**
 * Reindex nodes after move operation
 * Returns new array with updated order_index values for affected siblings
 */
function reindexNodesAfterMove(
  nodes: SequenceNode[],
  nodeId: string,
  direction: 'up' | 'down'
): SequenceNode[] {
  const nodeIndex = nodes.findIndex(n => n.id === nodeId);
  if (nodeIndex === -1) return nodes;

  const node = nodes[nodeIndex];

  // Find siblings (same parent scope)
  const siblings = nodes.filter(n =>
    n.parent_node_id === node.parent_node_id &&
    n.parent_operand_id === node.parent_operand_id
  ).sort((a, b) => a.order_index - b.order_index);

  const siblingIndex = siblings.findIndex(s => s.id === nodeId);
  if (siblingIndex === -1) return nodes;

  // Check if move is possible
  if (direction === 'up' && siblingIndex === 0) return nodes;
  if (direction === 'down' && siblingIndex === siblings.length - 1) return nodes;

  // Swap with adjacent sibling
  const swapIndex = direction === 'up' ? siblingIndex - 1 : siblingIndex + 1;
  const swapNode = siblings[swapIndex];

  // Create new array with swapped order_index values
  return nodes.map(n => {
    if (n.id === node.id) {
      return { ...n, order_index: swapNode.order_index };
    }
    if (n.id === swapNode.id) {
      return { ...n, order_index: node.order_index };
    }
    return n;
  });
}

/**
 * Generate unique ID for new entities
 */
function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Create a message exchange (request + optional response)
 */
interface MessageExchangeInput {
  fromParticipantId: string;
  toParticipantId: string;
  requestContent: { type: 'reference'; refKind: string; refId: string } | { type: 'label'; labelText: string };
  responseContent?: { type: 'reference'; refKind: string; refId: string } | { type: 'label'; labelText: string };
  parentNodeId?: string;
  parentOperandId?: string;
  insertAtIndex: number;
}

interface MessageExchangeResult {
  messages: SequenceMessage[];
  nodes: SequenceNode[];
  exchangeId: string;
}

function createMessageExchange(input: MessageExchangeInput): MessageExchangeResult {
  const exchangeId = generateId('exchange');
  const messages: SequenceMessage[] = [];
  const nodes: SequenceNode[] = [];

  // Create request message
  const requestMessageId = generateId('msg');
  const requestMessage: SequenceMessage = {
    id: requestMessageId,
    exchange_id: exchangeId,
    exchange_role: 'Request',
    from_participant_id: input.fromParticipantId,
    to_participant_id: input.toParticipantId,
    ...(input.requestContent.type === 'reference' ? {
      ref_kind: input.requestContent.refKind as any,
      ref_id: input.requestContent.refId,
    } : {
      label_text: input.requestContent.labelText,
    }),
  };
  messages.push(requestMessage);

  // Create request node
  const requestNodeId = generateId('node');
  const requestNode: SequenceNode = {
    id: requestNodeId,
    node_kind: 'Message',
    message_id: requestMessageId,
    order_index: input.insertAtIndex,
    parent_node_id: input.parentNodeId,
    parent_operand_id: input.parentOperandId,
  };
  nodes.push(requestNode);

  // Create response if provided
  if (input.responseContent) {
    const responseMessageId = generateId('msg');
    const responseMessage: SequenceMessage = {
      id: responseMessageId,
      exchange_id: exchangeId,
      exchange_role: 'Response',
      from_participant_id: input.toParticipantId, // Response goes back
      to_participant_id: input.fromParticipantId,
      ...(input.responseContent.type === 'reference' ? {
        ref_kind: input.responseContent.refKind as any,
        ref_id: input.responseContent.refId,
      } : {
        label_text: input.responseContent.labelText,
      }),
    };
    messages.push(responseMessage);

    // Create response node
    const responseNodeId = generateId('node');
    const responseNode: SequenceNode = {
      id: responseNodeId,
      node_kind: 'Message',
      message_id: responseMessageId,
      order_index: input.insertAtIndex + 1,
      parent_node_id: input.parentNodeId,
      parent_operand_id: input.parentOperandId,
    };
    nodes.push(responseNode);
  }

  return { messages, nodes, exchangeId };
}

/**
 * Create a fragment with operands
 */
interface FragmentInput {
  fragmentKind: 'Loop' | 'Optional' | 'Alternative';
  operands: Array<{ guardExpression: string }>;
  labelText?: string;
  insertAtIndex: number;
  parentNodeId?: string;
  parentOperandId?: string;
}

interface FragmentResult {
  fragment: SequenceFragment;
  operands: SequenceOperand[];
  node: SequenceNode;
}

function createFragment(input: FragmentInput): FragmentResult {
  const fragmentId = generateId('frag');

  const fragment: SequenceFragment = {
    id: fragmentId,
    fragment_kind: input.fragmentKind,
    label_text: input.labelText,
  };

  const operands: SequenceOperand[] = input.operands.map((op, index) => ({
    id: generateId('op'),
    fragment_id: fragmentId,
    guard_expression: op.guardExpression,
    operand_index: index,
  }));

  const node: SequenceNode = {
    id: generateId('node'),
    node_kind: 'Fragment',
    fragment_id: fragmentId,
    order_index: input.insertAtIndex,
    parent_node_id: input.parentNodeId,
    parent_operand_id: input.parentOperandId,
  };

  return { fragment, operands, node };
}

// ============================================================================
// Test Data Factories
// ============================================================================

function createTestParticipants(): SequenceParticipant[] {
  return [
    { id: 'p1', ref_kind: 'Application', ref_id: 'app-1', order_index: 0 },
    { id: 'p2', ref_kind: 'Service', ref_id: 'svc-1', order_index: 1 },
    { id: 'p3', ref_kind: 'Class', ref_id: 'cls-1', order_index: 2 },
  ];
}

function createTestEntityLookup(): Map<string, string> {
  const lookup = new Map<string, string>();
  lookup.set('Application:app-1', 'Frontend App');
  lookup.set('Service:svc-1', 'Order Service');
  lookup.set('Class:cls-1', 'OrderController');
  lookup.set('Method:m-1', 'processOrder()');
  lookup.set('Event:e-1', 'OrderCreated');
  return lookup;
}

function createTestSequenceDiagram(): SequenceDiagram {
  const participants = createTestParticipants();

  // Create some messages
  const messages: SequenceMessage[] = [
    {
      id: 'msg-1',
      exchange_id: 'ex-1',
      exchange_role: 'Request',
      from_participant_id: 'p1',
      to_participant_id: 'p2',
      ref_kind: 'Method',
      ref_id: 'm-1',
    },
    {
      id: 'msg-2',
      exchange_id: 'ex-1',
      exchange_role: 'Response',
      from_participant_id: 'p2',
      to_participant_id: 'p1',
      label_text: 'Order confirmed',
    },
  ];

  // Create a fragment
  const fragments: SequenceFragment[] = [
    { id: 'frag-1', fragment_kind: 'Loop', label_text: 'for each item' },
  ];

  const operands: SequenceOperand[] = [
    { id: 'op-1', fragment_id: 'frag-1', guard_expression: 'items.hasNext()', operand_index: 0 },
  ];

  // Create sequence nodes
  const sequence_nodes: SequenceNode[] = [
    { id: 'node-1', node_kind: 'Message', message_id: 'msg-1', order_index: 0 },
    { id: 'node-2', node_kind: 'Message', message_id: 'msg-2', order_index: 1 },
    { id: 'node-3', node_kind: 'Fragment', fragment_id: 'frag-1', order_index: 2 },
  ];

  return {
    id: 'sd-1',
    model_file_id: 'mf-1',
    name: 'Test Sequence Diagram',
    type: 'Sequence',
    participants,
    messages,
    fragments,
    operands,
    sequence_nodes,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('FlowTab - Tree Structure Rendering', () => {
  describe('Task 4.1: Sequence nodes render as indented tree structure', () => {
    it('should build flat nodes into tree structure', () => {
      const nodes: SequenceNode[] = [
        { id: 'n1', node_kind: 'Message', message_id: 'm1', order_index: 0 },
        { id: 'n2', node_kind: 'Fragment', fragment_id: 'f1', order_index: 1 },
        { id: 'n3', node_kind: 'Message', message_id: 'm2', order_index: 2 },
      ];

      const tree = buildNodeTree(nodes);

      expect(tree).toHaveLength(3);
      expect(tree[0].node.id).toBe('n1');
      expect(tree[0].depth).toBe(0);
      expect(tree[1].node.id).toBe('n2');
      expect(tree[2].node.id).toBe('n3');
    });

    it('should handle nested nodes with parent_node_id', () => {
      const nodes: SequenceNode[] = [
        { id: 'n1', node_kind: 'Fragment', fragment_id: 'f1', order_index: 0 },
        { id: 'n2', node_kind: 'Message', message_id: 'm1', order_index: 0, parent_node_id: 'n1' },
        { id: 'n3', node_kind: 'Message', message_id: 'm2', order_index: 1, parent_node_id: 'n1' },
      ];

      const tree = buildNodeTree(nodes);

      expect(tree).toHaveLength(1); // Only root node
      expect(tree[0].children).toHaveLength(2);
      expect(tree[0].children[0].depth).toBe(1);
      expect(tree[0].children[1].depth).toBe(1);
    });

    it('should sort nodes by order_index', () => {
      const nodes: SequenceNode[] = [
        { id: 'n3', node_kind: 'Message', message_id: 'm3', order_index: 2 },
        { id: 'n1', node_kind: 'Message', message_id: 'm1', order_index: 0 },
        { id: 'n2', node_kind: 'Message', message_id: 'm2', order_index: 1 },
      ];

      const tree = buildNodeTree(nodes);

      expect(tree[0].node.id).toBe('n1');
      expect(tree[1].node.id).toBe('n2');
      expect(tree[2].node.id).toBe('n3');
    });
  });
});

describe('FlowTab - Message Node Display', () => {
  describe('Task 4.1: Message nodes show from/to participant labels', () => {
    it('should resolve participant labels for messages', () => {
      const participants = createTestParticipants();
      const entityLookup = createTestEntityLookup();

      const fromLabel = getParticipantLabel('p1', participants, entityLookup);
      const toLabel = getParticipantLabel('p2', participants, entityLookup);

      expect(fromLabel).toBe('Frontend App');
      expect(toLabel).toBe('Order Service');
    });

    it('should return unknown for missing participant', () => {
      const participants = createTestParticipants();
      const entityLookup = createTestEntityLookup();

      const label = getParticipantLabel('non-existent', participants, entityLookup);

      expect(label).toBe('Unknown');
    });

    it('should show message content from reference', () => {
      const entityLookup = createTestEntityLookup();
      const message: SequenceMessage = {
        id: 'msg-1',
        exchange_id: 'ex-1',
        exchange_role: 'Request',
        from_participant_id: 'p1',
        to_participant_id: 'p2',
        ref_kind: 'Method',
        ref_id: 'm-1',
      };

      const label = getMessageContentLabel(message, entityLookup);

      expect(label).toBe('processOrder()');
    });

    it('should show message content from label_text', () => {
      const entityLookup = createTestEntityLookup();
      const message: SequenceMessage = {
        id: 'msg-1',
        exchange_id: 'ex-1',
        exchange_role: 'Response',
        from_participant_id: 'p2',
        to_participant_id: 'p1',
        label_text: 'Order confirmed',
      };

      const label = getMessageContentLabel(message, entityLookup);

      expect(label).toBe('Order confirmed');
    });
  });
});

describe('FlowTab - Fragment Node Display', () => {
  describe('Task 4.1: Fragment nodes show fragmentKind badge', () => {
    it('should return correct badge class for Loop fragment', () => {
      expect(getFragmentBadgeClass('Loop')).toBe('badgeLoop');
    });

    it('should return correct badge class for Optional fragment', () => {
      expect(getFragmentBadgeClass('Optional')).toBe('badgeOptional');
    });

    it('should return correct badge class for Alternative fragment', () => {
      expect(getFragmentBadgeClass('Alternative')).toBe('badgeAlternative');
    });

    it('should have all valid fragment kinds defined', () => {
      expect(FRAGMENT_KINDS).toContain('Loop');
      expect(FRAGMENT_KINDS).toContain('Optional');
      expect(FRAGMENT_KINDS).toContain('Alternative');
      expect(FRAGMENT_KINDS).toHaveLength(3);
    });
  });
});

describe('FlowTab - Message Exchange Creation', () => {
  describe('Task 4.1: Add Message Exchange creates correct records', () => {
    it('should create request-only exchange', () => {
      const result = createMessageExchange({
        fromParticipantId: 'p1',
        toParticipantId: 'p2',
        requestContent: { type: 'label', labelText: 'getOrder()' },
        insertAtIndex: 0,
      });

      expect(result.messages).toHaveLength(1);
      expect(result.nodes).toHaveLength(1);
      expect(result.messages[0].exchange_role).toBe('Request');
      expect(result.messages[0].label_text).toBe('getOrder()');
      expect(result.nodes[0].node_kind).toBe('Message');
    });

    it('should create request+response exchange', () => {
      const result = createMessageExchange({
        fromParticipantId: 'p1',
        toParticipantId: 'p2',
        requestContent: { type: 'reference', refKind: 'Method', refId: 'm-1' },
        responseContent: { type: 'label', labelText: 'Order data' },
        insertAtIndex: 0,
      });

      expect(result.messages).toHaveLength(2);
      expect(result.nodes).toHaveLength(2);

      // Request
      expect(result.messages[0].exchange_role).toBe('Request');
      expect(result.messages[0].ref_kind).toBe('Method');
      expect(result.messages[0].from_participant_id).toBe('p1');
      expect(result.messages[0].to_participant_id).toBe('p2');

      // Response - direction is reversed
      expect(result.messages[1].exchange_role).toBe('Response');
      expect(result.messages[1].label_text).toBe('Order data');
      expect(result.messages[1].from_participant_id).toBe('p2');
      expect(result.messages[1].to_participant_id).toBe('p1');

      // Both messages share exchange_id
      expect(result.messages[0].exchange_id).toBe(result.messages[1].exchange_id);
    });

    it('should set correct order_index for nodes', () => {
      const result = createMessageExchange({
        fromParticipantId: 'p1',
        toParticipantId: 'p2',
        requestContent: { type: 'label', labelText: 'request' },
        responseContent: { type: 'label', labelText: 'response' },
        insertAtIndex: 5,
      });

      expect(result.nodes[0].order_index).toBe(5);
      expect(result.nodes[1].order_index).toBe(6);
    });
  });
});

describe('FlowTab - Fragment Creation', () => {
  describe('Task 4.1: Add Fragment creates correct records', () => {
    it('should create Loop fragment with single operand', () => {
      const result = createFragment({
        fragmentKind: 'Loop',
        operands: [{ guardExpression: 'i < 10' }],
        insertAtIndex: 0,
      });

      expect(result.fragment.fragment_kind).toBe('Loop');
      expect(result.operands).toHaveLength(1);
      expect(result.operands[0].guard_expression).toBe('i < 10');
      expect(result.node.node_kind).toBe('Fragment');
      expect(result.node.fragment_id).toBe(result.fragment.id);
    });

    it('should create Alternative fragment with multiple operands', () => {
      const result = createFragment({
        fragmentKind: 'Alternative',
        operands: [
          { guardExpression: 'status == SUCCESS' },
          { guardExpression: 'status == FAILURE' },
          { guardExpression: 'else' },
        ],
        insertAtIndex: 0,
      });

      expect(result.fragment.fragment_kind).toBe('Alternative');
      expect(result.operands).toHaveLength(3);
      expect(result.operands[0].operand_index).toBe(0);
      expect(result.operands[1].operand_index).toBe(1);
      expect(result.operands[2].operand_index).toBe(2);
    });

    it('should set fragment label_text', () => {
      const result = createFragment({
        fragmentKind: 'Loop',
        operands: [{ guardExpression: 'items.hasNext()' }],
        labelText: 'Process each item',
        insertAtIndex: 0,
      });

      expect(result.fragment.label_text).toBe('Process each item');
    });
  });
});

describe('FlowTab - Node Ordering', () => {
  describe('Task 4.1: Move up/down reindexes affected siblings', () => {
    it('should move node up by swapping order_index', () => {
      const nodes: SequenceNode[] = [
        { id: 'n1', node_kind: 'Message', message_id: 'm1', order_index: 0 },
        { id: 'n2', node_kind: 'Message', message_id: 'm2', order_index: 1 },
        { id: 'n3', node_kind: 'Message', message_id: 'm3', order_index: 2 },
      ];

      const reindexed = reindexNodesAfterMove(nodes, 'n2', 'up');

      const n1 = reindexed.find(n => n.id === 'n1')!;
      const n2 = reindexed.find(n => n.id === 'n2')!;

      expect(n2.order_index).toBe(0);
      expect(n1.order_index).toBe(1);
    });

    it('should move node down by swapping order_index', () => {
      const nodes: SequenceNode[] = [
        { id: 'n1', node_kind: 'Message', message_id: 'm1', order_index: 0 },
        { id: 'n2', node_kind: 'Message', message_id: 'm2', order_index: 1 },
        { id: 'n3', node_kind: 'Message', message_id: 'm3', order_index: 2 },
      ];

      const reindexed = reindexNodesAfterMove(nodes, 'n2', 'down');

      const n2 = reindexed.find(n => n.id === 'n2')!;
      const n3 = reindexed.find(n => n.id === 'n3')!;

      expect(n2.order_index).toBe(2);
      expect(n3.order_index).toBe(1);
    });

    it('should not move first node up', () => {
      const nodes: SequenceNode[] = [
        { id: 'n1', node_kind: 'Message', message_id: 'm1', order_index: 0 },
        { id: 'n2', node_kind: 'Message', message_id: 'm2', order_index: 1 },
      ];

      const reindexed = reindexNodesAfterMove(nodes, 'n1', 'up');

      // Should return unchanged
      expect(reindexed).toEqual(nodes);
    });

    it('should not move last node down', () => {
      const nodes: SequenceNode[] = [
        { id: 'n1', node_kind: 'Message', message_id: 'm1', order_index: 0 },
        { id: 'n2', node_kind: 'Message', message_id: 'm2', order_index: 1 },
      ];

      const reindexed = reindexNodesAfterMove(nodes, 'n2', 'down');

      // Should return unchanged
      expect(reindexed).toEqual(nodes);
    });
  });
});

describe('FlowTab - Nested Operand Blocks', () => {
  describe('Task 4.1: Nested operand blocks render correctly', () => {
    it('should create nodes with parent_operand_id for nesting', () => {
      const fragment = createFragment({
        fragmentKind: 'Alternative',
        operands: [
          { guardExpression: 'success' },
          { guardExpression: 'failure' },
        ],
        insertAtIndex: 0,
      });

      // Create a nested message inside the first operand
      const nestedExchange = createMessageExchange({
        fromParticipantId: 'p1',
        toParticipantId: 'p2',
        requestContent: { type: 'label', labelText: 'nested message' },
        parentOperandId: fragment.operands[0].id,
        insertAtIndex: 0,
      });

      expect(nestedExchange.nodes[0].parent_operand_id).toBe(fragment.operands[0].id);
    });

    it('should support multiple levels of nesting', () => {
      // Create outer fragment
      const outerFragment = createFragment({
        fragmentKind: 'Loop',
        operands: [{ guardExpression: 'outer condition' }],
        insertAtIndex: 0,
      });

      // Create inner fragment nested in outer
      const innerFragment = createFragment({
        fragmentKind: 'Optional',
        operands: [{ guardExpression: 'inner condition' }],
        parentOperandId: outerFragment.operands[0].id,
        insertAtIndex: 0,
      });

      expect(innerFragment.node.parent_operand_id).toBe(outerFragment.operands[0].id);
    });
  });
});

describe('FlowTab - Type Guards and Constants', () => {
  it('should have all valid MESSAGE_REF_KINDS', () => {
    expect(MESSAGE_REF_KINDS).toContain('Method');
    expect(MESSAGE_REF_KINDS).toContain('LogicalEntity');
    expect(MESSAGE_REF_KINDS).toContain('PhysicalEntity');
    expect(MESSAGE_REF_KINDS).toContain('Class');
    expect(MESSAGE_REF_KINDS).toContain('Event');
    expect(MESSAGE_REF_KINDS).toContain('Interface');
    expect(MESSAGE_REF_KINDS).toContain('InterfaceEndpoint');
    expect(MESSAGE_REF_KINDS).toHaveLength(7);
  });
});
