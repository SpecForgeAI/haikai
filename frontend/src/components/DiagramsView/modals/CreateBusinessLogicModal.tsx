/**
 * CreateBusinessLogicModal Component
 * Spec: Add Business Logic templates to prefill description on create
 * Task Groups 2, 3, 4: Modal Structure, Template Logic, Form UI
 *
 * This modal allows users to create a new Business Logic entity with:
 * - Template selection to prefill description with markdown skeletons
 * - Auto-prefill of Type field based on template selection
 * - Non-destructive prefill (only fills empty fields)
 *
 * Features:
 * - Name field (required)
 * - Type field (optional, auto-filled from template)
 * - Template dropdown (above description for logical flow)
 * - Description textarea (markdown content, prefilled from template)
 * - Keyboard shortcuts: Escape to close, Ctrl+Enter to submit
 */

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { BusinessLogic } from '../../../types/model';
import { generateEntityId } from '../../../utils/idGenerator';
import {
  BUSINESS_LOGIC_TEMPLATES,
  findTemplateById,
} from '../../../templates/businessLogicTemplates';
import styles from './CreateBusinessLogicModal.module.css';

// ============================================================================
// Props Interface (Task Group 2)
// ============================================================================

/**
 * Props for the CreateBusinessLogicModal component.
 */
export interface CreateBusinessLogicModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Callback to close the modal */
  onClose: () => void;
  /** Callback when a new BusinessLogic entity is submitted */
  onSubmit: (entity: BusinessLogic) => void;
}

// ============================================================================
// Form Data Interface (Task Group 2)
// ============================================================================

/**
 * Internal form data structure for the modal.
 */
interface CreateBusinessLogicFormData {
  name: string;
  typeText: string;
  templateId: string;
  descriptionMd: string;
}

/**
 * Default form values - empty fields with blank template selected.
 */
const DEFAULT_FORM_DATA: CreateBusinessLogicFormData = {
  name: '',
  typeText: '',
  templateId: 'blank',
  descriptionMd: '',
};

// ============================================================================
// Component Implementation
// ============================================================================

/**
 * CreateBusinessLogicModal Component
 *
 * Modal for creating new Business Logic entities with template support.
 */
export function CreateBusinessLogicModal({
  isOpen,
  onClose,
  onSubmit,
}: CreateBusinessLogicModalProps) {
  // ============================================================================
  // Form State Management (Task Group 2)
  // ============================================================================

  const [formData, setFormData] = useState<CreateBusinessLogicFormData>({
    ...DEFAULT_FORM_DATA,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // ============================================================================
  // Form Reset on Open (Task Group 2)
  // ============================================================================

  /**
   * Reset form when modal opens.
   * Follows pattern from AttachBusinessLogicModal.tsx
   */
  useEffect(() => {
    if (isOpen) {
      setFormData({ ...DEFAULT_FORM_DATA });
      setErrors({});
      setIsSubmitting(false);
    }
  }, [isOpen]);

  // ============================================================================
  // Field Change Handlers (Task Group 2)
  // ============================================================================

  /**
   * Generic field change handler.
   * Clears field-specific error when field is modified.
   */
  const handleFieldChange = useCallback(
    (fieldName: keyof CreateBusinessLogicFormData, value: string) => {
      setFormData((prev) => ({ ...prev, [fieldName]: value }));
      // Clear error when field is modified
      setErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors[fieldName];
        return newErrors;
      });
    },
    []
  );

  // ============================================================================
  // Template Selection Handler (Task Group 3)
  // ============================================================================

  /**
   * Handle template selection change.
   * Prefills description and type ONLY when those fields are empty.
   * Never overwrites non-empty fields (no confirmation dialog needed per spec).
   */
  const handleTemplateChange = useCallback(
    (templateId: string) => {
      const template = findTemplateById(templateId);
      if (!template) {
        // Just update the templateId if template not found
        setFormData((prev) => ({ ...prev, templateId }));
        return;
      }

      setFormData((prev) => {
        const updates: Partial<CreateBusinessLogicFormData> = {
          templateId,
        };

        // Task Group 3.3: Prefill description only if empty
        const descriptionIsEmpty = !prev.descriptionMd.trim();
        if (descriptionIsEmpty) {
          updates.descriptionMd = template.descriptionMarkdown;
        }

        // Task Group 3.4: Prefill type only if empty and template has suggestedType
        const typeIsEmpty = !prev.typeText.trim();
        if (typeIsEmpty && template.suggestedType) {
          updates.typeText = template.suggestedType;
        }

        // Task Group 3.5: Atomic state update
        return { ...prev, ...updates };
      });
    },
    []
  );

  // ============================================================================
  // Form Validation (Task Group 4)
  // ============================================================================

  /**
   * Check if form is valid for enabling Create button.
   * Only Name is required.
   */
  const isFormValid = useMemo(() => {
    return formData.name.trim().length > 0;
  }, [formData.name]);

  // ============================================================================
  // Submit Handler (Task Group 4)
  // ============================================================================

  /**
   * Handle form submission.
   * Creates a new BusinessLogic entity with generated ID.
   */
  const handleSubmit = useCallback(() => {
    // Validate required Name field
    if (!formData.name.trim()) {
      setErrors({ name: 'Name is required' });
      return;
    }

    setIsSubmitting(true);

    // Generate ID using standard pattern
    const id = generateEntityId('business_logics');

    // Create BusinessLogic entity
    const entity: BusinessLogic = {
      id,
      name: formData.name.trim(),
      type_text: formData.typeText.trim() || undefined,
      description_md: formData.descriptionMd || undefined,
      tags: '',
      valid_from: undefined,
      valid_to: undefined,
    };

    onSubmit(entity);
    setIsSubmitting(false);
    onClose();
  }, [formData, onSubmit, onClose]);

  // ============================================================================
  // Cancel Handler
  // ============================================================================

  const handleCancel = useCallback(() => {
    onClose();
  }, [onClose]);

  // ============================================================================
  // Overlay Click Handler
  // ============================================================================

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose]
  );

  // ============================================================================
  // Keyboard Handler (Task Group 4)
  // ============================================================================

  /**
   * Handle keyboard events.
   * Escape: close modal
   * Ctrl+Enter: submit if valid
   */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'Enter' && e.ctrlKey && isFormValid) {
        handleSubmit();
      }
    },
    [onClose, handleSubmit, isFormValid]
  );

  // ============================================================================
  // Render
  // ============================================================================

  // Don't render if not open
  if (!isOpen) {
    return null;
  }

  return (
    <div
      className={styles.overlay}
      onClick={handleOverlayClick}
      onKeyDown={handleKeyDown}
      data-testid="create-business-logic-modal"
    >
      <div className={`${styles.modal} ${isSubmitting ? styles.loading : ''}`}>
        {/* Header */}
        <div className={styles.header}>
          <h2 className={styles.title}>Create Business Logic</h2>
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
            {/* Name (required) */}
            <div className={styles.fieldGroup}>
              <label className={styles.label}>
                Name<span className={styles.required}>*</span>
              </label>
              <input
                type="text"
                className={`${styles.textInput} ${errors.name ? styles.inputError : ''}`}
                value={formData.name}
                onChange={(e) => handleFieldChange('name', e.target.value)}
                placeholder="Enter business logic name"
                data-testid="field-name"
                autoFocus
              />
              {errors.name && (
                <span className={styles.errorMessage}>{errors.name}</span>
              )}
            </div>

            {/* Type (optional) */}
            <div className={styles.fieldGroup}>
              <label className={styles.label}>Type</label>
              <input
                type="text"
                className={styles.textInput}
                value={formData.typeText}
                onChange={(e) => handleFieldChange('typeText', e.target.value)}
                placeholder="e.g., Calculation, Validation, Policy"
                data-testid="field-type"
              />
            </div>

            {/* Template (dropdown above description) */}
            <div className={styles.fieldGroup}>
              <label className={styles.label}>Template</label>
              <select
                className={styles.select}
                value={formData.templateId}
                onChange={(e) => handleTemplateChange(e.target.value)}
                data-testid="field-template"
              >
                {BUSINESS_LOGIC_TEMPLATES.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Description (multiline textarea) */}
            <div className={styles.fieldGroup}>
              <label className={styles.label}>Description</label>
              <textarea
                className={`${styles.textarea} ${styles.textareaLarge}`}
                value={formData.descriptionMd}
                onChange={(e) => handleFieldChange('descriptionMd', e.target.value)}
                placeholder="Markdown description of the business logic"
                data-testid="field-description"
              />
            </div>
          </div>
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
            {isSubmitting ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
