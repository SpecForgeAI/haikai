/**
 * State Node Shape Rendering Tests
 * Task Group 2: State Node Shape Rendering Functions
 *
 * Tests for state node shape rendering functions:
 * - renderInitialStateNode: Filled black circle with 18px diameter
 * - renderNormalStateNode: Rounded rectangle with label area
 * - renderFinalStateNode: Bullseye (outer + inner circles)
 * - renderStateNode: Dispatcher function based on state_kind
 * - States without state_kind default to Normal rendering
 */

import {
  renderInitialStateNode,
  renderNormalStateNode,
  renderFinalStateNode,
  renderStateNode,
  StateNodeRenderResult,
} from '../utils/stateNodeRendering';
import { STATE_NODE_DEFAULTS, entityColors } from '../config/defaults';
import { State } from '../types/model';

describe('State Node Shape Rendering', () => {
  /**
   * Test 1: renderInitialStateNode returns filled black circle path with 18px diameter
   */
  describe('renderInitialStateNode', () => {
    it('should return filled black circle path with 18px diameter', () => {
      const position = { x: 100, y: 100 };
      const result = renderInitialStateNode(position);

      // Verify it returns a valid StateNodeRenderResult
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
   * Test 2: renderNormalStateNode returns rounded rectangle path with label area
   */
  describe('renderNormalStateNode', () => {
    it('should return rounded rectangle path with label area', () => {
      const position = { x: 100, y: 100 };
      const result = renderNormalStateNode(position);

      // Verify it returns a valid StateNodeRenderResult
      expect(result).toBeDefined();
      expect(result.pathData).toBeDefined();
      expect(typeof result.pathData).toBe('string');

      // Verify green theme from entityColors.STATE
      expect(result.fill).toBe(entityColors.STATE.background);
      expect(result.stroke).toBe(entityColors.STATE.border);
      expect(result.strokeWidth).toBe(2);

      // Verify showLabel is true (Normal nodes show labels)
      expect(result.showLabel).toBe(true);

      // Verify dimensions match STATE_NODE_DEFAULTS.Normal
      expect(result.width).toBe(STATE_NODE_DEFAULTS.Normal.width);
      expect(result.height).toBe(STATE_NODE_DEFAULTS.Normal.height);

      // Verify text position is centered within the rectangle
      const expectedTextX = position.x; // Center of rectangle
      const expectedTextY = position.y; // Center of rectangle
      expect(result.textPosition.x).toBe(expectedTextX);
      expect(result.textPosition.y).toBe(expectedTextY);

      // Verify the path is a valid SVG path (contains line and arc commands for rounded corners)
      expect(result.pathData).toContain('M');
      expect(result.pathData).toContain('L');
      expect(result.pathData).toContain('A');
    });
  });

  /**
   * Test 3: renderFinalStateNode returns bullseye path (outer + inner circles)
   */
  describe('renderFinalStateNode', () => {
    it('should return bullseye path with outer 22px diameter and inner 14px diameter circles', () => {
      const position = { x: 100, y: 100 };
      const result = renderFinalStateNode(position);

      // Verify it returns a valid StateNodeRenderResult
      expect(result).toBeDefined();
      expect(result.pathData).toBeDefined();
      expect(typeof result.pathData).toBe('string');

      // Verify neutral black styling
      expect(result.fill).toBe('#000000');
      expect(result.stroke).toBe('#000000');
      expect(result.strokeWidth).toBe(2);

      // Verify showLabel is false (Final nodes have no label)
      expect(result.showLabel).toBe(false);

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
   * Test 4: renderStateNode dispatches correctly based on state_kind
   */
  describe('renderStateNode', () => {
    const position = { x: 100, y: 100 };

    it('should dispatch to renderInitialStateNode for Initial state_kind', () => {
      const state: State = {
        id: 'state-1',
        name: 'Start',
        state_kind: 'Initial',
      };
      const result = renderStateNode(state, position);

      // Initial node characteristics
      expect(result.showLabel).toBe(false);
      expect(result.fill).toBe('#000000');
      expect(result.pathData).toMatch(/A\s*9\s+9/); // 18px diameter circle
    });

    it('should dispatch to renderNormalStateNode for Normal state_kind', () => {
      const state: State = {
        id: 'state-2',
        name: 'Active State',
        state_kind: 'Normal',
      };
      const result = renderStateNode(state, position);

      // Normal node characteristics
      expect(result.showLabel).toBe(true);
      expect(result.fill).toBe(entityColors.STATE.background);
      expect(result.width).toBe(140);
      expect(result.height).toBe(50);
    });

    it('should dispatch to renderFinalStateNode for Final state_kind', () => {
      const state: State = {
        id: 'state-3',
        name: 'End',
        state_kind: 'Final',
      };
      const result = renderStateNode(state, position);

      // Final node characteristics
      expect(result.showLabel).toBe(false);
      expect(result.fill).toBe('#000000');
      expect(result.outerPathData).toBeDefined();
      expect(result.innerPathData).toBeDefined();
    });
  });

  /**
   * Test 5: States without state_kind default to Normal rendering
   */
  describe('renderStateNode backward compatibility', () => {
    it('should default to renderNormalStateNode if state_kind is missing', () => {
      const position = { x: 100, y: 100 };
      // Create state without state_kind (backward compatibility)
      const state = {
        id: 'state-legacy',
        name: 'Legacy State',
      } as State;
      const result = renderStateNode(state, position);

      // Should behave like Normal node
      expect(result.showLabel).toBe(true);
      expect(result.fill).toBe(entityColors.STATE.background);
      expect(result.width).toBe(140);
      expect(result.height).toBe(50);
    });

    it('should default to renderNormalStateNode for unknown state_kind values', () => {
      const position = { x: 100, y: 100 };
      // Create state with unknown state_kind
      const state = {
        id: 'state-unknown',
        name: 'Unknown State',
        state_kind: 'UnknownKind' as any,
      } as State;
      const result = renderStateNode(state, position);

      // Should behave like Normal node
      expect(result.showLabel).toBe(true);
      expect(result.fill).toBe(entityColors.STATE.background);
      expect(result.width).toBe(140);
      expect(result.height).toBe(50);
    });
  });
});
