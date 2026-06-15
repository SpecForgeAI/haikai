/**
 * Tests for the Group-4 `bug_id` callback -> scoped re-reconcile + circuit
 * breaker (Spec 2026-06-14, Migration Reconciliation + Bug Loop, Task Group 4).
 *
 * Covers only the locked behaviours with a fully-mocked dependency surface (no
 * AMS round-trip, no validation-service network, no live LLM -- the headless
 * reconcile is injected as a mock):
 *  - `bug_id`+`deployed` re-reconciles ONLY that bug's breaks (resolved via
 *    source_baseline_item_id, NOT the whole baseline): clean -> fixed_confirmed;
 *  - still-broken -> attempt++ and the circuit breaker is checked (under the cap
 *    -> still_broken, NO auto-send);
 *  - the circuit breaker TRIPS on the cap -> circuit_broken_escalated + needs_human
 *    with NO auto-loop;
 *  - `bug_id`+`failed`/`rejected` -> terminal escalation (no re-run);
 *  - a duplicate callback for an already-terminal bug is an idempotent no-op;
 *  - the inbound service-token guard is reused unchanged (the door 401s a bad
 *    token before any dispatch).
 */

// Mock the logger to silence output.
jest.mock('../services/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// Mock config: a configured inbound token + base URLs (for the door route test).
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
import {
  handleBugCallback,
  ReconciliationDriverDeps,
} from '../services/migrationReconciliationDriver';
import {
  MigrationReconciliationBreak,
  BREAK_DISPOSITION,
} from '../services/migrationReconciliationBreakClient';
import {
  ReconciliationDiffItem,
  ReconciliationResult,
} from '../services/migrationReconciliationValidationClient';

const PROJECT_ID = 'proj-1';
const RUN_ID = 'run-1';
const BUG_ID = 'BUG-123';
const PINNED_BASELINE_ID = 'baseline-1';
const TARGET_URL = 'https://target.example.test';
const MAX_ATTEMPTS = 3;

/** A break that was sent as a bug, carrying a source-op scope key. */
function sentBreak(id: string, sourceItemId: string, attempt = 1): MigrationReconciliationBreak {
  return {
    id,
    run_id: RUN_ID,
    pinned_baseline_id: PINNED_BASELINE_ID,
    source_baseline_item_id: sourceItemId,
    diff_item_id: `di-${id}`,
    disposition_status: BREAK_DISPOSITION.SENT_AS_BUG,
    bug_id: BUG_ID,
    attempt_count: attempt,
    circuit_broken: false,
    needs_human: false,
    detail_json: { operation: `GET /api/${id}` },
  };
}

/** A drifting diff_item for a source op (still broken). */
function stillDrifting(sourceItemId: string): ReconciliationDiffItem {
  return {
    id: `di-fresh-${sourceItemId}`,
    method: 'GET',
    path: `/api/${sourceItemId}`,
    scenario_name: 'default',
    source_baseline_item_id: sourceItemId,
    target_baseline_item_id: `tgt-${sourceItemId}`,
    status_classification: 'status_drift',
    body_classification: 'body_match',
    source_response_status: 200,
    target_response_status: 500,
    body_diff_json: null,
    notes: null,
  };
}

function reconcileResult(diffItems: ReconciliationDiffItem[]): ReconciliationResult {
  return {
    ok: true,
    sessionId: 'sess-2',
    diffId: 'diff-2',
    targetBaselineId: 'tgt-bl-2',
    diffItems,
    error: null,
  };
}

function buildDeps(
  breaks: MigrationReconciliationBreak[],
  reconcile: ReconciliationResult,
  overrides: Partial<ReconciliationDriverDeps> = {}
): {
  deps: ReconciliationDriverDeps;
  patchBreak: jest.Mock;
  increment: jest.Mock;
  trip: jest.Mock;
  runReconcile: jest.Mock;
} {
  const patchBreak = jest.fn().mockResolvedValue({});
  // increment echoes attempt_count = prior + 1 from the matching break.
  const increment = jest.fn().mockImplementation(async (_p: string, breakId: string) => {
    const b = breaks.find((x) => x.id === breakId);
    return { ...b, attempt_count: (b?.attempt_count ?? 0) + 1 };
  });
  const trip = jest.fn().mockResolvedValue({});
  const runReconcile = jest.fn().mockResolvedValue(reconcile);

  const deps: ReconciliationDriverDeps = {
    createReconciliationBreaks: jest.fn().mockResolvedValue([]),
    getReconciliationBreaksForRun: jest.fn().mockResolvedValue([]),
    getReconciliationBreaksByBugId: jest.fn().mockResolvedValue(breaks),
    markReconciliationBreaksSent: jest.fn().mockResolvedValue([]),
    patchReconciliationBreak: patchBreak,
    incrementReconciliationBreakAttempt: increment,
    tripReconciliationBreakCircuitBreaker: trip,
    patchMigrationExecutionRun: jest.fn().mockResolvedValue({}),
    runHeadlessReconcile: runReconcile,
    validationDeps: {} as ReconciliationDriverDeps['validationDeps'],
    resolveArchitectureForBaseline: jest.fn().mockResolvedValue('arch-1'),
    getTargetCredentials: jest.fn().mockReturnValue({ type: 'none' }),
    implRequest: jest.fn(),
    circuitBreakerMaxAttempts: MAX_ATTEMPTS,
    loadReconcileBookOfWork: jest.fn().mockResolvedValue([]),
    ...overrides,
  };
  return { deps, patchBreak, increment, trip, runReconcile };
}

function callArgs(outcome: 'deployed' | 'failed' | 'rejected') {
  return {
    projectId: PROJECT_ID,
    runId: RUN_ID,
    bugId: BUG_ID,
    outcome,
    targetBaseUrl: TARGET_URL,
    pinnedBaselineId: PINNED_BASELINE_ID,
    summary: null,
  };
}

describe('handleBugCallback (Group 4)', () => {
  it('bug_id+deployed re-reconciles ONLY that bug breaks; clean -> fixed_confirmed', async () => {
    const breaks = [sentBreak('b1', 'src-1'), sentBreak('b2', 'src-2')];
    // A clean re-reconcile: the fresh diff has NO drift for src-1 / src-2.
    const { deps, patchBreak, runReconcile } = buildDeps(breaks, reconcileResult([]));

    const result = await handleBugCallback(callArgs('deployed'), deps);
    expect(result.status).toBe('fixed_confirmed');
    if (result.status === 'fixed_confirmed') {
      expect(result.breakCount).toBe(2);
    }
    // The re-reconcile WAS driven (scoped judgement, but a fresh replay).
    expect(runReconcile).toHaveBeenCalledTimes(1);
    // Both breaks confirmed fixed.
    expect(patchBreak).toHaveBeenCalledWith(
      PROJECT_ID,
      'b1',
      expect.objectContaining({ disposition_status: BREAK_DISPOSITION.FIXED_CONFIRMED })
    );
    expect(patchBreak).toHaveBeenCalledWith(
      PROJECT_ID,
      'b2',
      expect.objectContaining({ disposition_status: BREAK_DISPOSITION.FIXED_CONFIRMED })
    );
  });

  it('still-broken under the cap -> attempt++ and still_broken (NO auto-send / NO trip)', async () => {
    // b1 was on attempt 1; the scoped re-reconcile still drifts for src-1.
    const breaks = [sentBreak('b1', 'src-1', 1)];
    const { deps, increment, patchBreak, trip } = buildDeps(
      breaks,
      reconcileResult([stillDrifting('src-1')])
    );

    const result = await handleBugCallback(callArgs('deployed'), deps);
    expect(result.status).toBe('still_broken');
    // Attempt counter incremented (now 2, still under cap 3).
    expect(increment).toHaveBeenCalledWith(PROJECT_ID, 'b1');
    // Reopened as still_broken; the circuit breaker did NOT trip + nothing auto-sent.
    expect(patchBreak).toHaveBeenCalledWith(
      PROJECT_ID,
      'b1',
      expect.objectContaining({ disposition_status: BREAK_DISPOSITION.STILL_BROKEN })
    );
    expect(trip).not.toHaveBeenCalled();
    // The bug send seam (implRequest) was never invoked -- the human gate still applies.
    expect(deps.implRequest).not.toHaveBeenCalled();
  });

  it('circuit breaker trips at the cap -> circuit_broken_escalated + needs_human (NO auto-loop)', async () => {
    // b1 was already on attempt 2; this round makes it 3 == cap -> trip.
    const breaks = [sentBreak('b1', 'src-1', 2)];
    const { deps, trip, patchBreak } = buildDeps(
      breaks,
      reconcileResult([stillDrifting('src-1')])
    );

    const result = await handleBugCallback(callArgs('deployed'), deps);
    expect(result.status).toBe('circuit_broken_escalated');
    // The breaker was tripped + escalated to human review.
    expect(trip).toHaveBeenCalledWith(
      PROJECT_ID,
      'b1',
      expect.objectContaining({ circuitBroken: true, needsHuman: true })
    );
    // No re-open to still_broken (terminal escalation), no auto re-send.
    expect(patchBreak).not.toHaveBeenCalledWith(
      PROJECT_ID,
      'b1',
      expect.objectContaining({ disposition_status: BREAK_DISPOSITION.STILL_BROKEN })
    );
    expect(deps.implRequest).not.toHaveBeenCalled();
  });

  it('bug_id+failed escalates to human review with NO re-run', async () => {
    const breaks = [sentBreak('b1', 'src-1')];
    const { deps, trip, runReconcile } = buildDeps(breaks, reconcileResult([]));

    const result = await handleBugCallback(callArgs('failed'), deps);
    expect(result.status).toBe('escalated_no_rerun');
    // No replay was driven for a failed outcome.
    expect(runReconcile).not.toHaveBeenCalled();
    expect(trip).toHaveBeenCalledWith(
      PROJECT_ID,
      'b1',
      expect.objectContaining({ circuitBroken: true, needsHuman: true })
    );
  });

  it('is idempotent: a duplicate callback for an already-terminal bug is a no-op', async () => {
    const terminal: MigrationReconciliationBreak = {
      ...sentBreak('b1', 'src-1'),
      disposition_status: BREAK_DISPOSITION.FIXED_CONFIRMED,
    };
    const { deps, runReconcile, trip, patchBreak } = buildDeps([terminal], reconcileResult([]));

    const result = await handleBugCallback(callArgs('deployed'), deps);
    expect(result.status).toBe('noop_idempotent');
    expect(runReconcile).not.toHaveBeenCalled();
    expect(trip).not.toHaveBeenCalled();
    expect(patchBreak).not.toHaveBeenCalled();
  });

  it('reports unknown_bug when no breaks resolve for the bug_id', async () => {
    const { deps, runReconcile } = buildDeps([], reconcileResult([]));
    const result = await handleBugCallback(callArgs('deployed'), deps);
    expect(result.status).toBe('unknown_bug');
    expect(runReconcile).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// The inbound token guard is reused unchanged (door 401s before any dispatch).
// ===========================================================================

describe('POST /api/implementation/build-results bug_id token guard (reused)', () => {
  let app: express.Application;

  beforeEach(() => {
    jest.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as { requestId?: string }).requestId = 'test-req';
      next();
    });
    const { implementationProjectsRouter } = jest.requireActual('../routes/implementationProjects');
    app.use('/api/implementation', implementationProjectsRouter);
  });

  it('401 on a bad inbound token for a bug_id+deployed callback (no dispatch)', async () => {
    const res = await request(app)
      .post('/api/implementation/build-results')
      .set('Authorization', 'Bearer wrong')
      .send({ company: 'acme', project: 'p', outcome: 'deployed', bug_id: BUG_ID, target_base_url: TARGET_URL });
    expect(res.status).toBe(401);
  });
});
