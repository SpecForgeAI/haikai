/**
 * Tests for Decoration Canvas Rendering
 * Task Group 3: Add Rendering for New Decoration Types
 *
 * Tests for:
 * - renderDecoration handles OVAL type
 * - renderDecoration handles DIAMOND type
 * - renderDecoration handles ARROW_SINGLE as LINE with arrow_end
 * - All 11 decoration types render without returning null
 * - Decorations render with correct SVG paths
 * - Selected decorations show selection indicator
 */

import {
  ShapeDecoration,
  LineDecoration,
  SHAPE_DECORATION_TYPES,
  LINE_DECORATION_TYPES,
  ShapeDecorationType,
  LineDecorationType,
} from '../types/model';

import {
  renderShape,
  renderShapeDecoration,
  ShapeRenderResult,
} from '../utils/shapeRendering';

import {
  isShapeDecoration,
  isLineBasedDecoration,
} from '../utils/decorationUtils';

describe('Decoration Canvas Rendering', () => {
  describe('Shape rendering via renderShape', () => {
    it('should render OVAL type with ellipse path', () => {
      const oval: ShapeDecoration = {
        id: 'test-oval',
        type: 'OVAL',
        pos_x: 100,
        pos_y: 100,
        width: 150,
        height: 100,
      };

      const result = renderShape(oval);

      expect(result.pathData).toBeDefined();
      expect(result.pathData.length).toBeGreaterThan(0);
      // Ellipse paths contain arc commands (A)
      expect(result.pathData).toContain('A');
      expect(result.fill).toBeDefined();
      expect(result.stroke).toBeDefined();
    });

    it('should render DIAMOND type with polygon path', () => {
      const diamond: ShapeDecoration = {
        id: 'test-diamond',
        type: 'DIAMOND',
        pos_x: 50,
        pos_y: 50,
        width: 100,
        height: 80,
      };

      const result = renderShape(diamond);

      expect(result.pathData).toBeDefined();
      // Diamond path has 4 line segments
      expect(result.pathData).toContain('L');
      expect(result.pathData).toContain('Z'); // Closed path
    });

    it('should render all 8 shape types successfully', () => {
      const shapeTypes: ShapeDecorationType[] = [
        'BOX', 'OVAL', 'DIAMOND', 'PARALLELOGRAM',
        'CIRCLE', 'CYLINDER', 'TRAPEZOID', 'HEXAGON',
      ];

      shapeTypes.forEach(shapeType => {
        const shape: ShapeDecoration = {
          id: `test-${shapeType.toLowerCase()}`,
          type: shapeType,
          pos_x: 0,
          pos_y: 0,
          width: 100,
          height: 100,
        };

        const result = renderShape(shape);

        expect(result).not.toBeNull();
        expect(result.pathData).toBeDefined();
        expect(result.pathData.length).toBeGreaterThan(0);
        expect(result.fill).toBeDefined();
        expect(result.stroke).toBeDefined();
        expect(result.strokeWidth).toBeGreaterThan(0);
        expect(result.textPosition).toBeDefined();
        expect(result.textPosition.x).toBeDefined();
        expect(result.textPosition.y).toBeDefined();
      });
    });

    it('should return correct text position for centered text', () => {
      const shape: ShapeDecoration = {
        id: 'test-box',
        type: 'BOX',
        pos_x: 100,
        pos_y: 100,
        width: 200,
        height: 100,
      };

      const result = renderShape(shape);

      // Text position should be at center of bounding box
      expect(result.textPosition.x).toBe(200); // 100 + 200/2
      expect(result.textPosition.y).toBe(150); // 100 + 100/2
    });
  });

  describe('Shape decoration rendering with text', () => {
    it('should include text element when text is provided', () => {
      const shape: ShapeDecoration = {
        id: 'test-shape-with-text',
        type: 'OVAL',
        pos_x: 0,
        pos_y: 0,
        width: 100,
        height: 100,
        text: 'Test Label',
        text_color: '#000000',
      };

      const result = renderShapeDecoration(shape, false);

      expect(result.textElement).toBeDefined();
      expect(result.textElement?.content).toBe('Test Label');
    });

    it('should not include text element when text is empty', () => {
      const shape: ShapeDecoration = {
        id: 'test-shape-no-text',
        type: 'BOX',
        pos_x: 0,
        pos_y: 0,
        width: 100,
        height: 100,
        text: '',
      };

      const result = renderShapeDecoration(shape, false);

      expect(result.textElement).toBeUndefined();
    });

    it('should mark isSelected correctly', () => {
      const shape: ShapeDecoration = {
        id: 'test-selected',
        type: 'DIAMOND',
        pos_x: 0,
        pos_y: 0,
        width: 100,
        height: 100,
      };

      const resultSelected = renderShapeDecoration(shape, true);
      const resultUnselected = renderShapeDecoration(shape, false);

      expect(resultSelected.isSelected).toBe(true);
      expect(resultUnselected.isSelected).toBe(false);
    });
  });

  describe('Type guards for decoration rendering', () => {
    it('should correctly identify shape decorations', () => {
      const shapes: ShapeDecoration[] = [
        { id: '1', type: 'BOX', pos_x: 0, pos_y: 0, width: 100, height: 100 },
        { id: '2', type: 'OVAL', pos_x: 0, pos_y: 0, width: 100, height: 100 },
        { id: '3', type: 'DIAMOND', pos_x: 0, pos_y: 0, width: 100, height: 100 },
        { id: '4', type: 'PARALLELOGRAM', pos_x: 0, pos_y: 0, width: 100, height: 100 },
        { id: '5', type: 'CIRCLE', pos_x: 0, pos_y: 0, width: 100, height: 100 },
        { id: '6', type: 'CYLINDER', pos_x: 0, pos_y: 0, width: 100, height: 100 },
        { id: '7', type: 'TRAPEZOID', pos_x: 0, pos_y: 0, width: 100, height: 100 },
        { id: '8', type: 'HEXAGON', pos_x: 0, pos_y: 0, width: 100, height: 100 },
      ];

      shapes.forEach(shape => {
        expect(isShapeDecoration(shape)).toBe(true);
        expect(isLineBasedDecoration(shape)).toBe(false);
      });
    });

    it('should correctly identify line decorations', () => {
      const lines: LineDecoration[] = [
        { id: '1', type: 'LINE', line_points: [{ x: 0, y: 0 }, { x: 100, y: 100 }] },
        { id: '2', type: 'ARROW_SINGLE', line_points: [{ x: 0, y: 0 }, { x: 100, y: 100 }], arrow_end: 'ARROW' },
        { id: '3', type: 'ARROW_DOUBLE', line_points: [{ x: 0, y: 0 }, { x: 100, y: 100 }], arrow_start: 'ARROW', arrow_end: 'ARROW' },
      ];

      lines.forEach(line => {
        expect(isLineBasedDecoration(line)).toBe(true);
        expect(isShapeDecoration(line)).toBe(false);
      });
    });
  });

  describe('Arrow types render as LINE with arrow properties', () => {
    it('ARROW_SINGLE should have arrow_end property', () => {
      const arrowSingle: LineDecoration = {
        id: 'test-arrow-single',
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
      expect(isLineBasedDecoration(arrowSingle)).toBe(true);
    });

    it('ARROW_DOUBLE should have both arrow_start and arrow_end', () => {
      const arrowDouble: LineDecoration = {
        id: 'test-arrow-double',
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
  });

  describe('SVG path correctness', () => {
    it('should generate valid SVG path for BOX', () => {
      const box: ShapeDecoration = {
        id: 'test-box',
        type: 'BOX',
        pos_x: 10,
        pos_y: 20,
        width: 100,
        height: 50,
      };

      const result = renderShape(box);

      // BOX path should start at top-left
      expect(result.pathData).toContain('M 10 20');
      // Should be a closed path
      expect(result.pathData).toContain('Z');
    });

    it('should generate valid SVG path for CIRCLE', () => {
      const circle: ShapeDecoration = {
        id: 'test-circle',
        type: 'CIRCLE',
        pos_x: 50,
        pos_y: 50,
        width: 100,
        height: 100,
      };

      const result = renderShape(circle);

      // Circle uses arc commands
      expect(result.pathData).toContain('A');
      expect(result.pathData).toContain('Z');
    });

    it('should generate valid SVG path for HEXAGON', () => {
      const hexagon: ShapeDecoration = {
        id: 'test-hexagon',
        type: 'HEXAGON',
        pos_x: 0,
        pos_y: 0,
        width: 100,
        height: 86.6, // Regular hexagon aspect ratio
      };

      const result = renderShape(hexagon);

      // Hexagon has 6 line segments
      const lineCommands = (result.pathData.match(/L /g) || []).length;
      expect(lineCommands).toBe(5); // M + 5 L commands for 6 points
      expect(result.pathData).toContain('Z');
    });
  });

  describe('Styling properties', () => {
    it('should use custom background color when provided', () => {
      const shape: ShapeDecoration = {
        id: 'test-styled',
        type: 'OVAL',
        pos_x: 0,
        pos_y: 0,
        width: 100,
        height: 100,
        background_color: '#FF0000',
      };

      const result = renderShape(shape);

      expect(result.fill).toBe('#FF0000');
    });

    it('should use custom line color when provided', () => {
      const shape: ShapeDecoration = {
        id: 'test-styled-stroke',
        type: 'DIAMOND',
        pos_x: 0,
        pos_y: 0,
        width: 100,
        height: 100,
        line_color: '#00FF00',
      };

      const result = renderShape(shape);

      expect(result.stroke).toBe('#00FF00');
    });

    it('should handle dashed line style', () => {
      const shape: ShapeDecoration = {
        id: 'test-dashed',
        type: 'BOX',
        pos_x: 0,
        pos_y: 0,
        width: 100,
        height: 100,
        line_style: 'DASHED',
      };

      const result = renderShape(shape);

      expect(result.strokeDasharray).toBe('6 4');
    });

    it('should handle dotted line style', () => {
      const shape: ShapeDecoration = {
        id: 'test-dotted',
        type: 'TRAPEZOID',
        pos_x: 0,
        pos_y: 0,
        width: 100,
        height: 100,
        line_style: 'DOTTED',
      };

      const result = renderShape(shape);

      expect(result.strokeDasharray).toBe('2 4');
    });

    it('should have empty stroke dasharray for solid line', () => {
      const shape: ShapeDecoration = {
        id: 'test-solid',
        type: 'PARALLELOGRAM',
        pos_x: 0,
        pos_y: 0,
        width: 100,
        height: 100,
        line_style: 'SOLID',
      };

      const result = renderShape(shape);

      expect(result.strokeDasharray).toBe('');
    });
  });

  describe('All 11 decoration types render without null', () => {
    it('should render all shape types without returning null', () => {
      SHAPE_DECORATION_TYPES.forEach(shapeType => {
        const shape: ShapeDecoration = {
          id: `test-${shapeType}`,
          type: shapeType,
          pos_x: 0,
          pos_y: 0,
          width: 100,
          height: 100,
        };

        const result = renderShape(shape);
        expect(result).not.toBeNull();
        expect(result.pathData).not.toBe('');
      });
    });

    it('should have all expected properties in render result', () => {
      const shape: ShapeDecoration = {
        id: 'test-props',
        type: 'CYLINDER',
        pos_x: 25,
        pos_y: 50,
        width: 80,
        height: 120,
      };

      const result: ShapeRenderResult = renderShape(shape);

      expect(result).toHaveProperty('pathData');
      expect(result).toHaveProperty('fill');
      expect(result).toHaveProperty('stroke');
      expect(result).toHaveProperty('strokeWidth');
      expect(result).toHaveProperty('strokeDasharray');
      expect(result).toHaveProperty('textPosition');
    });
  });
});
