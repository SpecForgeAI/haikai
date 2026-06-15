/**
 * Tests for the Discovery Candidate CASCADE Bulk-Review Gateway Proxy Route
 *
 * Spec 2 (Cascade-aware Bulk Review + Reject Suppression, 2026-06-02) -- Task
 * Group 3. The gateway exposes a thin pure-proxy route that forwards the
 * snake_case cascade body (`candidate_ids` + `finding_ids` + `review_status` +
 * optional `reviewer_notes`) to the AMS atomic cascade endpoint
 * `POST .../discovery/runs/:runId/candidates/bulk-review-cascade`, passing the
 * AMS status + body through verbatim. ALL business logic (atomicity, committed
 * gating, scope verification) lives in AMS -- the gateway adds NONE of its own.
 *
 * Mirrors `discovery-findings-bulk-review-proxy.test.ts`: a structural clone of
 * the finding bulk-review proxy with NO gateway-side loop / per-row PATCH
 * fan-out (that best-effort path is REPLACED for the cascade-apply path by this
 * single forwarded POST).
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

describe('Discovery Candidate Cascade Bulk-Review Proxy Route (Spec 2, Task Group 3)', () => {
  let app: express.Application;

  const projectId = '550e8400-e29b-41d4-a716-446655440000';
  const architectureId = 'arch-test-default';
  const runId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

  const amsBase = 'http://localhost:8080';
  const amsCascadeUrl =
    `${amsBase}/api/model/projects/${projectId}` +
    `/architectures/${architectureId}` +
    `/discovery/runs/${runId}/candidates/bulk-review-cascade`;

  const gatewayPath =
    `/api/v1/discovery/projects/${projectId}` +
    `/architectures/${architectureId}` +
    `/runs/${runId}/candidates/bulk-review-cascade`;

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

  it('forwards the snake_case cascade body + status + AMS response verbatim to the AMS cascade endpoint', async () => {
    const cascadeBody = {
      candidate_ids: [
        'ccc00001-aaaa-bbbb-cccc-111111111111',
        'ccc00002-aaaa-bbbb-cccc-222222222222',
      ],
      finding_ids: ['fff00001-aaaa-bbbb-cccc-111111111111'],
      review_status: 'rejected',
      reviewer_notes: 'Rejected via cascade by architect',
    };

    // Per-kind AMS response shape (snake_case wire): a candidates block and a
    // findings block, each with updated_count / skipped_count /
    // skipped_by_reason / delta_by_from_status.
    const amsResponseBody = {
      candidates: {
        updated_count: 2,
        skipped_count: 0,
        skipped_by_reason: { already_in_target: 0, transition_not_allowed: 0 },
        delta_by_from_status: { pending_review: 1, deferred: 1 },
      },
      findings: {
        updated_count: 1,
        skipped_count: 0,
        skipped_by_reason: { already_in_target: 0, transition_not_allowed: 0 },
        delta_by_from_status: { pending_review: 1 },
      },
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => amsResponseBody,
    });

    const response = await request(app).post(gatewayPath).send(cascadeBody);

    // Status passed through verbatim.
    expect(response.status).toBe(200);
    // Body passed through verbatim, including both per-kind blocks.
    expect(response.body).toEqual(amsResponseBody);

    // Exactly one upstream call (no gateway-side loop / per-row fan-out).
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe(amsCascadeUrl);
    expect(options.method).toBe('POST');
    expect(options.headers['Content-Type']).toBe('application/json');
    // Body forwarded verbatim (both id arrays + review_status + reviewer_notes).
    expect(JSON.parse(options.body)).toEqual(cascadeBody);
  });

  it('passes a 404 from AMS (cross-run id injection) through verbatim', async () => {
    const cascadeBody = {
      candidate_ids: ['ccc00001-aaaa-bbbb-cccc-111111111111'],
      finding_ids: ['fff99999-aaaa-bbbb-cccc-999999999999'], // foreign run
      review_status: 'rejected',
    };
    const amsErrorBody = {
      status: 404,
      message: 'Discovery finding fff99999-... not found in the requested scope',
    };

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => amsErrorBody,
    });

    const response = await request(app).post(gatewayPath).send(cascadeBody);

    // AMS 404 (the whole atomic batch rolled back) surfaces verbatim -- the
    // gateway adds no business logic of its own.
    expect(response.status).toBe(404);
    expect(response.body).toEqual(amsErrorBody);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('returns 503 on an AMS network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const response = await request(app)
      .post(gatewayPath)
      .send({
        candidate_ids: ['ccc00001-aaaa-bbbb-cccc-111111111111'],
        finding_ids: [],
        review_status: 'approved',
      });

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe(503);
  });

  it('logs the requestId on the proxied request', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ candidates: {}, findings: {} }),
    });

    await request(app)
      .post(gatewayPath)
      .send({
        candidate_ids: [],
        finding_ids: ['fff00001-aaaa-bbbb-cccc-111111111111'],
        review_status: 'deferred',
      });

    const loggedWithRequestId = mockLogger.info.mock.calls.some(
      (call) => call[1] && (call[1] as any).requestId === 'test-request-id'
    );
    expect(loggedWithRequestId).toBe(true);
  });
});
