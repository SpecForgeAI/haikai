/**
 * Tests for Robustness R2: driver-level transient auto-retry +
 * resume-from-failure (2026-08-05).
 *
 * Mirrors the migrationExecutionDriver test conventions: fully-mocked deps
 * surface, no AMS round-trip, no live LLM. The retry timer is injected
 * (deps.scheduleRetryTimer) so schedules are captured + fired synchronously.
 *
 * Covers:
 *  - a transient failure (IVS failure_class) schedules a retry instead of
 *    halting, persisting the attempt counter + next-attempt time and leaving
 *    `outcome` unset (so the retry's own callback is not dropped at CD-6);
 *  - firing the schedule re-dispatches the SAME spec with the `-r<attempt>`
 *    name suffix (the IVS dedup/worktree-lock bypass);
 *  - retry exhaustion halts (failure_class persisted as transient);
 *  - an explicit 'real' class halts immediately, no retry;
 *  - an UNCLASSIFIED failure whose summary matches the local transient
 *    signature list still retries;
 *  - a batch transient failure parks every sibling and re-submits a batch of
 *    ONLY the not-yet-implemented items;
 *  - resume-from-failure guards (non-halted refused), resets ONLY the
 *    non-implemented items (explicit-clear sentinel + counter zeroing) and
 *    re-dispatches;
 *  - the boot-recovery sweep re-arms an overdue persisted retry.
 */

// Mock the logger to silence output.
jest.mock('../services/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import {
  advanceRunOnBuildResult,
  recoverInFlightRuns,
  resumeFailedMigrationRun,
  MigrationDriverDeps,
  MigrateScope,
} from '../services/migrationExecutionDriver';
import {
  shouldAutoRetry,
  backoffMsBeforeAttempt,
  isTransientFailureText,
} from '../services/migrationSpecRetryPolicy';
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
    created_at: '2026-08-05T00:00:00Z',
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

/** A three-item sequential run; the first item is submitted with job-1. */
function sequentialRun(): MigrationExecutionRun {
  return {
    id: 'run-1',
    project_id: PROJECT_ID,
    book_of_work_id: BOOK_ID,
    status: RUN_STATUS.DISPATCHING,
    items: [
      { id: 'ri-0', run_id: 'run-1', sequence_position: 0, work_item_id: 'wi-1', spec_generation_id: 'sg-1', status: RUN_ITEM_STATUS.SUBMITTED, job_id: 'job-1', outcome: null, deploy_on_complete: false, retry_attempt_count: 0 },
      { id: 'ri-1', run_id: 'run-1', sequence_position: 1, work_item_id: 'wi-2', spec_generation_id: 'sg-2', status: RUN_ITEM_STATUS.PENDING, deploy_on_complete: false, retry_attempt_count: 0 },
      { id: 'ri-2', run_id: 'run-1', sequence_position: 2, work_item_id: 'wi-3', spec_generation_id: 'sg-3', status: RUN_ITEM_STATUS.PENDING, deploy_on_complete: true, retry_attempt_count: 0 },
    ],
  };
}

/** A two-item BATCH run: both items share the single batch job id. */
function batchRun(): MigrationExecutionRun {
  return {
    id: 'run-b',
    project_id: PROJECT_ID,
    book_of_work_id: BOOK_ID,
    status: RUN_STATUS.DISPATCHING,
    items: [
      { id: 'bi-0', run_id: 'run-b', sequence_position: 0, work_item_id: 'wi-1', spec_generation_id: 'sg-1', status: RUN_ITEM_STATUS.SUBMITTED, job_id: 'job-9', outcome: null, deploy_on_complete: false, retry_attempt_count: 0 },
      { id: 'bi-1', run_id: 'run-b', sequence_position: 1, work_item_id: 'wi-2', spec_generation_id: 'sg-2', status: RUN_ITEM_STATUS.SUBMITTED, job_id: 'job-9', outcome: null, deploy_on_complete: true, retry_attempt_count: 0 },
    ],
  };
}

/** Captured retry-timer schedules (delay + the callback to fire manually). */
interface CapturedTimer {
  delayMs: number;
  fn: () => void;
}

/**
 * A STATEFUL mock deps surface over ONE run object: patches MUTATE the run
 * (with the AMS explicit-clear sentinel applied: '' -> null) so re-reads see
 * the persisted state exactly like the live driver would — that is what makes
 * the schedule -> fire -> re-dispatch chain testable end-to-end.
 */
function statefulDeps(
  run: MigrationExecutionRun,
  timers: CapturedTimer[],
  overrides: Partial<MigrationDriverDeps> = {}
): MigrationDriverDeps {
  return {
    fetchBookOfWork: jest.fn().mockResolvedValue(book()),
    fetchSpecGenerationsForBook: jest.fn().mockResolvedValue(specs()),
    fetchWorkItems: jest.fn().mockResolvedValue([]),
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
          // Mirror the AMS mapper's explicit-clear sentinel: '' clears to null.
          (item as Record<string, unknown>)[k] = v === '' ? null : v;
        }
      }
      return item ?? {};
    }),
    findMigrationRunItemByJobId: jest.fn().mockImplementation(async (_p: string, jobId: string) =>
      (run.items ?? []).find((i) => i.job_id === jobId) ?? null
    ),
    submitOrchestration: jest.fn().mockResolvedValue({ ok: true, jobId: 'job-new', status: 'queued' }),
    submitOrchestrationBatch: jest.fn().mockResolvedValue({ ok: true, jobId: 'job-batch-new', status: 'queued' }),
    recordWorkItemImplementationError: jest.fn().mockResolvedValue(undefined),
    autoAnswerer: { driveAndAnswer: jest.fn() },
    buildResultsCallbackUrl: 'http://gw/api/implementation/build-results',
    // Serve-spec halt hardening (2026-08-07): a deploying service-plane
    // submit needs a registered serve spec — provide one by default.
    getTargetServeSpec: jest.fn().mockReturnValue({
      command: 'mvn spring-boot:run',
      healthPath: '/actuator/health',
    }),
    // Fail-closed seams (2026-08-07): carry-over reads + chain-base + plane
    // precedence must RESOLVE in tests (unreadable = blocked in production).
    carryOverCoverageReads: {
      fetchCapabilitiesForArchitecture: jest.fn().mockResolvedValue([]),
      fetchFindingsForRun: jest.fn().mockResolvedValue([]),
      fetchDiscoveryRunsForArchitecture: jest.fn().mockResolvedValue([]),
    },
    fetchMigrationExecutionRunsForBook: jest.fn().mockResolvedValue([]),
    fetchLatestMigrationExecutionRunForBook: jest.fn().mockResolvedValue(null),
    scheduleRetryTimer: (delayMs: number, fn: () => void) => {
      timers.push({ delayMs, fn });
    },
    ...overrides,
  };
}

/** Let detached runner microtasks settle. */
async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

afterEach(() => {
  delete process.env.MIGRATION_SPEC_RETRY_MAX_ATTEMPTS;
  delete process.env.MIGRATION_SPEC_RETRY_BACKOFF_SECONDS;
});

// ===========================================================================
// Policy (pure)
// ===========================================================================

describe('migrationSpecRetryPolicy', () => {
  it('classifies known transient signatures in text', () => {
    expect(isTransientFailureText('InternalServerException: backend blip')).toBe(true);
    expect(isTransientFailureText('kiro is having trouble responding right now')).toBe(true);
    expect(isTransientFailureText('spec left tasks unticked')).toBe(false);
  });

  it("an explicit 'real' class never retries, regardless of text", () => {
    const d = shouldAutoRetry({
      outcome: 'failed',
      failureClass: 'real',
      summary: 'timed out', // would match the scan — the class must win
      attemptCount: 1,
    });
    expect(d.retry).toBe(false);
    expect(d.transient).toBe(false);
  });

  it('a transient class retries until the budget (default 3 total tries) is spent', () => {
    expect(shouldAutoRetry({ outcome: 'error', failureClass: 'transient_upstream', attemptCount: 1 }).retry).toBe(true);
    expect(shouldAutoRetry({ outcome: 'error', failureClass: 'transient_upstream', attemptCount: 2 }).retry).toBe(true);
    const exhausted = shouldAutoRetry({ outcome: 'error', failureClass: 'transient_upstream', attemptCount: 3 });
    expect(exhausted.retry).toBe(false);
    expect(exhausted.transient).toBe(true); // exhausted but still transient
  });

  it('non-retryable outcomes (rejected) never retry even when transient-classed', () => {
    const d = shouldAutoRetry({ outcome: 'rejected', failureClass: 'transient_upstream', attemptCount: 1 });
    expect(d.retry).toBe(false);
  });

  it('the backoff schedule honours the env override and repeats its last entry', () => {
    process.env.MIGRATION_SPEC_RETRY_BACKOFF_SECONDS = '5,10';
    expect(backoffMsBeforeAttempt(2)).toBe(5000);
    expect(backoffMsBeforeAttempt(3)).toBe(10000);
    expect(backoffMsBeforeAttempt(7)).toBe(10000); // last entry repeats
  });
});

// ===========================================================================
// Single-item transient retry (advanceRunOnBuildResult)
// ===========================================================================

describe('advanceRunOnBuildResult transient auto-retry', () => {
  it('a transient failure schedules a retry instead of halting, persisting the counters', async () => {
    const run = sequentialRun();
    const timers: CapturedTimer[] = [];
    const deps = statefulDeps(run, timers);

    const decision = await advanceRunOnBuildResult(
      {
        company: 'acme', project: 'order-mig', jobId: 'job-1', outcome: 'failed',
        summary: 'step 2 died', failureClass: 'transient_upstream', failedStep: 2,
      },
      deps
    );
    expect(decision).toBe('retry_scheduled');

    // The item is PARKED pending with the persisted retry state...
    const parked = run.items![0];
    expect(parked.status).toBe(RUN_ITEM_STATUS.PENDING);
    expect(parked.retry_attempt_count).toBe(1);
    expect(parked.retry_next_attempt_at).toBeTruthy();
    expect(parked.failure_class).toBe('transient_upstream');
    expect(parked.error_detail).toContain('retry 2/3 scheduled');
    // ...and CRITICALLY carries NO terminal outcome (a terminal outcome would
    // drop the retry's own callback at the CD-6 idempotency guard).
    expect(parked.outcome).toBeNull();

    // The run was NOT halted.
    expect(
      (deps.patchMigrationExecutionRun as jest.Mock).mock.calls.some(
        (c) => c[2].status === RUN_STATUS.HALTED
      )
    ).toBe(false);
    // A timer was armed with the first backoff gap (default 60s).
    expect(timers).toHaveLength(1);
    expect(timers[0].delayMs).toBe(60000);
  });

  it('firing the schedule re-dispatches the SAME spec with the -r2 name suffix', async () => {
    const run = sequentialRun();
    const timers: CapturedTimer[] = [];
    const deps = statefulDeps(run, timers);

    await advanceRunOnBuildResult(
      { company: 'acme', project: 'order-mig', jobId: 'job-1', outcome: 'error', failureClass: 'transient_upstream' },
      deps
    );
    expect(timers).toHaveLength(1);

    timers[0].fn();
    await flush();

    expect(deps.submitOrchestration).toHaveBeenCalledTimes(1);
    const submitted = (deps.submitOrchestration as jest.Mock).mock.calls[0][0];
    // The retry bypasses the IVS active-job dedup (spec_name-keyed) + the
    // prior attempt's worktree branch lock via the attempt suffix.
    expect(submitted.specName).toMatch(/-r2$/);
    // The re-submit correlated the NEW job id back onto the item.
    expect(run.items![0].job_id).toBe('job-new');
    expect(run.items![0].status).toBe(RUN_ITEM_STATUS.SUBMITTED);
  });

  it('a duplicate failure callback while the retry is armed is an idempotent no-op', async () => {
    const run = sequentialRun();
    const timers: CapturedTimer[] = [];
    const deps = statefulDeps(run, timers);

    await advanceRunOnBuildResult(
      { company: 'acme', project: 'order-mig', jobId: 'job-1', outcome: 'failed', failureClass: 'transient_upstream' },
      deps
    );
    const decision = await advanceRunOnBuildResult(
      { company: 'acme', project: 'order-mig', jobId: 'job-1', outcome: 'failed', failureClass: 'transient_upstream' },
      deps
    );
    expect(decision).toBe('noop_idempotent');
    // Counter NOT double-incremented; only one timer armed.
    expect(run.items![0].retry_attempt_count).toBe(1);
    expect(timers).toHaveLength(1);
  });

  it('EXHAUSTION halts: a transient failure with the budget spent halts as today', async () => {
    const run = sequentialRun();
    run.items![0].retry_attempt_count = 2; // two prior transient failures -> this is try 3/3
    const timers: CapturedTimer[] = [];
    const deps = statefulDeps(run, timers);

    const decision = await advanceRunOnBuildResult(
      { company: 'acme', project: 'order-mig', jobId: 'job-1', outcome: 'failed', failureClass: 'transient_upstream', summary: 'blip again' },
      deps
    );
    expect(decision).toBe('halted');
    expect(run.items![0].status).toBe(RUN_ITEM_STATUS.FAILED);
    expect(run.items![0].outcome).toBe('failed');
    expect(run.items![0].failure_class).toBe('transient_upstream');
    expect(run.items![0].error_detail).toContain('retry budget exhausted');
    expect(run.status).toBe(RUN_STATUS.HALTED);
    expect(timers).toHaveLength(0);
    // The failure is surfaced against the work item, as before.
    expect(deps.recordWorkItemImplementationError).toHaveBeenCalled();
  });

  it("an explicit 'real' classification halts immediately (no retry, class persisted)", async () => {
    const run = sequentialRun();
    const timers: CapturedTimer[] = [];
    const deps = statefulDeps(run, timers);

    const decision = await advanceRunOnBuildResult(
      { company: 'acme', project: 'order-mig', jobId: 'job-1', outcome: 'failed', failureClass: 'real', summary: 'unticked tasks' },
      deps
    );
    expect(decision).toBe('halted');
    expect(run.items![0].failure_class).toBe('real');
    expect(run.status).toBe(RUN_STATUS.HALTED);
    expect(timers).toHaveLength(0);
  });

  it('UNCLASSIFIED failure with a transient-signature summary still retries (local scan)', async () => {
    const run = sequentialRun();
    const timers: CapturedTimer[] = [];
    const deps = statefulDeps(run, timers);

    const decision = await advanceRunOnBuildResult(
      {
        company: 'acme', project: 'order-mig', jobId: 'job-1', outcome: 'failed',
        summary: 'kiro-cli: InternalServerException — the model is having trouble responding',
        // no failureClass on the wire (older IVS build)
      },
      deps
    );
    expect(decision).toBe('retry_scheduled');
    expect(run.items![0].retry_attempt_count).toBe(1);
    expect(timers).toHaveLength(1);
  });

  it('UNCLASSIFIED failure with a non-matching summary halts as today', async () => {
    const run = sequentialRun();
    const timers: CapturedTimer[] = [];
    const deps = statefulDeps(run, timers);

    const decision = await advanceRunOnBuildResult(
      { company: 'acme', project: 'order-mig', jobId: 'job-1', outcome: 'failed', summary: 'build broke' },
      deps
    );
    expect(decision).toBe('halted');
    expect(run.status).toBe(RUN_STATUS.HALTED);
    expect(timers).toHaveLength(0);
  });

  it('an operator halt during the backoff wins: the fired timer does not resurrect the run', async () => {
    const run = sequentialRun();
    const timers: CapturedTimer[] = [];
    const deps = statefulDeps(run, timers);

    await advanceRunOnBuildResult(
      { company: 'acme', project: 'order-mig', jobId: 'job-1', outcome: 'failed', failureClass: 'transient_upstream' },
      deps
    );
    // Operator halts while the retry is pending.
    run.status = RUN_STATUS.HALTED;
    timers[0].fn();
    await flush();
    expect(deps.submitOrchestration).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Batch transient retry
// ===========================================================================

describe('batch transient auto-retry', () => {
  it('parks every sibling and re-submits a batch of ONLY the remaining specs', async () => {
    const run = batchRun();
    const timers: CapturedTimer[] = [];
    const deps = statefulDeps(run, timers);

    const decision = await advanceRunOnBuildResult(
      { company: 'acme', project: 'order-mig', jobId: 'job-9', outcome: 'failed', failureClass: 'transient_upstream' },
      deps
    );
    expect(decision).toBe('retry_scheduled');
    for (const item of run.items!) {
      expect(item.status).toBe(RUN_ITEM_STATUS.PENDING);
      expect(item.retry_attempt_count).toBe(1);
      expect(item.outcome).toBeNull();
    }
    expect(run.status).not.toBe(RUN_STATUS.HALTED);
    expect(timers).toHaveLength(1);

    timers[0].fn();
    await flush();

    // ONE batch re-submit carrying both remaining specs, suffixed for attempt 2.
    expect(deps.submitOrchestrationBatch).toHaveBeenCalledTimes(1);
    const submitted = (deps.submitOrchestrationBatch as jest.Mock).mock.calls[0][0];
    expect(submitted.specs).toHaveLength(2);
    expect(submitted.specs[0].specName).toMatch(/-r2$/);
    expect(submitted.batchName).toContain('retry-');
    // The new shared job id correlated onto every sibling.
    expect(run.items!.every((i) => i.job_id === 'job-batch-new')).toBe(true);
  });
});

// ===========================================================================
// Resume-from-failure
// ===========================================================================

describe('resumeFailedMigrationRun', () => {
  it('refuses a non-halted run with a 409-shaped reason', async () => {
    const run = sequentialRun(); // status: dispatching
    const deps = statefulDeps(run, []);
    const result = await resumeFailedMigrationRun(scope, 'run-1', deps);
    expect(result.status).toBe('not_resumable');
    expect((result as { reason: string }).reason).toContain('dispatching');
    expect(deps.patchMigrationExecutionRunItem).not.toHaveBeenCalled();
  });

  it('returns not_found for an unknown run', async () => {
    const deps = statefulDeps(sequentialRun(), [], {
      getMigrationExecutionRun: jest.fn().mockResolvedValue(null),
    });
    const result = await resumeFailedMigrationRun(scope, 'run-x', deps);
    expect(result.status).toBe('not_found');
  });

  it('resets ONLY the non-implemented items (sentinel clears + zeroed counters) and re-dispatches the failed item', async () => {
    const run = sequentialRun();
    run.status = RUN_STATUS.HALTED;
    run.items![0].status = RUN_ITEM_STATUS.IMPLEMENTED;
    run.items![0].outcome = 'implemented';
    run.items![1].status = RUN_ITEM_STATUS.FAILED;
    run.items![1].outcome = 'failed';
    run.items![1].job_id = 'job-2';
    run.items![1].error_detail = 'boom';
    run.items![1].retry_attempt_count = 3;
    run.items![1].failure_class = 'transient_upstream';
    const deps = statefulDeps(run, []);

    const result = await resumeFailedMigrationRun(scope, 'run-1', deps);
    expect(result).toEqual({ status: 'resumed', runId: 'run-1', itemsReset: 2 });

    // The implemented item was NOT touched.
    expect(
      (deps.patchMigrationExecutionRunItem as jest.Mock).mock.calls.some((c) => c[1] === 'ri-0')
    ).toBe(false);
    // The failed item was reset through the explicit-clear sentinel: the PATCH
    // sends '' (the AMS mapper clears to NULL) + a zeroed counter.
    const resetPatch = (deps.patchMigrationExecutionRunItem as jest.Mock).mock.calls.find(
      (c) => c[1] === 'ri-1' && c[2].status === RUN_ITEM_STATUS.PENDING
    );
    expect(resetPatch[2]).toMatchObject({
      outcome: '',
      error_detail: '',
      job_id: '',
      failure_class: '',
      retry_next_attempt_at: '',
      retry_attempt_count: 0,
      dispatched: false,
    });
    // Post-sentinel state on the (stateful) run: genuinely cleared.
    expect(run.items![1].outcome).toBeNull();
    expect(run.items![1].job_id).toBeNull();
    expect(run.items![1].retry_attempt_count).toBe(0);

    // Run back to the active driver status + re-dispatch of the FIRST reset item.
    expect(run.status).toBe(RUN_STATUS.DISPATCHING);
    await flush();
    expect(deps.submitOrchestration).toHaveBeenCalledTimes(1);
    const submitted = (deps.submitOrchestration as jest.Mock).mock.calls[0][0];
    // No -r suffix: a manual resume is a fresh attempt 1.
    expect(submitted.specName).not.toMatch(/-r\d+$/);
    expect(run.items![1].job_id).toBe('job-new');
  });

  it('a halted BATCH run resumes as ONE re-submitted batch of the remaining items', async () => {
    const run = batchRun();
    run.status = RUN_STATUS.HALTED;
    run.items![0].status = RUN_ITEM_STATUS.FAILED;
    run.items![0].outcome = 'failed';
    run.items![1].status = RUN_ITEM_STATUS.FAILED;
    run.items![1].outcome = 'failed';
    const deps = statefulDeps(run, []);

    const result = await resumeFailedMigrationRun(scope, 'run-b', deps);
    expect(result.status).toBe('resumed');
    await flush();
    expect(deps.submitOrchestrationBatch).toHaveBeenCalledTimes(1);
    const submitted = (deps.submitOrchestrationBatch as jest.Mock).mock.calls[0][0];
    expect(submitted.specs).toHaveLength(2);
    expect(submitted.batchName).toContain('resume-');
  });

  // -------------------------------------------------------------------------
  // Salvage-first resume (2026-08-15)
  // -------------------------------------------------------------------------

  it('salvage re-aligns the item spec_name to the branch that was actually pushed — the successor chains off the salvaged work', async () => {
    const run = sequentialRun();
    run.status = RUN_STATUS.HALTED;
    run.items![0].status = RUN_ITEM_STATUS.FAILED;
    run.items![0].outcome = 'failed';
    run.items![0].spec_name = '2026-08-15-story-one-aaaa1111';
    const salvageMock = jest.fn().mockResolvedValue({
      status: 'salvaged',
      // IVS legitimately returns a DIFFERENT attempt's branch: only the -r2
      // tree survived reclamation.
      branch: 'feature/2026-08-15-story-one-aaaa1111-r2',
      committed: true,
      summary: '1 file changed',
    });
    const deps = statefulDeps(run, [], { salvageSpecWorktree: salvageMock });

    const result = await resumeFailedMigrationRun(scope, 'run-1', deps, {
      salvageFirstFailed: true,
    });
    expect(result.status).toBe('resumed');
    expect(salvageMock).toHaveBeenCalledWith(
      'acme',
      'order-mig',
      '2026-08-15-story-one-aaaa1111'
    );
    // The salvaged item: implemented AND re-stamped to the pushed branch's name.
    expect(run.items![0].status).toBe(RUN_ITEM_STATUS.IMPLEMENTED);
    expect(run.items![0].spec_name).toBe('2026-08-15-story-one-aaaa1111-r2');
    await flush();
    // The next spec chains off the SALVAGED branch, not the stale base name.
    const submittedNext = (deps.submitOrchestration as jest.Mock).mock.calls[0][0];
    expect(submittedNext.baseSpec).toBe('2026-08-15-story-one-aaaa1111-r2');
  });

  it('a refused salvage (nothing_to_salvage) blocks the resume — the spec is NEVER marked implemented on an empty branch', async () => {
    const run = sequentialRun();
    run.status = RUN_STATUS.HALTED;
    run.items![0].status = RUN_ITEM_STATUS.FAILED;
    run.items![0].outcome = 'failed';
    run.items![0].spec_name = '2026-08-15-story-one-aaaa1111';
    const salvageMock = jest.fn().mockResolvedValue({
      status: 'nothing_to_salvage',
      message: 'branch has no commits beyond its creation base',
    });
    const deps = statefulDeps(run, [], { salvageSpecWorktree: salvageMock });

    const result = await resumeFailedMigrationRun(scope, 'run-1', deps, {
      salvageFirstFailed: true,
    });
    expect(result.status).toBe('not_resumable');
    expect((result as { reason: string }).reason).toContain('nothing_to_salvage');
    expect(run.items![0].status).toBe(RUN_ITEM_STATUS.FAILED); // untouched
    expect(deps.submitOrchestration).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Boot-recovery sweep re-arms persisted retries
// ===========================================================================

describe('boot sweep retry re-arm', () => {
  it('re-arms an OVERDUE persisted retry (fires ~immediately) and re-dispatches with the attempt suffix', async () => {
    const run = sequentialRun();
    run.items![0].status = RUN_ITEM_STATUS.PENDING;
    run.items![0].retry_attempt_count = 1;
    run.items![0].retry_next_attempt_at = new Date(Date.now() - 60_000).toISOString(); // overdue
    const timers: CapturedTimer[] = [];
    const deps = statefulDeps(run, timers);

    const result = await recoverInFlightRuns(
      [{ projectId: PROJECT_ID, runId: 'run-1', company: 'acme', project: 'order-mig', bookId: BOOK_ID }],
      deps
    );
    expect(result.retriesRearmed).toBe(1);
    expect(timers).toHaveLength(1);
    expect(timers[0].delayMs).toBe(0); // overdue -> fire now

    timers[0].fn();
    await flush();
    expect(deps.submitOrchestration).toHaveBeenCalledTimes(1);
    const submitted = (deps.submitOrchestration as jest.Mock).mock.calls[0][0];
    expect(submitted.specName).toMatch(/-r2$/);
  });

  it('does NOT sweep ordinary pending items (counter 0) into a parallel dispatch', async () => {
    const run = sequentialRun(); // ri-1 / ri-2 pending with counter 0
    const timers: CapturedTimer[] = [];
    const deps = statefulDeps(run, timers);

    const result = await recoverInFlightRuns(
      [{ projectId: PROJECT_ID, runId: 'run-1', company: 'acme', project: 'order-mig', bookId: BOOK_ID }],
      deps
    );
    expect(result.retriesRearmed).toBe(0);
    expect(timers).toHaveLength(0);
  });
});
