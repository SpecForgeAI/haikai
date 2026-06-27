/**
 * BatchResultsTable
 *
 * Spec: 2026-05-19 PM Migration Shape-Spec Batch Generation
 * Task Group 10 - Batch Results Table.
 * Task Group 11 - row click opens the story result drawer.
 *
 * Renders one row per saved-story WorkItem with predicted readiness, actual
 * status, and confidence in side-by-side columns (R-10). Failed rows
 * expose a retry control that triggers a single-story regenerate via the
 * gateway.
 *
 * Columns (per spec.md "Frontend - spec generation workspace"):
 *   - Story title
 *   - Parent feature / epic
 *   - Predicted readiness  (Spec 1 prediction snapshot)
 *   - Actual status        (this spec's generation outcome)
 *   - Confidence
 *   - Warnings count
 *   - Missing-inputs count
 *   - Generated-spec link  (opens the drawer)
 *   - Recommended next action
 *
 * Clicking anywhere on a row opens the story result drawer (Task 11). The
 * "Open spec" link and the failed-row "Retry" button stop propagation so a
 * focused click on those controls does not also open the drawer.
 */

import React from 'react';
import type {
  SpecGenerationRow,
  SpecGenerationPredictedReadiness,
  SpecGenerationStatus,
  SpecGenerationConfidence,
} from '../../../api/specGenerationApi';
import styles from './MigrationShapeSpecGeneration.module.css';

// ============================================================================
// Helpers
// ============================================================================

function readinessLabel(
  r: SpecGenerationPredictedReadiness | null | undefined,
): string {
  switch (r) {
    case 'ready_for_spec':
      return 'Ready for spec';
    case 'needs_focused_context':
      return 'Needs focused context';
    case 'needs_user_decision':
      return 'Needs user decision';
    case 'blocked':
      return 'Blocked';
    default:
      return 'Unknown';
  }
}

function statusLabel(s: SpecGenerationStatus): string {
  switch (s) {
    case 'not_attempted':
      return 'Not attempted';
    case 'generated':
      return 'Generated';
    case 'generated_with_warnings':
      return 'Generated with warnings';
    case 'insufficient_context':
      return 'Insufficient context';
    case 'failed':
      return 'Failed';
    case 'skipped_blocked':
      return 'Skipped (blocked)';
    default:
      return s;
  }
}

function statusChipClass(s: SpecGenerationStatus): string {
  switch (s) {
    case 'generated':
      return styles.statusGenerated;
    case 'generated_with_warnings':
      return styles.statusGeneratedWithWarnings;
    case 'insufficient_context':
      return styles.statusInsufficientContext;
    case 'failed':
      return styles.statusFailed;
    case 'skipped_blocked':
      return styles.statusSkippedBlocked;
    case 'not_attempted':
    default:
      return styles.statusNotAttempted;
  }
}

function confidenceLabel(c: SpecGenerationConfidence | null): string {
  if (!c) return '-';
  switch (c) {
    case 'high':
      return 'High';
    case 'medium':
      return 'Medium';
    case 'low':
      return 'Low';
  }
}

function confidenceChipClass(c: SpecGenerationConfidence | null): string {
  switch (c) {
    case 'high':
      return styles.confidenceHigh;
    case 'medium':
      return styles.confidenceMedium;
    case 'low':
      return styles.confidenceLow;
    default:
      return styles.statusNotAttempted;
  }
}

function readinessChipClass(
  r: SpecGenerationPredictedReadiness | null | undefined,
): string {
  switch (r) {
    case 'ready_for_spec':
      return styles.readinessReady;
    case 'needs_focused_context':
      return styles.readinessFocused;
    case 'needs_user_decision':
      return styles.readinessDecision;
    case 'blocked':
      return styles.readinessBlocked;
    default:
      return styles.statusNotAttempted;
  }
}

// ============================================================================
// Component
// ============================================================================

export interface BatchResultsTableProps {
  rows: ReadonlyArray<SpecGenerationRow>;
  batchInProgress: boolean;
  /**
   * Invoked when the user clicks the retry control on a failed row. The
   * parent wires this to the gateway single-story regenerate endpoint.
   */
  onRetryStory: (workItemId: string) => void;
  /**
   * Invoked when the user clicks anywhere on a row (or on the explicit
   * "Open spec" link). Task Group 11 wires this to open the story-result
   * drawer.
   */
  onOpenStory?: (row: SpecGenerationRow) => void;
  /**
   * Selective generation: when provided, a leading checkbox column lets the
   * user pick a subset of saved stories (by `workItemId`) to generate. Only
   * rows that carry a `workItemId` are selectable. Omit both props to render
   * the table without any selection affordance (unchanged behaviour).
   */
  selectedWorkItemIds?: ReadonlySet<string>;
  onToggleSelect?: (workItemId: string) => void;
  /** Toggles selection of every selectable row currently shown. */
  onToggleSelectAll?: () => void;
}

export function BatchResultsTable({
  rows,
  batchInProgress,
  onRetryStory,
  onOpenStory,
  selectedWorkItemIds,
  onToggleSelect,
  onToggleSelectAll,
}: BatchResultsTableProps) {
  const selectable = !!onToggleSelect;
  const selectableRows = rows.filter((r) => !!r.workItemId);
  const allSelected =
    selectableRows.length > 0 &&
    selectableRows.every((r) => selectedWorkItemIds?.has(r.workItemId as string));
  return (
    <div
      className={styles.tableShell}
      data-testid="msg-batch-results-table"
    >
      <div className={styles.tableHeader}>
        <h3 className={styles.tableTitle}>Batch results</h3>
        <span className={styles.tableSubtitle}>
          {rows.length} {rows.length === 1 ? 'story' : 'stories'} attempted
          {batchInProgress ? ' (new results stream in as the batch progresses)' : ''}
        </span>
      </div>

      {rows.length === 0 ? (
        <div className={styles.emptyState} data-testid="msg-batch-results-empty">
          No stories attempted yet. Click "Generate specs for all stories" or
          "Generate next" to start a batch.
        </div>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              {selectable && (
                <th data-testid="msg-results-col-select">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={() => onToggleSelectAll?.()}
                    disabled={batchInProgress || selectableRows.length === 0}
                    aria-label="Select all stories shown"
                    data-testid="msg-results-select-all"
                  />
                </th>
              )}
              <th>Story</th>
              <th>Parent feature / epic</th>
              <th data-testid="msg-results-col-predicted">Predicted readiness</th>
              <th data-testid="msg-results-col-actual">Actual status</th>
              <th data-testid="msg-results-col-confidence">Confidence</th>
              <th>Warnings</th>
              <th>Missing inputs</th>
              <th>Generated spec</th>
              <th>Recommended next action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const rowKey =
                row.workItemId ?? row.id ?? `${row.bookItemId ?? 'row'}`;
              const rowClickable = !!onOpenStory;
              const handleRowClick = () => {
                if (onOpenStory) onOpenStory(row);
              };
              return (
                <tr
                  key={rowKey}
                  data-testid={`msg-results-row-${rowKey}`}
                  className={rowClickable ? styles.clickableRow : undefined}
                  onClick={rowClickable ? handleRowClick : undefined}
                  // Keyboard accessibility - row is interactive when there is
                  // a click handler.
                  tabIndex={rowClickable ? 0 : undefined}
                  onKeyDown={
                    rowClickable
                      ? (e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            handleRowClick();
                          }
                        }
                      : undefined
                  }
                  role={rowClickable ? 'button' : undefined}
                  aria-label={
                    rowClickable
                      ? `Open story result drawer for ${
                          row.storyTitle ?? row.workItemId ?? 'this row'
                        }`
                      : undefined
                  }
                >
                  {selectable && (
                    <td
                      onClick={(e) => e.stopPropagation()}
                      data-testid={`msg-results-row-${rowKey}-select-cell`}
                    >
                      {row.workItemId ? (
                        <input
                          type="checkbox"
                          checked={
                            selectedWorkItemIds?.has(row.workItemId) ?? false
                          }
                          onChange={() => onToggleSelect?.(row.workItemId as string)}
                          disabled={batchInProgress}
                          aria-label={`Select ${row.storyTitle ?? 'story'} for generation`}
                          data-testid={`msg-results-row-${rowKey}-select`}
                        />
                      ) : (
                        <span className={styles.subtle}>-</span>
                      )}
                    </td>
                  )}
                  <td>{row.storyTitle ?? row.workItemId ?? '-'}</td>
                  <td>{row.parentTitle ?? '-'}</td>
                  <td>
                    <span
                      className={`${styles.breakdownChip} ${readinessChipClass(
                        row.predictedReadiness,
                      )}`}
                      data-testid={`msg-results-row-${rowKey}-predicted`}
                    >
                      {readinessLabel(row.predictedReadiness)}
                    </span>
                  </td>
                  <td>
                    <span
                      className={`${styles.breakdownChip} ${statusChipClass(
                        row.status,
                      )}`}
                      data-testid={`msg-results-row-${rowKey}-actual`}
                    >
                      {statusLabel(row.status)}
                    </span>
                  </td>
                  <td>
                    <span
                      className={`${styles.breakdownChip} ${confidenceChipClass(
                        row.confidence,
                      )}`}
                      data-testid={`msg-results-row-${rowKey}-confidence`}
                    >
                      {confidenceLabel(row.confidence)}
                    </span>
                  </td>
                  <td data-testid={`msg-results-row-${rowKey}-warnings-count`}>
                    {row.warnings.length}
                  </td>
                  <td
                    data-testid={`msg-results-row-${rowKey}-missing-inputs-count`}
                  >
                    {row.missingInputs.length}
                  </td>
                  <td>
                    {row.generatedSpecText ? (
                      <button
                        type="button"
                        className={styles.linkButton}
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenStory?.(row);
                        }}
                        data-testid={`msg-results-row-${rowKey}-open-spec`}
                      >
                        Open spec
                      </button>
                    ) : (
                      <span className={styles.subtle}>-</span>
                    )}
                  </td>
                  <td>
                    {row.recommendedNextAction ?? row.reason ?? (
                      <span className={styles.subtle}>-</span>
                    )}
                    {row.status === 'failed' && row.workItemId && (
                      <div style={{ marginTop: 4 }}>
                        <button
                          type="button"
                          className={`${styles.button} ${styles.buttonSecondary}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            onRetryStory(row.workItemId as string);
                          }}
                          disabled={batchInProgress}
                          data-testid={`msg-results-row-${rowKey}-retry`}
                        >
                          Retry
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default BatchResultsTable;
