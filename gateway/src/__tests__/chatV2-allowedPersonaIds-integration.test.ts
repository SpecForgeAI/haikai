/**
 * Integration Tests for allowedPersonaIds -- Gap Analysis Coverage
 *
 * Spec 2026-03-03: Unify Hub and RHS Panel Capabilities
 * Task Group 5: Test Review and Gap Analysis
 *
 * These tests fill critical gaps identified in the review of Task Groups 1-4:
 *
 * Test 1: isChatV2Request returns true when allowedPersonaIds is a valid string array
 * Test 2: isChatV2Request returns true when allowedPersonaIds is omitted
 * Test 3: isChatV2Request returns false when allowedPersonaIds is not an array of strings
 * Test 4: POST /generate returns 400 when persona not in allowedPersonaIds
 * Test 5: POST /save-artifact returns 400 when resolved persona not in allowedPersonaIds
 * Test 6: Task menu from panel threadKey includes architect--define-architecture (now in availableFrom)
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
import { isChatV2Request, ThreadKey, ThreadMessage } from '../types/chatV2';
import { createThread, appendMessage } from '../services/threadStore';
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

describe('allowedPersonaIds Integration Tests (Spec 2026-03-03, Task Group 5)', () => {
  let app: express.Application;

  beforeAll(async () => {
    testTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chatv2-integration-test-'));
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

  // ==========================================================================
  // Test 1: isChatV2Request returns true when allowedPersonaIds is a valid string array
  // ==========================================================================
  it('isChatV2Request returns true when allowedPersonaIds is a valid string array', () => {
    const validRequest = {
      threadKey: { type: 'panel', projectId: 'proj-1', screen: 'metamodel' },
      personaId: 'architect',
      taskId: 'unknown',
      message: 'Hello',
      allowedPersonaIds: ['architect', 'ux-designer', 'test-engineer'],
    };

    expect(isChatV2Request(validRequest)).toBe(true);
  });

  // ==========================================================================
  // Test 2: isChatV2Request returns true when allowedPersonaIds is omitted
  // ==========================================================================
  it('isChatV2Request returns true when allowedPersonaIds is omitted', () => {
    const requestWithout = {
      threadKey: { type: 'hub', projectId: 'proj-2' },
      personaId: 'assistant',
      taskId: 'unknown',
      message: 'Hello',
    };

    expect(isChatV2Request(requestWithout)).toBe(true);
  });

  // ==========================================================================
  // Test 3: isChatV2Request returns false when allowedPersonaIds is not an array of strings
  // ==========================================================================
  it('isChatV2Request returns false when allowedPersonaIds is not an array of strings', () => {
    // Case A: allowedPersonaIds is a string instead of array
    const invalidA = {
      threadKey: { type: 'hub', projectId: 'proj-3' },
      personaId: 'assistant',
      taskId: 'unknown',
      message: 'Hello',
      allowedPersonaIds: 'architect',
    };
    expect(isChatV2Request(invalidA)).toBe(false);

    // Case B: allowedPersonaIds is an array with non-string elements
    const invalidB = {
      threadKey: { type: 'hub', projectId: 'proj-3' },
      personaId: 'assistant',
      taskId: 'unknown',
      message: 'Hello',
      allowedPersonaIds: [123, 456],
    };
    expect(isChatV2Request(invalidB)).toBe(false);

    // Case C: allowedPersonaIds is an array with mixed types
    const invalidC = {
      threadKey: { type: 'hub', projectId: 'proj-3' },
      personaId: 'assistant',
      taskId: 'unknown',
      message: 'Hello',
      allowedPersonaIds: ['architect', 42],
    };
    expect(isChatV2Request(invalidC)).toBe(false);
  });

  // ==========================================================================
  // Test 4: POST /generate returns 400 when persona not in allowedPersonaIds
  //         (distinct from Group 1 Test 4 -- uses architect persona & architecture task)
  // ==========================================================================
  it('POST /generate returns 400 when persona not in allowedPersonaIds (architect scenario)', async () => {
    // Seed a thread so the generate endpoint has something to work with
    const threadKey: ThreadKey = { type: 'panel', projectId: 'integration-gen-test', screen: 'metamodel' };
    await createThread(threadKey);

    const userMsg: ThreadMessage = {
      id: uuidv4(),
      role: 'user',
      personaId: null,
      taskId: 'architect--define-architecture',
      content: 'My system needs microservices.',
      structuredResponse: null,
      timestamp: new Date().toISOString(),
    };
    await appendMessage(threadKey, userMsg);

    const assistantMsg: ThreadMessage = {
      id: uuidv4(),
      role: 'assistant',
      personaId: 'architect',
      taskId: 'architect--define-architecture',
      content: JSON.stringify({
        phase: 'ready',
        section: 'final_review',
        questions: [],
        summary: 'Ready to generate architecture baseline.',
      }),
      structuredResponse: null,
      timestamp: new Date().toISOString(),
    };
    await appendMessage(threadKey, assistantMsg);

    const res = await request(app)
      .post('/api/chat/v2/generate')
      .send({
        threadKey: { type: 'panel', projectId: 'integration-gen-test', screen: 'metamodel' },
        personaId: 'architect',
        taskId: 'architect--define-architecture',
        allowedPersonaIds: ['product-manager'], // architect is NOT allowed
      })
      .expect(400);

    expect(res.body.error).toContain('Persona not allowed');
    expect(res.body.error).toContain('architect');
  });

  // ==========================================================================
  // Test 5: POST /save-artifact returns 400 when resolved persona not in allowedPersonaIds
  // ==========================================================================
  it('POST /save-artifact returns 400 when resolved persona not in allowedPersonaIds', async () => {
    // The save-artifact endpoint resolves personaId from the task definition.
    // architect--define-architecture has personaId: "architect".
    // Sending allowedPersonaIds: ['product-manager'] should reject.

    const res = await request(app)
      .post('/api/chat/v2/save-artifact')
      .send({
        threadKey: { type: 'panel', projectId: 'integration-save-test', screen: 'metamodel' },
        taskId: 'architect--define-architecture',
        artifactId: 'architecture-baseline',
        content: '{"entities": {}, "relationships": {}}',
        allowedPersonaIds: ['product-manager'], // architect is NOT allowed
      })
      .expect(400);

    expect(res.body.error).toContain('Persona not allowed');
    expect(res.body.error).toContain('architect');
  });

  // ==========================================================================
  // Test 6: Task menu from panel threadKey includes architect--define-architecture
  //         (verifies availableFrom: ["hub", "panel"] filtering works for panel entry point)
  // ==========================================================================
  it('task menu from panel threadKey includes architect--define-architecture', async () => {
    // When personaId is architect and taskId is 'unknown', the backend returns a task-menu.
    // For a panel threadKey, the entryPoint is 'panel'.
    // architect--define-architecture has availableFrom: ["hub", "panel"] so it should appear.

    mockSendChatRequest.mockResolvedValue({
      content: 'Menu returned',
      toolCalls: [],
    });

    const res = await request(app)
      .post('/api/chat/v2')
      .send({
        threadKey: { type: 'panel', projectId: 'integration-menu-test', screen: 'metamodel' },
        personaId: 'architect',
        taskId: 'unknown',
        message: '',
      })
      .expect(200);

    // Response should be a task-menu type
    expect(res.body.taskId).toBe('unknown');
    expect(res.body.structuredResponse).toBeDefined();

    const sr = res.body.structuredResponse;
    expect(sr.type).toBe('task-menu');

    // The task menu uses 'tasks' array (not 'items')
    const taskIds = sr.tasks.map((task: { taskId: string }) => task.taskId);
    expect(taskIds).toContain('architect--define-architecture');
  });
});
