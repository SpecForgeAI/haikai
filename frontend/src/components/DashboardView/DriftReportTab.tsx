/**
 * DriftReportTab Component
 *
 * Spec: 2026-05-25 API Test Harness -- Diff Engine -- Task Group 5
 * Task 5.2.
 *
 * Tab content for the target-baseline "Drift report" tab. Renders:
 *   - Header counts strip ("N matched · N status drift · N body shape drift
 *     · N body value drift · N source-only")
 *   - "Computing…" spinner when `status='computing'`
 *   - "Stale" badge when either `baseline.updated_at > diff.computed_at`
 *     (source OR target)
 *   - Sortable / filterable table of diff items -- columns: method, path,
 *     scenario name, source status, target status, classification, findings
 *     badge, action ("View diff" -> opens DiffItemDetailModal)
 *   - "Recompute" button (action verb; disabled while `status='computing'`)
 *
 * Empty state when no source baseline can be resolved (CASCADE-removed
 * after source deletion): "Source baseline has been deleted; no drift
 * report available" + Recompute disabled.
 *
 * Naming convention enforced: UI copy uses "drift" / "Drift report"; the
 * underlying data + endpoint surface use "diff" (per accepted Q15 in
 * requirements).
 *
 * Location: under `frontend/src/components/DashboardView/` (NOT
 * `frontend/src/components/ApiBehaviour/`) -- colocated with the parent
 * `BaselineDetailView` and the sibling `DiffItemDetailModal`.
 *
 * Findings badge column (Spec: 2026-05-25 API Test Harness -- Findings
 * Integration -- Task Group 4 sub-task 4.3): per-row count of findings
 * linked to the diff_item via `discovery_finding_links`
 * (target_type='api_behaviour_diff_item'). Loaded via a single batch query
 * (`listDiffFindings`) at tab load and after each recompute completes;
 * grouped client-side by the link's `target_id` so per-row badge counts
 * don't require N+1 queries. Badge click opens `DiffFindingDetailDrawer`
 * pre-loaded with that diff_item's findings.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ApiBehaviourBaselineDto,
  ApiBehaviourBaselineItemDto,
  ApiBehaviourDiffDto,
  ApiBehaviourDiffItemDto,
  createDiff,
  getDiffByTargetBaseline,
  getDiffStatus,
  listDiffItems,
  recomputeDiff,
} from '../../api/apiBehaviourClient';
import {
  DiscoveryFindingDto,
  listDiffFindings,
} from '../../api/diffFindingsApi';
import styles from './ApiBaselinesListPage.module.css';
import { DiffItemDetailModal } from './DiffItemDetailModal';
import { DiffFindingDetailDrawer } from './DiffFindingDetailDrawer';
// CSD Spec 8 (2026-08-18): signature-level clustered rollup.
import { DiffClusteredSummary } from './DiffClusteredSummary';

export interface DriftReportTabProps {
  projectId: string;
  architectureId: string;
  /** The target baseline this Drift report tab belongs to. */
  targetBaseline: ApiBehaviourBaselineDto;
  /**
   * The source baseline resolved from `targetBaseline.paired_with_baseline_id`.
   * `null` when the source has been deleted (CASCADE removed the diff rows);
   * `undefined` while we're still resolving.
   */
  sourceBaseline: ApiBehaviourBaselineDto | null | undefined;
  /**
   * Target baseline items (loaded by the parent view for the existing
   * baseline-items section). Passed through so the diff-item modal can
   * render the target side without an extra fetch.
   */
  targetBaselineItems?: ApiBehaviourBaselineItemDto[];
  /** Source baseline items (loaded on-demand for the diff modal). */
  sourceBaselineItems?: ApiBehaviourBaselineItemDto[];
}

/**
 * Polling cadence (ms) while `status='computing'`. Matches the existing
 * capture-session polling cadence -- 2-3s is a good UX balance between
 * responsiveness and load.
 */
const POLL_INTERVAL_MS = 2500;

/**
 * Severity rank for the per-diff_item badge color. Higher rank wins when
 * multiple findings of different severities are present (v1 emits at most
 * one per diff_item, but the ranking keeps room for future multi-emission).
 */
const SEVERITY_RANK: Record<string, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
};

function findingsBadgeClass(maxSeverity: string | null): string {
  if (!maxSeverity) return '';
  switch (maxSeverity.toLowerCase()) {
    case 'critical':
      return styles.findingsBadgeCritical;
    case 'high':
      return styles.findingsBadgeHigh;
    case 'medium':
      return styles.findingsBadgeMedium;
    case 'low':
      return styles.findingsBadgeLow;
    case 'info':
      return styles.findingsBadgeInfo;
    default:
      return '';
  }
}

/**
 * Pick the max-severity label across a list of findings. Used to drive the
 * badge's background color.
 */
function maxSeverity(findings: DiscoveryFindingDto[]): string | null {
  if (findings.length === 0) return null;
  let best: string | null = null;
  let bestRank = -1;
  for (const f of findings) {
    const r = SEVERITY_RANK[(f.severity ?? '').toLowerCase()] ?? 0;
    if (r > bestRank) {
      bestRank = r;
      best = f.severity ?? null;
    }
  }
  return best;
}

/**
 * Group a flat list of findings by the diff_item id they link to (via
 * `discovery_finding_links` where `target_type='api_behaviour_diff_item'`).
 * Findings without such a link are ignored. v1 rules emit each finding with
 * exactly one such link, so the count per diff_item is the number of
 * findings whose links contain a matching entry.
 */
function groupFindingsByDiffItem(
  findings: DiscoveryFindingDto[],
): Map<string, DiscoveryFindingDto[]> {
  const m = new Map<string, DiscoveryFindingDto[]>();
  for (const f of findings) {
    for (const link of f.links ?? []) {
      if (link.target_type !== 'api_behaviour_diff_item') continue;
      const arr = m.get(link.target_id) ?? [];
      arr.push(f);
      m.set(link.target_id, arr);
    }
  }
  return m;
}

function isStale(
  baseline: ApiBehaviourBaselineDto | null | undefined,
  computedAt: string | null | undefined,
): boolean {
  if (!baseline || !computedAt) return false;
  const updatedAtRaw = baseline.updated_at;
  if (!updatedAtRaw) return false;
  const updated = new Date(updatedAtRaw).getTime();
  const computed = new Date(computedAt).getTime();
  if (Number.isNaN(updated) || Number.isNaN(computed)) return false;
  return updated > computed;
}

function classificationLabel(
  status: string,
  body: string | null,
): { label: string; cls: string } {
  if (status === 'source_only') {
    return { label: 'Source only', cls: styles.classificationSourceOnly };
  }
  if (status === 'target_only') {
    return { label: 'Target only', cls: styles.classificationTargetOnly };
  }
  if (status === 'status_drift') {
    return { label: 'Status drift', cls: styles.classificationStatusDrift };
  }
  if (body === 'body_shape_drift') {
    return { label: 'Body shape drift', cls: styles.classificationBodyShapeDrift };
  }
  if (body === 'body_value_drift') {
    return { label: 'Body value drift', cls: styles.classificationBodyValueDrift };
  }
  return { label: 'Matched', cls: styles.classificationMatched };
}

export const DriftReportTab: React.FC<DriftReportTabProps> = ({
  projectId,
  architectureId,
  targetBaseline,
  sourceBaseline,
  targetBaselineItems,
  sourceBaselineItems,
}) => {
  const [diff, setDiff] = useState<ApiBehaviourDiffDto | null>(null);
  const [items, setItems] = useState<ApiBehaviourDiffItemDto[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [recomputing, setRecomputing] = useState<boolean>(false);
  const [openedDiffItem, setOpenedDiffItem] = useState<ApiBehaviourDiffItemDto | null>(null);
  /**
   * All findings emitted for the current diff, batch-loaded in one call.
   * Grouped client-side by diff_item id (via the link table) for per-row
   * badge counts -- no N+1 queries. Spec 2026-05-25 Findings Integration.
   */
  const [findings, setFindings] = useState<DiscoveryFindingDto[]>([]);
  /**
   * The diff_item whose Findings badge was clicked. Drives the drawer
   * mount; cleared on drawer close.
   */
  const [openedFindingsDiffItem, setOpenedFindingsDiffItem] =
    useState<ApiBehaviourDiffItemDto | null>(null);

  // Polling control -- a ref so the effect doesn't see stale state.
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sourceDeleted = sourceBaseline === null;

  const loadDiff = useCallback(async (): Promise<ApiBehaviourDiffDto | null> => {
    if (!targetBaseline.id) return null;
    return await getDiffByTargetBaseline(projectId, targetBaseline.id);
  }, [projectId, targetBaseline.id]);

  const loadItems = useCallback(
    async (diffId: string): Promise<ApiBehaviourDiffItemDto[]> => {
      return await listDiffItems(projectId, diffId);
    },
    [projectId],
  );

  /**
   * Batch-load all findings for the current diff. Failure is soft: badge
   * column simply shows empty for every row. The diff itself stays
   * usable -- findings emission is best-effort per accepted Q9.
   */
  const loadFindings = useCallback(
    async (diffId: string): Promise<DiscoveryFindingDto[]> => {
      try {
        return await listDiffFindings(projectId, diffId);
      } catch {
        return [];
      }
    },
    [projectId],
  );

  // Initial load: fetch the existing diff (if any) + its items + its findings.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const initial = await loadDiff();
        if (cancelled) return;
        setDiff(initial);
        if (initial && initial.status !== 'computing') {
          const [fetchedItems, fetchedFindings] = await Promise.all([
            loadItems(initial.id),
            loadFindings(initial.id),
          ]);
          if (!cancelled) {
            setItems(fetchedItems);
            setFindings(fetchedFindings);
          }
        } else {
          setItems([]);
          setFindings([]);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load drift report');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadDiff, loadItems, loadFindings]);

  // Poll while `status='computing'`. Stops on terminal status.
  useEffect(() => {
    if (!diff || diff.status !== 'computing') {
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      return;
    }
    let cancelled = false;
    const tick = async () => {
      try {
        const status = await getDiffStatus(diff.id);
        if (cancelled) return;
        // Merge status into the diff DTO so counts + computed_at reflect
        // the latest state. The full DTO (with project/source/target ids)
        // stays intact; only the polled fields change.
        setDiff((prev) =>
          prev
            ? {
                ...prev,
                status: status.status,
                matched_count: status.matched_count,
                status_drift_count: status.status_drift_count,
                body_shape_drift_count: status.body_shape_drift_count,
                body_value_drift_count: status.body_value_drift_count,
                source_only_count: status.source_only_count,
                target_only_count: status.target_only_count,
                computed_at: status.computed_at,
                error_message: status.error_message,
              }
            : prev,
        );
        if (status.status !== 'computing') {
          // Terminal -- fetch the items + findings and stop polling.
          // Findings auto-emit at the tail of diffRunner; load them here
          // so the badge column reflects the latest set (recompute clears
          // + re-emits via the runner's mandatory cleanup step, so the
          // counts can shift between recomputes).
          try {
            const [fetchedItems, fetchedFindings] = await Promise.all([
              loadItems(diff.id),
              loadFindings(diff.id),
            ]);
            if (!cancelled) {
              setItems(fetchedItems);
              setFindings(fetchedFindings);
            }
          } catch (err) {
            if (!cancelled) {
              setError(err instanceof Error ? err.message : 'Failed to load drift items');
            }
          }
          if (!cancelled) setRecomputing(false);
        } else if (!cancelled) {
          pollTimerRef.current = setTimeout(tick, POLL_INTERVAL_MS);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Polling failed');
          setRecomputing(false);
        }
      }
    };
    pollTimerRef.current = setTimeout(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [diff, loadItems, loadFindings]);

  const handleRecompute = useCallback(async () => {
    if (recomputing) return;
    setRecomputing(true);
    setError(null);
    try {
      // Two paths:
      //   - existing diff -> POST /diffs/:id/recompute
      //   - no diff yet -> POST /diffs (create + spawn runner)
      let updated: ApiBehaviourDiffDto;
      if (diff && diff.id) {
        updated = await recomputeDiff(diff.id);
      } else {
        if (!sourceBaseline) {
          setError('Cannot create diff: source baseline is not available');
          setRecomputing(false);
          return;
        }
        updated = await createDiff({
          projectId,
          architectureId,
          sourceBaselineId: sourceBaseline.id,
          targetBaselineId: targetBaseline.id,
        });
      }
      setDiff(updated);
      // Polling effect will pick up `status='computing'` and start the
      // tick loop; `recomputing` stays true until the poll resolves to
      // a terminal status.
    } catch (err) {
      // 409 (already running) is a benign signal: the diff is in flight,
      // the polling effect will catch the next status. Other errors are
      // surfaced inline.
      setError(err instanceof Error ? err.message : 'Recompute failed');
      setRecomputing(false);
    }
  }, [
    recomputing,
    diff,
    sourceBaseline,
    projectId,
    architectureId,
    targetBaseline.id,
  ]);

  /**
   * Apply a fresh finding row to the local findings state after a reviewer
   * action in the drawer. Replace by id; if the id isn't present (shouldn't
   * happen in v1), append.
   */
  const handleFindingUpdated = useCallback(
    (updated: DiscoveryFindingDto) => {
      setFindings((prev) => {
        const idx = prev.findIndex((f) => f.id === updated.id);
        if (idx < 0) return [...prev, updated];
        const next = prev.slice();
        next[idx] = updated;
        return next;
      });
    },
    [],
  );

  const sortedItems = useMemo(() => {
    return [...items].sort((a, b) => {
      const am = (a.method ?? '').toUpperCase();
      const bm = (b.method ?? '').toUpperCase();
      if (am !== bm) return am < bm ? -1 : 1;
      const ap = a.path ?? '';
      const bp = b.path ?? '';
      if (ap !== bp) return ap < bp ? -1 : 1;
      const an = a.scenario_name ?? '';
      const bn = b.scenario_name ?? '';
      if (an !== bn) return an < bn ? -1 : 1;
      return 0;
    });
  }, [items]);

  // Helper map source/target baseline items by id for the modal lookup.
  const sourceItemsById = useMemo(() => {
    const m = new Map<string, ApiBehaviourBaselineItemDto>();
    for (const it of sourceBaselineItems ?? []) m.set(it.id, it);
    return m;
  }, [sourceBaselineItems]);

  const targetItemsById = useMemo(() => {
    const m = new Map<string, ApiBehaviourBaselineItemDto>();
    for (const it of targetBaselineItems ?? []) m.set(it.id, it);
    return m;
  }, [targetBaselineItems]);

  /**
   * Map of diff_item_id -> findings linked to it. Memoised over the flat
   * findings array so per-row badge lookups are O(1) and the table render
   * stays cheap even for large diffs.
   */
  const findingsByDiffItemId = useMemo(
    () => groupFindingsByDiffItem(findings),
    [findings],
  );

  /**
   * The findings filtered to the diff_item whose badge is currently open
   * in the drawer. Recomputed off the latest `findings` state so a reviewer
   * action that mutates the finding reflects in the drawer immediately.
   */
  const drawerFindings = useMemo<DiscoveryFindingDto[]>(() => {
    if (!openedFindingsDiffItem) return [];
    return findingsByDiffItemId.get(openedFindingsDiffItem.id) ?? [];
  }, [openedFindingsDiffItem, findingsByDiffItemId]);

  const computing = diff?.status === 'computing' || recomputing;
  const stale =
    isStale(sourceBaseline ?? null, diff?.computed_at) ||
    isStale(targetBaseline, diff?.computed_at);

  // --- Empty state: source baseline deleted ------------------------------
  if (sourceDeleted) {
    return (
      <div className={styles.detailSection} data-testid="drift-report-tab">
        <div className={styles.emptyMessage} data-testid="drift-report-source-deleted">
          Source baseline has been deleted; no drift report available
        </div>
        <button
          type="button"
          className={styles.primaryButton}
          disabled
          data-testid="drift-report-recompute-button"
          title="Recompute is disabled because the source baseline no longer exists."
        >
          Recompute
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className={styles.detailSection} data-testid="drift-report-tab">
        <div className={styles.emptyMessage}>Loading drift report…</div>
      </div>
    );
  }

  return (
    <div
      className={styles.detailSection}
      data-testid="drift-report-tab"
      data-diff-status={diff?.status ?? 'none'}
    >
      <div className={styles.driftHeader}>
        <div className={styles.driftCounts} data-testid="drift-report-counts">
          <span
            className={`${styles.driftCount} ${styles.driftCountMatched}`}
            data-testid="drift-report-count-matched"
          >
            ✓ {diff?.matched_count ?? 0} matched
          </span>
          <span
            className={`${styles.driftCount} ${styles.driftCountStatusDrift}`}
            data-testid="drift-report-count-status-drift"
          >
            ! {diff?.status_drift_count ?? 0} status drift
          </span>
          <span
            className={`${styles.driftCount} ${styles.driftCountBodyShapeDrift}`}
            data-testid="drift-report-count-body-shape-drift"
          >
            ! {diff?.body_shape_drift_count ?? 0} body shape drift
          </span>
          <span
            className={`${styles.driftCount} ${styles.driftCountBodyValueDrift}`}
            data-testid="drift-report-count-body-value-drift"
          >
            i {diff?.body_value_drift_count ?? 0} body value drift
          </span>
          <span
            className={`${styles.driftCount} ${styles.driftCountSourceOnly}`}
            data-testid="drift-report-count-source-only"
          >
            » {diff?.source_only_count ?? 0} source-only
          </span>
          {stale && (
            <span className={styles.staleBadge} data-testid="drift-report-stale-badge">
              Stale
            </span>
          )}
        </div>
        <button
          type="button"
          className={styles.primaryButton}
          onClick={handleRecompute}
          disabled={computing}
          data-testid="drift-report-recompute-button"
        >
          {computing ? 'Computing…' : 'Recompute'}
        </button>
      </div>

      {error && (
        <div className={styles.errorBanner} data-testid="drift-report-error">
          {error}
        </div>
      )}

      {/* CSD Spec 8 (2026-08-18): signature-level rollup — a large (round-2)
          diff triages as a handful of groups, never item-by-item. */}
      <DiffClusteredSummary items={items} />

      {computing && (
        <div className={styles.emptyMessage} data-testid="drift-report-computing-spinner">
          Computing…
        </div>
      )}

      {!computing && diff && sortedItems.length === 0 && (
        <div className={styles.emptyMessage} data-testid="drift-report-empty">
          No diff items recorded yet.
        </div>
      )}

      {!computing && !diff && (
        <div className={styles.emptyMessage} data-testid="drift-report-no-diff">
          No drift report has been computed yet. Click Recompute to generate one.
        </div>
      )}

      {sortedItems.length > 0 && (
        <table
          className={styles.driftItemsTable}
          data-testid="drift-report-items-table"
        >
          <thead>
            <tr>
              <th>Method</th>
              <th>Path</th>
              <th>Scenario</th>
              <th>Source status</th>
              <th>Target status</th>
              <th>Classification</th>
              <th>Findings</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {sortedItems.map((it) => {
              const { label, cls } = classificationLabel(
                it.status_classification,
                it.body_classification,
              );
              const rowFindings = findingsByDiffItemId.get(it.id) ?? [];
              const rowFindingsCount = rowFindings.length;
              const rowMaxSeverity = maxSeverity(rowFindings);
              return (
                <tr
                  key={it.id}
                  data-testid="drift-report-item-row"
                  data-diff-item-id={it.id}
                >
                  <td>{it.method}</td>
                  <td>{it.path}</td>
                  <td>{it.scenario_name}</td>
                  <td>{it.source_response_status ?? '—'}</td>
                  <td>{it.target_response_status ?? '—'}</td>
                  <td>
                    <span className={`${styles.classificationBadge} ${cls}`}>
                      {label}
                    </span>
                  </td>
                  <td>
                    {rowFindingsCount > 0 ? (
                      <button
                        type="button"
                        className={`${styles.findingsBadge} ${findingsBadgeClass(rowMaxSeverity)}`}
                        onClick={() => setOpenedFindingsDiffItem(it)}
                        data-testid="drift-report-findings-badge"
                        data-findings-count={rowFindingsCount}
                        data-findings-max-severity={rowMaxSeverity ?? ''}
                        title={`${rowFindingsCount} finding${rowFindingsCount === 1 ? '' : 's'} (${rowMaxSeverity ?? ''})`}
                      >
                        {rowFindingsCount}
                      </button>
                    ) : (
                      <span
                        className={styles.findingsBadgeEmpty}
                        data-testid="drift-report-findings-badge-empty"
                      >
                        —
                      </span>
                    )}
                  </td>
                  <td>
                    <button
                      type="button"
                      className={styles.refreshButton}
                      onClick={() => setOpenedDiffItem(it)}
                      data-testid="drift-report-view-diff-button"
                    >
                      View diff
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {openedDiffItem && (
        <DiffItemDetailModal
          diffItem={openedDiffItem}
          sourceBaselineItem={
            openedDiffItem.source_baseline_item_id
              ? sourceItemsById.get(openedDiffItem.source_baseline_item_id) ?? null
              : null
          }
          targetBaselineItem={
            openedDiffItem.target_baseline_item_id
              ? targetItemsById.get(openedDiffItem.target_baseline_item_id) ?? null
              : null
          }
          onClose={() => setOpenedDiffItem(null)}
        />
      )}

      {openedFindingsDiffItem && diff && (
        <DiffFindingDetailDrawer
          projectId={projectId}
          diffId={diff.id}
          diffItem={{
            id: openedFindingsDiffItem.id,
            method: openedFindingsDiffItem.method ?? '',
            path: openedFindingsDiffItem.path ?? '',
            scenario_name: openedFindingsDiffItem.scenario_name ?? '',
          }}
          findings={drawerFindings}
          onClose={() => setOpenedFindingsDiffItem(null)}
          onFindingUpdated={handleFindingUpdated}
        />
      )}
    </div>
  );
};

export default DriftReportTab;
