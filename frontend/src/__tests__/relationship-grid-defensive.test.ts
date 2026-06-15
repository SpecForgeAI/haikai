/**
 * Tests for RelationshipGrid defensive handling
 *
 * These tests verify that the defensive handling logic:
 * 1. gridConfigs lookup returns undefined for invalid types
 * 2. relationships lookup returns undefined for missing data
 * 3. Valid configuration exists for actual relationship types
 */

import { describe, it, expect } from 'vitest';
import { gridConfigs, relationshipTabToType } from '../config/gridConfigs';
import { MetaModelRelationships, RelationshipType } from '../types/model';

describe('RelationshipGrid defensive handling', () => {
  describe('Task 3.1: Configuration validation', () => {
    it('gridConfigs returns undefined for invalid relationship types', () => {
      // Invalid types should not have configuration
      expect(gridConfigs['invalid_relationship_type']).toBeUndefined();
      expect(gridConfigs['interactions']).toBeDefined(); // But this has config (for entity)
      expect(gridConfigs['some_random_type']).toBeUndefined();
    });

    it('all relationshipTabToType entries have corresponding gridConfigs', () => {
      // Every relationship tab should have a grid configuration
      for (const [tabName, relationshipType] of Object.entries(relationshipTabToType)) {
        expect(
          gridConfigs[relationshipType],
          `Missing gridConfig for relationship type "${relationshipType}" (tab: "${tabName}")`
        ).toBeDefined();
      }
    });

    it('gridConfigs for relationship types have required columns', () => {
      // Verify each relationship grid config has at least id column
      for (const relationshipType of Object.values(relationshipTabToType)) {
        const config = gridConfigs[relationshipType];
        expect(config.length).toBeGreaterThan(0);
        expect(config.find(col => col.field === 'id')).toBeDefined();
      }
    });
  });

  describe('Task 3.2: Relationship data structure validation', () => {
    it('valid RelationshipType keys match relationshipTabToType values', () => {
      // The relationship registry has grown well beyond the original 7 types
      // (infrastructure, libraries, user journeys, interactions, ...). Assert
      // the original core types are still registered rather than pinning the
      // full list.
      const coreTypes: RelationshipType[] = [
        'business_user_business_points',
        'application_point_business_points',
        'logical_data_entity_relationships',
        'logical_data_entity_physical_data_entities',
        'logical_data_attribute_physical_data_attributes',
        'interface_logical_entities',
        'data_movements',
      ];

      const actualTypes = Object.values(relationshipTabToType);

      for (const coreType of coreTypes) {
        expect(actualTypes).toContain(coreType);
      }
    });

    it('interactions IS in relationshipTabToType values', () => {
      // Interactions IS a relationship tab (spec:
      // 2025-12-09-fix-interactions-double-rendering-and-abp-mapping moved it
      // out of the entity path and into RelationshipGrid).
      const relationshipTypes = Object.values(relationshipTabToType);
      expect(relationshipTypes).toContain('interactions');
    });
  });

  describe('Task 3.3: Empty relationships handling', () => {
    it('empty relationships arrays are valid (not undefined)', () => {
      // Create a minimal relationships object
      const relationships: MetaModelRelationships = {
        business_user_business_points: [],
        application_point_business_points: [],
        logical_data_entity_relationships: [],
        logical_data_entity_physical_data_entities: [],
        logical_data_attribute_physical_data_attributes: [],
        interface_logical_entities: [],
        data_movements: [],
      };

      // All relationship types should return empty arrays, not undefined
      for (const key of Object.keys(relationships) as RelationshipType[]) {
        expect(relationships[key]).toBeDefined();
        expect(Array.isArray(relationships[key])).toBe(true);
      }
    });
  });
});
