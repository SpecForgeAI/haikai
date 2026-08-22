/**
 * DB-plane data-parity reconcile trigger (Spec W — plane-based execution).
 *
 * Wires W's `triggerDataParityReconcile` seam to the LIVE AMVS data-parity
 * comparator (Spec P). When the DB plane deploys, the phased executor fires this
 * fire-and-forget: it gathers the run's source + target DB credentials and the
 * migrated table scope, then POSTs the AMVS `/api/data-parity/run` route, which
 * runs the comparison and persists the report to AMS. The human reviews that
 * report at the plane-boundary pause, and `resumeMigration`'s repositioned
 * data-parity gate reads the SAME persisted report.
 *
 * FAIL-SOFT by design: missing creds / table scope => a clear skip trace, never
 * a thrown error. The resume gate is the real enforcement — with no clean report
 * it blocks as `data_parity_unverified`, so a skipped auto-reconcile degrades to
 * "run it manually, then approve", never to a silent pass.
 *
 * Credential discipline: source + target DB secrets live in the in-memory
 * per-run / per-project stores only; they travel in the request body to the
 * AMVS route and are never persisted or logged here (only presence + counts).
 */
import { getConfig } from '../config';
import { logger } from './logger';
import { createTracer } from '../trace';
import {
  migrationTargetCredentialsStore,
  TargetDbSecret,
} from './migrationTargetCredentialsStore';
import { currentSystemCredentialsStore } from './baselineDriftScheduler';
import { defaultFetchPackView, orderedTables } from './migrationDbPackPlanner';
import type { MigrateScope, MigrationDriverDeps } from './migrationExecutionDriver';
// Long-running DB-plane wiring (2026-08-10): 6h cap + undici agent with
// per-request timeouts disabled — a bare fetch dies at 300s (headersTimeout).
import { longRunningPostJson } from './longRunningFetch';

const trace = createTracer('gateway');

export interface DataParityTable {
  schema: string | null;
  table: string;
  /**
   * The table's PRIMARY KEY columns from the pack manifest (2026-08-07):
   * threaded to AMVS as order_by + key_is_unique so the comparator joins
   * rows BY KEY instead of positional index-zipping — the zip across two
   * engines' collation orders manufactured the live filter_tag mass false
   * divergence. Null/absent = no PK known (AMVS falls back to canonical
   * multiset comparison under its full-scan bound).
   */
  primaryKey?: string[] | null;
}

export interface DataParityReconcileClientArgs {
  projectId: string;
  architectureId: string;
  sourceDb: TargetDbSecret;
  targetDb: TargetDbSecret;
  tables: DataParityTable[];
}

export interface DataParityReconcileClientResult {
  ok: boolean;
  reportPersisted: boolean;
  status: string | null;
  reportId: string | null;
  error?: string;
}

function toDbBlock(db: TargetDbSecret): Record<string, unknown> {
  return {
    db_type: db.dbType,
    host: db.host,
    port: db.port,
    database: db.database,
    schema: db.schema ?? null,
    username: db.username,
    password: db.password,
  };
}

/**
 * POST the AMVS data-parity run route (Spec P). Runs the comparison and persists
 * the report to AMS; returns the summary status + persisted report id. Never
 * logs the credential material.
 */
export async function runDataParityReconcileViaAmvs(
  args: DataParityReconcileClientArgs,
): Promise<DataParityReconcileClientResult> {
  const base = getConfig().apiMigrationValidationServiceBaseUrl;
  // AMVS mounts its ENTIRE router under /api-migration-validation, so the
  // route's own /api/data-parity/run path sits BELOW that prefix. Omitting
  // it 404s (same bug as the schema-apply client, fixed 2026-08-06).
  const url = `${base}/api-migration-validation/api/data-parity/run`;
  const body = {
    project_id: args.projectId,
    architecture_id: args.architectureId,
    source_db: toDbBlock(args.sourceDb),
    target_db: toDbBlock(args.targetDb),
    tables: args.tables.map((t) => ({
      table: t.table,
      schema: t.schema ?? null,
      ...(t.primaryKey && t.primaryKey.length > 0
        ? { order_by: t.primaryKey, key_is_unique: true }
        : {}),
    })),
  };
  const resp = await longRunningPostJson(url, body);
  const json = (await resp.json().catch(() => ({}))) as {
    report_id?: string | null;
    report_persisted?: boolean;
    report?: { summary?: { status?: string } };
    error?: string;
    detail?: string;
  };
  if (!resp.ok) {
    return {
      ok: false,
      reportPersisted: false,
      status: null,
      reportId: null,
      error: json.error || json.detail || `HTTP ${resp.status}`,
    };
  }
  return {
    ok: true,
    reportPersisted: json.report_persisted ?? false,
    status: json.report?.summary?.status ?? null,
    reportId: json.report_id ?? null,
  };
}

/**
 * Resolve the reconcile table scope from the DB pack manifest (the authoritative
 * list of migrated tables, in FK-topological order). Returns [] when no pack
 * exists — the caller then fail-soft skips.
 */
export async function defaultResolveDataParityTables(
  projectId: string,
  architectureId: string,
  fetchPackView: typeof defaultFetchPackView = defaultFetchPackView,
): Promise<DataParityTable[]> {
  const packView = await fetchPackView(projectId, architectureId);
  if (!packView) return [];
  // Per-table PRIMARY KEY columns from the manifest's expected schema — the
  // comparator's keyed-join anchor (2026-08-07).
  const pkByTable = new Map<string, string[]>();
  for (const key of packView.manifest.expected_schema?.keysAndIndexes ?? []) {
    const k = key as {
      kind?: string;
      schemaName?: string;
      tableName?: string;
      columns?: string[];
      isSurrogate?: boolean;
    };
    if (k.kind !== 'primary_key' || !Array.isArray(k.columns) || k.columns.length === 0) continue;
    // A SURROGATE PK (2026-08-08) exists only on the target with values
    // generated independently per side — keying the parity join on it would
    // match nothing and manufacture total divergence. Treat the table as
    // keyless: AMVS falls back to canonical multiset comparison.
    if (k.isSurrogate === true) continue;
    pkByTable.set(`${k.schemaName ?? ''}.${k.tableName ?? ''}`.toLowerCase(), k.columns);
  }
  return orderedTables(packView.manifest).map((qn) => {
    const dot = qn.indexOf('.');
    const entry: DataParityTable =
      dot > 0
        ? { schema: qn.slice(0, dot), table: qn.slice(dot + 1) }
        : { schema: null, table: qn };
    const pk = pkByTable.get(`${entry.schema ?? ''}.${entry.table}`.toLowerCase());
    if (pk) entry.primaryKey = pk;
    return entry;
  });
}

/** Injectable sub-dependencies (all real by default; mocked in tests). */
export interface DataParityReconcileTriggerDeps {
  getTargetDb?: (runId: string) => TargetDbSecret | undefined;
  getSourceDb?: (projectId: string) => TargetDbSecret | undefined;
  resolveTables?: (projectId: string, architectureId: string) => Promise<DataParityTable[]>;
  runReconcile?: typeof runDataParityReconcileViaAmvs;
}

/**
 * Build the DB-plane data-parity reconcile trigger for the phased executor's
 * `triggerDataParityReconcile` seam. Fire-and-forget; NEVER throws.
 */
export function createDataParityReconcileTrigger(
  subDeps: DataParityReconcileTriggerDeps = {},
): (scope: MigrateScope, runId: string, deps: MigrationDriverDeps) => Promise<void> {
  const getTargetDb =
    subDeps.getTargetDb ?? ((runId: string) => migrationTargetCredentialsStore.getDb(runId));
  const getSourceDb =
    subDeps.getSourceDb ?? ((projectId: string) => currentSystemCredentialsStore.get(projectId)?.db);
  const resolveTables =
    subDeps.resolveTables ?? ((p: string, a: string) => defaultResolveDataParityTables(p, a));
  const runReconcile = subDeps.runReconcile ?? runDataParityReconcileViaAmvs;

  return async (scope, runId, deps) => {
    const corr = { run: runId, project: scope.project };
    try {
      // Recover the current architecture id from the run's book of work.
      const run = await deps.getMigrationExecutionRun(scope.projectId, runId);
      const bookId = run?.book_of_work_id ?? scope.bookId;
      const book = bookId ? await deps.fetchBookOfWork(scope.projectId, bookId) : null;
      const architectureId = book?.current_architecture_id ?? null;

      const targetDb = getTargetDb(runId);
      const sourceDb = getSourceDb(scope.projectId);
      const tables = architectureId ? await resolveTables(scope.projectId, architectureId) : [];

      const missing: string[] = [];
      if (!architectureId) missing.push('current architecture id');
      if (!sourceDb) missing.push('source DB creds (register via baseline-drift-watch)');
      if (!targetDb) missing.push('target DB creds (register at Migrate confirm)');
      if (tables.length === 0) missing.push('table scope (DB pack manifest)');
      if (missing.length > 0) {
        logger.info('[diag-gateway] migration_execution_driver data_parity_reconcile_skipped', {
          projectId: scope.projectId,
          runId,
          missing,
        });
        trace.warn(
          `data-parity reconcile SKIPPED — missing: ${missing.join('; ')}. ` +
            'Run it manually (or register the creds) then approve.',
          corr,
        );
        return;
      }

      // Foundations Spec 4: cite the scope receipt so excluded tables are an
      // EXPLICIT slice of the reconcile story, never a silent absence.
      let receiptNote = '';
      try {
        const pv = await defaultFetchPackView(scope.projectId, architectureId as string);
        const receipt = pv?.manifest?.scope_receipt;
        if (receipt && (receipt.excluded.length > 0 || receipt.volatile.length > 0)) {
          receiptNote =
            ` — ${receipt.excluded.length} excluded / ${receipt.volatile.length} volatile ` +
            'table(s) out of reconciliation per foundation decisions';
        }
      } catch {
        // receipt is informational — never blocks the reconcile
      }
      trace.step(
        `data-parity reconcile (DB plane) — ${tables.length} table(s) via AMVS${receiptNote}`,
        corr,
      );
      const result = await runReconcile({
        projectId: scope.projectId,
        architectureId: architectureId as string,
        sourceDb: sourceDb as TargetDbSecret,
        targetDb: targetDb as TargetDbSecret,
        tables,
      });
      if (result.ok) {
        trace.ok(
          `data-parity reconcile COMPLETED — status=${result.status ?? '?'} ` +
            `persisted=${result.reportPersisted} report=${result.reportId ?? '-'}`,
          corr,
        );
      } else {
        trace.fail(`data-parity reconcile run failed: ${result.error ?? 'unknown'}`, corr);
      }
    } catch (err) {
      logger.error('[diag-gateway] migration_execution_driver data_parity_reconcile_error', {
        projectId: scope.projectId,
        runId,
        error: err instanceof Error ? err.message : 'unknown',
      });
      trace.fail(
        `data-parity reconcile errored: ${err instanceof Error ? err.message.slice(0, 200) : 'unknown'}`,
        corr,
      );
    }
  };
}
