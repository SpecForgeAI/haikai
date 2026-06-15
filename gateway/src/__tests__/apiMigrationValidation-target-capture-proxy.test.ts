/**
 * API Migration Validation -- Target-Capture Proxy Tests
 *
 * Spec: 2026-05-25 API Test Harness -- Target-Side Capture -- Task Group 4
 * sub-task 4.1.
 *
 * Test inventory (3 tests, focused on URL forwarding for the new target-side
 * proxies). The fourth gateway test in the spec's 4-test budget covers the
 * typed-client wrapper signature and lives in `apiBehaviourClient.test.ts`.
 *
 *   1. POST /api/v1/api-migration-validation/target-capture-sessions forwards
 *      the body verbatim to the validation service and pipes the upstream
 *      status (201) + body back to the caller.
 *
 *   2. GET .../target-capture-sessions/:id/status forwards verbatim AND
 *      pipes an upstream 404 back to the caller (the polling client must
 *      distinguish "session missing" from "service down" -- both are
 *      legitimate states during cleanup races, and the gateway is a thin
 *      pass-through).
 *
 *   3. AMS-direct pairing-read proxy: GET /api/v1/projects/:projectId/
 *      api-behaviour/baselines/:sourceId/target-baselines forwards verbatim
 *      to the AMS endpoint of the same shape (`/api/projects/.../api-behaviour
 *      /baselines/:sourceId/target-baselines`) and returns the list body
 *      unchanged.
 */

// ---------------------------------------------------------------------------
// Mocks (declared before importing the route under test)
// ---------------------------------------------------------------------------

jest.mock('../config', () => ({
  getConfig: () => ({
    architectureModelServiceBaseUrl: 'http://localhost:8080',
    discoveryServiceBaseUrl: 'http://localhost:8091',
    apiMigrationValidationServiceBaseUrl: 'http://localhost:8092',
    llmProvider: 'openai',
  }),
  resetConfig: jest.fn(),
}));

jest.mock('../services/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('../services/llmClient', () => ({
  getLlmClient: () => ({ sendChatRequest: jest.fn() }),
}));

const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import express from 'express';
import request from 'supertest';
import { apiMigrationValidationRouter } from '../routes/apiMigrationValidation';

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : status === 201 ? 'Created' : status === 404 ? 'Not Found' : 'Error',
    headers: {
      get: (k: string) => (k.toLowerCase() === 'content-type' ? 'application/json' : null),
    },
    json: async () => body,
    text: async () => (body === null || body === undefined ? '' : JSON.stringify(body)),
  };
}

function createTestApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use((req, _res, next) => {
    (req as any).requestId = 'api-migration-validation-target-test';
    next();
  });
  app.use('/api/v1', apiMigrationValidationRouter);
  return app;
}

beforeEach(() => {
  mockFetch.mockReset();
});

// ---------------------------------------------------------------------------
// Test 1: POST /target-capture-sessions forwards the body verbatim to the
// validation service and passes the upstream 201 through unchanged.
//
// The validation service publishes this route at:
//   POST http://<service>/api-migration-validation/api/target-capture-sessions
// Server-side it stamps kind='target' on the persisted row -- the gateway
// does NOT massage the body.
// ---------------------------------------------------------------------------
test('POST /target-capture-sessions forwards body verbatim and pipes upstream 201 through', async () => {
  const projectId = 'proj-abc';
  const architectureId = 'arch-xyz';
  const sourceBaselineId = 'base-src-1';

  const createdSession = {
    id: 'sess-tgt-9',
    project_id: projectId,
    architecture_id: architectureId,
    status: 'draft',
    kind: 'target',
    source_baseline_id: sourceBaselineId,
    api_base_url: 'https://target.example/v1',
    mutating_calls_confirmed: false,
  };
  mockFetch.mockResolvedValueOnce(jsonResponse(201, createdSession));

  const app = createTestApp();
  const body = {
    projectId,
    architectureId,
    sourceBaselineId,
    targetApiBaseUrl: 'https://target.example/v1',
    name: 'Target replay 1',
    authType: 'bearer',
    authConfigRedactedJson: { bearer: '***' },
    defaultHeadersRedactedJson: { 'X-Tenant': 'acme' },
    mutatingCallsConfirmed: false,
  };
  const res = await request(app)
    .post('/api/v1/api-migration-validation/target-capture-sessions')
    .send(body);

  expect(res.status).toBe(201);
  expect(res.body).toEqual(createdSession);

  expect(mockFetch).toHaveBeenCalledTimes(1);
  const [calledUrl, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit];
  const u = new URL(calledUrl);
  expect(`${u.origin}${u.pathname}`).toBe(
    'http://localhost:8092/api-migration-validation/api/target-capture-sessions',
  );
  expect(calledInit.method).toBe('POST');
  expect(calledInit.headers).toEqual({
    'Content-Type': 'application/json',
    Accept: 'application/json',
  });
  // Body is forwarded verbatim -- no massaging, no field renaming.
  expect(JSON.parse(calledInit.body as string)).toEqual(body);
});

// ---------------------------------------------------------------------------
// Test 2: GET /target-capture-sessions/:id/status forwards verbatim and
// tolerates an upstream 404 (polling clients distinguish "session missing"
// from "service down"). The gateway is a thin pass-through -- it does NOT
// remap 404 to 200/empty or to 503.
// ---------------------------------------------------------------------------
test('GET /target-capture-sessions/:id/status forwards verbatim and pipes upstream 404 through', async () => {
  const sessionId = 'sess-missing';
  const projectId = 'proj-abc';

  // Validation service returns 404 with its standard error envelope when
  // the session id doesn't resolve. The gateway must surface that 404
  // unchanged so the polling client knows to stop.
  const upstreamErrorBody = {
    error: { code: 404, message: `Capture session ${sessionId} not found` },
  };
  mockFetch.mockResolvedValueOnce(jsonResponse(404, upstreamErrorBody));

  const app = createTestApp();
  const res = await request(app).get(
    `/api/v1/api-migration-validation/target-capture-sessions/${sessionId}/status?projectId=${projectId}`,
  );

  expect(res.status).toBe(404);
  expect(res.body).toEqual(upstreamErrorBody);

  expect(mockFetch).toHaveBeenCalledTimes(1);
  const [calledUrl, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit];
  const u = new URL(calledUrl);
  expect(`${u.origin}${u.pathname}`).toBe(
    `http://localhost:8092/api-migration-validation/api/target-capture-sessions/${sessionId}/status`,
  );
  // Query string forwarded verbatim -- the validation service's
  // `extractProjectId` reads `projectId` off the query.
  expect(u.searchParams.get('projectId')).toBe(projectId);
  expect(calledInit.method).toBe('GET');
});

// ---------------------------------------------------------------------------
// Test 3: AMS-direct pairing-read proxy forwards verbatim to AMS.
//
// The gateway route mirrors the AMS path shape verbatim (no architectureId
// in the URL -- AMS enforces project + source-baseline scoping). The list
// body comes back unchanged. Frontend in this spec does NOT call this
// proxy; Spec #5's diff UI will. The proxy ships now so the AMS contract is
// fully proxied.
// ---------------------------------------------------------------------------
test('GET /projects/:projectId/api-behaviour/baselines/:sourceId/target-baselines forwards to AMS verbatim', async () => {
  const projectId = 'proj-abc';
  const sourceId = 'base-src-1';

  const pairedTargets = [
    {
      id: 'base-tgt-1',
      project_id: projectId,
      architecture_id: 'arch-xyz',
      status: 'active',
      kind: 'target',
      paired_with_baseline_id: sourceId,
      created_at: '2026-05-25T10:00:00Z',
    },
    {
      id: 'base-tgt-2',
      project_id: projectId,
      architecture_id: 'arch-xyz',
      status: 'active',
      kind: 'target',
      paired_with_baseline_id: sourceId,
      created_at: '2026-05-25T09:00:00Z',
    },
  ];
  mockFetch.mockResolvedValueOnce(jsonResponse(200, pairedTargets));

  const app = createTestApp();
  const res = await request(app).get(
    `/api/v1/projects/${projectId}/api-behaviour/baselines/${sourceId}/target-baselines`,
  );

  expect(res.status).toBe(200);
  expect(res.body).toEqual(pairedTargets);

  expect(mockFetch).toHaveBeenCalledTimes(1);
  const [calledUrl, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit];
  const u = new URL(calledUrl);
  expect(`${u.origin}${u.pathname}`).toBe(
    `http://localhost:8080/api/projects/${projectId}/api-behaviour/baselines/${sourceId}/target-baselines`,
  );
  expect(calledInit.method).toBe('GET');
});
