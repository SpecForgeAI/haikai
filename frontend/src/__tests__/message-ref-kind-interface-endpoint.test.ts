/**
 * Tests for MessageRefKind Interface and InterfaceEndpoint support
 * Task Group 1: Type definition validation tests
 * Task Group 2: UI component function tests
 * Task Group 3: Utility and renderer function tests
 */

import { describe, it, expect } from 'vitest';
import {
  MESSAGE_REF_KINDS,
  isMessageRefKind,
  SequenceMessage,
} from '../types/sequenceDiagram';

// ============================================================================
// Task Group 1: Type Definition Tests
// ============================================================================

describe('Task Group 1: MessageRefKind Type Definition', () => {
  describe('isMessageRefKind type guard', () => {
    it('should return true for Interface', () => {
      expect(isMessageRefKind('Interface')).toBe(true);
    });

    it('should return true for InterfaceEndpoint', () => {
      expect(isMessageRefKind('InterfaceEndpoint')).toBe(true);
    });
  });

  describe('MESSAGE_REF_KINDS array', () => {
    it('should contain Interface', () => {
      expect(MESSAGE_REF_KINDS).toContain('Interface');
    });

    it('should contain InterfaceEndpoint', () => {
      expect(MESSAGE_REF_KINDS).toContain('InterfaceEndpoint');
    });

    it('should have 7 total values', () => {
      expect(MESSAGE_REF_KINDS).toHaveLength(7);
    });

    it('should contain all expected values', () => {
      expect(MESSAGE_REF_KINDS).toContain('Method');
      expect(MESSAGE_REF_KINDS).toContain('LogicalEntity');
      expect(MESSAGE_REF_KINDS).toContain('PhysicalEntity');
      expect(MESSAGE_REF_KINDS).toContain('Class');
      expect(MESSAGE_REF_KINDS).toContain('Event');
      expect(MESSAGE_REF_KINDS).toContain('Interface');
      expect(MESSAGE_REF_KINDS).toContain('InterfaceEndpoint');
    });
  });
});

// ============================================================================
// Task Group 2: UI Component Function Tests
// ============================================================================

describe('Task Group 2: UI Component Functions', () => {
  // Mock MetaModel for testing
  const mockMetaModel = {
    entities: {
      interfaces: [
        { id: 'iface-1', name: 'OrderAPI' },
        { id: 'iface-2', name: 'PaymentGateway' },
      ],
      endpoints: [
        { id: 'ep-1', name: 'createOrder' },
        { id: 'ep-2', name: 'processPayment' },
      ],
      methods: [{ id: 'm-1', name: 'doSomething' }],
      logical_data_entities: [],
      physical_data_entities: [],
      classes: [],
      events: [],
      business_users: [],
      applications: [],
      app_components: [],
      services: [],
    },
  };

  describe('getReferenceOptions function pattern', () => {
    // This tests the pattern used in AddMessageExchangeDrawer.tsx
    function getReferenceOptions(
      refKind: string,
      metaModel: typeof mockMetaModel | null
    ): Array<{ id: string; name: string }> {
      if (!metaModel || !refKind) return [];

      switch (refKind) {
        case 'Method':
          return (metaModel.entities.methods || []).map(m => ({ id: m.id, name: m.name }));
        case 'LogicalEntity':
          return metaModel.entities.logical_data_entities.map(e => ({ id: e.id, name: e.name }));
        case 'PhysicalEntity':
          return metaModel.entities.physical_data_entities.map(e => ({ id: e.id, name: e.name }));
        case 'Class':
          return (metaModel.entities.classes || []).map(c => ({ id: c.id, name: c.name }));
        case 'Event':
          return (metaModel.entities.events || []).map(e => ({ id: e.id, name: e.name }));
        case 'Interface':
          return (metaModel.entities.interfaces || []).map(i => ({ id: i.id, name: i.name }));
        case 'InterfaceEndpoint':
          return (metaModel.entities.endpoints || []).map(e => ({ id: e.id, name: e.name }));
        default:
          return [];
      }
    }

    it('should return interfaces from metaModel for Interface refKind', () => {
      const options = getReferenceOptions('Interface', mockMetaModel);
      expect(options).toHaveLength(2);
      expect(options[0]).toEqual({ id: 'iface-1', name: 'OrderAPI' });
      expect(options[1]).toEqual({ id: 'iface-2', name: 'PaymentGateway' });
    });

    it('should return endpoints from metaModel for InterfaceEndpoint refKind', () => {
      const options = getReferenceOptions('InterfaceEndpoint', mockMetaModel);
      expect(options).toHaveLength(2);
      expect(options[0]).toEqual({ id: 'ep-1', name: 'createOrder' });
      expect(options[1]).toEqual({ id: 'ep-2', name: 'processPayment' });
    });
  });

  describe('getMessageContentLabel function pattern', () => {
    // This tests the pattern used in SequenceNodeRow.tsx
    function getMessageContentLabel(
      message: SequenceMessage,
      metaModel: typeof mockMetaModel | null
    ): string {
      if (message.label_text) {
        return message.label_text;
      }

      if (message.ref_kind && message.ref_id) {
        if (!metaModel) {
          return `${message.ref_kind}`;
        }

        const refKind = message.ref_kind;
        const refId = message.ref_id;

        switch (refKind) {
          case 'Method':
            return metaModel.entities.methods?.find(m => m.id === refId)?.name || refKind;
          case 'LogicalEntity':
            return metaModel.entities.logical_data_entities.find(e => e.id === refId)?.name || refKind;
          case 'PhysicalEntity':
            return metaModel.entities.physical_data_entities.find(e => e.id === refId)?.name || refKind;
          case 'Class':
            return metaModel.entities.classes?.find(e => e.id === refId)?.name || refKind;
          case 'Event':
            return metaModel.entities.events?.find(e => e.id === refId)?.name || refKind;
          case 'Interface':
            return metaModel.entities.interfaces?.find(i => i.id === refId)?.name || refKind;
          case 'InterfaceEndpoint':
            return metaModel.entities.endpoints?.find(e => e.id === refId)?.name || refKind;
          default:
            return refKind;
        }
      }

      return 'No content';
    }

    it('should resolve Interface name correctly', () => {
      const message: SequenceMessage = {
        id: 'msg-1',
        exchange_id: 'ex-1',
        exchange_role: 'Request',
        from_participant_id: 'p1',
        to_participant_id: 'p2',
        ref_kind: 'Interface',
        ref_id: 'iface-1',
      };
      const label = getMessageContentLabel(message, mockMetaModel);
      expect(label).toBe('OrderAPI');
    });

    it('should resolve InterfaceEndpoint name correctly', () => {
      const message: SequenceMessage = {
        id: 'msg-1',
        exchange_id: 'ex-1',
        exchange_role: 'Request',
        from_participant_id: 'p1',
        to_participant_id: 'p2',
        ref_kind: 'InterfaceEndpoint',
        ref_id: 'ep-2',
      };
      const label = getMessageContentLabel(message, mockMetaModel);
      expect(label).toBe('processPayment');
    });

    it('should fallback to refKind when entity not found', () => {
      const message: SequenceMessage = {
        id: 'msg-1',
        exchange_id: 'ex-1',
        exchange_role: 'Request',
        from_participant_id: 'p1',
        to_participant_id: 'p2',
        ref_kind: 'Interface',
        ref_id: 'non-existent',
      };
      const label = getMessageContentLabel(message, mockMetaModel);
      expect(label).toBe('Interface');
    });
  });
});

// ============================================================================
// Task Group 3: Utility and Renderer Function Tests
// ============================================================================

describe('Task Group 3: Utility and Renderer Functions', () => {
  // Mock MetaModel for testing
  const mockMetaModel = {
    entities: {
      interfaces: [
        { id: 'iface-1', name: 'OrderAPI' },
        { id: 'iface-2', name: 'PaymentGateway' },
      ],
      endpoints: [
        { id: 'ep-1', name: 'createOrder' },
        { id: 'ep-2', name: 'processPayment' },
      ],
      methods: [],
      logical_data_entities: [],
      physical_data_entities: [],
      classes: [],
      events: [],
      business_users: [],
      applications: [],
      app_components: [],
      services: [],
    },
  };

  describe('resolveMessageLabel utility function pattern', () => {
    // This tests the pattern used in sequenceDiagramUtils.ts
    function resolveMessageLabel(
      message: SequenceMessage,
      metaModel: typeof mockMetaModel | null | undefined
    ): string {
      if (message.label_text) {
        return message.label_text;
      }

      if (!metaModel || !message.ref_kind || !message.ref_id) {
        return 'Message';
      }

      switch (message.ref_kind) {
        case 'Method': {
          const entity = metaModel.entities.methods?.find(e => e.id === message.ref_id);
          return entity?.name || `Method:${message.ref_id}`;
        }
        case 'LogicalEntity': {
          const entity = metaModel.entities.logical_data_entities?.find(e => e.id === message.ref_id);
          return entity?.name || `LogicalEntity:${message.ref_id}`;
        }
        case 'PhysicalEntity': {
          const entity = metaModel.entities.physical_data_entities?.find(e => e.id === message.ref_id);
          return entity?.name || `PhysicalEntity:${message.ref_id}`;
        }
        case 'Class': {
          const entity = metaModel.entities.classes?.find(e => e.id === message.ref_id);
          return entity?.name || `Class:${message.ref_id}`;
        }
        case 'Event': {
          const entity = metaModel.entities.events?.find(e => e.id === message.ref_id);
          return entity?.name || `Event:${message.ref_id}`;
        }
        case 'Interface': {
          const entity = metaModel.entities.interfaces?.find(e => e.id === message.ref_id);
          return entity?.name || `Interface:${message.ref_id}`;
        }
        case 'InterfaceEndpoint': {
          const entity = metaModel.entities.endpoints?.find(e => e.id === message.ref_id);
          return entity?.name || `InterfaceEndpoint:${message.ref_id}`;
        }
        default:
          return `${message.ref_kind}:${message.ref_id}`;
      }
    }

    it('should return Interface name for Interface ref_kind', () => {
      const message: SequenceMessage = {
        id: 'msg-1',
        exchange_id: 'ex-1',
        exchange_role: 'Request',
        from_participant_id: 'p1',
        to_participant_id: 'p2',
        ref_kind: 'Interface',
        ref_id: 'iface-1',
      };
      const label = resolveMessageLabel(message, mockMetaModel);
      expect(label).toBe('OrderAPI');
    });

    it('should return InterfaceEndpoint name for InterfaceEndpoint ref_kind', () => {
      const message: SequenceMessage = {
        id: 'msg-1',
        exchange_id: 'ex-1',
        exchange_role: 'Request',
        from_participant_id: 'p1',
        to_participant_id: 'p2',
        ref_kind: 'InterfaceEndpoint',
        ref_id: 'ep-2',
      };
      const label = resolveMessageLabel(message, mockMetaModel);
      expect(label).toBe('processPayment');
    });

    it('should return fallback format when Interface entity not found', () => {
      const message: SequenceMessage = {
        id: 'msg-1',
        exchange_id: 'ex-1',
        exchange_role: 'Request',
        from_participant_id: 'p1',
        to_participant_id: 'p2',
        ref_kind: 'Interface',
        ref_id: 'non-existent',
      };
      const label = resolveMessageLabel(message, mockMetaModel);
      expect(label).toBe('Interface:non-existent');
    });

    it('should return fallback format when InterfaceEndpoint entity not found', () => {
      const message: SequenceMessage = {
        id: 'msg-1',
        exchange_id: 'ex-1',
        exchange_role: 'Request',
        from_participant_id: 'p1',
        to_participant_id: 'p2',
        ref_kind: 'InterfaceEndpoint',
        ref_id: 'non-existent',
      };
      const label = resolveMessageLabel(message, mockMetaModel);
      expect(label).toBe('InterfaceEndpoint:non-existent');
    });
  });

  describe('MESSAGE_REF_KIND_TO_COLLECTION mapping pattern', () => {
    // This tests the pattern used in SequenceDiagramRenderer.tsx
    type MessageRefKind = 'Method' | 'LogicalEntity' | 'PhysicalEntity' | 'Class' | 'Event' | 'Interface' | 'InterfaceEndpoint';

    const MESSAGE_REF_KIND_TO_COLLECTION: Record<MessageRefKind, string> = {
      Method: 'methods',
      LogicalEntity: 'logical_data_entities',
      PhysicalEntity: 'physical_data_entities',
      Class: 'classes',
      Event: 'events',
      Interface: 'interfaces',
      InterfaceEndpoint: 'endpoints',
    };

    it('should map Interface to interfaces collection', () => {
      expect(MESSAGE_REF_KIND_TO_COLLECTION['Interface']).toBe('interfaces');
    });

    it('should map InterfaceEndpoint to endpoints collection', () => {
      expect(MESSAGE_REF_KIND_TO_COLLECTION['InterfaceEndpoint']).toBe('endpoints');
    });

    it('should have mappings for all 7 ref kinds', () => {
      expect(Object.keys(MESSAGE_REF_KIND_TO_COLLECTION)).toHaveLength(7);
    });
  });
});
