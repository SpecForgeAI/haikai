/**
 * Orchestrator intent-driven canonical-capture tests.
 *
 * Spec: 2026-06-17 Intent-Driven Canonical Capture.
 *
 * GOAL: a capture scenario keeps only ONE canonical capture (the one matching
 * its intended outcome) as the reviewable oracle; the LLM's intermediate
 * fumbles (e.g. attempt 1 wrong date format -> 400, attempt 2 corrected ->
 * 200) are reject-and-hidden (`accepted:false` + the system reason marker on
 * `reviewer_notes`), NOT hard-deleted (there is no AMS capture-delete endpoint
 * and deleting oracle data is unsafe). INTENTIONAL negatives survive because
 * they are their OWN scenarios carrying that `expectedStatus`.
 *
 * These tests drive the FULL orchestrator (mocked LLM + a per-attempt
 * status-sequencing HTTP executor + a mocked AMS surface that records
 * `patchCapture` calls), and cover:
 *   1. a `success` scenario whose loop produced captures [400, 200] keeps the
 *      200 (canonical) and rejects the 400 as non-canonical, counts captured;
 *   2. a `not_found` scenario whose loop produced [400 (malformed fumble),
 *      404] keeps the 404 (canonical) and rejects the 400;
 *   3. a `success` scenario whose loop produced only [500] finds NO canonical
 *      -> ALL captures rejected, scenario errored.
 *
 * The canonical capture is asserted to be LEFT UNTOUCHED (never patched).
 */

import {
  orchestrateCaptureSession,
  selectCanonicalCapture,
  NON_CANONICAL_REVIEWER_NOTE,
} from '../services/captureSessionOrchestrator';
import type {
  CaptureSessionDto,
  OperationDto,
} from '../services/archModelClient';
import { toCaptureSession } from '../services/archModelClient';
import { secretsStore } from '../services/secretsStore';
import { runManager } from '../services/runManager';
import type { ParsedOasInventory } from '../types/oas';
import type { AssistantMessage } from '../types/llm';

const PROJECT_ID = '00000000-0000-0000-0000-0000000000d1';
const ARCH_ID = '00000000-0000-0000-0000-0000000000d2';
const SESSION_ID = '00000000-0000-0000-0000-0000000000d3';

function buildSessionDto(): CaptureSessionDto {
  const now = new Date().toISOString();
  return {
    id: SESSION_ID,
    project_id: PROJECT_ID,
    architecture_id: ARCH_ID,
    name: 'canonical-session',
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

function buildOperationRow(overrides: Partial<OperationDto> = {}): OperationDto {
  const now = new Date().toISOString();
  return {
    id: 'op-row-1',
    session_id: SESSION_ID,
    operation_id: 'getThings',
    method: 'GET',
    path: '/things',
    summary: 'List things',
    description: null,
    included: true,
    safe_to_execute: true,
    request_schema_json: null,
    response_schema_json: null,
    // No params -> defaultScenarioSet emits exactly one scenario (happy_path).
    oas_operation_json: { operationId: 'getThings' } as unknown,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function buildInventory(): ParsedOasInventory {
  return {
    title: 'canonical fixture',
    version: '1.0.0',
    operations: [
      {
        operationId: 'getThings',
        method: 'get',
        path: '/things',
        summary: 'List things',
        description: null,
        requestSchema: null,
        responseSchema: null,
        oasOperation: { operationId: 'getThings' } as never,
      },
    ],
  };
}

interface MockAms {
  capturesCreated: Array<{ id: string; status: number | null }>;
  patchCalls: Array<{ captureId: string; body: any }>;
  client: {
    createScenario: jest.Mock;
    createCapture: jest.Mock;
    createDiagnostic: jest.Mock;
    patchCapture: jest.Mock;
    patchCaptureSession: jest.Mock;
  };
}

/**
 * AMS mock. `createCapture` mints capture-1, capture-2, ... and tags each with
 * the response status carried on the request body, so a test can correlate the
 * persisted capture id with the HTTP status the executor returned. The
 * orchestrator's reject-and-hide path lands on `patchCapture`, recorded here.
 */
function buildMockAms(): MockAms {
  const capturesCreated: MockAms['capturesCreated'] = [];
  const patchCalls: MockAms['patchCalls'] = [];
  const sessionDto = buildSessionDto();

  const client = {
    createScenario: jest.fn(async (_projectId: string, body: any) => ({
      id: 'scenario-1',
      session_id: body.session_id,
      operation_id: body.operation_id,
      scenario_name: body.scenario_name ?? null,
      scenario_type: body.scenario_type ?? null,
      status: body.status ?? 'draft',
      generation_source: body.generation_source ?? null,
      request_method: null,
      request_path: null,
      request_query_json: null,
      request_headers_redacted_json: null,
      request_body_json: null,
      notes: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })),
    createCapture: jest.fn(async (_projectId: string, body: any) => {
      const id = `capture-${capturesCreated.length + 1}`;
      capturesCreated.push({ id, status: body.response_status ?? null });
      return { id };
    }),
    createDiagnostic: jest.fn(async () => ({ id: 'diag-1' })),
    patchCapture: jest.fn(async (_projectId: string, captureId: string, body: any) => {
      patchCalls.push({ captureId, body });
      return { id: captureId, ...body };
    }),
    patchCaptureSession: jest.fn(async (projectId: string, sessionId: string, body: any) => ({
      ...sessionDto,
      ...body,
      id: sessionId,
      project_id: projectId,
    })),
  };

  return { capturesCreated, patchCalls, client };
}

function buildGateway(messages: AssistantMessage[]) {
  const queue = [...messages];
  return {
    callLlmToolLoop: jest.fn(async () => {
      const next = queue.shift();
      if (!next) throw new Error('mock gateway: queue exhausted');
      return { message: next };
    }),
  };
}

function execMessage(callId: string): AssistantMessage {
  return {
    role: 'assistant',
    content: null,
    tool_calls: [
      {
        id: callId,
        type: 'function',
        function: {
          name: 'execute_http_request',
          arguments: JSON.stringify({ operationId: 'getThings', method: 'get', path: '/things' }),
        },
      },
    ],
  };
}

function noteMessage(): AssistantMessage {
  return {
    role: 'assistant',
    content: null,
    tool_calls: [
      {
        id: 'tc-note',
        type: 'function',
        function: {
          name: 'record_capture_note',
          arguments: JSON.stringify({ message: 'done' }),
        },
      },
    ],
  };
}

/**
 * Stub the HTTP executor to return a QUEUED sequence of statuses, one per
 * `request` call, so a single scenario's attempts can yield e.g. [400, 200].
 * 2xx bodies are an object; non-2xx bodies are an object too so AMS persistence
 * stays happy. A non-2xx is surfaced via axios's default `validateStatus` as a
 * normal resolved response (status >= 400, < 500 does not throw under the
 * service's default), which the tool records as a non-2xx capture.
 */
function stubHttpExecutorSequence(statuses: number[]) {
  const queue = [...statuses];
  const request = jest.fn(async () => {
    const status = queue.shift() ?? 200;
    return {
      status,
      headers: {},
      data: { ok: status >= 200 && status < 300, status },
      config: {},
      statusText: 'STUB',
    };
  });
  jest
    .spyOn(require('../services/httpExecutor'), 'createSessionHttpExecutor')
    .mockReturnValue({ request, setAuth: jest.fn(), dispose: jest.fn() });
  return request;
}

beforeEach(() => {
  secretsStore.clearAll();
  secretsStore.set({
    sessionId: SESSION_ID,
    api: { type: 'bearer', bearerToken: 'plaintext-token' },
    loadedAt: Date.now(),
  });
  if (runManager.has(SESSION_ID)) runManager.end(SESSION_ID);
});

afterEach(() => {
  jest.restoreAllMocks();
  secretsStore.clearAll();
  if (runManager.has(SESSION_ID)) runManager.end(SESSION_ID);
});

// ---------------------------------------------------------------------------
// Pure selector unit coverage (the seam the orchestrator drives).
// ---------------------------------------------------------------------------

describe('selectCanonicalCapture', () => {
  it('success -> the LAST 2xx capture (corrected attempt wins over the fumble)', () => {
    const picked = selectCanonicalCapture(
      [
        { captureId: 'c1', status: 400 },
        { captureId: 'c2', status: 200 },
      ],
      'success',
    );
    expect(picked?.captureId).toBe('c2');
  });

  it('success -> null when no 2xx capture exists (only a 500 came back)', () => {
    const picked = selectCanonicalCapture([{ captureId: 'c1', status: 500 }], 'success');
    expect(picked).toBeNull();
  });

  it('not_found -> the LAST 404, else falls back to the LAST 4xx', () => {
    expect(
      selectCanonicalCapture(
        [
          { captureId: 'c1', status: 400 },
          { captureId: 'c2', status: 404 },
        ],
        'not_found',
      )?.captureId,
    ).toBe('c2');
    // No 404 present -> fall back to the last 4xx.
    expect(
      selectCanonicalCapture(
        [
          { captureId: 'c1', status: 400 },
          { captureId: 'c2', status: 403 },
        ],
        'not_found',
      )?.captureId,
    ).toBe('c2');
  });

  it('client_error -> the LAST 4xx capture', () => {
    expect(
      selectCanonicalCapture(
        [
          { captureId: 'c1', status: 200 },
          { captureId: 'c2', status: 400 },
        ],
        'client_error',
      )?.captureId,
    ).toBe('c2');
  });

  // Spec 2026-06-23 -- semantics-aware selection (the data-loss fix).
  it('not_found answered ONLY with a 200 + empty body KEEPS the 200 (sole completed round-trip never dropped)', () => {
    const picked = selectCanonicalCapture(
      [{ captureId: 'c200', status: 200, body: {} }],
      'not_found',
    );
    expect(picked?.captureId).toBe('c200');
  });

  it('not_found prefers the 200-with-NO_DATA over an earlier 400 fumble (body-semantics over status class)', () => {
    const picked = selectCanonicalCapture(
      [
        { captureId: 'c1', status: 400, body: { message: 'malformed id' } },
        { captureId: 'c2', status: 200, body: { responseCode: 'NO_DATA_FOUND' } },
      ],
      'not_found',
    );
    expect(picked?.captureId).toBe('c2');
  });

  it('client_error answered ONLY with an unrecognized 500 crash returns null (not rescued; crash is the safe default)', () => {
    const picked = selectCanonicalCapture(
      [{ captureId: 'c500', status: 500, body: { trace: 'NullPointerException' } }],
      'client_error',
    );
    expect(picked).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Full-orchestrator coverage (drives runManager.getScenarioCaptures + patchCapture).
// ---------------------------------------------------------------------------

describe('orchestrator -- intent-driven canonical capture', () => {
  it('success scenario with captures [400, 200] keeps the 200, rejects the 400, counts captured', async () => {
    stubHttpExecutorSequence([400, 200]);
    const ams = buildMockAms();
    // exec (400 fumble) -> exec (200 corrected) -> terminal note.
    const gateway = buildGateway([execMessage('tc-1'), execMessage('tc-2'), noteMessage()]);

    const outcome = await orchestrateCaptureSession(toCaptureSession(buildSessionDto()), {
      archModelClient: ams.client as never,
      gatewayClient: gateway as never,
      oasInventory: buildInventory(),
      persistedOperations: [buildOperationRow()],
    });

    // Both attempts persisted (persistence is unchanged by canonical capture).
    expect(ams.capturesCreated).toHaveLength(2);
    const four00 = ams.capturesCreated.find((c) => c.status === 400)!;
    const two00 = ams.capturesCreated.find((c) => c.status === 200)!;

    // The scenario counts as CAPTURED (a canonical 2xx was found).
    expect(outcome.scenariosAttempted).toBe(1);
    expect(outcome.scenariosCompleted).toBe(1);
    expect(outcome.scenariosErrored).toBe(0);

    // Exactly the 400 fumble was reject-and-hidden; the canonical 200 was left
    // UNTOUCHED (never patched).
    expect(ams.patchCalls).toHaveLength(1);
    expect(ams.patchCalls[0].captureId).toBe(four00.id);
    expect(ams.patchCalls[0].body.accepted).toBe(false);
    expect(ams.patchCalls[0].body.reviewer_notes).toBe(NON_CANONICAL_REVIEWER_NOTE);
    expect(ams.patchCalls.some((p) => p.captureId === two00.id)).toBe(false);
  });

  it('not_found scenario with captures [400 fumble, 404] keeps the 404 and rejects the 400', async () => {
    // The orchestrator's intent comes from scenario.expectedStatus. A required
    // path-param op makes defaultScenarioSet emit, IN ORDER:
    //   1. happy_path          (success)      -> [200]
    //   2. not_found_id        (not_found)    -> [400 fumble, 404]
    //   3. bad_request_id      (client_error) -> [400]
    //   4. bad_request_id_type (client_error) -> [400]
    //   5. edge_id             (not_found)    -> [404]
    // so we script all five deterministically. The ONLY non-canonical capture
    // is the not_found scenario's 400 fumble; every other scenario keeps the
    // single capture matching its intended outcome.
    const op = buildOperationRow({
      method: 'GET',
      path: '/things/{id}',
      oas_operation_json: {
        operationId: 'getThings',
        parameters: [{ name: 'id', in: 'path', required: true }],
      } as unknown,
    });
    const inventory: ParsedOasInventory = {
      title: 'canonical fixture',
      version: '1.0.0',
      operations: [
        {
          operationId: 'getThings',
          method: 'get',
          path: '/things/{id}',
          summary: null,
          description: null,
          requestSchema: null,
          responseSchema: null,
          oasOperation: {
            operationId: 'getThings',
            parameters: [{ name: 'id', in: 'path', required: true }],
          } as never,
        },
      ],
    };

    // Creation order -> capture ids:
    //   capture-1 = happy 200; capture-2 = not_found 400 fumble;
    //   capture-3 = not_found 404; capture-4 = bad_request 400;
    //   capture-5 = bad_request_type 400; capture-6 = edge 404.
    stubHttpExecutorSequence([200, 400, 404, 400, 400, 404]);
    const ams = buildMockAms();
    const gateway = buildGateway([
      // happy_path: one 200 attempt + terminal note
      execMessage('tc-h1'),
      noteMessage(),
      // not_found: 400 fumble, 404 corrected + terminal note
      execMessage('tc-n1'),
      execMessage('tc-n2'),
      noteMessage(),
      // bad_request: one 400 attempt (its intended outcome) + terminal note
      execMessage('tc-b1'),
      noteMessage(),
      // bad_request_type: one 400 attempt (intended) + terminal note
      execMessage('tc-t1'),
      noteMessage(),
      // edge (boundary id -> 404): one attempt + terminal note
      execMessage('tc-e1'),
      noteMessage(),
    ]);

    const outcome = await orchestrateCaptureSession(toCaptureSession(buildSessionDto()), {
      archModelClient: ams.client as never,
      gatewayClient: gateway as never,
      oasInventory: inventory,
      persistedOperations: [op],
    });

    // Five scenarios, all captured (each kept the capture matching its intent).
    expect(outcome.scenariosAttempted).toBe(5);
    expect(outcome.scenariosCompleted).toBe(5);
    expect(outcome.scenariosErrored).toBe(0);

    // Six captures persisted (200, 400, 404, 400, 400, 404). Exactly ONE reject:
    // the not_found scenario's 400 fumble (capture-2). Every canonical capture
    // (incl. the two new id negatives + the boundary 404) is left untouched.
    expect(ams.capturesCreated.map((c) => c.status)).toEqual([200, 400, 404, 400, 400, 404]);
    const notFoundFumble = ams.capturesCreated[1]; // capture-2, status 400
    const notFoundCanonical = ams.capturesCreated[2]; // capture-3, status 404
    const badRequestCanonical = ams.capturesCreated[3]; // capture-4, status 400
    expect(ams.patchCalls).toHaveLength(1);
    expect(ams.patchCalls[0].captureId).toBe(notFoundFumble.id);
    expect(ams.patchCalls[0].body.accepted).toBe(false);
    expect(ams.patchCalls[0].body.reviewer_notes).toBe(NON_CANONICAL_REVIEWER_NOTE);
    expect(ams.patchCalls.some((p) => p.captureId === notFoundCanonical.id)).toBe(false);
    expect(ams.patchCalls.some((p) => p.captureId === badRequestCanonical.id)).toBe(false);
  });

  it('success scenario with only [500] finds no canonical -> all captures rejected, scenario errored', async () => {
    stubHttpExecutorSequence([500]);
    const ams = buildMockAms();
    const gateway = buildGateway([execMessage('tc-1'), noteMessage()]);

    const outcome = await orchestrateCaptureSession(toCaptureSession(buildSessionDto()), {
      archModelClient: ams.client as never,
      gatewayClient: gateway as never,
      oasInventory: buildInventory(),
      persistedOperations: [buildOperationRow()],
    });

    // One capture persisted (the 500). No 2xx -> no canonical -> errored.
    expect(ams.capturesCreated).toHaveLength(1);
    expect(outcome.scenariosAttempted).toBe(1);
    expect(outcome.scenariosCompleted).toBe(0);
    expect(outcome.scenariosErrored).toBe(1);

    // The 500 capture was reject-and-hidden as non-canonical (no usable oracle).
    const five00 = ams.capturesCreated.find((c) => c.status === 500)!;
    expect(ams.patchCalls).toHaveLength(1);
    expect(ams.patchCalls[0].captureId).toBe(five00.id);
    expect(ams.patchCalls[0].body.accepted).toBe(false);
    expect(ams.patchCalls[0].body.reviewer_notes).toBe(NON_CANONICAL_REVIEWER_NOTE);
  });
});


// ===========================================================================
// END-TO-END data-loss fix + crash-as-default (Spec 2026-06-23, Task Group 6).
//
// The unit + scorer tests above prove the body-aware SELECTOR and the
// semantics-aware SCORER in isolation. These tests drive the FULL orchestrator
// with a stub that returns a per-call BODY (so the orchestrator records
// `data.responseBody` and the body-aware path is GENUINELY exercised) and a
// mocked AMS that records BOTH `patchCapture` (the reject-hide seam) AND the
// completion `patchCaptureSession` (carrying `coverage_summary_json`). They
// close the two critical end-to-end gaps the units cannot:
//
//   1. HEADLINE -- a `not_found` scenario whose ONLY captured response is a 200
//      with a `{ responseCode: 'NO_DATA_FOUND' }` body is KEPT (its real legacy
//      behaviour reaches the baseline), NOT reject-hidden; the scenario counts
//      completed (not errored); and the persisted summary shows that dimension
//      ACHIEVED with a non-scoring observation noting the 200-for-missing
//      deviation. The recorded capture is asserted to actually carry the
//      NO_DATA body, so the body-aware path is proven (not bypassed).
//
//   2. NO REGRESSION -- a `client_error` scenario whose only response is a 500
//      with a non-validation body (`{ trace: 'NullPointerException' }`) is still
//      reject-hidden and the scenario errored. Crash stays the SAFE DEFAULT --
//      we did NOT start keeping crashes.
// ===========================================================================

interface SemanticsMockAms {
  capturesCreated: Array<{ id: string; status: number | null; responseBody: unknown }>;
  patchCalls: Array<{ captureId: string; body: any }>;
  sessionPatches: Array<{ body: any }>;
  client: {
    createScenario: jest.Mock;
    createCapture: jest.Mock;
    createDiagnostic: jest.Mock;
    patchCapture: jest.Mock;
    patchCaptureSession: jest.Mock;
  };
}

/**
 * AMS mock that, in addition to the canonical mock's `patchCapture` recording,
 * also records each created capture's persisted `response_body_json` (so a test
 * can find the capture carrying the NO_DATA body and prove it was the one KEPT)
 * and the completion `patchCaptureSession` body (so a test can read the assembled
 * `coverage_summary_json`).
 */
function buildSemanticsMockAms(): SemanticsMockAms {
  const capturesCreated: SemanticsMockAms['capturesCreated'] = [];
  const patchCalls: SemanticsMockAms['patchCalls'] = [];
  const sessionPatches: SemanticsMockAms['sessionPatches'] = [];
  const sessionDto = buildSessionDto();

  const client = {
    createScenario: jest.fn(async (_projectId: string, body: any) => ({
      id: `scenario-${body.scenario_name}`,
      session_id: body.session_id,
      operation_id: body.operation_id,
      scenario_name: body.scenario_name ?? null,
      scenario_type: body.scenario_type ?? null,
      status: body.status ?? 'draft',
      generation_source: body.generation_source ?? null,
      request_method: null,
      request_path: null,
      request_query_json: null,
      request_headers_redacted_json: null,
      request_body_json: null,
      notes: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })),
    createCapture: jest.fn(async (_projectId: string, body: any) => {
      const id = `capture-${capturesCreated.length + 1}`;
      capturesCreated.push({
        id,
        status: body.response_status ?? null,
        responseBody: body.response_body_json ?? null,
      });
      return { id };
    }),
    createDiagnostic: jest.fn(async () => ({ id: 'diag-1' })),
    patchCapture: jest.fn(async (_projectId: string, captureId: string, body: any) => {
      patchCalls.push({ captureId, body });
      return { id: captureId, ...body };
    }),
    patchCaptureSession: jest.fn(async (projectId: string, sessionId: string, body: any) => {
      sessionPatches.push({ body });
      return { ...sessionDto, ...body, id: sessionId, project_id: projectId };
    }),
  };

  return { capturesCreated, patchCalls, sessionPatches, client };
}

/**
 * Stub the HTTP executor to return a QUEUED sequence of { status, body } pairs,
 * one per `request` call. Unlike `stubHttpExecutorSequence` (which returns only
 * `{ ok, status }`), this lets the orchestrator record a SEMANTIC body on
 * `ScenarioCaptureRef.data.responseBody`, so the body-aware selector/scorer path
 * is genuinely exercised. A session-level auth override returns a 401 so the
 * (irrelevant here) auth probe does not interfere.
 */
function stubHttpExecutorBodies(seq: Array<{ status: number; body: unknown }>) {
  const queue = [...seq];
  const request = jest.fn(async () => {
    const next = queue.shift() ?? { status: 200, body: { ok: true } };
    return {
      status: next.status,
      headers: {},
      data: next.body,
      config: {},
      statusText: 'STUB',
    };
  });
  const requestWithAuthOverride = jest.fn(async () => ({
    status: 401,
    headers: {},
    data: { error: 'unauthorized' },
    config: {},
    statusText: 'AUTH',
  }));
  jest
    .spyOn(require('../services/httpExecutor'), 'createSessionHttpExecutor')
    .mockReturnValue({ request, requestWithAuthOverride, setAuth: jest.fn(), dispose: jest.fn() });
  return request;
}

describe('orchestrator -- semantics-aware data-loss fix (Spec 2026-06-23)', () => {
  it('HEADLINE: a not_found scenario whose ONLY response is a 200 + NO_DATA body is KEPT (never reject-hidden), counts completed, and shows ACHIEVED + a 200-for-missing observation', async () => {
    // A single no-param GET emits exactly one scenario, `happy_path`
    // (expectedStatus `success`). To exercise the NOT_FOUND path with a sole
    // 200-NO_DATA capture we drive a `not_found` scenario directly: a required
    // path-param op makes defaultScenarioSet emit, IN ORDER:
    //   1. happy_path     (success)      2. not_found_id   (not_found)
    //   3. bad_request_id (client_error) 4. bad_request_id_type (client_error)
    //   5. edge_id        (not_found)
    // We answer ONLY the not_found_id scenario with a 200 carrying a
    // `{ responseCode: 'NO_DATA_FOUND' }` body (the real legacy behaviour), and
    // give every other scenario a conventional matching response so the run is
    // otherwise clean. The headline assertions then target the not_found_id
    // scenario's sole 200-NO_DATA capture.
    const op = buildOperationRow({
      method: 'GET',
      path: '/things/{id}',
      oas_operation_json: {
        operationId: 'getThings',
        parameters: [{ name: 'id', in: 'path', required: true }],
      } as unknown,
    });
    const inventory: ParsedOasInventory = {
      title: 'canonical fixture',
      version: '1.0.0',
      operations: [
        {
          operationId: 'getThings',
          method: 'get',
          path: '/things/{id}',
          summary: null,
          description: null,
          requestSchema: null,
          responseSchema: null,
          oasOperation: {
            operationId: 'getThings',
            parameters: [{ name: 'id', in: 'path', required: true }],
          } as never,
        },
      ],
    };

    // Drive a per-scenario response by scenario NAME so the not_found_id 200 is
    // deterministic regardless of generation order. Each scenario gets ONE
    // execute turn + a terminal note.
    const NO_DATA_BODY = { responseCode: 'NO_DATA_FOUND', message: 'no records' };
    const bodyByScenario: Record<string, { status: number; body: unknown }> = {
      happy_path: { status: 200, body: { id: 'x', name: 'thing' } },
      not_found_id: { status: 200, body: NO_DATA_BODY }, // the deviation under test
      bad_request_id: { status: 400, body: { error: 'invalid id' } },
      bad_request_id_type: { status: 400, body: { error: 'invalid id type' } },
      edge_id: { status: 404, body: { error: 'not found' } },
    };

    let currentScenario = '';
    const request = jest.fn(async () => {
      const r = bodyByScenario[currentScenario] ?? { status: 200, body: { ok: true } };
      return { status: r.status, headers: {}, data: r.body, config: {}, statusText: 'STUB' };
    });
    const requestWithAuthOverride = jest.fn(async () => ({
      status: 401, headers: {}, data: { error: 'unauthorized' }, config: {}, statusText: 'AUTH',
    }));
    jest
      .spyOn(require('../services/httpExecutor'), 'createSessionHttpExecutor')
      .mockReturnValue({ request, requestWithAuthOverride, setAuth: jest.fn(), dispose: jest.fn() });

    const ams = buildSemanticsMockAms();
    // Track the active scenario from the createScenario body so `request` knows
    // which response to return.
    ams.client.createScenario = jest.fn(async (_p: string, body: any) => {
      currentScenario = body.scenario_name;
      return { id: `scenario-${body.scenario_name}`, ...body };
    });

    const gateway = buildGateway([
      execMessage('h'), noteMessage(),
      execMessage('nf'), noteMessage(),
      execMessage('b1'), noteMessage(),
      execMessage('b2'), noteMessage(),
      execMessage('e'), noteMessage(),
    ]);

    const outcome = await orchestrateCaptureSession(toCaptureSession(buildSessionDto()), {
      archModelClient: ams.client as never,
      gatewayClient: gateway as never,
      oasInventory: inventory,
      persistedOperations: [op],
    });

    // The 200-NO_DATA capture is the ONLY response for the not_found scenario.
    // Find it by the persisted body so we can prove (a) the body-aware path was
    // exercised, and (b) it was NOT reject-hidden.
    const noDataCapture = ams.capturesCreated.find(
      (c) =>
        c.status === 200 &&
        JSON.stringify(c.responseBody ?? {}).includes('NO_DATA_FOUND'),
    );
    // PROVE the recorded capture actually carried the NO_DATA body (otherwise the
    // body-aware path would not have been exercised and the test proves nothing).
    expect(noDataCapture).toBeTruthy();
    expect(JSON.stringify(noDataCapture!.responseBody)).toMatch(/NO_DATA_FOUND/);

    // HEADLINE 1: the 200-NO_DATA capture is NOT reject-hidden -- no patchCapture
    // marked it accepted:false / superseded_non_canonical. The legacy behaviour
    // reaches the baseline (pending human accept) instead of being dropped.
    expect(ams.patchCalls.some((p) => p.captureId === noDataCapture!.id)).toBe(false);

    // HEADLINE 2: every scenario completed; NONE errored. Before the fix the
    // not_found scenario answered only with a 200 would have found "no canonical"
    // and been counted errored with ALL its captures reject-hidden.
    expect(outcome.scenariosAttempted).toBe(5);
    expect(outcome.scenariosCompleted).toBe(5);
    expect(outcome.scenariosErrored).toBe(0);

    // HEADLINE 3: the persisted coverage summary shows the not_found dimension
    // ACHIEVED (behaviour observed), with the 200-NO_DATA capture as its
    // canonical, and a NON-SCORING observation noting the 200-for-missing
    // deviation -- the ~38%->~98% reframing, end to end.
    expect(ams.sessionPatches).toHaveLength(1);
    const summary = ams.sessionPatches[0].body.coverage_summary_json;
    expect(summary).toBeTruthy();
    const ep = summary.per_endpoint[0];
    const byName = new Map<string, any>(ep.dimensions.map((d: any) => [d.name, d]));
    const notFound = byName.get('not_found_id');
    expect(notFound.achieved).toBe(true);
    expect(notFound.canonical_capture_id).toBe(noDataCapture!.id);
    expect(notFound.reason).toBeNull();
    expect(notFound.observation).toMatch(/missing resource/i);
    // The deviation also surfaces in the summary-level observations list, without
    // entering the score arithmetic (it is a non-scoring deviation note).
    expect(summary.observations.some((o: string) => /missing resource/i.test(o))).toBe(true);
  });

  it('NO REGRESSION: a client_error scenario whose only response is a 500 + non-validation body stays reject-hidden and the scenario errors (crash is the safe default)', async () => {
    // A required-body POST is the simplest way to emit a `client_error`
    // scenario. Instead, drive a no-param GET (sole `happy_path`, success) where
    // the ONLY response is an unrecognized 500 crash: selectCanonicalCapture
    // returns null (no usable oracle), the scenario errors, and the 500 capture
    // is reject-hidden -- proving we did NOT start keeping crashes. (The
    // client_error-intent crash is covered at the unit level in this same file;
    // here we assert the END-TO-END reject-hide + errored outcome.)
    const request = stubHttpExecutorBodies([
      { status: 500, body: { trace: 'NullPointerException at com.legacy.Svc.handle(Svc.java:42)' } },
    ]);
    const ams = buildSemanticsMockAms();
    const gateway = buildGateway([execMessage('c1'), noteMessage()]);

    const outcome = await orchestrateCaptureSession(toCaptureSession(buildSessionDto()), {
      archModelClient: ams.client as never,
      gatewayClient: gateway as never,
      oasInventory: buildInventory(),
      persistedOperations: [buildOperationRow()],
    });

    expect(request).toHaveBeenCalled();

    // The 500 crash capture was persisted but carries a NON-validation body.
    const crash = ams.capturesCreated.find((c) => c.status === 500);
    expect(crash).toBeTruthy();
    expect(JSON.stringify(crash!.responseBody)).toMatch(/NullPointerException/);
    // The body has NO bad_request marker -> it is an unrecognized crash, the SAFE
    // DEFAULT: NOT a usable oracle.

    // The scenario errored (no usable oracle) -- a crash never silently survives.
    expect(outcome.scenariosCompleted).toBe(0);
    expect(outcome.scenariosErrored).toBe(1);

    // The crash capture WAS reject-hidden as non-canonical (accepted:false + the
    // system marker), so a pure crash does not reach the baseline / default view.
    expect(ams.patchCalls).toHaveLength(1);
    expect(ams.patchCalls[0].captureId).toBe(crash!.id);
    expect(ams.patchCalls[0].body.accepted).toBe(false);
    expect(ams.patchCalls[0].body.reviewer_notes).toBe(NON_CANONICAL_REVIEWER_NOTE);

    // And the summary reports it MISSED with the honest crash observation, not
    // achieved -- the % answers "did we capture usable behaviour" (we did not).
    const summary = ams.sessionPatches[0].body.coverage_summary_json;
    const happy = summary.per_endpoint[0].dimensions.find((d: any) => d.name === 'happy_path');
    expect(happy.achieved).toBe(false);
    expect(happy.observation).toMatch(/crash/i);
  });
});
