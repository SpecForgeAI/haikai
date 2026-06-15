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
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
