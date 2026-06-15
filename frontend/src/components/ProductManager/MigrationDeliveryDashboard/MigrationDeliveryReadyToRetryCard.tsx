/**
 * MigrationDeliveryReadyToRetryCard
 *
 * Spec: 2026-05-20 Missing Input Resolver Flow -- Task Group 7.2 + 7.3 + 7.4.
 *
 * Adjacent to the stale-specs card, this card surfaces the project-scoped
 * "Ready to retry" count -- the number of `insufficient_context` shape-spec
 * rows whose `missing_input_keys_json` is FULLY covered by active resolutions
 * (per `MissingInputCrossStoryMatcherService.findReadyToRetry`).
 *
 * Three behaviours coexist on a single card body (spec lines 61-63):
 *
 *   1. Primary "Retry all" button: invokes `retryBatch` with every
 *      ready-to-retry `workItemId`. When the gateway responds with
 *      `requiresConfirmation=true` the card opens an inline cost-preview
 *      confirmation modal and re-POSTs with `confirmed=true` on confirm.
 *   2. Secondary "View ready stories" link: forwards the ready-to-retry id
 *      set to the parent dashboard which filters the hierarchy tree.
 *   3. The count itself is clickable too (same payload as the secondary
 *      link) so the user has both affordances per the spec.
 *
 * The card is intentionally presentational about the data fetch: the
 * dashboard owns the fetch via `getReadyToRetry` and passes the response
 * in via props so a single refresh covers both summaries.
 */

import React, { useCallback, useState } from 'react';
import {
  retryBatch as defaultRetryBatch,
  type ReadyToRetryResponse,
  type RetryBatchResult,
  type RetryBatchCostPreview,
} from '../../../api/missingInputResolutionsApi';
import styles from './MigrationDeliveryDashboard.module.css';

// ============================================================================
// Props
// ============================================================================

export interface MigrationDeliveryReadyToRetryCardProps {
  projectId: string;
  bookOfWorkId: string;
  /** Pre-fetched ready-to-retry summary; the dashboard owns the fetch. */
  readyToRetry: ReadyToRetryResponse | null;
  /**
   * Invoked when the user clicks the count or the "View ready stories" link.
   * The dashboard scopes the hierarchy tree to `workItemId IN readyList`.
   * The card forwards the ready work-item ids verbatim.
   */
  onViewReadyStories: (workItemIds: string[]) => void;
  /**
   * Invoked after a successful retry-batch (either direct or post-confirm)
   * so the dashboard re-fetches the ready-to-retry count + needs-attention.
   */
  onRetryComplete: (result: RetryBatchResult) => void;
  /** Test seam: override the retry-batch call. */
  retryBatchFn?: typeof defaultRetryBatch;
}

// ============================================================================
// Component
// ============================================================================

export const MigrationDeliveryReadyToRetryCard: React.FC<
  MigrationDeliveryReadyToRetryCardProps
> = ({
  projectId,
  bookOfWorkId,
  readyToRetry,
  onViewReadyStories,
  onRetryComplete,
  retryBatchFn = defaultRetryBatch,
}) => {
  const [inFlight, setInFlight] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [costPreview, setCostPreview] = useState<RetryBatchCostPreview | null>(
    null,
  );
  const [thresholdLabel, setThresholdLabel] = useState<string | null>(null);

  const count = readyToRetry?.count ?? 0;
  const readyIds = readyToRetry?.specs.map((s) => s.workItemId) ?? [];

  // --------------------------------------------------------------------------
  // Retry handlers
  // --------------------------------------------------------------------------

  const fireRetry = useCallback(
    async (confirmed: boolean) => {
      if (readyIds.length === 0) return;
      setActionError(null);
      setInFlight(true);
      try {
        const result = await retryBatchFn(projectId, {
          workItemIds: readyIds,
          bookOfWorkId,
          confirmed,
        });
        if (result.requiresConfirmation) {
          // Gateway threshold gate fired -- park the preview and let the user
          // confirm. The follow-up POST with confirmed=true will land here
          // again, this time without `requiresConfirmation`.
          setCostPreview(result.costPreview ?? null);
          setThresholdLabel(result.threshold ?? null);
        } else {
          setCostPreview(null);
          setThresholdLabel(null);
          onRetryComplete(result);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Retry batch failed';
        setActionError(msg);
      } finally {
        setInFlight(false);
      }
    },
    [projectId, bookOfWorkId, readyIds, retryBatchFn, onRetryComplete],
  );

  const handleRetryAll = useCallback(() => {
    void fireRetry(false);
  }, [fireRetry]);

  const handleConfirmRetry = useCallback(() => {
    void fireRetry(true);
  }, [fireRetry]);

  const handleCancelPreview = useCallback(() => {
    setCostPreview(null);
    setThresholdLabel(null);
  }, []);

  // --------------------------------------------------------------------------
  // Render
  // --------------------------------------------------------------------------

  return (
    <section
      className={styles.staleSpecsSection}
      data-testid="mdd-ready-to-retry-section"
      aria-label="Ready to retry"
    >
      <div
        className={styles.summaryCard}
        data-testid="mdd-summary-card-ready-to-retry"
      >
        <h3 className={styles.summaryCardTitle}>Ready to retry</h3>
        <button
          type="button"
          className={styles.summaryCardValueButton}
          data-testid="mdd-summary-card-ready-to-retry-value"
          onClick={() => onViewReadyStories(readyIds)}
          disabled={count === 0}
          aria-label={`Ready to retry: ${count}`}
        >
          <span className={styles.summaryCardValue}>{count}</span>
        </button>
        <div className={styles.summaryCardBreakdown}>
          <button
            type="button"
            className={styles.bulkButton}
            data-testid="mdd-ready-to-retry-retry-all"
            onClick={handleRetryAll}
            disabled={count === 0 || inFlight}
          >
            {inFlight ? 'Retrying\u2026' : `Retry all (${count})`}
          </button>
          <button
            type="button"
            className={styles.headerNavLink}
            data-testid="mdd-ready-to-retry-view-ready-stories"
            onClick={() => onViewReadyStories(readyIds)}
            disabled={count === 0}
          >
            View ready stories
          </button>
        </div>
        {actionError && (
          <div
            className={styles.errorBanner}
            role="alert"
            data-testid="mdd-ready-to-retry-error"
          >
            {actionError}
          </div>
        )}
      </div>

      {/* --- Cost-preview confirmation modal --- */}
      {costPreview && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Confirm retry cost"
          data-testid="mdd-ready-to-retry-confirm-modal"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 999,
          }}
        >
          <div
            style={{
              background: '#fff',
              padding: 24,
              borderRadius: 8,
              width: 480,
              maxWidth: '90vw',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <h3 style={{ margin: 0 }}>Confirm retry batch</h3>
            <p style={{ margin: 0, fontSize: 13, color: '#455a64' }}>
              Retrying {readyIds.length} {readyIds.length === 1 ? 'story' : 'stories'} will
              consume an estimated:
            </p>
            <ul
              style={{
                margin: 0,
                paddingLeft: 18,
                fontSize: 13,
                color: '#263238',
              }}
              data-testid="mdd-ready-to-retry-cost-preview-list"
            >
              <li>
                Estimated tokens:{' '}
                <strong>{costPreview.estimatedTokens.toLocaleString()}</strong>
              </li>
              <li>
                Estimated wall-clock:{' '}
                <strong>
                  {Math.round(costPreview.estimatedWallClockSeconds)}s
                </strong>
              </li>
              {thresholdLabel && (
                <li>
                  Threshold reason:{' '}
                  <span style={{ color: '#607d8b' }}>{thresholdLabel}</span>
                </li>
              )}
            </ul>
            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: 8,
              }}
            >
              <button
                type="button"
                className={styles.headerNavLink}
                onClick={handleCancelPreview}
                disabled={inFlight}
                data-testid="mdd-ready-to-retry-confirm-cancel"
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.bulkButton}
                onClick={handleConfirmRetry}
                disabled={inFlight}
                data-testid="mdd-ready-to-retry-confirm-ok"
              >
                {inFlight ? 'Retrying\u2026' : 'Confirm retry'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

export default MigrationDeliveryReadyToRetryCard;
