/**
 * Spec 5 (Stored Proc & Function Behaviour Program, 2026-09-09): proc parity
 * at EXECUTION — the DB plane's step 6 re-checks every translate-dispositioned
 * routine against the pinned proc baseline on the freshly-built target, and
 * the manual Run-reconciliation modal fires the same engine on demand.
 *
 * Mirrors `migrationDataParityReconcile.ts`: credentials come from the
 * in-memory stores (target only — the pinned baseline IS the source side),
 * the AMVS proc-parity route does the replay + persists one report per
 * routine, and the trigger is fire-and-forget (fail-open execute; the
 * graduated gate reads the reports fail-closed for dependents).
 */

import { logger } from './logger';
import { createTracer } from '../trace';
import { migrationTargetCredentialsStore, type TargetDbSecret } from './migrationTargetCredentialsStore';
import { defaultFetchPackView } from './migrationDbPackPlanner';
import type { MigrateScope, MigrationDriverDeps } from './migrationExecutionDriver';
import { defaultFetchTranslations, defaultFetchRoutineCatalog } from './dbMigrationPack/translations';
import { deriveDescriptorsByRoutine } from './dbMigrationPack/routineInvocationDescriptor';
import { fetchPinnedProcBaselineItems } from './dbMigrationPack/procWorkbench';
import {
  listProcParityWaivers,
  runProcParityViaAmvs,
  toRunnerWaivers,
  type ProcParityRunOutcome,
} from './dbMigrationPack/procWorkbenchClients';
import { loadPairRuleset } from '../migrationPairRules';
import { ROUTINE_TRANSLATION_KINDS } from './migrationProcParityGate';
import { rulesetForManifest, manifestSourceEngine } from './dbMigrationPack/pairRuleset';

const trace = createTracer('gateway');

// ============================================================================
// The engine call (shared by the DB-plane trigger + the manual modal)
// ============================================================================

export interface ProcParityRunDeps {
  fetchPackView?: typeof defaultFetchPackView;
  fetchTranslations?: typeof defaultFetchTranslations;
  fetchRoutines?: typeof defaultFetchRoutineCatalog;
  fetchBaselineItems?: typeof fetchPinnedProcBaselineItems;
  fetchWaivers?: typeof listProcParityWaivers;
  loadRuleset?: typeof loadPairRuleset;
  runParity?: typeof runProcParityViaAmvs;
}

export type ProcParityRunResult =
  | {
      ok: true;
      status: 'clean' | 'divergent' | 'unverifiable' | 'no_routines';
      baselineId: string | null;
      routines: number;
      reports: ProcParityRunOutcome['reports'];
      skipped: ProcParityRunOutcome['skipped'];
    }
  | { ok: false; blocked: string }
  | { ok: false; error: string };

export type ProcParityPreconditions =
  | {
      ok: true;
      packId: string;
      routineIds: string[];
      baselineId: string | null;
      /** Pack manifest (pair-per-project: selects the ruleset + source engine). */
      manifest?: Record<string, unknown> | null;
      sourceEngine?: string | null;
    }
  | { ok: false; blocked: string };

/**
 * The cheap, synchronous-in-spirit checks the manual modal reports as named
 * block reasons: a DB pack, translate-dispositioned routines, and a pinned
 * proc baseline. `baselineId` is null only when there are no routines to
 * replay (the baseline is then irrelevant).
 */
export async function checkProcParityPreconditions(
  projectId: string,
  architectureId: string,
  deps: ProcParityRunDeps = {},
): Promise<ProcParityPreconditions> {
  const fetchPackView = deps.fetchPackView ?? defaultFetchPackView;
  const fetchTranslations = deps.fetchTranslations ?? defaultFetchTranslations;
  const fetchBaselineItems = deps.fetchBaselineItems ?? fetchPinnedProcBaselineItems;

  const packView = await fetchPackView(projectId, architectureId);
  if (!packView) {
    return { ok: false, blocked: 'No DB migration pack exists for this architecture — generate it first.' };
  }
  const translations = await fetchTranslations(projectId, packView.packId);
  const routineIds = translations
    .filter((t) => ROUTINE_TRANSLATION_KINDS.has(t.kind) && t.disposition === 'translate' && !!t.routine_id)
    .map((t) => t.routine_id as string);
  const manifest = (packView.manifest ?? null) as unknown as Record<string, unknown> | null;
  if (routineIds.length === 0) {
    return { ok: true, packId: packView.packId, routineIds, baselineId: null, manifest, sourceEngine: manifestSourceEngine(manifest) };
  }
  const baseline = await fetchBaselineItems(projectId, architectureId);
  if (!baseline.baselineId) {
    return {
      ok: false,
      blocked: 'No pinned proc behaviour baseline — capture and pin one (Baselines → Stored procs) first.',
    };
  }
  return { ok: true, packId: packView.packId, routineIds, baselineId: baseline.baselineId, manifest, sourceEngine: manifestSourceEngine(manifest) };
}

/**
 * Preconditions are named block reasons (the modal says WHY); the replay
 * itself runs through AMVS. Never throws — an engine error is
 * `{ ok: false, error }`.
 */
export async function runProcParityForArchitecture(
  args: {
    projectId: string;
    architectureId: string;
    targetDb: TargetDbSecret;
    purpose: 'execution' | 'manual';
  },
  deps: ProcParityRunDeps = {},
): Promise<ProcParityRunResult> {
  const fetchRoutines = deps.fetchRoutines ?? defaultFetchRoutineCatalog;
  const fetchWaivers = deps.fetchWaivers ?? listProcParityWaivers;
  const loadRuleset = deps.loadRuleset ?? loadPairRuleset;
  const runParity = deps.runParity ?? runProcParityViaAmvs;

  try {
    const pre = await checkProcParityPreconditions(args.projectId, args.architectureId, deps);
    if (!pre.ok) return pre;
    const { packId, routineIds } = pre;
    if (routineIds.length === 0) {
      return { ok: true, status: 'no_routines', baselineId: null, routines: 0, reports: [], skipped: [] };
    }
    const [routines, waiverRows] = await Promise.all([
      fetchRoutines(args.projectId, args.architectureId),
      fetchWaivers(args.projectId),
    ]);
    const descriptors = Object.fromEntries(deriveDescriptorsByRoutine(routines, rulesetForManifest(pre.manifest, loadRuleset)));
    const outcome = await runParity({
      projectId: args.projectId,
      architectureId: args.architectureId,
      targetDb: args.targetDb,
      routineIds,
      descriptors,
      purpose: args.purpose,
      packId,
      waivers: toRunnerWaivers(waiverRows),
      sourceEngine: pre.sourceEngine ?? null,
    });
    if (outcome.error) return { ok: false, error: outcome.error };
    const statuses = outcome.reports.map((r) => r.summary.status);
    const status: 'clean' | 'divergent' | 'unverifiable' = statuses.includes('divergent')
      ? 'divergent'
      : statuses.includes('unverifiable') || outcome.skipped.length > 0
        ? 'unverifiable'
        : 'clean';
    return {
      ok: true,
      status,
      baselineId: outcome.baselineId,
      routines: routineIds.length,
      reports: outcome.reports,
      skipped: outcome.skipped,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ============================================================================
// The DB-plane trigger (step 6)
// ============================================================================

export interface ProcParityReconcileTriggerDeps extends ProcParityRunDeps {
  getTargetDb?: (runId: string) => TargetDbSecret | undefined;
}

/**
 * Build the DB-plane proc-parity trigger for `deps.triggerProcParityReconcile`.
 * Fire-and-forget; NEVER throws. A skip is loud (trace + log) and names what
 * was missing — the gate then reads "no execution report" honestly.
 */
export function createProcParityReconcileTrigger(
  subDeps: ProcParityReconcileTriggerDeps = {},
): (scope: MigrateScope, runId: string, deps: MigrationDriverDeps) => Promise<void> {
  const getTargetDb =
    subDeps.getTargetDb ?? ((runId: string) => migrationTargetCredentialsStore.getDb(runId));

  return async (scope, runId, deps) => {
    const corr = { run: runId, project: scope.project };
    try {
      const run = await deps.getMigrationExecutionRun(scope.projectId, runId);
      const bookId = run?.book_of_work_id ?? scope.bookId;
      const book = bookId ? await deps.fetchBookOfWork(scope.projectId, bookId) : null;
      const architectureId = book?.current_architecture_id ?? null;
      const targetDb = getTargetDb(runId);

      const missing: string[] = [];
      if (!architectureId) missing.push('current architecture id');
      if (!targetDb) missing.push('target DB creds (register at Migrate confirm)');
      if (missing.length > 0) {
        logger.info('[diag-gateway] migration_execution_driver proc_parity_reconcile_skipped', {
          projectId: scope.projectId,
          runId,
          missing,
        });
        trace.warn(
          `proc-parity reconcile SKIPPED — missing: ${missing.join('; ')}. ` +
            'Run it from the progress report (Run reconciliation → Stored procs and functions).',
          corr,
        );
        return;
      }

      trace.step('proc-parity reconcile (DB plane) — pinned proc baseline replayed on the target via AMVS', corr);
      const result = await runProcParityForArchitecture(
        { projectId: scope.projectId, architectureId: architectureId as string, targetDb: targetDb as TargetDbSecret, purpose: 'execution' },
        subDeps,
      );
      if (result.ok) {
        if (result.status === 'no_routines') {
          trace.ok('proc-parity reconcile — no translate-dispositioned routines on the pack; nothing to replay', corr);
        } else {
          const divergent = result.reports.filter((r) => r.summary.status === 'divergent').length;
          const unverifiable = result.reports.filter((r) => r.summary.status === 'unverifiable').length;
          trace.ok(
            `proc-parity reconcile COMPLETED — status=${result.status} routines=${result.routines} ` +
              `reports=${result.reports.length} divergent=${divergent} unverifiable=${unverifiable} ` +
              `skipped=${result.skipped.length}`,
            corr,
          );
        }
      } else if ('blocked' in result) {
        trace.warn(`proc-parity reconcile SKIPPED — ${result.blocked}`, corr);
      } else {
        trace.fail(`proc-parity reconcile run failed: ${result.error}`, corr);
      }
    } catch (err) {
      logger.error('[diag-gateway] migration_execution_driver proc_parity_reconcile_error', {
        projectId: scope.projectId,
        runId,
        error: err instanceof Error ? err.message : 'unknown',
      });
      trace.fail(
        `proc-parity reconcile errored: ${err instanceof Error ? err.message.slice(0, 200) : 'unknown'}`,
        corr,
      );
    }
  };
}
