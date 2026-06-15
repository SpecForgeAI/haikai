/**
 * Pending Resolutions Store
 *
 * Spec 2026-04-20: Tech Hints LLM Resolution (Task Group 6)
 *
 * Tracks in-flight tech-hints resolve promises keyed by service row ID so the
 * Save button can hold the whole-model `PUT /api/model/projects/{projectId}/architectures/{architectureId}?filename=...` until
 * every dirty row's resolve has settled. Conflict state also lives here so the
 * Save button can be disabled when any row returned `repoCrossCheck.status ===
 * 'conflict'`.
 *
 * Spec asks for a "Zustand slice" but this codebase does not depend on
 * Zustand. This file implements an equivalent vanilla external store that is
 * compatible with React 18's `useSyncExternalStore` for component subscription
 * and remains fully usable outside a React tree (so the Save handler can
 * await `Promise.allSettled(pending)` without re-renders).
 *
 * Entry shape: `{ promise, abort, startedAt }` per row, matching the spec.
 */

import { useSyncExternalStore } from 'react';
import type { TechHintResolution } from '../types/techHints';

// ============================================================================
// Entry shape
// ============================================================================

export interface PendingResolutionEntry {
  /** The in-flight resolve promise. Rejected promises must still be settled. */
  promise: Promise<TechHintResolution>;
  /** AbortController wired through fetch — `.abort()` cancels the request. */
  abort: AbortController;
  /** Unix ms timestamp when the resolve was enqueued. */
  startedAt: number;
}

/**
 * Row-level conflict flag; set when `repoCrossCheck.status === 'conflict'`.
 * Separate from in-flight entries because conflicts persist across resolve
 * settlement and must continue to block Save until the user fixes them.
 */
export interface ConflictEntry {
  rowId: string;
}

interface PendingResolutionsState {
  /** Active, unsettled resolves keyed by service row ID. */
  entries: Map<string, PendingResolutionEntry>;
  /** Rows with a conflict crossCheck result; Save is disabled while non-empty. */
  conflicts: Set<string>;
}

// ============================================================================
// Store internals
// ============================================================================

let state: PendingResolutionsState = {
  entries: new Map(),
  conflicts: new Set(),
};

type Listener = () => void;
const listeners = new Set<Listener>();

function emit(): void {
  // Replace the state *reference* so `useSyncExternalStore` selectors based
  // on identity (Map/Set refs, pendingCount) re-run. We keep the inner
  // Map/Set mutable for O(1) start/settle but every transition swaps the
  // outer wrapper.
  state = {
    entries: new Map(state.entries),
    conflicts: new Set(state.conflicts),
  };
  listeners.forEach((fn) => fn());
}

// ============================================================================
// Public store API (imperative — usable outside React)
// ============================================================================

export const pendingResolutionsStore = {
  /**
   * Register a new in-flight resolve for `rowId`. If an entry already exists
   * for this row, its AbortController is fired and the entry is replaced
   * (per spec: rapid re-edit within the debounce window replaces the entry).
   */
  start(rowId: string, promise: Promise<TechHintResolution>, abort: AbortController): void {
    const prev = state.entries.get(rowId);
    if (prev) {
      try {
        prev.abort.abort();
      } catch {
        // ignore — controller may already be aborted
      }
    }
    state.entries.set(rowId, { promise, abort, startedAt: Date.now() });
    emit();
  },

  /**
   * Remove the entry for `rowId` (e.g., after the promise settles).
   * No-op if there is no entry.
   */
  settle(rowId: string): void {
    if (state.entries.delete(rowId)) {
      emit();
    }
  },

  /**
   * Abort and remove the entry for `rowId` without waiting for completion.
   */
  cancel(rowId: string): void {
    const entry = state.entries.get(rowId);
    if (!entry) {
      return;
    }
    try {
      entry.abort.abort();
    } catch {
      // ignore
    }
    state.entries.delete(rowId);
    emit();
  },

  /**
   * Abort every in-flight resolve and clear the slice.
   */
  cancelAll(): void {
    if (state.entries.size === 0 && state.conflicts.size === 0) {
      return;
    }
    state.entries.forEach((entry) => {
      try {
        entry.abort.abort();
      } catch {
        // ignore
      }
    });
    state.entries.clear();
    state.conflicts.clear();
    emit();
  },

  /**
   * Mark or clear a row's conflict state (used by TechHintsCell when the
   * resolve result carries `repoCrossCheck.status === 'conflict'`).
   */
  setConflict(rowId: string, hasConflict: boolean): void {
    const had = state.conflicts.has(rowId);
    if (hasConflict && !had) {
      state.conflicts.add(rowId);
      emit();
    } else if (!hasConflict && had) {
      state.conflicts.delete(rowId);
      emit();
    }
  },

  /**
   * Snapshot of all currently-pending promises — used by the Save handler
   * to run `Promise.allSettled` before firing the whole-model PUT.
   */
  getPendingPromises(): Promise<TechHintResolution>[] {
    return Array.from(state.entries.values()).map((entry) => entry.promise);
  },

  /** Read-only access to the current entry for a row, or undefined. */
  getEntry(rowId: string): PendingResolutionEntry | undefined {
    return state.entries.get(rowId);
  },

  /** Count of in-flight resolves. */
  pendingCount(): number {
    return state.entries.size;
  },

  /** Whether any dirty row currently has a conflict. */
  hasConflict(): boolean {
    return state.conflicts.size > 0;
  },

  /** Subscribe to state changes; returns an unsubscribe function. */
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  /** Full snapshot — used internally by `useSyncExternalStore` selectors. */
  getSnapshot(): PendingResolutionsState {
    return state;
  },

  /**
   * Test hook — wipes state without firing abort().
   * NEVER call outside tests; production code should use `cancelAll()`.
   */
  _resetForTests(): void {
    state = {
      entries: new Map(),
      conflicts: new Set(),
    };
    listeners.clear();
  },
};

// ============================================================================
// React-side selector hooks
// ============================================================================

/**
 * Subscribe to the current pending count. Re-renders when the count changes.
 */
export function usePendingCount(): number {
  return useSyncExternalStore(
    pendingResolutionsStore.subscribe,
    () => pendingResolutionsStore.getSnapshot().entries.size
  );
}

/**
 * Subscribe to the conflict flag. Re-renders only on transitions.
 */
export function useHasConflict(): boolean {
  return useSyncExternalStore(
    pendingResolutionsStore.subscribe,
    () => pendingResolutionsStore.getSnapshot().conflicts.size > 0
  );
}

/**
 * Subscribe to whether a specific row has a pending resolve.
 */
export function useIsRowPending(rowId: string): boolean {
  return useSyncExternalStore(
    pendingResolutionsStore.subscribe,
    () => pendingResolutionsStore.getSnapshot().entries.has(rowId)
  );
}
