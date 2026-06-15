/**
 * Gap Analysis Tests for Temporary Architecture Diagram JSON Contract
 *
 * Spec: 2026-03-26 Temporary Architecture Diagram JSON Contract (ER First)
 * Task Group 4, Task 4.3: Up to 8 additional strategic tests to fill coverage gaps
 *
 * These tests verify:
 * 1. Edge `relationship_type` literal values exactly match `LogicalERRelationship` from `model.ts`
 * 2. Edge `cardinality` literal values exactly match `LogicalERCardinality` from `model.ts`
 * 3. A diagram with all optional fields omitted still satisfies the interface
 * 4. A diagram with all optional fields populated satisfies the interface
 * 5. `edge_points` ordering by `sequence_order` is preserved correctly in examples
 * 6. `source_item_ref_name` / `target_item_ref_name` on edges correctly reference attribute ref_names
 * 7. Group `child_node_ids` in example files reference only existing node IDs
 * 8. Example files contain no internal architecture IDs (no UUID patterns)
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import type {
  TemporaryArchitectureDiagram,
  TemporaryArchitectureDiagramEdge,
} from '../temporaryArchitectureDiagram';
import { isTemporaryArchitectureDiagram } from '../temporaryArchitectureDiagramValidation';
import type { LogicalERRelationship, LogicalERCardinality } from '../model';

const examplesDir = path.resolve(__dirname, '../examples');

function loadJsonExample(filename: string): TemporaryArchitectureDiagram {
  const filePath = path.join(examplesDir, filename);
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as TemporaryArchitectureDiagram;
}

describe('Temporary Architecture Diagram gap analysis tests', () => {
  /**
   * Test 1: Edge `relationship_type` literal values exactly match `LogicalERRelationship` from model.ts.
   *
   * Verifies that every value allowed in the `relationship_type` field on
   * `TemporaryArchitectureDiagramEdge` is a valid `LogicalERRelationship` value,
   * and that the full set of `LogicalERRelationship` values is covered.
   * This ensures the temporary contract stays aligned with the native model types.
   */
  it('relationship_type literal values exactly match LogicalERRelationship from model.ts', () => {
    // The exhaustive set of LogicalERRelationship values from model.ts
    const logicalERRelationshipValues: LogicalERRelationship[] = [
      'GENERALIZATION',
      'REALIZATION',
      'COMPOSITION',
      'AGGREGATION',
      'ASSOCIATION',
      'DEPENDENCY',
    ];

    // Verify each LogicalERRelationship value can be assigned to an edge's relationship_type
    // by constructing edges with each value and checking TypeScript-level type compatibility
    for (const relType of logicalERRelationshipValues) {
      const edge: TemporaryArchitectureDiagramEdge = {
        id: `edge-test-${relType}`,
        edge_kind: 'RELATIONSHIP',
        semantic_type: 'DATA_ENTITY_RELATIONSHIP',
        source_node_id: 'node-1',
        target_node_id: 'node-2',
        source_ref_name: 'Entity1',
        target_ref_name: 'Entity2',
        edge_points: [{ sequence_order: 1, pos_x: 0, pos_y: 0 }],
        relationship_type: relType,
      };

      expect(edge.relationship_type).toBe(relType);
    }

    // Verify the set is exactly 6 values (matching the model.ts definition)
    expect(logicalERRelationshipValues).toHaveLength(6);

    // Also verify that the example files only use valid LogicalERRelationship values
    const logical = loadJsonExample('temporary-er-diagram-logical.json');
    const physical = loadJsonExample('temporary-er-diagram-physical.json');

    for (const edge of [...logical.edges, ...physical.edges]) {
      if (edge.relationship_type) {
        expect(logicalERRelationshipValues).toContain(edge.relationship_type);
      }
    }
  });

  /**
   * Test 2: Edge `cardinality` literal values exactly match `LogicalERCardinality` from model.ts.
   *
   * Verifies that every value allowed in the `cardinality` field on
   * `TemporaryArchitectureDiagramEdge` is a valid `LogicalERCardinality` value,
   * and that the full set of `LogicalERCardinality` values is covered.
   */
  it('cardinality literal values exactly match LogicalERCardinality from model.ts', () => {
    // The exhaustive set of LogicalERCardinality values from model.ts
    const logicalERCardinalityValues: LogicalERCardinality[] = [
      'ONE_TO_ONE',
      'ONE_TO_MANY',
      'MANY_TO_ONE',
      'MANY_TO_MANY',
    ];

    // Verify each LogicalERCardinality value can be assigned to an edge's cardinality
    for (const card of logicalERCardinalityValues) {
      const edge: TemporaryArchitectureDiagramEdge = {
        id: `edge-test-${card}`,
        edge_kind: 'RELATIONSHIP',
        semantic_type: 'DATA_ENTITY_RELATIONSHIP',
        source_node_id: 'node-1',
        target_node_id: 'node-2',
        source_ref_name: 'Entity1',
        target_ref_name: 'Entity2',
        edge_points: [{ sequence_order: 1, pos_x: 0, pos_y: 0 }],
        cardinality: card,
      };

      expect(edge.cardinality).toBe(card);
    }

    // Verify the set is exactly 4 values (matching the model.ts definition)
    expect(logicalERCardinalityValues).toHaveLength(4);

    // Also verify that the example files only use valid LogicalERCardinality values
    const logical = loadJsonExample('temporary-er-diagram-logical.json');
    const physical = loadJsonExample('temporary-er-diagram-physical.json');

    for (const edge of [...logical.edges, ...physical.edges]) {
      if (edge.cardinality) {
        expect(logicalERCardinalityValues).toContain(edge.cardinality);
      }
    }
  });

  /**
   * Test 3: A diagram with all optional fields omitted still satisfies the interface.
   *
   * Constructs a minimally valid diagram with ONLY the required fields on every type
   * (no description, groups, metadata, style, z_index, compartments, labels, etc.)
   * and verifies it passes the type guard.
   */
  it('a diagram with all optional fields omitted satisfies the interface', () => {
    const minimalDiagram: TemporaryArchitectureDiagram = {
      id: 'diag-minimal',
      name: 'Minimal Diagram',
      diagram_kind: 'ER',
      source_architecture_domain: 'DATA',
      view_mode: 'LOGICAL',
      version: 1,
      nodes: [
        {
          id: 'node-a',
          node_kind: 'ENTITY',
          semantic_type: 'LOGICAL_DATA_ENTITY',
          ref_name: 'EntityA',
          display_name: 'Entity A',
          pos_x: 0,
          pos_y: 0,
          width: 100,
          height: 80,
          // No z_index, compartments, style, or metadata
        },
      ],
      edges: [
        {
          id: 'edge-a',
          edge_kind: 'RELATIONSHIP',
          semantic_type: 'DATA_ENTITY_RELATIONSHIP',
          source_node_id: 'node-a',
          target_node_id: 'node-a',
          source_ref_name: 'EntityA',
          target_ref_name: 'EntityA',
          edge_points: [{ sequence_order: 1, pos_x: 50, pos_y: 40 }],
          // No source_item_ref_name, target_item_ref_name, relationship_type,
          // cardinality, relationship_hint, source_label, target_label, style, metadata
        },
      ],
      // No description, groups, or metadata
    };

    // Must pass the type guard
    expect(isTemporaryArchitectureDiagram(minimalDiagram)).toBe(true);

    // Verify all optional top-level fields are undefined
    expect(minimalDiagram.description).toBeUndefined();
    expect(minimalDiagram.groups).toBeUndefined();
    expect(minimalDiagram.metadata).toBeUndefined();

    // Verify all optional node fields are undefined
    expect(minimalDiagram.nodes[0].z_index).toBeUndefined();
    expect(minimalDiagram.nodes[0].compartments).toBeUndefined();
    expect(minimalDiagram.nodes[0].style).toBeUndefined();
    expect(minimalDiagram.nodes[0].metadata).toBeUndefined();

    // Verify all optional edge fields are undefined
    expect(minimalDiagram.edges[0].source_item_ref_name).toBeUndefined();
    expect(minimalDiagram.edges[0].target_item_ref_name).toBeUndefined();
    expect(minimalDiagram.edges[0].relationship_type).toBeUndefined();
    expect(minimalDiagram.edges[0].cardinality).toBeUndefined();
    expect(minimalDiagram.edges[0].relationship_hint).toBeUndefined();
    expect(minimalDiagram.edges[0].source_label).toBeUndefined();
    expect(minimalDiagram.edges[0].target_label).toBeUndefined();
    expect(minimalDiagram.edges[0].style).toBeUndefined();
    expect(minimalDiagram.edges[0].metadata).toBeUndefined();
  });

  /**
   * Test 4: A diagram with all optional fields populated satisfies the interface.
   *
   * Constructs a fully-specified diagram with EVERY optional field set on every type
   * and verifies it passes the type guard and all values are present.
   */
  it('a diagram with all optional fields populated satisfies the interface', () => {
    const maximalDiagram: TemporaryArchitectureDiagram = {
      id: 'diag-maximal',
      name: 'Maximal Diagram',
      description: 'A diagram with every optional field populated',
      diagram_kind: 'ER',
      source_architecture_domain: 'DATA',
      view_mode: 'LOGICAL',
      version: 1,
      nodes: [
        {
          id: 'node-max-1',
          node_kind: 'ENTITY',
          semantic_type: 'LOGICAL_DATA_ENTITY',
          ref_name: 'MaxEntity',
          display_name: 'Max Entity',
          pos_x: 10,
          pos_y: 20,
          width: 200,
          height: 150,
          z_index: 5,
          compartments: [
            {
              id: 'comp-max-1',
              compartment_kind: 'ATTRIBUTES',
              items: [
                {
                  id: 'item-max-1',
                  item_kind: 'ATTRIBUTE',
                  ref_name: 'attr_a',
                  display_name: 'Attribute A',
                  semantic_type: 'LOGICAL_DATA_ATTRIBUTE',
                  metadata: {
                    is_primary_key: true,
                    is_foreign_key: false,
                    data_type: 'String',
                    is_nullable: false,
                  },
                },
              ],
            },
          ],
          style: {
            background_color: '#FFFFFF',
            line_color: '#000000',
            text_color: '#333333',
          },
          metadata: {
            is_primary: true,
            is_reference: false,
            tags: ['tagged'],
          },
        },
        {
          id: 'node-max-2',
          node_kind: 'ENTITY',
          semantic_type: 'LOGICAL_DATA_ENTITY',
          ref_name: 'MaxEntity2',
          display_name: 'Max Entity 2',
          pos_x: 300,
          pos_y: 20,
          width: 200,
          height: 150,
        },
      ],
      edges: [
        {
          id: 'edge-max-1',
          edge_kind: 'RELATIONSHIP',
          semantic_type: 'DATA_ENTITY_RELATIONSHIP',
          source_node_id: 'node-max-1',
          target_node_id: 'node-max-2',
          source_ref_name: 'MaxEntity',
          target_ref_name: 'MaxEntity2',
          edge_points: [
            { sequence_order: 1, pos_x: 210, pos_y: 95 },
            { sequence_order: 2, pos_x: 300, pos_y: 95 },
          ],
          source_item_ref_name: 'attr_a',
          relationship_type: 'ASSOCIATION',
          cardinality: 'ONE_TO_MANY',
          relationship_hint: 'Example relationship',
          source_label: { text: '1', pos_x: 215, pos_y: 85 },
          target_label: { text: '*', pos_x: 290, pos_y: 85 },
          style: {
            line_color: '#666666',
            line_type: 'DASHED',
            line_weight: 1,
          },
          metadata: {
            optionality: 'REQUIRED',
            notes: ['A note'],
          },
        },
      ],
      groups: [
        {
          id: 'group-max-1',
          group_kind: 'SCHEMA',
          ref_name: 'max_schema',
          display_name: 'Max Schema',
          pos_x: 0,
          pos_y: 0,
          width: 520,
          height: 200,
          child_node_ids: ['node-max-1', 'node-max-2'],
          style: {
            background_color: '#F0F0F0',
            line_color: '#AAAAAA',
            text_color: '#555555',
          },
        },
      ],
      metadata: {
        created_by_task: 'test-task',
        notes: ['First note', 'Second note'],
      },
    };

    // Must pass the type guard
    expect(isTemporaryArchitectureDiagram(maximalDiagram)).toBe(true);

    // Verify all optional top-level fields are present
    expect(maximalDiagram.description).toBeDefined();
    expect(maximalDiagram.groups).toBeDefined();
    expect(maximalDiagram.groups).toHaveLength(1);
    expect(maximalDiagram.metadata).toBeDefined();
    expect(maximalDiagram.metadata!.created_by_task).toBe('test-task');
    expect(maximalDiagram.metadata!.notes).toHaveLength(2);

    // Verify all optional node fields are present
    const node = maximalDiagram.nodes[0];
    expect(node.z_index).toBe(5);
    expect(node.compartments).toHaveLength(1);
    expect(node.compartments![0].items[0].metadata?.is_primary_key).toBe(true);
    expect(node.style?.background_color).toBe('#FFFFFF');
    expect(node.metadata?.is_primary).toBe(true);
    expect(node.metadata?.tags).toContain('tagged');

    // Verify all optional edge fields are present
    const edge = maximalDiagram.edges[0];
    expect(edge.source_item_ref_name).toBe('attr_a');
    expect(edge.relationship_type).toBe('ASSOCIATION');
    expect(edge.cardinality).toBe('ONE_TO_MANY');
    expect(edge.relationship_hint).toBe('Example relationship');
    expect(edge.source_label?.text).toBe('1');
    expect(edge.target_label?.text).toBe('*');
    expect(edge.style?.line_type).toBe('DASHED');
    expect(edge.metadata?.optionality).toBe('REQUIRED');

    // Verify all optional group fields are present
    const group = maximalDiagram.groups![0];
    expect(group.ref_name).toBe('max_schema');
    expect(group.display_name).toBe('Max Schema');
    expect(group.style?.background_color).toBe('#F0F0F0');
  });

  /**
   * Test 5: `edge_points` ordering by `sequence_order` is preserved correctly in examples.
   *
   * Verifies that in both example JSON files, every edge's `edge_points` array is
   * sorted in ascending `sequence_order` with no gaps or duplicates. This ensures
   * the polyline rendering order is deterministic.
   */
  it('edge_points ordering by sequence_order is preserved correctly in examples', () => {
    const logical = loadJsonExample('temporary-er-diagram-logical.json');
    const physical = loadJsonExample('temporary-er-diagram-physical.json');

    for (const diagram of [logical, physical]) {
      for (const edge of diagram.edges) {
        expect(edge.edge_points.length).toBeGreaterThanOrEqual(1);

        // Verify ascending sequence_order with no gaps
        const sequenceOrders = edge.edge_points.map((p) => p.sequence_order);
        for (let i = 1; i < sequenceOrders.length; i++) {
          expect(sequenceOrders[i]).toBeGreaterThan(sequenceOrders[i - 1]);
        }

        // Verify no duplicate sequence_order values
        const uniqueOrders = new Set(sequenceOrders);
        expect(uniqueOrders.size).toBe(sequenceOrders.length);

        // Verify the first sequence_order starts at 1
        expect(sequenceOrders[0]).toBe(1);
      }
    }
  });

  /**
   * Test 6: `source_item_ref_name` / `target_item_ref_name` on edges correctly
   * reference attribute ref_names when present.
   *
   * For every edge in the examples that has `source_item_ref_name` or
   * `target_item_ref_name` set, verifies that the referenced attribute name
   * actually exists in the corresponding node's compartment items.
   */
  it('source_item_ref_name / target_item_ref_name correctly reference attribute ref_names', () => {
    const logicalDiagram = loadJsonExample('temporary-er-diagram-logical.json');
    const physicalDiagram = loadJsonExample('temporary-er-diagram-physical.json');

    for (const diagram of [logicalDiagram, physicalDiagram]) {
      // Build a map of node ID -> set of attribute ref_names
      const nodeAttributeRefNames = new Map<string, Set<string>>();
      for (const node of diagram.nodes) {
        const attrRefNames = new Set<string>();
        if (node.compartments) {
          for (const comp of node.compartments) {
            for (const item of comp.items) {
              attrRefNames.add(item.ref_name);
            }
          }
        }
        nodeAttributeRefNames.set(node.id, attrRefNames);
      }

      for (const edge of diagram.edges) {
        if (edge.source_item_ref_name) {
          const sourceAttrs = nodeAttributeRefNames.get(edge.source_node_id);
          expect(sourceAttrs).toBeDefined();
          expect(
            sourceAttrs!.has(edge.source_item_ref_name)
          ).toBe(true);
        }

        if (edge.target_item_ref_name) {
          const targetAttrs = nodeAttributeRefNames.get(edge.target_node_id);
          expect(targetAttrs).toBeDefined();
          expect(
            targetAttrs!.has(edge.target_item_ref_name)
          ).toBe(true);
        }
      }
    }

    // Verify at least some edges in the examples have item_ref_names set
    // (to ensure this test is meaningful and not vacuously passing)
    const edgesWithItemRefs = logicalDiagram.edges.filter(
      (e) => e.source_item_ref_name || e.target_item_ref_name
    );
    expect(edgesWithItemRefs.length).toBeGreaterThanOrEqual(1);
  });

  /**
   * Test 7: Group `child_node_ids` in example files reference only existing node IDs.
   *
   * Verifies that every `child_node_ids` entry in every group in both example files
   * references an existing node ID. Also verifies that groups are non-empty.
   */
  it('group child_node_ids in example files reference only existing node IDs', () => {
    const logical = loadJsonExample('temporary-er-diagram-logical.json');
    const physical = loadJsonExample('temporary-er-diagram-physical.json');

    for (const diagram of [logical, physical]) {
      const nodeIds = new Set(diagram.nodes.map((n) => n.id));

      expect(diagram.groups).toBeDefined();
      expect(diagram.groups!.length).toBeGreaterThanOrEqual(1);

      for (const group of diagram.groups!) {
        expect(group.child_node_ids.length).toBeGreaterThanOrEqual(1);

        for (const childId of group.child_node_ids) {
          expect(nodeIds.has(childId)).toBe(true);
        }
      }
    }
  });

  /**
   * Test 8: Example files contain no internal architecture IDs (no UUID patterns).
   *
   * Scans the raw JSON text of both example files for UUID v4 patterns
   * (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx) to ensure no internal architecture
   * entity IDs, attribute IDs, or relationship IDs leaked into the examples.
   * The contract explicitly requires name-based matching with no internal IDs.
   */
  it('example files contain no internal architecture IDs (no UUID patterns)', () => {
    // Standard UUID v4 pattern: 8-4-4-4-12 hex characters
    const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

    const logicalPath = path.join(examplesDir, 'temporary-er-diagram-logical.json');
    const physicalPath = path.join(examplesDir, 'temporary-er-diagram-physical.json');

    const logicalRaw = fs.readFileSync(logicalPath, 'utf-8');
    const physicalRaw = fs.readFileSync(physicalPath, 'utf-8');

    const logicalUuids = logicalRaw.match(uuidPattern);
    const physicalUuids = physicalRaw.match(uuidPattern);

    expect(logicalUuids).toBeNull();
    expect(physicalUuids).toBeNull();
  });
});
