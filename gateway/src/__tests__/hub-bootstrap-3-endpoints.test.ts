/**
 * Tests for Hub Bootstrap 3 -- Solution Architect Baseline Architecture End-to-End
 * Backend Endpoint Extensions
 *
 * Spec 2026-03-01: Hub Bootstrap 3 -- Solution Architect Baseline Architecture End-to-End
 * Task Group 2: Backend Endpoint Extensions (POST /, /generate, /save-artifact)
 *
 * 8 focused tests:
 * 1. POST / with architecture task injects resolvedContext['MISSION'] and resolvedContext['TECH STACK']
 *    from disk reads when both files exist
 * 2. POST / with architecture task when TECH-STACK.MD is missing proceeds without error
 * 3. POST / with architecture task does NOT produce a deterministic first-turn short-circuit
 * 4. POST /generate with architecture-baseline calls sendChatRequest with jsonMode, temperature, maxTokens
 *    and returns { success: true, artifactContent } with validated JSON
 * 5. POST /generate with architecture-baseline on first validation failure performs corrective retry
 * 6. POST /generate with architecture-baseline on second validation failure returns { success: false, error }
 * 7. POST /save-artifact with architecture adapter calls executeToolCall with save_architecture_baseline
 *    and inserts completion chip with architecture-baseline metadata
 * 8. POST /save-artifact with architecture adapter runs defense-in-depth validation
 */

import path from 'path';
import os from 'os';
import { promises as fsPromises } from 'fs';

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

// ---- Mock fetchProductName and fetchProductSummary ----
const mockFetchProductName = jest.fn();
const mockFetchProductSummary = jest.fn();
jest.mock('../services/architectureModelClient', () => {
  const actual = jest.requireActual('../services/architectureModelClient');
  return {
    ...actual,
    fetchProjectFolder: jest.fn(async () => testTmpDir),
    fetchProductName: (...args: unknown[]) => mockFetchProductName(...args),
    fetchProductSummary: (...args: unknown[]) => mockFetchProductSummary(...args),
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

// Valid architecture baseline JSON for testing
const VALID_BASELINE_JSON = {
  services: [
    { name: 'API Gateway', description: 'Entry point for all requests' },
    { name: 'Auth Service', description: 'Handles authentication' },
    { name: 'Data Service', description: 'Manages data storage' },
  ],
  interfaces: [
    { name: 'REST API', description: 'Public REST interface', serviceRef: 'API Gateway' },
    { name: 'Auth API', description: 'Auth endpoint', serviceRef: 'Auth Service' },
  ],
  interfaceEndpoints: [
    { name: 'POST /login', description: 'Login endpoint', interfaceRef: 'Auth API' },
  ],
  logicalDataEntities: [
    { name: 'User', description: 'User entity' },
    { name: 'Session', description: 'Session entity' },
  ],
  physicalDataEntities: [
    { name: 'users_table', description: 'Users database table' },
  ],
  businessLogic: [
    { name: 'AuthFlow', description: 'Authentication business logic' },
  ],
  dataMovements: [
    { name: 'UserSync', description: 'Sync user data between services' },
  ],
};

describe('Hub Bootstrap 3 Endpoint Extensions (Spec 2026-03-01, Task Group 2)', () => {
  let app: express.Application;

  beforeAll(async () => {
    testTmpDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'hub-bootstrap-3-test-'));
    await initializeRegistries();
    app = createTestApp();
  });

  afterAll(async () => {
    try {
      await fsPromises.rm(testTmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  beforeEach(async () => {
    mockSendChatRequest.mockReset();
    mockExecuteToolCall.mockReset();
    mockFetchProductName.mockReset();
    mockFetchProductSummary.mockReset();
  
    // Clean thread files between tests to prevent cross-test contamination
    try {
      await fsPromises.rm(path.join(testTmpDir, 'threads'), { recursive: true, force: true });
    } catch {
      // Ignore if directory does not exist
    }
  });

  // ========================================================================
  // Helper: seed a thread with architecture discovery messages
  // ========================================================================
  async function seedArchitectureThread(
    threadKey: ThreadKey,
    includeAssistantMessage: boolean = false
  ): Promise<void> {
    await createThread(threadKey);

    const userMsg: ThreadMessage = {
      id: uuidv4(),
      role: 'user',
      personaId: null,
      taskId: 'architect--define-architecture',
      content: 'I want to define the architecture for my product.',
      structuredResponse: null,
      timestamp: new Date().toISOString(),
    };
    await appendMessage(threadKey, userMsg);

    if (includeAssistantMessage) {
      const assistantContent = {
        phase: 'ready',
        section: 'architecture_review',
        summary: 'Based on our discussion, I have enough information to generate the architecture baseline.',
        questions: [],
      };

      const assistantMsg: ThreadMessage = {
        id: uuidv4(),
        role: 'assistant',
        personaId: 'architect',
        taskId: 'architect--define-architecture',
        content: JSON.stringify(assistantContent),
        structuredResponse: assistantContent,
        timestamp: new Date().toISOString(),
      };
      await appendMessage(threadKey, assistantMsg);
    }
  }

  // ========================================================================
  // Helper: create MISSION.MD and/or TECH-STACK.MD in tmp dir
  // ========================================================================
  async function createContextFiles(
    options: { mission?: boolean; techStack?: boolean } = {}
  ): Promise<void> {
    const productDir = path.join(testTmpDir, 'agent-os', 'product');
    await fsPromises.mkdir(productDir, { recursive: true });

    if (options.mission) {
      await fsPromises.writeFile(
        path.join(productDir, 'MISSION.MD'),
        '# Product Mission\nBuild an amazing product.',
        'utf-8'
      );
    }

    if (options.techStack) {
      await fsPromises.writeFile(
        path.join(productDir, 'TECH-STACK.MD'),
        '# Tech Stack\nNode.js, React, PostgreSQL.',
        'utf-8'
      );
    }
  }

  // ========================================================================
  // Test 1: POST / with architecture task injects MISSION and TECH STACK context
  // ========================================================================
  it('should inject resolvedContext MISSION and TECH STACK when both files exist for architecture task', async () => {
    await createContextFiles({ mission: true, techStack: true });

    // Mock sendChatRequest to return a valid SA response
    const saResponse = {
      phase: 'questions',
      section: 'discovery',
      summary: 'Let me understand your architecture needs.',
      questions: ['What are the main services?'],
    };
    mockSendChatRequest.mockResolvedValueOnce({
      id: 'resp-1',
      content: JSON.stringify(saResponse),
      isFinal: true,
    });

    const threadKey: ThreadKey = {
      type: 'hub',
      projectId: 'arch-context-both-' + uuidv4().slice(0, 8),
    };

    const res = await request(app)
      .post('/api/chat/v2/')
      .send({
        threadKey,
        personaId: 'architect',
        taskId: 'architect--define-architecture',
        message: 'Help me define architecture.',
      });

    expect(res.status).toBe(200);

    // Verify sendChatRequest was called (the LLM was invoked, not short-circuited)
    expect(mockSendChatRequest).toHaveBeenCalledTimes(1);

    // The system prompt should contain the injected mission and tech stack context
    const callArgs = mockSendChatRequest.mock.calls[0];
    const messages = callArgs[0];
    const systemMsg = messages.find((m: { role: string }) => m.role === 'system');
    expect(systemMsg).toBeDefined();
    expect(systemMsg.content).toContain('Product Mission');
    expect(systemMsg.content).toContain('Tech Stack');
  });

  // ========================================================================
  // Test 2: POST / with architecture task when TECH-STACK.MD is missing proceeds without error
  // ========================================================================
  it('should proceed without error when TECH-STACK.MD is missing for architecture task', async () => {
    // Clean up tech stack file if it exists, only create mission
    const productDir = path.join(testTmpDir, 'agent-os', 'product');
    await fsPromises.mkdir(productDir, { recursive: true });
    try {
      await fsPromises.unlink(path.join(productDir, 'TECH-STACK.MD'));
    } catch { /* ignore */ }
    try {
      await fsPromises.unlink(path.join(productDir, 'tech-stack.md'));
    } catch { /* ignore */ }
    await fsPromises.writeFile(
      path.join(productDir, 'MISSION.MD'),
      '# Product Mission\nBuild a product without tech stack.',
      'utf-8'
    );

    const saResponse = {
      phase: 'questions',
      section: 'discovery',
      summary: 'Let me understand your needs.',
      questions: ['What services do you need?'],
    };
    mockSendChatRequest.mockResolvedValueOnce({
      id: 'resp-2',
      content: JSON.stringify(saResponse),
      isFinal: true,
    });

    const threadKey: ThreadKey = {
      type: 'hub',
      projectId: 'arch-no-techstack-' + uuidv4().slice(0, 8),
    };

    const res = await request(app)
      .post('/api/chat/v2/')
      .send({
        threadKey,
        personaId: 'architect',
        taskId: 'architect--define-architecture',
        message: 'Define architecture without tech stack.',
      });

    // Should NOT return an error -- TECH-STACK.MD is optional
    expect(res.status).toBe(200);
    expect(res.body.error).toBeUndefined();
    expect(mockSendChatRequest).toHaveBeenCalledTimes(1);

    // System prompt should contain mission but work fine without tech stack
    const callArgs = mockSendChatRequest.mock.calls[0];
    const messages = callArgs[0];
    const systemMsg = messages.find((m: { role: string }) => m.role === 'system');
    expect(systemMsg).toBeDefined();
    expect(systemMsg.content).toContain('Product Mission');
  });

  // ========================================================================
  // Test 3: POST / with architecture task does NOT produce first-turn short-circuit
  // ========================================================================
  it('should NOT produce a deterministic first-turn short-circuit for architecture task', async () => {
    await createContextFiles({ mission: true });

    const saResponse = {
      phase: 'questions',
      section: 'service_identification',
      summary: 'Let me help you identify your services.',
      questions: ['What are the primary services in your system?'],
    };
    mockSendChatRequest.mockResolvedValueOnce({
      id: 'resp-3',
      content: JSON.stringify(saResponse),
      isFinal: true,
    });

    const threadKey: ThreadKey = {
      type: 'hub',
      projectId: 'arch-no-shortcircuit-' + uuidv4().slice(0, 8),
    };

    const res = await request(app)
      .post('/api/chat/v2/')
      .send({
        threadKey,
        personaId: 'architect',
        taskId: 'architect--define-architecture',
        message: 'I want to define architecture.',
      });

    expect(res.status).toBe(200);

    // The LLM MUST have been called (no first-turn short-circuit unlike roadmap)
    expect(mockSendChatRequest).toHaveBeenCalledTimes(1);

    // Verify the response comes from the LLM, not a canned response
    expect(res.body.structuredResponse).toBeDefined();
    expect(res.body.structuredResponse.section).toBe('service_identification');
  });

  // ========================================================================
  // Test 4: POST /generate with architecture-baseline calls sendChatRequest
  // with correct options and returns validated JSON
  // ========================================================================
  it('should call sendChatRequest with jsonMode, temperature 0.2, maxTokens 64000 for architecture-baseline generate', async () => {
    const threadKey: ThreadKey = {
      type: 'hub',
      projectId: 'gen-arch-success-' + uuidv4().slice(0, 8),
    };
    await seedArchitectureThread(threadKey, true);
    await createContextFiles({ mission: true, techStack: true });

    // Mock sendChatRequest to return valid architecture baseline JSON
    mockSendChatRequest.mockResolvedValueOnce({
      id: 'gen-resp-1',
      content: JSON.stringify(VALID_BASELINE_JSON),
      isFinal: true,
    });

    const res = await request(app)
      .post('/api/chat/v2/generate')
      .send({
        threadKey,
        personaId: 'architect',
        taskId: 'architect--define-architecture',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.artifactContent).toBeDefined();
    expect(typeof res.body.artifactContent).toBe('string');

    // Verify the artifactContent is valid JSON with the baseline shape
    const parsed = JSON.parse(res.body.artifactContent);
    expect(Array.isArray(parsed.services)).toBe(true);
    expect(parsed.services.length).toBe(3);

    // Verify sendChatRequest was called with correct options
    expect(mockSendChatRequest).toHaveBeenCalledTimes(1);
    const callArgs = mockSendChatRequest.mock.calls[0];
    const options = callArgs[3];
    expect(options.jsonMode).toBe(true);
    expect(options.temperature).toBe(0.2);
    expect(options.maxTokens).toBe(64000);
  });

  // ========================================================================
  // Test 5: POST /generate with architecture-baseline performs corrective retry
  // on first validation failure
  // ========================================================================
  it('should perform corrective retry with BASELINE_JSON_CORRECTIVE_INSTRUCTION on first validation failure', async () => {
    const threadKey: ThreadKey = {
      type: 'hub',
      projectId: 'gen-arch-retry-' + uuidv4().slice(0, 8),
    };
    await seedArchitectureThread(threadKey, true);
    await createContextFiles({ mission: true });

    // First call returns invalid JSON (services is not an array)
    mockSendChatRequest
      .mockResolvedValueOnce({
        id: 'gen-resp-invalid',
        content: JSON.stringify({ services: 'not-an-array' }),
        isFinal: true,
      })
      // Second call (retry) returns valid JSON
      .mockResolvedValueOnce({
        id: 'gen-resp-valid',
        content: JSON.stringify(VALID_BASELINE_JSON),
        isFinal: true,
      });

    const res = await request(app)
      .post('/api/chat/v2/generate')
      .send({
        threadKey,
        personaId: 'architect',
        taskId: 'architect--define-architecture',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.artifactContent).toBeDefined();

    // Verify sendChatRequest was called twice (initial + retry)
    expect(mockSendChatRequest).toHaveBeenCalledTimes(2);

    // Verify the retry call includes the corrective instruction
    const retryCallArgs = mockSendChatRequest.mock.calls[1];
    const retryMessages = retryCallArgs[0];
    // The corrective instruction should be the last user message
    const lastUserMsg = retryMessages.filter((m: { role: string }) => m.role === 'user').pop();
    expect(lastUserMsg.content).toContain('not valid JSON');
    expect(lastUserMsg.content).toContain('ArchitectureBaselineInput');
  });

  // ========================================================================
  // Test 6: POST /generate with architecture-baseline returns failure after
  // second validation failure
  // ========================================================================
  it('should return { success: false, error } when architecture-baseline generation fails after validation retry', async () => {
    const threadKey: ThreadKey = {
      type: 'hub',
      projectId: 'gen-arch-double-fail-' + uuidv4().slice(0, 8),
    };
    await seedArchitectureThread(threadKey, true);
    await createContextFiles({ mission: true });

    // Both calls return invalid JSON
    mockSendChatRequest
      .mockResolvedValueOnce({
        id: 'gen-resp-bad-1',
        content: JSON.stringify({ services: 'bad' }),
        isFinal: true,
      })
      .mockResolvedValueOnce({
        id: 'gen-resp-bad-2',
        content: JSON.stringify({ services: 'still-bad' }),
        isFinal: true,
      });

    const res = await request(app)
      .post('/api/chat/v2/generate')
      .send({
        threadKey,
        personaId: 'architect',
        taskId: 'architect--define-architecture',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Architecture baseline generation failed after validation retry');

    // Both attempts should have been made
    expect(mockSendChatRequest).toHaveBeenCalledTimes(2);
  });

  // ========================================================================
  // Test 7: POST /save-artifact with architecture adapter calls executeToolCall
  // and inserts completion chip
  // ========================================================================
  it('should call executeToolCall with save_architecture_baseline and insert completion chip with architecture-baseline metadata', async () => {
    const threadKey: ThreadKey = {
      type: 'hub',
      projectId: 'save-arch-' + uuidv4().slice(0, 8),
    };
    await seedArchitectureThread(threadKey, true);

    mockExecuteToolCall.mockResolvedValueOnce({
      callId: 'call-save-arch',
      output: { saved: true },
      status: 200,
      durationMs: 150,
    });

    const archContent = JSON.stringify(VALID_BASELINE_JSON);

    const res = await request(app)
      .post('/api/chat/v2/save-artifact')
      .send({
        threadKey,
        taskId: 'architect--define-architecture',
        artifactId: 'architecture-baseline',
        content: archContent,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify executeToolCall was called with correct tool name and args
    expect(mockExecuteToolCall).toHaveBeenCalledTimes(1);
    const callArgs = mockExecuteToolCall.mock.calls[0];
    expect(callArgs[1]).toBe('save_architecture_baseline');
    const toolArgs = callArgs[2];
    expect(toolArgs.projectId).toBe(threadKey.projectId);
    expect(toolArgs.architectureBaselineJson).toBe(archContent);
    // Architecture adapter should NOT have projectParentFolder, productName, or missionMarkdown
    expect(toolArgs.projectParentFolder).toBeUndefined();
    expect(toolArgs.productName).toBeUndefined();
    expect(toolArgs.missionMarkdown).toBeUndefined();

    // Verify completion chip was persisted
    const thread = await getThread(threadKey);
    expect(thread).not.toBeNull();

    const completionChips = thread!.messages.filter(
      (m: ThreadMessage) =>
        m.structuredResponse &&
        typeof m.structuredResponse === 'object' &&
        (m.structuredResponse as Record<string, unknown>).type === 'completion-chip'
    );
    expect(completionChips.length).toBe(1);

    const chip = completionChips[0];
    expect(chip.content).toBe('Architecture Baseline complete.');
    const sr = chip.structuredResponse as Record<string, unknown>;
    expect(sr.artifactId).toBe('architecture-baseline');
    expect(sr.artifactName).toBe('ARCHITECTURE_BASELINE');
    expect(sr.taskId).toBe('architect--define-architecture');
  });

  // ========================================================================
  // Test 8: POST /save-artifact with architecture adapter runs defense-in-depth
  // validation before calling executeToolCall
  // ========================================================================
  it('should run defense-in-depth validation (validateBaselineJsonShape + ensureMinimumServices) before calling executeToolCall', async () => {
    const threadKey: ThreadKey = {
      type: 'hub',
      projectId: 'save-arch-validation-' + uuidv4().slice(0, 8),
    };
    await seedArchitectureThread(threadKey, true);

    // Content with services as a non-array should fail defense-in-depth validation
    const invalidContent = JSON.stringify({ services: 'not-an-array', interfaces: [] });

    const res = await request(app)
      .post('/api/chat/v2/save-artifact')
      .send({
        threadKey,
        taskId: 'architect--define-architecture',
        artifactId: 'architecture-baseline',
        content: invalidContent,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('Architecture baseline validation failed');

    // executeToolCall should NOT have been called (defense-in-depth blocked it)
    expect(mockExecuteToolCall).not.toHaveBeenCalled();
  });
});
