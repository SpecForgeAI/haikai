/**
 * Tests for chat endpoints
 */

import request from 'supertest';
import nock from 'nock';
import express, { Express } from 'express';
import { chatRouter, healthRouter } from '../routes';
import {
  requestIdMiddleware,
  errorHandler,
  createCorsMiddlewareWithOrigins,
} from '../middleware';
import { clearAllSessions } from '../services/sessionStore';

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
    enableToolTrace: true,
  }),
}));

// Mock logger
jest.mock('../services/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
  logRequestStart: jest.fn(),
  logRequestEnd: jest.fn(),
  logToolCall: jest.fn(),
  logOpenAIRequest: jest.fn(),
}));

describe('Chat Endpoints', () => {
  let app: Express;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use(createCorsMiddlewareWithOrigins(['http://localhost:5173']));
    app.use(requestIdMiddleware);
    app.use('/api/chat', chatRouter);
    app.use('/health', healthRouter);
    app.use(errorHandler);
  });

  beforeEach(() => {
    clearAllSessions();
    nock.cleanAll();
  });

  afterAll(() => {
    nock.restore();
  });

  describe('GET /health', () => {
    it('should return ok status', async () => {
      const response = await request(app).get('/health');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('ok');
      expect(response.body.timestamp).toBeDefined();
      expect(new Date(response.body.timestamp).getTime()).not.toBeNaN();
    });
  });

  describe('POST /api/chat', () => {
    it('should return assistant response', async () => {
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
                content: 'Hello! How can I help you with OpenAPI specifications today?',
              },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 20,
            total_tokens: 120,
          },
        });

      const response = await request(app)
        .post('/api/chat')
        .send({
          sessionId: 'test-session-123',
          message: 'Hello',
        });

      expect(response.status).toBe(200);
      expect(response.body.sessionId).toBe('test-session-123');
      expect(response.body.assistant.message).toContain('OpenAPI');
    });

    it('should auto-generate sessionId when not provided', async () => {
      // Mock OpenAI response for this request
      nock('https://api.openai.com')
        .post('/v1/chat/completions')
        .reply(200, {
          id: 'chatcmpl-auto-session',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: 'Hello! How can I help?',
              },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 },
        });

      const response = await request(app)
        .post('/api/chat')
        .send({
          message: 'Hello',
        });

      // SessionId is auto-generated when missing (Spec 2026-01-24)
      expect(response.status).toBe(200);
      expect(response.body.sessionId).toBeDefined();
      expect(typeof response.body.sessionId).toBe('string');
      expect(response.body.sessionId.length).toBeGreaterThan(0);
    });

    it('should validate message is required', async () => {
      const response = await request(app)
        .post('/api/chat')
        .send({
          sessionId: 'test-session',
        });

      expect(response.status).toBe(400);
      expect(response.body.error.message).toContain('message');
    });

    it('should reject oversized message', async () => {
      const response = await request(app)
        .post('/api/chat')
        .send({
          sessionId: 'test-session',
          message: 'x'.repeat(40000), // Exceeds 32KB limit
        });

      expect(response.status).toBe(400);
      expect(response.body.error.message).toContain('exceeds maximum size');
    });

    it('should handle tool calls correctly', async () => {
      // First OpenAI call returns tool call
      nock('https://api.openai.com')
        .post('/v1/chat/completions')
        .reply(200, {
          id: 'chatcmpl-123',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'call_123',
                    type: 'function',
                    function: {
                      name: 'list_interfaces',
                      arguments: '{"filename": "architecture.json"}',
                    },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
        });

      // Mock MCP tool call
      nock('http://localhost:8090')
        .post('/mcp/tools/list_interfaces')
        .reply(200, {
          data: [
            { interfaceId: 'INT-001', interfaceName: 'Test Interface' },
          ],
        });

      // Second OpenAI call returns final response
      nock('https://api.openai.com')
        .post('/v1/chat/completions')
        .reply(200, {
          id: 'chatcmpl-456',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: 'I found 1 interface: Test Interface (INT-001)',
              },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 150, completion_tokens: 30, total_tokens: 180 },
        });

      const response = await request(app)
        .post('/api/chat')
        .send({
          sessionId: 'test-session',
          message: 'List interfaces for architecture.json',
          context: {
            filename: 'architecture.json',
          },
        });

      expect(response.status).toBe(200);
      expect(response.body.assistant.message).toContain('Test Interface');
      expect(response.body.assistant.toolTrace).toBeDefined();
      expect(response.body.assistant.toolTrace.length).toBeGreaterThan(0);
      expect(response.body.assistant.toolTrace[0].toolName).toBe('list_interfaces');
    });

    it('should include artifacts when save_oas_spec is called', async () => {
      // First call returns tool call for save_oas_spec
      nock('https://api.openai.com')
        .post('/v1/chat/completions')
        .reply(200, {
          id: 'chatcmpl-123',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'call_save',
                    type: 'function',
                    function: {
                      name: 'save_oas_spec',
                      arguments: JSON.stringify({
                        filename: 'arch.json',
                        interfaceId: 'INT-001',
                        format: 'yaml',
                        oasContents: 'openapi: 3.0.0\ninfo:\n  title: Test API',
                      }),
                    },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
        });

      // Mock MCP save call
      nock('http://localhost:8090')
        .post('/mcp/tools/save_oas_spec')
        .reply(200, {
          data: {
            interfaceId: 'INT-001',
            interfaceName: 'Test Interface',
            architectureFilename: 'arch.json',
            format: 'yaml',
            savedPath: '/path/to/spec.yaml',
            specLink: '/path/to/spec.yaml',
            updatedAt: new Date().toISOString(),
            created: true,
          },
        });

      // Second call returns final response
      nock('https://api.openai.com')
        .post('/v1/chat/completions')
        .reply(200, {
          id: 'chatcmpl-456',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: 'I have saved the OpenAPI spec to /path/to/spec.yaml',
              },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 200, completion_tokens: 30, total_tokens: 230 },
        });

      const response = await request(app)
        .post('/api/chat')
        .send({
          sessionId: 'test-session',
          message: 'Save the spec',
          context: {
            filename: 'arch.json',
            interfaceId: 'INT-001',
          },
        });

      expect(response.status).toBe(200);
      expect(response.body.assistant.artifacts).toBeDefined();
      expect(response.body.assistant.artifacts.savedSpec).toBeDefined();
      expect(response.body.assistant.artifacts.savedSpec.interfaceId).toBe('INT-001');
      expect(response.body.assistant.artifacts.savedSpec.savedPath).toBe('/path/to/spec.yaml');
    });
  });

  describe('GET /api/chat/stream', () => {
    it('should return SSE stream', async () => {
      // Mock OpenAI streaming response
      const mockStream = [
        'data: {"id":"chatcmpl-123","choices":[{"index":0,"delta":{"role":"assistant","content":"Hello"}}]}\n\n',
        'data: {"id":"chatcmpl-123","choices":[{"index":0,"delta":{"content":"! How can"}}]}\n\n',
        'data: {"id":"chatcmpl-123","choices":[{"index":0,"delta":{"content":" I help?"}}]}\n\n',
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
          sessionId: 'stream-session',
          message: 'Hello',
        });

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('text/event-stream');
    });

    it('should auto-generate sessionId when not provided for stream', async () => {
      const response = await request(app)
        .get('/api/chat/stream')
        .query({
          message: 'Hello',
        });

      // SessionId is auto-generated when missing (Spec 2026-01-24)
      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('text/event-stream');
    });

    it('should validate message is required for stream', async () => {
      const response = await request(app)
        .get('/api/chat/stream')
        .query({
          sessionId: 'stream-session',
        });

      expect(response.status).toBe(400);
      expect(response.body.error.message).toContain('message');
    });
  });
});
