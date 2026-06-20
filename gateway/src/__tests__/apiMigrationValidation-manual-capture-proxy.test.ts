/**
 * API Migration Validation -- manual-capture action proxy test
 *
 * Spec: 2026-06-20 Add New Behaviour -- Manual Capture, Task Group 3.
 *
 * The gateway forwards the new `manual-capture` action to the
 * api-migration-validation-service exactly like the other JSON action proxies
 * (start / extract-endpoints / reconcile-inventory / account-endpoints): the
 * existing `for (const action of API_BEHAVIOUR_ACTION_PATHS)` loop registers a
 * JSON proxy for every entry except the multipart `parse-oas`. This test pins:
 *   1. `manual-capture` is a member of API_BEHAVIOUR_ACTION_PATHS.
 *   2. A POST to the gateway action path forwards URL safety segments
 *      (projectId + architectureId as query params, sessionId in the path) and
 *      the JSON body VERBATIM to the new service -- a JSON action, NOT multipart.
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
import {
  apiMigrationValidationRouter,
  API_BEHAVIOUR_ACTION_PATHS,
} from '../routes/apiMigrationValidation';

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status >= 200 && status < 300 ? 'OK' : 'Error',
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
    (req as any).requestId = 'api-migration-validation-manual-capture-test';
    next();
  });
  app.use('/api/v1', apiMigrationValidationRouter);
  return app;
}

beforeEach(() => {
  mockFetch.mockReset();
});

test('manual-capture is registered in API_BEHAVIOUR_ACTION_PATHS', () => {
  expect(API_BEHAVIOUR_ACTION_PATHS as readonly string[]).toContain('manual-capture');
});

test('POST /capture-sessions/:sessionId/manual-capture forwards URL params + JSON body to the new service', async () => {
  const projectId = 'proj-abc';
  const architectureId = 'arch-xyz';
  const sessionId = 'sess-42';
  const operationId = 'op-row-1';

  // The new service returns the created capture on 201.
  const created = {
    sessionId,
    scenarioId: 'scenario-1',
    capture: { id: 'capture-1', response_status: 200 },
  };
  mockFetch.mockResolvedValueOnce(jsonResponse(201, created));

  const reqBody = {
    operationId,
    method: 'POST',
    path: '/widgets/42',
    query: { verbose: 'true' },
    headers: { 'X-Trace': 'abc' },
    body: { name: 'Acme' },
    mutatingCallsConfirmed: true,
  };

  const app = createTestApp();
  const res = await request(app)
    .post(
      `/api/v1/projects/${projectId}/architectures/${architectureId}` +
        `/api-behaviour/capture-sessions/${sessionId}/manual-capture`,
    )
    .send(reqBody);

  expect(res.status).toBe(201);
  expect(res.body).toEqual(created);

  // EXACTLY one upstream call -- thin pass-through, same posture as the other
  // JSON action proxies.
  expect(mockFetch).toHaveBeenCalledTimes(1);
  const [calledUrl, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit];
  const u = new URL(calledUrl);
  expect(`${u.origin}${u.pathname}`).toBe(
    `http://localhost:8092/api-migration-validation/api/capture-sessions/${sessionId}/manual-capture`,
  );
  expect(u.searchParams.get('projectId')).toBe(projectId);
  expect(u.searchParams.get('architectureId')).toBe(architectureId);

  // JSON action, NOT multipart: Content-Type application/json + verbatim body.
  expect(calledInit.method).toBe('POST');
  expect(calledInit.headers).toEqual({
    'Content-Type': 'application/json',
    Accept: 'application/json',
  });
  expect(calledInit.body).toBe(JSON.stringify(reqBody));
});
