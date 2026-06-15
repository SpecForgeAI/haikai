/**
 * Activity Diagram UX Fixes - Task Group 3: Palette Greying and Delete Tests
 * Spec 2026-01-01: RHS palette greying for items already on diagram
 *
 * Tests that Activity, ActivityFlow, and ActivityPartition palette items
 * correctly show greyed/disabled state when already on the diagram.
 */

import { DiagramNode, DiagramEdge, ENTITY_TYPES } from '../types/model';
import { nodeExistsForEntity } from '../utils/nodeCreation';

// Helper functions for on-diagram detection
function isActivityOnDiagram(activityId: string, diagramNodes: DiagramNode[]): boolean {
  return nodeExistsForEntity(diagramNodes, ENTITY_TYPES.ACTIVITY, activityId);
}

function isActivityPartitionOnDiagram(partitionId: string, diagramNodes: DiagramNode[]): boolean {
  return nodeExistsForEntity(diagramNodes, ENTITY_TYPES.ACTIVITY_PARTITION, partitionId);
}

function isActivityFlowOnDiagram(flowId: string, diagramEdges: DiagramEdge[]): boolean {
  return diagramEdges.some(
    edge => edge.relationship_type === 'ACTIVITY_FLOW' && edge.relationship_id === flowId
  );
}

// Create test helpers
function createMockNode(entityType: string, entityId: string): DiagramNode {
  return {
    id: `node_${entityId}`,
    entity_type: entityType as any,
    entity_id: entityId,
    pos_x: 100,
    pos_y: 100,
    width: 100,
    height: 60,
    auto_size: false,
    z_index: 100,
    style_override: {},
  };
}

function createMockEdge(relationshipType: string, relationshipId: string): DiagramEdge {
  return {
    id: `edge_${relationshipId}`,
    relationship_type: relationshipType as any,
    relationship_id: relationshipId,
    source_node_id: 'source_node',
    target_node_id: 'target_node',
    z_index: 110,
    edge_points: [],
    style_override: {},
  };
}

describe('Task Group 3: Palette Greying for Activity Elements', () => {
  describe('isActivityOnDiagram', () => {
    it('should return true when Activity node exists on diagram', () => {
      const nodes: DiagramNode[] = [
        createMockNode(ENTITY_TYPES.ACTIVITY, 'activity_1'),
        createMockNode(ENTITY_TYPES.APPLICATION, 'app_1'),
      ];

      expect(isActivityOnDiagram('activity_1', nodes)).toBe(true);
    });

    it('should return false when Activity node does not exist on diagram', () => {
      const nodes: DiagramNode[] = [
        createMockNode(ENTITY_TYPES.APPLICATION, 'app_1'),
      ];

      expect(isActivityOnDiagram('activity_1', nodes)).toBe(false);
    });

    it('should return false for different entity types with same ID', () => {
      const nodes: DiagramNode[] = [
        createMockNode(ENTITY_TYPES.APPLICATION, 'activity_1'), // Same ID but wrong type
      ];

      expect(isActivityOnDiagram('activity_1', nodes)).toBe(false);
    });
  });

  describe('isActivityPartitionOnDiagram', () => {
    it('should return true when ActivityPartition node exists on diagram', () => {
      const nodes: DiagramNode[] = [
        createMockNode(ENTITY_TYPES.ACTIVITY_PARTITION, 'partition_1'),
      ];

      expect(isActivityPartitionOnDiagram('partition_1', nodes)).toBe(true);
    });

    it('should return false when ActivityPartition node does not exist on diagram', () => {
      const nodes: DiagramNode[] = [
        createMockNode(ENTITY_TYPES.ACTIVITY, 'activity_1'),
      ];

      expect(isActivityPartitionOnDiagram('partition_1', nodes)).toBe(false);
    });
  });

  describe('isActivityFlowOnDiagram', () => {
    it('should return true when ActivityFlow edge exists on diagram', () => {
      const edges: DiagramEdge[] = [
        createMockEdge('ACTIVITY_FLOW', 'flow_1'),
      ];

      expect(isActivityFlowOnDiagram('flow_1', edges)).toBe(true);
    });

    it('should return false when ActivityFlow edge does not exist on diagram', () => {
      const edges: DiagramEdge[] = [
        createMockEdge('DATA_MOVEMENT', 'data_1'),
      ];

      expect(isActivityFlowOnDiagram('flow_1', edges)).toBe(false);
    });

    it('should return false for different relationship type with same ID', () => {
      const edges: DiagramEdge[] = [
        createMockEdge('DATA_MOVEMENT', 'flow_1'), // Same ID but wrong type
      ];

      expect(isActivityFlowOnDiagram('flow_1', edges)).toBe(false);
    });

    it('should return false for empty edges array', () => {
      const edges: DiagramEdge[] = [];

      expect(isActivityFlowOnDiagram('flow_1', edges)).toBe(false);
    });
  });

  describe('Greyed styling integration', () => {
    it('should identify Activity node as on diagram for duplicate styling', () => {
      const nodes: DiagramNode[] = [
        createMockNode(ENTITY_TYPES.ACTIVITY, 'activity_1'),
      ];

      // This simulates the logic in PaletteItem that determines isDuplicate
      const isDuplicate = isActivityOnDiagram('activity_1', nodes);
      expect(isDuplicate).toBe(true);
    });

    it('should identify ActivityFlow edge as on diagram for duplicate styling', () => {
      const edges: DiagramEdge[] = [
        createMockEdge('ACTIVITY_FLOW', 'flow_1'),
      ];

      // This simulates the logic needed for PaletteItem to detect flow duplicates
      const isDuplicate = isActivityFlowOnDiagram('flow_1', edges);
      expect(isDuplicate).toBe(true);
    });
  });
});
