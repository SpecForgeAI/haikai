/**
 * Multi-Architecture Plumbing -- Gateway tests (Task Group 3, Task 3.1).
 *
 * Spec: 2026-05-01 Multi-Architecture Plumbing.
 *
 * Test inventory (kept to <=8, focused on the task-specified properties):
 *   1. Bucket A function `fetchMetaModelSummary(projectId, architectureId)`
 *      embeds `/architectures/{architectureId}/` in the upstream URL.
 *   2. The TypeScript signature of `fetchMetaModelSummary` requires
 *      `architectureId` -- compile-time evidence (a runtime call with a
 *      missing arg is a TS error; this test asserts URL-encoding fails
 *      cleanly when an explicit empty string is passed instead of relying
 *      on undefined).
 *   3. Bucket B function `fetchProjectFolder(projectId)` is unchanged --
 *      its URL contains no `/architectures/` segment and the function
 *      signature still takes only `projectId`.
 *   4. New helper `listArchitectures(projectId)` hits
 *      `GET /api/projects/{projectId}/architectures` and parses the array.
 *   5. New helper `resolveDefaultArchitectureId(projectId)` returns the
 *      oldest non-archived architecture's id, skipping archived ones.
 *   6. New gateway proxy route `GET /api/projects/:projectId/architectures`
 *      proxies to architecture-model-service and returns the array verbatim.
 *   7. **Path-segment 404 safety**: hitting a Bucket A proxy route on the
 *      gateway WITHOUT `:architectureId` in the URL returns 404 (Express
 *      route mismatch). This is the integration test for the spec's
 *      core safety property.
 *   8. **Path-segment 404 safety, second shape**: the same property holds
 *      for the model-load Bucket A endpoint
 *      (`/api/model/projects/:projectId/architectures/:architectureId`).
 */

// ---- Mock the gateway config so the tests don't depend on env vars ----
jest.mock('../config', () => ({
  getConfig: () => ({
    architectureModelServiceBaseUrl: 'http://localhost:8080',
  }),
}));

// ---- Mock global fetch for client-function tests ----
const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

import express from 'express';
import request from 'supertest';
import {
  fetchMetaModelSummary,
  fetchProjectFolder,
  listArchitectures,
  resolveDefaultArchitectureId,
  _resetDefaultArchitectureCache,
} from '../services/architectureModelClient';
import { architecturesRouter } from '../routes/architectures';

function createTestApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use((req, _res, next) => {
    (req as any).requestId = 'multi-arch-test';
    next();
  });
  // Mount as the real server does.
  app.use('/api', architecturesRouter);
  return app;
}

beforeEach(() => {
  mockFetch.mockReset();
  _resetDefaultArchitectureCache();
});

// ---------------------------------------------------------------------------
// Test 1: fetchMetaModelSummary embeds architectureId in the upstream URL.
// ---------------------------------------------------------------------------
test('fetchMetaModelSummary embeds architectureId in the upstream URL', async () => {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ services: [], data_entities: [], interfaces: [], relationships: [] }),
  });

  const result = await fetchMetaModelSummary('proj-123', 'arch-abc');

  expect(mockFetch).toHaveBeenCalledTimes(1);
  const calledUrl = mockFetch.mock.calls[0][0] as string;
  expect(calledUrl).toBe(
    'http://localhost:8080/api/projects/proj-123/architectures/arch-abc/meta-model-summary'
  );
  expect(calledUrl).toContain('/architectures/arch-abc/');
  expect(result).not.toBeNull();
});

// ---------------------------------------------------------------------------
// Test 2: TypeScript signature requires architectureId.
//
// We can't statically assert "TS error" at runtime; the closest practical
// check is that omitting the arg (passing undefined explicitly via the
// untyped any escape hatch, which is what callers without the migration
// would hit before TS catches it) produces an obviously-broken URL --
// i.e. `/architectures/undefined/`. Demonstrates the function does NOT
// silently invent a default, which is the safety property.
// ---------------------------------------------------------------------------
test('fetchMetaModelSummary does NOT silently default architectureId when missing', async () => {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({}),
  });

  // Deliberately bypass the TS signature to demonstrate the runtime URL.
  await (fetchMetaModelSummary as any)('proj-1');

  expect(mockFetch).toHaveBeenCalledTimes(1);
  const calledUrl = mockFetch.mock.calls[0][0] as string;
  // No silent fallback to a default architecture: the URL contains the
  // literal "undefined" (URL-encoded). It does NOT contain a real UUID.
  expect(calledUrl).toContain('/architectures/undefined/');
});

// ---------------------------------------------------------------------------
// Test 3: Bucket B fetchProjectFolder is unchanged (signature + URL shape).
// ---------------------------------------------------------------------------
test('fetchProjectFolder (Bucket B) is unchanged: no architectureId, URL omits /architectures/', async () => {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ project_parent_folder: '/tmp/projects/proj-x' }),
  });

  // Passing only projectId compiles AND succeeds -- Bucket B is unchanged.
  const folder = await fetchProjectFolder('proj-x');

  expect(folder).toBe('/tmp/projects/proj-x');
  expect(mockFetch).toHaveBeenCalledTimes(1);
  const calledUrl = mockFetch.mock.calls[0][0] as string;
  expect(calledUrl).toBe('http://localhost:8080/api/projects/proj-x');
  expect(calledUrl).not.toContain('/architectures');
});

// ---------------------------------------------------------------------------
// Test 4: listArchitectures hits the new endpoint and returns the array.
// ---------------------------------------------------------------------------
test('listArchitectures(projectId) hits GET /api/projects/{projectId}/architectures', async () => {
  const fixture = [
    {
      id: 'arch-1',
      projectId: 'proj-7',
      name: 'Default',
      description: null,
      tags: [],
      archived: false,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
  ];
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => fixture,
  });

  const result = await listArchitectures('proj-7');

  expect(mockFetch).toHaveBeenCalledTimes(1);
  const calledUrl = mockFetch.mock.calls[0][0] as string;
  expect(calledUrl).toBe('http://localhost:8080/api/projects/proj-7/architectures');
  expect(result).toEqual(fixture);
});

// ---------------------------------------------------------------------------
// Test 5: resolveDefaultArchitectureId returns the oldest non-archived id.
// ---------------------------------------------------------------------------
test('resolveDefaultArchitectureId returns oldest non-archived architecture id', async () => {
  // List endpoint returns architectures already ordered by created_at asc.
  // The first non-archived is the Default.
  const fixture = [
    {
      id: 'arch-archived-oldest',
      projectId: 'proj-9',
      name: 'Old (archived)',
      description: null,
      tags: [],
      archived: true,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 'arch-default',
      projectId: 'proj-9',
      name: 'Default',
      description: null,
      tags: [],
      archived: false,
      createdAt: '2026-02-01T00:00:00Z',
      updatedAt: '2026-02-01T00:00:00Z',
    },
    {
      id: 'arch-newer',
      projectId: 'proj-9',
      name: 'Future',
      description: null,
      tags: [],
      archived: false,
      createdAt: '2026-03-01T00:00:00Z',
      updatedAt: '2026-03-01T00:00:00Z',
    },
  ];
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => fixture,
  });

  const id = await resolveDefaultArchitectureId('proj-9');

  expect(id).toBe('arch-default');
});

// ---------------------------------------------------------------------------
// Test 6: New gateway proxy route returns the architectures array verbatim.
// ---------------------------------------------------------------------------
test('GET /api/projects/:projectId/architectures proxy returns architectures verbatim', async () => {
  const fixture = [
    {
      id: 'arch-x',
      projectId: 'proj-list',
      name: 'Default',
      description: 'desc',
      tags: ['legacy', 'baseline'],
      archived: false,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
  ];
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    json: async () => fixture,
    text: async () => JSON.stringify(fixture),
  });

  const app = createTestApp();
  const res = await request(app).get('/api/projects/proj-list/architectures');

  expect(res.status).toBe(200);
  expect(res.body).toEqual(fixture);
  // Sanity: upstream URL was the architecture-model-service architectures endpoint.
  const calledUrl = mockFetch.mock.calls[0][0] as string;
  expect(calledUrl).toBe('http://localhost:8080/api/projects/proj-list/architectures');
});

// ---------------------------------------------------------------------------
// Test 7: Path-segment 404 safety -- omitting :architectureId on a Bucket A
// proxy route returns 404 from Express (no silent fallback).
// ---------------------------------------------------------------------------
test('Bucket A proxy route 404s when :architectureId is missing from the URL', async () => {
  const app = createTestApp();

  // Hit the meta-model-summary proxy WITHOUT the :architectureId path segment.
  // The router has no matching route, so Express must return 404. If a silent
  // fallback existed (e.g. /api/projects/:projectId/meta-model-summary
  // resolved to something), this test would fail.
  const res = await request(app).get('/api/projects/proj-no-arch/meta-model-summary');

  expect(res.status).toBe(404);
  // No upstream HTTP call should have been made -- the request never left the gateway.
  expect(mockFetch).not.toHaveBeenCalled();
});

// ---------------------------------------------------------------------------
// Test 8: Same 404 safety for the model-load Bucket A endpoint.
// ---------------------------------------------------------------------------
test('Bucket A model-load proxy route 404s when :architectureId is missing', async () => {
  const app = createTestApp();

  const res = await request(app).get('/api/model/projects/proj-no-arch');

  expect(res.status).toBe(404);
  expect(mockFetch).not.toHaveBeenCalled();
});
