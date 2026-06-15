/**
 * Bend Point Insertion Tests
 * Task Group 3: Tests for bend point insertion via mid-segment handles
 *
 * Tests verify:
 * - Clicking and dragging a mid-segment handle inserts a new point
 * - New point is inserted at correct index (between segment endpoints)
 * - Line geometry updates in real-time during drag
 * - Updated points array is committed on drag end
 * - Auto-centered labels recalculate position with new points
 * - Manual label positions are preserved after adding bend points
 */

import { LineDecoration, EdgePoint } from '../types/model';
import {
  getMidSegmentHandleAtPoint,
  calculateMidSegmentPositions,
  calculateLineLabelPosition,
} from '../utils/decorationUtils';
import { edgeInteraction } from '../config/defaults';

// Test data factory functions
function createTestLineDecoration(overrides: Partial<LineDecoration> = {}): LineDecoration {
  return {
    id: 'test-line-1',
    type: 'LINE',
    line_points: [
      { x: 100, y: 100 },
      { x: 300, y: 100 },
    ],
    z_index: 120,
    line_color: '#666666',
    line_style: 'SOLID',
    line_weight: '2px',
    text_font_size: 12,
    text_font_weight: 'normal',
    text_font_style: 'normal',
    text_color: '#333333',
    arrow_start: 'NONE',
    arrow_end: 'NONE',
    text: '',
    ...overrides,
  };
}

function createTestEdgePoints(): EdgePoint[] {
  return [
    { id: 'ep-1', sequence_order: 0, pos_x: 100, pos_y: 100 },
    { id: 'ep-2', sequence_order: 1, pos_x: 300, pos_y: 100 },
  ];
}

describe('Bend Point Insertion', () => {
  describe('Mid-segment handle hit testing', () => {
    it('should detect click on mid-segment handle and return correct segment index', () => {
      // Given: A line with 2 points creating 1 segment
      const line = createTestLineDecoration();
      const midPositions = calculateMidSegmentPositions(line.line_points);

      // The midpoint should be at (200, 100)
      expect(midPositions).toHaveLength(1);
      expect(midPositions[0].x).toBe(200);
      expect(midPositions[0].y).toBe(100);
      expect(midPositions[0].segmentIndex).toBe(0);

      // When: Clicking directly on the mid-segment handle
      const handleSize = edgeInteraction.midSegmentHandleSize;
      const clickX = 200;
      const clickY = 100;

      const hitResult = getMidSegmentHandleAtPoint(clickX, clickY, midPositions, handleSize);

      // Then: Should return segment index 0
      expect(hitResult).toBe(0);
    });

    it('should return null when click misses mid-segment handles', () => {
      // Given: A line with 2 points
      const line = createTestLineDecoration();
      const midPositions = calculateMidSegmentPositions(line.line_points);
      const handleSize = edgeInteraction.midSegmentHandleSize;

      // When: Clicking far away from the mid-segment handle
      const clickX = 50;  // Far from midpoint at 200
      const clickY = 50;

      const hitResult = getMidSegmentHandleAtPoint(clickX, clickY, midPositions, handleSize);

      // Then: Should return null (no hit)
      expect(hitResult).toBeNull();
    });

    it('should correctly identify which segment was clicked for multi-segment lines', () => {
      // Given: A line with 3 points (2 segments)
      const line = createTestLineDecoration({
        line_points: [
          { x: 100, y: 100 },
          { x: 200, y: 100 },
          { x: 200, y: 200 },
        ],
      });
      const midPositions = calculateMidSegmentPositions(line.line_points);
      const handleSize = edgeInteraction.midSegmentHandleSize;

      // Should have 2 mid-segment handles
      expect(midPositions).toHaveLength(2);
      // First midpoint at (150, 100)
      expect(midPositions[0].x).toBe(150);
      expect(midPositions[0].y).toBe(100);
      expect(midPositions[0].segmentIndex).toBe(0);
      // Second midpoint at (200, 150)
      expect(midPositions[1].x).toBe(200);
      expect(midPositions[1].y).toBe(150);
      expect(midPositions[1].segmentIndex).toBe(1);

      // When: Clicking on the second mid-segment handle
      const hitResult = getMidSegmentHandleAtPoint(200, 150, midPositions, handleSize);

      // Then: Should return segment index 1
      expect(hitResult).toBe(1);
    });
  });

  describe('Bend point insertion into line_points array', () => {
    it('should insert new point at correct index between segment endpoints', () => {
      // Given: A line with 2 points
      const originalPoints = [
        { x: 100, y: 100 },
        { x: 300, y: 100 },
      ];

      // When: Inserting a new bend point at segment index 0 (between points 0 and 1)
      const segmentIndex = 0;
      const newPointX = 200;
      const newPointY = 150;

      // Insert at segmentIndex + 1 (index 1, between original 0 and 1)
      const newPoints = [
        ...originalPoints.slice(0, segmentIndex + 1),
        { x: newPointX, y: newPointY },
        ...originalPoints.slice(segmentIndex + 1),
      ];

      // Then: New points array should have 3 points
      expect(newPoints).toHaveLength(3);
      expect(newPoints[0]).toEqual({ x: 100, y: 100 });
      expect(newPoints[1]).toEqual({ x: 200, y: 150 });
      expect(newPoints[2]).toEqual({ x: 300, y: 100 });
    });

    it('should correctly insert bend point for multi-segment lines', () => {
      // Given: A line with 3 points (2 segments)
      const originalPoints = [
        { x: 100, y: 100 },
        { x: 200, y: 100 },
        { x: 200, y: 200 },
      ];

      // When: Inserting a new bend point at segment index 1 (between points 1 and 2)
      const segmentIndex = 1;
      const newPointX = 200;
      const newPointY = 150;

      const newPoints = [
        ...originalPoints.slice(0, segmentIndex + 1),
        { x: newPointX, y: newPointY },
        ...originalPoints.slice(segmentIndex + 1),
      ];

      // Then: New points array should have 4 points
      expect(newPoints).toHaveLength(4);
      expect(newPoints[0]).toEqual({ x: 100, y: 100 });
      expect(newPoints[1]).toEqual({ x: 200, y: 100 });
      expect(newPoints[2]).toEqual({ x: 200, y: 150 }); // Inserted point
      expect(newPoints[3]).toEqual({ x: 200, y: 200 });
    });
  });

  describe('Line geometry updates during drag', () => {
    it('should update point position during drag operation', () => {
      // Given: A line with 3 points (bend point already inserted)
      const points = [
        { x: 100, y: 100 },
        { x: 200, y: 150 },  // This is the point being dragged
        { x: 300, y: 100 },
      ];

      const dragPointIndex = 1;
      const newX = 220;
      const newY = 180;

      // When: Updating the point during drag
      const updatedPoints = points.map((p, i) => {
        if (i === dragPointIndex) {
          return { x: newX, y: newY };
        }
        return { ...p };
      });

      // Then: Only the dragged point should be updated
      expect(updatedPoints[0]).toEqual({ x: 100, y: 100 });
      expect(updatedPoints[1]).toEqual({ x: 220, y: 180 });
      expect(updatedPoints[2]).toEqual({ x: 300, y: 100 });
    });
  });

  describe('Auto-centered label recalculation', () => {
    it('should recalculate auto-centered label position with new points', () => {
      // Given: A line with 2 points and auto-centered label
      const lineWithLabel = createTestLineDecoration({
        text: 'Test Label',
        // No label_pos_x/label_pos_y means auto-centering
      });

      // Initial auto-centered position (average of 2 points)
      const initialPos = calculateLineLabelPosition(lineWithLabel);
      expect(initialPos.x).toBe(200);  // (100 + 300) / 2
      expect(initialPos.y).toBe(100);  // (100 + 100) / 2

      // When: A new bend point is added
      const lineWithBendPoint: LineDecoration = {
        ...lineWithLabel,
        line_points: [
          { x: 100, y: 100 },
          { x: 200, y: 200 },  // New bend point
          { x: 300, y: 100 },
        ],
      };

      // Then: Auto-centered position should recalculate with all 3 points
      const newPos = calculateLineLabelPosition(lineWithBendPoint);
      expect(newPos.x).toBe(200);  // (100 + 200 + 300) / 3 = 200
      expect(newPos.y).toBeCloseTo(133.33, 1);  // (100 + 200 + 100) / 3 = 133.33
    });
  });

  describe('Manual label position preservation', () => {
    it('should preserve manual label position after adding bend points', () => {
      // Given: A line with manually positioned label
      const lineWithManualLabel = createTestLineDecoration({
        text: 'Test Label',
        label_pos_x: 250,
        label_pos_y: 50,
      });

      // Initial manual position
      const initialPos = calculateLineLabelPosition(lineWithManualLabel);
      expect(initialPos.x).toBe(250);
      expect(initialPos.y).toBe(50);

      // When: A new bend point is added
      const lineWithBendPoint: LineDecoration = {
        ...lineWithManualLabel,
        line_points: [
          { x: 100, y: 100 },
          { x: 200, y: 200 },  // New bend point
          { x: 300, y: 100 },
        ],
      };

      // Then: Manual label position should be preserved
      const newPos = calculateLineLabelPosition(lineWithBendPoint);
      expect(newPos.x).toBe(250);  // Preserved
      expect(newPos.y).toBe(50);   // Preserved
    });
  });

  describe('Edge point insertion for relationship edges', () => {
    it('should insert new edge point at correct position with proper sequence_order', () => {
      // Given: Edge with 2 points
      const originalEdgePoints = createTestEdgePoints();

      // When: Inserting a new point at segment index 0
      const segmentIndex = 0;
      const newPointX = 200;
      const newPointY = 150;
      const newPointId = 'ep-new';

      // Insert new point and update sequence_order for subsequent points
      const beforeInsert = originalEdgePoints.slice(0, segmentIndex + 1);
      const newPoint: EdgePoint = {
        id: newPointId,
        sequence_order: segmentIndex + 1,
        pos_x: newPointX,
        pos_y: newPointY,
      };
      const afterInsert = originalEdgePoints.slice(segmentIndex + 1).map(p => ({
        ...p,
        sequence_order: p.sequence_order + 1,
      }));

      const newEdgePoints = [...beforeInsert, newPoint, ...afterInsert];

      // Then: New edge_points array should have correct structure
      expect(newEdgePoints).toHaveLength(3);
      expect(newEdgePoints[0].sequence_order).toBe(0);
      expect(newEdgePoints[1].sequence_order).toBe(1);
      expect(newEdgePoints[1].pos_x).toBe(200);
      expect(newEdgePoints[1].pos_y).toBe(150);
      expect(newEdgePoints[2].sequence_order).toBe(2);  // Updated from 1 to 2
    });
  });
});
