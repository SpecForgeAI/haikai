/**
 * BaselinesList Component
 *
 * Spec: 2026-05-15 API Behaviour Baseline Capture Service -- Task Group 8
 *
 * Sibling list of durable saved baselines for the active project +
 * architecture. Mirrors the `CaptureSessionsList` structure / styling.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ApiBehaviourBaselineDto,
  BaselineStatus,
  deleteBaseline,
  getCaptureSession,
  listBaselines,
  reconcileInventory,
  updateBaseline,
} from '../../api/apiBehaviourClient';
import styles from './ApiBaselinesListPage.module.css';

/**
 * Per-baseline read-only coverage info (Model-Seeded Capture Inventory spec,
 * 2026-06-11). Fetched fail-soft via `reconcile-inventory` with
 * `refresh_findings: false` (display-only -- never writes findings) against
 * the baseline's source `session_id`, plus the source session's override
 * note. PURELY informational: the Activate transition logic is untouched
 * (D3 -- the gate already ran at session Start; Activate never re-blocks).
 */
interface BaselineCoverageInfo {
  inScopePct: number | null;
  architecturePct: number | null;
  overrideJustification: string | null;
}

export interface BaselinesListProps {
  projectId: string;
  architectureId: string | null;
  selectedBaselineId?: string | null;
  onSelect: (baselineId: string) => void;
}

function statusClass(status: string | null | undefined): string {
  switch ((status ?? '').toLowerCase()) {
    case 'draft':
      return styles.statusDraft;
    case 'active':
      return styles.statusActive;
    case 'archived':
      return styles.statusArchived;
    default:
      return styles.statusDraft;
  }
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

/**
 * The one status action each baseline state offers (mirrors the server-side
 * allowed transitions): draft/archived → Activate; active → Archive. An
 * ACTIVE baseline is what the migration-readiness rules require for the
 * api/baseline streams to read sufficient.
 */
function nextStatusAction(
  status: string | null | undefined,
): { label: string; to: BaselineStatus } | null {
  switch ((status ?? '').toLowerCase()) {
    case 'draft':
    case 'archived':
      return { label: 'Activate', to: 'active' };
    case 'active':
      return { label: 'Archive', to: 'archived' };
    default:
      return null;
  }
}

export const BaselinesList: React.FC<BaselinesListProps> = ({
  projectId,
  architectureId,
  selectedBaselineId,
  onSelect,
}) => {
  const [baselines, setBaselines] = useState<ApiBehaviourBaselineDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** The baseline id whose status PATCH is in flight (disables that row's button). */
  const [statusActionInFlight, setStatusActionInFlight] = useState<string | null>(null);
  /** The baseline id whose DELETE is in flight (disables that row's button). */
  const [deletingId, setDeletingId] = useState<string | null>(null);
  /** baseline id -> read-only coverage info (absent = unavailable / legacy). */
  const [coverageInfo, setCoverageInfo] = useState<Record<string, BaselineCoverageInfo>>({});

  const load = useCallback(async () => {
    if (!architectureId) {
      setBaselines([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await listBaselines(projectId, architectureId);
      setBaselines(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load baselines');
    } finally {
      setLoading(false);
    }
  }, [projectId, architectureId]);

  /**
   * Activate / Archive a baseline (the server validates the transition), then
   * reload so the badge + action reflect the new status. Click must NOT bubble
   * to the row's onSelect.
   */
  const handleStatusAction = useCallback(
    async (
      e: React.MouseEvent,
      baseline: ApiBehaviourBaselineDto,
      to: BaselineStatus,
    ) => {
      e.stopPropagation();
      if (!architectureId) return;
      setStatusActionInFlight(baseline.id);
      setError(null);
      try {
        await updateBaseline(projectId, architectureId, baseline.id, { status: to });
        await load();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : `Failed to set baseline ${to}`,
        );
      } finally {
        setStatusActionInFlight(null);
      }
    },
    [projectId, architectureId, load],
  );

  /**
   * Delete a baseline (and any diff/drift reports computed from it — the server
   * cascades them), then reload so the row disappears. A confirm guards the
   * irreversible action. Click must NOT bubble to the row's onSelect. Deleting
   * a baseline does NOT delete the capture session it was saved from.
   */
  const handleDelete = useCallback(
    async (e: React.MouseEvent, baseline: ApiBehaviourBaselineDto) => {
      e.stopPropagation();
      if (!architectureId) return;
      const message =
        `Delete baseline "${baseline.name || '(unnamed)'}"?\n\n` +
        'This also removes any diff/drift reports computed from it. ' +
        'The capture session it was saved from is kept.';
      if (!window.confirm(message)) return;
      setDeletingId(baseline.id);
      setError(null);
      try {
        await deleteBaseline(projectId, architectureId, baseline.id);
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to delete baseline');
      } finally {
        setDeletingId(null);
      }
    },
    [projectId, architectureId, load],
  );

  // Read-only coverage fetch per baseline (fail-soft). Display-only callers
  // pass refresh_findings: false so no reconciliation findings are written.
  // Baselines without a session_id (or whose fetches fail -- e.g. legacy
  // rows whose source session was deleted) simply render no coverage note.
  useEffect(() => {
    if (!architectureId || baselines.length === 0) {
      setCoverageInfo({});
      return;
    }
    let cancelled = false;
    void (async () => {
      const entries = await Promise.all(
        baselines
          .filter((b) => typeof b.session_id === 'string' && b.session_id.length > 0)
          .map(async (b) => {
            try {
              const [rec, session] = await Promise.all([
                reconcileInventory(projectId, architectureId, b.session_id as string, {
                  refresh_findings: false,
                }),
                getCaptureSession(projectId, architectureId, b.session_id as string),
              ]);
              const info: BaselineCoverageInfo = {
                inScopePct: rec.in_scope_coverage_pct,
                architecturePct: rec.architecture_coverage_pct,
                overrideJustification:
                  typeof session.coverage_override_justification === 'string' &&
                  session.coverage_override_justification.length > 0
                    ? session.coverage_override_justification
                    : null,
              };
              return [b.id, info] as const;
            } catch {
              return null;
            }
          }),
      );
      if (cancelled) return;
      const next: Record<string, BaselineCoverageInfo> = {};
      for (const e of entries) {
        if (e) next[e[0]] = e[1];
      }
      setCoverageInfo(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [baselines, projectId, architectureId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!architectureId) {
        setBaselines([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const res = await listBaselines(projectId, architectureId);
        if (!cancelled) setBaselines(res);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load baselines');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, architectureId]);

  return (
    <div className={styles.section} data-testid="baselines-list">
      <div className={styles.sectionHeader}>
        <h3>Saved Baselines</h3>
        <button
          type="button"
          className={styles.refreshButton}
          onClick={load}
          disabled={loading}
          data-testid="baselines-list-refresh"
        >
          Refresh
        </button>
      </div>
      {error && <div className={styles.errorBanner}>{error}</div>}
      {loading && (
        <div className={styles.emptyMessage} data-testid="baselines-list-loading">
          Loading…
        </div>
      )}
      {!loading && !error && baselines.length === 0 && (
        <div className={styles.emptyMessage} data-testid="baselines-list-empty">
          No saved baselines yet for this architecture.
        </div>
      )}
      {!loading && !error && baselines.length > 0 && (
        <ul className={styles.list}>
          {baselines.map((b) => (
            <li
              key={b.id}
              className={styles.row}
              onClick={() => onSelect(b.id)}
              data-testid="baselines-list-item"
              data-baseline-id={b.id}
              data-selected={b.id === selectedBaselineId ? 'true' : 'false'}
            >
              <span className={`${styles.statusBadge} ${statusClass(b.status)}`}>
                {b.status}
              </span>
              <span className={styles.rowName}>{b.name || '(unnamed)'}</span>
              <span className={styles.rowDate}>{formatDate(b.created_at)}</span>
              {coverageInfo[b.id] && (
                <span
                  className={styles.rowDate}
                  data-testid={`baseline-coverage-${b.id}`}
                  title="Endpoint-inventory coverage of the source capture session (informational only; Activate is never blocked by coverage)"
                >
                  Coverage: {coverageInfo[b.id].inScopePct ?? '—'}% in scope ·{' '}
                  {coverageInfo[b.id].architecturePct ?? '—'}% architecture
                  {coverageInfo[b.id].overrideJustification
                    ? ' · started with coverage override'
                    : ''}
                </span>
              )}
              {(() => {
                const action = nextStatusAction(b.status);
                if (!action) return null;
                return (
                  <button
                    type="button"
                    className={styles.refreshButton}
                    disabled={statusActionInFlight === b.id}
                    onClick={(e) => void handleStatusAction(e, b, action.to)}
                    data-testid={`baseline-status-action-${b.id}`}
                  >
                    {statusActionInFlight === b.id ? 'Saving…' : action.label}
                  </button>
                );
              })()}
              <button
                type="button"
                className={styles.deleteButton}
                disabled={deletingId === b.id}
                onClick={(e) => void handleDelete(e, b)}
                data-testid={`baseline-delete-${b.id}`}
                title="Delete this baseline and any drift reports computed from it"
              >
                {deletingId === b.id ? 'Deleting…' : 'Delete'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
