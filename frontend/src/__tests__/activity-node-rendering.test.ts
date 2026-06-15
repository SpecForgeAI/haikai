/**
 * Activity Node Shape Rendering Tests
 * Task Group 2: Activity Node Shape Functions
 *
 * Tests for activity node shape rendering functions:
 * - renderInitialNode: Filled black circle with 18px diameter
 * - renderActionNode: Rounded rectangle with label area
 * - renderDecisionNode: Diamond at 60x60px
 * - renderMergeNode: Diamond at 20x20px (smaller than Decision)
 * - renderFinalNode: Bullseye (outer + inner circles)
 * - renderActivityNode: Dispatcher function based on activityKind
 */

import {
  renderInitialNode,
  renderActionNode,
  renderDecisionNode,
  renderMergeNode,
  renderFinalNode,
  renderActivityNode,
  ActivityNodeRenderResult,
} from '../utils/activityNodeRendering';
import { ACTIVITY_NODE_DEFAULTS, entityColors } from '../config/defaults';
import { Activity } from '../types/model';

describe('Activity Node Shape Rendering', () => {
  /**
   * Test 1: renderInitialNode returns filled black circle path with 18px diameter
   */
  describe('renderInitialNode', () => {
    it('should return filled black circle path with 18px diameter', () => {
      const position = { x: 100, y: 100 };
      const result = renderInitialNode(position);

      // Verify it returns a valid ActivityNodeRenderResult
      expect(result).toBeDefined();
      expect(result.pathData).toBeDefined();
      expect(typeof result.pathData).toBe('string');

      // Verify black fill and stroke
      expect(result.fill).toBe('#000000');
      expect(result.stroke).toBe('#000000');
      expect(result.strokeWidth).toBe(2);

      // Verify showLabel is false (Initial nodes have no label)
      expect(result.showLabel).toBe(false);

      // Verify the path creates a circle (contains arc commands)
      expect(result.pathData).toContain('A');
      expect(result.pathData).toContain('M');

      // Verify diameter is 18px (radius is 9)
      // The path should include arc with radius 9
      expect(result.pathData).toMatch(/A\s*9\s+9/);

      // Verify text position is at center
      expect(result.textPosition.x).toBe(position.x);
      expect(result.textPosition.y).toBe(position.y);
    });
  });

  /**
   * Test 2: renderActionNode returns rounded rectangle path with label area
   */
  describe('renderActionNode', () => {
    it('should return rounded rectangle path with label area', () => {
      const position = { x: 100, y: 100 };
      const result = renderActionNode(position);

      // Verify it returns a valid ActivityNodeRenderResult
      expect(result).toBeDefined();
      expect(result.pathData).toBeDefined();
      expect(typeof result.pathData).toBe('string');

      // Verify green theme from entityColors.ACTIVITY
      expect(result.fill).toBe(entityColors.ACTIVITY.background);
      expect(result.stroke).toBe(entityColors.ACTIVITY.border);
      expect(result.strokeWidth).toBe(2);

      // Verify showLabel is true (Action nodes show labels)
      expect(result.showLabel).toBe(true);

      // Verify dimensions match ACTIVITY_NODE_DEFAULTS.Action
      expect(result.width).toBe(ACTIVITY_NODE_DEFAULTS.Action.width);
      expect(result.height).toBe(ACTIVITY_NODE_DEFAULTS.Action.height);

      // Verify text position is centered within the rectangle
      const expectedTextX = position.x; // Center of rectangle
      const expectedTextY = position.y; // Center of rectangle
      expect(result.textPosition.x).toBe(expectedTextX);
      expect(result.textPosition.y).toBe(expectedTextY);

      // Verify the path is a valid SVG path (contains line or arc commands)
      expect(result.pathData).toContain('M');
    });
  });

  /**
   * Test 3: renderDecisionNode returns diamond path at 60x60px
   */
  describe('renderDecisionNode', () => {
    it('should return diamond path at 60x60px', () => {
      const position = { x: 100, y: 100 };
      const result = renderDecisionNode(position);

      // Verify it returns a valid ActivityNodeRenderResult
      expect(result).toBeDefined();
      expect(result.pathData).toBeDefined();
      expect(typeof result.pathData).toBe('string');

      // Verify neutral black/white styling
      expect(result.fill).toBe('#FFFFFF');
      expect(result.stroke).toBe('#000000');
      expect(result.strokeWidth).toBe(2);

      // Verify showLabel is true (Decision nodes can show labels)
      expect(result.showLabel).toBe(true);

      // Verify dimensions are 60x60px
      expect(result.width).toBe(60);
      expect(result.height).toBe(60);

      // Verify the path creates a diamond (4 line segments)
      expect(result.pathData).toContain('M');
      expect(result.pathData).toContain('L');
      expect(result.pathData).toContain('Z');

      // Verify text position is at center
      expect(result.textPosition.x).toBe(position.x);
      expect(result.textPosition.y).toBe(position.y);
    });
  });

  /**
   * Test 4: renderMergeNode returns diamond path at 20x20px (smaller than Decision)
   */
  describe('renderMergeNode', () => {
    it('should return diamond path at 20x20px (smaller than Decision)', () => {
      const position = { x: 100, y: 100 };
      const result = renderMergeNode(position);

      // Verify it returns a valid ActivityNodeRenderResult
      expect(result).toBeDefined();
      expect(result.pathData).toBeDefined();
      expect(typeof result.pathData).toBe('string');

      // Verify neutral black/white styling
      expect(result.fill).toBe('#FFFFFF');
      expect(result.stroke).toBe('#000000');
      expect(result.strokeWidth).toBe(2);

      // Verify showLabel is false (Merge nodes have no label by default)
      expect(result.showLabel).toBe(false);

      // Verify dimensions are 20x20px (significantly smaller than Decision at 60x60)
      expect(result.width).toBe(20);
      expect(result.height).toBe(20);

      // Verify Merge is smaller than Decision
      const decisionResult = renderDecisionNode(position);
      expect(result.width).toBeLessThan(decisionResult.width!);
      expect(result.height).toBeLessThan(decisionResult.height!);

      // Verify the path creates a diamond
      expect(result.pathData).toContain('M');
      expect(result.pathData).toContain('L');
      expect(result.pathData).toContain('Z');
    });
  });

  /**
   * Test 5: renderFinalNode returns bullseye path (outer + inner circles)
   */
  describe('renderFinalNode', () => {
    it('should return bullseye path with outer 22px diameter and inner 14px diameter circles', () => {
      const position = { x: 100, y: 100 };
      const result = renderFinalNode(position);

      // Verify it returns a valid ActivityNodeRenderResult
      expect(result).toBeDefined();
      expect(result.pathData).toBeDefined();
      expect(typeof result.pathData).toBe('string');

      // Verify neutral black styling
      expect(result.fill).toBe('#000000');
      expect(result.stroke).toBe('#000000');
      expect(result.strokeWidth).toBe(2);

      // Verify showLabel is false (Final nodes have no label)
      expect(result.showLabel).toBe(false);

      // Verify outer diameter is 22px (radius 11)
      expect(result.outerDiameter).toBe(22);

      // Verify inner diameter is 14px (radius 7)
      expect(result.innerDiameter).toBe(14);

      // Verify the path contains two circles (outer stroke, inner fill)
      // Both should have arc commands
      expect(result.outerPathData).toContain('A');
      expect(result.innerPathData).toContain('A');

      // Verify outer circle radius is 11 (22/2)
      expect(result.outerPathData).toMatch(/A\s*11\s+11/);

      // Verify inner circle radius is 7 (14/2)
      expect(result.innerPathData).toMatch(/A\s*7\s+7/);

      // Verify text position is at center
      expect(result.textPosition.x).toBe(position.x);
      expect(result.textPosition.y).toBe(position.y);
    });
  });

  /**
   * Test 6: renderActivityNode dispatches correctly based on activityKind
   */
  describe('renderActivityNode', () => {
    const position = { x: 100, y: 100 };

    it('should dispatch to renderInitialNode for Initial activityKind', () => {
      const activity: Activity = {
        id: 'act-1',
        name: 'Start',
        activity_kind: 'Initial',
      };
      const result = renderActivityNode(activity, position);

      // Initial node characteristics
      expect(result.showLabel).toBe(false);
      expect(result.fill).toBe('#000000');
      expect(result.pathData).toMatch(/A\s*9\s+9/); // 18px diameter circle
    });

    it('should dispatch to renderActionNode for Action activityKind', () => {
      const activity: Activity = {
        id: 'act-2',
        name: 'Process Order',
        activity_kind: 'Action',
      };
      const result = renderActivityNode(activity, position);

      // Action node characteristics
      expect(result.showLabel).toBe(true);
      expect(result.fill).toBe(entityColors.ACTIVITY.background);
      expect(result.width).toBe(140);
      expect(result.height).toBe(50);
    });

    it('should dispatch to renderDecisionNode for Decision activityKind', () => {
      const activity: Activity = {
        id: 'act-3',
        name: 'Is Valid?',
        activity_kind: 'Decision',
      };
      const result = renderActivityNode(activity, position);

      // Decision node characteristics
      expect(result.showLabel).toBe(true);
      expect(result.fill).toBe('#FFFFFF');
      expect(result.width).toBe(60);
      expect(result.height).toBe(60);
    });

    it('should dispatch to renderMergeNode for Merge activityKind', () => {
      const activity: Activity = {
        id: 'act-4',
        name: 'Merge Point',
        activity_kind: 'Merge',
      };
      const result = renderActivityNode(activity, position);

      // Merge node characteristics
      expect(result.showLabel).toBe(false);
      expect(result.fill).toBe('#FFFFFF');
      expect(result.width).toBe(20);
      expect(result.height).toBe(20);
    });

    it('should dispatch to renderFinalNode for Final activityKind', () => {
      const activity: Activity = {
        id: 'act-5',
        name: 'End',
        activity_kind: 'Final',
      };
      const result = renderActivityNode(activity, position);

      // Final node characteristics
      expect(result.showLabel).toBe(false);
      expect(result.fill).toBe('#000000');
      expect(result.outerDiameter).toBe(22);
      expect(result.innerDiameter).toBe(14);
    });

    it('should default to renderActionNode if activityKind is missing', () => {
      // Create activity without activityKind (backward compatibility)
      const activity = {
        id: 'act-6',
        name: 'Legacy Activity',
      } as Activity;
      const result = renderActivityNode(activity, position);

      // Should behave like Action node
      expect(result.showLabel).toBe(true);
      expect(result.fill).toBe(entityColors.ACTIVITY.background);
      expect(result.width).toBe(140);
      expect(result.height).toBe(50);
    });
  });
});
