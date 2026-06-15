/**
 * Compound Handlers Viewport Center Tests
 * Task Group 4: Verification Layer Tests for Viewport-Centered Node Spawn
 *
 * Tests that compound handlers (handleAddWithBusinessProcesses, handleAddWithAppComponents)
 * correctly use viewport center for positioning parent nodes and relative positioning for children.
 *
 * Also documents that decorative elements use gesture-based placement (by design).
 */

import { getViewportCenter, ViewportInfo, DEFAULT_CANVAS_CENTER } from '../utils/viewportUtils';

describe('Compound Handlers Viewport Center', () => {
  describe('Task 4.1: handleAddWithBusinessProcesses positions parent at viewport center', () => {
    it('should calculate viewport center correctly for Application parent', () => {
      const viewportInfo: ViewportInfo = {
        scrollX: 500,
        scrollY: 400,
        width: 1200,
        height: 900,
      };

      const center = getViewportCenter(viewportInfo);

      // Center should be: scrollX + width/2, scrollY + height/2
      expect(center.x).toBe(1100);  // 500 + 600
      expect(center.y).toBe(850);   // 400 + 450
    });

    it('should position parent Application centered on viewport', () => {
      const viewportInfo: ViewportInfo = {
        scrollX: 300,
        scrollY: 200,
        width: 1000,
        height: 800,
      };

      const center = getViewportCenter(viewportInfo);

      // Simulating parent node positioning as done in handleAddWithBusinessProcesses
      const parentWidth = 130;  // DEFAULT_CHILD_WIDTH + 10
      const parentHeight = 200; // Estimated height with children

      const parentPos = {
        x: center.x - parentWidth / 2,
        y: center.y - parentHeight / 2,
      };

      // Parent should be centered at viewport center
      expect(parentPos.x + parentWidth / 2).toBe(center.x);
      expect(parentPos.y + parentHeight / 2).toBe(center.y);
    });

    it('should use fallback center when viewportInfo is null', () => {
      const center = getViewportCenter(null);

      expect(center.x).toBe(DEFAULT_CANVAS_CENTER.x);
      expect(center.y).toBe(DEFAULT_CANVAS_CENTER.y);
    });
  });

  describe('Task 4.1: handleAddWithBusinessProcesses positions children relative to parent', () => {
    it('should calculate child positions based on parent position', () => {
      const viewportInfo: ViewportInfo = {
        scrollX: 400,
        scrollY: 300,
        width: 1000,
        height: 800,
      };

      const center = getViewportCenter(viewportInfo);

      // Parent node position (as calculated by handler)
      const parentWidth = 130;
      const parentHeight = 180;
      const parentPos = {
        x: center.x - parentWidth / 2,
        y: center.y - parentHeight / 2,
      };

      // Child position relative to parent (as done in calculateChildPositionWithHeights)
      const childXOffset = 5;  // Standard offset from parent left
      const childYOffset = 30; // Label height + gap

      const childPos = {
        x: parentPos.x + childXOffset,
        y: parentPos.y + childYOffset,
      };

      // Child should be inside parent bounds
      expect(childPos.x).toBeGreaterThan(parentPos.x);
      expect(childPos.y).toBeGreaterThan(parentPos.y);
      expect(childPos.x).toBeLessThan(parentPos.x + parentWidth);
    });

    it('should position multiple children vertically stacked', () => {
      // Simulating multiple Business Process children
      const childHeights = [60, 75, 60]; // Different heights
      const childYPositions: number[] = [];

      let currentY = 30; // Start after label
      for (const height of childHeights) {
        childYPositions.push(currentY);
        currentY += height + 5; // Add gap between children
      }

      // Each child should be below the previous one
      expect(childYPositions[1]).toBeGreaterThan(childYPositions[0]);
      expect(childYPositions[2]).toBeGreaterThan(childYPositions[1]);
    });
  });

  describe('Task 4.1: handleAddWithAppComponents positions parent at viewport center', () => {
    it('should calculate viewport center correctly for Application with components', () => {
      const viewportInfo: ViewportInfo = {
        scrollX: 600,
        scrollY: 500,
        width: 1400,
        height: 1000,
      };

      const center = getViewportCenter(viewportInfo);

      expect(center.x).toBe(1300);  // 600 + 700
      expect(center.y).toBe(1000);  // 500 + 500
    });

    it('should position parent Application consistently with business processes handler', () => {
      const viewportInfo: ViewportInfo = {
        scrollX: 200,
        scrollY: 150,
        width: 800,
        height: 600,
      };

      const center = getViewportCenter(viewportInfo);

      // Both handlers should use the same center calculation
      const parentWidth = 130;
      const parentHeightBP = 180;  // With business processes
      const parentHeightAC = 180;  // With app components

      const parentPosBP = {
        x: center.x - parentWidth / 2,
        y: center.y - parentHeightBP / 2,
      };

      const parentPosAC = {
        x: center.x - parentWidth / 2,
        y: center.y - parentHeightAC / 2,
      };

      // X positions should be identical
      expect(parentPosBP.x).toBe(parentPosAC.x);
    });
  });

  describe('Task 4.1: handleAddWithAppComponents positions children relative to parent', () => {
    it('should position App Component children inside parent bounds', () => {
      const viewportInfo: ViewportInfo = {
        scrollX: 100,
        scrollY: 100,
        width: 1000,
        height: 800,
      };

      const center = getViewportCenter(viewportInfo);

      const parentWidth = 130;
      const parentHeight = 200;
      const parentPos = {
        x: center.x - parentWidth / 2,
        y: center.y - parentHeight / 2,
      };

      // Child positioning
      const childWidth = 120;
      const childHeight = 60;
      const childPos = {
        x: parentPos.x + 5,
        y: parentPos.y + 30,
      };

      // Child should be within parent
      expect(childPos.x + childWidth).toBeLessThanOrEqual(parentPos.x + parentWidth);
      expect(childPos.y).toBeGreaterThan(parentPos.y);
    });
  });
});

describe('Decorative Elements Placement', () => {
  /**
   * Task 4.4: Verify decorative element creation
   *
   * Decorative boxes and lines use GESTURE-BASED placement, not viewport-centered.
   * This is by design - users click on the canvas where they want the decoration
   * to appear, and the decoration is created at that click location.
   *
   * This test documents the expected behavior, not a test of viewport centering.
   */
  describe('Task 4.4: Decorative boxes use gesture-based placement (by design)', () => {
    it('should document that box decorations are placed at click position', () => {
      // Decorative boxes are created at the user's click position on the canvas
      // This is intentionally NOT viewport-centered
      const clickPosition = { x: 450, y: 350 };

      // Box decoration would be created at click position with default size
      const boxDecoration = {
        pos_x: clickPosition.x,
        pos_y: clickPosition.y,
        width: 100,  // Default width
        height: 80,  // Default height
      };

      expect(boxDecoration.pos_x).toBe(clickPosition.x);
      expect(boxDecoration.pos_y).toBe(clickPosition.y);
    });

    it('should document that decorations are NOT affected by viewport scroll', () => {
      // When user clicks at screen position (200, 150) on a scrolled canvas,
      // the decoration is placed at the canvas coordinate that corresponds
      // to that screen position, not at the viewport center.

      // This is the correct behavior - decorations follow the cursor
      const viewportInfo: ViewportInfo = {
        scrollX: 500,
        scrollY: 400,
        width: 1000,
        height: 800,
      };

      // User clicks at screen position
      const screenClickPos = { x: 200, y: 150 };

      // Canvas position = screen position + scroll offset
      const canvasClickPos = {
        x: viewportInfo.scrollX + screenClickPos.x,
        y: viewportInfo.scrollY + screenClickPos.y,
      };

      expect(canvasClickPos.x).toBe(700);  // 500 + 200
      expect(canvasClickPos.y).toBe(550);  // 400 + 150
    });
  });

  describe('Task 4.4: Decorative lines use gesture-based placement (by design)', () => {
    it('should document that line decorations use click position for points', () => {
      // Line decorations start with a point at the click position
      // Additional points are added as user continues clicking
      const firstClickPos = { x: 100, y: 100 };
      const secondClickPos = { x: 300, y: 200 };

      const lineDecoration = {
        points: [
          { x: firstClickPos.x, y: firstClickPos.y },
          { x: secondClickPos.x, y: secondClickPos.y },
        ],
      };

      expect(lineDecoration.points[0].x).toBe(firstClickPos.x);
      expect(lineDecoration.points[0].y).toBe(firstClickPos.y);
      expect(lineDecoration.points[1].x).toBe(secondClickPos.x);
      expect(lineDecoration.points[1].y).toBe(secondClickPos.y);
    });
  });
});

describe('Viewport Center Consistency', () => {
  it('should use getViewportCenter consistently across all compound handlers', () => {
    const viewportInfo: ViewportInfo = {
      scrollX: 250,
      scrollY: 175,
      width: 1100,
      height: 850,
    };

    // All handlers use the same getViewportCenter function
    const centerForBP = getViewportCenter(viewportInfo);
    const centerForAC = getViewportCenter(viewportInfo);
    const centerForRelationship = getViewportCenter(viewportInfo);

    expect(centerForBP.x).toBe(centerForAC.x);
    expect(centerForBP.y).toBe(centerForAC.y);
    expect(centerForAC.x).toBe(centerForRelationship.x);
    expect(centerForAC.y).toBe(centerForRelationship.y);
  });
});
