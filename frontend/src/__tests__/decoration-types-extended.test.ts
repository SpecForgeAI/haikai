/**
 * Tests for Extended Decoration Type System
 * Task Group 1: Extend Decoration Type System
 *
 * Tests for:
 * - DecorationType includes all 11 types
 * - ShapeDecoration interface has required fields
 * - LineDecoration supports LINE, ARROW_SINGLE, ARROW_DOUBLE
 * - Type guards: isShapeDecoration(), isLineBasedDecoration()
 * - Decoration union type includes all shapes and lines
 */

import {
  DecorationType,
  ShapeDecoration,
  LineDecoration,
  Decoration,
  DECORATION_TYPES,
  SHAPE_DECORATION_TYPES,
  LINE_DECORATION_TYPES,
} from '../types/model';

import {
  isShapeDecoration,
  isLineBasedDecoration,
} from '../utils/decorationUtils';

describe('Extended Decoration Type System', () => {
  describe('DecorationType enum', () => {
    it('should include all 12 decoration types', () => {
      // All expected decoration types
      const expectedTypes = [
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
      ];

      // Verify all types are in DECORATION_TYPES constant
      for (const type of expectedTypes) {
        expect(DECORATION_TYPES).toContain(type);
      }

      // Verify total count is 13 (TEXT + 9 original shapes + 3 line types)
      expect(DECORATION_TYPES.length).toBe(13);
    });

    it('should have 10 shape decoration types', () => {
      const expectedShapeTypes = [
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

      for (const type of expectedShapeTypes) {
        expect(SHAPE_DECORATION_TYPES).toContain(type);
      }

      expect(SHAPE_DECORATION_TYPES.length).toBe(10);
    });

    it('should have 3 line decoration types', () => {
      const expectedLineTypes = ['LINE', 'ARROW_SINGLE', 'ARROW_DOUBLE'];

      for (const type of expectedLineTypes) {
        expect(LINE_DECORATION_TYPES).toContain(type);
      }

      expect(LINE_DECORATION_TYPES.length).toBe(3);
    });
  });

  describe('ShapeDecoration interface', () => {
    it('should have required fields for BOX type', () => {
      const boxDecoration: ShapeDecoration = {
        id: 'test-box-1',
        type: 'BOX',
        pos_x: 100,
        pos_y: 200,
        width: 150,
        height: 100,
      };

      expect(boxDecoration.id).toBeDefined();
      expect(boxDecoration.type).toBe('BOX');
      expect(boxDecoration.pos_x).toBe(100);
      expect(boxDecoration.pos_y).toBe(200);
      expect(boxDecoration.width).toBe(150);
      expect(boxDecoration.height).toBe(100);
    });

    it('should support all new shape types', () => {
      const newShapeTypes: Array<ShapeDecoration['type']> = [
        'OVAL',
        'DIAMOND',
        'PARALLELOGRAM',
        'CIRCLE',
        'CYLINDER',
        'TRAPEZOID',
        'HEXAGON',
      ];

      for (const shapeType of newShapeTypes) {
        const decoration: ShapeDecoration = {
          id: `test-${shapeType.toLowerCase()}-1`,
          type: shapeType,
          pos_x: 0,
          pos_y: 0,
          width: 100,
          height: 100,
        };

        expect(decoration.type).toBe(shapeType);
      }
    });

    it('should support optional styling fields', () => {
      const styledDecoration: ShapeDecoration = {
        id: 'test-styled-1',
        type: 'OVAL',
        pos_x: 50,
        pos_y: 50,
        width: 120,
        height: 80,
        text: 'Test Label',
        text_h_align: 'CENTER',
        text_v_align: 'MIDDLE',
        background_color: '#E0E0FF',
        line_color: '#0000FF',
        text_color: '#000000',
        text_font_size: 14,
      };

      expect(styledDecoration.text).toBe('Test Label');
      expect(styledDecoration.text_h_align).toBe('CENTER');
      expect(styledDecoration.text_v_align).toBe('MIDDLE');
      expect(styledDecoration.background_color).toBe('#E0E0FF');
    });
  });

  describe('LineDecoration interface', () => {
    it('should support LINE type', () => {
      const lineDecoration: LineDecoration = {
        id: 'test-line-1',
        type: 'LINE',
        line_points: [
          { x: 0, y: 0 },
          { x: 100, y: 100 },
        ],
      };

      expect(lineDecoration.type).toBe('LINE');
      expect(lineDecoration.line_points.length).toBe(2);
    });

    it('should support ARROW_SINGLE type', () => {
      const arrowSingle: LineDecoration = {
        id: 'test-arrow-single-1',
        type: 'ARROW_SINGLE',
        line_points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
        arrow_start: 'NONE',
        arrow_end: 'ARROW',
      };

      expect(arrowSingle.type).toBe('ARROW_SINGLE');
      expect(arrowSingle.arrow_start).toBe('NONE');
      expect(arrowSingle.arrow_end).toBe('ARROW');
    });

    it('should support ARROW_DOUBLE type', () => {
      const arrowDouble: LineDecoration = {
        id: 'test-arrow-double-1',
        type: 'ARROW_DOUBLE',
        line_points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
        arrow_start: 'ARROW',
        arrow_end: 'ARROW',
      };

      expect(arrowDouble.type).toBe('ARROW_DOUBLE');
      expect(arrowDouble.arrow_start).toBe('ARROW');
      expect(arrowDouble.arrow_end).toBe('ARROW');
    });

    it('should support optional label fields', () => {
      const labeledLine: LineDecoration = {
        id: 'test-labeled-line-1',
        type: 'LINE',
        line_points: [
          { x: 0, y: 0 },
          { x: 200, y: 0 },
        ],
        text: 'Connection Label',
        label_pos_x: 100,
        label_pos_y: -10,
      };

      expect(labeledLine.text).toBe('Connection Label');
      expect(labeledLine.label_pos_x).toBe(100);
      expect(labeledLine.label_pos_y).toBe(-10);
    });
  });

  describe('Type guards', () => {
    it('isShapeDecoration() should return true for shape decorations', () => {
      const shapeTypes: Array<ShapeDecoration['type']> = [
        'BOX',
        'OVAL',
        'DIAMOND',
        'PARALLELOGRAM',
        'CIRCLE',
        'CYLINDER',
        'TRAPEZOID',
        'HEXAGON',
      ];

      for (const shapeType of shapeTypes) {
        const decoration: ShapeDecoration = {
          id: `test-${shapeType.toLowerCase()}`,
          type: shapeType,
          pos_x: 0,
          pos_y: 0,
          width: 100,
          height: 100,
        };

        expect(isShapeDecoration(decoration)).toBe(true);
        expect(isLineBasedDecoration(decoration as Decoration)).toBe(false);
      }
    });

    it('isLineBasedDecoration() should return true for line decorations', () => {
      const lineTypes: Array<LineDecoration['type']> = [
        'LINE',
        'ARROW_SINGLE',
        'ARROW_DOUBLE',
      ];

      for (const lineType of lineTypes) {
        const decoration: LineDecoration = {
          id: `test-${lineType.toLowerCase()}`,
          type: lineType,
          line_points: [
            { x: 0, y: 0 },
            { x: 100, y: 100 },
          ],
        };

        expect(isLineBasedDecoration(decoration)).toBe(true);
        expect(isShapeDecoration(decoration as Decoration)).toBe(false);
      }
    });

    it('type guards should narrow types correctly', () => {
      const decoration: Decoration = {
        id: 'test-box',
        type: 'BOX',
        pos_x: 0,
        pos_y: 0,
        width: 100,
        height: 50,
      };

      if (isShapeDecoration(decoration)) {
        // TypeScript should allow access to pos_x, pos_y, width, height
        expect(decoration.pos_x).toBe(0);
        expect(decoration.width).toBe(100);
      }

      const lineDecoration: Decoration = {
        id: 'test-line',
        type: 'LINE',
        line_points: [{ x: 0, y: 0 }],
      };

      if (isLineBasedDecoration(lineDecoration)) {
        // TypeScript should allow access to line_points
        expect(lineDecoration.line_points.length).toBe(1);
      }
    });
  });

  describe('Decoration union type', () => {
    it('should accept all shape decoration types', () => {
      const decorations: Decoration[] = [
        { id: '1', type: 'BOX', pos_x: 0, pos_y: 0, width: 100, height: 100 },
        { id: '2', type: 'OVAL', pos_x: 0, pos_y: 0, width: 100, height: 100 },
        { id: '3', type: 'DIAMOND', pos_x: 0, pos_y: 0, width: 100, height: 100 },
        { id: '4', type: 'PARALLELOGRAM', pos_x: 0, pos_y: 0, width: 100, height: 100 },
        { id: '5', type: 'CIRCLE', pos_x: 0, pos_y: 0, width: 100, height: 100 },
        { id: '6', type: 'CYLINDER', pos_x: 0, pos_y: 0, width: 100, height: 100 },
        { id: '7', type: 'TRAPEZOID', pos_x: 0, pos_y: 0, width: 100, height: 100 },
        { id: '8', type: 'HEXAGON', pos_x: 0, pos_y: 0, width: 100, height: 100 },
      ];

      expect(decorations.length).toBe(8);
      decorations.forEach(d => {
        expect(isShapeDecoration(d)).toBe(true);
      });
    });

    it('should accept all line decoration types', () => {
      const decorations: Decoration[] = [
        { id: '1', type: 'LINE', line_points: [{ x: 0, y: 0 }] },
        { id: '2', type: 'ARROW_SINGLE', line_points: [{ x: 0, y: 0 }], arrow_end: 'ARROW' },
        { id: '3', type: 'ARROW_DOUBLE', line_points: [{ x: 0, y: 0 }], arrow_start: 'ARROW', arrow_end: 'ARROW' },
      ];

      expect(decorations.length).toBe(3);
      decorations.forEach(d => {
        expect(isLineBasedDecoration(d)).toBe(true);
      });
    });
  });
});
