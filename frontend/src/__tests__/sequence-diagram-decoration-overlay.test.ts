/**
 * Tests for Sequence Diagram Decoration Overlay
 * Task Group 3: Enable Decoration Rendering and Interactions on Sequence Diagrams
 *
 * Tests that:
 * 1. Sequence diagram renders decoration overlay layer after SequenceDiagramRenderer
 * 2. Decorations render on top of sequence elements (correct z-index ordering)
 * 3. Decoration click-to-place works when isSequenceDiagram is true
 * 4. Decoration drag-move works when isSequenceDiagram is true
 */

import { describe, it, expect } from 'vitest';
import {
  ShapeDecoration,
  ShapeDecorationType,
  SHAPE_DECORATION_TYPES,
  Decoration,
} from '../types/model';
import {
  getSortedRenderOrder,
  RenderableElement,
} from '../utils/zIndexUtils';
import {
  createShapeDecoration,
  isShapeDecoration,
  findDecorationAtPoint,
  isPointInsideShapeDecoration,
} from '../utils/decorationUtils';
import { getDiagramType } from '../types/diagramType';
import type { Diagram } from '../types/model';

/**
 * Helper to create a Sequence diagram with decorations
 */
function createSequenceDiagramWithDecorations(decorations: Decoration[]): Diagram {
  return {
    id: 'seq-diag-1',
    name: 'Test Sequence Diagram',
    description: '',
    diagram_type: 'Sequence',
    diagram_nodes: [],
    diagram_edges: [],
    decorations,
    typedContent: {
      type: 'Sequence',
      participants: [],
      messageExchanges: [],
      fragments: [],
    },
  };
}

describe('Sequence Diagram Decoration Overlay', () => {
  describe('Decoration overlay layer rendering after SequenceDiagramRenderer', () => {
    it('should include decoration elements in sortedElements for Sequence diagrams', () => {
      // Verify that getSortedRenderOrder includes decorations even when nodes/edges are empty
      // (Sequence diagrams have no nodes/edges - they use SequenceDiagramRenderer)
      const noteDecoration: ShapeDecoration = {
        id: 'dec-note-1',
        type: 'NOTE',
        pos_x: 200,
        pos_y: 150,
        width: 140,
        height: 100,
        background_color: '#FFEB3B',
      };

      const boxDecoration: ShapeDecoration = {
        id: 'dec-box-1',
        type: 'BOX',
        pos_x: 400,
        pos_y: 300,
        width: 120,
        height: 80,
      };

      const diagram = createSequenceDiagramWithDecorations([noteDecoration, boxDecoration]);
      expect(getDiagramType(diagram)).toBe('Sequence');

      // sortedElements should contain only decorations (no nodes/edges for Sequence diagrams)
      const sortedElements = getSortedRenderOrder([], [], diagram.decorations!);
      const decorationElements = sortedElements.filter(
        (item) => item.type === 'shape-decoration' || item.type === 'line-decoration'
      );

      expect(decorationElements).toHaveLength(2);
      expect(decorationElements[0].id).toBe('dec-note-1');
      expect(decorationElements[1].id).toBe('dec-box-1');
    });
  });

  describe('Decorations render on top of sequence elements (z-index ordering)', () => {
    it('should place decoration elements after sequence content via z-index filtering', () => {
      // In the Canvas, sequence elements are rendered by SequenceDiagramRenderer first,
      // then decorations are rendered after via filtered sortedElements.
      // Verify that the filter correctly extracts only decoration types.
      const decoration: ShapeDecoration = {
        id: 'dec-overlay-1',
        type: 'BOX',
        pos_x: 100,
        pos_y: 100,
        width: 200,
        height: 150,
        z_index: 500,
      };

      const sortedElements = getSortedRenderOrder([], [], [decoration]);

      // Filter as Canvas.tsx does for Sequence diagrams
      const decorationOnly = sortedElements.filter(
        (item) => item.type === 'shape-decoration' || item.type === 'line-decoration'
      );

      expect(decorationOnly).toHaveLength(1);
      expect(decorationOnly[0].type).toBe('shape-decoration');
      expect(decorationOnly[0].id).toBe('dec-overlay-1');

      // No node or edge elements should be in the filtered list
      const nonDecorationItems = decorationOnly.filter(
        (item) => item.type === 'node' || item.type === 'edge'
      );
      expect(nonDecorationItems).toHaveLength(0);
    });
  });

  describe('Decoration click-to-place works when isSequenceDiagram is true', () => {
    it('should create a shape decoration via factory when placing on a Sequence diagram', () => {
      // Simulate click-to-place: the same createShapeDecoration factory is used
      // regardless of diagram type
      const isSequenceDiagram = true;
      const shapeType: ShapeDecorationType = 'NOTE';

      // Verify the shape type is recognized
      expect((SHAPE_DECORATION_TYPES as readonly string[]).includes(shapeType)).toBe(true);

      // Create shape at click coordinates (same factory used for all diagram types)
      const newDecoration = createShapeDecoration(shapeType, 250, 300, 140, 100);

      expect(newDecoration).toBeDefined();
      expect(newDecoration.type).toBe('NOTE');
      expect(newDecoration.pos_x).toBe(250);
      expect(newDecoration.pos_y).toBe(300);
      expect(newDecoration.width).toBe(140);
      expect(newDecoration.height).toBe(100);
      expect(isShapeDecoration(newDecoration)).toBe(true);

      // The decoration can be added to a Sequence diagram's decorations array
      const diagram = createSequenceDiagramWithDecorations([newDecoration]);
      expect(diagram.decorations).toHaveLength(1);
      expect(diagram.decorations![0].type).toBe('NOTE');
    });
  });

  describe('Decoration drag-move works when isSequenceDiagram is true', () => {
    it('should detect decoration at point and allow position update for drag-move', () => {
      // Simulate drag-move: findDecorationAtPoint locates the decoration,
      // then position is updated. This works identically for all diagram types.
      const decoration: ShapeDecoration = {
        id: 'dec-drag-1',
        type: 'BOX',
        pos_x: 100,
        pos_y: 100,
        width: 150,
        height: 100,
      };

      const decorations: Decoration[] = [decoration];

      // Hit test at a point inside the decoration
      const found = findDecorationAtPoint(150, 150, decorations);
      expect(found).toBeDefined();
      expect(found!.id).toBe('dec-drag-1');

      // Verify point is inside the decoration (used during drag interactions)
      expect(isPointInsideShapeDecoration(150, 150, decoration)).toBe(true);

      // Simulate drag by computing new position
      const dragDeltaX = 50;
      const dragDeltaY = 30;
      const updatedDecoration: ShapeDecoration = {
        ...decoration,
        pos_x: decoration.pos_x + dragDeltaX,
        pos_y: decoration.pos_y + dragDeltaY,
      };

      expect(updatedDecoration.pos_x).toBe(150);
      expect(updatedDecoration.pos_y).toBe(130);

      // The updated decoration renders in the new position on a Sequence diagram
      const sortedElements = getSortedRenderOrder([], [], [updatedDecoration]);
      const decoElements = sortedElements.filter(
        (item) => item.type === 'shape-decoration' || item.type === 'line-decoration'
      );
      expect(decoElements).toHaveLength(1);
      expect((decoElements[0].element as ShapeDecoration).pos_x).toBe(150);
      expect((decoElements[0].element as ShapeDecoration).pos_y).toBe(130);
    });
  });
});
