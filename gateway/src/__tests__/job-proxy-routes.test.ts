/**
 * Tests for Job Proxy Routes
 *
 * Spec 2026-02-06: Implement-Part Sequencing Workflow
 * Task Group 2: Gateway Job Proxy Routes
 *
 * Tests:
 * 1. POST /api/v2/jobs/orchestrations request validation
 * 2. POST /api/v2/jobs/orchestrations successful proxy response
 * 3. GET /api/v2/jobs/{job_id} successful status polling
 * 4. Upstream auth failure handling (401/403 -> 502)
 * 5. Network error handling (503 response)
 * 6. Request body validation for required fields
 */

import request from 'supertest';
import express from 'express';
import { orchestrationsRouter } from '../routes/orchestrations';
import { resetConfig } from '../config';

// Mock fetch globally for proxying to external service
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

describe('Job Proxy Routes (Spec 2026-02-06)', () => {
  let app: express.Application;

  const validJobRequest = {
    company: 'TestOrg',
    project: 'test-project',
    spec_intents: [
      {
        spec_name: 'implement-user-authentication',
        session_id: 'session-abc-123',
      },
    ],
  };

  beforeEach(() => {
    app = express();
    app.use(express.json());
    // Add requestId middleware simulation
    app.use((req, _res, next) => {
      (req as any).requestId = 'test-request-id';
      next();
    });
    app.use('/api/orchestrations', orchestrationsRouter);
    mockFetch.mockReset();
    resetConfig();
    // Set required environment variable
    process.env.OPENAI_API_KEY = 'test-key';
  });

  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.ORCHESTRATION_SERVICE_BASE_URL;
  });

  describe('POST /api/v2/jobs/orchestrations', () => {
    describe('successful proxy requests', () => {
      it('should return 200 with job_id when upstream creates job successfully', async () => {
        const createJobResponse = {
          job_id: 'job-abc-123',
          status: 'queued',
        };

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => createJobResponse,
        });

        const response = await request(app)
          .post('/api/orchestrations/v2/jobs/orchestrations')
          .send(validJobRequest);

        expect(response.status).toBe(200);
        expect(response.body.job_id).toBe('job-abc-123');
        expect(response.body.status).toBe('queued');
      });

      it('should forward request body with correct structure to upstream', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ job_id: 'job-123', status: 'queued' }),
        });

        await request(app)
          .post('/api/orchestrations/v2/jobs/orchestrations')
          .send(validJobRequest);

        expect(mockFetch).toHaveBeenCalledTimes(1);
        const [url, options] = mockFetch.mock.calls[0];

        expect(url).toContain('/api/v2/jobs/orchestrations');
        expect(options.method).toBe('POST');
        expect(options.headers['Content-Type']).toBe('application/json');

        const body = JSON.parse(options.body);
        expect(body.company).toBe('TestOrg');
        expect(body.project).toBe('test-project');
        expect(body.spec_intents).toEqual([{ spec_name: 'implement-user-authentication', session_id: 'session-abc-123' }]);
      });

      it('should inject server-side Bearer token (not browser auth)', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ job_id: 'job-123', status: 'queued' }),
        });

        await request(app)
          .post('/api/orchestrations/v2/jobs/orchestrations')
          .set('Authorization', 'Bearer browser-token-should-be-ignored')
          .send(validJobRequest);

        expect(mockFetch).toHaveBeenCalledTimes(1);
        const [, options] = mockFetch.mock.calls[0];
        // Server-side token should be injected by implementationLlmProxyClient
        // Not the browser-provided token
        expect(options.headers['Authorization']).not.toBe('Bearer browser-token-should-be-ignored');
      });
    });

    describe('request validation', () => {
      it('should return 400 when company is missing', async () => {
        const invalidRequest = { ...validJobRequest };
        delete (invalidRequest as any).company;

        const response = await request(app)
          .post('/api/orchestrations/v2/jobs/orchestrations')
          .send(invalidRequest);

        expect(response.status).toBe(400);
        expect(response.body.success).toBe(false);
        expect(response.body.error.message).toContain('company');
        expect(mockFetch).not.toHaveBeenCalled();
      });

      it('should return 400 when project is missing', async () => {
        const invalidRequest = { ...validJobRequest };
        delete (invalidRequest as any).project;

        const response = await request(app)
          .post('/api/orchestrations/v2/jobs/orchestrations')
          .send(invalidRequest);

        expect(response.status).toBe(400);
        expect(response.body.success).toBe(false);
        expect(response.body.error.message).toContain('project');
        expect(mockFetch).not.toHaveBeenCalled();
      });

      it('should return 400 when spec_intents is missing', async () => {
        const invalidRequest = { ...validJobRequest };
        delete (invalidRequest as any).spec_intents;

        const response = await request(app)
          .post('/api/orchestrations/v2/jobs/orchestrations')
          .send(invalidRequest);

        expect(response.status).toBe(400);
        expect(response.body.success).toBe(false);
        expect(response.body.error.message).toContain('spec_intents');
        expect(mockFetch).not.toHaveBeenCalled();
      });

      it('should return 400 when spec_intents is empty array', async () => {
        const invalidRequest = { ...validJobRequest, spec_intents: [] };

        const response = await request(app)
          .post('/api/orchestrations/v2/jobs/orchestrations')
          .send(invalidRequest);

        expect(response.status).toBe(400);
        expect(response.body.success).toBe(false);
        expect(response.body.error.message).toContain('spec_intents');
        expect(mockFetch).not.toHaveBeenCalled();
      });
    });

    describe('error handling', () => {
      it('should return 502 for upstream auth failures (401)', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 401,
          json: async () => ({ error: 'Unauthorized' }),
        });

        const response = await request(app)
          .post('/api/orchestrations/v2/jobs/orchestrations')
          .send(validJobRequest);

        expect(response.status).toBe(502);
        expect(response.body.error).toBe('Upstream authentication failed');
      });

      it('should return 502 for upstream auth failures (403)', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 403,
          json: async () => ({ error: 'Forbidden' }),
        });

        const response = await request(app)
          .post('/api/orchestrations/v2/jobs/orchestrations')
          .send(validJobRequest);

        expect(response.status).toBe(502);
        expect(response.body.error).toBe('Upstream authentication failed');
      });

      it('should return 503 for network errors', async () => {
        mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

        const response = await request(app)
          .post('/api/orchestrations/v2/jobs/orchestrations')
          .send(validJobRequest);

        expect(response.status).toBe(503);
        expect(response.body.success).toBe(false);
        expect(response.body.error.code).toBe(503);
      });
    });
  });

  describe('GET /api/v2/jobs/:job_id', () => {
    describe('successful status polling', () => {
      it('should return 200 with job status when polling succeeds', async () => {
        const jobStatusResponse = {
          status: 'running',
        };

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => jobStatusResponse,
        });

        const response = await request(app)
          .get('/api/orchestrations/v2/jobs/job-abc-123');

        expect(response.status).toBe(200);
        expect(response.body.status).toBe('running');
      });

      it('should return completed status with no error', async () => {
        const jobStatusResponse = {
          status: 'completed',
        };

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => jobStatusResponse,
        });

        const response = await request(app)
          .get('/api/orchestrations/v2/jobs/job-completed-123');

        expect(response.status).toBe(200);
        expect(response.body.status).toBe('completed');
        expect(response.body.error).toBeUndefined();
      });

      it('should return failed status with error message', async () => {
        const jobStatusResponse = {
          status: 'failed',
          error: 'Orchestration timeout after 300 seconds',
        };

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => jobStatusResponse,
        });

        const response = await request(app)
          .get('/api/orchestrations/v2/jobs/job-failed-123');

        expect(response.status).toBe(200);
        expect(response.body.status).toBe('failed');
        expect(response.body.error).toBe('Orchestration timeout after 300 seconds');
      });

      it('should extract job_id from URL params correctly', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ status: 'queued' }),
        });

        await request(app)
          .get('/api/orchestrations/v2/jobs/my-unique-job-id-456');

        expect(mockFetch).toHaveBeenCalledTimes(1);
        const [url] = mockFetch.mock.calls[0];
        expect(url).toContain('/api/v2/jobs/my-unique-job-id-456');
      });
    });

    describe('error handling', () => {
      it('should return 502 for upstream auth failures on status poll', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 401,
          json: async () => ({ error: 'Unauthorized' }),
        });

        const response = await request(app)
          .get('/api/orchestrations/v2/jobs/job-abc-123');

        expect(response.status).toBe(502);
        expect(response.body.error).toBe('Upstream authentication failed');
      });

      it('should return 503 for network errors on status poll', async () => {
        mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

        const response = await request(app)
          .get('/api/orchestrations/v2/jobs/job-abc-123');

        expect(response.status).toBe(503);
        expect(response.body.success).toBe(false);
        expect(response.body.error.code).toBe(503);
      });

      it('should forward 404 transparently when job not found', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 404,
          json: async () => ({ error: 'Job not found' }),
        });

        const response = await request(app)
          .get('/api/orchestrations/v2/jobs/nonexistent-job');

        expect(response.status).toBe(404);
        expect(response.body.error).toBe('Job not found');
      });
    });
  });
});
