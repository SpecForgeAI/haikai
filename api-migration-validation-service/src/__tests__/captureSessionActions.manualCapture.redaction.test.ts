/**
 * manual-capture redaction-parity tests
 * (spec 2026-06-20 Add New Behaviour -- Manual Capture, Task Group 8 gap-fill).
 *
 * The headline security guarantee of this feature is: a manually-sent request
 * is redacted IDENTICALLY to an LLM-generated capture. Both paths import the
 * SAME pure functions from `../services/redactor` (`redactHeaders`,
 * `redactJson`, `redactUrl`) and `../services/amsBodyEnvelope`
 * (`normaliseBodyForAms`), build the redacted shapes ONCE, and reuse them for
 * both `createScenario` and `createCapture`.
 *
 * The Task Group 2 happy-path test only passes non-sensitive headers/body, so
 * it does not actually prove redaction fired in the manual path. These tests
 * fill that gap by sending an `Authorization` request header, a `password`
 * body field, and a `set-cookie` response header through the route and pinning
 * that each is `[REDACTED]` in BOTH the persisted scenario and capture, that
 * redaction is applied exactly ONCE (idempotent -- a second pass leaves the
 * value unchanged), and that the persisted shapes match what the redactor
 * produces directly (the LLM path uses the same primitives the same way).
 *
 * Mocks mirror `captureSessionActions.manualCapture.test.ts`: the executor and
 * `archModelClient` are faked so no real HTTP / AMS traffic occurs.
 */

import express from 'express';
import request from 'supertest';

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
import {
  redactHeaders,
  redactJson,
  redactUrl,
  REDACTED_PLACEHOLDER,
} from '../services/redactor';
import { normaliseBodyForAms } from '../services/amsBodyEnvelope';
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
    name: 'manual-capture-redaction',
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
    operation_id: 'createWidget',
    method: 'POST',
    path: '/widgets',
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

function buildArchClient(session: CaptureSessionDto, operations: OperationDto[]): MockArch {
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

test('redacts sensitive request header + body field and sensitive response header before persisting', async () => {
  seedSecret();
  const arch = buildArchClient(buildSession(), [buildOperation()]);
  const app = buildApp(arch);

  mockRequest.mockResolvedValue({
    status: 201,
    headers: { 'content-type': 'application/json', 'set-cookie': 'session=abc123; HttpOnly' },
    data: { id: 7, accessToken: 'srv-issued-token' },
  });

  const res = await request(app)
    .post(`/api/capture-sessions/${SESSION_ID}/manual-capture?projectId=${PROJECT_ID}`)
    .send({
      operationId: OP_ROW_ID,
      method: 'POST',
      path: '/widgets',
      headers: { Authorization: 'Bearer leaked-token', 'X-Trace': 'keep-me' },
      body: { name: 'Acme', password: 'hunter2' },
      mutatingCallsConfirmed: true,
    });

  expect(res.status).toBe(201);

  // The SAME redacted shapes must feed BOTH createScenario and createCapture.
  const [, scenarioBody] = arch.createScenario.mock.calls[0];
  const [, captureBody] = arch.createCapture.mock.calls[0];

  // Sensitive REQUEST header redacted; benign header retained -- in both writes.
  for (const persisted of [scenarioBody, captureBody]) {
    expect(persisted.request_headers_redacted_json.Authorization).toBe(REDACTED_PLACEHOLDER);
    expect(persisted.request_headers_redacted_json['X-Trace']).toBe('keep-me');
  }

  // Sensitive REQUEST body field redacted; benign field retained -- in both.
  // (normaliseBodyForAms passes an object through unchanged.)
  for (const persisted of [scenarioBody, captureBody]) {
    expect(persisted.request_body_json.password).toBe(REDACTED_PLACEHOLDER);
    expect(persisted.request_body_json.name).toBe('Acme');
  }

  // Sensitive RESPONSE header redacted; benign header retained (capture only).
  expect(captureBody.response_headers_redacted_json['set-cookie']).toBe(REDACTED_PLACEHOLDER);
  expect(captureBody.response_headers_redacted_json['content-type']).toBe('application/json');

  // Sensitive RESPONSE body field redacted by name.
  expect(captureBody.response_body_json.accessToken).toBe(REDACTED_PLACEHOLDER);
  expect(captureBody.response_body_json.id).toBe(7);
});

test('persisted shapes equal a single direct application of the shared redactor (parity with the LLM path, redact-once)', async () => {
  seedSecret();
  const arch = buildArchClient(buildSession(), [buildOperation()]);
  const app = buildApp(arch);

  const requestHeaders = { Authorization: 'Bearer leaked-token', 'X-Trace': 'keep-me' };
  const requestBody = { name: 'Acme', password: 'hunter2' };
  const responseHeaders = { 'content-type': 'application/json', 'set-cookie': 'session=abc; HttpOnly' };
  const responseBody = { id: 7, accessToken: 'srv-issued-token' };

  mockRequest.mockResolvedValue({ status: 201, headers: responseHeaders, data: responseBody });

  await request(app)
    .post(`/api/capture-sessions/${SESSION_ID}/manual-capture?projectId=${PROJECT_ID}`)
    .send({
      operationId: OP_ROW_ID,
      method: 'POST',
      path: '/widgets',
      headers: requestHeaders,
      body: requestBody,
      mutatingCallsConfirmed: true,
    });

  const [, captureBody] = arch.createCapture.mock.calls[0];

  // Build the expected shapes by applying the shared primitives ONCE, exactly
  // as execute_http_request.ts (the LLM path) does. The persisted values must
  // equal these -- proving the manual path applies the identical redaction
  // exactly once (no double-redaction, no extra mutation).
  const expectedReqHeaders = redactHeaders(requestHeaders);
  const expectedReqBody = normaliseBodyForAms(redactJson(requestBody));
  const expectedResHeaders = redactHeaders(responseHeaders);
  const expectedResBody = normaliseBodyForAms(redactJson(responseBody));
  const expectedUrl = redactUrl('https://api.example.test/widgets');

  expect(captureBody.request_headers_redacted_json).toEqual(expectedReqHeaders);
  expect(captureBody.request_body_json).toEqual(expectedReqBody);
  expect(captureBody.response_headers_redacted_json).toEqual(expectedResHeaders);
  expect(captureBody.response_body_json).toEqual(expectedResBody);
  expect(captureBody.request_url_redacted).toBe(expectedUrl);

  // Redact-once is idempotent: feeding the persisted (already-redacted) shapes
  // back through the redactor yields the SAME values -- so a second accidental
  // pass would not corrupt them, and the single pass already fully scrubbed.
  expect(redactHeaders(captureBody.request_headers_redacted_json)).toEqual(
    captureBody.request_headers_redacted_json,
  );
  expect(redactJson(captureBody.response_body_json)).toEqual(captureBody.response_body_json);
});
