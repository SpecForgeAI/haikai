/**
 * Migration Execution Driver -- boot-recovery wiring (Spec 3, Task Group 2, CD-2).
 *
 * On gateway startup, reconcile in-flight migration run-state against reality
 * and re-kick any run-item found stuck mid-segment (status answering/submitting
 * with no `job_id` yet), so a long migration auto-resumes across gateway
 * restarts. The Driver itself ({@link recoverInFlightRuns}) owns the per-run /
 * per-item reconcile; this module is the BOOT WIRING: it discovers the in-flight
 * runs to reconcile, then hands them to the Driver.
 *
 * Discovery is a DI seam ({@link InFlightRunDiscovery}) so the sweep is
 * unit-testable (a test injects a discovery returning a stuck run and asserts a
 * re-kick) and the boot wiring stays a thin, never-throw hook. The gateway has
 * no cross-project "list all in-flight runs" index in v1, so the default
 * discovery returns an empty set and the sweep is a structured-logged no-op --
 * the clean extension point a follow-up (or an AMS cross-project list endpoint)
 * plugs into without touching server.ts.
 *
 * Spec: Migrate Button + Migration Execution Driver + External Shape-Spec
 * Auto-Answerer (2026-06-14, Spec 3 of 4) -- Task Group 2.
 */

import { logger } from './logger';
import { listInFlightMigrationExecutionRuns } from './migrationExecutionRunClient';
import {
  recoverInFlightRuns,
  defaultMigrationDriverDeps,
  MigrationDriverDeps,
} from './migrationExecutionDriver';

/** A reference to an in-flight run the boot-recovery sweep should reconcile. */
export interface InFlightRunRef {
  projectId: string;
  runId: string;
  company: string;
  project: string;
  bookId: string;
}

/** Discovers the in-flight runs to reconcile on boot (a DI seam). */
export type InFlightRunDiscovery = () => Promise<InFlightRunRef[]>;

/**
 * The default discovery (LIVE since 2026-08-07 / AMS changeset 219): reads the
 * cross-project in-flight list (`GET /api/migration-execution-runs/in-flight`,
 * status started/dispatching) and maps each run to a sweep ref. Before this it
 * returned a hard-coded empty set — boot recovery was structurally INERT and a
 * gateway restart stranded any mid-segment run forever.
 *
 * A run missing its scope names (pre-219 row) or ids is SKIPPED with a loud
 * warning — the operator resumes those from the UI; every run created after
 * 219 carries them. A discovery read failure propagates to the sweep's own
 * never-throw guard (logged, boot continues).
 */
export const defaultInFlightRunDiscovery: InFlightRunDiscovery = async () => {
  const runs = await listInFlightMigrationExecutionRuns();
  const refs: InFlightRunRef[] = [];
  for (const run of runs) {
    const projectId = run.project_id ?? null;
    const runId = run.id ?? null;
    const bookId = run.book_of_work_id ?? null;
    const company = run.company ?? null;
    const project = run.project ?? null;
    if (!projectId || !runId || !bookId || !company || !project) {
      logger.warn(
        '[diag-gateway] migration_execution_driver boot_recovery_run_skipped_missing_scope',
        {
          runId,
          projectId,
          bookId,
          hasCompany: !!company,
          hasProject: !!project,
          hint:
            'pre-changeset-219 run (no scope names persisted) — resume it from the UI; ' +
            'runs created after the upgrade are recoverable automatically',
        }
      );
      continue;
    }
    refs.push({ projectId, runId, bookId, company, project });
  }
  return refs;
};

/**
 * Run the boot-recovery sweep (CD-2). Never throws -- a discovery / reconcile
 * failure on boot must NOT prevent the gateway from starting. Returns the
 * reconcile counts for the caller / tests.
 *
 * @param buildResultsCallbackUrl the gateway's build-results URL (threaded on
 *        re-dispatched orchestration submits)
 * @param discovery the in-flight-run discovery seam (defaults to the empty-set
 *        discovery; injected in tests)
 * @param deps the Driver dep surface (defaults to production; injected in tests)
 */
export async function runMigrationBootRecovery(
  buildResultsCallbackUrl: string,
  discovery: InFlightRunDiscovery = defaultInFlightRunDiscovery,
  deps?: MigrationDriverDeps
): Promise<{ recovered: number; rekicked: number; retriesRearmed: number }> {
  try {
    const runs = await discovery();
    if (runs.length === 0) {
      logger.info('[diag-gateway] migration_execution_driver boot_recovery_no_runs', {});
      return { recovered: 0, rekicked: 0, retriesRearmed: 0 };
    }
    const effectiveDeps = deps ?? defaultMigrationDriverDeps(buildResultsCallbackUrl);
    logger.info('[diag-gateway] migration_execution_driver boot_recovery_start', {
      runCount: runs.length,
    });
    // Robustness R2: besides re-kicking stuck mid-segment items, the sweep now
    // also RE-ARMS persisted transient-retry schedules (retry_next_attempt_at)
    // whose in-process timers died with the previous gateway process.
    return await recoverInFlightRuns(runs, effectiveDeps);
  } catch (error) {
    logger.error('[diag-gateway] migration_execution_driver boot_recovery_failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return { recovered: 0, rekicked: 0, retriesRearmed: 0 };
  }
}
