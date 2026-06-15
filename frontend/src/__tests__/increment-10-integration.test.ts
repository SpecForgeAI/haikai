/**
 * Increment 10 Frontend Integration Tests -- Gap Analysis Coverage
 *
 * Spec 2026-03-02: Legacy Chat Removal and Cleanup (Increment 10)
 * Task Group 4, Task 4.3: Strategic tests to fill frontend coverage gaps
 *
 * These tests verify frontend integration points NOT already covered by TG3:
 *
 * 1. postChatMessage returns a ChatResponse that structurally excludes
 *    legacy fields (productManagerResponse, solutionArchitectResponse,
 *    roadmapPmResponse) when the mock server omits them
 * 2. ChatPanel (OAS assistant) can be imported without errors after cleanup --
 *    verifies no broken import chain from deleted legacy panel components
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ChatResponse, ChatRequest } from '../api/chatApi';
import { postChatMessage } from '../api/chatApi';

describe('Increment 10 Frontend Integration -- Gap Coverage', () => {
  // -------------------------------------------------------------------------
  // Gap 1: postChatMessage returns ChatResponse without legacy fields
  // -------------------------------------------------------------------------
  describe('postChatMessage returns ChatResponse without legacy fields', () => {
    const mockFetch = vi.fn();
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
      globalThis.fetch = mockFetch;
      mockFetch.mockClear();
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('returns a ChatResponse with only surviving fields when mode is oas_assistant', async () => {
      const serverResponse: ChatResponse = {
        sessionId: 'oas-session-1',
        assistant: {
          message: 'I can help you generate an OpenAPI specification. Please provide the filename.',
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(serverResponse),
      });

      const request: ChatRequest = {
        message: 'Help me generate an OAS spec',
        context: {
          mode: 'oas_assistant',
          filename: 'my-project.json',
        },
      };

      const result = await postChatMessage(request);

      // Verify the response has the expected fields
      expect(result.sessionId).toBe('oas-session-1');
      expect(result.assistant.message).toContain('OpenAPI');

      // Verify legacy fields are absent from the response
      const asRecord = result as Record<string, unknown>;
      expect(asRecord['productManagerResponse']).toBeUndefined();
      expect(asRecord['solutionArchitectResponse']).toBeUndefined();
      expect(asRecord['roadmapPmResponse']).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Gap 2: ChatPanel (OAS) can be imported without broken imports
  // -------------------------------------------------------------------------
  describe('ChatPanel (OAS assistant) import chain intact', () => {
    it('ChatPanel module can be dynamically imported without errors', async () => {
      // This test verifies the ChatPanel component file has no broken imports
      // to deleted legacy panel components. A dynamic import will throw if
      // the module or any of its transitive imports are missing.
      const module = await import('../components/chat/ChatPanel');
      expect(module).toBeDefined();
      expect(typeof module.ChatPanel).toBe('function');
    });
  });
});
