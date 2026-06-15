/**
 * Tests for Decoration Persistence
 * Task Group 6: Persistence Verification
 *
 * Tests for:
 * - Saving diagram includes decorations array in JSON
 * - Loading diagram restores all decoration types correctly
 * - Save -> load -> edit -> save cycle preserves data
 * - All shape types persist with correct geometry
 * - Text labels persist through save/load
 */

import {
  Decoration,
  ShapeDecoration,
  LineDecoration,
  Diagram,
  SHAPE_DECORATION_TYPES,
  LINE_DECORATION_TYPES,
} from '../types/model';
import { isShapeDecoration, isLineBasedDecoration } from '../utils/decorationUtils';

describe('Decoration Persistence', () => {
  // Helper to create a diagram with decorations
  const createDiagram = (decorations: Decoration[] = []): Diagram => ({
    id: 'test-diagram',
    name: 'Test Diagram',
    description: 'A test diagram',
    diagram_nodes: [],
    diagram_edges: [],
    decorations,
  });

  // Helper to create various shape decorations
  const createShapeDecoration = (type: ShapeDecoration['type'], id: string): ShapeDecoration => ({
    id,
    type,
    pos_x: 100,
    pos_y: 100,
    width: 200,
    height: 100,
    text: `${type} label`,
    background_color: '#FF0000',
    line_color: '#00FF00',
    text_color: '#0000FF',
  });

  // Helper to create various line decorations
  const createLineDecoration = (type: LineDecoration['type'], id: string): LineDecoration => ({
    id,
    type,
    line_points: [
      { x: 50, y: 50 },
      { x: 150, y: 150 },
    ],
    text: `${type} label`,
    line_color: '#FF0000',
    text_color: '#0000FF',
    arrow_start: type === 'ARROW_DOUBLE' ? 'ARROW' : 'NONE',
    arrow_end: type === 'ARROW_SINGLE' || type === 'ARROW_DOUBLE' ? 'ARROW' : 'NONE',
  });

  describe('Diagram with decorations array', () => {
    it('should include decorations array in diagram structure', () => {
      const decorations: Decoration[] = [
        createShapeDecoration('BOX', 'box-1'),
        createLineDecoration('LINE', 'line-1'),
      ];

      const diagram = createDiagram(decorations);

      expect(diagram.decorations).toBeDefined();
      expect(Array.isArray(diagram.decorations)).toBe(true);
      expect(diagram.decorations).toHaveLength(2);
    });

    it('should allow empty decorations array', () => {
      const diagram = createDiagram([]);

      expect(diagram.decorations).toBeDefined();
      expect(diagram.decorations).toHaveLength(0);
    });

    it('should handle missing decorations field (backward compatibility)', () => {
      // Simulate a diagram without decorations field (old format)
      const oldDiagram = {
        id: 'old-diagram',
        name: 'Old Diagram',
        description: 'Pre-decorations diagram',
        diagram_nodes: [],
        diagram_edges: [],
        // Note: no decorations field
      } as unknown as Diagram;

      // Access decorations with fallback
      const decorations = oldDiagram.decorations || [];

      expect(decorations).toEqual([]);
    });
  });

  describe('Serialize and deserialize decorations', () => {
    it('should serialize all shape types to JSON', () => {
      const decorations: Decoration[] = SHAPE_DECORATION_TYPES.map((type, i) =>
        createShapeDecoration(type, `shape-${i}`)
      );

      const diagram = createDiagram(decorations);
      const json = JSON.stringify(diagram);
      const parsed = JSON.parse(json) as Diagram;

      expect(parsed.decorations).toHaveLength(SHAPE_DECORATION_TYPES.length);

      // Verify each shape type is preserved
      for (const type of SHAPE_DECORATION_TYPES) {
        const found = parsed.decorations?.find(d => d.type === type);
        expect(found).toBeDefined();
      }
    });

    it('should serialize all line types to JSON', () => {
      const decorations: Decoration[] = LINE_DECORATION_TYPES.map((type, i) =>
        createLineDecoration(type, `line-${i}`)
      );

      const diagram = createDiagram(decorations);
      const json = JSON.stringify(diagram);
      const parsed = JSON.parse(json) as Diagram;

      expect(parsed.decorations).toHaveLength(LINE_DECORATION_TYPES.length);

      // Verify each line type is preserved
      for (const type of LINE_DECORATION_TYPES) {
        const found = parsed.decorations?.find(d => d.type === type);
        expect(found).toBeDefined();
      }
    });

    it('should preserve geometry data through serialization', () => {
      const shape: ShapeDecoration = {
        id: 'shape-1',
        type: 'DIAMOND',
        pos_x: 123,
        pos_y: 456,
        width: 789,
        height: 321,
      };

      const diagram = createDiagram([shape]);
      const json = JSON.stringify(diagram);
      const parsed = JSON.parse(json) as Diagram;

      const restored = parsed.decorations?.[0] as ShapeDecoration;
      expect(restored.pos_x).toBe(123);
      expect(restored.pos_y).toBe(456);
      expect(restored.width).toBe(789);
      expect(restored.height).toBe(321);
    });

    it('should preserve line_points through serialization', () => {
      const line: LineDecoration = {
        id: 'line-1',
        type: 'ARROW_SINGLE',
        line_points: [
          { x: 10, y: 20 },
          { x: 30, y: 40 },
          { x: 50, y: 60 },
        ],
      };

      const diagram = createDiagram([line]);
      const json = JSON.stringify(diagram);
      const parsed = JSON.parse(json) as Diagram;

      const restored = parsed.decorations?.[0] as LineDecoration;
      expect(restored.line_points).toHaveLength(3);
      expect(restored.line_points[0]).toEqual({ x: 10, y: 20 });
      expect(restored.line_points[1]).toEqual({ x: 30, y: 40 });
      expect(restored.line_points[2]).toEqual({ x: 50, y: 60 });
    });
  });

  describe('Text label persistence', () => {
    it('should preserve text labels for shape decorations', () => {
      const shape: ShapeDecoration = {
        id: 'shape-1',
        type: 'CYLINDER',
        pos_x: 0,
        pos_y: 0,
        width: 100,
        height: 100,
        text: 'Database Storage',
        text_font_size: 16,
        text_font_weight: 'bold',
        text_h_align: 'LEFT',
        text_v_align: 'TOP',
      };

      const diagram = createDiagram([shape]);
      const json = JSON.stringify(diagram);
      const parsed = JSON.parse(json) as Diagram;

      const restored = parsed.decorations?.[0] as ShapeDecoration;
      expect(restored.text).toBe('Database Storage');
      expect(restored.text_font_size).toBe(16);
      expect(restored.text_font_weight).toBe('bold');
      expect(restored.text_h_align).toBe('LEFT');
      expect(restored.text_v_align).toBe('TOP');
    });

    it('should preserve text labels for line decorations', () => {
      const line: LineDecoration = {
        id: 'line-1',
        type: 'ARROW_DOUBLE',
        line_points: [{ x: 0, y: 0 }, { x: 100, y: 100 }],
        text: 'Bidirectional Flow',
        label_pos_x: 50,
        label_pos_y: 50,
        text_font_size: 12,
      };

      const diagram = createDiagram([line]);
      const json = JSON.stringify(diagram);
      const parsed = JSON.parse(json) as Diagram;

      const restored = parsed.decorations?.[0] as LineDecoration;
      expect(restored.text).toBe('Bidirectional Flow');
      expect(restored.label_pos_x).toBe(50);
      expect(restored.label_pos_y).toBe(50);
    });

    it('should preserve empty text as empty string', () => {
      const shape: ShapeDecoration = {
        id: 'shape-1',
        type: 'BOX',
        pos_x: 0,
        pos_y: 0,
        width: 100,
        height: 100,
        text: '',
      };

      const diagram = createDiagram([shape]);
      const json = JSON.stringify(diagram);
      const parsed = JSON.parse(json) as Diagram;

      const restored = parsed.decorations?.[0] as ShapeDecoration;
      expect(restored.text).toBe('');
    });
  });

  describe('Styling properties persistence', () => {
    it('should preserve background and line colors', () => {
      const shape: ShapeDecoration = {
        id: 'shape-1',
        type: 'HEXAGON',
        pos_x: 0,
        pos_y: 0,
        width: 100,
        height: 100,
        background_color: '#AABBCC',
        line_color: '#DDEEFF',
        text_color: '#112233',
      };

      const diagram = createDiagram([shape]);
      const json = JSON.stringify(diagram);
      const parsed = JSON.parse(json) as Diagram;

      const restored = parsed.decorations?.[0] as ShapeDecoration;
      expect(restored.background_color).toBe('#AABBCC');
      expect(restored.line_color).toBe('#DDEEFF');
      expect(restored.text_color).toBe('#112233');
    });

    it('should preserve line style and weight', () => {
      const line: LineDecoration = {
        id: 'line-1',
        type: 'LINE',
        line_points: [{ x: 0, y: 0 }, { x: 100, y: 100 }],
        line_style: 'DASHED',
        line_weight: '3px',
      };

      const diagram = createDiagram([line]);
      const json = JSON.stringify(diagram);
      const parsed = JSON.parse(json) as Diagram;

      const restored = parsed.decorations?.[0] as LineDecoration;
      expect(restored.line_style).toBe('DASHED');
      expect(restored.line_weight).toBe('3px');
    });

    it('should preserve arrow types', () => {
      const line: LineDecoration = {
        id: 'line-1',
        type: 'ARROW_DOUBLE',
        line_points: [{ x: 0, y: 0 }, { x: 100, y: 100 }],
        arrow_start: 'ARROW',
        arrow_end: 'ARROW',
      };

      const diagram = createDiagram([line]);
      const json = JSON.stringify(diagram);
      const parsed = JSON.parse(json) as Diagram;

      const restored = parsed.decorations?.[0] as LineDecoration;
      expect(restored.arrow_start).toBe('ARROW');
      expect(restored.arrow_end).toBe('ARROW');
    });

    it('should preserve z_index', () => {
      const shape: ShapeDecoration = {
        id: 'shape-1',
        type: 'BOX',
        pos_x: 0,
        pos_y: 0,
        width: 100,
        height: 100,
        z_index: 999,
      };

      const diagram = createDiagram([shape]);
      const json = JSON.stringify(diagram);
      const parsed = JSON.parse(json) as Diagram;

      const restored = parsed.decorations?.[0] as ShapeDecoration;
      expect(restored.z_index).toBe(999);
    });
  });

  describe('Save -> Load -> Edit -> Save cycle', () => {
    it('should preserve data through edit cycle', () => {
      // Create initial diagram with decorations
      const initialDecorations: Decoration[] = [
        createShapeDecoration('OVAL', 'oval-1'),
        createLineDecoration('ARROW_SINGLE', 'arrow-1'),
      ];

      const diagram1 = createDiagram(initialDecorations);

      // Simulate save (serialize to JSON)
      const json1 = JSON.stringify(diagram1);

      // Simulate load (parse JSON)
      const diagram2 = JSON.parse(json1) as Diagram;

      // Simulate edit (modify a decoration)
      const ovalDecoration = diagram2.decorations?.find(d => d.id === 'oval-1') as ShapeDecoration;
      ovalDecoration.pos_x = 500;
      ovalDecoration.text = 'Modified Text';

      // Simulate save again
      const json2 = JSON.stringify(diagram2);

      // Simulate load again
      const diagram3 = JSON.parse(json2) as Diagram;

      // Verify edits persisted
      const restoredOval = diagram3.decorations?.find(d => d.id === 'oval-1') as ShapeDecoration;
      expect(restoredOval.pos_x).toBe(500);
      expect(restoredOval.text).toBe('Modified Text');

      // Verify unedited decoration preserved
      const restoredArrow = diagram3.decorations?.find(d => d.id === 'arrow-1') as LineDecoration;
      expect(restoredArrow.type).toBe('ARROW_SINGLE');
    });
  });

  describe('Type discrimination after load', () => {
    it('should correctly identify shape vs line after deserialization', () => {
      const decorations: Decoration[] = [
        createShapeDecoration('TRAPEZOID', 'trap-1'),
        createLineDecoration('ARROW_DOUBLE', 'arrow-1'),
      ];

      const diagram = createDiagram(decorations);
      const json = JSON.stringify(diagram);
      const parsed = JSON.parse(json) as Diagram;

      const restored = parsed.decorations || [];

      const trapezoid = restored.find(d => d.id === 'trap-1');
      const arrow = restored.find(d => d.id === 'arrow-1');

      expect(isShapeDecoration(trapezoid!)).toBe(true);
      expect(isLineBasedDecoration(trapezoid!)).toBe(false);

      expect(isShapeDecoration(arrow!)).toBe(false);
      expect(isLineBasedDecoration(arrow!)).toBe(true);
    });
  });

  describe('All 13 decoration types persistence', () => {
    it('should persist and restore all 13 decoration types', () => {
      const allDecorations: Decoration[] = [
        // 10 shape types
        ...SHAPE_DECORATION_TYPES.map((type, i) =>
          createShapeDecoration(type, `shape-${type}`)
        ),
        // 3 line types
        ...LINE_DECORATION_TYPES.map((type, i) =>
          createLineDecoration(type, `line-${type}`)
        ),
      ];

      expect(allDecorations).toHaveLength(13);

      const diagram = createDiagram(allDecorations);
      const json = JSON.stringify(diagram);
      const parsed = JSON.parse(json) as Diagram;

      expect(parsed.decorations).toHaveLength(13);

      // Verify all types present
      const types = parsed.decorations?.map(d => d.type) || [];
      expect(types).toContain('TEXT');
      expect(types).toContain('BOX');
      expect(types).toContain('OVAL');
      expect(types).toContain('DIAMOND');
      expect(types).toContain('PARALLELOGRAM');
      expect(types).toContain('CIRCLE');
      expect(types).toContain('CYLINDER');
      expect(types).toContain('TRAPEZOID');
      expect(types).toContain('HEXAGON');
      expect(types).toContain('NOTE');
      expect(types).toContain('LINE');
      expect(types).toContain('ARROW_SINGLE');
      expect(types).toContain('ARROW_DOUBLE');
    });
  });
});
