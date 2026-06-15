/**
 * Architecture Element Mappings -- Gateway proxy tests (Task 4.1).
 *
 * Spec: 2026-05-15 Create Target Baseline from Current State -- Task Group 4.
 *
 * Test inventory (5 tests, focused on the spec-required round-trip properties):
 *   1. GET /api/projects/:projectId/architecture-mappings forwards every
 *      supported query parameter to AMS verbatim and returns the parsed body
 *      and status pass-through.
 *   2. POST /api/projects/:projectId/architecture-mappings forwards the body
 *      verbatim and pass-through-returns 422 {code: "duplicate_mapping"} when
 *      AMS returns it (verifies the emitUpstreamError path).
 *   3. PUT /api/projects/:projectId/architecture-mappings/:mappingId forwards
 *      mappingId in the URL and the (mutable-fields-only) body verbatim,
 *      returning the AMS 200 + updated DTO unchanged.
 *   4. DELETE /api/projects/:projectId/architecture-mappings/:mappingId
 *      forwards mappingId in the URL and pass-through-returns AMS 204.
 *   5. The existing selective-copy commit proxy passes the new optional
 *      autoMap request flag and the new createdMappingCount response field
 *      through unchanged (no body shape transformation).
 */

// ---- Mock the gateway config so the tests do not depend on env vars ----
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
    (req as any).requestId = 'architecture-mappings-proxy-test';
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
  const statusText =
    status === 200 ? 'OK' : status === 201 ? 'Created' : status === 204 ? 'No Content' : 'Error';
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers: {
      get: (k: string) => (k.toLowerCase() === 'content-type' ? 'application/json' : null),
    },
    json: async () => body,
    text: async () => (body === null || body === undefined ? '' : JSON.stringify(body)),
  };
}

/**
 * Build a fetch-like Response stub for a 204 No Content response. AMS returns
 * 204 with an empty body and no Content-Type header.
 */
function noContentResponse() {
  return {
    ok: true,
    status: 204,
    statusText: 'No Content',
    headers: {
      get: (_k: string) => null,
    },
    json: async () => null,
    text: async () => '',
  };
}

beforeEach(() => {
  mockFetch.mockReset();
});

// ---------------------------------------------------------------------------
// Test 1: GET .../architecture-mappings forwards every documented query
// parameter to AMS verbatim and returns the upstream 200 + parsed body
// unchanged. The frontend Mapping Review filters depend on this round-trip
// (sourceArchitectureId + targetArchitectureId at minimum, plus the optional
// element-type / mapping-type / status / q narrowing).
// ---------------------------------------------------------------------------
test('GET .../architecture-mappings forwards query params verbatim and returns 200 body verbatim', async () => {
  const mappings = [
    {
      id: 'mapping-1',
      projectId: 'proj-list-1',
      sourceArchitectureId: 'arch-source',
      targetArchitectureId: 'arch-target',
      sourceElementType: 'services',
      sourceElementId: 'svc-1',
      targetElementType: 'services',
      targetElementId: 'svc-1-target',
      mappingType: 'equivalent',
      status: 'confirmed',
      createdByTask: 'selective-copy-with-auto-map',
      createdAt: '2026-05-15T00:00:00Z',
      updatedAt: '2026-05-15T00:00:00Z',
      notes: null,
      confidence: 1.0,
    },
  ];
  mockFetch.mockResolvedValueOnce(jsonResponse(200, mappings));

  const app = createTestApp();
  const res = await request(app)
    .get('/api/projects/proj-list-1/architecture-mappings')
    .query({
      sourceArchitectureId: 'arch-source',
      targetArchitectureId: 'arch-target',
      sourceElementType: 'services',
      targetElementType: 'services',
      mappingType: 'equivalent',
      status: 'confirmed',
      q: 'order',
    });

  expect(res.status).toBe(200);
  expect(res.body).toEqual(mappings);

  expect(mockFetch).toHaveBeenCalledTimes(1);
  const [calledUrl, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit];
  // Parse the URL so we can assert each query param independently of ordering.
  const u = new URL(calledUrl);
  expect(`${u.origin}${u.pathname}`).toBe(
    'http://localhost:8080/api/projects/proj-list-1/architecture-mappings'
  );
  expect(u.searchParams.get('sourceArchitectureId')).toBe('arch-source');
  expect(u.searchParams.get('targetArchitectureId')).toBe('arch-target');
  expect(u.searchParams.get('sourceElementType')).toBe('services');
  expect(u.searchParams.get('targetElementType')).toBe('services');
  expect(u.searchParams.get('mappingType')).toBe('equivalent');
  expect(u.searchParams.get('status')).toBe('confirmed');
  expect(u.searchParams.get('q')).toBe('order');
  expect(calledInit.method).toBe('GET');
});

// ---------------------------------------------------------------------------
// Test 2: POST .../architecture-mappings forwards the body verbatim and
// pass-through-returns 422 {code: "duplicate_mapping"} when AMS returns it.
//
// The frontend Mapping Review modal reads body.code to surface the inline
// error in the manual-add row when the unique constraint is violated. ANY
// transformation by the gateway would break this contract.
// ---------------------------------------------------------------------------
test('POST .../architecture-mappings forwards body verbatim and round-trips 422 duplicate_mapping', async () => {
  const errBody = {
    timestamp: '2026-05-15T00:00:00Z',
    status: 422,
    error: 'Unprocessable Entity',
    code: 'duplicate_mapping',
    message: 'A mapping with the same source/target/mapping_type already exists.',
  };
  mockFetch.mockResolvedValueOnce(jsonResponse(422, errBody));

  const app = createTestApp();
  const payload = {
    sourceArchitectureId: 'arch-source',
    targetArchitectureId: 'arch-target',
    sourceElementType: 'services',
    sourceElementId: 'svc-1',
    targetElementType: 'services',
    targetElementId: 'svc-1-target',
    mappingType: 'equivalent',
    status: 'confirmed',
    notes: null,
    confidence: null,
  };
  const res = await request(app)
    .post('/api/projects/proj-dup-1/architecture-mappings')
    .send(payload);

  expect(res.status).toBe(422);
  expect(res.body).toEqual(errBody);

  expect(mockFetch).toHaveBeenCalledTimes(1);
  const [calledUrl, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit];
  expect(calledUrl).toBe(
    'http://localhost:8080/api/projects/proj-dup-1/architecture-mappings'
  );
  expect(calledInit.method).toBe('POST');
  expect(JSON.parse(calledInit.body as string)).toEqual(payload);
});

// ---------------------------------------------------------------------------
// Test 3: PUT .../architecture-mappings/:mappingId forwards mappingId in
// the URL and the (mutable-fields-only) body verbatim, returning the AMS
// 200 + updated DTO unchanged. The createdByTask field is set server-side
// (mapping-review-modal-edit) and is not part of the request body shape.
// ---------------------------------------------------------------------------
test('PUT .../architecture-mappings/:mappingId forwards mappingId + body and returns 200 verbatim', async () => {
  const updated = {
    id: 'mapping-edit-1',
    projectId: 'proj-edit-1',
    sourceArchitectureId: 'arch-source',
    targetArchitectureId: 'arch-target',
    sourceElementType: 'services',
    sourceElementId: 'svc-1',
    targetElementType: 'services',
    targetElementId: 'svc-1-target',
    mappingType: 'renamed',
    status: 'needs_review',
    createdByTask: 'mapping-review-modal-edit',
    createdAt: '2026-05-15T00:00:00Z',
    updatedAt: '2026-05-15T01:00:00Z',
    notes: 'renamed in target architecture',
    confidence: null,
  };
  mockFetch.mockResolvedValueOnce(jsonResponse(200, updated));

  const app = createTestApp();
  const payload = {
    mappingType: 'renamed',
    status: 'needs_review',
    notes: 'renamed in target architecture',
    confidence: null,
  };
  const res = await request(app)
    .put('/api/projects/proj-edit-1/architecture-mappings/mapping-edit-1')
    .send(payload);

  expect(res.status).toBe(200);
  expect(res.body).toEqual(updated);

  expect(mockFetch).toHaveBeenCalledTimes(1);
  const [calledUrl, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit];
  expect(calledUrl).toBe(
    'http://localhost:8080/api/projects/proj-edit-1/architecture-mappings/mapping-edit-1'
  );
  expect(calledInit.method).toBe('PUT');
  expect(JSON.parse(calledInit.body as string)).toEqual(payload);
});

// ---------------------------------------------------------------------------
// Test 4: DELETE .../architecture-mappings/:mappingId forwards mappingId in
// the URL and pass-through-returns the AMS 204 No Content response. v1 uses
// hard-delete (no soft-delete column).
// ---------------------------------------------------------------------------
test('DELETE .../architecture-mappings/:mappingId forwards mappingId and round-trips 204', async () => {
  mockFetch.mockResolvedValueOnce(noContentResponse());

  const app = createTestApp();
  const res = await request(app).delete(
    '/api/projects/proj-del-1/architecture-mappings/mapping-del-1'
  );

  expect(res.status).toBe(204);

  expect(mockFetch).toHaveBeenCalledTimes(1);
  const [calledUrl, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit];
  expect(calledUrl).toBe(
    'http://localhost:8080/api/projects/proj-del-1/architecture-mappings/mapping-del-1'
  );
  expect(calledInit.method).toBe('DELETE');
});

// ---------------------------------------------------------------------------
// Test 5: The existing selective-copy commit proxy passes the new optional
// autoMap request flag through to AMS verbatim and surfaces the new
// createdMappingCount response field unchanged. This confirms 4.4: no route
// change is required for the selective-copy/commit endpoint -- both the
// Gateway client wrapper and proxy route are body-shape-agnostic.
// ---------------------------------------------------------------------------
test('selective-copy/commit proxy passes autoMap request flag and createdMappingCount response field through unchanged', async () => {
  const commitResponse = {
    copied: 2,
    skipped: 0,
    overwritten: 0,
    duplicated: 0,
    autoIncluded: 0,
    createdMappingCount: 2,
  };
  mockFetch.mockResolvedValueOnce(jsonResponse(200, commitResponse));

  const app = createTestApp();
  const payload = {
    sourceArchitectureId: 'arch-source-tb',
    elementIds: ['svc-1', 'svc-2'],
    resolutions: [],
    autoMap: true,
  };
  const res = await request(app)
    .post('/api/projects/proj-tb-1/architectures/arch-target-tb/selective-copy/commit')
    .send(payload);

  expect(res.status).toBe(200);
  expect(res.body).toEqual(commitResponse);
  // Explicitly confirm the new createdMappingCount field surfaces in the proxy response.
  expect(res.body.createdMappingCount).toBe(2);

  expect(mockFetch).toHaveBeenCalledTimes(1);
  const [calledUrl, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit];
  expect(calledUrl).toBe(
    'http://localhost:8080/api/projects/proj-tb-1/architectures/arch-target-tb/selective-copy/commit'
  );
  expect(calledInit.method).toBe('POST');
  // Confirm the autoMap flag was forwarded byte-for-byte to AMS.
  const sentBody = JSON.parse(calledInit.body as string);
  expect(sentBody).toEqual(payload);
  expect(sentBody.autoMap).toBe(true);
});
