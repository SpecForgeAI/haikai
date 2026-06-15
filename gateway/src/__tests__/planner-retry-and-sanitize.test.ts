/**
 * Tests for Planner corrective retry loop and defensive JSON sanitization.
 *
 * Layer 1: Gateway retry loop (up to 5 attempts) for implement_feature planner validation
 * Layer 3: Defensive JSON parsing via sanitizeJsonString()
 *
 * 14 tests covering:
 * - sanitizeJsonString: trailing commas, comments, unescaped control chars, passthrough
 * - Retry loop: success on retry, all attempts exhausted, sendChatRequest call count
 */

import { sanitizeJsonString, extractJson, validatePlannerResponse } from '../services/plannerResponseValidator';

// ============================================================================
// Layer 3: sanitizeJsonString unit tests
// ============================================================================

describe('sanitizeJsonString', () => {
  it('should remove trailing commas before closing braces', () => {
    const input = '{"a": "b", "c": "d",}';
    const result = sanitizeJsonString(input);
    expect(() => JSON.parse(result)).not.toThrow();
    expect(JSON.parse(result)).toEqual({ a: 'b', c: 'd' });
  });

  it('should remove trailing commas before closing brackets', () => {
    const input = '{"items": ["one", "two", "three",]}';
    const result = sanitizeJsonString(input);
    expect(() => JSON.parse(result)).not.toThrow();
    expect(JSON.parse(result).items).toEqual(['one', 'two', 'three']);
  });

  it('should strip single-line JS comments outside strings', () => {
    const input = '{\n"a": "b" // this is a comment\n}';
    const result = sanitizeJsonString(input);
    expect(() => JSON.parse(result)).not.toThrow();
    expect(JSON.parse(result)).toEqual({ a: 'b' });
  });

  it('should strip multi-line JS comments outside strings', () => {
    const input = '{\n/* comment */\n"a": "b"\n}';
    const result = sanitizeJsonString(input);
    expect(() => JSON.parse(result)).not.toThrow();
    expect(JSON.parse(result)).toEqual({ a: 'b' });
  });

  it('should NOT strip // inside string values', () => {
    const input = '{"url": "https://example.com"}';
    const result = sanitizeJsonString(input);
    expect(JSON.parse(result).url).toBe('https://example.com');
  });

  it('should escape literal newlines inside string values', () => {
    // Simulate LLM outputting a literal newline inside a JSON string value
    const input = '{"message": "line one\nline two"}';
    const result = sanitizeJsonString(input);
    expect(() => JSON.parse(result)).not.toThrow();
    expect(JSON.parse(result).message).toBe('line one\nline two');
  });

  it('should escape literal tabs inside string values', () => {
    const input = '{"message": "col1\tcol2"}';
    const result = sanitizeJsonString(input);
    expect(() => JSON.parse(result)).not.toThrow();
    expect(JSON.parse(result).message).toBe('col1\tcol2');
  });

  it('should handle combined issues: trailing comma + comment + literal newline', () => {
    const input = '{\n"a": "hello\nworld", // greeting\n"b": "test",\n}';
    const result = sanitizeJsonString(input);
    expect(() => JSON.parse(result)).not.toThrow();
    const parsed = JSON.parse(result);
    expect(parsed.a).toBe('hello\nworld');
    expect(parsed.b).toBe('test');
  });

  it('should pass through already-valid JSON unchanged (semantically)', () => {
    const input = '{"schemaVersion":"1.1","message":"Hello","featureUnderstanding":"test"}';
    const result = sanitizeJsonString(input);
    expect(JSON.parse(result)).toEqual(JSON.parse(input));
  });

  it('should preserve properly escaped sequences inside strings', () => {
    const input = '{"message": "line one\\nline two\\ttab"}';
    const result = sanitizeJsonString(input);
    expect(() => JSON.parse(result)).not.toThrow();
    expect(JSON.parse(result).message).toBe('line one\nline two\ttab');
  });
});

// ============================================================================
// Layer 3: sanitizeJsonString integration with validatePlannerResponse
// ============================================================================

describe('validatePlannerResponse with sanitized JSON', () => {
  it('should successfully validate JSON with trailing commas after sanitization', () => {
    const content = JSON.stringify({
      schemaVersion: '1.1',
      message: 'Hello',
      featureUnderstanding: 'Test feature',
      scope: { in: ['item1'], out: [] },
      assumptions: ['assumption1'],
      acceptanceCriteria: ['criteria1'],
      openQuestions: ['question1'],
      plannerReadyForSpec: false,
      implementationPlan: null,
    }).replace(']}', '],}'); // Inject trailing comma

    const result = validatePlannerResponse(content, false, 'test-session');
    expect(result.valid).toBe(true);
    expect(result.plannerResponse?.message).toBe('Hello');
  });
});

// ============================================================================
// Layer 1: Planner corrective retry loop (integration tests via chat route)
// ============================================================================

// Mock dependencies for chat route integration tests
const mockReadFile = jest.fn();
jest.mock('fs', () => ({
  promises: {
    readFile: (...args: unknown[]) => mockReadFile(...args),
  },
}));

jest.mock('../services/openaiClient');
jest.mock('../services/sessionStore');
jest.mock('../services/transcriptStore');
jest.mock('../services/transcriptWriter');
jest.mock('../services/architectureModelClient');
jest.mock('../services/conversation');
jest.mock('../services/promptBuilder');

jest.mock('../config', () => ({
  getConfig: () => ({
    sessionTtlHours: 24,
    openaiApiKey: 'test-key',
    openaiModel: 'gpt-4o',
    openaiBaseUrl: 'https://api.openai.com/v1',
    openaiTimeoutMs: 60000,
    mcpBaseUrl: 'http://localhost:8090',
    architectureModelServiceBaseUrl: 'http://localhost:8080',
    orchestrationServiceBaseUrl: 'http://localhost:8085',
    conversationPersistBasePath: '/tmp/test-transcripts',
    port: 8081,
    maxToolCallsPerTurn: 8,
    maxOasBytes: 2097152,
    maxMessageBytes: 32768,
    rateLimitRpm: 60,
    rateLimitBurst: 20,
    maxConversationMessages: 80,
    maxConversationBytes: 200000,
    logLevel: 'info',
    allowedOrigins: ['http://localhost:5173'],
    enableToolTrace: false,
  }),
}));

jest.mock('../services/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
  logRequestStart: jest.fn(),
  logRequestEnd: jest.fn(),
}));

const { sendChatRequest, buildToolResultMessages } = jest.requireMock('../services/openaiClient');
(buildToolResultMessages as jest.Mock).mockReturnValue([]);

const { getOrCreateSession, updateSession } = jest.requireMock('../services/sessionStore');
(getOrCreateSession as jest.Mock).mockReturnValue({
  id: 'test-session-retry',
  createdAt: new Date().toISOString(),
  lastAccessedAt: new Date().toISOString(),
  history: [],
  metadata: {},
  conversation: [
    { role: 'system', content: 'system prompt' },
    { role: 'user', content: 'previous message' },
    { role: 'assistant', content: '{}' },
  ],
});
(updateSession as jest.Mock).mockImplementation(() => {});

const { appendTranscriptEntry, getTranscript } = jest.requireMock('../services/transcriptStore');
(appendTranscriptEntry as jest.Mock).mockImplementation(() => {});
(getTranscript as jest.Mock).mockReturnValue({
  sessionId: 'test-session-retry',
  entries: [],
});

const { writeTranscriptToFile } = jest.requireMock('../services/transcriptWriter');
(writeTranscriptToFile as jest.Mock).mockResolvedValue(undefined);

const { buildMessagesForTurn, persistConversation } = jest.requireMock('../services/conversation');
(persistConversation as jest.Mock).mockImplementation(() => {});

const { buildSystemPrompt } = jest.requireMock('../services/promptBuilder');
(buildSystemPrompt as jest.Mock).mockReturnValue('System prompt');

mockReadFile.mockImplementation(() => {
  return Promise.reject(new Error('ENOENT'));
});

import express from 'express';
import request from 'supertest';
import { chatRouter } from '../routes/chat';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/chat', chatRouter);
  return app;
}

function validPlannerJson(overrides?: Record<string, unknown>) {
  return JSON.stringify({
    schemaVersion: '1.1',
    message: 'Here is my analysis of the feature.',
    featureUnderstanding: 'This feature involves creating a database.',
    scope: { in: ['Create tables'], out: ['UI changes'] },
    assumptions: ['PostgreSQL is used'],
    acceptanceCriteria: ['Tables are created'],
    openQuestions: ['Which schema?'],
    plannerReadyForSpec: false,
    implementationPlan: null,
    ...overrides,
  });
}

function implementRequestBody() {
  return {
    sessionId: 'test-session-retry',
    message: 'Please analyse this feature.',
    context: {
      mode: 'implement_feature' as const,
      phase: 'refine',
      filename: 'test-model',
      featureId: 'feat-001',
      featureTitle: 'Test Feature',
      projectParentFolder: '/tmp/test',
    },
  };
}

describe('Planner Corrective Retry Loop (Layer 1)', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockReadFile.mockImplementation(() => {
      return Promise.reject(new Error('ENOENT'));
    });

    (buildMessagesForTurn as jest.Mock).mockReturnValue([
      { role: 'system', content: 'System prompt' },
      { role: 'user', content: 'Please analyse this feature.' },
    ]);
  });

  it('should succeed on first attempt without retries', async () => {
    (sendChatRequest as jest.Mock).mockResolvedValue({
      id: 'chatcmpl-1',
      content: validPlannerJson(),
      isFinal: true,
      toolCalls: [],
    });

    const app = createApp();
    const response = await request(app)
      .post('/api/chat')
      .send(implementRequestBody());

    expect(response.status).toBe(200);
    expect(response.body.plannerResponse).toBeDefined();
    expect(response.body.plannerResponse.message).toBe('Here is my analysis of the feature.');
    expect(response.body.error).toBeUndefined();

    // sendChatRequest called exactly once (no retries needed)
    expect(sendChatRequest).toHaveBeenCalledTimes(1);
  });

  it('should retry and succeed on second attempt after first returns invalid JSON', async () => {
    (sendChatRequest as jest.Mock)
      .mockResolvedValueOnce({
        id: 'chatcmpl-invalid',
        content: 'Here is my analysis of the database feature...',
        isFinal: true,
        toolCalls: [],
      })
      .mockResolvedValueOnce({
        id: 'chatcmpl-retry-ok',
        content: validPlannerJson({ message: 'Corrected response after retry.' }),
        isFinal: true,
        toolCalls: [],
      });

    const app = createApp();
    const response = await request(app)
      .post('/api/chat')
      .send(implementRequestBody());

    expect(response.status).toBe(200);
    expect(response.body.plannerResponse).toBeDefined();
    expect(response.body.plannerResponse.message).toBe('Corrected response after retry.');
    expect(response.body.error).toBeUndefined();

    // sendChatRequest called twice: initial + 1 retry
    expect(sendChatRequest).toHaveBeenCalledTimes(2);
  });

  it('should use fallback after all 5 retry attempts are exhausted', async () => {
    // All 5 attempts return invalid content
    (sendChatRequest as jest.Mock).mockResolvedValue({
      id: 'chatcmpl-always-invalid',
      content: 'This is never valid JSON',
      isFinal: true,
      toolCalls: [],
    });

    const app = createApp();
    const response = await request(app)
      .post('/api/chat')
      .send(implementRequestBody());

    expect(response.status).toBe(200);
    expect(response.body.plannerResponse).toBeDefined();
    expect(response.body.plannerResponse.message).toBe("I couldn't parse the structured response. Please try again.");
    expect(response.body.error).toBeDefined();

    // sendChatRequest called 5 times: initial + 4 retries
    expect(sendChatRequest).toHaveBeenCalledTimes(5);
  });
});
