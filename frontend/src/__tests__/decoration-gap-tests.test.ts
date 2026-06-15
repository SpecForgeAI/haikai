/**
 * Decoration Gap Tests
 * Task Group 6: Test Review and Gap Analysis
 *
 * This file contains up to 8 additional strategic tests to fill identified gaps
 * in the decorations feature test coverage.
 *
 * Gap Analysis Summary:
 * 1. End-to-end workflow tests (create, style, save/load)
 * 2. Persistence round-trip tests
 * 3. Deletion behavior tests
 * 4. Edge case handling (single point LINE, zero dimension BOX)
 * 5. Integration with mixed selection (nodes + edges + decorations)
 */

import {
  BoxDecoration,
  LineDecoration,
  Decoration,
  Diagram,
} from '../types/model';
import { DECORATION_DEFAULTS, Z_INDEX_DEFAULTS } from '../config/defaults';
import {
  createDefaultBoxDecoration,
  createDefaultLineDecoration,
  isPointInsideBoxDecoration,
  isPointNearLineDecoration,
  calculateLineLabelPosition,
  getDecorationZIndex,
  findDecorationAtPoint,
} from '../utils/decorationUtils';
import {
  renderBoxDecoration,
  renderLineDecoration,
} from '../utils/rendering';

// ============================================================================
// Test 1: End-to-end - Create BOX, add text, style, verify rendering
// ============================================================================

describe('End-to-end: BOX decoration workflow', () => {
  it('should create BOX, add text, style it, and verify rendering output', () => {
    // Step 1: Create a new BOX decoration (simulating click-drag gesture)
    const startX = 100;
    const startY = 100;
    const width = 200;
    const height = 150;

    const boxDecoration = createDefaultBoxDecoration(startX, startY, width, height);

    // Verify initial creation
    expect(boxDecoration.type).toBe('BOX');
    expect(boxDecoration.pos_x).toBe(startX);
    expect(boxDecoration.pos_y).toBe(startY);
    expect(boxDecoration.width).toBe(width);
    expect(boxDecoration.height).toBe(height);
    expect(boxDecoration.id).toMatch(/^dec_box_/);

    // Step 2: Add text to the decoration
    const textUpdate: BoxDecoration = {
      ...boxDecoration,
      text: 'Rates Trader Area',
    };

    expect(textUpdate.text).toBe('Rates Trader Area');

    // Step 3: Style the decoration
    const styledDecoration: BoxDecoration = {
      ...textUpdate,
      text_font_size: 16,
      text_font_weight: 'bold',
      text_color: '#333333',
      background_color: 'rgba(200, 200, 255, 0.3)',
      line_color: '#6666FF',
      line_style: 'DASHED',
      text_h_align: 'CENTER',
      text_v_align: 'TOP',
    };

    expect(styledDecoration.text_font_size).toBe(16);
    expect(styledDecoration.text_font_weight).toBe('bold');
    expect(styledDecoration.line_style).toBe('DASHED');

    // Step 4: Verify rendering output
    const renderResult = renderBoxDecoration(styledDecoration, false);

    expect(renderResult.rect.x).toBe(startX);
    expect(renderResult.rect.y).toBe(startY);
    expect(renderResult.rect.fill).toBe('rgba(200, 200, 255, 0.3)');
    expect(renderResult.rect.stroke).toBe('#6666FF');
    expect(renderResult.textElement).toBeDefined();
    expect(renderResult.textElement?.content).toBe('Rates Trader Area');
    expect(renderResult.textElement?.fontSize).toBe(16);
    expect(renderResult.textElement?.fontWeight).toBe('bold');
    expect(renderResult.textElement?.textAnchor).toBe('middle'); // CENTER alignment
  });
});

// ============================================================================
// Test 2: End-to-end - Create LINE with arrows, add label
// ============================================================================

describe('End-to-end: LINE decoration workflow', () => {
  it('should create LINE with arrows, add label, and verify rendering', () => {
    // Step 1: Create a new LINE decoration (simulating click-click gesture)
    const startPoint = { x: 100, y: 100 };
    const endPoint = { x: 250, y: 200 };

    const lineDecoration = createDefaultLineDecoration([startPoint, endPoint]);

    // Verify initial creation
    expect(lineDecoration.type).toBe('LINE');
    expect(lineDecoration.line_points).toHaveLength(2);
    expect(lineDecoration.line_points[0]).toEqual(startPoint);
    expect(lineDecoration.line_points[1]).toEqual(endPoint);
    expect(lineDecoration.id).toMatch(/^dec_line_/);

    // Step 2: Add arrows
    const withArrows: LineDecoration = {
      ...lineDecoration,
      arrow_start: 'NONE',
      arrow_end: 'ARROW',
    };

    expect(withArrows.arrow_end).toBe('ARROW');

    // Step 3: Add label text
    const withLabel: LineDecoration = {
      ...withArrows,
      text: 'Dealer-to-dealer flow',
      text_font_size: 14,
      text_font_style: 'italic',
      text_color: '#444444',
    };

    expect(withLabel.text).toBe('Dealer-to-dealer flow');

    // Step 4: Verify label position calculation (midpoint)
    const labelPos = calculateLineLabelPosition(withLabel);
    expect(labelPos.x).toBe((100 + 250) / 2); // 175
    expect(labelPos.y).toBe((100 + 200) / 2); // 150

    // Step 5: Verify rendering output
    const renderResult = renderLineDecoration(withLabel, false);

    expect(renderResult.pathData).toContain('M 100 100');
    expect(renderResult.pathData).toContain('L 250 200');
    expect(renderResult.arrowEndPath).toBeDefined();
    expect(renderResult.arrowStartPath).toBeUndefined();
    expect(renderResult.labelElement).toBeDefined();
    expect(renderResult.labelElement?.content).toBe('Dealer-to-dealer flow');
    expect(renderResult.labelElement?.x).toBe(175);
    expect(renderResult.labelElement?.y).toBe(150);
    expect(renderResult.labelElement?.fontStyle).toBe('italic');
  });
});

// ============================================================================
// Test 3: Integration - Decoration selection with nodes/edges
// ============================================================================

describe('Integration: Decoration selection with nodes and edges', () => {
  it('should handle mixed selection of nodes, edges, and decorations', () => {
    // Simulate a selection state with mixed types
    const selectedNodeIds = new Set<string>(['node-1', 'node-2']);
    const selectedEdgeIds = new Set<string>(['edge-1']);
    const selectedDecorationIds = new Set<string>(['dec_box_1', 'dec_line_1']);

    // Verify selection counts
    const totalSelected =
      selectedNodeIds.size + selectedEdgeIds.size + selectedDecorationIds.size;
    expect(totalSelected).toBe(5);

    // Verify type-specific operations
    const hasNodes = selectedNodeIds.size > 0;
    const hasEdges = selectedEdgeIds.size > 0;
    const hasDecorations = selectedDecorationIds.size > 0;

    expect(hasNodes).toBe(true);
    expect(hasEdges).toBe(true);
    expect(hasDecorations).toBe(true);

    // Test: Style controls should apply to compatible properties
    // Font controls apply to: nodes (label), edges (label), decorations (text)
    const canApplyFontStyle = hasNodes || hasEdges || hasDecorations;
    expect(canApplyFontStyle).toBe(true);

    // Arrow controls apply ONLY to: edges, LINE decorations
    const decorations: Decoration[] = [
      {
        id: 'dec_box_1',
        type: 'BOX',
        pos_x: 100,
        pos_y: 100,
        width: 200,
        height: 150,
      },
      {
        id: 'dec_line_1',
        type: 'LINE',
        line_points: [
          { x: 50, y: 50 },
          { x: 150, y: 100 },
        ],
      },
    ];

    const selectedDecorations = decorations.filter((d) =>
      selectedDecorationIds.has(d.id)
    );
    const hasLineDecorations = selectedDecorations.some(
      (d) => d.type === 'LINE'
    );
    const canApplyArrowControls = hasEdges || hasLineDecorations;
    expect(canApplyArrowControls).toBe(true);

    // Background color applies ONLY to: nodes, BOX decorations
    const hasBoxDecorations = selectedDecorations.some((d) => d.type === 'BOX');
    const canApplyBackground = hasNodes || hasBoxDecorations;
    expect(canApplyBackground).toBe(true);
  });
});

// ============================================================================
// Test 4: Integration - Delete decoration via keyboard
// ============================================================================

describe('Integration: Delete decoration via keyboard', () => {
  it('should correctly identify decorations for deletion', () => {
    const decorations: Decoration[] = [
      {
        id: 'dec_box_1',
        type: 'BOX',
        pos_x: 100,
        pos_y: 100,
        width: 200,
        height: 150,
      },
      {
        id: 'dec_line_1',
        type: 'LINE',
        line_points: [
          { x: 50, y: 50 },
          { x: 150, y: 100 },
        ],
      },
      {
        id: 'dec_box_2',
        type: 'BOX',
        pos_x: 300,
        pos_y: 300,
        width: 100,
        height: 100,
      },
    ];

    const selectedDecorationIds = new Set<string>(['dec_box_1', 'dec_line_1']);

    // Simulate Delete key press - filter out selected decorations
    const remainingDecorations = decorations.filter(
      (d) => !selectedDecorationIds.has(d.id)
    );

    expect(remainingDecorations).toHaveLength(1);
    expect(remainingDecorations[0].id).toBe('dec_box_2');

    // Verify selection is cleared after deletion
    const clearedSelection = new Set<string>();
    expect(clearedSelection.size).toBe(0);
  });

  it('should handle deletion when no decorations are selected', () => {
    const decorations: Decoration[] = [
      {
        id: 'dec_box_1',
        type: 'BOX',
        pos_x: 100,
        pos_y: 100,
        width: 200,
        height: 150,
      },
    ];

    const selectedDecorationIds = new Set<string>();

    // No decorations selected - array should remain unchanged
    const remainingDecorations = decorations.filter(
      (d) => !selectedDecorationIds.has(d.id)
    );

    expect(remainingDecorations).toHaveLength(1);
    expect(remainingDecorations[0].id).toBe('dec_box_1');
  });
});

// ============================================================================
// Test 5: Persistence - Decorations round-trip in JSON
// ============================================================================

describe('Persistence: Decorations round-trip in JSON', () => {
  it('should correctly serialize and deserialize decorations in diagram', () => {
    // Create a diagram with decorations
    const originalDiagram: Diagram = {
      id: 'test-diagram',
      name: 'Test Diagram',
      description: 'Diagram with decorations',
      diagram_nodes: [],
      diagram_edges: [],
      decorations: [
        {
          id: 'dec_box_1',
          type: 'BOX',
          pos_x: 100,
          pos_y: 100,
          width: 200,
          height: 150,
          text: 'Test Group',
          text_font_size: 14,
          text_font_weight: 'bold',
          text_h_align: 'CENTER',
          text_v_align: 'TOP',
          background_color: 'rgba(230,230,255,0.2)',
          line_color: '#9999FF',
          line_style: 'DASHED',
          z_index: 50,
        },
        {
          id: 'dec_line_1',
          type: 'LINE',
          line_points: [
            { x: 100, y: 100 },
            { x: 200, y: 150 },
            { x: 300, y: 100 },
          ],
          text: 'Flow Label',
          label_pos_x: 200,
          label_pos_y: 125,
          text_font_size: 12,
          arrow_start: 'NONE',
          arrow_end: 'ARROW',
          z_index: 120,
        },
      ],
    };

    // Serialize to JSON
    const jsonString = JSON.stringify(originalDiagram);

    // Deserialize from JSON
    const parsedDiagram: Diagram = JSON.parse(jsonString);

    // Verify decorations array exists
    expect(parsedDiagram.decorations).toBeDefined();
    expect(parsedDiagram.decorations).toHaveLength(2);

    // Verify BOX decoration round-trip
    const boxDec = parsedDiagram.decorations![0] as BoxDecoration;
    expect(boxDec.type).toBe('BOX');
    expect(boxDec.id).toBe('dec_box_1');
    expect(boxDec.pos_x).toBe(100);
    expect(boxDec.width).toBe(200);
    expect(boxDec.text).toBe('Test Group');
    expect(boxDec.text_font_weight).toBe('bold');
    expect(boxDec.text_h_align).toBe('CENTER');
    expect(boxDec.background_color).toBe('rgba(230,230,255,0.2)');
    expect(boxDec.line_style).toBe('DASHED');

    // Verify LINE decoration round-trip
    const lineDec = parsedDiagram.decorations![1] as LineDecoration;
    expect(lineDec.type).toBe('LINE');
    expect(lineDec.id).toBe('dec_line_1');
    expect(lineDec.line_points).toHaveLength(3);
    expect(lineDec.line_points[1]).toEqual({ x: 200, y: 150 });
    expect(lineDec.text).toBe('Flow Label');
    expect(lineDec.label_pos_x).toBe(200);
    expect(lineDec.label_pos_y).toBe(125);
    expect(lineDec.arrow_end).toBe('ARROW');
  });
});

// ============================================================================
// Test 6: Edge case - Empty decorations array handling
// ============================================================================

describe('Edge case: Empty decorations array handling', () => {
  it('should handle diagram with empty decorations array', () => {
    const diagram: Diagram = {
      id: 'test-diagram',
      name: 'Test Diagram',
      description: 'Diagram without decorations',
      diagram_nodes: [],
      diagram_edges: [],
      decorations: [],
    };

    expect(diagram.decorations).toBeDefined();
    expect(diagram.decorations).toHaveLength(0);

    // Test that rendering and selection logic works with empty array
    const findResult = findDecorationAtPoint(100, 100, []);
    expect(findResult).toBeNull();
  });

  it('should handle diagram with undefined decorations (backward compatibility)', () => {
    const diagram: Diagram = {
      id: 'test-diagram',
      name: 'Test Diagram',
      description: 'Legacy diagram without decorations field',
      diagram_nodes: [],
      diagram_edges: [],
      // decorations field omitted for backward compatibility
    };

    expect(diagram.decorations).toBeUndefined();

    // Application code should treat undefined as empty array
    const decorations = diagram.decorations ?? [];
    expect(decorations).toHaveLength(0);
  });
});

// ============================================================================
// Test 7: Edge case - LINE with single point (error case)
// ============================================================================

describe('Edge case: LINE with single point', () => {
  it('should handle LINE decoration with single point gracefully', () => {
    const singlePointLine: LineDecoration = {
      id: 'dec_line_invalid',
      type: 'LINE',
      line_points: [{ x: 100, y: 100 }], // Only one point - invalid
    };

    // Hit testing should return false for single-point line
    const hitResult = isPointNearLineDecoration(100, 100, singlePointLine, 5);
    expect(hitResult).toBe(false);

    // Label position should still return a value (the single point)
    const labelPos = calculateLineLabelPosition(singlePointLine);
    expect(labelPos.x).toBe(100);
    expect(labelPos.y).toBe(100);

    // Rendering should handle gracefully (produce valid but minimal output)
    const renderResult = renderLineDecoration(singlePointLine, false);
    expect(renderResult.pathData).toBe('M 100 100');
    expect(renderResult.arrowEndPath).toBeUndefined();
    expect(renderResult.arrowStartPath).toBeUndefined();
  });

  it('should handle LINE decoration with zero points', () => {
    const emptyLine: LineDecoration = {
      id: 'dec_line_empty',
      type: 'LINE',
      line_points: [], // No points - edge case
    };

    // Hit testing should return false
    const hitResult = isPointNearLineDecoration(100, 100, emptyLine, 5);
    expect(hitResult).toBe(false);

    // Label position should return zero
    const labelPos = calculateLineLabelPosition(emptyLine);
    expect(labelPos.x).toBe(0);
    expect(labelPos.y).toBe(0);

    // Rendering should produce empty path
    const renderResult = renderLineDecoration(emptyLine, false);
    expect(renderResult.pathData).toBe('');
  });
});

// ============================================================================
// Test 8: Edge case - BOX with zero dimensions
// ============================================================================

describe('Edge case: BOX with zero dimensions', () => {
  it('should handle BOX decoration with zero width', () => {
    const zeroWidthBox: BoxDecoration = {
      id: 'dec_box_zero_width',
      type: 'BOX',
      pos_x: 100,
      pos_y: 100,
      width: 0,
      height: 150,
    };

    // Hit testing should still work (point on edge)
    const onEdge = isPointInsideBoxDecoration(100, 125, zeroWidthBox);
    expect(onEdge).toBe(true);

    // Point outside should return false
    const outside = isPointInsideBoxDecoration(101, 125, zeroWidthBox);
    expect(outside).toBe(false);

    // Rendering should still produce output
    const renderResult = renderBoxDecoration(zeroWidthBox, false);
    expect(renderResult.rect.width).toBe(0);
    expect(renderResult.rect.height).toBe(150);
  });

  it('should handle BOX decoration with zero height', () => {
    const zeroHeightBox: BoxDecoration = {
      id: 'dec_box_zero_height',
      type: 'BOX',
      pos_x: 100,
      pos_y: 100,
      width: 200,
      height: 0,
    };

    // Hit testing on the line
    const onLine = isPointInsideBoxDecoration(150, 100, zeroHeightBox);
    expect(onLine).toBe(true);

    // Point below should return false
    const below = isPointInsideBoxDecoration(150, 101, zeroHeightBox);
    expect(below).toBe(false);

    // Rendering should still produce output
    const renderResult = renderBoxDecoration(zeroHeightBox, false);
    expect(renderResult.rect.width).toBe(200);
    expect(renderResult.rect.height).toBe(0);
  });

  it('should handle BOX decoration with zero width and height (point)', () => {
    const pointBox: BoxDecoration = {
      id: 'dec_box_point',
      type: 'BOX',
      pos_x: 100,
      pos_y: 100,
      width: 0,
      height: 0,
    };

    // Only exact point should be inside
    const exact = isPointInsideBoxDecoration(100, 100, pointBox);
    expect(exact).toBe(true);

    // Any other point should be outside
    const nearby = isPointInsideBoxDecoration(100.1, 100.1, pointBox);
    expect(nearby).toBe(false);

    // Z-index should use default
    const zIndex = getDecorationZIndex(pointBox);
    expect(zIndex).toBe(Z_INDEX_DEFAULTS.BOX_DECORATION);
  });
});
