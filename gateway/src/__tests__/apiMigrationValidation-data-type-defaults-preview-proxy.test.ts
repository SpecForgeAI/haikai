/**
 * API Migration Validation -- data-type-defaults-preview action proxy test
 *
 * Spec: 2026-06-20 Capture data-type format defaults, Task Group 3.
 *
 * The gateway forwards the new `data-type-defaults-preview` action to the
 * api-migration-validation-service exactly like the other JSON action proxies
 * (start / extract-endpoints / reconcile-inventory / account-endpoints /
 * manual-capture): the existing `for (const action of API_BEHAVIOUR_ACTION_PATHS)`
 * loop registers a JSON proxy for every entry except the multipart `parse-oas`.
 * This test pins:
 *   1. `data-type-defaults-preview` is a member of API_BEHAVIOUR_ACTION_PATHS.
 *   2. A POST to the gateway action path forwards URL safety segments
 *      (projectId + architectureId as query params, sessionId in the path) and
 *      the JSON body VERBATIM to the new service -- a JSON action, NOT multipart
 *      (Content-Type application/json, no FormData / no multer pipeline).
 */

// ---------------------------------------------------------------------------
// Mocks (declared before importing the route under test)
// ---------------------------------------------------------------------------

jest.mock('../config', () => ({
  getConfig: () => ({
    architectureModelServiceBaseUrl: 'http://localhost:8080',
    discoveryServiceBaseUrl: 'http://localhost:8091',
    apiMigrationValidationServiceBaseUrl: 'http://localhost:8092',
    llmProvider: 'openai',
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

jest.mock('../services/llmClient', () => ({
  getLlmClient: () => ({ sendChatRequest: jest.fn() }),
}));

const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import express from 'express';
import request from 'supertest';
import {
  apiMigrationValidationRouter,
  API_BEHAVIOUR_ACTION_PATHS,
} from '../routes/apiMigrationValidation';

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status >= 200 && status < 300 ? 'OK' : 'Error',
    headers: {
      get: (k: string) => (k.toLowerCase() === 'content-type' ? 'application/json' : null),
    },
    json: async () => body,
    text: async () => (body === null || body === undefined ? '' : JSON.stringify(body)),
  };
}

function createTestApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use((req, _res, next) => {
    (req as any).requestId = 'api-migration-validation-data-type-defaults-preview-test';
    next();
  });
  app.use('/api/v1', apiMigrationValidationRouter);
  return app;
}

beforeEach(() => {
  mockFetch.mockReset();
});

test('data-type-defaults-preview is registered in API_BEHAVIOUR_ACTION_PATHS', () => {
  expect(API_BEHAVIOUR_ACTION_PATHS as readonly string[]).toContain(
    'data-type-defaults-preview',
  );
});

test('POST /capture-sessions/:sessionId/data-type-defaults-preview forwards URL params + JSON body to the new service', async () => {
  const projectId = 'proj-abc';
  const architectureId = 'arch-xyz';
  const sessionId = 'sess-91';

  // The new service returns the classified preview rows.
  const previewResponse = {
    rows: [
      {
        category: 'date',
        codeFormats: ['dd-MMM-yyyy'],
        contractFormats: ['date'],
        seed: 'dd-MMM-yyyy',
        contributingFields: [
          { name: 'orderDate', location: 'query', codeFormat: 'dd-MMM-yyyy', contractFormat: null },
        ],
      },
    ],
  };
  mockFetch.mockResolvedValueOnce(jsonResponse(200, previewResponse));

  // Plain JSON body (the preview action takes no file upload).
  const reqBody = {};

  const app = createTestApp();
  const res = await request(app)
    .post(
      `/api/v1/projects/${projectId}/architectures/${architectureId}` +
        `/api-behaviour/capture-sessions/${sessionId}/data-type-defaults-preview`,
    )
    .send(reqBody);

  expect(res.status).toBe(200);
  expect(res.body).toEqual(previewResponse);

  // EXACTLY one upstream call -- thin pass-through, same posture as the other
  // JSON action proxies.
  expect(mockFetch).toHaveBeenCalledTimes(1);
  const [calledUrl, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit];
  const u = new URL(calledUrl);
  expect(`${u.origin}${u.pathname}`).toBe(
    `http://localhost:8092/api-migration-validation/api/capture-sessions/${sessionId}/data-type-defaults-preview`,
  );
  expect(u.searchParams.get('projectId')).toBe(projectId);
  expect(u.searchParams.get('architectureId')).toBe(architectureId);

  // JSON action, NOT multipart: Content-Type application/json + verbatim body.
  expect(calledInit.method).toBe('POST');
  expect(calledInit.headers).toEqual({
    'Content-Type': 'application/json',
    Accept: 'application/json',
  });
  expect(calledInit.body).toBe(JSON.stringify(reqBody));
});
