/**
 * usePersistWorkspace Hook
 *
 * Custom hook for persisting workspace state to the backend.
 * Provides debounced save triggers to prevent rapid-fire API calls.
 *
 * Spec 2026-01-23: Persist + Rehydrate Implement Workspace
 * Task Group 7: Save Triggers
 */

import { useCallback, useRef, useEffect } from 'react';
import { saveImplementWorkspace, PersistedWorkspaceState } from '../api/implementWorkspaceApi';

// ============================================================================
// Constants
// ============================================================================

/**
 * Default debounce delay in milliseconds.
 * Prevents rapid-fire API calls during rapid state changes.
 */
const DEFAULT_DEBOUNCE_MS = 300;

// ============================================================================
// Hook
// ============================================================================

export interface UsePersistWorkspaceOptions {
  /** Project identifier */
  projectId: string;
  /** Work item identifier (UUID) */
  workItemId: string;
  /** Whether persistence is enabled (e.g., skip if no project loaded) */
  enabled?: boolean;
  /** Custom debounce delay in milliseconds */
  debounceMs?: number;
}

export interface UsePersistWorkspaceReturn {
  /**
   * Trigger a save of the workspace state.
   * The save is debounced - multiple calls within the debounce window
   * will result in only one actual save with the latest state.
   *
   * @param state - The workspace state to persist
   */
  triggerSave: (state: PersistedWorkspaceState) => void;

  /**
   * Force an immediate save, bypassing the debounce.
   * Use this for critical saves (e.g., before navigation).
   *
   * @param state - The workspace state to persist
   */
  forceSave: (state: PersistedWorkspaceState) => Promise<void>;

  /**
   * Cancel any pending debounced save.
   */
  cancelPendingSave: () => void;
}

/**
 * Hook for managing workspace persistence with debouncing.
 *
 * Usage:
 * ```tsx
 * const { triggerSave, forceSave } = usePersistWorkspace({
 *   projectId: 'project.json',
 *   workItemId: 'uuid-here',
 *   enabled: !!projectId && !!workItemId,
 * });
 *
 * // Trigger a debounced save on state change
 * useEffect(() => {
 *   if (shouldPersist) {
 *     triggerSave(mapStateToPersisted(state));
 *   }
 * }, [relevantState]);
 * ```
 */
export function usePersistWorkspace({
  projectId,
  workItemId,
  enabled = true,
  debounceMs = DEFAULT_DEBOUNCE_MS,
}: UsePersistWorkspaceOptions): UsePersistWorkspaceReturn {
  // Ref for the debounce timeout
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Ref for the latest state to save (allows debounce to use latest value)
  const latestStateRef = useRef<PersistedWorkspaceState | null>(null);

  // Ref for tracking if a save is in progress
  const isSavingRef = useRef(false);

  /**
   * Performs the actual save operation.
   */
  const performSave = useCallback(async (state: PersistedWorkspaceState) => {
    if (!enabled || !projectId || !workItemId) {
      return;
    }

    if (isSavingRef.current) {
      // Another save is in progress, queue this one
      latestStateRef.current = state;
      return;
    }

    isSavingRef.current = true;

    try {
      await saveImplementWorkspace(projectId, workItemId, state);
      console.debug('Workspace saved successfully');
    } catch (error) {
      // Log error but don't block UI (fail-soft)
      console.error('Failed to save workspace:', error);
    } finally {
      isSavingRef.current = false;

      // Check if there's a queued save
      if (latestStateRef.current && latestStateRef.current !== state) {
        const queuedState = latestStateRef.current;
        latestStateRef.current = null;
        // Trigger another save for the queued state
        performSave(queuedState);
      }
    }
  }, [enabled, projectId, workItemId]);

  /**
   * Trigger a debounced save.
   */
  const triggerSave = useCallback((state: PersistedWorkspaceState) => {
    if (!enabled) {
      return;
    }

    // Update latest state
    latestStateRef.current = state;

    // Clear existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    // Set new timeout
    timeoutRef.current = setTimeout(() => {
      const stateToSave = latestStateRef.current;
      if (stateToSave) {
        performSave(stateToSave);
      }
      timeoutRef.current = null;
    }, debounceMs);
  }, [enabled, debounceMs, performSave]);

  /**
   * Force an immediate save, bypassing debounce.
   */
  const forceSave = useCallback(async (state: PersistedWorkspaceState) => {
    if (!enabled) {
      return;
    }

    // Clear any pending debounced save
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    // Perform immediate save
    await performSave(state);
  }, [enabled, performSave]);

  /**
   * Cancel any pending save.
   */
  const cancelPendingSave = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    latestStateRef.current = null;
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return {
    triggerSave,
    forceSave,
    cancelPendingSave,
  };
}
