/**
 * Migration Execution Driver (gateway-hosted, NOT a new microservice).
 *
 * Turns a human-reviewed migration book of work into running code. The Driver
 * is EVENT-DRIVEN over durable AMS run-state (changeset 182), so it survives a
 * gateway restart: each build-results callback (Group 3) steps the run forward.
 * The ONLY in-memory window is a single spec's shape-spec-answer -> submit
 * segment (the detached per-spec runner below).
 *
 * Responsibilities (Spec 3, Task Group 2):
 *   - the HARD-BLOCK readiness gate (server-side; never trusts the UI): refuse
 *     to start unless every IN-SCOPE (non-deferred) story is spec-ready AND an
 *     active `kind='current'` baseline exists (CD-7);
 *   - pin the active baseline id on the run (the run's behavioural oracle is
 *     fixed at kick-off and does not drift -- CD-7);
 *   - build the ordered dispatch set from `book_of_work_json` in
 *     (depth, sequenceOrder) order, EXCLUDING deferred items, INCLUDING TEST
 *     items (they sort after their spanned children naturally -- CD-5);
 *   - create the AMS run (items in order; `deploy_on_complete=TRUE` only on the
 *     FINAL item -- big-bang);
 *   - dispatch the FIRST spec, then return immediately (the run is NOT held in
 *     the request -- CD-5);
 *   - per-spec dispatch: drive the headless shape-spec stream via the
 *     auto-answerer (Group 4 seam), then POST the orchestration submit with a
 *     per-request `callback_url` (CD-3) + `deploy_on_complete` (final only),
 *     correlating the returned `job_id` to the run-item;
 *   - advance on each callback (Group 3) and trigger the deploy on the final
 *     spec's success;
 *   - a boot-recovery sweep on gateway startup reconciles in-flight run-state
 *     vs reality and re-kicks any spec stuck mid-segment (CD-2);
 *   - per-item failure isolation (one item's failure halts THIS run cleanly,
 *     recorded against the work item, never corrupts unrelated state) +
 *     structured `[diag-gateway] migration_execution_driver ...` logs.
 *
 * Everything external is injected ({@link MigrationDriverDeps}) so the Driver is
 * unit-testable with mocks and the live-LLM guard is respected (the LLM is only
 * ever reached through the injected auto-answerer, which is mocked in tests).
 *
 * Spec: Migrate Button + Migration Execution Driver + External Shape-Spec
 * Auto-Answerer (2026-06-14, Spec 3 of 4) -- Task Groups 2 + 3.
 */

import { logger } from './logger';
import { createTracer } from '../trace';

// Haikai workflow trace (OFF unless HAIKAI_TRACE set). SUMMARY across the
// migrate orchestration: run started / spec dispatched / build-results /
// run deployed, keyed on project+run(+job). See docs/trace-logging.md.
const trace = createTracer('gateway');
import {
  createMigrationExecutionRun,
  getMigrationExecutionRun,
  patchMigrationExecutionRun,
  patchMigrationExecutionRunItem,
  findMigrationRunItemByJobId,
  MigrationExecutionRun,
  MigrationExecutionRunItem,
  RUN_STATUS,
  RUN_ITEM_STATUS,
  TERMINAL_OUTCOMES,
} from './migrationExecutionRunClient';
import {
  fetchBookOfWork,
  fetchSpecGenerationsForBook,
  fetchWorkItems,
  fetchActiveCurrentBaseline,
  BookOfWork,
  BookOfWorkItem,
  SpecGeneration,
  WorkItem,
} from './migrationDriverAmsReads';
import {
  submitOrchestration,
  submitOrchestrationBatch,
  OrchestrationSubmitResult,
} from './migrationOrchestrationSubmit';
import { recordWorkItemImplementationError } from './migrationWorkItemErrorSink';
import {
  ShapeSpecAutoAnswerer,
  ShapeSpecAnswerResult,
} from './shapeSpecAutoAnswererSeam';
import { buildDefaultShapeSpecAutoAnswerer } from './shapeSpecAutoAnswerer';
import {
  ReconciliationDriverDeps,
  defaultReconciliationDriverDeps,
  triggerFullBaselineReconcile,
  handleBugCallback,
  BugCallbackResult,
} from './migrationReconciliationDriver';
import {
  computeCarryOverCoverage,
  CarryOverCoverageResult,
} from './migrationCarryOverCoverage';
import {
  CarryOverCoverageReadsDeps,
  defaultCarryOverCoverageReadsDeps,
  gatherCarryOverCoverageInputs,
} from './migrationCarryOverCoverageReads';
import {
  DbPackGateReads,
  dbStoriesInScope,
  evaluateDbPackReadiness,
} from './migrationDbExecutionGate';

/**
 * A fixed AMS path-segment used when correlating purely by job_id. The AMS
 * by-job-id endpoint matches on the globally-unique job_id (the path project is
 * routing decoration only); the authoritative project id is recovered from the
 * matched run-item's run. Used by the build-results advance, which receives only
 * company/project (not the AMS project UUID).
 */
const JOB_PROBE_PROJECT_SEGMENT = 'by-job';

// ============================================================================
// Types
// ============================================================================

/** A single resolved spec ready to be sequenced into the run. */
export interface DispatchDescriptor {
  /** Position in the (depth, sequenceOrder) walk (0-based). */
  sequencePosition: number;
  /** The story / TEST work item this spec implements. */
  workItemId: string | null;
  /** The spec-generation row whose `generated_spec_text` is dispatched. */
  specGenerationId: string | null;
  /** The book-item id (diagnostics / traceability). */
  bookItemId: string | null;
  /** The combined `/agent-os:shape-spec ...` body fed to the stream. */
  generatedSpecText: string;
  /** Book-item title (diagnostics). */
  title: string;
  /** TRUE only on the FINAL item (big-bang deploy). */
  deployOnComplete: boolean;
}

/** Result of the hard-block readiness evaluation. */
export interface HardBlockResult {
  /** True when Migrate is permitted. */
  ok: boolean;
  /** Each blocking reason (machine-stable `code` + human `message`). */
  reasons: Array<{ code: string; message: string; workItemId?: string | null }>;
}

/** Identifying inputs for a Migrate run. */
export interface MigrateScope {
  projectId: string;
  bookId: string;
  /** Normalised organisation (orchestration `company`). */
  company: string;
  /** Normalised product (orchestration `project`). */
  project: string;
  /**
   * Subset migrate (2026-06-26): when non-empty, restrict the run to these work
   * items. Omitted/empty = the whole book (legacy behaviour).
   */
  selectedWorkItemIds?: string[] | null;
  /**
   * Batch migrate (2026-06-26): when set (non-empty), all selected specs are
   * submitted as ONE job -> one `feature/<batchName>` branch + one MR (instead
   * of the sequential one-job-per-spec dispatch).
   */
  batchName?: string | null;
}

/** The injectable dependency surface (the DI seam for tests). */
export interface MigrationDriverDeps {
  fetchBookOfWork: typeof fetchBookOfWork;
  fetchSpecGenerationsForBook: typeof fetchSpecGenerationsForBook;
  fetchWorkItems: typeof fetchWorkItems;
  fetchActiveCurrentBaseline: typeof fetchActiveCurrentBaseline;
  createMigrationExecutionRun: typeof createMigrationExecutionRun;
  getMigrationExecutionRun: typeof getMigrationExecutionRun;
  patchMigrationExecutionRun: typeof patchMigrationExecutionRun;
  patchMigrationExecutionRunItem: typeof patchMigrationExecutionRunItem;
  findMigrationRunItemByJobId: typeof findMigrationRunItemByJobId;
  submitOrchestration: typeof submitOrchestration;
  /**
   * Batch submit (2026-06-26, subset migrate -> one branch). Optional + lazily
   * defaulted to {@link submitOrchestrationBatch} so existing deps mocks/call
   * sites that predate batch mode keep compiling.
   */
  submitOrchestrationBatch?: typeof submitOrchestrationBatch;
  /**
   * DB-pack readiness gate reads (Spec 2026-07-02-e). Optional + defaulted
   * inside {@link evaluateDbPackReadiness} so pre-existing deps mocks keep
   * compiling; injected in tests.
   */
  dbPackGateReads?: DbPackGateReads;
  recordWorkItemImplementationError: typeof recordWorkItemImplementationError;
  /** The headless shape-spec auto-answerer (Group 4); mocked in tests. */
  autoAnswerer: ShapeSpecAutoAnswerer;
  /**
   * The gateway's own build-results callback URL, threaded per-request on every
   * orchestration submit (CD-3). Resolved from config / env at call time.
   */
  buildResultsCallbackUrl: string;
  /**
   * The reconcile + bug-loop dependency surface (Spec 4). Wires the
   * `deployed`->full-baseline-reconcile trigger (Group 2) and the `bug_id`
   * callback->scoped-re-reconcile + circuit breaker (Group 4). Lazily defaulted
   * (`defaultReconciliationDriverDeps`) so existing Spec-3 call sites that don't
   * pass it keep working; tests inject a mock.
   */
  reconciliationDeps?: ReconciliationDriverDeps;
  /**
   * Triggers the FULL-baseline reconcile on a `deployed` (no bug_id) outcome
   * (Group 2 seam). Defaults to {@link triggerFullBaselineReconcile}; the
   * production wiring runs it fire-and-forget (the door must 202 promptly).
   */
  triggerReconcile?: typeof triggerFullBaselineReconcile;
  /**
   * Handles a `bug_id` build-results callback (Group 4 seam). Defaults to
   * {@link handleBugCallback}; run fire-and-forget for `deployed` (scoped
   * re-reconcile is long), inline for `failed`/`rejected` (no replay).
   */
  handleBugCallback?: typeof handleBugCallback;
  /**
   * The carry_over completeness-gate AMS reads (D4). The gate gathers
   * behaviour-bearing capabilities + findings for the book's project +
   * architecture and joins the work_item `source_capability_id` column to derive
   * the cited-capability set. Optional + lazily defaulted
   * (`defaultCarryOverCoverageReadsDeps`) so existing Spec-3 call sites that do
   * not pass it keep working; tests inject mocks (no live AMS / LLM).
   */
  carryOverCoverageReads?: CarryOverCoverageReadsDeps;
}

/** Outcome of the Migrate trigger. */
export type StartMigrationResult =
  | { status: 'started'; runId: string; itemCount: number }
  | { status: 'blocked'; reasons: HardBlockResult['reasons'] }
  | { status: 'error'; message: string };

// ============================================================================
// Spec-ready predicate (CD-7) -- pure
// ============================================================================

const READY_SPEC_STATUSES = new Set(['generated', 'generated_with_warnings']);

/**
 * The latest spec-generation row for a work item (highest attempt number, then
 * latest createdAt) -- mirrors the AMS dashboard's latest-per-work-item rule.
 */
export function latestSpecGenerationForWorkItem(
  workItemId: string,
  specGens: SpecGeneration[]
): SpecGeneration | null {
  let best: SpecGeneration | null = null;
  for (const row of specGens) {
    if (row.work_item_id !== workItemId) continue;
    if (best === null) {
      best = row;
      continue;
    }
    const an = row.generation_attempt_number ?? 0;
    const bn = best.generation_attempt_number ?? 0;
    if (an > bn) {
      best = row;
    } else if (an === bn) {
      const at = row.created_at ?? '';
      const bt = best.created_at ?? '';
      if (at >= bt) best = row;
    }
  }
  return best;
}

/**
 * A story is spec-ready iff (CD-7):
 *   - it is saved to backlog (`workItemId` present), AND
 *   - its latest spec-generation status is generated / generated_with_warnings, AND
 *   - it is not stale (`stale_reason = null`).
 */
export function isStorySpecReady(
  item: BookOfWorkItem,
  specGens: SpecGeneration[]
): boolean {
  if (!item.workItemId) return false;
  const latest = latestSpecGenerationForWorkItem(item.workItemId, specGens);
  if (!latest) return false;
  if (!READY_SPEC_STATUSES.has(latest.status ?? '')) return false;
  if (latest.stale_reason) return false;
  return true;
}

// ============================================================================
// Book-of-work walk (depth, sequenceOrder) -- pure
// ============================================================================

/**
 * Walk `book_of_work_json.items[]` in (depth, sequenceOrder) order. The walk is
 * a parent-first depth traversal; siblings are visited in `sequenceOrder` (then
 * source order as a stable tiebreak). TEST items fall after their spanned
 * children naturally because Spec 2 wrote them at a `sequenceOrder` after the
 * last spanned child -- no special-casing here (CD-5).
 *
 * @returns the items in dispatch order (roots first, depth-first by sequenceOrder)
 */
export function walkBookOfWorkItems(items: BookOfWorkItem[]): BookOfWorkItem[] {
  const childrenByParent = new Map<string | null, BookOfWorkItem[]>();
  for (const item of items) {
    const parent = item.parentId ?? null;
    const list = childrenByParent.get(parent) ?? [];
    list.push(item);
    childrenByParent.set(parent, list);
  }

  const sortSiblings = (a: BookOfWorkItem, b: BookOfWorkItem): number => {
    const sa = a.sequenceOrder ?? Number.MAX_SAFE_INTEGER;
    const sb = b.sequenceOrder ?? Number.MAX_SAFE_INTEGER;
    if (sa !== sb) return sa - sb;
    // Stable tiebreak on source order.
    return items.indexOf(a) - items.indexOf(b);
  };

  const ordered: BookOfWorkItem[] = [];
  const visited = new Set<BookOfWorkItem>();
  const visit = (parentId: string | null): void => {
    const kids = (childrenByParent.get(parentId) ?? []).slice().sort(sortSiblings);
    for (const kid of kids) {
      if (visited.has(kid)) continue; // guard against malformed cycles
      visited.add(kid);
      ordered.push(kid);
      if (kid.id) visit(kid.id);
    }
  };
  visit(null);

  // Any items whose parent was never reached (orphan parentId) are appended in
  // source order so nothing is silently dropped.
  for (const item of items) {
    if (!visited.has(item)) {
      visited.add(item);
      ordered.push(item);
    }
  }
  return ordered;
}

/** True when a book item / its work item is a deferred story (CD-7). */
function isDeferred(item: BookOfWorkItem, deferredWorkItemIds: Set<string>): boolean {
  return !!item.workItemId && deferredWorkItemIds.has(item.workItemId);
}

/**
 * Resolve the latest spec-generation row carrying a non-empty
 * `generated_spec_text` for a book item. Only leaf stories / TEST items carry a
 * spec to dispatch; structural nodes (initiative / epic / feature) are
 * scaffolding and resolve to null (and are skipped from the dispatch set).
 */
function resolveSpecText(
  item: BookOfWorkItem,
  specGens: SpecGeneration[]
): SpecGeneration | null {
  if (!item.workItemId) return null;
  const latest = latestSpecGenerationForWorkItem(item.workItemId, specGens);
  if (!latest) return null;
  const text = latest.generated_spec_text ?? '';
  if (text.trim() === '') return null;
  return latest;
}

// ============================================================================
// Hard-block readiness gate (CD-7) -- pure
// ============================================================================

/**
 * Evaluate the server-side hard-block gate (CD-7). Refuses if ANY in-scope
 * (non-deferred) story is not spec-ready, OR if no active `kind='current'`
 * baseline exists. Returns the full per-reason list (never short-circuits) so
 * the caller can surface exactly what is blocking.
 */
export function evaluateHardBlock(params: {
  items: BookOfWorkItem[];
  specGens: SpecGeneration[];
  deferredWorkItemIds: Set<string>;
  hasActiveCurrentBaseline: boolean;
  /**
   * Subset migrate: when non-empty, only the SELECTED stories are gated for
   * spec-readiness (unselected stories are out of this run's scope and must not
   * block it). The baseline + carry_over dimensions are unaffected.
   */
  selectedWorkItemIds?: Set<string> | null;
  /**
   * The carry_over completeness coverage result (D4). When supplied, EACH
   * un-accounted behaviour-bearing item (capability OR un-grouped finding) adds
   * a `carry_over_not_accounted` reason — surfaced in the SAME `reasons[]` list
   * as the existing reasons and treated identically. Omitted on legacy call
   * sites (the dimension simply does not contribute).
   */
  carryOverCoverage?: CarryOverCoverageResult;
}): HardBlockResult {
  const reasons: HardBlockResult['reasons'] = [];
  const hasSelection = !!params.selectedWorkItemIds && params.selectedWorkItemIds.size > 0;

  for (const item of params.items) {
    // Only leaf STORY/TEST nodes carry specs; structural nodes are scaffolding.
    // A node with no work item is not a story to gate.
    const isStoryNode = !!item.workItemId;
    if (!isStoryNode) continue;
    if (isDeferred(item, params.deferredWorkItemIds)) continue; // deferred drops out
    if (hasSelection && !params.selectedWorkItemIds!.has(item.workItemId as string)) {
      continue; // out of the selected subset
    }
    if (!isStorySpecReady(item, params.specGens)) {
      reasons.push({
        code: 'story_not_spec_ready',
        message:
          `Story "${item.title ?? item.workItemId}" is not spec-ready ` +
          `(must be saved to backlog, generated/generated_with_warnings, and not stale).`,
        workItemId: item.workItemId ?? null,
      });
    }
  }

  if (!params.hasActiveCurrentBaseline) {
    reasons.push({
      code: 'missing_current_baseline',
      message:
        'No active current-state API-behaviour baseline exists for the workspace. ' +
        'You cannot reconcile without an oracle, so Migrate is blocked until one is captured.',
    });
  }

  // === D4: carry_over completeness dimension ===
  // Each un-accounted behaviour-bearing carry_over item (capability OR
  // un-grouped finding) is a `carry_over_not_accounted` reason. Non-API work has
  // NO reconciliation backstop, so a human must CITE or DISMISS each before
  // Migrate unlocks. Capabilities and findings are surfaced IDENTICALLY in the
  // same offending list (D1). This STACKS with the reasons above.
  if (params.carryOverCoverage) {
    for (const item of params.carryOverCoverage.unaccounted) {
      const kindLabel = item.kind === 'capability' ? 'capability' : 'finding';
      reasons.push({
        code: 'carry_over_not_accounted',
        message:
          `Behaviour-bearing carry_over ${kindLabel} "${item.label}" is neither cited by a story ` +
          `nor dismissed with a reason. Non-API work has no reconciliation backstop, so account for it ` +
          `(create a story or dismiss it) before Migrate.`,
      });
    }
  }

  return { ok: reasons.length === 0, reasons };
}

// ============================================================================
// Ordered dispatch set builder (CD-5) -- pure
// ============================================================================

/**
 * Build the ordered dispatch set: walk the book in (depth, sequenceOrder)
 * order, EXCLUDE deferred items, INCLUDE TEST items, resolve each dispatchable
 * node's `generated_spec_text`, and mark the FINAL item `deployOnComplete=TRUE`
 * (big-bang). Structural / spec-less nodes are skipped.
 */
export function buildOrderedDispatchSet(params: {
  book: BookOfWork;
  specGens: SpecGeneration[];
  deferredWorkItemIds: Set<string>;
  /**
   * Subset migrate: when non-empty, dispatch ONLY these work items (the rest of
   * the book is out of scope for this run). Omitted/empty = the whole book.
   */
  selectedWorkItemIds?: Set<string> | null;
}): DispatchDescriptor[] {
  const items = params.book.book_of_work_json?.items ?? [];
  const ordered = walkBookOfWorkItems(items);
  const hasSelection = !!params.selectedWorkItemIds && params.selectedWorkItemIds.size > 0;

  const descriptors: DispatchDescriptor[] = [];
  for (const item of ordered) {
    if (isDeferred(item, params.deferredWorkItemIds)) continue;
    if (hasSelection && (!item.workItemId || !params.selectedWorkItemIds!.has(item.workItemId))) {
      continue; // out of the selected subset
    }
    const specGen = resolveSpecText(item, params.specGens);
    if (!specGen) continue; // structural / spec-less node -- not dispatched
    descriptors.push({
      sequencePosition: descriptors.length,
      workItemId: item.workItemId ?? null,
      specGenerationId: specGen.id ?? null,
      bookItemId: item.id ?? null,
      generatedSpecText: specGen.generated_spec_text ?? '',
      title: item.title ?? '',
      deployOnComplete: false,
    });
  }
  // Big-bang: only the FINAL spec deploys.
  if (descriptors.length > 0) {
    descriptors[descriptors.length - 1].deployOnComplete = true;
  }
  return descriptors;
}

// ============================================================================
// Driver
// ============================================================================

/** Build the default (production) dependency surface. */
export function defaultMigrationDriverDeps(
  buildResultsCallbackUrl: string,
  autoAnswerer: ShapeSpecAutoAnswerer = buildDefaultShapeSpecAutoAnswerer()
): MigrationDriverDeps {
  return {
    fetchBookOfWork,
    fetchSpecGenerationsForBook,
    fetchWorkItems,
    fetchActiveCurrentBaseline,
    createMigrationExecutionRun,
    getMigrationExecutionRun,
    patchMigrationExecutionRun,
    patchMigrationExecutionRunItem,
    findMigrationRunItemByJobId,
    submitOrchestration,
    submitOrchestrationBatch,
    recordWorkItemImplementationError,
    autoAnswerer,
    buildResultsCallbackUrl,
    reconciliationDeps: defaultReconciliationDriverDeps(),
    triggerReconcile: triggerFullBaselineReconcile,
    handleBugCallback,
    carryOverCoverageReads: defaultCarryOverCoverageReadsDeps(),
  };
}

/**
 * The Migrate trigger. Validates the hard-block gate server-side, pins the
 * baseline, builds the ordered dispatch set, creates the AMS run, dispatches
 * the FIRST spec, and RETURNS IMMEDIATELY (the run is NOT held in the request).
 *
 * @returns `started` (with the run id + item count), `blocked` (with the
 *          per-reason list), or `error`.
 */
export async function startMigration(
  scope: MigrateScope,
  deps: MigrationDriverDeps
): Promise<StartMigrationResult> {
  const { projectId, bookId } = scope;
  logger.info('[diag-gateway] migration_execution_driver start_requested', {
    projectId,
    bookId,
  });

  // 1. Load the inputs the gate + sequence builder need.
  const book = await deps.fetchBookOfWork(projectId, bookId);
  if (!book) {
    return { status: 'error', message: `Book of work ${bookId} not found` };
  }
  const specGens = await deps.fetchSpecGenerationsForBook(projectId, bookId);
  const workItems = await deps.fetchWorkItems(projectId);
  const deferredWorkItemIds = collectDeferredWorkItemIds(workItems);

  // Subset / batch migrate (2026-06-26). A non-empty selection scopes the run to
  // those work items; a non-empty batchName makes it a BATCH (all selected specs
  // submitted as ONE job -> one `feature/<batchName>` branch).
  const selectedSet = new Set((scope.selectedWorkItemIds ?? []).filter((id) => !!id));
  const isSubset = selectedSet.size > 0;
  const isBatch = !!(scope.batchName && scope.batchName.trim());

  // 2. Pin the active current-state baseline (the oracle). Its absence is a
  //    hard-block reason.
  const architectureId = book.current_architecture_id ?? null;
  const baseline = architectureId
    ? await deps.fetchActiveCurrentBaseline(projectId, architectureId)
    : null;

  // 3. Gather + compute the carry_over completeness coverage (D4). Non-API
  //    carry_over work (capabilities + un-grouped behaviour-bearing findings)
  //    has NO reconciliation backstop, so the gate refuses until each is cited
  //    or dismissed. Read off the book's project + architecture; the cited set
  //    is the work_item `source_capability_id` column joined to the capabilities.
  //    Fail-soft: a reads failure logs + yields an EMPTY (ok) coverage so a
  //    transient AMS hiccup never wrongly blocks Migrate (the spec-ready +
  //    baseline dimensions still gate).
  // The carry_over completeness gate is a WHOLE-BOOK concern (is every
  // behaviour-bearing item accounted for?). It does not apply to a subset
  // migrate, so it is skipped when a selection is active.
  let carryOverCoverage: CarryOverCoverageResult | undefined;
  if (architectureId && !isSubset) {
    try {
      const coverageInputs = await gatherCarryOverCoverageInputs({
        projectId,
        architectureId,
        book,
        workItems,
        deps: deps.carryOverCoverageReads ?? defaultCarryOverCoverageReadsDeps(),
      });
      carryOverCoverage = computeCarryOverCoverage(coverageInputs);
      logger.info('[diag-gateway] migration_execution_driver carry_over_coverage', {
        projectId,
        bookId,
        mustAccount: carryOverCoverage.totalMustAccount,
        unaccounted: carryOverCoverage.unaccounted.length,
      });
    } catch (error) {
      logger.warn('[diag-gateway] migration_execution_driver carry_over_coverage_failed', {
        projectId,
        bookId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      carryOverCoverage = undefined;
    }
  }

  // 4. Validate the hard-block gate (server-side; never trust the UI). The
  //    carry_over dimension STACKS with the spec-ready + baseline reasons.
  const items = book.book_of_work_json?.items ?? [];
  const gate = evaluateHardBlock({
    items,
    specGens,
    deferredWorkItemIds,
    selectedWorkItemIds: selectedSet,
    hasActiveCurrentBaseline: !!baseline,
    carryOverCoverage,
  });

  // 4b. DB-pack readiness gate (Spec 2026-07-02-e): when the dispatch scope
  //     contains DB-pack stories, Migrate additionally requires the pack to
  //     exist, be fresh + correctly target-bound, with zero open decisions and
  //     all translate-disposition translations approved. FAIL-CLOSED on
  //     unreadable pack state. Reasons STACK with the gate above so the user
  //     sees every blocker at once.
  let dbGateReasons: HardBlockResult['reasons'] = [];
  if (dbStoriesInScope({ items, deferredWorkItemIds, selectedWorkItemIds: selectedSet })) {
    const dbGate = await evaluateDbPackReadiness({
      projectId,
      currentArchitectureId: book.current_architecture_id ?? null,
      targetArchitectureId: book.target_architecture_id ?? null,
      reads: deps.dbPackGateReads,
    });
    dbGateReasons = dbGate.reasons;
    logger.info('[diag-gateway] migration_execution_driver db_pack_gate', {
      projectId,
      bookId,
      ok: dbGate.ok,
      reasons: dbGate.reasons.map((r) => r.code),
    });
  }

  const allBlockReasons = [...gate.reasons, ...dbGateReasons];
  if (allBlockReasons.length > 0) {
    logger.warn('[diag-gateway] migration_execution_driver start_blocked', {
      projectId,
      bookId,
      reasonCount: allBlockReasons.length,
      reasons: allBlockReasons.map((r) => r.code),
    });
    return { status: 'blocked', reasons: allBlockReasons };
  }

  // 4. Build the ordered dispatch set (excludes deferred, includes TEST).
  const dispatchSet = buildOrderedDispatchSet({
    book,
    specGens,
    deferredWorkItemIds,
    selectedWorkItemIds: selectedSet,
  });
  if (dispatchSet.length === 0) {
    return {
      status: 'error',
      message: isSubset
        ? 'No dispatchable specs in the selected work items'
        : 'No dispatchable specs in the book of work',
    };
  }

  // 5. Create the AMS run + ordered items atomically (deploy_on_complete only
  //    on the FINAL item).
  const runRequest = {
    run: {
      project_id: projectId,
      book_of_work_id: bookId,
      status: RUN_STATUS.STARTED,
      current_sequence_position: 0,
      pinned_current_baseline_id: baseline?.id ?? null,
    } as MigrationExecutionRun,
    items: dispatchSet.map((d) => ({
      sequence_position: d.sequencePosition,
      work_item_id: d.workItemId,
      spec_generation_id: d.specGenerationId,
      spec_name: null,
      status: RUN_ITEM_STATUS.PENDING,
      dispatched: false,
      deploy_on_complete: d.deployOnComplete,
    })) as MigrationExecutionRunItem[],
  };

  let run: MigrationExecutionRun;
  try {
    run = await deps.createMigrationExecutionRun(projectId, runRequest);
  } catch (error) {
    logger.error('[diag-gateway] migration_execution_driver create_run_failed', {
      projectId,
      bookId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return { status: 'error', message: 'Failed to create the migration execution run' };
  }

  const runId = run.id;
  if (!runId) {
    return { status: 'error', message: 'AMS create-run returned no run id' };
  }

  logger.info('[diag-gateway] migration_execution_driver run_created', {
    projectId,
    bookId,
    runId,
    itemCount: dispatchSet.length,
    pinnedBaselineId: baseline?.id ?? null,
  });

  trace.runHeader(runId, scope.project, architectureId);
  trace.step(`migrate run started — ${dispatchSet.length} specs`, {
    run: runId,
    project: scope.project,
    arch: architectureId,
  });

  // 6. Dispatch. BATCH mode auto-answers ALL selected specs then submits them as
  //    ONE job (one branch); the sequential mode kicks the FIRST spec and
  //    advances on each build-results callback. Both return immediately.
  if (isBatch) {
    kickBatchRunner(scope, run, run.items ?? [], dispatchSet, deps);
  } else {
    const firstItem = (run.items ?? []).find((i) => (i.sequence_position ?? -1) === 0);
    if (firstItem && firstItem.id) {
      kickSpecRunner(scope, run, firstItem, dispatchSet[0], deps);
    } else {
      logger.error('[diag-gateway] migration_execution_driver first_item_missing', {
        projectId,
        runId,
      });
    }
  }

  return { status: 'started', runId, itemCount: dispatchSet.length };
}

/**
 * Kick the detached, in-process per-spec runner (CD-2). The Migrate trigger and
 * each advance return immediately; the minutes-long shape-spec-answer -> submit
 * segment runs as a fire-and-forget async task. Per-item failure is isolated
 * inside {@link runSpecSegment}; the kick itself never throws.
 */
export function kickSpecRunner(
  scope: MigrateScope,
  run: MigrationExecutionRun,
  item: MigrationExecutionRunItem,
  descriptor: DispatchDescriptor,
  deps: MigrationDriverDeps
): void {
  // Detached: do not await. Failures are handled inside runSpecSegment.
  void runSpecSegment(scope, run, item, descriptor, deps).catch((error) => {
    logger.error('[diag-gateway] migration_execution_driver spec_runner_crashed', {
      projectId: scope.projectId,
      runId: run.id,
      runItemId: item.id,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  });
}

/**
 * The per-spec segment: drive the headless shape-spec stream via the
 * auto-answerer (Group 4), then submit the orchestration with the per-request
 * `callback_url` + `deploy_on_complete`, correlating the returned `job_id` to
 * the run-item. Per-item failure isolation: any failure halts THIS run cleanly
 * (records the error against the run-item + work item, marks the run halted)
 * and never throws to the caller.
 */
export async function runSpecSegment(
  scope: MigrateScope,
  run: MigrationExecutionRun,
  item: MigrationExecutionRunItem,
  descriptor: DispatchDescriptor,
  deps: MigrationDriverDeps
): Promise<void> {
  const { projectId } = scope;
  const runId = run.id as string;
  const runItemId = item.id as string;

  logger.info('[diag-gateway] migration_execution_driver spec_segment_start', {
    projectId,
    runId,
    runItemId,
    sequencePosition: item.sequence_position,
    deployOnComplete: item.deploy_on_complete ?? false,
  });

  // Mark the run dispatching + the item answering (the boot-recovery sweep
  // recognises answering/submitting-with-no-job_id as "stuck mid-segment").
  await safePatchRun(deps, projectId, runId, { status: RUN_STATUS.DISPATCHING });
  await safePatchItem(deps, projectId, runItemId, { status: RUN_ITEM_STATUS.ANSWERING });

  let answer: ShapeSpecAnswerResult;
  try {
    answer = await deps.autoAnswerer.driveAndAnswer({
      projectId,
      company: scope.company,
      project: scope.project,
      runItemId,
      generatedSpecText: descriptor.generatedSpecText,
    });
  } catch (error) {
    await haltRunForItem(deps, scope, runId, runItemId, item, RUN_ITEM_STATUS.FAILED,
      `Shape-spec auto-answer failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return;
  }

  if (!answer.ok || !answer.specName) {
    await haltRunForItem(deps, scope, runId, runItemId, item, RUN_ITEM_STATUS.FAILED,
      answer.error ??
        'Shape-spec stream concluded without a folder (spec_name); cannot submit orchestration.');
    // Persist whatever decision log we captured before halting (CD-4).
    if (answer.decisionLog && answer.decisionLog.length > 0) {
      await safePatchItem(deps, projectId, runItemId, {
        auto_answer_decision_log_json: answer.decisionLog,
      });
    }
    return;
  }

  // Persist the auto-answer decision log inline on the run-item (CD-4) + the
  // captured spec_name; move the item to submitting.
  await safePatchItem(deps, projectId, runItemId, {
    status: RUN_ITEM_STATUS.SUBMITTING,
    spec_name: answer.specName,
    auto_answer_decision_log_json: answer.decisionLog ?? null,
  });

  // Submit the orchestration server-to-server with callback_url + deploy_on_complete.
  let submit: OrchestrationSubmitResult;
  try {
    submit = await deps.submitOrchestration({
      company: scope.company,
      project: scope.project,
      specName: answer.specName,
      sessionId: answer.sessionId ?? null,
      deployOnComplete: item.deploy_on_complete ?? false,
      callbackUrl: deps.buildResultsCallbackUrl,
    });
  } catch (error) {
    await haltRunForItem(deps, scope, runId, runItemId, item, RUN_ITEM_STATUS.FAILED,
      `Orchestration submit failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return;
  }

  if (!submit.ok || !submit.jobId) {
    await haltRunForItem(deps, scope, runId, runItemId, item, RUN_ITEM_STATUS.FAILED,
      `Orchestration submit was not accepted: ${submit.error ?? 'no job_id returned'}`);
    return;
  }

  // Correlate the job_id to the run-item (PATCH dispatched=true + job_id +
  // status submitted). This is the build-results callback lookup key.
  await safePatchItem(deps, projectId, runItemId, {
    dispatched: true,
    job_id: submit.jobId,
    status: RUN_ITEM_STATUS.SUBMITTED,
  });

  logger.info('[diag-gateway] migration_execution_driver spec_submitted', {
    projectId,
    runId,
    runItemId,
    jobId: submit.jobId,
    specName: answer.specName,
    deployOnComplete: item.deploy_on_complete ?? false,
  });

  trace.step(`spec dispatched — ${answer.specName}`, {
    run: runId,
    job: submit.jobId,
    project: scope.project,
  });
}

// ============================================================================
// Batch dispatch (subset migrate -> ONE branch)
// ============================================================================

/**
 * Kick the detached batch runner: auto-answer ALL selected specs, then ONE
 * batched submit (one branch). Like {@link kickSpecRunner} it never throws.
 */
export function kickBatchRunner(
  scope: MigrateScope,
  run: MigrationExecutionRun,
  items: MigrationExecutionRunItem[],
  descriptors: DispatchDescriptor[],
  deps: MigrationDriverDeps
): void {
  void runBatchSegment(scope, run, items, descriptors, deps).catch((error) => {
    logger.error('[diag-gateway] migration_execution_driver batch_runner_crashed', {
      projectId: scope.projectId,
      runId: run.id,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  });
}

/**
 * The batch segment (subset migrate): auto-answer EVERY selected spec to
 * materialise its folder, then submit them all as ONE coupled batch
 * (`batch_name` -> one `feature/<batch_name>` branch, one MR). The single job_id
 * is correlated onto ALL run-items; the one build-results callback completes the
 * whole batch. A per-item answer failure halts the run cleanly (no partial
 * submit), preserving per-item failure isolation.
 */
export async function runBatchSegment(
  scope: MigrateScope,
  run: MigrationExecutionRun,
  items: MigrationExecutionRunItem[],
  descriptors: DispatchDescriptor[],
  deps: MigrationDriverDeps
): Promise<void> {
  const { projectId } = scope;
  const runId = run.id as string;
  const batchName = (scope.batchName ?? '').trim();

  await safePatchRun(deps, projectId, runId, { status: RUN_STATUS.DISPATCHING });

  const ordered = items
    .slice()
    .sort((a, b) => (a.sequence_position ?? 0) - (b.sequence_position ?? 0));

  // Phase 1: auto-answer EVERY spec first (collect spec_name + session_id).
  const resolved: Array<{
    item: MigrationExecutionRunItem;
    specName: string;
    sessionId: string | null;
  }> = [];
  for (const item of ordered) {
    const runItemId = item.id as string;
    const descriptor = descriptors.find((d) => d.sequencePosition === item.sequence_position);
    if (!descriptor) {
      await haltRunForItem(deps, scope, runId, runItemId, item, RUN_ITEM_STATUS.FAILED,
        'Could not resolve generated_spec_text for a batched spec.');
      return;
    }
    await safePatchItem(deps, projectId, runItemId, { status: RUN_ITEM_STATUS.ANSWERING });
    let answer: ShapeSpecAnswerResult;
    try {
      answer = await deps.autoAnswerer.driveAndAnswer({
        projectId,
        company: scope.company,
        project: scope.project,
        runItemId,
        generatedSpecText: descriptor.generatedSpecText,
      });
    } catch (error) {
      await haltRunForItem(deps, scope, runId, runItemId, item, RUN_ITEM_STATUS.FAILED,
        `Shape-spec auto-answer failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return;
    }
    if (!answer.ok || !answer.specName) {
      await haltRunForItem(deps, scope, runId, runItemId, item, RUN_ITEM_STATUS.FAILED,
        answer.error ?? 'Shape-spec stream concluded without a folder (spec_name).');
      if (answer.decisionLog && answer.decisionLog.length > 0) {
        await safePatchItem(deps, projectId, runItemId, {
          auto_answer_decision_log_json: answer.decisionLog,
        });
      }
      return;
    }
    await safePatchItem(deps, projectId, runItemId, {
      status: RUN_ITEM_STATUS.SUBMITTING,
      spec_name: answer.specName,
      auto_answer_decision_log_json: answer.decisionLog ?? null,
    });
    resolved.push({ item, specName: answer.specName, sessionId: answer.sessionId ?? null });
  }

  if (resolved.length === 0) {
    await safePatchRun(deps, projectId, runId, { status: RUN_STATUS.HALTED });
    return;
  }

  // Phase 2: ONE batched submit (one branch). deploy_on_complete=true -> the
  // subset deploys big-bang and a single `deployed` callback completes the run
  // (same deploy + reconcile semantics as a whole-book migrate).
  const submitBatch = deps.submitOrchestrationBatch ?? submitOrchestrationBatch;
  let submit: OrchestrationSubmitResult;
  try {
    submit = await submitBatch({
      company: scope.company,
      project: scope.project,
      specs: resolved.map((r) => ({ specName: r.specName, sessionId: r.sessionId })),
      batchName,
      deployOnComplete: true,
      callbackUrl: deps.buildResultsCallbackUrl,
    });
  } catch (error) {
    await haltBatch(deps, scope, runId, resolved.map((r) => r.item),
      `Batch orchestration submit failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return;
  }

  if (!submit.ok || !submit.jobId) {
    await haltBatch(deps, scope, runId, resolved.map((r) => r.item),
      `Batch orchestration submit was not accepted: ${submit.error ?? 'no job_id returned'}`);
    return;
  }

  // Correlate the SINGLE job_id onto ALL items (the batch callback key).
  for (const r of resolved) {
    await safePatchItem(deps, projectId, r.item.id as string, {
      dispatched: true,
      job_id: submit.jobId,
      status: RUN_ITEM_STATUS.SUBMITTED,
    });
  }

  logger.info('[diag-gateway] migration_execution_driver batch_submitted', {
    projectId,
    runId,
    jobId: submit.jobId,
    specCount: resolved.length,
    batchName,
  });
  trace.step(`batch dispatched — ${resolved.length} specs on feature/${batchName}`, {
    run: runId,
    job: submit.jobId,
    project: scope.project,
  });
}

/** Halt a batch run: mark the run halted + every supplied item FAILED. */
async function haltBatch(
  deps: MigrationDriverDeps,
  scope: MigrateScope,
  runId: string,
  items: MigrationExecutionRunItem[],
  message: string
): Promise<void> {
  for (const item of items) {
    if (!item.id) continue;
    await safePatchItem(deps, scope.projectId, item.id, {
      status: RUN_ITEM_STATUS.FAILED,
      outcome: 'failed',
      error_detail: message,
    });
  }
  await safePatchRun(deps, scope.projectId, runId, { status: RUN_STATUS.HALTED });
  logger.warn('[diag-gateway] migration_execution_driver batch_halted', {
    projectId: scope.projectId,
    runId,
    itemCount: items.length,
    message,
  });
}

// ============================================================================
// Event-driven advance (consumed by the Group 3 build-results door)
// ============================================================================

/** The advance decision the build-results door reports back. */
export type AdvanceDecision =
  | 'advanced_next_dispatched'
  | 'advanced_run_complete'
  | 'deployed_recorded'
  | 'halted'
  | 'noop_idempotent'
  | 'run_item_not_found';

/**
 * Inbound callback payload the door hands to the advance. The advance correlates
 * on the globally-unique `jobId` and recovers the authoritative project id from
 * the matched run-item's run -- so the door passes company/project for
 * traceability only and does NOT need the AMS project UUID.
 */
/**
 * The shared build-results outcome enum, reconciled with the external
 * implement-verify-service (`src/verification/outcomes.py`). That service
 * deliberately split the old `failed` into three materially-different states:
 *   - `error`        -- nothing built (infra/build error);
 *   - `fix_unserved` -- a bug fix was kept (tests green) but the redeploy failed
 *                       -- the fix EXISTS and needs human review (bug path only);
 *   - `not_fixed`    -- no fix kept -- human review / re-file (bug path only).
 * `failed` is retained for backward-compatibility. Control flow folds every
 * non-`implemented`/non-`deployed` value into the existing halt/escalate path,
 * but the RAW value is preserved on the run-item / break record for traceability.
 */
export type BuildResultOutcome =
  | 'implemented'
  | 'deployed'
  | 'failed'
  | 'error'
  | 'rejected'
  | 'fix_unserved'
  | 'not_fixed';

/** Bug-path subset (a bug callback never reports `implemented`). */
export type BugResultOutcome = Exclude<BuildResultOutcome, 'implemented'>;

export interface BuildResultAdvanceInput {
  company: string;
  project: string;
  jobId: string;
  outcome: BuildResultOutcome;
  prUrl?: string | null;
  targetBaseUrl?: string | null;
  summary?: string | null;
}

/**
 * Advance the run on a build-results callback (Group 3). Looks up the run-item
 * by `job_id` (correlation key), recovers the authoritative project id from the
 * run, and:
 *   - `implemented` -> record `pr_url`, advance the run position, dispatch the
 *     NEXT spec (or, if it was the final spec, the run is fully implemented);
 *   - `deployed` (final spec) -> mark the run deployed + record
 *     `target_base_url` (leaving a CLEAN reconciliation hand-off seam for Spec 4);
 *   - any other terminal outcome (`failed` / `error` / `rejected` / `fix_unserved`
 *     / `not_fixed`) -> halt the run + record the error against the run-item + work
 *     item (per-item failure isolation; surface, don't abort). `rejected` maps to
 *     the REJECTED run-item status; every other halting outcome maps to FAILED,
 *     with the raw outcome preserved on the record.
 *
 * IDEMPOTENT (CD-6): a duplicate callback for an already-terminal run-item is a
 * no-op. Returns the decision so the door can log it.
 */
export async function advanceRunOnBuildResult(
  input: BuildResultAdvanceInput,
  deps: MigrationDriverDeps
): Promise<AdvanceDecision> {
  const { jobId, outcome } = input;

  // Correlate purely on the globally-unique job_id (the AMS by-job-id match
  // ignores the path project; the run carries the real project).
  const item = await deps.findMigrationRunItemByJobId(JOB_PROBE_PROJECT_SEGMENT, jobId);
  if (!item || !item.id || !item.run_id) {
    logger.warn('[diag-gateway] migration_execution_driver advance_unknown_job', { jobId });
    return 'run_item_not_found';
  }

  // Recover the authoritative project id from the run-item's run.
  const run = await deps.getMigrationExecutionRun(JOB_PROBE_PROJECT_SEGMENT, item.run_id);
  if (!run || !run.project_id) {
    logger.warn('[diag-gateway] migration_execution_driver advance_run_unresolved', {
      jobId,
      runId: item.run_id,
    });
    return 'run_item_not_found';
  }
  const projectId = run.project_id;
  const runId = item.run_id;
  const runItemId = item.id;
  const scope: MigrateScope = {
    projectId,
    bookId: run.book_of_work_id ?? '',
    company: input.company,
    project: input.project,
  };

  // Idempotency (CD-6): a run-item that already carries a terminal outcome is
  // not advanced again.
  if (item.outcome && (TERMINAL_OUTCOMES as readonly string[]).includes(item.outcome)) {
    logger.info('[diag-gateway] migration_execution_driver advance_noop_idempotent', {
      projectId,
      jobId,
      runItemId,
      existingOutcome: item.outcome,
      callbackOutcome: outcome,
    });
    return 'noop_idempotent';
  }

  // Batch (subset migrate): N run-items share ONE job_id -> one branch. The
  // single callback completes the WHOLE batch. Sequential runs always have a
  // UNIQUE job_id per item, so this branch never affects them.
  const batchSiblings = (run.items ?? []).filter(
    (i) =>
      i.id &&
      i.job_id === jobId &&
      !(i.outcome && (TERMINAL_OUTCOMES as readonly string[]).includes(i.outcome))
  );
  if (batchSiblings.length > 1) {
    return await advanceBatchOnBuildResult(input, scope, run, batchSiblings, deps);
  }

  // Any terminal outcome that is not implemented/deployed halts the run. The
  // external service reports `error` (build error) on the job path and may report
  // `fix_unserved` / `not_fixed` on the bug path; all fold here. Only `rejected`
  // takes the REJECTED status -- everything else is FAILED. The raw outcome is
  // preserved on the run-item record for traceability.
  if (outcome !== 'implemented' && outcome !== 'deployed') {
    trace.fail(`build-results: ${outcome}`, {
      run: runId,
      job: jobId,
      project: scope.project,
    });
    await haltRunForItem(
      deps,
      scope,
      runId,
      runItemId,
      item,
      outcome === 'rejected' ? RUN_ITEM_STATUS.REJECTED : RUN_ITEM_STATUS.FAILED,
      input.summary ?? `Build-results reported ${outcome}`,
      outcome
    );
    return 'halted';
  }

  if (outcome === 'deployed') {
    // Final spec deployed -> record target_base_url on the item + run, mark the
    // run deployed. The reconciliation hand-off is Spec 4 (clean seam below).
    await safePatchItem(deps, projectId, runItemId, {
      status: RUN_ITEM_STATUS.DEPLOYED,
      outcome: 'deployed',
      target_base_url: input.targetBaseUrl ?? null,
      pr_url: input.prUrl ?? null,
    });
    await safePatchRun(deps, projectId, runId, {
      status: RUN_STATUS.DEPLOYED,
      target_base_url: input.targetBaseUrl ?? null,
    });
    logger.info('[diag-gateway] migration_execution_driver run_deployed', {
      projectId,
      runId,
      runItemId,
      targetBaseUrl: input.targetBaseUrl ?? null,
    });
    trace.ok(`run deployed — ${input.targetBaseUrl ?? '(no target_base_url)'}`, {
      run: runId,
      job: jobId,
      project: scope.project,
    });
    // === Spec 4 reconciliation hand-off (Group 2) ===
    // The run is deployed against the pinned current-state baseline. Hand off
    // to the Reconciler to replay the FULL pinned baseline against
    // target_base_url and raise breaks (CD-B: NO deferred-exclusion). The
    // reconcile is long-running, so it is fired fire-and-forget; the door
    // must 202 promptly. Re-read the run (so the trigger sees target_base_url +
    // the pinned baseline) and kick the trigger detached.
    kickFullReconcile(scope, runId, deps);
    return 'deployed_recorded';
  }

  // outcome === 'implemented'
  await safePatchItem(deps, projectId, runItemId, {
    status: RUN_ITEM_STATUS.IMPLEMENTED,
    outcome: 'implemented',
    pr_url: input.prUrl ?? null,
  });
  logger.info('[diag-gateway] migration_execution_driver spec_implemented', {
    projectId,
    runId,
    runItemId,
    prUrl: input.prUrl ?? null,
  });
  trace.ok('spec implemented', {
    run: runId,
    job: jobId,
    project: scope.project,
  });

  // Advance the run position + dispatch the next pending spec. If this was the
  // final spec, the run is fully implemented; the submit that carried
  // deploy_on_complete handles the deploy (a `deployed` callback will follow).
  return await dispatchNext(scope, run, item, deps);
}

/**
 * Complete a BATCH run on its single build-results callback. All N run-items
 * share one job_id (one branch), so the one callback completes the whole batch:
 *   - a halting outcome -> halt the run + mark EVERY sibling FAILED/REJECTED;
 *   - `deployed` -> mark every sibling DEPLOYED, mark the run deployed + kick the
 *     full-baseline reconcile (same hand-off as a whole-book migrate);
 *   - `implemented` (defensive; the batch submits deploy_on_complete=true) ->
 *     mark every sibling IMPLEMENTED (run fully implemented).
 * Idempotent: once the siblings are terminal, a duplicate callback no-ops at the
 * matched-item idempotency guard upstream.
 */
async function advanceBatchOnBuildResult(
  input: BuildResultAdvanceInput,
  scope: MigrateScope,
  run: MigrationExecutionRun,
  siblings: MigrationExecutionRunItem[],
  deps: MigrationDriverDeps
): Promise<AdvanceDecision> {
  const projectId = scope.projectId;
  const runId = run.id as string;
  const { outcome, jobId } = input;

  if (outcome !== 'implemented' && outcome !== 'deployed') {
    trace.fail(`batch build-results: ${outcome}`, {
      run: runId,
      job: jobId,
      project: scope.project,
    });
    const status =
      outcome === 'rejected' ? RUN_ITEM_STATUS.REJECTED : RUN_ITEM_STATUS.FAILED;
    for (const s of siblings) {
      if (!s.id) continue;
      await safePatchItem(deps, projectId, s.id, {
        status,
        outcome,
        error_detail: input.summary ?? `Build-results reported ${outcome}`,
      });
    }
    await safePatchRun(deps, projectId, runId, { status: RUN_STATUS.HALTED });
    logger.warn('[diag-gateway] migration_execution_driver batch_halted_on_callback', {
      projectId,
      runId,
      jobId,
      outcome,
      itemCount: siblings.length,
    });
    return 'halted';
  }

  if (outcome === 'deployed') {
    for (const s of siblings) {
      if (!s.id) continue;
      await safePatchItem(deps, projectId, s.id, {
        status: RUN_ITEM_STATUS.DEPLOYED,
        outcome: 'deployed',
        target_base_url: input.targetBaseUrl ?? null,
        pr_url: input.prUrl ?? null,
      });
    }
    await safePatchRun(deps, projectId, runId, {
      status: RUN_STATUS.DEPLOYED,
      target_base_url: input.targetBaseUrl ?? null,
    });
    logger.info('[diag-gateway] migration_execution_driver batch_deployed', {
      projectId,
      runId,
      jobId,
      itemCount: siblings.length,
      targetBaseUrl: input.targetBaseUrl ?? null,
    });
    trace.ok(`batch deployed — ${siblings.length} specs`, {
      run: runId,
      job: jobId,
      project: scope.project,
    });
    kickFullReconcile(scope, runId, deps);
    return 'deployed_recorded';
  }

  // outcome === 'implemented' (defensive; the batch submits deploy_on_complete=true)
  for (const s of siblings) {
    if (!s.id) continue;
    await safePatchItem(deps, projectId, s.id, {
      status: RUN_ITEM_STATUS.IMPLEMENTED,
      outcome: 'implemented',
      pr_url: input.prUrl ?? null,
    });
  }
  logger.info('[diag-gateway] migration_execution_driver batch_implemented', {
    projectId,
    runId,
    jobId,
    itemCount: siblings.length,
  });
  return 'advanced_run_complete';
}

/**
 * Kick the Group-2 full-baseline reconcile trigger DETACHED (fire-and-forget).
 * The reconcile replays the whole pinned baseline against the deployed target
 * and can take minutes; the build-results door must 202 promptly. We re-read
 * the run (so the trigger sees the freshly-recorded target_base_url + the
 * pinned baseline) and run the trigger off-request. Failures are isolated
 * inside {@link triggerFullBaselineReconcile} (it never throws) and logged.
 */
export function kickFullReconcile(
  scope: MigrateScope,
  runId: string,
  deps: MigrationDriverDeps
): void {
  const reconciliationDeps = deps.reconciliationDeps ?? defaultReconciliationDriverDeps();
  const trigger = deps.triggerReconcile ?? triggerFullBaselineReconcile;
  void (async () => {
    const run = await deps.getMigrationExecutionRun(JOB_PROBE_PROJECT_SEGMENT, runId);
    if (!run) {
      logger.warn('[diag-gateway] migration_reconciliation reconcile_run_unresolved', { runId });
      return;
    }
    await trigger(run, reconciliationDeps);
  })().catch((error) => {
    logger.error('[diag-gateway] migration_reconciliation reconcile_kick_crashed', {
      projectId: scope.projectId,
      runId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  });
}

/**
 * Advance on a `bug_id` build-results callback (Group 4 -- the bug_id dispatch
 * the door delegates here). Resolves the run-scope for the bug's breaks
 * (project + pinned baseline + target_base_url), then:
 *   - `deployed` -> SCOPED re-reconcile + circuit breaker (run DETACHED -- the
 *     replay is long; the door 202s immediately);
 *   - any non-`deployed` outcome (`failed`/`rejected`/`error`/`fix_unserved`/
 *     `not_fixed`) -> terminal escalation to human review (run INLINE -- no
 *     replay). The raw outcome is preserved so `fix_unserved` (a kept-but-unserved
 *     fix the human must rescue) stays distinguishable from `not_fixed`.
 *
 * Returns the kind of dispatch so the door can log it. Never throws.
 */
export interface BugResultAdvanceInput {
  company: string;
  project: string;
  bugId: string;
  outcome: BugResultOutcome;
  targetBaseUrl?: string | null;
  summary?: string | null;
}

export type BugAdvanceDispatch =
  | 'bug_rereconcile_dispatched'
  | 'bug_escalated'
  | 'bug_unresolved';

export async function advanceRunOnBugResult(
  input: BugResultAdvanceInput,
  deps: MigrationDriverDeps
): Promise<BugAdvanceDispatch> {
  const reconciliationDeps = deps.reconciliationDeps ?? defaultReconciliationDriverDeps();
  const handler = deps.handleBugCallback ?? handleBugCallback;

  // Resolve the run-scope behind this bug's breaks (project + pinned baseline +
  // run id). The breaks carry run_id + pinned_baseline_id; read one to recover
  // the scope without needing the AMS project UUID from the callback.
  let projectId = '';
  let runId: string | null = null;
  let pinnedBaselineId: string | null = null;
  try {
    const scope = await reconciliationDeps.getReconciliationBreaksByBugId(
      JOB_PROBE_PROJECT_SEGMENT,
      input.bugId
    );
    const first = scope.find((b) => b.run_id);
    if (!first || !first.run_id) {
      logger.warn('[diag-gateway] migration_reconciliation bug_scope_unresolved', {
        bugId: input.bugId,
      });
      return 'bug_unresolved';
    }
    runId = first.run_id;
    pinnedBaselineId = first.pinned_baseline_id ?? null;
    // Recover the authoritative project id from the run.
    const run = await deps.getMigrationExecutionRun(JOB_PROBE_PROJECT_SEGMENT, runId);
    if (run?.project_id) {
      projectId = run.project_id;
      pinnedBaselineId = pinnedBaselineId ?? run.pinned_current_baseline_id ?? null;
    }
  } catch (error) {
    logger.error('[diag-gateway] migration_reconciliation bug_scope_read_failed', {
      bugId: input.bugId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return 'bug_unresolved';
  }

  if (!projectId) {
    logger.warn('[diag-gateway] migration_reconciliation bug_project_unresolved', {
      bugId: input.bugId,
      runId,
    });
    return 'bug_unresolved';
  }

  const callArgs = {
    projectId,
    runId,
    bugId: input.bugId,
    outcome: input.outcome,
    targetBaseUrl: input.targetBaseUrl ?? null,
    pinnedBaselineId,
    summary: input.summary ?? null,
  };

  if (input.outcome !== 'deployed') {
    // No replay -- escalate inline (fast). Covers failed/rejected plus the
    // external service's richer terminal outcomes (error/fix_unserved/not_fixed).
    const result: BugCallbackResult = await handler(callArgs, reconciliationDeps);
    logger.info('[diag-gateway] migration_reconciliation bug_callback_inline', {
      projectId,
      bugId: input.bugId,
      outcome: input.outcome,
      result: result.status,
    });
    return 'bug_escalated';
  }

  // deployed -> scoped re-reconcile DETACHED (the replay is long).
  void handler(callArgs, reconciliationDeps).catch((error) => {
    logger.error('[diag-gateway] migration_reconciliation bug_rereconcile_crashed', {
      projectId,
      bugId: input.bugId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  });
  return 'bug_rereconcile_dispatched';
}

/**
 * Advance the run to the next pending run-item and dispatch it. If there is no
 * next pending item, the run is fully implemented (the final spec's deploy is
 * handled by the external service via deploy_on_complete). Returns the decision.
 */
async function dispatchNext(
  scope: MigrateScope,
  run: MigrationExecutionRun,
  completedItem: MigrationExecutionRunItem,
  deps: MigrationDriverDeps
): Promise<AdvanceDecision> {
  const runId = run.id as string;
  const items = (run.items ?? []).slice().sort(
    (a, b) => (a.sequence_position ?? 0) - (b.sequence_position ?? 0)
  );
  const completedPos = completedItem.sequence_position ?? -1;
  const next = items.find(
    (i) => (i.sequence_position ?? -1) > completedPos && i.status === RUN_ITEM_STATUS.PENDING
  );

  if (!next || !next.id) {
    // No next pending spec -> the run is fully implemented. The final spec's
    // deploy_on_complete drives the deploy; a `deployed` callback will arrive.
    logger.info('[diag-gateway] migration_execution_driver all_specs_implemented', {
      projectId: scope.projectId,
      runId,
    });
    return 'advanced_run_complete';
  }

  // Advance the run's current position to the next item.
  await safePatchRun(deps, scope.projectId, runId, {
    current_sequence_position: next.sequence_position ?? null,
    status: RUN_STATUS.DISPATCHING,
  });

  // Resolve the next item's spec text + deploy flag (re-read from AMS reads so
  // the runner has the body to feed the stream).
  const descriptor = await resolveDescriptorForItem(scope, run, next, deps);
  if (!descriptor) {
    await haltRunForItem(deps, scope, runId, next.id, next, RUN_ITEM_STATUS.FAILED,
      'Could not resolve generated_spec_text for the next spec.');
    return 'halted';
  }

  kickSpecRunner(scope, run, next, descriptor, deps);
  logger.info('[diag-gateway] migration_execution_driver next_dispatched', {
    projectId: scope.projectId,
    runId,
    nextRunItemId: next.id,
    nextSequencePosition: next.sequence_position,
  });
  return 'advanced_next_dispatched';
}

/**
 * Re-resolve a run-item's dispatch descriptor (the `generated_spec_text` to
 * feed the stream + the deploy flag) from the book + spec generations. Used by
 * the advance (dispatch-next) and the boot-recovery sweep.
 */
async function resolveDescriptorForItem(
  scope: MigrateScope,
  run: MigrationExecutionRun,
  item: MigrationExecutionRunItem,
  deps: MigrationDriverDeps
): Promise<DispatchDescriptor | null> {
  const bookId = run.book_of_work_id ?? scope.bookId;
  if (!bookId) return null;
  const specGens = await deps.fetchSpecGenerationsForBook(scope.projectId, bookId);

  let text: string | null = null;
  // Prefer the exact spec-generation row the item was created from.
  if (item.spec_generation_id) {
    const row = specGens.find((g) => g.id === item.spec_generation_id);
    if (row && (row.generated_spec_text ?? '').trim() !== '') {
      text = row.generated_spec_text ?? null;
    }
  }
  // Fall back to the latest row for the work item.
  if (!text && item.work_item_id) {
    const row = latestSpecGenerationForWorkItem(item.work_item_id, specGens);
    if (row && (row.generated_spec_text ?? '').trim() !== '') {
      text = row.generated_spec_text ?? null;
    }
  }
  if (!text) return null;

  return {
    sequencePosition: item.sequence_position ?? 0,
    workItemId: item.work_item_id ?? null,
    specGenerationId: item.spec_generation_id ?? null,
    bookItemId: null,
    generatedSpecText: text,
    title: '',
    deployOnComplete: item.deploy_on_complete ?? false,
  };
}

// ============================================================================
// Boot-recovery sweep (CD-2)
// ============================================================================

/**
 * Reconcile in-flight run-state against reality on gateway startup (CD-2). For
 * each non-terminal run, re-kick any run-item found stuck mid-segment (status
 * answering/submitting with no `job_id` yet) so a long migration auto-resumes
 * across gateway restarts. Per-run failure isolation: one run's recovery
 * failure never blocks the others.
 *
 * @param runs the in-flight runs to reconcile (resolved by the caller; the
 *        gateway has no project enumeration, so the boot wiring passes the set
 *        it can discover -- e.g. from a lightweight AMS scan or config).
 */
export async function recoverInFlightRuns(
  runs: Array<{ projectId: string; runId: string; company: string; project: string; bookId: string }>,
  deps: MigrationDriverDeps
): Promise<{ recovered: number; rekicked: number }> {
  let recovered = 0;
  let rekicked = 0;

  for (const ref of runs) {
    try {
      const run = await deps.getMigrationExecutionRun(ref.projectId, ref.runId);
      if (!run) continue;
      // Skip terminal runs.
      if (run.status === RUN_STATUS.DEPLOYED || run.status === RUN_STATUS.FAILED) {
        continue;
      }
      recovered++;

      const scope: MigrateScope = {
        projectId: ref.projectId,
        bookId: ref.bookId || (run.book_of_work_id ?? ''),
        company: ref.company,
        project: ref.project,
      };

      const items = (run.items ?? []).slice().sort(
        (a, b) => (a.sequence_position ?? 0) - (b.sequence_position ?? 0)
      );
      for (const item of items) {
        const stuck =
          (item.status === RUN_ITEM_STATUS.ANSWERING ||
            item.status === RUN_ITEM_STATUS.SUBMITTING) &&
          !item.job_id &&
          !item.outcome;
        if (!stuck || !item.id) continue;

        const descriptor = await resolveDescriptorForItem(scope, run, item, deps);
        if (!descriptor) {
          logger.warn('[diag-gateway] migration_execution_driver recovery_no_spec_text', {
            projectId: ref.projectId,
            runId: ref.runId,
            runItemId: item.id,
          });
          continue;
        }
        logger.info('[diag-gateway] migration_execution_driver recovery_rekick', {
          projectId: ref.projectId,
          runId: ref.runId,
          runItemId: item.id,
          sequencePosition: item.sequence_position,
        });
        kickSpecRunner(scope, run, item, descriptor, deps);
        rekicked++;
      }
    } catch (error) {
      logger.error('[diag-gateway] migration_execution_driver recovery_failed', {
        projectId: ref.projectId,
        runId: ref.runId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  logger.info('[diag-gateway] migration_execution_driver recovery_sweep_complete', {
    runsConsidered: runs.length,
    recovered,
    rekicked,
  });
  return { recovered, rekicked };
}

// ============================================================================
// Internal helpers (failure isolation + safe patches)
// ============================================================================

function collectDeferredWorkItemIds(workItems: WorkItem[]): Set<string> {
  const out = new Set<string>();
  for (const wi of workItems) {
    if (wi.deferred === true && wi.id) out.add(wi.id);
  }
  return out;
}

/**
 * Halt THIS run for a failed item (per-item failure isolation): record the
 * error on the run-item + the work item, mark the run halted. Never throws.
 */
async function haltRunForItem(
  deps: MigrationDriverDeps,
  scope: MigrateScope,
  runId: string,
  runItemId: string,
  item: MigrationExecutionRunItem,
  itemStatus: string,
  errorDetail: string,
  // The raw terminal outcome (`failed` | `error` | `rejected` | `fix_unserved`
  // | `not_fixed`); recorded verbatim on the run-item for traceability.
  outcome: string = 'failed'
): Promise<void> {
  logger.warn('[diag-gateway] migration_execution_driver halt_run', {
    projectId: scope.projectId,
    runId,
    runItemId,
    itemStatus,
    outcome,
    errorDetail,
  });
  await safePatchItem(deps, scope.projectId, runItemId, {
    status: itemStatus,
    outcome,
    error_detail: errorDetail,
  });
  await safePatchRun(deps, scope.projectId, runId, { status: RUN_STATUS.HALTED });
  // Surface against the work item (human traceability). Best-effort; never throws.
  if (item.work_item_id) {
    try {
      await deps.recordWorkItemImplementationError(scope.projectId, item.work_item_id, errorDetail);
    } catch (error) {
      logger.warn('[diag-gateway] migration_execution_driver work_item_error_sink_failed', {
        projectId: scope.projectId,
        workItemId: item.work_item_id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
}

async function safePatchItem(
  deps: MigrationDriverDeps,
  projectId: string,
  runItemId: string,
  patch: MigrationExecutionRunItem
): Promise<void> {
  try {
    await deps.patchMigrationExecutionRunItem(projectId, runItemId, patch);
  } catch (error) {
    logger.error('[diag-gateway] migration_execution_driver patch_item_failed', {
      projectId,
      runItemId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

async function safePatchRun(
  deps: MigrationDriverDeps,
  projectId: string,
  runId: string,
  patch: MigrationExecutionRun
): Promise<void> {
  try {
    await deps.patchMigrationExecutionRun(projectId, runId, patch);
  } catch (error) {
    logger.error('[diag-gateway] migration_execution_driver patch_run_failed', {
      projectId,
      runId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
