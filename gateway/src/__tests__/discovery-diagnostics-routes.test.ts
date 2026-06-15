/**
 * Tests for Discovery Diagnostics Proxy Route
 *
 * Spec 2026-04-06: Discovery Refinement, Consolidation, and System Hardening (Increment 16)
 * Task Group 6: Gateway Proxy Route for Diagnostics Endpoint
 *
 * Verifies that GET /projects/:projectId/runs/:runId/diagnostics proxies
 * correctly to the discovery-service diagnostics endpoint.
 */

import request from 'supertest';
import express from 'express';
import { discoveryRouter } from '../routes/discovery';
import { resetConfig } from '../config';

// Mock fetch globally for proxying to discovery-service
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

describe('Discovery Diagnostics Proxy Route (Spec 2026-04-06, Task Group 6)', () => {
  let app: express.Application;

  const projectId = '550e8400-e29b-41d4-a716-446655440000';
  const architectureId = 'arch-test-default';
  const runId = 'run-uuid-diag-001';

  const sampleDiagnosticsResponse = {
    runId: runId,
    projectId: projectId,
    status: 'COMPLETED',
    stepsPayload: {
      '1a': {
        status: 'completed',
        atomCounts: { file_structure: 10, symbol: 5, string_pattern: 2 },
        durationMs: 4000,
        stepStartedAt: '2026-04-06T10:00:01Z',
        stepCompletedAt: '2026-04-06T10:00:05Z',
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
    // Set required environment variable
    process.env.OPENAI_API_KEY = 'test-key';
  });

  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
  });

  // =========================================================================
  // Test 1: GET /projects/:projectId/runs/:runId/diagnostics -- proxies correctly
  // =========================================================================
  it('proxies diagnostics request to discovery-service and returns the response', async () => {
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
    expect(response.body.stepsPayload['1a'].durationMs).toBe(4000);
    expect(response.body.stepsPayload['1b'].relationshipCount).toBe(42);

    // Verify fetch was called with correct URL targeting discovery-service
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe(`http://localhost:8091/discovery/projects/${projectId}/architectures/${architectureId}/runs/${runId}/diagnostics`);
    expect(options.method).toBe('GET');
  });

  // =========================================================================
  // Test 2: Network failure returns 503 with structured error
  // =========================================================================
  it('returns 503 when discovery-service is unreachable', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const response = await request(app)
      .get(`/api/v1/discovery/projects/${projectId}/architectures/${architectureId}/runs/${runId}/diagnostics`);

    expect(response.status).toBe(503);
    expect(response.body.error).toBeDefined();
    expect(response.body.error.code).toBe(503);
    expect(response.body.error.message).toBe('Discovery service unavailable');
  });
});
