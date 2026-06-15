/**
 * Tests for Diagram Finalization Utilities
 *
 * Spec: Diagram Finalization and Completion UX (Increment 7)
 *
 * Task Group 1: Core Conversion Functions
 * 6 focused tests covering:
 * - buildNativeDiagramFromMapping happy path (multiple nodes, edges, attributes)
 * - Node conversion with viewMode === 'LOGICAL'
 * - Node conversion with viewMode === 'PHYSICAL'
 * - Edge conversion (relationship_id, node ID remapping, edge points)
 * - Edge label flattening (present and absent labels)
 * - Error case: missing temp-to-native node mapping throws
 *
 * Task Group 2: `buildCompletedMappingFromFullMatch` Function
 * 2 focused tests covering:
 * - Full derivation of CompletedDiagramMapping from a fully_matched DiagramMappingResult
 *   with correct field mapping for nodes, attributes, and edges
 * - Array length preservation (input count === output count)
 *
 * Task Group 4: Gap-filling tests
 * 5 strategic tests covering edge cases identified during test review:
 * - Zero edges (nodes-only diagram) produces valid Diagram with empty edges/relationshipRefs
 * - Zero attributes produces nodes with empty embedded/selected attribute ID arrays
 * - Missing temporary node for a CompletedNodeMapping uses default position/dimensions
 * - Multiple edge points all get unique IDs with correct field copies
 * - description defaults to '' when temporaryDiagram.description is undefined
 */

import { describe, it, expect, vi } from 'vitest';
import {
  TemporaryArchitectureDiagram,
} from '../types/temporaryArchitectureDiagram';
import {
  CompletedDiagramMapping,
} from './mappingConfirmationUtils';
import {
  DiagramMappingResult,
} from './temporaryDiagramMapping';
import { buildNativeDiagramFromMapping, buildCompletedMappingFromFullMatch } from './diagramFinalizationUtils';

// ============================================================================
// Mock generatePrefixedId for deterministic IDs in tests
// ============================================================================

let idCounter = 0;
vi.mock('./idGenerator', () => ({
  generatePrefixedId: (prefix: string) => {
    idCounter++;
    return `${prefix}-test-${idCounter}`;
  },
}));

// ============================================================================
// Test Fixtures
// ============================================================================

function createTestTemporaryDiagram(
  overrides?: Partial<TemporaryArchitectureDiagram>
): TemporaryArchitectureDiagram {
  return {
    id: 'tmp-diag-1',
    name: 'Test ER Diagram',
    description: 'A test diagram for finalization',
    diagram_kind: 'ER',
    source_architecture_domain: 'DATA',
    view_mode: 'LOGICAL',
    version: 1,
    nodes: [
      {
        id: 'tmp-node-1',
        node_kind: 'ENTITY',
        semantic_type: 'LOGICAL_DATA_ENTITY',
        ref_name: 'Customer',
        display_name: 'Customer',
        pos_x: 100,
        pos_y: 200,
        width: 180,
        height: 120,
        z_index: 5,
        compartments: [
          {
            id: 'comp-1',
            compartment_kind: 'ATTRIBUTES',
            items: [
              {
                id: 'tmp-attr-1',
                item_kind: 'ATTRIBUTE',
                ref_name: 'customer_name',
                display_name: 'Customer Name',
                semantic_type: 'LOGICAL_DATA_ATTRIBUTE',
              },
              {
                id: 'tmp-attr-2',
                item_kind: 'ATTRIBUTE',
                ref_name: 'customer_email',
                display_name: 'Customer Email',
                semantic_type: 'LOGICAL_DATA_ATTRIBUTE',
              },
            ],
          },
        ],
      },
      {
        id: 'tmp-node-2',
        node_kind: 'ENTITY',
        semantic_type: 'LOGICAL_DATA_ENTITY',
        ref_name: 'Order',
        display_name: 'Order',
        pos_x: 400,
        pos_y: 200,
        width: 160,
        height: 100,
        compartments: [
          {
            id: 'comp-2',
            compartment_kind: 'ATTRIBUTES',
            items: [
              {
                id: 'tmp-attr-3',
                item_kind: 'ATTRIBUTE',
                ref_name: 'order_date',
                display_name: 'Order Date',
                semantic_type: 'LOGICAL_DATA_ATTRIBUTE',
              },
            ],
          },
        ],
      },
    ],
    edges: [
      {
        id: 'tmp-edge-1',
        edge_kind: 'RELATIONSHIP',
        semantic_type: 'DATA_ENTITY_RELATIONSHIP',
        source_node_id: 'tmp-node-1',
        target_node_id: 'tmp-node-2',
        source_ref_name: 'Customer',
        target_ref_name: 'Order',
        edge_points: [
          { sequence_order: 0, pos_x: 280, pos_y: 260 },
          { sequence_order: 1, pos_x: 400, pos_y: 260 },
        ],
        source_label: {
          text: '1',
          pos_x: 290,
          pos_y: 250,
        },
        target_label: {
          text: '*',
          pos_x: 390,
          pos_y: 250,
        },
      },
    ],
    ...overrides,
  };
}

function createTestCompletedMapping(
  overrides?: Partial<CompletedDiagramMapping>
): CompletedDiagramMapping {
  const tmpDiagram = createTestTemporaryDiagram();
  return {
    completedNodes: [
      { temporaryNodeId: 'tmp-node-1', resolvedEntityId: 'entity-1' },
      { temporaryNodeId: 'tmp-node-2', resolvedEntityId: 'entity-2' },
    ],
    completedAttributes: [
      {
        temporaryItemId: 'tmp-attr-1',
        parentTemporaryNodeId: 'tmp-node-1',
        resolvedAttributeId: 'attr-resolved-1',
      },
      {
        temporaryItemId: 'tmp-attr-2',
        parentTemporaryNodeId: 'tmp-node-1',
        resolvedAttributeId: 'attr-resolved-2',
      },
      {
        temporaryItemId: 'tmp-attr-3',
        parentTemporaryNodeId: 'tmp-node-2',
        resolvedAttributeId: 'attr-resolved-3',
      },
    ],
    completedEdges: [
      { temporaryEdgeId: 'tmp-edge-1', resolvedRelationshipId: 'rel-1' },
    ],
    sourceTemporaryDiagram: tmpDiagram,
    viewMode: 'LOGICAL',
    ...overrides,
  };
}

// ============================================================================
// Task Group 2: Test Fixtures for buildCompletedMappingFromFullMatch
// ============================================================================

function createFullyMatchedMappingResult(): DiagramMappingResult {
  return {
    nodes: [
      { temporaryNodeId: 'tmp-node-1', matchedEntityId: 'entity-1', status: 'matched' },
      { temporaryNodeId: 'tmp-node-2', matchedEntityId: 'entity-2', status: 'matched' },
      { temporaryNodeId: 'tmp-node-3', matchedEntityId: 'entity-3', status: 'matched' },
    ],
    attributes: [
      { temporaryItemId: 'tmp-attr-1', parentTemporaryNodeId: 'tmp-node-1', matchedAttributeId: 'attr-1', status: 'matched' },
      { temporaryItemId: 'tmp-attr-2', parentTemporaryNodeId: 'tmp-node-1', matchedAttributeId: 'attr-2', status: 'matched' },
      { temporaryItemId: 'tmp-attr-3', parentTemporaryNodeId: 'tmp-node-2', matchedAttributeId: 'attr-3', status: 'matched' },
      { temporaryItemId: 'tmp-attr-4', parentTemporaryNodeId: 'tmp-node-2', matchedAttributeId: 'attr-4', status: 'matched' },
      { temporaryItemId: 'tmp-attr-5', parentTemporaryNodeId: 'tmp-node-3', matchedAttributeId: 'attr-5', status: 'matched' },
    ],
    edges: [
      { temporaryEdgeId: 'tmp-edge-1', matchedRelationshipId: 'rel-1', status: 'matched' },
      { temporaryEdgeId: 'tmp-edge-2', matchedRelationshipId: 'rel-2', status: 'matched' },
    ],
    summary: {
      nodes: { total: 3, matched: 3, unmatched: 0 },
      attributes: { total: 5, matched: 5, unmatched: 0 },
      edges: { total: 2, matched: 2, unmatched: 0 },
    },
    overallStatus: 'fully_matched',
  };
}

function createFullMatchTemporaryDiagram(): TemporaryArchitectureDiagram {
  return {
    id: 'tmp-diagram-fm',
    name: 'Full Match ER Diagram',
    diagram_kind: 'ER',
    source_architecture_domain: 'DATA',
    view_mode: 'LOGICAL',
    version: 1,
    description: 'A test diagram for auto-finalization',
    nodes: [
      {
        id: 'tmp-node-1',
        node_kind: 'ENTITY',
        semantic_type: 'LOGICAL_DATA_ENTITY',
        ref_name: 'Customer',
        display_name: 'Customer',
        pos_x: 100, pos_y: 100, width: 200, height: 150,
        compartments: [{
          id: 'comp-1', compartment_kind: 'ATTRIBUTES',
          items: [
            { id: 'tmp-attr-1', item_kind: 'ATTRIBUTE', ref_name: 'customer_name', display_name: 'Customer Name', semantic_type: 'LOGICAL_DATA_ATTRIBUTE' },
            { id: 'tmp-attr-2', item_kind: 'ATTRIBUTE', ref_name: 'customer_email', display_name: 'Customer Email', semantic_type: 'LOGICAL_DATA_ATTRIBUTE' },
          ],
        }],
      },
      {
        id: 'tmp-node-2',
        node_kind: 'ENTITY',
        semantic_type: 'LOGICAL_DATA_ENTITY',
        ref_name: 'Order',
        display_name: 'Order',
        pos_x: 400, pos_y: 100, width: 200, height: 150,
        compartments: [{
          id: 'comp-2', compartment_kind: 'ATTRIBUTES',
          items: [
            { id: 'tmp-attr-3', item_kind: 'ATTRIBUTE', ref_name: 'order_date', display_name: 'Order Date', semantic_type: 'LOGICAL_DATA_ATTRIBUTE' },
            { id: 'tmp-attr-4', item_kind: 'ATTRIBUTE', ref_name: 'order_total', display_name: 'Order Total', semantic_type: 'LOGICAL_DATA_ATTRIBUTE' },
          ],
        }],
      },
      {
        id: 'tmp-node-3',
        node_kind: 'ENTITY',
        semantic_type: 'LOGICAL_DATA_ENTITY',
        ref_name: 'Product',
        display_name: 'Product',
        pos_x: 700, pos_y: 100, width: 200, height: 150,
        compartments: [{
          id: 'comp-3', compartment_kind: 'ATTRIBUTES',
          items: [
            { id: 'tmp-attr-5', item_kind: 'ATTRIBUTE', ref_name: 'product_name', display_name: 'Product Name', semantic_type: 'LOGICAL_DATA_ATTRIBUTE' },
          ],
        }],
      },
    ],
    edges: [
      {
        id: 'tmp-edge-1', edge_kind: 'RELATIONSHIP', semantic_type: 'DATA_ENTITY_RELATIONSHIP',
        source_node_id: 'tmp-node-1', target_node_id: 'tmp-node-2',
        source_ref_name: 'Customer', target_ref_name: 'Order',
        edge_points: [{ sequence_order: 0, pos_x: 300, pos_y: 175 }, { sequence_order: 1, pos_x: 400, pos_y: 175 }],
      },
      {
        id: 'tmp-edge-2', edge_kind: 'RELATIONSHIP', semantic_type: 'DATA_ENTITY_RELATIONSHIP',
        source_node_id: 'tmp-node-2', target_node_id: 'tmp-node-3',
        source_ref_name: 'Order', target_ref_name: 'Product',
        edge_points: [{ sequence_order: 0, pos_x: 600, pos_y: 175 }, { sequence_order: 1, pos_x: 700, pos_y: 175 }],
      },
    ],
  };
}

// ============================================================================
// Task Group 1: Core Conversion Function Tests
// ============================================================================

describe('diagramFinalizationUtils', () => {
  beforeEach(() => {
    idCounter = 0;
  });

  describe('buildNativeDiagramFromMapping', () => {
    // Test 1: Happy path -- multiple nodes, edges, and attributes
    it('should produce a valid native Diagram with correct structure and counts', () => {
      const tmpDiagram = createTestTemporaryDiagram();
      const completedMapping = createTestCompletedMapping();

      const result = buildNativeDiagramFromMapping(completedMapping, tmpDiagram);

      // Diagram-level fields
      expect(result.id).toMatch(/^diag-/);
      expect(result.diagram_type).toBe('ER');
      expect(result.name).toBe('Test ER Diagram');
      expect(result.description).toBe('A test diagram for finalization');

      // TypedContent envelope
      expect(result.typedContent).toBeDefined();
      expect(result.typedContent!.type).toBe('ER');
      expect(result.typedContent!.version).toBe(1);
      const erContent = result.typedContent!.content as { entityRefs: unknown[]; relationshipRefs: unknown[] };
      expect(erContent.entityRefs).toHaveLength(2); // 2 nodes
      expect(erContent.relationshipRefs).toHaveLength(1); // 1 edge

      // Nodes and edges counts
      expect(result.diagram_nodes).toHaveLength(2);
      expect(result.diagram_edges).toHaveLength(1);

      // Default empty arrays
      expect(result.decorations).toEqual([]);
      expect(result.label_decorations).toEqual([]);
      expect(result.settings).toEqual({});
    });

    // Test 2: Node conversion with viewMode === 'LOGICAL'
    it('should convert nodes correctly with LOGICAL viewMode', () => {
      const tmpDiagram = createTestTemporaryDiagram();
      const completedMapping = createTestCompletedMapping();

      const result = buildNativeDiagramFromMapping(completedMapping, tmpDiagram);

      const node1 = result.diagram_nodes[0];
      expect(node1.entity_type).toBe('LOGICAL_DATA_ENTITY');
      expect(node1.entity_id).toBe('entity-1');
      expect(node1.render_style).toBe('erd');
      expect(node1.parent_node_id).toBeNull();

      // Position/dimension fields copied from temporary node
      expect(node1.pos_x).toBe(100);
      expect(node1.pos_y).toBe(200);
      expect(node1.width).toBe(180);
      expect(node1.height).toBe(120);

      // z_index copied when present
      expect(node1.z_index).toBe(5);

      // Second node has no z_index on temp node
      const node2 = result.diagram_nodes[1];
      expect(node2.z_index).toBeUndefined();
    });

    // Test 3: Node conversion with viewMode === 'PHYSICAL'
    it('should convert nodes correctly with PHYSICAL viewMode and populate attribute IDs', () => {
      const tmpDiagram = createTestTemporaryDiagram({ view_mode: 'PHYSICAL' });
      const completedMapping = createTestCompletedMapping({ viewMode: 'PHYSICAL' });

      const result = buildNativeDiagramFromMapping(completedMapping, tmpDiagram);

      const node1 = result.diagram_nodes[0];
      expect(node1.entity_type).toBe('PHYSICAL_DATA_ENTITY');

      // embedded_attribute_ids and selected_attribute_ids populated from attributes
      // Node 1 has 2 attributes: attr-resolved-1, attr-resolved-2
      expect(node1.embedded_attribute_ids).toEqual(['attr-resolved-1', 'attr-resolved-2']);
      expect(node1.selected_attribute_ids).toEqual(['attr-resolved-1', 'attr-resolved-2']);

      // Node 2 has 1 attribute: attr-resolved-3
      const node2 = result.diagram_nodes[1];
      expect(node2.embedded_attribute_ids).toEqual(['attr-resolved-3']);
      expect(node2.selected_attribute_ids).toEqual(['attr-resolved-3']);
    });

    // Test 4: Edge conversion
    it('should convert edges with correct relationship mapping and edge points', () => {
      const tmpDiagram = createTestTemporaryDiagram();
      const completedMapping = createTestCompletedMapping();

      const result = buildNativeDiagramFromMapping(completedMapping, tmpDiagram);

      const edge = result.diagram_edges[0];
      expect(edge.id).toMatch(/^edge-/);
      expect(edge.relationship_id).toBe('rel-1');
      expect(edge.relationship_type).toBe('LOGICAL_DATA_ENTITY_RELATIONSHIP');

      // source_node_id and target_node_id should be remapped to native IDs
      // The native IDs are generated with 'node' prefix
      expect(edge.source_node_id).toMatch(/^node-/);
      expect(edge.target_node_id).toMatch(/^node-/);

      // source and target should be the native IDs of the first and second nodes respectively
      const nativeNodeIds = result.diagram_nodes.map((n) => n.id);
      expect(nativeNodeIds).toContain(edge.source_node_id);
      expect(nativeNodeIds).toContain(edge.target_node_id);
      expect(edge.source_node_id).toBe(result.diagram_nodes[0].id);
      expect(edge.target_node_id).toBe(result.diagram_nodes[1].id);

      // Edge points generated with 'edgept' prefix, preserving sequence_order/pos_x/pos_y
      expect(edge.edge_points).toHaveLength(2);
      expect(edge.edge_points[0].id).toMatch(/^edgept-/);
      expect(edge.edge_points[0].sequence_order).toBe(0);
      expect(edge.edge_points[0].pos_x).toBe(280);
      expect(edge.edge_points[0].pos_y).toBe(260);
      expect(edge.edge_points[1].id).toMatch(/^edgept-/);
      expect(edge.edge_points[1].sequence_order).toBe(1);
      expect(edge.edge_points[1].pos_x).toBe(400);
      expect(edge.edge_points[1].pos_y).toBe(260);
    });

    // Test 5: Edge label flattening
    it('should flatten edge labels correctly and handle absent labels', () => {
      const tmpDiagram = createTestTemporaryDiagram();
      const completedMapping = createTestCompletedMapping();

      const result = buildNativeDiagramFromMapping(completedMapping, tmpDiagram);

      // Edge with both source_label and target_label present
      const edge = result.diagram_edges[0];
      expect(edge.source_label_text).toBe('1');
      expect(edge.source_label_pos_x).toBe(290);
      expect(edge.source_label_pos_y).toBe(250);
      expect(edge.target_label_text).toBe('*');
      expect(edge.target_label_pos_x).toBe(390);
      expect(edge.target_label_pos_y).toBe(250);

      // Now test absent labels
      const tmpDiagramNoLabels = createTestTemporaryDiagram({
        edges: [
          {
            id: 'tmp-edge-1',
            edge_kind: 'RELATIONSHIP',
            semantic_type: 'DATA_ENTITY_RELATIONSHIP',
            source_node_id: 'tmp-node-1',
            target_node_id: 'tmp-node-2',
            source_ref_name: 'Customer',
            target_ref_name: 'Order',
            edge_points: [
              { sequence_order: 0, pos_x: 280, pos_y: 260 },
            ],
            // No source_label or target_label
          },
        ],
      });

      idCounter = 0; // Reset for deterministic IDs
      const resultNoLabels = buildNativeDiagramFromMapping(completedMapping, tmpDiagramNoLabels);
      const edgeNoLabels = resultNoLabels.diagram_edges[0];
      expect(edgeNoLabels.source_label_text).toBeUndefined();
      expect(edgeNoLabels.source_label_pos_x).toBeUndefined();
      expect(edgeNoLabels.source_label_pos_y).toBeUndefined();
      expect(edgeNoLabels.target_label_text).toBeUndefined();
      expect(edgeNoLabels.target_label_pos_x).toBeUndefined();
      expect(edgeNoLabels.target_label_pos_y).toBeUndefined();
    });

    // Test 6: Error case -- edge references a temporary node ID not in the map
    it('should throw when edge references a temporary node ID not in the temp-to-native map', () => {
      const tmpDiagram = createTestTemporaryDiagram();
      const completedMapping = createTestCompletedMapping({
        // Only map node-1, leave node-2 unmapped so edge target lookup fails
        completedNodes: [
          { temporaryNodeId: 'tmp-node-1', resolvedEntityId: 'entity-1' },
          // tmp-node-2 is missing
        ],
      });

      expect(() => {
        buildNativeDiagramFromMapping(completedMapping, tmpDiagram);
      }).toThrow(/tmp-node-2/);
    });
  });

  // ============================================================================
  // Task Group 2: buildCompletedMappingFromFullMatch Tests
  // ============================================================================

  describe('buildCompletedMappingFromFullMatch', () => {
    // Test 1: Full derivation of CompletedDiagramMapping from fully_matched DiagramMappingResult
    it('should derive correct CompletedDiagramMapping from a fully_matched DiagramMappingResult', () => {
      const mappingResult = createFullyMatchedMappingResult();
      const temporaryDiagram = createFullMatchTemporaryDiagram();

      const result = buildCompletedMappingFromFullMatch(mappingResult, temporaryDiagram);

      // Verify completedNodes have correct field mapping
      expect(result.completedNodes).toHaveLength(3);
      expect(result.completedNodes[0]).toEqual({
        temporaryNodeId: 'tmp-node-1',
        resolvedEntityId: 'entity-1',
      });
      expect(result.completedNodes[1]).toEqual({
        temporaryNodeId: 'tmp-node-2',
        resolvedEntityId: 'entity-2',
      });
      expect(result.completedNodes[2]).toEqual({
        temporaryNodeId: 'tmp-node-3',
        resolvedEntityId: 'entity-3',
      });

      // Verify completedAttributes have correct field mapping including parentTemporaryNodeId
      expect(result.completedAttributes).toHaveLength(5);
      expect(result.completedAttributes[0]).toEqual({
        temporaryItemId: 'tmp-attr-1',
        parentTemporaryNodeId: 'tmp-node-1',
        resolvedAttributeId: 'attr-1',
      });
      expect(result.completedAttributes[1]).toEqual({
        temporaryItemId: 'tmp-attr-2',
        parentTemporaryNodeId: 'tmp-node-1',
        resolvedAttributeId: 'attr-2',
      });
      expect(result.completedAttributes[2]).toEqual({
        temporaryItemId: 'tmp-attr-3',
        parentTemporaryNodeId: 'tmp-node-2',
        resolvedAttributeId: 'attr-3',
      });
      expect(result.completedAttributes[3]).toEqual({
        temporaryItemId: 'tmp-attr-4',
        parentTemporaryNodeId: 'tmp-node-2',
        resolvedAttributeId: 'attr-4',
      });
      expect(result.completedAttributes[4]).toEqual({
        temporaryItemId: 'tmp-attr-5',
        parentTemporaryNodeId: 'tmp-node-3',
        resolvedAttributeId: 'attr-5',
      });

      // Verify completedEdges have correct field mapping
      expect(result.completedEdges).toHaveLength(2);
      expect(result.completedEdges[0]).toEqual({
        temporaryEdgeId: 'tmp-edge-1',
        resolvedRelationshipId: 'rel-1',
      });
      expect(result.completedEdges[1]).toEqual({
        temporaryEdgeId: 'tmp-edge-2',
        resolvedRelationshipId: 'rel-2',
      });

      // Verify sourceTemporaryDiagram is set to the input diagram
      expect(result.sourceTemporaryDiagram).toBe(temporaryDiagram);

      // Verify viewMode is set from temporaryDiagram.view_mode
      expect(result.viewMode).toBe('LOGICAL');
    });

    // Test 2: Array length preservation
    it('should preserve array lengths from input to output (3 nodes, 5 attributes, 2 edges)', () => {
      const mappingResult = createFullyMatchedMappingResult();
      const temporaryDiagram = createFullMatchTemporaryDiagram();

      // Verify input counts
      expect(mappingResult.nodes).toHaveLength(3);
      expect(mappingResult.attributes).toHaveLength(5);
      expect(mappingResult.edges).toHaveLength(2);

      const result = buildCompletedMappingFromFullMatch(mappingResult, temporaryDiagram);

      // Verify output counts match input counts exactly
      expect(result.completedNodes).toHaveLength(mappingResult.nodes.length);
      expect(result.completedAttributes).toHaveLength(mappingResult.attributes.length);
      expect(result.completedEdges).toHaveLength(mappingResult.edges.length);

      // Also verify with PHYSICAL view mode to ensure viewMode is correctly propagated
      const physicalDiagram: TemporaryArchitectureDiagram = {
        ...temporaryDiagram,
        view_mode: 'PHYSICAL',
      };
      const physicalResult = buildCompletedMappingFromFullMatch(mappingResult, physicalDiagram);
      expect(physicalResult.viewMode).toBe('PHYSICAL');
      expect(physicalResult.completedNodes).toHaveLength(3);
      expect(physicalResult.completedAttributes).toHaveLength(5);
      expect(physicalResult.completedEdges).toHaveLength(2);
    });
  });

  // ============================================================================
  // Task Group 4: Gap-filling tests for edge cases
  // ============================================================================

  describe('Edge case coverage (Task Group 4)', () => {
    // Gap 1: Zero edges (nodes-only diagram) produces valid Diagram
    it('should produce valid Diagram with empty diagram_edges and empty relationshipRefs when there are zero edges', () => {
      const tmpDiagram = createTestTemporaryDiagram({ edges: [] });
      const completedMapping = createTestCompletedMapping({
        completedEdges: [],
      });

      const result = buildNativeDiagramFromMapping(completedMapping, tmpDiagram);

      // Diagram should still be valid
      expect(result.id).toMatch(/^diag-/);
      expect(result.diagram_type).toBe('ER');
      expect(result.name).toBe('Test ER Diagram');

      // Nodes should still be converted
      expect(result.diagram_nodes).toHaveLength(2);
      expect(result.diagram_nodes[0].entity_id).toBe('entity-1');
      expect(result.diagram_nodes[1].entity_id).toBe('entity-2');

      // Edges and relationshipRefs should be empty arrays
      expect(result.diagram_edges).toEqual([]);
      const erContent = result.typedContent!.content as { entityRefs: unknown[]; relationshipRefs: unknown[] };
      expect(erContent.relationshipRefs).toEqual([]);

      // entityRefs should still have entries for the 2 nodes
      expect(erContent.entityRefs).toHaveLength(2);
    });

    // Gap 2: Zero attributes produces nodes with empty attribute ID arrays
    it('should produce nodes with empty embedded_attribute_ids and selected_attribute_ids when there are zero attributes', () => {
      const tmpDiagram = createTestTemporaryDiagram();
      const completedMapping = createTestCompletedMapping({
        completedAttributes: [],
      });

      const result = buildNativeDiagramFromMapping(completedMapping, tmpDiagram);

      // Both nodes should have empty attribute arrays
      expect(result.diagram_nodes[0].embedded_attribute_ids).toEqual([]);
      expect(result.diagram_nodes[0].selected_attribute_ids).toEqual([]);
      expect(result.diagram_nodes[1].embedded_attribute_ids).toEqual([]);
      expect(result.diagram_nodes[1].selected_attribute_ids).toEqual([]);
    });

    // Gap 3: Missing temporary node for a CompletedNodeMapping uses default position/dimensions
    it('should use default position and dimensions when a CompletedNodeMapping references a temporary node ID not in the diagram', () => {
      // Create a diagram with only one node (tmp-node-1),
      // but the completed mapping references both tmp-node-1 and tmp-node-phantom
      const tmpDiagram = createTestTemporaryDiagram({
        nodes: [
          {
            id: 'tmp-node-1',
            node_kind: 'ENTITY',
            semantic_type: 'LOGICAL_DATA_ENTITY',
            ref_name: 'Customer',
            display_name: 'Customer',
            pos_x: 100,
            pos_y: 200,
            width: 180,
            height: 120,
            compartments: [],
          },
        ],
        edges: [],
      });
      const completedMapping: CompletedDiagramMapping = {
        completedNodes: [
          { temporaryNodeId: 'tmp-node-1', resolvedEntityId: 'entity-1' },
          { temporaryNodeId: 'tmp-node-phantom', resolvedEntityId: 'entity-phantom' },
        ],
        completedAttributes: [],
        completedEdges: [],
        sourceTemporaryDiagram: tmpDiagram,
        viewMode: 'LOGICAL',
      };

      const result = buildNativeDiagramFromMapping(completedMapping, tmpDiagram);

      // First node should have position from the temporary diagram
      expect(result.diagram_nodes[0].pos_x).toBe(100);
      expect(result.diagram_nodes[0].pos_y).toBe(200);
      expect(result.diagram_nodes[0].width).toBe(180);
      expect(result.diagram_nodes[0].height).toBe(120);

      // Phantom node should use default position/dimension values (0 for pos, 180/100 for size)
      const phantomNode = result.diagram_nodes[1];
      expect(phantomNode.entity_id).toBe('entity-phantom');
      expect(phantomNode.pos_x).toBe(0);
      expect(phantomNode.pos_y).toBe(0);
      expect(phantomNode.width).toBe(180);
      expect(phantomNode.height).toBe(100);
    });

    // Gap 4: Multiple edge points all get unique IDs with correct field copies
    it('should generate unique IDs for all edge points and preserve sequence_order, pos_x, pos_y', () => {
      const tmpDiagram = createTestTemporaryDiagram({
        edges: [
          {
            id: 'tmp-edge-1',
            edge_kind: 'RELATIONSHIP',
            semantic_type: 'DATA_ENTITY_RELATIONSHIP',
            source_node_id: 'tmp-node-1',
            target_node_id: 'tmp-node-2',
            source_ref_name: 'Customer',
            target_ref_name: 'Order',
            edge_points: [
              { sequence_order: 0, pos_x: 100, pos_y: 200 },
              { sequence_order: 1, pos_x: 200, pos_y: 250 },
              { sequence_order: 2, pos_x: 300, pos_y: 300 },
              { sequence_order: 3, pos_x: 400, pos_y: 200 },
            ],
          },
        ],
      });
      const completedMapping = createTestCompletedMapping();

      const result = buildNativeDiagramFromMapping(completedMapping, tmpDiagram);

      const edgePoints = result.diagram_edges[0].edge_points;
      expect(edgePoints).toHaveLength(4);

      // All points should have edgept prefix IDs
      for (const pt of edgePoints) {
        expect(pt.id).toMatch(/^edgept-/);
      }

      // All edge point IDs should be unique
      const pointIds = edgePoints.map((pt) => pt.id);
      const uniqueIds = new Set(pointIds);
      expect(uniqueIds.size).toBe(4);

      // Each point should preserve its sequence_order, pos_x, and pos_y
      expect(edgePoints[0]).toMatchObject({ sequence_order: 0, pos_x: 100, pos_y: 200 });
      expect(edgePoints[1]).toMatchObject({ sequence_order: 1, pos_x: 200, pos_y: 250 });
      expect(edgePoints[2]).toMatchObject({ sequence_order: 2, pos_x: 300, pos_y: 300 });
      expect(edgePoints[3]).toMatchObject({ sequence_order: 3, pos_x: 400, pos_y: 200 });
    });

    // Gap 5: description defaults to '' when temporaryDiagram.description is undefined
    it('should default description to empty string when temporaryDiagram.description is undefined', () => {
      // Create a temporary diagram with description explicitly undefined
      const tmpDiagram = createTestTemporaryDiagram();
      delete (tmpDiagram as Partial<TemporaryArchitectureDiagram>).description;
      // Ensure description is actually undefined
      expect(tmpDiagram.description).toBeUndefined();

      const completedMapping = createTestCompletedMapping();

      const result = buildNativeDiagramFromMapping(completedMapping, tmpDiagram);

      // The native diagram description should default to empty string, not undefined
      expect(result.description).toBe('');
    });
  });
});
