/**
 * Tests for GET /api/chat/v2/thread Endpoint
 *
 * Spec 2026-02-28: Unified Chat Panel v1 (Frontend)
 * Task Group 2: GET /api/chat/v2/thread Endpoint
 *
 * 3 focused tests:
 * 1. GET /api/chat/v2/thread?key=project:abc:hub returns a Thread object
 *    (empty thread with messages: [] if no thread exists on disk)
 * 2. GET /api/chat/v2/thread without key param returns 400
 * 3. GET /api/chat/v2/thread?key=invalid with unparseable key returns 400
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

// ---- Mock sendChatRequest (not used by GET, but required by the chatV2 route module) ----
const mockSendChatRequest = jest.fn();
jest.mock('../services/openaiClient', () => ({
  sendChatRequest: (...args: unknown[]) => mockSendChatRequest(...args),
}));

// ---- Imports (after mocks) ----
import express from 'express';
import request from 'supertest';
import { initializeRegistries } from '../services/registryLoader';
import { chatV2Router } from '../routes/chatV2';
import { createThread } from '../services/threadStore';
import { ThreadKey } from '../types/chatV2';

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

describe('GET /api/chat/v2/thread Endpoint (Increment 2, Task Group 2)', () => {
  let app: express.Application;

  beforeAll(async () => {
    // Create a unique temporary directory for thread storage
    testTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chatv2-get-thread-test-'));
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
  // Test 1: GET with valid key returns a Thread object (empty thread if none exists)
  // ========================================================================
  it('should return a Thread object with messages: [] for a valid key when no thread exists on disk', async () => {
    const res = await request(app)
      .get('/api/chat/v2/thread')
      .query({ key: 'project:abc:hub' })
      .expect(200);

    // Verify the Thread shape
    expect(res.body.threadKey).toBe('project:abc:hub');
    expect(res.body.projectId).toBe('abc');
    expect(res.body.messages).toEqual([]);
    expect(res.body.activePersonaId).toBeNull();
    expect(res.body.activeTaskId).toBeNull();
    expect(res.body.createdAt).toBeDefined();
    expect(res.body.updatedAt).toBeDefined();
  });

  // ========================================================================
  // Test 2: GET without key param returns 400
  // ========================================================================
  it('should return 400 when the key query parameter is missing', async () => {
    const res = await request(app)
      .get('/api/chat/v2/thread')
      .expect(400);

    expect(res.body.error).toBeDefined();
    expect(res.body.error).toContain('Missing required query parameter');
  });

  // ========================================================================
  // Test 3: GET with unparseable key returns 400
  // ========================================================================
  it('should return 400 when the key query parameter is an unparseable string', async () => {
    const res = await request(app)
      .get('/api/chat/v2/thread')
      .query({ key: 'invalid' })
      .expect(400);

    expect(res.body.error).toBeDefined();
    expect(res.body.error).toContain('Invalid thread key');
  });
});
