/**
 * Discovery Architecture-Scoped Proxy Routes -- Gateway tests (Spec #4 Task 3.1).
 *
 * Spec: 2026-05-01 Multi-Architecture Discovery Integration -- Task Group 3.
 *
 * Test inventory (3 tests, focused on the task-specified properties):
 *   1. **Happy path**: a frontend call to the architecture-scoped Discovery
 *      list-runs proxy is forwarded to the architecture-model-service with
 *      `:architectureId` preserved in the downstream URL.
 *   2. **Gateway 404 safety**: hitting a Discovery proxy WITHOUT
 *      `:architectureId` in the URL returns 404 (Express route mismatch) --
 *      this mirrors the backend's path-segment safety property (b) and is
 *      the gateway-layer enforcement of the same rule.
 *   3. **Backend 404 propagation**: when the architecture-model-service
 *      returns 404 (e.g. the run exists but in a different architecture),
 *      the gateway proxies the 404 byte-for-byte to the caller.
 *
 * (The Bucket B 404 safety check from `multiArchitecturePlumbing.test.ts`
 * already covers the unchanged-routes-stay-unchanged property at the
 * Bucket A boundary; no Bucket B routes exist in `discovery.ts` so we do
 * not duplicate that test here.)
 */

// ---- Mock the gateway config so the tests don't depend on env vars ----
jest.mock('../config', () => ({
  getConfig: () => ({
    architectureModelServiceBaseUrl: 'http://localhost:8080',
    discoveryServiceBaseUrl: 'http://localhost:9090',
    mcpBaseUrl: 'http://localhost:7070',
  }),
  resetConfig: jest.fn(),
}));

// ---- Mock logger to keep test output clean ----
jest.mock('../services/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// ---- Mock global fetch ----
const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

import express from 'express';
import request from 'supertest';
import { discoveryRouter } from '../routes/discovery';

function createTestApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use((req, _res, next) => {
    (req as any).requestId = 'discovery-arch-proxy-test';
    next();
  });
  app.use('/api/v1/discovery', discoveryRouter);
  return app;
}

beforeEach(() => {
  mockFetch.mockReset();
});

const projectId = 'proj-aaa';
const architectureId = 'arch-bbb';
const runId = 'run-ccc';

// ---------------------------------------------------------------------------
// Test 1: Happy path -- gateway proxy URL with :architectureId forwards
// to the architecture-model-service with :architectureId preserved between
// /projects/{projectId}/ and /discovery/...
// ---------------------------------------------------------------------------
test('GET /projects/:projectId/architectures/:architectureId/runs forwards :architectureId in the downstream URL', async () => {
  const sampleRunsList = [
    {
      id: runId,
      project_id: projectId,
      architecture_id: architectureId,
      status: 'COMPLETED',
    },
  ];
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => sampleRunsList,
  });

  const app = createTestApp();
  const res = await request(app).get(
    `/api/v1/discovery/projects/${projectId}/architectures/${architectureId}/runs`
  );

  expect(res.status).toBe(200);
  expect(res.body).toEqual(sampleRunsList);

  expect(mockFetch).toHaveBeenCalledTimes(1);
  const [calledUrl, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit];
  expect(calledUrl).toBe(
    `http://localhost:8080/api/model/projects/${projectId}/architectures/${architectureId}/discovery/runs`
  );
  // The :architectureId path segment must sit between /projects/{projectId}/
  // and /discovery/... -- this is the spec-required URL shape.
  expect(calledUrl).toContain(`/projects/${projectId}/architectures/${architectureId}/discovery/`);
  expect(calledInit.method).toBe('GET');
});

// ---------------------------------------------------------------------------
// Test 2: Path-segment 404 safety -- gateway mirrors the backend's
// safety property (b). Hitting a Discovery proxy without :architectureId
// in the URL must return 404 from Express (no fallback / no silent
// default-resolution). The request never leaves the gateway.
// ---------------------------------------------------------------------------
test('Discovery proxy 404s when :architectureId is missing from the URL', async () => {
  const app = createTestApp();

  // Hit the Discovery list-runs proxy WITHOUT the :architectureId path
  // segment. The router has no matching route, so Express returns 404.
  // If a silent fallback existed (e.g. the old project-only route), this
  // test would fail.
  const res = await request(app).get(`/api/v1/discovery/projects/${projectId}/runs`);

  expect(res.status).toBe(404);
  // No upstream HTTP call should have been made -- the request never left the gateway.
  expect(mockFetch).not.toHaveBeenCalled();
});

// ---------------------------------------------------------------------------
// Test 3: Backend 404 propagation -- when the architecture-model-service
// returns 404 (e.g. the run exists but lives in a different architecture),
// the gateway forwards the 404 + body byte-for-byte. This is the
// gateway-side mirror of the backend's wrong-architecture-404 property.
// ---------------------------------------------------------------------------
test('Backend 404 (wrong architecture) propagates byte-for-byte to the caller', async () => {
  const backendErrorBody = {
    error: 'Run not found in architecture',
    runId,
    architectureId: 'arch-other',
  };
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status: 404,
    json: async () => backendErrorBody,
  });

  const app = createTestApp();
  const res = await request(app).get(
    `/api/v1/discovery/projects/${projectId}/architectures/arch-other/runs/${runId}`
  );

  expect(res.status).toBe(404);
  expect(res.body).toEqual(backendErrorBody);

  // Confirm the gateway did call the backend with the architecture-scoped URL.
  expect(mockFetch).toHaveBeenCalledTimes(1);
  const [calledUrl] = mockFetch.mock.calls[0] as [string, RequestInit];
  expect(calledUrl).toBe(
    `http://localhost:8080/api/model/projects/${projectId}/architectures/arch-other/discovery/runs/${runId}`
  );
});
