/**
 * useEmptyArchitectureToast
 *
 * Spec 2026-05-02 Multi-Architecture Selector + URL Routing -- Task Group 5
 *
 * Watches the active architecture id. When the user actively switches to a
 * different architecture and the destination view is empty (per
 * `useViewIsEmpty()` rules), fires an info toast through the global
 * <ToastProvider> (reused from Task Group 6's scaffolding):
 *
 *     "Architecture <name> has no <view-label> yet"
 *
 * Strict guards (per spec / requirements):
 *   - Does NOT fire on initial mount -- it tracks the previous architecture
 *     id in a ref and only fires when the id genuinely changes after the
 *     first render.
 *   - Does NOT fire for the dashboard view (always non-empty).
 *   - Does NOT fire while no architecture is resolved (URL still
 *     redirecting via <ProjectLayout>) or while no project is active.
 *   - Fires AT MOST ONCE per architecture switch.
 *
 * Hotfix 2026-05-01 Empty-View Toast Refers to Wrong Architecture (Bug 2)
 *
 * Previous behaviour: the toast evaluated emptiness immediately on
 * `activeArchitectureId` change. Because <AppShell>'s auto-load effect runs
 * AFTER this hook's effect (effect order = declaration order, and the
 * model-load effect dispatches RESET_MODEL + an async LOAD_MODEL), the
 * `state.model` read here was STILL the previous architecture's model.
 * That produced two visible bugs:
 *   - Repro A: A (non-empty) -> B (empty). state.model still held A's
 *     non-empty content at evaluation time -> the hook saw "non-empty" and
 *     suppressed the toast. No toast appeared even though B is empty.
 *   - Repro B: B (empty) -> A (non-empty). state.model still held B's
 *     empty content -> the hook saw "empty" and fired a toast saying
 *     "Architecture A has no entities yet" -- but the emptiness was
 *     measured against the architecture being LEFT, not the destination.
 *
 * The fix defers emptiness evaluation until AFTER the model has actually
 * been loaded for the new architecture. We:
 *   1. On `activeArchitectureId` change: snapshot `state.model` (its object
 *      reference) and set a `pendingArchIdRef` to mark that a switch is in
 *      flight awaiting load.
 *   2. On subsequent re-runs of the effect (triggered by `state.model`
 *      changing as the new architecture's data lands -- either via the
 *      cached LOAD_MODEL dispatch from <AppShell>'s in-memory cache or via
 *      a successful DB fetch): if `state.model` is no longer the snapshot
 *      reference AND `state.loadedFileName !== null` (i.e. we are not in
 *      the post-RESET_MODEL interstitial frame), evaluate emptiness using
 *      `state.model` (now the destination architecture's model) and fire
 *      the toast against the DESTINATION architecture name. Then clear
 *      `pendingArchIdRef` so we don't fire again.
 *
 * Comparing model object references is the right gate because the reducer
 * always returns a new model object on LOAD_MODEL / RESET_MODEL. Comparing
 * `loadedFileName` directly would not work because both source and
 * destination architectures within the same project share the project name
 * as their fileName.
 */

import { useEffect, useRef } from 'react';
import { useArchitecture, useArchitectureContext } from '../contexts/ArchitectureContext';
import { useToast } from '../contexts/ToastContext';
import { useCurrentView } from './useCurrentView';
import { viewIsEmptyFromModel, viewLabelForToast } from './useViewIsEmpty';
import type { ArchitectureModel } from '../types/model';

/**
 * Mount this hook inside <AppShell> (or any component with access to the
 * ArchitectureContext + ToastContext) to enable the empty-view toast on
 * architecture switch.
 */
export function useEmptyArchitectureToast(): void {
  const state = useArchitecture();
  const { architectures, activeArchitectureId } = useArchitectureContext();
  const currentView = useCurrentView();
  const { showToast } = useToast();

  // Tracks the architecture id from the previous render so we can detect a
  // genuine change. `undefined` on the very first render so we never fire
  // on initial mount; transitions from undefined -> any value are ignored.
  const previousArchIdRef = useRef<string | null | undefined>(undefined);

  // Hotfix Bug 2: deferred-evaluation gate.
  //
  // `pendingArchIdRef` holds the architecture id whose emptiness we are
  // waiting to evaluate. Set on the first effect run after a genuine
  // activeArchitectureId change; cleared once the toast has been fired (or
  // suppressed) for that architecture. Until cleared, every re-run of the
  // effect checks if the destination model has loaded yet.
  const pendingArchIdRef = useRef<string | null>(null);

  // Snapshot of `state.model` at switch time. The destination model has
  // loaded when `state.model !== pendingModelSnapshotRef.current`. We compare
  // by reference (the reducer always returns a new model object on
  // LOAD_MODEL / RESET_MODEL) rather than by `loadedFileName`, because
  // multiple architectures within the same project share a fileName and
  // would never trigger a fileName-change.
  const pendingModelSnapshotRef = useRef<ArchitectureModel | null>(null);

  useEffect(() => {
    const previous = previousArchIdRef.current;

    // First render: just record and bail. We never fire on initial mount.
    if (previous === undefined) {
      previousArchIdRef.current = activeArchitectureId;
      return;
    }

    // -------------------------------------------------------------------
    // Branch 1: architecture id changed -> arm the pending evaluation.
    // -------------------------------------------------------------------
    if (previous !== activeArchitectureId) {
      previousArchIdRef.current = activeArchitectureId;

      if (!activeArchitectureId) {
        // Switching to a no-architecture URL (e.g. <ProjectLayout> redirect
        // in flight). Disarm any pending evaluation; we never fire without
        // a destination architecture.
        pendingArchIdRef.current = null;
        pendingModelSnapshotRef.current = null;
        return;
      }

      // Arm the pending evaluation. We will fire the toast on the FIRST
      // subsequent effect run where state.model has been replaced and
      // loadedFileName is non-null (the AppShell auto-load completed).
      pendingArchIdRef.current = activeArchitectureId;
      pendingModelSnapshotRef.current = state.model;
      return;
    }

    // -------------------------------------------------------------------
    // Branch 2: same architecture id -- check if there's a pending switch
    // whose destination model has now loaded.
    // -------------------------------------------------------------------
    if (pendingArchIdRef.current !== activeArchitectureId) {
      // No pending switch for this architecture (or the switch was already
      // resolved on a previous run). Nothing to do.
      return;
    }

    // The model reference has not changed since switch time -- destination
    // model has not loaded yet. Wait for the next effect run.
    if (state.model === pendingModelSnapshotRef.current) {
      return;
    }

    // RESET_MODEL puts an empty model in state with loadedFileName = null
    // during the swap interstitial. That counts as a model-reference change
    // but does NOT mean the destination model has loaded. Skip until the
    // subsequent LOAD_MODEL dispatch lands (which sets loadedFileName).
    if (state.loadedFileName === null) {
      return;
    }

    // The destination model has loaded. Resolve and fire (or suppress) the
    // toast, then disarm so we don't fire again for the same switch.
    const target = pendingArchIdRef.current;
    pendingArchIdRef.current = null;
    pendingModelSnapshotRef.current = null;

    // Dashboard is always non-empty -- skip.
    if (currentView === 'dashboard') {
      return;
    }

    const empty = viewIsEmptyFromModel(currentView, state.model);
    if (!empty) {
      return;
    }

    const arch = (architectures ?? []).find(a => a.id === target);
    const archName = arch?.name ?? 'this architecture';
    const label = viewLabelForToast(currentView);

    showToast(`Architecture ${archName} has no ${label} yet`, 'info');
  }, [activeArchitectureId, currentView, state.model, state.loadedFileName, architectures, showToast]);
}
