/**
 * LogicalErCreateModal Component
 * Task Group 1: Modal component for creating new Logical ER relationships
 *
 * This component provides a form-based modal for creating new LogicalDataEntityRelationship
 * entities directly from the Diagram View. It supports:
 * - Dynamic entity picker based on Kind selection (LOGICAL_ENTITY or PHYSICAL_ENTITY)
 * - Form validation for required fields (From/To endpoints, Cardinality, Relationship)
 * - Create & Add button that creates the relationship and adds it to the diagram
 */

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  MetaModel,
  LogicalERCardinality,
  LogicalERRelationship,
  LogicalEREndpointKind,
} from '../../../types/model';
import styles from './LogicalErCreateModal.module.css';

// Props interface
export interface LogicalErCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (formData: LogicalERFormData) => Promise<void>;
  metaModel: MetaModel | null;
}

// Form data interface
export interface LogicalERFormData {
  fromKind: LogicalEREndpointKind;
  fromEntity: string;
  toKind: LogicalEREndpointKind;
  toEntity: string;
  cardinality: LogicalERCardinality;
  relationship: LogicalERRelationship;
  description: string;
}

// Dropdown options
const ENDPOINT_KIND_OPTIONS: LogicalEREndpointKind[] = ['LOGICAL_ENTITY', 'PHYSICAL_ENTITY'];
const CARDINALITY_OPTIONS: LogicalERCardinality[] = ['ONE_TO_ONE', 'ONE_TO_MANY', 'MANY_TO_ONE', 'MANY_TO_MANY'];
const RELATIONSHIP_OPTIONS: LogicalERRelationship[] = [
  'GENERALIZATION',
  'REALIZATION',
  'COMPOSITION',
  'AGGREGATION',
  'ASSOCIATION',
  'DEPENDENCY',
];

// Display labels for dropdown options
const ENDPOINT_KIND_LABELS: Record<LogicalEREndpointKind, string> = {
  LOGICAL_ENTITY: 'Logical Entity',
  PHYSICAL_ENTITY: 'Physical Entity',
};

const CARDINALITY_LABELS: Record<LogicalERCardinality, string> = {
  ONE_TO_ONE: 'One to One (1:1)',
  ONE_TO_MANY: 'One to Many (1:M)',
  MANY_TO_ONE: 'Many to One (M:1)',
  MANY_TO_MANY: 'Many to Many (M:M)',
};

const RELATIONSHIP_LABELS: Record<LogicalERRelationship, string> = {
  GENERALIZATION: 'Generalization (is-a)',
  REALIZATION: 'Realization (implements)',
  COMPOSITION: 'Composition (has-a, strong)',
  AGGREGATION: 'Aggregation (has-a, weak)',
  ASSOCIATION: 'Association (general)',
  DEPENDENCY: 'Dependency (uses)',
};

// Default form values
const DEFAULT_FORM_DATA: LogicalERFormData = {
  fromKind: 'LOGICAL_ENTITY',
  fromEntity: '',
  toKind: 'LOGICAL_ENTITY',
  toEntity: '',
  cardinality: 'ONE_TO_ONE',
  relationship: 'ASSOCIATION',
  description: '',
};

/**
 * Get entities based on Kind selection
 */
function getEntitiesForKind(
  kind: LogicalEREndpointKind,
  metaModel: MetaModel | null
): Array<{ id: string; name: string }> {
  if (!metaModel) return [];

  if (kind === 'LOGICAL_ENTITY') {
    return metaModel.entities.logical_data_entities.map(e => ({ id: e.id, name: e.name }));
  }

  if (kind === 'PHYSICAL_ENTITY') {
    return metaModel.entities.physical_data_entities.map(e => ({ id: e.id, name: e.name }));
  }

  return [];
}

/**
 * LogicalErCreateModal Component
 */
export function LogicalErCreateModal({
  isOpen,
  onClose,
  onSubmit,
  metaModel,
}: LogicalErCreateModalProps) {
  // Form data state
  const [formData, setFormData] = useState<LogicalERFormData>({ ...DEFAULT_FORM_DATA });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Get entity options for From picker
  const fromEntityOptions = useMemo(
    () => getEntitiesForKind(formData.fromKind, metaModel),
    [formData.fromKind, metaModel]
  );

  // Get entity options for To picker
  const toEntityOptions = useMemo(
    () => getEntitiesForKind(formData.toKind, metaModel),
    [formData.toKind, metaModel]
  );

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setFormData({ ...DEFAULT_FORM_DATA });
      setErrors({});
      setIsSubmitting(false);
    }
  }, [isOpen]);

  // Clear fromEntity when fromKind changes
  useEffect(() => {
    if (formData.fromEntity) {
      const entityExists = fromEntityOptions.some(e => e.id === formData.fromEntity);
      if (!entityExists) {
        setFormData(prev => ({ ...prev, fromEntity: '' }));
      }
    }
  }, [formData.fromKind, fromEntityOptions, formData.fromEntity]);

  // Clear toEntity when toKind changes
  useEffect(() => {
    if (formData.toEntity) {
      const entityExists = toEntityOptions.some(e => e.id === formData.toEntity);
      if (!entityExists) {
        setFormData(prev => ({ ...prev, toEntity: '' }));
      }
    }
  }, [formData.toKind, toEntityOptions, formData.toEntity]);

  // Handle field change
  const handleFieldChange = useCallback((fieldName: keyof LogicalERFormData, value: string) => {
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

    // Validate From endpoint
    if (!formData.fromKind) {
      newErrors.fromKind = 'From Kind is required';
    }
    if (!formData.fromEntity) {
      newErrors.fromEntity = 'From Entity is required';
    }

    // Validate To endpoint
    if (!formData.toKind) {
      newErrors.toKind = 'To Kind is required';
    }
    if (!formData.toEntity) {
      newErrors.toEntity = 'To Entity is required';
    }

    // Validate Cardinality
    if (!formData.cardinality) {
      newErrors.cardinality = 'Cardinality is required';
    }

    // Validate Relationship
    if (!formData.relationship) {
      newErrors.relationship = 'Relationship is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [formData]);

  // Check if form is valid for enabling Create & Add button
  const isFormValid = useMemo(() => {
    return (
      formData.fromKind &&
      formData.fromEntity &&
      formData.toKind &&
      formData.toEntity &&
      formData.cardinality &&
      formData.relationship
    );
  }, [formData]);

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
      console.error('Failed to create Logical ER relationship:', error);
      setErrors(prev => ({
        ...prev,
        _form: error instanceof Error ? error.message : 'Failed to create relationship',
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
    } else if (e.key === 'Enter' && e.ctrlKey && isFormValid) {
      handleSubmit();
    }
  }, [onClose, handleSubmit, isFormValid]);

  // Don't render if not open
  if (!isOpen) {
    return null;
  }

  return (
    <div
      className={styles.overlay}
      onClick={handleOverlayClick}
      onKeyDown={handleKeyDown}
      data-testid="logical-er-create-modal"
    >
      <div className={`${styles.modal} ${isSubmitting ? styles.loading : ''}`}>
        {/* Header */}
        <div className={styles.header}>
          <h2 className={styles.title}>New Logical ER Relationship</h2>
          <button
            className={styles.closeButton}
            onClick={handleCancel}
            title="Close"
            data-testid="modal-close-button"
          >
            &times;
          </button>
        </div>

        {/* Content - Form */}
        <div className={styles.content}>
          <div className={styles.form}>
            {/* From Endpoint Section */}
            <div className={styles.section}>
              <div className={styles.sectionTitle}>From Endpoint</div>
              <div className={styles.fieldRow}>
                {/* From Kind */}
                <div className={styles.fieldGroup}>
                  <label className={styles.label}>
                    Kind<span className={styles.required}>*</span>
                  </label>
                  <select
                    className={`${styles.select} ${errors.fromKind ? styles.inputError : ''}`}
                    value={formData.fromKind}
                    onChange={(e) => handleFieldChange('fromKind', e.target.value)}
                    data-testid="field-fromKind"
                  >
                    {ENDPOINT_KIND_OPTIONS.map(option => (
                      <option key={option} value={option}>
                        {ENDPOINT_KIND_LABELS[option]}
                      </option>
                    ))}
                  </select>
                  {errors.fromKind && <span className={styles.errorMessage}>{errors.fromKind}</span>}
                </div>

                {/* From Entity */}
                <div className={styles.fieldGroup}>
                  <label className={styles.label}>
                    Entity<span className={styles.required}>*</span>
                  </label>
                  <select
                    className={`${styles.select} ${errors.fromEntity ? styles.inputError : ''}`}
                    value={formData.fromEntity}
                    onChange={(e) => handleFieldChange('fromEntity', e.target.value)}
                    data-testid="field-fromEntity"
                  >
                    <option value="">-- Select Entity --</option>
                    {fromEntityOptions.map(option => (
                      <option key={option.id} value={option.id}>
                        {option.name}
                      </option>
                    ))}
                  </select>
                  {errors.fromEntity && <span className={styles.errorMessage}>{errors.fromEntity}</span>}
                </div>
              </div>
            </div>

            {/* To Endpoint Section */}
            <div className={styles.section}>
              <div className={styles.sectionTitle}>To Endpoint</div>
              <div className={styles.fieldRow}>
                {/* To Kind */}
                <div className={styles.fieldGroup}>
                  <label className={styles.label}>
                    Kind<span className={styles.required}>*</span>
                  </label>
                  <select
                    className={`${styles.select} ${errors.toKind ? styles.inputError : ''}`}
                    value={formData.toKind}
                    onChange={(e) => handleFieldChange('toKind', e.target.value)}
                    data-testid="field-toKind"
                  >
                    {ENDPOINT_KIND_OPTIONS.map(option => (
                      <option key={option} value={option}>
                        {ENDPOINT_KIND_LABELS[option]}
                      </option>
                    ))}
                  </select>
                  {errors.toKind && <span className={styles.errorMessage}>{errors.toKind}</span>}
                </div>

                {/* To Entity */}
                <div className={styles.fieldGroup}>
                  <label className={styles.label}>
                    Entity<span className={styles.required}>*</span>
                  </label>
                  <select
                    className={`${styles.select} ${errors.toEntity ? styles.inputError : ''}`}
                    value={formData.toEntity}
                    onChange={(e) => handleFieldChange('toEntity', e.target.value)}
                    data-testid="field-toEntity"
                  >
                    <option value="">-- Select Entity --</option>
                    {toEntityOptions.map(option => (
                      <option key={option.id} value={option.id}>
                        {option.name}
                      </option>
                    ))}
                  </select>
                  {errors.toEntity && <span className={styles.errorMessage}>{errors.toEntity}</span>}
                </div>
              </div>
            </div>

            {/* Relationship Properties Section */}
            <div className={styles.section}>
              <div className={styles.sectionTitle}>Relationship Properties</div>

              {/* Cardinality */}
              <div className={styles.fieldGroup}>
                <label className={styles.label}>
                  Cardinality<span className={styles.required}>*</span>
                </label>
                <select
                  className={`${styles.select} ${errors.cardinality ? styles.inputError : ''}`}
                  value={formData.cardinality}
                  onChange={(e) => handleFieldChange('cardinality', e.target.value)}
                  data-testid="field-cardinality"
                >
                  {CARDINALITY_OPTIONS.map(option => (
                    <option key={option} value={option}>
                      {CARDINALITY_LABELS[option]}
                    </option>
                  ))}
                </select>
                {errors.cardinality && <span className={styles.errorMessage}>{errors.cardinality}</span>}
              </div>

              {/* Relationship Type */}
              <div className={styles.fieldGroup}>
                <label className={styles.label}>
                  Relationship Type<span className={styles.required}>*</span>
                </label>
                <select
                  className={`${styles.select} ${errors.relationship ? styles.inputError : ''}`}
                  value={formData.relationship}
                  onChange={(e) => handleFieldChange('relationship', e.target.value)}
                  data-testid="field-relationship"
                >
                  {RELATIONSHIP_OPTIONS.map(option => (
                    <option key={option} value={option}>
                      {RELATIONSHIP_LABELS[option]}
                    </option>
                  ))}
                </select>
                {errors.relationship && <span className={styles.errorMessage}>{errors.relationship}</span>}
              </div>

              {/* Description */}
              <div className={styles.fieldGroup}>
                <label className={styles.label}>Description</label>
                <textarea
                  className={styles.textarea}
                  value={formData.description}
                  onChange={(e) => handleFieldChange('description', e.target.value)}
                  placeholder="Optional description of the relationship"
                  data-testid="field-description"
                />
              </div>
            </div>
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
            data-testid="modal-cancel-button"
          >
            Cancel
          </button>
          <button
            className={styles.primaryButton}
            onClick={handleSubmit}
            disabled={isSubmitting || !isFormValid}
            data-testid="modal-submit-button"
          >
            {isSubmitting ? 'Creating...' : 'Create & Add'}
          </button>
        </div>
      </div>
    </div>
  );
}
