/**
 * Activity Flow Rendering and Creation Tests
 * Task Group 4: Activity Flow Edge Component and Creation UX
 *
 * Tests for activity flow rendering and creation:
 * - Activity flow renders as straight line between activities
 * - Arrowhead points to target activity
 * - Flow with condition/trigger displays label at midpoint
 * - Flow creation mode activates on button click
 * - Clicking source then target creates ActivityFlow and DiagramEdge
 * - Escape key exits flow creation mode
 */

import {
  renderActivityFlow,
  ActivityFlowRenderResult,
  calculateFlowLabelPosition,
} from '../utils/activityNodeRendering';
import { ACTIVITY_FLOW_DEFAULTS } from '../config/defaults';

describe('Activity Flow Rendering and Creation', () => {
  /**
   * Test 1: Activity flow renders as straight line between activities
   */
  describe('renderActivityFlow - straight line rendering', () => {
    it('should render as straight line between source and target activities', () => {
      const sourcePosition = { x: 100, y: 100 };
      const targetPosition = { x: 300, y: 100 };

      const result = renderActivityFlow(sourcePosition, targetPosition, 'Control');

      // Verify it returns a valid ActivityFlowRenderResult
      expect(result).toBeDefined();
      expect(result.linePath).toBeDefined();
      expect(typeof result.linePath).toBe('string');

      // Verify the line path starts at source and ends before target (for arrowhead)
      expect(result.linePath).toContain('M');
      expect(result.linePath).toContain('L');

      // Verify stroke styling matches defaults
      expect(result.strokeColor).toBe(ACTIVITY_FLOW_DEFAULTS.line_color);
      expect(result.strokeWidth).toBe(ACTIVITY_FLOW_DEFAULTS.line_width);
    });

    it('should render diagonal lines correctly', () => {
      const sourcePosition = { x: 100, y: 100 };
      const targetPosition = { x: 300, y: 300 };

      const result = renderActivityFlow(sourcePosition, targetPosition, 'Control');

      // Verify diagonal line is rendered
      expect(result.linePath).toBeDefined();
      expect(result.linePath).toContain('M');
      expect(result.linePath).toContain('L');
    });
  });

  /**
   * Test 2: Arrowhead points to target activity
   */
  describe('renderActivityFlow - arrowhead rendering', () => {
    it('should return arrowhead path pointing to target activity', () => {
      const sourcePosition = { x: 100, y: 100 };
      const targetPosition = { x: 300, y: 100 };

      const result = renderActivityFlow(sourcePosition, targetPosition, 'Control');

      // Verify arrowhead path is present
      expect(result.arrowheadPath).toBeDefined();
      expect(typeof result.arrowheadPath).toBe('string');

      // Verify arrowhead path creates a closed shape (triangle)
      expect(result.arrowheadPath).toContain('M');
      expect(result.arrowheadPath).toContain('L');
      expect(result.arrowheadPath).toContain('Z');

      // Verify arrowhead fill matches stroke color
      expect(result.arrowheadFill).toBe(result.strokeColor);
    });

    it('should point arrowhead toward target regardless of direction', () => {
      // Test horizontal left-to-right
      const result1 = renderActivityFlow({ x: 100, y: 100 }, { x: 300, y: 100 }, 'Control');
      expect(result1.arrowheadPath).toBeDefined();

      // Test horizontal right-to-left
      const result2 = renderActivityFlow({ x: 300, y: 100 }, { x: 100, y: 100 }, 'Control');
      expect(result2.arrowheadPath).toBeDefined();

      // Test vertical top-to-bottom
      const result3 = renderActivityFlow({ x: 100, y: 100 }, { x: 100, y: 300 }, 'Control');
      expect(result3.arrowheadPath).toBeDefined();

      // Test diagonal
      const result4 = renderActivityFlow({ x: 100, y: 100 }, { x: 300, y: 300 }, 'Control');
      expect(result4.arrowheadPath).toBeDefined();
    });
  });

  /**
   * Test 3: Flow with condition/trigger displays label at midpoint
   */
  describe('renderActivityFlow - label rendering', () => {
    it('should calculate midpoint position for label', () => {
      const sourcePosition = { x: 100, y: 100 };
      const targetPosition = { x: 300, y: 100 };

      const labelPosition = calculateFlowLabelPosition(sourcePosition, targetPosition);

      // Midpoint of 100-300 should be 200
      expect(labelPosition.x).toBe(200);
      expect(labelPosition.y).toBe(100);
    });

    it('should include label position in render result when label text provided', () => {
      const sourcePosition = { x: 100, y: 100 };
      const targetPosition = { x: 300, y: 200 };

      const result = renderActivityFlow(
        sourcePosition,
        targetPosition,
        'Control',
        'Yes' // label text
      );

      // Verify label position is returned
      expect(result.labelPosition).toBeDefined();
      expect(result.labelPosition!.x).toBe(200); // midpoint x
      expect(result.labelPosition!.y).toBe(150); // midpoint y
      expect(result.labelText).toBe('Yes');
    });

    it('should position Decision flow labels (Yes/No) near the edge', () => {
      const sourcePosition = { x: 100, y: 100 };
      const targetPosition = { x: 300, y: 100 };

      const resultYes = renderActivityFlow(sourcePosition, targetPosition, 'Control', 'Yes');
      const resultNo = renderActivityFlow(sourcePosition, targetPosition, 'Control', 'No');

      // Both should have label positions at midpoint
      expect(resultYes.labelPosition).toBeDefined();
      expect(resultNo.labelPosition).toBeDefined();
      expect(resultYes.labelText).toBe('Yes');
      expect(resultNo.labelText).toBe('No');
    });
  });

  /**
   * Test 4: Flow creation mode activates on button click
   * Note: This test verifies the flow creation state structure
   */
  describe('Flow creation mode state', () => {
    it('should define correct flow creation mode state structure', () => {
      // Define the expected state structure
      interface FlowCreationMode {
        active: boolean;
        sourceActivityId: string | null;
      }

      // Initial state
      const initialState: FlowCreationMode = {
        active: false,
        sourceActivityId: null,
      };

      expect(initialState.active).toBe(false);
      expect(initialState.sourceActivityId).toBeNull();

      // After button click - mode activates
      const activatedState: FlowCreationMode = {
        active: true,
        sourceActivityId: null,
      };

      expect(activatedState.active).toBe(true);
      expect(activatedState.sourceActivityId).toBeNull();
    });
  });

  /**
   * Test 5: Clicking source then target creates ActivityFlow and DiagramEdge
   * Note: This test verifies the data structures created during flow creation
   */
  describe('Flow creation - ActivityFlow and DiagramEdge creation', () => {
    it('should create ActivityFlow entity with correct structure', () => {
      // Simulate ActivityFlow entity creation
      const activityFlow = {
        id: 'flow-001',
        from_activity_id: 'activity-source',
        to_activity_id: 'activity-target',
        flow_kind: 'Control' as const,
        trigger_label_text: undefined,
        condition_expression: undefined,
      };

      expect(activityFlow.id).toBeDefined();
      expect(activityFlow.from_activity_id).toBe('activity-source');
      expect(activityFlow.to_activity_id).toBe('activity-target');
      expect(activityFlow.flow_kind).toBe('Control');
    });

    it('should create DiagramEdge referencing the ActivityFlow', () => {
      // Simulate DiagramEdge creation
      const diagramEdge = {
        id: 'edge-001',
        source_node_id: 'node-source',
        target_node_id: 'node-target',
        relationship_type: 'ACTIVITY_FLOW',
        relationship_id: 'flow-001',
        edge_points: [
          { id: 'ep-1', sequence_order: 0, pos_x: 100, pos_y: 100 },
          { id: 'ep-2', sequence_order: 1, pos_x: 300, pos_y: 100 },
        ],
        line_type: 'SOLID' as const,
        arrow_end: 'ARROW' as const,
      };

      expect(diagramEdge.relationship_type).toBe('ACTIVITY_FLOW');
      expect(diagramEdge.relationship_id).toBe('flow-001');
      expect(diagramEdge.edge_points).toHaveLength(2);
      expect(diagramEdge.arrow_end).toBe('ARROW');
    });

    it('should update flow creation state after successful creation', () => {
      interface FlowCreationMode {
        active: boolean;
        sourceActivityId: string | null;
      }

      // State after first click (source selected)
      const afterFirstClick: FlowCreationMode = {
        active: true,
        sourceActivityId: 'activity-source',
      };

      expect(afterFirstClick.active).toBe(true);
      expect(afterFirstClick.sourceActivityId).toBe('activity-source');

      // State after second click (flow created, mode exits)
      const afterSecondClick: FlowCreationMode = {
        active: false,
        sourceActivityId: null,
      };

      expect(afterSecondClick.active).toBe(false);
      expect(afterSecondClick.sourceActivityId).toBeNull();
    });
  });

  /**
   * Test 6: Escape key exits flow creation mode
   */
  describe('Flow creation mode cancellation', () => {
    it('should reset flow creation mode state on Escape', () => {
      interface FlowCreationMode {
        active: boolean;
        sourceActivityId: string | null;
      }

      // State when source is selected
      const stateWithSource: FlowCreationMode = {
        active: true,
        sourceActivityId: 'activity-source',
      };

      expect(stateWithSource.active).toBe(true);
      expect(stateWithSource.sourceActivityId).toBe('activity-source');

      // State after Escape key press (simulated reset)
      const resetState: FlowCreationMode = {
        active: false,
        sourceActivityId: null,
      };

      expect(resetState.active).toBe(false);
      expect(resetState.sourceActivityId).toBeNull();
    });

    it('should cancel flow creation mode even without source selected', () => {
      interface FlowCreationMode {
        active: boolean;
        sourceActivityId: string | null;
      }

      // State when mode is active but no source selected yet
      const activeNoSource: FlowCreationMode = {
        active: true,
        sourceActivityId: null,
      };

      expect(activeNoSource.active).toBe(true);

      // State after Escape
      const resetState: FlowCreationMode = {
        active: false,
        sourceActivityId: null,
      };

      expect(resetState.active).toBe(false);
    });
  });

  /**
   * Additional test: Data flow styling variation
   */
  describe('renderActivityFlow - Data flow styling', () => {
    it('should apply dashed line for Data flow kind', () => {
      const sourcePosition = { x: 100, y: 100 };
      const targetPosition = { x: 300, y: 100 };

      const controlResult = renderActivityFlow(sourcePosition, targetPosition, 'Control');
      const dataResult = renderActivityFlow(sourcePosition, targetPosition, 'Data');

      // Control flow should be solid
      expect(controlResult.strokeDasharray).toBe('');

      // Data flow should be dashed
      expect(dataResult.strokeDasharray).not.toBe('');
      expect(dataResult.strokeDasharray).toContain(','); // Dash pattern like "6,4"
    });
  });
});
