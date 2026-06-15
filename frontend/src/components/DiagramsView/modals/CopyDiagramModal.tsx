/**
 * CopyDiagramModal Component
 *
 * Modal for copying a diagram. Pre-populates the name field with
 * "[OriginalName] (Copy)" and validates via validateDiagramName.
 *
 * Follows the DeleteDiagramElementModal pattern for:
 * - Escape key binding
 * - Overlay click handling (e.target === e.currentTarget guard)
 * - isOpen guard returning null
 * - Header with close button, content, footer layout
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Diagram } from '../../../types/model';
import { validateDiagramName } from '../../../utils/validation';
import styles from './CopyDiagramModal.module.css';

export interface CopyDiagramModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (name: string) => void;
  existingDiagrams: Diagram[];
  sourceDiagramName: string;
}

export function CopyDiagramModal({
  isOpen,
  onClose,
  onSubmit,
  existingDiagrams,
  sourceDiagramName,
}: CopyDiagramModalProps) {
  const [name, setName] = useState(`${sourceDiagramName} (Copy)`);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Re-initialize name when sourceDiagramName changes (i.e., when modal opens with a different source)
  useEffect(() => {
    setName(`${sourceDiagramName} (Copy)`);
    setValidationError(null);
  }, [sourceDiagramName]);

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

  // Handle Create button click
  const handleCreate = useCallback(() => {
    const trimmedName = name.trim();
    const error = validateDiagramName(trimmedName, existingDiagrams);
    if (error) {
      setValidationError(error);
      return;
    }
    onSubmit(trimmedName);
    // Reset local state
    setName(`${sourceDiagramName} (Copy)`);
    setValidationError(null);
  }, [name, existingDiagrams, onSubmit, sourceDiagramName]);

  // Clear validation error when user modifies the name
  const handleNameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setName(e.target.value);
    setValidationError(null);
  }, []);

  // isOpen guard
  if (!isOpen) {
    return null;
  }

  return (
    <div
      className={styles.overlay}
      onClick={handleOverlayClick}
      data-testid="copy-diagram-modal"
    >
      <div className={styles.modal}>
        {/* Header */}
        <div className={styles.header}>
          <h2 className={styles.title}>Copy Diagram</h2>
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
            <label className={styles.formLabel} htmlFor="copy-diagram-name">
              Copied Diagram New Name
            </label>
            <input
              id="copy-diagram-name"
              className={styles.formInput}
              type="text"
              value={name}
              onChange={handleNameChange}
              autoFocus
              data-testid="copy-diagram-name-input"
            />
            {validationError && (
              <div className={styles.validationError} data-testid="validation-error">
                {validationError}
              </div>
            )}
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
            onClick={handleCreate}
            data-testid="modal-create-button"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
