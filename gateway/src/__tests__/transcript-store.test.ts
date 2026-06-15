/**
 * Tests for transcript store functionality
 *
 * Spec 2026-01-14: Implement Assistant Stage 7 - Full Conversation and Execution Persistence to Disk
 * Task Group 1: Transcript Types and In-Memory Store
 */

import {
  initializeTranscript,
  getTranscript,
  appendTranscriptEntry,
  deleteTranscript,
  clearAllTranscripts,
  runTranscriptCleanup,
  transcriptStore,
} from '../services/transcriptStore';
import { ConversationTranscript, TranscriptEntry } from '../types/transcript';

// Mock config with configurable limits for testing
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
}));

// Mock logger
jest.mock('../services/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

describe('Transcript Store', () => {
  beforeEach(() => {
    clearAllTranscripts();
    // Reset to default config values
    mockConfig.sessionTtlHours = 24;
  });

  describe('TranscriptEntry type structure', () => {
    it('should have required fields: timestamp, phase, role, content', () => {
      const sessionId = 'test-session-structure';
      appendTranscriptEntry(sessionId, 'SYSTEM', 'bootstrap', 'Test content');

      const transcript = getTranscript(sessionId);
      expect(transcript).not.toBeNull();
      expect(transcript!.entries.length).toBe(1);

      const entry = transcript!.entries[0];
      expect(entry).toHaveProperty('timestamp');
      expect(entry).toHaveProperty('phase');
      expect(entry).toHaveProperty('role');
      expect(entry).toHaveProperty('content');

      // Verify ISO-8601 timestamp format
      expect(() => new Date(entry.timestamp)).not.toThrow();
      expect(entry.phase).toBe('bootstrap');
      expect(entry.role).toBe('SYSTEM');
      expect(entry.content).toBe('Test content');
    });
  });

  describe('initializeTranscript', () => {
    it('should create a new transcript buffer for a session', () => {
      const sessionId = 'test-session-init';

      const transcript = initializeTranscript(sessionId);

      expect(transcript).toBeDefined();
      expect(transcript.sessionId).toBe(sessionId);
      expect(transcript.entries).toEqual([]);
      expect(transcript.createdAt).toBeDefined();
      // Verify ISO-8601 format
      expect(() => new Date(transcript.createdAt)).not.toThrow();
    });

    it('should return existing transcript if already initialized', () => {
      const sessionId = 'test-session-existing';

      const first = initializeTranscript(sessionId);
      appendTranscriptEntry(sessionId, 'USER', 'refine', 'Test message');
      const second = initializeTranscript(sessionId);

      expect(first.sessionId).toBe(second.sessionId);
      expect(second.entries.length).toBe(1);
    });
  });

  describe('appendTranscriptEntry', () => {
    it('should append entries to existing buffer', () => {
      const sessionId = 'test-session-append';

      initializeTranscript(sessionId);
      appendTranscriptEntry(sessionId, 'SYSTEM', 'bootstrap', 'System prompt');
      appendTranscriptEntry(sessionId, 'USER', 'bootstrap', 'User message');
      appendTranscriptEntry(sessionId, 'ASSISTANT', 'bootstrap', 'Assistant response');

      const transcript = getTranscript(sessionId);
      expect(transcript).not.toBeNull();
      expect(transcript!.entries.length).toBe(3);
      expect(transcript!.entries[0].role).toBe('SYSTEM');
      expect(transcript!.entries[1].role).toBe('USER');
      expect(transcript!.entries[2].role).toBe('ASSISTANT');
    });

    it('should create transcript if not exists when appending', () => {
      const sessionId = 'test-session-auto-create';

      // Append without initializing first
      appendTranscriptEntry(sessionId, 'USER', 'refine', 'Test message');

      const transcript = getTranscript(sessionId);
      expect(transcript).not.toBeNull();
      expect(transcript!.entries.length).toBe(1);
    });

    it('should preserve entry order', () => {
      const sessionId = 'test-session-order';

      appendTranscriptEntry(sessionId, 'SYSTEM', 'bootstrap', 'First');
      appendTranscriptEntry(sessionId, 'USER', 'bootstrap', 'Second');
      appendTranscriptEntry(sessionId, 'ASSISTANT', 'bootstrap', 'Third');
      appendTranscriptEntry(sessionId, 'PLANNER_HANDOFF', 'handoff', 'Fourth');
      appendTranscriptEntry(sessionId, 'ORCHESTRATION', 'handoff', 'Fifth');

      const transcript = getTranscript(sessionId);
      expect(transcript!.entries[0].content).toBe('First');
      expect(transcript!.entries[1].content).toBe('Second');
      expect(transcript!.entries[2].content).toBe('Third');
      expect(transcript!.entries[3].content).toBe('Fourth');
      expect(transcript!.entries[4].content).toBe('Fifth');
    });
  });

  describe('getTranscript', () => {
    it('should return transcript by sessionId', () => {
      const sessionId = 'test-session-get';
      initializeTranscript(sessionId);
      appendTranscriptEntry(sessionId, 'USER', 'refine', 'Test');

      const transcript = getTranscript(sessionId);

      expect(transcript).not.toBeNull();
      expect(transcript!.sessionId).toBe(sessionId);
    });

    it('should return null for non-existent session', () => {
      const transcript = getTranscript('non-existent-session');
      expect(transcript).toBeNull();
    });
  });

  describe('deleteTranscript', () => {
    it('should delete transcript and return true', () => {
      const sessionId = 'test-session-delete';
      initializeTranscript(sessionId);

      const deleted = deleteTranscript(sessionId);

      expect(deleted).toBe(true);
      expect(getTranscript(sessionId)).toBeNull();
    });

    it('should return false for non-existent session', () => {
      const deleted = deleteTranscript('non-existent-session');
      expect(deleted).toBe(false);
    });
  });

  describe('cleanup', () => {
    it('should remove expired transcripts based on TTL', async () => {
      // Set very short TTL for testing (essentially 0)
      mockConfig.sessionTtlHours = 0; // 0 hours = immediate expiry

      const sessionId = 'test-session-cleanup';

      // Create the transcript
      transcriptStore.getOrCreate(sessionId);

      // Wait a small amount of time to ensure the age > 0
      await new Promise((resolve) => setTimeout(resolve, 5));

      // Now run cleanup - with TTL=0, the transcript should be older than 0ms
      runTranscriptCleanup();

      // With TTL=0 and a slight delay, transcripts should be cleaned up
      expect(getTranscript(sessionId)).toBeNull();
    });

    it('should not remove non-expired transcripts', () => {
      mockConfig.sessionTtlHours = 24;
      const sessionId = 'test-session-keep';

      initializeTranscript(sessionId);
      appendTranscriptEntry(sessionId, 'USER', 'refine', 'Keep this');

      runTranscriptCleanup();

      expect(getTranscript(sessionId)).not.toBeNull();
    });
  });

  describe('getOrCreate pattern', () => {
    it('should return existing buffer without creating new one', () => {
      const sessionId = 'test-getorcreate';

      // First call creates
      const first = transcriptStore.getOrCreate(sessionId);
      first.entries.push({
        timestamp: new Date().toISOString(),
        phase: 'bootstrap',
        role: 'USER',
        content: 'Existing entry',
      });

      // Second call returns same buffer
      const second = transcriptStore.getOrCreate(sessionId);

      expect(second.entries.length).toBe(1);
      expect(second.entries[0].content).toBe('Existing entry');
    });
  });
});
