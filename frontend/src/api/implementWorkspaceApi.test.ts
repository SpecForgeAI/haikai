/**
 * Tests for Implement Workspace API Client
 *
 * Spec 2026-01-23: Persist + Rehydrate Implement Workspace
 * Task Group 4: Frontend API Functions
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fetchImplementWorkspace,
  saveImplementWorkspace,
  ImplementWorkspaceDto,
  PersistedWorkspaceState,
} from './implementWorkspaceApi';

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('implementWorkspaceApi', () => {
  const projectId = 'test-project.json';
  const workItemId = 'e47ac10b-58cc-4372-a567-0e02b2c3d479';

  beforeEach(() => {
    mockFetch.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Test 1: fetchImplementWorkspace calls GET endpoint and returns parsed response.
   */
  describe('fetchImplementWorkspace', () => {
    it('calls GET endpoint and returns parsed response', async () => {
      // Given
      const mockDto: ImplementWorkspaceDto = {
        project_id: projectId,
        work_item_id: workItemId,
        schema_version: 1,
        implementation_mode: true,
        planner_payload: { featureUnderstanding: 'Test feature' },
        active_increment_id: 'INC-1',
        questions: [{ id: 'q1', question: 'What is X?', status: 'Open', answer: '', source: 'Product Manager' }],
        execution_artifacts_by_increment: { 'INC-1': { shapeSpecArtifact: 'spec' } },
        team_chat_transcript: [{ id: 'm1', role: 'assistant', message: 'Hello', createdAt: '2026-01-23T10:00:00Z' }],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockDto,
      });

      // When
      const result = await fetchImplementWorkspace(projectId, workItemId);

      // Then
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(`/api/projects/${encodeURIComponent(projectId)}/work-items/${encodeURIComponent(workItemId)}/implement-workspace`),
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'Accept': 'application/json',
          }),
        })
      );
      expect(result).toEqual(mockDto);
      expect(result.schema_version).toBe(1);
      expect(result.implementation_mode).toBe(true);
      expect(result.active_increment_id).toBe('INC-1');
    });
  });

  /**
   * Test 2: saveImplementWorkspace calls PUT endpoint with correct payload.
   */
  describe('saveImplementWorkspace', () => {
    it('calls PUT endpoint with correct payload', async () => {
      // Given
      const workspaceState: PersistedWorkspaceState = {
        schemaVersion: 1,
        implementationMode: true,
        plannerPayload: { featureUnderstanding: 'Updated feature' },
        activeIncrementId: 'INC-2',
        questions: [],
        executionArtifactsByIncrement: {},
        teamChatTranscript: [],
      };

      const mockDto: ImplementWorkspaceDto = {
        project_id: projectId,
        work_item_id: workItemId,
        schema_version: 1,
        implementation_mode: true,
        planner_payload: { featureUnderstanding: 'Updated feature' },
        active_increment_id: 'INC-2',
        questions: [],
        execution_artifacts_by_increment: {},
        team_chat_transcript: [],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockDto,
      });

      // When
      const result = await saveImplementWorkspace(projectId, workItemId, workspaceState);

      // Then
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(`/api/projects/${encodeURIComponent(projectId)}/work-items/${encodeURIComponent(workItemId)}/implement-workspace`),
        expect.objectContaining({
          method: 'PUT',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          }),
          body: JSON.stringify({ workspace_state: workspaceState }),
        })
      );
      expect(result).toEqual(mockDto);
    });
  });

  /**
   * Test 3: API functions handle errors gracefully (throw on non-OK response).
   */
  describe('error handling', () => {
    it('fetchImplementWorkspace throws on non-OK response', async () => {
      // Given
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      // When/Then
      await expect(fetchImplementWorkspace(projectId, workItemId))
        .rejects
        .toThrow('Failed to fetch implement workspace: 500');
    });

    it('saveImplementWorkspace throws on non-OK response', async () => {
      // Given
      const workspaceState: PersistedWorkspaceState = {
        schemaVersion: 1,
        implementationMode: false,
        plannerPayload: null,
        activeIncrementId: null,
        questions: [],
        executionArtifactsByIncrement: {},
        teamChatTranscript: [],
      };

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
      });

      // When/Then
      await expect(saveImplementWorkspace(projectId, workItemId, workspaceState))
        .rejects
        .toThrow('Failed to save implement workspace: 400');
    });
  });
});
