/**
 * Focused tests for the `execute_http_request` tool rewrite.
 *
 * Spec: 2026-05-16 API Behaviour Capture Fixes -- Task Group 2 sub-task 2.1.
 *
 * Scope:
 *   1. 2xx response auto-persists a capture row with correct `attempt_number`,
 *      redacted request/response fields, `accepted` left at AMS default
 *      (omitted from the create body); tool result contains `captureId`.
 *   2. Non-2xx (500) response auto-persists with `response_status = 500`
 *      and populated redacted response slots.
 *   3. Transport / auth failure (axios throw with no `.response`)
 *      persists with `response_status = null`, null response slots, and
 *      populated `error_type` + `error_message`.
 *   4. Combined gate -- mutating verb with `safe_to_execute = false` AND
 *      `mutatingCallsConfirmed = true` SUCCEEDS (the third gate is no
 *      longer dead).
 *   5. Combined gate -- mutating verb with `safe_to_execute = false` AND
 *      `mutatingCallsConfirmed = false` throws with reason
 *      `operation_not_executable`.
 *   6. Exceeding `LLM_HTTP_ATTEMPTS_PER_SCENARIO` emits a `retry_exhausted`
 *      diagnostic via `archModelClient.createDiagnostic` and throws
 *      `ToolValidationError('execute_http_request', 'retry_budget_exhausted', ...)`.
 *   7. If `createCapture` itself throws, the handler rethrows (not silently
 *      swallowed).
 *
 * The runManager counter is exercised end-to-end here (not stubbed) so that
 * the integration between the handler and `runManager.incrementHttpAttempts`
 * is proven directly.
 */

import { AxiosError, AxiosResponse } from 'axios';
import { executeHttpRequestTool } from '../services/tools/execute_http_request';
import {
  ToolValidationError,
  type ArchModelToolWriteSurface,
  type ToolExecutionContext,
} from '../services/tools';
import { runManager } from '../services/runManager';
import { LLM_HTTP_ATTEMPTS_PER_SCENARIO } from '../config';
import type { CaptureSession } from '../types/captureSession';
import type { CaptureDto, OperationDto } from '../services/archModelClient';
import type { SessionHttpExecutor } from '../services/httpExecutor';

const SESSION_ID = 'session-exec-http-1';
const PROJECT_ID = 'proj-exec-1';
const ARCH_ID = 'arch-exec-1';
const SCENARIO_ID = 'scenario-current-1';

function buildSession(overrides: Partial<CaptureSession> = {}): CaptureSession {
  return {
    id: SESSION_ID,
    projectId: PROJECT_ID,
    architectureId: ARCH_ID,
    name: 'test-session',
    status: 'running',
    envName: 'non-prod',
    apiBaseUrl: 'https://api.example.test',
    authType: 'bearer',
    authConfigRedactedJson: null,
    defaultHeadersRedactedJson: null,
    oasSpecRefsJson: null,
    dbConfigRedactedJson: null,
    mutatingCallsConfirmed: false,
    startedAt: null,
    completedAt: null,
    errorMessage: null,
    createdAt: '2026-05-16T00:00:00Z',
    updatedAt: '2026-05-16T00:00:00Z',
    ...overrides,
  };
}

function buildOperation(overrides: Partial<OperationDto> = {}): OperationDto {
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
    oas_operation_json: {},
    created_at: '2026-05-16T00:00:00Z',
    updated_at: '2026-05-16T00:00:00Z',
    ...overrides,
  };
}

interface MockArchClient extends ArchModelToolWriteSurface {
  createCapture: jest.Mock;
  createDiagnostic: jest.Mock;
  createScenario: jest.Mock;
}

function buildMockArchClient(): MockArchClient {
  let nextId = 1;
  return {
    createScenario: jest.fn(async () => ({ id: `scenario-${nextId++}` })) as MockArchClient['createScenario'],
    createDiagnostic: jest.fn(async () => ({ id: `diag-${nextId++}` })) as MockArchClient['createDiagnostic'],
    createCapture: jest.fn(async () => ({
      id: `capture-${nextId++}`,
    } as Partial<CaptureDto>)) as MockArchClient['createCapture'],
  } as MockArchClient;
}

function buildHttpExecutor(
  request: jest.Mock,
): SessionHttpExecutor & { request: jest.Mock } {
  return {
    request,
    setAuth: jest.fn(),
    dispose: jest.fn(),
  } as unknown as SessionHttpExecutor & { request: jest.Mock };
}

function buildContext(
  overrides: Partial<ToolExecutionContext> = {},
): ToolExecutionContext {
  const arch = buildMockArchClient();
  const op = buildOperation();
  return {
    session: buildSession(),
    oasInventory: {
      title: 'Test',
      version: '1.0.0',
      operations: [],
    },
    operationsByOasId: new Map([[op.operation_id, op]]),
    secrets: { sessionId: SESSION_ID, api: { type: 'none' }, loadedAt: Date.now() },
    httpExecutor: buildHttpExecutor(jest.fn()),
    dbAdapter: null,
    archModelClient: arch,
    currentScenarioId: SCENARIO_ID,
    ...overrides,
  };
}

function startRun(): void {
  // Some tests may end the run themselves; defensively clean up first.
  if (runManager.has(SESSION_ID)) runManager.end(SESSION_ID);
  runManager.start({
    sessionId: SESSION_ID,
    projectId: PROJECT_ID,
    architectureId: ARCH_ID,
  });
}

afterEach(() => {
  if (runManager.has(SESSION_ID)) runManager.end(SESSION_ID);
});

describe('execute_http_request -- auto-persist capture rows', () => {
  it('persists a capture row for a 2xx response with correct attempt_number and redacted fields, and returns captureId', async () => {
    startRun();
    const response: AxiosResponse<unknown> = {
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      config: {} as never,
      data: { id: 1, name: 'thing' },
    };
    const request = jest.fn(async () => response);
    const ctx = buildContext({
      httpExecutor: buildHttpExecutor(request),
    });
    const arch = ctx.archModelClient as MockArchClient;

    const result = await executeHttpRequestTool.handler(
      {
        operationId: 'getThings',
        method: 'get',
        path: '/things',
        headers: { Authorization: 'Bearer secret-token-xyz' },
      },
      ctx,
    );

    expect(request).toHaveBeenCalledTimes(1);
    expect(arch.createCapture).toHaveBeenCalledTimes(1);

    const [projectId, body] = arch.createCapture.mock.calls[0];
    expect(projectId).toBe(PROJECT_ID);
    expect(body.session_id).toBe(SESSION_ID);
    expect(body.scenario_id).toBe(SCENARIO_ID);
    expect(body.operation_id).toBe('op-row-1');
    expect(body.attempt_number).toBe(1);
    expect(body.request_method).toBe('GET');
    expect(body.request_path).toBe('/things');
    expect(body.response_status).toBe(200);
    expect(body.response_body_json).toEqual({ id: 1, name: 'thing' });
    expect(body.error_type).toBeNull();
    expect(body.error_message).toBeNull();
    // The bearer token must be redacted, not present in plaintext.
    expect(body.request_headers_redacted_json?.Authorization).toBe('[REDACTED]');
    // `accepted` is intentionally NOT sent so AMS applies its default.
    expect(Object.prototype.hasOwnProperty.call(body, 'accepted')).toBe(false);

    // Result shape carries the persisted captureId.
    expect((result as { captureId: string }).captureId).toMatch(/^capture-/);
    expect((result as { attemptNumber: number }).attemptNumber).toBe(1);
  });

  it('persists a capture row for a non-2xx (500) response with response_status=500 and populated redacted response slots', async () => {
    startRun();
    const response: AxiosResponse<unknown> = {
      status: 500,
      statusText: 'Internal Server Error',
      headers: { 'content-type': 'application/json' },
      config: {} as never,
      data: { error: 'oops' },
    };
    const request = jest.fn(async () => response);
    const ctx = buildContext({
      httpExecutor: buildHttpExecutor(request),
    });
    const arch = ctx.archModelClient as MockArchClient;

    await executeHttpRequestTool.handler(
      { operationId: 'getThings', method: 'get', path: '/things' },
      ctx,
    );

    expect(arch.createCapture).toHaveBeenCalledTimes(1);
    const body = arch.createCapture.mock.calls[0][1];
    expect(body.response_status).toBe(500);
    expect(body.response_body_json).toEqual({ error: 'oops' });
    expect(body.response_headers_redacted_json).not.toBeNull();
    expect(body.error_type).toBeNull();
    expect(body.error_message).toBeNull();
  });

  it('persists a capture row for a transport failure (axios throw with no response) with response_status=null and populated error_type + error_message', async () => {
    startRun();
    const transportErr = Object.assign(new Error('socket hang up'), {
      code: 'ECONNRESET',
      name: 'AxiosError',
      isAxiosError: true,
    }) as unknown as AxiosError;
    const request = jest.fn(async () => {
      throw transportErr;
    });
    const ctx = buildContext({
      httpExecutor: buildHttpExecutor(request),
    });
    const arch = ctx.archModelClient as MockArchClient;

    await executeHttpRequestTool.handler(
      { operationId: 'getThings', method: 'get', path: '/things' },
      ctx,
    );

    expect(arch.createCapture).toHaveBeenCalledTimes(1);
    const body = arch.createCapture.mock.calls[0][1];
    expect(body.response_status).toBeNull();
    expect(body.response_headers_redacted_json).toBeNull();
    expect(body.response_body_json).toBeNull();
    expect(body.error_type).toBe('ECONNRESET');
    expect(body.error_message).toBe('socket hang up');
  });
});

describe('execute_http_request -- combined mutating-call gate', () => {
  it('SUCCEEDS when safe_to_execute=false AND mutatingCallsConfirmed=true (third gate is no longer dead)', async () => {
    startRun();
    const response: AxiosResponse<unknown> = {
      status: 201,
      statusText: 'Created',
      headers: {},
      config: {} as never,
      data: { id: 42 },
    };
    const request = jest.fn(async () => response);
    const op = buildOperation({
      operation_id: 'createThing',
      method: 'POST',
      path: '/things',
      included: true,
      safe_to_execute: false, // mutating verb under default policy
    });
    const ctx = buildContext({
      session: buildSession({ mutatingCallsConfirmed: true }),
      operationsByOasId: new Map([[op.operation_id, op]]),
      httpExecutor: buildHttpExecutor(request),
    });
    const arch = ctx.archModelClient as MockArchClient;

    const result = await executeHttpRequestTool.handler(
      { operationId: 'createThing', method: 'post', path: '/things', body: { name: 'x' } },
      ctx,
    );

    expect(request).toHaveBeenCalledTimes(1);
    expect(arch.createCapture).toHaveBeenCalledTimes(1);
    expect((result as { captureId: string }).captureId).toMatch(/^capture-/);
    const body = arch.createCapture.mock.calls[0][1];
    expect(body.response_status).toBe(201);
  });

  it('throws operation_not_executable when safe_to_execute=false AND mutatingCallsConfirmed=false', async () => {
    startRun();
    const request = jest.fn();
    const op = buildOperation({
      operation_id: 'createThing',
      method: 'POST',
      path: '/things',
      included: true,
      safe_to_execute: false,
    });
    const ctx = buildContext({
      session: buildSession({ mutatingCallsConfirmed: false }),
      operationsByOasId: new Map([[op.operation_id, op]]),
      httpExecutor: buildHttpExecutor(request),
    });
    const arch = ctx.archModelClient as MockArchClient;

    await expect(
      executeHttpRequestTool.handler(
        { operationId: 'createThing', method: 'post', path: '/things' },
        ctx,
      ),
    ).rejects.toMatchObject({
      name: 'ToolValidationError',
      reason: 'operation_not_executable',
    });
    expect(request).not.toHaveBeenCalled();
    // Failed-gate attempts do NOT persist a capture row -- the row is only
    // written after the request is actually issued. (Failed-gate attempts
    // DO still consume an attempt slot via the runManager counter.)
    expect(arch.createCapture).not.toHaveBeenCalled();
  });
});

describe('execute_http_request -- retry budget', () => {
  it('emits retry_exhausted diagnostic and throws retry_budget_exhausted when attempt count exceeds the config cap', async () => {
    startRun();
    // Drain the counter to one below the cap via direct runManager calls,
    // then invoke the handler: the handler increments first, hits cap+1,
    // and the budget check should fire BEFORE any HTTP call is made.
    for (let i = 0; i < LLM_HTTP_ATTEMPTS_PER_SCENARIO; i += 1) {
      runManager.incrementHttpAttempts(SESSION_ID);
    }
    const request = jest.fn();
    const ctx = buildContext({
      httpExecutor: buildHttpExecutor(request),
    });
    const arch = ctx.archModelClient as MockArchClient;

    await expect(
      executeHttpRequestTool.handler(
        { operationId: 'getThings', method: 'get', path: '/things' },
        ctx,
      ),
    ).rejects.toMatchObject({
      name: 'ToolValidationError',
      reason: 'retry_budget_exhausted',
    });

    expect(request).not.toHaveBeenCalled();
    // Diagnostic emitted with the right type and detail.
    expect(arch.createDiagnostic).toHaveBeenCalledTimes(1);
    const diagBody = arch.createDiagnostic.mock.calls[0][1];
    expect(diagBody.diagnostic_type).toBe('retry_exhausted');
    expect(diagBody.session_id).toBe(SESSION_ID);
    expect(diagBody.scenario_id).toBe(SCENARIO_ID);
    expect(diagBody.operation_id).toBe('op-row-1');
    expect((diagBody.detail_json as { cap: number }).cap).toBe(LLM_HTTP_ATTEMPTS_PER_SCENARIO);
    // The capture row is NOT written when the budget is exhausted -- the
    // budget check fires before the request is issued.
    expect(arch.createCapture).not.toHaveBeenCalled();
  });
});

describe('execute_http_request -- createCapture failure', () => {
  it('rethrows when archModelClient.createCapture throws (no silent swallow)', async () => {
    startRun();
    const response: AxiosResponse<unknown> = {
      status: 200,
      statusText: 'OK',
      headers: {},
      config: {} as never,
      data: { ok: true },
    };
    const request = jest.fn(async () => response);
    const ctx = buildContext({
      httpExecutor: buildHttpExecutor(request),
    });
    const arch = ctx.archModelClient as MockArchClient;
    arch.createCapture.mockRejectedValueOnce(new Error('AMS write failed'));

    await expect(
      executeHttpRequestTool.handler(
        { operationId: 'getThings', method: 'get', path: '/things' },
        ctx,
      ),
    ).rejects.toThrow(/AMS write failed/);
    // The request DID happen -- failure is on the AMS write.
    expect(request).toHaveBeenCalledTimes(1);
    expect(arch.createCapture).toHaveBeenCalledTimes(1);
  });
});

// Type sentinels -- not test cases, just enforce that the imports compile.
void ToolValidationError;
