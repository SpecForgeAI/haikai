/**
 * Increment 9 TG4: Gap Analysis Tests for Product/Roadmap Side Panel
 *
 * Spec 2026-03-01: Side Panel v2 -- Product and Roadmap Screens
 * Task Group 4: Test Review and Gap Analysis
 *
 * These tests fill critical coverage gaps identified during the TG4 review
 * of TG1-TG3 tests. Each test targets an integration point or regression guard
 * not covered by the existing 14 tests from TG1-TG3.
 *
 * Gap tests (10):
 *  1. Task-menu for panel + screen: 'roadmap' + product-manager returns product-manager--roadmap
 *  2. Task-menu for panel + screen: 'roadmap' does NOT return product-manager--define-product (hub-only)
 *  3. Screen context injection for screen: 'roadmap' produces "Roadmap tab" text in system prompt
 *     (Uses product-manager--backlog task to avoid the roadmap task's first-turn short-circuit)
 *  4. Screen context injection does NOT inject SCREEN CONTEXT for hub threadKeys
 *  5. Hub + product-manager task-menu returns ALL hub PM tasks including define-product (regression guard)
 *  6. PanelThreadKey { screen: 'roadmap' } round-trip serialization/deserialization
 *  7. product-manager--backlog task definition has contextNeeds ["product-summary", "roadmap-summary"]
 *  8. product-manager--definition-of-done task definition has correct availableFrom and contextNeeds
 *  9. product-manager--roadmap task definition has updated contextNeeds including "roadmap-summary"
 * 10. Context resolver registry has live (non-stub) resolvers for product-summary and roadmap-summary
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
    architectureModelServiceBaseUrl: 'http://localhost:8080',
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

// ---- Mock fetchProductSummary and fetchMetaModelSummary ----
const mockFetchProductSummary = jest.fn();
const mockFetchMetaModelSummary = jest.fn();
jest.mock('../services/architectureModelClient', () => {
  const actual = jest.requireActual('../services/architectureModelClient');
  return {
    ...actual,
    fetchProjectFolder: jest.fn(async () => testTmpDir),
    fetchProductSummary: (...args: unknown[]) => mockFetchProductSummary(...args),
    fetchMetaModelSummary: (...args: unknown[]) => mockFetchMetaModelSummary(...args),
  };
});

// ---- Imports (after mocks) ----
import express from 'express';
import request from 'supertest';
import { initializeRegistries, getTaskRegistry } from '../services/registryLoader';
import { chatV2Router } from '../routes/chatV2';
import {
  getContextResolverRegistry,
  ProductSummaryContextResolver,
  RoadmapSummaryContextResolver,
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

describe('Increment 9 TG4: Product/Roadmap Side Panel Gap Tests', () => {
  let app: express.Application;

  beforeAll(async () => {
    testTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chatv2-panel-product-roadmap-gaps-'));
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
    mockFetchProductSummary.mockReset();
    mockFetchMetaModelSummary.mockReset();
  
    // Clean thread files between tests to prevent cross-test contamination
    try {
      await fs.rm(path.join(testTmpDir, 'threads'), { recursive: true, force: true });
    } catch {
      // Ignore if directory does not exist
    }
  });

  // ========================================================================
  // Gap 1: Task-menu for panel + screen: 'roadmap' + product-manager
  //        returns product-manager--roadmap (Build Roadmap)
  // ========================================================================
  it('task-menu for panel + roadmap screen returns product-manager--roadmap', async () => {
    const res = await request(app)
      .post('/api/chat/v2')
      .send({
        threadKey: { type: 'panel', projectId: 'test-roadmap-panel', screen: 'roadmap' },
        personaId: 'product-manager',
        taskId: 'unknown',
        message: '',
      })
      .expect(200);

    expect(res.body.structuredResponse).toBeDefined();
    expect(res.body.structuredResponse.type).toBe('task-menu');

    const taskIds = res.body.structuredResponse.tasks.map((t: { taskId: string }) => t.taskId);

    // product-manager--roadmap has availableFrom: ["hub", "panel"] -- should appear
    expect(taskIds).toContain('product-manager--roadmap');

    // Should NOT have called sendChatRequest -- menu is deterministic
    expect(mockSendChatRequest).not.toHaveBeenCalled();
  });

  // ========================================================================
  // Gap 2: Task-menu for panel + screen: 'roadmap' returns
  //        product-manager--define-product (now panel-available) but never
  //        the embedded-only implement-support task
  // ========================================================================
  it('task-menu for panel + roadmap screen returns panel-available define-product but not embedded-only tasks', async () => {
    const res = await request(app)
      .post('/api/chat/v2')
      .send({
        threadKey: { type: 'panel', projectId: 'test-roadmap-panel-2', screen: 'roadmap' },
        personaId: 'product-manager',
        taskId: 'unknown',
        message: '',
      })
      .expect(200);

    const taskIds = res.body.structuredResponse.tasks.map((t: { taskId: string }) => t.taskId);

    // define-product is now panel-available (availableFrom: ["hub", "panel"])
    expect(taskIds).toContain('product-manager--define-product');

    // implement-support is embedded-only -- must NOT appear in panel menu
    expect(taskIds).not.toContain('product-manager--implement-support');
  });

  // ========================================================================
  // Gap 3: Screen context injection for screen: 'roadmap' produces
  //        "The user is currently on the Roadmap tab" in system prompt.
  //        Uses product-manager--backlog with a roadmap-screen panel
  //        threadKey. The backlog task now has a deterministic FIRST-TURN
  //        short-circuit (chatV2 Step 5f-3), so a prior backlog turn is
  //        seeded before the LLM-reaching turn.
  // ========================================================================
  it('panel threadKey with screen "roadmap" injects SCREEN CONTEXT with Roadmap tab text', async () => {
    // Mock fetchProductSummary to avoid real API calls from context resolvers
    mockFetchProductSummary.mockResolvedValue({ initiatives: [] });

    // Seed the deterministic first backlog turn (never reaches the LLM)
    await request(app)
      .post('/api/chat/v2')
      .send({
        threadKey: { type: 'panel', projectId: 'test-screen-roadmap', screen: 'roadmap' },
        personaId: 'product-manager',
        taskId: 'product-manager--backlog',
        message: 'Start backlog',
      })
      .expect(200);
    expect(mockSendChatRequest).not.toHaveBeenCalled();

    // Mock the LLM to capture the system prompt on the second turn
    mockSendChatRequest.mockResolvedValueOnce({
      content: JSON.stringify({
        phase: 'questions',
        section: 'epic_selection',
        questions: ['Which epic would you like to work on?'],
        summary: 'Here is backlog advice with roadmap screen context.',
        selectedEpic: null,
        proposedFeatures: [],
        epicPriorityUpdates: [],
        assumptions: [],
        openItems: [],
      }),
    });

    const res = await request(app)
      .post('/api/chat/v2')
      .send({
        threadKey: { type: 'panel', projectId: 'test-screen-roadmap', screen: 'roadmap' },
        personaId: 'product-manager',
        taskId: 'product-manager--backlog',
        message: 'Help me manage the backlog from the roadmap view',
      })
      .expect(200);

    // Verify sendChatRequest was called on the second turn
    expect(mockSendChatRequest).toHaveBeenCalledTimes(1);

    // Extract the system prompt from the messages array
    const callArgs = mockSendChatRequest.mock.calls[0];
    const messages = callArgs[0] as Array<{ role: string; content: string }>;
    const systemMessage = messages.find(m => m.role === 'system');

    expect(systemMessage).toBeDefined();
    expect(systemMessage!.content).toContain('=== SCREEN CONTEXT ===');
    expect(systemMessage!.content).toContain('The user is currently on the Roadmap tab');
  });

  // ========================================================================
  // Gap 4: Screen context injection does NOT inject SCREEN CONTEXT for hub
  //        threadKeys (only panel threadKeys get screen context)
  // ========================================================================
  it('hub threadKey does NOT inject SCREEN CONTEXT into system prompt', async () => {
    // Mock fetchProductSummary for context resolvers
    mockFetchProductSummary.mockResolvedValue({ initiatives: [] });

    // Seed the deterministic first backlog turn (chatV2 Step 5f-3, no LLM)
    await request(app)
      .post('/api/chat/v2')
      .send({
        threadKey: { type: 'hub', projectId: 'test-hub-no-screen' },
        personaId: 'product-manager',
        taskId: 'product-manager--backlog',
        message: 'Start backlog',
      })
      .expect(200);
    expect(mockSendChatRequest).not.toHaveBeenCalled();

    // Mock the LLM to capture the system prompt on the second turn
    mockSendChatRequest.mockResolvedValueOnce({
      content: JSON.stringify({
        phase: 'questions',
        section: 'epic_selection',
        questions: ['Which epic would you like to work on?'],
        summary: 'Here is backlog advice for the hub.',
        selectedEpic: null,
        proposedFeatures: [],
        epicPriorityUpdates: [],
        assumptions: [],
        openItems: [],
      }),
    });

    const res = await request(app)
      .post('/api/chat/v2')
      .send({
        threadKey: { type: 'hub', projectId: 'test-hub-no-screen' },
        personaId: 'product-manager',
        taskId: 'product-manager--backlog',
        message: 'Help me manage the backlog',
      })
      .expect(200);

    // Verify sendChatRequest was called on the second turn
    expect(mockSendChatRequest).toHaveBeenCalledTimes(1);

    // Extract the system prompt
    const callArgs = mockSendChatRequest.mock.calls[0];
    const messages = callArgs[0] as Array<{ role: string; content: string }>;
    const systemMessage = messages.find(m => m.role === 'system');

    expect(systemMessage).toBeDefined();
    // SCREEN CONTEXT should NOT be present for hub threadKeys
    expect(systemMessage!.content).not.toContain('=== SCREEN CONTEXT ===');
  });

  // ========================================================================
  // Gap 5: Hub + product-manager task-menu returns ALL hub PM tasks
  //        including define-product, backlog, definition-of-done, roadmap
  //        (regression guard -- hub tasks must not be accidentally filtered)
  // ========================================================================
  it('hub task-menu for product-manager returns all hub-available PM tasks (regression guard)', async () => {
    const res = await request(app)
      .post('/api/chat/v2')
      .send({
        threadKey: { type: 'hub', projectId: 'test-hub-pm-regression' },
        personaId: 'product-manager',
        taskId: 'unknown',
        message: '',
      })
      .expect(200);

    expect(res.body.structuredResponse).toBeDefined();
    expect(res.body.structuredResponse.type).toBe('task-menu');

    const taskIds = res.body.structuredResponse.tasks.map((t: { taskId: string }) => t.taskId);

    // All hub-available PM tasks must appear
    expect(taskIds).toContain('product-manager--define-product');
    expect(taskIds).toContain('product-manager--backlog');
    expect(taskIds).toContain('product-manager--definition-of-done');
    expect(taskIds).toContain('product-manager--roadmap');

    // Embedded-only task should NOT appear in hub menu
    expect(taskIds).not.toContain('product-manager--implement-support');

    // Should NOT have called sendChatRequest -- menu is deterministic
    expect(mockSendChatRequest).not.toHaveBeenCalled();
  });

  // ========================================================================
  // Gap 6: PanelThreadKey { screen: 'roadmap' } round-trip serialization
  //        and deserialization
  // ========================================================================
  it('PanelThreadKey with screen "roadmap" round-trips through threadKeyToString and parseThreadKey', () => {
    const originalKey: PanelThreadKey = {
      type: 'panel',
      projectId: 'proj-roadmap-rt',
      screen: 'roadmap',
    };

    const serialized = threadKeyToString(originalKey);
    expect(serialized).toBe('project:proj-roadmap-rt:panel:roadmap');

    const parsed = parseThreadKey(serialized);
    expect(parsed).toEqual({
      type: 'panel',
      projectId: 'proj-roadmap-rt',
      screen: 'roadmap',
    });
  });

  // ========================================================================
  // Gap 7: product-manager--backlog task definition has correct contextNeeds
  //        ["mission"] and availableFrom includes "panel"
  // ========================================================================
  it('product-manager--backlog task has contextNeeds ["mission"] and availableFrom includes "panel"', () => {
    const taskRegistry = getTaskRegistry();
    const backlogTask = taskRegistry.get('product-manager--backlog');

    expect(backlogTask).toBeDefined();
    expect(backlogTask!.contextNeeds).toEqual(['mission']);
    expect(backlogTask!.availableFrom).toContain('hub');
    expect(backlogTask!.availableFrom).toContain('panel');
  });

  // ========================================================================
  // Gap 8: product-manager--definition-of-done task definition has correct
  //        availableFrom and contextNeeds
  // ========================================================================
  it('product-manager--definition-of-done task has correct availableFrom ["hub", "panel"] and contextNeeds', () => {
    const taskRegistry = getTaskRegistry();
    const dodTask = taskRegistry.get('product-manager--definition-of-done');

    expect(dodTask).toBeDefined();
    expect(dodTask!.availableFrom).toEqual(expect.arrayContaining(['hub', 'panel']));
    expect(dodTask!.contextNeeds).toEqual(
      expect.arrayContaining(['product-summary', 'roadmap-summary'])
    );
    expect(dodTask!.contextNeeds).toHaveLength(2);
    // Mode should be advisory
    expect(dodTask!.mode).toBe('advisory');
  });

  // ========================================================================
  // Gap 9: product-manager--roadmap task definition has updated contextNeeds
  //        including "roadmap-summary" alongside existing "mission" and
  //        "existing-roadmap"
  // ========================================================================
  it('product-manager--roadmap task has contextNeeds ["mission", "existing-roadmap", "roadmap-summary", "meta-model-summary"]', () => {
    const taskRegistry = getTaskRegistry();
    const roadmapTask = taskRegistry.get('product-manager--roadmap');

    expect(roadmapTask).toBeDefined();
    expect(roadmapTask!.contextNeeds).toEqual(
      expect.arrayContaining(['mission', 'existing-roadmap', 'roadmap-summary', 'meta-model-summary'])
    );
    expect(roadmapTask!.contextNeeds).toHaveLength(4);
    // availableFrom should include both hub and panel
    expect(roadmapTask!.availableFrom).toContain('hub');
    expect(roadmapTask!.availableFrom).toContain('panel');
  });

  // ========================================================================
  // Gap 10: Context resolver registry has live (non-stub) resolvers for
  //         product-summary and roadmap-summary
  // ========================================================================
  it('context resolver registry has live ProductSummaryContextResolver and RoadmapSummaryContextResolver (not stubs)', () => {
    const registry = getContextResolverRegistry();

    // Verify resolvers exist
    const productResolver = registry.get('product-summary');
    const roadmapResolver = registry.get('roadmap-summary');

    expect(productResolver).toBeDefined();
    expect(roadmapResolver).toBeDefined();

    // Verify they are live implementations, not stubs
    expect(productResolver).toBeInstanceOf(ProductSummaryContextResolver);
    expect(roadmapResolver).toBeInstanceOf(RoadmapSummaryContextResolver);

    // Also verify existing-roadmap is still in registry (as stub)
    const existingRoadmapResolver = registry.get('existing-roadmap');
    expect(existingRoadmapResolver).toBeDefined();
    // existing-roadmap should NOT be an instance of the live resolvers
    expect(existingRoadmapResolver).not.toBeInstanceOf(ProductSummaryContextResolver);
    expect(existingRoadmapResolver).not.toBeInstanceOf(RoadmapSummaryContextResolver);
  });
});
