/**
 * Missing Input Resolutions parse-files multipart proxy route tests.
 *
 * Spec: 2026-05-20 Bulk-Resolve OAS/WSDL Parser -- Task Group 5.
 *
 * Five focused tests (per tasks.md 5.1):
 *
 *   1. Single-file multipart upload is forwarded verbatim to AMS at the
 *      same path; the AMS response body + status round-trips unchanged.
 *   2. Multiple files in one request are forwarded as multiple `files`
 *      parts (AMS sees the same number of parts the caller sent).
 *   3. `serviceNames[]` positional form fields are forwarded so AMS's
 *      positional `@RequestParam List<String>` binding sees the same
 *      ordering the caller supplied.
 *   4. `commit=true` form field is forwarded; the proxy never interprets
 *      it locally (AMS owns persistence semantics).
 *   5. AMS error responses (4xx/5xx) round-trip the status code + body
 *      back to the caller without transformation.
 *   6. `X-User-Id` header from the caller is forwarded to AMS so the
 *      audit channel sees the originating user.
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
  // No JSON body parser on the parse-files path -- the proxy uses multer to
  // handle multipart. The router also handles JSON routes; we still mount the
  // global JSON parser so the OTHER routes (single-create, bulk) keep working,
  // but multer runs first on the multipart pipeline so this is harmless.
  app.use(express.json({ limit: '1mb' }));
  app.use((req, _res, next) => {
    (req as unknown as { requestId: string }).requestId = 'parse-files-test';
    next();
  });
  app.use('/api', missingInputResolutionsRouter);
  return app;
}

/**
 * Build a successful AMS response stub.
 *
 * The handler under test reads `.text()` and forwards content-type from
 * `headers.get('content-type')`. Mirror that surface here.
 */
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
  jest.resetAllMocks();
});

// ---------------------------------------------------------------------------
// Test 1: single-file upload forwarded verbatim, AMS response round-tripped
// ---------------------------------------------------------------------------

describe('POST /api/projects/:projectId/missing-input-resolutions/parse-files (proxy)', () => {
  it('forwards a single-file multipart upload to AMS and round-trips status + body', async () => {
    const amsPayload = {
      files: [
        {
          filename: 'orders.yaml',
          format: 'oas_3_0',
          status: 'parsed',
          operations: [
            {
              identifier: 'createorder',
              status: 'matched',
              missingInputKey: 'aaaaaaaaaaaaaaaa',
              matchedSpecCount: 1,
            },
          ],
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
      .attach('files', Buffer.from('openapi: 3.0.0\ninfo:\n  title: Orders'), {
        filename: 'orders.yaml',
        contentType: 'application/yaml',
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(amsPayload);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Verify the URL matches AMS verbatim at the same path.
    const [calledUrl, calledInit] = mockFetch.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(calledUrl).toBe(
      'http://localhost:8080/api/projects/p-1/missing-input-resolutions/parse-files',
    );
    expect(calledInit.method).toBe('POST');

    // The body MUST be a FormData (browser/Node global) -- the proxy
    // intentionally hands a FormData to fetch so the boundary header is set
    // automatically. Stringifying / hashing it isn't useful here; the shape
    // assertion is enough.
    expect(calledInit.body).toBeInstanceOf(FormData);
  });
});

// ---------------------------------------------------------------------------
// Test 2: multiple files forwarded as multiple parts
// ---------------------------------------------------------------------------

describe('parse-files: multi-file upload', () => {
  it('forwards multiple files as multiple multipart parts under the `files` field name', async () => {
    const amsPayload = {
      files: [
        { filename: 'a.yaml', format: 'oas_3_0', status: 'parsed', operations: [] },
        { filename: 'b.wsdl', format: 'wsdl_1_1', status: 'parsed', operations: [] },
        { filename: 'c.yaml', format: 'oas_2_0', status: 'parsed', operations: [] },
      ],
      summary: {
        totalOperations: 0,
        matched: 0,
        alreadyResolved: 0,
        noMatch: 0,
        willCreateResolutions: 0,
        affectedSpecCount: 0,
      },
      previewOnly: true,
    };
    mockFetch.mockResolvedValueOnce(amsOkResponse(amsPayload));

    const res = await request(createTestApp())
      .post('/api/projects/p-1/missing-input-resolutions/parse-files')
      .attach('files', Buffer.from('openapi: 3.0.0'), 'a.yaml')
      .attach('files', Buffer.from('<wsdl:definitions/>'), 'b.wsdl')
      .attach('files', Buffer.from("swagger: '2.0'"), 'c.yaml');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(amsPayload);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(calledInit.body).toBeInstanceOf(FormData);

    // The constructed FormData should carry 3 `files` entries. We can
    // enumerate it because FormData is iterable on Node 18+.
    const fileEntries: unknown[] = [];
    for (const [k, v] of (calledInit.body as FormData).entries()) {
      if (k === 'files') fileEntries.push(v);
    }
    expect(fileEntries).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// Test 3: serviceNames[] positional form fields forwarded
// ---------------------------------------------------------------------------

describe('parse-files: serviceNames forwarding', () => {
  it('forwards positional `serviceNames` form fields so AMS sees the same ordering', async () => {
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
        previewOnly: true,
      }),
    );

    await request(createTestApp())
      .post('/api/projects/p-1/missing-input-resolutions/parse-files')
      .field('serviceNames', 'orders-service')
      .field('serviceNames', 'payments-service')
      .attach('files', Buffer.from('openapi: 3.0.0'), 'a.yaml')
      .attach('files', Buffer.from('openapi: 3.0.0'), 'b.yaml');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit];
    const fd = calledInit.body as FormData;

    const serviceNames: string[] = [];
    for (const [k, v] of fd.entries()) {
      if (k === 'serviceNames' && typeof v === 'string') {
        serviceNames.push(v);
      }
    }
    expect(serviceNames).toEqual(['orders-service', 'payments-service']);
  });
});

// ---------------------------------------------------------------------------
// Test 4: commit=true form field forwarded verbatim
// ---------------------------------------------------------------------------

describe('parse-files: commit flag forwarding', () => {
  it('forwards `commit=true` as a form field; the proxy never interprets it locally', async () => {
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

    await request(createTestApp())
      .post('/api/projects/p-1/missing-input-resolutions/parse-files')
      .field('commit', 'true')
      .attach('files', Buffer.from('openapi: 3.0.0'), 'a.yaml');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit];
    const fd = calledInit.body as FormData;

    // FormData.get returns the first value for the key as a string.
    expect(fd.get('commit')).toBe('true');
  });
});

// ---------------------------------------------------------------------------
// Test 5: AMS error responses round-trip status + body verbatim
// ---------------------------------------------------------------------------

describe('parse-files: AMS error pass-through', () => {
  it('round-trips a 413 file_size_exceeded envelope from AMS unchanged', async () => {
    const amsErrorBody = {
      error: {
        code: 413,
        message:
          'Total upload size exceeds the per-project cap of 10 MB.',
        details: 'file_size_exceeded',
      },
    };
    mockFetch.mockResolvedValueOnce(amsErrorResponse(413, amsErrorBody));

    const res = await request(createTestApp())
      .post('/api/projects/p-1/missing-input-resolutions/parse-files')
      .attach('files', Buffer.from('openapi: 3.0.0'), 'oversize.yaml');

    expect(res.status).toBe(413);
    expect(res.body).toEqual(amsErrorBody);
  });

  it('round-trips a 500 envelope from AMS unchanged', async () => {
    const amsErrorBody = {
      error: { code: 500, message: 'Unexpected server error', details: 'boom' },
    };
    mockFetch.mockResolvedValueOnce(amsErrorResponse(500, amsErrorBody));

    const res = await request(createTestApp())
      .post('/api/projects/p-1/missing-input-resolutions/parse-files')
      .attach('files', Buffer.from('openapi: 3.0.0'), 'a.yaml');

    expect(res.status).toBe(500);
    expect(res.body).toEqual(amsErrorBody);
  });
});

// ---------------------------------------------------------------------------
// Test 6: X-User-Id header forwarded
// ---------------------------------------------------------------------------

describe('parse-files: X-User-Id forwarding', () => {
  it('forwards the X-User-Id header to AMS for the audit channel', async () => {
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
        previewOnly: true,
      }),
    );

    await request(createTestApp())
      .post('/api/projects/p-1/missing-input-resolutions/parse-files')
      .set('X-User-Id', 'user-bob')
      .attach('files', Buffer.from('openapi: 3.0.0'), 'a.yaml');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = (calledInit.headers || {}) as Record<string, string>;
    expect(headers['X-User-Id']).toBe('user-bob');
  });
});
