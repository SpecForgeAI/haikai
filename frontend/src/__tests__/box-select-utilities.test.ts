/**
 * Box-Select Utilities Tests
 * Tests for multi-selection editing utility functions
 */

import { DiagramNode, DiagramEdge, EdgePoint } from '../types/model';

// Mock utility functions - will be replaced with actual imports after implementation
// These tests are written first as per TDD approach

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

// Import actual utilities after they are implemented
import {
  normalizeRect,
  isNodeInsideRect,
  computeEdgeBoundingBox,
  isEdgeInsideRect,
} from '../utils/rendering';

describe('Box-Select Utility Functions', () => {
  describe('normalizeRect', () => {
    it('should normalize rectangle with normal coordinates (x1 < x2, y1 < y2)', () => {
      const result = normalizeRect(10, 20, 100, 200);
      expect(result).toEqual({ minX: 10, minY: 20, maxX: 100, maxY: 200 });
    });

    it('should normalize rectangle when dragged right-to-left (x1 > x2)', () => {
      const result = normalizeRect(100, 20, 10, 200);
      expect(result).toEqual({ minX: 10, minY: 20, maxX: 100, maxY: 200 });
    });

    it('should normalize rectangle when dragged bottom-to-top (y1 > y2)', () => {
      const result = normalizeRect(10, 200, 100, 20);
      expect(result).toEqual({ minX: 10, minY: 20, maxX: 100, maxY: 200 });
    });

    it('should normalize rectangle when dragged diagonal (both inverted)', () => {
      const result = normalizeRect(100, 200, 10, 20);
      expect(result).toEqual({ minX: 10, minY: 20, maxX: 100, maxY: 200 });
    });
  });

  describe('isNodeInsideRect', () => {
    it('should return true when node is fully enclosed in rectangle', () => {
      const node = createTestNode({ pos_x: 150, pos_y: 150, width: 50, height: 30 });
      const rect = { x1: 100, y1: 100, x2: 300, y2: 300 };
      expect(isNodeInsideRect(node, rect)).toBe(true);
    });

    it('should return false when node partially overlaps rectangle (left side outside)', () => {
      const node = createTestNode({ pos_x: 50, pos_y: 150, width: 100, height: 30 });
      const rect = { x1: 100, y1: 100, x2: 300, y2: 300 };
      expect(isNodeInsideRect(node, rect)).toBe(false);
    });

    it('should return false when node partially overlaps rectangle (right side outside)', () => {
      const node = createTestNode({ pos_x: 250, pos_y: 150, width: 100, height: 30 });
      const rect = { x1: 100, y1: 100, x2: 300, y2: 300 };
      expect(isNodeInsideRect(node, rect)).toBe(false);
    });

    it('should return false when node is completely outside rectangle', () => {
      const node = createTestNode({ pos_x: 500, pos_y: 500, width: 50, height: 30 });
      const rect = { x1: 100, y1: 100, x2: 300, y2: 300 };
      expect(isNodeInsideRect(node, rect)).toBe(false);
    });

    it('should handle inverted rectangle coordinates (startX > endX)', () => {
      const node = createTestNode({ pos_x: 150, pos_y: 150, width: 50, height: 30 });
      // Rectangle drawn right-to-left
      const rect = { x1: 300, y1: 100, x2: 100, y2: 300 };
      expect(isNodeInsideRect(node, rect)).toBe(true);
    });

    it('should return true when node exactly fits inside rectangle', () => {
      const node = createTestNode({ pos_x: 100, pos_y: 100, width: 100, height: 100 });
      const rect = { x1: 100, y1: 100, x2: 200, y2: 200 };
      expect(isNodeInsideRect(node, rect)).toBe(true);
    });
  });

  describe('computeEdgeBoundingBox', () => {
    it('should compute bounding box for multi-point edge', () => {
      const edge = createTestEdge({
        edge_points: [
          { id: 'ep-1', sequence_order: 0, pos_x: 100, pos_y: 50 },
          { id: 'ep-2', sequence_order: 1, pos_x: 150, pos_y: 200 },
          { id: 'ep-3', sequence_order: 2, pos_x: 250, pos_y: 100 },
        ],
      });
      const result = computeEdgeBoundingBox(edge);
      expect(result).toEqual({ minX: 100, minY: 50, maxX: 250, maxY: 200 });
    });

    it('should compute bounding box for 2-point edge', () => {
      const edge = createTestEdge({
        edge_points: [
          { id: 'ep-1', sequence_order: 0, pos_x: 100, pos_y: 100 },
          { id: 'ep-2', sequence_order: 1, pos_x: 200, pos_y: 200 },
        ],
      });
      const result = computeEdgeBoundingBox(edge);
      expect(result).toEqual({ minX: 100, minY: 100, maxX: 200, maxY: 200 });
    });

    it('should handle empty edge_points array gracefully', () => {
      const edge = createTestEdge({ edge_points: [] });
      const result = computeEdgeBoundingBox(edge);
      // Return a null/empty bounding box for empty edges
      expect(result).toEqual({ minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
    });

    it('should handle single point edge', () => {
      const edge = createTestEdge({
        edge_points: [
          { id: 'ep-1', sequence_order: 0, pos_x: 150, pos_y: 150 },
        ],
      });
      const result = computeEdgeBoundingBox(edge);
      expect(result).toEqual({ minX: 150, minY: 150, maxX: 150, maxY: 150 });
    });
  });

  describe('isEdgeInsideRect', () => {
    it('should return true when entire edge bounding box is inside rectangle', () => {
      const edge = createTestEdge({
        edge_points: [
          { id: 'ep-1', sequence_order: 0, pos_x: 150, pos_y: 150 },
          { id: 'ep-2', sequence_order: 1, pos_x: 200, pos_y: 200 },
        ],
      });
      const rect = { x1: 100, y1: 100, x2: 300, y2: 300 };
      expect(isEdgeInsideRect(edge, rect)).toBe(true);
    });

    it('should return false when edge partially outside rectangle', () => {
      const edge = createTestEdge({
        edge_points: [
          { id: 'ep-1', sequence_order: 0, pos_x: 50, pos_y: 150 },
          { id: 'ep-2', sequence_order: 1, pos_x: 200, pos_y: 200 },
        ],
      });
      const rect = { x1: 100, y1: 100, x2: 300, y2: 300 };
      expect(isEdgeInsideRect(edge, rect)).toBe(false);
    });

    it('should return false when edge is completely outside rectangle', () => {
      const edge = createTestEdge({
        edge_points: [
          { id: 'ep-1', sequence_order: 0, pos_x: 400, pos_y: 400 },
          { id: 'ep-2', sequence_order: 1, pos_x: 500, pos_y: 500 },
        ],
      });
      const rect = { x1: 100, y1: 100, x2: 300, y2: 300 };
      expect(isEdgeInsideRect(edge, rect)).toBe(false);
    });

    it('should handle inverted rectangle coordinates', () => {
      const edge = createTestEdge({
        edge_points: [
          { id: 'ep-1', sequence_order: 0, pos_x: 150, pos_y: 150 },
          { id: 'ep-2', sequence_order: 1, pos_x: 200, pos_y: 200 },
        ],
      });
      // Rectangle drawn right-to-left, bottom-to-top
      const rect = { x1: 300, y1: 300, x2: 100, y2: 100 };
      expect(isEdgeInsideRect(edge, rect)).toBe(true);
    });

    it('should return false for edge with empty edge_points', () => {
      const edge = createTestEdge({ edge_points: [] });
      const rect = { x1: 100, y1: 100, x2: 300, y2: 300 };
      expect(isEdgeInsideRect(edge, rect)).toBe(false);
    });
  });
});
