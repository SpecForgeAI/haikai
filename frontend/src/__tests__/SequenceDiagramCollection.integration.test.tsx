/**
 * SequenceDiagramCollection.integration.test.tsx
 *
 * Spec: 2026-01-26 - Sequence Diagram Message Exchange Collection Entity Display
 * Task Group 5: Integration Tests
 *
 * These tests verify the end-to-end behavior of collection entity display:
 * - Integration between modal submission and diagram rendering
 * - Backward compatibility with existing messages
 * - Full flow scenarios from message creation to rendering
 */

import { describe, it, expect } from 'vitest';
import {
  resolveMessageLabel,
  formatEntityLabel,
  supportsCollectionWrapper,
} from '../components/DiagramsView/SequenceDiagramRenderer';
import type { SequenceMessage, SequenceDiagram } from '../types/sequenceDiagram';
import type { MetaModel, MetaModelEntities, MetaModelRelationships } from '../types/model';

/**
 * Helper function to create a minimal MetaModel for integration testing.
 */
function createIntegrationTestMetaModel(): MetaModel {
  const entities: MetaModelEntities = {
    business_users: [],
    business_processes: [],
    process_activities: [],
    business_points: [],
    applications: [
      { id: 'app-1', name: 'OrderService', description: '', tags: '' },
      { id: 'app-2', name: 'CustomerService', description: '', tags: '' },
    ],
    app_components: [],
    services: [],
    interfaces: [],
    endpoints: [],
    classes: [],
    methods: [
      { id: 'method-1', name: 'processOrder', description: '', parameters: '', return_type: '', class_id: '', tags: '' },
    ],
    application_points: [],
    logical_data_entities: [
      { id: 'le-customer', name: 'Customer', description: '', tags: '' },
      { id: 'le-product', name: 'Product', description: '', tags: '' },
    ],
    logical_data_attributes: [],
    physical_data_entities: [
      { id: 'pe-order', name: 'Order', description: '', tags: '' },
      { id: 'pe-invoice', name: 'Invoice', description: '', tags: '' },
    ],
    physical_data_attributes: [],
    interactions: [],
    app_business_points: [],
    events: [
      { id: 'event-1', name: 'OrderCreated', description: '' },
    ],
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
 * Helper to create a SequenceMessage for testing.
 */
function createMessage(overrides: Partial<SequenceMessage>): SequenceMessage {
  return {
    id: 'msg-test',
    exchange_id: 'exchange-test',
    exchange_role: 'Request',
    from_participant_id: 'p1',
    to_participant_id: 'p2',
    ...overrides,
  };
}

describe('Task Group 5: Sequence Diagram Collection Entity Display - Integration Tests', () => {
  const metaModel = createIntegrationTestMetaModel();

  describe('Test 5.3a: renders Collection<Order> label for PhysicalEntity with is_collection=true', () => {
    it('should render Collection<Order> when PhysicalEntity Order has is_collection=true', () => {
      // Simulate a message created via the modal with is_collection=true
      const message = createMessage({
        id: 'msg-001',
        exchange_role: 'Request',
        ref_kind: 'PhysicalEntity',
        ref_id: 'pe-order',
        is_collection: true,
      });

      // Verify the label resolves correctly
      const label = resolveMessageLabel(message, metaModel);
      expect(label).toBe('Collection<Order>');
    });
  });

  describe('Test 5.3b: renders Collection<Customer> label for LogicalEntity with is_collection=true', () => {
    it('should render Collection<Customer> when LogicalEntity Customer has is_collection=true', () => {
      const message = createMessage({
        id: 'msg-002',
        exchange_role: 'Request',
        ref_kind: 'LogicalEntity',
        ref_id: 'le-customer',
        is_collection: true,
      });

      const label = resolveMessageLabel(message, metaModel);
      expect(label).toBe('Collection<Customer>');
    });
  });

  describe('Test 5.3c: renders Order label for PhysicalEntity with is_collection=false', () => {
    it('should render Order without Collection<> wrapper when is_collection=false', () => {
      const message = createMessage({
        id: 'msg-003',
        exchange_role: 'Request',
        ref_kind: 'PhysicalEntity',
        ref_id: 'pe-order',
        is_collection: false,
      });

      const label = resolveMessageLabel(message, metaModel);
      expect(label).toBe('Order');
    });
  });

  describe('Test 5.3d: handles mixed messages (one collection, one not) in same exchange', () => {
    it('should correctly render mixed collection and non-collection messages in the same exchange', () => {
      // This tests that messages in the same exchange can have different is_collection values
      const requestMessage = createMessage({
        id: 'msg-request',
        exchange_id: 'exchange-mixed',
        exchange_role: 'Request',
        ref_kind: 'LogicalEntity',
        ref_id: 'le-product',
        is_collection: false, // Single product request
      });

      const responseMessage = createMessage({
        id: 'msg-response',
        exchange_id: 'exchange-mixed',
        exchange_role: 'Response',
        from_participant_id: 'p2',
        to_participant_id: 'p1',
        ref_kind: 'PhysicalEntity',
        ref_id: 'pe-order',
        is_collection: true, // Returns collection of orders
      });

      // Verify request renders without Collection<>
      const requestLabel = resolveMessageLabel(requestMessage, metaModel);
      expect(requestLabel).toBe('Product');

      // Verify response renders with Collection<>
      const responseLabel = resolveMessageLabel(responseMessage, metaModel);
      expect(responseLabel).toBe('Collection<Order>');
    });
  });

  describe('Test 5.3e: backward compatibility - existing messages without is_collection render normally', () => {
    it('should render existing messages without is_collection field as non-collection (backward compatibility)', () => {
      // Simulate an existing message from before the feature was added
      // The message object has no is_collection property at all
      const legacyMessage: SequenceMessage = {
        id: 'msg-legacy',
        exchange_id: 'exchange-legacy',
        exchange_role: 'Request',
        from_participant_id: 'p1',
        to_participant_id: 'p2',
        ref_kind: 'PhysicalEntity',
        ref_id: 'pe-invoice',
        // Note: is_collection is intentionally NOT included
      };

      const label = resolveMessageLabel(legacyMessage, metaModel);
      expect(label).toBe('Invoice');
      expect(label).not.toContain('Collection<');
    });

    it('should handle legacy messages with label_text mode (no reference)', () => {
      const legacyLabelMessage: SequenceMessage = {
        id: 'msg-legacy-label',
        exchange_id: 'exchange-legacy-2',
        exchange_role: 'Request',
        from_participant_id: 'p1',
        to_participant_id: 'p2',
        label_text: 'processPayment()',
      };

      const label = resolveMessageLabel(legacyLabelMessage, metaModel);
      expect(label).toBe('processPayment()');
    });
  });

  describe('Test 5.3f: full flow - create message with collection flag, verify it renders correctly', () => {
    it('should correctly flow from message creation format to rendering', () => {
      // Simulate the exact structure created by AddMessageExchangeDrawer.handleSubmit
      // when the "Is Collection?" checkbox is checked
      const messageFromModal: SequenceMessage = {
        id: 'msg-modal-created',
        exchange_id: 'exchange-modal',
        exchange_role: 'Request',
        from_participant_id: 'p1',
        to_participant_id: 'p2',
        ref_kind: 'LogicalEntity',
        ref_id: 'le-customer',
        is_collection: true, // Set by modal when checkbox is checked
      };

      // Verify the rendering flow works correctly
      const label = resolveMessageLabel(messageFromModal, metaModel);
      expect(label).toBe('Collection<Customer>');

      // Also verify the helper functions work correctly in the chain
      expect(supportsCollectionWrapper(messageFromModal.ref_kind)).toBe(true);
      expect(formatEntityLabel('Customer', true, 'LogicalEntity')).toBe('Collection<Customer>');
    });

    it('should NOT include Collection<> when checkbox is unchecked (is_collection omitted)', () => {
      // When checkbox is unchecked, is_collection is NOT included in the message
      // (not set to false, but omitted entirely as per the modal implementation)
      const messageWithoutCollection: SequenceMessage = {
        id: 'msg-modal-no-collection',
        exchange_id: 'exchange-modal-2',
        exchange_role: 'Request',
        from_participant_id: 'p1',
        to_participant_id: 'p2',
        ref_kind: 'PhysicalEntity',
        ref_id: 'pe-order',
        // is_collection is intentionally omitted (checkbox unchecked)
      };

      const label = resolveMessageLabel(messageWithoutCollection, metaModel);
      expect(label).toBe('Order');
    });
  });

  describe('Test 5.3g: response message with collection flag independent of request', () => {
    it('should handle response message collection flag independently of request', () => {
      // Create an exchange where:
      // - Request: references a single entity (no collection)
      // - Response: returns a collection of entities

      const requestMsg = createMessage({
        id: 'msg-req-single',
        exchange_id: 'exchange-independent',
        exchange_role: 'Request',
        ref_kind: 'LogicalEntity',
        ref_id: 'le-customer',
        // is_collection omitted or false - requesting single customer
      });

      const responseMsg = createMessage({
        id: 'msg-resp-collection',
        exchange_id: 'exchange-independent',
        exchange_role: 'Response',
        from_participant_id: 'p2',
        to_participant_id: 'p1',
        ref_kind: 'PhysicalEntity',
        ref_id: 'pe-order',
        is_collection: true, // Returns collection of orders for that customer
      });

      expect(resolveMessageLabel(requestMsg, metaModel)).toBe('Customer');
      expect(resolveMessageLabel(responseMsg, metaModel)).toBe('Collection<Order>');
    });

    it('should handle both request and response as collections', () => {
      const requestMsg = createMessage({
        id: 'msg-req-coll',
        exchange_id: 'exchange-both-coll',
        exchange_role: 'Request',
        ref_kind: 'LogicalEntity',
        ref_id: 'le-product',
        is_collection: true, // Request a collection of products
      });

      const responseMsg = createMessage({
        id: 'msg-resp-coll',
        exchange_id: 'exchange-both-coll',
        exchange_role: 'Response',
        from_participant_id: 'p2',
        to_participant_id: 'p1',
        ref_kind: 'PhysicalEntity',
        ref_id: 'pe-invoice',
        is_collection: true, // Returns collection of invoices
      });

      expect(resolveMessageLabel(requestMsg, metaModel)).toBe('Collection<Product>');
      expect(resolveMessageLabel(responseMsg, metaModel)).toBe('Collection<Invoice>');
    });
  });

  describe('Test 5.3h: round-trip persistence - save and reload diagram preserves is_collection', () => {
    it('should preserve is_collection when serialized to JSON and deserialized', () => {
      // Create a message with is_collection=true
      const originalMessage: SequenceMessage = {
        id: 'msg-persist',
        exchange_id: 'exchange-persist',
        exchange_role: 'Request',
        from_participant_id: 'p1',
        to_participant_id: 'p2',
        ref_kind: 'PhysicalEntity',
        ref_id: 'pe-order',
        is_collection: true,
      };

      // Simulate save: serialize to JSON
      const jsonString = JSON.stringify(originalMessage);

      // Simulate load: deserialize from JSON
      const loadedMessage: SequenceMessage = JSON.parse(jsonString);

      // Verify is_collection is preserved
      expect(loadedMessage.is_collection).toBe(true);

      // Verify rendering still works after round-trip
      const label = resolveMessageLabel(loadedMessage, metaModel);
      expect(label).toBe('Collection<Order>');
    });

    it('should preserve absence of is_collection (undefined) after round-trip', () => {
      // Create a message without is_collection
      const originalMessage: SequenceMessage = {
        id: 'msg-persist-none',
        exchange_id: 'exchange-persist-2',
        exchange_role: 'Request',
        from_participant_id: 'p1',
        to_participant_id: 'p2',
        ref_kind: 'LogicalEntity',
        ref_id: 'le-customer',
      };

      // Simulate save: serialize to JSON
      const jsonString = JSON.stringify(originalMessage);

      // Simulate load: deserialize from JSON
      const loadedMessage: SequenceMessage = JSON.parse(jsonString);

      // Verify is_collection is still undefined (not present in JSON)
      expect(loadedMessage.is_collection).toBeUndefined();

      // Verify rendering treats undefined as false
      const label = resolveMessageLabel(loadedMessage, metaModel);
      expect(label).toBe('Customer');
    });

    it('should preserve is_collection=false after round-trip', () => {
      // Some consumers might explicitly set is_collection to false
      const originalMessage: SequenceMessage = {
        id: 'msg-persist-false',
        exchange_id: 'exchange-persist-3',
        exchange_role: 'Request',
        from_participant_id: 'p1',
        to_participant_id: 'p2',
        ref_kind: 'PhysicalEntity',
        ref_id: 'pe-invoice',
        is_collection: false,
      };

      // Simulate save and load
      const jsonString = JSON.stringify(originalMessage);
      const loadedMessage: SequenceMessage = JSON.parse(jsonString);

      // Verify is_collection=false is preserved
      expect(loadedMessage.is_collection).toBe(false);

      // Verify rendering treats false as non-collection
      const label = resolveMessageLabel(loadedMessage, metaModel);
      expect(label).toBe('Invoice');
    });

    it('should work with full SequenceDiagram structure containing multiple messages', () => {
      // Create a complete sequence diagram with mixed collection messages
      const diagram: SequenceDiagram = {
        id: 'diagram-persist',
        model_file_id: 'model-file-1',
        name: 'Test Diagram',
        type: 'Sequence',
        participants: [
          { id: 'p1', ref_kind: 'Application', ref_id: 'app-1', order_index: 0 },
          { id: 'p2', ref_kind: 'Application', ref_id: 'app-2', order_index: 1 },
        ],
        messages: [
          {
            id: 'msg-1',
            exchange_id: 'ex-1',
            exchange_role: 'Request',
            from_participant_id: 'p1',
            to_participant_id: 'p2',
            ref_kind: 'PhysicalEntity',
            ref_id: 'pe-order',
            is_collection: true,
          },
          {
            id: 'msg-2',
            exchange_id: 'ex-1',
            exchange_role: 'Response',
            from_participant_id: 'p2',
            to_participant_id: 'p1',
            ref_kind: 'LogicalEntity',
            ref_id: 'le-customer',
            // is_collection intentionally omitted
          },
        ],
        fragments: [],
        operands: [],
        sequence_nodes: [],
      };

      // Simulate full round-trip
      const jsonString = JSON.stringify(diagram);
      const loadedDiagram: SequenceDiagram = JSON.parse(jsonString);

      // Verify all messages render correctly
      const msg1Label = resolveMessageLabel(loadedDiagram.messages[0], metaModel);
      const msg2Label = resolveMessageLabel(loadedDiagram.messages[1], metaModel);

      expect(msg1Label).toBe('Collection<Order>');
      expect(msg2Label).toBe('Customer');
    });
  });
});
