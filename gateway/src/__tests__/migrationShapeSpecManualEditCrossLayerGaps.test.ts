/**
 * Cross-layer gap coverage for the In-Product Spec Editor + Confirm-Overwrite
 * feature on the gateway proxy layer.
 *
 * The Group 5 test suite covers manual-edit POST 200/404 + in-scope GET happy
 * path. This file adds the cross-layer gap identified in Task Group 10:
 *
 *   - in-scope pre-flight proxy must round-trip the AMS 404 envelope
 *     (book-of-work belongs to a different project / does not exist). The
 *     bulk picker depends on a clean 404 round-trip so the frontend can show
 *     a sensible "couldn't read manually-edited rows" error instead of
 *     guessing.
 *
 * Spec: 2026-05-20 In-Product Spec Editor + Confirm-Overwrite -- Task Group 10.
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

jest.mock('../services/architectureModelClient', () => ({
  fetchProjectConfigWithDefaults: jest.fn(),
  DEFAULT_PER_STORY_TOKEN_CAP: 24000,
  DEFAULT_CROSS_STORY_TOKEN_CAP: 12000,
  DEFAULT_AUTO_RUN_PASS_2: false,
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
    (req as unknown as { requestId: string }).requestId = 'gap-test';
    next();
  });
  app.use('/api/v1', migrationShapeSpecGenerationRouter);
  return app;
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
  mockFetch.mockReset();
});

// ---------------------------------------------------------------------------
// in-scope proxy: 404 round-trip
// ---------------------------------------------------------------------------

describe('manually-edited-in-scope proxy: 404 round-trip (Group 10 gap)', () => {
  it('relays the AMS 404 envelope verbatim when the book is unknown / cross-project', async () => {
    const amsErrorBody = {
      error: { code: 404, message: 'Book of work not found.' },
    };
    mockFetch.mockResolvedValueOnce(amsErrorResponse(404, amsErrorBody));

    const res = await request(createTestApp()).get(
      '/api/v1/projects/p-1/migration-books-of-work/missing-book/spec-generations/manually-edited-in-scope',
    );

    expect(res.status).toBe(404);
    expect(res.body).toEqual(amsErrorBody);
    // The upstream URL was the AMS endpoint with the unknown book id forwarded.
    const [calledUrl, calledInit] = mockFetch.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(calledUrl).toBe(
      'http://localhost:8080/api/projects/p-1/migration-books-of-work/missing-book/spec-generations/manually-edited-in-scope',
    );
    expect(calledInit.method).toBe('GET');
  });
});
