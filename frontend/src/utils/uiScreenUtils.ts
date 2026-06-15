/**
 * UI Screen Utility Functions
 *
 * Task Group 5: Helper functions for UI Screen diagram rendering
 * Provides utilities for CALL_API action display name derivation.
 * Task Group 5.1: Back-compatibility migration for legacy SET_STATE format
 */

import { MetaModel } from '../types/model';

/**
 * Mutation interface for SET_STATE effect
 * Task Group 3/5.1: Multiple mutations support
 */
export interface StateMutation {
  key: string;
  value?: string;
}

/**
 * SET_STATE effect interface (new format with mutations array)
 * Task Group 3: Multiple mutations support
 */
export interface SetStateEffect {
  type: 'SET_STATE';
  mutations: StateMutation[];
}

/**
 * Legacy SET_STATE effect interface (single key/value)
 * Task Group 5.1: Back-compatibility support
 */
export interface LegacySetStateEffect {
  type: 'SET_STATE';
  key: string;
  value?: string;
}

/**
 * Effect type that can be either legacy or new format
 */
export type AnySetStateEffect = SetStateEffect | LegacySetStateEffect | Record<string, unknown>;

/**
 * Type guard to check if effect has legacy format
 * Task Group 5.1: Detect legacy format
 */
export function isLegacySetStateEffect(
  effect: AnySetStateEffect
): effect is LegacySetStateEffect {
  if (!effect || typeof effect !== 'object') return false;
  const e = effect as Record<string, unknown>;
  return (
    e.type === 'SET_STATE' &&
    typeof e.key === 'string' &&
    !('mutations' in e)
  );
}

/**
 * Migrate legacy SET_STATE effect format to new mutations array format.
 * Task Group 5.1: In-memory migration for back-compatibility
 *
 * Legacy format: { type: 'SET_STATE', key: string, value?: string }
 * New format: { type: 'SET_STATE', mutations: [{ key, value? }] }
 *
 * This migration happens only in UI for rendering; does not modify database.
 *
 * @param effect - The effect object (may be legacy or new format)
 * @returns SetStateEffect in new format with mutations array
 */
export function migrateSetStateEffect(
  effect: AnySetStateEffect
): SetStateEffect {
  // If already has mutations array, return as-is (cast to SetStateEffect)
  if (effect && typeof effect === 'object' && 'mutations' in effect && Array.isArray((effect as SetStateEffect).mutations)) {
    return effect as SetStateEffect;
  }

  // Task Group 5.1: Detect and migrate legacy format
  if (isLegacySetStateEffect(effect)) {
    return {
      type: 'SET_STATE',
      mutations: [
        {
          key: effect.key,
          value: effect.value,
        },
      ],
    };
  }

  // Default: return empty mutations array
  return {
    type: 'SET_STATE',
    mutations: [],
  };
}

/**
 * Get display name for CALL_API action effect.
 * Looks up the endpoint and interface to construct "InterfaceName.EndpointName" format.
 *
 * @param endpointId - The endpoint ID from the CALL_API effect
 * @param metaModel - The meta model for entity lookups
 * @returns Display name in "InterfaceName.EndpointName" format, or "Unknown Endpoint" if not found
 */
export function getCallApiDisplayName(
  endpointId: string | undefined,
  metaModel: MetaModel | null
): { displayName: string; isValid: boolean } {
  if (!endpointId || !metaModel) {
    return { displayName: 'Unknown Endpoint', isValid: false };
  }

  // Look up endpoint by ID
  const endpoint = metaModel.entities.endpoints.find(e => e.id === endpointId);
  if (!endpoint) {
    return { displayName: 'Unknown Endpoint', isValid: false };
  }

  // Look up interface by endpoint's interface_id
  const interfaceEntity = metaModel.entities.interfaces.find(
    i => i.id === endpoint.interface_id
  );
  if (!interfaceEntity) {
    return { displayName: `?.${endpoint.name}`, isValid: false };
  }

  return {
    displayName: `${interfaceEntity.name}.${endpoint.name}`,
    isValid: true,
  };
}

/**
 * Component type options for UI Screen components.
 */
export const COMPONENT_TYPE_OPTIONS = [
  { value: 'FORM', label: 'Form' },
  { value: 'TABLE', label: 'Table' },
  { value: 'MODAL', label: 'Modal' },
  { value: 'NAV', label: 'Navigation' },
  { value: 'CARD', label: 'Card' },
  { value: 'DETAILS', label: 'Details' },
  { value: 'CUSTOM', label: 'Custom' },
] as const;

export type ComponentType = typeof COMPONENT_TYPE_OPTIONS[number]['value'];

/**
 * Trigger type options for UI Screen actions.
 */
export const TRIGGER_TYPE_OPTIONS = [
  { value: 'CLICK', label: 'Click' },
  { value: 'SUBMIT', label: 'Submit' },
  { value: 'LOAD', label: 'Load' },
  { value: 'CHANGE', label: 'Change' },
] as const;

export type TriggerType = typeof TRIGGER_TYPE_OPTIONS[number]['value'];

/**
 * Effect type options for UI Screen actions.
 */
export const EFFECT_TYPE_OPTIONS = [
  { value: 'NAVIGATE', label: 'Navigate' },
  { value: 'CALL_API', label: 'Call API' },
  { value: 'SET_STATE', label: 'Set State' },
] as const;

export type EffectType = typeof EFFECT_TYPE_OPTIONS[number]['value'];
