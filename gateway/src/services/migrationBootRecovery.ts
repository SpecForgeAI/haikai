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
 * The default discovery: the gateway has no cross-project in-flight-run index in
 * v1, so it returns an empty set. The sweep then logs a structured no-op. This
 * is the clean extension point for a future AMS cross-project list endpoint.
 */
export const defaultInFlightRunDiscovery: InFlightRunDiscovery = async () => [];

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
