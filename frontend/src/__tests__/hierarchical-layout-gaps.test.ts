/**
 * Hierarchical Layout Gap Tests
 *
 * Task Group 4: Test Review and Gap Analysis
 * Additional strategic tests to fill critical coverage gaps.
 * Maximum 8 tests as specified in the task requirements.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  measure,
  assignPositions,
  layoutAdvancedAddSelection,
  convertTodiagramNodes,
  LAYOUT_MIN_NODE_WIDTH,
  LAYOUT_MIN_NODE_HEIGHT,
} from '../utils/compoundLayout';
import { LayoutTreeNode, LayoutNode, SPACING_PRESETS } from '../types/advancedAdd';

// The layout defaults to the 'normal' spacing preset (paddingX/paddingY = 10,
// childVerticalGap = 7); leaf heights are exact (labelHeight + 2 * paddingY).
const NORMAL_PADDING_X = SPACING_PRESETS.normal.paddingX;
const NORMAL_PADDING_Y = SPACING_PRESETS.normal.paddingY;
const NORMAL_CHILD_GAP = SPACING_PRESETS.normal.childVerticalGap;
const MIN_LEAF_HEIGHT = 12 + 2 * NORMAL_PADDING_Y; // single-line label + padding
import { DiagramNode } from '../types/model';

// ============================================================================
// Mock Setup for Canvas Text Measurement
// ============================================================================

const MOCK_CHAR_WIDTH = 7;

beforeAll(() => {
  const mockContext = {
    font: '',
    measureText: (text: string) => ({
      width: text.length * MOCK_CHAR_WIDTH,
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
 * Check if two rectangles overlap (strictly, not just touching)
 */
function rectanglesOverlap(
  r1: { x: number; y: number; width: number; height: number },
  r2: { x: number; y: number; width: number; height: number }
): boolean {
  if (r1.x + r1.width <= r2.x || r2.x + r2.width <= r1.x) {
    return false;
  }
  if (r1.y + r1.height <= r2.y || r2.y + r2.height <= r1.y) {
    return false;
  }
  return true;
}

/**
 * Collect all nodes from a layout tree (flattened)
 */
function collectAllNodes(node: LayoutNode): LayoutNode[] {
  const result: LayoutNode[] = [node];
  for (const child of node.children) {
    result.push(...collectAllNodes(child));
  }
  return result;
}

/**
 * Check if a child node is fully contained within its parent
 */
function isChildContainedInParent(child: LayoutNode, parent: LayoutNode): boolean {
  return (
    child.x >= parent.x &&
    child.y >= parent.y &&
    child.x + child.width <= parent.x + parent.width &&
    child.y + child.height <= parent.y + parent.height
  );
}

// ============================================================================
// Gap Test 1: End-to-end test - Select multi-branch tree, verify no overlaps
// ============================================================================

describe('End-to-End: Multi-branch Tree No Overlaps', () => {
  it('should produce a complete diagram with no overlapping nodes anywhere in a complex multi-branch tree', () => {
    // Create a complex tree with multiple branches at different levels
    const complexTree: LayoutTreeNode = {
      id: 'app-1',
      type: 'APPLICATION',
      label: 'Enterprise Application',
      children: [
        {
          id: 'comp-frontend',
          type: 'APP_COMPONENT',
          label: 'Frontend',
          children: [
            { id: 'svc-ui', type: 'SERVICE', label: 'UI Service', children: [] },
            { id: 'svc-auth', type: 'SERVICE', label: 'Auth Service', children: [] },
          ],
        },
        {
          id: 'comp-backend',
          type: 'APP_COMPONENT',
          label: 'Backend',
          children: [
            {
              id: 'svc-api',
              type: 'SERVICE',
              label: 'API Service',
              children: [
                { id: 'int-rest', type: 'INTERFACE', label: 'REST API', children: [] },
                { id: 'int-graphql', type: 'INTERFACE', label: 'GraphQL API', children: [] },
              ],
            },
          ],
        },
        {
          id: 'bp-order',
          type: 'BUSINESS_PROCESS',
          label: 'Order Processing',
          children: [
            { id: 'pa-validate', type: 'PROCESS_ACTIVITY', label: 'Validate', children: [] },
            { id: 'pa-process', type: 'PROCESS_ACTIVITY', label: 'Process', children: [] },
            { id: 'pa-fulfill', type: 'PROCESS_ACTIVITY', label: 'Fulfill', children: [] },
          ],
        },
      ],
    };

    // Run complete pipeline
    const layoutRoot = layoutAdvancedAddSelection(complexTree, { x: 500, y: 400 });
    const diagramNodes = convertTodiagramNodes(layoutRoot, 0);

    // Verify all 12 nodes are created
    expect(diagramNodes).toHaveLength(12);

    // Collect all layout nodes for overlap checking
    const allLayoutNodes = collectAllNodes(layoutRoot);

    // Check no siblings overlap at any level
    function verifySiblingNoOverlap(parent: LayoutNode): void {
      const siblings = parent.children;
      for (let i = 0; i < siblings.length; i++) {
        for (let j = i + 1; j < siblings.length; j++) {
          const overlaps = rectanglesOverlap(siblings[i], siblings[j]);
          if (overlaps) {
            throw new Error(
              `Overlap detected between ${siblings[i].id} and ${siblings[j].id}`
            );
          }
        }
      }
      for (const child of parent.children) {
        verifySiblingNoOverlap(child);
      }
    }

    verifySiblingNoOverlap(layoutRoot);

    // Verify all children are contained in their parents
    function verifyContainment(parent: LayoutNode): void {
      for (const child of parent.children) {
        expect(isChildContainedInParent(child, parent)).toBe(true);
        verifyContainment(child);
      }
    }

    verifyContainment(layoutRoot);
  });
});

// ============================================================================
// Gap Test 2: End-to-end test - Re-run Advanced Add, verify idempotency
// ============================================================================

describe('End-to-End: Idempotency (No Duplicates on Re-run)', () => {
  it('should produce identical entity IDs when layout is run multiple times', () => {
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
      ],
    };

    const viewportCenter = { x: 500, y: 400 };

    // First run
    const layout1 = layoutAdvancedAddSelection(tree, viewportCenter);
    const nodes1 = convertTodiagramNodes(layout1, 0);

    // Second run
    const layout2 = layoutAdvancedAddSelection(tree, viewportCenter);
    const nodes2 = convertTodiagramNodes(layout2, 0);

    // Same number of nodes
    expect(nodes1.length).toBe(nodes2.length);

    // Same entity_ids (note: diagram node IDs will be different due to generatePrefixedId)
    const entityIds1 = nodes1.map(n => n.entity_id).sort();
    const entityIds2 = nodes2.map(n => n.entity_id).sort();
    expect(entityIds1).toEqual(entityIds2);

    // Same positions
    for (let i = 0; i < nodes1.length; i++) {
      const node1 = nodes1.find(n => n.entity_id === entityIds1[i])!;
      const node2 = nodes2.find(n => n.entity_id === entityIds1[i])!;
      expect(node1.pos_x).toBe(node2.pos_x);
      expect(node1.pos_y).toBe(node2.pos_y);
      expect(node1.width).toBe(node2.width);
      expect(node1.height).toBe(node2.height);
    }
  });
});

// ============================================================================
// Gap Test 3: Edge case - Single leaf node produces correct minimum dimensions
// ============================================================================

describe('Edge Case: Single Leaf Node Minimum Dimensions', () => {
  it('should produce a standalone leaf node with at least minimum dimensions', () => {
    const singleLeaf: LayoutTreeNode = {
      id: 'entity-1',
      type: 'LOGICAL_DATA_ENTITY',
      label: 'X', // Very short label
      children: [],
    };

    const measured = measure(singleLeaf);
    const layout = assignPositions(measured, 0, 0);

    // Should meet minimum width and height requirements
    expect(layout.width).toBeGreaterThanOrEqual(LAYOUT_MIN_NODE_WIDTH);
    expect(layout.height).toBeGreaterThanOrEqual(MIN_LEAF_HEIGHT);

    // Convert to diagram node and verify
    const diagramNodes = convertTodiagramNodes(layout, 0);
    expect(diagramNodes).toHaveLength(1);
    expect(diagramNodes[0].width).toBeGreaterThanOrEqual(LAYOUT_MIN_NODE_WIDTH);
    expect(diagramNodes[0].height).toBeGreaterThanOrEqual(MIN_LEAF_HEIGHT);
    expect(diagramNodes[0].parent_node_id).toBeNull();
  });
});

// ============================================================================
// Gap Test 4: Edge case - Deeply nested hierarchy (5+ levels) positions correctly
// ============================================================================

describe('Edge Case: Deeply Nested Hierarchy (5+ Levels)', () => {
  it('should correctly position a 6-level deep hierarchy with no overlap', () => {
    // Create a very deep hierarchy: App > Comp > Svc > Int > Entity > Attr
    const deepTree: LayoutTreeNode = {
      id: 'app-1',
      type: 'APPLICATION',
      label: 'Level 1: Application',
      children: [
        {
          id: 'comp-1',
          type: 'APP_COMPONENT',
          label: 'Level 2: Component',
          children: [
            {
              id: 'svc-1',
              type: 'SERVICE',
              label: 'Level 3: Service',
              children: [
                {
                  id: 'int-1',
                  type: 'INTERFACE',
                  label: 'Level 4: Interface',
                  children: [
                    {
                      id: 'entity-1',
                      type: 'LOGICAL_DATA_ENTITY',
                      label: 'Level 5: Entity',
                      children: [
                        {
                          id: 'attr-1',
                          type: 'LOGICAL_DATA_ATTRIBUTE',
                          label: 'Level 6: Attribute',
                          children: [],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const layout = layoutAdvancedAddSelection(deepTree, { x: 600, y: 500 });

    // Verify all 6 levels exist
    const allNodes = collectAllNodes(layout);
    expect(allNodes).toHaveLength(6);

    // Verify nesting chain is correct
    let current: LayoutNode | undefined = layout;
    const depths = ['app-1', 'comp-1', 'svc-1', 'int-1', 'entity-1', 'attr-1'];
    for (const expectedId of depths) {
      expect(current).toBeDefined();
      expect(current!.id).toBe(expectedId);
      current = current!.children[0];
    }

    // Verify each level is properly contained in its parent
    function verifyDeepContainment(parent: LayoutNode, depth: number): void {
      if (parent.children.length > 0) {
        for (const child of parent.children) {
          const contained = isChildContainedInParent(child, parent);
          if (!contained) {
            throw new Error(
              `Child ${child.id} at depth ${depth + 1} is not contained in parent ${parent.id}`
            );
          }
          verifyDeepContainment(child, depth + 1);
        }
      }
    }

    verifyDeepContainment(layout, 1);

    // Verify proper padding at each level
    let parent: LayoutNode | undefined = layout;
    while (parent && parent.children.length > 0) {
      const child = parent.children[0];
      // Child should have at least PADDING_X space from parent edges
      expect(child.x - parent.x).toBeGreaterThanOrEqual(NORMAL_PADDING_X);
      expect((parent.x + parent.width) - (child.x + child.width)).toBeGreaterThanOrEqual(NORMAL_PADDING_X);
      parent = child;
    }
  });
});

// ============================================================================
// Gap Test 5: Edge case - Long label text wraps and expands container
// ============================================================================

describe('Edge Case: Long Label Text Expands Container', () => {
  it('should expand container width to accommodate a long label', () => {
    const longLabelContainer: LayoutTreeNode = {
      id: 'app-1',
      type: 'APPLICATION',
      label: 'This is an extremely long application name that should cause the container to expand significantly beyond the minimum width requirement',
      children: [
        {
          id: 'comp-1',
          type: 'APP_COMPONENT',
          label: 'Short',
          children: [],
        },
      ],
    };

    const measured = measure(longLabelContainer);
    const layout = assignPositions(measured, 0, 0);

    // The container should be wider than minimum due to long label
    expect(layout.width).toBeGreaterThan(LAYOUT_MIN_NODE_WIDTH * 2);

    // The child (with short label) should still be properly contained
    const child = layout.children[0];
    expect(isChildContainedInParent(child, layout)).toBe(true);
  });

  it('should expand container height when label wraps to multiple lines in narrow context', () => {
    // Create a scenario where text wrapping is forced
    const containerWithWrappingLabel: LayoutTreeNode = {
      id: 'parent-1',
      type: 'APPLICATION',
      label: 'Wide App',
      children: [
        {
          id: 'child-1',
          type: 'APP_COMPONENT',
          label: 'This child has a moderately long label',
          children: [],
        },
      ],
    };

    const measured = measure(containerWithWrappingLabel);

    // Measured height should account for label
    expect(measured.measuredHeight).toBeGreaterThan(LAYOUT_MIN_NODE_HEIGHT);
  });
});

// ============================================================================
// Gap Test 6: Integration - Verify correct z-index increments through hierarchy
// ============================================================================

describe('Integration: Z-Index Increments Through Full Hierarchy', () => {
  it('should assign strictly increasing z-index values for nested containment', () => {
    const tree: LayoutTreeNode = {
      id: 'root',
      type: 'APPLICATION',
      label: 'Root',
      children: [
        {
          id: 'level2-a',
          type: 'APP_COMPONENT',
          label: 'Level 2A',
          children: [
            { id: 'level3-a', type: 'SERVICE', label: 'Level 3A', children: [] },
          ],
        },
        {
          id: 'level2-b',
          type: 'APP_COMPONENT',
          label: 'Level 2B',
          children: [],
        },
      ],
    };

    const layout = layoutAdvancedAddSelection(tree, { x: 400, y: 300 });
    const diagramNodes = convertTodiagramNodes(layout, 100);

    // Find nodes by entity_id
    const rootNode = diagramNodes.find(n => n.entity_id === 'root')!;
    const level2aNode = diagramNodes.find(n => n.entity_id === 'level2-a')!;
    const level2bNode = diagramNodes.find(n => n.entity_id === 'level2-b')!;
    const level3aNode = diagramNodes.find(n => n.entity_id === 'level3-a')!;

    // Root should have lowest z_index
    expect(rootNode.z_index).toBeLessThan(level2aNode.z_index!);
    expect(rootNode.z_index).toBeLessThan(level2bNode.z_index!);

    // Level 3 should be higher than level 2
    expect(level3aNode.z_index).toBeGreaterThan(level2aNode.z_index!);

    // All z_indices should be above the base
    expect(rootNode.z_index).toBeGreaterThan(100);
    expect(level2aNode.z_index).toBeGreaterThan(100);
    expect(level2bNode.z_index).toBeGreaterThan(100);
    expect(level3aNode.z_index).toBeGreaterThan(100);
  });
});

// ============================================================================
// Gap Test 7: Edge case - Empty children array handled correctly
// ============================================================================

describe('Edge Case: Empty Children Array', () => {
  it('should handle nodes with explicit empty children arrays correctly', () => {
    const nodeWithEmptyChildren: LayoutTreeNode = {
      id: 'app-1',
      type: 'APPLICATION',
      label: 'Application',
      children: [], // Explicit empty array
    };

    const measured = measure(nodeWithEmptyChildren);
    const layout = assignPositions(measured, 50, 50);
    const diagramNodes = convertTodiagramNodes(layout, 0);

    expect(diagramNodes).toHaveLength(1);
    expect(diagramNodes[0].entity_id).toBe('app-1');
    expect(layout.children).toHaveLength(0);

    // Should still have minimum dimensions
    expect(layout.width).toBeGreaterThanOrEqual(LAYOUT_MIN_NODE_WIDTH);
    expect(layout.height).toBeGreaterThanOrEqual(MIN_LEAF_HEIGHT);
  });
});

// ============================================================================
// Gap Test 8: End-to-end - Multiple siblings at leaf level stack correctly
// ============================================================================

describe('End-to-End: Multiple Siblings at Leaf Level', () => {
  it('should stack 4+ leaf siblings vertically with consistent gaps', () => {
    const tree: LayoutTreeNode = {
      id: 'interface-1',
      type: 'INTERFACE',
      label: 'REST API',
      children: [
        { id: 'entity-1', type: 'LOGICAL_DATA_ENTITY', label: 'Customer', children: [] },
        { id: 'entity-2', type: 'LOGICAL_DATA_ENTITY', label: 'Order', children: [] },
        { id: 'entity-3', type: 'LOGICAL_DATA_ENTITY', label: 'Product', children: [] },
        { id: 'entity-4', type: 'LOGICAL_DATA_ENTITY', label: 'Invoice', children: [] },
      ],
    };

    const layout = layoutAdvancedAddSelection(tree, { x: 300, y: 300 });

    // All 4 children should exist
    expect(layout.children).toHaveLength(4);

    // Verify vertical stacking
    const children = layout.children;
    for (let i = 1; i < children.length; i++) {
      const prev = children[i - 1];
      const curr = children[i];

      // Current should be below previous with at least the gap
      expect(curr.y).toBeGreaterThanOrEqual(prev.y + prev.height + NORMAL_CHILD_GAP - 1);
    }

    // Verify no overlaps between any pair
    for (let i = 0; i < children.length; i++) {
      for (let j = i + 1; j < children.length; j++) {
        expect(rectanglesOverlap(children[i], children[j])).toBe(false);
      }
    }

    // All children should be contained in parent
    for (const child of children) {
      expect(isChildContainedInParent(child, layout)).toBe(true);
    }

    // Convert to diagram nodes and verify
    const diagramNodes = convertTodiagramNodes(layout, 0);
    expect(diagramNodes).toHaveLength(5); // 1 parent + 4 children
  });
});
