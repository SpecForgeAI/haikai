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
 * Also covers the 2026-06-17 capture-LLM request fixes (this file's later
 * describe blocks):
 *   - Fix 4: default `Content-Type: application/json` for a request that
 *     carries a body but whose caller did not set a content-type; a
 *     caller-set content-type is preserved; no body => no content-type added.
 *   - Fix 6 / Fix 8: a non-2xx HTML/text error body is distilled to a SHORT
 *     one-line `errorSummary`, surfaced both on the persisted capture row's
 *     `error_message` AND on the tool's LLM-facing `response.errorSummary`.
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
import { LLM_HTTP_ATTEMPTS_PER_SCENARIO, VOLATILITY_PROBE_REPEATS } from '../config';
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

    // FU-2: a non-mutating GET now also drives the capture-time volatility
    // probe, which replays the same request VOLATILITY_PROBE_REPEATS (k) more
    // times against the current system. So the executor is hit once for the
    // captured call plus k probe replays. createCapture is still ONE row.
    expect(request).toHaveBeenCalledTimes(1 + VOLATILITY_PROBE_REPEATS);
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
    // Fix 8: a 2xx response carries a null errorSummary on the return.
    expect(
      (result as { response: { errorSummary: string | null } }).response.errorSummary,
    ).toBeNull();
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
    // A non-2xx JSON (object) body is not a distillable string error page, so
    // `extractErrorSummary` returns null and `error_message` stays null.
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
    // The request DID happen -- failure is on the AMS write. FU-2: the
    // volatility probe runs BEFORE the createCapture write, so the executor
    // is hit once for the captured call plus k probe replays; the single
    // createCapture attempt is what fails.
    expect(request).toHaveBeenCalledTimes(1 + VOLATILITY_PROBE_REPEATS);
    expect(arch.createCapture).toHaveBeenCalledTimes(1);
  });
});

describe('execute_http_request -- Fix 4: default Content-Type for bodied requests', () => {
  it('adds Content-Type: application/json when a body is present and the caller set no content-type', async () => {
    startRun();
    const response: AxiosResponse<unknown> = {
      status: 201,
      statusText: 'Created',
      headers: {},
      config: {} as never,
      data: { id: 7 },
    };
    const request = jest.fn(async () => response);
    const op = buildOperation({
      operation_id: 'createThing',
      method: 'POST',
      path: '/things',
      included: true,
      safe_to_execute: false,
    });
    const ctx = buildContext({
      session: buildSession({ mutatingCallsConfirmed: true }),
      operationsByOasId: new Map([[op.operation_id, op]]),
      httpExecutor: buildHttpExecutor(request),
    });

    await executeHttpRequestTool.handler(
      { operationId: 'createThing', method: 'post', path: '/things', body: { name: 'x' } },
      ctx,
    );

    expect(request).toHaveBeenCalledTimes(1);
    const sentConfig = (request.mock.calls[0] as unknown[])[0] as {
      headers?: Record<string, string>;
      data?: unknown;
    };
    expect(sentConfig.headers).toBeDefined();
    expect(sentConfig.headers?.['Content-Type']).toBe('application/json');
    expect(sentConfig.data).toEqual({ name: 'x' });
  });

  it('preserves a caller-set content-type and does NOT override it (case-insensitive match)', async () => {
    startRun();
    const response: AxiosResponse<unknown> = {
      status: 201,
      statusText: 'Created',
      headers: {},
      config: {} as never,
      data: { id: 7 },
    };
    const request = jest.fn(async () => response);
    const op = buildOperation({
      operation_id: 'createThing',
      method: 'POST',
      path: '/things',
      included: true,
      safe_to_execute: false,
    });
    const ctx = buildContext({
      session: buildSession({ mutatingCallsConfirmed: true }),
      operationsByOasId: new Map([[op.operation_id, op]]),
      httpExecutor: buildHttpExecutor(request),
    });

    await executeHttpRequestTool.handler(
      {
        operationId: 'createThing',
        method: 'post',
        path: '/things',
        // Lower-cased key with a non-JSON media type -- must be preserved.
        headers: { 'content-type': 'application/xml' },
        body: '<thing/>',
      },
      ctx,
    );

    expect(request).toHaveBeenCalledTimes(1);
    const sentConfig = (request.mock.calls[0] as unknown[])[0] as {
      headers?: Record<string, string>;
    };
    // The caller's content-type survives verbatim; we did NOT add a second
    // `Content-Type` key.
    expect(sentConfig.headers?.['content-type']).toBe('application/xml');
    expect(
      Object.prototype.hasOwnProperty.call(sentConfig.headers ?? {}, 'Content-Type'),
    ).toBe(false);
  });

  it('does NOT add a content-type when there is no body', async () => {
    startRun();
    const response: AxiosResponse<unknown> = {
      status: 200,
      statusText: 'OK',
      headers: {},
      config: {} as never,
      data: { id: 1 },
    };
    const request = jest.fn(async () => response);
    const ctx = buildContext({
      httpExecutor: buildHttpExecutor(request),
    });

    await executeHttpRequestTool.handler(
      { operationId: 'getThings', method: 'get', path: '/things' },
      ctx,
    );

    expect(request).toHaveBeenCalled();
    const sentConfig = (request.mock.calls[0] as unknown[])[0] as {
      headers?: Record<string, string>;
    };
    // No caller headers and no body -> headers stays undefined and no
    // Content-Type is forced.
    const hasContentType =
      !!sentConfig.headers &&
      Object.keys(sentConfig.headers).some((k) => k.toLowerCase() === 'content-type');
    expect(hasContentType).toBe(false);
  });
});

describe('execute_http_request -- Fix 6/8: distilled error summary from HTML/text error bodies', () => {
  it('populates capture error_message and returns response.errorSummary for a non-2xx HTML error page', async () => {
    startRun();
    // A Tomcat-style 500 page burying the real fault inside the message row.
    const htmlBody = [
      '<!doctype html><html lang="en"><head>',
      '<title>HTTP Status 500 – Internal Server Error</title>',
      '</head><body><h1>HTTP Status 500</h1>',
      '<p><b>Message</b> Invalid format: 20240131 is malformed at "0131"</p>',
      '<p><b>Description</b> The server encountered an unexpected condition.</p>',
      '</body></html>',
    ].join('');
    const response: AxiosResponse<unknown> = {
      status: 500,
      statusText: 'Internal Server Error',
      headers: { 'content-type': 'text/html' },
      config: {} as never,
      data: htmlBody,
    };
    const request = jest.fn(async () => response);
    const ctx = buildContext({
      httpExecutor: buildHttpExecutor(request),
    });
    const arch = ctx.archModelClient as MockArchClient;

    const result = await executeHttpRequestTool.handler(
      { operationId: 'getThings', method: 'get', path: '/things' },
      ctx,
    );

    expect(arch.createCapture).toHaveBeenCalledTimes(1);
    const body = arch.createCapture.mock.calls[0][1];
    // (a) persisted capture row carries the distilled summary in error_message.
    expect(typeof body.error_message).toBe('string');
    expect(body.error_message.length).toBeGreaterThan(0);
    expect(body.error_message.length).toBeLessThanOrEqual(300);
    // The <title> is preferred and is a clean, tag-free one-liner.
    expect(body.error_message).toContain('HTTP Status 500');
    expect(body.error_message).not.toContain('<');
    // error_type stays null -- this is a real HTTP response, not a transport
    // failure.
    expect(body.error_type).toBeNull();

    // (b) the LLM-facing return surfaces the same summary on response.errorSummary.
    const ret = result as {
      response: { status: number; errorSummary: string | null };
    };
    expect(ret.response.status).toBe(500);
    expect(ret.response.errorSummary).toBe(body.error_message);
  });

  it('distills the buried Message line when there is no <title>, capping length', async () => {
    startRun();
    const longTail = 'x'.repeat(500);
    const textBody =
      'org.glassfish.jersey.message.internal.MessageBodyProviderNotFoundException\n' +
      `message Invalid format: 20240131 is malformed at "0131" ${longTail}`;
    const response: AxiosResponse<unknown> = {
      status: 415,
      statusText: 'Unsupported Media Type',
      headers: { 'content-type': 'text/plain' },
      config: {} as never,
      data: textBody,
    };
    const request = jest.fn(async () => response);
    const ctx = buildContext({
      httpExecutor: buildHttpExecutor(request),
    });
    const arch = ctx.archModelClient as MockArchClient;

    const result = await executeHttpRequestTool.handler(
      { operationId: 'getThings', method: 'get', path: '/things' },
      ctx,
    );

    const body = arch.createCapture.mock.calls[0][1];
    expect(typeof body.error_message).toBe('string');
    // First meaningful line is the exception class line, which is a useful
    // one-line cause; capped to <= 300 chars.
    expect(body.error_message.length).toBeLessThanOrEqual(300);
    expect(body.error_message.length).toBeGreaterThan(0);
    const ret = result as { response: { errorSummary: string | null } };
    expect(ret.response.errorSummary).toBe(body.error_message);
  });
});

describe('execute_http_request -- cross-scenario learned-fact harvest (Kiro #1/#2)', () => {
  it('Kiro #1: a non-2xx response with an error summary records a FAILED: learned fact', async () => {
    startRun();
    // A Tomcat-style 400 page burying the rejected-input fault. extractErrorSummary
    // distills it; the handler must then record it as a known-bad fact so LATER
    // scenarios avoid re-guessing the same malformed date.
    const htmlBody = [
      '<!doctype html><html lang="en"><head>',
      '<title>HTTP Status 400 – Bad Request</title>',
      '</head><body><p><b>Message</b> Invalid format: 2026-06-17 is malformed at "-06-17"</p>',
      '</body></html>',
    ].join('');
    const response: AxiosResponse<unknown> = {
      status: 400,
      statusText: 'Bad Request',
      headers: { 'content-type': 'text/html' },
      config: {} as never,
      data: htmlBody,
    };
    const request = jest.fn(async () => response);
    const ctx = buildContext({ httpExecutor: buildHttpExecutor(request) });

    await executeHttpRequestTool.handler(
      { operationId: 'getThings', method: 'get', path: '/things', query: { date: '2026-06-17' } },
      ctx,
    );

    const facts = runManager.getLearnedFacts(SESSION_ID);
    const failed = facts.find((f) => f.startsWith('FAILED:'));
    expect(failed).toBeDefined();
    // Carries the verb/path, the rejected query input, the status, and the
    // distilled cause so a later scenario can avoid the malformed value.
    expect(failed).toContain('GET /things');
    expect(failed).toContain('2026-06-17');
    expect(failed).toContain('400');
    // No OK fact is recorded for a non-2xx response.
    expect(facts.some((f) => f.startsWith('OK '))).toBe(false);
    // Capped well under the 240-char limit guard.
    expect((failed as string).length).toBeLessThanOrEqual(240);
  });

  it('Kiro #2: a 2xx whose body has an id / hierarchyNodeId records OK id: facts with provenance', async () => {
    startRun();
    const response: AxiosResponse<unknown> = {
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      config: {} as never,
      // A search-style result: an id-ish key at top level and a nested
      // hierarchyNodeId the LLM should chain into a later detail call.
      data: { results: [{ id: 42, hierarchyNodeId: 90000, name: 'node' }] },
    };
    const request = jest.fn(async () => response);
    const ctx = buildContext({ httpExecutor: buildHttpExecutor(request) });

    await executeHttpRequestTool.handler(
      { operationId: 'getThings', method: 'get', path: '/things' },
      ctx,
    );

    const facts = runManager.getLearnedFacts(SESSION_ID);
    const idFacts = facts.filter((f) => f.startsWith('OK id:'));
    // Both id-ish keys were harvested from the SUCCESSFUL response body.
    expect(idFacts.some((f) => f.includes('hierarchyNodeId=90000'))).toBe(true);
    expect(idFacts.some((f) => f.includes('id=42'))).toBe(true);
    // Provenance points back at the call that surfaced the id.
    expect(idFacts.every((f) => f.includes('(from GET /things)'))).toBe(true);
    // The known-good REQUEST fact (fix 5) is still recorded alongside.
    expect(facts.some((f) => f.startsWith('OK GET /things -> 200'))).toBe(true);
  });

  it('a 2xx body with no id-ish keys records the request fact but no OK id: facts (defensive)', async () => {
    startRun();
    const response: AxiosResponse<unknown> = {
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      config: {} as never,
      data: { name: 'no-ids-here', count: 3 },
    };
    const request = jest.fn(async () => response);
    const ctx = buildContext({ httpExecutor: buildHttpExecutor(request) });

    await executeHttpRequestTool.handler(
      { operationId: 'getThings', method: 'get', path: '/things' },
      ctx,
    );

    const facts = runManager.getLearnedFacts(SESSION_ID);
    expect(facts.some((f) => f.startsWith('OK id:'))).toBe(false);
    expect(facts.some((f) => f.startsWith('OK GET /things -> 200'))).toBe(true);
  });
});

// Type sentinels -- not test cases, just enforce that the imports compile.
void ToolValidationError;
