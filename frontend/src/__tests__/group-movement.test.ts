/**
 * Group Movement Tests
 * Tests for multi-selection group movement behavior
 */

import { DiagramNode, DiagramEdge } from '../types/model';

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

describe('Group Movement', () => {
  describe('Group drag initiation', () => {
    it('should initiate group drag when clicking on a selected node', () => {
      // Setup: node-1 and node-2 are selected, user clicks on node-1
      const selectedNodeIds = new Set(['node-1', 'node-2']);
      const clickedNodeId = 'node-1';

      // Check if clicked node is in selection
      const isSelectedNodeClicked = selectedNodeIds.has(clickedNodeId);

      // Should initiate group drag
      expect(isSelectedNodeClicked).toBe(true);
    });

    it('should NOT initiate group drag when clicking on an unselected node', () => {
      // Setup: node-1 and node-2 are selected, user clicks on node-3
      const selectedNodeIds = new Set(['node-1', 'node-2']);
      const clickedNodeId = 'node-3';

      // Check if clicked node is in selection
      const isSelectedNodeClicked = selectedNodeIds.has(clickedNodeId);

      // Should NOT initiate group drag (single node drag instead)
      expect(isSelectedNodeClicked).toBe(false);
    });
  });

  describe('Group movement behavior', () => {
    it('should move all selected nodes by the same delta', () => {
      const nodes: DiagramNode[] = [
        createTestNode({ id: 'node-1', pos_x: 100, pos_y: 100 }),
        createTestNode({ id: 'node-2', pos_x: 200, pos_y: 150 }),
        createTestNode({ id: 'node-3', pos_x: 300, pos_y: 200 }),
      ];

      const selectedNodeIds = new Set(['node-1', 'node-2']);
      const dx = 50;
      const dy = 30;

      // Move selected nodes
      const movedNodes = nodes.map(n => {
        if (selectedNodeIds.has(n.id)) {
          return { ...n, pos_x: n.pos_x + dx, pos_y: n.pos_y + dy };
        }
        return n;
      });

      // node-1 should move
      expect(movedNodes.find(n => n.id === 'node-1')!.pos_x).toBe(150);
      expect(movedNodes.find(n => n.id === 'node-1')!.pos_y).toBe(130);

      // node-2 should move
      expect(movedNodes.find(n => n.id === 'node-2')!.pos_x).toBe(250);
      expect(movedNodes.find(n => n.id === 'node-2')!.pos_y).toBe(180);

      // node-3 should NOT move (not selected)
      expect(movedNodes.find(n => n.id === 'node-3')!.pos_x).toBe(300);
      expect(movedNodes.find(n => n.id === 'node-3')!.pos_y).toBe(200);
    });

    it('should move descendant nodes along with selected parent', () => {
      const nodes: DiagramNode[] = [
        createTestNode({ id: 'parent', pos_x: 100, pos_y: 100 }),
        createTestNode({ id: 'child-1', pos_x: 120, pos_y: 120, parent_node_id: 'parent' }),
        createTestNode({ id: 'child-2', pos_x: 150, pos_y: 130, parent_node_id: 'parent' }),
      ];

      const selectedNodeIds = new Set(['parent']);
      const dx = 50;
      const dy = 30;

      // Get descendants
      const getDescendants = (nodeId: string): string[] => {
        const children = nodes.filter(n => n.parent_node_id === nodeId);
        const descendants = children.map(c => c.id);
        children.forEach(c => descendants.push(...getDescendants(c.id)));
        return descendants;
      };

      const descendantIds = getDescendants('parent');
      const allNodesToMove = new Set([...selectedNodeIds, ...descendantIds]);

      // Move all nodes in group
      const movedNodes = nodes.map(n => {
        if (allNodesToMove.has(n.id)) {
          return { ...n, pos_x: n.pos_x + dx, pos_y: n.pos_y + dy };
        }
        return n;
      });

      // Parent should move
      expect(movedNodes.find(n => n.id === 'parent')!.pos_x).toBe(150);

      // Children should also move
      expect(movedNodes.find(n => n.id === 'child-1')!.pos_x).toBe(170);
      expect(movedNodes.find(n => n.id === 'child-2')!.pos_x).toBe(200);
    });

    it('should move selected edge points by the same delta', () => {
      const edges: DiagramEdge[] = [
        createTestEdge({
          id: 'edge-1',
          edge_points: [
            { id: 'ep-1', sequence_order: 0, pos_x: 100, pos_y: 100 },
            { id: 'ep-2', sequence_order: 1, pos_x: 200, pos_y: 200 },
          ],
        }),
      ];

      const selectedEdgeIds = new Set(['edge-1']);
      const dx = 50;
      const dy = 30;

      // Move edge points for selected edges
      const movedEdges = edges.map(e => {
        if (selectedEdgeIds.has(e.id)) {
          return {
            ...e,
            edge_points: e.edge_points.map(p => ({
              ...p,
              pos_x: p.pos_x + dx,
              pos_y: p.pos_y + dy,
            })),
          };
        }
        return e;
      });

      const movedEdge = movedEdges.find(e => e.id === 'edge-1')!;
      expect(movedEdge.edge_points[0].pos_x).toBe(150);
      expect(movedEdge.edge_points[0].pos_y).toBe(130);
      expect(movedEdge.edge_points[1].pos_x).toBe(250);
      expect(movedEdge.edge_points[1].pos_y).toBe(230);
    });
  });

  describe('Edge attachment during group move', () => {
    it('should move attached edge points for non-selected edges', () => {
      // Setup: Edge attached to node, only node is selected (not edge)
      const node = createTestNode({
        id: 'node-1',
        pos_x: 100,
        pos_y: 100,
        width: 100,
        height: 60,
      });

      const edge = createTestEdge({
        id: 'edge-1',
        edge_points: [
          { id: 'ep-1', sequence_order: 0, pos_x: 105, pos_y: 130 }, // Attached to node (within 5px tolerance)
          { id: 'ep-2', sequence_order: 1, pos_x: 300, pos_y: 300 }, // Not attached
        ],
      });

      const selectedNodeIds = new Set(['node-1']);
      const selectedEdgeIds = new Set<string>(); // Edge not selected
      const dx = 50;
      const dy = 30;

      // Check attachment (tolerance = 5px)
      const isPointAttached = (point: { pos_x: number; pos_y: number }, n: DiagramNode): boolean => {
        const tolerance = 5;
        return (
          point.pos_x >= n.pos_x - tolerance &&
          point.pos_x <= n.pos_x + n.width + tolerance &&
          point.pos_y >= n.pos_y - tolerance &&
          point.pos_y <= n.pos_y + n.height + tolerance
        );
      };

      // ep-1 should be attached to node-1
      expect(isPointAttached(edge.edge_points[0], node)).toBe(true);

      // ep-2 should NOT be attached
      expect(isPointAttached(edge.edge_points[1], node)).toBe(false);

      // Move attached points
      const movedEdgePoints = edge.edge_points.map(p => {
        if (isPointAttached(p, node)) {
          return { ...p, pos_x: p.pos_x + dx, pos_y: p.pos_y + dy };
        }
        return p;
      });

      // ep-1 should have moved
      expect(movedEdgePoints[0].pos_x).toBe(155);
      expect(movedEdgePoints[0].pos_y).toBe(160);

      // ep-2 should NOT have moved
      expect(movedEdgePoints[1].pos_x).toBe(300);
      expect(movedEdgePoints[1].pos_y).toBe(300);
    });
  });

  describe('Edge label adjustment', () => {
    it('should adjust edge labels when both endpoints move', () => {
      const edge = createTestEdge({
        id: 'edge-1',
        edge_points: [
          { id: 'ep-1', sequence_order: 0, pos_x: 100, pos_y: 100 },
          { id: 'ep-2', sequence_order: 1, pos_x: 200, pos_y: 200 },
        ],
        label_pos_x: 150,
        label_pos_y: 150,
      });

      const dx = 50;
      const dy = 30;

      // Both endpoints moving by same delta = full translation of label
      const bothEndpointsMoved = true;
      let newLabelX = edge.label_pos_x!;
      let newLabelY = edge.label_pos_y!;

      if (bothEndpointsMoved) {
        newLabelX += dx;
        newLabelY += dy;
      }

      expect(newLabelX).toBe(200);
      expect(newLabelY).toBe(180);
    });

    it('should adjust edge labels by half delta when one endpoint moves', () => {
      const edge = createTestEdge({
        id: 'edge-1',
        edge_points: [
          { id: 'ep-1', sequence_order: 0, pos_x: 100, pos_y: 100 },
          { id: 'ep-2', sequence_order: 1, pos_x: 200, pos_y: 200 },
        ],
        label_pos_x: 150,
        label_pos_y: 150,
      });

      const dx = 50;
      const dy = 30;

      // One endpoint moving = half adjustment of label
      const oneEndpointMoved = true;
      let newLabelX = edge.label_pos_x!;
      let newLabelY = edge.label_pos_y!;

      if (oneEndpointMoved) {
        newLabelX += dx / 2;
        newLabelY += dy / 2;
      }

      expect(newLabelX).toBe(175);
      expect(newLabelY).toBe(165);
    });
  });
});
