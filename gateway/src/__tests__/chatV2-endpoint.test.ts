/**
 * Tests for POST /api/chat/v2 Endpoint
 *
 * Spec 2026-02-28: Unified Conversation Engine v1 (Backend)
 * Task Group 7: POST /api/chat/v2 Endpoint
 *
 * 8 focused tests:
 * 1. Valid request with taskId 'product-manager--define-product' returns ChatV2Response
 * 2. taskId 'unknown' returns deterministic menu response listing persona's tasks
 * 3. Invalid personaId returns 400 error
 * 4. Invalid taskId (not 'unknown' and not in registry) returns 400 error
 * 5. Thread created on first request and rehydrated on subsequent (messages accumulate)
 * 6. Structured response validation failure sets error field and passes through raw assistant message
 * 7. files array correctly forwarded to LLM message (multimodal content parts)
 * 8. jsonMode true is set for tasks with non-null responseFormat
 *
 * All tests mock sendChatRequest to avoid real OpenAI calls.
 * Uses supertest to make HTTP requests against the Express app.
 */

import path from 'path';
import os from 'os';
import { promises as fs } from 'fs';

// ---- Set up config mock ----
const realConfigDir = path.resolve(__dirname, '..', 'config');
let testTmpDir: string;

// We need testTmpDir to be set before the mock factory runs for real,
// so we initialize it in beforeAll and the mock reads it lazily.
jest.mock('../config', () => ({
  getConfig: () => ({
    registryBasePath: realConfigDir,
    threadPersistBasePath: testTmpDir,
    openaiApiKey: 'test-key',
    openaiModel: 'gpt-4o',
    openaiBaseUrl: 'https://api.openai.com/v1',
    openaiTimeoutMs: 120000,
    logLevel: 'error',
    port: 8081,
    rateLimitRpm: 1000,
    rateLimitBurst: 100,
    allowedOrigins: ['http://localhost:5173'],
  }),
}));

// ---- Mock architectureModelClient ----
jest.mock('../services/architectureModelClient', () => {
  const actual = jest.requireActual('../services/architectureModelClient');
  return {
    ...actual,
    fetchProjectFolder: jest.fn(async () => testTmpDir),
  };
});

// ---- Mock logger ----
jest.mock('../services/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// ---- Mock sendChatRequest ----
const mockSendChatRequest = jest.fn();
jest.mock('../services/openaiClient', () => ({
  sendChatRequest: (...args: unknown[]) => mockSendChatRequest(...args),
}));

// ---- Imports (after mocks) ----
import express from 'express';
import request from 'supertest';
import { initializeRegistries } from '../services/registryLoader';
import { chatV2Router, validateStructuredResponse } from '../routes/chatV2';

// Build a minimal Express app for testing
function createTestApp() {
  const app = express();
  app.use(express.json({ limit: '30mb' }));
  // Add requestId middleware inline
  app.use((req, _res, next) => {
    req.requestId = 'test-request-id';
    next();
  });
  app.use('/api/chat/v2', chatV2Router);
  return app;
}

describe('POST /api/chat/v2 Endpoint (Spec 2026-02-28, Task Group 7)', () => {
  let app: express.Application;

  beforeAll(async () => {
    // Create a unique temporary directory for thread storage
    testTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chatv2-test-'));
    await initializeRegistries();
    app = createTestApp();
  });

  afterAll(async () => {
    // Clean up temp directory
    try {
      await fs.rm(testTmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  beforeEach(async () => {
    mockSendChatRequest.mockReset();
    // Clean thread files between tests to prevent cross-test contamination
    // (paths no longer include projectId, so all hub threads share the same path)
    try {
      await fs.rm(path.join(testTmpDir, 'threads'), { recursive: true, force: true });
    } catch {
      // Ignore if directory doesn't exist
    }
  });

  // Helper: build a valid ChatV2Request body
  function validRequest(overrides: Record<string, unknown> = {}) {
    return {
      threadKey: { type: 'hub', projectId: 'test-project' },
      personaId: 'product-manager',
      taskId: 'product-manager--define-product',
      message: 'Tell me about the product',
      ...overrides,
    };
  }

  // ========================================================================
  // Test 1: Valid request with product-manager--define-product returns ChatV2Response
  // ========================================================================
  it('should return a ChatV2Response with personaId, taskId, assistant.message, and structuredResponse for a valid product-manager--define-product request', async () => {
    const mockLlmResponse = JSON.stringify({
      phase: 'questions',
      questions: ['What is the product name?', 'Who is the target audience?'],
      summary: 'Initial discovery phase.',
    });

    mockSendChatRequest.mockResolvedValueOnce({
      id: 'resp-1',
      content: mockLlmResponse,
      isFinal: true,
    });

    const res = await request(app)
      .post('/api/chat/v2')
      .send(validRequest({
        threadKey: { type: 'hub', projectId: 'test-1' },
      }))
      .expect(200);

    expect(res.body.threadKey).toBe('project:test-1:hub');
    expect(res.body.personaId).toBe('product-manager');
    expect(res.body.taskId).toBe('product-manager--define-product');
    expect(res.body.assistant).toBeDefined();
    expect(res.body.assistant.message).toBe(mockLlmResponse);
    expect(res.body.structuredResponse).toBeDefined();
    expect(res.body.structuredResponse.phase).toBe('questions');
    expect(res.body.structuredResponse.questions).toHaveLength(2);
    expect(res.body.structuredResponse.summary).toBe('Initial discovery phase.');
    expect(res.body.error).toBeUndefined();
  });

  // ========================================================================
  // Test 2: taskId 'unknown' returns deterministic menu response
  // ========================================================================
  it('should return a deterministic menu response listing the persona\'s available tasks when taskId is unknown', async () => {
    const res = await request(app)
      .post('/api/chat/v2')
      .send(validRequest({
        threadKey: { type: 'hub', projectId: 'test-2' },
        taskId: 'unknown',
      }))
      .expect(200);

    expect(res.body.taskId).toBe('unknown');
    expect(res.body.personaId).toBe('product-manager');
    expect(res.body.assistant.message).toBeDefined();
    expect(res.body.structuredResponse).toBeDefined();
    expect(res.body.structuredResponse.type).toBe('task-menu');
    expect(Array.isArray(res.body.structuredResponse.tasks)).toBe(true);

    // product-manager has 5 tasks in the registry
    const taskIds = res.body.structuredResponse.tasks.map((t: { taskId: string }) => t.taskId);
    expect(taskIds).toContain('product-manager--define-product');
    expect(taskIds).toContain('product-manager--roadmap');

    // Should NOT have called sendChatRequest -- menu is deterministic
    expect(mockSendChatRequest).not.toHaveBeenCalled();
  });

  // ========================================================================
  // Test 3: Invalid personaId returns 400 error
  // ========================================================================
  it('should return 400 error for an invalid personaId', async () => {
    const res = await request(app)
      .post('/api/chat/v2')
      .send(validRequest({
        threadKey: { type: 'hub', projectId: 'test-3' },
        personaId: 'nonexistent-persona',
      }))
      .expect(400);

    expect(res.body.error).toContain('Unknown personaId');
    expect(res.body.error).toContain('nonexistent-persona');
    expect(mockSendChatRequest).not.toHaveBeenCalled();
  });

  // ========================================================================
  // Test 4: Invalid taskId returns 400 error
  // ========================================================================
  it('should return 400 error for an invalid taskId that is not unknown and not in registry', async () => {
    const res = await request(app)
      .post('/api/chat/v2')
      .send(validRequest({
        threadKey: { type: 'hub', projectId: 'test-4' },
        taskId: 'product-manager--nonexistent-task',
      }))
      .expect(400);

    expect(res.body.error).toContain('Unknown taskId');
    expect(res.body.error).toContain('product-manager--nonexistent-task');
    expect(mockSendChatRequest).not.toHaveBeenCalled();
  });

  // ========================================================================
  // Test 5: Thread created on first request and rehydrated on subsequent
  // ========================================================================
  it('should create thread on first request and rehydrate on subsequent requests with accumulated messages', async () => {
    const projectId = 'test-5-thread-accum';
    const threadKey = { type: 'hub' as const, projectId };

    // First request
    mockSendChatRequest.mockResolvedValueOnce({
      id: 'resp-5a',
      content: JSON.stringify({ phase: 'questions', questions: ['Q1'], summary: 'Turn 1' }),
      isFinal: true,
    });

    await request(app)
      .post('/api/chat/v2')
      .send(validRequest({ threadKey, message: 'First message' }))
      .expect(200);

    // Second request -- thread should be rehydrated with prior messages
    mockSendChatRequest.mockResolvedValueOnce({
      id: 'resp-5b',
      content: JSON.stringify({ phase: 'questions', questions: ['Q2'], summary: 'Turn 2' }),
      isFinal: true,
    });

    await request(app)
      .post('/api/chat/v2')
      .send(validRequest({ threadKey, message: 'Second message' }))
      .expect(200);

    // The second call to sendChatRequest should include the history from the first call
    // Messages array: [system, user1, assistant1, user2]
    const secondCallMessages = mockSendChatRequest.mock.calls[1][0];
    expect(secondCallMessages.length).toBe(4);
    expect(secondCallMessages[0].role).toBe('system');
    expect(secondCallMessages[1].role).toBe('user');
    expect(secondCallMessages[1].content).toBe('First message');
    expect(secondCallMessages[2].role).toBe('assistant');
    expect(secondCallMessages[3].role).toBe('user');
    expect(secondCallMessages[3].content).toBe('Second message');
  });

  // ========================================================================
  // Test 6: Structured response validation failure sets error field
  // ========================================================================
  it('should set the error field and pass through raw assistant message when structured response validation fails', async () => {
    // Return non-JSON content for a task that expects JSON
    mockSendChatRequest.mockResolvedValueOnce({
      id: 'resp-6',
      content: 'This is plain text, not JSON',
      isFinal: true,
    });

    const res = await request(app)
      .post('/api/chat/v2')
      .send(validRequest({
        threadKey: { type: 'hub', projectId: 'test-6' },
      }))
      .expect(200);

    // The raw assistant message should still be passed through
    expect(res.body.assistant.message).toBe('This is plain text, not JSON');
    // Error field should be set with validation details
    expect(res.body.error).toBeDefined();
    expect(res.body.error).toContain('Invalid JSON');
  });

  // ========================================================================
  // Test 7: files array correctly forwarded to LLM message
  // ========================================================================
  it('should correctly forward files array to the LLM message as multimodal content parts', async () => {
    const mockResponse = JSON.stringify({
      phase: 'questions',
      questions: ['Q1'],
      summary: 'With file',
    });

    mockSendChatRequest.mockResolvedValueOnce({
      id: 'resp-7',
      content: mockResponse,
      isFinal: true,
    });

    const testImageBase64 = Buffer.from('fake-image-data').toString('base64');
    const testTextBase64 = Buffer.from('hello world').toString('base64');

    await request(app)
      .post('/api/chat/v2')
      .send(validRequest({
        threadKey: { type: 'hub', projectId: 'test-7' },
        files: [
          { filename: 'screenshot.png', mimeType: 'image/png', base64: testImageBase64 },
          { filename: 'notes.txt', mimeType: 'text/plain', base64: testTextBase64 },
        ],
      }))
      .expect(200);

    // The last message in the messages array (user message) should have ContentPart[] content
    const callMessages = mockSendChatRequest.mock.calls[0][0];
    const userMessage = callMessages[callMessages.length - 1];
    expect(userMessage.role).toBe('user');
    expect(Array.isArray(userMessage.content)).toBe(true);

    const parts = userMessage.content;
    // First part: text
    expect(parts[0].type).toBe('text');
    expect(parts[0].text).toBe('Tell me about the product');

    // Second part: image_url for screenshot.png
    expect(parts[1].type).toBe('image_url');
    expect(parts[1].image_url.url).toContain('data:image/png;base64,');

    // Third part: inlined text for notes.txt
    expect(parts[2].type).toBe('text');
    expect(parts[2].text).toContain('--- File: notes.txt ---');
    expect(parts[2].text).toContain('hello world');
  });

  // ========================================================================
  // Test 8: jsonMode true is set for tasks with non-null responseFormat
  // ========================================================================
  it('should set jsonMode: true for tasks with non-null responseFormat', async () => {
    // product-manager--define-product has responseFormat !== null
    mockSendChatRequest.mockResolvedValueOnce({
      id: 'resp-8a',
      content: JSON.stringify({ phase: 'questions', questions: [], summary: '' }),
      isFinal: true,
    });

    await request(app)
      .post('/api/chat/v2')
      .send(validRequest({
        threadKey: { type: 'hub', projectId: 'test-8a' },
        taskId: 'product-manager--define-product', // responseFormat is non-null
      }))
      .expect(200);

    // Check the options argument (4th arg) passed to sendChatRequest
    const structuredCallOptions = mockSendChatRequest.mock.calls[0][3];
    expect(structuredCallOptions.jsonMode).toBe(true);

    // Now test with assistant--freeform which has responseFormat: null
    mockSendChatRequest.mockResolvedValueOnce({
      id: 'resp-8b',
      content: 'Just a freeform response',
      isFinal: true,
    });

    await request(app)
      .post('/api/chat/v2')
      .send(validRequest({
        threadKey: { type: 'hub', projectId: 'test-8b' },
        personaId: 'assistant',
        taskId: 'assistant--freeform', // responseFormat is null
      }))
      .expect(200);

    const freeformCallOptions = mockSendChatRequest.mock.calls[1][3];
    expect(freeformCallOptions.jsonMode).toBe(false);
  });
});

// ============================================================================
// Additional unit tests for validateStructuredResponse (Task 7.3)
// ============================================================================
describe('validateStructuredResponse (Task 7.3)', () => {
  const sampleFormat = {
    type: 'object',
    required: ['phase', 'questions', 'summary'],
    properties: {
      phase: { type: 'string' },
      questions: { type: 'array' },
      summary: { type: 'string' },
    },
  };

  it('should return valid: true for a well-formed JSON matching the schema', () => {
    const result = validateStructuredResponse(
      JSON.stringify({ phase: 'questions', questions: ['Q1'], summary: 'S' }),
      sampleFormat
    );
    expect(result.valid).toBe(true);
    expect(result.parsed).toBeDefined();
  });

  it('should return valid: false with error for non-JSON input', () => {
    const result = validateStructuredResponse('not json at all', sampleFormat);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Invalid JSON');
  });

  it('should return valid: false for missing required field', () => {
    const result = validateStructuredResponse(
      JSON.stringify({ phase: 'questions', questions: ['Q1'] }),
      sampleFormat
    );
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Missing required field: summary');
  });

  it('should return valid: false for type mismatch', () => {
    const result = validateStructuredResponse(
      JSON.stringify({ phase: 123, questions: ['Q1'], summary: 'S' }),
      sampleFormat
    );
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Type mismatch');
    expect(result.error).toContain('phase');
  });
});
