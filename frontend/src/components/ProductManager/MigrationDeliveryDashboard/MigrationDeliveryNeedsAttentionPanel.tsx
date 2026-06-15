/**
 * MigrationDeliveryNeedsAttentionPanel
 *
 * Spec: 2026-05-19 Migration Delivery Progress and Evidence Tracking
 * Task Group 10 -- Needs-attention panel + filters + Addition A buttons.
 *
 * Spec references: Addition A, Q-4, Q-7; AC 10, AC 11, AC 12, AC 13.
 *
 * Responsibilities (mapped to spec.md tests 25-30 and tasks 10.0-10.8):
 *   - Renders rows from `dashboard.needsAttention[]` in the priority order
 *     AMS already encoded (failed > insufficient_context > blocked >
 *     not_saved_to_backlog > generated_with_warnings; spec.md AC 7).
 *   - Hosts the two scoping filters (workstream + type) via
 *     `MigrationDeliveryNeedsAttentionFilters`.
 *   - Renders inline `missingInputs[]` for `type='insufficient_context'`
 *     rows (Addition C, spec.md AC 8 / test 26).
 *   - Hosts the two Addition A bulk-regenerate buttons:
 *       * "Regenerate all failed specs"
 *       * "Regenerate all insufficient-context specs"
 *     Both buttons honour ONLY the panel's own filters (Q-4), are disabled
 *     when zero matching rows are present after the filter (test 27), and
 *     call `specGenerationApi.startBatchGeneration` with
 *     `{ regenerateAll: true, targetWorkItemIds: <filteredIds> }`
 *     (spec.md AC 10, test 29). An in-flight banner matches the
 *     `BatchGenerationControls.tsx` UX while the call is in flight.
 *   - On batch completion, invokes the parent's `onBatchComplete` callback
 *     so the dashboard performs a full re-fetch (spec.md AC 13, Q-7,
 *     test 30) -- no optimistic UI, no row patching.
 *   - Optional `onRowClick` hook so a parent drawer host can open the
 *     story detail drawer when a row is clicked.
 *
 * Wire-shape note: input DTOs are mapped to camelCase at the API client
 * boundary (`migrationDeliveryDashboardApi.ts`, follow-up #10) so this
 * component reads idiomatic camelCase fields throughout.
 */

import React, { useCallback, useMemo, useState } from 'react';
import type {
  MigrationDeliveryNeedsAttentionItemDto,
  MigrationDeliveryWorkstreamSummaryDto,
} from '../../../api/migrationDeliveryDashboardApi';
import { startBatchGeneration } from '../../../api/specGenerationApi';
import type { BatchGenerationResult } from '../../../api/specGenerationApi';
import { repairOrphanItem } from '../../../api/migrationDeliveryDashboardApi';
import {
  applyNeedsAttentionFilters,
  EMPTY_NEEDS_ATTENTION_FILTER_STATE,
  MigrationDeliveryNeedsAttentionFilters,
  type NeedsAttentionFilterState,
} from './MigrationDeliveryNeedsAttentionFilters';
import styles from './MigrationDeliveryDashboard.module.css';

// ============================================================================
// Props
// ============================================================================

export interface MigrationDeliveryNeedsAttentionPanelProps {
  projectId: string;
  bookOfWorkId: string;
  /** Pre-ordered list of needs-attention items (AMS already sorted). */
  needsAttention: ReadonlyArray<MigrationDeliveryNeedsAttentionItemDto>;
  /** Workstream summaries used to populate the workstream filter dropdown. */
  workstreamSummaries: ReadonlyArray<MigrationDeliveryWorkstreamSummaryDto>;
  /**
   * Invoked after a successful bulk-regenerate. The parent (`MigrationDeliveryDashboard`)
   * triggers a full `getMigrationDeliveryDashboard` re-fetch in response;
   * the panel itself NEVER patches rows in place (Q-7, AC 13).
   */
  onBatchComplete: () => void;
  /**
   * Optional click handler for opening the story-detail drawer. The panel
   * forwards the clicked row up; the dashboard owns drawer-open state.
   */
  onRowClick?: (row: MigrationDeliveryNeedsAttentionItemDto) => void;
}

// ============================================================================
// Type-label helper -- matches the .needsAttentionTypeXxx CSS classes
// ============================================================================

function typeLabel(t: string): string {
  switch (t) {
    case 'failed':
      return 'Failed';
    case 'insufficient_context':
      return 'Insufficient context';
    case 'blocked':
      return 'Blocked';
    case 'not_saved_to_backlog':
      return 'Not saved to backlog';
    case 'generated_with_warnings':
      return 'Generated with warnings';
    default:
      return t;
  }
}

function typeBadgeClass(t: string): string {
  switch (t) {
    case 'failed':
      return styles.needsAttentionType;
    case 'insufficient_context':
      return `${styles.needsAttentionType} ${styles.needsAttentionTypeInsufficient}`;
    case 'blocked':
      return `${styles.needsAttentionType} ${styles.needsAttentionTypeBlocked}`;
    case 'not_saved_to_backlog':
      return `${styles.needsAttentionType} ${styles.needsAttentionTypeNotSaved}`;
    case 'generated_with_warnings':
      return `${styles.needsAttentionType} ${styles.needsAttentionTypeWarnings}`;
    default:
      return styles.needsAttentionType;
  }
}

// ============================================================================
// Component
// ============================================================================

export const MigrationDeliveryNeedsAttentionPanel: React.FC<
  MigrationDeliveryNeedsAttentionPanelProps
> = ({
  projectId,
  bookOfWorkId,
  needsAttention,
  workstreamSummaries,
  onBatchComplete,
  onRowClick,
}) => {
  const [filters, setFilters] = useState<NeedsAttentionFilterState>(
    EMPTY_NEEDS_ATTENTION_FILTER_STATE,
  );
  const [bulkInFlight, setBulkInFlight] = useState<
    'failed' | 'insufficient_context' | null
  >(null);
  // Follow-up #2: per-row orphan repair tracks the bookItemId currently
  // in-flight so other repair buttons stay enabled.
  const [repairInFlight, setRepairInFlight] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Follow-up #2: orphan repair handler. Calls the AMS-backed repair endpoint
  // and asks the parent dashboard to re-fetch on success so the panel + tree
  // pick up the row's transition from "not_saved_to_backlog" to "saved".
  const handleRepairOrphan = useCallback(
    async (row: MigrationDeliveryNeedsAttentionItemDto) => {
      setActionError(null);
      setRepairInFlight(row.bookItemId);
      try {
        await repairOrphanItem(projectId, bookOfWorkId, row.bookItemId);
        onBatchComplete();
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Repair failed';
        setActionError(`Repair failed for "${row.title}": ${message}`);
      } finally {
        setRepairInFlight(null);
      }
    },
    [projectId, bookOfWorkId, onBatchComplete],
  );

  // Visible rows after filters (used both for rendering and for computing
  // the target id whitelist on the bulk-regenerate buttons -- Q-4).
  const filteredRows = useMemo(
    () => applyNeedsAttentionFilters(needsAttention, filters),
    [needsAttention, filters],
  );

  // Bulk-regenerate target id sets are sub-slices of `filteredRows`. Both
  // the "failed" and "insufficient-context" buttons honour the SAME
  // filtered set; they then narrow to their own type. This means selecting
  // a workstream filter narrows BOTH buttons' target sets (intended -- the
  // panel-level filter is the only scoping mechanism, per Q-4).
  const failedTargetIds = useMemo(
    () =>
      filteredRows
        .filter((r) => r.type === 'failed' && r.workItemId)
        .map((r) => r.workItemId as string),
    [filteredRows],
  );
  const insufficientTargetIds = useMemo(
    () =>
      filteredRows
        .filter(
          (r) => r.type === 'insufficient_context' && r.workItemId,
        )
        .map((r) => r.workItemId as string),
    [filteredRows],
  );

  const failedDisabled = bulkInFlight !== null || failedTargetIds.length === 0;
  const insufficientDisabled =
    bulkInFlight !== null || insufficientTargetIds.length === 0;

  const runBulkRegenerate = useCallback(
    async (
      mode: 'failed' | 'insufficient_context',
      targetWorkItemIds: string[],
    ) => {
      if (targetWorkItemIds.length === 0) return;
      setBulkInFlight(mode);
      setActionError(null);
      try {
        const result: BatchGenerationResult = await startBatchGeneration({
          projectId,
          bookOfWorkId,
          regenerateAll: true,
          targetWorkItemIds,
        });
        // Spec.md Q-7 / AC 13: no optimistic UI; on completion we fire the
        // parent's re-fetch hook. Result is intentionally ignored beyond
        // signalling completion (the dashboard's next GET will reflect the
        // new persisted rows).
        void result;
        onBatchComplete();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Bulk regenerate failed';
        setActionError(message);
      } finally {
        setBulkInFlight(null);
      }
    },
    [projectId, bookOfWorkId, onBatchComplete],
  );

  return (
    <section
      className={styles.needsAttentionSection}
      data-testid="mdd-needs-attention-panel"
      aria-label="Needs attention"
    >
      <div className={styles.needsAttentionHeader}>
        <h2 className={styles.sectionTitle}>Needs attention</h2>
        <div className={styles.needsAttentionActions}>
          <button
            type="button"
            className={styles.bulkButton}
            data-testid="mdd-needs-attention-bulk-regen-failed"
            disabled={failedDisabled}
            onClick={() => runBulkRegenerate('failed', failedTargetIds)}
          >
            Regenerate all failed specs
            {failedTargetIds.length > 0 ? ` (${failedTargetIds.length})` : ''}
          </button>
          <button
            type="button"
            className={styles.bulkButton}
            data-testid="mdd-needs-attention-bulk-regen-insufficient"
            disabled={insufficientDisabled}
            onClick={() =>
              runBulkRegenerate('insufficient_context', insufficientTargetIds)
            }
          >
            Regenerate all insufficient-context specs
            {insufficientTargetIds.length > 0
              ? ` (${insufficientTargetIds.length})`
              : ''}
          </button>
        </div>
      </div>

      <MigrationDeliveryNeedsAttentionFilters
        workstreamSummaries={workstreamSummaries}
        value={filters}
        onChange={setFilters}
      />

      {bulkInFlight && (
        <div
          className={styles.bulkInFlightBanner}
          role="status"
          data-testid="mdd-needs-attention-bulk-in-flight-banner"
        >
          <span aria-hidden="true">...</span>
          <span>Bulk regenerate in progress</span>
        </div>
      )}

      {actionError && (
        <div
          className={styles.errorBanner}
          role="alert"
          data-testid="mdd-needs-attention-bulk-error"
        >
          {actionError}
        </div>
      )}

      {filteredRows.length === 0 ? (
        <div
          className={styles.emptyPanel}
          data-testid="mdd-needs-attention-empty"
        >
          {needsAttention.length === 0
            ? 'No items currently need attention.'
            : 'No items match the current filters.'}
        </div>
      ) : (
        <div
          className={styles.needsAttentionList}
          data-testid="mdd-needs-attention-list"
        >
          {filteredRows.map((row) => {
            const rowKey = row.bookItemId;
            const missing = row.missingInputs ?? [];
            const isInsufficient = row.type === 'insufficient_context';
            return (
              <div
                key={rowKey}
                className={styles.needsAttentionRow}
                role="button"
                tabIndex={0}
                data-testid={`mdd-needs-attention-row-${rowKey}`}
                onClick={() => onRowClick?.(row)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    onRowClick?.(row);
                  }
                }}
              >
                <div className={styles.needsAttentionRowHeader}>
                  <span
                    className={typeBadgeClass(row.type)}
                    data-testid={`mdd-needs-attention-row-${rowKey}-type`}
                  >
                    {typeLabel(row.type)}
                  </span>
                  <span
                    className={styles.needsAttentionTitle}
                    data-testid={`mdd-needs-attention-row-${rowKey}-title`}
                  >
                    {row.title}
                  </span>
                  {row.workstream && (
                    <span
                      className={styles.needsAttentionWorkstream}
                      data-testid={`mdd-needs-attention-row-${rowKey}-workstream`}
                    >
                      {row.workstream}
                    </span>
                  )}
                </div>
                {row.reason && (
                  <p
                    className={styles.needsAttentionReason}
                    data-testid={`mdd-needs-attention-row-${rowKey}-reason`}
                  >
                    {row.reason}
                  </p>
                )}
                {isInsufficient && missing.length > 0 && (
                  <div
                    className={styles.needsAttentionMissingInputsInline}
                    data-testid={`mdd-needs-attention-row-${rowKey}-missing-inputs`}
                  >
                    {missing.map((m, idx) => (
                      <div
                        key={idx}
                        className={styles.needsAttentionMissingInputEntry}
                        data-testid={`mdd-needs-attention-row-${rowKey}-missing-inputs-entry-${idx}`}
                      >
                        <span
                          className={styles.needsAttentionMissingInputKind}
                        >
                          {m.kind}
                        </span>
                        <span>
                          {m.id ? `${m.id} -- ` : ''}
                          {m.reason}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {/*
                  Follow-up #2 orphan repair. Show ONLY when the row is
                  not_saved_to_backlog AND has a stored workItemId (the
                  orphan signal -- a never-saved item has workItemId=null).
                */}
                {row.type === 'not_saved_to_backlog' && row.workItemId && (
                  <button
                    type="button"
                    className={styles.needsAttentionRowAction}
                    data-testid={`mdd-needs-attention-row-${rowKey}-repair-orphan`}
                    disabled={repairInFlight !== null}
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleRepairOrphan(row);
                    }}
                  >
                    {repairInFlight === rowKey
                      ? 'Repairing...'
                      : 'Repair orphan'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};

export default MigrationDeliveryNeedsAttentionPanel;
