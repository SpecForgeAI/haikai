/**
 * Baseline drift watch — in-memory registration + in-process interval check
 * (Spec 2026-07-06-i amendment §6; Tier-1 batch 2026-07-10, user decision
 * Q2 = option (b)).
 *
 * THE CREDENTIALS POSTURE, RELAXED EXACTLY THIS FAR AND NO FURTHER: the
 * CURRENT system's credentials may be held IN GATEWAY MEMORY for the process
 * lifetime so an unattended interval check can replay the pinned baseline
 * against the CURRENT system and catch oracle rot. They are NEVER persisted,
 * NEVER logged; a gateway restart drops every registration (by design — the
 * `baseline_drift_unchecked` gate warning then nags a human to re-register).
 *
 * The scheduler is INERT until a project registers a watch: no registrations
 * → each tick is a no-op. Per tick, per watch: read the pinned baseline's
 * drift posture (`evaluateBaselineDrift` over the persisted drift-check
 * diffs); when unchecked/stale, fire ONE `runBaselineDriftCheck` (the scoped
 * replay machinery pointed at the CURRENT base URL, `purpose: 'drift_check'`
 * on the diff's audit blob). A breaking result surfaces via the persisted
 * diff + the `baseline_behaviour_drift` gate code — the scheduler never
 * mutates anything else.
 */

import { logger } from './logger';
import {
  defaultCodeGateReads,
  evaluateBaselineDrift,
  type CodeGateReads,
} from './migrationCodeExecutionGate';
import {
  runBaselineDriftCheck,
  type ParityVerifyDeps,
} from './migrationParityVerifier';
import type {
  TargetApiAuthSecret,
  TargetDbSecret,
} from './migrationTargetCredentialsStore';

// ---------------------------------------------------------------------------
// The in-memory current-system credentials register
// ---------------------------------------------------------------------------

export interface BaselineDriftWatch {
  projectId: string;
  /**
   * Drift-watch context fields — OPTIONAL since 2026-07-31: the Start-stage
   * dialogs register SOURCE credentials (DB for stage 1, API for stage 2)
   * into this store WITHOUT the baseline context a full drift watch needs.
   * The drift tick skips entries that lack the full context; the DB
   * execution chain and data-migration dispatch read only `.db`.
   */
  architectureId?: string;
  sourceBaselineId?: string;
  /** The CURRENT (legacy) system's base URL — not the migration target. */
  currentBaseUrl?: string;
  api?: TargetApiAuthSecret;
  /** OPTIONAL current-DB creds — enables state deltas on the drift replay. */
  db?: TargetDbSecret;
  registeredAt: number;
}

class CurrentSystemCredentialsStore {
  private readonly watches = new Map<string, BaselineDriftWatch>();

  set(watch: Omit<BaselineDriftWatch, 'registeredAt'>): void {
    this.watches.set(watch.projectId, { ...watch, registeredAt: Date.now() });
  }

  /**
   * Merge-not-clobber upsert of the SOURCE database credentials (stage-1
   * Start modal, 2026-07-31). A creds-only registration must never wipe an
   * existing drift watch's API/baseline fields — and vice versa.
   */
  upsertDb(projectId: string, db: TargetDbSecret, architectureId?: string): void {
    const existing = this.watches.get(projectId);
    this.watches.set(projectId, {
      ...(existing ?? { projectId, registeredAt: Date.now() }),
      projectId,
      ...(architectureId && !existing?.architectureId ? { architectureId } : {}),
      db,
      registeredAt: existing?.registeredAt ?? Date.now(),
    });
  }

  /**
   * Merge-not-clobber upsert of the SOURCE service (current system API)
   * details (stage-2 Start modal, 2026-07-31).
   */
  upsertApi(
    projectId: string,
    args: { currentBaseUrl: string; api: TargetApiAuthSecret; architectureId?: string }
  ): void {
    const existing = this.watches.get(projectId);
    this.watches.set(projectId, {
      ...(existing ?? { projectId, registeredAt: Date.now() }),
      projectId,
      ...(args.architectureId && !existing?.architectureId
        ? { architectureId: args.architectureId }
        : {}),
      currentBaseUrl: args.currentBaseUrl,
      api: args.api,
      registeredAt: existing?.registeredAt ?? Date.now(),
    });
  }

  get(projectId: string): BaselineDriftWatch | undefined {
    return this.watches.get(projectId);
  }

  delete(projectId: string): boolean {
    return this.watches.delete(projectId);
  }

  /** Registered project ids only — NEVER the credential material. */
  listProjectIds(): string[] {
    return Array.from(this.watches.keys());
  }

  /** Test-only. */
  clearAll(): void {
    this.watches.clear();
  }
}

export const currentSystemCredentialsStore = new CurrentSystemCredentialsStore();
export { CurrentSystemCredentialsStore };

// ---------------------------------------------------------------------------
// The interval scheduler
// ---------------------------------------------------------------------------

export interface DriftSchedulerConfig {
  /** Master switch. Env `DRIFT_CHECK_ENABLED` ('false' disables). */
  enabled: boolean;
  /** Tick interval. Env `DRIFT_CHECK_INTERVAL_MS`; default 6h. */
  intervalMs: number;
  /** Staleness threshold forwarded to the evaluator. Env `DRIFT_CHECK_MAX_AGE_DAYS`; default 14. */
  maxAgeDays: number;
}

export function driftSchedulerConfigFromEnv(): DriftSchedulerConfig {
  const enabled = (process.env.DRIFT_CHECK_ENABLED ?? 'true').toLowerCase() !== 'false';
  const intervalMs = Number(process.env.DRIFT_CHECK_INTERVAL_MS) || 6 * 60 * 60 * 1000;
  const maxAgeDays = Number(process.env.DRIFT_CHECK_MAX_AGE_DAYS) || 14;
  return { enabled, intervalMs, maxAgeDays };
}

export interface DriftSchedulerDeps {
  store?: CurrentSystemCredentialsStore;
  gateReads?: CodeGateReads;
  runDriftCheck?: typeof runBaselineDriftCheck;
  verifyDeps?: ParityVerifyDeps;
  evaluateDrift?: typeof evaluateBaselineDrift;
  now?: () => number;
}

/**
 * One scheduler tick (exported for tests — the interval just calls this).
 * Fires AT MOST one drift check per registered watch per tick, and only
 * when the drift posture is unchecked/stale. Failure-isolated per watch.
 */
export async function runDriftTick(
  config: DriftSchedulerConfig,
  deps: DriftSchedulerDeps = {},
): Promise<{ checked: number; fired: number }> {
  const store = deps.store ?? currentSystemCredentialsStore;
  const gateReads = deps.gateReads ?? defaultCodeGateReads();
  const evaluate = deps.evaluateDrift ?? evaluateBaselineDrift;
  const fire = deps.runDriftCheck ?? runBaselineDriftCheck;

  let checked = 0;
  let fired = 0;
  for (const projectId of store.listProjectIds()) {
    const watch = store.get(projectId);
    if (!watch) continue;
    // A creds-only entry (Start-modal source registration, 2026-07-31) is
    // NOT a drift watch — it lacks the baseline context a check needs.
    if (!watch.architectureId || !watch.sourceBaselineId || !watch.currentBaseUrl || !watch.api) {
      continue;
    }
    checked += 1;
    try {
      const diffs = await gateReads.listDiffsForBaseline(projectId, watch.sourceBaselineId);
      const posture = await evaluate({
        projectId,
        diffs,
        maxAgeDays: config.maxAgeDays,
        now: deps.now,
        reads: gateReads,
      });
      const needsCheck = posture.reasons.some((r) => r.code === 'baseline_drift_unchecked');
      if (!needsCheck) continue; // fresh (or already BROKEN — humans act on that)

      logger.info('[diag-gateway] baseline_drift scheduled_check_firing', {
        projectId,
        sourceBaselineId: watch.sourceBaselineId,
      });
      const verdict = await fire(
        {
          projectId,
          architectureId: watch.architectureId,
          sourceBaselineId: watch.sourceBaselineId,
          currentBaseUrl: watch.currentBaseUrl,
          api: watch.api,
          db: watch.db ?? null,
        },
        deps.verifyDeps ?? {},
      );
      fired += 1;
      logger.info('[diag-gateway] baseline_drift scheduled_check_done', {
        projectId,
        clean: verdict.clean,
        breaks: verdict.coverage.breaks,
      });
    } catch (error) {
      // Failure-isolated: one watch's failure never blocks the others; the
      // gate's staleness warning keeps nagging until a check succeeds.
      logger.warn('[diag-gateway] baseline_drift scheduled_check_failed', {
        projectId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { checked, fired };
}

let intervalHandle: ReturnType<typeof setInterval> | null = null;

/** Start the in-process scheduler (idempotent). Returns false when disabled. */
export function startBaselineDriftScheduler(
  config: DriftSchedulerConfig = driftSchedulerConfigFromEnv(),
  deps: DriftSchedulerDeps = {},
): boolean {
  if (!config.enabled) {
    logger.info('[diag-gateway] baseline_drift scheduler_disabled');
    return false;
  }
  if (intervalHandle) return true;
  intervalHandle = setInterval(() => {
    void runDriftTick(config, deps);
  }, config.intervalMs);
  // Never keep the process alive just for the watcher.
  intervalHandle.unref?.();
  logger.info('[diag-gateway] baseline_drift scheduler_started', {
    intervalMs: config.intervalMs,
    maxAgeDays: config.maxAgeDays,
  });
  return true;
}

/** Stop the scheduler (tests / shutdown). Idempotent. */
export function stopBaselineDriftScheduler(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
