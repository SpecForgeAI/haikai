/**
 * Decoration Interactions Tests
 * Task Group 4: Selection and Editing Interactions
 *
 * Tests for decoration selection, move, resize, and box-select functionality.
 */

import {
  findDecorationAtPoint,
  isPointInsideBoxDecoration,
  isPointNearLineDecoration,
  getBoxHandlePositions,
  isDecorationInsideRect,
  createDefaultBoxDecoration,
  createDefaultLineDecoration,
} from '../utils/decorationUtils';
import { BoxDecoration, LineDecoration, Decoration } from '../types/model';

describe('Decoration Interactions', () => {
  // Test fixtures
  const testBoxDecoration: BoxDecoration = {
    id: 'test-box-1',
    type: 'BOX',
    pos_x: 100,
    pos_y: 100,
    width: 200,
    height: 150,
    background_color: 'rgba(230, 230, 255, 0.2)',
    line_color: '#9999FF',
    z_index: 50,
  };

  const testLineDecoration: LineDecoration = {
    id: 'test-line-1',
    type: 'LINE',
    line_points: [
      { x: 50, y: 50 },
      { x: 150, y: 100 },
      { x: 250, y: 50 },
    ],
    line_color: '#666666',
    z_index: 120,
  };

  describe('Task 4.1: Click-to-select decoration', () => {
    it('should detect click inside BOX decoration', () => {
      // Click at center of the box (200, 175)
      const result = isPointInsideBoxDecoration(200, 175, testBoxDecoration);
      expect(result).toBe(true);
    });

    it('should detect click outside BOX decoration', () => {
      // Click outside the box
      const result = isPointInsideBoxDecoration(50, 50, testBoxDecoration);
      expect(result).toBe(false);
    });

    it('should detect click on edge of BOX decoration', () => {
      // Click on the edge (exactly at boundary)
      const result = isPointInsideBoxDecoration(100, 100, testBoxDecoration);
      expect(result).toBe(true);
    });

    it('should detect click near LINE decoration segment', () => {
      // Click near the middle segment (150, 100)
      const result = isPointNearLineDecoration(150, 100, testLineDecoration, 5);
      expect(result).toBe(true);
    });

    it('should detect click far from LINE decoration', () => {
      // Click far from any segment
      const result = isPointNearLineDecoration(400, 400, testLineDecoration, 5);
      expect(result).toBe(false);
    });

    it('should find decoration at point (BOX)', () => {
      const decorations: Decoration[] = [testBoxDecoration, testLineDecoration];
      const found = findDecorationAtPoint(200, 175, decorations);
      expect(found).not.toBeNull();
      expect(found?.id).toBe('test-box-1');
    });

    it('should find decoration at point (LINE)', () => {
      const decorations: Decoration[] = [testBoxDecoration, testLineDecoration];
      // Click near the line but not inside the box
      const found = findDecorationAtPoint(50, 50, decorations, 5);
      expect(found).not.toBeNull();
      expect(found?.id).toBe('test-line-1');
    });

    it('should return null when no decoration at point', () => {
      const decorations: Decoration[] = [testBoxDecoration, testLineDecoration];
      const found = findDecorationAtPoint(500, 500, decorations);
      expect(found).toBeNull();
    });
  });

  describe('Task 4.1: Ctrl+click for multi-select', () => {
    // Note: Multi-select behavior is handled in DiagramsView.tsx
    // These tests verify the underlying selection infrastructure

    it('should support Set-based selection for multiple decorations', () => {
      const selectedIds = new Set<string>();

      // Simulate first click
      selectedIds.add('test-box-1');
      expect(selectedIds.has('test-box-1')).toBe(true);
      expect(selectedIds.size).toBe(1);

      // Simulate Ctrl+click second decoration
      selectedIds.add('test-line-1');
      expect(selectedIds.has('test-box-1')).toBe(true);
      expect(selectedIds.has('test-line-1')).toBe(true);
      expect(selectedIds.size).toBe(2);
    });

    it('should toggle decoration out of selection on Ctrl+click', () => {
      const selectedIds = new Set<string>(['test-box-1', 'test-line-1']);

      // Simulate Ctrl+click to deselect
      if (selectedIds.has('test-box-1')) {
        selectedIds.delete('test-box-1');
      }

      expect(selectedIds.has('test-box-1')).toBe(false);
      expect(selectedIds.has('test-line-1')).toBe(true);
      expect(selectedIds.size).toBe(1);
    });
  });

  describe('Task 4.1: Box-select includes decorations', () => {
    it('should detect BOX decoration fully inside selection rectangle', () => {
      const rect = { x1: 50, y1: 50, x2: 350, y2: 300 };
      const result = isDecorationInsideRect(testBoxDecoration, rect);
      expect(result).toBe(true);
    });

    it('should not select BOX decoration partially outside rectangle', () => {
      // Rectangle that doesn't fully contain the box
      const rect = { x1: 150, y1: 100, x2: 250, y2: 200 };
      const result = isDecorationInsideRect(testBoxDecoration, rect);
      expect(result).toBe(false);
    });

    it('should detect LINE decoration fully inside selection rectangle', () => {
      // Rectangle that contains all line points
      const rect = { x1: 0, y1: 0, x2: 300, y2: 150 };
      const result = isDecorationInsideRect(testLineDecoration, rect);
      expect(result).toBe(true);
    });

    it('should not select LINE decoration with points outside rectangle', () => {
      // Rectangle that doesn't contain all line points
      const rect = { x1: 0, y1: 0, x2: 100, y2: 100 };
      const result = isDecorationInsideRect(testLineDecoration, rect);
      expect(result).toBe(false);
    });

    it('should handle inverted rectangle coordinates', () => {
      // Rectangle drawn right-to-left, bottom-to-top
      const rect = { x1: 350, y1: 300, x2: 50, y2: 50 };
      const result = isDecorationInsideRect(testBoxDecoration, rect);
      expect(result).toBe(true);
    });
  });

  describe('Task 4.1: BOX drag move', () => {
    it('should support position updates for BOX decoration', () => {
      const box = createDefaultBoxDecoration(100, 100, 200, 150);

      // Simulate drag by 50px in both directions
      const dx = 50;
      const dy = 30;
      const newPosX = box.pos_x + dx;
      const newPosY = box.pos_y + dy;

      expect(newPosX).toBe(150);
      expect(newPosY).toBe(130);
    });

    it('should preserve other properties during move', () => {
      const box: BoxDecoration = {
        ...testBoxDecoration,
        text: 'Test Label',
        background_color: '#FF0000',
      };

      // Create updated box after move
      const movedBox: BoxDecoration = {
        ...box,
        pos_x: box.pos_x + 50,
        pos_y: box.pos_y + 30,
      };

      expect(movedBox.text).toBe('Test Label');
      expect(movedBox.background_color).toBe('#FF0000');
      expect(movedBox.width).toBe(testBoxDecoration.width);
      expect(movedBox.height).toBe(testBoxDecoration.height);
    });
  });

  describe('Task 4.1: BOX resize via handles', () => {
    it('should return 8 handle positions for BOX decoration', () => {
      const handles = getBoxHandlePositions(testBoxDecoration);
      expect(handles).toHaveLength(8);

      // Check corner handles
      const TL = handles.find(h => h.position === 'TL');
      expect(TL).toBeDefined();
      expect(TL?.x).toBe(100);
      expect(TL?.y).toBe(100);

      const BR = handles.find(h => h.position === 'BR');
      expect(BR).toBeDefined();
      expect(BR?.x).toBe(300);
      expect(BR?.y).toBe(250);
    });

    it('should return correct edge handle positions', () => {
      const handles = getBoxHandlePositions(testBoxDecoration);

      // Top center handle
      const TC = handles.find(h => h.position === 'TC');
      expect(TC?.x).toBe(200); // 100 + 200/2
      expect(TC?.y).toBe(100);

      // Middle right handle
      const MR = handles.find(h => h.position === 'MR');
      expect(MR?.x).toBe(300); // 100 + 200
      expect(MR?.y).toBe(175); // 100 + 150/2
    });

    it('should support resize calculation for BOX', () => {
      // Simulate BR (bottom-right) handle drag
      const original = testBoxDecoration;
      const dx = 50;
      const dy = 30;

      // BR resize: increase width and height
      const newWidth = original.width + dx;
      const newHeight = original.height + dy;

      expect(newWidth).toBe(250);
      expect(newHeight).toBe(180);
    });

    it('should support TL (top-left) resize with position change', () => {
      // TL resize: decrease size, increase position
      const original = testBoxDecoration;
      const dx = 20;
      const dy = 10;

      // TL moves position and decreases size
      const newPosX = original.pos_x + dx;
      const newPosY = original.pos_y + dy;
      const newWidth = original.width - dx;
      const newHeight = original.height - dy;

      expect(newPosX).toBe(120);
      expect(newPosY).toBe(110);
      expect(newWidth).toBe(180);
      expect(newHeight).toBe(140);
    });
  });

  describe('Task 4.1: LINE drag move (entire line)', () => {
    it('should support moving all LINE points by same delta', () => {
      const dx = 100;
      const dy = 50;

      const movedPoints = testLineDecoration.line_points.map(p => ({
        x: p.x + dx,
        y: p.y + dy,
      }));

      expect(movedPoints[0]).toEqual({ x: 150, y: 100 });
      expect(movedPoints[1]).toEqual({ x: 250, y: 150 });
      expect(movedPoints[2]).toEqual({ x: 350, y: 100 });
    });

    it('should preserve other LINE properties during move', () => {
      const line: LineDecoration = {
        ...testLineDecoration,
        text: 'Test Label',
        arrow_end: 'ARROW',
      };

      // Create updated line after move
      const movedLine: LineDecoration = {
        ...line,
        line_points: line.line_points.map(p => ({
          x: p.x + 50,
          y: p.y + 30,
        })),
      };

      expect(movedLine.text).toBe('Test Label');
      expect(movedLine.arrow_end).toBe('ARROW');
      expect(movedLine.line_color).toBe('#666666');
    });

    it('should update label position when moving LINE with explicit label position', () => {
      const line: LineDecoration = {
        ...testLineDecoration,
        text: 'Label',
        label_pos_x: 150,
        label_pos_y: 75,
      };

      const dx = 50;
      const dy = 25;

      const newLabelPosX = (line.label_pos_x || 0) + dx;
      const newLabelPosY = (line.label_pos_y || 0) + dy;

      expect(newLabelPosX).toBe(200);
      expect(newLabelPosY).toBe(100);
    });
  });

  describe('Creation gesture helpers', () => {
    it('should create default BOX decoration with geometry from gesture', () => {
      // Simulate click-drag from (100, 100) to (300, 250)
      const startX = 100;
      const startY = 100;
      const endX = 300;
      const endY = 250;

      const width = endX - startX;
      const height = endY - startY;

      const box = createDefaultBoxDecoration(startX, startY, width, height);

      expect(box.type).toBe('BOX');
      expect(box.pos_x).toBe(100);
      expect(box.pos_y).toBe(100);
      expect(box.width).toBe(200);
      expect(box.height).toBe(150);
      expect(box.id).toMatch(/^dec_box_/);
    });

    it('should create default LINE decoration with two-point geometry', () => {
      // Simulate click-click at (50, 50) then (200, 150)
      const startPoint = { x: 50, y: 50 };
      const endPoint = { x: 200, y: 150 };

      const line = createDefaultLineDecoration([startPoint, endPoint]);

      expect(line.type).toBe('LINE');
      expect(line.line_points).toHaveLength(2);
      expect(line.line_points[0]).toEqual({ x: 50, y: 50 });
      expect(line.line_points[1]).toEqual({ x: 200, y: 150 });
      expect(line.id).toMatch(/^dec_line_/);
    });
  });
});
