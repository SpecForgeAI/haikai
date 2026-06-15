/**
 * Increment 8 Panel Integration Gap Tests
 *
 * Spec 2026-03-01: Side Panel v1 on Architecture/MetaModel Screen
 * Task Group 4: Test Review and Gap Analysis
 *
 * These tests fill critical coverage gaps identified during the TG4 review
 * of TG1-TG3. Each test targets an integration point or regression guard
 * that is not covered by the existing 12 tests.
 *
 * Gap tests (10):
 *  1. test-strategy resolver reads TEST-STRATEGY.MD when file exists (uppercase path)
 *  2. meta-model-summary resolver returns empty string when fetchMetaModelSummary returns null
 *  3. POST /api/chat/v2 task-menu for hub threadKey returns ALL hub tasks (regression guard)
 *  4. POST /api/chat/v2 task-menu for panel threadKey excludes define-architecture and define-tech-stack
 *  5. PanelThreadKey round-trip: threadKeyToString -> parseThreadKey produces identical object
 *  6. Context resolver pipeline for architect--service-breakdown resolves meta-model-summary, mission, tech-stack
 *  7. Advisory task with mode "advisory" does NOT trigger structured response validation (responseFormat is null)
 *  8. architect--oas-spec (availableFrom: ["panel"]) appears in panel task menu for architect persona
 *  9. Hub-only task define-architecture does NOT appear in panel task menu even though architect persona is allowed
 * 10. define-tech-stack (hub-only) does NOT appear in panel task menu for architect persona
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
}));

// ---- Mock sendChatRequest ----
const mockSendChatRequest = jest.fn();
jest.mock('../services/openaiClient', () => ({
  sendChatRequest: (...args: unknown[]) => mockSendChatRequest(...args),
}));

// ---- Mock fetchMetaModelSummary ----
const mockFetchMetaModelSummary = jest.fn();
jest.mock('../services/architectureModelClient', () => {
  const { buildArchitectureModelClientMock } = jest.requireActual(
    '../testSetup/architectureModelClientMock'
  );
  return buildArchitectureModelClientMock({
    fetchProjectFolder: jest.fn(async () => testTmpDir),
    fetchMetaModelSummary: (...args: unknown[]) => mockFetchMetaModelSummary(...args),
  });
});

// ---- Imports (after mocks) ----
import express from 'express';
import request from 'supertest';
import { initializeRegistries } from '../services/registryLoader';
import { getTaskRegistry } from '../services/registryLoader';
import { chatV2Router } from '../routes/chatV2';
import { DEFAULT_TEST_ARCHITECTURE_ID } from '../testSetup/architectureModelClientMock';
import {
  TestStrategyContextResolver,
  MetaModelSummaryContextResolver,
  getContextResolverRegistry,
} from '../services/contextResolvers';
import {
  threadKeyToString,
  parseThreadKey,
  PanelThreadKey,
} from '../types/chatV2';

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

describe('Increment 8 TG4: Panel Integration Gap Tests', () => {
  let app: express.Application;

  beforeAll(async () => {
    testTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chatv2-panel-integration-'));
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
    mockFetchMetaModelSummary.mockReset();
  
    // Clean thread files between tests to prevent cross-test contamination
    try {
      await fs.rm(path.join(testTmpDir, 'threads'), { recursive: true, force: true });
    } catch {
      // Ignore if directory does not exist
    }
  });

  // ========================================================================
  // Gap 1: test-strategy resolver reads TEST-STRATEGY.MD when file exists
  // ========================================================================
  it('test-strategy resolver reads TEST-STRATEGY.MD content when file exists (uppercase path)', async () => {
    const productDir = path.join(testTmpDir, 'agent-os', 'product');
    await fs.mkdir(productDir, { recursive: true });
    await fs.writeFile(
      path.join(productDir, 'TEST-STRATEGY.MD'),
      '# Test Strategy\nUnit tests first, then integration.',
      'utf-8'
    );

    const resolver = new TestStrategyContextResolver();
    const result = await resolver.resolve('test-project', 'project:test-project:panel:metamodel');

    expect(result).toBe('# Test Strategy\nUnit tests first, then integration.');

    // Clean up
    await fs.unlink(path.join(productDir, 'TEST-STRATEGY.MD'));
  });

  // ========================================================================
  // Gap 2: meta-model-summary resolver returns empty string when
  //        fetchMetaModelSummary returns null
  // ========================================================================
  it('meta-model-summary resolver returns empty string when fetchMetaModelSummary returns null', async () => {
    mockFetchMetaModelSummary.mockResolvedValueOnce(null);

    const resolver = new MetaModelSummaryContextResolver();
    const result = await resolver.resolve('test-project', 'project:test-project:panel:metamodel');

    expect(mockFetchMetaModelSummary).toHaveBeenCalledWith(
      'test-project',
      DEFAULT_TEST_ARCHITECTURE_ID
    );
    expect(result).toBe('');
  });

  // ========================================================================
  // Gap 3: POST /api/chat/v2 task-menu for hub threadKey returns ALL hub tasks
  //        (regression guard -- hub tasks must not be filtered out)
  // ========================================================================
  it('task-menu for hub threadKey returns ALL hub tasks including define-architecture and define-tech-stack', async () => {
    const res = await request(app)
      .post('/api/chat/v2')
      .send({
        threadKey: { type: 'hub', projectId: 'test-hub-regression' },
        personaId: 'architect',
        taskId: 'unknown',
        message: '',
      })
      .expect(200);

    expect(res.body.structuredResponse).toBeDefined();
    expect(res.body.structuredResponse.type).toBe('task-menu');

    const taskIds = res.body.structuredResponse.tasks.map((t: { taskId: string }) => t.taskId);

    // Hub-only tasks MUST be present for hub threadKey
    expect(taskIds).toContain('architect--define-architecture');

    // Panel-eligible tasks should also appear for hub (they have hub in availableFrom)
    expect(taskIds).toContain('architect--service-breakdown');
    expect(taskIds).toContain('architect--detailed-data-model');
    expect(taskIds).toContain('architect--tech-standards');

    // Should NOT have called sendChatRequest -- menu is deterministic
    expect(mockSendChatRequest).not.toHaveBeenCalled();
  });

  // ========================================================================
  // Gap 4: POST /api/chat/v2 task-menu for panel threadKey includes
  //        define-architecture and define-tech-stack (now panel-available)
  // ========================================================================
  it('task-menu for panel threadKey includes panel-available tasks define-architecture and define-tech-stack', async () => {
    const res = await request(app)
      .post('/api/chat/v2')
      .send({
        threadKey: { type: 'panel', projectId: 'test-panel-filter', screen: 'metamodel' },
        personaId: 'architect',
        taskId: 'unknown',
        message: '',
      })
      .expect(200);

    expect(res.body.structuredResponse).toBeDefined();
    expect(res.body.structuredResponse.type).toBe('task-menu');

    const taskIds = res.body.structuredResponse.tasks.map((t: { taskId: string }) => t.taskId);

    // define-architecture is now availableFrom ["hub","panel"]
    expect(taskIds).toContain('architect--define-architecture');
    // define-tech-stack is also panel-available at the registry level but is
    // no longer in the architect persona's task list, so it never appears
    expect(taskIds).not.toContain('architect--define-tech-stack');
  });

  // ========================================================================
  // Gap 5: PanelThreadKey round-trip serialization/deserialization
  // ========================================================================
  it('PanelThreadKey round-trips through threadKeyToString and parseThreadKey correctly', () => {
    const originalKey: PanelThreadKey = {
      type: 'panel',
      projectId: 'proj-rt-1',
      screen: 'metamodel',
    };

    const serialized = threadKeyToString(originalKey);
    expect(serialized).toBe('project:proj-rt-1:panel:metamodel');

    const parsed = parseThreadKey(serialized);
    expect(parsed).toEqual({
      type: 'panel',
      projectId: 'proj-rt-1',
      screen: 'metamodel',
    });
  });

  // ========================================================================
  // Gap 6: Context resolver pipeline for architect--service-breakdown
  //        resolves meta-model-summary, mission, and tech-stack keys
  // ========================================================================
  it('architect--service-breakdown task contextNeeds triggers mission and tech-stack resolvers', async () => {
    const taskRegistry = getTaskRegistry();
    const task = taskRegistry.get('architect--service-breakdown');

    expect(task).toBeDefined();
    expect(task!.contextNeeds).toEqual(
      expect.arrayContaining(['mission', 'tech-stack'])
    );
    expect(task!.contextNeeds).toHaveLength(2);

    // Verify all three resolver keys exist in the registry
    const resolverRegistry = getContextResolverRegistry();
    for (const key of task!.contextNeeds) {
      expect(resolverRegistry.has(key)).toBe(true);
    }
  });

  // ========================================================================
  // Gap 7: Advisory task with mode "advisory" has responseFormat null
  //        (does NOT trigger structured response validation)
  // ========================================================================
  it('advisory tasks have mode "advisory" and responseFormat null (no structured validation)', () => {
    const taskRegistry = getTaskRegistry();

    const advisoryTaskIds = [
      'architect--service-breakdown',
      'architect--tech-standards',
    ];

    for (const taskId of advisoryTaskIds) {
      const task = taskRegistry.get(taskId);
      expect(task).toBeDefined();
      expect(task!.mode).toBe('advisory');
      expect(task!.responseFormat).toBeNull();
    }

    // architect--detailed-data-model moved to mode "discovery" with a
    // structured responseFormat contract
    const dataModelTask = taskRegistry.get('architect--detailed-data-model');
    expect(dataModelTask).toBeDefined();
    expect(dataModelTask!.mode).toBe('discovery');
    expect(dataModelTask!.responseFormat).not.toBeNull();
  });

  // ========================================================================
  // Gap 8: architect--oas-spec (availableFrom: ["panel"]) appears in
  //        panel task menu for architect persona
  // ========================================================================
  it('architect--oas-spec with availableFrom ["panel"] appears in panel task menu', async () => {
    const res = await request(app)
      .post('/api/chat/v2')
      .send({
        threadKey: { type: 'panel', projectId: 'test-oas-panel', screen: 'metamodel' },
        personaId: 'architect',
        taskId: 'unknown',
        message: '',
      })
      .expect(200);

    const taskIds = res.body.structuredResponse.tasks.map((t: { taskId: string }) => t.taskId);

    // architect--oas-spec has availableFrom: ["panel"] and should appear
    expect(taskIds).toContain('architect--oas-spec');
  });

  // ========================================================================
  // Gap 9: define-architecture is panel-available and appears in panel
  //        task menu for architect persona
  // ========================================================================
  it('panel-available define-architecture appears in panel task menu for architect persona', async () => {
    // Verify the task definition is hub+panel
    const taskRegistry = getTaskRegistry();
    const defineArch = taskRegistry.get('architect--define-architecture');
    expect(defineArch).toBeDefined();
    expect(defineArch!.availableFrom).toEqual(['hub', 'panel']);

    // Request panel task menu for architect
    const res = await request(app)
      .post('/api/chat/v2')
      .send({
        threadKey: { type: 'panel', projectId: 'test-hub-only-guard', screen: 'metamodel' },
        personaId: 'architect',
        taskId: 'unknown',
        message: '',
      })
      .expect(200);

    const taskIds = res.body.structuredResponse.tasks.map((t: { taskId: string }) => t.taskId);

    // define-architecture is panel-available: must appear in panel menu
    expect(taskIds).toContain('architect--define-architecture');

    // Other panel-eligible tasks must still appear
    expect(taskIds).toContain('architect--service-breakdown');
    expect(taskIds).toContain('architect--oas-spec');
  });

  // ========================================================================
  // Gap 10: define-tech-stack is panel-available at the registry level but
  //         absent from the architect persona's task list, so it does not
  //         appear in the panel task menu
  // ========================================================================
  it('define-tech-stack (not in architect persona task list) does not appear in panel task menu', async () => {
    // Verify the task definition is hub+panel at the registry level
    const taskRegistry = getTaskRegistry();
    const defineTechStack = taskRegistry.get('architect--define-tech-stack');
    expect(defineTechStack).toBeDefined();
    expect(defineTechStack!.availableFrom).toEqual(['hub', 'panel']);

    const res = await request(app)
      .post('/api/chat/v2')
      .send({
        threadKey: { type: 'panel', projectId: 'test-ts-hub-only', screen: 'metamodel' },
        personaId: 'architect',
        taskId: 'unknown',
        message: '',
      })
      .expect(200);

    const taskIds = res.body.structuredResponse.tasks.map((t: { taskId: string }) => t.taskId);

    // Menu is driven by the persona's task list, which omits define-tech-stack
    expect(taskIds).not.toContain('architect--define-tech-stack');
  });
});
