/**
 * Spec 4 (Stored Proc & Function Behaviour Program, 2026-09-09): the
 * workbench routes — target build (202, credential parsing, in-flight
 * guard), translate-and-reconcile kick (202 + scope), loop status,
 * reconcile-one, waive (reason mandatory; target shape), approve-all-
 * reconciled, baseline-status. Downstreams injected.
 */

import express from 'express';
import request from 'supertest';

jest.mock('../config', () => ({
  getConfig: () => ({ apiMigrationValidationServiceBaseUrl: 'http://amvs.test', architectureModelServiceBaseUrl: 'http://ams.test' }),
}));
jest.mock('../services/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

import { createDbMigrationPackWorkbenchRouter } from '../routes/dbMigrationPackWorkbench';
import { workbenchRegistry } from '../services/dbMigrationPack/procWorkbench';
import { targetBuildRegistry } from '../services/dbMigrationPack/targetBuild';
import { targetReconcileRegistry, lastTargetReconcile } from '../services/dbMigrationPack/targetReconcile';
import type { TranslationRow } from '../services/dbMigrationPack/translations';

const target = { dbType: 'postgres', host: 'h', port: 5432, database: 'd', username: 'u', password: 'p' };
const P = '/api/v1/projects/p1/db-migration-packs/k1';

function row(partial: Partial<TranslationRow>): TranslationRow {
  return { id: 't1', translation_key: 'stored_procedure--dbo.upd_ledger_roll', object_ref: 'dbo.upd_ledger_roll', kind: 'stored_procedure', disposition: 'translate', drop_reason: null, pipeline_state: 'drafted', source_body: 'x', source_body_hash: 'h', truncated: false, legacy_redacted: false, draft_content: 'd', judge_verdict_json: {}, review_status: 'unreviewed', reviewer_notes: null, routine_id: 'r1', ...partial };
}

function app(deps: Parameters<typeof createDbMigrationPackWorkbenchRouter>[0]) {
  const a = express();
  a.use(express.json());
  a.use('/api/v1', createDbMigrationPackWorkbenchRouter(deps));
  return a;
}

describe('workbench routes', () => {
  beforeEach(() => {
    workbenchRegistry.clear();
    targetBuildRegistry.clear();
    targetReconcileRegistry.clear();
    lastTargetReconcile.clear();
  });

  it('target reconcile (2026-09-12): needs target + source, refuses while a reconcile or build is in flight, kicks once; status carries the latest parity report', async () => {
    const runReconcile = jest.fn().mockResolvedValue({ status: 'succeeded', reportId: 'rep-1', parityStatus: 'clean', tables: 3, error: null });
    const fetchPack = jest.fn().mockResolvedValue({ id: 'k1', architecture_id: 'a1', manifest_json: null });
    const a = app({ runReconcile, fetchPack });
    const bad = await request(a).post(`${P}/target/reconcile`).send({ target_db: { host: 'h' } });
    expect(bad.status).toBe(400);
    const noSource = await request(a).post(`${P}/target/reconcile`).send({ target_db: target });
    expect(noSource.status).toBe(409);
    expect(noSource.body.code).toBe('SOURCE_DB_MISSING');
    const source = { ...target, dbType: 'sybase', port: 5000 };
    const ok = await request(a).post(`${P}/target/reconcile`).send({ target_db: target, source_db: source });
    expect(ok.status).toBe(202);
    expect(runReconcile).toHaveBeenCalledTimes(1);
    expect(runReconcile.mock.calls[0][0]).toMatchObject({ projectId: 'p1', architectureId: 'a1', packId: 'k1', sourceDb: { dbType: 'sybase' }, targetDb: { dbType: 'postgres' } });

    targetReconcileRegistry.set('k1', { startedAt: Date.now(), phase: 'comparing 3 table(s)', tables: 3 });
    const busy = await request(a).post(`${P}/target/reconcile`).send({ target_db: target, source_db: source });
    expect(busy.status).toBe(409);
    expect(busy.body.code).toBe('RECONCILE_IN_FLIGHT');
    targetReconcileRegistry.clear();
    targetBuildRegistry.set('k1', { buildId: 'b1', startedAt: Date.now(), phase: 'data' });
    const building = await request(a).post(`${P}/target/reconcile`).send({ target_db: target, source_db: source });
    expect(building.status).toBe(409);
    expect(building.body.code).toBe('BUILD_IN_FLIGHT');
    targetBuildRegistry.clear();

    lastTargetReconcile.set('k1', { status: 'succeeded', reportId: 'rep-1', parityStatus: 'clean', tables: 3, error: null, startedAt: 's', endedAt: 'e' });
    const latestParityReport = jest.fn().mockResolvedValue({ id: 'rep-1', status: 'clean', created_at: '2026-09-12T10:00:00Z', report_json: { summary: { status: 'clean', tables: 3, divergent: 0, unverifiable: 0 }, tables: [] } });
    const status = await request(app({ fetchPack, latestParityReport })).get(`${P}/target/reconcile/status`);
    expect(status.status).toBe(200);
    expect(status.body.in_flight).toBeNull();
    expect(status.body.last).toMatchObject({ status: 'succeeded', reportId: 'rep-1', parityStatus: 'clean' });
    expect(status.body.latest_report).toMatchObject({ id: 'rep-1', status: 'clean' });
    expect(latestParityReport).toHaveBeenCalledWith('p1', 'a1');
  });

  it('target build: parses credentials whole-or-null, refuses without a source, kicks the build once', async () => {
    const runBuild = jest.fn().mockResolvedValue({ buildId: 'b1', status: 'succeeded', phases: {}, error: null });
    const fetchPack = jest.fn().mockResolvedValue({ id: 'k1', architecture_id: 'a1', manifest_json: null, input_snapshot_hash: 'v7' });
    const a = app({ runBuild, fetchPack });
    const bad = await request(a).post(`${P}/target/build`).send({ target_db: { host: 'h' } });
    expect(bad.status).toBe(400);
    const noSource = await request(a).post(`${P}/target/build`).send({ target_db: target });
    expect(noSource.status).toBe(409);
    expect(noSource.body.code).toBe('SOURCE_DB_MISSING');
    const ok = await request(a).post(`${P}/target/build`).send({ target_db: target, source_db: { ...target, dbType: 'sybase', port: 5000 } });
    expect(ok.status).toBe(202);
    expect(runBuild).toHaveBeenCalledTimes(1);
    expect(runBuild.mock.calls[0][0]).toMatchObject({ projectId: 'p1', architectureId: 'a1', packId: 'k1', rebuild: false, packVersion: 'v7' });
    targetBuildRegistry.set('k1', { buildId: 'b1', startedAt: Date.now(), phase: 'data' });
    const inflight = await request(a).post(`${P}/target/build`).send({ target_db: target, source_db: { ...target, dbType: 'sybase', port: 5000 } });
    expect(inflight.status).toBe(409);
    const status = await request(app({ latestBuild: jest.fn().mockResolvedValue({ id: 'b1', status: 'succeeded' }) })).get(`${P}/target/build/status`);
    expect(status.body.in_flight).toMatchObject({ phase: 'data', build_id: 'b1' });
    expect(status.body.latest).toMatchObject({ id: 'b1' });
  });

  it('translate-and-reconcile kicks the loop with the scope; retry-loop threads guidance; loop-status reflects the registry', async () => {
    const runLoop = jest.fn().mockResolvedValue({ results: [], order: [] });
    const a = app({ runLoop });
    const all = await request(a).post(`${P}/translations/translate-and-reconcile`).send({ target_db: target });
    expect(all.status).toBe(202);
    expect(runLoop.mock.calls[0][0]).toMatchObject({ projectId: 'p1', packId: 'k1', translationIds: null });
    const retry = await request(a).post(`${P}/translations/t1/retry-loop`).send({ target_db: target, guidance: 'raise 20012 when no row matched' });
    expect(retry.status).toBe(202);
    expect(runLoop.mock.calls[1][0]).toMatchObject({ translationIds: ['t1'], guidanceByTranslation: { t1: 'raise 20012 when no row matched' } });
    workbenchRegistry.set('k1', { packId: 'k1', startedAt: Date.now(), phase: 'looping', routines: 3, done: 1, events: [], result: null, error: null });
    const busy = await request(a).post(`${P}/translations/translate-and-reconcile`).send({ target_db: target });
    expect(busy.status).toBe(409);
    const status = await request(a).get(`${P}/translations/loop-status`);
    expect(status.body).toMatchObject({ in_flight: true, phase: 'looping', routines: 3, done: 1 });
  });

  it('reconcile-one runs parity for the routine and patches the loop fields', async () => {
    const runParity = jest.fn().mockResolvedValue({ baselineId: 'b1', reports: [{ routine_id: 'r1', routine_name: 'dbo.upd_ledger_roll', report_id: 'rep1', summary: { status: 'clean', divergent: 0, unverifiable: 0, scenarios: 4, signatures: [] } }], skipped: [], error: null });
    const patchTranslation = jest.fn().mockResolvedValue({});
    const a = app({
      runParity,
      patchTranslation,
      fetchPack: jest.fn().mockResolvedValue({ id: 'k1', architecture_id: 'a1', manifest_json: null }),
      fetchTranslations: jest.fn().mockResolvedValue([row({})]),
      fetchRoutines: jest.fn().mockResolvedValue([{ id: 'r1', schema_name: 'dbo', routine_name: 'upd_ledger_roll', routine_kind: 'procedure', params_json: [], profile_json: { max_result_sets: 0 } }]),
      fetchWaivers: jest.fn().mockResolvedValue([]),
    });
    const res = await request(a).post(`${P}/translations/t1/reconcile`).send({ target_db: target });
    expect(res.status).toBe(200);
    expect(runParity.mock.calls[0][0]).toMatchObject({ routineIds: ['r1'], purpose: 'workbench', packId: 'k1' });
    expect(Object.keys(runParity.mock.calls[0][0].descriptors)).toEqual(['upd_ledger_roll']);
    expect(patchTranslation).toHaveBeenCalledWith('p1', 'k1', 't1', expect.objectContaining({ loop_status: 'reconciled', parity_report_id: 'rep1' }));
  });

  it('waive requires a reason and records routine / scenario targets', async () => {
    const createWaiver = jest.fn().mockResolvedValue({ id: 'w1' });
    const a = app({ createWaiver, fetchTranslations: jest.fn().mockResolvedValue([row({})]) });
    expect((await request(a).post(`${P}/translations/t1/waive`).send({ scope: 'routine' })).status).toBe(400);
    const routine = await request(a).post(`${P}/translations/t1/waive`).send({ scope: 'routine', reason: 'known divergence' });
    expect(routine.status).toBe(201);
    expect(createWaiver.mock.calls[0][1]).toMatchObject({ target: 'upd_ledger_roll', reason: 'known divergence' });
    const scenario = await request(a).post(`${P}/translations/t1/waive`).send({ scope: 'scenario', scenario: 'zero_rows', reason: 'accepted' });
    expect(scenario.body.target).toBe('upd_ledger_roll::zero_rows');
  });

  it('approve-all-reconciled approves only reconciled drafted rows and runs one emission', async () => {
    const patchTranslation = jest.fn().mockResolvedValue({});
    const runEmission = jest.fn().mockResolvedValue({ approvedCount: 1, changed: true, demoted: [], emittedFilePaths: [] });
    const a = app({
      patchTranslation,
      runEmission,
      fetchTranslations: jest.fn().mockResolvedValue([row({ id: 'ok', loop_status: 'reconciled' }), row({ id: 'no', loop_status: 'exhausted' }), row({ id: 'already', loop_status: 'reconciled', review_status: 'approved' })]),
    });
    const res = await request(a).post(`${P}/translations/approve-all-reconciled`).send({});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ approved_count: 1, eligible_count: 1 });
    expect(patchTranslation).toHaveBeenCalledTimes(1);
    expect(patchTranslation.mock.calls[0][2]).toBe('ok');
    expect(runEmission).toHaveBeenCalledTimes(1);
  });

  it('baseline-status reports the pinned proc baseline facts', async () => {
    const a = app({ fetchPack: jest.fn().mockResolvedValue({ id: 'k1', architecture_id: 'a1', manifest_json: null }), fetchBaselineItems: jest.fn().mockResolvedValue({ baselineId: 'b1', items: [{ routine_id: 'r1', scenario_name: 's', inputs_json: [] }, { routine_id: 'r1', scenario_name: 't', inputs_json: [] }] }) });
    const res = await request(a).get(`${P}/translations/baseline-status`);
    expect(res.body).toEqual({ pinned: true, baseline_id: 'b1', scenarios: 2, routines: 1 });
  });
});
