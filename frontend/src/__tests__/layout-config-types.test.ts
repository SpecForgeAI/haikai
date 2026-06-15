/**
 * Tests for Layout Configuration Types
 *
 * Task Group 1: Type Definitions and Constants
 * Tests for LayoutConfig interface, DEFAULT_LAYOUT_CONFIG, and LAYOUT_CONSTRAINTS.
 */

import {
  LayoutConfig,
  DEFAULT_LAYOUT_CONFIG,
  LAYOUT_CONSTRAINTS,
  SpacingConfig,
  AdvancedAddResult,
} from '../types/advancedAdd';

describe('Layout Configuration Types', () => {
  // Test 1.1: LayoutConfig interface structure
  describe('LayoutConfig interface', () => {
    it('should extend SpacingConfig with childColumns and childNodeWidth', () => {
      // Create a valid LayoutConfig object
      const config: LayoutConfig = {
        paddingX: 10,
        paddingY: 10,
        childVerticalGap: 7,
        childColumns: 3,
        childNodeWidth: 200,
      };

      // Verify all properties exist
      expect(config.paddingX).toBe(10);
      expect(config.paddingY).toBe(10);
      expect(config.childVerticalGap).toBe(7);
      expect(config.childColumns).toBe(3);
      expect(config.childNodeWidth).toBe(200);
    });

    it('should be assignable from SpacingConfig with additional fields', () => {
      const spacingConfig: SpacingConfig = {
        paddingX: 20,
        paddingY: 20,
        childVerticalGap: 10,
      };

      // Extend SpacingConfig to LayoutConfig
      const layoutConfig: LayoutConfig = {
        ...spacingConfig,
        childColumns: 2,
        childNodeWidth: 160,
      };

      expect(layoutConfig.paddingX).toBe(20);
      expect(layoutConfig.childColumns).toBe(2);
    });
  });

  // Test 1.2: DEFAULT_LAYOUT_CONFIG constant
  describe('DEFAULT_LAYOUT_CONFIG constant', () => {
    it('should have default values matching spec requirements', () => {
      expect(DEFAULT_LAYOUT_CONFIG).toBeDefined();

      // Verify inherited SpacingConfig defaults
      expect(DEFAULT_LAYOUT_CONFIG.paddingX).toBe(10);
      expect(DEFAULT_LAYOUT_CONFIG.paddingY).toBe(10);
      expect(DEFAULT_LAYOUT_CONFIG.childVerticalGap).toBe(7);

      // Verify new layout defaults
      expect(DEFAULT_LAYOUT_CONFIG.childColumns).toBe(1);
      expect(DEFAULT_LAYOUT_CONFIG.childNodeWidth).toBe(160);
    });

    it('should be usable as LayoutConfig type', () => {
      // This should compile without type errors
      const config: LayoutConfig = DEFAULT_LAYOUT_CONFIG;
      expect(config.childColumns).toBe(1);
    });
  });

  // Test 1.3: LAYOUT_CONSTRAINTS constant
  describe('LAYOUT_CONSTRAINTS constant', () => {
    it('should define childColumns constraints (min: 1, max: 10)', () => {
      expect(LAYOUT_CONSTRAINTS.childColumns).toBeDefined();
      expect(LAYOUT_CONSTRAINTS.childColumns.min).toBe(1);
      expect(LAYOUT_CONSTRAINTS.childColumns.max).toBe(10);
    });

    it('should define childNodeWidth constraints (min: 10, max: 1000)', () => {
      expect(LAYOUT_CONSTRAINTS.childNodeWidth).toBeDefined();
      expect(LAYOUT_CONSTRAINTS.childNodeWidth.min).toBe(10);
      expect(LAYOUT_CONSTRAINTS.childNodeWidth.max).toBe(1000);
    });
  });

  // Test 1.4: AdvancedAddResult with new optional fields
  describe('AdvancedAddResult with childColumns and childNodeWidth', () => {
    it('should accept optional childColumns field', () => {
      const result: AdvancedAddResult = {
        treeData: {
          key: 'root',
          label: 'Test',
          entityType: 'APPLICATION',
          entityId: 'app-1',
          entityName: 'Test App',
          isRoot: true,
          children: [],
        },
        selectedKeys: new Set(['root']),
        selections: [],
        childColumns: 3,
      };

      expect(result.childColumns).toBe(3);
    });

    it('should accept optional childNodeWidth field', () => {
      const result: AdvancedAddResult = {
        treeData: {
          key: 'root',
          label: 'Test',
          entityType: 'APPLICATION',
          entityId: 'app-1',
          entityName: 'Test App',
          isRoot: true,
          children: [],
        },
        selectedKeys: new Set(['root']),
        selections: [],
        childNodeWidth: 200,
      };

      expect(result.childNodeWidth).toBe(200);
    });

    it('should work without new optional fields for backward compatibility', () => {
      const result: AdvancedAddResult = {
        treeData: {
          key: 'root',
          label: 'Test',
          entityType: 'APPLICATION',
          entityId: 'app-1',
          entityName: 'Test App',
          isRoot: true,
          children: [],
        },
        selectedKeys: new Set(['root']),
        selections: [],
      };

      // Should be valid without childColumns and childNodeWidth
      expect(result.childColumns).toBeUndefined();
      expect(result.childNodeWidth).toBeUndefined();
    });
  });
});
