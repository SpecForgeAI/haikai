/**
 * Integration Tests for Gateway Traffic Routing
 *
 * Spec 2026-01-30: Route all Shape-Spec + Orchestration traffic through Gateway with upstream Bearer auth
 * Task Group 5: Test Review and Integration Verification
 *
 * Spec 2026-02-01: Unify Implementation LLM Proxy Service Config
 * - Updated to use implementationLlmProxyClient (requestStream / request) instead of shapeSpecUpstreamClient
 *
 * Spec 2026-06-12: Implementation-Service Init and Integration Repair
 * - The string-based POST /v1/orchestrations proxy was RETIRED; the
 *   orchestration-side flows below now exercise the kept v2 jobs route
 *   (POST /v2/jobs/orchestrations) with object-shaped spec_intents.
 *
 * These tests verify end-to-end integration points that are not fully covered
 * by the unit tests in Task Groups 1-4. They focus on:
 * - Full request flow: frontend -> Gateway -> implementationLlmProxyClient -> upstream
 * - Auth error handling: upstream 401 -> Gateway -> generic error to frontend
 * - Missing token scenario: implementationLlmProxyClient throws -> 500 to frontend
 */

import request from 'supertest';
import express from 'express';
import { Readable } from 'stream';

// Mock logger to avoid console output during tests
jest.mock('../services/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// Mock implementationLlmProxyClient - requestStream for shapeSpec, request for orchestrations
const mockRequestStream = jest.fn();
const mockRequest = jest.fn();
jest.mock('../services/implementationLlmProxyClient', () => ({
  requestStream: (...args: unknown[]) => mockRequestStream(...args),
  request: (...args: unknown[]) => mockRequest(...args),
}));

// Mock config
jest.mock('../config', () => ({
  getConfig: jest.fn(() => ({
    implementationLlmServiceBaseUrl: 'http://localhost:8000',
    implementationLlmServiceBearerToken: 'test-server-token',
  })),
}));

import { shapeSpecRouter } from '../routes/shapeSpec';
import { orchestrationsRouter } from '../routes/orchestrations';

describe('Gateway Traffic Routing Integration Tests (Spec 2026-01-30)', () => {
  let shapeSpecApp: express.Application;
  let orchestrationsApp: express.Application;

  beforeEach(() => {
    // Reset mocks
    mockRequestStream.mockReset();
    mockRequest.mockReset();

    // Setup express apps
    shapeSpecApp = express();
    shapeSpecApp.use(express.json());
    shapeSpecApp.use((req, _res, next) => {
      (req as any).requestId = 'integration-test-id';
      next();
    });
    shapeSpecApp.use('/api/v2/shape-spec', shapeSpecRouter);

    orchestrationsApp = express();
    orchestrationsApp.use(express.json());
    orchestrationsApp.use((req, _res, next) => {
      (req as any).requestId = 'integration-test-id';
      next();
    });
    orchestrationsApp.use('/api/orchestrations', orchestrationsRouter);
  });

  describe('Full request flow: frontend -> Gateway -> implementationLlmProxyClient -> upstream', () => {
    /**
     * Test 5.3.1: Verify complete request flow through shapeSpec proxy
     * Tests that request body flows from frontend through Gateway to upstream correctly.
     */
    it('should route complete request through shapeSpec proxy with AbortSignal', async () => {
      // Arrange - mock successful upstream response
      const sseData = 'data: {"type":"content","delta":"Test response"}\n\ndata: {"type":"done"}\n\n';
      const mockStream = Readable.from([sseData]);

      const mockResponse = {
        ok: true,
        status: 200,
        body: mockStream,
        headers: new Headers({ 'Content-Type': 'text/event-stream' }),
      } as unknown as Response;

      mockRequestStream.mockResolvedValueOnce(mockResponse);

      // Act - send request through Gateway
      const response = await request(shapeSpecApp)
        .post('/api/v2/shape-spec/stream')
        .send({
          company: 'TestOrg',
          project: 'TestProject',
          message: '/shape-spec test feature',
          session_mode: 'new',
        });

      // Assert
      expect(mockRequestStream).toHaveBeenCalledTimes(1);

      // Verify requestStream was called with correct path
      const [path, options] = mockRequestStream.mock.calls[0];
      expect(path).toBe('/api/v2/shape-spec/stream');

      // Verify AbortSignal was passed (critical for client disconnect handling)
      expect(options?.signal).toBeInstanceOf(AbortSignal);

      // Verify request body was correctly forwarded (as object, not JSON string)
      expect(options?.body?.company).toBe('TestOrg');
      expect(options?.body?.project).toBe('TestProject');
      expect(options?.body?.message).toBe('/shape-spec test feature');
      expect(options?.body?.session_mode).toBe('new');

      // Verify response was streamed back
      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toBe('text/event-stream');
      expect(response.text).toContain('Test response');
    });

    /**
     * Test 5.3.2: Verify complete request flow through orchestrations proxy
     * Tests that request flows correctly with server-side token injection.
     */
    it('should route complete job-creation request through the v2 jobs proxy with server token', async () => {
      // Arrange - mock successful upstream response
      const mockResponse = {
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          job_id: 'job-123',
          status: 'queued',
        }),
      } as unknown as Response;

      mockRequest.mockResolvedValueOnce(mockResponse);

      // Act - send request with browser auth header (should be ignored)
      const response = await request(orchestrationsApp)
        .post('/api/orchestrations/v2/jobs/orchestrations')
        .set('Authorization', 'Bearer browser-token-should-be-ignored')
        .send({
          company: 'TestOrg',
          project: 'TestProject',
          spec_intents: [{ spec_name: '2026-06-12-test-spec' }],
        });

      // Assert
      expect(mockRequest).toHaveBeenCalledTimes(1);

      // Verify browser Authorization header was NOT forwarded to implementationLlmProxyClient
      const [, options] = mockRequest.mock.calls[0];
      const headers = options?.headers as Record<string, string>;
      expect(headers['Authorization']).toBeUndefined();

      // Verify other expected headers are present
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['User-Agent']).toBe('Rivvy-Portal-UI');

      // Verify response was returned successfully
      expect(response.status).toBe(200);
      expect(response.body.job_id).toBe('job-123');
    });
  });

  describe('Auth error handling: upstream 401/403 -> Gateway -> generic error', () => {
    /**
     * Test 5.3.3: Verify 401 returns generic error from shapeSpec proxy
     * Ensures upstream auth details are not leaked to frontend.
     */
    it('should return generic error when shapeSpec upstream returns 401', async () => {
      // Arrange - mock 401 response
      const mockResponse = {
        ok: false,
        status: 401,
        body: null,
        headers: new Headers(),
      } as unknown as Response;

      mockRequestStream.mockResolvedValueOnce(mockResponse);

      // Act
      const response = await request(shapeSpecApp)
        .post('/api/v2/shape-spec/stream')
        .send({
          company: 'TestOrg',
          project: 'TestProject',
          message: '/shape-spec test',
        });

      // Assert - should return 502 with generic error
      expect(response.status).toBe(502);
      expect(response.body).toEqual({ error: 'Upstream authentication failed' });
      // Should NOT contain status code or auth details
      expect(JSON.stringify(response.body)).not.toContain('401');
      expect(JSON.stringify(response.body)).not.toContain('Unauthorized');
    });

    /**
     * Test 5.3.4: Verify 403 returns generic error from orchestrations proxy
     * Ensures upstream auth details are not leaked to frontend.
     */
    it('should return generic error when orchestrations upstream returns 403', async () => {
      // Arrange - mock 403 response with detailed error message
      const mockResponse = {
        ok: false,
        status: 403,
        json: jest.fn().mockResolvedValue({
          error: 'Forbidden - invalid token permissions',
          details: 'Token does not have orchestrations:write scope',
        }),
      } as unknown as Response;

      mockRequest.mockResolvedValueOnce(mockResponse);

      // Act
      const response = await request(orchestrationsApp)
        .post('/api/orchestrations/v2/jobs/orchestrations')
        .send({
          company: 'TestOrg',
          project: 'TestProject',
          spec_intents: [{ spec_name: '2026-06-12-test-spec' }],
        });

      // Assert - should return 502 with generic error
      expect(response.status).toBe(502);
      expect(response.body).toEqual({ error: 'Upstream authentication failed' });
      // Should NOT contain detailed error message
      expect(JSON.stringify(response.body)).not.toContain('Forbidden');
      expect(JSON.stringify(response.body)).not.toContain('scope');
    });
  });

  describe('Missing token scenario: implementationLlmProxyClient throws -> 500 to frontend', () => {
    /**
     * Test 5.3.5: Verify missing token returns 500 from shapeSpec proxy
     * Ensures token configuration errors don't expose details to frontend.
     */
    it('should return 500 when shapeSpec token is not configured', async () => {
      // Arrange - mock requestStream throwing token not configured error
      mockRequestStream.mockRejectedValueOnce(
        new Error('Implementation LLM Service Bearer token is not configured')
      );

      // Act
      const response = await request(shapeSpecApp)
        .post('/api/v2/shape-spec/stream')
        .send({
          company: 'TestOrg',
          project: 'TestProject',
          message: '/shape-spec test',
        });

      // Assert - should return 500 with generic error
      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Internal server error' });
      // Should NOT expose token configuration details
      expect(JSON.stringify(response.body)).not.toContain('token');
      expect(JSON.stringify(response.body)).not.toContain('configured');
    });

    /**
     * Test 5.3.6: Verify missing token returns 500 from orchestrations proxy
     * Ensures token configuration errors don't expose details to frontend.
     */
    it('should return 500 when orchestrations token is not configured', async () => {
      // Arrange - mock request throwing token not configured error
      mockRequest.mockRejectedValueOnce(
        new Error('Implementation LLM Service Bearer token is not configured')
      );

      // Act
      const response = await request(orchestrationsApp)
        .post('/api/orchestrations/v2/jobs/orchestrations')
        .send({
          company: 'TestOrg',
          project: 'TestProject',
          spec_intents: [{ spec_name: '2026-06-12-test-spec' }],
        });

      // Assert - should return 500 with generic error
      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Internal server error' });
      // Should NOT expose token configuration details
      expect(JSON.stringify(response.body)).not.toContain('token');
      expect(JSON.stringify(response.body)).not.toContain('configured');
    });
  });
});
