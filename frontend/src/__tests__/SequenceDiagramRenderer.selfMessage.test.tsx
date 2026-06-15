/**
 * SequenceDiagramRenderer.selfMessage.test.tsx
 * Task Group 3: Tests for self-message loopback arrow rendering
 *
 * Tests the self-message rendering logic including:
 * - isSelfMessage() helper function
 * - SelfMessageArrow component rendering
 * - Loopback arrow path shape (right, down, left pattern)
 * - Label positioning above the initial horizontal segment
 */

import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';
import {
  isSelfMessage,
  SELF_MESSAGE_LOOP_WIDTH,
} from '../components/DiagramsView/SequenceDiagramRenderer';
import { SELF_MESSAGE_LOOP_HEIGHT } from '../utils/sequenceLayout';
import { SequenceDiagramRenderer } from '../components/DiagramsView/SequenceDiagramRenderer';
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
  applications: Array<{ id: string; name: string }> = []
): MetaModel {
  const entities: MetaModelEntities = {
    business_users: [],
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
    services: [],
    interfaces: [],
    endpoints: [],
    classes: [],
    methods: [],
    application_points: [],
    logical_data_entities: [],
    logical_data_attributes: [],
    physical_data_entities: [],
    physical_data_attributes: [],
    interactions: [],
    app_business_points: [],
    events: [],
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

  if (options.labelText) {
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

describe('SequenceDiagramRenderer - Self-Message Rendering', () => {
  describe('Test 1: isSelfMessage() returns true when from_participant_id === to_participant_id', () => {
    it('should return true when from and to participant IDs are the same', () => {
      const message: SequenceMessage = {
        id: 'm1',
        exchange_id: 'ex1',
        exchange_role: 'Request',
        from_participant_id: 'p1',
        to_participant_id: 'p1',
      };

      expect(isSelfMessage(message)).toBe(true);
    });

    it('should return true for any matching participant ID', () => {
      const message: SequenceMessage = {
        id: 'm2',
        exchange_id: 'ex2',
        exchange_role: 'Request',
        from_participant_id: 'participant-abc-123',
        to_participant_id: 'participant-abc-123',
      };

      expect(isSelfMessage(message)).toBe(true);
    });
  });

  describe('Test 2: isSelfMessage() returns false when from_participant_id !== to_participant_id', () => {
    it('should return false when from and to participant IDs differ', () => {
      const message: SequenceMessage = {
        id: 'm1',
        exchange_id: 'ex1',
        exchange_role: 'Request',
        from_participant_id: 'p1',
        to_participant_id: 'p2',
      };

      expect(isSelfMessage(message)).toBe(false);
    });

    it('should return false for distinct participant IDs', () => {
      const message: SequenceMessage = {
        id: 'm2',
        exchange_id: 'ex2',
        exchange_role: 'Response',
        from_participant_id: 'sender',
        to_participant_id: 'receiver',
      };

      expect(isSelfMessage(message)).toBe(false);
    });
  });

  describe('Test 3: Self-message renders SelfMessageArrow component (check for .sequence-self-message class)', () => {
    it('should render with sequence-self-message class for self-messages', () => {
      const participants = [createParticipant('p1', 0)];
      const messages = [createMessage('m1', 'p1', 'p1', 'Request', { labelText: 'selfCall()' })];
      const nodes = [createNode('n1', 'm1', 0)];
      const diagram = createTestDiagram(participants, messages, nodes);
      const metaModel = createTestMetaModel([{ id: 'ref-p1', name: 'Service A' }]);

      const { container } = render(
        <svg>
          <SequenceDiagramRenderer
            sequenceDiagram={diagram}
            participantSpacing={220}
            metaModel={metaModel}
          />
        </svg>
      );

      const selfMessageGroup = container.querySelector('.sequence-self-message');
      expect(selfMessageGroup).not.toBeNull();
    });

    it('should have data-message-id attribute on self-message group', () => {
      const participants = [createParticipant('p1', 0)];
      const messages = [createMessage('m1', 'p1', 'p1', 'Request')];
      const nodes = [createNode('n1', 'm1', 0)];
      const diagram = createTestDiagram(participants, messages, nodes);
      const metaModel = createTestMetaModel([{ id: 'ref-p1', name: 'Service A' }]);

      const { container } = render(
        <svg>
          <SequenceDiagramRenderer
            sequenceDiagram={diagram}
            participantSpacing={220}
            metaModel={metaModel}
          />
        </svg>
      );

      const selfMessageGroup = container.querySelector('.sequence-self-message');
      expect(selfMessageGroup?.getAttribute('data-message-id')).toBe('m1');
    });
  });

  describe('Test 4: Regular message renders MessageArrow component (no .sequence-self-message class)', () => {
    it('should not have sequence-self-message class for regular messages', () => {
      const participants = [
        createParticipant('p1', 0),
        createParticipant('p2', 1),
      ];
      const messages = [createMessage('m1', 'p1', 'p2', 'Request')];
      const nodes = [createNode('n1', 'm1', 0)];
      const diagram = createTestDiagram(participants, messages, nodes);
      const metaModel = createTestMetaModel([
        { id: 'ref-p1', name: 'Service A' },
        { id: 'ref-p2', name: 'Service B' },
      ]);

      const { container } = render(
        <svg>
          <SequenceDiagramRenderer
            sequenceDiagram={diagram}
            participantSpacing={220}
            metaModel={metaModel}
          />
        </svg>
      );

      const selfMessageGroup = container.querySelector('.sequence-self-message');
      expect(selfMessageGroup).toBeNull();

      // But should have regular sequence-message class
      const messageGroup = container.querySelector('.sequence-message');
      expect(messageGroup).not.toBeNull();
    });

    it('should render regular message with line element (not path)', () => {
      const participants = [
        createParticipant('p1', 0),
        createParticipant('p2', 1),
      ];
      const messages = [createMessage('m1', 'p1', 'p2', 'Request')];
      const nodes = [createNode('n1', 'm1', 0)];
      const diagram = createTestDiagram(participants, messages, nodes);
      const metaModel = createTestMetaModel([
        { id: 'ref-p1', name: 'Service A' },
        { id: 'ref-p2', name: 'Service B' },
      ]);

      const { container } = render(
        <svg>
          <SequenceDiagramRenderer
            sequenceDiagram={diagram}
            participantSpacing={220}
            metaModel={metaModel}
          />
        </svg>
      );

      const messageGroup = container.querySelector('.sequence-message:not(.sequence-self-message)');
      expect(messageGroup).not.toBeNull();

      // Regular message uses <line> element
      const lineElement = messageGroup?.querySelector('line');
      expect(lineElement).not.toBeNull();
    });
  });

  describe('Test 5: Loopback arrow path has correct shape (right, down, left pattern)', () => {
    it('should render a path element for self-message loopback', () => {
      const participants = [createParticipant('p1', 0)];
      const messages = [createMessage('m1', 'p1', 'p1', 'Request')];
      const nodes = [createNode('n1', 'm1', 0)];
      const diagram = createTestDiagram(participants, messages, nodes);
      const metaModel = createTestMetaModel([{ id: 'ref-p1', name: 'Service A' }]);

      const { container } = render(
        <svg>
          <SequenceDiagramRenderer
            sequenceDiagram={diagram}
            participantSpacing={220}
            metaModel={metaModel}
          />
        </svg>
      );

      const selfMessageGroup = container.querySelector('.sequence-self-message');
      const pathElement = selfMessageGroup?.querySelector('path');
      expect(pathElement).not.toBeNull();
    });

    it('should have path with correct loopback pattern (M, L, L, L commands)', () => {
      const participants = [createParticipant('p1', 0)];
      const messages = [createMessage('m1', 'p1', 'p1', 'Request')];
      const nodes = [createNode('n1', 'm1', 0)];
      const diagram = createTestDiagram(participants, messages, nodes);
      const metaModel = createTestMetaModel([{ id: 'ref-p1', name: 'Service A' }]);

      const { container } = render(
        <svg>
          <SequenceDiagramRenderer
            sequenceDiagram={diagram}
            participantSpacing={220}
            metaModel={metaModel}
          />
        </svg>
      );

      const selfMessageGroup = container.querySelector('.sequence-self-message');
      // First path is the loopback, second is arrowhead
      const paths = selfMessageGroup?.querySelectorAll('path');
      expect(paths?.length).toBeGreaterThanOrEqual(2);

      const loopbackPath = paths?.[0];
      const pathD = loopbackPath?.getAttribute('d') || '';

      // Path should contain M (move), then three L (line) commands
      // Pattern: M startX startY L rightX startY L rightX bottomY L startX bottomY
      expect(pathD).toContain('M');
      expect(pathD).toContain('L');

      // Verify path has no fill (stroke only)
      expect(loopbackPath?.getAttribute('fill')).toBe('none');
    });

    it('should export correct SELF_MESSAGE_LOOP_WIDTH and SELF_MESSAGE_LOOP_HEIGHT constants', () => {
      expect(SELF_MESSAGE_LOOP_WIDTH).toBe(40);
      expect(SELF_MESSAGE_LOOP_HEIGHT).toBe(30);
    });
  });

  describe('Test 6: Label is positioned above the initial horizontal segment', () => {
    it('should render text element for label on self-message', () => {
      const participants = [createParticipant('p1', 0)];
      const messages = [createMessage('m1', 'p1', 'p1', 'Request', { labelText: 'processInternal()' })];
      const nodes = [createNode('n1', 'm1', 0)];
      const diagram = createTestDiagram(participants, messages, nodes);
      const metaModel = createTestMetaModel([{ id: 'ref-p1', name: 'Service A' }]);

      const { container } = render(
        <svg>
          <SequenceDiagramRenderer
            sequenceDiagram={diagram}
            participantSpacing={220}
            metaModel={metaModel}
          />
        </svg>
      );

      const selfMessageGroup = container.querySelector('.sequence-self-message');
      const textElement = selfMessageGroup?.querySelector('text');
      expect(textElement).not.toBeNull();
      expect(textElement?.textContent).toBe('processInternal()');
    });

    it('should position label Y above the message Y (negative offset)', () => {
      const participants = [createParticipant('p1', 0)];
      const messages = [createMessage('m1', 'p1', 'p1', 'Request', { labelText: 'myMethod()' })];
      const nodes = [createNode('n1', 'm1', 0)];
      const diagram = createTestDiagram(participants, messages, nodes);
      const metaModel = createTestMetaModel([{ id: 'ref-p1', name: 'Service A' }]);

      // Get the layout to know the message Y position
      const layout = computeSequenceLayout(diagram, 220);
      const messageLayout = layout.messageLayouts[0];
      const messageY = messageLayout.y;

      const { container } = render(
        <svg>
          <SequenceDiagramRenderer
            sequenceDiagram={diagram}
            participantSpacing={220}
            metaModel={metaModel}
          />
        </svg>
      );

      const selfMessageGroup = container.querySelector('.sequence-self-message');
      const textElement = selfMessageGroup?.querySelector('text');
      const labelY = parseFloat(textElement?.getAttribute('y') || '0');

      // Label should be above the message arrow (smaller Y value)
      expect(labelY).toBeLessThan(messageY);
    });

    it('should center label X within the loopback width', () => {
      const participants = [createParticipant('p1', 0)];
      const messages = [createMessage('m1', 'p1', 'p1', 'Request', { labelText: 'test()' })];
      const nodes = [createNode('n1', 'm1', 0)];
      const diagram = createTestDiagram(participants, messages, nodes);
      const metaModel = createTestMetaModel([{ id: 'ref-p1', name: 'Service A' }]);

      // Get the layout to know the lifeline X position
      const layout = computeSequenceLayout(diagram, 220);
      const messageLayout = layout.messageLayouts[0];
      const lifelineX = messageLayout.fromX;

      const { container } = render(
        <svg>
          <SequenceDiagramRenderer
            sequenceDiagram={diagram}
            participantSpacing={220}
            metaModel={metaModel}
          />
        </svg>
      );

      const selfMessageGroup = container.querySelector('.sequence-self-message');
      const textElement = selfMessageGroup?.querySelector('text');
      const labelX = parseFloat(textElement?.getAttribute('x') || '0');

      // Label X should be at lifelineX + SELF_MESSAGE_LOOP_WIDTH / 2
      const expectedLabelX = lifelineX + SELF_MESSAGE_LOOP_WIDTH / 2;
      expect(labelX).toBe(expectedLabelX);
    });

    it('should not render text element when label is empty', () => {
      const participants = [createParticipant('p1', 0)];
      // No labelText provided
      const messages = [createMessage('m1', 'p1', 'p1', 'Request')];
      const nodes = [createNode('n1', 'm1', 0)];
      const diagram = createTestDiagram(participants, messages, nodes);
      const metaModel = createTestMetaModel([{ id: 'ref-p1', name: 'Service A' }]);

      const { container } = render(
        <svg>
          <SequenceDiagramRenderer
            sequenceDiagram={diagram}
            participantSpacing={220}
            metaModel={metaModel}
          />
        </svg>
      );

      const selfMessageGroup = container.querySelector('.sequence-self-message');
      const textElement = selfMessageGroup?.querySelector('text');
      // When no label, text element should not be rendered
      expect(textElement).toBeNull();
    });
  });
});
