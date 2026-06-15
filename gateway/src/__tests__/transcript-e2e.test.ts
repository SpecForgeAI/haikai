/**
 * End-to-End Integration Tests for Transcript Feature
 *
 * Spec 2026-01-14: Implement Assistant Stage 7 - Full Conversation and Execution Persistence to Disk
 * Task Group 5: Test Review and Gap Analysis - Strategic integration tests
 *
 * These tests verify the integration between transcript store, chat route,
 * and file writer components.
 *
 * Spec 2026-06-12 (Implementation-Service Init and Integration Repair):
 * the legacy POST /api/orchestrations/execute route (and its
 * orchestrationClient.executeOrchestration service) was RETIRED, so the
 * orchestration-triggered file-write scenarios were removed from this suite
 * along with the retired route's transcript hook. Chat-side transcript
 * behaviour (capture, isolation, cleanup, large responses) is still covered.
 */

import request from 'supertest';
import express from 'express';
import { chatRouter } from '../routes/chat';
import {
  getTranscript,
  clearAllTranscripts,
  appendTranscriptEntry,
  deleteTranscript,
  initializeTranscript,
} from '../services/transcriptStore';
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

// Mock OpenAI client
let mockOpenAIResponse = {
  content: 'Assistant response',
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
      handoff_plan_summary: 'Test plan',
      handoff_intents: [
        {
          id: 'S1',
          title: 'Test',
          intent: 'Test',
          in_scope: [],
          out_of_scope: [],
          acceptance_criteria: [],
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

// Track transcript file writes - use factory function
jest.mock('../services/transcriptWriter', () => {
  const mockFn = jest.fn().mockResolvedValue(undefined);
  return {
    writeTranscriptToFile: mockFn,
    deriveFolderName: jest.fn((title: string, sessionId: string) => `${title}-${sessionId.slice(0, 8)}`),
    buildTranscriptPath: jest.fn(),
    formatTranscript: jest.fn(),
    __getMockWriteTranscriptToFile: () => mockFn,
  };
});


describe('Transcript End-to-End Integration', () => {
  let app: express.Application;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      req.requestId = 'test-request-id';
      next();
    });
    app.use('/api/chat', chatRouter);
  });

  beforeEach(() => {
    clearAllTranscripts();
    clearAllSessions();
    mockOpenAIResponse = {
      content: 'Assistant response',
      isFinal: true,
      toolCalls: [],
    };
    jest.clearAllMocks();
  });

  describe('Full conversation flow produces file', () => {
    it('should capture bootstrap -> refine -> handoff flow in the transcript', async () => {
      const sessionId = 'e2e-full-flow-session';

      // Step 1: Bootstrap phase
      await request(app)
        .post('/api/chat')
        .send({
          sessionId,
          message: 'Start implementing the feature',
          context: {
            mode: 'implement_feature',
            phase: 'bootstrap',
            filename: 'test-project.json',
            workItem: {
              id: 'FEAT-E2E',
              title: 'E2E Test Feature',
              type: 'Feature',
              description: 'End to end test',
            },
          },
        })
        .expect(200);

      // Step 2: Refine phase
      mockOpenAIResponse.content = 'I understand your requirements for the refine phase.';
      await request(app)
        .post('/api/chat')
        .send({
          sessionId,
          message: 'Add validation for user input',
          context: {
            mode: 'implement_feature',
            phase: 'refine',
            filename: 'test-project.json',
            workItem: {
              id: 'FEAT-E2E',
              title: 'E2E Test Feature',
              type: 'Feature',
              description: 'End to end test',
            },
          },
        })
        .expect(200);

      // Step 3: Handoff phase
      mockOpenAIResponse.content = 'Ready for handoff';
      await request(app)
        .post('/api/chat')
        .send({
          sessionId,
          message: 'Finalize the plan',
          context: {
            mode: 'implement_feature',
            phase: 'handoff',
            filename: 'test-project.json',
            workItem: {
              id: 'FEAT-E2E',
              title: 'E2E Test Feature',
              type: 'Feature',
              description: 'End to end test',
            },
          },
        })
        .expect(200);

      // Verify transcript has entries from all phases
      const transcript = getTranscript(sessionId);
      expect(transcript).not.toBeNull();
      expect(transcript!.entries.length).toBeGreaterThan(0);

      // Check we have entries from different phases
      const phases = new Set(transcript!.entries.map((e) => e.phase));
      expect(phases.has('bootstrap')).toBe(true);
      expect(phases.has('refine')).toBe(true);
      expect(phases.has('handoff')).toBe(true);
    });
  });

  describe('Transcript cleanup on session delete', () => {
    it('should remove transcript when deleteTranscript is called', () => {
      const sessionId = 'cleanup-test-session';

      // Create and populate transcript
      initializeTranscript(sessionId);
      appendTranscriptEntry(sessionId, 'SYSTEM', 'bootstrap', 'System prompt');
      appendTranscriptEntry(sessionId, 'USER', 'bootstrap', 'User message');

      // Verify it exists
      expect(getTranscript(sessionId)).not.toBeNull();

      // Delete it
      const deleted = deleteTranscript(sessionId);
      expect(deleted).toBe(true);

      // Verify it's gone
      expect(getTranscript(sessionId)).toBeNull();
    });
  });

  describe('Multiple sessions maintain separate transcripts', () => {
    it('should maintain separate transcripts for different sessions', async () => {
      const sessionId1 = 'multi-session-1';
      const sessionId2 = 'multi-session-2';

      // Session 1 chat
      await request(app)
        .post('/api/chat')
        .send({
          sessionId: sessionId1,
          message: 'Session 1 message',
          context: {
            mode: 'implement_feature',
            phase: 'refine',
            filename: 'project1.json',
            workItem: { id: 'F1', title: 'Feature 1', type: 'Feature', description: 'First feature' },
          },
        })
        .expect(200);

      // Session 2 chat
      mockOpenAIResponse.content = 'Different response for session 2';
      await request(app)
        .post('/api/chat')
        .send({
          sessionId: sessionId2,
          message: 'Session 2 message',
          context: {
            mode: 'implement_feature',
            phase: 'refine',
            filename: 'project2.json',
            workItem: { id: 'F2', title: 'Feature 2', type: 'Feature', description: 'Second feature' },
          },
        })
        .expect(200);

      // Verify both transcripts exist and are separate
      const transcript1 = getTranscript(sessionId1);
      const transcript2 = getTranscript(sessionId2);

      expect(transcript1).not.toBeNull();
      expect(transcript2).not.toBeNull();
      expect(transcript1!.sessionId).toBe(sessionId1);
      expect(transcript2!.sessionId).toBe(sessionId2);

      // Verify content is different
      const user1Entry = transcript1!.entries.find((e) => e.role === 'USER');
      const user2Entry = transcript2!.entries.find((e) => e.role === 'USER');
      expect(user1Entry!.content).toBe('Session 1 message');
      expect(user2Entry!.content).toBe('Session 2 message');
    });
  });

  describe('Handling very large assistant responses', () => {
    it('should store full assistant response without truncation in transcript entry', async () => {
      const sessionId = 'large-response-session';

      // Create a very large response (over 8000 chars to test it's NOT truncated at this level)
      const largeContent = 'A'.repeat(15000);
      mockOpenAIResponse.content = largeContent;

      await request(app)
        .post('/api/chat')
        .send({
          sessionId,
          message: 'Generate detailed plan',
          context: {
            mode: 'implement_feature',
            phase: 'refine',
            filename: 'test-project.json',
            workItem: { id: 'F1', title: 'Large Response Test', type: 'Feature', description: 'Test' },
          },
        })
        .expect(200);

      const transcript = getTranscript(sessionId);
      expect(transcript).not.toBeNull();

      // Find the assistant entry
      const assistantEntry = transcript!.entries.find((e) => e.role === 'ASSISTANT');
      expect(assistantEntry).toBeDefined();

      // Verify the full content is preserved (not truncated)
      expect(assistantEntry!.content.length).toBe(15000);
      expect(assistantEntry!.content).toBe(largeContent);
    });
  });

});
