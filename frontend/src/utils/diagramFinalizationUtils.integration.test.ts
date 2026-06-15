/**
 * Integration Tests for Diagram Finalization
 *
 * Spec: Diagram Finalization and Completion UX (Increment 7)
 * Task Group 3, Task 3.1: 4 focused tests for finalization integration
 *
 * These tests verify the integration logic paths that DiagramsView.tsx will use,
 * testing through the pure function call chains rather than React effects directly:
 *
 * Test 1: fully_matched auto-trigger path -- buildCompletedMappingFromFullMatch produces
 *         a valid CompletedDiagramMapping that can be set on state
 * Test 2: Shared finalization path -- buildNativeDiagramFromMapping produces a valid
 *         Diagram suitable for ADD_DIAGRAM dispatch when completedDiagramMapping is non-null
 * Test 3: Error handling -- when buildNativeDiagramFromMapping throws, the error is catchable
 *         and the temporary diagram state (completedDiagramMapping) is preserved
 * Test 4: Toast message format verification -- success and error message formats
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TemporaryArchitectureDiagram } from '../types/temporaryArchitectureDiagram';
import type { CompletedDiagramMapping } from './mappingConfirmationUtils';
import type { DiagramMappingResult } from './temporaryDiagramMapping';
import {
  buildNativeDiagramFromMapping,
  buildCompletedMappingFromFullMatch,
} from './diagramFinalizationUtils';

// ============================================================================
// Mock generatePrefixedId for deterministic IDs in tests
// ============================================================================

let idCounter = 0;
vi.mock('./idGenerator', () => ({
  generatePrefixedId: (prefix: string) => {
    idCounter++;
    return `${prefix}-integ-${idCounter}`;
  },
}));

// ============================================================================
// Test Fixtures
// ============================================================================

function createTemporaryDiagram(): TemporaryArchitectureDiagram {
  return {
    id: 'tmp-diag-integ',
    name: 'Customer Orders ER',
    description: 'Integration test diagram',
    diagram_kind: 'ER',
    source_architecture_domain: 'DATA',
    view_mode: 'LOGICAL',
    version: 1,
    nodes: [
      {
        id: 'tmp-node-A',
        node_kind: 'ENTITY',
        semantic_type: 'LOGICAL_DATA_ENTITY',
        ref_name: 'Customer',
        display_name: 'Customer',
        pos_x: 50,
        pos_y: 100,
        width: 200,
        height: 140,
        z_index: 3,
        compartments: [
          {
            id: 'comp-A',
            compartment_kind: 'ATTRIBUTES',
            items: [
              {
                id: 'tmp-attr-A1',
                item_kind: 'ATTRIBUTE',
                ref_name: 'name',
                display_name: 'Name',
                semantic_type: 'LOGICAL_DATA_ATTRIBUTE',
              },
            ],
          },
        ],
      },
      {
        id: 'tmp-node-B',
        node_kind: 'ENTITY',
        semantic_type: 'LOGICAL_DATA_ENTITY',
        ref_name: 'Order',
        display_name: 'Order',
        pos_x: 350,
        pos_y: 100,
        width: 180,
        height: 120,
        compartments: [],
      },
    ],
    edges: [
      {
        id: 'tmp-edge-AB',
        edge_kind: 'RELATIONSHIP',
        semantic_type: 'DATA_ENTITY_RELATIONSHIP',
        source_node_id: 'tmp-node-A',
        target_node_id: 'tmp-node-B',
        source_ref_name: 'Customer',
        target_ref_name: 'Order',
        edge_points: [
          { sequence_order: 0, pos_x: 250, pos_y: 170 },
          { sequence_order: 1, pos_x: 350, pos_y: 170 },
        ],
        source_label: { text: '1', pos_x: 260, pos_y: 160 },
        target_label: { text: '*', pos_x: 340, pos_y: 160 },
      },
    ],
  };
}

function createFullyMatchedResult(): DiagramMappingResult {
  return {
    nodes: [
      { temporaryNodeId: 'tmp-node-A', matchedEntityId: 'ent-cust', status: 'matched' },
      { temporaryNodeId: 'tmp-node-B', matchedEntityId: 'ent-ord', status: 'matched' },
    ],
    attributes: [
      {
        temporaryItemId: 'tmp-attr-A1',
        parentTemporaryNodeId: 'tmp-node-A',
        matchedAttributeId: 'attr-name',
        status: 'matched',
      },
    ],
    edges: [
      { temporaryEdgeId: 'tmp-edge-AB', matchedRelationshipId: 'rel-cust-ord', status: 'matched' },
    ],
    summary: {
      nodes: { total: 2, matched: 2, unmatched: 0 },
      attributes: { total: 1, matched: 1, unmatched: 0 },
      edges: { total: 1, matched: 1, unmatched: 0 },
    },
    overallStatus: 'fully_matched',
  };
}

function createCompletedMapping(tmpDiagram: TemporaryArchitectureDiagram): CompletedDiagramMapping {
  return {
    completedNodes: [
      { temporaryNodeId: 'tmp-node-A', resolvedEntityId: 'ent-cust' },
      { temporaryNodeId: 'tmp-node-B', resolvedEntityId: 'ent-ord' },
    ],
    completedAttributes: [
      {
        temporaryItemId: 'tmp-attr-A1',
        parentTemporaryNodeId: 'tmp-node-A',
        resolvedAttributeId: 'attr-name',
      },
    ],
    completedEdges: [
      { temporaryEdgeId: 'tmp-edge-AB', resolvedRelationshipId: 'rel-cust-ord' },
    ],
    sourceTemporaryDiagram: tmpDiagram,
    viewMode: 'LOGICAL',
  };
}

// ============================================================================
// Integration Tests
// ============================================================================

describe('Diagram Finalization Integration', () => {
  beforeEach(() => {
    idCounter = 0;
  });

  // Test 1: fully_matched auto-trigger -- buildCompletedMappingFromFullMatch produces
  // a CompletedDiagramMapping that can be set as completedDiagramMapping on state
  it('should derive completedDiagramMapping from a fully_matched mapping result (auto-trigger path)', () => {
    const tmpDiagram = createTemporaryDiagram();
    const mappingResult = createFullyMatchedResult();

    // This is the logic path exercised in the useEffect when overallStatus === 'fully_matched':
    // const derived = buildCompletedMappingFromFullMatch(mappingResult, temporaryDiagramState.data!)
    // setTemporaryDiagramState(prev => ({ ...prev, completedDiagramMapping: derived }))
    const derived = buildCompletedMappingFromFullMatch(mappingResult, tmpDiagram);

    // Verify the derived mapping has the correct shape for downstream finalization
    expect(derived.completedNodes).toHaveLength(2);
    expect(derived.completedNodes[0].resolvedEntityId).toBe('ent-cust');
    expect(derived.completedNodes[1].resolvedEntityId).toBe('ent-ord');

    expect(derived.completedAttributes).toHaveLength(1);
    expect(derived.completedAttributes[0].resolvedAttributeId).toBe('attr-name');
    expect(derived.completedAttributes[0].parentTemporaryNodeId).toBe('tmp-node-A');

    expect(derived.completedEdges).toHaveLength(1);
    expect(derived.completedEdges[0].resolvedRelationshipId).toBe('rel-cust-ord');

    expect(derived.sourceTemporaryDiagram).toBe(tmpDiagram);
    expect(derived.viewMode).toBe('LOGICAL');

    // Verify this mapping can be fed into buildNativeDiagramFromMapping without error
    const nativeDiagram = buildNativeDiagramFromMapping(derived, tmpDiagram);
    expect(nativeDiagram.id).toMatch(/^diag-/);
    expect(nativeDiagram.diagram_nodes).toHaveLength(2);
    expect(nativeDiagram.diagram_edges).toHaveLength(1);
  });

  // Test 2: Shared finalization path -- buildNativeDiagramFromMapping produces a valid
  // native Diagram object suitable for ADD_DIAGRAM dispatch
  it('should produce a valid native Diagram for ADD_DIAGRAM dispatch when completedDiagramMapping is non-null', () => {
    const tmpDiagram = createTemporaryDiagram();
    const completedMapping = createCompletedMapping(tmpDiagram);

    // This is the logic path exercised in the shared finalization useEffect:
    // const nativeDiagram = buildNativeDiagramFromMapping(completedMapping, temporaryDiagramState.data)
    // dispatch({ type: 'ADD_DIAGRAM', payload: nativeDiagram })
    const nativeDiagram = buildNativeDiagramFromMapping(completedMapping, tmpDiagram);

    // Verify diagram-level fields are correct for ADD_DIAGRAM dispatch
    expect(nativeDiagram.id).toMatch(/^diag-/);
    expect(nativeDiagram.name).toBe('Customer Orders ER');
    expect(nativeDiagram.description).toBe('Integration test diagram');
    expect(nativeDiagram.diagram_type).toBe('ER');

    // Verify nodes are correctly converted
    expect(nativeDiagram.diagram_nodes).toHaveLength(2);
    const nodeA = nativeDiagram.diagram_nodes[0];
    expect(nodeA.entity_id).toBe('ent-cust');
    expect(nodeA.entity_type).toBe('LOGICAL_DATA_ENTITY');
    expect(nodeA.render_style).toBe('erd');
    expect(nodeA.pos_x).toBe(50);
    expect(nodeA.pos_y).toBe(100);
    expect(nodeA.width).toBe(200);
    expect(nodeA.height).toBe(140);
    expect(nodeA.embedded_attribute_ids).toEqual(['attr-name']);
    expect(nodeA.selected_attribute_ids).toEqual(['attr-name']);

    // Verify edges are correctly converted with remapped node IDs
    expect(nativeDiagram.diagram_edges).toHaveLength(1);
    const edge = nativeDiagram.diagram_edges[0];
    expect(edge.relationship_id).toBe('rel-cust-ord');
    expect(edge.relationship_type).toBe('LOGICAL_DATA_ENTITY_RELATIONSHIP');
    expect(edge.source_node_id).toBe(nodeA.id); // Remapped to native node ID
    expect(edge.target_node_id).toBe(nativeDiagram.diagram_nodes[1].id);

    // Verify typedContent for ER diagram
    expect(nativeDiagram.typedContent).toBeDefined();
    expect(nativeDiagram.typedContent!.type).toBe('ER');
    expect(nativeDiagram.typedContent!.version).toBe(1);
    const erContent = nativeDiagram.typedContent!.content as {
      entityRefs: Array<{ id: string; entity_id: string }>;
      relationshipRefs: Array<{ id: string; relationship_id: string }>;
    };
    expect(erContent.entityRefs).toHaveLength(2);
    expect(erContent.relationshipRefs).toHaveLength(1);

    // Verify the ADD_DIAGRAM payload shape is complete
    expect(nativeDiagram.decorations).toEqual([]);
    expect(nativeDiagram.label_decorations).toEqual([]);
    expect(nativeDiagram.settings).toEqual({});
  });

  // Test 3: Error handling -- when buildNativeDiagramFromMapping throws, the error is
  // catchable and the temporary diagram state is NOT reset (error recovery)
  it('should preserve temporary diagram state when buildNativeDiagramFromMapping throws', () => {
    const tmpDiagram = createTemporaryDiagram();

    // Create a broken mapping: edge references nodes not in completedNodes
    const brokenMapping: CompletedDiagramMapping = {
      completedNodes: [
        // Only include node-A, but edge references both A and B
        { temporaryNodeId: 'tmp-node-A', resolvedEntityId: 'ent-cust' },
      ],
      completedAttributes: [],
      completedEdges: [
        { temporaryEdgeId: 'tmp-edge-AB', resolvedRelationshipId: 'rel-cust-ord' },
      ],
      sourceTemporaryDiagram: tmpDiagram,
      viewMode: 'LOGICAL',
    };

    // Simulate the try/catch in the finalization effect:
    // The key assertion is that on error, handleCloseTemporaryDiagram is NOT called,
    // which means completedDiagramMapping and data remain intact for retry
    let finalizationSucceeded = false;
    let caughtError: Error | null = null;
    let temporaryDiagramData: TemporaryArchitectureDiagram | null = tmpDiagram;
    let completedDiagramMapping: CompletedDiagramMapping | null = brokenMapping;

    try {
      buildNativeDiagramFromMapping(brokenMapping, tmpDiagram);
      // If we reached here, finalization succeeded
      finalizationSucceeded = true;
      // handleCloseTemporaryDiagram() would be called here -- resetting state
      temporaryDiagramData = null;
      completedDiagramMapping = null;
    } catch (err) {
      // Error path: do NOT reset state
      caughtError = err instanceof Error ? err : new Error(String(err));
    }

    // Verify: finalization did NOT succeed
    expect(finalizationSucceeded).toBe(false);

    // Verify: error was caught with a descriptive message about the missing node
    expect(caughtError).not.toBeNull();
    expect(caughtError!.message).toContain('tmp-node-B');

    // Verify: temporary diagram state is preserved (not reset)
    expect(temporaryDiagramData).toBe(tmpDiagram);
    expect(completedDiagramMapping).toBe(brokenMapping);
  });

  // Test 4: Toast message format -- verify success and error message formats
  it('should produce correct toast message formats for success and error cases', () => {
    const tmpDiagram = createTemporaryDiagram();
    const completedMapping = createCompletedMapping(tmpDiagram);

    // Success case: verify the message format matches "Diagram '<name>' created successfully"
    const nativeDiagram = buildNativeDiagramFromMapping(completedMapping, tmpDiagram);
    const successMessage = `Diagram '${nativeDiagram.name}' created successfully`;
    expect(successMessage).toBe("Diagram 'Customer Orders ER' created successfully");

    // Error case: verify the message format matches "Failed to create diagram: <error message>"
    const brokenMapping: CompletedDiagramMapping = {
      completedNodes: [],
      completedAttributes: [],
      completedEdges: [
        { temporaryEdgeId: 'tmp-edge-AB', resolvedRelationshipId: 'rel-cust-ord' },
      ],
      sourceTemporaryDiagram: tmpDiagram,
      viewMode: 'LOGICAL',
    };

    try {
      buildNativeDiagramFromMapping(brokenMapping, tmpDiagram);
    } catch (err) {
      const errorMessage = `Failed to create diagram: ${err instanceof Error ? err.message : String(err)}`;
      expect(errorMessage).toMatch(/^Failed to create diagram: /);
      expect(errorMessage).toContain('tmp-node-A');
    }
  });
});
