/**
 * SaveBackConfirmModal
 *
 * Spec 2026-05-01 Multi-Architecture Discovery Integration -- Task Group 8
 *
 * Confirmation modal modelled on `ArchiveArchitectureConfirmModal.tsx`
 * (spec #3). Blocks the discovery save-back writes until the user
 * explicitly confirms (safety property (e)).
 *
 * Behaviour:
 *   - Renders nothing when `open === false` (parent toggles via state).
 *   - Body copy:
 *       Always: "Save <N> candidates and <M> relationships to architecture
 *               '<name>'?" -- the relationships clause is omitted when
 *               `relationshipCount` is undefined or 0 (we don't surface
 *               counts we don't have).
 *       When `architectureArchived === true`, render a small warning
 *       paragraph beneath the message:
 *               "Note: this architecture is archived. The save-back will
 *               still apply." -- archived architectures are still write-
 *               able from a discovery save-back; the warning just makes
 *               the unusual context obvious to the reviewer.
 *   - Confirm flow:
 *       1. Disable the buttons + show "Saving..." while in flight.
 *       2. Await `onConfirm()`.
 *       3. On success: call `onClose()`.
 *       4. On error: render the error inline and KEEP THE MODAL OPEN.
 *          The parent retains its open state -- the user can fix the
 *          condition (e.g. wait for the network) and retry, or Cancel.
 *   - Esc / X close are disabled while a request is in flight (prevents
 *     the confusing case of the modal vanishing mid-request and the
 *     parent firing post-close handlers against a now-orphaned UI).
 *
 * Architecture-name resolution is handled by the PARENT (it already has
 * `runArchitecture` resolved from `ArchitectureContext.architectures`
 * keyed on the run's bound `architectureId`). The parent passes the name
 * in via `architectureName` so this modal stays a pure presentational
 * shell, easy to test in isolation.
 */

import React, { useCallback, useEffect, useState } from 'react';
import styles from './SaveBackConfirmModal.module.css';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface SaveBackConfirmModalProps {
  /** Whether the modal is visible. The parent toggles this. */
  open: boolean;
  /** Called when the modal should close (Cancel, Escape, X, or success). */
  onClose: () => void;
  /**
   * Called when the user confirms the save-back. The modal awaits this and
   * keeps itself open if it throws (so the inline error is visible and the
   * user can retry / cancel).
   */
  onConfirm: () => Promise<void>;
  /** How many candidates will be promoted (the approved subset). */
  candidateCount: number;
  /**
   * How many relationships will be promoted. Optional: when undefined or
   * 0 the relationships clause is omitted from the body copy entirely
   * (we don't claim a count we don't have).
   */
  relationshipCount?: number;
  /** Resolved architecture name for the body + confirm-button label. */
  architectureName: string;
  /**
   * If true, render a warning paragraph noting that the target architecture
   * is archived. The save-back proceeds either way -- this is information,
   * not a block.
   */
  architectureArchived?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SaveBackConfirmModal({
  open,
  onClose,
  onConfirm,
  candidateCount,
  relationshipCount,
  architectureName,
  architectureArchived = false,
}: SaveBackConfirmModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Reset transient state every time the parent flips the modal open --
  // otherwise stale errors from a previous attempt would leak across
  // opens.
  useEffect(() => {
    if (open) {
      setErrorMessage(null);
      setIsSubmitting(false);
    }
  }, [open]);

  // ---- Escape-to-close (disabled while in-flight) -----------------------
  useEffect(() => {
    if (!open) return;
    if (isSubmitting) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, isSubmitting, onClose]);

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (isSubmitting) return;
      // Only close on a click directly on the overlay backdrop.
      if (e.target === e.currentTarget) onClose();
    },
    [isSubmitting, onClose]
  );

  // ---- Confirm -----------------------------------------------------------
  const handleConfirm = useCallback(async () => {
    if (isSubmitting) return;

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      await onConfirm();
      onClose();
    } catch (err) {
      // Keep the modal open and surface the inline error so the user
      // can read what went wrong and decide whether to retry or cancel.
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Could not save -- please try again.'
      );
      setIsSubmitting(false);
    }
  }, [isSubmitting, onConfirm, onClose]);

  // ---- Render ------------------------------------------------------------
  if (!open) return null;

  const showRelationships =
    typeof relationshipCount === 'number' && relationshipCount > 0;

  // Build the body sentence. The relationships clause is omitted entirely
  // when there are none (or the count was not provided).
  const bodyMessage = showRelationships
    ? `Save ${candidateCount} candidates and ${relationshipCount} relationships to architecture '${architectureName}'?`
    : `Save ${candidateCount} candidates to architecture '${architectureName}'?`;

  const confirmLabel = isSubmitting ? 'Saving...' : `Save to ${architectureName}`;

  return (
    <div
      className={styles.overlay}
      onClick={handleOverlayClick}
      data-testid="save-back-confirm-modal"
    >
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-back-confirm-title"
      >
        {/* Header */}
        <div className={styles.header}>
          <h2 className={styles.title} id="save-back-confirm-title">
            Save to canonical model?
          </h2>
          <button
            className={styles.closeButton}
            onClick={onClose}
            disabled={isSubmitting}
            title="Close"
            data-testid="save-back-confirm-close-x"
          >
            &times;
          </button>
        </div>

        {/* Content */}
        <div className={styles.content}>
          <div className={styles.message} data-testid="save-back-confirm-message">
            {bodyMessage}
          </div>
          {architectureArchived && (
            <p
              className={styles.archivedWarning}
              data-testid="save-back-confirm-archived-warning"
            >
              Note: this architecture is archived. The save-back will still
              apply.
            </p>
          )}
          {errorMessage && (
            <div
              className={styles.errorMessage}
              role="alert"
              data-testid="save-back-confirm-error"
            >
              {errorMessage}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className={styles.footer}>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={onClose}
            disabled={isSubmitting}
            data-testid="save-back-confirm-cancel"
          >
            Cancel
          </button>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={handleConfirm}
            disabled={isSubmitting}
            data-testid="save-back-confirm-confirm"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default SaveBackConfirmModal;
