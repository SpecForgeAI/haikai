/**
 * DB-plane completion chain (WS2, 2026-07-31).
 *
 * Why: the plane reframe wired data-migration (Y) + data-parity reconcile (P)
 * behind a `deployed` build-results outcome — but `deployed` can only come
 * from IVS's haibox APP-SERVING deploy, which a DB pack can never produce
 * (nothing to serve), and schema-apply (X) was Liquibase-on-boot at
 * deploy-compose time, unreachable in a native stage-1 run. Net effect (live
 * 2026-07-30): the run "just ran the 15 specs" and the target database was
 * never initiated, loaded, or reconciled.
 *
 * The chain runs when the LAST db-plane item reports `implemented`
 * (user-locked decision 2026-07-31: fully automatic, pausing only on the
 * parity report review):
 *
 *   1. ASSEMBLE  — IVS merges the run's per-spec branches into ONE new
 *      branch, overlays the COMPLETE pack (fetched here from AMS and inlined
 *      — IVS never talks to AMS), validates the runnable-pack invariants,
 *      pushes + opens the MR. Polled via GET /api/v2/jobs/{id}.
 *   2. SCHEMA-APPLY structural — AMVS executes the pack's structural
 *      changesets (schemas + tables) against the registered target DB.
 *   3. DATA LOAD — the Spec-Y bulk load via AMVS (source -> forward
 *      transform -> target), called DIRECTLY (not the fire-and-forget
 *      trigger seam) because the chain needs the pass/fail result.
 *   4. SCHEMA-APPLY post-load — FKs + indexes + sequence reseed.
 *   5. RECONCILE — the existing data-parity trigger persists the report;
 *      an unclean report blocks the next plane's Start (that gate + the
 *      parityOverride break-glass IS the human pause).
 *   6. FINALIZE — final item DEPLOYED (+ the assembled MR as pr_url); run
 *      AWAITING_APPROVAL when later planes remain, else DEPLOYED.
 *
 * Every failure patches the item FAILED with a PHASE-LABELLED error and
 * halts the run — no more "completed successfully" beside a dead database.
 * Credentials come from the in-memory per-run stores and travel in request
 * bodies only; they are never logged or persisted here.
 */
import { getConfig } from '../config';
import { logger } from './logger';
import { createTracer } from '../trace';
import { request as ivsRequest } from './implementationLlmProxyClient';
import {
  migrationTargetCredentialsStore,
  TargetDbSecret,
} from './migrationTargetCredentialsStore';
import { currentSystemCredentialsStore } from './baselineDriftScheduler';
import { defaultFetchPackView } from './migrationDbPackPlanner';
import {
  runDataMigrationViaAmvs,
  DataMigrationClientResult,
} from './migrationDataRunnerDispatch';
import {
  RUN_STATUS,
  RUN_ITEM_STATUS,
  MigrationExecutionRun,
  MigrationExecutionRunItem,
} from './migrationExecutionRunClient';
import type { MigrateScope, MigrationDriverDeps } from './migrationExecutionDriver';
// Long-running DB-plane wiring (2026-08-10): 6h cap + undici agent with
// per-request timeouts disabled — a bare fetch dies at 300s (headersTimeout).
import { longRunningPostJson } from './longRunningFetch';
import { evaluateProcParityReadiness } from './migrationProcParityGate';

const trace = createTracer('gateway');

/** One pack file as fetched from AMS and forwarded to IVS/AMVS. */
export interface PackFilePayload {
  path: string;
  content: string;
  kind?: string | null;
}

export interface AssemblySubmitInput {
  company: string;
  project: string;
  branchName: string;
  specNames: string[];
  packFiles: PackFilePayload[];
}

export interface AssemblySubmitResult {
  ok: boolean;
  jobId: string | null;
  error?: string;
}

export interface PolledJob {
  status: string;
  result?: Record<string, unknown> | null;
  error?: string | null;
}

export interface SchemaApplyArgs {
  projectId: string;
  architectureId: string;
  targetDb: TargetDbSecret;
  files: PackFilePayload[];
  contexts: Array<'structural' | 'post-load'>;
}

export interface SchemaApplyCallResult {
  ok: boolean;
  applied: number;
  skipped: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Default sub-dependency implementations (all injectable in tests)
// ---------------------------------------------------------------------------

/** Fetch the pack's FULL file set from AMS (paths + contents). */
export async function defaultFetchPackFiles(
  projectId: string,
  packId: string
): Promise<PackFilePayload[]> {
  const base = getConfig().architectureModelServiceBaseUrl;
  const url =
    `${base}/api/projects/${encodeURIComponent(projectId)}` +
    `/db-migration-packs/${encodeURIComponent(packId)}/files`;
  const resp = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!resp.ok) {
    throw new Error(`AMS pack files fetch failed: HTTP ${resp.status}`);
  }
  const rows = (await resp.json()) as Array<{
    file_path?: string;
    content?: string;
    file_kind?: string | null;
  }>;
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => typeof r.file_path === 'string' && typeof r.content === 'string')
    .map((r) => ({ path: r.file_path as string, content: r.content as string, kind: r.file_kind ?? null }));
}

/** POST the IVS assembly job (server-to-server via the proxy client). */
export async function defaultSubmitAssembly(
  input: AssemblySubmitInput
): Promise<AssemblySubmitResult> {
  try {
    const resp = await ivsRequest('/api/v2/jobs/assemblies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: {
        company: input.company,
        project: input.project,
        branch_name: input.branchName,
        spec_names: input.specNames,
        pack_files: input.packFiles.map((f) => ({ path: f.path, content: f.content })),
        open_merge_request: true,
      },
    });
    const body = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
    if (!resp.ok) {
      const detail = (body.detail as string) ?? (body.error as string) ?? `HTTP ${resp.status}`;
      return { ok: false, jobId: null, error: detail };
    }
    const jobId = body.job_id as string | undefined;
    if (!jobId) return { ok: false, jobId: null, error: 'assembly submit returned no job_id' };
    return { ok: true, jobId };
  } catch (error) {
    return {
      ok: false,
      jobId: null,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/** GET one IVS job's status/result. */
export async function defaultGetJobStatus(jobId: string): Promise<PolledJob | null> {
  const resp = await ivsRequest(`/api/v2/jobs/${encodeURIComponent(jobId)}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!resp.ok) return null;
  const body = (await resp.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return null;
  return {
    status: String(body.status ?? ''),
    result: (body.result as Record<string, unknown>) ?? null,
    error: (body.error as string) ?? null,
  };
}

/** POST the AMVS schema-apply route. Never logs credentials. */
export async function defaultApplySchema(
  args: SchemaApplyArgs
): Promise<SchemaApplyCallResult> {
  const base = getConfig().apiMigrationValidationServiceBaseUrl;
  // AMVS mounts its ENTIRE router under /api-migration-validation
  // (index.ts: app.use('/api-migration-validation', ...)), so the route's
  // own /api/schema-apply/run path sits BELOW that prefix. Omitting it 404s
  // (live 2026-08-06: the DB chain halted at "schema-apply structural:
  // HTTP 404").
  const url = `${base}/api-migration-validation/api/schema-apply/run`;
  const body = {
    project_id: args.projectId,
    architecture_id: args.architectureId,
    target_db: {
      db_type: args.targetDb.dbType,
      host: args.targetDb.host,
      port: args.targetDb.port,
      database: args.targetDb.database,
      schema: args.targetDb.schema ?? null,
      username: args.targetDb.username,
      password: args.targetDb.password,
    },
    files: args.files.map((f) => ({ path: f.path, content: f.content })),
    contexts: args.contexts,
  };
  const resp = await longRunningPostJson(url, body);
  let parseFailed = false;
  const json = (await resp.json().catch(() => {
    parseFailed = true;
    return {};
  })) as {
    summary?: { applied?: number; skipped?: number };
    error?: string;
    detail?: string;
    failed_changeset?: { id?: string; error?: string };
    issues?: string[];
  };
  if (!resp.ok) {
    const failed = json.failed_changeset
      ? ` (changeset ${json.failed_changeset.id}: ${json.failed_changeset.error})`
      : '';
    const issues = json.issues?.length ? ` [${json.issues.join('; ')}]` : '';
    return {
      ok: false,
      applied: json.summary?.applied ?? 0,
      skipped: json.summary?.skipped ?? 0,
      error: `${json.error || json.detail || `HTTP ${resp.status}`}${failed}${issues}`,
    };
  }
  if (parseFailed) {
    // A 2xx whose body does not parse is an integrity violation, NOT a
    // success -- treating it as ok/applied:0 would let the chain proceed
    // past a schema apply it cannot actually account for (2026-08-01).
    return {
      ok: false,
      applied: 0,
      skipped: 0,
      error: `schema-apply returned HTTP ${resp.status} with an unparseable body`,
    };
  }
  return {
    ok: true,
    applied: json.summary?.applied ?? 0,
    skipped: json.summary?.skipped ?? 0,
  };
}

// ---------------------------------------------------------------------------
// The chain
// ---------------------------------------------------------------------------

export interface DbPlaneCompletionSubDeps {
  fetchPackView?: typeof defaultFetchPackView;
  fetchPackFiles?: typeof defaultFetchPackFiles;
  submitAssembly?: typeof defaultSubmitAssembly;
  getJobStatus?: typeof defaultGetJobStatus;
  applySchema?: typeof defaultApplySchema;
  runDataMigration?: typeof runDataMigrationViaAmvs;
  getTargetDb?: (runId: string) => TargetDbSecret | undefined;
  getSourceDb?: (projectId: string) => TargetDbSecret | undefined;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
}

/** A phase-labelled chain failure (the label lands on the run-item). */
class ChainError extends Error {
  constructor(public readonly phase: string, message: string) {
    super(message);
  }
}

async function safePatchItem(
  deps: MigrationDriverDeps,
  projectId: string,
  itemId: string,
  patch: Record<string, unknown>
): Promise<void> {
  try {
    await deps.patchMigrationExecutionRunItem(projectId, itemId, patch);
  } catch (error) {
    logger.error('[diag-gateway] db_plane_completion item_patch_failed', {
      projectId,
      itemId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

async function safePatchRun(
  deps: MigrationDriverDeps,
  projectId: string,
  runId: string,
  patch: Record<string, unknown>
): Promise<void> {
  try {
    await deps.patchMigrationExecutionRun(projectId, runId, patch);
  } catch (error) {
    logger.error('[diag-gateway] db_plane_completion run_patch_failed', {
      projectId,
      runId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Build the chain runner. Fire-and-forget from the driver's perspective
 * (kicked detached); everything here is failure-isolated onto the run state.
 */
export function createDbPlaneCompletionRunner(subDeps: DbPlaneCompletionSubDeps = {}) {
  const fetchPackView = subDeps.fetchPackView ?? defaultFetchPackView;
  const fetchPackFiles = subDeps.fetchPackFiles ?? defaultFetchPackFiles;
  const submitAssembly = subDeps.submitAssembly ?? defaultSubmitAssembly;
  const getJobStatus = subDeps.getJobStatus ?? defaultGetJobStatus;
  const applySchema = subDeps.applySchema ?? defaultApplySchema;
  const runDataMigration = subDeps.runDataMigration ?? runDataMigrationViaAmvs;
  const getTargetDb =
    subDeps.getTargetDb ?? ((runId: string) => migrationTargetCredentialsStore.getDb(runId));
  const getSourceDb =
    subDeps.getSourceDb ??
    ((projectId: string) => currentSystemCredentialsStore.get(projectId)?.db);
  const pollIntervalMs = subDeps.pollIntervalMs ?? 3000;
  const pollTimeoutMs = subDeps.pollTimeoutMs ?? 15 * 60 * 1000;

  return async function runDbPlaneCompletion(
    scope: MigrateScope,
    run: MigrationExecutionRun,
    item: MigrationExecutionRunItem,
    deps: MigrationDriverDeps
  ): Promise<void> {
    const projectId = scope.projectId;
    const runId = run.id as string;
    const itemId = item.id as string;
    const corr = { run: runId, project: scope.project };
    let phase = 'inputs';
    let mrUrl: string | null = null;

    try {
      trace.step('DB execution chain — assemble, apply schema, load, reconcile', corr);

      // ---- inputs -------------------------------------------------------
      const bookId = run.book_of_work_id ?? scope.bookId;
      const book = bookId ? await deps.fetchBookOfWork(projectId, bookId) : null;
      const architectureId = book?.current_architecture_id ?? null;
      if (!architectureId) {
        throw new ChainError('inputs', 'no current architecture id on the book of work');
      }
      const packView = await fetchPackView(projectId, architectureId);
      if (!packView) {
        throw new ChainError(
          'inputs',
          'no DB migration pack exists for the current architecture — regenerate the pack'
        );
      }
      const targetDb = getTargetDb(runId);
      if (!targetDb) {
        throw new ChainError(
          'inputs',
          'target DB credentials are not registered for this run (they are held ' +
            'in-memory and lost on a gateway restart) — halt and re-run Start, ' +
            're-entering the target DB password'
        );
      }
      const sourceDb = getSourceDb(projectId);
      if (!sourceDb) {
        throw new ChainError(
          'inputs',
          'source DB credentials are not registered (register via baseline-drift-watch)'
        );
      }
      const packFiles = await fetchPackFiles(projectId, packView.packId);
      if (packFiles.length === 0) {
        throw new ChainError('inputs', `pack ${packView.packId} has no files in AMS`);
      }

      // ---- 1. assemble --------------------------------------------------
      phase = 'assemble';
      const runIdShort =
        String(runId).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || 'run';
      const branchName = `db-migration/${runIdShort}`;
      const specNames = (run.items ?? [])
        .slice()
        .sort((a, b) => (a.sequence_position ?? 0) - (b.sequence_position ?? 0))
        .map((i) => i.spec_name)
        .filter((s): s is string => typeof s === 'string' && s !== '');
      if (specNames.length === 0) {
        throw new ChainError('assemble', 'the run has no spec names to assemble');
      }
      trace.step(`assembling ${specNames.length} spec branch(es) -> ${branchName}`, corr);
      const submit = await submitAssembly({
        company: scope.company,
        project: scope.project,
        branchName,
        specNames,
        packFiles,
      });
      if (!submit.ok || !submit.jobId) {
        throw new ChainError('assemble', `assembly submit rejected: ${submit.error ?? 'no job id'}`);
      }
      const deadline = Date.now() + pollTimeoutMs;
      let assembled: PolledJob | null = null;
      for (;;) {
        const job = await getJobStatus(submit.jobId);
        if (job) {
          if (job.status === 'completed') {
            assembled = job;
            break;
          }
          if (job.status === 'failed' || job.status === 'cancelled') {
            throw new ChainError('assemble', `assembly job ${job.status}: ${job.error ?? 'no detail'}`);
          }
        }
        if (Date.now() >= deadline) {
          throw new ChainError(
            'assemble',
            `assembly job ${submit.jobId} did not complete within ${Math.round(pollTimeoutMs / 1000)}s`
          );
        }
        await sleep(pollIntervalMs);
      }
      mrUrl = (assembled.result?.mr_url as string | undefined) ?? null;
      const assembledBranch = (assembled.result?.branch as string | undefined) ?? branchName;
      if (mrUrl) {
        await safePatchItem(deps, projectId, itemId, { pr_url: mrUrl });
      }
      trace.ok(`assembled ${assembledBranch}${mrUrl ? ` — MR ${mrUrl}` : ''}`, corr);

      // ---- 2. schema apply (structural) ---------------------------------
      phase = 'schema-apply structural';
      const liquibaseFiles = packFiles.filter((f) => f.path.replace(/\\/g, '/').startsWith('liquibase/'));
      if (liquibaseFiles.length === 0) {
        throw new ChainError(phase, 'the pack contains no liquibase/ files to apply');
      }
      const structural = await applySchema({
        projectId,
        architectureId,
        targetDb,
        files: liquibaseFiles,
        contexts: ['structural'],
      });
      if (!structural.ok) {
        throw new ChainError(phase, structural.error ?? 'schema apply failed');
      }
      trace.ok(
        `schema applied (structural) — ${structural.applied} changeset(s), ${structural.skipped} skipped`,
        corr
      );

      // ---- 3. data load -------------------------------------------------
      phase = 'data load';
      const manifest = packView.manifest as {
        bulk_load?: { table_order?: string[]; expected_row_counts?: Record<string, number> };
      };
      const bulk = manifest?.bulk_load;
      const bulkManifest =
        bulk && bulk.table_order
          ? {
              table_order: bulk.table_order,
              expected_source_row_counts: bulk.expected_row_counts ?? {},
            }
          : undefined;
      const load: DataMigrationClientResult = await runDataMigration({
        projectId,
        architectureId,
        sourceDb,
        targetDb,
        manifest,
        bulkManifest,
      });
      if (!load.ok) {
        throw new ChainError(phase, load.error ?? 'data migration failed');
      }
      trace.ok(`data loaded — status=${load.status ?? '?'} rows=${load.rowsLoaded ?? '?'}`, corr);

      // ---- 4. schema apply (post-load) ----------------------------------
      phase = 'schema-apply post-load';
      const postLoad = await applySchema({
        projectId,
        architectureId,
        targetDb,
        files: liquibaseFiles,
        contexts: ['post-load'],
      });
      if (!postLoad.ok) {
        throw new ChainError(phase, postLoad.error ?? 'schema apply failed');
      }
      trace.ok(
        `schema applied (post-load) — ${postLoad.applied} changeset(s), ${postLoad.skipped} skipped`,
        corr
      );

      // ---- 5. reconcile (report is the outcome; never fails the chain) --
      phase = 'reconcile';
      const reconcile = deps.triggerDataParityReconcile;
      if (reconcile) {
        await reconcile(scope, runId, deps).catch((error: unknown) => {
          logger.error('[diag-gateway] db_plane_completion reconcile_failed', {
            projectId,
            runId,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
          trace.warn(
            'data-parity reconcile errored — the parity report stays unclean, so the next plane is blocked until it is produced',
            corr
          );
        });
      }

      // ---- 6. proc parity re-check (Spec 5; report is the outcome) ------
      phase = 'proc-parity';
      const procReconcile = deps.triggerProcParityReconcile;
      if (procReconcile) {
        await procReconcile(scope, runId, deps).catch((error: unknown) => {
          logger.error('[diag-gateway] db_plane_completion proc_parity_failed', {
            projectId,
            runId,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
          trace.warn(
            'proc-parity re-check errored — no execution report; the graduated gate reads the workbench verdicts instead',
            corr
          );
        });
      }

      // ---- 7. finalize --------------------------------------------------
      phase = 'finalize';
      const fresh = await deps.getMigrationExecutionRun(projectId, runId).catch(() => null);
      const items = fresh?.items ?? run.items ?? [];
      const isBatch =
        item.job_id != null && items.length > 1 && items.every((i) => i.job_id === item.job_id);
      const toDeploy = isBatch ? items : items.filter((i) => i.id === itemId);
      for (const target of toDeploy) {
        if (!target.id) continue;
        await safePatchItem(deps, projectId, target.id, {
          status: RUN_ITEM_STATUS.DEPLOYED,
          outcome: 'deployed',
          // Invariant: a DEPLOYED item carries no error residue. The retry
          // path already nulls this before re-kicking; clearing here too
          // keeps the invariant local (2026-08-01).
          error_detail: null,
          ...(mrUrl ? { pr_url: mrUrl } : {}),
        });
      }
      const hasPendingLater = items.some(
        (i) => i.id !== itemId && i.status === RUN_ITEM_STATUS.PENDING
      );
      // Spec 5 graduated gate, FINAL-plane leg: when nothing comes after the
      // DB plane (a DB-only migration included) the run completes DEPLOYED and
      // every non-reconciled routine is recorded as a FINDING on the run's
      // decision log (`proc_parity_findings`) — never a block. (A dedicated
      // `completed_with_findings` run status would re-block the next plane's
      // precedence check and every status consumer, so the findings entry IS
      // the with-findings marker.)
      let findingsNote = '';
      if (!hasPendingLater) {
        const procGate = await evaluateProcParityReadiness({
          projectId,
          architectureId,
          nextPlane: null,
          reads: deps.procParityGateReads,
        });
        if (procGate.findings.length > 0) {
          findingsNote = ` WITH FINDINGS — ${procGate.findings.length} stored routine(s) not reconciled`;
          await safePatchRun(deps, projectId, runId, {
            decision_log_json: [
              ...(fresh?.decision_log_json ?? run.decision_log_json ?? []),
              {
                type: 'proc_parity_findings',
                at: new Date().toISOString(),
                routines: procGate.findings.map((f) => ({ routine: f.routine, state: f.state, detail: f.detail })),
                counts: procGate.counts,
                note:
                  'DB plane completed with findings: these stored routines are not reconciled ' +
                  '(divergent / unverified / not captured / not migrated). Nothing blocks — ' +
                  'resolve them from the pack workbench (loop, guidance & retry, or waive with a reason).',
              },
            ],
          });
          for (const line of procGate.warnings) trace.warn(line, corr);
        }
      }
      await safePatchRun(deps, projectId, runId, {
        status: hasPendingLater ? RUN_STATUS.AWAITING_APPROVAL : RUN_STATUS.DEPLOYED,
      });
      logger.info('[diag-gateway] db_plane_completion chain_complete', {
        projectId,
        runId,
        branch: assembledBranch,
        mrUrl,
        pausedForApproval: hasPendingLater,
        procParityFindings: findingsNote.length > 0,
      });
      trace.ok(
        hasPendingLater
          ? 'DB plane complete — run PAUSED for approval (review the parity reports, then approve & continue)'
          : `DB plane complete — run DEPLOYED${findingsNote} (review the parity reports before starting the next stage)`,
        corr
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      const label = error instanceof ChainError ? error.phase : phase;
      logger.error('[diag-gateway] db_plane_completion chain_failed', {
        projectId,
        runId,
        itemId,
        phase: label,
        error: message,
      });
      await safePatchItem(deps, projectId, itemId, {
        status: RUN_ITEM_STATUS.FAILED,
        outcome: 'failed',
        error_detail: `DB execution chain failed at ${label}: ${message}`,
        ...(mrUrl ? { pr_url: mrUrl } : {}),
      });
      await safePatchRun(deps, projectId, runId, { status: RUN_STATUS.HALTED });
      trace.fail(`DB execution chain FAILED at ${label}: ${message.slice(0, 300)}`, corr);
    }
  };
}
