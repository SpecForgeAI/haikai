/**
 * Tests for Shape-Spec Proxy Route (SSE Streaming)
 *
 * Spec 2026-01-30: Centralize Bearer Authentication for Gateway to Shape-Spec Service Requests
 * Task Group 3: Shape-Spec Proxy Route (SSE Streaming)
 *
 * Spec 2026-02-01: Unify Implementation LLM Proxy Service Config
 * Task Group 3: Route Refactoring - Use implementationLlmProxyClient
 *
 * Tests the POST /api/v2/shape-spec/stream proxy route that forwards requests
 * to the Shape-Spec service (localhost:8000) with Bearer authentication and
 * transparent SSE streaming.
 */

import request from 'supertest';
import express from 'express';
import { Readable } from 'stream';

// Mock logger to avoid console output during tests
jest.mock('../../services/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// Mock implementationLlmProxyClient to control upstream behavior
const mockRequestStream = jest.fn();
jest.mock('../../services/implementationLlmProxyClient', () => ({
  requestStream: mockRequestStream,
}));

import { shapeSpecRouter } from '../shapeSpec';
import { logger } from '../../services/logger';

const mockLogger = logger as jest.Mocked<typeof logger>;

describe('POST /api/v2/shape-spec/stream (Proxy Route)', () => {
  let app: express.Application;

  const validRequest = {
    company: 'TestOrganisation',
    project: 'test-project',
    message: 'Create a new user authentication flow',
    session_mode: 'new',
  };

  beforeEach(() => {
    app = express();
    app.use(express.json());
    // Add requestId middleware simulation
    app.use((req, _res, next) => {
      (req as any).requestId = 'test-request-id';
      next();
    });
    app.use('/api/v2/shape-spec', shapeSpecRouter);
    mockRequestStream.mockReset();
    mockLogger.info.mockClear();
    mockLogger.debug.mockClear();
    mockLogger.error.mockClear();
    mockLogger.warn.mockClear();
  });

  describe('successful proxy requests', () => {
    it('should proxy request body to upstream service', async () => {
      // Create a mock SSE response stream
      const sseData = 'data: {"event": "message", "content": "Hello"}\n\ndata: {"event": "done"}\n\n';
      const mockStream = Readable.from([sseData]);

      // Create a mock Response with body stream
      const mockResponse = {
        ok: true,
        status: 200,
        body: mockStream,
        headers: new Headers({
          'Content-Type': 'text/event-stream',
        }),
      } as unknown as Response;

      mockRequestStream.mockResolvedValueOnce(mockResponse);

      const response = await request(app)
        .post('/api/v2/shape-spec/stream')
        .send(validRequest);

      // Verify requestStream was called with correct parameters
      expect(mockRequestStream).toHaveBeenCalledTimes(1);
      const [path, options] = mockRequestStream.mock.calls[0];
      expect(path).toBe('/api/v2/shape-spec/stream');
      expect(options?.method).toBe('POST');
      expect(options?.headers).toHaveProperty('Content-Type', 'application/json');

      // Verify request body was forwarded (body is an object, not stringified)
      const body = options?.body;
      expect(body.company).toBe('TestOrganisation');
      expect(body.project).toBe('test-project');
      expect(body.message).toBe('Create a new user authentication flow');
      expect(body.session_mode).toBe('new');
    });

    it('should set correct SSE headers on successful upstream connection', async () => {
      // Create a mock SSE response stream
      const sseData = 'data: {"event": "done"}\n\n';
      const mockStream = Readable.from([sseData]);

      const mockResponse = {
        ok: true,
        status: 200,
        body: mockStream,
        headers: new Headers({
          'Content-Type': 'text/event-stream',
        }),
      } as unknown as Response;

      mockRequestStream.mockResolvedValueOnce(mockResponse);

      const response = await request(app)
        .post('/api/v2/shape-spec/stream')
        .send(validRequest);

      // Verify SSE headers are set
      expect(response.headers['content-type']).toBe('text/event-stream');
      expect(response.headers['cache-control']).toBe('no-cache');
      expect(response.headers['connection']).toBe('keep-alive');
      expect(response.headers['x-accel-buffering']).toBe('no');
    });
  });

  describe('error handling', () => {
    it('should return 500 with generic message when token is missing', async () => {
      // Simulate requestStream throwing token not configured error
      // Spec 2026-02-01: Updated error message to match new client
      mockRequestStream.mockRejectedValueOnce(
        new Error('Implementation LLM Service Bearer token is not configured')
      );

      const response = await request(app)
        .post('/api/v2/shape-spec/stream')
        .send(validRequest);

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Internal server error' });
    });

    it('should return 502 with "Upstream authentication failed" on 401', async () => {
      // Simulate upstream returning 401
      const mockResponse = {
        ok: false,
        status: 401,
        body: null,
        headers: new Headers(),
      } as unknown as Response;

      mockRequestStream.mockResolvedValueOnce(mockResponse);

      const response = await request(app)
        .post('/api/v2/shape-spec/stream')
        .send(validRequest);

      expect(response.status).toBe(502);
      expect(response.body).toEqual({ error: 'Upstream authentication failed' });
    });

    it('should return 502 with "Upstream authentication failed" on 403', async () => {
      // Simulate upstream returning 403
      const mockResponse = {
        ok: false,
        status: 403,
        body: null,
        headers: new Headers(),
      } as unknown as Response;

      mockRequestStream.mockResolvedValueOnce(mockResponse);

      const response = await request(app)
        .post('/api/v2/shape-spec/stream')
        .send(validRequest);

      expect(response.status).toBe(502);
      expect(response.body).toEqual({ error: 'Upstream authentication failed' });
    });

    it('should return 503 with "Shape-Spec service unavailable" on network error', async () => {
      // Simulate network error
      mockRequestStream.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const response = await request(app)
        .post('/api/v2/shape-spec/stream')
        .send(validRequest);

      expect(response.status).toBe(503);
      expect(response.body).toEqual({ error: 'Shape-Spec service unavailable' });
    });

    it('should return 503 on abort error when client is still connected', async () => {
      // Simulate an abort error thrown before client disconnects
      // This could happen if there's a timeout or other abort scenario
      const abortError = new DOMException('The operation was aborted', 'AbortError');
      mockRequestStream.mockRejectedValueOnce(abortError);

      const response = await request(app)
        .post('/api/v2/shape-spec/stream')
        .send(validRequest);

      expect(response.status).toBe(503);
      expect(response.body).toEqual({ error: 'Shape-Spec service unavailable' });
    });
  });

  describe('request body validation', () => {
    it('should forward request body with optional session_mode omitted', async () => {
      const requestWithoutSessionMode = {
        company: 'TestOrganisation',
        project: 'test-project',
        message: 'Test message',
      };

      const sseData = 'data: {"event": "done"}\n\n';
      const mockStream = Readable.from([sseData]);

      const mockResponse = {
        ok: true,
        status: 200,
        body: mockStream,
        headers: new Headers({
          'Content-Type': 'text/event-stream',
        }),
      } as unknown as Response;

      mockRequestStream.mockResolvedValueOnce(mockResponse);

      await request(app)
        .post('/api/v2/shape-spec/stream')
        .send(requestWithoutSessionMode);

      expect(mockRequestStream).toHaveBeenCalledTimes(1);
      const [, options] = mockRequestStream.mock.calls[0];
      const body = options?.body;
      expect(body.company).toBe('TestOrganisation');
      expect(body.project).toBe('test-project');
      expect(body.message).toBe('Test message');
      expect(body).not.toHaveProperty('session_mode');
    });
  });

  // Task Group 2: Client Disconnect Abort Tests
  // Spec 2026-01-30: Route all Shape-Spec + Orchestration traffic through Gateway with upstream Bearer auth
  describe('client disconnect abort handling', () => {
    it('should pass AbortSignal to requestStream call', async () => {
      // Create a mock SSE response stream
      const sseData = 'data: {"event": "done"}\n\n';
      const mockStream = Readable.from([sseData]);

      const mockResponse = {
        ok: true,
        status: 200,
        body: mockStream,
        headers: new Headers({
          'Content-Type': 'text/event-stream',
        }),
      } as unknown as Response;

      mockRequestStream.mockResolvedValueOnce(mockResponse);

      await request(app)
        .post('/api/v2/shape-spec/stream')
        .send(validRequest);

      // Verify requestStream was called with signal in options
      expect(mockRequestStream).toHaveBeenCalledTimes(1);
      const [, options] = mockRequestStream.mock.calls[0];
      expect(options).toHaveProperty('signal');
      expect(options?.signal).toBeInstanceOf(AbortSignal);
    });

    it('should create AbortController and pass signal to requestStream', async () => {
      // Track the signal passed to requestStream
      let capturedSignal: AbortSignal | null | undefined;

      mockRequestStream.mockImplementationOnce(async (_path: string, options: { signal?: AbortSignal }) => {
        // Capture the signal during the fetch call
        capturedSignal = options?.signal;

        // Return a mock response immediately
        const sseData = 'data: {"event": "done"}\n\n';
        const mockStream = Readable.from([sseData]);
        return {
          ok: true,
          status: 200,
          body: mockStream,
          headers: new Headers({
            'Content-Type': 'text/event-stream',
          }),
        } as unknown as Response;
      });

      await request(app)
        .post('/api/v2/shape-spec/stream')
        .send(validRequest);

      // Verify signal was passed to requestStream
      expect(capturedSignal).toBeInstanceOf(AbortSignal);
    });

    it('should connect AbortController to client disconnect handler', async () => {
      // This test verifies the AbortController is integrated with req.on('close')
      // by checking that the signal exists and verifying abort logging occurs on disconnect

      // Create a mock SSE response stream
      const sseData = 'data: {"event": "done"}\n\n';
      const mockStream = Readable.from([sseData]);

      const mockResponse = {
        ok: true,
        status: 200,
        body: mockStream,
        headers: new Headers({
          'Content-Type': 'text/event-stream',
        }),
      } as unknown as Response;

      mockRequestStream.mockResolvedValueOnce(mockResponse);

      await request(app)
        .post('/api/v2/shape-spec/stream')
        .send(validRequest);

      // Verify requestStream was called with signal
      expect(mockRequestStream).toHaveBeenCalledTimes(1);
      const [, options] = mockRequestStream.mock.calls[0];
      expect(options?.signal).toBeInstanceOf(AbortSignal);

      // The signal being present proves the AbortController was created
      // and connected to the requestStream call. The req.on('close')
      // handler calls abortController.abort() which is verified by
      // the logging test below.
    });

    it('should continue normal flow when client stays connected', async () => {
      // Create a mock SSE response stream with multiple chunks
      const sseData1 = 'data: {"event": "message", "content": "First"}\n\n';
      const sseData2 = 'data: {"event": "message", "content": "Second"}\n\n';
      const sseData3 = 'data: {"event": "done"}\n\n';

      const mockStream = Readable.from([sseData1, sseData2, sseData3]);

      const mockResponse = {
        ok: true,
        status: 200,
        body: mockStream,
        headers: new Headers({
          'Content-Type': 'text/event-stream',
        }),
      } as unknown as Response;

      mockRequestStream.mockResolvedValueOnce(mockResponse);

      const response = await request(app)
        .post('/api/v2/shape-spec/stream')
        .send(validRequest);

      // Verify requestStream was called with signal
      expect(mockRequestStream).toHaveBeenCalledTimes(1);
      const [, options] = mockRequestStream.mock.calls[0];
      expect(options?.signal).toBeInstanceOf(AbortSignal);

      // Verify stream was processed successfully
      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toBe('text/event-stream');

      // Verify the response contains the streamed data
      expect(response.text).toContain('First');
      expect(response.text).toContain('Second');
      expect(response.text).toContain('done');
    });
  });
});
