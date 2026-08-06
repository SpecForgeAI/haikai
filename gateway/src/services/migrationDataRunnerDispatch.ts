/**
 * DB-plane data-migration runner dispatch (Spec W runner dispatch, Spec Y).
 *
 * Wires W's DB plane to the LIVE data-migration runner (Spec Y). When the DB
 * plane's schema is applied (the plane deploys), the phased executor fires this
 * before the data-parity reconcile: it gathers the run's source + target DB
 * credentials and the generated pack manifest, then POSTs the AMVS
 * `POST /api/data-migration/run` route, which executes the Phase-2 bulk load
 * (source -> forward-transform -> target) so the target is populated for the
 * data-parity comparison that follows.
 *
 * FAIL-SOFT + fire-and-forget: missing creds / pack => a clear skip trace, never
 * a throw. Credentials live in the in-memory stores only, travel in the request
 * body, and are never persisted or logged here.
 */
import { getConfig } from '../config';
import { logger } from './logger';
import { createTracer } from '../trace';
import {
  migrationTargetCredentialsStore,
  TargetDbSecret,
} from './migrationTargetCredentialsStore';
import { currentSystemCredentialsStore } from './baselineDriftScheduler';
import { defaultFetchPackView } from './migrationDbPackPlanner';
import type { MigrateScope, MigrationDriverDeps } from './migrationExecutionDriver';

const trace = createTracer('gateway');

export interface DataMigrationClientArgs {
  projectId: string;
  architectureId: string;
  sourceDb: TargetDbSecret;
  targetDb: TargetDbSecret;
  /** The pack MAIN manifest (carries `expected_schema`). */
  manifest: unknown;
  /** Optional bulk manifest (`table_order` + `expected_source_row_counts`). */
  bulkManifest?: unknown;
}

export interface DataMigrationClientResult {
  ok: boolean;
  status: string | null;
  rowsLoaded: number | null;
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

/** POST the AMVS data-migration run route (Spec Y). Never logs credentials. */
export async function runDataMigrationViaAmvs(
  args: DataMigrationClientArgs,
): Promise<DataMigrationClientResult> {
  const base = getConfig().apiMigrationValidationServiceBaseUrl;
  // AMVS mounts its ENTIRE router under /api-migration-validation, so the
  // route's own /api/data-migration/run path sits BELOW that prefix.
  // Omitting it 404s (same bug as the schema-apply client, fixed 2026-08-06).
  const url = `${base}/api-migration-validation/api/data-migration/run`;
  const body = {
    project_id: args.projectId,
    architecture_id: args.architectureId,
    source_db: toDbBlock(args.sourceDb),
    target_db: toDbBlock(args.targetDb),
    manifest: args.manifest,
    ...(args.bulkManifest ? { bulk_manifest: args.bulkManifest } : {}),
  };
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await resp.json().catch(() => ({}))) as {
    summary?: { status?: string; rows_loaded?: number };
    error?: string;
    detail?: string;
  };
  if (!resp.ok) {
    return {
      ok: false,
      status: null,
      rowsLoaded: null,
      error: json.error || json.detail || `HTTP ${resp.status}`,
    };
  }
  return {
    ok: true,
    status: json.summary?.status ?? null,
    rowsLoaded: json.summary?.rows_loaded ?? null,
  };
}

/** The pack shape this module reads (a subset of the DB pack manifest). */
interface PackManifestView {
  expected_schema?: unknown;
  bulk_load?: {
    table_order?: string[];
    expected_row_counts?: Record<string, number>;
  };
}

/** Injectable sub-dependencies (all real by default; mocked in tests). */
export interface DataMigrationTriggerDeps {
  getTargetDb?: (runId: string) => TargetDbSecret | undefined;
  getSourceDb?: (projectId: string) => TargetDbSecret | undefined;
  fetchPackView?: typeof defaultFetchPackView;
  runDataMigration?: typeof runDataMigrationViaAmvs;
}

/**
 * Build the DB-plane data-migration dispatch for the phased executor. Fire-and-
 * forget; NEVER throws.
 */
export function createDataMigrationTrigger(
  subDeps: DataMigrationTriggerDeps = {},
): (scope: MigrateScope, runId: string, deps: MigrationDriverDeps) => Promise<void> {
  const getTargetDb =
    subDeps.getTargetDb ?? ((runId: string) => migrationTargetCredentialsStore.getDb(runId));
  const getSourceDb =
    subDeps.getSourceDb ?? ((projectId: string) => currentSystemCredentialsStore.get(projectId)?.db);
  const fetchPackView = subDeps.fetchPackView ?? defaultFetchPackView;
  const runDataMigration = subDeps.runDataMigration ?? runDataMigrationViaAmvs;

  return async (scope, runId, deps) => {
    const corr = { run: runId, project: scope.project };
    try {
      const run = await deps.getMigrationExecutionRun(scope.projectId, runId);
      const bookId = run?.book_of_work_id ?? scope.bookId;
      const book = bookId ? await deps.fetchBookOfWork(scope.projectId, bookId) : null;
      const architectureId = book?.current_architecture_id ?? null;

      const targetDb = getTargetDb(runId);
      const sourceDb = getSourceDb(scope.projectId);
      const packView = architectureId
        ? await fetchPackView(scope.projectId, architectureId)
        : null;
      const manifest = packView?.manifest as PackManifestView | undefined;

      const missing: string[] = [];
      if (!architectureId) missing.push('current architecture id');
      if (!sourceDb) missing.push('source DB creds (register via baseline-drift-watch)');
      if (!targetDb) missing.push('target DB creds (register at Migrate confirm)');
      if (!manifest?.expected_schema) missing.push('DB pack manifest (expected_schema)');
      if (missing.length > 0) {
        logger.info('[diag-gateway] migration_execution_driver data_migration_skipped', {
          projectId: scope.projectId,
          runId,
          missing,
        });
        trace.warn(
          `data-migration runner SKIPPED — missing: ${missing.join('; ')}. ` +
            'Load the target manually (or register the creds) then approve.',
          corr,
        );
        return;
      }

      const bulk = manifest!.bulk_load;
      const bulkManifest =
        bulk && bulk.table_order
          ? {
              table_order: bulk.table_order,
              expected_source_row_counts: bulk.expected_row_counts ?? {},
            }
          : undefined;

      trace.step('data-migration runner (DB plane) — bulk load via AMVS', corr);
      const result = await runDataMigration({
        projectId: scope.projectId,
        architectureId: architectureId as string,
        sourceDb: sourceDb as TargetDbSecret,
        targetDb: targetDb as TargetDbSecret,
        manifest,
        bulkManifest,
      });
      if (result.ok) {
        trace.ok(
          `data-migration runner COMPLETED — status=${result.status ?? '?'} rows=${result.rowsLoaded ?? '?'}`,
          corr,
        );
      } else {
        trace.fail(`data-migration run failed: ${result.error ?? 'unknown'}`, corr);
      }
    } catch (err) {
      logger.error('[diag-gateway] migration_execution_driver data_migration_error', {
        projectId: scope.projectId,
        runId,
        error: err instanceof Error ? err.message : 'unknown',
      });
      trace.fail(
        `data-migration runner errored: ${err instanceof Error ? err.message.slice(0, 200) : 'unknown'}`,
        corr,
      );
    }
  };
}
