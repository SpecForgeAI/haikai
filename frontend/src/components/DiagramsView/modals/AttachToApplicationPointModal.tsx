/**
 * AttachToApplicationPointModal Component
 * Spec: Expand Application Points to Reference Service/Class/Method
 * Task Group 6: Attach Modals
 *
 * This modal allows users to attach a BusinessLogic entity to an ApplicationPoint.
 * When viewing a BusinessLogic entity, this modal shows available ApplicationPoints.
 * Features:
 * - ApplicationPoint picker dropdown
 * - Shows already-attached items as disabled
 * - Creates application_point_business_logics relationship on submit
 * - Detach button to remove existing attachments
 */

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { MetaModel, ApplicationPoint, ApplicationPointBusinessLogic } from '../../../types/model';
import { generateEntityId } from '../../../utils/idGenerator';
import { formatApplicationPointDisplay } from '../../../utils/formatters';
import styles from './AttachToApplicationPointModal.module.css';

// Props interface
export interface AttachToApplicationPointModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (relationship: ApplicationPointBusinessLogic) => void;
  onDetach?: (relationshipId: string) => void;
  businessLogicId: string;
  businessLogicName: string;
  metaModel: MetaModel | null;
}

// Form data interface
interface AttachFormData {
  applicationPointId: string;
  description: string;
}

// Default form values
const DEFAULT_FORM_DATA: AttachFormData = {
  applicationPointId: '',
  description: '',
};

/**
 * AttachToApplicationPointModal Component
 */
export function AttachToApplicationPointModal({
  isOpen,
  onClose,
  onSubmit,
  onDetach,
  businessLogicId,
  businessLogicName,
  metaModel,
}: AttachToApplicationPointModalProps) {
  // Form data state
  const [formData, setFormData] = useState<AttachFormData>({ ...DEFAULT_FORM_DATA });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Get existing attachments for this business logic
  const existingAttachments = useMemo(() => {
    if (!metaModel?.relationships?.application_point_business_logics) return new Map<string, string>();
    const map = new Map<string, string>();
    metaModel.relationships.application_point_business_logics
      .filter(rel => rel.business_logic_id === businessLogicId)
      .forEach(rel => map.set(rel.application_point_id, rel.id));
    return map;
  }, [metaModel, businessLogicId]);

  // Get application point entities from metaModel with attached status
  const applicationPointOptions = useMemo(() => {
    if (!metaModel?.entities?.application_points) return [];
    return metaModel.entities.application_points.map((ap: ApplicationPoint) => ({
      id: ap.id,
      displayName: formatApplicationPointDisplay(ap),
      name: ap.name,
      kind: ap.kind,
      isAttached: existingAttachments.has(ap.id),
      attachmentId: existingAttachments.get(ap.id),
    }));
  }, [metaModel, existingAttachments]);

  // Get currently attached application points for display
  const attachedItems = useMemo(() => {
    return applicationPointOptions.filter(ap => ap.isAttached);
  }, [applicationPointOptions]);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setFormData({ ...DEFAULT_FORM_DATA });
      setErrors({});
      setIsSubmitting(false);
    }
  }, [isOpen]);

  // Handle field change
  const handleFieldChange = useCallback((fieldName: keyof AttachFormData, value: string) => {
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
    if (!formData.applicationPointId) return false;
    // Prevent selecting already-attached items
    if (existingAttachments.has(formData.applicationPointId)) return false;
    return true;
  }, [formData, existingAttachments]);

  // Handle form submission
  const handleSubmit = useCallback(() => {
    // Validate required fields
    if (!formData.applicationPointId) {
      setErrors({ applicationPointId: 'Application Point is required' });
      return;
    }

    // Check for duplicate attachment
    if (existingAttachments.has(formData.applicationPointId)) {
      setErrors({ applicationPointId: 'This Application Point is already attached to this Business Logic' });
      return;
    }

    setIsSubmitting(true);

    // Create the relationship entity
    const relationship: ApplicationPointBusinessLogic = {
      id: generateEntityId('application_point_business_logics'),
      application_point_id: formData.applicationPointId,
      business_logic_id: businessLogicId,
      description: formData.description || undefined,
    };

    onSubmit(relationship);
    setIsSubmitting(false);
    // Don't close - allow user to attach multiple
    setFormData({ ...DEFAULT_FORM_DATA });
  }, [formData, businessLogicId, existingAttachments, onSubmit]);

  // Handle detach
  const handleDetach = useCallback((relationshipId: string) => {
    if (onDetach) {
      onDetach(relationshipId);
    }
  }, [onDetach]);

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
      data-testid="attach-to-application-point-modal"
    >
      <div className={`${styles.modal} ${isSubmitting ? styles.loading : ''}`}>
        {/* Header */}
        <div className={styles.header}>
          <h2 className={styles.title}>Attach to Application Point</h2>
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
            {/* Business Logic (read-only) */}
            <div className={styles.fieldGroup}>
              <label className={styles.label}>Business Logic</label>
              <div className={styles.readOnlyValue}>{businessLogicName}</div>
            </div>

            {/* Currently Attached Application Points */}
            {attachedItems.length > 0 && (
              <div className={styles.fieldGroup}>
                <label className={styles.label}>Currently Attached ({attachedItems.length})</label>
                <div className={styles.attachedList} data-testid="attached-list">
                  {attachedItems.map(item => (
                    <div key={item.id} className={styles.attachedItem}>
                      <span className={styles.attachedItemName}>{item.displayName}</span>
                      {onDetach && item.attachmentId && (
                        <button
                          className={styles.detachButton}
                          onClick={() => handleDetach(item.attachmentId!)}
                          title="Detach"
                          data-testid={`detach-button-${item.id}`}
                        >
                          &times;
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Application Point Picker */}
            <div className={styles.fieldGroup}>
              <label className={styles.label}>
                Add Application Point<span className={styles.required}>*</span>
              </label>
              <select
                className={`${styles.select} ${errors.applicationPointId ? styles.inputError : ''}`}
                value={formData.applicationPointId}
                onChange={(e) => handleFieldChange('applicationPointId', e.target.value)}
                data-testid="field-applicationPointId"
              >
                <option value="">-- Select Application Point --</option>
                {applicationPointOptions
                  .filter(option => !option.isAttached)
                  .map(option => (
                    <option key={option.id} value={option.id}>
                      {option.displayName}
                    </option>
                  ))}
              </select>
              {errors.applicationPointId && (
                <span className={styles.errorMessage}>{errors.applicationPointId}</span>
              )}
              {applicationPointOptions.filter(o => !o.isAttached).length === 0 && (
                <span className={styles.hint}>All Application Points are already attached</span>
              )}
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
          <div className={styles.spacer} />
          <button
            className={styles.secondaryButton}
            onClick={handleCancel}
            disabled={isSubmitting}
            data-testid="modal-cancel-button"
          >
            Done
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
