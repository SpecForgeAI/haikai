/**
 * DiscoveryRunsList Component
 *
 * Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 7 (Task 7.4)
 *
 * Stripped-down list of historical discovery runs for the active project +
 * architecture (most recent first). Extracted from `DiscoveryRunDetailView`'s
 * left column so it can be reused by the new `<DiscoveryListPage/>` and
 * (optionally) by the existing detail-view layout for in-detail navigation.
 *
 * Each row shows: status badge, optional tier badge, created-at timestamp.
 * Click -> invoke `onSelectRun(runId)` (the parent decides whether to
 * navigate to the detail URL or just update local state).
 *
 * V1 stripped-down: no filters, no sort UI, no candidate-table preview --
 * those are explicitly deferred per the spec.
 *
 * Spec 2026-05-10: Runtime Log Input at Discovery Run Start -- Task Group 5
 * - Reads `config_snapshot.inputArtifacts.{logFiles,attemptedCount}` and
 *   renders a small warning chip adjacent to the status badge when log
 *   attachment was partial or failed. Predicate lives in
 *   `runInputArtifactsHelpers.ts` so it can be unit-tested pure-JS.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { deleteDiscoveryRun, getDiscoveryRuns } from '../../api/discoveryApi';
import type { DiscoveryRunDto } from '../../api/discoveryApi';
import { TierBadge } from './TierBadge';
// Spec 2026-05-16 Database Discovery Packs -- Group 5: kind badge for the
// source-of-truth of each run (code / database / combined).
import { DiscoveryRunKindBadge } from '../Discovery/DiscoveryRunKindBadge';
import {
  computeLogAttachWarningState,
  logAttachWarningLabel,
} from '../Discovery/runInputArtifactsHelpers';
import {
  computeServiceDeletedState,
  type ServiceDeletedState,
} from './serviceDeletedHelpers';
import styles from './DiscoveryRunDetailView.module.css';

export interface DiscoveryRunsListProps {
  /** Owning project id. */
  projectId: string;
  /** Active architecture id. The list filters to runs bound to this id. */
  architectureId: string | null;
  /**
   * Currently selected run id (for highlight styling). Optional -- the
   * standalone list page does not need a highlight, but the in-detail
   * mounting can pass it for visual feedback.
   */
  selectedRunId?: string | null;
  /** Callback fired when the user clicks a row. */
  onSelectRun: (runId: string) => void;
}

/**
 * Returns the CSS class for a given run status. Mirrors the local helper
 * inside `DiscoveryRunDetailView` so the visual is identical when the list
 * is rendered standalone vs. embedded.
 */
function getStatusClass(status: string): string {
  switch (status.toUpperCase()) {
    case 'COMPLETED':
      return styles.statusCompleted;
    case 'FAILED':
      return styles.statusFailed;
    case 'RUNNING':
      return styles.statusRunning;
    case 'PENDING':
      return styles.statusPending;
    case 'CANCELLED':
      return styles.statusCancelled;
    default:
      return styles.statusPending;
  }
}

/**
 * Format an ISO date string to a human-readable form. Falls back to the
 * raw string if `Date` parsing throws.
 */
function formatDate(isoDate: string): string {
  try {
    return new Date(isoDate).toLocaleString();
  } catch {
    return isoDate;
  }
}

export const DiscoveryRunsList: React.FC<DiscoveryRunsListProps> = ({
  projectId,
  architectureId,
  selectedRunId,
  onSelectRun,
}) => {
  const [runs, setRuns] = useState<DiscoveryRunDto[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  /** Open right-click menu (cursor-anchored), or null when closed. */
  const [menu, setMenu] = useState<{ runId: string; x: number; y: number } | null>(null);
  /** The run id whose DELETE is in flight (greys its row). */
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchRunList = useCallback(async () => {
    if (!architectureId) {
      // Defensive: without an active architecture the URL is mid-redirect.
      // Skip the fetch -- the list will refresh once the route resolves.
      setRuns([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await getDiscoveryRuns(projectId, architectureId);
      setRuns(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load discovery runs');
    } finally {
      setLoading(false);
    }
  }, [projectId, architectureId]);

  // Fetch on mount and on architecture switch.
  useEffect(() => {
    if (!architectureId) {
      setRuns([]);
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function doFetch() {
      setLoading(true);
      setError(null);
      try {
        const result = await getDiscoveryRuns(projectId, architectureId!);
        if (!cancelled) {
          setRuns(result);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load discovery runs');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    doFetch();
    return () => {
      cancelled = true;
    };
  }, [projectId, architectureId]);

  const handleRefresh = useCallback(() => {
    fetchRunList();
  }, [fetchRunList]);

  const closeMenu = useCallback(() => setMenu(null), []);

  /**
   * Open the cursor-anchored "Delete" menu for a run. `preventDefault` stops the
   * browser's native context menu; `stopPropagation` keeps the document-level
   * dismiss listener (below) from immediately closing the menu we just opened.
   */
  const handleContextMenu = useCallback((e: React.MouseEvent, runId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ runId, x: e.clientX, y: e.clientY });
  }, []);

  // Dismiss the open menu on any outside click, a right-click elsewhere, or
  // Escape. Row right-clicks stopPropagation, so they never reach these.
  useEffect(() => {
    if (!menu) return;
    const onDismiss = () => closeMenu();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMenu();
    };
    document.addEventListener('click', onDismiss);
    document.addEventListener('contextmenu', onDismiss);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onDismiss);
      document.removeEventListener('contextmenu', onDismiss);
      document.removeEventListener('keydown', onKey);
    };
  }, [menu, closeMenu]);

  /**
   * Delete a run and all its child data (server cascades candidates / evidence /
   * relationships / clusters / decision tasks / findings / capabilities), then
   * refetch the list. A confirm guards the irreversible action; an in-progress
   * run adds an extra warning line.
   */
  const handleDelete = useCallback(
    async (run: DiscoveryRunDto) => {
      closeMenu();
      if (!architectureId) return;
      const inProgress = ['RUNNING', 'PENDING'].includes((run.status ?? '').toUpperCase());
      const message =
        'Delete this discovery run and all its candidates, evidence, relationships, and findings?\n\n' +
        'This cannot be undone.' +
        (inProgress
          ? '\n\nThis run is still in progress — deleting it now will stop tracking that run.'
          : '');
      if (!window.confirm(message)) return;
      setDeletingId(run.id);
      setError(null);
      try {
        await deleteDiscoveryRun(projectId, architectureId, run.id);
        await fetchRunList();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to delete discovery run');
      } finally {
        setDeletingId(null);
      }
    },
    [projectId, architectureId, fetchRunList, closeMenu],
  );

  return (
    <div className={styles.runListSection} data-testid="discovery-runs-list">
      <div className={styles.runListHeader}>
        <h3>Run History</h3>
        <button
          className={styles.refreshButton}
          onClick={handleRefresh}
          disabled={loading}
          data-testid="refresh-runs-button"
        >
          Refresh
        </button>
      </div>
      {loading && <div className={styles.loadingState}>Loading runs...</div>}
      {error && <div className={styles.errorMessage}>{error}</div>}
      {!loading && !error && runs.length === 0 && (
        <div className={styles.emptyMessage} data-testid="empty-runs-message">
          No discovery runs found for this project. Start a new run to begin analyzing your codebase.
        </div>
      )}
      {!loading && !error && runs.length > 0 && (
        <ul className={styles.runList} data-testid="run-list">
          {runs.map((run) => {
            const warningState = computeLogAttachWarningState(run.config_snapshot);
            const warningLabel = logAttachWarningLabel(warningState);
            const serviceDeletedState: ServiceDeletedState =
              computeServiceDeletedState(run);
            return (
              <li
                key={run.id}
                className={`${styles.runListItem}${selectedRunId === run.id ? ` ${styles.runListItemSelected}` : ''}`}
                onClick={() => onSelectRun(run.id)}
                onContextMenu={(e) => handleContextMenu(e, run.id)}
                data-testid="run-list-item"
                data-run-id={run.id}
                data-deleting={deletingId === run.id ? 'true' : undefined}
                style={deletingId === run.id ? { opacity: 0.5, pointerEvents: 'none' } : undefined}
              >
                <span className={`${styles.statusBadge} ${getStatusClass(run.status)}`}>
                  {run.status}
                </span>
                {serviceDeletedState.kind === 'deleted-with-snapshot' && (
                  <>
                    <span
                      className={styles.serviceNameLabel}
                      data-testid="run-list-service-name-label"
                    >
                      {serviceDeletedState.serviceName}
                    </span>
                    <span
                      className={styles.serviceDeletedChip}
                      data-testid="run-list-service-deleted-chip"
                    >
                      Service deleted
                    </span>
                  </>
                )}
                {serviceDeletedState.kind === 'deleted-without-snapshot' && (
                  <span
                    className={styles.serviceDeletedChip}
                    data-testid="run-list-service-deleted-chip"
                  >
                    Service deleted
                  </span>
                )}
                {warningLabel && (
                  <span
                    className={`${styles.logsAttachWarningChip} ${
                      warningState === 'failed'
                        ? styles.logsAttachWarningChipFailed
                        : styles.logsAttachWarningChipPartial
                    }`}
                    data-testid="run-list-logs-attach-warning-chip"
                    data-warning-state={warningState}
                  >
                    {warningLabel}
                  </span>
                )}
                {run.tier && (
                  <span className={styles.runListItemTier}>
                    <TierBadge tier={run.tier} data-testid="run-list-tier-badge" />
                  </span>
                )}
                {/* Spec 2026-05-16 Group 5: surface the run's source kind. */}
                <DiscoveryRunKindBadge kind={run.discovery_kind} />
                <span className={styles.runListItemDate}>{formatDate(run.created_at)}</span>
              </li>
            );
          })}
        </ul>
      )}
      {menu && (() => {
        const run = runs.find((r) => r.id === menu.runId);
        if (!run) return null;
        return (
          <div
            className={styles.runContextMenu}
            style={{ top: menu.y, left: menu.x }}
            data-testid="run-context-menu"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className={`${styles.runContextMenuItem} ${styles.runContextMenuItemDanger}`}
              onClick={() => void handleDelete(run)}
              data-testid="run-context-menu-delete"
            >
              Delete run
            </button>
          </div>
        );
      })()}
    </div>
  );
};
