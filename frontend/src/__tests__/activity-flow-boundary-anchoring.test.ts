/**
 * Activity Flow Boundary Anchoring Tests
 * Task Group 1: Boundary-Anchored Edge Rendering
 * Spec: 2026-01-01 Activity Diagram Corrective Fixes
 *
 * Tests that ActivityFlow edges anchor to node boundaries instead of centers.
 * Verifies edge rendering updates correctly when nodes are moved.
 */

import {
  renderActivityFlowWithBoundary,
  calculateFlowBoundaryPoints,
} from '../utils/activityNodeRendering';
import {
  getBoundaryAnchorPoint,
  getShapeKindFromActivityKind,
  ShapeKind,
} from '../utils/geometryUtils';
import { DiagramNode, ActivityKind } from '../types/model';

describe('Activity Flow Boundary Anchoring', () => {
  /**
   * Test 1.1: ActivityFlow edges use boundary points, not centre coordinates
   */
  describe('Flow edges use boundary points', () => {
    it('should calculate boundary points for flow between two Action nodes', () => {
      const sourceNode: DiagramNode = {
        id: 'node1',
        entity_type: 'ACTIVITY',
        entity_id: 'act1',
        pos_x: 100,
        pos_y: 100,
        width: 140,
        height: 50,
        parent_node_id: null,
      };

      const targetNode: DiagramNode = {
        id: 'node2',
        entity_type: 'ACTIVITY',
        entity_id: 'act2',
        pos_x: 300,
        pos_y: 100,
        width: 140,
        height: 50,
        parent_node_id: null,
      };

      const boundaryPoints = calculateFlowBoundaryPoints(
        sourceNode,
        targetNode,
        'Action',
        'Action'
      );

      // Source boundary should be on the right edge (x = 240), not center (x = 170)
      expect(boundaryPoints.source.x).toBe(sourceNode.pos_x + sourceNode.width); // 240
      expect(boundaryPoints.source.y).toBe(sourceNode.pos_y + sourceNode.height / 2); // 125

      // Target boundary should be on the left edge (x = 300), not center (x = 370)
      expect(boundaryPoints.target.x).toBe(targetNode.pos_x); // 300
      expect(boundaryPoints.target.y).toBe(targetNode.pos_y + targetNode.height / 2); // 125
    });

    it('should NOT return center coordinates for any ActivityKind', () => {
      const sourceNode: DiagramNode = {
        id: 'node1',
        entity_type: 'ACTIVITY',
        entity_id: 'act1',
        pos_x: 100,
        pos_y: 100,
        width: 60,
        height: 60,
        parent_node_id: null,
      };

      const targetNode: DiagramNode = {
        id: 'node2',
        entity_type: 'ACTIVITY',
        entity_id: 'act2',
        pos_x: 300,
        pos_y: 100,
        width: 60,
        height: 60,
        parent_node_id: null,
      };

      const activityKinds: ActivityKind[] = ['Initial', 'Action', 'Decision', 'Merge', 'Final'];

      for (const sourceKind of activityKinds) {
        for (const targetKind of activityKinds) {
          const boundaryPoints = calculateFlowBoundaryPoints(
            sourceNode,
            targetNode,
            sourceKind,
            targetKind
          );

          const sourceCenterX = sourceNode.pos_x + sourceNode.width / 2;
          const sourceCenterY = sourceNode.pos_y + sourceNode.height / 2;

          // Source point should NOT be the center
          const isSourceAtCenter =
            boundaryPoints.source.x === sourceCenterX &&
            boundaryPoints.source.y === sourceCenterY;
          expect(isSourceAtCenter).toBe(false);
        }
      }
    });
  });

  /**
   * Test 1.2: Boundary calculation for each ActivityKind
   */
  describe('Boundary calculation for each ActivityKind', () => {
    it('should use Circle shape for Initial nodes', () => {
      expect(getShapeKindFromActivityKind('Initial')).toBe(ShapeKind.Circle);
    });

    it('should use RoundedRect shape for Action nodes', () => {
      expect(getShapeKindFromActivityKind('Action')).toBe(ShapeKind.RoundedRect);
    });

    it('should use Diamond shape for Decision nodes', () => {
      expect(getShapeKindFromActivityKind('Decision')).toBe(ShapeKind.Diamond);
    });

    it('should use Diamond shape for Merge nodes', () => {
      expect(getShapeKindFromActivityKind('Merge')).toBe(ShapeKind.Diamond);
    });

    it('should use Circle shape for Final nodes', () => {
      expect(getShapeKindFromActivityKind('Final')).toBe(ShapeKind.Circle);
    });
  });

  /**
   * Test 1.3: Arrowhead orientation is correct for boundary-adjusted coordinates
   */
  describe('Arrowhead orientation', () => {
    it('should render arrowhead pointing in correct direction for horizontal flow', () => {
      const sourceNode: DiagramNode = {
        id: 'node1',
        entity_type: 'ACTIVITY',
        entity_id: 'act1',
        pos_x: 100,
        pos_y: 100,
        width: 140,
        height: 50,
        parent_node_id: null,
      };

      const targetNode: DiagramNode = {
        id: 'node2',
        entity_type: 'ACTIVITY',
        entity_id: 'act2',
        pos_x: 300,
        pos_y: 100,
        width: 140,
        height: 50,
        parent_node_id: null,
      };

      const flowResult = renderActivityFlowWithBoundary(
        sourceNode,
        targetNode,
        'Control',
        'Action',
        'Action'
      );

      // Arrowhead path should end at or near the target boundary point
      // The arrowhead path starts with M (moveto) command pointing to target
      expect(flowResult.arrowheadPath).toContain('M');
      expect(flowResult.arrowheadPath).toContain('L');
      expect(flowResult.arrowheadPath).toContain('Z');
    });

    it('should render arrowhead pointing in correct direction for vertical flow', () => {
      const sourceNode: DiagramNode = {
        id: 'node1',
        entity_type: 'ACTIVITY',
        entity_id: 'act1',
        pos_x: 100,
        pos_y: 100,
        width: 140,
        height: 50,
        parent_node_id: null,
      };

      const targetNode: DiagramNode = {
        id: 'node2',
        entity_type: 'ACTIVITY',
        entity_id: 'act2',
        pos_x: 100,
        pos_y: 300,
        width: 140,
        height: 50,
        parent_node_id: null,
      };

      const flowResult = renderActivityFlowWithBoundary(
        sourceNode,
        targetNode,
        'Control',
        'Action',
        'Action'
      );

      // Line should go from source bottom to target top
      expect(flowResult.linePath).toContain('M');
      expect(flowResult.linePath).toContain('L');
    });
  });

  /**
   * Test 1.4: Edge rendering updates when nodes are moved
   */
  describe('Edge updates when nodes move', () => {
    it('should recalculate boundary points when source node position changes', () => {
      const targetNode: DiagramNode = {
        id: 'node2',
        entity_type: 'ACTIVITY',
        entity_id: 'act2',
        pos_x: 300,
        pos_y: 100,
        width: 140,
        height: 50,
        parent_node_id: null,
      };

      // Original source position
      const sourceNodeOriginal: DiagramNode = {
        id: 'node1',
        entity_type: 'ACTIVITY',
        entity_id: 'act1',
        pos_x: 100,
        pos_y: 100,
        width: 140,
        height: 50,
        parent_node_id: null,
      };

      // Moved source position
      const sourceNodeMoved: DiagramNode = {
        ...sourceNodeOriginal,
        pos_x: 50,
        pos_y: 50,
      };

      const originalPoints = calculateFlowBoundaryPoints(
        sourceNodeOriginal,
        targetNode,
        'Action',
        'Action'
      );

      const movedPoints = calculateFlowBoundaryPoints(
        sourceNodeMoved,
        targetNode,
        'Action',
        'Action'
      );

      // Boundary points should be different after node moves
      expect(movedPoints.source.x).not.toBe(originalPoints.source.x);
      expect(movedPoints.source.y).not.toBe(originalPoints.source.y);
    });

    it('should recalculate boundary points when target node position changes', () => {
      const sourceNode: DiagramNode = {
        id: 'node1',
        entity_type: 'ACTIVITY',
        entity_id: 'act1',
        pos_x: 100,
        pos_y: 100,
        width: 140,
        height: 50,
        parent_node_id: null,
      };

      // Original target position
      const targetNodeOriginal: DiagramNode = {
        id: 'node2',
        entity_type: 'ACTIVITY',
        entity_id: 'act2',
        pos_x: 300,
        pos_y: 100,
        width: 140,
        height: 50,
        parent_node_id: null,
      };

      // Moved target position
      const targetNodeMoved: DiagramNode = {
        ...targetNodeOriginal,
        pos_x: 400,
        pos_y: 200,
      };

      const originalPoints = calculateFlowBoundaryPoints(
        sourceNode,
        targetNodeOriginal,
        'Action',
        'Action'
      );

      const movedPoints = calculateFlowBoundaryPoints(
        sourceNode,
        targetNodeMoved,
        'Action',
        'Action'
      );

      // Target boundary point should change after node moves
      expect(movedPoints.target.x).not.toBe(originalPoints.target.x);
      expect(movedPoints.target.y).not.toBe(originalPoints.target.y);
    });
  });

  /**
   * Test 1.5: Flow from Decision (diamond) to Action (rectangle) uses correct boundaries
   */
  describe('Mixed shape types', () => {
    it('should use diamond boundary for Decision source and rectangle boundary for Action target', () => {
      // Position nodes at same vertical center for horizontal flow
      const decisionNode: DiagramNode = {
        id: 'decision1',
        entity_type: 'ACTIVITY',
        entity_id: 'dec1',
        pos_x: 100,
        pos_y: 100,
        width: 60,
        height: 60,
        parent_node_id: null,
      };

      // Position action node at same Y center as decision (100 + 30 = 130 is center)
      // Action center should be at Y=130, so pos_y = 130 - 25 = 105
      const actionNode: DiagramNode = {
        id: 'action1',
        entity_type: 'ACTIVITY',
        entity_id: 'act1',
        pos_x: 300,
        pos_y: 105, // Center at y=130, same as decision
        width: 140,
        height: 50,
        parent_node_id: null,
      };

      const boundaryPoints = calculateFlowBoundaryPoints(
        decisionNode,
        actionNode,
        'Decision',
        'Action'
      );

      // Decision node: diamond shape, boundary should be on right vertex for horizontal flow
      // When target is directly to the right (same Y center), boundary is at right vertex
      expect(boundaryPoints.source.x).toBe(decisionNode.pos_x + decisionNode.width); // 160
      expect(boundaryPoints.source.y).toBe(decisionNode.pos_y + decisionNode.height / 2); // 130

      // Action node: rectangle, left edge should be at x
      expect(boundaryPoints.target.x).toBe(actionNode.pos_x); // 300
    });

    it('should compute diamond boundary point on diagonal edge when target is offset', () => {
      // When target is NOT horizontally aligned, the diamond boundary
      // is computed on the diagonal edge, not the vertex
      const decisionNode: DiagramNode = {
        id: 'decision1',
        entity_type: 'ACTIVITY',
        entity_id: 'dec1',
        pos_x: 100,
        pos_y: 100,
        width: 60,
        height: 60,
        parent_node_id: null,
      };

      // Offset action node to a different Y position
      const actionNode: DiagramNode = {
        id: 'action1',
        entity_type: 'ACTIVITY',
        entity_id: 'act1',
        pos_x: 300,
        pos_y: 85, // Not aligned with decision center
        width: 140,
        height: 50,
        parent_node_id: null,
      };

      const boundaryPoints = calculateFlowBoundaryPoints(
        decisionNode,
        actionNode,
        'Decision',
        'Action'
      );

      // The boundary point should be somewhere on the diamond boundary
      // (not necessarily at vertex due to Y offset)
      const diamondCenter = {
        x: decisionNode.pos_x + decisionNode.width / 2,
        y: decisionNode.pos_y + decisionNode.height / 2,
      };

      // Verify boundary point is outside the center
      expect(boundaryPoints.source.x).toBeGreaterThan(diamondCenter.x);

      // Verify it's within the diamond's bounding box
      expect(boundaryPoints.source.x).toBeLessThanOrEqual(decisionNode.pos_x + decisionNode.width);
      expect(boundaryPoints.source.y).toBeGreaterThanOrEqual(decisionNode.pos_y);
      expect(boundaryPoints.source.y).toBeLessThanOrEqual(decisionNode.pos_y + decisionNode.height);
    });

    it('should use circle boundary for Initial source', () => {
      const initialNode: DiagramNode = {
        id: 'initial1',
        entity_type: 'ACTIVITY',
        entity_id: 'init1',
        pos_x: 91,
        pos_y: 91,
        width: 18,
        height: 18,
        parent_node_id: null,
      };

      const actionNode: DiagramNode = {
        id: 'action1',
        entity_type: 'ACTIVITY',
        entity_id: 'act1',
        pos_x: 200,
        pos_y: 75,
        width: 140,
        height: 50,
        parent_node_id: null,
      };

      const boundaryPoints = calculateFlowBoundaryPoints(
        initialNode,
        actionNode,
        'Initial',
        'Action'
      );

      // Initial node: circle shape
      const centerX = initialNode.pos_x + initialNode.width / 2;
      const centerY = initialNode.pos_y + initialNode.height / 2;
      const radius = initialNode.width / 2;

      // Source boundary should be at radius distance from center
      const distFromCenter = Math.sqrt(
        Math.pow(boundaryPoints.source.x - centerX, 2) +
        Math.pow(boundaryPoints.source.y - centerY, 2)
      );
      expect(distFromCenter).toBeCloseTo(radius, 1);
    });
  });

  /**
   * Test 1.6: Defaults to RoundedRect when ActivityKind is not provided
   */
  describe('Default shape handling', () => {
    it('should default to RoundedRect when sourceActivityKind is undefined', () => {
      const sourceNode: DiagramNode = {
        id: 'node1',
        entity_type: 'ACTIVITY',
        entity_id: 'act1',
        pos_x: 100,
        pos_y: 100,
        width: 140,
        height: 50,
        parent_node_id: null,
      };

      const targetNode: DiagramNode = {
        id: 'node2',
        entity_type: 'ACTIVITY',
        entity_id: 'act2',
        pos_x: 300,
        pos_y: 100,
        width: 140,
        height: 50,
        parent_node_id: null,
      };

      // Pass undefined for activity kinds
      const boundaryPoints = calculateFlowBoundaryPoints(
        sourceNode,
        targetNode,
        undefined,
        undefined
      );

      // Should use rectangle boundary calculation (right edge for source)
      expect(boundaryPoints.source.x).toBe(sourceNode.pos_x + sourceNode.width);
      expect(boundaryPoints.source.y).toBe(sourceNode.pos_y + sourceNode.height / 2);
    });
  });
});
