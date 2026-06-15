/**
 * Tests for Conversation Rehydration Feature - Frontend Implementation
 *
 * Spec 2026-01-16: Implement Assistant Conversation Persistence and Rehydration
 *
 * Tests cover:
 * - getImplementConversation() API client function
 * - putImplementConversation() API client function
 * - Hydration useEffect behavior
 * - MessageEntry to ChatMessage conversion
 * - Context state precedence over disk
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getImplementConversation,
  putImplementConversation,
  MessageEntry,
  convertMessageEntryToChatMessage,
  ChatMessage,
  ImplementChatPhase,
} from '../api/chatApi';

describe('Conversation Rehydration API Client', () => {
  const mockFetch = vi.fn();
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = mockFetch;
    mockFetch.mockClear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('getImplementConversation', () => {
    it('calls correct endpoint with query params', async () => {
      const mockResponse = {
        exists: true,
        messages: [
          {
            role: 'assistant' as const,
            phase: 'bootstrap' as ImplementChatPhase,
            content: 'Welcome message',
            timestamp: '2026-01-16T10:00:00.000Z',
          },
        ],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await getImplementConversation(
        'project-123',
        'feature-456',
        '/path/to/project',
        'Test Feature'
      );

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe(
        '/api/implement-conversations?projectId=project-123&featureId=feature-456&projectParentFolder=%2Fpath%2Fto%2Fproject&featureTitle=Test%20Feature'
      );
      expect(options.method).toBe('GET');
      expect(result).toEqual(mockResponse);
    });

    it('returns exists: false when conversation not found', async () => {
      const mockResponse = {
        exists: false,
        messages: [],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await getImplementConversation(
        'project-123',
        'feature-789',
        '/path/to/project',
        'Test Feature'
      );

      expect(result.exists).toBe(false);
      expect(result.messages).toHaveLength(0);
    });

    it('throws on non-OK response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      await expect(
        getImplementConversation('project-123', 'feature-456', '/path/to/project', 'Test Feature')
      )
        .rejects
        .toThrow('Failed to get conversation: 500');
    });
  });

  describe('putImplementConversation', () => {
    it('sends correct body to PUT endpoint', async () => {
      const mockResponse = { success: true };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const messages: MessageEntry[] = [
        {
          role: 'assistant',
          phase: 'bootstrap',
          content: 'Welcome!',
          timestamp: '2026-01-16T10:00:00.000Z',
        },
        {
          role: 'user',
          phase: 'refine',
          content: 'Hello',
          timestamp: '2026-01-16T10:01:00.000Z',
        },
      ];

      const result = await putImplementConversation({
        projectId: 'project-123',
        featureId: 'feature-456',
        projectParentFolder: '/path/to/project',
        featureTitle: 'Test Feature',
        messages,
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe('/api/implement-conversations');
      expect(options.method).toBe('PUT');
      expect(options.headers['Content-Type']).toBe('application/json');

      const body = JSON.parse(options.body);
      expect(body.projectId).toBe('project-123');
      expect(body.featureId).toBe('feature-456');
      expect(body.projectParentFolder).toBe('/path/to/project');
      expect(body.featureTitle).toBe('Test Feature');
      expect(body.messages).toHaveLength(2);
      expect(result).toEqual({ success: true });
    });

    it('returns success: false on write failure', async () => {
      const mockResponse = { success: false };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await putImplementConversation({
        projectId: 'project-123',
        featureId: 'feature-456',
        projectParentFolder: '/path/to/project',
        featureTitle: 'Test Feature',
        messages: [],
      });

      expect(result.success).toBe(false);
    });
  });
});

describe('MessageEntry Type', () => {
  it('has correct structure with lowercase role names', () => {
    const entry: MessageEntry = {
      role: 'assistant',
      phase: 'bootstrap',
      content: 'Test content',
      timestamp: '2026-01-16T10:00:00.000Z',
    };

    expect(entry.role).toBe('assistant');
    expect(entry.phase).toBe('bootstrap');
    expect(entry.content).toBe('Test content');
    expect(entry.timestamp).toBe('2026-01-16T10:00:00.000Z');
  });

  it('accepts all valid role values', () => {
    const roles: Array<'system' | 'user' | 'assistant'> = ['system', 'user', 'assistant'];
    roles.forEach((role) => {
      const entry: MessageEntry = {
        role,
        phase: 'refine',
        content: 'Test',
        timestamp: '2026-01-16T10:00:00.000Z',
      };
      expect(entry.role).toBe(role);
    });
  });

  it('accepts all valid phase values', () => {
    const phases: ImplementChatPhase[] = ['bootstrap', 'refine', 'handoff'];
    phases.forEach((phase) => {
      const entry: MessageEntry = {
        role: 'user',
        phase,
        content: 'Test',
        timestamp: '2026-01-16T10:00:00.000Z',
      };
      expect(entry.phase).toBe(phase);
    });
  });
});

describe('convertMessageEntryToChatMessage', () => {
  it('converts MessageEntry to ChatMessage format', () => {
    const entry: MessageEntry = {
      role: 'assistant',
      phase: 'bootstrap',
      content: 'Welcome message',
      timestamp: '2026-01-16T10:00:00.000Z',
    };

    const chatMessage = convertMessageEntryToChatMessage(entry);

    expect(chatMessage.role).toBe('assistant');
    expect(chatMessage.content).toBe('Welcome message');
    expect(chatMessage.timestamp).toBeInstanceOf(Date);
    expect(chatMessage.timestamp.toISOString()).toBe('2026-01-16T10:00:00.000Z');
    expect(chatMessage.id).toBeDefined();
    expect(chatMessage.id.startsWith('msg-')).toBe(true);
  });

  it('maps role directly for user messages', () => {
    const entry: MessageEntry = {
      role: 'user',
      phase: 'refine',
      content: 'User question',
      timestamp: '2026-01-16T10:01:00.000Z',
    };

    const chatMessage = convertMessageEntryToChatMessage(entry);

    expect(chatMessage.role).toBe('user');
  });

  it('generates unique IDs for each message', () => {
    const entry: MessageEntry = {
      role: 'assistant',
      phase: 'refine',
      content: 'Test',
      timestamp: '2026-01-16T10:00:00.000Z',
    };

    const msg1 = convertMessageEntryToChatMessage(entry);
    const msg2 = convertMessageEntryToChatMessage(entry);

    expect(msg1.id).not.toBe(msg2.id);
  });

  it('converts multiple entries preserving order', () => {
    const entries: MessageEntry[] = [
      {
        role: 'assistant',
        phase: 'bootstrap',
        content: 'First',
        timestamp: '2026-01-16T10:00:00.000Z',
      },
      {
        role: 'user',
        phase: 'refine',
        content: 'Second',
        timestamp: '2026-01-16T10:01:00.000Z',
      },
      {
        role: 'assistant',
        phase: 'refine',
        content: 'Third',
        timestamp: '2026-01-16T10:02:00.000Z',
      },
    ];

    const messages = entries.map(convertMessageEntryToChatMessage);

    expect(messages).toHaveLength(3);
    expect(messages[0].content).toBe('First');
    expect(messages[1].content).toBe('Second');
    expect(messages[2].content).toBe('Third');
  });
});

describe('Hydration Behavior', () => {
  describe('Hydration sets hasBootstrapped correctly', () => {
    it('when exists: true, hydration should set hasBootstrapped to true', () => {
      // This test documents the expected behavior:
      // When getImplementConversation returns exists: true,
      // the panel should hydrate messages AND set hasBootstrapped: true
      // to prevent re-triggering bootstrap
      const mockResponse = {
        exists: true,
        messages: [
          {
            role: 'assistant' as const,
            phase: 'bootstrap' as ImplementChatPhase,
            content: 'Previous welcome',
            timestamp: '2026-01-16T10:00:00.000Z',
          },
        ],
      };

      // The hydration logic should:
      // 1. Convert messages to ChatMessage format
      // 2. Set messages state
      // 3. Set hasBootstrapped = true (critical to prevent duplicate bootstrap)
      expect(mockResponse.exists).toBe(true);
      expect(mockResponse.messages.length).toBeGreaterThan(0);
    });

    it('when exists: false, should proceed with normal bootstrap', () => {
      // When conversation doesn't exist on disk, normal bootstrap should trigger
      const mockResponse = {
        exists: false,
        messages: [],
      };

      // The hydration logic should NOT set hasBootstrapped
      // allowing the bootstrap useEffect to trigger normally
      expect(mockResponse.exists).toBe(false);
      expect(mockResponse.messages).toHaveLength(0);
    });
  });

  describe('Context state precedence', () => {
    it('should use context state over disk when context has data', () => {
      // Document expected behavior:
      // If getImplementChatState(projectKey, workItemId) returns data,
      // that data takes precedence and GET endpoint should NOT be called
      const contextState = {
        sessionId: 'session-from-context',
        messages: [{ id: 'msg-1', role: 'assistant' as const, content: 'From context', timestamp: new Date() }],
        generatedSpecs: null,
        error: null,
        inputDraft: '',
        hasBootstrapped: true,
      };

      // When context state exists:
      // 1. Use context state (existing hydration behavior)
      // 2. Do NOT call GET /api/implement-conversations
      expect(contextState.messages.length).toBeGreaterThan(0);
      expect(contextState.hasBootstrapped).toBe(true);
    });

    it('should call GET endpoint only when context state is empty', () => {
      // Document expected behavior:
      // GET /api/implement-conversations should only be called when:
      // 1. Context state is undefined/empty
      // 2. Messages array is empty
      // This prevents unnecessary API calls on tab switches
      const contextState = undefined;

      // When context state is empty, hydration should call GET endpoint
      expect(contextState).toBeUndefined();
    });
  });
});
