/**
 * CaptureSessionsList Component
 *
 * Spec: 2026-05-15 API Behaviour Baseline Capture Service -- Task Group 8
 *
 * Stripped-down list of capture sessions for the active project +
 * architecture (most recent first). Mirrors the
 * `DiscoveryRunsList.tsx` layout / status-badge pattern so the surface
 * feels native alongside the discovery sibling page.
 *
 * Click a row -> invoke `onSelect(sessionId)` (the parent decides whether
 * to navigate to the detail URL or just update local state).
 *
 * Per-spec: list lookups fetched fresh from AMS — no source-side cache layer.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ApiBehaviourCaptureSessionDto,
  deleteCaptureSession,
  listCaptureSessions,
} from '../../api/apiBehaviourClient';
import styles from './ApiBaselinesListPage.module.css';

export interface CaptureSessionsListProps {
  projectId: string;
  architectureId: string | null;
  selectedSessionId?: string | null;
  onSelect: (sessionId: string) => void;
}

function statusClass(status: string | null | undefined): string {
  switch ((status ?? '').toLowerCase()) {
    case 'draft':
      return styles.statusDraft;
    case 'configured':
      return styles.statusConfigured;
    case 'running':
      return styles.statusRunning;
    case 'completed':
      return styles.statusCompleted;
    case 'failed':
      return styles.statusFailed;
    case 'cancelled':
      return styles.statusCancelled;
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

export const CaptureSessionsList: React.FC<CaptureSessionsListProps> = ({
  projectId,
  architectureId,
  selectedSessionId,
  onSelect,
}) => {
  const [sessions, setSessions] = useState<ApiBehaviourCaptureSessionDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** The session id whose DELETE is in flight (disables that row's button). */
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!architectureId) {
      setSessions([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await listCaptureSessions(projectId, architectureId);
      setSessions(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load capture sessions');
    } finally {
      setLoading(false);
    }
  }, [projectId, architectureId]);

  /**
   * Delete a capture session and all its captured request/response rows (the
   * server cascades scenarios / operations / diagnostics). Click must NOT
   * bubble to the row's onSelect. A confirm guards the (irreversible) action;
   * an in-progress session adds an extra warning line. Saved baselines created
   * from the session are intentionally KEPT (the server does not cascade them).
   */
  const handleDelete = useCallback(
    async (e: React.MouseEvent, session: ApiBehaviourCaptureSessionDto) => {
      e.stopPropagation();
      if (!architectureId) return;
      const name = session.name || session.environment_name || '(unnamed)';
      const running = ['running', 'configured'].includes((session.status ?? '').toLowerCase());
      const message =
        `Delete capture session "${name}"?\n\n` +
        'This removes the session and all its captured request/response rows. ' +
        'Saved baselines created from it are kept.' +
        (running ? '\n\nThis session is still in progress — deleting it now will stop tracking that run.' : '');
      if (!window.confirm(message)) return;
      setDeletingId(session.id);
      setError(null);
      try {
        await deleteCaptureSession(projectId, architectureId, session.id);
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to delete capture session');
      } finally {
        setDeletingId(null);
      }
    },
    [projectId, architectureId, load],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!architectureId) {
        setSessions([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const res = await listCaptureSessions(projectId, architectureId);
        if (!cancelled) setSessions(res);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load capture sessions');
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
    <div className={styles.section} data-testid="capture-sessions-list">
      <div className={styles.sectionHeader}>
        <h3>Capture Sessions</h3>
        <button
          type="button"
          className={styles.refreshButton}
          onClick={load}
          disabled={loading}
          data-testid="capture-sessions-list-refresh"
        >
          Refresh
        </button>
      </div>
      {error && <div className={styles.errorBanner}>{error}</div>}
      {loading && (
        <div className={styles.emptyMessage} data-testid="capture-sessions-list-loading">
          Loading…
        </div>
      )}
      {!loading && !error && sessions.length === 0 && (
        <div className={styles.emptyMessage} data-testid="capture-sessions-list-empty">
          No capture sessions yet for this architecture.
        </div>
      )}
      {!loading && !error && sessions.length > 0 && (
        <ul className={styles.list}>
          {sessions.map((s) => (
            <li
              key={s.id}
              className={styles.row}
              onClick={() => onSelect(s.id)}
              data-testid="capture-sessions-list-item"
              data-session-id={s.id}
              data-selected={s.id === selectedSessionId ? 'true' : 'false'}
            >
              <span className={`${styles.statusBadge} ${statusClass(s.status)}`}>
                {s.status}
              </span>
              <span className={styles.rowName}>
                {s.name || s.environment_name || '(unnamed)'}
              </span>
              <span className={styles.rowDate}>{formatDate(s.created_at)}</span>
              <button
                type="button"
                className={styles.deleteButton}
                disabled={deletingId === s.id}
                onClick={(e) => void handleDelete(e, s)}
                data-testid={`capture-session-delete-${s.id}`}
                title="Delete this capture session and its captured rows"
              >
                {deletingId === s.id ? 'Deleting…' : 'Delete'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
