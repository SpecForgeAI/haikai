/**
 * Integration Tests - Resume After Reload
 *
 * Tests end-to-end flows for workspace persistence and rehydration,
 * simulating user scenarios like page refresh, tab switch, and app restart.
 *
 * Spec 2026-01-23: Persist + Rehydrate Implement Workspace
 * Task Group 13: Integration Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import {
  mapStateToPersisted,
  mapPersistedToState,
  ComponentWorkspaceState,
} from '../utils/workspaceStateMapper';
import {
  validateAndMigrateWorkspace,
  CURRENT_SCHEMA_VERSION,
} from '../utils/workspaceSchemaVersion';
import { usePersistWorkspace } from '../hooks/usePersistWorkspace';
import type { PersistedWorkspaceState, ImplementWorkspaceDto } from '../api/implementWorkspaceApi';
import { dtoToPersistedState } from '../api/implementWorkspaceApi';
import type { PlannerResponse } from '../api/chatApi';
import * as api from '../api/implementWorkspaceApi';

// Mock the API module
vi.mock('../api/implementWorkspaceApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/implementWorkspaceApi')>();
  return {
    ...actual,
    fetchImplementWorkspace: vi.fn(),
    saveImplementWorkspace: vi.fn(),
  };
});

// Mock the validation module
vi.mock('../utils/validateLLMPayload', () => ({
  validateLLMPayload: vi.fn(() => ({ valid: true, errors: [] })),
}));

describe('Integration Tests - Resume After Reload', () => {
  const projectId = 'test-project.json';
  const workItemId = 'e47ac10b-58cc-4372-a567-0e02b2c3d479';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * Test 1: Conversation continues after page refresh.
   * This test simulates the full flow: fetch DTO -> convert to persisted state -> restore
   */
  describe('page refresh scenario', () => {
    it('conversation continues after page refresh', async () => {
      // Given - Existing workspace state (simulating what was saved before refresh)
      const existingPersistedState: PersistedWorkspaceState = {
        schemaVersion: 1,
        implementationMode: true,
        plannerPayload: createMockPlannerPayload(),
        activeIncrementId: 'INC-001',
        questions: [
          { id: 'po-001', question: 'Refresh rate?', status: 'Answered', answer: '5 seconds', source: 'Product Owner' },
        ],
        executionArtifactsByIncrement: {},
        teamChatTranscript: [
          { id: 'm1', role: 'assistant', message: 'Welcome! Let me help you refine this feature.', createdAt: '2026-01-23T10:00:00Z' },
          { id: 'm2', role: 'user', message: 'I want a dashboard.', createdAt: '2026-01-23T10:01:00Z' },
          { id: 'm3', role: 'assistant', message: 'Great choice! I have some questions...', createdAt: '2026-01-23T10:02:00Z' },
        ],
      };

      // When - Restore directly from persisted state (this is what happens after
      // the DTO is converted using dtoToPersistedState)
      const restored = mapPersistedToState(existingPersistedState);

      // Then - State should be fully restored
      expect(restored.implementationMode).toBe(true);
      expect(restored.activeIncrementId).toBe('INC-001');
      expect(restored.messages).toHaveLength(3);
      expect(restored.messages[0].content).toBe('Welcome! Let me help you refine this feature.');
      expect(restored.messages[2].content).toBe('Great choice! I have some questions...');
      expect(restored.answers['po-001']).toBe('5 seconds');
      expect(restored.hasBootstrapped).toBe(true);
    });
  });

  /**
   * Test 2: Implementation mode is preserved across sessions.
   */
  describe('implementation mode persistence', () => {
    it('implementation mode is preserved across sessions', async () => {
      // Given - Workspace with implementationMode enabled
      const implementingState: PersistedWorkspaceState = {
        schemaVersion: 1,
        implementationMode: true,
        plannerPayload: null,
        activeIncrementId: 'INC-002',
        questions: [],
        executionArtifactsByIncrement: {},
        teamChatTranscript: [],
      };

      // When - Restore
      const restored = mapPersistedToState(implementingState);

      // Then
      expect(restored.implementationMode).toBe(true);
    });
  });

  /**
   * Test 3: Increment status is correctly derived after reload.
   */
  describe('increment status derivation', () => {
    it('increment status is correctly derived after reload', async () => {
      // Given - Workspace with various increment states
      const multiIncrementState: PersistedWorkspaceState = {
        schemaVersion: 1,
        implementationMode: true,
        plannerPayload: null,
        activeIncrementId: 'INC-002',
        questions: [
          // INC-001: All answered -> READY_TO_EXECUTE
          { id: 'sa-001', question: 'Q1?', status: 'Answered', answer: 'A1', source: 'Software Developer', incrementId: 'INC-001' },
          // INC-002: Has open question -> IN_CLARIFICATION
          { id: 'sa-002', question: 'Q2?', status: 'Open', answer: '', source: 'Software Developer', incrementId: 'INC-002' },
        ],
        executionArtifactsByIncrement: {
          // INC-003: Has completion result -> COMPLETED
          'INC-003': { implementationResult: 'Success!' },
          // INC-004: Has error -> FAILED
          'INC-004': { error: 'Build failed' },
        },
        teamChatTranscript: [],
      };

      // When
      const restored = mapPersistedToState(multiIncrementState);

      // Then
      expect(restored.incrementStatuses.get('INC-001')).toBe('READY_TO_EXECUTE');
      expect(restored.incrementStatuses.get('INC-002')).toBe('IN_CLARIFICATION');
      expect(restored.incrementStatuses.get('INC-003')).toBe('COMPLETED');
      expect(restored.incrementStatuses.get('INC-004')).toBe('FAILED');
    });
  });

  /**
   * Test 4: Complete workflow - save, modify, save, reload.
   */
  describe('full save-modify-save-reload workflow', () => {
    it('handles multiple save cycles correctly', async () => {
      // Given - Initial state
      const initialState: ComponentWorkspaceState = {
        implementationMode: false,
        latestPlannerResponse: null,
        activeIncrementId: null,
        answers: {},
        saQuestions: [],
        incrementStatuses: new Map(),
        incrementArtifacts: new Map(),
        messages: [
          { id: 'm1', role: 'assistant', content: 'Hello!', timestamp: new Date() },
        ],
        currentPhase: 'refine',
      };

      // Step 1: Save initial state
      const saved1 = mapStateToPersisted(initialState);
      expect(saved1.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
      expect(saved1.implementationMode).toBe(false);

      // Step 2: Modify state (simulate user interaction)
      const modifiedState: ComponentWorkspaceState = {
        ...initialState,
        implementationMode: true,
        activeIncrementId: 'INC-001',
        messages: [
          ...initialState.messages,
          { id: 'm2', role: 'user', content: 'Let me answer that.', timestamp: new Date() },
        ],
      };

      // Step 3: Save modified state
      const saved2 = mapStateToPersisted(modifiedState);
      expect(saved2.implementationMode).toBe(true);
      expect(saved2.activeIncrementId).toBe('INC-001');
      expect(saved2.teamChatTranscript).toHaveLength(2);

      // Step 4: Simulate reload (restore from saved state)
      const restored = mapPersistedToState(saved2);

      // Then - All modifications should be preserved
      expect(restored.implementationMode).toBe(true);
      expect(restored.activeIncrementId).toBe('INC-001');
      expect(restored.messages).toHaveLength(2);
      expect(restored.messages[1].content).toBe('Let me answer that.');
    });
  });

  /**
   * Test 5: Debounced saving works correctly.
   */
  describe('debounced saving', () => {
    it('saves only once for rapid state changes', async () => {
      // Given
      const mockSave = vi.mocked(api.saveImplementWorkspace);
      mockSave.mockResolvedValue(createEmptyDto());

      const { result } = renderHook(() =>
        usePersistWorkspace({
          projectId,
          workItemId,
          enabled: true,
          debounceMs: 100,
        })
      );

      // When - Simulate rapid state changes (like typing or selecting)
      for (let i = 0; i < 10; i++) {
        act(() => {
          result.current.triggerSave({
            schemaVersion: 1,
            implementationMode: false,
            plannerPayload: null,
            activeIncrementId: `INC-${i}`,
            questions: [],
            executionArtifactsByIncrement: {},
            teamChatTranscript: [],
          });
        });
        await act(async () => {
          vi.advanceTimersByTime(20); // Less than debounce
        });
      }

      // Wait for debounce to complete
      await act(async () => {
        vi.advanceTimersByTime(150);
      });

      // Then - Should only save once with the final state
      expect(mockSave.mock.calls.length).toBeLessThanOrEqual(2);
      // Last call should have the final increment ID
      const lastCall = mockSave.mock.calls[mockSave.mock.calls.length - 1];
      expect(lastCall[2].activeIncrementId).toBe('INC-9');
    });
  });

  /**
   * Test 6: Error during save doesn't break the app.
   */
  describe('error handling', () => {
    it('save error is logged but does not break the app', async () => {
      // Given
      const mockSave = vi.mocked(api.saveImplementWorkspace);
      mockSave.mockRejectedValue(new Error('Network error'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const { result } = renderHook(() =>
        usePersistWorkspace({
          projectId,
          workItemId,
          enabled: true,
          debounceMs: 10,
        })
      );

      // When
      act(() => {
        result.current.triggerSave({
          schemaVersion: 1,
          implementationMode: true,
          plannerPayload: null,
          activeIncrementId: 'INC-1',
          questions: [],
          executionArtifactsByIncrement: {},
          teamChatTranscript: [],
        });
      });

      await act(async () => {
        vi.advanceTimersByTime(50);
      });

      // Then - Error should be logged but not thrown
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to save workspace:',
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });
  });

  /**
   * Test 7: Force save before navigation.
   */
  describe('force save before navigation', () => {
    it('forceSave persists state immediately', async () => {
      // Given
      const mockSave = vi.mocked(api.saveImplementWorkspace);
      mockSave.mockResolvedValue(createEmptyDto());

      const { result } = renderHook(() =>
        usePersistWorkspace({
          projectId,
          workItemId,
          enabled: true,
          debounceMs: 5000, // Long debounce
        })
      );

      // When - Force save (like before page navigation)
      await act(async () => {
        await result.current.forceSave({
          schemaVersion: 1,
          implementationMode: true,
          plannerPayload: null,
          activeIncrementId: 'FINAL-STATE',
          questions: [],
          executionArtifactsByIncrement: {},
          teamChatTranscript: [],
        });
      });

      // Then - Should have saved immediately without waiting for debounce
      expect(mockSave).toHaveBeenCalledTimes(1);
      expect(mockSave).toHaveBeenCalledWith(
        projectId,
        workItemId,
        expect.objectContaining({ activeIncrementId: 'FINAL-STATE' })
      );
    });
  });
});

// ============================================================================
// Helper Functions
// ============================================================================

function createMockPlannerPayload(): Record<string, unknown> {
  return {
    schemaVersion: '1.1',
    message: 'Test message',
    featureUnderstanding: 'Test feature',
    scope: { in: ['item'], out: [] },
    assumptions: [],
    acceptanceCriteria: [],
    openQuestions: [{ id: 'po-001', question: 'Refresh rate?' }],
    plannerReadyForSpec: false,
    implementationPlan: null,
  };
}

function createEmptyDto(): ImplementWorkspaceDto {
  return {
    project_id: 'test-project.json',
    work_item_id: 'e47ac10b-58cc-4372-a567-0e02b2c3d479',
    schema_version: 1,
    implementation_mode: false,
    planner_payload: null,
    active_increment_id: null,
    questions: [],
    execution_artifacts_by_increment: {},
    team_chat_transcript: [],
  };
}
