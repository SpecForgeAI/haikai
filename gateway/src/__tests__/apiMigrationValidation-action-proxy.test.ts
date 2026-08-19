/**
 * API Migration Validation Action Proxy Tests
 *
 * Spec: 2026-05-15 API Behaviour Baseline Capture Service -- Task Group 6
 * sub-task 6.1.
 * Spec: 2026-05-17 SOAP LLM Extraction and Payload Enrichment Phase 2
 * Task Group 6 -- adds the `/extract-endpoints` forwarding assertion.
 *
 * Test inventory (2 tests, focused on URL forwarding for action proxies):
 *   1. POST .../api-behaviour/capture-sessions/:sessionId/start forwards
 *      `:projectId`, `:architectureId`, and `:sessionId` to the
 *      api-migration-validation-service URL with projectId + architectureId
 *      injected as query params (the new service's action routes don't carry
 *      them in the path -- the gateway moves them to the query string,
 *      mirroring the AMS CRUD proxy pattern).
 *   2. POST .../api-behaviour/capture-sessions/:sessionId/extract-endpoints
 *      forwards the same URL safety segments + the JSON body verbatim to
 *      the new service's Workstream A "Extract endpoints with LLM" route.
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
import { apiMigrationValidationRouter } from '../routes/apiMigrationValidation';

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Accepted',
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
    (req as any).requestId = 'api-migration-validation-action-test';
    next();
  });
  app.use('/api/v1', apiMigrationValidationRouter);
  return app;
}

beforeEach(() => {
  mockFetch.mockReset();
});

// ---------------------------------------------------------------------------
// Test 1: POST .../start forwards URL safety segments to the new service.
// ---------------------------------------------------------------------------
test('POST /capture-sessions/:sessionId/start forwards URL params + body to the new service', async () => {
  const projectId = 'proj-abc';
  const architectureId = 'arch-xyz';
  const sessionId = 'sess-42';

  // The new service returns the running session row on a 202.
  const startedSession = {
    id: sessionId,
    project_id: projectId,
    architecture_id: architectureId,
    status: 'running',
    started_at: new Date().toISOString(),
  };
  mockFetch.mockResolvedValueOnce(jsonResponse(202, startedSession));

  const app = createTestApp();
  const res = await request(app)
    .post(
      `/api/v1/projects/${projectId}/architectures/${architectureId}` +
        `/api-behaviour/capture-sessions/${sessionId}/start`,
    )
    .send({ confirm: true });

  expect(res.status).toBe(202);
  expect(res.body).toEqual(startedSession);

  // EXACTLY one upstream call -- thin pass-through.
  expect(mockFetch).toHaveBeenCalledTimes(1);
  const [calledUrl, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit];
  const u = new URL(calledUrl);
  expect(`${u.origin}${u.pathname}`).toBe(
    `http://localhost:8092/api-migration-validation/api/capture-sessions/${sessionId}/start`,
  );
  // projectId + architectureId travel as query params (the new service's
  // action routes don't carry them in the path).
  expect(u.searchParams.get('projectId')).toBe(projectId);
  expect(u.searchParams.get('architectureId')).toBe(architectureId);
  expect(calledInit.method).toBe('POST');
  expect(calledInit.headers).toEqual({
    'Content-Type': 'application/json',
    Accept: 'application/json',
  });
  expect(calledInit.body).toBe(JSON.stringify({ confirm: true }));
});

// ---------------------------------------------------------------------------
// Test 2: POST .../extract-endpoints forwards transparently to AMVS.
//
// Spec 2026-05-17 SOAP LLM Extraction Phase 2 -- Task Group 6 adds the
// Workstream A "Extract endpoints with LLM" Step 4 button. The gateway is a
// thin proxy -- same shape as the other six action endpoints. This test
// pins the URL forwarding contract so the new action stays discoverable as
// the proxy list grows.
// ---------------------------------------------------------------------------
test('POST /capture-sessions/:sessionId/extract-endpoints forwards URL params + body to the new service', async () => {
  const projectId = 'proj-abc';
  const architectureId = 'arch-xyz';
  const sessionId = 'sess-42';
  const interfaceId = 'iface-soap-1';
  const discoveryRunId = 'run-xyz-1';

  // Mirror the AMVS happy-path wire shape (status='ok' + operations[]).
  const upstreamBody = {
    sessionId,
    status: 'ok',
    operations: [
      {
        operationName: 'getAccount',
        soapAction: 'urn:GetAccount',
        confidence: 0.9,
        confidence_tier: 'default',
      },
    ],
    warnings: [],
  };
  mockFetch.mockResolvedValueOnce(jsonResponse(200, upstreamBody));

  const app = createTestApp();
  const res = await request(app)
    .post(
      `/api/v1/projects/${projectId}/architectures/${architectureId}` +
        `/api-behaviour/capture-sessions/${sessionId}/extract-endpoints`,
    )
    .send({ interfaceId, discoveryRunId });

  expect(res.status).toBe(200);
  expect(res.body).toEqual(upstreamBody);

  // EXACTLY one upstream call -- thin pass-through, same posture as the
  // other six action proxies.
  expect(mockFetch).toHaveBeenCalledTimes(1);
  const [calledUrl, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit];
  const u = new URL(calledUrl);
  expect(`${u.origin}${u.pathname}`).toBe(
    `http://localhost:8092/api-migration-validation/api/capture-sessions/${sessionId}/extract-endpoints`,
  );
  // projectId + architectureId still travel as query params; the action
  // route reads them off there (mirrors `/start`).
  expect(u.searchParams.get('projectId')).toBe(projectId);
  expect(u.searchParams.get('architectureId')).toBe(architectureId);
  expect(calledInit.method).toBe('POST');
  expect(calledInit.headers).toEqual({
    'Content-Type': 'application/json',
    Accept: 'application/json',
  });
  expect(calledInit.body).toBe(JSON.stringify({ interfaceId, discoveryRunId }));
});


// ---------------------------------------------------------------------------
// Test 3: POST .../parse-oas with a WADL + sibling XSD multipart body forwards
// BOTH parts under the `file` field to the new service.
//
// Spec 2026-06-03 (OAS-YAML + WADL/XSD Contract Support): the wizard may upload
// a WADL together with one-or-more `.xsd` grammar files in a single multipart
// request. The gateway proxy (multer `.array('file')`) must rebuild the body
// forwarding EVERY part -- dropping a grammar would strip the body field types.
// ---------------------------------------------------------------------------
test('POST /capture-sessions/:sessionId/parse-oas forwards every multipart file part (WADL + XSD)', async () => {
  const projectId = 'proj-abc';
  const architectureId = 'arch-xyz';
  const sessionId = 'sess-42';

  mockFetch.mockResolvedValueOnce(
    jsonResponse(200, { sessionId, operationCount: 2, title: 'DemoApp', version: '1.0' }),
  );

  const app = createTestApp();
  const res = await request(app)
    .post(
      `/api/v1/projects/${projectId}/architectures/${architectureId}` +
        `/api-behaviour/capture-sessions/${sessionId}/parse-oas`,
    )
    .attach('file', Buffer.from('<application/>', 'utf8'), 'demo.wadl')
    .attach('file', Buffer.from('<xs:schema/>', 'utf8'), 'demo-types.xsd');

  expect(res.status).toBe(200);

  // EXACTLY one upstream call; URL carries the safety segments as query params.
  expect(mockFetch).toHaveBeenCalledTimes(1);
  const [calledUrl, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit];
  const u = new URL(calledUrl);
  expect(`${u.origin}${u.pathname}`).toBe(
    `http://localhost:8092/api-migration-validation/api/capture-sessions/${sessionId}/parse-oas`,
  );
  expect(u.searchParams.get('projectId')).toBe(projectId);
  expect(u.searchParams.get('architectureId')).toBe(architectureId);

  // The rebuilt body is a multipart FormData carrying BOTH file parts under
  // the `file` field. We read them back off the forwarded FormData.
  const fd = calledInit.body as unknown as FormData;
  expect(typeof (fd as { getAll?: unknown }).getAll).toBe('function');
  const parts = fd.getAll('file');
  expect(parts).toHaveLength(2);
  // Each part is a Blob/File-like with the original filename preserved.
  const names = parts
    .map((p) => (p as { name?: string }).name)
    .filter((n): n is string => typeof n === 'string')
    .sort();
  expect(names).toEqual(['demo-types.xsd', 'demo.wadl']);
});

// ---------------------------------------------------------------------------
// Test 4: GET .../compensation-preflight forwards as a READ (no body) and
// returns the validation service's warning payload verbatim.
//
// CSD Spec 3 gap fix (2026-08-19): the pre-start compensation preflight is
// the wizard's warning surface for write endpoints with no effect-table map;
// unlike the twelve POST actions it proxies as a GET.
// ---------------------------------------------------------------------------
test('GET /capture-sessions/:sessionId/compensation-preflight forwards a bodiless GET', async () => {
  const projectId = 'proj-abc';
  const architectureId = 'arch-xyz';
  const sessionId = 'sess-42';

  const preflight = {
    session_id: sessionId,
    model_resolvable: true,
    write_endpoints_without_effect_map: ['DELETE /orders/{id}', 'POST /orders'],
    note: '2 write endpoint(s) will be REFUSED at capture time',
  };
  mockFetch.mockResolvedValueOnce(jsonResponse(200, preflight));

  const app = createTestApp();
  const res = await request(app).get(
    `/api/v1/projects/${projectId}/architectures/${architectureId}` +
      `/api-behaviour/capture-sessions/${sessionId}/compensation-preflight`,
  );

  expect(res.status).toBe(200);
  expect(res.body).toEqual(preflight);

  expect(mockFetch).toHaveBeenCalledTimes(1);
  const [calledUrl, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit];
  const u = new URL(calledUrl);
  expect(`${u.origin}${u.pathname}`).toBe(
    'http://localhost:8092/api-migration-validation/api/capture-sessions/sess-42/compensation-preflight',
  );
  expect(u.searchParams.get('projectId')).toBe(projectId);
  expect(u.searchParams.get('architectureId')).toBe(architectureId);
  expect(calledInit.method).toBe('GET');
  expect(calledInit.body).toBeUndefined();
});
