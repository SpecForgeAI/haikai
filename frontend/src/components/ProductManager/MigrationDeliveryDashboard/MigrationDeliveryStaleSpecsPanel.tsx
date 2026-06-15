/**
 * MigrationDeliveryStaleSpecsPanel
 *
 * Spec: 2026-05-20 Target Architecture Authoring Flow -- Task Group 9.
 * Spec: 2026-05-20 Missing Input Resolver Flow -- Task Group 7.7
 *       (chip variants for `target_architecture_changed` vs
 *       `resolution_reset`).
 *
 * Surfaces project-scoped stale shape-specs on the Migration Delivery
 * Dashboard. A spec row goes stale when the active target architecture
 * changes (promote or active-target save) and that change touches the
 * architecture elements the spec was generated against -- see the AMS-side
 * `TargetArchitectureStaleMarkService` pipeline (Task Group 3) for the
 * write-path semantics. A spec row ALSO goes stale when a missing-input
 * resolution that it depends on is soft-deleted -- see the AMS-side
 * `MissingInputResolutionCascadeService` (Missing Input Resolver Flow,
 * Task Group 3) -- and in that case the reason is `resolution_reset`.
 *
 * Responsibilities (mapped to task-group 9.2 / 9.4):
 *
 *   1. Render a compact "Stale specs" summary card carrying the count from
 *      `GET /spec-generations/stale-count` (backed by the AMS-side composite
 *      index `idx_msg_project_stale`). Clicking the card opens an inline
 *      details panel.
 *   2. The details panel lists the stale stories by title (joined from the
 *      dashboard's needs-attention array when available; falls back to
 *      "WorkItem <id>" otherwise so the action is always usable). Each row
 *      also carries a chip indicating WHY it is stale: "target arch changed"
 *      vs "input resolution reset" -- read directly from the per-story
 *      `staleReason` field on the hierarchy-node DTOs (AMS surfaces this on
 *      every dashboard response). Falls back to "target arch changed" when
 *      the wire value is null (older AMS build / not-stale row).
 *   3. A "Regenerate stale" button calls the existing batch regeneration
 *      entrypoint (`startBatchGeneration`) with `targetWorkItemIds =
 *      staleWorkItemIds` and `regenerateAll: true`. The AMS-side persist
 *      path clears the `stale` flag on every successfully-regenerated row
 *      (see `MigrationStorySpecGenerationService.persistOne`), so after
 *      successful regeneration the count drops to zero on the next refresh.
 *   4. After a successful regeneration the panel invokes the parent's
 *      `onRegenerated` callback so the dashboard re-fetches the stale
 *      summary and the rest of the panel state.
 *
 * Stale clear-on-regenerate is documented in the AMS service header --
 * regeneration writes through `persistBatchResults` which now resets
 * `stale=false, stale_marked_at=null` whenever the new status is in
 * `MigrationStorySpecGenerationStatus.SUCCESSFULLY_GENERATED`. A failed
 * regen keeps the flag intact so the user still sees the spec on the
 * dashboard.
 */

import React, { useCallback, useMemo, useState } from 'react';
import type {
  MigrationDeliveryHierarchyNodeDto,
  MigrationDeliveryNeedsAttentionItemDto,
  StaleSpecSummary,
} from '../../../api/migrationDeliveryDashboardApi';
import {
  startBatchGeneration,
  type BatchGenerationResult,
} from '../../../api/specGenerationApi';
import styles from './MigrationDeliveryDashboard.module.css';

// ============================================================================
// Chip helpers
// ============================================================================

/**
 * Map a `stale_reason` value (from the AMS spec-generation DTO) to a
 * human-readable chip label. Falls back to "target arch changed" so a row
 * with a null reason (older AMS build / not-stale row that still shows up
 * in `staleWorkItemIds`) keeps rendering a sensible chip.
 */
function labelForStaleReason(reason: string | null | undefined): string {
  switch (reason) {
    case 'resolution_reset':
      return 'stale: input resolution reset';
    case 'target_architecture_changed':
    default:
      return 'stale: target arch changed';
  }
}

/**
 * Walk the hierarchy and collect a per-WorkItem `staleReason` lookup. Only
 * nodes with both a `workItemId` and a non-null `staleReason` enter the
 * map; everything else is skipped (the chip helper falls back to the
 * legacy label on absent entries).
 */
function collectStaleReasonsFromHierarchy(
  hierarchy: ReadonlyArray<MigrationDeliveryHierarchyNodeDto> | undefined,
): Map<string, string | null> {
  const out = new Map<string, string | null>();
  if (!hierarchy) return out;
  const walk = (
    nodes: ReadonlyArray<MigrationDeliveryHierarchyNodeDto>,
  ): void => {
    for (const n of nodes) {
      if (n.workItemId && n.staleReason != null) {
        out.set(n.workItemId, n.staleReason);
      }
      if (n.children && n.children.length > 0) walk(n.children);
    }
  };
  walk(hierarchy);
  return out;
}

// ============================================================================
// Props
// ============================================================================

export interface MigrationDeliveryStaleSpecsPanelProps {
  projectId: string;
  bookOfWorkId: string;
  /** Pre-fetched stale-spec summary; the dashboard owns the fetch. */
  staleSummary: StaleSpecSummary | null;
  /**
   * Needs-attention rows from the same dashboard fetch -- consulted to join
   * stale WorkItem ids with story titles where possible. Optional; the panel
   * falls back to a generic "WorkItem <short-id>" label when a row is not
   * present.
   */
  needsAttention?: ReadonlyArray<MigrationDeliveryNeedsAttentionItemDto>;
  /**
   * Dashboard hierarchy from the same fetch. The panel walks it to read each
   * stale story's `staleReason` directly from the per-node DTO. Optional so
   * tests can mount the panel without a hierarchy and exercise the
   * fallback-label path.
   */
  hierarchy?: ReadonlyArray<MigrationDeliveryHierarchyNodeDto>;
  /**
   * Invoked after a successful regenerate-stale batch. The dashboard
   * triggers a full re-fetch in response (so the stale count drops to zero
   * and the rest of the dashboard catches up).
   */
  onRegenerated: () => void;
  /** Test seam: override the batch entrypoint. */
  startBatchGenerationFn?: typeof startBatchGeneration;
}

// ============================================================================
// Component
// ============================================================================

export const MigrationDeliveryStaleSpecsPanel: React.FC<
  MigrationDeliveryStaleSpecsPanelProps
> = ({
  projectId,
  bookOfWorkId,
  staleSummary,
  needsAttention,
  hierarchy,
  onRegenerated,
  startBatchGenerationFn = startBatchGeneration,
}) => {
  const [expanded, setExpanded] = useState<boolean>(false);
  const [inFlight, setInFlight] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const staleCount = staleSummary?.staleCount ?? 0;
  const staleIds = useMemo(
    () => staleSummary?.staleWorkItemIds ?? [],
    [staleSummary],
  );

  // Per-WorkItem stale-reason lookup, derived from the hierarchy. AMS
  // surfaces `staleReason` on every hierarchy node DTO so the panel can
  // render the chip variant without a separate API call.
  const staleReasonByWorkItemId = useMemo(
    () => collectStaleReasonsFromHierarchy(hierarchy),
    [hierarchy],
  );

  // Join stale WorkItem ids with story titles from the needs-attention list
  // where possible. Falls back to a short-id label otherwise.
  const titleByWorkItemId = useMemo(() => {
    const m = new Map<string, string>();
    for (const row of needsAttention ?? []) {
      if (row.workItemId) m.set(row.workItemId, row.title);
    }
    return m;
  }, [needsAttention]);

  const labelFor = useCallback(
    (workItemId: string): string => {
      const known = titleByWorkItemId.get(workItemId);
      if (known) return known;
      const short = workItemId.length > 8 ? workItemId.slice(0, 8) : workItemId;
      return `WorkItem ${short}`;
    },
    [titleByWorkItemId],
  );

  const handleRegenerateStale = useCallback(async () => {
    if (staleIds.length === 0) return;
    setActionError(null);
    setInFlight(true);
    try {
      const result: BatchGenerationResult = await startBatchGenerationFn({
        projectId,
        bookOfWorkId,
        regenerateAll: true,
        targetWorkItemIds: staleIds,
      });
      void result;
      onRegenerated();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Regenerate stale failed';
      setActionError(message);
    } finally {
      setInFlight(false);
    }
  }, [
    projectId,
    bookOfWorkId,
    staleIds,
    startBatchGenerationFn,
    onRegenerated,
  ]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <section
      className={styles.staleSpecsSection}
      data-testid="mdd-stale-specs-section"
      aria-label="Stale specs"
    >
      <div
        className={styles.summaryCard}
        data-testid="mdd-summary-card-stale-specs"
      >
        <h3 className={styles.summaryCardTitle}>Stale specs</h3>
        <button
          type="button"
          className={styles.summaryCardValueButton}
          data-testid="mdd-summary-card-stale-specs-value"
          onClick={() => setExpanded((p) => !p)}
          aria-expanded={expanded}
          aria-controls="mdd-stale-specs-panel"
          disabled={staleCount === 0}
        >
          <span className={styles.summaryCardValue}>{staleCount}</span>
        </button>
        <div className={styles.summaryCardBreakdown}>
          <span className={styles.summaryCardBreakdownItem}>
            Target arch changed
          </span>
        </div>
      </div>

      {expanded && (
        <div
          id="mdd-stale-specs-panel"
          className={styles.staleSpecsPanel}
          data-testid="mdd-stale-specs-panel"
        >
          <div className={styles.staleSpecsPanelHeader}>
            <h4>Stale shape-specs</h4>
            <button
              type="button"
              className={styles.bulkButton}
              data-testid="mdd-stale-specs-regenerate"
              disabled={inFlight || staleIds.length === 0}
              onClick={() => void handleRegenerateStale()}
            >
              {inFlight ? 'Regenerating\u2026' : 'Regenerate stale'}
              {staleIds.length > 0 ? ` (${staleIds.length})` : ''}
            </button>
          </div>

          {actionError && (
            <div
              className={styles.errorBanner}
              role="alert"
              data-testid="mdd-stale-specs-error"
            >
              {actionError}
            </div>
          )}

          {staleIds.length === 0 ? (
            <div
              className={styles.emptyPanel}
              data-testid="mdd-stale-specs-empty"
            >
              No stale specs.
            </div>
          ) : (
            <ul
              className={styles.staleSpecsList}
              data-testid="mdd-stale-specs-list"
            >
              {staleIds.map((wid) => {
                const reason = staleReasonByWorkItemId.get(wid) ?? null;
                return (
                  <li
                    key={wid}
                    className={styles.staleSpecsListItem}
                    data-testid={`mdd-stale-specs-list-item-${wid}`}
                  >
                    <span>{labelFor(wid)}</span>
                    <span
                      className={styles.badge}
                      data-testid={`mdd-stale-specs-list-item-reason-${wid}`}
                      style={{ marginLeft: 8 }}
                    >
                      {labelForStaleReason(reason)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
};

export default MigrationDeliveryStaleSpecsPanel;
