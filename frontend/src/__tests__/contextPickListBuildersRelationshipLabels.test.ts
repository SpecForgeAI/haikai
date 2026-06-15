/**
 * contextPickListBuildersRelationshipLabels.test.ts
 *
 * Spec 2026-01-17: Context Picker UX - Relationship Labels and Stable Chips
 * Task Group 3: Tests for buildRelationshipPickList integration with computeRelationshipLabel
 *
 * Tests:
 * - buildRelationshipPickList uses computeRelationshipLabel when metaModelEntities provided
 * - application_point_business_logics is included in RELATIONSHIP_COLLECTION_KEYS
 * - Relationship rows render computed labels
 * - Apply returns refs with computed labels
 */

import {
  buildRelationshipPickList,
  RELATIONSHIP_COLLECTION_KEYS,
} from '../utils/contextPickListBuilders';
import { DOMAIN_TO_RELATIONSHIP_TYPES, DOMAIN_TO_ENTITY_TYPES } from '../utils/contextPickerDomainMappings';
import type { MetaModelRelationships, MetaModelEntities } from '../types/model';

describe('contextPickListBuilders - Relationship Labels Integration (Task Group 3)', () => {
  describe('RELATIONSHIP_COLLECTION_KEYS', () => {
    it('should include application_point_business_logics as a relationship type', () => {
      expect(RELATIONSHIP_COLLECTION_KEYS).toContain('application_point_business_logics');
    });

    it('should have 9 relationship types (matching MetaModelRelationships)', () => {
      expect(RELATIONSHIP_COLLECTION_KEYS.length).toBe(9);
    });

    it('should include all valid MetaModelRelationships types', () => {
      expect(RELATIONSHIP_COLLECTION_KEYS).toContain('business_user_business_points');
      expect(RELATIONSHIP_COLLECTION_KEYS).toContain('application_point_business_points');
      expect(RELATIONSHIP_COLLECTION_KEYS).toContain('application_point_business_logics');
      expect(RELATIONSHIP_COLLECTION_KEYS).toContain('logical_data_entity_relationships');
      expect(RELATIONSHIP_COLLECTION_KEYS).toContain('logical_data_entity_physical_data_entities');
      expect(RELATIONSHIP_COLLECTION_KEYS).toContain('logical_data_attribute_physical_data_attributes');
      expect(RELATIONSHIP_COLLECTION_KEYS).toContain('interface_logical_entities');
      expect(RELATIONSHIP_COLLECTION_KEYS).toContain('data_movements');
      expect(RELATIONSHIP_COLLECTION_KEYS).toContain('ui_workflow_transitions');
    });

    it('should NOT include interactions (which is an entity type, not relationship type)', () => {
      // 'interactions' is in MetaModelEntities, not MetaModelRelationships
      expect(RELATIONSHIP_COLLECTION_KEYS).not.toContain('interactions');
    });
  });

  describe('DOMAIN_TO_RELATIONSHIP_TYPES', () => {
    it('should include application_point_business_logics in behavioural domain', () => {
      expect(DOMAIN_TO_RELATIONSHIP_TYPES.behavioural).toContain('application_point_business_logics');
    });

    it('should NOT include interactions in relationship mappings (it is an entity)', () => {
      // interactions is an entity type, not a relationship type
      expect(DOMAIN_TO_RELATIONSHIP_TYPES.application).not.toContain('interactions');
    });
  });

  describe('DOMAIN_TO_ENTITY_TYPES', () => {
    it('should include interactions in behavioural domain as an entity type', () => {
      // 'interactions' is an entity type (in MetaModelEntities)
      expect(DOMAIN_TO_ENTITY_TYPES.behavioural).toContain('interactions');
    });
  });

  describe('buildRelationshipPickList with metaModelEntities', () => {
    const mockEntities: MetaModelEntities = {
      business_users: [{ id: 'user-1', name: 'John Doe', description: '', tags: '' }],
      business_points: [{ id: 'bp-1', name: 'Login Process', description: '', kind: 'BUSINESS_PROCESS', business_process_id: 'proc-1', tags: '' }],
      application_points: [{ id: 'ap-1', name: 'Order Service', description: '', kind: 'SERVICE', application_id: 'app-1', point_type: '', tags: '' }],
      business_logics: [{ id: 'bl-1', name: 'Validate Order' }],
      business_processes: [],
      process_activities: [],
      applications: [],
      app_components: [],
      services: [],
      interfaces: [],
      endpoints: [],
      classes: [],
      methods: [],
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
      ui_screens: [],
      ui_components: [],
      ui_actions: [],
      package_sets: [],
      packages: [],
    };

    const mockRelationships: MetaModelRelationships = {
      business_user_business_points: [
        { id: 'rel-1', business_user_id: 'user-1', business_point_id: 'bp-1', description: '', tags: '' },
      ],
      application_point_business_points: [],
      application_point_business_logics: [
        { id: 'rel-2', application_point_id: 'ap-1', business_logic_id: 'bl-1' },
      ],
      logical_data_entity_relationships: [],
      logical_data_entity_physical_data_entities: [],
      logical_data_attribute_physical_data_attributes: [],
      data_movements: [],
      interface_logical_entities: [],
      ui_workflow_transitions: [],
    };

    it('should use computeRelationshipLabel when metaModelEntities is provided', () => {
      const result = buildRelationshipPickList(mockRelationships, mockEntities);

      // Check business_user_business_points label uses computed format
      const bubpOptions = result.business_user_business_points;
      expect(bubpOptions).toHaveLength(1);
      expect(bubpOptions[0].label).toContain('John Doe');
      expect(bubpOptions[0].label).toContain('[BUSINESS_USER]');
      expect(bubpOptions[0].label).toContain('Login Process');
      expect(bubpOptions[0].label).toContain('[BUSINESS_POINT]');
    });

    it('should compute labels for application_point_business_logics', () => {
      const result = buildRelationshipPickList(mockRelationships, mockEntities);

      const apblOptions = result.application_point_business_logics;
      expect(apblOptions).toHaveLength(1);
      expect(apblOptions[0].label).toContain('Order Service');
      expect(apblOptions[0].label).toContain('[APPLICATION_POINT]');
      expect(apblOptions[0].label).toContain('Validate Order');
      expect(apblOptions[0].label).toContain('[BUSINESS_LOGIC]');
    });

    it('should return correct relationship_type for each option', () => {
      const result = buildRelationshipPickList(mockRelationships, mockEntities);

      const bubpOptions = result.business_user_business_points;
      expect(bubpOptions[0].relationship_type).toBe('business_user_business_points');

      const apblOptions = result.application_point_business_logics;
      expect(apblOptions[0].relationship_type).toBe('application_point_business_logics');
    });

    it('should return correct value (relationship id) for each option', () => {
      const result = buildRelationshipPickList(mockRelationships, mockEntities);

      const bubpOptions = result.business_user_business_points;
      expect(bubpOptions[0].value).toBe('rel-1');

      const apblOptions = result.application_point_business_logics;
      expect(apblOptions[0].value).toBe('rel-2');
    });
  });

  describe('buildRelationshipPickList without metaModelEntities (backward compatibility)', () => {
    const mockRelationships: MetaModelRelationships = {
      business_user_business_points: [
        { id: 'rel-1', business_user_id: 'user-1', business_point_id: 'bp-1', description: 'Test description', tags: '' },
      ],
      application_point_business_points: [],
      application_point_business_logics: [],
      logical_data_entity_relationships: [],
      logical_data_entity_physical_data_entities: [],
      logical_data_attribute_physical_data_attributes: [],
      data_movements: [],
      interface_logical_entities: [],
      ui_workflow_transitions: [],
    };

    it('should fall back to description-based label when metaModelEntities not provided', () => {
      const result = buildRelationshipPickList(mockRelationships);

      const bubpOptions = result.business_user_business_points;
      expect(bubpOptions).toHaveLength(1);
      // Should use fallback which uses description
      expect(bubpOptions[0].label).toBe('Test description');
    });

    it('should return "Unknown Relationship" when no name or description available', () => {
      const emptyRelationships: MetaModelRelationships = {
        business_user_business_points: [
          { id: 'rel-x', business_user_id: 'u', business_point_id: 'b', description: '', tags: '' },
        ],
        application_point_business_points: [],
        application_point_business_logics: [],
        logical_data_entity_relationships: [],
        logical_data_entity_physical_data_entities: [],
        logical_data_attribute_physical_data_attributes: [],
        data_movements: [],
        interface_logical_entities: [],
        ui_workflow_transitions: [],
      };

      const result = buildRelationshipPickList(emptyRelationships);
      expect(result.business_user_business_points[0].label).toBe('Unknown Relationship');
    });
  });
});
