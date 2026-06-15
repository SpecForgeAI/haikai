/**
 * Tests for chatV2 work-item picker state machine
 *
 * Spec 2026-03-04: What's Next v1-C -- Work Item Picker
 * Task Group 10: Integration tests for the picker flow in POST /api/chat/v2.
 *
 * Integration-level tests that verify the picker short-circuit path within POST /api/chat/v2.
 * Mocks searchWorkItems and other external dependencies to control behavior.
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

// ---- Mock sendChatRequest (should NOT be called for picker flow) ----
const mockSendChatRequest = jest.fn();
jest.mock('../services/openaiClient', () => ({
  sendChatRequest: (...args: unknown[]) => mockSendChatRequest(...args),
}));

// ---- Mock executeToolCall ----
jest.mock('../services/toolExecutor', () => ({
  executeToolCall: jest.fn(),
}));

// ---- Mock architectureModelClient ----
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

// ---- Mock searchWorkItems ----
const mockSearchWorkItems = jest.fn();
jest.mock('../services/workItemSearchService', () => ({
  searchWorkItems: (...args: unknown[]) => mockSearchWorkItems(...args),
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

describe('chatV2 work-item picker state machine (Spec 2026-03-04, v1-C Task Group 10)', () => {
  let app: express.Application;

  beforeAll(async () => {
    testTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chatv2-picker-test-'));
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
    mockSearchWorkItems.mockReset();
  
    // Clean thread files between tests to prevent cross-test contamination
    try {
      await fs.rm(path.join(testTmpDir, 'threads'), { recursive: true, force: true });
    } catch {
      // Ignore if directory does not exist
    }
  });

  // ========================================================================
  // Test 1: INITIATE returns prompt message and does NOT call LLM
  // ========================================================================
  it('returns prompt message for pickerAction "initiate" without calling LLM', async () => {
    const res = await request(app)
      .post('/api/chat/v2')
      .send({
        threadKey: { type: 'hub', projectId: 'picker-test-1' },
        personaId: 'assistant',
        taskId: 'assistant--whats-next',
        message: '[Action: Start Implementation]',
        pickerAction: 'initiate',
        pickerPayload: { actionId: 'start-implementation' },
      })
      .expect(200);

    // Should contain prompt for work item search
    expect(res.body.assistant.message).toContain('work item');
    // No LLM call
    expect(mockSendChatRequest).not.toHaveBeenCalled();
    // structuredResponse should be null for initiate
    expect(res.body.structuredResponse).toBeNull();
    // Response shape
    expect(res.body.threadKey).toBeDefined();
    expect(res.body.personaId).toBe('assistant');
    expect(res.body.taskId).toBe('assistant--whats-next');
  });

  // ========================================================================
  // Test 2: SEARCH with results returns work-item-search-results
  // ========================================================================
  it('returns structuredResponse with type work-item-search-results for search with results', async () => {
    // First initiate to set up picker state
    await request(app)
      .post('/api/chat/v2')
      .send({
        threadKey: { type: 'hub', projectId: 'picker-test-2' },
        personaId: 'assistant',
        taskId: 'assistant--whats-next',
        message: '[Action: Start Implementation]',
        pickerAction: 'initiate',
        pickerPayload: { actionId: 'start-implementation' },
      })
      .expect(200);

    // Mock search results
    mockSearchWorkItems.mockResolvedValue([
      { id: 'feat-1', title: 'Login Feature', type: 'FEATURE', status: 'PLANNED', parentTitle: 'Epic 1', inScope: true },
      { id: 'feat-2', title: 'Login API', type: 'FEATURE', status: 'IN_PROGRESS', parentTitle: 'Epic 1', inScope: true },
      { id: 'story-1', title: 'Login Validation', type: 'STORY', status: 'PLANNED', parentTitle: 'Login Feature', inScope: false },
    ]);

    // Then search
    const res = await request(app)
      .post('/api/chat/v2')
      .send({
        threadKey: { type: 'hub', projectId: 'picker-test-2' },
        personaId: 'assistant',
        taskId: 'assistant--whats-next',
        message: 'login',
        pickerAction: 'search',
        pickerPayload: { query: 'login', scopeType: 'NEXT_5_EPICS' },
      })
      .expect(200);

    expect(res.body.structuredResponse).toBeDefined();
    expect(res.body.structuredResponse.type).toBe('work-item-search-results');
    expect(res.body.structuredResponse.results).toHaveLength(3);
    expect(res.body.structuredResponse.query).toBe('login');
    expect(mockSendChatRequest).not.toHaveBeenCalled();
  });

  // ========================================================================
  // Test 3: SEARCH with no results returns retry message
  // ========================================================================
  it('returns retry message when search returns no results', async () => {
    // First initiate
    await request(app)
      .post('/api/chat/v2')
      .send({
        threadKey: { type: 'hub', projectId: 'picker-test-3' },
        personaId: 'assistant',
        taskId: 'assistant--whats-next',
        message: '[Action: Start Implementation]',
        pickerAction: 'initiate',
        pickerPayload: { actionId: 'start-implementation' },
      })
      .expect(200);

    // Mock empty search results
    mockSearchWorkItems.mockResolvedValue([]);

    // Search with no results
    const res = await request(app)
      .post('/api/chat/v2')
      .send({
        threadKey: { type: 'hub', projectId: 'picker-test-3' },
        personaId: 'assistant',
        taskId: 'assistant--whats-next',
        message: 'zzzznonexistent',
        pickerAction: 'search',
        pickerPayload: { query: 'zzzznonexistent' },
      })
      .expect(200);

    expect(res.body.assistant.message).toContain('No work items found');
    expect(res.body.structuredResponse).toBeNull();

    // Verify picker state still works -- a second search should still function
    mockSearchWorkItems.mockResolvedValue([
      { id: 'feat-1', title: 'Found Feature', type: 'FEATURE', status: 'PLANNED', parentTitle: null, inScope: false },
    ]);

    const res2 = await request(app)
      .post('/api/chat/v2')
      .send({
        threadKey: { type: 'hub', projectId: 'picker-test-3' },
        personaId: 'assistant',
        taskId: 'assistant--whats-next',
        message: 'found',
        pickerAction: 'search',
        pickerPayload: { query: 'found' },
      })
      .expect(200);

    expect(res2.body.structuredResponse).toBeDefined();
    expect(res2.body.structuredResponse.type).toBe('work-item-search-results');
  });

  // ========================================================================
  // Test 4: SELECT returns work-item-selected confirmation
  // ========================================================================
  it('returns structuredResponse with type work-item-selected for select action', async () => {
    // Initiate
    await request(app)
      .post('/api/chat/v2')
      .send({
        threadKey: { type: 'hub', projectId: 'picker-test-4' },
        personaId: 'assistant',
        taskId: 'assistant--whats-next',
        message: '[Action: Start Implementation]',
        pickerAction: 'initiate',
        pickerPayload: { actionId: 'start-implementation' },
      })
      .expect(200);

    // Search (to transition to awaiting-selection)
    mockSearchWorkItems.mockResolvedValue([
      { id: 'feat-1', title: 'Login Feature', type: 'FEATURE', status: 'PLANNED', parentTitle: 'Epic 1', inScope: true },
    ]);

    await request(app)
      .post('/api/chat/v2')
      .send({
        threadKey: { type: 'hub', projectId: 'picker-test-4' },
        personaId: 'assistant',
        taskId: 'assistant--whats-next',
        message: 'login',
        pickerAction: 'search',
        pickerPayload: { query: 'login' },
      })
      .expect(200);

    // Select
    const res = await request(app)
      .post('/api/chat/v2')
      .send({
        threadKey: { type: 'hub', projectId: 'picker-test-4' },
        personaId: 'assistant',
        taskId: 'assistant--whats-next',
        message: '[Select: Login Feature]',
        pickerAction: 'select',
        pickerPayload: { workItemId: 'feat-1', workItemTitle: 'Login Feature' },
      })
      .expect(200);

    expect(res.body.structuredResponse).toBeDefined();
    expect(res.body.structuredResponse.type).toBe('work-item-selected');
    expect(res.body.structuredResponse.workItemId).toBe('feat-1');
    expect(res.body.structuredResponse.workItemTitle).toBe('Login Feature');
    expect(mockSendChatRequest).not.toHaveBeenCalled();
  });

  // ========================================================================
  // Test 5: CANCEL returns cancellation message
  // ========================================================================
  it('returns cancellation message for pickerAction "cancel"', async () => {
    // Initiate
    await request(app)
      .post('/api/chat/v2')
      .send({
        threadKey: { type: 'hub', projectId: 'picker-test-5' },
        personaId: 'assistant',
        taskId: 'assistant--whats-next',
        message: '[Action: Start Implementation]',
        pickerAction: 'initiate',
        pickerPayload: { actionId: 'start-implementation' },
      })
      .expect(200);

    // Cancel
    const res = await request(app)
      .post('/api/chat/v2')
      .send({
        threadKey: { type: 'hub', projectId: 'picker-test-5' },
        personaId: 'assistant',
        taskId: 'assistant--whats-next',
        message: '[Cancel]',
        pickerAction: 'cancel',
      })
      .expect(200);

    expect(res.body.assistant.message).toContain('cancelled');
    expect(res.body.structuredResponse).toBeNull();
    expect(mockSendChatRequest).not.toHaveBeenCalled();
  });
});
