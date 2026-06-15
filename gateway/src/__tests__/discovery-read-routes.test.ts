/**
 * Tests for Discovery Read Proxy Routes
 *
 * Spec 2026-04-05: Discovery Results Visibility (Dashboard + Meta-Model)
 * Task Group 2: Gateway Proxy Routes for Discovery Read Endpoints
 *
 * Tests:
 * 1. GET /projects/:projectId/runs proxies to architecture-model-service list-runs endpoint
 * 2. GET /projects/:projectId/runs/:runId proxies to architecture-model-service get-run endpoint
 * 3. GET /projects/:projectId/runs/:runId/candidates proxies with optional type/status query params
 * 4. GET /projects/:projectId/runs/:runId/candidates/count proxies to count endpoint
 * 5. GET /projects/:projectId/summary proxies to discovery summary endpoint
 * 6. GET /projects/:projectId/entity-origins proxies to entity-origins endpoint
 * 7. Network failure to backend returns 503 with structured error
 * 8. GET /projects/:projectId/runs/:runId/candidate-entity-mappings proxies correctly
 */

import request from 'supertest';
import express from 'express';
import { discoveryRouter } from '../routes/discovery';
import { resetConfig } from '../config';

// Mock fetch globally for proxying to architecture-model-service
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

describe('Discovery Read Proxy Routes (Spec 2026-04-05, Task Group 2)', () => {
  let app: express.Application;

  const projectId = '550e8400-e29b-41d4-a716-446655440000';
  const architectureId = 'arch-test-default';
  const runId = 'run-abc-123';

  const sampleRunDto = {
    id: runId,
    project_id: projectId,
    status: 'COMPLETED',
    current_step: '1d',
    config_snapshot: { sources: ['repo-url'] },
    steps_payload: {
      '1a': { status: 'completed' },
      '1b': { status: 'completed' },
      '1c': { status: 'completed' },
      '1d': { status: 'completed' },
    },
    error_message: null,
    created_at: '2026-04-04T12:00:00Z',
    updated_at: '2026-04-04T12:05:00Z',
  };

  const sampleRunsList = [sampleRunDto];

  const sampleCandidates = [
    {
      id: 'candidate-1',
      run_id: runId,
      candidate_type: 'service',
      name: 'UserService',
      confidence: 0.85,
      status: 'proposed',
      source_cluster_ids: ['cluster-1'],
      data: {},
      synthesized_at: '2026-04-04T12:03:00Z',
      parent_candidate_id: null,
    },
  ];

  const sampleCandidateCount = { count: 5 };

  const sampleSummary = {
    latest_run_id: runId,
    latest_run_status: 'COMPLETED',
    latest_run_created_at: '2026-04-04T12:00:00Z',
    total_candidates: 10,
    candidate_counts_by_status: { proposed: 7, accepted: 3 },
    entities_saved: 3,
    entity_type_coverage: 2,
  };

  const sampleEntityOrigins = [
    {
      id: 'mapping-1',
      candidate_id: 'candidate-1',
      run_id: runId,
      entity_type: 'service',
      entity_id: 'entity-uuid-1',
      action: 'created',
      created_at: '2026-04-04T12:04:00Z',
    },
  ];

  const sampleMappings = [
    {
      id: 'mapping-1',
      candidate_id: 'candidate-1',
      run_id: runId,
      entity_type: 'service',
      entity_id: 'entity-uuid-1',
      action: 'created',
      created_at: '2026-04-04T12:04:00Z',
    },
  ];

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
  // Test 1: GET /projects/:projectId/runs -- list runs
  // =========================================================================
  describe('GET /api/v1/discovery/projects/:projectId/runs', () => {
    it('proxies to architecture-model-service list-runs endpoint and returns the response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => sampleRunsList,
      });

      const response = await request(app)
        .get(`/api/v1/discovery/projects/${projectId}/architectures/${architectureId}/runs`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual(sampleRunsList);
      expect(response.body[0].id).toBe(runId);

      // Verify fetch was called with correct URL targeting architecture-model-service
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe(`http://localhost:8080/api/model/projects/${projectId}/architectures/${architectureId}/discovery/runs`);
      expect(options.method).toBe('GET');
    });
  });

  // =========================================================================
  // Test 2: GET /projects/:projectId/runs/:runId -- get run
  // =========================================================================
  describe('GET /api/v1/discovery/projects/:projectId/runs/:runId', () => {
    it('proxies to architecture-model-service get-run endpoint and returns the response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => sampleRunDto,
      });

      const response = await request(app)
        .get(`/api/v1/discovery/projects/${projectId}/architectures/${architectureId}/runs/${runId}`);

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(runId);
      expect(response.body.status).toBe('COMPLETED');

      // Verify fetch was called with correct URL
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe(`http://localhost:8080/api/model/projects/${projectId}/architectures/${architectureId}/discovery/runs/${runId}`);
      expect(options.method).toBe('GET');
    });
  });

  // =========================================================================
  // Test 3: GET /projects/:projectId/runs/:runId/candidates -- with query params
  // =========================================================================
  describe('GET /api/v1/discovery/projects/:projectId/runs/:runId/candidates', () => {
    it('proxies to architecture-model-service list-candidates endpoint with optional type/status query params forwarded', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => sampleCandidates,
      });

      const response = await request(app)
        .get(`/api/v1/discovery/projects/${projectId}/architectures/${architectureId}/runs/${runId}/candidates?type=service&status=proposed`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual(sampleCandidates);
      expect(response.body[0].candidate_type).toBe('service');

      // Verify query params were forwarded
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain(`/api/model/projects/${projectId}/architectures/${architectureId}/discovery/runs/${runId}/candidates`);
      expect(url).toContain('type=service');
      expect(url).toContain('status=proposed');
    });

    it('proxies without query params when none are provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => sampleCandidates,
      });

      const response = await request(app)
        .get(`/api/v1/discovery/projects/${projectId}/architectures/${architectureId}/runs/${runId}/candidates`);

      expect(response.status).toBe(200);

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe(`http://localhost:8080/api/model/projects/${projectId}/architectures/${architectureId}/discovery/runs/${runId}/candidates`);
    });
  });

  // =========================================================================
  // Test 4: GET /projects/:projectId/runs/:runId/candidates/count
  // =========================================================================
  describe('GET /api/v1/discovery/projects/:projectId/runs/:runId/candidates/count', () => {
    it('proxies to the count endpoint and returns the count', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => sampleCandidateCount,
      });

      const response = await request(app)
        .get(`/api/v1/discovery/projects/${projectId}/architectures/${architectureId}/runs/${runId}/candidates/count`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual(sampleCandidateCount);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe(`http://localhost:8080/api/model/projects/${projectId}/architectures/${architectureId}/discovery/runs/${runId}/candidates/count`);
    });
  });

  // =========================================================================
  // Test 5: GET /projects/:projectId/summary
  // =========================================================================
  describe('GET /api/v1/discovery/projects/:projectId/summary', () => {
    it('proxies to the new backend summary endpoint and returns DiscoverySummaryDto', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => sampleSummary,
      });

      const response = await request(app)
        .get(`/api/v1/discovery/projects/${projectId}/architectures/${architectureId}/summary`);

      expect(response.status).toBe(200);
      expect(response.body.latest_run_id).toBe(runId);
      expect(response.body.latest_run_status).toBe('COMPLETED');
      expect(response.body.total_candidates).toBe(10);
      expect(response.body.entities_saved).toBe(3);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe(`http://localhost:8080/api/model/projects/${projectId}/architectures/${architectureId}/discovery/summary`);
    });
  });

  // =========================================================================
  // Test 6: GET /projects/:projectId/entity-origins
  // =========================================================================
  describe('GET /api/v1/discovery/projects/:projectId/entity-origins', () => {
    it('proxies to the new backend entity-origins endpoint and returns entity mappings', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => sampleEntityOrigins,
      });

      const response = await request(app)
        .get(`/api/v1/discovery/projects/${projectId}/architectures/${architectureId}/entity-origins`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual(sampleEntityOrigins);
      expect(response.body[0].entity_type).toBe('service');
      expect(response.body[0].entity_id).toBe('entity-uuid-1');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe(`http://localhost:8080/api/model/projects/${projectId}/architectures/${architectureId}/discovery/entity-origins`);
    });
  });

  // =========================================================================
  // Test 7: Network failure returns 503 with structured error
  // =========================================================================
  describe('Network failure handling', () => {
    it('returns 503 with structured error when architecture-model-service is unreachable', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const response = await request(app)
        .get(`/api/v1/discovery/projects/${projectId}/architectures/${architectureId}/runs`);

      expect(response.status).toBe(503);
      expect(response.body.error).toBeDefined();
      expect(response.body.error.code).toBe(503);
      expect(response.body.error.message).toBe('Architecture model service unavailable');
    });
  });

  // =========================================================================
  // Test 8: GET /projects/:projectId/runs/:runId/candidate-entity-mappings
  // =========================================================================
  describe('GET /api/v1/discovery/projects/:projectId/runs/:runId/candidate-entity-mappings', () => {
    it('proxies to the backend mappings endpoint and returns the response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => sampleMappings,
      });

      const response = await request(app)
        .get(`/api/v1/discovery/projects/${projectId}/architectures/${architectureId}/runs/${runId}/candidate-entity-mappings`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual(sampleMappings);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe(`http://localhost:8080/api/model/projects/${projectId}/architectures/${architectureId}/discovery/runs/${runId}/candidate-entity-mappings`);
    });
  });
});
