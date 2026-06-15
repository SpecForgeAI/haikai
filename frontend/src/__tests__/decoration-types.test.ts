/**
 * Decoration Types Tests
 * Tests for decoration type definitions, interfaces, and state management
 * Task Group 1: Type Definitions and State Management
 */

import {
  BoxDecoration,
  LineDecoration,
  Decoration,
  DecorationHAlign,
  DecorationVAlign,
  LineStyle,
  ArrowType,
  Diagram,
} from '../types/model';
import {
  DECORATION_DEFAULTS,
  generateDecorationId,
} from '../config/defaults';

// Test data factory functions
function createTestBoxDecoration(overrides: Partial<BoxDecoration> = {}): BoxDecoration {
  return {
    id: 'dec_box_1',
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
    id: 'dec_line_1',
    type: 'LINE',
    line_points: [
      { x: 100, y: 100 },
      { x: 200, y: 200 },
    ],
    ...overrides,
  };
}

function createTestDiagramWithDecorations(decorations: Decoration[] = []): Diagram {
  return {
    id: 'test-diagram',
    name: 'Test Diagram',
    description: 'Test diagram with decorations',
    diagram_nodes: [],
    diagram_edges: [],
    decorations,
  };
}

describe('Decoration Type Definitions', () => {
  describe('BoxDecoration interface structure validation', () => {
    it('should create a valid BoxDecoration with required properties', () => {
      const boxDecoration: BoxDecoration = createTestBoxDecoration();

      expect(boxDecoration.id).toBe('dec_box_1');
      expect(boxDecoration.type).toBe('BOX');
      expect(boxDecoration.pos_x).toBe(100);
      expect(boxDecoration.pos_y).toBe(100);
      expect(boxDecoration.width).toBe(200);
      expect(boxDecoration.height).toBe(150);
    });

    it('should allow optional text and styling properties', () => {
      const boxDecoration: BoxDecoration = createTestBoxDecoration({
        text: 'Grouping Box',
        text_h_align: 'CENTER',
        text_v_align: 'TOP',
        text_font_size: 14,
        text_font_weight: 'bold',
        text_font_style: 'normal',
        text_color: '#000000',
        background_color: 'rgba(230,230,255,0.2)',
        line_color: '#9999FF',
        line_style: 'DASHED',
        line_weight: '2px',
        z_index: 50,
      });

      expect(boxDecoration.text).toBe('Grouping Box');
      expect(boxDecoration.text_h_align).toBe('CENTER');
      expect(boxDecoration.text_v_align).toBe('TOP');
      expect(boxDecoration.text_font_size).toBe(14);
      expect(boxDecoration.text_font_weight).toBe('bold');
      expect(boxDecoration.background_color).toBe('rgba(230,230,255,0.2)');
      expect(boxDecoration.line_color).toBe('#9999FF');
      expect(boxDecoration.line_style).toBe('DASHED');
      expect(boxDecoration.z_index).toBe(50);
    });

    it('should support all DecorationHAlign values', () => {
      const alignments: DecorationHAlign[] = ['LEFT', 'CENTER', 'RIGHT'];
      alignments.forEach((align) => {
        const boxDecoration: BoxDecoration = createTestBoxDecoration({
          text_h_align: align,
        });
        expect(boxDecoration.text_h_align).toBe(align);
      });
    });

    it('should support all DecorationVAlign values', () => {
      const alignments: DecorationVAlign[] = ['TOP', 'MIDDLE', 'BOTTOM'];
      alignments.forEach((align) => {
        const boxDecoration: BoxDecoration = createTestBoxDecoration({
          text_v_align: align,
        });
        expect(boxDecoration.text_v_align).toBe(align);
      });
    });
  });

  describe('LineDecoration interface structure validation', () => {
    it('should create a valid LineDecoration with required properties', () => {
      const lineDecoration: LineDecoration = createTestLineDecoration();

      expect(lineDecoration.id).toBe('dec_line_1');
      expect(lineDecoration.type).toBe('LINE');
      expect(lineDecoration.line_points).toHaveLength(2);
      expect(lineDecoration.line_points[0]).toEqual({ x: 100, y: 100 });
      expect(lineDecoration.line_points[1]).toEqual({ x: 200, y: 200 });
    });

    it('should allow optional text and styling properties', () => {
      const lineDecoration: LineDecoration = createTestLineDecoration({
        text: 'Annotated Line',
        label_pos_x: 150,
        label_pos_y: 150,
        text_font_size: 12,
        text_font_weight: 'normal',
        text_font_style: 'italic',
        text_color: '#333333',
        line_color: '#666666',
        line_style: 'DASHED',
        line_weight: '2px',
        arrow_start: 'NONE',
        arrow_end: 'ARROW',
        z_index: 120,
      });

      expect(lineDecoration.text).toBe('Annotated Line');
      expect(lineDecoration.label_pos_x).toBe(150);
      expect(lineDecoration.label_pos_y).toBe(150);
      expect(lineDecoration.arrow_start).toBe('NONE');
      expect(lineDecoration.arrow_end).toBe('ARROW');
      expect(lineDecoration.z_index).toBe(120);
    });

    it('should support all LineStyle values', () => {
      const styles: LineStyle[] = ['SOLID', 'DASHED', 'DOTTED'];
      styles.forEach((style) => {
        const lineDecoration: LineDecoration = createTestLineDecoration({
          line_style: style,
        });
        expect(lineDecoration.line_style).toBe(style);
      });
    });

    it('should support all ArrowType values', () => {
      const arrowTypes: ArrowType[] = ['NONE', 'ARROW'];
      arrowTypes.forEach((arrowType) => {
        const lineDecoration: LineDecoration = createTestLineDecoration({
          arrow_start: arrowType,
          arrow_end: arrowType,
        });
        expect(lineDecoration.arrow_start).toBe(arrowType);
        expect(lineDecoration.arrow_end).toBe(arrowType);
      });
    });

    it('should support polylines with more than 2 points', () => {
      const lineDecoration: LineDecoration = createTestLineDecoration({
        line_points: [
          { x: 100, y: 100 },
          { x: 150, y: 120 },
          { x: 200, y: 150 },
          { x: 250, y: 200 },
        ],
      });

      expect(lineDecoration.line_points).toHaveLength(4);
    });
  });

  describe('Decoration union type discrimination', () => {
    it('should discriminate BOX decorations using type property', () => {
      const decoration: Decoration = createTestBoxDecoration();

      if (decoration.type === 'BOX') {
        // TypeScript should allow access to BOX-specific properties
        expect(decoration.pos_x).toBeDefined();
        expect(decoration.width).toBeDefined();
        expect(decoration.height).toBeDefined();
      } else {
        fail('Expected BOX decoration type');
      }
    });

    it('should discriminate LINE decorations using type property', () => {
      const decoration: Decoration = createTestLineDecoration();

      if (decoration.type === 'LINE') {
        // TypeScript should allow access to LINE-specific properties
        expect(decoration.line_points).toBeDefined();
      } else {
        fail('Expected LINE decoration type');
      }
    });

    it('should work with arrays of mixed decoration types', () => {
      const decorations: Decoration[] = [
        createTestBoxDecoration({ id: 'box-1' }),
        createTestLineDecoration({ id: 'line-1' }),
        createTestBoxDecoration({ id: 'box-2' }),
      ];

      const boxDecorations = decorations.filter(
        (d): d is BoxDecoration => d.type === 'BOX'
      );
      const lineDecorations = decorations.filter(
        (d): d is LineDecoration => d.type === 'LINE'
      );

      expect(boxDecorations).toHaveLength(2);
      expect(lineDecorations).toHaveLength(1);
    });
  });

  describe('Diagram interface with decorations array', () => {
    it('should accept empty decorations array', () => {
      const diagram: Diagram = createTestDiagramWithDecorations([]);

      expect(diagram.decorations).toBeDefined();
      expect(diagram.decorations).toHaveLength(0);
    });

    it('should accept mixed decorations array', () => {
      const decorations: Decoration[] = [
        createTestBoxDecoration({ id: 'dec-box-1' }),
        createTestLineDecoration({ id: 'dec-line-1' }),
      ];
      const diagram: Diagram = createTestDiagramWithDecorations(decorations);

      expect(diagram.decorations).toHaveLength(2);
      expect(diagram.decorations![0].type).toBe('BOX');
      expect(diagram.decorations![1].type).toBe('LINE');
    });

    it('should preserve decorations when diagram is spread', () => {
      const originalDecorations: Decoration[] = [
        createTestBoxDecoration({ id: 'dec-1', text: 'Original' }),
      ];
      const diagram: Diagram = createTestDiagramWithDecorations(originalDecorations);

      const updatedDiagram: Diagram = {
        ...diagram,
        name: 'Updated Diagram',
      };

      expect(updatedDiagram.decorations).toHaveLength(1);
      expect(updatedDiagram.decorations![0].text).toBe('Original');
    });

    it('should allow diagram without decorations field (backward compatibility)', () => {
      // Diagram without decorations field should be valid
      const diagramWithoutDecorations: Diagram = {
        id: 'test-diagram',
        name: 'Test Diagram',
        description: 'Test diagram without decorations',
        diagram_nodes: [],
        diagram_edges: [],
      };

      expect(diagramWithoutDecorations.decorations).toBeUndefined();
    });
  });

  describe('Default value generation for new decorations', () => {
    it('should provide default z-index for BOX decorations', () => {
      expect(DECORATION_DEFAULTS.BOX.z_index).toBe(50);
    });

    it('should provide default z-index for LINE decorations', () => {
      expect(DECORATION_DEFAULTS.LINE.z_index).toBe(120);
    });

    it('should provide default BOX styling', () => {
      expect(DECORATION_DEFAULTS.BOX.background_color).toBeDefined();
      expect(DECORATION_DEFAULTS.BOX.line_color).toBeDefined();
      expect(DECORATION_DEFAULTS.BOX.line_style).toBe('SOLID');
      expect(DECORATION_DEFAULTS.BOX.line_weight).toBeDefined();
    });

    it('should provide default LINE styling', () => {
      expect(DECORATION_DEFAULTS.LINE.line_color).toBeDefined();
      expect(DECORATION_DEFAULTS.LINE.line_style).toBe('SOLID');
      expect(DECORATION_DEFAULTS.LINE.line_weight).toBeDefined();
      expect(DECORATION_DEFAULTS.LINE.arrow_start).toBe('NONE');
      expect(DECORATION_DEFAULTS.LINE.arrow_end).toBe('NONE');
    });

    it('should provide minimum dimensions for BOX decorations', () => {
      expect(DECORATION_DEFAULTS.BOX.min_width).toBeGreaterThan(0);
      expect(DECORATION_DEFAULTS.BOX.min_height).toBeGreaterThan(0);
    });
  });

  describe('Decoration ID generation uniqueness', () => {
    it('should generate unique IDs for decorations', () => {
      const id1 = generateDecorationId('BOX');
      const id2 = generateDecorationId('BOX');
      const id3 = generateDecorationId('LINE');

      expect(id1).not.toBe(id2);
      expect(id2).not.toBe(id3);
      expect(id1).not.toBe(id3);
    });

    it('should generate IDs with correct prefix', () => {
      const boxId = generateDecorationId('BOX');
      const lineId = generateDecorationId('LINE');

      expect(boxId).toMatch(/^dec_box_/);
      expect(lineId).toMatch(/^dec_line_/);
    });

    it('should generate IDs that are valid strings', () => {
      const id = generateDecorationId('BOX');

      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
      // Should not contain problematic characters
      expect(id).toMatch(/^[a-zA-Z0-9_-]+$/);
    });
  });
});
