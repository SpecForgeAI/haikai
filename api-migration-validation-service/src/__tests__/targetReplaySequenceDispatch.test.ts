/**
 * Cross-layer integration: `runTargetReplay` sequence DISPATCH branch
 * (Stateful Sequence Scenarios, Spec D -- Task Group 5, gap fill).
 *
 * The reconcile sub-runner (`replaySequenceItem`) is unit-tested in isolation
 * by `sequenceReplayRunner.test.ts`, but the DISPATCH wiring in
 * `targetReplayRunner.runTargetReplay` (`item.sequence_json != null` ->
 * sub-runner; diagnostics folded + persisted via `emitDiagnostic`; counters
 * accounted) is NOT exercised anywhere. This file closes that seam end-to-end
 * through the REAL runner shell with mocked AMS + a scripted executor, mirroring
 * the conventions of `targetReplayRunner.test.ts`.
 *
 * Three load-bearing dispatch invariants:
 *   1. A sequence-bearing item is routed to the sub-runner, its act response is
 *      promoted to the target baseline, and it counts as itemsReplayed; the
 *      setup ref ($0.id) resolves through the live executor end-to-end.
 *   2. A sequence without `mutating_calls_confirmed` is routed to the sub-runner,
 *      which counts it as itemsSkipped and persists a DISTINCT `sequence_skipped`
 *      AMS diagnostic (an `endpoint_skipped`, NOT the generic `mutating_skipped`)
 *      -- never silently dropped, never an HTTP call.
 *   3. NO REGRESSION: a MIXED baseline (one single-shot GET + one sequence item)
 *      replays the single-shot item via the existing byte-for-byte path while the
 *      sequence item dispatches to the sub-runner; both promote, both count.
 */

import { runTargetReplay } from '../services/targetReplayRunner';
import type { TargetReplayDeps } from '../services/targetReplayRunner';
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

function buildSession(overrides: Partial<CaptureSessionDto> = {}): CaptureSessionDto {
  const now = new Date().toISOString();
  return {
    id: SESSION_ID,
    project_id: PROJECT_ID,
    architecture_id: ARCH_ID,
    name: 'target-replay-seq-dispatch',
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
    name: 'source-baseline-seq',
    status: 'active',
    accepted_capture_count: 2,
    operation_count: 2,
    notes: null,
    kind: 'current',
    paired_with_baseline_id: null,
    created_at: now,
    updated_at: now,
  };
}

function buildSingleShotItem(): BaselineItemDto {
  const now = new Date().toISOString();
  return {
    id: 'item-single',
    baseline_id: SOURCE_BASELINE_ID,
    capture_id: 'cap-single',
    operation_id: 'op-single',
    scenario_id: 'scen-single',
    method: 'GET',
    path: '/widgets',
    scenario_name: 'happy_path',
    request_json: { query: null, headers: null, body: null },
    response_status: 200,
    response_json: { headers: {}, body: { ok: true } },
    business_notes: null,
    sequence_json: null,
    created_at: now,
    updated_at: now,
  };
}

/** The act-step oracle row carrying a setup->act sequence_json (with a $0.id ref). */
function buildSequenceItem(): BaselineItemDto {
  const now = new Date().toISOString();
  return {
    id: 'item-seq',
    baseline_id: SOURCE_BASELINE_ID,
    capture_id: 'cap-seq-act',
    operation_id: 'op-seq',
    scenario_id: 'scen-seq',
    method: 'POST',
    path: '/filters/submitForReview',
    scenario_name: 'submit_for_review_stateful',
    request_json: { query: null, headers: null, body: { filterId: '$0.id' } },
    response_status: 200,
    response_json: { headers: {}, body: { status: 'IN_REVIEW' } },
    business_notes: null,
    sequence_json: {
      steps: [
        {
          index: 0,
          role: 'setup',
          kind: 'http',
          request: { method: 'POST', path: '/filters', query: null, headers: null, body: { name: 'draft' } },
          expected_status: 201,
          response_refs: [],
        },
        {
          index: 1,
          role: 'act',
          kind: 'http',
          request: { method: 'POST', path: '/filters/submitForReview', query: null, headers: null, body: { filterId: '$0.id' } },
          expected_status: 200,
          response_refs: [{ ref: '$0.id', from_step: 0, json_path: 'id' }],
        },
      ],
      act_step_index: 1,
      cleanup_best_effort: true,
    },
    created_at: now,
    updated_at: now,
  };
}

interface MockState {
  capturesCreated: Array<Record<string, unknown>>;
  baselineItemsCreated: Array<Record<string, unknown>>;
  diagnosticsCreated: Array<Record<string, unknown>>;
}

function buildArchMock(opts: {
  session: CaptureSessionDto;
  sourceBaseline: BaselineDto;
  items: BaselineItemDto[];
}): { mock: Record<string, unknown>; state: MockState } {
  const state: MockState = {
    capturesCreated: [],
    baselineItemsCreated: [],
    diagnosticsCreated: [],
  };
  let captureCount = 0;
  let baselineCount = 0;
  const mock = {
    listAllCaptureSessionsByStatus: jest.fn(async (status: string) =>
      status === 'running' ? [opts.session] : [],
    ),
    getCaptureSession: jest.fn(async () => opts.session),
    getBaseline: jest.fn(async () => opts.sourceBaseline),
    listBaselineItems: jest.fn(async () => opts.items),
    createBaseline: jest.fn(async (_p: string, body: Record<string, unknown>) => {
      baselineCount += 1;
      return {
        id: `target-baseline-${baselineCount}`,
        project_id: PROJECT_ID,
        architecture_id: ARCH_ID,
        session_id: opts.session.id,
        name: (body.name as string) ?? null,
        status: 'draft',
        accepted_capture_count: null,
        operation_count: null,
        notes: null,
        kind: 'target',
        paired_with_baseline_id: SOURCE_BASELINE_ID,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as BaselineDto;
    }),
    patchBaseline: jest.fn(async (_p: string, id: string, body: Record<string, unknown>) => ({ id, ...body }) as unknown as BaselineDto),
    createCapture: jest.fn(async (_p: string, body: Record<string, unknown>) => {
      state.capturesCreated.push(body);
      captureCount += 1;
      return {
        id: `cap-row-${captureCount}`,
        response_headers_redacted_json: body.response_headers_redacted_json ?? null,
        response_body_json: body.response_body_json ?? null,
      } as unknown as CaptureDto;
    }),
    patchCapture: jest.fn(async (_p: string, id: string, body: Record<string, unknown>) => ({ id, ...body }) as unknown as CaptureDto),
    createBaselineItem: jest.fn(async (_p: string, body: Record<string, unknown>) => {
      state.baselineItemsCreated.push(body);
      return { id: `target-item-${state.baselineItemsCreated.length}`, ...body } as unknown as BaselineItemDto;
    }),
    patchCaptureSession: jest.fn(async (_p: string, id: string, body: Record<string, unknown>) => ({ ...opts.session, ...body, id }) as CaptureSessionDto),
    createDiagnostic: jest.fn(async (_p: string, body: Record<string, unknown>) => {
      state.diagnosticsCreated.push(body);
      return { id: `diag-${state.diagnosticsCreated.length}`, ...body } as never;
    }),
  };
  return { mock, state };
}

/** A scripted executor keyed on `${METHOD} ${url}` substring. */
function buildExecutor(
  script: Array<{ match: (r: { method: string; url: string }) => boolean; status: number; data?: unknown }>,
): { factory: NonNullable<TargetReplayDeps['createHttpExecutor']>; sent: Array<{ method: string; url: string; data: unknown }> } {
  const sent: Array<{ method: string; url: string; data: unknown }> = [];
  const factory: NonNullable<TargetReplayDeps['createHttpExecutor']> = () => {
    const exec: SessionHttpExecutor = {
      request: jest.fn(async (config: { method?: string; url?: string; data?: unknown }) => {
        const method = (config.method ?? 'GET').toString().toUpperCase();
        const url = config.url ?? '';
        sent.push({ method, url, data: config.data });
        const step = script.find((s) => s.match({ method, url }));
        if (!step) throw new Error(`no scripted response for ${method} ${url}`);
        return { data: step.data ?? { ok: true }, status: step.status, statusText: '', headers: { 'content-type': 'application/json' }, config: {} as never } as never;
      }),
      requestWithAuthOverride: jest.fn(),
      setAuth: jest.fn(),
      dispose: jest.fn(),
    };
    return exec;
  };
  return { factory, sent };
}

function buildDeps(opts: {
  archMock: Record<string, unknown>;
  executor: NonNullable<TargetReplayDeps['createHttpExecutor']>;
}): TargetReplayDeps {
  const secretsStore = new SecretsStore();
  secretsStore.set({ sessionId: SESSION_ID, api: { type: 'bearer', bearerToken: 'plaintext' }, loadedAt: Date.now() });
  const runManager = new RunManager();
  runManager.start({ sessionId: SESSION_ID, projectId: PROJECT_ID, architectureId: ARCH_ID });
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    archModelClient: opts.archMock as any,
    secretsStore,
    runManager,
    createHttpExecutor: opts.executor,
    now: () => 1700000000000,
  };
}

// ---------------------------------------------------------------------------
// 1. Dispatch: a sequence item is routed to the sub-runner + promoted.
// ---------------------------------------------------------------------------
test('runTargetReplay dispatches a sequence item to the sub-runner, resolves $0.id end-to-end, promotes the act, counts itemsReplayed', async () => {
  const session = buildSession();
  const { mock, state } = buildArchMock({ session, sourceBaseline: buildSourceBaseline(), items: [buildSequenceItem()] });
  const { factory, sent } = buildExecutor([
    { match: (r) => r.method === 'POST' && r.url === '/filters', status: 201, data: { id: 'flt-LIVE-7' } },
    { match: (r) => r.url.includes('submitForReview'), status: 200, data: { status: 'IN_REVIEW' } },
  ]);

  const outcome = await runTargetReplay(SESSION_ID, buildDeps({ archMock: mock, executor: factory }));

  expect(outcome.finalStatus).toBe('completed');
  expect(outcome.itemsReplayed).toBe(1);
  expect(outcome.itemsSkipped).toBe(0);
  expect(outcome.itemsFailed).toBe(0);

  // The setup's live id resolved into the act body end-to-end ($0.id -> flt-LIVE-7).
  const actSent = sent.find((s) => s.url.includes('submitForReview'));
  expect(actSent).toBeDefined();
  expect(actSent!.data).toEqual({ filterId: 'flt-LIVE-7' });

  // Exactly ONE baseline-item promoted (the act step) at the act pairKey.
  expect(state.baselineItemsCreated).toHaveLength(1);
  expect(state.baselineItemsCreated[0].scenario_name).toBe('submit_for_review_stateful');
  expect(state.baselineItemsCreated[0].path).toBe('/filters/submitForReview');
});

// ---------------------------------------------------------------------------
// 2. Skip gate through dispatch: sequence_skipped persisted as endpoint_skipped.
// ---------------------------------------------------------------------------
test('runTargetReplay routes an unconfirmed sequence to the sub-runner -> itemsSkipped + a sequence_skipped endpoint_skipped diagnostic (no HTTP call)', async () => {
  const session = buildSession({ mutating_calls_confirmed: false });
  const { mock, state } = buildArchMock({ session, sourceBaseline: buildSourceBaseline(), items: [buildSequenceItem()] });
  const { factory, sent } = buildExecutor([{ match: () => true, status: 200 }]);

  const outcome = await runTargetReplay(SESSION_ID, buildDeps({ archMock: mock, executor: factory }));

  expect(outcome.finalStatus).toBe('completed');
  expect(outcome.itemsSkipped).toBe(1);
  expect(outcome.itemsReplayed).toBe(0);
  // No HTTP call was made for the sequence; nothing promoted.
  expect(sent).toHaveLength(0);
  expect(state.baselineItemsCreated).toHaveLength(0);

  // The DISTINCT sequence_skipped diagnostic was persisted as an endpoint_skipped
  // AMS diagnostic (not the generic per-call mutating_skipped).
  const skipDiag = state.diagnosticsCreated.find(
    (d) => (d.detail_json as { diagnosticType?: string })?.diagnosticType === 'sequence_skipped',
  );
  expect(skipDiag).toBeDefined();
  expect(skipDiag!.diagnostic_type).toBe('endpoint_skipped');
  expect(
    state.diagnosticsCreated.some(
      (d) => (d.detail_json as { diagnosticType?: string })?.diagnosticType === 'mutating_skipped',
    ),
  ).toBe(false);
});

// ---------------------------------------------------------------------------
// 3. No regression: a MIXED baseline coexists -- single-shot unchanged path +
//    sequence dispatched -- both promote, both count.
// ---------------------------------------------------------------------------
test('runTargetReplay handles a mixed baseline: single-shot via the unchanged path + sequence via the sub-runner (no regression)', async () => {
  const session = buildSession();
  const { mock, state } = buildArchMock({
    session,
    sourceBaseline: buildSourceBaseline(),
    items: [buildSingleShotItem(), buildSequenceItem()],
  });
  const { factory, sent } = buildExecutor([
    { match: (r) => r.method === 'GET' && r.url === '/widgets', status: 200, data: { ok: true } },
    { match: (r) => r.method === 'POST' && r.url === '/filters', status: 201, data: { id: 'flt-LIVE-9' } },
    { match: (r) => r.url.includes('submitForReview'), status: 200, data: { status: 'IN_REVIEW' } },
  ]);

  const outcome = await runTargetReplay(SESSION_ID, buildDeps({ archMock: mock, executor: factory }));

  expect(outcome.finalStatus).toBe('completed');
  // Both items replayed (1 single-shot + 1 sequence act).
  expect(outcome.itemsReplayed).toBe(2);
  expect(outcome.itemsSkipped).toBe(0);
  expect(outcome.itemsFailed).toBe(0);

  // The single-shot GET went out exactly as today (one GET /widgets).
  expect(sent.filter((s) => s.method === 'GET' && s.url === '/widgets')).toHaveLength(1);
  // The sequence ran its setup POST + act POST (the $0.id resolved).
  const actSent = sent.find((s) => s.url.includes('submitForReview'));
  expect(actSent!.data).toEqual({ filterId: 'flt-LIVE-9' });

  // Two baseline-items promoted: the single-shot item + the sequence act item.
  expect(state.baselineItemsCreated).toHaveLength(2);
  const promotedPaths = state.baselineItemsCreated.map((b) => b.path).sort();
  expect(promotedPaths).toEqual(['/filters/submitForReview', '/widgets']);
});
