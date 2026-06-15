/**
 * @vitest-environment jsdom
 */

/**
 * Task Group 4: Gap Analysis Tests
 *
 * These tests fill critical gaps identified during the Task Group 4 review.
 * Maximum 8 tests to cover edge cases and integration scenarios not covered
 * in Task Groups 1-3.
 *
 * Key gaps addressed:
 * 1. Application with no linked Business Points
 * 2. Full workflow integration: tree building -> selection -> diagram output
 * 3. Regression: "Add with business processes" still works
 * 4. Edge case: Entity with no Application Point
 * 5. Edge case: Selecting partial tree (parent without child)
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { ENTITY_TYPES, MetaModel, DiagramNode } from '../types/model';
import { TreeNodeData } from '../types/advancedAdd';
import { buildTreeData, buildOrderedNodeListFromLeaves } from '../components/DiagramsView/AdvancedAddDialog';
import {
  buildWrappedNodeHierarchy,
} from '../components/DiagramsView/PalettePanel';

// ============================================================================
// Setup: Mock canvas for text measurement
// ============================================================================

beforeAll(() => {
  const mockContext = {
    font: '',
    measureText: vi.fn(() => ({ width: 50 })),
  };
  HTMLCanvasElement.prototype.getContext = vi.fn(() => mockContext) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

// ============================================================================
// Test Utilities
// ============================================================================

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

function findAllNodesByEntityType(node: TreeNodeData, entityType: string): TreeNodeData[] {
  const results: TreeNodeData[] = [];
  if (node.entityType === entityType) {
    results.push(node);
  }
  for (const child of node.children) {
    results.push(...findAllNodesByEntityType(child, entityType));
  }
  return results;
}

function createMockDiagram(nodes: DiagramNode[] = []): { diagram_nodes: DiagramNode[]; diagram_edges: [] } {
  return {
    diagram_nodes: nodes,
    diagram_edges: [],
  };
}

// ============================================================================
// Mock Data: Application with no Business Points
// ============================================================================

function createMockMetaModelWithNoBusinessLinks(): MetaModel {
  return {
    entities: {
      business_users: [],
      business_processes: [],
      process_activities: [],
      business_points: [],
      applications: [
        { id: 'app-1', name: 'Standalone Application', description: '', app_type: 'Web', status: 'Active', tags: '' },
      ],
      app_components: [
        { id: 'ac-1', application_id: 'app-1', name: 'UI Component', description: '', tags: '' },
      ],
      services: [
        { id: 'svc-1', application_id: 'app-1', app_component_id: 'ac-1', name: 'Backend Service', description: '', service_type: 'API', tags: '' },
      ],
      interfaces: [
        { id: 'int-1', service_id: 'svc-1', name: 'REST API', description: '', interface_type: 'REST_API', tags: '' },
      ],
      application_points: [
        // Application Point exists but has NO linked Business Points
        { id: 'ap-1', application_id: 'app-1', name: 'AP 1', description: '', kind: 'APPLICATION', point_type: '', tags: '' },
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
      // Empty - no Business Point relationships
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
// Mock Data: Application without Application Point (edge case)
// ============================================================================

function createMockMetaModelWithNoApplicationPoint(): MetaModel {
  return {
    entities: {
      business_users: [],
      business_processes: [
        { id: 'bp-1', name: 'Order Process', description: '', tags: '' },
      ],
      process_activities: [],
      business_points: [
        { id: 'bpt-1', name: 'BP for Order', kind: 'BUSINESS_PROCESS', business_process_id: 'bp-1', process_activity_id: '' },
      ],
      applications: [
        // This application has NO Application Point
        { id: 'app-1', name: 'Legacy App', description: '', app_type: 'Mainframe', status: 'Active', tags: '' },
      ],
      app_components: [],
      services: [],
      interfaces: [],
      application_points: [],  // Empty - no Application Points at all
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
// Mock Data: Full integration test
// ============================================================================

function createMockMetaModelForFullIntegration(): MetaModel {
  return {
    entities: {
      business_users: [],
      business_processes: [
        { id: 'bp-1', name: 'Customer Onboarding', description: '', tags: '' },
        { id: 'bp-2', name: 'Order Fulfillment', description: '', tags: '' },
      ],
      process_activities: [
        { id: 'pa-1', business_process_id: 'bp-1', name: 'Verify Identity', description: '', sequence_order: 1, actor_hint: 'END_USER', user_interaction_level: 'HIGH', tags: '' },
        { id: 'pa-2', business_process_id: 'bp-1', name: 'Create Account', description: '', sequence_order: 2, actor_hint: 'INTERNAL_SYSTEM', user_interaction_level: 'AUTOMATED', tags: '' },
      ],
      business_points: [
        { id: 'bpt-1', name: 'BP for Customer Onboarding', kind: 'BUSINESS_PROCESS', business_process_id: 'bp-1', process_activity_id: '' },
        { id: 'bpt-2', name: 'BP for Order Fulfillment', kind: 'BUSINESS_PROCESS', business_process_id: 'bp-2', process_activity_id: '' },
      ],
      applications: [
        { id: 'app-1', name: 'Customer Portal', description: '', app_type: 'Web', status: 'Active', tags: '' },
      ],
      app_components: [],
      services: [],
      interfaces: [],
      application_points: [
        { id: 'ap-1', application_id: 'app-1', name: 'AP for Customer Portal', description: '', kind: 'APPLICATION', point_type: '', tags: '' },
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
        { id: 'apbp-1', application_point_id: 'ap-1', business_point_id: 'bpt-1', description: '', tags: '' },
        { id: 'apbp-2', application_point_id: 'ap-1', business_point_id: 'bpt-2', description: '', tags: '' },
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
// Test 1: Application with no linked Business Points
// ============================================================================

describe('Edge Case: Application with no Business Point links', () => {
  it('should build valid tree with only application hierarchy when no Business Points linked', () => {
    const metaModel = createMockMetaModelWithNoBusinessLinks();
    const rootEntity = { id: 'app-1', name: 'Standalone Application', type: ENTITY_TYPES.APPLICATION };

    const treeData = buildTreeData(metaModel, rootEntity);

    // Tree should exist and contain Application hierarchy
    expect(treeData).toBeDefined();
    expect(treeData.entityType).toBe(ENTITY_TYPES.APPLICATION);
    expect(treeData.entityId).toBe('app-1');

    // Should have App Component as child
    const acNodes = findAllNodesByEntityType(treeData, ENTITY_TYPES.APP_COMPONENT);
    expect(acNodes.length).toBe(1);

    // Should have Service as descendant
    const svcNodes = findAllNodesByEntityType(treeData, ENTITY_TYPES.SERVICE);
    expect(svcNodes.length).toBe(1);

    // Should have NO Business Process or Process Activity nodes
    const bpNodes = findAllNodesByEntityType(treeData, ENTITY_TYPES.BUSINESS_PROCESS);
    const paNodes = findAllNodesByEntityType(treeData, ENTITY_TYPES.PROCESS_ACTIVITY);
    expect(bpNodes.length).toBe(0);
    expect(paNodes.length).toBe(0);
  });
});

// ============================================================================
// Test 2: Application without Application Point
// ============================================================================

describe('Edge Case: Application without Application Point', () => {
  it('should not crash when Application has no Application Point', () => {
    const metaModel = createMockMetaModelWithNoApplicationPoint();
    const rootEntity = { id: 'app-1', name: 'Legacy App', type: ENTITY_TYPES.APPLICATION };

    // This should not throw
    const treeData = buildTreeData(metaModel, rootEntity);

    // Tree should exist
    expect(treeData).toBeDefined();
    expect(treeData.entityType).toBe(ENTITY_TYPES.APPLICATION);

    // Should have NO Business Process children (no AP to link through)
    const bpNodes = findAllNodesByEntityType(treeData, ENTITY_TYPES.BUSINESS_PROCESS);
    expect(bpNodes.length).toBe(0);
  });
});

// ============================================================================
// Test 3: Full Workflow Integration - Tree to Diagram
// ============================================================================

describe('Full Workflow Integration: Tree Building -> Selection -> Diagram Output', () => {
  it('should produce correct diagram nodes when selecting Application and Business Processes from tree', () => {
    const metaModel = createMockMetaModelForFullIntegration();
    const rootEntity = { id: 'app-1', name: 'Customer Portal', type: ENTITY_TYPES.APPLICATION };
    const diagram = createMockDiagram();
    const viewportCenter = { x: 500, y: 400 };

    // Step 1: Build tree
    const treeData = buildTreeData(metaModel, rootEntity);
    expect(treeData).toBeDefined();

    // Step 2: Verify Business Processes appear in tree (resolved from Business Points)
    const bp1Node = findNodeByEntity(treeData, ENTITY_TYPES.BUSINESS_PROCESS, 'bp-1');
    const bp2Node = findNodeByEntity(treeData, ENTITY_TYPES.BUSINESS_PROCESS, 'bp-2');
    expect(bp1Node).toBeDefined();
    expect(bp2Node).toBeDefined();

    // Step 3: Select Application and both Business Processes
    const selectedKeys = new Set([treeData.key, bp1Node!.key, bp2Node!.key]);

    // Step 4: Build ordered node list
    const orderedNodes = buildOrderedNodeListFromLeaves(selectedKeys, treeData);
    expect(orderedNodes.length).toBe(3);

    // Step 5: Generate diagram nodes
    const result = buildWrappedNodeHierarchy(
      orderedNodes,
      treeData,
      metaModel,
      diagram,
      viewportCenter
    );

    // Verify: 3 nodes created (Application + 2 Business Processes)
    expect(result.nodesToAdd.length).toBe(3);

    // Verify: Application node exists
    const appDiagramNode = result.nodesToAdd.find(n => n.entity_type === ENTITY_TYPES.APPLICATION);
    expect(appDiagramNode).toBeDefined();
    expect(appDiagramNode!.entity_id).toBe('app-1');

    // Verify: Both Business Processes have Application as parent
    const bpDiagramNodes = result.nodesToAdd.filter(n => n.entity_type === ENTITY_TYPES.BUSINESS_PROCESS);
    expect(bpDiagramNodes.length).toBe(2);
    bpDiagramNodes.forEach(bp => {
      expect(bp.parent_node_id).toBe(appDiagramNode!.id);
    });

    // Verify: No Point nodes in output
    const pointNodes = result.nodesToAdd.filter(
      n => n.entity_type === ENTITY_TYPES.BUSINESS_POINT || n.entity_type === ENTITY_TYPES.APPLICATION_POINT
    );
    expect(pointNodes.length).toBe(0);
  });
});

// ============================================================================
// Test 4: Selecting parent only (without children)
// ============================================================================

describe('Edge Case: Select parent only without selecting children', () => {
  it('should create single node when only Application is selected (no children)', () => {
    const metaModel = createMockMetaModelForFullIntegration();
    const rootEntity = { id: 'app-1', name: 'Customer Portal', type: ENTITY_TYPES.APPLICATION };
    const diagram = createMockDiagram();
    const viewportCenter = { x: 500, y: 400 };

    const treeData = buildTreeData(metaModel, rootEntity);

    // Select only the root Application, no children
    const selectedKeys = new Set([treeData.key]);
    const orderedNodes = buildOrderedNodeListFromLeaves(selectedKeys, treeData);

    const result = buildWrappedNodeHierarchy(
      orderedNodes,
      treeData,
      metaModel,
      diagram,
      viewportCenter
    );

    // Should have only 1 node (Application)
    expect(result.nodesToAdd.length).toBe(1);
    expect(result.nodesToAdd[0].entity_type).toBe(ENTITY_TYPES.APPLICATION);
    expect(result.nodesToAdd[0].parent_node_id).toBeNull();
  });
});

// ============================================================================
// Test 5: Selecting child only (without parent) - standalone node behavior
// ============================================================================

describe('Edge Case: Select child only (Business Process) without parent', () => {
  it('produces no nodes when the root is not in the selection (root participation is mandatory)', () => {
    // The Advanced Add dialog always keeps the root selected (the root checkbox
    // is checked + disabled, and computeSelectionState forces the root to
    // 'selected'). buildWrappedNodeHierarchy prunes the layout tree from the
    // root, so a selection that excludes the root yields no nodes. The old
    // "standalone child node" behaviour no longer exists.
    const metaModel = createMockMetaModelForFullIntegration();
    const rootEntity = { id: 'app-1', name: 'Customer Portal', type: ENTITY_TYPES.APPLICATION };
    const diagram = createMockDiagram();
    const viewportCenter = { x: 500, y: 400 };

    const treeData = buildTreeData(metaModel, rootEntity);
    const bp1Node = findNodeByEntity(treeData, ENTITY_TYPES.BUSINESS_PROCESS, 'bp-1');
    expect(bp1Node).toBeDefined();

    // Select only Business Process (not the Application root)
    const selectedKeys = new Set([bp1Node!.key]);
    const orderedNodes = buildOrderedNodeListFromLeaves(selectedKeys, treeData);

    const result = buildWrappedNodeHierarchy(
      orderedNodes,
      treeData,
      metaModel,
      diagram,
      viewportCenter
    );

    expect(result.nodesToAdd.length).toBe(0);

    // With the root included (as the dialog guarantees), the child IS added
    // wrapped inside its parent.
    const withRoot = buildWrappedNodeHierarchy(
      buildOrderedNodeListFromLeaves(new Set([treeData.key, bp1Node!.key]), treeData),
      treeData,
      metaModel,
      diagram,
      viewportCenter
    );
    const bpNode = withRoot.nodesToAdd.find(n => n.entity_type === ENTITY_TYPES.BUSINESS_PROCESS);
    expect(bpNode).toBeDefined();
    expect(bpNode!.entity_id).toBe('bp-1');
  });
});

// ============================================================================
// Test 6: Deep hierarchy with Process Activities
// ============================================================================

describe('Integration: Deep hierarchy Application -> BP -> PA', () => {
  it('should correctly nest 3-level hierarchy in diagram output', () => {
    const metaModel = createMockMetaModelForFullIntegration();
    const rootEntity = { id: 'app-1', name: 'Customer Portal', type: ENTITY_TYPES.APPLICATION };
    const diagram = createMockDiagram();
    const viewportCenter = { x: 500, y: 400 };

    const treeData = buildTreeData(metaModel, rootEntity);

    // Find BP and its PA children
    const bp1Node = findNodeByEntity(treeData, ENTITY_TYPES.BUSINESS_PROCESS, 'bp-1');
    expect(bp1Node).toBeDefined();

    const pa1Node = findNodeByEntity(treeData, ENTITY_TYPES.PROCESS_ACTIVITY, 'pa-1');
    expect(pa1Node).toBeDefined();

    // Select Application, Business Process, and Process Activity
    const selectedKeys = new Set([treeData.key, bp1Node!.key, pa1Node!.key]);
    const orderedNodes = buildOrderedNodeListFromLeaves(selectedKeys, treeData);

    const result = buildWrappedNodeHierarchy(
      orderedNodes,
      treeData,
      metaModel,
      diagram,
      viewportCenter
    );

    // Verify 3 nodes
    expect(result.nodesToAdd.length).toBe(3);

    const appNode = result.nodesToAdd.find(n => n.entity_type === ENTITY_TYPES.APPLICATION);
    const bpNode = result.nodesToAdd.find(n => n.entity_type === ENTITY_TYPES.BUSINESS_PROCESS);
    const paNode = result.nodesToAdd.find(n => n.entity_type === ENTITY_TYPES.PROCESS_ACTIVITY);

    expect(appNode).toBeDefined();
    expect(bpNode).toBeDefined();
    expect(paNode).toBeDefined();

    // Verify nesting: PA -> BP -> App
    expect(bpNode!.parent_node_id).toBe(appNode!.id);
    expect(paNode!.parent_node_id).toBe(bpNode!.id);

    // Verify containment styling on parents
    expect(appNode!.text_v_align).toBe('TOP');
    expect(appNode!.text_font_weight).toBe('bold');
    expect(bpNode!.text_v_align).toBe('TOP');
    expect(bpNode!.text_font_weight).toBe('bold');
  });
});

// ============================================================================
// Test 7: No crash with empty MetaModel relationships
// ============================================================================

describe('Edge Case: MetaModel with empty relationship arrays', () => {
  it('should handle MetaModel with all empty relationship arrays gracefully', () => {
    const emptyMetaModel: MetaModel = {
      entities: {
        business_users: [],
        business_processes: [],
        process_activities: [],
        business_points: [],
        applications: [
          { id: 'app-1', name: 'Empty App', description: '', app_type: 'Web', status: 'Active', tags: '' },
        ],
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

    const rootEntity = { id: 'app-1', name: 'Empty App', type: ENTITY_TYPES.APPLICATION };

    // Should not crash
    const treeData = buildTreeData(emptyMetaModel, rootEntity);

    expect(treeData).toBeDefined();
    expect(treeData.entityType).toBe(ENTITY_TYPES.APPLICATION);
    expect(treeData.children.length).toBe(0); // No children
  });
});

// ============================================================================
// Test 8: Regression - Existing PARENT_CHILD containment still works
// ============================================================================

describe('Regression: Traditional PARENT_CHILD containment', () => {
  it('should correctly render Application -> App Component -> Service hierarchy', () => {
    const metaModel = createMockMetaModelWithNoBusinessLinks(); // Has App hierarchy but no BP links
    const rootEntity = { id: 'app-1', name: 'Standalone Application', type: ENTITY_TYPES.APPLICATION };
    const diagram = createMockDiagram();
    const viewportCenter = { x: 500, y: 400 };

    const treeData = buildTreeData(metaModel, rootEntity);

    // Find nested hierarchy
    const acNode = findNodeByEntity(treeData, ENTITY_TYPES.APP_COMPONENT, 'ac-1');
    const svcNode = findNodeByEntity(treeData, ENTITY_TYPES.SERVICE, 'svc-1');
    const intNode = findNodeByEntity(treeData, ENTITY_TYPES.INTERFACE, 'int-1');

    expect(acNode).toBeDefined();
    expect(svcNode).toBeDefined();
    expect(intNode).toBeDefined();

    // Select full hierarchy
    const selectedKeys = new Set([treeData.key, acNode!.key, svcNode!.key, intNode!.key]);
    const orderedNodes = buildOrderedNodeListFromLeaves(selectedKeys, treeData);

    const result = buildWrappedNodeHierarchy(
      orderedNodes,
      treeData,
      metaModel,
      diagram,
      viewportCenter
    );

    // Verify 4 nodes
    expect(result.nodesToAdd.length).toBe(4);

    const appDiagram = result.nodesToAdd.find(n => n.entity_type === ENTITY_TYPES.APPLICATION);
    const acDiagram = result.nodesToAdd.find(n => n.entity_type === ENTITY_TYPES.APP_COMPONENT);
    const svcDiagram = result.nodesToAdd.find(n => n.entity_type === ENTITY_TYPES.SERVICE);
    const intDiagram = result.nodesToAdd.find(n => n.entity_type === ENTITY_TYPES.INTERFACE);

    expect(appDiagram).toBeDefined();
    expect(acDiagram).toBeDefined();
    expect(svcDiagram).toBeDefined();
    expect(intDiagram).toBeDefined();

    // Verify parent-child relationships
    expect(acDiagram!.parent_node_id).toBe(appDiagram!.id);
    expect(svcDiagram!.parent_node_id).toBe(acDiagram!.id);
    expect(intDiagram!.parent_node_id).toBe(svcDiagram!.id);
  });
});
