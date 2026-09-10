/**
 * Spec 4 (Stored Proc & Function Behaviour Program, 2026-09-09): the AMVS
 * proc-parity + routine-apply routes — credential validation, pinned
 * baseline resolution, descriptor lookup by bare name, per-routine report
 * persistence, honest skips. Downstreams injected.
 */

import express from 'express';
import request from 'supertest';
import { buildProcParityRunRouter } from '../routes/procParityRun';
import type { ProcBehaviourClientSurface } from '../services/procBehaviourClient';
import type { RoutineParityReport } from '../services/procParity/procParityRunner';

const target = { db_type: 'postgres', host: 'h', port: 5432, database: 'd', username: 'u', password: 'p' };
const descriptor = { shape: 'return_status', pg_schema: 'dbo', pg_function: 'upd_ledger_roll', args: [], out_params: [], refcursors: [], return_status_carriage: 'function_return', error_carriage_rule: 'e', session_profile_rule: 's', confidence: 'static', rules_cited: [] };

function fakeClient(): ProcBehaviourClientSurface & { saved: unknown[] } {
  const saved: unknown[] = [];
  return {
    saved,
    listRoutines: async () => [
      { id: 'r1', schema_name: 'dbo', routine_name: 'upd_ledger_roll', routine_kind: 'procedure', full_body: 'x', body_hash: 'h', params_json: [], profile_json: {} },
      { id: 'r2', schema_name: 'dbo', routine_name: 'other', routine_kind: 'procedure', full_body: 'y', body_hash: 'h2', params_json: [], profile_json: {} },
    ],
    getSession: async () => { throw new Error('unused'); },
    patchSession: async () => { throw new Error('unused'); },
    upsertScenarios: async () => [],
    listScenarios: async () => [],
    createCaptures: async () => [],
    listCaptures: async () => [],
    createDiagnostics: async () => [],
    listDiagnostics: async () => [],
    createBaseline: async () => { throw new Error('unused'); },
    pinBaseline: async () => { throw new Error('unused'); },
    getPinnedBaseline: async () => ({ id: 'b1', project_id: 'p', architecture_id: 'a', name: 'b', status: 'pinned', kind: 'current', routine_count: 1, scenario_count: 1 }),
    listBaselineItems: async () => [{ routine_id: 'r1', routine_body_hash: 'h', scenario_name: 'happy', scenario_type: 'happy_path', exit_outcome: 'success', inputs_json: [], expected_envelope_json: { outcome: 'success', return_status: 0, output_params: {}, result_sets: [], update_counts: [], messages: [], error: null, timing_ms: 1, session: { login: 'x', set_options: [] } } }],
    saveProcParityReport: async (_p, _a, report) => { saved.push(report); return { id: `rep-${saved.length}` }; },
  };
}

function app(client = fakeClient(), runParity?: jest.Mock, applyRoutine?: jest.Mock) {
  const a = express();
  a.use(express.json());
  a.use(buildProcParityRunRouter({
    client,
    createDbAdapter: (() => ({ callRoutine: async () => ({}), dispose: async () => undefined })) as never,
    buildCompensation: (async () => ({ context: null, inactiveReason: 'model_unavailable' })) as never,
    runParity: (runParity ?? jest.fn().mockImplementation(async (args: { routine: { id: string; routine_name: string }; descriptor: unknown; items: unknown[] }) => ({
      routine_id: args.routine.id, routine_name: `dbo.${args.routine.routine_name}`, baseline_id: 'b1', purpose: 'workbench', descriptor_shape: args.descriptor ? 'return_status' : null,
      summary: { status: args.descriptor ? 'clean' : 'unverifiable', scenarios: args.items.length, matched: args.items.length, tolerated: 0, divergent: 0, unverifiable: 0, waived: 0, signatures: [], unverifiable_reason: args.descriptor ? null : 'no_invocation_descriptor' },
      scenarios: [], rules_available: [], computed_at: 'now', pair_id: null, ruleset_version: null,
    } as RoutineParityReport))) as never,
    applyRoutine: (applyRoutine ?? jest.fn().mockResolvedValue({ ok: true, dropped: true, error: null, timing_ms: 3 })) as never,
  }));
  return a;
}

describe('proc parity routes', () => {
  it('validates the target block and the ids', async () => {
    const res = await request(app()).post('/api/proc-parity/run').send({ project_id: 'p', architecture_id: 'a', target_db: { host: 'h' } });
    expect(res.status).toBe(400);
    const noIds = await request(app()).post('/api/proc-parity/run').send({ target_db: target });
    expect(noIds.status).toBe(400);
  });

  it('replays the pinned baseline for the scoped routines with descriptors by bare name and persists reports', async () => {
    const client = fakeClient();
    const runParity = jest.fn().mockImplementation(async (args: { routine: { id: string; routine_name: string }; descriptor: unknown; items: unknown[] }) => ({
      routine_id: args.routine.id, routine_name: `dbo.${args.routine.routine_name}`, baseline_id: 'b1', purpose: 'workbench', descriptor_shape: null,
      summary: { status: args.descriptor ? 'clean' : 'unverifiable', scenarios: args.items.length, matched: 0, tolerated: 0, divergent: 0, unverifiable: 0, waived: 0, signatures: [], unverifiable_reason: args.descriptor ? null : 'no_invocation_descriptor' },
      scenarios: [], rules_available: [], computed_at: 'now', pair_id: null, ruleset_version: null,
    }));
    const res = await request(app(client, runParity)).post('/api/proc-parity/run').send({
      project_id: 'p', architecture_id: 'a', target_db: target, descriptors: { upd_ledger_roll: descriptor }, purpose: 'workbench', pack_id: 'k1',
    });
    expect(res.status).toBe(200);
    expect(res.body.baseline_id).toBe('b1');
    expect(res.body.reports).toHaveLength(2);
    const byId = new Map((res.body.reports as Array<{ routine_id: string; report_id: string; summary: { status: string } }>).map((r) => [r.routine_id, r]));
    expect(byId.get('r1')?.summary.status).toBe('clean');
    expect(byId.get('r2')?.summary.status).toBe('unverifiable');
    expect(client.saved).toHaveLength(2);
    expect(runParity.mock.calls[0][0]).toMatchObject({ purpose: 'workbench', packId: 'k1', items: expect.arrayContaining([expect.objectContaining({ scenario_name: 'happy' })]) });
    const scoped = await request(app(client, runParity)).post('/api/proc-parity/run').send({ project_id: 'p', architecture_id: 'a', target_db: target, routine_ids: ['r2'], descriptors: {} });
    expect(scoped.body.reports).toHaveLength(1);
  });

  it('answers 409 without a pinned baseline', async () => {
    const client = fakeClient();
    client.getPinnedBaseline = async () => null;
    const res = await request(app(client)).post('/api/proc-parity/run').send({ project_id: 'p', architecture_id: 'a', target_db: target });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('NO_PINNED_PROC_BASELINE');
  });

  it('routine-apply validates inputs and forwards to the applier', async () => {
    const apply = jest.fn().mockResolvedValue({ ok: false, dropped: false, error: { sqlstate: '42601', message: 'syntax error', position: 3, detail: null }, timing_ms: 2 });
    const a = app(fakeClient(), undefined, apply);
    expect((await request(a).post('/api/routine-apply/run').send({ target_db: target, descriptor })).status).toBe(400);
    const res = await request(a).post('/api/routine-apply/run').send({ project_id: 'p', architecture_id: 'a', target_db: target, descriptor, draft_sql: 'CREATE FUNCTION broken' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: false, error: { sqlstate: '42601' } });
    expect(apply.mock.calls[0][3]).toEqual({ dropFirst: true, timeoutSeconds: 120 });
  });
});
