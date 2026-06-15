/**
 * Task Group 5: Integration Tests for Advanced Add with Recursive Wrapping
 *
 * These tests verify that handleAdvancedAddConfirm correctly creates
 * wrapped node hierarchies using buildWrappedNodeHierarchy.
 */

import { describe, it, expect } from 'vitest';
import { ENTITY_TYPES, MetaModel, DiagramNode } from '../types/model';
import { TreeNodeData } from '../types/advancedAdd';
import {
  buildTreeData,
  buildOrderedNodeListFromLeaves,
} from '../components/DiagramsView/AdvancedAddDialog';
import { buildWrappedNodeHierarchy, WrappedNodeResult } from '../components/DiagramsView/PalettePanel';

// ============================================================================
// Mock Data
// ============================================================================

const createMockMetaModel = (): MetaModel => ({
  entities: {
    business_users: [],
    business_processes: [
      { id: 'bp-1', name: 'Process 1', description: '', tags: '' },
      { id: 'bp-2', name: 'Process 2', description: '', tags: '' },
    ],
    process_activities: [
      { id: 'pa-1', business_process_id: 'bp-1', name: 'Activity 1', description: '', sequence_order: 1, actor_hint: 'END_USER', user_interaction_level: 'MODERATE', tags: '' },
      { id: 'pa-2', business_process_id: 'bp-1', name: 'Activity 2', description: '', sequence_order: 2, actor_hint: 'END_USER', user_interaction_level: 'MODERATE', tags: '' },
    ],
    applications: [
      { id: 'app-1', name: 'Test Application', description: '', app_type: 'Web', status: 'Active', tags: '' },
    ],
    app_components: [
      { id: 'ac-1', application_id: 'app-1', name: 'Component 1', description: '', tags: '' },
    ],
    services: [
      { id: 'svc-1', application_id: 'app-1', app_component_id: 'ac-1', name: 'Service 1', description: '', service_type: 'API', tags: '' },
      { id: 'svc-2', application_id: 'app-1', name: 'Service 2', description: '', service_type: 'API', tags: '' },
    ],
    interfaces: [
      { id: 'int-1', service_id: 'svc-1', name: 'Interface 1', description: '', interface_type: 'REST_API', tags: '' },
      { id: 'int-2', service_id: 'svc-1', name: 'Interface 2', description: '', interface_type: 'REST_API', tags: '' },
    ],
      endpoints: [],
    application_points: [
      { id: 'ap-1', application_id: 'app-1', name: 'App Point 1', description: '', kind: 'APPLICATION', point_type: '', tags: '' },
    ],
    business_points: [
      { id: 'bpt-1', name: 'Process 1 Point', description: '', kind: 'BUSINESS_PROCESS', business_process_id: 'bp-1', tags: '' },
    ],
    logical_data_entities: [
      { id: 'lde-1', name: 'Logical Entity 1', description: '', tags: '' },
    ],
    logical_data_attributes: [],
    physical_data_entities: [],
    physical_data_attributes: [],
  },
  relationships: {
    business_user_business_points: [],
    application_point_business_points: [
      { id: 'apbp-1', application_point_id: 'ap-1', business_point_id: 'bpt-1', description: '', tags: '' },
    ],
    logical_data_entity_relationships: [],
    logical_data_entity_physical_data_entities: [],
    logical_data_attribute_physical_data_attributes: [],
    data_movements: [],
    interface_logical_entities: [],
  },
});

// ============================================================================
// Test 1: Adding Application with selected Business Processes creates wrapped hierarchy
// ============================================================================

describe('Task 5.1: Application with Business Processes creates wrapped hierarchy', () => {
  const metaModel = createMockMetaModel();

  it('should create Application parent with Business Process child inside', () => {
    // Build tree from Application root
    const rootEntity = { id: 'app-1', name: 'Test Application', type: ENTITY_TYPES.APPLICATION };
    const treeData = buildTreeData(metaModel, rootEntity);

    // Select the root and a business process child
    const selectedKeys = new Set<string>();
    selectedKeys.add(treeData.key); // Root

    // Find the business process in children
    const bpNode = treeData.children.find(
      c => c.entityType === ENTITY_TYPES.BUSINESS_PROCESS && c.entityId === 'bp-1'
    );
    expect(bpNode).toBeDefined();
    selectedKeys.add(bpNode!.key);

    // Build ordered list and wrapped hierarchy
    const orderedNodes = buildOrderedNodeListFromLeaves(selectedKeys, treeData);
    expect(orderedNodes.length).toBe(2); // BP + App

    // Verify order is leaves first (BP before App)
    expect(orderedNodes[0].entityType).toBe(ENTITY_TYPES.BUSINESS_PROCESS);
    expect(orderedNodes[1].entityType).toBe(ENTITY_TYPES.APPLICATION);

    const diagram = { diagram_nodes: [], diagram_edges: [] };
    const viewportCenter = { x: 400, y: 300 };

    const result = buildWrappedNodeHierarchy(
      orderedNodes,
      treeData,
      metaModel,
      diagram,
      viewportCenter
    );

    // Should create 2 nodes
    expect(result.nodesToAdd.length).toBe(2);

    // Find the Application and Business Process nodes
    const appNode = result.nodesToAdd.find(n => n.entity_type === ENTITY_TYPES.APPLICATION);
    const bpDiagramNode = result.nodesToAdd.find(n => n.entity_type === ENTITY_TYPES.BUSINESS_PROCESS);

    expect(appNode).toBeDefined();
    expect(bpDiagramNode).toBeDefined();

    // Business Process should be a child of Application
    expect(bpDiagramNode!.parent_node_id).toBe(appNode!.id);

    // Application should have containment styling
    expect(appNode!.text_v_align).toBe('TOP');
    expect(appNode!.text_font_weight).toBe('bold');

    // Business Process z-index should be higher than Application
    expect(bpDiagramNode!.z_index).toBeGreaterThan(appNode!.z_index);
  });
});

// ============================================================================
// Test 2: Adding Service with selected Interfaces creates wrapped hierarchy
// ============================================================================

describe('Task 5.1: Service with Interfaces creates wrapped hierarchy', () => {
  const metaModel = createMockMetaModel();

  it('should create Service parent with Interface children inside', () => {
    // Build tree from Service root
    const rootEntity = { id: 'svc-1', name: 'Service 1', type: ENTITY_TYPES.SERVICE };
    const treeData = buildTreeData(metaModel, rootEntity);

    // Select root and all interface children
    const selectedKeys = new Set<string>();
    selectedKeys.add(treeData.key);

    const interfaceNodes = treeData.children.filter(
      c => c.entityType === ENTITY_TYPES.INTERFACE
    );
    expect(interfaceNodes.length).toBe(2);
    interfaceNodes.forEach(node => selectedKeys.add(node.key));

    // Build ordered list
    const orderedNodes = buildOrderedNodeListFromLeaves(selectedKeys, treeData);
    expect(orderedNodes.length).toBe(3); // 2 interfaces + 1 service

    // Interfaces should come first (leaves)
    expect(orderedNodes[0].entityType).toBe(ENTITY_TYPES.INTERFACE);
    expect(orderedNodes[1].entityType).toBe(ENTITY_TYPES.INTERFACE);
    expect(orderedNodes[2].entityType).toBe(ENTITY_TYPES.SERVICE);

    const diagram = { diagram_nodes: [], diagram_edges: [] };
    const viewportCenter = { x: 400, y: 300 };

    const result = buildWrappedNodeHierarchy(
      orderedNodes,
      treeData,
      metaModel,
      diagram,
      viewportCenter
    );

    // Should create 3 nodes
    expect(result.nodesToAdd.length).toBe(3);

    // Find nodes
    const svcNode = result.nodesToAdd.find(n => n.entity_type === ENTITY_TYPES.SERVICE);
    const intNodes = result.nodesToAdd.filter(n => n.entity_type === ENTITY_TYPES.INTERFACE);

    expect(svcNode).toBeDefined();
    expect(intNodes.length).toBe(2);

    // Both interfaces should be children of service
    intNodes.forEach(intNode => {
      expect(intNode.parent_node_id).toBe(svcNode!.id);
      expect(intNode.z_index).toBeGreaterThan(svcNode!.z_index);
    });

    // Service should have containment styling
    expect(svcNode!.text_v_align).toBe('TOP');
    expect(svcNode!.text_font_weight).toBe('bold');
  });
});

// ============================================================================
// Test 3: Multiple levels (Application -> Service -> Interface) creates nested containment
// ============================================================================

describe('Task 5.1: Multi-level nesting creates nested containment', () => {
  const metaModel = createMockMetaModel();

  it('should create Application -> Service -> Interface nested hierarchy', () => {
    // Build tree from Application root
    const rootEntity = { id: 'app-1', name: 'Test Application', type: ENTITY_TYPES.APPLICATION };
    const treeData = buildTreeData(metaModel, rootEntity);

    // Service 1 belongs to AppComponent, so look for it under the AppComponent
    // First find the AppComponent
    const acNode = treeData.children.find(
      c => c.entityType === ENTITY_TYPES.APP_COMPONENT && c.entityId === 'ac-1'
    );
    expect(acNode).toBeDefined();

    // Find Service 1 under AppComponent (which has interfaces)
    const svcNode = acNode!.children.find(
      c => c.entityType === ENTITY_TYPES.SERVICE && c.entityId === 'svc-1'
    );
    expect(svcNode).toBeDefined();

    // Find Interface under Service 1
    const intNode = svcNode!.children.find(
      c => c.entityType === ENTITY_TYPES.INTERFACE && c.entityId === 'int-1'
    );
    expect(intNode).toBeDefined();

    // Select root, appComponent, service, and interface for complete hierarchy
    const selectedKeys = new Set<string>();
    selectedKeys.add(treeData.key);        // Application
    selectedKeys.add(acNode!.key);         // AppComponent
    selectedKeys.add(svcNode!.key);        // Service
    selectedKeys.add(intNode!.key);        // Interface

    // Build ordered list
    const orderedNodes = buildOrderedNodeListFromLeaves(selectedKeys, treeData);
    expect(orderedNodes.length).toBe(4);

    // Order should be: Interface (deepest), Service, AppComponent, Application (root)
    expect(orderedNodes[0].entityType).toBe(ENTITY_TYPES.INTERFACE);
    expect(orderedNodes[1].entityType).toBe(ENTITY_TYPES.SERVICE);
    expect(orderedNodes[2].entityType).toBe(ENTITY_TYPES.APP_COMPONENT);
    expect(orderedNodes[3].entityType).toBe(ENTITY_TYPES.APPLICATION);

    const diagram = { diagram_nodes: [], diagram_edges: [] };
    const viewportCenter = { x: 400, y: 300 };

    const result = buildWrappedNodeHierarchy(
      orderedNodes,
      treeData,
      metaModel,
      diagram,
      viewportCenter
    );

    expect(result.nodesToAdd.length).toBe(4);

    // Find nodes
    const appDiagramNode = result.nodesToAdd.find(n => n.entity_type === ENTITY_TYPES.APPLICATION);
    const acDiagramNode = result.nodesToAdd.find(n => n.entity_type === ENTITY_TYPES.APP_COMPONENT);
    const svcDiagramNode = result.nodesToAdd.find(n => n.entity_type === ENTITY_TYPES.SERVICE);
    const intDiagramNode = result.nodesToAdd.find(n => n.entity_type === ENTITY_TYPES.INTERFACE);

    expect(appDiagramNode).toBeDefined();
    expect(acDiagramNode).toBeDefined();
    expect(svcDiagramNode).toBeDefined();
    expect(intDiagramNode).toBeDefined();

    // Verify containment: AppComponent -> Application, Service -> AppComponent, Interface -> Service
    expect(acDiagramNode!.parent_node_id).toBe(appDiagramNode!.id);
    expect(svcDiagramNode!.parent_node_id).toBe(acDiagramNode!.id);
    expect(intDiagramNode!.parent_node_id).toBe(svcDiagramNode!.id);

    // Z-index ordering: Interface > Service > AppComponent > Application
    expect(intDiagramNode!.z_index).toBeGreaterThan(svcDiagramNode!.z_index);
    expect(svcDiagramNode!.z_index).toBeGreaterThan(acDiagramNode!.z_index);
    expect(acDiagramNode!.z_index).toBeGreaterThan(appDiagramNode!.z_index);

    // All container nodes should have containment styling
    expect(appDiagramNode!.text_v_align).toBe('TOP');
    expect(appDiagramNode!.text_font_weight).toBe('bold');
    expect(acDiagramNode!.text_v_align).toBe('TOP');
    expect(acDiagramNode!.text_font_weight).toBe('bold');
    expect(svcDiagramNode!.text_v_align).toBe('TOP');
    expect(svcDiagramNode!.text_font_weight).toBe('bold');
  });
});

// ============================================================================
// Test 4: Idempotency - adding to diagram with existing nodes reuses them
// ============================================================================

describe('Task 5.1: Idempotency - existing nodes are reused', () => {
  const metaModel = createMockMetaModel();

  it('should reuse existing parent node and update its styling', () => {
    // Build tree from Application root
    const rootEntity = { id: 'app-1', name: 'Test Application', type: ENTITY_TYPES.APPLICATION };
    const treeData = buildTreeData(metaModel, rootEntity);

    // Find business process
    const bpNode = treeData.children.find(
      c => c.entityType === ENTITY_TYPES.BUSINESS_PROCESS && c.entityId === 'bp-1'
    );
    expect(bpNode).toBeDefined();

    // Select root and BP
    const selectedKeys = new Set<string>();
    selectedKeys.add(treeData.key);
    selectedKeys.add(bpNode!.key);

    const orderedNodes = buildOrderedNodeListFromLeaves(selectedKeys, treeData);

    // Create diagram with existing Application node
    const existingAppNode: DiagramNode = {
      id: 'existing-app-node',
      entity_type: ENTITY_TYPES.APPLICATION,
      entity_id: 'app-1',
      pos_x: 100,
      pos_y: 100,
      width: 150,
      height: 100,
      auto_size: false,
      z_index: 1,
      parent_node_id: null,
      style_override: {},
    };

    const diagram = { diagram_nodes: [existingAppNode], diagram_edges: [] };
    const viewportCenter = { x: 400, y: 300 };

    const result = buildWrappedNodeHierarchy(
      orderedNodes,
      treeData,
      metaModel,
      diagram,
      viewportCenter
    );

    // Should only add 1 new node (BP), not duplicate the Application
    expect(result.nodesToAdd.length).toBe(1);
    expect(result.nodesToAdd[0].entity_type).toBe(ENTITY_TYPES.BUSINESS_PROCESS);

    // BP should reference the existing Application node
    expect(result.nodesToAdd[0].parent_node_id).toBe('existing-app-node');

    // Existing Application should be updated with containment styling
    expect(result.nodesToUpdate.length).toBe(1);
    expect(result.nodesToUpdate[0].nodeId).toBe('existing-app-node');
    expect(result.nodesToUpdate[0].updates.text_v_align).toBe('TOP');
    expect(result.nodesToUpdate[0].updates.text_font_weight).toBe('bold');
  });

  it('should not create duplicate nodes for entities already on diagram', () => {
    const rootEntity = { id: 'svc-1', name: 'Service 1', type: ENTITY_TYPES.SERVICE };
    const treeData = buildTreeData(metaModel, rootEntity);

    // Select root and one interface
    const selectedKeys = new Set<string>();
    selectedKeys.add(treeData.key);

    const intNode = treeData.children.find(
      c => c.entityType === ENTITY_TYPES.INTERFACE && c.entityId === 'int-1'
    );
    selectedKeys.add(intNode!.key);

    const orderedNodes = buildOrderedNodeListFromLeaves(selectedKeys, treeData);

    // Both Service and Interface already exist
    const existingServiceNode: DiagramNode = {
      id: 'existing-svc-node',
      entity_type: ENTITY_TYPES.SERVICE,
      entity_id: 'svc-1',
      pos_x: 100,
      pos_y: 100,
      width: 130,
      height: 80,
      auto_size: false,
      z_index: 1,
      parent_node_id: null,
      style_override: {},
    };

    const existingIntNode: DiagramNode = {
      id: 'existing-int-node',
      entity_type: ENTITY_TYPES.INTERFACE,
      entity_id: 'int-1',
      pos_x: 105,
      pos_y: 130,
      width: 120,
      height: 60,
      auto_size: false,
      z_index: 2,
      parent_node_id: 'existing-svc-node',
      style_override: {},
    };

    const diagram = { diagram_nodes: [existingServiceNode, existingIntNode], diagram_edges: [] };
    const viewportCenter = { x: 400, y: 300 };

    const result = buildWrappedNodeHierarchy(
      orderedNodes,
      treeData,
      metaModel,
      diagram,
      viewportCenter
    );

    // No new nodes should be added (both exist)
    expect(result.nodesToAdd.length).toBe(0);
  });
});

// ============================================================================
// Test 5: Z-index ordering is correct (children above parents)
// ============================================================================

describe('Task 5.1: Z-index ordering ensures children above parents', () => {
  const metaModel = createMockMetaModel();

  it('should assign incrementing z-index from root to leaves', () => {
    const rootEntity = { id: 'app-1', name: 'Test Application', type: ENTITY_TYPES.APPLICATION };
    const treeData = buildTreeData(metaModel, rootEntity);

    // Select Application -> AppComponent -> Service 1 -> Interface 1
    const selectedKeys = new Set<string>();
    selectedKeys.add(treeData.key);

    // First find AppComponent
    const acNode = treeData.children.find(
      c => c.entityType === ENTITY_TYPES.APP_COMPONENT && c.entityId === 'ac-1'
    );
    selectedKeys.add(acNode!.key);

    // Find Service under AppComponent
    const svcNode = acNode!.children.find(
      c => c.entityType === ENTITY_TYPES.SERVICE && c.entityId === 'svc-1'
    );
    selectedKeys.add(svcNode!.key);

    const intNode = svcNode!.children.find(
      c => c.entityType === ENTITY_TYPES.INTERFACE
    );
    selectedKeys.add(intNode!.key);

    const orderedNodes = buildOrderedNodeListFromLeaves(selectedKeys, treeData);

    // Start with existing nodes at z-index 5
    const existingNode: DiagramNode = {
      id: 'other-node',
      entity_type: ENTITY_TYPES.BUSINESS_USER,
      entity_id: 'bu-1',
      pos_x: 50,
      pos_y: 50,
      width: 100,
      height: 60,
      auto_size: false,
      z_index: 5,
      parent_node_id: null,
      style_override: {},
    };

    const diagram = { diagram_nodes: [existingNode], diagram_edges: [] };
    const viewportCenter = { x: 400, y: 300 };

    const result = buildWrappedNodeHierarchy(
      orderedNodes,
      treeData,
      metaModel,
      diagram,
      viewportCenter
    );

    expect(result.nodesToAdd.length).toBe(4);

    const appNode = result.nodesToAdd.find(n => n.entity_type === ENTITY_TYPES.APPLICATION);
    const acNode2 = result.nodesToAdd.find(n => n.entity_type === ENTITY_TYPES.APP_COMPONENT);
    const svcDiagramNode = result.nodesToAdd.find(n => n.entity_type === ENTITY_TYPES.SERVICE);
    const intDiagramNode = result.nodesToAdd.find(n => n.entity_type === ENTITY_TYPES.INTERFACE);

    // All new nodes should have z-index > existing (5)
    expect(appNode!.z_index).toBeGreaterThan(5);
    expect(acNode2!.z_index).toBeGreaterThan(appNode!.z_index);
    expect(svcDiagramNode!.z_index).toBeGreaterThan(acNode2!.z_index);
    expect(intDiagramNode!.z_index).toBeGreaterThan(svcDiagramNode!.z_index);
  });
});

// ============================================================================
// Test 6: Parent nodes get proper sizing to contain children
// ============================================================================

describe('Task 5.1: Parent nodes are sized to contain children', () => {
  const metaModel = createMockMetaModel();

  it('should calculate parent dimensions based on children', () => {
    const rootEntity = { id: 'svc-1', name: 'Service 1', type: ENTITY_TYPES.SERVICE };
    const treeData = buildTreeData(metaModel, rootEntity);

    // Select service and both interfaces
    const selectedKeys = new Set<string>();
    selectedKeys.add(treeData.key);

    const interfaceNodes = treeData.children.filter(
      c => c.entityType === ENTITY_TYPES.INTERFACE
    );
    interfaceNodes.forEach(node => selectedKeys.add(node.key));

    const orderedNodes = buildOrderedNodeListFromLeaves(selectedKeys, treeData);

    const diagram = { diagram_nodes: [], diagram_edges: [] };
    const viewportCenter = { x: 400, y: 300 };

    const result = buildWrappedNodeHierarchy(
      orderedNodes,
      treeData,
      metaModel,
      diagram,
      viewportCenter
    );

    const svcNode = result.nodesToAdd.find(n => n.entity_type === ENTITY_TYPES.SERVICE);
    const intNodes = result.nodesToAdd.filter(n => n.entity_type === ENTITY_TYPES.INTERFACE);

    // Service width should accommodate children + padding. The default
    // ('normal') spacing preset uses paddingX = 10: 10 + 120 + 10 = 140.
    expect(svcNode!.width).toBe(140);

    // Service height should be enough to contain all children
    // Each interface positioned below the previous with padding
    expect(svcNode!.height).toBeGreaterThan(0);

    // Interfaces should be positioned inside the service
    intNodes.forEach(intNode => {
      expect(intNode.pos_x).toBeGreaterThanOrEqual(svcNode!.pos_x);
      expect(intNode.pos_y).toBeGreaterThan(svcNode!.pos_y);
      expect(intNode.pos_x + intNode.width).toBeLessThanOrEqual(svcNode!.pos_x + svcNode!.width);
      expect(intNode.pos_y + intNode.height).toBeLessThanOrEqual(svcNode!.pos_y + svcNode!.height);
    });
  });
});
