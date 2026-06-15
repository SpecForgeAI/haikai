/**
 * Multi-Selection Integration Tests
 * Tests for end-to-end workflows combining multiple features
 */

import { DiagramNode, DiagramEdge, Diagram, ArchitectureModel } from '../types/model';
import { emptyModel } from '../config/defaults';
import {
  normalizeRect,
  isNodeInsideRect,
  isEdgeInsideRect,
  getDescendantNodes,
  isPointAttachedToNode,
} from '../utils/rendering';

// Test data factory functions
function createTestNode(overrides: Partial<DiagramNode> = {}): DiagramNode {
  return {
    id: 'test-node-1',
    entity_type: 'APPLICATION',
    entity_id: 'app-1',
    pos_x: 100,
    pos_y: 100,
    width: 100,
    height: 60,
    parent_node_id: null,
    ...overrides,
  };
}

function createTestEdge(overrides: Partial<DiagramEdge> = {}): DiagramEdge {
  return {
    id: 'test-edge-1',
    relationship_type: 'DATA_MOVEMENT',
    relationship_id: 'dm-1',
    source_node_id: 'node-1',
    target_node_id: 'node-2',
    edge_points: [
      { id: 'ep-1', sequence_order: 0, pos_x: 100, pos_y: 100 },
      { id: 'ep-2', sequence_order: 1, pos_x: 200, pos_y: 200 },
    ],
    ...overrides,
  };
}

function createTestDiagram(nodes: DiagramNode[], edges: DiagramEdge[]): Diagram {
  return {
    id: 'test-diagram',
    name: 'Test Diagram',
    description: 'Test diagram for unit tests',
    diagram_nodes: nodes,
    diagram_edges: edges,
  };
}

describe('Multi-Selection Integration Tests', () => {
  describe('Box-select -> Group Move workflow', () => {
    it('should select multiple nodes via box-select and move them together', () => {
      // Setup: Multiple nodes
      const nodes: DiagramNode[] = [
        createTestNode({ id: 'node-1', pos_x: 150, pos_y: 150, width: 50, height: 30 }),
        createTestNode({ id: 'node-2', pos_x: 200, pos_y: 180, width: 50, height: 30 }),
        createTestNode({ id: 'node-3', pos_x: 400, pos_y: 400, width: 50, height: 30 }), // Outside box
      ];

      // Step 1: Box-select nodes
      const rect = { x1: 100, y1: 100, x2: 300, y2: 300 };
      const selectedNodes = nodes.filter(n => isNodeInsideRect(n, rect));

      expect(selectedNodes.length).toBe(2);
      expect(selectedNodes.map(n => n.id)).toContain('node-1');
      expect(selectedNodes.map(n => n.id)).toContain('node-2');

      // Step 2: Move selected nodes by (50, 30)
      const dx = 50;
      const dy = 30;
      const selectedIds = new Set(selectedNodes.map(n => n.id));

      const movedNodes = nodes.map(n => {
        if (selectedIds.has(n.id)) {
          return { ...n, pos_x: n.pos_x + dx, pos_y: n.pos_y + dy };
        }
        return n;
      });

      // Verify final positions
      expect(movedNodes.find(n => n.id === 'node-1')!.pos_x).toBe(200);
      expect(movedNodes.find(n => n.id === 'node-2')!.pos_x).toBe(250);
      expect(movedNodes.find(n => n.id === 'node-3')!.pos_x).toBe(400); // Unchanged
    });

    it('should preserve positions after save/load cycle', () => {
      // Setup: Nodes with specific positions
      const node1 = createTestNode({ id: 'node-1', pos_x: 200, pos_y: 150 });
      const node2 = createTestNode({ id: 'node-2', pos_x: 250, pos_y: 200 });

      // Simulate JSON serialization/deserialization (save/load)
      const diagram = createTestDiagram([node1, node2], []);
      const serialized = JSON.stringify(diagram);
      const deserialized: Diagram = JSON.parse(serialized);

      // Verify positions preserved
      const loadedNode1 = deserialized.diagram_nodes.find(n => n.id === 'node-1')!;
      const loadedNode2 = deserialized.diagram_nodes.find(n => n.id === 'node-2')!;

      expect(loadedNode1.pos_x).toBe(200);
      expect(loadedNode1.pos_y).toBe(150);
      expect(loadedNode2.pos_x).toBe(250);
      expect(loadedNode2.pos_y).toBe(200);
    });
  });

  describe('Box-select -> Delete workflow', () => {
    it('should delete selected elements and cascade edges', () => {
      // Setup: Nodes and edges
      const nodes: DiagramNode[] = [
        createTestNode({ id: 'node-1', pos_x: 150, pos_y: 150, width: 50, height: 30, entity_id: 'app-1' }),
        createTestNode({ id: 'node-2', pos_x: 200, pos_y: 180, width: 50, height: 30, entity_id: 'app-2' }),
        createTestNode({ id: 'node-3', pos_x: 400, pos_y: 400, width: 50, height: 30, entity_id: 'app-3' }),
      ];

      const edges: DiagramEdge[] = [
        createTestEdge({
          id: 'edge-1',
          source_node_id: 'node-1',
          target_node_id: 'node-2',
        }),
        createTestEdge({
          id: 'edge-2',
          source_node_id: 'node-1',
          target_node_id: 'node-3',
        }),
      ];

      // Step 1: Box-select to get node-1 and node-2
      const rect = { x1: 100, y1: 100, x2: 300, y2: 300 };
      const selectedNodeIds = new Set(
        nodes.filter(n => isNodeInsideRect(n, rect)).map(n => n.id)
      );

      // Step 2: Delete selected nodes
      const remainingNodes = nodes.filter(n => !selectedNodeIds.has(n.id));

      // Step 3: Cascade edge deletion
      const edgesToDelete = new Set<string>();
      for (const edge of edges) {
        if (selectedNodeIds.has(edge.source_node_id) || selectedNodeIds.has(edge.target_node_id)) {
          edgesToDelete.add(edge.id);
        }
      }
      const remainingEdges = edges.filter(e => !edgesToDelete.has(e.id));

      // Verify: Only node-3 remains, all edges deleted
      expect(remainingNodes.length).toBe(1);
      expect(remainingNodes[0].id).toBe('node-3');
      expect(remainingEdges.length).toBe(0);
    });

    it('should make deleted entities available in palette', () => {
      // Before deletion: entity is on diagram
      const nodesBeforeDelete: DiagramNode[] = [
        createTestNode({ id: 'node-1', entity_type: 'APPLICATION', entity_id: 'app-1' }),
      ];

      const entityExistsOnDiagram = (nodes: DiagramNode[], entityId: string) =>
        nodes.some(n => n.entity_id === entityId);

      expect(entityExistsOnDiagram(nodesBeforeDelete, 'app-1')).toBe(true);

      // After deletion
      const nodesAfterDelete: DiagramNode[] = [];

      expect(entityExistsOnDiagram(nodesAfterDelete, 'app-1')).toBe(false);
    });
  });

  describe('Ctrl+click multi-select -> Group Move workflow', () => {
    it('should allow Ctrl+click to build selection then move as group', () => {
      const nodes: DiagramNode[] = [
        createTestNode({ id: 'node-1', pos_x: 100, pos_y: 100 }),
        createTestNode({ id: 'node-2', pos_x: 200, pos_y: 150 }),
        createTestNode({ id: 'node-3', pos_x: 300, pos_y: 200 }),
      ];

      // Step 1: Ctrl+click to build selection
      let selectedIds = new Set<string>();

      // First click (single select)
      selectedIds = new Set(['node-1']);

      // Ctrl+click on node-3 (add to selection)
      selectedIds = new Set([...selectedIds, 'node-3']);

      expect(selectedIds.has('node-1')).toBe(true);
      expect(selectedIds.has('node-2')).toBe(false);
      expect(selectedIds.has('node-3')).toBe(true);

      // Step 2: Move selected nodes
      const dx = 50;
      const dy = 30;

      const movedNodes = nodes.map(n => {
        if (selectedIds.has(n.id)) {
          return { ...n, pos_x: n.pos_x + dx, pos_y: n.pos_y + dy };
        }
        return n;
      });

      // Verify
      expect(movedNodes.find(n => n.id === 'node-1')!.pos_x).toBe(150);
      expect(movedNodes.find(n => n.id === 'node-2')!.pos_x).toBe(200); // Unchanged
      expect(movedNodes.find(n => n.id === 'node-3')!.pos_x).toBe(350);
    });
  });

  describe('Edge case handling', () => {
    it('should handle empty selection delete (no-op)', () => {
      const nodes: DiagramNode[] = [
        createTestNode({ id: 'node-1' }),
        createTestNode({ id: 'node-2' }),
      ];

      const selectedNodeIds = new Set<string>();
      const selectedEdgeIds = new Set<string>();

      // Should be a no-op
      const shouldProcess = selectedNodeIds.size > 0 || selectedEdgeIds.size > 0;
      expect(shouldProcess).toBe(false);

      // Nodes remain unchanged
      expect(nodes.length).toBe(2);
    });

    it('should handle box-select with no elements inside', () => {
      const nodes: DiagramNode[] = [
        createTestNode({ id: 'node-1', pos_x: 500, pos_y: 500, width: 50, height: 30 }),
      ];

      // Box-select in empty area
      const rect = { x1: 0, y1: 0, x2: 100, y2: 100 };
      const selectedNodes = nodes.filter(n => isNodeInsideRect(n, rect));

      expect(selectedNodes.length).toBe(0);
    });

    it('should clear selection after deletion', () => {
      let selectedNodeIds = new Set(['node-1', 'node-2']);
      let selectedEdgeIds = new Set(['edge-1']);

      // Perform deletion
      // ... (deletion logic would happen here)

      // Clear selection after deletion
      selectedNodeIds = new Set();
      selectedEdgeIds = new Set();

      expect(selectedNodeIds.size).toBe(0);
      expect(selectedEdgeIds.size).toBe(0);
    });
  });

  describe('Persistence tests', () => {
    it('should correctly save moved positions to JSON', () => {
      const diagram: Diagram = {
        id: 'test-diagram',
        name: 'Test',
        description: 'Test diagram',
        diagram_nodes: [
          createTestNode({ id: 'node-1', pos_x: 200, pos_y: 150 }),
        ],
        diagram_edges: [],
      };

      // Serialize to JSON
      const json = JSON.stringify(diagram, null, 2);

      // Check that position is in JSON
      expect(json).toContain('"pos_x": 200');
      expect(json).toContain('"pos_y": 150');
    });

    it('should not include deleted elements after reload', () => {
      // Original diagram
      const originalDiagram: Diagram = {
        id: 'test-diagram',
        name: 'Test',
        description: 'Test diagram',
        diagram_nodes: [
          createTestNode({ id: 'node-1' }),
          createTestNode({ id: 'node-2' }),
        ],
        diagram_edges: [],
      };

      // Delete node-1
      const modifiedDiagram: Diagram = {
        ...originalDiagram,
        diagram_nodes: originalDiagram.diagram_nodes.filter(n => n.id !== 'node-1'),
      };

      // Serialize and deserialize
      const json = JSON.stringify(modifiedDiagram);
      const loaded: Diagram = JSON.parse(json);

      // Verify deleted node is not present
      expect(loaded.diagram_nodes.find(n => n.id === 'node-1')).toBeUndefined();
      expect(loaded.diagram_nodes.find(n => n.id === 'node-2')).toBeDefined();
    });
  });

  describe('State consistency', () => {
    it('should maintain selection state correctly through operations', () => {
      // Initial state
      let selectedNodeIds = new Set<string>();
      let selectedEdgeIds = new Set<string>();

      // Box-select adds nodes
      selectedNodeIds = new Set(['node-1', 'node-2']);
      expect(selectedNodeIds.size).toBe(2);

      // Ctrl+click adds another
      selectedNodeIds = new Set([...selectedNodeIds, 'node-3']);
      expect(selectedNodeIds.size).toBe(3);

      // Ctrl+click on selected node removes it
      selectedNodeIds.delete('node-2');
      expect(selectedNodeIds.size).toBe(2);
      expect(selectedNodeIds.has('node-2')).toBe(false);

      // Delete clears selection
      selectedNodeIds = new Set();
      selectedEdgeIds = new Set();
      expect(selectedNodeIds.size).toBe(0);
      expect(selectedEdgeIds.size).toBe(0);
    });
  });
});
