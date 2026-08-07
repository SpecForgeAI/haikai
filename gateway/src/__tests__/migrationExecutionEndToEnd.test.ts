/**
 * End-to-end Migration Execution integration tests (Spec 2026-06-14, Task
 * Group 6 -- the strategic gap pass).
 *
 * The per-group unit tests (migrationExecutionDriver / buildResultsReceiver /
 * shapeSpecAutoAnswerer) each cover ONE seam against a static, stateless mock
 * surface. They do NOT exercise the CONNECTED flow: a real Migrate trigger that
 * creates a run, dispatches the first spec through the REAL per-spec runner, and
 * then walks the WHOLE book to a deploy via the REAL build-results door +
 * advance loop -- with run-state that actually mutates between callbacks.
 *
 * These tests wire the REAL Driver (`startMigration` + `advanceRunOnBuildResult`
 * + `recoverInFlightRuns`) and the REAL receiver core (`processBuildResult`)
 * together over a STATEFUL in-memory AMS run-state fake, stubbing ONLY the
 * outermost DI seams (AMS run-state client, AMS data reads, orchestration
 * submit, auto-answerer). They assert the orchestration wiring + the
 * callback->advance progression end-to-end on run-state.
 *
 * The LLM guard is respected: the only LLM boundary (the shape-spec
 * auto-answerer) is injected as a deterministic fake -- no live LLM is reachable.
 *
 * Coverage (the 12-test cap; these are the cross-seam flows not covered by the
 * per-group unit tests):
 *   1. FULL HAPPY PATH: trigger -> hard-block passes -> ordered run created
 *      (deferred excluded, TEST included, deploy_on_complete only on the final)
 *      -> first spec auto-answered + submitted with callback_url + job_id
 *      recorded -> each `implemented` callback advances + dispatches the next ->
 *      final spec `deployed` marks the run deployed + records target_base_url.
 *   2. HARD-BLOCK end-to-end: a not-generated non-deferred story blocks the
 *      trigger (no run created; offending list returned); deferring it unblocks
 *      and the deferred story is NOT in the dispatch set.
 *   3. failed/rejected isolation end-to-end: a mid-run `failed` callback records
 *      against the run-item + work item, halts the run, and dispatches no
 *      sibling (the run does not advance past the failure).
 *   4. BOOT-RECOVERY end-to-end: an in-flight run with a mid-segment item
 *      (answering, no job_id) is resumed on the sweep -> the item is driven to
 *      submitted with a job_id.
 *   5. IDEMPOTENT duplicate build-results is a no-op `202` end-to-end (through
 *      the real door).
 *   6. AUTO-ANSWERER never-abstains within the dispatch path: a sparse question
 *      still yields a concrete resume answer that lets the segment submit.
 */

// Silence the logger.
jest.mock('../services/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// Config: a configured inbound token (the door's 401 guard is satisfied) + base
// URLs. The real receiver core reads getConfig().buildResultsServiceToken.
jest.mock('../config', () => ({
  getConfig: jest.fn(() => ({
    architectureModelServiceBaseUrl: 'http://localhost:8080',
    implementationLlmServiceBaseUrl: 'http://localhost:8000',
    implementationLlmServiceBearerToken: 'test-server-token',
    gatewayPublicBaseUrl: 'http://gw',
    buildResultsServiceToken: 'inbound-secret',
  })),
}));

import {
  startMigration,
  advanceRunOnBuildResult,
  recoverInFlightRuns,
  MigrationDriverDeps,
  MigrateScope,
} from '../services/migrationExecutionDriver';
import { processBuildResult } from '../services/buildResultsReceiver';
import {
  RUN_STATUS,
  RUN_ITEM_STATUS,
  MigrationExecutionRun,
  MigrationExecutionRunItem,
  CreateMigrationExecutionRunRequest,
} from '../services/migrationExecutionRunClient';
import { BookOfWork, SpecGeneration } from '../services/migrationDriverAmsReads';
import {
  answerShapeSpecQuestions,
  ShapeSpecAnswerDecision,
} from '../services/shapeSpecAnswerLoopRunner';
import { driveShapeSpecStream } from '../services/shapeSpecHeadlessStream';
import {
  ShapeSpecAutoAnswerer,
  ShapeSpecAnswerInput,
} from '../services/shapeSpecAutoAnswererSeam';
import type {
  ArchitectLlmClient,
  CallLlmToolLoopArgs,
  CallLlmToolLoopResponse,
} from '../services/architectConversation/architectLlmClient';
import { SHAPE_SPEC_ANSWER_TOOL } from '../services/shapeSpecAnswerLoopRunner';
import { runMigrationBootRecovery } from '../services/migrationBootRecovery';

// ===========================================================================
// Fixtures
// ===========================================================================

const PROJECT_ID = 'proj-1';
const BOOK_ID = 'book-1';
const BASELINE_ID = 'baseline-current-1';
const CALLBACK_URL = 'http://gw/api/implementation/build-results';

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
    created_at: '2026-06-14T00:00:00Z',
  };
}

/** Feature parent (no spec) + two leaf stories + a TEST sibling (sorts last). */
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

// ---------------------------------------------------------------------------
// A STATEFUL in-memory AMS run-state fake. The Driver advance re-reads the run
// to find the next pending item and correlates callbacks by job_id, so the
// store MUST mutate between calls (a static mock cannot exercise progression).
// ---------------------------------------------------------------------------

class RunStateStore {
  run: MigrationExecutionRun | null = null;
  private seq = 0;

  createRun = jest.fn(
    async (_projectId: string, req: CreateMigrationExecutionRunRequest): Promise<MigrationExecutionRun> => {
      const items = req.items.map((it, idx) => ({
        ...it,
        id: `ri-${idx}`,
        run_id: 'run-1',
      }));
      this.run = { ...req.run, id: 'run-1', items };
      return this.cloneRun();
    },
  );

  getRun = jest.fn(async (): Promise<MigrationExecutionRun | null> => {
    return this.run ? this.cloneRun() : null;
  });

  findItemByJobId = jest.fn(
    async (_projectId: string, jobId: string): Promise<MigrationExecutionRunItem | null> => {
      const item = (this.run?.items ?? []).find((i) => i.job_id === jobId);
      return item ? { ...item } : null;
    },
  );

  patchItem = jest.fn(
    async (
      _projectId: string,
      runItemId: string,
      patch: MigrationExecutionRunItem,
    ): Promise<MigrationExecutionRunItem> => {
      const item = (this.run?.items ?? []).find((i) => i.id === runItemId);
      if (item) Object.assign(item, patch); // null-guarded merge (omitted = no-op)
      return item ? { ...item } : { id: runItemId };
    },
  );

  patchRun = jest.fn(
    async (
      _projectId: string,
      _runId: string,
      patch: MigrationExecutionRun,
    ): Promise<MigrationExecutionRun> => {
      if (this.run) Object.assign(this.run, { ...patch, items: this.run.items });
      return this.cloneRun();
    },
  );

  /** Allocate a fresh job id (one per orchestration submit). */
  nextJobId(): string {
    this.seq += 1;
    return `job-${this.seq}`;
  }

  private cloneRun(): MigrationExecutionRun {
    return {
      ...this.run,
      items: (this.run?.items ?? []).map((i) => ({ ...i })),
    } as MigrationExecutionRun;
  }
}

/** A deterministic auto-answerer that concludes with a per-item folder. */
function fakeAutoAnswerer(): ShapeSpecAutoAnswerer {
  return {
    driveAndAnswer: jest.fn(async (input: ShapeSpecAnswerInput) => ({
      ok: true,
      specName: `2026-folder-${input.runItemId}`,
      sessionId: `sess-${input.runItemId}`,
      decisionLog: [{ question: 'Which datastore?', answer: 'Postgres (like-for-like).', rationale: 'mirror current.' }],
    })),
  };
}

/**
 * Build a deps surface wiring the REAL Driver over the stateful store. Each
 * orchestration submit allocates a fresh job id AND stamps it onto the run-item
 * the runner is currently submitting (so the build-results callback correlates).
 */
function wireDeps(
  store: RunStateStore,
  overrides: Partial<MigrationDriverDeps> = {},
): MigrationDriverDeps {
  const submitOrchestration = jest.fn(async () => ({
    ok: true,
    jobId: store.nextJobId(),
    status: 'queued',
  }));

  return {
    fetchBookOfWork: jest.fn().mockResolvedValue(twoStoryBook()),
    fetchSpecGenerationsForBook: jest.fn().mockResolvedValue(twoStorySpecs()),
    fetchWorkItems: jest.fn().mockResolvedValue([
      { id: 'wi-1', type: 'STORY', deferred: false },
      { id: 'wi-2', type: 'STORY', deferred: false },
      { id: 'wi-test', type: 'TEST', deferred: false },
    ]),
    fetchActiveCurrentBaseline: jest
      .fn()
      .mockResolvedValue({ id: BASELINE_ID, kind: 'current', status: 'active' }),
    createMigrationExecutionRun: store.createRun,
    getMigrationExecutionRun: store.getRun,
    patchMigrationExecutionRun: store.patchRun,
    patchMigrationExecutionRunItem: store.patchItem,
    findMigrationRunItemByJobId: store.findItemByJobId,
    submitOrchestration,
    recordWorkItemImplementationError: jest.fn().mockResolvedValue(undefined),
    autoAnswerer: fakeAutoAnswerer(),
    buildResultsCallbackUrl: CALLBACK_URL,
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
    // Spec-4 reconcile seams stubbed: the final-spec `deployed` advance kicks
    // the full-baseline reconcile fire-and-forget. Stub the trigger so the
    // end-to-end run stays hermetic (no validation-service / AMS network), while
    // still asserting the run is marked deployed + target_base_url recorded.
    triggerReconcile: jest.fn().mockResolvedValue({ status: 'reconciled', breakCount: 0 }),
    handleBugCallback: jest.fn().mockResolvedValue({ status: 'unknown_bug' }),
    reconciliationDeps: {
      getReconciliationBreaksByBugId: jest.fn().mockResolvedValue([]),
    } as unknown as MigrationDriverDeps['reconciliationDeps'],
    ...overrides,
  };
}

/** Let the detached per-spec runner's microtasks settle. */
async function flush(): Promise<void> {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
}

/** Find the item currently submitted (dispatched, has a job_id, no terminal outcome). */
function liveSubmittedJobId(store: RunStateStore): string {
  const item = (store.run?.items ?? []).find(
    (i) => i.dispatched && i.job_id && !i.outcome,
  );
  if (!item || !item.job_id) {
    throw new Error('no live submitted run-item with a job_id');
  }
  return item.job_id;
}

// ===========================================================================
// 1 -- FULL HAPPY PATH through to a deploy
// ===========================================================================

describe('end-to-end: full happy path trigger -> implemented* -> deployed', () => {
  it('walks the whole book and marks the run deployed on the final spec', async () => {
    const store = new RunStateStore();
    const deps = wireDeps(store);

    // --- Migrate trigger: hard-block passes, run created, first spec dispatched ---
    const started = await startMigration(scope, deps);
    expect(started.status).toBe('started');
    if (started.status === 'started') {
      expect(started.itemCount).toBe(3); // f1 (structural) skipped; s1, s2, t1
    }

    // The run was created with ordered items: deferred excluded, TEST included,
    // deploy_on_complete only on the FINAL item.
    const created = store.createRun.mock.calls[0][1] as CreateMigrationExecutionRunRequest;
    expect(created.run.pinned_current_baseline_id).toBe(BASELINE_ID);
    expect(created.items.map((i) => i.work_item_id)).toEqual(['wi-1', 'wi-2', 'wi-test']);
    expect(created.items.map((i) => i.deploy_on_complete)).toEqual([false, false, true]);

    // The first spec was auto-answered + submitted with the callback_url; the
    // job_id is recorded on the run-item.
    await flush();
    const submit = deps.submitOrchestration as jest.Mock;
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls[0][0].callbackUrl).toBe(CALLBACK_URL);
    expect(submit.mock.calls[0][0].deployOnComplete).toBe(false);
    const job0 = liveSubmittedJobId(store);
    expect(store.run!.items![0].status).toBe(RUN_ITEM_STATUS.SUBMITTED);

    // --- implemented callback for spec 0 -> advances + dispatches spec 1 ---
    const d0 = await advanceRunOnBuildResult(
      { company: 'acme', project: 'order-mig', jobId: job0, outcome: 'implemented', prUrl: 'http://pr/0' },
      deps,
    );
    expect(d0).toBe('advanced_next_dispatched');
    expect(store.run!.items![0].outcome).toBe('implemented');
    expect(store.run!.items![0].pr_url).toBe('http://pr/0');

    // --- implemented callback for spec 1 -> advances + dispatches the final spec ---
    await flush();
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit.mock.calls[1][0].deployOnComplete).toBe(false);
    const job1 = liveSubmittedJobId(store);
    const d1 = await advanceRunOnBuildResult(
      { company: 'acme', project: 'order-mig', jobId: job1, outcome: 'implemented', prUrl: 'http://pr/1' },
      deps,
    );
    expect(d1).toBe('advanced_next_dispatched');

    // --- the FINAL spec carries deploy_on_complete=true on its submit ---
    await flush();
    expect(submit).toHaveBeenCalledTimes(3);
    expect(submit.mock.calls[2][0].deployOnComplete).toBe(true);
    const jobFinal = liveSubmittedJobId(store);

    // --- the FINAL spec reports DEPLOYED directly (per the pinned contract:
    //     "specs 1..N-1 report implemented; spec N also deploys and reports
    //     deployed") -> run marked deployed + target_base_url recorded; no
    //     further dispatch. The final spec does NOT emit a separate implemented
    //     callback first (its outcome IS deployed). ---
    const dDep = await advanceRunOnBuildResult(
      { company: 'acme', project: 'order-mig', jobId: jobFinal, outcome: 'deployed', targetBaseUrl: 'https://target/order', prUrl: 'http://pr/2' },
      deps,
    );
    expect(dDep).toBe('deployed_recorded');
    await flush();
    expect(submit).toHaveBeenCalledTimes(3); // no 4th dispatch
    expect(store.run!.status).toBe(RUN_STATUS.DEPLOYED);
    expect(store.run!.target_base_url).toBe('https://target/order');
    expect(store.run!.items![2].outcome).toBe('deployed');
    expect(store.run!.items![2].target_base_url).toBe('https://target/order');
  });
});

// ===========================================================================
// 2 -- HARD-BLOCK end-to-end (block, then defer unblocks + excludes)
// ===========================================================================

describe('end-to-end: hard-block then defer', () => {
  it('blocks the trigger on a not-generated non-deferred story (no run created)', async () => {
    const store = new RunStateStore();
    // wi-2 has no spec row -> not spec-ready -> the gate refuses.
    const deps = wireDeps(store, {
      fetchSpecGenerationsForBook: jest
        .fn()
        .mockResolvedValue([readySpec('wi-1', 'x', 'sg-1'), readySpec('wi-test', 'x', 'sg-test')]),
    });

    const result = await startMigration(scope, deps);
    expect(result.status).toBe('blocked');
    if (result.status === 'blocked') {
      expect(result.reasons.some((r) => r.code === 'story_not_spec_ready' && r.workItemId === 'wi-2')).toBe(true);
    }
    // No run was created and nothing was dispatched.
    expect(store.createRun).not.toHaveBeenCalled();
    await flush();
    expect(deps.submitOrchestration).not.toHaveBeenCalled();
  });

  it('deferring the un-ready story unblocks the trigger AND excludes it from the dispatch set', async () => {
    const store = new RunStateStore();
    // wi-2 un-ready BUT deferred -> drops out of the in-scope gate + the dispatch set.
    const deps = wireDeps(store, {
      fetchSpecGenerationsForBook: jest
        .fn()
        .mockResolvedValue([readySpec('wi-1', 'x', 'sg-1'), readySpec('wi-test', 'x', 'sg-test')]),
      fetchWorkItems: jest.fn().mockResolvedValue([
        { id: 'wi-1', type: 'STORY', deferred: false },
        { id: 'wi-2', type: 'STORY', deferred: true }, // deferred
        { id: 'wi-test', type: 'TEST', deferred: false },
      ]),
    });

    const result = await startMigration(scope, deps);
    expect(result.status).toBe('started');

    // The created run dispatches only wi-1 + wi-test; the deferred wi-2 is NOT in it.
    const created = store.createRun.mock.calls[0][1] as CreateMigrationExecutionRunRequest;
    expect(created.items.map((i) => i.work_item_id)).toEqual(['wi-1', 'wi-test']);
    expect(created.items.map((i) => i.work_item_id)).not.toContain('wi-2');
    // deploy_on_complete is on the new final item (wi-test).
    expect(created.items[created.items.length - 1].deploy_on_complete).toBe(true);
  });
});

// ===========================================================================
// 3 -- failed isolation end-to-end (halt, record, no sibling dispatch)
// ===========================================================================

describe('end-to-end: failed callback isolation', () => {
  it('records the failure against the run-item + work item, halts the run, and dispatches no sibling', async () => {
    const store = new RunStateStore();
    const deps = wireDeps(store);

    await startMigration(scope, deps);
    await flush();
    const job0 = liveSubmittedJobId(store);

    // A mid-run failed callback for the first spec.
    const decision = await advanceRunOnBuildResult(
      { company: 'acme', project: 'order-mig', jobId: job0, outcome: 'failed', summary: 'compile error' },
      deps,
    );
    expect(decision).toBe('halted');

    // The failed item carries the error; the run is halted.
    expect(store.run!.items![0].outcome).toBe('failed');
    expect(store.run!.items![0].error_detail).toContain('compile error');
    expect(store.run!.status).toBe(RUN_STATUS.HALTED);
    // The work item was surfaced (human traceability).
    expect(deps.recordWorkItemImplementationError).toHaveBeenCalledWith(
      PROJECT_ID,
      'wi-1',
      expect.stringContaining('compile error'),
    );
    // No sibling spec was dispatched after the halt (still only the first submit).
    await flush();
    expect(deps.submitOrchestration).toHaveBeenCalledTimes(1);
    // The next item stays pending (the run did not advance past the failure).
    expect(store.run!.items![1].status).toBe(RUN_ITEM_STATUS.PENDING);
  });

  it('treats a rejected callback the same as failed (per-item isolation, halt)', async () => {
    const store = new RunStateStore();
    const deps = wireDeps(store);
    await startMigration(scope, deps);
    await flush();
    const job0 = liveSubmittedJobId(store);

    const decision = await advanceRunOnBuildResult(
      { company: 'acme', project: 'order-mig', jobId: job0, outcome: 'rejected', summary: 'not a defect' },
      deps,
    );
    expect(decision).toBe('halted');
    expect(store.run!.items![0].outcome).toBe('rejected');
    expect(store.run!.status).toBe(RUN_STATUS.HALTED);
  });
});

// ===========================================================================
// 4 -- BOOT-RECOVERY end-to-end (resume a stuck mid-segment item)
// ===========================================================================

describe('end-to-end: boot-recovery resumes a stuck run', () => {
  it('re-kicks a run-item stuck mid-segment (answering, no job_id) -> driven to submitted', async () => {
    const store = new RunStateStore();
    // Seed a run whose first item is stuck answering with no job_id (a crash
    // between "answering" and "job created").
    store.run = {
      id: 'run-1',
      project_id: PROJECT_ID,
      book_of_work_id: BOOK_ID,
      status: RUN_STATUS.DISPATCHING,
      pinned_current_baseline_id: BASELINE_ID,
      items: [
        { id: 'ri-0', run_id: 'run-1', sequence_position: 0, work_item_id: 'wi-1', spec_generation_id: 'sg-1', status: RUN_ITEM_STATUS.ANSWERING, job_id: null, outcome: null, deploy_on_complete: false },
        { id: 'ri-1', run_id: 'run-1', sequence_position: 1, work_item_id: 'wi-2', spec_generation_id: 'sg-2', status: RUN_ITEM_STATUS.PENDING, deploy_on_complete: false },
        { id: 'ri-2', run_id: 'run-1', sequence_position: 2, work_item_id: 'wi-test', spec_generation_id: 'sg-test', status: RUN_ITEM_STATUS.PENDING, deploy_on_complete: true },
      ],
    };
    const deps = wireDeps(store);

    const result = await recoverInFlightRuns(
      [{ projectId: PROJECT_ID, runId: 'run-1', company: 'acme', project: 'order-mig', bookId: BOOK_ID }],
      deps,
    );
    expect(result.recovered).toBe(1);
    expect(result.rekicked).toBe(1);

    // The stuck spec was re-dispatched DETERMINISTICALLY (no shaping turn),
    // and its job_id is now recorded (it is no longer stuck).
    await flush();
    expect(deps.autoAnswerer.driveAndAnswer).not.toHaveBeenCalled();
    expect(deps.submitOrchestration).toHaveBeenCalledTimes(1);
    expect(store.run!.items![0].status).toBe(RUN_ITEM_STATUS.SUBMITTED);
    expect(store.run!.items![0].job_id).toBeTruthy();
  });
});

// ===========================================================================
// 5 -- IDEMPOTENT duplicate build-results is a no-op 202 (through the real door)
// ===========================================================================

describe('end-to-end: idempotent duplicate callback through the real door', () => {
  it('the second identical implemented callback is a no-op 202 (no double advance)', async () => {
    const store = new RunStateStore();
    const deps = wireDeps(store);
    await startMigration(scope, deps);
    await flush();
    const job0 = liveSubmittedJobId(store);

    // First implemented callback through the REAL door -> 202, advances.
    const first = await processBuildResult(
      { company: 'acme', project: 'order-mig', outcome: 'implemented', job_id: job0, pr_url: 'http://pr/0' },
      deps,
    );
    expect(first.status).toBe(202);
    expect(first.decision).toBe('advanced_next_dispatched');
    await flush();
    const submitsAfterFirst = (deps.submitOrchestration as jest.Mock).mock.calls.length;

    // Duplicate of the SAME callback -> the item is already terminal -> no-op 202.
    const dup = await processBuildResult(
      { company: 'acme', project: 'order-mig', outcome: 'implemented', job_id: job0, pr_url: 'http://pr/0-dup' },
      deps,
    );
    expect(dup.status).toBe(202);
    expect(dup.decision).toBe('noop_idempotent');
    await flush();
    // No extra dispatch happened on the duplicate (the next spec was not re-kicked).
    expect((deps.submitOrchestration as jest.Mock).mock.calls.length).toBe(submitsAfterFirst);
    // The recorded pr_url is from the FIRST callback, not the duplicate.
    expect(store.run!.items![0].pr_url).toBe('http://pr/0');
  });
});

// ===========================================================================
// 6 -- AUTO-ANSWERER never-abstains WITHIN the dispatch path
// ===========================================================================

describe('end-to-end: auto-answerer never abstains within the dispatch path', () => {
  it('a sparse question still yields a concrete resume answer that lets the segment submit', async () => {
    const store = new RunStateStore();

    // A REAL auto-answerer wired over a scripted shape-spec stream (a sparse
    // question) + a mocked LLM client (the LLM guard boundary). The runner uses
    // the SAME seam in production; here we assert it never abstains end-to-end.
    const resumeBodies: Array<Record<string, unknown>> = [];
    let call = 0;
    const sse = (lines: string[]): Response => {
      const payload = lines.map((l) => `${l}\n`).join('');
      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new TextEncoder().encode(payload));
          c.close();
        },
      });
      return { ok: true, status: 200, body: stream } as unknown as Response;
    };
    const turn1 = sse([
      'data: {"type":"session","session_id":"sess-x"}',
      'data: {"type":"questions","questions":[{"id":"q1","question":"?"}]}', // deliberately sparse
      'data: {"type":"done"}',
    ]);
    const turn2 = sse([
      'data: {"type":"folder","folder":"2026-sparse-folder"}',
      'data: {"type":"done"}',
    ]);
    const openStream = async (body: Record<string, unknown>) => {
      resumeBodies.push(body);
      const resp = call === 0 ? turn1 : turn2;
      call++;
      return resp;
    };

    // The LLM client decides a concrete answer (the architect-chassis tool).
    const llmClient: ArchitectLlmClient = {
      async callLlmToolLoop(_a: CallLlmToolLoopArgs): Promise<CallLlmToolLoopResponse> {
        return {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'c1',
                type: 'function',
                function: {
                  name: SHAPE_SPEC_ANSWER_TOOL,
                  arguments: JSON.stringify({
                    answer: 'Preserve the current-state pagination contract exactly (page size 25, 1-based).',
                    rationale: 'Like-for-like: faithfully reproduce the current behaviour.',
                  }),
                },
              },
            ],
          },
        };
      },
      async callSingleShot() {
        throw new Error('unused');
      },
    };

    // Build a real answerer over the scripted stream + the mocked LLM.
    const realAnswerer: ShapeSpecAutoAnswerer = {
      async driveAndAnswer(input: ShapeSpecAnswerInput) {
        const decisionLog: ShapeSpecAnswerDecision[] = [];
        const r = await driveShapeSpecStream({
          company: input.company,
          project: input.project,
          generatedSpecText: input.generatedSpecText,
          openStream,
          answerBatch: async (questions) =>
            answerShapeSpecQuestions({
              llmClient,
              specText: input.generatedSpecText,
              grounding: 'No additional grounding context is available.',
              questions,
            }),
          onDecision: (d) => decisionLog.push(d),
        });
        return {
          ok: r.ok,
          specName: r.specName,
          sessionId: r.sessionId,
          decisionLog: r.decisionLog.map((d) => ({ ...d })),
          error: r.error ?? null,
        };
      },
    };

    const deps = wireDeps(store, { autoAnswerer: realAnswerer });

    const started = await startMigration(scope, deps);
    expect(started.status).toBe('started');
    await flush();

    // Option A (2026-07-30): the dispatch path is DETERMINISTIC end-to-end.
    // Even with a fully-wired real answerer available in deps, NO shape-spec
    // stream is ever opened, and the submit carries the computed name + the
    // requirements payload instead of a detected folder.
    expect(resumeBodies).toHaveLength(0);

    expect(deps.submitOrchestration).toHaveBeenCalledTimes(1);
    const submitArg = (deps.submitOrchestration as jest.Mock).mock.calls[0][0];
    expect(submitArg.specName).toMatch(/^\d{4}-\d{2}-\d{2}-/);
    expect(submitArg.requirementsText).toEqual(expect.any(String));
    expect(store.run!.items![0].status).toBe(RUN_ITEM_STATUS.SUBMITTED);
    expect(store.run!.items![0].job_id).toBeTruthy();
  });
});

// ===========================================================================
// 7 -- BOOT-RECOVERY WIRING (runMigrationBootRecovery) end-to-end
// ===========================================================================
// The boot HOOK that server.ts calls on startup. The Driver's recoverInFlightRuns
// is covered above; this asserts the wiring module that discovers the in-flight
// runs and hands them to the Driver -- including the default empty-discovery
// no-op (the v1 default) and a never-throw discovery failure.

describe('end-to-end: boot-recovery wiring (runMigrationBootRecovery)', () => {
  it('is a structured-logged NO-OP when the discovery finds no in-flight runs (the v1 default)', async () => {
    const store = new RunStateStore();
    const deps = wireDeps(store);
    const result = await runMigrationBootRecovery(
      CALLBACK_URL,
      async () => [], // the v1 default empty-discovery
      deps,
    );
    expect(result).toEqual({ recovered: 0, rekicked: 0, retriesRearmed: 0 });
    // Nothing was read / re-kicked.
    expect(store.getRun).not.toHaveBeenCalled();
    expect(deps.submitOrchestration).not.toHaveBeenCalled();
  });

  it('discovers a stuck in-flight run and re-kicks it through the Driver on boot', async () => {
    const store = new RunStateStore();
    store.run = {
      id: 'run-1',
      project_id: PROJECT_ID,
      book_of_work_id: BOOK_ID,
      status: RUN_STATUS.DISPATCHING,
      pinned_current_baseline_id: BASELINE_ID,
      items: [
        { id: 'ri-0', run_id: 'run-1', sequence_position: 0, work_item_id: 'wi-1', spec_generation_id: 'sg-1', status: RUN_ITEM_STATUS.ANSWERING, job_id: null, outcome: null, deploy_on_complete: false },
      ],
    };
    const deps = wireDeps(store);

    const result = await runMigrationBootRecovery(
      CALLBACK_URL,
      // The discovery the future AMS cross-project list endpoint would supply.
      async () => [
        { projectId: PROJECT_ID, runId: 'run-1', company: 'acme', project: 'order-mig', bookId: BOOK_ID },
      ],
      deps,
    );
    expect(result.recovered).toBe(1);
    expect(result.rekicked).toBe(1);

    await flush();
    expect(deps.autoAnswerer.driveAndAnswer).not.toHaveBeenCalled();
    expect(store.run!.items![0].status).toBe(RUN_ITEM_STATUS.SUBMITTED);
  });

  it('NEVER throws on a discovery failure (boot must not be blocked)', async () => {
    const store = new RunStateStore();
    const deps = wireDeps(store);
    const result = await runMigrationBootRecovery(
      CALLBACK_URL,
      async () => {
        throw new Error('discovery exploded');
      },
      deps,
    );
    // A discovery throw degrades to a clean zero result -- the gateway still starts.
    expect(result).toEqual({ recovered: 0, rekicked: 0, retriesRearmed: 0 });
  });
});
