/**
 * Stale-spec-count proxy test.
 *
 * Spec: 2026-05-20 Target Architecture Authoring Flow -- Task Group 9.1.
 *
 * Verifies the new gateway route
 *
 *   GET /api/projects/:projectId/spec-generations/stale-count
 *
 * forwards to the corresponding AMS endpoint and round-trips the response
 * verbatim. The endpoint powers the Migration Delivery Dashboard's stale-spec
 * indicator + "Regenerate stale" action.
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

const mockFetch = jest.fn();
(global as unknown as { fetch: typeof mockFetch }).fetch = mockFetch;

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import express from 'express';
import request from 'supertest';
import { targetArchitecturesRouter } from '../routes/targetArchitectures';

function createTestApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use((req, _res, next) => {
    (req as unknown as { requestId: string }).requestId = 'stale-count-test';
    next();
  });
  app.use('/api', targetArchitecturesRouter);
  return app;
}

beforeEach(() => {
  jest.resetAllMocks();
});

describe('GET /api/projects/:projectId/spec-generations/stale-count (proxy)', () => {
  it('forwards the GET to AMS and returns the AMS payload + status verbatim', async () => {
    const amsPayload = {
      staleCount: 3,
      staleWorkItemIds: ['wi-1', 'wi-2', 'wi-3'],
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: {
        get: (k: string) =>
          k.toLowerCase() === 'content-type' ? 'application/json' : null,
      },
      text: async () => JSON.stringify(amsPayload),
    });

    const res = await request(createTestApp()).get(
      '/api/projects/p-1/spec-generations/stale-count',
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual(amsPayload);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/projects/p-1/spec-generations/stale-count',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Accept: 'application/json' }),
      }),
    );
  });
});
