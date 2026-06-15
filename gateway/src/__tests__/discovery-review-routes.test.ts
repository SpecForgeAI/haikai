/**
 * Tests for Discovery Review and Save-Approved Gateway Proxy Routes
 *
 * Spec 2026-04-05: Candidate Review and Approval Workflow (Increment 13)
 * Task Group 4: Gateway Proxy Routes for Review and Save-Approved
 *
 * Tests:
 * 1. PATCH /projects/:projectId/runs/:runId/candidates/:candidateId/review proxies to architecture-model-service and returns 200
 * 2. PATCH review route returns 503 on network error
 * 3. POST /projects/:projectId/runs/:runId/save-approved proxies correctly and returns 200
 * 4. POST save-approved route returns 503 on network error
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

describe('Discovery Review and Save-Approved Proxy Routes (Spec 2026-04-05, Task Group 4)', () => {
  let app: express.Application;

  const projectId = '550e8400-e29b-41d4-a716-446655440000';
  const architectureId = 'arch-test-default';
  const runId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
  const candidateId = 'cand-0001-0002-0003-000000000001';

  const sampleUpdatedCandidate = {
    id: candidateId,
    run_id: runId,
    candidate_type: 'service',
    name: 'UserService',
    confidence: 0.85,
    status: 'proposed',
    review_status: 'approved',
    reviewed_by: 'alice',
    reviewed_at: '2026-04-05T10:00:00Z',
    previous_review_status: 'pending_review',
    source_cluster_ids: ['cluster-1'],
    data: {},
    synthesized_at: '2026-04-04T12:03:00Z',
    parent_candidate_id: null,
  };

  const sampleSaveApprovedResult = {
    projectId,
    runId,
    entitiesCreated: 3,
    entitiesSkipped: 1,
    candidatesCommitted: 3,
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
  // Test 1: PATCH review proxies to architecture-model-service and returns 200
  // =========================================================================
  describe('PATCH /api/v1/discovery/projects/:projectId/runs/:runId/candidates/:candidateId/review', () => {
    it('proxies to architecture-model-service review endpoint and returns the updated candidate', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => sampleUpdatedCandidate,
      });

      const response = await request(app)
        .patch(`/api/v1/discovery/projects/${projectId}/architectures/${architectureId}/runs/${runId}/candidates/${candidateId}/review`)
        .send({ review_status: 'approved', reviewed_by: 'alice' });

      expect(response.status).toBe(200);
      expect(response.body.review_status).toBe('approved');
      expect(response.body.reviewed_by).toBe('alice');
      expect(response.body.previous_review_status).toBe('pending_review');

      // Verify fetch was called with correct URL and method
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe(
        `http://localhost:8080/api/model/projects/${projectId}/architectures/${architectureId}/discovery/runs/${runId}/candidates/${candidateId}/review`
      );
      expect(options.method).toBe('PATCH');
      expect(options.headers['Content-Type']).toBe('application/json');
      expect(JSON.parse(options.body)).toEqual({ review_status: 'approved', reviewed_by: 'alice' });
    });
  });

  // =========================================================================
  // Test 2: PATCH review route returns 503 on network error
  // =========================================================================
  describe('PATCH review route network error handling', () => {
    it('returns 503 with structured error when architecture-model-service is unreachable', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const response = await request(app)
        .patch(`/api/v1/discovery/projects/${projectId}/architectures/${architectureId}/runs/${runId}/candidates/${candidateId}/review`)
        .send({ review_status: 'approved' });

      expect(response.status).toBe(503);
      expect(response.body.error).toBeDefined();
      expect(response.body.error.code).toBe(503);
      expect(response.body.error.message).toBe('Architecture model service unavailable');
    });
  });

  // =========================================================================
  // Test 3: POST save-approved proxies correctly and returns 200
  // =========================================================================
  describe('POST /api/v1/discovery/projects/:projectId/runs/:runId/save-approved', () => {
    it('proxies to MCP server save_approved_candidates endpoint and returns the result', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => sampleSaveApprovedResult,
      });

      const response = await request(app)
        .post(`/api/v1/discovery/projects/${projectId}/architectures/${architectureId}/runs/${runId}/save-approved`);

      expect(response.status).toBe(200);
      expect(response.body.entitiesCreated).toBe(3);
      expect(response.body.entitiesSkipped).toBe(1);
      expect(response.body.candidatesCommitted).toBe(3);

      // Verify fetch was called with correct URL targeting MCP server
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe('http://localhost:8090/mcp/tools/save_approved_candidates');
      expect(options.method).toBe('POST');
      expect(options.headers['Content-Type']).toBe('application/json');

      // Verify the body includes sessionId, projectId, and runId
      const body = JSON.parse(options.body);
      expect(body.sessionId).toBe('gateway');
      expect(body.projectId).toBe(projectId);
      expect(body.runId).toBe(runId);
    });
  });

  // =========================================================================
  // Test 4: POST save-approved route returns 503 on network error
  // =========================================================================
  describe('POST save-approved route network error handling', () => {
    it('returns 503 with structured error when MCP server is unreachable', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const response = await request(app)
        .post(`/api/v1/discovery/projects/${projectId}/architectures/${architectureId}/runs/${runId}/save-approved`);

      expect(response.status).toBe(503);
      expect(response.body.error).toBeDefined();
      expect(response.body.error.code).toBe(503);
      expect(response.body.error.message).toBe('MCP server unavailable');
    });
  });
});
