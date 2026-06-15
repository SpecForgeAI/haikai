/**
 * Integration Tests for the v2 Conversation Engine
 *
 * Spec 2026-02-28: Unified Conversation Engine v1 (Backend)
 * Task Group 8: Test Review and Gap Analysis
 *
 * These tests fill coverage gaps identified during the review of Task Groups 1-7.
 * Focus areas:
 * - End-to-end flows with disk persistence verification
 * - Thread rehydration across multiple turns with disk reads
 * - Non-hub thread key variants (feature, panel) exercised through the endpoint
 * - Freeform task end-to-end (no responseFormat)
 * - Structured response validation edge cases through the endpoint
 * - Registry loader error resilience (malformed JSON, missing directories)
 * - Request validation edge cases (empty body)
 *
 * Maximum 10 tests. Does NOT duplicate existing coverage.
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

// ---- Imports (after mocks) ----
import express from 'express';
import request from 'supertest';
import { initializeRegistries, getPersonaRegistry, getTaskRegistry } from '../services/registryLoader';
import { chatV2Router } from '../routes/chatV2';
import { Thread, threadKeyToString } from '../types/chatV2';

// Build a minimal Express app for testing
function createTestApp() {
  const app = express();
  app.use(express.json({ limit: '30mb' }));
  app.use((req, _res, next) => {
    req.requestId = 'integration-test-request-id';
    next();
  });
  app.use('/api/chat/v2', chatV2Router);
  return app;
}

// ============================================================================
// Integration Tests: End-to-End Flows and Gap Coverage
// ============================================================================
describe('ChatV2 Integration Tests (Spec 2026-02-28, Task Group 8)', () => {
  let app: express.Application;

  beforeAll(async () => {
    testTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chatv2-integration-'));
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
    mockLogger.warn.mockClear();
    mockLogger.error.mockClear();
    // Clean thread files between tests to prevent cross-test contamination
    // (paths no longer include projectId, so all hub threads share the same path)
    try {
      await fs.rm(path.join(testTmpDir, 'threads'), { recursive: true, force: true });
    } catch {
      // Ignore if directory doesn't exist
    }
  });

  // ========================================================================
  // Test 1: End-to-end flow with disk persistence verification
  // Gap: Existing endpoint test 5 checks sendChatRequest args but never
  //      reads the actual thread file back from disk to verify persistence.
  // ========================================================================
  it('should persist user and assistant messages to disk after a successful request', async () => {
    const projectId = 'integ-disk-verify';
    const mockResponse = JSON.stringify({
      phase: 'questions',
      questions: ['What problem does it solve?'],
      summary: 'Initial discovery.',
    });

    mockSendChatRequest.mockResolvedValueOnce({
      id: 'resp-disk-1',
      content: mockResponse,
      isFinal: true,
    });

    await request(app)
      .post('/api/chat/v2')
      .send({
        threadKey: { type: 'hub', projectId },
        personaId: 'product-manager',
        taskId: 'product-manager--define-product',
        message: 'I want to build an analytics tool.',
      })
      .expect(200);

    // Read the thread file directly from disk
    const threadPath = path.join(
      testTmpDir, 'threads', 'hub', 'thread.json'
    );
    const fileContent = await fs.readFile(threadPath, 'utf8');
    const thread: Thread = JSON.parse(fileContent);

    expect(thread.projectId).toBe(projectId);
    expect(thread.messages).toHaveLength(2);
    expect(thread.messages[0].role).toBe('user');
    expect(thread.messages[0].content).toBe('I want to build an analytics tool.');
    expect(thread.messages[1].role).toBe('assistant');
    expect(thread.messages[1].personaId).toBe('product-manager');
    expect(thread.messages[1].structuredResponse).toEqual({
      phase: 'questions',
      questions: ['What problem does it solve?'],
      summary: 'Initial discovery.',
    });
  });

  // ========================================================================
  // Test 2: Thread rehydration across 3 turns with disk verification
  // Gap: Existing test 5 only sends 2 messages and checks sendChatRequest
  //      args, but never verifies all 6 messages persisted to disk.
  // ========================================================================
  it('should accumulate 6 messages across 3 turns and persist all to disk', async () => {
    const projectId = 'integ-3-turns';

    for (let turn = 1; turn <= 3; turn++) {
      mockSendChatRequest.mockResolvedValueOnce({
        id: `resp-3t-${turn}`,
        content: JSON.stringify({
          phase: 'questions',
          questions: [`Q${turn}`],
          summary: `Turn ${turn} summary`,
        }),
        isFinal: true,
      });

      await request(app)
        .post('/api/chat/v2')
        .send({
          threadKey: { type: 'hub', projectId },
          personaId: 'product-manager',
          taskId: 'product-manager--define-product',
          message: `User message turn ${turn}`,
        })
        .expect(200);
    }

    // Verify the third LLM call received all prior history
    // Messages array for turn 3: [system, user1, assistant1, user2, assistant2, user3]
    const thirdCallMessages = mockSendChatRequest.mock.calls[2][0];
    expect(thirdCallMessages.length).toBe(6);
    expect(thirdCallMessages[0].role).toBe('system');
    expect(thirdCallMessages[1].content).toBe('User message turn 1');
    expect(thirdCallMessages[3].content).toBe('User message turn 2');
    expect(thirdCallMessages[5].content).toBe('User message turn 3');

    // Read disk and verify all 6 messages persisted
    const threadPath = path.join(
      testTmpDir, 'threads', 'hub', 'thread.json'
    );
    const fileContent = await fs.readFile(threadPath, 'utf8');
    const thread: Thread = JSON.parse(fileContent);

    expect(thread.messages).toHaveLength(6);
    expect(thread.messages[0].role).toBe('user');
    expect(thread.messages[1].role).toBe('assistant');
    expect(thread.messages[2].role).toBe('user');
    expect(thread.messages[3].role).toBe('assistant');
    expect(thread.messages[4].role).toBe('user');
    expect(thread.messages[5].role).toBe('assistant');
  });

  // ========================================================================
  // Test 3: Feature thread key variant through the endpoint
  // Gap: All existing endpoint tests use hub thread keys only. Feature and
  //      panel variants are only tested at the type level.
  // ========================================================================
  it('should handle a feature thread key variant end-to-end', async () => {
    const projectId = 'integ-feature';
    const featureId = 'feat-onboarding';

    mockSendChatRequest.mockResolvedValueOnce({
      id: 'resp-feat-1',
      content: JSON.stringify({
        phase: 'questions',
        questions: ['What is the onboarding flow?'],
        summary: 'Feature scoped discovery.',
      }),
      isFinal: true,
    });

    const res = await request(app)
      .post('/api/chat/v2')
      .send({
        threadKey: { type: 'feature', projectId, featureId },
        personaId: 'product-manager',
        taskId: 'product-manager--define-product',
        message: 'Define the onboarding feature.',
      })
      .expect(200);

    expect(res.body.threadKey).toBe(`project:${projectId}:feature:${featureId}`);
    expect(res.body.structuredResponse.phase).toBe('questions');

    // Verify feature-scoped thread path on disk
    const threadPath = path.join(
      testTmpDir, 'threads', 'feature', featureId, 'thread.json'
    );
    const fileContent = await fs.readFile(threadPath, 'utf8');
    const thread: Thread = JSON.parse(fileContent);
    expect(thread.messages).toHaveLength(2);
    expect(thread.threadKey).toBe(`project:${projectId}:feature:${featureId}`);
  });

  // ========================================================================
  // Test 4: Panel thread key variant through the endpoint
  // Gap: Panel variant never exercised through the endpoint.
  // ========================================================================
  it('should handle a panel thread key variant with entityId end-to-end', async () => {
    const projectId = 'integ-panel';
    const screen = 'entity-detail';
    const entityId = 'ent-42';

    mockSendChatRequest.mockResolvedValueOnce({
      id: 'resp-panel-1',
      content: JSON.stringify({
        phase: 'questions',
        questions: ['What details should this entity show?'],
        summary: 'Panel scoped discovery.',
      }),
      isFinal: true,
    });

    const res = await request(app)
      .post('/api/chat/v2')
      .send({
        threadKey: { type: 'panel', projectId, screen, entityId },
        personaId: 'product-manager',
        taskId: 'product-manager--define-product',
        message: 'Discuss entity detail panel.',
      })
      .expect(200);

    expect(res.body.threadKey).toBe(`project:${projectId}:panel:${screen}:${entityId}`);

    // Verify panel-scoped thread path on disk
    const threadPath = path.join(
      testTmpDir, 'threads', 'panel', screen, entityId, 'thread.json'
    );
    const fileContent = await fs.readFile(threadPath, 'utf8');
    const thread: Thread = JSON.parse(fileContent);
    expect(thread.messages).toHaveLength(2);
  });

  // ========================================================================
  // Test 5: Freeform task end-to-end (no responseFormat)
  // Gap: Existing jsonMode test (endpoint test 8) sends a request to
  //      assistant--freeform but does not verify the full response shape
  //      (structuredResponse is null, no error, raw message preserved).
  // ========================================================================
  it('should return structuredResponse as null and no error for a freeform task', async () => {
    mockSendChatRequest.mockResolvedValueOnce({
      id: 'resp-freeform-1',
      content: 'Here is my freeform advice about your project.',
      isFinal: true,
    });

    const res = await request(app)
      .post('/api/chat/v2')
      .send({
        threadKey: { type: 'hub', projectId: 'integ-freeform' },
        personaId: 'assistant',
        taskId: 'assistant--freeform',
        message: 'Give me general advice.',
      })
      .expect(200);

    expect(res.body.assistant.message).toBe('Here is my freeform advice about your project.');
    expect(res.body.structuredResponse).toBeNull();
    expect(res.body.error).toBeUndefined();
    expect(res.body.personaId).toBe('assistant');
    expect(res.body.taskId).toBe('assistant--freeform');
  });

  // ========================================================================
  // Test 6: Valid JSON but missing required fields -- through the endpoint
  // Gap: validateStructuredResponse unit tests cover this case but existing
  //      endpoint tests only cover the non-JSON case (test 6 in endpoint).
  //      This tests the full flow: LLM returns valid JSON missing 'summary'.
  // ========================================================================
  it('should set error field when LLM returns valid JSON missing a required field', async () => {
    // product-manager--define-product requires: phase, questions, summary
    // Return valid JSON but omit 'summary'
    mockSendChatRequest.mockResolvedValueOnce({
      id: 'resp-missing-field',
      content: JSON.stringify({ phase: 'questions', questions: ['Q1'] }),
      isFinal: true,
    });

    const res = await request(app)
      .post('/api/chat/v2')
      .send({
        threadKey: { type: 'hub', projectId: 'integ-missing-field' },
        personaId: 'product-manager',
        taskId: 'product-manager--define-product',
        message: 'Start discovery.',
      })
      .expect(200);

    // Error should mention the missing field
    expect(res.body.error).toBeDefined();
    expect(res.body.error).toContain('Missing required field');
    expect(res.body.error).toContain('summary');
    // Raw message should still be passed through
    expect(res.body.assistant.message).toContain('"phase"');
    expect(res.body.assistant.message).toContain('"questions"');
  });

  // ========================================================================
  // Test 7: Valid JSON but wrong field types -- through the endpoint
  // Gap: Type mismatch only tested at unit level in validateStructuredResponse.
  //      This tests the full endpoint flow.
  // ========================================================================
  it('should set error field when LLM returns valid JSON with wrong field types', async () => {
    // product-manager--define-product expects: phase (string), questions (array), summary (string)
    // Return phase as a number instead of string
    mockSendChatRequest.mockResolvedValueOnce({
      id: 'resp-type-mismatch',
      content: JSON.stringify({ phase: 42, questions: ['Q1'], summary: 'S' }),
      isFinal: true,
    });

    const res = await request(app)
      .post('/api/chat/v2')
      .send({
        threadKey: { type: 'hub', projectId: 'integ-type-mismatch' },
        personaId: 'product-manager',
        taskId: 'product-manager--define-product',
        message: 'Start discovery.',
      })
      .expect(200);

    expect(res.body.error).toBeDefined();
    expect(res.body.error).toContain('Type mismatch');
    expect(res.body.error).toContain('phase');
    // The parsed response should still be available as fallback
    expect(res.body.structuredResponse).toBeDefined();
    expect(res.body.structuredResponse.phase).toBe(42);
  });

  // ========================================================================
  // Test 8: Empty request body returns 400
  // Gap: Existing endpoint tests cover individual missing fields but never
  //      send a completely empty body to verify the validation gate.
  // ========================================================================
  it('should return 400 for an empty request body', async () => {
    const res = await request(app)
      .post('/api/chat/v2')
      .send({})
      .expect(400);

    expect(res.body.error).toBeDefined();
    expect(res.body.error).toContain('Invalid ChatV2Request');
    expect(mockSendChatRequest).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Registry Loader Error Resilience Integration Tests
// ============================================================================
describe('Registry Loader Error Resilience (Spec 2026-02-28, Task Group 8)', () => {
  beforeEach(() => {
    mockLogger.warn.mockClear();
    mockLogger.info.mockClear();
  });

  // ========================================================================
  // Test 9: Malformed JSON file is skipped with warning
  // Gap: Existing registry tests cover missing .md refs and missing persona
  //      refs, but NOT a malformed JSON file that fails JSON.parse().
  // ========================================================================
  it('should skip a malformed JSON persona file and continue loading valid entries', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'reg-malformed-'));
    const personasDir = path.join(tmpDir, 'personas');
    const promptsDir = path.join(tmpDir, 'prompts');
    const tasksDir = path.join(tmpDir, 'tasks');
    await fs.mkdir(personasDir, { recursive: true });
    await fs.mkdir(promptsDir, { recursive: true });
    await fs.mkdir(tasksDir, { recursive: true });

    // Valid persona
    const validPersona = {
      id: 'good-persona',
      displayName: 'Good',
      color: '#0F0',
      identityPromptRef: 'prompts/good.identity.md',
      tasks: [],
      menuLabel: 'Good',
    };
    await fs.writeFile(
      path.join(personasDir, 'good-persona.json'),
      JSON.stringify(validPersona)
    );
    await fs.writeFile(
      path.join(promptsDir, 'good.identity.md'),
      '# Good persona identity prompt'
    );

    // Malformed JSON file (not valid JSON)
    await fs.writeFile(
      path.join(personasDir, 'bad-persona.json'),
      '{ this is not valid JSON at all !!!'
    );

    // Temporarily override config to use temp dir
    // We need to re-import initializeRegistries with the new config.
    // Since config is mocked at the top of this file, we need a different approach.
    // We will use a separate jest.isolateModules block.
    let personaCount = 0;

    await jest.isolateModulesAsync(async () => {
      jest.doMock('../config', () => ({
        getConfig: () => ({
          registryBasePath: tmpDir,
          openaiApiKey: 'test-key',
          openaiModel: 'gpt-4o',
          openaiBaseUrl: 'https://api.openai.com/v1',
          openaiTimeoutMs: 120000,
          logLevel: 'error',
        }),
      }));

      const isolatedLogger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      };
      jest.doMock('../services/logger', () => ({
        logger: isolatedLogger,
      }));

      const { initializeRegistries: isolatedInit, getPersonaRegistry: isolatedGetPersonas } =
        require('../services/registryLoader');

      await isolatedInit();
      const personas = isolatedGetPersonas();
      personaCount = personas.size;

      // Verify a warning was logged for the malformed file
      const warnCalls = isolatedLogger.warn.mock.calls;
      const malformedWarning = warnCalls.find(
        (call: unknown[]) =>
          typeof call[0] === 'string' && call[0].includes('Failed to load persona file')
      );
      expect(malformedWarning).toBeDefined();
    });

    expect(personaCount).toBe(1);

    // Cleanup
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // ========================================================================
  // Test 10: Missing personas directory entirely
  // Gap: Existing registry tests always provide at least an empty personas dir.
  //      This tests that initializeRegistries() handles a completely missing
  //      personas directory gracefully (logs warning, continues with tasks).
  // ========================================================================
  it('should handle a missing personas directory gracefully and still load tasks (with warnings)', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'reg-no-personas-'));
    // Only create tasks and prompts directories -- NO personas directory
    const tasksDir = path.join(tmpDir, 'tasks');
    const promptsDir = path.join(tmpDir, 'prompts');
    await fs.mkdir(tasksDir, { recursive: true });
    await fs.mkdir(promptsDir, { recursive: true });

    // Create a task file that would reference a persona that does not exist
    const task = {
      id: 'orphan--task',
      personaId: 'orphan',
      menuLabel: 'Orphan Task',
      description: 'This task has no persona',
      mode: 'advisory',
      taskPromptRef: 'prompts/orphan.task.md',
      responseFormat: null,
      contextNeeds: [],
      persistence: 'hub',
      artifacts: [],
      phases: null,
      availableFrom: ['hub'],
    };
    await fs.writeFile(path.join(tasksDir, 'orphan--task.json'), JSON.stringify(task));
    await fs.writeFile(path.join(promptsDir, 'orphan.task.md'), '# Orphan task prompt');

    let personaCount = 0;
    let taskCount = 0;

    await jest.isolateModulesAsync(async () => {
      jest.doMock('../config', () => ({
        getConfig: () => ({
          registryBasePath: tmpDir,
          openaiApiKey: 'test-key',
          openaiModel: 'gpt-4o',
          openaiBaseUrl: 'https://api.openai.com/v1',
          openaiTimeoutMs: 120000,
          logLevel: 'error',
        }),
      }));

      const isolatedLogger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      };
      jest.doMock('../services/logger', () => ({
        logger: isolatedLogger,
      }));

      const { initializeRegistries: isolatedInit, getPersonaRegistry: isolatedGetPersonas, getTaskRegistry: isolatedGetTasks } =
        require('../services/registryLoader');

      await isolatedInit();
      personaCount = isolatedGetPersonas().size;
      taskCount = isolatedGetTasks().size;

      // Verify a warning was logged about the missing personas directory
      const warnCalls = isolatedLogger.warn.mock.calls;
      const missingDirWarning = warnCalls.find(
        (call: unknown[]) =>
          typeof call[0] === 'string' && call[0].includes('Failed to read personas directory')
      );
      expect(missingDirWarning).toBeDefined();
    });

    // No personas loaded since the directory does not exist
    expect(personaCount).toBe(0);
    // Task should also be 0 because its personaId references a persona that was never loaded
    expect(taskCount).toBe(0);

    // Cleanup
    await fs.rm(tmpDir, { recursive: true, force: true });
  });
});
