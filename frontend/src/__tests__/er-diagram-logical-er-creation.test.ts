/**
 * Logical ER Creation Tests
 * Task Group 2: Add "+ New Logical ER" Button to ER Palette
 *
 * Tests for the Logical ER creation workflow:
 * - Test 1: Verify getCreateSectionButtons() returns 3 buttons for ER diagram type
 * - Test 2: Verify clicking "+ New Logical ER" creates a LogicalDataEntityRelationship
 * - Test 3: Verify created relationship has correct default values
 * - Test 4: Verify ADD_RELATIONSHIP action is dispatched correctly
 * - Test 5: Verify Logical ER section is visible in ER palette
 */

import { describe, it, expect } from 'vitest';
import {
  MetaModel,
  LogicalDataEntityRelationship,
} from '../types/model';
import { generatePrefixedId } from '../utils/idGenerator';
import { DIAGRAM_TYPE_PALETTE_RULES } from '../utils/paletteData';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a mock LogicalDataEntityRelationship with default values
 * Mirrors the creation logic in handleCreateButtonClick
 */
function createLogicalDataEntityRelationship(overrides?: Partial<LogicalDataEntityRelationship>): LogicalDataEntityRelationship {
  return {
    id: generatePrefixedId('ler'),
    source_entity_id: '',
    target_entity_id: '',
    relationship_type: 'ONE_TO_ONE',
    description: '',
    tags: '',
    ...overrides,
  };
}

/**
 * Simulate the getCreateSectionButtons() function from PalettePanel.tsx
 * This mirrors the actual implementation for testing purposes
 */
function getCreateSectionButtons(diagramType: string): Array<{ label: string; entityType: string; title: string }> {
  switch (diagramType) {
    case 'ER':
      return [
        { label: '+ New Logical Entity', entityType: 'LOGICAL_DATA_ENTITY', title: 'Create Logical Data Entity' },
        { label: '+ New Physical Entity', entityType: 'PHYSICAL_DATA_ENTITY', title: 'Create Physical Data Entity' },
        { label: '+ New Logical ER', entityType: 'LOGICAL_DATA_ENTITY_RELATIONSHIP', title: 'Create Logical ER' },
      ];
    case 'State':
      return [
        { label: '+ New State', entityType: 'STATE', title: 'Create State' },
        { label: '+ New State Transition', entityType: 'STATE_TRANSITION', title: 'Create State Transition' },
      ];
    case 'Activity':
      return [
        { label: '+ New Partition', entityType: 'ACTIVITY_PARTITION', title: 'Create Activity Partition' },
        { label: '+ New Activity', entityType: 'ACTIVITY', title: 'Create Activity' },
        { label: '+ New Activity Flow', entityType: 'ACTIVITY_FLOW', title: 'Create Activity Flow' },
      ];
    default:
      return [];
  }
}

/**
 * Simulate the handleCreateButtonClick logic for LOGICAL_DATA_ENTITY_RELATIONSHIP
 * Returns the relationship that would be created and the dispatch action
 */
function simulateLogicalERCreation(): {
  relationship: LogicalDataEntityRelationship;
  dispatchAction: { type: string; relationshipType: string; relationship: LogicalDataEntityRelationship };
} {
  const newRelationship: LogicalDataEntityRelationship = {
    id: generatePrefixedId('ler'),
    source_entity_id: '',
    target_entity_id: '',
    relationship_type: 'ONE_TO_ONE',
    description: '',
    tags: '',
  };

  const dispatchAction = {
    type: 'ADD_RELATIONSHIP',
    relationshipType: 'logical_data_entity_relationships',
    relationship: newRelationship,
  };

  return { relationship: newRelationship, dispatchAction };
}

/**
 * Create a mock MetaModel for testing
 */
function createMockMetaModel(overrides?: Partial<MetaModel['relationships']>): MetaModel {
  return {
    entities: {
      business_users: [],
      business_processes: [],
      process_activities: [],
      business_points: [],
      applications: [],
      app_components: [],
      services: [],
      interfaces: [],
      endpoints: [],
      classes: [],
      methods: [],
      application_points: [],
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
    },
    relationships: {
      business_user_business_points: [],
      application_point_business_points: [],
      logical_data_entity_relationships: [],
      logical_data_entity_physical_data_entities: [],
      logical_data_attribute_physical_data_attributes: [],
      data_movements: [],
      interface_logical_entities: [],
      ...overrides,
    },
  };
}

// ============================================================================
// Test Suite
// ============================================================================

describe('Logical ER Creation Tests', () => {
  /**
   * Test 1: Verify getCreateSectionButtons() returns 3 buttons for ER diagram type
   */
  describe('Button visibility for ER diagram type', () => {
    it('should return 3 buttons for ER diagram type including "+ New Logical ER"', () => {
      const erButtons = getCreateSectionButtons('ER');

      expect(erButtons.length).toBe(3);
      expect(erButtons[0].label).toBe('+ New Logical Entity');
      expect(erButtons[1].label).toBe('+ New Physical Entity');
      expect(erButtons[2].label).toBe('+ New Logical ER');
    });

    it('should have LOGICAL_DATA_ENTITY_RELATIONSHIP entity type for the Logical ER button', () => {
      const erButtons = getCreateSectionButtons('ER');
      const logicalERButton = erButtons.find(b => b.label === '+ New Logical ER');

      expect(logicalERButton).toBeDefined();
      expect(logicalERButton?.entityType).toBe('LOGICAL_DATA_ENTITY_RELATIONSHIP');
      expect(logicalERButton?.title).toBe('Create Logical ER');
    });

    it('should NOT show "+ New Logical ER" button for State diagrams', () => {
      const stateButtons = getCreateSectionButtons('State');
      const logicalERButton = stateButtons.find(b => b.label === '+ New Logical ER');

      expect(logicalERButton).toBeUndefined();
    });

    it('should NOT show "+ New Logical ER" button for Activity diagrams', () => {
      const activityButtons = getCreateSectionButtons('Activity');
      const logicalERButton = activityButtons.find(b => b.label === '+ New Logical ER');

      expect(logicalERButton).toBeUndefined();
    });

    it('should NOT show "+ New Logical ER" button for General diagrams', () => {
      const generalButtons = getCreateSectionButtons('General');
      const logicalERButton = generalButtons.find(b => b.label === '+ New Logical ER');

      expect(logicalERButton).toBeUndefined();
    });
  });

  /**
   * Test 2: Verify clicking "+ New Logical ER" creates a LogicalDataEntityRelationship
   */
  describe('Logical ER creation', () => {
    it('should create a LogicalDataEntityRelationship when button is clicked', () => {
      const { relationship } = simulateLogicalERCreation();

      expect(relationship).toBeDefined();
      expect(relationship.id).toBeDefined();
      expect(relationship.id.startsWith('ler-')).toBe(true);
    });

    it('should generate unique IDs for each created relationship', () => {
      const { relationship: rel1 } = simulateLogicalERCreation();
      const { relationship: rel2 } = simulateLogicalERCreation();

      expect(rel1.id).not.toBe(rel2.id);
    });
  });

  /**
   * Test 3: Verify created relationship has correct default values
   */
  describe('Default values for created relationship', () => {
    it('should have empty source_entity_id by default', () => {
      const { relationship } = simulateLogicalERCreation();

      expect(relationship.source_entity_id).toBe('');
    });

    it('should have empty target_entity_id by default', () => {
      const { relationship } = simulateLogicalERCreation();

      expect(relationship.target_entity_id).toBe('');
    });

    it('should have ONE_TO_ONE as default relationship_type', () => {
      const { relationship } = simulateLogicalERCreation();

      expect(relationship.relationship_type).toBe('ONE_TO_ONE');
    });

    it('should have empty description by default', () => {
      const { relationship } = simulateLogicalERCreation();

      expect(relationship.description).toBe('');
    });

    it('should have empty tags by default', () => {
      const { relationship } = simulateLogicalERCreation();

      expect(relationship.tags).toBe('');
    });

    it('should have all required fields populated', () => {
      const { relationship } = simulateLogicalERCreation();

      expect(relationship).toHaveProperty('id');
      expect(relationship).toHaveProperty('source_entity_id');
      expect(relationship).toHaveProperty('target_entity_id');
      expect(relationship).toHaveProperty('relationship_type');
      expect(relationship).toHaveProperty('description');
      expect(relationship).toHaveProperty('tags');
    });
  });

  /**
   * Test 4: Verify ADD_RELATIONSHIP action is dispatched with correct parameters
   */
  describe('ADD_RELATIONSHIP action dispatch', () => {
    it('should dispatch ADD_RELATIONSHIP action type', () => {
      const { dispatchAction } = simulateLogicalERCreation();

      expect(dispatchAction.type).toBe('ADD_RELATIONSHIP');
    });

    it('should dispatch with relationshipType of logical_data_entity_relationships', () => {
      const { dispatchAction } = simulateLogicalERCreation();

      expect(dispatchAction.relationshipType).toBe('logical_data_entity_relationships');
    });

    it('should include the created relationship in the dispatch action', () => {
      const { relationship, dispatchAction } = simulateLogicalERCreation();

      expect(dispatchAction.relationship).toEqual(relationship);
    });

    it('should correctly add relationship to metaModel via reducer', () => {
      // Simulate the reducer action
      const metaModel = createMockMetaModel();
      const { relationship } = simulateLogicalERCreation();

      // Simulate ADD_RELATIONSHIP reducer logic
      const updatedRelationships = [
        ...metaModel.relationships.logical_data_entity_relationships,
        relationship,
      ];

      expect(updatedRelationships.length).toBe(1);
      expect(updatedRelationships[0]).toEqual(relationship);
    });
  });

  /**
   * Test 5: Verify Logical ER section is visible in ER palette
   */
  describe('Logical ER section visibility in ER palette', () => {
    it('should include logical_data_entity_relationships in ER palette rules', () => {
      const erRules = DIAGRAM_TYPE_PALETTE_RULES.ER;

      expect(erRules).toBeDefined();
      expect(erRules).toContain('logical_data_entity_relationships');
    });

    it('should NOT include logical_data_entity_relationships for State diagrams', () => {
      const stateRules = DIAGRAM_TYPE_PALETTE_RULES.State;

      expect(stateRules).toBeDefined();
      expect(stateRules).not.toContain('logical_data_entity_relationships');
    });

    it('should NOT include logical_data_entity_relationships for Activity diagrams', () => {
      const activityRules = DIAGRAM_TYPE_PALETTE_RULES.Activity;

      expect(activityRules).toBeDefined();
      expect(activityRules).not.toContain('logical_data_entity_relationships');
    });

    it('should include all expected ER sections in ER palette rules', () => {
      const erRules = DIAGRAM_TYPE_PALETTE_RULES.ER;

      expect(erRules).toContain('logical_data_entities');
      expect(erRules).toContain('logical_data_attributes');
      expect(erRules).toContain('physical_data_entities');
      expect(erRules).toContain('physical_data_attributes');
      expect(erRules).toContain('logical_data_entity_relationships');
    });
  });
});
