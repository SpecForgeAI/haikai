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
    //   1. happy_path     (success)      -> [200]
    //   2. not_found_id   (not_found)    -> [400 fumble, 404]
    //   3. bad_request_id (client_error) -> [400]
    // so we script all three deterministically. The ONLY non-canonical capture
    // is the not_found scenario's 400 fumble; happy keeps its 200, not_found
    // keeps its 404, bad_request keeps its single 400 (its intended outcome).
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
    //   capture-3 = not_found 404; capture-4 = bad_request 400.
    stubHttpExecutorSequence([200, 400, 404, 400]);
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
    ]);

    const outcome = await orchestrateCaptureSession(toCaptureSession(buildSessionDto()), {
      archModelClient: ams.client as never,
      gatewayClient: gateway as never,
      oasInventory: inventory,
      persistedOperations: [op],
    });

    // Three scenarios, all captured (each kept the capture matching its intent).
    expect(outcome.scenariosAttempted).toBe(3);
    expect(outcome.scenariosCompleted).toBe(3);
    expect(outcome.scenariosErrored).toBe(0);

    // Four captures persisted (200, 400, 404, 400). Exactly ONE reject: the
    // not_found scenario's 400 fumble (capture-2). The 404 canonical and the
    // bad_request 400 canonical are both untouched.
    expect(ams.capturesCreated.map((c) => c.status)).toEqual([200, 400, 404, 400]);
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
