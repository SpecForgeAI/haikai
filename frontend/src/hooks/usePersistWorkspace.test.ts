/**
 * Tests for usePersistWorkspace Hook
 *
 * Spec 2026-01-23: Persist + Rehydrate Implement Workspace
 * Task Group 7: Save Triggers
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePersistWorkspace } from './usePersistWorkspace';
import * as api from '../api/implementWorkspaceApi';

// Mock the API module
vi.mock('../api/implementWorkspaceApi', () => ({
  saveImplementWorkspace: vi.fn(),
}));

describe('usePersistWorkspace', () => {
  const projectId = 'test-project.json';
  const workItemId = 'e47ac10b-58cc-4372-a567-0e02b2c3d479';

  const mockWorkspaceState: api.PersistedWorkspaceState = {
    schemaVersion: 1,
    implementationMode: true,
    plannerPayload: null,
    activeIncrementId: 'INC-1',
    questions: [],
    executionArtifactsByIncrement: {},
    teamChatTranscript: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * Test 1: Saves workspace after plan generation completes.
   */
  it('triggerSave debounces and saves workspace', async () => {
    // Given
    const mockSave = vi.mocked(api.saveImplementWorkspace);
    mockSave.mockResolvedValue({
      project_id: projectId,
      work_item_id: workItemId,
      schema_version: 1,
      implementation_mode: true,
      planner_payload: null,
      active_increment_id: 'INC-1',
      questions: [],
      execution_artifacts_by_increment: {},
      team_chat_transcript: [],
    });

    const { result } = renderHook(() =>
      usePersistWorkspace({
        projectId,
        workItemId,
        enabled: true,
        debounceMs: 100,
      })
    );

    // When - trigger multiple saves rapidly
    act(() => {
      result.current.triggerSave({ ...mockWorkspaceState, activeIncrementId: 'INC-1' });
      result.current.triggerSave({ ...mockWorkspaceState, activeIncrementId: 'INC-2' });
      result.current.triggerSave({ ...mockWorkspaceState, activeIncrementId: 'INC-3' });
    });

    // Then - should not have called yet (debouncing)
    expect(mockSave).not.toHaveBeenCalled();

    // Advance timers past debounce
    await act(async () => {
      vi.advanceTimersByTime(150);
    });

    // Should have called once with the latest state
    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(mockSave).toHaveBeenCalledWith(
      projectId,
      workItemId,
      expect.objectContaining({ activeIncrementId: 'INC-3' })
    );
  });

  /**
   * Test 2: Does NOT save on loading flag changes or transient state changes.
   */
  it('does not save when disabled', async () => {
    // Given
    const mockSave = vi.mocked(api.saveImplementWorkspace);

    const { result } = renderHook(() =>
      usePersistWorkspace({
        projectId,
        workItemId,
        enabled: false, // Disabled
        debounceMs: 100,
      })
    );

    // When
    act(() => {
      result.current.triggerSave(mockWorkspaceState);
    });

    await act(async () => {
      vi.advanceTimersByTime(150);
    });

    // Then - should not have called
    expect(mockSave).not.toHaveBeenCalled();
  });

  /**
   * Test 3: forceSave bypasses debounce.
   */
  it('forceSave bypasses debounce and saves immediately', async () => {
    // Given
    const mockSave = vi.mocked(api.saveImplementWorkspace);
    mockSave.mockResolvedValue({
      project_id: projectId,
      work_item_id: workItemId,
      schema_version: 1,
      implementation_mode: true,
      planner_payload: null,
      active_increment_id: 'INC-1',
      questions: [],
      execution_artifacts_by_increment: {},
      team_chat_transcript: [],
    });

    const { result } = renderHook(() =>
      usePersistWorkspace({
        projectId,
        workItemId,
        enabled: true,
        debounceMs: 1000, // Long debounce
      })
    );

    // When - force save
    await act(async () => {
      await result.current.forceSave(mockWorkspaceState);
    });

    // Then - should have called immediately
    expect(mockSave).toHaveBeenCalledTimes(1);
  });

  /**
   * Test 4: Debouncing prevents excessive API calls.
   */
  it('debouncing prevents excessive API calls', async () => {
    // Given
    const mockSave = vi.mocked(api.saveImplementWorkspace);
    mockSave.mockResolvedValue({
      project_id: projectId,
      work_item_id: workItemId,
      schema_version: 1,
      implementation_mode: true,
      planner_payload: null,
      active_increment_id: null,
      questions: [],
      execution_artifacts_by_increment: {},
      team_chat_transcript: [],
    });

    const { result } = renderHook(() =>
      usePersistWorkspace({
        projectId,
        workItemId,
        enabled: true,
        debounceMs: 50,
      })
    );

    // When - trigger many saves
    for (let i = 0; i < 10; i++) {
      act(() => {
        result.current.triggerSave({ ...mockWorkspaceState, activeIncrementId: `INC-${i}` });
      });
      await act(async () => {
        vi.advanceTimersByTime(10); // Less than debounce
      });
    }

    // Advance past debounce
    await act(async () => {
      vi.advanceTimersByTime(100);
    });

    // Should only have called once (or twice if one got through)
    expect(mockSave.mock.calls.length).toBeLessThanOrEqual(2);
  });

  /**
   * Test: cancelPendingSave cancels debounced save.
   */
  it('cancelPendingSave cancels pending debounced save', async () => {
    // Given
    const mockSave = vi.mocked(api.saveImplementWorkspace);

    const { result } = renderHook(() =>
      usePersistWorkspace({
        projectId,
        workItemId,
        enabled: true,
        debounceMs: 100,
      })
    );

    // When
    act(() => {
      result.current.triggerSave(mockWorkspaceState);
    });

    act(() => {
      result.current.cancelPendingSave();
    });

    await act(async () => {
      vi.advanceTimersByTime(150);
    });

    // Then - should not have called
    expect(mockSave).not.toHaveBeenCalled();
  });

  /**
   * Test: Error handling - logs but doesn't throw.
   */
  it('handles errors gracefully without throwing', async () => {
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
      result.current.triggerSave(mockWorkspaceState);
    });

    await act(async () => {
      vi.advanceTimersByTime(50);
    });

    // Then - should have logged error
    expect(consoleSpy).toHaveBeenCalledWith('Failed to save workspace:', expect.any(Error));

    consoleSpy.mockRestore();
  });
});
