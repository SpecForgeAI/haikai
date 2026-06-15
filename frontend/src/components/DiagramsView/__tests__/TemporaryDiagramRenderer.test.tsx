/**
 * TemporaryDiagramRenderer Tests
 * Spec: Render Temporary Architecture Diagrams in Frontend (Increment 4)
 *
 * Task Group 2, Task 2.1: 5 focused tests for ER node rendering
 * Test 1: Renders the correct number of ERD node <rect> elements for a diagram with 3 nodes
 * Test 2: Renders node header text (display_name) bold and centered within ERD_HEADER_HEIGHT (30px) band
 * Test 3: Renders attribute rows from the compartments array (compartment_kind === 'ATTRIBUTES'),
 *          formatted as "PK attr_name : VARCHAR(255)" when metadata is present
 * Test 4: Renders a node with empty/missing compartments as header-only (no crash, no attribute rows)
 * Test 5: Sorts nodes by z_index ascending (nulls treated as 0) before rendering
 *
 * Task Group 3, Task 3.1: 4 focused tests for ER edge rendering
 * Test 1: Renders a polyline from edge_points sorted by sequence_order ascending
 * Test 2: Renders correct UML symbols for a COMPOSITION edge (filled diamond at source, no symbol at target, solid line)
 * Test 3: Renders source_label and target_label as <text> elements at their pos_x/pos_y coordinates when present
 * Test 4: Skips rendering an edge with empty or missing edge_points (no crash)
 *
 * Task Group 6: Gap-fill tests for renderer
 * Gap 1: GENERALIZATION edge -- hollow triangle at target, solid line
 * Gap 2: DEPENDENCY edge -- open arrow at target, dashed line
 * Gap 3: AGGREGATION edge -- hollow diamond at source, solid line
 * Gap 4: Unsupported diagram_kind displays warning message
 * Gap 5: Attribute formatting edge cases -- missing data_type and missing metadata
 * Gap 6: ASSOCIATION (undefined relationship_type) -- no symbols, solid line
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import TemporaryDiagramRenderer, { formatCompartmentItem } from '../TemporaryDiagramRenderer';
import type {
  TemporaryArchitectureDiagram,
  TemporaryArchitectureDiagramNode,
  TemporaryArchitectureDiagramEdge,
  TemporaryArchitectureDiagramCompartmentItem,
} from '../../../types/temporaryArchitectureDiagram';
import { ERD_HEADER_HEIGHT } from '../../../utils/erdUtils';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a minimal valid TemporaryArchitectureDiagram for testing.
 */
function createTestDiagram(
  overrides: Partial<TemporaryArchitectureDiagram> = {}
): TemporaryArchitectureDiagram {
  return {
    id: 'diag-1',
    name: 'Test ER Diagram',
    diagram_kind: 'ER',
    source_architecture_domain: 'DATA',
    view_mode: 'LOGICAL',
    version: 1,
    nodes: [],
    edges: [],
    ...overrides,
  };
}

/**
 * Create a test node with optional overrides.
 */
function createTestNode(
  overrides: Partial<TemporaryArchitectureDiagramNode> = {}
): TemporaryArchitectureDiagramNode {
  return {
    id: 'node-1',
    node_kind: 'ENTITY',
    semantic_type: 'LOGICAL_DATA_ENTITY',
    ref_name: 'Customer',
    display_name: 'Customer',
    pos_x: 100,
    pos_y: 100,
    width: 200,
    height: 150,
    ...overrides,
  };
}

/**
 * Create a test edge with optional overrides.
 */
function createTestEdge(
  overrides: Partial<TemporaryArchitectureDiagramEdge> = {}
): TemporaryArchitectureDiagramEdge {
  return {
    id: 'edge-1',
    edge_kind: 'RELATIONSHIP',
    semantic_type: 'DATA_ENTITY_RELATIONSHIP',
    source_node_id: 'node-1',
    target_node_id: 'node-2',
    source_ref_name: 'Customer',
    target_ref_name: 'Order',
    edge_points: [
      { sequence_order: 1, pos_x: 300, pos_y: 175 },
      { sequence_order: 2, pos_x: 400, pos_y: 175 },
    ],
    ...overrides,
  };
}

/**
 * Helper to render the component inside an SVG element (since it produces <g> elements).
 */
function renderInSvg(diagram: TemporaryArchitectureDiagram) {
  return render(
    <svg>
      <TemporaryDiagramRenderer diagram={diagram} zoom={1} />
    </svg>
  );
}

// ============================================================================
// Task Group 2: ER Node Rendering Tests
// ============================================================================

describe('TemporaryDiagramRenderer - ER Node Rendering', () => {
  // Test 1: Renders the correct number of ERD node <rect> elements for a diagram with 3 nodes
  it('renders the correct number of ERD node rect elements for a diagram with 3 nodes', () => {
    const diagram = createTestDiagram({
      nodes: [
        createTestNode({ id: 'node-1', display_name: 'Customer', pos_x: 100, pos_y: 100 }),
        createTestNode({ id: 'node-2', display_name: 'Order', pos_x: 400, pos_y: 100 }),
        createTestNode({ id: 'node-3', display_name: 'Product', pos_x: 100, pos_y: 300 }),
      ],
    });

    const { container } = renderInSvg(diagram);

    // Each node renders one outer <rect>
    const rects = container.querySelectorAll('rect');
    expect(rects).toHaveLength(3);

    // Verify each node group is present
    const nodeGroups = container.querySelectorAll('[data-testid^="temp-erd-node-"]');
    expect(nodeGroups).toHaveLength(3);
  });

  // Test 2: Renders node header text (display_name) bold and centered within ERD_HEADER_HEIGHT (30px) band
  it('renders node header text bold and centered within ERD_HEADER_HEIGHT band', () => {
    const node = createTestNode({
      id: 'node-header',
      display_name: 'CustomerProfile',
      pos_x: 50,
      pos_y: 80,
      width: 200,
      height: 150,
    });

    const diagram = createTestDiagram({ nodes: [node] });
    const { container } = renderInSvg(diagram);

    // Find the header text element (first <text> in the node group)
    const nodeGroup = container.querySelector('[data-testid="temp-erd-node-node-header"]');
    expect(nodeGroup).not.toBeNull();

    const textElements = nodeGroup!.querySelectorAll('text');
    expect(textElements.length).toBeGreaterThanOrEqual(1);

    const headerText = textElements[0];
    expect(headerText.textContent).toBe('CustomerProfile');
    expect(headerText.getAttribute('font-weight')).toBe('bold');
    expect(headerText.getAttribute('text-anchor')).toBe('middle');

    // Verify x is centered: pos_x + width / 2 = 50 + 200/2 = 150
    expect(headerText.getAttribute('x')).toBe('150');

    // Verify y is within the ERD_HEADER_HEIGHT band:
    // y = pos_y + ERD_HEADER_HEIGHT/2 + fontSize/3 = 80 + 15 + 4 = 99
    const headerY = parseFloat(headerText.getAttribute('y')!);
    expect(headerY).toBeGreaterThan(80); // Below pos_y
    expect(headerY).toBeLessThan(80 + ERD_HEADER_HEIGHT); // Within header band
  });

  // Test 3: Renders attribute rows from compartments with correct formatting
  it('renders attribute rows formatted as "PK attr_name : VARCHAR(255)" when metadata is present', () => {
    const node = createTestNode({
      id: 'node-attrs',
      display_name: 'Customer',
      compartments: [
        {
          id: 'comp-1',
          compartment_kind: 'ATTRIBUTES',
          items: [
            {
              id: 'item-1',
              item_kind: 'ATTRIBUTE',
              ref_name: 'customer_id',
              display_name: 'customer_id',
              semantic_type: 'LOGICAL_DATA_ATTRIBUTE',
              metadata: {
                is_primary_key: true,
                data_type: 'INTEGER',
              },
            },
            {
              id: 'item-2',
              item_kind: 'ATTRIBUTE',
              ref_name: 'name',
              display_name: 'name',
              semantic_type: 'LOGICAL_DATA_ATTRIBUTE',
              metadata: {
                data_type: 'VARCHAR(255)',
              },
            },
            {
              id: 'item-3',
              item_kind: 'ATTRIBUTE',
              ref_name: 'order_id',
              display_name: 'order_id',
              semantic_type: 'LOGICAL_DATA_ATTRIBUTE',
              metadata: {
                is_foreign_key: true,
                data_type: 'INTEGER',
              },
            },
          ],
        },
      ],
    });

    const diagram = createTestDiagram({ nodes: [node] });
    const { container } = renderInSvg(diagram);

    const nodeGroup = container.querySelector('[data-testid="temp-erd-node-node-attrs"]');
    expect(nodeGroup).not.toBeNull();

    // The node group contains: 1 header text + 3 attribute texts = 4 text elements total
    const textElements = nodeGroup!.querySelectorAll('text');
    expect(textElements).toHaveLength(4);

    // First text is the header
    expect(textElements[0].textContent).toBe('Customer');

    // Attribute rows
    expect(textElements[1].textContent).toBe('PK customer_id : INTEGER');
    expect(textElements[2].textContent).toBe('name : VARCHAR(255)');
    expect(textElements[3].textContent).toBe('FK order_id : INTEGER');

    // Verify attribute text is left-aligned
    expect(textElements[1].getAttribute('text-anchor')).toBe('start');

    // Also verify the formatCompartmentItem function directly for PK+FK case
    const pkFkItem: TemporaryArchitectureDiagramCompartmentItem = {
      id: 'item-both',
      item_kind: 'ATTRIBUTE',
      ref_name: 'ref_id',
      display_name: 'ref_id',
      semantic_type: 'LOGICAL_DATA_ATTRIBUTE',
      metadata: {
        is_primary_key: true,
        is_foreign_key: true,
        data_type: 'BIGINT',
      },
    };
    expect(formatCompartmentItem(pkFkItem)).toBe('PK FK ref_id : BIGINT');
  });

  // Test 4: Renders a node with empty/missing compartments as header-only (no crash)
  it('renders a node with empty/missing compartments as header-only without crashing', () => {
    // Node with no compartments at all
    const nodeNoCompartments = createTestNode({
      id: 'node-no-comp',
      display_name: 'EmptyEntity',
    });

    // Node with empty compartments array
    const nodeEmptyCompartments = createTestNode({
      id: 'node-empty-comp',
      display_name: 'AnotherEmpty',
      compartments: [],
    });

    // Node with compartment but empty items
    const nodeEmptyItems = createTestNode({
      id: 'node-empty-items',
      display_name: 'NoAttributes',
      compartments: [
        {
          id: 'comp-empty',
          compartment_kind: 'ATTRIBUTES',
          items: [],
        },
      ],
    });

    const diagram = createTestDiagram({
      nodes: [nodeNoCompartments, nodeEmptyCompartments, nodeEmptyItems],
    });

    // Should not throw
    const { container } = renderInSvg(diagram);

    // All 3 nodes should render
    const nodeGroups = container.querySelectorAll('[data-testid^="temp-erd-node-"]');
    expect(nodeGroups).toHaveLength(3);

    // Each node should have exactly 1 text element (header only, no attribute rows)
    for (const group of nodeGroups) {
      const texts = group.querySelectorAll('text');
      expect(texts).toHaveLength(1);
    }

    // Verify headers are rendered correctly
    const noCompGroup = container.querySelector('[data-testid="temp-erd-node-node-no-comp"]');
    expect(noCompGroup!.querySelector('text')!.textContent).toBe('EmptyEntity');
  });

  // Test 5: Sorts nodes by z_index ascending (nulls treated as 0) before rendering
  it('sorts nodes by z_index ascending with nulls treated as 0', () => {
    const diagram = createTestDiagram({
      nodes: [
        createTestNode({
          id: 'node-high-z',
          display_name: 'HighZ',
          z_index: 10,
        }),
        createTestNode({
          id: 'node-no-z',
          display_name: 'NoZ',
          // z_index is undefined -> treated as 0
        }),
        createTestNode({
          id: 'node-mid-z',
          display_name: 'MidZ',
          z_index: 5,
        }),
        createTestNode({
          id: 'node-low-z',
          display_name: 'LowZ',
          z_index: -1,
        }),
      ],
    });

    const { container } = renderInSvg(diagram);

    // Get all node groups in render order
    const nodeGroups = container.querySelectorAll('[data-testid^="temp-erd-node-"]');
    expect(nodeGroups).toHaveLength(4);

    // Verify render order: LowZ (-1), NoZ (0), MidZ (5), HighZ (10)
    const renderedOrder = Array.from(nodeGroups).map(
      (g) => g.getAttribute('data-testid')
    );
    expect(renderedOrder).toEqual([
      'temp-erd-node-node-low-z',
      'temp-erd-node-node-no-z',
      'temp-erd-node-node-mid-z',
      'temp-erd-node-node-high-z',
    ]);
  });
});

// ============================================================================
// Task Group 3: ER Edge Rendering Tests
// ============================================================================

describe('TemporaryDiagramRenderer - ER Edge Rendering', () => {
  // Test 1: Renders a polyline from edge_points sorted by sequence_order ascending
  it('renders a polyline from edge_points sorted by sequence_order ascending', () => {
    const diagram = createTestDiagram({
      nodes: [
        createTestNode({ id: 'node-1', pos_x: 100, pos_y: 100 }),
        createTestNode({ id: 'node-2', pos_x: 400, pos_y: 100 }),
      ],
      edges: [
        createTestEdge({
          id: 'edge-sorted',
          source_node_id: 'node-1',
          target_node_id: 'node-2',
          // Points provided out of order to verify sorting
          edge_points: [
            { sequence_order: 3, pos_x: 400, pos_y: 175 },
            { sequence_order: 1, pos_x: 300, pos_y: 175 },
            { sequence_order: 2, pos_x: 350, pos_y: 200 },
          ],
        }),
      ],
    });

    const { container } = renderInSvg(diagram);

    // Verify edge group is present
    const edgeGroup = container.querySelector('[data-testid="temp-erd-edge-edge-sorted"]');
    expect(edgeGroup).not.toBeNull();

    // Verify polyline element exists with correct points string
    const polyline = edgeGroup!.querySelector('polyline');
    expect(polyline).not.toBeNull();

    // Points should be sorted by sequence_order: (300,175) -> (350,200) -> (400,175)
    const pointsAttr = polyline!.getAttribute('points');
    expect(pointsAttr).toBe('300,175 350,200 400,175');

    // Verify basic stroke properties
    expect(polyline!.getAttribute('fill')).toBe('none');
    expect(polyline!.getAttribute('stroke')).toBeTruthy();
  });

  // Test 2: Renders correct UML symbols for a COMPOSITION edge
  // COMPOSITION: filled diamond at source, no symbol at target, solid line
  it('renders correct UML symbols for a COMPOSITION edge (filled diamond at source, solid line)', () => {
    const diagram = createTestDiagram({
      nodes: [
        createTestNode({ id: 'node-1', pos_x: 100, pos_y: 100 }),
        createTestNode({ id: 'node-2', pos_x: 400, pos_y: 100 }),
      ],
      edges: [
        createTestEdge({
          id: 'edge-composition',
          source_node_id: 'node-1',
          target_node_id: 'node-2',
          relationship_type: 'COMPOSITION',
          edge_points: [
            { sequence_order: 1, pos_x: 300, pos_y: 175 },
            { sequence_order: 2, pos_x: 400, pos_y: 175 },
          ],
        }),
      ],
    });

    const { container } = renderInSvg(diagram);

    const edgeGroup = container.querySelector('[data-testid="temp-erd-edge-edge-composition"]');
    expect(edgeGroup).not.toBeNull();

    // COMPOSITION should have a source symbol (filled diamond)
    const sourceSymbol = edgeGroup!.querySelector('[data-testid="temp-erd-edge-source-symbol-edge-composition"]');
    expect(sourceSymbol).not.toBeNull();

    // The filled diamond has fill === stroke color (not 'white' or 'none')
    const fillAttr = sourceSymbol!.getAttribute('fill');
    const strokeAttr = sourceSymbol!.getAttribute('stroke');
    expect(fillAttr).toBe(strokeAttr); // Filled diamond: fill matches stroke color

    // COMPOSITION should NOT have a target symbol
    const targetSymbol = edgeGroup!.querySelector('[data-testid="temp-erd-edge-target-symbol-edge-composition"]');
    expect(targetSymbol).toBeNull();

    // Verify solid line (no stroke-dasharray)
    const polyline = edgeGroup!.querySelector('polyline');
    expect(polyline).not.toBeNull();
    // For solid lines, stroke-dasharray should not be set (null or absent)
    const dasharray = polyline!.getAttribute('stroke-dasharray');
    expect(dasharray).toBeNull();
  });

  // Test 3: Renders source_label and target_label as <text> elements at their pos_x/pos_y coordinates
  it('renders source_label and target_label as text elements at their pos_x/pos_y coordinates', () => {
    const diagram = createTestDiagram({
      nodes: [
        createTestNode({ id: 'node-1', pos_x: 100, pos_y: 100 }),
        createTestNode({ id: 'node-2', pos_x: 400, pos_y: 100 }),
      ],
      edges: [
        createTestEdge({
          id: 'edge-labels',
          source_node_id: 'node-1',
          target_node_id: 'node-2',
          edge_points: [
            { sequence_order: 1, pos_x: 300, pos_y: 175 },
            { sequence_order: 2, pos_x: 400, pos_y: 175 },
          ],
          source_label: {
            text: '1',
            pos_x: 310,
            pos_y: 165,
          },
          target_label: {
            text: '0..*',
            pos_x: 390,
            pos_y: 165,
          },
        }),
      ],
    });

    const { container } = renderInSvg(diagram);

    const edgeGroup = container.querySelector('[data-testid="temp-erd-edge-edge-labels"]');
    expect(edgeGroup).not.toBeNull();

    // Verify source label
    const sourceLabel = edgeGroup!.querySelector('[data-testid="temp-erd-edge-source-label-edge-labels"]');
    expect(sourceLabel).not.toBeNull();
    expect(sourceLabel!.textContent).toBe('1');
    expect(sourceLabel!.getAttribute('x')).toBe('310');
    expect(sourceLabel!.getAttribute('y')).toBe('165');

    // Verify target label
    const targetLabel = edgeGroup!.querySelector('[data-testid="temp-erd-edge-target-label-edge-labels"]');
    expect(targetLabel).not.toBeNull();
    expect(targetLabel!.textContent).toBe('0..*');
    expect(targetLabel!.getAttribute('x')).toBe('390');
    expect(targetLabel!.getAttribute('y')).toBe('165');
  });

  // Test 4: Auto-computes border-to-border points when edge_points are empty
  it('auto-computes border-to-border points when edge_points are empty', () => {
    const diagram = createTestDiagram({
      nodes: [
        createTestNode({ id: 'node-1', pos_x: 100, pos_y: 100 }),
        createTestNode({ id: 'node-2', pos_x: 400, pos_y: 100 }),
      ],
      edges: [
        // Edge with empty edge_points -- should auto-compute from node borders
        createTestEdge({
          id: 'edge-empty-points',
          source_node_id: 'node-1',
          target_node_id: 'node-2',
          edge_points: [],
        }),
        // Edge with valid edge_points (should still render as-is)
        createTestEdge({
          id: 'edge-valid',
          source_node_id: 'node-1',
          target_node_id: 'node-2',
          edge_points: [
            { sequence_order: 1, pos_x: 300, pos_y: 175 },
            { sequence_order: 2, pos_x: 400, pos_y: 175 },
          ],
        }),
      ],
    });

    // Should not throw
    const { container } = renderInSvg(diagram);

    // The edge with empty points should now render with auto-computed border points
    // Node-1: (100,100) w=200 h=150 → right-center = (300, 175)
    // Node-2: (400,100) w=200 h=150 → left-center = (400, 175)
    const autoEdgeGroup = container.querySelector('[data-testid="temp-erd-edge-edge-empty-points"]');
    expect(autoEdgeGroup).not.toBeNull();
    const autoPolyline = autoEdgeGroup!.querySelector('polyline');
    expect(autoPolyline).not.toBeNull();
    expect(autoPolyline!.getAttribute('points')).toBe('300,175 400,175');

    // The valid edge should still render with its provided points
    const validEdgeGroup = container.querySelector('[data-testid="temp-erd-edge-edge-valid"]');
    expect(validEdgeGroup).not.toBeNull();
    const polyline = validEdgeGroup!.querySelector('polyline');
    expect(polyline).not.toBeNull();
  });
});

// ============================================================================
// Task Group 6: Gap-Fill Tests -- Renderer
// ============================================================================

describe('TemporaryDiagramRenderer - Gap-Fill: Edge Relationship Types', () => {
  /**
   * Gap 1: GENERALIZATION edge -- hollow triangle at TARGET, no source symbol, solid line.
   * This covers the target-symbol rendering path (vs COMPOSITION which is source-only).
   */
  it('renders GENERALIZATION edge with hollow triangle at target, solid line', () => {
    const diagram = createTestDiagram({
      nodes: [
        createTestNode({ id: 'node-1', pos_x: 100, pos_y: 100 }),
        createTestNode({ id: 'node-2', pos_x: 400, pos_y: 100 }),
      ],
      edges: [
        createTestEdge({
          id: 'edge-gen',
          relationship_type: 'GENERALIZATION',
          edge_points: [
            { sequence_order: 1, pos_x: 300, pos_y: 175 },
            { sequence_order: 2, pos_x: 400, pos_y: 175 },
          ],
        }),
      ],
    });

    const { container } = renderInSvg(diagram);
    const edgeGroup = container.querySelector('[data-testid="temp-erd-edge-edge-gen"]');
    expect(edgeGroup).not.toBeNull();

    // GENERALIZATION: no source symbol
    const sourceSymbol = edgeGroup!.querySelector('[data-testid="temp-erd-edge-source-symbol-edge-gen"]');
    expect(sourceSymbol).toBeNull();

    // GENERALIZATION: hollow triangle at target (fill is 'white', not stroke color)
    const targetSymbol = edgeGroup!.querySelector('[data-testid="temp-erd-edge-target-symbol-edge-gen"]');
    expect(targetSymbol).not.toBeNull();
    expect(targetSymbol!.getAttribute('fill')).toBe('white');

    // Solid line: no stroke-dasharray
    const polyline = edgeGroup!.querySelector('polyline');
    expect(polyline!.getAttribute('stroke-dasharray')).toBeNull();
  });

  /**
   * Gap 2: DEPENDENCY edge -- open arrow at TARGET, dashed line.
   * This covers the dashed line rendering path and open arrow symbol.
   */
  it('renders DEPENDENCY edge with open arrow at target and dashed line', () => {
    const diagram = createTestDiagram({
      nodes: [
        createTestNode({ id: 'node-1', pos_x: 100, pos_y: 100 }),
        createTestNode({ id: 'node-2', pos_x: 400, pos_y: 100 }),
      ],
      edges: [
        createTestEdge({
          id: 'edge-dep',
          relationship_type: 'DEPENDENCY',
          edge_points: [
            { sequence_order: 1, pos_x: 300, pos_y: 175 },
            { sequence_order: 2, pos_x: 400, pos_y: 175 },
          ],
        }),
      ],
    });

    const { container } = renderInSvg(diagram);
    const edgeGroup = container.querySelector('[data-testid="temp-erd-edge-edge-dep"]');
    expect(edgeGroup).not.toBeNull();

    // DEPENDENCY: no source symbol
    const sourceSymbol = edgeGroup!.querySelector('[data-testid="temp-erd-edge-source-symbol-edge-dep"]');
    expect(sourceSymbol).toBeNull();

    // DEPENDENCY: open arrow at target (fill is 'none')
    const targetSymbol = edgeGroup!.querySelector('[data-testid="temp-erd-edge-target-symbol-edge-dep"]');
    expect(targetSymbol).not.toBeNull();
    expect(targetSymbol!.getAttribute('fill')).toBe('none');

    // Dashed line: stroke-dasharray should be set to '6,3'
    const polyline = edgeGroup!.querySelector('polyline');
    expect(polyline!.getAttribute('stroke-dasharray')).toBe('6,3');
  });

  /**
   * Gap 3: AGGREGATION edge -- hollow diamond at SOURCE, no target symbol, solid line.
   * This covers hollow diamond rendering (vs COMPOSITION's filled diamond).
   */
  it('renders AGGREGATION edge with hollow diamond at source, solid line', () => {
    const diagram = createTestDiagram({
      nodes: [
        createTestNode({ id: 'node-1', pos_x: 100, pos_y: 100 }),
        createTestNode({ id: 'node-2', pos_x: 400, pos_y: 100 }),
      ],
      edges: [
        createTestEdge({
          id: 'edge-agg',
          relationship_type: 'AGGREGATION',
          edge_points: [
            { sequence_order: 1, pos_x: 300, pos_y: 175 },
            { sequence_order: 2, pos_x: 400, pos_y: 175 },
          ],
        }),
      ],
    });

    const { container } = renderInSvg(diagram);
    const edgeGroup = container.querySelector('[data-testid="temp-erd-edge-edge-agg"]');
    expect(edgeGroup).not.toBeNull();

    // AGGREGATION: hollow diamond at source (fill is 'white', not stroke color)
    const sourceSymbol = edgeGroup!.querySelector('[data-testid="temp-erd-edge-source-symbol-edge-agg"]');
    expect(sourceSymbol).not.toBeNull();
    expect(sourceSymbol!.getAttribute('fill')).toBe('white');

    // AGGREGATION: no target symbol
    const targetSymbol = edgeGroup!.querySelector('[data-testid="temp-erd-edge-target-symbol-edge-agg"]');
    expect(targetSymbol).toBeNull();

    // Solid line: no stroke-dasharray
    const polyline = edgeGroup!.querySelector('polyline');
    expect(polyline!.getAttribute('stroke-dasharray')).toBeNull();
  });

  /**
   * Gap 6: Undefined relationship_type defaults to ASSOCIATION -- no symbols, solid line.
   */
  it('renders edge with undefined relationship_type as ASSOCIATION (no symbols, solid line)', () => {
    const diagram = createTestDiagram({
      nodes: [
        createTestNode({ id: 'node-1', pos_x: 100, pos_y: 100 }),
        createTestNode({ id: 'node-2', pos_x: 400, pos_y: 100 }),
      ],
      edges: [
        createTestEdge({
          id: 'edge-assoc',
          // relationship_type is intentionally omitted (undefined)
          edge_points: [
            { sequence_order: 1, pos_x: 300, pos_y: 175 },
            { sequence_order: 2, pos_x: 400, pos_y: 175 },
          ],
        }),
      ],
    });

    const { container } = renderInSvg(diagram);
    const edgeGroup = container.querySelector('[data-testid="temp-erd-edge-edge-assoc"]');
    expect(edgeGroup).not.toBeNull();

    // ASSOCIATION: no source or target symbols
    expect(edgeGroup!.querySelector('[data-testid="temp-erd-edge-source-symbol-edge-assoc"]')).toBeNull();
    expect(edgeGroup!.querySelector('[data-testid="temp-erd-edge-target-symbol-edge-assoc"]')).toBeNull();

    // Solid line: no stroke-dasharray
    const polyline = edgeGroup!.querySelector('polyline');
    expect(polyline!.getAttribute('stroke-dasharray')).toBeNull();

    // But the polyline itself is rendered with points
    expect(polyline!.getAttribute('points')).toBe('300,175 400,175');
  });
});

describe('TemporaryDiagramRenderer - Gap-Fill: Unsupported Diagram Kind and Attribute Edge Cases', () => {
  /**
   * Gap 4: Unsupported diagram_kind displays a warning message.
   */
  it('renders a warning message for unsupported diagram_kind (non-ER)', () => {
    const diagram = createTestDiagram({
      diagram_kind: 'Sequence',
    });

    const { container } = renderInSvg(diagram);

    // Should NOT render any node or edge groups
    expect(container.querySelectorAll('[data-testid^="temp-erd-node-"]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-testid^="temp-erd-edge-"]')).toHaveLength(0);

    // Should render a warning text
    const textElements = container.querySelectorAll('text');
    const warningText = Array.from(textElements).find((t) =>
      t.textContent?.includes('Unsupported diagram kind')
    );
    expect(warningText).not.toBeUndefined();
    expect(warningText!.textContent).toContain('Sequence');
    expect(warningText!.textContent).toContain('Only ER diagrams are');
  });

  /**
   * Gap 5: Attribute formatting edge cases -- missing data_type shows name only,
   * missing metadata entirely shows name only.
   */
  it('formats attributes correctly when data_type is missing or metadata is absent', () => {
    // Case 1: metadata present but data_type is missing
    const itemNoDataType: TemporaryArchitectureDiagramCompartmentItem = {
      id: 'item-no-dt',
      item_kind: 'ATTRIBUTE',
      ref_name: 'status',
      display_name: 'status',
      semantic_type: 'LOGICAL_DATA_ATTRIBUTE',
      metadata: {
        is_primary_key: false,
      },
    };
    expect(formatCompartmentItem(itemNoDataType)).toBe('status');

    // Case 2: metadata entirely absent
    const itemNoMetadata: TemporaryArchitectureDiagramCompartmentItem = {
      id: 'item-no-meta',
      item_kind: 'ATTRIBUTE',
      ref_name: 'created_at',
      display_name: 'created_at',
      semantic_type: 'LOGICAL_DATA_ATTRIBUTE',
      // no metadata property
    };
    expect(formatCompartmentItem(itemNoMetadata)).toBe('created_at');

    // Case 3: PK flag set but no data_type
    const itemPkNoType: TemporaryArchitectureDiagramCompartmentItem = {
      id: 'item-pk-no-type',
      item_kind: 'ATTRIBUTE',
      ref_name: 'id',
      display_name: 'id',
      semantic_type: 'LOGICAL_DATA_ATTRIBUTE',
      metadata: {
        is_primary_key: true,
      },
    };
    expect(formatCompartmentItem(itemPkNoType)).toBe('PK id');

    // Case 4: Both PK and FK set, with data_type (already tested inline but verified here as dedicated)
    const itemBothFlags: TemporaryArchitectureDiagramCompartmentItem = {
      id: 'item-both-flags',
      item_kind: 'ATTRIBUTE',
      ref_name: 'composite_key',
      display_name: 'composite_key',
      semantic_type: 'LOGICAL_DATA_ATTRIBUTE',
      metadata: {
        is_primary_key: true,
        is_foreign_key: true,
        data_type: 'UUID',
      },
    };
    expect(formatCompartmentItem(itemBothFlags)).toBe('PK FK composite_key : UUID');
  });
});
