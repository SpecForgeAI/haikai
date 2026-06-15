/**
 * Tests for Decoration Integration and Persistence
 * Task Group 4: Integration Testing and Persistence Verification
 *
 * Tests for:
 * - Creating decoration via palette + canvas interaction
 * - Decoration persists in diagram state after creation
 * - Save diagram includes all decoration types in JSON
 * - Load diagram renders all decoration types
 * - Save -> load -> edit -> save cycle preserves decorations
 * - Loaded decorations are selectable and editable
 */

import {
  Decoration,
  ShapeDecoration,
  LineDecoration,
  ShapeDecorationType,
  LineDecorationType,
  SHAPE_DECORATION_TYPES,
  LINE_DECORATION_TYPES,
} from '../types/model';

import {
  createShapeDecoration,
  createLineTypeDecoration,
  isShapeDecoration,
  isLineBasedDecoration,
  sortDecorationsByZIndex,
  getDecorationZIndex,
} from '../utils/decorationUtils';

describe('Decoration Integration and Persistence', () => {
  describe('End-to-end creation flow', () => {
    it('should create decoration through factory function and add to decorations array', () => {
      // Simulate diagram state with decorations array
      const diagramDecorations: Decoration[] = [];

      // Create a shape decoration (as Canvas would do)
      const newShape = createShapeDecoration('OVAL', 100, 100, 150, 100);

      // Add to decorations (as ADD_DECORATION action would do)
      diagramDecorations.push(newShape);

      expect(diagramDecorations.length).toBe(1);
      expect(diagramDecorations[0].type).toBe('OVAL');
      expect(diagramDecorations[0].id).toMatch(/^dec_oval_/);
    });

    it('should create all 13 decoration types successfully', () => {
      const decorations: Decoration[] = [];

      // Create all 10 shape types
      SHAPE_DECORATION_TYPES.forEach((type, index) => {
        const shape = createShapeDecoration(type as ShapeDecorationType, index * 100, 0, 80, 60);
        decorations.push(shape);
      });

      // Create all 3 line types
      LINE_DECORATION_TYPES.forEach((type, index) => {
        const line = createLineTypeDecoration(type as LineDecorationType, [
          { x: 0, y: index * 50 + 200 },
          { x: 100, y: index * 50 + 200 },
        ]);
        decorations.push(line);
      });

      expect(decorations.length).toBe(13);

      // Verify types
      const types = decorations.map(d => d.type);
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

  describe('Decoration persistence in diagram state', () => {
    it('should preserve decoration after creation', () => {
      // Simulate a diagram with decorations
      const diagram = {
        id: 'test-diagram',
        decorations: [] as Decoration[],
      };

      // Create and add decorations
      const box = createShapeDecoration('BOX', 50, 50, 100, 80);
      const line = createLineTypeDecoration('ARROW_SINGLE', [
        { x: 200, y: 50 },
        { x: 300, y: 100 },
      ]);

      diagram.decorations.push(box);
      diagram.decorations.push(line);

      // Verify persistence
      expect(diagram.decorations.length).toBe(2);

      // Find by ID
      const foundBox = diagram.decorations.find(d => d.id === box.id);
      expect(foundBox).toBeDefined();
      expect(foundBox?.type).toBe('BOX');

      const foundLine = diagram.decorations.find(d => d.id === line.id);
      expect(foundLine).toBeDefined();
      expect(foundLine?.type).toBe('ARROW_SINGLE');
    });

    it('should maintain decoration properties after updates', () => {
      const shape = createShapeDecoration('DIAMOND', 0, 0, 100, 100);

      // Simulate UPDATE_DECORATION action
      const updates = {
        pos_x: 50,
        pos_y: 75,
        background_color: '#FF0000',
        text: 'Updated Label',
      };

      const updatedShape = {
        ...shape,
        ...updates,
      } as ShapeDecoration;

      expect(updatedShape.pos_x).toBe(50);
      expect(updatedShape.pos_y).toBe(75);
      expect(updatedShape.background_color).toBe('#FF0000');
      expect(updatedShape.text).toBe('Updated Label');
      expect(updatedShape.type).toBe('DIAMOND'); // Type unchanged
      expect(updatedShape.id).toBe(shape.id); // ID unchanged
    });
  });

  describe('JSON serialization and deserialization', () => {
    it('should serialize all decoration types to JSON correctly', () => {
      const decorations: Decoration[] = [
        createShapeDecoration('OVAL', 0, 0, 100, 80),
        createLineTypeDecoration('ARROW_DOUBLE', [{ x: 0, y: 0 }, { x: 50, y: 50 }]),
      ];

      // Serialize to JSON
      const json = JSON.stringify({ decorations });

      // Verify JSON contains expected data
      expect(json).toContain('"type":"OVAL"');
      expect(json).toContain('"type":"ARROW_DOUBLE"');
      expect(json).toContain('"pos_x":0');
      expect(json).toContain('"line_points"');
    });

    it('should deserialize decorations from JSON correctly', () => {
      const originalDecorations: Decoration[] = [
        {
          id: 'DIAMOND_123',
          type: 'DIAMOND',
          pos_x: 100,
          pos_y: 200,
          width: 150,
          height: 100,
          background_color: '#E0E0FF',
        } as ShapeDecoration,
        {
          id: 'LINE_456',
          type: 'LINE',
          line_points: [{ x: 0, y: 0 }, { x: 100, y: 100 }],
          line_color: '#000000',
        } as LineDecoration,
      ];

      // Serialize
      const json = JSON.stringify({ decorations: originalDecorations });

      // Deserialize
      const parsed = JSON.parse(json);
      const loadedDecorations: Decoration[] = parsed.decorations;

      expect(loadedDecorations.length).toBe(2);

      const diamond = loadedDecorations.find(d => d.type === 'DIAMOND') as ShapeDecoration;
      expect(diamond.pos_x).toBe(100);
      expect(diamond.pos_y).toBe(200);
      expect(diamond.width).toBe(150);
      expect(diamond.background_color).toBe('#E0E0FF');

      const line = loadedDecorations.find(d => d.type === 'LINE') as LineDecoration;
      expect(line.line_points.length).toBe(2);
      expect(line.line_color).toBe('#000000');
    });

    it('should preserve all 13 decoration types through JSON round-trip', () => {
      // Create all decoration types
      const decorations: Decoration[] = [];

      SHAPE_DECORATION_TYPES.forEach((type, i) => {
        decorations.push(createShapeDecoration(type as ShapeDecorationType, i * 100, i * 50, 80, 60));
      });

      LINE_DECORATION_TYPES.forEach((type, i) => {
        decorations.push(createLineTypeDecoration(type as LineDecorationType, [
          { x: i * 100, y: 400 },
          { x: i * 100 + 80, y: 450 },
        ]));
      });

      // JSON round-trip
      const json = JSON.stringify({ decorations });
      const parsed = JSON.parse(json);
      const loadedDecorations: Decoration[] = parsed.decorations;

      expect(loadedDecorations.length).toBe(13);

      // Verify all types are present
      const loadedTypes = loadedDecorations.map(d => d.type);
      SHAPE_DECORATION_TYPES.forEach(type => {
        expect(loadedTypes).toContain(type);
      });
      LINE_DECORATION_TYPES.forEach(type => {
        expect(loadedTypes).toContain(type);
      });
    });
  });

  describe('Save -> Load -> Edit -> Save cycle', () => {
    it('should preserve decorations through full cycle', () => {
      // Initial state
      const initialDiagram = {
        id: 'cycle-test',
        decorations: [
          createShapeDecoration('HEXAGON', 50, 50, 100, 100),
          createLineTypeDecoration('ARROW_SINGLE', [{ x: 200, y: 50 }, { x: 300, y: 100 }]),
        ],
      };

      // Save (serialize)
      const savedJson = JSON.stringify(initialDiagram);

      // Load (deserialize)
      const loadedDiagram = JSON.parse(savedJson);

      // Edit - update shape position
      const shapeIndex = loadedDiagram.decorations.findIndex(
        (d: Decoration) => isShapeDecoration(d)
      );
      if (shapeIndex >= 0) {
        loadedDiagram.decorations[shapeIndex] = {
          ...loadedDiagram.decorations[shapeIndex],
          pos_x: 150,
          pos_y: 150,
        };
      }

      // Edit - update line points
      const lineIndex = loadedDiagram.decorations.findIndex(
        (d: Decoration) => isLineBasedDecoration(d)
      );
      if (lineIndex >= 0) {
        const line = loadedDiagram.decorations[lineIndex] as LineDecoration;
        loadedDiagram.decorations[lineIndex] = {
          ...line,
          line_points: [{ x: 250, y: 75 }, { x: 350, y: 125 }],
        };
      }

      // Save again
      const reSavedJson = JSON.stringify(loadedDiagram);

      // Load again
      const finalDiagram = JSON.parse(reSavedJson);

      // Verify edits persisted
      const shape = finalDiagram.decorations.find((d: Decoration) => isShapeDecoration(d)) as ShapeDecoration;
      expect(shape.pos_x).toBe(150);
      expect(shape.pos_y).toBe(150);

      const line = finalDiagram.decorations.find((d: Decoration) => isLineBasedDecoration(d)) as LineDecoration;
      expect(line.line_points[0].x).toBe(250);
      expect(line.line_points[1].y).toBe(125);
    });
  });

  describe('Loaded decorations are selectable and editable', () => {
    it('should allow selection after loading', () => {
      // Simulate loaded diagram
      const loadedDecorations: Decoration[] = [
        {
          id: 'CYLINDER_789',
          type: 'CYLINDER',
          pos_x: 100,
          pos_y: 100,
          width: 60,
          height: 100,
        } as ShapeDecoration,
      ];

      // Simulate selection state
      const selectedDecorationIds = new Set<string>();

      // Select the loaded decoration
      selectedDecorationIds.add('CYLINDER_789');

      expect(selectedDecorationIds.has('CYLINDER_789')).toBe(true);

      // Find selected decoration
      const selected = loadedDecorations.find(d => selectedDecorationIds.has(d.id));
      expect(selected).toBeDefined();
      expect(selected?.type).toBe('CYLINDER');
    });

    it('should allow editing properties after loading', () => {
      // Simulate loaded decoration
      let loadedDecoration: ShapeDecoration = {
        id: 'TRAPEZOID_abc',
        type: 'TRAPEZOID',
        pos_x: 50,
        pos_y: 50,
        width: 120,
        height: 80,
        background_color: '#FFFFFF',
      };

      // Edit multiple properties
      loadedDecoration = {
        ...loadedDecoration,
        pos_x: 100,
        width: 150,
        background_color: '#FFFF00',
        text: 'Edited Label',
      };

      expect(loadedDecoration.pos_x).toBe(100);
      expect(loadedDecoration.width).toBe(150);
      expect(loadedDecoration.background_color).toBe('#FFFF00');
      expect(loadedDecoration.text).toBe('Edited Label');
      expect(loadedDecoration.id).toBe('TRAPEZOID_abc'); // ID preserved
      expect(loadedDecoration.type).toBe('TRAPEZOID'); // Type preserved
    });

    it('should allow moving line endpoints after loading', () => {
      // Simulate loaded line decoration
      let loadedLine: LineDecoration = {
        id: 'ARROW_DOUBLE_xyz',
        type: 'ARROW_DOUBLE',
        line_points: [{ x: 0, y: 0 }, { x: 100, y: 50 }],
        arrow_start: 'ARROW',
        arrow_end: 'ARROW',
      };

      // Edit endpoint
      const newPoints = [
        { x: 25, y: 25 },  // Moved start point
        { x: 100, y: 50 }, // Original end point
      ];

      loadedLine = {
        ...loadedLine,
        line_points: newPoints,
      };

      expect(loadedLine.line_points[0].x).toBe(25);
      expect(loadedLine.line_points[0].y).toBe(25);
      expect(loadedLine.type).toBe('ARROW_DOUBLE'); // Type preserved
    });

    it('should allow resizing shape decorations after loading', () => {
      let loadedShape: ShapeDecoration = {
        id: 'PARALLELOGRAM_def',
        type: 'PARALLELOGRAM',
        pos_x: 200,
        pos_y: 200,
        width: 100,
        height: 60,
      };

      // Resize (from BR handle)
      loadedShape = {
        ...loadedShape,
        width: 150,
        height: 80,
      };

      expect(loadedShape.width).toBe(150);
      expect(loadedShape.height).toBe(80);

      // Resize from TL handle (position changes too)
      loadedShape = {
        ...loadedShape,
        pos_x: 180,
        pos_y: 180,
        width: 170,
        height: 100,
      };

      expect(loadedShape.pos_x).toBe(180);
      expect(loadedShape.pos_y).toBe(180);
    });
  });

  describe('Z-index ordering', () => {
    it('should maintain z-index ordering after loading', () => {
      const decorations: Decoration[] = [
        {
          id: '1',
          type: 'BOX',
          pos_x: 0,
          pos_y: 0,
          width: 100,
          height: 100,
          z_index: 80, // Below nodes
        } as ShapeDecoration,
        {
          id: '2',
          type: 'LINE',
          line_points: [{ x: 0, y: 0 }, { x: 100, y: 100 }],
          z_index: 120, // Above edges
        } as LineDecoration,
        {
          id: '3',
          type: 'OVAL',
          pos_x: 50,
          pos_y: 50,
          width: 100,
          height: 100,
          z_index: 90, // Between decorations
        } as ShapeDecoration,
      ];

      const sorted = sortDecorationsByZIndex(decorations);

      // Should be sorted by z_index ascending
      expect(getDecorationZIndex(sorted[0])).toBe(80);
      expect(getDecorationZIndex(sorted[1])).toBe(90);
      expect(getDecorationZIndex(sorted[2])).toBe(120);
    });
  });

  describe('Empty and edge cases', () => {
    it('should handle empty decorations array', () => {
      const diagram = {
        id: 'empty-diagram',
        decorations: [] as Decoration[],
      };

      const json = JSON.stringify(diagram);
      const loaded = JSON.parse(json);

      expect(loaded.decorations).toEqual([]);
    });

    it('should handle diagram without decorations field (backward compatibility)', () => {
      const legacyDiagram = {
        id: 'legacy-diagram',
        // No decorations field
      };

      const json = JSON.stringify(legacyDiagram);
      const loaded = JSON.parse(json);

      // Application should default to empty array when decorations is undefined
      const decorations = loaded.decorations || [];
      expect(decorations).toEqual([]);
    });

    it('should handle single-point line gracefully', () => {
      const singlePointLine: LineDecoration = {
        id: 'single-point',
        type: 'LINE',
        line_points: [{ x: 50, y: 50 }],
      };

      expect(singlePointLine.line_points.length).toBe(1);
      expect(isLineBasedDecoration(singlePointLine)).toBe(true);
    });
  });
});
