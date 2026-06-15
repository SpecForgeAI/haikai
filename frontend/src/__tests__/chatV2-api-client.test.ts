/**
 * API Client Tests for Chat V2 API
 *
 * Spec 2026-02-28: Unified Chat Panel v1 (Frontend)
 * Task Group 3, Task 3.1: Write 4 focused tests for the API client
 *
 * Tests verify:
 * - postChatV2 sends correct JSON body to /api/chat/v2 and returns parsed ChatV2Response
 * - postChatV2 throws on non-2xx response
 * - getThreadHistory calls GET /api/chat/v2/thread?key={serialized} and returns parsed Thread
 * - getThreadHistory throws on non-2xx response
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  postChatV2,
  getThreadHistory,
  generateMessageId,
} from '../api/chatV2Api';
import type { ChatV2Request, ChatV2Response, Thread, HubThreadKey } from '../api/chatV2Api';

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('chatV2Api', () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // postChatV2 Tests
  // ==========================================================================

  describe('postChatV2', () => {
    /**
     * Test 1: postChatV2 sends correct JSON body to /api/chat/v2
     * and returns parsed ChatV2Response.
     */
    it('sends correct JSON body to /api/chat/v2 and returns parsed ChatV2Response', async () => {
      // Given
      const request: ChatV2Request = {
        threadKey: { type: 'hub', projectId: 'proj-123' },
        personaId: 'assistant',
        taskId: 'unknown',
        message: 'Hello, assistant!',
      };

      const mockResponse: ChatV2Response = {
        threadKey: 'project:proj-123:hub',
        personaId: 'assistant',
        taskId: 'unknown',
        assistant: { message: 'Hello! How can I help you?' },
        structuredResponse: null,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      // When
      const result = await postChatV2(request);

      // Then
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe('/api/chat/v2');
      expect(options.method).toBe('POST');
      expect(options.headers).toEqual({ 'Content-Type': 'application/json' });

      const parsedBody = JSON.parse(options.body as string);
      expect(parsedBody).toEqual({
        threadKey: { type: 'hub', projectId: 'proj-123' },
        personaId: 'assistant',
        taskId: 'unknown',
        message: 'Hello, assistant!',
      });

      expect(result).toEqual(mockResponse);
      expect(result.assistant.message).toBe('Hello! How can I help you?');
      expect(result.personaId).toBe('assistant');
      expect(result.structuredResponse).toBeNull();
    });

    /**
     * Test 2: postChatV2 throws on non-2xx response.
     */
    it('throws on non-2xx response', async () => {
      // Given
      const request: ChatV2Request = {
        threadKey: { type: 'hub', projectId: 'proj-123' },
        personaId: 'assistant',
        taskId: 'unknown',
        message: 'Hello',
      };

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      // When/Then
      await expect(postChatV2(request)).rejects.toThrow(
        'Chat v2 request failed: 500'
      );

      // Verify it also throws on 400
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
      });

      await expect(postChatV2(request)).rejects.toThrow(
        'Chat v2 request failed: 400'
      );
    });
  });

  // ==========================================================================
  // getThreadHistory Tests
  // ==========================================================================

  describe('getThreadHistory', () => {
    /**
     * Test 3: getThreadHistory calls GET /api/chat/v2/thread?key={serialized}
     * and returns parsed Thread.
     */
    it('calls GET /api/chat/v2/thread?key={serialized} and returns parsed Thread', async () => {
      // Given
      const threadKey: HubThreadKey = { type: 'hub', projectId: 'proj-456' };

      const mockThread: Thread = {
        threadKey: 'project:proj-456:hub',
        projectId: 'proj-456',
        messages: [
          {
            id: 'msg-1',
            role: 'user',
            personaId: null,
            taskId: null,
            content: 'Hello',
            structuredResponse: null,
            timestamp: '2026-02-28T10:00:00.000Z',
          },
          {
            id: 'msg-2',
            role: 'assistant',
            personaId: 'assistant',
            taskId: 'unknown',
            content: 'Hi there!',
            structuredResponse: null,
            timestamp: '2026-02-28T10:00:01.000Z',
          },
        ],
        activePersonaId: 'assistant',
        activeTaskId: 'unknown',
        createdAt: '2026-02-28T10:00:00.000Z',
        updatedAt: '2026-02-28T10:00:01.000Z',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockThread,
      });

      // When
      const result = await getThreadHistory(threadKey);

      // Then
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const [url] = mockFetch.mock.calls[0];
      // threadKeyToString for hub key: project:proj-456:hub
      // encodeURIComponent('project:proj-456:hub') = 'project%3Aproj-456%3Ahub'
      expect(url).toBe(
        '/api/chat/v2/thread?key=project%3Aproj-456%3Ahub'
      );

      expect(result).toEqual(mockThread);
      expect(result.messages).toHaveLength(2);
      expect(result.activePersonaId).toBe('assistant');
      expect(result.projectId).toBe('proj-456');
    });

    /**
     * Test 4: getThreadHistory throws on non-2xx response.
     */
    it('throws on non-2xx response', async () => {
      // Given
      const threadKey: HubThreadKey = { type: 'hub', projectId: 'proj-789' };

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      // When/Then
      await expect(getThreadHistory(threadKey)).rejects.toThrow(
        'Thread history request failed: 404'
      );

      // Verify it also throws on 500
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      await expect(getThreadHistory(threadKey)).rejects.toThrow(
        'Thread history request failed: 500'
      );
    });
  });

  // ==========================================================================
  // generateMessageId Test (bonus utility verification)
  // ==========================================================================

  describe('generateMessageId', () => {
    it('generates unique message IDs with expected format', () => {
      const id1 = generateMessageId();
      const id2 = generateMessageId();

      // Verify format: msg-{timestamp}-{random}
      expect(id1).toMatch(/^msg-\d+-[a-z0-9]+$/);
      expect(id2).toMatch(/^msg-\d+-[a-z0-9]+$/);

      // Verify uniqueness
      expect(id1).not.toBe(id2);
    });
  });
});
