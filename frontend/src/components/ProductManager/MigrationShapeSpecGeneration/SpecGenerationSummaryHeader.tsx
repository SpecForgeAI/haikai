/**
 * SpecGenerationSummaryHeader
 *
 * Spec: 2026-05-19 PM Migration Shape-Spec Batch Generation
 * Task Group 9 (Frontend Layer - workspace summary surface).
 *
 * Pure presentational component that renders the per-book summary surface
 * for the spec-generation workspace:
 *
 *   - Saved-story totals (saved stories, attempted, remaining)
 *   - Per-status counts (generated / generated_with_warnings /
 *     insufficient_context / failed / skipped_blocked / not_attempted)
 *   - Current batch size (`nextBatchSize`)
 *   - Next batch range (`nextBatchStart` .. `nextBatchStart + nextBatchSize - 1`)
 *   - Optional predicted-vs-actual metric (R-10)
 *
 * The predicted-vs-actual metric is stubbed when the AMS summary endpoint
 * does not yet expose predicted-readiness counts -- the surface prints
 * "n/a" rather than fabricating a value (per the Task Group 9.4 brief).
 *
 * Spec 1's `MigrationDeliveryPlanProgressSummary` is the visual precedent;
 * styling primitives match. No new design tokens are introduced.
 */

import React from 'react';
import type {
  SpecGenerationSummaryDto,
  SpecGenerationRow,
} from '../../../api/specGenerationApi';
import styles from './MigrationShapeSpecGeneration.module.css';

// ============================================================================
// Predicted-vs-actual helper
// ============================================================================

/**
 * Compute a small "X of Y predicted-ready actually generated" string from
 * the rows we already have on the client. This is the optional R-10 metric
 * the summary surface emits when row-level predictedReadiness is available;
 * if every row has a null `predictedReadiness`, the helper returns null so
 * the surface can fall back to "n/a".
 *
 * Predicted-ready definition: row's `predictedReadiness` is `ready_for_spec`.
 * Actually-generated definition: row's `status` is `generated` or
 * `generated_with_warnings`.
 */
export function computePredictedVsActual(
  rows: ReadonlyArray<SpecGenerationRow> | null | undefined,
): { actualGenerated: number; totalPredictedReady: number } | null {
  if (!rows || rows.length === 0) return null;
  let anyPredictionSeen = false;
  let totalPredictedReady = 0;
  let actualGenerated = 0;
  for (const row of rows) {
    if (row.predictedReadiness != null) {
      anyPredictionSeen = true;
    }
    if (row.predictedReadiness === 'ready_for_spec') {
      totalPredictedReady += 1;
      if (
        row.status === 'generated' ||
        row.status === 'generated_with_warnings'
      ) {
        actualGenerated += 1;
      }
    }
  }
  if (!anyPredictionSeen) return null;
  return { actualGenerated, totalPredictedReady };
}

// ============================================================================
// Component
// ============================================================================

export interface SpecGenerationSummaryHeaderProps {
  summary: SpecGenerationSummaryDto;
  /**
   * Optional row list used to compute the predicted-vs-actual metric (R-10).
   * When the rows do not yet include predictedReadiness, the surface prints
   * "n/a" rather than fabricating a metric (per the Task Group 9.4 brief).
   */
  rows?: ReadonlyArray<SpecGenerationRow>;
}

export function SpecGenerationSummaryHeader({
  summary,
  rows,
}: SpecGenerationSummaryHeaderProps) {
  const totalSaved = summary.savedStoryCount;
  const attempted = summary.attemptedCount;
  const remaining = summary.notAttemptedCount;
  const generated = summary.generatedCount;
  const generatedWithWarnings = summary.generatedWithWarningsCount;
  const insufficient = summary.insufficientContextCount;
  const failed = summary.failedCount;
  const skippedBlocked = summary.skippedBlockedCount;

  const batchSize = summary.nextBatchSize;
  const nextStart = summary.nextBatchStart;
  // Display next batch range as inclusive 1-based numbering for users.
  const nextRangeEnd = Math.max(nextStart, nextStart + batchSize - 1);
  const hasNextBatch = batchSize > 0 && remaining > 0;

  const predictedVsActual = computePredictedVsActual(rows);

  return (
    <section
      className={styles.summaryCard}
      data-testid="msg-summary-header"
      aria-labelledby="msg-summary-title"
    >
      <div>
        <h2
          className={styles.tableTitle}
          id="msg-summary-title"
          data-testid="msg-summary-title"
        >
          Spec generation summary
        </h2>
      </div>

      <div className={styles.section} data-testid="msg-summary-counts">
        <h3 className={styles.sectionTitle}>Saved stories</h3>
        <div className={styles.counts}>
          <span className={styles.countBadge}>
            <strong data-testid="msg-summary-count-saved-stories">
              {totalSaved}
            </strong>
            Saved stories
          </span>
          <span className={styles.countBadge}>
            <strong data-testid="msg-summary-count-attempted">{attempted}</strong>
            Attempted
          </span>
          <span className={styles.countBadge}>
            <strong data-testid="msg-summary-count-remaining">{remaining}</strong>
            Remaining
          </span>
        </div>
      </div>

      <div className={styles.section} data-testid="msg-summary-by-status">
        <h3 className={styles.sectionTitle}>By status</h3>
        <div className={styles.breakdownRow}>
          <span
            className={`${styles.breakdownChip} ${styles.statusGenerated}`}
            data-testid="msg-summary-status-generated"
          >
            Generated: {generated}
          </span>
          <span
            className={`${styles.breakdownChip} ${styles.statusGeneratedWithWarnings}`}
            data-testid="msg-summary-status-generated_with_warnings"
          >
            Generated with warnings: {generatedWithWarnings}
          </span>
          <span
            className={`${styles.breakdownChip} ${styles.statusInsufficientContext}`}
            data-testid="msg-summary-status-insufficient_context"
          >
            Insufficient context: {insufficient}
          </span>
          <span
            className={`${styles.breakdownChip} ${styles.statusFailed}`}
            data-testid="msg-summary-status-failed"
          >
            Failed: {failed}
          </span>
          <span
            className={`${styles.breakdownChip} ${styles.statusSkippedBlocked}`}
            data-testid="msg-summary-status-skipped_blocked"
          >
            Skipped (blocked): {skippedBlocked}
          </span>
        </div>
      </div>

      <div className={styles.section} data-testid="msg-summary-next-batch">
        <h3 className={styles.sectionTitle}>Next batch</h3>
        <div className={styles.breakdownRow}>
          <span
            className={styles.breakdownChip}
            data-testid="msg-summary-batch-size"
          >
            Current batch size: {batchSize}
          </span>
          <span
            className={styles.breakdownChip}
            data-testid="msg-summary-next-range"
          >
            Next batch range:{' '}
            {hasNextBatch ? `${nextStart}-${nextRangeEnd}` : 'no remaining stories'}
          </span>
        </div>
      </div>

      <div
        className={styles.section}
        data-testid="msg-summary-predicted-vs-actual"
      >
        <h3 className={styles.sectionTitle}>
          Predicted readiness vs actual generation
        </h3>
        <div className={styles.breakdownRow}>
          <span
            className={styles.breakdownChip}
            data-testid="msg-summary-predicted-vs-actual-value"
          >
            {predictedVsActual === null
              ? 'n/a (predicted readiness not available yet)'
              : `${predictedVsActual.actualGenerated} of ${predictedVsActual.totalPredictedReady} predicted-ready stories actually generated`}
          </span>
        </div>
      </div>
    </section>
  );
}

export default SpecGenerationSummaryHeader;
