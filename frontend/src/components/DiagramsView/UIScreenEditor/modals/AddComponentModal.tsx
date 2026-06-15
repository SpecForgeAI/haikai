/**
 * AddComponentModal Component
 *
 * Task Group 3: Modal for adding UI screen components
 * Allows users to add components to a UI_SCREEN diagram via a form.
 *
 * Follows EditActivityFlowConditionModal.tsx pattern.
 */

import React, { useState, useCallback, useEffect } from 'react';
import { UIScreenComponentRef } from '../../../../types/typedContent';
import { generatePrefixedId } from '../../../../utils/idGenerator';
import { COMPONENT_TYPE_OPTIONS, ComponentType } from '../../../../utils/uiScreenUtils';
import styles from './AddComponentModal.module.css';

/**
 * Props for the AddComponentModal component
 */
export interface AddComponentModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Callback when modal is closed (cancel) */
  onClose: () => void;
  /** Callback when component is added */
  onAdd: (componentRef: UIScreenComponentRef) => void;
}

/**
 * AddComponentModal Component
 *
 * Modal for adding components to a UI_SCREEN diagram.
 */
export function AddComponentModal({
  isOpen,
  onClose,
  onAdd,
}: AddComponentModalProps) {
  // Form state
  const [name, setName] = useState('');
  const [componentType, setComponentType] = useState<ComponentType>('FORM');
  const [propsJson, setPropsJson] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setName('');
      setComponentType('FORM');
      setPropsJson('');
      setErrors({});
    }
  }, [isOpen]);

  // Handle name change
  const handleNameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setName(e.target.value);
    setErrors(prev => ({ ...prev, name: '' }));
  }, []);

  // Handle component type change
  const handleComponentTypeChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setComponentType(e.target.value as ComponentType);
  }, []);

  // Handle props JSON change
  const handlePropsChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setPropsJson(e.target.value);
    setErrors(prev => ({ ...prev, props: '' }));
  }, []);

  // Validate form
  const validateForm = useCallback((): boolean => {
    const newErrors: Record<string, string> = {};

    if (!name.trim()) {
      newErrors.name = 'Name is required';
    }

    // Validate props JSON if provided
    if (propsJson.trim()) {
      try {
        JSON.parse(propsJson);
      } catch {
        newErrors.props = 'Invalid JSON format';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [name, propsJson]);

  // Handle form submission
  const handleSubmit = useCallback(() => {
    if (!validateForm()) {
      return;
    }

    // Parse props JSON if provided
    let propsOverride: Record<string, unknown> | undefined;
    if (propsJson.trim()) {
      try {
        propsOverride = JSON.parse(propsJson);
      } catch {
        // Should not reach here due to validation
        return;
      }
    }

    // Generate component ref
    const componentRef: UIScreenComponentRef = {
      id: generatePrefixedId('uicompref'),
      component_id: generatePrefixedId('uicomp'),
      props_override: propsOverride,
    };

    // Store name and type in props_override for display purposes
    // Since UIScreenComponentRef doesn't have name/type fields directly,
    // we include them in the component_id context or props_override
    if (!componentRef.props_override) {
      componentRef.props_override = {};
    }
    componentRef.props_override._name = name.trim();
    componentRef.props_override._type = componentType;

    onAdd(componentRef);
    onClose();
  }, [validateForm, name, componentType, propsJson, onAdd, onClose]);

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

  return (
    <div className={styles.overlay} onClick={handleOverlayClick}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className={styles.header}>
          <h2 className={styles.title}>Add Component</h2>
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
                placeholder="Enter component name"
                data-testid="component-name-input"
              />
              {errors.name && <span className={styles.errorMessage}>{errors.name}</span>}
            </div>

            {/* Type Field */}
            <div className={styles.formGroup}>
              <label className={styles.label}>
                Type
                <span className={styles.required}>*</span>
              </label>
              <select
                className={styles.select}
                value={componentType}
                onChange={handleComponentTypeChange}
                data-testid="component-type-select"
              >
                {COMPONENT_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Props JSON Field */}
            <div className={styles.formGroup}>
              <label className={styles.label}>
                Props (JSON)
                <span className={styles.labelHint}>(optional)</span>
              </label>
              <textarea
                className={`${styles.textarea} ${errors.props ? styles.inputError : ''}`}
                value={propsJson}
                onChange={handlePropsChange}
                placeholder='{"label": "Submit", "disabled": false}'
                data-testid="component-props-input"
              />
              {errors.props && <span className={styles.errorMessage}>{errors.props}</span>}
              {!errors.props && (
                <span className={styles.hint}>
                  Optional JSON object for component-specific configuration
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Footer with action buttons */}
        <div className={styles.footer}>
          <button className={styles.cancelButton} onClick={handleCancel}>
            Cancel
          </button>
          <button
            className={styles.addButton}
            onClick={handleSubmit}
            data-testid="add-component-submit"
          >
            Add Component
          </button>
        </div>
      </div>
    </div>
  );
}

export default AddComponentModal;
