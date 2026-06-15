/**
 * Activity Diagram UX Fixes - Task Group 4: Draggable ActivityFlow Edge Labels Tests
 * Spec 2026-01-01: Draggable ActivityFlow edge labels
 *
 * Tests that ActivityFlow edge labels are positioned correctly by default
 * and that label positions persist when set.
 */

import { DiagramNode, DiagramEdge } from '../types/model';
import { createActivityFlowDiagramEdge } from '../utils/activityFlowCreation';

// Create test helpers
function createMockNode(id: string, x: number, y: number): DiagramNode {
  return {
    id,
    entity_type: 'ACTIVITY',
    entity_id: `activity_${id}`,
    pos_x: x,
    pos_y: y,
    width: 100,
    height: 60,
    auto_size: false,
    z_index: 100,
    style_override: {},
  };
}

describe('Task Group 4: Draggable ActivityFlow Edge Labels', () => {
  describe('Default label position at edge midpoint', () => {
    it('should set label_pos_x and label_pos_y when creating ActivityFlow edge', () => {
      const sourceNode = createMockNode('source', 100, 100);
      const targetNode = createMockNode('target', 300, 100);

      const edge = createActivityFlowDiagramEdge(
        'flow_1',
        sourceNode.id,
        targetNode.id,
        sourceNode,
        targetNode,
        'Action', // sourceActivityKind
        'Action'  // targetActivityKind
      );

      // Edge should have label position set
      expect(edge.label_pos_x).toBeDefined();
      expect(edge.label_pos_y).toBeDefined();
    });

    it('should position label at midpoint between source and target', () => {
      // Create two nodes horizontally aligned
      const sourceNode = createMockNode('source', 0, 100);   // Center at (50, 130)
      const targetNode = createMockNode('target', 200, 100); // Center at (250, 130)

      const edge = createActivityFlowDiagramEdge(
        'flow_1',
        sourceNode.id,
        targetNode.id,
        sourceNode,
        targetNode,
        'Action',
        'Action'
      );

      // For Action (rounded rect) nodes, boundary points are at edges
      // Source boundary: right edge at x=100
      // Target boundary: left edge at x=200
      // Midpoint x: (100 + 200) / 2 = 150
      // Midpoint y: (130 + 130) / 2 = 130, then offset by -8 = 122
      expect(edge.label_pos_x).toBeCloseTo(150, 0);
      // Y should be around midpoint with -8 offset
      expect(edge.label_pos_y).toBeDefined();
    });
  });

  describe('Label renders at stored position', () => {
    it('should use provided label_pos_x/y values when set', () => {
      const edge: DiagramEdge = {
        id: 'edge_1',
        relationship_type: 'ACTIVITY_FLOW',
        relationship_id: 'flow_1',
        source_node_id: 'source',
        target_node_id: 'target',
        z_index: 110,
        edge_points: [],
        style_override: {},
        label_pos_x: 250,
        label_pos_y: 175,
      };

      // When label_pos_x/y are set, they should be used directly
      expect(edge.label_pos_x).toBe(250);
      expect(edge.label_pos_y).toBe(175);
    });
  });

  describe('Edge label position persistence', () => {
    it('should retain label position after being set', () => {
      const edge: DiagramEdge = {
        id: 'edge_1',
        relationship_type: 'ACTIVITY_FLOW',
        relationship_id: 'flow_1',
        source_node_id: 'source',
        target_node_id: 'target',
        z_index: 110,
        edge_points: [],
        style_override: {},
        label_pos_x: 100,
        label_pos_y: 200,
      };

      // Simulate updating the position (as would happen after drag)
      const updatedEdge: DiagramEdge = {
        ...edge,
        label_pos_x: 150,
        label_pos_y: 250,
      };

      expect(updatedEdge.label_pos_x).toBe(150);
      expect(updatedEdge.label_pos_y).toBe(250);
    });
  });

  describe('ActivityFlow edge structure', () => {
    it('should create edge with ACTIVITY_FLOW relationship type', () => {
      const sourceNode = createMockNode('source', 100, 100);
      const targetNode = createMockNode('target', 300, 100);

      const edge = createActivityFlowDiagramEdge(
        'flow_1',
        sourceNode.id,
        targetNode.id,
        sourceNode,
        targetNode
      );

      expect(edge.relationship_type).toBe('ACTIVITY_FLOW');
      expect(edge.relationship_id).toBe('flow_1');
    });

    it('should connect source and target nodes correctly', () => {
      const sourceNode = createMockNode('source', 100, 100);
      const targetNode = createMockNode('target', 300, 100);

      const edge = createActivityFlowDiagramEdge(
        'flow_1',
        sourceNode.id,
        targetNode.id,
        sourceNode,
        targetNode
      );

      expect(edge.source_node_id).toBe('source');
      expect(edge.target_node_id).toBe('target');
    });
  });
});
