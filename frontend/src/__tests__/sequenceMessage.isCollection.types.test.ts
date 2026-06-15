/**
 * Tests for SequenceMessage and SequenceMessageRef is_collection type compatibility
 *
 * Spec: 2026-01-26 - Sequence Diagram Message Exchange Collection Entity Display
 * Task Group 2: Frontend Type Definitions
 *
 * Tests that verify:
 * - SequenceMessageRef accepts optional is_collection property
 * - SequenceMessage accepts optional is_collection property
 * - Backward compatibility: objects without is_collection are still valid
 */

import { describe, it, expect } from 'vitest';
import type { SequenceMessageRef } from '../types/typedContent';
import type { SequenceMessage } from '../types/sequenceDiagram';

describe('Task Group 2: Frontend Type Tests for is_collection', () => {
  describe('Test 2.1a: SequenceMessageRef accepts optional is_collection', () => {
    it('should accept SequenceMessageRef with is_collection: true', () => {
      const messageRef: SequenceMessageRef = {
        id: 'msg-001',
        exchange_id: 'exchange-001',
        exchange_role: 'Request',
        from_participant_id: 'participant-001',
        to_participant_id: 'participant-002',
        ref_kind: 'PhysicalEntity',
        ref_id: 'entity-001',
        is_collection: true,
      };

      expect(messageRef.id).toBe('msg-001');
      expect(messageRef.is_collection).toBe(true);
    });

    it('should accept SequenceMessageRef with is_collection: false', () => {
      const messageRef: SequenceMessageRef = {
        id: 'msg-002',
        exchange_id: 'exchange-001',
        exchange_role: 'Response',
        from_participant_id: 'participant-002',
        to_participant_id: 'participant-001',
        ref_kind: 'LogicalEntity',
        ref_id: 'entity-002',
        is_collection: false,
      };

      expect(messageRef.is_collection).toBe(false);
    });

    it('should accept SequenceMessageRef without is_collection (backward compatibility)', () => {
      const messageRef: SequenceMessageRef = {
        id: 'msg-003',
        exchange_id: 'exchange-002',
        exchange_role: 'Request',
        from_participant_id: 'participant-001',
        to_participant_id: 'participant-002',
        ref_kind: 'Method',
        ref_id: 'method-001',
      };

      expect(messageRef.is_collection).toBeUndefined();
      // When undefined, treat as false
      expect(messageRef.is_collection ?? false).toBe(false);
    });

    it('should accept SequenceMessageRef with label_text mode (no is_collection)', () => {
      const messageRef: SequenceMessageRef = {
        id: 'msg-004',
        exchange_id: 'exchange-003',
        exchange_role: 'Request',
        from_participant_id: 'participant-001',
        to_participant_id: 'participant-002',
        label_text: 'Create Order',
      };

      expect(messageRef.label_text).toBe('Create Order');
      expect(messageRef.is_collection).toBeUndefined();
    });
  });

  describe('Test 2.1b: SequenceMessage accepts optional is_collection', () => {
    it('should accept SequenceMessage with is_collection: true', () => {
      const message: SequenceMessage = {
        id: 'msg-001',
        exchange_id: 'exchange-001',
        exchange_role: 'Request',
        from_participant_id: 'participant-001',
        to_participant_id: 'participant-002',
        ref_kind: 'PhysicalEntity',
        ref_id: 'entity-001',
        is_collection: true,
      };

      expect(message.id).toBe('msg-001');
      expect(message.is_collection).toBe(true);
    });

    it('should accept SequenceMessage with is_collection: false', () => {
      const message: SequenceMessage = {
        id: 'msg-002',
        exchange_id: 'exchange-001',
        exchange_role: 'Response',
        from_participant_id: 'participant-002',
        to_participant_id: 'participant-001',
        ref_kind: 'LogicalEntity',
        ref_id: 'entity-002',
        is_collection: false,
      };

      expect(message.is_collection).toBe(false);
    });

    it('should accept SequenceMessage without is_collection (backward compatibility)', () => {
      const message: SequenceMessage = {
        id: 'msg-003',
        exchange_id: 'exchange-002',
        exchange_role: 'Request',
        from_participant_id: 'participant-001',
        to_participant_id: 'participant-002',
        ref_kind: 'Method',
        ref_id: 'method-001',
      };

      expect(message.is_collection).toBeUndefined();
      // When undefined, treat as false
      expect(message.is_collection ?? false).toBe(false);
    });

    it('should accept SequenceMessage with label_text mode (no is_collection)', () => {
      const message: SequenceMessage = {
        id: 'msg-004',
        exchange_id: 'exchange-003',
        exchange_role: 'Request',
        from_participant_id: 'participant-001',
        to_participant_id: 'participant-002',
        label_text: 'Process Payment',
      };

      expect(message.label_text).toBe('Process Payment');
      expect(message.is_collection).toBeUndefined();
    });
  });
});
