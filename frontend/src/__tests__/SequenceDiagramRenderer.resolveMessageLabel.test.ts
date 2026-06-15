/**
 * SequenceDiagramRenderer.resolveMessageLabel.test.ts
 *
 * Spec: 2026-01-26 - Sequence Diagram Message Exchange Collection Entity Display
 * Task Group 4: SequenceDiagramRenderer Label Formatting
 *
 * Tests for the resolveMessageLabel function with collection support:
 * - PhysicalEntity with is_collection=true returns "Collection<EntityName>"
 * - PhysicalEntity with is_collection=false returns "EntityName"
 * - LogicalEntity with is_collection=true returns "Collection<EntityName>"
 * - Method with is_collection=true still returns "MethodName" (no collection support)
 * - Missing is_collection field returns "EntityName" (backward compatibility)
 * - Entity not found with is_collection=true returns "Collection<ref_id>"
 */

import { describe, it, expect } from 'vitest';
import {
  resolveMessageLabel,
  supportsCollectionWrapper,
  formatEntityLabel,
  ENTITY_REF_KINDS_SUPPORTING_COLLECTION,
} from '../components/DiagramsView/SequenceDiagramRenderer';
import type { SequenceMessage } from '../types/sequenceDiagram';
import type { MetaModel, MetaModelEntities, MetaModelRelationships } from '../types/model';

/**
 * Helper function to create a minimal MetaModel for testing.
 * Allows specifying physical_data_entities, logical_data_entities, and methods.
 */
function createTestMetaModel(options: {
  physicalEntities?: Array<{ id: string; name: string }>;
  logicalEntities?: Array<{ id: string; name: string }>;
  methods?: Array<{ id: string; name: string }>;
  events?: Array<{ id: string; name: string }>;
} = {}): MetaModel {
  const entities: MetaModelEntities = {
    business_users: [],
    business_processes: [],
    process_activities: [],
    business_points: [],
    applications: [],
    app_components: [],
    services: [],
    interfaces: [],
    endpoints: [],
    classes: [],
    methods: (options.methods || []).map(m => ({
      id: m.id,
      name: m.name,
      description: '',
      parameters: '',
      return_type: '',
      class_id: '',
      tags: '',
    })),
    application_points: [],
    logical_data_entities: (options.logicalEntities || []).map(e => ({
      id: e.id,
      name: e.name,
      description: '',
      tags: '',
    })),
    logical_data_attributes: [],
    physical_data_entities: (options.physicalEntities || []).map(e => ({
      id: e.id,
      name: e.name,
      description: '',
      tags: '',
    })),
    physical_data_attributes: [],
    interactions: [],
    app_business_points: [],
    events: (options.events || []).map(e => ({
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
 * Helper to create a SequenceMessage for testing.
 */
function createTestMessage(overrides: Partial<SequenceMessage>): SequenceMessage {
  return {
    id: 'msg-001',
    exchange_id: 'exchange-001',
    exchange_role: 'Request',
    from_participant_id: 'participant-001',
    to_participant_id: 'participant-002',
    ...overrides,
  };
}

describe('Task Group 4: resolveMessageLabel Collection Support', () => {
  describe('Test 4.1a: PhysicalEntity with is_collection=true returns "Collection<EntityName>"', () => {
    it('should return Collection<EntityName> for PhysicalEntity with is_collection=true', () => {
      const metaModel = createTestMetaModel({
        physicalEntities: [{ id: 'pe-001', name: 'Order' }],
      });

      const message = createTestMessage({
        ref_kind: 'PhysicalEntity',
        ref_id: 'pe-001',
        is_collection: true,
      });

      const label = resolveMessageLabel(message, metaModel);
      expect(label).toBe('Collection<Order>');
    });
  });

  describe('Test 4.1b: PhysicalEntity with is_collection=false returns "EntityName"', () => {
    it('should return EntityName for PhysicalEntity with is_collection=false', () => {
      const metaModel = createTestMetaModel({
        physicalEntities: [{ id: 'pe-002', name: 'Customer' }],
      });

      const message = createTestMessage({
        ref_kind: 'PhysicalEntity',
        ref_id: 'pe-002',
        is_collection: false,
      });

      const label = resolveMessageLabel(message, metaModel);
      expect(label).toBe('Customer');
    });
  });

  describe('Test 4.1c: LogicalEntity with is_collection=true returns "Collection<EntityName>"', () => {
    it('should return Collection<EntityName> for LogicalEntity with is_collection=true', () => {
      const metaModel = createTestMetaModel({
        logicalEntities: [{ id: 'le-001', name: 'Invoice' }],
      });

      const message = createTestMessage({
        ref_kind: 'LogicalEntity',
        ref_id: 'le-001',
        is_collection: true,
      });

      const label = resolveMessageLabel(message, metaModel);
      expect(label).toBe('Collection<Invoice>');
    });
  });

  describe('Test 4.1d: Method with is_collection=true still returns "MethodName" (no collection support)', () => {
    it('should return MethodName for Method even when is_collection=true', () => {
      const metaModel = createTestMetaModel({
        methods: [{ id: 'method-001', name: 'processPayment' }],
      });

      const message = createTestMessage({
        ref_kind: 'Method',
        ref_id: 'method-001',
        is_collection: true,
      });

      const label = resolveMessageLabel(message, metaModel);
      expect(label).toBe('processPayment');
    });
  });

  describe('Test 4.1e: Missing is_collection field returns "EntityName" (backward compatibility)', () => {
    it('should return EntityName when is_collection is undefined (backward compatibility)', () => {
      const metaModel = createTestMetaModel({
        physicalEntities: [{ id: 'pe-003', name: 'Product' }],
      });

      const message = createTestMessage({
        ref_kind: 'PhysicalEntity',
        ref_id: 'pe-003',
        // is_collection is intentionally omitted
      });

      const label = resolveMessageLabel(message, metaModel);
      expect(label).toBe('Product');
    });

    it('should return EntityName for LogicalEntity when is_collection is undefined', () => {
      const metaModel = createTestMetaModel({
        logicalEntities: [{ id: 'le-002', name: 'Account' }],
      });

      const message = createTestMessage({
        ref_kind: 'LogicalEntity',
        ref_id: 'le-002',
        // is_collection is intentionally omitted
      });

      const label = resolveMessageLabel(message, metaModel);
      expect(label).toBe('Account');
    });
  });

  describe('Test 4.1f: Entity not found with is_collection=true returns "Collection<ref_id>"', () => {
    it('should return Collection<ref_id> when PhysicalEntity not found and is_collection=true', () => {
      const metaModel = createTestMetaModel(); // No entities

      const message = createTestMessage({
        ref_kind: 'PhysicalEntity',
        ref_id: 'unknown-entity-123',
        is_collection: true,
      });

      const label = resolveMessageLabel(message, metaModel);
      expect(label).toBe('Collection<unknown-entity-123>');
    });

    it('should return Collection<ref_id> when LogicalEntity not found and is_collection=true', () => {
      const metaModel = createTestMetaModel(); // No entities

      const message = createTestMessage({
        ref_kind: 'LogicalEntity',
        ref_id: 'missing-logical-456',
        is_collection: true,
      });

      const label = resolveMessageLabel(message, metaModel);
      expect(label).toBe('Collection<missing-logical-456>');
    });
  });

  describe('Additional tests: Label text mode', () => {
    it('should return label_text unchanged regardless of is_collection value', () => {
      const metaModel = createTestMetaModel();

      const message = createTestMessage({
        label_text: 'Create Order',
        // Note: is_collection shouldn't apply to label_text mode
      });

      const label = resolveMessageLabel(message, metaModel);
      expect(label).toBe('Create Order');
    });
  });

  describe('Helper function tests', () => {
    describe('supportsCollectionWrapper', () => {
      it('should return true for PhysicalEntity', () => {
        expect(supportsCollectionWrapper('PhysicalEntity')).toBe(true);
      });

      it('should return true for LogicalEntity', () => {
        expect(supportsCollectionWrapper('LogicalEntity')).toBe(true);
      });

      it('should return false for Method', () => {
        expect(supportsCollectionWrapper('Method')).toBe(false);
      });

      it('should return false for Event', () => {
        expect(supportsCollectionWrapper('Event')).toBe(false);
      });

      it('should return false for undefined', () => {
        expect(supportsCollectionWrapper(undefined)).toBe(false);
      });
    });

    describe('formatEntityLabel', () => {
      it('should wrap with Collection<> when isCollection=true and refKind supports it', () => {
        expect(formatEntityLabel('Order', true, 'PhysicalEntity')).toBe('Collection<Order>');
        expect(formatEntityLabel('Customer', true, 'LogicalEntity')).toBe('Collection<Customer>');
      });

      it('should NOT wrap when isCollection=false', () => {
        expect(formatEntityLabel('Order', false, 'PhysicalEntity')).toBe('Order');
      });

      it('should NOT wrap when isCollection=undefined', () => {
        expect(formatEntityLabel('Order', undefined, 'PhysicalEntity')).toBe('Order');
      });

      it('should NOT wrap when refKind does not support collection', () => {
        expect(formatEntityLabel('processPayment', true, 'Method')).toBe('processPayment');
        expect(formatEntityLabel('OrderCreated', true, 'Event')).toBe('OrderCreated');
      });
    });

    describe('ENTITY_REF_KINDS_SUPPORTING_COLLECTION constant', () => {
      it('should contain PhysicalEntity and LogicalEntity', () => {
        expect(ENTITY_REF_KINDS_SUPPORTING_COLLECTION).toContain('PhysicalEntity');
        expect(ENTITY_REF_KINDS_SUPPORTING_COLLECTION).toContain('LogicalEntity');
      });

      it('should have exactly 2 items', () => {
        expect(ENTITY_REF_KINDS_SUPPORTING_COLLECTION).toHaveLength(2);
      });
    });
  });
});
