/**
 * CreateAndPlaceDrawer Component
 * Task Group 1: Drawer component for creating new entities in ER, State, and Activity diagrams
 *
 * This component provides a form-based drawer for creating new entities directly from
 * the Diagram View. It supports dynamic field rendering based on entity type and includes
 * form validation.
 *
 * Supported entity types:
 * - STATE: States for State diagrams
 * - ACTIVITY: Activities for Activity diagrams
 * - ACTIVITY_PARTITION: Partitions (swimlanes) for Activity diagrams
 * - LOGICAL_DATA_ENTITY: Logical entities for ER diagrams
 * - PHYSICAL_DATA_ENTITY: Physical entities for ER diagrams
 * - UI_SCREEN: UI Screens for UI_Workflow diagrams (Task Group 2)
 */

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { ENTITY_TYPES, MetaModel, StateKind, ActivityKind, ActivityPartitionRefKind } from '../../types/model';
import styles from './CreateAndPlaceDrawer.module.css';

// Props interface
export interface CreateAndPlaceDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  entityType: string;
  onSubmit: (formData: Record<string, unknown>) => Promise<void>;
  metaModel?: MetaModel | null;
}

// Form field configuration type
interface FieldConfig {
  name: string;
  label: string;
  type: 'text' | 'textarea' | 'select' | 'typeahead';
  required: boolean | ((formData: Record<string, unknown>) => boolean);
  options?: string[];
  placeholder?: string;
  hint?: string;
  dependsOn?: string; // Field that controls visibility
  visible?: (formData: Record<string, unknown>) => boolean;
}

// Dropdown options
const STATE_KIND_OPTIONS: StateKind[] = ['Initial', 'Normal', 'Final'];
const ACTIVITY_KIND_OPTIONS: ActivityKind[] = ['Initial', 'Action', 'Decision', 'Merge', 'Final'];
const ACTIVITY_PARTITION_REF_KIND_OPTIONS: ActivityPartitionRefKind[] = [
  'BusinessUser',
  'Application',
  'ApplicationComponent',
  'Service',
  'Interface',
  'Class',
];

// Default values for entity types
const DEFAULT_VALUES: Record<string, Record<string, unknown>> = {
  [ENTITY_TYPES.STATE]: { stateKind: 'Normal' },
  [ENTITY_TYPES.ACTIVITY]: { activityKind: 'Action' },
  [ENTITY_TYPES.ACTIVITY_PARTITION]: {},
  [ENTITY_TYPES.LOGICAL_DATA_ENTITY]: {},
  [ENTITY_TYPES.PHYSICAL_DATA_ENTITY]: {},
  [ENTITY_TYPES.UI_SCREEN]: {},
};

/**
 * Get field configurations for an entity type
 */
function getFieldConfigs(entityType: string): FieldConfig[] {
  switch (entityType) {
    case ENTITY_TYPES.STATE:
      return [
        {
          name: 'name',
          label: 'Name',
          type: 'text',
          required: true,
          placeholder: 'Enter state name',
        },
        {
          name: 'stateKind',
          label: 'State Kind',
          type: 'select',
          required: true,
          options: STATE_KIND_OPTIONS,
          hint: 'Initial states are entry points, Final states are terminal',
        },
        {
          name: 'description',
          label: 'Description',
          type: 'textarea',
          required: false,
          placeholder: 'Optional description',
        },
      ];

    case ENTITY_TYPES.ACTIVITY:
      return [
        {
          name: 'name',
          label: 'Name',
          type: 'text',
          required: true,
          placeholder: 'Enter activity name',
        },
        {
          name: 'activityKind',
          label: 'Activity Kind',
          type: 'select',
          required: true,
          options: ACTIVITY_KIND_OPTIONS,
          hint: 'Action nodes perform work, Decision nodes branch flow',
        },
        {
          name: 'description',
          label: 'Description',
          type: 'textarea',
          required: false,
          placeholder: 'Optional description',
        },
      ];

    case ENTITY_TYPES.ACTIVITY_PARTITION:
      return [
        {
          name: 'refKind',
          label: 'Reference Kind',
          type: 'select',
          required: false,
          options: ['', ...ACTIVITY_PARTITION_REF_KIND_OPTIONS],
          hint: 'Optional: Link this partition to an existing entity',
        },
        {
          name: 'refId',
          label: 'Reference',
          type: 'typeahead',
          required: (formData) => !!formData.refKind && String(formData.refKind).trim() !== '',
          visible: (formData) => !!formData.refKind && String(formData.refKind).trim() !== '',
          placeholder: 'Select the referenced entity',
        },
        {
          name: 'name',
          label: 'Name',
          type: 'text',
          required: (formData) => !formData.refKind || String(formData.refKind).trim() === '',
          visible: (formData) => !formData.refKind || String(formData.refKind).trim() === '',
          placeholder: 'Enter partition name',
          hint: 'Required if no reference is selected',
        },
        {
          name: 'description',
          label: 'Description',
          type: 'textarea',
          required: false,
          placeholder: 'Optional description',
        },
      ];

    case ENTITY_TYPES.LOGICAL_DATA_ENTITY:
      return [
        {
          name: 'name',
          label: 'Name',
          type: 'text',
          required: true,
          placeholder: 'Enter entity name (e.g., Customer, Order)',
        },
        {
          name: 'description',
          label: 'Description',
          type: 'textarea',
          required: false,
          placeholder: 'Optional description',
        },
        {
          name: 'tags',
          label: 'Tags',
          type: 'text',
          required: false,
          placeholder: 'Comma-separated tags',
        },
      ];

    case ENTITY_TYPES.PHYSICAL_DATA_ENTITY:
      return [
        {
          name: 'name',
          label: 'Name',
          type: 'text',
          required: true,
          placeholder: 'Enter entity name (e.g., customers, orders)',
        },
        {
          name: 'description',
          label: 'Description',
          type: 'textarea',
          required: false,
          placeholder: 'Optional description',
        },
        {
          name: 'physical_type',
          label: 'Physical Type',
          type: 'text',
          required: false,
          placeholder: 'e.g., TABLE, VIEW, COLLECTION',
        },
        {
          name: 'database',
          label: 'Database',
          type: 'text',
          required: false,
          placeholder: 'e.g., PostgreSQL, MongoDB',
        },
        {
          name: 'tags',
          label: 'Tags',
          type: 'text',
          required: false,
          placeholder: 'Comma-separated tags',
        },
      ];

    case ENTITY_TYPES.UI_SCREEN:
      return [
        {
          name: 'name',
          label: 'Name',
          type: 'text',
          required: true,
          placeholder: 'Enter screen name',
        },
        {
          name: 'route',
          label: 'Route',
          type: 'text',
          required: true,
          placeholder: '/path/to/screen',
          hint: 'Must start with /',
        },
        {
          name: 'description',
          label: 'Description',
          type: 'textarea',
          required: false,
          placeholder: 'Optional description',
        },
      ];

    default:
      return [];
  }
}

/**
 * Get reference options based on refKind and metaModel
 */
function getReferenceOptions(
  refKind: string,
  metaModel: MetaModel | null | undefined
): Array<{ id: string; name: string }> {
  if (!metaModel || !refKind) return [];

  switch (refKind) {
    case 'BusinessUser':
      return metaModel.entities.business_users.map(e => ({ id: e.id, name: e.name }));
    case 'Application':
      return metaModel.entities.applications.map(e => ({ id: e.id, name: e.name }));
    case 'ApplicationComponent':
      return metaModel.entities.app_components.map(e => ({ id: e.id, name: e.name }));
    case 'Service':
      return metaModel.entities.services.map(e => ({ id: e.id, name: e.name }));
    case 'Interface':
      return metaModel.entities.interfaces.map(e => ({ id: e.id, name: e.name }));
    case 'Class':
      return metaModel.entities.classes?.map(e => ({ id: e.id, name: e.name })) || [];
    default:
      return [];
  }
}

/**
 * CreateAndPlaceDrawer Component
 */
export function CreateAndPlaceDrawer({
  isOpen,
  onClose,
  title,
  entityType,
  onSubmit,
  metaModel,
}: CreateAndPlaceDrawerProps) {
  // Form data state
  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Get field configurations
  const fieldConfigs = useMemo(() => getFieldConfigs(entityType), [entityType]);

  // Get reference options for ActivityPartition
  const referenceOptions = useMemo(() => {
    if (entityType === ENTITY_TYPES.ACTIVITY_PARTITION && formData.refKind) {
      return getReferenceOptions(String(formData.refKind), metaModel);
    }
    return [];
  }, [entityType, formData.refKind, metaModel]);

  // Reset form when drawer opens or entity type changes
  useEffect(() => {
    if (isOpen) {
      setFormData({ ...DEFAULT_VALUES[entityType] });
      setErrors({});
      setIsSubmitting(false);
    }
  }, [isOpen, entityType]);

  // Clear refId when refKind changes
  useEffect(() => {
    if (entityType === ENTITY_TYPES.ACTIVITY_PARTITION) {
      if (!formData.refKind || String(formData.refKind).trim() === '') {
        setFormData(prev => ({ ...prev, refId: '' }));
      }
    }
  }, [entityType, formData.refKind]);

  // Handle field change
  const handleFieldChange = useCallback((fieldName: string, value: unknown) => {
    setFormData(prev => ({ ...prev, [fieldName]: value }));
    // Clear error when field is modified
    setErrors(prev => {
      const newErrors = { ...prev };
      delete newErrors[fieldName];
      return newErrors;
    });
  }, []);

  // Validate form
  const validateForm = useCallback((): boolean => {
    const newErrors: Record<string, string> = {};

    for (const field of fieldConfigs) {
      // Check visibility
      if (field.visible && !field.visible(formData)) {
        continue;
      }

      // Check required
      const isRequired = typeof field.required === 'function'
        ? field.required(formData)
        : field.required;

      if (isRequired) {
        const value = formData[field.name];
        if (value === undefined || value === null || String(value).trim() === '') {
          newErrors[field.name] = `${field.label} is required`;
        }
      }
    }

    // Task Group 2: Route validation for UI_SCREEN
    if (entityType === ENTITY_TYPES.UI_SCREEN) {
      const route = formData.route;
      if (route && typeof route === 'string' && route.trim() !== '') {
        if (!route.trim().startsWith('/')) {
          newErrors.route = 'Route must start with /';
        }
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [fieldConfigs, formData, entityType]);

  // Handle form submission
  const handleSubmit = useCallback(async () => {
    if (!validateForm()) {
      return;
    }

    setIsSubmitting(true);
    try {
      await onSubmit(formData);
      onClose();
    } catch (error) {
      console.error('Failed to create entity:', error);
      setErrors(prev => ({
        ...prev,
        _form: error instanceof Error ? error.message : 'Failed to create entity',
      }));
    } finally {
      setIsSubmitting(false);
    }
  }, [formData, validateForm, onSubmit, onClose]);

  // Handle cancel
  const handleCancel = useCallback(() => {
    onClose();
  }, [onClose]);

  // Handle overlay click
  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }, [onClose]);

  // Handle keyboard events
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'Enter' && e.ctrlKey) {
      handleSubmit();
    }
  }, [onClose, handleSubmit]);

  // Don't render if not open
  if (!isOpen) {
    return null;
  }

  // Render field based on type
  const renderField = (field: FieldConfig) => {
    // Check visibility
    if (field.visible && !field.visible(formData)) {
      return null;
    }

    const isRequired = typeof field.required === 'function'
      ? field.required(formData)
      : field.required;

    const hasError = !!errors[field.name];
    const value = formData[field.name] || '';

    switch (field.type) {
      case 'text':
        return (
          <div key={field.name} className={styles.fieldGroup}>
            <label className={styles.label}>
              {field.label}
              {isRequired && <span className={styles.required}>*</span>}
            </label>
            <input
              type="text"
              className={`${styles.input} ${hasError ? styles.inputError : ''}`}
              value={String(value)}
              onChange={(e) => handleFieldChange(field.name, e.target.value)}
              placeholder={field.placeholder}
              data-testid={`field-${field.name}`}
            />
            {hasError && <span className={styles.errorMessage}>{errors[field.name]}</span>}
            {field.hint && !hasError && <span className={styles.hint}>{field.hint}</span>}
          </div>
        );

      case 'textarea':
        return (
          <div key={field.name} className={styles.fieldGroup}>
            <label className={styles.label}>
              {field.label}
              {isRequired && <span className={styles.required}>*</span>}
            </label>
            <textarea
              className={`${styles.textarea} ${hasError ? styles.inputError : ''}`}
              value={String(value)}
              onChange={(e) => handleFieldChange(field.name, e.target.value)}
              placeholder={field.placeholder}
              data-testid={`field-${field.name}`}
            />
            {hasError && <span className={styles.errorMessage}>{errors[field.name]}</span>}
            {field.hint && !hasError && <span className={styles.hint}>{field.hint}</span>}
          </div>
        );

      case 'select':
        return (
          <div key={field.name} className={styles.fieldGroup}>
            <label className={styles.label}>
              {field.label}
              {isRequired && <span className={styles.required}>*</span>}
            </label>
            <select
              className={`${styles.select} ${hasError ? styles.inputError : ''}`}
              value={String(value)}
              onChange={(e) => handleFieldChange(field.name, e.target.value)}
              data-testid={`field-${field.name}`}
            >
              {field.options?.map(option => (
                <option key={option} value={option}>
                  {option || '-- Select --'}
                </option>
              ))}
            </select>
            {hasError && <span className={styles.errorMessage}>{errors[field.name]}</span>}
            {field.hint && !hasError && <span className={styles.hint}>{field.hint}</span>}
          </div>
        );

      case 'typeahead':
        // For simplicity, render as select with options from metaModel
        return (
          <div key={field.name} className={styles.fieldGroup}>
            <label className={styles.label}>
              {field.label}
              {isRequired && <span className={styles.required}>*</span>}
            </label>
            <select
              className={`${styles.select} ${hasError ? styles.inputError : ''}`}
              value={String(value)}
              onChange={(e) => handleFieldChange(field.name, e.target.value)}
              data-testid={`field-${field.name}`}
            >
              <option value="">-- Select --</option>
              {referenceOptions.map(option => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
            {hasError && <span className={styles.errorMessage}>{errors[field.name]}</span>}
            {field.hint && !hasError && <span className={styles.hint}>{field.hint}</span>}
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div
      className={styles.overlay}
      onClick={handleOverlayClick}
      onKeyDown={handleKeyDown}
      data-testid="create-and-place-drawer"
    >
      <div className={`${styles.drawer} ${isSubmitting ? styles.loading : ''}`}>
        {/* Header */}
        <div className={styles.header}>
          <h2 className={styles.title}>{title}</h2>
          <button
            className={styles.closeButton}
            onClick={handleCancel}
            title="Close"
            data-testid="drawer-close-button"
          >
            &times;
          </button>
        </div>

        {/* Content - Form */}
        <div className={styles.content}>
          <div className={styles.form}>
            {fieldConfigs.map(renderField)}
          </div>
          {errors._form && (
            <div className={styles.errorMessage} style={{ marginTop: 12 }}>
              {errors._form}
            </div>
          )}
        </div>

        {/* Footer - Action Buttons */}
        <div className={styles.footer}>
          <button
            className={styles.secondaryButton}
            onClick={handleCancel}
            disabled={isSubmitting}
            data-testid="drawer-cancel-button"
          >
            Cancel
          </button>
          <button
            className={styles.primaryButton}
            onClick={handleSubmit}
            disabled={isSubmitting}
            data-testid="drawer-submit-button"
          >
            {isSubmitting ? 'Creating...' : 'Create & Add'}
          </button>
        </div>
      </div>
    </div>
  );
}
