/**
 * Tests for Chat API Client
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { postChatMessage, type ChatRequest, type ChatResponse } from '../api/chatApi';

describe('chatApi', () => {
  const mockFetch = vi.fn();
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = mockFetch;
    mockFetch.mockClear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('postChatMessage', () => {
    it('sends correct request payload with message and sessionId', async () => {
      const mockResponse: ChatResponse = {
        sessionId: 'session-123',
        assistant: {
          message: 'Hello! How can I help you?',
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const request: ChatRequest = {
        sessionId: 'session-123',
        message: 'Hello',
      };

      await postChatMessage(request);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/chat',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
        })
      );
    });

    it('handles successful response and parses JSON', async () => {
      const mockResponse: ChatResponse = {
        sessionId: 'session-456',
        assistant: {
          message: 'Here is your response',
          artifacts: {
            savedSpec: {
              interfaceId: 'int-001',
              interfaceName: 'UserAPI',
              architectureFilename: 'model.json',
              format: 'openapi',
              savedPath: '/specs/user-api.yaml',
              specLink: 'http://example.com/spec',
            },
          },
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await postChatMessage({ message: 'Generate spec' });

      expect(result).toEqual(mockResponse);
      expect(result.sessionId).toBe('session-456');
      expect(result.assistant.message).toBe('Here is your response');
      expect(result.assistant.artifacts?.savedSpec?.interfaceName).toBe('UserAPI');
    });

    it('throws on non-OK response status', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      await expect(postChatMessage({ message: 'Hello' }))
        .rejects
        .toThrow('Chat request failed: 500');
    });

    it('works without sessionId on first request', async () => {
      const mockResponse: ChatResponse = {
        sessionId: 'new-session-789',
        assistant: {
          message: 'Welcome! This is your first message.',
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const request: ChatRequest = {
        message: 'Hello, this is my first message',
      };

      const result = await postChatMessage(request);

      // Verify the request was sent without sessionId
      const fetchCall = mockFetch.mock.calls[0];
      const requestBody = JSON.parse(fetchCall[1].body);
      expect(requestBody.sessionId).toBeUndefined();
      expect(requestBody.message).toBe('Hello, this is my first message');

      // Verify the response provides a new sessionId
      expect(result.sessionId).toBe('new-session-789');
    });
  });
});
