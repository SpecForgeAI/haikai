/**
 * Activity Diagram Defaults Tests
 * Task Group 1: Activity Diagram Defaults and Type Definitions
 *
 * Tests for ACTIVITY_NODE_DEFAULTS, ACTIVITY_PARTITION_DEFAULTS, and ACTIVITY_FLOW_DEFAULTS constants.
 * These tests verify that the constants export correct values for Activity Diagram visualization.
 */

import {
  ACTIVITY_NODE_DEFAULTS,
  ACTIVITY_PARTITION_DEFAULTS,
  ACTIVITY_FLOW_DEFAULTS,
  entityColors,
} from '../config/defaults';

describe('Activity Diagram Defaults', () => {
  /**
   * Test 1: ACTIVITY_NODE_DEFAULTS exports correct shape definitions for all activityKind types
   */
  describe('ACTIVITY_NODE_DEFAULTS exports all activityKind configurations', () => {
    it('should export shape definitions for all 5 activityKind types', () => {
      // Verify all 5 activity kinds are defined
      expect(ACTIVITY_NODE_DEFAULTS).toHaveProperty('Initial');
      expect(ACTIVITY_NODE_DEFAULTS).toHaveProperty('Action');
      expect(ACTIVITY_NODE_DEFAULTS).toHaveProperty('Decision');
      expect(ACTIVITY_NODE_DEFAULTS).toHaveProperty('Merge');
      expect(ACTIVITY_NODE_DEFAULTS).toHaveProperty('Final');

      // Verify each kind has required properties
      const requiredProps = ['fill', 'stroke', 'stroke_width'];
      for (const kind of ['Initial', 'Action', 'Decision', 'Merge', 'Final'] as const) {
        for (const prop of requiredProps) {
          expect(ACTIVITY_NODE_DEFAULTS[kind]).toHaveProperty(prop);
        }
      }
    });

    it('should have showLabel property for each activityKind', () => {
      // Initial, Merge, Final should not show labels
      expect(ACTIVITY_NODE_DEFAULTS.Initial.showLabel).toBe(false);
      expect(ACTIVITY_NODE_DEFAULTS.Merge.showLabel).toBe(false);
      expect(ACTIVITY_NODE_DEFAULTS.Final.showLabel).toBe(false);

      // Action and Decision should show labels
      expect(ACTIVITY_NODE_DEFAULTS.Action.showLabel).toBe(true);
      expect(ACTIVITY_NODE_DEFAULTS.Decision.showLabel).toBe(true);
    });
  });

  /**
   * Test 2: Initial node defaults include black fill, 18px diameter
   */
  describe('Initial node defaults', () => {
    it('should have solid black circle styling with 18px diameter', () => {
      const initial = ACTIVITY_NODE_DEFAULTS.Initial;

      // Solid black circle
      expect(initial.fill).toBe('#000000');
      expect(initial.stroke).toBe('#000000');
      expect(initial.stroke_width).toBe(2);

      // 18px diameter
      expect(initial.diameter).toBe(18);

      // Circle shape
      expect(initial.shape).toBe('circle');

      // No label
      expect(initial.showLabel).toBe(false);
    });
  });

  /**
   * Test 3: Action node defaults include green theme, rounded rectangle dimensions
   */
  describe('Action node defaults', () => {
    it('should have green theme with rounded rectangle 140x50px', () => {
      const action = ACTIVITY_NODE_DEFAULTS.Action;

      // Green theme from entityColors.ACTIVITY
      expect(action.fill).toBe(entityColors.ACTIVITY.background);
      expect(action.stroke).toBe(entityColors.ACTIVITY.border);
      expect(action.stroke_width).toBe(2);

      // Rounded rectangle dimensions
      expect(action.width).toBe(140);
      expect(action.height).toBe(50);
      expect(action.shape).toBe('roundedRectangle');

      // Corner radius for pill-like appearance
      expect(action.cornerRadius).toBe(25);

      // Show label centered
      expect(action.showLabel).toBe(true);
    });
  });

  /**
   * Test 4: Decision/Merge/Final node defaults have correct neutral styling
   */
  describe('Decision, Merge, and Final node defaults', () => {
    it('should have correct neutral black/white styling for Decision node (60x60 diamond)', () => {
      const decision = ACTIVITY_NODE_DEFAULTS.Decision;

      // Neutral black/white styling
      expect(decision.fill).toBe('#FFFFFF');
      expect(decision.stroke).toBe('#000000');
      expect(decision.stroke_width).toBe(2);

      // Diamond shape 60x60
      expect(decision.shape).toBe('diamond');
      expect(decision.width).toBe(60);
      expect(decision.height).toBe(60);

      // Optional label (can show condition text)
      expect(decision.showLabel).toBe(true);
    });

    it('should have correct neutral styling for Merge node (20x20 diamond, no label)', () => {
      const merge = ACTIVITY_NODE_DEFAULTS.Merge;

      // Neutral black/white styling
      expect(merge.fill).toBe('#FFFFFF');
      expect(merge.stroke).toBe('#000000');
      expect(merge.stroke_width).toBe(2);

      // Diamond shape 20x20 (significantly smaller than Decision)
      expect(merge.shape).toBe('diamond');
      expect(merge.width).toBe(20);
      expect(merge.height).toBe(20);

      // No label by default
      expect(merge.showLabel).toBe(false);
    });

    it('should have correct neutral styling for Final node (22px bullseye)', () => {
      const final = ACTIVITY_NODE_DEFAULTS.Final;

      // Neutral black/white styling
      expect(final.fill).toBe('#000000');
      expect(final.stroke).toBe('#000000');
      expect(final.stroke_width).toBe(2);

      // Bullseye shape 22px diameter
      expect(final.shape).toBe('bullseye');
      expect(final.diameter).toBe(22);

      // Inner circle diameter (for bullseye)
      expect(final.innerDiameter).toBe(14);

      // No label
      expect(final.showLabel).toBe(false);
    });
  });

  /**
   * Additional tests for ACTIVITY_PARTITION_DEFAULTS
   */
  describe('ACTIVITY_PARTITION_DEFAULTS exports header/body styling', () => {
    it('should export correct header and body styling', () => {
      expect(ACTIVITY_PARTITION_DEFAULTS).toHaveProperty('header_height');
      expect(ACTIVITY_PARTITION_DEFAULTS.header_height).toBe(30);

      expect(ACTIVITY_PARTITION_DEFAULTS).toHaveProperty('header_background');
      expect(ACTIVITY_PARTITION_DEFAULTS).toHaveProperty('body_background');

      // Header should be slightly darker than body
      expect(ACTIVITY_PARTITION_DEFAULTS.header_background).not.toBe(
        ACTIVITY_PARTITION_DEFAULTS.body_background
      );
    });

    it('should export correct border and divider styling', () => {
      expect(ACTIVITY_PARTITION_DEFAULTS).toHaveProperty('border_color');
      expect(ACTIVITY_PARTITION_DEFAULTS).toHaveProperty('border_width');
      expect(ACTIVITY_PARTITION_DEFAULTS).toHaveProperty('divider_style');

      expect(ACTIVITY_PARTITION_DEFAULTS.border_width).toBeGreaterThan(0);
    });

    it('should export correct dimension defaults', () => {
      expect(ACTIVITY_PARTITION_DEFAULTS.default_width).toBe(200);
      expect(ACTIVITY_PARTITION_DEFAULTS.min_width).toBe(150);
    });

    it('should export VERTICAL as default orientation', () => {
      expect(ACTIVITY_PARTITION_DEFAULTS.orientation).toBe('VERTICAL');
    });
  });

  /**
   * Additional tests for ACTIVITY_FLOW_DEFAULTS
   */
  describe('ACTIVITY_FLOW_DEFAULTS exports edge styling defaults', () => {
    it('should export correct line styling', () => {
      expect(ACTIVITY_FLOW_DEFAULTS).toHaveProperty('line_color');
      expect(ACTIVITY_FLOW_DEFAULTS).toHaveProperty('line_width');
      expect(ACTIVITY_FLOW_DEFAULTS).toHaveProperty('arrow_size');

      expect(ACTIVITY_FLOW_DEFAULTS.line_width).toBeGreaterThan(0);
      expect(ACTIVITY_FLOW_DEFAULTS.arrow_size).toBeGreaterThan(0);
    });

    it('should export correct label styling', () => {
      expect(ACTIVITY_FLOW_DEFAULTS).toHaveProperty('label_font_size');
      expect(ACTIVITY_FLOW_DEFAULTS).toHaveProperty('label_offset');

      expect(ACTIVITY_FLOW_DEFAULTS.label_font_size).toBeGreaterThan(0);
    });

    it('should export Control as default flowKind', () => {
      expect(ACTIVITY_FLOW_DEFAULTS.flowKind).toBe('Control');
    });
  });
});
