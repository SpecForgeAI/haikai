/**
 * End-to-End Integration Test: XLSX Upload through ChatV2
 *
 * Spec 2026-04-03: UX Designer XLSX Ingestion for User Journeys
 * Task Group 4: Test Review and Gap Analysis
 *
 * Integration test verifying the full POST flow: a real XLSX workbook
 * attachment in the request body is parsed by the real parser module and
 * results in text/plain CSV-text content reaching the LLM.
 *
 * Unlike the intercept tests (Task Group 2), this test does NOT mock the
 * parser module -- it uses the real xlsxUserJourneyParser to verify
 * end-to-end correctness.
 */

import path from 'path';
import os from 'os';
import { promises as fs } from 'fs';
import * as XLSX from 'xlsx';

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

// ---- Mock getLlmClient ----
const mockSendChatRequest = jest.fn();
jest.mock('../services/llmClient', () => ({
  getLlmClient: () => ({
    sendChatRequest: (...args: unknown[]) => mockSendChatRequest(...args),
  }),
}));

// NOTE: xlsxUserJourneyParser is NOT mocked -- this is a real integration test

// ---- Imports (after mocks) ----
import express from 'express';
import request from 'supertest';
import { initializeRegistries } from '../services/registryLoader';
import { chatV2Router } from '../routes/chatV2';

function createTestApp() {
  const app = express();
  app.use(express.json({ limit: '30mb' }));
  app.use((req, _res, next) => {
    req.requestId = 'xlsx-e2e-test-request-id';
    next();
  });
  app.use('/api/chat/v2', chatV2Router);
  return app;
}

/**
 * Create a realistic XLSX workbook with all three required worksheets and sample data.
 */
function createRealisticWorkbookBase64(): string {
  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Activity Name', 'Parent Business Process', 'Activity Description'],
    ['User Login', 'Authentication', 'User authenticates with credentials'],
    ['Browse Products', 'Shopping', 'User browses product catalog'],
  ]), 'Process Activities');

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['User Journey Name', 'User Journey Description'],
    ['New Customer Onboarding', 'End-to-end new customer registration and first purchase'],
  ]), 'User Journeys');

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['User Journey Name', 'Activity Name', 'Business User Role', 'Application', 'Activity Step Name', 'Activity Step Diagram Label', 'Activity Step Order'],
    ['New Customer Onboarding', 'User Login', 'New Customer', 'Web Portal', 'Login Step', 'Login', '1'],
    ['New Customer Onboarding', 'Browse Products', 'New Customer', 'E-Commerce App', 'Browse Step', 'Browse', '2'],
  ]), 'Activity Steps');

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  return Buffer.from(buffer).toString('base64');
}

describe('ChatV2 XLSX End-to-End Integration (Spec 2026-04-03, Task Group 4)', () => {
  let app: express.Application;

  beforeAll(async () => {
    testTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chatv2-xlsx-e2e-'));
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
    try {
      await fs.rm(path.join(testTmpDir, 'threads'), { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  // --------------------------------------------------------------------------
  // E2E Test: Real XLSX workbook parsed and CSV-text reaches LLM
  // --------------------------------------------------------------------------
  it('should parse a real XLSX workbook and deliver delimited CSV-text to the LLM', async () => {
    const xlsxBase64 = createRealisticWorkbookBase64();

    mockSendChatRequest.mockResolvedValueOnce({
      id: 'e2e-resp',
      content: 'I have processed your user journey data.',
      isFinal: true,
    });

    const res = await request(app)
      .post('/api/chat/v2')
      .send({
        threadKey: { type: 'hub', projectId: 'e2e-test-project' },
        personaId: 'ux-designer',
        taskId: 'ux-designer--users-interactions',
        message: 'Please process this workbook',
        files: [
          {
            filename: 'user-journeys.xlsx',
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            base64: xlsxBase64,
          },
        ],
      })
      .expect(200);

    // LLM was called
    expect(mockSendChatRequest).toHaveBeenCalledTimes(1);

    // Inspect the messages sent to the LLM
    const llmMessages = mockSendChatRequest.mock.calls[0][0];
    const userMessage = llmMessages[llmMessages.length - 1];

    // Should have content parts (array) because files were present
    expect(Array.isArray(userMessage.content)).toBe(true);

    // Extract all text content from the user message parts
    const textParts = userMessage.content
      .filter((p: { type: string }) => p.type === 'text')
      .map((p: { text: string }) => p.text);
    const allText = textParts.join('\n');

    // Verify delimited CSV-text blocks are present in correct order
    expect(allText).toContain('--- Worksheet: Process Activities ---');
    expect(allText).toContain('User Login,Authentication,User authenticates with credentials');
    expect(allText).toContain('--- End Worksheet: Process Activities ---');

    expect(allText).toContain('--- Worksheet: User Journeys ---');
    expect(allText).toContain('New Customer Onboarding');
    expect(allText).toContain('--- End Worksheet: User Journeys ---');

    expect(allText).toContain('--- Worksheet: Activity Steps ---');
    expect(allText).toContain('New Customer Onboarding,User Login,New Customer,Web Portal,Login Step,Login,1');
    expect(allText).toContain('--- End Worksheet: Activity Steps ---');

    // Verify order
    const paIndex = allText.indexOf('--- Worksheet: Process Activities ---');
    const ujIndex = allText.indexOf('--- Worksheet: User Journeys ---');
    const asIndex = allText.indexOf('--- Worksheet: Activity Steps ---');
    expect(paIndex).toBeLessThan(ujIndex);
    expect(ujIndex).toBeLessThan(asIndex);

    expect(res.body.assistant.message).toBe('I have processed your user journey data.');
  });

  // --------------------------------------------------------------------------
  // E2E Test: Invalid real workbook returns 400
  // --------------------------------------------------------------------------
  it('should return HTTP 400 when a real XLSX workbook is missing a required worksheet', async () => {
    // Create workbook missing "Activity Steps"
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['Activity Name', 'Parent Business Process'],
      ['Login', 'Auth'],
    ]), 'Process Activities');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['User Journey Name'],
      ['Onboarding'],
    ]), 'User Journeys');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const invalidBase64 = Buffer.from(buffer).toString('base64');

    const res = await request(app)
      .post('/api/chat/v2')
      .send({
        threadKey: { type: 'hub', projectId: 'e2e-invalid-project' },
        personaId: 'ux-designer',
        taskId: 'ux-designer--users-interactions',
        message: 'Process this workbook',
        files: [
          {
            filename: 'incomplete.xlsx',
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            base64: invalidBase64,
          },
        ],
      })
      .expect(400);

    expect(res.body.error).toContain('Activity Steps');
    expect(res.body.error).toContain('missing required worksheet');

    // LLM should NOT have been called
    expect(mockSendChatRequest).not.toHaveBeenCalled();
  });
});
