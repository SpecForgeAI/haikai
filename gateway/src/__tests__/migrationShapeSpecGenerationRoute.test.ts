/**
 * Migration Shape-Spec Batch Generation route — focused route-wiring tests.
 *
 * Spec 2026-05-19 (Spec 2) — follow-up wiring.
 *
 * HTTP-surface only; the handler is mocked. Verifies:
 *
 *   1. POST generate-batch forwards body fields to the handler and returns
 *      the handler's BatchResult.
 *   2. POST regenerate-single returns 400 when workItemId is missing.
 *   3. POST regenerate-single calls the handler with
 *      `batchSize: 1, regenerateAll: true, targetWorkItemIds: [workItemId]`.
 */

// ---------------------------------------------------------------------------
// Mocks (declared first)
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

// ---------------------------------------------------------------------------

import express from 'express';
import request from 'supertest';
import { migrationShapeSpecGenerationRouter } from '../routes/migrationShapeSpecGeneration';

function createTestApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use((req, _res, next) => {
    (req as unknown as { requestId: string }).requestId = 'mssg-route-test';
    next();
  });
  app.use('/api/v1', migrationShapeSpecGenerationRouter);
  return app;
}

function emptyBatchResult() {
  return {
    perStoryResults: [],
    persistedCount: 0,
    resultsCouldNotPersist: 0,
    unpersistedResults: [],
    nextBatchStart: 0,
    summary: {
      generated: 0,
      generated_with_warnings: 0,
      insufficient_context: 0,
      failed: 0,
      skipped_blocked: 0,
    },
  };
}

beforeEach(() => {
  mockRunBatch.mockReset();
});

describe('POST .../spec-generations/generate-batch', () => {
  it('forwards body fields to the handler and returns BatchResult', async () => {
    mockRunBatch.mockResolvedValueOnce({
      ...emptyBatchResult(),
      persistedCount: 2,
      summary: {
        ...emptyBatchResult().summary,
        generated: 2,
      },
    });
    const res = await request(createTestApp())
      .post(
        '/api/v1/projects/p-1/migration-books-of-work/b-1/spec-generations/generate-batch',
      )
      .send({
        batchSize: 5,
        regenerateAll: false,
        skipBlockedStories: true,
        confirmOverwrite: false,
        maxFindings: 10,
        maxEvidenceItems: 20,
        // maxBaselineItems is DELIBERATELY still sent by this legacy caller
        // shape — the route must IGNORE it (captured baseline items left spec
        // construction, 2026-08-18; the handler pins the resolver cap to 0).
        maxBaselineItems: 5,
        // Selective generation: the workspace's "Generate specs for selected"
        // sends an explicit whitelist that the route MUST forward.
        targetWorkItemIds: ['wi-7', 'wi-9'],
      });
    expect(res.status).toBe(200);
    expect(res.body.persistedCount).toBe(2);
    expect(res.body.summary.generated).toBe(2);
    expect(mockRunBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'p-1',
        bookOfWorkId: 'b-1',
        batchSize: 5,
        regenerateAll: false,
        skipBlockedStories: true,
        confirmOverwrite: false,
        maxFindings: 10,
        maxEvidenceItems: 20,
        targetWorkItemIds: ['wi-7', 'wi-9'],
      }),
      expect.objectContaining({
        fetchProjectConfig: expect.any(Function),
        autoSeedEpicCapturedDecision: expect.any(Function),
      }),
    );
  });

  it('maps an unexpected handler error to 500', async () => {
    mockRunBatch.mockRejectedValueOnce(new Error('boom'));
    const res = await request(createTestApp())
      .post(
        '/api/v1/projects/p-1/migration-books-of-work/b-1/spec-generations/generate-batch',
      )
      .send({});
    expect(res.status).toBe(500);
    expect(res.body.error.details).toBe('boom');
  });
});

describe('POST .../spec-generations/regenerate-single', () => {
  it('returns 400 when workItemId is missing', async () => {
    const res = await request(createTestApp())
      .post(
        '/api/v1/projects/p-1/migration-books-of-work/b-1/spec-generations/regenerate-single',
      )
      .send({});
    expect(res.status).toBe(400);
    expect(mockRunBatch).not.toHaveBeenCalled();
  });

  it('calls the handler with batchSize=1, regenerateAll=true, targetWorkItemIds=[wi]', async () => {
    mockRunBatch.mockResolvedValueOnce(emptyBatchResult());
    const res = await request(createTestApp())
      .post(
        '/api/v1/projects/p-1/migration-books-of-work/b-1/spec-generations/regenerate-single',
      )
      .send({ workItemId: 'wi-42', confirmOverwrite: true });
    expect(res.status).toBe(200);
    expect(mockRunBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'p-1',
        bookOfWorkId: 'b-1',
        batchSize: 1,
        regenerateAll: true,
        confirmOverwrite: true,
        targetWorkItemIds: ['wi-42'],
      }),
      expect.objectContaining({
        fetchProjectConfig: expect.any(Function),
        autoSeedEpicCapturedDecision: expect.any(Function),
      }),
    );
  });
});
