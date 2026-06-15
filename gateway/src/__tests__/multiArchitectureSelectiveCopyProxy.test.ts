/**
 * Multi-Architecture Selective Cross-Architecture Copy (Spec #7) -- Gateway
 * proxy tests (Task 5.1).
 *
 * Spec: 2026-05-01 Multi-Architecture Selective Cross-Architecture Copy.
 *
 * Test inventory (5 tests, focused on the spec-required round-trip properties):
 *   1. GET .../elements-inventory happy path: gateway URL is correctly
 *      assembled and the parsed body is returned verbatim.
 *   2. POST .../selective-copy/preflight happy path: URL embeds
 *      `:targetArchitectureId`, JSON body is forwarded byte-for-byte, and the
 *      parsed response is returned verbatim.
 *   3. POST .../selective-copy/commit happy path: URL embeds
 *      `:targetArchitectureId`, JSON body is forwarded byte-for-byte, and the
 *      parsed response is returned verbatim.
 *   4. **Error envelope round-trip**: backend 422 with
 *      `{code: "archived_source", message: ...}` arrives at the caller with
 *      status 422 and identical body (frontend wizard depends on `code` to
 *      surface the footer banner).
 *   5. **Error envelope round-trip**: backend 422 with
 *      `{code: "same_architecture", message: ...}` arrives at the caller with
 *      status 422 and identical body (defence-in-depth -- the per-row Copy
 *      from button is also disabled on self).
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
    (req as any).requestId = 'selective-copy-proxy-test';
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
    statusText: status === 200 ? 'OK' : status === 201 ? 'Created' : 'Error',
    headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? 'application/json' : null) },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

beforeEach(() => {
  mockFetch.mockReset();
});

// ---------------------------------------------------------------------------
// Test 1: GET /api/projects/:projectId/architectures/:architectureId/elements-inventory
// happy path. Gateway URL is correctly assembled and the parsed inventory
// body is forwarded verbatim.
// ---------------------------------------------------------------------------
test('GET .../elements-inventory proxies to upstream and returns 200 body verbatim', async () => {
  const inventory = {
    domains: [
      { name: 'Applications', types: [{ name: 'services', instances: [{ id: 'svc-1', name: 'Order Service' }] }] },
      { name: 'Data', types: [] },
      { name: 'Business', types: [] },
      { name: 'UI', types: [] },
      { name: 'Behavioural', types: [] },
      { name: 'Diagrams', types: [] },
    ],
  };
  mockFetch.mockResolvedValueOnce(jsonResponse(200, inventory));

  const app = createTestApp();
  const res = await request(app).get(
    '/api/projects/proj-inv-1/architectures/arch-inv-1/elements-inventory'
  );

  expect(res.status).toBe(200);
  expect(res.body).toEqual(inventory);

  expect(mockFetch).toHaveBeenCalledTimes(1);
  const [calledUrl, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit];
  expect(calledUrl).toBe(
    'http://localhost:8080/api/projects/proj-inv-1/architectures/arch-inv-1/elements-inventory'
  );
  expect(calledInit.method).toBe('GET');
});

// ---------------------------------------------------------------------------
// Test 2: POST .../selective-copy/preflight happy path. The
// :targetArchitectureId path segment is correctly embedded in the upstream
// URL, the request body is forwarded byte-for-byte, and the parsed response
// is returned verbatim.
// ---------------------------------------------------------------------------
test('POST .../selective-copy/preflight proxies to upstream and returns 200 body verbatim', async () => {
  const preflightResponse = {
    conflicts: [
      {
        elementId: 'svc-1',
        elementType: 'services',
        name: 'Order Service',
        conflictReason: 'same_uuid',
      },
    ],
    autoIncluded: [
      {
        elementId: 'data-1',
        elementType: 'physicalDataEntities',
        name: 'OrderRecord',
        includedBecause: 'Order Service',
      },
    ],
    summary: {
      totalSelected: 1,
      conflictCount: 1,
      autoIncludedCount: 1,
      willCopyCount: 2,
    },
  };
  mockFetch.mockResolvedValueOnce(jsonResponse(200, preflightResponse));

  const app = createTestApp();
  const payload = {
    sourceArchitectureId: 'arch-source-1',
    elementIds: ['svc-1'],
  };
  const res = await request(app)
    .post('/api/projects/proj-pf-1/architectures/arch-target-1/selective-copy/preflight')
    .send(payload);

  expect(res.status).toBe(200);
  expect(res.body).toEqual(preflightResponse);

  expect(mockFetch).toHaveBeenCalledTimes(1);
  const [calledUrl, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit];
  expect(calledUrl).toBe(
    'http://localhost:8080/api/projects/proj-pf-1/architectures/arch-target-1/selective-copy/preflight'
  );
  expect(calledInit.method).toBe('POST');
  expect(JSON.parse(calledInit.body as string)).toEqual(payload);
});

// ---------------------------------------------------------------------------
// Test 3: POST .../selective-copy/commit happy path. The :targetArchitectureId
// path segment is correctly embedded, the request body (including the
// resolutions array) is forwarded byte-for-byte, and the parsed response is
// returned verbatim.
// ---------------------------------------------------------------------------
test('POST .../selective-copy/commit proxies to upstream and returns 200 body verbatim', async () => {
  const commitResponse = {
    copied: 3,
    skipped: 1,
    overwritten: 1,
    duplicated: 1,
    autoIncluded: 1,
  };
  mockFetch.mockResolvedValueOnce(jsonResponse(200, commitResponse));

  const app = createTestApp();
  const payload = {
    sourceArchitectureId: 'arch-source-2',
    elementIds: ['svc-1', 'svc-2', 'data-1'],
    resolutions: [
      { elementId: 'svc-1', action: 'skip' },
      { elementId: 'svc-2', action: 'overwrite' },
      { elementId: 'data-1', action: 'duplicate' },
    ],
  };
  const res = await request(app)
    .post('/api/projects/proj-cm-1/architectures/arch-target-2/selective-copy/commit')
    .send(payload);

  expect(res.status).toBe(200);
  expect(res.body).toEqual(commitResponse);

  expect(mockFetch).toHaveBeenCalledTimes(1);
  const [calledUrl, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit];
  expect(calledUrl).toBe(
    'http://localhost:8080/api/projects/proj-cm-1/architectures/arch-target-2/selective-copy/commit'
  );
  expect(calledInit.method).toBe('POST');
  expect(JSON.parse(calledInit.body as string)).toEqual(payload);
});

// ---------------------------------------------------------------------------
// Test 4: 422 archived_source envelope round-trips byte-for-byte.
//
// The frontend wizard reads `body.code === "archived_source"` to surface the
// footer banner. ANY transformation by the gateway would break this. This
// test asserts the round-trip on the preflight route; the same envelope
// passes through unchanged on the commit route by symmetry (both use the
// same emitUpstreamError helper).
// ---------------------------------------------------------------------------
test('422 archived_source response round-trips with status + body unchanged (preflight)', async () => {
  const errBody = {
    timestamp: '2026-05-01T00:00:00Z',
    status: 422,
    error: 'Unprocessable Entity',
    code: 'archived_source',
    message: 'Cannot selectively copy from an archived architecture.',
  };
  mockFetch.mockResolvedValueOnce(jsonResponse(422, errBody));

  const app = createTestApp();
  const res = await request(app)
    .post('/api/projects/proj-arc/architectures/arch-target-3/selective-copy/preflight')
    .send({ sourceArchitectureId: 'arch-archived', elementIds: ['svc-1'] });

  expect(res.status).toBe(422);
  expect(res.body).toEqual(errBody);
});

// ---------------------------------------------------------------------------
// Test 5: 422 same_architecture envelope round-trips byte-for-byte.
//
// The frontend wizard reads `body.code === "same_architecture"` to surface
// the defence-in-depth footer banner (the per-row Copy from button is also
// disabled when row.id === activeArchitectureId, but the backend refuses
// independently). This test asserts the round-trip on the commit route;
// the preflight route round-trips identically by symmetry.
// ---------------------------------------------------------------------------
test('422 same_architecture response round-trips with status + body unchanged (commit)', async () => {
  const errBody = {
    timestamp: '2026-05-01T00:00:00Z',
    status: 422,
    error: 'Unprocessable Entity',
    code: 'same_architecture',
    message: 'Cannot selectively copy into the same architecture',
  };
  mockFetch.mockResolvedValueOnce(jsonResponse(422, errBody));

  const app = createTestApp();
  const res = await request(app)
    .post('/api/projects/proj-self/architectures/arch-self-1/selective-copy/commit')
    .send({
      sourceArchitectureId: 'arch-self-1',
      elementIds: ['svc-1'],
      resolutions: [],
    });

  expect(res.status).toBe(422);
  expect(res.body).toEqual(errBody);
});
