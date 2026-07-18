/**
 * Tests for the Migration Execution Driver core (Spec 2026-06-14, Task Group 2).
 *
 * Covers the critical behaviours with a fully-mocked dependency surface (no AMS
 * round-trip, no live LLM -- the auto-answerer is a mock):
 *  - the hard-block gate REFUSES a non-deferred un-ready story and a missing
 *    `kind='current'` baseline, and PERMITS when all in-scope stories are ready;
 *  - the ordered dispatch set is built in (depth, sequenceOrder) order,
 *    EXCLUDING deferred items and INCLUDING TEST items, with
 *    `deployOnComplete=TRUE` only on the FINAL item;
 *  - the Migrate trigger creates the run + dispatches only the FIRST spec and
 *    returns immediately;
 *  - the per-spec dispatch posts the spec text + callback_url +
 *    deploy_on_complete (final only) and records the job_id;
 *  - a build-results `implemented` callback advances + dispatches the next spec;
 *  - `failed`/`rejected` halts + records (per-item isolation);
 *  - `deployed` marks the run deployed + records target_base_url;
 *  - a duplicate callback for an already-terminal run-item is an idempotent no-op;
 *  - the boot-recovery sweep re-kicks a run-item stuck mid-segment.
 *
 * The LLM guard is respected: the only LLM boundary (the shape-spec
 * auto-answerer) is injected as a mock; no live LLM is reachable.
 */

// Mock the logger to silence output.
jest.mock('../services/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import {
  evaluateHardBlock,
  buildOrderedDispatchSet,
  walkBookOfWorkItems,
  startMigration,
  advanceRunOnBuildResult,
  recoverInFlightRuns,
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
import { ShapeSpecAutoAnswerer } from '../services/shapeSpecAutoAnswererSeam';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PROJECT_ID = 'proj-1';
const BOOK_ID = 'book-1';
const BASELINE_ID = 'baseline-current-1';

/** A spec-ready spec-generation row for a work item. */
function readySpec(workItemId: string, text: string, id: string): SpecGeneration {
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

/** A two-story book: a feature parent (no spec) + two leaf stories + a TEST. */
function twoStoryBook(): BookOfWork {
  return {
    id: BOOK_ID,
    project_id: PROJECT_ID,
    current_architecture_id: 'arch-1',
    status: 'draft',
    book_of_work_json: {
      items: [
        { id: 'f1', parentId: null, type: 'feature', title: 'Feature 1', sequenceOrder: 0 },
        { id: 's1', parentId: 'f1', type: 'story', title: 'Story 1', sequenceOrder: 0, workItemId: 'wi-1' },
        { id: 's2', parentId: 'f1', type: 'story', title: 'Story 2', sequenceOrder: 1, workItemId: 'wi-2' },
        { id: 't1', parentId: 'f1', type: 'test', title: 'TEST sibling', sequenceOrder: 2, workItemId: 'wi-test' },
      ],
    },
  };
}

function twoStorySpecs(): SpecGeneration[] {
  return [
    readySpec('wi-1', '/agent-os:shape-spec Story 1 body', 'sg-1'),
    readySpec('wi-2', '/agent-os:shape-spec Story 2 body', 'sg-2'),
    readySpec('wi-test', '/agent-os:shape-spec TEST body', 'sg-test'),
  ];
}

/** A passing auto-answerer that yields a folder + session + one decision. */
function passingAutoAnswerer(): ShapeSpecAutoAnswerer {
  return {
    driveAndAnswer: jest.fn().mockResolvedValue({
      ok: true,
      specName: '2026-06-14-some-spec-folder',
      sessionId: 'sess-1',
      decisionLog: [{ question: 'Q?', answer: 'A.', rationale: 'because.' }],
    }),
  };
}

/**
 * A mock deps surface. Each AMS call is a jest.fn; create-run echoes the items
 * back with ids + a run id so the runner can proceed.
 */
function mockDeps(overrides: Partial<MigrationDriverDeps> = {}): MigrationDriverDeps {
  const created: { run?: MigrationExecutionRun } = {};
  return {
    fetchBookOfWork: jest.fn().mockResolvedValue(twoStoryBook()),
    fetchSpecGenerationsForBook: jest.fn().mockResolvedValue(twoStorySpecs()),
    fetchWorkItems: jest.fn().mockResolvedValue([
      { id: 'wi-1', type: 'STORY', deferred: false },
      { id: 'wi-2', type: 'STORY', deferred: false },
      { id: 'wi-test', type: 'TEST', deferred: false },
    ]),
    fetchActiveCurrentBaseline: jest.fn().mockResolvedValue({ id: BASELINE_ID, kind: 'current', status: 'active' }),
    createMigrationExecutionRun: jest.fn().mockImplementation(
      async (_projectId: string, req: { run: MigrationExecutionRun; items: MigrationExecutionRunItem[] }) => {
        const run: MigrationExecutionRun = {
          ...req.run,
          id: 'run-1',
          items: req.items.map((it, idx) => ({ ...it, id: `ri-${idx}`, run_id: 'run-1' })),
        };
        created.run = run;
        return run;
      }
    ),
    getMigrationExecutionRun: jest.fn().mockImplementation(async () => created.run ?? null),
    patchMigrationExecutionRun: jest.fn().mockResolvedValue({}),
    patchMigrationExecutionRunItem: jest.fn().mockResolvedValue({}),
    findMigrationRunItemByJobId: jest.fn().mockResolvedValue(null),
    submitOrchestration: jest.fn().mockResolvedValue({ ok: true, jobId: 'job-1', status: 'queued' }),
    recordWorkItemImplementationError: jest.fn().mockResolvedValue(undefined),
    autoAnswerer: passingAutoAnswerer(),
    buildResultsCallbackUrl: 'http://gw/api/implementation/build-results',
    ...overrides,
  };
}

/** Let the detached per-spec runner's microtasks settle. */
async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

const scope: MigrateScope = { projectId: PROJECT_ID, bookId: BOOK_ID, company: 'acme', project: 'order-mig' };

// ===========================================================================
// Pure: hard-block gate
// ===========================================================================

describe('evaluateHardBlock', () => {
  it('PERMITS when every in-scope story is spec-ready and a current baseline exists', () => {
    const book = twoStoryBook();
    const result = evaluateHardBlock({
      items: book.book_of_work_json!.items!,
      specGens: twoStorySpecs(),
      deferredWorkItemIds: new Set(),
      hasActiveCurrentBaseline: true,
    });
    expect(result.ok).toBe(true);
    expect(result.reasons).toHaveLength(0);
  });

  it('REFUSES with a per-story reason when a non-deferred story is not spec-ready', () => {
    const book = twoStoryBook();
    // wi-2 has no spec row -> not ready.
    const specs = [readySpec('wi-1', 'x', 'sg-1'), readySpec('wi-test', 'x', 'sg-test')];
    const result = evaluateHardBlock({
      items: book.book_of_work_json!.items!,
      specGens: specs,
      deferredWorkItemIds: new Set(),
      hasActiveCurrentBaseline: true,
    });
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.code === 'story_not_spec_ready' && r.workItemId === 'wi-2')).toBe(true);
  });

  it('REFUSES with the missing-baseline reason when no active current baseline exists', () => {
    const book = twoStoryBook();
    const result = evaluateHardBlock({
      items: book.book_of_work_json!.items!,
      specGens: twoStorySpecs(),
      deferredWorkItemIds: new Set(),
      hasActiveCurrentBaseline: false,
    });
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.code === 'missing_current_baseline')).toBe(true);
  });

  it('does NOT block on a story that is deferred (deferred drops out of the in-scope set)', () => {
    const book = twoStoryBook();
    // wi-2 unready, but deferred -> not a blocking reason.
    const specs = [readySpec('wi-1', 'x', 'sg-1'), readySpec('wi-test', 'x', 'sg-test')];
    const result = evaluateHardBlock({
      items: book.book_of_work_json!.items!,
      specGens: specs,
      deferredWorkItemIds: new Set(['wi-2']),
      hasActiveCurrentBaseline: true,
    });
    expect(result.ok).toBe(true);
  });
});

// ===========================================================================
// Pure: ordered dispatch set (depth, sequenceOrder), exclude deferred, include TEST
// ===========================================================================

describe('buildOrderedDispatchSet', () => {
  it('orders by (depth, sequenceOrder), excludes deferred, includes TEST, and sets deploy_on_complete only on the final item', () => {
    const set = buildOrderedDispatchSet({
      book: twoStoryBook(),
      specGens: twoStorySpecs(),
      deferredWorkItemIds: new Set(),
    });
    // f1 has no spec (structural) -> skipped; s1, s2, t1 dispatched in order.
    expect(set.map((d) => d.workItemId)).toEqual(['wi-1', 'wi-2', 'wi-test']);
    // sequence positions are contiguous 0..2.
    expect(set.map((d) => d.sequencePosition)).toEqual([0, 1, 2]);
    // deploy_on_complete only on the FINAL (the TEST item, which sorts last).
    expect(set.map((d) => d.deployOnComplete)).toEqual([false, false, true]);
    // the spec text is carried.
    expect(set[0].generatedSpecText).toContain('Story 1 body');
  });

  it('excludes a deferred story from the dispatch set entirely', () => {
    const set = buildOrderedDispatchSet({
      book: twoStoryBook(),
      specGens: twoStorySpecs(),
      deferredWorkItemIds: new Set(['wi-2']),
    });
    expect(set.map((d) => d.workItemId)).toEqual(['wi-1', 'wi-test']);
    expect(set[set.length - 1].deployOnComplete).toBe(true);
  });

  it('walkBookOfWorkItems puts TEST after its spanned children (depth-first by sequenceOrder)', () => {
    const ordered = walkBookOfWorkItems(twoStoryBook().book_of_work_json!.items!);
    expect(ordered.map((i) => i.id)).toEqual(['f1', 's1', 's2', 't1']);
  });
});

// ===========================================================================
// startMigration: trigger creates run + dispatches first + returns immediately
// ===========================================================================

describe('startMigration', () => {
  it('creates the run, pins the baseline, dispatches only the FIRST spec, and returns immediately', async () => {
    const deps = mockDeps();
    const result = await startMigration(scope, deps);

    expect(result.status).toBe('started');
    if (result.status === 'started') {
      expect(result.runId).toBe('run-1');
      expect(result.itemCount).toBe(3);
    }

    // create-run was called with the pinned baseline + deploy_on_complete on the final item only.
    expect(deps.createMigrationExecutionRun).toHaveBeenCalledTimes(1);
    const createArg = (deps.createMigrationExecutionRun as jest.Mock).mock.calls[0][1];
    expect(createArg.run.pinned_current_baseline_id).toBe(BASELINE_ID);
    expect(createArg.items.map((i: MigrationExecutionRunItem) => i.deploy_on_complete)).toEqual([false, false, true]);

    // Let the detached runner settle, then assert only ONE orchestration submit (the first spec).
    await flush();
    expect(deps.submitOrchestration).toHaveBeenCalledTimes(1);
  });

  it('BLOCKS (no run created) when a non-deferred story is not spec-ready', async () => {
    const deps = mockDeps({
      fetchSpecGenerationsForBook: jest.fn().mockResolvedValue([readySpec('wi-1', 'x', 'sg-1')]),
    });
    const result = await startMigration(scope, deps);
    expect(result.status).toBe('blocked');
    expect(deps.createMigrationExecutionRun).not.toHaveBeenCalled();
  });

  it('BLOCKS when no active current baseline exists', async () => {
    const deps = mockDeps({ fetchActiveCurrentBaseline: jest.fn().mockResolvedValue(null) });
    const result = await startMigration(scope, deps);
    expect(result.status).toBe('blocked');
    if (result.status === 'blocked') {
      expect(result.reasons.some((r) => r.code === 'missing_current_baseline')).toBe(true);
    }
  });

  it('per-spec dispatch posts the spec text via the auto-answerer + submits with callback_url and deploy_on_complete=false on the first spec', async () => {
    const deps = mockDeps();
    await startMigration(scope, deps);
    await flush();

    // The auto-answerer was fed the first spec's combined generated_spec_text.
    const answerArg = (deps.autoAnswerer.driveAndAnswer as jest.Mock).mock.calls[0][0];
    expect(answerArg.generatedSpecText).toContain('Story 1 body');

    // The orchestration submit carried the callback_url + deploy_on_complete=false (first spec).
    const submitArg = (deps.submitOrchestration as jest.Mock).mock.calls[0][0];
    expect(submitArg.callbackUrl).toBe('http://gw/api/implementation/build-results');
    expect(submitArg.deployOnComplete).toBe(false);
    expect(submitArg.specName).toBe('2026-06-14-some-spec-folder');

    // The job_id was recorded on the run-item (dispatched=true + job_id).
    const patchedJob = (deps.patchMigrationExecutionRunItem as jest.Mock).mock.calls.find(
      (c) => c[2] && c[2].job_id === 'job-1'
    );
    expect(patchedJob).toBeTruthy();
    expect(patchedJob[2].dispatched).toBe(true);
  });
});

// ===========================================================================
// advanceRunOnBuildResult: implemented advances + dispatches next; failure isolates; deployed records url; idempotent
// ===========================================================================

describe('advanceRunOnBuildResult', () => {
  /** A run with three items; the first is submitted with job-1. */
  function runWithItems(firstOutcome: string | null = null): MigrationExecutionRun {
    return {
      id: 'run-1',
      project_id: PROJECT_ID,
      book_of_work_id: BOOK_ID,
      status: RUN_STATUS.DISPATCHING,
      items: [
        { id: 'ri-0', run_id: 'run-1', sequence_position: 0, work_item_id: 'wi-1', spec_generation_id: 'sg-1', status: RUN_ITEM_STATUS.SUBMITTED, job_id: 'job-1', outcome: firstOutcome, deploy_on_complete: false },
        { id: 'ri-1', run_id: 'run-1', sequence_position: 1, work_item_id: 'wi-2', spec_generation_id: 'sg-2', status: RUN_ITEM_STATUS.PENDING, deploy_on_complete: false },
        { id: 'ri-2', run_id: 'run-1', sequence_position: 2, work_item_id: 'wi-test', spec_generation_id: 'sg-test', status: RUN_ITEM_STATUS.PENDING, deploy_on_complete: true },
      ],
    };
  }

  it('implemented -> records pr_url, advances, and dispatches the NEXT spec', async () => {
    const run = runWithItems();
    const deps = mockDeps({
      findMigrationRunItemByJobId: jest.fn().mockResolvedValue(run.items![0]),
      getMigrationExecutionRun: jest.fn().mockResolvedValue(run),
    });

    const decision = await advanceRunOnBuildResult(
      { company: 'acme', project: 'order-mig', jobId: 'job-1', outcome: 'implemented', prUrl: 'http://pr/12' },
      deps
    );
    expect(decision).toBe('advanced_next_dispatched');

    // ri-0 recorded implemented + pr_url.
    const implPatch = (deps.patchMigrationExecutionRunItem as jest.Mock).mock.calls.find(
      (c) => c[1] === 'ri-0' && c[2].outcome === 'implemented'
    );
    expect(implPatch[2].pr_url).toBe('http://pr/12');

    // The next spec was dispatched (auto-answerer driven for ri-1).
    await flush();
    expect(deps.submitOrchestration).toHaveBeenCalled();
  });

  it('failed -> halts the run + records the error against the run-item AND the work item (isolation)', async () => {
    const run = runWithItems();
    const deps = mockDeps({
      findMigrationRunItemByJobId: jest.fn().mockResolvedValue(run.items![0]),
      getMigrationExecutionRun: jest.fn().mockResolvedValue(run),
    });

    const decision = await advanceRunOnBuildResult(
      { company: 'acme', project: 'order-mig', jobId: 'job-1', outcome: 'failed', summary: 'build broke' },
      deps
    );
    expect(decision).toBe('halted');

    // run-item recorded failed + error_detail.
    const failPatch = (deps.patchMigrationExecutionRunItem as jest.Mock).mock.calls.find(
      (c) => c[1] === 'ri-0' && c[2].outcome === 'failed'
    );
    expect(failPatch[2].error_detail).toContain('build broke');
    // run marked halted.
    expect((deps.patchMigrationExecutionRun as jest.Mock).mock.calls.some((c) => c[2].status === RUN_STATUS.HALTED)).toBe(true);
    // work item surfaced.
    expect(deps.recordWorkItemImplementationError).toHaveBeenCalledWith(PROJECT_ID, 'wi-1', expect.stringContaining('build broke'));
    // no next dispatch on a halt.
    await flush();
    expect(deps.submitOrchestration).not.toHaveBeenCalled();
  });

  it('rejected -> halts the run (per-item isolation, same as failed)', async () => {
    const run = runWithItems();
    const deps = mockDeps({
      findMigrationRunItemByJobId: jest.fn().mockResolvedValue(run.items![0]),
      getMigrationExecutionRun: jest.fn().mockResolvedValue(run),
    });
    const decision = await advanceRunOnBuildResult(
      { company: 'acme', project: 'order-mig', jobId: 'job-1', outcome: 'rejected', summary: 'not a bug' },
      deps
    );
    expect(decision).toBe('halted');
    const rejPatch = (deps.patchMigrationExecutionRunItem as jest.Mock).mock.calls.find(
      (c) => c[1] === 'ri-0' && c[2].outcome === 'rejected'
    );
    expect(rejPatch).toBeTruthy();
  });

  it('deployed (final spec) -> marks the run deployed + records target_base_url', async () => {
    // Final item ri-2 carries the deployed callback.
    const run = runWithItems();
    // Phased execution (Spec W): the final item deploys only once the earlier
    // items are terminal — no PENDING items remain, so this is the FINAL plane
    // boundary (a deploy that completes the run, not a mid-run pause).
    run.items![0].status = RUN_ITEM_STATUS.IMPLEMENTED;
    run.items![1].status = RUN_ITEM_STATUS.IMPLEMENTED;
    run.items![2].status = RUN_ITEM_STATUS.SUBMITTED;
    run.items![2].job_id = 'job-final';
    const deps = mockDeps({
      findMigrationRunItemByJobId: jest.fn().mockResolvedValue(run.items![2]),
      getMigrationExecutionRun: jest.fn().mockResolvedValue(run),
    });

    const decision = await advanceRunOnBuildResult(
      { company: 'acme', project: 'order-mig', jobId: 'job-final', outcome: 'deployed', targetBaseUrl: 'https://target/order' },
      deps
    );
    expect(decision).toBe('deployed_recorded');

    // run marked deployed + target_base_url recorded.
    const runPatch = (deps.patchMigrationExecutionRun as jest.Mock).mock.calls.find((c) => c[2].status === RUN_STATUS.DEPLOYED);
    expect(runPatch[2].target_base_url).toBe('https://target/order');
  });

  it('is IDEMPOTENT: a duplicate callback for an already-terminal run-item is a no-op', async () => {
    const run = runWithItems('implemented'); // ri-0 already terminal.
    const deps = mockDeps({
      findMigrationRunItemByJobId: jest.fn().mockResolvedValue(run.items![0]),
      getMigrationExecutionRun: jest.fn().mockResolvedValue(run),
    });
    const decision = await advanceRunOnBuildResult(
      { company: 'acme', project: 'order-mig', jobId: 'job-1', outcome: 'implemented', prUrl: 'http://pr/dup' },
      deps
    );
    expect(decision).toBe('noop_idempotent');
    // No further patch on the already-terminal item.
    expect((deps.patchMigrationExecutionRunItem as jest.Mock).mock.calls.some((c) => c[1] === 'ri-0')).toBe(false);
  });

  it('returns run_item_not_found for an unknown job_id', async () => {
    const deps = mockDeps({ findMigrationRunItemByJobId: jest.fn().mockResolvedValue(null) });
    const decision = await advanceRunOnBuildResult(
      { company: 'acme', project: 'order-mig', jobId: 'nope', outcome: 'implemented' },
      deps
    );
    expect(decision).toBe('run_item_not_found');
  });
});

// ===========================================================================
// Boot-recovery sweep
// ===========================================================================

describe('recoverInFlightRuns', () => {
  it('re-kicks a run-item stuck mid-segment (answering, no job_id)', async () => {
    const stuckRun: MigrationExecutionRun = {
      id: 'run-1',
      project_id: PROJECT_ID,
      book_of_work_id: BOOK_ID,
      status: RUN_STATUS.DISPATCHING,
      items: [
        { id: 'ri-0', run_id: 'run-1', sequence_position: 0, work_item_id: 'wi-1', spec_generation_id: 'sg-1', status: RUN_ITEM_STATUS.ANSWERING, job_id: null, outcome: null, deploy_on_complete: false },
      ],
    };
    const deps = mockDeps({ getMigrationExecutionRun: jest.fn().mockResolvedValue(stuckRun) });

    const result = await recoverInFlightRuns(
      [{ projectId: PROJECT_ID, runId: 'run-1', company: 'acme', project: 'order-mig', bookId: BOOK_ID }],
      deps
    );
    expect(result.recovered).toBe(1);
    expect(result.rekicked).toBe(1);

    // The stuck spec was re-driven through the auto-answerer + submitted.
    await flush();
    expect(deps.autoAnswerer.driveAndAnswer).toHaveBeenCalled();
    expect(deps.submitOrchestration).toHaveBeenCalled();
  });

  it('skips a terminal (deployed) run', async () => {
    const deployedRun: MigrationExecutionRun = { id: 'run-1', project_id: PROJECT_ID, status: RUN_STATUS.DEPLOYED, items: [] };
    const deps = mockDeps({ getMigrationExecutionRun: jest.fn().mockResolvedValue(deployedRun) });
    const result = await recoverInFlightRuns(
      [{ projectId: PROJECT_ID, runId: 'run-1', company: 'acme', project: 'order-mig', bookId: BOOK_ID }],
      deps
    );
    expect(result.recovered).toBe(0);
    expect(result.rekicked).toBe(0);
  });
});
