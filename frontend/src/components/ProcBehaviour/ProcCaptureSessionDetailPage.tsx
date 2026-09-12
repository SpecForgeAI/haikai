/**
 * ProcCaptureSessionDetailPage — the detail surface for one stored-proc /
 * function behaviour capture session (Spec 3, 2026-09-09).
 *
 * Route: `/projects/:p/architectures/:a/proc-behaviour/capture-sessions/:sessionId`
 *
 * Sections, top to bottom:
 *   - header: name, status badge, the live phase line while a run is in
 *     flight (polling `/status` every {@link POLL_INTERVAL_MS}), Cancel;
 *   - the routine coverage panel (DEFAULT COLLAPSED);
 *   - scenarios & captures grouped by routine, each capture expandable into
 *     the five-dimension envelope viewer;
 *   - diagnostics (the honest reasons: non_compensatable, coverage_floor_unmet,
 *     excluded_by_user, not_possible, result_set_truncated, …);
 *   - actions: "Retry uncovered…" and "Save as baseline…".
 *
 * "Staleness is a signal, never a lock" (ruling 2026-08-09): the action
 * buttons are disabled ONLY while a run is actually in flight — never because
 * data looks stale, never because a freshness probe failed.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useProject } from '../../contexts/ProjectContext';
import { useActiveArchitectureId } from '../../contexts/ArchitectureContext';
import {
  ProcCapture,
  ProcCaptureSession,
  ProcDiagnostic,
  ProcRunProgress,
  ProcScenario,
  cancelProcCapture,
  describeProcError,
  excludeProcRoutine,
  getProcCaptureSession,
  getProcCaptureStatus,
  listDbRoutines,
  listProcCaptures,
  listProcDiagnostics,
  listProcScenarios,
  markProcRoutineNotPossible,
  retryUncoveredRoutines,
  routineLabel,
  saveProcBaseline,
} from '../../api/procBehaviourApi';
import { ProcEnvelopeViewer } from './ProcEnvelopeViewer';
import { ProcRoutineCoveragePanel } from './ProcRoutineCoveragePanel';
import { ProcRetryUncoveredModal } from './ProcRetryUncoveredModal';
import { ProcSaveAsBaselineModal } from './ProcSaveAsBaselineModal';
import { S0RestorePanel } from '../DashboardView/S0RestorePanel';
import styles from '../DashboardView/ApiBaselinesListPage.module.css';
import proc from './ProcBehaviour.module.css';

/** Status poll cadence while a run is in flight. */
export const POLL_INTERVAL_MS = 3000;

const IDLE_RUN: ProcRunProgress = {
  inFlight: false,
  phase: null,
  routineIndex: null,
  routineTotal: null,
  scenariosFired: null,
  capturesAccepted: null,
  findings: null,
  startedAt: null,
};

function statusClass(status: string): string {
  switch ((status ?? '').toLowerCase()) {
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
    case 'configured':
      return styles.statusConfigured;
    default:
      return styles.statusDraft;
  }
}

export const ProcCaptureSessionDetailPage: React.FC = () => {
  const project = useProject();
  const architectureId = useActiveArchitectureId();
  const params = useParams<{ sessionId?: string }>();
  const navigate = useNavigate();
  const sessionId = params.sessionId ?? null;

  const [session, setSession] = useState<ProcCaptureSession | null>(null);
  const [run, setRun] = useState<ProcRunProgress>(IDLE_RUN);
  const [scenarios, setScenarios] = useState<ProcScenario[]>([]);
  const [captures, setCaptures] = useState<ProcCapture[]>([]);
  const [diagnostics, setDiagnostics] = useState<ProcDiagnostic[]>([]);
  const [routineNames, setRoutineNames] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [actionNote, setActionNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [retryOpen, setRetryOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const pollRef = useRef<number | null>(null);
  const wasInFlightRef = useRef<boolean>(false);

  const projectId = project?.id ?? null;

  const loadAll = useCallback(async () => {
    if (!projectId || !architectureId || !sessionId) return;
    try {
      const [s, sc, cap, diag] = await Promise.all([
        getProcCaptureSession(projectId, architectureId, sessionId),
        listProcScenarios(projectId, architectureId, sessionId),
        listProcCaptures(projectId, architectureId, sessionId),
        listProcDiagnostics(projectId, architectureId, sessionId),
      ]);
      setSession(s);
      setScenarios(sc);
      setCaptures(cap);
      setDiagnostics(diag);
      setError(null);
    } catch (err) {
      setError(describeProcError(err));
    }
  }, [projectId, architectureId, sessionId]);

  // Routine names for the group headers. Fail-soft: without them the groups
  // fall back to the coverage summary's names, then to the raw id.
  useEffect(() => {
    if (!projectId || !architectureId) return;
    let cancelled = false;
    void (async () => {
      try {
        const rows = await listDbRoutines(projectId, architectureId);
        if (cancelled) return;
        const map: Record<string, string> = {};
        for (const r of rows) map[r.id] = routineLabel(r);
        setRoutineNames(map);
      } catch {
        /* names are a nicety, never a blocker */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, architectureId]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const pollStatus = useCallback(async () => {
    if (!projectId || !architectureId || !sessionId) return;
    try {
      const st = await getProcCaptureStatus(projectId, architectureId, sessionId);
      setRun(st.run);
      if (st.session) setSession(st.session);
      // EDGE detection (mirrors CaptureSessionDetailView): only the in-flight
      // -> idle transition pulls the full picture again, so a terminal
      // session does not re-fetch on every poll.
      const wasInFlight = wasInFlightRef.current;
      wasInFlightRef.current = st.run.inFlight;
      if (wasInFlight && !st.run.inFlight) await loadAll();
    } catch (err) {
      setError(describeProcError(err));
    }
  }, [projectId, architectureId, sessionId, loadAll]);

  // First status read, then poll while in flight.
  useEffect(() => {
    void pollStatus();
  }, [pollStatus]);

  useEffect(() => {
    if (!run.inFlight) {
      if (pollRef.current !== null) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }
    if (pollRef.current !== null) window.clearInterval(pollRef.current);
    pollRef.current = window.setInterval(() => {
      void pollStatus();
    }, POLL_INTERVAL_MS);
    return () => {
      if (pollRef.current !== null) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [run.inFlight, pollStatus]);

  const capturesByScenario = useMemo(() => {
    const map: Record<string, ProcCapture[]> = {};
    for (const c of captures) {
      (map[c.scenarioId] ??= []).push(c);
    }
    return map;
  }, [captures]);

  const groups = useMemo(() => {
    const byRoutine: Record<string, ProcScenario[]> = {};
    for (const s of scenarios) {
      (byRoutine[s.routineId] ??= []).push(s);
    }
    const coverageNames: Record<string, string> = {};
    for (const r of session?.coverageSummary?.perRoutine ?? []) {
      if (r.routineName) coverageNames[r.routineId] = r.routineName;
    }
    return Object.entries(byRoutine).map(([routineId, list]) => ({
      routineId,
      label: routineNames[routineId] ?? coverageNames[routineId] ?? routineId,
      scenarios: list,
    }));
  }, [scenarios, routineNames, session]);

  const notExercised = useMemo(
    () =>
      (session?.coverageSummary?.perRoutine ?? []).filter(
        (r) => r.bucket === 'not_exercised',
      ),
    [session],
  );

  const toggleExpanded = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const handleCancel = useCallback(async () => {
    if (!projectId || !architectureId || !sessionId) return;
    setBusy(true);
    try {
      await cancelProcCapture(projectId, architectureId, sessionId);
      setActionNote(run.inFlight ? 'Cancellation requested.' : 'Stranded run marked cancelled.');
      await pollStatus();
      if (!run.inFlight) await loadAll();
    } catch (err) {
      setError(describeProcError(err));
    } finally {
      setBusy(false);
    }
  }, [projectId, architectureId, sessionId, pollStatus, loadAll, run.inFlight]);

  const handleRetry = useCallback(
    async (routineIds: string[]) => {
      if (!projectId || !architectureId || !sessionId) return;
      setBusy(true);
      try {
        await retryUncoveredRoutines(projectId, architectureId, sessionId, routineIds);
        setActionNote(
          `Re-attempting ${routineIds.length} routine${routineIds.length === 1 ? '' : 's'}.`,
        );
        setRetryOpen(false);
        await pollStatus();
      } catch (err) {
        setError(describeProcError(err));
      } finally {
        setBusy(false);
      }
    },
    [projectId, architectureId, sessionId, pollStatus],
  );

  const handleNotPossible = useCallback(
    async (routineId: string, reason: string) => {
      if (!projectId || !architectureId || !sessionId) return;
      try {
        await markProcRoutineNotPossible(
          projectId,
          architectureId,
          sessionId,
          routineId,
          reason,
        );
        setActionNote(`Recorded "not possible" for ${routineNames[routineId] ?? routineId}.`);
        await loadAll();
      } catch (err) {
        setError(describeProcError(err));
      }
    },
    [projectId, architectureId, sessionId, routineNames, loadAll],
  );

  const handleExclude = useCallback(
    async (routineId: string, reason: string) => {
      if (!projectId || !architectureId || !sessionId) return;
      try {
        await excludeProcRoutine(projectId, architectureId, sessionId, routineId, reason);
        setActionNote(`Excluded ${routineNames[routineId] ?? routineId} with a reason.`);
        await loadAll();
      } catch (err) {
        setError(describeProcError(err));
      }
    },
    [projectId, architectureId, sessionId, routineNames, loadAll],
  );

  const handleSaveBaseline = useCallback(
    async (name: string, pin: boolean) => {
      if (!projectId || !architectureId || !sessionId) return;
      setBusy(true);
      setSaveError(null);
      try {
        const res = await saveProcBaseline(
          projectId,
          architectureId,
          sessionId,
          name,
          pin,
        );
        setSaveOpen(false);
        navigate(
          `/projects/${projectId}/architectures/${architectureId}` +
            `/proc-behaviour/baselines/${res.baseline.id}`,
        );
      } catch (err) {
        setSaveError(describeProcError(err));
      } finally {
        setBusy(false);
      }
    },
    [projectId, architectureId, sessionId, navigate],
  );

  if (!project || !architectureId) {
    return (
      <div className={styles.detailContainer} data-testid="proc-capture-session-detail-page">
        <div className={styles.emptyMessage}>
          Select a project and architecture to view this proc capture session.
        </div>
      </div>
    );
  }

  if (!sessionId) {
    return (
      <div className={styles.detailContainer} data-testid="proc-capture-session-detail-page">
        <div className={styles.emptyMessage}>No session id in the URL.</div>
      </div>
    );
  }

  return (
    <div
      className={styles.detailContainer}
      data-testid="proc-capture-session-detail-page"
      data-session-id={sessionId}
    >
      <div className={styles.detailHeader}>
        <button
          type="button"
          className={styles.backButton}
          onClick={() =>
            navigate(`/projects/${project.id}/architectures/${architectureId}/api-behaviour`)
          }
          data-testid="proc-session-back"
        >
          ← Back
        </button>
        <h2 data-testid="proc-session-name">{session?.name || 'Proc capture session'}</h2>
        <span
          className={`${styles.statusBadge} ${statusClass(session?.status ?? 'draft')}`}
          data-testid="proc-session-status"
        >
          {session?.status ?? 'draft'}
        </span>
        {(run.inFlight || session?.status === 'running') && (
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={() => void handleCancel()}
            disabled={busy}
            data-testid="proc-session-cancel"
          >
            {run.inFlight ? 'Cancel run' : 'Stop run'}
          </button>
        )}
      </div>

      {!run.inFlight && session?.status === 'running' && (
        <div className={styles.detailSection} data-testid="proc-session-stranded">
          This session says <strong>running</strong>, but no capture run is in flight on the
          validation service — it was restarted while the run was starting, so nothing will
          finish this row on its own. Stop it to mark it cancelled; you can then delete it
          from the list or start a new capture.
        </div>
      )}

      {run.inFlight && (
        <div className={styles.detailSection} data-testid="proc-session-phase">
          Run in flight — {run.phase ?? 'working'}
          {run.routineTotal !== null && (
            <> · routine {run.routineIndex ?? 0} of {run.routineTotal}</>
          )}
          {run.scenariosFired !== null && <> · {run.scenariosFired} scenarios fired</>}
          {run.capturesAccepted !== null && <> · {run.capturesAccepted} captures accepted</>}
          {run.findings ? <> · {run.findings} findings</> : null}
        </div>
      )}

      {error && (
        <div className={styles.errorBanner} data-testid="proc-session-error">
          {error}
        </div>
      )}
      {actionNote && (
        <div className={styles.detailSection} data-testid="proc-session-note">
          {actionNote}
        </div>
      )}

      <ProcRoutineCoveragePanel summary={session?.coverageSummary ?? null} />

      {/* S0 restore (2026-09-12): a proc capture that left residue dirties the
          source exactly as an API capture would, and this page had no way to
          put it back. Same panel as the API session page; no receipt session. */}
      {session && !run.inFlight && projectId && architectureId && (
        <S0RestorePanel
          projectId={projectId}
          architectureId={architectureId}
          session={{ id: null, db_config_redacted_json: session.dbConfigRedacted }}
        />
      )}

      <div className={styles.actionRow}>
        <button
          type="button"
          className={styles.secondaryButton}
          onClick={() => setRetryOpen(true)}
          disabled={run.inFlight}
          title={
            run.inFlight
              ? 'A capture run is in flight'
              : 'Re-attempt the routines that did not meet their coverage floor, or record why they cannot be exercised'
          }
          data-testid="proc-session-retry-uncovered"
        >
          Retry uncovered…
        </button>
        <button
          type="button"
          className={styles.primaryButton}
          onClick={() => {
            setSaveError(null);
            setSaveOpen(true);
          }}
          disabled={run.inFlight}
          title={run.inFlight ? 'A capture run is in flight' : 'Promote the accepted captures into a durable baseline'}
          data-testid="proc-session-save-baseline"
        >
          Save as baseline…
        </button>
      </div>

      <div className={styles.detailSection} data-testid="proc-session-scenarios">
        <h3>Scenarios &amp; captures</h3>
        {groups.length === 0 && (
          <div className={styles.emptyMessage} data-testid="proc-session-scenarios-empty">
            No scenarios recorded for this session yet.
          </div>
        )}
        {groups.map((g) => (
          <div
            className={proc.routineGroup}
            key={g.routineId}
            data-testid="proc-session-routine-group"
            data-routine-id={g.routineId}
          >
            <div className={proc.routineGroupHeader}>
              <span className={proc.mono}>{g.label}</span>
              <span className={`${proc.flag} ${proc.flagInfo}`}>
                {g.scenarios.length} scenario{g.scenarios.length === 1 ? '' : 's'}
              </span>
            </div>
            {g.scenarios.map((s) => {
              const caps = capturesByScenario[s.id] ?? [];
              return (
                <div
                  className={proc.scenarioRow}
                  key={s.id}
                  data-testid="proc-session-scenario-row"
                  data-scenario-id={s.id}
                  data-status={s.status}
                >
                  <div className={proc.scenarioRowHeader}>
                    <span className={proc.mono}>{s.scenarioName}</span>
                    <span className={`${proc.flag} ${proc.flagInfo}`}>{s.scenarioType}</span>
                    <span className={`${proc.flag} ${proc.flagMuted}`}>{s.status}</span>
                    {s.generationSource && (
                      <span className={`${proc.flag} ${proc.flagMuted}`}>
                        {s.generationSource}
                      </span>
                    )}
                    <span>
                      {caps.length} capture{caps.length === 1 ? '' : 's'}
                    </span>
                    {caps.length > 0 && (
                      <button
                        type="button"
                        className={proc.linkButton}
                        onClick={() => toggleExpanded(s.id)}
                        aria-expanded={expanded.has(s.id)}
                        data-testid={`proc-scenario-toggle-${s.id}`}
                      >
                        {expanded.has(s.id) ? 'Hide envelope' : 'Show envelope'}
                      </button>
                    )}
                  </div>
                  {s.notes && <div className={proc.hint}>{s.notes}</div>}
                  {expanded.has(s.id) &&
                    caps.map((c) => (
                      <div key={c.id} data-testid="proc-session-capture" data-capture-id={c.id}>
                        <div className={proc.hint}>
                          Attempt {c.attemptNumber ?? 1} · bracket{' '}
                          {c.bracketOutcome ?? 'unknown'} ·{' '}
                          {c.accepted ? 'accepted' : 'not accepted'}
                          {c.durationMs !== null ? ` · ${c.durationMs} ms` : ''}
                          {c.errorType ? ` · ${c.errorType}` : ''}
                        </div>
                        <ProcEnvelopeViewer
                          envelope={c.envelope}
                          stateDelta={c.stateDelta}
                          volatileCells={c.volatileCells}
                          testId={`proc-envelope-${c.id}`}
                        />
                      </div>
                    ))}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <div className={styles.detailSection} data-testid="proc-session-diagnostics">
        <h3>Diagnostics</h3>
        {diagnostics.length === 0 ? (
          <div className={styles.emptyMessage} data-testid="proc-session-diagnostics-empty">
            No diagnostics recorded.
          </div>
        ) : (
          <ul className={styles.list}>
            {diagnostics.map((d) => (
              <li
                key={d.id}
                className={styles.row}
                data-testid="proc-session-diagnostic"
                data-diagnostic-type={d.diagnosticType}
              >
                <span className={`${proc.flag} ${proc.flagWarn}`}>{d.diagnosticType}</span>
                <span className={styles.rowName}>{d.message}</span>
                {d.routineId && (
                  <span className={styles.rowDate}>
                    {routineNames[d.routineId] ?? d.routineId}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {retryOpen && (
        <ProcRetryUncoveredModal
          rows={notExercised}
          busy={busy}
          onClose={() => setRetryOpen(false)}
          onRetry={(ids) => void handleRetry(ids)}
          onNotPossible={(id, reason) => void handleNotPossible(id, reason)}
          onExclude={(id, reason) => void handleExclude(id, reason)}
        />
      )}
      {saveOpen && (
        <ProcSaveAsBaselineModal
          defaultName={session?.name ? `${session.name} baseline` : 'Proc behaviour baseline'}
          busy={busy}
          error={saveError}
          onClose={() => setSaveOpen(false)}
          onSave={(name, pin) => void handleSaveBaseline(name, pin)}
        />
      )}
    </div>
  );
};

export default ProcCaptureSessionDetailPage;
