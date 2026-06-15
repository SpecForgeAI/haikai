/**
 * SingleStoryManualEditOverwriteModal
 *
 * Spec: 2026-05-20 In-Product Spec Editor + Confirm-Overwrite -- Task Group 9.2.
 *
 * Single-story confirm-overwrite dialog that gates the drawer Regenerate
 * button when the latest spec row carries `manuallyEdited === true`. The
 * caller decides when to mount the modal (drawer Regenerate handler reads
 * the flag and branches), so this component only owns its own UI.
 *
 *   - Body copy: "This spec was edited by {user} on {date}. Regenerate will
 *     replace your edits."
 *   - Buttons: Cancel (close) / Continue (`onContinue` -> caller fires
 *     regenerate with `overwriteManuallyEdited=true`).
 *
 * The modal is intentionally a thin presentational shell; the parent owns
 * the regenerate side-effects so the modal stays trivially testable.
 */

import React, { useEffect } from 'react';
import styles from './MigrationDeliveryDashboard.module.css';

export interface SingleStoryManualEditOverwriteModalProps {
  /** Identity of the user who last manually saved the spec. */
  lastManuallyEditedBy: string | null;
  /** ISO-8601 timestamp of the latest manual save. */
  lastManuallyEditedAt: string | null;
  /** Cancel handler -- closes the modal without firing regenerate. */
  onCancel: () => void;
  /** Continue handler -- caller fires regenerate with overwrite=true. */
  onContinue: () => void;
  /** Optional override of the modal testId. */
  testId?: string;
}

function formatEditedAt(value: string | null): string {
  if (!value) return 'an unknown date';
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleString();
  } catch {
    return value;
  }
}

export const SingleStoryManualEditOverwriteModal: React.FC<
  SingleStoryManualEditOverwriteModalProps
> = ({
  lastManuallyEditedBy,
  lastManuallyEditedAt,
  onCancel,
  onContinue,
  testId,
}) => {
  // Esc-to-cancel mirroring the drawer convention.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  const resolvedTestId = testId ?? 'manual-edit-overwrite-confirm-modal';
  const userLabel = lastManuallyEditedBy ?? 'an unknown user';
  const dateLabel = formatEditedAt(lastManuallyEditedAt);

  return (
    <div
      className={styles.dialogBackdrop}
      data-testid={`${resolvedTestId}-backdrop`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className={styles.dialogPanel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${resolvedTestId}-title`}
        data-testid={resolvedTestId}
      >
        <header className={styles.dialogHeader}>
          <h2
            id={`${resolvedTestId}-title`}
            className={styles.dialogTitle}
            data-testid={`${resolvedTestId}-title`}
          >
            Replace manual edits?
          </h2>
          <button
            type="button"
            className={styles.drawerCloseButton}
            data-testid={`${resolvedTestId}-close`}
            onClick={onCancel}
            aria-label="Cancel overwrite confirmation"
          >
            X
          </button>
        </header>
        <div className={styles.dialogBody}>
          <p
            className={styles.modalDescription}
            data-testid={`${resolvedTestId}-body`}
          >
            This spec was edited by <strong>{userLabel}</strong> on{' '}
            <strong>{dateLabel}</strong>. Regenerate will replace your edits
            with a fresh LLM output.
          </p>
        </div>
        <footer className={styles.dialogFooter}>
          <button
            type="button"
            className={styles.dialogSecondaryButton}
            data-testid={`${resolvedTestId}-cancel`}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className={styles.dialogPrimaryButton}
            data-testid={`${resolvedTestId}-continue`}
            onClick={onContinue}
          >
            Continue
          </button>
        </footer>
      </div>
    </div>
  );
};

export default SingleStoryManualEditOverwriteModal;
