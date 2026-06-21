/**
 * Tests for the Discovery Candidate BULK-EDIT Gateway Proxy Route +
 * the save-approved `commit=false` DRY-RUN passthrough.
 *
 * Spec: Skipped-candidate visibility + grouped bulk-fill (C1) for discovery
 * save-back (2026-06-20) -- Task Group 4.
 *
 * Part A -- the gateway exposes a thin pure-proxy route that forwards the
 * snake_case patch body (`patches: [{ candidate_id, name?, candidate_type?,
 * status?, review_status?, confidence?, operation?, data? }]`) to the AMS ATOMIC
 * bulk-edit endpoint `POST .../discovery/runs/:runId/candidates/bulk-edit`,
 * passing the AMS status + body through verbatim. The endpoint is ATOMIC: a 2xx
 * carries `{ applied_count, requested_count, ids, applied[] }`; any single-patch
 * failure rolls the whole batch back and surfaces as a non-2xx `{ error }`. ALL
 * business logic (atomicity, scope verification) lives in AMS -- the gateway
 * adds NONE of its own. Mirrors `discovery-cascade-bulk-review-proxy.test.ts`.
 *
 * Part B -- the existing save-approved proxy (a passthrough to MCP
 * `save_approved_candidates`) now threads a `commit=false` DRY-RUN flag through
 * to MCP so the C1 panel can PREVIEW the projection WITHOUT persisting. The flag
 * is accepted as `?commit=false` or `{ commit: false }`; the default remains
 * `commit=true` (commit). The gateway re-implements NO resolution.
 */

import request from 'supertest';
import express from 'express';
import { discoveryRouter } from '../routes/discovery';
import { resetConfig } from '../config';

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

jest.mock('../services/logger', () => ({
  logger: {
    info: (...args: unknown[]) => mockLogger.info(...args),
    warn: (...args: unknown[]) => mockLogger.warn(...args),
    error: (...args: unknown[]) => mockLogger.error(...args),
    debug: (...args: unknown[]) => mockLogger.debug(...args),
  },
}));

describe('Discovery Candidate Bulk-Edit Proxy + save-approved dry-run (C1, Task Group 4)', () => {
  let app: express.Application;

  const projectId = '550e8400-e29b-41d4-a716-446655440000';
  const architectureId = 'arch-test-default';
  const runId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

  const amsBase = 'http://localhost:8080';
  const amsBulkEditUrl =
    `${amsBase}/api/model/projects/${projectId}` +
    `/architectures/${architectureId}` +
    `/discovery/runs/${runId}/candidates/bulk-edit`;

  const bulkEditGatewayPath =
    `/api/v1/discovery/projects/${projectId}` +
    `/architectures/${architectureId}` +
    `/runs/${runId}/candidates/bulk-edit`;

  const saveApprovedGatewayPath =
    `/api/v1/discovery/projects/${projectId}` +
    `/architectures/${architectureId}` +
    `/runs/${runId}/save-approved`;

  const mcpSaveApprovedUrl = 'http://localhost:8090/mcp/tools/save_approved_candidates';

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).requestId = 'test-request-id';
      next();
    });
    app.use('/api/v1/discovery', discoveryRouter);
    mockFetch.mockReset();
    mockLogger.info.mockReset();
    mockLogger.warn.mockReset();
    mockLogger.error.mockReset();
    mockLogger.debug.mockReset();
    resetConfig();
    process.env.OPENAI_API_KEY = 'test-key';
  });

  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
  });

  // =========================================================================
  // Part A: bulk-edit proxy forwards to AMS verbatim
  // =========================================================================
  it('forwards the snake_case patch body + status + AMS response verbatim to the AMS bulk-edit endpoint', async () => {
    const editBody = {
      patches: [
        {
          candidate_id: 'ccc00001-aaaa-bbbb-cccc-111111111111',
          name: 'OrderService.process',
          data: { controllerClassName: 'OrderService' },
        },
        {
          candidate_id: 'ccc00002-aaaa-bbbb-cccc-222222222222',
          interface_type: undefined, // omitted top-level field stays absent
          data: { interface_type: 'GRAPHQL_API' },
        },
      ],
    };

    // Atomic AMS response shape (snake_case wire): applied_count == requested_count
    // on a 2xx return; ids + the full updated candidate rows.
    const amsResponseBody = {
      applied_count: 2,
      requested_count: 2,
      ids: [
        'ccc00001-aaaa-bbbb-cccc-111111111111',
        'ccc00002-aaaa-bbbb-cccc-222222222222',
      ],
      applied: [
        { id: 'ccc00001-aaaa-bbbb-cccc-111111111111', name: 'OrderService.process' },
        { id: 'ccc00002-aaaa-bbbb-cccc-222222222222', name: 'PaymentApi' },
      ],
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => amsResponseBody,
    });

    const response = await request(app).post(bulkEditGatewayPath).send(editBody);

    // Status + body passed through verbatim.
    expect(response.status).toBe(200);
    expect(response.body).toEqual(amsResponseBody);

    // Exactly one upstream call (no gateway-side loop / per-row fan-out).
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe(amsBulkEditUrl);
    expect(options.method).toBe('POST');
    expect(options.headers['Content-Type']).toBe('application/json');
    // Body forwarded verbatim (the curated patches + their data overlays). The
    // `undefined` top-level field is dropped by JSON.stringify, matching the
    // PATCH-style omitted-field contract.
    expect(JSON.parse(options.body)).toEqual({
      patches: [
        {
          candidate_id: 'ccc00001-aaaa-bbbb-cccc-111111111111',
          name: 'OrderService.process',
          data: { controllerClassName: 'OrderService' },
        },
        {
          candidate_id: 'ccc00002-aaaa-bbbb-cccc-222222222222',
          data: { interface_type: 'GRAPHQL_API' },
        },
      ],
    });
  });

  it('passes an AMS 404 (out-of-scope candidate id; whole atomic batch rolled back) through verbatim', async () => {
    const editBody = {
      patches: [{ candidate_id: 'ccc99999-aaaa-bbbb-cccc-999999999999', name: 'X' }],
    };
    const amsErrorBody = {
      error: 'Discovery candidate ccc99999-... not found in the requested scope',
    };

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => amsErrorBody,
    });

    const response = await request(app).post(bulkEditGatewayPath).send(editBody);

    // The whole atomic batch failed -> AMS non-2xx surfaces verbatim (no partial
    // result; the gateway adds no business logic of its own).
    expect(response.status).toBe(404);
    expect(response.body).toEqual(amsErrorBody);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('returns 503 on an AMS network error for bulk-edit', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const response = await request(app)
      .post(bulkEditGatewayPath)
      .send({ patches: [{ candidate_id: 'ccc00001-aaaa-bbbb-cccc-111111111111', name: 'X' }] });

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe(503);
  });

  // =========================================================================
  // Part B: save-approved threads the commit=false dry-run flag to MCP
  // =========================================================================
  it('forwards commit=false (query param) through the save-approved proxy to MCP as a dry run', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        projectId,
        runId,
        entitiesCreated: 0,
        entitiesSkipped: 1,
        candidatesCommitted: 0,
        reasons: [],
      }),
    });

    const response = await request(app).post(`${saveApprovedGatewayPath}?commit=false`);

    expect(response.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe(mcpSaveApprovedUrl);
    expect(options.method).toBe('POST');
    const body = JSON.parse(options.body);
    expect(body.sessionId).toBe('gateway');
    expect(body.projectId).toBe(projectId);
    expect(body.architectureId).toBe(architectureId);
    expect(body.runId).toBe(runId);
    // The dry-run flag rode through verbatim.
    expect(body.commit).toBe(false);
  });

  it('forwards commit=false (body field) through the save-approved proxy to MCP as a dry run', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ projectId, runId, entitiesCreated: 0, entitiesSkipped: 0, candidatesCommitted: 0 }),
    });

    const response = await request(app).post(saveApprovedGatewayPath).send({ commit: false });

    expect(response.status).toBe(200);
    const [, options] = mockFetch.mock.calls[0];
    expect(JSON.parse(options.body).commit).toBe(false);
  });

  it('defaults the save-approved proxy to commit=true when no flag is supplied', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ projectId, runId, entitiesCreated: 3, entitiesSkipped: 1, candidatesCommitted: 3 }),
    });

    const response = await request(app).post(saveApprovedGatewayPath);

    expect(response.status).toBe(200);
    const [, options] = mockFetch.mock.calls[0];
    // No flag -> a real commit (the existing behaviour is preserved).
    expect(JSON.parse(options.body).commit).toBe(true);
  });
});
