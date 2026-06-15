/**
 * Tests for Project Standards Generation Route
 *
 * Spec 2026-01-31: Project-level Standards Generation
 * Task Group 1: Gateway Route for Project Standards Generation
 *
 * Spec 2026-02-01: Unify Implementation LLM Proxy Service Config
 * - Upstream call now uses postJson from implementationLlmProxyClient
 *
 * Tests the POST /api/v1/standards/product/generate endpoint:
 * - Successful proxy to external service (200/201 response)
 * - Request body mapping (company, project, sources fields)
 * - 502 response on upstream auth failure (401/403)
 * - 503 response on network errors
 * - 500 response when token not configured
 */

import request from 'supertest';
import express from 'express';
import { projectStandardsGenerateRouter } from '../projectStandardsGenerate';

// Mock the config module
jest.mock('../../config', () => ({
  getConfig: jest.fn(),
}));

// Mock the logger
jest.mock('../../services/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock implementationLlmProxyClient (upstream calls)
const mockPostJson = jest.fn();
jest.mock('../../services/implementationLlmProxyClient', () => ({
  postJson: (...args: unknown[]) => mockPostJson(...args),
}));

describe('Project Standards Generate Route', () => {
  let app: express.Application;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Create express app with the router
    app = express();
    app.use(express.json());
    app.use('/api/v1/standards/product', projectStandardsGenerateRouter);
  });

  const validRequestBody = {
    company: 'Test Corp',
    project: 'My Project',
    sources: ['doc1.md', 'http://example.com/docs'],
  };

  describe('POST /generate', () => {
    it('returns 200 on successful proxy to external service', async () => {
      // Mock successful upstream response via postJson
      mockPostJson.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      });

      const response = await request(app)
        .post('/api/v1/standards/product/generate')
        .send(validRequestBody)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Project standards generated successfully');

      // Verify postJson was called with correct path
      expect(mockPostJson).toHaveBeenCalledTimes(1);
      const [path] = mockPostJson.mock.calls[0];
      expect(path).toBe('/api/v1/standards/product/generate');
    });

    it('correctly maps request body to external API', async () => {
      mockPostJson.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      });

      await request(app)
        .post('/api/v1/standards/product/generate')
        .send(validRequestBody);

      const [, upstreamBody] = mockPostJson.mock.calls[0];

      // Verify request body mapping
      expect(upstreamBody).toEqual({
        company: 'Test Corp',
        project: 'My Project',
        sources: ['doc1.md', 'http://example.com/docs'],
      });
    });

    it('returns 502 on upstream auth failure (401)', async () => {
      mockPostJson.mockResolvedValueOnce({
        ok: false,
        status: 401,
      });

      const response = await request(app)
        .post('/api/v1/standards/product/generate')
        .send(validRequestBody)
        .expect(502);

      expect(response.body.error).toBe('Upstream authentication failed');
    });

    it('returns 502 on upstream auth failure (403)', async () => {
      mockPostJson.mockResolvedValueOnce({
        ok: false,
        status: 403,
      });

      const response = await request(app)
        .post('/api/v1/standards/product/generate')
        .send(validRequestBody)
        .expect(502);

      expect(response.body.error).toBe('Upstream authentication failed');
    });

    it('returns 503 on network error', async () => {
      mockPostJson.mockRejectedValueOnce(new Error('Network error'));

      const response = await request(app)
        .post('/api/v1/standards/product/generate')
        .send(validRequestBody)
        .expect(503);

      expect(response.body.error).toBe('Standards service unavailable');
    });

    it('returns 500 when token not configured', async () => {
      // postJson throws when token is empty
      mockPostJson.mockRejectedValueOnce(
        new Error('Implementation LLM Service Bearer token is not configured')
      );

      const response = await request(app)
        .post('/api/v1/standards/product/generate')
        .send(validRequestBody)
        .expect(500);

      expect(response.body.error).toBe('Internal server error');
    });

    it('returns 400 when company is missing', async () => {
      const invalidBody = { project: 'My Project', sources: [] };

      const response = await request(app)
        .post('/api/v1/standards/product/generate')
        .send(invalidBody)
        .expect(400);

      expect(response.body.error).toBe('company is required');
    });

    it('returns 400 when project is missing', async () => {
      const invalidBody = { company: 'Test Corp', sources: [] };

      const response = await request(app)
        .post('/api/v1/standards/product/generate')
        .send(invalidBody)
        .expect(400);

      expect(response.body.error).toBe('project is required');
    });

    it('handles empty sources array gracefully', async () => {
      mockPostJson.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      });

      const bodyWithEmptySources = {
        company: 'Test Corp',
        project: 'My Project',
        sources: [],
      };

      const response = await request(app)
        .post('/api/v1/standards/product/generate')
        .send(bodyWithEmptySources)
        .expect(200);

      expect(response.body.success).toBe(true);

      const [, upstreamBody] = mockPostJson.mock.calls[0];
      expect(upstreamBody.sources).toEqual([]);
    });

    it('handles missing sources field by defaulting to empty array', async () => {
      mockPostJson.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      });

      const bodyWithoutSources = {
        company: 'Test Corp',
        project: 'My Project',
      };

      await request(app)
        .post('/api/v1/standards/product/generate')
        .send(bodyWithoutSources)
        .expect(200);

      const [, upstreamBody] = mockPostJson.mock.calls[0];
      expect(upstreamBody.sources).toEqual([]);
    });
  });
});
