/**
 * Consumer Integration Tests for the LlmClient factory migration.
 * Spec 2026-03-06: Azure OpenAI LLM Provider - Task Group 4
 *
 * Verifies that:
 * 1. chatV2.ts calls getLlmClient().sendChatRequest() instead of directly calling sendChatRequest()
 * 2. threadSummariser.ts calls getLlmClient().sendChatRequest() instead of directly calling sendChatRequest()
 * 3. Existing chatV2 integration test continues to pass (no regression)
 *
 * Strategy: Mock llmClient.getLlmClient to return a controlled mock client,
 * then exercise the consumers and verify the mock client was invoked.
 */

import path from 'path';
import os from 'os';
import { promises as fs } from 'fs';
import { Thread, ThreadKey, ThreadMessage } from '../types/chatV2';

// ---- Set up config mock ----
const realConfigDir = path.resolve(__dirname, '..', 'config');
let testTmpDir: string;

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

// ---- Mock getLlmClient to intercept all LLM calls from consumers ----
const mockSendChatRequest = jest.fn();
jest.mock('../services/llmClient', () => ({
  getLlmClient: () => ({
    sendChatRequest: (...args: unknown[]) => mockSendChatRequest(...args),
  }),
}));

// ---- Imports (after mocks) ----
import express from 'express';
import request from 'supertest';
import { initializeRegistries } from '../services/registryLoader';
import { chatV2Router } from '../routes/chatV2';

// Build a minimal Express app for testing
function createTestApp() {
  const app = express();
  app.use(express.json({ limit: '30mb' }));
  app.use((req, _res, next) => {
    req.requestId = 'integration-test-request-id';
    next();
  });
  app.use('/api/chat/v2', chatV2Router);
  return app;
}

// ============================================================================
// Consumer Integration Tests
// ============================================================================
describe('LlmClient Consumer Integration (Spec 2026-03-06, Task Group 4)', () => {
  let app: express.Application;

  beforeAll(async () => {
    testTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'llmclient-integ-'));
    await initializeRegistries();
    app = createTestApp();
  });

  afterAll(async () => {
    try {
      await fs.rm(testTmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  beforeEach(async () => {
    mockSendChatRequest.mockReset();
    // Clean thread files between tests
    try {
      await fs.rm(path.join(testTmpDir, 'threads'), { recursive: true, force: true });
    } catch {
      // Ignore if directory doesn't exist
    }
  });

  // ==========================================================================
  // Test 1: chatV2.ts calls getLlmClient().sendChatRequest() via the mock
  // ==========================================================================
  it('chatV2.ts calls getLlmClient().sendChatRequest() instead of directly calling sendChatRequest()', async () => {
    const mockResponse = JSON.stringify({
      phase: 'questions',
      questions: ['What problem does it solve?'],
      summary: 'Initial discovery.',
    });

    mockSendChatRequest.mockResolvedValueOnce({
      id: 'resp-llmclient-1',
      content: mockResponse,
      isFinal: true,
    });

    const res = await request(app)
      .post('/api/chat/v2')
      .send({
        threadKey: { type: 'hub', projectId: 'llmclient-test-1' },
        personaId: 'product-manager',
        taskId: 'product-manager--define-product',
        message: 'I want to build an analytics tool.',
      })
      .expect(200);

    // Verify the mock getLlmClient().sendChatRequest was called
    expect(mockSendChatRequest).toHaveBeenCalledTimes(1);

    // Verify the arguments passed to sendChatRequest
    const callArgs = mockSendChatRequest.mock.calls[0];
    const messages = callArgs[0];
    const requestId = callArgs[1];

    // First message should be the system prompt
    expect(messages[0].role).toBe('system');
    // Last message should be the user message
    expect(messages[messages.length - 1].content).toBe('I want to build an analytics tool.');
    // requestId should be passed through
    expect(typeof requestId).toBe('string');

    // Verify the response was correctly processed
    expect(res.body.assistant.message).toBeDefined();
    expect(res.body.structuredResponse.phase).toBe('questions');
  });

  // ==========================================================================
  // Test 2: threadSummariser.ts calls getLlmClient().sendChatRequest() via the mock
  // Uses jest.isolateModules to mock threadStore without affecting other tests
  // ==========================================================================
  it('threadSummariser.ts calls getLlmClient().sendChatRequest() instead of directly calling sendChatRequest()', async () => {
    // Generate 42 messages to exceed the 40-message threshold
    const messages: ThreadMessage[] = [];
    for (let i = 0; i < 21; i++) {
      messages.push({
        id: `msg-user-${i}`,
        role: 'user',
        personaId: null,
        taskId: null,
        content: `User message ${i + 1}`,
        structuredResponse: null,
        timestamp: '2026-03-06T00:00:00.000Z',
      });
      messages.push({
        id: `msg-asst-${i}`,
        role: 'assistant',
        personaId: null,
        taskId: null,
        content: `Assistant message ${i + 1}`,
        structuredResponse: null,
        timestamp: '2026-03-06T00:00:00.000Z',
      });
    }

    const thread: Thread = {
      threadKey: 'project:proj-sum:hub',
      projectId: 'proj-sum',
      messages,
      activePersonaId: null,
      activeTaskId: null,
      summary: null,
      summarisedUpToIndex: 0,
      createdAt: '2026-03-06T00:00:00.000Z',
      updatedAt: '2026-03-06T00:00:00.000Z',
    };

    const threadKey: ThreadKey = { type: 'hub', projectId: 'proj-sum' };

    // Mock the LLM response
    mockSendChatRequest.mockResolvedValueOnce({
      id: 'resp-summarise-1',
      content: '**Goals**\n- Test summarisation',
      isFinal: true,
    });

    // Use isolateModules so we can mock threadStore for just this test
    await jest.isolateModulesAsync(async () => {
      // Mock threadStore within this isolation scope
      const mockGetThread = jest.fn().mockResolvedValue({ ...thread });
      const mockSaveThread = jest.fn().mockResolvedValue(undefined);

      jest.doMock('../services/threadStore', () => ({
        getThread: mockGetThread,
        saveThread: mockSaveThread,
      }));

      const { maybeSummariseThread } = require('../services/threadSummariser');

      await maybeSummariseThread(thread, threadKey, 'req-sum-001');

      // Verify getLlmClient().sendChatRequest was called
      expect(mockSendChatRequest).toHaveBeenCalledTimes(1);

      // Verify the arguments
      const callArgs = mockSendChatRequest.mock.calls[0];
      const llmMessages = callArgs[0];
      const sessionId = callArgs[2];
      const options = callArgs[3];

      // First message should be system (summarisation prompt)
      expect(llmMessages[0].role).toBe('system');
      // Second message should be user (formatted conversation)
      expect(llmMessages[1].role).toBe('user');
      // Session ID for summarisation is 'summarisation'
      expect(sessionId).toBe('summarisation');
      // Options should include temperature and maxTokens
      expect(options).toEqual({ temperature: 0.2, maxTokens: 2000, tools: [], toolChoice: 'none' });

      // Verify threadStore operations were called
      expect(mockGetThread).toHaveBeenCalledTimes(1);
      expect(mockSaveThread).toHaveBeenCalledTimes(1);
    });
  });

  // ==========================================================================
  // Test 3: Existing chatV2 integration test continues to pass (no regression)
  // This replicates the core flow from chatV2-integration.test.ts Test 1
  // ==========================================================================
  it('existing chatV2 end-to-end flow continues to work through getLlmClient()', async () => {
    const mockResponse = JSON.stringify({
      phase: 'questions',
      questions: ['What is the target audience?'],
      summary: 'Discussed requirements.',
    });

    // First turn
    mockSendChatRequest.mockResolvedValueOnce({
      id: 'resp-e2e-1',
      content: mockResponse,
      isFinal: true,
    });

    const res1 = await request(app)
      .post('/api/chat/v2')
      .send({
        threadKey: { type: 'hub', projectId: 'llmclient-e2e' },
        personaId: 'product-manager',
        taskId: 'product-manager--define-product',
        message: 'I want to build a dashboard.',
      })
      .expect(200);

    expect(res1.body.threadKey).toBe('project:llmclient-e2e:hub');
    expect(res1.body.structuredResponse.phase).toBe('questions');
    expect(res1.body.personaId).toBe('product-manager');
    expect(res1.body.taskId).toBe('product-manager--define-product');

    // Verify the LLM was called via getLlmClient
    expect(mockSendChatRequest).toHaveBeenCalledTimes(1);

    // Second turn -- thread should be rehydrated
    const mockResponse2 = JSON.stringify({
      phase: 'questions',
      questions: ['What metrics to track?'],
      summary: 'Continuing discovery.',
    });

    mockSendChatRequest.mockResolvedValueOnce({
      id: 'resp-e2e-2',
      content: mockResponse2,
      isFinal: true,
    });

    const res2 = await request(app)
      .post('/api/chat/v2')
      .send({
        threadKey: { type: 'hub', projectId: 'llmclient-e2e' },
        personaId: 'product-manager',
        taskId: 'product-manager--define-product',
        message: 'It should track user engagement.',
      })
      .expect(200);

    expect(res2.body.structuredResponse.phase).toBe('questions');

    // Verify second call included accumulated history
    expect(mockSendChatRequest).toHaveBeenCalledTimes(2);
    const secondCallMessages = mockSendChatRequest.mock.calls[1][0];
    // Should have: system prompt, user1, assistant1, user2 = 4 messages minimum
    expect(secondCallMessages.length).toBeGreaterThanOrEqual(4);
    expect(secondCallMessages[1].content).toBe('I want to build a dashboard.');
    expect(secondCallMessages[secondCallMessages.length - 1].content).toBe('It should track user engagement.');
  });
});
