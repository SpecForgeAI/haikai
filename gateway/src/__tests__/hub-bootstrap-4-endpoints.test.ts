/**
 * Tests for Hub Bootstrap 4 -- SA Tech Stack + TE Test Strategy End-to-End
 * Backend Endpoint Extensions
 *
 * Spec 2026-03-01: Hub Bootstrap 4 -- SA Tech Stack + TE Test Strategy End-to-End
 * Task Group 3: Backend Endpoint Extensions (POST /, /generate, /save-artifact)
 *
 * 14 focused tests:
 * Context injection tests (4):
 *  1. POST / with architect--define-tech-stack injects MISSION, ARCHITECTURE BASELINE context
 *  2. POST / with architect--define-tech-stack when TECH-STACK.MD exists, injects TECH STACK + update hint
 *  3. POST / with test-engineer--test-strategy injects MISSION, ROADMAP, TECH STACK context
 *  4. POST / with test-engineer--test-strategy when TEST-STRATEGY.MD exists, injects update hint
 * Generation tests (6):
 *  5. POST /generate with tech-stack returns validated JSON with correct options
 *  6. POST /generate with tech-stack performs corrective retry on first failure
 *  7. POST /generate with tech-stack returns failure after second validation failure
 *  8. POST /generate with test-strategy returns validated JSON with correct options
 *  9. POST /generate with test-strategy performs corrective retry on first failure
 * 10. POST /generate with test-strategy returns failure after second validation failure
 * Save-artifact tests (4):
 * 11. POST /save-artifact with tech-stack calls save_markdown_artifact and returns completion
 * 12. POST /save-artifact with test-strategy calls save_markdown_artifact and returns completion
 * 13. POST /save-artifact tech-stack JSON-to-markdown conversion produces readable markdown
 * 14. POST /save-artifact test-strategy JSON-to-markdown conversion produces readable markdown
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

// ---- Mock fetchProductName, fetchProductSummary, fetchMetaModelSummary ----
const mockFetchProductName = jest.fn();
const mockFetchProductSummary = jest.fn();
const mockFetchMetaModelSummary = jest.fn();
jest.mock('../services/architectureModelClient', () => {
  const { buildArchitectureModelClientMock } = jest.requireActual(
    '../testSetup/architectureModelClientMock'
  );
  return buildArchitectureModelClientMock({
    fetchProjectFolder: jest.fn(async () => testTmpDir),
    fetchProductName: (...args: unknown[]) => mockFetchProductName(...args),
    fetchProductSummary: (...args: unknown[]) => mockFetchProductSummary(...args),
    fetchMetaModelSummary: (...args: unknown[]) => mockFetchMetaModelSummary(...args),
  });
});

// ---- Imports (after mocks) ----
import express from 'express';
import request from 'supertest';
import { initializeRegistries } from '../services/registryLoader';
import { chatV2Router } from '../routes/chatV2';
import { createThread, appendMessage, getThread } from '../services/threadStore';
import { ThreadKey, ThreadMessage } from '../types/chatV2';
import { v4 as uuidv4 } from 'uuid';
import { DEFAULT_TEST_ARCHITECTURE_ID } from '../testSetup/architectureModelClientMock';

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

// Valid tech stack JSON for testing
const VALID_TECH_STACK_JSON = {
  categories: [
    {
      name: 'Frontend',
      technologies: [
        { name: 'React', version: '18.2', purpose: 'UI library', rationale: 'Large ecosystem' },
        { name: 'TypeScript', version: '5.0', purpose: 'Type safety', rationale: 'Fewer bugs' },
      ],
    },
    {
      name: 'Backend',
      technologies: [
        { name: 'Node.js', version: '20 LTS', purpose: 'Server runtime', rationale: 'JavaScript everywhere' },
      ],
    },
  ],
  designDecisions: [
    { title: 'Monorepo', description: 'Single repo for all packages', rationale: 'Simpler dependency management' },
  ],
  constraints: [
    { name: 'Budget', description: 'Limited budget for SaaS tools', type: 'financial' },
  ],
};

// Valid test strategy JSON for testing
const VALID_TEST_STRATEGY_JSON = {
  testLevels: [
    {
      name: 'Unit Testing',
      scope: 'Individual functions and methods',
      coverageTarget: '80%',
      tools: ['Jest', 'Vitest'],
      rationale: 'Fast feedback loop',
    },
    {
      name: 'Integration Testing',
      scope: 'Service interactions',
      coverageTarget: '60%',
      tools: ['Supertest'],
      rationale: 'Verify service contracts',
    },
  ],
  qualityGates: [
    {
      name: 'PR Gate',
      criteria: ['All tests pass', 'No lint errors', 'Coverage threshold met'],
      enforcement: 'CI pipeline blocks merge on failure',
    },
  ],
  testingPrinciples: [
    { title: 'Test Pyramid', description: 'More unit tests, fewer E2E tests' },
  ],
};

describe('Hub Bootstrap 4 Endpoint Extensions (Spec 2026-03-01, Task Group 3)', () => {
  let app: express.Application;

  beforeAll(async () => {
    testTmpDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'hub-bootstrap-4-test-'));
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
    mockFetchMetaModelSummary.mockReset();
  
    // Clean thread files between tests to prevent cross-test contamination
    try {
      await fsPromises.rm(path.join(testTmpDir, 'threads'), { recursive: true, force: true });
    } catch {
      // Ignore if directory does not exist
    }
  });

  // ========================================================================
  // Helper: seed a thread with discovery messages for a given task
  // ========================================================================
  async function seedThread(
    threadKey: ThreadKey,
    taskId: string,
    personaId: string,
    includeAssistantMessage: boolean = false
  ): Promise<void> {
    await createThread(threadKey);

    const userMsg: ThreadMessage = {
      id: uuidv4(),
      role: 'user',
      personaId: null,
      taskId,
      content: 'Help me define this artifact.',
      structuredResponse: null,
      timestamp: new Date().toISOString(),
    };
    await appendMessage(threadKey, userMsg);

    if (includeAssistantMessage) {
      const assistantContent = {
        phase: 'ready',
        section: 'final_review',
        summary: 'I have enough information to generate the artifact.',
        questions: [],
      };

      const assistantMsg: ThreadMessage = {
        id: uuidv4(),
        role: 'assistant',
        personaId,
        taskId,
        content: JSON.stringify(assistantContent),
        structuredResponse: assistantContent,
        timestamp: new Date().toISOString(),
      };
      await appendMessage(threadKey, assistantMsg);
    }
  }

  // ========================================================================
  // Helper: create context files in tmp dir
  // ========================================================================
  async function createContextFiles(
    options: { mission?: boolean; techStack?: boolean; testStrategy?: boolean } = {}
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

    if (options.testStrategy) {
      await fsPromises.writeFile(
        path.join(productDir, 'TEST-STRATEGY.MD'),
        '# Test Strategy\nUnit, integration, and E2E testing.',
        'utf-8'
      );
    }
  }

  // ========================================================================
  // Helper: clean up specific files
  // ========================================================================
  async function cleanContextFiles(filenames: string[]): Promise<void> {
    const productDir = path.join(testTmpDir, 'agent-os', 'product');
    for (const filename of filenames) {
      try {
        await fsPromises.unlink(path.join(productDir, filename));
      } catch { /* ignore */ }
    }
  }

  // ========================================================================
  // Test 1: POST / with architect--define-tech-stack injects MISSION and ARCHITECTURE BASELINE
  // ========================================================================
  it('should inject resolvedContext MISSION and ARCHITECTURE BASELINE for architect--define-tech-stack', async () => {
    await createContextFiles({ mission: true });

    // Mock fetchMetaModelSummary to return architecture baseline data
    const mockBaseline = {
      services: [{ name: 'API Gateway', entity_type: 'services' }],
      data_entities: [],
      interfaces: [],
      relationships: [],
    };
    mockFetchMetaModelSummary.mockResolvedValueOnce(mockBaseline);

    const saResponse = {
      phase: 'questions',
      section: 'current_landscape',
      summary: 'Let me understand your current technology landscape.',
      questions: ['What technologies are you currently using?'],
    };
    mockSendChatRequest.mockResolvedValueOnce({
      id: 'resp-1',
      content: JSON.stringify(saResponse),
      isFinal: true,
    });

    const threadKey: ThreadKey = {
      type: 'hub',
      projectId: 'ts-context-1-' + uuidv4().slice(0, 8),
    };

    const res = await request(app)
      .post('/api/chat/v2/')
      .send({
        threadKey,
        personaId: 'architect',
        taskId: 'architect--define-tech-stack',
        message: 'Help me define the tech stack.',
      });

    expect(res.status).toBe(200);
    expect(mockSendChatRequest).toHaveBeenCalledTimes(1);

    // The system prompt should contain injected mission content
    const callArgs = mockSendChatRequest.mock.calls[0];
    const messages = callArgs[0];
    const systemMsg = messages.find((m: { role: string }) => m.role === 'system');
    expect(systemMsg).toBeDefined();
    expect(systemMsg.content).toContain('Product Mission');

    // fetchMetaModelSummary should have been called with the project id and
    // the resolved Default architecture id (Spec 2026-05-01 two-arg form)
    expect(mockFetchMetaModelSummary).toHaveBeenCalledTimes(1);
    expect(mockFetchMetaModelSummary).toHaveBeenCalledWith(
      threadKey.projectId,
      DEFAULT_TEST_ARCHITECTURE_ID
    );
  });

  // ========================================================================
  // Test 2: POST / with architect--define-tech-stack when TECH-STACK.MD exists
  // injects TECH STACK + update hint
  // ========================================================================
  it('should inject TECH STACK context and update hint when TECH-STACK.MD exists for tech-stack task', async () => {
    await createContextFiles({ mission: true, techStack: true });

    mockFetchMetaModelSummary.mockResolvedValueOnce(null);

    const saResponse = {
      phase: 'questions',
      section: 'current_landscape',
      summary: 'I see you have an existing tech stack.',
      questions: ['Would you like to update it?'],
    };
    mockSendChatRequest.mockResolvedValueOnce({
      id: 'resp-2',
      content: JSON.stringify(saResponse),
      isFinal: true,
    });

    const threadKey: ThreadKey = {
      type: 'hub',
      projectId: 'ts-context-2-' + uuidv4().slice(0, 8),
    };

    const res = await request(app)
      .post('/api/chat/v2/')
      .send({
        threadKey,
        personaId: 'architect',
        taskId: 'architect--define-tech-stack',
        message: 'Let me update the tech stack.',
      });

    expect(res.status).toBe(200);
    expect(mockSendChatRequest).toHaveBeenCalledTimes(1);

    const callArgs = mockSendChatRequest.mock.calls[0];
    const messages = callArgs[0];
    const systemMsg = messages.find((m: { role: string }) => m.role === 'system');
    expect(systemMsg).toBeDefined();
    // Should contain the tech stack context
    expect(systemMsg.content).toContain('Tech Stack');
    // Should contain the update hint
    expect(systemMsg.content).toContain('existing Tech Stack');
  });

  // ========================================================================
  // Test 3: POST / with test-engineer--test-strategy injects MISSION, ROADMAP, TECH STACK
  // ========================================================================
  it('should inject MISSION, ROADMAP, and TECH STACK context for test-engineer--test-strategy', async () => {
    await createContextFiles({ mission: true, techStack: true });
    await cleanContextFiles(['TEST-STRATEGY.MD', 'test-strategy.md']);

    // Mock fetchProductSummary to return roadmap data
    const mockProductSummary = {
      initiatives: [
        {
          title: 'Phase 1',
          description: 'Initial launch',
          epics: [{ title: 'MVP', description: 'Minimum viable product', features: [] }],
        },
      ],
    };
    mockFetchProductSummary.mockResolvedValueOnce(mockProductSummary);

    const teResponse = {
      phase: 'questions',
      section: 'project_context',
      summary: 'Let me understand the project context for your test strategy.',
      questions: ['What is the scope of testing?'],
    };
    mockSendChatRequest.mockResolvedValueOnce({
      id: 'resp-3',
      content: JSON.stringify(teResponse),
      isFinal: true,
    });

    const threadKey: ThreadKey = {
      type: 'hub',
      projectId: 'te-context-3-' + uuidv4().slice(0, 8),
    };

    const res = await request(app)
      .post('/api/chat/v2/')
      .send({
        threadKey,
        personaId: 'test-engineer',
        taskId: 'test-engineer--test-strategy',
        message: 'Help me define the test strategy.',
      });

    expect(res.status).toBe(200);
    expect(mockSendChatRequest).toHaveBeenCalledTimes(1);

    const callArgs = mockSendChatRequest.mock.calls[0];
    const messages = callArgs[0];
    const systemMsg = messages.find((m: { role: string }) => m.role === 'system');
    expect(systemMsg).toBeDefined();
    // Should contain mission content
    expect(systemMsg.content).toContain('Product Mission');
    // Should contain tech stack content
    expect(systemMsg.content).toContain('Tech Stack');
    // fetchProductSummary should have been called
    expect(mockFetchProductSummary).toHaveBeenCalledTimes(1);
  });

  // ========================================================================
  // Test 4: POST / with test-engineer--test-strategy when TEST-STRATEGY.MD exists
  // injects update hint
  // ========================================================================
  it('should inject update hint when TEST-STRATEGY.MD exists for test-strategy task', async () => {
    await createContextFiles({ mission: true, testStrategy: true });

    mockFetchProductSummary.mockResolvedValueOnce(null);

    const teResponse = {
      phase: 'questions',
      section: 'project_context',
      summary: 'I see you have an existing test strategy.',
      questions: ['Would you like to update it?'],
    };
    mockSendChatRequest.mockResolvedValueOnce({
      id: 'resp-4',
      content: JSON.stringify(teResponse),
      isFinal: true,
    });

    const threadKey: ThreadKey = {
      type: 'hub',
      projectId: 'te-context-4-' + uuidv4().slice(0, 8),
    };

    const res = await request(app)
      .post('/api/chat/v2/')
      .send({
        threadKey,
        personaId: 'test-engineer',
        taskId: 'test-engineer--test-strategy',
        message: 'Let me update the test strategy.',
      });

    expect(res.status).toBe(200);
    expect(mockSendChatRequest).toHaveBeenCalledTimes(1);

    const callArgs = mockSendChatRequest.mock.calls[0];
    const messages = callArgs[0];
    const systemMsg = messages.find((m: { role: string }) => m.role === 'system');
    expect(systemMsg).toBeDefined();
    // Should contain the update hint
    expect(systemMsg.content).toContain('existing Test Strategy');
  });

  // ========================================================================
  // Test 5: POST /generate with tech-stack returns validated JSON with correct options
  // ========================================================================
  it('should call sendChatRequest with jsonMode, temperature 0.2, maxTokens 16000 for tech-stack generate', async () => {
    const threadKey: ThreadKey = {
      type: 'hub',
      projectId: 'gen-ts-success-' + uuidv4().slice(0, 8),
    };
    await seedThread(threadKey, 'architect--define-tech-stack', 'architect', true);
    await createContextFiles({ mission: true });

    mockSendChatRequest.mockResolvedValueOnce({
      id: 'gen-resp-ts-1',
      content: JSON.stringify(VALID_TECH_STACK_JSON),
      isFinal: true,
    });

    const res = await request(app)
      .post('/api/chat/v2/generate')
      .send({
        threadKey,
        personaId: 'architect',
        taskId: 'architect--define-tech-stack',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.artifactContent).toBeDefined();
    expect(typeof res.body.artifactContent).toBe('string');

    // Verify the artifactContent is valid JSON with the tech stack shape
    const parsed = JSON.parse(res.body.artifactContent);
    expect(Array.isArray(parsed.categories)).toBe(true);
    expect(parsed.categories.length).toBe(2);
    expect(Array.isArray(parsed.designDecisions)).toBe(true);
    expect(Array.isArray(parsed.constraints)).toBe(true);

    // Verify sendChatRequest was called with correct options
    expect(mockSendChatRequest).toHaveBeenCalledTimes(1);
    const callArgs = mockSendChatRequest.mock.calls[0];
    const options = callArgs[3];
    expect(options.jsonMode).toBe(true);
    expect(options.temperature).toBe(0.2);
    expect(options.maxTokens).toBe(16000);
  });

  // ========================================================================
  // Test 6: POST /generate with tech-stack performs corrective retry on first failure
  // ========================================================================
  it('should perform corrective retry on first tech-stack validation failure', async () => {
    const threadKey: ThreadKey = {
      type: 'hub',
      projectId: 'gen-ts-retry-' + uuidv4().slice(0, 8),
    };
    await seedThread(threadKey, 'architect--define-tech-stack', 'architect', true);
    await createContextFiles({ mission: true });

    // First call returns invalid JSON (categories is not an array)
    mockSendChatRequest
      .mockResolvedValueOnce({
        id: 'gen-resp-ts-invalid',
        content: JSON.stringify({ categories: 'not-an-array' }),
        isFinal: true,
      })
      // Second call (retry) returns valid JSON
      .mockResolvedValueOnce({
        id: 'gen-resp-ts-valid',
        content: JSON.stringify(VALID_TECH_STACK_JSON),
        isFinal: true,
      });

    const res = await request(app)
      .post('/api/chat/v2/generate')
      .send({
        threadKey,
        personaId: 'architect',
        taskId: 'architect--define-tech-stack',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.artifactContent).toBeDefined();

    // Verify sendChatRequest was called twice (initial + retry)
    expect(mockSendChatRequest).toHaveBeenCalledTimes(2);
  });

  // ========================================================================
  // Test 7: POST /generate with tech-stack returns failure after second validation failure
  // ========================================================================
  it('should return { success: false, error } when tech-stack generation fails after validation retry', async () => {
    const threadKey: ThreadKey = {
      type: 'hub',
      projectId: 'gen-ts-double-fail-' + uuidv4().slice(0, 8),
    };
    await seedThread(threadKey, 'architect--define-tech-stack', 'architect', true);
    await createContextFiles({ mission: true });

    // Both calls return invalid JSON
    mockSendChatRequest
      .mockResolvedValueOnce({
        id: 'gen-resp-ts-bad-1',
        content: JSON.stringify({ categories: 'bad' }),
        isFinal: true,
      })
      .mockResolvedValueOnce({
        id: 'gen-resp-ts-bad-2',
        content: JSON.stringify({ categories: 'still-bad' }),
        isFinal: true,
      });

    const res = await request(app)
      .post('/api/chat/v2/generate')
      .send({
        threadKey,
        personaId: 'architect',
        taskId: 'architect--define-tech-stack',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBeDefined();
    expect(typeof res.body.error).toBe('string');

    // Both attempts should have been made
    expect(mockSendChatRequest).toHaveBeenCalledTimes(2);
  });

  // ========================================================================
  // Test 8: POST /generate with test-strategy returns validated JSON with correct options
  // ========================================================================
  it('should call sendChatRequest with jsonMode, temperature 0.2, maxTokens 16000 for test-strategy generate', async () => {
    const threadKey: ThreadKey = {
      type: 'hub',
      projectId: 'gen-te-success-' + uuidv4().slice(0, 8),
    };
    await seedThread(threadKey, 'test-engineer--test-strategy', 'test-engineer', true);
    await createContextFiles({ mission: true, techStack: true });

    mockSendChatRequest.mockResolvedValueOnce({
      id: 'gen-resp-te-1',
      content: JSON.stringify(VALID_TEST_STRATEGY_JSON),
      isFinal: true,
    });

    const res = await request(app)
      .post('/api/chat/v2/generate')
      .send({
        threadKey,
        personaId: 'test-engineer',
        taskId: 'test-engineer--test-strategy',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.artifactContent).toBeDefined();
    expect(typeof res.body.artifactContent).toBe('string');

    // Verify the artifactContent is valid JSON with the test strategy shape
    const parsed = JSON.parse(res.body.artifactContent);
    expect(Array.isArray(parsed.testLevels)).toBe(true);
    expect(parsed.testLevels.length).toBe(2);
    expect(Array.isArray(parsed.qualityGates)).toBe(true);
    expect(Array.isArray(parsed.testingPrinciples)).toBe(true);

    // Verify sendChatRequest was called with correct options
    expect(mockSendChatRequest).toHaveBeenCalledTimes(1);
    const callArgs = mockSendChatRequest.mock.calls[0];
    const options = callArgs[3];
    expect(options.jsonMode).toBe(true);
    expect(options.temperature).toBe(0.2);
    expect(options.maxTokens).toBe(16000);
  });

  // ========================================================================
  // Test 9: POST /generate with test-strategy performs corrective retry on first failure
  // ========================================================================
  it('should perform corrective retry on first test-strategy validation failure', async () => {
    const threadKey: ThreadKey = {
      type: 'hub',
      projectId: 'gen-te-retry-' + uuidv4().slice(0, 8),
    };
    await seedThread(threadKey, 'test-engineer--test-strategy', 'test-engineer', true);
    await createContextFiles({ mission: true });

    // First call returns invalid JSON (testLevels missing)
    mockSendChatRequest
      .mockResolvedValueOnce({
        id: 'gen-resp-te-invalid',
        content: JSON.stringify({ testLevels: 'not-an-array' }),
        isFinal: true,
      })
      // Second call (retry) returns valid JSON
      .mockResolvedValueOnce({
        id: 'gen-resp-te-valid',
        content: JSON.stringify(VALID_TEST_STRATEGY_JSON),
        isFinal: true,
      });

    const res = await request(app)
      .post('/api/chat/v2/generate')
      .send({
        threadKey,
        personaId: 'test-engineer',
        taskId: 'test-engineer--test-strategy',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.artifactContent).toBeDefined();

    // Verify sendChatRequest was called twice (initial + retry)
    expect(mockSendChatRequest).toHaveBeenCalledTimes(2);
  });

  // ========================================================================
  // Test 10: POST /generate with test-strategy returns failure after second validation failure
  // ========================================================================
  it('should return { success: false, error } when test-strategy generation fails after validation retry', async () => {
    const threadKey: ThreadKey = {
      type: 'hub',
      projectId: 'gen-te-double-fail-' + uuidv4().slice(0, 8),
    };
    await seedThread(threadKey, 'test-engineer--test-strategy', 'test-engineer', true);
    await createContextFiles({ mission: true });

    // Both calls return invalid JSON
    mockSendChatRequest
      .mockResolvedValueOnce({
        id: 'gen-resp-te-bad-1',
        content: JSON.stringify({ testLevels: 'bad' }),
        isFinal: true,
      })
      .mockResolvedValueOnce({
        id: 'gen-resp-te-bad-2',
        content: JSON.stringify({ testLevels: 'still-bad' }),
        isFinal: true,
      });

    const res = await request(app)
      .post('/api/chat/v2/generate')
      .send({
        threadKey,
        personaId: 'test-engineer',
        taskId: 'test-engineer--test-strategy',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBeDefined();

    // Both attempts should have been made
    expect(mockSendChatRequest).toHaveBeenCalledTimes(2);
  });

  // ========================================================================
  // Test 11: POST /save-artifact with tech-stack calls save_markdown_artifact
  // and returns completion
  // ========================================================================
  it('should call executeToolCall with save_markdown_artifact for tech-stack and insert completion chip', async () => {
    const threadKey: ThreadKey = {
      type: 'hub',
      projectId: 'save-ts-' + uuidv4().slice(0, 8),
    };
    await seedThread(threadKey, 'architect--define-tech-stack', 'architect', true);

    mockExecuteToolCall.mockResolvedValueOnce({
      callId: 'call-save-ts',
      output: { writtenPaths: ['agent-os/product/TECH-STACK.MD'] },
      status: 200,
      durationMs: 150,
    });

    const res = await request(app)
      .post('/api/chat/v2/save-artifact')
      .send({
        threadKey,
        taskId: 'architect--define-tech-stack',
        artifactId: 'tech-stack',
        content: JSON.stringify(VALID_TECH_STACK_JSON),
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify executeToolCall was called with correct tool name and args
    expect(mockExecuteToolCall).toHaveBeenCalledTimes(1);
    const callArgs = mockExecuteToolCall.mock.calls[0];
    expect(callArgs[1]).toBe('save_markdown_artifact');
    const toolArgs = callArgs[2];
    expect(toolArgs.projectId).toBe(threadKey.projectId);
    expect(toolArgs.artifactFilename).toBe('TECH-STACK.MD');
    expect(typeof toolArgs.markdown).toBe('string');
    expect(toolArgs.markdown.length).toBeGreaterThan(0);

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
    expect(chip.content).toBe('Tech Stack complete.');
    const sr = chip.structuredResponse as Record<string, unknown>;
    expect(sr.artifactId).toBe('tech-stack');
    expect(sr.artifactName).toBe('TECH-STACK.MD');
    expect(sr.taskId).toBe('architect--define-tech-stack');
  });

  // ========================================================================
  // Test 12: POST /save-artifact with test-strategy calls save_markdown_artifact
  // and returns completion
  // ========================================================================
  it('should call executeToolCall with save_markdown_artifact for test-strategy and insert completion chip', async () => {
    const threadKey: ThreadKey = {
      type: 'hub',
      projectId: 'save-te-' + uuidv4().slice(0, 8),
    };
    await seedThread(threadKey, 'test-engineer--test-strategy', 'test-engineer', true);

    mockExecuteToolCall.mockResolvedValueOnce({
      callId: 'call-save-te',
      output: { writtenPaths: ['agent-os/product/TEST-STRATEGY.MD'] },
      status: 200,
      durationMs: 150,
    });

    const res = await request(app)
      .post('/api/chat/v2/save-artifact')
      .send({
        threadKey,
        taskId: 'test-engineer--test-strategy',
        artifactId: 'test-strategy',
        content: JSON.stringify(VALID_TEST_STRATEGY_JSON),
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify executeToolCall was called with correct tool name and args
    expect(mockExecuteToolCall).toHaveBeenCalledTimes(1);
    const callArgs = mockExecuteToolCall.mock.calls[0];
    expect(callArgs[1]).toBe('save_markdown_artifact');
    const toolArgs = callArgs[2];
    expect(toolArgs.projectId).toBe(threadKey.projectId);
    expect(toolArgs.artifactFilename).toBe('TEST-STRATEGY.MD');
    expect(typeof toolArgs.markdown).toBe('string');
    expect(toolArgs.markdown.length).toBeGreaterThan(0);

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
    expect(chip.content).toBe('Test Strategy complete.');
    const sr = chip.structuredResponse as Record<string, unknown>;
    expect(sr.artifactId).toBe('test-strategy');
    expect(sr.artifactName).toBe('TEST-STRATEGY.MD');
    expect(sr.taskId).toBe('test-engineer--test-strategy');
  });

  // ========================================================================
  // Test 13: POST /save-artifact tech-stack JSON-to-markdown conversion
  // produces readable markdown
  // ========================================================================
  it('should convert tech-stack JSON to readable markdown with category headers, technology tables, design decisions, and constraints', async () => {
    const threadKey: ThreadKey = {
      type: 'hub',
      projectId: 'save-ts-md-' + uuidv4().slice(0, 8),
    };
    await seedThread(threadKey, 'architect--define-tech-stack', 'architect', true);

    mockExecuteToolCall.mockResolvedValueOnce({
      callId: 'call-save-ts-md',
      output: { writtenPaths: ['agent-os/product/TECH-STACK.MD'] },
      status: 200,
      durationMs: 100,
    });

    await request(app)
      .post('/api/chat/v2/save-artifact')
      .send({
        threadKey,
        taskId: 'architect--define-tech-stack',
        artifactId: 'tech-stack',
        content: JSON.stringify(VALID_TECH_STACK_JSON),
      });

    // Extract the markdown passed to executeToolCall
    expect(mockExecuteToolCall).toHaveBeenCalledTimes(1);
    const markdown = mockExecuteToolCall.mock.calls[0][2].markdown as string;

    // Verify markdown structure
    expect(markdown).toContain('# Tech Stack');
    expect(markdown).toContain('## Frontend');
    expect(markdown).toContain('## Backend');
    expect(markdown).toContain('React');
    expect(markdown).toContain('TypeScript');
    expect(markdown).toContain('Node.js');
    expect(markdown).toContain('## Design Decisions');
    expect(markdown).toContain('Monorepo');
    expect(markdown).toContain('## Constraints');
    expect(markdown).toContain('Budget');
  });

  // ========================================================================
  // Test 14: POST /save-artifact test-strategy JSON-to-markdown conversion
  // produces readable markdown
  // ========================================================================
  it('should convert test-strategy JSON to readable markdown with test levels, quality gates, and testing principles', async () => {
    const threadKey: ThreadKey = {
      type: 'hub',
      projectId: 'save-te-md-' + uuidv4().slice(0, 8),
    };
    await seedThread(threadKey, 'test-engineer--test-strategy', 'test-engineer', true);

    mockExecuteToolCall.mockResolvedValueOnce({
      callId: 'call-save-te-md',
      output: { writtenPaths: ['agent-os/product/TEST-STRATEGY.MD'] },
      status: 200,
      durationMs: 100,
    });

    await request(app)
      .post('/api/chat/v2/save-artifact')
      .send({
        threadKey,
        taskId: 'test-engineer--test-strategy',
        artifactId: 'test-strategy',
        content: JSON.stringify(VALID_TEST_STRATEGY_JSON),
      });

    // Extract the markdown passed to executeToolCall
    expect(mockExecuteToolCall).toHaveBeenCalledTimes(1);
    const markdown = mockExecuteToolCall.mock.calls[0][2].markdown as string;

    // Verify markdown structure
    expect(markdown).toContain('# Test Strategy');
    expect(markdown).toContain('## Test Levels');
    expect(markdown).toContain('Unit Testing');
    expect(markdown).toContain('Integration Testing');
    expect(markdown).toContain('80%');
    expect(markdown).toContain('Jest');
    expect(markdown).toContain('## Quality Gates');
    expect(markdown).toContain('PR Gate');
    expect(markdown).toContain('All tests pass');
    expect(markdown).toContain('## Testing Principles');
    expect(markdown).toContain('Test Pyramid');
  });
});
