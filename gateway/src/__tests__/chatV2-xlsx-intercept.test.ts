/**
 * Tests for ChatV2 XLSX Intercept Logic
 *
 * Spec 2026-04-03: UX Designer XLSX Ingestion for User Journeys
 * Task Group 2: ChatV2 XLSX Intercept
 *
 * 5 focused tests:
 * 1. POST with ux-designer--users-interactions and .xlsx triggers parsing and replaces attachment
 * 2. POST with ux-designer--users-interactions and .xlsm triggers parsing identically
 * 3. POST with a different taskId and .xlsx passes file through unchanged
 * 4. POST with ux-designer--users-interactions and invalid workbook returns 400
 * 5. POST with mixed files (.xlsx + .csv) parses .xlsx and passes .csv through
 *
 * Uses Jest with jest.mock() patterns consistent with existing chatV2 tests.
 * Mocks the parser module to isolate intercept logic from actual XLSX parsing.
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

// ---- Mock getLlmClient to intercept all LLM calls ----
const mockSendChatRequest = jest.fn();
jest.mock('../services/llmClient', () => ({
  getLlmClient: () => ({
    sendChatRequest: (...args: unknown[]) => mockSendChatRequest(...args),
  }),
}));

// ---- Mock the XLSX parser module ----
// Spread the actual module so other exports chatV2 imports
// (e.g. extractProcessActivitiesFromTranscript) keep working.
const mockParseUserJourneyWorkbook = jest.fn();
jest.mock('../services/xlsxUserJourneyParser', () => {
  const actual = jest.requireActual('../services/xlsxUserJourneyParser');
  return {
    ...actual,
    parseUserJourneyWorkbook: (...args: unknown[]) => mockParseUserJourneyWorkbook(...args),
  };
});

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
    req.requestId = 'xlsx-intercept-test-request-id';
    next();
  });
  app.use('/api/chat/v2', chatV2Router);
  return app;
}

describe('ChatV2 XLSX Intercept (Spec 2026-04-03, Task Group 2)', () => {
  let app: express.Application;

  // Fake base64 content (does not need to be valid XLSX since parser is mocked)
  const fakeXlsxBase64 = Buffer.from('fake-xlsx-content').toString('base64');
  const fakeCsvBase64 = Buffer.from('col1,col2\nval1,val2').toString('base64');

  // Mock CSV-text output from the parser
  const mockCsvText = [
    '--- Worksheet: Process Activities ---',
    'process_activity_name,business_process',
    'Login,Authentication',
    '--- End Worksheet: Process Activities ---',
    '--- Worksheet: User Journeys ---',
    'journey_name',
    'Customer Onboarding',
    '--- End Worksheet: User Journeys ---',
    '--- Worksheet: Activity Steps ---',
    'user_journey_name,process_activity_name,business_user_abbreviation,application_abbreviation,activity_step_name,diagram_label',
    'Customer Onboarding,Login,EU,WP,Login for EU in WP,Login',
    '--- End Worksheet: Activity Steps ---',
  ].join('\n');

  beforeAll(async () => {
    testTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chatv2-xlsx-test-'));
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
    mockParseUserJourneyWorkbook.mockReset();
    try {
      await fs.rm(path.join(testTmpDir, 'threads'), { recursive: true, force: true });
    } catch {
      // Ignore if directory doesn't exist
    }
  });

  // Helper: build a valid ChatV2Request body for ux-designer--users-interactions
  function uxDesignerRequest(overrides: Record<string, unknown> = {}) {
    return {
      threadKey: { type: 'hub', projectId: 'test-xlsx-project' },
      personaId: 'ux-designer',
      taskId: 'ux-designer--users-interactions',
      message: 'Here is my workbook',
      ...overrides,
    };
  }

  // --------------------------------------------------------------------------
  // Test 1: .xlsx file triggers parsing and replaces attachment
  // --------------------------------------------------------------------------
  it('should parse .xlsx file and replace binary attachment with text/plain CSV-text for ux-designer--users-interactions', async () => {
    mockParseUserJourneyWorkbook.mockReturnValue({
      success: true,
      csvText: mockCsvText,
    });

    mockSendChatRequest.mockResolvedValueOnce({
      id: 'resp-1',
      content: 'I have received your user journey data.',
      isFinal: true,
    });

    const res = await request(app)
      .post('/api/chat/v2')
      .send(uxDesignerRequest({
        files: [
          { filename: 'journeys.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', base64: fakeXlsxBase64 },
        ],
      }))
      .expect(200);

    // Parser was called with the file's base64
    expect(mockParseUserJourneyWorkbook).toHaveBeenCalledWith(fakeXlsxBase64);

    // sendChatRequest was called (LLM was invoked)
    expect(mockSendChatRequest).toHaveBeenCalledTimes(1);

    // Verify the messages sent to LLM contain the CSV-text, not the binary content
    const llmMessages = mockSendChatRequest.mock.calls[0][0];
    const userMessage = llmMessages[llmMessages.length - 1];
    // The user message should have content parts (array) because files were present
    expect(Array.isArray(userMessage.content)).toBe(true);
    // One of the content parts should contain the CSV-text
    const textParts = userMessage.content.filter((p: { type: string }) => p.type === 'text');
    const fileTextPart = textParts.find((p: { text: string }) => p.text.includes('Worksheet: Process Activities'));
    expect(fileTextPart).toBeDefined();

    // Response should be successful
    expect(res.body.assistant.message).toBe('I have received your user journey data.');
  });

  // --------------------------------------------------------------------------
  // Test 2: .xlsm file triggers parsing identically to .xlsx
  // --------------------------------------------------------------------------
  it('should parse .xlsm file identically to .xlsx for ux-designer--users-interactions', async () => {
    mockParseUserJourneyWorkbook.mockReturnValue({
      success: true,
      csvText: mockCsvText,
    });

    mockSendChatRequest.mockResolvedValueOnce({
      id: 'resp-2',
      content: 'Received your macro-enabled workbook.',
      isFinal: true,
    });

    const res = await request(app)
      .post('/api/chat/v2')
      .send(uxDesignerRequest({
        files: [
          { filename: 'journeys.xlsm', mimeType: 'application/vnd.ms-excel.sheet.macroEnabled.12', base64: fakeXlsxBase64 },
        ],
      }))
      .expect(200);

    // Parser was called
    expect(mockParseUserJourneyWorkbook).toHaveBeenCalledWith(fakeXlsxBase64);
    expect(mockSendChatRequest).toHaveBeenCalledTimes(1);
    expect(res.body.assistant.message).toBe('Received your macro-enabled workbook.');
  });

  // --------------------------------------------------------------------------
  // Test 3: Different taskId passes .xlsx file through unchanged
  // --------------------------------------------------------------------------
  it('should pass .xlsx file through unchanged for a different taskId', async () => {
    mockSendChatRequest.mockResolvedValueOnce({
      id: 'resp-3',
      content: JSON.stringify({
        phase: 'questions',
        questions: ['What is the product?'],
        summary: 'Initial questions.',
      }),
      isFinal: true,
    });

    await request(app)
      .post('/api/chat/v2')
      .send({
        threadKey: { type: 'hub', projectId: 'test-other-task' },
        personaId: 'product-manager',
        taskId: 'product-manager--define-product',
        message: 'Here is a spreadsheet',
        files: [
          { filename: 'data.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', base64: fakeXlsxBase64 },
        ],
      })
      .expect(200);

    // Parser should NOT have been called
    expect(mockParseUserJourneyWorkbook).not.toHaveBeenCalled();

    // sendChatRequest should still be called (the file passes through to LLM)
    expect(mockSendChatRequest).toHaveBeenCalledTimes(1);
  });

  // --------------------------------------------------------------------------
  // Test 4: Invalid workbook returns HTTP 400 without calling LLM
  // --------------------------------------------------------------------------
  it('should return HTTP 400 with descriptive error when workbook validation fails', async () => {
    mockParseUserJourneyWorkbook.mockReturnValue({
      success: false,
      error: 'Workbook is missing required worksheet: Activity Steps',
    });

    const res = await request(app)
      .post('/api/chat/v2')
      .send(uxDesignerRequest({
        files: [
          { filename: 'bad-workbook.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', base64: fakeXlsxBase64 },
        ],
      }))
      .expect(400);

    // Response contains descriptive error
    expect(res.body.error).toBe('Workbook is missing required worksheet: Activity Steps');

    // sendChatRequest should NOT have been called
    expect(mockSendChatRequest).not.toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // Test 5: Mixed files (.xlsx + .csv) -- parses .xlsx, passes .csv through
  // --------------------------------------------------------------------------
  it('should parse .xlsx and pass .csv through unchanged when both are present', async () => {
    mockParseUserJourneyWorkbook.mockReturnValue({
      success: true,
      csvText: mockCsvText,
    });

    mockSendChatRequest.mockResolvedValueOnce({
      id: 'resp-5',
      content: 'Received both files.',
      isFinal: true,
    });

    const res = await request(app)
      .post('/api/chat/v2')
      .send(uxDesignerRequest({
        files: [
          { filename: 'journeys.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', base64: fakeXlsxBase64 },
          { filename: 'extra-data.csv', mimeType: 'text/csv', base64: fakeCsvBase64 },
        ],
      }))
      .expect(200);

    // Parser was called only once (for the .xlsx file)
    expect(mockParseUserJourneyWorkbook).toHaveBeenCalledTimes(1);
    expect(mockParseUserJourneyWorkbook).toHaveBeenCalledWith(fakeXlsxBase64);

    // sendChatRequest was called
    expect(mockSendChatRequest).toHaveBeenCalledTimes(1);

    // Verify both files end up in the LLM message
    const llmMessages = mockSendChatRequest.mock.calls[0][0];
    const userMessage = llmMessages[llmMessages.length - 1];
    expect(Array.isArray(userMessage.content)).toBe(true);

    // Should have the text message, the parsed XLSX content, and the CSV file content
    const textParts = userMessage.content.filter((p: { type: string }) => p.type === 'text');
    // One part should contain the parsed worksheet data
    const xlsxPart = textParts.find((p: { text: string }) => p.text.includes('Worksheet: Process Activities'));
    expect(xlsxPart).toBeDefined();
    // Another part should contain the CSV file content (passed through as text)
    const csvPart = textParts.find((p: { text: string }) => p.text.includes('extra-data.csv'));
    expect(csvPart).toBeDefined();

    expect(res.body.assistant.message).toBe('Received both files.');
  });
});
