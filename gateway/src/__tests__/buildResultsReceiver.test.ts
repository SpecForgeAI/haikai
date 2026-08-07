/**
 * Tests for the inbound build-results door (Spec 2026-06-14, Task Group 3).
 *
 * Covers the critical behaviours of the door's testable core + the route:
 *  - the NEW inbound service-token check accepts the configured token (Bearer or
 *    X-Service-Token) and rejects a bad/missing token (401);
 *  - contract validation returns 422 (neither id / both ids / bad outcome /
 *    deployed without target_base_url);
 *  - a valid job_id callback dispatches into the Driver advance (implemented /
 *    failed / deployed) and maps the advance decision to 202 / 404;
 *  - a duplicate (already-advanced) callback is an idempotent 202 no-op (CD-6);
 *  - the door is snake_case + camelCase-tolerant;
 *  - the bug_id path is a clean Spec-4 seam (202 acknowledged, no dispatch);
 *  - the route returns 401 on a bad token before any dispatch.
 *
 * No live LLM (the door only advances run-state; the Driver deps are mocked).
 */

// Mock the logger.
jest.mock('../services/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// Mock config: a configured inbound token + base URLs.
jest.mock('../config', () => ({
  getConfig: jest.fn(() => ({
    architectureModelServiceBaseUrl: 'http://localhost:8080',
    implementationLlmServiceBaseUrl: 'http://localhost:8000',
    implementationLlmServiceBearerToken: 'test-server-token',
    gatewayPublicBaseUrl: 'http://gw',
    buildResultsServiceToken: 'inbound-secret',
  })),
}));

import request from 'supertest';
import express from 'express';
import {
  processBuildResult,
  checkInboundServiceToken,
  BuildResultCallbackBody,
} from '../services/buildResultsReceiver';
import {
  MigrationDriverDeps,
  AdvanceDecision,
} from '../services/migrationExecutionDriver';

// ---------------------------------------------------------------------------
// A deps surface whose advance is a single configurable jest.fn.
// ---------------------------------------------------------------------------

function depsWithAdvance(decision: AdvanceDecision): {
  deps: MigrationDriverDeps;
  advance: jest.Mock;
} {
  // The door's processBuildResult only calls advanceRunOnBuildResult, which is
  // exercised through the real Driver here -- so we mock the Driver's OWN deps
  // (the AMS run-state lookups) to produce the desired decision deterministically.
  const advance = jest.fn();
  // We model the advance via the run-item lookup + run read the Driver uses.
  const runItem = decision === 'run_item_not_found'
    ? null
    : { id: 'ri-0', run_id: 'run-1', sequence_position: 0, work_item_id: 'wi-1', status: 'submitted', job_id: 'job-1', outcome: decision === 'noop_idempotent' ? 'implemented' : null, deploy_on_complete: decision === 'deployed_recorded' };
  const run = {
    id: 'run-1',
    project_id: 'proj-1',
    book_of_work_id: 'book-1',
    status: 'dispatching',
    items: runItem ? [runItem] : [],
  };
  const deps: MigrationDriverDeps = {
    fetchBookOfWork: jest.fn(),
    fetchSpecGenerationsForBook: jest.fn().mockResolvedValue([]),
    fetchWorkItems: jest.fn().mockResolvedValue([]),
    fetchActiveCurrentBaseline: jest.fn(),
    createMigrationExecutionRun: jest.fn(),
    getMigrationExecutionRun: jest.fn().mockResolvedValue(run),
    patchMigrationExecutionRun: jest.fn().mockResolvedValue({}),
    patchMigrationExecutionRunItem: jest.fn().mockResolvedValue({}),
    findMigrationRunItemByJobId: jest.fn().mockResolvedValue(runItem),
    submitOrchestration: jest.fn().mockResolvedValue({ ok: true, jobId: 'job-next' }),
    recordWorkItemImplementationError: jest.fn().mockResolvedValue(undefined),
    autoAnswerer: { driveAndAnswer: jest.fn().mockResolvedValue({ ok: false, specName: null, sessionId: null, decisionLog: [] }) },
    buildResultsCallbackUrl: 'http://gw/api/implementation/build-results',
    // Spec-4 reconcile seams: stubbed so the door never reaches a real reconcile
    // / a real fetch. The full reconcile + bug loop have their own suites. The
    // bug-scope resolver returns [] so advanceRunOnBugResult short-circuits to
    // bug_unresolved (the door still 202s) without any network.
    reconciliationDeps: {
      getReconciliationBreaksByBugId: jest.fn().mockResolvedValue([]),
    } as unknown as MigrationDriverDeps['reconciliationDeps'],
    triggerReconcile: jest.fn().mockResolvedValue({ status: 'reconciled', breakCount: 0 }),
    handleBugCallback: jest.fn().mockResolvedValue({ status: 'unknown_bug' }),
  };
  return { deps, advance };
}

// ===========================================================================
// checkInboundServiceToken
// ===========================================================================

describe('checkInboundServiceToken', () => {
  it('accepts the configured token via Authorization: Bearer', () => {
    expect(checkInboundServiceToken({ authorization: 'Bearer inbound-secret' })).toBe(true);
  });
  it('accepts the configured token via X-Service-Token', () => {
    expect(checkInboundServiceToken({ 'x-service-token': 'inbound-secret' })).toBe(true);
  });
  it('rejects a bad token', () => {
    expect(checkInboundServiceToken({ authorization: 'Bearer wrong' })).toBe(false);
  });
  it('rejects a missing token', () => {
    expect(checkInboundServiceToken({})).toBe(false);
  });
});

// ===========================================================================
// processBuildResult: validation + dispatch
// ===========================================================================

describe('processBuildResult validation', () => {
  it('422 when neither job_id nor bug_id is present', async () => {
    const { deps } = depsWithAdvance('advanced_next_dispatched');
    const out = await processBuildResult({ company: 'acme', project: 'p', outcome: 'implemented' }, deps);
    expect(out.status).toBe(422);
  });

  it('422 when both job_id and bug_id are present', async () => {
    const { deps } = depsWithAdvance('advanced_next_dispatched');
    const out = await processBuildResult(
      { company: 'acme', project: 'p', outcome: 'implemented', job_id: 'j', bug_id: 'b' },
      deps
    );
    expect(out.status).toBe(422);
  });

  it('422 when outcome=deployed without target_base_url', async () => {
    const { deps } = depsWithAdvance('deployed_recorded');
    const out = await processBuildResult(
      { company: 'acme', project: 'p', outcome: 'deployed', job_id: 'job-1' },
      deps
    );
    expect(out.status).toBe(422);
  });

  it('422 on an invalid outcome', async () => {
    const { deps } = depsWithAdvance('advanced_next_dispatched');
    const out = await processBuildResult(
      { company: 'acme', project: 'p', outcome: 'exploded', job_id: 'job-1' } as BuildResultCallbackBody,
      deps
    );
    expect(out.status).toBe(422);
  });
});

describe('processBuildResult dispatch', () => {
  it('202 acknowledged on a valid implemented job_id callback (snake_case)', async () => {
    const { deps } = depsWithAdvance('advanced_next_dispatched');
    const out = await processBuildResult(
      { company: 'acme', project: 'p', outcome: 'implemented', job_id: 'job-1', pr_url: 'http://pr/1' },
      deps
    );
    expect(out.status).toBe(202);
    expect(out.body).toEqual({ acknowledged: true });
  });

  it('is camelCase-tolerant (jobId / prUrl)', async () => {
    const { deps } = depsWithAdvance('advanced_next_dispatched');
    const out = await processBuildResult(
      { company: 'acme', project: 'p', outcome: 'implemented', jobId: 'job-1', prUrl: 'http://pr/1' },
      deps
    );
    expect(out.status).toBe(202);
  });

  it('404 when the job_id is unknown', async () => {
    const { deps } = depsWithAdvance('run_item_not_found');
    const out = await processBuildResult(
      { company: 'acme', project: 'p', outcome: 'implemented', job_id: 'nope' },
      deps
    );
    expect(out.status).toBe(404);
  });

  it('202 idempotent no-op on a duplicate (already-terminal) callback', async () => {
    const { deps } = depsWithAdvance('noop_idempotent');
    const out = await processBuildResult(
      { company: 'acme', project: 'p', outcome: 'implemented', job_id: 'job-1' },
      deps
    );
    expect(out.status).toBe(202);
    expect(out.decision).toBe('noop_idempotent');
  });

  it('bug_id path dispatches to the Group-4 handler (202 acknowledged; no job_id run-item lookup)', async () => {
    // The default deps resolve no breaks for the bug_id, so the Group-4 handler
    // no-ops (unknown bug) and the door still 202s. Critically the bug path uses
    // the break-by-bug lookup, never the job_id run-item correlation.
    const { deps } = depsWithAdvance('advanced_next_dispatched');
    const out = await processBuildResult(
      { company: 'acme', project: 'p', outcome: 'deployed', bug_id: 'bug-1', target_base_url: 'https://t/x' },
      deps
    );
    expect(out.status).toBe(202);
    expect(out.body).toEqual({ acknowledged: true });
    // The bug path does NOT use the job_id run-item correlation.
    expect(deps.findMigrationRunItemByJobId).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Reconciled outcome enum: the external implement-verify-service split the old
// `failed` into `error` (job path) + `fix_unserved` / `not_fixed` (bug path).
// The door must ACCEPT these (not 422) and route them to halt / escalate.
// ===========================================================================

describe('processBuildResult reconciled outcome enum', () => {
  it('accepts the job-path `error` outcome and halts the run (not a 422)', async () => {
    const { deps } = depsWithAdvance('advanced_next_dispatched');
    const out = await processBuildResult(
      { company: 'acme', project: 'p', outcome: 'error', job_id: 'job-1' },
      deps
    );
    expect(out.status).toBe(202);
    expect(out.decision).toBe('halted');
  });

  it('accepts the bug-path `fix_unserved` outcome (escalates; not a 422)', async () => {
    const { deps } = depsWithAdvance('advanced_next_dispatched');
    const out = await processBuildResult(
      { company: 'acme', project: 'p', outcome: 'fix_unserved', bug_id: 'bug-1' },
      deps
    );
    expect(out.status).toBe(202);
    expect(out.body).toEqual({ acknowledged: true });
    // The bug path does NOT use the job_id run-item correlation.
    expect(deps.findMigrationRunItemByJobId).not.toHaveBeenCalled();
  });

  it('accepts the bug-path `not_fixed` outcome (not a 422)', async () => {
    const { deps } = depsWithAdvance('advanced_next_dispatched');
    const out = await processBuildResult(
      { company: 'acme', project: 'p', outcome: 'not_fixed', bug_id: 'bug-1' },
      deps
    );
    expect(out.status).toBe(202);
  });
});

// ===========================================================================
// IVS error-detail threading (2026-08-07): the run's `errors` list previously
// never crossed the door — a failed run halted with an empty diagnosis. The
// door parses it leniently and the driver folds it into the halt detail.
// ===========================================================================

describe('processBuildResult errors[] threading', () => {
  it('threads the IVS errors list into the halt detail when summary is absent', async () => {
    const { deps } = depsWithAdvance('advanced_next_dispatched');
    const out = await processBuildResult(
      {
        company: 'acme',
        project: 'p',
        outcome: 'error',
        job_id: 'job-1',
        errors: [
          'verification gate: the repo test suite did not pass after 3 repair attempt(s) — spec NOT committed',
          'orchestration completed but NOTHING was committed',
        ],
      },
      deps
    );
    expect(out.status).toBe(202);
    expect(out.decision).toBe('halted');
    expect(deps.patchMigrationExecutionRunItem).toHaveBeenCalledWith(
      'proj-1',
      'ri-0',
      expect.objectContaining({
        error_detail: expect.stringContaining('NOTHING was committed'),
      })
    );
    // The work-item sink gets the same diagnosis (human traceability).
    expect(deps.recordWorkItemImplementationError).toHaveBeenCalledWith(
      'proj-1',
      'wi-1',
      expect.stringContaining('verification gate')
    );
  });

  it('an explicit summary still wins over the errors detail', async () => {
    const { deps } = depsWithAdvance('advanced_next_dispatched');
    await processBuildResult(
      {
        company: 'acme',
        project: 'p',
        outcome: 'error',
        job_id: 'job-1',
        summary: 'top-line summary',
        errors: ['detail 1'],
      },
      deps
    );
    expect(deps.patchMigrationExecutionRunItem).toHaveBeenCalledWith(
      'proj-1',
      'ri-0',
      expect.objectContaining({ error_detail: 'top-line summary' })
    );
  });

  it('a malformed errors value degrades to null — never a 422', async () => {
    const { deps } = depsWithAdvance('advanced_next_dispatched');
    const out = await processBuildResult(
      {
        company: 'acme',
        project: 'p',
        outcome: 'error',
        job_id: 'job-1',
        errors: 'not-an-array' as unknown,
      },
      deps
    );
    expect(out.status).toBe(202);
    expect(out.decision).toBe('halted');
  });
});

// ===========================================================================
// Route-level: the inbound token guard rejects before dispatch
// ===========================================================================

describe('POST /api/implementation/build-results route guard', () => {
  let app: express.Application;

  beforeEach(() => {
    jest.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as { requestId?: string }).requestId = 'test-req';
      next();
    });
    // Import the router AFTER the config mock is in place.
    const { implementationProjectsRouter } = jest.requireActual('../routes/implementationProjects');
    app.use('/api/implementation', implementationProjectsRouter);
  });

  it('401 when the inbound service token is missing', async () => {
    const res = await request(app)
      .post('/api/implementation/build-results')
      .send({ company: 'acme', project: 'p', outcome: 'implemented', job_id: 'job-1' });
    expect(res.status).toBe(401);
  });

  it('401 when the inbound service token is wrong', async () => {
    const res = await request(app)
      .post('/api/implementation/build-results')
      .set('Authorization', 'Bearer wrong')
      .send({ company: 'acme', project: 'p', outcome: 'implemented', job_id: 'job-1' });
    expect(res.status).toBe(401);
  });
});
