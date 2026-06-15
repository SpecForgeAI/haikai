/**
 * Tests for Hub Bootstrap 2 -- Roadmap (PM) End-to-End Backend Endpoint Extensions
 *
 * Spec 2026-03-01: Hub Bootstrap 2 -- Roadmap (PM) End-to-End
 * Task Group 2: Backend Endpoint Extensions
 *
 * 8 focused tests:
 * 1. validateStructuredResponse with roadmap response where proposedInitiatives contains
 *    non-object element returns { valid: false }
 * 2. validateStructuredResponse with valid roadmap response with nested initiatives/epics
 *    returns { valid: true }
 * 3. POST /api/chat/v2/ with taskId 'product-manager--roadmap' and zero prior messages
 *    returns canned response with section === 'roadmap_existence_check' (no-roadmap branch)
 * 4. POST /api/chat/v2/ with taskId 'product-manager--roadmap', zero prior messages, and
 *    mock fetchProductSummary returning existing roadmap returns section === 'outcome_alignment'
 * 5. POST /api/chat/v2/generate with taskId 'product-manager--roadmap' and thread containing
 *    assistant message with proposedInitiatives returns { success: true, artifactContent }
 * 6. POST /api/chat/v2/generate with roadmap task and no assistant messages returns
 *    { success: false, error }
 * 7. POST /api/chat/v2/save-artifact with artifactType 'roadmap' calls executeToolCall with
 *    toolName 'save_roadmap_structure' and args { projectId, roadmapJson }
 * 8. POST /api/chat/v2/save-artifact with roadmap on success persists completion chip with
 *    artifactName 'ROADMAP' and content 'Roadmap complete.'
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
import { chatV2Router, validateStructuredResponse } from '../routes/chatV2';
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

// Load the roadmap task definition's responseFormat for validation tests
const roadmapTaskDef = require(path.resolve(realConfigDir, 'tasks', 'product-manager--roadmap.json'));
const roadmapResponseFormat = roadmapTaskDef.responseFormat;

describe('Hub Bootstrap 2 Endpoint Extensions (Spec 2026-03-01, Task Group 2)', () => {
  let app: express.Application;

  beforeAll(async () => {
    testTmpDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'hub-bootstrap-2-test-'));
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
      // Ignore if directory doesn't exist
    }
  });

  // ========================================================================
  // Helper: seed a thread with roadmap discovery messages
  // ========================================================================
  async function seedRoadmapThread(
    threadKey: ThreadKey,
    includeAssistantWithInitiatives: boolean = false
  ): Promise<void> {
    await createThread(threadKey);

    const userMsg: ThreadMessage = {
      id: uuidv4(),
      role: 'user',
      personaId: null,
      taskId: 'product-manager--roadmap',
      content: 'I want to build a roadmap for my product.',
      structuredResponse: null,
      timestamp: new Date().toISOString(),
    };
    await appendMessage(threadKey, userMsg);

    if (includeAssistantWithInitiatives) {
      const assistantContent = {
        phase: 'ready',
        section: 'final_review',
        summary: 'Here is the proposed roadmap.',
        questions: [],
        proposedInitiatives: [
          {
            title: 'Initiative Alpha',
            description: 'First initiative',
            epics: [
              { title: 'Epic A1', description: 'First epic of Alpha' },
            ],
          },
          {
            title: 'Initiative Beta',
            description: 'Second initiative',
            epics: [
              { title: 'Epic B1', description: 'First epic of Beta' },
              { title: 'Epic B2', description: 'Second epic of Beta' },
            ],
          },
        ],
        assumptions: ['Users want a roadmap'],
        openItems: [],
      };

      const assistantMsg: ThreadMessage = {
        id: uuidv4(),
        role: 'assistant',
        personaId: 'product-manager',
        taskId: 'product-manager--roadmap',
        content: JSON.stringify(assistantContent),
        structuredResponse: assistantContent,
        timestamp: new Date().toISOString(),
      };
      await appendMessage(threadKey, assistantMsg);
    }
  }

  // ========================================================================
  // Test 1: validateStructuredResponse rejects non-object proposedInitiatives items
  // ========================================================================
  it('should return { valid: false } when proposedInitiatives contains a non-object element', () => {
    const raw = JSON.stringify({
      phase: 'ready',
      section: 'final_review',
      questions: [],
      summary: 'Test',
      proposedInitiatives: [42],
      assumptions: [],
      openItems: [],
    });

    const result = validateStructuredResponse(raw, roadmapResponseFormat);

    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('proposedInitiatives[0]');
    expect(result.error).toContain('expected object');
  });

  // ========================================================================
  // Test 2: validateStructuredResponse accepts valid roadmap with nested initiatives/epics
  // ========================================================================
  it('should return { valid: true } for a valid roadmap response with nested initiatives and epics', () => {
    const raw = JSON.stringify({
      phase: 'ready',
      section: 'final_review',
      questions: [],
      summary: 'Roadmap finalized',
      proposedInitiatives: [
        {
          title: 'Init1',
          description: 'desc',
          epics: [
            { title: 'E1', description: 'e-desc' },
          ],
        },
      ],
      assumptions: ['All systems go'],
      openItems: [],
    });

    const result = validateStructuredResponse(raw, roadmapResponseFormat);

    expect(result.valid).toBe(true);
    expect(result.parsed).toBeDefined();
  });

  // ========================================================================
  // Test 3: POST / with roadmap task, zero prior messages, no roadmap =>
  //         canned first-turn response with section "outcome_alignment"
  // ========================================================================
  it('should return canned response with section === "outcome_alignment" when no roadmap exists', async () => {
    // Mock fetchProductSummary to return null (no project data)
    mockFetchProductSummary.mockResolvedValue(null);

    const threadKey: ThreadKey = { type: 'hub', projectId: 'roadmap-first-turn-no-rm-' + uuidv4().slice(0, 8) };

    const res = await request(app)
      .post('/api/chat/v2/')
      .send({
        threadKey,
        personaId: 'product-manager',
        taskId: 'product-manager--roadmap',
        message: 'I want to build a roadmap.',
      });

    expect(res.status).toBe(200);
    expect(res.body.structuredResponse).toBeDefined();
    expect(res.body.structuredResponse.section).toBe('outcome_alignment');
    expect(res.body.structuredResponse.phase).toBe('questions');
    expect(res.body.structuredResponse.questions).toHaveLength(2);
    expect(res.body.structuredResponse.proposedInitiatives).toEqual([]);

    // Should NOT have called the LLM
    expect(mockSendChatRequest).not.toHaveBeenCalled();
  });

  // ========================================================================
  // Test 4: POST / with roadmap task, zero prior messages, existing roadmap => outcome_alignment
  // ========================================================================
  it('should return canned response with section === "outcome_alignment" with 3 questions when roadmap exists', async () => {
    // Mock fetchProductSummary to return existing roadmap
    const existingRoadmap = {
      initiatives: [
        {
          title: 'Existing Initiative',
          description: 'Already built',
          epics: [
            { title: 'Epic 1', description: 'Done' },
            { title: 'Epic 2', description: 'In progress' },
          ],
        },
      ],
    };
    mockFetchProductSummary.mockResolvedValue(existingRoadmap);

    const threadKey: ThreadKey = { type: 'hub', projectId: 'roadmap-first-turn-has-rm-' + uuidv4().slice(0, 8) };

    const res = await request(app)
      .post('/api/chat/v2/')
      .send({
        threadKey,
        personaId: 'product-manager',
        taskId: 'product-manager--roadmap',
        message: 'I want to review my roadmap.',
      });

    expect(res.status).toBe(200);
    expect(res.body.structuredResponse).toBeDefined();
    expect(res.body.structuredResponse.section).toBe('outcome_alignment');
    expect(res.body.structuredResponse.phase).toBe('questions');
    expect(res.body.structuredResponse.questions).toHaveLength(3);
    expect(res.body.structuredResponse.summary).toContain('existing roadmap');
    expect(res.body.structuredResponse.summary).toContain('1 initiative');
    expect(res.body.structuredResponse.summary).toContain('2 epics');
    expect(res.body.structuredResponse.proposedInitiatives).toEqual([]);

    // Should NOT have called the LLM
    expect(mockSendChatRequest).not.toHaveBeenCalled();
  });

  // ========================================================================
  // Test 5: POST /generate with roadmap task extracts proposedInitiatives
  // ========================================================================
  it('should extract proposedInitiatives from thread and return artifactContent for roadmap generate', async () => {
    const threadKey: ThreadKey = { type: 'hub', projectId: 'gen-roadmap-' + uuidv4().slice(0, 8) };
    await seedRoadmapThread(threadKey, true); // include assistant with proposedInitiatives

    const res = await request(app)
      .post('/api/chat/v2/generate')
      .send({
        threadKey,
        personaId: 'product-manager',
        taskId: 'product-manager--roadmap',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.artifactContent).toBeDefined();
    expect(typeof res.body.artifactContent).toBe('string');

    // Parse and verify the artifact content
    const parsed = JSON.parse(res.body.artifactContent);
    expect(parsed.initiatives).toBeDefined();
    expect(Array.isArray(parsed.initiatives)).toBe(true);
    expect(parsed.initiatives.length).toBe(2);
    expect(parsed.initiatives[0].title).toBe('Initiative Alpha');
    expect(parsed.initiatives[1].title).toBe('Initiative Beta');

    // Should NOT have called the LLM for roadmap generation
    expect(mockSendChatRequest).not.toHaveBeenCalled();
  });

  // ========================================================================
  // Test 6: POST /generate with roadmap task and no assistant messages returns failure
  // ========================================================================
  it('should return { success: false, error } when roadmap generate finds no assistant messages', async () => {
    const threadKey: ThreadKey = { type: 'hub', projectId: 'gen-roadmap-empty-' + uuidv4().slice(0, 8) };
    await seedRoadmapThread(threadKey, false); // no assistant message

    const res = await request(app)
      .post('/api/chat/v2/generate')
      .send({
        threadKey,
        personaId: 'product-manager',
        taskId: 'product-manager--roadmap',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBeDefined();
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error).toContain('No proposed initiatives found');
  });

  // ========================================================================
  // Test 7: POST /save-artifact with roadmap calls save_roadmap_structure
  // ========================================================================
  it('should call executeToolCall with save_roadmap_structure and correct args for roadmap save', async () => {
    const threadKey: ThreadKey = { type: 'hub', projectId: 'save-roadmap-' + uuidv4().slice(0, 8) };
    await seedRoadmapThread(threadKey, true);

    mockExecuteToolCall.mockResolvedValueOnce({
      callId: 'call-save-roadmap',
      output: { saved: true },
      status: 200,
      durationMs: 100,
    });

    const roadmapContent = JSON.stringify({ initiatives: [{ title: 'Init A', epics: [] }] });

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

    // Verify executeToolCall was called with correct tool name and args
    expect(mockExecuteToolCall).toHaveBeenCalledTimes(1);
    const callArgs = mockExecuteToolCall.mock.calls[0];
    expect(callArgs[1]).toBe('save_roadmap_structure');
    const toolArgs = callArgs[2];
    expect(toolArgs.projectId).toBe(threadKey.projectId);
    expect(toolArgs.roadmapJson).toBe(roadmapContent);
    // Roadmap adapter should NOT have projectParentFolder, productName, or missionMarkdown
    expect(toolArgs.projectParentFolder).toBeUndefined();
    expect(toolArgs.productName).toBeUndefined();
    expect(toolArgs.missionMarkdown).toBeUndefined();
  });

  // ========================================================================
  // Test 8: POST /save-artifact with roadmap persists completion chip with ROADMAP
  // ========================================================================
  it('should persist completion chip with artifactName ROADMAP and content "Roadmap complete."', async () => {
    const threadKey: ThreadKey = { type: 'hub', projectId: 'save-roadmap-chip-' + uuidv4().slice(0, 8) };
    await seedRoadmapThread(threadKey, true);

    mockExecuteToolCall.mockResolvedValueOnce({
      callId: 'call-save-roadmap-chip',
      output: { saved: true },
      status: 200,
      durationMs: 80,
    });

    const roadmapContent = JSON.stringify({ initiatives: [{ title: 'Init B', epics: [] }] });

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
    expect(chip.content).toBe('Roadmap complete.');
    const sr = chip.structuredResponse as Record<string, unknown>;
    expect(sr.artifactName).toBe('ROADMAP');
    expect(sr.artifactId).toBe('roadmap');
    expect(sr.taskId).toBe('product-manager--roadmap');
  });
});
