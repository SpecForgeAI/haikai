/**
 * Tests for the Group-3 human-gated bug send + non-sent dispositions
 * (Spec 2026-06-14, Migration Reconciliation + Bug Loop, Task Group 3).
 *
 * Covers only the locked behaviours with a fully-mocked dependency surface (no
 * AMS round-trip, no live LLM -- the outbound bug send is a plain authed proxy
 * POST that is injected as a mock):
 *  - a selected batch POSTs ONE snake_case `CreateBugRequest` per the contract
 *    (bug_type:"reconciliation", per-break prose bug_description, breaks.json
 *    BreakEvidence[] attachment, the gateway's callback_url) via the proxy seam;
 *  - the returned bug_id stamps the breaks `sent_as_bug` (attempt 1) via the AMS
 *    mark-sent endpoint;
 *  - nothing auto-sends (sendBugForBreaks is only invoked by the explicit gate);
 *  - a non-sent break gets a terminal human disposition (accepted / wont_report
 *    / intentional_deviation) and NO bug is sent (oracle unchanged, CD-A);
 *  - an invalid disposition is rejected.
 */

// Mock the logger to silence output.
jest.mock('../services/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import {
  sendBugForBreaks,
  disposeBreaks,
  ReconciliationDriverDeps,
  DEFAULT_CIRCUIT_BREAKER_MAX_ATTEMPTS,
} from '../services/migrationReconciliationDriver';
import {
  MigrationReconciliationBreak,
  BREAK_DISPOSITION,
} from '../services/migrationReconciliationBreakClient';

const PROJECT_ID = 'proj-1';
const COMPANY = 'acme';
const PROJECT = 'widgets';
const CALLBACK_URL = 'http://gw/api/implementation/build-results';

/** An OPEN break with a review-detail snapshot. */
function openBreak(id: string, op: string, srcStatus: number, tgtStatus: number | null): MigrationReconciliationBreak {
  return {
    id,
    run_id: 'run-1',
    pinned_baseline_id: 'baseline-1',
    source_baseline_item_id: `src-${id}`,
    diff_item_id: `di-${id}`,
    disposition_status: BREAK_DISPOSITION.OPEN,
    attempt_count: 0,
    circuit_broken: false,
    needs_human: false,
    detail_json: {
      operation: op,
      method: op.split(' ')[0],
      path: op.split(' ')[1],
      source_response_status: srcStatus,
      target_response_status: tgtStatus,
      body_diff_json: { entries: [{ path: 'view.name', from: 'View 2', to: null }] },
      notes: null,
    },
  };
}

/** Build a deps surface; override per test. */
function buildDeps(overrides: Partial<ReconciliationDriverDeps> = {}): {
  deps: ReconciliationDriverDeps;
  implRequest: jest.Mock;
  markSent: jest.Mock;
  patchBreak: jest.Mock;
} {
  const implRequest = jest.fn().mockResolvedValue({
    ok: true,
    status: 201,
    json: async () => ({ bug_id: 'BUG-123', status: 'received' }),
  });
  const markSent = jest.fn().mockResolvedValue([]);
  const patchBreak = jest.fn().mockResolvedValue({});

  const deps: ReconciliationDriverDeps = {
    createReconciliationBreaks: jest.fn().mockResolvedValue([]),
    getReconciliationBreaksForRun: jest.fn().mockResolvedValue([]),
    getReconciliationBreaksByBugId: jest.fn().mockResolvedValue([]),
    markReconciliationBreaksSent: markSent,
    patchReconciliationBreak: patchBreak,
    incrementReconciliationBreakAttempt: jest.fn().mockResolvedValue({}),
    tripReconciliationBreakCircuitBreaker: jest.fn().mockResolvedValue({}),
    patchMigrationExecutionRun: jest.fn().mockResolvedValue({}),
    runHeadlessReconcile: jest.fn(),
    validationDeps: {} as ReconciliationDriverDeps['validationDeps'],
    resolveArchitectureForBaseline: jest.fn().mockResolvedValue('arch-1'),
    getTargetCredentials: jest.fn().mockReturnValue({ type: 'none' }),
    implRequest: implRequest as unknown as ReconciliationDriverDeps['implRequest'],
    circuitBreakerMaxAttempts: DEFAULT_CIRCUIT_BREAKER_MAX_ATTEMPTS,
    loadReconcileBookOfWork: jest.fn().mockResolvedValue([]),
    ...overrides,
  };
  return { deps, implRequest, markSent, patchBreak };
}

describe('sendBugForBreaks (Group 3 -- the human gate)', () => {
  it('POSTs ONE snake_case CreateBugRequest with callback_url + breaks.json + marks the batch sent', async () => {
    const { deps, implRequest, markSent } = buildDeps();
    const breaks = [
      openBreak('b1', 'GET /api/orders', 200, 500),
      openBreak('b2', 'GET /api/views/7', 200, null),
    ];

    const result = await sendBugForBreaks(
      { projectId: PROJECT_ID, company: COMPANY, project: PROJECT, breaks, callbackUrl: CALLBACK_URL },
      deps
    );

    expect(result.status).toBe('sent');
    if (result.status === 'sent') {
      expect(result.bugId).toBe('BUG-123');
      expect(result.breakCount).toBe(2);
    }

    // ONE POST to /api/v2/bugs (CD-5: one report per batch).
    expect(implRequest).toHaveBeenCalledTimes(1);
    const [path, opts] = implRequest.mock.calls[0];
    expect(path).toBe('/api/v2/bugs');
    expect(opts.method).toBe('POST');
    const body = opts.body as Record<string, unknown>;
    // snake_case CreateBugRequest (CD-3).
    expect(body.company).toBe(COMPANY);
    expect(body.project).toBe(PROJECT);
    expect(body.bug_type).toBe('reconciliation');
    expect(typeof body.title).toBe('string');
    expect(typeof body.bug_description).toBe('string');
    // One prose entry per break inside the single bug_description.
    expect(String(body.bug_description)).toContain('GET /api/orders');
    expect(String(body.bug_description)).toContain('GET /api/views/7');
    // callback_url sent on every bug report (CD-3).
    expect(body.callback_url).toBe(CALLBACK_URL);
    // breaks.json BreakEvidence[] attachment (base64).
    const attachments = body.attachments as Array<{ filename: string; content_type: string; data: string }>;
    expect(attachments).toHaveLength(1);
    expect(attachments[0].filename).toBe('breaks.json');
    expect(attachments[0].content_type).toBe('application/json');
    const evidence = JSON.parse(Buffer.from(attachments[0].data, 'base64').toString('utf-8'));
    expect(Array.isArray(evidence)).toBe(true);
    expect(evidence).toHaveLength(2);
    expect(evidence[0].operation).toBe('GET /api/orders');

    // The breaks were stamped sent_as_bug with the returned bug_id (attempt 1).
    expect(markSent).toHaveBeenCalledWith(PROJECT_ID, 'BUG-123', ['b1', 'b2']);
  });

  it('reports no_breaks (and sends nothing) when no sendable breaks are selected', async () => {
    const { deps, implRequest, markSent } = buildDeps();
    // An already-terminal (accepted) break is not sendable.
    const accepted: MigrationReconciliationBreak = {
      ...openBreak('b1', 'GET /api/x', 200, 500),
      disposition_status: BREAK_DISPOSITION.ACCEPTED,
    };
    const result = await sendBugForBreaks(
      { projectId: PROJECT_ID, company: COMPANY, project: PROJECT, breaks: [accepted], callbackUrl: CALLBACK_URL },
      deps
    );
    expect(result.status).toBe('no_breaks');
    expect(implRequest).not.toHaveBeenCalled();
    expect(markSent).not.toHaveBeenCalled();
  });

  it('reports send_failed when the bug POST is non-OK (breaks not marked sent)', async () => {
    const { deps, markSent } = buildDeps({
      implRequest: jest.fn().mockResolvedValue({
        ok: false,
        status: 502,
        json: async () => ({}),
      }) as unknown as ReconciliationDriverDeps['implRequest'],
    });
    const result = await sendBugForBreaks(
      {
        projectId: PROJECT_ID,
        company: COMPANY,
        project: PROJECT,
        breaks: [openBreak('b1', 'GET /api/x', 200, 500)],
        callbackUrl: CALLBACK_URL,
      },
      deps
    );
    expect(result.status).toBe('send_failed');
    expect(markSent).not.toHaveBeenCalled();
  });
});

describe('disposeBreaks (Group 3 -- non-sent terminal dispositions, oracle unchanged)', () => {
  it.each([
    BREAK_DISPOSITION.ACCEPTED,
    BREAK_DISPOSITION.WONT_REPORT,
    BREAK_DISPOSITION.INTENTIONAL_DEVIATION,
  ])('assigns the %s disposition via PATCH and sends NO bug', async (disposition) => {
    const { deps, patchBreak, implRequest } = buildDeps();
    const result = await disposeBreaks(
      { projectId: PROJECT_ID, breakIds: ['b1', 'b2'], disposition },
      deps
    );
    expect(result.status).toBe('disposed');
    if (result.status === 'disposed') {
      expect(result.count).toBe(2);
    }
    // Each break PATCHed to the terminal disposition; nothing sent (oracle
    // never mutated -- CD-A).
    expect(patchBreak).toHaveBeenCalledTimes(2);
    expect(patchBreak).toHaveBeenCalledWith(
      PROJECT_ID,
      'b1',
      expect.objectContaining({ disposition_status: disposition })
    );
    expect(implRequest).not.toHaveBeenCalled();
  });

  it('rejects an invalid disposition (e.g. a machine state) without patching', async () => {
    const { deps, patchBreak } = buildDeps();
    const result = await disposeBreaks(
      { projectId: PROJECT_ID, breakIds: ['b1'], disposition: BREAK_DISPOSITION.SENT_AS_BUG },
      deps
    );
    expect(result.status).toBe('invalid_disposition');
    expect(patchBreak).not.toHaveBeenCalled();
  });
});
