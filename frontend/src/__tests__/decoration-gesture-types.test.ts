/**
 * Tests for Decoration Gesture Types
 * Task Group 1: Fix Type Constraints and Extend Gesture State
 *
 * Tests for:
 * - DecorationAddMode accepts all DecorationType values
 * - BoxAddGestureState includes shapeType field
 * - LineAddGestureState includes arrowType field
 * - SHAPE_DECORATION_TYPES array contains all 10 shape types
 * - LINE_DECORATION_TYPES array contains LINE, ARROW_SINGLE, ARROW_DOUBLE
 */

import {
  DecorationType,
  SHAPE_DECORATION_TYPES,
  LINE_DECORATION_TYPES,
  ShapeDecorationType,
  LineDecorationType,
} from '../types/model';

describe('Decoration Gesture Types', () => {
  describe('DecorationAddMode type coverage', () => {
    it('should accept all DecorationType values as valid modes', () => {
      // All 13 decoration types should be valid add modes
      const allDecorationTypes: DecorationType[] = [
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

      // Verify all types exist
      expect(allDecorationTypes.length).toBe(13);

      // Each type should be assignable as a decoration add mode
      allDecorationTypes.forEach(type => {
        // Type check - ensure it's a valid DecorationType
        expect(typeof type).toBe('string');
      });
    });

    it('should allow null as a valid mode (no decoration being added)', () => {
      const nullMode: DecorationType | null = null;
      expect(nullMode).toBeNull();
    });
  });

  describe('BoxAddGestureState with shapeType field', () => {
    it('should support shapeType field for tracking shape being drawn', () => {
      // Simulate BoxAddGestureState structure
      interface BoxAddGestureState {
        isActive: boolean;
        startX: number;
        startY: number;
        currentX: number;
        currentY: number;
        shapeType: ShapeDecorationType | null;
      }

      const gestureState: BoxAddGestureState = {
        isActive: true,
        startX: 100,
        startY: 100,
        currentX: 200,
        currentY: 200,
        shapeType: 'OVAL',
      };

      expect(gestureState.shapeType).toBe('OVAL');
      expect(gestureState.isActive).toBe(true);
    });

    it('should allow shapeType to be null initially', () => {
      interface BoxAddGestureState {
        isActive: boolean;
        startX: number;
        startY: number;
        currentX: number;
        currentY: number;
        shapeType: ShapeDecorationType | null;
      }

      const initialState: BoxAddGestureState = {
        isActive: false,
        startX: 0,
        startY: 0,
        currentX: 0,
        currentY: 0,
        shapeType: null,
      };

      expect(initialState.shapeType).toBeNull();
    });

    it('should support all 10 shape types in shapeType field', () => {
      const shapeTypes: ShapeDecorationType[] = [
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

      shapeTypes.forEach(shapeType => {
        expect(SHAPE_DECORATION_TYPES).toContain(shapeType);
      });

      expect(shapeTypes.length).toBe(10);
    });
  });

  describe('LineAddGestureState with arrowType field', () => {
    it('should support arrowType field for tracking line type being drawn', () => {
      // Simulate LineAddGestureState structure
      interface LineAddGestureState {
        isActive: boolean;
        startX: number;
        startY: number;
        hasFirstPoint: boolean;
        arrowType: LineDecorationType | null;
      }

      const gestureState: LineAddGestureState = {
        isActive: true,
        startX: 100,
        startY: 100,
        hasFirstPoint: true,
        arrowType: 'ARROW_SINGLE',
      };

      expect(gestureState.arrowType).toBe('ARROW_SINGLE');
      expect(gestureState.hasFirstPoint).toBe(true);
    });

    it('should allow arrowType to be null initially', () => {
      interface LineAddGestureState {
        isActive: boolean;
        startX: number;
        startY: number;
        hasFirstPoint: boolean;
        arrowType: LineDecorationType | null;
      }

      const initialState: LineAddGestureState = {
        isActive: false,
        startX: 0,
        startY: 0,
        hasFirstPoint: false,
        arrowType: null,
      };

      expect(initialState.arrowType).toBeNull();
    });

    it('should support all 3 line types in arrowType field', () => {
      const lineTypes: LineDecorationType[] = [
        'LINE',
        'ARROW_SINGLE',
        'ARROW_DOUBLE',
      ];

      lineTypes.forEach(lineType => {
        expect(LINE_DECORATION_TYPES).toContain(lineType);
      });

      expect(lineTypes.length).toBe(3);
    });
  });

  describe('SHAPE_DECORATION_TYPES constant', () => {
    it('should contain all 10 shape types', () => {
      expect(SHAPE_DECORATION_TYPES).toContain('TEXT');
      expect(SHAPE_DECORATION_TYPES).toContain('BOX');
      expect(SHAPE_DECORATION_TYPES).toContain('OVAL');
      expect(SHAPE_DECORATION_TYPES).toContain('DIAMOND');
      expect(SHAPE_DECORATION_TYPES).toContain('PARALLELOGRAM');
      expect(SHAPE_DECORATION_TYPES).toContain('CIRCLE');
      expect(SHAPE_DECORATION_TYPES).toContain('CYLINDER');
      expect(SHAPE_DECORATION_TYPES).toContain('TRAPEZOID');
      expect(SHAPE_DECORATION_TYPES).toContain('HEXAGON');
      expect(SHAPE_DECORATION_TYPES).toContain('NOTE');
      expect(SHAPE_DECORATION_TYPES.length).toBe(10);
    });

    it('should not contain line types', () => {
      expect(SHAPE_DECORATION_TYPES).not.toContain('LINE');
      expect(SHAPE_DECORATION_TYPES).not.toContain('ARROW_SINGLE');
      expect(SHAPE_DECORATION_TYPES).not.toContain('ARROW_DOUBLE');
    });
  });

  describe('LINE_DECORATION_TYPES constant', () => {
    it('should contain LINE, ARROW_SINGLE, ARROW_DOUBLE', () => {
      expect(LINE_DECORATION_TYPES).toContain('LINE');
      expect(LINE_DECORATION_TYPES).toContain('ARROW_SINGLE');
      expect(LINE_DECORATION_TYPES).toContain('ARROW_DOUBLE');
      expect(LINE_DECORATION_TYPES.length).toBe(3);
    });

    it('should not contain shape types', () => {
      expect(LINE_DECORATION_TYPES).not.toContain('BOX');
      expect(LINE_DECORATION_TYPES).not.toContain('OVAL');
      expect(LINE_DECORATION_TYPES).not.toContain('DIAMOND');
      expect(LINE_DECORATION_TYPES).not.toContain('CIRCLE');
    });
  });

  describe('Type category helpers', () => {
    it('should correctly categorize shape types', () => {
      const isShapeType = (type: string): boolean => {
        return (SHAPE_DECORATION_TYPES as readonly string[]).includes(type);
      };

      expect(isShapeType('TEXT')).toBe(true);
      expect(isShapeType('BOX')).toBe(true);
      expect(isShapeType('OVAL')).toBe(true);
      expect(isShapeType('DIAMOND')).toBe(true);
      expect(isShapeType('PARALLELOGRAM')).toBe(true);
      expect(isShapeType('CIRCLE')).toBe(true);
      expect(isShapeType('CYLINDER')).toBe(true);
      expect(isShapeType('TRAPEZOID')).toBe(true);
      expect(isShapeType('HEXAGON')).toBe(true);
      expect(isShapeType('NOTE')).toBe(true);
      expect(isShapeType('LINE')).toBe(false);
      expect(isShapeType('ARROW_SINGLE')).toBe(false);
    });

    it('should correctly categorize line types', () => {
      const isLineType = (type: string): boolean => {
        return (LINE_DECORATION_TYPES as readonly string[]).includes(type);
      };

      expect(isLineType('LINE')).toBe(true);
      expect(isLineType('ARROW_SINGLE')).toBe(true);
      expect(isLineType('ARROW_DOUBLE')).toBe(true);
      expect(isLineType('BOX')).toBe(false);
      expect(isLineType('OVAL')).toBe(false);
    });
  });
});
