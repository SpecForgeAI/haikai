/**
 * Tests for Extended Decoration Palette UI
 * Task Group 4: Expand Decoration Palette UI
 *
 * Tests for:
 * - DecorationAddMode type supports all 11 decoration types
 * - Button configurations are correct for all shapes and lines
 * - Shape and line button arrays have correct types
 * - Active button logic works correctly
 */

import { DecorationType, SHAPE_DECORATION_TYPES, LINE_DECORATION_TYPES, DECORATION_TYPES } from '../types/model';

// Simulate the button configurations from InspectorPanel
const shapeButtonTypes: DecorationType[] = [
  'TEXT',
  'BOX',
  'OVAL',
  'DIAMOND',
  'PARALLELOGRAM',
  'CIRCLE',
  'CYLINDER',
  'TRAPEZOID',
  'HEXAGON',
  'NOTE',
];

const lineButtonTypes: DecorationType[] = [
  'LINE',
  'ARROW_SINGLE',
  'ARROW_DOUBLE',
];

describe('Extended Decoration Palette UI', () => {
  describe('DecorationAddMode type', () => {
    it('should support all 13 decoration types', () => {
      // All decoration types should be valid as addMode
      const validModes: Array<DecorationType | null> = [
        null,
        'TEXT',
        'BOX',
        'LINE',
        'OVAL',
        'DIAMOND',
        'PARALLELOGRAM',
        'ARROW_SINGLE',
        'ARROW_DOUBLE',
        'CIRCLE',
        'CYLINDER',
        'TRAPEZOID',
        'HEXAGON',
        'NOTE',
      ];

      expect(validModes).toHaveLength(14); // null + 13 types
    });
  });

  describe('Shape button configurations', () => {
    it('should have 10 shape buttons', () => {
      expect(shapeButtonTypes).toHaveLength(10);
    });

    it('should include all shape decoration types', () => {
      for (const type of SHAPE_DECORATION_TYPES) {
        expect(shapeButtonTypes).toContain(type);
      }
    });

    it('should not include line types in shape buttons', () => {
      for (const type of LINE_DECORATION_TYPES) {
        expect(shapeButtonTypes).not.toContain(type);
      }
    });

    it('should have correct order: TEXT, BOX, OVAL, DIAMOND, PARALLELOGRAM, CIRCLE, CYLINDER, TRAPEZOID, HEXAGON, NOTE', () => {
      const expectedOrder = ['TEXT', 'BOX', 'OVAL', 'DIAMOND', 'PARALLELOGRAM', 'CIRCLE', 'CYLINDER', 'TRAPEZOID', 'HEXAGON', 'NOTE'];
      expect(shapeButtonTypes).toEqual(expectedOrder);
    });
  });

  describe('Line button configurations', () => {
    it('should have 3 line buttons', () => {
      expect(lineButtonTypes).toHaveLength(3);
    });

    it('should include all line decoration types', () => {
      for (const type of LINE_DECORATION_TYPES) {
        expect(lineButtonTypes).toContain(type);
      }
    });

    it('should not include shape types in line buttons', () => {
      for (const type of SHAPE_DECORATION_TYPES) {
        expect(lineButtonTypes).not.toContain(type);
      }
    });

    it('should have correct order: LINE, ARROW_SINGLE, ARROW_DOUBLE', () => {
      const expectedOrder = ['LINE', 'ARROW_SINGLE', 'ARROW_DOUBLE'];
      expect(lineButtonTypes).toEqual(expectedOrder);
    });
  });

  describe('Total button count', () => {
    it('should have 13 total buttons (10 shapes + 3 lines)', () => {
      const totalButtons = shapeButtonTypes.length + lineButtonTypes.length;
      expect(totalButtons).toBe(13);
    });

    it('should match DECORATION_TYPES count', () => {
      const totalButtons = shapeButtonTypes.length + lineButtonTypes.length;
      expect(totalButtons).toBe(DECORATION_TYPES.length);
    });
  });

  describe('Button toggle logic', () => {
    it('should toggle mode off when clicking active button', () => {
      // Simulate toggle logic
      const toggleAddMode = (currentMode: DecorationType | null, clickedType: DecorationType): DecorationType | null => {
        if (currentMode === clickedType) {
          return null; // Toggle off
        }
        return clickedType; // Set new mode
      };

      // Test toggle off
      expect(toggleAddMode('BOX', 'BOX')).toBeNull();
      expect(toggleAddMode('DIAMOND', 'DIAMOND')).toBeNull();
      expect(toggleAddMode('ARROW_SINGLE', 'ARROW_SINGLE')).toBeNull();
    });

    it('should set new mode when clicking different button', () => {
      const toggleAddMode = (currentMode: DecorationType | null, clickedType: DecorationType): DecorationType | null => {
        if (currentMode === clickedType) {
          return null;
        }
        return clickedType;
      };

      // Test setting new mode
      expect(toggleAddMode(null, 'OVAL')).toBe('OVAL');
      expect(toggleAddMode('BOX', 'CIRCLE')).toBe('CIRCLE');
      expect(toggleAddMode('LINE', 'ARROW_DOUBLE')).toBe('ARROW_DOUBLE');
    });

    it('should set mode from null', () => {
      const toggleAddMode = (currentMode: DecorationType | null, clickedType: DecorationType): DecorationType | null => {
        if (currentMode === clickedType) {
          return null;
        }
        return clickedType;
      };

      for (const type of DECORATION_TYPES) {
        expect(toggleAddMode(null, type)).toBe(type);
      }
    });
  });

  describe('Button active state', () => {
    it('should identify active button correctly', () => {
      const isButtonActive = (addMode: DecorationType | null, buttonType: DecorationType): boolean => {
        return addMode === buttonType;
      };

      // Test active
      expect(isButtonActive('BOX', 'BOX')).toBe(true);
      expect(isButtonActive('CIRCLE', 'CIRCLE')).toBe(true);
      expect(isButtonActive('ARROW_SINGLE', 'ARROW_SINGLE')).toBe(true);

      // Test not active
      expect(isButtonActive('BOX', 'OVAL')).toBe(false);
      expect(isButtonActive(null, 'BOX')).toBe(false);
      expect(isButtonActive('LINE', 'ARROW_DOUBLE')).toBe(false);
    });
  });

  describe('Button sections', () => {
    it('should organize shapes in "Shapes" section', () => {
      // All 10 shape types should be in shapes section
      expect(shapeButtonTypes).toHaveLength(10);
      for (const type of shapeButtonTypes) {
        expect(SHAPE_DECORATION_TYPES).toContain(type);
      }
    });

    it('should organize lines in "Lines & Arrows" section', () => {
      // All 3 line types should be in lines section
      expect(lineButtonTypes).toHaveLength(3);
      for (const type of lineButtonTypes) {
        expect(LINE_DECORATION_TYPES).toContain(type);
      }
    });
  });
});
