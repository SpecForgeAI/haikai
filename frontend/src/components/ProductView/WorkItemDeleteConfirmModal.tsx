/**
 * WorkItemDeleteConfirmModal Component
 *
 * Spec 2026-01-03: Product Backlog CRUD (Stage 4 - Increment 3)
 * Task Group 2: Modal component for confirming deletion of work items
 *
 * Features:
 * - Explicit cascade warning: "Deleting this item will also delete all child items beneath it."
 * - Displays count of descendant items that will be deleted
 * - Shows item title and type being deleted
 * - Cancel and Delete buttons (Delete in danger/red style)
 */

import React, { useState, useCallback } from 'react';
import { deleteWorkItem } from '../../api/workItemsApi';
import type { WorkItem } from '../../types/workItems';
import styles from './WorkItemDeleteConfirmModal.module.css';

/**
 * Props for WorkItemDeleteConfirmModal
 */
export interface WorkItemDeleteConfirmModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Callback to close the modal */
  onClose: () => void;
  /** Work item to delete */
  item: WorkItem;
  /** Number of descendant items that will also be deleted */
  descendantCount: number;
  /** Callback when deletion is successful */
  onConfirm: () => void;
  /** Project ID for API call */
  projectId: string;
}

/**
 * WorkItemDeleteConfirmModal Component
 */
export function WorkItemDeleteConfirmModal({
  isOpen,
  onClose,
  item,
  descendantCount,
  onConfirm,
  projectId,
}: WorkItemDeleteConfirmModalProps) {
  // State
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Handle delete confirmation
  const handleConfirm = useCallback(async () => {
    setIsDeleting(true);
    setError(null);

    try {
      await deleteWorkItem(projectId, item.id);
      onConfirm();
      onClose();
    } catch (err) {
      console.error('Failed to delete work item:', err);
      setError(err instanceof Error ? err.message : 'Failed to delete work item');
    } finally {
      setIsDeleting(false);
    }
  }, [projectId, item.id, onConfirm, onClose]);

  // Handle cancel
  const handleCancel = useCallback(() => {
    setError(null);
    onClose();
  }, [onClose]);

  // Handle overlay click
  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      handleCancel();
    }
  }, [handleCancel]);

  // Handle keyboard events
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      handleCancel();
    }
  }, [handleCancel]);

  // Don't render if not open
  if (!isOpen) {
    return null;
  }

  // Total items to be deleted (item itself + descendants)
  const totalDeleteCount = 1 + descendantCount;

  return (
    <div
      className={styles.overlay}
      onClick={handleOverlayClick}
      onKeyDown={handleKeyDown}
      data-testid="work-item-delete-modal"
    >
      <div className={`${styles.modal} ${isDeleting ? styles.loading : ''}`}>
        {/* Header */}
        <div className={styles.header}>
          <h2 className={styles.title}>Delete {item.type}</h2>
          <button
            className={styles.closeButton}
            onClick={handleCancel}
            title="Close"
            data-testid="modal-close-button"
          >
            &times;
          </button>
        </div>

        {/* Content */}
        <div className={styles.content}>
          {/* Item being deleted */}
          <div className={styles.itemInfo}>
            <div className={styles.itemTitle} data-testid="delete-item-title">
              {item.title}
            </div>
            <div className={styles.itemType} data-testid="delete-item-type">
              {item.type}
            </div>
          </div>

          {/* Warning message */}
          <div className={styles.warning}>
            <span className={styles.warningIcon}>!</span>
            <span className={styles.warningText} data-testid="delete-warning">
              Deleting this item will also delete all child items beneath it.
            </span>
          </div>

          {/* Cascade info */}
          <div className={styles.cascadeInfo}>
            <div className={styles.cascadeCount} data-testid="delete-count">
              <span className={styles.cascadeNumber}>{totalDeleteCount}</span>
              {' '}item{totalDeleteCount !== 1 ? 's' : ''} will be deleted
              {descendantCount > 0 && (
                <span> (including {descendantCount} child item{descendantCount !== 1 ? 's' : ''})</span>
              )}
            </div>
          </div>

          {/* Error message */}
          {error && (
            <div className={styles.formError} data-testid="delete-error">
              {error}
            </div>
          )}
        </div>

        {/* Footer - Action Buttons */}
        <div className={styles.footer}>
          <button
            className={styles.secondaryButton}
            onClick={handleCancel}
            disabled={isDeleting}
            data-testid="modal-cancel-button"
          >
            Cancel
          </button>
          <button
            className={styles.dangerButton}
            onClick={handleConfirm}
            disabled={isDeleting}
            data-testid="modal-delete-button"
          >
            {isDeleting ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}
