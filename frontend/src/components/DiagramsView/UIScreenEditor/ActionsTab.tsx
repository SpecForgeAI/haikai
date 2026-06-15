/**
 * ActionsTab Component
 *
 * Displays and manages action references for a UI_SCREEN diagram.
 * Shows a list of actions with their trigger types and effects.
 *
 * Task Group 5: Enhanced CALL_API display with derived interface/endpoint names
 * Task Group 5.1: Back-compatibility migration for legacy SET_STATE format
 */

import React from 'react';
import { UIScreenActionRef } from '../../../types/typedContent';
import { MetaModel } from '../../../types/model';
import { getCallApiDisplayName, migrateSetStateEffect } from '../../../utils/uiScreenUtils';

/**
 * Mutation interface for SET_STATE effect
 * Task Group 3/5.1: Multiple mutations support
 */
interface StateMutation {
  key: string;
  value?: string;
}

interface ActionDetails {
  name: string;
  trigger_type: string;
  effect_type: string;
  description?: string;
  // Task Group 5: Effect-specific data for CALL_API display
  effect?: {
    type: string;
    interface_endpoint_id?: string;
    target_screen_id?: string;
    // Legacy single key/value fields
    key?: string;
    value?: string;
    // New mutations array field (Task Group 3/5.1)
    mutations?: StateMutation[];
  };
}

interface ActionsTabProps {
  actions: UIScreenActionRef[];
  /** Map of action IDs to action details for display */
  actionDetails?: Map<string, ActionDetails>;
  /** Meta model for interface/endpoint lookups (Task Group 5) */
  metaModel?: MetaModel | null;
  onAddAction?: () => void;
  onRemoveAction?: (actionId: string) => void;
  onReorderActions?: (actions: UIScreenActionRef[]) => void;
}

/**
 * Get badge color for trigger type
 */
function getTriggerColor(triggerType: string): string {
  switch (triggerType?.toUpperCase()) {
    case 'CLICK':
      return '#1976d2';
    case 'SUBMIT':
      return '#388e3c';
    case 'CHANGE':
      return '#f57c00';
    case 'LOAD':
      return '#7b1fa2';
    case 'NAVIGATE':
      return '#0288d1';
    default:
      return '#757575';
  }
}

/**
 * Get badge color for effect type
 */
function getEffectColor(effectType: string): string {
  switch (effectType?.toUpperCase()) {
    case 'NAVIGATE':
      return '#0288d1';
    case 'CALL_API':
      return '#388e3c';
    case 'SET_STATE':
      return '#7b1fa2';
    case 'OPEN_MODAL':
      return '#f57c00';
    case 'CLOSE_MODAL':
      return '#795548';
    case 'VALIDATE':
      return '#1976d2';
    default:
      return '#757575';
  }
}

/**
 * Get display text for effect type with additional info
 * Task Group 5: Shows "CALL_API - InterfaceName.EndpointName" format
 */
function getEffectDisplayText(
  effectType: string,
  details: ActionDetails | undefined,
  metaModel: MetaModel | null | undefined
): { text: string; isValid: boolean } {
  if (effectType?.toUpperCase() === 'CALL_API' && details?.effect?.interface_endpoint_id) {
    const { displayName, isValid } = getCallApiDisplayName(
      details.effect.interface_endpoint_id,
      metaModel || null
    );
    return {
      text: `CALL_API - ${displayName}`,
      isValid,
    };
  }

  return { text: effectType || '', isValid: true };
}

/**
 * Get SET_STATE mutations for display
 * Task Group 5.1: Handles back-compatibility migration from legacy format
 */
function getSetStateMutations(effect: ActionDetails['effect'] | undefined): StateMutation[] {
  if (!effect || effect.type !== 'SET_STATE') {
    return [];
  }

  // Task Group 5.1: Migrate legacy format if needed
  const migratedEffect = migrateSetStateEffect(effect);
  return migratedEffect.mutations || [];
}

/**
 * ActionsTab - Manages action references for UI_SCREEN diagram
 */
export const ActionsTab: React.FC<ActionsTabProps> = ({
  actions,
  actionDetails = new Map(),
  metaModel,
  onAddAction,
  onRemoveAction,
}) => {
  return (
    <div className="ui-screen-actions-tab">
      <div style={{ padding: '16px' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '16px',
          }}
        >
          <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>
            Actions ({actions.length})
          </h3>
          {onAddAction && (
            <button
              onClick={onAddAction}
              style={{
                padding: '6px 12px',
                background: '#388e3c',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '12px',
              }}
              data-testid="add-action-button"
            >
              Add Action
            </button>
          )}
        </div>

        {actions.length === 0 ? (
          <div
            style={{
              padding: '24px',
              textAlign: 'center',
              color: '#999',
              background: '#f5f5f5',
              borderRadius: '4px',
            }}
          >
            No actions added yet.
            {onAddAction && ' Click "Add Action" to get started.'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {actions.map((action, index) => {
              // Get details from map or from embedded _metadata on action ref
              const details = actionDetails.get(action.action_id) || {
                name: (action as any)._name || action.action_id,
                trigger_type: (action as any)._trigger_type || '',
                effect_type: (action as any)._effect?.type || '',
                effect: (action as any)._effect,
              };

              // Task Group 5: Get effect display text with CALL_API resolution
              const effectDisplay = getEffectDisplayText(
                details.effect_type,
                details,
                metaModel
              );

              // Task Group 5.1: Get SET_STATE mutations with back-compat migration
              const setStateMutations = details.effect_type === 'SET_STATE'
                ? getSetStateMutations(details.effect)
                : [];

              return (
                <div
                  key={action.id}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    padding: '12px',
                    background: '#f9f9f9',
                    borderRadius: '4px',
                    border: '1px solid #e0e0e0',
                  }}
                  data-testid={`action-row-${index}`}
                >
                  <div
                    style={{
                      width: '24px',
                      height: '24px',
                      background: '#e8f5e9',
                      borderRadius: '50%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginRight: '12px',
                      fontSize: '12px',
                      fontWeight: 600,
                      color: '#388e3c',
                      flexShrink: 0,
                    }}
                  >
                    {index + 1}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 500, fontSize: '14px', marginBottom: '4px' }}>
                      {details.name}
                    </div>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                      {details.trigger_type && (
                        <span
                          style={{
                            padding: '2px 6px',
                            background: getTriggerColor(details.trigger_type),
                            color: 'white',
                            borderRadius: '3px',
                            fontSize: '10px',
                            fontWeight: 500,
                          }}
                        >
                          {details.trigger_type}
                        </span>
                      )}
                      {details.effect_type && (
                        <span
                          style={{
                            padding: '2px 6px',
                            background: getEffectColor(details.effect_type),
                            color: 'white',
                            borderRadius: '3px',
                            fontSize: '10px',
                            fontWeight: 500,
                          }}
                        >
                          {effectDisplay.text}
                        </span>
                      )}
                      {/* Task Group 5: Warning badge when endpoint lookup fails */}
                      {!effectDisplay.isValid && (
                        <span
                          style={{
                            padding: '2px 6px',
                            background: '#f57c00',
                            color: 'white',
                            borderRadius: '3px',
                            fontSize: '10px',
                            fontWeight: 500,
                          }}
                          title="Endpoint or Interface not found in meta-model"
                        >
                          Warning
                        </span>
                      )}
                    </div>
                    {/* Task Group 3/5.1: Display SET_STATE mutations */}
                    {details.effect_type === 'SET_STATE' && setStateMutations.length > 0 && (
                      <div style={{ marginTop: '8px', fontSize: '12px', color: '#666' }}>
                        <div style={{ fontWeight: 500, marginBottom: '4px' }}>Mutations:</div>
                        <ul style={{ margin: 0, paddingLeft: '16px' }}>
                          {setStateMutations.map((mutation, mIdx) => (
                            <li key={mIdx} style={{ marginBottom: '2px' }}>
                              <code style={{ background: '#f5f5f5', padding: '1px 4px', borderRadius: '2px' }}>
                                {mutation.key}
                              </code>
                              {mutation.value && (
                                <>
                                  {' = '}
                                  <code style={{ background: '#f5f5f5', padding: '1px 4px', borderRadius: '2px' }}>
                                    {mutation.value}
                                  </code>
                                </>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {details.description && (
                      <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
                        {details.description}
                      </div>
                    )}
                  </div>
                  {onRemoveAction && (
                    <button
                      onClick={() => onRemoveAction(action.id)}
                      style={{
                        padding: '4px 8px',
                        background: '#ffebee',
                        color: '#c62828',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontSize: '12px',
                        flexShrink: 0,
                      }}
                      data-testid={`remove-action-${index}`}
                    >
                      Remove
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default ActionsTab;
