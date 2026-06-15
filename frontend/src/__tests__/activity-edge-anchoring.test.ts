/**
 * Activity Diagram UX Fixes - Task Group 2: Edge Boundary Anchoring Tests
 * Spec 2026-01-01: Correct edge anchoring to shape boundaries
 *
 * Tests that ActivityFlow edges correctly anchor at visible shape boundaries
 * for all activity node types: Action (rounded-rect), Decision/Merge (diamond),
 * Initial/Final (circle).
 */

import {
  getRectangleBoundaryPoint,
  getDiamondBoundaryPoint,
  getCircleBoundaryPoint,
  getBoundaryAnchorPoint,
  getShapeKindFromActivityKind,
  ShapeKind,
  Rect,
} from '../utils/geometryUtils';
import { ActivityKind } from '../types/model';

describe('Task Group 2: Edge Boundary Anchoring', () => {
  describe('getShapeKindFromActivityKind mapping', () => {
    it('should map Initial to Circle', () => {
      expect(getShapeKindFromActivityKind('Initial')).toBe(ShapeKind.Circle);
    });

    it('should map Final to Circle', () => {
      expect(getShapeKindFromActivityKind('Final')).toBe(ShapeKind.Circle);
    });

    it('should map Decision to Diamond', () => {
      expect(getShapeKindFromActivityKind('Decision')).toBe(ShapeKind.Diamond);
    });

    it('should map Merge to Diamond', () => {
      expect(getShapeKindFromActivityKind('Merge')).toBe(ShapeKind.Diamond);
    });

    it('should map Action to RoundedRect', () => {
      expect(getShapeKindFromActivityKind('Action')).toBe(ShapeKind.RoundedRect);
    });
  });

  describe('getRectangleBoundaryPoint - Action nodes', () => {
    const actionRect: Rect = { x: 100, y: 100, width: 140, height: 50 };

    it('should anchor at right edge when target is to the right', () => {
      const target = { x: 300, y: 125 }; // Target to the right, same vertical level
      const point = getRectangleBoundaryPoint(actionRect, target);

      // Should be on right edge (x = 100 + 140 = 240)
      expect(point.x).toBeCloseTo(240, 0);
      expect(point.y).toBeCloseTo(125, 0); // Center Y
    });

    it('should anchor at left edge when target is to the left', () => {
      const target = { x: 50, y: 125 }; // Target to the left
      const point = getRectangleBoundaryPoint(actionRect, target);

      // Should be on left edge (x = 100)
      expect(point.x).toBeCloseTo(100, 0);
      expect(point.y).toBeCloseTo(125, 0);
    });

    it('should anchor at bottom edge when target is below', () => {
      const target = { x: 170, y: 200 }; // Target below
      const point = getRectangleBoundaryPoint(actionRect, target);

      // Should be on bottom edge (y = 100 + 50 = 150)
      expect(point.y).toBeCloseTo(150, 0);
    });

    it('should anchor at top edge when target is above', () => {
      const target = { x: 170, y: 50 }; // Target above
      const point = getRectangleBoundaryPoint(actionRect, target);

      // Should be on top edge (y = 100)
      expect(point.y).toBeCloseTo(100, 0);
    });
  });

  describe('getDiamondBoundaryPoint - Decision/Merge nodes', () => {
    const diamondRect: Rect = { x: 100, y: 100, width: 60, height: 60 };
    // Diamond center: (130, 130)
    // Diamond vertices: top(130, 100), right(160, 130), bottom(130, 160), left(100, 130)

    it('should anchor at right vertex when target is directly right', () => {
      const target = { x: 300, y: 130 }; // Directly to the right
      const point = getDiamondBoundaryPoint(diamondRect, target);

      // Should be on right vertex (x = 160, y = 130)
      expect(point.x).toBeCloseTo(160, 0);
      expect(point.y).toBeCloseTo(130, 0);
    });

    it('should anchor at bottom vertex when target is directly below', () => {
      const target = { x: 130, y: 300 }; // Directly below
      const point = getDiamondBoundaryPoint(diamondRect, target);

      // Should be on bottom vertex (x = 130, y = 160)
      expect(point.x).toBeCloseTo(130, 0);
      expect(point.y).toBeCloseTo(160, 0);
    });

    it('should anchor on diagonal edge for diagonal targets', () => {
      const target = { x: 200, y: 80 }; // Upper-right diagonal
      const point = getDiamondBoundaryPoint(diamondRect, target);

      // Point should be on the top-right edge of the diamond
      // The top-right edge goes from (130, 100) to (160, 130)
      // Point should be somewhere on this edge
      expect(point.x).toBeGreaterThan(130);
      expect(point.x).toBeLessThanOrEqual(160);
      expect(point.y).toBeGreaterThanOrEqual(100);
      expect(point.y).toBeLessThan(130);
    });
  });

  describe('getCircleBoundaryPoint - Initial/Final nodes', () => {
    const circleRect: Rect = { x: 100, y: 100, width: 20, height: 20 };
    // Circle center: (110, 110), radius: 10

    it('should anchor at rightmost point when target is directly right', () => {
      const target = { x: 200, y: 110 }; // Directly to the right
      const point = getCircleBoundaryPoint(circleRect, target);

      // Should be on circle perimeter at (120, 110)
      expect(point.x).toBeCloseTo(120, 0);
      expect(point.y).toBeCloseTo(110, 0);
    });

    it('should anchor at topmost point when target is directly above', () => {
      const target = { x: 110, y: 50 }; // Directly above
      const point = getCircleBoundaryPoint(circleRect, target);

      // Should be on circle perimeter at (110, 100)
      expect(point.x).toBeCloseTo(110, 0);
      expect(point.y).toBeCloseTo(100, 0);
    });

    it('should anchor on perimeter for diagonal targets', () => {
      const target = { x: 200, y: 200 }; // Bottom-right diagonal
      const point = getCircleBoundaryPoint(circleRect, target);

      // Point should be on circle perimeter at 45 degrees
      // Distance from center (110, 110) to point should equal radius (10)
      const distX = point.x - 110;
      const distY = point.y - 110;
      const distance = Math.sqrt(distX * distX + distY * distY);
      expect(distance).toBeCloseTo(10, 0);
    });
  });

  describe('getBoundaryAnchorPoint dispatcher', () => {
    const sourceRect: Rect = { x: 100, y: 100, width: 60, height: 60 };
    const targetRect: Rect = { x: 300, y: 100, width: 60, height: 60 };

    it('should dispatch to rectangle calculation for RoundedRect', () => {
      const point = getBoundaryAnchorPoint(sourceRect, targetRect, ShapeKind.RoundedRect);
      // Should be on right edge (x = 160)
      expect(point.x).toBeCloseTo(160, 0);
    });

    it('should dispatch to diamond calculation for Diamond', () => {
      const point = getBoundaryAnchorPoint(sourceRect, targetRect, ShapeKind.Diamond);
      // Should be on right vertex (x = 160)
      expect(point.x).toBeCloseTo(160, 0);
    });

    it('should dispatch to circle calculation for Circle', () => {
      const point = getBoundaryAnchorPoint(sourceRect, targetRect, ShapeKind.Circle);
      // Should be on circle perimeter
      const center = { x: 130, y: 130 };
      const radius = 30;
      const distX = point.x - center.x;
      const distY = point.y - center.y;
      const distance = Math.sqrt(distX * distX + distY * distY);
      expect(distance).toBeCloseTo(radius, 0);
    });
  });

  describe('Edge endpoints use boundary points', () => {
    it('should compute anchor at shape boundary, not node center', () => {
      // Create two nodes with centers 200px apart
      const sourceRect: Rect = { x: 0, y: 50, width: 100, height: 60 };
      const targetRect: Rect = { x: 200, y: 50, width: 100, height: 60 };

      const sourcePoint = getBoundaryAnchorPoint(sourceRect, targetRect, ShapeKind.RoundedRect);
      const targetPoint = getBoundaryAnchorPoint(targetRect, sourceRect, ShapeKind.RoundedRect);

      // Source should be at right edge (x = 100), not center (x = 50)
      expect(sourcePoint.x).toBeCloseTo(100, 0);
      // Target should be at left edge (x = 200), not center (x = 250)
      expect(targetPoint.x).toBeCloseTo(200, 0);
    });
  });
});
