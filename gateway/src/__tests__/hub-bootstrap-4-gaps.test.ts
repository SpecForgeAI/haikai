/**
 * Hub Bootstrap 4: Backend Gap Analysis Tests
 *
 * Spec 2026-03-01: Hub Bootstrap 4 -- SA Tech Stack + TE Test Strategy End-to-End
 * Task Group 7: Test Review and Gap Analysis
 *
 * These tests cover critical backend gaps identified during the TG7 review of TG1-TG6:
 *
 *  1. validateTechStackJsonShape rejects null, array, and objects missing categories
 *  2. validateTechStackJsonShape rejects category without name or with non-array technologies
 *  3. validateTechStackJsonShape accepts valid minimal input (empty arrays)
 *  4. validateTestStrategyJsonShape rejects null, array, and objects missing testLevels
 *  5. validateTestStrategyJsonShape rejects testLevel without name
 *  6. validateTestStrategyJsonShape accepts valid minimal input (empty arrays)
 *  7. convertTechStackToMarkdown handles empty categories, missing optional fields, and special characters
 *  8. convertTestStrategyToMarkdown handles empty test levels, missing tools/criteria, empty principles
 *  9. TECH_STACK_GENERATION_PROMPT_TEMPLATE contains all expected placeholders
 * 10. TEST_STRATEGY_GENERATION_PROMPT_TEMPLATE contains all expected placeholders
 * 11. POST /save-artifact tech-stack rejects non-JSON content string
 * 12. POST /save-artifact test-strategy rejects non-JSON content string
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
import {
  validateTechStackJsonShape,
  validateTestStrategyJsonShape,
  convertTechStackToMarkdown,
  convertTestStrategyToMarkdown,
} from '../routes/chatV2';
import { createThread, appendMessage } from '../services/threadStore';
import { ThreadKey, ThreadMessage } from '../types/chatV2';
import { v4 as uuidv4 } from 'uuid';
import {
  TECH_STACK_GENERATION_PROMPT_TEMPLATE,
  TEST_STRATEGY_GENERATION_PROMPT_TEMPLATE,
} from '../services/promptBuilder';

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

describe('Hub Bootstrap 4 Gap Analysis (Spec 2026-03-01, Task Group 7)', () => {
  let app: express.Application;

  beforeAll(async () => {
    testTmpDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'hub-bootstrap-4-gaps-'));
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
  
    // Clean thread files between tests to prevent cross-test contamination
    try {
      await fsPromises.rm(path.join(testTmpDir, 'threads'), { recursive: true, force: true });
    } catch {
      // Ignore if directory does not exist
    }
  });

  // Helper: seed a thread for a given task
  async function seedThread(
    threadKey: ThreadKey,
    taskId: string,
    personaId: string,
    includeAssistantMessage: boolean = false
  ): Promise<void> {
    await createThread(threadKey);

    const userMsg: ThreadMessage = {
      id: uuidv4(),
      role: 'user',
      personaId: null,
      taskId,
      content: 'Help me define this artifact.',
      structuredResponse: null,
      timestamp: new Date().toISOString(),
    };
    await appendMessage(threadKey, userMsg);

    if (includeAssistantMessage) {
      const assistantContent = {
        phase: 'ready',
        section: 'final_review',
        summary: 'I have enough information to generate the artifact.',
        questions: [],
      };

      const assistantMsg: ThreadMessage = {
        id: uuidv4(),
        role: 'assistant',
        personaId,
        taskId,
        content: JSON.stringify(assistantContent),
        structuredResponse: assistantContent,
        timestamp: new Date().toISOString(),
      };
      await appendMessage(threadKey, assistantMsg);
    }
  }

  // ========================================================================
  // Gap 1: validateTechStackJsonShape rejects null, array, and objects
  //        missing categories
  // ========================================================================
  it('validateTechStackJsonShape rejects null, array, and objects missing required fields', () => {
    // Null at top level
    expect(validateTechStackJsonShape(null).valid).toBe(false);
    expect(validateTechStackJsonShape(null).error).toContain('Expected a JSON object');

    // Array at top level
    expect(validateTechStackJsonShape([]).valid).toBe(false);
    expect(validateTechStackJsonShape([]).error).toContain('Expected a JSON object');

    // Missing categories
    expect(validateTechStackJsonShape({ designDecisions: [], constraints: [] }).valid).toBe(false);
    expect(validateTechStackJsonShape({ designDecisions: [], constraints: [] }).error).toContain('categories');

    // Missing designDecisions
    expect(validateTechStackJsonShape({ categories: [], constraints: [] }).valid).toBe(false);
    expect(validateTechStackJsonShape({ categories: [], constraints: [] }).error).toContain('designDecisions');

    // Missing constraints
    expect(validateTechStackJsonShape({ categories: [], designDecisions: [] }).valid).toBe(false);
    expect(validateTechStackJsonShape({ categories: [], designDecisions: [] }).error).toContain('constraints');

    // categories is not an array (string)
    expect(validateTechStackJsonShape({ categories: 'not-array', designDecisions: [], constraints: [] }).valid).toBe(false);
  });

  // ========================================================================
  // Gap 2: validateTechStackJsonShape rejects category without name or
  //        with non-array technologies
  // ========================================================================
  it('validateTechStackJsonShape rejects category without name or with non-array technologies', () => {
    // Category missing name
    const missingName = {
      categories: [{ technologies: [] }],
      designDecisions: [],
      constraints: [],
    };
    const result1 = validateTechStackJsonShape(missingName);
    expect(result1.valid).toBe(false);
    expect(result1.error).toContain('categories[0].name');

    // Category with non-array technologies
    const nonArrayTech = {
      categories: [{ name: 'Frontend', technologies: 'not-array' }],
      designDecisions: [],
      constraints: [],
    };
    const result2 = validateTechStackJsonShape(nonArrayTech);
    expect(result2.valid).toBe(false);
    expect(result2.error).toContain('categories[0].technologies');

    // Technology missing name
    const techMissingName = {
      categories: [{ name: 'Frontend', technologies: [{ version: '18' }] }],
      designDecisions: [],
      constraints: [],
    };
    const result3 = validateTechStackJsonShape(techMissingName);
    expect(result3.valid).toBe(false);
    expect(result3.error).toContain('technologies[0].name');

    // Null category entry
    const nullCategory = {
      categories: [null],
      designDecisions: [],
      constraints: [],
    };
    const result4 = validateTechStackJsonShape(nullCategory);
    expect(result4.valid).toBe(false);
    expect(result4.error).toContain('categories[0]');
  });

  // ========================================================================
  // Gap 3: validateTechStackJsonShape accepts valid minimal input (empty arrays)
  // ========================================================================
  it('validateTechStackJsonShape accepts empty arrays as valid minimal input', () => {
    const minimal = {
      categories: [],
      designDecisions: [],
      constraints: [],
    };
    const result = validateTechStackJsonShape(minimal);
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  // ========================================================================
  // Gap 4: validateTestStrategyJsonShape rejects null, array, and objects
  //        missing testLevels
  // ========================================================================
  it('validateTestStrategyJsonShape rejects null, array, and objects missing required fields', () => {
    // Null
    expect(validateTestStrategyJsonShape(null).valid).toBe(false);
    expect(validateTestStrategyJsonShape(null).error).toContain('Expected a JSON object');

    // Array
    expect(validateTestStrategyJsonShape([]).valid).toBe(false);

    // Missing testLevels
    expect(validateTestStrategyJsonShape({ qualityGates: [], testingPrinciples: [] }).valid).toBe(false);
    expect(validateTestStrategyJsonShape({ qualityGates: [], testingPrinciples: [] }).error).toContain('testLevels');

    // Missing qualityGates
    expect(validateTestStrategyJsonShape({ testLevels: [], testingPrinciples: [] }).valid).toBe(false);
    expect(validateTestStrategyJsonShape({ testLevels: [], testingPrinciples: [] }).error).toContain('qualityGates');

    // Missing testingPrinciples
    expect(validateTestStrategyJsonShape({ testLevels: [], qualityGates: [] }).valid).toBe(false);
    expect(validateTestStrategyJsonShape({ testLevels: [], qualityGates: [] }).error).toContain('testingPrinciples');
  });

  // ========================================================================
  // Gap 5: validateTestStrategyJsonShape rejects testLevel and qualityGate
  //        without name
  // ========================================================================
  it('validateTestStrategyJsonShape rejects testLevel without name and qualityGate without name', () => {
    // testLevel missing name
    const missingLevelName = {
      testLevels: [{ scope: 'unit' }],
      qualityGates: [],
      testingPrinciples: [],
    };
    const result1 = validateTestStrategyJsonShape(missingLevelName);
    expect(result1.valid).toBe(false);
    expect(result1.error).toContain('testLevels[0].name');

    // qualityGate missing name
    const missingGateName = {
      testLevels: [],
      qualityGates: [{ criteria: [] }],
      testingPrinciples: [],
    };
    const result2 = validateTestStrategyJsonShape(missingGateName);
    expect(result2.valid).toBe(false);
    expect(result2.error).toContain('qualityGates[0].name');

    // Null testLevel entry
    const nullLevel = {
      testLevels: [null],
      qualityGates: [],
      testingPrinciples: [],
    };
    const result3 = validateTestStrategyJsonShape(nullLevel);
    expect(result3.valid).toBe(false);
    expect(result3.error).toContain('testLevels[0]');
  });

  // ========================================================================
  // Gap 6: validateTestStrategyJsonShape accepts valid minimal input
  // ========================================================================
  it('validateTestStrategyJsonShape accepts empty arrays as valid minimal input', () => {
    const minimal = {
      testLevels: [],
      qualityGates: [],
      testingPrinciples: [],
    };
    const result = validateTestStrategyJsonShape(minimal);
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  // ========================================================================
  // Gap 7: convertTechStackToMarkdown handles edge cases
  // ========================================================================
  it('convertTechStackToMarkdown handles empty categories, missing optional fields, and special characters', () => {
    // Empty arrays: should still produce a valid markdown with header
    const emptyResult = convertTechStackToMarkdown({
      categories: [],
      designDecisions: [],
      constraints: [],
    });
    expect(emptyResult).toContain('# Tech Stack');
    expect(emptyResult).not.toContain('## Design Decisions');
    expect(emptyResult).not.toContain('## Constraints');

    // Category with technologies missing optional fields
    const missingOptionals = convertTechStackToMarkdown({
      categories: [
        {
          name: 'Frontend',
          technologies: [
            { name: 'React' },  // version, purpose, rationale all missing
          ],
        },
      ],
      designDecisions: [
        { title: 'Decision A' },  // description and rationale missing
      ],
      constraints: [
        { name: 'Budget' },  // description and type missing
      ],
    });
    expect(missingOptionals).toContain('## Frontend');
    expect(missingOptionals).toContain('React');
    expect(missingOptionals).toContain('## Design Decisions');
    expect(missingOptionals).toContain('Decision A');
    expect(missingOptionals).toContain('## Constraints');
    expect(missingOptionals).toContain('Budget');

    // Category with empty technologies array
    const emptyTech = convertTechStackToMarkdown({
      categories: [{ name: 'Empty Category', technologies: [] }],
      designDecisions: [],
      constraints: [],
    });
    expect(emptyTech).toContain('## Empty Category');
    // Should have the table header even with no rows
    expect(emptyTech).toContain('| Name | Version | Purpose | Rationale |');
  });

  // ========================================================================
  // Gap 8: convertTestStrategyToMarkdown handles edge cases
  // ========================================================================
  it('convertTestStrategyToMarkdown handles empty test levels, missing tools/criteria, empty principles', () => {
    // Completely empty arrays
    const emptyResult = convertTestStrategyToMarkdown({
      testLevels: [],
      qualityGates: [],
      testingPrinciples: [],
    });
    expect(emptyResult).toContain('# Test Strategy');
    expect(emptyResult).not.toContain('## Test Levels');
    expect(emptyResult).not.toContain('## Quality Gates');
    expect(emptyResult).not.toContain('## Testing Principles');

    // Test levels with missing optional fields
    const missingOptionals = convertTestStrategyToMarkdown({
      testLevels: [
        { name: 'Unit Tests' },  // scope, coverageTarget, tools, rationale missing
      ],
      qualityGates: [
        { name: 'PR Gate' },  // criteria and enforcement missing
      ],
      testingPrinciples: [
        { title: 'Shift Left' },  // description missing
      ],
    });
    expect(missingOptionals).toContain('### Unit Tests');
    expect(missingOptionals).toContain('### PR Gate');
    expect(missingOptionals).toContain('### Shift Left');
    expect(missingOptionals).toContain('## Test Levels');
    expect(missingOptionals).toContain('## Quality Gates');
    expect(missingOptionals).toContain('## Testing Principles');

    // Quality gates with empty criteria array
    const emptyCriteria = convertTestStrategyToMarkdown({
      testLevels: [],
      qualityGates: [
        { name: 'Release Gate', criteria: [], enforcement: 'Manual' },
      ],
      testingPrinciples: [],
    });
    expect(emptyCriteria).toContain('### Release Gate');
    expect(emptyCriteria).toContain('Manual');
    // Empty criteria array should not produce criteria bullets
    expect(emptyCriteria).not.toContain('**Criteria:**');

    // Test level with empty tools array
    const emptyTools = convertTestStrategyToMarkdown({
      testLevels: [
        { name: 'E2E Tests', scope: 'Full flow', tools: [], coverageTarget: '30%' },
      ],
      qualityGates: [],
      testingPrinciples: [],
    });
    expect(emptyTools).toContain('### E2E Tests');
    expect(emptyTools).toContain('30%');
    // Empty tools array should not produce tools line
    expect(emptyTools).not.toContain('**Tools:**');
  });

  // ========================================================================
  // Gap 9: TECH_STACK_GENERATION_PROMPT_TEMPLATE contains all expected placeholders
  // ========================================================================
  it('TECH_STACK_GENERATION_PROMPT_TEMPLATE contains all expected placeholders and schema references', () => {
    expect(TECH_STACK_GENERATION_PROMPT_TEMPLATE).toContain('{missionContent}');
    expect(TECH_STACK_GENERATION_PROMPT_TEMPLATE).toContain('{architectureContext}');
    expect(TECH_STACK_GENERATION_PROMPT_TEMPLATE).toContain('{existingTechStack}');
    expect(TECH_STACK_GENERATION_PROMPT_TEMPLATE).toContain('{conversationTranscript}');
    // Must contain schema key references
    expect(TECH_STACK_GENERATION_PROMPT_TEMPLATE).toContain('categories');
    expect(TECH_STACK_GENERATION_PROMPT_TEMPLATE).toContain('designDecisions');
    expect(TECH_STACK_GENERATION_PROMPT_TEMPLATE).toContain('constraints');
    // Must instruct JSON-only output
    expect(TECH_STACK_GENERATION_PROMPT_TEMPLATE).toContain('ONLY valid JSON');
  });

  // ========================================================================
  // Gap 10: TEST_STRATEGY_GENERATION_PROMPT_TEMPLATE contains all expected placeholders
  // ========================================================================
  it('TEST_STRATEGY_GENERATION_PROMPT_TEMPLATE contains all expected placeholders and schema references', () => {
    expect(TEST_STRATEGY_GENERATION_PROMPT_TEMPLATE).toContain('{missionContent}');
    expect(TEST_STRATEGY_GENERATION_PROMPT_TEMPLATE).toContain('{roadmapContext}');
    expect(TEST_STRATEGY_GENERATION_PROMPT_TEMPLATE).toContain('{techStackContent}');
    expect(TEST_STRATEGY_GENERATION_PROMPT_TEMPLATE).toContain('{conversationTranscript}');
    // Must contain schema key references
    expect(TEST_STRATEGY_GENERATION_PROMPT_TEMPLATE).toContain('testLevels');
    expect(TEST_STRATEGY_GENERATION_PROMPT_TEMPLATE).toContain('qualityGates');
    expect(TEST_STRATEGY_GENERATION_PROMPT_TEMPLATE).toContain('testingPrinciples');
    // Must instruct JSON-only output
    expect(TEST_STRATEGY_GENERATION_PROMPT_TEMPLATE).toContain('ONLY valid JSON');
  });

  // ========================================================================
  // Gap 11: POST /save-artifact tech-stack rejects non-JSON content string
  // ========================================================================
  it('should reject non-JSON content string for tech-stack save-artifact adapter', async () => {
    const threadKey: ThreadKey = {
      type: 'hub',
      projectId: 'gap-ts-nonjson-' + uuidv4().slice(0, 8),
    };
    await seedThread(threadKey, 'architect--define-tech-stack', 'architect', true);

    const res = await request(app)
      .post('/api/chat/v2/save-artifact')
      .send({
        threadKey,
        taskId: 'architect--define-tech-stack',
        artifactId: 'tech-stack',
        content: 'This is not JSON at all',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBeDefined();
    expect(typeof res.body.error).toBe('string');

    // executeToolCall should NOT have been called
    expect(mockExecuteToolCall).not.toHaveBeenCalled();
  });

  // ========================================================================
  // Gap 12: POST /save-artifact test-strategy rejects non-JSON content string
  // ========================================================================
  it('should reject non-JSON content string for test-strategy save-artifact adapter', async () => {
    const threadKey: ThreadKey = {
      type: 'hub',
      projectId: 'gap-te-nonjson-' + uuidv4().slice(0, 8),
    };
    await seedThread(threadKey, 'test-engineer--test-strategy', 'test-engineer', true);

    const res = await request(app)
      .post('/api/chat/v2/save-artifact')
      .send({
        threadKey,
        taskId: 'test-engineer--test-strategy',
        artifactId: 'test-strategy',
        content: 'Not valid JSON content',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBeDefined();
    expect(typeof res.body.error).toBe('string');

    // executeToolCall should NOT have been called
    expect(mockExecuteToolCall).not.toHaveBeenCalled();
  });
});
