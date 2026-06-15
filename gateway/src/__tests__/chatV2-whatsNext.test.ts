/**
 * Tests for chatV2 whats-next short-circuit
 *
 * Spec 2026-03-04: Assistant "What's Next" v1
 * Task Group 4 (Task 4.1): Write 3-5 focused tests for the chatV2 whats-next short-circuit
 *
 * Integration-level tests that verify the short-circuit path within POST /api/chat/v2.
 * Mocks buildProjectSignals and evaluateNextActions to control behavior.
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

// ---- Mock sendChatRequest (should NOT be called for whats-next) ----
const mockSendChatRequest = jest.fn();
jest.mock('../services/openaiClient', () => ({
  sendChatRequest: (...args: unknown[]) => mockSendChatRequest(...args),
}));

// ---- Mock executeToolCall ----
jest.mock('../services/toolExecutor', () => ({
  executeToolCall: jest.fn(),
}));

// ---- Mock architectureModelClient (needed for other chatV2 paths) ----
jest.mock('../services/architectureModelClient', () => {
  const actual = jest.requireActual('../services/architectureModelClient');
  return {
    ...actual,
    fetchProjectFolder: jest.fn(async () => testTmpDir),
    fetchProductName: jest.fn().mockResolvedValue(null),
    fetchProductSummary: jest.fn().mockResolvedValue(null),
    fetchMetaModelSummary: jest.fn().mockResolvedValue(null),
  };
});

// ---- Mock threadSummariser ----
jest.mock('../services/threadSummariser', () => ({
  maybeSummariseThread: jest.fn().mockResolvedValue(undefined),
}));

// ---- Mock buildProjectSignals ----
const mockBuildProjectSignals = jest.fn();
jest.mock('../services/projectSignals', () => ({
  buildProjectSignals: (...args: unknown[]) => mockBuildProjectSignals(...args),
}));

// ---- Mock evaluateNextActions ----
const mockEvaluateNextActions = jest.fn();
jest.mock('../services/whatsNextEvaluator', () => ({
  evaluateNextActions: (...args: unknown[]) => mockEvaluateNextActions(...args),
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
    req.requestId = 'test-request-id';
    next();
  });
  app.use('/api/chat/v2', chatV2Router);
  return app;
}

describe('chatV2 whats-next short-circuit (Spec 2026-03-04, Task Group 4)', () => {
  let app: express.Application;

  beforeAll(async () => {
    testTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chatv2-whats-next-test-'));
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
    mockBuildProjectSignals.mockReset();
    mockEvaluateNextActions.mockReset();

    // Default mock returns
    mockBuildProjectSignals.mockResolvedValue({
      missionExists: false,
      techStandardsExists: false,
      testStrategyExists: false,
      roadmapExists: false,
      architectureBaselineExists: false,
      usersAndInteractionsExists: false,
      epicCount: 0,
      storyCount: 0,
      storiesWithAC: 0,
      storiesInProgress: 0,
      storiesDone: 0,
      storiesVerified: 0,
    });

    mockEvaluateNextActions.mockReturnValue({
      explanation: 'Your project does not yet have a Product Mission defined.',
      actions: [{
        id: 'define-mission',
        label: 'Define Product Mission',
        reason: 'A product mission is the foundation.',
        priority: 100,
        target: { screen: 'product', tab: 'product', personaId: 'product-manager', taskId: 'product-manager--define-product' },
        launch: 'panel',
      }],
    });

    // Clean thread files between tests to prevent cross-test contamination
    try {
      await fs.rm(path.join(testTmpDir, 'threads'), { recursive: true, force: true });
    } catch {
      // Ignore if directory does not exist
    }
  });

  // ========================================================================
  // Test 1: Short-circuit triggers and response includes whats-next-actions
  // ========================================================================
  it('returns structuredResponse.type "whats-next-actions" for assistant--whats-next taskId', async () => {
    const res = await request(app)
      .post('/api/chat/v2')
      .send({
        threadKey: { type: 'hub', projectId: 'whats-next-test-1' },
        personaId: 'assistant',
        taskId: 'assistant--whats-next',
        message: "What's next?",
      })
      .expect(200);

    expect(res.body.structuredResponse).toBeDefined();
    expect(res.body.structuredResponse.type).toBe('whats-next-actions');
    expect(res.body.structuredResponse.actions).toHaveLength(1);
    expect(res.body.structuredResponse.actions[0].id).toBe('define-mission');
    expect(res.body.structuredResponse.explanation).toContain('Product Mission');
  });

  // ========================================================================
  // Test 2: Response shape matches ChatV2Response interface
  // ========================================================================
  it('returns correct response shape with threadKey, personaId, taskId, assistant.message', async () => {
    const res = await request(app)
      .post('/api/chat/v2')
      .send({
        threadKey: { type: 'hub', projectId: 'whats-next-test-2' },
        personaId: 'assistant',
        taskId: 'assistant--whats-next',
        message: "What's next?",
      })
      .expect(200);

    expect(res.body.threadKey).toBeDefined();
    expect(res.body.personaId).toBe('assistant');
    expect(res.body.taskId).toBe('assistant--whats-next');
    expect(res.body.assistant).toBeDefined();
    expect(res.body.assistant.message).toBeDefined();
    expect(typeof res.body.assistant.message).toBe('string');
  });

  // ========================================================================
  // Test 3: No LLM call made -- sendChatRequest is never invoked
  // ========================================================================
  it('does not call the LLM (sendChatRequest) for assistant--whats-next', async () => {
    await request(app)
      .post('/api/chat/v2')
      .send({
        threadKey: { type: 'hub', projectId: 'whats-next-test-3' },
        personaId: 'assistant',
        taskId: 'assistant--whats-next',
        message: "What's next?",
      })
      .expect(200);

    expect(mockSendChatRequest).not.toHaveBeenCalled();
  });

  // ========================================================================
  // Test 4: Non-whats-next tasks are unaffected by the short-circuit
  // ========================================================================
  it('does NOT short-circuit for non-whats-next task IDs', async () => {
    // Use product-manager--define-product which will go through normal LLM path
    mockSendChatRequest.mockResolvedValue({
      content: JSON.stringify({
        phase: 'questions',
        section: 'product_basics',
        questions: ['What is your product?'],
        summary: 'Getting started.',
      }),
      toolCalls: [],
    });

    const res = await request(app)
      .post('/api/chat/v2')
      .send({
        threadKey: { type: 'hub', projectId: 'whats-next-test-4' },
        personaId: 'product-manager',
        taskId: 'product-manager--define-product',
        message: 'Hello',
      })
      .expect(200);

    // The LLM should have been called for non-whats-next tasks
    expect(mockSendChatRequest).toHaveBeenCalled();
    // And the response should NOT have whats-next-actions type
    if (res.body.structuredResponse) {
      expect(res.body.structuredResponse.type).not.toBe('whats-next-actions');
    }
  });

  // ========================================================================
  // Test 5: buildProjectSignals and evaluateNextActions are called
  // ========================================================================
  it('calls buildProjectSignals and evaluateNextActions for assistant--whats-next', async () => {
    await request(app)
      .post('/api/chat/v2')
      .send({
        threadKey: { type: 'hub', projectId: 'whats-next-test-5' },
        personaId: 'assistant',
        taskId: 'assistant--whats-next',
        message: "What's next?",
      })
      .expect(200);

    expect(mockBuildProjectSignals).toHaveBeenCalledWith('whats-next-test-5');
    expect(mockEvaluateNextActions).toHaveBeenCalled();
  });
});
