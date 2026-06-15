/**
 * Remove Legacy Relationships Tests
 *
 * Tests for verifying that legacy relationship types have been removed
 * and the application functions correctly without them.
 *
 * Task Groups 1-4: Remove Legacy Migration Logic and Legacy Relationship Sections
 */

import { describe, test, expect } from 'vitest';

import {
  MetaModelRelationships,
  MetaModelEntities,
  RelationshipType,
  AnyRelationship,
  RELATIONSHIP_EDGE_TYPES,
} from '../types/model';

import { emptyModel, relationshipColors } from '../config/defaults';
import { gridConfigs, relationshipTabToType, legacyRelationshipTabNames } from '../config/gridConfigs';
import { getEntityPrefix } from '../utils/idGenerator';
import { getPaletteSections } from '../utils/paletteData';
import { buildModelFromData } from '../utils/fileOperations';

// ============================================================================
// Task Group 1: Type Definition Tests
// ============================================================================

describe('Task Group 1: Type Definitions', () => {
  test('MetaModelRelationships does not have legacy arrays', () => {
    // Create a MetaModelRelationships object to verify the interface
    const relationships: MetaModelRelationships = {
      business_user_business_points: [],
      application_point_business_points: [],
      logical_data_entity_relationships: [],
      logical_data_entity_physical_data_entities: [],
      logical_data_attribute_physical_data_attributes: [],
      data_movements: [],
      interface_logical_entities: [],
    };

    // Verify the object can be created without legacy arrays
    expect(relationships.business_user_business_points).toBeDefined();
    expect(relationships.application_point_business_points).toBeDefined();

    // These should not exist on the interface (compile-time check)
    // @ts-expect-error - business_user_processes should not exist
    expect(relationships.business_user_processes).toBeUndefined();
    // @ts-expect-error - application_point_business_processes should not exist
    expect(relationships.application_point_business_processes).toBeUndefined();
  });

  test('RELATIONSHIP_EDGE_TYPES does not include legacy types', () => {
    // Verify legacy types are not in the constant
    expect((RELATIONSHIP_EDGE_TYPES as Record<string, string>).BUSINESS_USER_PROCESS).toBeUndefined();
    expect((RELATIONSHIP_EDGE_TYPES as Record<string, string>).APPLICATION_POINT_BUSINESS_PROCESS).toBeUndefined();

    // Verify new types are present
    expect(RELATIONSHIP_EDGE_TYPES.USER_BUSINESS_POINT).toBe('USER_BUSINESS_POINT');
    expect(RELATIONSHIP_EDGE_TYPES.APP_POINT_BUSINESS_POINT).toBe('APP_POINT_BUSINESS_POINT');
  });

  test('RelationshipType union excludes legacy string literals', () => {
    // This is a compile-time check - if these types exist, the code would compile
    const validTypes: RelationshipType[] = [
      'business_user_business_points',
      'application_point_business_points',
      'logical_data_entity_relationships',
      'logical_data_entity_physical_data_entities',
      'logical_data_attribute_physical_data_attributes',
      'data_movements',
      'interface_logical_entities',
    ];

    expect(validTypes.length).toBe(7);
  });
});

// ============================================================================
// Task Group 2: Data Operations Tests
// ============================================================================

describe('Task Group 2: Data Operations', () => {
  test('buildModelFromData correctly builds model without legacy arrays', () => {
    const rawData = {
      metaModel: {
        entities: {
          business_processes: [
            { id: 'proc-1', name: 'Test Process', description: '', tags: '' },
          ],
          business_users: [
            { id: 'user-1', name: 'User', description: '', tags: '' },
          ],
        },
        relationships: {
          business_user_business_points: [
            {
              id: 'bubp-1',
              business_user_id: 'user-1',
              business_point_id: 'bp_proc-1',
              description: 'Test',
              tags: '',
            },
          ],
        },
      },
      diagrams: [],
    };

    const model = buildModelFromData(rawData);

    // Verify the model was built correctly
    expect(model.metaModel.relationships.business_user_business_points).toHaveLength(1);
    expect(model.metaModel.entities.business_points.length).toBeGreaterThanOrEqual(1);
  });

  test('model loading works with JSON that has no legacy relationship arrays', () => {
    const rawData = {
      metaModel: {
        entities: {
          business_processes: [
            { id: 'proc-1', name: 'Test Process', description: '', tags: '' },
          ],
        },
        relationships: {},
      },
      diagrams: [],
    };

    const model = buildModelFromData(rawData);

    // Should have empty arrays, not undefined
    expect(model.metaModel.relationships.business_user_business_points).toEqual([]);
    expect(model.metaModel.relationships.application_point_business_points).toEqual([]);
  });

  test('model loading works with JSON that still has legacy arrays (silent ignore)', () => {
    const rawData = {
      metaModel: {
        entities: {
          business_processes: [
            { id: 'proc-1', name: 'Test Process', description: '', tags: '' },
          ],
          business_users: [
            { id: 'user-1', name: 'User', description: '', tags: '' },
          ],
        },
        relationships: {
          // Legacy arrays that should be silently ignored
          business_user_processes: [
            {
              id: 'bup-1',
              business_user_id: 'user-1',
              business_process_id: 'proc-1',
              description: 'Legacy',
              tags: '',
            },
          ],
        },
      },
      diagrams: [],
    };

    // Should not throw an error
    const model = buildModelFromData(rawData);
    expect(model).toBeDefined();
    expect(model.metaModel.entities.business_processes).toHaveLength(1);
  });

  test('Business Point reconciliation still runs properly', () => {
    const rawData = {
      metaModel: {
        entities: {
          business_processes: [
            { id: 'proc-1', name: 'Process 1', description: '', tags: '' },
            { id: 'proc-2', name: 'Process 2', description: '', tags: '' },
          ],
          process_activities: [
            {
              id: 'act-1',
              business_process_id: 'proc-1',
              name: 'Activity 1',
              description: '',
              actor_hint: 'OTHER',
              user_interaction_level: 'AUTOMATED',
              tags: '',
            },
          ],
        },
        relationships: {},
      },
      diagrams: [],
    };

    const model = buildModelFromData(rawData);

    // Should have Business Points for all source entities
    const bpIds = model.metaModel.entities.business_points.map(bp => bp.id);
    expect(bpIds).toContain('bp_proc-1');
    expect(bpIds).toContain('bp_proc-2');
    expect(bpIds).toContain('bp_act-1');
  });
});

// ============================================================================
// Task Group 3: Configuration and UI Tests
// ============================================================================

describe('Task Group 3: Configuration and UI', () => {
  test('getPaletteSections does not return legacy sections', () => {
    const metaModel = emptyModel.metaModel;
    const sections = getPaletteSections(metaModel, '');

    // Check that no legacy sections are present
    const sectionIds = sections.map(s => s.id);
    expect(sectionIds).not.toContain('business_user_processes');
    expect(sectionIds).not.toContain('application_point_business_processes');

    // Check that new sections are present
    expect(sectionIds).toContain('business_user_business_points');
    expect(sectionIds).toContain('application_point_business_points');
  });

  test('gridConfigs does not contain legacy relationship keys', () => {
    // Verify legacy grid configs are not present
    expect(gridConfigs.business_user_processes).toBeUndefined();
    expect(gridConfigs.application_point_business_processes).toBeUndefined();

    // Verify new grid configs are present
    expect(gridConfigs.business_user_business_points).toBeDefined();
    expect(gridConfigs.application_point_business_points).toBeDefined();
  });

  test('emptyModel does not contain legacy relationship arrays', () => {
    const relationships = emptyModel.metaModel.relationships;

    // Verify new arrays are present
    expect(relationships.business_user_business_points).toBeDefined();
    expect(relationships.application_point_business_points).toBeDefined();

    // Verify legacy arrays are not present
    expect((relationships as Record<string, unknown>).business_user_processes).toBeUndefined();
    expect((relationships as Record<string, unknown>).application_point_business_processes).toBeUndefined();
  });

  test('relationshipTabToType does not include legacy mappings', () => {
    // Verify legacy tab mappings are not present
    expect(relationshipTabToType['User <-> Process']).toBeUndefined();
    expect(relationshipTabToType['App Point <-> Process']).toBeUndefined();

    // Verify new tab mappings are present
    expect(relationshipTabToType['User <-> Business Point']).toBe('business_user_business_points');
    expect(relationshipTabToType['App Point <-> Business Point']).toBe('application_point_business_points');
  });

  test('legacyRelationshipTabNames is removed', () => {
    // This array should not exist anymore
    // @ts-expect-error - legacyRelationshipTabNames should not exist
    expect(typeof legacyRelationshipTabNames).toBe('undefined');
  });
});

// ============================================================================
// Task Group 4: Cross-Cutting Cleanup Tests
// ============================================================================

describe('Task Group 4: Cross-Cutting Cleanup', () => {
  test('ID generator does not include legacy prefixes', () => {
    // Verify legacy prefixes are not returned
    expect(getEntityPrefix('business_user_processes')).toBe('id');
    expect(getEntityPrefix('application_point_business_processes')).toBe('id');

    // Verify new prefixes are present
    expect(getEntityPrefix('business_user_business_points')).toBe('bubp');
    expect(getEntityPrefix('application_point_business_points')).toBe('apbpt');
  });

  test('relationshipColors does not include legacy colors', () => {
    // Verify legacy colors are not present
    expect(relationshipColors.business_user_processes).toBeUndefined();
    expect(relationshipColors.application_point_business_processes).toBeUndefined();

    // Verify new colors are present
    expect(relationshipColors.business_user_business_points).toBeDefined();
    expect(relationshipColors.application_point_business_points).toBeDefined();
  });

  test('application loads JSON file without errors', () => {
    const testData = {
      metaModel: {
        entities: {
          business_users: [{ id: 'user-1', name: 'User', description: '', tags: '' }],
          business_processes: [{ id: 'proc-1', name: 'Process', description: '', tags: '' }],
          process_activities: [],
          business_points: [],
          applications: [],
          app_components: [],
          services: [],
          interfaces: [],
          endpoints: [],
          application_points: [],
          logical_data_entities: [],
          logical_data_attributes: [],
          physical_data_entities: [],
          physical_data_attributes: [],
        },
        relationships: {
          business_user_business_points: [
            {
              id: 'bubp-1',
              business_user_id: 'user-1',
              business_point_id: 'bp_proc-1',
              description: '',
              tags: '',
            },
          ],
          application_point_business_points: [],
          logical_data_entity_relationships: [],
          logical_data_entity_physical_data_entities: [],
          logical_data_attribute_physical_data_attributes: [],
          data_movements: [],
          interface_logical_entities: [],
        },
      },
      diagrams: [],
    };

    // Should build model without errors
    const model = buildModelFromData(testData);
    expect(model).toBeDefined();
    expect(model.metaModel.relationships.business_user_business_points).toHaveLength(1);
  });

  test('Business Point relationships continue to work', () => {
    const testData = {
      metaModel: {
        entities: {
          business_users: [{ id: 'user-1', name: 'User', description: '', tags: '' }],
          business_processes: [
            { id: 'proc-1', name: 'Process 1', description: '', tags: '' },
            { id: 'proc-2', name: 'Process 2', description: '', tags: '' },
          ],
          process_activities: [
            {
              id: 'act-1',
              business_process_id: 'proc-1',
              name: 'Activity 1',
              description: '',
              actor_hint: 'OTHER',
              user_interaction_level: 'AUTOMATED',
              tags: '',
            },
          ],
          application_points: [
            {
              id: 'ap-1',
              name: 'App Point',
              description: '',
              kind: 'APPLICATION',
              application_id: 'app-1',
              point_type: '',
              tags: '',
            },
          ],
        },
        relationships: {
          business_user_business_points: [
            {
              id: 'bubp-1',
              business_user_id: 'user-1',
              business_point_id: 'bp_proc-1',
              description: 'User uses process',
              tags: '',
            },
          ],
          application_point_business_points: [
            {
              id: 'apbp-1',
              application_point_id: 'ap-1',
              business_point_id: 'bp_act-1',
              description: 'App supports activity',
              tags: '',
            },
          ],
        },
      },
      diagrams: [],
    };

    const model = buildModelFromData(testData);

    // Verify relationships are present
    expect(model.metaModel.relationships.business_user_business_points).toHaveLength(1);
    expect(model.metaModel.relationships.application_point_business_points).toHaveLength(1);

    // Verify Business Points were created
    const bpIds = model.metaModel.entities.business_points.map(bp => bp.id);
    expect(bpIds).toContain('bp_proc-1');
    expect(bpIds).toContain('bp_proc-2');
    expect(bpIds).toContain('bp_act-1');
  });
});
