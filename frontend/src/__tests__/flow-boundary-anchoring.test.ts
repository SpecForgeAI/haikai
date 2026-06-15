/**
 * Flow Boundary Anchoring Tests
 * Task Group 3: Flow Boundary Anchoring (A2)
 *
 * Tests for boundary anchor point calculations:
 * - Boundary point calculation for rounded rectangles (Action nodes)
 * - Boundary point calculation for diamonds (Decision/Merge nodes)
 * - Boundary point calculation for circles (Initial/Final nodes)
 * - Flow arrows connect at shape boundaries, not centers
 * - Arrowhead orientation based on edge direction
 */

import {
  ShapeKind,
  getBoundaryAnchorPoint,
  getRectangleBoundaryPoint,
  getDiamondBoundaryPoint,
  getCircleBoundaryPoint,
  getShapeKindFromActivityKind,
} from '../utils/geometryUtils';
import { ACTIVITY_NODE_DEFAULTS } from '../config/defaults';
import { ActivityKind } from '../types/model';

describe('Flow Boundary Anchoring', () => {
  /**
   * Test 1: Boundary point calculation for rounded rectangles (Action nodes)
   */
  describe('getRectangleBoundaryPoint', () => {
    it('should calculate boundary point on right edge when target is to the right', () => {
      // Source rect with center at (170, 125)
      const sourceRect = { x: 100, y: 100, width: 140, height: 50 };
      // Target directly to the right at same Y level
      const targetCenter = { x: 300, y: 125 };

      const result = getRectangleBoundaryPoint(sourceRect, targetCenter);

      // Target is directly to the right, so boundary should be on right edge
      expect(result.x).toBe(sourceRect.x + sourceRect.width); // 240
      expect(result.y).toBe(sourceRect.y + sourceRect.height / 2); // 125
    });

    it('should calculate boundary point on left edge when target is to the left', () => {
      // Source rect with center at (270, 125)
      const sourceRect = { x: 200, y: 100, width: 140, height: 50 };
      // Target directly to the left at same Y level
      const targetCenter = { x: 50, y: 125 };

      const result = getRectangleBoundaryPoint(sourceRect, targetCenter);

      // Target is directly to the left, so boundary should be on left edge
      expect(result.x).toBe(sourceRect.x); // 200
      expect(result.y).toBe(sourceRect.y + sourceRect.height / 2); // 125
    });

    it('should calculate boundary point on top edge when target is above', () => {
      // Source rect with center at (170, 225)
      const sourceRect = { x: 100, y: 200, width: 140, height: 50 };
      // Target directly above at same X level
      const targetCenter = { x: 170, y: 50 };

      const result = getRectangleBoundaryPoint(sourceRect, targetCenter);

      // Target is directly above, so boundary should be on top edge
      expect(result.y).toBe(sourceRect.y); // 200
      expect(result.x).toBe(sourceRect.x + sourceRect.width / 2); // 170
    });

    it('should calculate boundary point on bottom edge when target is below', () => {
      // Source rect with center at (170, 125)
      const sourceRect = { x: 100, y: 100, width: 140, height: 50 };
      // Target directly below at same X level
      const targetCenter = { x: 170, y: 300 };

      const result = getRectangleBoundaryPoint(sourceRect, targetCenter);

      // Target is directly below, so boundary should be on bottom edge
      expect(result.y).toBe(sourceRect.y + sourceRect.height); // 150
      expect(result.x).toBe(sourceRect.x + sourceRect.width / 2); // 170
    });

    it('should calculate boundary point for diagonal approach (corner case)', () => {
      const sourceRect = { x: 100, y: 100, width: 140, height: 50 };
      const targetCenter = { x: 300, y: 300 };

      const result = getRectangleBoundaryPoint(sourceRect, targetCenter);

      // Boundary point should be on the edge, not inside the rectangle
      const sourceCenter = {
        x: sourceRect.x + sourceRect.width / 2,
        y: sourceRect.y + sourceRect.height / 2,
      };

      // The boundary point should be between center and edge
      const distFromCenter = Math.sqrt(
        Math.pow(result.x - sourceCenter.x, 2) + Math.pow(result.y - sourceCenter.y, 2)
      );
      expect(distFromCenter).toBeGreaterThan(0);

      // Verify point is on or near the boundary
      const isOnLeftRight = Math.abs(result.x - sourceRect.x) < 0.01 ||
                            Math.abs(result.x - (sourceRect.x + sourceRect.width)) < 0.01;
      const isOnTopBottom = Math.abs(result.y - sourceRect.y) < 0.01 ||
                            Math.abs(result.y - (sourceRect.y + sourceRect.height)) < 0.01;
      expect(isOnLeftRight || isOnTopBottom).toBe(true);
    });
  });

  /**
   * Test 2: Boundary point calculation for diamonds (Decision/Merge nodes)
   */
  describe('getDiamondBoundaryPoint', () => {
    it('should calculate boundary point on right vertex when target is to the right', () => {
      // Diamond with center at (130, 130)
      const diamondRect = { x: 100, y: 100, width: 60, height: 60 };
      // Target directly to the right at same Y level
      const targetCenter = { x: 300, y: 130 };

      const result = getDiamondBoundaryPoint(diamondRect, targetCenter);

      // Target is to the right, boundary should be at right vertex
      // Diamond right vertex is at x + width, y + height/2
      expect(result.x).toBe(diamondRect.x + diamondRect.width); // 160
      expect(result.y).toBe(diamondRect.y + diamondRect.height / 2); // 130
    });

    it('should calculate boundary point on left vertex when target is to the left', () => {
      // Diamond with center at (230, 130)
      const diamondRect = { x: 200, y: 100, width: 60, height: 60 };
      // Target directly to the left at same Y level
      const targetCenter = { x: 50, y: 130 };

      const result = getDiamondBoundaryPoint(diamondRect, targetCenter);

      // Target is to the left, boundary should be at left vertex
      expect(result.x).toBe(diamondRect.x); // 200
      expect(result.y).toBe(diamondRect.y + diamondRect.height / 2); // 130
    });

    it('should calculate boundary point on top vertex when target is above', () => {
      // Diamond with center at (130, 230)
      const diamondRect = { x: 100, y: 200, width: 60, height: 60 };
      // Target directly above at same X level
      const targetCenter = { x: 130, y: 50 };

      const result = getDiamondBoundaryPoint(diamondRect, targetCenter);

      // Target is above, boundary should be at top vertex
      expect(result.x).toBe(diamondRect.x + diamondRect.width / 2); // 130
      expect(result.y).toBe(diamondRect.y); // 200
    });

    it('should calculate boundary point on bottom vertex when target is below', () => {
      // Diamond with center at (130, 130)
      const diamondRect = { x: 100, y: 100, width: 60, height: 60 };
      // Target directly below at same X level
      const targetCenter = { x: 130, y: 300 };

      const result = getDiamondBoundaryPoint(diamondRect, targetCenter);

      // Target is below, boundary should be at bottom vertex
      expect(result.x).toBe(diamondRect.x + diamondRect.width / 2); // 130
      expect(result.y).toBe(diamondRect.y + diamondRect.height); // 160
    });

    it('should calculate boundary point on diagonal edge', () => {
      const diamondRect = { x: 100, y: 100, width: 60, height: 60 };
      const targetCenter = { x: 200, y: 200 }; // Diagonal: bottom-right

      const result = getDiamondBoundaryPoint(diamondRect, targetCenter);

      // The boundary point should be on one of the diamond edges
      // Verify point is outside the center but within bounds
      const center = {
        x: diamondRect.x + diamondRect.width / 2,
        y: diamondRect.y + diamondRect.height / 2,
      };

      // Distance from center should be positive (not at center)
      const distFromCenter = Math.sqrt(
        Math.pow(result.x - center.x, 2) + Math.pow(result.y - center.y, 2)
      );
      expect(distFromCenter).toBeGreaterThan(0);

      // Point should be within the bounding rectangle of the diamond
      expect(result.x).toBeGreaterThanOrEqual(diamondRect.x);
      expect(result.x).toBeLessThanOrEqual(diamondRect.x + diamondRect.width);
      expect(result.y).toBeGreaterThanOrEqual(diamondRect.y);
      expect(result.y).toBeLessThanOrEqual(diamondRect.y + diamondRect.height);
    });
  });

  /**
   * Test 3: Boundary point calculation for circles (Initial/Final nodes)
   */
  describe('getCircleBoundaryPoint', () => {
    it('should calculate boundary point on circle perimeter to the right', () => {
      const circleRect = { x: 91, y: 91, width: 18, height: 18 }; // Center at 100,100
      const targetCenter = { x: 200, y: 100 };

      const result = getCircleBoundaryPoint(circleRect, targetCenter);

      // Target is to the right, boundary should be on right side of circle
      const radius = circleRect.width / 2;
      const centerX = circleRect.x + radius;
      const centerY = circleRect.y + radius;

      // Point should be at radius distance from center
      const distFromCenter = Math.sqrt(
        Math.pow(result.x - centerX, 2) + Math.pow(result.y - centerY, 2)
      );
      expect(distFromCenter).toBeCloseTo(radius, 5);

      // Should be on the right side
      expect(result.x).toBeGreaterThan(centerX);
    });

    it('should calculate boundary point on circle perimeter to the left', () => {
      const circleRect = { x: 191, y: 91, width: 18, height: 18 }; // Center at 200,100
      const targetCenter = { x: 50, y: 100 };

      const result = getCircleBoundaryPoint(circleRect, targetCenter);

      const radius = circleRect.width / 2;
      const centerX = circleRect.x + radius;
      const centerY = circleRect.y + radius;

      // Point should be at radius distance from center
      const distFromCenter = Math.sqrt(
        Math.pow(result.x - centerX, 2) + Math.pow(result.y - centerY, 2)
      );
      expect(distFromCenter).toBeCloseTo(radius, 5);

      // Should be on the left side
      expect(result.x).toBeLessThan(centerX);
    });

    it('should calculate boundary point for diagonal approach', () => {
      const circleRect = { x: 91, y: 91, width: 18, height: 18 }; // Center at 100,100
      const targetCenter = { x: 200, y: 200 };

      const result = getCircleBoundaryPoint(circleRect, targetCenter);

      const radius = circleRect.width / 2;
      const centerX = circleRect.x + radius;
      const centerY = circleRect.y + radius;

      // Point should be at radius distance from center
      const distFromCenter = Math.sqrt(
        Math.pow(result.x - centerX, 2) + Math.pow(result.y - centerY, 2)
      );
      expect(distFromCenter).toBeCloseTo(radius, 5);

      // Should be toward the target (bottom-right quadrant)
      expect(result.x).toBeGreaterThan(centerX);
      expect(result.y).toBeGreaterThan(centerY);
    });

    it('should handle Final node (bullseye) dimensions', () => {
      // Final node: outer diameter 22px
      const finalNodeRect = { x: 89, y: 89, width: 22, height: 22 }; // Center at 100,100
      const targetCenter = { x: 100, y: 200 };

      const result = getCircleBoundaryPoint(finalNodeRect, targetCenter);

      const radius = finalNodeRect.width / 2;
      const centerX = finalNodeRect.x + radius;
      const centerY = finalNodeRect.y + radius;

      // Point should be at radius distance from center
      const distFromCenter = Math.sqrt(
        Math.pow(result.x - centerX, 2) + Math.pow(result.y - centerY, 2)
      );
      expect(distFromCenter).toBeCloseTo(radius, 5);

      // Should be on the bottom (target is below)
      expect(result.y).toBeGreaterThan(centerY);
    });
  });

  /**
   * Test 4: Flow arrows connect at shape boundaries, not centers
   */
  describe('getBoundaryAnchorPoint', () => {
    it('should return boundary point for RoundedRect shape', () => {
      // Source with center at (170, 125), target with center at (370, 125)
      const sourceRect = { x: 100, y: 100, width: 140, height: 50 };
      const targetRect = { x: 300, y: 100, width: 140, height: 50 };

      const result = getBoundaryAnchorPoint(sourceRect, targetRect, ShapeKind.RoundedRect);

      // Source center is at (170, 125), target center is at (370, 125)
      // Boundary should be on right edge of source
      expect(result.x).toBe(sourceRect.x + sourceRect.width); // 240
      expect(result.y).toBe(sourceRect.y + sourceRect.height / 2); // 125
    });

    it('should return boundary point for Diamond shape', () => {
      // Source diamond with center at (130, 130), target with center at (330, 130)
      const sourceRect = { x: 100, y: 100, width: 60, height: 60 };
      const targetRect = { x: 300, y: 100, width: 60, height: 60 };

      const result = getBoundaryAnchorPoint(sourceRect, targetRect, ShapeKind.Diamond);

      // Boundary should be at right vertex of diamond
      expect(result.x).toBe(sourceRect.x + sourceRect.width); // 160
      expect(result.y).toBe(sourceRect.y + sourceRect.height / 2); // 130
    });

    it('should return boundary point for Circle shape', () => {
      const sourceRect = { x: 91, y: 91, width: 18, height: 18 };
      const targetRect = { x: 200, y: 91, width: 18, height: 18 };

      const result = getBoundaryAnchorPoint(sourceRect, targetRect, ShapeKind.Circle);

      const sourceCenter = {
        x: sourceRect.x + sourceRect.width / 2,
        y: sourceRect.y + sourceRect.height / 2,
      };
      const radius = sourceRect.width / 2;

      // Point should be at radius distance from center
      const distFromCenter = Math.sqrt(
        Math.pow(result.x - sourceCenter.x, 2) + Math.pow(result.y - sourceCenter.y, 2)
      );
      expect(distFromCenter).toBeCloseTo(radius, 5);
    });

    it('should not return center point for any shape type', () => {
      const sourceRect = { x: 100, y: 100, width: 60, height: 60 };
      const targetRect = { x: 300, y: 100, width: 60, height: 60 };

      const sourceCenter = {
        x: sourceRect.x + sourceRect.width / 2,
        y: sourceRect.y + sourceRect.height / 2,
      };

      // Test all shape kinds
      for (const shapeKind of [ShapeKind.RoundedRect, ShapeKind.Diamond, ShapeKind.Circle]) {
        const result = getBoundaryAnchorPoint(sourceRect, targetRect, shapeKind);

        // Result should NOT be the center point
        const isCenter = result.x === sourceCenter.x && result.y === sourceCenter.y;
        expect(isCenter).toBe(false);
      }
    });
  });

  /**
   * Test 5: Arrowhead orientation based on edge direction
   */
  describe('getShapeKindFromActivityKind', () => {
    it('should return Circle for Initial activity kind', () => {
      expect(getShapeKindFromActivityKind('Initial')).toBe(ShapeKind.Circle);
    });

    it('should return RoundedRect for Action activity kind', () => {
      expect(getShapeKindFromActivityKind('Action')).toBe(ShapeKind.RoundedRect);
    });

    it('should return Diamond for Decision activity kind', () => {
      expect(getShapeKindFromActivityKind('Decision')).toBe(ShapeKind.Diamond);
    });

    it('should return Diamond for Merge activity kind', () => {
      expect(getShapeKindFromActivityKind('Merge')).toBe(ShapeKind.Diamond);
    });

    it('should return Circle for Final activity kind', () => {
      expect(getShapeKindFromActivityKind('Final')).toBe(ShapeKind.Circle);
    });

    it('should default to RoundedRect for unknown activity kind', () => {
      expect(getShapeKindFromActivityKind('Unknown' as ActivityKind)).toBe(ShapeKind.RoundedRect);
    });
  });

  /**
   * Test: Edge direction vector preserved for arrowhead orientation
   */
  describe('Edge Direction for Arrowhead', () => {
    it('should maintain direction from source boundary to target boundary', () => {
      // Horizontal edge: source left of target (same Y level)
      const sourceRect = { x: 100, y: 100, width: 140, height: 50 };
      const targetRect = { x: 300, y: 100, width: 140, height: 50 };

      const sourceBoundary = getBoundaryAnchorPoint(sourceRect, targetRect, ShapeKind.RoundedRect);
      const targetBoundary = getBoundaryAnchorPoint(targetRect, sourceRect, ShapeKind.RoundedRect);

      // Direction should be from left to right (positive x direction)
      expect(targetBoundary.x).toBeGreaterThan(sourceBoundary.x);

      // Y should be approximately the same (horizontal edge)
      expect(Math.abs(targetBoundary.y - sourceBoundary.y)).toBeLessThan(1);
    });

    it('should maintain direction for vertical edges', () => {
      // Vertical edge: source above target (same X level)
      const sourceRect = { x: 100, y: 100, width: 140, height: 50 };
      const targetRect = { x: 100, y: 300, width: 140, height: 50 };

      const sourceBoundary = getBoundaryAnchorPoint(sourceRect, targetRect, ShapeKind.RoundedRect);
      const targetBoundary = getBoundaryAnchorPoint(targetRect, sourceRect, ShapeKind.RoundedRect);

      // Direction should be from top to bottom (positive y direction)
      expect(targetBoundary.y).toBeGreaterThan(sourceBoundary.y);

      // X should be approximately the same (vertical edge)
      expect(Math.abs(targetBoundary.x - sourceBoundary.x)).toBeLessThan(1);
    });
  });
});
