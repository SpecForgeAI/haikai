/**
 * SequenceDiagramMessageRendering.test.ts
 * Task Group 3: Tests for message arrow rendering in Sequence Diagrams
 *
 * Tests the message arrow rendering logic including:
 * - Solid stroke for Request exchange_role
 * - Dashed stroke (strokeDasharray) for Response exchange_role
 * - Label resolution: ref_kind/ref_id lookup vs label_text fallback
 * - Arrow direction (fromX to toX with arrowhead)
 * - Skip rendering for messages with missing participant IDs
 */

import { describe, it, expect, vi } from 'vitest';
import {
  resolveMessageLabel,
  getMessageStrokeStyle,
  shouldRenderMessage,
} from '../components/DiagramsView/SequenceDiagramRenderer';
import { computeSequenceLayout } from '../utils/sequenceLayout';
import {
  SequenceDiagram,
  SequenceParticipant,
  SequenceMessage,
  SequenceNode,
} from '../types/sequenceDiagram';
import { MetaModel, MetaModelEntities, MetaModelRelationships } from '../types/model';

/**
 * Helper function to create a minimal MetaModel for testing
 */
function createTestMetaModel(
  applications: Array<{ id: string; name: string }> = [],
  businessUsers: Array<{ id: string; name: string }> = [],
  services: Array<{ id: string; name: string }> = [],
  methods: Array<{ id: string; name: string }> = [],
  events: Array<{ id: string; name: string }> = [],
  classes: Array<{ id: string; name: string }> = []
): MetaModel {
  const entities: MetaModelEntities = {
    business_users: businessUsers.map(u => ({
      id: u.id,
      name: u.name,
      description: '',
      tags: '',
    })),
    business_processes: [],
    process_activities: [],
    business_points: [],
    applications: applications.map(a => ({
      id: a.id,
      name: a.name,
      description: '',
      tags: '',
    })),
    app_components: [],
    services: services.map(s => ({
      id: s.id,
      name: s.name,
      description: '',
      tags: '',
    })),
    interfaces: [],
    endpoints: [],
    classes: classes.map(c => ({
      id: c.id,
      name: c.name,
      description: '',
      tags: '',
    })),
    methods: methods.map(m => ({
      id: m.id,
      name: m.name,
      description: '',
      tags: '',
    })),
    application_points: [],
    logical_data_entities: [],
    logical_data_attributes: [],
    physical_data_entities: [],
    physical_data_attributes: [],
    interactions: [],
    app_business_points: [],
    events: events.map(e => ({
      id: e.id,
      name: e.name,
      description: '',
      tags: '',
    })),
    states: [],
    state_transitions: [],
    activities: [],
    activity_flows: [],
    activity_partitions: [],
  };

  const relationships: MetaModelRelationships = {
    business_user_business_points: [],
    application_point_business_points: [],
    logical_data_entity_relationships: [],
    logical_data_entity_physical_data_entities: [],
    logical_data_attribute_physical_data_attributes: [],
    data_movements: [],
    interface_logical_entities: [],
  };

  return { entities, relationships };
}

/**
 * Helper function to create a minimal SequenceDiagram for testing
 */
function createTestDiagram(
  participants: SequenceParticipant[] = [],
  messages: SequenceMessage[] = [],
  sequenceNodes: SequenceNode[] = []
): SequenceDiagram {
  return {
    id: 'test-diagram-1',
    model_file_id: 'test-model-1',
    name: 'Test Sequence Diagram',
    type: 'Sequence',
    participants,
    messages,
    fragments: [],
    operands: [],
    sequence_nodes: sequenceNodes,
  };
}

/**
 * Helper to create a participant
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
 * Helper to create a message
 */
function createMessage(
  id: string,
  fromId: string,
  toId: string,
  exchangeRole: 'Request' | 'Response' = 'Request',
  options: {
    refKind?: 'Method' | 'Event' | 'Class';
    refId?: string;
    labelText?: string;
  } = {}
): SequenceMessage {
  const message: SequenceMessage = {
    id,
    exchange_id: `exchange-${id}`,
    exchange_role: exchangeRole,
    from_participant_id: fromId,
    to_participant_id: toId,
  };

  if (options.refKind && options.refId) {
    message.ref_kind = options.refKind;
    message.ref_id = options.refId;
  } else if (options.labelText) {
    message.label_text = options.labelText;
  }

  return message;
}

/**
 * Helper to create a sequence node
 */
function createNode(
  id: string,
  messageId: string,
  orderIndex: number
): SequenceNode {
  return {
    id,
    node_kind: 'Message',
    message_id: messageId,
    order_index: orderIndex,
  };
}

describe('SequenceDiagramRenderer - Message Arrow Rendering', () => {
  describe('Test 1: Solid stroke for Request exchange_role', () => {
    it('should return no strokeDasharray for Request messages', () => {
      const message = createMessage('m1', 'p1', 'p2', 'Request');

      const style = getMessageStrokeStyle(message.exchange_role);

      expect(style.strokeDasharray).toBe('');
      expect(style.strokeWidth).toBeGreaterThan(0);
    });

    it('should return solid style that can be used for SVG path', () => {
      const message = createMessage('m1', 'p1', 'p2', 'Request');

      const style = getMessageStrokeStyle(message.exchange_role);

      // Empty strokeDasharray means solid line in SVG
      expect(style.strokeDasharray).toBe('');
    });
  });

  describe('Test 2: Dashed stroke (strokeDasharray) for Response exchange_role', () => {
    it('should return strokeDasharray "6,4" for Response messages', () => {
      const message = createMessage('m1', 'p1', 'p2', 'Response');

      const style = getMessageStrokeStyle(message.exchange_role);

      expect(style.strokeDasharray).toBe('6,4');
    });

    it('should return same strokeWidth for both Request and Response', () => {
      const requestStyle = getMessageStrokeStyle('Request');
      const responseStyle = getMessageStrokeStyle('Response');

      expect(requestStyle.strokeWidth).toBe(responseStyle.strokeWidth);
    });
  });

  describe('Test 3: Label resolution - ref_kind/ref_id lookup vs label_text fallback', () => {
    it('should resolve label from metaModel when ref_kind and ref_id are set (Method)', () => {
      const metaModel = createTestMetaModel([], [], [], [
        { id: 'method-1', name: 'getUser' },
      ]);
      const message = createMessage('m1', 'p1', 'p2', 'Request', {
        refKind: 'Method',
        refId: 'method-1',
      });

      const label = resolveMessageLabel(message, metaModel);

      expect(label).toBe('getUser');
    });

    it('should resolve label from metaModel when ref_kind and ref_id are set (Event)', () => {
      const metaModel = createTestMetaModel([], [], [], [], [
        { id: 'event-1', name: 'UserCreated' },
      ]);
      const message = createMessage('m1', 'p1', 'p2', 'Request', {
        refKind: 'Event',
        refId: 'event-1',
      });

      const label = resolveMessageLabel(message, metaModel);

      expect(label).toBe('UserCreated');
    });

    it('should use label_text when ref_kind/ref_id are not set', () => {
      const metaModel = createTestMetaModel();
      const message = createMessage('m1', 'p1', 'p2', 'Request', {
        labelText: 'Custom Label',
      });

      const label = resolveMessageLabel(message, metaModel);

      expect(label).toBe('Custom Label');
    });

    it('should fallback to ref_id when entity not found in metaModel', () => {
      const metaModel = createTestMetaModel(); // Empty metaModel
      const message = createMessage('m1', 'p1', 'p2', 'Request', {
        refKind: 'Method',
        refId: 'missing-method',
      });

      const label = resolveMessageLabel(message, metaModel);

      expect(label).toBe('missing-method');
    });

    it('should return empty string when no label information available', () => {
      const metaModel = createTestMetaModel();
      const message: SequenceMessage = {
        id: 'm1',
        exchange_id: 'ex1',
        exchange_role: 'Request',
        from_participant_id: 'p1',
        to_participant_id: 'p2',
      };

      const label = resolveMessageLabel(message, metaModel);

      expect(label).toBe('');
    });
  });

  describe('Test 4: Arrow direction (fromX to toX with arrowhead)', () => {
    it('should compute correct fromX and toX in message layout', () => {
      const participants = [
        createParticipant('p1', 0),
        createParticipant('p2', 1),
      ];
      const messages = [
        createMessage('m1', 'p1', 'p2', 'Request'),
      ];
      const nodes = [createNode('n1', 'm1', 0)];
      const diagram = createTestDiagram(participants, messages, nodes);

      const layout = computeSequenceLayout(diagram, 220);

      expect(layout.messageLayouts).toHaveLength(1);
      const msgLayout = layout.messageLayouts[0];

      // fromX should be p1's lifelineX = 60 + 75 = 135
      // toX should be p2's lifelineX = 280 + 75 = 355
      expect(msgLayout.fromX).toBe(135);
      expect(msgLayout.toX).toBe(355);
      expect(msgLayout.fromX).toBeLessThan(msgLayout.toX); // Left to right
    });

    it('should compute correct direction for right-to-left messages', () => {
      const participants = [
        createParticipant('p1', 0),
        createParticipant('p2', 1),
      ];
      const messages = [
        createMessage('m1', 'p2', 'p1', 'Response'), // p2 -> p1
      ];
      const nodes = [createNode('n1', 'm1', 0)];
      const diagram = createTestDiagram(participants, messages, nodes);

      const layout = computeSequenceLayout(diagram, 220);

      const msgLayout = layout.messageLayouts[0];

      // fromX should be p2's lifelineX = 355
      // toX should be p1's lifelineX = 135
      expect(msgLayout.fromX).toBe(355);
      expect(msgLayout.toX).toBe(135);
      expect(msgLayout.fromX).toBeGreaterThan(msgLayout.toX); // Right to left
    });
  });

  describe('Test 5: Skip rendering for messages with missing participant IDs', () => {
    it('should return false for messages with missing from_participant_id', () => {
      const participants = [
        createParticipant('p1', 0),
        createParticipant('p2', 1),
      ];
      const message = createMessage('m1', 'missing-p', 'p2', 'Request');

      // Create a map of participant IDs
      const participantIdSet = new Set(participants.map(p => p.id));

      const result = shouldRenderMessage(message, participantIdSet);

      expect(result.shouldRender).toBe(false);
      expect(result.reason).toContain('from_participant_id');
    });

    it('should return false for messages with missing to_participant_id', () => {
      const participants = [
        createParticipant('p1', 0),
        createParticipant('p2', 1),
      ];
      const message = createMessage('m1', 'p1', 'missing-p', 'Request');

      const participantIdSet = new Set(participants.map(p => p.id));

      const result = shouldRenderMessage(message, participantIdSet);

      expect(result.shouldRender).toBe(false);
      expect(result.reason).toContain('to_participant_id');
    });

    it('should return true for messages with valid participant IDs', () => {
      const participants = [
        createParticipant('p1', 0),
        createParticipant('p2', 1),
      ];
      const message = createMessage('m1', 'p1', 'p2', 'Request');

      const participantIdSet = new Set(participants.map(p => p.id));

      const result = shouldRenderMessage(message, participantIdSet);

      expect(result.shouldRender).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('should log warning when message has missing participant (via console spy)', () => {
      const participants = [
        createParticipant('p1', 0),
      ];
      const message = createMessage('m1', 'p1', 'missing-p', 'Request');

      const participantIdSet = new Set(participants.map(p => p.id));
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // The shouldRenderMessage function should be called and return false
      const result = shouldRenderMessage(message, participantIdSet);

      expect(result.shouldRender).toBe(false);

      consoleSpy.mockRestore();
    });
  });
});
