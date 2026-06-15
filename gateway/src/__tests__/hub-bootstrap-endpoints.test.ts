/**
 * Tests for POST /api/chat/v2/generate and POST /api/chat/v2/save-artifact Endpoints
 *
 * Spec 2026-02-28: Hub Bootstrap 1 -- Product Definition (PM) End-to-End
 * Task Group 2: Backend Generation and Save Endpoints
 *
 * 6 focused tests:
 * 1. POST /api/chat/v2/generate with valid { threadKey, personaId, taskId } and a thread
 *    containing discovery messages returns { success: true, missionMarkdown: string }
 * 2. POST /api/chat/v2/generate with missing threadKey returns 400
 * 3. POST /api/chat/v2/generate when LLM returns no tool call returns { success: false, error: string }
 * 4. POST /api/chat/v2/save-artifact with valid { threadKey, taskId, artifactId, content }
 *    returns { success: true }
 * 5. POST /api/chat/v2/save-artifact with missing content returns 400
 * 6. POST /api/chat/v2/save-artifact when executeToolCall returns an error returns
 *    { success: false, error: string } and does NOT insert a completion chip message
 *
 * Uses supertest to make HTTP requests against the Express app.
 * Mocks sendChatRequest, executeToolCall, fetchProductName, config, and logger.
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
import { createThread, appendMessage } from '../services/threadStore';
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

describe('Hub Bootstrap Endpoints (Spec 2026-02-28, Task Group 2)', () => {
  let app: express.Application;
  const testThreadKey: ThreadKey = { type: 'hub', projectId: 'bootstrap-test-project' };

  beforeAll(async () => {
    // Create a unique temporary directory for thread storage
    testTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hub-bootstrap-test-'));
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
  // Helper: seed a thread with discovery messages
  // ========================================================================
  async function seedDiscoveryThread(threadKey: ThreadKey): Promise<void> {
    await createThread(threadKey);

    const userMsg: ThreadMessage = {
      id: uuidv4(),
      role: 'user',
      personaId: null,
      taskId: 'product-manager--define-product',
      content: 'My product is called TestApp. It helps developers manage architecture.',
      structuredResponse: null,
      timestamp: new Date().toISOString(),
    };

    const assistantMsg: ThreadMessage = {
      id: uuidv4(),
      role: 'assistant',
      personaId: 'product-manager',
      taskId: 'product-manager--define-product',
      content: JSON.stringify({
        phase: 'questions',
        questions: ['What is the target audience?', 'What are the key constraints?'],
        summary: 'Understanding the product basics.',
      }),
      structuredResponse: {
        phase: 'questions',
        questions: ['What is the target audience?', 'What are the key constraints?'],
        summary: 'Understanding the product basics.',
      },
      timestamp: new Date().toISOString(),
    };

    const systemMsg: ThreadMessage = {
      id: uuidv4(),
      role: 'system',
      personaId: null,
      taskId: null,
      content: 'System message that should be skipped in transcript.',
      structuredResponse: null,
      timestamp: new Date().toISOString(),
    };

    await appendMessage(threadKey, systemMsg);
    await appendMessage(threadKey, userMsg);
    await appendMessage(threadKey, assistantMsg);
  }

  // ========================================================================
  // Test 1: POST /generate with valid body returns success with missionMarkdown
  // ========================================================================
  it('should return { success: true, missionMarkdown } when LLM returns a tool call with missionMarkdown', async () => {
    const threadKey: ThreadKey = { type: 'hub', projectId: 'gen-test-1' };
    await seedDiscoveryThread(threadKey);

    mockSendChatRequest.mockResolvedValueOnce({
      id: 'response-1',
      content: undefined,
      toolCalls: [
        {
          callId: 'call-1',
          name: 'save_product_artifacts',
          arguments: {
            missionMarkdown: '# MISSION: TestApp\n\n## Overview\nTestApp helps developers.',
            projectParentFolder: '/some/path',
            projectId: 'gen-test-1',
            productName: 'TestApp',
          },
        },
      ],
      isFinal: false,
    });

    const res = await request(app)
      .post('/api/chat/v2/generate')
      .send({
        threadKey: { type: 'hub', projectId: 'gen-test-1' },
        personaId: 'product-manager',
        taskId: 'product-manager--define-product',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.missionMarkdown).toBe('# MISSION: TestApp\n\n## Overview\nTestApp helps developers.');

    // Verify sendChatRequest was called with the correct structure
    expect(mockSendChatRequest).toHaveBeenCalledTimes(1);
    const callArgs = mockSendChatRequest.mock.calls[0];
    const messages = callArgs[0];

    // First message should be system with MISSION_GENERATION_PROMPT_TEMPLATE
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('Mission Document Generator');

    // Last message should be the generation trigger
    expect(messages[messages.length - 1].role).toBe('user');
    expect(messages[messages.length - 1].content).toBe('Generate the MISSION.MD now.');

    // System messages from thread should be excluded from transcript
    const transcriptMessages = messages.slice(1, -1); // Skip system prompt and trigger
    const systemInTranscript = transcriptMessages.filter((m: { role: string }) => m.role === 'system');
    expect(systemInTranscript.length).toBe(0);
  });

  // ========================================================================
  // Test 2: POST /generate with missing threadKey returns 400
  // ========================================================================
  it('should return 400 when threadKey is missing from generate request', async () => {
    const res = await request(app)
      .post('/api/chat/v2/generate')
      .send({
        personaId: 'product-manager',
        taskId: 'product-manager--define-product',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
    expect(typeof res.body.error).toBe('string');
  });

  // ========================================================================
  // Test 3: POST /generate when LLM returns no tool call returns failure
  // ========================================================================
  it('should return { success: false, error } when LLM returns no tool call', async () => {
    const threadKey: ThreadKey = { type: 'hub', projectId: 'gen-test-3' };
    await seedDiscoveryThread(threadKey);

    mockSendChatRequest.mockResolvedValueOnce({
      id: 'response-no-tool',
      content: 'I could not generate the mission document.',
      toolCalls: undefined,
      isFinal: true,
    });

    const res = await request(app)
      .post('/api/chat/v2/generate')
      .send({
        threadKey: { type: 'hub', projectId: 'gen-test-3' },
        personaId: 'product-manager',
        taskId: 'product-manager--define-product',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBeDefined();
    expect(typeof res.body.error).toBe('string');
  });

  // ========================================================================
  // Test 4: POST /save-artifact with valid body returns success
  // ========================================================================
  it('should return { success: true } when executeToolCall succeeds with status 200', async () => {
    const threadKey: ThreadKey = { type: 'hub', projectId: 'save-test-4' };
    await seedDiscoveryThread(threadKey);

    mockFetchProductName.mockResolvedValueOnce('TestApp');
    mockExecuteToolCall.mockResolvedValueOnce({
      callId: 'call-save-1',
      output: { saved: true },
      status: 200,
      durationMs: 150,
    });

    const res = await request(app)
      .post('/api/chat/v2/save-artifact')
      .send({
        threadKey: { type: 'hub', projectId: 'save-test-4' },
        taskId: 'product-manager--define-product',
        artifactId: 'mission-md',
        content: '# MISSION: TestApp\n\n## Overview\nA test product.',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify executeToolCall was called with correct args
    expect(mockExecuteToolCall).toHaveBeenCalledTimes(1);
    const toolCallArgs = mockExecuteToolCall.mock.calls[0];
    expect(toolCallArgs[1]).toBe('save_product_artifacts');
    // Args should include projectParentFolder from config (testTmpDir), not from request body
    const args = toolCallArgs[2];
    expect(args.projectParentFolder).toBe(testTmpDir);
    expect(args.projectId).toBe('save-test-4');
    expect(args.productName).toBe('TestApp');
    expect(args.missionMarkdown).toBe('# MISSION: TestApp\n\n## Overview\nA test product.');
    expect(args.overwrite).toBe(true);
  });

  // ========================================================================
  // Test 5: POST /save-artifact with missing content returns 400
  // ========================================================================
  it('should return 400 when content is missing from save-artifact request', async () => {
    const res = await request(app)
      .post('/api/chat/v2/save-artifact')
      .send({
        threadKey: { type: 'hub', projectId: 'save-test-5' },
        taskId: 'product-manager--define-product',
        artifactId: 'mission-md',
        // content is intentionally missing
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
    expect(typeof res.body.error).toBe('string');
  });

  // ========================================================================
  // Test 6: POST /save-artifact when executeToolCall returns error returns failure
  //         and does NOT insert a completion chip message
  // ========================================================================
  it('should return { success: false, error } when executeToolCall fails and NOT insert completion chip', async () => {
    const threadKey: ThreadKey = { type: 'hub', projectId: 'save-test-6' };
    await seedDiscoveryThread(threadKey);

    mockFetchProductName.mockResolvedValueOnce('TestApp');
    mockExecuteToolCall.mockResolvedValueOnce({
      callId: 'call-save-fail',
      error: 'MCP server connection failed',
      status: 502,
      durationMs: 5000,
    });

    const res = await request(app)
      .post('/api/chat/v2/save-artifact')
      .send({
        threadKey: { type: 'hub', projectId: 'save-test-6' },
        taskId: 'product-manager--define-product',
        artifactId: 'mission-md',
        content: '# MISSION: TestApp',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBeDefined();
    expect(typeof res.body.error).toBe('string');

    // Verify no completion chip was inserted -- read the thread and check messages
    const { getThread } = require('../services/threadStore');
    const thread = await getThread(threadKey);
    expect(thread).not.toBeNull();

    // None of the messages should be a completion chip
    const completionChips = thread!.messages.filter(
      (m: any) => m.structuredResponse && m.structuredResponse.type === 'completion-chip'
    );
    expect(completionChips.length).toBe(0);
  });
});
