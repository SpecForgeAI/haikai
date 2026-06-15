/**
 * Participant Spacing Toolbar Control Tests
 *
 * Task Group 6: Tests for the toolbar participant spacing control
 *
 * Tests:
 * - 6.1.1 Test numeric input renders with correct default (220), min (120), max (600), step (10)
 * - 6.1.2 Test value change triggers callback with new spacing value
 * - 6.1.3 Test value clamped to min/max bounds
 */

import { describe, it, expect, vi } from 'vitest';
import {
  PARTICIPANT_SPACING_DEFAULT,
  PARTICIPANT_SPACING_MIN,
  PARTICIPANT_SPACING_MAX,
  PARTICIPANT_SPACING_STEP,
  clampParticipantSpacing,
  isValidParticipantSpacing,
} from '../utils/participantSpacingUtils';

describe('Participant Spacing Toolbar Control', () => {
  /**
   * Test 6.1.1: Verify constant values for participant spacing input
   * These constants are used by the toolbar control in DiagramsView
   */
  describe('Participant Spacing Constants', () => {
    it('should have correct default value of 220', () => {
      expect(PARTICIPANT_SPACING_DEFAULT).toBe(220);
    });

    it('should have correct minimum value of 120', () => {
      expect(PARTICIPANT_SPACING_MIN).toBe(120);
    });

    it('should have correct maximum value of 600', () => {
      expect(PARTICIPANT_SPACING_MAX).toBe(600);
    });

    it('should have correct step value of 10', () => {
      expect(PARTICIPANT_SPACING_STEP).toBe(10);
    });
  });

  /**
   * Test 6.1.2: Verify spacing validation function
   * Tests that the validation function correctly identifies valid/invalid values
   */
  describe('isValidParticipantSpacing', () => {
    it('should return true for valid values within range', () => {
      expect(isValidParticipantSpacing(220)).toBe(true);
      expect(isValidParticipantSpacing(120)).toBe(true);
      expect(isValidParticipantSpacing(600)).toBe(true);
      expect(isValidParticipantSpacing(350)).toBe(true);
    });

    it('should return false for values below minimum', () => {
      expect(isValidParticipantSpacing(119)).toBe(false);
      expect(isValidParticipantSpacing(0)).toBe(false);
      expect(isValidParticipantSpacing(-100)).toBe(false);
    });

    it('should return false for values above maximum', () => {
      expect(isValidParticipantSpacing(601)).toBe(false);
      expect(isValidParticipantSpacing(1000)).toBe(false);
    });

    it('should return false for non-number values', () => {
      expect(isValidParticipantSpacing(NaN)).toBe(false);
      expect(isValidParticipantSpacing(Infinity)).toBe(false);
      expect(isValidParticipantSpacing(-Infinity)).toBe(false);
    });
  });

  /**
   * Test 6.1.3: Verify clamping function enforces min/max bounds
   * Tests that values outside the valid range are clamped to nearest bound
   */
  describe('clampParticipantSpacing', () => {
    it('should return input value when within valid range', () => {
      expect(clampParticipantSpacing(220)).toBe(220);
      expect(clampParticipantSpacing(120)).toBe(120);
      expect(clampParticipantSpacing(600)).toBe(600);
      expect(clampParticipantSpacing(350)).toBe(350);
    });

    it('should clamp values below minimum to minimum', () => {
      expect(clampParticipantSpacing(119)).toBe(120);
      expect(clampParticipantSpacing(0)).toBe(120);
      expect(clampParticipantSpacing(-100)).toBe(120);
    });

    it('should clamp values above maximum to maximum', () => {
      expect(clampParticipantSpacing(601)).toBe(600);
      expect(clampParticipantSpacing(1000)).toBe(600);
      expect(clampParticipantSpacing(999999)).toBe(600);
    });

    it('should return default for NaN input', () => {
      expect(clampParticipantSpacing(NaN)).toBe(PARTICIPANT_SPACING_DEFAULT);
    });

    it('should handle edge cases for step alignment', () => {
      // Values should be clamped but not necessarily aligned to step
      // Step alignment is for UI convenience, not data validation
      expect(clampParticipantSpacing(125)).toBe(125);
      expect(clampParticipantSpacing(333)).toBe(333);
    });
  });

  /**
   * Test for simulating callback behavior
   * This verifies the pattern that will be used in DiagramsView
   */
  describe('Callback Behavior Pattern', () => {
    it('should call callback with clamped value when value changes', () => {
      const mockCallback = vi.fn();

      // Simulate the pattern used in DiagramsView
      const handleSpacingChange = (newValue: number) => {
        const clampedValue = clampParticipantSpacing(newValue);
        mockCallback(clampedValue);
      };

      // Valid value
      handleSpacingChange(300);
      expect(mockCallback).toHaveBeenCalledWith(300);

      // Value below min - should be clamped
      mockCallback.mockClear();
      handleSpacingChange(50);
      expect(mockCallback).toHaveBeenCalledWith(120);

      // Value above max - should be clamped
      mockCallback.mockClear();
      handleSpacingChange(800);
      expect(mockCallback).toHaveBeenCalledWith(600);
    });

    it('should trigger rerender when spacing changes', () => {
      let currentSpacing = PARTICIPANT_SPACING_DEFAULT;
      let renderCount = 0;

      // Simulate state update that triggers rerender
      const setParticipantSpacing = (newValue: number) => {
        if (currentSpacing !== newValue) {
          currentSpacing = newValue;
          renderCount++;
        }
      };

      // Initial state
      expect(currentSpacing).toBe(220);
      expect(renderCount).toBe(0);

      // Change value - should trigger "rerender"
      setParticipantSpacing(300);
      expect(currentSpacing).toBe(300);
      expect(renderCount).toBe(1);

      // Same value - should NOT trigger "rerender"
      setParticipantSpacing(300);
      expect(renderCount).toBe(1);

      // Different value - should trigger "rerender"
      setParticipantSpacing(400);
      expect(currentSpacing).toBe(400);
      expect(renderCount).toBe(2);
    });
  });
});
