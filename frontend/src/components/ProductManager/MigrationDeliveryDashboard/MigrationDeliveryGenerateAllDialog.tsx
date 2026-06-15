/**
 * MigrationDeliveryGenerateAllDialog
 *
 * Spec: 2026-05-20 Cross-Story Context Injection -- Task Group 7.4
 *
 * Modal dialog used to launch a Generate-all batch run from the dashboard.
 * Responsibilities:
 *   1. Render the per-batch auto-run pass-2 toggle. Defaults to the
 *      project-level setting passed in via `defaultAutoRunPass2` (the
 *      dashboard reads this from project config, Task Group 9.5). The
 *      user can flip the toggle to disable pass 2 for heavy batches.
 *   2. Call POST /api/migration-shape-spec/cost-preview as soon as the
 *      dialog opens (and on every toggle change) so the user sees the
 *      estimated tokens + wall-clock seconds before they submit.
 *   3. On submit, call the supplied `onConfirm` callback with the chosen
 *      `autoRunPass2`. The parent owns the actual batch invocation +
 *      AppShell cache invalidation.
 *   4. When the concurrency-lock signal is held (`concurrencyLockError`
 *      prop is non-null), disable the Generate-all action AND render the
 *      "Batch in progress" banner above the body.
 *
 * Conventions mirror the existing dashboard CSS module + section retry
 * placeholder pattern. The dialog uses a simple backdrop + centred panel,
 * matching `MigrationDeliveryStoryDrawer.tsx` for keyboard / focus
 * behaviour (Esc closes; backdrop click closes when target is the
 * backdrop itself).
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  fetchMigrationShapeSpecCostPreview,
  type CostPreviewResponse,
} from '../../../api/migrationShapeSpecCostPreviewApi';
import type { WorkstreamLockedErrorPayload } from '../../../api/migrationShapeSpecCostPreviewApi';
import styles from './MigrationDeliveryDashboard.module.css';

// ============================================================================
// Props
// ============================================================================

export interface MigrationDeliveryGenerateAllDialogProps {
  projectId: string;
  bookOfWorkId: string;
  /**
   * Project-level default for the auto-run pass-2 flag (Task Group 9.5).
   * The dialog's toggle is initialised to this value; the user can override
   * for the current batch.
   */
  defaultAutoRunPass2: boolean;
  /**
   * When non-null, the concurrency lock is held -- the dialog disables the
   * Generate-all action and renders the "Batch in progress" banner.
   */
  concurrencyLockError?: WorkstreamLockedErrorPayload | null;
  /**
   * Test seam: override the cost-preview fetcher. Defaults to the real
   * `fetchMigrationShapeSpecCostPreview` import.
   */
  fetchCostPreview?: typeof fetchMigrationShapeSpecCostPreview;
  /**
   * Invoked when the user clicks Generate-all. The parent owns the actual
   * batch invocation; the dialog stays presentational.
   */
  onConfirm: (input: { autoRunPass2: boolean }) => void;
  /** Invoked when the user dismisses the dialog (Cancel / X / Esc). */
  onClose: () => void;
}

// ============================================================================
// Component
// ============================================================================

export const MigrationDeliveryGenerateAllDialog: React.FC<
  MigrationDeliveryGenerateAllDialogProps
> = ({
  projectId,
  bookOfWorkId,
  defaultAutoRunPass2,
  concurrencyLockError,
  fetchCostPreview = fetchMigrationShapeSpecCostPreview,
  onConfirm,
  onClose,
}) => {
  const [autoRunPass2, setAutoRunPass2] = useState<boolean>(defaultAutoRunPass2);
  const [costPreview, setCostPreview] = useState<CostPreviewResponse | null>(
    null,
  );
  const [costError, setCostError] = useState<string | null>(null);
  const [costLoading, setCostLoading] = useState<boolean>(false);

  // ----- Esc-to-close ------------------------------------------------------
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // ----- Cost-preview fetch ----------------------------------------------
  const loadCostPreview = useCallback(
    async (includePass2: boolean) => {
      setCostLoading(true);
      setCostError(null);
      try {
        const result = await fetchCostPreview({
          projectId,
          bookOfWorkId,
          includePass2,
        });
        setCostPreview(result);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to load cost preview';
        setCostError(message);
        setCostPreview(null);
      } finally {
        setCostLoading(false);
      }
    },
    [fetchCostPreview, projectId, bookOfWorkId],
  );

  // Initial fetch + refetch on toggle change.
  useEffect(() => {
    void loadCostPreview(autoRunPass2);
  }, [loadCostPreview, autoRunPass2]);

  const isLocked = concurrencyLockError != null;

  return (
    <div
      className={styles.dialogBackdrop}
      data-testid="mdd-generate-all-dialog-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={styles.dialogPanel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mdd-generate-all-dialog-title"
        data-testid="mdd-generate-all-dialog"
      >
        <header className={styles.dialogHeader}>
          <h2
            id="mdd-generate-all-dialog-title"
            className={styles.dialogTitle}
            data-testid="mdd-generate-all-dialog-title"
          >
            Generate all shape specs
          </h2>
          <button
            type="button"
            className={styles.drawerCloseButton}
            data-testid="mdd-generate-all-dialog-close"
            onClick={onClose}
            aria-label="Close generate-all dialog"
          >
            X
          </button>
        </header>

        <div className={styles.dialogBody}>
          {/* Concurrency-lock banner */}
          {isLocked && (
            <div
              className={styles.batchInProgressBanner}
              role="alert"
              data-testid="mdd-generate-all-dialog-lock-banner"
            >
              Batch in progress (pass {concurrencyLockError?.activePass} of 2).
              Cancel the current batch before launching another.
            </div>
          )}

          {/* Per-batch auto-run pass-2 toggle */}
          <div className={styles.dialogToggleRow}>
            <label
              className={styles.dialogToggleLabel}
              data-testid="mdd-generate-all-dialog-pass2-toggle-label"
            >
              <input
                type="checkbox"
                checked={autoRunPass2}
                onChange={(e) => setAutoRunPass2(e.target.checked)}
                data-testid="mdd-generate-all-dialog-pass2-toggle"
                disabled={isLocked}
              />
              {' Auto-run pass 2 after pass 1 completes'}
            </label>
            <p
              className={styles.dialogToggleDescription}
              data-testid="mdd-generate-all-dialog-pass2-description"
            >
              Project default: {defaultAutoRunPass2 ? 'on' : 'off'}. Pass 2
              injects sibling decisions, parent epic decisions, and
              workstream-deduped references; turn off for heavy batches.
            </p>
          </div>

          {/* Cost preview block */}
          <div
            className={styles.dialogCostPreview}
            data-testid="mdd-generate-all-dialog-cost-preview"
          >
            {costLoading && (
              <p
                className={styles.dialogToggleDescription}
                data-testid="mdd-generate-all-dialog-cost-loading"
              >
                Estimating cost...
              </p>
            )}
            {costError && (
              <p
                className={styles.errorBanner}
                data-testid="mdd-generate-all-dialog-cost-error"
              >
                Cost preview unavailable: {costError}
              </p>
            )}
            {!costLoading && !costError && costPreview && (
              <>
                <p
                  className={styles.drawerParagraph}
                  data-testid="mdd-generate-all-dialog-cost-tokens"
                >
                  <strong>Estimated tokens: </strong>
                  {costPreview.estimatedTokens.toLocaleString()}
                </p>
                <p
                  className={styles.drawerParagraph}
                  data-testid="mdd-generate-all-dialog-cost-wallclock"
                >
                  <strong>Estimated wall-clock: </strong>
                  {costPreview.estimatedWallClockSeconds.toFixed(1)}s
                </p>
                <p
                  className={styles.drawerSubtle}
                  data-testid="mdd-generate-all-dialog-cost-story-count"
                >
                  {`Across ${costPreview.meta.storyCount} stories at `}
                  {`${costPreview.meta.tokensPerSecond} tokens/sec.`}
                </p>
              </>
            )}
          </div>
        </div>

        <footer className={styles.dialogFooter}>
          <button
            type="button"
            className={styles.dialogSecondaryButton}
            data-testid="mdd-generate-all-dialog-cancel"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className={styles.dialogPrimaryButton}
            data-testid="mdd-generate-all-dialog-confirm"
            onClick={() => onConfirm({ autoRunPass2 })}
            disabled={isLocked}
          >
            Generate all
          </button>
        </footer>
      </div>
    </div>
  );
};

export default MigrationDeliveryGenerateAllDialog;
