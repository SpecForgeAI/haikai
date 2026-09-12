/**
 * Translation workbench routes (Stored Proc & Function Behaviour Program,
 * Spec 4, 2026-09-09) on the pack base `/api/v1/projects/:projectId/db-migration-packs/:packId`:
 *
 *   POST /target/build                       { target_db, source_db?, rebuild? }        -> 202 { accepted, build_id }
 *   GET  /target/build/status                                                            -> { in_flight, latest }
 *   POST /translations/translate-and-reconcile { target_db, translation_ids? }         -> 202 { accepted, routines }
 *   GET  /translations/loop-status                                                       -> registry state
 *   POST /translations/:translationId/retry-loop { target_db, guidance }               -> 202
 *   POST /translations/:translationId/reconcile  { target_db }                         -> 200 { report summary }
 *   POST /translations/:translationId/waive      { scope: routine|scenario, scenario?, dimension?, reason }
 *   POST /translations/approve-all-reconciled                                           -> { approved_count, skipped }
 *
 * Credentials are per-invocation in the body (parsed whole-or-null, like the
 * pack Verify action); the source block falls back to the registered
 * current-system credentials. Nothing is persisted.
 */

import { Router, type Request, type Response } from 'express';
import { logger } from '../services/logger';
import { parseDbCredentialBlock } from '../services/dbMigrationPack/dbCredentialBlock';
import { currentSystemCredentialsStore } from '../services/baselineDriftScheduler';
import { runTargetBuild, targetBuildRegistry } from '../services/dbMigrationPack/targetBuild';
import { runTargetReconcile, targetReconcileRegistry, lastTargetReconcile } from '../services/dbMigrationPack/targetReconcile';
import { defaultDataParityGateReads, type LatestDataParityReport } from '../services/migrationDataParityGate';
import { fetchLatestTargetBuild, createProcParityWaiver, listProcParityWaivers, runProcParityViaAmvs, toRunnerWaivers } from '../services/dbMigrationPack/procWorkbenchClients';
import { runWorkbenchLoop, workbenchRegistry, fetchPinnedProcBaselineItems } from '../services/dbMigrationPack/procWorkbench';
import { defaultFetchPackRow, defaultFetchRoutineCatalog, defaultFetchTranslations, defaultPatchTranslation } from '../services/dbMigrationPack/translations';
import { deriveDescriptorsByRoutine } from '../services/dbMigrationPack/routineInvocationDescriptor';
import { loadPairRuleset } from '../migrationPairRules';
import { runTranslationEmission } from '../services/dbMigrationPack/translationEmission';
import { rulesetForManifest, manifestSourceEngine } from '../services/dbMigrationPack/pairRuleset';

const BASE = '/projects/:projectId/db-migration-packs/:packId';

export const dbMigrationPackWorkbenchRouter = Router();

function fail(res: Response, status: number, error: string, extra: Record<string, unknown> = {}): void {
  res.status(status).json({ error, ...extra });
}

export interface WorkbenchRouteDeps {
  runBuild?: typeof runTargetBuild;
  runLoop?: typeof runWorkbenchLoop;
  runParity?: typeof runProcParityViaAmvs;
  fetchPack?: typeof defaultFetchPackRow;
  fetchTranslations?: typeof defaultFetchTranslations;
  fetchRoutines?: typeof defaultFetchRoutineCatalog;
  patchTranslation?: typeof defaultPatchTranslation;
  fetchWaivers?: typeof listProcParityWaivers;
  createWaiver?: typeof createProcParityWaiver;
  fetchBaselineItems?: typeof fetchPinnedProcBaselineItems;
  runEmission?: typeof runTranslationEmission;
  latestBuild?: typeof fetchLatestTargetBuild;
  /** Workbench reconcile (2026-09-12). */
  runReconcile?: typeof runTargetReconcile;
  latestParityReport?: (projectId: string, architectureId: string) => Promise<LatestDataParityReport | null>;
}

export function createDbMigrationPackWorkbenchRouter(deps: WorkbenchRouteDeps = {}): Router {
  const router = Router();
  const runBuild = deps.runBuild ?? runTargetBuild;
  const runLoop = deps.runLoop ?? runWorkbenchLoop;
  const runParity = deps.runParity ?? runProcParityViaAmvs;
  const fetchPack = deps.fetchPack ?? defaultFetchPackRow;
  const fetchTranslations = deps.fetchTranslations ?? defaultFetchTranslations;
  const fetchRoutines = deps.fetchRoutines ?? defaultFetchRoutineCatalog;
  const patchTranslation = deps.patchTranslation ?? defaultPatchTranslation;
  const fetchWaivers = deps.fetchWaivers ?? listProcParityWaivers;
  const createWaiver = deps.createWaiver ?? createProcParityWaiver;
  const fetchBaselineItems = deps.fetchBaselineItems ?? fetchPinnedProcBaselineItems;
  const runEmission = deps.runEmission ?? runTranslationEmission;
  const latestBuild = deps.latestBuild ?? fetchLatestTargetBuild;
  const runReconcile = deps.runReconcile ?? runTargetReconcile;
  const latestParityReport =
    deps.latestParityReport ?? ((p: string, a: string) => defaultDataParityGateReads().fetchLatestDataParityReport(p, a));

  const targetFromBody = (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { target_db?: unknown; targetDb?: unknown };
    const target = parseDbCredentialBlock(body.target_db ?? body.targetDb);
    if (!target) {
      fail(res, 400, 'target_db must include { dbType: postgres, host, port, database, username, password } (per-invocation; never persisted).');
      return null;
    }
    if (target.dbType !== 'postgres') {
      fail(res, 400, 'The workbench target must be postgres.');
      return null;
    }
    return target;
  };

  router.post(`${BASE}/target/build`, async (req: Request, res: Response) => {
    const { projectId, packId } = req.params;
    const target = targetFromBody(req, res);
    if (!target) return;
    const body = (req.body ?? {}) as { source_db?: unknown; sourceDb?: unknown; rebuild?: boolean };
    const source = parseDbCredentialBlock(body.source_db ?? body.sourceDb) ?? currentSystemCredentialsStore.get(projectId)?.db ?? null;
    if (!source) return fail(res, 409, 'No source database credentials: supply source_db or register the current-system credentials first.', { code: 'SOURCE_DB_MISSING' });
    if (targetBuildRegistry.has(packId)) return fail(res, 409, 'A target build is already in flight for this pack.', { code: 'BUILD_IN_FLIGHT' });
    try {
      const pack = await fetchPack(projectId, packId);
      const architectureId = typeof pack.architecture_id === 'string' ? pack.architecture_id : null;
      if (!architectureId) return fail(res, 409, 'The pack carries no architecture id.');
      const packVersion = typeof pack.input_snapshot_hash === 'string' ? pack.input_snapshot_hash : null;
      void runBuild({ projectId, architectureId, packId, sourceDb: source, targetDb: target, rebuild: body.rebuild === true, packVersion }).catch((err) => {
        logger.error('[diag-gateway] proc_workbench build_unhandled', { packId, error: err instanceof Error ? err.message : String(err) });
      });
      res.status(202).json({ accepted: true, pack_id: packId, rebuild: body.rebuild === true });
    } catch (err) {
      fail(res, 502, err instanceof Error ? err.message : String(err));
    }
  });

  router.get(`${BASE}/target/build/status`, async (req: Request, res: Response) => {
    const { projectId, packId } = req.params;
    const inFlight = targetBuildRegistry.get(packId) ?? null;
    const latest = await latestBuild(projectId, packId);
    res.status(200).json({ in_flight: inFlight ? { phase: inFlight.phase, started_at: new Date(inFlight.startedAt).toISOString(), build_id: inFlight.buildId } : null, latest });
  });

  // Reconcile the built target against the source (2026-09-12): the DB
  // plane's full data-parity engine on demand, before any Stage 1 run. The
  // report is persisted in AMS as a data-parity report -- the same row the
  // migrate gate and the progress report read.
  router.post(`${BASE}/target/reconcile`, async (req: Request, res: Response) => {
    const { projectId, packId } = req.params;
    const target = targetFromBody(req, res);
    if (!target) return;
    const body = (req.body ?? {}) as { source_db?: unknown; sourceDb?: unknown };
    const source = parseDbCredentialBlock(body.source_db ?? body.sourceDb) ?? currentSystemCredentialsStore.get(projectId)?.db ?? null;
    if (!source) return fail(res, 409, 'No source database credentials: supply source_db or register the current-system credentials first.', { code: 'SOURCE_DB_MISSING' });
    if (targetReconcileRegistry.has(packId)) return fail(res, 409, 'A reconcile is already in flight for this pack.', { code: 'RECONCILE_IN_FLIGHT' });
    if (targetBuildRegistry.has(packId)) return fail(res, 409, 'A target build is in flight for this pack — reconcile once it completes.', { code: 'BUILD_IN_FLIGHT' });
    try {
      const pack = await fetchPack(projectId, packId);
      const architectureId = typeof pack.architecture_id === 'string' ? pack.architecture_id : null;
      if (!architectureId) return fail(res, 409, 'The pack carries no architecture id.');
      void runReconcile({ projectId, architectureId, packId, sourceDb: source, targetDb: target }).catch((err) => {
        logger.error('[diag-gateway] proc_workbench reconcile_unhandled', { packId, error: err instanceof Error ? err.message : String(err) });
      });
      res.status(202).json({ accepted: true, pack_id: packId });
    } catch (err) {
      fail(res, 502, err instanceof Error ? err.message : String(err));
    }
  });

  router.get(`${BASE}/target/reconcile/status`, async (req: Request, res: Response) => {
    const { projectId, packId } = req.params;
    const inFlight = targetReconcileRegistry.get(packId) ?? null;
    const last = lastTargetReconcile.get(packId) ?? null;
    let latest: LatestDataParityReport | null = null;
    let latestError: string | null = null;
    try {
      const pack = await fetchPack(projectId, packId);
      const architectureId = typeof pack.architecture_id === 'string' ? pack.architecture_id : null;
      latest = architectureId ? await latestParityReport(projectId, architectureId) : null;
    } catch (err) {
      latestError = err instanceof Error ? err.message : String(err);
    }
    res.status(200).json({
      in_flight: inFlight ? { phase: inFlight.phase, started_at: new Date(inFlight.startedAt).toISOString(), tables: inFlight.tables } : null,
      last,
      latest_report: latest,
      latest_report_error: latestError,
    });
  });

  const kick = async (req: Request, res: Response, scope: string[] | null, guidance: Record<string, string>) => {
    const { projectId, packId } = req.params;
    const target = targetFromBody(req, res);
    if (!target) return;
    const running = workbenchRegistry.get(packId);
    if (running && running.phase === 'looping') return fail(res, 409, 'The translate-and-reconcile loop is already running for this pack.', { code: 'LOOP_IN_FLIGHT' });
    const body = (req.body ?? {}) as { upstream_divergent_tables?: string[] };
    void runLoop({ projectId, packId, targetDb: target, translationIds: scope, guidanceByTranslation: guidance, upstreamDivergentTables: Array.isArray(body.upstream_divergent_tables) ? body.upstream_divergent_tables : [] }).catch((err) => {
      logger.error('[diag-gateway] proc_workbench loop_unhandled', { packId, error: err instanceof Error ? err.message : String(err) });
    });
    res.status(202).json({ accepted: true, pack_id: packId, scope: scope ?? 'all' });
  };

  router.post(`${BASE}/translations/translate-and-reconcile`, (req, res) => {
    const body = (req.body ?? {}) as { translation_ids?: unknown };
    const ids = Array.isArray(body.translation_ids) ? body.translation_ids.filter((x): x is string => typeof x === 'string') : null;
    void kick(req, res, ids && ids.length > 0 ? ids : null, {});
  });

  router.post(`${BASE}/translations/:translationId/retry-loop`, (req, res) => {
    const { translationId } = req.params;
    const body = (req.body ?? {}) as { guidance?: unknown };
    const guidance = typeof body.guidance === 'string' && body.guidance.trim().length > 0 ? { [translationId]: body.guidance.trim() } : {};
    void kick(req, res, [translationId], guidance);
  });

  router.get(`${BASE}/translations/loop-status`, (req: Request, res: Response) => {
    const state = workbenchRegistry.get(req.params.packId) ?? null;
    res.status(200).json(
      state
        ? {
            in_flight: state.phase === 'looping' || state.phase === 'loading',
            phase: state.phase,
            routines: state.routines,
            done: state.done,
            started_at: new Date(state.startedAt).toISOString(),
            error: state.error,
            events: state.events.slice(-50),
            results: state.result?.results.map((r) => ({ translation_id: r.translationId, routine: r.routineName, final_status: r.finalStatus, attempts: r.attempts.length, best_attempt_no: r.bestAttemptNo, blocked_by: r.blockedBy, error: r.error })) ?? null,
          }
        : { in_flight: false, phase: 'idle' }
    );
  });

  router.post(`${BASE}/translations/:translationId/reconcile`, async (req: Request, res: Response) => {
    const { projectId, packId, translationId } = req.params;
    const target = targetFromBody(req, res);
    if (!target) return;
    try {
      const [pack, rows] = await Promise.all([fetchPack(projectId, packId), fetchTranslations(projectId, packId)]);
      const architectureId = typeof pack.architecture_id === 'string' ? pack.architecture_id : null;
      const row = rows.find((r) => r.id === translationId);
      if (!architectureId || !row) return fail(res, 404, 'Translation not found on this pack.');
      if (!row.routine_id) return fail(res, 409, 'This translation has no routine-catalog row; run the DB scan first.', { code: 'NO_ROUTINE' });
      const routines = await fetchRoutines(projectId, architectureId);
      const manifest = (pack.manifest_json ?? null) as Record<string, unknown> | null;
      const descriptors = deriveDescriptorsByRoutine(routines, rulesetForManifest(manifest));
      const waivers = toRunnerWaivers(await fetchWaivers(projectId));
      const outcome = await runParity({ projectId, architectureId, targetDb: target, routineIds: [row.routine_id], descriptors: Object.fromEntries(descriptors), purpose: 'workbench', packId, waivers, sourceEngine: manifestSourceEngine(manifest) });
      if (outcome.error) return fail(res, 409, outcome.error);
      const report = outcome.reports[0] ?? null;
      if (report) {
        await patchTranslation(projectId, packId, translationId, {
          loop_status: report.summary.status === 'clean' || report.summary.status === 'clean_with_waivers' ? 'reconciled' : report.summary.status === 'unverifiable' ? 'unverified' : 'exhausted',
          parity_report_id: report.report_id,
          verdict_json: { status: report.summary.status, scenarios_failing: report.summary.divergent, scenarios: report.summary.scenarios ?? null, signatures: report.summary.signatures.map((s) => s.signature), reconciled_at: new Date().toISOString() },
        });
      }
      res.status(200).json({ baseline_id: outcome.baselineId, report });
    } catch (err) {
      fail(res, 502, err instanceof Error ? err.message : String(err));
    }
  });

  router.post(`${BASE}/translations/:translationId/waive`, async (req: Request, res: Response) => {
    const { projectId, packId, translationId } = req.params;
    const body = (req.body ?? {}) as { scope?: string; scenario?: string; dimension?: string; reason?: string; author?: string };
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (!reason) return fail(res, 400, 'A reason is required for every waiver (recorded, never silent).');
    const scope = body.scope === 'scenario' ? 'scenario' : 'routine';
    if (scope === 'scenario' && !(typeof body.scenario === 'string' && body.scenario.trim().length > 0)) return fail(res, 400, 'scenario is required for a scenario-scoped waiver.');
    try {
      const rows = await fetchTranslations(projectId, packId);
      const row = rows.find((r) => r.id === translationId);
      if (!row) return fail(res, 404, 'Translation not found on this pack.');
      const routine = (row.object_ref.split('.').pop() ?? row.object_ref).toLowerCase();
      const target = scope === 'scenario' ? `${routine}::${(body.scenario as string).trim()}` : routine;
      const created = await createWaiver(projectId, { target, reason, author: typeof body.author === 'string' ? body.author : 'reviewer' });
      res.status(201).json({ waiver: created, target });
    } catch (err) {
      fail(res, 502, err instanceof Error ? err.message : String(err));
    }
  });

  router.post(`${BASE}/translations/approve-all-reconciled`, async (req: Request, res: Response) => {
    const { projectId, packId } = req.params;
    try {
      const rows = await fetchTranslations(projectId, packId);
      const eligible = rows.filter((r) => r.disposition === 'translate' && r.review_status !== 'approved' && r.pipeline_state === 'drafted' && !!r.draft_content && r.loop_status === 'reconciled');
      let approved = 0;
      const failed: Array<{ translation_key: string; error: string }> = [];
      for (const row of eligible) {
        try {
          await patchTranslation(projectId, packId, row.id, { review_status: 'approved', reviewer_notes: `${row.reviewer_notes ? `${row.reviewer_notes}\n` : ''}Approved on evidence: behaviour reconciled against the pinned proc baseline (workbench).` });
          approved += 1;
        } catch (err) {
          failed.push({ translation_key: row.translation_key, error: err instanceof Error ? err.message : String(err) });
        }
      }
      const emission = approved > 0 ? await runEmission(projectId, packId) : null;
      res.status(200).json({ approved_count: approved, eligible_count: eligible.length, failed, emission: emission ? { approved_count: emission.approvedCount, changed: emission.changed, demoted: emission.demoted } : null });
    } catch (err) {
      fail(res, 502, err instanceof Error ? err.message : String(err));
    }
  });

  router.get(`${BASE}/translations/:translationId/attempts`, async (req: Request, res: Response) => {
    const { projectId, packId, translationId } = req.params;
    try {
      const { listTranslationAttempts } = await import('../services/dbMigrationPack/procWorkbenchClients');
      res.status(200).json(await listTranslationAttempts(projectId, packId, translationId));
    } catch (err) {
      fail(res, 502, err instanceof Error ? err.message : String(err));
    }
  });

  router.get(`${BASE}/translations/:translationId/parity-report`, async (req: Request, res: Response) => {
    const { projectId, packId, translationId } = req.params;
    try {
      const [pack, rows] = await Promise.all([fetchPack(projectId, packId), fetchTranslations(projectId, packId)]);
      const architectureId = typeof pack.architecture_id === 'string' ? pack.architecture_id : null;
      const row = rows.find((r) => r.id === translationId);
      if (!architectureId || !row) return fail(res, 404, 'Translation not found on this pack.');
      if (!row.parity_report_id) return res.status(200).json({ report: null });
      const { fetchProcParityReport } = await import('../services/dbMigrationPack/procWorkbenchClients');
      const report = await fetchProcParityReport(projectId, architectureId, row.parity_report_id);
      res.status(200).json({ report });
    } catch (err) {
      fail(res, 502, err instanceof Error ? err.message : String(err));
    }
  });

  router.get(`${BASE}/translations/baseline-status`, async (req: Request, res: Response) => {
    const { projectId, packId } = req.params;
    try {
      const pack = await fetchPack(projectId, packId);
      const architectureId = typeof pack.architecture_id === 'string' ? pack.architecture_id : null;
      if (!architectureId) return res.status(200).json({ pinned: false });
      const baseline = await fetchBaselineItems(projectId, architectureId);
      const routines = new Set(baseline.items.map((i) => i.routine_id));
      res.status(200).json({ pinned: !!baseline.baselineId, baseline_id: baseline.baselineId, scenarios: baseline.items.length, routines: routines.size });
    } catch (err) {
      fail(res, 502, err instanceof Error ? err.message : String(err));
    }
  });

  return router;
}

dbMigrationPackWorkbenchRouter.use(createDbMigrationPackWorkbenchRouter());
