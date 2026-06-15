/**
 * Participant Spacing Utilities
 *
 * Task Group 6: Constants and utilities for the toolbar participant spacing control
 *
 * These constants and functions are used by:
 * - DiagramsView.tsx toolbar control
 * - SequenceDiagramRenderer for layout calculations
 * - Persistence layer for diagram settings
 */

/**
 * Default participant spacing in pixels
 * This is the horizontal distance between participant lifelines
 */
export const PARTICIPANT_SPACING_DEFAULT = 220;

/**
 * Minimum participant spacing in pixels
 * Below this value, participant headers may overlap
 */
export const PARTICIPANT_SPACING_MIN = 120;

/**
 * Maximum participant spacing in pixels
 * Above this value, the diagram becomes too wide
 */
export const PARTICIPANT_SPACING_MAX = 600;

/**
 * Step value for the participant spacing input
 * Controls the increment/decrement amount in the number input
 */
export const PARTICIPANT_SPACING_STEP = 10;

/**
 * Check if a participant spacing value is valid
 *
 * @param value - The spacing value to validate
 * @returns true if the value is within the valid range, false otherwise
 */
export function isValidParticipantSpacing(value: number): boolean {
  if (typeof value !== 'number' || isNaN(value) || !isFinite(value)) {
    return false;
  }
  return value >= PARTICIPANT_SPACING_MIN && value <= PARTICIPANT_SPACING_MAX;
}

/**
 * Clamp a participant spacing value to the valid range
 *
 * @param value - The spacing value to clamp
 * @returns The clamped value (between MIN and MAX), or DEFAULT if input is NaN
 */
export function clampParticipantSpacing(value: number): number {
  if (typeof value !== 'number' || isNaN(value) || !isFinite(value)) {
    return PARTICIPANT_SPACING_DEFAULT;
  }
  return Math.max(PARTICIPANT_SPACING_MIN, Math.min(PARTICIPANT_SPACING_MAX, value));
}

/**
 * Get participant spacing from diagram settings, with fallback to default
 *
 * @param settings - The diagram settings object (may be undefined)
 * @returns The participant spacing value from settings, or DEFAULT if not set
 */
export function getParticipantSpacingFromSettings(
  settings?: Record<string, unknown>
): number {
  if (!settings) {
    return PARTICIPANT_SPACING_DEFAULT;
  }

  const sequenceSettings = settings.sequence as Record<string, unknown> | undefined;
  if (!sequenceSettings) {
    return PARTICIPANT_SPACING_DEFAULT;
  }

  const spacing = sequenceSettings.participantSpacing;
  if (typeof spacing === 'number' && isValidParticipantSpacing(spacing)) {
    return spacing;
  }

  return PARTICIPANT_SPACING_DEFAULT;
}

/**
 * Create updated settings object with new participant spacing value
 *
 * @param currentSettings - The current diagram settings (may be undefined)
 * @param newSpacing - The new participant spacing value
 * @returns Updated settings object with the new spacing value
 */
export function createSettingsWithParticipantSpacing(
  currentSettings: Record<string, unknown> | undefined,
  newSpacing: number
): Record<string, unknown> {
  const clampedSpacing = clampParticipantSpacing(newSpacing);

  const baseSettings = currentSettings || {};
  const currentSequenceSettings = (baseSettings.sequence as Record<string, unknown>) || {};

  return {
    ...baseSettings,
    sequence: {
      ...currentSequenceSettings,
      participantSpacing: clampedSpacing,
    },
  };
}
