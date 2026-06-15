/**
 * @vitest-environment jsdom
 */

/**
 * Advanced Add Recursive Wrapping Tests
 *
 * Task Group 4: Recursive Wrapping Implementation
 * Tests for recursive wrapping from leaf to root when placing nodes on the diagram.
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
  calculateParentSizeWithHeights,
  PADDING,
  DEFAULT_CHILD_WIDTH,
} from '../utils/compoundLayout';

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
// Mock Data Factory
// ============================================================================

/**
 * Create a mock MetaModel with Application -> Service -> Interface hierarchy
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
      app_components: [],
      services: [
        { id: 'svc-1', application_id: 'app-1', app_component_id: null, name: 'Service 1', description: '', service_type: 'API', tags: '' },
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
}

/**
 * Create a mock MetaModel with Business Process -> Process Activity hierarchy
 */
function createMockMetaModelWithProcessHierarchy(): MetaModel {
  return {
    entities: {
      business_users: [],
      business_processes: [
        { id: 'bp-1', name: 'Test Business Process', description: '', tags: '' },
      ],
      process_activities: [
        { id: 'pa-1', business_process_id: 'bp-1', name: 'Activity 1', description: '', tags: '' },
        { id: 'pa-2', business_process_id: 'bp-1', name: 'Activity 2', description: '', tags: '' },
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
      application_point_business_processes: [],
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

/**
 * Create a mock existing diagram node
 */
function createExistingNode(
  entityType: string,
  entityId: string,
  nodeId: string,
  options: Partial<DiagramNode> = {}
): DiagramNode {
  return {
    id: nodeId,
    entity_type: entityType,
    entity_id: entityId,
    pos_x: 100,
    pos_y: 100,
    width: 120,
    height: 60,
    auto_size: false,
    z_index: 1,
    parent_node_id: null,
    style_override: {},
    ...options,
  };
}

// ============================================================================
// Test 1: Leaf node is positioned inside parent container
// ============================================================================

describe('Recursive wrapping: leaf node positioned inside parent container', () => {
  it('should position child nodes inside their parent containers', () => {
    const metaModel = createMockMetaModelWithProcessHierarchy();
    const rootEntity = { id: 'bp-1', name: 'Test Business Process', type: ENTITY_TYPES.BUSINESS_PROCESS };
    const diagram = createMockDiagram();
    const viewportCenter = { x: 500, y: 400 };

    const treeData = buildTreeData(metaModel, rootEntity);

    // Find all selected nodes (root + activities)
    const activityNode = findNodeByEntity(treeData, ENTITY_TYPES.PROCESS_ACTIVITY, 'pa-1');
    expect(activityNode).toBeDefined();

    const selectedKeys = new Set([treeData.key, activityNode!.key]);
    const orderedNodes = buildOrderedNodeListFromLeaves(selectedKeys, treeData);

    // Build wrapped hierarchy
    const result = buildWrappedNodeHierarchy(
      orderedNodes,
      treeData,
      metaModel,
      diagram,
      viewportCenter
    );

    // Should have at least 2 nodes (parent + child)
    expect(result.nodesToAdd.length).toBeGreaterThanOrEqual(2);

    // Find the parent and child nodes
    const parentNode = result.nodesToAdd.find(n => n.entity_type === ENTITY_TYPES.BUSINESS_PROCESS);
    const childNode = result.nodesToAdd.find(n => n.entity_type === ENTITY_TYPES.PROCESS_ACTIVITY);

    expect(parentNode).toBeDefined();
    expect(childNode).toBeDefined();

    // Child should be positioned inside parent bounds
    expect(childNode!.pos_x).toBeGreaterThanOrEqual(parentNode!.pos_x);
    expect(childNode!.pos_y).toBeGreaterThanOrEqual(parentNode!.pos_y);
    expect(childNode!.pos_x + childNode!.width).toBeLessThanOrEqual(parentNode!.pos_x + parentNode!.width);
    expect(childNode!.pos_y + childNode!.height).toBeLessThanOrEqual(parentNode!.pos_y + parentNode!.height);

    // Child should have parent_node_id set
    expect(childNode!.parent_node_id).toBe(parentNode!.id);
  });

  it('should position multiple children inside the same parent', () => {
    const metaModel = createMockMetaModelWithProcessHierarchy();
    const rootEntity = { id: 'bp-1', name: 'Test Business Process', type: ENTITY_TYPES.BUSINESS_PROCESS };
    const diagram = createMockDiagram();
    const viewportCenter = { x: 500, y: 400 };

    const treeData = buildTreeData(metaModel, rootEntity);

    // Select both activities
    const activity1Node = findNodeByEntity(treeData, ENTITY_TYPES.PROCESS_ACTIVITY, 'pa-1');
    const activity2Node = findNodeByEntity(treeData, ENTITY_TYPES.PROCESS_ACTIVITY, 'pa-2');
    expect(activity1Node).toBeDefined();
    expect(activity2Node).toBeDefined();

    const selectedKeys = new Set([treeData.key, activity1Node!.key, activity2Node!.key]);
    const orderedNodes = buildOrderedNodeListFromLeaves(selectedKeys, treeData);

    const result = buildWrappedNodeHierarchy(
      orderedNodes,
      treeData,
      metaModel,
      diagram,
      viewportCenter
    );

    // Should have 3 nodes (parent + 2 children)
    expect(result.nodesToAdd.length).toBeGreaterThanOrEqual(3);

    const parentNode = result.nodesToAdd.find(n => n.entity_type === ENTITY_TYPES.BUSINESS_PROCESS);
    const childNodes = result.nodesToAdd.filter(n => n.entity_type === ENTITY_TYPES.PROCESS_ACTIVITY);

    expect(parentNode).toBeDefined();
    expect(childNodes.length).toBe(2);

    // All children should be inside parent
    childNodes.forEach(child => {
      expect(child.pos_x).toBeGreaterThanOrEqual(parentNode!.pos_x);
      expect(child.pos_y).toBeGreaterThanOrEqual(parentNode!.pos_y);
      expect(child.parent_node_id).toBe(parentNode!.id);
    });

    // Find the first and second activity by entity_id to check vertical stacking
    const firstChild = childNodes.find(n => n.entity_id === 'pa-1');
    const secondChild = childNodes.find(n => n.entity_id === 'pa-2');
    expect(firstChild).toBeDefined();
    expect(secondChild).toBeDefined();

    // Second activity should be below first activity (stacked vertically)
    expect(secondChild!.pos_y).toBeGreaterThan(firstChild!.pos_y);
  });
});

// ============================================================================
// Test 2: Parent node has text_v_align='TOP' and text_font_weight='bold'
// ============================================================================

describe('Recursive wrapping: parent node containment styling', () => {
  it('should set text_v_align to TOP for parent nodes', () => {
    const metaModel = createMockMetaModelWithProcessHierarchy();
    const rootEntity = { id: 'bp-1', name: 'Test Business Process', type: ENTITY_TYPES.BUSINESS_PROCESS };
    const diagram = createMockDiagram();
    const viewportCenter = { x: 500, y: 400 };

    const treeData = buildTreeData(metaModel, rootEntity);
    const activityNode = findNodeByEntity(treeData, ENTITY_TYPES.PROCESS_ACTIVITY, 'pa-1');

    const selectedKeys = new Set([treeData.key, activityNode!.key]);
    const orderedNodes = buildOrderedNodeListFromLeaves(selectedKeys, treeData);

    const result = buildWrappedNodeHierarchy(
      orderedNodes,
      treeData,
      metaModel,
      diagram,
      viewportCenter
    );

    const parentNode = result.nodesToAdd.find(n => n.entity_type === ENTITY_TYPES.BUSINESS_PROCESS);
    expect(parentNode).toBeDefined();
    expect(parentNode!.text_v_align).toBe('TOP');
  });

  it('should set text_font_weight to bold for parent nodes', () => {
    const metaModel = createMockMetaModelWithProcessHierarchy();
    const rootEntity = { id: 'bp-1', name: 'Test Business Process', type: ENTITY_TYPES.BUSINESS_PROCESS };
    const diagram = createMockDiagram();
    const viewportCenter = { x: 500, y: 400 };

    const treeData = buildTreeData(metaModel, rootEntity);
    const activityNode = findNodeByEntity(treeData, ENTITY_TYPES.PROCESS_ACTIVITY, 'pa-1');

    const selectedKeys = new Set([treeData.key, activityNode!.key]);
    const orderedNodes = buildOrderedNodeListFromLeaves(selectedKeys, treeData);

    const result = buildWrappedNodeHierarchy(
      orderedNodes,
      treeData,
      metaModel,
      diagram,
      viewportCenter
    );

    const parentNode = result.nodesToAdd.find(n => n.entity_type === ENTITY_TYPES.BUSINESS_PROCESS);
    expect(parentNode).toBeDefined();
    expect(parentNode!.text_font_weight).toBe('bold');
  });
});

// ============================================================================
// Test 3: Parent dimensions calculated using calculateParentSizeWithHeights
// ============================================================================

describe('Recursive wrapping: parent dimensions calculated correctly', () => {
  it('should size parent to contain all children', () => {
    const metaModel = createMockMetaModelWithProcessHierarchy();
    const rootEntity = { id: 'bp-1', name: 'Test Business Process', type: ENTITY_TYPES.BUSINESS_PROCESS };
    const diagram = createMockDiagram();
    const viewportCenter = { x: 500, y: 400 };

    const treeData = buildTreeData(metaModel, rootEntity);

    // Select both activities
    const activity1Node = findNodeByEntity(treeData, ENTITY_TYPES.PROCESS_ACTIVITY, 'pa-1');
    const activity2Node = findNodeByEntity(treeData, ENTITY_TYPES.PROCESS_ACTIVITY, 'pa-2');

    const selectedKeys = new Set([treeData.key, activity1Node!.key, activity2Node!.key]);
    const orderedNodes = buildOrderedNodeListFromLeaves(selectedKeys, treeData);

    const result = buildWrappedNodeHierarchy(
      orderedNodes,
      treeData,
      metaModel,
      diagram,
      viewportCenter
    );

    const parentNode = result.nodesToAdd.find(n => n.entity_type === ENTITY_TYPES.BUSINESS_PROCESS);
    const childNodes = result.nodesToAdd.filter(n => n.entity_type === ENTITY_TYPES.PROCESS_ACTIVITY);

    expect(parentNode).toBeDefined();
    expect(childNodes.length).toBe(2);

    // Parent width should accommodate children plus padding
    expect(parentNode!.width).toBeGreaterThanOrEqual(DEFAULT_CHILD_WIDTH + 2 * PADDING);

    // Parent height should accommodate all children stacked vertically
    const totalChildHeight = childNodes.reduce((sum, child) => sum + child.height, 0);
    const minimumParentHeight = totalChildHeight + 3 * PADDING; // label + gaps
    expect(parentNode!.height).toBeGreaterThanOrEqual(minimumParentHeight);
  });
});

// ============================================================================
// Test 4: Existing parent node is reused and resized (not duplicated)
// ============================================================================

describe('Recursive wrapping: existing parent node reuse', () => {
  it('should reuse existing parent node as container', () => {
    const metaModel = createMockMetaModelWithProcessHierarchy();
    const rootEntity = { id: 'bp-1', name: 'Test Business Process', type: ENTITY_TYPES.BUSINESS_PROCESS };

    // Create diagram with existing parent node
    const existingParentNode = createExistingNode(
      ENTITY_TYPES.BUSINESS_PROCESS,
      'bp-1',
      'existing-bp-node',
      { pos_x: 200, pos_y: 200, width: 120, height: 60 }
    );
    const diagram = createMockDiagram([existingParentNode]);
    const viewportCenter = { x: 500, y: 400 };

    const treeData = buildTreeData(metaModel, rootEntity);
    const activityNode = findNodeByEntity(treeData, ENTITY_TYPES.PROCESS_ACTIVITY, 'pa-1');

    const selectedKeys = new Set([treeData.key, activityNode!.key]);
    const orderedNodes = buildOrderedNodeListFromLeaves(selectedKeys, treeData);

    const result = buildWrappedNodeHierarchy(
      orderedNodes,
      treeData,
      metaModel,
      diagram,
      viewportCenter
    );

    // Should not add a new parent node (parent already exists)
    const newParentNodes = result.nodesToAdd.filter(
      n => n.entity_type === ENTITY_TYPES.BUSINESS_PROCESS && n.entity_id === 'bp-1'
    );
    expect(newParentNodes.length).toBe(0);

    // Should have updates for the existing parent
    expect(result.nodesToUpdate.length).toBeGreaterThan(0);

    const parentUpdate = result.nodesToUpdate.find(
      u => u.nodeId === 'existing-bp-node'
    );
    expect(parentUpdate).toBeDefined();

    // Child should reference the existing parent node ID
    const childNode = result.nodesToAdd.find(n => n.entity_type === ENTITY_TYPES.PROCESS_ACTIVITY);
    expect(childNode).toBeDefined();
    expect(childNode!.parent_node_id).toBe('existing-bp-node');
  });

  it('should resize existing parent node to fit new children', () => {
    const metaModel = createMockMetaModelWithProcessHierarchy();
    const rootEntity = { id: 'bp-1', name: 'Test Business Process', type: ENTITY_TYPES.BUSINESS_PROCESS };

    // Create diagram with existing parent node (small size)
    const existingParentNode = createExistingNode(
      ENTITY_TYPES.BUSINESS_PROCESS,
      'bp-1',
      'existing-bp-node',
      { pos_x: 200, pos_y: 200, width: 120, height: 60 }
    );
    const diagram = createMockDiagram([existingParentNode]);
    const viewportCenter = { x: 500, y: 400 };

    const treeData = buildTreeData(metaModel, rootEntity);

    // Select both activities
    const activity1Node = findNodeByEntity(treeData, ENTITY_TYPES.PROCESS_ACTIVITY, 'pa-1');
    const activity2Node = findNodeByEntity(treeData, ENTITY_TYPES.PROCESS_ACTIVITY, 'pa-2');

    const selectedKeys = new Set([treeData.key, activity1Node!.key, activity2Node!.key]);
    const orderedNodes = buildOrderedNodeListFromLeaves(selectedKeys, treeData);

    const result = buildWrappedNodeHierarchy(
      orderedNodes,
      treeData,
      metaModel,
      diagram,
      viewportCenter
    );

    // Find the update for the existing parent
    const parentUpdate = result.nodesToUpdate.find(
      u => u.nodeId === 'existing-bp-node'
    );
    expect(parentUpdate).toBeDefined();

    // The update should include larger dimensions
    expect(parentUpdate!.updates.height).toBeDefined();
    expect(parentUpdate!.updates.height).toBeGreaterThan(existingParentNode.height);
  });

  it('should apply containment styling to existing parent node', () => {
    const metaModel = createMockMetaModelWithProcessHierarchy();
    const rootEntity = { id: 'bp-1', name: 'Test Business Process', type: ENTITY_TYPES.BUSINESS_PROCESS };

    // Create diagram with existing parent node without containment styling
    const existingParentNode = createExistingNode(
      ENTITY_TYPES.BUSINESS_PROCESS,
      'bp-1',
      'existing-bp-node',
      { pos_x: 200, pos_y: 200, width: 120, height: 60 }
    );
    const diagram = createMockDiagram([existingParentNode]);
    const viewportCenter = { x: 500, y: 400 };

    const treeData = buildTreeData(metaModel, rootEntity);
    const activityNode = findNodeByEntity(treeData, ENTITY_TYPES.PROCESS_ACTIVITY, 'pa-1');

    const selectedKeys = new Set([treeData.key, activityNode!.key]);
    const orderedNodes = buildOrderedNodeListFromLeaves(selectedKeys, treeData);

    const result = buildWrappedNodeHierarchy(
      orderedNodes,
      treeData,
      metaModel,
      diagram,
      viewportCenter
    );

    // Find the update for the existing parent
    const parentUpdate = result.nodesToUpdate.find(
      u => u.nodeId === 'existing-bp-node'
    );
    expect(parentUpdate).toBeDefined();

    // Update should include containment styling
    expect(parentUpdate!.updates.text_v_align).toBe('TOP');
    expect(parentUpdate!.updates.text_font_weight).toBe('bold');
  });
});

// ============================================================================
// Test 5: Z-index ordering - children above parents
// ============================================================================

describe('Recursive wrapping: z-index ordering', () => {
  it('should set child z-index higher than parent z-index', () => {
    const metaModel = createMockMetaModelWithProcessHierarchy();
    const rootEntity = { id: 'bp-1', name: 'Test Business Process', type: ENTITY_TYPES.BUSINESS_PROCESS };
    const diagram = createMockDiagram();
    const viewportCenter = { x: 500, y: 400 };

    const treeData = buildTreeData(metaModel, rootEntity);
    const activityNode = findNodeByEntity(treeData, ENTITY_TYPES.PROCESS_ACTIVITY, 'pa-1');

    const selectedKeys = new Set([treeData.key, activityNode!.key]);
    const orderedNodes = buildOrderedNodeListFromLeaves(selectedKeys, treeData);

    const result = buildWrappedNodeHierarchy(
      orderedNodes,
      treeData,
      metaModel,
      diagram,
      viewportCenter
    );

    const parentNode = result.nodesToAdd.find(n => n.entity_type === ENTITY_TYPES.BUSINESS_PROCESS);
    const childNode = result.nodesToAdd.find(n => n.entity_type === ENTITY_TYPES.PROCESS_ACTIVITY);

    expect(parentNode).toBeDefined();
    expect(childNode).toBeDefined();

    // Child should have higher z-index than parent
    expect(childNode!.z_index).toBeGreaterThan(parentNode!.z_index);
  });
});

// ============================================================================
// Test 6: Multi-level nesting (Application -> Service -> Interface)
// ============================================================================

describe('Recursive wrapping: multi-level nesting', () => {
  it('should create proper nested hierarchy for 3-level tree', () => {
    const metaModel = createMockMetaModelWithHierarchy();
    const rootEntity = { id: 'app-1', name: 'Test Application', type: ENTITY_TYPES.APPLICATION };
    const diagram = createMockDiagram();
    const viewportCenter = { x: 500, y: 400 };

    const treeData = buildTreeData(metaModel, rootEntity);

    // Select interface (deepest leaf)
    const interfaceNode = findNodeByEntity(treeData, ENTITY_TYPES.INTERFACE, 'int-1');
    const serviceNode = findNodeByEntity(treeData, ENTITY_TYPES.SERVICE, 'svc-1');
    expect(interfaceNode).toBeDefined();
    expect(serviceNode).toBeDefined();

    // Select interface and its ancestors
    const selectedKeys = new Set([treeData.key, serviceNode!.key, interfaceNode!.key]);
    const orderedNodes = buildOrderedNodeListFromLeaves(selectedKeys, treeData);

    const result = buildWrappedNodeHierarchy(
      orderedNodes,
      treeData,
      metaModel,
      diagram,
      viewportCenter
    );

    // Should have 3 nodes (Application, Service, Interface)
    expect(result.nodesToAdd.length).toBe(3);

    const appNode = result.nodesToAdd.find(n => n.entity_type === ENTITY_TYPES.APPLICATION);
    const svcNode = result.nodesToAdd.find(n => n.entity_type === ENTITY_TYPES.SERVICE);
    const intNode = result.nodesToAdd.find(n => n.entity_type === ENTITY_TYPES.INTERFACE);

    expect(appNode).toBeDefined();
    expect(svcNode).toBeDefined();
    expect(intNode).toBeDefined();

    // Check containment hierarchy
    expect(svcNode!.parent_node_id).toBe(appNode!.id);
    expect(intNode!.parent_node_id).toBe(svcNode!.id);

    // Application and Service should have containment styling
    expect(appNode!.text_v_align).toBe('TOP');
    expect(appNode!.text_font_weight).toBe('bold');
    expect(svcNode!.text_v_align).toBe('TOP');
    expect(svcNode!.text_font_weight).toBe('bold');
  });
});
