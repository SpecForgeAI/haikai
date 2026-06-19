/**
 * Stateful Sequence Scenarios (Spec D) -- capture-layer focused tests.
 *
 * Spec: 2026-06-18 Stateful Sequence Scenarios -- Task Group 2.
 *
 * Scope (focused -- 2..8 tests):
 *   1. `pin_sequence` validates a good setup->act->cleanup declaration and
 *      records it; rejects malformed input (no act / two acts, a ref to a
 *      LATER step, a non-http kind) with a `ToolValidationError`.
 *   2. `assembleSequenceJson` produces a well-formed R1 `sequence_json` from a
 *      pin declaration + ordered captures (steps, act_step_index,
 *      cleanup_best_effort, $N.<path> refs with parsed from_step/json_path).
 *   3. `deriveSequenceVolatilePaths` records the referenced `$N.<path>` fields +
 *      the extractIdentifierFacts generated-id paths into the volatile envelope,
 *      and a genuinely non-volatile field is NOT marked volatile.
 *   4. A sequence is ONE coverage dimension through the real orchestrator (no
 *      N-dimension inflation); a non-sequence scenario is unaffected.
 */

import { pinSequenceTool } from '../services/tools/pin_sequence';
import { ToolValidationError, type ToolExecutionContext } from '../services/tools';
import { runManager } from '../services/runManager';
import type { ScenarioCaptureData } from '../services/runManager';
import {
  assembleSequenceJson,
  deriveSequenceVolatilePaths,
} from '../services/sequenceAssembly';
import {
  orchestrateCaptureSession,
  defaultScenarioSet,
} from '../services/captureSessionOrchestrator';
import { toCaptureSession } from '../services/archModelClient';
import { secretsStore } from '../services/secretsStore';
import type { CaptureSession } from '../types/captureSession';
import type {
  CaptureSessionDto,
  OperationDto,
} from '../services/archModelClient';
import type { ParsedOasInventory } from '../types/oas';
import type { AssistantMessage } from '../types/llm';

const SESSION_ID = 'session-seq-1';
const PROJECT_ID = 'proj-seq-1';
const ARCH_ID = 'arch-seq-1';
const SCENARIO_ID = 'scenario-seq-1';

function buildToolSession(overrides: Partial<CaptureSession> = {}): CaptureSession {
  return {
    id: SESSION_ID,
    projectId: PROJECT_ID,
    architectureId: ARCH_ID,
    name: 'seq-session',
    status: 'running',
    envName: 'non-prod',
    apiBaseUrl: 'https://api.example.test',
    authType: 'bearer',
    authConfigRedactedJson: null,
    defaultHeadersRedactedJson: null,
    oasSpecRefsJson: null,
    dbConfigRedactedJson: null,
    mutatingCallsConfirmed: true,
    startedAt: null,
    completedAt: null,
    errorMessage: null,
    createdAt: '2026-06-18T00:00:00Z',
    updatedAt: '2026-06-18T00:00:00Z',
    ...overrides,
  };
}

function buildToolContext(overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext {
  return {
    session: buildToolSession(),
    oasInventory: { title: 'Test', version: '1.0.0', operations: [] },
    operationsByOasId: new Map(),
    secrets: { sessionId: SESSION_ID, api: { type: 'none' }, loadedAt: Date.now() },
    httpExecutor: null,
    dbAdapter: null,
    archModelClient: {
      createScenario: jest.fn(),
      createDiagnostic: jest.fn(),
      createCapture: jest.fn(),
    },
    currentScenarioId: SCENARIO_ID,
    ...overrides,
  };
}

/** Seed the runManager with `count` captures carrying request/response data. */
function seedCaptures(
  count: number,
  dataFor: (i: number) => ScenarioCaptureData,
): void {
  if (runManager.has(SESSION_ID)) runManager.end(SESSION_ID);
  runManager.start({ sessionId: SESSION_ID, projectId: PROJECT_ID, architectureId: ARCH_ID });
  for (let i = 0; i < count; i += 1) {
    const d = dataFor(i);
    runManager.recordScenarioCapture(SESSION_ID, `capture-${i}`, d.responseStatus, d);
  }
}

function postSetupData(): ScenarioCaptureData {
  return {
    method: 'POST',
    path: '/filters',
    query: null,
    headers: { 'Content-Type': 'application/json' },
    body: { name: 'draft' },
    responseStatus: 201,
    responseHeaders: { 'content-type': 'application/json' },
    responseBody: { id: 'flt-123', name: 'draft', createdAt: '2026-06-18T00:00:00Z' },
  };
}

function postActData(): ScenarioCaptureData {
  return {
    method: 'POST',
    path: '/filters/submitForReview',
    query: null,
    headers: { 'Content-Type': 'application/json' },
    body: { filterId: 'flt-123' },
    responseStatus: 200,
    responseHeaders: { 'content-type': 'application/json' },
    responseBody: { status: 'IN_REVIEW', filterId: 'flt-123' },
  };
}

function deleteCleanupData(): ScenarioCaptureData {
  return {
    method: 'DELETE',
    path: '/filters/flt-123',
    query: null,
    headers: null,
    body: null,
    responseStatus: 204,
    responseHeaders: null,
    responseBody: null,
  };
}

afterEach(() => {
  if (runManager.has(SESSION_ID)) runManager.end(SESSION_ID);
});

// ===========================================================================
// 1. pin_sequence validation
// ===========================================================================

describe('pin_sequence -- declaration validation', () => {
  const goodSteps = [
    { captureIndex: 0, role: 'setup', kind: 'http', expectedStatus: 201 },
    {
      captureIndex: 1,
      role: 'act',
      kind: 'http',
      expectedStatus: 200,
      responseRefs: ['$0.id'],
    },
    { captureIndex: 2, role: 'cleanup', kind: 'http', expectedStatus: 204 },
  ];

  it('accepts a valid setup->act->cleanup declaration and records it on runManager', async () => {
    seedCaptures(3, (i) => [postSetupData(), postActData(), deleteCleanupData()][i]);
    const ctx = buildToolContext();

    const out = (await pinSequenceTool.handler(
      { steps: goodSteps, actStepIndex: 1 },
      ctx,
    )) as { pinned: boolean; stepCount: number; actStepIndex: number };

    expect(out.pinned).toBe(true);
    expect(out.stepCount).toBe(3);
    expect(out.actStepIndex).toBe(1);
    expect(pinSequenceTool.terminal).toBe(true);

    const pinned = runManager.getPinnedSequence(SESSION_ID);
    expect(pinned).not.toBeNull();
    expect(pinned?.actStepIndex).toBe(1);
    // The inter-step ref was parsed into from_step + json_path.
    expect(pinned?.steps[1].responseRefs).toEqual([
      { ref: '$0.id', fromStep: 0, jsonPath: 'id' },
    ]);
  });

  it('rejects a declaration with NO act step (act_step_count)', async () => {
    seedCaptures(2, (i) => [postSetupData(), deleteCleanupData()][i]);
    const ctx = buildToolContext();
    await expect(
      pinSequenceTool.handler(
        {
          steps: [
            { captureIndex: 0, role: 'setup', kind: 'http', expectedStatus: 201 },
            { captureIndex: 1, role: 'cleanup', kind: 'http', expectedStatus: 204 },
          ],
          actStepIndex: 0,
        },
        ctx,
      ),
    ).rejects.toMatchObject({ name: 'ToolValidationError', reason: 'act_step_count' });
  });

  it('rejects a ref that points to a LATER step (forward_ref)', async () => {
    seedCaptures(2, (i) => [postSetupData(), postActData()][i]);
    const ctx = buildToolContext();
    await expect(
      pinSequenceTool.handler(
        {
          steps: [
            // step 0 references step 1 -- a forward reference is illegal.
            {
              captureIndex: 0,
              role: 'setup',
              kind: 'http',
              expectedStatus: 201,
              responseRefs: ['$1.id'],
            },
            { captureIndex: 1, role: 'act', kind: 'http', expectedStatus: 200 },
          ],
          actStepIndex: 1,
        },
        ctx,
      ),
    ).rejects.toMatchObject({ name: 'ToolValidationError', reason: 'forward_ref' });
  });

  it('rejects a non-http step kind (unsupported_kind)', async () => {
    seedCaptures(1, () => postActData());
    const ctx = buildToolContext();
    await expect(
      pinSequenceTool.handler(
        {
          steps: [{ captureIndex: 0, role: 'act', kind: 'sql', expectedStatus: 200 }],
          actStepIndex: 0,
        },
        ctx,
      ),
    ).rejects.toMatchObject({ name: 'ToolValidationError', reason: 'unsupported_kind' });
  });

  it('rejects a captureIndex that does not reference a real executed capture', async () => {
    seedCaptures(1, () => postActData());
    const ctx = buildToolContext();
    await expect(
      pinSequenceTool.handler(
        {
          steps: [{ captureIndex: 9, role: 'act', kind: 'http', expectedStatus: 200 }],
          actStepIndex: 0,
        },
        ctx,
      ),
    ).rejects.toMatchObject({
      name: 'ToolValidationError',
      reason: 'invalid_capture_index',
    });
  });

  it('rejects pinning without mutating_calls_confirmed (a sequence is inherently mutating)', async () => {
    seedCaptures(1, () => postActData());
    const ctx = buildToolContext({
      session: buildToolSession({ mutatingCallsConfirmed: false }),
    });
    await expect(
      pinSequenceTool.handler(
        {
          steps: [{ captureIndex: 0, role: 'act', kind: 'http', expectedStatus: 200 }],
          actStepIndex: 0,
        },
        ctx,
      ),
    ).rejects.toBeInstanceOf(ToolValidationError);
  });
});

// ===========================================================================
// 2. assembleSequenceJson -- R1 shape
// ===========================================================================

describe('assembleSequenceJson -- R1 shape from declaration + ordered captures', () => {
  it('assembles steps, act_step_index, cleanup_best_effort, and parsed refs', () => {
    seedCaptures(3, (i) => [postSetupData(), postActData(), deleteCleanupData()][i]);
    const captures = runManager.getScenarioCaptures(SESSION_ID);

    const sequence = assembleSequenceJson(
      {
        steps: [
          { captureIndex: 0, role: 'setup', kind: 'http', expectedStatus: 201, responseRefs: [] },
          {
            captureIndex: 1,
            role: 'act',
            kind: 'http',
            expectedStatus: 200,
            responseRefs: [{ ref: '$0.id', fromStep: 0, jsonPath: 'id' }],
          },
          { captureIndex: 2, role: 'cleanup', kind: 'http', expectedStatus: 204, responseRefs: [] },
        ],
        actStepIndex: 1,
        cleanupBestEffort: true,
      },
      captures,
    );

    expect(sequence).not.toBeNull();
    expect(sequence?.act_step_index).toBe(1);
    expect(sequence?.cleanup_best_effort).toBe(true);
    expect(sequence?.steps).toHaveLength(3);

    // Step 0 (setup): the real captured request is mapped in.
    expect(sequence?.steps[0]).toMatchObject({
      index: 0,
      role: 'setup',
      kind: 'http',
      expected_status: 201,
      request: { method: 'POST', path: '/filters', body: { name: 'draft' } },
      response_refs: [],
    });
    // Step 1 (act): the inter-step ref is in the snake_case wire shape.
    expect(sequence?.steps[1]).toMatchObject({
      index: 1,
      role: 'act',
      kind: 'http',
      expected_status: 200,
      request: { method: 'POST', path: '/filters/submitForReview' },
      response_refs: [{ ref: '$0.id', from_step: 0, json_path: 'id' }],
    });
    expect(sequence?.steps[2].role).toBe('cleanup');
  });

  it('returns null when a declared step references a capture index that does not exist', () => {
    seedCaptures(1, () => postActData());
    const captures = runManager.getScenarioCaptures(SESSION_ID);
    const sequence = assembleSequenceJson(
      {
        steps: [{ captureIndex: 5, role: 'act', kind: 'http', expectedStatus: 200, responseRefs: [] }],
        actStepIndex: 0,
        cleanupBestEffort: true,
      },
      captures,
    );
    expect(sequence).toBeNull();
  });
});

// ===========================================================================
// 3. deriveSequenceVolatilePaths -- ref-derived volatility (R3)
// ===========================================================================

describe('deriveSequenceVolatilePaths -- ref + id paths into the volatile envelope', () => {
  it('records the referenced $N.<path> field AND the generated-id paths; a non-volatile field is NOT marked', () => {
    // Setup response carries a generated id (`id`) AND a stable, non-volatile
    // field (`name`). The act step references `$0.id`. The act response also
    // carries `filterId` (id-ish). `status` (act) is a genuine non-volatile
    // field that MUST NOT be marked volatile.
    seedCaptures(3, (i) => [postSetupData(), postActData(), deleteCleanupData()][i]);
    const captures = runManager.getScenarioCaptures(SESSION_ID);

    const wire = deriveSequenceVolatilePaths(
      {
        steps: [
          { captureIndex: 0, role: 'setup', kind: 'http', expectedStatus: 201, responseRefs: [] },
          {
            captureIndex: 1,
            role: 'act',
            kind: 'http',
            expectedStatus: 200,
            responseRefs: [{ ref: '$0.id', fromStep: 0, jsonPath: 'id' }],
          },
          { captureIndex: 2, role: 'cleanup', kind: 'http', expectedStatus: 204, responseRefs: [] },
        ],
        actStepIndex: 1,
        cleanupBestEffort: true,
      },
      captures,
    );

    expect(wire).not.toBeNull();
    const env = wire as { paths: string[]; volatility_source: string; k: number };
    // (a) the referenced `$0.id` field -> /id; (b) the act response's id-ish
    // `filterId` -> /filterId. The source tag is `declared` (ref-derived).
    expect(env.volatility_source).toBe('declared');
    expect(env.paths).toContain('/id');
    expect(env.paths).toContain('/filterId');
    // The genuine non-volatile fields are NOT recorded (so a real change
    // still breaks at diff time -- the oracle invariant).
    expect(env.paths).not.toContain('/name');
    expect(env.paths).not.toContain('/status');
    expect(env.paths).not.toContain('/createdAt');
  });

  it('returns null when there are no refs and no id-ish response fields (strict default)', () => {
    const noIdData = (): ScenarioCaptureData => ({
      method: 'POST',
      path: '/things',
      query: null,
      headers: null,
      body: { name: 'x' },
      responseStatus: 200,
      responseHeaders: null,
      responseBody: { name: 'x', count: 3 },
    });
    seedCaptures(1, () => noIdData());
    const captures = runManager.getScenarioCaptures(SESSION_ID);
    const wire = deriveSequenceVolatilePaths(
      {
        steps: [{ captureIndex: 0, role: 'act', kind: 'http', expectedStatus: 200, responseRefs: [] }],
        actStepIndex: 0,
        cleanupBestEffort: true,
      },
      captures,
    );
    expect(wire).toBeNull();
  });
});

// ===========================================================================
// 4. ONE coverage dimension through the real orchestrator (no inflation)
// ===========================================================================

const E2E_SESSION_ID = '00000000-0000-0000-0000-0000000seq03';

function buildE2ESessionDto(): CaptureSessionDto {
  const now = new Date().toISOString();
  return {
    id: E2E_SESSION_ID,
    project_id: PROJECT_ID,
    architecture_id: ARCH_ID,
    name: 'seq-e2e-session',
    status: 'running',
    env_name: 'non-prod',
    api_base_url: 'https://api.example.test',
    auth_type: 'bearer',
    auth_config_redacted_json: null,
    default_headers_redacted_json: null,
    oas_spec_refs_json: null,
    db_config_redacted_json: null,
    mutating_calls_confirmed: true,
    started_at: now,
    completed_at: null,
    error_message: null,
    created_at: now,
    updated_at: now,
  };
}

function buildE2EOperation(): OperationDto {
  const now = new Date().toISOString();
  return {
    id: 'op-row-seq-1',
    session_id: E2E_SESSION_ID,
    operation_id: 'submitForReview',
    method: 'POST',
    path: '/filters/submitForReview',
    summary: 'Submit a filter for review',
    description: null,
    included: true,
    safe_to_execute: false,
    request_schema_json: null,
    response_schema_json: null,
    // No params -> defaultScenarioSet emits exactly ONE scenario (happy_path).
    oas_operation_json: { operationId: 'submitForReview' } as unknown,
    created_at: now,
    updated_at: now,
  };
}

function buildE2EInventory(): ParsedOasInventory {
  return {
    title: 'seq fixture',
    version: '1.0.0',
    operations: [
      {
        operationId: 'submitForReview',
        method: 'post',
        path: '/filters/submitForReview',
        summary: null,
        description: null,
        requestSchema: null,
        responseSchema: null,
        oasOperation: { operationId: 'submitForReview' } as never,
      },
    ],
  };
}

describe('orchestrator -- a pinned sequence is ONE coverage dimension', () => {
  beforeEach(() => {
    secretsStore.clearAll();
    secretsStore.set({
      sessionId: E2E_SESSION_ID,
      api: { type: 'bearer', bearerToken: 'plaintext' },
      loadedAt: Date.now(),
    });
    if (runManager.has(E2E_SESSION_ID)) runManager.end(E2E_SESSION_ID);
  });
  afterEach(() => {
    jest.restoreAllMocks();
    secretsStore.clearAll();
    if (runManager.has(E2E_SESSION_ID)) runManager.end(E2E_SESSION_ID);
  });

  it('a sequence (setup 201, act 200) scores as ONE dimension and persists a sequence_pinned diagnostic carrying sequence_json', async () => {
    const op = buildE2EOperation();
    // Sanity: this op generates exactly one happy_path dimension.
    const rubric = defaultScenarioSet(op, undefined, op.oas_operation_json);
    expect(rubric).toHaveLength(1);

    // The single scenario's loop: two executes (setup POST 201, act POST 200)
    // then the terminal pin_sequence call.
    let call = 0;
    const request = jest.fn(async () => {
      call += 1;
      if (call === 1) {
        return { status: 201, statusText: 'Created', headers: {}, config: {} as never, data: { id: 'flt-1', name: 'draft' } };
      }
      return { status: 200, statusText: 'OK', headers: {}, config: {} as never, data: { status: 'IN_REVIEW', filterId: 'flt-1' } };
    });
    jest
      .spyOn(require('../services/httpExecutor'), 'createSessionHttpExecutor')
      .mockReturnValue({ request, requestWithAuthOverride: jest.fn(), setAuth: jest.fn(), dispose: jest.fn() });

    const diagnostics: Array<{ body: any }> = [];
    let captureN = 0;
    const sessionDto = buildE2ESessionDto();
    const ams = {
      createScenario: jest.fn(async (_p: string, body: any) => ({ id: 'scenario-seq', ...body })),
      createCapture: jest.fn(async () => ({ id: `capture-${(captureN += 1)}` })),
      createDiagnostic: jest.fn(async (_p: string, body: any) => {
        diagnostics.push({ body });
        return { id: `diag-${diagnostics.length}` };
      }),
      patchCapture: jest.fn(async (_p: string, captureId: string, body: any) => ({ id: captureId, ...body })),
      patchCaptureSession: jest.fn(async (projectId: string, sessionId: string, body: any) => ({
        ...sessionDto,
        ...body,
        id: sessionId,
        project_id: projectId,
      })),
    };

    const execMsg = (id: string, path: string, body: unknown): AssistantMessage => ({
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id,
          type: 'function',
          function: {
            name: 'execute_http_request',
            arguments: JSON.stringify({ operationId: 'submitForReview', method: 'post', path, body }),
          },
        },
      ],
    });
    const pinMsg: AssistantMessage = {
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'tc-pin',
          type: 'function',
          function: {
            name: 'pin_sequence',
            arguments: JSON.stringify({
              steps: [
                { captureIndex: 0, role: 'setup', kind: 'http', expectedStatus: 201 },
                { captureIndex: 1, role: 'act', kind: 'http', expectedStatus: 200, responseRefs: ['$0.id'] },
              ],
              actStepIndex: 1,
            }),
          },
        },
      ],
    };

    const queue = [
      execMsg('tc-1', '/filters', { name: 'draft' }),
      execMsg('tc-2', '/filters/submitForReview', { filterId: 'flt-1' }),
      pinMsg,
    ];
    const gateway = {
      callLlmToolLoop: jest.fn(async () => {
        const next = queue.shift();
        if (!next) throw new Error('mock gateway: queue exhausted');
        return { message: next };
      }),
    };

    const outcome = await orchestrateCaptureSession(toCaptureSession(buildE2ESessionDto()), {
      archModelClient: ams as never,
      gatewayClient: gateway as never,
      oasInventory: buildE2EInventory(),
      persistedOperations: [op],
    });

    // ONE scenario, captured (the act-step capture is the canonical oracle).
    expect(outcome.scenariosAttempted).toBe(1);
    expect(outcome.scenariosCompleted).toBe(1);
    expect(outcome.scenariosErrored).toBe(0);

    // ONE coverage dimension (no rubric inflation): the persisted summary's
    // single endpoint has exactly the one generated dimension.
    const patch = ams.patchCaptureSession.mock.calls[0][2];
    const summary = patch.coverage_summary_json;
    expect(summary.per_endpoint).toHaveLength(1);
    expect(summary.per_endpoint[0].dimensions).toHaveLength(1);

    // The sequence_pinned diagnostic carries the assembled R1 sequence_json
    // (2 steps, act at index 1) + the ref-derived volatile envelope.
    const seqDiag = diagnostics.find((d) => d.body.detail_json?.marker === 'sequence_pinned');
    expect(seqDiag).toBeDefined();
    const seqJson = seqDiag!.body.detail_json.sequence_json;
    expect(seqJson.steps).toHaveLength(2);
    expect(seqJson.act_step_index).toBe(1);
    expect(seqJson.cleanup_best_effort).toBe(true);
    expect(seqJson.steps[1].response_refs).toEqual([
      { ref: '$0.id', from_step: 0, json_path: 'id' },
    ]);
    // Ref-derived volatility carried alongside (the new id + ref paths).
    const vol = seqDiag!.body.detail_json.volatile_paths_json;
    expect(vol.volatility_source).toBe('declared');
    expect(vol.paths).toContain('/id');
  });
});
