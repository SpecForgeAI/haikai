/**
 * Tests for Grid Layout Algorithm
 *
 * Task Group 2: Grid Layout Algorithm Layer
 * Tests for measureWithGrid(), assignPositionsWithGrid(), and grid-aware layoutAdvancedAddSelection().
 */

import {
  measureWithGrid,
  assignPositionsWithGrid,
  layoutAdvancedAddSelection,
  LAYOUT_MIN_NODE_WIDTH,
  LAYOUT_MIN_NODE_HEIGHT,
  LAYOUT_DEFAULT_FONT_SIZE,
} from '../utils/compoundLayout';
import { LayoutTreeNode, LayoutConfig, DEFAULT_LAYOUT_CONFIG, SPACING_PRESETS } from '../types/advancedAdd';

describe('Grid Layout Algorithm', () => {
  // Test 2.1: measureWithGrid calculates grid dimensions correctly
  describe('measureWithGrid', () => {
    it('should calculate correct dimensions for leaf nodes (no children)', () => {
      const leafNode: LayoutTreeNode = {
        id: 'leaf-1',
        type: 'SERVICE',
        label: 'Test Service',
        children: [],
      };

      const config: LayoutConfig = {
        ...SPACING_PRESETS.normal,
        childColumns: 1,
        childNodeWidth: 160,
      };

      const measured = measureWithGrid(leafNode, config);

      expect(measured.id).toBe('leaf-1');
      expect(measured.type).toBe('SERVICE');
      expect(measured.measuredWidth).toBeGreaterThanOrEqual(LAYOUT_MIN_NODE_WIDTH);
      expect(measured.measuredHeight).toBeGreaterThan(0);
      expect(measured.children).toHaveLength(0);
    });

    it('should calculate correct dimensions for single-column layout', () => {
      const parentNode: LayoutTreeNode = {
        id: 'parent-1',
        type: 'APPLICATION',
        label: 'Test App',
        children: [
          { id: 'child-1', type: 'SERVICE', label: 'Service 1', children: [] },
          { id: 'child-2', type: 'SERVICE', label: 'Service 2', children: [] },
        ],
      };

      const config: LayoutConfig = {
        ...SPACING_PRESETS.normal,
        childColumns: 1,
        childNodeWidth: 160,
      };

      const measured = measureWithGrid(parentNode, config);

      // Parent should be at least as wide as child + padding
      expect(measured.measuredWidth).toBeGreaterThanOrEqual(160 + 2 * config.paddingX);
      // Parent should be tall enough for label + 2 children stacked
      expect(measured.children).toHaveLength(2);
    });

    it('should calculate correct dimensions for multi-column layout', () => {
      const parentNode: LayoutTreeNode = {
        id: 'parent-1',
        type: 'APPLICATION',
        label: 'Test App',
        children: [
          { id: 'child-1', type: 'SERVICE', label: 'Service 1', children: [] },
          { id: 'child-2', type: 'SERVICE', label: 'Service 2', children: [] },
          { id: 'child-3', type: 'SERVICE', label: 'Service 3', children: [] },
          { id: 'child-4', type: 'SERVICE', label: 'Service 4', children: [] },
        ],
      };

      const config: LayoutConfig = {
        ...SPACING_PRESETS.normal,
        childColumns: 2,
        childNodeWidth: 120,
      };

      const measured = measureWithGrid(parentNode, config);

      // With 2 columns and 4 children, we should have 2 rows
      // Width should accommodate 2 columns with gaps
      const expectedMinWidth = 2 * 120 + config.paddingX + 2 * config.paddingX;
      expect(measured.measuredWidth).toBeGreaterThanOrEqual(expectedMinWidth);
    });

    it('should handle 3 children in 2 columns (uneven grid)', () => {
      const parentNode: LayoutTreeNode = {
        id: 'parent-1',
        type: 'APPLICATION',
        label: 'Test App',
        children: [
          { id: 'child-1', type: 'SERVICE', label: 'Service 1', children: [] },
          { id: 'child-2', type: 'SERVICE', label: 'Service 2', children: [] },
          { id: 'child-3', type: 'SERVICE', label: 'Service 3', children: [] },
        ],
      };

      const config: LayoutConfig = {
        ...SPACING_PRESETS.normal,
        childColumns: 2,
        childNodeWidth: 120,
      };

      const measured = measureWithGrid(parentNode, config);

      // With 3 children in 2 columns, we get ceil(3/2) = 2 rows
      expect(measured.children).toHaveLength(3);
    });
  });

  // Test 2.2: assignPositionsWithGrid positions children in grid pattern
  describe('assignPositionsWithGrid', () => {
    it('should position children in single column layout', () => {
      const parentNode: LayoutTreeNode = {
        id: 'parent-1',
        type: 'APPLICATION',
        label: 'App',
        children: [
          { id: 'child-1', type: 'SERVICE', label: 'Svc 1', children: [] },
          { id: 'child-2', type: 'SERVICE', label: 'Svc 2', children: [] },
        ],
      };

      const config: LayoutConfig = {
        ...SPACING_PRESETS.normal,
        childColumns: 1,
        childNodeWidth: 160,
      };

      const measured = measureWithGrid(parentNode, config);
      const layout = assignPositionsWithGrid(measured, 100, 100, config);

      // Children should be stacked vertically
      expect(layout.children).toHaveLength(2);
      expect(layout.children[0].x).toBe(layout.children[1].x);
      expect(layout.children[0].y).toBeLessThan(layout.children[1].y);
    });

    it('should position children in 2-column grid', () => {
      const parentNode: LayoutTreeNode = {
        id: 'parent-1',
        type: 'APPLICATION',
        label: 'App',
        children: [
          { id: 'child-1', type: 'SERVICE', label: 'Svc 1', children: [] },
          { id: 'child-2', type: 'SERVICE', label: 'Svc 2', children: [] },
          { id: 'child-3', type: 'SERVICE', label: 'Svc 3', children: [] },
          { id: 'child-4', type: 'SERVICE', label: 'Svc 4', children: [] },
        ],
      };

      const config: LayoutConfig = {
        ...SPACING_PRESETS.normal,
        childColumns: 2,
        childNodeWidth: 120,
      };

      const measured = measureWithGrid(parentNode, config);
      const layout = assignPositionsWithGrid(measured, 0, 0, config);

      // Children 1 and 2 should be on same row (same Y)
      expect(layout.children[0].y).toBe(layout.children[1].y);
      // Children 3 and 4 should be on same row (same Y)
      expect(layout.children[2].y).toBe(layout.children[3].y);
      // Row 1 should be above Row 2
      expect(layout.children[0].y).toBeLessThan(layout.children[2].y);
      // Children in same row should have different X
      expect(layout.children[0].x).toBeLessThan(layout.children[1].x);
    });

    it('should center children within grid cells', () => {
      const parentNode: LayoutTreeNode = {
        id: 'parent-1',
        type: 'APPLICATION',
        label: 'App',
        children: [
          { id: 'child-1', type: 'SERVICE', label: 'Svc 1', children: [] },
        ],
      };

      const config: LayoutConfig = {
        ...SPACING_PRESETS.normal,
        childColumns: 1,
        childNodeWidth: 200,
      };

      const measured = measureWithGrid(parentNode, config);
      const layout = assignPositionsWithGrid(measured, 0, 0, config);

      // Child should be centered within parent's inner area
      const parentInnerWidth = layout.width - 2 * config.paddingX;
      const childWidth = layout.children[0].width;
      const expectedX = config.paddingX + (parentInnerWidth - childWidth) / 2;

      expect(layout.children[0].x).toBe(expectedX);
    });
  });

  // Test 2.3: layoutAdvancedAddSelection with grid layout config
  describe('layoutAdvancedAddSelection with grid config', () => {
    it('should use grid layout when childColumns > 1', () => {
      const tree: LayoutTreeNode = {
        id: 'root',
        type: 'APPLICATION',
        label: 'Root App',
        children: [
          { id: 'c1', type: 'SERVICE', label: 'S1', children: [] },
          { id: 'c2', type: 'SERVICE', label: 'S2', children: [] },
          { id: 'c3', type: 'SERVICE', label: 'S3', children: [] },
        ],
      };

      const viewport = { x: 500, y: 400 };
      const layoutConfig: LayoutConfig = {
        ...SPACING_PRESETS.normal,
        childColumns: 3,
        childNodeWidth: 100,
      };

      const result = layoutAdvancedAddSelection(tree, viewport, 'normal', layoutConfig);

      // All 3 children should be on the same row (same Y) in 3-column layout
      expect(result.children[0].y).toBe(result.children[1].y);
      expect(result.children[1].y).toBe(result.children[2].y);
    });

    it('should fall back to single column when childColumns is 1', () => {
      const tree: LayoutTreeNode = {
        id: 'root',
        type: 'APPLICATION',
        label: 'Root App',
        children: [
          { id: 'c1', type: 'SERVICE', label: 'S1', children: [] },
          { id: 'c2', type: 'SERVICE', label: 'S2', children: [] },
        ],
      };

      const viewport = { x: 500, y: 400 };
      const layoutConfig: LayoutConfig = {
        ...SPACING_PRESETS.normal,
        childColumns: 1,
        childNodeWidth: 160,
      };

      const result = layoutAdvancedAddSelection(tree, viewport, 'normal', layoutConfig);

      // Children should be stacked vertically
      expect(result.children[0].x).toBe(result.children[1].x);
      expect(result.children[0].y).toBeLessThan(result.children[1].y);
    });

    it('should respect childNodeWidth when using grid layout (childColumns > 1)', () => {
      const tree: LayoutTreeNode = {
        id: 'root',
        type: 'APPLICATION',
        label: 'Root App',
        children: [
          { id: 'c1', type: 'SERVICE', label: 'Short', children: [] },
          { id: 'c2', type: 'SERVICE', label: 'Also Short', children: [] },
        ],
      };

      const viewport = { x: 500, y: 400 };
      const layoutConfig: LayoutConfig = {
        ...SPACING_PRESETS.normal,
        childColumns: 2, // Grid layout is triggered when childColumns > 1
        childNodeWidth: 250,
      };

      const result = layoutAdvancedAddSelection(tree, viewport, 'normal', layoutConfig);

      // Child width should be at least childNodeWidth (250px) when using grid layout
      expect(result.children[0].width).toBeGreaterThanOrEqual(250);
      expect(result.children[1].width).toBeGreaterThanOrEqual(250);
    });
  });

  // Test 2.4: Edge cases for grid layout
  describe('grid layout edge cases', () => {
    it('should handle empty children array', () => {
      const leafNode: LayoutTreeNode = {
        id: 'leaf',
        type: 'SERVICE',
        label: 'Leaf Service',
        children: [],
      };

      const config: LayoutConfig = {
        ...SPACING_PRESETS.normal,
        childColumns: 2,
        childNodeWidth: 160,
      };

      const measured = measureWithGrid(leafNode, config);
      const layout = assignPositionsWithGrid(measured, 0, 0, config);

      expect(layout.children).toHaveLength(0);
    });

    it('should handle single child in multi-column layout', () => {
      const parentNode: LayoutTreeNode = {
        id: 'parent',
        type: 'APPLICATION',
        label: 'App',
        children: [
          { id: 'only-child', type: 'SERVICE', label: 'Only', children: [] },
        ],
      };

      const config: LayoutConfig = {
        ...SPACING_PRESETS.normal,
        childColumns: 5,
        childNodeWidth: 100,
      };

      const measured = measureWithGrid(parentNode, config);
      const layout = assignPositionsWithGrid(measured, 0, 0, config);

      // Should work without error and have one child
      expect(layout.children).toHaveLength(1);
    });

    it('should handle nested containers with grid layout', () => {
      const tree: LayoutTreeNode = {
        id: 'root',
        type: 'APPLICATION',
        label: 'Root',
        children: [
          {
            id: 'container',
            type: 'APP_COMPONENT',
            label: 'Component',
            children: [
              { id: 'leaf1', type: 'SERVICE', label: 'Svc 1', children: [] },
              { id: 'leaf2', type: 'SERVICE', label: 'Svc 2', children: [] },
            ],
          },
        ],
      };

      const config: LayoutConfig = {
        ...SPACING_PRESETS.normal,
        childColumns: 2,
        childNodeWidth: 120,
      };

      const measured = measureWithGrid(tree, config);
      const layout = assignPositionsWithGrid(measured, 0, 0, config);

      // Root should have container child
      expect(layout.children).toHaveLength(1);
      // Container should have 2 leaves in grid
      expect(layout.children[0].children).toHaveLength(2);
    });
  });
});
