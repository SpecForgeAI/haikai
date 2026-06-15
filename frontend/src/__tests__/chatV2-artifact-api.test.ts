/**
 * API Client Tests for postGenerateArtifact and postSaveArtifact
 *
 * Spec 2026-02-28: Hub Bootstrap 1 -- Product Definition (PM) End-to-End
 * Task Group 3, Task 3.1: Write 4 focused tests for the new API client functions
 *
 * Tests verify:
 * - postGenerateArtifact sends correct JSON body { threadKey, personaId, taskId } to /api/chat/v2/generate via POST and returns parsed response on 200
 * - postGenerateArtifact throws on non-2xx response
 * - postSaveArtifact sends correct JSON body { threadKey, taskId, artifactId, content } to /api/chat/v2/save-artifact via POST and returns parsed response on 200
 * - postSaveArtifact throws on non-2xx response
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { postGenerateArtifact, postSaveArtifact } from '../api/chatV2Api';
import type { HubThreadKey } from '../api/chatV2Api';

// Mock global fetch (same pattern as chatV2-api-client.test.ts and chatV2-postHandoff.test.ts)
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('chatV2 artifact API', () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // postGenerateArtifact Tests
  // ==========================================================================

  describe('postGenerateArtifact', () => {
    /**
     * Test 1: postGenerateArtifact sends correct JSON body { threadKey, personaId, taskId }
     * to /api/chat/v2/generate via POST and returns parsed response on 200.
     */
    it('sends correct JSON body { threadKey, personaId, taskId } to /api/chat/v2/generate via POST and returns parsed response on 200', async () => {
      // Given
      const threadKey: HubThreadKey = { type: 'hub', projectId: 'test-proj' };
      const personaId = 'product-manager';
      const taskId = 'product-manager--define-product';

      const mockResponse = {
        success: true,
        missionMarkdown: '# Product Mission\n\nThis is the mission statement.',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      // When
      const result = await postGenerateArtifact(threadKey, personaId, taskId);

      // Then
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe('/api/chat/v2/generate');
      expect(options.method).toBe('POST');
      expect(options.headers).toEqual({ 'Content-Type': 'application/json' });

      const parsedBody = JSON.parse(options.body as string);
      expect(parsedBody).toEqual({
        threadKey: { type: 'hub', projectId: 'test-proj' },
        personaId: 'product-manager',
        taskId: 'product-manager--define-product',
      });

      expect(result).toEqual(mockResponse);
      expect(result.success).toBe(true);
      expect(result.missionMarkdown).toBe('# Product Mission\n\nThis is the mission statement.');
    });

    /**
     * Test 2: postGenerateArtifact throws on non-2xx response.
     */
    it('throws on non-2xx response', async () => {
      // Given
      const threadKey: HubThreadKey = { type: 'hub', projectId: 'test-proj' };
      const personaId = 'product-manager';
      const taskId = 'product-manager--define-product';

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      // When/Then
      await expect(postGenerateArtifact(threadKey, personaId, taskId)).rejects.toThrow(
        'Generate artifact request failed: 500'
      );

      // Verify it also throws on 400
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
      });

      await expect(postGenerateArtifact(threadKey, personaId, taskId)).rejects.toThrow(
        'Generate artifact request failed: 400'
      );
    });
  });

  // ==========================================================================
  // postSaveArtifact Tests
  // ==========================================================================

  describe('postSaveArtifact', () => {
    /**
     * Test 3: postSaveArtifact sends correct JSON body { threadKey, taskId, artifactId, content }
     * to /api/chat/v2/save-artifact via POST and returns parsed response on 200.
     */
    it('sends correct JSON body { threadKey, taskId, artifactId, content } to /api/chat/v2/save-artifact via POST and returns parsed response on 200', async () => {
      // Given
      const threadKey: HubThreadKey = { type: 'hub', projectId: 'test-proj' };
      const taskId = 'product-manager--define-product';
      const artifactId = 'mission-md';
      const content = '# Product Mission\n\nThis is the mission statement.';

      const mockResponse = {
        success: true,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      // When
      const result = await postSaveArtifact(threadKey, taskId, artifactId, content);

      // Then
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe('/api/chat/v2/save-artifact');
      expect(options.method).toBe('POST');
      expect(options.headers).toEqual({ 'Content-Type': 'application/json' });

      const parsedBody = JSON.parse(options.body as string);
      expect(parsedBody).toEqual({
        threadKey: { type: 'hub', projectId: 'test-proj' },
        taskId: 'product-manager--define-product',
        artifactId: 'mission-md',
        content: '# Product Mission\n\nThis is the mission statement.',
      });

      expect(result).toEqual(mockResponse);
      expect(result.success).toBe(true);
    });

    /**
     * Test 4: postSaveArtifact throws on non-2xx response.
     */
    it('throws on non-2xx response', async () => {
      // Given
      const threadKey: HubThreadKey = { type: 'hub', projectId: 'test-proj' };
      const taskId = 'product-manager--define-product';
      const artifactId = 'mission-md';
      const content = '# Product Mission\n\nThis is the mission statement.';

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      // When/Then
      await expect(postSaveArtifact(threadKey, taskId, artifactId, content)).rejects.toThrow(
        'Save artifact request failed: 500'
      );

      // Verify it also throws on 400
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
      });

      await expect(postSaveArtifact(threadKey, taskId, artifactId, content)).rejects.toThrow(
        'Save artifact request failed: 400'
      );
    });
  });
});
