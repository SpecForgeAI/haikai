/**
 * Tests for the standalone TemporaryArchitectureDiagram validator.
 *
 * Covers structural checks, ER-specific checks, semantic type consistency,
 * node/edge/compartment validation, and group reference validation.
 */

import { validateTemporaryArchitectureDiagram } from '../services/temporaryArchitectureDiagramValidator';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Builds a minimal valid LOGICAL ER diagram payload for testing.
 * All required fields are present and correct.
 */
function buildValidLogicalDiagram(): Record<string, unknown> {
  return {
    id: 'diagram-001',
    name: 'Test ER Diagram',
    diagram_kind: 'ER',
    source_architecture_domain: 'DATA',
    view_mode: 'LOGICAL',
    version: 1,
    nodes: [
      {
        id: 'node-1',
        node_kind: 'ENTITY',
        semantic_type: 'LOGICAL_DATA_ENTITY',
        ref_name: 'Customer',
        display_name: 'Customer',
        pos_x: 100,
        pos_y: 200,
        width: 200,
        height: 150,
        compartments: [
          {
            id: 'comp-1',
            compartment_kind: 'ATTRIBUTES',
            items: [
              {
                id: 'item-1',
                item_kind: 'ATTRIBUTE',
                ref_name: 'customer_id',
                display_name: 'Customer ID',
                semantic_type: 'LOGICAL_DATA_ATTRIBUTE',
              },
              {
                id: 'item-2',
                item_kind: 'ATTRIBUTE',
                ref_name: 'customer_name',
                display_name: 'Customer Name',
                semantic_type: 'LOGICAL_DATA_ATTRIBUTE',
              },
            ],
          },
        ],
      },
      {
        id: 'node-2',
        node_kind: 'ENTITY',
        semantic_type: 'LOGICAL_DATA_ENTITY',
        ref_name: 'Order',
        display_name: 'Order',
        pos_x: 400,
        pos_y: 200,
        width: 200,
        height: 150,
        compartments: [
          {
            id: 'comp-2',
            compartment_kind: 'ATTRIBUTES',
            items: [
              {
                id: 'item-3',
                item_kind: 'ATTRIBUTE',
                ref_name: 'order_id',
                display_name: 'Order ID',
                semantic_type: 'LOGICAL_DATA_ATTRIBUTE',
              },
            ],
          },
        ],
      },
    ],
    edges: [
      {
        id: 'edge-1',
        edge_kind: 'RELATIONSHIP',
        semantic_type: 'DATA_ENTITY_RELATIONSHIP',
        source_node_id: 'node-1',
        target_node_id: 'node-2',
        source_ref_name: 'Customer',
        target_ref_name: 'Order',
        edge_points: [
          { sequence_order: 0, pos_x: 300, pos_y: 275 },
          { sequence_order: 1, pos_x: 400, pos_y: 275 },
        ],
      },
    ],
  };
}

/**
 * Builds a minimal valid PHYSICAL ER diagram payload for testing.
 * All required fields are present and correct with PHYSICAL semantic types.
 */
function buildValidPhysicalDiagram(): Record<string, unknown> {
  return {
    id: 'diagram-002',
    name: 'Physical ER Diagram',
    diagram_kind: 'ER',
    source_architecture_domain: 'DATA',
    view_mode: 'PHYSICAL',
    version: 1,
    nodes: [
      {
        id: 'node-1',
        node_kind: 'ENTITY',
        semantic_type: 'PHYSICAL_DATA_ENTITY',
        ref_name: 'customers_table',
        display_name: 'Customers Table',
        pos_x: 100,
        pos_y: 200,
        width: 200,
        height: 150,
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
                semantic_type: 'PHYSICAL_DATA_ATTRIBUTE',
              },
            ],
          },
        ],
      },
      {
        id: 'node-2',
        node_kind: 'ENTITY',
        semantic_type: 'PHYSICAL_DATA_ENTITY',
        ref_name: 'orders_table',
        display_name: 'Orders Table',
        pos_x: 400,
        pos_y: 200,
        width: 200,
        height: 150,
        compartments: [
          {
            id: 'comp-2',
            compartment_kind: 'ATTRIBUTES',
            items: [
              {
                id: 'item-2',
                item_kind: 'ATTRIBUTE',
                ref_name: 'order_id',
                display_name: 'order_id',
                semantic_type: 'PHYSICAL_DATA_ATTRIBUTE',
              },
            ],
          },
        ],
      },
    ],
    edges: [
      {
        id: 'edge-1',
        edge_kind: 'RELATIONSHIP',
        semantic_type: 'DATA_ENTITY_RELATIONSHIP',
        source_node_id: 'node-1',
        target_node_id: 'node-2',
        source_ref_name: 'customers_table',
        target_ref_name: 'orders_table',
        edge_points: [
          { sequence_order: 0, pos_x: 300, pos_y: 275 },
          { sequence_order: 1, pos_x: 400, pos_y: 275 },
        ],
      },
    ],
  };
}

// ============================================================================
// Test 1: Valid LOGICAL ER diagram returns empty array
// ============================================================================

describe('validateTemporaryArchitectureDiagram', () => {
  it('returns empty array for a fully valid LOGICAL ER diagram payload', () => {
    const diagram = buildValidLogicalDiagram();
    const errors = validateTemporaryArchitectureDiagram(diagram);
    expect(errors).toEqual([]);
  });

  // ==========================================================================
  // Test 2: Missing required top-level fields
  // ==========================================================================

  it('returns errors for missing required top-level fields', () => {
    const diagram = {
      // All required fields missing
    };
    const errors = validateTemporaryArchitectureDiagram(diagram);

    expect(errors.length).toBeGreaterThanOrEqual(8);
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('id is required'),
        expect.stringContaining('name is required'),
        expect.stringContaining('diagram_kind is required'),
        expect.stringContaining('source_architecture_domain is required'),
        expect.stringContaining('view_mode is required'),
        expect.stringContaining('version is required'),
        expect.stringContaining('nodes is required'),
        expect.stringContaining('edges is required'),
      ])
    );
  });

  // ==========================================================================
  // Test 3: Incorrect ER-specific values
  // ==========================================================================

  it('returns errors for incorrect ER-specific values (diagram_kind, source_architecture_domain, view_mode)', () => {
    const diagram = buildValidLogicalDiagram();
    diagram.diagram_kind = 'SEQUENCE';
    diagram.source_architecture_domain = 'BUSINESS';
    diagram.view_mode = 'CONCEPTUAL';

    const errors = validateTemporaryArchitectureDiagram(diagram);

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('diagram_kind must be "ER"'),
        expect.stringContaining('source_architecture_domain must be "DATA"'),
        expect.stringContaining('view_mode must be "LOGICAL" or "PHYSICAL"'),
      ])
    );
  });

  // ==========================================================================
  // Test 4: Semantic type inconsistency
  // ==========================================================================

  it('returns errors for semantic type inconsistency (LOGICAL view_mode with PHYSICAL semantic types)', () => {
    const diagram = buildValidLogicalDiagram();

    // Set view_mode to LOGICAL but use PHYSICAL semantic types
    diagram.view_mode = 'LOGICAL';
    const nodes = diagram.nodes as any[];
    nodes[0].semantic_type = 'PHYSICAL_DATA_ENTITY';
    nodes[0].compartments[0].items[0].semantic_type = 'PHYSICAL_DATA_ATTRIBUTE';

    const errors = validateTemporaryArchitectureDiagram(diagram);

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('has semantic_type "PHYSICAL_DATA_ENTITY" but expected "LOGICAL_DATA_ENTITY"'),
        expect.stringContaining('has semantic_type "PHYSICAL_DATA_ATTRIBUTE" but expected "LOGICAL_DATA_ATTRIBUTE"'),
      ])
    );
  });

  // ==========================================================================
  // Test 5: Duplicate node IDs
  // ==========================================================================

  it('returns errors for duplicate node IDs', () => {
    const diagram = buildValidLogicalDiagram();
    const nodes = diagram.nodes as any[];

    // Set both nodes to have the same ID
    nodes[1].id = 'node-1';

    const errors = validateTemporaryArchitectureDiagram(diagram);

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Duplicate node id: "node-1"'),
      ])
    );
  });

  // ==========================================================================
  // Test 6: Edge referencing non-existent node IDs
  // ==========================================================================

  it('returns errors for edge referencing non-existent node IDs', () => {
    const diagram = buildValidLogicalDiagram();
    const edges = diagram.edges as any[];

    edges[0].source_node_id = 'non-existent-source';
    edges[0].target_node_id = 'non-existent-target';

    const errors = validateTemporaryArchitectureDiagram(diagram);

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('references source_node_id "non-existent-source" which does not exist'),
        expect.stringContaining('references target_node_id "non-existent-target" which does not exist'),
      ])
    );
  });

  // ==========================================================================
  // Test 7: Edge points with fewer than 2 points and non-contiguous sequence_order
  // ==========================================================================

  it('returns errors for edge_points with fewer than 2 points or non-contiguous sequence_order', () => {
    const diagram = buildValidLogicalDiagram();
    const edges = diagram.edges as any[];

    // Test 1: fewer than 2 points
    edges[0].edge_points = [
      { sequence_order: 0, pos_x: 100, pos_y: 200 },
    ];

    let errors = validateTemporaryArchitectureDiagram(diagram);
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('must have at least 2 edge_points but has 1'),
      ])
    );

    // Test 2: non-contiguous sequence_order (gap: 0, 2 instead of 0, 1)
    edges[0].edge_points = [
      { sequence_order: 0, pos_x: 100, pos_y: 200 },
      { sequence_order: 2, pos_x: 300, pos_y: 400 },
    ];

    errors = validateTemporaryArchitectureDiagram(diagram);
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('edge_points[1].sequence_order must be 1 but got 2'),
      ])
    );
  });

  // ==========================================================================
  // Test 8: Duplicate attribute ref_name within a single node
  // ==========================================================================

  it('returns errors for duplicate attribute ref_name within a single node', () => {
    const diagram = buildValidLogicalDiagram();
    const nodes = diagram.nodes as any[];

    // Make both attributes in node-1 have the same ref_name
    nodes[0].compartments[0].items[1].ref_name = 'customer_id';

    const errors = validateTemporaryArchitectureDiagram(diagram);

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Duplicate attribute ref_name "customer_id" in node "node-1"'),
      ])
    );
  });

  // ==========================================================================
  // Gap-fill Test: Validator accepts valid PHYSICAL ER diagram
  // ==========================================================================

  it('returns empty array for a fully valid PHYSICAL ER diagram payload', () => {
    const diagram = buildValidPhysicalDiagram();
    const errors = validateTemporaryArchitectureDiagram(diagram);
    expect(errors).toEqual([]);
  });

  // ==========================================================================
  // Gap-fill Test: Validator rejects edge with source_ref_name not matching
  // source node's ref_name
  // ==========================================================================

  it('returns errors for edge with source_ref_name not matching source node ref_name', () => {
    const diagram = buildValidLogicalDiagram();
    const edges = diagram.edges as any[];

    // Source node "node-1" has ref_name "Customer", but set edge source_ref_name to something else
    edges[0].source_ref_name = 'WrongSourceName';

    const errors = validateTemporaryArchitectureDiagram(diagram);

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('has source_ref_name "WrongSourceName" but source node "node-1" has ref_name "Customer"'),
      ])
    );
  });

  // ==========================================================================
  // Gap-fill Test: Validator rejects node with more than one ATTRIBUTES
  // compartment
  // ==========================================================================

  it('returns errors for node with more than one ATTRIBUTES compartment', () => {
    const diagram = buildValidLogicalDiagram();
    const nodes = diagram.nodes as any[];

    // Add a second ATTRIBUTES compartment to node-1
    nodes[0].compartments.push({
      id: 'comp-extra',
      compartment_kind: 'ATTRIBUTES',
      items: [
        {
          id: 'item-extra',
          item_kind: 'ATTRIBUTE',
          ref_name: 'extra_attr',
          display_name: 'Extra Attribute',
          semantic_type: 'LOGICAL_DATA_ATTRIBUTE',
        },
      ],
    });

    const errors = validateTemporaryArchitectureDiagram(diagram);

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('has 2 ATTRIBUTES compartments but at most 1 is allowed'),
      ])
    );
  });
});
