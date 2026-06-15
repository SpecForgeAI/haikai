/**
 * Tests for App Point to Process Association in Advanced Add Tree
 *
 * Task Group 2: App Point to Process Association in Tree
 * Tests the Application -> Business Process -> Process Activity chain visibility
 * via the Application Point association.
 */

import { describe, it, expect } from 'vitest';
import { ENTITY_TYPES, MetaModel } from '../types/model';
import {
  getExpandableRelationships,
  getRelationshipKindLabel,
  EXPANDABLE_RELATIONSHIPS,
} from '../utils/advancedAddRelationships';
import { buildTreeData } from '../components/DiagramsView/AdvancedAddDialog';

// ============================================================================
// Mock Data
// ============================================================================

/**
 * Creates a mock meta-model with Application -> App Point -> Business Process -> Process Activity chain
 */
const createMockMetaModelWithAppPointProcess = (): MetaModel => ({
  entities: {
    business_users: [],
    business_processes: [
      { id: 'bp-1', name: 'Order Processing', description: 'Process customer orders', tags: '' },
      { id: 'bp-2', name: 'Inventory Management', description: 'Manage inventory levels', tags: '' },
    ],
    process_activities: [
      { id: 'pa-1', business_process_id: 'bp-1', name: 'Receive Order', description: '', sequence_order: 1, actor_hint: 'END_USER', user_interaction_level: 'MODERATE', tags: '' },
      { id: 'pa-2', business_process_id: 'bp-1', name: 'Validate Order', description: '', sequence_order: 2, actor_hint: 'INTERNAL_SYSTEM', user_interaction_level: 'AUTOMATED', tags: '' },
      { id: 'pa-3', business_process_id: 'bp-1', name: 'Ship Order', description: '', sequence_order: 3, actor_hint: 'END_USER', user_interaction_level: 'SIGNIFICANT', tags: '' },
      { id: 'pa-4', business_process_id: 'bp-2', name: 'Check Stock', description: '', sequence_order: 1, actor_hint: 'INTERNAL_SYSTEM', user_interaction_level: 'AUTOMATED', tags: '' },
    ],
    applications: [
      { id: 'app-1', name: 'Order Management System', description: 'Main order system', app_type: 'Web', status: 'Active', tags: '' },
    ],
    app_components: [],
    services: [],
    interfaces: [],
    // One derived Application Point of kind APPLICATION per application --
    // the traversal resolves the application's single AP and follows all of
    // its business-point links from there.
    application_points: [
      { id: 'ap-1', application_id: 'app-1', name: 'Order App Point', description: '', kind: 'APPLICATION', point_type: '', tags: '' },
    ],
    // Business Points are the super-entities the association traverses;
    // each wraps a concrete Business Process via kind + business_process_id.
    business_points: [
      { id: 'bpt-1', name: 'Order Processing Point', description: '', kind: 'BUSINESS_PROCESS', business_process_id: 'bp-1', tags: '' },
      { id: 'bpt-2', name: 'Inventory Point', description: '', kind: 'BUSINESS_PROCESS', business_process_id: 'bp-2', tags: '' },
    ],
    logical_data_entities: [],
    logical_data_attributes: [],
    physical_data_entities: [],
    physical_data_attributes: [],
  },
  relationships: {
    business_user_business_points: [],
    application_point_business_points: [
      { id: 'apbp-1', application_point_id: 'ap-1', business_point_id: 'bpt-1', description: '', tags: '' },
      { id: 'apbp-2', application_point_id: 'ap-1', business_point_id: 'bpt-2', description: '', tags: '' },
    ],
    logical_data_entity_relationships: [],
    logical_data_entity_physical_data_entities: [],
    logical_data_attribute_physical_data_attributes: [],
    data_movements: [],
    interface_logical_entities: [],
  },
});

// ============================================================================
// Test 1: Application root shows Business Process children via App Point association
// ============================================================================

describe('Application shows Business Process children via App Point association', () => {
  const metaModel = createMockMetaModelWithAppPointProcess();

  it('should show Business Processes as children of Application in tree', () => {
    const rootEntity = { id: 'app-1', name: 'Order Management System', type: ENTITY_TYPES.APPLICATION };
    const treeData = buildTreeData(metaModel, rootEntity);

    // Root should be the application
    expect(treeData.isRoot).toBe(true);
    expect(treeData.entityId).toBe('app-1');
    expect(treeData.entityType).toBe(ENTITY_TYPES.APPLICATION);

    // Should have business processes as children (via App Point association)
    const bpChildren = treeData.children.filter((c) => c.entityType === ENTITY_TYPES.BUSINESS_PROCESS);
    expect(bpChildren.length).toBe(2);

    // Verify the business process IDs
    const bpIds = bpChildren.map((c) => c.entityId).sort();
    expect(bpIds).toEqual(['bp-1', 'bp-2']);
  });

  it('should find both Business Processes linked via different Business Points', () => {
    const rootEntity = { id: 'app-1', name: 'Order Management System', type: ENTITY_TYPES.APPLICATION };
    const treeData = buildTreeData(metaModel, rootEntity);

    const bpChildren = treeData.children.filter((c) => c.entityType === ENTITY_TYPES.BUSINESS_PROCESS);

    // bp-1 is linked via bpt-1, bp-2 is linked via bpt-2 (both through ap-1)
    const orderProcess = bpChildren.find((c) => c.entityId === 'bp-1');
    const inventoryProcess = bpChildren.find((c) => c.entityId === 'bp-2');

    expect(orderProcess).toBeDefined();
    expect(orderProcess?.entityName).toBe('Order Processing');

    expect(inventoryProcess).toBeDefined();
    expect(inventoryProcess?.entityName).toBe('Inventory Management');
  });
});

// ============================================================================
// Test 2: Business Process shows Process Activity children (parent/child)
// ============================================================================

describe('Business Process shows Process Activity children', () => {
  const metaModel = createMockMetaModelWithAppPointProcess();

  it('should show Process Activities as children of Business Process', () => {
    const rootEntity = { id: 'bp-1', name: 'Order Processing', type: ENTITY_TYPES.BUSINESS_PROCESS };
    const treeData = buildTreeData(metaModel, rootEntity);

    // Root should be the business process
    expect(treeData.isRoot).toBe(true);
    expect(treeData.entityId).toBe('bp-1');

    // Should have process activities as children
    const paChildren = treeData.children.filter((c) => c.entityType === ENTITY_TYPES.PROCESS_ACTIVITY);
    expect(paChildren.length).toBe(3);

    // Verify the activity names
    const activityNames = paChildren.map((c) => c.entityName).sort();
    expect(activityNames).toEqual(['Receive Order', 'Ship Order', 'Validate Order']);
  });

  it('should mark Process Activity relationship as PARENT_CHILD', () => {
    const rootEntity = { id: 'bp-1', name: 'Order Processing', type: ENTITY_TYPES.BUSINESS_PROCESS };
    const treeData = buildTreeData(metaModel, rootEntity);

    const paChildren = treeData.children.filter((c) => c.entityType === ENTITY_TYPES.PROCESS_ACTIVITY);

    paChildren.forEach((child) => {
      expect(child.relationshipKind).toBe('PARENT_CHILD');
    });
  });
});

// ============================================================================
// Test 3: Relationship kind label shows "(association)" for App Point to Process
// ============================================================================

describe('Relationship kind labels', () => {
  const metaModel = createMockMetaModelWithAppPointProcess();

  it('should show "(association)" label for Business Process under Application', () => {
    const rootEntity = { id: 'app-1', name: 'Order Management System', type: ENTITY_TYPES.APPLICATION };
    const treeData = buildTreeData(metaModel, rootEntity);

    const bpChildren = treeData.children.filter((c) => c.entityType === ENTITY_TYPES.BUSINESS_PROCESS);

    // All business process children should have ASSOCIATION relationship kind
    bpChildren.forEach((child) => {
      expect(child.relationshipKind).toBe('ASSOCIATION');
    });

    // Verify the label function returns correct string
    expect(getRelationshipKindLabel('ASSOCIATION')).toBe('(association)');
  });

  it('should show "(parent/child)" label for Process Activity under Business Process', () => {
    const rootEntity = { id: 'bp-1', name: 'Order Processing', type: ENTITY_TYPES.BUSINESS_PROCESS };
    const treeData = buildTreeData(metaModel, rootEntity);

    const paChildren = treeData.children.filter((c) => c.entityType === ENTITY_TYPES.PROCESS_ACTIVITY);

    // All process activity children should have PARENT_CHILD relationship kind
    paChildren.forEach((child) => {
      expect(child.relationshipKind).toBe('PARENT_CHILD');
    });

    // Verify the label function returns correct string
    expect(getRelationshipKindLabel('PARENT_CHILD')).toBe('(parent/child)');
  });
});

// ============================================================================
// Test 4: Full chain Application -> Business Process -> Process Activity appears in tree
// ============================================================================

describe('Full chain Application -> Business Process -> Process Activity', () => {
  const metaModel = createMockMetaModelWithAppPointProcess();

  it('should show complete chain from Application to Process Activity', () => {
    const rootEntity = { id: 'app-1', name: 'Order Management System', type: ENTITY_TYPES.APPLICATION };
    const treeData = buildTreeData(metaModel, rootEntity);

    // Level 0: Application (root)
    expect(treeData.entityType).toBe(ENTITY_TYPES.APPLICATION);
    expect(treeData.entityId).toBe('app-1');

    // Level 1: Business Processes (via association)
    const bpChildren = treeData.children.filter((c) => c.entityType === ENTITY_TYPES.BUSINESS_PROCESS);
    expect(bpChildren.length).toBeGreaterThan(0);

    // Find the Order Processing business process
    const orderProcess = bpChildren.find((c) => c.entityId === 'bp-1');
    expect(orderProcess).toBeDefined();
    expect(orderProcess?.relationshipKind).toBe('ASSOCIATION');

    // Level 2: Process Activities under Order Processing
    const paChildren = orderProcess?.children.filter((c) => c.entityType === ENTITY_TYPES.PROCESS_ACTIVITY);
    expect(paChildren?.length).toBe(3);

    // Verify specific activities exist
    const receiveOrder = paChildren?.find((c) => c.entityId === 'pa-1');
    expect(receiveOrder).toBeDefined();
    expect(receiveOrder?.entityName).toBe('Receive Order');
    expect(receiveOrder?.relationshipKind).toBe('PARENT_CHILD');
  });

  it('should traverse full depth for all Business Processes', () => {
    const rootEntity = { id: 'app-1', name: 'Order Management System', type: ENTITY_TYPES.APPLICATION };
    const treeData = buildTreeData(metaModel, rootEntity);

    // Find Inventory Management business process
    const inventoryProcess = treeData.children.find(
      (c) => c.entityType === ENTITY_TYPES.BUSINESS_PROCESS && c.entityId === 'bp-2'
    );
    expect(inventoryProcess).toBeDefined();

    // Should have process activities
    const paChildren = inventoryProcess?.children.filter((c) => c.entityType === ENTITY_TYPES.PROCESS_ACTIVITY);
    expect(paChildren?.length).toBe(1);
    expect(paChildren?.[0].entityName).toBe('Check Stock');
  });
});

// ============================================================================
// Test 5: EXPANDABLE_RELATIONSHIPS includes App Point to Process
// ============================================================================

describe('EXPANDABLE_RELATIONSHIPS configuration', () => {
  it('should have APPLICATION entry with BUSINESS_PROCESS association', () => {
    const appRelationships = getExpandableRelationships(ENTITY_TYPES.APPLICATION);

    const bpRelationship = appRelationships.find(
      (r) => r.targetEntityType === ENTITY_TYPES.BUSINESS_PROCESS
    );

    expect(bpRelationship).toBeDefined();
    expect(bpRelationship?.relationshipKind).toBe('ASSOCIATION');
    expect(bpRelationship?.relationshipTableName).toBe('application_point_business_points');
    expect(bpRelationship?.direction).toBe('ASSOCIATION');
  });

  it('should have BUSINESS_PROCESS entry with PROCESS_ACTIVITY parent/child', () => {
    const bpRelationships = getExpandableRelationships(ENTITY_TYPES.BUSINESS_PROCESS);

    const paRelationship = bpRelationships.find(
      (r) => r.targetEntityType === ENTITY_TYPES.PROCESS_ACTIVITY
    );

    expect(paRelationship).toBeDefined();
    expect(paRelationship?.relationshipKind).toBe('PARENT_CHILD');
    expect(paRelationship?.relationshipTableName).toBe('process_activities');
    expect(paRelationship?.foreignKeyField).toBe('business_process_id');
  });

  it('should have correct foreignKeyField for App Point to Process relationship', () => {
    const appRelationships = EXPANDABLE_RELATIONSHIPS[ENTITY_TYPES.APPLICATION];

    const bpRelationship = appRelationships?.find(
      (r) => r.targetEntityType === ENTITY_TYPES.BUSINESS_PROCESS
    );

    expect(bpRelationship?.foreignKeyField).toBe('application_point_id');
  });
});

// ============================================================================
// Test 6: Edge case - Application with no App Points
// ============================================================================

describe('Edge cases', () => {
  it('should handle Application with no App Points (no Business Process children)', () => {
    const metaModel: MetaModel = {
      entities: {
        business_users: [],
        business_processes: [
          { id: 'bp-1', name: 'Process 1', description: '', tags: '' },
        ],
        process_activities: [],
        applications: [
          { id: 'app-1', name: 'App without App Points', description: '', app_type: 'Web', status: 'Active', tags: '' },
        ],
        app_components: [],
        services: [],
        interfaces: [],
        application_points: [], // No app points
        business_points: [],
        logical_data_entities: [],
        logical_data_attributes: [],
        physical_data_entities: [],
        physical_data_attributes: [],
      },
      relationships: {
        business_user_business_points: [],
        application_point_business_points: [],
        logical_data_entity_relationships: [],
        logical_data_entity_physical_data_entities: [],
        logical_data_attribute_physical_data_attributes: [],
        data_movements: [],
        interface_logical_entities: [],
      },
    };

    const rootEntity = { id: 'app-1', name: 'App without App Points', type: ENTITY_TYPES.APPLICATION };
    const treeData = buildTreeData(metaModel, rootEntity);

    // Should have no business process children
    const bpChildren = treeData.children.filter((c) => c.entityType === ENTITY_TYPES.BUSINESS_PROCESS);
    expect(bpChildren.length).toBe(0);
  });

  it('should handle Business Process with no Process Activities', () => {
    const metaModel: MetaModel = {
      entities: {
        business_users: [],
        business_processes: [
          { id: 'bp-1', name: 'Empty Process', description: '', tags: '' },
        ],
        process_activities: [], // No activities
        applications: [],
        app_components: [],
        services: [],
        interfaces: [],
        application_points: [],
        business_points: [],
        logical_data_entities: [],
        logical_data_attributes: [],
        physical_data_entities: [],
        physical_data_attributes: [],
      },
      relationships: {
        business_user_business_points: [],
        application_point_business_points: [],
        logical_data_entity_relationships: [],
        logical_data_entity_physical_data_entities: [],
        logical_data_attribute_physical_data_attributes: [],
        data_movements: [],
        interface_logical_entities: [],
      },
    };

    const rootEntity = { id: 'bp-1', name: 'Empty Process', type: ENTITY_TYPES.BUSINESS_PROCESS };
    const treeData = buildTreeData(metaModel, rootEntity);

    // Should have no process activity children
    const paChildren = treeData.children.filter((c) => c.entityType === ENTITY_TYPES.PROCESS_ACTIVITY);
    expect(paChildren.length).toBe(0);
  });
});
