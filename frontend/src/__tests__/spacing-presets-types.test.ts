/**
 * Spacing Presets Types Tests
 *
 * Task Group 1: Type Definitions and Constants
 * Tests for SpacingPreset type, SpacingConfig interface, SPACING_PRESETS constant,
 * and DEFAULT_SPACING_PRESET constant.
 */

import { describe, it, expect } from 'vitest';
import {
  SpacingPreset,
  SpacingConfig,
  SPACING_PRESETS,
  DEFAULT_SPACING_PRESET,
} from '../types/advancedAdd';

// ============================================================================
// Task Group 1: Spacing Type Definitions Tests
// ============================================================================

describe('Spacing Presets Types', () => {
  describe('SpacingPreset type', () => {
    it('should accept valid preset values: spacious, normal, tight', () => {
      // Type checking - these should compile without errors
      const spacious: SpacingPreset = 'spacious';
      const normal: SpacingPreset = 'normal';
      const tight: SpacingPreset = 'tight';

      // Runtime verification
      expect(spacious).toBe('spacious');
      expect(normal).toBe('normal');
      expect(tight).toBe('tight');
    });
  });

  describe('SpacingConfig interface', () => {
    it('should have all required fields: paddingX, paddingY, childVerticalGap', () => {
      // Test that SpacingConfig has all required fields by creating a valid object
      const config: SpacingConfig = {
        paddingX: 10,
        paddingY: 10,
        childVerticalGap: 7,
      };

      // Verify all fields are present and have correct types (numbers)
      expect(typeof config.paddingX).toBe('number');
      expect(typeof config.paddingY).toBe('number');
      expect(typeof config.childVerticalGap).toBe('number');
    });
  });

  describe('SPACING_PRESETS constant', () => {
    it('should contain all three presets with correct values', () => {
      // Verify spacious preset
      expect(SPACING_PRESETS.spacious).toEqual({
        paddingX: 20,
        paddingY: 20,
        childVerticalGap: 10,
      });

      // Verify normal preset
      expect(SPACING_PRESETS.normal).toEqual({
        paddingX: 10,
        paddingY: 10,
        childVerticalGap: 7,
      });

      // Verify tight preset
      expect(SPACING_PRESETS.tight).toEqual({
        paddingX: 5,
        paddingY: 5,
        childVerticalGap: 4,
      });
    });

    it('should have all preset keys defined', () => {
      // Verify all three keys exist
      expect(SPACING_PRESETS).toHaveProperty('spacious');
      expect(SPACING_PRESETS).toHaveProperty('normal');
      expect(SPACING_PRESETS).toHaveProperty('tight');

      // Verify there are exactly 3 presets
      expect(Object.keys(SPACING_PRESETS)).toHaveLength(3);
    });
  });

  describe('DEFAULT_SPACING_PRESET constant', () => {
    it('should equal "normal"', () => {
      expect(DEFAULT_SPACING_PRESET).toBe('normal');
    });

    it('should be a valid key in SPACING_PRESETS', () => {
      // Verify the default preset maps to a valid config
      expect(SPACING_PRESETS[DEFAULT_SPACING_PRESET]).toBeDefined();
      expect(SPACING_PRESETS[DEFAULT_SPACING_PRESET]).toEqual(SPACING_PRESETS.normal);
    });
  });
});
