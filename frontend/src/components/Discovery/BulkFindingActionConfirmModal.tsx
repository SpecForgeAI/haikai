/**
 * BulkFindingActionConfirmModal
 *
 * Spec 2026-05-28 Bulk Findings Actions -- Task Group 3.5.
 * Spec F 2026-06-02 Normalize Findings Review Actions -- the status display
 * labels adopt the candidate-parity disposition vocabulary
 * (Approved / Rejected / Deferred).
 *
 * Confirmation modal that opens for EVERY bulk action on the Findings tab
 * (Q3 -- no count threshold). Echoes the action's scope + active filter
 * text (Q8), shows an approximate skipped preview computed client-side
 * from the loaded filtered list (Q13 -- tilde-prefixed), and offers an
 * optional reviewer-note textarea (500-char soft cap).
 *
 * Pattern source: `DeleteDiagramConfirmModal.tsx` (escape key + overlay
 * click + isOpen guard + header/content/footer layout). This modal adds:
 *   - reviewer-note textarea, only echoed in the request body when
 *     non-empty after `.trim()` (Q5)
 *   - spinner + disabled-confirm while the API call is in flight
 *
 * The parent (`FindingsTab`) owns the `bulkReviewFindings` call -- this
 * modal is purely UI + a `onConfirm({ reviewerNotes? })` callback.
 */

import React, { useCallback, useEffect, useState } from 'react';
import styles from './BulkFindingActionConfirmModal.module.css';
import type { DiscoveryFindingStatus } from '../../api/findingsApi';

const NOTES_SOFT_CAP = 500;

/**
 * Human-readable disposition label rendered in the title (`Mark X findings
 * as Approved?`).
 */
function statusDisplayLabel(status: DiscoveryFindingStatus | string): string {
  switch (status) {
    case 'approved':
      return 'Approved';
    case 'rejected':
      return 'Rejected';
    case 'deferred':
      return 'Deferred';
    case 'pending_review':
      return 'Pending Review';
    default:
      return String(status);
  }
}

export interface BulkFindingActionConfirmModalProps {
  isOpen: boolean;
  /**
   * The reviewer-target disposition. Title + the call-to-action label both
   * derive from this.
   */
  targetStatus: DiscoveryFindingStatus | string;
  /**
   * Number of findings that will actually be acted upon (the action count,
   * after subtracting same-disposition rows). Echoed in the title.
   */
  actionCount: number;
  /**
   * Scope label ("All" or "Filtered"). Echoed in the body's scope line.
   */
  scopeLabel: 'All' | 'Filtered';
  /**
   * Comma-separated active filter text (Q8) -- e.g.
   * `Severity=high, Category=ambiguity`. Empty string when scope is `All`.
   */
  activeFilterText: string;
  /**
   * Approximate count of findings in scope that will be SKIPPED for
   * already-in-target (no transition needed). Rendered tilde-prefixed
   * (Q13).
   */
  approximateSkipped: number;
  /**
   * True while `bulkReviewFindings` is in flight. Disables Cancel +
   * Confirm and renders a spinner inside Confirm.
   */
  inFlight: boolean;
  onClose: () => void;
  /**
   * Fired when the reviewer clicks Confirm. The trimmed reviewer notes
   * are forwarded only when non-empty (Q5); otherwise `undefined`.
   */
  onConfirm: (payload: { reviewerNotes?: string }) => void;
}

export function BulkFindingActionConfirmModal({
  isOpen,
  targetStatus,
  actionCount,
  scopeLabel,
  activeFilterText,
  approximateSkipped,
  inFlight,
  onClose,
  onConfirm,
}: BulkFindingActionConfirmModalProps) {
  const [notes, setNotes] = useState<string>('');

  // Reset textarea state whenever the modal transitions closed->open so a
  // stale value from a previous open doesn't leak into the next action.
  useEffect(() => {
    if (isOpen) {
      setNotes('');
    }
  }, [isOpen]);

  // Escape-key dismiss (mirrors the DeleteDiagramConfirmModal pattern).
  // Suppressed while the API call is in flight so an ill-timed key event
  // can't dismiss the modal mid-network round-trip.
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !inFlight) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, inFlight, onClose]);

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget && !inFlight) {
        onClose();
      }
    },
    [onClose, inFlight],
  );

  const handleConfirm = useCallback(() => {
    const trimmed = notes.trim();
    onConfirm({ reviewerNotes: trimmed.length > 0 ? trimmed : undefined });
  }, [notes, onConfirm]);

  if (!isOpen) {
    return null;
  }

  const statusLabel = statusDisplayLabel(targetStatus);
  const scopeLine =
    scopeLabel === 'Filtered' && activeFilterText.length > 0
      ? `Scope: Filtered (${activeFilterText})`
      : `Scope: ${scopeLabel}`;
  const overCap = notes.length > NOTES_SOFT_CAP;

  return (
    <div
      className={styles.overlay}
      onClick={handleOverlayClick}
      data-testid="bulk-finding-action-confirm-modal"
    >
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2 className={styles.title} data-testid="bulk-confirm-title">
            Mark {actionCount} findings as {statusLabel}?
          </h2>
          <button
            className={styles.closeButton}
            onClick={onClose}
            disabled={inFlight}
            title="Close"
            data-testid="bulk-confirm-close-button"
          >
            &times;
          </button>
        </div>

        <div className={styles.content}>
          <div className={styles.scopeLine} data-testid="bulk-confirm-scope">
            {scopeLine}
          </div>
          {approximateSkipped > 0 && (
            <div
              className={styles.skippedPreview}
              data-testid="bulk-confirm-skipped-preview"
            >
              ~{approximateSkipped} already {statusLabel.toLowerCase()}
            </div>
          )}

          <label
            className={styles.notesLabel}
            htmlFor="bulk-confirm-notes-textarea"
          >
            Reviewer notes (optional)
          </label>
          <textarea
            id="bulk-confirm-notes-textarea"
            className={styles.notesTextarea}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Add a note that will be saved on every updated finding..."
            disabled={inFlight}
            data-testid="bulk-confirm-notes-textarea"
          />
          <div
            className={`${styles.notesCounter} ${overCap ? styles.notesCounterOver : ''}`}
            data-testid="bulk-confirm-notes-counter"
          >
            {notes.length} / {NOTES_SOFT_CAP}
          </div>
        </div>

        <div className={styles.footer}>
          <button
            className={styles.secondaryButton}
            onClick={onClose}
            disabled={inFlight}
            data-testid="bulk-confirm-cancel-button"
          >
            Cancel
          </button>
          <button
            className={styles.primaryButton}
            onClick={handleConfirm}
            disabled={inFlight}
            data-testid="bulk-confirm-confirm-button"
          >
            {inFlight && <span className={styles.spinner} aria-hidden="true" />}
            {inFlight ? 'Applying...' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}
