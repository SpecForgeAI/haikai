/**
 * Task Group 4 — suppression-scope guard (the OTHER half).
 *
 * Spec: 2026-06-25-confirmed-manifest-producer-wiring, task 4.4.
 *
 * The seed-story minting (Task Group 4) STRUCTURALLY suppresses the
 * description-grounded spec-gen trigger for `kind='seed_build_files'` (the
 * dedicated minting module never calls the batch — proven in
 * `migrationSeedStoryMinting.test.ts`). This test proves the OTHER half: an
 * ORDINARY `api` / `operational` manual add via the existing add-item route STILL
 * fires `runShapeSpecGenerationBatch` — so the suppression is NOT over-broad.
 *
 * HTTP-surface only; the handler batch + AMS `fetch` are mocked.
 */

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

const mockRunBatch = jest.fn();
jest.mock('../services/migrationShapeSpecGenerationHandler', () => {
  const actual = jest.requireActual(
    '../services/migrationShapeSpecGenerationHandler',
  );
  return {
    ...actual,
    runShapeSpecGenerationBatch: (...args: unknown[]) => mockRunBatch(...args),
  };
});

import express from 'express';
import request from 'supertest';
import { migrationShapeSpecGenerationRouter } from '../routes/migrationShapeSpecGeneration';

function createTestApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use((req, _res, next) => {
    (req as unknown as { requestId: string }).requestId = 'add-item-suppression-test';
    next();
  });
  app.use('/api/v1', migrationShapeSpecGenerationRouter);
  return app;
}

const originalFetch = global.fetch;

beforeEach(() => {
  mockRunBatch.mockReset();
  mockRunBatch.mockResolvedValue({
    perStoryResults: [],
    persistedCount: 0,
    summary: {
      generated: 1,
      generated_with_warnings: 0,
      insufficient_context: 0,
      failed: 0,
      skipped_blocked: 0,
    },
  });
});

afterEach(() => {
  global.fetch = originalFetch;
});

test('an ordinary api manual add STILL fires the description-grounded spec-gen batch (suppression not over-broad)', async () => {
  // Stub the AMS add-item POST to return a created work item.
  global.fetch = jest.fn().mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        work_item_id: 'wi-new-1',
        book_item_id: 'manual-x',
        provenance: 'net_new',
        kind: 'api',
        message: 'ok',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ),
  ) as unknown as typeof fetch;

  const res = await request(createTestApp())
    .post('/api/v1/projects/p-1/migration-books-of-work/b-1/items/add-item')
    .send({ provenance: 'net_new', kind: 'api', title: 'Add an endpoint' });

  expect(res.status).toBe(200);
  expect(res.body.work_item_id).toBe('wi-new-1');

  // The ordinary add-item path FIRES generation for the created story.
  expect(mockRunBatch).toHaveBeenCalledTimes(1);
  expect(mockRunBatch).toHaveBeenCalledWith(
    expect.objectContaining({
      projectId: 'p-1',
      bookOfWorkId: 'b-1',
      batchSize: 1,
      regenerateAll: true,
      targetWorkItemIds: ['wi-new-1'],
    }),
    expect.objectContaining({
      seedBuildFilesSource: expect.any(Function),
    }),
  );
});
