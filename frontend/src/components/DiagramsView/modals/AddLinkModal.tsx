/**
 * AddLinkModal Component
 *
 * Modal for linking a diagram element to another diagram.
 * Uses DiagramAutocomplete for diagram selection.
 * Follows the RenameDiagramModal pattern for modal structure.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Diagram } from '../../../types/model';
import { DiagramAutocomplete } from '../DiagramAutocomplete';
import styles from './AddLinkModal.module.css';

export interface AddLinkModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (linkedDiagramId: string) => void;
  diagrams: Diagram[];
  currentLinkedDiagramId?: string;
}

export function AddLinkModal({
  isOpen,
  onClose,
  onSubmit,
  diagrams,
  currentLinkedDiagramId,
}: AddLinkModalProps) {
  const [selectedDiagramId, setSelectedDiagramId] = useState<string | null>(
    currentLinkedDiagramId || null
  );

  // Re-initialize when modal opens or currentLinkedDiagramId changes
  useEffect(() => {
    if (isOpen) {
      setSelectedDiagramId(currentLinkedDiagramId || null);
    }
  }, [isOpen, currentLinkedDiagramId]);

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

  const handleSubmit = () => {
    if (selectedDiagramId) {
      onSubmit(selectedDiagramId);
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className={styles.overlay}
      onClick={handleOverlayClick}
      data-testid="add-link-modal"
    >
      <div className={styles.modal}>
        {/* Header */}
        <div className={styles.header}>
          <h2 className={styles.title}>Add Link</h2>
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
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>
              Target Diagram
            </label>
            <DiagramAutocomplete
              diagrams={diagrams}
              selectedDiagramId={selectedDiagramId}
              onSelect={setSelectedDiagramId}
            />
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
            onClick={handleSubmit}
            disabled={!selectedDiagramId}
            data-testid="modal-link-button"
          >
            Link
          </button>
        </div>
      </div>
    </div>
  );
}
