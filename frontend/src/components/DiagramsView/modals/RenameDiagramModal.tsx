/**
 * RenameDiagramModal Component
 *
 * Modal for renaming an existing diagram. Pre-populates the name input
 * with the current diagram name and validates:
 * 1. Name is not the same as the current name
 * 2. Name is not empty
 * 3. Name does not duplicate another existing diagram name
 *
 * Follows the DeleteDiagramElementModal pattern for modal structure.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Diagram } from '../../../types/model';
import { validateDiagramName } from '../../../utils/validation';
import styles from './RenameDiagramModal.module.css';

export interface RenameDiagramModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (newName: string) => void;
  existingDiagrams: Diagram[];
  currentDiagramName: string;
}

export function RenameDiagramModal({
  isOpen,
  onClose,
  onSubmit,
  existingDiagrams,
  currentDiagramName,
}: RenameDiagramModalProps) {
  const [name, setName] = useState(currentDiagramName);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Re-initialize name when currentDiagramName changes
  useEffect(() => {
    setName(currentDiagramName);
    setValidationError(null);
  }, [currentDiagramName]);

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

  // Handle name input change - clear validation error when user modifies input
  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setName(e.target.value);
    setValidationError(null);
  };

  // Handle rename submission with 3-step validation
  const handleRename = () => {
    // Step 1: Trim the name
    const trimmedName = name.trim();

    // Step 2: Check if trimmed name equals currentDiagramName
    if (trimmedName === currentDiagramName) {
      setValidationError('The new name is the same as the current name.');
      return;
    }

    // Step 3: Call validateDiagramName for empty/duplicate checks
    const error = validateDiagramName(trimmedName, existingDiagrams);
    if (error) {
      setValidationError(error);
      return;
    }

    // Success: call onSubmit with trimmed name and reset local state
    onSubmit(trimmedName);
    setName('');
    setValidationError(null);
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className={styles.overlay}
      onClick={handleOverlayClick}
      data-testid="rename-diagram-modal"
    >
      <div className={styles.modal}>
        {/* Header */}
        <div className={styles.header}>
          <h2 className={styles.title}>Rename Diagram</h2>
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
            <label className={styles.formLabel} htmlFor="rename-diagram-name">
              Diagram New Name
            </label>
            <input
              id="rename-diagram-name"
              className={styles.formInput}
              type="text"
              value={name}
              onChange={handleNameChange}
              autoFocus
              data-testid="rename-diagram-name-input"
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
            onClick={handleRename}
            data-testid="modal-rename-button"
          >
            Rename
          </button>
        </div>
      </div>
    </div>
  );
}
