/**
 * Fixed Spawn Position - Compound Layout Tests
 * Task Group 2: Tests for fixed root origin in layoutAdvancedAddSelection
 *
 * This test file verifies that layoutAdvancedAddSelection always places
 * the root node at (100, 100) regardless of the viewportCenter input.
 */

import { describe, it, expect } from 'vitest';
import { layoutAdvancedAddSelection } from '../utils/compoundLayout';
import { LayoutTreeNode, LayoutConfig, SPACING_PRESETS } from '../types/advancedAdd';

// ============================================================================
// Task Group 2.1: Fixed Root Origin Tests
// ============================================================================

describe('Fixed Spawn Position - Compound Layout Utilities', () => {
  // Helper to create a simple layout tree for testing
  function createTestTree(label: string, children: LayoutTreeNode[] = []): LayoutTreeNode {
    return {
      id: `test-${label}`,
      type: 'APPLICATION',
      label,
      children,
    };
  }

  describe('layoutAdvancedAddSelection - Grid Layout Branch', () => {
    it('should produce rootX=100, rootY=100 regardless of viewportCenter', () => {
      // Create a tree with children to trigger grid layout
      const tree = createTestTree('Parent App', [
        createTestTree('Child 1'),
        createTestTree('Child 2'),
        createTestTree('Child 3'),
      ]);

      // Grid layout config (childColumns > 1)
      const layoutConfig: LayoutConfig = {
        ...SPACING_PRESETS.normal,
        childColumns: 2,
        childNodeWidth: 120,
      };

      // Various viewport centers - all should be ignored
      const viewportCenters = [
        { x: 500, y: 400 },
        { x: 1000, y: 1000 },
        { x: 0, y: 0 },
      ];

      for (const viewportCenter of viewportCenters) {
        const result = layoutAdvancedAddSelection(tree, viewportCenter, 'normal', layoutConfig);

        // Root node should be at (100, 100)
        expect(result.x).toBe(100);
        expect(result.y).toBe(100);
      }
    });
  });

  describe('layoutAdvancedAddSelection - Standard Layout Branch', () => {
    it('should produce rootX=100, rootY=100 regardless of viewportCenter', () => {
      // Create a simple tree for standard (single column) layout
      const tree = createTestTree('Parent App', [
        createTestTree('Child 1'),
        createTestTree('Child 2'),
      ]);

      // Standard layout (no layoutConfig or childColumns=1)
      const viewportCenters = [
        { x: 500, y: 400 },
        { x: 1000, y: 1000 },
        { x: 0, y: 0 },
      ];

      for (const viewportCenter of viewportCenters) {
        // Without layoutConfig - uses standard layout
        const result = layoutAdvancedAddSelection(tree, viewportCenter, 'normal');

        // Root node should be at (100, 100)
        expect(result.x).toBe(100);
        expect(result.y).toBe(100);
      }
    });

    it('should produce rootX=100, rootY=100 with layoutConfig having childColumns=1', () => {
      const tree = createTestTree('Parent App', [
        createTestTree('Child 1'),
      ]);

      // layoutConfig with childColumns=1 uses standard branch
      const layoutConfig: LayoutConfig = {
        ...SPACING_PRESETS.normal,
        childColumns: 1,
        childNodeWidth: 120,
      };

      const viewportCenter = { x: 600, y: 500 };
      const result = layoutAdvancedAddSelection(tree, viewportCenter, 'normal', layoutConfig);

      // Root node should be at (100, 100)
      expect(result.x).toBe(100);
      expect(result.y).toBe(100);
    });
  });

  describe('layoutAdvancedAddSelection - Child Positioning Relative to Root', () => {
    it('should maintain correct child positions relative to root at (100, 100)', () => {
      const tree = createTestTree('Parent App', [
        createTestTree('Child 1'),
        createTestTree('Child 2'),
      ]);

      const viewportCenter = { x: 500, y: 400 };
      const result = layoutAdvancedAddSelection(tree, viewportCenter, 'normal');

      // Root should be at (100, 100)
      expect(result.x).toBe(100);
      expect(result.y).toBe(100);

      // Children should be positioned inside the root (x >= root.x, y >= root.y)
      for (const child of result.children) {
        expect(child.x).toBeGreaterThanOrEqual(result.x);
        expect(child.y).toBeGreaterThanOrEqual(result.y);

        // Children should be within parent bounds
        expect(child.x + child.width).toBeLessThanOrEqual(result.x + result.width);
        expect(child.y + child.height).toBeLessThanOrEqual(result.y + result.height);
      }
    });

    it('should preserve relative positioning of nested children in grid layout', () => {
      const tree = createTestTree('Root', [
        createTestTree('Child 1'),
        createTestTree('Child 2'),
        createTestTree('Child 3'),
        createTestTree('Child 4'),
      ]);

      const layoutConfig: LayoutConfig = {
        ...SPACING_PRESETS.normal,
        childColumns: 2,
        childNodeWidth: 120,
      };

      const viewportCenter = { x: 800, y: 600 };
      const result = layoutAdvancedAddSelection(tree, viewportCenter, 'normal', layoutConfig);

      // Root at (100, 100)
      expect(result.x).toBe(100);
      expect(result.y).toBe(100);

      // All children should have valid positions inside root
      expect(result.children.length).toBe(4);
      for (const child of result.children) {
        expect(child.x).toBeGreaterThanOrEqual(result.x);
        expect(child.y).toBeGreaterThanOrEqual(result.y);
      }
    });
  });
});
