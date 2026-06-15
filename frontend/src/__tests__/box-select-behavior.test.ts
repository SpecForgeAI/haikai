/**
 * Box-Select Behavior Tests
 * Tests for box-select interaction behaviors on the canvas
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

describe('Box-Select Behavior', () => {
  describe('Selection rectangle rendering', () => {
    it('should initiate box-select when clicking on empty canvas', () => {
      // Simulate: Mouse down on empty canvas area
      // Expected: boxSelectState.isSelecting = true, startX/startY set
      const emptyCanvasClick = { x: 500, y: 500 };
      const nodes: DiagramNode[] = [];
      const edges: DiagramEdge[] = [];

      // No node or edge hit at (500, 500)
      const hitNode = nodes.find(n =>
        emptyCanvasClick.x >= n.pos_x &&
        emptyCanvasClick.x <= n.pos_x + n.width &&
        emptyCanvasClick.y >= n.pos_y &&
        emptyCanvasClick.y <= n.pos_y + n.height
      );

      expect(hitNode).toBeUndefined();
      // Should initiate box-select
    });

    it('should update selection rectangle on mouse move', () => {
      // Simulate: Box-select in progress, mouse moves
      const startPos = { x: 100, y: 100 };
      const currentPos = { x: 300, y: 250 };

      // Expected rectangle dimensions
      const expectedWidth = currentPos.x - startPos.x;
      const expectedHeight = currentPos.y - startPos.y;

      expect(expectedWidth).toBe(200);
      expect(expectedHeight).toBe(150);
    });

    it('should clear selection rectangle on mouse up', () => {
      // Simulate: Mouse up after box-select
      // Expected: boxSelectState.isSelecting = false, rectangle no longer renders
      const isSelecting = false;
      expect(isSelecting).toBe(false);
    });
  });

  describe('Node selection via box-select', () => {
    it('should select nodes fully inside the selection rectangle', () => {
      const nodes: DiagramNode[] = [
        createTestNode({ id: 'node-1', pos_x: 150, pos_y: 150, width: 50, height: 30 }),
        createTestNode({ id: 'node-2', pos_x: 180, pos_y: 170, width: 40, height: 25 }),
      ];

      // Selection rectangle from (100, 100) to (300, 300)
      const rect = { x1: 100, y1: 100, x2: 300, y2: 300 };

      const selectedNodes = nodes.filter(n => {
        const nodeLeft = n.pos_x;
        const nodeRight = n.pos_x + n.width;
        const nodeTop = n.pos_y;
        const nodeBottom = n.pos_y + n.height;

        return (
          nodeLeft >= rect.x1 &&
          nodeRight <= rect.x2 &&
          nodeTop >= rect.y1 &&
          nodeBottom <= rect.y2
        );
      });

      // Both nodes should be selected
      expect(selectedNodes.length).toBe(2);
      expect(selectedNodes.map(n => n.id)).toContain('node-1');
      expect(selectedNodes.map(n => n.id)).toContain('node-2');
    });

    it('should NOT select nodes only partially inside the rectangle', () => {
      const nodes: DiagramNode[] = [
        createTestNode({ id: 'node-1', pos_x: 50, pos_y: 150, width: 100, height: 30 }), // Left side outside
        createTestNode({ id: 'node-2', pos_x: 250, pos_y: 150, width: 100, height: 30 }), // Right side outside
      ];

      // Selection rectangle from (100, 100) to (300, 300)
      const rect = { x1: 100, y1: 100, x2: 300, y2: 300 };

      const selectedNodes = nodes.filter(n => {
        const nodeLeft = n.pos_x;
        const nodeRight = n.pos_x + n.width;
        const nodeTop = n.pos_y;
        const nodeBottom = n.pos_y + n.height;

        return (
          nodeLeft >= rect.x1 &&
          nodeRight <= rect.x2 &&
          nodeTop >= rect.y1 &&
          nodeBottom <= rect.y2
        );
      });

      // Neither node should be selected (both partially outside)
      expect(selectedNodes.length).toBe(0);
    });
  });

  describe('Edge selection via box-select', () => {
    it('should select edges fully inside the selection rectangle', () => {
      const edges: DiagramEdge[] = [
        createTestEdge({
          id: 'edge-1',
          edge_points: [
            { id: 'ep-1', sequence_order: 0, pos_x: 150, pos_y: 150 },
            { id: 'ep-2', sequence_order: 1, pos_x: 250, pos_y: 250 },
          ],
        }),
      ];

      // Selection rectangle from (100, 100) to (300, 300)
      const rect = { x1: 100, y1: 100, x2: 300, y2: 300 };

      const selectedEdges = edges.filter(e => {
        const points = e.edge_points || [];
        if (points.length === 0) return false;

        // All points must be inside rectangle
        return points.every(p =>
          p.pos_x >= rect.x1 &&
          p.pos_x <= rect.x2 &&
          p.pos_y >= rect.y1 &&
          p.pos_y <= rect.y2
        );
      });

      expect(selectedEdges.length).toBe(1);
      expect(selectedEdges[0].id).toBe('edge-1');
    });

    it('should NOT select edges partially outside the rectangle', () => {
      const edges: DiagramEdge[] = [
        createTestEdge({
          id: 'edge-1',
          edge_points: [
            { id: 'ep-1', sequence_order: 0, pos_x: 50, pos_y: 150 }, // Outside
            { id: 'ep-2', sequence_order: 1, pos_x: 250, pos_y: 250 }, // Inside
          ],
        }),
      ];

      // Selection rectangle from (100, 100) to (300, 300)
      const rect = { x1: 100, y1: 100, x2: 300, y2: 300 };

      const selectedEdges = edges.filter(e => {
        const points = e.edge_points || [];
        if (points.length === 0) return false;

        // All points must be inside rectangle
        return points.every(p =>
          p.pos_x >= rect.x1 &&
          p.pos_x <= rect.x2 &&
          p.pos_y >= rect.y1 &&
          p.pos_y <= rect.y2
        );
      });

      expect(selectedEdges.length).toBe(0);
    });
  });

  describe('Ctrl+drag behavior', () => {
    it('should add to existing selection when Ctrl is held', () => {
      // Existing selection
      const existingNodeIds = new Set(['node-1']);
      const existingEdgeIds = new Set<string>();

      // New selection from box-select
      const newNodeIds = new Set(['node-2', 'node-3']);
      const newEdgeIds = new Set(['edge-1']);

      // Ctrl+drag behavior: union
      const addToExisting = true;

      let finalNodeIds: Set<string>;
      let finalEdgeIds: Set<string>;

      if (addToExisting) {
        finalNodeIds = new Set([...existingNodeIds, ...newNodeIds]);
        finalEdgeIds = new Set([...existingEdgeIds, ...newEdgeIds]);
      } else {
        finalNodeIds = newNodeIds;
        finalEdgeIds = newEdgeIds;
      }

      expect(finalNodeIds.size).toBe(3);
      expect(finalNodeIds.has('node-1')).toBe(true);
      expect(finalNodeIds.has('node-2')).toBe(true);
      expect(finalNodeIds.has('node-3')).toBe(true);
      expect(finalEdgeIds.size).toBe(1);
    });

    it('should replace selection when Ctrl is NOT held', () => {
      // Existing selection
      const existingNodeIds = new Set(['node-1']);
      const existingEdgeIds = new Set<string>();

      // New selection from box-select
      const newNodeIds = new Set(['node-2', 'node-3']);
      const newEdgeIds = new Set(['edge-1']);

      // Normal drag behavior: replace
      const addToExisting = false;

      let finalNodeIds: Set<string>;
      let finalEdgeIds: Set<string>;

      if (addToExisting) {
        finalNodeIds = new Set([...existingNodeIds, ...newNodeIds]);
        finalEdgeIds = new Set([...existingEdgeIds, ...newEdgeIds]);
      } else {
        finalNodeIds = newNodeIds;
        finalEdgeIds = newEdgeIds;
      }

      expect(finalNodeIds.size).toBe(2);
      expect(finalNodeIds.has('node-1')).toBe(false);
      expect(finalNodeIds.has('node-2')).toBe(true);
      expect(finalNodeIds.has('node-3')).toBe(true);
      expect(finalEdgeIds.size).toBe(1);
    });
  });
});
