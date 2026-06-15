/**
 * Gateway stateless test-connection proxy tests (Fix 2).
 *
 * Spec: 2026-05-25 API Test Harness -- wizard pre-flight stateless
 * test-connection endpoint.
 *
 * The gateway exposes
 *   POST /api/v1/projects/:projectId/architectures/:architectureId/
 *        api-behaviour/test-connection
 * and forwards verbatim to the validation service's session-less
 *   POST /api-migration-validation/api/test-connection
 * (no projectId/architectureId/sessionId downstream -- the probe is fully
 * described by the body). The upstream status + body are piped back; a
 * network failure surfaces as 503.
 *
 * Test inventory:
 *   1. Forwards the JSON body verbatim to the validation-service URL and
 *      pipes the upstream 200 body back. Exactly one upstream call. No
 *      projectId/architectureId on the downstream URL.
 *   2. Network/fetch failure -> 503 with the structured error envelope.
 *   3. Missing :architectureId 404s at Express (URL safety property).
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
    statusText: status === 200 ? 'OK' : 'Error',
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
    (req as any).requestId = 'test-connection-proxy-test';
    next();
  });
  app.use('/api/v1', apiMigrationValidationRouter);
  return app;
}

beforeEach(() => {
  mockFetch.mockReset();
});

// ---------------------------------------------------------------------------
// Test 1: forwards body verbatim + pipes upstream body back.
// ---------------------------------------------------------------------------
test('POST .../api-behaviour/test-connection forwards body verbatim to the validation service and pipes the response back', async () => {
  const projectId = 'proj-abc';
  const architectureId = 'arch-xyz';

  const upstreamBody = { success: true, status: 200, durationMs: 42 };
  mockFetch.mockResolvedValueOnce(jsonResponse(200, upstreamBody));

  const reqBody = {
    baseUrl: 'https://target.example.test',
    auth: { type: 'bearer', token: 'plaintext-token' },
    defaultHeaders: [{ name: 'X-Tenant', value: 'acme' }],
  };

  const app = createTestApp();
  const res = await request(app)
    .post(
      `/api/v1/projects/${projectId}/architectures/${architectureId}` +
        `/api-behaviour/test-connection`,
    )
    .send(reqBody);

  expect(res.status).toBe(200);
  expect(res.body).toEqual(upstreamBody);

  // EXACTLY one upstream call -- thin pass-through.
  expect(mockFetch).toHaveBeenCalledTimes(1);
  const [calledUrl, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit];
  const u = new URL(calledUrl);
  // Session-less downstream route -- no projectId/architectureId, no sessionId.
  expect(`${u.origin}${u.pathname}`).toBe(
    'http://localhost:8092/api-migration-validation/api/test-connection',
  );
  expect(u.search).toBe('');
  expect(calledInit.method).toBe('POST');
  expect(calledInit.headers).toEqual({
    'Content-Type': 'application/json',
    Accept: 'application/json',
  });
  // Body forwarded verbatim (secrets ride in-memory to the validation service).
  expect(calledInit.body).toBe(JSON.stringify(reqBody));
});

// ---------------------------------------------------------------------------
// Test 2: upstream non-2xx body is piped back verbatim (e.g. a 400 from a
// missing baseUrl validated downstream).
// ---------------------------------------------------------------------------
test('pipes a non-2xx upstream status + body back verbatim', async () => {
  const projectId = 'proj-abc';
  const architectureId = 'arch-xyz';
  const upstreamErr = { error: { code: 400, message: 'baseUrl is required' } };
  mockFetch.mockResolvedValueOnce(jsonResponse(400, upstreamErr));

  const app = createTestApp();
  const res = await request(app)
    .post(
      `/api/v1/projects/${projectId}/architectures/${architectureId}` +
        `/api-behaviour/test-connection`,
    )
    .send({ auth: { type: 'none' } });

  expect(res.status).toBe(400);
  expect(res.body).toEqual(upstreamErr);
  expect(mockFetch).toHaveBeenCalledTimes(1);
});

// ---------------------------------------------------------------------------
// Test 3: network failure -> 503 structured envelope.
// ---------------------------------------------------------------------------
test('a network failure forwarding to the validation service yields 503', async () => {
  const projectId = 'proj-abc';
  const architectureId = 'arch-xyz';
  mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

  const app = createTestApp();
  const res = await request(app)
    .post(
      `/api/v1/projects/${projectId}/architectures/${architectureId}` +
        `/api-behaviour/test-connection`,
    )
    .send({ baseUrl: 'https://target.example.test', auth: { type: 'none' } });

  expect(res.status).toBe(503);
  expect(res.body.error.code).toBe(503);
  expect(res.body.error.message).toContain('API migration validation service unavailable');
  expect(res.body.error.details).toContain('ECONNREFUSED');
});

// ---------------------------------------------------------------------------
// Test 4: omitting :architectureId 404s at Express (URL safety property).
// ---------------------------------------------------------------------------
test('omitting :architectureId 404s at the Express layer (no upstream call)', async () => {
  const projectId = 'proj-abc';

  const app = createTestApp();
  const res = await request(app)
    .post(`/api/v1/projects/${projectId}/api-behaviour/test-connection`)
    .send({ baseUrl: 'https://target.example.test', auth: { type: 'none' } });

  expect(res.status).toBe(404);
  expect(mockFetch).not.toHaveBeenCalled();
});
