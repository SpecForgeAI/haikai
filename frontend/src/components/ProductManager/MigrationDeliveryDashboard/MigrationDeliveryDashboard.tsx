/**
 * MigrationDeliveryDashboard
 *
 * Spec: 2026-05-19 Migration Delivery Progress and Evidence Tracking
 * Task Group 8 -- Dashboard shell + summary header + workstream progress.
 * Task Group 9 -- Hierarchy tree.
 * Task Group 10 -- Needs-attention panel + filters + Addition A buttons.
 * Task Group 11 -- Story detail drawer + Missing inputs subsection.
 * Task Group 12 -- Partial roll-up rendering via the
 *                  `MigrationDeliverySectionRetryPlaceholder` component
 *                  (Q-11, AC 16).
 *
 * Spec: 2026-05-20 Cross-Story Context Injection -- Task Group 7.3 extends
 * the dashboard with:
 *   - Workstream context expandable section above the hierarchy tree.
 *   - Read-only collapsed summary of epic captured decisions (counts +
 *     status mix), linking to the epic detail page for full edit.
 *   - Active-batch banner ("Batch in progress (pass N of 2)") while the
 *     gateway concurrency lock is held.
 *   - Generate-all dialog (cost-preview + per-batch pass-2 toggle).
 *   - Post-batch summary (actual tokens + wall-clock per pass + count of
 *     no_meaningful_change rows + count of contradicts_sibling warnings).
 *   - AppShell cache invalidation after pass 2 persists via the
 *     `onPassTwoPersisted` callback prop, per
 *     `project_appshell_model_cache.md`. The dashboard stays presentational
 *     and never imports the ArchitectureContext hook directly so test
 *     renders without a provider continue to work.
 *
 * Spec: 2026-05-20 Missing Input Resolver Flow -- Task Group 7 adds:
 *   - "Ready to retry" summary card adjacent to the stale-specs card,
 *     fetched from `GET /spec-generations/ready-to-retry`. The card surfaces
 *     both a primary "Retry all" affordance and a secondary "View ready
 *     stories" link that filters the hierarchy tree.
 *   - A "Bulk resolve" button next to the existing "Generate all" button on
 *     the dashboard header. It opens the bulk-resolve modal which ALWAYS
 *     previews before any write (per the spec's preview-then-commit rule).
 *   - Stale-chip differentiation (`stale: target arch changed` vs
 *     `stale: input resolution reset`) on the stale-specs list. Reasons are
 *     read directly from the per-story `staleReason` field on the
 *     hierarchy-node DTOs (AMS now surfaces this on every response); the
 *     panel falls back to the legacy "target arch changed" label when the
 *     wire value is null.
 *
 * Spec: 2026-06-14 Holistic Integration/E2E TEST Work Items (Spec 2 of 4)
 * -- Task Group 4 adds:
 *   - A per-node "Define Integration/E2E Tests" action on FEATURE/EPIC
 *     hierarchy nodes. On activate the dashboard calls the new node-scoped
 *     gateway route (`defineIntegrationTests`), refreshes the tree so the new
 *     TEST siblings appear, and surfaces the ALLOW-WITH-WARNING result: a
 *     warning list when `skippedChildren` is non-empty, and a clear "no
 *     integration/E2E tests needed" message when the LLM returned an empty
 *     plan. Errors surface in the existing error banner.
 *   - A show/hide TEST filter toggle above the hierarchy tree (the tree
 *     prunes `type === 'TEST'` nodes when hidden).
 *
 * Spec references (Spec 2026-05-19):
 *   - Q-8  (Last refreshed HH:mm:ss label updates on every successful GET)
 *   - Q-10 (architecture-scoped route; presentational component owns no routing)
 *   - Q-11 (partial roll-up: warnings[] -> inline placeholder per section)
 *   - AC 1 (renders at the architecture-scoped delivery route)
 *   - AC 2 (header shows title, status, generatedAt, Refresh + Last refreshed)
 *   - AC 16 (warnings[] -> per-section retry placeholder; never 5xx)
 *
 * Lifecycle:
 *   1. On mount: call `getMigrationDeliveryDashboard(projectId, bookId)`
 *      and stash the payload in component state. Stamp `lastRefreshedAt`
 *      with the wall-clock time of the successful response (Q-8). The
 *      stale-spec summary AND the ready-to-retry summary are fetched
 *      alongside; each is in its own try/catch so a transient summary
 *      failure does not blank the rest of the dashboard.
 *   2. Manual Refresh button: re-runs the same fetch path and re-stamps
 *      `lastRefreshedAt`.
 *   3. Failures surface as an inline error banner; the previously loaded
 *      payload remains visible so a transient network blip does not
 *      blank the page.
 *   4. Generate-all -> dialog -> POST /api/v1/.../generate-batch via
 *      `startBatchGeneration`. After success, the dashboard calls
 *      `onPassTwoPersisted` so the parent route can dispatch LOAD_MODEL
 *      to refresh the AppShell model cache.
 *
 * Wire-shape note: AMS responses are snake_case on the wire but the API
 * client (`migrationDeliveryDashboardApi.ts`, follow-up #10) maps to
 * camelCase at the boundary, so all field access here uses idiomatic
 * camelCase.
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  getMigrationDeliveryDashboard,
  getStaleSpecSummary,
  defineIntegrationTests as defaultDefineIntegrationTests,
  type MigrationDeliveryDashboardDto,
  type MigrationDeliveryHierarchyNodeDto,
  type MigrationDeliveryNeedsAttentionItemDto,
  type StaleSpecSummary,
  type DefineIntegrationTestsResult,
  type MigrationExecutionRunDto,
  triggerMigrate as defaultTriggerMigrate,
  getLatestMigrationExecutionRun as defaultGetLatestRun,
  setStoryDeferred as defaultSetStoryDeferred,
  addWorkItem as defaultAddWorkItem,
  type AddWorkItemInput,
} from '../../../api/migrationDeliveryDashboardApi';
import {
  startBatchGeneration,
  recomputeAllSpecQuality,
  type BatchGenerationResult,
  type RecomputeAllSpecQualityResponse,
  type SpecGenerationRow,
  WorkstreamLockedError,
} from '../../../api/specGenerationApi';
import {
  MigrationDeliveryGradeFilter,
  defaultGradeFilterState,
  isGradeAllowedByFilter,
  type GradeFilterValue,
} from './MigrationDeliveryGradeFilter';
import {
  MigrationDeliveryProvenanceFilter,
  defaultProvenanceFilterValue,
  isProvenanceAllowedByFilter,
  type ProvenanceFilterValue,
} from './MigrationDeliveryProvenanceFilter';
import MigrationDeliveryAddItemModal, {
  type AddItemFormValues,
} from './MigrationDeliveryAddItemModal';
import {
  getReadyToRetry as defaultGetReadyToRetry,
  type ReadyToRetryResponse,
} from '../../../api/missingInputResolutionsApi';
import { getMigrationBookOfWork } from '../../../api/migrationBookOfWorkApi';
import {
  computeFindingsCoverage,
  type FindingsCoverageResult,
} from '../../../utils/findingsCoverage';
import MigrationDeliverySummaryCards from './MigrationDeliverySummaryCards';
import MigrationDeliveryWorkstreamProgressStrip from './MigrationDeliveryWorkstreamProgressStrip';
import MigrationDeliveryHierarchyTree from './MigrationDeliveryHierarchyTree';
import MigrationDeliveryNeedsAttentionPanel from './MigrationDeliveryNeedsAttentionPanel';
import MigrationDeliveryStoryDrawer, {
  type StoryPassTwoDetail,
} from './MigrationDeliveryStoryDrawer';
import MigrationDeliverySectionRetryPlaceholder from './MigrationDeliverySectionRetryPlaceholder';
import MigrationDeliveryWorkstreamContextPanel, {
  type MigrationDeliveryWorkstreamContext,
} from './MigrationDeliveryWorkstreamContextPanel';
import MigrationDeliveryEpicDecisionsSummary, {
  type EpicCapturedDecisionsSummaryByEpic,
} from './MigrationDeliveryEpicDecisionsSummary';
import MigrationDeliveryActiveBatchBanner from './MigrationDeliveryActiveBatchBanner';
import MigrationDeliveryGenerateAllDialog from './MigrationDeliveryGenerateAllDialog';
import MigrationDeliveryPostBatchSummary from './MigrationDeliveryPostBatchSummary';
import MigrationDeliveryStaleSpecsPanel from './MigrationDeliveryStaleSpecsPanel';
import MigrationDeliveryReadyToRetryCard from './MigrationDeliveryReadyToRetryCard';
import MigrationDeliveryBulkResolveModal from './MigrationDeliveryBulkResolveModal';
import MigrationDeliveryMigratePanel from './MigrationDeliveryMigratePanel';
import MigrationDeliveryReconciliationPanel from './MigrationDeliveryReconciliationPanel';
import { CapabilitiesSection } from '../../Discovery/CapabilitiesSection';
import styles from './MigrationDeliveryDashboard.module.css';

// ============================================================================
// Constants
// ============================================================================

const SOFT_STORY_COUNT_THRESHOLD = 500;

// ============================================================================
// Helpers
// ============================================================================

export function formatRefreshTimestamp(now: number): string {
  const d = new Date(now);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export function deriveFailedSections(warnings: string[]): Set<string> {
  const failed = new Set<string>();
  for (const w of warnings) {
    const lower = w.toLowerCase();
    if (lower.includes('summary')) failed.add('summary');
    if (lower.includes('workstream')) failed.add('workstreamSummaries');
    if (lower.includes('hierarchy')) failed.add('hierarchy');
    if (lower.includes('needsAttention') || lower.includes('needs-attention'))
      failed.add('needsAttention');
    if (lower.includes('spec_generation') || lower.includes('spec-generation'))
      failed.add('specGenerationSummary');
    if (lower.includes('backlog')) failed.add('backlogSaveSummary');
    if (lower.includes('implementation')) failed.add('implementationSummary');
    if (lower.includes('evidence')) failed.add('evidenceSummary');
  }
  return failed;
}

function findStoryWithPath(
  hierarchy: ReadonlyArray<MigrationDeliveryHierarchyNodeDto>,
  predicate: (n: MigrationDeliveryHierarchyNodeDto) => boolean,
  path: string[] = [],
): { node: MigrationDeliveryHierarchyNodeDto; parentPath: string[] } | null {
  for (const node of hierarchy) {
    if (predicate(node)) {
      return { node, parentPath: path };
    }
    if (node.children && node.children.length > 0) {
      const childPath = [...path, node.title];
      const hit = findStoryWithPath(node.children, predicate, childPath);
      if (hit) return hit;
    }
  }
  return null;
}

// ============================================================================
// Props
// ============================================================================

export interface MigrationDeliveryDashboardProps {
  projectId: string;
  bookId: string;
  /** Test seam: override the fetcher (Vitest path). */
  fetchDashboard?: typeof getMigrationDeliveryDashboard;
  /** Test seam: override the clock used for "Last refreshed" stamping. */
  now?: () => number;
  onBackToBookOfWork?: () => void;
  onOpenBacklog?: () => void;
  onOpenGeneratedSpecs?: () => void;
  /**
   * Cross-Story Context Injection (2026-05-20):
   * Project-level default for the auto-run pass-2 toggle. The Generate-all
   * dialog initialises its per-batch toggle to this value.
   */
  defaultAutoRunPass2?: boolean;
  /**
   * Cross-Story Context Injection (2026-05-20):
   * Workstream context block surfaced from the most recent batch. When
   * present, the dashboard renders an expandable section above the
   * hierarchy tree.
   */
  workstreamContext?: MigrationDeliveryWorkstreamContext | null;
  /**
   * Cross-Story Context Injection (2026-05-20):
   * Per-epic captured-decisions summaries. When non-empty, the dashboard
   * renders a read-only collapsed summary above the hierarchy tree.
   */
  epicDecisionsSummaries?: ReadonlyArray<EpicCapturedDecisionsSummaryByEpic>;
  /**
   * Cross-Story Context Injection (2026-05-20):
   * Optional callback so the parent route can open the epic detail edit
   * panel from the summary's per-row "Edit" link.
   */
  onOpenEpicDetail?: (epicWorkItemId: string) => void;
  /**
   * Cross-Story Context Injection (2026-05-20):
   * Test seam: override the batch-generation call. Defaults to the real
   * `startBatchGeneration` from `specGenerationApi.ts`.
   */
  startBatchGenerationFn?: typeof startBatchGeneration;
  /**
   * Cross-Story Context Injection (2026-05-20):
   * Invoked after a successful Generate-all batch when pass 2 actually ran.
   * The parent route is responsible for dispatching LOAD_MODEL against the
   * AppShell ArchitectureContext (per `project_appshell_model_cache.md`).
   * Decoupled this way so the dashboard remains presentational and tests
   * can render without an ArchitectureProvider.
   */
  onPassTwoPersisted?: (input: {
    projectId: string;
    bookOfWorkId: string;
    batchResult: BatchGenerationResult;
  }) => void;
  /**
   * Target Architecture Authoring Flow (2026-05-20, Task Group 9):
   * Test seam for the stale-spec summary fetch. Defaults to the real client.
   */
  fetchStaleSpecSummary?: typeof getStaleSpecSummary;
  /**
   * Missing Input Resolver Flow (2026-05-20, Task Group 7):
   * Test seam for the ready-to-retry fetch. Defaults to the real client.
   */
  fetchReadyToRetry?: typeof defaultGetReadyToRetry;
  /**
   * Missing Input Resolver Flow (2026-05-20, Task Group 7):
   * User identifier to stamp on bulk-resolve writes. Defaults to "system"
   * for tests / dev; routes wire the authenticated principal here.
   */
  resolvedBy?: string;
  /**
   * Findings Coverage + Gap Wayfinding (2026-06-11, Task Group 4.5):
   * Test seam for the book-of-work draft fetch backing the computed
   * "Findings addressed" line on the Evidence coverage card. Defaults to
   * the real `getMigrationBookOfWork` client.
   */
  fetchBookOfWorkDraft?: typeof getMigrationBookOfWork;
  /**
   * Holistic Integration/E2E TEST Work Items (2026-06-14, Task Group 4):
   * Test seam for the per-feature/epic "Define Integration/E2E Tests" call.
   * Defaults to the real `defineIntegrationTests` client.
   */
  defineIntegrationTestsFn?: typeof defaultDefineIntegrationTests;
  /**
   * Migrate Button + Migration Execution Driver (2026-06-14, Task Group 5):
   * orchestration scope for the Migrate trigger -- organisation name
   * (`company`) + product name (`project`). The route derives these from the
   * active project + its organisation; defaulted so tests / dev render without
   * them (the server re-validates the hard-block regardless).
   */
  company?: string;
  project?: string;
  /**
   * Migrate Button + Migration Execution Driver (2026-06-14, Task Group 5):
   * whether an active `kind='current'` API-behaviour baseline exists for the
   * workspace (the oracle precondition -- CD-7). When false, Migrate is
   * hard-blocked with the missing-baseline reason. Defaults to false (safe:
   * blocks until the route confirms a baseline exists).
   */
  hasActiveCurrentBaseline?: boolean;
  /** Migrate Button (2026-06-14): test seam for the Migrate trigger. */
  triggerMigrateFn?: typeof defaultTriggerMigrate;
  /** Migrate Button (2026-06-14): test seam for the run-state read. */
  fetchLatestRunFn?: typeof defaultGetLatestRun;
  /** Migrate Button (2026-06-14): test seam for the defer-this-story PATCH. */
  setStoryDeferredFn?: typeof defaultSetStoryDeferred;
  /**
   * Net-new backlog items + provenance (2026-06-14, D5): test seam for the
   * "Add work item" call. Defaults to the real `addWorkItem` client (which
   * hits the gateway add-item route -> AMS mint + description-grounded gen).
   */
  addWorkItemFn?: typeof defaultAddWorkItem;
}

// ============================================================================
// Component
// ============================================================================

export const MigrationDeliveryDashboard: React.FC<
  MigrationDeliveryDashboardProps
> = ({
  projectId,
  bookId,
  fetchDashboard = getMigrationDeliveryDashboard,
  now,
  onBackToBookOfWork,
  onOpenBacklog,
  onOpenGeneratedSpecs,
  defaultAutoRunPass2 = true,
  workstreamContext,
  epicDecisionsSummaries = [],
  onOpenEpicDetail,
  startBatchGenerationFn = startBatchGeneration,
  onPassTwoPersisted,
  fetchStaleSpecSummary = getStaleSpecSummary,
  fetchReadyToRetry = defaultGetReadyToRetry,
  resolvedBy = 'system',
  fetchBookOfWorkDraft = getMigrationBookOfWork,
  defineIntegrationTestsFn = defaultDefineIntegrationTests,
  company = '',
  project = '',
  hasActiveCurrentBaseline = false,
  triggerMigrateFn = defaultTriggerMigrate,
  fetchLatestRunFn = defaultGetLatestRun,
  setStoryDeferredFn = defaultSetStoryDeferred,
  addWorkItemFn = defaultAddWorkItem,
}) => {
  const [dashboard, setDashboard] =
    useState<MigrationDeliveryDashboardDto | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number | null>(null);
  // ----- Migration Reconciliation + Bug Loop (2026-06-14, Spec 4) ---------
  // The latest migration-execution run, surfaced by the Migrate panel via its
  // onRunLoaded callback. Drives the reconciliation review panel (which reads
  // the run's breaks) without a duplicate run fetch.
  const [latestRun, setLatestRun] = useState<MigrationExecutionRunDto | null>(
    null,
  );

  // Drawer state.
  const [drawerSelection, setDrawerSelection] = useState<{
    node: MigrationDeliveryHierarchyNodeDto;
    parentPath: string[];
  } | null>(null);

  // ----- Spec Quality Scoring (2026-05-20, Task Group 8) ------------------
  // Multi-select grade filter; default is all-selected (no filtering applied).
  const [gradeFilter, setGradeFilter] = useState<Set<GradeFilterValue>>(
    defaultGradeFilterState(),
  );
  // ----- Net-new backlog items + provenance (2026-06-14, D5) --------------
  // Single-select provenance filter (all | net_new | carry_over); default
  // `all` (no filtering). Intersected into the tree filter alongside the
  // grade filter. The "Add work item" modal open/in-flight/error state drives
  // the dashboard add-item form (the net-new add surface; D4).
  const [provenanceFilter, setProvenanceFilter] =
    useState<ProvenanceFilterValue>(defaultProvenanceFilterValue());
  const [addItemOpen, setAddItemOpen] = useState<boolean>(false);
  const [addItemSubmitting, setAddItemSubmitting] = useState<boolean>(false);
  const [addItemError, setAddItemError] = useState<string | null>(null);
  // Bulk-recompute UX state.
  const [recomputeInFlight, setRecomputeInFlight] = useState<boolean>(false);
  const [recomputeSummary, setRecomputeSummary] =
    useState<RecomputeAllSpecQualityResponse | null>(null);
  const [recomputeError, setRecomputeError] = useState<string | null>(null);

  // ----- Cross-Story Context Injection (2026-05-20) -----------------------
  const [generateAllOpen, setGenerateAllOpen] = useState<boolean>(false);
  const [concurrencyLock, setConcurrencyLock] = useState<{
    workstreamId: string;
    activePass: number;
  } | null>(null);
  const [lastBatchResult, setLastBatchResult] =
    useState<BatchGenerationResult | null>(null);
  const [batchInFlight, setBatchInFlight] = useState<boolean>(false);

  // ----- Target Architecture Authoring Flow (2026-05-20, Task Group 9) ----
  // Stale shape-spec summary surfacing on the dashboard. Fetched alongside
  // the dashboard payload via loadDashboard(); a successful "Regenerate
  // stale" action triggers a re-fetch so the count drops to zero.
  const [staleSummary, setStaleSummary] =
    useState<StaleSpecSummary | null>(null);

  // ----- Missing Input Resolver Flow (2026-05-20, Task Group 7) -----------
  // Ready-to-retry summary -- fetched alongside the dashboard. The
  // hierarchy-tree filter ("View ready stories") and the bulk-resolve modal
  // share the same refresh path so commits and retries always reconcile the
  // ready-to-retry count + the needs-attention list in one pass.
  const [readyToRetry, setReadyToRetry] =
    useState<ReadyToRetryResponse | null>(null);

  // ----- Findings Coverage + Gap Wayfinding (2026-06-11, Task Group 4.5) --
  // Deterministic findings coverage computed on read from the full draft
  // (create-time snapshot + current `book_of_work_json` items). `null`
  // hides the Evidence-card line entirely -- legacy drafts, fail-softed
  // snapshots, AND draft fetch failures all degrade to the current
  // reference-count-only card without blocking the dashboard.
  const [findingsCoverage, setFindingsCoverage] =
    useState<FindingsCoverageResult | null>(null);
  const [bulkResolveOpen, setBulkResolveOpen] = useState<boolean>(false);
  // When set, the hierarchy tree filters to this work-item id set ("View
  // ready stories" affordance on the ready-to-retry card). `null` shows the
  // full tree.
  const [hierarchyFilterIds, setHierarchyFilterIds] =
    useState<ReadonlySet<string> | null>(null);

  // ----- Holistic Integration/E2E TEST Work Items (2026-06-14, Group 4) ---
  // The blob-item id of the node whose define-tests call is in flight (null
  // when idle); the latest define-tests result (drives the result banner);
  // and the show/hide TEST filter for the tree.
  const [defineTestsInFlightNodeId, setDefineTestsInFlightNodeId] =
    useState<string | null>(null);
  const [defineTestsResult, setDefineTestsResult] =
    useState<DefineIntegrationTestsResult | null>(null);
  const [hideTestItems, setHideTestItems] = useState<boolean>(false);

  // ----- Migrate Button + Migration Execution Driver (2026-06-14, Group 5) --
  // The set of story `workItemId`s the user has deferred this session (defer is
  // implementation-EXCLUSION only -- it drops the story out of the hard-block
  // in-scope set, but NEVER out of reconciliation scope; CD-7). The dashboard
  // node DTO does not (yet) carry the persisted flag, so the UI tracks the
  // deferred set locally and seeds each toggle from the AMS PATCH result. The
  // in-flight work-item id disables its toggle so the user can't double-fire.
  const [deferredWorkItemIds, setDeferredWorkItemIds] = useState<Set<string>>(
    new Set(),
  );
  const [deferInFlightWorkItemId, setDeferInFlightWorkItemId] = useState<
    string | null
  >(null);

  // ----- Carry-over Completeness Gate (2026-06-14, D4) --------------------
  // The book-scoped carry-over review surface (the extended Capabilities view)
  // is opened from the Migrate panel's `carry_over_not_accounted` deep-link so a
  // blocked user can cite / dismiss the un-accounted behaviour-bearing work
  // in-app. On close we bump `migrateRefreshToken` so the Migrate panel re-checks
  // the gate (drops the now-stale server-side block); the user then retries
  // Migrate, which the gateway re-validates as accounted. The review surface is
  // scoped to the book + its current architecture (it spans every discovery run
  // the coverage covers, so it lists the architecture-wide capability set).
  const [carryOverReviewOpen, setCarryOverReviewOpen] = useState<boolean>(false);
  const [migrateRefreshToken, setMigrateRefreshToken] = useState<number>(0);

  const closeCarryOverReview = useCallback(() => {
    setCarryOverReviewOpen(false);
    // Re-check the Migrate gate now the cite/dismiss pass is done.
    setMigrateRefreshToken((n) => n + 1);
  }, []);

  const clockRef = useRef<() => number>(now ?? Date.now);
  useEffect(() => {
    clockRef.current = now ?? Date.now;
  }, [now]);

  // --------------------------------------------------------------------------
  // Fetch
  // --------------------------------------------------------------------------

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await fetchDashboard(projectId, bookId);
      setDashboard(next);
      setLastRefreshedAt(clockRef.current());
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to load dashboard';
      setError(message);
    } finally {
      setLoading(false);
    }
    // Independent fetch for the stale-spec summary (Task Group 9). Kept
    // out of the main try/catch so a transient stale-count failure does NOT
    // blank the rest of the dashboard; the indicator just stays at 0.
    try {
      const summary = await fetchStaleSpecSummary(projectId);
      setStaleSummary(summary);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to fetch stale summary';
      // Silent failure for the indicator -- the dashboard remains usable.
      console.warn('[mdd] stale-spec summary fetch failed:', message);
      setStaleSummary({ staleCount: 0, staleWorkItemIds: [] });
    }
    // Independent fetch for the ready-to-retry summary (Missing Input
    // Resolver Flow, Task Group 7). Same isolation rationale as above.
    try {
      const ready = await fetchReadyToRetry(projectId);
      setReadyToRetry(ready);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'Failed to fetch ready-to-retry summary';
      console.warn('[mdd] ready-to-retry fetch failed:', message);
      setReadyToRetry({ count: 0, specGenerationIds: [], specs: [] });
    }
    // Independent fetch of the full draft for the deterministic findings
    // coverage line (Spec 2026-06-11, Task Group 4.5). Same isolation
    // rationale as the two fetches above: a draft fetch failure degrades
    // to the reference-count-only Evidence card (coverage hidden) and
    // never blocks the dashboard load.
    try {
      const draft = await fetchBookOfWorkDraft(projectId, bookId);
      setFindingsCoverage(
        computeFindingsCoverage(
          draft.generationSummary,
          draft.bookOfWork?.items ?? [],
        ),
      );
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'Failed to fetch the book-of-work draft';
      console.warn('[mdd] findings-coverage draft fetch failed:', message);
      setFindingsCoverage(null);
    }
  }, [
    projectId,
    bookId,
    fetchDashboard,
    fetchStaleSpecSummary,
    fetchReadyToRetry,
    fetchBookOfWorkDraft,
  ]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  // --------------------------------------------------------------------------
  // Derived state
  // --------------------------------------------------------------------------

  const failedSections = useMemo(
    () => deriveFailedSections(dashboard?.warnings ?? []),
    [dashboard?.warnings],
  );

  const formattedRefreshTimestamp =
    lastRefreshedAt !== null
      ? formatRefreshTimestamp(lastRefreshedAt)
      : null;

  const showSoftWarningBanner =
    dashboard !== null &&
    dashboard.summary.totalStoryCount > SOFT_STORY_COUNT_THRESHOLD;

  // Pre-compute the union of pass-1 + pass-2 rows for the post-batch summary
  // and for surfacing pass-2 detail in the story drawer.
  const lastBatchRowsByWorkItemId = useMemo(() => {
    if (!lastBatchResult) return new Map<string, SpecGenerationRow>();
    const out = new Map<string, SpecGenerationRow>();
    // Pass-2 rows take precedence over pass-1 rows when both are present.
    for (const r of lastBatchResult.perStoryResults ?? []) {
      if (r.workItemId) out.set(r.workItemId, r);
    }
    for (const r of lastBatchResult.passTwoResults ?? []) {
      if (r.workItemId) out.set(r.workItemId, r);
    }
    return out;
  }, [lastBatchResult]);

  // --------------------------------------------------------------------------
  // Drawer open helpers
  // --------------------------------------------------------------------------

  const openDrawerForWorkItemId = useCallback(
    (workItemId: string | null, nodeId: string) => {
      if (!dashboard) return;
      const hit = findStoryWithPath(dashboard.hierarchy, (n) =>
        workItemId ? n.workItemId === workItemId : n.id === nodeId,
      );
      if (hit) setDrawerSelection(hit);
    },
    [dashboard],
  );

  const openDrawerForNeedsAttentionRow = useCallback(
    (row: MigrationDeliveryNeedsAttentionItemDto) => {
      if (!dashboard) return;
      const hit = findStoryWithPath(dashboard.hierarchy, (n) =>
        row.workItemId
          ? n.workItemId === row.workItemId
          : n.id === row.bookItemId,
      );
      if (hit) setDrawerSelection(hit);
    },
    [dashboard],
  );

  const drawerNeedsAttentionItem = useMemo(() => {
    if (!drawerSelection || !dashboard) return null;
    const storyWorkItemId = drawerSelection.node.workItemId;
    if (!storyWorkItemId) return null;
    return (
      dashboard.needsAttention.find(
        (item) => item.workItemId === storyWorkItemId,
      ) ?? null
    );
  }, [drawerSelection, dashboard]);

  const drawerSpecGeneration = useMemo<StoryPassTwoDetail | null>(() => {
    if (!drawerSelection) return null;
    const storyWorkItemId = drawerSelection.node.workItemId;
    if (!storyWorkItemId) return null;
    const row = lastBatchRowsByWorkItemId.get(storyWorkItemId);
    if (!row) return null;
    return {
      generationPass: row.generationPass ?? null,
      pass1SpecText: row.pass1SpecText ?? null,
      generatedSpecText: row.generatedSpecText,
      pass2ChangesSummary: row.pass2ChangesSummary ?? null,
      budgetMetaJson: row.budgetMetaJson ?? null,
      noMeaningfulChange: row.noMeaningfulChange ?? null,
      warnings: row.warnings ?? [],
    };
  }, [drawerSelection, lastBatchRowsByWorkItemId]);

  // --------------------------------------------------------------------------
  // Generate-all dialog handlers
  // --------------------------------------------------------------------------

  const handleGenerateAllConfirm = useCallback(
    async ({ autoRunPass2 }: { autoRunPass2: boolean }) => {
      setGenerateAllOpen(false);
      setBatchInFlight(true);
      setError(null);
      try {
        const result = await startBatchGenerationFn({
          projectId,
          bookOfWorkId: bookId,
          regenerateAll: false,
          autoRunPass2,
        });
        setLastBatchResult(result);
        setConcurrencyLock(null);
        // AppShell cache invalidation (per project_appshell_model_cache.md):
        // when pass 2 actually ran, the AMS write path persisted new pass-2
        // entities that the AppShell in-memory model cache doesn't know
        // about. The parent route is responsible for dispatching LOAD_MODEL
        // (same-arch) so any open architecture views surface the new
        // entities; we just signal the event up.
        const ranPass2 =
          (result.passTwoResults != null && result.passTwoResults.length > 0) ||
          (result.perStoryResults ?? []).some((r) => r.generationPass === 2);
        if (ranPass2 && onPassTwoPersisted) {
          onPassTwoPersisted({
            projectId,
            bookOfWorkId: bookId,
            batchResult: result,
          });
        }
        // Refresh dashboard to pick up new persisted rows.
        await loadDashboard();
      } catch (err) {
        if (
          err instanceof WorkstreamLockedError ||
          (err instanceof Error && err.name === 'WorkstreamLockedError')
        ) {
          const we = err as WorkstreamLockedError;
          setConcurrencyLock({
            workstreamId: we.workstreamId,
            activePass: we.activePass,
          });
        } else {
          setError(
            err instanceof Error ? err.message : 'Generate-all failed',
          );
        }
      } finally {
        setBatchInFlight(false);
      }
    },
    [projectId, bookId, startBatchGenerationFn, loadDashboard, onPassTwoPersisted],
  );

  // --------------------------------------------------------------------------
  // Ready-to-retry handlers (Missing Input Resolver Flow Task Group 7)
  // --------------------------------------------------------------------------

  const handleViewReadyStories = useCallback((workItemIds: string[]) => {
    if (workItemIds.length === 0) {
      setHierarchyFilterIds(null);
      return;
    }
    setHierarchyFilterIds(new Set(workItemIds));
  }, []);

  const clearHierarchyFilter = useCallback(() => {
    setHierarchyFilterIds(null);
  }, []);

  const handleRetryBatchComplete = useCallback(() => {
    setHierarchyFilterIds(null);
    void loadDashboard();
  }, [loadDashboard]);

  const handleBulkResolveCommitted = useCallback(() => {
    setBulkResolveOpen(false);
    void loadDashboard();
  }, [loadDashboard]);

  // --------------------------------------------------------------------------
  // Define Integration/E2E Tests handler (Holistic TEST Work Items, Group 4)
  // --------------------------------------------------------------------------
  // On activate of the per-node action, call the new node-scoped gateway
  // route over the node's blob-item id (`node.id`), then refresh the tree so
  // the freshly-created TEST siblings appear. The result is stashed to drive
  // the allow-with-warning + empty-plan + success banner. Failures surface in
  // the shared error banner (and clear any stale result banner).
  const handleDefineIntegrationTests = useCallback(
    async (node: MigrationDeliveryHierarchyNodeDto) => {
      setDefineTestsInFlightNodeId(node.id);
      setDefineTestsResult(null);
      setError(null);
      try {
        const result = await defineIntegrationTestsFn(projectId, bookId, node.id);
        setDefineTestsResult(result);
        // Refresh so new TEST siblings surface in the tree + flat backlog.
        await loadDashboard();
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : 'Failed to define integration/E2E tests',
        );
      } finally {
        setDefineTestsInFlightNodeId(null);
      }
    },
    [projectId, bookId, defineIntegrationTestsFn, loadDashboard],
  );

  // --------------------------------------------------------------------------
  // Defer-this-story handler (Migrate Button + Migration Execution Driver,
  // Group 5)
  // --------------------------------------------------------------------------
  // Persist the `deferred` flag on the story's work item (CD-7), then update
  // the local deferred set so the story immediately drops out of the
  // hard-block in-scope set + shows the "Deferred" badge. Defer EXCLUDES the
  // story from THIS Migrate run only -- it stays in reconciliation scope and
  // will surface as a break if not migrated. A refresh keeps the rest of the
  // dashboard in sync; the deferred set is the UI source of truth this session.
  const handleDeferStory = useCallback(
    async (workItemId: string, nextDeferred: boolean) => {
      setDeferInFlightWorkItemId(workItemId);
      setError(null);
      try {
        await setStoryDeferredFn(projectId, workItemId, nextDeferred);
        setDeferredWorkItemIds((prev) => {
          const next = new Set(prev);
          if (nextDeferred) next.add(workItemId);
          else next.delete(workItemId);
          return next;
        });
        await loadDashboard();
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : `Failed to ${nextDeferred ? 'defer' : 'un-defer'} the story`,
        );
      } finally {
        setDeferInFlightWorkItemId(null);
      }
    },
    [projectId, setStoryDeferredFn, loadDashboard],
  );

  // --------------------------------------------------------------------------
  // Add-work-item handler (Net-new backlog items + provenance, D5)
  // --------------------------------------------------------------------------
  // The PRIMARY describe->generate path: call the gateway add-item route (AMS
  // mints the story + stamps provenance, then the gateway triggers
  // description-grounded spec-gen for the new workItemId), then refresh the
  // dashboard so the new story surfaces in the hierarchy tree + dispatch set. A
  // failed add keeps the modal open with the entered values + the error.
  const handleAddItemSubmit = useCallback(
    async (values: AddItemFormValues) => {
      setAddItemSubmitting(true);
      setAddItemError(null);
      try {
        const input: AddWorkItemInput = {
          provenance: values.provenance,
          kind: values.kind,
          title: values.title,
          description: values.description,
          // D6: the net_new_operations the modal collected for a net_new + api
          // add (the AUTHORITATIVE reconcile-time match source). Present +
          // non-empty only for net_new + api; omitted otherwise.
          ...(values.netNewOperations && values.netNewOperations.length > 0
            ? { netNewOperations: values.netNewOperations }
            : {}),
        };
        await addWorkItemFn(projectId, bookId, input);
        setAddItemOpen(false);
        // Refresh so the freshly-minted (and generated) story surfaces.
        await loadDashboard();
      } catch (err) {
        setAddItemError(
          err instanceof Error ? err.message : 'Failed to add the work item',
        );
      } finally {
        setAddItemSubmitting(false);
      }
    },
    [projectId, bookId, addWorkItemFn, loadDashboard],
  );

  // --------------------------------------------------------------------------
  // Render
  // --------------------------------------------------------------------------

  return (
    <section
      className={styles.dashboardRoot}
      data-testid="mdd-dashboard-root"
    >
      {/* ----- Header ----- */}
      <header
        className={styles.dashboardHeader}
        data-testid="mdd-dashboard-header"
      >
        <div className={styles.headerLeft}>
          <h1
            className={styles.headerTitle}
            data-testid="mdd-dashboard-title"
          >
            {dashboard?.title ?? 'Migration Delivery Dashboard'}
          </h1>
          <div className={styles.headerMeta}>
            {dashboard && (
              <span
                className={styles.headerMetaItem}
                data-testid="mdd-dashboard-status"
              >
                Status:{' '}
                <span className={styles.headerStatusBadge}>
                  {dashboard.status}
                </span>
              </span>
            )}
            {dashboard && (
              <span
                className={styles.headerMetaItem}
                data-testid="mdd-dashboard-generated-at"
              >
                Generated at: {dashboard.generatedAt}
              </span>
            )}
          </div>
          <div
            className={styles.headerNavLinks}
            data-testid="mdd-dashboard-nav-links"
          >
            {onBackToBookOfWork && (
              <button
                type="button"
                className={styles.headerNavLink}
                onClick={onBackToBookOfWork}
                data-testid="mdd-nav-back-to-book"
              >
                {'← Book of Work'}
              </button>
            )}
            {onOpenBacklog && (
              <button
                type="button"
                className={styles.headerNavLink}
                onClick={onOpenBacklog}
                data-testid="mdd-nav-backlog"
              >
                Backlog
              </button>
            )}
            {onOpenGeneratedSpecs && (
              <button
                type="button"
                className={styles.headerNavLink}
                onClick={onOpenGeneratedSpecs}
                data-testid="mdd-nav-generated-specs"
              >
                Generated specs
              </button>
            )}
          </div>
        </div>
        <div className={styles.headerRight}>
          {formattedRefreshTimestamp && (
            <span
              className={styles.refreshTimestamp}
              data-testid="mdd-dashboard-last-refreshed"
            >
              Last refreshed {formattedRefreshTimestamp}
            </span>
          )}
          <button
            type="button"
            className={styles.refreshButton}
            onClick={() => void loadDashboard()}
            disabled={loading}
            data-testid="mdd-dashboard-refresh"
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
          {/* Add work item (Net-new backlog items + provenance, D5). The ONE
              net-new add surface on the dashboard: opens the describe->generate
              add-item form. */}
          <button
            type="button"
            className={styles.bulkButton}
            onClick={() => {
              setAddItemError(null);
              setAddItemOpen(true);
            }}
            data-testid="mdd-dashboard-add-item"
          >
            Add work item
          </button>
          <button
            type="button"
            className={styles.bulkButton}
            onClick={() => setBulkResolveOpen(true)}
            data-testid="mdd-dashboard-bulk-resolve"
          >
            Bulk resolve
          </button>
          <button
            type="button"
            className={styles.bulkButton}
            onClick={() => setGenerateAllOpen(true)}
            disabled={batchInFlight || concurrencyLock != null}
            data-testid="mdd-dashboard-generate-all"
          >
            Generate all
          </button>
          <button
            type="button"
            className={styles.bulkButton}
            onClick={async () => {
              setRecomputeError(null);
              setRecomputeSummary(null);
              setRecomputeInFlight(true);
              try {
                const result = await recomputeAllSpecQuality(projectId);
                setRecomputeSummary(result);
                void loadDashboard();
              } catch (e) {
                setRecomputeError(
                  e instanceof Error ? e.message : 'Recompute failed',
                );
              } finally {
                setRecomputeInFlight(false);
              }
            }}
            disabled={recomputeInFlight}
            data-testid="mdd-dashboard-recompute-all-quality"
          >
            {recomputeInFlight ? 'Recomputing…' : 'Recompute all quality'}
          </button>
        </div>
      </header>

      {/* Recompute-all summary banner (Spec 2026-05-20 Quality Scoring 8.4) */}
      {recomputeSummary && (
        <div
          className={styles.summaryBanner}
          data-testid="mdd-dashboard-recompute-all-summary"
          role="status"
        >
          <span>
            Scored {recomputeSummary.totalScored} specs (skipped{' '}
            {recomputeSummary.totalSkipped}).
            {` A:${recomputeSummary.gradeBreakdown.A ?? 0}`}
            {` B:${recomputeSummary.gradeBreakdown.B ?? 0}`}
            {` C:${recomputeSummary.gradeBreakdown.C ?? 0}`}
            {` D:${recomputeSummary.gradeBreakdown.D ?? 0}`}
            {` F:${recomputeSummary.gradeBreakdown.F ?? 0}`}
            {` N/A:${recomputeSummary.gradeBreakdown.na ?? 0}`}
          </span>
          <button
            type="button"
            className={styles.headerNavLink}
            onClick={() => setRecomputeSummary(null)}
            data-testid="mdd-dashboard-recompute-all-summary-dismiss"
          >
            Dismiss
          </button>
        </div>
      )}
      {recomputeError && (
        <div
          className={styles.errorBanner}
          data-testid="mdd-dashboard-recompute-all-error"
          role="alert"
        >
          {recomputeError}
        </div>
      )}

      {/* ----- Active-batch banner (cross-story context injection) ----- */}
      {concurrencyLock && (
        <MigrationDeliveryActiveBatchBanner
          activePass={concurrencyLock.activePass}
          workstreamId={concurrencyLock.workstreamId}
        />
      )}

      {/* ----- Error banner ----- */}
      {error && (
        <div
          className={styles.errorBanner}
          role="alert"
          data-testid="mdd-dashboard-error"
        >
          {error}
        </div>
      )}

      {/* ----- Define-tests result banner (Holistic TEST Work Items, Group 4)
          Allow-with-warning: a non-empty skippedChildren list is rendered as a
          prominent warning the user can act on (close the gaps + re-run); an
          empty plan renders a clear "no integration/E2E tests needed" message;
          otherwise the created-count is confirmed. ----- */}
      {defineTestsResult && (
        <div
          className={`${styles.defineTestsBanner} ${
            defineTestsResult.skippedChildren.length > 0
              ? styles.defineTestsBannerWarning
              : ''
          }`}
          role="status"
          data-testid="mdd-define-tests-result"
        >
          {defineTestsResult.emptyPlan ||
          defineTestsResult.createdTestItems.length === 0 ? (
            <span data-testid="mdd-define-tests-empty">
              No integration/E2E tests needed for this{' '}
              {defineTestsResult.level}.
            </span>
          ) : (
            <span data-testid="mdd-define-tests-created">
              Created {defineTestsResult.createdTestItems.length}{' '}
              integration/E2E TEST{' '}
              {defineTestsResult.createdTestItems.length === 1
                ? 'item'
                : 'items'}
              .
            </span>
          )}
          {defineTestsResult.skippedChildren.length > 0 && (
            <div data-testid="mdd-define-tests-skipped">
              <span>
                {defineTestsResult.skippedChildren.length}{' '}
                {defineTestsResult.skippedChildren.length === 1
                  ? 'child was'
                  : 'children were'}{' '}
                skipped (not spec-complete) — close the gaps and re-run to
                include them:
              </span>
              <ul className={styles.defineTestsBannerList}>
                {defineTestsResult.skippedChildren.map((c) => (
                  <li key={c.bookItemId}>
                    {c.title} ({c.reason})
                  </li>
                ))}
              </ul>
            </div>
          )}
          <button
            type="button"
            className={styles.headerNavLink}
            onClick={() => setDefineTestsResult(null)}
            data-testid="mdd-define-tests-result-dismiss"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* ----- Soft warning banner (Q-2) ----- */}
      {showSoftWarningBanner && (
        <div
          className={styles.warningBanner}
          role="alert"
          data-testid="mdd-dashboard-soft-warning"
        >
          {`This book contains ${dashboard!.summary.totalStoryCount} stories;`}
          {' rendering may be slow.'}
        </div>
      )}

      {/* ----- Summary cards ----- */}
      {dashboard &&
        (failedSections.has('summary') ||
        failedSections.has('specGenerationSummary') ||
        failedSections.has('backlogSaveSummary') ||
        failedSections.has('implementationSummary') ||
        failedSections.has('evidenceSummary') ? (
          <MigrationDeliverySectionRetryPlaceholder
            sectionName="summary cards"
            onRetry={() => void loadDashboard()}
            testId="mdd-summary-cards-placeholder"
          />
        ) : (
          <MigrationDeliverySummaryCards
            summary={dashboard.summary}
            specGenerationSummary={dashboard.specGenerationSummary}
            backlogSaveSummary={dashboard.backlogSaveSummary}
            implementationSummary={dashboard.implementationSummary}
            evidenceSummary={dashboard.evidenceSummary}
            findingsCoverage={findingsCoverage}
          />
        ))}

      {/* ----- Stale shape-specs panel (Target Arch Authoring Flow, Group 9) ----- */}
      {dashboard && (
        <MigrationDeliveryStaleSpecsPanel
          projectId={projectId}
          bookOfWorkId={bookId}
          staleSummary={staleSummary}
          needsAttention={dashboard.needsAttention}
          hierarchy={dashboard.hierarchy}
          onRegenerated={() => void loadDashboard()}
          startBatchGenerationFn={startBatchGenerationFn}
        />
      )}

      {/* ----- Ready-to-retry card (Missing Input Resolver Flow, Group 7) ----- */}
      {dashboard && (
        <MigrationDeliveryReadyToRetryCard
          projectId={projectId}
          bookOfWorkId={bookId}
          readyToRetry={readyToRetry}
          onViewReadyStories={handleViewReadyStories}
          onRetryComplete={handleRetryBatchComplete}
        />
      )}

            {/* ----- Workstream context (cross-story context injection) ----- */}
      {workstreamContext && (
        <MigrationDeliveryWorkstreamContextPanel
          workstreamContext={workstreamContext}
        />
      )}

      {/* ----- Epic decisions summary (cross-story context injection) - */}
      {epicDecisionsSummaries && epicDecisionsSummaries.length > 0 && (
        <MigrationDeliveryEpicDecisionsSummary
          summaries={epicDecisionsSummaries}
          onOpenEpicDetail={onOpenEpicDetail}
        />
      )}

      {/* ----- Workstream strip ----- */}
      {dashboard &&
        (failedSections.has('workstreamSummaries') ? (
          <MigrationDeliverySectionRetryPlaceholder
            sectionName="workstream progress"
            onRetry={() => void loadDashboard()}
            testId="mdd-workstream-strip-placeholder"
          />
        ) : (
          <MigrationDeliveryWorkstreamProgressStrip
            workstreamSummaries={dashboard.workstreamSummaries}
          />
        ))}

      {/* ----- Post-batch summary (cross-story context injection) ----- */}
      {lastBatchResult && (
        <MigrationDeliveryPostBatchSummary
          rows={[
            ...(lastBatchResult.perStoryResults ?? []),
            ...(lastBatchResult.passTwoResults ?? []),
          ]}
        />
      )}

      {/* ----- Migrate panel (Migrate Button + Migration Execution Driver,
          Group 5). Book-of-work-scoped: the Migrate button + hard-block gate +
          confirm + run-progress view. ----- */}
      {dashboard && (
        <MigrationDeliveryMigratePanel
          projectId={projectId}
          bookId={bookId}
          hierarchy={dashboard.hierarchy}
          deferredWorkItemIds={deferredWorkItemIds}
          hasActiveCurrentBaseline={hasActiveCurrentBaseline}
          company={company}
          project={project}
          triggerMigrateFn={triggerMigrateFn}
          fetchLatestRunFn={fetchLatestRunFn}
          onRunLoaded={setLatestRun}
          onReviewCarryOver={() => setCarryOverReviewOpen(true)}
          refreshToken={migrateRefreshToken}
        />
      )}

      {/* ----- Reconciliation review panel (Migration Reconciliation + Bug
          Loop, Spec 4 -- Group 5). Run-scoped: lists the run's breaks, the
          human-gated send vs disposition, the re-reconcile outcomes + the
          needs-review queue, and the needs_target_credentials pause. Only
          mounts once a run exists (it has an id). ----- */}
      {dashboard && latestRun?.id && (
        <MigrationDeliveryReconciliationPanel
          projectId={projectId}
          runId={latestRun.id}
          runStatus={latestRun.status ?? null}
          company={company}
          project={project}
        />
      )}

      {/* ----- Hierarchy tree (Group 9) ----- */}
      {dashboard &&
        (failedSections.has('hierarchy') ? (
          <MigrationDeliverySectionRetryPlaceholder
            sectionName="hierarchy"
            onRetry={() => void loadDashboard()}
            testId="mdd-hierarchy-placeholder"
          />
        ) : (
          <section
            className={styles.hierarchySection}
            data-testid="mdd-hierarchy-section"
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <h2 className={styles.sectionTitle}>Hierarchy</h2>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                }}
              >
                {/* Show/hide TEST filter (Holistic TEST Work Items, Group 4).
                    Prunes `type === 'TEST'` siblings from the tree when
                    unchecked. */}
                <label
                  className={styles.testFilterToggle}
                  data-testid="mdd-hierarchy-test-filter-label"
                >
                  <input
                    type="checkbox"
                    checked={!hideTestItems}
                    onChange={(e) => setHideTestItems(!e.target.checked)}
                    data-testid="mdd-hierarchy-test-filter"
                  />
                  Show TEST items
                </label>
                {hierarchyFilterIds && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                    }}
                    data-testid="mdd-hierarchy-filter-indicator"
                  >
                    <span style={{ fontSize: 12, color: '#607d8b' }}>
                      Filtered to {hierarchyFilterIds.size} ready-to-retry{' '}
                      {hierarchyFilterIds.size === 1 ? 'story' : 'stories'}
                    </span>
                    <button
                      type="button"
                      className={styles.headerNavLink}
                      onClick={clearHierarchyFilter}
                      data-testid="mdd-hierarchy-filter-clear"
                    >
                      Clear filter
                    </button>
                  </div>
                )}
              </div>
            </div>
            <MigrationDeliveryGradeFilter
              value={gradeFilter}
              onChange={setGradeFilter}
              testId="mdd-dashboard-grade-filter"
            />
            <MigrationDeliveryProvenanceFilter
              value={provenanceFilter}
              onChange={setProvenanceFilter}
              testId="mdd-dashboard-provenance-filter"
            />
            <MigrationDeliveryHierarchyTree
              hierarchy={dashboard.hierarchy}
              onStorySelected={openDrawerForWorkItemId}
              onDefineIntegrationTests={(node) =>
                void handleDefineIntegrationTests(node)
              }
              defineTestsInFlightNodeId={defineTestsInFlightNodeId}
              hideTestItems={hideTestItems}
              onDeferStory={(workItemId, nextDeferred) =>
                void handleDeferStory(workItemId, nextDeferred)
              }
              deferInFlightWorkItemId={deferInFlightWorkItemId}
              deferredWorkItemIds={deferredWorkItemIds}
              filterStoryWorkItemIds={(() => {
                // Intersect existing workItemId filter (if any) with the
                // grade-filter set. The tree's filter prop is a list of
                // workItemIds; we compute the grade-passing set by walking
                // story nodes once.
                const gradeAllDefault =
                  gradeFilter.size === defaultGradeFilterState().size &&
                  [...defaultGradeFilterState()].every((v) => gradeFilter.has(v));
                const provenanceAllDefault = provenanceFilter === 'all';
                if (
                  gradeAllDefault &&
                  provenanceAllDefault &&
                  !hierarchyFilterIds
                )
                  return undefined;
                const allowed = new Set<string>();
                const walk = (
                  nodes: ReadonlyArray<MigrationDeliveryHierarchyNodeDto>,
                ): void => {
                  for (const node of nodes) {
                    if (node.type === 'story' && node.workItemId) {
                      if (
                        isGradeAllowedByFilter(
                          node.qualityGrade ?? null,
                          gradeFilter,
                        ) &&
                        isProvenanceAllowedByFilter(
                          node.provenance ?? null,
                          provenanceFilter,
                        )
                      ) {
                        allowed.add(node.workItemId);
                      }
                    }
                    if (node.children?.length) walk(node.children);
                  }
                };
                walk(dashboard.hierarchy);
                if (hierarchyFilterIds) {
                  const inter = new Set<string>();
                  for (const id of hierarchyFilterIds) {
                    if (allowed.has(id)) inter.add(id);
                  }
                  return inter;
                }
                return allowed;
              })()}
            />
          </section>
        ))}

      {/* ----- Needs-attention panel (Group 10) ----- */}
      {dashboard &&
        (failedSections.has('needsAttention') ? (
          <MigrationDeliverySectionRetryPlaceholder
            sectionName="needs-attention panel"
            onRetry={() => void loadDashboard()}
            testId="mdd-needs-attention-placeholder"
          />
        ) : (
          <MigrationDeliveryNeedsAttentionPanel
            projectId={projectId}
            bookOfWorkId={bookId}
            needsAttention={dashboard.needsAttention}
            workstreamSummaries={dashboard.workstreamSummaries}
            onBatchComplete={() => void loadDashboard()}
            onRowClick={openDrawerForNeedsAttentionRow}
          />
        ))}

      {/* ----- Story detail drawer (Group 11) ----- */}
      {drawerSelection && (
        <MigrationDeliveryStoryDrawer
          story={drawerSelection.node}
          parentPath={drawerSelection.parentPath}
          needsAttentionItem={drawerNeedsAttentionItem}
          specGeneration={drawerSpecGeneration}
          onClose={() => setDrawerSelection(null)}
        />
      )}

      {/* ----- Generate-all dialog (cross-story context injection) ----- */}
      {generateAllOpen && (
        <MigrationDeliveryGenerateAllDialog
          projectId={projectId}
          bookOfWorkId={bookId}
          defaultAutoRunPass2={defaultAutoRunPass2}
          concurrencyLockError={
            concurrencyLock
              ? {
                  code: 'WORKSTREAM_LOCKED',
                  message: 'Batch in progress',
                  workstreamId: concurrencyLock.workstreamId,
                  activePass: concurrencyLock.activePass,
                }
              : null
          }
          onConfirm={(input) => void handleGenerateAllConfirm(input)}
          onClose={() => setGenerateAllOpen(false)}
        />
      )}

      {/* ----- Carry-over completeness review surface (Carry-over Completeness
          Gate, D4). Opened from the Migrate panel's `carry_over_not_accounted`
          deep-link. A book-scoped overlay (matching the bulk-resolve modal
          pattern) hosting the extended Capabilities view: per-capability
          coverage status + Cite / Dismiss(reason) / Generate-all, all wired to
          the gateway carry-over routes. Mounted with the dashboard's bookId +
          current architecture; no single runId (it spans the runs the coverage
          covers). On close the Migrate gate is re-checked. ----- */}
      {carryOverReviewOpen && dashboard?.currentArchitectureId && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Review carry-over coverage"
          data-testid="mdd-carry-over-review"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'center',
            zIndex: 998,
            overflowY: 'auto',
            padding: '5vh 0',
          }}
          onClick={(e) => {
            // Click-outside the panel closes (mirrors the dashboard overlays).
            if (e.target === e.currentTarget) closeCarryOverReview();
          }}
        >
          <div
            style={{
              background: '#fff',
              padding: 24,
              borderRadius: 8,
              width: 880,
              maxWidth: '95vw',
              maxHeight: '90vh',
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <h3 style={{ margin: 0 }}>Review carry-over coverage</h3>
              <button
                type="button"
                className={styles.headerNavLink}
                onClick={closeCarryOverReview}
                data-testid="mdd-carry-over-review-close"
              >
                Close
              </button>
            </div>
            <p style={{ margin: 0, fontSize: 13, color: '#607d8b' }}>
              Cite a story or dismiss (with a reason) every behaviour-bearing
              capability below. Migrate stays blocked until everything is
              accounted for; closing this re-checks the gate.
            </p>
            <CapabilitiesSection
              projectId={projectId}
              architectureId={dashboard.currentArchitectureId}
              bookId={bookId}
            />
          </div>
        </div>
      )}

      {/* ----- Add-work-item modal (Net-new backlog items + provenance, D5).
          The ONE net-new add surface: provenance + kind + title + description
          (describe->generate). On submit the gateway add-item route mints the
          story + stamps provenance + triggers description-grounded spec-gen,
          then the dashboard refreshes so the story surfaces in the tree +
          dispatch set. ----- */}
      {addItemOpen && (
        <MigrationDeliveryAddItemModal
          onSubmit={(values) => void handleAddItemSubmit(values)}
          onClose={() => setAddItemOpen(false)}
          submitting={addItemSubmitting}
          error={addItemError}
        />
      )}

      {/* ----- Bulk-resolve modal (Missing Input Resolver Flow, Group 7) ----- */}
      {bulkResolveOpen && (
        <MigrationDeliveryBulkResolveModal
          projectId={projectId}
          resolvedBy={resolvedBy}
          onClose={() => setBulkResolveOpen(false)}
          onCommitted={handleBulkResolveCommitted}
        />
      )}
    </section>
  );
};

export default MigrationDeliveryDashboard;
