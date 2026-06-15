/**
 * ExportProjectNameModal Component
 *
 * Spec 2026-01-19: Export Project Name Prompt
 * Task Group 1: ExportProjectNameModal Component
 *
 * Modal dialog for prompting user to enter a project name before export.
 * Shown when exporting JSON or XLSX and the project name is unset.
 *
 * Features:
 * - Single text input for project name
 * - Export (primary) and Cancel (secondary) buttons
 * - Auto-focus input on modal open
 * - Enter key triggers Export when input is valid
 * - Escape key triggers Cancel
 * - Inline error message for empty/whitespace input
 *
 * Follows styling pattern from CreateProjectModal.tsx.
 */

import React, { useState, useEffect, useRef } from 'react';
import { validateName, MAX_NAME_LENGTH } from '../../utils/validateName';
import styles from './ExportProjectNameModal.module.css';

/**
 * Props for ExportProjectNameModal component
 */
export interface ExportProjectNameModalProps {
  /** Whether the modal is visible */
  isOpen: boolean;
  /** Callback when modal is closed (via Cancel or Escape) */
  onClose: () => void;
  /** Callback when user confirms with a valid project name */
  onConfirm: (projectName: string) => void;
  /** Optional data-testid for testing */
  'data-testid'?: string;
}

/**
 * ExportProjectNameModal Component
 *
 * Renders a modal dialog for entering a project name before export.
 */
export function ExportProjectNameModal({
  isOpen,
  onClose,
  onConfirm,
  'data-testid': dataTestId,
}: ExportProjectNameModalProps) {
  // Form state
  const [projectName, setProjectName] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Ref for input focus
  const inputRef = useRef<HTMLInputElement>(null);

  /**
   * Reset form state and focus input when modal opens
   */
  useEffect(() => {
    if (isOpen) {
      // Reset form state
      setProjectName('');
      setError(null);

      // Focus input with small delay to ensure modal is rendered
      const timeoutId = setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
      return () => clearTimeout(timeoutId);
    }
  }, [isOpen]);

  /**
   * Handle keyboard events (Escape to close)
   */
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Don't render if not open
  if (!isOpen) {
    return null;
  }

  // Validation: project name must pass shared validateName checks
  const trimmedName = projectName.trim();
  const nameValidationError = projectName.length > 0 ? validateName(projectName, 'Product name') : null;
  const isFormValid = trimmedName.length > 0 && nameValidationError === null;

  /**
   * Handle Export button click
   */
  const handleExport = () => {
    if (trimmedName.length === 0) {
      setError('Product name is required');
      return;
    }
    const validationError = validateName(projectName, 'Product name');
    if (validationError) {
      setError(validationError);
      return;
    }

    onConfirm(trimmedName);
  };

  /**
   * Handle key press in input (Enter to submit)
   */
  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      handleExport();
    }
  };

  /**
   * Handle input change
   */
  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setProjectName(event.target.value);
    // Clear error when user types
    if (error) {
      setError(null);
    }
  };

  /**
   * Handle overlay click (close dialog)
   */
  const handleOverlayClick = () => {
    onClose();
  };

  /**
   * Handle modal content click (prevent propagation)
   */
  const handleModalClick = (event: React.MouseEvent) => {
    event.stopPropagation();
  };

  return (
    <div
      className={styles.overlay}
      onClick={handleOverlayClick}
      data-testid={dataTestId}
    >
      <div className={styles.modal} onClick={handleModalClick}>
        {/* Header */}
        <div className={styles.header}>
          <h2 className={styles.title}>Export Product</h2>
          <button
            className={styles.closeButton}
            onClick={onClose}
            data-testid="close-button"
          >
            &times;
          </button>
        </div>

        {/* Content */}
        <div className={styles.content}>
          {/* Project Name input */}
          <div className={styles.inputGroup}>
            <label className={styles.inputLabel} htmlFor="export-project-name-input">
              Product Name
            </label>
            <input
              ref={inputRef}
              id="export-project-name-input"
              type="text"
              className={styles.input}
              value={projectName}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder="Enter product name..."
              maxLength={MAX_NAME_LENGTH}
              data-testid="project-name-input"
            />
            {/* Inline validation error */}
            {nameValidationError && (
              <span className={styles.validationError} data-testid="name-validation-error">
                {nameValidationError}
              </span>
            )}
          </div>

          {/* Error message */}
          {error && (
            <div className={styles.errorMessage} data-testid="error-message">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className={styles.footer}>
          <button
            className={styles.cancelButton}
            onClick={onClose}
            data-testid="cancel-button"
          >
            Cancel
          </button>
          <button
            className={styles.exportButton}
            onClick={handleExport}
            disabled={!isFormValid}
            data-testid="modal-export-button"
          >
            Export
          </button>
        </div>
      </div>
    </div>
  );
}

export default ExportProjectNameModal;
