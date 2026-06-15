/**
 * AddActionModal Component
 *
 * Task Group 4: Modal for adding UI screen actions
 * Allows users to add actions to a UI_SCREEN diagram via a form.
 * Shows conditional fields based on effect type selection.
 *
 * Enhancements (2026-01-02 UI Screen Actions Enhancement):
 * - Task Group 1: Navigate dropdown populated from full meta-model
 * - Task Group 3: Multiple state mutations with mutations[] array schema
 * - Task Group 4: Key autocomplete with entity/attribute suggestions
 * - Task Group 5: Back-compatibility migration and form validation
 *
 * Follows EditActivityFlowConditionModal.tsx pattern.
 */

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { UIScreenActionRef } from '../../../../types/typedContent';
import { MetaModel, UIScreen } from '../../../../types/model';
import { generatePrefixedId } from '../../../../utils/idGenerator';
import { TRIGGER_TYPE_OPTIONS, EFFECT_TYPE_OPTIONS, TriggerType, EffectType } from '../../../../utils/uiScreenUtils';
import { InterfaceEndpointPicker } from './InterfaceEndpointPicker';
import styles from './AddActionModal.module.css';

/**
 * Mutation interface for SET_STATE effect
 * Task Group 3: Multiple mutations support
 */
export interface StateMutation {
  key: string;
  value?: string;
}

/**
 * Props for the AddActionModal component
 */
export interface AddActionModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Callback when modal is closed (cancel) */
  onClose: () => void;
  /** Callback when action is added */
  onAdd: (actionRef: UIScreenActionRef) => void;
  /** Meta model for entity lookups (InterfaceEndpointPicker, UIScreen picker) */
  metaModel: MetaModel | null;
  /** List of UI Screens for NAVIGATE picker */
  uiScreens?: UIScreen[];
}

/**
 * AddActionModal Component
 *
 * Modal for adding actions to a UI_SCREEN diagram.
 */
export function AddActionModal({
  isOpen,
  onClose,
  onAdd,
  metaModel,
  uiScreens = [],
}: AddActionModalProps) {
  // Form state
  const [name, setName] = useState('');
  const [triggerType, setTriggerType] = useState<TriggerType>('CLICK');
  const [effectType, setEffectType] = useState<EffectType>('NAVIGATE');

  // Effect-specific fields
  const [targetScreenId, setTargetScreenId] = useState<string>('');
  const [interfaceEndpointId, setInterfaceEndpointId] = useState<string | undefined>(undefined);

  // Task Group 3: Replace single stateKey/stateValue with mutations array
  const [mutations, setMutations] = useState<StateMutation[]>([{ key: '', value: '' }]);

  const [errors, setErrors] = useState<Record<string, string>>({});

  // Task Group 1: Get all UIScreens from metaModel, fallback to uiScreens prop
  const allUIScreens = useMemo((): UIScreen[] => {
    // Prefer metaModel.entities.ui_screens if available and non-empty
    if (metaModel && metaModel.entities.ui_screens && metaModel.entities.ui_screens.length > 0) {
      return metaModel.entities.ui_screens;
    }
    // Fallback to uiScreens prop
    return uiScreens;
  }, [metaModel, uiScreens]);

  // Task Group 4: Build autocomplete suggestions from logical entities and attributes
  const keySuggestions = useMemo((): string[] => {
    if (!metaModel) return [];

    const suggestions: Set<string> = new Set();

    // Add entity names
    const logicalEntities = metaModel.entities.logical_data_entities || [];
    for (const entity of logicalEntities) {
      suggestions.add(entity.name);
    }

    // Add entity.attribute format
    const logicalAttributes = metaModel.entities.logical_data_attributes || [];
    for (const attr of logicalAttributes) {
      // Find parent entity
      const parentEntity = logicalEntities.find(e => e.id === attr.logical_entity_id);
      if (parentEntity) {
        suggestions.add(`${parentEntity.name}.${attr.name}`);
      }
    }

    // Convert to sorted array
    return Array.from(suggestions).sort((a, b) => a.localeCompare(b));
  }, [metaModel]);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setName('');
      setTriggerType('CLICK');
      setEffectType('NAVIGATE');
      setTargetScreenId('');
      setInterfaceEndpointId(undefined);
      // Task Group 3: Reset mutations to single empty row
      setMutations([{ key: '', value: '' }]);
      setErrors({});
    }
  }, [isOpen]);

  // Handle name change
  const handleNameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setName(e.target.value);
    setErrors(prev => ({ ...prev, name: '' }));
  }, []);

  // Handle trigger type change
  const handleTriggerTypeChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setTriggerType(e.target.value as TriggerType);
  }, []);

  // Handle effect type change
  const handleEffectTypeChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setEffectType(e.target.value as EffectType);
    // Clear effect-specific errors
    setErrors(prev => {
      const newErrors = { ...prev };
      delete newErrors.targetScreenId;
      delete newErrors.interfaceEndpointId;
      delete newErrors.mutations;
      return newErrors;
    });
  }, []);

  // Handle NAVIGATE target screen change
  const handleTargetScreenChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setTargetScreenId(e.target.value);
    setErrors(prev => ({ ...prev, targetScreenId: '' }));
  }, []);

  // Handle CALL_API endpoint change
  const handleEndpointChange = useCallback((endpointId: string | undefined) => {
    setInterfaceEndpointId(endpointId);
    setErrors(prev => ({ ...prev, interfaceEndpointId: '' }));
  }, []);

  // Task Group 3: Handle mutation key change
  const handleMutationKeyChange = useCallback((index: number, value: string) => {
    setMutations(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], key: value };
      return updated;
    });
    setErrors(prev => ({ ...prev, mutations: '' }));
  }, []);

  // Task Group 3: Handle mutation value change
  const handleMutationValueChange = useCallback((index: number, value: string) => {
    setMutations(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], value: value };
      return updated;
    });
  }, []);

  // Task Group 3: Add new mutation row
  const handleAddMutation = useCallback(() => {
    setMutations(prev => [...prev, { key: '', value: '' }]);
  }, []);

  // Task Group 3: Remove mutation row
  const handleRemoveMutation = useCallback((index: number) => {
    setMutations(prev => {
      // Don't remove if only one row
      if (prev.length <= 1) return prev;
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  // Task Group 5: Validate form
  const validateForm = useCallback((): boolean => {
    const newErrors: Record<string, string> = {};

    if (!name.trim()) {
      newErrors.name = 'Name is required';
    }

    // Validate effect-specific fields
    switch (effectType) {
      case 'NAVIGATE':
        // Task Group 5.3: Verify Navigate validation
        if (!targetScreenId) {
          newErrors.targetScreenId = 'Target screen is required';
        }
        break;
      case 'CALL_API':
        // Task Group 5.4: Verify Call API validation
        if (!interfaceEndpointId) {
          newErrors.interfaceEndpointId = 'Endpoint is required';
        }
        break;
      case 'SET_STATE':
        // Task Group 5.2: Validate at least one mutation with non-empty key
        const hasValidMutation = mutations.some(m => m.key.trim() !== '');
        if (!hasValidMutation) {
          newErrors.mutations = 'At least one mutation with a key is required';
        }
        break;
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [name, effectType, targetScreenId, interfaceEndpointId, mutations]);

  // Task Group 5.5: Check if form is valid for button enablement
  const isFormValid = useMemo((): boolean => {
    // Name must be set
    if (!name.trim()) return false;

    // Effect-specific validation
    switch (effectType) {
      case 'NAVIGATE':
        if (!targetScreenId) return false;
        break;
      case 'CALL_API':
        if (!interfaceEndpointId) return false;
        break;
      case 'SET_STATE':
        // At least one mutation with non-empty key
        const hasValidMutation = mutations.some(m => m.key.trim() !== '');
        if (!hasValidMutation) return false;
        break;
    }

    return true;
  }, [name, effectType, targetScreenId, interfaceEndpointId, mutations]);

  // Handle form submission
  const handleSubmit = useCallback(() => {
    if (!validateForm()) {
      return;
    }

    // Build effect object based on type
    let effect: Record<string, unknown>;
    switch (effectType) {
      case 'NAVIGATE':
        effect = {
          type: 'NAVIGATE',
          target_screen_id: targetScreenId,
        };
        break;
      case 'CALL_API':
        effect = {
          type: 'CALL_API',
          interface_endpoint_id: interfaceEndpointId,
        };
        break;
      case 'SET_STATE':
        // Task Group 3.5: Persist using new mutations array schema
        // Filter out empty mutations and trim values
        const validMutations = mutations
          .filter(m => m.key.trim() !== '')
          .map(m => ({
            key: m.key.trim(),
            value: m.value?.trim() || undefined,
          }));
        effect = {
          type: 'SET_STATE',
          mutations: validMutations,
        };
        break;
      default:
        return;
    }

    // Generate action ref
    const actionRef: UIScreenActionRef = {
      id: generatePrefixedId('uiactionref'),
      action_id: generatePrefixedId('uiaction'),
    };

    // Store action details in a way that can be retrieved for display
    // Since UIScreenActionRef is minimal, we store metadata alongside
    // This will be used by the ActionsTab for display
    (actionRef as any)._name = name.trim();
    (actionRef as any)._trigger_type = triggerType;
    (actionRef as any)._effect = effect;

    onAdd(actionRef);
    onClose();
  }, [validateForm, name, triggerType, effectType, targetScreenId, interfaceEndpointId, mutations, onAdd, onClose]);

  // Handle cancel
  const handleCancel = useCallback(() => {
    onClose();
  }, [onClose]);

  // Handle overlay click (close on click outside)
  const handleOverlayClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }, [onClose]);

  // Handle Escape key to close modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      return () => {
        document.removeEventListener('keydown', handleKeyDown);
      };
    }
  }, [isOpen, onClose]);

  // Don't render if not open
  if (!isOpen) {
    return null;
  }

  // Task Group 1.3: Format screen option label
  const formatScreenLabel = (screen: UIScreen): string => {
    return screen.route ? `${screen.name} (${screen.route})` : screen.name;
  };

  return (
    <div className={styles.overlay} onClick={handleOverlayClick}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className={styles.header}>
          <h2 className={styles.title}>Add Action</h2>
          <button className={styles.closeButton} onClick={handleCancel} title="Close">
            &times;
          </button>
        </div>

        {/* Content */}
        <div className={styles.content}>
          <div className={styles.form}>
            {/* Name Field */}
            <div className={styles.formGroup}>
              <label className={styles.label}>
                Name
                <span className={styles.required}>*</span>
              </label>
              <input
                type="text"
                className={`${styles.input} ${errors.name ? styles.inputError : ''}`}
                value={name}
                onChange={handleNameChange}
                placeholder="Enter action name"
                data-testid="action-name-input"
              />
              {errors.name && <span className={styles.errorMessage}>{errors.name}</span>}
            </div>

            {/* Trigger Type Field */}
            <div className={styles.formGroup}>
              <label className={styles.label}>
                Trigger
                <span className={styles.required}>*</span>
              </label>
              <select
                className={styles.select}
                value={triggerType}
                onChange={handleTriggerTypeChange}
                data-testid="action-trigger-select"
              >
                {TRIGGER_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.divider} />

            {/* Effect Type Field */}
            <div className={styles.sectionTitle}>Effect</div>
            <div className={styles.formGroup}>
              <label className={styles.label}>
                Effect Type
                <span className={styles.required}>*</span>
              </label>
              <select
                className={styles.select}
                value={effectType}
                onChange={handleEffectTypeChange}
                data-testid="action-effect-type-select"
              >
                {EFFECT_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Conditional Fields based on Effect Type */}
            <div className={styles.conditionalFields}>
              {effectType === 'NAVIGATE' && (
                <div className={styles.formGroup}>
                  <label className={styles.label}>
                    Target Screen
                    <span className={styles.required}>*</span>
                  </label>
                  <select
                    className={`${styles.select} ${errors.targetScreenId ? styles.inputError : ''}`}
                    value={targetScreenId}
                    onChange={handleTargetScreenChange}
                    data-testid="action-target-screen-select"
                  >
                    <option value="">-- Select Screen --</option>
                    {/* Task Group 1.2: Use allUIScreens from metaModel */}
                    {allUIScreens.map((screen) => (
                      <option key={screen.id} value={screen.id}>
                        {/* Task Group 1.3: Updated label format */}
                        {formatScreenLabel(screen)}
                      </option>
                    ))}
                  </select>
                  {errors.targetScreenId && (
                    <span className={styles.errorMessage}>{errors.targetScreenId}</span>
                  )}
                  {/* Task Group 1.4: Hint when no UIScreens exist */}
                  {allUIScreens.length === 0 && (
                    <span className={styles.hint}>
                      No UI Screens available. Create screens in the Meta-Model view first.
                    </span>
                  )}
                </div>
              )}

              {effectType === 'CALL_API' && (
                <div className={styles.formGroup}>
                  <InterfaceEndpointPicker
                    metaModel={metaModel}
                    value={interfaceEndpointId}
                    onChange={handleEndpointChange}
                  />
                  {errors.interfaceEndpointId && (
                    <span className={styles.errorMessage}>{errors.interfaceEndpointId}</span>
                  )}
                </div>
              )}

              {effectType === 'SET_STATE' && (
                <div className={styles.formGroup}>
                  {/* Task Group 3: Multiple mutations UI */}
                  <label className={styles.label}>
                    State Mutations
                    <span className={styles.required}>*</span>
                  </label>

                  {/* Task Group 4.3: Datalist for key autocomplete */}
                  <datalist id="state-key-suggestions">
                    {keySuggestions.map((suggestion, idx) => (
                      <option key={idx} value={suggestion} />
                    ))}
                  </datalist>

                  <div className={styles.mutationsList}>
                    {mutations.map((mutation, index) => (
                      <div key={index} className={styles.mutationRow} data-testid={`mutation-row-${index}`}>
                        <div className={styles.mutationInputGroup}>
                          <input
                            type="text"
                            className={`${styles.mutationInput} ${styles.mutationKeyInput}`}
                            value={mutation.key}
                            onChange={(e) => handleMutationKeyChange(index, e.target.value)}
                            placeholder="Key (e.g., isLoading)"
                            list="state-key-suggestions"
                            data-testid={`mutation-key-input-${index}`}
                          />
                          <input
                            type="text"
                            className={`${styles.mutationInput} ${styles.mutationValueInput}`}
                            value={mutation.value || ''}
                            onChange={(e) => handleMutationValueChange(index, e.target.value)}
                            placeholder="Value (optional)"
                            data-testid={`mutation-value-input-${index}`}
                          />
                          <button
                            type="button"
                            className={styles.removeMutationButton}
                            onClick={() => handleRemoveMutation(index)}
                            disabled={mutations.length <= 1}
                            title={mutations.length <= 1 ? 'At least one mutation required' : 'Remove mutation'}
                            data-testid={`remove-mutation-${index}`}
                          >
                            &times;
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Task Group 3.3: Add Mutation button */}
                  <button
                    type="button"
                    className={styles.addMutationButton}
                    onClick={handleAddMutation}
                    data-testid="add-mutation-button"
                  >
                    + Add Mutation
                  </button>

                  {errors.mutations && (
                    <span className={styles.errorMessage}>{errors.mutations}</span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer with action buttons */}
        <div className={styles.footer}>
          <button className={styles.cancelButton} onClick={handleCancel}>
            Cancel
          </button>
          {/* Task Group 5.5: Add Action button disabled until form valid */}
          <button
            className={styles.addButton}
            onClick={handleSubmit}
            disabled={!isFormValid}
            data-testid="add-action-submit"
          >
            Add Action
          </button>
        </div>
      </div>
    </div>
  );
}

export default AddActionModal;
