/**
 * DB-plane completion chain (WS2, 2026-07-31).
 *
 * The chain that takes over when the last db-plane item IMPLEMENTS:
 * assemble (IVS, polled) -> schema-apply structural (AMVS) -> data load
 * (AMVS) -> schema-apply post-load -> reconcile -> finalize. Every failure
 * is phase-labelled onto the run-item and halts the run.
 */

jest.mock('../services/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
// Spec 5 (proc behaviour program): the final-plane findings leg reads the
// graduated gate; its matrix lives in its own suite — here it is a controllable
// stub (default: nothing to report).
jest.mock('../services/migrationProcParityGate', () => ({
  evaluateProcParityReadiness: jest.fn().mockResolvedValue({
    ok: true, reasons: [], warnings: [], counts: {}, findings: [], states: [],
  }),
}));
import { evaluateProcParityReadiness } from '../services/migrationProcParityGate';

import {
  createDbPlaneCompletionRunner,
  defaultApplySchema,
} from '../services/migrationDbPlaneCompletion';
import {
  RUN_STATUS,
  RUN_ITEM_STATUS,
  MigrationExecutionRun,
  MigrationExecutionRunItem,
} from '../services/migrationExecutionRunClient';
import type { MigrateScope, MigrationDriverDeps } from '../services/migrationExecutionDriver';
import type { TargetDbSecret } from '../services/migrationTargetCredentialsStore';

const scope: MigrateScope = {
  projectId: 'proj-1',
  bookId: 'book-1',
  company: 'acme',
  project: 'order-mig',
};

const secret: TargetDbSecret = {
  dbType: 'postgres',
  host: 'db.example.com',
  port: 5432,
  database: 'target',
  schema: null,
  username: 'u',
  password: 'p',
} as TargetDbSecret;

function makeRun(overrides: Partial<MigrationExecutionRun> = {}): MigrationExecutionRun {
  return {
    id: 'run-abc123',
    project_id: 'proj-1',
    book_of_work_id: 'book-1',
    status: RUN_STATUS.DISPATCHING,
    items: [
      {
        id: 'ri-0', run_id: 'run-abc123', sequence_position: 0,
        spec_name: '2026-07-31-schema-aaaa1111', status: RUN_ITEM_STATUS.IMPLEMENTED,
        job_id: 'job-1', deploy_on_complete: false,
      },
      {
        id: 'ri-1', run_id: 'run-abc123', sequence_position: 1,
        spec_name: '2026-07-31-parity-bbbb2222', status: RUN_ITEM_STATUS.IMPLEMENTED,
        job_id: 'job-2', deploy_on_complete: true,
      },
    ] as MigrationExecutionRunItem[],
    ...overrides,
  } as MigrationExecutionRun;
}

function driverDeps(run: MigrationExecutionRun): MigrationDriverDeps {
  return {
    fetchBookOfWork: jest.fn().mockResolvedValue({
      id: 'book-1', current_architecture_id: 'arch-1', book_of_work_json: { items: [] },
    }),
    getMigrationExecutionRun: jest.fn().mockResolvedValue(run),
    patchMigrationExecutionRun: jest.fn().mockResolvedValue({}),
    patchMigrationExecutionRunItem: jest.fn().mockResolvedValue({}),
    triggerDataParityReconcile: jest.fn().mockResolvedValue(undefined),
    triggerProcParityReconcile: jest.fn().mockResolvedValue(undefined),
  } as unknown as MigrationDriverDeps;
}

interface Wiring {
  order: string[];
  subDeps: NonNullable<Parameters<typeof createDbPlaneCompletionRunner>[0]>;
}

function wiring(overrides: Record<string, unknown> = {}): Wiring {
  const order: string[] = [];
  const subDeps = {
    fetchPackView: jest.fn().mockImplementation(async () => {
      order.push('packView');
      return {
        packId: 'pack-1', status: 'complete', inputSnapshotHash: null,
        manifest: { bulk_load: { table_order: ['dbo.t'], expected_row_counts: { 'dbo.t': 1 } } },
        decisions: [], translations: [],
      };
    }),
    fetchPackFiles: jest.fn().mockImplementation(async () => {
      order.push('packFiles');
      return [
        { path: 'liquibase/db.changelog-master.xml', content: '<x/>' },
        { path: 'liquibase/changesets/000-schemas.sql', content: '--changeset a:s\nSELECT 1;' },
        { path: 'manifest.json', content: '{}' },
      ];
    }),
    submitAssembly: jest.fn().mockImplementation(async () => {
      order.push('assemble:submit');
      return { ok: true, jobId: 'aj-1' };
    }),
    getJobStatus: jest.fn().mockImplementation(async () => {
      order.push('assemble:poll');
      return {
        status: 'completed',
        result: { branch: 'db-migration/runabc12', mr_url: 'https://gitlab.example.com/mr/7' },
        error: null,
      };
    }),
    applySchema: jest.fn().mockImplementation(async (args: { contexts: string[] }) => {
      order.push(`apply:${args.contexts.join(',')}`);
      return { ok: true, applied: 3, skipped: 0 };
    }),
    runDataMigration: jest.fn().mockImplementation(async () => {
      order.push('load');
      return { ok: true, status: 'loaded', rowsLoaded: 42 };
    }),
    getTargetDb: jest.fn().mockReturnValue(secret),
    getSourceDb: jest.fn().mockReturnValue(secret),
    pollIntervalMs: 1,
    pollTimeoutMs: 500,
    // Stage 1 reuse (2026-09-12): default = nothing to reuse (full build).
    reuseReads: {
      fetchLatestTargetBuild: jest.fn().mockResolvedValue(null),
      fetchLatestDataParityReport: jest.fn().mockResolvedValue(null),
    },
    ...overrides,
  };
  return { order, subDeps };
}

/** A workbench build + clean report that PROVE reuse for the fixture pack/target. */
function reusableWorkbench(packVersion = 'v7') {
  return {
    fetchLatestTargetBuild: jest.fn().mockResolvedValue({
      id: 'wb-1',
      pack_id: 'pack-1',
      status: 'succeeded',
      pack_version: packVersion,
      target_binding_json: { db_type: 'postgres', host: 'db.example.com', port: 5432, database: 'target', schema: null },
      started_at: '2026-09-12T09:00:00Z',
      ended_at: '2026-09-12T09:20:00Z',
    }),
    fetchLatestDataParityReport: jest.fn().mockResolvedValue({ id: 'rep-1', status: 'clean', created_at: '2026-09-12T10:00:00Z', report_json: null }),
  };
}

function itemPatches(deps: MigrationDriverDeps): Array<[string, Record<string, unknown>]> {
  return (deps.patchMigrationExecutionRunItem as jest.Mock).mock.calls.map((c) => [c[1], c[2]]);
}

function runPatches(deps: MigrationDriverDeps): Array<Record<string, unknown>> {
  return (deps.patchMigrationExecutionRun as jest.Mock).mock.calls.map((c) => c[2]);
}

describe('createDbPlaneCompletionRunner', () => {
  it('runs assemble -> structural apply -> load -> post-load apply -> reconcile, then DEPLOYS', async () => {
    const run = makeRun();
    const deps = driverDeps(run);
    const { order, subDeps } = wiring();
    const finalItem = run.items![1];

    await createDbPlaneCompletionRunner(subDeps)(scope, run, finalItem, deps);

    expect(order).toEqual([
      'packView', 'packFiles', 'assemble:submit', 'assemble:poll',
      'apply:structural', 'load', 'apply:post-load',
    ]);
    expect(deps.triggerDataParityReconcile).toHaveBeenCalledTimes(1);

    // The assembled MR lands on the item; the final item goes DEPLOYED.
    const deployed = itemPatches(deps).find(
      ([id, p]) => id === 'ri-1' && p.status === RUN_ITEM_STATUS.DEPLOYED
    );
    expect(deployed).toBeTruthy();
    expect(deployed![1].pr_url).toBe('https://gitlab.example.com/mr/7');
    // Invariant (2026-08-01): a DEPLOYED item carries no error residue.
    expect(deployed![1].error_detail).toBeNull();
    // No pending later items -> the run is DEPLOYED.
    expect(runPatches(deps)).toContainEqual({ status: RUN_STATUS.DEPLOYED });

    // Only the liquibase files travel to schema-apply.
    const applyArgs = (subDeps.applySchema as jest.Mock).mock.calls[0][0];
    expect(applyArgs.files.every((f: { path: string }) => f.path.startsWith('liquibase/'))).toBe(true);
    // The assembly gets the run's spec names in sequence order.
    const assembleArgs = (subDeps.submitAssembly as jest.Mock).mock.calls[0][0];
    expect(assembleArgs.specNames).toEqual([
      '2026-07-31-schema-aaaa1111', '2026-07-31-parity-bbbb2222',
    ]);
    expect(assembleArgs.branchName).toBe('db-migration/runabc12');
  });

  it('REUSES a succeeded workbench build (same pack version + target, clean reconcile after it): structural apply + load skipped, post-load apply + reconcile still run (2026-09-12)', async () => {
    const { order, subDeps } = wiring({
      reuseReads: reusableWorkbench('v7'),
      fetchPackView: jest.fn().mockResolvedValue({
        packId: 'pack-1', status: 'complete', inputSnapshotHash: 'v7',
        manifest: { bulk_load: { table_order: ['dbo.t'], expected_row_counts: { 'dbo.t': 1 } } },
        decisions: [], translations: [],
      }),
    });
    const run = makeRun();
    const deps = driverDeps(run);
    await createDbPlaneCompletionRunner(subDeps)(scope, run, run.items![1], deps);
    expect(order).not.toContain('apply:structural');
    expect(order).not.toContain('load');
    expect(order).toContain('apply:post-load');
    expect(deps.triggerDataParityReconcile).toHaveBeenCalledTimes(1);
    expect(runPatches(deps).some((p) => p.status === RUN_STATUS.DEPLOYED)).toBe(true);
  });

  it('does NOT reuse when the pack was regenerated since the workbench build, or the latest report is divergent — full build', async () => {
    const regenerated = wiring({
      reuseReads: reusableWorkbench('v6'),
      fetchPackView: jest.fn().mockResolvedValue({
        packId: 'pack-1', status: 'complete', inputSnapshotHash: 'v7',
        manifest: { bulk_load: { table_order: ['dbo.t'], expected_row_counts: { 'dbo.t': 1 } } },
        decisions: [], translations: [],
      }),
    });
    let run = makeRun();
    await createDbPlaneCompletionRunner(regenerated.subDeps)(scope, run, run.items![1], driverDeps(run));
    expect(regenerated.order).toContain('apply:structural');
    expect(regenerated.order).toContain('load');

    const divergentReads = reusableWorkbench('v7');
    divergentReads.fetchLatestDataParityReport = jest.fn().mockResolvedValue({ id: 'rep-2', status: 'divergent', created_at: '2026-09-12T11:00:00Z', report_json: null });
    const divergent = wiring({
      reuseReads: divergentReads,
      fetchPackView: jest.fn().mockResolvedValue({
        packId: 'pack-1', status: 'complete', inputSnapshotHash: 'v7',
        manifest: { bulk_load: { table_order: ['dbo.t'], expected_row_counts: { 'dbo.t': 1 } } },
        decisions: [], translations: [],
      }),
    });
    run = makeRun();
    await createDbPlaneCompletionRunner(divergent.subDeps)(scope, run, run.items![1], driverDeps(run));
    expect(divergent.order).toContain('apply:structural');
    expect(divergent.order).toContain('load');
  });

  it('pauses AWAITING_APPROVAL when later planes remain pending', async () => {
    const run = makeRun();
    run.items!.push({
      id: 'ri-2', run_id: 'run-abc123', sequence_position: 2,
      status: RUN_ITEM_STATUS.PENDING, deploy_on_complete: true,
    } as MigrationExecutionRunItem);
    const deps = driverDeps(run);
    const { subDeps } = wiring();

    await createDbPlaneCompletionRunner(subDeps)(scope, run, run.items![1], deps);

    expect(runPatches(deps)).toContainEqual({ status: RUN_STATUS.AWAITING_APPROVAL });
  });

  it('marks EVERY sibling deployed for a batch (single shared job_id)', async () => {
    const run = makeRun();
    run.items!.forEach((i) => (i.job_id = 'batch-job-1'));
    const deps = driverDeps(run);
    const { subDeps } = wiring();

    await createDbPlaneCompletionRunner(subDeps)(scope, run, run.items![1], deps);

    const deployedIds = itemPatches(deps)
      .filter(([, p]) => p.status === RUN_ITEM_STATUS.DEPLOYED)
      .map(([id]) => id);
    expect(deployedIds.sort()).toEqual(['ri-0', 'ri-1']);
  });

  it('fails at "inputs" with an actionable message when target creds are missing', async () => {
    const run = makeRun();
    const deps = driverDeps(run);
    const { subDeps } = wiring({ getTargetDb: jest.fn().mockReturnValue(undefined) });

    await createDbPlaneCompletionRunner(subDeps)(scope, run, run.items![1], deps);

    const failed = itemPatches(deps).find(([, p]) => p.status === RUN_ITEM_STATUS.FAILED);
    expect(failed).toBeTruthy();
    expect(String(failed![1].error_detail)).toContain('DB execution chain failed at inputs');
    expect(String(failed![1].error_detail)).toContain('target DB credentials');
    expect(runPatches(deps)).toContainEqual({ status: RUN_STATUS.HALTED });
    expect(subDeps.submitAssembly).not.toHaveBeenCalled();
  });

  it('fails at "assemble" when the assembly job fails, and never applies schema', async () => {
    const run = makeRun();
    const deps = driverDeps(run);
    const { subDeps } = wiring({
      getJobStatus: jest.fn().mockResolvedValue({
        status: 'failed', result: null, error: 'merge conflict assembling feature/x',
      }),
    });

    await createDbPlaneCompletionRunner(subDeps)(scope, run, run.items![1], deps);

    const failed = itemPatches(deps).find(([, p]) => p.status === RUN_ITEM_STATUS.FAILED);
    expect(String(failed![1].error_detail)).toContain('failed at assemble');
    expect(String(failed![1].error_detail)).toContain('merge conflict');
    expect(subDeps.applySchema).not.toHaveBeenCalled();
  });

  it('fails at "schema-apply structural" and never loads data', async () => {
    const run = makeRun();
    const deps = driverDeps(run);
    const { subDeps } = wiring({
      applySchema: jest.fn().mockResolvedValue({
        ok: false, applied: 1, skipped: 0,
        error: "schema-apply failed (changeset table-dbo.orders: type not found)",
      }),
    });

    await createDbPlaneCompletionRunner(subDeps)(scope, run, run.items![1], deps);

    const failed = itemPatches(deps).find(([, p]) => p.status === RUN_ITEM_STATUS.FAILED);
    expect(String(failed![1].error_detail)).toContain('failed at schema-apply structural');
    expect(subDeps.runDataMigration).not.toHaveBeenCalled();
  });

  it('fails at "data load" and never applies post-load', async () => {
    const run = makeRun();
    const deps = driverDeps(run);
    const { subDeps } = wiring({
      runDataMigration: jest.fn().mockResolvedValue({
        ok: false, status: null, rowsLoaded: null, error: 'source unreachable',
      }),
    });

    await createDbPlaneCompletionRunner(subDeps)(scope, run, run.items![1], deps);

    const failed = itemPatches(deps).find(([, p]) => p.status === RUN_ITEM_STATUS.FAILED);
    expect(String(failed![1].error_detail)).toContain('failed at data load');
    const applied = (subDeps.applySchema as jest.Mock).mock.calls.map((c) => c[0].contexts);
    expect(applied).toEqual([['structural']]);
  });

  it('a reconcile error does NOT fail the chain (the unclean report is the gate)', async () => {
    const run = makeRun();
    const deps = driverDeps(run);
    (deps.triggerDataParityReconcile as jest.Mock).mockRejectedValue(new Error('comparator down'));
    const { subDeps } = wiring();

    await createDbPlaneCompletionRunner(subDeps)(scope, run, run.items![1], deps);

    expect(runPatches(deps)).toContainEqual({ status: RUN_STATUS.DEPLOYED });
  });

  it('times out a stuck assembly job with a named failure', async () => {
    const run = makeRun();
    const deps = driverDeps(run);
    const { subDeps } = wiring({
      getJobStatus: jest.fn().mockResolvedValue({ status: 'running', result: null, error: null }),
      pollIntervalMs: 1,
      pollTimeoutMs: 5,
    });

    await createDbPlaneCompletionRunner(subDeps)(scope, run, run.items![1], deps);

    const failed = itemPatches(deps).find(([, p]) => p.status === RUN_ITEM_STATUS.FAILED);
    expect(String(failed![1].error_detail)).toContain('did not complete within');
  });
});

describe('defaultApplySchema response integrity (2026-08-01)', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  const args = {
    projectId: 'proj-1',
    architectureId: 'arch-1',
    targetDb: secret,
    files: [{ path: 'liquibase/db.changelog-master.xml', content: '<x/>' }],
    contexts: ['structural'],
  };

  it('treats a 2xx with an unparseable body as FAILURE, never ok/applied:0', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.reject(new Error('unexpected token')),
    }) as never;

    const result = await defaultApplySchema(args as never);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('unparseable body');
  });

  it('still reports a parseable 2xx as success with the summary counts', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ summary: { applied: 3, skipped: 1 } }),
    }) as never;

    const result = await defaultApplySchema(args as never);
    expect(result).toEqual({ ok: true, applied: 3, skipped: 1 });
  });
});

// ----------------------------------------------------------------------------
// Spec 5 (Stored Proc & Function Behaviour Program, 2026-09-09): step 6 —
// the proc-parity re-check fires after data parity (fail-open), and on the
// FINAL plane the run completes DEPLOYED with a `proc_parity_findings`
// decision-log entry when routines are not reconciled (never a block).
// ----------------------------------------------------------------------------
describe('createDbPlaneCompletionRunner — proc parity (Spec 5)', () => {
  it('fires the proc-parity re-check once, after the data-parity reconcile, and a failure never halts the chain', async () => {
    const run = makeRun();
    const deps = driverDeps(run);
    (deps.triggerProcParityReconcile as jest.Mock).mockRejectedValueOnce(new Error('amvs down'));
    const { subDeps } = wiring();

    await createDbPlaneCompletionRunner(subDeps)(scope, run, run.items![1], deps);

    expect(deps.triggerProcParityReconcile).toHaveBeenCalledTimes(1);
    const dataOrder = (deps.triggerDataParityReconcile as jest.Mock).mock.invocationCallOrder[0];
    const procOrder = (deps.triggerProcParityReconcile as jest.Mock).mock.invocationCallOrder[0];
    expect(procOrder).toBeGreaterThan(dataOrder);
    expect(runPatches(deps)).toContainEqual({ status: RUN_STATUS.DEPLOYED });
    expect(runPatches(deps)).not.toContainEqual({ status: RUN_STATUS.HALTED });
  });

  it('final plane with findings: DEPLOYED plus a proc_parity_findings decision-log entry listing the routines', async () => {
    (evaluateProcParityReadiness as jest.Mock).mockResolvedValueOnce({
      ok: true,
      reasons: [],
      warnings: ['2 stored routine(s) divergent (dbo.fn_ledger_total, dbo.sp_archive_old) — recorded as findings on the run; nothing blocks.'],
      counts: { routines: 3, reconciled: 1, divergent: 2 },
      findings: [
        { routine: 'dbo.fn_ledger_total', state: 'divergent', detail: 'workbench loop exhausted', dependent: false },
        { routine: 'dbo.sp_archive_old', state: 'divergent', detail: 'parity execution report divergent', dependent: false },
      ],
      states: [],
    });
    const run = makeRun({ decision_log_json: [{ type: 'earlier', at: 'x' }] });
    const deps = driverDeps(run);
    const { subDeps } = wiring();

    await createDbPlaneCompletionRunner(subDeps)(scope, run, run.items![1], deps);

    expect(evaluateProcParityReadiness).toHaveBeenCalledWith(expect.objectContaining({ architectureId: 'arch-1', nextPlane: null }));
    const findingsPatch = runPatches(deps).find((p) => Array.isArray(p.decision_log_json));
    expect(findingsPatch).toBeTruthy();
    const log = findingsPatch!.decision_log_json as Array<Record<string, unknown>>;
    expect(log[0]).toEqual({ type: 'earlier', at: 'x' });
    expect(log[1]).toMatchObject({ type: 'proc_parity_findings', routines: [expect.objectContaining({ routine: 'dbo.fn_ledger_total' }), expect.objectContaining({ routine: 'dbo.sp_archive_old' })] });
    expect(runPatches(deps)).toContainEqual({ status: RUN_STATUS.DEPLOYED });
  });

  it('a paused run (pending later plane) records no findings entry — the gate runs at the plane boundary instead', async () => {
    (evaluateProcParityReadiness as jest.Mock).mockClear();
    const run = makeRun({
      items: [
        ...makeRun().items!,
        { id: 'ri-2', run_id: 'run-abc123', sequence_position: 2, spec_name: 'svc', status: RUN_ITEM_STATUS.PENDING, job_id: null, deploy_on_complete: true } as MigrationExecutionRunItem,
      ],
    });
    const deps = driverDeps(run);
    const { subDeps } = wiring();
    await createDbPlaneCompletionRunner(subDeps)(scope, run, run.items![1], deps);
    expect(evaluateProcParityReadiness).not.toHaveBeenCalled();
    expect(runPatches(deps)).toContainEqual({ status: RUN_STATUS.AWAITING_APPROVAL });
  });
});
