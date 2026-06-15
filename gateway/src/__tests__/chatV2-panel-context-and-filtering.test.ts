/**
 * Tests for Increment 8, Task Group 1: Backend Task Definitions,
 * Live Context Resolvers, and availableFrom Filtering
 *
 * 6 focused tests:
 * 1. mission resolver reads MISSION.MD with uppercase-first, lowercase-fallback
 * 2. mission resolver returns empty string when file not found (both paths missing)
 * 3. tech-stack resolver reads TECH-STACK.MD with two-path fallback
 * 4. meta-model-summary resolver calls fetchMetaModelSummary and returns JSON-stringified result;
 *    returns empty string on API error
 * 5. test-strategy resolver returns empty string when TEST-STRATEGY.MD is not found
 * 6. POST /api/chat/v2 with taskId 'unknown' and panel threadKey returns only tasks
 *    whose availableFrom includes "panel" (hub-only tasks are excluded)
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

// ---- Mock sendChatRequest (not needed for resolver tests but needed for endpoint test) ----
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
import { chatV2Router } from '../routes/chatV2';
import { DEFAULT_TEST_ARCHITECTURE_ID } from '../testSetup/architectureModelClientMock';
import {
  MissionContextResolver,
  TechStackContextResolver,
  TestStrategyContextResolver,
  MetaModelSummaryContextResolver,
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

describe('Increment 8 TG1: Context Resolvers and availableFrom Filtering', () => {
  let app: express.Application;

  beforeAll(async () => {
    testTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chatv2-panel-test-'));
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
  // Test 1: mission resolver reads MISSION.MD with uppercase-first, lowercase-fallback
  // ========================================================================
  it('should read MISSION.MD content with uppercase-first path when file exists', async () => {
    // Create the directory structure and file
    const productDir = path.join(testTmpDir, 'agent-os', 'product');
    await fs.mkdir(productDir, { recursive: true });
    await fs.writeFile(path.join(productDir, 'MISSION.MD'), '# Product Mission\nBuild the best product.', 'utf-8');

    const resolver = new MissionContextResolver();
    const result = await resolver.resolve('test-project', 'project:test-project:panel:metamodel');

    expect(result).toBe('# Product Mission\nBuild the best product.');

    // Clean up
    await fs.unlink(path.join(productDir, 'MISSION.MD'));
  });

  // ========================================================================
  // Test 2: mission resolver returns empty string when file not found
  // ========================================================================
  it('should return empty string when MISSION.MD is not found (both paths missing)', async () => {
    // Ensure the product dir exists but no mission file
    const productDir = path.join(testTmpDir, 'agent-os', 'product');
    await fs.mkdir(productDir, { recursive: true });

    // Remove any leftover files
    try { await fs.unlink(path.join(productDir, 'MISSION.MD')); } catch { /* ok */ }
    try { await fs.unlink(path.join(productDir, 'mission.md')); } catch { /* ok */ }

    const resolver = new MissionContextResolver();
    const result = await resolver.resolve('test-project', 'project:test-project:panel:metamodel');

    expect(result).toBe('');
  });

  // ========================================================================
  // Test 3: tech-stack resolver reads TECH-STACK.MD with two-path fallback
  // ========================================================================
  it('should read TECH-STACK.MD content with uppercase path, falling back to lowercase', async () => {
    const productDir = path.join(testTmpDir, 'agent-os', 'product');
    await fs.mkdir(productDir, { recursive: true });

    // Remove uppercase, write lowercase to test fallback
    try { await fs.unlink(path.join(productDir, 'TECH-STACK.MD')); } catch { /* ok */ }
    await fs.writeFile(path.join(productDir, 'tech-stack.md'), '# Tech Stack\nReact + Node.js', 'utf-8');

    const resolver = new TechStackContextResolver();
    const result = await resolver.resolve('test-project', 'project:test-project:panel:metamodel');

    expect(result).toBe('# Tech Stack\nReact + Node.js');

    // Clean up
    await fs.unlink(path.join(productDir, 'tech-stack.md'));
  });

  // ========================================================================
  // Test 4: meta-model-summary resolver calls fetchMetaModelSummary and
  //         returns JSON-stringified result; returns empty string on API error
  // ========================================================================
  it('should call fetchMetaModelSummary and return JSON-stringified result; empty string on error', async () => {
    const mockSummary = { services: [{ name: 'ServiceA' }], data_entities: [], interfaces: [], relationships: [] };
    mockFetchMetaModelSummary.mockResolvedValueOnce(mockSummary);

    const resolver = new MetaModelSummaryContextResolver();
    const result = await resolver.resolve('test-project', 'project:test-project:panel:metamodel');

    expect(mockFetchMetaModelSummary).toHaveBeenCalledWith(
      'test-project',
      DEFAULT_TEST_ARCHITECTURE_ID
    );
    expect(result).toBe(JSON.stringify(mockSummary));

    // Test error case: returns empty string on API error
    mockFetchMetaModelSummary.mockRejectedValueOnce(new Error('Network timeout'));

    const errorResult = await resolver.resolve('test-project', 'project:test-project:panel:metamodel');
    expect(errorResult).toBe('');
  });

  // ========================================================================
  // Test 5: test-strategy resolver returns empty string when TEST-STRATEGY.MD
  //         is not found (optional artifact)
  // ========================================================================
  it('should return empty string when TEST-STRATEGY.MD is not found (optional artifact)', async () => {
    const productDir = path.join(testTmpDir, 'agent-os', 'product');
    await fs.mkdir(productDir, { recursive: true });

    // Ensure no test strategy files exist
    try { await fs.unlink(path.join(productDir, 'TEST-STRATEGY.MD')); } catch { /* ok */ }
    try { await fs.unlink(path.join(productDir, 'test-strategy.md')); } catch { /* ok */ }

    const resolver = new TestStrategyContextResolver();
    const result = await resolver.resolve('test-project', 'project:test-project:panel:metamodel');

    expect(result).toBe('');
  });

  // ========================================================================
  // Test 6: POST /api/chat/v2 with taskId 'unknown' and panel threadKey
  //         returns only tasks whose availableFrom includes "panel"
  // ========================================================================
  it('should return only panel-available tasks in task-menu for panel threadKey', async () => {
    const res = await request(app)
      .post('/api/chat/v2')
      .send({
        threadKey: { type: 'panel', projectId: 'test-project-panel', screen: 'metamodel' },
        personaId: 'architect',
        taskId: 'unknown',
        message: '',
      })
      .expect(200);

    expect(res.body.structuredResponse).toBeDefined();
    expect(res.body.structuredResponse.type).toBe('task-menu');
    expect(Array.isArray(res.body.structuredResponse.tasks)).toBe(true);

    const taskIds = res.body.structuredResponse.tasks.map((t: { taskId: string }) => t.taskId);

    // Panel-eligible tasks should be present
    expect(taskIds).toContain('architect--oas-spec');
    expect(taskIds).toContain('architect--service-breakdown');
    expect(taskIds).toContain('architect--detailed-data-model');
    expect(taskIds).toContain('architect--tech-standards');

    // define-architecture is now panel-available (availableFrom ["hub","panel"])
    expect(taskIds).toContain('architect--define-architecture');
    // define-tech-stack is not in the architect persona's task list, so absent
    expect(taskIds).not.toContain('architect--define-tech-stack');

    // Should NOT have called sendChatRequest -- menu is deterministic
    expect(mockSendChatRequest).not.toHaveBeenCalled();
  });
});
