/**
 * Gap-Fill Tests for Discovery Read Proxy Routes
 *
 * Spec: Discovery Results Visibility (Increment 12)
 * Task Group 7: Test Review and Gap Analysis (Task 7.3)
 *
 * These tests fill coverage gaps identified in the Task Group 7 review:
 * - Backend returns non-200 status (e.g., 404) and the gateway forwards it transparently
 * - Backend returns 500 internal server error, forwarded transparently
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

describe('Discovery Read Proxy Routes Gap-Fill (Task Group 7)', () => {
  let app: express.Application;

  const projectId = '550e8400-e29b-41d4-a716-446655440000';
  const architectureId = 'arch-test-default';
  const runId = 'run-nonexistent-123';

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
  // Gap 1: Backend returns 404 for non-existent run, forwarded transparently
  // =========================================================================
  describe('non-200 backend response forwarding', () => {
    it('forwards 404 status when backend returns not-found for a specific run', async () => {
      const errorBody = {
        status: 404,
        message: `Discovery run not found: ${runId}`,
      };

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => errorBody,
      });

      const response = await request(app)
        .get(`/api/v1/discovery/projects/${projectId}/architectures/${architectureId}/runs/${runId}`);

      // Gateway should forward the 404 transparently
      expect(response.status).toBe(404);
      expect(response.body.status).toBe(404);
      expect(response.body.message).toContain('not found');

      // Verify fetch was called
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe(`http://localhost:8080/api/model/projects/${projectId}/architectures/${architectureId}/discovery/runs/${runId}`);
    });

    it('forwards 500 status when backend returns internal server error for summary', async () => {
      const errorBody = {
        error: 'Internal server error',
        message: 'Database connection pool exhausted',
      };

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => errorBody,
      });

      const response = await request(app)
        .get(`/api/v1/discovery/projects/${projectId}/architectures/${architectureId}/summary`);

      // Gateway should forward the 500 transparently
      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal server error');
    });
  });

  // =========================================================================
  // Gap 2: 503 for entity-origins endpoint specifically
  // =========================================================================
  describe('entity-origins network failure', () => {
    it('returns 503 when entity-origins backend is unreachable', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const response = await request(app)
        .get(`/api/v1/discovery/projects/${projectId}/architectures/${architectureId}/entity-origins`);

      expect(response.status).toBe(503);
      expect(response.body.error).toBeDefined();
      expect(response.body.error.code).toBe(503);
      expect(response.body.error.message).toBe('Architecture model service unavailable');
    });
  });
});
