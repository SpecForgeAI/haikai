/**
 * Deterministic ordered-step sequence replay sub-runner unit tests.
 *
 * Spec: 2026-06-18 Stateful Sequence Scenarios (Spec D) -- Task Group 3,
 * sub-task 3.1.
 *
 * Focused inventory (the load-bearing reconcile-side invariants):
 *   1. Ref resolution: a `$<step>.<jsonpath>` ref resolves from a prior step's
 *      LIVE response and threads into a later step's request (path + body).
 *   2. Setup-fail: a setup step missing its `expected_status` fails the whole
 *      sequence with `sequence_setup_failed`; the ACT step is NOT reached / NOT
 *      promoted (nothing diffed).
 *   3. Act-step promotion: the act response promotes to a target baseline-item
 *      with the Spec B `{ headers, body }` wrapper at the act step's pairKey
 *      (`${method}|${path}|${scenarioName}`).
 *   4. Act-step diff via existing fidelity: the promoted act item, paired with
 *      the source item + its ref-derived volatile envelope, tolerates a changed
 *      generated id but STILL breaks on a genuinely-changed non-volatile field
 *      (reusing `compareJsonShapes` -- no new diff engine).
 *   5. Skip gate: a sequence without `mutating_calls_confirmed` emits the
 *      DISTINCT `sequence_skipped` (NOT the generic `mutating_skipped`) and is
 *      never silently dropped; the act is not promoted.
 *   6. Cleanup-fail: a non-2xx cleanup step flags `sequence_cleanup_failed` +
 *      residual pollution WITHOUT failing the sequence or crashing the runner;
 *      the act still replayed.
 *   7. Dispatch: a non-sequence item (sequence_json null) takes the EXISTING
 *      single-shot path byte-for-byte (no sub-runner promotion shape change).
 */

import {
  replaySequenceItem,
  resolveJsonPath,
  parseSequenceJson,
  type SequenceReplayResult,
} from '../services/sequenceReplayRunner';
import { compareJsonShapes, type VolatilityContext } from '../services/jsonShapeComparator';
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
const TARGET_BASELINE_ID = '00000000-0000-0000-0000-0000000000ee';

function buildSession(overrides: Partial<CaptureSessionDto> = {}): CaptureSessionDto {
  const now = new Date().toISOString();
  return {
    id: SESSION_ID,
    project_id: PROJECT_ID,
    architecture_id: ARCH_ID,
    name: 'target-replay-seq',
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
    source_baseline_id: '00000000-0000-0000-0000-0000000000dd',
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function buildTargetBaseline(): BaselineDto {
  const now = new Date().toISOString();
  return {
    id: TARGET_BASELINE_ID,
    project_id: PROJECT_ID,
    architecture_id: ARCH_ID,
    session_id: SESSION_ID,
    name: 'target-baseline',
    status: 'draft',
    accepted_capture_count: 0,
    operation_count: 1,
    notes: null,
    kind: 'target',
    paired_with_baseline_id: '00000000-0000-0000-0000-0000000000dd',
    created_at: now,
    updated_at: now,
  };
}

/**
 * The source baseline item carrying `sequence_json`. The ACT step is the
 * single behaviour-under-test; the item IS the act step's oracle row (its
 * scenario_name/method/path is the pairKey the promoted act item must match).
 */
function buildSequenceItem(
  sequenceJson: Record<string, unknown> | null,
  overrides: Partial<BaselineItemDto> = {},
): BaselineItemDto {
  const now = new Date().toISOString();
  return {
    id: 'seq-item-1',
    baseline_id: '00000000-0000-0000-0000-0000000000dd',
    capture_id: 'cap-act',
    operation_id: 'op-submit',
    scenario_id: 'scen-submit',
    method: 'POST',
    path: '/filters/submitForReview',
    scenario_name: 'happy_path',
    request_json: { query: null, headers: null, body: { ref: '$0.id' } },
    response_status: 200,
    response_json: { headers: {}, body: { ok: true, filterId: 'F-1' } },
    business_notes: null,
    sequence_json: sequenceJson,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

interface ArchMockState {
  capturesCreated: Array<Record<string, unknown>>;
  capturePatches: Array<{ id: string; body: Record<string, unknown> }>;
  baselineItemsCreated: Array<Record<string, unknown>>;
}

function buildArchMock(): { mock: Record<string, unknown>; state: ArchMockState } {
  const state: ArchMockState = {
    capturesCreated: [],
    capturePatches: [],
    baselineItemsCreated: [],
  };
  let captureCount = 0;
  const mock = {
    createCapture: jest.fn(async (projectId: string, body: Record<string, unknown>) => {
      void projectId;
      state.capturesCreated.push(body);
      captureCount += 1;
      return {
        id: `cap-row-${captureCount}`,
        response_headers_redacted_json: body.response_headers_redacted_json ?? null,
        response_body_json: body.response_body_json ?? null,
      } as unknown as CaptureDto;
    }),
    patchCapture: jest.fn(async (projectId: string, id: string, body: Record<string, unknown>) => {
      void projectId;
      state.capturePatches.push({ id, body });
      return { id } as unknown as CaptureDto;
    }),
    createBaselineItem: jest.fn(async (projectId: string, body: Record<string, unknown>) => {
      void projectId;
      state.baselineItemsCreated.push(body);
      return { id: `target-item-${state.baselineItemsCreated.length}`, ...body } as unknown as BaselineItemDto;
    }),
  };
  return { mock, state };
}

/**
 * Scripted executor keyed on `${METHOD} ${path}` substring -> response. Records
 * each sent request so a test can assert the resolved (ref-substituted) request.
 */
function buildScriptedExecutor(
  script: Array<{ match: (req: { method: string; url: string }) => boolean; status: number; data?: unknown; throwCode?: string }>,
): { executor: SessionHttpExecutor; sent: Array<{ method: string; url: string; data: unknown; params: unknown }> } {
  const sent: Array<{ method: string; url: string; data: unknown; params: unknown }> = [];
  const executor: SessionHttpExecutor = {
    request: jest.fn(async (config: { method?: string; url?: string; data?: unknown; params?: unknown }) => {
      const method = (config.method ?? 'GET').toString().toUpperCase();
      const url = config.url ?? '';
      sent.push({ method, url, data: config.data, params: config.params });
      const step = script.find((s) => s.match({ method, url }));
      if (!step) throw new Error(`no scripted response for ${method} ${url}`);
      if (step.throwCode) {
        const err = new Error(`transport: ${step.throwCode}`);
        (err as unknown as { code: string }).code = step.throwCode;
        throw err;
      }
      return {
        data: step.data ?? { ok: true },
        status: step.status,
        statusText: '',
        headers: { 'content-type': 'application/json' },
        config: {} as never,
      } as never;
    }),
    requestWithAuthOverride: jest.fn(),
    setAuth: jest.fn(),
    dispose: jest.fn(),
  };
  return { executor, sent };
}

// ---------------------------------------------------------------------------
// Test 1: ref resolution -- $0.id from setup's live response threads into act.
// ---------------------------------------------------------------------------
test('resolves $<step>.<jsonpath> refs from a prior live response into a later step', async () => {
  const sequenceJson = {
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
        // The act references the setup's generated id in BOTH the path and body.
        request: {
          method: 'POST',
          path: '/filters/$0.id/submitForReview',
          query: null,
          headers: null,
          body: { filterId: '$0.id' },
        },
        expected_status: 200,
        response_refs: [{ ref: '$0.id', from_step: 0, json_path: 'id' }],
      },
    ],
    act_step_index: 1,
    cleanup_best_effort: true,
  };
  const { mock, state } = buildArchMock();
  const { executor, sent } = buildScriptedExecutor([
    { match: (r) => r.method === 'POST' && r.url === '/filters', status: 201, data: { id: 'F-LIVE-99' } },
    { match: (r) => r.method === 'POST' && r.url.includes('submitForReview'), status: 200, data: { ok: true } },
  ]);

  const result: SequenceReplayResult = await replaySequenceItem(
    buildSequenceItem(sequenceJson),
    buildSession(),
    buildTargetBaseline(),
    executor,
    { archModelClient: mock as never },
  );

  expect(result.setupFailed).toBe(false);
  expect(result.actReplayed).toBe(true);
  // The act request resolved $0.id (live 'F-LIVE-99') into both path + body.
  const actSent = sent.find((s) => s.url.includes('submitForReview'));
  expect(actSent).toBeDefined();
  expect(actSent!.url).toBe('/filters/F-LIVE-99/submitForReview');
  expect(actSent!.data).toEqual({ filterId: 'F-LIVE-99' });
  // The act item was promoted with the resolved request body.
  expect(state.baselineItemsCreated).toHaveLength(1);
});

// resolveJsonPath unit coverage for the ref-resolution helper.
test('resolveJsonPath handles nested + array + bracket paths', () => {
  expect(resolveJsonPath({ id: 'x' }, 'id')).toBe('x');
  expect(resolveJsonPath({ data: { id: 'y' } }, 'data.id')).toBe('y');
  expect(resolveJsonPath({ items: [{ id: 'z' }] }, 'items[0].id')).toBe('z');
  expect(resolveJsonPath({ id: 'x' }, 'missing')).toBeUndefined();
  expect(resolveJsonPath({ id: 'x' }, '$0.id')).toBe('x');
});

// ---------------------------------------------------------------------------
// Test 2: setup-fail -> sequence_setup_failed, act NOT reached / NOT promoted.
// ---------------------------------------------------------------------------
test('a setup step missing its expected_status fails the sequence; the act is not diffed', async () => {
  const sequenceJson = {
    steps: [
      {
        index: 0,
        role: 'setup',
        kind: 'http',
        request: { method: 'POST', path: '/filters', query: null, headers: null, body: {} },
        expected_status: 201,
        response_refs: [],
      },
      {
        index: 1,
        role: 'act',
        kind: 'http',
        request: { method: 'POST', path: '/filters/submitForReview', query: null, headers: null, body: {} },
        expected_status: 200,
        response_refs: [],
      },
    ],
    act_step_index: 1,
    cleanup_best_effort: true,
  };
  const { mock, state } = buildArchMock();
  const { executor, sent } = buildScriptedExecutor([
    // Setup returns 500 instead of the expected 201.
    { match: (r) => r.url === '/filters', status: 500, data: { error: 'boom' } },
    { match: (r) => r.url.includes('submitForReview'), status: 200, data: { ok: true } },
  ]);

  const result = await replaySequenceItem(
    buildSequenceItem(sequenceJson),
    buildSession(),
    buildTargetBaseline(),
    executor,
    { archModelClient: mock as never },
  );

  expect(result.setupFailed).toBe(true);
  expect(result.actReplayed).toBe(false);
  expect(result.diagnostics.map((d) => d.diagnosticType)).toContain('sequence_setup_failed');
  // The act step was NEVER sent (only the setup), and NOTHING was promoted.
  expect(sent.some((s) => s.url.includes('submitForReview'))).toBe(false);
  expect(state.baselineItemsCreated).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// Test 3 + 4: act-step promotion shape + diff via existing Spec B fidelity.
// ---------------------------------------------------------------------------
test('act step promotes to a {headers,body} target item at the act pairKey, diffed via existing fidelity', async () => {
  const sequenceJson = {
    steps: [
      {
        index: 0,
        role: 'setup',
        kind: 'http',
        request: { method: 'POST', path: '/filters', query: null, headers: null, body: {} },
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
  };
  // The source item's response carries the ORIGINAL act body + a ref-derived
  // volatile envelope (generated id at /filterId tolerated).
  const sourceItem = buildSequenceItem(sequenceJson, {
    response_json: { headers: {}, body: { ok: true, filterId: 'F-ORIGINAL', status: 'pending' } },
    volatile_paths_json: { paths: ['/filterId'], volatility_source: 'declared', k: 0 },
  });

  const { mock, state } = buildArchMock();
  const { executor } = buildScriptedExecutor([
    { match: (r) => r.url === '/filters', status: 201, data: { id: 'F-LIVE' } },
    // The target act response: SAME shape, generated id CHANGED, status SAME.
    {
      match: (r) => r.url.includes('submitForReview'),
      status: 200,
      data: { ok: true, filterId: 'F-LIVE', status: 'pending' },
    },
  ]);

  const result = await replaySequenceItem(sourceItem, buildSession(), buildTargetBaseline(), executor, { archModelClient: mock as never });
  expect(result.actReplayed).toBe(true);

  // Promotion shape: { headers, body } wrapper at the act pairKey.
  expect(state.baselineItemsCreated).toHaveLength(1);
  const promoted = state.baselineItemsCreated[0];
  expect(promoted.baseline_id).toBe(TARGET_BASELINE_ID);
  expect(promoted.method).toBe('POST');
  expect(promoted.path).toBe('/filters/submitForReview');
  expect(promoted.scenario_name).toBe('happy_path');
  const promotedResponse = promoted.response_json as { headers: unknown; body: unknown };
  expect(promotedResponse).toHaveProperty('headers');
  expect(promotedResponse).toHaveProperty('body');
  expect(promotedResponse.body).toEqual({ ok: true, filterId: 'F-LIVE', status: 'pending' });

  // --- Diff via the EXISTING Spec B machinery (mirrors diffRunner verbatim) ---
  const volatilityCtx: VolatilityContext = {
    envelope: { paths: ['/filterId'], volatility_source: 'declared', k: 0 },
    endpointSignal: false,
    applyHeuristics: false,
  };
  // Generated-id change tolerated -> body_match (NOT a false break).
  const tolerated = compareJsonShapes(sourceItem.response_json, promoted.response_json, volatilityCtx);
  expect(tolerated.bodyClassification).toBe('body_match');

  // A genuinely-changed NON-volatile field (status) STILL breaks.
  const realChange = compareJsonShapes(
    sourceItem.response_json,
    { headers: {}, body: { ok: true, filterId: 'F-LIVE', status: 'rejected' } },
    volatilityCtx,
  );
  expect(realChange.bodyClassification).toBe('body_value_drift');
});

// ---------------------------------------------------------------------------
// Test 5: skip gate -- no mutating_calls_confirmed -> sequence_skipped.
// ---------------------------------------------------------------------------
test('a sequence without mutating_calls_confirmed emits sequence_skipped (not mutating_skipped) and is not promoted', async () => {
  const sequenceJson = {
    steps: [
      {
        index: 0,
        role: 'act',
        kind: 'http',
        request: { method: 'POST', path: '/filters/submitForReview', query: null, headers: null, body: {} },
        expected_status: 200,
        response_refs: [],
      },
    ],
    act_step_index: 0,
    cleanup_best_effort: true,
  };
  const { mock, state } = buildArchMock();
  const { executor } = buildScriptedExecutor([
    { match: () => true, status: 200, data: { ok: true } },
  ]);

  const result = await replaySequenceItem(
    buildSequenceItem(sequenceJson),
    buildSession({ mutating_calls_confirmed: false }),
    buildTargetBaseline(),
    executor,
    { archModelClient: mock as never },
  );

  expect(result.skipped).toBe(true);
  expect(result.actReplayed).toBe(false);
  const types = result.diagnostics.map((d) => d.diagnosticType);
  expect(types).toContain('sequence_skipped');
  expect(types).not.toContain('mutating_skipped');
  // No HTTP call made; nothing promoted (the executor was never invoked).
  expect(state.baselineItemsCreated).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// Test 6: cleanup-fail -> flagged, sequence NOT failed, runner NOT crashed.
// ---------------------------------------------------------------------------
test('a failing cleanup step flags sequence_cleanup_failed + residual pollution without failing the sequence', async () => {
  const sequenceJson = {
    steps: [
      {
        index: 0,
        role: 'act',
        kind: 'http',
        request: { method: 'POST', path: '/filters', query: null, headers: null, body: {} },
        expected_status: 201,
        response_refs: [],
      },
      {
        index: 1,
        role: 'cleanup',
        kind: 'http',
        request: { method: 'DELETE', path: '/filters/$0.id', query: null, headers: null, body: null },
        expected_status: 204,
        response_refs: [{ ref: '$0.id', from_step: 0, json_path: 'id' }],
      },
    ],
    act_step_index: 0,
    cleanup_best_effort: true,
  };
  const { mock, state } = buildArchMock();
  const { executor, sent } = buildScriptedExecutor([
    { match: (r) => r.method === 'POST' && r.url === '/filters', status: 201, data: { id: 'F-LIVE' } },
    // Cleanup DELETE fails (500): best-effort -> flagged, not a sequence failure.
    { match: (r) => r.method === 'DELETE', status: 500, data: { error: 'cannot delete' } },
  ]);

  const result = await replaySequenceItem(
    buildSequenceItem(sequenceJson, { method: 'POST', path: '/filters' }),
    buildSession(),
    buildTargetBaseline(),
    executor,
    { archModelClient: mock as never },
  );

  // The sequence did NOT fail: the act replayed + was promoted.
  expect(result.setupFailed).toBe(false);
  expect(result.actReplayed).toBe(true);
  expect(state.baselineItemsCreated).toHaveLength(1);
  // Cleanup failure flagged as a diagnostic + result flags.
  expect(result.cleanupFailed).toBe(true);
  expect(result.residualPollution).toBe(true);
  expect(result.diagnostics.map((d) => d.diagnosticType)).toContain('sequence_cleanup_failed');
  // The cleanup DELETE resolved $0.id from the act's live response.
  const del = sent.find((s) => s.method === 'DELETE');
  expect(del!.url).toBe('/filters/F-LIVE');
});

// A created resource with NO cleanup step flags bounded residual pollution.
test('a created resource with no cleanup step flags sequence_residual_pollution', async () => {
  const sequenceJson = {
    steps: [
      {
        index: 0,
        role: 'act',
        kind: 'http',
        request: { method: 'POST', path: '/filters', query: null, headers: null, body: {} },
        expected_status: 201,
        response_refs: [],
      },
    ],
    act_step_index: 0,
    cleanup_best_effort: true,
  };
  const { mock } = buildArchMock();
  const { executor } = buildScriptedExecutor([
    { match: (r) => r.method === 'POST', status: 201, data: { id: 'F-NEW' } },
  ]);

  const result = await replaySequenceItem(
    buildSequenceItem(sequenceJson, { method: 'POST', path: '/filters' }),
    buildSession(),
    buildTargetBaseline(),
    executor,
    { archModelClient: mock as never },
  );

  expect(result.actReplayed).toBe(true);
  expect(result.residualPollution).toBe(true);
  expect(result.diagnostics.map((d) => d.diagnosticType)).toContain('sequence_residual_pollution');
});

// ---------------------------------------------------------------------------
// parseSequenceJson rejects structurally-unusable blobs (defensive guard).
// ---------------------------------------------------------------------------
test('parseSequenceJson returns null for structurally-invalid sequences', () => {
  expect(parseSequenceJson(null)).toBeNull();
  expect(parseSequenceJson({ steps: [] })).toBeNull();
  expect(parseSequenceJson({ steps: [{ index: 0, role: 'setup', kind: 'http', request: {}, expected_status: 200 }], act_step_index: 5 })).toBeNull();
  // act_step_index points at a non-act step.
  expect(
    parseSequenceJson({
      steps: [{ index: 0, role: 'setup', kind: 'http', request: {}, expected_status: 200 }],
      act_step_index: 0,
    }),
  ).toBeNull();
});
