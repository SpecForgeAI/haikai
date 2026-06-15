/**
 * Geometry Utilities for Diagram Flow Boundary Anchoring
 * Task Group 3: Flow Boundary Anchoring (A2)
 * Spec 2026-01-02: Added getShapeKindFromStateKind for State Diagram UX Fixes
 *
 * Provides functions for calculating boundary anchor points for
 * activity flow edges and state transition edges. These utilities ensure
 * that flow arrows connect at shape boundaries rather than centers.
 *
 * Supported shapes:
 * - RoundedRect: Action nodes (rounded rectangles), Normal state nodes
 * - Diamond: Decision and Merge nodes
 * - Circle: Initial and Final nodes (both Activity and State diagrams)
 */

import { ActivityKind, StateKind } from '../types/model';

/**
 * ShapeKind enum for boundary anchor calculation
 * Maps to the visual shapes used in activity and state diagrams
 */
export enum ShapeKind {
  /** Rounded rectangle for Action nodes and Normal state nodes */
  RoundedRect = 'RoundedRect',
  /** Diamond shape for Decision and Merge nodes */
  Diamond = 'Diamond',
  /** Circle shape for Initial and Final nodes */
  Circle = 'Circle',
}

/**
 * Rectangle interface for boundary calculations
 * Uses top-left origin with width/height
 */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Point interface for 2D coordinates
 */
export interface Point {
  x: number;
  y: number;
}

/**
 * Get the center point of a rectangle
 */
function getRectCenter(rect: Rect): Point {
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
  };
}

/**
 * Calculate the boundary anchor point for a rectangle/rounded-rect shape.
 *
 * Computes the intersection of a ray from the source rectangle center
 * to the target point with the rectangle boundary.
 *
 * @param sourceRect - The source rectangle bounds
 * @param targetCenter - The target point (typically center of target shape)
 * @returns The intersection point on the source rectangle boundary
 */
export function getRectangleBoundaryPoint(sourceRect: Rect, targetCenter: Point): Point {
  const center = getRectCenter(sourceRect);

  // Calculate direction vector from center to target
  const dx = targetCenter.x - center.x;
  const dy = targetCenter.y - center.y;

  // Handle the degenerate case where target is at center
  if (dx === 0 && dy === 0) {
    return { x: center.x + sourceRect.width / 2, y: center.y };
  }

  // Half-dimensions of the rectangle
  const halfWidth = sourceRect.width / 2;
  const halfHeight = sourceRect.height / 2;

  // Calculate intersection with rectangle edges
  // We find the parameter t for the parametric line: P = center + t * direction
  // where t is smallest positive value that puts P on the boundary

  let t = Infinity;

  // Check intersection with right edge (x = center.x + halfWidth)
  if (dx > 0) {
    const tRight = halfWidth / dx;
    if (tRight < t) {
      const yAtRight = dy * tRight;
      if (Math.abs(yAtRight) <= halfHeight) {
        t = tRight;
      }
    }
  }

  // Check intersection with left edge (x = center.x - halfWidth)
  if (dx < 0) {
    const tLeft = -halfWidth / dx;
    if (tLeft < t) {
      const yAtLeft = dy * tLeft;
      if (Math.abs(yAtLeft) <= halfHeight) {
        t = tLeft;
      }
    }
  }

  // Check intersection with bottom edge (y = center.y + halfHeight)
  if (dy > 0) {
    const tBottom = halfHeight / dy;
    if (tBottom < t) {
      const xAtBottom = dx * tBottom;
      if (Math.abs(xAtBottom) <= halfWidth) {
        t = tBottom;
      }
    }
  }

  // Check intersection with top edge (y = center.y - halfHeight)
  if (dy < 0) {
    const tTop = -halfHeight / dy;
    if (tTop < t) {
      const xAtTop = dx * tTop;
      if (Math.abs(xAtTop) <= halfWidth) {
        t = tTop;
      }
    }
  }

  // Calculate the intersection point
  return {
    x: center.x + dx * t,
    y: center.y + dy * t,
  };
}

/**
 * Calculate the boundary anchor point for a diamond shape.
 *
 * A diamond is defined as a 4-point polygon with vertices at the
 * midpoints of each edge of the bounding rectangle:
 * - Top: (centerX, top)
 * - Right: (right, centerY)
 * - Bottom: (centerX, bottom)
 * - Left: (left, centerY)
 *
 * @param diamondRect - The bounding rectangle of the diamond
 * @param targetCenter - The target point (typically center of target shape)
 * @returns The intersection point on the diamond boundary
 */
export function getDiamondBoundaryPoint(diamondRect: Rect, targetCenter: Point): Point {
  const center = getRectCenter(diamondRect);

  // Calculate direction vector from center to target
  const dx = targetCenter.x - center.x;
  const dy = targetCenter.y - center.y;

  // Handle the degenerate case where target is at center
  if (dx === 0 && dy === 0) {
    return { x: center.x + diamondRect.width / 2, y: center.y };
  }

  // Diamond vertices (relative to center)
  const halfWidth = diamondRect.width / 2;
  const halfHeight = diamondRect.height / 2;

  // Diamond edges as line segments from center perspective:
  // Top-Right edge: from (0, -halfHeight) to (halfWidth, 0)
  // Bottom-Right edge: from (halfWidth, 0) to (0, halfHeight)
  // Bottom-Left edge: from (0, halfHeight) to (-halfWidth, 0)
  // Top-Left edge: from (-halfWidth, 0) to (0, -halfHeight)

  // Determine which quadrant the target is in and find intersection
  // with the appropriate diamond edge

  let t: number;

  if (dx >= 0 && dy <= 0) {
    // Top-right quadrant: intersect with top-right edge
    // Edge from (0, -halfHeight) to (halfWidth, 0)
    // Parametric: (s * halfWidth, -halfHeight + s * halfHeight) for s in [0,1]
    // Ray: (t * dx, t * dy) from center
    // Solve: t * dx = s * halfWidth, t * dy = -halfHeight + s * halfHeight
    // From first: s = t * dx / halfWidth
    // Substitute: t * dy = -halfHeight + (t * dx / halfWidth) * halfHeight
    // t * dy = -halfHeight + t * dx * halfHeight / halfWidth
    // t * (dy - dx * halfHeight / halfWidth) = -halfHeight
    // t = -halfHeight / (dy - dx * halfHeight / halfWidth)
    const denominator = dy * halfWidth - dx * halfHeight;
    if (denominator !== 0) {
      t = -halfHeight * halfWidth / denominator;
    } else {
      // Parallel to edge, use right vertex
      t = halfWidth / dx;
    }
  } else if (dx >= 0 && dy > 0) {
    // Bottom-right quadrant: intersect with bottom-right edge
    // Edge from (halfWidth, 0) to (0, halfHeight)
    const denominator = dy * halfWidth + dx * halfHeight;
    if (denominator !== 0) {
      t = halfHeight * halfWidth / denominator;
    } else {
      t = halfWidth / dx;
    }
  } else if (dx < 0 && dy >= 0) {
    // Bottom-left quadrant: intersect with bottom-left edge
    // Edge from (0, halfHeight) to (-halfWidth, 0)
    const denominator = dy * halfWidth + dx * halfHeight;
    if (denominator !== 0) {
      t = -halfHeight * halfWidth / denominator;
    } else {
      t = -halfWidth / dx;
    }
  } else {
    // Top-left quadrant (dx < 0 && dy < 0): intersect with top-left edge
    // Edge from (-halfWidth, 0) to (0, -halfHeight)
    const denominator = dy * halfWidth - dx * halfHeight;
    if (denominator !== 0) {
      t = halfHeight * halfWidth / denominator;
    } else {
      t = -halfWidth / dx;
    }
  }

  // Ensure t is positive
  t = Math.abs(t);

  return {
    x: center.x + dx * t,
    y: center.y + dy * t,
  };
}

/**
 * Calculate the boundary anchor point for a circle shape.
 *
 * Uses the standard ray-circle intersection formula.
 * The circle is defined by the bounding rectangle (assuming square).
 *
 * @param circleRect - The bounding rectangle of the circle (should be square)
 * @param targetCenter - The target point (typically center of target shape)
 * @returns The intersection point on the circle perimeter
 */
export function getCircleBoundaryPoint(circleRect: Rect, targetCenter: Point): Point {
  const center = getRectCenter(circleRect);
  const radius = circleRect.width / 2;

  // Calculate direction vector from center to target
  const dx = targetCenter.x - center.x;
  const dy = targetCenter.y - center.y;

  // Handle the degenerate case where target is at center
  if (dx === 0 && dy === 0) {
    return { x: center.x + radius, y: center.y };
  }

  // Normalize direction and scale by radius
  const length = Math.sqrt(dx * dx + dy * dy);
  const unitX = dx / length;
  const unitY = dy / length;

  return {
    x: center.x + unitX * radius,
    y: center.y + unitY * radius,
  };
}

/**
 * Main function to get boundary anchor point based on shape kind.
 *
 * Dispatches to the appropriate boundary calculation function based
 * on the source shape type.
 *
 * @param sourceRect - The bounding rectangle of the source shape
 * @param targetRect - The bounding rectangle of the target shape
 * @param shapeKind - The kind of shape for the source
 * @returns The boundary anchor point on the source shape
 */
export function getBoundaryAnchorPoint(
  sourceRect: Rect,
  targetRect: Rect,
  shapeKind: ShapeKind
): Point {
  const targetCenter = getRectCenter(targetRect);

  switch (shapeKind) {
    case ShapeKind.RoundedRect:
      return getRectangleBoundaryPoint(sourceRect, targetCenter);
    case ShapeKind.Diamond:
      return getDiamondBoundaryPoint(sourceRect, targetCenter);
    case ShapeKind.Circle:
      return getCircleBoundaryPoint(sourceRect, targetCenter);
    default:
      // Default to rectangle boundary calculation
      return getRectangleBoundaryPoint(sourceRect, targetCenter);
  }
}

/**
 * Map ActivityKind to ShapeKind for boundary calculations.
 *
 * @param activityKind - The activity kind from the Activity entity
 * @returns The corresponding ShapeKind for boundary calculation
 */
export function getShapeKindFromActivityKind(activityKind: ActivityKind): ShapeKind {
  switch (activityKind) {
    case 'Initial':
      return ShapeKind.Circle;
    case 'Action':
      return ShapeKind.RoundedRect;
    case 'Decision':
      return ShapeKind.Diamond;
    case 'Merge':
      return ShapeKind.Diamond;
    case 'Final':
      return ShapeKind.Circle;
    default:
      // Default to RoundedRect for backward compatibility
      return ShapeKind.RoundedRect;
  }
}

/**
 * Map StateKind to ShapeKind for boundary calculations.
 * Spec 2026-01-02: State Diagram UX Fixes - Task Group 1
 *
 * State nodes have the following visual shapes:
 * - Initial: Filled black circle
 * - Normal: Rounded rectangle with label
 * - Final: Bullseye (circle)
 *
 * @param stateKind - The state kind from the State entity
 * @returns The corresponding ShapeKind for boundary calculation
 */
export function getShapeKindFromStateKind(stateKind: StateKind): ShapeKind {
  switch (stateKind) {
    case 'Initial':
      return ShapeKind.Circle;
    case 'Normal':
      return ShapeKind.RoundedRect;
    case 'Final':
      return ShapeKind.Circle;
    default:
      // Default to RoundedRect for backward compatibility
      // (handles undefined state_kind in legacy data)
      return ShapeKind.RoundedRect;
  }
}

/**
 * Calculate both source and target boundary points for an edge.
 *
 * This is a convenience function that calculates the boundary points
 * for both ends of an edge in one call.
 *
 * @param sourceRect - The bounding rectangle of the source shape
 * @param targetRect - The bounding rectangle of the target shape
 * @param sourceShapeKind - The shape kind of the source
 * @param targetShapeKind - The shape kind of the target
 * @returns Object containing both source and target boundary points
 */
export function getEdgeBoundaryPoints(
  sourceRect: Rect,
  targetRect: Rect,
  sourceShapeKind: ShapeKind,
  targetShapeKind: ShapeKind
): { source: Point; target: Point } {
  return {
    source: getBoundaryAnchorPoint(sourceRect, targetRect, sourceShapeKind),
    target: getBoundaryAnchorPoint(targetRect, sourceRect, targetShapeKind),
  };
}
