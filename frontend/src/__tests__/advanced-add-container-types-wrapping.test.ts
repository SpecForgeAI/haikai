/**
 * @vitest-environment jsdom
 */

/**
 * Task Group 3: Wrapping and Containment Tests
 *
 * Tests for INTERFACE container type and wrapping/containment logic
 * in the Advanced Add feature.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { ENTITY_TYPES, MetaModel, DiagramNode } from '../types/model';
import { TreeNodeData } from '../types/advancedAdd';
import { buildTreeData, buildOrderedNodeListFromLeaves } from '../components/DiagramsView/AdvancedAddDialog';
import {
  buildWrappedNodeHierarchy,
  WrappedNodeResult,
} from '../components/DiagramsView/PalettePanel';

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
 * Create a mock MetaModel with Interface -> Logical Data Entity hierarchy
 * For testing INTERFACE as a container type
 */
function createMockMetaModelWithInterfaceHierarchy(): MetaModel {
  return {
    entities: {
      business_users: [],
      business_processes: [],
      process_activities: [],
      business_points: [],
      applications: [],
      app_components: [],
      services: [
        { id: 'svc-1', application_id: 'app-1', app_component_id: null, name: 'Test Service', description: '', service_type: 'API', tags: '' },
      ],
      interfaces: [
        { id: 'int-1', service_id: 'svc-1', name: 'Test Interface', description: '', interface_type: 'REST_API', tags: '' },
      ],
      endpoints: [],
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
 * Create a mock MetaModel with full technical chain:
 * Application -> App Component -> Service -> Interface -> Logical Data Entity
 */
function createMockMetaModelWithTechnicalChain(): MetaModel {
  return {
    entities: {
      business_users: [],
      business_processes: [],
      process_activities: [],
      business_points: [],
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
      endpoints: [],
      application_points: [],
      logical_data_entities: [
        { id: 'lde-1', name: 'Logical Entity 1', description: '', tags: '' },
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
      ],
    },
  };
}

/**
 * Create a mock MetaModel with business chain:
 * Business Process -> Process Activity
 */
function createMockMetaModelWithBusinessChain(): MetaModel {
  return {
    entities: {
      business_users: [],
      business_processes: [
        { id: 'bp-1', name: 'Test Business Process', description: '', tags: '' },
      ],
      process_activities: [
        { id: 'pa-1', business_process_id: 'bp-1', name: 'Activity 1', description: '', sequence_order: 1, actor_hint: 'END_USER', user_interaction_level: 'MODERATE', tags: '' },
        { id: 'pa-2', business_process_id: 'bp-1', name: 'Activity 2', description: '', sequence_order: 2, actor_hint: 'END_USER', user_interaction_level: 'MODERATE', tags: '' },
      ],
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
// Test 1: INTERFACE is included in CONTAINER_ENTITY_TYPES
// ============================================================================

describe('Task 3.1: INTERFACE is included in CONTAINER_ENTITY_TYPES', () => {
  it('should recognize INTERFACE as a container type that can wrap Logical Data Entities', () => {
    const metaModel = createMockMetaModelWithInterfaceHierarchy();
    const rootEntity = { id: 'int-1', name: 'Test Interface', type: ENTITY_TYPES.INTERFACE };
    const diagram = createMockDiagram();
    const viewportCenter = { x: 500, y: 400 };

    const treeData = buildTreeData(metaModel, rootEntity);

    // Find a Logical Data Entity child
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

    // Interface should have containment styling (proving it's recognized as a container)
    // Interface wraps data entities via the contract-style composite
    // renderer rather than plain TOP/bold container styling.
    expect(interfaceNode!.render_style).toBe('contract');

    // Logical Data Entity should be a child of Interface
    expect(ldeNodeResult!.parent_node_id).toBe(interfaceNode!.id);
  });
});

// ============================================================================
// Test 2: buildOrderedNodeListFromLeaves() orders nodes correctly (leaves first)
// ============================================================================

describe('Task 3.1: buildOrderedNodeListFromLeaves orders nodes correctly', () => {
  it('should order nodes from deepest leaves to root (descending depth)', () => {
    const metaModel = createMockMetaModelWithTechnicalChain();
    const rootEntity = { id: 'app-1', name: 'Test Application', type: ENTITY_TYPES.APPLICATION };

    const treeData = buildTreeData(metaModel, rootEntity);

    // Navigate through the hierarchy to find all nodes
    const acNode = findNodeByEntity(treeData, ENTITY_TYPES.APP_COMPONENT, 'ac-1');
    const svcNode = findNodeByEntity(treeData, ENTITY_TYPES.SERVICE, 'svc-1');
    const intNode = findNodeByEntity(treeData, ENTITY_TYPES.INTERFACE, 'int-1');
    const ldeNode = findNodeByEntity(treeData, ENTITY_TYPES.LOGICAL_DATA_ENTITY, 'lde-1');

    expect(acNode).toBeDefined();
    expect(svcNode).toBeDefined();
    expect(intNode).toBeDefined();
    expect(ldeNode).toBeDefined();

    // Select all nodes in the chain
    const selectedKeys = new Set([
      treeData.key,  // Application (depth 0)
      acNode!.key,   // App Component (depth 1)
      svcNode!.key,  // Service (depth 2)
      intNode!.key,  // Interface (depth 3)
      ldeNode!.key,  // Logical Data Entity (depth 4)
    ]);

    const orderedNodes = buildOrderedNodeListFromLeaves(selectedKeys, treeData);

    // Should have 5 nodes
    expect(orderedNodes.length).toBe(5);

    // Order should be: LDE (deepest), Interface, Service, App Component, Application (root)
    expect(orderedNodes[0].entityType).toBe(ENTITY_TYPES.LOGICAL_DATA_ENTITY);
    expect(orderedNodes[1].entityType).toBe(ENTITY_TYPES.INTERFACE);
    expect(orderedNodes[2].entityType).toBe(ENTITY_TYPES.SERVICE);
    expect(orderedNodes[3].entityType).toBe(ENTITY_TYPES.APP_COMPONENT);
    expect(orderedNodes[4].entityType).toBe(ENTITY_TYPES.APPLICATION);
  });
});

// ============================================================================
// Test 3: buildWrappedNodeHierarchy creates correct nested hierarchy for technical chain
// ============================================================================

describe('Task 3.1: buildWrappedNodeHierarchy creates correct nested hierarchy for technical chain', () => {
  it('should create Application -> App Component -> Service -> Interface -> LDE hierarchy', () => {
    const metaModel = createMockMetaModelWithTechnicalChain();
    const rootEntity = { id: 'app-1', name: 'Test Application', type: ENTITY_TYPES.APPLICATION };
    const diagram = createMockDiagram();
    const viewportCenter = { x: 500, y: 400 };

    const treeData = buildTreeData(metaModel, rootEntity);

    // Find all nodes in the hierarchy
    const acNode = findNodeByEntity(treeData, ENTITY_TYPES.APP_COMPONENT, 'ac-1');
    const svcNode = findNodeByEntity(treeData, ENTITY_TYPES.SERVICE, 'svc-1');
    const intNode = findNodeByEntity(treeData, ENTITY_TYPES.INTERFACE, 'int-1');
    const ldeNode = findNodeByEntity(treeData, ENTITY_TYPES.LOGICAL_DATA_ENTITY, 'lde-1');

    // Select all nodes
    const selectedKeys = new Set([
      treeData.key,
      acNode!.key,
      svcNode!.key,
      intNode!.key,
      ldeNode!.key,
    ]);

    const orderedNodes = buildOrderedNodeListFromLeaves(selectedKeys, treeData);
    const result = buildWrappedNodeHierarchy(
      orderedNodes,
      treeData,
      metaModel,
      diagram,
      viewportCenter
    );

    // Should have 5 nodes
    expect(result.nodesToAdd.length).toBe(5);

    // Find all diagram nodes
    const appDiagramNode = result.nodesToAdd.find(n => n.entity_type === ENTITY_TYPES.APPLICATION);
    const acDiagramNode = result.nodesToAdd.find(n => n.entity_type === ENTITY_TYPES.APP_COMPONENT);
    const svcDiagramNode = result.nodesToAdd.find(n => n.entity_type === ENTITY_TYPES.SERVICE);
    const intDiagramNode = result.nodesToAdd.find(n => n.entity_type === ENTITY_TYPES.INTERFACE);
    const ldeDiagramNode = result.nodesToAdd.find(n => n.entity_type === ENTITY_TYPES.LOGICAL_DATA_ENTITY);

    expect(appDiagramNode).toBeDefined();
    expect(acDiagramNode).toBeDefined();
    expect(svcDiagramNode).toBeDefined();
    expect(intDiagramNode).toBeDefined();
    expect(ldeDiagramNode).toBeDefined();

    // Verify containment hierarchy
    expect(acDiagramNode!.parent_node_id).toBe(appDiagramNode!.id);
    expect(svcDiagramNode!.parent_node_id).toBe(acDiagramNode!.id);
    expect(intDiagramNode!.parent_node_id).toBe(svcDiagramNode!.id);
    expect(ldeDiagramNode!.parent_node_id).toBe(intDiagramNode!.id);
  });
});

// ============================================================================
// Test 4: buildWrappedNodeHierarchy creates correct nested hierarchy for business chain
// ============================================================================

describe('Task 3.1: buildWrappedNodeHierarchy creates correct nested hierarchy for business chain', () => {
  it('should create Business Process -> Process Activity hierarchy', () => {
    const metaModel = createMockMetaModelWithBusinessChain();
    const rootEntity = { id: 'bp-1', name: 'Test Business Process', type: ENTITY_TYPES.BUSINESS_PROCESS };
    const diagram = createMockDiagram();
    const viewportCenter = { x: 500, y: 400 };

    const treeData = buildTreeData(metaModel, rootEntity);

    // Find Process Activity children
    const paNode1 = findNodeByEntity(treeData, ENTITY_TYPES.PROCESS_ACTIVITY, 'pa-1');
    const paNode2 = findNodeByEntity(treeData, ENTITY_TYPES.PROCESS_ACTIVITY, 'pa-2');

    expect(paNode1).toBeDefined();
    expect(paNode2).toBeDefined();

    // Select Business Process and both Process Activities
    const selectedKeys = new Set([
      treeData.key,  // Business Process
      paNode1!.key,  // Process Activity 1
      paNode2!.key,  // Process Activity 2
    ]);

    const orderedNodes = buildOrderedNodeListFromLeaves(selectedKeys, treeData);
    const result = buildWrappedNodeHierarchy(
      orderedNodes,
      treeData,
      metaModel,
      diagram,
      viewportCenter
    );

    // Should have 3 nodes
    expect(result.nodesToAdd.length).toBe(3);

    // Find diagram nodes
    const bpDiagramNode = result.nodesToAdd.find(n => n.entity_type === ENTITY_TYPES.BUSINESS_PROCESS);
    const paDiagramNodes = result.nodesToAdd.filter(n => n.entity_type === ENTITY_TYPES.PROCESS_ACTIVITY);

    expect(bpDiagramNode).toBeDefined();
    expect(paDiagramNodes.length).toBe(2);

    // Verify containment - both activities should be children of business process
    paDiagramNodes.forEach(pa => {
      expect(pa.parent_node_id).toBe(bpDiagramNode!.id);
    });
  });
});

// ============================================================================
// Test 5: Containment styling (text_v_align='TOP', text_font_weight='bold') is applied
// ============================================================================

describe('Task 3.1: containment styling is applied to container nodes', () => {
  it('should apply text_v_align=TOP and text_font_weight=bold to all container nodes', () => {
    const metaModel = createMockMetaModelWithTechnicalChain();
    const rootEntity = { id: 'app-1', name: 'Test Application', type: ENTITY_TYPES.APPLICATION };
    const diagram = createMockDiagram();
    const viewportCenter = { x: 500, y: 400 };

    const treeData = buildTreeData(metaModel, rootEntity);

    // Find nodes in the hierarchy
    const acNode = findNodeByEntity(treeData, ENTITY_TYPES.APP_COMPONENT, 'ac-1');
    const svcNode = findNodeByEntity(treeData, ENTITY_TYPES.SERVICE, 'svc-1');
    const intNode = findNodeByEntity(treeData, ENTITY_TYPES.INTERFACE, 'int-1');
    const ldeNode = findNodeByEntity(treeData, ENTITY_TYPES.LOGICAL_DATA_ENTITY, 'lde-1');

    // Select all nodes
    const selectedKeys = new Set([
      treeData.key,
      acNode!.key,
      svcNode!.key,
      intNode!.key,
      ldeNode!.key,
    ]);

    const orderedNodes = buildOrderedNodeListFromLeaves(selectedKeys, treeData);
    const result = buildWrappedNodeHierarchy(
      orderedNodes,
      treeData,
      metaModel,
      diagram,
      viewportCenter
    );

    // Find all container diagram nodes (everything except the leaf LDE)
    const appDiagramNode = result.nodesToAdd.find(n => n.entity_type === ENTITY_TYPES.APPLICATION);
    const acDiagramNode = result.nodesToAdd.find(n => n.entity_type === ENTITY_TYPES.APP_COMPONENT);
    const svcDiagramNode = result.nodesToAdd.find(n => n.entity_type === ENTITY_TYPES.SERVICE);
    const intDiagramNode = result.nodesToAdd.find(n => n.entity_type === ENTITY_TYPES.INTERFACE);

    // All container nodes should have containment styling
    expect(appDiagramNode!.text_v_align).toBe('TOP');
    expect(appDiagramNode!.text_font_weight).toBe('bold');

    expect(acDiagramNode!.text_v_align).toBe('TOP');
    expect(acDiagramNode!.text_font_weight).toBe('bold');

    expect(svcDiagramNode!.text_v_align).toBe('TOP');
    expect(svcDiagramNode!.text_font_weight).toBe('bold');

    // Interface renders as a contract-style composite (custom layout),
    // not a plain TOP/bold container box.
    expect(intDiagramNode!.render_style).toBe('contract');
  });

  it('should apply containment styling to existing nodes when updated', () => {
    const metaModel = createMockMetaModelWithBusinessChain();
    const rootEntity = { id: 'bp-1', name: 'Test Business Process', type: ENTITY_TYPES.BUSINESS_PROCESS };

    // Create diagram with existing parent node (without containment styling)
    const existingParentNode: DiagramNode = {
      id: 'existing-bp-node',
      entity_type: ENTITY_TYPES.BUSINESS_PROCESS,
      entity_id: 'bp-1',
      pos_x: 200,
      pos_y: 200,
      width: 120,
      height: 60,
      auto_size: false,
      z_index: 1,
      parent_node_id: null,
      style_override: {},
      // No text_v_align or text_font_weight set
    };
    const diagram = createMockDiagram([existingParentNode]);
    const viewportCenter = { x: 500, y: 400 };

    const treeData = buildTreeData(metaModel, rootEntity);
    const paNode = findNodeByEntity(treeData, ENTITY_TYPES.PROCESS_ACTIVITY, 'pa-1');

    const selectedKeys = new Set([treeData.key, paNode!.key]);
    const orderedNodes = buildOrderedNodeListFromLeaves(selectedKeys, treeData);

    const result = buildWrappedNodeHierarchy(
      orderedNodes,
      treeData,
      metaModel,
      diagram,
      viewportCenter
    );

    // Should have update for the existing parent
    const parentUpdate = result.nodesToUpdate.find(u => u.nodeId === 'existing-bp-node');
    expect(parentUpdate).toBeDefined();

    // Update should include containment styling
    expect(parentUpdate!.updates.text_v_align).toBe('TOP');
    expect(parentUpdate!.updates.text_font_weight).toBe('bold');
  });
});

// ============================================================================
// Test 6: Z-index ordering (parents have lower z-index than children)
// ============================================================================

describe('Task 3.1: z-index ordering ensures parents render behind children', () => {
  it('should assign z-index so that parents have lower z-index than children', () => {
    const metaModel = createMockMetaModelWithTechnicalChain();
    const rootEntity = { id: 'app-1', name: 'Test Application', type: ENTITY_TYPES.APPLICATION };
    const diagram = createMockDiagram();
    const viewportCenter = { x: 500, y: 400 };

    const treeData = buildTreeData(metaModel, rootEntity);

    // Find all nodes in the hierarchy
    const acNode = findNodeByEntity(treeData, ENTITY_TYPES.APP_COMPONENT, 'ac-1');
    const svcNode = findNodeByEntity(treeData, ENTITY_TYPES.SERVICE, 'svc-1');
    const intNode = findNodeByEntity(treeData, ENTITY_TYPES.INTERFACE, 'int-1');
    const ldeNode = findNodeByEntity(treeData, ENTITY_TYPES.LOGICAL_DATA_ENTITY, 'lde-1');

    // Select all nodes
    const selectedKeys = new Set([
      treeData.key,
      acNode!.key,
      svcNode!.key,
      intNode!.key,
      ldeNode!.key,
    ]);

    const orderedNodes = buildOrderedNodeListFromLeaves(selectedKeys, treeData);
    const result = buildWrappedNodeHierarchy(
      orderedNodes,
      treeData,
      metaModel,
      diagram,
      viewportCenter
    );

    // Find all diagram nodes
    const appDiagramNode = result.nodesToAdd.find(n => n.entity_type === ENTITY_TYPES.APPLICATION);
    const acDiagramNode = result.nodesToAdd.find(n => n.entity_type === ENTITY_TYPES.APP_COMPONENT);
    const svcDiagramNode = result.nodesToAdd.find(n => n.entity_type === ENTITY_TYPES.SERVICE);
    const intDiagramNode = result.nodesToAdd.find(n => n.entity_type === ENTITY_TYPES.INTERFACE);
    const ldeDiagramNode = result.nodesToAdd.find(n => n.entity_type === ENTITY_TYPES.LOGICAL_DATA_ENTITY);

    // Z-index should increase from root to leaves
    // Application < App Component < Service < Interface < Logical Data Entity
    expect(acDiagramNode!.z_index).toBeGreaterThan(appDiagramNode!.z_index);
    expect(svcDiagramNode!.z_index).toBeGreaterThan(acDiagramNode!.z_index);
    expect(intDiagramNode!.z_index).toBeGreaterThan(svcDiagramNode!.z_index);
    expect(ldeDiagramNode!.z_index).toBeGreaterThan(intDiagramNode!.z_index);
  });

  it('should start z-index above existing diagram nodes', () => {
    const metaModel = createMockMetaModelWithBusinessChain();
    const rootEntity = { id: 'bp-1', name: 'Test Business Process', type: ENTITY_TYPES.BUSINESS_PROCESS };

    // Create diagram with existing node at z-index 10
    const existingNode: DiagramNode = {
      id: 'other-node',
      entity_type: ENTITY_TYPES.BUSINESS_USER,
      entity_id: 'bu-1',
      pos_x: 50,
      pos_y: 50,
      width: 100,
      height: 60,
      auto_size: false,
      z_index: 10,
      parent_node_id: null,
      style_override: {},
    };
    const diagram = createMockDiagram([existingNode]);
    const viewportCenter = { x: 500, y: 400 };

    const treeData = buildTreeData(metaModel, rootEntity);
    const paNode = findNodeByEntity(treeData, ENTITY_TYPES.PROCESS_ACTIVITY, 'pa-1');

    const selectedKeys = new Set([treeData.key, paNode!.key]);
    const orderedNodes = buildOrderedNodeListFromLeaves(selectedKeys, treeData);

    const result = buildWrappedNodeHierarchy(
      orderedNodes,
      treeData,
      metaModel,
      diagram,
      viewportCenter
    );

    // Find diagram nodes
    const bpDiagramNode = result.nodesToAdd.find(n => n.entity_type === ENTITY_TYPES.BUSINESS_PROCESS);
    const paDiagramNode = result.nodesToAdd.find(n => n.entity_type === ENTITY_TYPES.PROCESS_ACTIVITY);

    // All new nodes should have z-index > existing (10)
    expect(bpDiagramNode!.z_index).toBeGreaterThan(10);
    expect(paDiagramNode!.z_index).toBeGreaterThan(bpDiagramNode!.z_index);
  });
});
