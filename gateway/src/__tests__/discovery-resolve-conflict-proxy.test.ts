/**
 * Tests — Discovery Candidate Resolve-Conflict Gateway Proxy Route
 *
 * Spec 2026-06-02: Conversational Discovery-Review "Architect" Persona —
 * Task Group 1 (AMS endpoint) + Task Group 3.5 (gateway proxy). A thin
 * structural clone of the single-candidate `/review` PATCH proxy. There is NO
 * gateway-side business logic — the gateway forwards one PATCH carrying the
 * snake_case body to the AMS `@PatchMapping("/{candidateId}/resolve-conflict")`.
 *
 * Per the proxy convention this gets ONE focused pass-through test: the proxy
 * forwards the PATCH body + status + AMS response body verbatim and builds the
 * correct AMS path from
 *   amsCandidatesPathPrefix(...) + '/{candidateId}/resolve-conflict'.
 *
 * CRITICAL wire fact asserted here: the REQUEST body is snake_case
 * (`chosen_value` / `chosen_source` / `resolved_by` / `resolved_at`) and is
 * forwarded verbatim. (AMS itself stamps the camelCase keys inside the
 * candidate `data._conflictResolutions[attr]` JSONB — that is AMS's job, proven
 * by the Group-1 JUnit test, not the gateway's.)
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

describe('Discovery Candidate Resolve-Conflict Proxy Route (Spec 2026-06-02, Task Group 3.5)', () => {
  let app: express.Application;

  const projectId = '550e8400-e29b-41d4-a716-446655440000';
  const architectureId = 'arch-test-default';
  const runId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
  const candidateId = 'cccc1111-2222-3333-4444-555566667777';

  const amsBase = 'http://localhost:8080';
  const amsCandidatesPrefix = `${amsBase}/api/model/projects/${projectId}/architectures/${architectureId}/discovery/runs/${runId}/candidates`;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as { requestId?: string }).requestId = 'test-request-id';
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

  it('PATCH /candidates/:candidateId/resolve-conflict forwards the snake_case body + status + response verbatim to AMS at the correct path', async () => {
    // The snake_case request body the conversation orchestrator sends.
    const resolveBody = {
      attr: 'framework',
      chosen_value: 'JAX-RS',
      chosen_source: 'src-jaxrs',
      resolved_by: 'architect-review-conversation',
      resolved_at: '2026-06-02T10:15:30.000Z',
    };

    // AMS returns the updated DiscoveryCandidateDto (snake_case wire). The
    // camelCase keys inside `data._conflictResolutions[framework]` are stamped
    // by AMS itself — the proxy just passes the body through.
    const amsResponseBody = {
      id: candidateId,
      candidate_type: 'service',
      status: 'pending_review',
      data: {
        framework: 'JAX-RS',
        _conflictResolutions: {
          framework: {
            chosenValue: 'JAX-RS',
            chosenSource: 'src-jaxrs',
            resolvedBy: 'architect-review-conversation',
            resolvedAt: '2026-06-02T10:15:30.000Z',
          },
        },
      },
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => amsResponseBody,
    });

    const response = await request(app)
      .patch(
        `/api/v1/discovery/projects/${projectId}/architectures/${architectureId}/runs/${runId}/candidates/${candidateId}/resolve-conflict`,
      )
      .send(resolveBody);

    // Status + body passed through verbatim, including the camelCase keys AMS
    // stamped inside `data`.
    expect(response.status).toBe(200);
    expect(response.body).toEqual(amsResponseBody);

    // Exactly one upstream call (no gateway-side loop / fan-out).
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe(`${amsCandidatesPrefix}/${candidateId}/resolve-conflict`);
    expect(options.method).toBe('PATCH');
    expect(options.headers['Content-Type']).toBe('application/json');
    // The snake_case body is forwarded verbatim.
    expect(JSON.parse(options.body)).toEqual(resolveBody);
  });

  it('returns 503 when the AMS network call fails', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const response = await request(app)
      .patch(
        `/api/v1/discovery/projects/${projectId}/architectures/${architectureId}/runs/${runId}/candidates/${candidateId}/resolve-conflict`,
      )
      .send({ attr: 'framework', chosen_value: 'JAX-RS', chosen_source: 'src-jaxrs' });

    expect(response.status).toBe(503);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
