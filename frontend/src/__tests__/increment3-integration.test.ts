/**
 * Increment 3 Integration Tests
 * Task Group 6: Strategic tests to fill critical end-to-end workflow gaps
 *
 * These tests focus on integration points between frontend and backend,
 * verifying complete workflows for Increment 3 features:
 * - Sequence diagram save/reload cycles
 * - StateTransition edge editing workflows
 * - ActivityFlow edge editing workflows
 */

import { describe, it, expect } from 'vitest';
import {
  SequenceDiagram,
  SequenceParticipant,
  SequenceMessage,
  SequenceFragment,
  SequenceOperand,
  SequenceNode,
} from '../types/sequenceDiagram';
import {
  StateTransition,
  ActivityFlow,
  MetaModel,
  State,
  Activity,
  Event,
  Method,
} from '../types/model';

// ============================================================================
// Test Data Factories
// ============================================================================

/**
 * Creates a minimal MetaModel with entities needed for testing
 */
function createTestMetaModel(): MetaModel {
  return {
    entities: {
      business_users: [],
      business_processes: [],
      process_activities: [],
      business_points: [],
      applications: [
        { id: 'app-1', name: 'Frontend App', description: '', app_type: '', status: '', tags: '' },
        { id: 'app-2', name: 'Backend API', description: '', app_type: '', status: '', tags: '' },
      ],
      app_components: [],
      services: [
        { id: 'svc-1', name: 'Order Service', description: '', application_id: 'app-2', service_type: '', tags: '' },
      ],
      interfaces: [],
      endpoints: [],
      classes: [
        { id: 'class-1', name: 'OrderController' },
      ],
      methods: [
        { id: 'method-1', class_id: 'class-1', name: 'processOrder' },
        { id: 'method-2', class_id: 'class-1', name: 'validateOrder' },
      ],
      application_points: [],
      logical_data_entities: [],
      logical_data_attributes: [],
      physical_data_entities: [],
      physical_data_attributes: [],
      interactions: [],
      app_business_points: [],
      events: [
        { id: 'event-1', name: 'OrderCreated', description: '', tags: '' },
        { id: 'event-2', name: 'OrderCompleted', description: '', tags: '' },
      ],
      states: [
        { id: 'state-1', name: 'Pending', state_kind: 'Initial' },
        { id: 'state-2', name: 'Processing', state_kind: 'Normal' },
        { id: 'state-3', name: 'Completed', state_kind: 'Final' },
      ],
      state_transitions: [],
      activities: [
        { id: 'activity-1', name: 'Start', activity_kind: 'Initial' },
        { id: 'activity-2', name: 'Process Order', activity_kind: 'Action' },
        { id: 'activity-3', name: 'End', activity_kind: 'Final' },
      ],
      activity_flows: [],
      activity_partitions: [],
    },
    relationships: {
      business_user_business_points: [],
      application_point_business_points: [],
      logical_data_entity_relationships: [],
      logical_data_entity_physical_data_entities: [],
      logical_data_attribute_physical_data_attributes: [],
      data_movements: [],
      interface_logical_entities: [],
    },
  };
}

/**
 * Creates a complete sequence diagram for save/reload testing
 */
function createCompleteSequenceDiagram(): SequenceDiagram {
  return {
    id: 'sd-test-1',
    model_file_id: 'mf-1',
    name: 'Order Processing Sequence',
    type: 'Sequence',
    participants: [
      { id: 'p-1', ref_kind: 'Application', ref_id: 'app-1', order_index: 0 },
      { id: 'p-2', ref_kind: 'Service', ref_id: 'svc-1', order_index: 1 },
      { id: 'p-3', ref_kind: 'Class', ref_id: 'class-1', order_index: 2 },
    ],
    messages: [
      {
        id: 'msg-1',
        exchange_id: 'ex-1',
        exchange_role: 'Request',
        from_participant_id: 'p-1',
        to_participant_id: 'p-2',
        ref_kind: 'Method',
        ref_id: 'method-1',
      },
      {
        id: 'msg-2',
        exchange_id: 'ex-1',
        exchange_role: 'Response',
        from_participant_id: 'p-2',
        to_participant_id: 'p-1',
        label_text: 'Order confirmed',
      },
    ],
    fragments: [
      { id: 'frag-1', fragment_kind: 'Loop', label_text: 'for each item' },
    ],
    operands: [
      { id: 'op-1', fragment_id: 'frag-1', guard_expression: 'items.hasNext()', operand_index: 0 },
    ],
    sequence_nodes: [
      { id: 'node-1', node_kind: 'Message', message_id: 'msg-1', order_index: 0 },
      { id: 'node-2', node_kind: 'Message', message_id: 'msg-2', order_index: 1 },
      { id: 'node-3', node_kind: 'Fragment', fragment_id: 'frag-1', order_index: 2 },
    ],
  };
}

// ============================================================================
// Utility Functions for Integration Testing
// ============================================================================

/**
 * Simulates serializing a SequenceDiagram to JSON payload for API
 */
function serializeForSave(diagram: SequenceDiagram): string {
  return JSON.stringify(diagram);
}

/**
 * Simulates deserializing a SequenceDiagram from API response
 */
function deserializeFromLoad(json: string): SequenceDiagram {
  return JSON.parse(json) as SequenceDiagram;
}

/**
 * Validates that a message has proper one-of constraint
 * Either (ref_kind + ref_id) OR label_text, not both
 */
function validateMessageContentOneOf(message: SequenceMessage): { valid: boolean; error?: string } {
  const hasRef = message.ref_kind && message.ref_id;
  const hasLabel = !!message.label_text;

  if (!hasRef && !hasLabel) {
    return { valid: false, error: 'Message must have either ref_kind/ref_id OR label_text' };
  }
  if (hasRef && hasLabel) {
    return { valid: false, error: 'Message cannot have both ref_kind/ref_id AND label_text' };
  }
  return { valid: true };
}

/**
 * Determines trigger mode from StateTransition fields
 */
function getTriggerMode(transition: StateTransition): 'Event' | 'Method' | 'Text' | 'None' {
  if (transition.trigger_ref_kind === 'Event') return 'Event';
  if (transition.trigger_ref_kind === 'Method') return 'Method';
  if (transition.trigger_label_text) return 'Text';
  return 'None';
}

/**
 * Clears previous trigger fields when switching modes
 */
function clearTriggerFields(transition: StateTransition): StateTransition {
  return {
    ...transition,
    trigger_ref_kind: undefined,
    trigger_ref_id: undefined,
    trigger_label_text: undefined,
  };
}

/**
 * Updates trigger fields for Event mode
 */
function setTriggerEventMode(transition: StateTransition, eventId: string): StateTransition {
  const cleared = clearTriggerFields(transition);
  return {
    ...cleared,
    trigger_ref_kind: 'Event',
    trigger_ref_id: eventId,
  };
}

/**
 * Updates trigger fields for Method mode
 */
function setTriggerMethodMode(transition: StateTransition, methodId: string): StateTransition {
  const cleared = clearTriggerFields(transition);
  return {
    ...cleared,
    trigger_ref_kind: 'Method',
    trigger_ref_id: methodId,
  };
}

/**
 * Updates trigger fields for Text mode
 */
function setTriggerTextMode(transition: StateTransition, text: string): StateTransition {
  const cleared = clearTriggerFields(transition);
  return {
    ...cleared,
    trigger_label_text: text,
  };
}

// ============================================================================
// Integration Tests
// ============================================================================

describe('Sequence Diagram Save/Reload Integration', () => {
  describe('Test 1: Full sequence diagram round-trip serialization', () => {
    it('should serialize and deserialize a complete sequence diagram without data loss', () => {
      const original = createCompleteSequenceDiagram();

      // Simulate save: serialize to JSON
      const serialized = serializeForSave(original);

      // Simulate reload: deserialize from JSON
      const reloaded = deserializeFromLoad(serialized);

      // Verify all data preserved
      expect(reloaded.id).toBe(original.id);
      expect(reloaded.name).toBe(original.name);
      expect(reloaded.participants).toHaveLength(3);
      expect(reloaded.messages).toHaveLength(2);
      expect(reloaded.fragments).toHaveLength(1);
      expect(reloaded.operands).toHaveLength(1);
      expect(reloaded.sequence_nodes).toHaveLength(3);

      // Verify participant ordering preserved
      expect(reloaded.participants[0].order_index).toBe(0);
      expect(reloaded.participants[1].order_index).toBe(1);
      expect(reloaded.participants[2].order_index).toBe(2);

      // Verify message exchange_id preserved
      expect(reloaded.messages[0].exchange_id).toBe('ex-1');
      expect(reloaded.messages[1].exchange_id).toBe('ex-1');

      // Verify fragment-operand relationship preserved
      expect(reloaded.operands[0].fragment_id).toBe('frag-1');
      expect(reloaded.operands[0].guard_expression).toBe('items.hasNext()');
    });
  });

  describe('Test 2: Participant add workflow with message exchange', () => {
    it('should add participant then create message exchange correctly', () => {
      const diagram = createCompleteSequenceDiagram();

      // Add new participant
      const newParticipant: SequenceParticipant = {
        id: 'p-4',
        ref_kind: 'Application',
        ref_id: 'app-2',
        order_index: 3,
      };
      diagram.participants.push(newParticipant);

      // Add message exchange involving new participant
      const newExchangeId = 'ex-2';
      const requestMsg: SequenceMessage = {
        id: 'msg-3',
        exchange_id: newExchangeId,
        exchange_role: 'Request',
        from_participant_id: 'p-2',
        to_participant_id: 'p-4',
        ref_kind: 'Method',
        ref_id: 'method-2',
      };
      const responseMsg: SequenceMessage = {
        id: 'msg-4',
        exchange_id: newExchangeId,
        exchange_role: 'Response',
        from_participant_id: 'p-4',
        to_participant_id: 'p-2',
        label_text: 'Validation result',
      };
      diagram.messages.push(requestMsg, responseMsg);

      // Add sequence nodes for new messages
      const reqNode: SequenceNode = {
        id: 'node-4',
        node_kind: 'Message',
        message_id: 'msg-3',
        order_index: 3,
      };
      const resNode: SequenceNode = {
        id: 'node-5',
        node_kind: 'Message',
        message_id: 'msg-4',
        order_index: 4,
      };
      diagram.sequence_nodes.push(reqNode, resNode);

      // Serialize and reload
      const serialized = serializeForSave(diagram);
      const reloaded = deserializeFromLoad(serialized);

      // Verify additions preserved
      expect(reloaded.participants).toHaveLength(4);
      expect(reloaded.messages).toHaveLength(4);
      expect(reloaded.sequence_nodes).toHaveLength(5);

      // Verify new exchange has correct structure
      const newMessages = reloaded.messages.filter(m => m.exchange_id === newExchangeId);
      expect(newMessages).toHaveLength(2);
      expect(newMessages.find(m => m.exchange_role === 'Request')).toBeDefined();
      expect(newMessages.find(m => m.exchange_role === 'Response')).toBeDefined();
    });
  });

  describe('Test 3: Fragment with nested message via operand', () => {
    it('should create message nested inside fragment operand with correct parent_operand_id', () => {
      const diagram = createCompleteSequenceDiagram();

      // Create a message nested inside the existing Loop fragment's operand
      const nestedMsg: SequenceMessage = {
        id: 'msg-nested',
        exchange_id: 'ex-nested',
        exchange_role: 'Request',
        from_participant_id: 'p-2',
        to_participant_id: 'p-3',
        label_text: 'Process item',
      };
      diagram.messages.push(nestedMsg);

      // Create node with parent_operand_id pointing to the fragment's operand
      const nestedNode: SequenceNode = {
        id: 'node-nested',
        node_kind: 'Message',
        message_id: 'msg-nested',
        order_index: 0,
        parent_operand_id: 'op-1', // Nested inside the Loop's operand
      };
      diagram.sequence_nodes.push(nestedNode);

      // Serialize and reload
      const serialized = serializeForSave(diagram);
      const reloaded = deserializeFromLoad(serialized);

      // Find the nested node
      const nestedNodeReloaded = reloaded.sequence_nodes.find(n => n.id === 'node-nested');
      expect(nestedNodeReloaded).toBeDefined();
      expect(nestedNodeReloaded?.parent_operand_id).toBe('op-1');
      expect(nestedNodeReloaded?.node_kind).toBe('Message');
      expect(nestedNodeReloaded?.message_id).toBe('msg-nested');
    });
  });
});

describe('Message Content One-Of Constraint', () => {
  describe('Test 4: Frontend validation of message content constraint', () => {
    it('should validate message with ref_kind/ref_id as valid', () => {
      const message: SequenceMessage = {
        id: 'msg-1',
        exchange_id: 'ex-1',
        exchange_role: 'Request',
        from_participant_id: 'p-1',
        to_participant_id: 'p-2',
        ref_kind: 'Method',
        ref_id: 'method-1',
      };

      const result = validateMessageContentOneOf(message);
      expect(result.valid).toBe(true);
    });

    it('should validate message with label_text as valid', () => {
      const message: SequenceMessage = {
        id: 'msg-1',
        exchange_id: 'ex-1',
        exchange_role: 'Response',
        from_participant_id: 'p-2',
        to_participant_id: 'p-1',
        label_text: 'Success response',
      };

      const result = validateMessageContentOneOf(message);
      expect(result.valid).toBe(true);
    });

    it('should reject message with both ref fields AND label_text', () => {
      const message: SequenceMessage = {
        id: 'msg-1',
        exchange_id: 'ex-1',
        exchange_role: 'Request',
        from_participant_id: 'p-1',
        to_participant_id: 'p-2',
        ref_kind: 'Method',
        ref_id: 'method-1',
        label_text: 'Also has text', // Invalid: both ref and label
      };

      const result = validateMessageContentOneOf(message);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('cannot have both');
    });

    it('should reject message with neither ref fields nor label_text', () => {
      const message: SequenceMessage = {
        id: 'msg-1',
        exchange_id: 'ex-1',
        exchange_role: 'Request',
        from_participant_id: 'p-1',
        to_participant_id: 'p-2',
        // Missing both ref and label
      };

      const result = validateMessageContentOneOf(message);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('must have either');
    });
  });
});

describe('StateTransition Edge Inspector Mode Switching', () => {
  describe('Test 5: Trigger mode switching clears previous fields', () => {
    it('should clear Event fields when switching to Method mode', () => {
      const transition: StateTransition = {
        id: 'transition-1',
        from_state_id: 'state-1',
        to_state_id: 'state-2',
        trigger_ref_kind: 'Event',
        trigger_ref_id: 'event-1',
      };

      expect(getTriggerMode(transition)).toBe('Event');

      // Switch to Method mode
      const updated = setTriggerMethodMode(transition, 'method-1');

      expect(getTriggerMode(updated)).toBe('Method');
      expect(updated.trigger_ref_kind).toBe('Method');
      expect(updated.trigger_ref_id).toBe('method-1');
      expect(updated.trigger_label_text).toBeUndefined();
    });

    it('should clear Method fields when switching to Text mode', () => {
      const transition: StateTransition = {
        id: 'transition-1',
        from_state_id: 'state-1',
        to_state_id: 'state-2',
        trigger_ref_kind: 'Method',
        trigger_ref_id: 'method-1',
      };

      expect(getTriggerMode(transition)).toBe('Method');

      // Switch to Text mode
      const updated = setTriggerTextMode(transition, 'User clicks submit');

      expect(getTriggerMode(updated)).toBe('Text');
      expect(updated.trigger_ref_kind).toBeUndefined();
      expect(updated.trigger_ref_id).toBeUndefined();
      expect(updated.trigger_label_text).toBe('User clicks submit');
    });

    it('should clear Text fields when switching to Event mode', () => {
      const transition: StateTransition = {
        id: 'transition-1',
        from_state_id: 'state-1',
        to_state_id: 'state-2',
        trigger_label_text: 'Some action',
      };

      expect(getTriggerMode(transition)).toBe('Text');

      // Switch to Event mode
      const updated = setTriggerEventMode(transition, 'event-2');

      expect(getTriggerMode(updated)).toBe('Event');
      expect(updated.trigger_ref_kind).toBe('Event');
      expect(updated.trigger_ref_id).toBe('event-2');
      expect(updated.trigger_label_text).toBeUndefined();
    });
  });

  describe('Test 6: StateTransition edit round-trip', () => {
    it('should preserve all fields after serialization round-trip', () => {
      const transition: StateTransition = {
        id: 'transition-1',
        from_state_id: 'state-1',
        to_state_id: 'state-2',
        trigger_ref_kind: 'Event',
        trigger_ref_id: 'event-1',
        guard_expression: 'order.isValid()',
        effect_ref_kind: 'Method',
        effect_ref_id: 'method-2',
        order_index: 0,
        description: 'Transition when order created',
      };

      // Serialize and deserialize
      const serialized = JSON.stringify(transition);
      const reloaded = JSON.parse(serialized) as StateTransition;

      // Verify all fields preserved
      expect(reloaded.id).toBe(transition.id);
      expect(reloaded.from_state_id).toBe(transition.from_state_id);
      expect(reloaded.to_state_id).toBe(transition.to_state_id);
      expect(reloaded.trigger_ref_kind).toBe(transition.trigger_ref_kind);
      expect(reloaded.trigger_ref_id).toBe(transition.trigger_ref_id);
      expect(reloaded.guard_expression).toBe(transition.guard_expression);
      expect(reloaded.effect_ref_kind).toBe(transition.effect_ref_kind);
      expect(reloaded.effect_ref_id).toBe(transition.effect_ref_id);
      expect(reloaded.order_index).toBe(transition.order_index);
      expect(reloaded.description).toBe(transition.description);
    });
  });
});

describe('ActivityFlow Edge Inspector', () => {
  describe('Test 7: ActivityFlow edit round-trip', () => {
    it('should preserve all fields including flowKind after serialization', () => {
      const flow: ActivityFlow = {
        id: 'flow-1',
        from_activity_id: 'activity-1',
        to_activity_id: 'activity-2',
        flow_kind: 'Data',
        trigger_ref_kind: 'Event',
        trigger_ref_id: 'event-1',
        condition_expression: 'data.isReady()',
        order_index: 0,
        description: 'Data flow when event fires',
      };

      // Serialize and deserialize
      const serialized = JSON.stringify(flow);
      const reloaded = JSON.parse(serialized) as ActivityFlow;

      // Verify all fields preserved
      expect(reloaded.id).toBe(flow.id);
      expect(reloaded.from_activity_id).toBe(flow.from_activity_id);
      expect(reloaded.to_activity_id).toBe(flow.to_activity_id);
      expect(reloaded.flow_kind).toBe('Data');
      expect(reloaded.trigger_ref_kind).toBe('Event');
      expect(reloaded.trigger_ref_id).toBe('event-1');
      expect(reloaded.condition_expression).toBe('data.isReady()');
    });
  });

  describe('Test 8: ActivityFlow flowKind switching', () => {
    it('should allow changing flowKind from Control to Data', () => {
      const flow: ActivityFlow = {
        id: 'flow-1',
        from_activity_id: 'activity-1',
        to_activity_id: 'activity-2',
        flow_kind: 'Control',
      };

      expect(flow.flow_kind).toBe('Control');

      // Update flow_kind
      const updatedFlow: ActivityFlow = {
        ...flow,
        flow_kind: 'Data',
      };

      expect(updatedFlow.flow_kind).toBe('Data');
      expect(updatedFlow.from_activity_id).toBe(flow.from_activity_id);
      expect(updatedFlow.to_activity_id).toBe(flow.to_activity_id);
    });
  });
});

describe('Alternative Fragment with Multiple Operands', () => {
  describe('Test 9: Alternative fragment operand ordering', () => {
    it('should preserve operand order and guard expressions after round-trip', () => {
      const diagram: SequenceDiagram = {
        id: 'sd-alt',
        model_file_id: 'mf-1',
        name: 'Alternative Test',
        type: 'Sequence',
        participants: [
          { id: 'p-1', ref_kind: 'Application', ref_id: 'app-1', order_index: 0 },
          { id: 'p-2', ref_kind: 'Service', ref_id: 'svc-1', order_index: 1 },
        ],
        messages: [],
        fragments: [
          { id: 'frag-alt', fragment_kind: 'Alternative', label_text: 'Order validation' },
        ],
        operands: [
          { id: 'op-success', fragment_id: 'frag-alt', guard_expression: 'status == SUCCESS', operand_index: 0 },
          { id: 'op-failure', fragment_id: 'frag-alt', guard_expression: 'status == FAILURE', operand_index: 1 },
          { id: 'op-pending', fragment_id: 'frag-alt', guard_expression: 'else', operand_index: 2 },
        ],
        sequence_nodes: [
          { id: 'node-frag', node_kind: 'Fragment', fragment_id: 'frag-alt', order_index: 0 },
        ],
      };

      // Serialize and reload
      const serialized = serializeForSave(diagram);
      const reloaded = deserializeFromLoad(serialized);

      // Verify operand ordering preserved
      const sortedOperands = [...reloaded.operands].sort((a, b) => a.operand_index - b.operand_index);
      expect(sortedOperands[0].guard_expression).toBe('status == SUCCESS');
      expect(sortedOperands[1].guard_expression).toBe('status == FAILURE');
      expect(sortedOperands[2].guard_expression).toBe('else');

      // Verify fragment kind preserved
      expect(reloaded.fragments[0].fragment_kind).toBe('Alternative');
    });
  });
});

describe('Sequence Node Nesting Hierarchy', () => {
  describe('Test 10: Deep nesting with parent_node_id and parent_operand_id', () => {
    it('should preserve nesting hierarchy through round-trip', () => {
      // Create diagram with nested structure:
      // - Fragment (Alternative)
      //   - Operand 1
      //     - Fragment (Loop)
      //       - Operand (loop body)
      //         - Message (deeply nested)

      const diagram: SequenceDiagram = {
        id: 'sd-nested',
        model_file_id: 'mf-1',
        name: 'Nested Structure Test',
        type: 'Sequence',
        participants: [
          { id: 'p-1', ref_kind: 'Application', ref_id: 'app-1', order_index: 0 },
          { id: 'p-2', ref_kind: 'Service', ref_id: 'svc-1', order_index: 1 },
        ],
        messages: [
          {
            id: 'msg-deep',
            exchange_id: 'ex-deep',
            exchange_role: 'Request',
            from_participant_id: 'p-1',
            to_participant_id: 'p-2',
            label_text: 'Process item',
          },
        ],
        fragments: [
          { id: 'frag-outer', fragment_kind: 'Alternative' },
          { id: 'frag-inner', fragment_kind: 'Loop', label_text: 'for each' },
        ],
        operands: [
          { id: 'op-alt-1', fragment_id: 'frag-outer', guard_expression: 'hasItems', operand_index: 0 },
          { id: 'op-loop', fragment_id: 'frag-inner', guard_expression: 'items.next()', operand_index: 0 },
        ],
        sequence_nodes: [
          // Outer fragment node (root level)
          { id: 'node-outer', node_kind: 'Fragment', fragment_id: 'frag-outer', order_index: 0 },
          // Inner loop fragment node (inside first operand of outer)
          { id: 'node-inner', node_kind: 'Fragment', fragment_id: 'frag-inner', order_index: 0, parent_operand_id: 'op-alt-1' },
          // Message node (inside loop's operand)
          { id: 'node-msg', node_kind: 'Message', message_id: 'msg-deep', order_index: 0, parent_operand_id: 'op-loop' },
        ],
      };

      // Serialize and reload
      const serialized = serializeForSave(diagram);
      const reloaded = deserializeFromLoad(serialized);

      // Verify nesting hierarchy
      const outerNode = reloaded.sequence_nodes.find(n => n.id === 'node-outer');
      const innerNode = reloaded.sequence_nodes.find(n => n.id === 'node-inner');
      const msgNode = reloaded.sequence_nodes.find(n => n.id === 'node-msg');

      // Outer node should have no parent
      expect(outerNode?.parent_node_id).toBeUndefined();
      expect(outerNode?.parent_operand_id).toBeUndefined();

      // Inner node should be nested in outer's first operand
      expect(innerNode?.parent_operand_id).toBe('op-alt-1');

      // Message node should be nested in loop's operand
      expect(msgNode?.parent_operand_id).toBe('op-loop');
    });
  });
});
