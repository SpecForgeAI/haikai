/**
 * Multi-Architecture CRUD UI + Tag Management -- Gateway proxy tests (Task 2.1).
 *
 * Spec: 2026-05-02 Multi-Architecture CRUD UI + Tag Management.
 *
 * Test inventory (5 tests, focused on the spec-required round-trip properties):
 *   1. POST /api/projects/:projectId/architectures -- happy path proxies the
 *      JSON body to the upstream POST endpoint and returns the 201 + created
 *      Architecture body verbatim.
 *   2. PATCH /api/projects/:projectId/architectures/:architectureId -- the full
 *      `{name, description, tags}` payload is forwarded unchanged on the wire,
 *      including the empty-tags-clears-all case.
 *   3. POST /api/projects/:projectId/architectures/:architectureId/archive --
 *      happy path returns 200 + the updated Architecture body verbatim.
 *   4. **Error envelope round-trip (safety property a)**: backend 409 with
 *      `{code: "duplicate_name", field: "name", message: ...}` arrives at the
 *      caller with status 409 and identical body (frontend depends on this
 *      shape to render inline 409s next to the Name field).
 *   5. **Error envelope round-trip (safety property b)**: backend 422 with
 *      `{code: "last_architecture", message: ...}` arrives at the caller with
 *      status 422 and identical body (frontend disables the Archive button on
 *      the only-remaining row).
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
    (req as any).requestId = 'crud-proxy-test';
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
// Test 1: POST happy path -- 201 + created body returned verbatim, body
// forwarded to upstream verbatim.
// ---------------------------------------------------------------------------
test('POST /api/projects/:projectId/architectures proxies POST and returns 201 body verbatim', async () => {
  const created = {
    id: 'arch-new-1',
    projectId: 'proj-create',
    name: 'Target State',
    description: 'desired future architecture',
    tags: ['target-state'],
    archived: false,
    createdAt: '2026-05-02T00:00:00Z',
    updatedAt: '2026-05-02T00:00:00Z',
  };
  mockFetch.mockResolvedValueOnce(jsonResponse(201, created));

  const app = createTestApp();
  const payload = { name: 'Target State', description: 'desired future architecture', tags: ['target-state'] };
  const res = await request(app).post('/api/projects/proj-create/architectures').send(payload);

  expect(res.status).toBe(201);
  expect(res.body).toEqual(created);

  // Upstream call: correct URL + method + JSON body forwarded byte-for-byte.
  expect(mockFetch).toHaveBeenCalledTimes(1);
  const [calledUrl, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit];
  expect(calledUrl).toBe('http://localhost:8080/api/projects/proj-create/architectures');
  expect(calledInit.method).toBe('POST');
  expect(JSON.parse(calledInit.body as string)).toEqual(payload);
});

// ---------------------------------------------------------------------------
// Test 2: PATCH happy path -- full {name, description, tags} payload forwarded
// unchanged, including empty tags array which signals "clear all tags".
// ---------------------------------------------------------------------------
test('PATCH /api/projects/:projectId/architectures/:architectureId forwards full payload unchanged', async () => {
  const updated = {
    id: 'arch-edit-1',
    projectId: 'proj-edit',
    name: 'Renamed',
    description: 'updated desc',
    tags: [],
    archived: false,
    createdAt: '2026-04-01T00:00:00Z',
    updatedAt: '2026-05-02T01:00:00Z',
  };
  mockFetch.mockResolvedValueOnce(jsonResponse(200, updated));

  const app = createTestApp();
  // Empty tags array -- explicit "clear all" semantics from the spec.
  const payload = { name: 'Renamed', description: 'updated desc', tags: [] };
  const res = await request(app)
    .patch('/api/projects/proj-edit/architectures/arch-edit-1')
    .send(payload);

  expect(res.status).toBe(200);
  expect(res.body).toEqual(updated);

  expect(mockFetch).toHaveBeenCalledTimes(1);
  const [calledUrl, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit];
  expect(calledUrl).toBe('http://localhost:8080/api/projects/proj-edit/architectures/arch-edit-1');
  expect(calledInit.method).toBe('PATCH');
  // Payload forwarded byte-for-byte; the empty tags array survives the round-trip.
  expect(JSON.parse(calledInit.body as string)).toEqual(payload);
});

// ---------------------------------------------------------------------------
// Test 3: POST /archive happy path -- 200 + updated body returned verbatim.
// ---------------------------------------------------------------------------
test('POST /api/projects/:projectId/architectures/:architectureId/archive returns 200 body verbatim', async () => {
  const archived = {
    id: 'arch-arc-1',
    projectId: 'proj-arch',
    name: 'Old',
    description: null,
    tags: [],
    archived: true,
    createdAt: '2026-03-01T00:00:00Z',
    updatedAt: '2026-05-02T02:00:00Z',
  };
  mockFetch.mockResolvedValueOnce(jsonResponse(200, archived));

  const app = createTestApp();
  const res = await request(app).post('/api/projects/proj-arch/architectures/arch-arc-1/archive');

  expect(res.status).toBe(200);
  expect(res.body).toEqual(archived);

  expect(mockFetch).toHaveBeenCalledTimes(1);
  const [calledUrl, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit];
  expect(calledUrl).toBe(
    'http://localhost:8080/api/projects/proj-arch/architectures/arch-arc-1/archive'
  );
  expect(calledInit.method).toBe('POST');
});

// ---------------------------------------------------------------------------
// Test 4: Safety property (a) -- 409 envelope round-trips byte-for-byte.
//
// The frontend reads `body.code` and `body.field` to decide where to render
// the error inline. ANY transformation by the gateway would break this.
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
    .post('/api/projects/proj-dup/architectures')
    .send({ name: 'Default', description: '', tags: [] });

  expect(res.status).toBe(409);
  // Body is forwarded byte-for-byte (the field names matter to the frontend).
  expect(res.body).toEqual(errBody);
});

// ---------------------------------------------------------------------------
// Test 5: Safety property (b) -- 422 envelope round-trips byte-for-byte.
//
// The frontend reads `body.code === "last_architecture"` to surface a server
// race (the only-remaining-row Archive button is also disabled client-side as
// defence in depth).
// ---------------------------------------------------------------------------
test('422 last_architecture response round-trips with status + body unchanged', async () => {
  const errBody = {
    code: 'last_architecture',
    message: 'A project must have at least one architecture.',
  };
  mockFetch.mockResolvedValueOnce(jsonResponse(422, errBody));

  const app = createTestApp();
  const res = await request(app).post('/api/projects/proj-last/architectures/arch-only/archive');

  expect(res.status).toBe(422);
  expect(res.body).toEqual(errBody);
});
