/**
 * buildRelationshipPickList.test.ts
 *
 * Spec 2026-01-17: Context Picker Modal UI Improvements
 * Task Group 2: Tests for relationship pick list builder
 *
 * Tests:
 * 1. Function returns grouped relationships by relationship type key
 * 2. Labels are extracted from relationship name field with fallback
 * 3. Empty metaModel.relationships returns empty object
 * 4. Function handles missing relationship collections gracefully
 */

import { describe, it, expect } from 'vitest';
import {
  buildRelationshipPickList,
  RELATIONSHIP_COLLECTION_KEYS,
  type RelationshipPickOption,
} from '../utils/contextPickListBuilders';
import type { MetaModelRelationships } from '../types/model';

describe('Task Group 2: buildRelationshipPickList', () => {
  describe('function returns grouped relationships by relationship type key', () => {
    it('groups relationships by their collection key', () => {
      const mockRelationships: MetaModelRelationships = {
        business_user_business_points: [
          { id: 'bubp-1', business_user_id: 'bu-1', business_point_id: 'bp-1', description: 'User to BP', tags: '' },
        ],
        application_point_business_points: [
          { id: 'apbp-1', application_point_id: 'ap-1', business_point_id: 'bp-1', description: 'AP to BP', tags: '' },
        ],
        application_point_business_logics: [],
        interface_logical_entities: [],
        logical_data_entity_relationships: [
          { id: 'lder-1', fromDataEntityPointId: 'dep-1', toDataEntityPointId: 'dep-2', description: 'Entity Rel', tags: '' },
          { id: 'lder-2', fromDataEntityPointId: 'dep-3', toDataEntityPointId: 'dep-4', description: 'Another Rel', tags: '' },
        ],
        logical_data_entity_physical_data_entities: [],
        logical_data_attribute_physical_data_attributes: [],
        data_movements: [
          { id: 'dm-1', source_application_point_id: 'ap-1', target_application_point_id: 'ap-2', movement_type: 'API', description: 'Data Move', tags: '' },
        ],
        ui_workflow_transitions: [],
      };

      const result = buildRelationshipPickList(mockRelationships);

      // Check that groups are created
      expect(result['business_user_business_points']).toHaveLength(1);
      expect(result['application_point_business_points']).toHaveLength(1);
      expect(result['logical_data_entity_relationships']).toHaveLength(2);
      expect(result['data_movements']).toHaveLength(1);

      // Check structure of relationship option
      const buOption = result['business_user_business_points'][0];
      expect(buOption.value).toBe('bubp-1');
      expect(buOption.relationship_type).toBe('business_user_business_points');
    });
  });

  describe('labels are extracted from relationship name field with fallback', () => {
    it('extracts name field when present', () => {
      const mockRelationships: MetaModelRelationships = {
        business_user_business_points: [],
        application_point_business_points: [],
        application_point_business_logics: [],
        interface_logical_entities: [],
        logical_data_entity_relationships: [],
        logical_data_entity_physical_data_entities: [],
        logical_data_attribute_physical_data_attributes: [],
        data_movements: [],
        ui_workflow_transitions: [
          { id: 'uwt-1', name: 'Login to Dashboard', source_screen_id: 's1', target_screen_id: 's2' },
        ],
      };

      const result = buildRelationshipPickList(mockRelationships);

      expect(result['ui_workflow_transitions'][0].label).toBe('Login to Dashboard');
    });

    it('falls back to description when name is not present', () => {
      const mockRelationships: MetaModelRelationships = {
        business_user_business_points: [
          { id: 'bubp-1', business_user_id: 'bu-1', business_point_id: 'bp-1', description: 'User can access business process', tags: '' },
        ],
        application_point_business_points: [],
        application_point_business_logics: [],
        interface_logical_entities: [],
        logical_data_entity_relationships: [],
        logical_data_entity_physical_data_entities: [],
        logical_data_attribute_physical_data_attributes: [],
        data_movements: [],
        ui_workflow_transitions: [],
      };

      const result = buildRelationshipPickList(mockRelationships);

      expect(result['business_user_business_points'][0].label).toBe('User can access business process');
    });

    it('falls back to "Unknown Relationship" when no name or description', () => {
      const mockRelationships: MetaModelRelationships = {
        business_user_business_points: [],
        application_point_business_points: [],
        application_point_business_logics: [],
        interface_logical_entities: [],
        logical_data_entity_relationships: [],
        logical_data_entity_physical_data_entities: [],
        logical_data_attribute_physical_data_attributes: [],
        data_movements: [
          { id: 'dm-123', source_application_point_id: 'ap-1', target_application_point_id: 'ap-2', movement_type: 'API', description: '', tags: '' },
        ],
        ui_workflow_transitions: [],
      };

      const result = buildRelationshipPickList(mockRelationships);

      // Per spec the fallback label is "Unknown Relationship" -- never raw
      // type+id strings.
      expect(result['data_movements'][0].label).toBe('Unknown Relationship');
    });
  });

  describe('empty metaModel.relationships returns empty object', () => {
    it('returns empty arrays for all relationship types when input is null', () => {
      const result = buildRelationshipPickList(null as unknown as MetaModelRelationships);

      RELATIONSHIP_COLLECTION_KEYS.forEach((key) => {
        expect(result[key]).toBeDefined();
        expect(Array.isArray(result[key])).toBe(true);
        expect(result[key]).toHaveLength(0);
      });
    });

    it('returns empty arrays for all relationship types when input is undefined', () => {
      const result = buildRelationshipPickList(undefined as unknown as MetaModelRelationships);

      RELATIONSHIP_COLLECTION_KEYS.forEach((key) => {
        expect(result[key]).toBeDefined();
        expect(Array.isArray(result[key])).toBe(true);
        expect(result[key]).toHaveLength(0);
      });
    });
  });

  describe('function handles missing relationship collections gracefully', () => {
    it('returns empty array for missing collections', () => {
      // Partial relationships object with only some collections
      const partialRelationships = {
        business_user_business_points: [
          { id: 'bubp-1', business_user_id: 'bu-1', business_point_id: 'bp-1', description: 'Test', tags: '' },
        ],
        // Missing other collections
      } as unknown as MetaModelRelationships;

      const result = buildRelationshipPickList(partialRelationships);

      // Present collection should have data
      expect(result['business_user_business_points']).toHaveLength(1);

      // Missing collections should be empty arrays
      expect(result['application_point_business_points']).toHaveLength(0);
      expect(result['data_movements']).toHaveLength(0);
      expect(result['ui_workflow_transitions']).toHaveLength(0);
    });

    it('handles collection that is not an array', () => {
      const invalidRelationships = {
        business_user_business_points: 'not an array',
        application_point_business_points: [],
        application_point_business_logics: [],
        interface_logical_entities: [],
        logical_data_entity_relationships: [],
        logical_data_entity_physical_data_entities: [],
        logical_data_attribute_physical_data_attributes: [],
        data_movements: [],
        ui_workflow_transitions: [],
      } as unknown as MetaModelRelationships;

      const result = buildRelationshipPickList(invalidRelationships);

      expect(result['business_user_business_points']).toHaveLength(0);
    });
  });
});
