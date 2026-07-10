/**
 * Baseline drift scheduler + target-DB credential threading (Tier-1 batch
 * 2026-07-10 — Spec 2026-07-06-i §6 / Spec 2026-07-06-n residuals; user
 * decisions Q2b + Q3).
 *
 * Pins:
 *   - TICK: a registered watch with a STALE drift posture fires exactly one
 *     drift check (with the registered creds incl. the optional db block);
 *     a FRESH posture fires nothing; an unregistered store is a no-op;
 *     one watch's failure never blocks the others.
 *   - DB THREADING: runHeadlessReconcile forwards the db block as
 *     `dbConfigRedactedJson` on the session CREATE (config only — the
 *     password NEVER rides the create) and as `db.password` on the
 *     in-memory secrets load; absent db = both omitted (legacy bodies).
 */

import {
  CurrentSystemCredentialsStore,
  runDriftTick,
  type DriftSchedulerConfig,
} from '../services/baselineDriftScheduler';
import {
  runHeadlessReconcile,
  type ReconciliationValidationDeps,
} from '../services/migrationReconciliationValidationClient';
import type { CodeGateReads, GateDiffRow } from '../services/migrationCodeExecutionGate';

const CONFIG: DriftSchedulerConfig = {
  enabled: true,
  intervalMs: 60_000,
  maxAgeDays: 14,
};

const DB = {
  dbType: 'sybase' as const,
  host: 'syb.example.test',
  port: 5000,
  database: 'legacy_db',
  schema: null,
  username: 'reader',
  password: 'pw-in-memory',
};

function watch(projectId: string) {
  return {
    projectId,
    architectureId: 'arch-1',
    sourceBaselineId: `baseline-${projectId}`,
    currentBaseUrl: 'https://current.example.test',
    api: { type: 'none' as const },
    db: DB,
  };
}

function gateReads(diffs: GateDiffRow[]): CodeGateReads {
  return {
    fetchEndpointBaselineCoverageRows: jest.fn(),
    fetchCoverageSummaryForBaseline: jest.fn(),
    listDiffsForBaseline: jest.fn(async () => diffs),
    listDiffItems: jest.fn(async () => []),
  } as unknown as CodeGateReads;
}

const FRESH_DRIFT_DIFF: GateDiffRow = {
  id: 'drift-fresh',
  status: 'completed',
  computed_at: new Date().toISOString(),
  endpoint_scope_json: { keys: null, purpose: 'drift_check' },
};

test('TICK: stale posture fires one check with the registered creds; fresh fires none', async () => {
  const store = new CurrentSystemCredentialsStore();
  store.set(watch('proj-stale'));
  const fired: Array<Record<string, unknown>> = [];
  const runDriftCheck = jest.fn(async (args: Record<string, unknown>) => {
    fired.push(args);
    return { clean: true, coverage: { breaks: 0 } } as never;
  });

  // No drift-check diffs at all → unchecked → fires.
  const stale = await runDriftTick(CONFIG, {
    store,
    gateReads: gateReads([]),
    runDriftCheck: runDriftCheck as never,
  });
  expect(stale).toEqual({ checked: 1, fired: 1 });
  expect(fired[0]).toMatchObject({
    projectId: 'proj-stale',
    sourceBaselineId: 'baseline-proj-stale',
    currentBaseUrl: 'https://current.example.test',
    db: DB,
  });

  // Fresh drift diff → nothing fires.
  const fresh = await runDriftTick(CONFIG, {
    store,
    gateReads: gateReads([FRESH_DRIFT_DIFF]),
    runDriftCheck: runDriftCheck as never,
  });
  expect(fresh).toEqual({ checked: 1, fired: 0 });
  expect(runDriftCheck).toHaveBeenCalledTimes(1);

  // Empty store → complete no-op.
  const empty = await runDriftTick(CONFIG, {
    store: new CurrentSystemCredentialsStore(),
    gateReads: gateReads([]),
    runDriftCheck: runDriftCheck as never,
  });
  expect(empty).toEqual({ checked: 0, fired: 0 });
});

test('TICK: one watch failing never blocks the others (failure-isolated)', async () => {
  const store = new CurrentSystemCredentialsStore();
  store.set(watch('proj-a'));
  store.set(watch('proj-b'));
  const reads = {
    fetchEndpointBaselineCoverageRows: jest.fn(),
    fetchCoverageSummaryForBaseline: jest.fn(),
    listDiffsForBaseline: jest.fn(async (projectId: string) => {
      if (projectId === 'proj-a') throw new Error('AMS down for a');
      return [];
    }),
    listDiffItems: jest.fn(async () => []),
  } as unknown as CodeGateReads;
  const runDriftCheck = jest.fn(async () => ({ clean: true, coverage: { breaks: 0 } }) as never);

  const result = await runDriftTick(CONFIG, {
    store,
    gateReads: reads,
    runDriftCheck: runDriftCheck as never,
  });
  expect(result.checked).toBe(2);
  expect(result.fired).toBe(1); // proj-b fired despite proj-a's read failure
});

test('DB THREADING: config rides the session create; the password ONLY the secrets load', async () => {
  const createBodies: Array<Record<string, unknown>> = [];
  const secretBodies: Array<Record<string, unknown>> = [];
  const deps: ReconciliationValidationDeps = {
    createTargetSession: jest.fn(async (args) => {
      createBodies.push(args as unknown as Record<string, unknown>);
      return 'session-1';
    }),
    loadSecrets: jest.fn(async (args) => {
      secretBodies.push(args as unknown as Record<string, unknown>);
    }),
    startSession: jest.fn(async () => undefined),
    getSessionStatus: jest.fn(async () => ({ status: 'completed' })),
    listTargetBaselines: jest.fn(async () => [
      { id: 'tb-1', session_id: 'session-1', updated_at: '2026-07-10T00:00:00Z' },
    ]),
    getDiffByTargetBaseline: jest.fn(async () => ({ diffId: 'diff-1', status: 'completed' })),
    getDiffStatus: jest.fn(async () => ({ diffId: 'diff-1', status: 'completed' })),
    listDiffItems: jest.fn(async () => []),
    sleep: jest.fn(async () => undefined),
    now: () => 1700000000000,
  };

  await runHeadlessReconcile(
    {
      projectId: 'proj-1',
      architectureId: 'arch-1',
      sourceBaselineId: 'src-b',
      targetBaseUrl: 'https://target.example.test',
      api: { type: 'none' } as never,
      db: DB,
    },
    deps,
  );
  const createArgs = createBodies[0] as { dbConfig?: Record<string, unknown> };
  expect(createArgs.dbConfig).toEqual({
    dbType: 'sybase',
    host: 'syb.example.test',
    port: 5000,
    database: 'legacy_db',
    schema: null,
    username: 'reader',
  });
  // The password NEVER rides the create payload.
  expect(JSON.stringify(createArgs)).not.toContain('pw-in-memory');
  expect(secretBodies[0]).toMatchObject({ dbPassword: 'pw-in-memory' });

  // Absent db: both omitted — legacy bodies byte-identical.
  await runHeadlessReconcile(
    {
      projectId: 'proj-1',
      architectureId: 'arch-1',
      sourceBaselineId: 'src-b',
      targetBaseUrl: 'https://target.example.test',
      api: { type: 'none' } as never,
    },
    deps,
  );
  expect((createBodies[1] as { dbConfig?: unknown }).dbConfig).toBeNull();
  expect((secretBodies[1] as { dbPassword?: unknown }).dbPassword).toBeNull();
});
