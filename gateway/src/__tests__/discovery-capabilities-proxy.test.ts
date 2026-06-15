/**
 * Tests for the Discovery Capabilities Gateway Proxy Routes (read-only).
 *
 * Spec 2026-06-14: D2 -- Capability Synthesis + Batch Spines -- Task Group 6
 * gap-fill (the read path for the Group 5 frontend Capabilities section).
 *
 * Scope: thin proxy pass-through to architecture-model-service. The synthesised
 * `discovery_capability` records are produced by the discovery-service synthesis
 * step and persisted via the AMS bulk endpoint (NOT through the gateway); the D2
 * frontend surface is READ-ONLY, so only the three GET reads are wired in the
 * gateway. These tests pin the URL translation + downstream status/body
 * surfacing for those reads, mirroring `discovery-findings-proxy.test.ts`.
 *
 * Tests:
 *  1. GET .../runs/:runId/capabilities forwards the URL to AMS verbatim
 *  2. GET .../capabilities (project+architecture, no run) forwards to AMS
 *  3. GET .../capabilities/:capabilityId forwards + surfaces a 404 body intact
 *  4. Forgetting :architectureId 404s at the Express layer (no fallback)
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

describe('Discovery Capabilities Proxy Routes (D2, Task Group 6)', () => {
  let app: express.Application;

  const projectId = '550e8400-e29b-41d4-a716-446655440000';
  const architectureId = 'arch-test-default';
  const runId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
  const capabilityId = 'cap-aaaa-bbbb-cccc-dddddddddddd';

  const amsBase = 'http://localhost:8080';
  const amsModelPrefix = `${amsBase}/api/model/projects/${projectId}/architectures/${architectureId}/discovery`;

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
  // Test 1: GET .../runs/:runId/capabilities -- URL forwarding to AMS
  // =========================================================================
  it('GET /runs/:runId/capabilities proxies to the AMS run-scoped capabilities URL', async () => {
    const sample = [
      {
        id: capabilityId,
        run_id: runId,
        name: 'Daily Risk Hierarchy Load Pipeline',
        kind: 'batch_pipeline',
        confidence: 0.85,
        members: [
          { id: 'm-1', capability_id: capabilityId, member_type: 'discovery_candidate', member_id: 'cand-1', created_at: '2026-06-14T00:00:00Z' },
        ],
      },
    ];
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => sample,
    });

    const response = await request(app).get(
      `/api/v1/discovery/projects/${projectId}/architectures/${architectureId}/runs/${runId}/capabilities`,
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual(sample);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe(`${amsModelPrefix}/runs/${runId}/capabilities`);
    expect(options.method).toBe('GET');
  });

  // =========================================================================
  // Test 2: GET .../capabilities (project+architecture, no run) -> AMS
  // =========================================================================
  it('GET /capabilities (project+architecture) proxies to the AMS unfiltered URL', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [],
    });

    const response = await request(app).get(
      `/api/v1/discovery/projects/${projectId}/architectures/${architectureId}/capabilities`,
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe(`${amsModelPrefix}/capabilities`);
    expect(options.method).toBe('GET');
  });

  // =========================================================================
  // Test 3: GET .../capabilities/:capabilityId -> AMS + 404 body intact
  // =========================================================================
  it('GET /capabilities/:capabilityId forwards the URL and surfaces a 404 body verbatim', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ error: { code: 404, message: 'capability not found' } }),
    });

    const response = await request(app).get(
      `/api/v1/discovery/projects/${projectId}/architectures/${architectureId}/capabilities/${capabilityId}`,
    );

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: { code: 404, message: 'capability not found' } });
    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe(`${amsModelPrefix}/capabilities/${capabilityId}`);
  });

  // =========================================================================
  // Test 4: missing :architectureId 404s at the Express layer (no fallback)
  // =========================================================================
  it('omitting :architectureId 404s at the Express router (no AMS call)', async () => {
    const response = await request(app).get(
      `/api/v1/discovery/projects/${projectId}/capabilities`,
    );
    expect(response.status).toBe(404);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
