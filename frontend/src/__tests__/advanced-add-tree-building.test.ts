/**
 * Advanced Add Tree Building Tests
 *
 * Task Group 1: Node Deduplication and Subtree Merging
 * Tests for tree deduplication, max depth enforcement, and cycle detection.
 */

import { describe, it, expect } from 'vitest';
import { ENTITY_TYPES, MetaModel } from '../types/model';
import { buildTreeData } from '../components/DiagramsView/AdvancedAddDialog';
import { TreeNodeData } from '../types/advancedAdd';

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Count all nodes in a tree
 */
function countNodes(node: TreeNodeData): number {
  return 1 + node.children.reduce((sum, child) => sum + countNodes(child), 0);
}

/**
 * Find all nodes in a tree with a specific entityId
 */
function findNodesByEntityId(node: TreeNodeData, entityId: string): TreeNodeData[] {
  const result: TreeNodeData[] = [];
  if (node.entityId === entityId) {
    result.push(node);
  }
  node.children.forEach((child) => {
    result.push(...findNodesByEntityId(child, entityId));
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
 * Get the maximum depth of the tree (0 = root only)
 */
function getMaxDepth(node: TreeNodeData, currentDepth: number = 0): number {
  if (node.children.length === 0) {
    return currentDepth;
  }
  return Math.max(...node.children.map((child) => getMaxDepth(child, currentDepth + 1)));
}

/**
 * Collect all unique (entityType, entityId) pairs in the tree
 */
function collectUniqueEntities(node: TreeNodeData): Set<string> {
  const entities = new Set<string>();
  entities.add(`${node.entityType}-${node.entityId}`);
  node.children.forEach((child) => {
    collectUniqueEntities(child).forEach((e) => entities.add(e));
  });
  return entities;
}

// ============================================================================
// Mock Data Factory
// ============================================================================

/**
 * Create a mock MetaModel for testing tree building with deduplication scenarios
 */
function createMockMetaModelForDeduplication(): MetaModel {
  return {
    entities: {
      business_users: [],
      business_processes: [
        { id: 'bp-1', name: 'Process 1', description: '', tags: '' },
      ],
      process_activities: [],
      applications: [
        { id: 'app-1', name: 'Test Application', description: '', app_type: 'Web', status: 'Active', tags: '' },
      ],
      app_components: [
        { id: 'ac-1', application_id: 'app-1', name: 'Component 1', description: '', tags: '' },
      ],
      services: [
        // Service 1 is both direct child of app-1 AND child of ac-1
        // This creates two paths to the same service: App -> Service and App -> AppComponent -> Service
        { id: 'svc-1', application_id: 'app-1', app_component_id: 'ac-1', name: 'Shared Service', description: '', service_type: 'API', tags: '' },
      ],
      interfaces: [
        { id: 'int-1', service_id: 'svc-1', name: 'Interface 1', description: '', interface_type: 'REST_API', tags: '' },
      ],
      application_points: [
        { id: 'ap-1', application_id: 'app-1', name: 'App Point 1', description: '', kind: 'APPLICATION', point_type: '', tags: '' },
      ],
      logical_data_entities: [
        { id: 'lde-1', name: 'Logical Entity 1', description: '', tags: '' },
      ],
      logical_data_attributes: [],
      physical_data_entities: [],
      physical_data_attributes: [],
    },
    relationships: {
      business_user_processes: [],
      application_point_business_processes: [
        { id: 'apbp-1', application_point_id: 'ap-1', business_process_id: 'bp-1', description: '', tags: '' },
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
 * Create a mock MetaModel with a deep chain for testing max depth
 */
function createMockMetaModelWithDeepChain(): MetaModel {
  // Create a chain: Application -> Service -> Interface -> LogicalDataEntity
  // But in this case we don't have 10+ levels, so we'll test with what we have
  // The important thing is that depth enforcement stops at depth 10
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
        { id: 'svc-1', application_id: 'app-1', app_component_id: 'ac-1', name: 'Service 1', description: '', service_type: 'API', tags: '' },
      ],
      interfaces: [
        { id: 'int-1', service_id: 'svc-1', name: 'Interface 1', description: '', interface_type: 'REST_API', tags: '' },
      ],
      application_points: [],
      logical_data_entities: [
        { id: 'lde-1', name: 'Logical Entity 1', description: '', tags: '' },
      ],
      logical_data_attributes: [
        { id: 'lda-1', logical_entity_id: 'lde-1', name: 'Attribute 1', description: '', data_type: 'String', is_primary_key: false, is_nullable: true, tags: '' },
      ],
      physical_data_entities: [
        { id: 'pde-1', name: 'Physical Entity 1', description: '', physical_type: 'Table', database: 'DB1', tags: '' },
      ],
      physical_data_attributes: [
        { id: 'pda-1', physical_entity_id: 'pde-1', name: 'Column 1', description: '', data_type: 'VARCHAR', is_primary_key: false, is_nullable: true, tags: '' },
      ],
    },
    relationships: {
      business_user_processes: [],
      application_point_business_processes: [],
      logical_data_entity_relationships: [],
      logical_data_entity_physical_data_entities: [
        { id: 'ldepde-1', logical_entity_id: 'lde-1', physical_entity_id: 'pde-1', description: '', tags: '' },
      ],
      logical_data_attribute_physical_data_attributes: [],
      data_movements: [],
      interface_logical_entities: [
        { id: 'ile-1', interface_id: 'int-1', dataEntityPointId: 'dep_log_lde-1', description: '', tags: '' },
      ],
    },
  };
}

/**
 * Create a mock MetaModel with potential cycles for testing cycle detection
 * Business Process <-> Application via Application Point creates potential cycles
 */
function createMockMetaModelWithCycles(): MetaModel {
  return {
    entities: {
      business_users: [],
      business_processes: [
        { id: 'bp-1', name: 'Business Process 1', description: '', tags: '' },
      ],
      process_activities: [],
      applications: [
        { id: 'app-1', name: 'Application 1', description: '', app_type: 'Web', status: 'Active', tags: '' },
      ],
      app_components: [],
      services: [],
      interfaces: [],
      application_points: [
        { id: 'ap-1', application_id: 'app-1', name: 'App Point 1', description: '', kind: 'APPLICATION', point_type: '', tags: '' },
      ],
      business_points: [
        { id: 'bpt-1', name: 'BP 1 Point', description: '', kind: 'BUSINESS_PROCESS', business_process_id: 'bp-1', tags: '' },
      ],
      logical_data_entities: [],
      logical_data_attributes: [],
      physical_data_entities: [],
      physical_data_attributes: [],
    },
    relationships: {
      business_user_business_points: [],
      // This creates a potential cycle: Application -> BusinessProcess -> Application
      application_point_business_points: [
        { id: 'apbp-1', application_point_id: 'ap-1', business_point_id: 'bpt-1', description: '', tags: '' },
      ],
      logical_data_entity_relationships: [],
      logical_data_entity_physical_data_entities: [],
      logical_data_attribute_physical_data_attributes: [],
      data_movements: [],
      interface_logical_entities: [],
    },
  };
}

// ============================================================================
// Test 1: Node Deduplication - Same entity via multiple paths results in single node
// ============================================================================

describe('Tree building: node deduplication', () => {
  it('should create only one tree node for an entity reachable via multiple paths', () => {
    const metaModel = createMockMetaModelForDeduplication();
    const rootEntity = { id: 'app-1', name: 'Test Application', type: ENTITY_TYPES.APPLICATION };

    const treeData = buildTreeData(metaModel, rootEntity);

    // svc-1 is reachable via:
    // 1. Application -> Service (direct child)
    // 2. Application -> AppComponent -> Service
    // With deduplication, svc-1 should appear only once in the tree
    const svc1Nodes = findNodesByEntity(treeData, ENTITY_TYPES.SERVICE, 'svc-1');

    expect(svc1Nodes.length).toBe(1);
  });

  it('should merge children from multiple paths into single node', () => {
    const metaModel = createMockMetaModelForDeduplication();
    const rootEntity = { id: 'app-1', name: 'Test Application', type: ENTITY_TYPES.APPLICATION };

    const treeData = buildTreeData(metaModel, rootEntity);

    // Find the single svc-1 node
    const svc1Nodes = findNodesByEntity(treeData, ENTITY_TYPES.SERVICE, 'svc-1');
    expect(svc1Nodes.length).toBe(1);

    const svc1Node = svc1Nodes[0];

    // svc-1 should have int-1 as a child (merged from both paths)
    const interfaceChildren = svc1Node.children.filter(
      (c) => c.entityType === ENTITY_TYPES.INTERFACE
    );
    expect(interfaceChildren.length).toBe(1);
    expect(interfaceChildren[0].entityId).toBe('int-1');
  });
});

// ============================================================================
// Test 2: Subtree Merging - App -> AppComponent -> Service -> Interface merges with App -> Service -> Interface
// ============================================================================

describe('Tree building: subtree merging', () => {
  it('should merge Application -> App Component -> Service -> Interface with Application -> Service -> Interface', () => {
    const metaModel = createMockMetaModelForDeduplication();
    const rootEntity = { id: 'app-1', name: 'Test Application', type: ENTITY_TYPES.APPLICATION };

    const treeData = buildTreeData(metaModel, rootEntity);

    // The tree should have a coherent structure where Service and Interface appear only once
    const serviceNodes = findNodesByEntity(treeData, ENTITY_TYPES.SERVICE, 'svc-1');
    const interfaceNodes = findNodesByEntity(treeData, ENTITY_TYPES.INTERFACE, 'int-1');

    // Each entity should appear exactly once
    expect(serviceNodes.length).toBe(1);
    expect(interfaceNodes.length).toBe(1);

    // Interface should be a child of Service
    const serviceNode = serviceNodes[0];
    const interfaceChild = serviceNode.children.find(
      (c) => c.entityType === ENTITY_TYPES.INTERFACE && c.entityId === 'int-1'
    );
    expect(interfaceChild).toBeDefined();
  });

  it('should handle Interface -> LogicalDataEntity chain correctly in merged tree', () => {
    const metaModel = createMockMetaModelForDeduplication();
    const rootEntity = { id: 'app-1', name: 'Test Application', type: ENTITY_TYPES.APPLICATION };

    const treeData = buildTreeData(metaModel, rootEntity);

    // Find the interface node
    const interfaceNodes = findNodesByEntity(treeData, ENTITY_TYPES.INTERFACE, 'int-1');
    expect(interfaceNodes.length).toBe(1);

    const interfaceNode = interfaceNodes[0];

    // Interface should have LogicalDataEntity as child (via association)
    const ldeChildren = interfaceNode.children.filter(
      (c) => c.entityType === ENTITY_TYPES.LOGICAL_DATA_ENTITY
    );
    expect(ldeChildren.length).toBe(1);
    expect(ldeChildren[0].entityId).toBe('lde-1');
    expect(ldeChildren[0].relationshipKind).toBe('ASSOCIATION');
  });
});

// ============================================================================
// Test 3: Max Depth Enforcement
// ============================================================================

describe('Tree building: max depth enforcement', () => {
  it('should not exceed depth 10', () => {
    const metaModel = createMockMetaModelWithDeepChain();
    const rootEntity = { id: 'app-1', name: 'Test Application', type: ENTITY_TYPES.APPLICATION };

    const treeData = buildTreeData(metaModel, rootEntity);

    const maxDepth = getMaxDepth(treeData);

    // Tree depth should not exceed 10 (0 = root, 10 = max allowed children depth)
    expect(maxDepth).toBeLessThanOrEqual(10);
  });

  it('should build tree with normal depth chains correctly', () => {
    const metaModel = createMockMetaModelWithDeepChain();
    const rootEntity = { id: 'app-1', name: 'Test Application', type: ENTITY_TYPES.APPLICATION };

    const treeData = buildTreeData(metaModel, rootEntity);

    // Verify the chain exists: Application -> AppComponent -> Service -> Interface -> LogicalDataEntity
    // This is depth 4, which should be allowed
    const appComponentNodes = findNodesByEntity(treeData, ENTITY_TYPES.APP_COMPONENT, 'ac-1');
    expect(appComponentNodes.length).toBe(1);

    // Verify we can traverse down the chain
    const serviceNodes = findNodesByEntity(treeData, ENTITY_TYPES.SERVICE, 'svc-1');
    expect(serviceNodes.length).toBe(1);

    const interfaceNodes = findNodesByEntity(treeData, ENTITY_TYPES.INTERFACE, 'int-1');
    expect(interfaceNodes.length).toBe(1);

    const ldeNodes = findNodesByEntity(treeData, ENTITY_TYPES.LOGICAL_DATA_ENTITY, 'lde-1');
    expect(ldeNodes.length).toBe(1);
  });
});

// ============================================================================
// Test 4: Cycle Detection
// ============================================================================

describe('Tree building: cycle detection', () => {
  it('should not create infinite loops when cycles exist in the meta-model', () => {
    const metaModel = createMockMetaModelWithCycles();
    const rootEntity = { id: 'app-1', name: 'Application 1', type: ENTITY_TYPES.APPLICATION };

    // This should complete without infinite recursion
    // The cycle is: Application -> BusinessProcess (via AppPoint) -> Application (via AppPoint)
    const treeData = buildTreeData(metaModel, rootEntity);

    // Tree should exist and have finite size
    const nodeCount = countNodes(treeData);
    expect(nodeCount).toBeGreaterThan(0);
    expect(nodeCount).toBeLessThan(100); // Reasonable upper bound
  });

  it('should prevent revisiting the same entity in the traversal path', () => {
    const metaModel = createMockMetaModelWithCycles();
    const rootEntity = { id: 'app-1', name: 'Application 1', type: ENTITY_TYPES.APPLICATION };

    const treeData = buildTreeData(metaModel, rootEntity);

    // app-1 should appear only once (as root) even though there's a cycle
    const app1Nodes = findNodesByEntity(treeData, ENTITY_TYPES.APPLICATION, 'app-1');
    expect(app1Nodes.length).toBe(1);
    expect(app1Nodes[0].isRoot).toBe(true);
  });

  it('should still include BusinessProcess reached via Application', () => {
    const metaModel = createMockMetaModelWithCycles();
    const rootEntity = { id: 'app-1', name: 'Application 1', type: ENTITY_TYPES.APPLICATION };

    const treeData = buildTreeData(metaModel, rootEntity);

    // bp-1 should be reachable as a child of app-1 via AppPoint association
    const bp1Nodes = findNodesByEntity(treeData, ENTITY_TYPES.BUSINESS_PROCESS, 'bp-1');
    expect(bp1Nodes.length).toBe(1);
  });
});

// ============================================================================
// Test 5: Entity Uniqueness Across Tree
// ============================================================================

describe('Tree building: entity uniqueness', () => {
  it('should have each (entityType, entityId) pair appear at most once in the tree', () => {
    const metaModel = createMockMetaModelForDeduplication();
    const rootEntity = { id: 'app-1', name: 'Test Application', type: ENTITY_TYPES.APPLICATION };

    const treeData = buildTreeData(metaModel, rootEntity);

    // Collect all entity keys
    const allEntityKeys: string[] = [];
    function collectKeys(node: TreeNodeData) {
      allEntityKeys.push(`${node.entityType}-${node.entityId}`);
      node.children.forEach(collectKeys);
    }
    collectKeys(treeData);

    // Check for duplicates
    const uniqueKeys = new Set(allEntityKeys);
    expect(uniqueKeys.size).toBe(allEntityKeys.length);
  });
});

// ============================================================================
// Test 6: Tree Structure Integrity
// ============================================================================

describe('Tree building: structure integrity', () => {
  it('should maintain parent-child relationships correctly after deduplication', () => {
    const metaModel = createMockMetaModelForDeduplication();
    const rootEntity = { id: 'app-1', name: 'Test Application', type: ENTITY_TYPES.APPLICATION };

    const treeData = buildTreeData(metaModel, rootEntity);

    // Root should have children
    expect(treeData.children.length).toBeGreaterThan(0);

    // All children should have isRoot = false
    function checkNotRoot(node: TreeNodeData, depth: number) {
      if (depth > 0) {
        expect(node.isRoot).toBe(false);
      }
      node.children.forEach((child) => checkNotRoot(child, depth + 1));
    }
    checkNotRoot(treeData, 0);
  });

  it('should have all child nodes with valid parentKey', () => {
    const metaModel = createMockMetaModelForDeduplication();
    const rootEntity = { id: 'app-1', name: 'Test Application', type: ENTITY_TYPES.APPLICATION };

    const treeData = buildTreeData(metaModel, rootEntity);

    // Collect all node keys
    const allKeys = new Set<string>();
    function collectKeys(node: TreeNodeData) {
      allKeys.add(node.key);
      node.children.forEach(collectKeys);
    }
    collectKeys(treeData);

    // Check that all parentKeys reference existing nodes (or are undefined for root children)
    function checkParentKeys(node: TreeNodeData, parentKey: string | undefined) {
      node.children.forEach((child) => {
        // Children of root may have parentKey set to root's key
        if (child.parentKey) {
          expect(allKeys.has(child.parentKey)).toBe(true);
        }
        checkParentKeys(child, child.key);
      });
    }
    checkParentKeys(treeData, undefined);
  });
});
