/**
 * Tests for server-side allowedPersonaIds validation
 *
 * Spec 2026-03-03: Unify Hub and RHS Panel Capabilities
 * Task Group 1: Backend Types, Validation, and Task Configs
 *
 * 4 focused tests:
 * 1. POST /api/chat/v2 returns 400 when personaId is not in allowedPersonaIds
 * 2. POST /api/chat/v2 succeeds when personaId IS in allowedPersonaIds
 * 3. POST /api/chat/v2 succeeds when allowedPersonaIds is omitted (unrestricted)
 * 4. POST /api/chat/v2/generate returns 400 when personaId is not in allowedPersonaIds
 *
 * Uses supertest to make HTTP requests against the Express app.
 * Mocks sendChatRequest, logger, config, and threadSummariser.
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

// ---- Mock executeToolCall (needed for /save-artifact) ----
const mockExecuteToolCall = jest.fn();
jest.mock('../services/toolExecutor', () => ({
  executeToolCall: (...args: unknown[]) => mockExecuteToolCall(...args),
}));

// ---- Mock fetchProductName (needed for /save-artifact) ----
const mockFetchProductName = jest.fn();
jest.mock('../services/architectureModelClient', () => {
  const actual = jest.requireActual('../services/architectureModelClient');
  return {
    ...actual,
    fetchProjectFolder: jest.fn(async () => testTmpDir),
    fetchProductName: (...args: unknown[]) => mockFetchProductName(...args),
    fetchProductSummary: jest.fn().mockResolvedValue(null),
    fetchMetaModelSummary: jest.fn().mockResolvedValue(null),
  };
});

// ---- Mock threadSummariser (used by POST / handler) ----
jest.mock('../services/threadSummariser', () => ({
  maybeSummariseThread: jest.fn().mockResolvedValue(undefined),
}));

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

describe('allowedPersonaIds Validation (Spec 2026-03-03, Task Group 1)', () => {
  let app: express.Application;

  beforeAll(async () => {
    testTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chatv2-allowed-persona-test-'));
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
  // Test 1: POST /api/chat/v2 returns 400 when personaId is NOT in allowedPersonaIds
  // ========================================================================
  it('POST / returns 400 when personaId is not in allowedPersonaIds', async () => {
    const res = await request(app)
      .post('/api/chat/v2')
      .send({
        threadKey: { type: 'hub', projectId: 'allowed-test-project' },
        personaId: 'architect',
        taskId: 'unknown',
        message: 'Hello',
        allowedPersonaIds: ['product-manager'],
      })
      .expect(400);

    expect(res.body.error).toContain('Persona not allowed');
    expect(res.body.error).toContain('architect');
    expect(res.body.error).toContain('allowedPersonaIds');
  });

  // ========================================================================
  // Test 2: POST /api/chat/v2 succeeds when personaId IS in allowedPersonaIds
  // ========================================================================
  it('POST / succeeds when personaId IS in allowedPersonaIds', async () => {
    // Mock the LLM response for a valid request
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
        threadKey: { type: 'hub', projectId: 'allowed-test-project-2' },
        personaId: 'product-manager',
        taskId: 'product-manager--define-product',
        message: 'Hello',
        allowedPersonaIds: ['product-manager', 'architect'],
      })
      .expect(200);

    expect(res.body.personaId).toBe('product-manager');
    expect(res.body.taskId).toBe('product-manager--define-product');
  });

  // ========================================================================
  // Test 3: POST /api/chat/v2 succeeds when allowedPersonaIds is omitted (unrestricted)
  // ========================================================================
  it('POST / succeeds when allowedPersonaIds is omitted (unrestricted)', async () => {
    mockSendChatRequest.mockResolvedValue({
      content: JSON.stringify({
        phase: 'questions',
        section: 'product_basics',
        questions: ['Tell me about your product.'],
        summary: 'Starting discovery.',
      }),
      toolCalls: [],
    });

    const res = await request(app)
      .post('/api/chat/v2')
      .send({
        threadKey: { type: 'hub', projectId: 'allowed-test-project-3' },
        personaId: 'product-manager',
        taskId: 'product-manager--define-product',
        message: 'Hello',
        // no allowedPersonaIds field
      })
      .expect(200);

    expect(res.body.personaId).toBe('product-manager');
    expect(res.body.taskId).toBe('product-manager--define-product');
  });

  // ========================================================================
  // Test 4: POST /api/chat/v2/generate returns 400 when personaId is NOT in allowedPersonaIds
  // ========================================================================
  it('POST /generate returns 400 when personaId is not in allowedPersonaIds', async () => {
    // Seed a thread so the generate endpoint has something to work with
    const threadKey: ThreadKey = { type: 'hub', projectId: 'allowed-generate-test' };
    await createThread(threadKey);

    const userMsg: ThreadMessage = {
      id: uuidv4(),
      role: 'user',
      personaId: null,
      taskId: 'product-manager--define-product',
      content: 'My product is called TestApp.',
      structuredResponse: null,
      timestamp: new Date().toISOString(),
    };
    await appendMessage(threadKey, userMsg);

    const assistantMsg: ThreadMessage = {
      id: uuidv4(),
      role: 'assistant',
      personaId: 'product-manager',
      taskId: 'product-manager--define-product',
      content: JSON.stringify({
        phase: 'ready',
        section: 'final_review',
        questions: [],
        summary: 'Ready to generate.',
      }),
      structuredResponse: null,
      timestamp: new Date().toISOString(),
    };
    await appendMessage(threadKey, assistantMsg);

    const res = await request(app)
      .post('/api/chat/v2/generate')
      .send({
        threadKey: { type: 'hub', projectId: 'allowed-generate-test' },
        personaId: 'product-manager',
        taskId: 'product-manager--define-product',
        allowedPersonaIds: ['architect'],
      })
      .expect(400);

    expect(res.body.error).toContain('Persona not allowed');
    expect(res.body.error).toContain('product-manager');
    expect(res.body.error).toContain('allowedPersonaIds');
  });
});
