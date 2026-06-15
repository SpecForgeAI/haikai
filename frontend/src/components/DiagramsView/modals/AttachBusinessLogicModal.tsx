/**
 * AttachBusinessLogicModal Component
 * Spec: Expand Application Points to Reference Service/Class/Method
 * Task Group 6: Attach Modals
 *
 * This modal allows users to attach a BusinessLogic entity to an ApplicationPoint.
 * Features:
 * - BusinessLogic entity picker dropdown
 * - Optional description field
 * - Creates application_point_business_logics relationship on submit
 * - Shows already-attached items as disabled
 */

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { MetaModel, BusinessLogic, ApplicationPointBusinessLogic } from '../../../types/model';
import { generateEntityId } from '../../../utils/idGenerator';
import styles from './AttachBusinessLogicModal.module.css';

// Props interface
export interface AttachBusinessLogicModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (relationship: ApplicationPointBusinessLogic) => void;
  applicationPointId: string;
  applicationPointName: string;
  metaModel: MetaModel | null;
}

// Form data interface
interface AttachBusinessLogicFormData {
  businessLogicId: string;
  description: string;
}

// Default form values
const DEFAULT_FORM_DATA: AttachBusinessLogicFormData = {
  businessLogicId: '',
  description: '',
};

/**
 * AttachBusinessLogicModal Component
 */
export function AttachBusinessLogicModal({
  isOpen,
  onClose,
  onSubmit,
  applicationPointId,
  applicationPointName,
  metaModel,
}: AttachBusinessLogicModalProps) {
  // Form data state
  const [formData, setFormData] = useState<AttachBusinessLogicFormData>({ ...DEFAULT_FORM_DATA });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Get existing attachments for this application point
  const existingAttachments = useMemo(() => {
    if (!metaModel?.relationships?.application_point_business_logics) return new Set<string>();
    return new Set(
      metaModel.relationships.application_point_business_logics
        .filter(rel => rel.application_point_id === applicationPointId)
        .map(rel => rel.business_logic_id)
    );
  }, [metaModel, applicationPointId]);

  // Get business logic entities from metaModel with attached status
  const businessLogicOptions = useMemo(() => {
    if (!metaModel?.entities?.business_logics) return [];
    return metaModel.entities.business_logics.map((bl: BusinessLogic) => ({
      id: bl.id,
      name: bl.name,
      type: bl.type_text || '',
      isAttached: existingAttachments.has(bl.id),
    }));
  }, [metaModel, existingAttachments]);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setFormData({ ...DEFAULT_FORM_DATA });
      setErrors({});
      setIsSubmitting(false);
    }
  }, [isOpen]);

  // Handle field change
  const handleFieldChange = useCallback((fieldName: keyof AttachBusinessLogicFormData, value: string) => {
    setFormData(prev => ({ ...prev, [fieldName]: value }));
    // Clear error when field is modified
    setErrors(prev => {
      const newErrors = { ...prev };
      delete newErrors[fieldName];
      return newErrors;
    });
  }, []);

  // Check if form is valid for enabling Attach button
  const isFormValid = useMemo(() => {
    if (!formData.businessLogicId) return false;
    // Prevent selecting already-attached items
    if (existingAttachments.has(formData.businessLogicId)) return false;
    return true;
  }, [formData, existingAttachments]);

  // Handle form submission
  const handleSubmit = useCallback(() => {
    // Validate required fields
    if (!formData.businessLogicId) {
      setErrors({ businessLogicId: 'Business Logic is required' });
      return;
    }

    // Check for duplicate attachment
    if (existingAttachments.has(formData.businessLogicId)) {
      setErrors({ businessLogicId: 'This Business Logic is already attached to this Application Point' });
      return;
    }

    setIsSubmitting(true);

    // Create the relationship entity
    const relationship: ApplicationPointBusinessLogic = {
      id: generateEntityId('application_point_business_logics'),
      application_point_id: applicationPointId,
      business_logic_id: formData.businessLogicId,
      description: formData.description || undefined,
    };

    onSubmit(relationship);
    setIsSubmitting(false);
    onClose();
  }, [formData, applicationPointId, existingAttachments, onSubmit, onClose]);

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
      data-testid="attach-business-logic-modal"
    >
      <div className={`${styles.modal} ${isSubmitting ? styles.loading : ''}`}>
        {/* Header */}
        <div className={styles.header}>
          <h2 className={styles.title}>Attach Business Logic</h2>
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
            {/* Application Point (read-only) */}
            <div className={styles.fieldGroup}>
              <label className={styles.label}>Application Point</label>
              <div className={styles.readOnlyValue}>{applicationPointName}</div>
            </div>

            {/* Business Logic Picker */}
            <div className={styles.fieldGroup}>
              <label className={styles.label}>
                Business Logic<span className={styles.required}>*</span>
              </label>
              <select
                className={`${styles.select} ${errors.businessLogicId ? styles.inputError : ''}`}
                value={formData.businessLogicId}
                onChange={(e) => handleFieldChange('businessLogicId', e.target.value)}
                data-testid="field-businessLogicId"
              >
                <option value="">-- Select Business Logic --</option>
                {businessLogicOptions.map(option => (
                  <option
                    key={option.id}
                    value={option.id}
                    disabled={option.isAttached}
                  >
                    {option.name}{option.type ? ` (${option.type})` : ''}{option.isAttached ? ' [Already Attached]' : ''}
                  </option>
                ))}
              </select>
              {errors.businessLogicId && <span className={styles.errorMessage}>{errors.businessLogicId}</span>}
            </div>

            {/* Description */}
            <div className={styles.fieldGroup}>
              <label className={styles.label}>Description</label>
              <textarea
                className={styles.textarea}
                value={formData.description}
                onChange={(e) => handleFieldChange('description', e.target.value)}
                placeholder="Optional description of the attachment"
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
            {isSubmitting ? 'Attaching...' : 'Attach'}
          </button>
        </div>
      </div>
    </div>
  );
}
