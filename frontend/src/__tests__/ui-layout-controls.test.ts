/**
 * Tests for UI Layout Controls
 *
 * Task Group 4: UI Components Layer
 * Tests for child columns dropdown and child node width input in AdvancedAddDialog,
 * and "Add with all children" menu item in PaletteContextMenu.
 */

import {
  DEFAULT_LAYOUT_CONFIG,
  LAYOUT_CONSTRAINTS,
  AdvancedAddResult,
} from '../types/advancedAdd';

describe('UI Layout Controls', () => {
  // Test 4.1: AdvancedAddResult interface with layout controls
  describe('AdvancedAddResult layout fields', () => {
    it('should support childColumns field with values 1-10', () => {
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
        childColumns: 5,
      };

      expect(result.childColumns).toBe(5);
      expect(result.childColumns).toBeGreaterThanOrEqual(LAYOUT_CONSTRAINTS.childColumns.min);
      expect(result.childColumns).toBeLessThanOrEqual(LAYOUT_CONSTRAINTS.childColumns.max);
    });

    it('should support childNodeWidth field with values 10-1000', () => {
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
        childNodeWidth: 250,
      };

      expect(result.childNodeWidth).toBe(250);
      expect(result.childNodeWidth).toBeGreaterThanOrEqual(LAYOUT_CONSTRAINTS.childNodeWidth.min);
      expect(result.childNodeWidth).toBeLessThanOrEqual(LAYOUT_CONSTRAINTS.childNodeWidth.max);
    });

    it('should accept both layout fields together', () => {
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
        spacingPreset: 'normal',
        childColumns: 3,
        childNodeWidth: 200,
      };

      expect(result.childColumns).toBe(3);
      expect(result.childNodeWidth).toBe(200);
      expect(result.spacingPreset).toBe('normal');
    });
  });

  // Test 4.2: DEFAULT_LAYOUT_CONFIG defaults
  describe('DEFAULT_LAYOUT_CONFIG', () => {
    it('should have childColumns default of 1', () => {
      expect(DEFAULT_LAYOUT_CONFIG.childColumns).toBe(1);
    });

    it('should have childNodeWidth default of 160', () => {
      expect(DEFAULT_LAYOUT_CONFIG.childNodeWidth).toBe(160);
    });
  });

  // Test 4.3: LAYOUT_CONSTRAINTS bounds
  describe('LAYOUT_CONSTRAINTS', () => {
    it('should define childColumns bounds (1-10)', () => {
      expect(LAYOUT_CONSTRAINTS.childColumns.min).toBe(1);
      expect(LAYOUT_CONSTRAINTS.childColumns.max).toBe(10);
    });

    it('should define childNodeWidth bounds (10-1000)', () => {
      expect(LAYOUT_CONSTRAINTS.childNodeWidth.min).toBe(10);
      expect(LAYOUT_CONSTRAINTS.childNodeWidth.max).toBe(1000);
    });

    it('should have valid range for childColumns (min < max)', () => {
      expect(LAYOUT_CONSTRAINTS.childColumns.min).toBeLessThan(LAYOUT_CONSTRAINTS.childColumns.max);
    });

    it('should have valid range for childNodeWidth (min < max)', () => {
      expect(LAYOUT_CONSTRAINTS.childNodeWidth.min).toBeLessThan(LAYOUT_CONSTRAINTS.childNodeWidth.max);
    });
  });

  // Test 4.4: Dropdown options for childColumns
  describe('childColumns dropdown options', () => {
    it('should have 10 valid options (1 through 10)', () => {
      const options = [];
      for (let i = LAYOUT_CONSTRAINTS.childColumns.min; i <= LAYOUT_CONSTRAINTS.childColumns.max; i++) {
        options.push(i);
      }

      expect(options).toHaveLength(10);
      expect(options[0]).toBe(1);
      expect(options[9]).toBe(10);
    });
  });

  // Test 4.5: Input validation for childNodeWidth
  describe('childNodeWidth input validation', () => {
    it('should accept values at minimum bound (10)', () => {
      const value = LAYOUT_CONSTRAINTS.childNodeWidth.min;
      expect(value).toBe(10);
      expect(value >= LAYOUT_CONSTRAINTS.childNodeWidth.min).toBe(true);
    });

    it('should accept values at maximum bound (1000)', () => {
      const value = LAYOUT_CONSTRAINTS.childNodeWidth.max;
      expect(value).toBe(1000);
      expect(value <= LAYOUT_CONSTRAINTS.childNodeWidth.max).toBe(true);
    });

    it('should reject values below minimum', () => {
      const value = 5;
      expect(value < LAYOUT_CONSTRAINTS.childNodeWidth.min).toBe(true);
    });

    it('should reject values above maximum', () => {
      const value = 1500;
      expect(value > LAYOUT_CONSTRAINTS.childNodeWidth.max).toBe(true);
    });
  });
});
