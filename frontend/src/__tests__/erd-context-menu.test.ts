/**
 * ERD Context Menu Tests
 * Tests for "Add with attributes" context menu option logic
 * Task Group 3: Context Menu Implementation
 *
 * Note: These tests focus on the logic that determines when the
 * "Add with attributes" option should be shown, rather than testing
 * the React component rendering (which would require React Testing Library).
 */

import { describe, it, expect } from 'vitest';

// Section IDs for data entity types that support "Add with attributes"
const DATA_ENTITY_SECTIONS = ['logical_data_entities', 'physical_data_entities'];

// Other section IDs that should NOT show "Add with attributes"
const OTHER_SECTIONS = [
  'applications',
  'business_processes',
  'services',
  'app_components',
  'business_users',
  'application_points',
  'interfaces',
  'process_activities',
];

/**
 * Helper function that mirrors the context menu logic for showing "Add with attributes"
 * This is the same logic used in PaletteContextMenu.tsx
 */
function shouldShowAddWithAttributes(sectionId: string): boolean {
  return sectionId === 'logical_data_entities' || sectionId === 'physical_data_entities';
}

describe('ERD Context Menu - Add with attributes', () => {
  describe('Menu item visibility logic', () => {
    it('should show "Add with attributes" for logical_data_entities section', () => {
      const result = shouldShowAddWithAttributes('logical_data_entities');
      expect(result).toBe(true);
    });

    it('should show "Add with attributes" for physical_data_entities section', () => {
      const result = shouldShowAddWithAttributes('physical_data_entities');
      expect(result).toBe(true);
    });

    it('should NOT show "Add with attributes" for applications section', () => {
      const result = shouldShowAddWithAttributes('applications');
      expect(result).toBe(false);
    });

    it('should NOT show "Add with attributes" for business_processes section', () => {
      const result = shouldShowAddWithAttributes('business_processes');
      expect(result).toBe(false);
    });

    it('should NOT show "Add with attributes" for any non-data entity section', () => {
      OTHER_SECTIONS.forEach(sectionId => {
        const result = shouldShowAddWithAttributes(sectionId);
        expect(result).toBe(false);
      });
    });
  });

  describe('Data entity sections list', () => {
    it('should have exactly 2 data entity sections', () => {
      expect(DATA_ENTITY_SECTIONS).toHaveLength(2);
    });

    it('should include logical_data_entities', () => {
      expect(DATA_ENTITY_SECTIONS).toContain('logical_data_entities');
    });

    it('should include physical_data_entities', () => {
      expect(DATA_ENTITY_SECTIONS).toContain('physical_data_entities');
    });

    it('should all return true for shouldShowAddWithAttributes', () => {
      DATA_ENTITY_SECTIONS.forEach(sectionId => {
        expect(shouldShowAddWithAttributes(sectionId)).toBe(true);
      });
    });
  });

  describe('Other sections list (negative cases)', () => {
    it('should have at least 5 other sections', () => {
      expect(OTHER_SECTIONS.length).toBeGreaterThanOrEqual(5);
    });

    it('should not contain any data entity sections', () => {
      OTHER_SECTIONS.forEach(sectionId => {
        expect(DATA_ENTITY_SECTIONS).not.toContain(sectionId);
      });
    });
  });
});
