/**
 * BulkManualEditOverwriteModal
 *
 * Spec: 2026-05-20 In-Product Spec Editor + Confirm-Overwrite -- Task Group 9.3.
 *
 * Bulk confirm-overwrite picker rendered as step 2 of the Generate-all flow
 * (after the cost-preview confirmation) AND step 2 of the Retry-batch flow
 * (after the resolver populates the candidate set). Mount only when the
 * gateway pre-flight (`fetchManuallyEditedInScope`) returned at least one
 * row -- callers that get an empty list should proceed directly to the
 * regenerate call.
 *
 * Behaviour:
 *   - Per-row checkbox, default UNCHECKED (skip).
 *   - Header bulk-toggle radios: "Skip all manually edited" (default) /
 *     "Overwrite all" -- the second flips every row's checkbox to checked.
 *   - On Confirm: caller receives the array of WorkItem ids to overwrite
 *     (could be empty if the user kept everything skipped) plus the
 *     `overwriteManuallyEdited` flag (always true; the array of zero means
 *     "force the flag on but allow-list nothing", which is functionally
 *     identical to leaving it off but keeps the audit trail consistent).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import styles from './MigrationDeliveryDashboard.module.css';
import type { ManuallyEditedScopeRow } from '../../../api/specGenerationApi';

export interface BulkManualEditOverwriteModalProps {
  /** Pre-flight rows for the bulk picker -- one entry per manually-edited spec in scope. */
  rows: ManuallyEditedScopeRow[];
  /** Cancel handler. */
  onCancel: () => void;
  /**
   * Confirm handler. Passes the explicit allow-list of WorkItem ids to
   * overwrite (skipped rows are excluded). Callers fire the regenerate batch
   * with `overwriteManuallyEdited=true` whenever this array is non-empty.
   */
  onConfirm: (input: { manuallyEditedWorkItemIdsToOverwrite: string[] }) => void;
  /** Optional override of the modal testId. */
  testId?: string;
  /** Title override -- used so the Retry-batch flow can swap wording. */
  title?: string;
}

function formatEditedAt(value: string | null): string {
  if (!value) return 'unknown';
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleString();
  } catch {
    return value;
  }
}

export const BulkManualEditOverwriteModal: React.FC<
  BulkManualEditOverwriteModalProps
> = ({ rows, onCancel, onConfirm, testId, title }) => {
  // Per-row checked state keyed by workItemId. Default UNCHECKED for every row.
  const [checked, setChecked] = useState<Record<string, boolean>>(() => {
    const seed: Record<string, boolean> = {};
    for (const row of rows) seed[row.workItemId] = false;
    return seed;
  });

  // Resync when the rows prop changes (e.g. parent re-fetches the pre-flight).
  useEffect(() => {
    setChecked(() => {
      const seed: Record<string, boolean> = {};
      for (const row of rows) seed[row.workItemId] = false;
      return seed;
    });
  }, [rows]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  const toggleRow = useCallback((workItemId: string) => {
    setChecked((prev) => ({
      ...prev,
      [workItemId]: !prev[workItemId],
    }));
  }, []);

  const checkAll = useCallback(() => {
    setChecked(() => {
      const next: Record<string, boolean> = {};
      for (const row of rows) next[row.workItemId] = true;
      return next;
    });
  }, [rows]);

  const uncheckAll = useCallback(() => {
    setChecked(() => {
      const next: Record<string, boolean> = {};
      for (const row of rows) next[row.workItemId] = false;
      return next;
    });
  }, [rows]);

  const allowList = useMemo(
    () => rows.map((r) => r.workItemId).filter((id) => checked[id] === true),
    [rows, checked],
  );

  const handleConfirm = useCallback(() => {
    onConfirm({ manuallyEditedWorkItemIdsToOverwrite: allowList });
  }, [onConfirm, allowList]);

  const resolvedTestId = testId ?? 'manual-edit-overwrite-bulk-modal';
  const resolvedTitle = title ?? 'Some specs were manually edited';
  const allChecked = rows.length > 0 && allowList.length === rows.length;
  const noneChecked = allowList.length === 0;

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
            {resolvedTitle}
          </h2>
          <button
            type="button"
            className={styles.drawerCloseButton}
            data-testid={`${resolvedTestId}-close`}
            onClick={onCancel}
            aria-label="Cancel bulk overwrite confirmation"
          >
            X
          </button>
        </header>
        <div className={styles.dialogBody}>
          <p
            className={styles.modalDescription}
            data-testid={`${resolvedTestId}-body`}
          >
            The following stories have manually-edited specs. By default they
            will be <strong>skipped</strong>. Check the rows you want to
            overwrite with a fresh LLM output.
          </p>
          <div
            className={styles.modalBulkHeaderToggleRow}
            data-testid={`${resolvedTestId}-header-toggles`}
          >
            <label className={styles.dialogToggleLabel}>
              <input
                type="radio"
                name={`${resolvedTestId}-bulk-toggle`}
                data-testid={`${resolvedTestId}-toggle-skip-all`}
                checked={noneChecked}
                onChange={uncheckAll}
              />
              Skip all manually edited
            </label>
            <label className={styles.dialogToggleLabel}>
              <input
                type="radio"
                name={`${resolvedTestId}-bulk-toggle`}
                data-testid={`${resolvedTestId}-toggle-overwrite-all`}
                checked={allChecked}
                onChange={checkAll}
              />
              Overwrite all
            </label>
          </div>
          <div
            className={styles.modalBulkList}
            data-testid={`${resolvedTestId}-rows`}
          >
            {rows.map((row) => {
              const rowChecked = checked[row.workItemId] === true;
              return (
                <label
                  key={row.workItemId}
                  className={styles.modalBulkRow}
                  data-testid={`${resolvedTestId}-row-${row.workItemId}`}
                >
                  <input
                    type="checkbox"
                    data-testid={`${resolvedTestId}-row-${row.workItemId}-checkbox`}
                    checked={rowChecked}
                    onChange={() => toggleRow(row.workItemId)}
                  />
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span>
                      {row.workItemTitle ?? row.workItemId}
                    </span>
                    <span className={styles.modalBulkRowMeta}>
                      Edited by {row.lastManuallyEditedBy ?? 'unknown'} on{' '}
                      {formatEditedAt(row.lastManuallyEditedAt)}
                    </span>
                  </div>
                </label>
              );
            })}
          </div>
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
            data-testid={`${resolvedTestId}-confirm`}
            onClick={handleConfirm}
          >
            Confirm
          </button>
        </footer>
      </div>
    </div>
  );
};

export default BulkManualEditOverwriteModal;
