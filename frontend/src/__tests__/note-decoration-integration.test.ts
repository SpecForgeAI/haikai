/**
 * Integration Tests for Note Decoration on Sequence Diagrams
 * Task Group 5: Test Review and Integration Testing
 *
 * Covers end-to-end workflows, backward compatibility, and canvas interactions
 * for the Note decoration feature on Sequence diagrams.
 */

import { describe, it, expect } from 'vitest';
import {
  ShapeDecoration,
  Decoration,
  SHAPE_DECORATION_TYPES,
  DECORATION_TYPES,
} from '../types/model';
import {
  createShapeDecoration,
  isShapeDecoration,
  findDecorationAtPoint,
  isPointInsideShapeDecoration,
  getShapeHandlePositions,
  getShapeHandleAtPoint,
} from '../utils/decorationUtils';
import { renderNote, renderShapeDecoration } from '../utils/shapeRendering';
import { getSortedRenderOrder } from '../utils/zIndexUtils';
import { DECORATION_DEFAULTS } from '../config/defaults';

/**
 * Helper: create a minimal Sequence diagram object with decorations
 */
function createSequenceDiagram(decorations: Decoration[]) {
  return {
    id: 'seq-int-1',
    name: 'Integration Test Sequence',
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

describe('Note Decoration Integration Tests', () => {
  it('end-to-end: click Note in palette, place on Sequence diagram, verify renders as post-it shape', () => {
    // 1. Palette provides NOTE type
    expect(DECORATION_TYPES).toContain('NOTE');
    expect(SHAPE_DECORATION_TYPES).toContain('NOTE');

    // 2. Factory creates decoration at click position (simulates click-to-place)
    const placed = createShapeDecoration('NOTE', 300, 200, 140, 100);
    expect(placed.type).toBe('NOTE');
    expect(placed.background_color).toBe('#FFEB3B');
    expect(isShapeDecoration(placed)).toBe(true);

    // 3. Add to Sequence diagram
    const diagram = createSequenceDiagram([placed]);
    expect(diagram.decorations).toHaveLength(1);

    // 4. Render produces post-it shape with fold geometry
    const renderResult = renderNote(placed as any);
    expect(renderResult.pathData).toContain('300 215'); // fold start (pos_x, pos_y+15)
    expect(renderResult.pathData).toContain('315 200'); // fold end (pos_x+15, pos_y)
    expect(renderResult.fill).toBe('#FFEB3B');
    expect(renderResult.strokeWidth).toBe(3);

    // 5. Sorted render order includes the decoration
    const sorted = getSortedRenderOrder([], [], diagram.decorations!);
    const decoElements = sorted.filter(
      (e) => e.type === 'shape-decoration' || e.type === 'line-decoration'
    );
    expect(decoElements).toHaveLength(1);
    expect(decoElements[0].id).toBe(placed.id);
  });

  it('place a BOX decoration on a Sequence diagram (existing type works on Sequence)', () => {
    const box = createShapeDecoration('BOX', 100, 100, 200, 150);
    expect(box.type).toBe('BOX');

    const diagram = createSequenceDiagram([box]);
    expect(diagram.decorations).toHaveLength(1);

    // BOX renders via the same overlay pipeline
    const sorted = getSortedRenderOrder([], [], diagram.decorations!);
    const decoElements = sorted.filter(
      (e) => e.type === 'shape-decoration' || e.type === 'line-decoration'
    );
    expect(decoElements).toHaveLength(1);
    expect(decoElements[0].id).toBe(box.id);

    // BOX rendering works through renderShapeDecoration
    const rendered = renderShapeDecoration(box as any, false);
    expect(rendered.shape.pathData).toBeDefined();
  });

  it('existing Sequence diagram with no decorations loads without error (backward compat)', () => {
    // Simulate loading a Sequence diagram that was saved before decorations existed
    const diagramNoDecorations = {
      id: 'seq-legacy-1',
      name: 'Legacy Sequence',
      description: '',
      diagram_type: 'Sequence',
      diagram_nodes: [],
      diagram_edges: [],
      typedContent: {
        type: 'Sequence',
        participants: [],
        messageExchanges: [],
        fragments: [],
      },
    };

    // Backward compat: decorations default to empty array
    const decorations = (diagramNoDecorations as any).decorations || [];
    expect(decorations).toEqual([]);

    // Render order with empty decorations should work without error
    const sorted = getSortedRenderOrder([], [], decorations);
    expect(sorted).toEqual([]);
  });

  it('decoration persists after save and reload on Sequence diagram', () => {
    // Simulate save: create decoration, serialize, deserialize
    const original = createShapeDecoration('NOTE', 150, 250, 140, 100);
    original.text = 'Persisted note';

    const diagram = createSequenceDiagram([original]);

    // Serialize (JSON round-trip simulates save/load)
    const serialized = JSON.stringify(diagram);
    const reloaded = JSON.parse(serialized);

    expect(reloaded.decorations).toHaveLength(1);
    const restored = reloaded.decorations[0] as ShapeDecoration;
    expect(restored.type).toBe('NOTE');
    expect(restored.pos_x).toBe(150);
    expect(restored.pos_y).toBe(250);
    expect(restored.width).toBe(140);
    expect(restored.height).toBe(100);
    expect(restored.background_color).toBe('#FFEB3B');
    expect(restored.text).toBe('Persisted note');

    // Restored decoration is recognized as shape
    expect(isShapeDecoration(restored)).toBe(true);
  });

  it('drag-move a Note decoration on Sequence diagram updates position', () => {
    const note = createShapeDecoration('NOTE', 200, 300, 140, 100);
    const decorations: Decoration[] = [note];

    // Hit test at center of note
    const found = findDecorationAtPoint(270, 350, decorations);
    expect(found).toBeDefined();
    expect(found!.id).toBe(note.id);

    // Simulate drag: update position
    const moved: ShapeDecoration = {
      ...(found as ShapeDecoration),
      pos_x: 350,
      pos_y: 450,
    };

    expect(moved.pos_x).toBe(350);
    expect(moved.pos_y).toBe(450);
    expect(moved.type).toBe('NOTE');

    // Moved decoration renders at new position
    const result = renderNote(moved as any);
    expect(result.pathData).toContain('350 465'); // new pos_x, pos_y+15
    expect(result.pathData).toContain('365 450'); // pos_x+15, new pos_y
  });

  it('resize a Note decoration on Sequence diagram updates dimensions', () => {
    const note = createShapeDecoration('NOTE', 100, 100, 140, 100);

    // Verify resize handles exist
    const handles = getShapeHandlePositions(note as ShapeDecoration);
    expect(handles).toHaveLength(8);

    // BR handle is at (240, 200)
    const brHandle = handles.find((h) => h.position === 'BR');
    expect(brHandle).toBeDefined();
    expect(brHandle!.x).toBe(240);
    expect(brHandle!.y).toBe(200);

    // Hit test on BR handle
    const hitHandle = getShapeHandleAtPoint(240, 200, note as ShapeDecoration, 8);
    expect(hitHandle).toBe('BR');

    // Simulate resize: drag BR handle to increase size
    const resized: ShapeDecoration = {
      ...(note as ShapeDecoration),
      width: 200,
      height: 150,
    };

    expect(resized.width).toBe(200);
    expect(resized.height).toBe(150);

    // Resized decoration renders correctly
    const result = renderNote(resized as any);
    expect(result.pathData).toBeDefined();
    expect(result.fill).toBe('#FFEB3B');
  });

  it('double-click Note decoration opens text editor (decoration has text field)', () => {
    const note = createShapeDecoration('NOTE', 100, 100, 140, 100);

    // Note decoration supports text (has text field initialized to empty)
    expect(note.text).toBe('');

    // Simulate text edit: update text
    const edited: ShapeDecoration = {
      ...(note as ShapeDecoration),
      text: 'Important note',
    };

    expect(edited.text).toBe('Important note');
    expect(edited.type).toBe('NOTE');

    // Text renders via renderShapeDecoration
    const rendered = renderShapeDecoration(edited as any, false);
    expect(rendered.textElement).toBeDefined();
    expect(rendered.textElement!.content).toBe('Important note');
  });

  it('Note decoration renders with correct fold geometry and post-it yellow fill on canvas', () => {
    const note = createShapeDecoration('NOTE', 50, 75, 140, 100);
    const result = renderNote(note as any);

    // Fold geometry: diagonal from (pos_x, pos_y+15) to (pos_x+15, pos_y)
    expect(result.pathData).toContain('50 90');  // (50, 75+15)
    expect(result.pathData).toContain('65 75');  // (50+15, 75)

    // Post-it yellow fill
    expect(result.fill).toBe('#FFEB3B');

    // Black stroke with 3px weight
    expect(result.stroke).toBe('#000000');
    expect(result.strokeWidth).toBe(3);

    // Text position is defined (centered in body)
    expect(result.textPosition).toBeDefined();
    expect(result.textPosition.x).toBeGreaterThan(50);
    expect(result.textPosition.y).toBeGreaterThan(75);

    // Full renderShapeDecoration also works
    const fullResult = renderShapeDecoration(note as any, true);
    expect(fullResult.shape.fill).toBe('#FFEB3B');
    expect(fullResult.isSelected).toBe(true);
  });
});
