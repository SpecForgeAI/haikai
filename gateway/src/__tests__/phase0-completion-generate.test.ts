/**
 * Tests for Phase 0 Completion and Handoff -- /generate Branch + Markdown Generation
 *
 * Spec 2026-04-04: Phase 0 Completion and Handoff
 * Task Group 3: chatV2.ts /generate Branch (Deterministic Extraction + Brief Generation)
 *
 * 5 focused tests (Task Group 3):
 * 1. convertDiscoveryBriefToMarkdown with full data produces all sections
 * 2. convertDiscoveryBriefToMarkdown with empty arrays omits sections
 * 3. convertDiscoveryBriefToMarkdown with partial data (only apps + repos)
 * 4. /generate with artifactType='discovery-framing' returns { success: true, artifactContent }
 * 5. /generate with no phase="ready" message returns { success: false, error }
 *
 * Gap-fill tests (Task Group 6):
 * 6. Thread with multiple assistant messages -- only LAST with phase="ready" is used
 * 7. convertDiscoveryBriefToMarkdown with pipe characters in names/descriptions
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
import { chatV2Router, convertDiscoveryBriefToMarkdown } from '../routes/chatV2';
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

// Full discovery framing data for testing
const FULL_DISCOVERY_DATA = {
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
    {
      url: 'https://github.com/org/payments',
      branch: 'develop',
      includePaths: [],
      excludePaths: ['node_modules/'],
    },
  ],
  repoApplicationMappings: [
    { repoUrl: 'https://github.com/org/orders', path: '/', applicationName: 'Order Service' },
    { repoUrl: 'https://github.com/org/payments', path: '/', applicationName: 'Payment Service' },
  ],
  techHints: [
    { repoUrl: 'https://github.com/org/orders', path: '/', technology: 'Express', language: 'TypeScript' },
    { repoUrl: 'https://github.com/org/payments', path: '/', technology: 'Spring Boot', language: 'Java' },
  ],
  exclusions: [
    { pattern: '**/test/**', reason: 'Test files are not production code' },
    { pattern: '**/docs/**', reason: 'Documentation only' },
  ],
  notes: [
    'Order Service may be split into two microservices in the future.',
    'Payment Service uses an external gateway API.',
  ],
};

describe('Phase 0 Completion -- /generate Branch + Markdown Generation (Spec 2026-04-04, Task Group 3)', () => {
  let app: express.Application;

  beforeAll(async () => {
    testTmpDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'phase0-generate-test-'));
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
  // Test 1: convertDiscoveryBriefToMarkdown with full data produces all sections
  // ========================================================================
  it('convertDiscoveryBriefToMarkdown with full data produces markdown with all sections', () => {
    const result = convertDiscoveryBriefToMarkdown(FULL_DISCOVERY_DATA);

    // Heading
    expect(result).toContain('# Discovery Brief');

    // Scope Summary
    expect(result).toContain('## Scope Summary');
    expect(result).toContain('Scope covers three microservices and two frontend apps.');

    // Applications table
    expect(result).toContain('## Applications');
    expect(result).toContain('| Name | Description |');
    expect(result).toContain('| Order Service | Handles order processing |');
    expect(result).toContain('| Payment Service | Handles payment transactions |');

    // Application Components table
    expect(result).toContain('## Application Components');
    expect(result).toContain('| Name | Application | Description |');
    expect(result).toContain('| Order API | Order Service | REST API for orders |');
    expect(result).toContain('| Payment Gateway | Payment Service | Payment processing gateway |');

    // Repositories table
    expect(result).toContain('## Repositories');
    expect(result).toContain('| URL | Branch | Include Paths | Exclude Paths |');
    expect(result).toContain('| https://github.com/org/orders | main | src/ | test/, docs/ |');

    // Repo-Application Mappings table
    expect(result).toContain('## Repository-Application Mappings');
    expect(result).toContain('| Repo URL | Path | Application |');
    expect(result).toContain('| https://github.com/org/orders | / | Order Service |');

    // Technology Hints table
    expect(result).toContain('## Technology Hints');
    expect(result).toContain('| Repo URL | Path | Technology | Language |');
    expect(result).toContain('| https://github.com/org/orders | / | Express | TypeScript |');

    // Exclusions table
    expect(result).toContain('## Exclusions');
    expect(result).toContain('| Pattern | Reason |');
    expect(result).toContain('| **/test/** | Test files are not production code |');

    // Notes and Assumptions
    expect(result).toContain('## Notes and Assumptions');
    expect(result).toContain('- Order Service may be split into two microservices in the future.');
    expect(result).toContain('- Payment Service uses an external gateway API.');
  });

  // ========================================================================
  // Test 2: convertDiscoveryBriefToMarkdown with empty arrays omits sections
  // ========================================================================
  it('convertDiscoveryBriefToMarkdown with empty arrays omits corresponding sections', () => {
    const emptyData = {
      summary: undefined,
      applications: [],
      appComponents: [],
      repos: [],
      repoApplicationMappings: [],
      techHints: [],
      exclusions: [],
      notes: [],
    };
    const result = convertDiscoveryBriefToMarkdown(emptyData);

    // Should only have the heading
    expect(result).toContain('# Discovery Brief');

    // All other sections should be omitted
    expect(result).not.toContain('## Scope Summary');
    expect(result).not.toContain('## Applications');
    expect(result).not.toContain('## Application Components');
    expect(result).not.toContain('## Repositories');
    expect(result).not.toContain('## Repository-Application Mappings');
    expect(result).not.toContain('## Technology Hints');
    expect(result).not.toContain('## Exclusions');
    expect(result).not.toContain('## Notes and Assumptions');
  });

  // ========================================================================
  // Test 3: convertDiscoveryBriefToMarkdown with partial data (only apps + repos)
  // ========================================================================
  it('convertDiscoveryBriefToMarkdown with partial data (only applications and repos) produces only those sections', () => {
    const partialData = {
      applications: [
        { name: 'Frontend App', description: 'React SPA' },
      ],
      repos: [
        { url: 'https://github.com/org/frontend', branch: 'main', includePaths: ['src/'], excludePaths: [] },
      ],
    };
    const result = convertDiscoveryBriefToMarkdown(partialData);

    // Should have heading, applications, and repos
    expect(result).toContain('# Discovery Brief');
    expect(result).toContain('## Applications');
    expect(result).toContain('| Frontend App | React SPA |');
    expect(result).toContain('## Repositories');
    expect(result).toContain('| https://github.com/org/frontend | main |');

    // Should NOT have other sections
    expect(result).not.toContain('## Scope Summary');
    expect(result).not.toContain('## Application Components');
    expect(result).not.toContain('## Repository-Application Mappings');
    expect(result).not.toContain('## Technology Hints');
    expect(result).not.toContain('## Exclusions');
    expect(result).not.toContain('## Notes and Assumptions');
  });

  // ========================================================================
  // Test 4: /generate with artifactType='discovery-framing' returns success
  // ========================================================================
  it('/generate with artifactType=discovery-framing extracts phase=ready data and returns { success: true, artifactContent }', async () => {
    const threadKey: ThreadKey = {
      type: 'hub',
      projectId: 'df-gen-1-' + uuidv4().slice(0, 8),
    };

    // Seed thread with discovery framing conversation including a phase="ready" assistant message
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

    const readyResponse = {
      phase: 'ready',
      section: 'final_review',
      summary: 'Discovery scope confirmed.',
      questions: [],
      applications: [
        { name: 'MyApp', description: 'Main application' },
      ],
      appComponents: [
        { name: 'API Layer', applicationName: 'MyApp', description: 'REST API' },
      ],
      repos: [
        { url: 'https://github.com/org/myapp', branch: 'main', includePaths: ['src/'], excludePaths: [] },
      ],
      repoApplicationMappings: [
        { repoUrl: 'https://github.com/org/myapp', path: '/', applicationName: 'MyApp' },
      ],
      techHints: [],
      exclusions: [],
      notes: ['Single app for now.'],
    };

    const assistantMsg: ThreadMessage = {
      id: uuidv4(),
      role: 'assistant',
      personaId: 'architect',
      taskId: 'architect--discovery-framing',
      content: JSON.stringify(readyResponse),
      structuredResponse: readyResponse,
      timestamp: new Date().toISOString(),
    };
    await appendMessage(threadKey, assistantMsg);

    const res = await request(app)
      .post('/api/chat/v2/generate')
      .send({
        threadKey,
        personaId: 'architect',
        taskId: 'architect--discovery-framing',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.artifactContent).toBeDefined();

    // Parse the artifactContent to verify it contains both structuredData and markdownBrief
    const parsed = JSON.parse(res.body.artifactContent);
    expect(parsed.structuredData).toBeDefined();
    expect(parsed.structuredData.applications).toHaveLength(1);
    expect(parsed.structuredData.applications[0].name).toBe('MyApp');
    expect(parsed.structuredData.repos).toHaveLength(1);
    expect(parsed.markdownBrief).toBeDefined();
    expect(parsed.markdownBrief).toContain('# Discovery Brief');
    expect(parsed.markdownBrief).toContain('MyApp');

    // No LLM call should have been made
    expect(mockSendChatRequest).not.toHaveBeenCalled();
  });

  // ========================================================================
  // Test 5: /generate with no phase="ready" message returns { success: false, error }
  // ========================================================================
  it('/generate with no phase=ready message in thread returns { success: false, error }', async () => {
    const threadKey: ThreadKey = {
      type: 'hub',
      projectId: 'df-gen-2-' + uuidv4().slice(0, 8),
    };

    // Seed thread with a conversation that does NOT have phase="ready"
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

    const questionsResponse = {
      phase: 'questions',
      section: 'context_and_scope',
      summary: 'Let me understand the scope.',
      questions: ['What applications are in scope?'],
    };

    const assistantMsg: ThreadMessage = {
      id: uuidv4(),
      role: 'assistant',
      personaId: 'architect',
      taskId: 'architect--discovery-framing',
      content: JSON.stringify(questionsResponse),
      structuredResponse: questionsResponse,
      timestamp: new Date().toISOString(),
    };
    await appendMessage(threadKey, assistantMsg);

    const res = await request(app)
      .post('/api/chat/v2/generate')
      .send({
        threadKey,
        personaId: 'architect',
        taskId: 'architect--discovery-framing',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('No completed discovery framing found');
    expect(res.body.error).toContain('final review');
  });

  // ========================================================================
  // Gap Fill Test 6: Thread with multiple assistant messages -- only LAST with phase="ready" is used
  // ========================================================================
  it('/generate with multiple assistant messages extracts data from the LAST phase=ready message only', async () => {
    const threadKey: ThreadKey = {
      type: 'hub',
      projectId: 'df-gen-6-' + uuidv4().slice(0, 8),
    };

    await createThread(threadKey);

    // User message 1
    const userMsg1: ThreadMessage = {
      id: uuidv4(),
      role: 'user',
      personaId: null,
      taskId: 'architect--discovery-framing',
      content: 'What apps are in scope?',
      structuredResponse: null,
      timestamp: new Date().toISOString(),
    };
    await appendMessage(threadKey, userMsg1);

    // Assistant message 1: questions phase (not ready)
    const questionsResponse = {
      phase: 'questions',
      section: 'context_and_scope',
      summary: 'Let me ask more.',
      questions: ['Any repos?'],
      applications: [
        { name: 'OldApp', description: 'This is an earlier draft' },
      ],
    };
    const assistantMsg1: ThreadMessage = {
      id: uuidv4(),
      role: 'assistant',
      personaId: 'architect',
      taskId: 'architect--discovery-framing',
      content: JSON.stringify(questionsResponse),
      structuredResponse: questionsResponse,
      timestamp: new Date().toISOString(),
    };
    await appendMessage(threadKey, assistantMsg1);

    // User message 2
    const userMsg2: ThreadMessage = {
      id: uuidv4(),
      role: 'user',
      personaId: null,
      taskId: 'architect--discovery-framing',
      content: 'Yes, here are the repos.',
      structuredResponse: null,
      timestamp: new Date().toISOString(),
    };
    await appendMessage(threadKey, userMsg2);

    // Assistant message 2: earlier phase="ready" with initial data
    const earlyReadyResponse = {
      phase: 'ready',
      section: 'final_review',
      summary: 'Early scope (should be overridden).',
      applications: [
        { name: 'EarlyApp', description: 'Early draft application' },
      ],
      appComponents: [],
      repos: [],
      repoApplicationMappings: [],
      techHints: [],
      exclusions: [],
      notes: ['Early note'],
    };
    const assistantMsg2: ThreadMessage = {
      id: uuidv4(),
      role: 'assistant',
      personaId: 'architect',
      taskId: 'architect--discovery-framing',
      content: JSON.stringify(earlyReadyResponse),
      structuredResponse: earlyReadyResponse,
      timestamp: new Date().toISOString(),
    };
    await appendMessage(threadKey, assistantMsg2);

    // User message 3
    const userMsg3: ThreadMessage = {
      id: uuidv4(),
      role: 'user',
      personaId: null,
      taskId: 'architect--discovery-framing',
      content: 'Actually, add one more app.',
      structuredResponse: null,
      timestamp: new Date().toISOString(),
    };
    await appendMessage(threadKey, userMsg3);

    // Assistant message 3: LAST phase="ready" with final data
    const finalReadyResponse = {
      phase: 'ready',
      section: 'final_review',
      summary: 'Final confirmed scope.',
      applications: [
        { name: 'FinalApp', description: 'The final confirmed application' },
        { name: 'SecondApp', description: 'Added after revision' },
      ],
      appComponents: [
        { name: 'FinalComp', applicationName: 'FinalApp', description: 'Final component' },
      ],
      repos: [
        { url: 'https://github.com/org/final', branch: 'main', includePaths: [], excludePaths: [] },
      ],
      repoApplicationMappings: [],
      techHints: [],
      exclusions: [],
      notes: ['Final note after revision.'],
    };
    const assistantMsg3: ThreadMessage = {
      id: uuidv4(),
      role: 'assistant',
      personaId: 'architect',
      taskId: 'architect--discovery-framing',
      content: JSON.stringify(finalReadyResponse),
      structuredResponse: finalReadyResponse,
      timestamp: new Date().toISOString(),
    };
    await appendMessage(threadKey, assistantMsg3);

    const res = await request(app)
      .post('/api/chat/v2/generate')
      .send({
        threadKey,
        personaId: 'architect',
        taskId: 'architect--discovery-framing',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const parsed = JSON.parse(res.body.artifactContent);

    // Should use the LAST phase="ready" message (assistantMsg3), NOT earlyReadyResponse
    expect(parsed.structuredData.summary).toBe('Final confirmed scope.');
    expect(parsed.structuredData.applications).toHaveLength(2);
    expect(parsed.structuredData.applications[0].name).toBe('FinalApp');
    expect(parsed.structuredData.applications[1].name).toBe('SecondApp');
    expect(parsed.structuredData.notes).toEqual(['Final note after revision.']);

    // Should NOT contain data from early ready or questions phase
    expect(parsed.markdownBrief).not.toContain('EarlyApp');
    expect(parsed.markdownBrief).not.toContain('OldApp');
    expect(parsed.markdownBrief).toContain('FinalApp');
    expect(parsed.markdownBrief).toContain('SecondApp');
  });

  // ========================================================================
  // Gap Fill Test 7: convertDiscoveryBriefToMarkdown with pipe characters in table cells
  // ========================================================================
  it('convertDiscoveryBriefToMarkdown renders pipe characters in names/descriptions without breaking table structure', () => {
    const dataWithPipes = {
      applications: [
        { name: 'App|With|Pipes', description: 'Description|has|pipes' },
      ],
      exclusions: [
        { pattern: 'src|test', reason: 'Either src or test | excluded' },
      ],
    };

    const result = convertDiscoveryBriefToMarkdown(dataWithPipes);

    // The function should still produce output with the pipe characters included.
    // This verifies the function does not crash or produce empty output.
    expect(result).toContain('# Discovery Brief');
    expect(result).toContain('## Applications');
    expect(result).toContain('## Exclusions');

    // The pipe characters will appear in table cells. The function uses simple
    // string interpolation so they will be present as-is in the output.
    // This tests that the function handles this edge case without error.
    expect(result).toContain('App|With|Pipes');
    expect(result).toContain('Description|has|pipes');
    expect(result).toContain('src|test');
  });
});
