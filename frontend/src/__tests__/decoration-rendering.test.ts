/**
 * Decoration Rendering Tests
 * Tests for decoration rendering utilities and canvas integration
 * Task Group 2: Canvas Rendering for Decorations
 */

import {
  BoxDecoration,
  LineDecoration,
  Decoration,
  LineStyle,
} from '../types/model';
import {
  Z_INDEX_DEFAULTS,
  DECORATION_DEFAULTS,
} from '../config/defaults';

// Import decoration utility functions (to be created)
import {
  generateDecorationId,
  createDefaultBoxDecoration,
  createDefaultLineDecoration,
  calculateLineLabelPosition,
  isPointInsideBoxDecoration,
  isPointNearLineDecoration,
  getBoxHandlePositions,
} from '../utils/decorationUtils';

// Import rendering functions (to be added)
import {
  renderBoxDecoration,
  renderLineDecoration,
  getDecorationStrokeStyle,
} from '../utils/rendering';

// Test data factory functions
function createTestBoxDecoration(overrides: Partial<BoxDecoration> = {}): BoxDecoration {
  return {
    id: 'dec_box_test',
    type: 'BOX',
    pos_x: 100,
    pos_y: 100,
    width: 200,
    height: 150,
    ...overrides,
  };
}

function createTestLineDecoration(overrides: Partial<LineDecoration> = {}): LineDecoration {
  return {
    id: 'dec_line_test',
    type: 'LINE',
    line_points: [
      { x: 100, y: 100 },
      { x: 200, y: 200 },
    ],
    ...overrides,
  };
}

describe('Decoration Rendering Utilities', () => {
  describe('renderBoxDecoration() output with various styles', () => {
    it('should return SVG elements for basic BOX decoration', () => {
      const box = createTestBoxDecoration();
      const result = renderBoxDecoration(box, false);

      expect(result).toBeDefined();
      expect(result.rect).toBeDefined();
      expect(result.rect.x).toBe(100);
      expect(result.rect.y).toBe(100);
      expect(result.rect.width).toBe(200);
      expect(result.rect.height).toBe(150);
    });

    it('should apply background color to BOX decoration', () => {
      const box = createTestBoxDecoration({
        background_color: 'rgba(255,0,0,0.5)',
      });
      const result = renderBoxDecoration(box, false);

      expect(result.rect.fill).toBe('rgba(255,0,0,0.5)');
    });

    it('should apply border color and style to BOX decoration', () => {
      const box = createTestBoxDecoration({
        line_color: '#FF0000',
        line_style: 'DASHED',
        line_weight: '3px',
      });
      const result = renderBoxDecoration(box, false);

      expect(result.rect.stroke).toBe('#FF0000');
      expect(result.rect.strokeDasharray).toBeTruthy();
      expect(result.rect.strokeWidth).toBe(3);
    });

    it('should include text element when text is provided', () => {
      const box = createTestBoxDecoration({
        text: 'Test Label',
        text_color: '#000000',
        text_font_size: 14,
      });
      const result = renderBoxDecoration(box, false);

      expect(result.textElement).toBeDefined();
      expect(result.textElement?.content).toBe('Test Label');
      expect(result.textElement?.fill).toBe('#000000');
      expect(result.textElement?.fontSize).toBe(14);
    });

    it('should indicate selection state when isSelected is true', () => {
      const box = createTestBoxDecoration();
      const result = renderBoxDecoration(box, true);

      expect(result.isSelected).toBe(true);
    });
  });

  describe('renderLineDecoration() output with polyline points', () => {
    it('should return SVG elements for basic LINE decoration', () => {
      const line = createTestLineDecoration();
      const result = renderLineDecoration(line, false);

      expect(result).toBeDefined();
      expect(result.pathData).toBeDefined();
      expect(result.pathData).toContain('M 100 100');
      expect(result.pathData).toContain('L 200 200');
    });

    it('should handle polyline with multiple points', () => {
      const line = createTestLineDecoration({
        line_points: [
          { x: 100, y: 100 },
          { x: 150, y: 120 },
          { x: 200, y: 150 },
          { x: 250, y: 200 },
        ],
      });
      const result = renderLineDecoration(line, false);

      expect(result.pathData).toContain('M 100 100');
      expect(result.pathData).toContain('L 150 120');
      expect(result.pathData).toContain('L 200 150');
      expect(result.pathData).toContain('L 250 200');
    });

    it('should apply line color and style', () => {
      const line = createTestLineDecoration({
        line_color: '#0000FF',
        line_style: 'DOTTED',
        line_weight: '2px',
      });
      const result = renderLineDecoration(line, false);

      expect(result.stroke).toBe('#0000FF');
      expect(result.strokeDasharray).toBeTruthy();
      expect(result.strokeWidth).toBe(2);
    });

    it('should include arrow paths when arrows are specified', () => {
      const line = createTestLineDecoration({
        arrow_start: 'ARROW',
        arrow_end: 'ARROW',
      });
      const result = renderLineDecoration(line, false);

      expect(result.arrowStartPath).toBeDefined();
      expect(result.arrowEndPath).toBeDefined();
    });

    it('should include label element when text is provided', () => {
      const line = createTestLineDecoration({
        text: 'Label Text',
        label_pos_x: 150,
        label_pos_y: 150,
        text_color: '#333333',
        text_font_size: 12,
      });
      const result = renderLineDecoration(line, false);

      expect(result.labelElement).toBeDefined();
      expect(result.labelElement?.content).toBe('Label Text');
      expect(result.labelElement?.x).toBe(150);
      expect(result.labelElement?.y).toBe(150);
    });
  });

  describe('Text rendering inside BOX with alignment', () => {
    it('should position text at TOP-LEFT', () => {
      const box = createTestBoxDecoration({
        text: 'Test',
        text_h_align: 'LEFT',
        text_v_align: 'TOP',
      });
      const result = renderBoxDecoration(box, false);

      expect(result.textElement?.textAnchor).toBe('start');
      // Y position should be near top (pos_y + padding + fontSize)
      expect(result.textElement?.y).toBeLessThan(box.pos_y + box.height / 2);
    });

    it('should position text at CENTER-MIDDLE', () => {
      const box = createTestBoxDecoration({
        text: 'Test',
        text_h_align: 'CENTER',
        text_v_align: 'MIDDLE',
      });
      const result = renderBoxDecoration(box, false);

      expect(result.textElement?.textAnchor).toBe('middle');
      // X position should be centered
      expect(result.textElement?.x).toBe(box.pos_x + box.width / 2);
    });

    it('should position text at BOTTOM-RIGHT', () => {
      const box = createTestBoxDecoration({
        text: 'Test',
        text_h_align: 'RIGHT',
        text_v_align: 'BOTTOM',
      });
      const result = renderBoxDecoration(box, false);

      expect(result.textElement?.textAnchor).toBe('end');
      // Y position should be near bottom
      expect(result.textElement?.y).toBeGreaterThan(box.pos_y + box.height / 2);
    });
  });

  describe('Label position calculation for LINE (midpoint default)', () => {
    it('should calculate midpoint for 2-point line', () => {
      const line = createTestLineDecoration({
        line_points: [
          { x: 100, y: 100 },
          { x: 200, y: 200 },
        ],
      });
      const midpoint = calculateLineLabelPosition(line);

      expect(midpoint.x).toBe(150);
      expect(midpoint.y).toBe(150);
    });

    it('should calculate midpoint for multi-point polyline', () => {
      const line = createTestLineDecoration({
        line_points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 100 },
          { x: 200, y: 100 },
        ],
      });
      const midpoint = calculateLineLabelPosition(line);

      // Average of all points
      expect(midpoint.x).toBe(100); // (0 + 100 + 100 + 200) / 4
      expect(midpoint.y).toBe(50);  // (0 + 0 + 100 + 100) / 4
    });

    it('should use explicit label position when provided', () => {
      const line = createTestLineDecoration({
        line_points: [
          { x: 100, y: 100 },
          { x: 200, y: 200 },
        ],
        // A label element is only produced when the decoration has text
        text: 'My Label',
        label_pos_x: 180,
        label_pos_y: 180,
      });
      const result = renderLineDecoration(line, false);

      expect(result.labelElement?.x).toBe(180);
      expect(result.labelElement?.y).toBe(180);
    });
  });

  describe('Z-index ordering with nodes and edges', () => {
    it('should have BOX decorations default z-index below nodes', () => {
      expect(Z_INDEX_DEFAULTS.BOX_DECORATION).toBeLessThan(Z_INDEX_DEFAULTS.DIAGRAM_NODE);
      expect(Z_INDEX_DEFAULTS.BOX_DECORATION).toBe(50);
    });

    it('should have LINE decorations default z-index above edges', () => {
      expect(Z_INDEX_DEFAULTS.LINE_DECORATION).toBeGreaterThan(Z_INDEX_DEFAULTS.DIAGRAM_EDGE);
      expect(Z_INDEX_DEFAULTS.LINE_DECORATION).toBe(120);
    });

    it('should sort decorations by z_index for rendering order', () => {
      const decorations: Decoration[] = [
        createTestBoxDecoration({ id: 'box-high', z_index: 200 }),
        createTestLineDecoration({ id: 'line-low', z_index: 10 }),
        createTestBoxDecoration({ id: 'box-default' }), // Default z_index: 50
      ];

      // Sort by z_index (using default if not specified)
      const sorted = [...decorations].sort((a, b) => {
        const zIndexA = a.z_index ?? (a.type === 'BOX' ? Z_INDEX_DEFAULTS.BOX_DECORATION : Z_INDEX_DEFAULTS.LINE_DECORATION);
        const zIndexB = b.z_index ?? (b.type === 'BOX' ? Z_INDEX_DEFAULTS.BOX_DECORATION : Z_INDEX_DEFAULTS.LINE_DECORATION);
        return zIndexA - zIndexB;
      });

      expect(sorted[0].id).toBe('line-low');    // z_index: 10
      expect(sorted[1].id).toBe('box-default'); // z_index: 50 (default)
      expect(sorted[2].id).toBe('box-high');    // z_index: 200
    });

    it('should allow custom z_index values per decoration', () => {
      const box = createTestBoxDecoration({ z_index: 150 });
      const line = createTestLineDecoration({ z_index: 40 });

      expect(box.z_index).toBe(150);
      expect(line.z_index).toBe(40);
    });
  });

  describe('Line style (SOLID, DASHED, DOTTED) rendering', () => {
    it('should return empty strokeDasharray for SOLID style', () => {
      const style = getDecorationStrokeStyle('SOLID', '2px');

      expect(style.strokeDasharray).toBe('');
    });

    it('should return dash pattern for DASHED style', () => {
      const style = getDecorationStrokeStyle('DASHED', '2px');

      expect(style.strokeDasharray).toBeTruthy();
      expect(style.strokeDasharray).toBe('6 4');
    });

    it('should return dot pattern for DOTTED style', () => {
      const style = getDecorationStrokeStyle('DOTTED', '2px');

      expect(style.strokeDasharray).toBeTruthy();
      expect(style.strokeDasharray).toBe('2 4');
    });

    it('should parse line weight correctly', () => {
      const style = getDecorationStrokeStyle('SOLID', '3px');

      expect(style.strokeWidth).toBe(3);
    });

    it('should use default line weight when not specified', () => {
      const style = getDecorationStrokeStyle('SOLID');

      expect(style.strokeWidth).toBe(2); // Default weight
    });
  });
});

describe('Decoration Utility Functions', () => {
  describe('createDefaultBoxDecoration()', () => {
    it('should create a BOX decoration with default styling', () => {
      const box = createDefaultBoxDecoration(100, 100, 200, 150);

      expect(box.type).toBe('BOX');
      expect(box.pos_x).toBe(100);
      expect(box.pos_y).toBe(100);
      expect(box.width).toBe(200);
      expect(box.height).toBe(150);
      expect(box.z_index).toBe(DECORATION_DEFAULTS.BOX.z_index);
      expect(box.background_color).toBe(DECORATION_DEFAULTS.BOX.background_color);
      expect(box.line_color).toBe(DECORATION_DEFAULTS.BOX.line_color);
    });

    it('should generate a unique ID', () => {
      const box1 = createDefaultBoxDecoration(0, 0, 100, 100);
      const box2 = createDefaultBoxDecoration(0, 0, 100, 100);

      expect(box1.id).not.toBe(box2.id);
      expect(box1.id).toMatch(/^dec_box_/);
    });
  });

  describe('createDefaultLineDecoration()', () => {
    it('should create a LINE decoration with default styling', () => {
      const points = [
        { x: 100, y: 100 },
        { x: 200, y: 200 },
      ];
      const line = createDefaultLineDecoration(points);

      expect(line.type).toBe('LINE');
      expect(line.line_points).toEqual(points);
      expect(line.z_index).toBe(DECORATION_DEFAULTS.LINE.z_index);
      expect(line.line_color).toBe(DECORATION_DEFAULTS.LINE.line_color);
      expect(line.arrow_start).toBe(DECORATION_DEFAULTS.LINE.arrow_start);
      expect(line.arrow_end).toBe(DECORATION_DEFAULTS.LINE.arrow_end);
    });

    it('should generate a unique ID', () => {
      const points = [{ x: 0, y: 0 }, { x: 100, y: 100 }];
      const line1 = createDefaultLineDecoration(points);
      const line2 = createDefaultLineDecoration(points);

      expect(line1.id).not.toBe(line2.id);
      expect(line1.id).toMatch(/^dec_line_/);
    });
  });

  describe('isPointInsideBoxDecoration() hit testing', () => {
    it('should return true for point inside box', () => {
      const box = createTestBoxDecoration();

      expect(isPointInsideBoxDecoration(150, 150, box)).toBe(true);
    });

    it('should return false for point outside box', () => {
      const box = createTestBoxDecoration();

      expect(isPointInsideBoxDecoration(50, 50, box)).toBe(false);
      expect(isPointInsideBoxDecoration(350, 350, box)).toBe(false);
    });

    it('should return true for point on box edge', () => {
      const box = createTestBoxDecoration();

      expect(isPointInsideBoxDecoration(100, 150, box)).toBe(true); // Left edge
      expect(isPointInsideBoxDecoration(300, 150, box)).toBe(true); // Right edge
      expect(isPointInsideBoxDecoration(150, 100, box)).toBe(true); // Top edge
      expect(isPointInsideBoxDecoration(150, 250, box)).toBe(true); // Bottom edge
    });
  });

  describe('isPointNearLineDecoration() hit testing', () => {
    it('should return true for point near line segment', () => {
      const line = createTestLineDecoration();

      // Point on the line diagonal from (100,100) to (200,200)
      expect(isPointNearLineDecoration(150, 150, line, 5)).toBe(true);
    });

    it('should return false for point far from line', () => {
      const line = createTestLineDecoration();

      expect(isPointNearLineDecoration(50, 200, line, 5)).toBe(false);
      expect(isPointNearLineDecoration(250, 50, line, 5)).toBe(false);
    });

    it('should work with polylines', () => {
      const line = createTestLineDecoration({
        line_points: [
          { x: 100, y: 100 },
          { x: 200, y: 100 },
          { x: 200, y: 200 },
        ],
      });

      // Point near horizontal segment
      expect(isPointNearLineDecoration(150, 102, line, 5)).toBe(true);
      // Point near vertical segment
      expect(isPointNearLineDecoration(198, 150, line, 5)).toBe(true);
    });

    it('should respect tolerance parameter', () => {
      const line = createTestLineDecoration();

      // Point 10 pixels away from line
      expect(isPointNearLineDecoration(160, 140, line, 5)).toBe(false);
      expect(isPointNearLineDecoration(160, 140, line, 20)).toBe(true);
    });
  });

  describe('getBoxHandlePositions() for 8 resize handles', () => {
    it('should return 8 handle positions', () => {
      const box = createTestBoxDecoration();
      const handles = getBoxHandlePositions(box);

      expect(handles).toHaveLength(8);
    });

    it('should return corners and edge midpoints', () => {
      const box = createTestBoxDecoration({
        pos_x: 100,
        pos_y: 100,
        width: 200,
        height: 150,
      });
      const handles = getBoxHandlePositions(box);

      // Check that all expected positions are present
      const positions = handles.map(h => h.position);
      expect(positions).toContain('TL'); // Top-left
      expect(positions).toContain('TC'); // Top-center
      expect(positions).toContain('TR'); // Top-right
      expect(positions).toContain('ML'); // Middle-left
      expect(positions).toContain('MR'); // Middle-right
      expect(positions).toContain('BL'); // Bottom-left
      expect(positions).toContain('BC'); // Bottom-center
      expect(positions).toContain('BR'); // Bottom-right
    });

    it('should calculate correct coordinates for each handle', () => {
      const box = createTestBoxDecoration({
        pos_x: 100,
        pos_y: 100,
        width: 200,
        height: 150,
      });
      const handles = getBoxHandlePositions(box);

      const findHandle = (pos: string) => handles.find(h => h.position === pos);

      expect(findHandle('TL')).toEqual({ position: 'TL', x: 100, y: 100 });
      expect(findHandle('TC')).toEqual({ position: 'TC', x: 200, y: 100 });
      expect(findHandle('TR')).toEqual({ position: 'TR', x: 300, y: 100 });
      expect(findHandle('ML')).toEqual({ position: 'ML', x: 100, y: 175 });
      expect(findHandle('MR')).toEqual({ position: 'MR', x: 300, y: 175 });
      expect(findHandle('BL')).toEqual({ position: 'BL', x: 100, y: 250 });
      expect(findHandle('BC')).toEqual({ position: 'BC', x: 200, y: 250 });
      expect(findHandle('BR')).toEqual({ position: 'BR', x: 300, y: 250 });
    });
  });
});
