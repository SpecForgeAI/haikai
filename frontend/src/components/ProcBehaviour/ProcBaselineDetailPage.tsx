/**
 * ProcBaselineDetailPage — read-only detail for one pinned/draft proc
 * behaviour baseline (Spec 3, 2026-09-09).
 *
 * Route: `/projects/:p/architectures/:a/proc-behaviour/baselines/:baselineId`
 *
 * The baseline IS the oracle the workbench loop and the DB-plane execution
 * check replay, so this page shows what would be replayed: the header facts
 * (pin state, routine/scenario counts, the S0 fingerprint the capture ran
 * against, the content hash) and every item grouped by routine — inputs,
 * exit outcome, the expected envelope in the same viewer the session page
 * uses, and a loud stale badge when the routine's body hash has moved since
 * the capture.
 *
 * A Pin button appears when the baseline is not pinned; pinning supersedes
 * the previous pinned baseline of the kind.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useProject } from '../../contexts/ProjectContext';
import { useActiveArchitectureId } from '../../contexts/ArchitectureContext';
import {
  ProcBaseline,
  ProcBaselineItem,
  describeProcError,
  getProcBaseline,
  listDbRoutines,
  listProcBaselineItems,
  pinProcBaseline,
  routineLabel,
} from '../../api/procBehaviourApi';
import { ProcEnvelopeViewer } from './ProcEnvelopeViewer';
import styles from '../DashboardView/ApiBaselinesListPage.module.css';
import proc from './ProcBehaviour.module.css';

function describeFingerprint(fp: Record<string, unknown> | null): string {
  if (!fp) return 'not recorded';
  const candidate =
    fp.fingerprint ?? fp.hash ?? fp.digest ?? fp.s0_fingerprint ?? fp.snapshot_id;
  if (typeof candidate === 'string' && candidate.length > 0) return candidate;
  return 'recorded';
}

export const ProcBaselineDetailPage: React.FC = () => {
  const project = useProject();
  const architectureId = useActiveArchitectureId();
  const params = useParams<{ baselineId?: string }>();
  const navigate = useNavigate();
  const baselineId = params.baselineId ?? null;

  const [baseline, setBaseline] = useState<ProcBaseline | null>(null);
  const [items, setItems] = useState<ProcBaselineItem[]>([]);
  const [routineNames, setRoutineNames] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const projectId = project?.id ?? null;

  const load = useCallback(async () => {
    if (!projectId || !architectureId || !baselineId) return;
    try {
      const [b, it] = await Promise.all([
        getProcBaseline(projectId, architectureId, baselineId),
        listProcBaselineItems(projectId, architectureId, baselineId),
      ]);
      setBaseline(b);
      setItems(it);
      setError(null);
    } catch (err) {
      setError(describeProcError(err));
    }
  }, [projectId, architectureId, baselineId]);

  useEffect(() => {
    void load();
  }, [load]);

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

  const groups = useMemo(() => {
    const byRoutine: Record<string, ProcBaselineItem[]> = {};
    for (const i of items) (byRoutine[i.routineId] ??= []).push(i);
    return Object.entries(byRoutine).map(([routineId, list]) => ({
      routineId,
      label: routineNames[routineId] ?? routineId,
      items: list,
    }));
  }, [items, routineNames]);

  const handlePin = useCallback(async () => {
    if (!projectId || !architectureId || !baselineId) return;
    setBusy(true);
    try {
      const pinned = await pinProcBaseline(projectId, architectureId, baselineId);
      setBaseline(pinned);
      await load();
    } catch (err) {
      setError(describeProcError(err));
    } finally {
      setBusy(false);
    }
  }, [projectId, architectureId, baselineId, load]);

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  if (!project || !architectureId) {
    return (
      <div className={styles.detailContainer} data-testid="proc-baseline-detail-page">
        <div className={styles.emptyMessage}>
          Select a project and architecture to view this proc baseline.
        </div>
      </div>
    );
  }

  if (!baselineId) {
    return (
      <div className={styles.detailContainer} data-testid="proc-baseline-detail-page">
        <div className={styles.emptyMessage}>No baseline id in the URL.</div>
      </div>
    );
  }

  const staleCount = items.filter((i) => i.stale).length;

  return (
    <div
      className={styles.detailContainer}
      data-testid="proc-baseline-detail-page"
      data-baseline-id={baselineId}
    >
      <div className={styles.detailHeader}>
        <button
          type="button"
          className={styles.backButton}
          onClick={() =>
            navigate(`/projects/${project.id}/architectures/${architectureId}/api-behaviour`)
          }
          data-testid="proc-baseline-back"
        >
          ← Back
        </button>
        <h2 data-testid="proc-baseline-name">{baseline?.name || 'Proc behaviour baseline'}</h2>
        <span
          className={`${styles.statusBadge} ${
            baseline?.status === 'pinned' ? styles.statusActive : styles.statusDraft
          }`}
          data-testid="proc-baseline-status"
        >
          {baseline?.status ?? 'draft'}
        </span>
        {baseline && baseline.status !== 'pinned' && (
          <button
            type="button"
            className={styles.primaryButton}
            onClick={() => void handlePin()}
            disabled={busy}
            data-testid="proc-baseline-pin"
            title="Pin this baseline as the oracle for this kind (supersedes the current pinned baseline)"
          >
            {busy ? 'Pinning…' : 'Pin baseline'}
          </button>
        )}
      </div>

      {error && (
        <div className={styles.errorBanner} data-testid="proc-baseline-error">
          {error}
        </div>
      )}

      <div className={styles.detailSection} data-testid="proc-baseline-facts">
        <div className={styles.detailRow}>
          <span className={styles.detailKey}>Routines:</span>{' '}
          {baseline?.routineCount ?? groups.length}
        </div>
        <div className={styles.detailRow}>
          <span className={styles.detailKey}>Scenarios:</span>{' '}
          {baseline?.scenarioCount ?? items.length}
        </div>
        <div className={styles.detailRow}>
          <span className={styles.detailKey}>S0 fingerprint:</span>{' '}
          <span className={proc.mono} data-testid="proc-baseline-s0">
            {describeFingerprint(baseline?.s0Fingerprint ?? null)}
          </span>
        </div>
        <div className={styles.detailRow}>
          <span className={styles.detailKey}>Content hash:</span>{' '}
          <span className={proc.mono} data-testid="proc-baseline-content-hash">
            {baseline?.contentHash ?? '—'}
          </span>
        </div>
        {staleCount > 0 && (
          <div className={styles.detailRow} data-testid="proc-baseline-stale-count">
            <span className={`${proc.flag} ${proc.flagWarn}`}>
              {staleCount} stale item{staleCount === 1 ? '' : 's'}
            </span>
            The routine body has changed since these items were captured —
            re-capture before trusting them as the oracle.
          </div>
        )}
      </div>

      <div className={styles.detailSection} data-testid="proc-baseline-items">
        <h3>Baseline items</h3>
        {groups.length === 0 && (
          <div className={styles.emptyMessage} data-testid="proc-baseline-items-empty">
            This baseline has no items.
          </div>
        )}
        {groups.map((g) => (
          <div
            className={proc.routineGroup}
            key={g.routineId}
            data-testid="proc-baseline-routine-group"
            data-routine-id={g.routineId}
          >
            <div className={proc.routineGroupHeader}>
              <span className={proc.mono}>{g.label}</span>
              <span className={`${proc.flag} ${proc.flagInfo}`}>
                {g.items.length} item{g.items.length === 1 ? '' : 's'}
              </span>
            </div>
            {g.items.map((i) => (
              <div
                className={proc.scenarioRow}
                key={i.id}
                data-testid="proc-baseline-item-row"
                data-item-id={i.id}
                data-stale={i.stale ? 'true' : 'false'}
              >
                <div className={proc.scenarioRowHeader}>
                  <span className={proc.mono}>{i.scenarioName}</span>
                  <span className={`${proc.flag} ${proc.flagInfo}`}>{i.scenarioType}</span>
                  <span className={`${proc.flag} ${proc.flagMuted}`}>
                    exit: {i.exitOutcome ?? 'unknown'}
                  </span>
                  {i.stale && (
                    <span
                      className={`${proc.flag} ${proc.flagWarn}`}
                      data-testid={`proc-baseline-stale-${i.id}`}
                      title={i.staleReason ?? 'The routine body hash has changed since capture'}
                    >
                      stale
                    </span>
                  )}
                  <button
                    type="button"
                    className={proc.linkButton}
                    onClick={() => toggle(i.id)}
                    aria-expanded={expanded.has(i.id)}
                    data-testid={`proc-baseline-item-toggle-${i.id}`}
                  >
                    {expanded.has(i.id) ? 'Hide expected envelope' : 'Show expected envelope'}
                  </button>
                </div>
                {i.stale && i.staleReason && (
                  <div className={proc.hint} data-testid={`proc-baseline-stale-reason-${i.id}`}>
                    {i.staleReason}
                  </div>
                )}
                {i.inputs.length > 0 && (
                  <div className={proc.hint}>
                    Inputs:{' '}
                    {i.inputs
                      .map((p) => `${p.name}=${p.isNull ? 'NULL' : String(p.value)}`)
                      .join(', ')}
                  </div>
                )}
                {expanded.has(i.id) && (
                  <ProcEnvelopeViewer
                    envelope={i.expectedEnvelope}
                    stateDelta={i.stateDelta}
                    volatileCells={i.volatileCells}
                    testId={`proc-baseline-envelope-${i.id}`}
                  />
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
};

export default ProcBaselineDetailPage;
