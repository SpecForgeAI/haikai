/**
 * Target replay runner unit tests.
 *
 * Spec: 2026-05-25 API Test Harness -- Target-Side Capture -- Task Group 3
 * sub-task 3.1.
 *
 * Test inventory (7 tests, focused on the spec-required behaviours):
 *   1. Happy-path: 3 source items, all non-mutating -> 3 target captures,
 *      all auto-accepted, target baseline finalised to `active`, session
 *      marked `completed`, secrets purged.
 *   2. Mutating-skip: source has a POST item AND session
 *      `mutating_calls_confirmed=false` -> POST is skipped with a
 *      `mutating_skipped` diagnostic; other items replay normally.
 *   3. HTTP 5xx not counted as transport failure: target returns 500 on
 *      one item then 200 on others -> all captures persisted, counter
 *      stays 0, session completes.
 *   4. Transport-failure threshold: 10 consecutive timeouts -> session
 *      aborts with `error_message='target_unreachable'`.
 *   5. Counter resets on successful HTTP response: 9 transport failures,
 *      then a 4xx (still a successful HTTP response), then 9 more failures
 *      -> session still completes; threshold never reached.
 *   6. Env-override (transportFailureThreshold dep) reduces the threshold:
 *      with threshold=2, 2 transport failures aborts the session.
 *   7. Cancellation mid-run: runManager.cancel() fired between items ->
 *      runner exits cleanly, session patched to `cancelled`, remaining
 *      items NOT replayed.
 */

import { runTargetReplay, TransportFailureThresholdExceededError } from '../services/targetReplayRunner';
import type {
  TargetReplayDeps,
  TargetReplayOutcome,
} from '../services/targetReplayRunner';
import { RunManager } from '../services/runManager';
import { SecretsStore } from '../services/secretsStore';
import type {
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

function buildSession(
  overrides: Partial<CaptureSessionDto> = {},
): CaptureSessionDto {
  const now = new Date().toISOString();
  return {
    id: SESSION_ID,
    project_id: PROJECT_ID,
    architecture_id: ARCH_ID,
    name: 'target-replay-1',
    status: 'running',
    env_name: 'target-uat',
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
    ...overrides,
  };
}

function buildSourceBaseline(): BaselineDto {
  const now = new Date().toISOString();
  return {
    id: SOURCE_BASELINE_ID,
    project_id: PROJECT_ID,
    architecture_id: ARCH_ID,
    session_id: 'source-session-id',
    name: 'source-baseline-1',
    status: 'active',
    accepted_capture_count: 3,
    operation_count: 3,
    notes: null,
    kind: 'current',
    paired_with_baseline_id: null,
    created_at: now,
    updated_at: now,
  };
}

function buildItem(
  i: number,
  method: string,
  path: string,
): BaselineItemDto {
  const now = new Date().toISOString();
  return {
    id: `item-${i}`,
    baseline_id: SOURCE_BASELINE_ID,
    capture_id: `cap-${i}`,
    operation_id: `op-${i}`,
    scenario_id: `scen-${i}`,
    method,
    path,
    scenario_name: 'happy_path',
    request_json: {
      query: { q: 'a' },
      headers: { 'x-test': '1' },
      body: null,
    },
    response_status: 200,
    response_json: { headers: {}, body: { ok: true } },
    business_notes: null,
    created_at: now,
    updated_at: now,
  };
}

interface MockState {
  capturesCreated: Array<{ projectId: string; body: Record<string, unknown> }>;
  capturePatches: Array<{ id: string; body: Record<string, unknown> }>;
  baselineItemsCreated: Array<{ body: Record<string, unknown> }>;
  baselinesCreated: Array<{ body: Record<string, unknown> }>;
  baselinePatches: Array<{ id: string; body: Record<string, unknown> }>;
  sessionPatches: Array<{ body: Record<string, unknown> }>;
  diagnosticsCreated: Array<{ body: Record<string, unknown> }>;
}

function buildArchClientMock(opts: {
  session: CaptureSessionDto;
  sourceBaseline: BaselineDto;
  items: BaselineItemDto[];
}): { mock: Record<string, unknown>; state: MockState } {
  const state: MockState = {
    capturesCreated: [],
    capturePatches: [],
    baselineItemsCreated: [],
    baselinesCreated: [],
    baselinePatches: [],
    sessionPatches: [],
    diagnosticsCreated: [],
  };

  let captureCount = 0;
  let baselineCount = 0;

  const mock = {
    listAllCaptureSessionsByStatus: jest.fn(async (status: string) => {
      if (status === 'running') return [opts.session];
      return [];
    }),
    getCaptureSession: jest.fn(async () => opts.session),
    getBaseline: jest.fn(async () => opts.sourceBaseline),
    listBaselineItems: jest.fn(async () => opts.items),
    createBaseline: jest.fn(async (projectId: string, body: Record<string, unknown>) => {
      void projectId;
      state.baselinesCreated.push({ body });
      baselineCount += 1;
      const row: BaselineDto = {
        id: `target-baseline-${baselineCount}`,
        project_id: PROJECT_ID,
        architecture_id: ARCH_ID,
        session_id: opts.session.id,
        name: (body.name as string) ?? null,
        status: (body.status as 'draft') ?? 'draft',
        accepted_capture_count:
          (body.accepted_capture_count as number) ?? null,
        operation_count: (body.operation_count as number) ?? null,
        notes: (body.notes as string) ?? null,
        kind: (body.kind as 'target') ?? 'target',
        paired_with_baseline_id:
          (body.paired_with_baseline_id as string) ?? null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      return row;
    }),
    patchBaseline: jest.fn(
      async (projectId: string, id: string, body: Record<string, unknown>) => {
        void projectId;
        state.baselinePatches.push({ id, body });
        return { id, ...body } as unknown as BaselineDto;
      },
    ),
    createCapture: jest.fn(
      async (projectId: string, body: Record<string, unknown>) => {
        void projectId;
        state.capturesCreated.push({ projectId, body });
        captureCount += 1;
        const row: CaptureDto = {
          id: `cap-row-${captureCount}`,
          session_id: body.session_id as string,
          scenario_id: body.scenario_id as string,
          operation_id: body.operation_id as string,
          attempt_number: (body.attempt_number as number) ?? null,
          request_method: (body.request_method as string) ?? null,
          request_path: (body.request_path as string) ?? null,
          request_query_json: body.request_query_json ?? null,
          request_headers_redacted_json:
            (body.request_headers_redacted_json as Record<string, string>) ?? null,
          request_body_json: body.request_body_json ?? null,
          response_status: (body.response_status as number) ?? null,
          response_headers_redacted_json:
            (body.response_headers_redacted_json as Record<string, string>) ?? null,
          response_body_json: body.response_body_json ?? null,
          duration_ms: (body.duration_ms as number) ?? null,
          error_type: (body.error_type as string) ?? null,
          error_message: (body.error_message as string) ?? null,
          captured_at: (body.captured_at as string) ?? null,
          accepted: null,
          accepted_at: null,
          reviewer_notes: null,
        };
        return row;
      },
    ),
    patchCapture: jest.fn(
      async (projectId: string, id: string, body: Record<string, unknown>) => {
        void projectId;
        state.capturePatches.push({ id, body });
        return { id, ...body } as unknown as CaptureDto;
      },
    ),
    createBaselineItem: jest.fn(
      async (projectId: string, body: Record<string, unknown>) => {
        void projectId;
        state.baselineItemsCreated.push({ body });
        return {
          id: `target-item-${state.baselineItemsCreated.length}`,
          ...body,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } as unknown as BaselineItemDto;
      },
    ),
    patchCaptureSession: jest.fn(
      async (projectId: string, id: string, body: Record<string, unknown>) => {
        void projectId;
        void id;
        state.sessionPatches.push({ body });
        return { ...opts.session, ...body } as CaptureSessionDto;
      },
    ),
    createDiagnostic: jest.fn(
      async (projectId: string, body: Record<string, unknown>) => {
        void projectId;
        state.diagnosticsCreated.push({ body });
        return {
          id: `diag-${state.diagnosticsCreated.length}`,
          ...body,
          created_at: new Date().toISOString(),
        } as never;
      },
    ),
  };
  return { mock, state };
}

interface ExecutorResponseScript {
  // Returns true = transport failure (throw with the given code); false = HTTP response with the given status
  type: 'http' | 'transport';
  status?: number;
  code?: string;
  data?: unknown;
}

function buildExecutorFromScript(
  script: ExecutorResponseScript[],
): {
  factory: NonNullable<TargetReplayDeps['createHttpExecutor']>;
  calls: number;
} {
  const calls = { n: 0 };
  const factory: NonNullable<TargetReplayDeps['createHttpExecutor']> = () => {
    const exec: SessionHttpExecutor = {
      request: jest.fn(async () => {
        const i = calls.n;
        calls.n += 1;
        const step = script[i] ?? script[script.length - 1];
        if (step.type === 'transport') {
          const err = new Error(`transport: ${step.code ?? 'ECONNREFUSED'}`);
          (err as unknown as { code: string }).code =
            step.code ?? 'ECONNREFUSED';
          throw err;
        }
        return {
          data: step.data ?? { ok: true },
          status: step.status ?? 200,
          statusText: '',
          headers: { 'content-type': 'application/json' },
          config: {} as never,
        } as never;
      }),
      requestWithAuthOverride: jest.fn(),
      setAuth: jest.fn(),
      dispose: jest.fn(),
    };
    return exec;
  };
  return {
    factory,
    get calls() {
      return calls.n;
    },
  };
}

function buildDeps(opts: {
  archMock: Record<string, unknown>;
  executor: NonNullable<TargetReplayDeps['createHttpExecutor']>;
  threshold?: number;
  runManager?: RunManager;
  secretsStore?: SecretsStore;
}): TargetReplayDeps {
  const secretsStore = opts.secretsStore ?? new SecretsStore();
  secretsStore.set({
    sessionId: SESSION_ID,
    api: { type: 'bearer', bearerToken: 'plaintext' },
    loadedAt: Date.now(),
  });
  const runManager = opts.runManager ?? new RunManager();
  if (!runManager.has(SESSION_ID)) {
    runManager.start({
      sessionId: SESSION_ID,
      projectId: PROJECT_ID,
      architectureId: ARCH_ID,
    });
  }
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    archModelClient: opts.archMock as any,
    secretsStore,
    runManager,
    createHttpExecutor: opts.executor,
    transportFailureThreshold: opts.threshold,
    now: () => 1700000000000,
  };
}

// ---------------------------------------------------------------------------
// Test 1: Happy-path -- 3 non-mutating items all return 200.
// ---------------------------------------------------------------------------
test('happy path replays every item and finalises the target baseline', async () => {
  const session = buildSession();
  const items = [
    buildItem(1, 'GET', '/widgets'),
    buildItem(2, 'GET', '/widgets/1'),
    buildItem(3, 'GET', '/widgets/2'),
  ];
  const { mock, state } = buildArchClientMock({
    session,
    sourceBaseline: buildSourceBaseline(),
    items,
  });
  const exec = buildExecutorFromScript([
    { type: 'http', status: 200 },
    { type: 'http', status: 200 },
    { type: 'http', status: 200 },
  ]);

  const outcome: TargetReplayOutcome = await runTargetReplay(
    SESSION_ID,
    buildDeps({ archMock: mock, executor: exec.factory }),
  );

  expect(outcome.finalStatus).toBe('completed');
  expect(outcome.itemsReplayed).toBe(3);
  expect(outcome.itemsSkipped).toBe(0);
  expect(outcome.itemsFailed).toBe(0);

  // A target baseline was created with kind=target + paired_with_baseline_id
  expect(state.baselinesCreated).toHaveLength(1);
  expect(state.baselinesCreated[0].body.kind).toBe('target');
  expect(state.baselinesCreated[0].body.paired_with_baseline_id).toBe(
    SOURCE_BASELINE_ID,
  );

  // 3 captures persisted; 3 PATCH accepted=true; 3 baseline-items written
  expect(state.capturesCreated).toHaveLength(3);
  expect(state.capturePatches).toHaveLength(3);
  for (const p of state.capturePatches) {
    expect(p.body.accepted).toBe(true);
  }
  expect(state.baselineItemsCreated).toHaveLength(3);

  // Session patched to completed; baseline patched to active.
  const finalSessionPatch = state.sessionPatches[state.sessionPatches.length - 1];
  expect(finalSessionPatch.body.status).toBe('completed');
  expect(state.baselinePatches).toHaveLength(1);
  expect(state.baselinePatches[0].body.status).toBe('active');
});

// ---------------------------------------------------------------------------
// Test 2: Mutating-skip -- POST is skipped, GETs replay.
// ---------------------------------------------------------------------------
test('mutating item is skipped with a diagnostic when mutating_calls_confirmed=false', async () => {
  const session = buildSession({ mutating_calls_confirmed: false });
  const items = [
    buildItem(1, 'GET', '/widgets'),
    buildItem(2, 'POST', '/widgets'),
    buildItem(3, 'GET', '/widgets/1'),
  ];
  const { mock, state } = buildArchClientMock({
    session,
    sourceBaseline: buildSourceBaseline(),
    items,
  });
  // Only 2 requests should be issued (the POST is skipped before any HTTP call)
  const exec = buildExecutorFromScript([
    { type: 'http', status: 200 },
    { type: 'http', status: 200 },
  ]);

  const outcome = await runTargetReplay(
    SESSION_ID,
    buildDeps({ archMock: mock, executor: exec.factory }),
  );

  expect(outcome.finalStatus).toBe('completed');
  expect(outcome.itemsReplayed).toBe(2);
  expect(outcome.itemsSkipped).toBe(1);
  expect(exec.calls).toBe(2);

  // The diagnostic was emitted with the right type
  const mutatingDiag = state.diagnosticsCreated.find(
    (d) =>
      (d.body.detail_json as { diagnosticType?: string })?.diagnosticType ===
      'mutating_skipped',
  );
  expect(mutatingDiag).toBeDefined();
  expect((mutatingDiag!.body.detail_json as { method: string }).method).toBe(
    'POST',
  );
});

// ---------------------------------------------------------------------------
// Test 3: HTTP 5xx is NOT a transport failure -- counter stays at 0.
// ---------------------------------------------------------------------------
test('HTTP 5xx is persisted as data and does not increment the transport counter', async () => {
  const session = buildSession();
  const items = [
    buildItem(1, 'GET', '/a'),
    buildItem(2, 'GET', '/b'),
    buildItem(3, 'GET', '/c'),
  ];
  const { mock, state } = buildArchClientMock({
    session,
    sourceBaseline: buildSourceBaseline(),
    items,
  });
  const exec = buildExecutorFromScript([
    { type: 'http', status: 500 },
    { type: 'http', status: 200 },
    { type: 'http', status: 503 },
  ]);

  const outcome = await runTargetReplay(
    SESSION_ID,
    buildDeps({
      archMock: mock,
      executor: exec.factory,
      threshold: 2, // would trip easily if 5xx counted
    }),
  );

  expect(outcome.finalStatus).toBe('completed');
  expect(outcome.itemsReplayed).toBe(3);
  expect(outcome.itemsFailed).toBe(0);
  // 3 captures persisted (even the 5xx ones)
  expect(state.capturesCreated).toHaveLength(3);
  expect(state.capturesCreated[0].body.response_status).toBe(500);
  expect(state.capturesCreated[2].body.response_status).toBe(503);
  // replay_non_2xx diagnostics emitted for both 5xx responses
  const non2xxDiags = state.diagnosticsCreated.filter(
    (d) =>
      (d.body.detail_json as { diagnosticType?: string })?.diagnosticType ===
      'replay_non_2xx',
  );
  expect(non2xxDiags.length).toBe(2);
});

// ---------------------------------------------------------------------------
// Test 4: 10 consecutive transport failures triggers
// TransportFailureThresholdExceededError -> session marked failed with
// target_unreachable.
// ---------------------------------------------------------------------------
test('threshold consecutive transport failures aborts the session with target_unreachable', async () => {
  const session = buildSession();
  // 15 items so the threshold (10) is reached before exhausting items
  const items = Array.from({ length: 15 }, (_, i) =>
    buildItem(i + 1, 'GET', `/${i + 1}`),
  );
  const { mock, state } = buildArchClientMock({
    session,
    sourceBaseline: buildSourceBaseline(),
    items,
  });
  const script: ExecutorResponseScript[] = Array.from(
    { length: 15 },
    () => ({ type: 'transport' as const, code: 'ETIMEDOUT' }),
  );
  const exec = buildExecutorFromScript(script);

  const outcome = await runTargetReplay(
    SESSION_ID,
    buildDeps({
      archMock: mock,
      executor: exec.factory,
      threshold: 10,
    }),
  );

  expect(outcome.finalStatus).toBe('failed');
  expect(outcome.errorMessage).toBe('target_unreachable');

  // The runner threw and was caught -- the session was patched to failed.
  const failedPatch = state.sessionPatches.find(
    (p) => p.body.status === 'failed',
  );
  expect(failedPatch).toBeDefined();
  expect(failedPatch!.body.error_message).toBe('target_unreachable');
});

// ---------------------------------------------------------------------------
// Test 5: Counter resets to zero on any successful HTTP response (including
// a 4xx). 9 failures, then a 4xx (success per axios since validateStatus is
// () => true), then 9 more failures -> threshold (10) never reached.
// ---------------------------------------------------------------------------
test('counter resets on successful HTTP response (including 4xx)', async () => {
  const session = buildSession();
  // 19 items: 9 transport failures, 1 HTTP 404 (success), 9 more transport.
  const items = Array.from({ length: 19 }, (_, i) =>
    buildItem(i + 1, 'GET', `/${i + 1}`),
  );
  const { mock } = buildArchClientMock({
    session,
    sourceBaseline: buildSourceBaseline(),
    items,
  });
  const script: ExecutorResponseScript[] = [
    ...Array.from({ length: 9 }, () => ({
      type: 'transport' as const,
      code: 'ENOTFOUND',
    })),
    { type: 'http', status: 404 },
    ...Array.from({ length: 9 }, () => ({
      type: 'transport' as const,
      code: 'ENOTFOUND',
    })),
  ];
  const exec = buildExecutorFromScript(script);

  const outcome = await runTargetReplay(
    SESSION_ID,
    buildDeps({
      archMock: mock,
      executor: exec.factory,
      threshold: 10,
    }),
  );

  // Threshold was never reached because the 404 reset the counter at index 9.
  expect(outcome.finalStatus).toBe('completed');
  expect(outcome.itemsReplayed).toBe(1); // only the 404 succeeded
  expect(outcome.itemsFailed).toBe(18);
});

// ---------------------------------------------------------------------------
// Test 6: Env-override threshold via TargetReplayDeps.transportFailureThreshold.
// Setting it to 2 means 2 consecutive transport failures abort.
// ---------------------------------------------------------------------------
test('transportFailureThreshold dep overrides the default threshold of 10', async () => {
  const session = buildSession();
  const items = Array.from({ length: 5 }, (_, i) =>
    buildItem(i + 1, 'GET', `/${i + 1}`),
  );
  const { mock, state } = buildArchClientMock({
    session,
    sourceBaseline: buildSourceBaseline(),
    items,
  });
  const script: ExecutorResponseScript[] = Array.from(
    { length: 5 },
    () => ({ type: 'transport' as const, code: 'ECONNREFUSED' }),
  );
  const exec = buildExecutorFromScript(script);

  const outcome = await runTargetReplay(
    SESSION_ID,
    buildDeps({
      archMock: mock,
      executor: exec.factory,
      threshold: 2,
    }),
  );
  expect(outcome.finalStatus).toBe('failed');
  expect(outcome.errorMessage).toBe('target_unreachable');
  // The executor should have been called exactly 2 times (threshold reached).
  expect(exec.calls).toBe(2);
  const failedPatch = state.sessionPatches.find(
    (p) => p.body.status === 'failed',
  );
  expect(failedPatch).toBeDefined();
});

// ---------------------------------------------------------------------------
// Test 7: Cancellation mid-run via runManager.cancel() before the second
// item. The runner exits cleanly, session patched to cancelled, remaining
// items not processed.
// ---------------------------------------------------------------------------
test('runManager.cancel() mid-run terminates cleanly with status=cancelled', async () => {
  const session = buildSession();
  const items = [
    buildItem(1, 'GET', '/a'),
    buildItem(2, 'GET', '/b'),
    buildItem(3, 'GET', '/c'),
  ];
  const { mock, state } = buildArchClientMock({
    session,
    sourceBaseline: buildSourceBaseline(),
    items,
  });

  const runManager = new RunManager();
  runManager.start({
    sessionId: SESSION_ID,
    projectId: PROJECT_ID,
    architectureId: ARCH_ID,
  });
  const calls = { n: 0 };
  const exec: NonNullable<TargetReplayDeps['createHttpExecutor']> = () => ({
    request: jest.fn(async () => {
      calls.n += 1;
      if (calls.n === 1) {
        // After the first request, simulate a cancel landing.
        runManager.cancel(SESSION_ID);
      }
      return {
        data: { ok: true },
        status: 200,
        statusText: '',
        headers: {},
        config: {} as never,
      } as never;
    }),
    requestWithAuthOverride: jest.fn(),
    setAuth: jest.fn(),
    dispose: jest.fn(),
  });

  const outcome = await runTargetReplay(SESSION_ID, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    archModelClient: mock as any,
    secretsStore: (() => {
      const s = new SecretsStore();
      s.set({
        sessionId: SESSION_ID,
        api: { type: 'none' },
        loadedAt: Date.now(),
      });
      return s;
    })(),
    runManager,
    createHttpExecutor: exec,
    transportFailureThreshold: 10,
    now: () => 1700000000000,
  });

  expect(outcome.finalStatus).toBe('cancelled');
  expect(outcome.itemsReplayed).toBe(1);
  // Only the first item should have been processed before cancel.
  expect(state.capturesCreated.length).toBe(1);

  const cancelledPatch = state.sessionPatches.find(
    (p) => p.body.status === 'cancelled',
  );
  expect(cancelledPatch).toBeDefined();
});

// ---------------------------------------------------------------------------
// Smoke: TransportFailureThresholdExceededError carries the threshold +
// last-error code so callers can surface a meaningful message.
// ---------------------------------------------------------------------------
test('TransportFailureThresholdExceededError exposes threshold + lastErrorCode', () => {
  const e = new TransportFailureThresholdExceededError(10, 'ETIMEDOUT');
  expect(e.threshold).toBe(10);
  expect(e.lastErrorCode).toBe('ETIMEDOUT');
  expect(e.name).toBe('TransportFailureThresholdExceededError');
  expect(e.message).toContain('10 consecutive');
});
