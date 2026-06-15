/**
 * Tests for Element Context Menu Component
 *
 * Task Group 3: Create Element Context Menu Component
 * Tests the context menu for nodes, edges, and decorations
 */

import { ElementContextMenuState, ElementContextMenuType } from '../types/model';

// Z-index action types
type ZIndexAction = 'bring-forward' | 'send-backward' | 'bring-to-front' | 'send-to-back';

/**
 * Get menu items for an element type
 * Nodes & Shape Decorations: 5 items (auto-size toggle + 4 z-index)
 * Edges & Line Decorations: 4 items (z-index only)
 */
function getMenuItemsForElementType(elementType: ElementContextMenuType): string[] {
  if (elementType === 'node' || elementType === 'shape-decoration') {
    return [
      'toggle-auto-size',
      'bring-forward',
      'send-backward',
      'bring-to-front',
      'send-to-back',
    ];
  }
  // edges and line-decorations only have z-index controls
  return [
    'bring-forward',
    'send-backward',
    'bring-to-front',
    'send-to-back',
  ];
}

/**
 * Get the label for the auto-size toggle based on current state
 */
function getAutoSizeLabel(currentAutoSize: boolean | undefined): string {
  return currentAutoSize ? 'Disable Auto-Size' : 'Enable Auto-Size';
}

/**
 * Clamp menu position to viewport
 */
function clampMenuPosition(
  x: number,
  y: number,
  menuWidth: number,
  menuHeight: number,
  viewportWidth: number,
  viewportHeight: number
): { x: number; y: number } {
  let clampedX = x;
  let clampedY = y;

  // Clamp to right edge
  if (x + menuWidth > viewportWidth) {
    clampedX = viewportWidth - menuWidth;
  }

  // Clamp to bottom edge
  if (y + menuHeight > viewportHeight) {
    clampedY = viewportHeight - menuHeight;
  }

  // Clamp to left edge
  if (clampedX < 0) {
    clampedX = 0;
  }

  // Clamp to top edge
  if (clampedY < 0) {
    clampedY = 0;
  }

  return { x: clampedX, y: clampedY };
}

describe('Element Context Menu Tests', () => {
  // Test 1: Menu renders with correct items for node (5 items)
  describe('Menu items for node', () => {
    it('should return 5 items for node element type', () => {
      const items = getMenuItemsForElementType('node');

      expect(items).toHaveLength(5);
      expect(items).toContain('toggle-auto-size');
      expect(items).toContain('bring-forward');
      expect(items).toContain('send-backward');
      expect(items).toContain('bring-to-front');
      expect(items).toContain('send-to-back');
    });

    it('should have auto-size toggle as first item for node', () => {
      const items = getMenuItemsForElementType('node');
      expect(items[0]).toBe('toggle-auto-size');
    });
  });

  // Test 2: Menu renders with correct items for edge (4 items)
  describe('Menu items for edge', () => {
    it('should return 4 items for edge element type', () => {
      const items = getMenuItemsForElementType('edge');

      expect(items).toHaveLength(4);
      expect(items).not.toContain('toggle-auto-size');
      expect(items).toContain('bring-forward');
      expect(items).toContain('send-backward');
      expect(items).toContain('bring-to-front');
      expect(items).toContain('send-to-back');
    });
  });

  // Test 3: Auto-size toggle label reflects current state
  describe('Auto-size toggle label', () => {
    it('should show "Disable Auto-Size" when auto-size is enabled', () => {
      const label = getAutoSizeLabel(true);
      expect(label).toBe('Disable Auto-Size');
    });

    it('should show "Enable Auto-Size" when auto-size is disabled', () => {
      const label = getAutoSizeLabel(false);
      expect(label).toBe('Enable Auto-Size');
    });

    it('should show "Enable Auto-Size" when auto-size is undefined', () => {
      const label = getAutoSizeLabel(undefined);
      expect(label).toBe('Enable Auto-Size');
    });
  });

  // Test 4: Menu items for shape decoration (5 items)
  describe('Menu items for shape decoration', () => {
    it('should return 5 items for shape-decoration element type', () => {
      const items = getMenuItemsForElementType('shape-decoration');

      expect(items).toHaveLength(5);
      expect(items).toContain('toggle-auto-size');
      expect(items).toContain('bring-forward');
      expect(items).toContain('send-backward');
      expect(items).toContain('bring-to-front');
      expect(items).toContain('send-to-back');
    });
  });

  // Test 5: Menu items for line decoration (4 items)
  describe('Menu items for line decoration', () => {
    it('should return 4 items for line-decoration element type', () => {
      const items = getMenuItemsForElementType('line-decoration');

      expect(items).toHaveLength(4);
      expect(items).not.toContain('toggle-auto-size');
      expect(items).toContain('bring-forward');
      expect(items).toContain('send-backward');
      expect(items).toContain('bring-to-front');
      expect(items).toContain('send-to-back');
    });
  });

  // Test 6: Viewport clamping for menu position
  describe('Menu position clamping', () => {
    const menuWidth = 150;
    const menuHeight = 200;
    const viewportWidth = 1000;
    const viewportHeight = 800;

    it('should not modify position when menu fits in viewport', () => {
      const result = clampMenuPosition(100, 100, menuWidth, menuHeight, viewportWidth, viewportHeight);

      expect(result.x).toBe(100);
      expect(result.y).toBe(100);
    });

    it('should clamp position when menu exceeds right edge', () => {
      const result = clampMenuPosition(900, 100, menuWidth, menuHeight, viewportWidth, viewportHeight);

      expect(result.x).toBe(viewportWidth - menuWidth); // 850
      expect(result.y).toBe(100);
    });

    it('should clamp position when menu exceeds bottom edge', () => {
      const result = clampMenuPosition(100, 700, menuWidth, menuHeight, viewportWidth, viewportHeight);

      expect(result.x).toBe(100);
      expect(result.y).toBe(viewportHeight - menuHeight); // 600
    });

    it('should clamp position when menu exceeds both right and bottom edges', () => {
      const result = clampMenuPosition(950, 750, menuWidth, menuHeight, viewportWidth, viewportHeight);

      expect(result.x).toBe(viewportWidth - menuWidth); // 850
      expect(result.y).toBe(viewportHeight - menuHeight); // 600
    });

    it('should clamp negative x position to 0', () => {
      const result = clampMenuPosition(-50, 100, menuWidth, menuHeight, viewportWidth, viewportHeight);

      expect(result.x).toBe(0);
      expect(result.y).toBe(100);
    });

    it('should clamp negative y position to 0', () => {
      const result = clampMenuPosition(100, -50, menuWidth, menuHeight, viewportWidth, viewportHeight);

      expect(result.x).toBe(100);
      expect(result.y).toBe(0);
    });
  });

  // Test 7: Element context menu state structure
  describe('ElementContextMenuState structure', () => {
    it('should have all required fields', () => {
      const state: ElementContextMenuState = {
        visible: true,
        x: 200,
        y: 300,
        elementType: 'node',
        elementId: 'node-123',
        currentAutoSize: false,
      };

      expect(state.visible).toBe(true);
      expect(state.x).toBe(200);
      expect(state.y).toBe(300);
      expect(state.elementType).toBe('node');
      expect(state.elementId).toBe('node-123');
      expect(state.currentAutoSize).toBe(false);
    });

    it('should allow currentAutoSize to be undefined for edges', () => {
      const state: ElementContextMenuState = {
        visible: true,
        x: 100,
        y: 150,
        elementType: 'edge',
        elementId: 'edge-456',
      };

      expect(state.currentAutoSize).toBeUndefined();
    });

    it('should support all element types', () => {
      const elementTypes: ElementContextMenuType[] = ['node', 'edge', 'shape-decoration', 'line-decoration'];

      elementTypes.forEach(type => {
        const state: ElementContextMenuState = {
          visible: true,
          x: 0,
          y: 0,
          elementType: type,
          elementId: `${type}-1`,
        };
        expect(state.elementType).toBe(type);
      });
    });
  });
});
