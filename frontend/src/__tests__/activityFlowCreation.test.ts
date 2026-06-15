/**
 * Activity Flow Creation Tests
 * Task Group 1: Activity Flow Creation Utility Module
 *
 * Tests for the Activity Flow creation utility functions:
 * - Test 1: createActivityFlowEntity() creates entity with correct fields
 * - Test 2: createActivityFlowDiagramEdge() creates edge with proper structure
 * - Test 3: enterActivityFlowCreationMode() returns correct state
 * - Test 4: exitActivityFlowCreationMode() resets state properly
 * - Test 5: getActivityFlowModeHintText() returns correct hints for each state
 * - Test 6: isReadyForTargetActivity() returns correct boolean
 *
 * Updated for Spec 2026-01-01: Boundary-Anchored Edge Rendering
 * Edge points now use boundary coordinates instead of center coordinates.
 */

import { describe, it, expect } from 'vitest';
import { DiagramNode } from '../types/model';
import {
  ActivityFlowCreationMode,
  initialActivityFlowCreationMode,
  createActivityFlowEntity,
  createActivityFlowDiagramEdge,
  enterActivityFlowCreationMode,
  exitActivityFlowCreationMode,
  setActivityFlowSourceNode,
  isReadyForTargetActivity,
  getActivityFlowModeHintText,
} from '../utils/activityFlowCreation';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a mock DiagramNode for an Activity
 */
function createActivityNode(overrides?: Partial<DiagramNode>): DiagramNode {
  return {
    id: 'node-activity-1',
    entity_type: 'ACTIVITY',
    entity_id: 'activity-1',
    pos_x: 100,
    pos_y: 100,
    width: 140,
    height: 50,
    parent_node_id: null,
    ...overrides,
  };
}

// ============================================================================
// Test Suite
// ============================================================================

describe('Activity Flow Creation Utility Module', () => {
  /**
   * Test 1: createActivityFlowEntity() creates entity with correct fields
   */
  describe('createActivityFlowEntity', () => {
    it('should create ActivityFlow entity with correct from and to activity IDs', () => {
      const flow = createActivityFlowEntity('activity-1', 'activity-2');

      expect(flow.from_activity_id).toBe('activity-1');
      expect(flow.to_activity_id).toBe('activity-2');
    });

    it('should generate ID with flow prefix', () => {
      const flow = createActivityFlowEntity('activity-1', 'activity-2');

      expect(flow.id).toBeDefined();
      expect(flow.id.startsWith('flow-')).toBe(true);
    });

    it('should set flow_kind to Control by default', () => {
      const flow = createActivityFlowEntity('activity-1', 'activity-2');

      expect(flow.flow_kind).toBe('Control');
    });

    it('should initialize optional trigger and condition fields as undefined', () => {
      const flow = createActivityFlowEntity('activity-1', 'activity-2');

      expect(flow.trigger_ref_kind).toBeUndefined();
      expect(flow.trigger_ref_id).toBeUndefined();
      expect(flow.trigger_label_text).toBeUndefined();
      expect(flow.condition_ref_kind).toBeUndefined();
      expect(flow.condition_ref_id).toBeUndefined();
      expect(flow.condition_expression).toBeUndefined();
    });
  });

  /**
   * Test 2: createActivityFlowDiagramEdge() creates edge with proper structure
   */
  describe('createActivityFlowDiagramEdge', () => {
    it('should create DiagramEdge with correct relationship type and ID', () => {
      const sourceNode = createActivityNode({ id: 'node-activity-1', entity_id: 'activity-1' });
      const targetNode = createActivityNode({
        id: 'node-activity-2',
        entity_id: 'activity-2',
        pos_x: 300,
      });

      const edge = createActivityFlowDiagramEdge(
        'flow-123',
        sourceNode.id,
        targetNode.id,
        sourceNode,
        targetNode
      );

      expect(edge.relationship_type).toBe('ACTIVITY_FLOW');
      expect(edge.relationship_id).toBe('flow-123');
    });

    it('should set source and target node IDs correctly', () => {
      const sourceNode = createActivityNode({ id: 'node-activity-1', entity_id: 'activity-1' });
      const targetNode = createActivityNode({
        id: 'node-activity-2',
        entity_id: 'activity-2',
        pos_x: 300,
      });

      const edge = createActivityFlowDiagramEdge(
        'flow-123',
        sourceNode.id,
        targetNode.id,
        sourceNode,
        targetNode
      );

      expect(edge.source_node_id).toBe('node-activity-1');
      expect(edge.target_node_id).toBe('node-activity-2');
    });

    it('should generate edge ID with edge prefix', () => {
      const sourceNode = createActivityNode({ id: 'node-activity-1', entity_id: 'activity-1' });
      const targetNode = createActivityNode({
        id: 'node-activity-2',
        entity_id: 'activity-2',
        pos_x: 300,
      });

      const edge = createActivityFlowDiagramEdge(
        'flow-123',
        sourceNode.id,
        targetNode.id,
        sourceNode,
        targetNode
      );

      expect(edge.id).toBeDefined();
      expect(edge.id.startsWith('edge-')).toBe(true);
    });

    it('should calculate edge points at node boundaries (not centers)', () => {
      // Spec 2026-01-01: Edge points now use boundary coordinates
      const sourceNode = createActivityNode({
        id: 'node-activity-1',
        entity_id: 'activity-1',
        pos_x: 100,
        pos_y: 100,
        width: 140,
        height: 50,
      });
      const targetNode = createActivityNode({
        id: 'node-activity-2',
        entity_id: 'activity-2',
        pos_x: 300,
        pos_y: 100,
        width: 140,
        height: 50,
      });

      const edge = createActivityFlowDiagramEdge(
        'flow-123',
        sourceNode.id,
        targetNode.id,
        sourceNode,
        targetNode
      );

      // Source boundary (right edge): (100 + 140, 100 + 25) = (240, 125)
      expect(edge.edge_points[0].pos_x).toBe(240);
      expect(edge.edge_points[0].pos_y).toBe(125);

      // Target boundary (left edge): (300, 100 + 25) = (300, 125)
      expect(edge.edge_points[1].pos_x).toBe(300);
      expect(edge.edge_points[1].pos_y).toBe(125);
    });

    it('should create two edge points with correct sequence order', () => {
      const sourceNode = createActivityNode({ id: 'node-activity-1', entity_id: 'activity-1' });
      const targetNode = createActivityNode({
        id: 'node-activity-2',
        entity_id: 'activity-2',
        pos_x: 300,
      });

      const edge = createActivityFlowDiagramEdge(
        'flow-123',
        sourceNode.id,
        targetNode.id,
        sourceNode,
        targetNode
      );

      expect(edge.edge_points).toHaveLength(2);
      expect(edge.edge_points[0].sequence_order).toBe(0);
      expect(edge.edge_points[1].sequence_order).toBe(1);
    });
  });

  /**
   * Test 3: enterActivityFlowCreationMode() returns correct state
   */
  describe('enterActivityFlowCreationMode', () => {
    it('should return state with active set to true', () => {
      const mode = enterActivityFlowCreationMode();

      expect(mode.active).toBe(true);
    });

    it('should return state with sourceActivityNodeId set to null', () => {
      const mode = enterActivityFlowCreationMode();

      expect(mode.sourceActivityNodeId).toBeNull();
    });
  });

  /**
   * Test 4: exitActivityFlowCreationMode() resets state properly
   */
  describe('exitActivityFlowCreationMode', () => {
    it('should return state with active set to false', () => {
      const mode = exitActivityFlowCreationMode();

      expect(mode.active).toBe(false);
    });

    it('should return state with sourceActivityNodeId set to null', () => {
      const mode = exitActivityFlowCreationMode();

      expect(mode.sourceActivityNodeId).toBeNull();
    });

    it('should return same structure as initialActivityFlowCreationMode', () => {
      const mode = exitActivityFlowCreationMode();

      expect(mode).toEqual(initialActivityFlowCreationMode);
    });
  });

  /**
   * Test 5: getActivityFlowModeHintText() returns correct hints for each state
   */
  describe('getActivityFlowModeHintText', () => {
    it('should return empty string when mode is not active', () => {
      const mode: ActivityFlowCreationMode = {
        active: false,
        sourceActivityNodeId: null,
      };

      const hint = getActivityFlowModeHintText(mode);

      expect(hint).toBe('');
    });

    it('should return source selection hint when active and no source selected', () => {
      const mode: ActivityFlowCreationMode = {
        active: true,
        sourceActivityNodeId: null,
      };

      const hint = getActivityFlowModeHintText(mode);

      expect(hint).toBe('Click an activity to select as source. Press Escape to cancel.');
    });

    it('should return target selection hint when active and source is selected', () => {
      const mode: ActivityFlowCreationMode = {
        active: true,
        sourceActivityNodeId: 'node-activity-1',
      };

      const hint = getActivityFlowModeHintText(mode);

      expect(hint).toBe('Click another activity to create the flow. Press Escape to cancel.');
    });
  });

  /**
   * Test 6: isReadyForTargetActivity() returns correct boolean
   */
  describe('isReadyForTargetActivity', () => {
    it('should return false when mode is not active', () => {
      const mode: ActivityFlowCreationMode = {
        active: false,
        sourceActivityNodeId: null,
      };

      expect(isReadyForTargetActivity(mode)).toBe(false);
    });

    it('should return false when active but no source selected', () => {
      const mode: ActivityFlowCreationMode = {
        active: true,
        sourceActivityNodeId: null,
      };

      expect(isReadyForTargetActivity(mode)).toBe(false);
    });

    it('should return true when active and source is selected', () => {
      const mode: ActivityFlowCreationMode = {
        active: true,
        sourceActivityNodeId: 'node-activity-1',
      };

      expect(isReadyForTargetActivity(mode)).toBe(true);
    });
  });

  /**
   * Additional Tests: setActivityFlowSourceNode
   */
  describe('setActivityFlowSourceNode', () => {
    it('should set source node ID when mode is active and no source set', () => {
      const currentMode: ActivityFlowCreationMode = {
        active: true,
        sourceActivityNodeId: null,
      };

      const newMode = setActivityFlowSourceNode(currentMode, 'node-activity-1');

      expect(newMode.sourceActivityNodeId).toBe('node-activity-1');
      expect(newMode.active).toBe(true);
    });

    it('should not change mode when already has source set', () => {
      const currentMode: ActivityFlowCreationMode = {
        active: true,
        sourceActivityNodeId: 'node-activity-1',
      };

      const newMode = setActivityFlowSourceNode(currentMode, 'node-activity-2');

      expect(newMode.sourceActivityNodeId).toBe('node-activity-1');
    });

    it('should not change mode when not active', () => {
      const currentMode: ActivityFlowCreationMode = {
        active: false,
        sourceActivityNodeId: null,
      };

      const newMode = setActivityFlowSourceNode(currentMode, 'node-activity-1');

      expect(newMode.sourceActivityNodeId).toBeNull();
      expect(newMode.active).toBe(false);
    });
  });

  /**
   * Tests for initialActivityFlowCreationMode constant
   */
  describe('initialActivityFlowCreationMode', () => {
    it('should have active set to false', () => {
      expect(initialActivityFlowCreationMode.active).toBe(false);
    });

    it('should have sourceActivityNodeId set to null', () => {
      expect(initialActivityFlowCreationMode.sourceActivityNodeId).toBeNull();
    });
  });
});
