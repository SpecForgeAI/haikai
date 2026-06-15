/**
 * API Migration Validation -- Findings Proxy Tests
 *
 * Spec: 2026-05-25 API Test Harness -- Findings Integration -- Task Group 3
 * sub-task 3.1.
 *
 * Test inventory (3 tests covering the 2-3 budget):
 *
 *   1. GET /api/v1/projects/:projectId/api-behaviour/diffs/:diffId/findings
 *      forwards verbatim to AMS at the matching path, body passes through.
 *
 *   2. PATCH /api/v1/projects/:projectId/api-behaviour/diffs/:diffId/findings/:findingId
 *      forwards reviewer body verbatim to AMS, response piped back.
 *
 *   3. Typed client wrapper `listDiffFindings` returns the typed DTO shape
 *      with both `run_id` and `api_behaviour_diff_id` nullable to match the
 *      AMS exactly-one-of-origin contract.
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
import {
  listDiffFindings,
  type DiscoveryFindingDto,
} from '../services/apiBehaviourClient';

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText:
      status === 200 ? 'OK' : status === 201 ? 'Created' : status === 404 ? 'Not Found' : 'Error',
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
    (req as any).requestId = 'api-migration-validation-findings-test';
    next();
  });
  app.use('/api/v1', apiMigrationValidationRouter);
  return app;
}

beforeEach(() => {
  mockFetch.mockReset();
});

// ---------------------------------------------------------------------------
// Test 1: GET /findings forwards verbatim to AMS.
//
// The AMS publishes this route at:
//   GET /api/projects/{projectId}/api-behaviour/diffs/{diffId}/findings
// The gateway is a thin pass-through -- response body piped through.
// ---------------------------------------------------------------------------
test('GET /diffs/:diffId/findings forwards verbatim and pipes upstream 200 through', async () => {
  const projectId = 'proj-findings-1';
  const diffId = 'diff-9';

  const findingsList: Array<Partial<DiscoveryFindingDto>> = [
    {
      id: 'finding-1',
      run_id: null,
      api_behaviour_diff_id: diffId,
      project_id: projectId,
      architecture_id: 'arch-1',
      finding_type: 'api_behaviour_status_drift',
      category: 'api_behaviour_drift',
      severity: 'critical',
      status: 'new',
      title: 'Status drift: GET /users responded 200 -> 500',
      summary: 'Server error on target replay',
      created_at: '2026-05-25T10:30:00Z',
      updated_at: '2026-05-25T10:30:00Z',
      reviewed_at: null,
      reviewer_notes: null,
      links: [],
    },
  ];
  mockFetch.mockResolvedValueOnce(jsonResponse(200, findingsList));

  const app = createTestApp();
  const res = await request(app).get(
    `/api/v1/projects/${projectId}/api-behaviour/diffs/${diffId}/findings`,
  );

  expect(res.status).toBe(200);
  expect(res.body).toEqual(findingsList);

  expect(mockFetch).toHaveBeenCalledTimes(1);
  const [calledUrl, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit];
  const u = new URL(calledUrl);
  expect(`${u.origin}${u.pathname}`).toBe(
    `http://localhost:8080/api/projects/${projectId}/api-behaviour/diffs/${diffId}/findings`,
  );
  expect(calledInit.method).toBe('GET');
});

// ---------------------------------------------------------------------------
// Test 2: PATCH /findings/:findingId forwards reviewer body verbatim.
//
// The reviewer drawer PATCHes the finding with a status transition body
// (e.g. `{ status: 'accepted', reviewer_notes: 'looks legit' }`). Gateway is
// a thin pass-through -- body forwarded byte-for-byte, response piped back.
// ---------------------------------------------------------------------------
test('PATCH /diffs/:diffId/findings/:findingId forwards reviewer body verbatim and pipes response', async () => {
  const projectId = 'proj-findings-1';
  const diffId = 'diff-9';
  const findingId = 'finding-1';

  const updatedFinding = {
    id: findingId,
    run_id: null,
    api_behaviour_diff_id: diffId,
    project_id: projectId,
    architecture_id: 'arch-1',
    finding_type: 'api_behaviour_status_drift',
    category: 'api_behaviour_drift',
    severity: 'critical',
    status: 'accepted',
    title: 'Status drift: GET /users responded 200 -> 500',
    summary: 'Server error on target replay',
    reviewer_notes: 'looks legit',
    reviewed_at: '2026-05-25T11:00:00Z',
    created_at: '2026-05-25T10:30:00Z',
    updated_at: '2026-05-25T11:00:00Z',
    links: [],
  };
  mockFetch.mockResolvedValueOnce(jsonResponse(200, updatedFinding));

  const app = createTestApp();
  const patchBody = {
    status: 'accepted',
    reviewer_notes: 'looks legit',
  };
  const res = await request(app)
    .patch(
      `/api/v1/projects/${projectId}/api-behaviour/diffs/${diffId}/findings/${findingId}`,
    )
    .send(patchBody);

  expect(res.status).toBe(200);
  expect(res.body).toEqual(updatedFinding);

  expect(mockFetch).toHaveBeenCalledTimes(1);
  const [calledUrl, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit];
  const u = new URL(calledUrl);
  expect(`${u.origin}${u.pathname}`).toBe(
    `http://localhost:8080/api/projects/${projectId}/api-behaviour/diffs/${diffId}/findings/${findingId}`,
  );
  expect(calledInit.method).toBe('PATCH');
  expect(JSON.parse(calledInit.body as string)).toEqual(patchBody);
});

// ---------------------------------------------------------------------------
// Test 3: Typed-client wrapper returns the typed DTO shape.
//
// `listDiffFindings` GETs the right gateway URL and returns
// `DiscoveryFindingDto[]` with both `run_id` and `api_behaviour_diff_id`
// typed `string | null` to match the AMS exactly-one-of-origin contract.
// ---------------------------------------------------------------------------
test('listDiffFindings returns typed DiscoveryFindingDto[] with nullable origin fields', async () => {
  const projectId = 'proj-findings-1';
  const diffId = 'diff-9';

  const findings: DiscoveryFindingDto[] = [
    {
      id: 'finding-1',
      run_id: null,
      api_behaviour_diff_id: diffId,
      project_id: projectId,
      architecture_id: 'arch-1',
      finding_type: 'api_behaviour_status_drift',
      category: 'api_behaviour_drift',
      severity: 'critical',
      confidence: null,
      status: 'new',
      title: 'Status drift: GET /users responded 200 -> 500',
      summary: 'Server error on target replay',
      detail_json: null,
      source: 'api_behaviour_diff',
      created_by_stage: 'diffRunner.findingEmission',
      created_at: '2026-05-25T10:30:00Z',
      updated_at: '2026-05-25T10:30:00Z',
      reviewed_at: null,
      reviewer_notes: null,
      links: [],
    },
  ];
  mockFetch.mockResolvedValueOnce(jsonResponse(200, findings));

  const result = await listDiffFindings('http://localhost:3001', projectId, diffId);

  expect(result).toHaveLength(1);
  expect(result[0].id).toBe('finding-1');
  // Both origin fields are typed `string | null`; the diff-sourced finding
  // has run_id=null and api_behaviour_diff_id=<diffId> per the exactly-one-
  // of-origin invariant.
  expect(result[0].run_id).toBeNull();
  expect(result[0].api_behaviour_diff_id).toBe(diffId);
  expect(result[0].severity).toBe('critical');
  expect(result[0].source).toBe('api_behaviour_diff');

  expect(mockFetch).toHaveBeenCalledTimes(1);
  const [calledUrl] = mockFetch.mock.calls[0] as [string, RequestInit];
  expect(calledUrl).toBe(
    `http://localhost:3001/api/v1/projects/${projectId}/api-behaviour/diffs/${diffId}/findings`,
  );
});
