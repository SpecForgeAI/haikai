/**
 * Tests for Detailed Data Model Generate/Save Pipeline
 *
 * Spec 2026-03-14: Detailed Data Model Task -- End-to-End Fix
 * Task Group 3: Task Definition, Prompt, Route Branches, and Inline Context
 *
 * 5 focused tests:
 * 1. /generate with artifactType === 'data-model' builds conversation transcript,
 *    calls LLM with jsonMode, returns artifactContent on valid JSON
 * 2. /generate data-model corrective retry: first LLM response fails validation,
 *    second attempt succeeds
 * 3. validateDataModelJsonShape accepts payload with at least one non-empty entity
 *    array where entities have non-empty name fields
 * 4. validateDataModelJsonShape rejects payload with empty entity arrays / missing
 *    name fields
 * 5. /save-artifact with artifactType === 'data-model' calls executeToolCall with
 *    save_architecture_baseline and correct parameters
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

// ---- Mock fetchProductName and fetchProjectFolder ----
const mockFetchProductName = jest.fn();
jest.mock('../services/architectureModelClient', () => {
  const actual = jest.requireActual('../services/architectureModelClient');
  return {
    ...actual,
    fetchProjectFolder: jest.fn(async () => testTmpDir),
    fetchProductName: (...args: unknown[]) => mockFetchProductName(...args),
    fetchProductSummary: jest.fn(async () => null),
    fetchMetaModelSummary: jest.fn(async () => null),
  };
});

// ---- Mock architectureContextBuilder ----
jest.mock('../services/architectureContextBuilder', () => ({
  buildArchitectureContextSection: jest.fn(async () => ''),
}));

// ---- Imports (after mocks) ----
import express from 'express';
import request from 'supertest';
import { initializeRegistries } from '../services/registryLoader';
import { chatV2Router, validateDataModelJsonShape } from '../routes/chatV2';
import { createThread, appendMessage } from '../services/threadStore';
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

// Valid data model JSON for testing
const VALID_DATA_MODEL_JSON = {
  logicalDataEntities: [
    { name: 'User', description: 'User domain entity' },
    { name: 'Order', description: 'Order domain entity' },
  ],
  physicalDataEntities: [
    { name: 'users', description: 'Users table', physicalType: 'TABLE', database: 'main' },
    { name: 'orders', description: 'Orders table', physicalType: 'TABLE', database: 'main' },
  ],
  logicalDataAttributes: [
    { name: 'id', logicalEntityRef: 'User', dataType: 'UUID', isPrimaryKey: true },
    { name: 'email', logicalEntityRef: 'User', dataType: 'String' },
  ],
  physicalDataAttributes: [
    { name: 'id', physicalEntityRef: 'users', dataType: 'UUID', isPrimaryKey: true },
    { name: 'email', physicalEntityRef: 'users', dataType: 'VARCHAR(255)' },
  ],
  logicalPhysicalEntityMappings: [
    { logicalEntityName: 'User', physicalEntityName: 'users' },
    { logicalEntityName: 'Order', physicalEntityName: 'orders' },
  ],
};

describe('Data Model Pipeline (Spec 2026-03-14, Task Group 3)', () => {
  let app: express.Application;

  beforeAll(async () => {
    testTmpDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'data-model-pipeline-test-'));
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

    // Clean thread files between tests
    try {
      await fsPromises.rm(path.join(testTmpDir, 'threads'), { recursive: true, force: true });
    } catch {
      // Ignore if directory does not exist
    }
  });

  // ========================================================================
  // Helper: seed a thread with data model discovery messages
  // ========================================================================
  async function seedDataModelThread(
    threadKey: ThreadKey,
    includeAssistantMessage: boolean = false
  ): Promise<void> {
    await createThread(threadKey);

    const userMsg: ThreadMessage = {
      id: uuidv4(),
      role: 'user',
      personaId: null,
      taskId: 'architect--detailed-data-model',
      content: 'I want to define a detailed data model for my product.',
      structuredResponse: null,
      timestamp: new Date().toISOString(),
    };
    await appendMessage(threadKey, userMsg);

    if (includeAssistantMessage) {
      const assistantContent = {
        phase: 'ready',
        section: 'final_review',
        summary: 'Based on our discussion, I have enough information to generate the data model.',
        questions: [],
        logicalDataEntities: [
          { name: 'User', description: 'User domain entity' },
        ],
        physicalDataEntities: [
          { name: 'users', description: 'Users table' },
        ],
      };

      const assistantMsg: ThreadMessage = {
        id: uuidv4(),
        role: 'assistant',
        personaId: 'architect',
        taskId: 'architect--detailed-data-model',
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
        '# Product Mission\nBuild an amazing e-commerce platform.',
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
  // Test 1: /generate with data-model calls LLM with jsonMode, returns
  // artifactContent on valid JSON
  // ========================================================================
  it('should call sendChatRequest with jsonMode and temperature 0.2 for data-model generate and return valid artifactContent', async () => {
    const threadKey: ThreadKey = {
      type: 'hub',
      projectId: 'gen-dm-success-' + uuidv4().slice(0, 8),
    };
    await seedDataModelThread(threadKey, true);
    await createContextFiles({ mission: true, techStack: true });

    // Mock sendChatRequest to return valid data model JSON
    mockSendChatRequest.mockResolvedValueOnce({
      id: 'gen-resp-1',
      content: JSON.stringify(VALID_DATA_MODEL_JSON),
      isFinal: true,
    });

    const res = await request(app)
      .post('/api/chat/v2/generate')
      .send({
        threadKey,
        personaId: 'architect',
        taskId: 'architect--detailed-data-model',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.artifactContent).toBeDefined();
    expect(typeof res.body.artifactContent).toBe('string');

    // Verify the artifactContent is valid JSON with the data model shape
    const parsed = JSON.parse(res.body.artifactContent);
    expect(Array.isArray(parsed.logicalDataEntities)).toBe(true);
    expect(parsed.logicalDataEntities.length).toBe(2);
    expect(Array.isArray(parsed.physicalDataEntities)).toBe(true);
    expect(parsed.physicalDataEntities.length).toBe(2);

    // Verify sendChatRequest was called with correct options
    expect(mockSendChatRequest).toHaveBeenCalledTimes(1);
    const callArgs = mockSendChatRequest.mock.calls[0];
    const options = callArgs[3];
    expect(options.jsonMode).toBe(true);
    expect(options.temperature).toBe(0.2);
    expect(options.maxTokens).toBe(64000);
  });

  // ========================================================================
  // Test 2: /generate data-model corrective retry: first fails, second succeeds
  // ========================================================================
  it('should perform corrective retry when first data-model generation fails validation', async () => {
    const threadKey: ThreadKey = {
      type: 'hub',
      projectId: 'gen-dm-retry-' + uuidv4().slice(0, 8),
    };
    await seedDataModelThread(threadKey, true);
    await createContextFiles({ mission: true });

    // First call returns invalid JSON (no entities)
    mockSendChatRequest
      .mockResolvedValueOnce({
        id: 'gen-resp-invalid',
        content: JSON.stringify({ logicalDataEntities: [], physicalDataEntities: [] }),
        isFinal: true,
      })
      // Second call (retry) returns valid JSON
      .mockResolvedValueOnce({
        id: 'gen-resp-valid',
        content: JSON.stringify(VALID_DATA_MODEL_JSON),
        isFinal: true,
      });

    const res = await request(app)
      .post('/api/chat/v2/generate')
      .send({
        threadKey,
        personaId: 'architect',
        taskId: 'architect--detailed-data-model',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.artifactContent).toBeDefined();

    // Verify sendChatRequest was called twice (initial + retry)
    expect(mockSendChatRequest).toHaveBeenCalledTimes(2);

    // Verify the retry call includes the corrective instruction
    const retryCallArgs = mockSendChatRequest.mock.calls[1];
    const retryMessages = retryCallArgs[0];
    const lastUserMsg = retryMessages.filter((m: { role: string }) => m.role === 'user').pop();
    expect(lastUserMsg.content).toContain('not valid JSON');
    expect(lastUserMsg.content).toContain('logicalDataEntities');
    expect(lastUserMsg.content).toContain('physicalDataEntities');
  });

  // ========================================================================
  // Test 3: validateDataModelJsonShape accepts valid payload
  // ========================================================================
  it('should accept a valid data model payload with non-empty entity arrays and name fields', () => {
    const validPayload = {
      logicalDataEntities: [
        { name: 'User', description: 'A user entity' },
      ],
      physicalDataEntities: [
        { name: 'users', description: 'Users table' },
      ],
      logicalDataAttributes: [
        { name: 'id', logicalEntityRef: 'User', dataType: 'UUID' },
      ],
      physicalDataAttributes: [
        { name: 'id', physicalEntityRef: 'users', dataType: 'UUID' },
      ],
    };

    const result = validateDataModelJsonShape(validPayload);
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  // ========================================================================
  // Test 4: validateDataModelJsonShape rejects invalid payload
  // ========================================================================
  it('should reject a data model payload with empty entity arrays or missing name fields', () => {
    // Case 1: Both entity arrays empty
    const emptyEntities = {
      logicalDataEntities: [],
      physicalDataEntities: [],
    };
    const result1 = validateDataModelJsonShape(emptyEntities);
    expect(result1.valid).toBe(false);
    expect(result1.error).toContain('non-empty array');

    // Case 2: Entity with missing name
    const missingName = {
      logicalDataEntities: [
        { description: 'Entity without name' },
      ],
      physicalDataEntities: [],
    };
    const result2 = validateDataModelJsonShape(missingName);
    expect(result2.valid).toBe(false);
    expect(result2.error).toContain('name');

    // Case 3: Entity with empty string name
    const emptyName = {
      logicalDataEntities: [
        { name: '', description: 'Entity with empty name' },
      ],
    };
    const result3 = validateDataModelJsonShape(emptyName);
    expect(result3.valid).toBe(false);
    expect(result3.error).toContain('name');

    // Case 4: Attribute referencing non-existent entity
    const badRef = {
      logicalDataEntities: [
        { name: 'User', description: 'User entity' },
      ],
      logicalDataAttributes: [
        { name: 'id', logicalEntityRef: 'NonExistentEntity', dataType: 'UUID' },
      ],
    };
    const result4 = validateDataModelJsonShape(badRef);
    expect(result4.valid).toBe(false);
    expect(result4.error).toContain('NonExistentEntity');

    // Case 5: Not an object
    const result5 = validateDataModelJsonShape(null);
    expect(result5.valid).toBe(false);
    expect(result5.error).toContain('JSON object');
  });

  // ========================================================================
  // Test 5: /save-artifact with data-model calls executeToolCall with
  // save_architecture_baseline and correct parameters
  // ========================================================================
  it('should call executeToolCall with save_architecture_baseline and correct params for data-model save', async () => {
    const threadKey: ThreadKey = {
      type: 'hub',
      projectId: 'save-dm-' + uuidv4().slice(0, 8),
    };
    await seedDataModelThread(threadKey, true);

    // Mock executeToolCall to return success
    mockExecuteToolCall.mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify({ success: true, summary: { logicalDataEntities: 2 } }) }],
    });

    // Mock sendChatRequest for the completion message (POST / call from save-artifact)
    mockSendChatRequest.mockResolvedValueOnce({
      id: 'resp-completion',
      content: 'Data model has been saved.',
      isFinal: true,
    });

    const contentJson = JSON.stringify(VALID_DATA_MODEL_JSON);

    const res = await request(app)
      .post('/api/chat/v2/save-artifact')
      .send({
        threadKey,
        personaId: 'architect',
        taskId: 'architect--detailed-data-model',
        artifactId: 'data-model',
        content: contentJson,
      });

    expect(res.status).toBe(200);

    // Verify executeToolCall was called with save_architecture_baseline
    expect(mockExecuteToolCall).toHaveBeenCalledTimes(1);
    const toolCallArgs = mockExecuteToolCall.mock.calls[0];
    expect(toolCallArgs[1]).toBe('save_architecture_baseline');
    // Verify the parameters include projectId and architectureBaselineJson
    const toolParams = toolCallArgs[2];
    expect(toolParams.projectId).toBe(threadKey.projectId);
    expect(toolParams.architectureBaselineJson).toBe(contentJson);
  });
});
