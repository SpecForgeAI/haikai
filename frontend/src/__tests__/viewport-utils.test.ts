/**
 * Viewport Utils Tests
 * Task Group 1: Infrastructure Layer Tests for Viewport-Centered Node Spawn
 *
 * Tests the getViewportCenter helper function which is the single source of truth
 * for determining where to spawn new nodes on the canvas.
 */

import {
  getViewportCenter,
  getViewportCenterFromRaw,
  ViewportInfo,
  DEFAULT_CANVAS_CENTER,
} from '../utils/viewportUtils';

describe('getViewportCenter', () => {
  describe('Task 1.1: Basic center calculation with standard viewport values', () => {
    it('should calculate center correctly for standard viewport', () => {
      const viewportInfo: ViewportInfo = {
        scrollX: 0,
        scrollY: 0,
        width: 800,
        height: 600,
      };

      const center = getViewportCenter(viewportInfo);

      expect(center.x).toBe(400); // 0 + 800/2
      expect(center.y).toBe(300); // 0 + 600/2
    });

    it('should calculate center correctly for viewport at origin', () => {
      const viewportInfo: ViewportInfo = {
        scrollX: 0,
        scrollY: 0,
        width: 1920,
        height: 1080,
      };

      const center = getViewportCenter(viewportInfo);

      expect(center.x).toBe(960);  // 0 + 1920/2
      expect(center.y).toBe(540);  // 0 + 1080/2
    });
  });

  describe('Task 1.1: Center calculation at different zoom levels', () => {
    it('should calculate center correctly at 50% zoom (viewport appears larger)', () => {
      // At 50% zoom, a 800x600 pixel viewport shows 1600x1200 canvas units
      const viewportInfo: ViewportInfo = {
        scrollX: 0,
        scrollY: 0,
        width: 1600,  // 800 / 0.5
        height: 1200, // 600 / 0.5
      };

      const center = getViewportCenter(viewportInfo);

      expect(center.x).toBe(800);  // 0 + 1600/2
      expect(center.y).toBe(600);  // 0 + 1200/2
    });

    it('should calculate center correctly at 200% zoom (viewport appears smaller)', () => {
      // At 200% zoom, a 800x600 pixel viewport shows 400x300 canvas units
      const viewportInfo: ViewportInfo = {
        scrollX: 0,
        scrollY: 0,
        width: 400,   // 800 / 2
        height: 300,  // 600 / 2
      };

      const center = getViewportCenter(viewportInfo);

      expect(center.x).toBe(200);  // 0 + 400/2
      expect(center.y).toBe(150);  // 0 + 300/2
    });

    it('should calculate center correctly at 100% zoom', () => {
      const viewportInfo: ViewportInfo = {
        scrollX: 100,
        scrollY: 200,
        width: 800,
        height: 600,
      };

      const center = getViewportCenter(viewportInfo);

      expect(center.x).toBe(500);  // 100 + 800/2
      expect(center.y).toBe(500);  // 200 + 600/2
    });
  });

  describe('Task 1.1: Center calculation with various scroll positions', () => {
    it('should account for horizontal scroll offset', () => {
      const viewportInfo: ViewportInfo = {
        scrollX: 500,
        scrollY: 0,
        width: 800,
        height: 600,
      };

      const center = getViewportCenter(viewportInfo);

      expect(center.x).toBe(900);  // 500 + 800/2
      expect(center.y).toBe(300);  // 0 + 600/2
    });

    it('should account for vertical scroll offset', () => {
      const viewportInfo: ViewportInfo = {
        scrollX: 0,
        scrollY: 400,
        width: 800,
        height: 600,
      };

      const center = getViewportCenter(viewportInfo);

      expect(center.x).toBe(400);  // 0 + 800/2
      expect(center.y).toBe(700);  // 400 + 600/2
    });

    it('should account for both horizontal and vertical scroll', () => {
      const viewportInfo: ViewportInfo = {
        scrollX: 300,
        scrollY: 500,
        width: 800,
        height: 600,
      };

      const center = getViewportCenter(viewportInfo);

      expect(center.x).toBe(700);  // 300 + 800/2
      expect(center.y).toBe(800);  // 500 + 600/2
    });

    it('should handle large scroll offsets correctly', () => {
      const viewportInfo: ViewportInfo = {
        scrollX: 1500,
        scrollY: 1200,
        width: 800,
        height: 600,
      };

      const center = getViewportCenter(viewportInfo);

      expect(center.x).toBe(1900);  // 1500 + 800/2
      expect(center.y).toBe(1500);  // 1200 + 600/2
    });
  });

  describe('Task 1.1: Fallback behavior when viewport info is null/undefined', () => {
    it('should return canvas center when viewportInfo is null', () => {
      const center = getViewportCenter(null);

      expect(center.x).toBe(DEFAULT_CANVAS_CENTER.x);
      expect(center.y).toBe(DEFAULT_CANVAS_CENTER.y);
    });

    it('should return canvas center when viewportInfo is undefined', () => {
      const center = getViewportCenter(undefined);

      expect(center.x).toBe(DEFAULT_CANVAS_CENTER.x);
      expect(center.y).toBe(DEFAULT_CANVAS_CENTER.y);
    });

    it('should return default center values of 1000, 1000', () => {
      // Verify the default canvas center is half of 2000x2000
      const center = getViewportCenter(null);

      expect(center.x).toBe(1000);
      expect(center.y).toBe(1000);
    });

    it('should return a new object each time for fallback (immutability)', () => {
      const center1 = getViewportCenter(null);
      const center2 = getViewportCenter(null);

      expect(center1).not.toBe(center2);
      expect(center1).toEqual(center2);
    });
  });
});

describe('getViewportCenterFromRaw', () => {
  it('should convert raw scroll/size values using zoom scale', () => {
    // Raw values at 100% zoom
    const center = getViewportCenterFromRaw(0, 0, 800, 600, 1.0);

    expect(center.x).toBe(400);
    expect(center.y).toBe(300);
  });

  it('should handle 50% zoom correctly', () => {
    // At 50% zoom, raw scroll of 200 becomes canvas scroll of 400
    const center = getViewportCenterFromRaw(200, 100, 800, 600, 0.5);

    // scrollX = 200/0.5 = 400, width = 800/0.5 = 1600, center.x = 400 + 800 = 1200
    // scrollY = 100/0.5 = 200, height = 600/0.5 = 1200, center.y = 200 + 600 = 800
    expect(center.x).toBe(1200);
    expect(center.y).toBe(800);
  });

  it('should handle 200% zoom correctly', () => {
    // At 200% zoom, raw scroll of 400 becomes canvas scroll of 200
    const center = getViewportCenterFromRaw(400, 200, 800, 600, 2.0);

    // scrollX = 400/2 = 200, width = 800/2 = 400, center.x = 200 + 200 = 400
    // scrollY = 200/2 = 100, height = 600/2 = 300, center.y = 100 + 150 = 250
    expect(center.x).toBe(400);
    expect(center.y).toBe(250);
  });
});
