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
// Spec 5 (proc behaviour program): the graduated proc-parity gate has its own
// matrix suite; here it is a pass-through so the plane-precedence tests keep
// exercising the data-parity gate alone.
jest.mock('../services/migrationProcParityGate', () => ({
  evaluateProcParityReadiness: jest.fn().mockResolvedValue({
    ok: true, reasons: [], warnings: [], counts: {}, findings: [], states: [],
  }),
}));

import {
  evaluateHardBlock,
  buildOrderedDispatchSet,
  walkBookOfWorkItems,
  startMigration,
  advanceRunOnBuildResult,
  recoverInFlightRuns,
  haltMigrationRunByOperator,
  retryDbPlaneCompletion,
  runSpecSegment,
  deterministicSpecName,
  specNameUniquenessSuffix,
  DispatchDescriptor,
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
    // Carry-over gate reads are FAIL-CLOSED since 2026-08-07 (an unreadable
    // accounting blocks the start), so the mock surface must resolve — empty
    // inputs are the honest "nothing to account for" state.
    carryOverCoverageReads: {
      fetchCapabilitiesForArchitecture: jest.fn().mockResolvedValue([]),
      fetchFindingsForRun: jest.fn().mockResolvedValue([]),
      fetchDiscoveryRunsForArchitecture: jest.fn().mockResolvedValue([]),
    },
    // Plane-aware precedence source (2026-08-07): empty history by default.
    fetchMigrationExecutionRunsForBook: jest.fn().mockResolvedValue([]),
    // Chain-base resolution is FAIL-CLOSED since 2026-08-07 (an unreadable
    // prior run blocks a chained start), so the mock must resolve — null =
    // no prior run (default-branch base).
    fetchLatestMigrationExecutionRunForBook: jest.fn().mockResolvedValue(null),
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

  it('spec-gates STORY nodes ONLY (2026-07-27): saved epics/features (workItemId via the ancestor-chain save) and spec-less TEST siblings never block', () => {
    // Save-to-backlog stamps workItemIds on the WHOLE chain — the epic and
    // feature here carry them, and NONE of these non-story nodes has a spec
    // (spec generation only targets type='story'). Pre-fix they were all
    // "not spec-ready" forever — refusing a start the plan screen's card
    // (stories-only) showed as clear.
    const items = [
      { id: 'e1', parentId: null, type: 'epic', title: 'DB epic', sequenceOrder: 0, workItemId: 'wi-epic' },
      { id: 'f1', parentId: 'e1', type: 'feature', title: 'DB feature', sequenceOrder: 0, workItemId: 'wi-feat' },
      { id: 's1', parentId: 'f1', type: 'story', title: 'Schema story', sequenceOrder: 0, workItemId: 'wi-1' },
      { id: 't1', parentId: 'f1', type: 'TEST', title: 'E2E TEST', sequenceOrder: 1, workItemId: 'wi-test-nospec' },
    ];
    const result = evaluateHardBlock({
      items,
      specGens: [readySpec('wi-1', 'x', 'sg-1')],
      deferredWorkItemIds: new Set(),
      hasActiveCurrentBaseline: true,
    });
    expect(result.ok).toBe(true);
    expect(result.reasons).toHaveLength(0);

    // …while a genuinely spec-less STORY still refuses, and the message
    // disambiguates the table's 'ready_for_spec' READINESS badge from the
    // GENERATED spec the gate needs.
    const withUnspecced = evaluateHardBlock({
      items: [
        ...items,
        { id: 's2', parentId: 'f1', type: 'story', title: 'Unspecced story', sequenceOrder: 2, workItemId: 'wi-2' },
      ],
      specGens: [readySpec('wi-1', 'x', 'sg-1')],
      deferredWorkItemIds: new Set(),
      hasActiveCurrentBaseline: true,
    });
    expect(withUnspecced.ok).toBe(false);
    const reason = withUnspecced.reasons.find((r) => r.code === 'story_not_spec_ready');
    expect(reason?.workItemId).toBe('wi-2');
    expect(reason?.message).toContain('no implementation spec has been generated');
    expect(reason?.message).toContain("'ready_for_spec' badge");
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

  // -------------------------------------------------------------------------
  // Per-plane starts (2026-07-26, user ruling: "Start stage 1 starts the DB
  // plane ONLY"). Plane scope resolves onto the subset machinery; the baseline
  // + carry-over dimensions apply only to service-containing scopes; a
  // non-first plane requires the preceding plane's run DEPLOYED + clean DB
  // data parity (break-glass recorded).
  // -------------------------------------------------------------------------

  function planedBook(): BookOfWork {
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
    };
  }
  const planedWorkItems = [
    { id: 'wi-db', type: 'STORY', deferred: false },
    { id: 'wi-svc', type: 'STORY', deferred: false },
  ];

  it('plane=db starts with ONLY the db stories — an unspecced service story and a missing baseline do NOT block', async () => {
    const deps = mockDeps({
      fetchBookOfWork: jest.fn().mockResolvedValue(planedBook()),
      // ONLY the db story is specced; the service story would block a
      // whole-book start.
      fetchSpecGenerationsForBook: jest.fn().mockResolvedValue([readySpec('wi-db', 'db spec', 'sg-db')]),
      fetchWorkItems: jest.fn().mockResolvedValue(planedWorkItems),
      // No API baseline — irrelevant to a DB-plane run (no API reconcile).
      fetchActiveCurrentBaseline: jest.fn().mockResolvedValue(null),
    });
    const result = await startMigration({ ...scope, plane: 'db' }, deps);
    expect(result.status).toBe('started');
    const createArg = (deps.createMigrationExecutionRun as jest.Mock).mock.calls[0][1];
    expect(createArg.items.map((i: MigrationExecutionRunItem) => i.work_item_id)).toEqual(['wi-db']);
  });

  it('plane=db does NOT sweep saved structural nodes into the spec gate (2026-07-27: the "19 not-spec-ready vs ready_for_spec" bug)', async () => {
    // The user's fully-saved book: the DB epic + feature carry workItemIds
    // (ancestor-chain save) and DB workstreams; a DB TEST sibling and a
    // data-parity story ride along. Pre-fix, plane=db selected ALL of them
    // (any workItemId), demanded specs they can never have, and refused a
    // start the plan screen's stories-only card showed as clear — while the
    // parity story sat on the FE's DB card but the server ran it in the
    // SERVICE phase (vocab drift).
    const bookWithStructure: BookOfWork = {
      id: BOOK_ID,
      project_id: PROJECT_ID,
      current_architecture_id: 'arch-1',
      status: 'draft',
      book_of_work_json: {
        items: [
          { id: 'e-db', parentId: null, type: 'epic', title: 'DB epic', sequenceOrder: 0, workItemId: 'wi-epic', workstream: 'target_database_schema_implementation' },
          { id: 'b-db', parentId: 'e-db', type: 'story', title: 'Schema', sequenceOrder: 1, workItemId: 'wi-db', workstream: 'target_database_schema_implementation' },
          { id: 'b-parity', parentId: 'e-db', type: 'story', title: 'Parity report', sequenceOrder: 2, workItemId: 'wi-parity', workstream: 'data_parity_reconciliation_reporting' },
          { id: 't-db', parentId: 'e-db', type: 'TEST', title: 'DB E2E', sequenceOrder: 3, workItemId: 'wi-test', workstream: 'target_database_schema_implementation' },
          { id: 'b-svc', parentId: null, type: 'story', title: 'API', sequenceOrder: 4, workItemId: 'wi-svc', workstream: 'api_migration' },
        ],
      },
    };
    const deps = mockDeps({
      fetchBookOfWork: jest.fn().mockResolvedValue(bookWithStructure),
      // Both DB-plane STORIES specced; the epic + TEST have none (they never
      // can); the service story is unspecced and out of scope.
      fetchSpecGenerationsForBook: jest.fn().mockResolvedValue([
        readySpec('wi-db', 'db spec', 'sg-db'),
        readySpec('wi-parity', 'parity spec', 'sg-parity'),
      ]),
      fetchWorkItems: jest.fn().mockResolvedValue([
        { id: 'wi-epic', type: 'EPIC', deferred: false },
        { id: 'wi-db', type: 'STORY', deferred: false },
        { id: 'wi-parity', type: 'STORY', deferred: false },
        { id: 'wi-test', type: 'TEST', deferred: false },
        { id: 'wi-svc', type: 'STORY', deferred: false },
      ]),
      fetchActiveCurrentBaseline: jest.fn().mockResolvedValue(null),
    });
    const result = await startMigration({ ...scope, plane: 'db' }, deps);
    expect(result.status).toBe('started');
    const createArg = (deps.createMigrationExecutionRun as jest.Mock).mock.calls[0][1];
    const dispatched = createArg.items.map((i: MigrationExecutionRunItem) => i.work_item_id);
    // The data-parity story is DB-plane work (vocab now matches the FE card);
    // the spec-less TEST is skipped by dispatch (pre-existing CD-5); the epic
    // never dispatches; the service story stays out of a db run.
    expect(dispatched).toEqual(expect.arrayContaining(['wi-db', 'wi-parity']));
    expect(dispatched).not.toEqual(expect.arrayContaining(['wi-epic']));
    expect(dispatched).not.toEqual(expect.arrayContaining(['wi-svc']));
  });

  it('plane=service is BLOCKED with preceding_plane_not_deployed until the db plane run is deployed', async () => {
    const deps = mockDeps({
      fetchBookOfWork: jest.fn().mockResolvedValue(planedBook()),
      fetchSpecGenerationsForBook: jest.fn().mockResolvedValue([
        readySpec('wi-db', 'db spec', 'sg-db'),
        readySpec('wi-svc', 'svc spec', 'sg-svc'),
      ]),
      fetchWorkItems: jest.fn().mockResolvedValue(planedWorkItems),
      fetchLatestMigrationExecutionRunForBook: jest.fn().mockResolvedValue(null),
    });
    const result = await startMigration({ ...scope, plane: 'service' }, deps);
    expect(result.status).toBe('blocked');
    if (result.status === 'blocked') {
      expect(result.reasons.some((r) => r.code === 'preceding_plane_not_deployed')).toBe(true);
    }
    expect(deps.createMigrationExecutionRun).not.toHaveBeenCalled();
  });

  it('plane=service with the db run deployed is BLOCKED by unclean data parity; parityOverride starts + RECORDS the override', async () => {
    const base = {
      fetchBookOfWork: jest.fn().mockResolvedValue(planedBook()),
      fetchSpecGenerationsForBook: jest.fn().mockResolvedValue([
        readySpec('wi-db', 'db spec', 'sg-db'),
        readySpec('wi-svc', 'svc spec', 'sg-svc'),
      ]),
      fetchWorkItems: jest.fn().mockResolvedValue(planedWorkItems),
      fetchLatestMigrationExecutionRunForBook: jest
        .fn()
        .mockResolvedValue({ id: 'run-db', status: 'deployed' }),
      // Plane-aware precedence (2026-08-07): the deployed db-plane run must
      // appear in the book's run HISTORY with items mapping to the db plane.
      fetchMigrationExecutionRunsForBook: jest.fn().mockResolvedValue([
        { id: 'run-db', status: 'deployed', items: [{ work_item_id: 'wi-db' }] },
      ]),
      // No parity report exists -> data_parity_unverified (fail-closed).
      dataParityGateReads: {
        fetchLatestDataParityReport: jest.fn().mockResolvedValue(null),
        fetchWaivers: jest.fn().mockResolvedValue([]),
      },
    };

    const blockedDeps = mockDeps(base as Partial<MigrationDriverDeps>);
    const blocked = await startMigration({ ...scope, plane: 'service' }, blockedDeps);
    expect(blocked.status).toBe('blocked');
    if (blocked.status === 'blocked') {
      expect(blocked.reasons.every((r) => r.code.startsWith('data_parity_'))).toBe(true);
    }

    const overrideDeps = mockDeps(base as Partial<MigrationDriverDeps>);
    const started = await startMigration(
      { ...scope, plane: 'service', parityOverride: true },
      overrideDeps,
    );
    expect(started.status).toBe('started');
    // The break-glass is frozen onto the NEW run's decision log.
    const recorded = (overrideDeps.patchMigrationExecutionRun as jest.Mock).mock.calls.find(
      (c) =>
        Array.isArray(c[2]?.decision_log_json) &&
        c[2].decision_log_json.some(
          (e: { type?: string }) => e.type === 'data_parity_override',
        ),
    );
    expect(recorded).toBeTruthy();
  });

  it('plane with no stories -> honest error, no run', async () => {
    const deps = mockDeps({
      fetchBookOfWork: jest.fn().mockResolvedValue(planedBook()),
      fetchWorkItems: jest.fn().mockResolvedValue(planedWorkItems),
    });
    const result = await startMigration({ ...scope, plane: 'ui' }, deps);
    expect(result.status).toBe('error');
    expect(deps.createMigrationExecutionRun).not.toHaveBeenCalled();
  });

  it('per-spec dispatch is DETERMINISTIC (Option A, 2026-07-30): no shaping turn — computed spec_name + requirements payload + callback_url, deploy_on_complete=false on the first spec', async () => {
    const deps = mockDeps();
    await startMigration(scope, deps);
    await flush();

    // NO headless shaping turn any more — the three intermittent-halt seams
    // (wrong-path requirements.md, placeholder folder echo, cross-wired
    // folder detection) are structurally gone.
    expect(deps.autoAnswerer.driveAndAnswer).not.toHaveBeenCalled();

    // The submit carries the materialisation payload + a computed name from
    // the book-item title ("Story 1"), plus callback_url and
    // deploy_on_complete=false (first spec). Step 4 runs on the final spec
    // only (commitPreparation false here).
    const submitArg = (deps.submitOrchestration as jest.Mock).mock.calls[0][0];
    expect(submitArg.callbackUrl).toBe('http://gw/api/implementation/build-results');
    expect(submitArg.deployOnComplete).toBe(false);
    expect(submitArg.commitPreparation).toBe(false);
    // 2026-07-31: the per-item uniqueness suffix rides the computed name —
    // same-titled book items must resolve to distinct folders/branches.
    expect(submitArg.specName).toMatch(/^\d{4}-\d{2}-\d{2}-story-1-[a-z0-9]+$/);
    expect(submitArg.requirementsText).toContain('Story 1 body');

    // The computed spec_name was stamped onto the run-item at SUBMITTING.
    const patchedName = (deps.patchMigrationExecutionRunItem as jest.Mock).mock.calls.find(
      (c) => c[2] && typeof c[2].spec_name === 'string'
    );
    expect(patchedName[2].spec_name).toMatch(/-story-1-[a-z0-9]+$/);

    // The job_id was recorded on the run-item (dispatched=true + job_id).
    const patchedJob = (deps.patchMigrationExecutionRunItem as jest.Mock).mock.calls.find(
      (c) => c[2] && c[2].job_id === 'job-1'
    );
    expect(patchedJob).toBeTruthy();
    expect(patchedJob[2].dispatched).toBe(true);
  });

  it('NORMALISES the workspace identifiers at entry (2026-07-27): raw display names never reach the IVS-facing calls', async () => {
    // The live bug: the plan screen passes display names ("Example Corp" /
    // "Demo Migration"), but the IVS workspace is addressed by the normalised
    // form ("example-corp/demo-migration") — every OTHER surface (project init,
    // repo CRUD, browser shape-spec, orchestration) normalises first, so the
    // raw names 400'd at the IVS precondition gate even after a correct init.
    const deps = mockDeps();
    const result = await startMigration(
      { ...scope, company: '  Example   Corp ', project: 'Demo Migration' },
      deps
    );
    expect(result.status).toBe('started');
    await flush();

    const submitArg = (deps.submitOrchestration as jest.Mock).mock.calls[0][0];
    expect(submitArg.company).toBe('example-corp');
    expect(submitArg.project).toBe('demo-migration');
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

  it('failed AFTER push + MR -> the delivered branch and pr_url are recorded on the run-item before the halt (2026-09-05)', async () => {
    const run = runWithItems();
    const deps = mockDeps({
      findMigrationRunItemByJobId: jest.fn().mockResolvedValue(run.items![0]),
      getMigrationExecutionRun: jest.fn().mockResolvedValue(run),
    });
    const decision = await advanceRunOnBuildResult(
      {
        company: 'acme', project: 'order-mig', jobId: 'job-1', outcome: 'error', summary: 'deploy failed: no container runtime',
        prUrl: 'http://pr/69', branch: 'feature/2026-09-05-scaffold--svc',
      },
      deps,
    );
    expect(decision).toBe('halted');
    const patches = (deps.patchMigrationExecutionRunItem as jest.Mock).mock.calls
      .filter((c) => c[1] === 'ri-0')
      .map((c) => c[2]);
    // The pointers are recorded (a fact about delivery) ...
    expect(patches.some((p) => p.pr_url === 'http://pr/69' && p.branch === 'feature/2026-09-05-scaffold--svc')).toBe(true);
    // ... AND the failure is still recorded and the run halted.
    expect(patches.some((p) => p.status === RUN_ITEM_STATUS.FAILED && String(p.error_detail).includes('deploy failed'))).toBe(true);
    expect((deps.patchMigrationExecutionRun as jest.Mock).mock.calls.some((c) => c[2].status === RUN_STATUS.HALTED)).toBe(true);
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

    // The stuck spec was re-dispatched DETERMINISTICALLY (Option A): straight
    // to submit with the materialisation payload — no shaping turn.
    await flush();
    expect(deps.autoAnswerer.driveAndAnswer).not.toHaveBeenCalled();
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

// ===========================================================================
// Operator halt (abandon a stranded run, 2026-07-28)
// ===========================================================================

describe('haltMigrationRunByOperator', () => {
  it('marks non-terminal items failed and halts a wedged run', async () => {
    // The live shape: submit 200''d, the IVS job died pre-pipeline, no failure
    // callback ever arrived -- the run sat dispatching/submitted forever.
    const wedged: MigrationExecutionRun = {
      id: 'run-9',
      project_id: PROJECT_ID,
      status: RUN_STATUS.DISPATCHING,
      items: [
        { id: 'ri-0', status: RUN_ITEM_STATUS.SUBMITTED, job_id: 'job-dead' },
        { id: 'ri-1', status: RUN_ITEM_STATUS.PENDING },
        { id: 'ri-2', status: RUN_ITEM_STATUS.IMPLEMENTED },
      ],
    };
    const deps = mockDeps({
      getMigrationExecutionRun: jest.fn().mockResolvedValue(wedged),
    });

    const result = await haltMigrationRunByOperator(
      PROJECT_ID, 'run-9', deps, 'stuck after dead IVS job'
    );

    expect(result).toEqual({ status: 'halted', runId: 'run-9', itemsFailed: 2 });
    // Only the two NON-terminal items are failed; the implemented one is kept.
    expect(deps.patchMigrationExecutionRunItem).toHaveBeenCalledTimes(2);
    expect(deps.patchMigrationExecutionRunItem).toHaveBeenCalledWith(
      PROJECT_ID,
      'ri-0',
      expect.objectContaining({
        status: RUN_ITEM_STATUS.FAILED,
        outcome: 'failed',
        error_detail: expect.stringContaining('stuck after dead IVS job'),
      })
    );
    expect(deps.patchMigrationExecutionRun).toHaveBeenCalledWith(
      PROJECT_ID, 'run-9', { status: RUN_STATUS.HALTED }
    );
  });

  it('reports an already-terminal run without re-patching it', async () => {
    const deps = mockDeps({
      getMigrationExecutionRun: jest.fn().mockResolvedValue({
        id: 'run-9', project_id: PROJECT_ID, status: RUN_STATUS.HALTED, items: [],
      }),
    });

    const result = await haltMigrationRunByOperator(PROJECT_ID, 'run-9', deps);

    expect(result).toEqual({
      status: 'already_terminal', runId: 'run-9', runStatus: RUN_STATUS.HALTED,
    });
    expect(deps.patchMigrationExecutionRun).not.toHaveBeenCalled();
    expect(deps.patchMigrationExecutionRunItem).not.toHaveBeenCalled();
  });

  it('reports not_found for a missing run', async () => {
    const deps = mockDeps({
      getMigrationExecutionRun: jest.fn().mockResolvedValue(null),
    });
    expect(await haltMigrationRunByOperator(PROJECT_ID, 'nope', deps)).toEqual({
      status: 'not_found',
    });
  });
});

// ===========================================================================
// Spec-name uniqueness suffix (2026-07-31): same-titled book items must get
// distinct folders/branches; the same item retried must reuse its name.
// ===========================================================================

describe('deterministicSpecName + specNameUniquenessSuffix', () => {
  const when = new Date('2026-07-31T12:00:00Z');

  it('same title, different work items -> DISTINCT names', () => {
    const a = deterministicSpecName('migration spec', when, {
      workItemId: '01234567-89ab-cdef-0123-456789abcdef', sequencePosition: 0,
    });
    const b = deterministicSpecName('migration spec', when, {
      workItemId: 'fedcba98-7654-3210-fedc-ba9876543210', sequencePosition: 1,
    });
    expect(a).toMatch(/^2026-07-31-migration-spec-[a-z0-9]{8}$/);
    expect(b).toMatch(/^2026-07-31-migration-spec-[a-z0-9]{8}$/);
    expect(a).not.toBe(b);
  });

  it('same item retried -> IDENTICAL name (stable across re-dispatch)', () => {
    const d = { workItemId: '01234567-89ab-cdef-0123-456789abcdef', sequencePosition: 3 };
    expect(deterministicSpecName('Schema', when, d)).toBe(
      deterministicSpecName('Schema', when, d)
    );
  });

  it('prefers workItemId, then specGenerationId, then bookItemId', () => {
    expect(specNameUniquenessSuffix({
      workItemId: 'aaaaaaaa-1111', specGenerationId: 'bbbbbbbb-2222', bookItemId: 'cccccccc-3333',
    })).toBe(specNameUniquenessSuffix({ workItemId: 'aaaaaaaa-1111' }));
    expect(specNameUniquenessSuffix({
      workItemId: null, specGenerationId: 'bbbbbbbb-2222', bookItemId: 'cccccccc-3333',
    })).toBe(specNameUniquenessSuffix({ specGenerationId: 'bbbbbbbb-2222' }));
    expect(specNameUniquenessSuffix({
      workItemId: null, specGenerationId: null, bookItemId: 'cccccccc-3333',
    })).toBe(specNameUniquenessSuffix({ bookItemId: 'cccccccc-3333' }));
  });

  it('falls back to p<sequencePosition> when no id is stable enough', () => {
    expect(specNameUniquenessSuffix({ sequencePosition: 7 })).toBe('p7');
    // short ids (< 4 alphanumerics) are not unique enough — positional wins
    expect(specNameUniquenessSuffix({ workItemId: 'wi1', sequencePosition: 2 })).toBe('p2');
  });

  it('without a descriptor the legacy <date>-<slug> shape is unchanged', () => {
    expect(deterministicSpecName('Story 1', when)).toBe('2026-07-31-story-1');
  });
});

// ===========================================================================
// runSpecSegment dispatch idempotency (2026-07-31): a duplicated kick must
// not submit a second IVS job; the boot-recovery re-kick state stays kickable.
// ===========================================================================

describe('runSpecSegment dispatch idempotency', () => {
  const segmentRun = { id: 'run-1', status: 'dispatching' } as MigrationExecutionRun;
  const baseItem = {
    id: 'ri-0', run_id: 'run-1', sequence_position: 0,
    work_item_id: 'wi-1', status: RUN_ITEM_STATUS.PENDING,
  } as MigrationExecutionRunItem;
  const descriptor: DispatchDescriptor = {
    sequencePosition: 0,
    workItemId: 'wi-1-aaaa-bbbb',
    specGenerationId: 'sg-1',
    bookItemId: 's1',
    generatedSpecText: 'Story 1 body',
    title: 'Story 1',
    deployOnComplete: false,
  };

  function depsSeeingFreshItem(fresh: Partial<MigrationExecutionRunItem>): MigrationDriverDeps {
    return mockDeps({
      getMigrationExecutionRun: jest.fn().mockResolvedValue({
        ...segmentRun, items: [{ ...baseItem, ...fresh }],
      }),
    });
  }

  it.each([
    ['a job_id is already recorded', { job_id: 'job-existing' }],
    ['status is SUBMITTED', { status: RUN_ITEM_STATUS.SUBMITTED }],
    ['status is IMPLEMENTED', { status: RUN_ITEM_STATUS.IMPLEMENTED }],
    ['status is DEPLOYED', { status: RUN_ITEM_STATUS.DEPLOYED }],
    ['a terminal outcome is recorded', { outcome: 'failed' }],
  ])('no-ops when %s (no second submit, no patches)', async (_label, fresh) => {
    const deps = depsSeeingFreshItem(fresh as Partial<MigrationExecutionRunItem>);
    await runSpecSegment(scope, segmentRun, baseItem, descriptor, deps);
    expect(deps.submitOrchestration).not.toHaveBeenCalled();
    expect(deps.patchMigrationExecutionRunItem).not.toHaveBeenCalled();
  });

  it('does NOT skip submitting-with-no-job_id — the boot-recovery re-kick state', async () => {
    const deps = depsSeeingFreshItem({ status: RUN_ITEM_STATUS.SUBMITTING });
    await runSpecSegment(scope, segmentRun, baseItem, descriptor, deps);
    expect(deps.submitOrchestration).toHaveBeenCalledTimes(1);
  });

  it('dispatches when the pre-read fails (never stall on a read hiccup)', async () => {
    const deps = mockDeps({
      getMigrationExecutionRun: jest.fn().mockRejectedValue(new Error('AMS down')),
    });
    await runSpecSegment(scope, segmentRun, baseItem, descriptor, deps);
    expect(deps.submitOrchestration).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// WS2 (2026-07-31): DB-plane completion handover — `implemented` on the
// plane-final db item starts the DB execution chain (assemble/apply/load/
// reconcile) instead of expecting a haibox `deployed` that can never come.
// ===========================================================================

describe('DB-plane completion handover', () => {
  const dbBook: BookOfWork = {
    id: BOOK_ID,
    project_id: PROJECT_ID,
    current_architecture_id: 'arch-1',
    status: 'draft',
    book_of_work_json: {
      items: [
        { id: 'b-db', parentId: null, type: 'story', title: 'Schema', sequenceOrder: 0, workItemId: 'wi-db', workstream: 'target_database_schema_implementation' },
      ],
    },
  };

  function dbRun(): MigrationExecutionRun {
    return {
      id: 'run-db',
      project_id: PROJECT_ID,
      book_of_work_id: BOOK_ID,
      status: RUN_STATUS.DISPATCHING,
      items: [
        {
          id: 'ri-0', run_id: 'run-db', sequence_position: 0, work_item_id: 'wi-db',
          spec_generation_id: 'sg-db', status: RUN_ITEM_STATUS.SUBMITTED,
          job_id: 'job-9', spec_name: '2026-07-31-schema-x', deploy_on_complete: true,
        },
      ],
    };
  }

  it('implemented on the db-plane final item starts the chain (no dispatch-next)', async () => {
    const run = dbRun();
    const chain = jest.fn().mockResolvedValue(undefined);
    const deps = mockDeps({
      findMigrationRunItemByJobId: jest.fn().mockResolvedValue(run.items![0]),
      getMigrationExecutionRun: jest.fn().mockResolvedValue(run),
      fetchBookOfWork: jest.fn().mockResolvedValue(dbBook),
      runDbPlaneCompletion: chain,
    });

    const decision = await advanceRunOnBuildResult(
      { company: 'acme', project: 'order-mig', jobId: 'job-9', outcome: 'implemented' },
      deps
    );

    expect(decision).toBe('db_completion_chain_started');
    await flush();
    expect(chain).toHaveBeenCalledTimes(1);
    expect(deps.submitOrchestration).not.toHaveBeenCalled();
  });

  it('implemented on a SERVICE-plane final item does NOT start the chain', async () => {
    // twoStoryBook items carry no workstream -> plane resolves to `service`.
    const run: MigrationExecutionRun = {
      id: 'run-svc', project_id: PROJECT_ID, book_of_work_id: BOOK_ID,
      status: RUN_STATUS.DISPATCHING,
      items: [{
        id: 'ri-0', run_id: 'run-svc', sequence_position: 0, work_item_id: 'wi-1',
        spec_generation_id: 'sg-1', status: RUN_ITEM_STATUS.SUBMITTED,
        job_id: 'job-1', deploy_on_complete: true,
      }],
    };
    const chain = jest.fn().mockResolvedValue(undefined);
    const deps = mockDeps({
      findMigrationRunItemByJobId: jest.fn().mockResolvedValue(run.items![0]),
      getMigrationExecutionRun: jest.fn().mockResolvedValue(run),
      runDbPlaneCompletion: chain,
    });

    const decision = await advanceRunOnBuildResult(
      { company: 'acme', project: 'order-mig', jobId: 'job-1', outcome: 'implemented' },
      deps
    );

    expect(decision).toBe('advanced_run_complete');
    expect(chain).not.toHaveBeenCalled();
  });

  it('runSpecSegment decouples the haibox flag: db-plane final item submits deployOnComplete=false', async () => {
    const item: MigrationExecutionRunItem = {
      id: 'ri-0', run_id: 'run-db', sequence_position: 0, work_item_id: 'wi-db',
      status: RUN_ITEM_STATUS.PENDING, deploy_on_complete: true,
    };
    const run: MigrationExecutionRun = {
      id: 'run-db', project_id: PROJECT_ID, status: RUN_STATUS.DISPATCHING, items: [item],
    };
    const descriptor: DispatchDescriptor = {
      sequencePosition: 0, workItemId: 'wi-db-aaaa-bbbb', specGenerationId: 'sg-db',
      bookItemId: 'b-db', generatedSpecText: 'Schema body', title: 'Schema',
      deployOnComplete: true, workstream: 'target_database_schema_implementation',
      plane: 'db',
    };
    const deps = mockDeps({
      getMigrationExecutionRun: jest.fn().mockResolvedValue(run),
    });

    await runSpecSegment(scope, run, item, descriptor, deps);

    const submitArg = (deps.submitOrchestration as jest.Mock).mock.calls[0][0];
    expect(submitArg.deployOnComplete).toBe(false);
    // Step 4 (/git-commit-preparation) still runs on the final spec.
    expect(submitArg.commitPreparation).toBe(true);
  });

  it('runSpecSegment keeps deployOnComplete=true for a service-plane final item', async () => {
    const item: MigrationExecutionRunItem = {
      id: 'ri-0', run_id: 'run-svc', sequence_position: 0, work_item_id: 'wi-1',
      status: RUN_ITEM_STATUS.PENDING, deploy_on_complete: true,
    };
    const run: MigrationExecutionRun = {
      id: 'run-svc', project_id: PROJECT_ID, status: RUN_STATUS.DISPATCHING, items: [item],
    };
    const descriptor: DispatchDescriptor = {
      sequencePosition: 0, workItemId: 'wi-1-aaaa-bbbb', specGenerationId: 'sg-1',
      bookItemId: 's1', generatedSpecText: 'API body', title: 'API',
      deployOnComplete: true, workstream: 'api_migration', plane: 'service',
    };
    const deps = mockDeps({
      getMigrationExecutionRun: jest.fn().mockResolvedValue(run),
      // A service-plane final item needs a registered serve spec since the
      // 2026-08-07 halt-on-missing hardening.
      getTargetServeSpec: jest.fn().mockReturnValue({
        command: 'mvn spring-boot:run',
        healthPath: '/actuator/health',
      }),
    });

    await runSpecSegment(scope, run, item, descriptor, deps);

    const submitArg = (deps.submitOrchestration as jest.Mock).mock.calls[0][0];
    expect(submitArg.deployOnComplete).toBe(true);
  });
});

// ===========================================================================
// Stage-2 (2026-07-31): the service plane serve spec rides the submit so
// haibox can actually launch the migrated service.
// ===========================================================================

describe('endpoint-free service plane (2026-09-05): no deploy requested, plane completes without a reconcile', () => {
  function scaffoldBook(withEndpointSibling: boolean): BookOfWork {
    return {
      ...twoStoryBook(),
      book_of_work_json: {
        ...twoStoryBook().book_of_work_json,
        items: [
          { id: 'f1', parentId: null, type: 'feature', title: 'Feature 1', sequenceOrder: 0 },
          { id: 's-scaffold', parentId: 'f1', type: 'story', title: 'Scaffold', sequenceOrder: 0, workItemId: 'wi-scaffold', workstream: 'api_migration', apiEndpointIds: [] },
          {
            id: 's-api', parentId: 'f1', type: 'story', title: 'API', sequenceOrder: 1, workItemId: 'wi-api', workstream: 'api_migration',
            apiEndpointIds: withEndpointSibling ? ['ep-1'] : [],
          },
        ],
      },
    } as unknown as BookOfWork;
  }
  const finalItem: MigrationExecutionRunItem = {
    id: 'ri-1', run_id: 'run-svc', sequence_position: 1, work_item_id: 'wi-api',
    status: RUN_ITEM_STATUS.PENDING, deploy_on_complete: true,
  };
  const runOf = (extra: Partial<MigrationExecutionRunItem>[] = []): MigrationExecutionRun => ({
    id: 'run-svc', project_id: PROJECT_ID, book_of_work_id: BOOK_ID, status: RUN_STATUS.DISPATCHING,
    items: [
      { id: 'ri-0', run_id: 'run-svc', sequence_position: 0, work_item_id: 'wi-scaffold', status: RUN_ITEM_STATUS.IMPLEMENTED, outcome: 'implemented', deploy_on_complete: false },
      finalItem,
      ...(extra as MigrationExecutionRunItem[]),
    ],
  });
  const descriptor: DispatchDescriptor = {
    sequencePosition: 1, workItemId: 'wi-api', specGenerationId: 'sg-1', bookItemId: 's-api',
    generatedSpecText: 'API body', title: 'API', deployOnComplete: true, workstream: 'api_migration',
    plane: 'service', hasEndpointIds: false,
  };

  it('plane-final service item in an endpoint-free plane: submit WITHOUT deploy, no serve spec needed, MR still opened', async () => {
    const getServeSpec = jest.fn();
    const run = runOf();
    const deps = mockDeps({
      fetchBookOfWork: jest.fn().mockResolvedValue(scaffoldBook(false)),
      getMigrationExecutionRun: jest.fn().mockResolvedValue(run),
      getTargetServeSpec: getServeSpec,
    });
    await runSpecSegment(scope, run, finalItem, descriptor, deps);
    expect(deps.submitOrchestration).toHaveBeenCalledTimes(1);
    const submitArg = (deps.submitOrchestration as jest.Mock).mock.calls[0][0];
    expect(submitArg.deployOnComplete).toBe(false);
    expect(submitArg.commitPreparation).toBe(true);
    expect(submitArg.openMergeRequest).toBe(true);
    expect(submitArg.targetServeSpec).toBeUndefined();
    expect(getServeSpec).not.toHaveBeenCalled();
  });

  it('a sibling in the plane WITH endpoints keeps the deploy (and the serve-spec requirement)', async () => {
    const run = runOf();
    const deps = mockDeps({
      fetchBookOfWork: jest.fn().mockResolvedValue(scaffoldBook(true)),
      getMigrationExecutionRun: jest.fn().mockResolvedValue(run),
      getTargetServeSpec: jest.fn().mockReturnValue({ command: 'mvn spring-boot:run', healthPath: '/actuator/health' }),
    });
    await runSpecSegment(scope, run, finalItem, descriptor, deps);
    const submitArg = (deps.submitOrchestration as jest.Mock).mock.calls[0][0];
    expect(submitArg.deployOnComplete).toBe(true);
  });

  it('an UNKNOWN endpoint state (hand-built descriptor without hasEndpointIds) keeps the deploy', async () => {
    const run = runOf();
    const deps = mockDeps({
      fetchBookOfWork: jest.fn().mockResolvedValue(scaffoldBook(false)),
      getMigrationExecutionRun: jest.fn().mockResolvedValue(run),
      getTargetServeSpec: jest.fn().mockReturnValue({ command: 'mvn spring-boot:run', healthPath: '/actuator/health' }),
    });
    const { hasEndpointIds: _omit, ...unknownDescriptor } = descriptor;
    await runSpecSegment(scope, run, finalItem, unknownDescriptor as DispatchDescriptor, deps);
    const submitArg = (deps.submitOrchestration as jest.Mock).mock.calls[0][0];
    expect(submitArg.deployOnComplete).toBe(true);
  });

  it('plane-final service item reports implemented (no deploy): a later plane PAUSES for approval, no reconcile kicked', async () => {
    const submitted = { ...finalItem, status: RUN_ITEM_STATUS.SUBMITTED, job_id: 'job-final' };
    const laterDb: Partial<MigrationExecutionRunItem> = {
      id: 'ri-2', run_id: 'run-svc', sequence_position: 2, work_item_id: 'wi-db', status: RUN_ITEM_STATUS.PENDING, deploy_on_complete: true,
    };
    const run = runOf([laterDb]);
    run.items![1] = submitted;
    const deps = mockDeps({
      fetchBookOfWork: jest.fn().mockResolvedValue(scaffoldBook(false)),
      findMigrationRunItemByJobId: jest.fn().mockResolvedValue(submitted),
      getMigrationExecutionRun: jest.fn().mockResolvedValue(run),
    });
    const decision = await advanceRunOnBuildResult(
      { company: 'acme', project: 'order-mig', jobId: 'job-final', outcome: 'implemented', prUrl: 'http://pr/70' },
      deps,
    );
    expect(decision).toBe('awaiting_approval');
    expect((deps.patchMigrationExecutionRun as jest.Mock).mock.calls.some((c) => c[2].status === RUN_STATUS.AWAITING_APPROVAL)).toBe(true);
    // No reconcile is kicked (mockDeps leaves triggerReconcile undefined; when a
    // harness supplies one it must stay untouched) and nothing new is dispatched.
    if (deps.triggerReconcile) expect(deps.triggerReconcile).not.toHaveBeenCalled();
    expect(deps.submitOrchestration).not.toHaveBeenCalled();
  });

  it('plane-final service item reports implemented (no deploy) on the FINAL plane: run completes, nothing halts', async () => {
    const submitted = { ...finalItem, status: RUN_ITEM_STATUS.SUBMITTED, job_id: 'job-final' };
    const run = runOf();
    run.items![1] = submitted;
    const deps = mockDeps({
      fetchBookOfWork: jest.fn().mockResolvedValue(scaffoldBook(false)),
      findMigrationRunItemByJobId: jest.fn().mockResolvedValue(submitted),
      getMigrationExecutionRun: jest.fn().mockResolvedValue(run),
    });
    const decision = await advanceRunOnBuildResult(
      { company: 'acme', project: 'order-mig', jobId: 'job-final', outcome: 'implemented', prUrl: 'http://pr/70' },
      deps,
    );
    expect(decision).toBe('advanced_run_complete');
    expect((deps.patchMigrationExecutionRun as jest.Mock).mock.calls.some((c) => c[2].status === RUN_STATUS.HALTED)).toBe(false);
    const implPatch = (deps.patchMigrationExecutionRunItem as jest.Mock).mock.calls.find((c) => c[1] === 'ri-1' && c[2].outcome === 'implemented');
    expect(implPatch?.[2].pr_url).toBe('http://pr/70');
  });
});

describe('service-plane serve-spec threading', () => {
  const serveSpec = {
    command: 'mvn spring-boot:run',
    healthPath: '/actuator/health',
    portEnv: 'SERVER_PORT',
  };

  function serviceSegment(getServeSpec: jest.Mock) {
    const item: MigrationExecutionRunItem = {
      id: 'ri-0', run_id: 'run-svc', sequence_position: 0, work_item_id: 'wi-1',
      status: RUN_ITEM_STATUS.PENDING, deploy_on_complete: true,
    };
    const run: MigrationExecutionRun = {
      id: 'run-svc', project_id: PROJECT_ID, status: RUN_STATUS.DISPATCHING, items: [item],
    };
    const descriptor: DispatchDescriptor = {
      sequencePosition: 0, workItemId: 'wi-1-aaaa-bbbb', specGenerationId: 'sg-1',
      bookItemId: 's1', generatedSpecText: 'API body', title: 'API',
      deployOnComplete: true, workstream: 'api_migration', plane: 'service',
    };
    const deps = mockDeps({
      getMigrationExecutionRun: jest.fn().mockResolvedValue(run),
      getTargetServeSpec: getServeSpec,
    });
    return { item, run, descriptor, deps };
  }

  it('attaches the registered serve spec to a service-plane final submit', async () => {
    const { item, run, descriptor, deps } = serviceSegment(
      jest.fn().mockReturnValue(serveSpec)
    );
    await runSpecSegment(scope, run, item, descriptor, deps);
    const submitArg = (deps.submitOrchestration as jest.Mock).mock.calls[0][0];
    expect(submitArg.deployOnComplete).toBe(true);
    expect(submitArg.targetServeSpec).toEqual(serveSpec);
  });

  it('missing serve spec HALTS at dispatch with the remedy — never a silent no-deploy strand (2026-08-07)', async () => {
    const { item, run, descriptor, deps } = serviceSegment(
      jest.fn().mockReturnValue(undefined)
    );
    await runSpecSegment(scope, run, item, descriptor, deps);
    // Nothing dispatched: the plane-final service item cannot deploy/reconcile
    // without the serve spec, so implementing it would strand the run.
    expect(deps.submitOrchestration).not.toHaveBeenCalled();
    const itemPatches = (deps.patchMigrationExecutionRunItem as jest.Mock).mock.calls;
    const failed = itemPatches.find((c) => c[2]?.status === RUN_ITEM_STATUS.FAILED);
    expect(failed).toBeTruthy();
    expect(failed?.[2]?.error_detail).toContain('serve spec');
    expect(failed?.[2]?.error_detail).toContain('Resume failed');
    const runPatches = (deps.patchMigrationExecutionRun as jest.Mock).mock.calls;
    expect(runPatches.some((c) => c[2]?.status === RUN_STATUS.HALTED)).toBe(true);
  });

  it('a db-plane final item never gets a serve spec nor the deploy flag', async () => {
    const getServeSpec = jest.fn().mockReturnValue(serveSpec);
    const item: MigrationExecutionRunItem = {
      id: 'ri-0', run_id: 'run-db', sequence_position: 0, work_item_id: 'wi-db',
      status: RUN_ITEM_STATUS.PENDING, deploy_on_complete: true,
    };
    const run: MigrationExecutionRun = {
      id: 'run-db', project_id: PROJECT_ID, status: RUN_STATUS.DISPATCHING, items: [item],
    };
    const descriptor: DispatchDescriptor = {
      sequencePosition: 0, workItemId: 'wi-db-aaaa', specGenerationId: 'sg-db',
      bookItemId: 'b-db', generatedSpecText: 'Schema body', title: 'Schema',
      deployOnComplete: true, workstream: 'target_database_schema_implementation',
      plane: 'db',
    };
    const deps = mockDeps({
      getMigrationExecutionRun: jest.fn().mockResolvedValue(run),
      getTargetServeSpec: getServeSpec,
    });
    await runSpecSegment(scope, run, item, descriptor, deps);
    const submitArg = (deps.submitOrchestration as jest.Mock).mock.calls[0][0];
    expect(submitArg.deployOnComplete).toBe(false);
    expect(submitArg.targetServeSpec).toBeUndefined();
    expect(getServeSpec).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Operator Retry DB build (2026-07-31): re-run the DB execution chain on a
// halted run whose specs all implemented; never on spec-authoring failures.
// ===========================================================================

describe('retryDbPlaneCompletion', () => {
  const retryBook: BookOfWork = {
    id: BOOK_ID,
    project_id: PROJECT_ID,
    current_architecture_id: 'arch-1',
    status: 'draft',
    book_of_work_json: {
      items: [
        { id: 'b-a', parentId: null, type: 'story', title: 'Schema', sequenceOrder: 0, workItemId: 'wi-a', workstream: 'target_database_schema_implementation' },
        { id: 'b-b', parentId: null, type: 'story', title: 'Parity', sequenceOrder: 1, workItemId: 'wi-b', workstream: 'target_database_schema_implementation' },
      ],
    },
  };

  function haltedRun(finalOverrides: Partial<MigrationExecutionRunItem> = {}): MigrationExecutionRun {
    return {
      id: 'run-h', project_id: PROJECT_ID, book_of_work_id: BOOK_ID,
      status: RUN_STATUS.HALTED,
      items: [
        {
          id: 'ri-0', run_id: 'run-h', sequence_position: 0, work_item_id: 'wi-a',
          status: RUN_ITEM_STATUS.IMPLEMENTED, outcome: 'implemented',
          spec_name: '2026-07-31-schema-x', deploy_on_complete: false,
        },
        {
          id: 'ri-1', run_id: 'run-h', sequence_position: 1, work_item_id: 'wi-b',
          status: RUN_ITEM_STATUS.FAILED, outcome: 'failed',
          spec_name: '2026-07-31-parity-y', deploy_on_complete: true,
          error_detail: 'DB execution chain failed at inputs: source DB credentials are not registered',
          ...finalOverrides,
        },
      ],
    };
  }

  function retryDeps(run: MigrationExecutionRun | null) {
    const chain = jest.fn().mockResolvedValue(undefined);
    const deps = mockDeps({
      getMigrationExecutionRun: jest.fn().mockResolvedValue(run),
      fetchBookOfWork: jest.fn().mockResolvedValue(retryBook),
      runDbPlaneCompletion: chain,
    });
    return { chain, deps };
  }

  it('resets the chain-failed final item and re-kicks the chain', async () => {
    const run = haltedRun();
    const { chain, deps } = retryDeps(run);

    const result = await retryDbPlaneCompletion(scope, 'run-h', deps);

    expect(result).toEqual({ status: 'retrying', runId: 'run-h' });
    const reset = (deps.patchMigrationExecutionRunItem as jest.Mock).mock.calls.find(
      (c) => c[1] === 'ri-1'
    );
    expect(reset[2]).toMatchObject({
      status: RUN_ITEM_STATUS.IMPLEMENTED,
      outcome: 'implemented',
      error_detail: null,
    });
    expect((deps.patchMigrationExecutionRun as jest.Mock).mock.calls[0][2]).toEqual({
      status: RUN_STATUS.DISPATCHING,
    });
    await flush();
    expect(chain).toHaveBeenCalledTimes(1);
    expect(chain.mock.calls[0][2]).toMatchObject({ id: 'ri-1', outcome: 'implemented' });
  });

  it('refuses a run that is still EXECUTING', async () => {
    const run = { ...haltedRun(), status: RUN_STATUS.DISPATCHING };
    const { chain, deps } = retryDeps(run);
    const result = await retryDbPlaneCompletion(scope, 'run-h', deps);
    expect(result.status).toBe('not_retryable');
    expect(chain).not.toHaveBeenCalled();
  });

  it('a FINISHED run (deployed/awaiting_approval) re-runs the DB build without re-running specs (2026-08-11)', async () => {
    // The live case: stage 1 completed, then the loaded DATA was found
    // defective (truncated keyset loads) — re-running assemble → schema →
    // load → parity must not require a full stage re-run.
    for (const status of [RUN_STATUS.DEPLOYED, RUN_STATUS.AWAITING_APPROVAL]) {
      const run = haltedRun({
        status: RUN_ITEM_STATUS.DEPLOYED, outcome: 'deployed', error_detail: null,
      });
      run.status = status;
      const { chain, deps } = retryDeps(run);
      const result = await retryDbPlaneCompletion(scope, 'run-h', deps);
      expect(result).toEqual({ status: 'retrying', runId: 'run-h' });
      await flush();
      expect(chain).toHaveBeenCalledTimes(1);
    }
  });

  it('refuses a spec-authoring failure (the final item never implemented)', async () => {
    const run = haltedRun({
      error_detail: 'Step 3 finished but tasks.md still has 2 unticked task checkbox(es)',
    });
    const { chain, deps } = retryDeps(run);
    const result = await retryDbPlaneCompletion(scope, 'run-h', deps);
    expect(result.status).toBe('not_retryable');
    expect(chain).not.toHaveBeenCalled();
  });

  it('refuses when a sibling spec is not implemented', async () => {
    const run = haltedRun();
    run.items![0] = { ...run.items![0], status: RUN_ITEM_STATUS.FAILED, outcome: 'failed' };
    const { chain, deps } = retryDeps(run);
    const result = await retryDbPlaneCompletion(scope, 'run-h', deps);
    expect(result.status).toBe('not_retryable');
    expect(chain).not.toHaveBeenCalled();
  });

  it('reports not_found for a missing run', async () => {
    const { deps } = retryDeps(null);
    expect(await retryDbPlaneCompletion(scope, 'nope', deps)).toEqual({ status: 'not_found' });
  });
});
