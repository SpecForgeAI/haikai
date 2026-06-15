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
import { getDiscoveryRuns } from '../../api/discoveryApi';
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
                data-testid="run-list-item"
                data-run-id={run.id}
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
    </div>
  );
};
