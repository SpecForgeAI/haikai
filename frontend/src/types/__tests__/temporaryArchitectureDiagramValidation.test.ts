/**
 * Tests for Temporary Architecture Diagram Validation Helpers
 *
 * Spec: 2026-03-26 Temporary Architecture Diagram JSON Contract (ER First)
 * Task Group 3, Task 3.1: 6 focused tests for validation helpers
 *
 * These tests verify:
 * 1. isTemporaryArchitectureDiagram returns true for a valid diagram object
 * 2. isTemporaryArchitectureDiagram returns false for null, undefined, and objects missing required fields
 * 3. isValidERDiagram returns true for a valid ER diagram with correct diagram_kind and view_mode
 * 4. isValidERDiagram returns false when diagram_kind is not "ER" or view_mode is not "LOGICAL" / "PHYSICAL"
 * 5. Semantic type consistency checker detects mismatched semantic_type values
 * 6. Internal reference consistency checker detects edges referencing non-existent node IDs
 */

import { describe, it, expect } from 'vitest';
import type { TemporaryArchitectureDiagram } from '../temporaryArchitectureDiagram';
import {
  isTemporaryArchitectureDiagram,
  isValidERDiagram,
  checkSemanticTypeConsistency,
  checkReferenceConsistency,
} from '../temporaryArchitectureDiagramValidation';

/**
 * Helper to build a minimal valid TemporaryArchitectureDiagram for test purposes.
 * Returns a LOGICAL ER diagram with two nodes, one edge, and one group.
 */
function buildMinimalValidDiagram(
  overrides?: Partial<TemporaryArchitectureDiagram>
): TemporaryArchitectureDiagram {
  return {
    id: 'diag-test-001',
    name: 'Test Diagram',
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
        pos_x: 50,
        pos_y: 50,
        width: 200,
        height: 150,
        compartments: [
          {
            id: 'comp-1',
            compartment_kind: 'ATTRIBUTES',
            items: [
              {
                id: 'attr-1',
                item_kind: 'ATTRIBUTE',
                ref_name: 'customer_id',
                display_name: 'Customer ID',
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
        pos_x: 350,
        pos_y: 50,
        width: 200,
        height: 150,
        compartments: [
          {
            id: 'comp-2',
            compartment_kind: 'ATTRIBUTES',
            items: [
              {
                id: 'attr-2',
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
          { sequence_order: 1, pos_x: 250, pos_y: 125 },
          { sequence_order: 2, pos_x: 350, pos_y: 125 },
        ],
        cardinality: 'ONE_TO_MANY',
        relationship_type: 'ASSOCIATION',
      },
    ],
    groups: [
      {
        id: 'group-1',
        group_kind: 'SCHEMA',
        pos_x: 30,
        pos_y: 30,
        width: 540,
        height: 200,
        child_node_ids: ['node-1', 'node-2'],
      },
    ],
    ...overrides,
  };
}

describe('Temporary Architecture Diagram validation helpers', () => {
  /**
   * Test 1: isTemporaryArchitectureDiagram returns true for a valid diagram object.
   *
   * Constructs a valid diagram with all required fields and verifies
   * the type guard returns true.
   */
  it('isTemporaryArchitectureDiagram returns true for a valid diagram object', () => {
    const diagram = buildMinimalValidDiagram();

    expect(isTemporaryArchitectureDiagram(diagram)).toBe(true);
  });

  /**
   * Test 2: isTemporaryArchitectureDiagram returns false for null, undefined,
   * and objects missing required fields.
   *
   * Tests several invalid inputs to ensure the type guard rejects them.
   */
  it('isTemporaryArchitectureDiagram returns false for null, undefined, and objects missing required fields', () => {
    // null
    expect(isTemporaryArchitectureDiagram(null)).toBe(false);

    // undefined
    expect(isTemporaryArchitectureDiagram(undefined)).toBe(false);

    // Empty object (missing all required fields)
    expect(isTemporaryArchitectureDiagram({})).toBe(false);

    // Non-object primitive values
    expect(isTemporaryArchitectureDiagram('a string')).toBe(false);
    expect(isTemporaryArchitectureDiagram(42)).toBe(false);
    expect(isTemporaryArchitectureDiagram(true)).toBe(false);

    // Object missing 'nodes' and 'edges' fields
    expect(
      isTemporaryArchitectureDiagram({
        id: 'diag-001',
        name: 'Test',
        diagram_kind: 'ER',
        source_architecture_domain: 'DATA',
        view_mode: 'LOGICAL',
        version: 1,
        // nodes and edges missing
      })
    ).toBe(false);

    // Object with wrong type for 'version' (string instead of number)
    expect(
      isTemporaryArchitectureDiagram({
        id: 'diag-001',
        name: 'Test',
        diagram_kind: 'ER',
        source_architecture_domain: 'DATA',
        view_mode: 'LOGICAL',
        version: '1',
        nodes: [],
        edges: [],
      })
    ).toBe(false);

    // Object missing 'id'
    expect(
      isTemporaryArchitectureDiagram({
        name: 'Test',
        diagram_kind: 'ER',
        source_architecture_domain: 'DATA',
        view_mode: 'LOGICAL',
        version: 1,
        nodes: [],
        edges: [],
      })
    ).toBe(false);
  });

  /**
   * Test 3: isValidERDiagram returns true for a valid ER diagram with correct
   * diagram_kind and view_mode.
   *
   * Tests both LOGICAL and PHYSICAL view modes.
   */
  it('isValidERDiagram returns true for a valid ER diagram with correct diagram_kind and view_mode', () => {
    const logicalDiagram = buildMinimalValidDiagram({
      diagram_kind: 'ER',
      view_mode: 'LOGICAL',
    });
    expect(isValidERDiagram(logicalDiagram)).toBe(true);

    const physicalDiagram = buildMinimalValidDiagram({
      diagram_kind: 'ER',
      view_mode: 'PHYSICAL',
    });
    expect(isValidERDiagram(physicalDiagram)).toBe(true);
  });

  /**
   * Test 4: isValidERDiagram returns false when diagram_kind is not "ER"
   * or view_mode is not "LOGICAL" / "PHYSICAL".
   *
   * Tests various invalid combinations.
   */
  it('isValidERDiagram returns false when diagram_kind is not "ER" or view_mode is invalid', () => {
    // Wrong diagram_kind
    const sequenceDiagram = buildMinimalValidDiagram({
      diagram_kind: 'SEQUENCE',
      view_mode: 'LOGICAL',
    });
    expect(isValidERDiagram(sequenceDiagram)).toBe(false);

    // Correct diagram_kind but wrong view_mode
    const unknownViewMode = buildMinimalValidDiagram({
      diagram_kind: 'ER',
      view_mode: 'CONCEPTUAL',
    });
    expect(isValidERDiagram(unknownViewMode)).toBe(false);

    // Both wrong
    const bothWrong = buildMinimalValidDiagram({
      diagram_kind: 'ACTIVITY',
      view_mode: 'ABSTRACT',
    });
    expect(isValidERDiagram(bothWrong)).toBe(false);
  });

  /**
   * Test 5: Semantic type consistency checker detects mismatched semantic_type values.
   *
   * Creates a LOGICAL diagram with PHYSICAL_DATA_ENTITY nodes and verifies that
   * the checker returns descriptive inconsistency messages.
   */
  it('checkSemanticTypeConsistency detects mismatched semantic_type values', () => {
    // LOGICAL diagram with PHYSICAL semantic types on nodes and items (mismatch)
    const mismatchedDiagram = buildMinimalValidDiagram({
      view_mode: 'LOGICAL',
      nodes: [
        {
          id: 'node-bad-1',
          node_kind: 'ENTITY',
          semantic_type: 'PHYSICAL_DATA_ENTITY', // WRONG for LOGICAL
          ref_name: 'Customer',
          display_name: 'Customer',
          pos_x: 50,
          pos_y: 50,
          width: 200,
          height: 150,
          compartments: [
            {
              id: 'comp-bad-1',
              compartment_kind: 'ATTRIBUTES',
              items: [
                {
                  id: 'attr-bad-1',
                  item_kind: 'ATTRIBUTE',
                  ref_name: 'customer_id',
                  display_name: 'Customer ID',
                  semantic_type: 'PHYSICAL_DATA_ATTRIBUTE', // WRONG for LOGICAL
                },
              ],
            },
          ],
        },
        {
          id: 'node-good-1',
          node_kind: 'ENTITY',
          semantic_type: 'LOGICAL_DATA_ENTITY', // correct
          ref_name: 'Order',
          display_name: 'Order',
          pos_x: 350,
          pos_y: 50,
          width: 200,
          height: 150,
          compartments: [
            {
              id: 'comp-good-1',
              compartment_kind: 'ATTRIBUTES',
              items: [
                {
                  id: 'attr-good-1',
                  item_kind: 'ATTRIBUTE',
                  ref_name: 'order_id',
                  display_name: 'Order ID',
                  semantic_type: 'LOGICAL_DATA_ATTRIBUTE', // correct
                },
              ],
            },
          ],
        },
      ],
    });

    const messages = checkSemanticTypeConsistency(mismatchedDiagram);

    // Should have exactly 2 errors: one for the node, one for the compartment item
    expect(messages).toHaveLength(2);
    expect(messages[0]).toContain('node-bad-1');
    expect(messages[0]).toContain('PHYSICAL_DATA_ENTITY');
    expect(messages[0]).toContain('LOGICAL_DATA_ENTITY');
    expect(messages[1]).toContain('attr-bad-1');
    expect(messages[1]).toContain('PHYSICAL_DATA_ATTRIBUTE');
    expect(messages[1]).toContain('LOGICAL_DATA_ATTRIBUTE');

    // A consistent diagram should return no messages
    const consistentDiagram = buildMinimalValidDiagram();
    const noMessages = checkSemanticTypeConsistency(consistentDiagram);
    expect(noMessages).toHaveLength(0);
  });

  /**
   * Test 6: Internal reference consistency checker detects edges referencing
   * non-existent node IDs and groups referencing non-existent child node IDs.
   *
   * Creates a diagram with broken references and verifies the checker returns
   * descriptive messages for each broken reference.
   */
  it('checkReferenceConsistency detects edges and groups referencing non-existent node IDs', () => {
    const brokenRefsDiagram = buildMinimalValidDiagram({
      edges: [
        {
          id: 'edge-broken-source',
          edge_kind: 'RELATIONSHIP',
          semantic_type: 'DATA_ENTITY_RELATIONSHIP',
          source_node_id: 'node-does-not-exist', // BROKEN reference
          target_node_id: 'node-1', // valid
          source_ref_name: 'Ghost',
          target_ref_name: 'Customer',
          edge_points: [
            { sequence_order: 1, pos_x: 0, pos_y: 0 },
          ],
        },
        {
          id: 'edge-broken-target',
          edge_kind: 'RELATIONSHIP',
          semantic_type: 'DATA_ENTITY_RELATIONSHIP',
          source_node_id: 'node-2', // valid
          target_node_id: 'node-also-missing', // BROKEN reference
          source_ref_name: 'Order',
          target_ref_name: 'Phantom',
          edge_points: [
            { sequence_order: 1, pos_x: 0, pos_y: 0 },
          ],
        },
      ],
      groups: [
        {
          id: 'group-broken',
          group_kind: 'SCHEMA',
          pos_x: 0,
          pos_y: 0,
          width: 500,
          height: 500,
          child_node_ids: ['node-1', 'node-ghost-child'], // one valid, one BROKEN
        },
      ],
    });

    const messages = checkReferenceConsistency(brokenRefsDiagram);

    // Should detect 3 broken references:
    // 1. edge-broken-source -> source_node_id "node-does-not-exist"
    // 2. edge-broken-target -> target_node_id "node-also-missing"
    // 3. group-broken -> child_node_id "node-ghost-child"
    expect(messages).toHaveLength(3);

    expect(messages[0]).toContain('edge-broken-source');
    expect(messages[0]).toContain('source_node_id');
    expect(messages[0]).toContain('node-does-not-exist');

    expect(messages[1]).toContain('edge-broken-target');
    expect(messages[1]).toContain('target_node_id');
    expect(messages[1]).toContain('node-also-missing');

    expect(messages[2]).toContain('group-broken');
    expect(messages[2]).toContain('child_node_id');
    expect(messages[2]).toContain('node-ghost-child');

    // A consistent diagram should return no messages
    const consistentDiagram = buildMinimalValidDiagram();
    const noMessages = checkReferenceConsistency(consistentDiagram);
    expect(noMessages).toHaveLength(0);
  });
});
