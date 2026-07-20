/**
 * MigrationExecutionRail — Phase 1b (2026-07-20).
 *
 * The plan screen's bottom rail: turns "specs ready" into "the plane is
 * running" without leaving the screen. Tier-flexible by construction — cards
 * derive from the PLAN'S stories (a DB-only migration shows one card), never a
 * hardcoded three.
 *
 * Presentational: the parent (review workspace) computes plane rollups, polls
 * the run, and owns every side-effect. The gateway's phased executor (Spec W)
 * remains authoritative for gating + sequencing; this rail is its view.
 *
 *   - Absolute spec gate (user doctrine, option 2): Start only when EVERY
 *     plane's stories are satisfied (spec generated / warnings-reviewed /
 *     manual-ready). Unsatisfied cards list their blocking stories — click one
 *     to open it in the tree and resolve (fix upstream / regenerate / manual
 *     spec + Mark ready). No exclusions mechanism exists.
 *   - awaiting_approval renders the pause banner with a PLAIN Approve &
 *     continue (no forced-evidence gate — trust the reviewer).
 *   - A blocked resume (unclean data parity) surfaces the reasons and the
 *     explicit BREAK-GLASS action (resume with override) with its consequence
 *     stated: downstream API reconcile runs under known data divergence.
 */

import React from 'react';
import styles from './MigrationBookOfWork.module.css';

/** Plane vocabulary — mirrors the gateway executor's planeForWorkstream.
 * The gateway (migrationExecutionDriver.ts) stays authoritative; this mirror
 * only drives DISPLAY grouping. */
const DB_WORKSTREAMS = new Set([
  'target_database_schema_implementation',
  'data_migration',
  'target_infrastructure_environment_implementation',
  'data_parity_reconciliation_reporting',
]);
const UI_WORKSTREAMS = new Set([
  'target_frontend_implementation',
  'cutover_rollback_decommission',
]);

export type RailPlaneId = 'db' | 'service' | 'ui';

export function planeForStory(story: {
  workstream?: string | null;
  tags?: string[];
}): RailPlaneId {
  let ws = story.workstream ?? null;
  if (!ws) {
    const streamTag = (story.tags ?? []).find((t) => t.startsWith('stream:'));
    if (streamTag) ws = streamTag.slice('stream:'.length);
  }
  if (ws && DB_WORKSTREAMS.has(ws)) return 'db';
  if (ws && UI_WORKSTREAMS.has(ws)) return 'ui';
  return 'service';
}

export const PLANE_ORDER: RailPlaneId[] = ['db', 'service', 'ui'];

export const PLANE_META: Record<
  RailPlaneId,
  { title: string; subSteps: string }
> = {
  db: { title: 'DB', subSteps: 'schema → data → parity reconcile' },
  service: { title: 'Service', subSteps: 'APIs → internal → API reconcile' },
  ui: { title: 'UI', subSteps: 'UI build' },
};

export interface RailPlane {
  plane: RailPlaneId;
  totalStories: number;
  satisfiedStories: number;
  blockers: Array<{ id: string; title: string }>;
  /** Run progress (0/0 when no run exists yet). */
  runDone: number;
  runTotal: number;
}

export interface MigrationExecutionRailProps {
  planes: RailPlane[];
  /** Latest run status (null = no run yet). */
  runStatus: string | null;
  /** Orchestration scope (company/project) resolved — Start usable. */
  scopeReady: boolean;
  busy: boolean;
  error: string | null;
  /** Reasons from a `blocked` resume — renders the break-glass panel. */
  pausedBlockers: Array<Record<string, unknown>> | null;
  onStart: () => void;
  onApprove: () => void;
  onBreakGlass: () => void;
  onSelectStory: (bookItemId: string) => void;
  onOpenDelivery?: () => void;
  /**
   * Target-DB credential registration presence for the ACTIVE run (Residual 2).
   * null = no run / unknown. Rendered on the DB card so a lost registration
   * (e.g. gateway restart — the store is in-memory) is visible, not a silent
   * parity block later.
   */
  dbCredsRegistered?: boolean | null;
  /** Open the credentials dialog to (re)register the run's target-DB secrets. */
  onProvideCreds?: () => void;
}

function describeBlockReason(r: Record<string, unknown>): string {
  for (const key of ['reason', 'message', 'table', 'detail']) {
    const v = r[key];
    if (typeof v === 'string' && v) return v;
  }
  return JSON.stringify(r);
}

export const MigrationExecutionRail: React.FC<MigrationExecutionRailProps> = ({
  planes,
  runStatus,
  scopeReady,
  busy,
  error,
  pausedBlockers,
  onStart,
  onApprove,
  onBreakGlass,
  onSelectStory,
  onOpenDelivery,
  dbCredsRegistered,
  onProvideCreds,
}) => {
  if (planes.length === 0) return null;

  const allSatisfied = planes.every(
    (p) => p.satisfiedStories >= p.totalStories,
  );
  const runActive =
    runStatus !== null &&
    ['dispatching', 'awaiting_approval', 'implementing', 'submitted'].includes(
      runStatus,
    );
  const paused = runStatus === 'awaiting_approval';

  return (
    <section className={styles.coveragePanel} data-testid="execution-rail">
      <h2 className={styles.coveragePanelTitle}>Execution</h2>

      {paused && (
        <div
          className={styles.modalWarning}
          data-testid="execution-rail-pause-banner"
        >
          {'‖'} The plane completed its build, verify and reconcile — the run
          is paused for your review.{' '}
          <button
            type="button"
            className={`${styles.selectButton} ${styles.selectButtonPrimary}`}
            disabled={busy}
            onClick={onApprove}
            data-testid="execution-rail-approve"
          >
            {busy ? 'Working…' : 'Approve & continue'}
          </button>{' '}
          {onOpenDelivery && (
            <button
              type="button"
              className={styles.selectButton}
              onClick={onOpenDelivery}
              data-testid="execution-rail-open-delivery"
            >
              View run details {'→'}
            </button>
          )}
        </div>
      )}

      {pausedBlockers && pausedBlockers.length > 0 && (
        <div
          className={styles.modalWarning}
          role="alert"
          data-testid="execution-rail-break-glass"
        >
          <strong>Parity is NOT clean</strong> — approval was refused:
          <ul className={styles.bulletList}>
            {pausedBlockers.map((r, idx) => (
              <li key={idx}>{describeBlockReason(r)}</li>
            ))}
          </ul>
          Recommended: fix parity first. Continuing means the next plane's API
          reconcile runs under KNOWN data divergence — its breaks will be
          ambiguous where they touch the divergent data.
          <div style={{ marginTop: 8 }}>
            <button
              type="button"
              className={styles.selectButton}
              style={{ borderColor: '#b45309', color: '#b45309' }}
              disabled={busy}
              onClick={onBreakGlass}
              data-testid="execution-rail-break-glass-button"
            >
              {'⚠'} Break glass: continue with unclean parity
            </button>
          </div>
        </div>
      )}

      {error && (
        <div
          className={styles.modalWarning}
          role="alert"
          data-testid="execution-rail-error"
        >
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, alignItems: 'stretch', flexWrap: 'wrap' }}>
        {planes.map((p, idx) => {
          const meta = PLANE_META[p.plane];
          const satisfied = p.satisfiedStories >= p.totalStories;
          const isFirst = idx === 0;
          const stageNo = idx + 1;
          return (
            <div
              key={p.plane}
              style={{
                flex: 1,
                minWidth: 240,
                border: '1px solid #d0d7de',
                borderRadius: 6,
                padding: 12,
                background: '#ffffff',
              }}
              data-testid={`execution-rail-card-${p.plane}`}
            >
              <div style={{ fontWeight: 600 }}>
                Stage {stageNo} · {meta.title}
              </div>
              <div className={styles.coveragePanelNote}>{meta.subSteps}</div>
              <div data-testid={`execution-rail-gate-${p.plane}`}>
                specs {p.satisfiedStories}/{p.totalStories}{' '}
                {satisfied ? '✓' : 'ready'}
              </div>
              {!satisfied && (
                <ul
                  className={styles.bulletList}
                  data-testid={`execution-rail-blockers-${p.plane}`}
                >
                  {p.blockers.map((b) => (
                    <li key={b.id}>
                      <button
                        type="button"
                        className={styles.coverageInlineLink}
                        onClick={() => onSelectStory(b.id)}
                        data-testid={`execution-rail-blocker-${b.id}`}
                      >
                        {b.title}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {p.runTotal > 0 && (
                <div data-testid={`execution-rail-progress-${p.plane}`}>
                  run: {p.runDone}/{p.runTotal} done
                </div>
              )}
              {p.plane === 'db' && runActive && dbCredsRegistered !== null && (
                <div
                  className={styles.coveragePanelNote}
                  data-testid="execution-rail-db-creds"
                >
                  target DB creds:{' '}
                  {dbCredsRegistered ? 'registered ✓' : 'NOT registered'}
                  {!dbCredsRegistered && onProvideCreds && (
                    <>
                      {' '}
                      <button
                        type="button"
                        className={styles.coverageInlineLink}
                        onClick={onProvideCreds}
                        data-testid="execution-rail-provide-creds"
                      >
                        Provide credentials…
                      </button>
                    </>
                  )}
                </div>
              )}
              {isFirst && !runActive && (
                <button
                  type="button"
                  className={`${styles.selectButton} ${styles.selectButtonPrimary}`}
                  style={{ marginTop: 8 }}
                  disabled={!allSatisfied || !scopeReady || busy}
                  onClick={onStart}
                  title={
                    !allSatisfied
                      ? 'Every story needs a spec (generated or manual-ready) before a stage can start'
                      : !scopeReady
                        ? 'Resolving the orchestration scope…'
                        : 'Runs the plane end-to-end (build → verify → reconcile), then pauses for your review'
                  }
                  data-testid="execution-rail-start"
                >
                  {busy ? 'Starting…' : `▶ Start stage ${stageNo}`}
                </button>
              )}
              {!isFirst && !runActive && (
                <div
                  className={styles.coveragePanelNote}
                  data-testid={`execution-rail-locked-${p.plane}`}
                >
                  {'🔒'} starts after stage {stageNo - 1} approval
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
};

export default MigrationExecutionRail;
