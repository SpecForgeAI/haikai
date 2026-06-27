/**
 * BatchGenerationControls
 *
 * Spec: 2026-05-19 PM Migration Shape-Spec Batch Generation
 * Task Group 10 - Primary Action + Batch Progress + Toggles.
 *
 * Renders the action button row + in-flight banner the Product Manager uses
 * to drive batch generation:
 *
 *   - "Generate specs for all stories" - loops batches until notAttempted=0
 *     (driven by the parent via `onGenerateAll`).
 *   - "Generate next 25" - kicks off a single batch (`onGenerateNextBatch`).
 *   - "Stop after current batch" - sets a parent-managed flag so the
 *     generate-all loop exits after the in-flight batch completes (A-9 —
 *     batches do NOT cancel mid-flight; the next batch is skipped).
 *   - "Regenerate all (including generated)" toggle (R-8) - sets
 *     `regenerateAll=true` on the gateway call.
 *   - "Skip blocked stories" toggle (R-6, default OFF) - sets
 *     `skipBlockedStories=true` on the gateway call.
 *
 * In-flight state (A-9): all action buttons disabled; an in-progress banner
 * shows "Batch in progress (story X of N)". The parent owns the actual
 * batch lifecycle — this component only renders the surface and forwards
 * intent.
 */

import React, { useState } from 'react';
import type { SpecGenerationSummaryDto } from '../../../api/specGenerationApi';
import styles from './MigrationShapeSpecGeneration.module.css';

// ============================================================================
// Component
// ============================================================================

export interface BatchGenerationControlsProps {
  /** Latest summary from AMS. Null while the initial fetch is in flight. */
  summary: SpecGenerationSummaryDto | null;
  /** True while the parent has a batch request in flight. */
  batchInProgress: boolean;
  /**
   * One-based story index inside the currently in-flight batch. Used in
   * the "Batch in progress (story X of N)" banner. Pass 0 to mean
   * "starting" before the first story result arrives.
   */
  currentStoryIndexInBatch: number;
  /** Total stories the in-flight batch is processing (e.g. 25). */
  currentBatchSize: number;
  /** Optional error from the last action; rendered as a banner. */
  actionError?: string | null;
  /** Invoked when the user clicks "Generate next 25". */
  onGenerateNextBatch: (opts: {
    regenerateAll: boolean;
    skipBlockedStories: boolean;
  }) => void;
  /** Invoked when the user clicks "Generate specs for all stories". */
  onGenerateAll: (opts: {
    regenerateAll: boolean;
    skipBlockedStories: boolean;
  }) => void;
  /** Invoked when the user clicks "Stop after current batch". */
  onStopAfterCurrentBatch: () => void;
  /**
   * Selective generation: number of stories the user has ticked in the
   * results table. Drives the "Generate specs for selected (N)" button label +
   * enablement. When 0 (or the callback is absent) the selected-action button
   * is hidden.
   */
  selectedCount?: number;
  /** Invoked when the user clicks "Generate specs for selected". */
  onGenerateSelected?: (opts: {
    regenerateAll: boolean;
    skipBlockedStories: boolean;
  }) => void;
}

export function BatchGenerationControls({
  summary,
  batchInProgress,
  currentStoryIndexInBatch,
  currentBatchSize,
  actionError,
  onGenerateNextBatch,
  onGenerateAll,
  onStopAfterCurrentBatch,
  selectedCount = 0,
  onGenerateSelected,
}: BatchGenerationControlsProps) {
  const [regenerateAll, setRegenerateAll] = useState(false);
  const [skipBlockedStories, setSkipBlockedStories] = useState(false);

  // Disable the primary action if (a) a batch is already in flight, or
  // (b) there are no remaining stories AND regenerate-all is OFF.
  const remaining = summary?.notAttemptedCount ?? 0;
  const noWorkLeft = remaining === 0 && !regenerateAll;
  const disabled = batchInProgress || !summary || noWorkLeft;

  // The "Generate next 25" label adapts to the actual batch size when the
  // summary reports something other than 25 (e.g. the third batch of a
  // 60-story scenario carries 10 stories).
  const nextSize = summary?.nextBatchSize ?? 25;

  // 1-based "story X of N" with a sensible "0" fallback before the first
  // story result lands.
  const displayedStoryIndex =
    currentStoryIndexInBatch > 0 ? currentStoryIndexInBatch : 1;
  const displayedBatchSize = currentBatchSize > 0 ? currentBatchSize : nextSize;

  return (
    <div data-testid="msg-batch-controls">
      <div className={styles.actionRow}>
        <button
          type="button"
          className={`${styles.button} ${styles.buttonPrimary}`}
          onClick={() =>
            onGenerateAll({ regenerateAll, skipBlockedStories })
          }
          disabled={disabled}
          data-testid="msg-action-generate-all"
        >
          Generate specs for all stories
        </button>

        <button
          type="button"
          className={`${styles.button} ${styles.buttonSecondary}`}
          onClick={() =>
            onGenerateNextBatch({ regenerateAll, skipBlockedStories })
          }
          disabled={disabled}
          data-testid="msg-action-generate-next-batch"
        >
          Generate next {nextSize}
        </button>

        {onGenerateSelected && (
          <button
            type="button"
            className={`${styles.button} ${styles.buttonPrimary}`}
            onClick={() =>
              onGenerateSelected({ regenerateAll, skipBlockedStories })
            }
            disabled={batchInProgress || selectedCount === 0}
            data-testid="msg-action-generate-selected"
            title="Generate specs for only the stories ticked in the table below"
          >
            Generate specs for selected ({selectedCount})
          </button>
        )}

        <button
          type="button"
          className={`${styles.button} ${styles.buttonDanger}`}
          onClick={onStopAfterCurrentBatch}
          disabled={!batchInProgress}
          data-testid="msg-action-stop-after-current-batch"
        >
          Stop after current batch
        </button>

        <div className={styles.actionToggles}>
          <label className={styles.toggleLabel}>
            <input
              type="checkbox"
              checked={regenerateAll}
              onChange={(e) => setRegenerateAll(e.target.checked)}
              disabled={batchInProgress}
              data-testid="msg-toggle-regenerate-all"
            />
            Regenerate all (including generated)
          </label>
          <label className={styles.toggleLabel}>
            <input
              type="checkbox"
              checked={skipBlockedStories}
              onChange={(e) => setSkipBlockedStories(e.target.checked)}
              disabled={batchInProgress}
              data-testid="msg-toggle-skip-blocked"
            />
            Skip blocked stories
          </label>
        </div>
      </div>

      {batchInProgress && (
        <div
          className={styles.inFlightBanner}
          role="status"
          data-testid="msg-batch-in-progress-banner"
        >
          <span className={styles.spinner} aria-hidden="true" />
          <span>
            Batch in progress (story {displayedStoryIndex} of{' '}
            {displayedBatchSize})
          </span>
        </div>
      )}

      {actionError && (
        <div
          className={styles.errorBanner}
          role="alert"
          data-testid="msg-batch-action-error"
          style={{ marginTop: 8 }}
        >
          {actionError}
        </div>
      )}
    </div>
  );
}

export default BatchGenerationControls;
