/**
 * WorkItemEditModal Component
 *
 * Spec 2026-01-03: Product Backlog CRUD (Stage 4 - Increment 3)
 * Task Group 2: Modal component for editing FEATURE or STORY work items
 *
 * Extended in Spec 2026-01-17: Fix Feature Edit 400 Error
 * Added type field to update payload and type validation guard.
 *
 * Extended in Spec 2026-01-18: Fix Feature Edit 400 Error - Preserve Parent
 * Added parentId field to update payload to preserve parent relationship.
 *
 * Features:
 * - Pre-populates form with existing item values
 * - Form fields: title (required), description, status, priority, targetWindow
 * - Only renders for FEATURE and STORY types (guards against INITIATIVE/EPIC)
 * - Validates item.type is present before submission
 * - Includes parentId in update payload to preserve parent relationship
 * - Follows patterns from LogicalErCreateModal.tsx
 */

import React, { useState, useCallback, useEffect } from 'react';
import { updateWorkItem } from '../../api/workItemsApi';
import type { WorkItem, WorkItemFormData } from '../../types/workItems';
import { STATUS_OPTIONS as StatusOptions } from '../../types/workItems';
import styles from './WorkItemEditModal.module.css';

/**
 * Props for WorkItemEditModal
 */
export interface WorkItemEditModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Callback to close the modal */
  onClose: () => void;
  /** Work item to edit */
  item: WorkItem;
  /** Callback when update is successful */
  onSuccess: (updatedItem: WorkItem) => void;
  /** Project ID for API call */
  projectId: string;
}

/**
 * WorkItemEditModal Component
 */
export function WorkItemEditModal({
  isOpen,
  onClose,
  item,
  onSuccess,
  projectId,
}: WorkItemEditModalProps) {
  // Form state
  const [formData, setFormData] = useState<WorkItemFormData>({
    title: '',
    description: '',
    status: 'PLANNED',
    priority: null,
    targetWindow: null,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Pre-populate form when modal opens or item changes
  useEffect(() => {
    if (isOpen && item) {
      setFormData({
        title: item.title,
        description: item.description ?? '',
        status: item.status,
        priority: item.priority,
        targetWindow: item.targetWindow,
      });
      setErrors({});
      setIsSubmitting(false);
    }
  }, [isOpen, item]);

  // Handle field change
  const handleFieldChange = useCallback((fieldName: keyof WorkItemFormData, value: string | number | null) => {
    setFormData(prev => ({ ...prev, [fieldName]: value }));
    // Clear error when field is modified
    setErrors(prev => {
      const newErrors = { ...prev };
      delete newErrors[fieldName];
      delete newErrors._form;
      return newErrors;
    });
  }, []);

  // Validate form
  // Spec 2026-01-17: Added type validation guard
  const validateForm = useCallback((): boolean => {
    const newErrors: Record<string, string> = {};

    // Title is required
    if (!formData.title.trim()) {
      newErrors.title = 'Title is required';
    }

    // Spec 2026-01-17: Type validation guard
    // Check if item.type is falsy (missing, empty, or undefined)
    if (!item.type) {
      newErrors._form = 'Work item type is missing; please reload the project.';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [formData.title, item.type]);

  // Handle form submission
  // Spec 2026-01-17: Include type in update payload
  // Spec 2026-01-18: Include parentId in update payload to preserve parent relationship
  const handleSubmit = useCallback(async () => {
    if (!validateForm()) {
      return;
    }

    setIsSubmitting(true);
    try {
      const updatedItem = await updateWorkItem(projectId, item.id, {
        // Spec 2026-01-17: Include type field from existing item
        type: item.type,
        // Spec 2026-01-18: Include parentId field to preserve parent relationship
        parentId: item.parentId ?? undefined,
        title: formData.title.trim(),
        description: formData.description.trim() || undefined,
        status: formData.status,
        priority: formData.priority ?? undefined,
        targetWindow: formData.targetWindow?.trim() || undefined,
      });
      onSuccess(updatedItem);
      onClose();
    } catch (error) {
      console.error('Failed to update work item:', error);
      setErrors(prev => ({
        ...prev,
        _form: error instanceof Error ? error.message : 'Failed to update work item',
      }));
    } finally {
      setIsSubmitting(false);
    }
  }, [formData, validateForm, projectId, item.id, item.type, item.parentId, onSuccess, onClose]);

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
    } else if (e.key === 'Enter' && e.ctrlKey && formData.title.trim()) {
      handleSubmit();
    }
  }, [onClose, handleSubmit, formData.title]);

  // Don't render if not open
  if (!isOpen) {
    return null;
  }

  // Guard against editing INITIATIVE or EPIC
  if (item.type !== 'FEATURE' && item.type !== 'STORY') {
    return null;
  }

  const modalTitle = item.type === 'FEATURE' ? 'Edit Feature' : 'Edit Story';

  return (
    <div
      className={styles.overlay}
      onClick={handleOverlayClick}
      onKeyDown={handleKeyDown}
      data-testid="work-item-edit-modal"
    >
      <div className={`${styles.modal} ${isSubmitting ? styles.loading : ''}`}>
        {/* Header */}
        <div className={styles.header}>
          <h2 className={styles.title}>{modalTitle}</h2>
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
            {/* Title field (required) */}
            <div className={styles.fieldGroup}>
              <label className={styles.label}>
                Title<span className={styles.required}>*</span>
              </label>
              <input
                type="text"
                className={`${styles.input} ${errors.title ? styles.inputError : ''}`}
                value={formData.title}
                onChange={(e) => handleFieldChange('title', e.target.value)}
                placeholder={`Enter ${item.type.toLowerCase()} title`}
                data-testid="field-title"
                autoFocus
              />
              {errors.title && <span className={styles.errorMessage}>{errors.title}</span>}
            </div>

            {/* Description field */}
            <div className={styles.fieldGroup}>
              <label className={styles.label}>Description</label>
              <textarea
                className={styles.textarea}
                value={formData.description}
                onChange={(e) => handleFieldChange('description', e.target.value)}
                placeholder="Enter description (optional)"
                data-testid="field-description"
              />
            </div>

            {/* Status field */}
            <div className={styles.fieldGroup}>
              <label className={styles.label}>Status</label>
              <select
                className={styles.select}
                value={formData.status}
                onChange={(e) => handleFieldChange('status', e.target.value)}
                data-testid="field-status"
              >
                {StatusOptions.map(option => (
                  <option key={option} value={option}>
                    {option.replace('_', ' ')}
                  </option>
                ))}
              </select>
            </div>

            {/* Priority field */}
            <div className={styles.fieldGroup}>
              <label className={styles.label}>Priority</label>
              <input
                type="number"
                className={styles.input}
                value={formData.priority ?? ''}
                onChange={(e) => handleFieldChange('priority', e.target.value ? Number(e.target.value) : null)}
                placeholder="Enter priority (optional)"
                data-testid="field-priority"
              />
              <span className={styles.hint}>Lower number = higher priority</span>
            </div>

            {/* Target Window field */}
            <div className={styles.fieldGroup}>
              <label className={styles.label}>Target Window</label>
              <input
                type="text"
                className={styles.input}
                value={formData.targetWindow ?? ''}
                onChange={(e) => handleFieldChange('targetWindow', e.target.value || null)}
                placeholder="e.g., 2026-Q2"
                data-testid="field-targetWindow"
              />
            </div>
          </div>

          {/* Form-level error */}
          {errors._form && (
            <div className={styles.formError} data-testid="form-error">
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
            disabled={isSubmitting || !formData.title.trim()}
            data-testid="modal-submit-button"
          >
            {isSubmitting ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
