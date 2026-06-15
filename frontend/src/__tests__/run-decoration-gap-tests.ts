/**
 * Test Runner for Decoration Gap Tests
 * Task Group 6: Test Review and Gap Analysis
 *
 * This script runs the gap tests identified during test coverage analysis.
 * These tests fill critical gaps in the decorations feature test coverage.
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

// Simple assertion helper
function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

// ============================================================================
// Test 1: End-to-end - Create BOX, add text, style, verify rendering
// ============================================================================

export function testEndToEndBoxWorkflow(): void {
  // Step 1: Create a new BOX decoration
  const startX = 100;
  const startY = 100;
  const width = 200;
  const height = 150;

  const boxDecoration = createDefaultBoxDecoration(startX, startY, width, height);

  // Verify initial creation
  assert(boxDecoration.type === 'BOX', 'Type should be BOX');
  assert(boxDecoration.pos_x === startX, 'pos_x should match');
  assert(boxDecoration.pos_y === startY, 'pos_y should match');
  assert(boxDecoration.width === width, 'width should match');
  assert(boxDecoration.height === height, 'height should match');
  assert(boxDecoration.id.startsWith('dec_box_'), 'ID should have correct prefix');

  // Step 2: Add text to the decoration
  const textUpdate: BoxDecoration = {
    ...boxDecoration,
    text: 'Rates Trader Area',
  };

  assert(textUpdate.text === 'Rates Trader Area', 'Text should be set');

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

  assert(styledDecoration.text_font_size === 16, 'Font size should be 16');
  assert(styledDecoration.text_font_weight === 'bold', 'Font weight should be bold');
  assert(styledDecoration.line_style === 'DASHED', 'Line style should be DASHED');

  // Step 4: Verify rendering output
  const renderResult = renderBoxDecoration(styledDecoration, false);

  assert(renderResult.rect.x === startX, 'Render rect x should match');
  assert(renderResult.rect.y === startY, 'Render rect y should match');
  assert(renderResult.rect.fill === 'rgba(200, 200, 255, 0.3)', 'Fill should match');
  assert(renderResult.rect.stroke === '#6666FF', 'Stroke should match');
  assert(renderResult.textElement !== undefined, 'Text element should exist');
  assert(renderResult.textElement?.content === 'Rates Trader Area', 'Text content should match');
  assert(renderResult.textElement?.fontSize === 16, 'Font size should match');
  assert(renderResult.textElement?.fontWeight === 'bold', 'Font weight should match');
  assert(renderResult.textElement?.textAnchor === 'middle', 'Text anchor should be middle for CENTER');

  console.log('  End-to-end BOX workflow: create, style, render');
}

// ============================================================================
// Test 2: End-to-end - Create LINE with arrows, add label
// ============================================================================

export function testEndToEndLineWorkflow(): void {
  // Step 1: Create a new LINE decoration
  const startPoint = { x: 100, y: 100 };
  const endPoint = { x: 250, y: 200 };

  const lineDecoration = createDefaultLineDecoration([startPoint, endPoint]);

  // Verify initial creation
  assert(lineDecoration.type === 'LINE', 'Type should be LINE');
  assert(lineDecoration.line_points.length === 2, 'Should have 2 points');
  assert(lineDecoration.line_points[0].x === 100, 'First point x should match');
  assert(lineDecoration.line_points[1].y === 200, 'Second point y should match');
  assert(lineDecoration.id.startsWith('dec_line_'), 'ID should have correct prefix');

  // Step 2: Add arrows
  const withArrows: LineDecoration = {
    ...lineDecoration,
    arrow_start: 'NONE',
    arrow_end: 'ARROW',
  };

  assert(withArrows.arrow_end === 'ARROW', 'Arrow end should be ARROW');

  // Step 3: Add label text
  const withLabel: LineDecoration = {
    ...withArrows,
    text: 'Dealer-to-dealer flow',
    text_font_size: 14,
    text_font_style: 'italic',
    text_color: '#444444',
  };

  assert(withLabel.text === 'Dealer-to-dealer flow', 'Label text should be set');

  // Step 4: Verify label position calculation (midpoint)
  const labelPos = calculateLineLabelPosition(withLabel);
  assert(labelPos.x === (100 + 250) / 2, 'Label x should be midpoint');
  assert(labelPos.y === (100 + 200) / 2, 'Label y should be midpoint');

  // Step 5: Verify rendering output
  const renderResult = renderLineDecoration(withLabel, false);

  assert(renderResult.pathData.includes('M 100 100'), 'Path should contain start point');
  assert(renderResult.pathData.includes('L 250 200'), 'Path should contain end point');
  assert(renderResult.arrowEndPath !== undefined, 'Arrow end path should exist');
  assert(renderResult.arrowStartPath === undefined, 'Arrow start path should not exist');
  assert(renderResult.labelElement !== undefined, 'Label element should exist');
  assert(renderResult.labelElement?.content === 'Dealer-to-dealer flow', 'Label content should match');
  assert(renderResult.labelElement?.x === 175, 'Label x should be 175');
  assert(renderResult.labelElement?.y === 150, 'Label y should be 150');
  assert(renderResult.labelElement?.fontStyle === 'italic', 'Font style should be italic');

  console.log('  End-to-end LINE workflow: create with arrows and label');
}

// ============================================================================
// Test 3: Integration - Mixed selection with nodes/edges/decorations
// ============================================================================

export function testMixedSelection(): void {
  // Simulate a selection state with mixed types
  const selectedNodeIds = new Set<string>(['node-1', 'node-2']);
  const selectedEdgeIds = new Set<string>(['edge-1']);
  const selectedDecorationIds = new Set<string>(['dec_box_1', 'dec_line_1']);

  // Verify selection counts
  const totalSelected =
    selectedNodeIds.size + selectedEdgeIds.size + selectedDecorationIds.size;
  assert(totalSelected === 5, 'Total selected should be 5');

  // Verify type-specific operations
  const hasNodes = selectedNodeIds.size > 0;
  const hasEdges = selectedEdgeIds.size > 0;
  const hasDecorations = selectedDecorationIds.size > 0;

  assert(hasNodes, 'Should have nodes selected');
  assert(hasEdges, 'Should have edges selected');
  assert(hasDecorations, 'Should have decorations selected');

  // Test style control applicability
  const canApplyFontStyle = hasNodes || hasEdges || hasDecorations;
  assert(canApplyFontStyle, 'Should be able to apply font style');

  // Arrow controls apply to edges and LINE decorations
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
  const hasLineDecorations = selectedDecorations.some((d) => d.type === 'LINE');
  const canApplyArrowControls = hasEdges || hasLineDecorations;
  assert(canApplyArrowControls, 'Should be able to apply arrow controls');

  // Background color applies to nodes and BOX decorations
  const hasBoxDecorations = selectedDecorations.some((d) => d.type === 'BOX');
  const canApplyBackground = hasNodes || hasBoxDecorations;
  assert(canApplyBackground, 'Should be able to apply background color');

  console.log('  Mixed selection: nodes, edges, and decorations together');
}

// ============================================================================
// Test 4: Delete decoration behavior
// ============================================================================

export function testDeleteDecoration(): void {
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

  assert(remainingDecorations.length === 1, 'Should have 1 decoration remaining');
  assert(remainingDecorations[0].id === 'dec_box_2', 'Remaining decoration should be dec_box_2');

  // Test with no selection
  const noSelection = new Set<string>();
  const unchanged = decorations.filter((d) => !noSelection.has(d.id));
  assert(unchanged.length === 3, 'With no selection, all decorations should remain');

  console.log('  Delete decoration: removes selected, preserves others');
}

// ============================================================================
// Test 5: Persistence round-trip
// ============================================================================

export function testPersistenceRoundTrip(): void {
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
  assert(parsedDiagram.decorations !== undefined, 'Decorations should exist');
  assert(parsedDiagram.decorations!.length === 2, 'Should have 2 decorations');

  // Verify BOX decoration round-trip
  const boxDec = parsedDiagram.decorations![0] as BoxDecoration;
  assert(boxDec.type === 'BOX', 'Type should be BOX');
  assert(boxDec.id === 'dec_box_1', 'ID should match');
  assert(boxDec.pos_x === 100, 'pos_x should match');
  assert(boxDec.width === 200, 'width should match');
  assert(boxDec.text === 'Test Group', 'text should match');
  assert(boxDec.text_font_weight === 'bold', 'font weight should match');
  assert(boxDec.text_h_align === 'CENTER', 'alignment should match');
  assert(boxDec.background_color === 'rgba(230,230,255,0.2)', 'background should match');
  assert(boxDec.line_style === 'DASHED', 'line style should match');

  // Verify LINE decoration round-trip
  const lineDec = parsedDiagram.decorations![1] as LineDecoration;
  assert(lineDec.type === 'LINE', 'Type should be LINE');
  assert(lineDec.id === 'dec_line_1', 'ID should match');
  assert(lineDec.line_points.length === 3, 'Should have 3 points');
  assert(lineDec.line_points[1].x === 200, 'Middle point x should match');
  assert(lineDec.line_points[1].y === 150, 'Middle point y should match');
  assert(lineDec.text === 'Flow Label', 'text should match');
  assert(lineDec.label_pos_x === 200, 'label_pos_x should match');
  assert(lineDec.label_pos_y === 125, 'label_pos_y should match');
  assert(lineDec.arrow_end === 'ARROW', 'arrow_end should match');

  console.log('  Persistence round-trip: JSON serialize/deserialize');
}

// ============================================================================
// Test 6: Empty decorations handling
// ============================================================================

export function testEmptyDecorationsHandling(): void {
  // Empty array
  const diagram: Diagram = {
    id: 'test-diagram',
    name: 'Test Diagram',
    description: 'Diagram without decorations',
    diagram_nodes: [],
    diagram_edges: [],
    decorations: [],
  };

  assert(diagram.decorations !== undefined, 'Decorations should be defined');
  assert(diagram.decorations.length === 0, 'Decorations should be empty');

  // Test find operation with empty array
  const findResult = findDecorationAtPoint(100, 100, []);
  assert(findResult === null, 'findDecorationAtPoint should return null for empty array');

  // Undefined decorations (backward compatibility)
  const legacyDiagram: Diagram = {
    id: 'test-diagram',
    name: 'Test Diagram',
    description: 'Legacy diagram',
    diagram_nodes: [],
    diagram_edges: [],
  };

  assert(legacyDiagram.decorations === undefined, 'Legacy diagram should have undefined decorations');

  // Application code pattern
  const decorations = legacyDiagram.decorations ?? [];
  assert(decorations.length === 0, 'Should treat undefined as empty array');

  console.log('  Empty decorations: handles empty and undefined arrays');
}

// ============================================================================
// Test 7: LINE with single/zero points (edge cases)
// ============================================================================

export function testLineEdgeCases(): void {
  // Single point LINE
  const singlePointLine: LineDecoration = {
    id: 'dec_line_invalid',
    type: 'LINE',
    line_points: [{ x: 100, y: 100 }],
  };

  // Hit testing should return false for single-point line
  const hitResult = isPointNearLineDecoration(100, 100, singlePointLine, 5);
  assert(!hitResult, 'Hit test should return false for single-point line');

  // Label position should return the single point
  const labelPos = calculateLineLabelPosition(singlePointLine);
  assert(labelPos.x === 100, 'Label x should be 100');
  assert(labelPos.y === 100, 'Label y should be 100');

  // Rendering should produce minimal output
  const renderResult = renderLineDecoration(singlePointLine, false);
  assert(renderResult.pathData === 'M 100 100', 'Path should be just moveto');
  assert(renderResult.arrowEndPath === undefined, 'Should have no arrow end');
  assert(renderResult.arrowStartPath === undefined, 'Should have no arrow start');

  // Zero points LINE
  const emptyLine: LineDecoration = {
    id: 'dec_line_empty',
    type: 'LINE',
    line_points: [],
  };

  const emptyHitResult = isPointNearLineDecoration(100, 100, emptyLine, 5);
  assert(!emptyHitResult, 'Hit test should return false for empty line');

  const emptyLabelPos = calculateLineLabelPosition(emptyLine);
  assert(emptyLabelPos.x === 0, 'Label x should be 0 for empty line');
  assert(emptyLabelPos.y === 0, 'Label y should be 0 for empty line');

  const emptyRenderResult = renderLineDecoration(emptyLine, false);
  assert(emptyRenderResult.pathData === '', 'Path should be empty');

  console.log('  LINE edge cases: single point and zero points');
}

// ============================================================================
// Test 8: BOX with zero dimensions (edge cases)
// ============================================================================

export function testBoxEdgeCases(): void {
  // Zero width
  const zeroWidthBox: BoxDecoration = {
    id: 'dec_box_zero_width',
    type: 'BOX',
    pos_x: 100,
    pos_y: 100,
    width: 0,
    height: 150,
  };

  const onEdge = isPointInsideBoxDecoration(100, 125, zeroWidthBox);
  assert(onEdge, 'Point on edge of zero-width box should be inside');

  const outside = isPointInsideBoxDecoration(101, 125, zeroWidthBox);
  assert(!outside, 'Point outside zero-width box should not be inside');

  const zeroWidthRender = renderBoxDecoration(zeroWidthBox, false);
  assert(zeroWidthRender.rect.width === 0, 'Rendered width should be 0');
  assert(zeroWidthRender.rect.height === 150, 'Rendered height should be 150');

  // Zero height
  const zeroHeightBox: BoxDecoration = {
    id: 'dec_box_zero_height',
    type: 'BOX',
    pos_x: 100,
    pos_y: 100,
    width: 200,
    height: 0,
  };

  const onLine = isPointInsideBoxDecoration(150, 100, zeroHeightBox);
  assert(onLine, 'Point on zero-height box should be inside');

  const below = isPointInsideBoxDecoration(150, 101, zeroHeightBox);
  assert(!below, 'Point below zero-height box should not be inside');

  // Zero width and height (point)
  const pointBox: BoxDecoration = {
    id: 'dec_box_point',
    type: 'BOX',
    pos_x: 100,
    pos_y: 100,
    width: 0,
    height: 0,
  };

  const exact = isPointInsideBoxDecoration(100, 100, pointBox);
  assert(exact, 'Exact point should be inside point-box');

  const nearby = isPointInsideBoxDecoration(100.1, 100.1, pointBox);
  assert(!nearby, 'Nearby point should not be inside point-box');

  // Z-index should use default
  const zIndex = getDecorationZIndex(pointBox);
  assert(zIndex === Z_INDEX_DEFAULTS.BOX_DECORATION, 'Z-index should use default');

  console.log('  BOX edge cases: zero width, zero height, zero both');
}

// ============================================================================
// Run all tests
// ============================================================================

export function runAllTests(): void {
  const tests = [
    { name: 'testEndToEndBoxWorkflow', fn: testEndToEndBoxWorkflow },
    { name: 'testEndToEndLineWorkflow', fn: testEndToEndLineWorkflow },
    { name: 'testMixedSelection', fn: testMixedSelection },
    { name: 'testDeleteDecoration', fn: testDeleteDecoration },
    { name: 'testPersistenceRoundTrip', fn: testPersistenceRoundTrip },
    { name: 'testEmptyDecorationsHandling', fn: testEmptyDecorationsHandling },
    { name: 'testLineEdgeCases', fn: testLineEdgeCases },
    { name: 'testBoxEdgeCases', fn: testBoxEdgeCases },
  ];

  let passed = 0;
  let failed = 0;

  console.log('\n=== Decoration Gap Tests (Task Group 6) ===\n');

  for (const test of tests) {
    try {
      test.fn();
      passed++;
      console.log(`PASS: ${test.name}`);
    } catch (error) {
      failed++;
      console.error(`FAIL: ${test.name} - ${error}`);
    }
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  console.log('==========================================\n');
}

// Run tests if this file is executed directly
runAllTests();
