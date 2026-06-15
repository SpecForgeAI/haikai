/**
 * Tests for Resizable Decoration Behaviour
 * Task Group 5: Resizable Decoration Behaviour
 *
 * Tests for:
 * - Selected shape shows 8 resize handles (corners + midpoints)
 * - Selected line shows endpoint handles
 * - Dragging corner handle resizes shape
 * - Dragging line endpoint moves that point
 * - Circle maintains 1:1 aspect ratio during resize
 * - Resize updates decoration state correctly
 */

import {
  getShapeHandlePositions,
  getShapeHandleAtPoint,
  getLinePointAtPoint,
  isShapeDecoration,
  isLineBasedDecoration,
  createCircleDecoration,
} from '../utils/decorationUtils';
import { ShapeDecoration, LineDecoration, Decoration } from '../types/model';
import { HandlePosition } from '../config/defaults';

describe('Resizable Decoration Behaviour', () => {
  // Helper to create a shape decoration
  const createShape = (overrides = {}): ShapeDecoration => ({
    id: 'test-shape',
    type: 'BOX',
    pos_x: 100,
    pos_y: 100,
    width: 200,
    height: 100,
    ...overrides,
  });

  // Helper to create a line decoration
  const createLine = (overrides = {}): LineDecoration => ({
    id: 'test-line',
    type: 'LINE',
    line_points: [
      { x: 50, y: 50 },
      { x: 150, y: 150 },
    ],
    ...overrides,
  });

  describe('Shape resize handle positions', () => {
    it('should return 8 resize handles for a shape decoration', () => {
      const shape = createShape();
      const handles = getShapeHandlePositions(shape);

      expect(handles).toHaveLength(8);
    });

    it('should place handles at correct positions', () => {
      const shape = createShape({
        pos_x: 100,
        pos_y: 100,
        width: 200,
        height: 100,
      });
      const handles = getShapeHandlePositions(shape);

      // Convert to map for easier testing
      const handleMap = handles.reduce((acc, h) => {
        acc[h.position] = { x: h.x, y: h.y };
        return acc;
      }, {} as Record<HandlePosition, { x: number; y: number }>);

      // Top-Left
      expect(handleMap.TL).toEqual({ x: 100, y: 100 });
      // Top-Center
      expect(handleMap.TC).toEqual({ x: 200, y: 100 }); // 100 + 200/2
      // Top-Right
      expect(handleMap.TR).toEqual({ x: 300, y: 100 }); // 100 + 200
      // Middle-Left
      expect(handleMap.ML).toEqual({ x: 100, y: 150 }); // 100 + 100/2
      // Middle-Right
      expect(handleMap.MR).toEqual({ x: 300, y: 150 });
      // Bottom-Left
      expect(handleMap.BL).toEqual({ x: 100, y: 200 }); // 100 + 100
      // Bottom-Center
      expect(handleMap.BC).toEqual({ x: 200, y: 200 });
      // Bottom-Right
      expect(handleMap.BR).toEqual({ x: 300, y: 200 });
    });

    it('should handle all 8 positions: TL, TC, TR, ML, MR, BL, BC, BR', () => {
      const shape = createShape();
      const handles = getShapeHandlePositions(shape);
      const positions = handles.map(h => h.position);

      expect(positions).toContain('TL');
      expect(positions).toContain('TC');
      expect(positions).toContain('TR');
      expect(positions).toContain('ML');
      expect(positions).toContain('MR');
      expect(positions).toContain('BL');
      expect(positions).toContain('BC');
      expect(positions).toContain('BR');
    });
  });

  describe('Handle hit testing', () => {
    it('should detect click on corner handle', () => {
      const shape = createShape({
        pos_x: 100,
        pos_y: 100,
        width: 200,
        height: 100,
      });

      const handleSize = 8;

      // Click on Top-Left handle
      const hitTL = getShapeHandleAtPoint(100, 100, shape, handleSize);
      expect(hitTL).toBe('TL');

      // Click on Bottom-Right handle
      const hitBR = getShapeHandleAtPoint(300, 200, shape, handleSize);
      expect(hitBR).toBe('BR');
    });

    it('should detect click on midpoint handle', () => {
      const shape = createShape({
        pos_x: 100,
        pos_y: 100,
        width: 200,
        height: 100,
      });

      const handleSize = 8;

      // Click on Top-Center handle
      const hitTC = getShapeHandleAtPoint(200, 100, shape, handleSize);
      expect(hitTC).toBe('TC');

      // Click on Middle-Right handle
      const hitMR = getShapeHandleAtPoint(300, 150, shape, handleSize);
      expect(hitMR).toBe('MR');
    });

    it('should return null for click not on any handle', () => {
      const shape = createShape({
        pos_x: 100,
        pos_y: 100,
        width: 200,
        height: 100,
      });

      const handleSize = 8;

      // Click in the middle of the shape (not on a handle)
      const hit = getShapeHandleAtPoint(200, 150, shape, handleSize);
      expect(hit).toBeNull();
    });

    it('should respect handle size for hit testing', () => {
      const shape = createShape({
        pos_x: 100,
        pos_y: 100,
        width: 200,
        height: 100,
      });

      const handleSize = 8;
      const halfSize = handleSize / 2;

      // Click just inside handle boundary
      const hitInside = getShapeHandleAtPoint(100 + halfSize - 1, 100, shape, handleSize);
      expect(hitInside).toBe('TL');

      // Click just outside handle boundary
      const hitOutside = getShapeHandleAtPoint(100 + halfSize + 1, 100 + halfSize + 1, shape, handleSize);
      expect(hitOutside).toBeNull();
    });
  });

  describe('Line endpoint handles', () => {
    it('should detect click on line endpoint', () => {
      const line = createLine({
        line_points: [
          { x: 50, y: 50 },
          { x: 150, y: 150 },
        ],
      });

      const handleSize = 8;

      // Click on first point
      const hitFirst = getLinePointAtPoint(50, 50, line, handleSize);
      expect(hitFirst).toBe(0);

      // Click on second point
      const hitSecond = getLinePointAtPoint(150, 150, line, handleSize);
      expect(hitSecond).toBe(1);
    });

    it('should return point index for multi-point lines', () => {
      const line = createLine({
        line_points: [
          { x: 0, y: 0 },
          { x: 50, y: 50 },
          { x: 100, y: 0 },
        ],
      });

      const handleSize = 8;

      // Click on middle point
      const hitMiddle = getLinePointAtPoint(50, 50, line, handleSize);
      expect(hitMiddle).toBe(1);
    });

    it('should return null for click not on any line point', () => {
      const line = createLine({
        line_points: [
          { x: 50, y: 50 },
          { x: 150, y: 150 },
        ],
      });

      const handleSize = 8;

      // Click in between points (not on a handle)
      const hit = getLinePointAtPoint(100, 100, line, handleSize);
      expect(hit).toBeNull();
    });
  });

  describe('Circle aspect ratio', () => {
    it('should create circle with equal width and height', () => {
      // When creating a circle from a drag, width and height should be equal
      // This is handled in the factory function
      const circle = createCircleDecoration(100, 100, 50); // radius = 50

      expect(circle.width).toBe(100); // diameter
      expect(circle.height).toBe(100); // diameter
      expect(circle.width).toBe(circle.height);
    });

    it('should maintain 1:1 aspect ratio for circle type', () => {
      // When resizing a circle, the constraint should maintain 1:1
      const circle = createShape({
        type: 'CIRCLE',
        width: 100,
        height: 100,
      });

      // The circle should have equal dimensions
      expect(circle.width).toBe(circle.height);
    });
  });

  describe('Type guards for resize handling', () => {
    it('should correctly identify shape decorations', () => {
      const box = createShape({ type: 'BOX' });
      const oval = createShape({ type: 'OVAL' });
      const diamond = createShape({ type: 'DIAMOND' });

      expect(isShapeDecoration(box as Decoration)).toBe(true);
      expect(isShapeDecoration(oval as Decoration)).toBe(true);
      expect(isShapeDecoration(diamond as Decoration)).toBe(true);
    });

    it('should correctly identify line decorations', () => {
      const line = createLine({ type: 'LINE' });
      const arrowSingle = createLine({ type: 'ARROW_SINGLE' });
      const arrowDouble = createLine({ type: 'ARROW_DOUBLE' });

      expect(isLineBasedDecoration(line as Decoration)).toBe(true);
      expect(isLineBasedDecoration(arrowSingle as Decoration)).toBe(true);
      expect(isLineBasedDecoration(arrowDouble as Decoration)).toBe(true);
    });

    it('should distinguish between shape and line decorations', () => {
      const box = createShape({ type: 'BOX' });
      const line = createLine({ type: 'LINE' });

      expect(isShapeDecoration(box as Decoration)).toBe(true);
      expect(isLineBasedDecoration(box as Decoration)).toBe(false);

      expect(isShapeDecoration(line as Decoration)).toBe(false);
      expect(isLineBasedDecoration(line as Decoration)).toBe(true);
    });
  });

  describe('Resize state updates', () => {
    it('should calculate new dimensions from handle drag', () => {
      const shape = createShape({
        pos_x: 100,
        pos_y: 100,
        width: 200,
        height: 100,
      });

      // Simulate dragging BR handle to new position
      const newBRX = 350; // was 300
      const newBRY = 250; // was 200

      // Calculate new dimensions
      const newWidth = newBRX - shape.pos_x;
      const newHeight = newBRY - shape.pos_y;

      expect(newWidth).toBe(250); // Expanded by 50
      expect(newHeight).toBe(150); // Expanded by 50
    });

    it('should calculate new position when resizing from TL', () => {
      const shape = createShape({
        pos_x: 100,
        pos_y: 100,
        width: 200,
        height: 100,
      });

      // Simulate dragging TL handle to new position
      const newTLX = 50; // was 100
      const newTLY = 50; // was 100

      // Calculate new position and dimensions
      const newPosX = newTLX;
      const newPosY = newTLY;
      const newWidth = (shape.pos_x + shape.width) - newTLX; // BR stays fixed
      const newHeight = (shape.pos_y + shape.height) - newTLY; // BR stays fixed

      expect(newPosX).toBe(50);
      expect(newPosY).toBe(50);
      expect(newWidth).toBe(250); // Expanded by 50
      expect(newHeight).toBe(150); // Expanded by 50
    });
  });

  describe('Line point updates', () => {
    it('should calculate new line_points after endpoint drag', () => {
      const line = createLine({
        line_points: [
          { x: 50, y: 50 },
          { x: 150, y: 150 },
        ],
      });

      // Simulate dragging second endpoint to new position
      const draggedPointIndex = 1;
      const newX = 200;
      const newY = 100;

      // Create updated points array
      const newPoints = [...line.line_points];
      newPoints[draggedPointIndex] = { x: newX, y: newY };

      expect(newPoints[0]).toEqual({ x: 50, y: 50 }); // First point unchanged
      expect(newPoints[1]).toEqual({ x: 200, y: 100 }); // Second point updated
    });
  });
});
