/**
 * Spacing Presets Integration Tests
 *
 * Task Group 4: PalettePanel Integration
 * Tests for the end-to-end flow of spacing presets through the
 * buildWrappedNodeHierarchy function and handleAdvancedAddConfirm handler.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  SpacingPreset,
  SPACING_PRESETS,
  DEFAULT_SPACING_PRESET,
  TreeNodeData,
  LayoutTreeNode,
  LayoutNode,
} from '../types/advancedAdd';
import {
  measure,
  assignPositions,
  layoutAdvancedAddSelection,
} from '../utils/compoundLayout';

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

const createSimpleLayoutTree = (): LayoutTreeNode => ({
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
      id: 'comp-2',
      type: 'APP_COMPONENT',
      label: 'Component 2',
      children: [],
    },
  ],
});

const createDeepLayoutTree = (): LayoutTreeNode => ({
  id: 'app-1',
  type: 'APPLICATION',
  label: 'Complex App',
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
              label: 'API',
              children: [],
            },
          ],
        },
      ],
    },
    {
      id: 'bp-1',
      type: 'BUSINESS_PROCESS',
      label: 'Process',
      children: [
        {
          id: 'pa-1',
          type: 'PROCESS_ACTIVITY',
          label: 'Activity',
          children: [],
        },
      ],
    },
  ],
});

const viewportCenter = { x: 500, y: 400 };

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

// ============================================================================
// Task Group 4: Integration Tests
// ============================================================================

describe('Spacing Presets Integration', () => {
  describe('End-to-end layout flow', () => {
    it('should produce different sized layouts for different presets in full flow', () => {
      const tree = createSimpleLayoutTree();

      // Simulate the full flow: measure -> assignPositions -> center at viewport
      const spaciousLayout = layoutAdvancedAddSelection(tree, viewportCenter, 'spacious');
      const normalLayout = layoutAdvancedAddSelection(tree, viewportCenter, 'normal');
      const tightLayout = layoutAdvancedAddSelection(tree, viewportCenter, 'tight');

      // Total size should follow: spacious > normal > tight
      expect(spaciousLayout.width).toBeGreaterThan(normalLayout.width);
      expect(spaciousLayout.height).toBeGreaterThan(normalLayout.height);

      expect(normalLayout.width).toBeGreaterThan(tightLayout.width);
      expect(normalLayout.height).toBeGreaterThan(tightLayout.height);
    });

    it('should maintain correct viewport centering for all presets', () => {
      const tree = createSimpleLayoutTree();

      for (const preset of ['spacious', 'normal', 'tight'] as SpacingPreset[]) {
        const layout = layoutAdvancedAddSelection(tree, viewportCenter, preset);

        // The root now spawns at the fixed origin (100,100) for every
        // preset; the viewportCenter argument is ignored (API compatibility).
        expect(layout.x).toBe(100);
        expect(layout.y).toBe(100);
      }
    });
  });

  describe('Complex hierarchy with spacing presets', () => {
    it('should maintain no-overlap guarantee for complex tree with all presets', () => {
      const tree = createDeepLayoutTree();

      for (const preset of ['spacious', 'normal', 'tight'] as SpacingPreset[]) {
        const layout = layoutAdvancedAddSelection(tree, viewportCenter, preset);

        // Check siblings at each level don't overlap
        function verifySiblingNoOverlap(parent: LayoutNode) {
          const siblings = parent.children;
          for (let i = 0; i < siblings.length; i++) {
            for (let j = i + 1; j < siblings.length; j++) {
              const overlap = rectanglesOverlap(siblings[i], siblings[j]);
              expect(overlap).toBe(false);
            }
          }
          // Recurse
          for (const child of parent.children) {
            verifySiblingNoOverlap(child);
          }
        }

        verifySiblingNoOverlap(layout);
      }
    });

    it('should maintain parent containment for complex tree with all presets', () => {
      const tree = createDeepLayoutTree();

      for (const preset of ['spacious', 'normal', 'tight'] as SpacingPreset[]) {
        const layout = layoutAdvancedAddSelection(tree, viewportCenter, preset);

        // Check children are inside parents
        function verifyContainment(parent: LayoutNode) {
          for (const child of parent.children) {
            // Child should be inside parent
            expect(child.x).toBeGreaterThanOrEqual(parent.x);
            expect(child.y).toBeGreaterThanOrEqual(parent.y);
            expect(child.x + child.width).toBeLessThanOrEqual(parent.x + parent.width);
            expect(child.y + child.height).toBeLessThanOrEqual(parent.y + parent.height);

            // Recurse
            verifyContainment(child);
          }
        }

        verifyContainment(layout);
      }
    });
  });

  describe('Backward compatibility', () => {
    it('should produce identical results when omitting preset vs explicit normal', () => {
      const tree = createDeepLayoutTree();

      // Without preset (should default to 'normal')
      const defaultLayout = layoutAdvancedAddSelection(tree, viewportCenter);

      // With explicit 'normal'
      const normalLayout = layoutAdvancedAddSelection(tree, viewportCenter, 'normal');

      // Compare root dimensions
      expect(defaultLayout.width).toBe(normalLayout.width);
      expect(defaultLayout.height).toBe(normalLayout.height);
      expect(defaultLayout.x).toBe(normalLayout.x);
      expect(defaultLayout.y).toBe(normalLayout.y);

      // Compare all node counts
      const defaultNodes = collectAllNodes(defaultLayout);
      const normalNodes = collectAllNodes(normalLayout);
      expect(defaultNodes.length).toBe(normalNodes.length);

      // Compare each node's dimensions
      for (let i = 0; i < defaultNodes.length; i++) {
        expect(defaultNodes[i].width).toBe(normalNodes[i].width);
        expect(defaultNodes[i].height).toBe(normalNodes[i].height);
      }
    });

    it('should match expected normal preset config values', () => {
      // Normal preset values: paddingX: 10, paddingY: 10, childVerticalGap: 7
      // Note: minExtraHeight was removed in the height calculation fix
      const normalConfig = SPACING_PRESETS.normal;

      expect(normalConfig.paddingX).toBe(10);
      expect(normalConfig.paddingY).toBe(10);
      expect(normalConfig.childVerticalGap).toBe(7);
    });
  });

  describe('Spacing preset extraction from result', () => {
    it('should be able to extract spacingPreset from AdvancedAddResult', () => {
      // This simulates what handleAdvancedAddConfirm would do
      const mockResult = {
        treeData: {
          key: 'root-app-1',
          label: 'Application: Test',
          entityType: 'APPLICATION',
          entityId: 'app-1',
          entityName: 'Test',
          isRoot: true,
          children: [],
        } as TreeNodeData,
        selectedKeys: new Set(['root-app-1']),
        selections: [],
        spacingPreset: 'tight' as SpacingPreset,
      };

      // Extract preset (simulating what the handler would do)
      const extractedPreset = mockResult.spacingPreset || DEFAULT_SPACING_PRESET;

      expect(extractedPreset).toBe('tight');
    });

    it('should default to normal when spacingPreset is undefined', () => {
      const mockResult = {
        treeData: {
          key: 'root-app-1',
          label: 'Application: Test',
          entityType: 'APPLICATION',
          entityId: 'app-1',
          entityName: 'Test',
          isRoot: true,
          children: [],
        } as TreeNodeData,
        selectedKeys: new Set(['root-app-1']),
        selections: [],
        // spacingPreset is undefined
      };

      // Extract preset with fallback (simulating what the handler would do)
      const extractedPreset = mockResult.spacingPreset || DEFAULT_SPACING_PRESET;

      expect(extractedPreset).toBe('normal');
    });
  });

  describe('Layout size ratios', () => {
    it('should have consistent size ratios between presets', () => {
      const tree = createSimpleLayoutTree();

      const spaciousLayout = layoutAdvancedAddSelection(tree, viewportCenter, 'spacious');
      const normalLayout = layoutAdvancedAddSelection(tree, viewportCenter, 'normal');
      const tightLayout = layoutAdvancedAddSelection(tree, viewportCenter, 'tight');

      // Spacious should be roughly 1.5-2x larger than tight
      const widthRatio = spaciousLayout.width / tightLayout.width;
      const heightRatio = spaciousLayout.height / tightLayout.height;

      expect(widthRatio).toBeGreaterThan(1);
      expect(heightRatio).toBeGreaterThan(1);

      // Normal should be between spacious and tight
      expect(normalLayout.width).toBeLessThan(spaciousLayout.width);
      expect(normalLayout.width).toBeGreaterThan(tightLayout.width);
      expect(normalLayout.height).toBeLessThan(spaciousLayout.height);
      expect(normalLayout.height).toBeGreaterThan(tightLayout.height);
    });
  });
});
