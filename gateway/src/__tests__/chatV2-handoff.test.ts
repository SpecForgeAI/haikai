/**
 * Tests for POST /api/chat/v2/handoff Endpoint
 *
 * Spec 2026-02-28: Hub Chat MVP v1 (Frontend + Backend Wiring)
 * Task Group 1: Backend Handoff Endpoint
 *
 * 4 focused tests:
 * 1. POST /api/chat/v2/handoff with valid threadKey and personaId returns
 *    { success: true, threadKey: 'project:test-proj:hub' } with 200 status
 * 2. POST /api/chat/v2/handoff without threadKey returns 400 with error message
 * 3. POST /api/chat/v2/handoff without personaId returns 400 with error message
 * 4. POST /api/chat/v2/handoff with invalid personaId (not in persona registry)
 *    returns 400 with error message
 *
 * Uses supertest to make HTTP requests against the Express app.
 * Mocks config and logger following the pattern from chatV2-endpoint.test.ts.
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
jest.mock('../services/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// ---- Mock sendChatRequest (not used by handoff, but required by the chatV2 route module) ----
const mockSendChatRequest = jest.fn();
jest.mock('../services/openaiClient', () => ({
  sendChatRequest: (...args: unknown[]) => mockSendChatRequest(...args),
}));

// ---- Imports (after mocks) ----
import express from 'express';
import request from 'supertest';
import { initializeRegistries } from '../services/registryLoader';
import { chatV2Router } from '../routes/chatV2';

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

describe('POST /api/chat/v2/handoff Endpoint (Spec 2026-02-28, Task Group 1)', () => {
  let app: express.Application;

  beforeAll(async () => {
    // Create a unique temporary directory for thread storage
    testTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chatv2-handoff-test-'));
    await initializeRegistries();
    app = createTestApp();
  });

  afterAll(async () => {
    // Clean up temp directory
    try {
      await fs.rm(testTmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  beforeEach(async () => {
    // Clean thread files between tests to prevent cross-test contamination
    try {
      await fs.rm(path.join(testTmpDir, 'threads'), { recursive: true, force: true });
    } catch {
      // Ignore if directory does not exist
    }
  });

  // ========================================================================
  // Test 1: Valid threadKey and personaId returns success with 200
  // ========================================================================
  it('should return { success: true, threadKey } with 200 for valid threadKey and personaId', async () => {
    const res = await request(app)
      .post('/api/chat/v2/handoff')
      .send({
        threadKey: { type: 'hub', projectId: 'test-proj' },
        personaId: 'architect',
      })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.threadKey).toBe('project:test-proj:hub');
  });

  // ========================================================================
  // Test 2: Missing threadKey returns 400
  // ========================================================================
  it('should return 400 with error message when threadKey is missing', async () => {
    const res = await request(app)
      .post('/api/chat/v2/handoff')
      .send({
        personaId: 'architect',
      })
      .expect(400);

    expect(res.body.error).toBeDefined();
    expect(typeof res.body.error).toBe('string');
  });

  // ========================================================================
  // Test 3: Missing personaId returns 400
  // ========================================================================
  it('should return 400 with error message when personaId is missing', async () => {
    const res = await request(app)
      .post('/api/chat/v2/handoff')
      .send({
        threadKey: { type: 'hub', projectId: 'test-proj' },
      })
      .expect(400);

    expect(res.body.error).toBeDefined();
    expect(typeof res.body.error).toBe('string');
  });

  // ========================================================================
  // Test 4: Invalid personaId (not in registry) returns 400
  // ========================================================================
  it('should return 400 with error message when personaId is not in the persona registry', async () => {
    const res = await request(app)
      .post('/api/chat/v2/handoff')
      .send({
        threadKey: { type: 'hub', projectId: 'test-proj' },
        personaId: 'nonexistent-persona',
      })
      .expect(400);

    expect(res.body.error).toBeDefined();
    expect(res.body.error).toContain('nonexistent-persona');
  });
});
