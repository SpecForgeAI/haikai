/**
 * Tests for Standards Generation Route - New External-Compatible Payload
 *
 * Spec 2026-01-31: Fix Create Organisation Standards Flow
 * Task Group 4: Gateway Standards Route - Resolve Org by Name
 *
 * Spec 2026-02-01: Unify Implementation LLM Proxy Service Config
 * - Upstream call now uses postJson from implementationLlmProxyClient
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

describe('Standards Generate Route - New External-Compatible Payload', () => {
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

  // New external-compatible request format (no organisationId)
  const newFormatRequestBody = {
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

  describe('POST /generate - New payload format', () => {
    it('accepts external-compatible format with company, sources, technical_documents', async () => {
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
        json: async () => ({ id: 'org-resolved', name: 'Test Corp', description: null }),
      });

      // Mock successful backend PATCH response (raw fetch)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({}),
      });

      const response = await request(app)
        .post('/api/v1/standards/global/generate')
        .send(newFormatRequestBody)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Standards generated successfully');
    });

    it('returns 400 when company is missing', async () => {
      const invalidBody = { ...newFormatRequestBody };
      delete (invalidBody as any).company;

      const response = await request(app)
        .post('/api/v1/standards/global/generate')
        .send(invalidBody)
        .expect(400);

      expect(response.body.error).toBe('company is required');
    });

    it('forwards request directly to external service (already in correct format)', async () => {
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
        .send(newFormatRequestBody);

      // Verify postJson was called with correct path and body
      const [path, upstreamBody] = mockPostJson.mock.calls[0];
      expect(path).toBe('/api/v1/standards/global/generate');
      expect(upstreamBody.company).toBe('Test Corp');
      expect(upstreamBody.sources).toEqual(['doc1.md']);
      expect(upstreamBody.technical_documents.tech_stack).toEqual(['tech.md']);
      expect(upstreamBody.technical_documents.coding_style).toEqual(['style.md']);
    });

    it('resolves organisationId by company name after successful generation', async () => {
      // Mock successful upstream response via postJson
      mockPostJson.mockResolvedValueOnce({
        ok: true,
        status: 200,
      });

      // Mock organisation lookup by name (raw fetch)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 'org-looked-up', name: 'Test Corp', description: null }),
      });

      // Mock successful backend PATCH response (raw fetch)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
      });

      await request(app)
        .post('/api/v1/standards/global/generate')
        .send(newFormatRequestBody)
        .expect(200);

      // Verify org lookup (first fetch call)
      expect(mockFetch).toHaveBeenCalledTimes(2);
      const lookupCall = mockFetch.mock.calls[0];
      expect(lookupCall[0]).toBe('http://localhost:8080/api/v1/organisations/by-name/Test%20Corp');
      expect(lookupCall[1].method).toBe('GET');

      // Verify backend PATCH (second fetch call)
      const patchCall = mockFetch.mock.calls[1];
      expect(patchCall[0]).toBe('http://localhost:8080/api/v1/organisations/org-looked-up');
      expect(patchCall[1].method).toBe('PATCH');
    });

    it('still returns success if organisation lookup fails', async () => {
      mockPostJson.mockResolvedValueOnce({
        ok: true,
        status: 200,
      });
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      const response = await request(app)
        .post('/api/v1/standards/global/generate')
        .send(newFormatRequestBody)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.flagUpdateFailed).toBe(true);
    });

    it('handles URL encoding for company names with special characters', async () => {
      mockPostJson.mockResolvedValueOnce({
        ok: true,
        status: 200,
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 'org-special', name: 'Test & Corp / Ltd.', description: null }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
      });

      await request(app)
        .post('/api/v1/standards/global/generate')
        .send({
          ...newFormatRequestBody,
          company: 'Test & Corp / Ltd.',
        })
        .expect(200);

      // Verify URL encoding was applied (org lookup is first fetch call)
      const lookupCall = mockFetch.mock.calls[0];
      expect(lookupCall[0]).toBe('http://localhost:8080/api/v1/organisations/by-name/Test%20%26%20Corp%20%2F%20Ltd.');
    });
  });
});
