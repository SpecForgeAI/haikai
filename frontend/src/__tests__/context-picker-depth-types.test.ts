/**
 * context-picker-depth-types.test.ts
 *
 * Spec 2026-01-16: Context Picker Smart Defaults and Heuristic Suggestions
 * Task Group 1: Tests for depth type extensions
 *
 * Tests:
 * - EntityRef with optional depth field accepts valid values (1, 2, undefined)
 * - EntityBundleSelection with depth field serialization
 * - Backward compatibility when depth is omitted
 * - Depth type narrowing (1 | 2 union type)
 * - Depth constants (DEPTH_OPTIONS, DEPTH_LABELS, DEPTH_WARNING)
 */

import { describe, it, expect } from 'vitest';
import type { EntityRef } from '../utils/contextStorage';
import { DEPTH_OPTIONS, DEPTH_LABELS, DEPTH_WARNING } from '../utils/contextBundleTypes';

describe('Depth Type Extensions', () => {
  describe('EntityRef depth field', () => {
    it('accepts valid depth value 1', () => {
      // Arrange & Act
      const entityRef: EntityRef = {
        kind: 'ENTITY',
        entity_type: 'physical_data_entities',
        entity_id: 'pde-1',
        label: 'Customer Table',
        bundle_type: 'entity_with_attributes_and_relationships',
        depth: 1,
      };

      // Assert
      expect(entityRef.depth).toBe(1);
    });

    it('accepts valid depth value 2', () => {
      // Arrange & Act
      const entityRef: EntityRef = {
        kind: 'ENTITY',
        entity_type: 'physical_data_entities',
        entity_id: 'pde-1',
        label: 'Customer Table',
        bundle_type: 'entity_with_attributes_and_relationships',
        depth: 2,
      };

      // Assert
      expect(entityRef.depth).toBe(2);
    });

    it('accepts undefined depth (optional field)', () => {
      // Arrange & Act
      const entityRef: EntityRef = {
        kind: 'ENTITY',
        entity_type: 'physical_data_entities',
        entity_id: 'pde-1',
        label: 'Customer Table',
        bundle_type: 'entity_with_attributes_and_relationships',
        // depth is omitted
      };

      // Assert
      expect(entityRef.depth).toBeUndefined();
    });

    it('maintains backward compatibility - refs without depth work correctly', () => {
      // Arrange - simulate loading legacy data without depth
      const legacyRef = {
        kind: 'ENTITY' as const,
        entity_type: 'interfaces',
        entity_id: 'int-1',
        label: 'Payment API',
        bundle_type: 'interface_with_endpoints_and_schemas',
      };

      // Act - cast to EntityRef
      const entityRef: EntityRef = legacyRef;

      // Assert - should be valid EntityRef without depth
      expect(entityRef.kind).toBe('ENTITY');
      expect(entityRef.depth).toBeUndefined();
    });
  });

  describe('EntityRef depth field serialization', () => {
    it('serializes EntityRef with depth to JSON correctly', () => {
      // Arrange
      const entityRef: EntityRef = {
        kind: 'ENTITY',
        entity_type: 'physical_data_entities',
        entity_id: 'pde-1',
        label: 'Customer Table',
        bundle_type: 'entity_with_attributes_and_relationships',
        depth: 2,
      };

      // Act
      const json = JSON.stringify(entityRef);
      const parsed = JSON.parse(json) as EntityRef;

      // Assert
      expect(parsed.depth).toBe(2);
    });

    it('serializes EntityRef without depth correctly (omits undefined)', () => {
      // Arrange
      const entityRef: EntityRef = {
        kind: 'ENTITY',
        entity_type: 'interfaces',
        entity_id: 'int-1',
        label: 'Payment API',
        bundle_type: 'interface_with_endpoints',
      };

      // Act
      const json = JSON.stringify(entityRef);
      const parsed = JSON.parse(json);

      // Assert - depth should not be present in serialized form
      expect('depth' in parsed).toBe(false);
    });
  });

  describe('Depth constants', () => {
    it('DEPTH_OPTIONS contains valid depth values [1, 2]', () => {
      // Assert
      expect(DEPTH_OPTIONS).toEqual([1, 2]);
      expect(DEPTH_OPTIONS).toHaveLength(2);
      expect(DEPTH_OPTIONS[0]).toBe(1);
      expect(DEPTH_OPTIONS[1]).toBe(2);
    });

    it('DEPTH_LABELS provides human-readable labels for depth values', () => {
      // Assert
      expect(DEPTH_LABELS[1]).toBe('Depth 1');
      expect(DEPTH_LABELS[2]).toBe('Depth 2 (Extended)');
    });

    it('DEPTH_WARNING provides warning message for depth 2', () => {
      // Assert
      expect(DEPTH_WARNING).toBe('May increase context size significantly');
    });
  });
});
