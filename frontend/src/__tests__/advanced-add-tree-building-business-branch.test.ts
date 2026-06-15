/**
 * Advanced Add Tree Building Tests - Business Branch
 *
 * Task Group 2: Tests for tree building with business branch support.
 * Verifies that:
 * - findRelatedEntities() handles UNDERLYING direction for BUSINESS_PROCESS and PROCESS_ACTIVITY targets
 * - buildTreeData() shows Business Process branch under Application
 * - buildTreeData() shows Process Activity branch under Business Process
 * - Deduplication does not incorrectly remove business branch when technical branch exists
 * - Both technical and business branches are visible under the same Application
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
 * Check if a node has a child with specific entityType and entityId
 */
function hasChildWithEntity(
  parent: TreeNodeData,
  entityType: string,
  entityId: string
): boolean {
  return parent.children.some(
    (child) => child.entityType === entityType && child.entityId === entityId
  );
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

// ============================================================================
// Mock Data Factory - Business Branch Scenarios
// ============================================================================

/**
 * Create a mock MetaModel with Business Point -> Business Process/Process Activity relationships
 * This tests the UNDERLYING direction resolution
 */
function createMockMetaModelWithBusinessBranch(): MetaModel {
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
      ],
      business_points: [
        // Business Point for a Business Process
        { id: 'bpt-1', name: 'Order Processing BP', description: '', kind: 'BUSINESS_PROCESS', business_process_id: 'bp-1', tags: '' },
        // Business Point for a Process Activity
        { id: 'bpt-2', name: 'Validate Order BP', description: '', kind: 'PROCESS_ACTIVITY', business_process_id: 'bp-1', process_activity_id: 'pa-1', tags: '' },
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
        { id: 'ap-1', application_id: 'app-1', name: 'App Point 1', description: '', kind: 'APPLICATION', point_type: '', tags: '' },
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
      // Application -> Business Point relationships via Application Point
      application_point_business_points: [
        { id: 'apbp-1', application_point_id: 'ap-1', business_point_id: 'bpt-1', description: '', tags: '' },
        { id: 'apbp-2', application_point_id: 'ap-1', business_point_id: 'bpt-2', description: '', tags: '' },
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
 * Create a mock MetaModel with both technical and business branches under same Application
 * Used to test that deduplication doesn't incorrectly remove business branch
 */
function createMockMetaModelWithBothBranches(): MetaModel {
  return {
    entities: {
      business_users: [],
      business_processes: [
        { id: 'bp-1', name: 'Order Processing', description: '', tags: '' },
      ],
      process_activities: [
        { id: 'pa-1', business_process_id: 'bp-1', name: 'Validate Order', description: '', sequence_order: 1, actor_hint: 'END_USER', user_interaction_level: 'MODERATE', tags: '' },
        { id: 'pa-2', business_process_id: 'bp-1', name: 'Process Payment', description: '', sequence_order: 2, actor_hint: 'INTERNAL_SYSTEM', user_interaction_level: 'AUTOMATED', tags: '' },
      ],
      business_points: [
        { id: 'bpt-1', name: 'Order Processing BP', description: '', kind: 'BUSINESS_PROCESS', business_process_id: 'bp-1', tags: '' },
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
        { id: 'ap-1', application_id: 'app-1', name: 'App Point 1', description: '', kind: 'APPLICATION', point_type: '', tags: '' },
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
      application_point_business_points: [
        { id: 'apbp-1', application_point_id: 'ap-1', business_point_id: 'bpt-1', description: '', tags: '' },
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
 * Create a minimal MetaModel for testing UNDERLYING direction to PROCESS_ACTIVITY
 * This mock has NO application relationships to isolate the UNDERLYING test
 */
function createMockMetaModelForUnderlyingProcessActivity(): MetaModel {
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
        // Only one Business Point that wraps a Process Activity
        { id: 'bpt-activity', name: 'Validate Order BP', description: '', kind: 'PROCESS_ACTIVITY', business_process_id: 'bp-1', process_activity_id: 'pa-1', tags: '' },
      ],
      applications: [],
      app_components: [],
      services: [],
      interfaces: [],
      application_points: [],
      logical_data_entities: [],
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
      interface_logical_entities: [],
    },
  };
}


// ============================================================================
// Test 1: findRelatedEntities handles UNDERLYING direction for BUSINESS_PROCESS target
// ============================================================================

describe('Tree building: UNDERLYING direction for BUSINESS_PROCESS', () => {
  it('should resolve Business Point to underlying Business Process when kind is BUSINESS_PROCESS', () => {
    const metaModel = createMockMetaModelWithBusinessBranch();

    // Create a tree starting from a Business Point that wraps a Business Process
    const rootEntity = { id: 'bpt-1', name: 'Order Processing BP', type: ENTITY_TYPES.BUSINESS_POINT };
    const treeData = buildTreeData(metaModel, rootEntity);

    // The Business Point should have the underlying Business Process as a child
    const businessProcessNodes = findNodesByEntityType(treeData, ENTITY_TYPES.BUSINESS_PROCESS);

    expect(businessProcessNodes.length).toBe(1);
    expect(businessProcessNodes[0].entityId).toBe('bp-1');
    expect(businessProcessNodes[0].entityName).toBe('Order Processing');
  });
});

// ============================================================================
// Test 2: findRelatedEntities handles UNDERLYING direction for PROCESS_ACTIVITY target
// ============================================================================

describe('Tree building: UNDERLYING direction for PROCESS_ACTIVITY', () => {
  it('should resolve Business Point to underlying Process Activity when kind is PROCESS_ACTIVITY', () => {
    // Use a minimal mock to test UNDERLYING in isolation (no APPLICATION relationships)
    const metaModel = createMockMetaModelForUnderlyingProcessActivity();

    // Create a tree starting from a Business Point that wraps a Process Activity
    const rootEntity = { id: 'bpt-activity', name: 'Validate Order BP', type: ENTITY_TYPES.BUSINESS_POINT };
    const treeData = buildTreeData(metaModel, rootEntity);

    // The Business Point (root) should have the underlying Process Activity as a DIRECT child
    const directProcessActivityChildren = treeData.children.filter(
      (child) => child.entityType === ENTITY_TYPES.PROCESS_ACTIVITY
    );

    expect(directProcessActivityChildren.length).toBe(1);
    expect(directProcessActivityChildren[0].entityId).toBe('pa-1');
    expect(directProcessActivityChildren[0].entityName).toBe('Validate Order');
  });
});

// ============================================================================
// Test 3: buildTreeData shows Business Point branch under Application
// ============================================================================

describe('Tree building: Business Point branch under Application', () => {
  // Super-class aware traversal: Business Point nodes NEVER appear in the
  // tree -- they are resolved to their concrete underlying entities
  // (Business Process / Process Activity) which appear directly under the
  // Application.
  it('should resolve Business Points to concrete entities under Application via application_point_business_points', () => {
    const metaModel = createMockMetaModelWithBusinessBranch();
    const rootEntity = { id: 'app-1', name: 'Order Management System', type: ENTITY_TYPES.APPLICATION };

    const treeData = buildTreeData(metaModel, rootEntity);

    // No Business Point nodes in the tree
    const businessPointNodes = findNodesByEntityType(treeData, ENTITY_TYPES.BUSINESS_POINT);
    expect(businessPointNodes.length).toBe(0);

    // The concrete entities the Business Points wrap ARE reachable
    expect(hasPathToEntity(treeData, ENTITY_TYPES.BUSINESS_PROCESS, 'bp-1')).toBe(true);
    expect(hasPathToEntity(treeData, ENTITY_TYPES.PROCESS_ACTIVITY, 'pa-1')).toBe(true);
  });

  it('should show Business Process directly under Application (no Business Point hop)', () => {
    const metaModel = createMockMetaModelWithBusinessBranch();
    const rootEntity = { id: 'app-1', name: 'Order Management System', type: ENTITY_TYPES.APPLICATION };

    const treeData = buildTreeData(metaModel, rootEntity);

    const businessProcessNodes = findNodesByEntityType(treeData, ENTITY_TYPES.BUSINESS_PROCESS);
    expect(businessProcessNodes.length).toBeGreaterThan(0);
    expect(businessProcessNodes.some(bp => bp.entityId === 'bp-1')).toBe(true);

    // The Business Process appears as a direct child of the Application root
    expect(hasChildWithEntity(treeData, ENTITY_TYPES.BUSINESS_PROCESS, 'bp-1')).toBe(true);
  });
});

// ============================================================================
// Test 4: buildTreeData shows Process Activity branch under Business Process
// ============================================================================

describe('Tree building: Process Activity under Business Process', () => {
  it('should show Process Activities as children of Business Process', () => {
    const metaModel = createMockMetaModelWithBusinessBranch();

    // Start from Business Process directly
    const rootEntity = { id: 'bp-1', name: 'Order Processing', type: ENTITY_TYPES.BUSINESS_PROCESS };
    const treeData = buildTreeData(metaModel, rootEntity);

    // Business Process should have Process Activities as children
    const processActivityNodes = findNodesByEntityType(treeData, ENTITY_TYPES.PROCESS_ACTIVITY);

    // bp-1 has 2 process activities: pa-1 and pa-2
    expect(processActivityNodes.length).toBe(2);
    expect(processActivityNodes.some(pa => pa.entityId === 'pa-1')).toBe(true);
    expect(processActivityNodes.some(pa => pa.entityId === 'pa-2')).toBe(true);
  });

  it('should show Process Activities under Business Process in full Application tree', () => {
    const metaModel = createMockMetaModelWithBusinessBranch();
    const rootEntity = { id: 'app-1', name: 'Order Management System', type: ENTITY_TYPES.APPLICATION };

    const treeData = buildTreeData(metaModel, rootEntity);

    // Find Business Process in the tree
    const businessProcessNodes = findNodesByEntity(treeData, ENTITY_TYPES.BUSINESS_PROCESS, 'bp-1');

    // If Business Process is found, it should have Process Activities as children
    if (businessProcessNodes.length > 0) {
      const bpNode = businessProcessNodes[0];
      const activityChildren = bpNode.children.filter(
        (c) => c.entityType === ENTITY_TYPES.PROCESS_ACTIVITY
      );
      expect(activityChildren.length).toBe(2);
    }
  });
});

// ============================================================================
// Test 5: Deduplication does not remove business branch when technical branch exists
// ============================================================================

describe('Tree building: deduplication preserves business branch', () => {
  it('should not deduplicate business entities when technical branch uses different entity types', () => {
    const metaModel = createMockMetaModelWithBothBranches();
    const rootEntity = { id: 'app-1', name: 'Order Management System', type: ENTITY_TYPES.APPLICATION };

    const treeData = buildTreeData(metaModel, rootEntity);

    // Technical branch entities should exist
    const appComponentNodes = findNodesByEntityType(treeData, ENTITY_TYPES.APP_COMPONENT);
    const serviceNodes = findNodesByEntityType(treeData, ENTITY_TYPES.SERVICE);

    expect(appComponentNodes.length).toBeGreaterThan(0);
    expect(serviceNodes.length).toBeGreaterThan(0);

    // Business branch entities should also exist (not incorrectly deduplicated).
    // Business Points themselves never appear -- their concrete Business
    // Process does.
    const businessProcessNodes = findNodesByEntityType(treeData, ENTITY_TYPES.BUSINESS_PROCESS);
    expect(businessProcessNodes.length).toBeGreaterThan(0);
  });

  it('should maintain separate entity instances when same entity type appears in different contexts', () => {
    const metaModel = createMockMetaModelWithBothBranches();
    const rootEntity = { id: 'app-1', name: 'Order Management System', type: ENTITY_TYPES.APPLICATION };

    const treeData = buildTreeData(metaModel, rootEntity);

    // Count unique entity type occurrences
    const allNodes: TreeNodeData[] = [];
    function collectNodes(node: TreeNodeData) {
      allNodes.push(node);
      node.children.forEach(collectNodes);
    }
    collectNodes(treeData);

    // Verify that both technical and business entity types are present
    const entityTypes = new Set(allNodes.map(n => n.entityType));

    // Should have technical entity types
    expect(entityTypes.has(ENTITY_TYPES.APP_COMPONENT)).toBe(true);
    expect(entityTypes.has(ENTITY_TYPES.SERVICE)).toBe(true);

    // Should have business entity types (concrete -- Business Points resolved)
    expect(entityTypes.has(ENTITY_TYPES.BUSINESS_PROCESS)).toBe(true);
    expect(entityTypes.has(ENTITY_TYPES.BUSINESS_POINT)).toBe(false);
  });
});

// ============================================================================
// Test 6: Both technical and business branches visible under same Application
// ============================================================================

describe('Tree building: both branches visible under Application', () => {
  it('should show both technical (AppComponent) and business (BusinessPoint) branches under Application', () => {
    const metaModel = createMockMetaModelWithBothBranches();
    const rootEntity = { id: 'app-1', name: 'Order Management System', type: ENTITY_TYPES.APPLICATION };

    const treeData = buildTreeData(metaModel, rootEntity);

    // Root should be the Application
    expect(treeData.entityType).toBe(ENTITY_TYPES.APPLICATION);
    expect(treeData.entityId).toBe('app-1');
    expect(treeData.isRoot).toBe(true);

    // Application should have children from both branches
    const childEntityTypes = treeData.children.map(c => c.entityType);

    // Should have technical branch children (AppComponent and/or Service)
    const hasTechnicalChildren =
      childEntityTypes.includes(ENTITY_TYPES.APP_COMPONENT) ||
      childEntityTypes.includes(ENTITY_TYPES.SERVICE);
    expect(hasTechnicalChildren).toBe(true);

    // Should have business branch children (concrete Business Process --
    // Business Point nodes never appear in the tree)
    const hasBusinessChildren = childEntityTypes.includes(ENTITY_TYPES.BUSINESS_PROCESS);
    expect(hasBusinessChildren).toBe(true);
  });

  it('should allow full traversal of both technical and business branches', () => {
    const metaModel = createMockMetaModelWithBothBranches();
    const rootEntity = { id: 'app-1', name: 'Order Management System', type: ENTITY_TYPES.APPLICATION };

    const treeData = buildTreeData(metaModel, rootEntity);

    // Technical branch: Application -> AppComponent -> Service -> Interface -> LogicalDataEntity
    expect(hasPathToEntity(treeData, ENTITY_TYPES.APP_COMPONENT, 'ac-1')).toBe(true);
    expect(hasPathToEntity(treeData, ENTITY_TYPES.SERVICE, 'svc-1')).toBe(true);
    expect(hasPathToEntity(treeData, ENTITY_TYPES.INTERFACE, 'int-1')).toBe(true);
    expect(hasPathToEntity(treeData, ENTITY_TYPES.LOGICAL_DATA_ENTITY, 'lde-1')).toBe(true);

    // Business branch: Application -> BusinessProcess -> ProcessActivity
    // (Business Point resolved away by super-class aware traversal)
    expect(hasPathToEntity(treeData, ENTITY_TYPES.BUSINESS_PROCESS, 'bp-1')).toBe(true);
    // Process Activities are children of Business Process
    expect(hasPathToEntity(treeData, ENTITY_TYPES.PROCESS_ACTIVITY, 'pa-1')).toBe(true);
    expect(hasPathToEntity(treeData, ENTITY_TYPES.PROCESS_ACTIVITY, 'pa-2')).toBe(true);
  });
});
