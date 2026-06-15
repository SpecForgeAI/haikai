/**
 * Task Group 10 cross-layer / gap-fill tests for the Target Architecture
 * Authoring Flow (Spec 2026-05-20).
 *
 * Per tasks.md sub-task 10.2 candidate (b): the active-target debounce
 * decision lives on the AMS side via `last_marked_stale_at` (tasks.md sub-task
 * 5.5 and the file header of `gateway/src/routes/targetArchitectures.ts`).
 * The gateway proxy passes mark-stale calls through verbatim -- there is NO
 * gateway-internal in-memory debounce buffer in v1.
 *
 * This file exists to surface a regression if anyone re-introduces a gateway
 * debounce buffer: two consecutive POSTs to
 *
 *   POST /api/projects/:projectId/specs/mark-stale
 *
 * MUST both reach AMS even when they are sub-second apart. The AMS-side
 * debounce (covered by `TargetArchitectureGroup3Test` bonus tests) is the
 * only one that should suppress duplicates.
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
    (req as unknown as { requestId: string }).requestId = 'group10-cross-layer-test';
    next();
  });
  app.use('/api', targetArchitecturesRouter);
  return app;
}

beforeEach(() => {
  jest.resetAllMocks();
});

describe('Task Group 10 cross-layer regression: gateway is pass-through (no debounce buffer)', () => {
  it('two consecutive mark-stale POSTs both reach AMS (no gateway-side suppression)', async () => {
    // AMS would respond to the second call with debounceSkipped=true; the
    // gateway does NOT pre-suppress -- it forwards both calls so AMS can
    // apply the authoritative debounce window via `last_marked_stale_at`.
    const amsResponseFirst = { markedCount: 2, debounceSkipped: false };
    const amsResponseSecond = { markedCount: 0, debounceSkipped: true };

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: {
          get: (k: string) =>
            k.toLowerCase() === 'content-type' ? 'application/json' : null,
        },
        text: async () => JSON.stringify(amsResponseFirst),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: {
          get: (k: string) =>
            k.toLowerCase() === 'content-type' ? 'application/json' : null,
        },
        text: async () => JSON.stringify(amsResponseSecond),
      });

    const body = {
      activeTargetArchId: 'arch-uuid-target',
      changedElementIds: ['elt-1', 'elt-2'],
    };

    const app = createTestApp();

    // Two consecutive calls, no artificial delay.
    const first = await request(app)
      .post('/api/projects/p-1/specs/mark-stale')
      .send(body);
    const second = await request(app)
      .post('/api/projects/p-1/specs/mark-stale')
      .send(body);

    // Both calls reached AMS -- no gateway-side debounce buffer suppressed
    // the second.
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(first.status).toBe(200);
    expect(first.body).toEqual(amsResponseFirst);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(amsResponseSecond);

    // The two calls were made to the same AMS URL with the same body.
    const expectedUrl =
      'http://localhost:8080/api/projects/p-1/specs/mark-stale';
    const [firstUrl, firstInit] = mockFetch.mock.calls[0];
    const [secondUrl, secondInit] = mockFetch.mock.calls[1];
    expect(firstUrl).toBe(expectedUrl);
    expect(secondUrl).toBe(expectedUrl);
    expect(JSON.parse((firstInit as RequestInit).body as string)).toEqual(body);
    expect(JSON.parse((secondInit as RequestInit).body as string)).toEqual(body);
  });
});
