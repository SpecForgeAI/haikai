/**
 * Tests for chat route transcript appending integration
 *
 * Spec 2026-01-14: Implement Assistant Stage 7 - Full Conversation and Execution Persistence to Disk
 * Task Group 2: Chat Route Transcript Appending
 */

import request from 'supertest';
import express from 'express';
import { chatRouter } from '../routes/chat';
import { getTranscript, clearAllTranscripts } from '../services/transcriptStore';
import { clearAllSessions } from '../services/sessionStore';

// Mock config
const mockConfig = {
  sessionTtlHours: 24,
  openaiApiKey: 'test-key',
  openaiModel: 'gpt-4o',
  openaiBaseUrl: 'https://api.openai.com/v1',
  openaiTimeoutMs: 60000,
  mcpBaseUrl: 'http://localhost:8090',
  architectureModelServiceBaseUrl: 'http://localhost:8080',
  orchestrationServiceBaseUrl: 'http://localhost:8085',
  conversationPersistBasePath: '/tmp/test',
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
};

jest.mock('../config', () => ({
  getConfig: () => mockConfig,
  loadConfig: () => mockConfig,
}));

// Mock logger
jest.mock('../services/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
  logRequestStart: jest.fn(),
  logRequestEnd: jest.fn(),
}));

// Mock OpenAI client to return predictable responses
let mockOpenAIResponse = {
  content: 'Hello! I am the assistant.',
  isFinal: true,
  toolCalls: [],
};

jest.mock('../services/openaiClient', () => ({
  sendChatRequest: jest.fn().mockImplementation(() =>
    Promise.resolve(mockOpenAIResponse)
  ),
  sendStreamingRequest: jest.fn(),
  buildToolResultMessages: jest.fn(),
  resetOpenAIClient: jest.fn(),
}));

// Mock architecture model client
jest.mock('../services/architectureModelClient', () => {
  const { buildArchitectureModelClientMock } = jest.requireActual(
    '../testSetup/architectureModelClientMock'
  );
  return buildArchitectureModelClientMock({
    resolveImplementContext: jest.fn().mockResolvedValue(null),
    fetchProductSummary: jest.fn().mockResolvedValue(null),
    fetchMetaModelSummary: jest.fn().mockResolvedValue(null),
    tryResolveImplementContextWithBundles: jest.fn().mockResolvedValue(null),
    hasBundleTypeSelections: jest.fn().mockReturnValue(false),
    expandResolveContext: jest.fn().mockResolvedValue(null),
  });
});

// Mock handoff plan validator
jest.mock('../services/handoffPlanValidator', () => ({
  validateHandoffPlan: jest.fn().mockReturnValue({
    valid: true,
    handoffPlan: {
      is_split: false,
      handoff_plan_summary: 'Single intent plan',
      handoff_intents: [
        {
          id: 'S1',
          title: 'Test Feature',
          intent: 'Implement the test feature',
          in_scope: ['Test item'],
          out_of_scope: [],
          acceptance_criteria: ['Feature works'],
          dependencies: [],
        },
      ],
    },
  }),
  generateFallbackPlan: jest.fn(),
}));

// Mock specs validator
jest.mock('../services/specsValidator', () => ({
  validateGeneratedSpecs: jest.fn().mockReturnValue({ valid: false }),
}));

describe('Chat Route Transcript Integration', () => {
  let app: express.Application;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    // Add requestId middleware
    app.use((req, res, next) => {
      req.requestId = 'test-request-id';
      next();
    });
    app.use('/api/chat', chatRouter);
  });

  beforeEach(() => {
    clearAllTranscripts();
    clearAllSessions();
    // Reset mock response
    mockOpenAIResponse = {
      content: 'Hello! I am the assistant.',
      isFinal: true,
      toolCalls: [],
    };
    jest.clearAllMocks();
  });

  describe('implement_feature mode transcript appending', () => {
    it('should append SYSTEM entry when system prompt is built', async () => {
      const sessionId = 'test-session-system';

      await request(app)
        .post('/api/chat')
        .send({
          sessionId,
          message: 'Hello',
          context: {
            mode: 'implement_feature',
            phase: 'refine',
            filename: 'test-project.json',
            workItem: {
              id: 'FEAT-1',
              title: 'Test Feature',
              type: 'Feature',
              description: 'A test feature',
            },
          },
        })
        .expect(200);

      const transcript = getTranscript(sessionId);
      expect(transcript).not.toBeNull();

      // Find SYSTEM entry
      const systemEntry = transcript!.entries.find((e) => e.role === 'SYSTEM');
      expect(systemEntry).toBeDefined();
      expect(systemEntry!.phase).toBe('refine');
      expect(systemEntry!.content).toBeTruthy();
    });

    it('should append USER entry when user message received', async () => {
      const sessionId = 'test-session-user';
      const userMessage = 'What are the requirements?';

      await request(app)
        .post('/api/chat')
        .send({
          sessionId,
          message: userMessage,
          context: {
            mode: 'implement_feature',
            phase: 'refine',
            filename: 'test-project.json',
            workItem: {
              id: 'FEAT-1',
              title: 'Test Feature',
              type: 'Feature',
              description: 'A test feature',
            },
          },
        })
        .expect(200);

      const transcript = getTranscript(sessionId);
      expect(transcript).not.toBeNull();

      // Find USER entry
      const userEntry = transcript!.entries.find((e) => e.role === 'USER');
      expect(userEntry).toBeDefined();
      expect(userEntry!.content).toBe(userMessage);
      expect(userEntry!.phase).toBe('refine');
    });

    it('should append ASSISTANT entry after LLM response', async () => {
      const sessionId = 'test-session-assistant';
      const assistantResponse = 'I understand your requirements.';
      mockOpenAIResponse = {
        content: assistantResponse,
        isFinal: true,
        toolCalls: [],
      };

      await request(app)
        .post('/api/chat')
        .send({
          sessionId,
          message: 'Hello',
          context: {
            mode: 'implement_feature',
            phase: 'refine',
            filename: 'test-project.json',
            workItem: {
              id: 'FEAT-1',
              title: 'Test Feature',
              type: 'Feature',
              description: 'A test feature',
            },
          },
        })
        .expect(200);

      const transcript = getTranscript(sessionId);
      expect(transcript).not.toBeNull();

      // Find ASSISTANT entry
      const assistantEntry = transcript!.entries.find((e) => e.role === 'ASSISTANT');
      expect(assistantEntry).toBeDefined();
      expect(assistantEntry!.content).toBe(assistantResponse);
    });

    it('should include phase value in every entry', async () => {
      const sessionId = 'test-session-phase';

      await request(app)
        .post('/api/chat')
        .send({
          sessionId,
          message: 'Hello',
          context: {
            mode: 'implement_feature',
            phase: 'bootstrap',
            filename: 'test-project.json',
            workItem: {
              id: 'FEAT-1',
              title: 'Test Feature',
              type: 'Feature',
              description: 'A test feature',
            },
          },
        })
        .expect(200);

      const transcript = getTranscript(sessionId);
      expect(transcript).not.toBeNull();

      // All entries should have phase
      for (const entry of transcript!.entries) {
        expect(entry.phase).toBeDefined();
        expect(['bootstrap', 'refine', 'handoff']).toContain(entry.phase);
      }
    });

    it('should NOT append entries when mode is NOT implement_feature', async () => {
      const sessionId = 'test-session-oas';

      await request(app)
        .post('/api/chat')
        .send({
          sessionId,
          message: 'Hello',
          context: {
            mode: 'oas_assistant',
            filename: 'test-project.json',
          },
        })
        .expect(200);

      const transcript = getTranscript(sessionId);
      // Transcript should not exist for oas_assistant mode
      expect(transcript).toBeNull();
    });

    it('should append PLANNER_HANDOFF entry on successful handoff validation', async () => {
      const sessionId = 'test-session-handoff';

      await request(app)
        .post('/api/chat')
        .send({
          sessionId,
          message: 'Ready to handoff',
          context: {
            mode: 'implement_feature',
            phase: 'handoff',
            filename: 'test-project.json',
            workItem: {
              id: 'FEAT-1',
              title: 'Test Feature',
              type: 'Feature',
              description: 'A test feature',
            },
          },
        })
        .expect(200);

      const transcript = getTranscript(sessionId);
      expect(transcript).not.toBeNull();

      // Find PLANNER_HANDOFF entry
      const handoffEntry = transcript!.entries.find(
        (e) => e.role === 'PLANNER_HANDOFF'
      );
      expect(handoffEntry).toBeDefined();
      expect(handoffEntry!.phase).toBe('handoff');

      // Content should be formatted JSON
      const parsedContent = JSON.parse(handoffEntry!.content);
      expect(parsedContent).toHaveProperty('is_split');
      expect(parsedContent).toHaveProperty('handoff_plan_summary');
      expect(parsedContent).toHaveProperty('handoff_intents');
    });
  });
});
