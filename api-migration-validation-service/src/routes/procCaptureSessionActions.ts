/**
 * Proc behaviour capture routes (Stored Proc & Function Behaviour Program,
 * Spec 3, 2026-09-09). Session rows live in AMS; these routes hold the
 * in-memory secrets, run the orchestrator fire-and-forget (202 + status
 * poll), and build the baseline. DB-native: no base URL, no API auth, no
 * OAS inventory.
 *
 *   POST /api/proc-capture-sessions/:id/secrets        { projectId, architectureId, db: { password, readonly_username?, readonly_password? } }
 *   POST /api/proc-capture-sessions/:id/start          { projectId, architectureId }                      -> 202
 *   GET  /api/proc-capture-sessions/:id/status         ?projectId&architectureId
 *   POST /api/proc-capture-sessions/:id/cancel
 *   POST /api/proc-capture-sessions/:id/retry-uncovered { projectId, architectureId, routine_ids: [] }     -> 202
 *   POST /api/proc-capture-sessions/:id/exclude-routine { projectId, architectureId, routine_id, reason }
 *   POST /api/proc-capture-sessions/:id/not-possible    { projectId, architectureId, routine_id, reason }
 *   POST /api/proc-capture-sessions/:id/save-baseline   { projectId, architectureId, name, pin? }
 */

import { Router, type Request, type Response } from 'express';
import { secretsStore } from '../services/secretsStore';
import type { SecretsBundle } from '../types/secrets';
import { latestSnapshotId } from '../services/s0/manifest';
import { procBehaviourClient, type ProcBehaviourClientSurface } from '../services/procBehaviourClient';
import {
  cancelProcRun,
  orchestrateProcCaptureSession,
  procRunRegistry,
  type ProcCaptureDeps,
} from '../services/procCapture/procCaptureOrchestrator';
import { buildBaselineItems } from '../services/procCapture/procBaseline';

function ids(req: Request): { projectId: string | null; architectureId: string | null } {
  const q = req.query as Record<string, unknown>;
  const b = (req.body ?? {}) as Record<string, unknown>;
  const pick = (k: string): string | null => {
    const fromQuery = q[k];
    if (typeof fromQuery === 'string' && fromQuery.length > 0) return fromQuery;
    const fromBody = b[k];
    return typeof fromBody === 'string' && fromBody.length > 0 ? fromBody : null;
  };
  return { projectId: pick('projectId') ?? pick('project_id'), architectureId: pick('architectureId') ?? pick('architecture_id') };
}

function fail(res: Response, status: number, message: string, extra: Record<string, unknown> = {}): void {
  res.status(status).json({ error: message, ...extra });
}

export interface ProcCaptureRouteDeps {
  client?: ProcBehaviourClientSurface;
  orchestrate?: typeof orchestrateProcCaptureSession;
  orchestratorDeps?: ProcCaptureDeps;
  latestSnapshot?: typeof latestSnapshotId;
}

export function createProcCaptureSessionActionsRouter(deps: ProcCaptureRouteDeps = {}): Router {
  const router = Router();
  const client = deps.client ?? procBehaviourClient;
  const orchestrate = deps.orchestrate ?? orchestrateProcCaptureSession;
  const latestSnapshot = deps.latestSnapshot ?? latestSnapshotId;

  router.post('/api/proc-capture-sessions/:id/secrets', async (req: Request, res: Response) => {
    const sessionId = req.params.id;
    const { projectId, architectureId } = ids(req);
    if (!projectId || !architectureId) return fail(res, 400, 'projectId and architectureId are required');
    const body = (req.body ?? {}) as { db?: Record<string, unknown> };
    const db = body.db ?? {};
    const password = typeof db.password === 'string' ? db.password : '';
    if (!password) return fail(res, 400, 'db.password is required');
    const ro = { u: db.readonly_username ?? db.readonlyUsername, p: db.readonly_password ?? db.readonlyPassword };
    if ((typeof ro.u === 'string' && ro.u.length > 0) !== (typeof ro.p === 'string' && ro.p.length > 0)) {
      return fail(res, 400, 'readonly_username and readonly_password must be supplied together');
    }
    try {
      await client.getSession(projectId, architectureId, sessionId);
    } catch {
      return fail(res, 404, 'Proc capture session not found');
    }
    const bundle: SecretsBundle = {
      sessionId,
      api: { type: 'none' },
      db: {
        password,
        ...(typeof ro.u === 'string' && ro.u ? { readonlyUsername: ro.u, readonlyPassword: ro.p as string } : {}),
      },
      loadedAt: Date.now(),
    };
    secretsStore.set(bundle);
    // The session becomes `configured` once secrets are held (draft -> configured).
    try {
      const session = await client.getSession(projectId, architectureId, sessionId);
      if (session.status === 'draft') await client.patchSession(projectId, architectureId, sessionId, { status: 'configured' });
    } catch (err) {
      return fail(res, 502, `Secrets stored but the session could not be marked configured: ${err instanceof Error ? err.message : String(err)}`);
    }
    res.status(200).json({ ok: true, readonly_split: typeof ro.u === 'string' && ro.u.length > 0 });
  });

  const start = async (req: Request, res: Response, routineIds: string[] | null): Promise<void> => {
    const sessionId = req.params.id;
    const { projectId, architectureId } = ids(req);
    if (!projectId || !architectureId) return fail(res, 400, 'projectId and architectureId are required');
    let session;
    try {
      session = await client.getSession(projectId, architectureId, sessionId);
    } catch {
      return fail(res, 404, 'Proc capture session not found');
    }
    if (procRunRegistry.has(sessionId)) return fail(res, 409, 'A capture run is already in flight for this session', { code: 'RUN_IN_FLIGHT' });
    const allowed = routineIds ? ['completed', 'completed_with_findings', 'failed', 'cancelled', 'configured'] : ['configured'];
    if (!allowed.includes(session.status)) {
      return fail(res, 409, `Cannot start a proc capture session in status '${session.status}'.`, { currentStatus: session.status });
    }
    if (!secretsStore.has(sessionId)) return fail(res, 409, 'Secrets not loaded for this session. Submit /secrets before /start.', { code: 'SECRETS_NOT_LOADED' });
    if (!session.db_config_redacted_json) return fail(res, 409, 'The session has no database configuration.', { code: 'DB_NOT_CONFIGURED' });
    // S0 self-heal (2026-09-11; moved OFF the request path 2026-09-12). The DB
    // scan pinned S0 and the scan record says so, but the pin lives on THIS
    // service's disk and a fresh clone / moved data directory loses it. The
    // session holds the source DB details and credentials and the scan's
    // candidates are committed, so the RUN re-pins from the committed model
    // as its first phase ('pinning_s0') instead of refusing. It is not done
    // here: a snapshot of a real estate takes minutes, and doing it inside
    // the start request made the gateway's proxy give up ("Validation
    // service unreachable") while the pin was in fact being taken. The run
    // fails honestly (diagnostic + failed status) if the re-pin fails.
    const repinS0 = !latestSnapshot(projectId, architectureId);
    if (repinS0) {
      console.warn(`[diag-amvs] op=proc_capture s0_missing session=${sessionId.slice(0, 8)} action=repin_in_run`);
    }
    const routines = await client.listRoutines(projectId, architectureId);
    if (routines.filter((r) => r.routine_kind !== 'trigger').length === 0) {
      return fail(res, 409, 'The routine catalog is empty. Run the DB scan first.', { code: 'NO_ROUTINES' });
    }
    if (routineIds) {
      // Scoped re-run: the session goes back through running from a terminal state.
      await client.patchSession(projectId, architectureId, sessionId, { status: 'configured' }).catch(() => undefined);
    }
    void orchestrate({ projectId, architectureId, sessionId, routineIds, ...(repinS0 ? { repinS0: true } : {}) }, deps.orchestratorDeps).catch((err) => {
      console.error(`[diag-amvs] op=proc_capture unhandled session=${sessionId.slice(0, 8)} reason=${err instanceof Error ? err.message : String(err)}`);
    });
    res.status(202).json({ accepted: true, session_id: sessionId, routines: routineIds ? routineIds.length : routines.length });
  };

  router.post('/api/proc-capture-sessions/:id/start', (req, res) => void start(req, res, null));

  router.post('/api/proc-capture-sessions/:id/retry-uncovered', (req, res) => {
    const body = (req.body ?? {}) as { routine_ids?: unknown; routineIds?: unknown };
    const raw = body.routine_ids ?? body.routineIds;
    const routineIds = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string' && x.length > 0) : [];
    if (routineIds.length === 0) return fail(res, 400, 'routine_ids must be a non-empty array');
    void start(req, res, routineIds);
  });

  router.get('/api/proc-capture-sessions/:id/status', async (req: Request, res: Response) => {
    const sessionId = req.params.id;
    const { projectId, architectureId } = ids(req);
    if (!projectId || !architectureId) return fail(res, 400, 'projectId and architectureId are required');
    try {
      const session = await client.getSession(projectId, architectureId, sessionId);
      const run = procRunRegistry.get(sessionId);
      res.status(200).json({
        session,
        run: run
          ? {
              in_flight: true,
              phase: run.phase,
              routine_index: run.routineIndex,
              routine_total: run.routineTotal,
              scenarios_fired: run.scenariosFired,
              captures_accepted: run.capturesAccepted,
              findings: run.findings,
              started_at: new Date(run.startedAt).toISOString(),
            }
          : { in_flight: false },
        secrets_loaded: secretsStore.has(sessionId),
        s0_pinned: !!latestSnapshot(projectId, architectureId),
      });
    } catch {
      return fail(res, 404, 'Proc capture session not found');
    }
  });

  router.post('/api/proc-capture-sessions/:id/cancel', (req: Request, res: Response) => {
    const cancelled = cancelProcRun(req.params.id);
    res.status(cancelled ? 202 : 409).json({ cancelled });
  });

  const disposition = (type: 'excluded_by_user' | 'not_possible') => async (req: Request, res: Response): Promise<void> => {
    const sessionId = req.params.id;
    const { projectId, architectureId } = ids(req);
    if (!projectId || !architectureId) return fail(res, 400, 'projectId and architectureId are required');
    const body = (req.body ?? {}) as { routine_id?: unknown; routineId?: unknown; reason?: unknown };
    const routineId = typeof body.routine_id === 'string' ? body.routine_id : typeof body.routineId === 'string' ? body.routineId : '';
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (!routineId || !reason) return fail(res, 400, 'routine_id and a reason are required');
    try {
      const [saved] = await client.createDiagnostics(projectId, architectureId, sessionId, [
        { session_id: sessionId, routine_id: routineId, diagnostic_type: type, message: reason, detail_json: { recorded_by: 'user' } },
      ]);
      res.status(200).json({ ok: true, diagnostic: saved ?? null });
    } catch (err) {
      return fail(res, 502, err instanceof Error ? err.message : String(err));
    }
  };
  router.post('/api/proc-capture-sessions/:id/exclude-routine', disposition('excluded_by_user'));
  router.post('/api/proc-capture-sessions/:id/not-possible', disposition('not_possible'));

  router.post('/api/proc-capture-sessions/:id/save-baseline', async (req: Request, res: Response) => {
    const sessionId = req.params.id;
    const { projectId, architectureId } = ids(req);
    if (!projectId || !architectureId) return fail(res, 400, 'projectId and architectureId are required');
    const body = (req.body ?? {}) as { name?: unknown; pin?: unknown };
    const name = typeof body.name === 'string' && body.name.trim().length > 0 ? body.name.trim() : `Proc baseline ${new Date().toISOString()}`;
    const pin = body.pin !== false;
    try {
      const session = await client.getSession(projectId, architectureId, sessionId);
      if (procRunRegistry.has(sessionId)) return fail(res, 409, 'The capture run is still in flight.', { code: 'RUN_IN_FLIGHT' });
      const [routines, scenarios, captures] = await Promise.all([
        client.listRoutines(projectId, architectureId),
        client.listScenarios(projectId, architectureId, sessionId),
        client.listCaptures(projectId, architectureId, sessionId),
      ]);
      const items = buildBaselineItems(routines, scenarios, captures);
      if (items.length === 0) return fail(res, 409, 'No accepted captures to baseline.', { code: 'NO_ACCEPTED_CAPTURES' });
      let baseline = await client.createBaseline(projectId, architectureId, {
        session_id: sessionId,
        name,
        kind: session.kind ?? 'current',
        s0_fingerprint_json: session.s0_fingerprint_json ?? null,
        items,
      });
      if (pin) baseline = await client.pinBaseline(projectId, architectureId, baseline.id);
      res.status(201).json({ baseline, items: items.length });
    } catch (err) {
      return fail(res, 502, err instanceof Error ? err.message : String(err));
    }
  });

  return router;
}

export const procCaptureSessionActionsRouter = createProcCaptureSessionActionsRouter();
