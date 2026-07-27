/**
 * Phased execution — plane model + human-gated pause/resume (Spec W).
 *
 * Pins the load-bearing behaviour of the reframe:
 *   - plane assignment from workstream / `stream:` tag (db / service / ui);
 *   - buildPhasedDispatchSet groups into plane phases, each phase's LAST item
 *     deploys, global re-sequencing, tier-driven (empty planes drop out);
 *   - a `deployed` callback on a NON-final plane PAUSES the run
 *     (awaiting_approval) + fires the plane reconcile; the FINAL plane deploys;
 *   - resumeMigration dispatches the next plane only from awaiting_approval.
 */
import {
  planeForWorkstream,
  planeForItem,
  buildPhasedDispatchSet,
  advanceRunOnBuildResult,
  resumeMigration,
  MigrationDriverDeps,
} from '../services/migrationExecutionDriver';
import {
  RUN_STATUS,
  RUN_ITEM_STATUS,
  MigrationExecutionRun,
} from '../services/migrationExecutionRunClient';
import { BookOfWork } from '../services/migrationDriverAmsReads';

const PROJECT_ID = 'proj-1';

function specGen(workItemId: string, id: string, text = 'shape-spec text') {
  return { id, work_item_id: workItemId, status: 'generated', generated_spec_text: text };
}

function makeDeps(overrides: Partial<MigrationDriverDeps> = {}): MigrationDriverDeps {
  return {
    fetchBookOfWork: jest.fn(),
    fetchSpecGenerationsForBook: jest.fn().mockResolvedValue([]),
    fetchWorkItems: jest.fn().mockResolvedValue([]),
    fetchActiveCurrentBaseline: jest.fn().mockResolvedValue({ id: 'bl-1' }),
    createMigrationExecutionRun: jest.fn(),
    getMigrationExecutionRun: jest.fn(),
    patchMigrationExecutionRun: jest.fn().mockResolvedValue({}),
    patchMigrationExecutionRunItem: jest.fn().mockResolvedValue({}),
    findMigrationRunItemByJobId: jest.fn(),
    submitOrchestration: jest.fn(),
    recordWorkItemImplementationError: jest.fn().mockResolvedValue(undefined),
    autoAnswerer: {
      driveAndAnswer: jest
        .fn()
        .mockResolvedValue({ ok: true, specName: 's', sessionId: null, decisionLog: [] }),
    },
    buildResultsCallbackUrl: 'http://gw/cb',
    triggerReconcile: jest.fn().mockResolvedValue(undefined),
    triggerDataParityReconcile: jest.fn().mockResolvedValue(undefined),
    triggerDataMigration: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as MigrationDriverDeps;
}

describe('plane assignment', () => {
  it('maps workstreams to planes with service as the default', () => {
    expect(planeForWorkstream('target_database_schema_implementation')).toBe('db');
    expect(planeForWorkstream('data_migration')).toBe('db');
    expect(planeForWorkstream('target_infrastructure_environment_implementation')).toBe('db');
    // 2026-07-27: parity reconcile/reporting is DB-plane work — this token
    // was missing here while the FE rail's display mirror had it, so the
    // same story sat on the DB card but ran/gated in the SERVICE phase. The
    // two vocabularies must stay identical (the FE pins the same 4 tokens).
    expect(planeForWorkstream('data_parity_reconciliation_reporting')).toBe('db');
    expect(planeForWorkstream('api_migration')).toBe('service');
    expect(planeForWorkstream('internal_processing_implementation')).toBe('service');
    expect(planeForWorkstream('target_frontend_implementation')).toBe('ui');
    expect(planeForWorkstream('cutover_rollback_decommission')).toBe('ui');
    // Cross-cutting / meta -> service default.
    expect(planeForWorkstream('architecture_refinement')).toBe('service');
    expect(planeForWorkstream(null)).toBe('service');
  });

  it('derives the plane from a stream: tag when no workstream field is present', () => {
    expect(planeForItem({ tags: ['provenance:x', 'stream:api_migration'] })).toBe('service');
    expect(planeForItem({ tags: ['stream:target_database_schema_implementation'] })).toBe('db');
    // Explicit workstream wins over the tag.
    expect(
      planeForItem({ workstream: 'target_frontend_implementation', tags: ['stream:api_migration'] }),
    ).toBe('ui');
  });
});

describe('buildPhasedDispatchSet', () => {
  function book(): BookOfWork {
    return {
      id: 'book-1',
      current_architecture_id: 'arch-1',
      book_of_work_json: {
        items: [
          // Deliberately interleaved so grouping is exercised, not source order.
          { id: 'bi-svc', workItemId: 'wi-svc', workstream: 'api_migration', title: 'API', sequenceOrder: 5 },
          { id: 'bi-db1', workItemId: 'wi-db1', workstream: 'target_database_schema_implementation', title: 'schema', sequenceOrder: 2 },
          { id: 'bi-ui', workItemId: 'wi-ui', workstream: 'target_frontend_implementation', title: 'FE', sequenceOrder: 7 },
          { id: 'bi-db2', workItemId: 'wi-db2', workstream: 'data_migration', title: 'data', sequenceOrder: 3 },
        ],
      },
    };
  }
  const specGens = [
    specGen('wi-svc', 'sg-svc'),
    specGen('wi-db1', 'sg-db1'),
    specGen('wi-ui', 'sg-ui'),
    specGen('wi-db2', 'sg-db2'),
  ];

  it('groups into plane phases (db -> service -> ui), each phase last item deploys', () => {
    const plan = buildPhasedDispatchSet({
      book: book(),
      specGens,
      deferredWorkItemIds: new Set(),
    });
    expect(plan.phases.map((p) => p.plane)).toEqual(['db', 'service', 'ui']);
    expect(plan.phases[0].descriptors.map((d) => d.workItemId)).toEqual(['wi-db1', 'wi-db2']);
    expect(plan.phases[1].descriptors.map((d) => d.workItemId)).toEqual(['wi-svc']);
    expect(plan.phases[2].descriptors.map((d) => d.workItemId)).toEqual(['wi-ui']);

    // Global re-sequence 0..N and per-phase-last deploy flags.
    expect(plan.descriptors.map((d) => d.sequencePosition)).toEqual([0, 1, 2, 3]);
    const deployPositions = plan.descriptors.filter((d) => d.deployOnComplete).map((d) => d.sequencePosition);
    expect(deployPositions).toEqual([1, 2, 3]); // last of db, service, ui
  });

  it('drops empty planes (tier-driven): a DB-only book has ONE phase', () => {
    const dbOnly: BookOfWork = {
      id: 'book-2',
      book_of_work_json: {
        items: [
          { id: 'bi-a', workItemId: 'wi-a', workstream: 'target_database_schema_implementation', sequenceOrder: 1 },
          { id: 'bi-b', workItemId: 'wi-b', workstream: 'data_migration', sequenceOrder: 2 },
        ],
      },
    };
    const plan = buildPhasedDispatchSet({
      book: dbOnly,
      specGens: [specGen('wi-a', 'sg-a'), specGen('wi-b', 'sg-b')],
      deferredWorkItemIds: new Set(),
    });
    expect(plan.phases.map((p) => p.plane)).toEqual(['db']);
    // Single phase => its last item deploys (the final plane).
    expect(plan.descriptors[plan.descriptors.length - 1].deployOnComplete).toBe(true);
  });
});

describe('phased advance (pause vs final) + resume', () => {
  const book: BookOfWork = {
    id: 'book-1',
    current_architecture_id: 'arch-1',
    book_of_work_json: {
      items: [
        { id: 'bi-db', workItemId: 'wi-db', workstream: 'target_database_schema_implementation' },
        { id: 'bi-svc', workItemId: 'wi-svc', workstream: 'api_migration' },
      ],
    },
  };

  function pausedRun(): MigrationExecutionRun {
    return {
      id: 'run-1',
      project_id: PROJECT_ID,
      book_of_work_id: 'book-1',
      status: RUN_STATUS.DISPATCHING,
      items: [
        { id: 'ri-db', run_id: 'run-1', sequence_position: 0, work_item_id: 'wi-db', job_id: 'job-db', status: RUN_ITEM_STATUS.SUBMITTED, deploy_on_complete: true },
        { id: 'ri-svc', run_id: 'run-1', sequence_position: 1, work_item_id: 'wi-svc', spec_generation_id: 'sg-svc', status: RUN_ITEM_STATUS.PENDING, deploy_on_complete: true },
      ],
    };
  }

  it('deployed on a NON-final plane PAUSES the run + runs the DB-plane reconcile', async () => {
    const run = pausedRun();
    const deps = makeDeps({
      findMigrationRunItemByJobId: jest.fn().mockResolvedValue(run.items![0]),
      getMigrationExecutionRun: jest.fn().mockResolvedValue(run),
      fetchBookOfWork: jest.fn().mockResolvedValue(book),
    });

    const decision = await advanceRunOnBuildResult(
      { company: 'acme', project: 'order-mig', jobId: 'job-db', outcome: 'deployed', targetBaseUrl: 'https://target/db' },
      deps,
    );

    expect(decision).toBe('awaiting_approval');
    const paused = (deps.patchMigrationExecutionRun as jest.Mock).mock.calls.find(
      (c) => c[2].status === RUN_STATUS.AWAITING_APPROVAL,
    );
    expect(paused).toBeTruthy();
    // The DB plane LOADS the target (Spec Y) THEN reconciles it (Spec P) — the
    // chain is fire-and-forget, so flush the microtask queue before asserting.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(deps.triggerDataMigration as jest.Mock).toHaveBeenCalled();
    expect(deps.triggerDataParityReconcile as jest.Mock).toHaveBeenCalled();
    // The Service plane did NOT auto-dispatch.
    expect(deps.patchMigrationExecutionRun as jest.Mock).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ status: RUN_STATUS.DISPATCHING }),
    );
  });

  it('resumeMigration dispatches the next plane only from awaiting_approval', async () => {
    const run = pausedRun();
    run.status = RUN_STATUS.AWAITING_APPROVAL;
    run.items![0].status = RUN_ITEM_STATUS.DEPLOYED;
    const deps = makeDeps({
      getMigrationExecutionRun: jest.fn().mockResolvedValue(run),
      fetchBookOfWork: jest.fn().mockResolvedValue(book),
      fetchSpecGenerationsForBook: jest.fn().mockResolvedValue([specGen('wi-svc', 'sg-svc')]),
    });

    // Override the DB-plane data-parity gate (human sign-off) so the unit test
    // does not reach the real readiness read.
    const result = await resumeMigration(
      { projectId: PROJECT_ID, bookId: 'book-1', company: 'acme', project: 'order-mig' },
      'run-1',
      deps,
      { override: true },
    );

    expect(result.status).toBe('resumed');
    if (result.status === 'resumed') expect(result.nextPlane).toBe('service');
    const dispatching = (deps.patchMigrationExecutionRun as jest.Mock).mock.calls.find(
      (c) => c[2].status === RUN_STATUS.DISPATCHING,
    );
    expect(dispatching).toBeTruthy();
  });

  it('break-glass override RECORDS the frozen divergent tables on the run decision log (Residual 1)', async () => {
    const run = pausedRun();
    run.status = RUN_STATUS.AWAITING_APPROVAL;
    run.items![0].status = RUN_ITEM_STATUS.DEPLOYED;
    const deps = makeDeps({
      getMigrationExecutionRun: jest.fn().mockResolvedValue(run),
      fetchBookOfWork: jest.fn().mockResolvedValue(book),
      fetchSpecGenerationsForBook: jest.fn().mockResolvedValue([specGen('wi-svc', 'sg-svc')]),
      // Parity reads report DIVERGENT tables — the override proceeds anyway
      // but freezes what was overridden for downstream echo attribution.
      dataParityGateReads: {
        fetchLatestDataParityReport: jest.fn().mockResolvedValue({
          status: 'divergent',
          report_json: {
            tables: [
              { table: 'orders', schema: 'dbo', verdict: 'divergent' },
              { table: 'hir_book', schema: 'dbo', verdict: 'divergent' },
              { table: 'clean_one', schema: 'dbo', verdict: 'clean' },
            ],
          },
        }),
        fetchWaivers: jest.fn().mockResolvedValue([]),
      } as never,
    });

    const result = await resumeMigration(
      { projectId: PROJECT_ID, bookId: 'book-1', company: 'acme', project: 'order-mig' },
      'run-1',
      deps,
      { override: true },
    );
    expect(result.status).toBe('resumed');

    const overridePatch = (deps.patchMigrationExecutionRun as jest.Mock).mock.calls.find(
      (c) => Array.isArray(c[2]?.decision_log_json),
    );
    expect(overridePatch).toBeTruthy();
    const log = overridePatch![2].decision_log_json as Array<Record<string, unknown>>;
    const entry = log[log.length - 1];
    expect(entry).toMatchObject({ type: 'data_parity_override' });
    expect(entry.divergent_tables).toEqual(['dbo.orders', 'dbo.hir_book']);
  });

  it('resumeMigration on a non-paused run is a no-op', async () => {
    const run = pausedRun(); // status = dispatching
    const deps = makeDeps({ getMigrationExecutionRun: jest.fn().mockResolvedValue(run) });
    const result = await resumeMigration(
      { projectId: PROJECT_ID, bookId: 'book-1', company: 'acme', project: 'order-mig' },
      'run-1',
      deps,
    );
    expect(result.status).toBe('not_paused');
  });
});
