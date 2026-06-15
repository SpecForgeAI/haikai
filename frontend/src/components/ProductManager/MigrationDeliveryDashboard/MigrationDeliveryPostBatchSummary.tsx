/**
 * MigrationDeliveryPostBatchSummary
 *
 * Spec: 2026-05-20 Cross-Story Context Injection -- Task Group 7.5
 *
 * Renders the post-batch summary block shown to the user immediately after
 * a Generate-all batch completes. Surfaces:
 *   - Actual tokens + wall-clock time per pass (read from each row's
 *     `budget_meta_json` and the handler-side timing fields).
 *   - Count of rows where pass 2 emitted `no_meaningful_change = true`.
 *   - Count of `contradicts_sibling` warnings across all rows.
 *
 * Aggregation runs over a SpecGenerationRow-shaped list (the dashboard
 * passes the union of pass-1 + pass-2 results from the most recent batch).
 * Aggregation helpers are exported for direct unit-test exercise.
 */

import React, { useMemo } from 'react';
import type { SpecGenerationRow } from '../../../api/specGenerationApi';
import styles from './MigrationDeliveryDashboard.module.css';

export interface PostBatchTokenAggregate {
  pass1UsedTokens: number;
  pass2UsedTokens: number;
  pass1MaxTokens: number;
  pass2MaxTokens: number;
}

export interface PostBatchCrossStoryAggregate {
  noMeaningfulChangeCount: number;
  contradictsSiblingCount: number;
}

// ----------------------------------------------------------------------------
// Aggregation helpers
// ----------------------------------------------------------------------------

function readUsedTokens(meta: Record<string, unknown> | null | undefined): number {
  if (!meta) return 0;
  const v = (meta as Record<string, unknown>).used_tokens;
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function readMaxTokens(meta: Record<string, unknown> | null | undefined): number {
  if (!meta) return 0;
  const v = (meta as Record<string, unknown>).max_tokens;
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/**
 * Aggregate per-pass token totals across a batch's row list. Exported for
 * direct unit-test exercise.
 */
export function aggregatePassTokenTotals(
  rows: ReadonlyArray<SpecGenerationRow>,
): PostBatchTokenAggregate {
  const acc: PostBatchTokenAggregate = {
    pass1UsedTokens: 0,
    pass2UsedTokens: 0,
    pass1MaxTokens: 0,
    pass2MaxTokens: 0,
  };
  for (const r of rows) {
    const meta = r.budgetMetaJson;
    if (r.generationPass === 2) {
      acc.pass2UsedTokens += readUsedTokens(meta);
      acc.pass2MaxTokens += readMaxTokens(meta);
    } else {
      // Default to pass-1 bucket for null / 1 / legacy rows.
      acc.pass1UsedTokens += readUsedTokens(meta);
      acc.pass1MaxTokens += readMaxTokens(meta);
    }
  }
  return acc;
}

/**
 * Count cross-story signals across a batch's row list. Exported for
 * direct unit-test exercise.
 */
export function aggregateCrossStorySignals(
  rows: ReadonlyArray<SpecGenerationRow>,
): PostBatchCrossStoryAggregate {
  let noMeaningfulChangeCount = 0;
  let contradictsSiblingCount = 0;
  for (const r of rows) {
    if (r.generationPass === 2 && r.noMeaningfulChange === true) {
      noMeaningfulChangeCount++;
    }
    for (const w of r.warnings ?? []) {
      if (w && w.kind === 'contradicts_sibling') {
        contradictsSiblingCount++;
      }
    }
  }
  return { noMeaningfulChangeCount, contradictsSiblingCount };
}

// ----------------------------------------------------------------------------
// Component
// ----------------------------------------------------------------------------

export interface MigrationDeliveryPostBatchSummaryProps {
  rows: ReadonlyArray<SpecGenerationRow>;
  /** Optional wall-clock per-pass seconds supplied by the handler timing. */
  pass1WallClockSeconds?: number;
  pass2WallClockSeconds?: number;
}

export const MigrationDeliveryPostBatchSummary: React.FC<
  MigrationDeliveryPostBatchSummaryProps
> = ({ rows, pass1WallClockSeconds, pass2WallClockSeconds }) => {
  const tokens = useMemo(() => aggregatePassTokenTotals(rows), [rows]);
  const signals = useMemo(() => aggregateCrossStorySignals(rows), [rows]);
  const ranPass2 = rows.some((r) => r.generationPass === 2);

  return (
    <section
      className={styles.postBatchSummarySection}
      data-testid="mdd-post-batch-summary"
    >
      <h2 className={styles.sectionTitle}>Post-batch summary</h2>
      <div
        className={styles.postBatchSummaryRow}
        data-testid="mdd-post-batch-summary-tokens"
      >
        <div className={styles.summaryCard}>
          <h3 className={styles.summaryCardTitle}>Pass 1 tokens</h3>
          <div
            className={styles.summaryCardValue}
            data-testid="mdd-post-batch-summary-pass1-tokens"
          >
            {tokens.pass1UsedTokens.toLocaleString()}
          </div>
          {pass1WallClockSeconds != null && (
            <div
              className={styles.summaryCardBreakdown}
              data-testid="mdd-post-batch-summary-pass1-wallclock"
            >
              {pass1WallClockSeconds.toFixed(1)}s wall-clock
            </div>
          )}
        </div>
        {ranPass2 && (
          <div className={styles.summaryCard}>
            <h3 className={styles.summaryCardTitle}>Pass 2 tokens</h3>
            <div
              className={styles.summaryCardValue}
              data-testid="mdd-post-batch-summary-pass2-tokens"
            >
              {tokens.pass2UsedTokens.toLocaleString()}
            </div>
            {pass2WallClockSeconds != null && (
              <div
                className={styles.summaryCardBreakdown}
                data-testid="mdd-post-batch-summary-pass2-wallclock"
              >
                {pass2WallClockSeconds.toFixed(1)}s wall-clock
              </div>
            )}
          </div>
        )}
        <div className={styles.summaryCard}>
          <h3 className={styles.summaryCardTitle}>No meaningful change</h3>
          <div
            className={styles.summaryCardValue}
            data-testid="mdd-post-batch-summary-no-meaningful-change-count"
          >
            {signals.noMeaningfulChangeCount}
          </div>
        </div>
        <div className={styles.summaryCard}>
          <h3 className={styles.summaryCardTitle}>Contradicts sibling</h3>
          <div
            className={styles.summaryCardValue}
            data-testid="mdd-post-batch-summary-contradicts-sibling-count"
          >
            {signals.contradictsSiblingCount}
          </div>
        </div>
      </div>
    </section>
  );
};

export default MigrationDeliveryPostBatchSummary;
