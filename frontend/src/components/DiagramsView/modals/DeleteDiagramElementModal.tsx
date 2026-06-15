/**
 * DeleteDiagramElementModal Component
 *
 * Confirmation modal for deleting elements from a State diagram.
 * Offers three options:
 * - "Diagram Only": removes elements from the diagram only
 * - "Both": removes from diagram AND meta-model
 * - "Cancel": dismisses without action
 *
 * Follows the WorkItemDeleteConfirmModal pattern.
 */

import React, { useCallback, useEffect } from 'react';
import styles from './DeleteDiagramElementModal.module.css';

export interface DeleteDiagramElementModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDiagramOnly: () => void;
  onBoth: () => void;
  selectedNodeCount: number;
  selectedEdgeCount: number;
}

export function DeleteDiagramElementModal({
  isOpen,
  onClose,
  onDiagramOnly,
  onBoth,
  selectedNodeCount,
  selectedEdgeCount,
}: DeleteDiagramElementModalProps) {
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

  // Build selection description
  const parts: string[] = [];
  if (selectedNodeCount > 0) {
    parts.push(`${selectedNodeCount} state${selectedNodeCount !== 1 ? 's' : ''}`);
  }
  if (selectedEdgeCount > 0) {
    parts.push(`${selectedEdgeCount} transition${selectedEdgeCount !== 1 ? 's' : ''}`);
  }
  const selectionText = parts.join(' and ') + ' selected';

  return (
    <div
      className={styles.overlay}
      onClick={handleOverlayClick}
      data-testid="delete-diagram-element-modal"
    >
      <div className={styles.modal}>
        {/* Header */}
        <div className={styles.header}>
          <h2 className={styles.title}>Delete Elements</h2>
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
            Would you like to delete from the diagram only, or also remove from
            the meta-model?
          </div>
          <div className={styles.selectionInfo} data-testid="selection-info">
            {selectionText}
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
            className={styles.primaryButton}
            onClick={onDiagramOnly}
            data-testid="modal-diagram-only-button"
          >
            Diagram Only
          </button>
          <button
            className={styles.dangerButton}
            onClick={onBoth}
            data-testid="modal-both-button"
          >
            Both
          </button>
        </div>
      </div>
    </div>
  );
}
