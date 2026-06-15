/**
 * Gateway proxies + handler flag pass-through for the In-Product Spec
 * Editor + Confirm-Overwrite feature.
 *
 * Spec: 2026-05-20 In-Product Spec Editor + Confirm-Overwrite -- Task Group 5.
 *
 * Focused tests (per tasks.md 5.1):
 *
 *   1. POST .../spec-generations/:specId/manual-edit forwards POST to AMS
 *      with X-User-Id header + body and round-trips status + body.
 *   2. Manual-edit proxy round-trips a 200 + DTO body verbatim.
 *   3. Manual-edit proxy round-trips a 404 envelope from AMS unchanged.
 *   4. GET .../spec-generations/manually-edited-in-scope forwards GET
 *      including the optional ?workItemIds query (multi-value).
 *   5. runShapeSpecGenerationBatch with manually-edited rows + no allow-list
 *      skips them and surfaces skippedManuallyEditedWorkItemIds.
 *   6. runShapeSpecGenerationBatch with allow-listed manually-edited row
 *      pre-clears the flag (calls AMS regenerate?overwriteManuallyEdited=true)
 *      and proceeds with the batch.
 *   7. Retry-batch route forwards overwriteManuallyEdited +
 *      manuallyEditedWorkItemIdsToOverwrite to the batch handler.
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

// Stub the cross-story config + auto-seed deps so the route file imports
// cleanly without standing up the real LLM pipeline.
jest.mock('../services/architectureModelClient', () => ({
  fetchProjectConfigWithDefaults: jest.fn(),
  DEFAULT_PER_STORY_TOKEN_CAP: 24000,
  DEFAULT_CROSS_STORY_TOKEN_CAP: 12000,
  DEFAULT_AUTO_RUN_PASS_2: false,
}));

jest.mock('../services/epicCapturedDecisionsClient', () => ({
  autoSeedEpicCapturedDecision: jest.fn(),
}));

// Mock the cost-preview computer for the retry-batch route. We set the
// estimated tokens low so the gate does not require confirmation.
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

// Mock the batch handler for the route-layer flag-pass-through tests so we
// can assert the call args without running the full per-story loop. The
// HANDLER-layer tests (5/6 below) import the real implementation directly
// and inject deps via the function parameter.
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

const mockFetch = jest.fn();
(global as unknown as { fetch: typeof mockFetch }).fetch = mockFetch;

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import express from 'express';
import request from 'supertest';
import { migrationShapeSpecGenerationRouter } from '../routes/migrationShapeSpecGeneration';
import { missingInputResolutionsRouter } from '../routes/missingInputResolutions';

// Import the REAL handler module to exercise applyManuallyEditedPreFlight in
// tests 5 and 6. Because jest.mock above replaces the module's exports, we
// import the actual implementation via jest.requireActual.
const realHandler = jest.requireActual(
  '../services/migrationShapeSpecGenerationHandler',
) as typeof import('../services/migrationShapeSpecGenerationHandler');

function createTestApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use((req, _res, next) => {
    (req as unknown as { requestId: string }).requestId =
      'manual-edit-test';
    next();
  });
  app.use('/api/v1', migrationShapeSpecGenerationRouter);
  app.use('/api', missingInputResolutionsRouter);
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
  if (typeof realHandler.__resetWorkstreamLocksForTests === 'function') {
    realHandler.__resetWorkstreamLocksForTests();
  }
});

// ---------------------------------------------------------------------------
// Test 1: manual-edit proxy forwards POST + X-User-Id + body
// ---------------------------------------------------------------------------

describe('POST /api/v1/projects/:projectId/spec-generations/:specId/manual-edit (proxy)', () => {
  it('forwards POST to AMS with the X-User-Id header and body', async () => {
    const amsPayload = {
      id: 'spec-42',
      projectId: 'p-1',
      workItemId: 'wi-1',
      generatedSpecText: '/agent-os:shape-spec ...',
      manuallyEdited: true,
      lastManuallyEditedBy: 'user-alice',
      lastManuallyEditedAt: '2026-05-20T12:00:00Z',
    };
    mockFetch.mockResolvedValueOnce(amsOkResponse(amsPayload));

    const res = await request(createTestApp())
      .post('/api/v1/projects/p-1/spec-generations/spec-42/manual-edit')
      .set('X-User-Id', 'user-alice')
      .send({ specText: '/agent-os:shape-spec\nrewritten' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(amsPayload);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = mockFetch.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(calledUrl).toBe(
      'http://localhost:8080/api/projects/p-1/spec-generations/spec-42/manual-edit',
    );
    expect(calledInit.method).toBe('POST');
    const headers = (calledInit.headers || {}) as Record<string, string>;
    expect(headers['X-User-Id']).toBe('user-alice');
    expect(headers['Content-Type']).toBe('application/json');
    // Body forwarded verbatim.
    expect(JSON.parse(calledInit.body as string)).toEqual({
      specText: '/agent-os:shape-spec\nrewritten',
    });
  });
});

// ---------------------------------------------------------------------------
// Test 2: manual-edit proxy round-trips 200 + body verbatim
// ---------------------------------------------------------------------------

describe('manual-edit proxy: 200 round-trip', () => {
  it('returns the AMS 200 body verbatim with no X-User-Id when absent', async () => {
    const dto = { id: 'spec-1', manuallyEdited: true };
    mockFetch.mockResolvedValueOnce(amsOkResponse(dto));

    const res = await request(createTestApp())
      .post('/api/v1/projects/p-1/spec-generations/spec-1/manual-edit')
      .send({ specText: 'new text' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(dto);
    const [, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = (calledInit.headers || {}) as Record<string, string>;
    // No caller X-User-Id -> none forwarded.
    expect(headers['X-User-Id']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Test 3: manual-edit proxy round-trips 404
// ---------------------------------------------------------------------------

describe('manual-edit proxy: 404 round-trip', () => {
  it('returns the AMS 404 envelope unchanged when spec is unknown / cross-project', async () => {
    const amsErrorBody = {
      error: { code: 404, message: 'Spec generation not found.' },
    };
    mockFetch.mockResolvedValueOnce(amsErrorResponse(404, amsErrorBody));

    const res = await request(createTestApp())
      .post('/api/v1/projects/p-1/spec-generations/missing/manual-edit')
      .send({ specText: 'x' });

    expect(res.status).toBe(404);
    expect(res.body).toEqual(amsErrorBody);
  });
});

// ---------------------------------------------------------------------------
// Test 4: manually-edited-in-scope proxy forwards GET + ?workItemIds query
// ---------------------------------------------------------------------------

describe('GET .../spec-generations/manually-edited-in-scope (proxy)', () => {
  it('forwards GET and serialises ?workItemIds repeat-key into the upstream URL', async () => {
    const amsPayload = [
      {
        workItemId: 'wi-1',
        workItemTitle: 'Story 1',
        lastManuallyEditedBy: 'user-alice',
        lastManuallyEditedAt: '2026-05-20T12:00:00Z',
      },
    ];
    mockFetch.mockResolvedValueOnce(amsOkResponse(amsPayload));

    const res = await request(createTestApp())
      .get(
        '/api/v1/projects/p-1/migration-books-of-work/b-1/spec-generations/manually-edited-in-scope?workItemIds=wi-1&workItemIds=wi-2',
      );

    expect(res.status).toBe(200);
    expect(res.body).toEqual(amsPayload);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = mockFetch.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(calledInit.method).toBe('GET');
    // Both workItemIds values are present in the upstream URL.
    expect(calledUrl).toContain(
      'http://localhost:8080/api/projects/p-1/migration-books-of-work/b-1/spec-generations/manually-edited-in-scope',
    );
    expect(calledUrl).toContain('workItemIds=wi-1');
    expect(calledUrl).toContain('workItemIds=wi-2');
  });

  it('forwards GET with no query when the caller omits workItemIds', async () => {
    mockFetch.mockResolvedValueOnce(amsOkResponse([]));

    await request(createTestApp()).get(
      '/api/v1/projects/p-1/migration-books-of-work/b-1/spec-generations/manually-edited-in-scope',
    );

    const [calledUrl] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe(
      'http://localhost:8080/api/projects/p-1/migration-books-of-work/b-1/spec-generations/manually-edited-in-scope',
    );
  });
});

// ---------------------------------------------------------------------------
// Test 5: runShapeSpecGenerationBatch skips manually-edited rows NOT in
// the allow-list and surfaces them in skippedManuallyEditedWorkItemIds.
// ---------------------------------------------------------------------------

describe('runShapeSpecGenerationBatch: manual-edit skip (no allow-list)', () => {
  it('skips manually-edited rows and surfaces them on the result', async () => {
    // Compose a minimal BoW with two story rows. wi-1 is manually-edited;
    // wi-2 is not. With NO allow-list (overwriteManuallyEdited=false), the
    // gateway pre-flight removes wi-1 from the target set and surfaces it
    // in skippedManuallyEditedWorkItemIds.
    const loadBookOfWork = jest.fn().mockResolvedValue({
      bookOfWorkId: 'b-1',
      projectId: 'p-1',
      currentArchitectureId: 'arch-1',
      targetArchitectureId: null,
      items: [
        {
          id: 'S1',
          type: 'story',
          parentId: null,
          title: 'Story 1',
          sequenceOrder: 1,
          workItemId: 'wi-1',
        },
        {
          id: 'S2',
          type: 'story',
          parentId: null,
          title: 'Story 2',
          sequenceOrder: 2,
          workItemId: 'wi-2',
        },
      ],
    });
    const loadExistingGenerations = jest.fn().mockResolvedValue([]);
    const fetchSpecContext = jest.fn().mockResolvedValue({
      missingInputs: [],
    });
    // Minimal LLM stub that returns a valid generated spec for wi-2 only.
    const callLlm = jest.fn().mockResolvedValue({
      content: JSON.stringify({
        status: 'failed',
        confidence: 'low',
        specText: null,
        warnings: [],
        missingInputs: [],
        evidenceRefs: [],
        errorMessage: 'stubbed',
      }),
    });
    const persistBatchResults = jest.fn().mockResolvedValue({
      persistedCount: 0,
      resultsCouldNotPersist: 0,
      perStoryResults: [],
    });
    const fetchManuallyEditedInScope = jest.fn().mockResolvedValue([
      {
        workItemId: 'wi-1',
        workItemTitle: 'Story 1',
        lastManuallyEditedBy: 'user-alice',
        lastManuallyEditedAt: '2026-05-20T12:00:00Z',
        specId: 'spec-wi-1',
      },
    ]);
    const clearManuallyEditedFlag = jest.fn().mockResolvedValue(undefined);

    const result = await realHandler.runShapeSpecGenerationBatch(
      {
        projectId: 'p-1',
        bookOfWorkId: 'b-1',
        // Restrict the batch to wi-1 + wi-2 so the gateway pre-flight has a
        // candidate set to filter against. Without targetWorkItemIds, the
        // pragmatic v1 design leaves the input alone (documented).
        targetWorkItemIds: ['wi-1', 'wi-2'],
        // overwriteManuallyEdited NOT set -> no allow-list, all
        // manually-edited rows are skipped.
        regenerateAll: true,
      },
      {
        loadBookOfWork,
        loadExistingGenerations,
        fetchSpecContext,
        callLlm,
        persistBatchResults,
        systemPromptOverride: 'test-prompt',
        fetchManuallyEditedInScope,
        clearManuallyEditedFlag,
      },
    );

    expect(fetchManuallyEditedInScope).toHaveBeenCalledTimes(1);
    expect(fetchManuallyEditedInScope).toHaveBeenCalledWith(
      'p-1',
      'b-1',
      ['wi-1', 'wi-2'],
    );
    // No allow-list -> the clearer must NOT be called.
    expect(clearManuallyEditedFlag).not.toHaveBeenCalled();
    // Skipped list surfaces wi-1.
    expect(result.skippedManuallyEditedWorkItemIds).toEqual(['wi-1']);
    expect(result.skippedManuallyEditedCount).toBe(1);
    expect(result.skippedManuallyEditedDetails).toEqual([
      {
        workItemId: 'wi-1',
        lastManuallyEditedBy: 'user-alice',
        lastManuallyEditedAt: '2026-05-20T12:00:00Z',
      },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Test 6: runShapeSpecGenerationBatch with allow-list pre-clears the flag.
// ---------------------------------------------------------------------------

describe('runShapeSpecGenerationBatch: manual-edit overwrite (allow-listed)', () => {
  it('pre-clears the manually_edited flag for allow-listed rows', async () => {
    const loadBookOfWork = jest.fn().mockResolvedValue({
      bookOfWorkId: 'b-1',
      projectId: 'p-1',
      currentArchitectureId: 'arch-1',
      targetArchitectureId: null,
      items: [
        {
          id: 'S1',
          type: 'story',
          parentId: null,
          title: 'Story 1',
          sequenceOrder: 1,
          workItemId: 'wi-1',
        },
      ],
    });
    const loadExistingGenerations = jest.fn().mockResolvedValue([]);
    const fetchSpecContext = jest.fn().mockResolvedValue({
      missingInputs: [],
    });
    const callLlm = jest.fn().mockResolvedValue({
      content: JSON.stringify({
        status: 'failed',
        confidence: 'low',
        specText: null,
        warnings: [],
        missingInputs: [],
        evidenceRefs: [],
        errorMessage: 'stubbed',
      }),
    });
    const persistBatchResults = jest.fn().mockResolvedValue({
      persistedCount: 0,
      resultsCouldNotPersist: 0,
      perStoryResults: [],
    });
    const fetchManuallyEditedInScope = jest.fn().mockResolvedValue([
      {
        workItemId: 'wi-1',
        workItemTitle: 'Story 1',
        lastManuallyEditedBy: 'user-alice',
        lastManuallyEditedAt: '2026-05-20T12:00:00Z',
        specId: 'spec-wi-1',
      },
    ]);
    const clearManuallyEditedFlag = jest.fn().mockResolvedValue(undefined);

    const result = await realHandler.runShapeSpecGenerationBatch(
      {
        projectId: 'p-1',
        bookOfWorkId: 'b-1',
        targetWorkItemIds: ['wi-1'],
        regenerateAll: true,
        // Allow-list the row.
        overwriteManuallyEdited: true,
        manuallyEditedWorkItemIdsToOverwrite: ['wi-1'],
      },
      {
        loadBookOfWork,
        loadExistingGenerations,
        fetchSpecContext,
        callLlm,
        persistBatchResults,
        systemPromptOverride: 'test-prompt',
        fetchManuallyEditedInScope,
        clearManuallyEditedFlag,
      },
    );

    // Pre-flight was called.
    expect(fetchManuallyEditedInScope).toHaveBeenCalledWith(
      'p-1',
      'b-1',
      ['wi-1'],
    );
    // Allow-listed row -> clearer called with (projectId, specId).
    expect(clearManuallyEditedFlag).toHaveBeenCalledTimes(1);
    expect(clearManuallyEditedFlag).toHaveBeenCalledWith('p-1', 'spec-wi-1');
    // Nothing skipped.
    expect(result.skippedManuallyEditedWorkItemIds).toEqual([]);
    expect(result.skippedManuallyEditedCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Test 7: Retry-batch route forwards the new flag fields to the handler
// ---------------------------------------------------------------------------

describe('POST /api/projects/:projectId/spec-generations/retry-batch (flag pass-through)', () => {
  it('forwards overwriteManuallyEdited + manuallyEditedWorkItemIdsToOverwrite to the batch handler', async () => {
    mockComputeCostPreview.mockResolvedValueOnce(emptyCostPreview(10_000));
    mockRunBatch.mockResolvedValueOnce({
      ...emptyBatchResult(),
      persistedCount: 1,
      summary: { ...emptyBatchResult().summary, generated: 1 },
      skippedManuallyEditedWorkItemIds: [],
      skippedManuallyEditedCount: 0,
    });

    const res = await request(createTestApp())
      .post('/api/projects/p-1/spec-generations/retry-batch')
      .send({
        bookOfWorkId: 'b-1',
        workItemIds: ['wi-1', 'wi-2'],
        overwriteManuallyEdited: true,
        manuallyEditedWorkItemIdsToOverwrite: ['wi-1'],
      });

    expect(res.status).toBe(200);
    expect(mockRunBatch).toHaveBeenCalledTimes(1);
    expect(mockRunBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'p-1',
        bookOfWorkId: 'b-1',
        regenerateAll: true,
        targetWorkItemIds: ['wi-1', 'wi-2'],
        overwriteManuallyEdited: true,
        manuallyEditedWorkItemIdsToOverwrite: ['wi-1'],
      }),
      expect.any(Object),
    );
  });
});
