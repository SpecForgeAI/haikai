/**
 * Cross-layer strategic tests for the parse-files multipart proxy route.
 *
 * Spec: 2026-05-20 Bulk-Resolve OAS/WSDL Parser -- Task Group 8.
 *
 * Two tests filling genuine cross-layer gaps NOT covered by the per-layer
 * focused tests in Task Groups 1-7:
 *
 *   1. `?commit=true` query string forwarded verbatim to AMS even when the
 *      caller posts NO `commit` form field. The existing Task 5 tests only
 *      cover commit-as-form-field; the spec also calls out query-string
 *      forwarding as a parity contract because AMS accepts either binding.
 *
 *   2. Per-file failure isolation pass-through: when the AMS response carries
 *      one PARSED file and one FAILED sibling, the proxy returns the body
 *      verbatim WITHOUT collapsing or re-ordering the per-file array. This
 *      proves the "sibling-file isolation" guarantee survives the proxy
 *      boundary.
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

// Stub the heavy collaborators the router imports for OTHER routes -- they
// aren't used by parse-files but importing the router pulls them in.
jest.mock('../services/migrationShapeSpecGenerationHandler', () => {
  const actual = jest.requireActual(
    '../services/migrationShapeSpecGenerationHandler',
  );
  return {
    ...actual,
    runShapeSpecGenerationBatch: jest.fn(),
  };
});

jest.mock('../services/migrationShapeSpecCostPreview', () => {
  const actual = jest.requireActual(
    '../services/migrationShapeSpecCostPreview',
  );
  return {
    ...actual,
    computeCostPreview: jest.fn(),
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
import { missingInputResolutionsRouter } from '../routes/missingInputResolutions';

function createTestApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use((req, _res, next) => {
    (req as unknown as { requestId: string }).requestId =
      'parse-files-cross-layer-test';
    next();
  });
  app.use('/api', missingInputResolutionsRouter);
  return app;
}

function amsOkResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
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
// Test 1: ?commit=true query string forwarded verbatim
// ---------------------------------------------------------------------------

describe('parse-files cross-layer: query-string commit forwarding', () => {
  it('forwards `?commit=true` query string verbatim to AMS even when no form field is posted', async () => {
    mockFetch.mockResolvedValueOnce(
      amsOkResponse({
        files: [],
        summary: {
          totalOperations: 0,
          matched: 0,
          alreadyResolved: 0,
          noMatch: 0,
          willCreateResolutions: 0,
          affectedSpecCount: 0,
        },
        previewOnly: false,
      }),
    );

    // POST with the commit flag ONLY in the query string -- no form field.
    await request(createTestApp())
      .post(
        '/api/projects/p-1/missing-input-resolutions/parse-files?commit=true',
      )
      .attach('files', Buffer.from('openapi: 3.0.0'), 'a.yaml');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [calledUrl] = mockFetch.mock.calls[0] as [string, RequestInit];

    // The AMS URL must carry the same `?commit=true` query string. AMS's
    // @RequestParam binding reads from query OR form so either path works,
    // but the gateway must NOT silently drop the query string.
    expect(calledUrl).toBe(
      'http://localhost:8080/api/projects/p-1/missing-input-resolutions/parse-files?commit=true',
    );
  });
});

// ---------------------------------------------------------------------------
// Test 2: Per-file failure isolation pass-through
// ---------------------------------------------------------------------------

describe('parse-files cross-layer: sibling-file failure isolation', () => {
  it('returns the AMS files[] array verbatim when one file is PARSED and one is FAILED', async () => {
    // AMS reports two files: one PARSED with one matched op, one FAILED
    // due to unrecognised format. The proxy must NOT collapse or re-order
    // the per-file array -- the frontend depends on positional ordering
    // to render per-file panels in upload order.
    const amsPayload = {
      files: [
        {
          fileName: 'orders.yaml',
          fileSize: 100,
          format: 'oas_3_0',
          status: 'PARSED',
          failureReason: null,
          suggestedServiceName: 'orders api',
          finalServiceName: 'orders api',
          operations: [
            {
              identifier: 'placeorder',
              missingInputKey: 'abc123def4567890',
              status: 'MATCHED',
              matchedSpecIds: ['spec-1'],
              existingResolutionId: null,
            },
          ],
        },
        {
          fileName: 'garbage.txt',
          fileSize: 50,
          format: null,
          status: 'FAILED',
          failureReason: 'unrecognised_contract_format',
          suggestedServiceName: null,
          finalServiceName: null,
          operations: [],
        },
      ],
      summary: {
        totalOperations: 1,
        matched: 1,
        alreadyResolved: 0,
        noMatch: 0,
        willCreateResolutions: 1,
        affectedSpecCount: 1,
      },
      previewOnly: true,
    };
    mockFetch.mockResolvedValueOnce(amsOkResponse(amsPayload));

    const res = await request(createTestApp())
      .post('/api/projects/p-1/missing-input-resolutions/parse-files')
      .attach('files', Buffer.from('openapi: 3.0.0'), 'orders.yaml')
      .attach('files', Buffer.from('plain text'), 'garbage.txt');

    expect(res.status).toBe(200);
    // CRITICAL: the per-file array round-trips byte-for-byte; the proxy
    // does NOT filter, re-order, or re-shape any of the entries.
    expect(res.body).toEqual(amsPayload);
    expect(res.body.files).toHaveLength(2);
    expect(res.body.files[0].status).toBe('PARSED');
    expect(res.body.files[1].status).toBe('FAILED');
    expect(res.body.files[1].failureReason).toBe('unrecognised_contract_format');
  });
});
