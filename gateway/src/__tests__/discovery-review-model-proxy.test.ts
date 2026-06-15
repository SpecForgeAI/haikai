/**
 * Tests for the Discovery Review-Model Proxy Route (Spec 1 — Deterministic
 * Review Model + Cascade/Dependency Graph + Aggregation Backbone, Task Group 5).
 *
 * The gateway adds a pure proxy that forwards
 *   GET /api/v1/discovery/projects/:projectId/architectures/:architectureId/runs/:runId/review-model
 *       [?secondRunId=<run-id>]
 * to the discovery-service (NOT architecture-model-service — discovery-service
 * COMPUTES the model), passing status + JSON body through VERBATIM and returning
 * 503 on a downstream network error.
 *
 * Tests:
 *   1. proxies to the discovery-service review-model URL and passes status + body
 *      through verbatim (single run);
 *   2. forwards the optional secondRunId query param;
 *   3. returns 503 on a downstream network error.
 */

import request from 'supertest';
import express from 'express';
import { discoveryRouter } from '../routes/discovery';
import { resetConfig } from '../config';

const mockFetch = jest.fn();
global.fetch = mockFetch;

jest.mock('../services/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

describe('Discovery Review-Model Proxy Route (Spec 1, Task Group 5)', () => {
  let app: express.Application;

  const projectId = '550e8400-e29b-41d4-a716-446655440000';
  const architectureId = 'arch-test-default';
  const runId = 'run-code-001';
  const secondRunId = 'run-db-001';

  const sampleModel = {
    scan_selection: [{ run_id: runId, scan_kind: 'code' }],
    nodes: [{ id: 'svc', candidate_type: 'service', name: 'OrderService' }],
    edges: [],
    findings: [],
    blast_radius: [],
    aggregations: { total_candidates: 1, total_findings: 0 },
  };

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).requestId = 'test-request-id';
      next();
    });
    app.use('/api/v1/discovery', discoveryRouter);
    mockFetch.mockReset();
    resetConfig();
    process.env.OPENAI_API_KEY = 'test-key';
  });

  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
  });

  it('proxies to the discovery-service review-model URL and passes status + body verbatim', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => sampleModel,
    });

    const response = await request(app).get(
      `/api/v1/discovery/projects/${projectId}/architectures/${architectureId}/runs/${runId}/review-model`,
    );

    expect(response.status).toBe(200);
    // Body forwarded verbatim (snake_case shape preserved).
    expect(response.body).toEqual(sampleModel);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    // Forwarded to the DISCOVERY-SERVICE (not architecture-model-service).
    expect(url).toContain(
      `/discovery/projects/${projectId}/architectures/${architectureId}/runs/${runId}/review-model`,
    );
    expect(options.method).toBe('GET');
  });

  it('forwards the optional secondRunId query param', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => sampleModel,
    });

    await request(app).get(
      `/api/v1/discovery/projects/${projectId}/architectures/${architectureId}/runs/${runId}/review-model?secondRunId=${secondRunId}`,
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain(`secondRunId=${secondRunId}`);
  });

  it('forwards the FULL additional-run-id set (>1 extra secondRunId) verbatim with NO gateway cap', async () => {
    // Per-service scan selection (`2026-06-05-per-service-scan-selection`, Task
    // Group 2): a 2-code + 1-DB selection sends TWO extra run ids as repeated
    // secondRunId params. The gateway proxy must forward them ALL (the
    // discovery-service is the sole run-set validator), keeping runId as the path.
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => sampleModel,
    });

    const extraA = 'run-code-002';
    const extraB = 'run-db-001';
    await request(app).get(
      `/api/v1/discovery/projects/${projectId}/architectures/${architectureId}/runs/${runId}/review-model` +
        `?secondRunId=${extraA}&secondRunId=${extraB}`,
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url] = mockFetch.mock.calls[0];
    // BOTH extra run ids forwarded (not just the first) — no >2 cap at the gateway.
    expect(url).toContain(`secondRunId=${extraA}`);
    expect(url).toContain(`secondRunId=${extraB}`);
    // runId stays the path segment (the primary anchor).
    expect(url).toContain(`/runs/${runId}/review-model`);
  });

  it('forwards a downstream error status + body verbatim (400 invalid selection)', async () => {
    const errBody = { error: { code: 400, message: 'Invalid scan selection: both runs are of kind code.' } };
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => errBody,
    });

    const response = await request(app).get(
      `/api/v1/discovery/projects/${projectId}/architectures/${architectureId}/runs/${runId}/review-model?secondRunId=${secondRunId}`,
    );

    expect(response.status).toBe(400);
    expect(response.body).toEqual(errBody);
  });

  it('returns 503 with a structured error when discovery-service is unreachable', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const response = await request(app).get(
      `/api/v1/discovery/projects/${projectId}/architectures/${architectureId}/runs/${runId}/review-model`,
    );

    expect(response.status).toBe(503);
    expect(response.body.error).toBeDefined();
    expect(response.body.error.code).toBe(503);
  });
});
