/**
 * API Client Tests for generalized postGenerateArtifact response type
 *
 * Spec 2026-03-01: Hub Bootstrap 2 -- Roadmap (PM) End-to-End
 * Task Group 4, Task 4.1: Write 2 focused tests for the generalized API client
 *
 * Tests verify:
 * - postGenerateArtifact parses a response containing { success: true, artifactContent: '...' }
 *   and returns it with the artifactContent field accessible
 * - postGenerateArtifact parses a response containing { success: true, missionMarkdown: '...' }
 *   (legacy) and returns it with the missionMarkdown field accessible (backward compat)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { postGenerateArtifact } from '../api/chatV2Api';
import type { HubThreadKey } from '../api/chatV2Api';

// Mock global fetch (same pattern as chatV2-artifact-api.test.ts)
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('chatV2 API client generalization (Hub Bootstrap 2)', () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('postGenerateArtifact generalized response', () => {
    /**
     * Test 1: postGenerateArtifact parses a response containing
     * { success: true, artifactContent: '{"initiatives":[]}' }
     * and returns it with the artifactContent field accessible.
     */
    it('parses a response with artifactContent field (roadmap path) and makes it accessible', async () => {
      // Given
      const threadKey: HubThreadKey = { type: 'hub', projectId: 'test-proj' };
      const personaId = 'product-manager';
      const taskId = 'product-manager--roadmap';

      const mockResponse = {
        success: true,
        artifactContent: '{"initiatives":[]}',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      // When
      const result = await postGenerateArtifact(threadKey, personaId, taskId);

      // Then
      expect(result.success).toBe(true);
      expect(result.artifactContent).toBe('{"initiatives":[]}');
      // Verify the artifactContent can be parsed as valid JSON
      const parsed = JSON.parse(result.artifactContent!);
      expect(parsed).toEqual({ initiatives: [] });
    });

    /**
     * Test 2: postGenerateArtifact parses a response containing
     * { success: true, missionMarkdown: '# Mission' } (legacy)
     * and returns it with the missionMarkdown field accessible (backward compat).
     */
    it('parses a response with missionMarkdown field (legacy mission path) and makes it accessible', async () => {
      // Given
      const threadKey: HubThreadKey = { type: 'hub', projectId: 'test-proj' };
      const personaId = 'product-manager';
      const taskId = 'product-manager--define-product';

      const mockResponse = {
        success: true,
        missionMarkdown: '# Mission',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      // When
      const result = await postGenerateArtifact(threadKey, personaId, taskId);

      // Then
      expect(result.success).toBe(true);
      expect(result.missionMarkdown).toBe('# Mission');
    });
  });
});
