/**
 * Tests for Discovery Findings Bulk-Review Gateway Proxy Route
 *
 * Spec 2026-05-28: Bulk Findings Actions -- Task Group 2 (gateway proxy +
 * typed client wrapper). Vocabulary normalized by Normalize Findings Review
 * Actions (Spec F, 2026-06-02): the bulk request body carries `review_status`
 * (candidate-parity vocabulary {pending_review, approved, rejected, deferred})
 * and `delta_by_from_status` is keyed by the same vocabulary. Per the spec's
 * test cap (Q10), the gateway layer gets exactly ONE test: a pass-through
 * assertion that the proxy forwards the POST body + status code + AMS response
 * body verbatim and builds the correct AMS path from
 * `amsFindingsPathPrefix(projectId, architectureId, runId) + '/bulk-review'`.
 *
 * The proxy is intentionally a thin structural clone of the single-row
 * `/review` proxy at `discovery.ts:2761-2777`. There is NO gateway-side
 * loop and NO per-row PATCH parallelism -- AMS exposes a real bulk
 * endpoint and the gateway just forwards one POST.
 */

import request from 'supertest';
import express from 'express';
import { discoveryRouter } from '../routes/discovery';
import { resetConfig } from '../config';

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

jest.mock('../services/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('Discovery Findings Bulk-Review Proxy Route (Spec 2026-05-28, Task Group 2)', () => {
  let app: express.Application;

  const projectId = '550e8400-e29b-41d4-a716-446655440000';
  const architectureId = 'arch-test-default';
  const runId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

  const amsBase = 'http://localhost:8080';
  const amsPrefix = `${amsBase}/api/model/projects/${projectId}/architectures/${architectureId}/discovery/runs/${runId}/findings`;

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

  it('POST /findings/bulk-review forwards body + status + response verbatim to AMS at the correct path', async () => {
    const bulkBody = {
      ids: [
        'fff00001-aaaa-bbbb-cccc-111111111111',
        'fff00002-aaaa-bbbb-cccc-222222222222',
        'fff00003-aaaa-bbbb-cccc-333333333333',
      ],
      review_status: 'approved',
      reviewer_notes: 'Confirmed by architect during bulk review',
    };

    // Realistic AMS response shape per spec (snake_case wire) including the
    // optional skipped_by_reason breakdown and the delta_by_from_status map.
    // delta_by_from_status is keyed by the pre-mutation review_status
    // (candidate-parity vocabulary); transition_not_allowed is retained in the
    // shape but is always 0 now that any->any transitions are allowed.
    const amsResponseBody = {
      updated_count: 2,
      skipped_count: 1,
      skipped_by_reason: {
        already_in_target: 1,
        transition_not_allowed: 0,
      },
      delta_by_from_status: {
        pending_review: 1,
        deferred: 1,
      },
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => amsResponseBody,
    });

    const response = await request(app)
      .post(
        `/api/v1/discovery/projects/${projectId}/architectures/${architectureId}/runs/${runId}/findings/bulk-review`
      )
      .send(bulkBody);

    // Status code passed through from AMS verbatim.
    expect(response.status).toBe(200);
    // Response body passed through from AMS verbatim, including the optional
    // skipped_by_reason breakdown and delta_by_from_status map.
    expect(response.body).toEqual(amsResponseBody);

    // Exactly one upstream call (no gateway-side loop / per-row fanout).
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [url, options] = mockFetch.mock.calls[0];
    // AMS path built from amsFindingsPathPrefix(...) + '/bulk-review'.
    expect(url).toBe(`${amsPrefix}/bulk-review`);
    expect(options.method).toBe('POST');
    expect(options.headers['Content-Type']).toBe('application/json');
    // Request body forwarded verbatim (including the ids array, the
    // review_status disposition, and the snake_case reviewer_notes field).
    expect(JSON.parse(options.body)).toEqual(bulkBody);
  });
});
