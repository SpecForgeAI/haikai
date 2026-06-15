/**
 * @vitest-environment jsdom
 */

/**
 * Task Group 3: Cross-branch Containment in Diagram Building
 *
 * Tests for cross-branch containment rendering where:
 * - Application contains Business Process (via App Point / Business Point bridge)
 * - Interface contains Logical Data Entity (via interface_logical_entities association)
 *
 * Key behaviors:
 * - Business Process renders as nested box inside Application
 * - Logical Data Entity renders as nested box inside Interface
 * - parent_node_id is correctly set for cross-branch containment
 * - No edges are drawn for containment relationships (actsAsContainment: true)
 * - Parent nodes have containment styling (text_v_align='TOP', text_font_weight='bold')
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { ENTITY_TYPES, MetaModel, DiagramNode } from '../types/model';
import { TreeNodeData } from '../types/advancedAdd';
import { buildTreeData, buildOrderedNodeListFromLeaves } from '../components/DiagramsView/AdvancedAddDialog';
import {
  buildWrappedNodeHierarchy,
  WrappedNodeResult,
} from '../components/DiagramsView/PalettePanel';
import {
  EXPANDABLE_RELATIONSHIPS,
  getExpandableRelationships,
} from '../utils/advancedAddRelationships';

// ============================================================================
// Setup: Mock canvas for text measurement
// ============================================================================

beforeAll(() => {
  // Mock canvas context for text measurement
  const mockContext = {
    font: '',
    measureText: vi.fn(() => ({ width: 50 })),
  };

  // Mock canvas element
  HTMLCanvasElement.prototype.getContext = vi.fn(() => mockContext) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

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

// ============================================================================
// Mock Data Factories
// ============================================================================

/**
 * Create a mock MetaModel with Application -> Business Process hierarchy
 * via App Point / Business Point bridge
 */
function createMockMetaModelWithApplicationBusinessProcess(): MetaModel {
  return {
    entities: {
      business_users: [],
      business_processes: [
        { id: 'bp-1', name: 'Order Processing', description: '', tags: '' },
        { id: 'bp-2', name: 'Payment Handling', description: '', tags: '' },
      ],
      process_activities: [
        { id: 'pa-1', business_process_id: 'bp-1', name: 'Validate Order', description: '', sequence_order: 1, actor_hint: 'END_USER', user_interaction_level: 'MODERATE', tags: '' },
      ],
      business_points: [
        { id: 'bpoint-1', name: 'BP for Order Processing', kind: 'BUSINESS_PROCESS', business_process_id: 'bp-1', process_activity_id: '' },
        { id: 'bpoint-2', name: 'BP for Payment Handling', kind: 'BUSINESS_PROCESS', business_process_id: 'bp-2', process_activity_id: '' },
      ],
      applications: [
        { id: 'app-1', name: 'Sales Application', description: '', app_type: 'Web', status: 'Active', tags: '' },
      ],
      app_components: [],
      services: [],
      interfaces: [],
      endpoints: [],
      application_points: [
        { id: 'apoint-1', name: 'AP for Sales Application', kind: 'APPLICATION', application_id: 'app-1', application_component_id: '', service_id: '' },
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
        { id: 'apbp-1', application_point_id: 'apoint-1', business_point_id: 'bpoint-1', description: '', tags: '' },
        { id: 'apbp-2', application_point_id: 'apoint-1', business_point_id: 'bpoint-2', description: '', tags: '' },
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
 * Create a mock MetaModel with Interface -> Logical Data Entity hierarchy
 */
function createMockMetaModelWithInterfaceLogicalEntity(): MetaModel {
  return {
    entities: {
      business_users: [],
      business_processes: [],
      process_activities: [],
      business_points: [],
      applications: [],
      app_components: [],
      services: [
        { id: 'svc-1', application_id: '', app_component_id: null, name: 'Order Service', description: '', service_type: 'API', tags: '' },
      ],
      interfaces: [
        { id: 'int-1', service_id: 'svc-1', name: 'Order API', description: '', interface_type: 'REST_API', tags: '' },
      ],
      endpoints: [],
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

/**
 * Create a mock diagram with existing nodes
 */
function createMockDiagram(nodes: DiagramNode[] = []): { diagram_nodes: DiagramNode[]; diagram_edges: [] } {
  return {
    diagram_nodes: nodes,
    diagram_edges: [],
  };
}

// ============================================================================
// Test 1: Application -> Business Process produces nested boxes
// ============================================================================

describe('Task 3.1: Application -> Business Process cross-branch containment', () => {
  it('should render Business Process as nested box inside Application', () => {
    const metaModel = createMockMetaModelWithApplicationBusinessProcess();
    const rootEntity = { id: 'app-1', name: 'Sales Application', type: ENTITY_TYPES.APPLICATION };
    const diagram = createMockDiagram();
    const viewportCenter = { x: 500, y: 400 };

    const treeData = buildTreeData(metaModel, rootEntity);

    // Find Business Process in the tree (resolved from Business Point)
    const bpNode = findNodeByEntity(treeData, ENTITY_TYPES.BUSINESS_PROCESS, 'bp-1');
    expect(bpNode).toBeDefined();

    // Select Application (root) and Business Process
    const selectedKeys = new Set([treeData.key, bpNode!.key]);
    const orderedNodes = buildOrderedNodeListFromLeaves(selectedKeys, treeData);

    const result = buildWrappedNodeHierarchy(
      orderedNodes,
      treeData,
      metaModel,
      diagram,
      viewportCenter
    );

    // Find the Application and Business Process nodes
    const applicationNode = result.nodesToAdd.find(n => n.entity_type === ENTITY_TYPES.APPLICATION);
    const businessProcessNode = result.nodesToAdd.find(n => n.entity_type === ENTITY_TYPES.BUSINESS_PROCESS);

    expect(applicationNode).toBeDefined();
    expect(businessProcessNode).toBeDefined();

    // Business Process should be positioned inside Application bounds
    expect(businessProcessNode!.pos_x).toBeGreaterThanOrEqual(applicationNode!.pos_x);
    expect(businessProcessNode!.pos_y).toBeGreaterThanOrEqual(applicationNode!.pos_y);
    expect(businessProcessNode!.pos_x + businessProcessNode!.width).toBeLessThanOrEqual(applicationNode!.pos_x + applicationNode!.width);
    expect(businessProcessNode!.pos_y + businessProcessNode!.height).toBeLessThanOrEqual(applicationNode!.pos_y + applicationNode!.height);
  });

  it('should set Business Process parent_node_id pointing to Application node', () => {
    const metaModel = createMockMetaModelWithApplicationBusinessProcess();
    const rootEntity = { id: 'app-1', name: 'Sales Application', type: ENTITY_TYPES.APPLICATION };
    const diagram = createMockDiagram();
    const viewportCenter = { x: 500, y: 400 };

    const treeData = buildTreeData(metaModel, rootEntity);

    // Find Business Process in the tree
    const bpNode = findNodeByEntity(treeData, ENTITY_TYPES.BUSINESS_PROCESS, 'bp-1');
    expect(bpNode).toBeDefined();

    // Select Application and Business Process
    const selectedKeys = new Set([treeData.key, bpNode!.key]);
    const orderedNodes = buildOrderedNodeListFromLeaves(selectedKeys, treeData);

    const result = buildWrappedNodeHierarchy(
      orderedNodes,
      treeData,
      metaModel,
      diagram,
      viewportCenter
    );

    const applicationNode = result.nodesToAdd.find(n => n.entity_type === ENTITY_TYPES.APPLICATION);
    const businessProcessNode = result.nodesToAdd.find(n => n.entity_type === ENTITY_TYPES.BUSINESS_PROCESS);

    expect(applicationNode).toBeDefined();
    expect(businessProcessNode).toBeDefined();

    // Business Process should have parent_node_id set to Application's id
    expect(businessProcessNode!.parent_node_id).toBe(applicationNode!.id);
  });

  it('should apply containment styling to Application parent', () => {
    const metaModel = createMockMetaModelWithApplicationBusinessProcess();
    const rootEntity = { id: 'app-1', name: 'Sales Application', type: ENTITY_TYPES.APPLICATION };
    const diagram = createMockDiagram();
    const viewportCenter = { x: 500, y: 400 };

    const treeData = buildTreeData(metaModel, rootEntity);
    const bpNode = findNodeByEntity(treeData, ENTITY_TYPES.BUSINESS_PROCESS, 'bp-1');

    const selectedKeys = new Set([treeData.key, bpNode!.key]);
    const orderedNodes = buildOrderedNodeListFromLeaves(selectedKeys, treeData);

    const result = buildWrappedNodeHierarchy(
      orderedNodes,
      treeData,
      metaModel,
      diagram,
      viewportCenter
    );

    const applicationNode = result.nodesToAdd.find(n => n.entity_type === ENTITY_TYPES.APPLICATION);
    expect(applicationNode).toBeDefined();

    // Application parent should have containment styling
    expect(applicationNode!.text_v_align).toBe('TOP');
    expect(applicationNode!.text_font_weight).toBe('bold');
  });
});

// ============================================================================
// Test 2: Interface -> Logical Data Entity produces nested boxes
// ============================================================================

describe('Task 3.1: Interface -> Logical Data Entity cross-branch containment', () => {
  it('should render Logical Data Entity as nested box inside Interface', () => {
    const metaModel = createMockMetaModelWithInterfaceLogicalEntity();
    const rootEntity = { id: 'int-1', name: 'Order API', type: ENTITY_TYPES.INTERFACE };
    const diagram = createMockDiagram();
    const viewportCenter = { x: 500, y: 400 };

    const treeData = buildTreeData(metaModel, rootEntity);

    // Find Logical Data Entity in the tree
    const ldeNode = findNodeByEntity(treeData, ENTITY_TYPES.LOGICAL_DATA_ENTITY, 'lde-1');
    expect(ldeNode).toBeDefined();

    // Select Interface (root) and Logical Data Entity
    const selectedKeys = new Set([treeData.key, ldeNode!.key]);
    const orderedNodes = buildOrderedNodeListFromLeaves(selectedKeys, treeData);

    const result = buildWrappedNodeHierarchy(
      orderedNodes,
      treeData,
      metaModel,
      diagram,
      viewportCenter
    );

    // Find the Interface and Logical Data Entity nodes
    const interfaceNode = result.nodesToAdd.find(n => n.entity_type === ENTITY_TYPES.INTERFACE);
    const ldeNodeResult = result.nodesToAdd.find(n => n.entity_type === ENTITY_TYPES.LOGICAL_DATA_ENTITY);

    expect(interfaceNode).toBeDefined();
    expect(ldeNodeResult).toBeDefined();

    // Logical Data Entity should be positioned inside Interface bounds
    expect(ldeNodeResult!.pos_x).toBeGreaterThanOrEqual(interfaceNode!.pos_x);
    expect(ldeNodeResult!.pos_y).toBeGreaterThanOrEqual(interfaceNode!.pos_y);
    expect(ldeNodeResult!.pos_x + ldeNodeResult!.width).toBeLessThanOrEqual(interfaceNode!.pos_x + interfaceNode!.width);
    expect(ldeNodeResult!.pos_y + ldeNodeResult!.height).toBeLessThanOrEqual(interfaceNode!.pos_y + interfaceNode!.height);
  });

  it('should set Logical Data Entity parent_node_id pointing to Interface node', () => {
    const metaModel = createMockMetaModelWithInterfaceLogicalEntity();
    const rootEntity = { id: 'int-1', name: 'Order API', type: ENTITY_TYPES.INTERFACE };
    const diagram = createMockDiagram();
    const viewportCenter = { x: 500, y: 400 };

    const treeData = buildTreeData(metaModel, rootEntity);
    const ldeNode = findNodeByEntity(treeData, ENTITY_TYPES.LOGICAL_DATA_ENTITY, 'lde-1');
    expect(ldeNode).toBeDefined();

    const selectedKeys = new Set([treeData.key, ldeNode!.key]);
    const orderedNodes = buildOrderedNodeListFromLeaves(selectedKeys, treeData);

    const result = buildWrappedNodeHierarchy(
      orderedNodes,
      treeData,
      metaModel,
      diagram,
      viewportCenter
    );

    const interfaceNode = result.nodesToAdd.find(n => n.entity_type === ENTITY_TYPES.INTERFACE);
    const ldeNodeResult = result.nodesToAdd.find(n => n.entity_type === ENTITY_TYPES.LOGICAL_DATA_ENTITY);

    expect(interfaceNode).toBeDefined();
    expect(ldeNodeResult).toBeDefined();

    // Logical Data Entity should have parent_node_id set to Interface's id
    expect(ldeNodeResult!.parent_node_id).toBe(interfaceNode!.id);
  });

  it('should apply containment styling to Interface parent', () => {
    const metaModel = createMockMetaModelWithInterfaceLogicalEntity();
    const rootEntity = { id: 'int-1', name: 'Order API', type: ENTITY_TYPES.INTERFACE };
    const diagram = createMockDiagram();
    const viewportCenter = { x: 500, y: 400 };

    const treeData = buildTreeData(metaModel, rootEntity);
    const ldeNode = findNodeByEntity(treeData, ENTITY_TYPES.LOGICAL_DATA_ENTITY, 'lde-1');

    const selectedKeys = new Set([treeData.key, ldeNode!.key]);
    const orderedNodes = buildOrderedNodeListFromLeaves(selectedKeys, treeData);

    const result = buildWrappedNodeHierarchy(
      orderedNodes,
      treeData,
      metaModel,
      diagram,
      viewportCenter
    );

    const interfaceNode = result.nodesToAdd.find(n => n.entity_type === ENTITY_TYPES.INTERFACE);
    expect(interfaceNode).toBeDefined();

    // Interface parent renders as a contract-style composite (custom
    // Interface layout) rather than a plain TOP/bold container box.
    expect(interfaceNode!.render_style).toBe('contract');
  });
});

// ============================================================================
// Test 3: No edges created for containment relationships (actsAsContainment: true)
// ============================================================================

describe('Task 3.4: No edges for containment relationships', () => {
  it('should NOT create any diagram edges for Application -> Business Process containment', () => {
    const metaModel = createMockMetaModelWithApplicationBusinessProcess();
    const rootEntity = { id: 'app-1', name: 'Sales Application', type: ENTITY_TYPES.APPLICATION };
    const diagram = createMockDiagram();
    const viewportCenter = { x: 500, y: 400 };

    const treeData = buildTreeData(metaModel, rootEntity);
    const bpNode = findNodeByEntity(treeData, ENTITY_TYPES.BUSINESS_PROCESS, 'bp-1');

    const selectedKeys = new Set([treeData.key, bpNode!.key]);
    const orderedNodes = buildOrderedNodeListFromLeaves(selectedKeys, treeData);

    const result = buildWrappedNodeHierarchy(
      orderedNodes,
      treeData,
      metaModel,
      diagram,
      viewportCenter
    );

    // buildWrappedNodeHierarchy should NOT produce edges
    // Edges are only created by relationship handlers, not by containment wrapping
    // The result only has nodesToAdd and nodesToUpdate, no edges
    expect(result.nodesToAdd.length).toBeGreaterThan(0);
    // Verify the function returns WrappedNodeResult which has no edges property
    expect('nodesToAdd' in result).toBe(true);
    expect('nodesToUpdate' in result).toBe(true);
    // No edges property exists in WrappedNodeResult - containment uses parent_node_id, not edges
  });

  it('should NOT create any diagram edges for Interface -> Logical Entity containment', () => {
    const metaModel = createMockMetaModelWithInterfaceLogicalEntity();
    const rootEntity = { id: 'int-1', name: 'Order API', type: ENTITY_TYPES.INTERFACE };
    const diagram = createMockDiagram();
    const viewportCenter = { x: 500, y: 400 };

    const treeData = buildTreeData(metaModel, rootEntity);
    const ldeNode = findNodeByEntity(treeData, ENTITY_TYPES.LOGICAL_DATA_ENTITY, 'lde-1');

    const selectedKeys = new Set([treeData.key, ldeNode!.key]);
    const orderedNodes = buildOrderedNodeListFromLeaves(selectedKeys, treeData);

    const result = buildWrappedNodeHierarchy(
      orderedNodes,
      treeData,
      metaModel,
      diagram,
      viewportCenter
    );

    // buildWrappedNodeHierarchy should NOT produce edges for containment
    expect(result.nodesToAdd.length).toBeGreaterThan(0);
    // Containment is expressed via parent_node_id, not via edges
    const ldeNodeResult = result.nodesToAdd.find(n => n.entity_type === ENTITY_TYPES.LOGICAL_DATA_ENTITY);
    expect(ldeNodeResult).toBeDefined();
    expect(ldeNodeResult!.parent_node_id).not.toBeNull();
  });

  it('should verify actsAsContainment is true for Application -> Business Process relationship', () => {
    const applicationRelationships = getExpandableRelationships(ENTITY_TYPES.APPLICATION);

    // Find the relationship for BUSINESS_PROCESS
    const bpRelationship = applicationRelationships.find(
      r => r.targetEntityType === ENTITY_TYPES.BUSINESS_PROCESS
    );

    expect(bpRelationship).toBeDefined();
    expect(bpRelationship!.actsAsContainment).toBe(true);
  });

  it('should verify actsAsContainment is true for Interface -> Logical Entity relationship', () => {
    const interfaceRelationships = getExpandableRelationships(ENTITY_TYPES.INTERFACE);

    // Find the relationship for LOGICAL_DATA_ENTITY
    const ldeRelationship = interfaceRelationships.find(
      r => r.targetEntityType === ENTITY_TYPES.LOGICAL_DATA_ENTITY
    );

    expect(ldeRelationship).toBeDefined();
    expect(ldeRelationship!.actsAsContainment).toBe(true);
  });
});

// ============================================================================
// Test 4: Verify CONTAINER_ENTITY_TYPES includes necessary types
// ============================================================================

describe('Task 3.5: CONTAINER_ENTITY_TYPES includes necessary types', () => {
  it('should recognize all expected entity types as containers', () => {
    // We test this by verifying that containment works for various entity types
    // The buildWrappedNodeHierarchy function uses CONTAINER_ENTITY_TYPES internally

    // Test that APPLICATION can contain children
    const appMetaModel = createMockMetaModelWithApplicationBusinessProcess();
    const appRoot = { id: 'app-1', name: 'Sales Application', type: ENTITY_TYPES.APPLICATION };
    const appDiagram = createMockDiagram();
    const appTree = buildTreeData(appMetaModel, appRoot);
    const appBpNode = findNodeByEntity(appTree, ENTITY_TYPES.BUSINESS_PROCESS, 'bp-1');
    const appSelectedKeys = new Set([appTree.key, appBpNode!.key]);
    const appOrderedNodes = buildOrderedNodeListFromLeaves(appSelectedKeys, appTree);
    const appResult = buildWrappedNodeHierarchy(appOrderedNodes, appTree, appMetaModel, appDiagram, { x: 500, y: 400 });

    // APPLICATION should have containment styling when it has children
    const appNode = appResult.nodesToAdd.find(n => n.entity_type === ENTITY_TYPES.APPLICATION);
    expect(appNode).toBeDefined();
    expect(appNode!.text_v_align).toBe('TOP');
    expect(appNode!.text_font_weight).toBe('bold');

    // Test that INTERFACE can contain children
    const intMetaModel = createMockMetaModelWithInterfaceLogicalEntity();
    const intRoot = { id: 'int-1', name: 'Order API', type: ENTITY_TYPES.INTERFACE };
    const intDiagram = createMockDiagram();
    const intTree = buildTreeData(intMetaModel, intRoot);
    const intLdeNode = findNodeByEntity(intTree, ENTITY_TYPES.LOGICAL_DATA_ENTITY, 'lde-1');
    const intSelectedKeys = new Set([intTree.key, intLdeNode!.key]);
    const intOrderedNodes = buildOrderedNodeListFromLeaves(intSelectedKeys, intTree);
    const intResult = buildWrappedNodeHierarchy(intOrderedNodes, intTree, intMetaModel, intDiagram, { x: 500, y: 400 });

    // INTERFACE should have containment styling when it has children
    const intNode = intResult.nodesToAdd.find(n => n.entity_type === ENTITY_TYPES.INTERFACE);
    expect(intNode).toBeDefined();
    // Interfaces are containers but render contract-style composites
    expect(intNode!.render_style).toBe('contract');
  });

  it('should properly nest Business Process with Process Activity inside Application', () => {
    // More complex test: Application -> Business Process -> Process Activity
    const metaModel = createMockMetaModelWithApplicationBusinessProcess();
    const rootEntity = { id: 'app-1', name: 'Sales Application', type: ENTITY_TYPES.APPLICATION };
    const diagram = createMockDiagram();
    const viewportCenter = { x: 500, y: 400 };

    const treeData = buildTreeData(metaModel, rootEntity);

    // Find Business Process and Process Activity
    const bpNode = findNodeByEntity(treeData, ENTITY_TYPES.BUSINESS_PROCESS, 'bp-1');
    const paNode = findNodeByEntity(treeData, ENTITY_TYPES.PROCESS_ACTIVITY, 'pa-1');

    expect(bpNode).toBeDefined();
    expect(paNode).toBeDefined();

    // Select all three levels
    const selectedKeys = new Set([treeData.key, bpNode!.key, paNode!.key]);
    const orderedNodes = buildOrderedNodeListFromLeaves(selectedKeys, treeData);

    const result = buildWrappedNodeHierarchy(
      orderedNodes,
      treeData,
      metaModel,
      diagram,
      viewportCenter
    );

    // Find all diagram nodes
    const applicationNode = result.nodesToAdd.find(n => n.entity_type === ENTITY_TYPES.APPLICATION);
    const businessProcessNode = result.nodesToAdd.find(n => n.entity_type === ENTITY_TYPES.BUSINESS_PROCESS);
    const processActivityNode = result.nodesToAdd.find(n => n.entity_type === ENTITY_TYPES.PROCESS_ACTIVITY);

    expect(applicationNode).toBeDefined();
    expect(businessProcessNode).toBeDefined();
    expect(processActivityNode).toBeDefined();

    // Verify containment hierarchy:
    // Business Process should have Application as parent
    expect(businessProcessNode!.parent_node_id).toBe(applicationNode!.id);
    // Process Activity should have Business Process as parent
    expect(processActivityNode!.parent_node_id).toBe(businessProcessNode!.id);

    // Both Application and Business Process should have containment styling
    expect(applicationNode!.text_v_align).toBe('TOP');
    expect(applicationNode!.text_font_weight).toBe('bold');
    expect(businessProcessNode!.text_v_align).toBe('TOP');
    expect(businessProcessNode!.text_font_weight).toBe('bold');
  });
});

// ============================================================================
// Test 5: Z-index ordering for cross-branch containment
// ============================================================================

describe('Task 3.2/3.3: Z-index ordering for cross-branch containment', () => {
  it('should set Business Process z-index higher than Application z-index', () => {
    const metaModel = createMockMetaModelWithApplicationBusinessProcess();
    const rootEntity = { id: 'app-1', name: 'Sales Application', type: ENTITY_TYPES.APPLICATION };
    const diagram = createMockDiagram();
    const viewportCenter = { x: 500, y: 400 };

    const treeData = buildTreeData(metaModel, rootEntity);
    const bpNode = findNodeByEntity(treeData, ENTITY_TYPES.BUSINESS_PROCESS, 'bp-1');

    const selectedKeys = new Set([treeData.key, bpNode!.key]);
    const orderedNodes = buildOrderedNodeListFromLeaves(selectedKeys, treeData);

    const result = buildWrappedNodeHierarchy(
      orderedNodes,
      treeData,
      metaModel,
      diagram,
      viewportCenter
    );

    const applicationNode = result.nodesToAdd.find(n => n.entity_type === ENTITY_TYPES.APPLICATION);
    const businessProcessNode = result.nodesToAdd.find(n => n.entity_type === ENTITY_TYPES.BUSINESS_PROCESS);

    expect(applicationNode).toBeDefined();
    expect(businessProcessNode).toBeDefined();

    // Business Process should have higher z-index than Application
    expect(businessProcessNode!.z_index).toBeGreaterThan(applicationNode!.z_index);
  });

  it('should set Logical Data Entity z-index higher than Interface z-index', () => {
    const metaModel = createMockMetaModelWithInterfaceLogicalEntity();
    const rootEntity = { id: 'int-1', name: 'Order API', type: ENTITY_TYPES.INTERFACE };
    const diagram = createMockDiagram();
    const viewportCenter = { x: 500, y: 400 };

    const treeData = buildTreeData(metaModel, rootEntity);
    const ldeNode = findNodeByEntity(treeData, ENTITY_TYPES.LOGICAL_DATA_ENTITY, 'lde-1');

    const selectedKeys = new Set([treeData.key, ldeNode!.key]);
    const orderedNodes = buildOrderedNodeListFromLeaves(selectedKeys, treeData);

    const result = buildWrappedNodeHierarchy(
      orderedNodes,
      treeData,
      metaModel,
      diagram,
      viewportCenter
    );

    const interfaceNode = result.nodesToAdd.find(n => n.entity_type === ENTITY_TYPES.INTERFACE);
    const ldeNodeResult = result.nodesToAdd.find(n => n.entity_type === ENTITY_TYPES.LOGICAL_DATA_ENTITY);

    expect(interfaceNode).toBeDefined();
    expect(ldeNodeResult).toBeDefined();

    // Logical Data Entity should have higher z-index than Interface
    expect(ldeNodeResult!.z_index).toBeGreaterThan(interfaceNode!.z_index);
  });
});

// ============================================================================
// Test 6: Multiple children in cross-branch containment
// ============================================================================

describe('Task 3.2/3.3: Multiple children in cross-branch containment', () => {
  it('should position multiple Business Processes inside Application', () => {
    const metaModel = createMockMetaModelWithApplicationBusinessProcess();
    const rootEntity = { id: 'app-1', name: 'Sales Application', type: ENTITY_TYPES.APPLICATION };
    const diagram = createMockDiagram();
    const viewportCenter = { x: 500, y: 400 };

    const treeData = buildTreeData(metaModel, rootEntity);

    // Find both Business Processes
    const bpNode1 = findNodeByEntity(treeData, ENTITY_TYPES.BUSINESS_PROCESS, 'bp-1');
    const bpNode2 = findNodeByEntity(treeData, ENTITY_TYPES.BUSINESS_PROCESS, 'bp-2');

    expect(bpNode1).toBeDefined();
    expect(bpNode2).toBeDefined();

    // Select Application and both Business Processes
    const selectedKeys = new Set([treeData.key, bpNode1!.key, bpNode2!.key]);
    const orderedNodes = buildOrderedNodeListFromLeaves(selectedKeys, treeData);

    const result = buildWrappedNodeHierarchy(
      orderedNodes,
      treeData,
      metaModel,
      diagram,
      viewportCenter
    );

    // Should have 3 nodes (Application + 2 Business Processes)
    expect(result.nodesToAdd.length).toBe(3);

    const applicationNode = result.nodesToAdd.find(n => n.entity_type === ENTITY_TYPES.APPLICATION);
    const bpNodes = result.nodesToAdd.filter(n => n.entity_type === ENTITY_TYPES.BUSINESS_PROCESS);

    expect(applicationNode).toBeDefined();
    expect(bpNodes.length).toBe(2);

    // Both Business Processes should have Application as parent
    bpNodes.forEach(bp => {
      expect(bp.parent_node_id).toBe(applicationNode!.id);
    });

    // Both should be positioned inside Application bounds
    bpNodes.forEach(bp => {
      expect(bp.pos_x).toBeGreaterThanOrEqual(applicationNode!.pos_x);
      expect(bp.pos_y).toBeGreaterThanOrEqual(applicationNode!.pos_y);
    });
  });

  it('should position multiple Logical Entities inside Interface', () => {
    const metaModel = createMockMetaModelWithInterfaceLogicalEntity();
    const rootEntity = { id: 'int-1', name: 'Order API', type: ENTITY_TYPES.INTERFACE };
    const diagram = createMockDiagram();
    const viewportCenter = { x: 500, y: 400 };

    const treeData = buildTreeData(metaModel, rootEntity);

    // Find both Logical Data Entities
    const ldeNode1 = findNodeByEntity(treeData, ENTITY_TYPES.LOGICAL_DATA_ENTITY, 'lde-1');
    const ldeNode2 = findNodeByEntity(treeData, ENTITY_TYPES.LOGICAL_DATA_ENTITY, 'lde-2');

    expect(ldeNode1).toBeDefined();
    expect(ldeNode2).toBeDefined();

    // Select Interface and both Logical Data Entities
    const selectedKeys = new Set([treeData.key, ldeNode1!.key, ldeNode2!.key]);
    const orderedNodes = buildOrderedNodeListFromLeaves(selectedKeys, treeData);

    const result = buildWrappedNodeHierarchy(
      orderedNodes,
      treeData,
      metaModel,
      diagram,
      viewportCenter
    );

    // Should have 3 nodes (Interface + 2 Logical Data Entities)
    expect(result.nodesToAdd.length).toBe(3);

    const interfaceNode = result.nodesToAdd.find(n => n.entity_type === ENTITY_TYPES.INTERFACE);
    const ldeNodes = result.nodesToAdd.filter(n => n.entity_type === ENTITY_TYPES.LOGICAL_DATA_ENTITY);

    expect(interfaceNode).toBeDefined();
    expect(ldeNodes.length).toBe(2);

    // Both Logical Data Entities should have Interface as parent
    ldeNodes.forEach(lde => {
      expect(lde.parent_node_id).toBe(interfaceNode!.id);
    });

    // Both should be positioned inside Interface bounds
    ldeNodes.forEach(lde => {
      expect(lde.pos_x).toBeGreaterThanOrEqual(interfaceNode!.pos_x);
      expect(lde.pos_y).toBeGreaterThanOrEqual(interfaceNode!.pos_y);
    });
  });
});
