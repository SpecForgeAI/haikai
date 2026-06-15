/**
 * Tests for Route Refactoring to use implementationLlmProxyClient
 *
 * Spec 2026-02-01: Unify Implementation LLM Proxy Service Config
 * Task Group 3: Route Refactoring
 *
 * These tests verify that routes correctly use the new unified client.
 */

// Mock logger to prevent console output during tests
jest.mock('../../services/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

// Mock the new implementationLlmProxyClient
const mockPostJson = jest.fn();
const mockRequestStream = jest.fn();
jest.mock('../../services/implementationLlmProxyClient', () => ({
  postJson: mockPostJson,
  requestStream: mockRequestStream,
}));

// Mock the config
jest.mock('../../config', () => ({
  getConfig: jest.fn(() => ({
    architectureModelServiceBaseUrl: 'http://localhost:8080',
    implementationLlmServiceBaseUrl: 'http://localhost:8000',
    implementationLlmServiceBearerToken: 'test-token',
  })),
}));

import express from 'express';
import request from 'supertest';
import { standardsGenerateRouter } from '../standardsGenerate';
import { projectStandardsGenerateRouter } from '../projectStandardsGenerate';
import { shapeSpecRouter } from '../shapeSpec';
import { Readable } from 'stream';

describe('Route Refactoring Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('standardsGenerate.ts', () => {
    const app = express();
    app.use(express.json());
    app.use('/api/v1/standards/global', standardsGenerateRouter);

    it('should use postJson for upstream call to /api/v1/standards/global/generate', async () => {
      // Arrange
      const mockOrganisationResponse = new Response(
        JSON.stringify({ id: 'org-123', name: 'TestCorp' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );

      // Mock fetch for organisation lookup and PATCH
      global.fetch = jest.fn()
        .mockResolvedValueOnce(mockOrganisationResponse) // lookupOrganisationByName
        .mockResolvedValueOnce(new Response(null, { status: 200 })); // PATCH

      // Mock postJson for upstream call
      mockPostJson.mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      // Act
      const response = await request(app)
        .post('/api/v1/standards/global/generate')
        .send({
          company: 'TestCorp',
          sources: ['doc.md'],
          technical_documents: {
            tech_stack: [],
            coding_style: [],
            conventions: [],
            error_handling: [],
            validation: [],
          },
        });

      // Assert
      expect(mockPostJson).toHaveBeenCalledTimes(1);
      expect(mockPostJson).toHaveBeenCalledWith(
        '/api/v1/standards/global/generate',
        expect.objectContaining({
          company: 'TestCorp',
          sources: ['doc.md'],
        })
      );
      expect(response.status).toBe(200);
    });

    it('should return 500 with generic error when token is missing', async () => {
      // Arrange - mock postJson to throw token not configured error
      mockPostJson.mockRejectedValueOnce(
        new Error('Implementation LLM Service Bearer token is not configured')
      );

      // Act
      const response = await request(app)
        .post('/api/v1/standards/global/generate')
        .send({
          company: 'TestCorp',
          sources: [],
          technical_documents: {
            tech_stack: [],
            coding_style: [],
            conventions: [],
            error_handling: [],
            validation: [],
          },
        });

      // Assert - should return generic 500, not expose token absence
      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal server error');
    });
  });

  describe('projectStandardsGenerate.ts', () => {
    const app = express();
    app.use(express.json());
    app.use('/api/v1/standards/project', projectStandardsGenerateRouter);

    it('should use postJson for upstream call to /api/v1/standards/product/generate', async () => {
      // Arrange
      mockPostJson.mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      // Act
      const response = await request(app)
        .post('/api/v1/standards/project/generate')
        .send({
          company: 'TestCorp',
          project: 'MyProject',
          sources: ['source.md'],
        });

      // Assert
      expect(mockPostJson).toHaveBeenCalledTimes(1);
      // Verify the path maps to 'product' not 'project'
      expect(mockPostJson).toHaveBeenCalledWith(
        '/api/v1/standards/product/generate',
        expect.objectContaining({
          company: 'TestCorp',
          project: 'MyProject',
          sources: ['source.md'],
        })
      );
      expect(response.status).toBe(200);
    });

    it('should return 500 with generic error when token is missing', async () => {
      // Arrange - mock postJson to throw token not configured error
      mockPostJson.mockRejectedValueOnce(
        new Error('Implementation LLM Service Bearer token is not configured')
      );

      // Act
      const response = await request(app)
        .post('/api/v1/standards/project/generate')
        .send({
          company: 'TestCorp',
          project: 'MyProject',
          sources: [],
        });

      // Assert - should return generic 500, not expose token absence
      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal server error');
    });
  });

  describe('shapeSpec.ts', () => {
    const app = express();
    app.use(express.json());
    app.use('/api/v2/shape-spec', shapeSpecRouter);

    it('should use requestStream for upstream call', async () => {
      // Arrange - create a mock streaming response
      const mockStream = new Readable({
        read() {
          this.push('data: test\n\n');
          this.push(null);
        },
      });

      const mockResponse = {
        ok: true,
        status: 200,
        body: mockStream,
      };

      mockRequestStream.mockResolvedValueOnce(mockResponse);

      // Act
      const response = await request(app)
        .post('/api/v2/shape-spec/stream')
        .send({
          company: 'Global',
          project: 'TestProject',
          message: 'Hello',
        });

      // Assert
      expect(mockRequestStream).toHaveBeenCalledTimes(1);
      expect(mockRequestStream).toHaveBeenCalledWith(
        '/api/v2/shape-spec/stream',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: expect.any(AbortSignal),
        })
      );
    });

    it('should return 500 with generic error when token is missing', async () => {
      // Arrange - mock requestStream to throw token not configured error
      mockRequestStream.mockRejectedValueOnce(
        new Error('Implementation LLM Service Bearer token is not configured')
      );

      // Act
      const response = await request(app)
        .post('/api/v2/shape-spec/stream')
        .send({
          company: 'Global',
          project: 'TestProject',
          message: 'Hello',
        });

      // Assert - should return generic 500, not expose token absence
      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal server error');
    });
  });
});
