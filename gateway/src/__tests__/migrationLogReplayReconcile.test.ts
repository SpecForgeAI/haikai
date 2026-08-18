/**
 * Log-replay reconciliation round-2 driver tests (Capture-State Discipline &
 * Log-Replay program, Spec 7, 2026-08-18): phase A (AMVS current-side
 * replay) gates phase B (the existing headless target replay + diff, tagged
 * purpose='log_replay_round2'); failures are loud and phase B never starts
 * after a failed phase A.
 */

import { runLogReplayReconcile } from '../services/migrationLogReplayReconcile';

jest.mock('../config', () => ({
  getConfig: () => ({
    apiMigrationValidationServiceBaseUrl: 'http://amvs.test:8092',
  }),
}));

const ARGS = {
  projectId: 'p1',
  architectureId: 'a1',
  corpusId: null,
  current: {
    baseUrl: 'https://current.example.test',
    api: { type: 'bearer' as const, bearerToken: 'cur' },
    db: null,
  },
  target: {
    baseUrl: 'https://target.example.test',
    api: { type: 'bearer' as const, bearerToken: 'tgt' },
    db: null,
  },
};

function phaseAResponse(body: Record<string, unknown>, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

test('phase A success -> phase B runs with the log_replay baseline + round-2 purpose tag', async () => {
  const fetchFn = jest.fn(async () =>
    phaseAResponse({
      corpus_id: 'corpus-1',
      baseline_id: 'baseline-lr-1',
      items_total: 10,
      items_replayed: 9,
      items_skipped: 1,
      items_failed: 0,
      final_status: 'completed',
    }),
  );
  const headless = jest.fn(async () => ({
    ok: true as const,
    error: null,
    diffId: 'diff-9',
    targetBaselineId: 'baseline-t-9',
    diffItems: [
      { status_classification: 'status_match', body_classification: 'body_match' },
      { status_classification: 'status_drift', body_classification: 'body_match' },
    ] as never[],
  }));

  const result = await runLogReplayReconcile(ARGS, {
    fetchFn: fetchFn as never,
    runHeadlessReconcileFn: headless as never,
    validationDeps: {} as never,
  });

  expect(result.ok).toBe(true);
  expect(result.logReplayBaselineId).toBe('baseline-lr-1');
  expect(result.currentSide).toMatchObject({ itemsReplayed: 9, itemsSkipped: 1 });
  expect(result.diffId).toBe('diff-9');
  expect(result.diffItems).toBe(2);
  expect(result.breaks).toBeGreaterThanOrEqual(1);

  // Phase A hit the AMVS run route with the current-system credentials.
  expect(fetchFn).toHaveBeenCalledWith(
    'http://amvs.test:8092/api-migration-validation/api/log-replay/run',
    expect.objectContaining({ method: 'POST' }),
  );
  // Phase B rode the EXISTING headless machinery with the round-2 tag.
  expect(headless).toHaveBeenCalledWith(
    expect.objectContaining({
      sourceBaselineId: 'baseline-lr-1',
      targetBaseUrl: 'https://target.example.test',
      purpose: 'log_replay_round2',
    }),
    expect.anything(),
    expect.anything(),
  );
});

test('phase A failure is loud and phase B NEVER starts', async () => {
  const fetchFn = jest.fn(async () =>
    phaseAResponse(
      {
        corpus_id: 'corpus-1',
        final_status: 'failed',
        error_message: 'S0 residue — restore required',
      },
      500,
    ),
  );
  const headless = jest.fn();

  const result = await runLogReplayReconcile(ARGS, {
    fetchFn: fetchFn as never,
    runHeadlessReconcileFn: headless as never,
    validationDeps: {} as never,
  });

  expect(result.ok).toBe(false);
  expect(result.error).toContain('phase A');
  expect(result.error).toContain('S0 residue');
  expect(headless).not.toHaveBeenCalled();
});

test('phase B failure surfaces with the phase label', async () => {
  const fetchFn = jest.fn(async () =>
    phaseAResponse({
      corpus_id: 'corpus-1',
      baseline_id: 'baseline-lr-1',
      items_total: 1,
      items_replayed: 1,
      items_skipped: 0,
      items_failed: 0,
      final_status: 'completed',
    }),
  );
  const headless = jest.fn(async () => ({
    ok: false as const,
    error: 'target unreachable',
    diffId: null,
    targetBaselineId: null,
    diffItems: [] as never[],
  }));

  const result = await runLogReplayReconcile(ARGS, {
    fetchFn: fetchFn as never,
    runHeadlessReconcileFn: headless as never,
    validationDeps: {} as never,
  });

  expect(result.ok).toBe(false);
  expect(result.error).toContain('phase B');
  expect(result.error).toContain('target unreachable');
  expect(result.logReplayBaselineId).toBe('baseline-lr-1');
});
