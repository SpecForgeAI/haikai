/**
 * API Migration Validation -- inventory-reconciliation action proxy tests.
 *
 * Spec: 2026-06-11 Model-Seeded Capture Inventory -- Task Group 3
 * sub-task 3.1.
 *
 * Test inventory (2 tests, focused on URL forwarding for the two NEW action
 * proxies registered in `API_BEHAVIOUR_ACTION_PATHS` -- no bespoke proxy
 * code, no multipart handling on either):
 *   1. POST .../capture-sessions/:sessionId/reconcile-inventory forwards the
 *      URL safety segments (projectId + architectureId as query params) and
 *      the JSON body verbatim, and round-trips the AMS reconciliation
 *      payload back to the caller unchanged.
 *   2. POST .../capture-sessions/:sessionId/account-endpoints forwards
 *      likewise (bulk include/exclude items body), round-tripping the
 *      created-operations response.
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
    statusText: 'OK',
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
    (req as any).requestId = 'api-migration-validation-inventory-actions-test';
    next();
  });
  app.use('/api/v1', apiMigrationValidationRouter);
  return app;
}

beforeEach(() => {
  mockFetch.mockReset();
});

// ---------------------------------------------------------------------------
// Test 1: reconcile-inventory proxies as a plain JSON action and round-trips
// the AMS reconciliation payload.
// ---------------------------------------------------------------------------
test('POST /capture-sessions/:sessionId/reconcile-inventory forwards URL params + body and round-trips the payload', async () => {
  const projectId = 'proj-abc';
  const architectureId = 'arch-xyz';
  const sessionId = 'sess-77';

  // The validation service returns the AMS reconciliation payload VERBATIM.
  const upstreamBody = {
    in_scope_unaccounted_endpoints: [
      {
        endpoint_id: 'ep-1',
        interface_id: 'iface-1',
        key: 'GET /orders/{id}',
        name: 'getOrder',
        method: 'GET',
        path: '/orders/{id}',
        protocol: 'REST',
        soap_action: null,
        request_root_element: null,
      },
    ],
    operations_without_model_endpoint: [],
    excluded_by_scope_endpoints: [],
    in_scope_coverage_pct: 50,
    in_scope_accounted_count: 1,
    in_scope_total_count: 2,
    architecture_coverage_pct: 25,
    architecture_accounted_count: 1,
    architecture_total_count: 4,
  };
  mockFetch.mockResolvedValueOnce(jsonResponse(200, upstreamBody));

  const reqBody = { scopeInterfaceIds: ['iface-1'], persistScope: true, refreshFindings: true };

  const app = createTestApp();
  const res = await request(app)
    .post(
      `/api/v1/projects/${projectId}/architectures/${architectureId}` +
        `/api-behaviour/capture-sessions/${sessionId}/reconcile-inventory`,
    )
    .send(reqBody);

  expect(res.status).toBe(200);
  expect(res.body).toEqual(upstreamBody);

  // EXACTLY one upstream call -- thin pass-through, same posture as the
  // other action proxies; no multipart handling on this action.
  expect(mockFetch).toHaveBeenCalledTimes(1);
  const [calledUrl, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit];
  const u = new URL(calledUrl);
  expect(`${u.origin}${u.pathname}`).toBe(
    `http://localhost:8092/api-migration-validation/api/capture-sessions/${sessionId}/reconcile-inventory`,
  );
  expect(u.searchParams.get('projectId')).toBe(projectId);
  expect(u.searchParams.get('architectureId')).toBe(architectureId);
  expect(calledInit.method).toBe('POST');
  expect(calledInit.headers).toEqual({
    'Content-Type': 'application/json',
    Accept: 'application/json',
  });
  expect(calledInit.body).toBe(JSON.stringify(reqBody));
});

// ---------------------------------------------------------------------------
// Test 2: account-endpoints proxies as a plain JSON action likewise.
// ---------------------------------------------------------------------------
test('POST /capture-sessions/:sessionId/account-endpoints forwards URL params + body and round-trips the response', async () => {
  const projectId = 'proj-abc';
  const architectureId = 'arch-xyz';
  const sessionId = 'sess-77';

  const upstreamBody = {
    sessionId,
    operations: [
      {
        id: 'op-row-1',
        session_id: sessionId,
        operation_id: 'getOrder',
        method: 'GET',
        path: '/orders/{id}',
        included: true,
        safe_to_execute: null,
        exclusion_reason: null,
      },
      {
        id: 'op-row-2',
        session_id: sessionId,
        operation_id: 'legacyPing',
        method: 'GET',
        path: '/legacy/ping',
        included: false,
        safe_to_execute: null,
        exclusion_reason: 'deprecated endpoint',
      },
    ],
  };
  mockFetch.mockResolvedValueOnce(jsonResponse(200, upstreamBody));

  const reqBody = {
    items: [
      { endpoint_id: 'ep-1', action: 'include' },
      { endpoint_id: 'ep-2', action: 'exclude', reason: 'deprecated endpoint' },
    ],
  };

  const app = createTestApp();
  const res = await request(app)
    .post(
      `/api/v1/projects/${projectId}/architectures/${architectureId}` +
        `/api-behaviour/capture-sessions/${sessionId}/account-endpoints`,
    )
    .send(reqBody);

  expect(res.status).toBe(200);
  expect(res.body).toEqual(upstreamBody);

  expect(mockFetch).toHaveBeenCalledTimes(1);
  const [calledUrl, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit];
  const u = new URL(calledUrl);
  expect(`${u.origin}${u.pathname}`).toBe(
    `http://localhost:8092/api-migration-validation/api/capture-sessions/${sessionId}/account-endpoints`,
  );
  expect(u.searchParams.get('projectId')).toBe(projectId);
  expect(u.searchParams.get('architectureId')).toBe(architectureId);
  expect(calledInit.method).toBe('POST');
  expect(calledInit.headers).toEqual({
    'Content-Type': 'application/json',
    Accept: 'application/json',
  });
  expect(calledInit.body).toBe(JSON.stringify(reqBody));
});
