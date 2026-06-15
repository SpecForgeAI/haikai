/**
 * Tests for conversation memory in chat routes
 * Task Group 5: Chat Routes Integration
 *
 * These tests verify that:
 * - POST /api/chat persists conversation after successful response
 * - POST /api/chat replays prior conversation history to OpenAI
 * - GET /api/chat/stream persists conversation after streaming completes
 * - GET /api/chat/stream replays prior conversation history
 * - Tool call messages are included in persisted conversation
 * - Multi-turn conversation maintains context across requests
 */

import request from 'supertest';
import nock from 'nock';
import express, { Express } from 'express';
import { chatRouter } from '../routes';
import {
  requestIdMiddleware,
  errorHandler,
  createCorsMiddlewareWithOrigins,
} from '../middleware';
import { clearAllSessions, getSession, updateSession, getOrCreateSession } from '../services/sessionStore';
import { OpenAIMessage } from '../types/session';

// Mock config with conversation memory settings
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
    maxConversationMessages: 80,
    maxConversationBytes: 200000,
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

describe('Chat Conversation Memory Integration', () => {
  let app: Express;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use(createCorsMiddlewareWithOrigins(['http://localhost:5173']));
    app.use(requestIdMiddleware);
    app.use('/api/chat', chatRouter);
    app.use(errorHandler);
  });

  beforeEach(() => {
    clearAllSessions();
    nock.cleanAll();
  });

  afterAll(() => {
    nock.restore();
  });

  describe('POST /api/chat - Conversation Persistence', () => {
    it('should persist conversation after successful response', async () => {
      const sessionId = 'persist-test-session';

      // Mock OpenAI response
      nock('https://api.openai.com')
        .post('/v1/chat/completions')
        .reply(200, {
          id: 'chatcmpl-persist-1',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: 'Hello! I can help you create an OpenAPI spec.',
              },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
        });

      const response = await request(app)
        .post('/api/chat')
        .send({
          sessionId,
          message: 'Hi, I need help with API design',
        });

      expect(response.status).toBe(200);

      // Verify conversation was persisted
      const session = getSession(sessionId);
      expect(session).toBeDefined();
      expect(session!.conversation).toBeDefined();
      expect(session!.conversation!.length).toBe(2); // user + assistant

      // Verify user message
      expect(session!.conversation![0].role).toBe('user');
      expect(session!.conversation![0].content).toBe('Hi, I need help with API design');

      // Verify assistant message
      expect(session!.conversation![1].role).toBe('assistant');
      expect(session!.conversation![1].content).toBe('Hello! I can help you create an OpenAPI spec.');
    });

    it('should replay prior conversation history to OpenAI', async () => {
      const sessionId = 'replay-test-session';

      // Pre-populate session with conversation history
      getOrCreateSession(sessionId);
      const priorConversation: OpenAIMessage[] = [
        { role: 'user', content: 'What is the best format for an API spec?' },
        { role: 'assistant', content: 'I recommend using OpenAPI 3.0 YAML format.' },
      ];
      updateSession(sessionId, { conversation: priorConversation });

      // Capture the request body to verify conversation is replayed
      let capturedRequestBody: any = null;
      nock('https://api.openai.com')
        .post('/v1/chat/completions', (body) => {
          capturedRequestBody = body;
          return true;
        })
        .reply(200, {
          id: 'chatcmpl-replay-1',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: 'Yes, you can use JSON too if you prefer.',
              },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 150, completion_tokens: 15, total_tokens: 165 },
        });

      await request(app)
        .post('/api/chat')
        .send({
          sessionId,
          message: 'Can I use JSON instead?',
        });

      // Verify the request to OpenAI includes conversation history
      expect(capturedRequestBody).toBeDefined();
      expect(capturedRequestBody.messages).toBeDefined();

      const messages = capturedRequestBody.messages;
      // Should be: system + prior user + prior assistant + new user = 4 messages
      expect(messages.length).toBe(4);
      expect(messages[0].role).toBe('system');
      expect(messages[1].role).toBe('user');
      expect(messages[1].content).toBe('What is the best format for an API spec?');
      expect(messages[2].role).toBe('assistant');
      expect(messages[2].content).toBe('I recommend using OpenAPI 3.0 YAML format.');
      expect(messages[3].role).toBe('user');
      expect(messages[3].content).toBe('Can I use JSON instead?');
    });

    it('should include tool call messages in persisted conversation', async () => {
      const sessionId = 'tool-persist-session';

      // First OpenAI call returns tool call
      nock('https://api.openai.com')
        .post('/v1/chat/completions')
        .reply(200, {
          id: 'chatcmpl-tool-1',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'call_tool_persist',
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
          usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130 },
        });

      // Mock MCP tool call
      nock('http://localhost:8090')
        .post('/mcp/tools/list_interfaces')
        .reply(200, {
          data: [{ interfaceId: 'INT-001', interfaceName: 'Payment API' }],
        });

      // Second OpenAI call returns final response
      nock('https://api.openai.com')
        .post('/v1/chat/completions')
        .reply(200, {
          id: 'chatcmpl-tool-2',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: 'I found the Payment API (INT-001).',
              },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 180, completion_tokens: 25, total_tokens: 205 },
        });

      const response = await request(app)
        .post('/api/chat')
        .send({
          sessionId,
          message: 'List interfaces for architecture.json',
          context: { filename: 'architecture.json' },
        });

      expect(response.status).toBe(200);

      // Verify conversation includes tool call messages
      const session = getSession(sessionId);
      expect(session).toBeDefined();
      expect(session!.conversation).toBeDefined();

      // Conversation should include: user, assistant with tool_calls, tool result, final assistant
      expect(session!.conversation!.length).toBe(4);

      expect(session!.conversation![0].role).toBe('user');
      expect(session!.conversation![1].role).toBe('assistant');
      expect(session!.conversation![1].tool_calls).toBeDefined();
      expect(session!.conversation![1].tool_calls![0].function.name).toBe('list_interfaces');
      expect(session!.conversation![2].role).toBe('tool');
      expect(session!.conversation![2].tool_call_id).toBe('call_tool_persist');
      expect(session!.conversation![3].role).toBe('assistant');
      expect(session!.conversation![3].content).toBe('I found the Payment API (INT-001).');
    });

    it('should maintain context across multi-turn requests', async () => {
      const sessionId = 'multi-turn-session';

      // First turn
      nock('https://api.openai.com')
        .post('/v1/chat/completions')
        .reply(200, {
          id: 'chatcmpl-turn1',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: 'What interface would you like to work on?',
              },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 15, total_tokens: 115 },
        });

      await request(app)
        .post('/api/chat')
        .send({
          sessionId,
          message: 'I want to create an API spec',
        });

      // Verify first turn persisted
      let session = getSession(sessionId);
      expect(session!.conversation!.length).toBe(2);

      // Second turn - capture to verify history is included
      let capturedSecondTurn: any = null;
      nock('https://api.openai.com')
        .post('/v1/chat/completions', (body) => {
          capturedSecondTurn = body;
          return true;
        })
        .reply(200, {
          id: 'chatcmpl-turn2',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: 'Great choice! I will help you with the Payment API.',
              },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 150, completion_tokens: 20, total_tokens: 170 },
        });

      await request(app)
        .post('/api/chat')
        .send({
          sessionId,
          message: 'The Payment API',
        });

      // Verify second turn includes first turn history
      expect(capturedSecondTurn.messages.length).toBe(4); // system + turn1 user + turn1 assistant + turn2 user

      // Verify conversation is now 4 messages
      session = getSession(sessionId);
      expect(session!.conversation!.length).toBe(4);
      expect(session!.conversation![0].content).toBe('I want to create an API spec');
      expect(session!.conversation![1].content).toBe('What interface would you like to work on?');
      expect(session!.conversation![2].content).toBe('The Payment API');
      expect(session!.conversation![3].content).toBe('Great choice! I will help you with the Payment API.');
    });
  });

  describe('GET /api/chat/stream - Conversation Persistence', () => {
    it('should persist conversation after streaming completes', async () => {
      const sessionId = 'stream-persist-session';

      // Mock OpenAI streaming response
      const mockStream = [
        'data: {"id":"chatcmpl-stream-1","choices":[{"index":0,"delta":{"role":"assistant","content":"Hello"}}]}\n\n',
        'data: {"id":"chatcmpl-stream-1","choices":[{"index":0,"delta":{"content":" from streaming!"}}]}\n\n',
        'data: {"id":"chatcmpl-stream-1","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
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
          sessionId,
          message: 'Hello streaming test',
        });

      expect(response.status).toBe(200);

      // Verify conversation was persisted after streaming
      const session = getSession(sessionId);
      expect(session).toBeDefined();
      expect(session!.conversation).toBeDefined();
      expect(session!.conversation!.length).toBe(2); // user + assistant

      expect(session!.conversation![0].role).toBe('user');
      expect(session!.conversation![0].content).toBe('Hello streaming test');
      expect(session!.conversation![1].role).toBe('assistant');
      expect(session!.conversation![1].content).toBe('Hello from streaming!');
    });

    it('should replay prior conversation history in streaming mode', async () => {
      const sessionId = 'stream-replay-session';

      // Pre-populate session with conversation history
      getOrCreateSession(sessionId);
      const priorConversation: OpenAIMessage[] = [
        { role: 'user', content: 'Previous streaming question' },
        { role: 'assistant', content: 'Previous streaming answer' },
      ];
      updateSession(sessionId, { conversation: priorConversation });

      // Capture request to verify history is sent
      let capturedRequestBody: any = null;
      nock('https://api.openai.com')
        .post('/v1/chat/completions', (body) => {
          capturedRequestBody = body;
          return true;
        })
        .reply(200, [
          'data: {"id":"chatcmpl-stream-replay","choices":[{"index":0,"delta":{"role":"assistant","content":"Follow-up response"}}]}\n\n',
          'data: {"id":"chatcmpl-stream-replay","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
          'data: [DONE]\n\n',
        ].join(''), {
          'Content-Type': 'text/event-stream',
        });

      await request(app)
        .get('/api/chat/stream')
        .query({
          sessionId,
          message: 'Follow-up question',
        });

      // Verify OpenAI request includes conversation history
      expect(capturedRequestBody).toBeDefined();
      const messages = capturedRequestBody.messages;

      // Should be: system + prior user + prior assistant + new user = 4 messages
      expect(messages.length).toBe(4);
      expect(messages[0].role).toBe('system');
      expect(messages[1].role).toBe('user');
      expect(messages[1].content).toBe('Previous streaming question');
      expect(messages[2].role).toBe('assistant');
      expect(messages[2].content).toBe('Previous streaming answer');
      expect(messages[3].role).toBe('user');
      expect(messages[3].content).toBe('Follow-up question');
    });
  });
});
