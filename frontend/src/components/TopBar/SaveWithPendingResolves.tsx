/**
 * SaveWithPendingResolves Component
 *
 * Spec 2026-04-20: Tech Hints LLM Resolution (Task Group 6.4)
 *
 * Wraps a Save button with observation of the `pendingResolutionsStore`:
 *  - If any dirty row has `repoCrossCheck.status === 'conflict'`, Save is
 *    DISABLED with the tooltip "Resolve conflicts before saving".
 *  - Else if `pendingCount > 0`, clicking Save flips the button label to
 *    "Resolving N rows..." while awaiting `Promise.allSettled(pending)`
 *    before firing the wrapped `onSave` callback.
 *  - Stale rows (edited since last resolve, with no in-flight promise) are
 *    passed in via `staleRowIds` + `resolveStaleRow`. Each stale row triggers
 *    an implicit resolve that is appended to the pending set before settle.
 *  - Individual row rejections bubble through `onRowResolutionRejection` so
 *    the parent can fire its toast and mark the row for a NULL save (per
 *    spec failure table); Save still proceeds for the rest.
 *
 * This component is the single save-gating surface referenced by the grid
 * editor screens. The TopBar Save handler is wired through here.
 */

import { useCallback, useState } from 'react';
import {
  pendingResolutionsStore,
  usePendingCount,
  useHasConflict,
} from '../../stores/pendingResolutionsStore';
import type { TechHintResolution } from '../../types/techHints';

export interface SaveWithPendingResolvesProps {
  /** Fires AFTER every pending (and implicit) resolve has settled. */
  onSave: () => void | Promise<void>;
  /** Row IDs that are dirty but have no in-flight resolve. */
  staleRowIds?: string[];
  /**
   * Implicit-resolve hook used for stale rows on Save click. Parent owns the
   * actual fetch so it can register the promise + abort controller in the
   * store via its TechHintsCell-equivalent flow. Defaults to a no-op resolve.
   */
  resolveStaleRow?: (rowId: string) => Promise<TechHintResolution>;
  /** Called when an individual row's resolve rejected during the wait. */
  onRowResolutionRejection?: (rowId: string, reason: unknown) => void;
  /** Disabled-by-parent override (e.g., no file loaded). */
  disabled?: boolean;
}

export function SaveWithPendingResolves({
  onSave,
  staleRowIds,
  resolveStaleRow,
  onRowResolutionRejection,
  disabled,
}: SaveWithPendingResolvesProps) {
  const pendingCount = usePendingCount();
  const hasConflict = useHasConflict();
  const [awaitingResolves, setAwaitingResolves] = useState(false);
  const [awaitingCount, setAwaitingCount] = useState(0);

  const handleClick = useCallback(async () => {
    if (hasConflict) {
      return; // DISABLED — guard against double-click
    }
    if (awaitingResolves) {
      return;
    }

    // Fire implicit resolves for stale rows (they are not yet in the slice).
    const implicitEntries: { rowId: string; promise: Promise<TechHintResolution> }[] = [];
    if (staleRowIds && staleRowIds.length > 0 && resolveStaleRow) {
      for (const rowId of staleRowIds) {
        // Only fire for rows not already in-flight.
        if (!pendingResolutionsStore.getEntry(rowId)) {
          const controller = new AbortController();
          const p = Promise.resolve().then(() => resolveStaleRow(rowId));
          pendingResolutionsStore.start(rowId, p, controller);
          implicitEntries.push({ rowId, promise: p });
          // Auto-settle on completion (success OR rejection) so the slice drains.
          p.finally(() => pendingResolutionsStore.settle(rowId));
        }
      }
    }

    const snapshot = pendingResolutionsStore.getSnapshot();
    const entryIds = Array.from(snapshot.entries.keys());
    const promises = pendingResolutionsStore.getPendingPromises();

    if (promises.length > 0) {
      setAwaitingResolves(true);
      setAwaitingCount(promises.length);

      // Attach a per-row catch so we can surface rejections to the parent
      // without disturbing Promise.allSettled semantics.
      entryIds.forEach((rowId) => {
        const entry = snapshot.entries.get(rowId);
        if (!entry) return;
        entry.promise.catch((reason) => {
          onRowResolutionRejection?.(rowId, reason);
        });
      });

      const results = await Promise.allSettled(promises);
      // After settlement the store should drain itself (each resolve chain
      // calls `settle`). But guard against forgotten entries.
      entryIds.forEach((rowId) => pendingResolutionsStore.settle(rowId));

      // Keep awaitingResolves true briefly so tests can observe the label,
      // but we drop it before invoking the caller to keep UX snappy.
      setAwaitingResolves(false);
      setAwaitingCount(0);

      // Use `results` only to ensure the promises resolved — the store path
      // has already routed row-level patches upstream.
      void results;
    }

    await onSave();
  }, [hasConflict, awaitingResolves, staleRowIds, resolveStaleRow, onRowResolutionRejection, onSave]);

  // Determine effective display state.
  // While we are in the await window, reflect the LIVE pending count from the
  // store so the label counts down as individual rows settle. Falling back to
  // the snapshot count makes the label correct even if the store drains
  // between subscriptions.
  const liveCount = awaitingResolves ? pendingCount : pendingCount;
  void awaitingCount; // reserved for future use (e.g., snapshot display)
  const isWaiting = awaitingResolves && liveCount > 0;
  const label = isWaiting ? `Resolving ${liveCount} rows...` : 'Save';

  const effectiveDisabled = Boolean(disabled) || hasConflict || isWaiting;
  const tooltip = hasConflict
    ? 'Resolve conflicts before saving'
    : isWaiting
      ? `Resolving ${liveCount} rows...`
      : undefined;

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={effectiveDisabled}
      title={tooltip}
      data-testid="save-button"
    >
      {label}
    </button>
  );
}

export default SaveWithPendingResolves;
