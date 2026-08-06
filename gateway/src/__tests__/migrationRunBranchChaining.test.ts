/**
 * Run-branch chaining tests (2026-08-06).
 *
 * Sequential runs previously branched EVERY spec's worktree from pristine
 * default — spec N could not see specs 1..N-1. The driver now threads
 * `base_spec` (the last GOOD spec's name) on each submit so IVS bases the
 * worktree branch off the previous successful spec's commit, and suppresses
 * per-spec MRs so the STAGE-FINAL branch (carrying the whole chain's diff)
 * opens the ONE MR.
 *
 * Covers:
 *  - the pure helpers (lastGoodSpecOfRun / chainBaseSpecForItem): prior-good
 *    beats the run-level base_spec, retries never chain a failed attempt;
 *  - dispatch-next threads baseSpec + openMergeRequest=false on non-final
 *    items and openMergeRequest=true on the service-plane final item;
 *  - a `-r<n>` RETRY re-dispatch bases off the last GOOD spec (specs 1..N-1
 *    present in the retry's worktree — the failed attempt's wreckage never);
 *  - the run's FIRST dispatch uses the run-level base_spec (cross-run stage
 *    chaining) resolved at startMigration (baseMode 'chain' default) and
 *    skipped for baseMode 'fresh';
 *  - db-plane items always suppress the MR (assembly opens the pack's one MR).
 *
 * Mirrors the migrationExecutionDriver test conventions: fully-mocked deps,
 * no AMS round-trip, no live LLM.
 */

// Mock the logger to silence output.
jest.mock('../services/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import {
  advanceRunOnBuildResult,
  chainBaseSpecForItem,
  lastGoodSpecOfRun,
  startMigration,
  MigrationDriverDeps,
  MigrateScope,
} from '../services/migrationExecutionDriver';
import {
  RUN_STATUS,
  RUN_ITEM_STATUS,
  MigrationExecutionRun,
  MigrationExecutionRunItem,
} from '../services/migrationExecutionRunClient';
import { BookOfWork, SpecGeneration } from '../services/migrationDriverAmsReads';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PROJECT_ID = 'proj-1';
const BOOK_ID = 'book-1';

const scope: MigrateScope = {
  projectId: PROJECT_ID,
  bookId: BOOK_ID,
  company: 'acme',
  project: 'order-mig',
};

function readySpec(workItemId: string, text: string, id: string): SpecGeneration {
  return {
    id,
    work_item_id: workItemId,
    status: 'generated',
    generated_spec_text: text,
    stale_reason: null,
    generation_attempt_number: 1,
    created_at: '2026-08-06T00:00:00Z',
  };
}

function book(): BookOfWork {
  return {
    id: BOOK_ID,
    project_id: PROJECT_ID,
    current_architecture_id: 'arch-1',
    status: 'draft',
    book_of_work_json: {
      items: [
        { id: 'f1', parentId: null, type: 'feature', title: 'Feature 1', sequenceOrder: 0 },
        { id: 's1', parentId: 'f1', type: 'story', title: 'Story One', sequenceOrder: 0, workItemId: 'wi-1' },
        { id: 's2', parentId: 'f1', type: 'story', title: 'Story Two', sequenceOrder: 1, workItemId: 'wi-2' },
        { id: 's3', parentId: 'f1', type: 'story', title: 'Story Three', sequenceOrder: 2, workItemId: 'wi-3' },
      ],
    },
  };
}

function specs(): SpecGeneration[] {
  return [
    readySpec('wi-1', '/agent-os:shape-spec Story one body', 'sg-1'),
    readySpec('wi-2', '/agent-os:shape-spec Story two body', 'sg-2'),
    readySpec('wi-3', '/agent-os:shape-spec Story three body', 'sg-3'),
  ];
}

/**
 * A three-item sequential run: item 0 IMPLEMENTED under its stamped spec
 * name, item 1 submitted (job-2) awaiting its callback, item 2 pending final.
 */
function chainedRun(): MigrationExecutionRun {
  return {
    id: 'run-1',
    project_id: PROJECT_ID,
    book_of_work_id: BOOK_ID,
    status: RUN_STATUS.DISPATCHING,
    base_spec: null,
    items: [
      { id: 'ri-0', run_id: 'run-1', sequence_position: 0, work_item_id: 'wi-1', spec_generation_id: 'sg-1', spec_name: '2026-08-06-story-one-aaaa1111', status: RUN_ITEM_STATUS.IMPLEMENTED, job_id: 'job-1', outcome: 'implemented', deploy_on_complete: false, retry_attempt_count: 0 },
      { id: 'ri-1', run_id: 'run-1', sequence_position: 1, work_item_id: 'wi-2', spec_generation_id: 'sg-2', spec_name: '2026-08-06-story-two-bbbb2222', status: RUN_ITEM_STATUS.SUBMITTED, job_id: 'job-2', outcome: null, deploy_on_complete: false, retry_attempt_count: 0 },
      { id: 'ri-2', run_id: 'run-1', sequence_position: 2, work_item_id: 'wi-3', spec_generation_id: 'sg-3', status: RUN_ITEM_STATUS.PENDING, deploy_on_complete: true, retry_attempt_count: 0 },
    ],
  };
}

interface CapturedTimer {
  delayMs: number;
  fn: () => void;
}

/** Stateful mock deps over ONE run object (patches mutate; re-reads see them). */
function statefulDeps(
  run: MigrationExecutionRun,
  timers: CapturedTimer[],
  overrides: Partial<MigrationDriverDeps> = {}
): MigrationDriverDeps {
  return {
    fetchBookOfWork: jest.fn().mockResolvedValue(book()),
    fetchSpecGenerationsForBook: jest.fn().mockResolvedValue(specs()),
    fetchWorkItems: jest.fn().mockResolvedValue([
      { id: 'wi-1', type: 'STORY', deferred: false },
      { id: 'wi-2', type: 'STORY', deferred: false },
      { id: 'wi-3', type: 'STORY', deferred: false },
    ]),
    fetchActiveCurrentBaseline: jest.fn().mockResolvedValue({ id: 'b1', kind: 'current', status: 'active' }),
    createMigrationExecutionRun: jest.fn(),
    getMigrationExecutionRun: jest.fn().mockImplementation(async () => run),
    patchMigrationExecutionRun: jest.fn().mockImplementation(async (_p: string, _r: string, patch: MigrationExecutionRun) => {
      Object.assign(run, { ...patch, items: run.items });
      return run;
    }),
    patchMigrationExecutionRunItem: jest.fn().mockImplementation(async (_p: string, id: string, patch: MigrationExecutionRunItem) => {
      const item = (run.items ?? []).find((i) => i.id === id);
      if (item) {
        for (const [k, v] of Object.entries(patch)) {
          (item as Record<string, unknown>)[k] = v === '' ? null : v;
        }
      }
      return item ?? {};
    }),
    findMigrationRunItemByJobId: jest.fn().mockImplementation(async (_p: string, jobId: string) =>
      (run.items ?? []).find((i) => i.job_id === jobId) ?? null
    ),
    submitOrchestration: jest.fn().mockResolvedValue({ ok: true, jobId: 'job-new', status: 'queued' }),
    recordWorkItemImplementationError: jest.fn().mockResolvedValue(undefined),
    autoAnswerer: { driveAndAnswer: jest.fn() },
    buildResultsCallbackUrl: 'http://gw/api/implementation/build-results',
    scheduleRetryTimer: (delayMs: number, fn: () => void) => {
      timers.push({ delayMs, fn });
    },
    ...overrides,
  };
}

async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

// ===========================================================================
// Pure helpers
// ===========================================================================

describe('lastGoodSpecOfRun / chainBaseSpecForItem', () => {
  it('returns the HIGHEST-position successful spec (implemented or deployed)', () => {
    const run = chainedRun();
    expect(lastGoodSpecOfRun(run)).toBe('2026-08-06-story-one-aaaa1111');
    run.items![1].outcome = 'implemented';
    expect(lastGoodSpecOfRun(run)).toBe('2026-08-06-story-two-bbbb2222');
  });

  it('ignores failed/pending items and runs with no successes', () => {
    const run = chainedRun();
    run.items![0].outcome = 'failed';
    expect(lastGoodSpecOfRun(run)).toBeNull();
    expect(lastGoodSpecOfRun(null)).toBeNull();
  });

  it('an item chains off the last GOOD item BEFORE it — never itself, never a failed attempt', () => {
    const run = chainedRun();
    // Item 1 (position 1): chains off item 0's spec.
    expect(chainBaseSpecForItem(run, run.items![1])).toBe('2026-08-06-story-one-aaaa1111');
    // Item 1 FAILED once (it carries a spec_name from the failed attempt) —
    // a retry of item 1 still bases off item 0, never its own wreckage.
    run.items![1].outcome = null;
    expect(chainBaseSpecForItem(run, run.items![1])).toBe('2026-08-06-story-one-aaaa1111');
    // Item 2 after item 1 succeeds: chains off item 1.
    run.items![1].outcome = 'implemented';
    expect(chainBaseSpecForItem(run, run.items![2])).toBe('2026-08-06-story-two-bbbb2222');
  });

  it('falls back to the run-level base_spec (cross-run stage chaining) when no prior item succeeded', () => {
    const run = chainedRun();
    run.items![0].outcome = null;
    run.items![0].status = RUN_ITEM_STATUS.PENDING;
    run.base_spec = '2026-08-01-stage1-final-spec';
    expect(chainBaseSpecForItem(run, run.items![0])).toBe('2026-08-01-stage1-final-spec');
    run.base_spec = null;
    expect(chainBaseSpecForItem(run, run.items![0])).toBeNull();
  });
});

// ===========================================================================
// Dispatch threading (advance -> dispatch-next -> submit)
// ===========================================================================

describe('dispatch threads base_spec + open_merge_request', () => {
  it('implemented -> the NEXT dispatch chains off the just-implemented spec, MR suppressed (non-final)', async () => {
    const run = chainedRun();
    const deps = statefulDeps(run, []);

    const decision = await advanceRunOnBuildResult(
      { company: 'acme', project: 'order-mig', jobId: 'job-2', outcome: 'implemented' },
      deps
    );
    await flush();

    expect(decision).toBe('advanced_next_dispatched');
    const submit = (deps.submitOrchestration as jest.Mock).mock.calls[0][0];
    // Item 2 chains off item 1's branch (the freshly-implemented spec).
    expect(submit.baseSpec).toBe('2026-08-06-story-two-bbbb2222');
    // Item 2 IS the final item of a service-plane chain -> it opens the ONE MR.
    expect(submit.openMergeRequest).toBe(true);
  });

  it('a NON-final dispatch suppresses the MR', async () => {
    const run = chainedRun();
    // Rewind: item 0 still IN-FLIGHT under job-1 (its callback arrives now),
    // item 1 not yet dispatched.
    run.items![0].status = RUN_ITEM_STATUS.SUBMITTED;
    run.items![0].outcome = null;
    run.items![1].status = RUN_ITEM_STATUS.PENDING;
    run.items![1].job_id = null;
    run.items![1].spec_name = null;
    const deps = statefulDeps(run, []);

    await advanceRunOnBuildResult(
      { company: 'acme', project: 'order-mig', jobId: 'job-1', outcome: 'implemented' },
      deps
    );
    await flush();

    const submit = (deps.submitOrchestration as jest.Mock).mock.calls[0][0];
    expect(submit.baseSpec).toBe('2026-08-06-story-one-aaaa1111');
    expect(submit.openMergeRequest).toBe(false); // non-final: push, no MR
  });

  it('a -r<n> RETRY bases off the last GOOD spec — never the failed attempt', async () => {
    const run = chainedRun();
    const timers: CapturedTimer[] = [];
    const deps = statefulDeps(run, timers);

    const decision = await advanceRunOnBuildResult(
      {
        company: 'acme', project: 'order-mig', jobId: 'job-2', outcome: 'error',
        summary: 'backend blip', failureClass: 'transient_upstream',
      },
      deps
    );
    expect(decision).toBe('retry_scheduled');
    expect(timers).toHaveLength(1);

    timers[0].fn(); // fire the scheduled retry
    await flush();

    const submit = (deps.submitOrchestration as jest.Mock).mock.calls[0][0];
    expect(submit.specName).toMatch(/-r2$/);
    // The retry's worktree contains specs 1..N-1: based off item 0's branch,
    // NOT the failed attempt's own branch.
    expect(submit.baseSpec).toBe('2026-08-06-story-one-aaaa1111');
    expect(submit.openMergeRequest).toBe(false);
  });

  it('with NO successful prior item every dispatch falls through to the run-level base_spec', () => {
    const run = chainedRun();
    run.base_spec = '2026-08-01-stage1-final-spec';
    run.items![0].outcome = null;
    run.items![0].status = RUN_ITEM_STATUS.SUBMITTED;
    run.items![1].outcome = null;
    run.items![1].status = RUN_ITEM_STATUS.PENDING;
    expect(chainBaseSpecForItem(run, run.items![0])).toBe('2026-08-01-stage1-final-spec');
    expect(chainBaseSpecForItem(run, run.items![1])).toBe('2026-08-01-stage1-final-spec');
  });
});

// ===========================================================================
// startMigration baseMode resolution
// ===========================================================================

describe('startMigration baseMode', () => {
  function startDeps(
    priorRun: MigrationExecutionRun | null,
    created: { run?: MigrationExecutionRun }
  ): MigrationDriverDeps {
    const run: MigrationExecutionRun = { id: 'run-x', items: [] };
    return statefulDeps(run, [], {
      fetchLatestMigrationExecutionRunForBook: jest.fn().mockResolvedValue(priorRun),
      createMigrationExecutionRun: jest.fn().mockImplementation(
        async (_p: string, req: { run: MigrationExecutionRun; items: MigrationExecutionRunItem[] }) => {
          const r: MigrationExecutionRun = {
            ...req.run,
            id: 'run-2',
            items: req.items.map((it, idx) => ({ ...it, id: `ri-${idx}`, run_id: 'run-2' })),
          };
          created.run = r;
          return r;
        }
      ),
      getMigrationExecutionRun: jest.fn().mockImplementation(async () => created.run ?? null),
    });
  }

  /** A prior DEPLOYED stage-1 run whose last good spec is the chain base. */
  function priorStageRun(): MigrationExecutionRun {
    return {
      id: 'run-old',
      project_id: PROJECT_ID,
      book_of_work_id: BOOK_ID,
      status: RUN_STATUS.DEPLOYED,
      items: [
        { id: 'old-0', sequence_position: 0, spec_name: '2026-08-01-stage1-schema-cccc3333', status: RUN_ITEM_STATUS.IMPLEMENTED, outcome: 'implemented' },
        { id: 'old-1', sequence_position: 1, spec_name: '2026-08-01-stage1-final-dddd4444', status: RUN_ITEM_STATUS.DEPLOYED, outcome: 'deployed' },
      ],
    };
  }

  it("default 'chain': the new run persists the prior run's last good spec as base_spec", async () => {
    const created: { run?: MigrationExecutionRun } = {};
    const deps = startDeps(priorStageRun(), created);

    const result = await startMigration(scope, deps);
    await flush();

    expect(result.status).toBe('started');
    const req = (deps.createMigrationExecutionRun as jest.Mock).mock.calls[0][1];
    expect(req.run.base_spec).toBe('2026-08-01-stage1-final-dddd4444');
    // The first dispatch chains off it.
    const submit = (deps.submitOrchestration as jest.Mock).mock.calls[0][0];
    expect(submit.baseSpec).toBe('2026-08-01-stage1-final-dddd4444');
  });

  it("'fresh': no prior-run read, base_spec null, first dispatch has NO baseSpec (default-branch base)", async () => {
    const created: { run?: MigrationExecutionRun } = {};
    const deps = startDeps(priorStageRun(), created);

    const result = await startMigration({ ...scope, baseMode: 'fresh' }, deps);
    await flush();

    expect(result.status).toBe('started');
    expect(deps.fetchLatestMigrationExecutionRunForBook).not.toHaveBeenCalled();
    const req = (deps.createMigrationExecutionRun as jest.Mock).mock.calls[0][1];
    expect(req.run.base_spec).toBeNull();
    const submit = (deps.submitOrchestration as jest.Mock).mock.calls[0][0];
    expect(submit.baseSpec).toBeUndefined();
    expect(submit.openMergeRequest).toBe(false); // first of three: non-final
  });

  it("'chain' with NO prior run degrades to a default-branch base (null), not an error", async () => {
    const created: { run?: MigrationExecutionRun } = {};
    const deps = startDeps(null, created);

    const result = await startMigration(scope, deps);
    await flush();

    expect(result.status).toBe('started');
    const req = (deps.createMigrationExecutionRun as jest.Mock).mock.calls[0][1];
    expect(req.run.base_spec).toBeNull();
  });

  it("a prior-run read FAILURE degrades to a default-branch base, never a blocked start", async () => {
    const created: { run?: MigrationExecutionRun } = {};
    const deps = startDeps(null, created);
    (deps.fetchLatestMigrationExecutionRunForBook as jest.Mock).mockRejectedValue(new Error('AMS down'));

    const result = await startMigration(scope, deps);
    await flush();

    expect(result.status).toBe('started');
    const req = (deps.createMigrationExecutionRun as jest.Mock).mock.calls[0][1];
    expect(req.run.base_spec).toBeNull();
  });
});

// ===========================================================================
// DB-plane MR suppression
// ===========================================================================

describe('db-plane items always suppress the per-spec MR', () => {
  it('the db-plane FINAL item submits openMergeRequest=false (assembly opens the pack MR)', async () => {
    const dbBook: BookOfWork = {
      id: BOOK_ID,
      project_id: PROJECT_ID,
      current_architecture_id: 'arch-1',
      status: 'draft',
      book_of_work_json: {
        items: [
          { id: 'f1', parentId: null, type: 'feature', title: 'DB work', sequenceOrder: 0 },
          { id: 's1', parentId: 'f1', type: 'story', title: 'Schema One', sequenceOrder: 0, workItemId: 'wi-1', workstream: 'target_database_schema_implementation' },
          { id: 's2', parentId: 'f1', type: 'story', title: 'Schema Two', sequenceOrder: 1, workItemId: 'wi-2', workstream: 'target_database_schema_implementation' },
        ],
      },
    };
    const run: MigrationExecutionRun = {
      id: 'run-db',
      project_id: PROJECT_ID,
      book_of_work_id: BOOK_ID,
      status: RUN_STATUS.DISPATCHING,
      items: [
        { id: 'db-0', run_id: 'run-db', sequence_position: 0, work_item_id: 'wi-1', spec_generation_id: 'sg-1', spec_name: '2026-08-06-schema-one-aaaa1111', status: RUN_ITEM_STATUS.SUBMITTED, job_id: 'job-1', outcome: null, deploy_on_complete: false, retry_attempt_count: 0 },
        { id: 'db-1', run_id: 'run-db', sequence_position: 1, work_item_id: 'wi-2', spec_generation_id: 'sg-2', status: RUN_ITEM_STATUS.PENDING, deploy_on_complete: true, retry_attempt_count: 0 },
      ],
    };
    const deps = statefulDeps(run, [], {
      fetchBookOfWork: jest.fn().mockResolvedValue(dbBook),
      fetchSpecGenerationsForBook: jest.fn().mockResolvedValue([
        readySpec('wi-1', '/agent-os:shape-spec Schema one', 'sg-1'),
        readySpec('wi-2', '/agent-os:shape-spec Schema two', 'sg-2'),
      ]),
    });

    await advanceRunOnBuildResult(
      { company: 'acme', project: 'order-mig', jobId: 'job-1', outcome: 'implemented' },
      deps
    );
    await flush();

    const submit = (deps.submitOrchestration as jest.Mock).mock.calls[0][0];
    expect(submit.baseSpec).toBe('2026-08-06-schema-one-aaaa1111'); // chaining still on
    expect(submit.openMergeRequest).toBe(false);                    // db: assembly owns the MR
    expect(submit.deployOnComplete).toBe(false);                    // WS2 decoupling unchanged
  });
});
