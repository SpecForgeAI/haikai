/**
 * SequenceDiagramSelfMessage.integration.test.tsx
 * Task Group 4: Integration tests for self-message feature
 *
 * These tests verify end-to-end workflows and integration points
 * between the AddMessageExchangeDrawer modal and the SequenceDiagramRenderer.
 *
 * Tests focus on:
 * - Mixed diagrams with regular and self-messages
 * - Re-enabling response checkbox when changing from self-message to regular
 * - Backward compatibility with existing diagrams
 * - Form submission creating correct message structure
 * - Self-message with label renders correctly
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AddMessageExchangeDrawer } from '../components/DiagramsView/SequenceEditor/AddMessageExchangeDrawer';
import { SequenceDiagramRenderer, isSelfMessage } from '../components/DiagramsView/SequenceDiagramRenderer';
import {
  SequenceDiagram,
  SequenceParticipant,
  SequenceMessage,
  SequenceNode,
} from '../types/sequenceDiagram';
import { MetaModel, MetaModelEntities, MetaModelRelationships } from '../types/model';

// ============================================================================
// Test Helpers
// ============================================================================

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
    exchangeId?: string;
  } = {}
): SequenceMessage {
  const message: SequenceMessage = {
    id,
    exchange_id: options.exchangeId || `exchange-${id}`,
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

// ============================================================================
// Integration Tests
// ============================================================================

describe('Self-Message Integration Tests', () => {
  describe('Integration Test 1: Mixed diagram with regular and self-messages renders correctly', () => {
    it('should render both regular messages and self-messages in the same diagram', () => {
      // Create diagram with:
      // - Regular message A -> B
      // - Self-message B -> B
      // - Regular message B -> A
      const participants = [
        createParticipant('p1', 0),
        createParticipant('p2', 1),
      ];
      const messages = [
        createMessage('m1', 'p1', 'p2', 'Request', { labelText: 'request()' }),
        createMessage('m2', 'p2', 'p2', 'Request', { labelText: 'processInternal()' }),
        createMessage('m3', 'p2', 'p1', 'Request', { labelText: 'callback()' }),
      ];
      const nodes = [
        createNode('n1', 'm1', 0),
        createNode('n2', 'm2', 1),
        createNode('n3', 'm3', 2),
      ];
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

      // Should have exactly 3 message groups
      const allMessageGroups = container.querySelectorAll('.sequence-message');
      expect(allMessageGroups).toHaveLength(3);

      // Should have exactly 1 self-message (B -> B)
      const selfMessageGroups = container.querySelectorAll('.sequence-self-message');
      expect(selfMessageGroups).toHaveLength(1);

      // Should have 2 regular messages (A -> B and B -> A)
      const regularMessageGroups = container.querySelectorAll('.sequence-message:not(.sequence-self-message)');
      expect(regularMessageGroups).toHaveLength(2);
    });

    it('should render self-message labels correctly in mixed diagrams', () => {
      const participants = [
        createParticipant('p1', 0),
        createParticipant('p2', 1),
      ];
      const messages = [
        createMessage('m1', 'p1', 'p2', 'Request', { labelText: 'callService()' }),
        createMessage('m2', 'p2', 'p2', 'Request', { labelText: 'validateData()' }),
      ];
      const nodes = [
        createNode('n1', 'm1', 0),
        createNode('n2', 'm2', 1),
      ];
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

      // Self-message label should be present
      const selfMessageGroup = container.querySelector('.sequence-self-message');
      const selfMessageLabel = selfMessageGroup?.querySelector('text');
      expect(selfMessageLabel?.textContent).toBe('validateData()');

      // Regular message label should also be present
      const regularMessageGroup = container.querySelector('.sequence-message:not(.sequence-self-message)');
      const regularMessageLabel = regularMessageGroup?.querySelector('text');
      expect(regularMessageLabel?.textContent).toBe('callService()');
    });
  });

  describe('Integration Test 2: Re-enabling response checkbox when changing from self-message to regular', () => {
    it('should re-enable Include Response checkbox when changing To participant to different value', async () => {
      const participants = [
        createParticipant('p1', 0),
        createParticipant('p2', 1),
      ];
      const metaModel = createTestMetaModel([
        { id: 'ref-p1', name: 'Service A' },
        { id: 'ref-p2', name: 'Service B' },
      ]);
      const onSubmit = vi.fn();
      const onClose = vi.fn();

      render(
        <AddMessageExchangeDrawer
          isOpen={true}
          onClose={onClose}
          participants={participants}
          existingNodes={[]}
          metaModel={metaModel}
          onSubmit={onSubmit}
        />
      );

      // Select same participant for both (self-message)
      const fromSelect = screen.getByTestId('field-fromParticipant');
      const toSelect = screen.getByTestId('field-toParticipant');
      const includeResponseCheckbox = screen.getByTestId('field-includeResponse');

      fireEvent.change(fromSelect, { target: { value: 'p1' } });
      fireEvent.change(toSelect, { target: { value: 'p1' } });

      // Checkbox should be disabled for self-message
      await waitFor(() => {
        expect(includeResponseCheckbox).toBeDisabled();
      });

      // Warning should be shown
      expect(screen.getByTestId('self-message-warning')).toBeInTheDocument();

      // Now change To to a different participant
      fireEvent.change(toSelect, { target: { value: 'p2' } });

      // Checkbox should be re-enabled
      await waitFor(() => {
        expect(includeResponseCheckbox).not.toBeDisabled();
      });

      // Warning should be hidden
      expect(screen.queryByTestId('self-message-warning')).not.toBeInTheDocument();
    });
  });

  describe('Integration Test 3: Backward compatibility - existing diagrams without self-messages', () => {
    it('should render existing diagrams without self-messages unchanged', () => {
      // Typical existing diagram with only regular messages
      const participants = [
        createParticipant('p1', 0),
        createParticipant('p2', 1),
        createParticipant('p3', 2),
      ];
      const messages = [
        createMessage('m1', 'p1', 'p2', 'Request', { labelText: 'request1()', exchangeId: 'ex1' }),
        createMessage('m2', 'p2', 'p1', 'Response', { labelText: 'response1', exchangeId: 'ex1' }),
        createMessage('m3', 'p2', 'p3', 'Request', { labelText: 'forward()', exchangeId: 'ex2' }),
        createMessage('m4', 'p3', 'p2', 'Response', { labelText: 'result', exchangeId: 'ex2' }),
      ];
      const nodes = [
        createNode('n1', 'm1', 0),
        createNode('n2', 'm2', 1),
        createNode('n3', 'm3', 2),
        createNode('n4', 'm4', 3),
      ];
      const diagram = createTestDiagram(participants, messages, nodes);
      const metaModel = createTestMetaModel([
        { id: 'ref-p1', name: 'Client' },
        { id: 'ref-p2', name: 'Server' },
        { id: 'ref-p3', name: 'Database' },
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

      // All messages should render as regular messages (no self-messages)
      const selfMessageGroups = container.querySelectorAll('.sequence-self-message');
      expect(selfMessageGroups).toHaveLength(0);

      // All 4 messages should render as regular messages
      const regularMessageGroups = container.querySelectorAll('.sequence-message');
      expect(regularMessageGroups).toHaveLength(4);

      // Each regular message should use <line> element (not <path> for loopback)
      regularMessageGroups.forEach((group) => {
        const lineElement = group.querySelector('line');
        expect(lineElement).not.toBeNull();
      });
    });

    it('should not break isSelfMessage for existing messages with different from/to', () => {
      // Verify isSelfMessage returns false for all regular messages
      const regularMessages: SequenceMessage[] = [
        { id: 'm1', exchange_id: 'ex1', exchange_role: 'Request', from_participant_id: 'p1', to_participant_id: 'p2' },
        { id: 'm2', exchange_id: 'ex1', exchange_role: 'Response', from_participant_id: 'p2', to_participant_id: 'p1' },
        { id: 'm3', exchange_id: 'ex2', exchange_role: 'Request', from_participant_id: 'a', to_participant_id: 'b' },
      ];

      regularMessages.forEach((msg) => {
        expect(isSelfMessage(msg)).toBe(false);
      });
    });
  });

  describe('Integration Test 4: Form submission creates message with matching from/to participant IDs', () => {
    it('should create a self-message with matching from_participant_id and to_participant_id on submit', async () => {
      const participants = [
        createParticipant('p1', 0),
        createParticipant('p2', 1),
      ];
      const metaModel = createTestMetaModel([
        { id: 'ref-p1', name: 'Service A' },
        { id: 'ref-p2', name: 'Service B' },
      ]);
      const onSubmit = vi.fn();
      const onClose = vi.fn();

      render(
        <AddMessageExchangeDrawer
          isOpen={true}
          onClose={onClose}
          participants={participants}
          existingNodes={[]}
          metaModel={metaModel}
          onSubmit={onSubmit}
        />
      );

      // Select same participant for both (self-message)
      const fromSelect = screen.getByTestId('field-fromParticipant');
      const toSelect = screen.getByTestId('field-toParticipant');
      const labelInput = screen.getByTestId('field-requestLabelText');
      const submitButton = screen.getByTestId('drawer-submit-button');

      fireEvent.change(fromSelect, { target: { value: 'p1' } });
      fireEvent.change(toSelect, { target: { value: 'p1' } });
      fireEvent.change(labelInput, { target: { value: 'selfCall()' } });

      // Submit the form
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledTimes(1);
      });

      // Verify the created message has matching from/to
      const [messages, nodes] = onSubmit.mock.calls[0];

      expect(messages).toHaveLength(1); // Only request, no response for self-message
      expect(messages[0].from_participant_id).toBe('p1');
      expect(messages[0].to_participant_id).toBe('p1');
      expect(messages[0].from_participant_id).toBe(messages[0].to_participant_id);
      expect(messages[0].label_text).toBe('selfCall()');
      expect(messages[0].exchange_role).toBe('Request');

      // Verify only one node is created (no response node)
      expect(nodes).toHaveLength(1);
    });

    it('should not create response message for self-message even if response was previously checked', async () => {
      const participants = [
        createParticipant('p1', 0),
        createParticipant('p2', 1),
      ];
      const metaModel = createTestMetaModel([
        { id: 'ref-p1', name: 'Service A' },
        { id: 'ref-p2', name: 'Service B' },
      ]);
      const onSubmit = vi.fn();
      const onClose = vi.fn();

      render(
        <AddMessageExchangeDrawer
          isOpen={true}
          onClose={onClose}
          participants={participants}
          existingNodes={[]}
          metaModel={metaModel}
          onSubmit={onSubmit}
        />
      );

      // First select different participants and enable response
      const fromSelect = screen.getByTestId('field-fromParticipant');
      const toSelect = screen.getByTestId('field-toParticipant');
      const includeResponseCheckbox = screen.getByTestId('field-includeResponse');
      const labelInput = screen.getByTestId('field-requestLabelText');

      fireEvent.change(fromSelect, { target: { value: 'p1' } });
      fireEvent.change(toSelect, { target: { value: 'p2' } });
      fireEvent.click(includeResponseCheckbox); // Enable response

      // Now change to self-message
      fireEvent.change(toSelect, { target: { value: 'p1' } });

      // Response should be auto-unchecked
      await waitFor(() => {
        expect(includeResponseCheckbox).not.toBeChecked();
      });

      // Fill in required fields and submit
      fireEvent.change(labelInput, { target: { value: 'internalProcess()' } });
      fireEvent.click(screen.getByTestId('drawer-submit-button'));

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalled();
      });

      const [messages] = onSubmit.mock.calls[0];

      // Should only have 1 message (request), not 2 (no response)
      expect(messages).toHaveLength(1);
      expect(messages[0].exchange_role).toBe('Request');
    });
  });

  describe('Integration Test 5: Self-message with label renders label in correct position', () => {
    it('should render self-message label above the loopback arrow', () => {
      const participants = [createParticipant('p1', 0)];
      const messages = [createMessage('m1', 'p1', 'p1', 'Request', { labelText: 'recursiveCall()' })];
      const nodes = [createNode('n1', 'm1', 0)];
      const diagram = createTestDiagram(participants, messages, nodes);
      const metaModel = createTestMetaModel([{ id: 'ref-p1', name: 'Recursive Service' }]);

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

      // Verify label text is rendered
      const textElement = selfMessageGroup?.querySelector('text');
      expect(textElement).not.toBeNull();
      expect(textElement?.textContent).toBe('recursiveCall()');

      // Verify label is positioned correctly (has text-anchor="middle")
      expect(textElement?.getAttribute('text-anchor')).toBe('middle');
    });
  });

  describe('Integration Test 6: Full end-to-end workflow', () => {
    it('should allow creating a self-message via drawer and verify it would render correctly', async () => {
      const participants = [
        createParticipant('p1', 0),
      ];
      const metaModel = createTestMetaModel([
        { id: 'ref-p1', name: 'Worker Service' },
      ]);
      const onSubmit = vi.fn();
      const onClose = vi.fn();

      // Step 1: Render the drawer
      render(
        <AddMessageExchangeDrawer
          isOpen={true}
          onClose={onClose}
          participants={participants}
          existingNodes={[]}
          metaModel={metaModel}
          onSubmit={onSubmit}
        />
      );

      // Step 2: Select same participant for From and To
      fireEvent.change(screen.getByTestId('field-fromParticipant'), { target: { value: 'p1' } });
      fireEvent.change(screen.getByTestId('field-toParticipant'), { target: { value: 'p1' } });

      // Step 3: Verify warning is shown and response is disabled
      await waitFor(() => {
        expect(screen.getByTestId('self-message-warning')).toBeInTheDocument();
        expect(screen.getByTestId('field-includeResponse')).toBeDisabled();
      });

      // Step 4: Enter label text
      fireEvent.change(screen.getByTestId('field-requestLabelText'), {
        target: { value: 'processInternally()' },
      });

      // Step 5: Submit
      fireEvent.click(screen.getByTestId('drawer-submit-button'));

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalled();
      });

      // Step 6: Verify the created message is a valid self-message
      const [messages, nodes] = onSubmit.mock.calls[0];
      expect(messages).toHaveLength(1);

      const createdMessage = messages[0];
      expect(createdMessage.from_participant_id).toBe('p1');
      expect(createdMessage.to_participant_id).toBe('p1');
      expect(isSelfMessage(createdMessage)).toBe(true);
      expect(createdMessage.label_text).toBe('processInternally()');

      // Step 7: Verify this message would render as a self-message in the renderer
      const diagram = createTestDiagram(participants, messages, nodes);

      const { container } = render(
        <svg>
          <SequenceDiagramRenderer
            sequenceDiagram={diagram}
            participantSpacing={220}
            metaModel={metaModel}
          />
        </svg>
      );

      // Step 8: Verify self-message is rendered with loopback arrow
      const selfMessageGroup = container.querySelector('.sequence-self-message');
      expect(selfMessageGroup).not.toBeNull();

      // Verify label is rendered
      const labelText = selfMessageGroup?.querySelector('text');
      expect(labelText?.textContent).toBe('processInternally()');

      // Verify loopback path exists
      const loopbackPath = selfMessageGroup?.querySelector('path');
      expect(loopbackPath).not.toBeNull();
    });
  });
});
