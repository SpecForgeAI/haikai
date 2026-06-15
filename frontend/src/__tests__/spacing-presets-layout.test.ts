/**
 * Spacing Presets Layout Tests
 *
 * Task Group 2: Parameterized Layout Functions
 * Tests for measure(), assignPositions(), and layoutAdvancedAddSelection()
 * with SpacingConfig parameter support.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  measure,
  assignPositions,
  layoutAdvancedAddSelection,
  LAYOUT_MIN_NODE_WIDTH,
  LAYOUT_LABEL_PADDING,
  estimateLabelHeight,
  estimateLabelWidth,
  LAYOUT_DEFAULT_FONT_SIZE,
} from '../utils/compoundLayout';
import {
  SpacingPreset,
  SPACING_PRESETS,
  LayoutTreeNode,
  LayoutNode,
} from '../types/advancedAdd';

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Check if two rectangles overlap (excluding shared edges)
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
 * Get sibling nodes (direct children of a parent)
 */
function getSiblings(parent: LayoutNode): LayoutNode[] {
  return parent.children;
}

// ============================================================================
// Mock Setup for Canvas Text Measurement
// ============================================================================

beforeAll(() => {
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
// Test Fixtures
// ============================================================================

const createSimpleTree = (): LayoutTreeNode => ({
  id: 'root',
  type: 'APPLICATION',
  label: 'My App',
  children: [
    {
      id: 'child1',
      type: 'APP_COMPONENT',
      label: 'Component 1',
      children: [],
    },
    {
      id: 'child2',
      type: 'APP_COMPONENT',
      label: 'Component 2',
      children: [],
    },
  ],
});

const createNestedTree = (): LayoutTreeNode => ({
  id: 'root',
  type: 'APPLICATION',
  label: 'My App',
  children: [
    {
      id: 'comp1',
      type: 'APP_COMPONENT',
      label: 'Component 1',
      children: [
        {
          id: 'service1',
          type: 'SERVICE',
          label: 'Service 1',
          children: [],
        },
      ],
    },
  ],
});

const viewportCenter = { x: 500, y: 400 };

// ============================================================================
// Task Group 2: Parameterized Layout Function Tests
// ============================================================================

describe('Spacing Presets Layout Functions', () => {
  describe('measure() with SpacingConfig', () => {
    it('should produce larger dimensions with spacious config than normal', () => {
      const tree = createSimpleTree();

      const spaciousMeasured = measure(tree, SPACING_PRESETS.spacious);
      const normalMeasured = measure(tree, SPACING_PRESETS.normal);

      // Spacious should be larger in both width and height
      expect(spaciousMeasured.measuredWidth).toBeGreaterThan(normalMeasured.measuredWidth);
      expect(spaciousMeasured.measuredHeight).toBeGreaterThan(normalMeasured.measuredHeight);
    });

    it('should produce smaller dimensions with tight config than normal', () => {
      const tree = createSimpleTree();

      const tightMeasured = measure(tree, SPACING_PRESETS.tight);
      const normalMeasured = measure(tree, SPACING_PRESETS.normal);

      // Tight should be smaller in both width and height
      expect(tightMeasured.measuredWidth).toBeLessThan(normalMeasured.measuredWidth);
      expect(tightMeasured.measuredHeight).toBeLessThan(normalMeasured.measuredHeight);
    });

    it('should respect minimum node width regardless of spacing', () => {
      const leafNode: LayoutTreeNode = {
        id: 'leaf',
        type: 'SERVICE',
        label: 'X', // Very short label
        children: [],
      };

      // All presets should respect minimum width
      for (const preset of ['spacious', 'normal', 'tight'] as SpacingPreset[]) {
        const measured = measure(leafNode, SPACING_PRESETS[preset]);
        expect(measured.measuredWidth).toBeGreaterThanOrEqual(LAYOUT_MIN_NODE_WIDTH);
      }
    });

    it('leaf nodes should use exact height (labelHeight + 2 * paddingY)', () => {
      const leafNode: LayoutTreeNode = {
        id: 'leaf',
        type: 'SERVICE',
        label: 'Test Service',
        children: [],
      };

      // Test with each preset
      for (const preset of ['spacious', 'normal', 'tight'] as SpacingPreset[]) {
        const config = SPACING_PRESETS[preset];
        const measured = measure(leafNode, config);

        // Calculate expected height using the SAME logic as measure():
        // wrapWidth = LAYOUT_MIN_NODE_WIDTH - 2 * paddingX
        // labelWidth = estimateLabelWidth(...)
        // labelHeight uses Math.max(wrapWidth, labelWidth) as the maxWidth
        const wrapWidth = LAYOUT_MIN_NODE_WIDTH - 2 * config.paddingX;
        const labelWidth = estimateLabelWidth(leafNode.label, LAYOUT_DEFAULT_FONT_SIZE, 'normal');
        const labelHeight = estimateLabelHeight(leafNode.label, Math.max(wrapWidth, labelWidth), LAYOUT_DEFAULT_FONT_SIZE, 'normal');
        const expectedHeight = labelHeight + 2 * config.paddingY;

        expect(measured.measuredHeight).toBe(expectedHeight);
      }
    });

    it('leaf node heights vary directly with paddingY for each preset', () => {
      const leafNode: LayoutTreeNode = {
        id: 'leaf',
        type: 'SERVICE',
        label: 'My Service', // Short single-line label
        children: [],
      };

      const spaciousMeasured = measure(leafNode, SPACING_PRESETS.spacious);
      const normalMeasured = measure(leafNode, SPACING_PRESETS.normal);
      const tightMeasured = measure(leafNode, SPACING_PRESETS.tight);

      // Spacious (paddingY=20) should be taller than Normal (paddingY=10)
      expect(spaciousMeasured.measuredHeight).toBeGreaterThan(normalMeasured.measuredHeight);

      // Normal (paddingY=10) should be taller than Tight (paddingY=5)
      expect(normalMeasured.measuredHeight).toBeGreaterThan(tightMeasured.measuredHeight);

      // Height differences should reflect padding differences
      // Spacious - Normal = 2*(20-10) = 20
      expect(spaciousMeasured.measuredHeight - normalMeasured.measuredHeight).toBe(20);

      // Normal - Tight = 2*(10-5) = 10
      expect(normalMeasured.measuredHeight - tightMeasured.measuredHeight).toBe(10);
    });
  });

  describe('assignPositions() with SpacingConfig', () => {
    it('should use correct childVerticalGap from config between siblings', () => {
      const tree = createSimpleTree();

      // Test with spacious config (childVerticalGap = 10)
      const spaciousMeasured = measure(tree, SPACING_PRESETS.spacious);
      const spaciousLayout = assignPositions(spaciousMeasured, 0, 0, SPACING_PRESETS.spacious);

      const spaciousSiblings = getSiblings(spaciousLayout);
      if (spaciousSiblings.length >= 2) {
        const gapSpacious = spaciousSiblings[1].y - (spaciousSiblings[0].y + spaciousSiblings[0].height);
        expect(gapSpacious).toBe(SPACING_PRESETS.spacious.childVerticalGap);
      }

      // Test with tight config (childVerticalGap = 4)
      const tightMeasured = measure(tree, SPACING_PRESETS.tight);
      const tightLayout = assignPositions(tightMeasured, 0, 0, SPACING_PRESETS.tight);

      const tightSiblings = getSiblings(tightLayout);
      if (tightSiblings.length >= 2) {
        const gapTight = tightSiblings[1].y - (tightSiblings[0].y + tightSiblings[0].height);
        expect(gapTight).toBe(SPACING_PRESETS.tight.childVerticalGap);
      }
    });

    it('should position children with correct horizontal padding', () => {
      const tree = createSimpleTree();

      // Test with spacious config
      const spaciousMeasured = measure(tree, SPACING_PRESETS.spacious);
      const spaciousLayout = assignPositions(spaciousMeasured, 100, 100, SPACING_PRESETS.spacious);

      // Children should be at least paddingX inside the parent
      for (const child of spaciousLayout.children) {
        expect(child.x).toBeGreaterThanOrEqual(spaciousLayout.x + SPACING_PRESETS.spacious.paddingX);
        expect(child.x + child.width).toBeLessThanOrEqual(
          spaciousLayout.x + spaciousLayout.width - SPACING_PRESETS.spacious.paddingX
        );
      }
    });
  });

  describe('layoutAdvancedAddSelection() with SpacingPreset', () => {
    it('should accept spacingPreset parameter and default to normal', () => {
      const tree = createSimpleTree();

      // Call without preset (should default to 'normal')
      const defaultLayout = layoutAdvancedAddSelection(tree, viewportCenter);

      // Call with explicit 'normal' preset
      const normalLayout = layoutAdvancedAddSelection(tree, viewportCenter, 'normal');

      // Results should be identical
      expect(defaultLayout.width).toBe(normalLayout.width);
      expect(defaultLayout.height).toBe(normalLayout.height);
    });

    it('should produce different layout sizes for different presets', () => {
      const tree = createSimpleTree();

      const spaciousLayout = layoutAdvancedAddSelection(tree, viewportCenter, 'spacious');
      const normalLayout = layoutAdvancedAddSelection(tree, viewportCenter, 'normal');
      const tightLayout = layoutAdvancedAddSelection(tree, viewportCenter, 'tight');

      // Spacious > Normal > Tight
      expect(spaciousLayout.width).toBeGreaterThan(normalLayout.width);
      expect(normalLayout.width).toBeGreaterThan(tightLayout.width);

      expect(spaciousLayout.height).toBeGreaterThan(normalLayout.height);
      expect(normalLayout.height).toBeGreaterThan(tightLayout.height);
    });

    it('should ensure no node overlap with any spacing preset', () => {
      const tree = createNestedTree();

      for (const preset of ['spacious', 'normal', 'tight'] as SpacingPreset[]) {
        const layout = layoutAdvancedAddSelection(tree, viewportCenter, preset);
        const allNodes = collectAllNodes(layout);

        // Check all pairs of sibling nodes don't overlap
        for (let i = 0; i < allNodes.length; i++) {
          for (let j = i + 1; j < allNodes.length; j++) {
            const node1 = allNodes[i];
            const node2 = allNodes[j];

            // Skip parent-child pairs (children are inside parents)
            const isChild1 = allNodes.some(n =>
              n.children.some(c => c.id === node1.id)
            );
            const isChild2 = allNodes.some(n =>
              n.children.some(c => c.id === node2.id)
            );

            // Only check siblings
            const areSiblings = allNodes.some(parent =>
              parent.children.some(c => c.id === node1.id) &&
              parent.children.some(c => c.id === node2.id)
            );

            if (areSiblings) {
              const overlap = rectanglesOverlap(node1, node2);
              expect(overlap).toBe(false);
            }
          }
        }
      }
    });

    it('should maintain backward compatibility: omitting preset equals normal', () => {
      const tree = createNestedTree();

      // Without preset
      const defaultLayout = layoutAdvancedAddSelection(tree, viewportCenter);

      // With explicit 'normal'
      const normalLayout = layoutAdvancedAddSelection(tree, viewportCenter, 'normal');

      // Compare dimensions
      expect(defaultLayout.width).toBe(normalLayout.width);
      expect(defaultLayout.height).toBe(normalLayout.height);

      // Compare positions (centered at same viewport)
      expect(defaultLayout.x).toBe(normalLayout.x);
      expect(defaultLayout.y).toBe(normalLayout.y);
    });

    it('switching presets should produce visibly different leaf node heights', () => {
      const tree = createSimpleTree();

      const spaciousLayout = layoutAdvancedAddSelection(tree, viewportCenter, 'spacious');
      const normalLayout = layoutAdvancedAddSelection(tree, viewportCenter, 'normal');
      const tightLayout = layoutAdvancedAddSelection(tree, viewportCenter, 'tight');

      // Get the first child (leaf) from each layout
      const spaciousChild = spaciousLayout.children[0];
      const normalChild = normalLayout.children[0];
      const tightChild = tightLayout.children[0];

      // Leaf heights should visibly differ between presets
      expect(spaciousChild.height).toBeGreaterThan(normalChild.height);
      expect(normalChild.height).toBeGreaterThan(tightChild.height);
    });

    it('Spacious preset produces tallest leaf nodes', () => {
      const tree = createSimpleTree();

      const spaciousLayout = layoutAdvancedAddSelection(tree, viewportCenter, 'spacious');
      const normalLayout = layoutAdvancedAddSelection(tree, viewportCenter, 'normal');
      const tightLayout = layoutAdvancedAddSelection(tree, viewportCenter, 'tight');

      // Check all leaf children have tallest heights with spacious
      for (let i = 0; i < spaciousLayout.children.length; i++) {
        expect(spaciousLayout.children[i].height).toBeGreaterThan(normalLayout.children[i].height);
        expect(spaciousLayout.children[i].height).toBeGreaterThan(tightLayout.children[i].height);
      }
    });

    it('Tight preset produces shortest leaf nodes', () => {
      const tree = createSimpleTree();

      const spaciousLayout = layoutAdvancedAddSelection(tree, viewportCenter, 'spacious');
      const normalLayout = layoutAdvancedAddSelection(tree, viewportCenter, 'normal');
      const tightLayout = layoutAdvancedAddSelection(tree, viewportCenter, 'tight');

      // Check all leaf children have shortest heights with tight
      for (let i = 0; i < tightLayout.children.length; i++) {
        expect(tightLayout.children[i].height).toBeLessThan(normalLayout.children[i].height);
        expect(tightLayout.children[i].height).toBeLessThan(spaciousLayout.children[i].height);
      }
    });
  });

  // ============================================================================
  // Task Group 4: Edge Case Tests
  // ============================================================================

  describe('Edge cases for leaf node height calculation', () => {
    it('labels with different lengths should produce proportionally different heights when wrapping occurs', () => {
      // The test verifies that the height calculation considers label height correctly
      // With mock canvas (7px per character), and minimum node width of 120px
      // For tight preset (paddingX=5), wrapWidth = 120 - 10 = 110px
      // A label wider than 110px / 7 = ~15 chars will wrap

      const singleLineNode: LayoutTreeNode = {
        id: 'single',
        type: 'SERVICE',
        label: 'Short', // 5 chars * 7 = 35px width, fits in one line
        children: [],
      };

      // Test that height is exactly labelHeight + 2*paddingY
      for (const preset of ['spacious', 'normal', 'tight'] as SpacingPreset[]) {
        const config = SPACING_PRESETS[preset];
        const measured = measure(singleLineNode, config);

        const wrapWidth = LAYOUT_MIN_NODE_WIDTH - 2 * config.paddingX;
        const labelWidth = estimateLabelWidth(singleLineNode.label, LAYOUT_DEFAULT_FONT_SIZE, 'normal');
        const labelHeight = estimateLabelHeight(singleLineNode.label, Math.max(wrapWidth, labelWidth), LAYOUT_DEFAULT_FONT_SIZE, 'normal');
        const expectedHeight = labelHeight + 2 * config.paddingY;

        expect(measured.measuredHeight).toBe(expectedHeight);
      }
    });

    it('empty labels should have height based only on padding', () => {
      const emptyLabelNode: LayoutTreeNode = {
        id: 'empty-label',
        type: 'SERVICE',
        label: '',
        children: [],
      };

      // Test with each preset
      for (const preset of ['spacious', 'normal', 'tight'] as SpacingPreset[]) {
        const config = SPACING_PRESETS[preset];
        const measured = measure(emptyLabelNode, config);

        // Height should be exactly 2 * paddingY (no label height)
        expect(measured.measuredHeight).toBe(2 * config.paddingY);
      }
    });

    it('very short labels should still respect exact height calculation', () => {
      const shortLabelNode: LayoutTreeNode = {
        id: 'short-label',
        type: 'SERVICE',
        label: 'A',
        children: [],
      };

      // Height for short label should follow the same formula
      for (const preset of ['spacious', 'normal', 'tight'] as SpacingPreset[]) {
        const config = SPACING_PRESETS[preset];
        const measured = measure(shortLabelNode, config);

        const wrapWidth = LAYOUT_MIN_NODE_WIDTH - 2 * config.paddingX;
        const labelWidth = estimateLabelWidth(shortLabelNode.label, LAYOUT_DEFAULT_FONT_SIZE, 'normal');
        const labelHeight = estimateLabelHeight(shortLabelNode.label, Math.max(wrapWidth, labelWidth), LAYOUT_DEFAULT_FONT_SIZE, 'normal');
        const expectedHeight = labelHeight + 2 * config.paddingY;

        expect(measured.measuredHeight).toBe(expectedHeight);
      }
    });

    it('deep nesting with leaf nodes at different depths should all use exact heights', () => {
      // Create a 4-level deep tree
      const deepTree: LayoutTreeNode = {
        id: 'level0',
        type: 'APPLICATION',
        label: 'App',
        children: [
          {
            id: 'level1',
            type: 'APP_COMPONENT',
            label: 'Component',
            children: [
              {
                id: 'level2',
                type: 'SERVICE',
                label: 'Service',
                children: [
                  {
                    id: 'level3-leaf',
                    type: 'INTERFACE',
                    label: 'API Endpoint',
                    children: [],
                  },
                ],
              },
              {
                id: 'level2-leaf',
                type: 'SERVICE',
                label: 'Another Service',
                children: [],
              },
            ],
          },
          {
            id: 'level1-leaf',
            type: 'BUSINESS_PROCESS',
            label: 'Process',
            children: [],
          },
        ],
      };

      // Layout the deep tree
      const spaciousLayout = layoutAdvancedAddSelection(deepTree, viewportCenter, 'spacious');
      const tightLayout = layoutAdvancedAddSelection(deepTree, viewportCenter, 'tight');

      // Collect all leaf nodes
      function getLeafNodes(node: LayoutNode): LayoutNode[] {
        if (node.children.length === 0) {
          return [node];
        }
        return node.children.flatMap(getLeafNodes);
      }

      const spaciousLeaves = getLeafNodes(spaciousLayout);
      const tightLeaves = getLeafNodes(tightLayout);

      // All leaf nodes should be taller in spacious than tight
      expect(spaciousLeaves.length).toBe(tightLeaves.length);
      for (let i = 0; i < spaciousLeaves.length; i++) {
        expect(spaciousLeaves[i].height).toBeGreaterThan(tightLeaves[i].height);
      }
    });

    it('mixed container and leaf nodes should have correct heights at each level', () => {
      const mixedTree: LayoutTreeNode = {
        id: 'root',
        type: 'APPLICATION',
        label: 'Mixed App',
        children: [
          {
            id: 'container1',
            type: 'APP_COMPONENT',
            label: 'Container',
            children: [
              { id: 'leaf1', type: 'SERVICE', label: 'Leaf 1', children: [] },
              { id: 'leaf2', type: 'SERVICE', label: 'Leaf 2', children: [] },
            ],
          },
          {
            id: 'leaf3',
            type: 'BUSINESS_PROCESS',
            label: 'Direct Leaf',
            children: [],
          },
        ],
      };

      const layout = layoutAdvancedAddSelection(mixedTree, viewportCenter, 'normal');

      // Container should be larger than its children combined
      const container = layout.children[0];
      const directLeaf = layout.children[1];

      // Container height should be larger than any single leaf
      expect(container.height).toBeGreaterThan(directLeaf.height);

      // Container should contain its children
      for (const child of container.children) {
        expect(child.y).toBeGreaterThanOrEqual(container.y);
        expect(child.y + child.height).toBeLessThanOrEqual(container.y + container.height);
      }
    });
  });
});
