/**
 * ModeSelector Component
 * Task Group 5: Reusable mode selector for trigger/guard/effect/condition mode switching
 *
 * This component renders a set of radio buttons or segmented control for selecting
 * between different modes (e.g., Event/Method/Text for trigger).
 */

import styles from './ModeSelector.module.css';

export interface ModeSelectorOption {
  value: string;
  label: string;
}

export interface ModeSelectorProps {
  /** Label for the mode selector group */
  label: string;
  /** Array of mode options to display */
  modes: ModeSelectorOption[];
  /** Currently selected mode value */
  currentMode: string;
  /** Callback when mode is changed */
  onModeChange: (mode: string) => void;
  /** Optional test ID prefix */
  testIdPrefix?: string;
  /** Whether the selector is disabled */
  disabled?: boolean;
}

/**
 * ModeSelector Component
 *
 * Renders a horizontal segmented control for selecting between modes.
 * Used by edge inspectors for trigger, guard, effect, and condition mode switching.
 */
export function ModeSelector({
  label,
  modes,
  currentMode,
  onModeChange,
  testIdPrefix = 'mode-selector',
  disabled = false,
}: ModeSelectorProps) {
  return (
    <div className={styles.container} data-testid={`${testIdPrefix}-container`}>
      <span className={styles.label}>{label}</span>
      <div className={styles.segmentedControl}>
        {modes.map((mode) => (
          <button
            key={mode.value}
            type="button"
            className={`${styles.segment} ${currentMode === mode.value ? styles.segmentActive : ''}`}
            onClick={() => onModeChange(mode.value)}
            disabled={disabled}
            data-testid={`${testIdPrefix}-${mode.value.toLowerCase()}`}
          >
            {mode.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// Pre-defined mode options for common use cases

/**
 * Trigger mode options for StateTransition
 * StateTransition trigger is required, so no "None" option
 */
export const STATE_TRANSITION_TRIGGER_MODES: ModeSelectorOption[] = [
  { value: 'Event', label: 'Event' },
  { value: 'Method', label: 'Method' },
  { value: 'Text', label: 'Text' },
];

/**
 * Trigger mode options for ActivityFlow
 * ActivityFlow trigger is optional, so includes "None" option
 */
export const ACTIVITY_FLOW_TRIGGER_MODES: ModeSelectorOption[] = [
  { value: 'None', label: 'None' },
  { value: 'Event', label: 'Event' },
  { value: 'Method', label: 'Method' },
  { value: 'Text', label: 'Text' },
];

/**
 * Guard mode options for StateTransition
 * Guard is optional, so includes "None" option
 */
export const GUARD_MODES: ModeSelectorOption[] = [
  { value: 'None', label: 'None' },
  { value: 'Method', label: 'Method' },
  { value: 'Expression', label: 'Expression' },
];

/**
 * Effect mode options for StateTransition
 * Effect is optional, so includes "None" option
 */
export const EFFECT_MODES: ModeSelectorOption[] = [
  { value: 'None', label: 'None' },
  { value: 'Method', label: 'Method' },
  { value: 'Text', label: 'Text' },
];

/**
 * Condition mode options for ActivityFlow
 * Condition is optional, so includes "None" option
 */
export const CONDITION_MODES: ModeSelectorOption[] = [
  { value: 'None', label: 'None' },
  { value: 'Method', label: 'Method' },
  { value: 'Expression', label: 'Expression' },
];

/**
 * Helper to determine trigger mode from StateTransition entity
 */
export function getStateTransitionTriggerMode(entity: {
  trigger_ref_kind?: string;
  trigger_label_text?: string;
}): string {
  if (entity.trigger_ref_kind === 'Event') return 'Event';
  if (entity.trigger_ref_kind === 'Method') return 'Method';
  if (entity.trigger_label_text) return 'Text';
  return 'Event'; // Default for required trigger
}

/**
 * Helper to determine trigger mode from ActivityFlow entity
 */
export function getActivityFlowTriggerMode(entity: {
  trigger_ref_kind?: string;
  trigger_label_text?: string;
}): string {
  if (entity.trigger_ref_kind === 'Event') return 'Event';
  if (entity.trigger_ref_kind === 'Method') return 'Method';
  if (entity.trigger_label_text) return 'Text';
  return 'None'; // Default for optional trigger
}

/**
 * Helper to determine guard mode from StateTransition entity
 */
export function getGuardMode(entity: {
  guard_ref_kind?: string;
  guard_expression?: string;
}): string {
  if (entity.guard_ref_kind === 'Method') return 'Method';
  if (entity.guard_expression) return 'Expression';
  return 'None';
}

/**
 * Helper to determine effect mode from StateTransition entity
 */
export function getEffectMode(entity: {
  effect_ref_kind?: string;
  effect_label_text?: string;
}): string {
  if (entity.effect_ref_kind === 'Method') return 'Method';
  if (entity.effect_label_text) return 'Text';
  return 'None';
}

/**
 * Helper to determine condition mode from ActivityFlow entity
 */
export function getConditionMode(entity: {
  condition_ref_kind?: string;
  condition_expression?: string;
}): string {
  if (entity.condition_ref_kind === 'Method') return 'Method';
  if (entity.condition_expression) return 'Expression';
  return 'None';
}
