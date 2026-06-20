/**
 * API Migration Validation -- Batch Proxy Tests
 *
 * Spec: 2026-06-20 Baseline Save & Review -- Batch + Activate + Export
 * Task Group 2 sub-task 2.1.
 *
 * The two best-effort batch endpoints (AMS Task Group 1) are proxied through
 * the gateway via the existing `proxyToAms` / `buildAmsUrl` helpers with the
 * literal `batch` segment in place of an id. They MUST be registered before
 * the generic `registerCrudProxy` loop so that:
 *
 *   - `POST .../captures/batch` is NOT swallowed by `PATCH .../captures/:id`
 *     (the dangerous case -- `batch` would otherwise be captured as `:id`),
 *   - `POST .../baseline-items/batch` reaches AMS at `.../baseline-items/batch`
 *     rather than 404-ing against the bare collection POST.
 *
 * Test inventory (3 proxy tests, mirroring `apiMigrationValidation-diff-proxy`):
 *
 *   1. POST .../baseline-items/batch forwards the `{ items }` body verbatim to
 *      AMS at `/api/projects/{pid}/api-behaviour/baseline-items/batch` and
 *      pipes the upstream `{ created, failed }` body back unchanged.
 *
 *   2. PATCH .../captures/batch forwards the `{ items: [{id,patch}] }` body
 *      verbatim to AMS at `/api/projects/{pid}/api-behaviour/captures/batch`
 *      and pipes the upstream `{ updated, failed }` body back -- proving the
 *      literal `batch` segment is NOT captured as `:id` by the generic loop.
 *
 *   3. URL safety: omitting `:architectureId` from the gateway batch URL must
 *      404 at the Express layer (no fallback resolution -- same property the
 *      CRUD proxies enforce), and the upstream is never contacted.
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
    (req as any).requestId = 'api-migration-validation-batch-test';
    next();
  });
  app.use('/api/v1', apiMigrationValidationRouter);
  return app;
}

beforeEach(() => {
  mockFetch.mockReset();
});

// ---------------------------------------------------------------------------
// Test 1: POST .../baseline-items/batch forwards `{ items }` verbatim to AMS.
//
// AMS publishes this route at:
//   POST /api/projects/{projectId}/api-behaviour/baseline-items/batch
// (project-scoped; architectureId is injected onto the query string by the
// shared proxy helper exactly as the CRUD proxies do, and AMS ignores it on
// this id-style route). The gateway is a thin pass-through; the upstream
// `{ created, failed }` envelope comes back unchanged.
// ---------------------------------------------------------------------------
test('POST .../baseline-items/batch forwards items verbatim to AMS and pipes {created,failed} through', async () => {
  const projectId = 'proj-batch-1';
  const architectureId = 'arch-batch-1';

  const items = [
    { capture_id: 'cap-1', method: 'GET', path: '/widgets', response_status: 200 },
    { capture_id: 'cap-2', method: 'POST', path: '/widgets', response_status: 201 },
  ];
  const upstreamBody = {
    created: [
      { id: 'item-1', capture_id: 'cap-1' },
      { id: 'item-2', capture_id: 'cap-2' },
    ],
    failed: [],
  };
  mockFetch.mockResolvedValueOnce(jsonResponse(200, upstreamBody));

  const app = createTestApp();
  const res = await request(app)
    .post(
      `/api/v1/projects/${projectId}/architectures/${architectureId}/api-behaviour/baseline-items/batch`,
    )
    .send({ items });

  expect(res.status).toBe(200);
  expect(res.body).toEqual(upstreamBody);

  expect(mockFetch).toHaveBeenCalledTimes(1);
  const [calledUrl, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit];
  const u = new URL(calledUrl);
  // The literal `batch` segment reaches AMS at the batch path (NOT 404 against
  // the bare collection POST, NOT captured as an id).
  expect(`${u.origin}${u.pathname}`).toBe(
    `http://localhost:8080/api/projects/${projectId}/api-behaviour/baseline-items/batch`,
  );
  // architectureId is injected onto the query (URL safety segment preserved).
  expect(u.searchParams.get('architectureId')).toBe(architectureId);
  expect(calledInit.method).toBe('POST');
  // Body forwarded verbatim -- no massaging.
  expect(JSON.parse(calledInit.body as string)).toEqual({ items });
});

// ---------------------------------------------------------------------------
// Test 2: PATCH .../captures/batch forwards `{ items: [{id,patch}] }` verbatim.
//
// This is the route ordering hazard: PATCH `.../captures/:id` from the generic
// CRUD loop would otherwise capture `batch` as `:id`. Registering the batch
// route BEFORE the loop means the request lands on the batch path at AMS:
//   PATCH /api/projects/{projectId}/api-behaviour/captures/batch
// The upstream `{ updated, failed }` envelope is piped back unchanged.
// ---------------------------------------------------------------------------
test('PATCH .../captures/batch forwards items verbatim to AMS (not captured as :id) and pipes {updated,failed} through', async () => {
  const projectId = 'proj-batch-1';
  const architectureId = 'arch-batch-1';

  const items = [
    { id: 'cap-1', patch: { accepted: true, accepted_at: '2026-06-20T10:00:00Z' } },
    {
      id: 'cap-2',
      patch: { accepted: false, accepted_at: null, reviewer_notes: 'rejected' },
    },
  ];
  const upstreamBody = {
    updated: [{ id: 'cap-1', accepted: true }],
    failed: [{ id: 'cap-2', reason: 'not found' }],
  };
  mockFetch.mockResolvedValueOnce(jsonResponse(200, upstreamBody));

  const app = createTestApp();
  const res = await request(app)
    .patch(
      `/api/v1/projects/${projectId}/architectures/${architectureId}/api-behaviour/captures/batch`,
    )
    .send({ items });

  expect(res.status).toBe(200);
  expect(res.body).toEqual(upstreamBody);

  expect(mockFetch).toHaveBeenCalledTimes(1);
  const [calledUrl, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit];
  const u = new URL(calledUrl);
  // The path ends in the literal `batch` -- proof the batch route won over the
  // generic `captures/:id` PATCH (which would have produced `.../captures/batch`
  // as an id-scoped single PATCH, never carrying the `{ items }` envelope).
  expect(`${u.origin}${u.pathname}`).toBe(
    `http://localhost:8080/api/projects/${projectId}/api-behaviour/captures/batch`,
  );
  expect(u.searchParams.get('architectureId')).toBe(architectureId);
  expect(calledInit.method).toBe('PATCH');
  expect(JSON.parse(calledInit.body as string)).toEqual({ items });
});

// ---------------------------------------------------------------------------
// Test 3: URL safety -- forgetting :architectureId on a batch route 404s at
// the Express layer (no fallback resolution), and the upstream is never hit.
// Same guarantee the CRUD proxies provide for every api-behaviour write.
// ---------------------------------------------------------------------------
test('batch proxy 404s when :architectureId is missing from the URL', async () => {
  const app = createTestApp();

  const res = await request(app)
    .post('/api/v1/projects/proj-batch-1/api-behaviour/baseline-items/batch')
    .send({ items: [] });

  expect(res.status).toBe(404);
  expect(mockFetch).not.toHaveBeenCalled();
});
