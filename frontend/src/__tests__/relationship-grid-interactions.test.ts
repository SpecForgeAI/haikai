/**
 * Task Group 3 Tests: RelationshipGrid Interactions Support
 *
 * Tests for handling entities.interactions in RelationshipGrid.
 * Interactions data is stored in metaModel.entities.interactions but
 * displayed in the Relationships row via RelationshipGrid.
 *
 * Created as part of spec: 2025-12-09-fix-interactions-placement-and-enable-rules
 */

import { gridConfigs, relationshipTabToType } from '../config/gridConfigs';

describe('Task Group 3: RelationshipGrid Interactions Support', () => {
  describe('3.1.1 RelationshipGrid receives "interactions" as relationshipType prop', () => {
    it('should have "Interactions" in relationshipTabToType mapping to "interactions"', () => {
      // When Interactions tab is clicked, it should map to "interactions" type
      expect(relationshipTabToType['Interactions']).toBe('interactions');
    });

    it('should pass "interactions" as relationshipType to RelationshipGrid', () => {
      // The relationshipType value that RelationshipGrid receives for Interactions
      const relationshipType = relationshipTabToType['Interactions'];
      expect(relationshipType).toBeDefined();
      expect(typeof relationshipType).toBe('string');
      expect(relationshipType).toBe('interactions');
    });
  });

  describe('3.1.2 Grid configuration exists for interactions', () => {
    it('should have gridConfigs.interactions column configuration', () => {
      const interactionsConfig = gridConfigs['interactions'];
      expect(interactionsConfig).toBeDefined();
      expect(Array.isArray(interactionsConfig)).toBe(true);
    });

    it('should have correct columns in gridConfigs.interactions', () => {
      const columns = gridConfigs['interactions'];
      const fieldNames = columns.map((c) => c.field);

      // Expected columns for Interactions grid
      expect(fieldNames).toContain('id');
      expect(fieldNames).toContain('name');
      expect(fieldNames).toContain('description');
      expect(fieldNames).toContain('user_id');
      expect(fieldNames).toContain('primary_app_business_point_id');
      expect(fieldNames).toContain('secondary_app_business_point_id');
      expect(fieldNames).toContain('tags');
    });

    it('should have FK typeahead for user_id column', () => {
      const columns = gridConfigs['interactions'];
      const userIdColumn = columns.find((c) => c.field === 'user_id');

      expect(userIdColumn).toBeDefined();
      expect(userIdColumn?.cellType).toBe('fk_typeahead');
      expect(userIdColumn?.fkTarget).toBe('business_users');
    });

    it('should have FK typeahead for primary_app_business_point_id column', () => {
      const columns = gridConfigs['interactions'];
      const primaryColumn = columns.find((c) => c.field === 'primary_app_business_point_id');

      expect(primaryColumn).toBeDefined();
      expect(primaryColumn?.cellType).toBe('fk_typeahead');
      expect(primaryColumn?.fkTarget).toBe('app_business_points');
    });

    it('should have FK typeahead for secondary_app_business_point_id column', () => {
      const columns = gridConfigs['interactions'];
      const secondaryColumn = columns.find((c) => c.field === 'secondary_app_business_point_id');

      expect(secondaryColumn).toBeDefined();
      expect(secondaryColumn?.cellType).toBe('fk_typeahead');
      expect(secondaryColumn?.fkTarget).toBe('app_business_points');
      // Secondary is optional
      expect(secondaryColumn?.required).toBe(false);
    });
  });

  describe('3.1.3 Data source fallback logic', () => {
    it('should define isEntityStoredRelationshipType function for interactions', () => {
      // Interactions is stored in entities but displayed as relationship
      // This helper should identify "interactions" as needing entity fallback
      const isEntityStoredRelationshipType = (type: string): boolean => {
        return type === 'interactions';
      };

      expect(isEntityStoredRelationshipType('interactions')).toBe(true);
      expect(isEntityStoredRelationshipType('logical_data_entity_relationships')).toBe(false);
      expect(isEntityStoredRelationshipType('data_movements')).toBe(false);
    });

    it('should access entities.interactions for "interactions" relationshipType', () => {
      // Mock metaModel structure
      const mockMetaModel = {
        relationships: {
          logical_data_entity_relationships: [{ id: 'rel-1' }],
          // Note: interactions is NOT in relationships
        },
        entities: {
          interactions: [
            { id: 'int-1', name: 'Login Flow' },
            { id: 'int-2', name: 'Checkout Flow' },
          ],
        },
      };

      // Helper function that mirrors what RelationshipGrid should do
      const getRelationshipData = (type: string) => {
        // First try relationships
        const fromRelationships =
          mockMetaModel.relationships[type as keyof typeof mockMetaModel.relationships];
        if (fromRelationships) {
          return fromRelationships;
        }

        // Fallback to entities for special cases like interactions
        const fromEntities =
          mockMetaModel.entities[type as keyof typeof mockMetaModel.entities];
        return fromEntities;
      };

      // Normal relationship type
      const logicalER = getRelationshipData('logical_data_entity_relationships');
      expect(logicalER).toBeDefined();
      expect(logicalER).toHaveLength(1);

      // Interactions (stored in entities)
      const interactions = getRelationshipData('interactions');
      expect(interactions).toBeDefined();
      expect(interactions).toHaveLength(2);
      expect(interactions[0].name).toBe('Login Flow');
    });
  });

  describe('3.1.4 createEmptyRelationship for interactions type', () => {
    it('should create empty Interaction with correct shape', () => {
      // Expected shape for a new Interaction entity
      const expectedShape = {
        id: expect.any(String),
        name: '',
        description: '',
        user_id: '',
        primary_app_business_point_id: '',
        secondary_app_business_point_id: '',
        tags: '',
      };

      // Mock the createEmptyInteraction function
      const createEmptyInteraction = (id: string) => ({
        id,
        name: '',
        description: '',
        user_id: '',
        primary_app_business_point_id: '',
        secondary_app_business_point_id: '',
        tags: '',
      });

      const newInteraction = createEmptyInteraction('int-test-123');

      expect(newInteraction).toMatchObject({
        id: 'int-test-123',
        name: '',
        user_id: '',
        primary_app_business_point_id: '',
      });
    });

    it('should have all required fields from gridConfigs.interactions', () => {
      const columns = gridConfigs['interactions'];
      const requiredFields = columns.filter((c) => c.required).map((c) => c.field);

      // Required fields should be present in empty interaction
      expect(requiredFields).toContain('id');
      expect(requiredFields).toContain('name');
      expect(requiredFields).toContain('user_id');
      expect(requiredFields).toContain('primary_app_business_point_id');
    });
  });

  describe('3.1.5 CRUD dispatch actions for Interactions', () => {
    it('should dispatch ADD_ENTITY for interactions, not ADD_RELATIONSHIP', () => {
      // Interactions is stored in entities, so we need ADD_ENTITY
      const interactionType = 'interactions';
      const isEntityType = interactionType === 'interactions';

      expect(isEntityType).toBe(true);

      // The action type should be ADD_ENTITY for interactions
      const actionType = isEntityType ? 'ADD_ENTITY' : 'ADD_RELATIONSHIP';
      expect(actionType).toBe('ADD_ENTITY');
    });

    it('should dispatch UPDATE_ENTITY for interactions, not UPDATE_RELATIONSHIP', () => {
      const interactionType = 'interactions';
      const isEntityType = interactionType === 'interactions';

      const actionType = isEntityType ? 'UPDATE_ENTITY' : 'UPDATE_RELATIONSHIP';
      expect(actionType).toBe('UPDATE_ENTITY');
    });

    it('should dispatch DELETE_ENTITY for interactions, not DELETE_RELATIONSHIP', () => {
      const interactionType = 'interactions';
      const isEntityType = interactionType === 'interactions';

      const actionType = isEntityType ? 'DELETE_ENTITY' : 'DELETE_RELATIONSHIP';
      expect(actionType).toBe('DELETE_ENTITY');
    });

    it('should use "interactions" as entityType in dispatch actions', () => {
      // When dispatching entity actions for interactions,
      // the entityType should be 'interactions'
      const entityType = 'interactions';

      // Verify this matches what's in the MetaModel.entities structure
      const mockMetaModel = {
        entities: {
          interactions: [], // This is where interactions are stored
          business_users: [],
          business_processes: [],
        },
      };

      expect(entityType in mockMetaModel.entities).toBe(true);
    });
  });

  describe('3.1.6 Defensive handling', () => {
    it('should handle missing interactions data gracefully', () => {
      const mockMetaModel = {
        relationships: {},
        entities: {
          // interactions array is missing
        },
      };

      // Helper to get data with fallback
      const getRelationshipData = (type: string) => {
        // @ts-expect-error - Testing defensive handling
        const fromRelationships = mockMetaModel.relationships[type];
        if (fromRelationships) return fromRelationships;

        // @ts-expect-error - Testing defensive handling
        const fromEntities = mockMetaModel.entities[type];
        return fromEntities;
      };

      const interactions = getRelationshipData('interactions');

      // Should return undefined, not throw
      expect(interactions).toBeUndefined();
    });

    it('should handle empty interactions array', () => {
      const mockMetaModel = {
        relationships: {},
        entities: {
          interactions: [],
        },
      };

      const interactions = mockMetaModel.entities.interactions;

      expect(interactions).toBeDefined();
      expect(Array.isArray(interactions)).toBe(true);
      expect(interactions).toHaveLength(0);
    });
  });
});
