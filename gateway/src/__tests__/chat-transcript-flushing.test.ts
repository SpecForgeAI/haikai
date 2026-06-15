/**
 * Tests for POST /api/chat transcript flushing
 *
 * Spec 2026-01-15: Fix Implement Assistant Conversation Persistence
 * Task Group 3: Flush Transcript After Every Chat Turn
 *
 * Spec 2026-02-12: Generalize Conversation Persistence to Support Kind
 * - Updated writeTranscriptToFile assertions to account for new "implement" kind parameter
 */

import express from 'express';
import request from 'supertest';
import { chatRouter } from '../routes/chat';
import * as transcriptStore from '../services/transcriptStore';
import * as transcriptWriter from '../services/transcriptWriter';

// Mock dependencies
jest.mock('../services/openaiClient');
jest.mock('../services/sessionStore');
jest.mock('../services/transcriptStore');
jest.mock('../services/transcriptWriter');
jest.mock('../services/architectureModelClient');
jest.mock('../services/conversation');
jest.mock('../services/promptBuilder');

const mockWriteTranscriptToFile = transcriptWriter.writeTranscriptToFile as jest.MockedFunction<typeof transcriptWriter.writeTranscriptToFile>;
const mockGetTranscript = transcriptStore.getTranscript as jest.MockedFunction<typeof transcriptStore.getTranscript>;
const mockInitializeTranscript = transcriptStore.initializeTranscript as jest.MockedFunction<typeof transcriptStore.initializeTranscript>;
const mockAppendTranscriptEntry = transcriptStore.appendTranscriptEntry as jest.MockedFunction<typeof transcriptStore.appendTranscriptEntry>;

// Mock config
jest.mock('../config', () => ({
  getConfig: () => ({
    sessionTtlHours: 24,
    openaiApiKey: 'test-key',
    openaiModel: 'gpt-4o',
    openaiBaseUrl: 'https://api.openai.com/v1',
    openaiTimeoutMs: 60000,
    mcpBaseUrl: 'http://localhost:8090',
    architectureModelServiceBaseUrl: 'http://localhost:8080',
    orchestrationServiceBaseUrl: 'http://localhost:8085',
    conversationPersistBasePath: '/tmp/test-transcripts',
    port: 8081,
    maxToolCallsPerTurn: 8,
    maxOasBytes: 2097152,
    maxMessageBytes: 32768,
    rateLimitRpm: 60,
    rateLimitBurst: 20,
    maxConversationMessages: 80,
    maxConversationBytes: 200000,
    logLevel: 'info',
    allowedOrigins: ['http://localhost:5173'],
    enableToolTrace: false,
  }),
}));

// Mock logger
const mockLoggerInfo = jest.fn();
const mockLoggerWarn = jest.fn();
const mockLoggerError = jest.fn();
const mockLoggerDebug = jest.fn();

jest.mock('../services/logger', () => ({
  logger: {
    info: jest.fn((...args) => mockLoggerInfo(...args)),
    debug: jest.fn((...args) => mockLoggerDebug(...args)),
    error: jest.fn((...args) => mockLoggerError(...args)),
    warn: jest.fn((...args) => mockLoggerWarn(...args)),
  },
  logRequestStart: jest.fn(),
  logRequestEnd: jest.fn(),
}));

// Mock openaiClient
const { sendChatRequest, buildToolResultMessages } = jest.requireMock('../services/openaiClient');
(sendChatRequest as jest.Mock).mockResolvedValue({
  id: 'chatcmpl-123',
  choices: [
    {
      message: {
        role: 'assistant',
        content: 'Hello! How can I help you today?',
      },
      finish_reason: 'stop',
    },
  ],
});
(buildToolResultMessages as jest.Mock).mockReturnValue([]);

// Mock sessionStore
const { getOrCreateSession, updateSession } = jest.requireMock('../services/sessionStore');
(getOrCreateSession as jest.Mock).mockReturnValue({
  id: 'test-session-123',
  createdAt: new Date().toISOString(),
  lastAccessedAt: new Date().toISOString(),
  history: [],
  metadata: {},
});
(updateSession as jest.Mock).mockImplementation(() => {});

// Mock buildMessagesForTurn
const { buildMessagesForTurn } = jest.requireMock('../services/conversation');
(buildMessagesForTurn as jest.Mock).mockReturnValue([
  { role: 'system', content: 'You are a helpful assistant.' },
  { role: 'user', content: 'Hello' },
]);

// Mock promptBuilder
const { buildSystemPrompt, buildContextSummary, buildBootstrapPrompt } = jest.requireMock('../services/promptBuilder');
(buildSystemPrompt as jest.Mock).mockReturnValue('System prompt');
(buildContextSummary as jest.Mock).mockReturnValue('Context summary');
(buildBootstrapPrompt as jest.Mock).mockReturnValue('Bootstrap prompt');

// Create test app
function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/chat', chatRouter);
  return app;
}

describe('POST /api/chat transcript flushing', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Setup default mocks
    mockInitializeTranscript.mockReturnValue({
      sessionId: 'test-session-123',
      entries: [],
      createdAt: new Date().toISOString(),
    });

    mockGetTranscript.mockReturnValue({
      sessionId: 'test-session-123',
      entries: [
        { timestamp: new Date().toISOString(), phase: 'refine', role: 'USER', content: 'Hello' },
        { timestamp: new Date().toISOString(), phase: 'refine', role: 'ASSISTANT', content: 'Hi there!' },
      ],
      createdAt: new Date().toISOString(),
    });

    mockAppendTranscriptEntry.mockReturnValue();
    mockWriteTranscriptToFile.mockResolvedValue();
  });

  // Spec 2026-02-12: writeTranscriptToFile now includes "implement" kind parameter after projectParentFolder
  it('should write transcript to disk after ASSISTANT entry for mode=implement_feature', async () => {
    const app = createApp();

    const response = await request(app)
      .post('/api/chat')
      .send({
        sessionId: 'test-session-123',
        message: 'Hello',
        context: {
          mode: 'implement_feature',
          phase: 'refine',
          projectParentFolder: '/home/user/project',
          featureId: 'feat-123',
          featureTitle: 'Test Feature',
        },
      });

    expect(response.status).toBe(200);

    // Verify writeTranscriptToFile was called with persistence metadata
    // Spec 2026-02-12: kind="implement" is passed as 5th arg, displayedMessages as 6th (undefined when not provided)
    expect(mockWriteTranscriptToFile).toHaveBeenCalledTimes(1);
    const callArgs = mockWriteTranscriptToFile.mock.calls[0];
    expect(callArgs[0]).toEqual(expect.objectContaining({ sessionId: 'test-session-123' }));
    expect(callArgs[1]).toBe('Test Feature');
    expect(callArgs[2]).toBe('feat-123');
    expect(callArgs[3]).toBe('/home/user/project');
    expect(callArgs[4]).toBe('implement');
  });

  it('should NOT write transcript for mode=oas_assistant', async () => {
    const app = createApp();

    const response = await request(app)
      .post('/api/chat')
      .send({
        sessionId: 'test-session-123',
        message: 'Hello',
        context: {
          mode: 'oas_assistant',
        },
      });

    expect(response.status).toBe(200);

    // writeTranscriptToFile should NOT be called for oas_assistant mode
    expect(mockWriteTranscriptToFile).not.toHaveBeenCalled();
  });

  it('should skip persistence and log warning when projectParentFolder is missing', async () => {
    const app = createApp();

    const response = await request(app)
      .post('/api/chat')
      .send({
        sessionId: 'test-session-123',
        message: 'Hello',
        context: {
          mode: 'implement_feature',
          phase: 'refine',
          // No projectParentFolder provided
          featureId: 'feat-123',
          featureTitle: 'Test Feature',
        },
      });

    expect(response.status).toBe(200);

    // Should log warning about missing persistence metadata
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.stringContaining('persistence'),
      expect.objectContaining({ featureId: 'feat-123' })
    );

    // Spec: persistence is SKIPPED when required fields are missing
    expect(mockWriteTranscriptToFile).not.toHaveBeenCalled();
  });

  it('should skip persistence and log warning when featureId is missing', async () => {
    const app = createApp();

    const response = await request(app)
      .post('/api/chat')
      .send({
        sessionId: 'test-session-123',
        message: 'Hello',
        context: {
          mode: 'implement_feature',
          phase: 'refine',
          projectParentFolder: '/home/user/project',
          // No featureId provided
          featureTitle: 'Test Feature',
        },
      });

    expect(response.status).toBe(200);

    // Should log warning about missing persistence metadata
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.stringContaining('persistence'),
      expect.any(Object)
    );

    // Spec: persistence is SKIPPED when required fields are missing
    expect(mockWriteTranscriptToFile).not.toHaveBeenCalled();
  });

  it('should not fail chat request when filesystem errors occur', async () => {
    // Make writeTranscriptToFile throw an error
    mockWriteTranscriptToFile.mockRejectedValue(new Error('Disk full'));

    const app = createApp();

    const response = await request(app)
      .post('/api/chat')
      .send({
        sessionId: 'test-session-123',
        message: 'Hello',
        context: {
          mode: 'implement_feature',
          phase: 'refine',
          projectParentFolder: '/home/user/project',
          featureId: 'feat-123',
          featureTitle: 'Test Feature',
        },
      });

    // Chat request should still succeed
    expect(response.status).toBe(200);
    expect(response.body.assistant.message).toBeDefined();

    // Should log error about persistence failure
    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.stringContaining('persistence'),
      expect.any(Object)
    );
  });

  // Spec 2026-02-12: writeTranscriptToFile now includes "implement" kind parameter after projectParentFolder
  it('should use featureTitle for folder naming', async () => {
    const app = createApp();

    await request(app)
      .post('/api/chat')
      .send({
        sessionId: 'test-session-123',
        message: 'Hello',
        context: {
          mode: 'implement_feature',
          phase: 'refine',
          projectParentFolder: '/home/user/project',
          featureId: 'feat-456',
          featureTitle: 'Add User Dashboard',
        },
      });

    expect(mockWriteTranscriptToFile).toHaveBeenCalledTimes(1);
    const callArgs = mockWriteTranscriptToFile.mock.calls[0];
    expect(callArgs[0]).toEqual(expect.any(Object));
    expect(callArgs[1]).toBe('Add User Dashboard'); // featureTitle used for folder name
    expect(callArgs[2]).toBe('feat-456');
    expect(callArgs[3]).toBe('/home/user/project');
    expect(callArgs[4]).toBe('implement');
  });
});
