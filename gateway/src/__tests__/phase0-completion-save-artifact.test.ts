/**
 * Tests for Phase 0 Completion and Handoff -- /save-artifact Branch (Three Sequential Saves)
 *
 * Spec 2026-04-04: Phase 0 Completion and Handoff
 * Task Group 4: chatV2.ts /save-artifact Branch (Three Sequential Saves)
 *
 * 5 focused tests (Task Group 4):
 * 1. Successful flow -- all three executeToolCall calls succeed; verify all three called in order
 * 2. Save 1 (anchor entities) fails -- verify error returned; saves 2 and 3 NOT called
 * 3. Save 2 (discovery config) fails -- verify save 1 was called; save 3 NOT called
 * 4. Save 3 (discovery brief artifact) fails -- verify saves 1 and 2 were called
 * 5. Verify status="COMPLETE" is injected into structured data before save_discovery_config
 *
 * Gap-fill tests (Task Group 6):
 * 6. Status injection does not mutate the original structuredData passed to save 1
 * 7. Completion chip has correct structure (type, artifactId, artifactName, taskId)
 * 8. Applications present but empty appComponents -- save 1 still called with empty array
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

// ---- Mock fetchProductName, fetchProductSummary, fetchMetaModelSummary ----
const mockFetchProductName = jest.fn();
const mockFetchProductSummary = jest.fn();
const mockFetchMetaModelSummary = jest.fn();
jest.mock('../services/architectureModelClient', () => {
  const actual = jest.requireActual('../services/architectureModelClient');
  return {
    ...actual,
    fetchProjectFolder: jest.fn(async () => testTmpDir),
    fetchProductName: (...args: unknown[]) => mockFetchProductName(...args),
    fetchProductSummary: (...args: unknown[]) => mockFetchProductSummary(...args),
    fetchMetaModelSummary: (...args: unknown[]) => mockFetchMetaModelSummary(...args),
  };
});

// ---- Imports (after mocks) ----
import express from 'express';
import request from 'supertest';
import { initializeRegistries } from '../services/registryLoader';
import { chatV2Router } from '../routes/chatV2';
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

// Full discovery framing structured data for testing
const FULL_STRUCTURED_DATA = {
  summary: 'Scope covers three microservices and two frontend apps.',
  applications: [
    { name: 'Order Service', description: 'Handles order processing' },
    { name: 'Payment Service', description: 'Handles payment transactions' },
  ],
  appComponents: [
    { name: 'Order API', applicationName: 'Order Service', description: 'REST API for orders' },
    { name: 'Payment Gateway', applicationName: 'Payment Service', description: 'Payment processing gateway' },
  ],
  repos: [
    {
      url: 'https://github.com/org/orders',
      branch: 'main',
      includePaths: ['src/'],
      excludePaths: ['test/', 'docs/'],
    },
  ],
  repoApplicationMappings: [
    { repoUrl: 'https://github.com/org/orders', path: '/', applicationName: 'Order Service' },
  ],
  techHints: [
    { repoUrl: 'https://github.com/org/orders', path: '/', technology: 'Express', language: 'TypeScript' },
  ],
  exclusions: [
    { pattern: '**/test/**', reason: 'Test files are not production code' },
  ],
  notes: ['Order Service may be split in the future.'],
};

const MARKDOWN_BRIEF = '# Discovery Brief\n\n## Scope Summary\n\nScope covers three microservices and two frontend apps.\n';

// Build the combined content payload as the /generate branch produces it
function buildSaveContent(structuredData: Record<string, unknown> = FULL_STRUCTURED_DATA, markdownBrief: string = MARKDOWN_BRIEF): string {
  return JSON.stringify({ structuredData, markdownBrief });
}

// Helper: seed a thread with at least one message so completion chip can resolve personaId
async function seedThread(threadKey: ThreadKey): Promise<void> {
  await createThread(threadKey);

  const userMsg: ThreadMessage = {
    id: uuidv4(),
    role: 'user',
    personaId: null,
    taskId: 'architect--discovery-framing',
    content: 'Help me define the discovery scope.',
    structuredResponse: null,
    timestamp: new Date().toISOString(),
  };
  await appendMessage(threadKey, userMsg);

  const assistantMsg: ThreadMessage = {
    id: uuidv4(),
    role: 'assistant',
    personaId: 'architect',
    taskId: 'architect--discovery-framing',
    content: JSON.stringify({ phase: 'ready', summary: 'All confirmed.' }),
    structuredResponse: { phase: 'ready', summary: 'All confirmed.' },
    timestamp: new Date().toISOString(),
  };
  await appendMessage(threadKey, assistantMsg);
}

// Helper: mock all three executeToolCall calls to succeed
function mockAllSavesSucceed(projectId: string): void {
  mockExecuteToolCall
    .mockResolvedValueOnce({
      callId: 'call-1-anchor',
      output: { projectId, applicationsCreated: 2, appComponentsCreated: 2 },
      status: 200,
      durationMs: 100,
    })
    .mockResolvedValueOnce({
      callId: 'call-2-config',
      output: { projectId, saved: true },
      status: 200,
      durationMs: 80,
    })
    .mockResolvedValueOnce({
      callId: 'call-3-artifact',
      output: { projectId, artifactType: 'DISCOVERY_BRIEF_MD' },
      status: 200,
      durationMs: 60,
    });
}

describe('Phase 0 Completion -- /save-artifact Branch (Spec 2026-04-04, Task Group 4)', () => {
  let app: express.Application;

  beforeAll(async () => {
    testTmpDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'phase0-save-artifact-test-'));
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
    mockFetchMetaModelSummary.mockReset();

    // Clean thread files between tests
    try {
      await fsPromises.rm(path.join(testTmpDir, 'threads'), { recursive: true, force: true });
    } catch {
      // Ignore if directory does not exist
    }
  });

  // ========================================================================
  // Test 1: Successful flow -- all three executeToolCall calls succeed
  // ========================================================================
  it('should call all three saves in order with correct params and return { success: true }', async () => {
    const threadKey: ThreadKey = {
      type: 'hub',
      projectId: 'df-save-1-' + uuidv4().slice(0, 8),
    };
    await seedThread(threadKey);

    // Mock all three executeToolCall calls to succeed
    mockAllSavesSucceed(threadKey.projectId!);

    const res = await request(app)
      .post('/api/chat/v2/save-artifact')
      .send({
        threadKey,
        taskId: 'architect--discovery-framing',
        artifactId: 'discovery-framing',
        content: buildSaveContent(),
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify all three calls were made
    expect(mockExecuteToolCall).toHaveBeenCalledTimes(3);

    // Save 1: save_project_anchor_entities
    const call1Args = mockExecuteToolCall.mock.calls[0];
    expect(call1Args[1]).toBe('save_project_anchor_entities');
    expect(call1Args[2].projectId).toBe(threadKey.projectId);
    expect(call1Args[2].applications).toEqual(FULL_STRUCTURED_DATA.applications);
    expect(call1Args[2].appComponents).toEqual(FULL_STRUCTURED_DATA.appComponents);

    // Save 2: save_discovery_config
    const call2Args = mockExecuteToolCall.mock.calls[1];
    expect(call2Args[1]).toBe('save_discovery_config');
    expect(call2Args[2].projectId).toBe(threadKey.projectId);
    expect(call2Args[2].discoveryConfigJson).toBeDefined();
    const parsedConfig = JSON.parse(call2Args[2].discoveryConfigJson);
    expect(parsedConfig.status).toBe('COMPLETE');

    // Save 3: create_project_artifact
    const call3Args = mockExecuteToolCall.mock.calls[2];
    expect(call3Args[1]).toBe('create_project_artifact');
    expect(call3Args[2].projectId).toBe(threadKey.projectId);
    expect(call3Args[2].artifactType).toBe('DISCOVERY_BRIEF_MD');
    expect(call3Args[2].content).toBe(MARKDOWN_BRIEF);
    expect(call3Args[2].source).toBe('TOOL');

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
    expect(chip.content).toBe('Discovery Framing complete.');
    const sr = chip.structuredResponse as Record<string, unknown>;
    expect(sr.artifactId).toBe('discovery-framing');
    expect(sr.artifactName).toBe('DISCOVERY_BRIEF');
  });

  // ========================================================================
  // Test 2: Save 1 (anchor entities) fails -- saves 2 and 3 NOT called
  // ========================================================================
  it('should return { success: false, error } mentioning "anchor entities" when save 1 fails', async () => {
    const threadKey: ThreadKey = {
      type: 'hub',
      projectId: 'df-save-2-' + uuidv4().slice(0, 8),
    };
    await seedThread(threadKey);

    // Mock save 1 to fail
    mockExecuteToolCall.mockResolvedValueOnce({
      callId: 'call-1-anchor-fail',
      output: null,
      error: 'Connection refused to architecture model service',
      status: 502,
      durationMs: 50,
    });

    const res = await request(app)
      .post('/api/chat/v2/save-artifact')
      .send({
        threadKey,
        taskId: 'architect--discovery-framing',
        artifactId: 'discovery-framing',
        content: buildSaveContent(),
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('anchor entities');

    // Only save 1 should have been called
    expect(mockExecuteToolCall).toHaveBeenCalledTimes(1);
  });

  // ========================================================================
  // Test 3: Save 2 (discovery config) fails -- save 1 called, save 3 NOT called
  // ========================================================================
  it('should return { success: false, error } mentioning "discovery config" when save 2 fails', async () => {
    const threadKey: ThreadKey = {
      type: 'hub',
      projectId: 'df-save-3-' + uuidv4().slice(0, 8),
    };
    await seedThread(threadKey);

    // Mock save 1 to succeed, save 2 to fail
    mockExecuteToolCall
      .mockResolvedValueOnce({
        callId: 'call-1-anchor-ok',
        output: { projectId: threadKey.projectId, applicationsCreated: 2, appComponentsCreated: 2 },
        status: 200,
        durationMs: 100,
      })
      .mockResolvedValueOnce({
        callId: 'call-2-config-fail',
        output: null,
        error: 'Discovery config save failed: project not found',
        status: 404,
        durationMs: 30,
      });

    const res = await request(app)
      .post('/api/chat/v2/save-artifact')
      .send({
        threadKey,
        taskId: 'architect--discovery-framing',
        artifactId: 'discovery-framing',
        content: buildSaveContent(),
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('discovery config');

    // Save 1 and save 2 called, but NOT save 3
    expect(mockExecuteToolCall).toHaveBeenCalledTimes(2);
    expect(mockExecuteToolCall.mock.calls[0][1]).toBe('save_project_anchor_entities');
    expect(mockExecuteToolCall.mock.calls[1][1]).toBe('save_discovery_config');
  });

  // ========================================================================
  // Test 4: Save 3 (discovery brief artifact) fails -- saves 1 and 2 called
  // ========================================================================
  it('should return { success: false, error } mentioning "discovery brief" when save 3 fails', async () => {
    const threadKey: ThreadKey = {
      type: 'hub',
      projectId: 'df-save-4-' + uuidv4().slice(0, 8),
    };
    await seedThread(threadKey);

    // Mock saves 1 and 2 to succeed, save 3 to fail
    mockExecuteToolCall
      .mockResolvedValueOnce({
        callId: 'call-1-anchor-ok',
        output: { projectId: threadKey.projectId, applicationsCreated: 2, appComponentsCreated: 2 },
        status: 200,
        durationMs: 100,
      })
      .mockResolvedValueOnce({
        callId: 'call-2-config-ok',
        output: { projectId: threadKey.projectId, saved: true },
        status: 200,
        durationMs: 80,
      })
      .mockResolvedValueOnce({
        callId: 'call-3-artifact-fail',
        output: null,
        error: 'Artifact creation failed: database error',
        status: 500,
        durationMs: 20,
      });

    const res = await request(app)
      .post('/api/chat/v2/save-artifact')
      .send({
        threadKey,
        taskId: 'architect--discovery-framing',
        artifactId: 'discovery-framing',
        content: buildSaveContent(),
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('discovery brief');

    // All three saves should have been attempted
    expect(mockExecuteToolCall).toHaveBeenCalledTimes(3);
    expect(mockExecuteToolCall.mock.calls[0][1]).toBe('save_project_anchor_entities');
    expect(mockExecuteToolCall.mock.calls[1][1]).toBe('save_discovery_config');
    expect(mockExecuteToolCall.mock.calls[2][1]).toBe('create_project_artifact');
  });

  // ========================================================================
  // Test 5: Verify status="COMPLETE" is injected into structured data
  // ========================================================================
  it('should inject status="COMPLETE" into discoveryConfigJson before calling save_discovery_config', async () => {
    const threadKey: ThreadKey = {
      type: 'hub',
      projectId: 'df-save-5-' + uuidv4().slice(0, 8),
    };
    await seedThread(threadKey);

    // Use structured data that has a different status (or no status)
    const structuredDataWithDraft = {
      ...FULL_STRUCTURED_DATA,
      status: 'DRAFT',
    };

    // Mock all three calls to succeed
    mockAllSavesSucceed(threadKey.projectId!);

    const res = await request(app)
      .post('/api/chat/v2/save-artifact')
      .send({
        threadKey,
        taskId: 'architect--discovery-framing',
        artifactId: 'discovery-framing',
        content: buildSaveContent(structuredDataWithDraft, MARKDOWN_BRIEF),
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify save 2 (discovery config) has status="COMPLETE" injected, overriding "DRAFT"
    const call2Args = mockExecuteToolCall.mock.calls[1];
    expect(call2Args[1]).toBe('save_discovery_config');
    const configJson = JSON.parse(call2Args[2].discoveryConfigJson);
    expect(configJson.status).toBe('COMPLETE');

    // Verify the original structured data fields are still present
    expect(configJson.applications).toBeDefined();
    expect(configJson.applications).toHaveLength(2);
    expect(configJson.summary).toBe('Scope covers three microservices and two frontend apps.');
  });

  // ========================================================================
  // Gap Fill Test 6: Status injection does not mutate the original structuredData
  // ========================================================================
  it('should not mutate the original structuredData when injecting status=COMPLETE for config save', async () => {
    const threadKey: ThreadKey = {
      type: 'hub',
      projectId: 'df-save-6-' + uuidv4().slice(0, 8),
    };
    await seedThread(threadKey);

    // Structured data without a status field
    const structuredDataNoStatus = {
      summary: 'Test scope.',
      applications: [{ name: 'TestApp', description: 'Test' }],
      appComponents: [],
      repos: [],
      repoApplicationMappings: [],
      techHints: [],
      exclusions: [],
      notes: [],
    };

    // Mock all three calls to succeed
    mockAllSavesSucceed(threadKey.projectId!);

    await request(app)
      .post('/api/chat/v2/save-artifact')
      .send({
        threadKey,
        taskId: 'architect--discovery-framing',
        artifactId: 'discovery-framing',
        content: buildSaveContent(structuredDataNoStatus, '# Brief'),
      });

    // Save 1 (anchor entities) should receive the original applications WITHOUT status field
    const call1Args = mockExecuteToolCall.mock.calls[0];
    expect(call1Args[1]).toBe('save_project_anchor_entities');
    expect(call1Args[2].applications).toEqual([{ name: 'TestApp', description: 'Test' }]);

    // Save 2 (discovery config) should have status="COMPLETE" injected
    const call2Args = mockExecuteToolCall.mock.calls[1];
    const configJson = JSON.parse(call2Args[2].discoveryConfigJson);
    expect(configJson.status).toBe('COMPLETE');

    // The implementation uses spread operator ({ ...structuredData, status: 'COMPLETE' })
    // which creates a new object. Verify save 1's data did not pick up the status.
    // If mutation occurred, the status would bleed through to the serialized data.
    expect(call1Args[2].applications[0]).not.toHaveProperty('status');
  });

  // ========================================================================
  // Gap Fill Test 7: Completion chip has correct full structure
  // ========================================================================
  it('should persist a completion chip with type=completion-chip, taskId, personaId, and timestamp', async () => {
    const threadKey: ThreadKey = {
      type: 'hub',
      projectId: 'df-save-7-' + uuidv4().slice(0, 8),
    };
    await seedThread(threadKey);

    mockAllSavesSucceed(threadKey.projectId!);

    const res = await request(app)
      .post('/api/chat/v2/save-artifact')
      .send({
        threadKey,
        taskId: 'architect--discovery-framing',
        artifactId: 'discovery-framing',
        content: buildSaveContent(),
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

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
    const sr = chip.structuredResponse as Record<string, unknown>;

    // Verify the full completion chip structure
    expect(sr.type).toBe('completion-chip');
    expect(sr.artifactId).toBe('discovery-framing');
    expect(sr.artifactName).toBe('DISCOVERY_BRIEF');
    expect(sr.taskId).toBe('architect--discovery-framing');
    expect(sr.personaId).toBe('architect');
    expect(sr.timestamp).toBeDefined();
    expect(typeof sr.timestamp).toBe('string');

    // Verify the chip message-level fields
    expect(chip.content).toBe('Discovery Framing complete.');
    expect(chip.role).toBe('assistant');
    expect(chip.taskId).toBe('architect--discovery-framing');
  });

  // ========================================================================
  // Gap Fill Test 8: Applications present but empty appComponents
  // ========================================================================
  it('should pass empty appComponents array to save_project_anchor_entities when appComponents is empty', async () => {
    const threadKey: ThreadKey = {
      type: 'hub',
      projectId: 'df-save-8-' + uuidv4().slice(0, 8),
    };
    await seedThread(threadKey);

    const structuredDataNoComponents = {
      summary: 'Apps only, no components.',
      applications: [
        { name: 'SoloApp', description: 'Application without components' },
      ],
      appComponents: [],
      repos: [
        { url: 'https://github.com/org/solo', branch: 'main', includePaths: [], excludePaths: [] },
      ],
      repoApplicationMappings: [],
      techHints: [],
      exclusions: [],
      notes: [],
    };

    mockAllSavesSucceed(threadKey.projectId!);

    const res = await request(app)
      .post('/api/chat/v2/save-artifact')
      .send({
        threadKey,
        taskId: 'architect--discovery-framing',
        artifactId: 'discovery-framing',
        content: buildSaveContent(structuredDataNoComponents, '# Brief\n'),
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Save 1 should still be called with empty appComponents
    const call1Args = mockExecuteToolCall.mock.calls[0];
    expect(call1Args[1]).toBe('save_project_anchor_entities');
    expect(call1Args[2].applications).toEqual([
      { name: 'SoloApp', description: 'Application without components' },
    ]);
    expect(call1Args[2].appComponents).toEqual([]);

    // All three saves should complete
    expect(mockExecuteToolCall).toHaveBeenCalledTimes(3);
  });
});
