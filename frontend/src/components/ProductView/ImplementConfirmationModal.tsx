/**
 * ImplementConfirmationModal Component
 *
 * Spec 2026-01-23: Two-Flag Workflow State Machine
 * Task Group 3: Create ImplementConfirmationModal Component
 *
 * A warning modal displayed when user clicks "Implement" with unanswered
 * Product Owner questions. Uses amber/warning styling (not danger/red).
 *
 * Features:
 * - Amber header background (#fff8e1)
 * - Warning message showing count of unanswered questions
 * - Cancel button (secondary, closes modal)
 * - Continue button (primary blue, confirms and closes)
 * - Overlay click and Escape key to close
 */

import React, { useCallback } from 'react';
import styles from './ImplementConfirmationModal.module.css';

/**
 * Props for ImplementConfirmationModal
 */
export interface ImplementConfirmationModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Callback to close the modal */
  onClose: () => void;
  /** Callback when user confirms (clicks Continue) */
  onConfirm: () => void;
  /** Number of unanswered questions from Product Owner */
  openQuestionCount: number;
}

/**
 * ImplementConfirmationModal Component
 *
 * Displays a warning modal when user attempts to proceed to implementation
 * with unanswered Product Owner questions.
 */
export function ImplementConfirmationModal({
  isOpen,
  onClose,
  onConfirm,
  openQuestionCount,
}: ImplementConfirmationModalProps) {
  // Handle continue action (confirm then close)
  const handleContinue = useCallback(() => {
    onConfirm();
    onClose();
  }, [onConfirm, onClose]);

  // Handle cancel
  const handleCancel = useCallback(() => {
    onClose();
  }, [onClose]);

  // Handle overlay click
  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose]
  );

  // Handle keyboard events
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    },
    [onClose]
  );

  // Handle modal content click to stop propagation
  const handleModalClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  // Don't render if not open
  if (!isOpen) {
    return null;
  }

  // Pluralization for question count
  const questionText = openQuestionCount === 1 ? 'question' : 'questions';

  return (
    <div
      className={styles.overlay}
      onClick={handleOverlayClick}
      onKeyDown={handleKeyDown}
      data-testid="implement-confirmation-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      <div className={styles.modal} onClick={handleModalClick}>
        {/* Header */}
        <div className={styles.header}>
          <h2 id="modal-title" className={styles.title}>
            Proceed to Implementation?
          </h2>
          <button
            className={styles.closeButton}
            onClick={handleCancel}
            title="Close"
            data-testid="modal-close-button"
            aria-label="Close modal"
          >
            &times;
          </button>
        </div>

        {/* Content */}
        <div className={styles.content}>
          {/* Warning message */}
          <div className={styles.warning} data-testid="confirm-modal-warning">
            <span className={styles.warningIcon}>!</span>
            <span className={styles.warningText} data-testid="confirm-modal-message">
              You have {openQuestionCount} unanswered {questionText} from the Product Owner.
              Are you sure you want to proceed?
            </span>
          </div>
        </div>

        {/* Footer - Action Buttons */}
        <div className={styles.footer}>
          <button
            className={styles.secondaryButton}
            onClick={handleCancel}
            data-testid="modal-cancel-button"
          >
            Cancel
          </button>
          <button
            className={styles.primaryButton}
            onClick={handleContinue}
            data-testid="modal-continue-button"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
