/**
 * Integration Tests for Z-Index Hit Testing Consistency
 *
 * These tests verify that hit testing respects z_index ordering,
 * ensuring what's rendered on top is also selected first when clicked.
 */

import {
  DiagramNode,
  DiagramEdge,
  ShapeDecoration,
  LineDecoration,
  Decoration,
} from '../types/model';

import {
  findDecorationAtPoint,
  isShapeDecoration,
  isLineBasedDecoration,
  getDecorationZIndex,
} from '../utils/decorationUtils';

// Helper to create overlapping shape decorations
function createOverlappingBox(
  id: string,
  zIndex: number,
  offset: number = 0
): ShapeDecoration {
  return {
    id,
    type: 'BOX',
    pos_x: 100 + offset,
    pos_y: 100 + offset,
    width: 100,
    height: 100,
    z_index: zIndex,
  };
}

// Helper to create overlapping line decorations
function createOverlappingLine(
  id: string,
  zIndex: number,
  yOffset: number = 0
): LineDecoration {
  return {
    id,
    type: 'LINE',
    line_points: [
      { x: 100, y: 150 + yOffset },
      { x: 300, y: 150 + yOffset },
    ],
    z_index: zIndex,
  };
}

describe('Z-Index Hit Testing Consistency', () => {
  describe('findDecorationAtPoint respects z_index', () => {
    it('should return higher z_index decoration when multiple decorations overlap at point', () => {
      const lowBox = createOverlappingBox('low-box', 50);
      const highBox = createOverlappingBox('high-box', 200, 20); // Slightly offset but overlapping

      // Click at point that's inside both boxes
      const clickX = 150;
      const clickY = 150;

      // Both boxes should contain this point
      expect(clickX).toBeGreaterThan(lowBox.pos_x);
      expect(clickX).toBeLessThan(lowBox.pos_x + lowBox.width);
      expect(clickX).toBeGreaterThan(highBox.pos_x);
      expect(clickX).toBeLessThan(highBox.pos_x + highBox.width);

      const result = findDecorationAtPoint(clickX, clickY, [lowBox, highBox]);

      // Should return the one with higher z_index
      expect(result).not.toBeNull();
      expect(result!.id).toBe('high-box');
    });

    it('should return higher z_index decoration regardless of array order', () => {
      const lowBox = createOverlappingBox('low-box', 50);
      const highBox = createOverlappingBox('high-box', 200, 20);

      const clickX = 150;
      const clickY = 150;

      // Pass in different orders - result should be the same
      const result1 = findDecorationAtPoint(clickX, clickY, [lowBox, highBox]);
      const result2 = findDecorationAtPoint(clickX, clickY, [highBox, lowBox]);

      expect(result1!.id).toBe('high-box');
      expect(result2!.id).toBe('high-box');
    });

    it('should return line decoration over shape when line has higher z_index', () => {
      const box = createOverlappingBox('box', 50);
      // Line crosses through the box
      const line: LineDecoration = {
        id: 'line',
        type: 'LINE',
        line_points: [
          { x: 50, y: 150 },
          { x: 250, y: 150 },
        ],
        z_index: 200,
      };

      // Click on a point where both the line and box exist
      const clickX = 150;
      const clickY = 150;

      const result = findDecorationAtPoint(clickX, clickY, [box, line], 5);

      // Line has higher z_index, should be returned
      expect(result).not.toBeNull();
      expect(result!.id).toBe('line');
    });

    it('should return shape decoration over line when shape has higher z_index', () => {
      const box: ShapeDecoration = {
        id: 'box',
        type: 'BOX',
        pos_x: 100,
        pos_y: 100,
        width: 100,
        height: 100,
        z_index: 200, // Higher z_index
      };
      // Line crosses through the box but with lower z_index
      const line: LineDecoration = {
        id: 'line',
        type: 'LINE',
        line_points: [
          { x: 50, y: 150 },
          { x: 250, y: 150 },
        ],
        z_index: 50, // Lower z_index
      };

      const clickX = 150;
      const clickY = 150;

      const result = findDecorationAtPoint(clickX, clickY, [line, box], 5);

      // Box has higher z_index, should be returned
      expect(result).not.toBeNull();
      expect(result!.id).toBe('box');
    });
  });

  describe('Z-index defaults are applied correctly', () => {
    it('should use default z_index when not specified', () => {
      const boxNoZIndex: ShapeDecoration = {
        id: 'box-no-z',
        type: 'BOX',
        pos_x: 100,
        pos_y: 100,
        width: 100,
        height: 100,
        // No z_index - should default to 50
      };

      const lineNoZIndex: LineDecoration = {
        id: 'line-no-z',
        type: 'LINE',
        line_points: [
          { x: 50, y: 150 },
          { x: 250, y: 150 },
        ],
        // No z_index - should default to 120
      };

      // Verify getDecorationZIndex returns correct defaults
      expect(getDecorationZIndex(boxNoZIndex)).toBe(50);
      expect(getDecorationZIndex(lineNoZIndex)).toBe(120);
    });

    it('should correctly order decorations with mixed explicit and default z_index', () => {
      const boxDefault: ShapeDecoration = {
        id: 'box-default',
        type: 'BOX',
        pos_x: 100,
        pos_y: 100,
        width: 100,
        height: 100,
        // No z_index - defaults to 50
      };

      const boxExplicit: ShapeDecoration = {
        id: 'box-explicit',
        type: 'BOX',
        pos_x: 120,
        pos_y: 120,
        width: 100,
        height: 100,
        z_index: 100, // Explicit z_index higher than default
      };

      const clickX = 150;
      const clickY = 150;

      const result = findDecorationAtPoint(clickX, clickY, [boxDefault, boxExplicit], 5);

      // Explicit z_index=100 is higher than default=50
      expect(result!.id).toBe('box-explicit');
    });
  });
});
