/**
 * Gold-standard campaign C3 (2026-08-07): driver silent-completion fixes.
 *
 * The driver previously had several paths that completed, skipped, or guessed
 * SILENTLY. Each block here pins the new LOUD behavior:
 *  - the DEFAULT boot-recovery discovery reads the AMS cross-project
 *    in-flight list (it used to return [] — structurally inert) and skips
 *    pre-changeset-219 rows missing scope names;
 *  - startMigration refuses a MIXED db+other batch (one deployed callback
 *    would mark db items deployed with their execution chain never run);
 *  - startMigration refuses UI-plane stories (no delivery path this pair);
 *  - plane precedence walks the book's run HISTORY (the newest run covering
 *    the preceding plane is authoritative — a stale deployed run superseded
 *    by a failed re-run does not satisfy precedence);
 *  - an unreadable carry-over accounting BLOCKS the start (was: the gate
 *    dimension silently vanished);
 *  - an unresolvable item plane HALTS instead of defaulting to 'service'
 *    (which used to skip the DB execution chain);
 *  - a deployed BATCH containing db-plane items halts (chain was bypassed);
 *  - run/item state PATCHes retry once before giving up.
 */

jest.mock('../services/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../services/migrationExecutionRunClient', () => {
  const actual = jest.requireActual('../services/migrationExecutionRunClient');
  return {
    ...actual,
    listInFlightMigrationExecutionRuns: jest.fn(),
  };
});

import {
  startMigration,
  advanceRunOnBuildResult,
  MigrationDriverDeps,
  MigrateScope,
} from '../services/migrationExecutionDriver';
import {
  MigrationExecutionRun,
  MigrationExecutionRunItem,
  RUN_STATUS,
  RUN_ITEM_STATUS,
  listInFlightMigrationExecutionRuns,
} from '../services/migrationExecutionRunClient';
import { defaultInFlightRunDiscovery } from '../services/migrationBootRecovery';
import type { BookOfWork } from '../services/migrationDriverAmsReads';

const PROJECT_ID = 'proj-1';
const BOOK_ID = 'book-1';
const scope: MigrateScope = {
  projectId: PROJECT_ID,
  bookId: BOOK_ID,
  company: 'acme',
  project: 'order-mig',
};

function mixedBook(): BookOfWork {
  return {
    id: BOOK_ID,
    project_id: PROJECT_ID,
    current_architecture_id: 'arch-1',
    status: 'draft',
    book_of_work_json: {
      items: [
        { id: 'b-db', parentId: null, type: 'story', title: 'Schema', sequenceOrder: 0, workItemId: 'wi-db', workstream: 'target_database_schema_implementation' },
        { id: 'b-svc', parentId: null, type: 'story', title: 'API', sequenceOrder: 1, workItemId: 'wi-svc', workstream: 'api_migration' },
      ],
    },
  } as BookOfWork;
}

function readySpec(workItemId: string, text: string, id: string) {
  return {
    id,
    work_item_id: workItemId,
    status: 'generated',
    generated_spec_text: text,
    stale_reason: null,
    generation_attempt_number: 1,
    created_at: '2026-06-14T00:00:00Z',
  };
}

function mockDeps(overrides: Partial<MigrationDriverDeps> = {}): MigrationDriverDeps {
  return {
    fetchBookOfWork: jest.fn().mockResolvedValue(mixedBook()),
    fetchSpecGenerationsForBook: jest.fn().mockResolvedValue([
      readySpec('wi-db', 'db spec body', 'sg-db'),
      readySpec('wi-svc', 'svc spec body', 'sg-svc'),
    ]),
    fetchWorkItems: jest.fn().mockResolvedValue([
      { id: 'wi-db', type: 'STORY', deferred: false },
      { id: 'wi-svc', type: 'STORY', deferred: false },
    ]),
    fetchActiveCurrentBaseline: jest
      .fn()
      .mockResolvedValue({ id: 'bl-1', kind: 'current', status: 'active' }),
    createMigrationExecutionRun: jest.fn().mockImplementation(
      async (_p: string, req: { run: MigrationExecutionRun; items: MigrationExecutionRunItem[] }) => ({
        ...req.run,
        id: 'run-1',
        items: req.items.map((it, idx) => ({ ...it, id: `ri-${idx}`, run_id: 'run-1' })),
      })
    ),
    getMigrationExecutionRun: jest.fn().mockResolvedValue(null),
    patchMigrationExecutionRun: jest.fn().mockResolvedValue({}),
    patchMigrationExecutionRunItem: jest.fn().mockResolvedValue({}),
    findMigrationRunItemByJobId: jest.fn().mockResolvedValue(null),
    submitOrchestration: jest.fn().mockResolvedValue({ ok: true, jobId: 'job-1', status: 'queued' }),
    recordWorkItemImplementationError: jest.fn().mockResolvedValue(undefined),
    autoAnswerer: { driveAndAnswer: jest.fn().mockResolvedValue({ ok: true, specName: 's', sessionId: 'x', decisionLog: [] }) },
    buildResultsCallbackUrl: 'http://gw/cb',
    carryOverCoverageReads: {
      fetchCapabilitiesForArchitecture: jest.fn().mockResolvedValue([]),
      fetchFindingsForRun: jest.fn().mockResolvedValue([]),
      fetchDiscoveryRunsForArchitecture: jest.fn().mockResolvedValue([]),
    },
    fetchMigrationExecutionRunsForBook: jest.fn().mockResolvedValue([]),
    fetchLatestMigrationExecutionRunForBook: jest.fn().mockResolvedValue(null),
    getTargetServeSpec: jest.fn().mockReturnValue({ command: 'run', healthPath: '/health' }),
    ...overrides,
  };
}

// ===========================================================================
// Default boot-recovery discovery (was hard-coded [])
// ===========================================================================

describe('defaultInFlightRunDiscovery', () => {
  beforeEach(() => jest.clearAllMocks());

  it('maps AMS in-flight runs to sweep refs', async () => {
    (listInFlightMigrationExecutionRuns as jest.Mock).mockResolvedValue([
      {
        id: 'run-9',
        project_id: 'p-9',
        company: 'acme',
        project: 'order-mig',
        book_of_work_id: 'book-9',
        status: 'dispatching',
      },
    ]);
    const refs = await defaultInFlightRunDiscovery();
    expect(refs).toEqual([
      { runId: 'run-9', projectId: 'p-9', company: 'acme', project: 'order-mig', bookId: 'book-9' },
    ]);
  });

  it('skips pre-changeset-219 rows missing scope names (with the resume-from-UI hint) instead of crashing the sweep', async () => {
    (listInFlightMigrationExecutionRuns as jest.Mock).mockResolvedValue([
      { id: 'run-legacy', project_id: 'p-1', company: null, project: null, book_of_work_id: 'b-1', status: 'started' },
      { id: 'run-ok', project_id: 'p-2', company: 'acme', project: 'proj', book_of_work_id: 'b-2', status: 'started' },
    ]);
    const refs = await defaultInFlightRunDiscovery();
    expect(refs.map((r) => r.runId)).toEqual(['run-ok']);
  });

  it('propagates an AMS read failure (the sweep wrapper owns the never-throw guard)', async () => {
    (listInFlightMigrationExecutionRuns as jest.Mock).mockRejectedValue(new Error('AMS down'));
    await expect(defaultInFlightRunDiscovery()).rejects.toThrow('AMS down');
  });
});

// ===========================================================================
// startMigration refusals
// ===========================================================================

describe('startMigration gold-standard refusals', () => {
  it('BLOCKS a batch mixing db-plane stories with other planes (mixed_plane_batch)', async () => {
    const deps = mockDeps();
    const result = await startMigration({ ...scope, batchName: 'stage-1' }, deps);
    expect(result.status).toBe('blocked');
    if (result.status === 'blocked') {
      expect(result.reasons.some((r) => r.code === 'mixed_plane_batch')).toBe(true);
    }
    expect(deps.createMigrationExecutionRun).not.toHaveBeenCalled();
  });

  it('an all-service batch is NOT refused by the mixed-plane gate', async () => {
    const deps = mockDeps({
      fetchBookOfWork: jest.fn().mockResolvedValue({
        ...mixedBook(),
        book_of_work_json: {
          items: [
            { id: 'b-svc', parentId: null, type: 'story', title: 'API', sequenceOrder: 0, workItemId: 'wi-svc', workstream: 'api_migration' },
          ],
        },
      }),
      fetchSpecGenerationsForBook: jest.fn().mockResolvedValue([
        readySpec('wi-svc', 'svc spec body', 'sg-svc'),
      ]),
      fetchWorkItems: jest.fn().mockResolvedValue([{ id: 'wi-svc', type: 'STORY', deferred: false }]),
    });
    const result = await startMigration({ ...scope, batchName: 'svc-batch' }, deps);
    expect(result.status).toBe('started');
  });

  it('BLOCKS UI-plane stories loudly (ui_plane_out_of_scope), naming the story', async () => {
    const deps = mockDeps({
      fetchBookOfWork: jest.fn().mockResolvedValue({
        ...mixedBook(),
        book_of_work_json: {
          items: [
            { id: 'b-ui', parentId: null, type: 'story', title: 'Screens', sequenceOrder: 0, workItemId: 'wi-ui', workstream: 'target_frontend_implementation' },
          ],
        },
      }),
      fetchSpecGenerationsForBook: jest.fn().mockResolvedValue([
        readySpec('wi-ui', 'ui spec body', 'sg-ui'),
      ]),
      fetchWorkItems: jest.fn().mockResolvedValue([{ id: 'wi-ui', type: 'STORY', deferred: false }]),
    });
    const result = await startMigration(scope, deps);
    expect(result.status).toBe('blocked');
    if (result.status === 'blocked') {
      expect(result.reasons.some((r) => r.code === 'ui_plane_out_of_scope')).toBe(true);
      expect(result.reasons[0].message).toContain('Defer');
    }
  });

  it('BLOCKS when the carry-over accounting is unreadable (carry_over_unavailable) — never migrates blind', async () => {
    const deps = mockDeps({
      carryOverCoverageReads: {
        fetchCapabilitiesForArchitecture: jest.fn().mockRejectedValue(new Error('AMS 502')),
        fetchFindingsForRun: jest.fn(),
        fetchDiscoveryRunsForArchitecture: jest.fn(),
      },
    });
    const result = await startMigration(scope, deps);
    expect(result.status).toBe('blocked');
    if (result.status === 'blocked') {
      expect(result.reasons.some((r) => r.code === 'carry_over_unavailable')).toBe(true);
    }
    expect(deps.createMigrationExecutionRun).not.toHaveBeenCalled();
  });

  it('plane precedence is HISTORY-aware: a stale deployed db run superseded by a newer FAILED re-run blocks the service plane', async () => {
    const deps = mockDeps({
      // Newest-first history: the failed re-run of the db plane supersedes
      // the older deployed one.
      fetchMigrationExecutionRunsForBook: jest.fn().mockResolvedValue([
        { id: 'run-db-2', status: 'halted', items: [{ work_item_id: 'wi-db' }] },
        { id: 'run-db-1', status: 'deployed', items: [{ work_item_id: 'wi-db' }] },
      ]),
    });
    const result = await startMigration({ ...scope, plane: 'service' }, deps);
    expect(result.status).toBe('blocked');
    if (result.status === 'blocked') {
      expect(result.reasons.some((r) => r.code === 'preceding_plane_not_deployed')).toBe(true);
    }
  });

  it('plane precedence FAIL-CLOSED: an unreadable run history blocks (precedence_unverifiable)', async () => {
    const deps = mockDeps({
      fetchMigrationExecutionRunsForBook: jest.fn().mockRejectedValue(new Error('AMS down')),
    });
    const result = await startMigration({ ...scope, plane: 'service' }, deps);
    expect(result.status).toBe('blocked');
    if (result.status === 'blocked') {
      expect(result.reasons.some((r) => r.code === 'precedence_unverifiable')).toBe(true);
    }
  });

  it('the created run carries the workspace scope NAMES (changeset 219)', async () => {
    const deps = mockDeps({
      fetchBookOfWork: jest.fn().mockResolvedValue({
        ...mixedBook(),
        book_of_work_json: {
          items: [
            { id: 'b-svc', parentId: null, type: 'story', title: 'API', sequenceOrder: 0, workItemId: 'wi-svc', workstream: 'api_migration' },
          ],
        },
      }),
      fetchSpecGenerationsForBook: jest.fn().mockResolvedValue([
        readySpec('wi-svc', 'svc spec body', 'sg-svc'),
      ]),
      fetchWorkItems: jest.fn().mockResolvedValue([{ id: 'wi-svc', type: 'STORY', deferred: false }]),
    });
    const result = await startMigration(scope, deps);
    expect(result.status).toBe('started');
    const createArg = (deps.createMigrationExecutionRun as jest.Mock).mock.calls[0][1];
    expect(createArg.run.company).toBe('acme');
    expect(createArg.run.project).toBe('order-mig');
  });
});

// ===========================================================================
// Fail-closed plane resolution on advance
// ===========================================================================

describe('advance fail-closed plane resolution', () => {
  function advanceDeps(run: MigrationExecutionRun, item: MigrationExecutionRunItem, book: unknown) {
    return mockDeps({
      fetchBookOfWork: jest.fn().mockResolvedValue(book),
      getMigrationExecutionRun: jest.fn().mockResolvedValue(run),
      findMigrationRunItemByJobId: jest.fn().mockResolvedValue(item),
    });
  }

  it("an implemented FINAL item whose plane cannot be resolved HALTS — never guesses 'service' and skips the DB chain", async () => {
    const item: MigrationExecutionRunItem = {
      id: 'ri-0', run_id: 'run-1', sequence_position: 0, work_item_id: 'wi-unknown',
      status: RUN_ITEM_STATUS.SUBMITTED, job_id: 'job-1', outcome: null, deploy_on_complete: true,
    };
    const run: MigrationExecutionRun = {
      id: 'run-1', project_id: PROJECT_ID, book_of_work_id: BOOK_ID,
      status: RUN_STATUS.DISPATCHING, items: [item],
    };
    // The book does NOT contain wi-unknown.
    const deps = advanceDeps(run, item, mixedBook());
    const decision = await advanceRunOnBuildResult(
      { company: 'acme', project: 'order-mig', jobId: 'job-1', outcome: 'implemented', prUrl: null, targetBaseUrl: null, summary: null, failureClass: null, failedStep: null, errors: null },
      deps
    );
    expect(decision).toBe('halted');
    const runPatches = (deps.patchMigrationExecutionRun as jest.Mock).mock.calls;
    expect(runPatches.some((c) => c[2]?.status === RUN_STATUS.HALTED)).toBe(true);
    const itemPatches = (deps.patchMigrationExecutionRunItem as jest.Mock).mock.calls;
    const failed = itemPatches.find((c) => c[2]?.status === RUN_ITEM_STATUS.FAILED);
    expect(failed?.[2]?.error_detail).toContain('plane could not be resolved');
  });

  it('a deployed BATCH containing db-plane items HALTS — the DB chain was bypassed', async () => {
    const items: MigrationExecutionRunItem[] = [
      { id: 'ri-0', run_id: 'run-1', sequence_position: 0, work_item_id: 'wi-db', status: RUN_ITEM_STATUS.SUBMITTED, job_id: 'job-b', outcome: null },
      { id: 'ri-1', run_id: 'run-1', sequence_position: 1, work_item_id: 'wi-svc', status: RUN_ITEM_STATUS.SUBMITTED, job_id: 'job-b', outcome: null, deploy_on_complete: true },
    ];
    const run: MigrationExecutionRun = {
      id: 'run-1', project_id: PROJECT_ID, book_of_work_id: BOOK_ID,
      status: RUN_STATUS.DISPATCHING, items,
    };
    const deps = mockDeps({
      fetchBookOfWork: jest.fn().mockResolvedValue(mixedBook()),
      getMigrationExecutionRun: jest.fn().mockResolvedValue(run),
      findMigrationRunItemByJobId: jest.fn().mockResolvedValue(items[0]),
    });
    const decision = await advanceRunOnBuildResult(
      { company: 'acme', project: 'order-mig', jobId: 'job-b', outcome: 'deployed', prUrl: null, targetBaseUrl: 'http://t/x', summary: null, failureClass: null, failedStep: null, errors: null },
      deps
    );
    expect(decision).toBe('halted');
    const itemPatches = (deps.patchMigrationExecutionRunItem as jest.Mock).mock.calls;
    const failed = itemPatches.filter((c) => c[2]?.status === RUN_ITEM_STATUS.FAILED);
    expect(failed.length).toBe(2);
    expect(failed[0][2].error_detail).toContain('chain');
  });
});

// ===========================================================================
// PATCH retry-once
// ===========================================================================

describe('state-PATCH retry-once', () => {
  it('retries a failed run-item PATCH once and succeeds silently', async () => {
    const patchItem = jest
      .fn()
      .mockRejectedValueOnce(new Error('AMS blip'))
      .mockResolvedValue({});
    const item: MigrationExecutionRunItem = {
      id: 'ri-0', run_id: 'run-1', sequence_position: 0, work_item_id: 'wi-svc',
      status: RUN_ITEM_STATUS.SUBMITTED, job_id: 'job-1', outcome: null, deploy_on_complete: false,
    };
    const run: MigrationExecutionRun = {
      id: 'run-1', project_id: PROJECT_ID, book_of_work_id: BOOK_ID,
      status: RUN_STATUS.DISPATCHING,
      items: [item, { id: 'ri-1', sequence_position: 1, work_item_id: 'wi-db', status: RUN_ITEM_STATUS.PENDING }],
    };
    const deps = mockDeps({
      patchMigrationExecutionRunItem: patchItem,
      getMigrationExecutionRun: jest.fn().mockResolvedValue(run),
      findMigrationRunItemByJobId: jest.fn().mockResolvedValue(item),
    });
    await advanceRunOnBuildResult(
      { company: 'acme', project: 'order-mig', jobId: 'job-1', outcome: 'implemented', prUrl: null, targetBaseUrl: null, summary: null, failureClass: null, failedStep: null, errors: null },
      deps
    );
    // First call failed, second (retry) succeeded — same args.
    expect(patchItem.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(patchItem.mock.calls[0]).toEqual(patchItem.mock.calls[1]);
  });
});
