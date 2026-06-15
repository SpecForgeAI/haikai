/**
 * Tests for Discovery Findings Gateway Proxy Routes
 *
 * Spec 2026-05-16: Discovery Findings / Evidence as a First-Class Discovery
 * Concept -- Task Group 3 (Phase 2 / Commit 2). Vocabulary normalized by
 * Normalize Findings Review Actions (Spec F, 2026-06-02): the disposition
 * wire field is `review_status` (candidate-parity vocabulary {pending_review,
 * approved, rejected, deferred}). NOTE: the GET `/findings` filter query
 * parameter stays literally `status` (its value uses the new vocabulary).
 *
 * Scope: thin proxy pass-through to architecture-model-service. The tests
 * pin URL translation + query/body forwarding + downstream error surfacing.
 * They do NOT exhaustively cover every route; per the spec we focus on the
 * URL-translation and pass-through invariants.
 *
 * Tests:
 *  1. GET .../findings forwards URL + query string verbatim to AMS
 *  2. POST .../findings forwards the request body verbatim
 *  3. POST .../findings/{id}/review forwards URL + body
 *  4. POST .../findings/{id}/links forwards URL + body
 *     and DELETE .../findings/{id}/links/{linkId} forwards URL
 *  5. AMS 422 surfaces as 422 with body intact
 *  6. AMS 400 invalid_link_target body shape surfaces verbatim
 *  7. Forgetting :architectureId 404s at the Express layer (no fallback)
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

describe('Discovery Findings Proxy Routes (Spec 2026-05-16, Task Group 3)', () => {
  let app: express.Application;

  const projectId = '550e8400-e29b-41d4-a716-446655440000';
  const architectureId = 'arch-test-default';
  const runId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
  const findingId = 'finding-aaaa-bbbb-cccc-dddddddddddd';
  const linkId = 'link-1111-2222-3333-444444444444';

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

  // =========================================================================
  // Test 1: GET .../findings -- URL + query string forwarding
  // =========================================================================
  it('GET /findings proxies to AMS and forwards filter query params verbatim', async () => {
    const sampleList = {
      content: [
        { id: findingId, finding_type: 'low_confidence_candidate', review_status: 'pending_review' },
      ],
      total_elements: 1,
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => sampleList,
    });

    // The findings list filter query param stays literally `status` (Spec F
    // keeps the param name; only its value uses the new vocabulary).
    const response = await request(app).get(
      `/api/v1/discovery/projects/${projectId}/architectures/${architectureId}/runs/${runId}/findings` +
        `?category=ambiguity&findingType=low_confidence_candidate&severity=high` +
        `&status=deferred&source=runtime&createdByStage=discoveryV3Pipeline.postMerge.lowConfidence` +
        `&linkedTargetType=discovery_candidate&linkedTargetId=cand-1`
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual(sampleList);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    // Path translates 1:1 from gateway to AMS
    expect(url).toContain(amsPrefix);
    // Every filter query param forwarded verbatim (URL contains the param)
    expect(url).toContain('category=ambiguity');
    expect(url).toContain('findingType=low_confidence_candidate');
    expect(url).toContain('severity=high');
    expect(url).toContain('status=deferred');
    expect(url).toContain('source=runtime');
    expect(url).toContain('createdByStage=discoveryV3Pipeline.postMerge.lowConfidence');
    expect(url).toContain('linkedTargetType=discovery_candidate');
    expect(url).toContain('linkedTargetId=cand-1');
    expect(options.method).toBe('GET');
  });

  // =========================================================================
  // Test 2: POST .../findings -- body forwarding verbatim
  // =========================================================================
  it('POST /findings forwards the request body verbatim to AMS', async () => {
    const createBody = {
      finding_type: 'low_confidence_candidate',
      category: 'ambiguity',
      severity: 'medium',
      title: 'Low-confidence service candidate UserService',
      summary: 'confidence < AMBIGUOUS_THRESHOLD',
      confidence: 0.42,
      source: 'pipeline',
      created_by_stage: 'discoveryV3Pipeline.postMerge.lowConfidence',
      detail_json: { evidence_count: 3 },
      links: [
        {
          link_type: 'derived_from',
          target_type: 'discovery_candidate',
          target_id: 'cand-7',
        },
      ],
    };

    const createdResponse = { id: findingId, ...createBody, review_status: 'pending_review' };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => createdResponse,
    });

    const response = await request(app)
      .post(
        `/api/v1/discovery/projects/${projectId}/architectures/${architectureId}/runs/${runId}/findings`
      )
      .send(createBody);

    expect(response.status).toBe(201);
    expect(response.body).toEqual(createdResponse);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe(amsPrefix);
    expect(options.method).toBe('POST');
    expect(options.headers['Content-Type']).toBe('application/json');
    // Body forwarded verbatim
    expect(JSON.parse(options.body)).toEqual(createBody);
  });

  // =========================================================================
  // Test 3: POST .../findings/{id}/review -- URL + body forwarding
  // =========================================================================
  it('POST /findings/:findingId/review proxies to the AMS review endpoint with the body intact', async () => {
    const reviewBody = { review_status: 'approved', reviewer_notes: 'Confirmed by architect' };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        id: findingId,
        review_status: 'approved',
        previous_review_status: 'pending_review',
        reviewer_notes: 'Confirmed by architect',
        reviewed_at: '2026-05-16T12:00:00Z',
      }),
    });

    const response = await request(app)
      .post(
        `/api/v1/discovery/projects/${projectId}/architectures/${architectureId}/runs/${runId}/findings/${findingId}/review`
      )
      .send(reviewBody);

    expect(response.status).toBe(200);
    expect(response.body.review_status).toBe('approved');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe(`${amsPrefix}/${findingId}/review`);
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toEqual(reviewBody);
  });

  // =========================================================================
  // Test 4: POST /links and DELETE /links/:linkId -- URL forwarding
  // =========================================================================
  it('POST /findings/:findingId/links and DELETE /findings/:findingId/links/:linkId proxy to AMS', async () => {
    // POST link
    const linkBody = {
      link_type: 'supports',
      target_type: 'discovery_evidence',
      target_id: 'ev-99',
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ id: linkId, finding_id: findingId, ...linkBody }),
    });

    const postResponse = await request(app)
      .post(
        `/api/v1/discovery/projects/${projectId}/architectures/${architectureId}/runs/${runId}/findings/${findingId}/links`
      )
      .send(linkBody);

    expect(postResponse.status).toBe(201);

    let [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe(`${amsPrefix}/${findingId}/links`);
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toEqual(linkBody);

    // DELETE link
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 204,
      json: async () => {
        throw new Error('no body');
      },
      text: async () => '',
    });

    const deleteResponse = await request(app).delete(
      `/api/v1/discovery/projects/${projectId}/architectures/${architectureId}/runs/${runId}/findings/${findingId}/links/${linkId}`
    );

    expect(deleteResponse.status).toBe(204);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    [url, options] = mockFetch.mock.calls[1];
    expect(url).toBe(`${amsPrefix}/${findingId}/links/${linkId}`);
    expect(options.method).toBe('DELETE');
  });

  // =========================================================================
  // Test 5: AMS 422 surfaces verbatim. Transitions are unrestricted under
  // Spec F, so the gateway simply forwards whatever validation error AMS
  // returns -- it never inspects the disposition itself.
  // =========================================================================
  it('forwards AMS 422 validation errors with body intact', async () => {
    const amsErrorBody = {
      code: 'invalid_review_status',
      message: "review_status must be one of approved, rejected, deferred",
    };
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 422,
      json: async () => amsErrorBody,
    });

    const response = await request(app)
      .patch(
        `/api/v1/discovery/projects/${projectId}/architectures/${architectureId}/runs/${runId}/findings/${findingId}`
      )
      .send({ review_status: 'bogus' });

    expect(response.status).toBe(422);
    expect(response.body).toEqual(amsErrorBody);
  });

  // =========================================================================
  // Test 6: AMS 400 invalid_link_target body forwarded verbatim
  // =========================================================================
  it('forwards AMS 400 invalid_link_target body verbatim on link create', async () => {
    const amsErrorBody = {
      code: 'invalid_link_target',
      message: 'Target candidate cand-other belongs to a different run',
    };
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => amsErrorBody,
    });

    const response = await request(app)
      .post(
        `/api/v1/discovery/projects/${projectId}/architectures/${architectureId}/runs/${runId}/findings/${findingId}/links`
      )
      .send({
        link_type: 'supports',
        target_type: 'discovery_candidate',
        target_id: 'cand-other',
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual(amsErrorBody);
  });

  // =========================================================================
  // Test 7: missing :architectureId 404s at the Express layer
  // =========================================================================
  it('returns 404 when the :architectureId segment is omitted (no fallback resolution)', async () => {
    // Note: no /architectures/:architectureId segment in the URL
    const response = await request(app).get(
      `/api/v1/discovery/projects/${projectId}/runs/${runId}/findings`
    );

    expect(response.status).toBe(404);
    // Critically, no fetch was made: the gateway didn't fall back to a
    // default-architecture resolution.
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
