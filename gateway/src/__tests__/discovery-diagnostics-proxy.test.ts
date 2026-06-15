/**
 * Tests for Discovery Diagnostics Proxy Route
 *
 * Spec 2026-04-06: Discovery Refinement, Consolidation, and System Hardening (Increment 16)
 * Task Group 9: Cross-Cutting Test Review -- Gap filling
 *
 * Fills gap: gateway proxy route for GET /projects/:projectId/architectures/:architectureId/runs/:runId/diagnostics
 * has no dedicated test (TG4 tests cover orphans/cleanup, TG6 tests cover the
 * discovery-service diagnostics endpoint itself, but the gateway proxy forwarding
 * for diagnostics was untested).
 *
 * Spec 2026-05-01 (Spec #4) Group 3: route is now architecture-scoped; the
 * downstream discovery-service URL embeds `:projectId` and `:architectureId`
 * as path segments rather than passing `projectId` as a query parameter.
 *
 * Tests:
 * 1. GET diagnostics proxies to discovery-service with correct URL and returns response
 * 2. Network failure returns 503 with structured error
 */

import request from 'supertest';
import express from 'express';
import { discoveryRouter } from '../routes/discovery';
import { resetConfig } from '../config';

// Mock fetch globally for proxying
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Mock logger to avoid console output during tests
jest.mock('../services/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('Discovery Diagnostics Proxy Route (Spec 2026-04-06, Task Group 9 gap)', () => {
  let app: express.Application;

  const projectId = '550e8400-e29b-41d4-a716-446655440000';
  const architectureId = 'arch-test-default';
  const runId = 'run-diag-proxy-001';

  const sampleDiagnosticsResponse = {
    runId,
    projectId,
    status: 'COMPLETED',
    stepsPayload: {
      '1a': {
        status: 'completed',
        atomCounts: { file_structure: 10, symbol: 5, string_pattern: 2 },
        totalAtoms: 17,
        durationMs: 4000,
      },
      '1b': {
        status: 'completed',
        relationshipCount: 42,
        durationMs: 5000,
      },
      '1c': {
        status: 'completed',
        clusterCount: 3,
        durationMs: 4000,
      },
      '1d': {
        status: 'completed',
        candidateCount: 8,
        durationMs: 6000,
      },
    },
  };

  beforeEach(() => {
    app = express();
    app.use(express.json());
    // Add requestId middleware simulation
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
  // Test 1: GET diagnostics proxies correctly to discovery-service
  // =========================================================================
  it('proxies GET diagnostics to discovery-service and returns the response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => sampleDiagnosticsResponse,
    });

    const response = await request(app)
      .get(`/api/v1/discovery/projects/${projectId}/architectures/${architectureId}/runs/${runId}/diagnostics`);

    expect(response.status).toBe(200);
    expect(response.body.runId).toBe(runId);
    expect(response.body.projectId).toBe(projectId);
    expect(response.body.status).toBe('COMPLETED');
    expect(response.body.stepsPayload).toBeDefined();
    expect(response.body.stepsPayload['1a'].atomCounts).toEqual({
      file_structure: 10, symbol: 5, string_pattern: 2,
    });
    expect(response.body.stepsPayload['1b'].relationshipCount).toBe(42);

    // Verify fetch was called with the correct discovery-service URL
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    // Gateway proxies diagnostics to the discovery-service (not architecture-model-service).
    // Spec #4 Group 3: projectId and architectureId are path segments, not query params.
    expect(url).toContain(`/discovery/projects/${projectId}/architectures/${architectureId}/runs/${runId}/diagnostics`);
    expect(options.method).toBe('GET');
  });

  // =========================================================================
  // Test 2: Network failure on GET diagnostics returns 503
  // =========================================================================
  it('returns 503 with structured error when discovery-service is unreachable', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const response = await request(app)
      .get(`/api/v1/discovery/projects/${projectId}/architectures/${architectureId}/runs/${runId}/diagnostics`);

    expect(response.status).toBe(503);
    expect(response.body.error).toBeDefined();
    expect(response.body.error.code).toBe(503);
  });
});
