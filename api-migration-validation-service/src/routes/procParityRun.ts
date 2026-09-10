/**
 * Proc parity + routine apply routes (Stored Proc & Function Behaviour
 * Program, Spec 4, 2026-09-09). Credentials request-scoped only; never
 * logged, never persisted.
 *
 *   POST /api/routine-apply/run
 *     { project_id, architecture_id, target_db: {...}, descriptor, draft_sql, drop_first?, timeout_seconds? }
 *     -> 200 { ok, dropped, error, timing_ms }
 *
 *   POST /api/proc-parity/run
 *     { project_id, architecture_id, target_db: {...}, baseline_id?, routine_ids?: [], descriptors: { <routine name>: RoutineDescriptor },
 *       purpose: workbench|execution|manual, pack_id?, translation_attempt_id?, waivers?: [], upstream_divergent_tables?: [],
 *       limits?: {...}, session_set?: [] }
 *     -> 200 { reports: [ { routine_id, routine_name, report_id, summary } ], skipped: [...] }
 *
 * The runner replays the PINNED current baseline (or `baseline_id`) for the
 * routines in scope against the target through each routine's descriptor,
 * inside the target-side compensation bracket, and persists one report per
 * routine to AMS.
 */

import { Router, type Request, type Response } from 'express';
import { createDbAdapter as defaultCreateDbAdapter } from '../services/db/dbAdapterFactory';
import type { DbAdapter } from '../services/db/DbAdapter';
import type { RoutineDescriptor } from '../services/db/routineEnvelope';
import { applyRoutineToPostgres } from '../services/db/postgresRoutineApply';
import { buildCaptureCompensationContext } from '../services/captureCompensation';
import { procBehaviourClient, type ProcBehaviourClientSurface } from '../services/procBehaviourClient';
import { runRoutineParity, type ProcParityWaiver, type RoutineParityReport } from '../services/procParity/procParityRunner';
import { resolveSessionSet } from '../services/procCapture/procCaptureOrchestrator';
import { PROC_CALL_MAX_RESULT_SETS, PROC_CALL_MAX_ROWS_PER_RESULT_SET, PROC_CALL_TIMEOUT_SECONDS } from '../services/procCapture/procConfig';
import { createTracer } from '../trace';

const trace = createTracer('amvs');

interface DbBlock {
  db_type?: string;
  host?: string;
  port?: number;
  database?: string;
  schema?: string | null;
  username?: string;
  password?: string;
}

function dbBlockError(label: string, block: DbBlock | undefined): string | null {
  if (!block) return `${label} is required`;
  if (block.db_type !== 'postgres' && block.db_type !== 'sybase') return `${label}.db_type must be postgres or sybase`;
  for (const k of ['host', 'database', 'username', 'password'] as const) {
    if (!block[k]) return `${label}.${k} is required`;
  }
  if (typeof block.port !== 'number') return `${label}.port is required`;
  return null;
}

function toConfig(block: DbBlock) {
  return {
    dbType: block.db_type as 'postgres' | 'sybase',
    host: block.host as string,
    port: block.port as number,
    database: block.database as string,
    schema: block.schema ?? null,
    username: block.username as string,
    password: block.password as string,
  };
}

export interface ProcParityRunDeps {
  createDbAdapter?: typeof defaultCreateDbAdapter;
  client?: ProcBehaviourClientSurface & { saveProcParityReport?: (projectId: string, architectureId: string, report: RoutineParityReport) => Promise<{ id: string }> };
  buildCompensation?: typeof buildCaptureCompensationContext;
  applyRoutine?: typeof applyRoutineToPostgres;
  runParity?: typeof runRoutineParity;
}

export function buildProcParityRunRouter(deps: ProcParityRunDeps = {}): Router {
  const router = Router({ mergeParams: true });
  const factory = deps.createDbAdapter ?? defaultCreateDbAdapter;
  const client = deps.client ?? procBehaviourClient;
  const buildCompensation = deps.buildCompensation ?? buildCaptureCompensationContext;
  const applyRoutine = deps.applyRoutine ?? applyRoutineToPostgres;
  const runParity = deps.runParity ?? runRoutineParity;

  router.post('/api/routine-apply/run', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { project_id?: string; architecture_id?: string; target_db?: DbBlock; descriptor?: RoutineDescriptor; draft_sql?: string; drop_first?: boolean; timeout_seconds?: number };
    const targetError = dbBlockError('target_db', body.target_db);
    if (targetError) return res.status(400).json({ error: targetError });
    if (body.target_db?.db_type !== 'postgres') return res.status(400).json({ error: 'routine apply targets postgres only' });
    if (!body.descriptor || typeof body.descriptor !== 'object') return res.status(400).json({ error: 'descriptor is required' });
    if (typeof body.draft_sql !== 'string' || body.draft_sql.trim().length === 0) return res.status(400).json({ error: 'draft_sql is required' });
    try {
      const result = await applyRoutine(toConfig(body.target_db!), body.descriptor, body.draft_sql, {
        dropFirst: body.drop_first !== false,
        timeoutSeconds: body.timeout_seconds ?? 120,
      });
      trace.predicate(
        'PROC.APPLY.01',
        'routine applied to the target atomically',
        result.ok,
        'DROP IF EXISTS + CREATE in one transaction',
        result.ok ? `applied ${body.descriptor.pg_schema}.${body.descriptor.pg_function}` : `failed: ${result.error?.message ?? '?'}`,
        { project: body.project_id ?? undefined, arch: body.architecture_id ?? undefined },
      );
      res.status(200).json(result);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post('/api/proc-parity/run', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as {
      project_id?: string;
      architecture_id?: string;
      target_db?: DbBlock;
      baseline_id?: string | null;
      routine_ids?: string[];
      descriptors?: Record<string, RoutineDescriptor>;
      purpose?: 'workbench' | 'execution' | 'manual';
      pack_id?: string | null;
      translation_attempt_id?: string | null;
      waivers?: ProcParityWaiver[];
      upstream_divergent_tables?: string[];
      limits?: { max_rows_per_result_set?: number; max_result_sets?: number; timeout_seconds?: number };
      session_set?: string[];
    };
    const projectId = body.project_id;
    const architectureId = body.architecture_id;
    if (!projectId || !architectureId) return res.status(400).json({ error: 'project_id and architecture_id are required' });
    const targetError = dbBlockError('target_db', body.target_db);
    if (targetError) return res.status(400).json({ error: targetError });
    const purpose = body.purpose === 'execution' || body.purpose === 'manual' ? body.purpose : 'workbench';
    const descriptors = body.descriptors ?? {};
    const corr = { project: projectId, arch: architectureId };

    let targetAdapter: DbAdapter | null = null;
    try {
      const baseline = body.baseline_id
        ? { id: body.baseline_id }
        : await client.getPinnedBaseline(projectId, architectureId, 'current');
      if (!baseline) return res.status(409).json({ error: 'No pinned proc baseline for this architecture.', code: 'NO_PINNED_PROC_BASELINE' });
      const [routines, items] = await Promise.all([
        client.listRoutines(projectId, architectureId),
        client.listBaselineItems(projectId, architectureId, baseline.id),
      ]);
      const routinesById = new Map(routines.map((r) => [r.id, r]));
      const scope = body.routine_ids && body.routine_ids.length > 0 ? new Set(body.routine_ids) : null;
      const targets = routines.filter((r) => (r.routine_kind === 'procedure' || r.routine_kind === 'function') && (!scope || scope.has(r.id)));
      const targetConfig = toConfig(body.target_db!);
      targetAdapter = factory(targetConfig);
      const compensation = (await buildCompensation({ projectId, architectureId, writeConfig: targetConfig, readAdapter: targetAdapter })).context;
      const limits = {
        max_rows_per_result_set: body.limits?.max_rows_per_result_set ?? PROC_CALL_MAX_ROWS_PER_RESULT_SET(),
        max_result_sets: body.limits?.max_result_sets ?? PROC_CALL_MAX_RESULT_SETS(),
        timeout_seconds: body.limits?.timeout_seconds ?? PROC_CALL_TIMEOUT_SECONDS(),
      };
      const sessionSet = body.session_set ?? resolveSessionSet(null);
      trace.stageStart('PROC', corr);
      const out: Array<{ routine_id: string; routine_name: string; report_id: string | null; summary: RoutineParityReport['summary'] }> = [];
      const skipped: Array<{ routine_id: string; reason: string }> = [];
      for (const routine of targets) {
        const routineItems = items.filter((it) => it.routine_id === routine.id);
        const descriptor = descriptors[routine.routine_name.toLowerCase()] ?? descriptors[`${routine.schema_name}.${routine.routine_name}`.toLowerCase()] ?? null;
        const report = await runParity({
          routine,
          items: routineItems,
          baselineId: baseline.id,
          descriptor,
          targetAdapter,
          compensation,
          routinesById,
          waivers: body.waivers ?? [],
          upstreamDivergentTables: body.upstream_divergent_tables ?? [],
          purpose,
          packId: body.pack_id ?? null,
          translationAttemptId: body.translation_attempt_id ?? null,
          limits,
          sessionSet,
        });
        let reportId: string | null = null;
        try {
          const saved = await (client.saveProcParityReport ?? procBehaviourClient.saveProcParityReport)(projectId, architectureId, report);
          reportId = saved.id;
        } catch (err) {
          skipped.push({ routine_id: routine.id, reason: `report_save_failed: ${err instanceof Error ? err.message : String(err)}` });
        }
        out.push({ routine_id: routine.id, routine_name: report.routine_name, report_id: reportId, summary: report.summary });
      }
      trace.predicate(
        'PROC.REC.01',
        'a parity report was written for every routine in scope',
        skipped.length === 0,
        `reports for ${targets.length} routine(s)`,
        `written=${out.filter((o) => o.report_id).length} skipped=${skipped.length} divergent=${out.filter((o) => o.summary.status === 'divergent').length}`,
        corr,
      );
      res.status(200).json({ baseline_id: baseline.id, purpose, reports: out, skipped });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      if (targetAdapter) {
        try {
          await targetAdapter.dispose();
        } catch {
          /* nothing to release */
        }
      }
    }
  });

  return router;
}

export const procParityRunRouter = buildProcParityRunRouter();
