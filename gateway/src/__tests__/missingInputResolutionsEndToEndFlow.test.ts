/**
 * End-to-end gateway flow: bulk-resolve preview -> commit -> ready-to-retry
 * -> retry-batch.
 *
 * Spec: 2026-05-20 Missing Input Resolver Flow -- Task Group 8.3.
 *
 * The gap this test closes
 * ------------------------
 * The existing route-level Jest tests in `missingInputResolutionsRoute.test.ts`
 * cover each gateway endpoint in isolation. None of them exercises the full
 * happy-path chain a real user walks through:
 *
 *   1. Bulk-resolve preview (`commit=false`) -- shows the affected specs.
 *   2. Bulk-resolve commit  (`commit=true`)  -- actually writes resolutions.
 *   3. Ready-to-retry        -- AMS returns the newly-ready spec list.
 *   4. Retry-batch           -- gateway delegates to the batch handler.
 *
 * The contract under test in step (4) is that the gateway batch handler is
 * called with `targetWorkItemIds` populated from the ready-to-retry response,
 * and with `regenerateAll = true` (the retry semantic forces an overwrite of
 * the prior `insufficient_context` row). The threshold gate must NOT trigger
 * for a small (<5 stories, <50k tokens) batch in this path.
 *
 * Implementation notes:
 *   - `fetch` is mocked to scriptedly return AMS responses for the bulk and
 *     ready-to-retry endpoints. The retry-batch path MUST NOT round-trip AMS
 *     (the route delegates to the local batch handler).
 *   - `runShapeSpecGenerationBatch` is mocked so we can assert the exact
 *     payload the gateway forwards to it.
 *   - `computeCostPreview` is mocked to return a sub-threshold preview so the
 *     gate stays closed and the batch fires immediately.
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

const mockComputeCostPreview = jest.fn();
jest.mock('../services/migrationShapeSpecCostPreview', () => {
  const actual = jest.requireActual(
    '../services/migrationShapeSpecCostPreview',
  );
  return {
    ...actual,
    computeCostPreview: (...args: unknown[]) => mockComputeCostPreview(...args),
  };
});

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import express from 'express';
import request from 'supertest';
import { missingInputResolutionsRouter } from '../routes/missingInputResolutions';

function createTestApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use((req, _res, next) => {
    (req as unknown as { requestId: string }).requestId = 'e2e-flow-test';
    next();
  });
  app.use('/api', missingInputResolutionsRouter);
  return app;
}

function jsonUpstream(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Created',
    headers: {
      get: (k: string) =>
        k.toLowerCase() === 'content-type' ? 'application/json' : null,
    },
    text: async () => JSON.stringify(body),
  };
}

beforeEach(() => {
  mockFetch.mockReset();
  mockRunBatch.mockReset();
  mockComputeCostPreview.mockReset();
});

// ---------------------------------------------------------------------------
// E2E: bulk preview -> commit -> ready-to-retry -> retry-batch
// ---------------------------------------------------------------------------

describe('end-to-end: bulk-resolve preview -> commit -> ready-to-retry -> retry-batch', () => {
  it('walks the full chain and delegates the final retry to the local batch handler with the ready ids', async () => {
    const app = createTestApp();
    const projectId = 'proj-e2e';
    const bookOfWorkId = 'book-e2e';

    // ---------- Step 1: bulk-resolve preview (commit=false) ----------
    const previewPayload = {
      resolutions: [
        {
          key: 'aaaaaaaaaaaaaaaa',
          missingInputType: 'api_contract',
          descriptor: 'PaymentsService::createPayment',
          affectedSpecIds: ['spec-1', 'spec-2'],
        },
      ],
      previewOnly: true,
    };
    mockFetch.mockResolvedValueOnce(jsonUpstream(200, previewPayload));

    const previewRes = await request(app)
      .post(`/api/projects/${projectId}/missing-input-resolutions/bulk`)
      .send({
        uploads: [
          { kind: 'oas', filename: 'payments.yaml', base64Payload: 'YWJj' },
        ],
        commit: false,
      });
    expect(previewRes.status).toBe(200);
    expect(previewRes.body.previewOnly).toBe(true);
    expect(previewRes.body.resolutions[0].affectedSpecIds).toEqual([
      'spec-1',
      'spec-2',
    ]);

    // ---------- Step 2: bulk-resolve commit (commit=true) ----------
    const commitPayload = {
      resolutions: previewPayload.resolutions,
      previewOnly: false,
      committed: true,
    };
    mockFetch.mockResolvedValueOnce(jsonUpstream(200, commitPayload));

    const commitRes = await request(app)
      .post(`/api/projects/${projectId}/missing-input-resolutions/bulk`)
      .send({
        uploads: [
          { kind: 'oas', filename: 'payments.yaml', base64Payload: 'YWJj' },
        ],
        commit: true,
      });
    expect(commitRes.status).toBe(200);
    expect(commitRes.body.previewOnly).toBe(false);
    expect(commitRes.body.committed).toBe(true);

    // ---------- Step 3: ready-to-retry ----------
    const readyPayload = {
      count: 2,
      specGenerationIds: ['spec-1', 'spec-2'],
      stories: [
        {
          specGenerationId: 'spec-1',
          workItemId: 'wi-1',
          totalKeys: 1,
          resolvedKeys: 1,
        },
        {
          specGenerationId: 'spec-2',
          workItemId: 'wi-2',
          totalKeys: 1,
          resolvedKeys: 1,
        },
      ],
    };
    mockFetch.mockResolvedValueOnce(jsonUpstream(200, readyPayload));

    const readyRes = await request(app).get(
      `/api/projects/${projectId}/spec-generations/ready-to-retry`,
    );
    expect(readyRes.status).toBe(200);
    expect(readyRes.body.count).toBe(2);
    const readyWorkItemIds: string[] = readyRes.body.stories.map(
      (s: { workItemId: string }) => s.workItemId,
    );
    expect(readyWorkItemIds).toEqual(['wi-1', 'wi-2']);

    // ---------- Step 4: retry-batch (small batch, gate stays closed) ----------
    // Sub-threshold preview keeps the gate closed.
    mockComputeCostPreview.mockResolvedValueOnce({
      estimatedTokens: 10_000,
      estimatedWallClockSeconds: 200,
      perStoryEstimates: [],
      meta: {
        storyCount: 2,
        includePass2: true,
        perStoryContextTokenCap: 24000,
        crossStoryContextTokenCap: 12000,
        tokensPerSecond: 50,
        outputBufferTokens: 4000,
      },
    });
    // Batch handler returns a success envelope.
    mockRunBatch.mockResolvedValueOnce({
      perStoryResults: [
        {
          workItemId: 'wi-1',
          status: 'generated',
          confidence: 'high',
        },
        {
          workItemId: 'wi-2',
          status: 'generated',
          confidence: 'medium',
        },
      ],
      persistedCount: 2,
      resultsCouldNotPersist: 0,
      unpersistedResults: [],
      nextBatchStart: 0,
      summary: {
        generated: 2,
        generated_with_warnings: 0,
        insufficient_context: 0,
        failed: 0,
        skipped_blocked: 0,
      },
    });

    const retryRes = await request(app)
      .post(`/api/projects/${projectId}/spec-generations/retry-batch`)
      .send({ bookOfWorkId, workItemIds: readyWorkItemIds });

    // --- Contract assertions for the e2e flow ---
    expect(retryRes.status).toBe(200);
    expect(retryRes.body.persistedCount).toBe(2);
    expect(retryRes.body.summary.generated).toBe(2);

    // The local batch handler MUST have been called exactly once with the
    // ready-to-retry work-item ids and `regenerateAll=true`.
    expect(mockRunBatch).toHaveBeenCalledTimes(1);
    expect(mockRunBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId,
        bookOfWorkId,
        targetWorkItemIds: ['wi-1', 'wi-2'],
        regenerateAll: true,
      }),
      expect.any(Object),
    );

    // Three fetches total: preview, commit, ready-to-retry. The retry-batch
    // path MUST NOT hit AMS -- the local batch handler is the orchestrator.
    expect(mockFetch).toHaveBeenCalledTimes(3);
    const urlsFetched = mockFetch.mock.calls.map((c) => String(c[0]));
    expect(urlsFetched[0]).toMatch(/\/missing-input-resolutions\/bulk$/);
    expect(urlsFetched[1]).toMatch(/\/missing-input-resolutions\/bulk$/);
    expect(urlsFetched[2]).toMatch(/\/spec-generations\/ready-to-retry$/);
    // No call to /spec-generations/retry-batch on AMS.
    expect(
      urlsFetched.some((u) => u.includes('/spec-generations/retry-batch')),
    ).toBe(false);
  });
});
