/**
 * WorkItemCreateModal Component
 *
 * Spec 2026-01-03: Product Backlog CRUD (Stage 4 - Increment 3)
 * Task Group 2: Modal component for creating new FEATURE or STORY work items
 *
 * Features:
 * - Dynamic title based on typeToCreate prop ("Add Feature" or "Add Story")
 * - Form fields: title (required), description, status, priority, targetWindow
 * - Default status to "PLANNED"
 * - Computes sortOrder based on max sibling sortOrder + 1
 * - Follows patterns from LogicalErCreateModal.tsx
 */

import React, { useState, useCallback, useEffect } from 'react';
import { createWorkItem } from '../../api/workItemsApi';
import type { WorkItem, WorkItemType, WorkItemFormData, STATUS_OPTIONS } from '../../types/workItems';
import { STATUS_OPTIONS as StatusOptions } from '../../types/workItems';
import styles from './WorkItemCreateModal.module.css';

/**
 * Props for WorkItemCreateModal
 */
export interface WorkItemCreateModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Callback to close the modal */
  onClose: () => void;
  /** Parent work item for the new item */
  parent: WorkItem;
  /** Type of work item to create */
  typeToCreate: 'EPIC' | 'FEATURE' | 'STORY';
  /** Callback when creation is successful */
  onSuccess: (newItem: WorkItem) => void;
  /** Project ID for API call */
  projectId: string;
  /** Existing siblings to compute sortOrder */
  siblings: WorkItem[];
}

/**
 * Default form values
 */
const DEFAULT_FORM_DATA: WorkItemFormData = {
  title: '',
  description: '',
  status: 'PLANNED',
  priority: null,
  targetWindow: null,
};

/**
 * WorkItemCreateModal Component
 */
export function WorkItemCreateModal({
  isOpen,
  onClose,
  parent,
  typeToCreate,
  onSuccess,
  projectId,
  siblings,
}: WorkItemCreateModalProps) {
  // Form state
  const [formData, setFormData] = useState<WorkItemFormData>({ ...DEFAULT_FORM_DATA });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setFormData({ ...DEFAULT_FORM_DATA });
      setErrors({});
      setIsSubmitting(false);
    }
  }, [isOpen]);

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
  const validateForm = useCallback((): boolean => {
    const newErrors: Record<string, string> = {};

    // Title is required
    if (!formData.title.trim()) {
      newErrors.title = 'Title is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [formData.title]);

  // Compute sort order for new item
  const computeSortOrder = useCallback((): number => {
    if (siblings.length === 0) {
      return 1;
    }
    const maxSortOrder = Math.max(...siblings.map(s => s.sortOrder));
    return maxSortOrder + 1;
  }, [siblings]);

  // Handle form submission
  const handleSubmit = useCallback(async () => {
    if (!validateForm()) {
      return;
    }

    setIsSubmitting(true);
    try {
      const sortOrder = computeSortOrder();
      const newItem = await createWorkItem(projectId, {
        type: typeToCreate,
        parentId: parent.id,
        title: formData.title.trim(),
        description: formData.description.trim() || undefined,
        status: formData.status,
        priority: formData.priority ?? undefined,
        targetWindow: formData.targetWindow?.trim() || undefined,
        sortOrder,
      });
      onSuccess(newItem);
      onClose();
    } catch (error) {
      console.error('Failed to create work item:', error);
      setErrors(prev => ({
        ...prev,
        _form: error instanceof Error ? error.message : 'Failed to create work item',
      }));
    } finally {
      setIsSubmitting(false);
    }
  }, [formData, validateForm, computeSortOrder, projectId, typeToCreate, parent.id, onSuccess, onClose]);

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

  const modalTitle = typeToCreate === 'EPIC' ? 'Add Epic' : typeToCreate === 'FEATURE' ? 'Add Feature' : 'Add Story';

  return (
    <div
      className={styles.overlay}
      onClick={handleOverlayClick}
      onKeyDown={handleKeyDown}
      data-testid="work-item-create-modal"
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
                placeholder={`Enter ${typeToCreate.toLowerCase()} title`}
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
            {isSubmitting ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
