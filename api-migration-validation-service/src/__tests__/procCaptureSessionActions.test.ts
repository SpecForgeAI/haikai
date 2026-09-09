/**
 * Spec 3 (Stored Proc & Function Behaviour Program, 2026-09-09): the proc
 * capture session routes — secrets (draft → configured, readonly pair
 * both-or-nothing), the /start guards (status, secrets, S0 pinned, routine
 * catalog), 202 fire-and-forget, status, dispositions and save-baseline.
 */

import express from 'express';
import request from 'supertest';
import { createProcCaptureSessionActionsRouter } from '../routes/procCaptureSessionActions';
import { secretsStore } from '../services/secretsStore';
import { procRunRegistry } from '../services/procCapture/procCaptureOrchestrator';
import type { ProcBehaviourClientSurface } from '../services/procBehaviourClient';
import type { ProcCaptureSessionDto, RoutineCatalogRow } from '../services/procCapture/types';

function routine(): RoutineCatalogRow {
  return {
    id: 'r1', schema_name: 'dbo', routine_name: 'upd_ledger_roll', routine_kind: 'procedure', full_body: 'create proc upd_ledger_roll as select 1', body_hash: 'h',
    params_json: [], profile_json: {}, signature_parsed: true,
  };
}

function fakeClient(session: Partial<ProcCaptureSessionDto> = {}): ProcBehaviourClientSurface & { session: ProcCaptureSessionDto; diagnostics: unknown[]; baselines: unknown[] } {
  const state = {
    session: { id: 's1', project_id: 'p', architecture_id: 'a', name: 'n', status: 'draft', kind: 'current', db_config_redacted_json: { dbType: 'sybase', host: 'h', port: 5000, database: 'd', username: 'u' }, ...session } as ProcCaptureSessionDto,
    diagnostics: [] as unknown[],
    baselines: [] as unknown[],
  };
  return {
    ...state,
    listRoutines: async () => [routine()],
    getSession: async () => state.session,
    patchSession: async (_p, _a, _s, patch) => { state.session = { ...state.session, ...patch }; return state.session; },
    upsertScenarios: async () => [],
    listScenarios: async () => [{ id: 'sc1', session_id: 's1', routine_id: 'r1', scenario_name: 'happy', scenario_type: 'happy_path', generation_source: 'llm_generated', inputs_json: [], status: 'fired' }],
    createCaptures: async () => [],
    listCaptures: async () => [{ id: 'c1', session_id: 's1', scenario_id: 'sc1', routine_id: 'r1', attempt_number: 1, envelope_json: { outcome: 'success', return_status: 0, output_params: {}, result_sets: [], update_counts: [], messages: [], error: null, timing_ms: 1, session: { login: 'u', set_options: [] } }, accepted: true }],
    createDiagnostics: async (_p, _a, _s, d) => { state.diagnostics.push(...d); return d; },
    listDiagnostics: async () => [],
    createBaseline: async (_p, _a, body) => { state.baselines.push(body); return { id: 'b1', project_id: 'p', architecture_id: 'a', name: body.name, status: 'draft', kind: 'current', routine_count: 1, scenario_count: 1 }; },
    pinBaseline: async () => ({ id: 'b1', project_id: 'p', architecture_id: 'a', name: 'b', status: 'pinned', kind: 'current', routine_count: 1, scenario_count: 1 }),
    getPinnedBaseline: async () => null,
    listBaselineItems: async () => [],
  };
}

function app(client: ProcBehaviourClientSurface, opts: { orchestrate?: jest.Mock; snapshot?: string | null } = {}) {
  const a = express();
  a.use(express.json());
  a.use(createProcCaptureSessionActionsRouter({
    client,
    orchestrate: (opts.orchestrate ?? jest.fn().mockResolvedValue({ status: 'completed' })) as never,
    latestSnapshot: () => (opts.snapshot === undefined ? 's0-1' : opts.snapshot),
  }));
  return a;
}

const Q = '?projectId=p&architectureId=a';

describe('proc capture session routes', () => {
  beforeEach(() => {
    secretsStore.clearAll();
    procRunRegistry.clear();
  });

  it('secrets: stores the DB bundle, enforces the readonly pair, and moves draft -> configured', async () => {
    const client = fakeClient();
    const bad = await request(app(client)).post(`/api/proc-capture-sessions/s1/secrets${Q}`).send({ db: { password: 'pw', readonly_username: 'ro' } });
    expect(bad.status).toBe(400);
    const ok = await request(app(client)).post(`/api/proc-capture-sessions/s1/secrets${Q}`).send({ db: { password: 'pw', readonly_username: 'ro', readonly_password: 'ropw' } });
    expect(ok.status).toBe(200);
    expect(ok.body.readonly_split).toBe(true);
    expect(secretsStore.get('s1')?.db).toEqual({ password: 'pw', readonlyUsername: 'ro', readonlyPassword: 'ropw' });
    expect((await client.getSession('p', 'a', 's1')).status).toBe('configured');
  });

  it('start: guards status, secrets, S0 and the catalog, then answers 202 and fires the orchestrator once', async () => {
    const client = fakeClient({ status: 'configured' });
    const orchestrate = jest.fn().mockResolvedValue({ status: 'completed' });
    const noSecrets = await request(app(client, { orchestrate })).post(`/api/proc-capture-sessions/s1/start${Q}`).send({});
    expect(noSecrets.status).toBe(409);
    expect(noSecrets.body.code).toBe('SECRETS_NOT_LOADED');

    secretsStore.set({ sessionId: 's1', api: { type: 'none' }, db: { password: 'pw' }, loadedAt: 0 });
    const noS0 = await request(app(client, { orchestrate, snapshot: null })).post(`/api/proc-capture-sessions/s1/start${Q}`).send({});
    expect(noS0.status).toBe(409);
    expect(noS0.body.code).toBe('S0_NOT_PINNED');

    const started = await request(app(client, { orchestrate })).post(`/api/proc-capture-sessions/s1/start${Q}`).send({});
    expect(started.status).toBe(202);
    expect(started.body).toEqual({ accepted: true, session_id: 's1', routines: 1 });
    expect(orchestrate).toHaveBeenCalledTimes(1);
    expect(orchestrate.mock.calls[0][0]).toEqual({ projectId: 'p', architectureId: 'a', sessionId: 's1', routineIds: null });

    const wrongStatus = await request(app(fakeClient({ status: 'running' }), { orchestrate })).post(`/api/proc-capture-sessions/s1/start${Q}`).send({});
    expect(wrongStatus.status).toBe(409);
  });

  it('retry-uncovered: scoped re-run from a terminal status; dispositions write diagnostics', async () => {
    const client = fakeClient({ status: 'completed_with_findings' });
    secretsStore.set({ sessionId: 's1', api: { type: 'none' }, db: { password: 'pw' }, loadedAt: 0 });
    const orchestrate = jest.fn().mockResolvedValue({ status: 'completed' });
    const empty = await request(app(client, { orchestrate })).post(`/api/proc-capture-sessions/s1/retry-uncovered${Q}`).send({ routine_ids: [] });
    expect(empty.status).toBe(400);
    const retry = await request(app(client, { orchestrate })).post(`/api/proc-capture-sessions/s1/retry-uncovered${Q}`).send({ routine_ids: ['r1'] });
    expect(retry.status).toBe(202);
    expect(orchestrate.mock.calls[0][0].routineIds).toEqual(['r1']);

    const np = await request(app(client)).post(`/api/proc-capture-sessions/s1/not-possible${Q}`).send({ routine_id: 'r1', reason: 'no data can reach this branch' });
    expect(np.status).toBe(200);
    expect(client.diagnostics[0]).toMatchObject({ diagnostic_type: 'not_possible', routine_id: 'r1' });
    const missingReason = await request(app(client)).post(`/api/proc-capture-sessions/s1/exclude-routine${Q}`).send({ routine_id: 'r1' });
    expect(missingReason.status).toBe(400);
  });

  it('status reports the in-flight run and the S0/secrets facts', async () => {
    const client = fakeClient({ status: 'running' });
    procRunRegistry.set('s1', { sessionId: 's1', projectId: 'p', architectureId: 'a', startedAt: Date.now(), abortController: new AbortController(), phase: 'routine 1/1', routineIndex: 1, routineTotal: 1, scenariosFired: 2, capturesAccepted: 2, findings: 0 });
    const res = await request(app(client)).get(`/api/proc-capture-sessions/s1/status${Q}`);
    expect(res.status).toBe(200);
    expect(res.body.run).toMatchObject({ in_flight: true, phase: 'routine 1/1', scenarios_fired: 2 });
    expect(res.body.s0_pinned).toBe(true);
    expect(res.body.secrets_loaded).toBe(false);
  });

  it('save-baseline builds the items from accepted captures and pins by default', async () => {
    const client = fakeClient({ status: 'completed' });
    const res = await request(app(client)).post(`/api/proc-capture-sessions/s1/save-baseline${Q}`).send({ name: 'first' });
    expect(res.status).toBe(201);
    expect(res.body.items).toBe(1);
    expect(res.body.baseline.status).toBe('pinned');
    expect((client.baselines[0] as { items: unknown[] }).items).toHaveLength(1);
  });
});
