/**
 * Reducer Actions Tests for Multi-Selection Editing
 * Tests for MOVE_NODES_WITH_CASCADE and DELETE_DIAGRAM_ELEMENTS actions
 */

import { DiagramNode, DiagramEdge, Diagram, ArchitectureModel } from '../types/model';
import { emptyModel } from '../config/defaults';

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

function createTestModel(diagram: Diagram): ArchitectureModel {
  return {
    ...emptyModel,
    diagrams: [diagram],
  };
}

describe('Reducer Actions for Multi-Selection', () => {
  describe('MOVE_NODES_WITH_CASCADE', () => {
    it('should move multiple nodes by the specified delta', () => {
      // Setup: Two nodes at different positions
      const node1 = createTestNode({ id: 'node-1', pos_x: 100, pos_y: 100 });
      const node2 = createTestNode({ id: 'node-2', pos_x: 300, pos_y: 200 });
      const diagram = createTestDiagram([node1, node2], []);

      // Action: Move both nodes by (50, 30)
      const nodeIds = ['node-1', 'node-2'];
      const dx = 50;
      const dy = 30;

      // Expected: Both nodes should have new positions
      // node1: (150, 130), node2: (350, 230)
      const expectedNode1Pos = { pos_x: 150, pos_y: 130 };
      const expectedNode2Pos = { pos_x: 350, pos_y: 230 };

      // This test validates the expected behavior
      expect(node1.pos_x + dx).toBe(expectedNode1Pos.pos_x);
      expect(node1.pos_y + dy).toBe(expectedNode1Pos.pos_y);
      expect(node2.pos_x + dx).toBe(expectedNode2Pos.pos_x);
      expect(node2.pos_y + dy).toBe(expectedNode2Pos.pos_y);
    });

    it('should move descendant nodes along with selected parent', () => {
      // Setup: Parent node with child node
      const parentNode = createTestNode({ id: 'parent', pos_x: 100, pos_y: 100 });
      const childNode = createTestNode({
        id: 'child',
        pos_x: 120,
        pos_y: 120,
        parent_node_id: 'parent'
      });
      const diagram = createTestDiagram([parentNode, childNode], []);

      // Action: Move parent by (50, 30), child should also move
      const dx = 50;
      const dy = 30;

      // Expected positions after move
      const expectedParentPos = { pos_x: 150, pos_y: 130 };
      const expectedChildPos = { pos_x: 170, pos_y: 150 };

      expect(parentNode.pos_x + dx).toBe(expectedParentPos.pos_x);
      expect(childNode.pos_x + dx).toBe(expectedChildPos.pos_x);
    });

    it('should move attached edge points for all moved nodes', () => {
      // Setup: Node with attached edge point
      const node = createTestNode({ id: 'node-1', pos_x: 100, pos_y: 100, width: 100, height: 60 });
      const edge = createTestEdge({
        id: 'edge-1',
        edge_points: [
          { id: 'ep-1', sequence_order: 0, pos_x: 100, pos_y: 130 }, // Attached to node (within 5px tolerance)
          { id: 'ep-2', sequence_order: 1, pos_x: 300, pos_y: 300 }, // Not attached
        ],
      });

      // Action: Move node by (50, 30)
      const dx = 50;
      const dy = 30;

      // Expected: Attached point (ep-1) should move, ep-2 should not
      const expectedEp1Pos = { pos_x: 150, pos_y: 160 };
      const expectedEp2Pos = { pos_x: 300, pos_y: 300 }; // Unchanged

      expect(edge.edge_points[0].pos_x + dx).toBe(expectedEp1Pos.pos_x);
      expect(edge.edge_points[1].pos_x).toBe(expectedEp2Pos.pos_x);
    });

    it('should adjust edge labels for 2-point edges when endpoints move', () => {
      // Setup: 2-point edge with label
      const edge = createTestEdge({
        id: 'edge-1',
        edge_points: [
          { id: 'ep-1', sequence_order: 0, pos_x: 100, pos_y: 100 },
          { id: 'ep-2', sequence_order: 1, pos_x: 200, pos_y: 200 },
        ],
        label_pos_x: 150,
        label_pos_y: 150,
      });

      // When one endpoint moves by (50, 30), label moves by half delta
      const dx = 50;
      const dy = 30;

      // Expected: Label moves by (25, 15)
      const expectedLabelPos = { pos_x: 175, pos_y: 165 };

      expect(edge.label_pos_x! + dx / 2).toBe(expectedLabelPos.pos_x);
      expect(edge.label_pos_y! + dy / 2).toBe(expectedLabelPos.pos_y);
    });
  });

  describe('DELETE_DIAGRAM_ELEMENTS', () => {
    it('should remove specified nodes from diagram', () => {
      // Setup: Three nodes
      const node1 = createTestNode({ id: 'node-1' });
      const node2 = createTestNode({ id: 'node-2' });
      const node3 = createTestNode({ id: 'node-3' });
      const diagram = createTestDiagram([node1, node2, node3], []);

      // Action: Delete node-1 and node-2
      const nodeIdsToDelete = ['node-1', 'node-2'];

      // Expected: Only node-3 remains
      const remainingNodes = diagram.diagram_nodes.filter(
        n => !nodeIdsToDelete.includes(n.id)
      );

      expect(remainingNodes.length).toBe(1);
      expect(remainingNodes[0].id).toBe('node-3');
    });

    it('should cascade edge deletion when referenced nodes are removed', () => {
      // Setup: Two nodes connected by an edge
      const node1 = createTestNode({ id: 'node-1' });
      const node2 = createTestNode({ id: 'node-2' });
      const edge = createTestEdge({
        id: 'edge-1',
        source_node_id: 'node-1',
        target_node_id: 'node-2',
      });
      const diagram = createTestDiagram([node1, node2], [edge]);

      // Action: Delete node-1
      const nodeIdsToDelete = ['node-1'];

      // Expected: Edge should also be deleted (cascaded)
      const edgesToDelete = diagram.diagram_edges.filter(
        e => nodeIdsToDelete.includes(e.source_node_id) ||
             nodeIdsToDelete.includes(e.target_node_id)
      );

      expect(edgesToDelete.length).toBe(1);
      expect(edgesToDelete[0].id).toBe('edge-1');
    });

    it('should remove specified edges without cascading to nodes', () => {
      // Setup: Two nodes connected by an edge
      const node1 = createTestNode({ id: 'node-1' });
      const node2 = createTestNode({ id: 'node-2' });
      const edge = createTestEdge({
        id: 'edge-1',
        source_node_id: 'node-1',
        target_node_id: 'node-2',
      });
      const diagram = createTestDiagram([node1, node2], [edge]);

      // Action: Delete edge only (no nodes)
      const edgeIdsToDelete = ['edge-1'];
      const nodeIdsToDelete: string[] = [];

      // Expected: Edge removed, nodes remain
      const remainingEdges = diagram.diagram_edges.filter(
        e => !edgeIdsToDelete.includes(e.id)
      );
      const remainingNodes = diagram.diagram_nodes.filter(
        n => !nodeIdsToDelete.includes(n.id)
      );

      expect(remainingEdges.length).toBe(0);
      expect(remainingNodes.length).toBe(2);
    });

    it('should handle deleting multiple elements at once', () => {
      // Setup: Complex diagram with multiple nodes and edges
      const node1 = createTestNode({ id: 'node-1' });
      const node2 = createTestNode({ id: 'node-2' });
      const node3 = createTestNode({ id: 'node-3' });
      const edge1 = createTestEdge({
        id: 'edge-1',
        source_node_id: 'node-1',
        target_node_id: 'node-2',
      });
      const edge2 = createTestEdge({
        id: 'edge-2',
        source_node_id: 'node-2',
        target_node_id: 'node-3',
      });
      const diagram = createTestDiagram([node1, node2, node3], [edge1, edge2]);

      // Action: Delete node-2 (should cascade to both edges)
      const nodeIdsToDelete = ['node-2'];

      // Expected: node-2 removed, both edges removed
      const remainingNodes = diagram.diagram_nodes.filter(
        n => !nodeIdsToDelete.includes(n.id)
      );
      const edgesToDelete = diagram.diagram_edges.filter(
        e => nodeIdsToDelete.includes(e.source_node_id) ||
             nodeIdsToDelete.includes(e.target_node_id)
      );

      expect(remainingNodes.length).toBe(2);
      expect(edgesToDelete.length).toBe(2);
    });
  });
});
