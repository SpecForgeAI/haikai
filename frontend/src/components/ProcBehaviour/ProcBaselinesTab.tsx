/**
 * ProcBaselinesTab — the "Stored procs and functions" surface on the Live
 * behaviour page (Stored Proc & Function Behaviour Program, Spec 3, decision
 * 19: "proc capture is a second kind on the Live behaviour surface").
 *
 * Two lists, same stylesheet and row shape as the API behaviour tab:
 *   - proc capture sessions, newest first, with a status badge and the
 *     coverage counts off `coverage_summary_json`;
 *   - proc baselines, with a pinned badge and routine/scenario counts.
 *
 * The header carries the "Start proc capture" button which opens
 * {@link StartProcCaptureSessionWizard}. Nothing here depends on an API
 * capture session, an OAS inventory, a base URL or API auth — the proc path
 * is DB-native and independent by doctrine.
 *
 * "Staleness is a signal, never a lock": no action button on this surface is
 * ever disabled by a freshness flag; only an in-flight fetch disables its own
 * Refresh control.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ProcBaseline,
  ProcCaptureSession,
  deleteProcCaptureSession,
  describeProcError,
  listProcBaselines,
  listProcCaptureSessions,
} from '../../api/procBehaviourApi';
import { StartProcCaptureSessionWizard } from './StartProcCaptureSessionWizard';
import styles from '../DashboardView/ApiBaselinesListPage.module.css';
import proc from './ProcBehaviour.module.css';

export interface ProcBaselinesTabProps {
  projectId: string;
  architectureId: string | null;
}

function sessionStatusClass(status: string): string {
  switch ((status ?? '').toLowerCase()) {
    case 'draft':
      return styles.statusDraft;
    case 'configured':
      return styles.statusConfigured;
    case 'running':
      return styles.statusRunning;
    case 'completed':
      return styles.statusCompleted;
    case 'completed_with_findings':
      return styles.statusRunning;
    case 'failed':
      return styles.statusFailed;
    case 'cancelled':
      return styles.statusCancelled;
    default:
      return styles.statusDraft;
  }
}

function baselineStatusClass(status: string): string {
  switch ((status ?? '').toLowerCase()) {
    case 'pinned':
      return styles.statusActive;
    case 'superseded':
      return styles.statusArchived;
    default:
      return styles.statusDraft;
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function coverageLine(session: ProcCaptureSession): string | null {
  const c = session.coverageSummary;
  if (!c) return null;
  return (
    `${c.verified}/${c.routinesInScope} verified · ` +
    `${c.notExercised} not exercised · ` +
    `${c.unverifiable} unverifiable · ` +
    `${c.excluded} excluded`
  );
}

export const ProcBaselinesTab: React.FC<ProcBaselinesTabProps> = ({
  projectId,
  architectureId,
}) => {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<ProcCaptureSession[]>([]);
  const [baselines, setBaselines] = useState<ProcBaseline[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!architectureId) {
      setSessions([]);
      setBaselines([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [s, b] = await Promise.all([
        listProcCaptureSessions(projectId, architectureId),
        listProcBaselines(projectId, architectureId),
      ]);
      // Newest first — the server orders, but a defensive sort keeps the
      // contract visible here even if a proxy reorders.
      setSessions(
        [...s].sort((a, z) => (z.createdAt ?? '').localeCompare(a.createdAt ?? '')),
      );
      setBaselines(b);
    } catch (err) {
      setError(describeProcError(err));
    } finally {
      setLoading(false);
    }
  }, [projectId, architectureId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Per-row delete (2026-09-12) -- the API-behaviour list had it, this one
  // did not. Mirrors that list: confirm, delete, reload; a running session
  // is refused by the server (409) and the button is disabled for it here.
  const handleDelete = useCallback(
    async (e: React.MouseEvent, session: ProcCaptureSession) => {
      e.stopPropagation();
      if (!architectureId) return;
      const name = session.name || '(unnamed)';
      const message =
        `Delete proc capture session "${name}"?\n\n` +
        'This removes the session and all its scenarios, captured invocations and diagnostics. ' +
        'Baselines saved from it are kept.';
      if (!window.confirm(message)) return;
      setDeletingId(session.id);
      setError(null);
      try {
        await deleteProcCaptureSession(projectId, architectureId, session.id);
        await load();
      } catch (err) {
        setError(describeProcError(err));
      } finally {
        setDeletingId(null);
      }
    },
    [projectId, architectureId, load],
  );

  const goSession = useCallback(
    (sessionId: string) => {
      if (!architectureId) return;
      navigate(
        `/projects/${projectId}/architectures/${architectureId}` +
          `/proc-behaviour/capture-sessions/${sessionId}`,
      );
    },
    [projectId, architectureId, navigate],
  );

  const goBaseline = useCallback(
    (baselineId: string) => {
      if (!architectureId) return;
      navigate(
        `/projects/${projectId}/architectures/${architectureId}` +
          `/proc-behaviour/baselines/${baselineId}`,
      );
    },
    [projectId, architectureId, navigate],
  );

  if (!architectureId) {
    return (
      <div className={styles.emptyMessage} data-testid="proc-baselines-tab-no-arch">
        Select an architecture to capture stored-procedure behaviour.
      </div>
    );
  }

  return (
    <div data-testid="proc-baselines-tab">
      <div className={styles.header}>
        <h2>Stored procs and functions</h2>
        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={() => setWizardOpen(true)}
            data-testid="proc-start-capture-button"
            title="Capture the live behaviour of stored procedures and functions against the current-state database at S0"
          >
            Start proc capture
          </button>
        </div>
      </div>
      <p className={proc.hint}>
        Captured against the database directly — no base URL, no API
        credentials. The DB scan pins S0; every scenario fires inside the
        derived compensation bracket, so the database is back at S0 when the
        run ends.
      </p>
      {error && (
        <div className={styles.errorBanner} data-testid="proc-baselines-tab-error">
          {error}
        </div>
      )}

      <div className={styles.section} data-testid="proc-capture-sessions-list">
        <div className={styles.sectionHeader}>
          <h3>Proc capture sessions</h3>
          <button
            type="button"
            className={styles.refreshButton}
            onClick={() => void load()}
            disabled={loading}
            data-testid="proc-capture-sessions-refresh"
          >
            Refresh
          </button>
        </div>
        {loading && sessions.length === 0 && (
          <div className={styles.emptyMessage} data-testid="proc-capture-sessions-loading">
            Loading…
          </div>
        )}
        {!loading && sessions.length === 0 && (
          <div className={styles.emptyMessage} data-testid="proc-capture-sessions-empty">
            No proc capture sessions yet for this architecture.
          </div>
        )}
        {sessions.length > 0 && (
          <ul className={styles.list}>
            {sessions.map((s) => {
              const cov = coverageLine(s);
              return (
                <li
                  key={s.id}
                  className={styles.row}
                  onClick={() => goSession(s.id)}
                  data-testid="proc-capture-session-row"
                  data-session-id={s.id}
                >
                  <span className={`${styles.statusBadge} ${sessionStatusClass(s.status)}`}>
                    {s.status}
                  </span>
                  <span className={styles.rowName}>{s.name || '(unnamed)'}</span>
                  <span className={styles.rowDate}>{formatDate(s.createdAt)}</span>
                  {cov && (
                    <span
                      className={styles.rowDate}
                      data-testid={`proc-session-coverage-${s.id}`}
                    >
                      {cov}
                    </span>
                  )}
                  <button
                    type="button"
                    className={styles.deleteButton}
                    disabled={deletingId === s.id || s.status === 'running'}
                    onClick={(e) => void handleDelete(e, s)}
                    data-testid={`proc-capture-session-delete-${s.id}`}
                    title={
                      s.status === 'running'
                        ? 'Cancel the running capture before deleting this session'
                        : 'Delete this capture session, its scenarios, captures and diagnostics (saved baselines are kept)'
                    }
                  >
                    {deletingId === s.id ? 'Deleting…' : 'Delete'}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className={styles.section} data-testid="proc-baselines-list">
        <div className={styles.sectionHeader}>
          <h3>Proc behaviour baselines</h3>
        </div>
        {!loading && baselines.length === 0 && (
          <div className={styles.emptyMessage} data-testid="proc-baselines-empty">
            No proc behaviour baselines saved yet.
          </div>
        )}
        {baselines.length > 0 && (
          <ul className={styles.list}>
            {baselines.map((b) => (
              <li
                key={b.id}
                className={styles.row}
                onClick={() => goBaseline(b.id)}
                data-testid="proc-baseline-row"
                data-baseline-id={b.id}
              >
                <span className={`${styles.statusBadge} ${baselineStatusClass(b.status)}`}>
                  {b.status === 'pinned' ? 'pinned' : b.status}
                </span>
                <span className={styles.rowName}>{b.name || '(unnamed)'}</span>
                <span className={styles.rowDate}>
                  {b.routineCount ?? 0} routine{b.routineCount === 1 ? '' : 's'} ·{' '}
                  {b.scenarioCount ?? 0} scenario{b.scenarioCount === 1 ? '' : 's'}
                </span>
                <span className={styles.rowDate}>{formatDate(b.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <StartProcCaptureSessionWizard
        open={wizardOpen}
        projectId={projectId}
        architectureId={architectureId}
        onClose={() => setWizardOpen(false)}
        onStarted={(session) => {
          setWizardOpen(false);
          goSession(session.id);
        }}
      />
    </div>
  );
};

export default ProcBaselinesTab;
