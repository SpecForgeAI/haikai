/**
 * Tests for Shape Rendering Functions
 * Task Group 3: Canvas Rendering for New Shapes
 *
 * Tests for:
 * - renderOval() draws ellipse inscribed in bounding box
 * - renderDiamond() draws rhombus with vertices at edge midpoints
 * - renderCircle() draws perfect circle (uses min dimension)
 * - renderCylinder() draws database shape with ellipse top
 * - renderHexagon() draws regular hexagon
 * - Shapes render with correct fill and stroke colors
 */

import {
  renderOval,
  renderDiamond,
  renderParallelogram,
  renderCircle,
  renderCylinder,
  renderTrapezoid,
  renderHexagon,
  renderBox,
  renderShape,
  renderShapeDecoration,
} from '../utils/shapeRendering';
import { ShapeDecoration } from '../types/model';

describe('Shape Rendering Functions', () => {
  // Helper to create a basic shape decoration
  const createShape = (type: ShapeDecoration['type'], overrides = {}): ShapeDecoration => ({
    id: 'test-shape',
    type,
    pos_x: 100,
    pos_y: 100,
    width: 200,
    height: 100,
    ...overrides,
  });

  describe('renderOval()', () => {
    it('should draw ellipse inscribed in bounding box', () => {
      const shape = createShape('OVAL');
      const result = renderOval(shape);

      // Path should contain arc commands
      expect(result.pathData).toContain('A');
      expect(result.pathData).toContain('M'); // Move to start
      expect(result.pathData).toContain('Z'); // Close path
    });

    it('should center text at middle of oval', () => {
      const shape = createShape('OVAL');
      const result = renderOval(shape);

      // Text position should be at center of bounding box
      expect(result.textPosition.x).toBe(200); // 100 + 200/2
      expect(result.textPosition.y).toBe(150); // 100 + 100/2
    });

    it('should use correct fill and stroke', () => {
      const shape = createShape('OVAL', {
        background_color: '#FF0000',
        line_color: '#00FF00',
      });
      const result = renderOval(shape);

      expect(result.fill).toBe('#FF0000');
      expect(result.stroke).toBe('#00FF00');
    });
  });

  describe('renderDiamond()', () => {
    it('should draw rhombus with vertices at edge midpoints', () => {
      const shape = createShape('DIAMOND', { width: 100, height: 100 });
      const result = renderDiamond(shape);

      // Path should have 4 vertices (4 L commands or M + 3 L)
      const moveCommands = (result.pathData.match(/M/g) || []).length;
      const lineCommands = (result.pathData.match(/L/g) || []).length;

      expect(moveCommands).toBe(1); // One move to start
      expect(lineCommands).toBe(3); // Three lines to other vertices
      expect(result.pathData).toContain('Z'); // Close path
    });

    it('should center text in diamond', () => {
      const shape = createShape('DIAMOND', { width: 100, height: 100 });
      const result = renderDiamond(shape);

      // Text position should be at center
      expect(result.textPosition.x).toBe(150); // 100 + 100/2
      expect(result.textPosition.y).toBe(150); // 100 + 100/2
    });
  });

  describe('renderParallelogram()', () => {
    it('should draw skewed rectangle', () => {
      const shape = createShape('PARALLELOGRAM');
      const result = renderParallelogram(shape);

      // Path should have 4 vertices
      const lineCommands = (result.pathData.match(/L/g) || []).length;
      expect(lineCommands).toBe(3);
      expect(result.pathData).toContain('Z');
    });

    it('should have horizontal skew offset', () => {
      const shape = createShape('PARALLELOGRAM', { height: 100 });
      const result = renderParallelogram(shape);

      // The path should not start at pos_x (it's offset)
      // First point should be offset from left edge
      expect(result.pathData).not.toContain('M 100 100'); // Should be offset
    });
  });

  describe('renderCircle()', () => {
    it('should draw perfect circle using min dimension', () => {
      const shape = createShape('CIRCLE', { width: 200, height: 100 });
      const result = renderCircle(shape);

      // Circle uses min(width, height) as diameter
      // So radius = 50 (100/2)
      expect(result.pathData).toContain('A 50 50'); // rx ry should both be 50
    });

    it('should center circle in bounding box', () => {
      const shape = createShape('CIRCLE', { width: 200, height: 100 });
      const result = renderCircle(shape);

      // Text position should be at center of bounding box
      expect(result.textPosition.x).toBe(200); // 100 + 200/2
      expect(result.textPosition.y).toBe(150); // 100 + 100/2
    });

    it('should maintain 1:1 aspect ratio for equal dimensions', () => {
      const shape = createShape('CIRCLE', { width: 100, height: 100 });
      const result = renderCircle(shape);

      // Both radii should be equal (50)
      expect(result.pathData).toContain('A 50 50');
    });
  });

  describe('renderCylinder()', () => {
    it('should draw database shape with ellipse top', () => {
      const shape = createShape('CYLINDER', { width: 100, height: 150 });
      const result = renderCylinder(shape);

      // Should contain arc commands for ellipse
      expect(result.pathData).toContain('A');
      // Should be a closed path
      expect(result.pathData).toContain('Z');
    });

    it('should have vertical text positioning below ellipse', () => {
      const shape = createShape('CYLINDER', { height: 150 });
      const result = renderCylinder(shape);

      // Text should be vertically offset from center (accounting for top ellipse)
      // Text Y should be slightly below geometric center
      expect(result.textPosition.y).toBeGreaterThan(100 + 150 / 2 - 10);
    });
  });

  describe('renderTrapezoid()', () => {
    it('should draw trapezoid with narrower top edge', () => {
      const shape = createShape('TRAPEZOID', { width: 100 });
      const result = renderTrapezoid(shape);

      // Path should have 4 vertices
      const lineCommands = (result.pathData.match(/L/g) || []).length;
      expect(lineCommands).toBe(3);
      expect(result.pathData).toContain('Z');
    });

    it('should have top edge about 60% of bottom width', () => {
      const shape = createShape('TRAPEZOID', { pos_x: 0, width: 100 });
      const result = renderTrapezoid(shape);

      // Top edge inset should be (100 - 60) / 2 = 20
      // First point should be at x = 20
      expect(result.pathData).toContain('M 20'); // Top-left starts at inset
    });
  });

  describe('renderHexagon()', () => {
    it('should draw regular hexagon with 6 vertices', () => {
      const shape = createShape('HEXAGON');
      const result = renderHexagon(shape);

      // Path should have 6 vertices (1 M + 5 L)
      const lineCommands = (result.pathData.match(/L/g) || []).length;
      expect(lineCommands).toBe(5);
      expect(result.pathData).toContain('Z');
    });

    it('should center text in hexagon', () => {
      const shape = createShape('HEXAGON');
      const result = renderHexagon(shape);

      // Text position should be at center
      expect(result.textPosition.x).toBe(200); // 100 + 200/2
      expect(result.textPosition.y).toBe(150); // 100 + 100/2
    });
  });

  describe('renderBox()', () => {
    it('should draw simple rectangle', () => {
      const shape = createShape('BOX');
      const result = renderBox(shape);

      // Path should have 4 vertices
      const lineCommands = (result.pathData.match(/L/g) || []).length;
      expect(lineCommands).toBe(3);
      expect(result.pathData).toContain('Z');
    });
  });

  describe('renderShape() dispatch', () => {
    it('should route to correct renderer for each type', () => {
      const types: Array<ShapeDecoration['type']> = [
        'BOX',
        'OVAL',
        'DIAMOND',
        'PARALLELOGRAM',
        'CIRCLE',
        'CYLINDER',
        'TRAPEZOID',
        'HEXAGON',
      ];

      for (const type of types) {
        const shape = createShape(type);
        const result = renderShape(shape);

        // All should return valid path data
        expect(result.pathData).toBeDefined();
        expect(result.pathData.length).toBeGreaterThan(0);
        expect(result.fill).toBeDefined();
        expect(result.stroke).toBeDefined();
      }
    });
  });

  describe('Shape styling', () => {
    it('should render with correct fill and stroke colors', () => {
      const shape = createShape('OVAL', {
        background_color: '#123456',
        line_color: '#ABCDEF',
        line_weight: '3px',
        line_style: 'DASHED',
      });

      const result = renderOval(shape);

      expect(result.fill).toBe('#123456');
      expect(result.stroke).toBe('#ABCDEF');
      expect(result.strokeWidth).toBe(3);
      expect(result.strokeDasharray).toBe('6 4'); // DASHED pattern
    });

    it('should use default colors when not specified', () => {
      const shape = createShape('DIAMOND');
      const result = renderDiamond(shape);

      // Should use DIAMOND defaults from DECORATION_DEFAULTS
      expect(result.fill).toBeDefined();
      expect(result.stroke).toBeDefined();
      expect(result.strokeWidth).toBeGreaterThan(0);
    });

    it('should handle DOTTED line style', () => {
      const shape = createShape('BOX', { line_style: 'DOTTED' });
      const result = renderBox(shape);

      expect(result.strokeDasharray).toBe('2 4'); // DOTTED pattern
    });

    it('should handle SOLID line style with empty dasharray', () => {
      const shape = createShape('BOX', { line_style: 'SOLID' });
      const result = renderBox(shape);

      expect(result.strokeDasharray).toBe('');
    });
  });

  describe('renderShapeDecoration()', () => {
    it('should include text element when text is provided', () => {
      const shape = createShape('OVAL', { text: 'Test Label' });
      const result = renderShapeDecoration(shape, false);

      expect(result.textElement).toBeDefined();
      expect(result.textElement?.content).toBe('Test Label');
    });

    it('should not include text element when text is empty', () => {
      const shape = createShape('OVAL', { text: '' });
      const result = renderShapeDecoration(shape, false);

      expect(result.textElement).toBeUndefined();
    });

    it('should track selection state', () => {
      const shape = createShape('BOX');

      const selectedResult = renderShapeDecoration(shape, true);
      expect(selectedResult.isSelected).toBe(true);

      const unselectedResult = renderShapeDecoration(shape, false);
      expect(unselectedResult.isSelected).toBe(false);
    });

    it('should apply text alignment settings', () => {
      const shape = createShape('BOX', {
        text: 'Test',
        text_h_align: 'LEFT',
        text_v_align: 'TOP',
      });
      const result = renderShapeDecoration(shape, false);

      expect(result.textElement?.textAnchor).toBe('start'); // LEFT -> start
    });
  });
});
