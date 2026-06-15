/**
 * API Client Tests for allowedPersonaIds Pass-Through
 *
 * Spec 2026-03-03: Unify Hub and RHS Panel Capabilities
 * Task Group 2, Task 2.1: Write 4 focused tests for allowedPersonaIds pass-through
 *
 * Tests verify:
 * - Test 1: postChatV2 includes allowedPersonaIds in request body when provided
 * - Test 2: postChatV2 omits allowedPersonaIds when not provided
 * - Test 3: postGenerateArtifact includes allowedPersonaIds in request body when provided
 * - Test 4: postSaveArtifact includes allowedPersonaIds in request body when provided
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  postChatV2,
  postGenerateArtifact,
  postSaveArtifact,
} from '../api/chatV2Api';
import type { ChatV2Request, HubThreadKey, PanelThreadKey } from '../api/chatV2Api';

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('chatV2 allowedPersonaIds pass-through', () => {
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
     * Test 1: postChatV2 includes allowedPersonaIds in request body when provided.
     */
    it('includes allowedPersonaIds in request body when provided', async () => {
      // Given
      const request: ChatV2Request = {
        threadKey: { type: 'panel', projectId: 'proj-1', screen: 'metamodel' },
        personaId: 'architect',
        taskId: 'unknown',
        message: 'Hello',
        allowedPersonaIds: ['architect', 'ux-designer', 'test-engineer'],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          threadKey: 'project:proj-1:panel:metamodel',
          personaId: 'architect',
          taskId: 'unknown',
          assistant: { message: 'Hi' },
          structuredResponse: null,
        }),
      });

      // When
      await postChatV2(request);

      // Then
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [, options] = mockFetch.mock.calls[0];
      const parsedBody = JSON.parse(options.body as string);
      expect(parsedBody.allowedPersonaIds).toEqual(['architect', 'ux-designer', 'test-engineer']);
    });

    /**
     * Test 2: postChatV2 omits allowedPersonaIds when not provided.
     */
    it('omits allowedPersonaIds when not provided', async () => {
      // Given
      const request: ChatV2Request = {
        threadKey: { type: 'hub', projectId: 'proj-2' },
        personaId: 'assistant',
        taskId: 'unknown',
        message: 'Hello',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          threadKey: 'project:proj-2:hub',
          personaId: 'assistant',
          taskId: 'unknown',
          assistant: { message: 'Hi' },
          structuredResponse: null,
        }),
      });

      // When
      await postChatV2(request);

      // Then
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [, options] = mockFetch.mock.calls[0];
      const parsedBody = JSON.parse(options.body as string);
      expect(parsedBody).not.toHaveProperty('allowedPersonaIds');
    });
  });

  // ==========================================================================
  // postGenerateArtifact Tests
  // ==========================================================================

  describe('postGenerateArtifact', () => {
    /**
     * Test 3: postGenerateArtifact includes allowedPersonaIds in request body when provided.
     */
    it('includes allowedPersonaIds in request body when provided', async () => {
      // Given
      const threadKey: PanelThreadKey = { type: 'panel', projectId: 'proj-3', screen: 'metamodel' };
      const personaId = 'architect';
      const taskId = 'architect--define-architecture';
      const allowedPersonaIds = ['architect', 'test-engineer'];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, artifactContent: '# Architecture' }),
      });

      // When
      await postGenerateArtifact(threadKey, personaId, taskId, allowedPersonaIds);

      // Then
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe('/api/chat/v2/generate');
      const parsedBody = JSON.parse(options.body as string);
      expect(parsedBody.allowedPersonaIds).toEqual(['architect', 'test-engineer']);
    });
  });

  // ==========================================================================
  // postSaveArtifact Tests
  // ==========================================================================

  describe('postSaveArtifact', () => {
    /**
     * Test 4: postSaveArtifact includes allowedPersonaIds in request body when provided.
     */
    it('includes allowedPersonaIds in request body when provided', async () => {
      // Given
      const threadKey: PanelThreadKey = { type: 'panel', projectId: 'proj-4', screen: 'metamodel' };
      const taskId = 'architect--define-architecture';
      const artifactId = 'architecture-baseline';
      const content = '# Architecture Baseline';
      const allowedPersonaIds = ['architect', 'ux-designer'];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      // When
      await postSaveArtifact(threadKey, taskId, artifactId, content, allowedPersonaIds);

      // Then
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe('/api/chat/v2/save-artifact');
      const parsedBody = JSON.parse(options.body as string);
      expect(parsedBody.allowedPersonaIds).toEqual(['architect', 'ux-designer']);
    });
  });
});
