/**
 * DeleteDiagramConfirmModal Component
 *
 * Confirmation modal for deleting an entire diagram.
 * Displays a warning message and offers "Delete" (danger) or "Cancel" options.
 *
 * Follows the DeleteDiagramElementModal pattern for:
 * - Escape key binding
 * - Overlay click handling
 * - isOpen guard
 * - Header/content/footer layout
 */

import React, { useCallback, useEffect } from 'react';
import styles from './DeleteDiagramConfirmModal.module.css';

export interface DeleteDiagramConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function DeleteDiagramConfirmModal({
  isOpen,
  onClose,
  onConfirm,
}: DeleteDiagramConfirmModalProps) {
  // Handle Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Handle overlay click
  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose]
  );

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className={styles.overlay}
      onClick={handleOverlayClick}
      data-testid="delete-diagram-confirm-modal"
    >
      <div className={styles.modal}>
        {/* Header */}
        <div className={styles.header}>
          <h2 className={styles.title}>Delete Diagram</h2>
          <button
            className={styles.closeButton}
            onClick={onClose}
            title="Close"
            data-testid="modal-close-button"
          >
            &times;
          </button>
        </div>

        {/* Content */}
        <div className={styles.content}>
          <div className={styles.message}>
            Are you sure you want to permanently delete this diagram?
          </div>
        </div>

        {/* Footer */}
        <div className={styles.footer}>
          <button
            className={styles.secondaryButton}
            onClick={onClose}
            data-testid="modal-cancel-button"
          >
            Cancel
          </button>
          <button
            className={styles.dangerButton}
            onClick={onConfirm}
            data-testid="modal-delete-button"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
