/**
 * Hub Bootstrap 1: Gap Analysis Tests (Backend)
 *
 * Spec 2026-02-28: Hub Bootstrap 1 -- Product Definition (PM) End-to-End
 * Task Group 8: Test Review and Gap Analysis
 *
 * These tests fill critical backend coverage gaps identified during the TG8
 * review of existing tests from Task Groups 1-7.
 *
 * Gap tests (3 backend tests):
 * 1. POST /generate filters thread messages by taskId (non-matching taskId messages excluded)
 * 2. POST /save-artifact persists a completion chip message to the thread on disk on success
 * 3. POST /save-artifact with fetchProductName failure falls back to projectId as productName
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
    mcpBaseUrl: 'http://localhost:8090',
    architectureModelServiceBaseUrl: 'http://localhost:8080',
    logLevel: 'error',
    port: 8081,
    rateLimitRpm: 1000,
    rateLimitBurst: 100,
    allowedOrigins: ['http://localhost:5173'],
  }),
}));

// ---- Mock logger ----
jest.mock('../services/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
  logToolCall: jest.fn(),
  logOpenAIRequest: jest.fn(),
}));

// ---- Mock sendChatRequest ----
const mockSendChatRequest = jest.fn();
jest.mock('../services/openaiClient', () => ({
  sendChatRequest: (...args: unknown[]) => mockSendChatRequest(...args),
}));

// ---- Mock executeToolCall ----
const mockExecuteToolCall = jest.fn();
jest.mock('../services/toolExecutor', () => ({
  executeToolCall: (...args: unknown[]) => mockExecuteToolCall(...args),
}));

// ---- Mock fetchProductName ----
const mockFetchProductName = jest.fn();
jest.mock('../services/architectureModelClient', () => {
  const actual = jest.requireActual('../services/architectureModelClient');
  return {
    ...actual,
    fetchProjectFolder: jest.fn(async () => testTmpDir),
    fetchProductName: (...args: unknown[]) => mockFetchProductName(...args),
  };
});

// ---- Imports (after mocks) ----
import express from 'express';
import request from 'supertest';
import { initializeRegistries } from '../services/registryLoader';
import { chatV2Router } from '../routes/chatV2';
import { createThread, appendMessage, getThread } from '../services/threadStore';
import { ThreadKey, ThreadMessage } from '../types/chatV2';
import { v4 as uuidv4 } from 'uuid';

// Build a minimal Express app for testing
function createTestApp() {
  const app = express();
  app.use(express.json({ limit: '30mb' }));
  app.use((req, _res, next) => {
    req.requestId = 'test-request-id';
    next();
  });
  app.use('/api/chat/v2', chatV2Router);
  return app;
}

describe('Hub Bootstrap Gap Tests (Backend, Spec 2026-02-28, Task Group 8)', () => {
  let app: express.Application;

  beforeAll(async () => {
    testTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hub-bootstrap-gap-'));
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
    mockExecuteToolCall.mockReset();
    mockFetchProductName.mockReset();
  
    // Clean thread files between tests to prevent cross-test contamination
    try {
      await fs.rm(path.join(testTmpDir, 'threads'), { recursive: true, force: true });
    } catch {
      // Ignore if directory does not exist
    }
  });

  // ========================================================================
  // Gap Test 1: POST /generate filters thread messages by taskId
  //
  // Verifies that only messages with the requested taskId are included in
  // the transcript sent to the LLM, and messages from other tasks are excluded.
  // ========================================================================
  it('POST /generate filters thread messages by taskId, excluding messages from other tasks', async () => {
    const threadKey: ThreadKey = { type: 'hub', projectId: 'gap-gen-filter' };
    await createThread(threadKey);

    // Add messages from the target task
    const targetMsg1: ThreadMessage = {
      id: uuidv4(),
      role: 'user',
      personaId: null,
      taskId: 'product-manager--define-product',
      content: 'My product helps developers.',
      structuredResponse: null,
      timestamp: new Date().toISOString(),
    };

    const targetMsg2: ThreadMessage = {
      id: uuidv4(),
      role: 'assistant',
      personaId: 'product-manager',
      taskId: 'product-manager--define-product',
      content: 'Tell me more about the audience.',
      structuredResponse: null,
      timestamp: new Date().toISOString(),
    };

    // Add a message from a DIFFERENT task (should be excluded)
    const otherTaskMsg: ThreadMessage = {
      id: uuidv4(),
      role: 'user',
      personaId: null,
      taskId: 'architect--baseline',
      content: 'This should NOT appear in the generation transcript.',
      structuredResponse: null,
      timestamp: new Date().toISOString(),
    };

    await appendMessage(threadKey, targetMsg1);
    await appendMessage(threadKey, otherTaskMsg);
    await appendMessage(threadKey, targetMsg2);

    mockSendChatRequest.mockResolvedValueOnce({
      id: 'gen-filter-response',
      content: undefined,
      toolCalls: [
        {
          callId: 'call-filter',
          name: 'save_product_artifacts',
          arguments: {
            missionMarkdown: '# Filtered Mission',
            projectParentFolder: '/path',
            projectId: 'gap-gen-filter',
            productName: 'Test',
          },
        },
      ],
      isFinal: false,
    });

    await request(app)
      .post('/api/chat/v2/generate')
      .send({
        threadKey: { type: 'hub', projectId: 'gap-gen-filter' },
        personaId: 'product-manager',
        taskId: 'product-manager--define-product',
      });

    // Verify the messages sent to LLM
    expect(mockSendChatRequest).toHaveBeenCalledTimes(1);
    const callArgs = mockSendChatRequest.mock.calls[0];
    const messages = callArgs[0] as Array<{ role: string; content: string }>;

    // First message is the system prompt (MISSION_GENERATION_PROMPT_TEMPLATE)
    // Last message is 'Generate the MISSION.MD now.'
    // In between should be ONLY the target task messages (2 messages, not 3)
    const transcriptMessages = messages.slice(1, -1);
    expect(transcriptMessages).toHaveLength(2);

    // Verify the other-task message is NOT in the transcript
    const hasOtherTask = transcriptMessages.some(
      (m) => m.content.includes('This should NOT appear')
    );
    expect(hasOtherTask).toBe(false);

    // Verify target task messages ARE in the transcript
    expect(transcriptMessages[0].content).toBe('My product helps developers.');
    expect(transcriptMessages[1].content).toBe('Tell me more about the audience.');
  });

  // ========================================================================
  // Gap Test 2: POST /save-artifact persists completion chip to thread on disk
  //
  // Verifies that after a successful save, the completion chip ThreadMessage
  // is actually written to the thread on disk (not just returned as success).
  // ========================================================================
  it('POST /save-artifact persists a completion chip message to the thread on disk on success', async () => {
    const threadKey: ThreadKey = { type: 'hub', projectId: 'gap-save-chip' };
    await createThread(threadKey);

    // Add a discovery message so the thread exists with content
    const discoveryMsg: ThreadMessage = {
      id: uuidv4(),
      role: 'assistant',
      personaId: 'product-manager',
      taskId: 'product-manager--define-product',
      content: 'Discovery conversation content.',
      structuredResponse: null,
      timestamp: new Date().toISOString(),
    };
    await appendMessage(threadKey, discoveryMsg);

    mockFetchProductName.mockResolvedValueOnce('GapTestProduct');
    mockExecuteToolCall.mockResolvedValueOnce({
      callId: 'call-save-chip',
      output: { saved: true },
      status: 200,
      durationMs: 100,
    });

    const res = await request(app)
      .post('/api/chat/v2/save-artifact')
      .send({
        threadKey: { type: 'hub', projectId: 'gap-save-chip' },
        taskId: 'product-manager--define-product',
        artifactId: 'mission-md',
        content: '# Persisted Mission',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Read the thread back from disk and verify the completion chip is persisted
    const thread = await getThread(threadKey);
    expect(thread).not.toBeNull();

    const completionChips = thread!.messages.filter(
      (m: any) => m.structuredResponse && m.structuredResponse.type === 'completion-chip'
    );
    expect(completionChips).toHaveLength(1);

    const chip = completionChips[0];
    expect(chip.role).toBe('assistant');
    expect(chip.personaId).toBe('product-manager');
    expect(chip.taskId).toBe('product-manager--define-product');
    expect(chip.content).toBe('Product Definition complete.');

    const sr = chip.structuredResponse as any;
    expect(sr.type).toBe('completion-chip');
    expect(sr.artifactId).toBe('mission-md');
    expect(sr.artifactName).toBe('MISSION.MD');
    expect(sr.taskId).toBe('product-manager--define-product');
    expect(sr.personaId).toBe('product-manager');
    expect(typeof sr.timestamp).toBe('string');
  });

  // ========================================================================
  // Gap Test 3: POST /save-artifact falls back to projectId when
  //             fetchProductName fails
  //
  // Verifies that the save endpoint handles fetchProductName failure
  // gracefully by using projectId as the productName fallback.
  // ========================================================================
  it('POST /save-artifact falls back to projectId as productName when fetchProductName fails', async () => {
    const threadKey: ThreadKey = { type: 'hub', projectId: 'gap-fallback-name' };
    await createThread(threadKey);

    // Add a discovery message
    const msg: ThreadMessage = {
      id: uuidv4(),
      role: 'assistant',
      personaId: 'product-manager',
      taskId: 'product-manager--define-product',
      content: 'Some content.',
      structuredResponse: null,
      timestamp: new Date().toISOString(),
    };
    await appendMessage(threadKey, msg);

    // fetchProductName throws an error
    mockFetchProductName.mockRejectedValueOnce(new Error('Service unavailable'));
    mockExecuteToolCall.mockResolvedValueOnce({
      callId: 'call-fallback',
      output: { saved: true },
      status: 200,
      durationMs: 100,
    });

    const res = await request(app)
      .post('/api/chat/v2/save-artifact')
      .send({
        threadKey: { type: 'hub', projectId: 'gap-fallback-name' },
        taskId: 'product-manager--define-product',
        artifactId: 'mission-md',
        content: '# Fallback Mission',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify executeToolCall was called with projectId as productName (fallback)
    expect(mockExecuteToolCall).toHaveBeenCalledTimes(1);
    const toolCallArgs = mockExecuteToolCall.mock.calls[0];
    const args = toolCallArgs[2] as Record<string, unknown>;
    expect(args.productName).toBe('gap-fallback-name'); // projectId used as fallback
  });
});
