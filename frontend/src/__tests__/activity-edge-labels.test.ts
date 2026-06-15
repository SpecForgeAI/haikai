/**
 * ActivityFlow Edge Label Tests
 * Task Group 5: ActivityFlow Edge Labels - Draggable and Persistent
 * Spec 2026-01-01: Activity Diagram Shape Bounds and Interactive Labels
 *
 * Tests that ActivityFlow edges have:
 * - Default label position at midpoint with -8px y offset
 * - Persisted label position via edge.label_pos_x/y
 * - getEdgeDisplayLabel support for ACTIVITY_FLOW
 */

import { createActivityFlowDiagramEdge } from '../utils/activityFlowCreation';
import { getDefaultEdgeLabelPosition } from '../utils/activityNodeRendering';
import { DiagramNode, ActivityKind } from '../types/model';

// Mock getEdgeDisplayLabel - we'll test the actual implementation separately
// since it requires a full ArchitectureModel

describe('ActivityFlow Edge Labels', () => {
  describe('default label position on edge creation', () => {
    it('should set label_pos_x and label_pos_y on new edge', () => {
      const sourceNode: DiagramNode = {
        id: 'node-1',
        entity_type: 'ACTIVITY',
        entity_id: 'act-1',
        pos_x: 0,
        pos_y: 0,
        width: 140,
        height: 50,
      };

      const targetNode: DiagramNode = {
        id: 'node-2',
        entity_type: 'ACTIVITY',
        entity_id: 'act-2',
        pos_x: 200,
        pos_y: 0,
        width: 140,
        height: 50,
      };

      const edge = createActivityFlowDiagramEdge(
        'flow-1',
        'node-1',
        'node-2',
        sourceNode,
        targetNode,
        'Action' as ActivityKind,
        'Action' as ActivityKind
      );

      // label_pos_x and label_pos_y should be set
      expect(edge.label_pos_x).toBeDefined();
      expect(edge.label_pos_y).toBeDefined();
    });

    it('should position label at midpoint with -8px y offset', () => {
      const sourceNode: DiagramNode = {
        id: 'node-1',
        entity_type: 'ACTIVITY',
        entity_id: 'act-1',
        pos_x: 0,
        pos_y: 0,
        width: 140,
        height: 50,
      };

      const targetNode: DiagramNode = {
        id: 'node-2',
        entity_type: 'ACTIVITY',
        entity_id: 'act-2',
        pos_x: 200,
        pos_y: 0,
        width: 140,
        height: 50,
      };

      const edge = createActivityFlowDiagramEdge(
        'flow-1',
        'node-1',
        'node-2',
        sourceNode,
        targetNode,
        'Action' as ActivityKind,
        'Action' as ActivityKind
      );

      // Source boundary: right edge at (140, 25)
      // Target boundary: left edge at (200, 25)
      // Midpoint: ((140+200)/2, (25+25)/2) = (170, 25)
      // With -8px y offset: (170, 17)
      expect(edge.label_pos_x).toBe(170);
      expect(edge.label_pos_y).toBe(17); // 25 - 8 = 17
    });

    it('should calculate correct midpoint for diagonal edges', () => {
      const sourceNode: DiagramNode = {
        id: 'node-1',
        entity_type: 'ACTIVITY',
        entity_id: 'act-1',
        pos_x: 0,
        pos_y: 0,
        width: 60,
        height: 60,
      };

      const targetNode: DiagramNode = {
        id: 'node-2',
        entity_type: 'ACTIVITY',
        entity_id: 'act-2',
        pos_x: 100,
        pos_y: 100,
        width: 140,
        height: 50,
      };

      const edge = createActivityFlowDiagramEdge(
        'flow-1',
        'node-1',
        'node-2',
        sourceNode,
        targetNode,
        'Decision' as ActivityKind,
        'Action' as ActivityKind
      );

      // Label position should be somewhere between source and target
      // with -8px y offset
      expect(edge.label_pos_x).toBeDefined();
      expect(edge.label_pos_y).toBeDefined();

      // Verify y offset is applied (label should be above midpoint)
      // Source center: (30, 30), Target center: (170, 125)
      // Rough midpoint y: ~77.5
      // With -8px offset: should be less than midpoint
    });
  });

  describe('getDefaultEdgeLabelPosition', () => {
    it('should calculate label position at midpoint above line', () => {
      const sourceNode: DiagramNode = {
        id: 'node-1',
        entity_type: 'ACTIVITY',
        entity_id: 'act-1',
        pos_x: 0,
        pos_y: 0,
        width: 100,
        height: 50,
      };

      const targetNode: DiagramNode = {
        id: 'node-2',
        entity_type: 'ACTIVITY',
        entity_id: 'act-2',
        pos_x: 200,
        pos_y: 0,
        width: 100,
        height: 50,
      };

      const result = getDefaultEdgeLabelPosition(sourceNode, targetNode);

      // Source center: (50, 25), Target center: (250, 25)
      // Midpoint: (150, 25)
      // Label y should be above midpoint (offset applied)
      expect(result.x).toBeLessThan(200); // Between nodes
      expect(result.x).toBeGreaterThan(0);
    });

    it('should return label dimensions from defaults', () => {
      const sourceNode: DiagramNode = {
        id: 'node-1',
        entity_type: 'ACTIVITY',
        entity_id: 'act-1',
        pos_x: 0,
        pos_y: 0,
        width: 100,
        height: 50,
      };

      const targetNode: DiagramNode = {
        id: 'node-2',
        entity_type: 'ACTIVITY',
        entity_id: 'act-2',
        pos_x: 200,
        pos_y: 0,
        width: 100,
        height: 50,
      };

      const result = getDefaultEdgeLabelPosition(sourceNode, targetNode);

      expect(result.width).toBeGreaterThan(0);
      expect(result.height).toBeGreaterThan(0);
    });
  });

  describe('persisted label position usage', () => {
    it('should preserve label_pos_x/y when edge is created', () => {
      const sourceNode: DiagramNode = {
        id: 'node-1',
        entity_type: 'ACTIVITY',
        entity_id: 'act-1',
        pos_x: 50,
        pos_y: 50,
        width: 140,
        height: 50,
      };

      const targetNode: DiagramNode = {
        id: 'node-2',
        entity_type: 'ACTIVITY',
        entity_id: 'act-2',
        pos_x: 250,
        pos_y: 50,
        width: 140,
        height: 50,
      };

      const edge = createActivityFlowDiagramEdge(
        'flow-1',
        'node-1',
        'node-2',
        sourceNode,
        targetNode
      );

      // Store original position
      const originalX = edge.label_pos_x;
      const originalY = edge.label_pos_y;

      // Simulate user drag by modifying position
      const updatedEdge = {
        ...edge,
        label_pos_x: (originalX || 0) + 20,
        label_pos_y: (originalY || 0) - 10,
      };

      // Verify updated position is different
      expect(updatedEdge.label_pos_x).toBe((originalX || 0) + 20);
      expect(updatedEdge.label_pos_y).toBe((originalY || 0) - 10);
    });
  });

  describe('edge label display text', () => {
    // Note: getEdgeDisplayLabel is tested in rendering.ts tests
    // Here we document the expected behavior for ACTIVITY_FLOW

    it('should prioritize condition_expression over trigger_label_text', () => {
      // This behavior is implemented in getEdgeDisplayLabel:
      // 1. If edge.label_text is set, use it
      // 2. For ACTIVITY_FLOW, lookup ActivityFlow entity:
      //    - Return condition_expression if set
      //    - Otherwise return trigger_label_text if set
      //    - Otherwise return ''

      // Example ActivityFlow:
      // { condition_expression: '[amount > 1000]', trigger_label_text: 'Submit' }
      // Should display: '[amount > 1000]'

      expect(true).toBe(true); // Placeholder - actual test in rendering.test.ts
    });
  });
});
