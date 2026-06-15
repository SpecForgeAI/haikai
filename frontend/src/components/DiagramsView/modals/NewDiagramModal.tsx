/**
 * NewDiagramModal Component
 *
 * Modal for creating a new diagram. Contains name input, type dropdown,
 * validation display, Create/Cancel buttons.
 *
 * Follows the modal pattern established in DeleteDiagramElementModal:
 * - useEffect for Escape key binding
 * - handleOverlayClick with e.target === e.currentTarget guard
 * - header/content/footer layout
 * - isOpen guard returning null
 *
 * Spec 2026-03-05: Diagrams Toolbar UX Refresh - Task Group 3
 */

import React, { useState, useCallback, useEffect } from 'react';
import styles from './NewDiagramModal.module.css';
import { DiagramType, CREATABLE_DIAGRAM_TYPES, DIAGRAM_TYPE_LABELS, DEFAULT_DIAGRAM_TYPE } from '../../../types/diagramType';
import { validateDiagramName } from '../../../utils/validation';
import type { Diagram } from '../../../types/model';

export interface NewDiagramModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (name: string, diagramType: DiagramType) => void;
  existingDiagrams: Diagram[];
}

export function NewDiagramModal({
  isOpen,
  onClose,
  onSubmit,
  existingDiagrams,
}: NewDiagramModalProps) {
  // Local state
  const [name, setName] = useState('');
  const [diagramType, setDiagramType] = useState<DiagramType>(DEFAULT_DIAGRAM_TYPE);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Handle Escape key (same pattern as DeleteDiagramElementModal lines 34-43)
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

  // Handle overlay click (same pattern as DeleteDiagramElementModal lines 46-53)
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

  // Handle type change
  const handleTypeChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setDiagramType(e.target.value as DiagramType);
  }, []);

  // Reset local state helper
  const resetState = useCallback(() => {
    setName('');
    setDiagramType(DEFAULT_DIAGRAM_TYPE);
    setValidationError(null);
  }, []);

  // Handle Create button click
  const handleCreate = useCallback(() => {
    const trimmedName = name.trim();

    // Validate using validateDiagramName
    const error = validateDiagramName(trimmedName, existingDiagrams);
    if (error) {
      setValidationError(error);
      return;
    }

    // On success: call onSubmit, reset local state
    onSubmit(trimmedName, diagramType);
    resetState();
  }, [name, diagramType, existingDiagrams, onSubmit, resetState]);

  // Handle Cancel button click
  const handleCancel = useCallback(() => {
    resetState();
    onClose();
  }, [resetState, onClose]);

  // isOpen guard: Return null when not open (same pattern as DeleteDiagramElementModal line 55-57)
  if (!isOpen) {
    return null;
  }

  return (
    <div
      className={styles.overlay}
      onClick={handleOverlayClick}
      data-testid="new-diagram-modal-overlay"
    >
      <div className={styles.modal} data-testid="new-diagram-modal">
        {/* Header */}
        <div className={styles.header}>
          <h2 className={styles.title}>Create New Diagram</h2>
          <button
            className={styles.closeButton}
            onClick={onClose}
            title="Close"
            data-testid="new-diagram-close-button"
          >
            &times;
          </button>
        </div>

        {/* Content */}
        <div className={styles.content}>
          {/* Diagram Name field */}
          <div className={styles.formGroup}>
            <label className={styles.formLabel} htmlFor="new-diagram-name">
              Diagram Name
            </label>
            <input
              id="new-diagram-name"
              className={styles.formInput}
              type="text"
              value={name}
              onChange={handleNameChange}
              autoFocus
              placeholder="Enter diagram name"
              data-testid="new-diagram-name-input"
            />
            {validationError && (
              <div
                className={styles.validationError}
                data-testid="new-diagram-validation-error"
              >
                {validationError}
              </div>
            )}
          </div>

          {/* Diagram Type field */}
          <div className={styles.formGroup}>
            <label className={styles.formLabel} htmlFor="new-diagram-type">
              Diagram Type
            </label>
            <select
              id="new-diagram-type"
              className={styles.formSelect}
              value={diagramType}
              onChange={handleTypeChange}
              data-testid="new-diagram-type-select"
            >
              {CREATABLE_DIAGRAM_TYPES.map((type) => (
                <option key={type} value={type}>
                  {DIAGRAM_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Footer */}
        <div className={styles.footer}>
          <button
            className={styles.secondaryButton}
            onClick={handleCancel}
            data-testid="new-diagram-cancel-button"
          >
            Cancel
          </button>
          <button
            className={styles.primaryButton}
            onClick={handleCreate}
            data-testid="new-diagram-create-button"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
