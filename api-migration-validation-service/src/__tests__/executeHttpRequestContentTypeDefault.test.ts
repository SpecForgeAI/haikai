/**
 * Focused tests for the executor Content-Type default broadening (Fix #3).
 *
 * Spec: 2026-06-19 Request Contract from Code Evidence -- Task Group 4 (R4).
 *
 * Scope (NOT exhaustive verb/body permutations):
 *   (a) a body-less PUT now sends a Content-Type (the #3 fix: setFavourite /
 *       unsetFavourite / revertFilterPromotionRequest).
 *   (b) the media type is sourced from the enriched operation's request
 *       content-type (`oasOperation.requestBody.content`), falling back to
 *       `application/json` when the operation carries none.
 *   (c) a caller-set Content-Type is preserved case-insensitively.
 *   (d) POST / PATCH behave the same; a GET with no body still sends none
 *       (no regression of the existing body-less-GET behaviour).
 */

import { AxiosResponse } from 'axios';
import { executeHttpRequestTool } from '../services/tools/execute_http_request';
import {
  type ArchModelToolWriteSurface,
  type ToolExecutionContext,
} from '../services/tools';
import { runManager } from '../services/runManager';
import type { CaptureSession } from '../types/captureSession';
import type { CaptureDto, OperationDto } from '../services/archModelClient';
import type { SessionHttpExecutor } from '../services/httpExecutor';
import type { ParsedOasInventory, ParsedOasOperation, HttpMethod } from '../types/oas';
import type { OpenAPIV3 } from 'openapi-types';

const SESSION_ID = 'session-ct-default-1';
const PROJECT_ID = 'proj-ct-1';
const ARCH_ID = 'arch-ct-1';
const SCENARIO_ID = 'scenario-ct-1';

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
    mutatingCallsConfirmed: true,
    startedAt: null,
    completedAt: null,
    errorMessage: null,
    createdAt: '2026-06-19T00:00:00Z',
    updatedAt: '2026-06-19T00:00:00Z',
    ...overrides,
  };
}

function buildOperation(overrides: Partial<OperationDto> = {}): OperationDto {
  return {
    id: 'op-row-1',
    session_id: SESSION_ID,
    operation_id: 'setFavourite',
    method: 'PUT',
    path: '/favourite',
    summary: null,
    description: null,
    included: true,
    // Mutating verbs default unsafe; the session confirms mutating calls.
    safe_to_execute: false,
    request_schema_json: null,
    response_schema_json: null,
    oas_operation_json: {},
    created_at: '2026-06-19T00:00:00Z',
    updated_at: '2026-06-19T00:00:00Z',
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
    createCapture: jest.fn(async () => ({ id: `capture-${nextId++}` } as Partial<CaptureDto>)) as MockArchClient['createCapture'],
  } as MockArchClient;
}

function buildHttpExecutor(request: jest.Mock): SessionHttpExecutor & { request: jest.Mock } {
  return {
    request,
    setAuth: jest.fn(),
    dispose: jest.fn(),
  } as unknown as SessionHttpExecutor & { request: jest.Mock };
}

function buildOasOp(
  operationId: string,
  method: HttpMethod,
  path: string,
  oasOperation: Record<string, unknown>,
): ParsedOasOperation {
  return {
    operationId,
    method,
    path,
    summary: null,
    description: null,
    requestSchema: null,
    responseSchema: null,
    oasOperation: oasOperation as unknown as OpenAPIV3.OperationObject,
  };
}

function buildContext(overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext {
  const arch = buildMockArchClient();
  const op = buildOperation();
  const inventory: ParsedOasInventory = {
    title: 'Test',
    version: '1.0.0',
    operations: overrides.oasInventory?.operations ?? [],
  };
  return {
    session: buildSession(),
    oasInventory: inventory,
    operationsByOasId: new Map([[op.operation_id, op]]),
    secrets: { sessionId: SESSION_ID, api: { type: 'none' }, loadedAt: Date.now() },
    httpExecutor: buildHttpExecutor(jest.fn()),
    dbAdapter: null,
    archModelClient: arch,
    currentScenarioId: SCENARIO_ID,
    ...overrides,
  };
}

function okResponse(status = 200): AxiosResponse<unknown> {
  return {
    status,
    statusText: 'OK',
    headers: {},
    config: {} as never,
    data: { ok: true },
  };
}

function startRun(): void {
  if (runManager.has(SESSION_ID)) runManager.end(SESSION_ID);
  runManager.start({ sessionId: SESSION_ID, projectId: PROJECT_ID, architectureId: ARCH_ID });
}

function sentHeaders(request: jest.Mock): Record<string, string> | undefined {
  const sentConfig = (request.mock.calls[0] as unknown[])[0] as {
    headers?: Record<string, string>;
  };
  return sentConfig.headers;
}

describe('execute_http_request -- Content-Type default for mutating verbs (Fix #3)', () => {
  afterEach(() => {
    if (runManager.has(SESSION_ID)) runManager.end(SESSION_ID);
  });

  it('(a) a body-less PUT now sends a Content-Type (defaults application/json when the op has no request media type)', async () => {
    startRun();
    const request = jest.fn(async () => okResponse(204));
    const ctx = buildContext({ httpExecutor: buildHttpExecutor(request) });

    await executeHttpRequestTool.handler(
      { operationId: 'setFavourite', method: 'put', path: '/favourite' },
      ctx,
    );

    expect(request).toHaveBeenCalledTimes(1);
    expect(sentHeaders(request)?.['Content-Type']).toBe('application/json');
  });

  it('(b) sources the media type from the enriched operation request content-type', async () => {
    startRun();
    const request = jest.fn(async () => okResponse(204));
    const op = buildOasOp('setFavourite', 'put', '/favourite', {
      operationId: 'setFavourite',
      requestBody: { content: { 'application/xml': { schema: { type: 'object' } } } },
      responses: {},
    });
    const ctx = buildContext({
      httpExecutor: buildHttpExecutor(request),
      oasInventory: { title: 'T', version: '1', operations: [op] },
    });

    await executeHttpRequestTool.handler(
      { operationId: 'setFavourite', method: 'put', path: '/favourite' },
      ctx,
    );

    expect(sentHeaders(request)?.['Content-Type']).toBe('application/xml');
  });

  it('(c) preserves a caller-set Content-Type case-insensitively on a body-less PUT', async () => {
    startRun();
    const request = jest.fn(async () => okResponse(204));
    const op = buildOasOp('setFavourite', 'put', '/favourite', {
      operationId: 'setFavourite',
      requestBody: { content: { 'application/xml': { schema: { type: 'object' } } } },
      responses: {},
    });
    const ctx = buildContext({
      httpExecutor: buildHttpExecutor(request),
      oasInventory: { title: 'T', version: '1', operations: [op] },
    });

    await executeHttpRequestTool.handler(
      {
        operationId: 'setFavourite',
        method: 'put',
        path: '/favourite',
        headers: { 'content-type': 'text/plain' },
      },
      ctx,
    );

    const h = sentHeaders(request);
    expect(h?.['content-type']).toBe('text/plain');
    // We did NOT add a second `Content-Type` key (and did NOT use the enriched
    // media type when the caller already set one).
    expect(Object.prototype.hasOwnProperty.call(h ?? {}, 'Content-Type')).toBe(false);
  });

  it('(d) POST and PATCH default a Content-Type with no body; a GET with no body still sends none', async () => {
    // POST, body-less.
    startRun();
    const postReq = jest.fn(async () => okResponse(201));
    const postOp = buildOperation({ operation_id: 'doPost', method: 'POST', path: '/p' });
    const postCtx = buildContext({
      httpExecutor: buildHttpExecutor(postReq),
      operationsByOasId: new Map([[postOp.operation_id, postOp]]),
    });
    await executeHttpRequestTool.handler(
      { operationId: 'doPost', method: 'post', path: '/p' },
      postCtx,
    );
    expect(sentHeaders(postReq)?.['Content-Type']).toBe('application/json');
    runManager.end(SESSION_ID);

    // PATCH, body-less.
    startRun();
    const patchReq = jest.fn(async () => okResponse(200));
    const patchOp = buildOperation({ operation_id: 'doPatch', method: 'PATCH', path: '/p' });
    const patchCtx = buildContext({
      httpExecutor: buildHttpExecutor(patchReq),
      operationsByOasId: new Map([[patchOp.operation_id, patchOp]]),
    });
    await executeHttpRequestTool.handler(
      { operationId: 'doPatch', method: 'patch', path: '/p' },
      patchCtx,
    );
    expect(sentHeaders(patchReq)?.['Content-Type']).toBe('application/json');
    runManager.end(SESSION_ID);

    // GET, body-less -> NO Content-Type (existing behaviour, no regression).
    startRun();
    const getReq = jest.fn(async () => okResponse(200));
    const getOp = buildOperation({
      operation_id: 'doGet',
      method: 'GET',
      path: '/g',
      safe_to_execute: true,
    });
    const getCtx = buildContext({
      httpExecutor: buildHttpExecutor(getReq),
      operationsByOasId: new Map([[getOp.operation_id, getOp]]),
    });
    await executeHttpRequestTool.handler(
      { operationId: 'doGet', method: 'get', path: '/g' },
      getCtx,
    );
    const getHeaders = getReq.mock.calls[0]
      ? ((getReq.mock.calls[0] as unknown[])[0] as { headers?: Record<string, string> }).headers
      : undefined;
    const hasContentType =
      !!getHeaders &&
      Object.keys(getHeaders).some((k) => k.toLowerCase() === 'content-type');
    expect(hasContentType).toBe(false);
  });

  it('(e) replaces a caller-set enum-style Content-Type (APPLICATION_JSON) with the resolved default', async () => {
    startRun();
    const request = jest.fn(async () => okResponse(204));
    const ctx = buildContext({ httpExecutor: buildHttpExecutor(request) });

    await executeHttpRequestTool.handler(
      {
        operationId: 'setFavourite',
        method: 'put',
        path: '/favourite',
        headers: { 'Content-Type': 'APPLICATION_JSON' },
      },
      ctx,
    );

    const h = sentHeaders(request);
    // The unparseable enum token never reaches the wire; it is replaced by the
    // contract-resolved default (application/json when the op has no contract).
    expect(h?.['Content-Type']).toBe('application/json');
    // And the bad value is not also left behind under any key casing.
    const contentTypeValues = Object.entries(h ?? {})
      .filter(([k]) => k.toLowerCase() === 'content-type')
      .map(([, v]) => v);
    expect(contentTypeValues).toEqual(['application/json']);
  });

  it('(f) an invalid caller Content-Type falls back to the enriched op media type (no enum->media-type map needed)', async () => {
    startRun();
    const request = jest.fn(async () => okResponse(204));
    const op = buildOasOp('setFavourite', 'put', '/favourite', {
      operationId: 'setFavourite',
      requestBody: { content: { 'application/xml': { schema: { type: 'object' } } } },
      responses: {},
    });
    const ctx = buildContext({
      httpExecutor: buildHttpExecutor(request),
      oasInventory: { title: 'T', version: '1', operations: [op] },
    });

    await executeHttpRequestTool.handler(
      {
        operationId: 'setFavourite',
        method: 'put',
        path: '/favourite',
        headers: { 'Content-Type': 'APPLICATION_XML' },
      },
      ctx,
    );

    // The contract resolver picks the right media type for the op, so a bogus
    // `APPLICATION_XML` lands on `application/xml` -- intent preserved without a
    // hand-curated enum-token map.
    expect(sentHeaders(request)?.['Content-Type']).toBe('application/xml');
  });
});
