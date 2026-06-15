/**
 * Advanced Add Point Resolution Tests
 *
 * Task Group 2: Super-class Aware Tree Building (Point Resolution)
 * Tests that Application Point and Business Point nodes NEVER appear in tree.
 * Instead, concrete entities (Business Process, Process Activity) are shown directly.
 *
 * Key Principle: Points are internal constructs for relationship traversal only.
 * Users should only see concrete entities in the Advanced Add tree.
 *
 * Note on Deduplication: Due to tree deduplication, an entity appearing via multiple
 * paths (e.g., bp-1 linked to both Application and its child Service) will only
 * appear once - at its first occurrence during tree traversal. Tests should check
 * that entities appear SOMEWHERE in the tree, not necessarily as direct children.
 */

import { describe, it, expect } from 'vitest';
import { ENTITY_TYPES, MetaModel } from '../types/model';
import { buildTreeData } from '../components/DiagramsView/AdvancedAddDialog';
import { TreeNodeData } from '../types/advancedAdd';

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Find all nodes in a tree with a specific entityType
 */
function findNodesByEntityType(node: TreeNodeData, entityType: string): TreeNodeData[] {
  const result: TreeNodeData[] = [];
  if (node.entityType === entityType) {
    result.push(node);
  }
  node.children.forEach((child) => {
    result.push(...findNodesByEntityType(child, entityType));
  });
  return result;
}

/**
 * Find all nodes in a tree with a specific entityType and entityId
 */
function findNodesByEntity(
  node: TreeNodeData,
  entityType: string,
  entityId: string
): TreeNodeData[] {
  const result: TreeNodeData[] = [];
  if (node.entityType === entityType && node.entityId === entityId) {
    result.push(node);
  }
  node.children.forEach((child) => {
    result.push(...findNodesByEntity(child, entityType, entityId));
  });
  return result;
}

/**
 * Check if a path exists from root to a node with the given entity type and ID
 */
function hasPathToEntity(
  node: TreeNodeData,
  entityType: string,
  entityId: string
): boolean {
  if (node.entityType === entityType && node.entityId === entityId) {
    return true;
  }
  return node.children.some((child) => hasPathToEntity(child, entityType, entityId));
}

/**
 * Get all entity types present in the tree
 */
function getAllEntityTypes(node: TreeNodeData): Set<string> {
  const types = new Set<string>();
  types.add(node.entityType);
  node.children.forEach((child) => {
    getAllEntityTypes(child).forEach((t) => types.add(t));
  });
  return types;
}

/**
 * Check if a node has a direct child with specific entityType
 */
function hasDirectChildOfType(parent: TreeNodeData, entityType: string): boolean {
  return parent.children.some((child) => child.entityType === entityType);
}

// ============================================================================
// Mock Data Factory - Point Resolution Scenarios
// ============================================================================

/**
 * Create a mock MetaModel with Application -> Business Point -> Business Process/Process Activity
 * This tests that Points are resolved to concrete entities
 */
function createMockMetaModelForPointResolution(): MetaModel {
  return {
    entities: {
      business_users: [],
      business_processes: [
        { id: 'bp-1', name: 'Order Processing', description: '', tags: '' },
        { id: 'bp-2', name: 'Payment Processing', description: '', tags: '' },
      ],
      process_activities: [
        { id: 'pa-1', business_process_id: 'bp-1', name: 'Validate Order', description: '', sequence_order: 1, actor_hint: 'END_USER', user_interaction_level: 'MODERATE', tags: '' },
        { id: 'pa-2', business_process_id: 'bp-1', name: 'Process Payment', description: '', sequence_order: 2, actor_hint: 'INTERNAL_SYSTEM', user_interaction_level: 'AUTOMATED', tags: '' },
        { id: 'pa-3', business_process_id: 'bp-2', name: 'Charge Card', description: '', sequence_order: 1, actor_hint: 'INTERNAL_SYSTEM', user_interaction_level: 'AUTOMATED', tags: '' },
      ],
      business_points: [
        // Business Point for Business Process bp-1
        { id: 'bpt-bp1', name: 'Order Processing BP', description: '', kind: 'BUSINESS_PROCESS', business_process_id: 'bp-1', tags: '' },
        // Business Point for Business Process bp-2
        { id: 'bpt-bp2', name: 'Payment Processing BP', description: '', kind: 'BUSINESS_PROCESS', business_process_id: 'bp-2', tags: '' },
        // Business Point for Process Activity pa-1
        { id: 'bpt-pa1', name: 'Validate Order BP', description: '', kind: 'PROCESS_ACTIVITY', business_process_id: 'bp-1', process_activity_id: 'pa-1', tags: '' },
      ],
      applications: [
        { id: 'app-1', name: 'Order Management System', description: '', app_type: 'Web', status: 'Active', tags: '' },
      ],
      app_components: [
        { id: 'ac-1', application_id: 'app-1', name: 'Order Component', description: '', tags: '' },
      ],
      services: [
        { id: 'svc-1', application_id: 'app-1', app_component_id: 'ac-1', name: 'Order Service', description: '', service_type: 'API', tags: '' },
      ],
      interfaces: [
        { id: 'int-1', service_id: 'svc-1', name: 'Order API', description: '', interface_type: 'REST_API', tags: '' },
      ],
      application_points: [
        // Application Point for app-1
        { id: 'ap-app1', application_id: 'app-1', name: 'App Point 1', description: '', kind: 'APPLICATION', point_type: '', tags: '' },
        // Application Point for ac-1
        { id: 'ap-ac1', application_id: 'app-1', application_component_id: 'ac-1', name: 'AC Point 1', description: '', kind: 'APP_COMPONENT', point_type: '', tags: '' },
        // Application Point for svc-1
        { id: 'ap-svc1', application_id: 'app-1', service_id: 'svc-1', name: 'Service Point 1', description: '', kind: 'SERVICE', point_type: '', tags: '' },
      ],
      logical_data_entities: [
        { id: 'lde-1', name: 'Order Entity', description: '', tags: '' },
      ],
      logical_data_attributes: [],
      physical_data_entities: [],
      physical_data_attributes: [],
    },
    relationships: {
      business_user_processes: [],
      business_user_business_points: [],
      application_point_business_processes: [],
      // Application Point -> Business Point relationships
      // app-1's Application Point links to bp-1 (Business Process) and pa-1 (Process Activity)
      application_point_business_points: [
        { id: 'apbp-1', application_point_id: 'ap-app1', business_point_id: 'bpt-bp1', description: '', tags: '' },
        { id: 'apbp-2', application_point_id: 'ap-app1', business_point_id: 'bpt-pa1', description: '', tags: '' },
        // ac-1's Application Point links to bp-2 (Business Process)
        { id: 'apbp-3', application_point_id: 'ap-ac1', business_point_id: 'bpt-bp2', description: '', tags: '' },
        // svc-1's Application Point links to bp-1 (Business Process)
        { id: 'apbp-4', application_point_id: 'ap-svc1', business_point_id: 'bpt-bp1', description: '', tags: '' },
      ],
      logical_data_entity_relationships: [],
      logical_data_entity_physical_data_entities: [],
      logical_data_attribute_physical_data_attributes: [],
      data_movements: [],
      interface_logical_entities: [
        { id: 'ile-1', interface_id: 'int-1', dataEntityPointId: 'dep_log_lde-1', description: '', tags: '' },
      ],
    },
  };
}

/**
 * Create a mock MetaModel for simpler Application -> Business Process testing
 * This model has NO nested App Components or Services, so Business Processes
 * WILL appear as direct children of the Application.
 */
function createSimpleMockMetaModelForPointResolution(): MetaModel {
  return {
    entities: {
      business_users: [],
      business_processes: [
        { id: 'bp-1', name: 'Order Processing', description: '', tags: '' },
      ],
      process_activities: [
        { id: 'pa-1', business_process_id: 'bp-1', name: 'Validate Order', description: '', sequence_order: 1, actor_hint: 'END_USER', user_interaction_level: 'MODERATE', tags: '' },
      ],
      business_points: [
        { id: 'bpt-bp1', name: 'Order Processing BP', description: '', kind: 'BUSINESS_PROCESS', business_process_id: 'bp-1', tags: '' },
        { id: 'bpt-pa1', name: 'Validate Order BP', description: '', kind: 'PROCESS_ACTIVITY', business_process_id: 'bp-1', process_activity_id: 'pa-1', tags: '' },
      ],
      applications: [
        { id: 'app-1', name: 'Order Management System', description: '', app_type: 'Web', status: 'Active', tags: '' },
      ],
      app_components: [],
      services: [],
      interfaces: [],
      application_points: [
        { id: 'ap-app1', application_id: 'app-1', name: 'App Point 1', description: '', kind: 'APPLICATION', point_type: '', tags: '' },
      ],
      logical_data_entities: [],
      logical_data_attributes: [],
      physical_data_entities: [],
      physical_data_attributes: [],
    },
    relationships: {
      business_user_processes: [],
      business_user_business_points: [],
      application_point_business_processes: [],
      application_point_business_points: [
        { id: 'apbp-1', application_point_id: 'ap-app1', business_point_id: 'bpt-bp1', description: '', tags: '' },
        { id: 'apbp-2', application_point_id: 'ap-app1', business_point_id: 'bpt-pa1', description: '', tags: '' },
      ],
      logical_data_entity_relationships: [],
      logical_data_entity_physical_data_entities: [],
      logical_data_attribute_physical_data_attributes: [],
      data_movements: [],
      interface_logical_entities: [],
    },
  };
}

/**
 * Create a mock MetaModel where a Process Activity is linked ONLY to Application
 * (its parent Business Process is NOT linked). This tests that Process Activities
 * can appear as direct children when they're the only linked entity.
 */
function createMockMetaModelForDirectProcessActivity(): MetaModel {
  return {
    entities: {
      business_users: [],
      business_processes: [
        { id: 'bp-1', name: 'Order Processing', description: '', tags: '' },
      ],
      process_activities: [
        { id: 'pa-1', business_process_id: 'bp-1', name: 'Validate Order', description: '', sequence_order: 1, actor_hint: 'END_USER', user_interaction_level: 'MODERATE', tags: '' },
      ],
      business_points: [
        // ONLY a Business Point for the Process Activity, NOT for the Business Process
        { id: 'bpt-pa1', name: 'Validate Order BP', description: '', kind: 'PROCESS_ACTIVITY', business_process_id: 'bp-1', process_activity_id: 'pa-1', tags: '' },
      ],
      applications: [
        { id: 'app-1', name: 'Order Management System', description: '', app_type: 'Web', status: 'Active', tags: '' },
      ],
      app_components: [],
      services: [],
      interfaces: [],
      application_points: [
        { id: 'ap-app1', application_id: 'app-1', name: 'App Point 1', description: '', kind: 'APPLICATION', point_type: '', tags: '' },
      ],
      logical_data_entities: [],
      logical_data_attributes: [],
      physical_data_entities: [],
      physical_data_attributes: [],
    },
    relationships: {
      business_user_processes: [],
      business_user_business_points: [],
      application_point_business_processes: [],
      application_point_business_points: [
        // ONLY link to Process Activity, NOT to Business Process
        { id: 'apbp-1', application_point_id: 'ap-app1', business_point_id: 'bpt-pa1', description: '', tags: '' },
      ],
      logical_data_entity_relationships: [],
      logical_data_entity_physical_data_entities: [],
      logical_data_attribute_physical_data_attributes: [],
      data_movements: [],
      interface_logical_entities: [],
    },
  };
}

/**
 * Create a minimal MetaModel for Interface -> Logical Entity containment test
 */
function createMockMetaModelForInterfaceLogicalEntity(): MetaModel {
  return {
    entities: {
      business_users: [],
      business_processes: [],
      process_activities: [],
      business_points: [],
      applications: [
        { id: 'app-1', name: 'Test App', description: '', app_type: 'Web', status: 'Active', tags: '' },
      ],
      app_components: [],
      services: [
        { id: 'svc-1', application_id: 'app-1', name: 'Test Service', description: '', service_type: 'API', tags: '' },
      ],
      interfaces: [
        { id: 'int-1', service_id: 'svc-1', name: 'Test API', description: '', interface_type: 'REST_API', tags: '' },
      ],
      application_points: [],
      logical_data_entities: [
        { id: 'lde-1', name: 'Customer', description: '', tags: '' },
        { id: 'lde-2', name: 'Order', description: '', tags: '' },
      ],
      logical_data_attributes: [],
      physical_data_entities: [],
      physical_data_attributes: [],
    },
    relationships: {
      business_user_processes: [],
      business_user_business_points: [],
      application_point_business_processes: [],
      application_point_business_points: [],
      logical_data_entity_relationships: [],
      logical_data_entity_physical_data_entities: [],
      logical_data_attribute_physical_data_attributes: [],
      data_movements: [],
      interface_logical_entities: [
        { id: 'ile-1', interface_id: 'int-1', dataEntityPointId: 'dep_log_lde-1', description: '', tags: '' },
        { id: 'ile-2', interface_id: 'int-1', dataEntityPointId: 'dep_log_lde-2', description: '', tags: '' },
      ],
    },
  };
}

// ============================================================================
// Test 1: Application root shows Business Process children directly (not Business Points)
// ============================================================================

describe('Point Resolution: Application root shows Business Processes directly', () => {
  it('should show Business Process as direct child of Application (not via Business Point)', () => {
    // Use simplified model without nested components to test direct children
    const metaModel = createSimpleMockMetaModelForPointResolution();
    const rootEntity = { id: 'app-1', name: 'Order Management System', type: ENTITY_TYPES.APPLICATION };

    const treeData = buildTreeData(metaModel, rootEntity);

    // Application should have Business Process as a direct child
    const businessProcessChildren = treeData.children.filter(
      (child) => child.entityType === ENTITY_TYPES.BUSINESS_PROCESS
    );

    // bp-1 is linked via Application Point -> Business Point (kind: BUSINESS_PROCESS)
    expect(businessProcessChildren.length).toBeGreaterThan(0);
    expect(businessProcessChildren.some((bp) => bp.entityId === 'bp-1')).toBe(true);
  });

  it('should NOT show Business Point nodes in the tree when Application is root', () => {
    const metaModel = createMockMetaModelForPointResolution();
    const rootEntity = { id: 'app-1', name: 'Order Management System', type: ENTITY_TYPES.APPLICATION };

    const treeData = buildTreeData(metaModel, rootEntity);

    // Business Point nodes should NEVER appear in the tree
    const businessPointNodes = findNodesByEntityType(treeData, ENTITY_TYPES.BUSINESS_POINT);
    expect(businessPointNodes.length).toBe(0);
  });
});

// ============================================================================
// Test 2: Application root shows Process Activity children directly
// ============================================================================

describe('Point Resolution: Application root shows Process Activities directly', () => {
  it('should show Process Activity as direct child of Application when only PA is linked (not BP)', () => {
    // Use model where ONLY Process Activity is linked, NOT its parent Business Process
    // This ensures the PA appears as a direct child (no deduplication from BP expansion)
    const metaModel = createMockMetaModelForDirectProcessActivity();
    const rootEntity = { id: 'app-1', name: 'Order Management System', type: ENTITY_TYPES.APPLICATION };

    const treeData = buildTreeData(metaModel, rootEntity);

    // Application should have Process Activity as a direct child
    // pa-1 is linked via Application Point -> Business Point (kind: PROCESS_ACTIVITY)
    const processActivityChildren = treeData.children.filter(
      (child) => child.entityType === ENTITY_TYPES.PROCESS_ACTIVITY
    );

    expect(processActivityChildren.length).toBeGreaterThan(0);
    expect(processActivityChildren.some((pa) => pa.entityId === 'pa-1')).toBe(true);
  });

  it('should show Process Activity somewhere in tree when both BP and PA are linked', () => {
    // When both Business Process and Process Activity are linked to Application:
    // - BP is processed first (relationship order)
    // - BP expands to find its PA children
    // - PA ends up under BP due to deduplication
    // This test verifies PA still appears in the tree (just not as direct child)
    const metaModel = createSimpleMockMetaModelForPointResolution();
    const rootEntity = { id: 'app-1', name: 'Order Management System', type: ENTITY_TYPES.APPLICATION };

    const treeData = buildTreeData(metaModel, rootEntity);

    // pa-1 should appear somewhere in the tree
    const pa1Nodes = findNodesByEntity(treeData, ENTITY_TYPES.PROCESS_ACTIVITY, 'pa-1');
    expect(pa1Nodes.length).toBe(1);
  });
});

// ============================================================================
// Test 3: App Component root shows Business Process children directly
// ============================================================================

describe('Point Resolution: App Component root shows Business Processes directly', () => {
  it('should show Business Process as direct child of App Component', () => {
    const metaModel = createMockMetaModelForPointResolution();
    const rootEntity = { id: 'ac-1', name: 'Order Component', type: ENTITY_TYPES.APP_COMPONENT };

    const treeData = buildTreeData(metaModel, rootEntity);

    // App Component should have Business Process as a direct child
    // bp-2 is linked via ac-1's Application Point -> Business Point
    const businessProcessChildren = treeData.children.filter(
      (child) => child.entityType === ENTITY_TYPES.BUSINESS_PROCESS
    );

    expect(businessProcessChildren.length).toBeGreaterThan(0);
    expect(businessProcessChildren.some((bp) => bp.entityId === 'bp-2')).toBe(true);
  });

  it('should NOT show Business Point nodes when App Component is root', () => {
    const metaModel = createMockMetaModelForPointResolution();
    const rootEntity = { id: 'ac-1', name: 'Order Component', type: ENTITY_TYPES.APP_COMPONENT };

    const treeData = buildTreeData(metaModel, rootEntity);

    const businessPointNodes = findNodesByEntityType(treeData, ENTITY_TYPES.BUSINESS_POINT);
    expect(businessPointNodes.length).toBe(0);
  });
});

// ============================================================================
// Test 4: Service root shows Business Process children directly
// ============================================================================

describe('Point Resolution: Service root shows Business Processes directly', () => {
  it('should show Business Process as direct child of Service', () => {
    const metaModel = createMockMetaModelForPointResolution();
    const rootEntity = { id: 'svc-1', name: 'Order Service', type: ENTITY_TYPES.SERVICE };

    const treeData = buildTreeData(metaModel, rootEntity);

    // Service should have Business Process as a direct child
    // bp-1 is linked via svc-1's Application Point -> Business Point
    const businessProcessChildren = treeData.children.filter(
      (child) => child.entityType === ENTITY_TYPES.BUSINESS_PROCESS
    );

    expect(businessProcessChildren.length).toBeGreaterThan(0);
    expect(businessProcessChildren.some((bp) => bp.entityId === 'bp-1')).toBe(true);
  });

  it('should NOT show Business Point nodes when Service is root', () => {
    const metaModel = createMockMetaModelForPointResolution();
    const rootEntity = { id: 'svc-1', name: 'Order Service', type: ENTITY_TYPES.SERVICE };

    const treeData = buildTreeData(metaModel, rootEntity);

    const businessPointNodes = findNodesByEntityType(treeData, ENTITY_TYPES.BUSINESS_POINT);
    expect(businessPointNodes.length).toBe(0);
  });
});

// ============================================================================
// Test 5: Business Point nodes NEVER appear in tree
// ============================================================================

describe('Point Resolution: Business Point nodes NEVER appear in tree', () => {
  it('should never have BUSINESS_POINT entity type in the tree from Application root', () => {
    const metaModel = createMockMetaModelForPointResolution();
    const rootEntity = { id: 'app-1', name: 'Order Management System', type: ENTITY_TYPES.APPLICATION };

    const treeData = buildTreeData(metaModel, rootEntity);

    const allEntityTypes = getAllEntityTypes(treeData);
    expect(allEntityTypes.has(ENTITY_TYPES.BUSINESS_POINT)).toBe(false);
  });

  it('should never have APPLICATION_POINT entity type in the tree', () => {
    const metaModel = createMockMetaModelForPointResolution();
    const rootEntity = { id: 'app-1', name: 'Order Management System', type: ENTITY_TYPES.APPLICATION };

    const treeData = buildTreeData(metaModel, rootEntity);

    const allEntityTypes = getAllEntityTypes(treeData);
    expect(allEntityTypes.has(ENTITY_TYPES.APPLICATION_POINT)).toBe(false);
  });
});

// ============================================================================
// Test 6: Full hierarchy: Application -> Business Process -> Process Activity
// ============================================================================

describe('Point Resolution: Full hierarchy without Point intermediaries', () => {
  it('should show Application -> Business Process -> Process Activity hierarchy', () => {
    const metaModel = createMockMetaModelForPointResolution();
    const rootEntity = { id: 'app-1', name: 'Order Management System', type: ENTITY_TYPES.APPLICATION };

    const treeData = buildTreeData(metaModel, rootEntity);

    // Find Business Process bp-1 in tree (may be nested under Service due to deduplication)
    const bp1Nodes = findNodesByEntity(treeData, ENTITY_TYPES.BUSINESS_PROCESS, 'bp-1');

    // bp-1 should exist somewhere in the tree
    expect(bp1Nodes.length).toBe(1);

    const bp1Node = bp1Nodes[0];

    // bp-1 has process activities pa-1 and pa-2
    // But pa-1 might be deduplicated if it appears elsewhere
    const activityChildren = bp1Node.children.filter(
      (c) => c.entityType === ENTITY_TYPES.PROCESS_ACTIVITY
    );

    // At minimum, should have some activities
    // pa-2 should definitely be under bp-1 (it's not linked directly to any Application Point)
    expect(activityChildren.some((pa) => pa.entityId === 'pa-2')).toBe(true);
  });

  it('should have coherent tree without Point nodes at any level', () => {
    const metaModel = createMockMetaModelForPointResolution();
    const rootEntity = { id: 'app-1', name: 'Order Management System', type: ENTITY_TYPES.APPLICATION };

    const treeData = buildTreeData(metaModel, rootEntity);

    // Collect all nodes
    const allNodes: TreeNodeData[] = [];
    function collectAll(node: TreeNodeData) {
      allNodes.push(node);
      node.children.forEach(collectAll);
    }
    collectAll(treeData);

    // No node should be a Point type
    const pointNodes = allNodes.filter(
      (n) =>
        n.entityType === ENTITY_TYPES.BUSINESS_POINT ||
        n.entityType === ENTITY_TYPES.APPLICATION_POINT
    );

    expect(pointNodes.length).toBe(0);
  });
});

// ============================================================================
// Test 7: Interface -> Logical Data Entity shows as direct children
// ============================================================================

describe('Point Resolution: Interface -> Logical Data Entity direct children', () => {
  it('should show Logical Data Entities as direct children of Interface', () => {
    const metaModel = createMockMetaModelForInterfaceLogicalEntity();
    const rootEntity = { id: 'int-1', name: 'Test API', type: ENTITY_TYPES.INTERFACE };

    const treeData = buildTreeData(metaModel, rootEntity);

    // Interface should have Logical Data Entities as direct children
    const ldeChildren = treeData.children.filter(
      (child) => child.entityType === ENTITY_TYPES.LOGICAL_DATA_ENTITY
    );

    expect(ldeChildren.length).toBe(2);
    expect(ldeChildren.some((lde) => lde.entityId === 'lde-1')).toBe(true);
    expect(ldeChildren.some((lde) => lde.entityId === 'lde-2')).toBe(true);
  });

  it('should show Interface containing Logical Entities when traversing from Application', () => {
    const metaModel = createMockMetaModelForInterfaceLogicalEntity();
    const rootEntity = { id: 'app-1', name: 'Test App', type: ENTITY_TYPES.APPLICATION };

    const treeData = buildTreeData(metaModel, rootEntity);

    // Find the Interface node
    const interfaceNodes = findNodesByEntity(treeData, ENTITY_TYPES.INTERFACE, 'int-1');
    expect(interfaceNodes.length).toBe(1);

    // Interface should have Logical Data Entities as children
    const interfaceNode = interfaceNodes[0];
    const ldeChildren = interfaceNode.children.filter(
      (c) => c.entityType === ENTITY_TYPES.LOGICAL_DATA_ENTITY
    );

    expect(ldeChildren.length).toBe(2);
  });
});

// ============================================================================
// Test 8: Deduplication works correctly with resolved entities
// ============================================================================

describe('Point Resolution: Deduplication with resolved entities', () => {
  it('should deduplicate Business Process appearing via multiple Application Points', () => {
    const metaModel = createMockMetaModelForPointResolution();
    const rootEntity = { id: 'app-1', name: 'Order Management System', type: ENTITY_TYPES.APPLICATION };

    const treeData = buildTreeData(metaModel, rootEntity);

    // bp-1 is linked to both app-1's AP and svc-1's AP
    // It should appear only once in the tree due to deduplication
    const bp1Nodes = findNodesByEntity(treeData, ENTITY_TYPES.BUSINESS_PROCESS, 'bp-1');

    expect(bp1Nodes.length).toBe(1);
  });

  it('should handle Process Activity that is both directly linked and via Business Process', () => {
    const metaModel = createMockMetaModelForPointResolution();
    const rootEntity = { id: 'app-1', name: 'Order Management System', type: ENTITY_TYPES.APPLICATION };

    const treeData = buildTreeData(metaModel, rootEntity);

    // pa-1 is:
    // 1. Directly linked to app-1 via Business Point (kind: PROCESS_ACTIVITY)
    // 2. A child of bp-1 which is also linked to app-1
    // Due to deduplication, pa-1 should appear only once
    const pa1Nodes = findNodesByEntity(treeData, ENTITY_TYPES.PROCESS_ACTIVITY, 'pa-1');

    expect(pa1Nodes.length).toBe(1);
  });
});
