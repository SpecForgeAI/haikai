/**
 * API Migration Validation -- Diff Engine Proxy Tests
 *
 * Spec: 2026-05-25 API Test Harness -- Diff Engine -- Task Group 4
 * sub-task 4.1.
 *
 * Test inventory (3 proxy tests; the fourth gateway test in the 4-test
 * budget covers the typed-client wrapper and lives in
 * `apiBehaviourClient.diff.test.ts`):
 *
 *   1. POST /api/v1/api-migration-validation/diffs forwards body verbatim
 *      to the validation service and pipes the upstream 200 + diff DTO
 *      response through unchanged.
 *
 *   2. GET .../diffs/:id/status forwards verbatim AND pipes an upstream
 *      404 back to the caller (polling clients distinguish "diff missing"
 *      from "service down" -- both are legitimate transient states).
 *
 *   3. AMS-direct by-target proxy: GET /api/v1/projects/:projectId/
 *      api-behaviour/diffs/by-target/:targetBaselineId forwards verbatim
 *      to AMS at the same shape with both path params preserved.
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
    statusText:
      status === 200 ? 'OK' : status === 201 ? 'Created' : status === 404 ? 'Not Found' : 'Error',
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
    (req as any).requestId = 'api-migration-validation-diff-test';
    next();
  });
  app.use('/api/v1', apiMigrationValidationRouter);
  return app;
}

beforeEach(() => {
  mockFetch.mockReset();
});

// ---------------------------------------------------------------------------
// Test 1: POST /diffs forwards body verbatim to the validation service.
//
// The validation service publishes this route at:
//   POST http://<service>/api-migration-validation/api/diffs
// Body shape: `{ projectId, architectureId, sourceBaselineId, targetBaselineId }`.
// Server creates the diff in `status='computing'` and returns the diffId
// immediately; the gateway is a thin pass-through.
// ---------------------------------------------------------------------------
test('POST /diffs forwards body verbatim and pipes upstream 200 through', async () => {
  const projectId = 'proj-diff-1';
  const architectureId = 'arch-diff-1';
  const sourceBaselineId = 'base-src-1';
  const targetBaselineId = 'base-tgt-1';

  const createdDiff = {
    id: 'diff-9',
    project_id: projectId,
    architecture_id: architectureId,
    source_baseline_id: sourceBaselineId,
    target_baseline_id: targetBaselineId,
    status: 'computing',
    matched_count: null,
    status_drift_count: null,
    body_shape_drift_count: null,
    body_value_drift_count: null,
    source_only_count: null,
    target_only_count: null,
    computed_at: null,
    error_message: null,
  };
  mockFetch.mockResolvedValueOnce(jsonResponse(200, createdDiff));

  const app = createTestApp();
  const body = {
    projectId,
    architectureId,
    sourceBaselineId,
    targetBaselineId,
  };
  const res = await request(app)
    .post('/api/v1/api-migration-validation/diffs')
    .send(body);

  expect(res.status).toBe(200);
  expect(res.body).toEqual(createdDiff);

  expect(mockFetch).toHaveBeenCalledTimes(1);
  const [calledUrl, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit];
  const u = new URL(calledUrl);
  expect(`${u.origin}${u.pathname}`).toBe(
    'http://localhost:8092/api-migration-validation/api/diffs',
  );
  expect(calledInit.method).toBe('POST');
  expect(calledInit.headers).toEqual({
    'Content-Type': 'application/json',
    Accept: 'application/json',
  });
  // Body forwarded verbatim -- no massaging.
  expect(JSON.parse(calledInit.body as string)).toEqual(body);
});

// ---------------------------------------------------------------------------
// Test 2: GET /diffs/:id/status forwards verbatim and tolerates an upstream
// 404. The polling client distinguishes "diff missing" from "service down";
// the gateway is a thin pass-through -- it does NOT remap 404 to 200 or 503.
// ---------------------------------------------------------------------------
test('GET /diffs/:id/status forwards verbatim and pipes upstream 404 through', async () => {
  const diffId = 'diff-missing';
  const upstreamErrorBody = {
    error: { code: 404, message: `Diff ${diffId} not found` },
  };
  mockFetch.mockResolvedValueOnce(jsonResponse(404, upstreamErrorBody));

  const app = createTestApp();
  const res = await request(app).get(
    `/api/v1/api-migration-validation/diffs/${diffId}/status`,
  );

  expect(res.status).toBe(404);
  expect(res.body).toEqual(upstreamErrorBody);

  expect(mockFetch).toHaveBeenCalledTimes(1);
  const [calledUrl, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit];
  const u = new URL(calledUrl);
  expect(`${u.origin}${u.pathname}`).toBe(
    `http://localhost:8092/api-migration-validation/api/diffs/${diffId}/status`,
  );
  expect(calledInit.method).toBe('GET');
});

// ---------------------------------------------------------------------------
// Test 3: AMS-direct by-target proxy forwards verbatim to AMS.
//
// The gateway route is `/api/v1/projects/:projectId/api-behaviour/
// diffs/by-target/:targetBaselineId`. Forward shape mirrors AMS:
//   GET /api/projects/{projectId}/api-behaviour/diffs/by-target/{targetBaselineId}
//
// Path params travel verbatim. This is the UI primary lookup -- the Drift
// report tab calls it to discover whether a diff exists for the target
// baseline; 404 surfaces as `null` on the frontend (no diff yet).
// ---------------------------------------------------------------------------
test('GET /projects/:projectId/api-behaviour/diffs/by-target/:targetBaselineId forwards to AMS verbatim', async () => {
  const projectId = 'proj-diff-1';
  const targetBaselineId = 'base-tgt-1';

  const diffDto = {
    id: 'diff-9',
    project_id: projectId,
    architecture_id: 'arch-diff-1',
    source_baseline_id: 'base-src-1',
    target_baseline_id: targetBaselineId,
    status: 'completed',
    matched_count: 3,
    status_drift_count: 1,
    body_shape_drift_count: 1,
    body_value_drift_count: 0,
    source_only_count: 0,
    target_only_count: 0,
    computed_at: '2026-05-25T10:30:00Z',
    error_message: null,
    created_at: '2026-05-25T10:29:00Z',
    updated_at: '2026-05-25T10:30:00Z',
  };
  mockFetch.mockResolvedValueOnce(jsonResponse(200, diffDto));

  const app = createTestApp();
  const res = await request(app).get(
    `/api/v1/projects/${projectId}/api-behaviour/diffs/by-target/${targetBaselineId}`,
  );

  expect(res.status).toBe(200);
  expect(res.body).toEqual(diffDto);

  expect(mockFetch).toHaveBeenCalledTimes(1);
  const [calledUrl, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit];
  const u = new URL(calledUrl);
  expect(`${u.origin}${u.pathname}`).toBe(
    `http://localhost:8080/api/projects/${projectId}/api-behaviour/diffs/by-target/${targetBaselineId}`,
  );
  expect(calledInit.method).toBe('GET');
});
