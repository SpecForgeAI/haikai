/**
 * Tests for Sequence Diagram Participant Spacing Persistence
 *
 * Task Group 9: Participant Spacing Persistence
 *
 * These tests verify:
 * 1. participantSpacing reads from diagram.settings.sequence.participantSpacing
 * 2. Default value (220) is used when settings are unavailable
 * 3. Spacing changes persist to diagram settings on save
 */

import {
  PARTICIPANT_SPACING_DEFAULT,
  PARTICIPANT_SPACING_MIN,
  PARTICIPANT_SPACING_MAX,
  getParticipantSpacingFromSettings,
  createSettingsWithParticipantSpacing,
  isValidParticipantSpacing,
  clampParticipantSpacing,
} from '../utils/participantSpacingUtils';

describe('Sequence Diagram Spacing Persistence', () => {
  describe('getParticipantSpacingFromSettings - Task 9.3', () => {
    it('reads participantSpacing from diagram.settings.sequence.participantSpacing', () => {
      // Arrange: settings object with sequence.participantSpacing set
      const settings = {
        sequence: {
          participantSpacing: 300,
        },
      };

      // Act
      const spacing = getParticipantSpacingFromSettings(settings);

      // Assert
      expect(spacing).toBe(300);
    });

    it('returns default value (220) when settings is undefined', () => {
      // Act
      const spacing = getParticipantSpacingFromSettings(undefined);

      // Assert
      expect(spacing).toBe(PARTICIPANT_SPACING_DEFAULT);
      expect(spacing).toBe(220);
    });

    it('returns default value (220) when settings.sequence is undefined', () => {
      // Arrange: settings object without sequence property
      const settings = {
        someOtherSetting: 'value',
      };

      // Act
      const spacing = getParticipantSpacingFromSettings(settings);

      // Assert
      expect(spacing).toBe(PARTICIPANT_SPACING_DEFAULT);
    });

    it('returns default value (220) when settings.sequence.participantSpacing is undefined', () => {
      // Arrange: settings object with sequence but without participantSpacing
      const settings = {
        sequence: {
          someOtherProp: true,
        },
      };

      // Act
      const spacing = getParticipantSpacingFromSettings(settings);

      // Assert
      expect(spacing).toBe(PARTICIPANT_SPACING_DEFAULT);
    });

    it('returns default value when participantSpacing is outside valid range', () => {
      // Arrange: spacing below minimum
      const settingsBelowMin = {
        sequence: {
          participantSpacing: 50, // Below MIN of 120
        },
      };

      // Act & Assert
      expect(getParticipantSpacingFromSettings(settingsBelowMin)).toBe(PARTICIPANT_SPACING_DEFAULT);

      // Arrange: spacing above maximum
      const settingsAboveMax = {
        sequence: {
          participantSpacing: 1000, // Above MAX of 600
        },
      };

      // Act & Assert
      expect(getParticipantSpacingFromSettings(settingsAboveMax)).toBe(PARTICIPANT_SPACING_DEFAULT);
    });

    it('returns default value when participantSpacing is not a number', () => {
      // Arrange: spacing is a string
      const settingsWithString = {
        sequence: {
          participantSpacing: '300',
        },
      };

      // Act & Assert
      expect(getParticipantSpacingFromSettings(settingsWithString)).toBe(PARTICIPANT_SPACING_DEFAULT);

      // Arrange: spacing is null
      const settingsWithNull = {
        sequence: {
          participantSpacing: null,
        },
      };

      // Act & Assert
      expect(getParticipantSpacingFromSettings(settingsWithNull)).toBe(PARTICIPANT_SPACING_DEFAULT);
    });
  });

  describe('createSettingsWithParticipantSpacing - Task 9.4', () => {
    it('creates new settings object with participantSpacing when settings is undefined', () => {
      // Act
      const newSettings = createSettingsWithParticipantSpacing(undefined, 350);

      // Assert
      expect(newSettings).toEqual({
        sequence: {
          participantSpacing: 350,
        },
      });
    });

    it('preserves existing settings while adding sequence.participantSpacing', () => {
      // Arrange: existing settings with other properties
      const existingSettings = {
        layout: 'auto',
        theme: 'dark',
      };

      // Act
      const newSettings = createSettingsWithParticipantSpacing(existingSettings, 280);

      // Assert
      expect(newSettings).toEqual({
        layout: 'auto',
        theme: 'dark',
        sequence: {
          participantSpacing: 280,
        },
      });
    });

    it('preserves other sequence settings while updating participantSpacing', () => {
      // Arrange: existing settings with other sequence properties
      const existingSettings = {
        sequence: {
          showLabels: true,
          messageStyle: 'solid',
          participantSpacing: 200, // Old value
        },
      };

      // Act
      const newSettings = createSettingsWithParticipantSpacing(existingSettings, 400);

      // Assert
      expect(newSettings).toEqual({
        sequence: {
          showLabels: true,
          messageStyle: 'solid',
          participantSpacing: 400, // New value
        },
      });
    });

    it('clamps participantSpacing to valid range', () => {
      // Test: value below minimum is clamped
      const settingsBelowMin = createSettingsWithParticipantSpacing(undefined, 50);
      expect(settingsBelowMin.sequence.participantSpacing).toBe(PARTICIPANT_SPACING_MIN);

      // Test: value above maximum is clamped
      const settingsAboveMax = createSettingsWithParticipantSpacing(undefined, 1000);
      expect(settingsAboveMax.sequence.participantSpacing).toBe(PARTICIPANT_SPACING_MAX);

      // Test: NaN returns default
      const settingsNaN = createSettingsWithParticipantSpacing(undefined, NaN);
      expect(settingsNaN.sequence.participantSpacing).toBe(PARTICIPANT_SPACING_DEFAULT);
    });
  });

  describe('isValidParticipantSpacing - validation utility', () => {
    it('returns true for values within valid range', () => {
      expect(isValidParticipantSpacing(120)).toBe(true); // MIN
      expect(isValidParticipantSpacing(220)).toBe(true); // DEFAULT
      expect(isValidParticipantSpacing(400)).toBe(true); // Mid-range
      expect(isValidParticipantSpacing(600)).toBe(true); // MAX
    });

    it('returns false for values outside valid range', () => {
      expect(isValidParticipantSpacing(119)).toBe(false); // Just below MIN
      expect(isValidParticipantSpacing(601)).toBe(false); // Just above MAX
      expect(isValidParticipantSpacing(0)).toBe(false);
      expect(isValidParticipantSpacing(-100)).toBe(false);
      expect(isValidParticipantSpacing(1000)).toBe(false);
    });

    it('returns false for non-number values', () => {
      expect(isValidParticipantSpacing(NaN)).toBe(false);
      expect(isValidParticipantSpacing(Infinity)).toBe(false);
      expect(isValidParticipantSpacing(-Infinity)).toBe(false);
      // @ts-expect-error Testing runtime behavior with invalid type
      expect(isValidParticipantSpacing('220')).toBe(false);
      // @ts-expect-error Testing runtime behavior with invalid type
      expect(isValidParticipantSpacing(null)).toBe(false);
      // @ts-expect-error Testing runtime behavior with invalid type
      expect(isValidParticipantSpacing(undefined)).toBe(false);
    });
  });

  describe('clampParticipantSpacing - clamping utility', () => {
    it('returns the value unchanged when within valid range', () => {
      expect(clampParticipantSpacing(220)).toBe(220);
      expect(clampParticipantSpacing(300)).toBe(300);
      expect(clampParticipantSpacing(120)).toBe(120);
      expect(clampParticipantSpacing(600)).toBe(600);
    });

    it('clamps values below minimum to MIN', () => {
      expect(clampParticipantSpacing(0)).toBe(PARTICIPANT_SPACING_MIN);
      expect(clampParticipantSpacing(50)).toBe(PARTICIPANT_SPACING_MIN);
      expect(clampParticipantSpacing(119)).toBe(PARTICIPANT_SPACING_MIN);
      expect(clampParticipantSpacing(-100)).toBe(PARTICIPANT_SPACING_MIN);
    });

    it('clamps values above maximum to MAX', () => {
      expect(clampParticipantSpacing(601)).toBe(PARTICIPANT_SPACING_MAX);
      expect(clampParticipantSpacing(1000)).toBe(PARTICIPANT_SPACING_MAX);
      expect(clampParticipantSpacing(999999)).toBe(PARTICIPANT_SPACING_MAX);
    });

    it('returns DEFAULT for invalid inputs', () => {
      expect(clampParticipantSpacing(NaN)).toBe(PARTICIPANT_SPACING_DEFAULT);
      expect(clampParticipantSpacing(Infinity)).toBe(PARTICIPANT_SPACING_DEFAULT);
      expect(clampParticipantSpacing(-Infinity)).toBe(PARTICIPANT_SPACING_DEFAULT);
      // @ts-expect-error Testing runtime behavior with invalid type
      expect(clampParticipantSpacing('300')).toBe(PARTICIPANT_SPACING_DEFAULT);
      // @ts-expect-error Testing runtime behavior with invalid type
      expect(clampParticipantSpacing(null)).toBe(PARTICIPANT_SPACING_DEFAULT);
      // @ts-expect-error Testing runtime behavior with invalid type
      expect(clampParticipantSpacing(undefined)).toBe(PARTICIPANT_SPACING_DEFAULT);
    });
  });

  describe('Constants - valid values', () => {
    it('has correct constant values', () => {
      expect(PARTICIPANT_SPACING_DEFAULT).toBe(220);
      expect(PARTICIPANT_SPACING_MIN).toBe(120);
      expect(PARTICIPANT_SPACING_MAX).toBe(600);
    });
  });
});
