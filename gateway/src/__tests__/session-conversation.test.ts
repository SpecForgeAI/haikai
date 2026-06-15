/**
 * Tests for session conversation field
 * Task Group 1: Session Type and Store Updates
 */

import {
  getOrCreateSession,
  updateSession,
  getSession,
  clearAllSessions,
  sessionStore,
} from '../services/sessionStore';
import { GatewaySession, OpenAIMessage } from '../types/session';

// Mock config
jest.mock('../config', () => ({
  getConfig: () => ({
    mcpBaseUrl: 'http://localhost:8090',
    sessionTtlHours: 24,
    openaiApiKey: 'test-key',
    openaiModel: 'gpt-4o',
    openaiBaseUrl: 'https://api.openai.com/v1',
    openaiTimeoutMs: 60000,
  }),
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

describe('Session Conversation Field', () => {
  beforeEach(() => {
    clearAllSessions();
  });

  describe('New Session Creation', () => {
    it('should create new sessions with empty conversation array', () => {
      const session = getOrCreateSession('test-session-conv-1');

      expect(session).toBeDefined();
      expect(session.sessionId).toBe('test-session-conv-1');
      expect(session.conversation).toBeDefined();
      expect(session.conversation).toEqual([]);
      expect(Array.isArray(session.conversation)).toBe(true);
    });
  });

  describe('Backward Compatibility', () => {
    it('should handle existing sessions without conversation field (treated as empty array)', () => {
      // Simulate an existing session without conversation field
      // (like sessions created before this feature was added)
      const legacySession: GatewaySession = {
        sessionId: 'legacy-session',
        mcpSessionId: 'mcp-legacy',
        createdAt: new Date(),
        lastActivity: new Date(),
        // Note: no conversation field
      };

      // Directly set the session in the store
      sessionStore.set('legacy-session', legacySession);

      // Retrieve the session
      const retrieved = getSession('legacy-session');

      expect(retrieved).toBeDefined();
      expect(retrieved!.sessionId).toBe('legacy-session');
      // conversation field should be undefined for legacy sessions
      expect(retrieved!.conversation).toBeUndefined();

      // Code consuming the session should treat undefined as empty array
      const effectiveConversation = retrieved!.conversation || [];
      expect(effectiveConversation).toEqual([]);
    });
  });

  describe('Session Update', () => {
    it('should allow updating conversation field via SessionUpdate', () => {
      // Create a new session
      const session = getOrCreateSession('test-session-conv-update');
      expect(session.conversation).toEqual([]);

      // Sample conversation messages
      const conversationMessages: OpenAIMessage[] = [
        { role: 'user', content: 'Hello, I want to create an API spec' },
        { role: 'assistant', content: 'I can help you with that. What interface would you like to work on?' },
        { role: 'user', content: 'The payment interface' },
      ];

      // Update the session with conversation
      const updated = updateSession('test-session-conv-update', {
        conversation: conversationMessages,
      });

      expect(updated).toBeDefined();
      expect(updated!.conversation).toEqual(conversationMessages);
      expect(updated!.conversation!.length).toBe(3);

      // Verify the update persisted
      const retrieved = getSession('test-session-conv-update');
      expect(retrieved!.conversation).toEqual(conversationMessages);
    });
  });

  describe('Session Serialization', () => {
    it('should correctly serialize/deserialize session with conversation data including tool calls', () => {
      // Create a session with complex conversation data
      const conversationWithToolCalls: OpenAIMessage[] = [
        { role: 'user', content: 'List all interfaces in architecture.json' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_123',
              type: 'function',
              function: {
                name: 'list_interfaces',
                arguments: '{"filename":"architecture.json"}',
              },
            },
          ],
        },
        {
          role: 'tool',
          content: '[{"interfaceId":"INT-001","interfaceName":"Payment API"}]',
          tool_call_id: 'call_123',
        },
        { role: 'assistant', content: 'I found the Payment API interface (INT-001).' },
      ];

      // Create session and update with conversation
      const session = getOrCreateSession('test-session-serialization');
      updateSession('test-session-serialization', {
        conversation: conversationWithToolCalls,
      });

      // Retrieve and verify all fields are preserved
      const retrieved = getSession('test-session-serialization');

      expect(retrieved).toBeDefined();
      expect(retrieved!.conversation).toBeDefined();
      expect(retrieved!.conversation!.length).toBe(4);

      // Verify user message
      expect(retrieved!.conversation![0].role).toBe('user');
      expect(retrieved!.conversation![0].content).toBe('List all interfaces in architecture.json');

      // Verify assistant message with tool calls
      expect(retrieved!.conversation![1].role).toBe('assistant');
      expect(retrieved!.conversation![1].tool_calls).toBeDefined();
      expect(retrieved!.conversation![1].tool_calls!.length).toBe(1);
      expect(retrieved!.conversation![1].tool_calls![0].id).toBe('call_123');
      expect(retrieved!.conversation![1].tool_calls![0].function.name).toBe('list_interfaces');

      // Verify tool result message
      expect(retrieved!.conversation![2].role).toBe('tool');
      expect(retrieved!.conversation![2].tool_call_id).toBe('call_123');

      // Verify final assistant response
      expect(retrieved!.conversation![3].role).toBe('assistant');
      expect(retrieved!.conversation![3].content).toContain('Payment API');
    });
  });
});
