/**
 * Hierarchical Layout Integration Tests
 *
 * Task Group 2: Integration with PalettePanel
 * Tests for converting LayoutNode trees to DiagramNode arrays
 * and integrating with the existing PalettePanel workflow.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  convertTodiagramNodes,
  layoutAdvancedAddSelection,
} from '../utils/compoundLayout';
import { LayoutNode, LayoutTreeNode } from '../types/advancedAdd';
import { DiagramNode } from '../types/model';

// ============================================================================
// Mock Setup for Canvas Text Measurement
// ============================================================================

beforeAll(() => {
  // Mock canvas for text measurement
  const mockContext = {
    font: '',
    measureText: (text: string) => ({
      width: text.length * 7,
    }),
  };

  const mockCanvas = {
    getContext: () => mockContext,
  };

  const originalCreateElement = document.createElement.bind(document);
  document.createElement = ((tagName: string) => {
    if (tagName === 'canvas') {
      return mockCanvas as unknown as HTMLCanvasElement;
    }
    return originalCreateElement(tagName);
  }) as typeof document.createElement;
});

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Create a simple LayoutNode for testing
 */
function createTestLayoutNode(overrides: Partial<LayoutNode> = {}): LayoutNode {
  return {
    id: 'test-entity-1',
    type: 'APPLICATION',
    label: 'Test Application',
    x: 100,
    y: 100,
    width: 200,
    height: 150,
    children: [],
    ...overrides,
  };
}

/**
 * Find a DiagramNode by entity_id
 */
function findNodeByEntityId(nodes: DiagramNode[], entityId: string): DiagramNode | undefined {
  return nodes.find(n => n.entity_id === entityId);
}

// ============================================================================
// Test 1: convertTodiagramNodes() creates correct DiagramNode array
// ============================================================================

describe('convertTodiagramNodes() - Basic Conversion', () => {
  it('should create a DiagramNode for a single leaf node', () => {
    const layoutNode: LayoutNode = createTestLayoutNode({
      id: 'app-123',
      type: 'APPLICATION',
      label: 'My App',
      x: 50,
      y: 75,
      width: 160,
      height: 80,
      children: [],
    });

    const diagramNodes = convertTodiagramNodes(layoutNode, 0);

    expect(diagramNodes).toHaveLength(1);

    const node = diagramNodes[0];
    expect(node.entity_type).toBe('APPLICATION');
    expect(node.entity_id).toBe('app-123');
    expect(node.pos_x).toBe(50);
    expect(node.pos_y).toBe(75);
    expect(node.width).toBe(160);
    expect(node.height).toBe(80);
    expect(node.auto_size).toBe(false);
    expect(node.parent_node_id).toBeNull();
    expect(node.id).toMatch(/^node-/); // Generated ID with 'node' prefix
  });

  it('should create DiagramNodes for a parent with multiple children', () => {
    const layoutNode: LayoutNode = {
      id: 'app-1',
      type: 'APPLICATION',
      label: 'Application',
      x: 0,
      y: 0,
      width: 200,
      height: 300,
      children: [
        {
          id: 'comp-1',
          type: 'APP_COMPONENT',
          label: 'Component 1',
          x: 20,
          y: 40,
          width: 160,
          height: 60,
          children: [],
        },
        {
          id: 'comp-2',
          type: 'APP_COMPONENT',
          label: 'Component 2',
          x: 20,
          y: 110,
          width: 160,
          height: 60,
          children: [],
        },
      ],
    };

    const diagramNodes = convertTodiagramNodes(layoutNode, 0);

    expect(diagramNodes).toHaveLength(3);

    // Verify all nodes are created with correct entity types
    const appNode = findNodeByEntityId(diagramNodes, 'app-1');
    const comp1Node = findNodeByEntityId(diagramNodes, 'comp-1');
    const comp2Node = findNodeByEntityId(diagramNodes, 'comp-2');

    expect(appNode).toBeDefined();
    expect(comp1Node).toBeDefined();
    expect(comp2Node).toBeDefined();

    expect(appNode!.entity_type).toBe('APPLICATION');
    expect(comp1Node!.entity_type).toBe('APP_COMPONENT');
    expect(comp2Node!.entity_type).toBe('APP_COMPONENT');
  });
});

// ============================================================================
// Test 2: parent_node_id is correctly set for all children
// ============================================================================

describe('convertTodiagramNodes() - Parent Node ID', () => {
  it('should set parent_node_id correctly for direct children', () => {
    const layoutNode: LayoutNode = {
      id: 'app-1',
      type: 'APPLICATION',
      label: 'Application',
      x: 0,
      y: 0,
      width: 200,
      height: 200,
      children: [
        {
          id: 'comp-1',
          type: 'APP_COMPONENT',
          label: 'Component',
          x: 20,
          y: 40,
          width: 160,
          height: 60,
          children: [],
        },
      ],
    };

    const diagramNodes = convertTodiagramNodes(layoutNode, 0);

    const appNode = findNodeByEntityId(diagramNodes, 'app-1')!;
    const compNode = findNodeByEntityId(diagramNodes, 'comp-1')!;

    // Root has no parent
    expect(appNode.parent_node_id).toBeNull();

    // Child references parent's diagram node ID
    expect(compNode.parent_node_id).toBe(appNode.id);
  });

  it('should set parent_node_id correctly for deeply nested hierarchy', () => {
    const layoutNode: LayoutNode = {
      id: 'app-1',
      type: 'APPLICATION',
      label: 'Application',
      x: 0,
      y: 0,
      width: 300,
      height: 400,
      children: [
        {
          id: 'comp-1',
          type: 'APP_COMPONENT',
          label: 'Component',
          x: 20,
          y: 40,
          width: 260,
          height: 300,
          children: [
            {
              id: 'svc-1',
              type: 'SERVICE',
              label: 'Service',
              x: 40,
              y: 80,
              width: 220,
              height: 200,
              children: [
                {
                  id: 'int-1',
                  type: 'INTERFACE',
                  label: 'Interface',
                  x: 60,
                  y: 120,
                  width: 180,
                  height: 60,
                  children: [],
                },
              ],
            },
          ],
        },
      ],
    };

    const diagramNodes = convertTodiagramNodes(layoutNode, 0);

    expect(diagramNodes).toHaveLength(4);

    const appNode = findNodeByEntityId(diagramNodes, 'app-1')!;
    const compNode = findNodeByEntityId(diagramNodes, 'comp-1')!;
    const svcNode = findNodeByEntityId(diagramNodes, 'svc-1')!;
    const intNode = findNodeByEntityId(diagramNodes, 'int-1')!;

    // Verify parent chain
    expect(appNode.parent_node_id).toBeNull();
    expect(compNode.parent_node_id).toBe(appNode.id);
    expect(svcNode.parent_node_id).toBe(compNode.id);
    expect(intNode.parent_node_id).toBe(svcNode.id);
  });
});

// ============================================================================
// Test 3: z_index ordering (parents have lower z_index than children)
// ============================================================================

describe('convertTodiagramNodes() - Z-Index Ordering', () => {
  it('should assign incrementing z_index with parents having lower values than children', () => {
    const layoutNode: LayoutNode = {
      id: 'app-1',
      type: 'APPLICATION',
      label: 'Application',
      x: 0,
      y: 0,
      width: 200,
      height: 200,
      children: [
        {
          id: 'comp-1',
          type: 'APP_COMPONENT',
          label: 'Component',
          x: 20,
          y: 40,
          width: 160,
          height: 100,
          children: [
            {
              id: 'svc-1',
              type: 'SERVICE',
              label: 'Service',
              x: 40,
              y: 80,
              width: 120,
              height: 40,
              children: [],
            },
          ],
        },
      ],
    };

    const diagramNodes = convertTodiagramNodes(layoutNode, 10);

    const appNode = findNodeByEntityId(diagramNodes, 'app-1')!;
    const compNode = findNodeByEntityId(diagramNodes, 'comp-1')!;
    const svcNode = findNodeByEntityId(diagramNodes, 'svc-1')!;

    // Parent z_index should be lower than children
    expect(appNode.z_index).toBeLessThan(compNode.z_index!);
    expect(compNode.z_index).toBeLessThan(svcNode.z_index!);

    // First node should be at least zIndexBase + 1
    expect(appNode.z_index).toBeGreaterThanOrEqual(11);
  });

  it('should maintain z_index ordering for multiple siblings', () => {
    const layoutNode: LayoutNode = {
      id: 'app-1',
      type: 'APPLICATION',
      label: 'Application',
      x: 0,
      y: 0,
      width: 200,
      height: 300,
      children: [
        {
          id: 'comp-1',
          type: 'APP_COMPONENT',
          label: 'Component 1',
          x: 20,
          y: 40,
          width: 160,
          height: 60,
          children: [],
        },
        {
          id: 'comp-2',
          type: 'APP_COMPONENT',
          label: 'Component 2',
          x: 20,
          y: 110,
          width: 160,
          height: 60,
          children: [],
        },
        {
          id: 'comp-3',
          type: 'APP_COMPONENT',
          label: 'Component 3',
          x: 20,
          y: 180,
          width: 160,
          height: 60,
          children: [],
        },
      ],
    };

    const diagramNodes = convertTodiagramNodes(layoutNode, 5);

    const appNode = findNodeByEntityId(diagramNodes, 'app-1')!;
    const comp1Node = findNodeByEntityId(diagramNodes, 'comp-1')!;
    const comp2Node = findNodeByEntityId(diagramNodes, 'comp-2')!;
    const comp3Node = findNodeByEntityId(diagramNodes, 'comp-3')!;

    // Parent should be below all children
    expect(appNode.z_index).toBeLessThan(comp1Node.z_index!);
    expect(appNode.z_index).toBeLessThan(comp2Node.z_index!);
    expect(appNode.z_index).toBeLessThan(comp3Node.z_index!);
  });
});

// ============================================================================
// Test 4: Container styling (text_v_align='TOP', text_font_weight='bold')
// ============================================================================

describe('convertTodiagramNodes() - Container Styling', () => {
  it('should apply container styling to nodes with children', () => {
    const layoutNode: LayoutNode = {
      id: 'app-1',
      type: 'APPLICATION',
      label: 'Application',
      x: 0,
      y: 0,
      width: 200,
      height: 200,
      children: [
        {
          id: 'comp-1',
          type: 'APP_COMPONENT',
          label: 'Component',
          x: 20,
          y: 40,
          width: 160,
          height: 60,
          children: [],
        },
      ],
    };

    const diagramNodes = convertTodiagramNodes(layoutNode, 0);

    const appNode = findNodeByEntityId(diagramNodes, 'app-1')!;
    const compNode = findNodeByEntityId(diagramNodes, 'comp-1')!;

    // Container (has children) should have styling
    expect(appNode.text_v_align).toBe('TOP');
    expect(appNode.text_font_weight).toBe('bold');

    // Leaf (no children) should NOT have container styling
    expect(compNode.text_v_align).toBeUndefined();
    expect(compNode.text_font_weight).toBeUndefined();
  });

  it('should apply container styling at all levels of nesting', () => {
    const layoutNode: LayoutNode = {
      id: 'app-1',
      type: 'APPLICATION',
      label: 'Application',
      x: 0,
      y: 0,
      width: 300,
      height: 400,
      children: [
        {
          id: 'comp-1',
          type: 'APP_COMPONENT',
          label: 'Component',
          x: 20,
          y: 40,
          width: 260,
          height: 300,
          children: [
            {
              id: 'svc-1',
              type: 'SERVICE',
              label: 'Service',
              x: 40,
              y: 80,
              width: 220,
              height: 200,
              children: [
                {
                  id: 'int-1',
                  type: 'INTERFACE',
                  label: 'Interface (leaf)',
                  x: 60,
                  y: 120,
                  width: 180,
                  height: 60,
                  children: [],
                },
              ],
            },
          ],
        },
      ],
    };

    const diagramNodes = convertTodiagramNodes(layoutNode, 0);

    const appNode = findNodeByEntityId(diagramNodes, 'app-1')!;
    const compNode = findNodeByEntityId(diagramNodes, 'comp-1')!;
    const svcNode = findNodeByEntityId(diagramNodes, 'svc-1')!;
    const intNode = findNodeByEntityId(diagramNodes, 'int-1')!;

    // All containers should have styling
    expect(appNode.text_v_align).toBe('TOP');
    expect(appNode.text_font_weight).toBe('bold');

    expect(compNode.text_v_align).toBe('TOP');
    expect(compNode.text_font_weight).toBe('bold');

    expect(svcNode.text_v_align).toBe('TOP');
    expect(svcNode.text_font_weight).toBe('bold');

    // Only the leaf should NOT have container styling
    expect(intNode.text_v_align).toBeUndefined();
    expect(intNode.text_font_weight).toBeUndefined();
  });
});

// ============================================================================
// Test 5: End-to-end integration with layoutAdvancedAddSelection
// ============================================================================

describe('End-to-End Integration', () => {
  it('should produce correct DiagramNodes from a LayoutTreeNode through full pipeline', () => {
    // Input tree structure
    const tree: LayoutTreeNode = {
      id: 'app-1',
      type: 'APPLICATION',
      label: 'My Application',
      children: [
        {
          id: 'comp-1',
          type: 'APP_COMPONENT',
          label: 'Component 1',
          children: [],
        },
        {
          id: 'bp-1',
          type: 'BUSINESS_PROCESS',
          label: 'Order Process',
          children: [
            {
              id: 'pa-1',
              type: 'PROCESS_ACTIVITY',
              label: 'Validate Order',
              children: [],
            },
          ],
        },
      ],
    };

    // Run layout algorithm
    const layoutRoot = layoutAdvancedAddSelection(tree, { x: 500, y: 400 });

    // Convert to diagram nodes
    const diagramNodes = convertTodiagramNodes(layoutRoot, 0);

    // Verify correct number of nodes
    expect(diagramNodes).toHaveLength(4);

    // Verify all entities are represented
    const appNode = findNodeByEntityId(diagramNodes, 'app-1')!;
    const compNode = findNodeByEntityId(diagramNodes, 'comp-1')!;
    const bpNode = findNodeByEntityId(diagramNodes, 'bp-1')!;
    const paNode = findNodeByEntityId(diagramNodes, 'pa-1')!;

    expect(appNode).toBeDefined();
    expect(compNode).toBeDefined();
    expect(bpNode).toBeDefined();
    expect(paNode).toBeDefined();

    // Verify parent relationships
    expect(appNode.parent_node_id).toBeNull();
    expect(compNode.parent_node_id).toBe(appNode.id);
    expect(bpNode.parent_node_id).toBe(appNode.id);
    expect(paNode.parent_node_id).toBe(bpNode.id);

    // Verify z_index ordering
    expect(appNode.z_index).toBeLessThan(compNode.z_index!);
    expect(appNode.z_index).toBeLessThan(bpNode.z_index!);
    expect(bpNode.z_index).toBeLessThan(paNode.z_index!);

    // Verify container styling
    expect(appNode.text_v_align).toBe('TOP');
    expect(appNode.text_font_weight).toBe('bold');
    expect(bpNode.text_v_align).toBe('TOP');
    expect(bpNode.text_font_weight).toBe('bold');

    // Leaves should not have container styling
    expect(compNode.text_v_align).toBeUndefined();
    expect(paNode.text_v_align).toBeUndefined();
  });
});
