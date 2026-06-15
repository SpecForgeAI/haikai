/**
 * Hub Bootstrap 3: Backend Gap Analysis Tests
 *
 * Spec 2026-03-01: Hub Bootstrap 3 -- Solution Architect Baseline Architecture End-to-End
 * Task Group 6: Test Review and Gap Analysis
 *
 * These tests cover critical backend gaps identified during the TG6 review of TG1-TG5:
 *
 *  1. POST / injects MISSION from lowercase mission.md fallback path
 *  2. POST /generate architecture-baseline builds generation messages with populated template
 *  3. POST /generate architecture-baseline uses buildConversationTranscript from thread messages
 *  4. POST /save-artifact architecture adapter rejects non-JSON content string
 *  5. POST /save-artifact architecture adapter: ensureMinimumServices injects default when services empty
 *  6. Regression: POST /generate mission path still produces missionMarkdown via tool call
 *  7. Regression: POST /save-artifact roadmap adapter still calls save_roadmap_structure
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

describe('Hub Bootstrap 3 Gap Analysis (Spec 2026-03-01, Task Group 6)', () => {
  let app: express.Application;

  beforeAll(async () => {
    testTmpDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'hub-bootstrap-3-gaps-'));
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

  // Helper: seed a thread with architecture discovery messages
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

  // Helper: seed a thread with mission (define-product) messages
  async function seedMissionThread(threadKey: ThreadKey): Promise<void> {
    await createThread(threadKey);

    const userMsg: ThreadMessage = {
      id: uuidv4(),
      role: 'user',
      personaId: null,
      taskId: 'product-manager--define-product',
      content: 'I want to define my product.',
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
        section: 'mission_review',
        summary: 'Ready to generate.',
        questions: [],
      }),
      structuredResponse: {
        phase: 'ready',
        section: 'mission_review',
        summary: 'Ready to generate.',
        questions: [],
      },
      timestamp: new Date().toISOString(),
    };
    await appendMessage(threadKey, assistantMsg);
  }

  // Helper: seed a thread with roadmap messages
  async function seedRoadmapThread(threadKey: ThreadKey): Promise<void> {
    await createThread(threadKey);

    const userMsg: ThreadMessage = {
      id: uuidv4(),
      role: 'user',
      personaId: null,
      taskId: 'product-manager--roadmap',
      content: 'I want to build a roadmap.',
      structuredResponse: null,
      timestamp: new Date().toISOString(),
    };
    await appendMessage(threadKey, userMsg);

    const assistantMsg: ThreadMessage = {
      id: uuidv4(),
      role: 'assistant',
      personaId: 'product-manager',
      taskId: 'product-manager--roadmap',
      content: JSON.stringify({
        phase: 'ready',
        section: 'roadmap_review',
        summary: 'Ready to generate roadmap.',
        questions: [],
        proposedInitiatives: [
          { title: 'Initiative 1', epics: [{ title: 'Epic 1' }] },
        ],
      }),
      structuredResponse: null,
      timestamp: new Date().toISOString(),
    };
    await appendMessage(threadKey, assistantMsg);
  }

  // ========================================================================
  // Gap 1: POST / injects MISSION from lowercase mission.md fallback path
  // ========================================================================
  it('should inject resolvedContext MISSION when only lowercase mission.md exists (fallback path)', async () => {
    const productDir = path.join(testTmpDir, 'agent-os', 'product');
    await fsPromises.mkdir(productDir, { recursive: true });

    // Remove uppercase if it exists
    try { await fsPromises.unlink(path.join(productDir, 'MISSION.MD')); } catch { /* ignore */ }

    // Write only lowercase
    await fsPromises.writeFile(
      path.join(productDir, 'mission.md'),
      '# Lowercase Mission\nThis is the fallback mission file.',
      'utf-8'
    );

    const saResponse = {
      phase: 'questions',
      section: 'discovery',
      summary: 'Let me understand your architecture needs.',
      questions: ['What are the main services?'],
    };
    mockSendChatRequest.mockResolvedValueOnce({
      id: 'resp-gap-1',
      content: JSON.stringify(saResponse),
      isFinal: true,
    });

    const threadKey: ThreadKey = {
      type: 'hub',
      projectId: 'gap-lowercase-mission-' + uuidv4().slice(0, 8),
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
    expect(mockSendChatRequest).toHaveBeenCalledTimes(1);

    // The system prompt should contain the lowercase mission content
    const callArgs = mockSendChatRequest.mock.calls[0];
    const messages = callArgs[0];
    const systemMsg = messages.find((m: { role: string }) => m.role === 'system');
    expect(systemMsg).toBeDefined();
    expect(systemMsg.content).toContain('Lowercase Mission');
  });

  // ========================================================================
  // Gap 2: POST /generate architecture-baseline builds generation messages
  // with populated template (placeholders replaced)
  // ========================================================================
  it('should build generation messages with missionContent, techStackContent, and conversationTranscript populated in template', async () => {
    const threadKey: ThreadKey = {
      type: 'hub',
      projectId: 'gap-gen-template-' + uuidv4().slice(0, 8),
    };
    await seedArchitectureThread(threadKey, true);

    const productDir = path.join(testTmpDir, 'agent-os', 'product');
    await fsPromises.mkdir(productDir, { recursive: true });
    await fsPromises.writeFile(
      path.join(productDir, 'MISSION.MD'),
      '# Gap Test Mission\nA test mission for gap analysis.',
      'utf-8'
    );
    await fsPromises.writeFile(
      path.join(productDir, 'TECH-STACK.MD'),
      '# Gap Test Tech Stack\nNode.js, TypeScript, React.',
      'utf-8'
    );

    mockSendChatRequest.mockResolvedValueOnce({
      id: 'gen-gap-2',
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

    // Verify the generation messages have the populated template as system message
    const callArgs = mockSendChatRequest.mock.calls[0];
    const messages = callArgs[0];
    const systemMsg = messages.find((m: { role: string }) => m.role === 'system');
    expect(systemMsg).toBeDefined();

    // Template placeholders should be replaced with actual content
    expect(systemMsg.content).toContain('Gap Test Mission');
    expect(systemMsg.content).toContain('Gap Test Tech Stack');
    // The conversation transcript should be populated (not the raw placeholder)
    expect(systemMsg.content).not.toContain('{missionContent}');
    expect(systemMsg.content).not.toContain('{techStackContent}');
    expect(systemMsg.content).not.toContain('{conversationTranscript}');

    // The user message should be the fixed generation trigger
    const userMsg = messages.find((m: { role: string }) => m.role === 'user');
    expect(userMsg).toBeDefined();
    expect(userMsg.content).toBe('Generate the architecture baseline JSON now.');
  });

  // ========================================================================
  // Gap 3: POST /generate uses buildConversationTranscript from thread messages
  // ========================================================================
  it('should include conversation transcript from thread messages in the generation prompt', async () => {
    const threadKey: ThreadKey = {
      type: 'hub',
      projectId: 'gap-gen-transcript-' + uuidv4().slice(0, 8),
    };
    await seedArchitectureThread(threadKey, true);

    const productDir = path.join(testTmpDir, 'agent-os', 'product');
    await fsPromises.mkdir(productDir, { recursive: true });
    await fsPromises.writeFile(
      path.join(productDir, 'MISSION.MD'),
      '# Mission for transcript test.',
      'utf-8'
    );

    mockSendChatRequest.mockResolvedValueOnce({
      id: 'gen-gap-3',
      content: JSON.stringify(VALID_BASELINE_JSON),
      isFinal: true,
    });

    await request(app)
      .post('/api/chat/v2/generate')
      .send({
        threadKey,
        personaId: 'architect',
        taskId: 'architect--define-architecture',
      });

    expect(mockSendChatRequest).toHaveBeenCalledTimes(1);
    const callArgs = mockSendChatRequest.mock.calls[0];
    const messages = callArgs[0];
    const systemMsg = messages.find((m: { role: string }) => m.role === 'system');

    // The transcript should contain the user message from the seeded thread
    expect(systemMsg.content).toContain('I want to define the architecture for my product');
  });

  // ========================================================================
  // Gap 4: POST /save-artifact architecture adapter rejects non-JSON string
  // ========================================================================
  it('should reject non-JSON content string in architecture save-artifact adapter', async () => {
    const threadKey: ThreadKey = {
      type: 'hub',
      projectId: 'gap-save-nonjson-' + uuidv4().slice(0, 8),
    };
    await seedArchitectureThread(threadKey, true);

    const res = await request(app)
      .post('/api/chat/v2/save-artifact')
      .send({
        threadKey,
        taskId: 'architect--define-architecture',
        artifactId: 'architecture-baseline',
        content: 'This is not JSON at all',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('not valid JSON');

    // executeToolCall should NOT have been called
    expect(mockExecuteToolCall).not.toHaveBeenCalled();
  });

  // ========================================================================
  // Gap 5: POST /save-artifact ensureMinimumServices injects default
  // when services array is empty
  // ========================================================================
  it('should accept architecture content with empty services array (ensureMinimumServices injects default)', async () => {
    const threadKey: ThreadKey = {
      type: 'hub',
      projectId: 'gap-save-empty-svc-' + uuidv4().slice(0, 8),
    };
    await seedArchitectureThread(threadKey, true);

    mockExecuteToolCall.mockResolvedValueOnce({
      callId: 'call-gap-5',
      output: { saved: true },
      status: 200,
      durationMs: 100,
    });

    // Content with empty services array -- should pass validation
    // since validateBaselineJsonShape only checks that arrays are arrays
    const contentWithEmptyServices = JSON.stringify({
      services: [],
      interfaces: [],
      interfaceEndpoints: [],
      logicalDataEntities: [],
      physicalDataEntities: [],
      businessLogic: [],
      dataMovements: [],
    });

    const res = await request(app)
      .post('/api/chat/v2/save-artifact')
      .send({
        threadKey,
        taskId: 'architect--define-architecture',
        artifactId: 'architecture-baseline',
        content: contentWithEmptyServices,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // executeToolCall should have been called (validation passes, ensureMinimumServices runs)
    expect(mockExecuteToolCall).toHaveBeenCalledTimes(1);
  });

  // ========================================================================
  // Gap 6: Regression: POST /generate mission path still produces missionMarkdown
  // ========================================================================
  it('Regression: POST /generate mission path still produces missionMarkdown via tool call', async () => {
    const threadKey: ThreadKey = {
      type: 'hub',
      projectId: 'gap-regression-mission-' + uuidv4().slice(0, 8),
    };
    await seedMissionThread(threadKey);

    // Mock sendChatRequest to return a tool call with missionMarkdown
    mockSendChatRequest.mockResolvedValueOnce({
      id: 'gen-mission-regression',
      content: null,
      isFinal: true,
      toolCalls: [
        {
          id: 'tool-call-1',
          name: 'save_product_artifacts',
          arguments: {
            missionMarkdown: '# Product Mission\n\nOur product...',
          },
        },
      ],
    });

    const res = await request(app)
      .post('/api/chat/v2/generate')
      .send({
        threadKey,
        personaId: 'product-manager',
        taskId: 'product-manager--define-product',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // Mission path returns missionMarkdown (backward compat) AND artifactContent
    expect(res.body.missionMarkdown).toBe('# Product Mission\n\nOur product...');
    expect(res.body.artifactContent).toBe('# Product Mission\n\nOur product...');
  });

  // ========================================================================
  // Gap 7: Regression: POST /save-artifact roadmap adapter uses save_roadmap_structure
  // ========================================================================
  it('Regression: POST /save-artifact roadmap adapter still calls save_roadmap_structure', async () => {
    const threadKey: ThreadKey = {
      type: 'hub',
      projectId: 'gap-regression-roadmap-save-' + uuidv4().slice(0, 8),
    };
    await seedRoadmapThread(threadKey);

    mockExecuteToolCall.mockResolvedValueOnce({
      callId: 'call-roadmap-save',
      output: { saved: true },
      status: 200,
      durationMs: 100,
    });

    const roadmapContent = JSON.stringify({
      initiatives: [
        { title: 'Init 1', epics: [{ title: 'Epic 1' }] },
      ],
    });

    const res = await request(app)
      .post('/api/chat/v2/save-artifact')
      .send({
        threadKey,
        taskId: 'product-manager--roadmap',
        artifactId: 'roadmap',
        content: roadmapContent,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify executeToolCall was called with save_roadmap_structure
    expect(mockExecuteToolCall).toHaveBeenCalledTimes(1);
    const callArgs = mockExecuteToolCall.mock.calls[0];
    expect(callArgs[1]).toBe('save_roadmap_structure');
    expect(callArgs[2].roadmapJson).toBe(roadmapContent);
    expect(callArgs[2].projectId).toBe(threadKey.projectId);
  });
});
