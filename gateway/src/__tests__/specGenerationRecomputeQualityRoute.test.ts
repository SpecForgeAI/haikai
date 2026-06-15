/**
 * Gateway thin-proxy routes for the AMS quality-recompute endpoints.
 *
 * Spec: 2026-05-20 Spec Quality Scoring -- Task Group 5.
 *
 * Focused tests:
 *
 *   1. Single-row recompute forwards POST to the AMS path including
 *      `:projectId` and `:specId` and round-trips the AMS body verbatim.
 *   2. Bulk recompute forwards POST to the AMS bulk path and round-trips
 *      the `{ totalScored, totalSkipped, gradeBreakdown }` summary body.
 *   3. AMS 404 round-trips back as 404 with the AMS body intact (the
 *      project-ownership-mismatch case lives behind a 404 in the
 *      single-row recompute controller per spec).
 *   4. AMS 5xx round-trips back with the same status code and body.
 *   5. `X-User-Id` header from the caller is forwarded to AMS when
 *      present; omitted from forwarded headers when absent.
 *   6. Neither route requires an LLM client; the only outbound call is
 *      the AMS fetch (verified by the mock fetch being the single
 *      external collaborator in play).
 */

// ---------------------------------------------------------------------------
// Mocks (declared BEFORE imports)
// ---------------------------------------------------------------------------

jest.mock('../config', () => ({
  getConfig: () => ({
    architectureModelServiceBaseUrl: 'http://localhost:8080',
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

// Stub heavy collaborators the router imports for the OTHER routes -- they
// aren't used by the quality-recompute routes but importing the router pulls
// them in. Mirrors `missingInputResolutionsParseFilesRoute.test.ts`.
jest.mock('../services/migrationShapeSpecGenerationHandler', () => {
  const actual = jest.requireActual(
    '../services/migrationShapeSpecGenerationHandler',
  );
  return {
    ...actual,
    runShapeSpecGenerationBatch: jest.fn(),
  };
});

jest.mock('../services/architectureModelClient', () => ({
  fetchProjectConfigWithDefaults: jest.fn(),
}));

jest.mock('../services/epicCapturedDecisionsClient', () => ({
  autoSeedEpicCapturedDecision: jest.fn(),
}));

const mockFetch = jest.fn();
(global as unknown as { fetch: typeof mockFetch }).fetch = mockFetch;

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import express from 'express';
import request from 'supertest';
import { migrationShapeSpecGenerationRouter } from '../routes/migrationShapeSpecGeneration';

function createTestApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use((req, _res, next) => {
    (req as unknown as { requestId: string }).requestId =
      'recompute-quality-test';
    next();
  });
  app.use('/api/v1', migrationShapeSpecGenerationRouter);
  return app;
}

function amsOkResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'OK',
    headers: {
      get: (k: string) =>
        k.toLowerCase() === 'content-type' ? 'application/json' : null,
    },
    text: async () => JSON.stringify(body),
  };
}

function amsErrorResponse(status: number, body: unknown) {
  return {
    ok: false,
    status,
    statusText: 'Error',
    headers: {
      get: (k: string) =>
        k.toLowerCase() === 'content-type' ? 'application/json' : null,
    },
    text: async () => JSON.stringify(body),
  };
}

beforeEach(() => {
  jest.resetAllMocks();
});

// ---------------------------------------------------------------------------
// Test 1: single-row recompute forwards POST and round-trips body
// ---------------------------------------------------------------------------

describe('POST /api/v1/projects/:projectId/spec-generations/:specId/recompute-quality (proxy)', () => {
  it('forwards POST to AMS at the correct path and returns the AMS body verbatim', async () => {
    const amsPayload = {
      qualityScore: 78,
      qualityGrade: 'B',
      qualityDimensions: [
        { name: 'completeness', score: 86, reason: '6/7 expected sections present; missing: tests' },
        { name: 'ac_measurability', score: 75, reason: '3 of 4 ACs include measurable signals; weakest: handles error' },
        { name: 'implementation_concreteness', score: 70, reason: '7 concrete references found (files, classes, operations)' },
        { name: 'evidence_density', score: 60, reason: '3 evidence refs across ~120 words; density = 2.5' },
        { name: 'sibling_parent_alignment', score: 65, reason: '0 contradictions, 1 alignments; from baseline 50' },
      ],
      previousQualityScore: 64,
    };
    mockFetch.mockResolvedValueOnce(amsOkResponse(amsPayload));

    const res = await request(createTestApp())
      .post('/api/v1/projects/p-1/spec-generations/spec-42/recompute-quality')
      .send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual(amsPayload);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [calledUrl, calledInit] = mockFetch.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(calledUrl).toBe(
      'http://localhost:8080/api/projects/p-1/spec-generations/spec-42/recompute-quality',
    );
    expect(calledInit.method).toBe('POST');
    const headers = (calledInit.headers || {}) as Record<string, string>;
    expect(headers['Accept']).toBe('application/json');
    expect(headers['Content-Type']).toBe('application/json');
    // No caller X-User-Id -> none forwarded.
    expect(headers['X-User-Id']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Test 2: bulk recompute forwards POST and round-trips summary body
// ---------------------------------------------------------------------------

describe('POST /api/v1/projects/:projectId/spec-generations/recompute-quality-bulk (proxy)', () => {
  it('forwards POST to AMS bulk endpoint and returns the summary body verbatim', async () => {
    const amsPayload = {
      totalScored: 18,
      totalSkipped: 4,
      gradeBreakdown: { A: 5, B: 6, C: 4, D: 2, F: 1, na: 4 },
    };
    mockFetch.mockResolvedValueOnce(amsOkResponse(amsPayload));

    const res = await request(createTestApp())
      .post('/api/v1/projects/p-1/spec-generations/recompute-quality-bulk')
      .send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual(amsPayload);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [calledUrl, calledInit] = mockFetch.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(calledUrl).toBe(
      'http://localhost:8080/api/projects/p-1/spec-generations/recompute-quality-bulk',
    );
    expect(calledInit.method).toBe('POST');
  });
});

// ---------------------------------------------------------------------------
// Test 3: AMS 404 round-trips with status + body intact
// ---------------------------------------------------------------------------

describe('quality-recompute proxy: 404 pass-through', () => {
  it('round-trips a 404 envelope from AMS unchanged (single-row)', async () => {
    const amsErrorBody = {
      error: {
        code: 404,
        message: 'Spec generation not found for the given project.',
      },
    };
    mockFetch.mockResolvedValueOnce(amsErrorResponse(404, amsErrorBody));

    const res = await request(createTestApp())
      .post(
        '/api/v1/projects/p-1/spec-generations/spec-does-not-exist/recompute-quality',
      )
      .send({});

    expect(res.status).toBe(404);
    expect(res.body).toEqual(amsErrorBody);
  });

  it('round-trips a 404 envelope from AMS unchanged (bulk)', async () => {
    const amsErrorBody = {
      error: { code: 404, message: 'Project not found.' },
    };
    mockFetch.mockResolvedValueOnce(amsErrorResponse(404, amsErrorBody));

    const res = await request(createTestApp())
      .post('/api/v1/projects/does-not-exist/spec-generations/recompute-quality-bulk')
      .send({});

    expect(res.status).toBe(404);
    expect(res.body).toEqual(amsErrorBody);
  });
});

// ---------------------------------------------------------------------------
// Test 4: AMS 5xx round-trips with status + body intact
// ---------------------------------------------------------------------------

describe('quality-recompute proxy: 5xx pass-through', () => {
  it('round-trips a 500 envelope from AMS unchanged', async () => {
    const amsErrorBody = {
      error: { code: 500, message: 'Unexpected server error', details: 'boom' },
    };
    mockFetch.mockResolvedValueOnce(amsErrorResponse(500, amsErrorBody));

    const res = await request(createTestApp())
      .post('/api/v1/projects/p-1/spec-generations/spec-42/recompute-quality')
      .send({});

    expect(res.status).toBe(500);
    expect(res.body).toEqual(amsErrorBody);
  });
});

// ---------------------------------------------------------------------------
// Test 5: X-User-Id header forwarding
// ---------------------------------------------------------------------------

describe('quality-recompute proxy: X-User-Id forwarding', () => {
  it('forwards the X-User-Id header to AMS when present (single-row)', async () => {
    mockFetch.mockResolvedValueOnce(
      amsOkResponse({
        qualityScore: 80,
        qualityGrade: 'B',
        qualityDimensions: [],
        previousQualityScore: null,
      }),
    );

    await request(createTestApp())
      .post('/api/v1/projects/p-1/spec-generations/spec-42/recompute-quality')
      .set('X-User-Id', 'user-alice')
      .send({});

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = (calledInit.headers || {}) as Record<string, string>;
    expect(headers['X-User-Id']).toBe('user-alice');
  });

  it('forwards the X-User-Id header to AMS when present (bulk)', async () => {
    mockFetch.mockResolvedValueOnce(
      amsOkResponse({
        totalScored: 0,
        totalSkipped: 0,
        gradeBreakdown: { A: 0, B: 0, C: 0, D: 0, F: 0, na: 0 },
      }),
    );

    await request(createTestApp())
      .post('/api/v1/projects/p-1/spec-generations/recompute-quality-bulk')
      .set('X-User-Id', 'user-bob')
      .send({});

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = (calledInit.headers || {}) as Record<string, string>;
    expect(headers['X-User-Id']).toBe('user-bob');
  });
});
