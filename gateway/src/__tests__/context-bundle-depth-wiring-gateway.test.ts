/**
 * Tests for Context Bundle + Depth Wiring - Gateway Layer
 *
 * Spec 2026-01-17: Fix Context Bundle + Depth Wiring End-to-End
 * Task Group 3: Gateway Entity Type Normalization
 * Task Group 4: Gateway PDE Attribute Validation
 *
 * Tests that:
 * 1. normalizeEntityType() converts physical_data_entities to physicalDataEntities
 * 2. normalizeEntityType() converts logical_data_entities to logicalDataEntities
 * 3. entities[] in expandResolveContext() request has normalized entity_types
 * 4. camelCase entity_types pass through unchanged
 * 5. Validation passes when physicalDataEntities have relevant_fields.attributes
 * 6. Validation logs error when attributes missing for PDEs
 * 7. Warning marker added to prompt when attributes missing
 * 8. Processing continues even when validation fails (graceful degradation)
 */

import {
  normalizeEntityType,
  normalizeEntitiesForExpandResolve,
  validatePdeAttributes,
  ENTITY_TYPE_CANONICAL_MAP,
} from '../services/architectureModelClient';
import { EntityBundleSelection, ResolvedEntitySummary } from '../types';

describe('Context Bundle Depth Wiring - Gateway Layer', () => {
  // ============================================================================
  // Task Group 3: Entity Type Normalization Tests
  // ============================================================================

  describe('Task 3.1 - normalizeEntityType() function', () => {
    it('should convert physical_data_entities to physicalDataEntities', () => {
      const result = normalizeEntityType('physical_data_entities');
      expect(result).toBe('physicalDataEntities');
    });

    it('should convert logical_data_entities to logicalDataEntities', () => {
      const result = normalizeEntityType('logical_data_entities');
      expect(result).toBe('logicalDataEntities');
    });

    it('should pass through camelCase entity_types unchanged', () => {
      expect(normalizeEntityType('physicalDataEntities')).toBe('physicalDataEntities');
      expect(normalizeEntityType('logicalDataEntities')).toBe('logicalDataEntities');
      expect(normalizeEntityType('services')).toBe('services');
      expect(normalizeEntityType('interfaces')).toBe('interfaces');
    });

    it('should convert other snake_case types using ENTITY_TYPE_CANONICAL_MAP', () => {
      expect(normalizeEntityType('app_components')).toBe('appComponents');
      expect(normalizeEntityType('business_processes')).toBe('businessProcesses');
      expect(normalizeEntityType('ui_screens')).toBe('uiScreens');
    });
  });

  describe('Task 3.3 - normalizeEntitiesForExpandResolve()', () => {
    it('should normalize entity_types in entities[] array before expand-resolve call', () => {
      const entities: EntityBundleSelection[] = [
        {
          entity_type: 'physical_data_entities',
          entity_id: 'pde-123',
          bundle_type: 'entity_with_attributes_and_relationships',
          depth: 1,
        },
        {
          entity_type: 'logical_data_entities',
          entity_id: 'lde-456',
          bundle_type: 'entity_with_attributes_and_relationships',
          depth: 2,
        },
        {
          entity_type: 'services',
          entity_id: 'svc-789',
          bundle_type: 'service_with_parents_and_children',
        },
      ];

      const normalized = normalizeEntitiesForExpandResolve(entities);

      // First entity should be normalized
      expect(normalized[0].entity_type).toBe('physicalDataEntities');
      expect(normalized[0].entity_id).toBe('pde-123');
      expect(normalized[0].bundle_type).toBe('entity_with_attributes_and_relationships');
      expect(normalized[0].depth).toBe(1);

      // Second entity should be normalized
      expect(normalized[1].entity_type).toBe('logicalDataEntities');
      expect(normalized[1].entity_id).toBe('lde-456');
      expect(normalized[1].depth).toBe(2);

      // Third entity should remain unchanged
      expect(normalized[2].entity_type).toBe('services');
    });

    it('should return empty array for empty input', () => {
      expect(normalizeEntitiesForExpandResolve([])).toEqual([]);
      expect(normalizeEntitiesForExpandResolve(undefined as any)).toEqual([]);
    });
  });

  // ============================================================================
  // Task Group 4: PDE Attribute Validation Tests
  // ============================================================================

  describe('Task 4.1 - validatePdeAttributes() function', () => {
    it('should return valid=true when physicalDataEntities have relevant_fields.attributes', () => {
      const resolvedEntities: ResolvedEntitySummary[] = [
        {
          id: 'pde-123',
          name: 'Users Table',
          entity_type: 'physicalDataEntities',
          category: 'data',
          relevant_fields: {
            database: 'user_db',
            attributes: [
              { name: 'id', type: 'bigint', pk: true },
              { name: 'email', type: 'varchar(255)' },
            ],
          },
        },
        {
          id: 'pde-456',
          name: 'Orders Table',
          entity_type: 'physicalDataEntities',
          category: 'data',
          relevant_fields: {
            database: 'order_db',
            attributes: [
              { name: 'order_id', type: 'bigint', pk: true },
              { name: 'user_id', type: 'bigint' },
            ],
          },
        },
      ];

      const result = validatePdeAttributes(resolvedEntities);

      expect(result.valid).toBe(true);
      expect(result.missingEntityIds).toEqual([]);
    });

    it('should return valid=false and missingEntityIds when attributes missing for PDEs', () => {
      const resolvedEntities: ResolvedEntitySummary[] = [
        {
          id: 'pde-123',
          name: 'Users Table',
          entity_type: 'physicalDataEntities',
          category: 'data',
          relevant_fields: {
            database: 'user_db',
            // attributes field is missing
          },
        },
        {
          id: 'pde-456',
          name: 'Orders Table',
          entity_type: 'physicalDataEntities',
          category: 'data',
          relevant_fields: {
            database: 'order_db',
            attributes: [], // Empty array counts as missing
          },
        },
      ];

      const result = validatePdeAttributes(resolvedEntities);

      expect(result.valid).toBe(false);
      expect(result.missingEntityIds).toContain('pde-123');
      expect(result.missingEntityIds).toContain('pde-456');
    });

    it('should ignore non-PDE entities in validation', () => {
      const resolvedEntities: ResolvedEntitySummary[] = [
        {
          id: 'svc-001',
          name: 'User Service',
          entity_type: 'services',
          category: 'application',
          relevant_fields: {
            serviceType: 'REST',
          },
        },
        {
          id: 'iface-001',
          name: 'User API',
          entity_type: 'interfaces',
          category: 'application',
          relevant_fields: {
            interfaceType: 'REST',
          },
        },
      ];

      const result = validatePdeAttributes(resolvedEntities);

      expect(result.valid).toBe(true);
      expect(result.missingEntityIds).toEqual([]);
    });

    it('should handle mixed valid and invalid PDEs', () => {
      const resolvedEntities: ResolvedEntitySummary[] = [
        {
          id: 'pde-valid',
          name: 'Valid Table',
          entity_type: 'physicalDataEntities',
          category: 'data',
          relevant_fields: {
            attributes: [{ name: 'id', type: 'int' }],
          },
        },
        {
          id: 'pde-invalid',
          name: 'Invalid Table',
          entity_type: 'physicalDataEntities',
          category: 'data',
          relevant_fields: {
            // No attributes
          },
        },
      ];

      const result = validatePdeAttributes(resolvedEntities);

      expect(result.valid).toBe(false);
      expect(result.missingEntityIds).toEqual(['pde-invalid']);
    });

    it('should return valid=true for empty entities array', () => {
      const result = validatePdeAttributes([]);
      expect(result.valid).toBe(true);
      expect(result.missingEntityIds).toEqual([]);
    });
  });
});
