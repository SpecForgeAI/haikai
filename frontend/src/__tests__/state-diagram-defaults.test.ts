/**
 * State Diagram Defaults Tests
 * Task Group 1: Entity Type Registry and Defaults Configuration
 *
 * Tests for STATE_NODE_DEFAULTS, StateNodeShape type, and STATE_TRANSITION entity type registration.
 * These tests verify that the configuration layer for State Diagram visualization is correctly implemented.
 */

import { DIAGRAM_NODE_ENTITY_TYPE_MAP } from '../utils/entityTypeRegistry';
import {
  STATE_NODE_DEFAULTS,
  entityColors,
} from '../config/defaults';
import type { StateNodeShape, StateNodeDefaultConfig } from '../config/defaults';

describe('State Diagram Defaults - Task Group 1', () => {
  /**
   * Test 1: STATE_TRANSITION exists in DIAGRAM_NODE_ENTITY_TYPE_MAP
   * This ensures validation.ts will recognize STATE_TRANSITION as a valid entity type
   */
  describe('STATE_TRANSITION entity type registration', () => {
    it('should have STATE_TRANSITION registered in DIAGRAM_NODE_ENTITY_TYPE_MAP', () => {
      expect(DIAGRAM_NODE_ENTITY_TYPE_MAP).toHaveProperty('STATE_TRANSITION');
      expect(DIAGRAM_NODE_ENTITY_TYPE_MAP.STATE_TRANSITION).toBe('state_transitions');
    });

    it('should have STATE_TRANSITION in the Behavioural Domain section alongside STATE', () => {
      // Both STATE and STATE_TRANSITION should be registered
      expect(DIAGRAM_NODE_ENTITY_TYPE_MAP).toHaveProperty('STATE');
      expect(DIAGRAM_NODE_ENTITY_TYPE_MAP).toHaveProperty('STATE_TRANSITION');

      // Verify correct mappings
      expect(DIAGRAM_NODE_ENTITY_TYPE_MAP.STATE).toBe('states');
      expect(DIAGRAM_NODE_ENTITY_TYPE_MAP.STATE_TRANSITION).toBe('state_transitions');
    });
  });

  /**
   * Test 2: STATE_NODE_DEFAULTS contains Initial, Normal, Final configurations
   * Verifies all three state kinds have proper configuration objects
   */
  describe('STATE_NODE_DEFAULTS configuration', () => {
    it('should export configurations for all 3 StateKind types', () => {
      // Verify all 3 state kinds are defined
      expect(STATE_NODE_DEFAULTS).toHaveProperty('Initial');
      expect(STATE_NODE_DEFAULTS).toHaveProperty('Normal');
      expect(STATE_NODE_DEFAULTS).toHaveProperty('Final');
    });

    it('should have required properties for each state kind', () => {
      const requiredProps: (keyof StateNodeDefaultConfig)[] = [
        'shape',
        'fill',
        'stroke',
        'stroke_width',
        'showLabel',
      ];

      for (const kind of ['Initial', 'Normal', 'Final'] as const) {
        for (const prop of requiredProps) {
          expect(STATE_NODE_DEFAULTS[kind]).toHaveProperty(prop);
        }
      }
    });

    it('should have correct showLabel values for each state kind', () => {
      // Initial and Final should not show labels
      expect(STATE_NODE_DEFAULTS.Initial.showLabel).toBe(false);
      expect(STATE_NODE_DEFAULTS.Final.showLabel).toBe(false);

      // Normal should show labels
      expect(STATE_NODE_DEFAULTS.Normal.showLabel).toBe(true);
    });
  });

  /**
   * Test 3: StateNodeShape type is defined correctly
   * Verifies the shape values are valid according to the type definition
   */
  describe('StateNodeShape type definition', () => {
    it('should define correct shapes for each state kind', () => {
      // Initial: circle
      expect(STATE_NODE_DEFAULTS.Initial.shape).toBe('circle');

      // Normal: roundedRectangle
      expect(STATE_NODE_DEFAULTS.Normal.shape).toBe('roundedRectangle');

      // Final: bullseye
      expect(STATE_NODE_DEFAULTS.Final.shape).toBe('bullseye');
    });

    it('should only use shapes from StateNodeShape type', () => {
      const validShapes: StateNodeShape[] = ['circle', 'roundedRectangle', 'bullseye'];

      expect(validShapes).toContain(STATE_NODE_DEFAULTS.Initial.shape);
      expect(validShapes).toContain(STATE_NODE_DEFAULTS.Normal.shape);
      expect(validShapes).toContain(STATE_NODE_DEFAULTS.Final.shape);
    });
  });

  /**
   * Test 4: entityColors.STATE is used in Normal state defaults
   * Verifies Normal state uses the light green STATE color scheme
   */
  describe('Normal state uses entityColors.STATE', () => {
    it('should use entityColors.STATE.background for Normal state fill', () => {
      expect(STATE_NODE_DEFAULTS.Normal.fill).toBe(entityColors.STATE.background);
      // entityColors.STATE.background is '#E8F5E9' (light green)
      expect(STATE_NODE_DEFAULTS.Normal.fill).toBe('#E8F5E9');
    });

    it('should use entityColors.STATE.border for Normal state stroke', () => {
      expect(STATE_NODE_DEFAULTS.Normal.stroke).toBe(entityColors.STATE.border);
      // entityColors.STATE.border is '#4CAF50' (green)
      expect(STATE_NODE_DEFAULTS.Normal.stroke).toBe('#4CAF50');
    });

    it('should use neutral black for Initial and Final states (matching Activity control nodes)', () => {
      // Initial: solid black circle
      expect(STATE_NODE_DEFAULTS.Initial.fill).toBe('#000000');
      expect(STATE_NODE_DEFAULTS.Initial.stroke).toBe('#000000');

      // Final: black bullseye
      expect(STATE_NODE_DEFAULTS.Final.fill).toBe('#000000');
      expect(STATE_NODE_DEFAULTS.Final.stroke).toBe('#000000');
    });
  });

  /**
   * Additional tests for specific dimension values from spec
   */
  describe('STATE_NODE_DEFAULTS specific dimensions', () => {
    it('should have correct dimensions for Initial state (18px diameter)', () => {
      expect(STATE_NODE_DEFAULTS.Initial.diameter).toBe(18);
    });

    it('should have correct dimensions for Normal state (140x50px, 8px cornerRadius)', () => {
      expect(STATE_NODE_DEFAULTS.Normal.width).toBe(140);
      expect(STATE_NODE_DEFAULTS.Normal.height).toBe(50);
      expect(STATE_NODE_DEFAULTS.Normal.cornerRadius).toBe(8);
    });

    it('should have correct dimensions for Final state (22px diameter, 14px innerDiameter)', () => {
      expect(STATE_NODE_DEFAULTS.Final.diameter).toBe(22);
      expect(STATE_NODE_DEFAULTS.Final.innerDiameter).toBe(14);
    });
  });
});
