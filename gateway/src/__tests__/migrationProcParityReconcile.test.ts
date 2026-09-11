/**
 * Spec 5 (Stored Proc & Function Behaviour Program, 2026-09-09): proc parity
 * at execution — preconditions as named block reasons, the AMVS call shape
 * (descriptors keyed by bare name, purpose, pack id, waivers), and the
 * DB-plane trigger's loud skip / never-throw contract. Pure DI.
 */

jest.mock('../services/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../migrationPairRules', () => ({ loadPairRuleset: () => ({ pair_id: 'sybase15-postgres18', version: 2, rules: [] }) }));

import {
  checkProcParityPreconditions,
  createProcParityReconcileTrigger,
  runProcParityForArchitecture,
  type ProcParityRunDeps,
} from '../services/migrationProcParityReconcile';
import type { MigrateScope, MigrationDriverDeps } from '../services/migrationExecutionDriver';
import type { TargetDbSecret } from '../services/migrationTargetCredentialsStore';

const target: TargetDbSecret = { dbType: 'postgres', host: 'h', port: 5432, database: 'd', schema: null, username: 'u', password: 'p' } as TargetDbSecret;

function deps(overrides: Partial<ProcParityRunDeps> = {}): ProcParityRunDeps {
  return {
    fetchPackView: (async () => ({ packId: 'k1', manifest: {}, translations: [] })) as never,
    fetchTranslations: (async () => [
      { id: 't1', kind: 'stored_procedure', disposition: 'translate', routine_id: 'r1' },
      { id: 't2', kind: 'function', disposition: 'translate', routine_id: 'r2' },
      { id: 't3', kind: 'stored_procedure', disposition: 'drop', routine_id: 'r3' },
      { id: 't4', kind: 'view', disposition: 'translate', routine_id: null },
    ]) as never,
    fetchRoutines: (async () => [
      { id: 'r1', schema_name: 'dbo', routine_name: 'upd_ledger_roll', routine_kind: 'procedure', params_json: [], profile_json: { max_result_sets: 0 } },
      { id: 'r2', schema_name: 'dbo', routine_name: 'fn_ledger_total', routine_kind: 'function', params_json: [], profile_json: {}, returns_type: 'int' },
    ]) as never,
    fetchBaselineItems: async () => ({ baselineId: 'b1', items: [] }),
    fetchWaivers: async () => [{ id: 'w1', target: 'upd_ledger_roll::zero_rows', reason: 'accepted', dimension: 'proc-parity' } as never],
    runParity: jest.fn().mockResolvedValue({
      baselineId: 'b1',
      reports: [
        { routine_id: 'r1', routine_name: 'dbo.upd_ledger_roll', report_id: 'rep1', summary: { status: 'clean', divergent: 0, unverifiable: 0, scenarios: 4, signatures: [] } },
        { routine_id: 'r2', routine_name: 'dbo.fn_ledger_total', report_id: 'rep2', summary: { status: 'divergent', divergent: 1, unverifiable: 0, scenarios: 3, signatures: [] } },
      ],
      skipped: [],
      error: null,
    }),
    ...overrides,
  };
}

describe('checkProcParityPreconditions', () => {
  it('names the missing pack / pinned baseline; routines = translate-dispositioned catalog-linked rows', async () => {
    expect(await checkProcParityPreconditions('p', 'a', deps({ fetchPackView: (async () => null) as never }))).toMatchObject({ ok: false, blocked: expect.stringContaining('No DB migration pack') });
    expect(await checkProcParityPreconditions('p', 'a', deps({ fetchBaselineItems: async () => ({ baselineId: null, items: [] }) }))).toMatchObject({ ok: false, blocked: expect.stringContaining('No pinned proc behaviour baseline') });
    expect(await checkProcParityPreconditions('p', 'a', deps())).toMatchObject({ ok: true, packId: 'k1', routineIds: ['r1', 'r2'], baselineId: 'b1' });
    expect(await checkProcParityPreconditions('p', 'a', deps({ fetchTranslations: (async () => []) as never }))).toMatchObject({ ok: true, packId: 'k1', routineIds: [], baselineId: null });
  });
});

describe('runProcParityForArchitecture', () => {
  it('calls AMVS with descriptors by bare name, the purpose, the pack id and the waivers; rolls up the status', async () => {
    const d = deps();
    const result = await runProcParityForArchitecture({ projectId: 'p', architectureId: 'a', targetDb: target, purpose: 'execution' }, d);
    expect(result).toMatchObject({ ok: true, status: 'divergent', baselineId: 'b1', routines: 2 });
    const call = (d.runParity as jest.Mock).mock.calls[0][0];
    expect(call).toMatchObject({ projectId: 'p', architectureId: 'a', routineIds: ['r1', 'r2'], purpose: 'execution', packId: 'k1' });
    expect(Object.keys(call.descriptors).sort()).toEqual(['fn_ledger_total', 'upd_ledger_roll']);
    expect(call.waivers).toEqual([{ scope: 'scenario', routine: 'upd_ledger_roll', scenario: 'zero_rows', reason: 'accepted' }]);
  });

  it('no routines = an honest no_routines; an engine error never throws', async () => {
    expect(await runProcParityForArchitecture({ projectId: 'p', architectureId: 'a', targetDb: target, purpose: 'manual' }, deps({ fetchTranslations: (async () => []) as never }))).toMatchObject({ ok: true, status: 'no_routines', routines: 0 });
    expect(await runProcParityForArchitecture({ projectId: 'p', architectureId: 'a', targetDb: target, purpose: 'manual' }, deps({ runParity: jest.fn().mockRejectedValue(new Error('amvs down')) }))).toEqual({ ok: false, error: 'amvs down' });
  });
});

describe('createProcParityReconcileTrigger', () => {
  const scope: MigrateScope = { projectId: 'p', bookId: 'book-1', company: 'acme', project: 'order-mig' } as MigrateScope;
  const driverDeps = {
    getMigrationExecutionRun: jest.fn().mockResolvedValue({ id: 'run-1', book_of_work_id: 'book-1' }),
    fetchBookOfWork: jest.fn().mockResolvedValue({ id: 'book-1', current_architecture_id: 'a' }),
  } as unknown as MigrationDriverDeps;

  it('skips loudly without target creds and never throws', async () => {
    const runParity = jest.fn();
    await createProcParityReconcileTrigger({ ...deps({ runParity }), getTargetDb: () => undefined })(scope, 'run-1', driverDeps);
    expect(runParity).not.toHaveBeenCalled();
  });

  it('runs with purpose=execution when the creds are registered; an engine failure is contained', async () => {
    const d = deps();
    await createProcParityReconcileTrigger({ ...d, getTargetDb: () => target })(scope, 'run-1', driverDeps);
    expect((d.runParity as jest.Mock).mock.calls[0][0]).toMatchObject({ purpose: 'execution', targetDb: target });
    await expect(
      createProcParityReconcileTrigger({ ...deps({ runParity: jest.fn().mockRejectedValue(new Error('boom')) }), getTargetDb: () => target })(scope, 'run-1', driverDeps),
    ).resolves.toBeUndefined();
  });
});
