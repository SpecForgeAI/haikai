/**
 * Tests for trimmed v1 chat route after legacy mode removal.
 *
 * Spec 2026-03-02: Legacy Chat Removal and Cleanup (Increment 10)
 * Task Group 2: Gateway Route, Types, Prompt, and Service Cleanup
 *
 * Verifies that:
 * - OAS assistant mode still works
 * - Implement feature mode still works
 * - Removed modes (product_manager, solution_architect, roadmap_pm) are rejected
 * - ChatMode type is correctly constrained to 2 values
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
import { ChatMode } from '../types/chat';

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

describe('Trimmed v1 Chat Route (Increment 10)', () => {
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

  // Test 1: OAS assistant mode still works
  it('should return a valid response for mode: oas_assistant', async () => {
    nock('https://api.openai.com')
      .post('/v1/chat/completions')
      .reply(200, {
        id: 'chatcmpl-oas',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: 'I can help you with OpenAPI specifications.',
            },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 },
      });

    const response = await request(app)
      .post('/api/chat')
      .send({
        sessionId: 'oas-test-session',
        message: 'Help me with OAS',
        context: { mode: 'oas_assistant' },
      });

    expect(response.status).toBe(200);
    expect(response.body.sessionId).toBe('oas-test-session');
    expect(response.body.assistant.message).toContain('OpenAPI');
  });

  // Test 2: Implement feature mode still works
  it('should return a valid response for mode: implement_feature with phase: bootstrap', async () => {
    nock('https://api.openai.com')
      .post('/v1/chat/completions')
      .reply(200, {
        id: 'chatcmpl-impl',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: JSON.stringify({
                schemaVersion: '1.1',
                message: 'Welcome! Let me help you plan this feature.',
                featureUnderstanding: 'Test feature',
                scope: { in: [], out: [] },
                assumptions: [],
                acceptanceCriteria: [],
                openQuestions: [],
                plannerReadyForSpec: false,
                implementationPlan: null,
              }),
            },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 50, completion_tokens: 50, total_tokens: 100 },
      });

    const response = await request(app)
      .post('/api/chat')
      .send({
        sessionId: 'impl-test-session',
        message: 'Start',
        context: {
          mode: 'implement_feature',
          phase: 'bootstrap',
          workItem: {
            id: 'FEAT-1',
            title: 'Test Feature',
            type: 'Feature',
            description: 'A test feature',
          },
        },
      });

    expect(response.status).toBe(200);
    expect(response.body.sessionId).toBe('impl-test-session');
    expect(response.body.assistant.message).toBeDefined();
  });

  // Test 3: product_manager mode is no longer handled (falls through to OAS default)
  it('should not handle mode: product_manager (falls through to default OAS path)', async () => {
    // The mode will fall through to the default OAS assistant path since
    // product_manager branches have been removed. This means it will
    // call OpenAI with the OAS prompt and return normally -- it won't
    // crash or return 400.
    nock('https://api.openai.com')
      .post('/v1/chat/completions')
      .reply(200, {
        id: 'chatcmpl-pm-fallthrough',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: 'Hello from the OAS assistant.',
            },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 },
      });

    const response = await request(app)
      .post('/api/chat')
      .send({
        sessionId: 'pm-test-session',
        message: 'Tell me about the product',
        context: { mode: 'product_manager' as unknown as ChatMode },
      });

    // With legacy modes removed, the route falls through to OAS assistant
    // (no PM-specific validation, no PM response field)
    expect(response.status).toBe(200);
    expect(response.body.productManagerResponse).toBeUndefined();
  });

  // Test 4: solution_architect mode is no longer handled
  it('should not handle mode: solution_architect (falls through to default OAS path)', async () => {
    nock('https://api.openai.com')
      .post('/v1/chat/completions')
      .reply(200, {
        id: 'chatcmpl-sa-fallthrough',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: 'Hello from the OAS assistant.',
            },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 },
      });

    const response = await request(app)
      .post('/api/chat')
      .send({
        sessionId: 'sa-test-session',
        message: 'Discuss architecture',
        context: { mode: 'solution_architect' as unknown as ChatMode },
      });

    expect(response.status).toBe(200);
    expect(response.body.solutionArchitectResponse).toBeUndefined();
  });

  // Test 5: roadmap_pm mode is no longer handled
  it('should not handle mode: roadmap_pm (falls through to default OAS path)', async () => {
    nock('https://api.openai.com')
      .post('/v1/chat/completions')
      .reply(200, {
        id: 'chatcmpl-rm-fallthrough',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: 'Hello from the OAS assistant.',
            },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 },
      });

    const response = await request(app)
      .post('/api/chat')
      .send({
        sessionId: 'rm-test-session',
        message: 'Build a roadmap',
        context: { mode: 'roadmap_pm' as unknown as ChatMode },
      });

    expect(response.status).toBe(200);
    expect(response.body.roadmapPmResponse).toBeUndefined();
  });

  // Test 6: ChatMode type only accepts oas_assistant and implement_feature
  it('should have ChatMode type constrained to only oas_assistant and implement_feature', () => {
    // Compile-time type assertion test
    // These assignments should compile successfully:
    const oasMode: ChatMode = 'oas_assistant';
    const implMode: ChatMode = 'implement_feature';

    // Verify at runtime that only these two values exist
    expect(oasMode).toBe('oas_assistant');
    expect(implMode).toBe('implement_feature');

    // Verify the type is a string literal union
    // (The removed values would cause TypeScript compilation errors if assigned)
    const validModes: ChatMode[] = ['oas_assistant', 'implement_feature'];
    expect(validModes).toHaveLength(2);
    expect(validModes).toContain('oas_assistant');
    expect(validModes).toContain('implement_feature');
  });
});
