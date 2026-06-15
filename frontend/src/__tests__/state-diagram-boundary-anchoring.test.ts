/**
 * State Diagram Boundary Anchoring Tests
 * Spec: 2026-01-02-state-diagram-ux-fixes
 * Task Group 1: Edge Boundary Anchoring Layer
 *
 * Tests for StateTransition edges anchoring at node boundaries:
 * - Test getShapeKindFromStateKind maps Initial/Final -> Circle, Normal -> RoundedRect
 * - Test boundary point calculation for StateTransition between two Normal states
 * - Test boundary point calculation for StateTransition from Initial to Normal
 * - Test boundary point calculation for StateTransition from Normal to Final
 * - Test arrowhead angle is correct when using boundary points
 */

import { describe, it, expect } from 'vitest';
import {
  ShapeKind,
  getShapeKindFromStateKind,
  getEdgeBoundaryPoints,
  getRectangleBoundaryPoint,
  getCircleBoundaryPoint,
} from '../utils/geometryUtils';
import { StateKind } from '../types/model';

// ============================================================================
// Test Suite: getShapeKindFromStateKind Mapping
// ============================================================================

describe('State Diagram Boundary Anchoring - StateKind to ShapeKind Mapping', () => {
  /**
   * Test 1.1a: Initial state maps to Circle shape
   */
  it('should map Initial StateKind to Circle ShapeKind', () => {
    const stateKind: StateKind = 'Initial';
    const result = getShapeKindFromStateKind(stateKind);
    expect(result).toBe(ShapeKind.Circle);
  });

  /**
   * Test 1.1b: Normal state maps to RoundedRect shape
   */
  it('should map Normal StateKind to RoundedRect ShapeKind', () => {
    const stateKind: StateKind = 'Normal';
    const result = getShapeKindFromStateKind(stateKind);
    expect(result).toBe(ShapeKind.RoundedRect);
  });

  /**
   * Test 1.1c: Final state maps to Circle shape
   */
  it('should map Final StateKind to Circle ShapeKind', () => {
    const stateKind: StateKind = 'Final';
    const result = getShapeKindFromStateKind(stateKind);
    expect(result).toBe(ShapeKind.Circle);
  });

  /**
   * Test 1.1d: Undefined state_kind defaults to RoundedRect (backward compatibility)
   */
  it('should default to RoundedRect for undefined state_kind', () => {
    const result = getShapeKindFromStateKind(undefined as unknown as StateKind);
    expect(result).toBe(ShapeKind.RoundedRect);
  });
});

// ============================================================================
// Test Suite: Boundary Point Calculations
// ============================================================================

describe('State Diagram Boundary Anchoring - Boundary Point Calculations', () => {
  /**
   * Test 1.2a: Boundary point calculation between two Normal states (RoundedRect)
   * Both source and target are rounded rectangles
   */
  it('should calculate boundary points for transition between two Normal states', () => {
    // Two Normal state nodes positioned horizontally
    const sourceRect = { x: 100, y: 100, width: 140, height: 50 };
    const targetRect = { x: 300, y: 100, width: 140, height: 50 };

    const result = getEdgeBoundaryPoints(
      sourceRect,
      targetRect,
      ShapeKind.RoundedRect,
      ShapeKind.RoundedRect
    );

    // Source boundary should be on the right edge (x = 100 + 140 = 240)
    expect(result.source.x).toBeCloseTo(240, 0);
    expect(result.source.y).toBeCloseTo(125, 0); // Center Y

    // Target boundary should be on the left edge (x = 300)
    expect(result.target.x).toBeCloseTo(300, 0);
    expect(result.target.y).toBeCloseTo(125, 0); // Center Y
  });

  /**
   * Test 1.2b: Boundary point calculation from Initial (Circle) to Normal (RoundedRect)
   */
  it('should calculate boundary points from Initial state to Normal state', () => {
    // Initial state (circle) and Normal state (rounded rect)
    const sourceRect = { x: 100, y: 100, width: 30, height: 30 }; // Circle
    const targetRect = { x: 200, y: 90, width: 140, height: 50 }; // RoundedRect

    const result = getEdgeBoundaryPoints(
      sourceRect,
      targetRect,
      ShapeKind.Circle,
      ShapeKind.RoundedRect
    );

    // Source (Circle) - boundary should be on the right side
    // Circle center: (115, 115), radius: 15
    // Direction to target center (270, 115) is primarily rightward
    expect(result.source.x).toBeGreaterThan(115); // Right of center

    // Target (RoundedRect) - boundary should be on the left edge
    expect(result.target.x).toBeCloseTo(200, 0);
  });

  /**
   * Test 1.2c: Boundary point calculation from Normal (RoundedRect) to Final (Circle)
   */
  it('should calculate boundary points from Normal state to Final state', () => {
    // Normal state (rounded rect) and Final state (circle)
    const sourceRect = { x: 100, y: 100, width: 140, height: 50 }; // RoundedRect
    const targetRect = { x: 300, y: 110, width: 30, height: 30 }; // Circle

    const result = getEdgeBoundaryPoints(
      sourceRect,
      targetRect,
      ShapeKind.RoundedRect,
      ShapeKind.Circle
    );

    // Source (RoundedRect) - boundary should be on the right edge
    expect(result.source.x).toBeCloseTo(240, 0);

    // Target (Circle) - boundary should be on the left side of circle
    // Circle center: (315, 125), radius: 15
    expect(result.target.x).toBeLessThan(315); // Left of center
  });

  /**
   * Test 1.2d: Vertical edge boundary calculation
   */
  it('should calculate boundary points for vertically aligned states', () => {
    // Source above target
    const sourceRect = { x: 100, y: 50, width: 140, height: 50 };
    const targetRect = { x: 100, y: 200, width: 140, height: 50 };

    const result = getEdgeBoundaryPoints(
      sourceRect,
      targetRect,
      ShapeKind.RoundedRect,
      ShapeKind.RoundedRect
    );

    // Source boundary should be on the bottom edge
    expect(result.source.y).toBeCloseTo(100, 0); // Bottom of source
    expect(result.source.x).toBeCloseTo(170, 0); // Center X

    // Target boundary should be on the top edge
    expect(result.target.y).toBeCloseTo(200, 0); // Top of target
    expect(result.target.x).toBeCloseTo(170, 0); // Center X
  });
});

// ============================================================================
// Test Suite: Arrowhead Angle Calculation
// ============================================================================

describe('State Diagram Boundary Anchoring - Arrowhead Angle', () => {
  /**
   * Test 1.3a: Arrowhead angle for horizontal edge (left to right)
   */
  it('should produce correct arrowhead angle for horizontal edge', () => {
    const sourceRect = { x: 100, y: 100, width: 140, height: 50 };
    const targetRect = { x: 300, y: 100, width: 140, height: 50 };

    const result = getEdgeBoundaryPoints(
      sourceRect,
      targetRect,
      ShapeKind.RoundedRect,
      ShapeKind.RoundedRect
    );

    // For horizontal edge, the direction is (positive X, 0 Y)
    const dx = result.target.x - result.source.x;
    const dy = result.target.y - result.source.y;

    // Should be primarily horizontal
    expect(Math.abs(dx)).toBeGreaterThan(Math.abs(dy));
    // Y difference should be near zero for horizontal
    expect(Math.abs(dy)).toBeLessThan(1);
  });

  /**
   * Test 1.3b: Arrowhead angle for diagonal edge
   */
  it('should produce correct arrowhead angle for diagonal edge', () => {
    const sourceRect = { x: 100, y: 100, width: 140, height: 50 };
    const targetRect = { x: 300, y: 250, width: 140, height: 50 };

    const result = getEdgeBoundaryPoints(
      sourceRect,
      targetRect,
      ShapeKind.RoundedRect,
      ShapeKind.RoundedRect
    );

    // For diagonal edge, both dx and dy should be non-zero
    const dx = result.target.x - result.source.x;
    const dy = result.target.y - result.source.y;

    expect(dx).toBeGreaterThan(0);
    expect(dy).toBeGreaterThan(0);
  });

  /**
   * Test 1.3c: Boundary points update when node dimensions change
   */
  it('should recalculate boundary points when node is resized', () => {
    // Original size
    const sourceRect1 = { x: 100, y: 100, width: 140, height: 50 };
    const targetRect = { x: 300, y: 100, width: 140, height: 50 };

    const result1 = getEdgeBoundaryPoints(
      sourceRect1,
      targetRect,
      ShapeKind.RoundedRect,
      ShapeKind.RoundedRect
    );

    // Resize source to be wider
    const sourceRect2 = { x: 100, y: 100, width: 200, height: 50 };

    const result2 = getEdgeBoundaryPoints(
      sourceRect2,
      targetRect,
      ShapeKind.RoundedRect,
      ShapeKind.RoundedRect
    );

    // Source boundary X should move right when node is wider
    expect(result2.source.x).toBeGreaterThan(result1.source.x);
  });
});
