/**
 * Log-replay reconciliation — ROUND 2 (Capture-State Discipline & Log-Replay
 * program, Spec 7, 2026-08-18).
 *
 * Round 1 reconciles the curated LLM/Postman baseline (100% endpoint
 * coverage, ~10 scenarios each). Round 2 replays the REAL logged traffic:
 *
 *   Phase A — the AMVS current-side runner replays the staged log corpus
 *   against the LIVE current system at S0 (compensation-bracketed writes)
 *   and promotes a `log_replay`-kind baseline.
 *
 *   Phase B — the EXISTING headless reconcile machinery replays that
 *   baseline against the TARGET (state deltas + target-side brackets ride
 *   the same db plumbing) and diffs it; the diff is tagged
 *   `purpose: 'log_replay_round2'` so it never masquerades as the round-1
 *   full-baseline verdict.
 *
 * Manual trigger (design ruling): invoked from the reconcile surface, never
 * auto-chained. Both phases fail loudly; a phase-A failure never starts
 * phase B.
 */

import { logger } from './logger';
import { getConfig } from '../config';
import {
  ReconciliationPollOptions,
  ReconciliationValidationDeps,
  defaultReconciliationValidationDeps,
  isDiffItemABreak,
  runHeadlessReconcile,
} from './migrationReconciliationValidationClient';
import type {
  TargetApiAuthSecret,
  TargetDbSecret,
} from './migrationTargetCredentialsStore';

export interface LogReplayReconcileArgs {
  projectId: string;
  architectureId: string;
  /** Default: the latest staged corpus for the pair. */
  corpusId?: string | null;
  current: {
    baseUrl: string;
    api: TargetApiAuthSecret;
    db?: TargetDbSecret | null;
  };
  target: {
    baseUrl: string;
    api: TargetApiAuthSecret;
    db?: TargetDbSecret | null;
  };
}

export interface LogReplayReconcileDeps {
  fetchFn?: typeof fetch;
  validationDeps?: ReconciliationValidationDeps;
  pollOptions?: ReconciliationPollOptions;
  runHeadlessReconcileFn?: typeof runHeadlessReconcile;
}

export interface LogReplayReconcileResult {
  ok: boolean;
  error: string | null;
  corpusId: string | null;
  logReplayBaselineId: string | null;
  currentSide: {
    itemsTotal: number;
    itemsReplayed: number;
    itemsSkipped: number;
    itemsFailed: number;
  } | null;
  diffId: string | null;
  targetBaselineId: string | null;
  breaks: number;
  diffItems: number;
}

export async function runLogReplayReconcile(
  args: LogReplayReconcileArgs,
  deps: LogReplayReconcileDeps = {},
): Promise<LogReplayReconcileResult> {
  const fetchFn = deps.fetchFn ?? fetch;
  const { apiMigrationValidationServiceBaseUrl } = getConfig();

  const base: LogReplayReconcileResult = {
    ok: false,
    error: null,
    corpusId: args.corpusId ?? null,
    logReplayBaselineId: null,
    currentSide: null,
    diffId: null,
    targetBaselineId: null,
    breaks: 0,
    diffItems: 0,
  };

  // ---- Phase A: current-side corpus replay at S0 --------------------------
  logger.info('[diag-gateway] log_replay_reconcile phase_a_start', {
    projectId: args.projectId,
    architectureId: args.architectureId,
    corpusId: args.corpusId ?? '(latest)',
  });
  let phaseA: {
    corpus_id?: string;
    baseline_id?: string | null;
    items_total?: number;
    items_replayed?: number;
    items_skipped?: number;
    items_failed?: number;
    final_status?: string;
    error_message?: string | null;
  };
  try {
    const response = await fetchFn(
      `${apiMigrationValidationServiceBaseUrl}/api-migration-validation/api/log-replay/run`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          project_id: args.projectId,
          architecture_id: args.architectureId,
          corpus_id: args.corpusId ?? undefined,
          current_api: {
            base_url: args.current.baseUrl,
            auth: args.current.api,
          },
          current_db: args.current.db
            ? {
                db_type: args.current.db.dbType,
                host: args.current.db.host,
                port: args.current.db.port,
                database: args.current.db.database,
                schema: args.current.db.schema ?? null,
                username: args.current.db.username,
                password: args.current.db.password,
              }
            : null,
        }),
      },
    );
    phaseA = (await response.json()) as typeof phaseA;
    if (!response.ok || phaseA.final_status !== 'completed' || !phaseA.baseline_id) {
      base.error =
        `phase A (current-side corpus replay) failed: ` +
        (phaseA.error_message ?? `HTTP ${response.status}`);
      base.corpusId = phaseA.corpus_id ?? base.corpusId;
      logger.error('[diag-gateway] log_replay_reconcile phase_a_failed', {
        projectId: args.projectId,
        error: base.error,
      });
      return base;
    }
  } catch (err) {
    base.error = `phase A (current-side corpus replay) unreachable: ${
      err instanceof Error ? err.message : String(err)
    }`;
    return base;
  }

  base.corpusId = phaseA.corpus_id ?? base.corpusId;
  base.logReplayBaselineId = phaseA.baseline_id ?? null;
  base.currentSide = {
    itemsTotal: phaseA.items_total ?? 0,
    itemsReplayed: phaseA.items_replayed ?? 0,
    itemsSkipped: phaseA.items_skipped ?? 0,
    itemsFailed: phaseA.items_failed ?? 0,
  };

  // ---- Phase B: target replay + diff via the EXISTING machinery -----------
  logger.info('[diag-gateway] log_replay_reconcile phase_b_start', {
    projectId: args.projectId,
    logReplayBaselineId: base.logReplayBaselineId,
  });
  const headless = deps.runHeadlessReconcileFn ?? runHeadlessReconcile;
  const result = await headless(
    {
      projectId: args.projectId,
      architectureId: args.architectureId,
      sourceBaselineId: base.logReplayBaselineId as string,
      targetBaseUrl: args.target.baseUrl,
      api: args.target.api,
      endpointScope: null,
      // Tag the diff so round 2 never masquerades as the round-1 verdict.
      purpose: 'log_replay_round2',
      db: args.target.db ?? null,
    },
    deps.validationDeps ?? defaultReconciliationValidationDeps(),
    deps.pollOptions ?? {},
  );
  if (!result.ok) {
    base.error = `phase B (target replay + diff) failed: ${result.error ?? 'unknown'}`;
    logger.error('[diag-gateway] log_replay_reconcile phase_b_failed', {
      projectId: args.projectId,
      error: base.error,
    });
    return base;
  }

  base.ok = true;
  base.diffId = result.diffId ?? null;
  base.targetBaselineId = result.targetBaselineId ?? null;
  base.diffItems = result.diffItems.length;
  base.breaks = result.diffItems.filter(isDiffItemABreak).length;
  logger.info('[diag-gateway] log_replay_reconcile complete', {
    projectId: args.projectId,
    diffId: base.diffId,
    diffItems: base.diffItems,
    breaks: base.breaks,
  });
  return base;
}
