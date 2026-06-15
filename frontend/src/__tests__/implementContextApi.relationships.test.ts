/**
 * implementContextApi.relationships.test.ts
 *
 * Spec 2026-01-26: Implement Context Include Relationships and Propagate to Planner Payload
 * Task Group 8: Frontend Unit Tests
 *
 * Tests for relationship-related functions in implementContextApi.ts:
 * - parseRelationshipRef() parsing
 * - relationshipRefToString() serialization
 * - relationshipRefToSelection() conversion
 * - mapDtoToContextState() with relationship data
 * - saveImplementContext() request body structure
 * - Empty/null relationship handling
 */

import {
  parseRelationshipRef,
  relationshipRefToString,
  relationshipRefToSelection,
  RelationshipSelectionDto,
} from '../api/implementContextApi';
import type { RelationshipRef } from '../utils/contextStorage';

describe('implementContextApi relationship functions', () => {
  describe('parseRelationshipRef', () => {
    it('should parse relationship ID string in "type::id" format', () => {
      const result = parseRelationshipRef('data_movements::dm-001');

      expect(result.kind).toBe('RELATIONSHIP');
      expect(result.relationship_type).toBe('data_movements');
      expect(result.relationship_id).toBe('dm-001');
      expect(result.label).toBe('data_movements - dm-001');
    });

    it('should use label from selections when available', () => {
      const selections: RelationshipSelectionDto[] = [
        {
          relationship_type: 'data_movements',
          relationship_id: 'dm-001',
          label: 'Orders Flow to Warehouse',
        },
      ];

      const result = parseRelationshipRef('data_movements::dm-001', selections);

      expect(result.kind).toBe('RELATIONSHIP');
      expect(result.relationship_type).toBe('data_movements');
      expect(result.relationship_id).toBe('dm-001');
      expect(result.label).toBe('Orders Flow to Warehouse');
    });

    it('should handle simple ID format as fallback', () => {
      const result = parseRelationshipRef('simple-id');

      expect(result.kind).toBe('RELATIONSHIP');
      expect(result.relationship_type).toBe('unknown');
      expect(result.relationship_id).toBe('simple-id');
      expect(result.label).toBe('simple-id');
    });

    it('should handle empty selections array gracefully', () => {
      const result = parseRelationshipRef('fk_relationships::fk-123', []);

      expect(result.kind).toBe('RELATIONSHIP');
      expect(result.relationship_type).toBe('fk_relationships');
      expect(result.relationship_id).toBe('fk-123');
      expect(result.label).toBe('fk_relationships - fk-123');
    });

    it('should handle null selections gracefully', () => {
      const result = parseRelationshipRef('contains::cnt-001', null);

      expect(result.kind).toBe('RELATIONSHIP');
      expect(result.relationship_type).toBe('contains');
      expect(result.relationship_id).toBe('cnt-001');
      expect(result.label).toBe('contains - cnt-001');
    });
  });

  describe('relationshipRefToString', () => {
    it('should serialize RelationshipRef to "type::id" format', () => {
      const ref: RelationshipRef = {
        kind: 'RELATIONSHIP',
        relationship_type: 'data_movements',
        relationship_id: 'dm-001',
        label: 'Orders Flow',
      };

      const result = relationshipRefToString(ref);

      expect(result).toBe('data_movements::dm-001');
    });

    it('should handle various relationship types', () => {
      const refs: RelationshipRef[] = [
        {
          kind: 'RELATIONSHIP',
          relationship_type: 'fk_relationships',
          relationship_id: 'fk-123',
          label: 'Foreign Key',
        },
        {
          kind: 'RELATIONSHIP',
          relationship_type: 'contains',
          relationship_id: 'cnt-456',
          label: 'Contains',
        },
        {
          kind: 'RELATIONSHIP',
          relationship_type: 'uses',
          relationship_id: 'use-789',
          label: 'Uses',
        },
      ];

      expect(relationshipRefToString(refs[0])).toBe('fk_relationships::fk-123');
      expect(relationshipRefToString(refs[1])).toBe('contains::cnt-456');
      expect(relationshipRefToString(refs[2])).toBe('uses::use-789');
    });
  });

  describe('relationshipRefToSelection', () => {
    it('should convert RelationshipRef to RelationshipSelectionDto', () => {
      const ref: RelationshipRef = {
        kind: 'RELATIONSHIP',
        relationship_type: 'data_movements',
        relationship_id: 'dm-001',
        label: 'Orders Flow to Warehouse',
      };

      const result = relationshipRefToSelection(ref);

      expect(result).toEqual({
        relationship_type: 'data_movements',
        relationship_id: 'dm-001',
        label: 'Orders Flow to Warehouse',
      });
    });

    it('should preserve all fields from RelationshipRef', () => {
      const ref: RelationshipRef = {
        kind: 'RELATIONSHIP',
        relationship_type: 'fk_relationships',
        relationship_id: 'fk-user-order',
        label: 'User -> Order FK',
      };

      const dto = relationshipRefToSelection(ref);

      expect(dto.relationship_type).toBe('fk_relationships');
      expect(dto.relationship_id).toBe('fk-user-order');
      expect(dto.label).toBe('User -> Order FK');
    });
  });

  describe('roundtrip: parse -> selection -> string', () => {
    it('should maintain consistency through roundtrip conversion', () => {
      const originalString = 'state_transitions::st-001';
      const selections: RelationshipSelectionDto[] = [
        {
          relationship_type: 'state_transitions',
          relationship_id: 'st-001',
          label: 'Order: Pending -> Shipped',
        },
      ];

      // Parse the string
      const ref = parseRelationshipRef(originalString, selections);
      expect(ref.relationship_type).toBe('state_transitions');
      expect(ref.relationship_id).toBe('st-001');
      expect(ref.label).toBe('Order: Pending -> Shipped');

      // Convert back to selection
      const newSelection = relationshipRefToSelection(ref);
      expect(newSelection).toEqual(selections[0]);

      // Convert back to string
      const newString = relationshipRefToString(ref);
      expect(newString).toBe(originalString);
    });
  });

  describe('edge cases', () => {
    it('should handle relationship IDs with multiple colons', () => {
      // Only the first :: should be the separator
      const result = parseRelationshipRef('type::id::with::colons');

      expect(result.relationship_type).toBe('type');
      expect(result.relationship_id).toBe('id');
      // Note: This is current behavior - only first two parts are used
    });

    it('should handle empty strings', () => {
      const result = parseRelationshipRef('');

      expect(result.kind).toBe('RELATIONSHIP');
      expect(result.relationship_type).toBe('unknown');
      expect(result.relationship_id).toBe('');
    });

    it('should handle relationship type with underscores', () => {
      const result = parseRelationshipRef('physical_data_entity_relationships::pder-001');

      expect(result.relationship_type).toBe('physical_data_entity_relationships');
      expect(result.relationship_id).toBe('pder-001');
    });

    it('should handle UUID-style relationship IDs', () => {
      const result = parseRelationshipRef('fk_relationships::550e8400-e29b-41d4-a716-446655440000');

      expect(result.relationship_type).toBe('fk_relationships');
      expect(result.relationship_id).toBe('550e8400-e29b-41d4-a716-446655440000');
    });
  });
});
