/**
 * Missing Input Resolutions proxy + retry-batch route tests + parity test.
 *
 * Spec: 2026-05-20 Missing Input Resolver Flow -- Task Group 5.
 *
 * Eight focused tests (per tasks.md 5.1):
 *
 *   1. Single-create proxy forwards POST verbatim and round-trips status +
 *      body (AMS 201 + `{ resolutionId, affectedSpecIds[] }`).
 *   2. Bulk proxy returns AMS preview response unchanged when commit=false.
 *   3. Retry-batch with <5 stories AND token-budget under threshold runs the
 *      batch handler directly (no preview).
 *   4. Retry-batch with >=5 stories returns `{ requiresConfirmation: true,
 *      costPreview, threshold }` WITHOUT calling the batch handler.
 *   5. Retry-batch with `confirmed:true` runs the batch handler regardless of
 *      story count (skips the gate).
 *   6. AMS retry-batch 501 envelope is NOT surfaced -- the gateway uses the
 *      local batch handler instead.
 *   7. Input validation: 400 when bookOfWorkId / workItemIds missing.
 *   8. PARITY -- the gateway hasher (mirror of AMS `MissingInputKeyHasher`)
 *      produces the same 16-hex output as AMS for canonical inputs for all
 *      three v1 types (api_contract / mapping / target_element). The expected
 *      hashes are computed against the AMS algorithm pre-image structure
 *      (`type|descriptor`, SHA-256 truncated to 16 hex chars) so a future
 *      divergence in either side breaks this test.
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

// Mock the batch handler so we can assert it's called with the expected
// arguments without spinning up the real cross-story two-pass loop.
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

// Mock the cost-preview computer so we can control which branch of the gate
// fires without round-tripping AMS for the book-of-work load.
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
import {
  computeKey,
  canonicalDescriptorForApiContract,
  canonicalDescriptorForMapping,
  canonicalDescriptorForArchElement,
} from '../services/missingInputKeyHasher';

function createTestApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use((req, _res, next) => {
    (req as unknown as { requestId: string }).requestId = 'mir-route-test';
    next();
  });
  app.use('/api', missingInputResolutionsRouter);
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

function emptyCostPreview(estimatedTokens: number) {
  return {
    estimatedTokens,
    estimatedWallClockSeconds: estimatedTokens / 50,
    perStoryEstimates: [],
    meta: {
      storyCount: 0,
      includePass2: true,
      perStoryContextTokenCap: 24000,
      crossStoryContextTokenCap: 12000,
      tokensPerSecond: 50,
      outputBufferTokens: 4000,
    },
  };
}

beforeEach(() => {
  mockFetch.mockReset();
  mockRunBatch.mockReset();
  mockComputeCostPreview.mockReset();
});

// ---------------------------------------------------------------------------
// Test 1: single-create proxy forwards verbatim
// ---------------------------------------------------------------------------

describe('POST /api/projects/:projectId/missing-input-resolutions (proxy)', () => {
  it('forwards POST to AMS and returns the AMS payload + status unchanged', async () => {
    const amsPayload = {
      resolutionId: 'res-uuid-aaa',
      affectedSpecIds: ['spec-1', 'spec-2'],
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      statusText: 'Created',
      headers: {
        get: (k: string) =>
          k.toLowerCase() === 'content-type' ? 'application/json' : null,
      },
      text: async () => JSON.stringify(amsPayload),
    });

    const res = await request(createTestApp())
      .post('/api/projects/p-1/missing-input-resolutions')
      .send({
        missingInputKey: '1234567890abcdef',
        missingInputType: 'api_contract',
        resolutionPayload: { contractBlobId: 'blob-1' },
      });

    expect(res.status).toBe(201);
    expect(res.body).toEqual(amsPayload);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/projects/p-1/missing-input-resolutions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Accept: 'application/json',
          'Content-Type': 'application/json',
        }),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Test 2: bulk proxy round-trips preview response when commit=false
// ---------------------------------------------------------------------------

describe('POST /api/projects/:projectId/missing-input-resolutions/bulk (proxy)', () => {
  it('returns the AMS preview response unchanged when commit=false', async () => {
    const previewPayload = {
      resolutions: [
        {
          key: '1111111111111111',
          missingInputType: 'api_contract',
          descriptor: 'svc::op1',
          affectedSpecIds: ['spec-a', 'spec-b'],
        },
        {
          key: '2222222222222222',
          missingInputType: 'api_contract',
          descriptor: 'svc::op2',
          affectedSpecIds: ['spec-c'],
        },
      ],
      previewOnly: true,
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: {
        get: (k: string) =>
          k.toLowerCase() === 'content-type' ? 'application/json' : null,
      },
      text: async () => JSON.stringify(previewPayload),
    });

    const res = await request(createTestApp())
      .post('/api/projects/p-1/missing-input-resolutions/bulk')
      .send({
        uploads: [
          {
            kind: 'oas',
            filename: 'svc.yaml',
            base64Payload: 'b2FzLWZpeHR1cmU=',
          },
        ],
        commit: false,
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(previewPayload);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/projects/p-1/missing-input-resolutions/bulk',
      expect.objectContaining({ method: 'POST' }),
    );
    // The proxy never hits the batch handler -- bulk is pure AMS.
    expect(mockRunBatch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Test 3: retry-batch under threshold runs the batch handler directly
// ---------------------------------------------------------------------------

describe('POST /api/projects/:projectId/spec-generations/retry-batch (under threshold)', () => {
  it('runs the batch handler directly when count<5 and tokens<=50000', async () => {
    mockComputeCostPreview.mockResolvedValueOnce(emptyCostPreview(10_000));
    mockRunBatch.mockResolvedValueOnce({
      ...emptyBatchResult(),
      persistedCount: 2,
      summary: { ...emptyBatchResult().summary, generated: 2 },
    });

    const res = await request(createTestApp())
      .post('/api/projects/p-1/spec-generations/retry-batch')
      .send({
        bookOfWorkId: 'book-1',
        workItemIds: ['wi-1', 'wi-2'],
      });

    expect(res.status).toBe(200);
    expect(res.body.persistedCount).toBe(2);
    expect(res.body.summary.generated).toBe(2);
    expect(mockRunBatch).toHaveBeenCalledTimes(1);
    expect(mockRunBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'p-1',
        bookOfWorkId: 'book-1',
        regenerateAll: true,
        targetWorkItemIds: ['wi-1', 'wi-2'],
      }),
      expect.objectContaining({
        fetchProjectConfig: expect.any(Function),
        autoSeedEpicCapturedDecision: expect.any(Function),
        // 2026-08-15: the retry-batch path must carry the confirmed-manifest
        // seed source. Without it the scaffold story regenerates to a FALSE
        // insufficient_context (the handler treats an unwired source as a
        // deliberate no-op) — the "Ready to retry" card would disagree with
        // the drawer Regenerate on the exact same story.
        seedBuildFilesSource: expect.any(Function),
      }),
    );
    // Crucially, the gateway must NEVER call the AMS retry-batch endpoint --
    // that endpoint returns 501 by design. The only fetch (if any) would be
    // through the cost-preview helper, which we mocked.
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Test 4: retry-batch >=5 stories returns requiresConfirmation
// ---------------------------------------------------------------------------

describe('POST /api/projects/:projectId/spec-generations/retry-batch (threshold gate)', () => {
  it('returns requiresConfirmation when workItemIds.length >= 5', async () => {
    mockComputeCostPreview.mockResolvedValueOnce(emptyCostPreview(20_000));

    const res = await request(createTestApp())
      .post('/api/projects/p-1/spec-generations/retry-batch')
      .send({
        bookOfWorkId: 'book-1',
        workItemIds: ['wi-1', 'wi-2', 'wi-3', 'wi-4', 'wi-5'],
      });

    expect(res.status).toBe(200);
    expect(res.body.requiresConfirmation).toBe(true);
    expect(res.body.threshold).toBe('5_stories_or_50k_tokens');
    expect(res.body.costPreview).toEqual(
      expect.objectContaining({
        estimatedTokens: 20_000,
      }),
    );
    expect(mockComputeCostPreview).toHaveBeenCalledTimes(1);
    expect(mockRunBatch).not.toHaveBeenCalled();
  });

  it('returns requiresConfirmation when estimatedTokens > 50000 even with a small batch', async () => {
    // 2 stories (under the count threshold) but the token estimate exceeds
    // the 50k cap -- gate MUST still fire.
    mockComputeCostPreview.mockResolvedValueOnce(emptyCostPreview(60_000));

    const res = await request(createTestApp())
      .post('/api/projects/p-1/spec-generations/retry-batch')
      .send({
        bookOfWorkId: 'book-1',
        workItemIds: ['wi-1', 'wi-2'],
      });

    expect(res.status).toBe(200);
    expect(res.body.requiresConfirmation).toBe(true);
    expect(res.body.threshold).toBe('5_stories_or_50k_tokens');
    expect(res.body.costPreview.estimatedTokens).toBe(60_000);
    expect(mockRunBatch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Test 5: retry-batch with confirmed:true skips the gate
// ---------------------------------------------------------------------------

describe('POST /api/projects/:projectId/spec-generations/retry-batch (confirmed)', () => {
  it('runs the batch handler regardless of count when confirmed=true', async () => {
    // Even if the cost preview WOULD trigger the gate, the confirmed flag
    // should short-circuit it. We don't bother mocking the preview helper
    // because the route must not invoke it in this branch.
    mockRunBatch.mockResolvedValueOnce({
      ...emptyBatchResult(),
      persistedCount: 10,
      summary: { ...emptyBatchResult().summary, generated: 10 },
    });

    const res = await request(createTestApp())
      .post('/api/projects/p-1/spec-generations/retry-batch')
      .send({
        bookOfWorkId: 'book-1',
        workItemIds: [
          'wi-1',
          'wi-2',
          'wi-3',
          'wi-4',
          'wi-5',
          'wi-6',
          'wi-7',
          'wi-8',
          'wi-9',
          'wi-10',
        ],
        confirmed: true,
      });

    expect(res.status).toBe(200);
    expect(res.body.persistedCount).toBe(10);
    expect(mockComputeCostPreview).not.toHaveBeenCalled();
    expect(mockRunBatch).toHaveBeenCalledTimes(1);
    expect(mockRunBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'p-1',
        bookOfWorkId: 'book-1',
        regenerateAll: true,
        targetWorkItemIds: expect.arrayContaining([
          'wi-1',
          'wi-10',
        ]),
      }),
      expect.objectContaining({
        fetchProjectConfig: expect.any(Function),
        autoSeedEpicCapturedDecision: expect.any(Function),
        seedBuildFilesSource: expect.any(Function),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Test 6: AMS retry-batch 501 envelope is NEVER exposed
// ---------------------------------------------------------------------------

describe('AMS retry-batch 501 is intercepted by the gateway', () => {
  it('does not surface the AMS 501 envelope; gateway runs the local handler instead', async () => {
    // This test guards the documented design choice: the AMS retry-batch
    // endpoint returns 501 with a structured "use gateway" envelope (see
    // SpecGenerationRetryController.java). If a future refactor accidentally
    // proxied the call through to AMS, this test would fail because the
    // mocked fetch would emit the 501 envelope verbatim.
    //
    // Wiring: arrange for the mock fetch to return 501 (with the AMS
    // envelope) if it were called, AND arrange the batch handler to succeed.
    // The route MUST hit the batch handler and never the fetch.
    mockComputeCostPreview.mockResolvedValueOnce(emptyCostPreview(10_000));
    mockRunBatch.mockResolvedValueOnce({
      ...emptyBatchResult(),
      persistedCount: 1,
      summary: { ...emptyBatchResult().summary, generated: 1 },
    });
    mockFetch.mockResolvedValue({
      ok: false,
      status: 501,
      statusText: 'Not Implemented',
      headers: {
        get: (k: string) =>
          k.toLowerCase() === 'content-type' ? 'application/json' : null,
      },
      text: async () =>
        JSON.stringify({
          status: 501,
          error: 'Not Implemented',
          code: 'use_gateway',
          message: 'Retry orchestration lives at the gateway',
        }),
    });

    const res = await request(createTestApp())
      .post('/api/projects/p-1/spec-generations/retry-batch')
      .send({
        bookOfWorkId: 'book-1',
        workItemIds: ['wi-1'],
      });

    expect(res.status).toBe(200);
    expect(res.body.persistedCount).toBe(1);
    // The CRITICAL assertion: no fetch ever happens against the AMS
    // retry-batch endpoint. The cost-preview helper is mocked, the batch
    // handler is mocked, so a real fetch call is a regression.
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Test 7: input validation
// ---------------------------------------------------------------------------

describe('POST /api/projects/:projectId/spec-generations/retry-batch (validation)', () => {
  it('returns 400 when bookOfWorkId is missing', async () => {
    const res = await request(createTestApp())
      .post('/api/projects/p-1/spec-generations/retry-batch')
      .send({ workItemIds: ['wi-1'] });
    expect(res.status).toBe(400);
    expect(mockRunBatch).not.toHaveBeenCalled();
  });

  it('returns 400 when workItemIds is empty', async () => {
    const res = await request(createTestApp())
      .post('/api/projects/p-1/spec-generations/retry-batch')
      .send({ bookOfWorkId: 'book-1', workItemIds: [] });
    expect(res.status).toBe(400);
    expect(mockRunBatch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Test 8: PARITY -- gateway hasher matches AMS hasher byte-for-byte
// ---------------------------------------------------------------------------
//
// The expected hex values below are computed against the AMS algorithm
// (SHA-256 of `<type>|<canonical descriptor>` truncated to 16 hex chars).
// If either side's algorithm or canonical-descriptor shape drifts, the
// expected literals will no longer match and this test will fail loudly --
// which is exactly the signal we want, because the cross-story matcher
// depends on the two sides producing IDENTICAL keys.

describe('PARITY: gateway hasher matches AMS hasher for canonical inputs', () => {
  it('api_contract: gateway hash matches the known AMS hash for ("PaymentsService","createPayment")', () => {
    const descriptor = canonicalDescriptorForApiContract(
      'PaymentsService',
      'createPayment',
    );
    // Canonical descriptor lowercased + trimmed by the helper.
    expect(descriptor).toBe('paymentsservice:createpayment');

    const key = computeKey('api_contract', descriptor);
    // Pre-image: "api_contract|paymentsservice:createpayment"
    // SHA-256 first 16 hex chars (computed via the same node crypto pipeline
    // as the gateway helper; AMS computes the identical bytes via Java
    // MessageDigest.getInstance("SHA-256")).
    expect(key).toBe('509f93263c360e6a');
    expect(key).toMatch(/^[0-9a-f]{16}$/);
  });

  it('mapping: gateway hash matches the known AMS hash for two canonical UUIDs', () => {
    const descriptor = canonicalDescriptorForMapping(
      '11111111-2222-3333-4444-555555555555',
      'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    );
    expect(descriptor).toBe(
      '11111111-2222-3333-4444-555555555555->aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    );
    const key = computeKey('mapping', descriptor);
    expect(key).toBe('17269b9cdfe8e831');
  });

  it('target_element: gateway hash matches the known AMS hash for "customer-orders-service"', () => {
    const descriptor = canonicalDescriptorForArchElement(
      'Customer-Orders-Service',
    );
    expect(descriptor).toBe('customer-orders-service');
    const key = computeKey('target_element', descriptor);
    expect(key).toBe('356dde0c82174ab5');
  });

  it('case-insensitive + whitespace-trim parity: descriptor variants hash to the same key', () => {
    // Mirrors the AMS test contract: the same logical input in different
    // case + whitespace MUST hash identically. This is what makes upload-time
    // matching against emit-time keys work in practice.
    const a = computeKey(
      'api_contract',
      canonicalDescriptorForApiContract('PaymentsService', 'createPayment'),
    );
    const b = computeKey(
      'api_contract',
      canonicalDescriptorForApiContract('  paymentsservice  ', '\tCREATEPAYMENT\n'),
    );
    expect(a).toBe(b);
  });
});
