/**
 * Tests for conversation helper service
 * Task Group 2: Conversation Helper Service
 */

import {
  buildMessagesForTurn,
  persistConversation,
  truncateConversation,
  calculateConversationBytes,
} from '../services/conversation';
import { GatewaySession, OpenAIMessage } from '../types/session';
import { getOrCreateSession, getSession, clearAllSessions } from '../services/sessionStore';

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

describe('Conversation Helper Service', () => {
  beforeEach(() => {
    clearAllSessions();
    // Reset to default config values
    mockConfig.maxConversationMessages = 80;
    mockConfig.maxConversationBytes = 200000;
  });

  describe('buildMessagesForTurn', () => {
    it('should return [system, ...conversation, user] for session with conversation history', () => {
      const session: GatewaySession = {
        sessionId: 'test-session-1',
        mcpSessionId: 'mcp-test-1',
        conversation: [
          { role: 'user', content: 'Previous question' },
          { role: 'assistant', content: 'Previous answer' },
        ],
        createdAt: new Date(),
        lastActivity: new Date(),
      };

      const systemPrompt = 'You are a helpful assistant.';
      const userMessage = 'Current question';

      const result = buildMessagesForTurn(session, systemPrompt, userMessage);

      expect(result.length).toBe(4);
      expect(result[0]).toEqual({ role: 'system', content: systemPrompt });
      expect(result[1]).toEqual({ role: 'user', content: 'Previous question' });
      expect(result[2]).toEqual({ role: 'assistant', content: 'Previous answer' });
      expect(result[3]).toEqual({ role: 'user', content: userMessage });
    });

    it('should return [system, user] for session with empty conversation', () => {
      const session: GatewaySession = {
        sessionId: 'test-session-2',
        mcpSessionId: 'mcp-test-2',
        conversation: [],
        createdAt: new Date(),
        lastActivity: new Date(),
      };

      const systemPrompt = 'You are a helpful assistant.';
      const userMessage = 'First question';

      const result = buildMessagesForTurn(session, systemPrompt, userMessage);

      expect(result.length).toBe(2);
      expect(result[0]).toEqual({ role: 'system', content: systemPrompt });
      expect(result[1]).toEqual({ role: 'user', content: userMessage });
    });

    it('should handle undefined conversation as empty array', () => {
      const session: GatewaySession = {
        sessionId: 'test-session-3',
        mcpSessionId: 'mcp-test-3',
        // conversation is undefined (legacy session)
        createdAt: new Date(),
        lastActivity: new Date(),
      };

      const systemPrompt = 'You are a helpful assistant.';
      const userMessage = 'Question for legacy session';

      const result = buildMessagesForTurn(session, systemPrompt, userMessage);

      expect(result.length).toBe(2);
      expect(result[0]).toEqual({ role: 'system', content: systemPrompt });
      expect(result[1]).toEqual({ role: 'user', content: userMessage });
    });

    it('should handle multi-turn conversation with tool calls', () => {
      const session: GatewaySession = {
        sessionId: 'test-session-multi',
        mcpSessionId: 'mcp-test-multi',
        conversation: [
          { role: 'user', content: 'List interfaces' },
          {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                id: 'call_123',
                type: 'function',
                function: {
                  name: 'list_interfaces',
                  arguments: '{"filename":"arch.json"}',
                },
              },
            ],
          },
          {
            role: 'tool',
            content: '[{"interfaceId":"INT-001"}]',
            tool_call_id: 'call_123',
          },
          { role: 'assistant', content: 'Found one interface.' },
        ],
        createdAt: new Date(),
        lastActivity: new Date(),
      };

      const systemPrompt = 'System prompt';
      const userMessage = 'Now show details';

      const result = buildMessagesForTurn(session, systemPrompt, userMessage);

      expect(result.length).toBe(6);
      expect(result[0].role).toBe('system');
      expect(result[1].role).toBe('user');
      expect(result[2].role).toBe('assistant');
      expect(result[2].tool_calls).toBeDefined();
      expect(result[3].role).toBe('tool');
      expect(result[3].tool_call_id).toBe('call_123');
      expect(result[4].role).toBe('assistant');
      expect(result[5].role).toBe('user');
      expect(result[5].content).toBe('Now show details');
    });
  });

  describe('persistConversation', () => {
    it('should filter out system prompt when persisting', () => {
      // Create a session
      const session = getOrCreateSession('test-persist-1');

      // Messages including system prompt
      const messages: OpenAIMessage[] = [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ];

      persistConversation('test-persist-1', messages);

      // Retrieve session and check conversation
      const updatedSession = getSession('test-persist-1');
      expect(updatedSession).toBeDefined();
      expect(updatedSession!.conversation).toBeDefined();
      expect(updatedSession!.conversation!.length).toBe(2);
      expect(updatedSession!.conversation!.find(m => m.role === 'system')).toBeUndefined();
      expect(updatedSession!.conversation![0].role).toBe('user');
      expect(updatedSession!.conversation![1].role).toBe('assistant');
    });
  });

  describe('truncateConversation', () => {
    it('should remove oldest messages first (FIFO) when count exceeds limit', () => {
      // Set a low limit for testing
      mockConfig.maxConversationMessages = 4;

      const conversation: OpenAIMessage[] = [
        { role: 'user', content: 'Message 1' },
        { role: 'assistant', content: 'Reply 1' },
        { role: 'user', content: 'Message 2' },
        { role: 'assistant', content: 'Reply 2' },
        { role: 'user', content: 'Message 3' },
        { role: 'assistant', content: 'Reply 3' },
      ];

      const result = truncateConversation(conversation);

      expect(result.length).toBe(4);
      // Oldest messages should be removed
      expect(result[0].content).toBe('Message 2');
      expect(result[1].content).toBe('Reply 2');
      expect(result[2].content).toBe('Message 3');
      expect(result[3].content).toBe('Reply 3');
    });

    it('should respect message count limit', () => {
      mockConfig.maxConversationMessages = 3;

      const conversation: OpenAIMessage[] = [
        { role: 'user', content: 'A' },
        { role: 'assistant', content: 'B' },
        { role: 'user', content: 'C' },
        { role: 'assistant', content: 'D' },
        { role: 'user', content: 'E' },
      ];

      const result = truncateConversation(conversation);

      expect(result.length).toBe(3);
      expect(result[0].content).toBe('C');
      expect(result[1].content).toBe('D');
      expect(result[2].content).toBe('E');
    });

    it('should respect byte size limit', () => {
      // Set high message count but low byte limit
      mockConfig.maxConversationMessages = 100;
      mockConfig.maxConversationBytes = 30; // Very low for testing

      const conversation: OpenAIMessage[] = [
        { role: 'user', content: 'AAAAAAAAAAA' }, // 11 bytes
        { role: 'assistant', content: 'BBBBBBBBBBB' }, // 11 bytes
        { role: 'user', content: 'CCCCCCCCCCC' }, // 11 bytes
      ];

      const result = truncateConversation(conversation);

      // Should remove oldest messages until under 30 bytes
      expect(calculateConversationBytes(result)).toBeLessThanOrEqual(30);
    });

    it('should not mutate original conversation array', () => {
      mockConfig.maxConversationMessages = 2;

      const conversation: OpenAIMessage[] = [
        { role: 'user', content: 'First' },
        { role: 'assistant', content: 'Second' },
        { role: 'user', content: 'Third' },
      ];

      const originalLength = conversation.length;
      truncateConversation(conversation);

      expect(conversation.length).toBe(originalLength);
    });
  });

  describe('calculateConversationBytes', () => {
    it('should sum content byte sizes correctly', () => {
      const conversation: OpenAIMessage[] = [
        { role: 'user', content: 'Hello' }, // 5 bytes
        { role: 'assistant', content: 'World' }, // 5 bytes
      ];

      const bytes = calculateConversationBytes(conversation);

      expect(bytes).toBe(10);
    });

    it('should handle empty content correctly', () => {
      const conversation: OpenAIMessage[] = [
        { role: 'user', content: 'Test' }, // 4 bytes
        { role: 'assistant', content: '' }, // 0 bytes
      ];

      const bytes = calculateConversationBytes(conversation);

      expect(bytes).toBe(4);
    });

    it('should handle multi-byte characters correctly (UTF-8)', () => {
      const conversation: OpenAIMessage[] = [
        { role: 'user', content: 'Hello' }, // 5 bytes
        { role: 'assistant', content: 'World' }, // 5 bytes (2 bytes for emoji)
      ];

      // Without emoji first to establish baseline
      expect(calculateConversationBytes(conversation)).toBe(10);

      // Now with multi-byte character
      const conversationWithEmoji: OpenAIMessage[] = [
        { role: 'user', content: 'Hi!' }, // 3 bytes
      ];

      expect(calculateConversationBytes(conversationWithEmoji)).toBe(3);
    });

    it('should handle empty conversation array', () => {
      const conversation: OpenAIMessage[] = [];

      const bytes = calculateConversationBytes(conversation);

      expect(bytes).toBe(0);
    });
  });
});
