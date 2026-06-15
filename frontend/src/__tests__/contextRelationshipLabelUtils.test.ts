/**
 * contextRelationshipLabelUtils.test.ts
 *
 * Spec 2026-01-17: Context Picker UX - Relationship Labels and Stable Chips
 * Task Group 2: Tests for relationship label computation utilities
 *
 * Tests:
 * - computeRelationshipLabel() for various relationship types
 * - RELATIONSHIP_TYPE_DISPLAY_LABELS mapping for all 9 relationship types
 * - Handling of optional participants
 * - Fallback to "Unknown [TYPE]" for unresolvable participants
 */

import {
  computeRelationshipLabel,
  RELATIONSHIP_TYPE_DISPLAY_LABELS,
  RELATIONSHIP_PARTICIPANT_CONFIGS,
  type EntityLookup,
} from '../utils/contextRelationshipLabelUtils';

describe('contextRelationshipLabelUtils - Task Group 2', () => {
  // Helper to create a mock entity lookup function
  const createEntityLookup = (entities: Record<string, { name: string; type: string }>): EntityLookup => {
    return (entityId: string) => {
      const entity = entities[entityId];
      return entity ? entity.name : null;
    };
  };

  describe('RELATIONSHIP_TYPE_DISPLAY_LABELS', () => {
    it('should have human-friendly labels for all 9 relationship types', () => {
      expect(Object.keys(RELATIONSHIP_TYPE_DISPLAY_LABELS)).toHaveLength(9);
    });

    it('should return correct label for business_user_business_points', () => {
      expect(RELATIONSHIP_TYPE_DISPLAY_LABELS.business_user_business_points).toBe('User <-> Business Point');
    });

    it('should return correct label for application_point_business_points', () => {
      expect(RELATIONSHIP_TYPE_DISPLAY_LABELS.application_point_business_points).toBe('App Point <-> Business Point');
    });

    it('should return correct label for interactions', () => {
      expect(RELATIONSHIP_TYPE_DISPLAY_LABELS.interactions).toBe('Interactions');
    });

    it('should return correct label for logical_data_entity_relationships', () => {
      expect(RELATIONSHIP_TYPE_DISPLAY_LABELS.logical_data_entity_relationships).toBe('Data Entity Relationships');
    });

    it('should return correct label for logical_data_entity_physical_data_entities', () => {
      expect(RELATIONSHIP_TYPE_DISPLAY_LABELS.logical_data_entity_physical_data_entities).toBe('Logical <-> Physical Entity');
    });

    it('should return correct label for logical_data_attribute_physical_data_attributes', () => {
      expect(RELATIONSHIP_TYPE_DISPLAY_LABELS.logical_data_attribute_physical_data_attributes).toBe('Logical <-> Physical Attribute');
    });

    it('should return correct label for interface_logical_entities', () => {
      expect(RELATIONSHIP_TYPE_DISPLAY_LABELS.interface_logical_entities).toBe('Interface <-> Entity');
    });

    it('should return correct label for data_movements', () => {
      expect(RELATIONSHIP_TYPE_DISPLAY_LABELS.data_movements).toBe('Data Movements');
    });

    it('should return correct label for application_point_business_logics', () => {
      expect(RELATIONSHIP_TYPE_DISPLAY_LABELS.application_point_business_logics).toBe('App Point <-> Business Logic');
    });
  });

  describe('RELATIONSHIP_PARTICIPANT_CONFIGS', () => {
    it('should have configurations for all 9 relationship types', () => {
      expect(Object.keys(RELATIONSHIP_PARTICIPANT_CONFIGS)).toHaveLength(9);
    });

    it('should have correct config for business_user_business_points', () => {
      const config = RELATIONSHIP_PARTICIPANT_CONFIGS.business_user_business_points;
      expect(config.participants).toHaveLength(2);
      expect(config.participants[0].idField).toBe('business_user_id');
      expect(config.participants[1].idField).toBe('business_point_id');
    });
  });

  describe('computeRelationshipLabel()', () => {
    it('should return correctly formatted label for business_user_business_points', () => {
      const relationship = {
        id: 'rel-1',
        business_user_id: 'user-1',
        business_point_id: 'bp-1',
      };

      const entityLookup = createEntityLookup({
        'user-1': { name: 'John Doe', type: 'business_users' },
        'bp-1': { name: 'Login Process', type: 'business_points' },
      });

      const label = computeRelationshipLabel(
        relationship,
        'business_user_business_points',
        entityLookup
      );

      expect(label).toBe('John Doe [BUSINESS_USER] | Login Process [BUSINESS_POINT]');
    });

    it('should return correctly formatted label for application_point_business_points', () => {
      const relationship = {
        id: 'rel-2',
        application_point_id: 'ap-1',
        business_point_id: 'bp-1',
      };

      const entityLookup = createEntityLookup({
        'ap-1': { name: 'Order Service', type: 'application_points' },
        'bp-1': { name: 'Submit Order', type: 'business_points' },
      });

      const label = computeRelationshipLabel(
        relationship,
        'application_point_business_points',
        entityLookup
      );

      expect(label).toBe('Order Service [APPLICATION_POINT] | Submit Order [BUSINESS_POINT]');
    });

    it('should handle optional participants for interactions (all present)', () => {
      const relationship = {
        id: 'rel-3',
        user_id: 'user-1',
        primary_app_business_point_id: 'abp-1',
        secondary_app_business_point_id: 'abp-2',
      };

      const entityLookup = createEntityLookup({
        'user-1': { name: 'Admin User', type: 'business_users' },
        'abp-1': { name: 'Primary App', type: 'app_business_points' },
        'abp-2': { name: 'Secondary App', type: 'app_business_points' },
      });

      const label = computeRelationshipLabel(
        relationship,
        'interactions',
        entityLookup
      );

      expect(label).toBe('Admin User [BUSINESS_USER] | Primary App [APP_BUSINESS_POINT] | Secondary App [APP_BUSINESS_POINT]');
    });

    it('should omit missing optional participants for interactions', () => {
      const relationship = {
        id: 'rel-4',
        user_id: 'user-1',
        primary_app_business_point_id: 'abp-1',
        // secondary_app_business_point_id is missing
      };

      const entityLookup = createEntityLookup({
        'user-1': { name: 'Admin User', type: 'business_users' },
        'abp-1': { name: 'Primary App', type: 'app_business_points' },
      });

      const label = computeRelationshipLabel(
        relationship,
        'interactions',
        entityLookup
      );

      expect(label).toBe('Admin User [BUSINESS_USER] | Primary App [APP_BUSINESS_POINT]');
    });

    it('should return "Unknown [TYPE]" for unresolvable participant', () => {
      const relationship = {
        id: 'rel-5',
        business_user_id: 'unknown-user',
        business_point_id: 'bp-1',
      };

      const entityLookup = createEntityLookup({
        // user-unknown is NOT in lookup
        'bp-1': { name: 'Login Process', type: 'business_points' },
      });

      const label = computeRelationshipLabel(
        relationship,
        'business_user_business_points',
        entityLookup
      );

      expect(label).toBe('Unknown [BUSINESS_USER] | Login Process [BUSINESS_POINT]');
    });

    it('should handle data_movements with all 4 participants', () => {
      const relationship = {
        id: 'rel-6',
        source_application_point_id: 'ap-src',
        target_application_point_id: 'ap-tgt',
        dataEntityPointId: 'dep_log_entity-1',
        interfaceWithSchemaId: 'iface-1',
      };

      const entityLookup = createEntityLookup({
        'ap-src': { name: 'Source API', type: 'application_points' },
        'ap-tgt': { name: 'Target API', type: 'application_points' },
        'dep_log_entity-1': { name: 'Customer Entity', type: 'data_entity_points' },
        'iface-1': { name: 'REST API', type: 'interfaces' },
      });

      const label = computeRelationshipLabel(
        relationship,
        'data_movements',
        entityLookup
      );

      expect(label).toContain('Source API');
      expect(label).toContain('Target API');
    });

    it('should handle logical_data_entity_physical_data_entities correctly', () => {
      const relationship = {
        id: 'rel-7',
        logical_entity_id: 'lde-1',
        physical_entity_id: 'pde-1',
      };

      const entityLookup = createEntityLookup({
        'lde-1': { name: 'Customer', type: 'logical_data_entities' },
        'pde-1': { name: 'customers_table', type: 'physical_data_entities' },
      });

      const label = computeRelationshipLabel(
        relationship,
        'logical_data_entity_physical_data_entities',
        entityLookup
      );

      expect(label).toBe('Customer [LOGICAL_DATA_ENTITY] | customers_table [PHYSICAL_DATA_ENTITY]');
    });

    it('should handle interface_logical_entities with data entity point', () => {
      const relationship = {
        id: 'rel-8',
        interface_id: 'iface-1',
        dataEntityPointId: 'dep_log_entity-1',
      };

      const entityLookup = createEntityLookup({
        'iface-1': { name: 'Customer API', type: 'interfaces' },
        'dep_log_entity-1': { name: 'Customer Entity', type: 'data_entity_points' },
      });

      const label = computeRelationshipLabel(
        relationship,
        'interface_logical_entities',
        entityLookup
      );

      expect(label).toContain('Customer API');
      expect(label).toContain('[INTERFACE]');
    });

    it('should handle application_point_business_logics correctly', () => {
      const relationship = {
        id: 'rel-9',
        application_point_id: 'ap-1',
        business_logic_id: 'bl-1',
      };

      const entityLookup = createEntityLookup({
        'ap-1': { name: 'Order Service', type: 'application_points' },
        'bl-1': { name: 'Validate Order Total', type: 'business_logics' },
      });

      const label = computeRelationshipLabel(
        relationship,
        'application_point_business_logics',
        entityLookup
      );

      expect(label).toBe('Order Service [APPLICATION_POINT] | Validate Order Total [BUSINESS_LOGIC]');
    });

    it('should return fallback label for unknown relationship type', () => {
      const relationship = {
        id: 'rel-unknown',
      };

      const entityLookup = createEntityLookup({});

      const label = computeRelationshipLabel(
        relationship,
        'unknown_relationship_type',
        entityLookup
      );

      expect(label).toBe('Unknown Relationship');
    });
  });
});
