/**
 * Hierarchical Layout Algorithm Tests
 *
 * Task Group 1: Core Layout Algorithm
 * Tests for the two-pass recursive layout algorithm that ensures
 * diagram nodes are properly positioned with no overlaps.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  measure,
  assignPositions,
  layoutAdvancedAddSelection,
  LAYOUT_LABEL_PADDING,
  LAYOUT_MIN_NODE_WIDTH,
  LAYOUT_MIN_NODE_HEIGHT,
} from '../utils/compoundLayout';
import { LayoutTreeNode, MeasuredNode, LayoutNode, SPACING_PRESETS } from '../types/advancedAdd';

// The layout now defaults to the 'normal' spacing preset (paddingX/paddingY = 10,
// childVerticalGap = 7) instead of the legacy LAYOUT_PADDING_* constants, leaf
// heights are exact (labelHeight + 2 * paddingY, no LAYOUT_MIN_NODE_HEIGHT clamp),
// and the root spawns at the fixed origin (100,100) -- viewportCenter is ignored.
const NORMAL_PADDING_X = SPACING_PRESETS.normal.paddingX;
const NORMAL_PADDING_Y = SPACING_PRESETS.normal.paddingY;
const NORMAL_CHILD_GAP = SPACING_PRESETS.normal.childVerticalGap;

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Check if two rectangles overlap
 * @param r1 - First rectangle with x, y, width, height
 * @param r2 - Second rectangle with x, y, width, height
 * @returns true if rectangles overlap
 */
function rectanglesOverlap(
  r1: { x: number; y: number; width: number; height: number },
  r2: { x: number; y: number; width: number; height: number }
): boolean {
  // Check if one rectangle is to the left of the other
  if (r1.x + r1.width <= r2.x || r2.x + r2.width <= r1.x) {
    return false;
  }
  // Check if one rectangle is above the other
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

/**
 * Get sibling nodes at the same level (direct children of the same parent)
 */
function getSiblings(parent: LayoutNode): LayoutNode[] {
  return parent.children;
}

// ============================================================================
// Mock Setup for Canvas Text Measurement
// ============================================================================

beforeAll(() => {
  // Mock canvas for text measurement
  // This is needed because measureTextWidth uses canvas API
  const mockContext = {
    font: '',
    measureText: (text: string) => ({
      width: text.length * 7, // Approximate width based on character count
    }),
  };

  const mockCanvas = {
    getContext: () => mockContext,
  };

  // Mock document.createElement to return mock canvas
  const originalCreateElement = document.createElement.bind(document);
  document.createElement = ((tagName: string) => {
    if (tagName === 'canvas') {
      return mockCanvas as unknown as HTMLCanvasElement;
    }
    return originalCreateElement(tagName);
  }) as typeof document.createElement;
});

// ============================================================================
// Test 1: measure() returns correct dimensions for leaf nodes
// ============================================================================

describe('measure() - Leaf Node Dimensions', () => {
  it('should return minimum dimensions for a short label leaf node', () => {
    const leafNode: LayoutTreeNode = {
      id: 'leaf-1',
      type: 'LOGICAL_DATA_ENTITY',
      label: 'Short',
      children: [],
    };

    const measured = measure(leafNode);

    expect(measured.id).toBe('leaf-1');
    expect(measured.type).toBe('LOGICAL_DATA_ENTITY');
    expect(measured.label).toBe('Short');
    expect(measured.children).toHaveLength(0);
    expect(measured.measuredWidth).toBeGreaterThanOrEqual(LAYOUT_MIN_NODE_WIDTH);
    // Leaf height is exact: single-line label (~12px) + 2 * paddingY
    expect(measured.measuredHeight).toBeGreaterThanOrEqual(12 + 2 * NORMAL_PADDING_Y);
  });

  it('should expand width for a long label that exceeds minimum', () => {
    const leafNode: LayoutTreeNode = {
      id: 'leaf-2',
      type: 'LOGICAL_DATA_ENTITY',
      label: 'This is a very long label that should exceed the minimum width',
      children: [],
    };

    const measured = measure(leafNode);

    // Width should be label width + 2 * padding
    // With our mock (7px per char), 60 chars = 420px
    // Plus padding: 420 + 2*20 = 460px
    expect(measured.measuredWidth).toBeGreaterThan(LAYOUT_MIN_NODE_WIDTH);
  });
});

// ============================================================================
// Test 2: measure() calculates correct dimensions for containers with children
// ============================================================================

describe('measure() - Container Node Dimensions', () => {
  it('should calculate container size based on single child', () => {
    const containerNode: LayoutTreeNode = {
      id: 'container-1',
      type: 'APPLICATION',
      label: 'My App',
      children: [
        {
          id: 'child-1',
          type: 'APP_COMPONENT',
          label: 'Component 1',
          children: [],
        },
      ],
    };

    const measured = measure(containerNode);

    expect(measured.children).toHaveLength(1);

    // Container width should be max(label width, child width) + 2 * padding
    const childMeasured = measured.children[0];
    const expectedMinWidth = childMeasured.measuredWidth + 2 * NORMAL_PADDING_X;
    expect(measured.measuredWidth).toBeGreaterThanOrEqual(expectedMinWidth);

    // Container height should include: padding + label + label_padding + child height + padding
    const expectedMinHeight =
      NORMAL_PADDING_Y + // top padding
      12 + // approximate label height (single line)
      LAYOUT_LABEL_PADDING +
      childMeasured.measuredHeight +
      NORMAL_PADDING_Y; // bottom padding

    expect(measured.measuredHeight).toBeGreaterThanOrEqual(expectedMinHeight - 10); // Allow some tolerance
  });

  it('should calculate container size based on multiple children', () => {
    const containerNode: LayoutTreeNode = {
      id: 'container-2',
      type: 'INTERFACE',
      label: 'API',
      children: [
        {
          id: 'entity-1',
          type: 'LOGICAL_DATA_ENTITY',
          label: 'Scenario',
          children: [],
        },
        {
          id: 'entity-2',
          type: 'LOGICAL_DATA_ENTITY',
          label: 'ScenarioEdits',
          children: [],
        },
        {
          id: 'entity-3',
          type: 'LOGICAL_DATA_ENTITY',
          label: 'ScenarioImpact',
          children: [],
        },
      ],
    };

    const measured = measure(containerNode);

    expect(measured.children).toHaveLength(3);

    // Height should include all children plus gaps
    const totalChildHeight = measured.children.reduce((sum, c) => sum + c.measuredHeight, 0);
    const totalGaps = NORMAL_CHILD_GAP * (measured.children.length - 1);

    const expectedMinHeight =
      NORMAL_PADDING_Y +
      12 + // label height
      LAYOUT_LABEL_PADDING +
      totalChildHeight +
      totalGaps +
      NORMAL_PADDING_Y;

    expect(measured.measuredHeight).toBeGreaterThanOrEqual(expectedMinHeight - 10);
  });

  it('should handle deeply nested hierarchy correctly', () => {
    const deepTree: LayoutTreeNode = {
      id: 'app-1',
      type: 'APPLICATION',
      label: 'Application',
      children: [
        {
          id: 'comp-1',
          type: 'APP_COMPONENT',
          label: 'Component',
          children: [
            {
              id: 'svc-1',
              type: 'SERVICE',
              label: 'Service',
              children: [
                {
                  id: 'int-1',
                  type: 'INTERFACE',
                  label: 'Interface',
                  children: [
                    {
                      id: 'entity-1',
                      type: 'LOGICAL_DATA_ENTITY',
                      label: 'Entity',
                      children: [],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const measured = measure(deepTree);

    // Each level should wrap its children
    expect(measured.measuredWidth).toBeGreaterThan(LAYOUT_MIN_NODE_WIDTH);
    expect(measured.measuredHeight).toBeGreaterThan(LAYOUT_MIN_NODE_HEIGHT);

    // Verify the chain
    expect(measured.children[0].children[0].children[0].children[0].id).toBe('entity-1');
  });
});

// ============================================================================
// Test 3: assignPositions() positions siblings vertically without overlap
// ============================================================================

describe('assignPositions() - Sibling Positioning', () => {
  it('should position multiple siblings vertically without overlap', () => {
    // First measure to get dimensions
    const containerNode: LayoutTreeNode = {
      id: 'container-1',
      type: 'APPLICATION',
      label: 'My App',
      children: [
        { id: 'child-1', type: 'APP_COMPONENT', label: 'Component 1', children: [] },
        { id: 'child-2', type: 'APP_COMPONENT', label: 'Component 2', children: [] },
        { id: 'child-3', type: 'APP_COMPONENT', label: 'Component 3', children: [] },
      ],
    };

    const measured = measure(containerNode);
    const layout = assignPositions(measured, 0, 0);

    expect(layout.children).toHaveLength(3);

    // Check that siblings are stacked vertically
    const siblings = layout.children;

    // Each sibling should be below the previous one
    for (let i = 1; i < siblings.length; i++) {
      const prev = siblings[i - 1];
      const curr = siblings[i];

      // Current sibling's Y should be >= previous sibling's bottom + gap
      expect(curr.y).toBeGreaterThanOrEqual(prev.y + prev.height + NORMAL_CHILD_GAP - 1);
    }

    // Verify no overlap between any pair of siblings
    for (let i = 0; i < siblings.length; i++) {
      for (let j = i + 1; j < siblings.length; j++) {
        expect(rectanglesOverlap(siblings[i], siblings[j])).toBe(false);
      }
    }
  });

  it('should position siblings of different heights correctly', () => {
    const containerNode: LayoutTreeNode = {
      id: 'container-1',
      type: 'APPLICATION',
      label: 'My App',
      children: [
        { id: 'child-1', type: 'APP_COMPONENT', label: 'Short', children: [] },
        {
          id: 'child-2',
          type: 'APP_COMPONENT',
          label: 'Medium Label Here',
          children: [
            { id: 'grandchild-1', type: 'SERVICE', label: 'Service', children: [] },
          ],
        },
        { id: 'child-3', type: 'APP_COMPONENT', label: 'Another Short', children: [] },
      ],
    };

    const measured = measure(containerNode);
    const layout = assignPositions(measured, 100, 100);

    const siblings = layout.children;

    // Second child (container) should be taller than others
    expect(siblings[1].height).toBeGreaterThan(siblings[0].height);
    expect(siblings[1].height).toBeGreaterThan(siblings[2].height);

    // Verify no overlap
    for (let i = 0; i < siblings.length; i++) {
      for (let j = i + 1; j < siblings.length; j++) {
        expect(rectanglesOverlap(siblings[i], siblings[j])).toBe(false);
      }
    }
  });
});

// ============================================================================
// Test 4: assignPositions() positions children inside parent with correct padding
// ============================================================================

describe('assignPositions() - Child Containment', () => {
  it('should position children fully inside parent bounds', () => {
    const containerNode: LayoutTreeNode = {
      id: 'parent-1',
      type: 'APPLICATION',
      label: 'Parent Application',
      children: [
        { id: 'child-1', type: 'APP_COMPONENT', label: 'Child 1', children: [] },
        { id: 'child-2', type: 'APP_COMPONENT', label: 'Child 2', children: [] },
      ],
    };

    const measured = measure(containerNode);
    const layout = assignPositions(measured, 50, 50);

    // All children should be contained within parent
    for (const child of layout.children) {
      expect(isChildContainedInParent(child, layout)).toBe(true);
    }
  });

  it('should maintain correct padding between children and parent edges', () => {
    const containerNode: LayoutTreeNode = {
      id: 'parent-1',
      type: 'APPLICATION',
      label: 'App',
      children: [
        { id: 'child-1', type: 'APP_COMPONENT', label: 'Component', children: [] },
      ],
    };

    const measured = measure(containerNode);
    const layout = assignPositions(measured, 0, 0);

    const child = layout.children[0];
    const parent = layout;

    // Left padding
    expect(child.x - parent.x).toBeGreaterThanOrEqual(NORMAL_PADDING_X);

    // Right padding
    expect((parent.x + parent.width) - (child.x + child.width)).toBeGreaterThanOrEqual(NORMAL_PADDING_X);

    // Bottom padding (accounting for label)
    expect((parent.y + parent.height) - (child.y + child.height)).toBeGreaterThanOrEqual(NORMAL_PADDING_Y);
  });

  it('should center children horizontally within parent', () => {
    const containerNode: LayoutTreeNode = {
      id: 'parent-1',
      type: 'APPLICATION',
      label: 'Wide Application Name That Makes Parent Very Wide',
      children: [
        { id: 'child-1', type: 'APP_COMPONENT', label: 'Small', children: [] },
      ],
    };

    const measured = measure(containerNode);
    const layout = assignPositions(measured, 0, 0);

    const child = layout.children[0];
    const parent = layout;

    // Calculate expected center position
    const innerWidth = parent.width - 2 * NORMAL_PADDING_X;
    const expectedChildX = parent.x + NORMAL_PADDING_X + (innerWidth - child.width) / 2;

    expect(child.x).toBeCloseTo(expectedChildX, 0);
  });
});

// ============================================================================
// Test 5: layoutAdvancedAddSelection() produces correct layout for multi-level hierarchy
// ============================================================================

describe('layoutAdvancedAddSelection() - Multi-level Hierarchy', () => {
  it('should produce correct layout for a 4-level hierarchy', () => {
    const tree: LayoutTreeNode = {
      id: 'app-1',
      type: 'APPLICATION',
      label: 'My Application',
      children: [
        {
          id: 'comp-1',
          type: 'APP_COMPONENT',
          label: 'Component 1',
          children: [
            {
              id: 'svc-1',
              type: 'SERVICE',
              label: 'Service 1',
              children: [
                {
                  id: 'int-1',
                  type: 'INTERFACE',
                  label: 'API',
                  children: [],
                },
              ],
            },
          ],
        },
      ],
    };

    const viewportCenter = { x: 500, y: 400 };
    const layout = layoutAdvancedAddSelection(tree, viewportCenter);

    // Root should be centered at viewport
    // The root now spawns at the fixed origin (100,100); viewportCenter is
    // kept only for API compatibility and ignored.
    expect(layout.x).toBe(100);
    expect(layout.y).toBe(100);

    // Verify nesting hierarchy
    expect(layout.id).toBe('app-1');
    expect(layout.children[0].id).toBe('comp-1');
    expect(layout.children[0].children[0].id).toBe('svc-1');
    expect(layout.children[0].children[0].children[0].id).toBe('int-1');

    // Verify all children are contained in their parents
    function verifyContainment(parent: LayoutNode) {
      for (const child of parent.children) {
        expect(isChildContainedInParent(child, parent)).toBe(true);
        verifyContainment(child);
      }
    }
    verifyContainment(layout);
  });

  it('should produce layout with no overlapping nodes at any level', () => {
    const tree: LayoutTreeNode = {
      id: 'app-1',
      type: 'APPLICATION',
      label: 'Application',
      children: [
        {
          id: 'comp-1',
          type: 'APP_COMPONENT',
          label: 'Component 1',
          children: [
            { id: 'svc-1', type: 'SERVICE', label: 'Service 1', children: [] },
            { id: 'svc-2', type: 'SERVICE', label: 'Service 2', children: [] },
          ],
        },
        {
          id: 'comp-2',
          type: 'APP_COMPONENT',
          label: 'Component 2',
          children: [
            { id: 'svc-3', type: 'SERVICE', label: 'Service 3', children: [] },
          ],
        },
      ],
    };

    const layout = layoutAdvancedAddSelection(tree, { x: 500, y: 400 });

    // Collect all nodes at each level and verify no overlaps within levels
    const allNodes = collectAllNodes(layout);

    // For siblings at same level, verify no overlap
    function verifySiblingNoOverlap(parent: LayoutNode) {
      const siblings = parent.children;
      for (let i = 0; i < siblings.length; i++) {
        for (let j = i + 1; j < siblings.length; j++) {
          expect(rectanglesOverlap(siblings[i], siblings[j])).toBe(false);
        }
      }
      // Recurse for all children
      for (const child of parent.children) {
        verifySiblingNoOverlap(child);
      }
    }
    verifySiblingNoOverlap(layout);
  });
});

// ============================================================================
// Test 6: Multi-branch layout (Application with both App Component and Business Process)
// ============================================================================

describe('layoutAdvancedAddSelection() - Multi-branch Hierarchy', () => {
  it('should handle Application with both App Component and Business Process branches', () => {
    // This tests the key scenario from the spec:
    // Application
    // +-- App Component
    // |   +-- Service
    // +-- Business Process (via application point)
    //     +-- Process Activity

    const tree: LayoutTreeNode = {
      id: 'app-1',
      type: 'APPLICATION',
      label: 'My App',
      children: [
        {
          id: 'comp-1',
          type: 'APP_COMPONENT',
          label: 'My Component',
          children: [
            {
              id: 'svc-1',
              type: 'SERVICE',
              label: 'My Service',
              children: [],
            },
          ],
        },
        {
          id: 'bp-1',
          type: 'BUSINESS_PROCESS',
          label: 'Order Processing',
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

    const layout = layoutAdvancedAddSelection(tree, { x: 600, y: 500 });

    // Verify both branches exist
    expect(layout.children).toHaveLength(2);

    const compBranch = layout.children.find(c => c.id === 'comp-1');
    const bpBranch = layout.children.find(c => c.id === 'bp-1');

    expect(compBranch).toBeDefined();
    expect(bpBranch).toBeDefined();

    // Verify branches don't overlap
    expect(rectanglesOverlap(compBranch!, bpBranch!)).toBe(false);

    // Verify both branches are contained in parent
    expect(isChildContainedInParent(compBranch!, layout)).toBe(true);
    expect(isChildContainedInParent(bpBranch!, layout)).toBe(true);

    // Verify the BP branch is below the App Component branch
    expect(bpBranch!.y).toBeGreaterThan(compBranch!.y + compBranch!.height);

    // Verify grandchildren are properly nested
    expect(compBranch!.children[0].id).toBe('svc-1');
    expect(bpBranch!.children[0].id).toBe('pa-1');

    // Verify grandchildren are contained in their parents
    expect(isChildContainedInParent(compBranch!.children[0], compBranch!)).toBe(true);
    expect(isChildContainedInParent(bpBranch!.children[0], bpBranch!)).toBe(true);
  });

  it('should correctly stack multiple branches of varying depths', () => {
    const tree: LayoutTreeNode = {
      id: 'app-1',
      type: 'APPLICATION',
      label: 'Complex Application',
      children: [
        {
          id: 'comp-1',
          type: 'APP_COMPONENT',
          label: 'Deep Component',
          children: [
            {
              id: 'svc-1',
              type: 'SERVICE',
              label: 'Service',
              children: [
                {
                  id: 'int-1',
                  type: 'INTERFACE',
                  label: 'API',
                  children: [
                    { id: 'entity-1', type: 'LOGICAL_DATA_ENTITY', label: 'Entity 1', children: [] },
                    { id: 'entity-2', type: 'LOGICAL_DATA_ENTITY', label: 'Entity 2', children: [] },
                  ],
                },
              ],
            },
          ],
        },
        {
          id: 'bp-1',
          type: 'BUSINESS_PROCESS',
          label: 'Shallow Process',
          children: [
            { id: 'pa-1', type: 'PROCESS_ACTIVITY', label: 'Activity', children: [] },
          ],
        },
        {
          id: 'comp-2',
          type: 'APP_COMPONENT',
          label: 'Leaf Component',
          children: [],
        },
      ],
    };

    const layout = layoutAdvancedAddSelection(tree, { x: 800, y: 600 });

    // All three children should exist
    expect(layout.children).toHaveLength(3);

    // Verify no overlaps between any children
    const children = layout.children;
    for (let i = 0; i < children.length; i++) {
      for (let j = i + 1; j < children.length; j++) {
        expect(rectanglesOverlap(children[i], children[j])).toBe(false);
      }
    }

    // The deep component should be taller than the shallow process
    const deepComp = children.find(c => c.id === 'comp-1')!;
    const shallowProcess = children.find(c => c.id === 'bp-1')!;
    expect(deepComp.height).toBeGreaterThan(shallowProcess.height);

    // All children should be fully contained
    for (const child of children) {
      expect(isChildContainedInParent(child, layout)).toBe(true);
    }
  });
});
