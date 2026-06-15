/**
 * API Client Tests for postHandoff
 *
 * Spec 2026-02-28: Hub Chat MVP v1 (Frontend + Backend Wiring)
 * Task Group 2, Task 2.1: Write 2 focused tests for the postHandoff function
 *
 * Tests verify:
 * - postHandoff sends correct JSON body { threadKey, personaId } to /api/chat/v2/handoff via POST and resolves on 200
 * - postHandoff throws on non-2xx response (matching postChatV2 error pattern)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { postHandoff } from '../api/chatV2Api';
import type { HubThreadKey } from '../api/chatV2Api';

// Mock global fetch (same pattern as chatV2-api-client.test.ts)
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('postHandoff', () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Test 1: postHandoff sends correct JSON body { threadKey, personaId }
   * to /api/chat/v2/handoff via POST and resolves successfully on 200.
   */
  it('sends correct JSON body { threadKey, personaId } to /api/chat/v2/handoff via POST and resolves on 200', async () => {
    // Given
    const threadKey: HubThreadKey = { type: 'hub', projectId: 'test-proj' };
    const personaId = 'architect';

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, threadKey: 'project:test-proj:hub' }),
    });

    // When
    await postHandoff(threadKey, personaId);

    // Then
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/chat/v2/handoff');
    expect(options.method).toBe('POST');
    expect(options.headers).toEqual({ 'Content-Type': 'application/json' });

    const parsedBody = JSON.parse(options.body as string);
    expect(parsedBody).toEqual({
      threadKey: { type: 'hub', projectId: 'test-proj' },
      personaId: 'architect',
    });
  });

  /**
   * Test 2: postHandoff throws on non-2xx response
   * (matching postChatV2 error pattern).
   */
  it('throws on non-2xx response', async () => {
    // Given
    const threadKey: HubThreadKey = { type: 'hub', projectId: 'test-proj' };
    const personaId = 'architect';

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
    });

    // When/Then
    await expect(postHandoff(threadKey, personaId)).rejects.toThrow(
      'Handoff failed with status 500'
    );

    // Verify it also throws on 400
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
    });

    await expect(postHandoff(threadKey, personaId)).rejects.toThrow(
      'Handoff failed with status 400'
    );
  });
});
