/**
 * Migration Delivery Dashboard proxy -- focused route-wiring test.
 *
 * Spec: 2026-05-19 Migration Delivery Progress and Evidence Tracking
 * -- Task Group 6 (sub-task 6.1).
 *
 * Covers spec.md Gateway test 20 only:
 *   Proxy forwards GET /api/projects/:projectId/migration-books-of-work/:bookId/
 *   delivery-dashboard to AMS and returns the AMS payload (body + status code)
 *   unchanged.
 *
 * The mocking pattern follows the GET-proxy half of
 * `migrationBookOfWorkRoute.test.ts` -- mock `getConfig`, mock the logger, and
 * stub `global.fetch` with `jest.fn()`. `jest.resetAllMocks()` runs in
 * `beforeEach` per Standing Constraint 6 in tasks.md.
 */

// ---------------------------------------------------------------------------
// Mocks -- declared before importing the units under test
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
// Imports (after mocks)
// ---------------------------------------------------------------------------

import express from 'express';
import request from 'supertest';
import { migrationDeliveryDashboardRouter } from '../routes/migrationDeliveryDashboard';

function createTestApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use((req, _res, next) => {
    (req as unknown as { requestId: string }).requestId =
      'migration-delivery-dashboard-test';
    next();
  });
  app.use('/api', migrationDeliveryDashboardRouter);
  return app;
}

beforeEach(() => {
  jest.resetAllMocks();
});

describe('GET /api/projects/:projectId/migration-books-of-work/:bookId/delivery-dashboard', () => {
  it('forwards to AMS and returns the AMS payload (body + status code) unchanged', async () => {
    const amsPayload = {
      bookId: 'book-1',
      projectId: 'p-1',
      generatedAt: '2026-05-19T10:00:00Z',
      rollUp: {
        totalWorkItems: 12,
        completedWorkItems: 5,
        inProgressWorkItems: 3,
        notStartedWorkItems: 4,
        specGenerationCompletedCount: 7,
      },
      stories: [
        {
          workItemId: 'wi-1',
          title: 'Migrate User Service',
          state: 'IN_PROGRESS',
          specGenerationStatus: 'COMPLETED',
          implementWorkspaceState: 'DRAFT',
          evidenceSummary: { artifactCount: 2 },
        },
      ],
      warnings: [],
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
      '/api/projects/p-1/migration-books-of-work/book-1/delivery-dashboard',
    );

    // Status code preserved verbatim.
    expect(res.status).toBe(200);
    // Body preserved byte-for-byte (parsed JSON equals the original AMS body).
    expect(res.body).toEqual(amsPayload);
    // Forwarded to the exact AMS URL with method + Accept header.
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/projects/p-1/migration-books-of-work/book-1/delivery-dashboard',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Accept: 'application/json' }),
      }),
    );
  });
});
