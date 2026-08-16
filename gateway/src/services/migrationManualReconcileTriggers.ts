/**
 * Manual reconciliation triggers (2026-08-16) — the operator-facing "run the
 * rec(s) now" door behind the stakeholder progress report's modal.
 *
 * Two engines already exist server-side; this module only WIRES them to an
 * explicit operator kick with the credentials the modal collects:
 *
 *   - DATABASE reconciliation = the AMVS data-parity comparator (Spec P).
 *     Needs the CURRENT (source) + TARGET DB credentials and the pack's
 *     migrated-table scope; the report persists to AMS and the progress
 *     report / migrate gate read it. Same runner the DB-plane deploy fires
 *     automatically ({@link runDataParityReconcileViaAmvs}).
 *
 *   - SERVICE (API) reconciliation = the full-baseline reconcile
 *     ({@link triggerFullBaselineReconcile}) against the book's latest run:
 *     replays the ENTIRE pinned `kind='current'` baseline against the target
 *     (CD-B — an unfinished spec's endpoints simply surface as breaks) and
 *     persists breaks on the run. Needs the TARGET service base URL + auth;
 *     optional target-DB creds enable state-delta snapshots; optional
 *     CURRENT-service details feed the source-side replay store.
 *
 * BOTH kicks are FIRE-AND-FORGET: the runs take minutes-to-hours, so the
 * routes respond immediately with `started` and the operator refreshes the
 * progress report to see results land. Blocking preconditions (no pack
 * table scope, no run/pinned baseline, unresolved breaks latching the run,
 * missing credentials) are checked SYNCHRONOUSLY so the modal can say WHY
 * a rec cannot start, mirroring the driver's own latch rules.
 *
 * CREDENTIAL DISCIPLINE: everything the modal sends lands in the existing
 * in-memory stores only ({@link migrationTargetCredentialsStore} run-scoped,
 * {@link currentSystemCredentialsStore} project-scoped) — never persisted,
 * never logged; body blocks fall back to already-registered store values so
 * a re-run doesn't force re-typing.
 */

import { logger } from './logger';
import { createTracer } from '../trace';
import {
  DataParityTable,
  defaultResolveDataParityTables,
  runDataParityReconcileViaAmvs,
} from './migrationDataParityReconcile';
import {
  MigrationExecutionRun,
  getMigrationExecutionRunsForBook,
  patchMigrationExecutionRun,
} from './migrationExecutionRunClient';
import {
  TERMINAL_DISPOSITIONS,
  BREAK_DISPOSITION,
  getReconciliationBreaksForRun,
} from './migrationReconciliationBreakClient';
import {
  FullReconcileResult,
  ReconciliationDriverDeps,
  defaultReconciliationDriverDeps,
  triggerFullBaselineReconcile,
} from './migrationReconciliationDriver';
import {
  TargetApiAuthSecret,
  TargetDbSecret,
  migrationTargetCredentialsStore,
} from './migrationTargetCredentialsStore';
import { currentSystemCredentialsStore } from './baselineDriftScheduler';

const trace = createTracer('gateway');

// ============================================================================
// Request/result shapes (route body is gateway-native)
// ============================================================================

export const VALID_AUTH_TYPES = [
  'none',
  'bearer',
  'api_key_header',
  'api_key_query',
  'basic',
  'custom_header',
] as const;

export interface ManualDbBlock {
  dbType?: string;
  host?: string;
  port?: number;
  database?: string;
  schema?: string | null;
  username?: string;
  password?: string;
}

export interface ManualReconcileRequest {
  runDataParity: boolean;
  runApiReconcile: boolean;
  /** CURRENT-state (source) DB credentials — data-parity source side. */
  sourceDb?: ManualDbBlock | null;
  /** TARGET DB credentials — parity target side + reconcile state snapshots. */
  targetDb?: ManualDbBlock | null;
  /** TARGET service auth — the API reconcile replay target. */
  api?: (TargetApiAuthSecret & { type: string }) | null;
  /** TARGET service base URL (falls back to the run's persisted value). */
  targetBaseUrl?: string | null;
  /** CURRENT-state service details — source-side replay store. */
  sourceApi?: {
    currentBaseUrl?: string;
    api?: (TargetApiAuthSecret & { type: string }) | null;
  } | null;
}

export type ManualRecOutcome =
  | { status: 'started'; detail: string }
  | { status: 'blocked'; reason: string };

export interface ManualReconcileResult {
  dataParity: ManualRecOutcome | null;
  apiReconcile: ManualRecOutcome | null;
}

// ============================================================================
// Deps (DI seam)
// ============================================================================

export interface ManualReconcileDeps {
  resolveTables(projectId: string, architectureId: string): Promise<DataParityTable[]>;
  runParity: typeof runDataParityReconcileViaAmvs;
  getRunsForBook: typeof getMigrationExecutionRunsForBook;
  getBreaksForRun: typeof getReconciliationBreaksForRun;
  patchRun: typeof patchMigrationExecutionRun;
  triggerApiReconcile(
    run: MigrationExecutionRun,
    deps: ReconciliationDriverDeps,
  ): Promise<FullReconcileResult>;
  reconciliationDriverDeps(): ReconciliationDriverDeps;
  /** In-memory credential stores (never persisted / never logged). */
  registerTargetCreds(
    runId: string,
    api: TargetApiAuthSecret,
    db?: TargetDbSecret,
  ): void;
  getRegisteredTargetApi(runId: string): TargetApiAuthSecret | undefined;
  getRegisteredTargetDb(runId: string): TargetDbSecret | undefined;
  getRegisteredSourceDb(projectId: string): TargetDbSecret | undefined;
  upsertSourceDb(projectId: string, db: TargetDbSecret): void;
  upsertSourceApi(
    projectId: string,
    value: { currentBaseUrl: string; api: TargetApiAuthSecret },
  ): void;
}

export function defaultManualReconcileDeps(): ManualReconcileDeps {
  return {
    resolveTables: (p, a) => defaultResolveDataParityTables(p, a),
    runParity: runDataParityReconcileViaAmvs,
    getRunsForBook: getMigrationExecutionRunsForBook,
    getBreaksForRun: getReconciliationBreaksForRun,
    patchRun: patchMigrationExecutionRun,
    triggerApiReconcile: triggerFullBaselineReconcile,
    reconciliationDriverDeps: defaultReconciliationDriverDeps,
    registerTargetCreds: (runId, api, db) => {
      // Preserve any registered serve spec — set() replaces the bundle.
      const service = migrationTargetCredentialsStore.getService(runId);
      migrationTargetCredentialsStore.set(runId, api, db, service);
    },
    getRegisteredTargetApi: (runId) => migrationTargetCredentialsStore.get(runId),
    getRegisteredTargetDb: (runId) => migrationTargetCredentialsStore.getDb(runId),
    getRegisteredSourceDb: (projectId) => currentSystemCredentialsStore.get(projectId)?.db,
    upsertSourceDb: (projectId, db) => currentSystemCredentialsStore.upsertDb(projectId, db),
    upsertSourceApi: (projectId, value) =>
      currentSystemCredentialsStore.upsertApi(projectId, value),
  };
}

// ============================================================================
// Validation helpers (whole-or-invalid, mirroring the target-credentials route)
// ============================================================================

function parseDbBlock(
  raw: ManualDbBlock | null | undefined,
  label: string,
): { db?: TargetDbSecret; error?: string } {
  if (raw === undefined || raw === null) return {};
  const engineOk = raw.dbType === 'postgres' || raw.dbType === 'sybase';
  if (
    !engineOk ||
    !raw.host ||
    typeof raw.port !== 'number' ||
    !raw.database ||
    !raw.username ||
    typeof raw.password !== 'string' ||
    raw.password.length === 0
  ) {
    return {
      error: `${label} block must include { dbType: postgres|sybase, host, port, database, username, password }`,
    };
  }
  return {
    db: {
      dbType: raw.dbType as 'postgres' | 'sybase',
      host: raw.host,
      port: raw.port,
      database: raw.database,
      schema: raw.schema ?? null,
      username: raw.username,
      password: raw.password,
    },
  };
}

function validateAuth(
  raw: (TargetApiAuthSecret & { type: string }) | null | undefined,
  label: string,
): { api?: TargetApiAuthSecret; error?: string } {
  if (raw === undefined || raw === null) return {};
  if (!VALID_AUTH_TYPES.includes(raw.type as (typeof VALID_AUTH_TYPES)[number])) {
    return { error: `${label} auth type '${raw.type}' is invalid` };
  }
  return { api: raw };
}

// ============================================================================
// The trigger
// ============================================================================

export async function startManualReconciliation(
  args: {
    projectId: string;
    architectureId: string;
    bookId: string;
    request: ManualReconcileRequest;
  },
  deps: ManualReconcileDeps = defaultManualReconcileDeps(),
): Promise<{ ok: true; result: ManualReconcileResult } | { ok: false; error: string }> {
  const { projectId, architectureId, bookId, request } = args;
  if (!request.runDataParity && !request.runApiReconcile) {
    return { ok: false, error: 'Select at least one reconciliation to run.' };
  }

  // --- Whole-or-400 input validation (before ANY side effect). -------------
  const sourceDb = parseDbBlock(request.sourceDb, 'source_db');
  if (sourceDb.error) return { ok: false, error: sourceDb.error };
  const targetDb = parseDbBlock(request.targetDb, 'target_db');
  if (targetDb.error) return { ok: false, error: targetDb.error };
  const targetAuth = validateAuth(request.api, 'target');
  if (targetAuth.error) return { ok: false, error: targetAuth.error };
  const sourceAuth = validateAuth(request.sourceApi?.api, 'source');
  if (sourceAuth.error) return { ok: false, error: sourceAuth.error };

  const result: ManualReconcileResult = { dataParity: null, apiReconcile: null };
  const corr = { project: projectId };

  // --- DATABASE reconciliation (data parity). ------------------------------
  if (request.runDataParity) {
    // Body creds win; fall back to the already-registered store values so a
    // re-run doesn't force re-typing after they registered once.
    const runsForFallback = request.runApiReconcile || !request.sourceDb || !request.targetDb
      ? await deps.getRunsForBook(projectId, bookId).catch(() => [] as MigrationExecutionRun[])
      : [];
    const latestRunId = runsForFallback[0]?.id ?? null;
    const effectiveSource = sourceDb.db ?? deps.getRegisteredSourceDb(projectId);
    const effectiveTarget =
      targetDb.db ?? (latestRunId ? deps.getRegisteredTargetDb(latestRunId) : undefined);

    if (!effectiveSource || !effectiveTarget) {
      const missing = [
        ...(!effectiveSource ? ['current-state (source) DB credentials'] : []),
        ...(!effectiveTarget ? ['target DB credentials'] : []),
      ];
      result.dataParity = { status: 'blocked', reason: `Missing ${missing.join(' and ')}.` };
    } else {
      const tables = await deps
        .resolveTables(projectId, architectureId)
        .catch(() => [] as DataParityTable[]);
      if (tables.length === 0) {
        result.dataParity = {
          status: 'blocked',
          reason:
            'No migrated-table scope — the DB migration pack (and its manifest) must exist first.',
        };
      } else {
        // Keep the drift-watch store current (merge-not-clobber precedent).
        if (sourceDb.db) deps.upsertSourceDb(projectId, sourceDb.db);
        trace.step(`manual data-parity reconcile — ${tables.length} table(s) via AMVS`, corr);
        void deps
          .runParity({
            projectId,
            architectureId,
            sourceDb: effectiveSource,
            targetDb: effectiveTarget,
            tables,
          })
          .then((r) => {
            if (r.ok) {
              trace.ok(
                `manual data-parity reconcile COMPLETED — status=${r.status ?? '?'} ` +
                  `persisted=${r.reportPersisted} report=${r.reportId ?? '-'}`,
                corr,
              );
            } else {
              trace.fail(`manual data-parity reconcile failed: ${r.error ?? 'unknown'}`, corr);
            }
          })
          .catch((err) => {
            logger.error('[diag-gateway] manual_data_parity_error', {
              projectId,
              error: err instanceof Error ? err.message : String(err),
            });
          });
        result.dataParity = {
          status: 'started',
          detail: `Comparing ${tables.length} migrated table(s); the report lands on this screen when done.`,
        };
      }
    }
  }

  // --- SERVICE (API) reconciliation (full-baseline replay). ----------------
  if (request.runApiReconcile) {
    const runs = await deps
      .getRunsForBook(projectId, bookId)
      .catch(() => [] as MigrationExecutionRun[]);
    const run = runs[0] ?? null;
    if (!run?.id) {
      result.apiReconcile = {
        status: 'blocked',
        reason:
          'No migration execution run exists for this book — the API reconcile replays the run\'s pinned baseline.',
      };
    } else if (!run.pinned_current_baseline_id) {
      result.apiReconcile = {
        status: 'blocked',
        reason: 'The latest run has no pinned current-state baseline to replay.',
      };
    } else {
      const effectiveBaseUrl = request.targetBaseUrl?.trim() || run.target_base_url || null;
      const effectiveApi = targetAuth.api ?? deps.getRegisteredTargetApi(run.id);
      if (!effectiveBaseUrl) {
        result.apiReconcile = {
          status: 'blocked',
          reason: 'A target service base URL is required (none on the run, none provided).',
        };
      } else if (!effectiveApi) {
        result.apiReconcile = {
          status: 'blocked',
          reason: 'Target service auth is required (none registered for the run, none provided).',
        };
      } else {
        // Mirror the driver's latch SYNCHRONOUSLY so the modal can say why:
        // non-terminal breaks own the bug loop; all-terminal unlatches.
        const breaks = await deps
          .getBreaksForRun(projectId, run.id)
          .catch(() => []);
        const nonTerminal = breaks.filter(
          (b) => !TERMINAL_DISPOSITIONS.includes(b.disposition_status ?? BREAK_DISPOSITION.OPEN),
        );
        if (nonTerminal.length > 0) {
          result.apiReconcile = {
            status: 'blocked',
            reason:
              `${nonTerminal.length} unresolved break(s) from the previous reconcile — ` +
              'resolve or dispose them on the delivery dashboard, then re-run.',
          };
        } else {
          deps.registerTargetCreds(
            run.id,
            effectiveApi,
            targetDb.db ?? deps.getRegisteredTargetDb(run.id),
          );
          if (request.sourceApi?.currentBaseUrl && sourceAuth.api) {
            deps.upsertSourceApi(projectId, {
              currentBaseUrl: request.sourceApi.currentBaseUrl,
              api: sourceAuth.api,
            });
          }
          if (sourceDb.db) deps.upsertSourceDb(projectId, sourceDb.db);
          // Persist a NEW target base URL so future auto-reconciles agree.
          if (request.targetBaseUrl?.trim() && request.targetBaseUrl.trim() !== run.target_base_url) {
            await deps
              .patchRun(projectId, run.id, { target_base_url: request.targetBaseUrl.trim() })
              .catch((err) => {
                logger.warn('[diag-gateway] manual_api_reconcile target_url_patch_failed', {
                  projectId,
                  runId: run.id,
                  error: err instanceof Error ? err.message : String(err),
                });
              });
          }
          const effectiveRun: MigrationExecutionRun = {
            ...run,
            target_base_url: effectiveBaseUrl,
          };
          trace.step('manual full-baseline API reconcile kicked', { ...corr, run: run.id });
          void deps
            .triggerApiReconcile(effectiveRun, deps.reconciliationDriverDeps())
            .then((r) => {
              trace.ok(`manual API reconcile finished — status=${r.status}`, {
                ...corr,
                run: run.id,
              });
            })
            .catch((err) => {
              logger.error('[diag-gateway] manual_api_reconcile_error', {
                projectId,
                runId: run.id,
                error: err instanceof Error ? err.message : String(err),
              });
            });
          result.apiReconcile = {
            status: 'started',
            detail:
              'Replaying the full pinned baseline against the target; breaks land on the delivery dashboard and this screen.',
          };
        }
      }
    }
  }

  logger.info('[diag-gateway] migration_manual_reconcile requested', {
    projectId,
    bookId,
    dataParity: result.dataParity?.status ?? 'not_requested',
    apiReconcile: result.apiReconcile?.status ?? 'not_requested',
  });
  return { ok: true, result };
}
