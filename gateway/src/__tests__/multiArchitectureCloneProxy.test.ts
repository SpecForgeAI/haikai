/**
 * Multi-Architecture Full Clone (Spec #6) -- Gateway proxy tests (Task 4.1).
 *
 * Spec: 2026-05-01 Multi-Architecture Full Clone.
 *
 * Test inventory (5 tests, focused on the spec-required round-trip properties):
 *   1. POST /api/projects/:projectId/architectures/:sourceArchitectureId/clone
 *      -- happy path: gateway URL embedding `:sourceArchitectureId` correctly
 *      forwards to the upstream clone endpoint and returns 201 + the new
 *      Architecture DTO verbatim.
 *   2. **Error envelope round-trip**: backend 422 with
 *      `{code: "archived_source", message: ...}` arrives at the caller with
 *      status 422 and identical body (frontend depends on `code` to show the
 *      footer banner).
 *   3. **Error envelope round-trip**: backend 409 with
 *      `{code: "duplicate_name", field: "name", message: ...}` arrives at the
 *      caller with status 409 and identical body (frontend uses `field` to
 *      render inline next to the Name input).
 *   4. **Error envelope round-trip**: backend 404 (source architecture not
 *      found) arrives at the caller with status 404 and identical body --
 *      404 envelopes have no `code` field per Spec #3's GlobalExceptionHandler
 *      contract.
 *   5. **Bucket B regression check (project-scoped routes unchanged)**: the
 *      pre-existing `GET /api/projects/:projectId/architectures` list route
 *      continues to forward verbatim and is not shadowed by the new clone
 *      route. (Express path matching: the new route only matches POST with the
 *      `:sourceArchitectureId/clone` suffix and must not interfere with the
 *      list GET.)
 */

// ---- Mock the gateway config so the tests don't depend on env vars ----
jest.mock('../config', () => ({
  getConfig: () => ({
    architectureModelServiceBaseUrl: 'http://localhost:8080',
  }),
}));

// ---- Mock global fetch for client-function calls (called from inside the routes) ----
const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

import express from 'express';
import request from 'supertest';
import { architecturesRouter } from '../routes/architectures';

function createTestApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use((req, _res, next) => {
    (req as any).requestId = 'clone-proxy-test';
    next();
  });
  app.use('/api', architecturesRouter);
  return app;
}

/**
 * Build a fetch-like Response stub with the given status, JSON body, and
 * Content-Type header. Mirrors the shape that `architectureModelClient` reads
 * (response.ok, response.status, response.headers.get('content-type'),
 * response.json(), response.text()).
 */
function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 201 ? 'Created' : 'OK',
    headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? 'application/json' : null) },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

beforeEach(() => {
  mockFetch.mockReset();
});

// ---------------------------------------------------------------------------
// Test 1: Happy path -- gateway proxy URL with `:sourceArchitectureId` is
// correctly assembled and forwarded; 201 + DTO returned verbatim.
// ---------------------------------------------------------------------------
test('POST /api/projects/:projectId/architectures/:sourceArchitectureId/clone proxies to upstream and returns 201 body verbatim', async () => {
  const cloned = {
    id: 'arch-clone-new-1',
    projectId: 'proj-clone-1',
    name: 'Copy of Default',
    description: 'cloned baseline',
    tags: [],
    archived: false,
    createdAt: '2026-05-01T00:00:00Z',
    updatedAt: '2026-05-01T00:00:00Z',
  };
  mockFetch.mockResolvedValueOnce(jsonResponse(201, cloned));

  const app = createTestApp();
  const payload = { name: 'Copy of Default', description: 'cloned baseline', tags: [] };
  const res = await request(app)
    .post('/api/projects/proj-clone-1/architectures/arch-source-1/clone')
    .send(payload);

  expect(res.status).toBe(201);
  expect(res.body).toEqual(cloned);

  // Upstream call: correct URL embedding BOTH projectId and sourceArchitectureId
  // path segments + method + JSON body forwarded byte-for-byte.
  expect(mockFetch).toHaveBeenCalledTimes(1);
  const [calledUrl, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit];
  expect(calledUrl).toBe(
    'http://localhost:8080/api/projects/proj-clone-1/architectures/arch-source-1/clone'
  );
  expect(calledInit.method).toBe('POST');
  expect(JSON.parse(calledInit.body as string)).toEqual(payload);
});

// ---------------------------------------------------------------------------
// Test 2: 422 archived_source envelope round-trips byte-for-byte.
//
// The frontend reads `body.code === "archived_source"` to surface the footer
// banner. ANY transformation by the gateway would break this.
// ---------------------------------------------------------------------------
test('422 archived_source response round-trips with status + body unchanged', async () => {
  const errBody = {
    code: 'archived_source',
    message: 'Cannot clone an archived architecture.',
  };
  mockFetch.mockResolvedValueOnce(jsonResponse(422, errBody));

  const app = createTestApp();
  const res = await request(app)
    .post('/api/projects/proj-arc/architectures/arch-archived/clone')
    .send({ name: 'Copy of Old', description: '', tags: [] });

  expect(res.status).toBe(422);
  expect(res.body).toEqual(errBody);
});

// ---------------------------------------------------------------------------
// Test 3: 409 duplicate_name envelope round-trips byte-for-byte.
//
// The frontend reads `body.code` and `body.field` to decide where to render
// the error inline (under the Name field).
// ---------------------------------------------------------------------------
test('409 duplicate_name response round-trips with status + body unchanged', async () => {
  const errBody = {
    code: 'duplicate_name',
    field: 'name',
    message: "An architecture named 'Default' already exists in this project.",
  };
  mockFetch.mockResolvedValueOnce(jsonResponse(409, errBody));

  const app = createTestApp();
  const res = await request(app)
    .post('/api/projects/proj-dup/architectures/arch-source-x/clone')
    .send({ name: 'Default', description: '', tags: [] });

  expect(res.status).toBe(409);
  // Body is forwarded byte-for-byte (the field name matters to the frontend).
  expect(res.body).toEqual(errBody);
});

// ---------------------------------------------------------------------------
// Test 4: 404 envelope round-trips byte-for-byte (no `code` field per the
// backend GlobalExceptionHandler -- standard envelope only).
// ---------------------------------------------------------------------------
test('404 missing-source response round-trips with status + body unchanged', async () => {
  const errBody = {
    timestamp: '2026-05-01T00:00:00Z',
    status: 404,
    error: 'Not Found',
    message: 'Architecture not found.',
    path: '/api/projects/proj-x/architectures/arch-missing/clone',
  };
  mockFetch.mockResolvedValueOnce(jsonResponse(404, errBody));

  const app = createTestApp();
  const res = await request(app)
    .post('/api/projects/proj-x/architectures/arch-missing/clone')
    .send({ name: 'Copy of X' });

  expect(res.status).toBe(404);
  expect(res.body).toEqual(errBody);
});

// ---------------------------------------------------------------------------
// Test 5: Bucket B (project-scoped) routes regression check.
//
// The pre-existing `GET /api/projects/:projectId/architectures` list route
// must continue to function unchanged after introducing the new POST clone
// route. Express path matching is greedy on prefix order; this test confirms
// the list route is not shadowed and forwards to the upstream list endpoint
// without the `/clone` suffix.
// ---------------------------------------------------------------------------
test('Bucket B regression: GET /api/projects/:projectId/architectures still proxies the list endpoint unchanged', async () => {
  const listBody = [
    {
      id: 'arch-1',
      projectId: 'proj-list',
      name: 'Default',
      description: null,
      tags: [],
      archived: false,
      createdAt: '2026-04-01T00:00:00Z',
      updatedAt: '2026-04-01T00:00:00Z',
    },
  ];
  mockFetch.mockResolvedValueOnce(jsonResponse(200, listBody));

  const app = createTestApp();
  const res = await request(app).get('/api/projects/proj-list/architectures');

  expect(res.status).toBe(200);
  expect(res.body).toEqual(listBody);

  expect(mockFetch).toHaveBeenCalledTimes(1);
  const [calledUrl, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit];
  // No `/clone` suffix and no `:sourceArchitectureId` segment -- the list
  // route is unaffected by the new clone route.
  expect(calledUrl).toBe('http://localhost:8080/api/projects/proj-list/architectures');
  expect(calledInit.method).toBe('GET');
});
