/**
 * Task Group 4: Strategic Integration Tests for Temporal Relationships
 *
 * These tests cover integration scenarios that span multiple components
 * of the temporal relationships feature:
 * 1. Process migration scenarios (edge shows with legacy app before changeover, target app after)
 * 2. Combined temporal relationship + temporal endpoint scenarios
 * 3. Adjacent validity windows (valid_to: "2026-Q2" and valid_from: "2026-Q3")
 * 4. Temporal disappearance vs actual deletion distinction
 * 5. Changing view_quarter updates edge visibility
 * 6. Loading JSON with temporal relationship fields preserves data
 */

import { describe, test, expect } from 'vitest';

import { getEdgesForDiagram, getNodesInRenderOrder } from '../utils/rendering';
import { isEntityVisibleInPeriod, isRelationshipVisibleInPeriod } from '../utils/quarterUtils';
import {
  cascadeDeleteLogicalDataEntity,
} from '../utils/applicationPointSync';
import { cascadeDeleteBusinessPoint } from '../utils/businessPointSync';
import type {
  ArchitectureModel,
  MetaModelRelationships,
  BusinessProcess,
  ApplicationPointBusinessPoint,
  LogicalDataEntity,
} from '../types/model';

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Create a base model for process migration testing
 * This model simulates a business process (pricing) that migrates
 * from a legacy application to a target application at Q3 2026
 */
function createProcessMigrationModel(): ArchitectureModel {
  return {
    metaModel: {
      entities: {
        business_users: [
          { id: 'bu_1', name: 'Trader', description: '', tags: '' },
        ],
        business_processes: [
          {
            id: 'bp_pricing',
            name: 'Pricing Process',
            description: 'Calculates prices',
            tags: '',
            // Business process is always valid
          },
        ],
        applications: [
          {
            id: 'app_legacy',
            name: 'Legacy OMS',
            description: 'Legacy system',
            app_type: 'Core',
            status: 'Active',
            tags: '',
            valid_from: '2020-Q1',
            valid_to: '2027-Q4', // Legacy ends at end of 2027
          },
          {
            id: 'app_target',
            name: 'Target OMS',
            description: 'New system',
            app_type: 'Core',
            status: 'Active',
            tags: '',
            valid_from: '2026-Q1', // Target starts Q1 2026
          },
        ],
        app_components: [],
        services: [],
        application_points: [
          {
            id: 'ap_app_legacy',
            name: 'Legacy OMS',
            description: '',
            kind: 'APPLICATION',
            application_id: 'app_legacy',
            point_type: '',
            tags: '',
            valid_from: '2020-Q1',
            valid_to: '2027-Q4',
          },
          {
            id: 'ap_app_target',
            name: 'Target OMS',
            description: '',
            kind: 'APPLICATION',
            application_id: 'app_target',
            point_type: '',
            tags: '',
            valid_from: '2026-Q1',
          },
        ],
        business_points: [
          // Business Point wrapping the (timeless) pricing process
          {
            id: 'bpt_pricing',
            name: 'Pricing Process',
            description: '',
            kind: 'BUSINESS_PROCESS',
            business_process_id: 'bp_pricing',
            tags: '',
          },
        ],
        logical_data_entities: [],
        logical_data_attributes: [],
        physical_data_entities: [],
        physical_data_attributes: [],
      },
      relationships: {
        business_user_business_points: [],
        application_point_business_points: [
          // Legacy AP supports pricing until Q3 2026 (exclusive)
          {
            id: 'apbp_legacy',
            application_point_id: 'ap_app_legacy',
            business_point_id: 'bpt_pricing',
            description: 'Legacy OMS supports pricing (until migration)',
            tags: 'legacy',
            valid_from: undefined,
            valid_to: '2026-Q3', // Relationship ends at Q3 (exclusive)
          },
          // Target AP supports pricing from Q3 2026 onwards
          {
            id: 'apbp_target',
            application_point_id: 'ap_app_target',
            business_point_id: 'bpt_pricing',
            description: 'Target OMS supports pricing (after migration)',
            tags: 'target',
            valid_from: '2026-Q3', // Relationship starts at Q3
            valid_to: undefined,
          },
        ],
        logical_data_entity_relationships: [],
        logical_data_entity_physical_data_entities: [],
        logical_data_attribute_physical_data_attributes: [],
        data_movements: [],
      },
    },
    diagrams: [
      {
        id: 'diagram_1',
        name: 'Process Migration Diagram',
        description: '',
        diagram_nodes: [
          {
            id: 'node_legacy',
            entity_type: 'APPLICATION_POINT',
            entity_id: 'ap_app_legacy',
            pos_x: 0,
            pos_y: 0,
            width: 100,
            height: 50,
            parent_node_id: null,
          },
          {
            id: 'node_target',
            entity_type: 'APPLICATION_POINT',
            entity_id: 'ap_app_target',
            pos_x: 200,
            pos_y: 0,
            width: 100,
            height: 50,
            parent_node_id: null,
          },
          {
            id: 'node_bp',
            entity_type: 'BUSINESS_PROCESS',
            entity_id: 'bp_pricing',
            pos_x: 100,
            pos_y: 100,
            width: 100,
            height: 50,
            parent_node_id: null,
          },
        ],
        diagram_edges: [
          {
            id: 'edge_legacy',
            relationship_type: 'APP_POINT_BUSINESS_POINT',
            relationship_id: 'apbp_legacy',
            source_node_id: 'node_legacy',
            target_node_id: 'node_bp',
            edge_points: [
              { id: 'pt1', pos_x: 50, pos_y: 50, sequence_order: 0 },
              { id: 'pt2', pos_x: 100, pos_y: 100, sequence_order: 1 },
            ],
          },
          {
            id: 'edge_target',
            relationship_type: 'APP_POINT_BUSINESS_POINT',
            relationship_id: 'apbp_target',
            source_node_id: 'node_target',
            target_node_id: 'node_bp',
            edge_points: [
              { id: 'pt3', pos_x: 250, pos_y: 50, sequence_order: 0 },
              { id: 'pt4', pos_x: 150, pos_y: 100, sequence_order: 1 },
            ],
          },
        ],
        view_quarter: '2026-Q2', // Default view at Q2 2026
      },
    ],
  };
}

// ============================================================================
// Test 1: Process Migration Scenario - Edge shows with legacy before changeover
// ============================================================================

describe('Process Migration Scenario', () => {
  test('legacy edge is visible before changeover (Q2 2026), target edge is not', () => {
    const model = createProcessMigrationModel();
    const visibleNodeIds = new Set(['node_legacy', 'node_target', 'node_bp']);

    // At Q2 2026, legacy relationship should be visible
    const edgesQ2 = getEdgesForDiagram('diagram_1', model, '2026-Q2', visibleNodeIds);

    // Should have exactly 1 edge (legacy)
    expect(edgesQ2.length).toBe(1);
    expect(edgesQ2[0].id).toBe('edge_legacy');
  });

  test('target edge is visible after changeover (Q3 2026), legacy edge is not', () => {
    const model = createProcessMigrationModel();
    const visibleNodeIds = new Set(['node_legacy', 'node_target', 'node_bp']);

    // At Q3 2026, target relationship should be visible
    const edgesQ3 = getEdgesForDiagram('diagram_1', model, '2026-Q3', visibleNodeIds);

    // Should have exactly 1 edge (target)
    expect(edgesQ3.length).toBe(1);
    expect(edgesQ3[0].id).toBe('edge_target');
  });

  test('switching view quarter between Q2 and Q3 toggles which edge is visible', () => {
    const model = createProcessMigrationModel();
    const visibleNodeIds = new Set(['node_legacy', 'node_target', 'node_bp']);

    // Q2 2026 - Legacy visible
    const edgesQ2 = getEdgesForDiagram('diagram_1', model, '2026-Q2', visibleNodeIds);
    expect(edgesQ2.map(e => e.id)).toEqual(['edge_legacy']);

    // Q3 2026 - Target visible
    const edgesQ3 = getEdgesForDiagram('diagram_1', model, '2026-Q3', visibleNodeIds);
    expect(edgesQ3.map(e => e.id)).toEqual(['edge_target']);

    // Q4 2026 - Target still visible
    const edgesQ4 = getEdgesForDiagram('diagram_1', model, '2026-Q4', visibleNodeIds);
    expect(edgesQ4.map(e => e.id)).toEqual(['edge_target']);
  });
});

// ============================================================================
// Test 2: Adjacent Validity Windows Work Correctly
// ============================================================================

describe('Adjacent Validity Windows', () => {
  test('no overlap when valid_to: "2026-Q3" and valid_from: "2026-Q3"', () => {
    // valid_to is exclusive, so "2026-Q3" means visible up to but not including Q3
    // valid_from is inclusive, so "2026-Q3" means visible starting from Q3
    // This means Q2 shows old relationship, Q3 shows new relationship

    const relLegacy: ApplicationPointBusinessPoint = {
      id: 'rel_legacy',
      application_point_id: 'ap_1',
      business_point_id: 'bpt_1',
      description: 'Legacy',
      tags: '',
      valid_to: '2026-Q3', // Exclusive - visible at Q2, not Q3
    };

    const relTarget: ApplicationPointBusinessPoint = {
      id: 'rel_target',
      application_point_id: 'ap_2',
      business_point_id: 'bpt_1',
      description: 'Target',
      tags: '',
      valid_from: '2026-Q3', // Inclusive - visible at Q3 and beyond
    };

    // Q2 2026: Legacy visible, Target not visible
    expect(isRelationshipVisibleInPeriod(relLegacy, '2026-Q2')).toBe(true);
    expect(isRelationshipVisibleInPeriod(relTarget, '2026-Q2')).toBe(false);

    // Q3 2026: Legacy not visible, Target visible
    expect(isRelationshipVisibleInPeriod(relLegacy, '2026-Q3')).toBe(false);
    expect(isRelationshipVisibleInPeriod(relTarget, '2026-Q3')).toBe(true);

    // No overlap at any point - clean handoff
  });

  test('relationships can have a gap between validity windows', () => {
    const relOld: ApplicationPointBusinessPoint = {
      id: 'rel_old',
      application_point_id: 'ap_1',
      business_point_id: 'bpt_1',
      description: 'Old',
      tags: '',
      valid_to: '2026-Q2', // Ends before Q2 (exclusive)
    };

    const relNew: ApplicationPointBusinessPoint = {
      id: 'rel_new',
      application_point_id: 'ap_2',
      business_point_id: 'bpt_1',
      description: 'New',
      tags: '',
      valid_from: '2026-Q4', // Starts at Q4
    };

    // Q1: Old visible, New not visible
    expect(isRelationshipVisibleInPeriod(relOld, '2026-Q1')).toBe(true);
    expect(isRelationshipVisibleInPeriod(relNew, '2026-Q1')).toBe(false);

    // Q2 and Q3: Neither visible (gap)
    expect(isRelationshipVisibleInPeriod(relOld, '2026-Q2')).toBe(false);
    expect(isRelationshipVisibleInPeriod(relNew, '2026-Q2')).toBe(false);
    expect(isRelationshipVisibleInPeriod(relOld, '2026-Q3')).toBe(false);
    expect(isRelationshipVisibleInPeriod(relNew, '2026-Q3')).toBe(false);

    // Q4: New visible, Old not visible
    expect(isRelationshipVisibleInPeriod(relOld, '2026-Q4')).toBe(false);
    expect(isRelationshipVisibleInPeriod(relNew, '2026-Q4')).toBe(true);
  });
});

// ============================================================================
// Test 3: Temporal Disappearance vs Actual Deletion Distinction
// ============================================================================

describe('Temporal Disappearance vs Actual Deletion', () => {
  test('setting valid_to to past quarter hides element but keeps it in JSON', () => {
    const entity: BusinessProcess = {
      id: 'bp_old',
      name: 'Old Process',
      description: '',
      tags: '',
      valid_from: '2020-Q1',
      valid_to: '2025-Q4', // Expired before 2026
    };

    // At 2026-Q4, entity is not visible (temporally hidden)
    expect(isEntityVisibleInPeriod(entity, '2026-Q4')).toBe(false);

    // But the entity object still exists with all its data
    expect(entity.id).toBe('bp_old');
    expect(entity.name).toBe('Old Process');
    expect(entity.valid_to).toBe('2025-Q4');

    // At 2025-Q2, entity is visible (looking at the past)
    expect(isEntityVisibleInPeriod(entity, '2025-Q2')).toBe(true);
  });

  test('DELETE_ENTITY removes entity AND its relationships from JSON (actual deletion)', () => {
    // Business Process deletion now cascades through its Business Point
    // (cascadeDeleteForBusinessSourceEntity -> cascadeDeleteBusinessPoint).
    const relationships = {
      business_user_business_points: [
        {
          id: 'bup_1',
          business_user_id: 'bu_1',
          business_point_id: 'bpt_to_delete',
          description: '',
          tags: '',
        },
        {
          id: 'bup_2',
          business_user_id: 'bu_2',
          business_point_id: 'bpt_other',
          description: '',
          tags: '',
        },
      ],
      application_point_business_points: [
        {
          id: 'apbp_1',
          application_point_id: 'ap_1',
          business_point_id: 'bpt_to_delete',
          description: '',
          tags: '',
        },
      ],
      logical_data_entity_relationships: [],
      logical_data_entity_physical_data_entities: [],
      logical_data_attribute_physical_data_attributes: [],
      data_movements: [],
      interface_logical_entities: [],
    } as unknown as MetaModelRelationships;

    // Cascade delete via the business point that wraps the deleted process
    const result = cascadeDeleteBusinessPoint('bpt_to_delete', relationships);

    // Relationships referencing the deleted entity are removed
    expect(result.business_user_business_points.length).toBe(1);
    expect(result.business_user_business_points[0].id).toBe('bup_2');
    expect(result.application_point_business_points.length).toBe(0);

    // The deleted relationship IDs are no longer in the JSON
    expect(result.business_user_business_points.find(r => r.business_point_id === 'bpt_to_delete')).toBeUndefined();
  });

  test('temporally hidden elements can be recovered by changing view quarter', () => {
    const entity: LogicalDataEntity = {
      id: 'lde_temp',
      name: 'Temporary Entity',
      description: '',
      tags: '',
      valid_from: '2024-Q1',
      valid_to: '2026-Q1', // Ends before Q1 2026 (exclusive)
    };

    // Hidden at Q2 2026
    expect(isEntityVisibleInPeriod(entity, '2026-Q2')).toBe(false);

    // Visible at Q4 2025 (before valid_to)
    expect(isEntityVisibleInPeriod(entity, '2025-Q4')).toBe(true);

    // Recoverable by viewing earlier time period
    const visibleAt2025Q4 = isEntityVisibleInPeriod(entity, '2025-Q4');
    expect(visibleAt2025Q4).toBe(true);
  });

  test('deleted elements cannot be recovered by changing view quarter', () => {
    const relationships = {
      business_user_business_points: [],
      application_point_business_points: [],
      logical_data_entity_relationships: [
        {
          id: 'lder_1',
          fromDataEntityPointId: 'dep_log_lde_to_delete',
          toDataEntityPointId: 'dep_log_lde_other',
          description: '',
          tags: '',
        },
      ],
      logical_data_entity_physical_data_entities: [],
      logical_data_attribute_physical_data_attributes: [],
      data_movements: [],
      interface_logical_entities: [],
    } as unknown as MetaModelRelationships;

    // Delete the logical data entity
    const result = cascadeDeleteLogicalDataEntity('lde_to_delete', relationships);

    // Relationship is permanently removed - no recovery possible
    expect(result.logical_data_entity_relationships.length).toBe(0);

    // Cannot be "seen" at any view quarter because it's not in JSON
    // (The relationship doesn't exist anymore to be filtered)
  });
});

// ============================================================================
// Test 4: Combined Temporal Relationship + Temporal Endpoint
// ============================================================================

describe('Combined Temporal Relationship and Endpoint Visibility', () => {
  test('edge hidden when relationship valid but endpoint entity expired', () => {
    // Scenario: Relationship is timeless, but source endpoint has valid_to in past
    const model: ArchitectureModel = {
      metaModel: {
        entities: {
          business_users: [],
          business_processes: [
            {
              id: 'bp_1',
              name: 'Process',
              description: '',
              tags: '',
              valid_to: '2026-Q2', // Endpoint expired before Q4
            },
          ],
          applications: [],
          app_components: [],
          services: [],
          application_points: [
            {
              id: 'ap_1',
              name: 'App Point',
              description: '',
              kind: 'APPLICATION',
              application_id: 'app_1',
              point_type: '',
              tags: '',
              // Timeless application point
            },
          ],
          business_points: [
            {
              id: 'bpt_1',
              name: 'Process',
              description: '',
              kind: 'BUSINESS_PROCESS',
              business_process_id: 'bp_1',
              tags: '',
              valid_to: '2026-Q2', // Endpoint (business point) expired before Q4
            },
          ],
          logical_data_entities: [],
          logical_data_attributes: [],
          physical_data_entities: [],
          physical_data_attributes: [],
        },
        relationships: {
          business_user_business_points: [],
          application_point_business_points: [
            {
              id: 'apbp_1',
              application_point_id: 'ap_1',
              business_point_id: 'bpt_1',
              description: '',
              tags: '',
              // Timeless relationship
            },
          ],
          logical_data_entity_relationships: [],
          logical_data_entity_physical_data_entities: [],
          logical_data_attribute_physical_data_attributes: [],
          data_movements: [],
        },
      },
      diagrams: [
        {
          id: 'diagram_1',
          name: 'Test Diagram',
          description: '',
          diagram_nodes: [
            {
              id: 'node_ap',
              entity_type: 'APPLICATION_POINT',
              entity_id: 'ap_1',
              pos_x: 0,
              pos_y: 0,
              width: 100,
              height: 50,
              parent_node_id: null,
            },
            {
              id: 'node_bp',
              entity_type: 'BUSINESS_PROCESS',
              entity_id: 'bp_1',
              pos_x: 200,
              pos_y: 0,
              width: 100,
              height: 50,
              parent_node_id: null,
            },
          ],
          diagram_edges: [
            {
              id: 'edge_1',
              relationship_type: 'APP_POINT_BUSINESS_POINT',
              relationship_id: 'apbp_1',
              source_node_id: 'node_ap',
              target_node_id: 'node_bp',
              edge_points: [
                { id: 'pt1', pos_x: 100, pos_y: 25, sequence_order: 0 },
                { id: 'pt2', pos_x: 200, pos_y: 25, sequence_order: 1 },
              ],
            },
          ],
        },
      ],
    };

    const visibleNodeIds = new Set(['node_ap', 'node_bp']);

    // At Q4 2026: relationship is timeless but endpoint (bp_1) expired at Q2
    const edges = getEdgesForDiagram('diagram_1', model, '2026-Q4', visibleNodeIds);

    // Edge should be hidden because endpoint entity is not valid
    expect(edges.length).toBe(0);
  });

  test('edge hidden when endpoint valid but relationship expired', () => {
    // Scenario: Endpoint is timeless, but relationship has valid_to in past
    const model: ArchitectureModel = {
      metaModel: {
        entities: {
          business_users: [],
          business_processes: [
            {
              id: 'bp_1',
              name: 'Process',
              description: '',
              tags: '',
              // Timeless endpoint
            },
          ],
          applications: [],
          app_components: [],
          services: [],
          application_points: [
            {
              id: 'ap_1',
              name: 'App Point',
              description: '',
              kind: 'APPLICATION',
              application_id: 'app_1',
              point_type: '',
              tags: '',
              // Timeless application point
            },
          ],
          business_points: [
            {
              id: 'bpt_1',
              name: 'Process',
              description: '',
              kind: 'BUSINESS_PROCESS',
              business_process_id: 'bp_1',
              tags: '',
              // Timeless business point
            },
          ],
          logical_data_entities: [],
          logical_data_attributes: [],
          physical_data_entities: [],
          physical_data_attributes: [],
        },
        relationships: {
          business_user_business_points: [],
          application_point_business_points: [
            {
              id: 'apbp_1',
              application_point_id: 'ap_1',
              business_point_id: 'bpt_1',
              description: '',
              tags: '',
              valid_to: '2026-Q2', // Relationship expired before Q4
            },
          ],
          logical_data_entity_relationships: [],
          logical_data_entity_physical_data_entities: [],
          logical_data_attribute_physical_data_attributes: [],
          data_movements: [],
        },
      },
      diagrams: [
        {
          id: 'diagram_1',
          name: 'Test Diagram',
          description: '',
          diagram_nodes: [
            {
              id: 'node_ap',
              entity_type: 'APPLICATION_POINT',
              entity_id: 'ap_1',
              pos_x: 0,
              pos_y: 0,
              width: 100,
              height: 50,
              parent_node_id: null,
            },
            {
              id: 'node_bp',
              entity_type: 'BUSINESS_PROCESS',
              entity_id: 'bp_1',
              pos_x: 200,
              pos_y: 0,
              width: 100,
              height: 50,
              parent_node_id: null,
            },
          ],
          diagram_edges: [
            {
              id: 'edge_1',
              relationship_type: 'APP_POINT_BUSINESS_POINT',
              relationship_id: 'apbp_1',
              source_node_id: 'node_ap',
              target_node_id: 'node_bp',
              edge_points: [
                { id: 'pt1', pos_x: 100, pos_y: 25, sequence_order: 0 },
                { id: 'pt2', pos_x: 200, pos_y: 25, sequence_order: 1 },
              ],
            },
          ],
        },
      ],
    };

    const visibleNodeIds = new Set(['node_ap', 'node_bp']);

    // At Q4 2026: endpoints are timeless but relationship expired at Q2
    const edges = getEdgesForDiagram('diagram_1', model, '2026-Q4', visibleNodeIds);

    // Edge should be hidden because relationship is not valid
    expect(edges.length).toBe(0);
  });

  test('edge visible only when BOTH relationship AND endpoints are valid', () => {
    const model: ArchitectureModel = {
      metaModel: {
        entities: {
          business_users: [],
          business_processes: [
            {
              id: 'bp_1',
              name: 'Process',
              description: '',
              tags: '',
              valid_from: '2025-Q1',
              valid_to: '2028-Q4',
            },
          ],
          applications: [],
          app_components: [],
          services: [],
          application_points: [
            {
              id: 'ap_1',
              name: 'App Point',
              description: '',
              kind: 'APPLICATION',
              application_id: 'app_1',
              point_type: '',
              tags: '',
              valid_from: '2024-Q1',
              valid_to: '2027-Q4',
            },
          ],
          business_points: [
            {
              id: 'bpt_1',
              name: 'Process',
              description: '',
              kind: 'BUSINESS_PROCESS',
              business_process_id: 'bp_1',
              tags: '',
              valid_from: '2025-Q1',
              valid_to: '2028-Q4',
            },
          ],
          logical_data_entities: [],
          logical_data_attributes: [],
          physical_data_entities: [],
          physical_data_attributes: [],
        },
        relationships: {
          business_user_business_points: [],
          application_point_business_points: [
            {
              id: 'apbp_1',
              application_point_id: 'ap_1',
              business_point_id: 'bpt_1',
              description: '',
              tags: '',
              valid_from: '2025-Q2',
              valid_to: '2027-Q2',
            },
          ],
          logical_data_entity_relationships: [],
          logical_data_entity_physical_data_entities: [],
          logical_data_attribute_physical_data_attributes: [],
          data_movements: [],
        },
      },
      diagrams: [
        {
          id: 'diagram_1',
          name: 'Test Diagram',
          description: '',
          diagram_nodes: [
            {
              id: 'node_ap',
              entity_type: 'APPLICATION_POINT',
              entity_id: 'ap_1',
              pos_x: 0,
              pos_y: 0,
              width: 100,
              height: 50,
              parent_node_id: null,
            },
            {
              id: 'node_bp',
              entity_type: 'BUSINESS_PROCESS',
              entity_id: 'bp_1',
              pos_x: 200,
              pos_y: 0,
              width: 100,
              height: 50,
              parent_node_id: null,
            },
          ],
          diagram_edges: [
            {
              id: 'edge_1',
              relationship_type: 'APP_POINT_BUSINESS_POINT',
              relationship_id: 'apbp_1',
              source_node_id: 'node_ap',
              target_node_id: 'node_bp',
              edge_points: [
                { id: 'pt1', pos_x: 100, pos_y: 25, sequence_order: 0 },
                { id: 'pt2', pos_x: 200, pos_y: 25, sequence_order: 1 },
              ],
            },
          ],
        },
      ],
    };

    const visibleNodeIds = new Set(['node_ap', 'node_bp']);

    // Relationship: valid_from 2025-Q2, valid_to 2027-Q2
    // AP: valid_from 2024-Q1, valid_to 2027-Q4
    // BP: valid_from 2025-Q1, valid_to 2028-Q4
    // Effective visible window: 2025-Q2 to 2027-Q2 (intersection)

    // Q1 2025: Relationship not started yet
    expect(getEdgesForDiagram('diagram_1', model, '2025-Q1', visibleNodeIds).length).toBe(0);

    // Q2 2025: All valid
    expect(getEdgesForDiagram('diagram_1', model, '2025-Q2', visibleNodeIds).length).toBe(1);

    // Q1 2027: All valid
    expect(getEdgesForDiagram('diagram_1', model, '2027-Q1', visibleNodeIds).length).toBe(1);

    // Q2 2027: Relationship ends (exclusive)
    expect(getEdgesForDiagram('diagram_1', model, '2027-Q2', visibleNodeIds).length).toBe(0);
  });
});

// ============================================================================
// Test 5: Loading JSON with Temporal Relationship Fields Preserves Data
// ============================================================================

describe('JSON Loading Preserves Temporal Fields', () => {
  test('temporal fields on relationships are preserved when loading JSON', () => {
    // Simulate JSON that would be loaded from file
    const jsonModel = {
      metaModel: {
        entities: {
          business_users: [{ id: 'bu_1', name: 'User', description: '', tags: '' }],
          business_processes: [{ id: 'bp_1', name: 'Process', description: '', tags: '' }],
          applications: [],
          app_components: [],
          services: [],
          application_points: [],
          logical_data_entities: [],
          logical_data_attributes: [],
          physical_data_entities: [],
          physical_data_attributes: [],
        },
        relationships: {
          business_user_processes: [
            {
              id: 'bup_1',
              business_user_id: 'bu_1',
              business_process_id: 'bp_1',
              description: 'User executes process',
              tags: '',
              valid_from: '2024-Q1',
              valid_to: '2028-Q4',
            },
          ],
          application_point_business_processes: [],
          logical_data_entity_relationships: [],
          logical_data_entity_physical_data_entities: [],
          logical_data_attribute_physical_data_attributes: [],
          data_movements: [],
        },
      },
      diagrams: [],
    };

    // Parse JSON (simulating JSON.parse of file content)
    const parsedModel = JSON.parse(JSON.stringify(jsonModel)) as ArchitectureModel;

    // Verify temporal fields are preserved
    const bup = parsedModel.metaModel.relationships.business_user_processes[0];
    expect(bup.valid_from).toBe('2024-Q1');
    expect(bup.valid_to).toBe('2028-Q4');
  });

  test('null temporal fields are preserved and treated as timeless', () => {
    const jsonModel = {
      metaModel: {
        entities: {
          business_users: [],
          business_processes: [],
          applications: [],
          app_components: [],
          services: [],
          application_points: [],
          logical_data_entities: [
            { id: 'lde_1', name: 'Entity 1', description: '', tags: '' },
            { id: 'lde_2', name: 'Entity 2', description: '', tags: '' },
          ],
          logical_data_attributes: [],
          physical_data_entities: [],
          physical_data_attributes: [],
        },
        relationships: {
          business_user_processes: [],
          application_point_business_processes: [],
          logical_data_entity_relationships: [
            {
              id: 'lder_1',
              source_entity_id: 'lde_1',
              target_entity_id: 'lde_2',
              relationship_type: 'one-to-many',
              description: '',
              tags: '',
              valid_from: null,
              valid_to: null,
            },
          ],
          logical_data_entity_physical_data_entities: [],
          logical_data_attribute_physical_data_attributes: [],
          data_movements: [],
        },
      },
      diagrams: [],
    };

    const parsedModel = JSON.parse(JSON.stringify(jsonModel)) as ArchitectureModel;

    // Verify null values are preserved
    const lder = parsedModel.metaModel.relationships.logical_data_entity_relationships[0];
    expect(lder.valid_from).toBeNull();
    expect(lder.valid_to).toBeNull();

    // And the relationship is treated as timeless
    expect(isRelationshipVisibleInPeriod(lder, '2000-Q1')).toBe(true);
    expect(isRelationshipVisibleInPeriod(lder, '2050-Q4')).toBe(true);
  });

  test('undefined temporal fields work correctly (backward compatibility)', () => {
    // Old JSON without temporal fields
    const jsonModel = {
      metaModel: {
        entities: {
          business_users: [],
          business_processes: [],
          applications: [],
          app_components: [],
          services: [],
          application_points: [],
          logical_data_entities: [],
          logical_data_attributes: [],
          physical_data_entities: [],
          physical_data_attributes: [],
        },
        relationships: {
          business_user_processes: [
            {
              id: 'bup_old',
              business_user_id: 'bu_1',
              business_process_id: 'bp_1',
              description: 'Old relationship without temporal fields',
              tags: '',
              // No valid_from or valid_to fields
            },
          ],
          application_point_business_processes: [],
          logical_data_entity_relationships: [],
          logical_data_entity_physical_data_entities: [],
          logical_data_attribute_physical_data_attributes: [],
          data_movements: [],
        },
      },
      diagrams: [],
    };

    const parsedModel = JSON.parse(JSON.stringify(jsonModel)) as ArchitectureModel;
    const bup = parsedModel.metaModel.relationships.business_user_processes[0];

    // Fields should be undefined (not present)
    expect(bup.valid_from).toBeUndefined();
    expect(bup.valid_to).toBeUndefined();

    // Relationship is treated as timeless
    expect(isRelationshipVisibleInPeriod(bup, '2020-Q1')).toBe(true);
    expect(isRelationshipVisibleInPeriod(bup, '2030-Q4')).toBe(true);
  });
});
