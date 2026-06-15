/**
 * Tests for Decoration Factory Functions
 * Task Group 2: Add Factory Functions for New Shapes
 *
 * Tests for:
 * - createOvalDecoration() creates decoration with correct type and dimensions
 * - createDiamondDecoration() creates decoration with correct type
 * - createArrowSingleDecoration() has arrow_end='ARROW', arrow_start='NONE'
 * - createArrowDoubleDecoration() has both arrow_start and arrow_end='ARROW'
 * - All factory functions generate unique IDs
 */

import {
  createDefaultBoxDecoration,
  createDefaultLineDecoration,
  createOvalDecoration,
  createDiamondDecoration,
  createParallelogramDecoration,
  createCircleDecoration,
  createCylinderDecoration,
  createTrapezoidDecoration,
  createHexagonDecoration,
  createArrowSingleDecoration,
  createArrowDoubleDecoration,
  createShapeDecoration,
  createLineTypeDecoration,
  createDecoration,
} from '../utils/decorationUtils';

import { ShapeDecoration, LineDecoration } from '../types/model';

describe('Decoration Factory Functions', () => {
  describe('createOvalDecoration()', () => {
    it('should create decoration with correct type and dimensions', () => {
      const oval = createOvalDecoration(100, 200, 150, 80);

      expect(oval.type).toBe('OVAL');
      expect(oval.pos_x).toBe(100);
      expect(oval.pos_y).toBe(200);
      expect(oval.width).toBe(150);
      expect(oval.height).toBe(80);
    });

    it('should include default styling properties', () => {
      const oval = createOvalDecoration(0, 0, 100, 100);

      expect(oval.background_color).toBeDefined();
      expect(oval.line_color).toBeDefined();
      expect(oval.line_style).toBeDefined();
      expect(oval.text_font_size).toBeDefined();
      expect(oval.z_index).toBeDefined();
    });
  });

  describe('createDiamondDecoration()', () => {
    it('should create decoration with correct type', () => {
      const diamond = createDiamondDecoration(50, 50, 100, 100);

      expect(diamond.type).toBe('DIAMOND');
      expect(diamond.pos_x).toBe(50);
      expect(diamond.pos_y).toBe(50);
      expect(diamond.width).toBe(100);
      expect(diamond.height).toBe(100);
    });

    it('should include default styling properties', () => {
      const diamond = createDiamondDecoration(0, 0, 80, 80);

      expect(diamond.background_color).toBeDefined();
      expect(diamond.line_color).toBeDefined();
      expect(diamond.text_h_align).toBe('CENTER');
      expect(diamond.text_v_align).toBe('MIDDLE');
    });
  });

  describe('createArrowSingleDecoration()', () => {
    it('should have arrow_end=ARROW and arrow_start=NONE', () => {
      const arrow = createArrowSingleDecoration([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ]);

      expect(arrow.type).toBe('ARROW_SINGLE');
      expect(arrow.arrow_start).toBe('NONE');
      expect(arrow.arrow_end).toBe('ARROW');
    });

    it('should preserve line_points', () => {
      const points = [
        { x: 10, y: 20 },
        { x: 50, y: 60 },
        { x: 100, y: 20 },
      ];
      const arrow = createArrowSingleDecoration(points);

      expect(arrow.line_points).toHaveLength(3);
      expect(arrow.line_points[0]).toEqual({ x: 10, y: 20 });
      expect(arrow.line_points[2]).toEqual({ x: 100, y: 20 });
    });
  });

  describe('createArrowDoubleDecoration()', () => {
    it('should have both arrow_start and arrow_end=ARROW', () => {
      const arrow = createArrowDoubleDecoration([
        { x: 0, y: 0 },
        { x: 100, y: 100 },
      ]);

      expect(arrow.type).toBe('ARROW_DOUBLE');
      expect(arrow.arrow_start).toBe('ARROW');
      expect(arrow.arrow_end).toBe('ARROW');
    });
  });

  describe('Unique ID generation', () => {
    it('should generate unique IDs for each decoration', () => {
      const ids = new Set<string>();

      // Create multiple decorations of various types
      ids.add(createDefaultBoxDecoration(0, 0, 100, 100).id);
      ids.add(createDefaultLineDecoration([{ x: 0, y: 0 }]).id);
      ids.add(createOvalDecoration(0, 0, 100, 100).id);
      ids.add(createDiamondDecoration(0, 0, 100, 100).id);
      ids.add(createParallelogramDecoration(0, 0, 100, 100).id);
      ids.add(createCircleDecoration(0, 0, 50).id);
      ids.add(createCylinderDecoration(0, 0, 100, 100).id);
      ids.add(createTrapezoidDecoration(0, 0, 100, 100).id);
      ids.add(createHexagonDecoration(0, 0, 100, 100).id);
      ids.add(createArrowSingleDecoration([{ x: 0, y: 0 }]).id);
      ids.add(createArrowDoubleDecoration([{ x: 0, y: 0 }]).id);

      // All IDs should be unique
      expect(ids.size).toBe(11);
    });

    it('should include type prefix in ID', () => {
      const box = createDefaultBoxDecoration(0, 0, 100, 100);
      const oval = createOvalDecoration(0, 0, 100, 100);
      const line = createDefaultLineDecoration([{ x: 0, y: 0 }]);
      const arrowSingle = createArrowSingleDecoration([{ x: 0, y: 0 }]);

      expect(box.id).toContain('box');
      expect(oval.id).toContain('oval');
      expect(line.id).toContain('line');
      expect(arrowSingle.id).toContain('arrow_single');
    });
  });

  describe('createParallelogramDecoration()', () => {
    it('should create parallelogram with correct type', () => {
      const para = createParallelogramDecoration(20, 30, 120, 60);

      expect(para.type).toBe('PARALLELOGRAM');
      expect(para.pos_x).toBe(20);
      expect(para.pos_y).toBe(30);
      expect(para.width).toBe(120);
      expect(para.height).toBe(60);
    });
  });

  describe('createCircleDecoration()', () => {
    it('should create circle with diameter based on radius', () => {
      const circle = createCircleDecoration(50, 50, 30);

      expect(circle.type).toBe('CIRCLE');
      expect(circle.pos_x).toBe(50);
      expect(circle.pos_y).toBe(50);
      // Diameter should be 2 * radius
      expect(circle.width).toBe(60);
      expect(circle.height).toBe(60);
    });

    it('should maintain 1:1 aspect ratio', () => {
      const circle = createCircleDecoration(0, 0, 100);

      expect(circle.width).toBe(circle.height);
    });
  });

  describe('createCylinderDecoration()', () => {
    it('should create cylinder with correct type', () => {
      const cylinder = createCylinderDecoration(10, 20, 80, 120);

      expect(cylinder.type).toBe('CYLINDER');
      expect(cylinder.pos_x).toBe(10);
      expect(cylinder.pos_y).toBe(20);
      expect(cylinder.width).toBe(80);
      expect(cylinder.height).toBe(120);
    });
  });

  describe('createTrapezoidDecoration()', () => {
    it('should create trapezoid with correct type', () => {
      const trapezoid = createTrapezoidDecoration(0, 0, 100, 60);

      expect(trapezoid.type).toBe('TRAPEZOID');
      expect(trapezoid.width).toBe(100);
      expect(trapezoid.height).toBe(60);
    });
  });

  describe('createHexagonDecoration()', () => {
    it('should create hexagon with correct type', () => {
      const hexagon = createHexagonDecoration(25, 35, 80, 70);

      expect(hexagon.type).toBe('HEXAGON');
      expect(hexagon.pos_x).toBe(25);
      expect(hexagon.pos_y).toBe(35);
    });
  });

  describe('createShapeDecoration() factory', () => {
    it('should route to correct shape creator', () => {
      const shapes: Array<{ type: ShapeDecoration['type']; expected: string }> = [
        { type: 'BOX', expected: 'BOX' },
        { type: 'OVAL', expected: 'OVAL' },
        { type: 'DIAMOND', expected: 'DIAMOND' },
        { type: 'PARALLELOGRAM', expected: 'PARALLELOGRAM' },
        { type: 'CIRCLE', expected: 'CIRCLE' },
        { type: 'CYLINDER', expected: 'CYLINDER' },
        { type: 'TRAPEZOID', expected: 'TRAPEZOID' },
        { type: 'HEXAGON', expected: 'HEXAGON' },
      ];

      for (const { type, expected } of shapes) {
        const shape = createShapeDecoration(type, 0, 0, 100, 100);
        expect(shape.type).toBe(expected);
      }
    });
  });

  describe('createLineTypeDecoration() factory', () => {
    it('should route to correct line creator', () => {
      const points = [{ x: 0, y: 0 }, { x: 100, y: 100 }];

      const line = createLineTypeDecoration('LINE', points);
      expect(line.type).toBe('LINE');
      expect(line.arrow_end).toBe('NONE');

      const arrowSingle = createLineTypeDecoration('ARROW_SINGLE', points);
      expect(arrowSingle.type).toBe('ARROW_SINGLE');
      expect(arrowSingle.arrow_end).toBe('ARROW');
      expect(arrowSingle.arrow_start).toBe('NONE');

      const arrowDouble = createLineTypeDecoration('ARROW_DOUBLE', points);
      expect(arrowDouble.type).toBe('ARROW_DOUBLE');
      expect(arrowDouble.arrow_start).toBe('ARROW');
      expect(arrowDouble.arrow_end).toBe('ARROW');
    });
  });

  describe('createDecoration() master factory', () => {
    it('should create shape decorations with position/size params', () => {
      const oval = createDecoration('OVAL', {
        pos_x: 10,
        pos_y: 20,
        width: 100,
        height: 50,
      }) as ShapeDecoration;

      expect(oval.type).toBe('OVAL');
      expect(oval.pos_x).toBe(10);
      expect(oval.pos_y).toBe(20);
    });

    it('should create line decorations with points params', () => {
      const arrow = createDecoration('ARROW_SINGLE', {
        line_points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
      }) as LineDecoration;

      expect(arrow.type).toBe('ARROW_SINGLE');
      expect(arrow.line_points).toHaveLength(2);
    });
  });
});
