/**
 * MigrationBookOfWorkSaveToBacklogDialog
 *
 * Spec 2026-05-17 PM Migration Delivery Plan -- Task Group 12.
 *
 * Confirmation modal that opens when the user clicks one of the save-mode
 * buttons in the selection controls. Shows:
 *   - Counts of initiatives / epics / features / stories that will be
 *     created (per the selected `saveMode` + the current selection / exclusion
 *     frontend state)
 *   - A warning when low-confidence or blocked items are admitted
 *   - `includeTraceabilityInDescription` toggle
 *   - `includeReadinessInDescription` toggle
 *   - Optional `tagPrefix` input (hint that the prefix is idempotent
 *     additive per Q-10)
 *   - Confirm / Cancel buttons
 *
 * On Confirm: awaits the parent's `onConfirm({...})` callback (which is
 * wired to the AMS save-to-backlog endpoint at the workspace level).
 * Errors keep the modal open so the user can read the message and retry.
 */

import React, { useEffect, useState, useCallback } from 'react';
import type { SaveToBacklogMode } from '../../../api/migrationBookOfWorkApi';
import styles from './MigrationBookOfWork.module.css';

export interface SaveToBacklogCounts {
  initiatives: number;
  epics: number;
  features: number;
  stories: number;
  total: number;
  lowConfidenceCount: number;
  blockedCount: number;
}

export interface MigrationBookOfWorkSaveToBacklogDialogProps {
  open: boolean;
  saveMode: SaveToBacklogMode;
  counts: SaveToBacklogCounts;
  /**
   * Number of admitted EPICS not yet expanded into detailed stories (Spec
   * 2026-06-11 Two-Phase generation, Task Group 5.6). When > 0 the dialog
   * shows a NON-BLOCKING warning -- partially expanded saves are allowed,
   * so Confirm proceeds normally.
   */
  unexpandedEpicCount?: number;
  onClose: () => void;
  onConfirm: (opts: {
    includeTraceabilityInDescription: boolean;
    includeReadinessInDescription: boolean;
    tagPrefix: string;
  }) => Promise<void>;
}

export const MigrationBookOfWorkSaveToBacklogDialog: React.FC<
  MigrationBookOfWorkSaveToBacklogDialogProps
> = ({ open, saveMode, counts, unexpandedEpicCount = 0, onClose, onConfirm }) => {
  const [includeTraceability, setIncludeTraceability] = useState(true);
  const [includeReadiness, setIncludeReadiness] = useState(true);
  const [tagPrefix, setTagPrefix] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Reset transient state whenever the parent flips the dialog open.
  useEffect(() => {
    if (open) {
      setErrorMessage(null);
      setSubmitting(false);
    }
  }, [open]);

  const handleConfirm = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    setErrorMessage(null);
    try {
      await onConfirm({
        includeTraceabilityInDescription: includeTraceability,
        includeReadinessInDescription: includeReadiness,
        tagPrefix,
      });
      onClose();
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Failed to save to backlog.',
      );
      setSubmitting(false);
    }
  }, [
    submitting,
    onConfirm,
    onClose,
    includeTraceability,
    includeReadiness,
    tagPrefix,
  ]);

  if (!open) return null;

  const showLowConfWarning = counts.lowConfidenceCount > 0;
  const showBlockedWarning = counts.blockedCount > 0;

  return (
    <div
      className={styles.modalOverlay}
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
      data-testid="save-to-backlog-dialog"
    >
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-label="Save to backlog"
      >
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>Save to backlog</h2>
        </div>

        <div className={styles.modalBody}>
          <div
            className={styles.modalCounts}
            data-testid="save-to-backlog-counts"
          >
            Save mode: <strong>{saveMode}</strong>. This will create{' '}
            <strong>{counts.total}</strong> work items (
            {counts.initiatives} initiative{counts.initiatives === 1 ? '' : 's'},{' '}
            {counts.epics} epic{counts.epics === 1 ? '' : 's'},{' '}
            {counts.features} feature{counts.features === 1 ? '' : 's'},{' '}
            {counts.stories} stor{counts.stories === 1 ? 'y' : 'ies'}).
          </div>

          {unexpandedEpicCount > 0 && (
            <div
              className={styles.modalWarning}
              data-testid="save-to-backlog-unexpanded-warning"
            >
              Note: {unexpandedEpicCount} epic
              {unexpandedEpicCount === 1 ? ' has' : 's have'} not been expanded
              into detailed stories yet. You can still save now and expand the
              remaining epics in the review workspace later.
            </div>
          )}

          {(showLowConfWarning || showBlockedWarning) && (
            <div
              className={styles.modalWarning}
              data-testid="save-to-backlog-warning"
            >
              Warning: this save will include{' '}
              {showLowConfWarning && (
                <span>{counts.lowConfidenceCount} low-confidence item(s)</span>
              )}
              {showLowConfWarning && showBlockedWarning && ' and '}
              {showBlockedWarning && (
                <span>{counts.blockedCount} blocked item(s)</span>
              )}
              .
            </div>
          )}

          <div className={styles.modalToggleRow}>
            <input
              id="incl-trace-toggle"
              type="checkbox"
              checked={includeTraceability}
              onChange={(e) => setIncludeTraceability(e.target.checked)}
              data-testid="toggle-include-traceability"
            />
            <label htmlFor="incl-trace-toggle">
              Include traceability summary in saved work item descriptions
            </label>
          </div>

          <div className={styles.modalToggleRow}>
            <input
              id="incl-readiness-toggle"
              type="checkbox"
              checked={includeReadiness}
              onChange={(e) => setIncludeReadiness(e.target.checked)}
              data-testid="toggle-include-readiness"
            />
            <label htmlFor="incl-readiness-toggle">
              Include readiness notes in saved work item descriptions
            </label>
          </div>

          <div className={styles.modalInputRow}>
            <label htmlFor="tag-prefix-input">Tag prefix (optional)</label>
            <input
              id="tag-prefix-input"
              type="text"
              className={styles.modalInput}
              placeholder="e.g. mig-2026q2-"
              value={tagPrefix}
              onChange={(e) => setTagPrefix(e.target.value)}
              data-testid="input-tag-prefix"
            />
            <span className={styles.modalHint}>
              Idempotent additive: same tag is a no-op; different tag with the
              same prefix is added alongside (Q-10).
            </span>
          </div>

          {errorMessage && (
            <div
              className={styles.modalWarning}
              role="alert"
              data-testid="save-to-backlog-error"
            >
              {errorMessage}
            </div>
          )}
        </div>

        <div className={styles.modalFooter}>
          <button
            type="button"
            className={styles.selectButton}
            onClick={onClose}
            disabled={submitting}
            data-testid="save-to-backlog-cancel"
          >
            Cancel
          </button>
          <button
            type="button"
            className={`${styles.selectButton} ${styles.selectButtonPrimary}`}
            onClick={() => void handleConfirm()}
            disabled={submitting}
            data-testid="save-to-backlog-confirm"
          >
            {submitting ? 'Saving...' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default MigrationBookOfWorkSaveToBacklogDialog;
