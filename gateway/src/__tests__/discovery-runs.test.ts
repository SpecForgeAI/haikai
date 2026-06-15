/**
 * Tests for Discovery Run Proxy Routes
 *
 * Spec 2026-04-04: Discovery Run Model and Orchestration
 * Task Group 6: Gateway Proxy Routes for Discovery Runs
 *
 * Spec 2026-05-01: Multi-Architecture Discovery Integration (Spec #4) -- Task Group 3
 *  Routes are now architecture-scoped: every Discovery proxy that previously
 *  used `/api/v1/discovery/runs/...` (or `/api/v1/discovery/projects/:projectId/...`)
 *  now embeds `:architectureId` between `:projectId` and the rest of the path.
 *  This file was mechanically updated by spec #4 Group 9 cleanup to use the
 *  architecture-scoped URL shape; the test logic / forwarding behaviour is
 *  unchanged.
 *
 * Tests:
 * 1. POST /api/v1/discovery/projects/:projectId/architectures/:architectureId/runs proxies to discovery-service and returns 200 with run DTO
 * 2. POST .../runs returns 503 when discovery-service is unreachable
 * 3. GET /api/v1/discovery/projects/:projectId/architectures/:architectureId/runs/:runId proxies to architecture-model-service and returns 200 with run DTO
 * 4. Existing GET /api/v1/discovery capability descriptor still works (regression check)
 *
 * Gap Tests (Task Group 8):
 * 5. POST .../runs forwards 409 from discovery-service transparently
 * 6. GET .../runs/:runId forwards 400 from the backend transparently
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

describe('Discovery Run Proxy Routes (Spec 2026-04-04, Task Group 6)', () => {
  let app: express.Application;

  const projectId = '550e8400-e29b-41d4-a716-446655440000';
  const architectureId = 'arch-test-default';
  const runId = 'run-abc-123';

  const sampleRunDto = {
    id: runId,
    project_id: projectId,
    architecture_id: architectureId,
    status: 'PENDING',
    current_step: null,
    config_snapshot: { sources: ['repo-url'] },
    steps_payload: {
      '1a': { status: 'pending' },
      '1b': { status: 'pending' },
      '1c': { status: 'pending' },
      '1d': { status: 'pending' },
    },
    error_message: null,
    created_at: '2026-04-04T12:00:00Z',
    updated_at: '2026-04-04T12:00:00Z',
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

  describe('POST /api/v1/discovery/projects/:projectId/architectures/:architectureId/runs', () => {
    it('proxies to discovery-service and returns 200 with run DTO', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => sampleRunDto,
      });

      const response = await request(app)
        .post(`/api/v1/discovery/projects/${projectId}/architectures/${architectureId}/runs`)
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(runId);
      expect(response.body.project_id).toBe(projectId);
      expect(response.body.status).toBe('PENDING');

      // Verify fetch was called with correct URL and method
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toContain(`/discovery/projects/${projectId}/architectures/${architectureId}/runs`);
      expect(options.method).toBe('POST');
      expect(options.headers['Content-Type']).toBe('application/json');
    });

    it('returns 503 when discovery-service is unreachable', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const response = await request(app)
        .post(`/api/v1/discovery/projects/${projectId}/architectures/${architectureId}/runs`)
        .send({});

      expect(response.status).toBe(503);
      expect(response.body.error).toBeDefined();
      expect(response.body.error.code).toBe(503);
      expect(response.body.error.message).toBe('Discovery service unavailable');
    });
  });

  describe('GET /api/v1/discovery/projects/:projectId/architectures/:architectureId/runs/:runId', () => {
    it('proxies to architecture-model-service and returns 200 with run DTO', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => sampleRunDto,
      });

      const response = await request(app)
        .get(`/api/v1/discovery/projects/${projectId}/architectures/${architectureId}/runs/${runId}`);

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(runId);
      expect(response.body.status).toBe('PENDING');

      // Verify fetch was called with correct URL embedding projectId, architectureId, runId
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toContain(`/projects/${projectId}/architectures/${architectureId}/discovery/runs/${runId}`);
      expect(options.method).toBe('GET');
    });
  });

  describe('GET /api/v1/discovery (regression)', () => {
    it('returns 200 with discovery capability descriptor', async () => {
      const response = await request(app)
        .get('/api/v1/discovery')
        .expect(200);

      expect(response.body).toEqual({
        capability: 'discovery',
        status: 'registered',
        version: '0.1.0',
      });

      // Ensure no fetch call was made for the capability descriptor
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Gap Tests (Task Group 8: Test Review and Integration Verification)
  // ==========================================================================

  describe('Gap Test 7: POST .../runs forwards 409 transparently', () => {
    it('forwards 409 from discovery-service when an active run already exists', async () => {
      const conflictResponse = {
        error: `Active run already exists for project: ${projectId}`,
      };

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => conflictResponse,
      });

      const response = await request(app)
        .post(`/api/v1/discovery/projects/${projectId}/architectures/${architectureId}/runs`)
        .send({});

      // The gateway should forward the 409 status transparently
      expect(response.status).toBe(409);
      expect(response.body.error).toContain('Active run already exists');

      // Verify the fetch call was made
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('Gap Test 8: GET .../runs/:runId forwards backend 400 transparently', () => {
    it('forwards a 400 from the backend transparently to the caller', async () => {
      // The gateway proxies the request to architecture-model-service. If the
      // backend returns 400 (e.g. malformed runId or other validation failure),
      // the gateway must forward the status and body verbatim.
      const badRequestResponse = {
        error: {
          code: 400,
          message: 'projectId path parameter is required',
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => badRequestResponse,
      });

      const response = await request(app)
        .get(`/api/v1/discovery/projects/${projectId}/architectures/${architectureId}/runs/${runId}`);

      // The gateway forwards the 400 response transparently from the backend
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe(400);
      expect(response.body.error.message).toContain('projectId');

      // Verify the fetch call was made (gateway still proxies the request)
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });
});
