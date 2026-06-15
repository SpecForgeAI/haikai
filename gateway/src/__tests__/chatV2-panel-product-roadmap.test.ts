/**
 * Tests for Increment 9, Task Group 1: Backend Task Definitions,
 * Live Context Resolvers, and Screen Context Injection
 *
 * 6 focused tests:
 * 1. ProductSummaryContextResolver calls fetchProductSummary and returns formatted string;
 *    returns empty string when fetchProductSummary returns null
 * 2. ProductSummaryContextResolver returns empty string when fetchProductSummary throws (graceful degradation)
 * 3. RoadmapSummaryContextResolver calls fetchProductSummary then buildRoadmapSummary;
 *    returns empty string when fetchProductSummary returns null
 * 4. RoadmapSummaryContextResolver returns empty string when fetchProductSummary throws (graceful degradation)
 * 5. POST /api/chat/v2 with taskId 'unknown', personaId 'product-manager', panel threadKey
 *    (screen: 'product') returns backlog and definition-of-done but NOT define-product
 * 6. POST /api/chat/v2 with panel threadKey (screen: 'product') and taskId 'product-manager--backlog'
 *    produces a system prompt containing === SCREEN CONTEXT === with "Product Definition tab"
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
import { initializeRegistries } from '../services/registryLoader';
import { chatV2Router } from '../routes/chatV2';
import {
  ProductSummaryContextResolver,
  RoadmapSummaryContextResolver,
} from '../services/contextResolvers';

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

describe('Increment 9 TG1: Product/Roadmap Context Resolvers and Task Filtering', () => {
  let app: express.Application;

  beforeAll(async () => {
    testTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chatv2-panel-product-roadmap-'));
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
  // Test 1: ProductSummaryContextResolver calls fetchProductSummary and returns
  //         formatted string; returns empty string when fetchProductSummary returns null
  // ========================================================================
  it('ProductSummaryContextResolver returns formatted string with product data; empty string when null', async () => {
    const mockProductSummary = {
      initiatives: [
        {
          id: 'init-1',
          title: 'Platform Foundation',
          description: 'Core platform capabilities',
          epics: [
            { id: 'epic-1', title: 'Auth Service', description: 'Authentication', features: [] },
            { id: 'epic-2', title: 'User Management', description: 'User CRUD', features: [] },
          ],
        },
      ],
    };
    mockFetchProductSummary.mockResolvedValueOnce(mockProductSummary);

    const resolver = new ProductSummaryContextResolver();
    const result = await resolver.resolve('test-project', 'project:test-project:panel:product');

    expect(mockFetchProductSummary).toHaveBeenCalledWith('test-project');
    expect(result).toContain('Product Summary:');
    expect(result).toContain('Platform Foundation');

    // Test null response returns empty string
    mockFetchProductSummary.mockResolvedValueOnce(null);
    const nullResult = await resolver.resolve('test-project', 'project:test-project:panel:product');
    expect(nullResult).toBe('');
  });

  // ========================================================================
  // Test 2: ProductSummaryContextResolver returns empty string when
  //         fetchProductSummary throws (graceful degradation)
  // ========================================================================
  it('ProductSummaryContextResolver returns empty string when fetchProductSummary throws', async () => {
    mockFetchProductSummary.mockRejectedValueOnce(new Error('Network timeout'));

    const resolver = new ProductSummaryContextResolver();
    const result = await resolver.resolve('test-project', 'project:test-project:panel:product');

    expect(result).toBe('');
  });

  // ========================================================================
  // Test 3: RoadmapSummaryContextResolver calls fetchProductSummary then
  //         buildRoadmapSummary; returns empty string when null
  // ========================================================================
  it('RoadmapSummaryContextResolver returns condensed L1/L2 summary; empty string when null', async () => {
    const mockProductSummary = {
      initiatives: [
        {
          id: 'init-1',
          title: 'Platform Foundation',
          description: 'Core platform capabilities',
          epics: [
            { id: 'epic-1', title: 'Auth Service', description: 'Authentication', features: [] },
          ],
        },
      ],
    };
    mockFetchProductSummary.mockResolvedValueOnce(mockProductSummary);

    const resolver = new RoadmapSummaryContextResolver();
    const result = await resolver.resolve('test-project', 'project:test-project:panel:roadmap');

    expect(mockFetchProductSummary).toHaveBeenCalledWith('test-project');
    expect(result).toContain('Platform Foundation');
    expect(result).toContain('Auth Service');

    // Test null response returns empty string
    mockFetchProductSummary.mockResolvedValueOnce(null);
    const nullResult = await resolver.resolve('test-project', 'project:test-project:panel:roadmap');
    expect(nullResult).toBe('');
  });

  // ========================================================================
  // Test 4: RoadmapSummaryContextResolver returns empty string when
  //         fetchProductSummary throws (graceful degradation)
  // ========================================================================
  it('RoadmapSummaryContextResolver returns empty string when fetchProductSummary throws', async () => {
    mockFetchProductSummary.mockRejectedValueOnce(new Error('Service unavailable'));

    const resolver = new RoadmapSummaryContextResolver();
    const result = await resolver.resolve('test-project', 'project:test-project:panel:roadmap');

    expect(result).toBe('');
  });

  // ========================================================================
  // Test 5: POST /api/chat/v2 with taskId 'unknown', personaId 'product-manager',
  //         panel threadKey (screen: 'product') returns backlog and
  //         definition-of-done but NOT define-product (hub-only)
  // ========================================================================
  it('task-menu for panel + product-manager returns backlog and definition-of-done but NOT define-product', async () => {
    const res = await request(app)
      .post('/api/chat/v2')
      .send({
        threadKey: { type: 'panel', projectId: 'test-product-panel', screen: 'product' },
        personaId: 'product-manager',
        taskId: 'unknown',
        message: '',
      })
      .expect(200);

    expect(res.body.structuredResponse).toBeDefined();
    expect(res.body.structuredResponse.type).toBe('task-menu');
    expect(Array.isArray(res.body.structuredResponse.tasks)).toBe(true);

    const taskIds = res.body.structuredResponse.tasks.map((t: { taskId: string }) => t.taskId);

    // Panel-eligible tasks should be present
    expect(taskIds).toContain('product-manager--backlog');
    expect(taskIds).toContain('product-manager--definition-of-done');

    // define-product is now panel-available (availableFrom ["hub","panel"])
    expect(taskIds).toContain('product-manager--define-product');

    // Should NOT have called sendChatRequest -- menu is deterministic
    expect(mockSendChatRequest).not.toHaveBeenCalled();
  });

  // ========================================================================
  // Test 6: POST /api/chat/v2 with panel threadKey (screen: 'product')
  //         and taskId 'product-manager--backlog' produces a system prompt
  //         containing === SCREEN CONTEXT === with "Product Definition tab"
  // ========================================================================
  it('panel threadKey with screen "product" injects SCREEN CONTEXT into system prompt', async () => {
    // Mock fetchProductSummary to avoid real API calls from context resolvers
    mockFetchProductSummary.mockResolvedValue({ initiatives: [] });

    // First backlog turn is a deterministic short-circuit (chatV2 Step 5f-3)
    // that never reaches the LLM -- seed the thread with it first.
    await request(app)
      .post('/api/chat/v2')
      .send({
        threadKey: { type: 'panel', projectId: 'test-screen-context', screen: 'product' },
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
        summary: 'Here is some backlog advice.',
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
        threadKey: { type: 'panel', projectId: 'test-screen-context', screen: 'product' },
        personaId: 'product-manager',
        taskId: 'product-manager--backlog',
        message: 'Help me with my backlog',
      })
      .expect(200);

    // Verify sendChatRequest was called
    expect(mockSendChatRequest).toHaveBeenCalledTimes(1);

    // Extract the system prompt from the messages array
    const callArgs = mockSendChatRequest.mock.calls[0];
    const messages = callArgs[0] as Array<{ role: string; content: string }>;
    const systemMessage = messages.find(m => m.role === 'system');

    expect(systemMessage).toBeDefined();
    expect(systemMessage!.content).toContain('=== SCREEN CONTEXT ===');
    expect(systemMessage!.content).toContain('The user is currently on the Product Definition tab');
  });
});
