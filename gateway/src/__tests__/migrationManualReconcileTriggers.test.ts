/**
 * Manual reconciliation trigger tests (2026-08-16). Pure DI — no network.
 *
 * Coverage: parity start (tables resolved, runner receives the creds),
 * parity blocked (no creds / no pack scope), API reconcile start (creds
 * registered, trigger fired with the effective base URL), API blocked (no
 * run / no pinned baseline / non-terminal breaks latch / no auth), body
 * validation, and the neither-selected error.
 */

import {
  ManualReconcileDeps,
  startManualReconciliation,
} from '../services/migrationManualReconcileTriggers';
import type { MigrationExecutionRun } from '../services/migrationExecutionRunClient';
import type { MigrationReconciliationBreak } from '../services/migrationReconciliationBreakClient';
import type { TargetDbSecret } from '../services/migrationTargetCredentialsStore';

const PROJECT = 'proj-1';
const ARCH = 'arch-1';
const BOOK = 'book-1';
const ARGS = { projectId: PROJECT, architectureId: ARCH, bookId: BOOK };

const SOURCE_DB = {
  dbType: 'sybase',
  host: 'src-host',
  port: 5000,
  database: 'legacy',
  username: 'sa',
  password: 'pw',
};
const TARGET_DB = {
  dbType: 'postgres',
  host: 'tgt-host',
  port: 5432,
  database: 'migrated',
  username: 'pg',
  password: 'pw2',
};

function deployedRun(): MigrationExecutionRun {
  return {
    id: 'run-1',
    project_id: PROJECT,
    status: 'deployed',
    pinned_current_baseline_id: 'bl-1',
    target_base_url: 'http://target:8080',
    items: [],
  };
}

function makeDeps(overrides: Partial<ManualReconcileDeps> = {}) {
  const calls = {
    parity: [] as unknown[],
    trigger: [] as MigrationExecutionRun[],
    registered: [] as Array<{ runId: string; db?: TargetDbSecret }>,
    patched: [] as unknown[],
    breakPatches: [] as Array<{ breakId: string; body: Record<string, unknown> }>,
  };
  const deps: ManualReconcileDeps = {
    resolveTables: async () => [
      { schema: 'dbo', table: 't1', primaryKey: ['id'] },
      { schema: 'dbo', table: 't2' },
    ],
    runParity: (async (args: unknown) => {
      calls.parity.push(args);
      return { ok: true, reportPersisted: true, status: 'clean', reportId: 'rep-1' };
    }) as ManualReconcileDeps['runParity'],
    getRunsForBook: async () => [deployedRun()],
    getBreaksForRun: async () => [],
    patchBreak: (async (_p: string, breakId: string, body: MigrationReconciliationBreak) => {
      calls.breakPatches.push({ breakId, body: body as Record<string, unknown> });
      return body;
    }) as ManualReconcileDeps['patchBreak'],
    patchRun: (async (_p: string, _r: string, patch: unknown) => {
      calls.patched.push(patch);
      return deployedRun();
    }) as ManualReconcileDeps['patchRun'],
    triggerApiReconcile: async (run) => {
      calls.trigger.push(run);
      return { status: 'reconciled_with_breaks', breakCount: 0 } as never;
    },
    reconciliationDriverDeps: () => ({}) as never,
    registerTargetCreds: (runId, _api, db) => {
      calls.registered.push({ runId, db });
    },
    getRegisteredTargetApi: () => undefined,
    getRegisteredTargetDb: () => undefined,
    getRegisteredSourceDb: () => undefined,
    upsertSourceDb: () => undefined,
    upsertSourceApi: () => undefined,
    ...overrides,
  };
  return { deps, calls };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('startManualReconciliation', () => {
  it('rejects when neither reconciliation is selected', async () => {
    const { deps } = makeDeps();
    const outcome = await startManualReconciliation(
      { ...ARGS, request: { runDataParity: false, runApiReconcile: false } },
      deps,
    );
    expect(outcome).toEqual({ ok: false, error: 'Select at least one reconciliation to run.' });
  });

  it('rejects a partial DB block before any side effect', async () => {
    const { deps, calls } = makeDeps();
    const outcome = await startManualReconciliation(
      {
        ...ARGS,
        request: {
          runDataParity: true,
          runApiReconcile: false,
          sourceDb: { host: 'only-host' },
          targetDb: TARGET_DB,
        },
      },
      deps,
    );
    expect(outcome.ok).toBe(false);
    expect(calls.parity).toHaveLength(0);
  });

  it('starts the data parity run with the provided creds and pack table scope', async () => {
    const { deps, calls } = makeDeps();
    const outcome = await startManualReconciliation(
      {
        ...ARGS,
        request: {
          runDataParity: true,
          runApiReconcile: false,
          sourceDb: SOURCE_DB,
          targetDb: TARGET_DB,
        },
      },
      deps,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.dataParity?.status).toBe('started');
    expect(outcome.result.apiReconcile).toBeNull();
    await flush();
    expect(calls.parity).toHaveLength(1);
    const args = calls.parity[0] as {
      sourceDb: { host: string };
      targetDb: { host: string };
      tables: unknown[];
    };
    expect(args.sourceDb.host).toBe('src-host');
    expect(args.targetDb.host).toBe('tgt-host');
    expect(args.tables).toHaveLength(2);
  });

  it('blocks data parity without creds, and without a pack table scope', async () => {
    const noCreds = makeDeps();
    const outcome1 = await startManualReconciliation(
      { ...ARGS, request: { runDataParity: true, runApiReconcile: false } },
      noCreds.deps,
    );
    expect(outcome1.ok && outcome1.result.dataParity?.status).toBe('blocked');

    const noTables = makeDeps({ resolveTables: async () => [] });
    const outcome2 = await startManualReconciliation(
      {
        ...ARGS,
        request: {
          runDataParity: true,
          runApiReconcile: false,
          sourceDb: SOURCE_DB,
          targetDb: TARGET_DB,
        },
      },
      noTables.deps,
    );
    expect(outcome2.ok && outcome2.result.dataParity?.status).toBe('blocked');
    await flush();
    expect(noTables.calls.parity).toHaveLength(0);
  });

  it('falls back to registered store creds so a re-run needs no re-typing', async () => {
    const { deps, calls } = makeDeps({
      getRegisteredSourceDb: () => ({ ...SOURCE_DB, dbType: 'sybase' }) as TargetDbSecret,
      getRegisteredTargetDb: () => ({ ...TARGET_DB, dbType: 'postgres' }) as TargetDbSecret,
    });
    const outcome = await startManualReconciliation(
      { ...ARGS, request: { runDataParity: true, runApiReconcile: false } },
      deps,
    );
    expect(outcome.ok && outcome.result.dataParity?.status).toBe('started');
    await flush();
    expect(calls.parity).toHaveLength(1);
  });

  it('starts the API reconcile: registers creds, patches a new target URL, fires the trigger', async () => {
    const { deps, calls } = makeDeps();
    const outcome = await startManualReconciliation(
      {
        ...ARGS,
        request: {
          runDataParity: false,
          runApiReconcile: true,
          api: { type: 'bearer', bearerToken: 'tok' },
          targetBaseUrl: 'http://new-target:9090',
          targetDb: TARGET_DB,
          sourceApi: {
            currentBaseUrl: 'http://current:8080',
            api: { type: 'none' },
          },
        },
      },
      deps,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.apiReconcile?.status).toBe('started');
    await flush();
    expect(calls.registered).toEqual([
      { runId: 'run-1', db: expect.objectContaining({ host: 'tgt-host' }) },
    ]);
    expect(calls.patched).toEqual([{ target_base_url: 'http://new-target:9090' }]);
    expect(calls.trigger).toHaveLength(1);
    expect(calls.trigger[0].target_base_url).toBe('http://new-target:9090');
  });

  it('blocks the API reconcile without a run, and without auth', async () => {
    const noRun = makeDeps({ getRunsForBook: async () => [] });
    const outcome1 = await startManualReconciliation(
      {
        ...ARGS,
        request: { runDataParity: false, runApiReconcile: true, api: { type: 'none' } },
      },
      noRun.deps,
    );
    expect(outcome1.ok && outcome1.result.apiReconcile?.status).toBe('blocked');

    const noAuth = makeDeps();
    const outcome2 = await startManualReconciliation(
      { ...ARGS, request: { runDataParity: false, runApiReconcile: true } },
      noAuth.deps,
    );
    expect(outcome2.ok && outcome2.result.apiReconcile?.status).toBe('blocked');
    await flush();
    expect(noAuth.calls.trigger).toHaveLength(0);
  });

  it('blocks the API reconcile while non-terminal breaks latch the run', async () => {
    const { deps, calls } = makeDeps({
      getBreaksForRun: async () => [
        { id: 'b1', disposition_status: 'open' },
        { id: 'b2', disposition_status: 'accepted' },
      ],
    });
    const outcome = await startManualReconciliation(
      {
        ...ARGS,
        request: { runDataParity: false, runApiReconcile: true, api: { type: 'none' } },
      },
      deps,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.apiReconcile?.status).toBe('blocked');
    expect(
      outcome.result.apiReconcile?.status === 'blocked' &&
        outcome.result.apiReconcile.reason,
    ).toContain('1 unresolved break');
    await flush();
    expect(calls.trigger).toHaveLength(0);
  });

  it('supersede flag terminally disposes the unresolved breaks, then fires the re-run', async () => {
    const { deps, calls } = makeDeps({
      getBreaksForRun: async () => [
        { id: 'b1', disposition_status: 'open' },
        { id: 'b2', disposition_status: 'accepted' }, // already terminal — untouched
        { id: 'b3', disposition_status: 'still_broken' },
      ],
    });
    const outcome = await startManualReconciliation(
      {
        ...ARGS,
        request: {
          runDataParity: false,
          runApiReconcile: true,
          api: { type: 'none' },
          supersedeOpenBreaks: true,
        },
      },
      deps,
    );
    expect(outcome.ok && outcome.result.apiReconcile?.status).toBe('started');
    await flush();
    // Only the NON-terminal breaks are superseded, to wont_report with audit.
    expect(calls.breakPatches.map((p) => p.breakId)).toEqual(['b1', 'b3']);
    expect(calls.breakPatches[0].body.disposition_status).toBe('wont_report');
    expect(String(calls.breakPatches[0].body.error_detail)).toContain('superseded');
    expect(calls.trigger).toHaveLength(1);
  });

  it('an all-terminal break set unlatches the manual re-run (gold-standard rule)', async () => {
    const { deps, calls } = makeDeps({
      getBreaksForRun: async () => [
        { id: 'b1', disposition_status: 'fixed_confirmed' },
        { id: 'b2', disposition_status: 'accepted' },
      ],
    });
    const outcome = await startManualReconciliation(
      {
        ...ARGS,
        request: { runDataParity: false, runApiReconcile: true, api: { type: 'none' } },
      },
      deps,
    );
    expect(outcome.ok && outcome.result.apiReconcile?.status).toBe('started');
    await flush();
    expect(calls.trigger).toHaveLength(1);
  });
});
