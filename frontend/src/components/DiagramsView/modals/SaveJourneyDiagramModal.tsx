/**
 * SaveJourneyDiagramModal Component
 *
 * Modal for saving a User Journey diagram as a persistent diagram artifact.
 * Contains a name input with validation, Save/Cancel buttons.
 *
 * Follows the exact structural pattern of NewDiagramModal.tsx:
 * - useEffect for Escape key binding
 * - handleOverlayClick with e.target === e.currentTarget guard
 * - header/content/footer layout
 * - isOpen guard returning null
 * - Reuses NewDiagramModal.module.css styles
 *
 * Spec 2026-04-03: User Journey Diagram Edit and Save Flow - Task Group 3
 */

import React, { useState, useCallback, useEffect } from 'react';
import styles from './NewDiagramModal.module.css';
import { validateDiagramName } from '../../../utils/validation';
import type { Diagram } from '../../../types/model';

export interface SaveJourneyDiagramModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (name: string) => void;
  defaultName: string;
  existingDiagrams: Diagram[];
}

export function SaveJourneyDiagramModal({
  isOpen,
  onClose,
  onSubmit,
  defaultName,
  existingDiagrams,
}: SaveJourneyDiagramModalProps) {
  // Local state
  const [name, setName] = useState(defaultName);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Reset name when modal opens with a new defaultName
  useEffect(() => {
    if (isOpen) {
      setName(defaultName);
      setValidationError(null);
    }
  }, [isOpen, defaultName]);

  // Handle Escape key (same pattern as NewDiagramModal)
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

  // Handle overlay click (same pattern as NewDiagramModal)
  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose]
  );

  // Clear validation on name input change
  const handleNameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setName(e.target.value);
    setValidationError(null);
  }, []);

  // Reset local state helper
  const resetState = useCallback(() => {
    setName(defaultName);
    setValidationError(null);
  }, [defaultName]);

  // Handle Save button click
  const handleSave = useCallback(() => {
    const trimmedName = name.trim();

    // Validate using validateDiagramName
    const error = validateDiagramName(trimmedName, existingDiagrams);
    if (error) {
      setValidationError(error);
      return;
    }

    // On success: call onSubmit with trimmed name
    onSubmit(trimmedName);
    resetState();
  }, [name, existingDiagrams, onSubmit, resetState]);

  // Handle Cancel button click
  const handleCancel = useCallback(() => {
    resetState();
    onClose();
  }, [resetState, onClose]);

  // isOpen guard: Return null when not open
  if (!isOpen) {
    return null;
  }

  return (
    <div
      className={styles.overlay}
      onClick={handleOverlayClick}
      data-testid="save-journey-modal-overlay"
    >
      <div className={styles.modal} data-testid="save-journey-modal">
        {/* Header */}
        <div className={styles.header}>
          <h2 className={styles.title}>Save Journey as Diagram</h2>
          <button
            className={styles.closeButton}
            onClick={onClose}
            title="Close"
            data-testid="save-journey-close-button"
          >
            &times;
          </button>
        </div>

        {/* Content */}
        <div className={styles.content}>
          {/* Diagram Name field */}
          <div className={styles.formGroup}>
            <label className={styles.formLabel} htmlFor="save-journey-name">
              Diagram Name
            </label>
            <input
              id="save-journey-name"
              className={styles.formInput}
              type="text"
              value={name}
              onChange={handleNameChange}
              autoFocus
              placeholder="Enter diagram name"
              data-testid="save-journey-name-input"
            />
            {validationError && (
              <div
                className={styles.validationError}
                data-testid="save-journey-validation-error"
              >
                {validationError}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className={styles.footer}>
          <button
            className={styles.secondaryButton}
            onClick={handleCancel}
            data-testid="save-journey-cancel-button"
          >
            Cancel
          </button>
          <button
            className={styles.primaryButton}
            onClick={handleSave}
            data-testid="save-journey-save-button"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
