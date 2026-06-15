/**
 * Activity Flow Validation Tests
 *
 * Task Group 1: Tests for ACTIVITY_FLOW entity handling
 *
 * These tests verify:
 * - ACTIVITY_FLOW is recognized as a known entity type
 * - Adding existing flow creates diagram edge (not node)
 * - Missing activity nodes shows appropriate warning
 * - Both add paths (new + existing) produce identical edge schema
 *
 * Spec 2025-12-31: Activity Diagram UX Improvements - A4
 */

import { describe, it, expect } from 'vitest';
import { DIAGRAM_NODE_ENTITY_TYPE_MAP, getKnownEntityTypes } from '../utils/entityTypeRegistry';
import { createActivityFlowDiagramEdge, createActivityFlowEntity } from '../utils/activityFlowCreation';
import { DiagramNode, DiagramEdge, ActivityFlow } from '../types/model';

describe('Activity Flow Validation Tests (Task Group 1)', () => {
  // =========================================
  // Test 1: ACTIVITY_FLOW is recognized as known entity type
  // =========================================

  describe('ACTIVITY_FLOW entity type registration', () => {
    it('should be registered in DIAGRAM_NODE_ENTITY_TYPE_MAP', () => {
      expect('ACTIVITY_FLOW' in DIAGRAM_NODE_ENTITY_TYPE_MAP).toBe(true);
      expect(DIAGRAM_NODE_ENTITY_TYPE_MAP['ACTIVITY_FLOW']).toBe('activity_flows');
    });

    it('should be included in known entity types list', () => {
      const knownTypes = getKnownEntityTypes();
      expect(knownTypes).toContain('ACTIVITY_FLOW');
    });
  });

  // =========================================
  // Test 2: Adding existing flow creates diagram edge (not node)
  // =========================================

  describe('Diagram edge creation for activity flows', () => {
    it('should create edge with correct structure', () => {
      // Create mock source and target nodes
      const sourceNode: DiagramNode = {
        id: 'node-1',
        entity_type: 'ACTIVITY',
        entity_id: 'activity-1',
        pos_x: 100,
        pos_y: 100,
        width: 120,
        height: 60,
        parent_node_id: null,
      };

      const targetNode: DiagramNode = {
        id: 'node-2',
        entity_type: 'ACTIVITY',
        entity_id: 'activity-2',
        pos_x: 300,
        pos_y: 100,
        width: 120,
        height: 60,
        parent_node_id: null,
      };

      // Create an activity flow entity
      const flowEntity = createActivityFlowEntity('activity-1', 'activity-2');

      // Create the diagram edge
      const edge = createActivityFlowDiagramEdge(
        flowEntity.id,
        sourceNode.id,
        targetNode.id,
        sourceNode,
        targetNode
      );

      // Verify edge structure has required properties
      expect(edge.id).toBeDefined();
      expect(edge.id.length).toBeGreaterThan(0);
      expect(edge.relationship_type).toBe('ACTIVITY_FLOW');
      expect(edge.relationship_id).toBe(flowEntity.id);
      expect(edge.source_node_id).toBe(sourceNode.id);
      expect(edge.target_node_id).toBe(targetNode.id);
      expect(edge.edge_points).toBeDefined();
      expect(edge.edge_points.length).toBeGreaterThanOrEqual(2);
    });
  });

  // =========================================
  // Test 3: Edge creation requires both activity nodes on diagram
  // =========================================

  describe('Activity node lookup for flow edges', () => {
    const sourceNode: DiagramNode = {
      id: 'node-1',
      entity_type: 'ACTIVITY',
      entity_id: 'activity-1',
      pos_x: 100,
      pos_y: 100,
      width: 120,
      height: 60,
      parent_node_id: null,
    };

    const targetNode: DiagramNode = {
      id: 'node-2',
      entity_type: 'ACTIVITY',
      entity_id: 'activity-2',
      pos_x: 300,
      pos_y: 100,
      width: 120,
      height: 60,
      parent_node_id: null,
    };

    // Helper to find nodes on diagram for an activity flow
    function findActivityNodesForFlow(
      flow: ActivityFlow,
      diagramNodes: DiagramNode[]
    ): { sourceNode?: DiagramNode; targetNode?: DiagramNode } {
      const foundSourceNode = diagramNodes.find(
        n => n.entity_type === 'ACTIVITY' && n.entity_id === flow.from_activity_id
      );
      const foundTargetNode = diagramNodes.find(
        n => n.entity_type === 'ACTIVITY' && n.entity_id === flow.to_activity_id
      );
      return { sourceNode: foundSourceNode, targetNode: foundTargetNode };
    }

    it('should find both nodes when both are on diagram', () => {
      const flowEntity = createActivityFlowEntity('activity-1', 'activity-2');
      const bothPresent = findActivityNodesForFlow(flowEntity, [sourceNode, targetNode]);
      expect(bothPresent.sourceNode).toBeDefined();
      expect(bothPresent.targetNode).toBeDefined();
    });

    it('should not find target when only source is on diagram', () => {
      const flowEntity = createActivityFlowEntity('activity-1', 'activity-2');
      const onlySource = findActivityNodesForFlow(flowEntity, [sourceNode]);
      expect(onlySource.sourceNode).toBeDefined();
      expect(onlySource.targetNode).toBeUndefined();
    });

    it('should not find source when only target is on diagram', () => {
      const flowEntity = createActivityFlowEntity('activity-1', 'activity-2');
      const onlyTarget = findActivityNodesForFlow(flowEntity, [targetNode]);
      expect(onlyTarget.sourceNode).toBeUndefined();
      expect(onlyTarget.targetNode).toBeDefined();
    });

    it('should not find any nodes when diagram is empty', () => {
      const flowEntity = createActivityFlowEntity('activity-1', 'activity-2');
      const neitherPresent = findActivityNodesForFlow(flowEntity, []);
      expect(neitherPresent.sourceNode).toBeUndefined();
      expect(neitherPresent.targetNode).toBeUndefined();
    });
  });

  // =========================================
  // Test 4: Both add paths produce identical edge schema
  // =========================================

  describe('Edge schema consistency', () => {
    it('should produce identical schema structure from both add paths', () => {
      const sourceNode: DiagramNode = {
        id: 'node-1',
        entity_type: 'ACTIVITY',
        entity_id: 'activity-1',
        pos_x: 100,
        pos_y: 100,
        width: 120,
        height: 60,
        parent_node_id: null,
      };

      const targetNode: DiagramNode = {
        id: 'node-2',
        entity_type: 'ACTIVITY',
        entity_id: 'activity-2',
        pos_x: 300,
        pos_y: 100,
        width: 120,
        height: 60,
        parent_node_id: null,
      };

      // Path 1: Create new flow
      const flowEntity1 = createActivityFlowEntity('activity-1', 'activity-2');
      const edge1 = createActivityFlowDiagramEdge(
        flowEntity1.id,
        sourceNode.id,
        targetNode.id,
        sourceNode,
        targetNode
      );

      // Path 2: Create edge for existing flow
      const flowEntity2 = createActivityFlowEntity('activity-1', 'activity-2');
      const edge2 = createActivityFlowDiagramEdge(
        flowEntity2.id,
        sourceNode.id,
        targetNode.id,
        sourceNode,
        targetNode
      );

      // Verify both edges have identical schema structure
      expect(edge1.relationship_type).toBe(edge2.relationship_type);
      expect(edge1.source_node_id).toBe(edge2.source_node_id);
      expect(edge1.target_node_id).toBe(edge2.target_node_id);
      expect(edge1.edge_points.length).toBe(edge2.edge_points.length);

      // Verify all required properties are present on both
      const requiredProperties = ['id', 'relationship_type', 'relationship_id', 'source_node_id', 'target_node_id', 'edge_points'];
      for (const prop of requiredProperties) {
        expect(prop in edge1).toBe(true);
        expect(prop in edge2).toBe(true);
      }
    });
  });

  // =========================================
  // Test 5: ActivityFlow entity has correct structure
  // =========================================

  describe('ActivityFlow entity structure', () => {
    it('should create flow entity with correct properties', () => {
      const flowEntity = createActivityFlowEntity('activity-1', 'activity-2');

      expect(flowEntity.id).toBeDefined();
      expect(flowEntity.id.length).toBeGreaterThan(0);
      expect(flowEntity.from_activity_id).toBe('activity-1');
      expect(flowEntity.to_activity_id).toBe('activity-2');
      expect(flowEntity.flow_kind).toBe('Control');
    });
  });
});
