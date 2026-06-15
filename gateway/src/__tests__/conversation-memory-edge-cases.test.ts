/**
 * Edge case tests for conversation memory feature
 * Task Group 6: Test Review and Gap Analysis
 *
 * These strategic tests fill critical gaps in conversation memory coverage:
 * - Empty conversation handling
 * - Maximum conversation size boundary conditions
 * - Truncation when both limits apply
 * - Messages with undefined/null content
 * - Error recovery when persist fails gracefully
 */

import {
  buildMessagesForTurn,
  persistConversation,
  truncateConversation,
  calculateConversationBytes,
} from '../services/conversation';
import { GatewaySession, OpenAIMessage } from '../types/session';
import { getOrCreateSession, getSession, clearAllSessions, updateSession } from '../services/sessionStore';

// Mock config with configurable limits for testing
const mockConfig = {
  mcpBaseUrl: 'http://localhost:8090',
  sessionTtlHours: 24,
  openaiApiKey: 'test-key',
  openaiModel: 'gpt-4o',
  openaiBaseUrl: 'https://api.openai.com/v1',
  openaiTimeoutMs: 60000,
  maxConversationMessages: 80,
  maxConversationBytes: 200000,
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

describe('Conversation Memory Edge Cases', () => {
  beforeEach(() => {
    clearAllSessions();
    // Reset to default config values
    mockConfig.maxConversationMessages = 80;
    mockConfig.maxConversationBytes = 200000;
  });

  describe('Empty Conversation Handling', () => {
    it('should handle persistConversation with only system message gracefully', () => {
      // Create a session
      const session = getOrCreateSession('empty-conv-session');

      // Messages containing only system prompt (edge case: user sends nothing meaningful)
      const messages: OpenAIMessage[] = [
        { role: 'system', content: 'You are a helpful assistant.' },
      ];

      // Should not throw error
      expect(() => persistConversation('empty-conv-session', messages)).not.toThrow();

      // Verify session has empty conversation (system filtered out)
      const updatedSession = getSession('empty-conv-session');
      expect(updatedSession).toBeDefined();
      expect(updatedSession!.conversation).toBeDefined();
      expect(updatedSession!.conversation!.length).toBe(0);
    });
  });

  describe('Maximum Conversation Size Boundary Conditions', () => {
    it('should correctly truncate when conversation is exactly at message count limit + 1', () => {
      // Set limit to 4 messages
      mockConfig.maxConversationMessages = 4;

      // Create exactly 5 messages (one over limit)
      const conversation: OpenAIMessage[] = [
        { role: 'user', content: 'Message 1' },
        { role: 'assistant', content: 'Reply 1' },
        { role: 'user', content: 'Message 2' },
        { role: 'assistant', content: 'Reply 2' },
        { role: 'user', content: 'Message 3' }, // This is the 5th, should cause 1st to be removed
      ];

      const result = truncateConversation(conversation);

      expect(result.length).toBe(4);
      // First message should be removed (FIFO)
      expect(result[0].content).toBe('Reply 1');
      expect(result[3].content).toBe('Message 3');
    });

    it('should handle truncation when both message count and byte limits require reduction', () => {
      // Set both limits low
      mockConfig.maxConversationMessages = 3;
      mockConfig.maxConversationBytes = 20; // 20 bytes

      // Create messages that exceed both limits
      const conversation: OpenAIMessage[] = [
        { role: 'user', content: 'AAAAAAAAAA' }, // 10 bytes
        { role: 'assistant', content: 'BBBBBBBBBB' }, // 10 bytes
        { role: 'user', content: 'CCCCCCCCCC' }, // 10 bytes
        { role: 'assistant', content: 'DDDDDDDDDD' }, // 10 bytes
        { role: 'user', content: 'EEEEEEEEEE' }, // 10 bytes - total 50 bytes, 5 messages
      ];

      const result = truncateConversation(conversation);

      // First, count limit reduces to 3 messages (C, D, E = 30 bytes)
      // Then, byte limit reduces further until under 20 bytes
      expect(result.length).toBeLessThanOrEqual(3);
      expect(calculateConversationBytes(result)).toBeLessThanOrEqual(20);
    });
  });

  describe('Messages with Undefined/Null Content', () => {
    it('should calculate bytes correctly for messages with undefined content', () => {
      const conversation: OpenAIMessage[] = [
        { role: 'user', content: 'Hello' }, // 5 bytes
        { role: 'assistant', content: undefined as unknown as string }, // non-string -> JSON.stringify('') = '""' -> 2 bytes
        { role: 'assistant', content: '' }, // empty string -> 0 bytes
      ];

      const bytes = calculateConversationBytes(conversation);

      // 5 bytes from "Hello" + 2 bytes for the undefined-content message
      expect(bytes).toBe(7);
    });
  });

  describe('Persist Gracefully with Non-Existent Session', () => {
    it('should handle persistConversation gracefully when session does not exist', () => {
      // Do NOT create a session - it doesn't exist
      const messages: OpenAIMessage[] = [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'Test message' },
        { role: 'assistant', content: 'Test response' },
      ];

      // Should not throw error (updateSession returns null for non-existent session)
      expect(() => persistConversation('non-existent-session', messages)).not.toThrow();

      // Verify session was not created (persist doesn't create sessions)
      const session = getSession('non-existent-session');
      expect(session).toBeNull();
    });
  });
});
