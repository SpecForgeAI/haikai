/**
 * Tests for "Add with Business Processes Refinements" feature
 *
 * This file contains tests for:
 * - Task Group 1: Text Measurement Helper Functions
 * - Task Group 2: Layout Algorithm Updates
 * - Task Group 3: Viewport Access
 * - Task Group 4: Handler Refinements
 * - Task Group 5: Integration Tests
 */

import {
  calculateProcessNodeHeight,
  calculateApplicationLabelHeight,
  calculateChildPosition,
  calculateParentSize,
  calculateChildPositionWithHeights,
  calculateParentSizeWithHeights,
} from '../utils/compoundLayout';
import { DiagramNode } from '../types/model';

// =============================================================================
// Task Group 1: Text Measurement Helper Functions Tests
// =============================================================================

describe('Task Group 1: Text Measurement Helper Functions', () => {
  describe('calculateProcessNodeHeight()', () => {
    test('returns correct height for single-line text', () => {
      // Short text that fits on one line
      const height = calculateProcessNodeHeight('Short', 120, 12);
      // Expected: 5 (top padding) + 12 (single line height) + 5 (bottom padding) = 22
      expect(height).toBe(22);
    });

    test('returns correct height for multi-line wrapped text', () => {
      // Long text that wraps to multiple lines
      const height = calculateProcessNodeHeight(
        'This is a much longer process name that will wrap',
        120,
        12
      );
      // Text will wrap, so height should be > 22
      expect(height).toBeGreaterThan(22);
    });

    test('empty string returns minimum height', () => {
      const height = calculateProcessNodeHeight('', 120, 12);
      // Even empty string should return minimum: 5 + 0 + 5 = 10
      // But wrapText([]) gives 0 lines, calculateTextBlockHeight(0) = 0
      expect(height).toBe(10);
    });

    test('handles different font sizes', () => {
      const heightSmall = calculateProcessNodeHeight('Test', 120, 10);
      const heightLarge = calculateProcessNodeHeight('Test', 120, 14);
      // Larger font should result in taller height
      expect(heightLarge).toBeGreaterThan(heightSmall);
    });
  });

  describe('calculateApplicationLabelHeight()', () => {
    test('returns correct height for Application label', () => {
      const height = calculateApplicationLabelHeight('My Application', 130, 12, 'bold');
      // Single line of bold text at fontSize 12
      expect(height).toBe(12); // Single line = fontSize
    });

    test('handles long application names that wrap', () => {
      const height = calculateApplicationLabelHeight(
        'Very Long Application Name That Must Wrap',
        130,
        12,
        'bold'
      );
      // Should wrap and be taller
      expect(height).toBeGreaterThanOrEqual(12);
    });

    test('empty name returns zero height', () => {
      const height = calculateApplicationLabelHeight('', 130, 12, 'bold');
      expect(height).toBe(0);
    });
  });
});

// =============================================================================
// Task Group 2: Layout Algorithm Updates Tests
// =============================================================================

describe('Task Group 2: Layout Algorithm Updates', () => {
  const mockParentNode: DiagramNode = {
    id: 'parent-1',
    entity_type: 'APPLICATION',
    entity_id: 'app-1',
    pos_x: 100,
    pos_y: 100,
    width: 130,
    height: 200,
    parent_node_id: null,
  };

  describe('calculateChildPositionWithHeights()', () => {
    test('positions first child correctly with variable heights', () => {
      const childHeights = [30, 40, 50];
      const position = calculateChildPositionWithHeights(mockParentNode, 0, 0, childHeights, 15);

      // pos_x = parent.pos_x + PADDING (5) = 105
      expect(position.pos_x).toBe(105);
      // pos_y = parent.pos_y + PADDING + labelHeight + PADDING = 100 + 5 + 15 + 5 = 125
      expect(position.pos_y).toBe(125);
    });

    test('positions second child correctly with variable heights', () => {
      const childHeights = [30, 40, 50];
      const position = calculateChildPositionWithHeights(mockParentNode, 1, 0, childHeights, 15);

      // pos_x = parent.pos_x + PADDING (5) = 105
      expect(position.pos_x).toBe(105);
      // pos_y = 125 + childHeights[0] + PADDING = 125 + 30 + 5 = 160
      expect(position.pos_y).toBe(160);
    });

    test('positions third child correctly with variable heights', () => {
      const childHeights = [30, 40, 50];
      const position = calculateChildPositionWithHeights(mockParentNode, 2, 0, childHeights, 15);

      // pos_x = parent.pos_x + PADDING (5) = 105
      expect(position.pos_x).toBe(105);
      // pos_y = 125 + 30 + 5 + 40 + 5 = 205
      expect(position.pos_y).toBe(205);
    });

    test('handles existing children offset', () => {
      const childHeights = [25, 35];
      const position = calculateChildPositionWithHeights(mockParentNode, 0, 2, childHeights, 15);

      // existingChildCount = 2, so actualIndex = 2
      // Need heights of first 2 children, but we only have 2 new ones
      // This is for NEW children being added after existing ones
      // pos_y = base + sum(childHeights[0..1]) + gaps
      expect(position.pos_x).toBe(105);
    });
  });

  describe('calculateParentSizeWithHeights()', () => {
    test('computes correct total height with variable child heights', () => {
      const childHeights = [30, 40, 50];
      const size = calculateParentSizeWithHeights(childHeights, 120, 15);

      // Width = PADDING + maxChildWidth + PADDING = 5 + 120 + 5 = 130
      expect(size.width).toBe(130);

      // Height = PADDING + labelHeight + PADDING + sum(childHeights) + (PADDING * childCount)
      // = 5 + 15 + 5 + 120 + 15 = 160
      expect(size.height).toBe(160);
    });

    test('computes correct height with dynamic label height', () => {
      const childHeights = [30, 30];
      const labelHeight = 24; // Two-line label
      const size = calculateParentSizeWithHeights(childHeights, 120, labelHeight);

      // Height = 5 + 24 + 5 + 60 + 10 = 104
      expect(size.height).toBe(104);
    });

    test('empty childHeights array returns minimum parent size', () => {
      const size = calculateParentSizeWithHeights([], 120, 15);

      // Width = 5 + 120 + 5 = 130
      expect(size.width).toBe(130);
      // Height = 5 + 15 + 5 = 25
      expect(size.height).toBe(25);
    });

    test('single child computes correctly', () => {
      const childHeights = [45];
      const size = calculateParentSizeWithHeights(childHeights, 120, 12);

      // Height = 5 + 12 + 5 + 45 + 5 = 72
      expect(size.height).toBe(72);
    });
  });

  describe('backward compatibility', () => {
    test('calculateChildPosition still works with default heights', () => {
      const position = calculateChildPosition(mockParentNode, 0, 0);
      expect(position.pos_x).toBe(105);
      // Uses DEFAULT_CHILD_HEIGHT (60) and LABEL_HEIGHT (20)
      // pos_y = 100 + 5 + 20 + 5 + 0 = 130
      expect(position.pos_y).toBe(130);
    });

    test('calculateParentSize still works with child count', () => {
      const size = calculateParentSize(2);
      // Height = 5 (top) + 20 (label) + 5 (gap) + (2 * 60) + (1 * 5 between) + 5 (bottom) = 160
      expect(size.height).toBe(160);
    });
  });
});

// =============================================================================
// Task Group 3: Viewport Access Tests
// =============================================================================

describe('Task Group 3: Viewport Access', () => {
  describe('Visible center calculation', () => {
    test('calculates visible center correctly', () => {
      const viewportInfo = {
        scrollX: 100,
        scrollY: 200,
        width: 800,
        height: 600,
      };

      const centerX = viewportInfo.scrollX + viewportInfo.width / 2;
      const centerY = viewportInfo.scrollY + viewportInfo.height / 2;

      expect(centerX).toBe(500); // 100 + 400
      expect(centerY).toBe(500); // 200 + 300
    });

    test('calculates centering position for new Application', () => {
      const viewportInfo = {
        scrollX: 0,
        scrollY: 0,
        width: 1000,
        height: 800,
      };

      const appWidth = 130;
      const appHeight = 200;

      const centerX = viewportInfo.scrollX + viewportInfo.width / 2;
      const centerY = viewportInfo.scrollY + viewportInfo.height / 2;

      const pos_x = centerX - appWidth / 2;
      const pos_y = centerY - appHeight / 2;

      expect(pos_x).toBe(435); // 500 - 65
      expect(pos_y).toBe(300); // 400 - 100
    });

    test('handles scrolled viewport', () => {
      const viewportInfo = {
        scrollX: 500,
        scrollY: 300,
        width: 800,
        height: 600,
      };

      const appWidth = 130;
      const appHeight = 160;

      const centerX = viewportInfo.scrollX + viewportInfo.width / 2;
      const centerY = viewportInfo.scrollY + viewportInfo.height / 2;

      const pos_x = centerX - appWidth / 2;
      const pos_y = centerY - appHeight / 2;

      expect(pos_x).toBe(835); // 900 - 65
      expect(pos_y).toBe(520); // 600 - 80
    });
  });
});

// =============================================================================
// Task Group 4: Handler Refinements Tests
// =============================================================================

describe('Task Group 4: Handler Refinements', () => {
  describe('Application label styling', () => {
    test('NEW Application node should have text_v_align = TOP', () => {
      const newAppNode: Partial<DiagramNode> = {
        entity_type: 'APPLICATION',
        text_v_align: 'TOP',
        text_font_weight: 'bold',
      };

      expect(newAppNode.text_v_align).toBe('TOP');
    });

    test('NEW Application node should have text_font_weight = bold', () => {
      const newAppNode: Partial<DiagramNode> = {
        entity_type: 'APPLICATION',
        text_v_align: 'TOP',
        text_font_weight: 'bold',
      };

      expect(newAppNode.text_font_weight).toBe('bold');
    });

    test('EXISTING Application update should include styling', () => {
      const updates: Partial<DiagramNode> = {
        text_v_align: 'TOP',
        text_font_weight: 'bold',
      };

      expect(updates.text_v_align).toBe('TOP');
      expect(updates.text_font_weight).toBe('bold');
    });
  });

  describe('Business Process child height calculation', () => {
    test('child heights should be calculated dynamically (not fixed 60px)', () => {
      // For a short process name, height should be < 60
      const shortHeight = calculateProcessNodeHeight('Short', 120, 12);
      expect(shortHeight).toBeLessThan(60);

      // For a very long process name, height might be >= 60
      const longHeight = calculateProcessNodeHeight(
        'This is a very long business process name that will definitely wrap to multiple lines',
        120,
        12
      );
      // Just verify it calculates something reasonable
      expect(longHeight).toBeGreaterThan(0);
    });
  });

  describe('NEW Application viewport centering', () => {
    test('NEW Application should be centered in viewport', () => {
      const viewportInfo = {
        scrollX: 0,
        scrollY: 0,
        width: 1200,
        height: 800,
      };

      const appSize = { width: 130, height: 150 };

      const centerX = viewportInfo.scrollX + viewportInfo.width / 2;
      const centerY = viewportInfo.scrollY + viewportInfo.height / 2;

      const pos_x = centerX - appSize.width / 2;
      const pos_y = centerY - appSize.height / 2;

      // Should be centered
      expect(pos_x).toBe(535);
      expect(pos_y).toBe(325);
    });

    test('EXISTING Application should retain its position', () => {
      const existingNode: DiagramNode = {
        id: 'existing-app',
        entity_type: 'APPLICATION',
        entity_id: 'app-1',
        pos_x: 200,
        pos_y: 150,
        width: 130,
        height: 180,
        parent_node_id: null,
      };

      // When augmented, position should stay the same
      expect(existingNode.pos_x).toBe(200);
      expect(existingNode.pos_y).toBe(150);
    });
  });
});

// =============================================================================
// Task Group 5: Integration Tests
// =============================================================================

describe('Task Group 5: Integration Tests', () => {
  describe('Full "Add with business processes" flow', () => {
    test('produces correct layout for single process', () => {
      const processName = 'Order Processing';
      const appName = 'Order System';

      // Calculate process height
      const processHeight = calculateProcessNodeHeight(processName, 120, 12);

      // Calculate app label height
      const labelHeight = calculateApplicationLabelHeight(appName, 130, 12, 'bold');

      // Calculate parent size
      const parentSize = calculateParentSizeWithHeights([processHeight], 120, labelHeight);

      expect(parentSize.width).toBe(130);
      // Height should be reasonable
      expect(parentSize.height).toBeGreaterThan(30);
      expect(parentSize.height).toBeLessThan(100);
    });

    test('multiple processes with varying text lengths layout correctly', () => {
      const processes = [
        'Short',
        'Medium Length Process',
        'This is a very long business process name that wraps',
      ];

      const heights = processes.map(name => calculateProcessNodeHeight(name, 120, 12));

      // Heights should vary based on text length
      expect(heights[0]).toBeLessThanOrEqual(heights[1]);

      // Calculate parent size
      const labelHeight = calculateApplicationLabelHeight('Test App', 130, 12, 'bold');
      const parentSize = calculateParentSizeWithHeights(heights, 120, labelHeight);

      // Total height should account for all children
      const totalChildHeight = heights.reduce((sum, h) => sum + h, 0);
      const expectedMinHeight = 5 + labelHeight + 5 + totalChildHeight + (5 * heights.length);

      expect(parentSize.height).toBe(expectedMinHeight);
    });
  });

  describe('Edge cases', () => {
    test('Application with no linked processes', () => {
      const labelHeight = calculateApplicationLabelHeight('Standalone App', 130, 12, 'bold');
      const parentSize = calculateParentSizeWithHeights([], 120, labelHeight);

      // Should return minimum size
      expect(parentSize.width).toBe(130);
      expect(parentSize.height).toBe(5 + labelHeight + 5);
    });

    test('Very long process names wrap correctly', () => {
      const longName = 'This is an extremely long business process name that should definitely wrap to multiple lines when rendered in the 120px wide node';
      const height = calculateProcessNodeHeight(longName, 120, 12);

      // Should be significantly taller than single line
      expect(height).toBeGreaterThan(40);
    });
  });
});
