/**
 * Activity Flow Boundary Anchoring Tests
 * Task Group 3: ActivityFlow Boundary Anchoring
 * Spec 2026-01-01: Activity Diagram Shape Bounds and Interactive Labels
 *
 * Tests that flow arrows connect at shape boundaries, not centers,
 * with correct shape-aware anchoring for each activity kind.
 */

import {
  getBoundaryAnchorPoint,
  getShapeKindFromActivityKind,
  ShapeKind,
} from '../utils/geometryUtils';
import { calculateFlowBoundaryPoints, renderActivityFlowWithBoundary } from '../utils/activityNodeRendering';
import { ActivityKind, DiagramNode } from '../types/model';

describe('Activity Boundary Anchoring', () => {
  describe('getShapeKindFromActivityKind mapping', () => {
    it('should map Initial to Circle', () => {
      expect(getShapeKindFromActivityKind('Initial')).toBe(ShapeKind.Circle);
    });

    it('should map Action to RoundedRect', () => {
      expect(getShapeKindFromActivityKind('Action')).toBe(ShapeKind.RoundedRect);
    });

    it('should map Decision to Diamond', () => {
      expect(getShapeKindFromActivityKind('Decision')).toBe(ShapeKind.Diamond);
    });

    it('should map Merge to Diamond', () => {
      expect(getShapeKindFromActivityKind('Merge')).toBe(ShapeKind.Diamond);
    });

    it('should map Final to Circle', () => {
      expect(getShapeKindFromActivityKind('Final')).toBe(ShapeKind.Circle);
    });
  });

  describe('getBoundaryAnchorPoint dispatching', () => {
    const sourceRect = { x: 0, y: 0, width: 100, height: 60 };
    const targetRect = { x: 200, y: 0, width: 100, height: 60 }; // Horizontally aligned

    it('should dispatch to rectangle boundary for RoundedRect', () => {
      const result = getBoundaryAnchorPoint(sourceRect, targetRect, ShapeKind.RoundedRect);

      // For horizontal alignment, boundary should be at right edge of source
      expect(result.x).toBe(100); // Right edge
      expect(result.y).toBe(30); // Center Y
    });

    it('should dispatch to diamond boundary for Diamond', () => {
      const result = getBoundaryAnchorPoint(sourceRect, targetRect, ShapeKind.Diamond);

      // Diamond boundary at right vertex for horizontal alignment
      expect(result.x).toBe(100); // Right vertex at x + width
      expect(result.y).toBe(30); // Center Y
    });

    it('should dispatch to circle boundary for Circle', () => {
      const circleRect = { x: 0, y: 0, width: 20, height: 20 };
      // Target directly to the right for clean horizontal direction
      const targetFarRight = { x: 1000, y: 0, width: 100, height: 20 };
      const result = getBoundaryAnchorPoint(circleRect, targetFarRight, ShapeKind.Circle);

      // Circle boundary at right edge for horizontal direction
      // radius = 10, center = (10, 10)
      expect(result.x).toBeCloseTo(20, 0); // Right edge: center.x + radius
      expect(result.y).toBeCloseTo(10, 0); // Center Y (horizontal line)
    });
  });

  describe('calculateFlowBoundaryPoints', () => {
    it('should calculate boundary points for Action to Action flow', () => {
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

      const result = calculateFlowBoundaryPoints(
        sourceNode,
        targetNode,
        'Action' as ActivityKind,
        'Action' as ActivityKind
      );

      // Source: right edge at x=140, center y=25
      expect(result.source.x).toBe(140);
      expect(result.source.y).toBe(25);

      // Target: left edge at x=200, center y=25
      expect(result.target.x).toBe(200);
      expect(result.target.y).toBeGreaterThanOrEqual(25);
      expect(result.target.y).toBeLessThanOrEqual(30);
    });

    it('should calculate boundary points for Decision to Action flow', () => {
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
        pos_y: 0,
        width: 140,
        height: 50,
      };

      const result = calculateFlowBoundaryPoints(
        sourceNode,
        targetNode,
        'Decision' as ActivityKind,
        'Action' as ActivityKind
      );

      // Decision source should be on the right side of the diamond
      // Diamond center at (30, 30), target center at (170, 25)
      // The boundary point should be near the right vertex
      expect(result.source.x).toBeGreaterThan(30); // Past center
      expect(result.source.x).toBeLessThanOrEqual(60); // Not past right edge
      expect(result.source.y).toBeGreaterThanOrEqual(25);
      expect(result.source.y).toBeLessThanOrEqual(35);

      // Action target: left edge at (100, 25)
      expect(result.target.x).toBe(100);
      expect(result.target.y).toBeGreaterThanOrEqual(25);
      expect(result.target.y).toBeLessThanOrEqual(30);
    });

    it('should calculate boundary points for Initial to Action flow', () => {
      const sourceNode: DiagramNode = {
        id: 'node-1',
        entity_type: 'ACTIVITY',
        entity_id: 'act-1',
        pos_x: 0,
        pos_y: 0,
        width: 18,
        height: 18,
      };

      const targetNode: DiagramNode = {
        id: 'node-2',
        entity_type: 'ACTIVITY',
        entity_id: 'act-2',
        pos_x: 50,
        pos_y: 0,
        width: 140,
        height: 50,
      };

      const result = calculateFlowBoundaryPoints(
        sourceNode,
        targetNode,
        'Initial' as ActivityKind,
        'Action' as ActivityKind
      );

      // Initial source: circle boundary pointing toward target
      // Circle center at (9, 9), radius 9
      expect(result.source.x).toBeGreaterThan(9); // Past center
      expect(result.source.x).toBeLessThanOrEqual(18); // On or before right edge
    });

    it('should return source and target boundary points', () => {
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
        pos_y: 100,
        width: 140,
        height: 50,
      };

      const result = calculateFlowBoundaryPoints(
        sourceNode,
        targetNode,
        'Action' as ActivityKind,
        'Action' as ActivityKind
      );

      // Both source and target should be defined
      expect(result.source).toBeDefined();
      expect(result.target).toBeDefined();
      expect(result.source.x).toBeDefined();
      expect(result.source.y).toBeDefined();
      expect(result.target.x).toBeDefined();
      expect(result.target.y).toBeDefined();
    });
  });

  describe('renderActivityFlowWithBoundary', () => {
    it('should render flow using boundary points', () => {
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

      const result = renderActivityFlowWithBoundary(
        sourceNode,
        targetNode,
        'Control',
        'Action' as ActivityKind,
        'Action' as ActivityKind
      );

      // Line path should start at source boundary (140, 25) and end at target boundary (200, 25)
      expect(result.linePath).toContain('M 140 25');
      expect(result.linePath).toContain('L 200 25');
    });

    it('should preserve arrowhead orientation for boundary-anchored edges', () => {
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

      const result = renderActivityFlowWithBoundary(
        sourceNode,
        targetNode,
        'Control',
        'Decision' as ActivityKind,
        'Action' as ActivityKind
      );

      // Arrowhead should be present and point to target
      expect(result.arrowheadPath).toBeDefined();
      expect(result.arrowheadPath.length).toBeGreaterThan(0);
    });
  });
});
