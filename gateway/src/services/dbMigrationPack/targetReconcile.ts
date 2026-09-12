/**
 * Reconcile the workbench-built target against the source OUTSIDE a migration
 * run (2026-09-12, owner ask: "after Build target, reconcile the full database
 * before Stage 1 is executed").
 *
 * Same engine the DB plane runs after its load: the pack manifest resolves the
 * table scope (FK-topological order, verified parity keys over manifest PKs,
 * surrogate keys excluded), the validation service compares source and target
 * row-by-row through the pair ruleset, and the report is persisted in AMS as
 * a data-parity report -- the SAME row the migrate gate and the progress
 * report read, so a clean workbench reconcile is evidence the plan can cite.
 * Credentials are request-scoped and never persisted. One reconcile per pack
 * at a time; the in-flight state and the last outcome live in memory (the
 * persisted report is the durable record).
 */

import { logger } from '../logger';
import { createTracer } from '../../trace';
import type { TargetDbSecret } from '../migrationTargetCredentialsStore';
import {
  defaultResolveDataParityTables,
  runDataParityReconcileViaAmvs,
  type DataParityTable,
} from '../migrationDataParityReconcile';

const trace = createTracer('gateway');

export interface TargetReconcileArgs {
  projectId: string;
  architectureId: string;
  packId: string;
  sourceDb: TargetDbSecret;
  targetDb: TargetDbSecret;
}

export interface TargetReconcileDeps {
  resolveTables?: (projectId: string, architectureId: string) => Promise<DataParityTable[]>;
  runReconcile?: typeof runDataParityReconcileViaAmvs;
  now?: () => Date;
}

export interface TargetReconcileOutcome {
  status: 'succeeded' | 'failed';
  /** The persisted AMS data-parity report id (null when persistence failed). */
  reportId: string | null;
  /** The report's summary status: clean | clean_sampled | divergent | unverifiable | empty. */
  parityStatus: string | null;
  tables: number;
  error: string | null;
  startedAt: string;
  endedAt: string;
}

export interface TargetReconcileInFlight {
  startedAt: number;
  phase: string;
  tables: number;
}

/** One reconcile per pack at a time. */
export const targetReconcileRegistry = new Map<string, TargetReconcileInFlight>();
/** The last outcome per pack (in memory; the AMS report is the durable record). */
export const lastTargetReconcile = new Map<string, TargetReconcileOutcome>();

export async function runTargetReconcile(
  args: TargetReconcileArgs,
  deps: TargetReconcileDeps = {},
): Promise<TargetReconcileOutcome> {
  const resolveTables = deps.resolveTables ?? defaultResolveDataParityTables;
  const runReconcile = deps.runReconcile ?? runDataParityReconcileViaAmvs;
  const now = deps.now ?? (() => new Date());
  const { projectId, architectureId, packId } = args;
  const startedAt = now();
  const corr = { project: projectId, arch: architectureId };
  const inFlight: TargetReconcileInFlight = { startedAt: startedAt.getTime(), phase: 'resolving tables', tables: 0 };
  targetReconcileRegistry.set(packId, inFlight);

  const finish = (outcome: Omit<TargetReconcileOutcome, 'startedAt' | 'endedAt'>): TargetReconcileOutcome => {
    const full: TargetReconcileOutcome = { ...outcome, startedAt: startedAt.toISOString(), endedAt: now().toISOString() };
    lastTargetReconcile.set(packId, full);
    targetReconcileRegistry.delete(packId);
    logger.info('[diag-gateway] proc_workbench target_reconcile_done', {
      projectId,
      packId,
      status: full.status,
      parityStatus: full.parityStatus,
      tables: full.tables,
      reportId: full.reportId,
      error: full.error,
    });
    return full;
  };

  try {
    const tables = await resolveTables(projectId, architectureId);
    if (tables.length === 0) {
      trace.warn('workbench reconcile SKIPPED — the pack manifest resolves no tables', corr);
      return finish({
        status: 'failed',
        reportId: null,
        parityStatus: null,
        tables: 0,
        error: 'the pack manifest resolves no tables to reconcile — regenerate the pack',
      });
    }
    inFlight.tables = tables.length;
    inFlight.phase = `comparing ${tables.length} table(s)`;
    trace.step(`workbench reconcile — ${tables.length} table(s) via AMVS`, corr);
    const result = await runReconcile({
      projectId,
      architectureId,
      sourceDb: args.sourceDb,
      targetDb: args.targetDb,
      tables,
    });
    if (!result.ok) {
      trace.fail(`workbench reconcile FAILED — ${result.error ?? 'unknown'}`, corr);
      return finish({
        status: 'failed',
        reportId: result.reportId,
        parityStatus: result.status,
        tables: tables.length,
        error: result.error ?? 'data-parity reconcile failed',
      });
    }
    trace.ok(
      `workbench reconcile ${result.status ?? 'done'} — report ${result.reportId ?? '(not persisted)'}`,
      corr,
    );
    return finish({
      status: 'succeeded',
      reportId: result.reportId,
      parityStatus: result.status,
      tables: tables.length,
      error: result.reportPersisted ? null : 'the report was produced but could not be persisted in AMS',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    trace.fail(`workbench reconcile crashed — ${message}`, corr);
    return finish({ status: 'failed', reportId: null, parityStatus: null, tables: inFlight.tables, error: message });
  }
}
