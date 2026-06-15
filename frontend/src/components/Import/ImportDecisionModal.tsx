/**
 * ImportDecisionModal Component
 *
 * Spec 2026-03-05: Import Product Snapshot Redesign
 * Task Group 4: Import Decision Modal (Save-and-Replace vs. Merge)
 *
 * Simplified modal shown when an active project exists and the user imports
 * a JSON or XLSX file from the TopBar. Provides two options:
 *
 * - Option 1 (JSON only): "Save and close current project, then load imported file"
 * - Option 2: "Merge imported data into current project"
 *
 * For XLSX imports, Option 1 is not applicable. The modal auto-skips to
 * the merge flow via useEffect calling onMerge() on mount.
 *
 * Props:
 * - isOpen: boolean
 * - onClose: () => void
 * - importedProjectName: string (read-only display of imported project/file name)
 * - importSource: 'json' | 'xlsx'
 * - onSaveAndReplace: () => void
 * - onMerge: () => void
 */

import React, { useState, useEffect } from 'react';
import styles from './ImportDecisionModal.module.css';

export interface ImportDecisionModalProps {
  /** Whether the modal is visible */
  isOpen: boolean;
  /** Callback when modal is closed (via Cancel or clicking outside) */
  onClose: () => void;
  /** The imported project/file name for display */
  importedProjectName: string;
  /** The source of the import: json or xlsx */
  importSource: 'json' | 'xlsx';
  /** Callback when user selects Save-and-Replace (Option 1, JSON only) */
  onSaveAndReplace: () => void;
  /** Callback when user selects Merge (Option 2) */
  onMerge: () => void;
}

export function ImportDecisionModal({
  isOpen,
  onClose,
  importedProjectName,
  importSource,
  onSaveAndReplace,
  onMerge,
}: ImportDecisionModalProps) {
  // Default selection: Option 1 (save-and-replace) for JSON; for XLSX we auto-skip
  const [selectedOption, setSelectedOption] = useState<'save-and-replace' | 'merge'>('save-and-replace');

  // Reset selection when modal opens
  useEffect(() => {
    if (isOpen) {
      setSelectedOption('save-and-replace');
    }
  }, [isOpen]);

  // For XLSX imports, Option 1 is not applicable; auto-skip to merge
  useEffect(() => {
    if (isOpen && importSource === 'xlsx') {
      onMerge();
    }
  }, [isOpen, importSource, onMerge]);

  // Handle keyboard events (Escape to close)
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

  // Don't render if not open, or if XLSX (auto-skip handles it)
  if (!isOpen || importSource === 'xlsx') {
    return null;
  }

  const handleContinue = () => {
    if (selectedOption === 'save-and-replace') {
      onSaveAndReplace();
    } else {
      onMerge();
    }
  };

  const handleOverlayClick = () => {
    onClose();
  };

  const handleModalClick = (event: React.MouseEvent) => {
    event.stopPropagation();
  };

  return (
    <div className={styles.overlay} onClick={handleOverlayClick} data-testid="import-decision-modal-overlay">
      <div className={styles.modal} onClick={handleModalClick} data-testid="import-decision-modal">
        {/* Header */}
        <div className={styles.header}>
          <h2 className={styles.title}>Import Product</h2>
          <button
            className={styles.closeButton}
            onClick={onClose}
            data-testid="import-decision-close-button"
          >
            &times;
          </button>
        </div>

        {/* Content */}
        <div className={styles.content}>
          {/* Read-only imported project name */}
          <div className={styles.projectNameGroup}>
            <label className={styles.projectNameLabel}>
              Imported Project
            </label>
            <div
              className={styles.projectNameDisplay}
              data-testid="imported-project-name-display"
            >
              {importedProjectName}
            </div>
          </div>

          {/* Radio button options */}
          <div className={styles.radioGroup}>
            {/* Option 1: Save and Replace (JSON only) */}
            <label
              className={`${styles.radioOption} ${selectedOption === 'save-and-replace' ? styles.radioOptionSelected : ''}`}
              data-testid="option-save-and-replace"
            >
              <input
                type="radio"
                name="import-decision"
                className={styles.radioInput}
                checked={selectedOption === 'save-and-replace'}
                onChange={() => setSelectedOption('save-and-replace')}
                data-testid="radio-save-and-replace"
              />
              <span className={styles.radioLabel}>
                Save and close current project, then load imported file
              </span>
            </label>

            {/* Option 2: Merge */}
            <label
              className={`${styles.radioOption} ${selectedOption === 'merge' ? styles.radioOptionSelected : ''}`}
              data-testid="option-merge"
            >
              <input
                type="radio"
                name="import-decision"
                className={styles.radioInput}
                checked={selectedOption === 'merge'}
                onChange={() => setSelectedOption('merge')}
                data-testid="radio-merge"
              />
              <span className={styles.radioLabel}>
                Merge imported data into current project
              </span>
            </label>
          </div>
        </div>

        {/* Footer */}
        <div className={styles.footer}>
          <button
            className={styles.cancelButton}
            onClick={onClose}
            data-testid="import-decision-cancel-button"
          >
            Cancel
          </button>
          <button
            className={styles.continueButton}
            onClick={handleContinue}
            data-testid="import-decision-continue-button"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}

export default ImportDecisionModal;
