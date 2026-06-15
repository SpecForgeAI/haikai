/**
 * Integration tests for Gateway Chat Orchestrator
 *
 * These tests verify complete user workflows with mocked external services.
 */

import request from 'supertest';
import nock from 'nock';
import express, { Express } from 'express';
import { chatRouter, healthRouter } from '../routes';
import {
  requestIdMiddleware,
  errorHandler,
  createCorsMiddlewareWithOrigins,
  createRateLimitMiddlewareWithLimits,
} from '../middleware';
import { clearAllSessions, getSession } from '../services/sessionStore';

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

describe('Integration Tests', () => {
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

  describe('Full conversation flow', () => {
    it('should complete a multi-turn conversation with tool calls', async () => {
      const sessionId = 'integration-session-1';

      // First turn: User asks to list interfaces
      // OpenAI responds with tool call
      nock('https://api.openai.com')
        .post('/v1/chat/completions')
        .reply(200, {
          id: 'chatcmpl-turn1-a',
          choices: [{
            index: 0,
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [{
                id: 'call_list',
                type: 'function',
                function: {
                  name: 'list_interfaces',
                  arguments: '{"filename": "architecture.json"}',
                },
              }],
            },
            finish_reason: 'tool_calls',
          }],
          usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130 },
        });

      // MCP responds with interface list
      nock('http://localhost:8090')
        .post('/mcp/tools/list_interfaces')
        .reply(200, {
          data: [
            { interfaceId: 'INT-001', interfaceName: 'User API' },
            { interfaceId: 'INT-002', interfaceName: 'Admin API' },
          ],
        });

      // OpenAI final response for first turn
      nock('https://api.openai.com')
        .post('/v1/chat/completions')
        .reply(200, {
          id: 'chatcmpl-turn1-b',
          choices: [{
            index: 0,
            message: {
              role: 'assistant',
              content: 'I found 2 interfaces:\n1. User API (INT-001)\n2. Admin API (INT-002)\n\nWhich one would you like to work with?',
            },
            finish_reason: 'stop',
          }],
          usage: { prompt_tokens: 150, completion_tokens: 40, total_tokens: 190 },
        });

      // First request
      const response1 = await request(app)
        .post('/api/chat')
        .send({
          sessionId,
          message: 'List interfaces for architecture.json',
          context: { filename: 'architecture.json' },
        });

      expect(response1.status).toBe(200);
      expect(response1.body.assistant.message).toContain('User API');
      expect(response1.body.assistant.toolTrace).toHaveLength(1);
      expect(response1.body.assistant.toolTrace[0].toolName).toBe('list_interfaces');

      // Second turn: User selects an interface
      // OpenAI responds with get_interface_oas_context tool call
      nock('https://api.openai.com')
        .post('/v1/chat/completions')
        .reply(200, {
          id: 'chatcmpl-turn2-a',
          choices: [{
            index: 0,
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [{
                id: 'call_context',
                type: 'function',
                function: {
                  name: 'get_interface_oas_context',
                  arguments: '{"interfaceId": "INT-001"}',
                },
              }],
            },
            finish_reason: 'tool_calls',
          }],
          usage: { prompt_tokens: 200, completion_tokens: 25, total_tokens: 225 },
        });

      // MCP responds with interface context
      nock('http://localhost:8090')
        .post('/mcp/tools/get_interface_oas_context')
        .reply(200, {
          data: {
            interface: { id: 'INT-001', name: 'User API', description: 'User management' },
            service: { id: 'SVC-001', name: 'User Service' },
            endpoints: [
              { id: 'EP-001', name: 'getUser', pathOrAddress: '/users/{id}', operationVerb: 'GET' },
            ],
            logicalEntities: [],
          },
        });

      // OpenAI final response for second turn
      nock('https://api.openai.com')
        .post('/v1/chat/completions')
        .reply(200, {
          id: 'chatcmpl-turn2-b',
          choices: [{
            index: 0,
            message: {
              role: 'assistant',
              content: 'The User API has the following endpoint:\n- GET /users/{id} - getUser\n\nWould you like me to generate an OpenAPI spec for this interface?',
            },
            finish_reason: 'stop',
          }],
          usage: { prompt_tokens: 250, completion_tokens: 50, total_tokens: 300 },
        });

      // Second request
      const response2 = await request(app)
        .post('/api/chat')
        .send({
          sessionId,
          message: 'Tell me about the User API',
          context: { interfaceId: 'INT-001' },
        });

      expect(response2.status).toBe(200);
      expect(response2.body.assistant.message).toContain('GET /users/{id}');
      expect(response2.body.assistant.toolTrace).toHaveLength(1);
      expect(response2.body.assistant.toolTrace[0].toolName).toBe('get_interface_oas_context');
    });
  });

  describe('Session persistence', () => {
    it('should persist context across multiple requests', async () => {
      const sessionId = 'persistence-session-1';

      // First request creates session with context
      nock('https://api.openai.com')
        .post('/v1/chat/completions')
        .reply(200, {
          id: 'chatcmpl-persist-1',
          choices: [{
            index: 0,
            message: {
              role: 'assistant',
              content: 'I understand you want to work with architecture.json',
            },
            finish_reason: 'stop',
          }],
          usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
        });

      await request(app)
        .post('/api/chat')
        .send({
          sessionId,
          message: 'I want to work with architecture.json',
          context: {
            filename: 'architecture.json',
            interfaceId: 'INT-001',
          },
        });

      // Verify session was created and context stored
      const session = getSession(sessionId);
      expect(session).not.toBeNull();
      expect(session!.filename).toBe('architecture.json');
      expect(session!.interfaceId).toBe('INT-001');
      expect(session!.mcpSessionId).toBeDefined();
    });
  });

  describe('Rate limiting', () => {
    it('should enforce rate limits', async () => {
      // Create app with strict rate limit
      const limitedApp = express();
      limitedApp.use(express.json());
      limitedApp.use(createRateLimitMiddlewareWithLimits(2, 60000)); // 2 requests per minute
      limitedApp.use(requestIdMiddleware);
      limitedApp.use('/api/chat', chatRouter);
      limitedApp.use(errorHandler);

      // Mock OpenAI for valid requests
      nock('https://api.openai.com')
        .post('/v1/chat/completions')
        .times(3)
        .reply(200, {
          id: 'chatcmpl-rate',
          choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        });

      // First two requests should succeed
      const response1 = await request(limitedApp)
        .post('/api/chat')
        .send({ sessionId: 'rate-1', message: 'Hello 1' });
      expect(response1.status).toBe(200);

      const response2 = await request(limitedApp)
        .post('/api/chat')
        .send({ sessionId: 'rate-2', message: 'Hello 2' });
      expect(response2.status).toBe(200);

      // Third request should be rate limited
      const response3 = await request(limitedApp)
        .post('/api/chat')
        .send({ sessionId: 'rate-3', message: 'Hello 3' });
      expect(response3.status).toBe(429);
      expect(response3.body.error.code).toBe(429);
    });
  });

  describe('Error handling', () => {
    it('should handle OpenAI connection errors gracefully', async () => {
      // Mock OpenAI to simulate connection error
      nock('https://api.openai.com')
        .post('/v1/chat/completions')
        .replyWithError({ code: 'ECONNREFUSED', message: 'Connection refused' });

      const response = await request(app)
        .post('/api/chat')
        .send({
          sessionId: 'error-session',
          message: 'Hello',
        });

      // Should return 502 for external service errors
      expect(response.status).toBe(502);
      expect(response.body.error).toBeDefined();
      expect(response.body.error.message).toContain('unavailable');
    });

    it('should handle MCP errors during tool execution', async () => {
      // OpenAI returns tool call
      nock('https://api.openai.com')
        .post('/v1/chat/completions')
        .reply(200, {
          id: 'chatcmpl-mcp-error',
          choices: [{
            index: 0,
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [{
                id: 'call_error',
                type: 'function',
                function: {
                  name: 'list_interfaces',
                  arguments: '{"filename": "missing.json"}',
                },
              }],
            },
            finish_reason: 'tool_calls',
          }],
          usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
        });

      // MCP returns error
      nock('http://localhost:8090')
        .post('/mcp/tools/list_interfaces')
        .reply(404, {
          error: { code: 404, message: 'File not found: missing.json' },
        });

      // OpenAI should receive error and respond
      nock('https://api.openai.com')
        .post('/v1/chat/completions')
        .reply(200, {
          id: 'chatcmpl-mcp-error-2',
          choices: [{
            index: 0,
            message: {
              role: 'assistant',
              content: 'I could not find the file "missing.json". Please check the filename and try again.',
            },
            finish_reason: 'stop',
          }],
          usage: { prompt_tokens: 150, completion_tokens: 30, total_tokens: 180 },
        });

      const response = await request(app)
        .post('/api/chat')
        .send({
          sessionId: 'mcp-error-session',
          message: 'List interfaces for missing.json',
          context: { filename: 'missing.json' },
        });

      expect(response.status).toBe(200);
      expect(response.body.assistant.message).toContain('could not find');
    });
  });

  describe('Tool execution round-trip', () => {
    it('should execute save_oas_spec and return artifacts', async () => {
      const sessionId = 'save-spec-session';

      // OpenAI returns save_oas_spec tool call
      nock('https://api.openai.com')
        .post('/v1/chat/completions')
        .reply(200, {
          id: 'chatcmpl-save',
          choices: [{
            index: 0,
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [{
                id: 'call_save',
                type: 'function',
                function: {
                  name: 'save_oas_spec',
                  arguments: JSON.stringify({
                    filename: 'arch.json',
                    interfaceId: 'INT-001',
                    format: 'yaml',
                    oasContents: 'openapi: 3.0.0\ninfo:\n  title: Test API\n  version: 1.0.0',
                  }),
                },
              }],
            },
            finish_reason: 'tool_calls',
          }],
          usage: { prompt_tokens: 200, completion_tokens: 80, total_tokens: 280 },
        });

      // MCP saves the spec
      nock('http://localhost:8090')
        .post('/mcp/tools/save_oas_spec')
        .reply(200, {
          data: {
            interfaceId: 'INT-001',
            interfaceName: 'User API',
            architectureFilename: 'arch.json',
            format: 'yaml',
            savedPath: '/specs/arch/INT-001.yaml',
            specLink: '/specs/arch/INT-001.yaml',
            updatedAt: '2024-12-16T10:00:00.000Z',
            created: true,
          },
        });

      // OpenAI confirms save
      nock('https://api.openai.com')
        .post('/v1/chat/completions')
        .reply(200, {
          id: 'chatcmpl-save-2',
          choices: [{
            index: 0,
            message: {
              role: 'assistant',
              content: 'I have saved the OpenAPI specification to /specs/arch/INT-001.yaml',
            },
            finish_reason: 'stop',
          }],
          usage: { prompt_tokens: 250, completion_tokens: 30, total_tokens: 280 },
        });

      const response = await request(app)
        .post('/api/chat')
        .send({
          sessionId,
          message: 'Save this spec',
          context: {
            filename: 'arch.json',
            interfaceId: 'INT-001',
          },
        });

      expect(response.status).toBe(200);
      expect(response.body.assistant.artifacts).toBeDefined();
      expect(response.body.assistant.artifacts.savedSpec).toBeDefined();
      expect(response.body.assistant.artifacts.savedSpec.interfaceId).toBe('INT-001');
      expect(response.body.assistant.artifacts.savedSpec.savedPath).toBe('/specs/arch/INT-001.yaml');
      expect(response.body.assistant.artifacts.savedSpec.created).toBe(true);
    });
  });
});
