/**
 * Activity Flow Creation Edge Cases Tests
 * Task Group 5: Test Review and Gap Analysis
 *
 * Strategic tests to fill critical gaps in Activity Flow creation coverage:
 * - Test 1: Multiple consecutive flow creations
 * - Test 2: Flow creation after Escape cancellation
 * - Test 3: Flow creation after button cancellation
 * - Test 4: Edge point IDs are unique
 * - Test 5: Flow creation with re-entry after completion
 * - Test 6: Source selection preserves mode active state
 */

import { describe, it, expect } from 'vitest';
import {
  ActivityFlowCreationMode,
  initialActivityFlowCreationMode,
  enterActivityFlowCreationMode,
  exitActivityFlowCreationMode,
  setActivityFlowSourceNode,
  isReadyForTargetActivity,
  createActivityFlowEntity,
  createActivityFlowDiagramEdge,
  getActivityFlowModeHintText,
} from '../utils/activityFlowCreation';
import { DiagramNode } from '../types/model';

// ============================================================================
// Test Helpers
// ============================================================================

const mockActivityNode1: DiagramNode = {
  id: 'node-activity-1',
  entity_type: 'ACTIVITY',
  entity_id: 'activity-1',
  pos_x: 100,
  pos_y: 100,
  width: 120,
  height: 60,
};

const mockActivityNode2: DiagramNode = {
  id: 'node-activity-2',
  entity_type: 'ACTIVITY',
  entity_id: 'activity-2',
  pos_x: 300,
  pos_y: 100,
  width: 120,
  height: 60,
};

const mockActivityNode3: DiagramNode = {
  id: 'node-activity-3',
  entity_type: 'ACTIVITY',
  entity_id: 'activity-3',
  pos_x: 500,
  pos_y: 100,
  width: 120,
  height: 60,
};

// ============================================================================
// Edge Case Tests
// ============================================================================

describe('Activity Flow Creation Edge Cases', () => {
  /**
   * Test 1: Multiple consecutive flow creations
   * Verifies that after creating one flow, the user can immediately create another.
   */
  describe('Multiple consecutive flow creations', () => {
    it('should allow creating multiple flows in sequence', () => {
      // First flow creation cycle
      let mode: ActivityFlowCreationMode = enterActivityFlowCreationMode();
      mode = setActivityFlowSourceNode(mode, mockActivityNode1.id);
      expect(isReadyForTargetActivity(mode)).toBe(true);

      // Create first flow
      const flow1 = createActivityFlowEntity(
        mockActivityNode1.entity_id,
        mockActivityNode2.entity_id
      );
      expect(flow1.id).toMatch(/^flow-/);

      // Exit mode after first flow
      mode = exitActivityFlowCreationMode();
      expect(mode.active).toBe(false);

      // Second flow creation cycle (consecutive)
      mode = enterActivityFlowCreationMode();
      expect(mode.active).toBe(true);
      expect(mode.sourceActivityNodeId).toBeNull();

      mode = setActivityFlowSourceNode(mode, mockActivityNode2.id);
      expect(mode.sourceActivityNodeId).toBe('node-activity-2');

      // Create second flow
      const flow2 = createActivityFlowEntity(
        mockActivityNode2.entity_id,
        mockActivityNode3.entity_id
      );
      expect(flow2.id).toMatch(/^flow-/);
      expect(flow2.id).not.toBe(flow1.id); // Unique IDs

      // Exit mode after second flow
      mode = exitActivityFlowCreationMode();
      expect(mode.active).toBe(false);
    });
  });

  /**
   * Test 2: Flow creation after Escape cancellation
   * Verifies that after pressing Escape to cancel, the user can re-enter mode and complete a flow.
   */
  describe('Flow creation after Escape cancellation', () => {
    it('should allow completing flow after Escape cancellation', () => {
      // Enter mode and select source
      let mode: ActivityFlowCreationMode = enterActivityFlowCreationMode();
      mode = setActivityFlowSourceNode(mode, mockActivityNode1.id);
      expect(mode.sourceActivityNodeId).toBe('node-activity-1');

      // Simulate Escape key press (cancellation)
      mode = exitActivityFlowCreationMode();
      expect(mode.active).toBe(false);
      expect(mode.sourceActivityNodeId).toBeNull();

      // Re-enter mode after cancellation
      mode = enterActivityFlowCreationMode();
      expect(mode.active).toBe(true);
      expect(mode.sourceActivityNodeId).toBeNull();

      // Complete the flow this time
      mode = setActivityFlowSourceNode(mode, mockActivityNode1.id);
      expect(isReadyForTargetActivity(mode)).toBe(true);

      const flow = createActivityFlowEntity(
        mockActivityNode1.entity_id,
        mockActivityNode2.entity_id
      );
      expect(flow.from_activity_id).toBe('activity-1');
      expect(flow.to_activity_id).toBe('activity-2');

      mode = exitActivityFlowCreationMode();
      expect(mode.active).toBe(false);
    });
  });

  /**
   * Test 3: Flow creation after button cancellation
   * Verifies the toggle pattern: enter -> cancel (button click) -> enter -> complete.
   */
  describe('Flow creation after button cancellation', () => {
    it('should allow completing flow after button toggle cancellation', () => {
      // Enter mode
      let mode: ActivityFlowCreationMode = enterActivityFlowCreationMode();
      expect(mode.active).toBe(true);

      // Cancel by clicking button again (toggle)
      mode = exitActivityFlowCreationMode();
      expect(mode.active).toBe(false);

      // Re-enter by clicking button
      mode = enterActivityFlowCreationMode();
      expect(mode.active).toBe(true);

      // Now complete the flow
      mode = setActivityFlowSourceNode(mode, mockActivityNode1.id);
      expect(isReadyForTargetActivity(mode)).toBe(true);

      const flow = createActivityFlowEntity(
        mockActivityNode1.entity_id,
        mockActivityNode2.entity_id
      );
      expect(flow.id).toMatch(/^flow-/);
    });
  });

  /**
   * Test 4: Edge point IDs are unique
   * Verifies that each edge point in a diagram edge has a unique ID.
   */
  describe('Edge point ID uniqueness', () => {
    it('should create edge points with unique IDs', () => {
      const edge = createActivityFlowDiagramEdge(
        'flow-test-123',
        mockActivityNode1.id,
        mockActivityNode2.id,
        mockActivityNode1,
        mockActivityNode2
      );

      // Both edge points should have IDs
      expect(edge.edge_points[0].id).toBeDefined();
      expect(edge.edge_points[1].id).toBeDefined();

      // Edge point IDs should be unique from each other
      expect(edge.edge_points[0].id).not.toBe(edge.edge_points[1].id);

      // Edge point IDs should have correct prefix
      expect(edge.edge_points[0].id).toMatch(/^ep-/);
      expect(edge.edge_points[1].id).toMatch(/^ep-/);
    });
  });

  /**
   * Test 5: Flow creation with re-entry after completion
   * Verifies that state is fully reset after flow completion.
   */
  describe('State reset after flow completion', () => {
    it('should fully reset state for next flow creation', () => {
      // Complete a flow
      let mode: ActivityFlowCreationMode = enterActivityFlowCreationMode();
      mode = setActivityFlowSourceNode(mode, mockActivityNode1.id);

      // Verify source is set
      expect(mode.sourceActivityNodeId).toBe('node-activity-1');

      // Exit (simulating completion)
      mode = exitActivityFlowCreationMode();

      // Verify full reset
      expect(mode).toEqual(initialActivityFlowCreationMode);
      expect(mode.active).toBe(false);
      expect(mode.sourceActivityNodeId).toBeNull();

      // Re-enter should start fresh
      mode = enterActivityFlowCreationMode();
      expect(mode.active).toBe(true);
      expect(mode.sourceActivityNodeId).toBeNull();

      // Hint should be for source selection, not target
      const hint = getActivityFlowModeHintText(mode);
      expect(hint).toBe('Click an activity to select as source. Press Escape to cancel.');
    });
  });

  /**
   * Test 6: Source selection preserves mode active state
   * Verifies that setting source does not change the active flag.
   */
  describe('Source selection state preservation', () => {
    it('should preserve active state when setting source', () => {
      let mode: ActivityFlowCreationMode = enterActivityFlowCreationMode();

      // Initial state
      expect(mode.active).toBe(true);
      expect(mode.sourceActivityNodeId).toBeNull();

      // Set source
      mode = setActivityFlowSourceNode(mode, mockActivityNode1.id);

      // Active state should be preserved
      expect(mode.active).toBe(true);
      expect(mode.sourceActivityNodeId).toBe('node-activity-1');

      // isReadyForTargetActivity should now be true
      expect(isReadyForTargetActivity(mode)).toBe(true);

      // Hint should update to target selection
      const hint = getActivityFlowModeHintText(mode);
      expect(hint).toBe('Click another activity to create the flow. Press Escape to cancel.');
    });
  });
});
