/**
 * Hub Bootstrap 2: Gap Analysis Tests
 *
 * Spec 2026-03-01: Hub Bootstrap 2 -- Roadmap (PM) End-to-End
 * Task Group 8: Test Review and Gap Analysis
 *
 * These tests cover critical gaps identified during the TG8 review of TG1-TG7:
 *
 * Gateway Gaps:
 *  1. POST /generate mission path returns BOTH missionMarkdown AND artifactContent (backward compat)
 *  2. POST /generate roadmap: assistant message with valid JSON but no proposedInitiatives key
 *  3. POST /generate roadmap: assistant message with unparseable JSON content
 *  4. validateStructuredResponse: epics sub-array non-object item rejected
 *  5. validateStructuredResponse: proposedInitiatives item with title as number rejected
 *  6. countRoadmapItems: zero epics returns correct counts
 *  7. POST /save-artifact failure (tool error) returns success: false and no completion chip
 *  8. POST / non-first-turn roadmap includes inline context sections in resolved context
 *  9. POST / first-turn with existing roadmap summary text includes initiative/epic count tokens
 * 10. hasExistingRoadmap returns false for empty initiatives array
 * 11. buildRoadmapSummary returns empty string for null input
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
import { countRoadmapItems, hasExistingRoadmap, buildRoadmapSummary } from '../services/roadmapSummaryBuilder';

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

describe('Hub Bootstrap 2 Gap Tests (Spec 2026-03-01, Task Group 8)', () => {
  let app: express.Application;

  beforeAll(async () => {
    testTmpDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'hub-bootstrap-2-gaps-'));
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
  // Helper: seed a thread with messages
  // ========================================================================
  async function seedThread(
    threadKey: ThreadKey,
    messages: Array<Partial<ThreadMessage>>
  ): Promise<void> {
    await createThread(threadKey);
    for (const msg of messages) {
      const fullMsg: ThreadMessage = {
        id: uuidv4(),
        role: 'user',
        personaId: null,
        taskId: null,
        content: '',
        structuredResponse: null,
        timestamp: new Date().toISOString(),
        ...msg,
      };
      await appendMessage(threadKey, fullMsg);
    }
  }

  // ========================================================================
  // Gap 1: POST /generate mission path returns both missionMarkdown AND artifactContent
  // ========================================================================
  it('POST /generate mission path returns both missionMarkdown and artifactContent for backward compatibility', async () => {
    const threadKey: ThreadKey = { type: 'hub', projectId: 'gap-mission-gen-' + uuidv4().slice(0, 8) };
    await seedThread(threadKey, [
      {
        role: 'user',
        taskId: 'product-manager--define-product',
        content: 'Define my product.',
      },
      {
        role: 'assistant',
        personaId: 'product-manager',
        taskId: 'product-manager--define-product',
        content: 'Let me ask you some questions.',
      },
    ]);

    // Mock LLM to return a tool call with missionMarkdown
    mockSendChatRequest.mockResolvedValueOnce({
      content: null,
      toolCalls: [
        {
          id: 'call-1',
          name: 'save_product_artifacts',
          arguments: { missionMarkdown: '# My Product\n\nGreat product.' },
        },
      ],
    });

    const res = await request(app)
      .post('/api/chat/v2/generate')
      .send({
        threadKey,
        personaId: 'product-manager',
        taskId: 'product-manager--define-product',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // Should have BOTH fields for backward compatibility
    expect(res.body.missionMarkdown).toBe('# My Product\n\nGreat product.');
    expect(res.body.artifactContent).toBe('# My Product\n\nGreat product.');
  });

  // ========================================================================
  // Gap 2: POST /generate roadmap - assistant message with valid JSON but no proposedInitiatives
  // ========================================================================
  it('POST /generate roadmap returns failure when assistant JSON has no proposedInitiatives key', async () => {
    const threadKey: ThreadKey = { type: 'hub', projectId: 'gap-no-pi-' + uuidv4().slice(0, 8) };
    await seedThread(threadKey, [
      {
        role: 'user',
        taskId: 'product-manager--roadmap',
        content: 'Build a roadmap.',
      },
      {
        role: 'assistant',
        personaId: 'product-manager',
        taskId: 'product-manager--roadmap',
        content: JSON.stringify({
          phase: 'questions',
          section: 'roadmap_existence_check',
          summary: 'Some summary without proposedInitiatives',
          questions: ['Question 1?'],
          assumptions: [],
          openItems: [],
        }),
      },
    ]);

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
    expect(res.body.error).toContain('No proposed initiatives found');
  });

  // ========================================================================
  // Gap 3: POST /generate roadmap - assistant message with unparseable JSON
  // ========================================================================
  it('POST /generate roadmap returns failure when assistant content is not valid JSON', async () => {
    const threadKey: ThreadKey = { type: 'hub', projectId: 'gap-bad-json-' + uuidv4().slice(0, 8) };
    await seedThread(threadKey, [
      {
        role: 'user',
        taskId: 'product-manager--roadmap',
        content: 'Build a roadmap.',
      },
      {
        role: 'assistant',
        personaId: 'product-manager',
        taskId: 'product-manager--roadmap',
        content: 'This is plain text, not JSON at all.',
      },
    ]);

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
    // Should fail because plain text cannot be parsed to find proposedInitiatives
    expect(res.body.error).toContain('No proposed initiatives found');
  });

  // ========================================================================
  // Gap 4: validateStructuredResponse rejects non-object epics sub-array items
  // ========================================================================
  it('validateStructuredResponse rejects epics sub-array with non-object items', () => {
    const raw = JSON.stringify({
      phase: 'ready',
      section: 'final_review',
      questions: [],
      summary: 'Test',
      proposedInitiatives: [
        {
          title: 'Good Initiative',
          description: 'Valid initiative',
          epics: [42, 'not-an-object'],
        },
      ],
      assumptions: [],
      openItems: [],
    });

    const result = validateStructuredResponse(raw, roadmapResponseFormat);

    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('epics');
    expect(result.error).toContain('expected object');
  });

  // ========================================================================
  // Gap 5: validateStructuredResponse rejects proposedInitiatives item with title as number
  // ========================================================================
  it('validateStructuredResponse rejects proposedInitiatives item where title is a number instead of string', () => {
    const raw = JSON.stringify({
      phase: 'ready',
      section: 'final_review',
      questions: [],
      summary: 'Test',
      proposedInitiatives: [
        {
          title: 123,
          description: 'Bad title type',
          epics: [],
        },
      ],
      assumptions: [],
      openItems: [],
    });

    const result = validateStructuredResponse(raw, roadmapResponseFormat);

    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('title');
    expect(result.error).toContain('expected string');
  });

  // ========================================================================
  // Gap 6: countRoadmapItems with initiatives that have zero epics
  // ========================================================================
  it('countRoadmapItems returns correct counts for initiatives with zero epics', () => {
    const productSummary = {
      initiatives: [
        { id: 'i1', title: 'Init A', description: 'desc', epics: [] },
        { id: 'i2', title: 'Init B', description: 'desc', epics: [] },
        { id: 'i3', title: 'Init C', description: 'desc', epics: [] },
      ],
    };

    const counts = countRoadmapItems(productSummary as any);

    expect(counts.initiativeCount).toBe(3);
    expect(counts.epicCount).toBe(0);
  });

  // ========================================================================
  // Gap 7: POST /save-artifact roadmap failure returns success: false with no completion chip
  // ========================================================================
  it('POST /save-artifact roadmap failure returns success: false and does NOT persist a completion chip', async () => {
    const threadKey: ThreadKey = { type: 'hub', projectId: 'gap-save-fail-' + uuidv4().slice(0, 8) };
    await seedThread(threadKey, [
      {
        role: 'user',
        taskId: 'product-manager--roadmap',
        content: 'Build a roadmap.',
      },
    ]);

    // Mock executeToolCall to return an error
    mockExecuteToolCall.mockResolvedValueOnce({
      callId: 'call-fail',
      output: null,
      error: 'Service unavailable',
      status: 500,
      durationMs: 50,
    });

    const roadmapContent = JSON.stringify({ initiatives: [{ title: 'Init X', epics: [] }] });

    const res = await request(app)
      .post('/api/chat/v2/save-artifact')
      .send({
        threadKey,
        taskId: 'product-manager--roadmap',
        artifactId: 'roadmap',
        content: roadmapContent,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBeDefined();

    // Verify NO completion chip was persisted
    const thread = await getThread(threadKey);
    expect(thread).not.toBeNull();
    const completionChips = thread!.messages.filter(
      (m: ThreadMessage) =>
        m.structuredResponse &&
        typeof m.structuredResponse === 'object' &&
        (m.structuredResponse as Record<string, unknown>).type === 'completion-chip'
    );
    expect(completionChips.length).toBe(0);
  });

  // ========================================================================
  // Gap 8: hasExistingRoadmap returns false for empty initiatives array
  // ========================================================================
  it('hasExistingRoadmap returns false for productSummary with empty initiatives array', () => {
    expect(hasExistingRoadmap({ initiatives: [] } as any)).toBe(false);
  });

  // ========================================================================
  // Gap 9: hasExistingRoadmap returns false for null input
  // ========================================================================
  it('hasExistingRoadmap returns false for null productSummary', () => {
    expect(hasExistingRoadmap(null as any)).toBe(false);
  });

  // ========================================================================
  // Gap 10: buildRoadmapSummary returns empty string for null input
  // ========================================================================
  it('buildRoadmapSummary returns empty string for null productSummary', () => {
    expect(buildRoadmapSummary(null as any)).toBe('');
  });

  // ========================================================================
  // Gap 11: POST / first-turn existing roadmap summary text contains initiative/epic counts
  // ========================================================================
  it('POST / first-turn existing roadmap summary includes exact initiative and epic count tokens', async () => {
    const existingRoadmap = {
      initiatives: [
        {
          title: 'Alpha Initiative',
          description: 'First',
          epics: [
            { title: 'Epic A1', description: 'e1' },
          ],
        },
        {
          title: 'Beta Initiative',
          description: 'Second',
          epics: [
            { title: 'Epic B1', description: 'e1' },
            { title: 'Epic B2', description: 'e2' },
            { title: 'Epic B3', description: 'e3' },
          ],
        },
      ],
    };
    mockFetchProductSummary.mockResolvedValue(existingRoadmap);

    const threadKey: ThreadKey = { type: 'hub', projectId: 'gap-first-counts-' + uuidv4().slice(0, 8) };

    const res = await request(app)
      .post('/api/chat/v2/')
      .send({
        threadKey,
        personaId: 'product-manager',
        taskId: 'product-manager--roadmap',
        message: 'Build a roadmap.',
      });

    expect(res.status).toBe(200);
    expect(res.body.structuredResponse.section).toBe('outcome_alignment');
    // Verify the summary contains the exact counts from the mock data
    expect(res.body.structuredResponse.summary).toContain('2 initiatives');
    expect(res.body.structuredResponse.summary).toContain('4 epics');
  });
});
