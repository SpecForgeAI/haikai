/**
 * Tests for Standards Generation Route
 *
 * Spec 2026-01-31: Trigger Global Standards Generation
 * Task Group 3: Gateway Standards Service Client and Route
 *
 * Spec 2026-01-31: Fix Create Organisation Standards Flow
 * Task Group 4: Updated to use new external-compatible payload format
 *
 * Spec 2026-02-01: Unify Implementation LLM Proxy Service Config
 * - Upstream call now uses postJson from implementationLlmProxyClient (not raw fetch)
 * - Config fields renamed: implementationLlmServiceBaseUrl, implementationLlmServiceBearerToken
 * - Org lookup/PATCH still use raw fetch with architectureModelServiceBaseUrl
 */

import request from 'supertest';
import express from 'express';
import { standardsGenerateRouter } from '../standardsGenerate';
import * as configModule from '../../config';

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

// Mock global fetch (org lookup + PATCH calls)
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('Standards Generate Route', () => {
  let app: express.Application;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Default config mock
    (configModule.getConfig as jest.Mock).mockReturnValue({
      implementationLlmServiceBaseUrl: 'http://localhost:8000',
      implementationLlmServiceBearerToken: 'test-token',
      architectureModelServiceBaseUrl: 'http://localhost:8080',
    });

    // Create express app with the router
    app = express();
    app.use(express.json());
    app.use('/api/v1/standards/global', standardsGenerateRouter);
  });

  // Updated to use new external-compatible format (no organisationId)
  const validRequestBody = {
    company: 'Test Corp',
    sources: ['doc1.md'],
    technical_documents: {
      tech_stack: ['tech.md'],
      coding_style: ['style.md'],
      conventions: ['conventions.md'],
      error_handling: ['errors.md'],
      validation: ['validation.md'],
    },
  };

  describe('POST /generate', () => {
    it('returns 200 on successful standards generation', async () => {
      // Mock successful upstream response via postJson
      mockPostJson.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      });

      // Mock organisation lookup by name (raw fetch)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 'org-123', name: 'Test Corp', description: null }),
      });

      // Mock successful backend PATCH response (raw fetch)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({}),
      });

      const response = await request(app)
        .post('/api/v1/standards/global/generate')
        .send(validRequestBody)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Standards generated successfully');

      // Verify postJson was called for upstream
      expect(mockPostJson).toHaveBeenCalledTimes(1);
      const [path, body] = mockPostJson.mock.calls[0];
      expect(path).toBe('/api/v1/standards/global/generate');
      expect(body.company).toBe('Test Corp');
      expect(body.sources).toEqual(['doc1.md']);
      expect(body.technical_documents.tech_stack).toEqual(['tech.md']);

      // Verify fetch was called for org lookup + PATCH
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('correctly passes through request body to external API', async () => {
      mockPostJson.mockResolvedValueOnce({
        ok: true,
        status: 200,
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 'org-123', name: 'Test Corp', description: null }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
      });

      await request(app)
        .post('/api/v1/standards/global/generate')
        .send(validRequestBody);

      const [, upstreamBody] = mockPostJson.mock.calls[0];

      // Verify pass-through
      expect(upstreamBody).toEqual({
        company: 'Test Corp',
        sources: ['doc1.md'],
        technical_documents: {
          tech_stack: ['tech.md'],
          coding_style: ['style.md'],
          conventions: ['conventions.md'],
          error_handling: ['errors.md'],
          validation: ['validation.md'],
        },
      });
    });

    it('returns 502 on upstream auth failure (401)', async () => {
      mockPostJson.mockResolvedValueOnce({
        ok: false,
        status: 401,
      });

      const response = await request(app)
        .post('/api/v1/standards/global/generate')
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
        .post('/api/v1/standards/global/generate')
        .send(validRequestBody)
        .expect(502);

      expect(response.body.error).toBe('Upstream authentication failed');
    });

    it('returns 503 on network error', async () => {
      mockPostJson.mockRejectedValueOnce(new Error('Network error'));

      const response = await request(app)
        .post('/api/v1/standards/global/generate')
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
        .post('/api/v1/standards/global/generate')
        .send(validRequestBody)
        .expect(500);

      // Token-not-configured returns generic 500 (do not expose token absence)
      expect(response.body.error).toBe('Internal server error');
    });

    it('returns 400 when company is missing', async () => {
      const invalidBody = { ...validRequestBody };
      delete (invalidBody as any).company;

      const response = await request(app)
        .post('/api/v1/standards/global/generate')
        .send(invalidBody)
        .expect(400);

      expect(response.body.error).toBe('company is required');
    });

    it('resolves organisation by name and calls backend PATCH on success', async () => {
      mockPostJson.mockResolvedValueOnce({
        ok: true,
        status: 200,
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 'org-resolved-123', name: 'Test Corp', description: null }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
      });

      await request(app)
        .post('/api/v1/standards/global/generate')
        .send(validRequestBody)
        .expect(200);

      // Verify organisation lookup by name (first fetch call)
      expect(mockFetch).toHaveBeenCalledTimes(2);
      const lookupCall = mockFetch.mock.calls[0];
      expect(lookupCall[0]).toBe('http://localhost:8080/api/v1/organisations/by-name/Test%20Corp');
      expect(lookupCall[1].method).toBe('GET');

      // Verify backend PATCH call with resolved ID (second fetch call)
      const patchCall = mockFetch.mock.calls[1];
      expect(patchCall[0]).toBe('http://localhost:8080/api/v1/organisations/org-resolved-123');
      expect(patchCall[1].method).toBe('PATCH');
      const patchBody = JSON.parse(patchCall[1].body);
      expect(patchBody.tech_standards_generated).toBe(true);
    });

    it('still returns success even if backend PATCH fails', async () => {
      // Standards generation succeeds (postJson)
      mockPostJson.mockResolvedValueOnce({
        ok: true,
        status: 200,
      });
      // Organisation lookup succeeds (fetch)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 'org-123', name: 'Test Corp', description: null }),
      });
      // Backend PATCH fails (fetch)
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const response = await request(app)
        .post('/api/v1/standards/global/generate')
        .send(validRequestBody)
        .expect(200);

      // Should still return success (standards were generated)
      expect(response.body.success).toBe(true);
      expect(response.body.flagUpdateFailed).toBe(true);
    });

    it('returns success even if organisation lookup fails', async () => {
      // Standards generation succeeds (postJson)
      mockPostJson.mockResolvedValueOnce({
        ok: true,
        status: 200,
      });
      // Organisation lookup fails (fetch)
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      const response = await request(app)
        .post('/api/v1/standards/global/generate')
        .send(validRequestBody)
        .expect(200);

      // Should still return success (standards were generated)
      expect(response.body.success).toBe(true);
      expect(response.body.flagUpdateFailed).toBe(true);
    });
  });
});
