/**
 * SpecGenerationWorkspace
 *
 * Spec: 2026-05-19 PM Migration Shape-Spec Batch Generation
 * Task Group 9 - Workspace Shell + Summary Header.
 * Task Group 11 - Filters + Story Result Drawer wiring.
 * Task Group 12 - `initialDrawerWorkItemId` prop supports auto-opening the
 *   drawer when the user drills back from a WorkItem Implement tab.
 *
 * Top-level surface a Product Manager opens from the Migration Book of Work
 * detail page (primary entry) and from a WorkItem Implement-tab drill-in
 * (Group 12). The shell:
 *
 *   1. Fetches the per-book summary from AMS on mount (and on demand via
 *      `refreshSummary`).
 *   2. Renders the summary header card (Task 9.4).
 *   3. Renders the action button row (Group 10 -> BatchGenerationControls).
 *   4. Renders the filter panel (Group 11 -> SpecGenerationFilters).
 *   5. Renders the results table area (Group 10 -> BatchResultsTable) with
 *      row click wired to open the story result drawer.
 *   6. Renders the story result drawer (Group 11 -> StoryResultDrawer) when
 *      a row is selected.
 *
 * Re-fetch on return (A-9): when the surface is remounted (e.g. user
 * navigates away and back), the mount effect re-runs and the summary is
 * refetched. The component does not poll while in view.
 *
 * Visual precedent: Spec 1's `MigrationDeliveryPlan` workspace surfaces
 * (`MigrationBookOfWorkReviewWorkspace`, `MigrationDeliveryPlanProgressSummary`).
 *
 * Design-point refs:
 *   - A-1 existing Implement-tab UI inspected at write time; this workspace
 *     reuses the Spec 1 MigrationDeliveryPlan shell pattern rather than
 *     building a parallel surface
 *   - A-9 batch concurrency control: the "Generate next batch" button is
 *     disabled while a batch is in-flight; in-progress banner shows
 *     "Batch in progress (story X of N)"; navigating away does not cancel,
 *     and on return the workspace re-fetches the summary
 *   - R-10 predicted-vs-actual comparison: side-by-side Predicted / Actual
 *     columns are rendered in both the batch results table and the story
 *     detail drawer, with the optional summary metric ("N of M predicted-
 *     ready actually generated") surfaced in the workspace header
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchSpecGenerationSummary,
  fetchSpecGenerationsForBook,
  startBatchGeneration,
  regenerateSingleStory,
} from '../../../api/specGenerationApi';
import type {
  SpecGenerationRow,
  SpecGenerationSummaryDto,
} from '../../../api/specGenerationApi';
import { SpecGenerationSummaryHeader } from './SpecGenerationSummaryHeader';
import { BatchGenerationControls } from './BatchGenerationControls';
import { BatchResultsTable } from './BatchResultsTable';
import {
  SpecGenerationFilters,
  applySpecGenerationFilters,
  EMPTY_FILTER_STATE,
  type SpecGenerationFilterState,
} from './SpecGenerationFilters';
import { StoryResultDrawer } from './StoryResultDrawer';
import styles from './MigrationShapeSpecGeneration.module.css';

// ============================================================================
// Props
// ============================================================================

export interface SpecGenerationWorkspaceProps {
  projectId: string;
  bookOfWorkId: string;
  /** Optional title rendered above the summary header. */
  bookTitle?: string;
  /**
   * Group 12: when set, the workspace auto-opens the story result drawer for
   * the matching row once the row list has arrived. Used by the WorkItem
   * Implement-tab drill-back flow.
   */
  initialDrawerWorkItemId?: string | null;
  /**
   * Optional href builder for the "Open work item" link in the drawer.
   */
  buildWorkItemHref?: (workItemId: string) => string;
  /**
   * Optional href builder for the "Open Implement tab" link in the drawer.
   */
  buildImplementTabHref?: (workItemId: string) => string;
}

// ============================================================================
// Component
// ============================================================================

export function SpecGenerationWorkspace({
  projectId,
  bookOfWorkId,
  bookTitle,
  initialDrawerWorkItemId,
  buildWorkItemHref,
  buildImplementTabHref,
}: SpecGenerationWorkspaceProps) {
  // ----- Summary + rows state ------------------------------------------------
  const [summary, setSummary] = useState<SpecGenerationSummaryDto | null>(null);
  const [rows, setRows] = useState<SpecGenerationRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  // ----- Batch lifecycle state (A-9) ----------------------------------------
  const [batchInProgress, setBatchInProgress] = useState(false);
  const [currentStoryIndexInBatch, setCurrentStoryIndexInBatch] = useState(0);
  const [currentBatchSize, setCurrentBatchSize] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);
  // Generate-all loop control (A-9: batches do not cancel mid-flight, but the
  // outer loop honours a stop request between batches).
  //
  // Stored in a `useRef`, NOT state. The generate-all loop runs inside an
  // async IIFE that captures its closure at invocation time; a `useState`
  // value here would be frozen at `false` for the whole loop because the
  // running IIFE never re-renders. The ref's `.current` is read live each
  // iteration, so clicking "Stop after current batch" mid-loop is honoured
  // between batches even though the user click happens AFTER the IIFE
  // started. (Render-driven UI for the stop affordance is owned entirely
  // by `BatchGenerationControls`; no rendered surface depends on this
  // flag.)
  const stopAfterCurrentBatchRef = useRef(false);

  // ----- Filter state (Group 11) --------------------------------------------
  const [filters, setFilters] = useState<SpecGenerationFilterState>(
    EMPTY_FILTER_STATE,
  );

  // ----- Drawer state (Group 11 + Group 12) ---------------------------------
  const [drawerRow, setDrawerRow] = useState<SpecGenerationRow | null>(null);
  const [initialDrawerOpened, setInitialDrawerOpened] = useState(false);

  // --------------------------------------------------------------------------
  // Fetchers
  // --------------------------------------------------------------------------

  const refreshSummary = useCallback(async () => {
    try {
      const next = await fetchSpecGenerationSummary(projectId, bookOfWorkId);
      setSummary(next);
      setLoadError(null);
      return next;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to load summary';
      setLoadError(message);
      return null;
    }
  }, [projectId, bookOfWorkId]);

  const refreshRows = useCallback(async () => {
    try {
      const next = await fetchSpecGenerationsForBook(projectId, bookOfWorkId);
      setRows(next);
      return next;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to load rows';
      setLoadError(message);
      return [];
    }
  }, [projectId, bookOfWorkId]);

  // Initial mount + on-prop-change fetch (A-9: re-mount triggers re-fetch).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [s] = await Promise.all([refreshSummary(), refreshRows()]);
      // Avoid setting state after unmount.
      if (cancelled) return;
      void s;
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshSummary, refreshRows]);

  // Group 12: auto-open drawer when initialDrawerWorkItemId is supplied AND
  // the matching row has arrived. We only do this once per mount so the user
  // can subsequently close the drawer without it re-opening.
  useEffect(() => {
    if (initialDrawerOpened) return;
    if (!initialDrawerWorkItemId) return;
    if (rows.length === 0) return;
    const match = rows.find((r) => r.workItemId === initialDrawerWorkItemId);
    if (match) {
      setDrawerRow(match);
      setInitialDrawerOpened(true);
    }
  }, [initialDrawerWorkItemId, rows, initialDrawerOpened]);

  // --------------------------------------------------------------------------
  // Batch lifecycle handlers
  // --------------------------------------------------------------------------

  /**
   * Run a single batch through the gateway endpoint. Returns the next batch
   * start the gateway reported, or null if the call failed.
   */
  const runSingleBatch = useCallback(
    async (opts: { regenerateAll: boolean; skipBlockedStories: boolean }) => {
      setActionError(null);
      // Approximate the batch size from the latest summary; the gateway is
      // authoritative on the final size but the banner just needs a sensible
      // upper bound.
      const expectedSize = summary?.nextBatchSize ?? 25;
      setCurrentBatchSize(expectedSize);
      setCurrentStoryIndexInBatch(0);
      setBatchInProgress(true);
      try {
        const result = await startBatchGeneration({
          projectId,
          bookOfWorkId,
          regenerateAll: opts.regenerateAll,
          skipBlockedStories: opts.skipBlockedStories,
        });
        // Append the per-story results to the local row list. We dedupe on
        // workItemId so a re-attempt of a row replaces the prior entry.
        setRows((prev) => {
          const byKey = new Map<string, SpecGenerationRow>();
          for (const r of prev) {
            const key = r.workItemId ?? r.id ?? '';
            if (key) byKey.set(key, r);
          }
          for (const r of result.perStoryResults) {
            const key = r.workItemId ?? r.id ?? '';
            if (key) byKey.set(key, r);
          }
          return Array.from(byKey.values());
        });
        // Re-fetch the summary so the header reflects the post-batch counts.
        await refreshSummary();
        return result;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Batch generation failed';
        setActionError(message);
        return null;
      } finally {
        setBatchInProgress(false);
        setCurrentStoryIndexInBatch(0);
        setCurrentBatchSize(0);
      }
    },
    [projectId, bookOfWorkId, refreshSummary, summary?.nextBatchSize],
  );

  const handleGenerateNextBatch = useCallback(
    (opts: { regenerateAll: boolean; skipBlockedStories: boolean }) => {
      // Fire-and-forget; the in-flight UI state is managed inside runSingleBatch.
      void runSingleBatch(opts);
    },
    [runSingleBatch],
  );

  /**
   * Generate-all loop: repeatedly invoke runSingleBatch until either
   *   (a) the summary reports zero remaining stories, or
   *   (b) the user clicks "Stop after current batch", or
   *   (c) the gateway returns a non-success result.
   *
   * A-9: batches do NOT cancel mid-flight; the loop exits between batches.
   */
  const handleGenerateAll = useCallback(
    (opts: { regenerateAll: boolean; skipBlockedStories: boolean }) => {
      void (async () => {
        // Reset the stop signal each time the user starts a new generate-all.
        stopAfterCurrentBatchRef.current = false;
        // Hard cap on iterations so a bug or a degenerate summary cannot
        // spin forever.
        for (let i = 0; i < 100; i += 1) {
          const result = await runSingleBatch(opts);
          if (!result) return;
          // Read the ref live each iteration so a click on "Stop after
          // current batch" between batches is honoured.
          if (stopAfterCurrentBatchRef.current) return;
          // Re-read summary post-batch to decide whether to continue.
          const latest = await refreshSummary();
          if (!latest) return;
          // Exit when there are no more unattempted stories AND we are not
          // doing a regenerate-all pass (regenerate-all keeps going until the
          // gateway reports no work).
          if (latest.notAttemptedCount === 0 && !opts.regenerateAll) return;
          // Defensive: also exit when the most recent batch produced no rows
          // (regenerate-all over a fully-up-to-date book).
          if (result.perStoryResults.length === 0) return;
        }
      })();
    },
    [runSingleBatch, refreshSummary],
  );

  const handleStopAfterCurrentBatch = useCallback(() => {
    stopAfterCurrentBatchRef.current = true;
  }, []);

  // --------------------------------------------------------------------------
  // Single-row retry / regenerate handlers
  // --------------------------------------------------------------------------

  const handleRetryStory = useCallback(
    async (workItemId: string) => {
      setActionError(null);
      try {
        const result = await regenerateSingleStory({
          projectId,
          bookOfWorkId,
          workItemId,
        });
        setRows((prev) => {
          const byKey = new Map<string, SpecGenerationRow>();
          for (const r of prev) {
            const key = r.workItemId ?? r.id ?? '';
            if (key) byKey.set(key, r);
          }
          for (const r of result.perStoryResults) {
            const key = r.workItemId ?? r.id ?? '';
            if (key) byKey.set(key, r);
          }
          return Array.from(byKey.values());
        });
        await refreshSummary();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Retry failed';
        setActionError(message);
      }
    },
    [projectId, bookOfWorkId, refreshSummary],
  );

  const handleDrawerRegenerate = useCallback(
    async (input: { workItemId: string; confirmOverwrite?: boolean }) => {
      // The drawer surfaces its own confirm dialog when the gateway returns
      // the `manual_edit_protected` sentinel, so we propagate the error here
      // rather than swallowing it.
      const result = await regenerateSingleStory({
        projectId,
        bookOfWorkId,
        workItemId: input.workItemId,
        confirmOverwrite: input.confirmOverwrite,
      });
      setRows((prev) => {
        const byKey = new Map<string, SpecGenerationRow>();
        for (const r of prev) {
          const key = r.workItemId ?? r.id ?? '';
          if (key) byKey.set(key, r);
        }
        for (const r of result.perStoryResults) {
          const key = r.workItemId ?? r.id ?? '';
          if (key) byKey.set(key, r);
        }
        return Array.from(byKey.values());
      });
      // Refresh the drawer row to the latest version if it is the same row.
      const updated = result.perStoryResults.find(
        (r) => r.workItemId === input.workItemId,
      );
      if (updated) setDrawerRow(updated);
      await refreshSummary();
      return result;
    },
    [projectId, bookOfWorkId, refreshSummary],
  );

  // --------------------------------------------------------------------------
  // Drawer open/close handlers
  // --------------------------------------------------------------------------

  const handleOpenStory = useCallback((row: SpecGenerationRow) => {
    setDrawerRow(row);
  }, []);

  const handleCloseDrawer = useCallback(() => {
    setDrawerRow(null);
  }, []);

  // --------------------------------------------------------------------------
  // Derived row list (filter applied)
  // --------------------------------------------------------------------------

  const filteredRows = useMemo(
    () => applySpecGenerationFilters(rows, filters),
    [rows, filters],
  );

  // --------------------------------------------------------------------------
  // Render
  // --------------------------------------------------------------------------

  return (
    <section
      className={styles.workspaceRoot}
      data-testid="msg-workspace-shell"
    >
      {bookTitle && (
        <header
          className={styles.workspaceHeader}
          data-testid="msg-workspace-book-title"
        >
          <h1 className={styles.workspaceTitle}>{bookTitle}</h1>
        </header>
      )}

      {loadError && (
        <div
          className={styles.errorBanner}
          role="alert"
          data-testid="msg-workspace-load-error"
        >
          {loadError}
        </div>
      )}

      {summary && (
        <SpecGenerationSummaryHeader summary={summary} rows={rows} />
      )}

      <BatchGenerationControls
        summary={summary}
        batchInProgress={batchInProgress}
        currentStoryIndexInBatch={currentStoryIndexInBatch}
        currentBatchSize={currentBatchSize}
        actionError={actionError}
        onGenerateNextBatch={handleGenerateNextBatch}
        onGenerateAll={handleGenerateAll}
        onStopAfterCurrentBatch={handleStopAfterCurrentBatch}
      />

      <SpecGenerationFilters
        rows={rows}
        value={filters}
        onChange={setFilters}
      />

      <BatchResultsTable
        rows={filteredRows}
        batchInProgress={batchInProgress}
        onRetryStory={handleRetryStory}
        onOpenStory={handleOpenStory}
      />

      {drawerRow && (
        <StoryResultDrawer
          row={drawerRow}
          projectId={projectId}
          bookOfWorkId={bookOfWorkId}
          onClose={handleCloseDrawer}
          onRegenerate={handleDrawerRegenerate}
          workItemHref={
            drawerRow.workItemId && buildWorkItemHref
              ? buildWorkItemHref(drawerRow.workItemId)
              : undefined
          }
          implementTabHref={
            drawerRow.workItemId && buildImplementTabHref
              ? buildImplementTabHref(drawerRow.workItemId)
              : undefined
          }
        />
      )}
    </section>
  );
}

export default SpecGenerationWorkspace;
