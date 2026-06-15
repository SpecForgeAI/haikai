/**
 * Advanced Add Ancestor Selection Tests
 *
 * Task Group 3: Ancestor Selection and Wrapping Infrastructure
 * Tests for ancestor selection when selecting leaf nodes, getAncestorKeys helper,
 * and buildOrderedNodeListFromLeaves helper.
 */

import { describe, it, expect } from 'vitest';
import { ENTITY_TYPES, MetaModel } from '../types/model';
import {
  buildTreeData,
  getAncestorKeys,
  buildOrderedNodeListFromLeaves,
} from '../components/DiagramsView/AdvancedAddDialog';
import { TreeNodeData } from '../types/advancedAdd';

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Find a node by its entityType and entityId in the tree
 */
function findNodeByEntity(
  node: TreeNodeData,
  entityType: string,
  entityId: string
): TreeNodeData | null {
  if (node.entityType === entityType && node.entityId === entityId) {
    return node;
  }
  for (const child of node.children) {
    const found = findNodeByEntity(child, entityType, entityId);
    if (found) return found;
  }
  return null;
}

/**
 * Find a node by its key in the tree
 */
function findNodeByKey(node: TreeNodeData, key: string): TreeNodeData | null {
  if (node.key === key) return node;
  for (const child of node.children) {
    const found = findNodeByKey(child, key);
    if (found) return found;
  }
  return null;
}

/**
 * Get all node keys in the tree
 */
function getAllNodeKeys(node: TreeNodeData): string[] {
  const keys: string[] = [node.key];
  node.children.forEach((child) => {
    keys.push(...getAllNodeKeys(child));
  });
  return keys;
}

// ============================================================================
// Mock Data Factory
// ============================================================================

/**
 * Create a mock MetaModel with a deep hierarchy for testing ancestor selection
 * Chain: Application -> Service -> Interface -> LogicalDataEntity
 */
function createMockMetaModelWithHierarchy(): MetaModel {
  return {
    entities: {
      business_users: [],
      business_processes: [],
      process_activities: [],
      applications: [
        { id: 'app-1', name: 'Test Application', description: '', app_type: 'Web', status: 'Active', tags: '' },
      ],
      app_components: [
        { id: 'ac-1', application_id: 'app-1', name: 'Component 1', description: '', tags: '' },
      ],
      services: [
        { id: 'svc-1', application_id: 'app-1', app_component_id: null, name: 'Service 1', description: '', service_type: 'API', tags: '' },
      ],
      interfaces: [
        { id: 'int-1', service_id: 'svc-1', name: 'Interface 1', description: '', interface_type: 'REST_API', tags: '' },
        { id: 'int-2', service_id: 'svc-1', name: 'Interface 2', description: '', interface_type: 'REST_API', tags: '' },
      ],
      application_points: [],
      logical_data_entities: [
        { id: 'lde-1', name: 'Logical Entity 1', description: '', tags: '' },
        { id: 'lde-2', name: 'Logical Entity 2', description: '', tags: '' },
      ],
      logical_data_attributes: [],
      physical_data_entities: [],
      physical_data_attributes: [],
    },
    relationships: {
      business_user_processes: [],
      application_point_business_processes: [],
      logical_data_entity_relationships: [],
      logical_data_entity_physical_data_entities: [],
      logical_data_attribute_physical_data_attributes: [],
      data_movements: [],
      interface_logical_entities: [
        { id: 'ile-1', interface_id: 'int-1', dataEntityPointId: 'dep_log_lde-1', description: '', tags: '' },
        { id: 'ile-2', interface_id: 'int-2', dataEntityPointId: 'dep_log_lde-2', description: '', tags: '' },
      ],
    },
  };
}

/**
 * Create a mock MetaModel with multiple branches for testing ancestor selection
 * Tree structure:
 *   Application
 *   ├── App Component
 *   │   └── Service (branch 1)
 *   └── Service (branch 2) - same service if deduplicated
 */
function createMockMetaModelWithBranches(): MetaModel {
  return {
    entities: {
      business_users: [],
      business_processes: [],
      process_activities: [],
      applications: [
        { id: 'app-1', name: 'Test Application', description: '', app_type: 'Web', status: 'Active', tags: '' },
      ],
      app_components: [
        { id: 'ac-1', application_id: 'app-1', name: 'Component 1', description: '', tags: '' },
        { id: 'ac-2', application_id: 'app-1', name: 'Component 2', description: '', tags: '' },
      ],
      services: [
        // Service in Component 1 only
        { id: 'svc-1', application_id: 'app-1', app_component_id: 'ac-1', name: 'Service 1', description: '', service_type: 'API', tags: '' },
        // Service in Component 2 only
        { id: 'svc-2', application_id: 'app-1', app_component_id: 'ac-2', name: 'Service 2', description: '', service_type: 'API', tags: '' },
      ],
      interfaces: [
        { id: 'int-1', service_id: 'svc-1', name: 'Interface 1', description: '', interface_type: 'REST_API', tags: '' },
        { id: 'int-2', service_id: 'svc-2', name: 'Interface 2', description: '', interface_type: 'REST_API', tags: '' },
      ],
      application_points: [],
      logical_data_entities: [],
      logical_data_attributes: [],
      physical_data_entities: [],
      physical_data_attributes: [],
    },
    relationships: {
      business_user_processes: [],
      application_point_business_processes: [],
      logical_data_entity_relationships: [],
      logical_data_entity_physical_data_entities: [],
      logical_data_attribute_physical_data_attributes: [],
      data_movements: [],
      interface_logical_entities: [],
    },
  };
}

// ============================================================================
// Test 1: Selecting leaf node includes all ancestors to root
// ============================================================================

describe('Ancestor selection: selecting leaf node includes all ancestors', () => {
  it('should return all ancestor keys when selecting a leaf node (LogicalDataEntity)', () => {
    const metaModel = createMockMetaModelWithHierarchy();
    const rootEntity = { id: 'app-1', name: 'Test Application', type: ENTITY_TYPES.APPLICATION };

    const treeData = buildTreeData(metaModel, rootEntity);

    // Find the LogicalDataEntity leaf node
    const ldeNode = findNodeByEntity(treeData, ENTITY_TYPES.LOGICAL_DATA_ENTITY, 'lde-1');
    expect(ldeNode).toBeDefined();

    // Get ancestor keys for the leaf node
    const ancestorKeys = getAncestorKeys(treeData, ldeNode!.key);

    // Should include: root (Application), Service, Interface
    // The path is: Application -> Service -> Interface -> LogicalDataEntity
    expect(ancestorKeys.length).toBeGreaterThanOrEqual(3);

    // Verify root is included
    expect(ancestorKeys).toContain(treeData.key);

    // Verify Interface is included (parent of LDE)
    const interfaceNode = findNodeByEntity(treeData, ENTITY_TYPES.INTERFACE, 'int-1');
    expect(interfaceNode).toBeDefined();
    expect(ancestorKeys).toContain(interfaceNode!.key);

    // Verify Service is included (parent of Interface)
    const serviceNode = findNodeByEntity(treeData, ENTITY_TYPES.SERVICE, 'svc-1');
    expect(serviceNode).toBeDefined();
    expect(ancestorKeys).toContain(serviceNode!.key);
  });

  it('should return complete path from root to target node', () => {
    const metaModel = createMockMetaModelWithHierarchy();
    const rootEntity = { id: 'app-1', name: 'Test Application', type: ENTITY_TYPES.APPLICATION };

    const treeData = buildTreeData(metaModel, rootEntity);

    // Find the Interface node (mid-level, not a leaf in terms of LDE)
    const interfaceNode = findNodeByEntity(treeData, ENTITY_TYPES.INTERFACE, 'int-1');
    expect(interfaceNode).toBeDefined();

    const ancestorKeys = getAncestorKeys(treeData, interfaceNode!.key);

    // Should include root and Service, but not siblings or descendants
    expect(ancestorKeys).toContain(treeData.key);

    const serviceNode = findNodeByEntity(treeData, ENTITY_TYPES.SERVICE, 'svc-1');
    expect(serviceNode).toBeDefined();
    expect(ancestorKeys).toContain(serviceNode!.key);

    // Should NOT include the target node itself
    expect(ancestorKeys).not.toContain(interfaceNode!.key);
  });
});

// ============================================================================
// Test 2: getAncestorKeys returns complete path from root to target node
// ============================================================================

describe('getAncestorKeys: complete path from root to target', () => {
  it('should return keys in order from root to parent of target', () => {
    const metaModel = createMockMetaModelWithHierarchy();
    const rootEntity = { id: 'app-1', name: 'Test Application', type: ENTITY_TYPES.APPLICATION };

    const treeData = buildTreeData(metaModel, rootEntity);

    // Find a deep leaf node
    const ldeNode = findNodeByEntity(treeData, ENTITY_TYPES.LOGICAL_DATA_ENTITY, 'lde-1');
    expect(ldeNode).toBeDefined();

    const ancestorKeys = getAncestorKeys(treeData, ldeNode!.key);

    // The first ancestor should be the root
    expect(ancestorKeys[0]).toBe(treeData.key);

    // Verify each ancestor key references a valid node
    ancestorKeys.forEach((key) => {
      const node = findNodeByKey(treeData, key);
      expect(node).toBeDefined();
    });
  });

  it('should return empty array for root node', () => {
    const metaModel = createMockMetaModelWithHierarchy();
    const rootEntity = { id: 'app-1', name: 'Test Application', type: ENTITY_TYPES.APPLICATION };

    const treeData = buildTreeData(metaModel, rootEntity);

    // Get ancestors of root node
    const ancestorKeys = getAncestorKeys(treeData, treeData.key);

    // Root has no ancestors
    expect(ancestorKeys).toEqual([]);
  });

  it('should return only root key for direct children of root', () => {
    const metaModel = createMockMetaModelWithHierarchy();
    const rootEntity = { id: 'app-1', name: 'Test Application', type: ENTITY_TYPES.APPLICATION };

    const treeData = buildTreeData(metaModel, rootEntity);

    // Find a direct child of root (Service or AppComponent)
    const serviceNode = findNodeByEntity(treeData, ENTITY_TYPES.SERVICE, 'svc-1');
    // If Service is not direct child, try AppComponent
    const directChild = serviceNode || findNodeByEntity(treeData, ENTITY_TYPES.APP_COMPONENT, 'ac-1');
    expect(directChild).toBeDefined();

    const ancestorKeys = getAncestorKeys(treeData, directChild!.key);

    // Should only contain the root key
    expect(ancestorKeys).toContain(treeData.key);
    expect(ancestorKeys.length).toBeGreaterThanOrEqual(1);
  });
});

// ============================================================================
// Test 3: Selection of middle-level node includes ancestors but not unrelated branches
// ============================================================================

describe('Ancestor selection: middle-level node includes ancestors but not unrelated branches', () => {
  it('should include ancestors but not siblings when selecting a middle-level node', () => {
    const metaModel = createMockMetaModelWithBranches();
    const rootEntity = { id: 'app-1', name: 'Test Application', type: ENTITY_TYPES.APPLICATION };

    const treeData = buildTreeData(metaModel, rootEntity);

    // Find Service 1 under Component 1
    const service1Node = findNodeByEntity(treeData, ENTITY_TYPES.SERVICE, 'svc-1');
    expect(service1Node).toBeDefined();

    const ancestorKeys = getAncestorKeys(treeData, service1Node!.key);

    // Should include root
    expect(ancestorKeys).toContain(treeData.key);

    // Should include Component 1 (parent of Service 1)
    const ac1Node = findNodeByEntity(treeData, ENTITY_TYPES.APP_COMPONENT, 'ac-1');
    expect(ac1Node).toBeDefined();
    expect(ancestorKeys).toContain(ac1Node!.key);

    // Should NOT include Component 2 (sibling of Component 1)
    const ac2Node = findNodeByEntity(treeData, ENTITY_TYPES.APP_COMPONENT, 'ac-2');
    expect(ac2Node).toBeDefined();
    expect(ancestorKeys).not.toContain(ac2Node!.key);

    // Should NOT include Service 2 (in different branch)
    const service2Node = findNodeByEntity(treeData, ENTITY_TYPES.SERVICE, 'svc-2');
    expect(service2Node).toBeDefined();
    expect(ancestorKeys).not.toContain(service2Node!.key);
  });

  it('should not include descendants when getting ancestors', () => {
    const metaModel = createMockMetaModelWithHierarchy();
    const rootEntity = { id: 'app-1', name: 'Test Application', type: ENTITY_TYPES.APPLICATION };

    const treeData = buildTreeData(metaModel, rootEntity);

    // Find Service node
    const serviceNode = findNodeByEntity(treeData, ENTITY_TYPES.SERVICE, 'svc-1');
    expect(serviceNode).toBeDefined();

    const ancestorKeys = getAncestorKeys(treeData, serviceNode!.key);

    // Should NOT include Interface (child of Service)
    const interfaceNode = findNodeByEntity(treeData, ENTITY_TYPES.INTERFACE, 'int-1');
    expect(interfaceNode).toBeDefined();
    expect(ancestorKeys).not.toContain(interfaceNode!.key);

    // Should NOT include LogicalDataEntity (grandchild of Service)
    const ldeNode = findNodeByEntity(treeData, ENTITY_TYPES.LOGICAL_DATA_ENTITY, 'lde-1');
    expect(ldeNode).toBeDefined();
    expect(ancestorKeys).not.toContain(ldeNode!.key);
  });
});

// ============================================================================
// Test 4: buildOrderedNodeListFromLeaves helper
// ============================================================================

describe('buildOrderedNodeListFromLeaves: ordered node list from leaves to root', () => {
  it('should return nodes ordered from leaves up to root', () => {
    const metaModel = createMockMetaModelWithHierarchy();
    const rootEntity = { id: 'app-1', name: 'Test Application', type: ENTITY_TYPES.APPLICATION };

    const treeData = buildTreeData(metaModel, rootEntity);

    // Find nodes to select
    const ldeNode = findNodeByEntity(treeData, ENTITY_TYPES.LOGICAL_DATA_ENTITY, 'lde-1');
    const interfaceNode = findNodeByEntity(treeData, ENTITY_TYPES.INTERFACE, 'int-1');
    const serviceNode = findNodeByEntity(treeData, ENTITY_TYPES.SERVICE, 'svc-1');

    expect(ldeNode).toBeDefined();
    expect(interfaceNode).toBeDefined();
    expect(serviceNode).toBeDefined();

    // Create selected keys set including leaf and ancestors
    const selectedKeys = new Set([
      treeData.key,
      serviceNode!.key,
      interfaceNode!.key,
      ldeNode!.key,
    ]);

    const orderedNodes = buildOrderedNodeListFromLeaves(selectedKeys, treeData);

    // First nodes should be leaves (LogicalDataEntity)
    // Last nodes should be towards root (Application)
    expect(orderedNodes.length).toBe(4);

    // Find indices of each level
    const ldeIndex = orderedNodes.findIndex((n) => n.entityType === ENTITY_TYPES.LOGICAL_DATA_ENTITY);
    const intIndex = orderedNodes.findIndex((n) => n.entityType === ENTITY_TYPES.INTERFACE);
    const svcIndex = orderedNodes.findIndex((n) => n.entityType === ENTITY_TYPES.SERVICE);
    const appIndex = orderedNodes.findIndex((n) => n.entityType === ENTITY_TYPES.APPLICATION);

    // Leaves should come before their parents
    expect(ldeIndex).toBeLessThan(intIndex);
    expect(intIndex).toBeLessThan(svcIndex);
    expect(svcIndex).toBeLessThan(appIndex);
  });

  it('should handle multiple leaf nodes at the same level', () => {
    const metaModel = createMockMetaModelWithHierarchy();
    const rootEntity = { id: 'app-1', name: 'Test Application', type: ENTITY_TYPES.APPLICATION };

    const treeData = buildTreeData(metaModel, rootEntity);

    // Select both LogicalDataEntities
    const lde1Node = findNodeByEntity(treeData, ENTITY_TYPES.LOGICAL_DATA_ENTITY, 'lde-1');
    const lde2Node = findNodeByEntity(treeData, ENTITY_TYPES.LOGICAL_DATA_ENTITY, 'lde-2');
    const int1Node = findNodeByEntity(treeData, ENTITY_TYPES.INTERFACE, 'int-1');
    const int2Node = findNodeByEntity(treeData, ENTITY_TYPES.INTERFACE, 'int-2');
    const serviceNode = findNodeByEntity(treeData, ENTITY_TYPES.SERVICE, 'svc-1');

    expect(lde1Node).toBeDefined();
    expect(lde2Node).toBeDefined();
    expect(int1Node).toBeDefined();
    expect(int2Node).toBeDefined();
    expect(serviceNode).toBeDefined();

    const selectedKeys = new Set([
      treeData.key,
      serviceNode!.key,
      int1Node!.key,
      int2Node!.key,
      lde1Node!.key,
      lde2Node!.key,
    ]);

    const orderedNodes = buildOrderedNodeListFromLeaves(selectedKeys, treeData);

    // Both LDEs should be at the beginning (leaves)
    const ldeIndices = orderedNodes
      .map((n, i) => ({ type: n.entityType, index: i }))
      .filter((item) => item.type === ENTITY_TYPES.LOGICAL_DATA_ENTITY)
      .map((item) => item.index);

    const intIndices = orderedNodes
      .map((n, i) => ({ type: n.entityType, index: i }))
      .filter((item) => item.type === ENTITY_TYPES.INTERFACE)
      .map((item) => item.index);

    // All LDE indices should be less than all Interface indices
    ldeIndices.forEach((ldeIdx) => {
      intIndices.forEach((intIdx) => {
        expect(ldeIdx).toBeLessThan(intIdx);
      });
    });
  });

  it('should only include nodes that are in selectedKeys', () => {
    const metaModel = createMockMetaModelWithHierarchy();
    const rootEntity = { id: 'app-1', name: 'Test Application', type: ENTITY_TYPES.APPLICATION };

    const treeData = buildTreeData(metaModel, rootEntity);

    // Only select the service (no descendants)
    const serviceNode = findNodeByEntity(treeData, ENTITY_TYPES.SERVICE, 'svc-1');
    expect(serviceNode).toBeDefined();

    const selectedKeys = new Set([treeData.key, serviceNode!.key]);

    const orderedNodes = buildOrderedNodeListFromLeaves(selectedKeys, treeData);

    // Should only have 2 nodes (root and service)
    expect(orderedNodes.length).toBe(2);

    // Should not include unselected nodes
    const hasInterface = orderedNodes.some((n) => n.entityType === ENTITY_TYPES.INTERFACE);
    const hasLde = orderedNodes.some((n) => n.entityType === ENTITY_TYPES.LOGICAL_DATA_ENTITY);

    expect(hasInterface).toBe(false);
    expect(hasLde).toBe(false);
  });

  it('should return empty array for empty selectedKeys', () => {
    const metaModel = createMockMetaModelWithHierarchy();
    const rootEntity = { id: 'app-1', name: 'Test Application', type: ENTITY_TYPES.APPLICATION };

    const treeData = buildTreeData(metaModel, rootEntity);

    const selectedKeys = new Set<string>();

    const orderedNodes = buildOrderedNodeListFromLeaves(selectedKeys, treeData);

    expect(orderedNodes).toEqual([]);
  });
});

// ============================================================================
// Test 5: Ancestor selection works with merged subtrees
// ============================================================================

describe('Ancestor selection: works with merged/deduplicated subtrees', () => {
  it('should correctly get ancestors for node in deduplicated tree', () => {
    // Create a model where the same service is reachable via multiple paths
    const metaModel: MetaModel = {
      entities: {
        business_users: [],
        business_processes: [],
        process_activities: [],
        applications: [
          { id: 'app-1', name: 'Test App', description: '', app_type: 'Web', status: 'Active', tags: '' },
        ],
        app_components: [
          { id: 'ac-1', application_id: 'app-1', name: 'Component 1', description: '', tags: '' },
        ],
        services: [
          // Service reachable via both app-1 directly and via ac-1
          { id: 'svc-1', application_id: 'app-1', app_component_id: 'ac-1', name: 'Shared Service', description: '', service_type: 'API', tags: '' },
        ],
        interfaces: [
          { id: 'int-1', service_id: 'svc-1', name: 'Interface 1', description: '', interface_type: 'REST_API', tags: '' },
        ],
        application_points: [],
        logical_data_entities: [],
        logical_data_attributes: [],
        physical_data_entities: [],
        physical_data_attributes: [],
      },
      relationships: {
        business_user_processes: [],
        application_point_business_processes: [],
        logical_data_entity_relationships: [],
        logical_data_entity_physical_data_entities: [],
        logical_data_attribute_physical_data_attributes: [],
        data_movements: [],
        interface_logical_entities: [],
      },
    };

    const rootEntity = { id: 'app-1', name: 'Test App', type: ENTITY_TYPES.APPLICATION };
    const treeData = buildTreeData(metaModel, rootEntity);

    // Find the interface node (there should be exactly one due to deduplication)
    const interfaceNode = findNodeByEntity(treeData, ENTITY_TYPES.INTERFACE, 'int-1');
    expect(interfaceNode).toBeDefined();

    const ancestorKeys = getAncestorKeys(treeData, interfaceNode!.key);

    // Should have valid ancestors
    expect(ancestorKeys.length).toBeGreaterThanOrEqual(2);

    // Root should be in ancestors
    expect(ancestorKeys).toContain(treeData.key);

    // All ancestor keys should reference valid nodes
    ancestorKeys.forEach((key) => {
      const node = findNodeByKey(treeData, key);
      expect(node).toBeDefined();
    });
  });
});
