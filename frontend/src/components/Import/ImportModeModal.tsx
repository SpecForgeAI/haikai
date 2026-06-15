/**
 * ImportModeModal Component
 *
 * Spec 2026-01-11: Redesign Import as XLSX for Architecture Meta-Model
 *
 * Modal dialog for selecting import mode when importing XLSX data into
 * a meta-model that already contains data.
 *
 * Provides two options:
 * - Append: Add new rows only, skip rows with matching names
 * - Overwrite: Update existing rows and add new rows
 *
 * Follows styling pattern from CreateProjectModal.tsx.
 */

import React, { useEffect } from 'react';
import styles from './ImportModeModal.module.css';

/**
 * Import mode type - Append or Overwrite
 */
export type ImportMode = 'append' | 'overwrite';

/**
 * Props for ImportModeModal component
 */
export interface ImportModeModalProps {
  /** Whether the modal is visible */
  isOpen: boolean;
  /** Callback when modal is closed (via Cancel or clicking outside) */
  onClose: () => void;
  /** Callback when user confirms a mode selection */
  onConfirm: (mode: ImportMode) => void;
  /** Name of the file being imported */
  fileName: string;
}

/**
 * ImportModeModal Component
 *
 * Renders a modal dialog for selecting import mode.
 */
export function ImportModeModal({
  isOpen,
  onClose,
  onConfirm,
  fileName,
}: ImportModeModalProps) {
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

  /**
   * Handle Append button click
   */
  const handleAppendClick = () => {
    onConfirm('append');
  };

  /**
   * Handle Overwrite button click
   */
  const handleOverwriteClick = () => {
    onConfirm('overwrite');
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
    <div className={styles.overlay} onClick={handleOverlayClick}>
      <div className={styles.modal} onClick={handleModalClick}>
        {/* Header */}
        <div className={styles.header}>
          <h2 className={styles.title}>Import Mode</h2>
          <button
            className={styles.closeButton}
            onClick={onClose}
            data-testid="import-mode-close"
          >
            &times;
          </button>
        </div>

        {/* Content */}
        <div className={styles.content}>
          {/* File info */}
          {fileName && (
            <div className={styles.fileInfo}>
              <span className={styles.fileLabel}>Importing:</span>
              <span className={styles.fileName} data-testid="import-file-name">
                {fileName}
              </span>
            </div>
          )}

          <p className={styles.description}>
            The current meta-model contains existing data. How would you like to handle the import?
          </p>

          {/* Mode options */}
          <div className={styles.modeOptions}>
            {/* Append option */}
            <div className={styles.modeCard} data-testid="append-mode-card">
              <h3 className={styles.modeTitle}>Append</h3>
              <p className={styles.modeDescription}>
                Add new rows only. Existing rows with matching names are preserved (skipped).
              </p>
              <button
                className={styles.appendButton}
                onClick={handleAppendClick}
                data-testid="append-mode-button"
              >
                Append
              </button>
            </div>

            {/* Overwrite option */}
            <div className={styles.modeCard} data-testid="overwrite-mode-card">
              <h3 className={styles.modeTitle}>Overwrite</h3>
              <p className={styles.modeDescription}>
                Update existing rows and add new rows. Rows are matched by name field.
              </p>
              <button
                className={styles.overwriteButton}
                onClick={handleOverwriteClick}
                data-testid="overwrite-mode-button"
              >
                Overwrite
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className={styles.footer}>
          <button
            className={styles.cancelButton}
            onClick={onClose}
            data-testid="import-mode-cancel"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export default ImportModeModal;
