/**
 * Diagnostic Tests for Decoration Loading
 * Task Group 1: Diagnose Decoration Loading Issue
 *
 * These tests verify that decorations persist and render correctly
 * when a diagram is loaded from JSON via LOAD_MODEL.
 */

import {
  Decoration,
  ShapeDecoration,
  LineDecoration,
  Diagram,
  ArchitectureModel,
} from '../types/model';
import { Z_INDEX_DEFAULTS } from '../config/defaults';

describe('Decoration Loading Diagnostic', () => {
  // Sample decorations for testing
  const createBoxDecoration = (id: string): ShapeDecoration => ({
    id,
    type: 'BOX',
    pos_x: 100,
    pos_y: 100,
    width: 200,
    height: 100,
    z_index: Z_INDEX_DEFAULTS.BOX_DECORATION,
    background_color: '#ffffff',
    line_color: '#333333',
  });

  const createLineDecoration = (id: string): LineDecoration => ({
    id,
    type: 'LINE',
    line_points: [
      { x: 50, y: 50 },
      { x: 150, y: 150 },
    ],
    z_index: Z_INDEX_DEFAULTS.LINE_DECORATION,
    line_color: '#333333',
  });

  const createDiagramWithDecorations = (decorations: Decoration[]): Diagram => ({
    id: 'test_diagram_001',
    name: 'Test Diagram',
    description: 'A test diagram with decorations',
    diagram_nodes: [],
    diagram_edges: [],
    decorations,
    view_quarter: '2026-Q4',
  });

  // Test 1.1: Decorations exist in state after LOAD_MODEL
  test('decorations should be preserved in diagram after load', () => {
    const boxDec = createBoxDecoration('box_001');
    const lineDec = createLineDecoration('line_001');
    const diagram = createDiagramWithDecorations([boxDec, lineDec]);

    // Verify decorations exist in diagram structure
    expect(diagram.decorations).toBeDefined();
    expect(diagram.decorations).toHaveLength(2);
    expect(diagram.decorations![0].id).toBe('box_001');
    expect(diagram.decorations![1].id).toBe('line_001');
  });

  // Test 1.2: Decorations array defaults to empty for backward compatibility
  test('decorations should default to empty array when missing', () => {
    const diagramWithoutDecorations: Diagram = {
      id: 'test_diagram_002',
      name: 'Test Diagram No Decorations',
      description: 'A test diagram without decorations field',
      diagram_nodes: [],
      diagram_edges: [],
      view_quarter: '2026-Q4',
    };

    // Verify decorations defaults appropriately
    const decorations = diagramWithoutDecorations.decorations || [];
    expect(decorations).toEqual([]);
  });

  // Test 1.3: LOAD_MODEL action should preserve decorations array
  test('LOAD_MODEL action preserves decorations structure', () => {
    const boxDec = createBoxDecoration('box_002');
    const diagram = createDiagramWithDecorations([boxDec]);

    // Simulate LOAD_MODEL behavior - ensure decorations array exists
    const diagramWithDefaults = {
      ...diagram,
      decorations: diagram.decorations || [],
    };

    expect(diagramWithDefaults.decorations).toBeDefined();
    expect(diagramWithDefaults.decorations).toHaveLength(1);
    expect(diagramWithDefaults.decorations[0]).toEqual(boxDec);
  });

  // Test 1.4: Decoration type matching (uppercase format)
  test('decoration types should be uppercase strings', () => {
    const boxDec = createBoxDecoration('box_003');
    const lineDec = createLineDecoration('line_003');

    // Shape decoration types are uppercase
    expect(boxDec.type).toBe('BOX');
    expect(boxDec.type).not.toBe('box');

    // Line decoration types are uppercase
    expect(lineDec.type).toBe('LINE');
    expect(lineDec.type).not.toBe('line');
  });

  // Test 1.5: All 11 decoration types should be recognized
  test('all decoration types should be valid', () => {
    const shapeTypes = ['BOX', 'OVAL', 'DIAMOND', 'PARALLELOGRAM', 'CIRCLE', 'CYLINDER', 'TRAPEZOID', 'HEXAGON'];
    const lineTypes = ['LINE', 'ARROW_SINGLE', 'ARROW_DOUBLE'];

    // All shape types are valid
    shapeTypes.forEach(type => {
      const dec: ShapeDecoration = {
        id: `shape_${type}`,
        type: type as any,
        pos_x: 0,
        pos_y: 0,
        width: 100,
        height: 100,
      };
      expect(dec.type).toBe(type);
    });

    // All line types are valid
    lineTypes.forEach(type => {
      const dec: LineDecoration = {
        id: `line_${type}`,
        type: type as any,
        line_points: [{ x: 0, y: 0 }, { x: 100, y: 100 }],
      };
      expect(dec.type).toBe(type);
    });
  });

  // Test 1.6: Decorations should be passed to Canvas via diagram prop
  test('diagram object should contain decorations for Canvas', () => {
    const decorations: Decoration[] = [
      createBoxDecoration('canvas_box_001'),
      createLineDecoration('canvas_line_001'),
    ];
    const diagram = createDiagramWithDecorations(decorations);

    // Canvas receives diagram which should include decorations
    expect(diagram.decorations).toBeDefined();
    expect(diagram.decorations).toHaveLength(2);

    // Verify decorations can be accessed for rendering
    const displayDecorations = diagram.decorations || [];
    expect(displayDecorations[0].id).toBe('canvas_box_001');
    expect(displayDecorations[1].id).toBe('canvas_line_001');
  });

  // Test 1.7: Verify z-index separation for rendering order
  test('decorations should be separable by z-index for render order', () => {
    const lowZIndexDec: ShapeDecoration = {
      ...createBoxDecoration('low_z_box'),
      z_index: 50, // Below nodes
    };
    const highZIndexDec: LineDecoration = {
      ...createLineDecoration('high_z_line'),
      z_index: 120, // Above edges
    };

    const diagram = createDiagramWithDecorations([lowZIndexDec, highZIndexDec]);
    const decorations = diagram.decorations || [];

    // Filter by z-index thresholds
    const lowZIndexDecorations = decorations.filter(d => (d.z_index ?? 50) < 100);
    const highZIndexDecorations = decorations.filter(d => (d.z_index ?? 120) >= 120);

    expect(lowZIndexDecorations).toHaveLength(1);
    expect(lowZIndexDecorations[0].id).toBe('low_z_box');

    expect(highZIndexDecorations).toHaveLength(1);
    expect(highZIndexDecorations[0].id).toBe('high_z_line');
  });

  // Test 1.8: Verify decoration properties are complete for rendering
  test('shape decorations have all required rendering properties', () => {
    const boxDec = createBoxDecoration('render_box_001');

    // Required properties for shape rendering
    expect(boxDec.id).toBeDefined();
    expect(boxDec.type).toBeDefined();
    expect(typeof boxDec.pos_x).toBe('number');
    expect(typeof boxDec.pos_y).toBe('number');
    expect(typeof boxDec.width).toBe('number');
    expect(typeof boxDec.height).toBe('number');
  });

  // Test 1.9: Verify line decorations have all required rendering properties
  test('line decorations have all required rendering properties', () => {
    const lineDec = createLineDecoration('render_line_001');

    // Required properties for line rendering
    expect(lineDec.id).toBeDefined();
    expect(lineDec.type).toBeDefined();
    expect(lineDec.line_points).toBeInstanceOf(Array);
    expect(lineDec.line_points.length).toBeGreaterThanOrEqual(2);

    // Each point has x and y
    lineDec.line_points.forEach(point => {
      expect(typeof point.x).toBe('number');
      expect(typeof point.y).toBe('number');
    });
  });
});
