/**
 * Wire-shape regression tests for the headless reconcile transport
 * (2026-08-17 live failure).
 *
 * Pins:
 *   - `getDiffByTargetBaseline` coerces the AMS snake_case ApiBehaviourDiffDto
 *     (identifier field `id` — there is NO diffId on the wire) into the
 *     driver's `diffId` shape. The live failure: reading only `diffId` made
 *     every COMPLETED diff invisible and the reconcile "timed out" after the
 *     full 15-minute deadline on a diff that finished in seconds.
 *   - `listDiffItems` is LOUD on failure: a non-OK response or a non-array
 *     body THROWS (it used to coerce to `[]`, which the driver recorded as a
 *     clean zero-break reconcile).
 *   - `runHeadlessReconcile` refuses to call a completed diff with ZERO items
 *     a successful reconcile.
 *   - the full happy-path lifecycle against a snake_case AMS reaches
 *     `ok: true` with the diff items (the end-to-end regression proof).
 */

jest.mock('../services/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../config', () => ({
  getConfig: () => ({
    apiMigrationValidationServiceBaseUrl: 'http://amvs.test',
    architectureModelServiceBaseUrl: 'http://ams.test',
  }),
}));

import {
  defaultReconciliationValidationDeps,
  runHeadlessReconcile,
  ReconciliationValidationDeps,
} from '../services/migrationReconciliationValidationClient';

/** A minimal Response-like object for the mocked fetch. */
function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

const AMS_DIFF_SNAKE = {
  id: 'diff-1',
  project_id: 'proj-1',
  status: 'completed',
  error_message: null,
  matched_count: 0,
  status_drift_count: 230,
};

afterEach(() => {
  jest.restoreAllMocks();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (global as any).fetch;
});

describe('getDiffByTargetBaseline wire coerce', () => {
  it('coerces the AMS snake_case DTO (id -> diffId) so a completed diff is recognised', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).fetch = jest.fn().mockResolvedValue(jsonResponse(AMS_DIFF_SNAKE));
    const deps = defaultReconciliationValidationDeps();
    const row = await deps.getDiffByTargetBaseline({ projectId: 'proj-1', targetBaselineId: 'tb-1' });
    expect(row).not.toBeNull();
    expect(row?.diffId).toBe('diff-1');
    expect(row?.status).toBe('completed');
    expect(row?.error_message).toBeNull();
  });

  it('still tolerates a camelCase diffId shape', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse({ diffId: 'diff-2', status: 'running' }));
    const deps = defaultReconciliationValidationDeps();
    const row = await deps.getDiffByTargetBaseline({ projectId: 'proj-1', targetBaselineId: 'tb-1' });
    expect(row?.diffId).toBe('diff-2');
    expect(row?.status).toBe('running');
  });

  it('carries the error_message through for failed diffs', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).fetch = jest.fn().mockResolvedValue(
      jsonResponse({ id: 'diff-3', status: 'failed', error_message: 'boom' }),
    );
    const deps = defaultReconciliationValidationDeps();
    const row = await deps.getDiffByTargetBaseline({ projectId: 'proj-1', targetBaselineId: 'tb-1' });
    expect(row?.diffId).toBe('diff-3');
    expect(row?.status).toBe('failed');
    expect(row?.error_message).toBe('boom');
  });

  it('returns null on 404 (no diff computed yet)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).fetch = jest.fn().mockResolvedValue(jsonResponse(null, 404));
    const deps = defaultReconciliationValidationDeps();
    const row = await deps.getDiffByTargetBaseline({ projectId: 'proj-1', targetBaselineId: 'tb-1' });
    expect(row).toBeNull();
  });
});

describe('listDiffItems loud failure', () => {
  it('throws on a non-OK response instead of coercing to []', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse({ error: 'boom' }, 500));
    const deps = defaultReconciliationValidationDeps();
    await expect(
      deps.listDiffItems({ projectId: 'proj-1', diffId: 'diff-1' }),
    ).rejects.toThrow('AMS diff-items read failed (status 500)');
  });

  it('throws on a non-array body instead of coercing to []', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse({ items: [] }));
    const deps = defaultReconciliationValidationDeps();
    await expect(
      deps.listDiffItems({ projectId: 'proj-1', diffId: 'diff-1' }),
    ).rejects.toThrow('non-array body');
  });

  it('returns the items on an OK array body', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse([{ id: 'item-1' }]));
    const deps = defaultReconciliationValidationDeps();
    const items = await deps.listDiffItems({ projectId: 'proj-1', diffId: 'diff-1' });
    expect(items).toEqual([{ id: 'item-1' }]);
  });
});

// ---------------------------------------------------------------------------
// runHeadlessReconcile guards
// ---------------------------------------------------------------------------

/** Injected deps simulating a healthy lifecycle; override per test. */
function lifecycleDeps(
  overrides: Partial<ReconciliationValidationDeps> = {},
): ReconciliationValidationDeps {
  let clock = 0;
  return {
    createTargetSession: jest.fn().mockResolvedValue('sess-1'),
    loadSecrets: jest.fn().mockResolvedValue(undefined),
    startSession: jest.fn().mockResolvedValue(undefined),
    getSessionStatus: jest.fn().mockResolvedValue({ status: 'completed' }),
    listTargetBaselines: jest
      .fn()
      .mockResolvedValue([{ id: 'tb-1', session_id: 'sess-1', updated_at: '2026-08-17T12:00:00Z' }]),
    getDiffByTargetBaseline: jest
      .fn()
      .mockResolvedValue({ diffId: 'diff-1', status: 'completed', error_message: null }),
    getDiffStatus: jest.fn().mockResolvedValue({ diffId: 'diff-1', status: 'completed' }),
    listDiffItems: jest.fn().mockResolvedValue([{ id: 'item-1' }]),
    sleep: jest.fn().mockResolvedValue(undefined),
    now: jest.fn(() => (clock += 10)),
    ...overrides,
  };
}

const RECONCILE_ARGS = {
  projectId: 'proj-1',
  architectureId: 'arch-1',
  sourceBaselineId: 'src-bl-1',
  targetBaseUrl: 'http://target.test',
  api: { type: 'none' } as never,
};

describe('runHeadlessReconcile zero-items guard', () => {
  it('refuses to call a completed diff with ZERO items a clean reconcile', async () => {
    const deps = lifecycleDeps({ listDiffItems: jest.fn().mockResolvedValue([]) });
    const result = await runHeadlessReconcile(RECONCILE_ARGS, deps, {
      timeoutMs: 60_000,
      pollIntervalMs: 0,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('zero diff items');
    expect(result.diffId).toBe('diff-1');
  });

  it('fails (not clean-completes) when the diff-items read throws', async () => {
    const deps = lifecycleDeps({
      listDiffItems: jest.fn().mockRejectedValue(new Error('AMS diff-items read failed (status 500)')),
    });
    const result = await runHeadlessReconcile(RECONCILE_ARGS, deps, {
      timeoutMs: 60_000,
      pollIntervalMs: 0,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('diff-items read failed');
  });
});

describe('runHeadlessReconcile against a snake_case AMS (end-to-end regression)', () => {
  it('recognises the completed diff via the real transport coerce and returns the items', async () => {
    // Route the mocked fetch by URL — the FULL default transport lifecycle,
    // with AMS answering in its real snake_case shapes.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).fetch = jest.fn().mockImplementation(async (url: string, init?: { method?: string }) => {
      const method = init?.method ?? 'GET';
      if (method === 'POST' && url.endsWith('/target-capture-sessions')) {
        return jsonResponse({ id: 'sess-1' }, 201);
      }
      if (method === 'POST' && url.includes('/secrets')) return jsonResponse({}, 200);
      if (method === 'POST' && url.includes('/start')) return jsonResponse({}, 202);
      if (url.includes('/status') && url.includes('target-capture-sessions')) {
        return jsonResponse({ status: 'completed' });
      }
      if (url.includes('/target-baselines')) {
        return jsonResponse([
          { id: 'tb-1', session_id: 'sess-1', updated_at: '2026-08-17T12:24:31Z' },
        ]);
      }
      if (url.includes('/diffs/by-target/')) {
        return jsonResponse(AMS_DIFF_SNAKE); // snake_case: id, NOT diffId
      }
      if (url.includes('/diffs/') && url.endsWith('/items')) {
        return jsonResponse([{ id: 'item-1', status_classification: 'status_drift' }]);
      }
      throw new Error(`unexpected fetch: ${method} ${url}`);
    });

    const deps = defaultReconciliationValidationDeps();
    // A SHORT deadline: a regression (diff invisible again) fails fast with
    // 'reconcile diff poll timed out' instead of hanging the suite.
    const result = await runHeadlessReconcile(RECONCILE_ARGS, deps, {
      timeoutMs: 2_000,
      pollIntervalMs: 0,
    });

    expect(result.error).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.sessionId).toBe('sess-1');
    expect(result.targetBaselineId).toBe('tb-1');
    expect(result.diffId).toBe('diff-1');
    expect(result.diffItems).toHaveLength(1);
  });
});
