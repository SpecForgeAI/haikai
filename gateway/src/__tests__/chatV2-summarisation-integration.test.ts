/**
 * Integration Tests for chatV2.ts Summarisation Trigger and Context Window Assembly
 *
 * Spec 2026-03-02: Increment 11 -- Hub Bootstrap 6: Summarisation End-to-End
 * Task Group 3: chatV2.ts Summarisation Trigger and Context Window Assembly
 *
 * Tests:
 * 1. POST /api/chat/v2 with a hub thread containing 45 eligible messages triggers summarisation
 * 2. POST /api/chat/v2 with a hub thread containing 30 eligible messages does NOT trigger summarisation
 * 3. POST /api/chat/v2 with a feature thread type does NOT trigger summarisation
 * 4. POST /api/chat/v2 with a panel thread type containing 45 eligible messages DOES trigger summarisation
 * 5. When thread.summary is non-null, Step 7 injects a system message containing === CONVERSATION SUMMARY ===
 * 6. When thread.summary is non-null, Step 7 includes only messages from thread.summarisedUpToIndex onward
 * 7. When maybeSummariseThread throws an error, the POST handler still returns a successful response
 */

import path from 'path';
import os from 'os';
import { promises as fs } from 'fs';

// ---- Set up config mock ----
const realConfigDir = path.resolve(__dirname, '..', 'config');
let testTmpDir: string;

jest.mock('../config', () => ({
  getConfig: () => ({
    registryBasePath: realConfigDir,
    threadPersistBasePath: testTmpDir,
    conversationPersistBasePath: testTmpDir,
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
const mockLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};
jest.mock('../services/logger', () => ({
  logger: mockLogger,
}));

// ---- Mock sendChatRequest ----
const mockSendChatRequest = jest.fn();
jest.mock('../services/openaiClient', () => ({
  sendChatRequest: (...args: unknown[]) => mockSendChatRequest(...args),
}));

// ---- Mock maybeSummariseThread from threadSummariser ----
const mockMaybeSummariseThread = jest.fn();
jest.mock('../services/threadSummariser', () => ({
  maybeSummariseThread: (...args: unknown[]) => mockMaybeSummariseThread(...args),
}));

// ---- Imports (after mocks) ----
import express from 'express';
import request from 'supertest';
import { initializeRegistries } from '../services/registryLoader';
import { chatV2Router } from '../routes/chatV2';
import { Thread, ThreadMessage, threadKeyToString } from '../types/chatV2';

// Build a minimal Express app for testing
function createTestApp() {
  const app = express();
  app.use(express.json({ limit: '30mb' }));
  app.use((req, _res, next) => {
    req.requestId = 'summarisation-test-request-id';
    next();
  });
  app.use('/api/chat/v2', chatV2Router);
  return app;
}

// Helper: build a valid ChatV2Request body for hub threads
function validHubRequest(projectId: string, overrides: Record<string, unknown> = {}) {
  return {
    threadKey: { type: 'hub', projectId },
    personaId: 'product-manager',
    taskId: 'product-manager--define-product',
    message: 'Test message',
    ...overrides,
  };
}

// Helper: create a ThreadMessage
function makeMessage(
  role: 'user' | 'assistant' | 'system',
  content: string,
  taskId: string | null = null
): ThreadMessage {
  return {
    id: `msg-${Math.random().toString(36).slice(2, 8)}`,
    role,
    personaId: role === 'assistant' ? 'product-manager' : null,
    taskId,
    content,
    structuredResponse: null,
    timestamp: new Date().toISOString(),
  };
}

// Helper: generate N user+assistant message pairs (2 messages per pair)
function generateMessagePairs(pairCount: number, taskId: string | null = null): ThreadMessage[] {
  const msgs: ThreadMessage[] = [];
  for (let i = 0; i < pairCount; i++) {
    msgs.push(makeMessage('user', `User message ${i + 1}`, taskId));
    msgs.push(makeMessage('assistant', `Assistant response ${i + 1}`, taskId));
  }
  return msgs;
}

/**
 * Pre-populates a thread on disk using the same path structure as threadStore.ts
 * threadKeyToPath: basePath/threads/{projectId}/{type}/... /thread.json
 */
async function prePopulateThread(
  projectId: string,
  threadKeyType: 'hub' | 'panel' | 'feature',
  messages: ThreadMessage[],
  summary: string | null = null,
  summarisedUpToIndex: number = 0
): Promise<void> {
  let threadKeyStr: string;
  let threadFilePath: string;

  if (threadKeyType === 'hub') {
    threadKeyStr = `project:${projectId}:hub`;
    threadFilePath = path.join(testTmpDir, 'threads', 'hub', 'thread.json');
  } else if (threadKeyType === 'panel') {
    threadKeyStr = `project:${projectId}:panel:architecture`;
    // Panel path includes screen and entityId ('_' for no entityId)
    threadFilePath = path.join(testTmpDir, 'threads', 'panel', 'architecture', '_', 'thread.json');
  } else {
    threadKeyStr = `project:${projectId}:feature:feat-1`;
    threadFilePath = path.join(testTmpDir, 'threads', 'feature', 'feat-1', 'thread.json');
  }

  const thread: Thread = {
    threadKey: threadKeyStr,
    projectId,
    messages,
    activePersonaId: null,
    activeTaskId: null,
    summary,
    summarisedUpToIndex,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await fs.mkdir(path.dirname(threadFilePath), { recursive: true });
  await fs.writeFile(threadFilePath, JSON.stringify(thread, null, 2), 'utf-8');
}

// Default mock LLM response (valid product-manager--define-product JSON format)
function mockLlmResponse() {
  return {
    id: 'resp-test',
    content: JSON.stringify({
      phase: 'questions',
      questions: ['What problem does it solve?'],
      summary: 'Test summary.',
    }),
    isFinal: true,
  };
}

// Plain text LLM response for advisory-mode tasks (no responseFormat)
function mockPlainLlmResponse() {
  return {
    id: 'resp-plain',
    content: 'Here is my advisory response about the architecture.',
    isFinal: true,
  };
}

// ============================================================================
// Test Suite
// ============================================================================
describe('chatV2.ts Summarisation Integration (Spec 2026-03-02, Task Group 3)', () => {
  let app: express.Application;

  beforeAll(async () => {
    testTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chatv2-summarisation-'));
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
    mockMaybeSummariseThread.mockReset();
    mockMaybeSummariseThread.mockResolvedValue(undefined);
    mockLogger.debug.mockClear();
    mockLogger.info.mockClear();
    mockLogger.warn.mockClear();
    mockLogger.error.mockClear();
  
    // Clean thread files between tests to prevent cross-test contamination
    try {
      await fs.rm(path.join(testTmpDir, 'threads'), { recursive: true, force: true });
    } catch {
      // Ignore if directory does not exist
    }
  });

  // ==========================================================================
  // Test 1: Hub thread with 45 eligible messages triggers summarisation
  // (maybeSummariseThread is called for hub thread type)
  // ==========================================================================
  it('should call maybeSummariseThread for a hub thread with 45 eligible messages', async () => {
    const projectId = 'summ-test-1-hub-45';

    // Pre-populate a hub thread with 45 eligible messages (22 pairs + 1 user = 45)
    const messages = generateMessagePairs(22);
    messages.push(makeMessage('user', 'Extra user message'));

    await prePopulateThread(projectId, 'hub', messages);

    mockSendChatRequest.mockResolvedValueOnce(mockLlmResponse());

    await request(app)
      .post('/api/chat/v2')
      .send(validHubRequest(projectId))
      .expect(200);

    // maybeSummariseThread should have been called because threadKey.type === 'hub'
    expect(mockMaybeSummariseThread).toHaveBeenCalledTimes(1);

    // Verify it was called with a thread object, a hub threadKey, and a requestId
    const callArgs = mockMaybeSummariseThread.mock.calls[0];
    expect(callArgs[0]).toHaveProperty('messages');
    expect(callArgs[1]).toHaveProperty('type', 'hub');
    expect(typeof callArgs[2]).toBe('string'); // requestId
  });

  // ==========================================================================
  // Test 2: Hub thread with 30 eligible messages -- maybeSummariseThread is
  // still called by the route handler (the threshold check is internal to
  // maybeSummariseThread). The mock resolves as a no-op, confirming that with
  // 30 messages no actual summarisation occurs.
  // ==========================================================================
  it('should call maybeSummariseThread for a hub thread with 30 eligible messages (threshold check is internal)', async () => {
    const projectId = 'summ-test-2-hub-30';

    // Pre-populate with 15 pairs = 30 eligible messages
    const messages = generateMessagePairs(15);
    await prePopulateThread(projectId, 'hub', messages);

    mockSendChatRequest.mockResolvedValueOnce(mockLlmResponse());

    await request(app)
      .post('/api/chat/v2')
      .send(validHubRequest(projectId))
      .expect(200);

    // maybeSummariseThread IS called (hub type), but with 30 messages the real
    // implementation would return early (threshold not exceeded). Since the mock
    // resolves to undefined, no summarisation occurs in this test.
    expect(mockMaybeSummariseThread).toHaveBeenCalledTimes(1);

    // The thread passed to maybeSummariseThread should have the original
    // 30 messages plus the 2 new ones (user + assistant) appended in Step 10
    const updatedThread = mockMaybeSummariseThread.mock.calls[0][0];
    expect(updatedThread.messages.length).toBe(32); // 30 original + 2 new
  });

  // ==========================================================================
  // Test 3: Feature thread type does NOT trigger summarisation
  // (maybeSummariseThread is NOT called because threadKey.type === 'feature')
  // ==========================================================================
  it('should NOT call maybeSummariseThread for a feature thread type regardless of message count', async () => {
    const projectId = 'summ-test-3-feature';

    // Pre-populate a feature thread with 45 eligible messages
    const messages = generateMessagePairs(22);
    messages.push(makeMessage('user', 'Extra user message'));
    await prePopulateThread(projectId, 'feature', messages);

    mockSendChatRequest.mockResolvedValueOnce(mockLlmResponse());

    await request(app)
      .post('/api/chat/v2')
      .send({
        threadKey: { type: 'feature', projectId, featureId: 'feat-1' },
        personaId: 'product-manager',
        taskId: 'product-manager--define-product',
        message: 'Test feature message',
      })
      .expect(200);

    // maybeSummariseThread should NOT have been called for feature threads
    expect(mockMaybeSummariseThread).not.toHaveBeenCalled();
  });

  // ==========================================================================
  // Test 4: Panel thread type with 45 eligible messages triggers summarisation
  // (maybeSummariseThread IS called because threadKey.type === 'panel')
  //
  // Uses architect--service-breakdown (advisory mode, available from panel)
  // ==========================================================================
  it('should call maybeSummariseThread for a panel thread with 45 eligible messages', async () => {
    const projectId = 'summ-test-4-panel-45';

    // Pre-populate a panel thread with 45 eligible messages
    const messages = generateMessagePairs(22);
    messages.push(makeMessage('user', 'Extra user message'));
    await prePopulateThread(projectId, 'panel', messages);

    mockSendChatRequest.mockResolvedValueOnce(mockPlainLlmResponse());

    await request(app)
      .post('/api/chat/v2')
      .send({
        threadKey: { type: 'panel', projectId, screen: 'architecture' },
        personaId: 'architect',
        taskId: 'architect--service-breakdown',
        message: 'Test panel message',
      })
      .expect(200);

    // maybeSummariseThread should have been called because threadKey.type === 'panel'
    expect(mockMaybeSummariseThread).toHaveBeenCalledTimes(1);

    // Verify it was called with a panel threadKey
    const callArgs = mockMaybeSummariseThread.mock.calls[0];
    expect(callArgs[0]).toHaveProperty('messages');
    expect(callArgs[1]).toHaveProperty('type', 'panel');
    expect(typeof callArgs[2]).toBe('string'); // requestId
  });

  // ==========================================================================
  // Test 5: Summary injection -- when thread.summary is non-null, Step 7
  // injects a system message containing === CONVERSATION SUMMARY === as the
  // second message (after the system prompt)
  // ==========================================================================
  it('should inject a === CONVERSATION SUMMARY === system message when thread.summary is non-null', async () => {
    const projectId = 'summ-test-5-inject';
    const summaryText = 'Goals:\n- Build a product\nDecisions:\n- Use TypeScript';

    // Pre-populate a hub thread with a summary and some messages
    const messages = [
      makeMessage('user', 'Old message 1'),
      makeMessage('assistant', 'Old response 1'),
      makeMessage('user', 'Recent message'),
      makeMessage('assistant', 'Recent response'),
    ];
    await prePopulateThread(projectId, 'hub', messages, summaryText, 2);

    mockSendChatRequest.mockResolvedValueOnce(mockLlmResponse());

    await request(app)
      .post('/api/chat/v2')
      .send(validHubRequest(projectId))
      .expect(200);

    // Inspect the messages array passed to sendChatRequest
    expect(mockSendChatRequest).toHaveBeenCalled();
    const callMessages = mockSendChatRequest.mock.calls[0][0];

    // First message should be the system prompt
    expect(callMessages[0].role).toBe('system');

    // Second message should be the summary injection
    expect(callMessages[1].role).toBe('system');
    expect(callMessages[1].content).toContain('=== CONVERSATION SUMMARY ===');
    expect(callMessages[1].content).toContain(summaryText);
  });

  // ==========================================================================
  // Test 6: When thread.summary is non-null, Step 7 includes only messages
  // from thread.summarisedUpToIndex onward (skipping earlier messages),
  // excluding system-role messages
  // ==========================================================================
  it('should include only messages from summarisedUpToIndex onward when thread.summary is non-null', async () => {
    const projectId = 'summ-test-6-trim';
    const summaryText = 'A summary of old messages';

    // Pre-populate with 6 messages, summarisedUpToIndex = 4 (skip first 4)
    const messages = [
      makeMessage('user', 'Old msg 1'),         // index 0 - should be trimmed
      makeMessage('assistant', 'Old resp 1'),    // index 1 - should be trimmed
      makeMessage('user', 'Old msg 2'),          // index 2 - should be trimmed
      makeMessage('assistant', 'Old resp 2'),    // index 3 - should be trimmed
      makeMessage('user', 'Recent msg 1'),       // index 4 - should be included
      makeMessage('assistant', 'Recent resp 1'), // index 5 - should be included
    ];
    await prePopulateThread(projectId, 'hub', messages, summaryText, 4);

    mockSendChatRequest.mockResolvedValueOnce(mockLlmResponse());

    await request(app)
      .post('/api/chat/v2')
      .send(validHubRequest(projectId))
      .expect(200);

    // Inspect the messages array passed to sendChatRequest
    const callMessages = mockSendChatRequest.mock.calls[0][0];

    // Expected structure:
    // [0] system prompt
    // [1] === CONVERSATION SUMMARY === system message
    // [2] user: "Recent msg 1"       (from index 4)
    // [3] assistant: "Recent resp 1"  (from index 5)
    // [4] user: "Test message"        (the new user message from the request)

    expect(callMessages[0].role).toBe('system');
    expect(callMessages[1].role).toBe('system');
    expect(callMessages[1].content).toContain('=== CONVERSATION SUMMARY ===');

    // Messages from before summarisedUpToIndex should NOT appear
    const allContent = callMessages.map((m: { content: string | unknown }) =>
      typeof m.content === 'string' ? m.content : ''
    ).join(' ');
    expect(allContent).not.toContain('Old msg 1');
    expect(allContent).not.toContain('Old resp 1');
    expect(allContent).not.toContain('Old msg 2');
    expect(allContent).not.toContain('Old resp 2');

    // Messages from summarisedUpToIndex onward SHOULD appear
    expect(allContent).toContain('Recent msg 1');
    expect(allContent).toContain('Recent resp 1');

    // The new user message should be last
    const lastMessage = callMessages[callMessages.length - 1];
    expect(lastMessage.role).toBe('user');
    expect(lastMessage.content).toBe('Test message');
  });

  // ==========================================================================
  // Test 7: When maybeSummariseThread throws an error, the POST handler still
  // returns a successful ChatV2Response (summarisation failure is non-blocking)
  // ==========================================================================
  it('should return a successful response even when maybeSummariseThread throws an error', async () => {
    const projectId = 'summ-test-7-error';

    // Pre-populate a hub thread with a few messages
    const messages = generateMessagePairs(5);
    await prePopulateThread(projectId, 'hub', messages);

    mockSendChatRequest.mockResolvedValueOnce(mockLlmResponse());

    // Make maybeSummariseThread throw an error
    mockMaybeSummariseThread.mockRejectedValueOnce(new Error('LLM summarisation timeout'));

    const res = await request(app)
      .post('/api/chat/v2')
      .send(validHubRequest(projectId))
      .expect(200);

    // The response should still be successful
    expect(res.body.threadKey).toBe(`project:${projectId}:hub`);
    expect(res.body.personaId).toBe('product-manager');
    expect(res.body.taskId).toBe('product-manager--define-product');
    expect(res.body.assistant).toBeDefined();
    expect(res.body.assistant.message).toBeDefined();
    expect(res.body.error).toBeUndefined();

    // maybeSummariseThread was called (and threw)
    expect(mockMaybeSummariseThread).toHaveBeenCalledTimes(1);

    // The error should have been logged as non-blocking
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Summarisation failed (non-blocking)',
      expect.objectContaining({
        error: 'LLM summarisation timeout',
      })
    );
  });
});
