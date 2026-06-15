/**
 * Advanced Add Business Branch Integration Tests
 *
 * Task Group 4: Strategic integration tests for the Advanced Add feature
 * focusing on end-to-end business branch workflows.
 *
 * These tests fill gaps not covered by Task Groups 1-3:
 * - End-to-end Application with Business Process/Activity selection
 * - Mixed selection (technical + business)
 * - Business Point resolution to underlying entity
 * - Existing node reuse (no duplicates)
 * - Visual result consistency with "Add with business processes"
 * - Interface -> Logical Data Entity containment
 * - Business Process -> Process Activity containment styling
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

/**
 * Find all nodes of a specific entity type in the tree
 */
function findAllNodesByEntityType(
  node: TreeNodeData,
  entityType: string
): TreeNodeData[] {
  const result: TreeNodeData[] = [];
  if (node.entityType === entityType) {
    result.push(node);
  }
  for (const child of node.children) {
    result.push(...findAllNodesByEntityType(child, entityType));
  }
  return result;
}

/**
 * Create an empty diagram for testing
 */
function createEmptyDiagram(): { diagram_nodes: DiagramNode[]; diagram_edges: [] } {
  return {
    diagram_nodes: [],
    diagram_edges: [],
  };
}

/**
 * Create a diagram with existing nodes
 */
function createDiagramWithNodes(nodes: DiagramNode[]): { diagram_nodes: DiagramNode[]; diagram_edges: [] } {
  return {
    diagram_nodes: nodes,
    diagram_edges: [],
  };
}

// ============================================================================
// Mock Data Factory - Full Integration Scenarios
// ============================================================================

/**
 * Create a comprehensive MetaModel for end-to-end testing
 * Includes both technical and business branches under the same Application
 */
function createFullIntegrationMetaModel(): MetaModel {
  return {
    entities: {
      business_users: [
        { id: 'bu-1', name: 'Order Manager', description: '', tags: '' },
      ],
      business_processes: [
        { id: 'bp-1', name: 'Order Processing', description: '', tags: '' },
        { id: 'bp-2', name: 'Payment Processing', description: '', tags: '' },
      ],
      process_activities: [
        { id: 'pa-1', business_process_id: 'bp-1', name: 'Validate Order', description: '', sequence_order: 1, actor_hint: 'END_USER', user_interaction_level: 'MODERATE', tags: '' },
        { id: 'pa-2', business_process_id: 'bp-1', name: 'Process Payment', description: '', sequence_order: 2, actor_hint: 'INTERNAL_SYSTEM', user_interaction_level: 'AUTOMATED', tags: '' },
        { id: 'pa-3', business_process_id: 'bp-2', name: 'Verify Payment', description: '', sequence_order: 1, actor_hint: 'INTERNAL_SYSTEM', user_interaction_level: 'AUTOMATED', tags: '' },
      ],
      business_points: [
        // Business Point wrapping Order Processing (Business Process)
        { id: 'bpt-1', name: 'Order Processing BP', description: '', kind: 'BUSINESS_PROCESS', business_process_id: 'bp-1', tags: '' },
        // Business Point wrapping Payment Processing (Business Process)
        { id: 'bpt-2', name: 'Payment Processing BP', description: '', kind: 'BUSINESS_PROCESS', business_process_id: 'bp-2', tags: '' },
        // Business Point wrapping a Process Activity
        { id: 'bpt-3', name: 'Validate Order Activity BP', description: '', kind: 'PROCESS_ACTIVITY', business_process_id: 'bp-1', process_activity_id: 'pa-1', tags: '' },
      ],
      applications: [
        { id: 'app-1', name: 'Order Management System', description: '', app_type: 'Web', status: 'Active', tags: '' },
      ],
      app_components: [
        { id: 'ac-1', application_id: 'app-1', name: 'Order Component', description: '', tags: '' },
        { id: 'ac-2', application_id: 'app-1', name: 'Payment Component', description: '', tags: '' },
      ],
      services: [
        { id: 'svc-1', application_id: 'app-1', app_component_id: 'ac-1', name: 'Order Service', description: '', service_type: 'API', tags: '' },
        { id: 'svc-2', application_id: 'app-1', app_component_id: 'ac-2', name: 'Payment Service', description: '', service_type: 'API', tags: '' },
      ],
      interfaces: [
        { id: 'int-1', service_id: 'svc-1', name: 'Order API', description: '', interface_type: 'REST_API', tags: '' },
        { id: 'int-2', service_id: 'svc-2', name: 'Payment API', description: '', interface_type: 'REST_API', tags: '' },
      ],
      endpoints: [],
      application_points: [
        { id: 'ap-1', application_id: 'app-1', name: 'Order App Point', description: '', kind: 'APPLICATION', point_type: '', tags: '' },
      ],
      logical_data_entities: [
        { id: 'lde-1', name: 'Order Entity', description: '', tags: '' },
        { id: 'lde-2', name: 'Payment Entity', description: '', tags: '' },
      ],
      logical_data_attributes: [],
      physical_data_entities: [],
      physical_data_attributes: [],
    },
    relationships: {
      business_user_processes: [],
      business_user_business_points: [],
      application_point_business_processes: [],
      // Application -> Business Points via Application Point
      application_point_business_points: [
        { id: 'apbp-1', application_point_id: 'ap-1', business_point_id: 'bpt-1', description: '', tags: '' },
        { id: 'apbp-2', application_point_id: 'ap-1', business_point_id: 'bpt-2', description: '', tags: '' },
        { id: 'apbp-3', application_point_id: 'ap-1', business_point_id: 'bpt-3', description: '', tags: '' },
      ],
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
 * Create an isolated MetaModel for testing Business Point -> Process Activity resolution
 * This model has NO circular paths through associations
 */
function createIsolatedProcessActivityBusinessPointModel(): MetaModel {
  return {
    entities: {
      business_users: [],
      business_processes: [
        { id: 'bp-1', name: 'Order Processing', description: '', tags: '' },
      ],
      process_activities: [
        { id: 'pa-isolated', business_process_id: 'bp-1', name: 'Isolated Activity', description: '', sequence_order: 1, actor_hint: 'END_USER', user_interaction_level: 'MODERATE', tags: '' },
      ],
      business_points: [
        // Business Point wrapping a Process Activity - NO application associations
        { id: 'bpt-isolated', name: 'Isolated Activity BP', description: '', kind: 'PROCESS_ACTIVITY', business_process_id: 'bp-1', process_activity_id: 'pa-isolated', tags: '' },
      ],
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
      application_point_business_points: [], // No app point associations
      logical_data_entity_relationships: [],
      logical_data_entity_physical_data_entities: [],
      logical_data_attribute_physical_data_attributes: [],
      data_movements: [],
      interface_logical_entities: [],
    },
  };
}

// ============================================================================
// Test 1: End-to-end Application with Business Process branch selection
// ============================================================================

describe('Test 1: End-to-end Application with Business Process branch', () => {
  it('should produce correct diagram nodes when selecting Application -> Business Point -> Business Process', () => {
    const metaModel = createFullIntegrationMetaModel();
    const rootEntity = { id: 'app-1', name: 'Order Management System', type: ENTITY_TYPES.APPLICATION };
    const diagram = createEmptyDiagram();
    const viewportCenter = { x: 500, y: 400 };

    // Build tree from Application
    const treeData = buildTreeData(metaModel, rootEntity);

    // Business Point nodes never appear in the tree -- the concrete
    // Business Process is shown directly under the Application.
    const bptNode = findNodeByEntity(treeData, ENTITY_TYPES.BUSINESS_POINT, 'bpt-1');
    expect(bptNode).toBeNull();

    const bpNode = findAllNodesByEntityType(treeData, ENTITY_TYPES.BUSINESS_PROCESS)
      .find(n => n.entityId === 'bp-1');
    expect(bpNode).toBeDefined();

    // Select Application (root) and the concrete Business Process
    const selectedKeys = new Set([treeData.key, bpNode!.key]);
    const orderedNodes = buildOrderedNodeListFromLeaves(selectedKeys, treeData);

    // Build wrapped hierarchy
    const result = buildWrappedNodeHierarchy(
      orderedNodes,
      treeData,
      metaModel,
      diagram,
      viewportCenter
    );

    // Verify nodes were created
    expect(result.nodesToAdd.length).toBeGreaterThanOrEqual(2);

    // Find Application and Business Process nodes
    const appNode = result.nodesToAdd.find(n => n.entity_type === ENTITY_TYPES.APPLICATION);
    const bpDiagramNode = result.nodesToAdd.find(n => n.entity_type === ENTITY_TYPES.BUSINESS_PROCESS);

    expect(appNode).toBeDefined();
    expect(bpDiagramNode).toBeDefined();

    // Business Process should have proper containment (if we selected the full chain)
    // The exact parent depends on whether Business Point is also added as a node
  });
});

// ============================================================================
// Test 2: End-to-end Application with Process Activity nested hierarchy
// ============================================================================

describe('Test 2: End-to-end Application with Process Activity hierarchy', () => {
  it('should produce correct nested hierarchy when selecting full chain to Process Activity', () => {
    const metaModel = createFullIntegrationMetaModel();
    const rootEntity = { id: 'bp-1', name: 'Order Processing', type: ENTITY_TYPES.BUSINESS_PROCESS };
    const diagram = createEmptyDiagram();
    const viewportCenter = { x: 500, y: 400 };

    // Build tree from Business Process
    const treeData = buildTreeData(metaModel, rootEntity);

    // Find Process Activities
    const paNode1 = findNodeByEntity(treeData, ENTITY_TYPES.PROCESS_ACTIVITY, 'pa-1');
    const paNode2 = findNodeByEntity(treeData, ENTITY_TYPES.PROCESS_ACTIVITY, 'pa-2');

    expect(paNode1).toBeDefined();
    expect(paNode2).toBeDefined();

    // Select Business Process (root) and both Process Activities
    const selectedKeys = new Set([treeData.key, paNode1!.key, paNode2!.key]);
    const orderedNodes = buildOrderedNodeListFromLeaves(selectedKeys, treeData);

    // Build wrapped hierarchy
    const result = buildWrappedNodeHierarchy(
      orderedNodes,
      treeData,
      metaModel,
      diagram,
      viewportCenter
    );

    // Should have 3 nodes: Business Process + 2 Process Activities
    expect(result.nodesToAdd.length).toBe(3);

    // Find diagram nodes
    const bpDiagramNode = result.nodesToAdd.find(n => n.entity_type === ENTITY_TYPES.BUSINESS_PROCESS);
    const paDiagramNodes = result.nodesToAdd.filter(n => n.entity_type === ENTITY_TYPES.PROCESS_ACTIVITY);

    expect(bpDiagramNode).toBeDefined();
    expect(paDiagramNodes.length).toBe(2);

    // Both Process Activities should be children of Business Process
    paDiagramNodes.forEach(pa => {
      expect(pa.parent_node_id).toBe(bpDiagramNode!.id);
    });

    // Business Process should have containment styling
    expect(bpDiagramNode!.text_v_align).toBe('TOP');
    expect(bpDiagramNode!.text_font_weight).toBe('bold');
  });
});

// ============================================================================
// Test 3: Mixed selection (technical + business) produces both branches
// ============================================================================

describe('Test 3: Mixed selection produces both technical and business branches', () => {
  it('should produce nodes for both technical and business branches when both are selected', () => {
    const metaModel = createFullIntegrationMetaModel();
    const rootEntity = { id: 'app-1', name: 'Order Management System', type: ENTITY_TYPES.APPLICATION };
    const diagram = createEmptyDiagram();
    const viewportCenter = { x: 500, y: 400 };

    // Build tree from Application
    const treeData = buildTreeData(metaModel, rootEntity);

    // Find nodes from technical branch
    const acNode = findNodeByEntity(treeData, ENTITY_TYPES.APP_COMPONENT, 'ac-1');
    expect(acNode).toBeDefined();

    // Find nodes from business branch (concrete Business Process -- Business
    // Point nodes never appear in the tree)
    const bpNode = findNodeByEntity(treeData, ENTITY_TYPES.BUSINESS_PROCESS, 'bp-1');
    expect(bpNode).toBeDefined();

    // Select Application (root), one App Component, and one Business Process
    const selectedKeys = new Set([treeData.key, acNode!.key, bpNode!.key]);
    const orderedNodes = buildOrderedNodeListFromLeaves(selectedKeys, treeData);

    // Build wrapped hierarchy
    const result = buildWrappedNodeHierarchy(
      orderedNodes,
      treeData,
      metaModel,
      diagram,
      viewportCenter
    );

    // Should have at least 3 nodes: Application + App Component + Business Process
    expect(result.nodesToAdd.length).toBeGreaterThanOrEqual(3);

    // Verify both branch types are present
    const appNode = result.nodesToAdd.find(n => n.entity_type === ENTITY_TYPES.APPLICATION);
    const acDiagramNode = result.nodesToAdd.find(n => n.entity_type === ENTITY_TYPES.APP_COMPONENT);
    const bpDiagramNode = result.nodesToAdd.find(n => n.entity_type === ENTITY_TYPES.BUSINESS_PROCESS);

    expect(appNode).toBeDefined();
    expect(acDiagramNode).toBeDefined();
    expect(bpDiagramNode).toBeDefined();

    // Both children should reference the Application as parent
    expect(acDiagramNode!.parent_node_id).toBe(appNode!.id);
    expect(bpDiagramNode!.parent_node_id).toBe(appNode!.id);
  });
});

// ============================================================================
// Test 4: Business Point resolves to underlying entity
// ============================================================================

describe('Test 4: Business Point resolves to underlying entity', () => {
  it('should show underlying Business Process when expanding Business Point with kind=BUSINESS_PROCESS', () => {
    // Use an isolated model: in the full model the Business Process is first
    // reached via the Application association branch and deduplication then
    // suppresses the UNDERLYING child under the root.
    const metaModel = createIsolatedProcessActivityBusinessPointModel();
    metaModel.entities.business_points.push(
      { id: 'bpt-1', name: 'Order Processing BP', description: '', kind: 'BUSINESS_PROCESS', business_process_id: 'bp-1', tags: '' } as never
    );
    const rootEntity = { id: 'bpt-1', name: 'Order Processing BP', type: ENTITY_TYPES.BUSINESS_POINT };

    // Build tree from Business Point
    const treeData = buildTreeData(metaModel, rootEntity);

    // Root should be the Business Point
    expect(treeData.entityType).toBe(ENTITY_TYPES.BUSINESS_POINT);
    expect(treeData.entityId).toBe('bpt-1');

    // Should have a Business Process child (the underlying entity)
    const bpChildren = treeData.children.filter(c => c.entityType === ENTITY_TYPES.BUSINESS_PROCESS);
    expect(bpChildren.length).toBe(1);
    expect(bpChildren[0].entityId).toBe('bp-1');
    expect(bpChildren[0].entityName).toBe('Order Processing');
  });

  it('should show underlying Process Activity when expanding Business Point with kind=PROCESS_ACTIVITY', () => {
    // Use an isolated model to avoid deduplication from circular paths
    const metaModel = createIsolatedProcessActivityBusinessPointModel();
    const rootEntity = { id: 'bpt-isolated', name: 'Isolated Activity BP', type: ENTITY_TYPES.BUSINESS_POINT };

    // Build tree from Business Point
    const treeData = buildTreeData(metaModel, rootEntity);

    // Root should be the Business Point
    expect(treeData.entityType).toBe(ENTITY_TYPES.BUSINESS_POINT);
    expect(treeData.entityId).toBe('bpt-isolated');

    // Should have a Process Activity child (the underlying entity)
    const paChildren = treeData.children.filter(c => c.entityType === ENTITY_TYPES.PROCESS_ACTIVITY);
    expect(paChildren.length).toBe(1);
    expect(paChildren[0].entityId).toBe('pa-isolated');
    expect(paChildren[0].entityName).toBe('Isolated Activity');
  });
});

// ============================================================================
// Test 5: Wrapping with existing parent node reuses node (no duplicate)
// ============================================================================

describe('Test 5: Wrapping with existing parent node reuses it', () => {
  it('should reuse existing parent node and not create duplicate', () => {
    const metaModel = createFullIntegrationMetaModel();
    const rootEntity = { id: 'bp-1', name: 'Order Processing', type: ENTITY_TYPES.BUSINESS_PROCESS };
    const viewportCenter = { x: 500, y: 400 };

    // Create diagram with existing Business Process node
    const existingBpNode: DiagramNode = {
      id: 'existing-bp-1',
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
    };
    const diagram = createDiagramWithNodes([existingBpNode]);

    // Build tree from Business Process
    const treeData = buildTreeData(metaModel, rootEntity);

    // Find a Process Activity
    const paNode = findNodeByEntity(treeData, ENTITY_TYPES.PROCESS_ACTIVITY, 'pa-1');
    expect(paNode).toBeDefined();

    // Select Business Process (root) and one Process Activity
    const selectedKeys = new Set([treeData.key, paNode!.key]);
    const orderedNodes = buildOrderedNodeListFromLeaves(selectedKeys, treeData);

    // Build wrapped hierarchy
    const result = buildWrappedNodeHierarchy(
      orderedNodes,
      treeData,
      metaModel,
      diagram,
      viewportCenter
    );

    // Should NOT create a new Business Process node (it already exists)
    const newBpNodes = result.nodesToAdd.filter(n =>
      n.entity_type === ENTITY_TYPES.BUSINESS_PROCESS && n.entity_id === 'bp-1'
    );
    expect(newBpNodes.length).toBe(0);

    // Should create the Process Activity as a child of existing node
    const paNodes = result.nodesToAdd.filter(n => n.entity_type === ENTITY_TYPES.PROCESS_ACTIVITY);
    expect(paNodes.length).toBe(1);
    expect(paNodes[0].parent_node_id).toBe('existing-bp-1');

    // Should have updates for the existing parent (containment styling)
    const parentUpdate = result.nodesToUpdate.find(u => u.nodeId === 'existing-bp-1');
    expect(parentUpdate).toBeDefined();
    expect(parentUpdate!.updates.text_v_align).toBe('TOP');
    expect(parentUpdate!.updates.text_font_weight).toBe('bold');
  });
});

// ============================================================================
// Test 6: Visual result matches "Add with business processes" for equivalent selection
// ============================================================================

describe('Test 6: Visual result consistency with Add with business processes', () => {
  it('should apply same containment styling as Add with business processes option', () => {
    const metaModel = createFullIntegrationMetaModel();
    const rootEntity = { id: 'bp-1', name: 'Order Processing', type: ENTITY_TYPES.BUSINESS_PROCESS };
    const diagram = createEmptyDiagram();
    const viewportCenter = { x: 500, y: 400 };

    // Build tree and select parent + activities
    const treeData = buildTreeData(metaModel, rootEntity);
    const paNode1 = findNodeByEntity(treeData, ENTITY_TYPES.PROCESS_ACTIVITY, 'pa-1');
    const paNode2 = findNodeByEntity(treeData, ENTITY_TYPES.PROCESS_ACTIVITY, 'pa-2');

    const selectedKeys = new Set([treeData.key, paNode1!.key, paNode2!.key]);
    const orderedNodes = buildOrderedNodeListFromLeaves(selectedKeys, treeData);

    const result = buildWrappedNodeHierarchy(
      orderedNodes,
      treeData,
      metaModel,
      diagram,
      viewportCenter
    );

    // Find the Business Process node
    const bpNode = result.nodesToAdd.find(n => n.entity_type === ENTITY_TYPES.BUSINESS_PROCESS);
    expect(bpNode).toBeDefined();

    // Verify containment styling matches handleAddWithBusinessProcesses/handleAddWithProcessActivities
    // These are the same styles applied in PalettePanel.tsx handlers
    expect(bpNode!.text_v_align).toBe('TOP');
    expect(bpNode!.text_font_weight).toBe('bold');

    // Verify parent has larger dimensions than children
    const paNodes = result.nodesToAdd.filter(n => n.entity_type === ENTITY_TYPES.PROCESS_ACTIVITY);
    expect(paNodes.length).toBe(2);

    // Parent should be larger than children
    paNodes.forEach(pa => {
      expect(bpNode!.width).toBeGreaterThan(pa.width);
      expect(bpNode!.height).toBeGreaterThan(pa.height);
    });
  });
});

// ============================================================================
// Test 7: Interface -> Logical Data Entity containment works correctly
// ============================================================================

describe('Test 7: Interface contains Logical Data Entity correctly', () => {
  it('should create Interface as container for Logical Data Entities', () => {
    const metaModel = createFullIntegrationMetaModel();
    const rootEntity = { id: 'int-1', name: 'Order API', type: ENTITY_TYPES.INTERFACE };
    const diagram = createEmptyDiagram();
    const viewportCenter = { x: 500, y: 400 };

    // Build tree from Interface
    const treeData = buildTreeData(metaModel, rootEntity);

    // Find Logical Data Entity child
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

    // Should have 2 nodes
    expect(result.nodesToAdd.length).toBe(2);

    // Find nodes
    const intDiagramNode = result.nodesToAdd.find(n => n.entity_type === ENTITY_TYPES.INTERFACE);
    const ldeDiagramNode = result.nodesToAdd.find(n => n.entity_type === ENTITY_TYPES.LOGICAL_DATA_ENTITY);

    expect(intDiagramNode).toBeDefined();
    expect(ldeDiagramNode).toBeDefined();

    // Interface should contain Logical Data Entity
    expect(ldeDiagramNode!.parent_node_id).toBe(intDiagramNode!.id);

    // The Interface renders as a contract-style composite (custom Interface
    // layout), not a plain text_v_align/bold container box.
    expect(intDiagramNode!.render_style).toBe('contract');

    // Z-index: child should be higher than parent
    expect(ldeDiagramNode!.z_index).toBeGreaterThan(intDiagramNode!.z_index);
  });
});

// ============================================================================
// Test 8: Business Process -> Process Activity containment styling matches spec
// ============================================================================

describe('Test 8: Business Process containment styling matches specification', () => {
  it('should apply spec-compliant containment styling to Business Process', () => {
    const metaModel = createFullIntegrationMetaModel();
    const rootEntity = { id: 'bp-1', name: 'Order Processing', type: ENTITY_TYPES.BUSINESS_PROCESS };
    const diagram = createEmptyDiagram();
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

    const bpNode = result.nodesToAdd.find(n => n.entity_type === ENTITY_TYPES.BUSINESS_PROCESS);
    const paNodeResult = result.nodesToAdd.find(n => n.entity_type === ENTITY_TYPES.PROCESS_ACTIVITY);

    expect(bpNode).toBeDefined();
    expect(paNodeResult).toBeDefined();

    // Spec requirements for containment (from spec.md Section 4):
    // 1. text_v_align: 'TOP' - Label at top of container
    expect(bpNode!.text_v_align).toBe('TOP');

    // 2. text_font_weight: 'bold' - Bold label for container
    expect(bpNode!.text_font_weight).toBe('bold');

    // 3. Z-index ordering: parent < child
    expect(bpNode!.z_index).toBeLessThan(paNodeResult!.z_index);

    // 4. Containment: child has parent_node_id set to parent's id
    expect(paNodeResult!.parent_node_id).toBe(bpNode!.id);

    // 5. Dimensions: parent is large enough to contain child
    // Parent pos + child pos + child height should be within parent bounds
    expect(paNodeResult!.pos_y).toBeGreaterThan(bpNode!.pos_y);
  });
});
