/**
 * Tests for Discovery Log Enrichment and Reprocessing Gateway Proxy Routes
 *
 * Spec 2026-04-05: Log-based Discovery Enrichment (Increment 14)
 * Task Group 6: Gateway Proxy Routes
 *
 * Tests:
 * 1. POST /projects/:projectId/runs/:runId/log-enrichment proxies to discovery-service and forwards response
 * 2. POST /projects/:projectId/runs/:runId/log-enrichment returns 503 on network error
 * 3. POST /projects/:projectId/runs/:runId/reprocess proxies to discovery-service and forwards 202
 * 4. POST /projects/:projectId/runs/:runId/reprocess returns 503 on network error
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

describe('Discovery Log Enrichment and Reprocessing Proxy Routes (Spec 2026-04-05, Task Group 6)', () => {
  let app: express.Application;

  const projectId = '550e8400-e29b-41d4-a716-446655440000';
  const architectureId = 'arch-test-default';
  const runId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

  const sampleEnrichmentResponse = {
    atomsExtracted: 42,
    atomsByType: { string_pattern: 42 },
    formatDetected: 'json_lines',
    linesProcessed: 200,
  };

  const sampleReprocessResponse = {
    status: 'accepted',
    message: 'Reprocessing started',
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
  // Test 1: POST log-enrichment proxies to discovery-service and forwards response
  // =========================================================================
  describe('POST /api/v1/discovery/projects/:projectId/runs/:runId/log-enrichment', () => {
    it('proxies to discovery-service log-enrichment endpoint and forwards the response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => sampleEnrichmentResponse,
      });

      const response = await request(app)
        .post(`/api/v1/discovery/projects/${projectId}/architectures/${architectureId}/runs/${runId}/log-enrichment`)
        .send({ logContent: '{"timestamp":"2026-01-01","message":"test"}' });

      expect(response.status).toBe(200);
      expect(response.body.atomsExtracted).toBe(42);
      expect(response.body.formatDetected).toBe('json_lines');
      expect(response.body.linesProcessed).toBe(200);

      // Verify fetch was called with correct URL and method
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe('http://localhost:8091/discovery/log-enrichment');
      expect(options.method).toBe('POST');
      expect(options.headers['Content-Type']).toBe('application/json');

      // Verify the proxied body includes projectId and runId from URL params
      const body = JSON.parse(options.body);
      expect(body.projectId).toBe(projectId);
      expect(body.runId).toBe(runId);
      expect(body.logContent).toBe('{"timestamp":"2026-01-01","message":"test"}');
    });
  });

  // =========================================================================
  // Test 2: POST log-enrichment returns 503 on network error
  // =========================================================================
  describe('POST log-enrichment route network error handling', () => {
    it('returns 503 with structured error when discovery-service is unreachable', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const response = await request(app)
        .post(`/api/v1/discovery/projects/${projectId}/architectures/${architectureId}/runs/${runId}/log-enrichment`)
        .send({ logContent: 'some log data' });

      expect(response.status).toBe(503);
      expect(response.body.error).toBeDefined();
      expect(response.body.error.code).toBe(503);
      expect(response.body.error.message).toBe('Discovery service unavailable');
    });
  });

  // =========================================================================
  // Test 3: POST reprocess proxies to discovery-service and forwards 202
  // =========================================================================
  describe('POST /api/v1/discovery/projects/:projectId/runs/:runId/reprocess', () => {
    it('proxies to discovery-service reprocess endpoint and forwards 202 Accepted', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 202,
        json: async () => sampleReprocessResponse,
      });

      const response = await request(app)
        .post(`/api/v1/discovery/projects/${projectId}/architectures/${architectureId}/runs/${runId}/reprocess`)
        .send({});

      expect(response.status).toBe(202);
      expect(response.body.status).toBe('accepted');
      expect(response.body.message).toBe('Reprocessing started');

      // Verify fetch was called with correct URL and method
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe('http://localhost:8091/discovery/reprocess');
      expect(options.method).toBe('POST');
      expect(options.headers['Content-Type']).toBe('application/json');

      // Verify the proxied body includes projectId and runId from URL params
      const body = JSON.parse(options.body);
      expect(body.projectId).toBe(projectId);
      expect(body.runId).toBe(runId);
    });
  });

  // =========================================================================
  // Test 4: POST reprocess returns 503 on network error
  // =========================================================================
  describe('POST reprocess route network error handling', () => {
    it('returns 503 with structured error when discovery-service is unreachable', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const response = await request(app)
        .post(`/api/v1/discovery/projects/${projectId}/architectures/${architectureId}/runs/${runId}/reprocess`)
        .send({});

      expect(response.status).toBe(503);
      expect(response.body.error).toBeDefined();
      expect(response.body.error.code).toBe(503);
      expect(response.body.error.message).toBe('Discovery service unavailable');
    });
  });
});
