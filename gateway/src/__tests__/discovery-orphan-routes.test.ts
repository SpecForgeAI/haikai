/**
 * Tests for Discovery Orphan Detection and Cleanup Proxy Routes
 *
 * Spec 2026-04-06: Discovery Refinement, Consolidation, and System Hardening (Increment 16)
 * Task Group 4: Orphan Detection and Cleanup Endpoints
 *
 * Tests:
 * 1. GET /projects/:projectId/orphans proxies to architecture-model-service orphan detection
 * 2. POST /projects/:projectId/cleanup proxies to architecture-model-service cleanup
 * 3. GET /projects/:projectId/orphans forwards staleDays query parameter
 * 4. POST /projects/:projectId/cleanup forwards staleDays query parameter
 * 5. Network failure to backend returns 503 with structured error (GET orphans)
 * 6. Network failure to backend returns 503 with structured error (POST cleanup)
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

describe('Discovery Orphan Detection and Cleanup Proxy Routes (Spec 2026-04-06, Task Group 4)', () => {
  let app: express.Application;

  const projectId = '550e8400-e29b-41d4-a716-446655440000';
  const architectureId = 'arch-test-default';

  const sampleOrphanSummary = {
    orphaned_evidence_count: 5,
    orphaned_candidate_count: 3,
    orphaned_relationship_count: 2,
    orphaned_cluster_count: 1,
    orphaned_decision_task_count: 0,
    stale_run_count: 2,
  };

  const sampleCleanupSummary = {
    orphaned_evidence_count: 5,
    orphaned_candidate_count: 3,
    orphaned_relationship_count: 2,
    orphaned_cluster_count: 1,
    orphaned_decision_task_count: 0,
    stale_run_count: 2,
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
  // Test 1: GET /projects/:projectId/orphans -- proxies correctly
  // =========================================================================
  describe('GET /api/v1/discovery/projects/:projectId/orphans', () => {
    it('proxies to architecture-model-service orphan detection endpoint and returns the response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => sampleOrphanSummary,
      });

      const response = await request(app)
        .get(`/api/v1/discovery/projects/${projectId}/architectures/${architectureId}/orphans`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual(sampleOrphanSummary);
      expect(response.body.orphaned_evidence_count).toBe(5);
      expect(response.body.orphaned_candidate_count).toBe(3);
      expect(response.body.stale_run_count).toBe(2);

      // Verify fetch was called with correct URL targeting architecture-model-service
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe(`http://localhost:8080/api/model/projects/${projectId}/architectures/${architectureId}/discovery/orphans`);
      expect(options.method).toBe('GET');
    });
  });

  // =========================================================================
  // Test 2: POST /projects/:projectId/cleanup -- proxies correctly
  // =========================================================================
  describe('POST /api/v1/discovery/projects/:projectId/cleanup', () => {
    it('proxies to architecture-model-service cleanup endpoint and returns the deletion summary', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => sampleCleanupSummary,
      });

      const response = await request(app)
        .post(`/api/v1/discovery/projects/${projectId}/architectures/${architectureId}/cleanup`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual(sampleCleanupSummary);
      expect(response.body.orphaned_evidence_count).toBe(5);
      expect(response.body.orphaned_candidate_count).toBe(3);

      // Verify fetch was called with correct URL and method
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe(`http://localhost:8080/api/model/projects/${projectId}/architectures/${architectureId}/discovery/cleanup`);
      expect(options.method).toBe('POST');
    });
  });

  // =========================================================================
  // Test 3: GET /projects/:projectId/orphans -- forwards staleDays query param
  // =========================================================================
  describe('GET /api/v1/discovery/projects/:projectId/orphans with staleDays', () => {
    it('forwards staleDays query parameter to backend', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => sampleOrphanSummary,
      });

      const response = await request(app)
        .get(`/api/v1/discovery/projects/${projectId}/architectures/${architectureId}/orphans?staleDays=7`);

      expect(response.status).toBe(200);

      // Verify staleDays was forwarded in the URL
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe(`http://localhost:8080/api/model/projects/${projectId}/architectures/${architectureId}/discovery/orphans?staleDays=7`);
    });
  });

  // =========================================================================
  // Test 4: POST /projects/:projectId/cleanup -- forwards staleDays query param
  // =========================================================================
  describe('POST /api/v1/discovery/projects/:projectId/cleanup with staleDays', () => {
    it('forwards staleDays query parameter to backend', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => sampleCleanupSummary,
      });

      const response = await request(app)
        .post(`/api/v1/discovery/projects/${projectId}/architectures/${architectureId}/cleanup?staleDays=14`);

      expect(response.status).toBe(200);

      // Verify staleDays was forwarded in the URL
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe(`http://localhost:8080/api/model/projects/${projectId}/architectures/${architectureId}/discovery/cleanup?staleDays=14`);
    });
  });

  // =========================================================================
  // Test 5: Network failure on GET orphans returns 503
  // =========================================================================
  describe('Network failure on GET orphans', () => {
    it('returns 503 with structured error when architecture-model-service is unreachable', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const response = await request(app)
        .get(`/api/v1/discovery/projects/${projectId}/architectures/${architectureId}/orphans`);

      expect(response.status).toBe(503);
      expect(response.body.error).toBeDefined();
      expect(response.body.error.code).toBe(503);
      expect(response.body.error.message).toBe('Architecture model service unavailable');
    });
  });

  // =========================================================================
  // Test 6: Network failure on POST cleanup returns 503
  // =========================================================================
  describe('Network failure on POST cleanup', () => {
    it('returns 503 with structured error when architecture-model-service is unreachable', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const response = await request(app)
        .post(`/api/v1/discovery/projects/${projectId}/architectures/${architectureId}/cleanup`);

      expect(response.status).toBe(503);
      expect(response.body.error).toBeDefined();
      expect(response.body.error.code).toBe(503);
      expect(response.body.error.message).toBe('Architecture model service unavailable');
    });
  });
});
