/**
 * End-to-end LOOP coverage for the Migration Reconciliation + Bug Loop
 * (Spec 2026-06-14, Spec 4 of 4 -- Task Group 6).
 *
 * The per-group suites (Groups 2/3/4) each exercise ONE driver function in
 * isolation over a fully-mocked deps surface that returns canned values. This
 * suite is different on purpose: it wires the WHOLE loop end-to-end through the
 * real seams --
 *
 *   inbound door (`processBuildResult`)
 *     -> `advanceRunOnBuildResult` / `advanceRunOnBugResult` (the Driver dispatch)
 *       -> the REAL `triggerFullBaselineReconcile` / `handleBugCallback`
 *         -> a STATEFUL in-memory break store + a FAKE validation client
 *
 * -- so the progression deployed -> reconcile -> break -> send -> bug_id ->
 * re-reconcile -> circuit-breaker is asserted on ONE store that carries
 * disposition / attempt / circuit-breaker state ACROSS calls. Only the leaf DI
 * seams are stubbed (the AMS break-store client, the AMS run-state client, the
 * headless validation client, and the authed bug-send proxy); every piece of
 * loop LOGIC under test is the production code.
 *
 * Covered seams (not covered by the per-group unit tests):
 *  1. wired door->driver->reconcile: a `deployed` callback drives a FULL-baseline
 *     reconcile that persists breaks INCLUDING a deferred / un-migrated story's
 *     source_only break (CD-B -- the locked correction);
 *  2. nothing auto-sends after reconcile (the human gate);
 *  3. human-gated send posts ONE CreateBugRequest (callback_url present) + moves
 *     the selected breaks to sent_as_bug(bug_id, attempt 1) on the SAME store;
 *  4. an un-sent break disposed accepted|wont_report|intentional_deviation is
 *     terminal AND the oracle/baseline is never mutated (CD-A);
 *  5. a `bug_id`+`deployed` callback re-reconciles ONLY the affected
 *     source_baseline_item_id scope (not the whole baseline) -> clean ->
 *     fixed_confirmed on the same store;
 *  6. still-broken `bug_id` re-reconcile bumps the attempt counter on the store;
 *  7. repeated still-broken bug_id callbacks accumulate attempts to the cap ->
 *     circuit_broken_escalated + needs_human, with NO further auto-loop/auto-send;
 *  8. idempotent duplicate `deployed` callbacks -> no second reconcile / no
 *     double-persist;
 *  9. idempotent duplicate `bug_id` callbacks -> no double-reconcile / no
 *     attempt double-increment;
 * 10. the inbound service-token guard is still enforced on the bug_id path.
 *
 * No live LLM is reached (the bug send is a plain authed proxy POST injected as a
 * mock; the global llm-guard setup applies).
 */

// Silence the logger.
jest.mock('../services/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// Configured inbound token + base URLs (the door route test + the proxy seam).
jest.mock('../config', () => ({
  getConfig: jest.fn(() => ({
    architectureModelServiceBaseUrl: 'http://localhost:8080',
    apiMigrationValidationServiceBaseUrl: 'http://localhost:8092',
    implementationLlmServiceBaseUrl: 'http://localhost:8000',
    implementationLlmServiceBearerToken: 'test-server-token',
    gatewayPublicBaseUrl: 'http://gw',
    buildResultsServiceToken: 'inbound-secret',
  })),
}));

import request from 'supertest';
import express from 'express';

import { processBuildResult } from '../services/buildResultsReceiver';
import { MigrationDriverDeps } from '../services/migrationExecutionDriver';
import {
  MigrationExecutionRun,
  MigrationExecutionRunItem,
} from '../services/migrationExecutionRunClient';
import {
  MigrationReconciliationBreak,
  BREAK_DISPOSITION,
} from '../services/migrationReconciliationBreakClient';
import {
  ReconciliationDiffItem,
  ReconciliationResult,
} from '../services/migrationReconciliationValidationClient';
// The REAL loop functions live in the reconciliation driver (the execution
// driver imports but does not re-export them); the wired harness calls these
// directly so the production loop logic is genuinely under test.
import {
  ReconciliationDriverDeps,
  triggerFullBaselineReconcile,
  handleBugCallback,
} from '../services/migrationReconciliationDriver';

const COMPANY = 'acme';
const PROJECT = 'widgets';
const PROJECT_ID = 'proj-1';
const RUN_ID = 'run-1';
const PINNED_BASELINE_ID = 'baseline-current-1';
const ARCH_ID = 'arch-1';
const TARGET_URL = 'https://target.example.test';
const CALLBACK_URL = 'http://gw/api/implementation/build-results';
const FINAL_JOB_ID = 'job-final';
const MAX_ATTEMPTS = 3;

// ===========================================================================
// A stateful in-memory break store -- the AMS changeset-183 seam, but mutated
// for real so disposition / attempt / circuit-breaker state survives ACROSS the
// whole loop (the thing the per-group fakes cannot show).
// ===========================================================================

interface StatefulStore {
  rows: MigrationReconciliationBreak[];
  client: Pick<
    ReconciliationDriverDeps,
    | 'createReconciliationBreaks'
    | 'getReconciliationBreaksForRun'
    | 'getReconciliationBreaksByBugId'
    | 'markReconciliationBreaksSent'
    | 'patchReconciliationBreak'
    | 'incrementReconciliationBreakAttempt'
    | 'tripReconciliationBreakCircuitBreaker'
  >;
  /** jest spies so call counts / args can be asserted. */
  spies: {
    create: jest.Mock;
    markSent: jest.Mock;
    patch: jest.Mock;
    increment: jest.Mock;
    trip: jest.Mock;
  };
}

function makeStatefulStore(): StatefulStore {
  const rows: MigrationReconciliationBreak[] = [];
  let seq = 0;

  const create = jest.fn(
    async (_projectId: string, runId: string, breaks: MigrationReconciliationBreak[]) => {
      const persisted = breaks.map((b) => {
        const row: MigrationReconciliationBreak = {
          ...b,
          id: `brk-${++seq}`,
          run_id: runId,
          attempt_count: b.attempt_count ?? 0,
          circuit_broken: b.circuit_broken ?? false,
          needs_human: b.needs_human ?? false,
          disposition_status: b.disposition_status ?? BREAK_DISPOSITION.OPEN,
        };
        rows.push(row);
        return row;
      });
      return persisted;
    }
  );

  const markSent = jest.fn(async (_projectId: string, bugId: string, breakIds: string[]) => {
    const updated: MigrationReconciliationBreak[] = [];
    for (const id of breakIds) {
      const row = rows.find((r) => r.id === id);
      if (!row) continue;
      row.disposition_status = BREAK_DISPOSITION.SENT_AS_BUG;
      row.bug_id = bugId;
      row.attempt_count = 1; // sent_as_bug carries attempt 1
      updated.push(row);
    }
    return updated;
  });

  const patch = jest.fn(
    async (_projectId: string, breakId: string, p: MigrationReconciliationBreak) => {
      const row = rows.find((r) => r.id === breakId);
      if (!row) throw new Error(`no break ${breakId}`);
      // Null-guarded merge (mirror the AMS boxed-type semantics: only provided
      // fields are written).
      for (const [k, v] of Object.entries(p)) {
        if (v !== undefined) (row as Record<string, unknown>)[k] = v;
      }
      return row;
    }
  );

  const increment = jest.fn(async (_projectId: string, breakId: string) => {
    const row = rows.find((r) => r.id === breakId);
    if (!row) throw new Error(`no break ${breakId}`);
    row.attempt_count = (row.attempt_count ?? 0) + 1;
    return row;
  });

  const trip = jest.fn(
    async (
      _projectId: string,
      breakId: string,
      args: { circuitBroken: boolean; needsHuman: boolean; errorDetail?: string | null }
    ) => {
      const row = rows.find((r) => r.id === breakId);
      if (!row) throw new Error(`no break ${breakId}`);
      row.circuit_broken = args.circuitBroken;
      row.needs_human = args.needsHuman;
      row.disposition_status = BREAK_DISPOSITION.CIRCUIT_BROKEN_ESCALATED;
      row.error_detail = args.errorDetail ?? null;
      return row;
    }
  );

  return {
    rows,
    spies: { create, markSent, patch, increment, trip },
    client: {
      createReconciliationBreaks: create as ReconciliationDriverDeps['createReconciliationBreaks'],
      getReconciliationBreaksForRun: (async (_p: string, runId: string) =>
        rows.filter((r) => r.run_id === runId)) as ReconciliationDriverDeps['getReconciliationBreaksForRun'],
      getReconciliationBreaksByBugId: (async (_p: string, bugId: string) =>
        rows.filter((r) => r.bug_id === bugId)) as ReconciliationDriverDeps['getReconciliationBreaksByBugId'],
      markReconciliationBreaksSent: markSent as ReconciliationDriverDeps['markReconciliationBreaksSent'],
      patchReconciliationBreak: patch as ReconciliationDriverDeps['patchReconciliationBreak'],
      incrementReconciliationBreakAttempt:
        increment as ReconciliationDriverDeps['incrementReconciliationBreakAttempt'],
      tripReconciliationBreakCircuitBreaker:
        trip as ReconciliationDriverDeps['tripReconciliationBreakCircuitBreaker'],
    },
  };
}

// ===========================================================================
// A fake validation client (the headless reconcile seam). A per-test SCRIPT
// names which source operations drift on each successive replay -- so the SAME
// source op can flip broken -> fixed (or stay broken) across rounds without any
// network or replay engine.
// ===========================================================================

function driftItem(sourceItemId: string, classification = 'status_drift'): ReconciliationDiffItem {
  return {
    id: `di-${sourceItemId}-${Math.random().toString(36).slice(2, 7)}`,
    method: 'GET',
    path: `/api/${sourceItemId}`,
    scenario_name: 'default',
    source_baseline_item_id: sourceItemId,
    target_baseline_item_id: classification === 'source_only' ? null : `tgt-${sourceItemId}`,
    status_classification: classification === 'source_only' ? 'source_only' : 'status_drift',
    body_classification: null,
    source_response_status: 200,
    target_response_status: classification === 'source_only' ? null : 500,
    body_diff_json: { entries: [] },
    notes: classification === 'source_only' ? 'source_only' : null,
  };
}

function cleanItem(sourceItemId: string): ReconciliationDiffItem {
  return {
    id: `di-clean-${sourceItemId}`,
    method: 'GET',
    path: `/api/${sourceItemId}`,
    scenario_name: 'default',
    source_baseline_item_id: sourceItemId,
    target_baseline_item_id: `tgt-${sourceItemId}`,
    status_classification: 'status_match',
    body_classification: 'body_match',
    source_response_status: 200,
    target_response_status: 200,
    body_diff_json: null,
    notes: null,
  };
}

/**
 * Build a `runHeadlessReconcile` that returns the diff items for the NEXT
 * scripted replay round (consumes one entry per invocation; the last entry
 * repeats for any further calls). Each entry is the FULL diff_item set of that
 * replay (drift + clean), mirroring the real engine.
 */
function makeFakeReconcile(rounds: ReconciliationDiffItem[][]): {
  runHeadlessReconcile: ReconciliationDriverDeps['runHeadlessReconcile'];
  spy: jest.Mock;
} {
  let call = 0;
  const spy = jest.fn(async (): Promise<ReconciliationResult> => {
    const idx = Math.min(call, rounds.length - 1);
    call += 1;
    return {
      ok: true,
      sessionId: `sess-${idx}`,
      diffId: `diff-${idx}`,
      targetBaselineId: `tgt-bl-${idx}`,
      diffItems: rounds[idx] ?? [],
      error: null,
    };
  });
  return { runHeadlessReconcile: spy as ReconciliationDriverDeps['runHeadlessReconcile'], spy };
}

// ===========================================================================
// The wired harness: a stateful run store + the reconcile deps + the Driver
// deps, all sharing ONE break store. The detached reconcile / bug dispatch is
// made awaitable by injecting triggerReconcile / handleBugCallback WRAPPERS that
// invoke the REAL functions and record the promise (the loop logic under test is
// the production code -- only the await timing is harnessed).
// ===========================================================================

interface Harness {
  deps: MigrationDriverDeps;
  store: StatefulStore;
  reconcileSpy: jest.Mock;
  implRequest: jest.Mock;
  /** Await every detached reconcile / bug-handler the dispatch fired. */
  settle(): Promise<void>;
  /** The current run header (mutated by the Driver). */
  run(): MigrationExecutionRun;
}

function buildHarness(opts: {
  reconcileRounds: ReconciliationDiffItem[][];
  creds?: boolean;
  finalRunItem?: MigrationExecutionRunItem;
}): Harness {
  const store = makeStatefulStore();
  const { runHeadlessReconcile, spy: reconcileSpy } = makeFakeReconcile(opts.reconcileRounds);

  // The bug-send proxy seam: returns a fresh bug_id.
  const implRequest = jest.fn(async () => ({
    ok: true,
    status: 201,
    json: async () => ({ bug_id: 'BUG-777', status: 'received' }),
  }));

  // The run header the Driver reads + mutates (deployed -> reconciling -> ...).
  const finalItem: MigrationExecutionRunItem = opts.finalRunItem ?? {
    id: 'ri-final',
    run_id: RUN_ID,
    sequence_position: 0,
    work_item_id: 'wi-final',
    status: 'submitted',
    job_id: FINAL_JOB_ID,
    outcome: null,
    deploy_on_complete: true,
  };
  const runHeader: MigrationExecutionRun = {
    id: RUN_ID,
    project_id: PROJECT_ID,
    book_of_work_id: 'book-1',
    status: 'dispatching',
    pinned_current_baseline_id: PINNED_BASELINE_ID,
    target_base_url: null,
    items: [finalItem],
  };

  const reconciliationDeps: ReconciliationDriverDeps = {
    ...store.client,
    patchMigrationExecutionRun: (async (
      _p: string,
      _r: string,
      patch: MigrationExecutionRun
    ) => {
      Object.assign(runHeader, patch);
      return runHeader;
    }) as ReconciliationDriverDeps['patchMigrationExecutionRun'],
    runHeadlessReconcile,
    validationDeps: {} as ReconciliationDriverDeps['validationDeps'],
    resolveArchitectureForBaseline: jest.fn().mockResolvedValue(ARCH_ID),
    getTargetCredentials: jest.fn(() => (opts.creds === false ? undefined : { type: 'none' as const })),
    implRequest: implRequest as unknown as ReconciliationDriverDeps['implRequest'],
    circuitBreakerMaxAttempts: MAX_ATTEMPTS,
    loadReconcileBookOfWork: jest.fn().mockResolvedValue([]),
    // Instant polling -- the fake reconcile resolves synchronously anyway.
    pollOptions: { pollIntervalMs: 0, timeoutMs: 1000 },
  };

  // Record every detached promise so the test can await the loop quiescing.
  const detached: Promise<unknown>[] = [];

  const deps: MigrationDriverDeps = {
    // Plane resolution is FAIL-CLOSED since 2026-08-07 (an unresolvable item
    // plane halts instead of guessing 'service'), so the book must really
    // contain the run's work item — mapped to the service plane, preserving
    // the deployed → full-baseline-reconcile semantics under test.
    fetchBookOfWork: jest.fn().mockResolvedValue({
      id: 'book-1',
      project_id: PROJECT_ID,
      book_of_work_json: {
        items: [
          {
            id: 'b-final', parentId: null, type: 'story', title: 'Final',
            sequenceOrder: 0, workItemId: 'wi-final', workstream: 'api_migration',
          },
        ],
      },
    }),
    fetchSpecGenerationsForBook: jest.fn().mockResolvedValue([]),
    fetchWorkItems: jest.fn().mockResolvedValue([]),
    fetchActiveCurrentBaseline: jest.fn(),
    createMigrationExecutionRun: jest.fn(),
    getMigrationExecutionRun: jest.fn(async () => runHeader),
    patchMigrationExecutionRun: (async (
      _p: string,
      _r: string,
      patch: MigrationExecutionRun
    ) => {
      Object.assign(runHeader, patch);
      return runHeader;
    }) as MigrationDriverDeps['patchMigrationExecutionRun'],
    patchMigrationExecutionRunItem: (async (
      _p: string,
      _id: string,
      patch: MigrationExecutionRunItem
    ) => {
      Object.assign(finalItem, patch);
      return finalItem;
    }) as MigrationDriverDeps['patchMigrationExecutionRunItem'],
    findMigrationRunItemByJobId: jest.fn(async (_seg: string, jobId: string) =>
      jobId === finalItem.job_id ? finalItem : null
    ),
    submitOrchestration: jest.fn().mockResolvedValue({ ok: true, jobId: 'job-next' }),
    recordWorkItemImplementationError: jest.fn().mockResolvedValue(undefined),
    autoAnswerer: {
      driveAndAnswer: jest
        .fn()
        .mockResolvedValue({ ok: false, specName: null, sessionId: null, decisionLog: [] }),
    },
    buildResultsCallbackUrl: CALLBACK_URL,
    // Fail-closed seams (2026-08-07): carry-over reads + chain-base + plane
    // precedence must RESOLVE in tests (unreadable = blocked in production).
    carryOverCoverageReads: {
      fetchCapabilitiesForArchitecture: jest.fn().mockResolvedValue([]),
      fetchFindingsForRun: jest.fn().mockResolvedValue([]),
      fetchDiscoveryRunsForArchitecture: jest.fn().mockResolvedValue([]),
    },
    fetchMigrationExecutionRunsForBook: jest.fn().mockResolvedValue([]),
    fetchLatestMigrationExecutionRunForBook: jest.fn().mockResolvedValue(null),
    reconciliationDeps,
    // The REAL trigger / handler -- wrapped only to capture the detached promise.
    triggerReconcile: ((run: MigrationExecutionRun, rDeps: ReconciliationDriverDeps) => {
      const p = triggerFullBaselineReconcile(run, rDeps);
      detached.push(p);
      return p;
    }) as MigrationDriverDeps['triggerReconcile'],
    handleBugCallback: ((args: Parameters<typeof handleBugCallback>[0], rDeps: ReconciliationDriverDeps) => {
      const p = handleBugCallback(args, rDeps);
      detached.push(p);
      return p;
    }) as MigrationDriverDeps['handleBugCallback'],
  };

  return {
    deps,
    store,
    reconcileSpy,
    implRequest,
    run: () => runHeader,
    async settle() {
      // Drain the detached queue (a handler may enqueue nothing more).
      for (let i = 0; i < 5 && detached.length > 0; i += 1) {
        const pending = detached.splice(0, detached.length);
        await Promise.allSettled(pending);
      }
    },
  };
}

/** Fire the final-spec `deployed` callback through the inbound door. */
async function fireDeployed(harness: Harness): Promise<number> {
  const out = await processBuildResult(
    {
      company: COMPANY,
      project: PROJECT,
      outcome: 'deployed',
      job_id: FINAL_JOB_ID,
      target_base_url: TARGET_URL,
    },
    harness.deps
  );
  await harness.settle();
  return out.status;
}

/** Fire a `bug_id` callback through the inbound door. */
async function fireBugCallback(
  harness: Harness,
  outcome: 'deployed' | 'failed' | 'rejected',
  bugId = 'BUG-777'
): Promise<number> {
  const out = await processBuildResult(
    {
      company: COMPANY,
      project: PROJECT,
      outcome,
      bug_id: bugId,
      target_base_url: outcome === 'deployed' ? TARGET_URL : undefined,
    },
    harness.deps
  );
  await harness.settle();
  return out.status;
}

/** Drive the human-gated send for a run's currently-open breaks. */
async function sendOpenBreaks(harness: Harness): Promise<void> {
  const { sendBugForBreaks } = jest.requireActual('../services/migrationReconciliationDriver') as typeof import('../services/migrationReconciliationDriver');
  const open = harness.store.rows.filter(
    (r) => r.disposition_status === BREAK_DISPOSITION.OPEN && r.id
  );
  await sendBugForBreaks(
    {
      projectId: PROJECT_ID,
      company: COMPANY,
      project: PROJECT,
      breaks: open,
      callbackUrl: CALLBACK_URL,
    },
    harness.deps.reconciliationDeps as ReconciliationDriverDeps
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ===========================================================================
// 1-2. deployed -> FULL-baseline reconcile (incl. CD-B deferred break); the
//      human gate has NOT fired anything.
// ===========================================================================

describe('wired deployed -> full-baseline reconcile (CD-B)', () => {
  it('a deployed callback persists breaks INCLUDING a deferred-story source_only break, and auto-sends NOTHING', async () => {
    const harness = buildHarness({
      reconcileRounds: [
        [
          driftItem('src-orders', 'status_drift'),
          // The deferred / un-migrated story: present in the baseline, absent in
          // the target -> source_only. This MUST surface as a break (CD-B).
          driftItem('src-deferred', 'source_only'),
          cleanItem('src-clean'), // a clean match must NOT become a break
        ],
      ],
    });

    const status = await fireDeployed(harness);
    expect(status).toBe(202); // the door always acknowledges

    // The reconcile was driven against the PINNED baseline + the deployed URL.
    expect(harness.reconcileSpy).toHaveBeenCalledTimes(1);
    const call = harness.reconcileSpy.mock.calls[0][0];
    expect(call.sourceBaselineId).toBe(PINNED_BASELINE_ID);
    expect(call.targetBaseUrl).toBe(TARGET_URL);

    // Two breaks persisted (the drift + the deferred source_only); the clean drops.
    expect(harness.store.rows).toHaveLength(2);
    const deferred = harness.store.rows.find(
      (r) => r.source_baseline_item_id === 'src-deferred'
    );
    expect(deferred).toBeDefined();
    expect(deferred?.run_id).toBe(RUN_ID);
    expect(deferred?.pinned_baseline_id).toBe(PINNED_BASELINE_ID);
    expect(deferred?.disposition_status).toBe(BREAK_DISPOSITION.OPEN);
    expect(harness.store.rows.find((r) => r.source_baseline_item_id === 'src-clean')).toBeUndefined();

    // The run is now reconciled.
    expect(harness.run().status).toBe('reconciled');

    // CD-4: nothing auto-fired -- no bug send, the breaks are all still OPEN.
    expect(harness.implRequest).not.toHaveBeenCalled();
    expect(harness.store.spies.markSent).not.toHaveBeenCalled();
    expect(harness.store.rows.every((r) => r.disposition_status === BREAK_DISPOSITION.OPEN)).toBe(true);
  });

  it('pauses in needs_target_credentials (no reconcile, no breaks) when creds are absent (CD-2)', async () => {
    const harness = buildHarness({
      reconcileRounds: [[driftItem('src-orders')]],
      creds: false,
    });

    const status = await fireDeployed(harness);
    expect(status).toBe(202);
    expect(harness.reconcileSpy).not.toHaveBeenCalled();
    expect(harness.store.rows).toHaveLength(0);
    expect(harness.run().status).toBe('needs_target_credentials');
  });
});

// ===========================================================================
// 3. human-gated send: select the open breaks -> ONE CreateBugRequest with a
//    callback_url -> the SAME store moves them to sent_as_bug(bug_id, attempt 1).
// ===========================================================================

describe('human-gated send on the reconciled store', () => {
  it('sends ONE CreateBugRequest (callback_url present) and moves the selected breaks to sent_as_bug(attempt 1)', async () => {
    const harness = buildHarness({
      reconcileRounds: [[driftItem('src-orders'), driftItem('src-views')]],
    });
    await fireDeployed(harness);
    expect(harness.store.rows).toHaveLength(2);

    await sendOpenBreaks(harness);

    // ONE bug report for the whole batch (CD-5), snake_case, with the gateway's
    // callback_url (CD-3).
    expect(harness.implRequest).toHaveBeenCalledTimes(1);
    const [path, optsArg] = harness.implRequest.mock.calls[0];
    expect(path).toBe('/api/v2/bugs');
    const body = (optsArg as { body: Record<string, unknown> }).body;
    expect(body.bug_type).toBe('reconciliation');
    expect(body.callback_url).toBe(CALLBACK_URL);

    // The SAME store rows are now sent_as_bug, carry the bug_id, attempt 1.
    expect(harness.store.rows.every((r) => r.disposition_status === BREAK_DISPOSITION.SENT_AS_BUG)).toBe(true);
    expect(harness.store.rows.every((r) => r.bug_id === 'BUG-777')).toBe(true);
    expect(harness.store.rows.every((r) => r.attempt_count === 1)).toBe(true);
  });
});

// ===========================================================================
// 4. dispose: an un-sent break -> terminal disposition; the oracle/baseline is
//    NOT mutated (CD-A -- intentional deviation handled by disposition).
// ===========================================================================

describe('disposition leaves the oracle unchanged (CD-A)', () => {
  it.each([
    BREAK_DISPOSITION.ACCEPTED,
    BREAK_DISPOSITION.WONT_REPORT,
    BREAK_DISPOSITION.INTENTIONAL_DEVIATION,
  ])('disposes an un-sent break %s (terminal) without sending a bug or touching the pinned baseline', async (disposition) => {
    const { disposeBreaks } = jest.requireActual('../services/migrationReconciliationDriver') as typeof import('../services/migrationReconciliationDriver');
    const harness = buildHarness({
      reconcileRounds: [[driftItem('src-deferred', 'source_only')]],
    });
    await fireDeployed(harness);
    const breakId = harness.store.rows[0].id as string;
    const baselineBefore = harness.store.rows[0].pinned_baseline_id;

    const result = await disposeBreaks(
      { projectId: PROJECT_ID, breakIds: [breakId], disposition },
      harness.deps.reconciliationDeps as ReconciliationDriverDeps
    );

    expect(result.status).toBe('disposed');
    const row = harness.store.rows[0];
    expect(row.disposition_status).toBe(disposition);
    // CD-A: the oracle anchor (pinned baseline) is untouched -- the deviation is
    // recorded by disposition, NOT by narrowing / mutating the oracle.
    expect(row.pinned_baseline_id).toBe(baselineBefore);
    expect(row.pinned_baseline_id).toBe(PINNED_BASELINE_ID);
    // Nothing was sent.
    expect(harness.implRequest).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 5-6. bug_id callback -> SCOPED re-reconcile on the same store.
// ===========================================================================

describe('bug_id callback -> scoped re-reconcile (same store)', () => {
  it('re-reconciles ONLY the affected source scope; a now-clean replay -> fixed_confirmed', async () => {
    // Round 1 (deployed): src-orders + src-views drift. After the bug fix, round
    // 2 is clean for BOTH -> both fixed_confirmed.
    const harness = buildHarness({
      reconcileRounds: [
        [driftItem('src-orders'), driftItem('src-views')],
        [cleanItem('src-orders'), cleanItem('src-views')],
      ],
    });
    await fireDeployed(harness);
    await sendOpenBreaks(harness);
    expect(harness.store.rows.every((r) => r.disposition_status === BREAK_DISPOSITION.SENT_AS_BUG)).toBe(true);

    const status = await fireBugCallback(harness, 'deployed');
    expect(status).toBe(202);

    // A second replay was driven for the fix (the scope is JUDGED per source op).
    expect(harness.reconcileSpy).toHaveBeenCalledTimes(2);
    // Both breaks confirmed fixed on the SAME store.
    expect(harness.store.rows.every((r) => r.disposition_status === BREAK_DISPOSITION.FIXED_CONFIRMED)).toBe(true);
  });

  it('a still-broken scoped re-reconcile bumps the attempt counter (2) without tripping under the cap', async () => {
    // The break is sent (attempt 1). The fix redeploy STILL drifts -> attempt 2,
    // reopened still_broken (cap 3 not yet hit), nothing auto-sent.
    const harness = buildHarness({
      reconcileRounds: [
        [driftItem('src-orders')],
        [driftItem('src-orders')], // still broken after the fix
      ],
    });
    await fireDeployed(harness);
    await sendOpenBreaks(harness);
    expect(harness.store.rows[0].attempt_count).toBe(1);

    await fireBugCallback(harness, 'deployed');

    const row = harness.store.rows[0];
    expect(row.attempt_count).toBe(2);
    expect(row.disposition_status).toBe(BREAK_DISPOSITION.STILL_BROKEN);
    expect(row.circuit_broken).toBe(false);
    // The human gate still applies: no auto-resend.
    expect(harness.implRequest).toHaveBeenCalledTimes(1); // only the original send
    expect(harness.store.spies.trip).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 7. circuit breaker: repeated still-broken bug_id callbacks accumulate to the
//    cap -> circuit_broken_escalated + needs_human; NO further auto-loop.
// ===========================================================================

describe('circuit breaker terminates the loop (no infinite loop)', () => {
  it('accumulates attempts across repeated still-broken bug_id callbacks to the cap, then escalates + stops', async () => {
    // Always-drifting: sent (attempt 1) -> callback (2) -> callback (3 == cap) trip.
    const harness = buildHarness({
      reconcileRounds: [[driftItem('src-orders')]], // the last entry repeats forever
    });
    await fireDeployed(harness);
    await sendOpenBreaks(harness);
    expect(harness.store.rows[0].attempt_count).toBe(1);

    // Round 1 callback -> attempt 2, still_broken (under cap).
    await fireBugCallback(harness, 'deployed');
    expect(harness.store.rows[0].attempt_count).toBe(2);
    expect(harness.store.rows[0].disposition_status).toBe(BREAK_DISPOSITION.STILL_BROKEN);
    expect(harness.store.spies.trip).not.toHaveBeenCalled();

    // Round 2 callback -> attempt 3 == cap -> TRIP + escalate.
    await fireBugCallback(harness, 'deployed');
    expect(harness.store.rows[0].attempt_count).toBe(3);
    expect(harness.store.spies.trip).toHaveBeenCalledTimes(1);
    const row = harness.store.rows[0];
    expect(row.disposition_status).toBe(BREAK_DISPOSITION.CIRCUIT_BROKEN_ESCALATED);
    expect(row.circuit_broken).toBe(true);
    expect(row.needs_human).toBe(true);

    // The break is now terminal: a further callback is an idempotent no-op (the
    // loop cannot spin) and the attempt counter does NOT advance past the cap.
    const replaysBefore = harness.reconcileSpy.mock.calls.length;
    await fireBugCallback(harness, 'deployed');
    expect(harness.store.rows[0].attempt_count).toBe(3);
    expect(harness.reconcileSpy.mock.calls.length).toBe(replaysBefore); // no further replay
    // Never auto-resent across the whole escalation.
    expect(harness.implRequest).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// 8-9. idempotency end-to-end on the wired store.
// ===========================================================================

describe('idempotent duplicate callbacks (no double work on the store)', () => {
  it('a re-fired deployed callback does NOT start a second reconcile or double-persist', async () => {
    const harness = buildHarness({
      reconcileRounds: [[driftItem('src-orders'), driftItem('src-views')]],
    });
    await fireDeployed(harness);
    expect(harness.reconcileSpy).toHaveBeenCalledTimes(1);
    expect(harness.store.rows).toHaveLength(2);
    const createCallsAfterFirst = harness.store.spies.create.mock.calls.length;

    // The external service re-fires the SAME deployed callback (retry / at-least-once).
    await fireDeployed(harness);

    // No second reconcile + no second break-create (the run already has breaks).
    expect(harness.reconcileSpy).toHaveBeenCalledTimes(1);
    expect(harness.store.rows).toHaveLength(2);
    expect(harness.store.spies.create.mock.calls.length).toBe(createCallsAfterFirst);
  });

  it('a duplicate bug_id callback after fixed_confirmed is a no-op (no re-reconcile, no attempt change)', async () => {
    const harness = buildHarness({
      reconcileRounds: [
        [driftItem('src-orders')],
        [cleanItem('src-orders')], // fix confirmed
      ],
    });
    await fireDeployed(harness);
    await sendOpenBreaks(harness);
    await fireBugCallback(harness, 'deployed');
    expect(harness.store.rows[0].disposition_status).toBe(BREAK_DISPOSITION.FIXED_CONFIRMED);
    const replaysBefore = harness.reconcileSpy.mock.calls.length;
    const attemptBefore = harness.store.rows[0].attempt_count;
    const incrementCallsBefore = harness.store.spies.increment.mock.calls.length;

    // Duplicate fix callback for the now-terminal bug.
    const status = await fireBugCallback(harness, 'deployed');
    expect(status).toBe(202);
    // No further replay, no attempt double-increment.
    expect(harness.reconcileSpy.mock.calls.length).toBe(replaysBefore);
    expect(harness.store.rows[0].attempt_count).toBe(attemptBefore);
    expect(harness.store.spies.increment.mock.calls.length).toBe(incrementCallsBefore);
  });
});

// ===========================================================================
// 10. the inbound token guard is still enforced on the bug_id path (door route).
// ===========================================================================

describe('inbound token guard on the bug_id path (route)', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as { requestId?: string }).requestId = 'test-req';
      next();
    });
    const { implementationProjectsRouter } = jest.requireActual('../routes/implementationProjects');
    app.use('/api/implementation', implementationProjectsRouter);
  });

  it('401s a bug_id+deployed callback with a bad inbound token before any dispatch', async () => {
    const res = await request(app)
      .post('/api/implementation/build-results')
      .set('Authorization', 'Bearer wrong')
      .send({ company: COMPANY, project: PROJECT, outcome: 'deployed', bug_id: 'BUG-777', target_base_url: TARGET_URL });
    expect(res.status).toBe(401);
  });
});
