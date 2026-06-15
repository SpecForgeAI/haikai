/**
 * targetReplayRunner auto-trigger tests (Spec 2026-05-25 Diff Engine).
 *
 * The Diff Engine spec adds a one-line auto-trigger at the happy-path tail
 * of `runTargetReplay` that invokes the diff runner directly (NOT via a
 * self-HTTP call). Per accepted Q4 + the spec's fail-soft contract, the
 * replay session must still return `finalStatus='completed'` even when the
 * diff trigger fails.
 *
 * Test inventory:
 *   1. Happy-path: after the replay finalises the target baseline,
 *      `runDiff` is invoked exactly once via the `runDiffFn` deps
 *      override.
 *   2. Fail-soft: when `runDiff` throws (or createDiff throws), the
 *      replay still returns `finalStatus='completed'` -- the failure is
 *      caught and logged, NEVER propagated.
 */

import { runTargetReplay } from '../services/targetReplayRunner';
import type {
  TargetReplayDeps,
  TargetReplayOutcome,
} from '../services/targetReplayRunner';
import { RunManager } from '../services/runManager';
import { SecretsStore } from '../services/secretsStore';
import type {
  ApiBehaviourDiffDto,
  BaselineDto,
  BaselineItemDto,
  CaptureDto,
  CaptureSessionDto,
} from '../services/archModelClient';
import type { SessionHttpExecutor } from '../services/httpExecutor';

const PROJECT_ID = '00000000-0000-0000-0000-0000000000aa';
const ARCH_ID = '00000000-0000-0000-0000-0000000000bb';
const SESSION_ID = '00000000-0000-0000-0000-0000000000cc';
const SOURCE_BASELINE_ID = '00000000-0000-0000-0000-0000000000dd';

function buildSession(): CaptureSessionDto {
  const now = new Date().toISOString();
  return {
    id: SESSION_ID,
    project_id: PROJECT_ID,
    architecture_id: ARCH_ID,
    name: 'target-replay-with-auto-diff',
    status: 'running',
    env_name: 'uat',
    api_base_url: 'https://target.example.test',
    auth_type: 'bearer',
    auth_config_redacted_json: null,
    default_headers_redacted_json: null,
    oas_spec_refs_json: null,
    db_config_redacted_json: null,
    mutating_calls_confirmed: true,
    started_at: now,
    completed_at: null,
    error_message: null,
    kind: 'target',
    source_baseline_id: SOURCE_BASELINE_ID,
    created_at: now,
    updated_at: now,
  };
}

function buildSourceBaseline(): BaselineDto {
  const now = new Date().toISOString();
  return {
    id: SOURCE_BASELINE_ID,
    project_id: PROJECT_ID,
    architecture_id: ARCH_ID,
    session_id: 'source-session-id',
    name: 'source-baseline',
    status: 'active',
    accepted_capture_count: 1,
    operation_count: 1,
    notes: null,
    kind: 'current',
    paired_with_baseline_id: null,
    created_at: now,
    updated_at: now,
  };
}

function buildItem(): BaselineItemDto {
  const now = new Date().toISOString();
  return {
    id: 'item-1',
    baseline_id: SOURCE_BASELINE_ID,
    capture_id: 'cap-1',
    operation_id: 'op-1',
    scenario_id: 'scen-1',
    method: 'GET',
    path: '/widgets',
    scenario_name: 'happy_path',
    request_json: { query: null, headers: null, body: null },
    response_status: 200,
    response_json: { headers: {}, body: { ok: true } },
    business_notes: null,
    created_at: now,
    updated_at: now,
  };
}

function buildArchMock(opts: { session: CaptureSessionDto }) {
  const createdDiffs: Array<Record<string, unknown>> = [];
  let captureN = 0;
  let baselineN = 0;
  const mock = {
    listAllCaptureSessionsByStatus: jest.fn(async () => [opts.session]),
    getCaptureSession: jest.fn(async () => opts.session),
    getBaseline: jest.fn(async () => buildSourceBaseline()),
    listBaselineItems: jest.fn(async () => [buildItem()]),
    createBaseline: jest.fn(
      async (_p: string, body: Record<string, unknown>) => {
        baselineN += 1;
        return {
          id: `target-baseline-${baselineN}`,
          project_id: PROJECT_ID,
          architecture_id: ARCH_ID,
          session_id: opts.session.id,
          name: (body.name as string) ?? null,
          status: 'draft',
          accepted_capture_count: 0,
          operation_count: 1,
          notes: null,
          kind: 'target',
          paired_with_baseline_id: SOURCE_BASELINE_ID,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } as BaselineDto;
      },
    ),
    patchBaseline: jest.fn(async () => ({}) as unknown as BaselineDto),
    createCapture: jest.fn(
      async (_p: string, body: Record<string, unknown>) => {
        captureN += 1;
        return {
          id: `cap-row-${captureN}`,
          ...body,
          accepted: null,
          accepted_at: null,
          reviewer_notes: null,
        } as unknown as CaptureDto;
      },
    ),
    patchCapture: jest.fn(async () => ({}) as unknown as CaptureDto),
    createBaselineItem: jest.fn(async () => ({}) as unknown as BaselineItemDto),
    patchCaptureSession: jest.fn(async () => opts.session),
    createDiagnostic: jest.fn(async () => ({}) as never),
    createDiff: jest.fn(async (_p: string, body: Record<string, unknown>) => {
      createdDiffs.push(body);
      return {
        id: 'diff-1',
        project_id: PROJECT_ID,
        architecture_id: ARCH_ID,
        source_baseline_id: body.source_baseline_id as string,
        target_baseline_id: body.target_baseline_id as string,
        status: 'computing',
        matched_count: null,
        status_drift_count: null,
        body_shape_drift_count: null,
        body_value_drift_count: null,
        source_only_count: null,
        target_only_count: null,
        source_baseline_updated_at: null,
        target_baseline_updated_at: null,
        computed_at: null,
        error_message: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as ApiBehaviourDiffDto;
    }),
  };
  return { mock, createdDiffs };
}

function buildExecutorAlwaysOk(): NonNullable<TargetReplayDeps['createHttpExecutor']> {
  return () => {
    const exec: SessionHttpExecutor = {
      request: jest.fn(async () => ({
        data: { ok: true },
        status: 200,
        statusText: '',
        headers: { 'content-type': 'application/json' },
        config: {} as never,
      } as never)),
      setAuth: jest.fn(),
      dispose: jest.fn(),
    };
    return exec;
  };
}

function buildDeps(opts: {
  archMock: Record<string, unknown>;
  runDiffFn?: (diffId: string) => Promise<void>;
}): TargetReplayDeps {
  const secretsStore = new SecretsStore();
  secretsStore.set({
    sessionId: SESSION_ID,
    api: { type: 'bearer', bearerToken: 'plaintext' },
    loadedAt: Date.now(),
  });
  const runManager = new RunManager();
  runManager.start({
    sessionId: SESSION_ID,
    projectId: PROJECT_ID,
    architectureId: ARCH_ID,
  });
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    archModelClient: opts.archMock as any,
    secretsStore,
    runManager,
    createHttpExecutor: buildExecutorAlwaysOk(),
    runDiffFn: opts.runDiffFn,
    now: () => 1700000000000,
  };
}

// ---------------------------------------------------------------------------
// Test 1: Happy-path auto-trigger
// ---------------------------------------------------------------------------
test('after replay finalises the target baseline, runDiff is invoked exactly once', async () => {
  const session = buildSession();
  const { mock, createdDiffs } = buildArchMock({ session });
  const runDiffFn = jest.fn(async () => undefined);

  const outcome: TargetReplayOutcome = await runTargetReplay(
    SESSION_ID,
    buildDeps({ archMock: mock, runDiffFn }),
  );

  expect(outcome.finalStatus).toBe('completed');
  // createDiff was invoked exactly once with the right pair of baselines.
  expect(mock.createDiff).toHaveBeenCalledTimes(1);
  expect(createdDiffs).toHaveLength(1);
  expect(createdDiffs[0].source_baseline_id).toBe(SOURCE_BASELINE_ID);
  // target_baseline_id was the freshly created baseline id (the mock
  // assigned `target-baseline-1`).
  expect(createdDiffs[0].target_baseline_id).toBe('target-baseline-1');
  // The fire-and-forget catch chain may not have settled before the
  // replay returned -- give it a tick.
  await new Promise((r) => setTimeout(r, 5));
  expect(runDiffFn).toHaveBeenCalledTimes(1);
  expect(runDiffFn).toHaveBeenCalledWith('diff-1');
});

// ---------------------------------------------------------------------------
// Test 2: Fail-soft -- runDiff throws, replay still returns completed
// ---------------------------------------------------------------------------
test('runDiff throw is fail-soft: replay still returns finalStatus=completed', async () => {
  const session = buildSession();
  const { mock } = buildArchMock({ session });
  const runDiffFn = jest.fn(async () => {
    throw new Error('synthetic diff failure');
  });

  const outcome: TargetReplayOutcome = await runTargetReplay(
    SESSION_ID,
    buildDeps({ archMock: mock, runDiffFn }),
  );

  // Replay still completed -- the failure was caught and logged in the
  // fire-and-forget .catch chain.
  expect(outcome.finalStatus).toBe('completed');
  // createDiff did get called; the failure is on the runDiff side.
  expect(mock.createDiff).toHaveBeenCalledTimes(1);
  // Settle the fire-and-forget chain so the catch handler actually fires
  // before the test exits (defensive -- jest would otherwise flag an
  // unhandled rejection).
  await new Promise((r) => setTimeout(r, 5));
  expect(runDiffFn).toHaveBeenCalledTimes(1);
});
