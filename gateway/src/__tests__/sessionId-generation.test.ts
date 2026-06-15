/**
 * Tests for server-side sessionId generation in chat handlers
 * Task Group 3: Server-Side SessionId Generation
 */

import express, { Express } from 'express';
import request from 'supertest';
import nock from 'nock';
import { chatRouter } from '../routes';
import {
  requestIdMiddleware,
  errorHandler,
} from '../middleware';
import { clearAllSessions } from '../services/sessionStore';

// UUID v4 regex pattern for validation
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Mock config
jest.mock('../config', () => ({
  getConfig: () => ({
    port: 8081,
    openaiApiKey: 'test-api-key',
    openaiModel: 'gpt-4o',
    openaiBaseUrl: 'https://api.openai.com/v1',
    openaiTimeoutMs: 60000,
    mcpBaseUrl: 'http://localhost:8090',
    maxToolCallsPerTurn: 8,
    maxOasBytes: 2097152,
    maxMessageBytes: 32768,
    rateLimitRpm: 60,
    rateLimitBurst: 20,
    sessionTtlHours: 24,
    logLevel: 'info',
    allowedOrigins: ['http://localhost:5173'],
    enableToolTrace: false,
  }),
}));

// Mock logger - capture log calls for verification
const mockLogInfo = jest.fn();
const mockLogDebug = jest.fn();

jest.mock('../services/logger', () => ({
  logger: {
    info: (...args: unknown[]) => mockLogInfo(...args),
    debug: (...args: unknown[]) => mockLogDebug(...args),
    error: jest.fn(),
    warn: jest.fn(),
  },
  logRequestStart: jest.fn(),
  logRequestEnd: jest.fn(),
  logToolCall: jest.fn(),
  logOpenAIRequest: jest.fn(),
}));

describe('Server-Side SessionId Generation', () => {
  let app: Express;
  // Capture global.fetch so any cross-suite leakage (suites that assign
  // global.fetch = jest.fn() without restoring) cannot bleed into or out of
  // this suite when files share a worker in full parallel runs.
  const originalFetch = global.fetch;

  beforeAll(() => {
    // Re-activate nock in case a previously-run suite in this worker called
    // nock.restore() (which un-patches the shared http module process-wide).
    if (!nock.isActive()) {
      nock.activate();
    }
    nock.cleanAll();

    app = express();
    app.use(express.json());
    app.use(requestIdMiddleware);
    app.use('/api/chat', chatRouter);
    app.use(errorHandler);
  });

  beforeEach(() => {
    clearAllSessions();
    global.fetch = originalFetch;
    if (!nock.isActive()) {
      nock.activate();
    }
    nock.cleanAll();
    mockLogInfo.mockClear();
    mockLogDebug.mockClear();
  });

  afterAll(() => {
    nock.cleanAll();
    nock.restore();
    global.fetch = originalFetch;
  });

  describe('POST /api/chat sessionId generation', () => {
    it('should generate sessionId when missing from request', async () => {
      // Mock OpenAI response
      nock('https://api.openai.com')
        .post('/v1/chat/completions')
        .reply(200, {
          id: 'chatcmpl-123',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: 'Hello! How can I help you?',
              },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
        });

      const response = await request(app)
        .post('/api/chat')
        .send({
          message: 'Hello, this is a test',
        });

      expect(response.status).toBe(200);
      expect(response.body.sessionId).toBeDefined();
      expect(response.body.sessionId).toMatch(UUID_V4_REGEX);
    });

    it('should use provided sessionId when valid', async () => {
      const providedSessionId = 'my-custom-session-id';

      // Mock OpenAI response
      nock('https://api.openai.com')
        .post('/v1/chat/completions')
        .reply(200, {
          id: 'chatcmpl-123',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: 'Hello!',
              },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 },
        });

      const response = await request(app)
        .post('/api/chat')
        .send({
          sessionId: providedSessionId,
          message: 'Hello',
        });

      expect(response.status).toBe(200);
      expect(response.body.sessionId).toBe(providedSessionId);
    });

    it('should log session_created when generating new sessionId', async () => {
      // Mock OpenAI response
      nock('https://api.openai.com')
        .post('/v1/chat/completions')
        .reply(200, {
          id: 'chatcmpl-123',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: 'Hello!',
              },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 },
        });

      await request(app)
        .post('/api/chat')
        .send({
          message: 'Hello',
        });

      // Check that session_created was logged
      const sessionCreatedLog = mockLogInfo.mock.calls.find(
        (call) => call[0] === 'Session ID generated by gateway' ||
                  (call[1] && call[1].session_created === true)
      );
      expect(sessionCreatedLog).toBeDefined();
    });
  });

  describe('GET /api/chat/stream sessionId generation', () => {
    it('should generate sessionId when missing from query params', async () => {
      // Mock OpenAI streaming response
      const mockStream = [
        'data: {"id":"chatcmpl-123","choices":[{"index":0,"delta":{"role":"assistant","content":"Hello"}}]}\n\n',
        'data: {"id":"chatcmpl-123","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
        'data: [DONE]\n\n',
      ].join('');

      nock('https://api.openai.com')
        .post('/v1/chat/completions')
        .reply(200, mockStream, {
          'Content-Type': 'text/event-stream',
        });

      const response = await request(app)
        .get('/api/chat/stream')
        .query({
          message: 'Hello',
        });

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('text/event-stream');

      // Parse SSE events from response text
      const events = response.text.split('\n\n').filter((e) => e.trim());
      const finalEvent = events.find((e) => e.includes('event: final'));

      expect(finalEvent).toBeDefined();

      // Extract data from final event
      const dataMatch = finalEvent!.match(/data: (.+)/);
      expect(dataMatch).toBeDefined();

      const finalData = JSON.parse(dataMatch![1]);
      expect(finalData.sessionId).toBeDefined();
      expect(finalData.sessionId).toMatch(UUID_V4_REGEX);
    });

    it('should include sessionId in final SSE event', async () => {
      const providedSessionId = 'stream-session-123';

      // Mock OpenAI streaming response
      const mockStream = [
        'data: {"id":"chatcmpl-123","choices":[{"index":0,"delta":{"role":"assistant","content":"Test"}}]}\n\n',
        'data: {"id":"chatcmpl-123","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
        'data: [DONE]\n\n',
      ].join('');

      nock('https://api.openai.com')
        .post('/v1/chat/completions')
        .reply(200, mockStream, {
          'Content-Type': 'text/event-stream',
        });

      const response = await request(app)
        .get('/api/chat/stream')
        .query({
          sessionId: providedSessionId,
          message: 'Hello',
        });

      expect(response.status).toBe(200);

      // Parse SSE events from response text
      const events = response.text.split('\n\n').filter((e) => e.trim());
      const finalEvent = events.find((e) => e.includes('event: final'));

      expect(finalEvent).toBeDefined();

      // Extract data from final event
      const dataMatch = finalEvent!.match(/data: (.+)/);
      expect(dataMatch).toBeDefined();

      const finalData = JSON.parse(dataMatch![1]);
      expect(finalData.sessionId).toBe(providedSessionId);
      expect(finalData.message).toBe('Test');
    });
  });
});
