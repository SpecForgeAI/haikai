/**
 * manual-capture action endpoint tests
 * (spec 2026-06-20 Add New Behaviour -- Manual Capture, Task Group 2).
 *
 * The route physically sends ONE ad-hoc request for an EXISTING, included
 * operation through the per-session executor, redacts ONCE, then persists a
 * `manual` scenario + an `accepted=null` capture (volatile_paths_json=null).
 * It works on completed/failed sessions and is NOT gated on `status==='running'`.
 *
 * These tests mock BOTH `archModelClient` (via the router's dep seam) AND the
 * per-session HTTP executor (via `jest.mock` on `../services/httpExecutor`), so
 * no real HTTP / AMS traffic occurs. They cover the critical behaviours from
 * task 2.1: secrets gate, operation validation, the happy path's snake_case
 * shapes, a non-2xx resolve, a transport throw, and a completed-session run.
 */

import express from 'express';
import request from 'supertest';

// The executor module is mocked so `createSessionHttpExecutor` hands back a
// controllable fake. Each test sets `mockRequest` to a resolved response or a
// throw; `dispose` is asserted to fire in the route's `finally`.
const mockRequest = jest.fn();
const mockDispose = jest.fn();
jest.mock('../services/httpExecutor', () => ({
  createSessionHttpExecutor: jest.fn(() => ({
    request: mockRequest,
    requestWithAuthOverride: jest.fn(),
    setAuth: jest.fn(),
    dispose: mockDispose,
  })),
}));

import { buildCaptureSessionActionsRouter } from '../routes/captureSessionActions';
import { createSessionHttpExecutor } from '../services/httpExecutor';
import { secretsStore } from '../services/secretsStore';
import { oasInventoryStore } from '../services/oasInventoryStore';
import type {
  CaptureSessionDto,
  OperationDto,
  ScenarioDto,
  CaptureDto,
} from '../services/archModelClient';
import type { SecretsBundle } from '../types/secrets';

const PROJECT_ID = '00000000-0000-0000-0000-0000000000aa';
const ARCH_ID = '00000000-0000-0000-0000-0000000000bb';
const SESSION_ID = '00000000-0000-0000-0000-0000000000cc';
const OP_ROW_ID = '00000000-0000-0000-0000-0000000000d1';

function buildSession(overrides: Partial<CaptureSessionDto> = {}): CaptureSessionDto {
  const now = new Date().toISOString();
  return {
    id: SESSION_ID,
    project_id: PROJECT_ID,
    architecture_id: ARCH_ID,
    name: 'manual-capture',
    status: 'completed',
    env_name: 'non-prod',
    api_base_url: 'https://api.example.test',
    auth_type: 'bearer',
    auth_config_redacted_json: null,
    default_headers_redacted_json: null,
    oas_spec_refs_json: null,
    db_config_redacted_json: null,
    mutating_calls_confirmed: false,
    started_at: null,
    completed_at: now,
    error_message: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function buildOperation(overrides: Partial<OperationDto> = {}): OperationDto {
  const now = new Date().toISOString();
  return {
    id: OP_ROW_ID,
    session_id: SESSION_ID,
    operation_id: 'getWidget',
    method: 'GET',
    path: '/widgets/{id}',
    summary: null,
    description: null,
    included: true,
    safe_to_execute: true,
    request_schema_json: null,
    response_schema_json: null,
    oas_operation_json: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

interface MockArch {
  getCaptureSession: jest.Mock;
  listOperationsBySession: jest.Mock;
  createScenario: jest.Mock;
  createCapture: jest.Mock;
}

function buildArchClient(
  session: CaptureSessionDto,
  operations: OperationDto[],
): MockArch {
  return {
    getCaptureSession: jest.fn(async () => session),
    listOperationsBySession: jest.fn(async () => operations),
    createScenario: jest.fn(async (_projectId: string, body: any): Promise<ScenarioDto> => ({
      id: 'scenario-1',
      session_id: body.session_id,
      operation_id: body.operation_id,
      scenario_name: body.scenario_name ?? null,
      scenario_type: body.scenario_type ?? null,
      status: 'draft',
      generation_source: body.generation_source ?? null,
      request_method: body.request_method ?? null,
      request_path: body.request_path ?? null,
      request_query_json: body.request_query_json ?? null,
      request_headers_redacted_json: body.request_headers_redacted_json ?? null,
      request_body_json: body.request_body_json ?? null,
      notes: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })),
    createCapture: jest.fn(async (_projectId: string, body: any): Promise<CaptureDto> => ({
      id: 'capture-1',
      session_id: body.session_id,
      scenario_id: body.scenario_id,
      operation_id: body.operation_id,
      attempt_number: body.attempt_number ?? null,
      request_method: body.request_method ?? null,
      request_path: body.request_path ?? null,
      request_query_json: body.request_query_json ?? null,
      request_headers_redacted_json: body.request_headers_redacted_json ?? null,
      request_body_json: body.request_body_json ?? null,
      response_status: body.response_status ?? null,
      response_headers_redacted_json: body.response_headers_redacted_json ?? null,
      response_body_json: body.response_body_json ?? null,
      duration_ms: body.duration_ms ?? null,
      error_type: body.error_type ?? null,
      error_message: body.error_message ?? null,
      captured_at: body.captured_at ?? null,
      accepted: 'accepted' in body ? body.accepted : null,
      accepted_at: null,
      reviewer_notes: null,
      volatile_paths_json: body.volatile_paths_json ?? null,
    })),
  };
}

function buildApp(arch: MockArch) {
  const app = express();
  app.use(express.json());
  app.use(buildCaptureSessionActionsRouter({ archModelClient: arch as any }));
  return app;
}

function seedSecret(): void {
  const bundle: SecretsBundle = {
    sessionId: SESSION_ID,
    api: { type: 'bearer', bearerToken: 'live-token' },
    loadedAt: Date.now(),
  };
  secretsStore.set(bundle);
}

beforeEach(() => {
  secretsStore.clearAll();
  oasInventoryStore.clearAll();
  mockRequest.mockReset();
  mockDispose.mockReset();
  (createSessionHttpExecutor as jest.Mock).mockClear();
});

test('missing in-memory secret -> 409 SECRETS_NOT_LOADED', async () => {
  const arch = buildArchClient(buildSession(), [buildOperation()]);
  const app = buildApp(arch);

  const res = await request(app)
    .post(`/api/capture-sessions/${SESSION_ID}/manual-capture?projectId=${PROJECT_ID}`)
    .send({ operationId: OP_ROW_ID, method: 'GET', path: '/widgets/42' });

  // HTTP status is 409; the fail() envelope spreads the stable string 
  // (SECRETS_NOT_LOADED) over the numeric one, so the caller keys off it.
  expect(res.status).toBe(409);
  expect(res.body.error.code).toBe('SECRETS_NOT_LOADED');
  expect(res.body.error.message).toMatch(/secrets/i);
  // No send, no persistence.
  expect(mockRequest).not.toHaveBeenCalled();
  expect(arch.createScenario).not.toHaveBeenCalled();
  expect(arch.createCapture).not.toHaveBeenCalled();
});

test('unknown operation -> 404 OPERATION_NOT_FOUND, no send/persist', async () => {
  seedSecret();
  const arch = buildArchClient(buildSession(), [buildOperation()]);
  const app = buildApp(arch);

  const res = await request(app)
    .post(`/api/capture-sessions/${SESSION_ID}/manual-capture?projectId=${PROJECT_ID}`)
    .send({ operationId: 'does-not-exist', method: 'GET', path: '/widgets/42' });

  expect(res.status).toBe(404);
  expect(JSON.stringify(res.body)).toContain('OPERATION_NOT_FOUND');
  expect(mockRequest).not.toHaveBeenCalled();
  expect(arch.createScenario).not.toHaveBeenCalled();
  expect(arch.createCapture).not.toHaveBeenCalled();
});

test('operation present but included=false -> 400 OPERATION_NOT_INCLUDED', async () => {
  seedSecret();
  const arch = buildArchClient(buildSession(), [buildOperation({ included: false })]);
  const app = buildApp(arch);

  const res = await request(app)
    .post(`/api/capture-sessions/${SESSION_ID}/manual-capture?projectId=${PROJECT_ID}`)
    .send({ operationId: OP_ROW_ID, method: 'GET', path: '/widgets/42' });

  expect(res.status).toBe(400);
  expect(JSON.stringify(res.body)).toContain('OPERATION_NOT_INCLUDED');
  expect(mockRequest).not.toHaveBeenCalled();
  expect(arch.createScenario).not.toHaveBeenCalled();
  expect(arch.createCapture).not.toHaveBeenCalled();
});

test('OAS operation_id string resolves UNIQUELY -> tolerated; scenario + capture persist under the row UUID (2026-07-26 hardening)', async () => {
  seedSecret();
  const arch = buildArchClient(buildSession(), [buildOperation()]);
  const app = buildApp(arch);
  mockRequest.mockResolvedValue({ status: 200, headers: {}, data: { ok: true } });

  const res = await request(app)
    .post(`/api/capture-sessions/${SESSION_ID}/manual-capture?projectId=${PROJECT_ID}`)
    .send({ operationId: 'getWidget', method: 'GET', path: '/widgets/42' });

  expect(res.status).toBe(201);
  const [, scenarioBody] = arch.createScenario.mock.calls[0];
  expect(scenarioBody.operation_id).toBe(OP_ROW_ID);
  const [, captureBody] = arch.createCapture.mock.calls[0];
  expect(captureBody.operation_id).toBe(OP_ROW_ID);
});

test('AMBIGUOUS OAS operation_id string (legacy cross-route duplicate) -> 400 OPERATION_ID_AMBIGUOUS, no send', async () => {
  seedSecret();
  const twinA = buildOperation();
  const twinB = buildOperation({
    id: '00000000-0000-0000-0000-0000000000d2',
    path: '/widgets/{businessDate}/{id}',
  });
  const arch = buildArchClient(buildSession(), [twinA, twinB]);
  const app = buildApp(arch);

  const res = await request(app)
    .post(`/api/capture-sessions/${SESSION_ID}/manual-capture?projectId=${PROJECT_ID}`)
    .send({ operationId: 'getWidget', method: 'GET', path: '/widgets/42' });

  expect(res.status).toBe(400);
  expect(JSON.stringify(res.body)).toContain('OPERATION_ID_AMBIGUOUS');
  expect(mockRequest).not.toHaveBeenCalled();
  expect(arch.createScenario).not.toHaveBeenCalled();
});

test('happy path: 2xx send -> createScenario then createCapture with expected snake_case shapes; accepted OMITTED; volatile_paths_json null', async () => {
  seedSecret();
  const arch = buildArchClient(buildSession(), [buildOperation()]);
  const app = buildApp(arch);

  mockRequest.mockResolvedValue({
    status: 200,
    headers: { 'content-type': 'application/json' },
    data: { id: 42, name: 'Acme' },
  });

  const res = await request(app)
    .post(`/api/capture-sessions/${SESSION_ID}/manual-capture?projectId=${PROJECT_ID}`)
    .send({
      operationId: OP_ROW_ID,
      method: 'POST',
      path: '/widgets/42',
      query: { verbose: 'true' },
      headers: { 'X-Trace': 'abc' },
      body: { name: 'Acme' },
      mutatingCallsConfirmed: true,
    });

  expect(res.status).toBe(201);

  // One send through the executor; dispose() fired in finally.
  expect(mockRequest).toHaveBeenCalledTimes(1);
  expect(mockDispose).toHaveBeenCalledTimes(1);

  // createScenario: manual type + source, non-blank method + path, auto name.
  expect(arch.createScenario).toHaveBeenCalledTimes(1);
  const [, scenarioBody] = arch.createScenario.mock.calls[0];
  expect(scenarioBody).toMatchObject({
    session_id: SESSION_ID,
    operation_id: OP_ROW_ID,
    scenario_type: 'manual',
    generation_source: 'manual',
    request_method: 'POST',
    request_path: '/widgets/42',
  });
  expect(typeof scenarioBody.scenario_name).toBe('string');
  expect(scenarioBody.scenario_name).toMatch(/^Manual: POST \/widgets\/42 /);

  // createCapture: scenario fk, snake_case shapes, accepted OMITTED, volatile null.
  expect(arch.createCapture).toHaveBeenCalledTimes(1);
  const [, captureBody] = arch.createCapture.mock.calls[0];
  expect(captureBody).toMatchObject({
    session_id: SESSION_ID,
    scenario_id: 'scenario-1',
    operation_id: OP_ROW_ID,
    request_method: 'POST',
    request_path: '/widgets/42',
    request_query_json: { verbose: 'true' },
    response_status: 200,
    volatile_paths_json: null,
  });
  expect(captureBody.request_url_redacted).toBe('https://api.example.test/widgets/42');
  expect(captureBody.request_url_redacted.length).toBeGreaterThan(0);
  // Never accepted=false; the field must be entirely absent.
  expect('accepted' in captureBody).toBe(false);
  // Body wrapped via normaliseBodyForAms (object passes through).
  expect(captureBody.request_body_json).toEqual({ name: 'Acme' });
  expect(captureBody.response_body_json).toEqual({ id: 42, name: 'Acme' });

  // Response payload returns the created capture + scenario id.
  expect(res.body.scenarioId).toBe('scenario-1');
  expect(res.body.capture.id).toBe('capture-1');
});

test('non-2xx response (500) resolves and still persists a capture (status recorded, no throw)', async () => {
  seedSecret();
  const arch = buildArchClient(buildSession(), [buildOperation()]);
  const app = buildApp(arch);

  // validateStatus: () => true means a 500 RESOLVES rather than throwing.
  mockRequest.mockResolvedValue({
    status: 500,
    headers: { 'content-type': 'text/plain' },
    data: 'Internal Server Error',
  });

  const res = await request(app)
    .post(`/api/capture-sessions/${SESSION_ID}/manual-capture?projectId=${PROJECT_ID}`)
    .send({ operationId: OP_ROW_ID, method: 'GET', path: '/widgets/42' });

  expect(res.status).toBe(201);
  expect(arch.createCapture).toHaveBeenCalledTimes(1);
  const [, captureBody] = arch.createCapture.mock.calls[0];
  expect(captureBody.response_status).toBe(500);
  expect(captureBody.error_type).toBeNull();
  // Non-object body wrapped by normaliseBodyForAms.
  expect(captureBody.response_body_json).toEqual({ _raw: 'Internal Server Error', _type: 'string' });
  expect(mockDispose).toHaveBeenCalledTimes(1);
});

test('transport throw with no response -> capture persisted with error_type/error_message + null status/body', async () => {
  seedSecret();
  const arch = buildArchClient(buildSession(), [buildOperation()]);
  const app = buildApp(arch);

  // An axios error with NO `.response` is a transport failure.
  const transportErr: any = new Error('connect ECONNREFUSED');
  transportErr.code = 'ECONNREFUSED';
  mockRequest.mockRejectedValue(transportErr);

  const res = await request(app)
    .post(`/api/capture-sessions/${SESSION_ID}/manual-capture?projectId=${PROJECT_ID}`)
    .send({ operationId: OP_ROW_ID, method: 'GET', path: '/widgets/42' });

  expect(res.status).toBe(201);
  expect(arch.createCapture).toHaveBeenCalledTimes(1);
  const [, captureBody] = arch.createCapture.mock.calls[0];
  expect(captureBody.response_status).toBeNull();
  expect(captureBody.response_headers_redacted_json).toBeNull();
  expect(captureBody.response_body_json).toBeNull();
  expect(captureBody.error_type).toBe('ECONNREFUSED');
  expect(captureBody.error_message).toBe('connect ECONNREFUSED');
  expect(mockDispose).toHaveBeenCalledTimes(1);
});

test('works on a completed session (not gated on status === running)', async () => {
  seedSecret();
  const arch = buildArchClient(buildSession({ status: 'failed' }), [buildOperation()]);
  const app = buildApp(arch);

  mockRequest.mockResolvedValue({ status: 200, headers: {}, data: { ok: true } });

  const res = await request(app)
    .post(`/api/capture-sessions/${SESSION_ID}/manual-capture?projectId=${PROJECT_ID}`)
    .send({ operationId: OP_ROW_ID, method: 'GET', path: '/widgets/42' });

  expect(res.status).toBe(201);
  expect(arch.createScenario).toHaveBeenCalledTimes(1);
  expect(arch.createCapture).toHaveBeenCalledTimes(1);
});
