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
import { normalizeScopeIdentifiers } from './workspaceIdentifier';
import { createTracer } from '../trace';

// Haikai workflow trace (OFF unless HAIKAI_TRACE set). SUMMARY across the
// migrate orchestration: run started / spec dispatched / build-results /
// run deployed, keyed on project+run(+job). See docs/trace-logging.md.
const trace = createTracer('gateway');
import {
  createMigrationExecutionRun,
  getMigrationExecutionRun,
  getLatestMigrationExecutionRunForBook,
  getMigrationExecutionRunsForBook,
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
  salvageSpecWorktree,
  deployExistingRun,
  OrchestrationSubmitResult,
} from './migrationOrchestrationSubmit';
import { recordWorkItemImplementationError } from './migrationWorkItemErrorSink';
import { isManualExecutionItem } from './migrationExecutionClass';
import {
  ShapeSpecAutoAnswerer,
} from './shapeSpecAutoAnswererSeam';
import { buildDefaultShapeSpecAutoAnswerer } from './shapeSpecAutoAnswerer';
import { stripShapeSpecPrefix } from './shapeSpecHeadlessStream';
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
import {
  CodeGateReads,
  codeStoriesInScope,
  evaluateCodeReadiness,
} from './migrationCodeExecutionGate';
import {
  DataParityGateReads,
  evaluateDataParityReadiness,
} from './migrationDataParityGate';
import { createDataParityReconcileTrigger } from './migrationDataParityReconcile';
import { createDataMigrationTrigger } from './migrationDataRunnerDispatch';
import {
  createDbPlaneCompletionRunner,
  defaultGetJobStatus,
} from './migrationDbPlaneCompletion';
import {
  migrationTargetCredentialsStore,
  type TargetServeSpec,
} from './migrationTargetCredentialsStore';
import {
  shouldAutoRetry,
  maxRetryAttempts,
  backoffMsBeforeAttempt,
  FAILURE_CLASS_TRANSIENT,
} from './migrationSpecRetryPolicy';
// SCL execution integration (spec 10, 2026-08-18): first-commit delivery of
// the generated behaviour suite at dispatch + the shipped-suite integrity /
// quarantine-threshold verdict at build-results. Every seam is FAIL-SOFT for
// non-SCL stories (zero behaviour change).
import { sclCarriageMarkersFromBlob } from './sclSpecCarriage';
import {
  SclInitialCommit,
  buildSclInitialCommit,
  evaluateSclSuiteIntegrity,
  isSclDispatchStory,
  SCL_SUITE_GENERATION_FAILED_LOG_TYPE,
} from './migrationSclExecution';

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
  /**
   * TRUE on the LAST item of a plane (Spec W phased deploy). Big-bang callers
   * (buildOrderedDispatchSet) still set it on the final item only.
   */
  deployOnComplete: boolean;
  /** The item's plane workstream (Spec W plane derivation). */
  workstream?: string | null;
  /** Blob-item tags (2026-08-15 — the service-plane foundations-first rank). */
  tags?: string[];
  /** True when the blob item lists committed endpoint ids (an implementation
   * story); false for foundations/scaffold (2026-08-15 ordering rank). */
  hasEndpointIds?: boolean;
  /** The migration plane this item belongs to (Spec W). */
  plane?: MigrationPlane;
  /**
   * SCL corpus markers (spec 10, 2026-08-18): flattened off the book blob item
   * (spec 7 stamps them) so an SCL story's dispatch can resolve its contracts
   * and generate the first-commit behaviour suite. Null/absent on every
   * non-SCL item.
   */
  sclContractKeys?: string[] | null;
  sclLayer?: string | null;
  sclControllerClass?: string | null;
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
  /**
   * Per-plane start (2026-07-26, user ruling: "Start stage 1 should start the
   * DB plane only"). When set, the run is scoped to THIS plane's non-deferred
   * stories (resolved onto the existing subset machinery, so the spec gate,
   * the conditional db-pack/code gates and the dispatch set are all
   * plane-scoped), gate dimensions apply per plane (baseline + carry-over
   * only when the service plane is in scope), and a plane-precedence gate
   * requires the preceding plane's run to be DEPLOYED — with the DB data-
   * parity gate enforced at the service-plane START (the per-plane analogue
   * of the resume-time gate). Ignored when `selectedWorkItemIds` is supplied.
   */
  plane?: MigrationPlane | null;
  /**
   * Break-glass for the plane-precedence data-parity gate: start the service
   * plane despite unclean DB parity. The override (with the divergent tables
   * at this moment) is recorded on the NEW run's decision log for data-echo
   * attribution — mirrors the resume-time break-glass.
   */
  parityOverride?: boolean;
  /**
   * Run-branch chaining (2026-08-06): where this run's FIRST dispatch bases
   * its worktree branch. 'chain' (default) = continue from the latest prior
   * run's last GOOD spec branch — a "Start Stage 2" sees Stage 1's unmerged
   * work; 'fresh' = start from the default branch (operator ticked "start
   * from main — the previous stage's changes are already merged" at the
   * Start-stage dialog). Within a run, later specs always chain off the
   * previous successful item regardless of this mode.
   */
  baseMode?: 'chain' | 'fresh' | 'mr' | 'integration' | null;
}

/** The injectable dependency surface (the DI seam for tests). */
export interface MigrationDriverDeps {
  fetchBookOfWork: typeof fetchBookOfWork;
  fetchSpecGenerationsForBook: typeof fetchSpecGenerationsForBook;
  fetchWorkItems: typeof fetchWorkItems;
  fetchActiveCurrentBaseline: typeof fetchActiveCurrentBaseline;
  /**
   * Latest run for the book — the plane-precedence gate's read (2026-07-26).
   * Optional + lazily defaulted so pre-existing deps mocks keep compiling;
   * only consulted for per-plane starts of a NON-first plane.
   */
  fetchLatestMigrationExecutionRunForBook?: typeof getLatestMigrationExecutionRunForBook;
  /**
   * ALL runs of a book with items, newest first (2026-08-07): the plane-aware
   * precedence source. Optional + lazily defaulted so pre-existing deps mocks
   * keep compiling; only consulted for per-plane starts of a NON-first plane.
   */
  fetchMigrationExecutionRunsForBook?: typeof getMigrationExecutionRunsForBook;
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
  /** Resume-with-salvage (2026-08-15): the IVS worktree salvage client. */
  salvageSpecWorktree?: typeof salvageSpecWorktree;
  /**
   * Deploy-only replay (2026-09-06): ask IVS to re-run JUST the deploy +
   * build-results tail of a job whose specs are already built and merged.
   * Optional + lazily defaulted so pre-existing deps mocks keep compiling.
   */
  deployExistingRun?: typeof deployExistingRun;
  /**
   * IVS job-status read (2026-08-15): the boot sweep's callback-lost
   * reconcile — the C5 "durable + pollable" promise finally consumed. A run
   * whose item was SUBMITTED with a job_id but whose terminal callback never
   * arrived (every delivery attempt failed) would otherwise wedge at
   * 'dispatching' forever. Optional + lazily defaulted so pre-existing deps
   * mocks keep compiling.
   */
  getJobStatus?: typeof defaultGetJobStatus;
  /**
   * DB-pack readiness gate reads (Spec 2026-07-02-e). Optional + defaulted
   * inside {@link evaluateDbPackReadiness} so pre-existing deps mocks keep
   * compiling; injected in tests.
   */
  dbPackGateReads?: DbPackGateReads;
  /**
   * Code-tier readiness gate reads (Spec 2026-07-06-i). Optional + defaulted
   * inside {@link evaluateCodeReadiness} so pre-existing deps mocks keep
   * compiling; injected in tests.
   */
  codeGateReads?: CodeGateReads;
  /**
   * Data-parity gate reads (Data-Tier Oracle Spec P part 2). Optional +
   * defaulted inside {@link evaluateDataParityReadiness} so pre-existing
   * deps mocks keep compiling; injected in tests.
   */
  dataParityGateReads?: DataParityGateReads;
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
   * DB-plane reconcile trigger (Spec W): runs the data-parity comparator
   * (Spec P) against the pinned source + freshly-loaded target when the DB
   * plane deploys. Lazily defaulted; tests inject a mock. The live AMVS
   * data-parity invocation is a work-machine shakedown seam.
   */
  triggerDataParityReconcile?: (
    scope: MigrateScope,
    runId: string,
    deps: MigrationDriverDeps
  ) => Promise<void>;
  /**
   * DB-plane data-migration dispatch (Spec W / Y): runs the bulk-load runner
   * (via the AMVS data-migration route) BEFORE the data-parity reconcile so the
   * target is populated for the comparison. Lazily defaulted; tests inject a
   * mock. The live source->target load is a work-machine shakedown seam.
   */
  triggerDataMigration?: (
    scope: MigrateScope,
    runId: string,
    deps: MigrationDriverDeps
  ) => Promise<void>;
  /**
   * WS2 (2026-07-31): the DB-plane completion chain (assemble -> schema apply
   * -> data load -> reconcile -> pause on the parity report) that takes over
   * when the LAST db-plane item reports `implemented` — a DB pack can never
   * produce a haibox `deployed` outcome. Lazily defaulted; tests inject a mock.
   */
  runDbPlaneCompletion?: (
    scope: MigrateScope,
    run: MigrationExecutionRun,
    item: MigrationExecutionRunItem,
    deps: MigrationDriverDeps
  ) => Promise<void>;
  /**
   * Stage-2 (2026-07-31): the run's operator-registered target-service serve
   * spec (Start-stage dialog) — attached as the `target` body field on
   * service-plane deployOnComplete submits so haibox can launch the migrated
   * service. Lazily defaulted to the in-memory store read.
   */
  getTargetServeSpec?: (runId: string) => TargetServeSpec | undefined;
  /**
   * Handles a `bug_id` build-results callback (Group 4 seam). Defaults to
   * {@link handleBugCallback}; run fire-and-forget for `deployed` (scoped
   * re-reconcile is long), inline for `failed`/`rejected` (no replay).
   */
  handleBugCallback?: typeof handleBugCallback;
  /**
   * Robustness R2 (2026-08-05): the retry-timer seam. The driver schedules a
   * transient-failure re-dispatch through THIS instead of a bare setTimeout so
   * tests can capture/fire timers synchronously. The default unrefs the timer
   * (a pending retry must never hold the process open); durability across a
   * restart comes from the persisted retry_next_attempt_at column + the
   * boot-recovery sweep, NOT from the in-process timer.
   */
  scheduleRetryTimer?: (delayMs: number, fn: () => void) => void;
  /**
   * SCL first-commit delivery (spec 10, 2026-08-18): builds the generated
   * behaviour suite + manifest for an SCL story's dispatch. Optional + lazily
   * defaulted to {@link buildSclInitialCommit} so pre-existing deps mocks keep
   * compiling; tests inject a mock. FAIL-SOFT at the call site: a build
   * failure dispatches WITHOUT initial files + a loud warn + a decision-log
   * warning (never a blocked dispatch).
   */
  buildSclInitialCommit?: typeof buildSclInitialCommit;
  /**
   * SCL shipped-suite integrity verdict (spec 10): the build-results-time
   * no-modification guard + quarantine thresholds. Optional + lazily
   * defaulted to {@link evaluateSclSuiteIntegrity}; tests inject a mock.
   */
  evaluateSclSuiteIntegrity?: typeof evaluateSclSuiteIntegrity;
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
 * A story is spec-ready iff (CD-7, aligned 2026-07-27 with the plan screen's
 * card semantics — "enabled button ⇒ server says yes" cuts BOTH ways):
 *   - it is saved to backlog (`workItemId` present), AND
 *   - its latest spec-generation row is USABLE: status generated /
 *     generated_with_warnings OR `manual_ready` (the Phase-1a human-accepted
 *     manual spec — the card counted it, this gate previously did not), AND
 *   - it is not STALE. Staleness is EITHER flag: `stale === true` OR a
 *     non-empty `stale_reason` (the target-architecture mark-stale stamps
 *     `stale` without a reason; the story-amend path stamps both — checking
 *     only one let the two flags disagree across surfaces).
 */
export function isStorySpecReady(
  item: BookOfWorkItem,
  specGens: SpecGeneration[]
): boolean {
  if (!item.workItemId) return false;
  const latest = latestSpecGenerationForWorkItem(item.workItemId, specGens);
  if (!latest) return false;
  if (latest.stale === true || latest.stale_reason) return false;
  if (READY_SPEC_STATUSES.has(latest.status ?? '')) return true;
  return latest.manual_ready === true;
}

/**
 * WHY a story fails {@link isStorySpecReady} — feeds the gate's per-story
 * message so the refusal is diagnosable against the plan screen (whose
 * `ready_for_spec` READINESS badge means "a spec CAN be generated", which
 * users reasonably misread as "ready to run"). Pure; exported for tests.
 */
export function describeSpecReadinessGap(
  item: BookOfWorkItem,
  specGens: SpecGeneration[]
): string {
  if (!item.workItemId) return 'it has not been saved to the backlog';
  const latest = latestSpecGenerationForWorkItem(item.workItemId, specGens);
  if (!latest) return 'no implementation spec has been generated for it yet';
  if (latest.stale === true || latest.stale_reason) {
    return `its spec is STALE${latest.stale_reason ? ` (${latest.stale_reason})` : ''} — regenerate it`;
  }
  return `its latest spec attempt ended '${latest.status ?? 'unknown'}' (not generated, not marked manual-ready)`;
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
 * True when the item is MANUAL work (Spec 2026-08-04-1, unifying Spec
 * 2026-07-06-g's manual-gate): human activity (baseline capture sessions,
 * parity sign-off sweeps, db-pack review procedures, prerequisite gates) that
 * is NEVER dispatched to the implement-verify service and never required to
 * be spec-ready. Completion is gated by plane/condition gates, not by specs.
 * The single classifier in migrationExecutionClass.ts is the oracle.
 */
function isManualGate(item: BookOfWorkItem): boolean {
  return isManualExecutionItem(item);
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
   * Whether the missing-baseline dimension applies (default true). A per-plane
   * DB/UI start (2026-07-26) has no API reconcile, so the API-behaviour
   * baseline is not a precondition for it — only service-containing scopes
   * require the oracle.
   */
  requireCurrentBaseline?: boolean;
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
    // Spec-gate STORY nodes ONLY (2026-07-27). Save-to-backlog stamps a
    // workItemId on the WHOLE ancestor chain, so "has a workItemId" swept
    // saved epics/features (and TEST siblings) into this gate — none of which
    // spec generation ever targets (selectEligibleStories filters
    // type==='story'), so they could NEVER become ready and blocked a start
    // the plan screen's card (stories-only) showed as clear. TEST items
    // without specs are silently skipped by dispatch (pre-existing CD-5
    // behaviour); structural nodes are scaffolding.
    if (!item.workItemId || !isStoryTypeItem(item)) continue;
    if (isDeferred(item, params.deferredWorkItemIds)) continue; // deferred drops out
    if (isManualGate(item)) continue; // manual-gate work carries no spec by design
    if (hasSelection && !params.selectedWorkItemIds!.has(item.workItemId as string)) {
      continue; // out of the selected subset
    }
    if (!isStorySpecReady(item, params.specGens)) {
      reasons.push({
        code: 'story_not_spec_ready',
        message:
          `Story "${item.title ?? item.workItemId}" is not spec-ready: ` +
          `${describeSpecReadinessGap(item, params.specGens)}. ` +
          `(The table's 'ready_for_spec' badge means a spec CAN be generated — ` +
          `the run needs the GENERATED spec itself: use "Generate specs (saved)" ` +
          `or supply a manual spec and mark it ready.)`,
        workItemId: item.workItemId ?? null,
      });
    }
  }

  if (!params.hasActiveCurrentBaseline && params.requireCurrentBaseline !== false) {
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
    if (isManualGate(item)) continue; // never dispatched to the implement service
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
      workstream: item.workstream ?? workstreamFromTags(item.tags),
      plane: planeForItem(item),
      tags: (item.tags ?? []).filter((t): t is string => typeof t === 'string'),
      hasEndpointIds:
        Array.isArray((item as { apiEndpointIds?: unknown }).apiEndpointIds) &&
        ((item as { apiEndpointIds?: unknown[] }).apiEndpointIds?.length ?? 0) > 0,
      // SCL corpus markers (spec 10): flattened off the blob (snake_case as
      // stamped by spec 7 + camelCase tolerated). Null on non-SCL items.
      ...sclCarriageMarkersFromBlob(item as unknown as Record<string, unknown>),
    });
  }
  // Big-bang: only the FINAL spec deploys.
  if (descriptors.length > 0) {
    descriptors[descriptors.length - 1].deployOnComplete = true;
  }
  return descriptors;
}

// ============================================================================
// Plane model + phased dispatch (Spec W — plane-based execution)
// ============================================================================

/** Migration planes, in execution order (foundation-first). */
export type MigrationPlane = 'db' | 'service' | 'ui';
export const PLANE_ORDER: readonly MigrationPlane[] = ['db', 'service', 'ui'];

const DB_PLANE_WORKSTREAMS = new Set([
  'target_database_schema_implementation',
  'data_migration',
  // Infra is positionable (Spec V/W); v1 default is early, with the DB plane.
  'target_infrastructure_environment_implementation',
  // Data-parity reconcile/reporting is DB-plane work (the plane reframe chains
  // schema → data → parity reconcile INSIDE the DB plane). 2026-07-27: this
  // token was missing here while the execution rail's display mirror
  // (MigrationExecutionRail.planeForStory) already had it — the same story sat
  // on the DB card in the UI but ran (and gated) in the SERVICE phase server-
  // side. The two vocabularies MUST stay identical; both sides pin all four
  // tokens in tests.
  'data_parity_reconciliation_reporting',
]);
const UI_PLANE_WORKSTREAMS = new Set([
  'target_frontend_implementation',
  // Cutover sorts last within the UI phase (STREAM_SEQUENCE_RANK keeps it last).
  'cutover_rollback_decommission',
]);

/**
 * Map a workstream token to its plane. `service` is the default — it owns the
 * API + internal-processing build AND all cross-cutting / meta work (Spec V).
 */
export function planeForWorkstream(workstream: string | null | undefined): MigrationPlane {
  const ws = (workstream ?? '').trim();
  if (DB_PLANE_WORKSTREAMS.has(ws)) return 'db';
  if (UI_PLANE_WORKSTREAMS.has(ws)) return 'ui';
  return 'service';
}

/** Extract the `stream:<name>` tag the deterministic planner stamps, if present. */
export function workstreamFromTags(tags: string[] | null | undefined): string | null {
  for (const t of tags ?? []) {
    if (typeof t === 'string' && t.startsWith('stream:')) return t.slice('stream:'.length);
  }
  return null;
}

/** Resolve a book item's plane: its workstream, else its `stream:` tag, else service. */
export function planeForItem(item: BookOfWorkItem): MigrationPlane {
  return planeForWorkstream(item.workstream ?? workstreamFromTags(item.tags));
}

/**
 * True for the DISPATCHABLE leaf types: STORY and TEST blob items (blob `type`
 * is lowercase 'story' for stories and 'TEST' for test siblings — compared
 * case-insensitively). Structural nodes (initiative / epic / feature) are NOT
 * dispatchable even though save-to-backlog stamps a `workItemId` on the whole
 * ancestor chain — treating "has a workItemId" as "is a story" swept saved
 * epics/features into the plane selection and the spec gate (2026-07-27 bug:
 * they can NEVER be spec-ready because spec generation only targets stories,
 * so a plane Start was refused for nodes the plan screen's card — which
 * counts stories only — never showed as blocking).
 */
export function isDispatchableLeafItem(item: BookOfWorkItem): boolean {
  const t = (item.type ?? '').toLowerCase();
  return t === 'story' || t === 'test';
}

/** True when the blob item is a STORY (the spec-carrying, spec-GATED type). */
export function isStoryTypeItem(item: BookOfWorkItem): boolean {
  return (item.type ?? '').toLowerCase() === 'story';
}

/** One phase of the phased plan: a plane and the dispatch descriptors it owns. */
export interface DispatchPhase {
  plane: MigrationPlane;
  descriptors: DispatchDescriptor[];
}

export interface PhasedDispatchPlan {
  /** Descriptors re-sequenced in plane order (db -> service -> ui). */
  descriptors: DispatchDescriptor[];
  /** The non-empty phases, in execution order. */
  phases: DispatchPhase[];
}

/**
 * Group the ordered dispatch set into plane phases (db -> service -> ui),
 * preserving intra-plane order, re-sequencing globally, and marking the LAST
 * item of EACH phase `deployOnComplete=true` — so every plane deploys +
 * reconciles before the run PAUSES for human approval (Spec W). Only planes
 * with items appear, so tier-driven inclusion falls out naturally (a DB-only or
 * service-only migration simply has one phase).
 */
export function buildPhasedDispatchSet(params: {
  book: BookOfWork;
  specGens: SpecGeneration[];
  deferredWorkItemIds: Set<string>;
  selectedWorkItemIds?: Set<string> | null;
}): PhasedDispatchPlan {
  const ordered = buildOrderedDispatchSet(params);
  const byPlane = new Map<MigrationPlane, DispatchDescriptor[]>();
  for (const d of ordered) {
    const plane = d.plane ?? 'service';
    const list = byPlane.get(plane) ?? [];
    list.push(d);
    byPlane.set(plane, list);
  }

  const phases: DispatchPhase[] = [];
  const descriptors: DispatchDescriptor[] = [];
  let seq = 0;
  for (const plane of PLANE_ORDER) {
    let list = byPlane.get(plane);
    if (!list || list.length === 0) continue;
    // Service-plane foundations-first rank (2026-08-15): scaffold story →
    // ALL foundation stories (both streams — the scheduler/queue rehoming
    // previously ran AFTER 60 endpoint stories, so the whole convention
    // layer was request-response-shaped) → implementation stories. STABLE
    // within ranks (the walk order is preserved inside each group).
    if (plane === 'service') {
      const rank = (d: DispatchDescriptor): number => {
        const tags = d.tags ?? [];
        if (tags.some((t) => t.trim().toLowerCase() === 'seed_build_files')) return 0;
        if (
          tags.includes('provenance:plan-deterministic') &&
          !d.hasEndpointIds &&
          !tags.includes('execution:manual-gate')
        ) {
          return 1; // planner-authored foundation (zero endpoints)
        }
        return 2;
      };
      list = list
        .map((d, i) => ({ d, i }))
        .sort((a, b) => rank(a.d) - rank(b.d) || a.i - b.i)
        .map((x) => x.d);
    }
    const phaseDescriptors = list.map((d) => ({
      ...d,
      sequencePosition: seq++,
      deployOnComplete: false,
    }));
    // The plane's LAST build item deploys -> its `deployed` callback runs the
    // plane reconcile and then pauses the run (unless it is the final plane).
    phaseDescriptors[phaseDescriptors.length - 1].deployOnComplete = true;
    phases.push({ plane, descriptors: phaseDescriptors });
    descriptors.push(...phaseDescriptors);
  }
  return { descriptors, phases };
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
    fetchLatestMigrationExecutionRunForBook: getLatestMigrationExecutionRunForBook,
    fetchMigrationExecutionRunsForBook: getMigrationExecutionRunsForBook,
    createMigrationExecutionRun,
    getMigrationExecutionRun,
    patchMigrationExecutionRun,
    patchMigrationExecutionRunItem,
    findMigrationRunItemByJobId,
    submitOrchestration,
    submitOrchestrationBatch,
    // Deploy-only replay (2026-09-06): the recovery path for a run whose build
    // succeeded and whose deploy failed environmentally.
    deployExistingRun,
    recordWorkItemImplementationError,
    autoAnswerer,
    buildResultsCallbackUrl,
    reconciliationDeps: defaultReconciliationDriverDeps(),
    triggerReconcile: triggerFullBaselineReconcile,
    // Spec W: the DB-plane reconcile fires the live AMVS data-parity comparator
    // (fail-soft; produces + persists the report the pause review + resume gate
    // read). Tests inject a mock; the fallback stub inside kickPlaneReconcile
    // only applies to deps built without this field.
    triggerDataParityReconcile: createDataParityReconcileTrigger(),
    // Spec W / Y: the DB plane loads the target via the data-migration runner
    // (AMVS route) before the data-parity reconcile compares it.
    triggerDataMigration: createDataMigrationTrigger(),
    // WS2 (2026-07-31): the DB execution chain — assemble the run's branches
    // + pack, apply schema, load data, reconcile — fired on the db plane's
    // final `implemented` callback.
    runDbPlaneCompletion: createDbPlaneCompletionRunner(),
    // Stage-2 (2026-07-31): serve spec for service-plane haibox deploys.
    getTargetServeSpec: (runId: string) => migrationTargetCredentialsStore.getService(runId),
    handleBugCallback,
    carryOverCoverageReads: defaultCarryOverCoverageReadsDeps(),
    scheduleRetryTimer: defaultScheduleRetryTimer,
  };
}

/**
 * Default retry-timer: setTimeout, unref'd so a pending retry never holds the
 * gateway process open (restart durability is the persisted
 * retry_next_attempt_at + the boot-recovery sweep, not this timer).
 */
function defaultScheduleRetryTimer(delayMs: number, fn: () => void): void {
  const handle = setTimeout(fn, delayMs);
  // Node returns a Timeout with unref(); browsers/jest fakes may not.
  (handle as { unref?: () => void }).unref?.();
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
  // Enforce the documented "normalised company/project" contract HERE — the
  // UI passes display names ("Example Corp"), but the IVS workspace is
  // addressed by the normalised form ("example-corp"); live-confirmed
  // 2026-07-27: raw names 400 at the IVS precondition gate even after a
  // correct project init. Idempotent.
  scope = normalizeScopeIdentifiers(scope);
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
  const bookItems = book.book_of_work_json?.items ?? [];

  // Per-plane start (2026-07-26): resolve "Start stage N" onto the subset
  // machinery — the selection becomes the plane's non-deferred stories, so
  // every scope-conditional gate + the dispatch set are plane-scoped for free.
  // An explicit selection wins over the plane (the batch flow predates planes).
  const plane = selectedSet.size === 0 ? (scope.plane ?? null) : null;
  if (plane) {
    for (const item of bookItems) {
      if (!item.workItemId) continue;
      // Only DISPATCHABLE leaves (stories + TEST siblings) enter the plane
      // selection. Saved EPICS/FEATURES carry workItemIds too (save-to-backlog
      // stamps the whole ancestor chain) — sweeping them in put permanently
      // spec-less nodes in front of the spec gate (2026-07-27).
      if (!isDispatchableLeafItem(item)) continue;
      if (isDeferred(item, deferredWorkItemIds)) continue;
      if (planeForItem(item) === plane) selectedSet.add(item.workItemId);
    }
    if (selectedSet.size === 0) {
      return {
        status: 'error',
        message: `The book of work has no dispatchable stories in the '${plane}' plane`,
      };
    }
  }
  const isSubset = selectedSet.size > 0;
  const isBatch = !!(scope.batchName && scope.batchName.trim());
  // The service plane owns the API build + reconcile: only scopes containing it
  // need the API-behaviour baseline (the oracle) and the carry-over accounting.
  const serviceInScope = plane === null || plane === 'service';

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
  // migrate — EXCEPT a per-plane SERVICE start (2026-07-26): the service
  // plane's API build + reconcile is exactly what the accounting backstops,
  // so it gates there (and only there).
  let carryOverCoverage: CarryOverCoverageResult | undefined;
  if (architectureId && (!isSubset || plane === 'service')) {
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
      // FAIL-CLOSED (gold standard 2026-08-07): an unreadable accounting used
      // to degrade to `undefined` — the gate dimension silently vanished and
      // Migrate started BLIND to unaccounted behaviour-bearing carry-over
      // (exactly what the gate exists to prevent). An unreadable gate input
      // is a blocked start, not a skipped check.
      logger.warn('[diag-gateway] migration_execution_driver carry_over_coverage_failed', {
        projectId,
        bookId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return {
        status: 'blocked',
        reasons: [
          {
            code: 'carry_over_unavailable',
            message:
              'The carry-over completeness accounting could not be read from AMS — ' +
              'refusing to start rather than migrating blind to unaccounted ' +
              `behaviour-bearing work (${error instanceof Error ? error.message : 'read failed'}). ` +
              'Retry when AMS is reachable.',
          },
        ],
      };
    }
  }

  // 4. Validate the hard-block gate (server-side; never trust the UI). The
  //    carry_over dimension STACKS with the spec-ready + baseline reasons.
  const items = bookItems;
  const gate = evaluateHardBlock({
    items,
    specGens,
    deferredWorkItemIds,
    selectedWorkItemIds: selectedSet,
    hasActiveCurrentBaseline: !!baseline,
    requireCurrentBaseline: serviceInScope,
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

  // 4c. Code-tier readiness gate (Spec 2026-07-06-i): when the dispatch scope
  //     contains API-parity code stories, Migrate additionally requires an
  //     active pinned baseline, per-endpoint baseline coverage for every
  //     unflagged story, and the pinned baseline's persisted coverage summary
  //     to meet Spec K's floor. FAIL-CLOSED on unreadable parity inputs.
  //     Reasons STACK with the gates above so the user sees every blocker.
  let codeGateReasons: HardBlockResult['reasons'] = [];
  if (codeStoriesInScope({ items, deferredWorkItemIds, selectedWorkItemIds: selectedSet })) {
    const codeGate = await evaluateCodeReadiness({
      projectId,
      currentArchitectureId: book.current_architecture_id ?? null,
      items,
      deferredWorkItemIds,
      selectedWorkItemIds: selectedSet,
      pinnedBaselineId: baseline?.id ?? null,
      reads: deps.codeGateReads,
    });
    codeGateReasons = codeGate.reasons;
    logger.info('[diag-gateway] migration_execution_driver code_gate', {
      projectId,
      bookId,
      ok: codeGate.ok,
      reasons: codeGate.reasons.map((r) => r.code),
    });
  }

  // 4d. Data-parity is NO LONGER a pre-migrate gate (Spec W): it is repositioned
  //     into the DB-plane reconcile inside phased execution and evaluated at the
  //     post-DB-plane approval pause (resumeMigration, Persistence-conditional).
  //     A pre-flight data-parity gate was a chicken-and-egg — the target data is
  //     loaded DURING the migration, so parity can only be judged after the DB
  //     plane deploys.

  // 4e. Plane-precedence gate (2026-07-26): starting a NON-first plane
  //     requires the preceding plane's run to be DEPLOYED (built + reconciled),
  //     and — when the preceding plane is DB — clean data parity, unless
  //     break-glass overridden. This is the per-plane analogue of the
  //     resume-time gate: with per-plane runs the pause between planes IS the
  //     gap between two Start buttons.
  //     v1 checks the LATEST run only (sequential per-plane execution); a
  //     multi-run history walk is deliberately out of scope.
  let planePrecedenceReasons: HardBlockResult['reasons'] = [];
  if (plane) {
    const planesWithStories = new Set<MigrationPlane>();
    for (const item of items) {
      if (!item.workItemId) continue;
      // Same leaf filter as the selection: a saved epic/feature's workstream
      // must not manufacture a plane (and a precedence requirement) that has
      // no dispatchable stories of its own.
      if (!isDispatchableLeafItem(item)) continue;
      if (isDeferred(item, deferredWorkItemIds)) continue;
      planesWithStories.add(planeForItem(item));
    }
    const earlier = PLANE_ORDER.filter(
      (p) =>
        planesWithStories.has(p) &&
        PLANE_ORDER.indexOf(p) < PLANE_ORDER.indexOf(plane),
    );
    if (earlier.length > 0) {
      const preceding = earlier[earlier.length - 1];
      // Plane-AWARE precedence (2026-08-07, replaces the latest-run-only v1):
      // the latest run may be a later attempt of the CURRENT plane, so its
      // status says nothing about whether the PRECEDING plane ever deployed.
      // Walk the book's full run history: among runs that contain the
      // preceding plane's items, the NEWEST attempt is authoritative — it must
      // be deployed (an old deployed run superseded by a newer failed re-run
      // of the same plane does NOT satisfy precedence). A history read failure
      // is fail-closed: precedence unverifiable = blocked, never assumed.
      const planeByWorkItemId = new Map<string, MigrationPlane>();
      for (const item of items) {
        if (!item.workItemId) continue;
        if (!isDispatchableLeafItem(item)) continue;
        planeByWorkItemId.set(item.workItemId, planeForItem(item));
      }
      const fetchRuns =
        deps.fetchMigrationExecutionRunsForBook ?? getMigrationExecutionRunsForBook;
      let precedingRun: MigrationExecutionRun | null = null;
      let historyUnreadable = false;
      try {
        const history = await fetchRuns(projectId, bookId);
        precedingRun =
          history.find((r) =>
            (r.items ?? []).some(
              (i) =>
                i.work_item_id &&
                planeByWorkItemId.get(i.work_item_id) === preceding
            )
          ) ?? null;
      } catch (error) {
        historyUnreadable = true;
        logger.warn('[diag-gateway] migration_execution_driver precedence_history_unreadable', {
          projectId,
          bookId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
      if (historyUnreadable) {
        planePrecedenceReasons.push({
          code: 'precedence_unverifiable',
          message:
            `Could not read the book's run history to verify the '${preceding}' plane ` +
            `deployed before starting the '${plane}' plane — refusing to start on an ` +
            'unverifiable precedence. Retry when AMS is reachable.',
        });
      } else if (!precedingRun || precedingRun.status !== RUN_STATUS.DEPLOYED) {
        planePrecedenceReasons.push({
          code: 'preceding_plane_not_deployed',
          message:
            `The '${preceding}' plane must complete first (its run deployed + ` +
            `reconciled) before the '${plane}' plane can start` +
            (precedingRun
              ? ` — its newest run is '${precedingRun.status ?? 'unknown'}'.`
              : ' — no run has covered that plane yet.'),
        });
      } else if (preceding === 'db' && !scope.parityOverride) {
        const parity = await evaluateDataParityReadiness({
          projectId,
          architectureId: book.current_architecture_id ?? null,
          reads: deps.dataParityGateReads,
        });
        if (!parity.ok) {
          planePrecedenceReasons.push(
            ...parity.reasons.map((r) => ({
              code: r.code,
              message: r.message,
              workItemId: r.workItemId ?? null,
            })),
          );
        }
      }
    }
  }

  const allBlockReasons = [
    ...gate.reasons,
    ...dbGateReasons,
    ...codeGateReasons,
    ...planePrecedenceReasons,
  ];
  if (allBlockReasons.length > 0) {
    logger.warn('[diag-gateway] migration_execution_driver start_blocked', {
      projectId,
      bookId,
      reasonCount: allBlockReasons.length,
      reasons: allBlockReasons.map((r) => r.code),
    });
    return { status: 'blocked', reasons: allBlockReasons };
  }

  // 4. Build the PHASED dispatch set (Spec W): plane-grouped (db -> service ->
  //    ui), each plane's LAST item deploys so the plane reconciles before the
  //    run PAUSES for human approval. Big-bang is gone (batch mode aside).
  const phasedPlan = buildPhasedDispatchSet({
    book,
    specGens,
    deferredWorkItemIds,
    selectedWorkItemIds: selectedSet,
  });
  const dispatchSet = phasedPlan.descriptors;
  if (dispatchSet.length === 0) {
    return {
      status: 'error',
      message: isSubset
        ? 'No dispatchable specs in the selected work items'
        : 'No dispatchable specs in the book of work',
    };
  }

  // Mixed-plane BATCH refusal (gold standard 2026-08-07): a batch is ONE
  // job/branch with ONE callback — its `deployed` completes every sibling at
  // once, so a batch mixing db-plane stories with others would mark the db
  // items DEPLOYED while their schema-apply → data-migration → parity chain
  // NEVER ran (the haibox deploy does not apply DB packs). Refuse at start;
  // the operator runs the DB plane separately (per-plane Starts) or drops the
  // batch name.
  const dispatchPlaneOf = (d: (typeof dispatchSet)[number]): MigrationPlane =>
    d.plane ?? planeForWorkstream(d.workstream);
  if (isBatch) {
    const batchPlanes = new Set(dispatchSet.map(dispatchPlaneOf));
    if (batchPlanes.has('db') && batchPlanes.size > 1) {
      return {
        status: 'blocked',
        reasons: [
          {
            code: 'mixed_plane_batch',
            message:
              'A batch cannot mix db-plane stories with other planes: the batch ' +
              "deploys as ONE unit, and its 'deployed' callback would mark the db " +
              'stories deployed while their schema-apply/data-migration/parity chain ' +
              'never ran. Start the DB plane separately (per-plane Start) or remove ' +
              'the batch name.',
          },
        ],
      };
    }
  }

  // UI-plane refusal (2026-08-07, pair-scope ruling): this migration pair
  // (Java 8/Spring Classic + Sybase 15 → Java 21/Spring Boot + Postgres 18)
  // has NO UI-plane delivery path — dispatching UI stories would "implement"
  // frontend work with no deploy or verification behind it. Loud block naming
  // the stories; remedy = defer them (they stay visible in the book).
  const uiDescriptors = dispatchSet.filter((d) => dispatchPlaneOf(d) === 'ui');
  if (uiDescriptors.length > 0) {
    return {
      status: 'blocked',
      reasons: uiDescriptors.map((d) => ({
        code: 'ui_plane_out_of_scope',
        workItemId: d.workItemId ?? null,
        message:
          `UI-plane story '${d.title ?? d.workItemId ?? 'unknown'}' cannot be dispatched: ` +
          'the ui plane is out of scope for this migration pair (no deploy/verification ' +
          'path). Defer the story to proceed with the db/service planes.',
      })),
    };
  }

  // 4f. Run-branch chaining (2026-08-06): resolve where this run's FIRST
  //     dispatch bases its worktree branch. 'chain' (default) continues from
  //     the latest prior run's last GOOD spec branch — a "Start Stage 2" sees
  //     Stage 1's unmerged work in its worktree; 'fresh' starts from the
  //     default branch (operator declared the previous stage merged). The
  //     resolved base persists on the run header so retries, resume and the
  //     boot sweep re-derive the same base after a gateway restart.
  //
  //     CROSS-RUN chaining is a STAGE-BOUNDARY continuation ONLY (user ruling
  //     2026-08-06, live re-start failure): it engages iff the latest prior
  //     run (a) DEPLOYED and (b) covers DISJOINT work items (a genuinely
  //     preceding stage). A "Re-start stage N" — any overlap with the items
  //     being dispatched now, whatever the prior run's status — means the
  //     operator abandoned that attempt: it gets a CLEAN tree off the default
  //     branch, never the abandoned attempt's leftover branches (whose
  //     "implemented" items may not even have surviving branches — the live
  //     failure shape: base_spec resolved no branch and allocation failed).
  //     "Resume stage N" is untouched: it continues the SAME run, where
  //     within-run item chaining applies by design.
  let runBaseSpec: string | null = null;
  // INTEGRATION base (2026-08-12, the live Stage-2 start failure): the old
  // stage-boundary chain resolved lastGoodSpecOfRun(prior) — a SINGLE
  // lineage. Two failure modes: (a) the picked item's branch may never have
  // existed (a zero-diff no-op spec is honestly `implemented` with no
  // branch — IVS then fail-fasts "resolves no branch"); (b) even a live
  // branch is ONE of the prior stage's N sibling branches, not the
  // accumulated whole (the DB plane produced 21, merged only in the
  // assembly's own db-migration/* branch). Stage continuation now uses a
  // third behaviour: base on the default branch PLUS every remote
  // feature/* branch for the target merged in (IVS builds it per repo
  // target at allocation) — specs accumulate onto ALL prior work and a
  // missing branch is simply absent, never fatal.
  let runBaseMode: 'chain' | 'fresh' | 'integration' | 'mr' =
    scope.baseMode === 'fresh' ? 'fresh' : 'chain';
  let baseReason = scope.baseMode === 'fresh' ? 'operator_fresh' : 'no_prior_run';
  // Explicit-branch base (2026-08-15): the run's worktrees sit on the branch
  // named here (the DB assembly branch = the open Merge Request's code).
  let runBaseBranch: string | null = null;
  if (scope.baseMode === 'integration') {
    // Operator-chosen integration (2026-08-15): previously integration was
    // only auto-derived at a deployed+disjoint stage boundary — a same-stage
    // RE-start could never accumulate onto prior pushed branches.
    runBaseMode = 'integration';
    baseReason = 'operator_integration';
  } else if (scope.baseMode === 'mr') {
    // "Start from the open Merge Request" (2026-08-15): base every worktree
    // on the prior DB run's db-migration/<id8> assembly branch — the merged
    // DB plane INCLUDING the assembly-only overlay files. Resolution: the
    // newest DEPLOYED run whose items are DISJOINT from this dispatch (the
    // same genuinely-preceding-stage predicate the auto-integration uses).
    // IVS fail-closes at allocation if the branch is absent on origin.
    const fetchRuns =
      deps.fetchMigrationExecutionRunsForBook ?? getMigrationExecutionRunsForBook;
    try {
      const runs = await fetchRuns(projectId, bookId);
      const dispatchWorkItemIds = new Set(
        dispatchSet.map((d) => d.workItemId).filter((id): id is string => !!id)
      );
      // Plane-aware (2026-08-15): only a run that actually covered the DB
      // plane ever created a db-migration/<id8> assembly branch (the DB
      // completion chain is the sole creator). "Newest DEPLOYED + disjoint"
      // alone could select a deployed SERVICE run — deriving a branch name
      // that never existed and failing the allocation with a misleading
      // remedy while the real DB assembly branch sits on origin.
      const planeByWorkItemId = new Map<string, MigrationPlane>();
      for (const item of items) {
        if (!item.workItemId) continue;
        if (!isDispatchableLeafItem(item)) continue;
        planeByWorkItemId.set(item.workItemId, planeForItem(item));
      }
      const dbRun = (runs ?? []).find(
        (r) =>
          r.status === RUN_STATUS.DEPLOYED &&
          (r.items ?? []).some(
            (i) => i.work_item_id && planeByWorkItemId.get(i.work_item_id) === 'db'
          ) &&
          !(r.items ?? []).some(
            (i) => i.work_item_id && dispatchWorkItemIds.has(i.work_item_id)
          )
      );
      if (!dbRun || !dbRun.id) {
        return {
          status: 'blocked',
          reasons: [
            {
              code: 'mr_base_unresolvable',
              message:
                'No deployed preceding-stage run found for this book — there is no ' +
                'DB assembly branch (db-migration/<runId>) to base on. Deploy the ' +
                'DB plane first, or choose "fresh from main" / "integration".',
            },
          ],
        };
      }
      const runIdShort =
        String(dbRun.id).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || 'run';
      runBaseBranch = `db-migration/${runIdShort}`;
      runBaseMode = 'mr';
      baseReason = 'operator_mr';
    } catch (error) {
      // FAIL-CLOSED like the chain path: the operator asked for the MR base;
      // silently starting elsewhere would discard the DB plane invisibly.
      return {
        status: 'blocked',
        reasons: [
          {
            code: 'mr_base_unresolvable',
            message:
              'Could not read the prior runs to resolve the DB assembly branch ' +
              `(${error instanceof Error ? error.message : 'read failed'}). Retry, or ` +
              'choose a different base in the Start-stage dialog.',
          },
        ],
      };
    }
  } else if (scope.baseMode !== 'fresh') {
    const fetchLatest =
      deps.fetchLatestMigrationExecutionRunForBook ??
      getLatestMigrationExecutionRunForBook;
    try {
      const latest = await fetchLatest(projectId, bookId);
      if (latest) {
        const dispatchWorkItemIds = new Set(
          dispatchSet.map((d) => d.workItemId).filter((id): id is string => !!id)
        );
        const overlaps = (latest.items ?? []).some(
          (i) => i.work_item_id && dispatchWorkItemIds.has(i.work_item_id)
        );
        if (overlaps) {
          baseReason = 'restart_of_same_stage';
        } else if (latest.status !== RUN_STATUS.DEPLOYED) {
          // A prior run for OTHER work items that never reached `deployed`
          // (2026-09-06). This used to keep mode 'chain', which at a stage
          // boundary resolves no single-lineage base and silently degrades to
          // a fresh default-branch base -- discarding the prior stage's pushed
          // branches. Live shape: the scaffold batch implemented, pushed and
          // opened its MR, then its deploy failed (no container runtime), so
          // the run halted short of `deployed`; the next stage then started
          // from bare main and re-derived everything the scaffold MR already
          // carried, opening a second MR against the first. Whether a run
          // reached `deployed` says nothing about whether its branches exist:
          // a deploy can fail long after a clean push. `integration` merges
          // the freshly-fetched default branch plus every remote
          // db-migration/* and feature/* branch by pattern, so prior pushed
          // work is picked up regardless of the prior run's status, and "no
          // branches to integrate" still degrades to the plain fresh default.
          // Strictly safer than the silent fallback; the reason string is
          // unchanged on purpose (log analysis + the stage_integration pins
          // key on it), only the mode moves.
          runBaseMode = 'integration';
          baseReason = 'prior_run_not_deployed';
        } else {
          runBaseMode = 'integration';
          baseReason = 'stage_integration';
        }
      }
    } catch (error) {
      // FAIL-CLOSED (gold standard 2026-08-07, was fail-soft): the operator
      // asked to CHAIN (the default) — silently starting from the default
      // branch instead would discard the preceding stage's unmerged work from
      // every worktree in this run, invisibly. Unreadable prior-run state =
      // blocked start; the operator either retries or explicitly chooses
      // 'fresh' in the Start-stage dialog.
      logger.warn('[diag-gateway] migration_execution_driver base_spec_resolve_failed', {
        projectId,
        bookId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return {
        status: 'blocked',
        reasons: [
          {
            code: 'chain_base_unresolvable',
            message:
              'Could not read the prior run to resolve the chained branch base ' +
              `(${error instanceof Error ? error.message : 'read failed'}). Refusing to ` +
              'silently start from the default branch — retry, or choose "fresh from ' +
              'main" in the Start-stage dialog to opt out of chaining explicitly.',
          },
        ],
      };
    }
  }
  logger.info('[diag-gateway] migration_execution_driver run_base_resolved', {
    projectId,
    bookId,
    baseMode: scope.baseMode ?? 'chain',
    runBaseMode,
    baseSpec: runBaseSpec,
    baseReason,
  });
  trace.step(
    runBaseMode === 'mr'
      ? `run base: Merge Request branch ${runBaseBranch} (${baseReason})`
      : runBaseMode === 'integration'
        ? `run base: integration (default + db-migration/* + feature/* branches) (${baseReason})`
        : runBaseSpec
          ? `run base: chained off ${runBaseSpec} (${baseReason})`
          : `run base: default branch (${baseReason})`,
    { project: scope.project }
  );

  // 5. Create the AMS run + ordered items atomically (deploy_on_complete only
  //    on the FINAL item).
  const runRequest = {
    run: {
      project_id: projectId,
      // Scope NAMES (changeset 219): persisted so the boot-recovery sweep can
      // re-derive the driver scope for cross-project in-flight discovery.
      company: scope.company,
      project: scope.project,
      book_of_work_id: bookId,
      status: RUN_STATUS.STARTED,
      current_sequence_position: 0,
      pinned_current_baseline_id: baseline?.id ?? null,
      base_spec: runBaseSpec,
      // run_base_mode stamped at creation (2026-08-12) so retries, Resume and
      // the boot-recovery sweep re-derive the SAME base behaviour after a
      // gateway restart — read back via runBaseModeOf().
      decision_log_json: [
        {
          type: 'run_base_mode',
          mode: runBaseMode,
          reason: baseReason,
          // 'mr' mode: the resolved DB assembly branch, persisted so retries,
          // Resume and boot recovery re-derive the SAME base (2026-08-15).
          ...(runBaseBranch ? { base_branch: runBaseBranch } : {}),
          at: new Date().toISOString(),
        },
      ],
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

  // Break-glass RECORDING for a plane-precedence parity override (2026-07-26):
  // the service plane was started despite (potentially) unclean DB parity —
  // freeze the divergent tables onto the NEW run's decision log so the API
  // reconcile can echo-classify its breaks. Mirrors the resume-time recording;
  // best-effort — a recording failure never blocks the start.
  if (plane === 'service' && scope.parityOverride) {
    try {
      const parity = await evaluateDataParityReadiness({
        projectId,
        architectureId: book.current_architecture_id ?? null,
        reads: deps.dataParityGateReads,
      });
      if (!parity.ok) {
        const divergentTables = [
          ...new Set(parity.reasons.flatMap((r) => r.tables ?? [])),
        ];
        await patchRunWithRetry(deps, projectId, runId, {
          decision_log_json: [
            ...(run.decision_log_json ?? []),
            {
              type: 'data_parity_override',
              at: new Date().toISOString(),
              parity_codes: parity.reasons.map((r) => r.code),
              divergent_tables: divergentTables,
              note:
                'Break-glass: started the service plane past the DB-plane ' +
                "data-parity gate. The plane's API reconcile runs under KNOWN " +
                'data divergence — its breaks are echo-classified against ' +
                'these tables.',
            },
          ],
        });
        trace.warn(
          `data-parity override RECORDED — ${divergentTables.length} divergent table(s) frozen for echo attribution`,
          { run: runId, project: scope.project },
        );
      }
    } catch (err) {
      logger.warn('[diag-gateway] migration_execution_driver start_override_record_failed', {
        projectId,
        runId,
        error: err instanceof Error ? err.message : 'unknown',
      });
    }
  }

  trace.runHeader(runId, scope.project, architectureId);
  trace.step(
    `migrate run started — ${dispatchSet.length} specs across ${phasedPlan.phases.length} plane(s): ` +
      phasedPlan.phases.map((p) => `${p.plane}(${p.descriptors.length})`).join(' -> '),
    {
      run: runId,
      project: scope.project,
      arch: architectureId,
    }
  );

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
 * The run's base behaviour, read back from the `run_base_mode` entry stamped
 * into `decision_log_json` at run creation (2026-08-12): 'integration' =
 * IVS builds the base per repo target as default branch + every remote
 * feature/* branch merged; 'fresh' = default branch; 'chain' (default,
 * incl. legacy runs with no stamp) = the base_spec lineage behaviour.
 */
export function runBaseModeOf(
  run: MigrationExecutionRun | null | undefined
): 'chain' | 'fresh' | 'integration' | 'mr' {
  const entries = (run?.decision_log_json ?? []).filter(
    (e) => e && (e as Record<string, unknown>).type === 'run_base_mode'
  );
  const last = entries.length > 0 ? (entries[entries.length - 1] as Record<string, unknown>) : null;
  const mode = last?.mode;
  return mode === 'integration' || mode === 'fresh' || mode === 'mr' ? mode : 'chain';
}

/**
 * The explicit base branch of an 'mr'-mode run (2026-08-15), read from the
 * same `run_base_mode` decision-log entry. Null for every other mode.
 */
export function runBaseBranchOf(
  run: MigrationExecutionRun | null | undefined
): string | null {
  const entries = (run?.decision_log_json ?? []).filter(
    (e) => e && (e as Record<string, unknown>).type === 'run_base_mode'
  );
  const last = entries.length > 0 ? (entries[entries.length - 1] as Record<string, unknown>) : null;
  const branch = last?.base_branch;
  return typeof branch === 'string' && branch.trim() !== '' ? branch : null;
}

/**
 * The last GOOD spec of a run: the highest-sequence item that reported
 * `implemented`/`deployed` and carries a spec_name (the `-r<n>` restamp of a
 * retried item included — the successful attempt's name IS the branch that
 * holds the good state). Null when the run has no successful item yet.
 *
 * NOTE (2026-08-12): no longer used for CROSS-RUN stage continuation — the
 * picked item's branch may never have existed (a zero-diff no-op spec is
 * honestly `implemented` with no branch), and a single lineage cannot carry
 * a prior stage's N sibling branches. Stage continuation uses the
 * integration base (see runBaseModeOf). Within-run chaining is unchanged.
 */
export function lastGoodSpecOfRun(
  run: MigrationExecutionRun | null | undefined
): string | null {
  const good = (run?.items ?? [])
    .filter(
      (i) =>
        (i.outcome === 'implemented' || i.outcome === 'deployed') &&
        (i.spec_name ?? '').trim() !== ''
    )
    .sort((a, b) => (a.sequence_position ?? 0) - (b.sequence_position ?? 0));
  return good.length > 0 ? (good[good.length - 1].spec_name as string) : null;
}

/**
 * Run-branch chaining (2026-08-06): the base spec for ONE item's dispatch.
 * Prefer the last GOOD item BEFORE this one within the run (so spec N's
 * worktree starts from spec N-1's commit — and a RETRY of spec N bases off
 * spec N-1's branch, never the failed attempt's wreckage); fall back to the
 * run-level `base_spec` persisted at creation (cross-run stage chaining);
 * null = default-branch base.
 */
export function chainBaseSpecForItem(
  run: MigrationExecutionRun | null | undefined,
  item: MigrationExecutionRunItem
): string | null {
  const pos = item.sequence_position ?? Number.MAX_SAFE_INTEGER;
  const priorGood = (run?.items ?? [])
    .filter(
      (i) =>
        i.id !== item.id &&
        (i.sequence_position ?? -1) < pos &&
        (i.outcome === 'implemented' || i.outcome === 'deployed') &&
        (i.spec_name ?? '').trim() !== ''
    )
    .sort((a, b) => (a.sequence_position ?? 0) - (b.sequence_position ?? 0));
  if (priorGood.length > 0) {
    return priorGood[priorGood.length - 1].spec_name as string;
  }
  const runBase = (run?.base_spec ?? '').trim();
  return runBase !== '' ? runBase : null;
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
  deps: MigrationDriverDeps,
  opts?: SpecDispatchOpts
): void {
  // Detached: do not await. Failures are handled inside runSpecSegment.
  void runSpecSegment(scope, run, item, descriptor, deps, opts).catch((error) => {
    logger.error('[diag-gateway] migration_execution_driver spec_runner_crashed', {
      projectId: scope.projectId,
      runId: run.id,
      runItemId: item.id,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  });
}

/** The identifier fields a spec-name uniqueness suffix can derive from. */
export interface SpecNameDescriptorIds {
  workItemId?: string | null;
  specGenerationId?: string | null;
  bookItemId?: string | null;
  sequencePosition?: number;
}

/**
 * Short, stable, filesystem-safe uniqueness suffix for a spec name, derived
 * from the item's most stable identifier: workItemId -> specGenerationId ->
 * bookItemId (last 8 alphanumerics), falling back to `p<sequencePosition>`
 * (always unique within a run). Live 2026-07-30: two book items titled
 * "migration spec" slugged to the SAME `<date>-<slug>` — the second worktree
 * allocation died on "branch is active in another worktree" and halted the
 * run. Keyed on stable ids so a RETRY of the same item resolves to the same
 * folder/branch (no accidental duplicate specs).
 */
export function specNameUniquenessSuffix(descriptor: SpecNameDescriptorIds): string {
  const id =
    descriptor.workItemId || descriptor.specGenerationId || descriptor.bookItemId || '';
  const alnum = id.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (alnum.length >= 4) return alnum.slice(-8);
  return `p${descriptor.sequencePosition ?? 0}`;
}

/**
 * Deterministic spec folder name (Option A, 2026-07-30): `<date>-<slug>` from
 * the book-item title. Replaces the shape-spec `folder` event — computed,
 * never parsed from LLM output, always safe-segment charset. With a
 * `descriptor` (2026-07-31) the per-item uniqueness suffix is appended —
 * `<date>-<slug>-<uid>` — so same-titled book items get distinct folders and
 * branches; without one the legacy `<date>-<slug>` shape is unchanged.
 */
export function deterministicSpecName(
  title: string,
  when: Date,
  descriptor?: SpecNameDescriptorIds
): string {
  const slug =
    (title || 'migration-spec')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60)
      .replace(/-+$/g, '') || 'migration-spec';
  const date = when.toISOString().slice(0, 10);
  const base = `${date}-${slug}`;
  return descriptor ? `${base}-${specNameUniquenessSuffix(descriptor)}` : base;
}

/**
 * The requirements body IVS materialises as planning/requirements.md: the
 * generated spec text with the `/agent-os:shape-spec ` command prefix
 * promoted to a markdown heading.
 */
export function requirementsFromGeneratedSpecText(text: string): string {
  const stripped = stripShapeSpecPrefix((text ?? '').trim());
  if (stripped === '') return '# Migration spec\n';
  return stripped.startsWith('#') ? stripped : `# ${stripped}`;
}

/**
 * The per-spec segment (Option A deterministic, 2026-07-30): compute the spec
 * folder name from the book-item title, send the generated spec text as the
 * materialisation payload, and submit the orchestration with the per-request
 * `callback_url` + `deploy_on_complete`, correlating the returned `job_id` to
 * the run-item. IVS writes planning/requirements.md itself — there is no
 * headless shaping turn, no auto-answered Q&A, and no folder detection (the
 * three seams behind every intermittent halt: wrong-path requirements.md,
 * the `<date>-<slug>` echo, and the cluster-1 double dispatch).
 * Per-item failure isolation: any failure halts THIS run cleanly and never
 * throws to the caller.
 */
/**
 * Dispatch options (Robustness R2, 2026-08-05). `retryAttempt` marks a
 * driver-scheduled RE-dispatch after a transient failure: attempt 2+ of the
 * same run-item. It flips two behaviours inside {@link runSpecSegment}:
 *   - the duplicate-dispatch precheck inverts (the item DOES carry the prior
 *     attempt's job_id/state — the only valid parked state is `pending`);
 *   - the spec folder/branch name gains a `-r<attempt>` suffix so the
 *     re-submit is neither swallowed by the IVS active-job dedup (which keys
 *     on the sorted spec_name set of QUEUED/RUNNING jobs — the dying prior
 *     job can still be RUNNING when the backoff elapses) nor killed by the
 *     worktree "branch is active in another worktree" lock the prior attempt
 *     may still hold.
 */
export interface SpecDispatchOpts {
  /** 2-based dispatch attempt number for a scheduled retry; absent = first try. */
  retryAttempt?: number;
}

export async function runSpecSegment(
  scope: MigrateScope,
  run: MigrationExecutionRun,
  item: MigrationExecutionRunItem,
  descriptor: DispatchDescriptor,
  deps: MigrationDriverDeps,
  opts?: SpecDispatchOpts
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

  // Dispatch idempotency (2026-07-31): re-read the item's CURRENT state and
  // no-op when it has already been dispatched — a duplicated kick (duplicate
  // advance, duplicate build-results callback, recovery race) must not submit
  // a second IVS job for the same spec (live 2026-07-30: two kicks ~19s apart;
  // the second job died minutes later on the worktree branch lock and halted
  // the run). Deliberately does NOT skip SUBMITTING-with-no-job_id — that is
  // the genuine "stuck mid-submit" state the boot-recovery sweep re-kicks;
  // the IVS-side active-job dedup makes that re-kick safe end-to-end. A
  // failed pre-read falls through and dispatches (never stall on a read
  // hiccup); the IVS dedup + worktree branch lock remain the backstops.
  let freshRun: MigrationExecutionRun | null = null;
  try {
    const fresh = await deps.getMigrationExecutionRun(projectId, runId);
    freshRun = fresh;
    const current = (fresh?.items ?? []).find((i) => i.id === runItemId);
    if (current) {
      // Robustness R2: a scheduled RETRY re-dispatch inverts this check — the
      // item legitimately carries the prior attempt's job_id (unclearable by
      // design until the new submit replaces it) and was parked back to
      // `pending` when the retry was armed. The only valid state to retry
      // FROM is that parked `pending`; anything else means another dispatch
      // (a duplicate timer, a boot-sweep re-arm racing the in-process timer)
      // already picked the item up — skip. The IVS active-job dedup keys on
      // spec_name, and both racers compute the SAME `-r<n>` suffixed name,
      // so even the residual race window correlates to one job.
      const alreadyDispatched = opts?.retryAttempt
        ? current.status !== RUN_ITEM_STATUS.PENDING ||
          (current.outcome !== null &&
            current.outcome !== undefined &&
            current.outcome !== '')
        : !!current.job_id ||
          current.status === RUN_ITEM_STATUS.SUBMITTED ||
          current.status === RUN_ITEM_STATUS.IMPLEMENTED ||
          current.status === RUN_ITEM_STATUS.DEPLOYED ||
          !!current.outcome;
      if (alreadyDispatched) {
        logger.info('[diag-gateway] migration_execution_driver spec_segment_skip_duplicate', {
          projectId,
          runId,
          runItemId,
          status: current.status ?? null,
          jobId: current.job_id ?? null,
          retryAttempt: opts?.retryAttempt ?? null,
        });
        return;
      }
    }
  } catch (error) {
    logger.warn('[diag-gateway] migration_execution_driver spec_segment_precheck_failed', {
      projectId,
      runId,
      runItemId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }

  await safePatchRun(deps, projectId, runId, { status: RUN_STATUS.DISPATCHING });

  // Robustness R2: a retry re-dispatch gets a distinct `-r<attempt>` folder +
  // branch so the IVS active-job dedup (spec_name-keyed) can never return the
  // dying prior job, and the prior attempt's worktree branch lock cannot kill
  // the retry. Attempt 1 keeps the stable deterministic name.
  const baseSpecName = deterministicSpecName(descriptor.title, new Date(), descriptor);
  const specName =
    opts?.retryAttempt && opts.retryAttempt >= 2
      ? `${baseSpecName}-r${opts.retryAttempt}`
      : baseSpecName;
  const requirementsText = requirementsFromGeneratedSpecText(
    descriptor.generatedSpecText
  );

  // Run-branch chaining (2026-08-06): base this spec's worktree branch off the
  // last GOOD spec's branch (fresh run-state read; the passed-in `run` snapshot
  // predates the previous item's outcome patch), falling back to the run-level
  // base_spec (cross-run stage chaining). A RETRY derives the same base — the
  // failed attempt has no successful outcome, so its wreckage is never chained.
  const chainBase = chainBaseSpecForItem(freshRun ?? run, item);
  // INTEGRATION base (2026-08-12): with no within-run prior good to chain
  // off, a run created in integration mode bases its FIRST worktree on the
  // default branch + every remote feature/* branch for the target (built by
  // IVS at allocation). Subsequent items chain within-run as before, so the
  // whole run still accumulates.
  const useIntegrationBase =
    !chainBase && runBaseModeOf(freshRun ?? run) === 'integration';
  // MR base (2026-08-15): the run's FIRST worktree (no within-run prior good
  // to chain off) sits on the DB assembly branch resolved at run creation;
  // subsequent items chain within-run as before.
  const mrBaseBranch =
    !chainBase && runBaseModeOf(freshRun ?? run) === 'mr'
      ? runBaseBranchOf(freshRun ?? run)
      : null;

  // Stamp the computed spec_name; SUBMITTING (no ANSWERING phase any more —
  // the boot-recovery sweep re-kicks submitting-with-no-job_id as before).
  await safePatchItem(deps, projectId, runItemId, {
    status: RUN_ITEM_STATUS.SUBMITTING,
    spec_name: specName,
  });

  // Submit the orchestration server-to-server with the materialisation
  // payload. Step 4 (/git-commit-preparation) runs once per run: only the
  // final item (deploy_on_complete marker) asks for it.
  // WS2 (2026-07-31): db-plane items never haibox-deploy — the DB execution
  // chain takes over on `implemented`. The AMS item keeps
  // deploy_on_complete=true as the plane-final marker; only the IVS flag is
  // decoupled (kills the bogus "deploy failed: no target serve spec" error
  // on every db-plane final item).
  const itemPlane = descriptor.plane ?? planeForWorkstream(descriptor.workstream);
  // A haibox deploy exists to serve the API reconcile over the plane's
  // endpoints (2026-09-05). A plane-final SERVICE item whose plane bears no
  // endpoint at all (a scaffold-only batch) has nothing to reconcile, so the
  // deploy is not requested: the item completes at `implemented` and the plane
  // boundary is handled without a reconcile (see advanceRunOnBuildResult). The
  // old rule keyed the deploy on "last item of the plane" alone, so a deploy
  // that could not run (no container runtime here) halted a run in which
  // implement succeeded, tests passed and the MR was raised. The check is
  // POSITIVE: the deploy is skipped only when the plane's items are all known
  // to be endpoint-free; unknown (hand-built descriptor, unreadable book)
  // keeps the deploy.
  const planeEndpointFree =
    itemPlane === 'service' &&
    descriptor.hasEndpointIds === false &&
    (item.deploy_on_complete ?? false) &&
    !(await planeHasEndpointBearingItem(scope, run, item, itemPlane, deps));
  if (planeEndpointFree) {
    logger.info('[diag-gateway] migration_execution_driver deploy_skipped_endpoint_free_plane', {
      projectId,
      runId,
      runItemId,
      plane: itemPlane,
    });
  }
  const wantsHaiboxDeploy = (item.deploy_on_complete ?? false) && itemPlane !== 'db' && !planeEndpointFree;
  // Run-branch chaining (2026-08-06): with chained branches the STAGE-FINAL
  // branch carries the whole chain's diff — only it opens the ONE MR.
  // Non-final items commit + push MR-less. DB-plane items ALL suppress: the
  // assembly job (assemble-run) opens the db pack's single MR.
  const openMergeRequest = (item.deploy_on_complete ?? false) && itemPlane !== 'db';
  // Stage-2 (2026-07-31; hardened 2026-08-07): a service-plane deploy needs
  // the serve spec the operator registered in the Start-stage dialog. This
  // used to fail-SOFT (implement + MRs, no deploy) — the plane then finished
  // 'implemented', the deploy/reconcile silently never happened, and the run
  // stranded with nothing telling the operator why. A missing serve spec on
  // the plane-final service item now HALTS at dispatch, before an implement
  // is wasted, with the exact remedy (register it, then Resume failed).
  let targetServeSpec: TargetServeSpec | undefined;
  if (wantsHaiboxDeploy && itemPlane === 'service') {
    const getServeSpec =
      deps.getTargetServeSpec ??
      ((id: string) => migrationTargetCredentialsStore.getService(id));
    targetServeSpec = getServeSpec(runId);
    if (!targetServeSpec) {
      await haltRunForItem(deps, scope, runId, runItemId, item, RUN_ITEM_STATUS.FAILED,
        'The target-service serve spec is NOT registered for this run: the plane-final ' +
          'service item must deploy and run the API reconcile, which is impossible ' +
          'without it. Register the Target service (command + health path) in the ' +
          'Start-stage dialog, then use Resume failed — nothing was dispatched.');
      return;
    }
  }
  // SCL first-commit delivery (spec 10, 2026-08-18): an SCL corpus story's
  // dispatch generates its behaviour suite DETERMINISTICALLY and attaches it
  // as initial_commit_files — IVS commits the suite (+ scl-suite-manifest.json)
  // as the branch's FIRST commit, before any implementer work. FAIL-SOFT:
  // a generation failure dispatches WITHOUT initial files + a LOUD warn + a
  // decision-log warning entry; non-SCL stories are byte-identical.
  let sclInitialCommit: SclInitialCommit | null = null;
  if (isSclDispatchStory({ tags: descriptor.tags ?? [] })) {
    try {
      const book = await deps.fetchBookOfWork(projectId, scope.bookId);
      const buildCommit = deps.buildSclInitialCommit ?? buildSclInitialCommit;
      sclInitialCommit = await buildCommit({
        projectId,
        currentArchitectureId: book?.current_architecture_id ?? '',
        targetArchitectureId: book?.target_architecture_id ?? null,
        story: {
          title: descriptor.title,
          tags: descriptor.tags ?? [],
          sclContractKeys: descriptor.sclContractKeys ?? null,
          sclLayer: descriptor.sclLayer ?? null,
          sclControllerClass: descriptor.sclControllerClass ?? null,
        },
      });
      logger.info('[diag-gateway] migration_execution_driver scl_suite_attached', {
        projectId,
        runId,
        runItemId,
        specName,
        files: sclInitialCommit.files.length,
        suiteTests: sclInitialCommit.suiteTestCount,
        basePackage: sclInitialCommit.basePackage,
        warnings: sclInitialCommit.warnings,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown';
      logger.warn('[diag-gateway] migration_execution_driver scl_suite_generation_failed', {
        projectId,
        runId,
        runItemId,
        specName,
        error: reason,
      });
      // Warning recorded where dispatch decisions live today: the run's
      // decision log (best-effort — the dispatch itself proceeds).
      await safePatchRun(deps, projectId, runId, {
        decision_log_json: [
          ...((freshRun ?? run).decision_log_json ?? []),
          {
            type: SCL_SUITE_GENERATION_FAILED_LOG_TYPE,
            run_item_id: runItemId,
            spec_name: specName,
            reason,
            at: new Date().toISOString(),
          },
        ],
      });
      sclInitialCommit = null;
    }
  }

  let submit: OrchestrationSubmitResult;
  try {
    submit = await deps.submitOrchestration({
      company: scope.company,
      project: scope.project,
      specName,
      requirementsText,
      commitPreparation: item.deploy_on_complete === true,
      deployOnComplete: wantsHaiboxDeploy,
      ...(targetServeSpec ? { targetServeSpec } : {}),
      ...(chainBase ? { baseSpec: chainBase } : {}),
      ...(useIntegrationBase ? { integrationBase: true } : {}),
      ...(mrBaseBranch ? { baseBranch: mrBaseBranch } : {}),
      ...(sclInitialCommit
        ? {
            initialCommitFiles: sclInitialCommit.files,
            initialCommitMessage: sclInitialCommit.message,
          }
        : {}),
      openMergeRequest,
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
    specName,
    deployOnComplete: item.deploy_on_complete ?? false,
    baseSpec: chainBase,
    integrationBase: useIntegrationBase,
    openMergeRequest,
  });

  trace.step(
    `spec dispatched — ${specName}` +
      (chainBase
        ? ` (chained off ${chainBase})`
        : useIntegrationBase
          ? ' (base: integration — default branch + remote feature/* branches)'
          : ' (base: default branch)'),
    {
      run: runId,
      job: submit.jobId,
      project: scope.project,
    }
  );
}

// ============================================================================
// Batch dispatch (subset migrate -> ONE branch)
// ============================================================================

/**
 * Kick the detached batch runner: materialise ALL selected specs
 * deterministically, then ONE batched submit (one branch). Like
 * {@link kickSpecRunner} it never throws.
 */
export function kickBatchRunner(
  scope: MigrateScope,
  run: MigrationExecutionRun,
  items: MigrationExecutionRunItem[],
  descriptors: DispatchDescriptor[],
  deps: MigrationDriverDeps,
  opts?: SpecDispatchOpts
): void {
  void runBatchSegment(scope, run, items, descriptors, deps, opts).catch((error) => {
    logger.error('[diag-gateway] migration_execution_driver batch_runner_crashed', {
      projectId: scope.projectId,
      runId: run.id,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  });
}

/**
 * The batch segment (subset migrate, Option A deterministic 2026-07-30):
 * compute every selected spec's folder name + materialisation payload, then
 * submit them all as ONE coupled batch (`batch_name` -> one
 * `feature/<batch_name>` branch, one MR). IVS materialises each folder and
 * runs /git-commit-preparation once, on the batch's final spec. The single
 * job_id is correlated onto ALL run-items; the one build-results callback
 * completes the whole batch.
 */
export async function runBatchSegment(
  scope: MigrateScope,
  run: MigrationExecutionRun,
  items: MigrationExecutionRunItem[],
  descriptors: DispatchDescriptor[],
  deps: MigrationDriverDeps,
  opts?: SpecDispatchOpts
): Promise<void> {
  const { projectId } = scope;
  const runId = run.id as string;
  const batchName = (scope.batchName ?? '').trim();

  await safePatchRun(deps, projectId, runId, { status: RUN_STATUS.DISPATCHING });

  const ordered = items
    .slice()
    .sort((a, b) => (a.sequence_position ?? 0) - (b.sequence_position ?? 0));

  // Phase 1 (Option A deterministic, 2026-07-30): compute every spec's
  // folder name from its book-item title and carry the generated spec text
  // as the materialisation payload — no shaping turns, no auto-answering.
  const resolved: Array<{
    item: MigrationExecutionRunItem;
    specName: string;
    requirementsText: string;
  }> = [];
  for (const item of ordered) {
    const runItemId = item.id as string;
    const descriptor = descriptors.find((d) => d.sequencePosition === item.sequence_position);
    if (!descriptor) {
      await haltRunForItem(deps, scope, runId, runItemId, item, RUN_ITEM_STATUS.FAILED,
        'Could not resolve generated_spec_text for a batched spec.');
      return;
    }
    // Robustness R2: same `-r<attempt>` suffix rule as the per-spec path — a
    // batch retry must not be swallowed by the IVS spec_name-set dedup while
    // the prior batch job is still winding down.
    const baseSpecName = deterministicSpecName(descriptor.title, new Date(), descriptor);
    const specName =
      opts?.retryAttempt && opts.retryAttempt >= 2
        ? `${baseSpecName}-r${opts.retryAttempt}`
        : baseSpecName;
    await safePatchItem(deps, projectId, runItemId, {
      status: RUN_ITEM_STATUS.SUBMITTING,
      spec_name: specName,
    });
    resolved.push({
      item,
      specName,
      requirementsText: requirementsFromGeneratedSpecText(descriptor.generatedSpecText),
    });
  }

  if (resolved.length === 0) {
    await safePatchRun(deps, projectId, runId, { status: RUN_STATUS.HALTED });
    return;
  }

  // Phase 2: ONE batched submit (one branch). deploy_on_complete=true -> the
  // subset deploys big-bang and a single `deployed` callback completes the run
  // (same deploy + reconcile semantics as a whole-book migrate).
  const submitBatch = deps.submitOrchestrationBatch ?? submitOrchestrationBatch;
  // WS2 (2026-07-31): a db-plane batch never haibox-deploys — the DB
  // execution chain takes over on `implemented`.
  const batchDeploys = !descriptors.every(
    (d) => (d.plane ?? planeForWorkstream(d.workstream)) === 'db'
  );
  const batchHasServicePlane = descriptors.some(
    (d) => (d.plane ?? planeForWorkstream(d.workstream)) === 'service'
  );
  // Stage-2 (2026-07-31; hardened 2026-08-07): attach the operator-registered
  // serve spec so the batch deploy can actually launch the service. Missing =
  // HALT before the submit (mirrors the per-spec path) — a batch that
  // implements but can never deploy/reconcile is a silent strand, not a
  // migration.
  let batchServeSpec: TargetServeSpec | undefined;
  if (batchDeploys && batchHasServicePlane) {
    const getServeSpec =
      deps.getTargetServeSpec ??
      ((id: string) => migrationTargetCredentialsStore.getService(id));
    batchServeSpec = getServeSpec(runId);
    if (!batchServeSpec) {
      await haltBatch(deps, scope, runId, resolved.map((r) => r.item),
        'The target-service serve spec is NOT registered for this run: the batch must ' +
          'deploy and run the API reconcile, which is impossible without it. Register ' +
          'the Target service (command + health path) in the Start-stage dialog, then ' +
          'use Resume failed — nothing was dispatched.');
      return;
    }
  }
  let submit: OrchestrationSubmitResult;
  try {
    submit = await submitBatch({
      company: scope.company,
      project: scope.project,
      specs: resolved.map((r) => ({
        specName: r.specName,
        requirementsText: r.requirementsText,
      })),
      batchName,
      deployOnComplete: batchDeploys,
      ...(batchServeSpec ? { targetServeSpec: batchServeSpec } : {}),
      // Run-branch chaining (2026-08-06): base the ONE batch branch off the
      // cross-run base resolved at run creation (batch specs already share a
      // tree/branch within the job — only the cross-run base applies here).
      ...((run.base_spec ?? '').trim() !== '' ? { baseSpec: run.base_spec } : {}),
      // INTEGRATION base (2026-08-12): stage continuation without a lineage
      // base — IVS builds default branch + db-migration/* + feature/* merged.
      ...((run.base_spec ?? '').trim() === '' && runBaseModeOf(run) === 'integration'
        ? { integrationBase: true }
        : {}),
      // MR base (2026-08-15): the batch branch sits on the DB assembly branch.
      ...((run.base_spec ?? '').trim() === '' && runBaseModeOf(run) === 'mr'
        ? { baseBranch: runBaseBranchOf(run) ?? undefined }
        : {}),
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
// Operator halt (abandon a stranded run)
// ============================================================================

/** Outcome of an operator-requested run halt. */
export type OperatorHaltResult =
  | { status: 'halted'; runId: string; itemsFailed: number }
  | { status: 'already_terminal'; runId: string; runStatus: string }
  | { status: 'not_found' };

const RUN_TERMINAL_STATUSES = new Set<string>([
  RUN_STATUS.HALTED,
  RUN_STATUS.DEPLOYED,
  RUN_STATUS.FAILED,
]);

const ITEM_TERMINAL_STATUSES = new Set<string>([
  RUN_ITEM_STATUS.IMPLEMENTED,
  RUN_ITEM_STATUS.DEPLOYED,
  RUN_ITEM_STATUS.FAILED,
  RUN_ITEM_STATUS.REJECTED,
]);

/**
 * Operator "halt run" (2026-07-28): abandon a run wedged in a non-terminal
 * status so a fresh Start is possible. The live shape that motivated it: the
 * orchestration submit was ACCEPTED (job_id correlated, item `submitted`),
 * then the IVS job died before its pipeline ran and — pre-fix — never
 * delivered a failure callback, so the run sat in an active-looking status
 * forever and the execution rail (correctly) refused a new Start.
 *
 * Marks every non-terminal item failed with the operator reason, then halts
 * the run. An already-terminal run is reported as such, never re-patched.
 */
export async function haltMigrationRunByOperator(
  projectId: string,
  runId: string,
  deps: MigrationDriverDeps,
  reason?: string
): Promise<OperatorHaltResult> {
  const run = await deps.getMigrationExecutionRun(projectId, runId);
  if (!run) return { status: 'not_found' };
  const runStatus = (run.status ?? '') as string;
  if (RUN_TERMINAL_STATUSES.has(runStatus)) {
    return { status: 'already_terminal', runId, runStatus };
  }
  const detail =
    reason && reason.trim() !== ''
      ? `Halted by operator: ${reason.trim()}`
      : 'Halted by operator';
  let itemsFailed = 0;
  for (const item of run.items ?? []) {
    if (!item.id) continue;
    if (ITEM_TERMINAL_STATUSES.has((item.status ?? '') as string)) continue;
    await safePatchItem(deps, projectId, item.id, {
      status: RUN_ITEM_STATUS.FAILED,
      outcome: 'failed',
      error_detail: detail,
    });
    itemsFailed += 1;
  }
  await safePatchRun(deps, projectId, runId, { status: RUN_STATUS.HALTED });
  logger.info('[diag-gateway] migration_execution_driver operator_halt', {
    projectId,
    runId,
    previousStatus: runStatus,
    itemsFailed,
  });
  return { status: 'halted', runId, itemsFailed };
}

// ============================================================================
// Event-driven advance (consumed by the Group 3 build-results door)
// ============================================================================

/** The advance decision the build-results door reports back. */
export type AdvanceDecision =
  | 'advanced_next_dispatched'
  | 'advanced_run_complete'
  | 'deployed_recorded'
  | 'awaiting_approval'
  | 'halted'
  | 'noop_idempotent'
  | 'run_item_not_found'
  // WS2 (2026-07-31): the last db-plane item implemented -> the DB execution
  // chain (assemble -> schema apply -> load -> reconcile) was kicked detached.
  | 'db_completion_chain_started'
  // Robustness R2 (2026-08-05): a transient failure was ABSORBED — the run was
  // NOT halted; a re-dispatch of the same spec is scheduled after the backoff.
  | 'retry_scheduled';

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
  /** Delivered branch (2026-09-05): folded from the IVS callback's spec_git. */
  branch?: string | null;
  company: string;
  project: string;
  jobId: string;
  outcome: BuildResultOutcome;
  prUrl?: string | null;
  targetBaseUrl?: string | null;
  summary?: string | null;
  /**
   * The IVS run's error detail list (gold standard 2026-08-07): previously
   * the callback door had no `errors` field at all, so the exact diagnostics
   * explaining a failed/stranded run (push failure, missing serve spec, gate
   * failure) were silently discarded at the door. Folded into the halt
   * message and the transient-signature scan.
   */
  errors?: string[] | null;
  /**
   * Robustness R1 (2026-08-05): the IVS orchestrator's failure classification
   * ('transient_upstream' | 'real'), when the callback carried one. Absent on
   * older IVS builds -> the driver's local signature scan decides.
   */
  failureClass?: string | null;
  /** Robustness R1: the 1-based pipeline step that fataled, when known. */
  failedStep?: number | null;
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
  // Normalised-identifier enforcement (2026-07-27): the callback door passes
  // company/project through from the external service for traceability — and
  // dispatch-next re-enters the IVS workspace with THIS scope.
  const scope: MigrateScope = normalizeScopeIdentifiers({
    projectId,
    bookId: run.book_of_work_id ?? '',
    company: input.company,
    project: input.project,
  });

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

  // Record where the work LANDED before deciding anything about the outcome
  // (2026-09-05). A deploy failure after a successful push + MR used to leave
  // the item with branch/pr_url null: the deployed/implemented paths wrote
  // pr_url but every terminal-failure path (haltRunForItem / batch halts) wrote
  // only status + outcome + error_detail, and `branch` was never written for a
  // service-plane item on ANY path. The pointers are facts about delivery,
  // independent of whether the deploy afterwards succeeded.
  await recordDeliveredArtefacts(deps, projectId, runItemId, input);

  // Any terminal outcome that is not implemented/deployed halts the run —
  // UNLESS it is a TRANSIENT upstream failure with retry budget left
  // (Robustness R2, 2026-08-05): then the driver absorbs it and schedules a
  // re-dispatch of the SAME spec instead of stranding the whole run on a
  // backend blip. The external service reports `error` (build error) on the
  // job path and may report `fix_unserved` / `not_fixed` on the bug path; all
  // fold here. Only `rejected` takes the REJECTED status -- everything else is
  // FAILED. The raw outcome is preserved on the run-item record for
  // traceability.
  if (outcome !== 'implemented' && outcome !== 'deployed') {
    // Duplicate-callback guard for an ALREADY-ARMED retry: the transient
    // branch deliberately leaves `outcome` NULL (a terminal outcome would
    // drop the retry's own callback at the CD-6 guard above), so the standard
    // idempotency check cannot see it. The parked shape (status back to
    // pending + a scheduled next attempt) identifies it instead.
    if (
      item.status === RUN_ITEM_STATUS.PENDING &&
      !!item.retry_next_attempt_at &&
      (item.retry_attempt_count ?? 0) > 0
    ) {
      logger.info('[diag-gateway] migration_execution_driver advance_noop_retry_armed', {
        projectId,
        jobId,
        runItemId,
        retryAttemptCount: item.retry_attempt_count ?? 0,
      });
      return 'noop_idempotent';
    }

    // Attempts used INCLUDING the dispatch whose failure we are judging: the
    // persisted counter records prior transiently-failed attempts, so the
    // original dispatch's first failure arrives with attemptsUsed = 1.
    const attemptsUsed = (item.retry_attempt_count ?? 0) + 1;
    // Fold the IVS error detail into the failure text (2026-08-07): the
    // summary is often absent while `errors` carries the real diagnosis —
    // it feeds both the transient-signature scan and the halt message.
    const errorDetailText =
      (input.errors ?? []).filter((e) => typeof e === 'string' && e.trim() !== '').join('; ') ||
      null;
    const failureText = input.summary ?? errorDetailText;
    const retryDecision = shouldAutoRetry({
      outcome,
      failureClass: input.failureClass ?? null,
      summary: failureText,
      attemptCount: attemptsUsed,
    });
    if (retryDecision.retry) {
      return await scheduleTransientSpecRetry(
        input,
        scope,
        runId,
        item,
        attemptsUsed,
        retryDecision.reason,
        deps
      );
    }

    trace.fail(`build-results: ${outcome}`, {
      run: runId,
      job: jobId,
      project: scope.project,
    });
    // Exhausted-transient vs real: persist the class for traceability + the
    // FE. An explicit IVS class wins; otherwise only a positive local
    // transient match is recorded (an unmatched scan proves nothing).
    const haltClass =
      input.failureClass ??
      (retryDecision.transient ? FAILURE_CLASS_TRANSIENT : null);
    await haltRunForItem(
      deps,
      scope,
      runId,
      runItemId,
      item,
      outcome === 'rejected' ? RUN_ITEM_STATUS.REJECTED : RUN_ITEM_STATUS.FAILED,
      retryDecision.transient
        ? `${failureText ?? `Build-results reported ${outcome}`} (transient upstream failure; retry budget exhausted after ${attemptsUsed} tries)`
        : failureText ?? `Build-results reported ${outcome}`,
      outcome,
      haltClass
    );
    return 'halted';
  }

  // SCL shipped-suite integrity + quarantine thresholds (spec 10, 2026-08-18):
  // an SCL story's success callback first runs the no-modification guard +
  // contest-threshold circuit breakers against the branch's shipped manifest.
  // FAIL-SOFT for every non-SCL story and on any read hiccup (the advance is
  // never broken by the integrity layer); a fired threshold HALTS here.
  const sclHalted = await applySclSuiteVerdict(input, scope, run, item, deps);
  if (sclHalted) return 'halted';

  if (outcome === 'deployed') {
    // A plane's LAST build item deployed (Spec W phased execution). Record the
    // item deployed, then decide: is this the FINAL plane, or a mid-run plane
    // boundary that must PAUSE for human approval?
    await safePatchItem(deps, projectId, runItemId, {
      status: RUN_ITEM_STATUS.DEPLOYED,
      outcome: 'deployed',
      target_base_url: input.targetBaseUrl ?? null,
      pr_url: input.prUrl ?? null,
      ...(input.branch ? { branch: input.branch } : {}),
    });

    // Pending items still exist => a later plane awaits => this is a plane
    // boundary, not the end of the run.
    const hasPendingLater = (run.items ?? []).some(
      (i) => i.id !== runItemId && i.status === RUN_ITEM_STATUS.PENDING
    );
    let completedPlane: MigrationPlane;
    try {
      completedPlane = await resolveItemPlane(scope, run, item, deps);
    } catch (error) {
      // Fail-closed (2026-08-07): guessing 'service' here picked the WRONG
      // reconcile (or skipped the DB chain) silently. The deploy itself
      // succeeded — halt the run with the reason; Resume failed re-dispatches.
      await haltRunForItem(deps, scope, runId, runItemId, item, RUN_ITEM_STATUS.FAILED,
        `The deployed item's plane could not be resolved — the driver cannot choose the ` +
          `plane's reconcile/pause semantics (${error instanceof Error ? error.message : 'unknown'}). ` +
          'The deploy itself succeeded; fix the AMS book/run consistency, then Resume failed.',
        'deployed');
      return 'halted';
    }

    if (hasPendingLater) {
      // HARD PAUSE (Spec W §2.9): run the completed plane's reconcile, then set
      // the run awaiting_approval. The next plane dispatches only on the human's
      // "approve & continue" (resumeMigration). Do NOT auto-advance.
      await safePatchRun(deps, projectId, runId, {
        status: RUN_STATUS.AWAITING_APPROVAL,
        target_base_url: input.targetBaseUrl ?? null,
      });
      logger.info('[diag-gateway] migration_execution_driver plane_paused', {
        projectId,
        runId,
        runItemId,
        plane: completedPlane,
      });
      trace.warn(`plane ${completedPlane} deployed — reconcile + PAUSE for approval`, {
        run: runId,
        job: jobId,
        project: scope.project,
      });
      kickPlaneReconcile(scope, runId, completedPlane, deps);
      return 'awaiting_approval';
    }

    // FINAL plane: mark the run deployed + run the final plane's reconcile.
    await safePatchRun(deps, projectId, runId, {
      status: RUN_STATUS.DEPLOYED,
      target_base_url: input.targetBaseUrl ?? null,
    });
    logger.info('[diag-gateway] migration_execution_driver run_deployed', {
      projectId,
      runId,
      runItemId,
      targetBaseUrl: input.targetBaseUrl ?? null,
      finalPlane: completedPlane,
    });
    trace.ok(`run deployed — ${input.targetBaseUrl ?? '(no target_base_url)'}`, {
      run: runId,
      job: jobId,
      project: scope.project,
    });
    kickPlaneReconcile(scope, runId, completedPlane, deps);
    return 'deployed_recorded';
  }

  // outcome === 'implemented'
  await safePatchItem(deps, projectId, runItemId, {
    status: RUN_ITEM_STATUS.IMPLEMENTED,
    outcome: 'implemented',
    pr_url: input.prUrl ?? null,
    ...(input.branch ? { branch: input.branch } : {}),
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

  // WS2 (2026-07-31): `implemented` on the item carrying the plane-final
  // marker (deploy_on_complete) means the DB plane just finished BUILDING —
  // a DB pack can never produce a haibox `deployed` outcome (nothing to
  // serve), so this is where the DB execution chain takes over: assemble the
  // branches + pack, apply the schema, load the data, reconcile, then pause
  // on the parity report. Detached; failures land on the run state.
  if (item.deploy_on_complete === true) {
    let plane: MigrationPlane;
    try {
      plane = await resolveItemPlane(scope, run, item, deps);
    } catch (error) {
      // Fail-closed (2026-08-07): the old 'service' default SKIPPED the DB
      // execution chain when the plane read hiccuped — the run then completed
      // with the schema never applied. The implement succeeded; halt with the
      // reason so the operator resumes once AMS is consistent.
      await haltRunForItem(deps, scope, runId, runItemId, item, RUN_ITEM_STATUS.FAILED,
        `The implemented item's plane could not be resolved — the driver cannot decide ` +
          `whether the DB execution chain owns completion (${error instanceof Error ? error.message : 'unknown'}). ` +
          'The implement itself succeeded; fix the AMS book/run consistency, then Resume failed.',
        'implemented');
      return 'halted';
    }
    if (plane === 'db') {
      kickDbPlaneCompletion(scope, run, item, deps);
      return 'db_completion_chain_started';
    }
    if (plane === 'service') {
      // The plane-final service item came back `implemented`, not `deployed`:
      // no deploy was performed (an endpoint-free plane does not request one;
      // a FAILED deploy reports `error`, never `implemented`). There is nothing
      // to reconcile, so the plane boundary is honoured WITHOUT a reconcile: a
      // later plane means PAUSE for approval exactly as a deployed plane
      // would; the final plane completes the run at implemented.
      const hasPendingLater = (run.items ?? []).some(
        (i) => i.id !== runItemId && i.status === RUN_ITEM_STATUS.PENDING
      );
      logger.info('[diag-gateway] migration_execution_driver plane_complete_no_reconcile', {
        projectId,
        runId,
        runItemId,
        plane,
        hasPendingLater,
      });
      if (hasPendingLater) {
        await safePatchRun(deps, projectId, runId, { status: RUN_STATUS.AWAITING_APPROVAL });
        trace.warn(`plane ${plane} implemented — no endpoint to reconcile; PAUSE for approval`, {
          run: runId,
          job: jobId,
          project: scope.project,
        });
        return 'awaiting_approval';
      }
      trace.ok(`plane ${plane} implemented — no endpoint to reconcile; run complete`, {
        run: runId,
        job: jobId,
        project: scope.project,
      });
    }
  }

  // Advance the run position + dispatch the next pending spec. If this was the
  // final spec, the run is fully implemented; the submit that carried
  // deploy_on_complete handles the deploy (a `deployed` callback will follow).
  return await dispatchNext(scope, run, item, deps);
}

/**
 * Record the delivered branch / MR on a run item regardless of outcome
 * (2026-09-05). Idempotent and fail-soft: no-ops when the callback carried
 * neither pointer.
 */
async function recordDeliveredArtefacts(
  deps: MigrationDriverDeps,
  projectId: string,
  runItemId: string,
  input: Pick<BuildResultAdvanceInput, 'prUrl' | 'branch'>
): Promise<void> {
  const patch: { pr_url?: string; branch?: string } = {};
  if (typeof input.prUrl === 'string' && input.prUrl.trim() !== '') patch.pr_url = input.prUrl;
  if (typeof input.branch === 'string' && input.branch.trim() !== '') patch.branch = input.branch;
  if (Object.keys(patch).length === 0) return;
  await safePatchItem(deps, projectId, runItemId, patch);
}

/**
 * Does ANY run item of `plane` map to a book item that lists committed
 * endpoint ids? Returns TRUE when it cannot tell (book unreadable, no run item
 * of the plane resolves to a book item) -- unknown keeps the deploy; only a
 * POSITIVELY endpoint-free plane skips it.
 */
async function planeHasEndpointBearingItem(
  scope: MigrateScope,
  run: MigrationExecutionRun,
  item: MigrationExecutionRunItem,
  plane: MigrationPlane,
  deps: MigrationDriverDeps
): Promise<boolean> {
  const bookId = run.book_of_work_id ?? scope.bookId;
  if (!bookId) return true;
  let bookItems: Array<Record<string, unknown>>;
  try {
    const book = await deps.fetchBookOfWork(scope.projectId, bookId);
    bookItems = ((book?.book_of_work_json?.items ?? []) as unknown[]).filter(
      (bi): bi is Record<string, unknown> => !!bi && typeof bi === 'object'
    );
  } catch {
    return true;
  }
  const workItemIds = new Set(
    (run.items ?? [])
      .map((i) => i.work_item_id)
      .filter((id): id is string => typeof id === 'string' && id !== '')
  );
  if (item.work_item_id) workItemIds.add(item.work_item_id);
  let resolved = 0;
  for (const bi of bookItems) {
    const wid = typeof bi.workItemId === 'string' ? bi.workItemId : null;
    if (!wid || !workItemIds.has(wid)) continue;
    if (planeForItem(bi as unknown as Parameters<typeof planeForItem>[0]) !== plane) continue;
    resolved++;
    const ids = (bi as { apiEndpointIds?: unknown }).apiEndpointIds;
    if (Array.isArray(ids) && ids.length > 0) return true;
  }
  return resolved === 0; // nothing resolved = unknown = keep the deploy
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
    // Robustness R2: a TRANSIENT batch failure with budget left is absorbed —
    // the retry re-submits a batch containing ONLY the not-yet-implemented
    // siblings (the shared remaining-items primitive, the same one manual
    // resume uses). The duplicate-callback guard mirrors the single-item
    // path: an armed batch retry has every sibling parked pending with a
    // scheduled next attempt.
    const armedAlready = siblings.every(
      (s) =>
        s.status === RUN_ITEM_STATUS.PENDING &&
        !!s.retry_next_attempt_at &&
        (s.retry_attempt_count ?? 0) > 0
    );
    if (armedAlready) {
      logger.info('[diag-gateway] migration_execution_driver batch_noop_retry_armed', {
        projectId,
        runId,
        jobId,
      });
      return 'noop_idempotent';
    }
    // The batch shares ONE job -> one attempt counter; take the max across
    // siblings (they are patched together, so they only diverge if a patch
    // failed mid-arm — max is the safe, budget-respecting read).
    const attemptsUsed =
      Math.max(0, ...siblings.map((s) => s.retry_attempt_count ?? 0)) + 1;
    const retryDecision = shouldAutoRetry({
      outcome,
      failureClass: input.failureClass ?? null,
      summary: input.summary ?? null,
      attemptCount: attemptsUsed,
    });
    if (retryDecision.retry) {
      return await scheduleTransientBatchRetry(
        input,
        scope,
        runId,
        siblings,
        attemptsUsed,
        retryDecision.reason,
        deps
      );
    }

    trace.fail(`batch build-results: ${outcome}`, {
      run: runId,
      job: jobId,
      project: scope.project,
    });
    const status =
      outcome === 'rejected' ? RUN_ITEM_STATUS.REJECTED : RUN_ITEM_STATUS.FAILED;
    const haltClass =
      input.failureClass ??
      (retryDecision.transient ? FAILURE_CLASS_TRANSIENT : null);
    for (const s of siblings) {
      if (!s.id) continue;
      await safePatchItem(deps, projectId, s.id, {
        status,
        outcome,
        // Delivered-artefact pointers survive a halt (2026-09-05): the batch
        // shares one branch + MR, and a failed deploy does not un-deliver them.
        ...(input.prUrl ? { pr_url: input.prUrl } : {}),
        ...(input.branch ? { branch: input.branch } : {}),
        error_detail: input.summary ?? `Build-results reported ${outcome}`,
        ...(haltClass ? { failure_class: haltClass } : {}),
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
    // Belt-and-braces (2026-08-07, behind the mixed_plane_batch start refusal):
    // a deployed batch containing db-plane items means the haibox deploy ran
    // while the schema-apply → data-migration → parity chain NEVER did — the
    // old code marked those items DEPLOYED over an empty database. Halt loudly
    // instead (legacy in-flight runs predating the refusal can still arrive
    // here). Plane resolution failure is fail-closed too.
    let batchHasDbItems: boolean;
    try {
      batchHasDbItems = false;
      for (const s of siblings) {
        if ((await resolveItemPlane(scope, run, s, deps)) === 'db') {
          batchHasDbItems = true;
          break;
        }
      }
    } catch (error) {
      batchHasDbItems = true; // unresolvable = cannot prove it is safe
      logger.warn('[diag-gateway] migration_execution_driver batch_deploy_plane_unresolvable', {
        projectId,
        runId,
        jobId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
    if (batchHasDbItems) {
      for (const s of siblings) {
        if (!s.id) continue;
        await safePatchItem(deps, projectId, s.id, {
          status: RUN_ITEM_STATUS.FAILED,
          outcome: 'deployed',
          error_detail:
            'The batch deployed via haibox but contains db-plane stories (or stories whose ' +
            'plane could not be resolved) — their schema-apply/data-migration/parity chain ' +
            'never ran, so the deployed state is NOT trustworthy. Re-run the DB plane as its ' +
            'own per-plane Start.',
        });
      }
      await safePatchRun(deps, projectId, runId, { status: RUN_STATUS.HALTED });
      trace.fail('batch deployed with db-plane items — DB chain was bypassed; run halted', {
        run: runId,
        job: jobId,
        project: scope.project,
      });
      return 'halted';
    }
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

  // outcome === 'implemented' (db-plane batches EXPECT this: their submit
  // carries deployOnComplete=false — the DB chain deploys, not haibox)
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

  // WS2 (2026-07-31): a db-plane batch hands over to the DB execution chain
  // once its single job implements — same semantics as the per-spec path.
  const finalItem =
    siblings.find((s) => s.deploy_on_complete === true) ?? siblings[siblings.length - 1];
  if (finalItem) {
    let plane: MigrationPlane;
    try {
      plane = await resolveItemPlane(scope, run, finalItem, deps);
    } catch (error) {
      // Fail-closed (2026-08-07): guessing 'service' here silently skipped the
      // DB execution chain for a db-plane batch. The implement succeeded —
      // halt with the reason so the operator resumes once AMS is consistent.
      for (const s of siblings) {
        if (!s.id) continue;
        await safePatchItem(deps, projectId, s.id, {
          status: RUN_ITEM_STATUS.FAILED,
          error_detail:
            `The batch's plane could not be resolved — the driver cannot decide whether ` +
            `the DB execution chain owns completion (${error instanceof Error ? error.message : 'unknown'}). ` +
            'The implement itself succeeded; fix the AMS book/run consistency, then Resume failed.',
        });
      }
      await safePatchRun(deps, projectId, runId, { status: RUN_STATUS.HALTED });
      return 'halted';
    }
    if (plane === 'db') {
      kickDbPlaneCompletion(scope, run, finalItem, deps);
      return 'db_completion_chain_started';
    }
  }
  return 'advanced_run_complete';
}

// ============================================================================
// Robustness R2 (2026-08-05): transient auto-retry + resume-from-failure
// ============================================================================

/**
 * Arm a driver-level retry for a transiently-failed SINGLE-spec item instead
 * of halting the run. The item is parked back to `pending` with the persisted
 * retry state (attempt counter + next-attempt time + failure class) so the
 * schedule SURVIVES a gateway restart (the boot-recovery sweep re-arms it);
 * `outcome` is deliberately left NULL — a terminal outcome would make the
 * retry's own build-results callback hit the CD-6 idempotency no-op and be
 * dropped. The in-process timer then re-dispatches through the shared
 * remaining-items primitive.
 */
async function scheduleTransientSpecRetry(
  input: BuildResultAdvanceInput,
  scope: MigrateScope,
  runId: string,
  item: MigrationExecutionRunItem,
  attemptsUsed: number,
  reason: string,
  deps: MigrationDriverDeps
): Promise<AdvanceDecision> {
  const runItemId = item.id as string;
  const nextAttempt = attemptsUsed + 1;
  const max = maxRetryAttempts();
  const delayMs = backoffMsBeforeAttempt(nextAttempt);
  const nextAt = new Date(Date.now() + delayMs).toISOString();

  await safePatchItem(deps, scope.projectId, runItemId, {
    status: RUN_ITEM_STATUS.PENDING,
    retry_attempt_count: attemptsUsed,
    retry_next_attempt_at: nextAt,
    failure_class: input.failureClass ?? FAILURE_CLASS_TRANSIENT,
    error_detail:
      `Transient failure, retry ${nextAttempt}/${max} scheduled ` +
      `(${reason}; next attempt at ${nextAt}). ` +
      `Last failure: ${input.summary ?? `build-results reported ${input.outcome}`}`,
  });

  logger.warn('[diag-gateway] migration_execution_driver transient_retry_scheduled', {
    projectId: scope.projectId,
    runId,
    runItemId,
    jobId: input.jobId,
    attemptsUsed,
    nextAttempt,
    max,
    delayMs,
    reason,
  });
  trace.warn(
    `transient build failure absorbed — retry ${nextAttempt}/${max} in ${Math.round(delayMs / 1000)}s`,
    { run: runId, job: input.jobId, project: scope.project }
  );

  const timer = deps.scheduleRetryTimer ?? defaultScheduleRetryTimer;
  timer(delayMs, () => {
    void redispatchAfterTransientFailure(scope, runId, nextAttempt, deps).catch((error) => {
      logger.error('[diag-gateway] migration_execution_driver retry_redispatch_crashed', {
        projectId: scope.projectId,
        runId,
        runItemId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    });
  });
  return 'retry_scheduled';
}

/**
 * Arm a driver-level retry for a transiently-failed BATCH: every sibling is
 * parked back to `pending` with the shared retry state (the old shared job_id
 * is intentionally KEPT — it is how the re-dispatch recognises the batch
 * shape), and the timer re-submits a batch containing ONLY the items not yet
 * implemented/deployed via the same shared primitive manual resume uses.
 */
async function scheduleTransientBatchRetry(
  input: BuildResultAdvanceInput,
  scope: MigrateScope,
  runId: string,
  siblings: MigrationExecutionRunItem[],
  attemptsUsed: number,
  reason: string,
  deps: MigrationDriverDeps
): Promise<AdvanceDecision> {
  const nextAttempt = attemptsUsed + 1;
  const max = maxRetryAttempts();
  const delayMs = backoffMsBeforeAttempt(nextAttempt);
  const nextAt = new Date(Date.now() + delayMs).toISOString();

  for (const s of siblings) {
    if (!s.id) continue;
    await safePatchItem(deps, scope.projectId, s.id, {
      status: RUN_ITEM_STATUS.PENDING,
      retry_attempt_count: attemptsUsed,
      retry_next_attempt_at: nextAt,
      failure_class: input.failureClass ?? FAILURE_CLASS_TRANSIENT,
      error_detail:
        `Transient failure, retry ${nextAttempt}/${max} scheduled ` +
        `(${reason}; next attempt at ${nextAt}). ` +
        `Last failure: ${input.summary ?? `build-results reported ${input.outcome}`}`,
    });
  }

  logger.warn('[diag-gateway] migration_execution_driver transient_batch_retry_scheduled', {
    projectId: scope.projectId,
    runId,
    jobId: input.jobId,
    itemCount: siblings.length,
    attemptsUsed,
    nextAttempt,
    max,
    delayMs,
    reason,
  });
  trace.warn(
    `transient batch failure absorbed — retry ${nextAttempt}/${max} in ${Math.round(delayMs / 1000)}s (${siblings.length} specs)`,
    { run: runId, job: input.jobId, project: scope.project }
  );

  const timer = deps.scheduleRetryTimer ?? defaultScheduleRetryTimer;
  timer(delayMs, () => {
    void redispatchAfterTransientFailure(scope, runId, nextAttempt, deps).catch((error) => {
      logger.error('[diag-gateway] migration_execution_driver batch_retry_redispatch_crashed', {
        projectId: scope.projectId,
        runId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    });
  });
  return 'retry_scheduled';
}

/**
 * The retry timer/boot-sweep callback: re-read the run FRESH and, if the
 * armed-retry state still holds, re-dispatch through the shared
 * remaining-items primitive. Guards (fail-quiet, structured-logged):
 *   - the run must still exist and be NON-terminal (an operator halt during
 *     the backoff wins — never resurrect a halted/finished run);
 *   - at least one item must still be in the parked shape (pending +
 *     counter > 0 + next-attempt set); anything else means another dispatch
 *     (a racing timer, a boot re-arm) already took over.
 */
async function redispatchAfterTransientFailure(
  scope: MigrateScope,
  runId: string,
  retryAttempt: number,
  deps: MigrationDriverDeps
): Promise<void> {
  const run = await deps.getMigrationExecutionRun(scope.projectId, runId);
  if (!run) {
    logger.warn('[diag-gateway] migration_execution_driver retry_run_gone', { runId });
    return;
  }
  if (
    run.status === RUN_STATUS.HALTED ||
    run.status === RUN_STATUS.DEPLOYED ||
    run.status === RUN_STATUS.FAILED
  ) {
    logger.info('[diag-gateway] migration_execution_driver retry_skipped_run_terminal', {
      projectId: scope.projectId,
      runId,
      runStatus: run.status,
    });
    return;
  }
  const armed = (run.items ?? []).filter(
    (i) =>
      i.status === RUN_ITEM_STATUS.PENDING &&
      (i.retry_attempt_count ?? 0) > 0 &&
      !!i.retry_next_attempt_at
  );
  if (armed.length === 0) {
    logger.info('[diag-gateway] migration_execution_driver retry_skipped_not_armed', {
      projectId: scope.projectId,
      runId,
    });
    return;
  }
  logger.info('[diag-gateway] migration_execution_driver retry_redispatching', {
    projectId: scope.projectId,
    runId,
    retryAttempt,
    armedCount: armed.length,
  });
  await dispatchRemainingRunItems(scope, run, deps, { retryAttempt });
}

/**
 * The SHARED re-dispatch primitive (Robustness R2): dispatch everything in a
 * run that is not yet implemented/deployed. Both the transient auto-retry and
 * the manual resume-from-failure funnel through here so batch vs sequential
 * routing lives in exactly one place:
 *   - BATCH shape (>=2 remaining items sharing one non-null job_id, or an
 *     explicit `batchName`): ONE re-submitted batch containing only the
 *     remaining specs (a fresh `feature/<batchName>` branch — the failed
 *     branch is abandoned).
 *   - SEQUENTIAL shape: dispatch the FIRST remaining pending item; the normal
 *     callback-advance chain then walks the rest.
 * The job_id-sharing heuristic works because a batch submit correlates its
 * single job_id onto every sibling; the manual resume CLEARS job_ids during
 * its reset, so it detects batch-ness BEFORE resetting and passes the
 * explicit `batchName` instead.
 */
export async function dispatchRemainingRunItems(
  scope: MigrateScope,
  run: MigrationExecutionRun,
  deps: MigrationDriverDeps,
  opts: { retryAttempt?: number; batchName?: string | null } = {}
): Promise<{ mode: 'batch' | 'single' | 'none'; itemCount: number }> {
  const runId = run.id as string;
  const remaining = (run.items ?? [])
    .filter(
      (i) =>
        i.id &&
        i.status !== RUN_ITEM_STATUS.IMPLEMENTED &&
        i.status !== RUN_ITEM_STATUS.DEPLOYED &&
        i.outcome !== 'implemented' &&
        i.outcome !== 'deployed'
    )
    .sort((a, b) => (a.sequence_position ?? 0) - (b.sequence_position ?? 0));
  if (remaining.length === 0) {
    return { mode: 'none', itemCount: 0 };
  }

  const sharedJobId = remaining[0].job_id ?? null;
  const isBatchShape =
    !!opts.batchName ||
    (remaining.length > 1 &&
      !!sharedJobId &&
      remaining.every((i) => i.job_id === sharedJobId));

  if (isBatchShape) {
    // Resolve every remaining spec's descriptor up-front (whole-or-halt, the
    // same posture as the original batch segment).
    const descriptors: DispatchDescriptor[] = [];
    for (const item of remaining) {
      const descriptor = await resolveDescriptorForItem(scope, run, item, deps);
      if (!descriptor) {
        await haltRunForItem(deps, scope, runId, item.id as string, item, RUN_ITEM_STATUS.FAILED,
          'Could not resolve generated_spec_text for a re-dispatched batch spec.');
        return { mode: 'none', itemCount: 0 };
      }
      descriptors.push(descriptor);
    }
    const batchName =
      opts.batchName ??
      `retry-${(runId || 'run').replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase()}-r${opts.retryAttempt ?? 2}`;
    kickBatchRunner(
      { ...scope, batchName },
      run,
      remaining,
      descriptors,
      deps,
      opts.retryAttempt ? { retryAttempt: opts.retryAttempt } : undefined
    );
    logger.info('[diag-gateway] migration_execution_driver remaining_batch_redispatched', {
      projectId: scope.projectId,
      runId,
      itemCount: remaining.length,
      batchName,
      retryAttempt: opts.retryAttempt ?? null,
    });
    return { mode: 'batch', itemCount: remaining.length };
  }

  // Sequential: dispatch the FIRST remaining pending item only — the ordinary
  // callback-advance chain (dispatchNext) walks the rest one at a time.
  const next = remaining.find((i) => i.status === RUN_ITEM_STATUS.PENDING);
  if (!next || !next.id) {
    // Someone else is mid-flight on the front item (submitting/submitted) —
    // nothing for us to do; the in-flight dispatch owns the run.
    logger.info('[diag-gateway] migration_execution_driver remaining_no_pending_front', {
      projectId: scope.projectId,
      runId,
    });
    return { mode: 'none', itemCount: 0 };
  }
  const descriptor = await resolveDescriptorForItem(scope, run, next, deps);
  if (!descriptor) {
    await haltRunForItem(deps, scope, runId, next.id, next, RUN_ITEM_STATUS.FAILED,
      'Could not resolve generated_spec_text for the re-dispatched spec.');
    return { mode: 'none', itemCount: 0 };
  }
  await safePatchRun(deps, scope.projectId, runId, {
    status: RUN_STATUS.DISPATCHING,
    current_sequence_position: next.sequence_position ?? null,
  });
  kickSpecRunner(
    scope,
    run,
    next,
    descriptor,
    deps,
    opts.retryAttempt ? { retryAttempt: opts.retryAttempt } : undefined
  );
  logger.info('[diag-gateway] migration_execution_driver remaining_single_redispatched', {
    projectId: scope.projectId,
    runId,
    runItemId: next.id,
    sequencePosition: next.sequence_position,
    retryAttempt: opts.retryAttempt ?? null,
  });
  return { mode: 'single', itemCount: 1 };
}

/** Outcome of an operator deploy-only retry request (2026-09-06). */
export type RetryRunDeployResult =
  | { status: 'deploying'; runId: string; jobId: string; itemsReset: number }
  | { status: 'not_found' }
  | { status: 'not_retryable'; reason: string };

/**
 * Operator "retry the deploy only" (2026-09-06): re-deploy a HALTED run whose
 * specs were already implemented, committed, pushed and merge-requested,
 * WITHOUT re-running the pipeline that produced them.
 *
 * **The failure this answers.** A four-spec service-plane batch ran for four
 * hours, passed `mvn clean verify`, landed four commits on one branch and
 * opened one merge request -- then the deploy failed because a stale machine
 * environment variable pointed the served process at the wrong database.
 * Every run-item went `failed`, and the only supported recovery was
 * {@link resumeFailedMigrationRun}, which resets items to PENDING and re-runs
 * the specs. That rebuilds work which was never wrong. This path replays only
 * the deploy.
 *
 * **Why the items must be un-terminalled first.** The build-results door's
 * CD-6 idempotency guard drops any callback for an item already carrying a
 * terminal outcome, and `error` IS terminal. A fresh `deployed` callback would
 * therefore be acknowledged and then silently discarded. So the siblings are
 * put back into the exact shape a pending callback expects -- status
 * SUBMITTED, outcome and error cleared, **`job_id` deliberately RETAINED**
 * because it is the correlation key the replayed callback arrives on.
 *
 * **Ordering, and why the rollback exists.** State is reset BEFORE asking
 * IVS, because the callback can land the moment IVS accepts. If IVS then
 * refuses (its fail-closed check: no committed work, no serve spec, job still
 * in flight), the items would be stranded mid-flight waiting for a callback
 * that will never come -- so a refusal restores them to FAILED with the
 * refusal reason recorded. The run never silently drifts into a state
 * nothing will complete.
 *
 * **Whose judgement is whose.** The gateway decides only that the run is in a
 * shape worth retrying (halted, with failed items sharing a deploy job). IVS
 * owns the "was anything actually built" question, because only IVS holds
 * the commit records -- the gateway cannot tell a halted-with-commits run
 * from a halted-with-nothing one, and guessing would deploy an empty branch.
 */
export async function retryRunDeploy(
  scope: MigrateScope,
  runId: string,
  deps: MigrationDriverDeps
): Promise<RetryRunDeployResult> {
  scope = normalizeScopeIdentifiers(scope);
  const projectId = scope.projectId;
  const run = await deps.getMigrationExecutionRun(projectId, runId);
  if (!run) return { status: 'not_found' };
  if (run.status !== RUN_STATUS.HALTED) {
    return {
      status: 'not_retryable',
      reason: `run status is '${run.status}' — only a halted run can have its deploy retried`,
    };
  }

  const items = (run.items ?? [])
    .slice()
    .sort((a, b) => (a.sequence_position ?? 0) - (b.sequence_position ?? 0));

  // The deploy belongs to the job of the LAST failed item: `deploy_on_complete`
  // is set on the final item of a dispatch unit, and it is that item's submit
  // which carried the serve spec. Searching from the end also picks the right
  // job in a sequential run, where each item has its own.
  const failedItems = items.filter(
    (i) =>
      i.id &&
      (i.status === RUN_ITEM_STATUS.FAILED || i.status === RUN_ITEM_STATUS.REJECTED) &&
      (i.job_id ?? '').trim() !== ''
  );
  if (failedItems.length === 0) {
    return {
      status: 'not_retryable',
      reason:
        'no failed run-item carries a job id — there is no completed build whose deploy ' +
        'could be replayed. Use Resume failed to re-run the specs instead.',
    };
  }
  const deployItem = failedItems[failedItems.length - 1];
  const jobId = (deployItem.job_id as string).trim();

  // Every item sharing that job id was produced by the same dispatch (a batch
  // shares one job and one branch), so they all complete on the one callback.
  const siblings = failedItems.filter((i) => (i.job_id ?? '').trim() === jobId);

  // Snapshot the terminal shape BEFORE mutating anything: the rollback below
  // restores from this, never from the (possibly already reset) live rows.
  const originals = siblings.map((s) => ({
    id: s.id as string,
    status: s.status ?? RUN_ITEM_STATUS.FAILED,
    outcome: s.outcome ?? 'error',
  }));

  // Reset to the pre-callback shape. job_id is KEPT (correlation key); outcome,
  // error_detail and failure_class are cleared through the AMS mapper's
  // empty-string explicit-clear sentinel, because leaving a terminal outcome
  // behind would make the door drop the replayed callback at the CD-6 guard.
  for (const sibling of siblings) {
    await safePatchItem(deps, projectId, sibling.id as string, {
      status: RUN_ITEM_STATUS.SUBMITTED,
      outcome: '',
      error_detail: '',
      failure_class: '',
    });
  }
  await safePatchRun(deps, projectId, runId, { status: RUN_STATUS.DISPATCHING });

  logger.info('[diag-gateway] migration_execution_driver retry_deploy_items_reset', {
    projectId,
    runId,
    jobId,
    itemsReset: siblings.length,
  });

  const deploy = deps.deployExistingRun ?? deployExistingRun;
  const outcome = await deploy(jobId);

  if (outcome.status !== 'accepted') {
    // Roll the reset back: nothing is coming, and an item parked at SUBMITTED
    // with no inbound callback is the wedge state this whole path exists to
    // avoid creating.
    const reason =
      outcome.status === 'refused'
        ? `the build service refused the deploy-only replay: ${outcome.message ?? 'no reason given'}`
        : `the deploy-only replay request failed: ${outcome.message ?? 'unknown error'}`;
    for (const original of originals) {
      await safePatchItem(deps, projectId, original.id, {
        status: original.status,
        outcome: original.outcome,
        error_detail: reason,
      });
    }
    await safePatchRun(deps, projectId, runId, { status: RUN_STATUS.HALTED });
    logger.warn('[diag-gateway] migration_execution_driver retry_deploy_rejected', {
      projectId,
      runId,
      jobId,
      status: outcome.status,
      reason,
    });
    return { status: 'not_retryable', reason };
  }

  logger.info('[diag-gateway] migration_execution_driver retry_deploy_accepted', {
    projectId,
    runId,
    jobId,
    deployJobId: outcome.deployJobId ?? null,
    itemsReset: siblings.length,
  });
  trace.step('deploy-only replay accepted', {
    run: runId,
    job: jobId,
    project: scope.project,
  });
  return { status: 'deploying', runId, jobId, itemsReset: siblings.length };
}

/** Outcome of an operator resume-from-failure request (Robustness R2). */
export type ResumeFailedRunResult =
  | { status: 'resumed'; runId: string; itemsReset: number }
  | { status: 'not_found' }
  | { status: 'not_resumable'; reason: string };

/**
 * Operator "resume from failure" (Robustness R2, 2026-08-05): re-run a HALTED
 * run from its failed spec WITHOUT burning the already-implemented items. The
 * guards mirror {@link retryDbPlaneCompletion}'s posture (fail-closed,
 * 409-shaped reasons): only a HALTED run resumes — an active run is being
 * driven by callbacks, a deployed run is done.
 *
 * Every item NOT yet implemented/deployed is RESET to a dispatchable pending
 * state: status pending, outcome/error_detail/job_id/failure_class CLEARED
 * (via the AMS mapper's empty-string explicit-clear sentinel — a stale
 * terminal outcome would drop the re-run's callback at the CD-6 idempotency
 * guard) and the retry counters zeroed (a HUMAN resume grants a fresh
 * automatic-retry budget). Batch-ness is detected BEFORE the reset clears the
 * shared job_id; the re-dispatch then flows through the same shared
 * remaining-items primitive as the transient auto-retry.
 */
export async function resumeFailedMigrationRun(
  scope: MigrateScope,
  runId: string,
  deps: MigrationDriverDeps,
  opts: { salvageFirstFailed?: boolean } = {}
): Promise<ResumeFailedRunResult> {
  scope = normalizeScopeIdentifiers(scope);
  const projectId = scope.projectId;
  const run = await deps.getMigrationExecutionRun(projectId, runId);
  if (!run) return { status: 'not_found' };
  if (run.status !== RUN_STATUS.HALTED) {
    return {
      status: 'not_resumable',
      reason: `run status is '${run.status}' — only a halted run can resume from failure`,
    };
  }

  const items = (run.items ?? [])
    .slice()
    .sort((a, b) => (a.sequence_position ?? 0) - (b.sequence_position ?? 0));
  let toReset = items.filter(
    (i) =>
      i.id &&
      i.status !== RUN_ITEM_STATUS.IMPLEMENTED &&
      i.status !== RUN_ITEM_STATUS.DEPLOYED &&
      i.outcome !== 'implemented' &&
      i.outcome !== 'deployed'
  );
  if (toReset.length === 0) {
    return {
      status: 'not_resumable',
      reason: 'every item already implemented/deployed — nothing to resume',
    };
  }

  // Salvage-first (2026-08-15): commit + push the FIRST failed item's local
  // worktree as its branch and mark it implemented, so the resume proceeds
  // to the NEXT spec instead of re-doing finished work. FAIL-CLOSED: a
  // refused/errored salvage blocks the resume with the reason (the operator
  // resumes WITHOUT salvage to retry the spec instead).
  if (opts.salvageFirstFailed) {
    const firstFailed = toReset.find(
      (i) => i.status === RUN_ITEM_STATUS.FAILED && (i.spec_name ?? '').trim() !== ''
    );
    if (!firstFailed) {
      return {
        status: 'not_resumable',
        reason:
          'salvage requested but no failed item with a spec name exists — ' +
          'resume without salvage.',
      };
    }
    const salvage = deps.salvageSpecWorktree ?? salvageSpecWorktree;
    const outcome = await salvage(
      scope.company,
      scope.project,
      (firstFailed.spec_name as string).trim()
    );
    if (outcome.status !== 'salvaged') {
      return {
        status: 'not_resumable',
        reason:
          `salvage refused (${outcome.status}): ${outcome.message ?? 'no detail'} — ` +
          'resume without salvage to retry the spec instead.',
      };
    }
    // Chain alignment (2026-08-15): the NEXT spec bases off this item's
    // spec_name (chainBaseSpecForItem → feature/<spec_name>). Salvage may
    // legitimately return a different attempt's branch (e.g. the item was
    // re-stamped to the base name by a manual resume while only the -rN tree
    // survived) — the stamped name must follow the branch that actually got
    // pushed, or the successor builds on a branch WITHOUT the salvaged work.
    const salvagedSpecName = (outcome.branch ?? '').replace(/^feature\//, '').trim();
    const currentSpecName = (firstFailed.spec_name as string).trim();
    await safePatchItem(deps, projectId, firstFailed.id as string, {
      status: RUN_ITEM_STATUS.IMPLEMENTED,
      outcome: 'implemented',
      ...(salvagedSpecName && salvagedSpecName !== currentSpecName
        ? { spec_name: salvagedSpecName }
        : {}),
      error_detail: `salvaged from local worktree (${outcome.branch}): ${
        (outcome.summary ?? '').slice(0, 400)
      }`,
      job_id: '',
      failure_class: '',
    });
    logger.info('[diag-gateway] migration_execution_driver resume_salvaged_item', {
      projectId,
      runId,
      runItemId: firstFailed.id,
      specName: firstFailed.spec_name,
      branch: outcome.branch,
      committed: outcome.committed ?? null,
    });
    toReset = toReset.filter((i) => i.id !== firstFailed.id);
    if (toReset.length === 0) {
      return {
        status: 'not_resumable',
        reason:
          'salvage succeeded and no other item remains to run — the run can be ' +
          'completed via its normal callbacks or restarted for the next stage.',
      };
    }
  }

  // Detect the batch shape BEFORE the reset clears the shared job_id.
  const sharedJobId = toReset[0].job_id ?? null;
  const wasBatch =
    toReset.length > 1 && !!sharedJobId && toReset.every((i) => i.job_id === sharedJobId);

  for (const item of toReset) {
    await safePatchItem(deps, projectId, item.id as string, {
      status: RUN_ITEM_STATUS.PENDING,
      dispatched: false,
      // Empty string = the AMS explicit-clear sentinel (mapper-documented).
      outcome: '',
      error_detail: '',
      job_id: '',
      failure_class: '',
      retry_next_attempt_at: '',
      // Fresh automatic-retry budget for the manual re-run.
      retry_attempt_count: 0,
    });
  }

  const first = toReset[0];
  await safePatchRun(deps, projectId, runId, {
    status: RUN_STATUS.DISPATCHING,
    current_sequence_position: first.sequence_position ?? null,
  });

  logger.info('[diag-gateway] migration_execution_driver resume_failed_run', {
    projectId,
    runId,
    itemsReset: toReset.length,
    wasBatch,
  });
  trace.step(`resume-from-failure — ${toReset.length} item(s) reset, re-dispatching`, {
    run: runId,
    project: scope.project,
  });

  // Re-read so the dispatch sees the RESET state (pending, cleared job_ids) —
  // dispatching off the stale pre-reset snapshot would trip the duplicate
  // precheck on the old job_id. Fall back to a local projection if the
  // re-read fails (never leave the run reset-but-undispatched).
  let freshRun: MigrationExecutionRun | null = null;
  try {
    freshRun = await deps.getMigrationExecutionRun(projectId, runId);
  } catch {
    freshRun = null;
  }
  const resetIds = new Set(toReset.map((i) => i.id));
  const projected: MigrationExecutionRun = freshRun ?? {
    ...run,
    items: items.map((i) =>
      resetIds.has(i.id)
        ? {
            ...i,
            status: RUN_ITEM_STATUS.PENDING,
            outcome: null,
            error_detail: null,
            job_id: null,
            dispatched: false,
            retry_attempt_count: 0,
            retry_next_attempt_at: null,
            failure_class: null,
          }
        : i
    ),
  };
  const batchName = wasBatch
    ? `resume-${(runId || 'run').replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase()}-${Date.now()
        .toString(36)
        .slice(-4)}`
    : null;
  await dispatchRemainingRunItems(scope, projected, deps, { batchName });

  return { status: 'resumed', runId, itemsReset: toReset.length };
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
 * Kick the DB-plane completion chain DETACHED (fire-and-forget) — the
 * build-results door must 202 promptly while the chain runs for minutes.
 * Failures are isolated inside the chain (it patches the run state itself).
 */
export function kickDbPlaneCompletion(
  scope: MigrateScope,
  run: MigrationExecutionRun,
  item: MigrationExecutionRunItem,
  deps: MigrationDriverDeps
): void {
  const chain = deps.runDbPlaneCompletion ?? createDbPlaneCompletionRunner();
  void chain(scope, run, item, deps).catch((error) => {
    logger.error('[diag-gateway] migration_execution_driver db_completion_chain_crashed', {
      projectId: scope.projectId,
      runId: run.id,
      runItemId: item.id,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  });
}

/** Outcome of an operator "Retry DB build" request (2026-07-31). */
export type RetryDbCompletionResult =
  | { status: 'retrying'; runId: string }
  | { status: 'not_found' }
  | { status: 'not_retryable'; reason: string };

/**
 * Operator retry of the DB-plane completion chain (2026-07-31). The live
 * shape that demanded it: 14 specs implemented + MRs opened, then the chain
 * halted at its inputs guard (source DB creds unregistered) — and the chain
 * only fires on the final item's build-results callback, so without this the
 * ONLY way to re-run assemble -> schema-apply -> load -> reconcile was to
 * re-run the whole stage (burning every spec again). The chain is idempotent
 * end-to-end (assembly recreates its branch, schema-apply skips applied
 * changeset ids, the load truncates first, reconcile re-runs), so a retry is
 * safe.
 *
 * Guards (fail-closed, 409-shaped reasons): the run must be HALTED, its
 * final db-plane item must have implemented (or failed AT THE CHAIN — never
 * a spec-authoring failure), and every other item must be implemented or
 * deployed. The final item + run are reset and the chain re-kicked detached.
 */
export async function retryDbPlaneCompletion(
  scope: MigrateScope,
  runId: string,
  deps: MigrationDriverDeps
): Promise<RetryDbCompletionResult> {
  scope = normalizeScopeIdentifiers(scope);
  const projectId = scope.projectId;
  const run = await deps.getMigrationExecutionRun(projectId, runId);
  if (!run) return { status: 'not_found' };
  // 2026-08-11 (staleness-is-a-signal ruling): FINISHED runs are retryable
  // too. A completed DB stage whose LOADED DATA is later found defective
  // (the live case: truncated keyset loads) previously had NO path back —
  // "only a halted run" forced a full stage re-run of every spec just to
  // refresh table loads. Re-running assemble → schema-apply → load →
  // parity reconcile is safe on a finished run: schema-apply is
  // checksum-idempotent and the loader truncates before loading. Actively
  // executing runs stay refused.
  const RETRYABLE_RUN_STATUSES: string[] = [
    RUN_STATUS.HALTED,
    RUN_STATUS.AWAITING_APPROVAL,
    RUN_STATUS.DEPLOYED,
  ];
  if (!RETRYABLE_RUN_STATUSES.includes(run.status ?? '')) {
    return {
      status: 'not_retryable',
      reason:
        `run status is '${run.status}' — the DB build can retry on a halted ` +
        'or FINISHED (awaiting_approval/deployed) run, never one still executing',
    };
  }
  const items = (run.items ?? [])
    .slice()
    .sort((a, b) => (a.sequence_position ?? 0) - (b.sequence_position ?? 0));
  const finalItem =
    [...items].reverse().find((i) => i.deploy_on_complete === true) ?? items[items.length - 1];
  if (!finalItem?.id) {
    return { status: 'not_retryable', reason: 'the run has no final item' };
  }
  let plane: MigrationPlane;
  try {
    plane = await resolveItemPlane(scope, run, finalItem, deps);
  } catch (error) {
    return {
      status: 'not_retryable',
      reason:
        `the final item's plane could not be resolved ` +
        `(${error instanceof Error ? error.message : 'unknown'}) — refusing to retry blind`,
    };
  }
  if (plane !== 'db') {
    return {
      status: 'not_retryable',
      reason: `the final item's plane is '${plane}' — DB-build retry only applies to the db plane`,
    };
  }
  const chainFailed =
    finalItem.status === RUN_ITEM_STATUS.FAILED &&
    // Anchored to the chain's exact error template ("DB execution chain
    // failed at <phase>: ...") so an operator halt reason that merely
    // mentions the phrase can never make a non-chain failure retryable.
    String(finalItem.error_detail ?? '').startsWith('DB execution chain failed at ');
  const implementedOk =
    finalItem.outcome === 'implemented' ||
    finalItem.status === RUN_ITEM_STATUS.IMPLEMENTED ||
    // A FINISHED run's final item reads deployed (2026-08-11) — that is the
    // strongest possible "the spec run itself succeeded" evidence.
    finalItem.outcome === 'deployed' ||
    finalItem.status === RUN_ITEM_STATUS.DEPLOYED;
  if (!chainFailed && !implementedOk) {
    return {
      status: 'not_retryable',
      reason:
        'the final item did not implement (the spec run itself failed) — re-run the stage instead',
    };
  }
  const badSibling = items.find(
    (i) =>
      i.id !== finalItem.id &&
      !(
        i.outcome === 'implemented' ||
        i.outcome === 'deployed' ||
        i.status === RUN_ITEM_STATUS.IMPLEMENTED ||
        i.status === RUN_ITEM_STATUS.DEPLOYED
      )
  );
  if (badSibling) {
    return {
      status: 'not_retryable',
      reason:
        `item at position ${badSibling.sequence_position} is '${badSibling.status}' — ` +
        'every spec must be implemented before the DB build can retry',
    };
  }

  await safePatchItem(deps, projectId, finalItem.id, {
    status: RUN_ITEM_STATUS.IMPLEMENTED,
    outcome: 'implemented',
    error_detail: null,
  });
  await safePatchRun(deps, projectId, runId, { status: RUN_STATUS.DISPATCHING });
  logger.info('[diag-gateway] migration_execution_driver db_completion_retry', {
    projectId,
    runId,
    runItemId: finalItem.id,
    previouslyFailedAtChain: chainFailed,
  });
  trace.step('operator retry — re-running the DB execution chain', {
    run: runId,
    project: scope.project,
  });
  kickDbPlaneCompletion(
    scope,
    run,
    { ...finalItem, status: RUN_ITEM_STATUS.IMPLEMENTED, outcome: 'implemented' },
    deps
  );
  return { status: 'retrying', runId };
}

// ============================================================================
// Phased execution: plane reconcile + human-gated resume (Spec W)
// ============================================================================

/**
 * Resolve the plane of a run-item by mapping its work item to the book item's
 * workstream (Spec W). Fail-soft to `service` (the default plane).
 */
/**
 * Thrown when a run-item's plane cannot be determined (gold standard
 * 2026-08-07). The old shape defaulted to 'service' on ANY failure — a
 * db-plane item whose book read hiccuped would then SKIP its schema-apply /
 * data-migration chain and the run completed with an empty database, silently.
 * Callers catch this and fail CLOSED (halt / refuse) with the reason.
 */
export class PlaneResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlaneResolutionError';
  }
}

async function resolveItemPlane(
  scope: MigrateScope,
  run: MigrationExecutionRun,
  item: MigrationExecutionRunItem,
  deps: MigrationDriverDeps
): Promise<MigrationPlane> {
  const bookId = run.book_of_work_id ?? scope.bookId;
  if (!bookId) {
    throw new PlaneResolutionError(
      `run ${run.id ?? 'unknown'} carries no book_of_work_id — its item's plane cannot be resolved`
    );
  }
  if (!item.work_item_id) {
    throw new PlaneResolutionError(
      `run-item ${item.id ?? 'unknown'} carries no work_item_id — its plane cannot be resolved`
    );
  }
  let book;
  try {
    book = await deps.fetchBookOfWork(scope.projectId, bookId);
  } catch (error) {
    throw new PlaneResolutionError(
      `book ${bookId} could not be read to resolve the item's plane: ` +
        `${error instanceof Error ? error.message : 'read failed'}`
    );
  }
  const items = book?.book_of_work_json?.items ?? [];
  const bookItem = items.find((bi) => bi.workItemId === item.work_item_id);
  if (!bookItem) {
    throw new PlaneResolutionError(
      `work item ${item.work_item_id} is not in book ${bookId} — the item's plane cannot be resolved`
    );
  }
  return planeForItem(bookItem);
}

/**
 * SCL shipped-suite verdict at build-results time (spec 10, 2026-08-18).
 * For an SCL corpus story's SUCCESS callback (`implemented` / `deployed`):
 *   1. resolve the book blob item's tags (SCL recognition — fail-soft);
 *   2. ask IVS for the branch's current shipped-file hashes + sidecars and run
 *      the no-modification guard + quarantine thresholds
 *      ({@link evaluateSclSuiteIntegrity});
 *   3. append the verdict to the run's decision log (run-level accounting);
 *   4. LOUD `SCL_SUITE_MODIFIED` surfacing when shipped tests were touched;
 *   5. a fired threshold HALTS: per-spec rate → this run item fails with the
 *      spec-scoped reason; run-level rate → the run halts with the aggregate
 *      reason. Returns true when the advance must stop (`halted`).
 * NEVER throws; every degradation is logged and the advance proceeds.
 */
async function applySclSuiteVerdict(
  input: BuildResultAdvanceInput,
  scope: MigrateScope,
  run: MigrationExecutionRun,
  item: MigrationExecutionRunItem,
  deps: MigrationDriverDeps
): Promise<boolean> {
  const runId = item.run_id as string;
  const runItemId = item.id as string;
  try {
    // -- SCL recognition: the matched book blob item's tags -----------------
    const bookId = run.book_of_work_id ?? scope.bookId;
    if (!bookId || !item.work_item_id) return false;
    const book = await deps.fetchBookOfWork(scope.projectId, bookId);
    const bookItem = (book?.book_of_work_json?.items ?? []).find(
      (bi) => bi.workItemId === item.work_item_id
    );
    const storyTags = (bookItem?.tags ?? []).filter(
      (t): t is string => typeof t === 'string'
    );
    const evaluate = deps.evaluateSclSuiteIntegrity ?? evaluateSclSuiteIntegrity;
    const verdict = await evaluate({
      jobId: input.jobId,
      runItemId,
      storyTags,
      runDecisionLog: run.decision_log_json,
    });
    if (verdict.kind === 'not_scl') return false;
    if (verdict.kind === 'skipped') {
      logger.warn('[diag-gateway] migration_execution_driver scl_suite_check_skipped', {
        projectId: scope.projectId,
        runId,
        runItemId,
        jobId: input.jobId,
        reason: verdict.reason,
      });
      return false;
    }

    // -- Record the verdict on the run's decision log (accounting + audit) --
    await safePatchRun(deps, scope.projectId, runId, {
      decision_log_json: [...(run.decision_log_json ?? []), verdict.decisionEntry],
    });

    // -- No-modification guard: LOUD attention item, never silent -----------
    if (!verdict.intact) {
      logger.error('[diag-gateway] migration_execution_driver SCL_SUITE_MODIFIED', {
        projectId: scope.projectId,
        runId,
        runItemId,
        jobId: input.jobId,
        modified: verdict.modified,
        missing: verdict.missing,
      });
      trace.warn(
        `SCL_SUITE_MODIFIED — shipped tests touched: ` +
          `${[...verdict.modified, ...verdict.missing.map((p) => `${p} (missing)`)].join(', ')}`,
        { run: runId, job: input.jobId, project: scope.project }
      );
    }

    // -- Threshold circuit breakers (the ONLY halts in the protocol) --------
    if (verdict.haltRun) {
      await haltRunForItem(deps, scope, runId, runItemId, item, RUN_ITEM_STATUS.FAILED,
        `SCL run-level quarantine circuit breaker: the aggregate quarantine rate ` +
          `(${(verdict.runRate * 100).toFixed(1)}%) exceeds the run threshold — ` +
          `systematic extraction misreads across the run. Disposition the quarantine ` +
          `list at the stage-2 gate (re-extract contracts, regenerate tests), then Resume.`);
      return true;
    }
    if (verdict.haltSpec) {
      await haltRunForItem(deps, scope, runId, runItemId, item, RUN_ITEM_STATUS.FAILED,
        `SCL per-spec contest circuit breaker: ${verdict.quarantined} of ` +
          `${verdict.suiteTestCount} shipped tests are quarantined ` +
          `(${(verdict.specRate * 100).toFixed(1)}% > the spec threshold) — a ` +
          `systematic extraction misread of this spec's contracts. Re-extract the ` +
          `contracts, regenerate the suite, then Resume failed.`);
      return true;
    }
    return false;
  } catch (error) {
    // Fail-soft: the integrity layer must never break the advance.
    logger.warn('[diag-gateway] migration_execution_driver scl_suite_check_failed', {
      projectId: scope.projectId,
      runId,
      runItemId,
      jobId: input.jobId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return false;
  }
}

/**
 * Run a plane's reconcile after it deploys (Spec W):
 *   - `service` -> API baseline replay (the existing full-baseline reconcile);
 *   - `db`      -> data-parity comparator (Spec P) via the injectable seam;
 *   - `ui`      -> none (the UI plane is build-only — no UI reconcile).
 * Fire-and-forget; failures are isolated inside the triggers.
 */
export function kickPlaneReconcile(
  scope: MigrateScope,
  runId: string,
  plane: MigrationPlane,
  deps: MigrationDriverDeps
): void {
  if (plane === 'service') {
    kickFullReconcile(scope, runId, deps);
    return;
  }
  if (plane === 'db') {
    // DB plane: LOAD the target (Spec Y data-migration runner) THEN RECONCILE it
    // (Spec P data-parity), in sequence — the target must be populated before
    // the comparison. Both fire-and-forget; the run is already paused
    // (awaiting_approval) and the human reviews the persisted parity report once
    // it lands. A skipped/failed load leaves the report unclean, so the resume
    // gate blocks — never a silent pass.
    const migrate = deps.triggerDataMigration ?? defaultNoopRunnerTrigger;
    const reconcile = deps.triggerDataParityReconcile ?? defaultTriggerDataParityReconcile;
    void migrate(scope, runId, deps)
      .then(() => reconcile(scope, runId, deps))
      .catch((error) => {
        logger.error('[diag-gateway] migration_execution_driver db_plane_runner_chain_crashed', {
          projectId: scope.projectId,
          runId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      });
    return;
  }
  // ui: build-only, no reconcile.
  logger.info('[diag-gateway] migration_execution_driver plane_no_reconcile', {
    projectId: scope.projectId,
    runId,
    plane,
  });
}

/**
 * Default DB-plane reconcile (Spec W): records intent + traces. Wiring the live
 * AMVS data-parity comparator (Spec P) against the pinned source + freshly
 * loaded target is a work-machine shakedown seam; production injects the real
 * trigger. Never throws.
 */
async function defaultTriggerDataParityReconcile(
  scope: MigrateScope,
  runId: string,
  _deps: MigrationDriverDeps
): Promise<void> {
  logger.info('[diag-gateway] migration_execution_driver data_parity_reconcile_seam', {
    projectId: scope.projectId,
    runId,
  });
  trace.step('data-parity reconcile (DB plane) — live seam', {
    run: runId,
    project: scope.project,
  });
}

/**
 * Fallback DB-plane data-migration trigger — a no-op. The real runner dispatch
 * is wired in defaultMigrationDriverDeps; unit tests that do not inject
 * `triggerDataMigration` simply skip the load step.
 */
async function defaultNoopRunnerTrigger(): Promise<void> {
  /* no-op */
}

/** Outcome of a resume ("approve & continue") request. */
export type ResumeMigrationResult =
  | { status: 'resumed'; nextPlane: MigrationPlane }
  | { status: 'not_paused'; message: string }
  | { status: 'blocked'; reasons: HardBlockResult['reasons'] }
  | { status: 'complete' }
  | { status: 'error'; message: string };

/**
 * Resume a run PAUSED at a plane boundary (Spec W "approve & continue"). Only a
 * run in `awaiting_approval` resumes. When the plane being LEFT is the DB plane,
 * the data-parity gate is re-evaluated here (repositioned from the pre-migrate
 * gate, Persistence-conditional) — a non-clean parity blocks the resume unless
 * `override` is set (human sign-off). Dispatches the next plane's first pending
 * item and returns the run to `dispatching`. Never throws.
 */
export async function resumeMigration(
  scope: MigrateScope,
  runId: string,
  deps: MigrationDriverDeps,
  opts?: { override?: boolean }
): Promise<ResumeMigrationResult> {
  // Same normalised-identifier enforcement as startMigration (2026-07-27).
  scope = normalizeScopeIdentifiers(scope);
  const run = await deps.getMigrationExecutionRun(scope.projectId, runId);
  if (!run) return { status: 'error', message: `Run ${runId} not found` };
  if (run.status !== RUN_STATUS.AWAITING_APPROVAL) {
    return {
      status: 'not_paused',
      message: `Run is '${run.status ?? 'unknown'}', not awaiting approval`,
    };
  }

  const items = (run.items ?? [])
    .slice()
    .sort((a, b) => (a.sequence_position ?? 0) - (b.sequence_position ?? 0));
  const next = items.find((i) => i.status === RUN_ITEM_STATUS.PENDING);
  if (!next || !next.id) {
    // Nothing left to dispatch -> the run is actually complete.
    await safePatchRun(deps, scope.projectId, runId, { status: RUN_STATUS.DEPLOYED });
    return { status: 'complete' };
  }

  // Repositioned data-parity gate (Spec W §2.12): if the plane being LEFT is the
  // DB plane, parity must be clean (or explicitly overridden) before the next
  // plane begins. Persistence-conditional: only fires at a DB-plane pause.
  const deployedItems = items.filter((i) => i.status === RUN_ITEM_STATUS.DEPLOYED);
  const lastDeployed = deployedItems[deployedItems.length - 1];
  let completedPlane: MigrationPlane;
  try {
    completedPlane = lastDeployed
      ? await resolveItemPlane(scope, run, lastDeployed, deps)
      : 'service';
  } catch (error) {
    // Fail-closed (2026-08-07): guessing 'service' here SKIPPED the DB-plane
    // data-parity gate when the plane read hiccuped — the next plane then
    // started on unverified data. Unresolvable = blocked resume.
    return {
      status: 'blocked',
      reasons: [
        {
          code: 'plane_unresolvable',
          message:
            `The completed plane could not be resolved ` +
            `(${error instanceof Error ? error.message : 'unknown'}) — refusing to resume ` +
            'past a gate that cannot be evaluated. Retry when AMS is consistent.',
        },
      ],
    };
  }
  if (completedPlane === 'db' && !opts?.override) {
    const book = run.book_of_work_id
      ? await deps.fetchBookOfWork(scope.projectId, run.book_of_work_id)
      : null;
    const parity = await evaluateDataParityReadiness({
      projectId: scope.projectId,
      architectureId: book?.current_architecture_id ?? null,
      reads: deps.dataParityGateReads,
    });
    if (!parity.ok) {
      logger.info('[diag-gateway] migration_execution_driver resume_blocked_data_parity', {
        projectId: scope.projectId,
        runId,
        reasons: parity.reasons.map((r) => r.code),
      });
      return { status: 'blocked', reasons: parity.reasons };
    }
  }

  // Break-glass RECORDING (Residual 1, 2026-07-20): an override past the DB
  // parity gate is frozen onto the run's decision log — who overrode is the
  // caller's audit trail; WHAT was overridden (the unwaived divergent tables
  // at this moment) is what the downstream API reconcile needs to attribute
  // breaks (possible data echo vs real defect). Best-effort: a recording
  // failure never blocks the resume.
  if (completedPlane === 'db' && opts?.override) {
    try {
      const book = run.book_of_work_id
        ? await deps.fetchBookOfWork(scope.projectId, run.book_of_work_id)
        : null;
      const parity = await evaluateDataParityReadiness({
        projectId: scope.projectId,
        architectureId: book?.current_architecture_id ?? null,
        reads: deps.dataParityGateReads,
      });
      const divergentTables = [
        ...new Set(parity.reasons.flatMap((r) => r.tables ?? [])),
      ];
      const entry: Record<string, unknown> = {
        type: 'data_parity_override',
        at: new Date().toISOString(),
        parity_codes: parity.reasons.map((r) => r.code),
        divergent_tables: divergentTables,
        note:
          'Break-glass: resumed past the DB-plane data-parity gate. The next ' +
          "plane's API reconcile runs under KNOWN data divergence — its breaks " +
          'are echo-classified against these tables.',
      };
      await patchRunWithRetry(deps, scope.projectId, runId, {
        decision_log_json: [...(run.decision_log_json ?? []), entry],
      });
      trace.warn(
        `data-parity override RECORDED — ${divergentTables.length} divergent table(s) frozen for echo attribution`,
        { run: runId, project: scope.project },
      );
    } catch (err) {
      logger.warn('[diag-gateway] migration_execution_driver override_record_failed', {
        projectId: scope.projectId,
        runId,
        error: err instanceof Error ? err.message : 'unknown',
      });
    }
  }

  const descriptor = await resolveDescriptorForItem(scope, run, next, deps);
  if (!descriptor) {
    await haltRunForItem(deps, scope, runId, next.id, next, RUN_ITEM_STATUS.FAILED,
      'Could not resolve generated_spec_text to resume the next plane.');
    return { status: 'error', message: 'Next spec text could not be resolved.' };
  }

  let nextPlane: MigrationPlane;
  try {
    nextPlane = await resolveItemPlane(scope, run, next, deps);
  } catch (error) {
    await haltRunForItem(deps, scope, runId, next.id, next, RUN_ITEM_STATUS.FAILED,
      `The next item's plane could not be resolved on resume ` +
        `(${error instanceof Error ? error.message : 'unknown'}) — refusing to dispatch ` +
        'blind. Fix the AMS book/run consistency, then Resume failed.');
    return { status: 'error', message: 'Next plane could not be resolved.' };
  }
  await safePatchRun(deps, scope.projectId, runId, {
    status: RUN_STATUS.DISPATCHING,
    current_sequence_position: next.sequence_position ?? null,
  });
  kickSpecRunner(scope, run, next, descriptor, deps);
  logger.info('[diag-gateway] migration_execution_driver plane_resumed', {
    projectId: scope.projectId,
    runId,
    nextRunItemId: next.id,
    nextPlane,
  });
  trace.step(`plane ${nextPlane} approved — dispatching`, {
    run: runId,
    project: scope.project,
  });
  return { status: 'resumed', nextPlane };
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

  // Recover the book-item title (2026-07-31): this path previously built
  // descriptors with title '' — so EVERY advance/recovery-dispatched item
  // (i.e. all items after the first) was named with the generic
  // `migration-spec` fallback slug instead of its real title. That is how
  // the live 2026-07-30 pair collided on one name. Best-effort: an
  // unresolvable title keeps the fallback slug (the uniqueness suffix still
  // guarantees distinct folders).
  let title = '';
  let bookItemId: string | null = null;
  let hasEndpointIds: boolean | undefined;
  let plane: MigrationPlane | undefined;
  try {
    if (item.work_item_id) {
      const book = await deps.fetchBookOfWork(scope.projectId, bookId);
      const bookItem = (book?.book_of_work_json?.items ?? []).find(
        (bi) => bi.workItemId === item.work_item_id
      );
      title = (bookItem?.title ?? '').trim();
      bookItemId = bookItem?.id ?? null;
      // Plane matters on the FINAL item: the submit decouples the haibox
      // deploy flag for db-plane items (WS2).
      plane = bookItem ? planeForItem(bookItem) : undefined;
      hasEndpointIds = bookItem
        ? Array.isArray((bookItem as { apiEndpointIds?: unknown }).apiEndpointIds) &&
          (((bookItem as { apiEndpointIds?: unknown[] }).apiEndpointIds?.length) ?? 0) > 0
        : undefined;
    }
  } catch {
    /* fail-soft — the fallback slug + suffix stay valid */
  }

  return {
    sequencePosition: item.sequence_position ?? 0,
    workItemId: item.work_item_id ?? null,
    specGenerationId: item.spec_generation_id ?? null,
    bookItemId,
    generatedSpecText: text,
    title,
    deployOnComplete: item.deploy_on_complete ?? false,
    ...(hasEndpointIds === undefined ? {} : { hasEndpointIds }),
    plane,
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
): Promise<{
  recovered: number;
  rekicked: number;
  retriesRearmed: number;
  callbacksReconciled: number;
}> {
  let recovered = 0;
  let rekicked = 0;
  let retriesRearmed = 0;
  let callbacksReconciled = 0;

  for (const ref of runs) {
    try {
      const run = await deps.getMigrationExecutionRun(ref.projectId, ref.runId);
      if (!run) continue;
      // Skip terminal runs.
      if (run.status === RUN_STATUS.DEPLOYED || run.status === RUN_STATUS.FAILED) {
        continue;
      }
      recovered++;

      // Normalised-identifier enforcement (2026-07-27): boot-recovery refs may
      // come from run records created BEFORE the fix (raw display names).
      const scope: MigrateScope = normalizeScopeIdentifiers({
        projectId: ref.projectId,
        bookId: ref.bookId || (run.book_of_work_id ?? ''),
        company: ref.company,
        project: ref.project,
      });

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

      // Callback-lost reconcile (2026-08-15 — the C5 "durable + pollable"
      // promise finally consumed): an item SUBMITTED with a job_id whose IVS
      // job already finished but whose terminal callback was never delivered
      // (all retry attempts failed) wedged the run at 'dispatching' forever —
      // the predicate above requires !job_id, so nothing ever looked again.
      // Poll the durable job record; a terminal job feeds the SAME advance
      // path the callback would have (CD-6 idempotency guards a late twin).
      const orphaned = items.filter(
        (i) =>
          (i.status === RUN_ITEM_STATUS.SUBMITTED ||
            i.status === RUN_ITEM_STATUS.SUBMITTING) &&
          !!i.job_id &&
          !i.outcome
      );
      const reconciledJobs = new Set<string>();
      for (const item of orphaned) {
        const jobId = item.job_id as string;
        // Batch shape: N siblings share one job — one advance completes all.
        if (reconciledJobs.has(jobId)) continue;
        reconciledJobs.add(jobId);
        const getJob = deps.getJobStatus ?? defaultGetJobStatus;
        const job = await getJob(jobId).catch(() => null);
        if (!job) continue; // unreadable — the next boot sweep tries again
        const terminal =
          job.status === 'completed' ||
          job.status === 'failed' ||
          job.status === 'cancelled';
        if (!terminal) continue; // still running — its callback will come
        const result = (job.result ?? {}) as Record<string, unknown>;
        let advanceInput: BuildResultAdvanceInput | null = null;
        if (typeof result.outcome === 'string' && result.outcome) {
          advanceInput = {
            company: scope.company,
            project: scope.project,
            jobId,
            outcome: result.outcome as BuildResultOutcome,
            prUrl: typeof result.pr_url === 'string' ? result.pr_url : null,
            targetBaseUrl:
              typeof result.target_base_url === 'string' ? result.target_base_url : null,
            errors: Array.isArray(result.errors) ? result.errors.map(String) : null,
            failureClass:
              typeof result.failure_class === 'string' ? result.failure_class : null,
          };
        } else if (job.status === 'failed' || job.status === 'cancelled') {
          advanceInput = {
            company: scope.company,
            project: scope.project,
            jobId,
            outcome: 'error',
            errors: [job.error ?? `IVS job ${job.status} with no result payload`],
          };
        }
        if (!advanceInput) {
          // Completed with no recognisable result — never guess success.
          logger.warn('[diag-gateway] migration_execution_driver recovery_job_result_unreadable', {
            projectId: ref.projectId,
            runId: ref.runId,
            runItemId: item.id,
            jobId,
            jobStatus: job.status,
          });
          continue;
        }
        logger.info('[diag-gateway] migration_execution_driver recovery_callback_reconciled', {
          projectId: ref.projectId,
          runId: ref.runId,
          runItemId: item.id,
          jobId,
          jobStatus: job.status,
          outcome: advanceInput.outcome,
        });
        const decision = await advanceRunOnBuildResult(advanceInput, deps);
        logger.info('[diag-gateway] migration_execution_driver recovery_reconcile_decision', {
          projectId: ref.projectId,
          runId: ref.runId,
          jobId,
          decision,
        });
        callbacksReconciled++;
      }

      // Robustness R2: re-arm SCHEDULED RETRIES lost with the previous
      // process's timers. The armed-retry predicate is deliberately narrow —
      // status pending + counter > 0 + a next-attempt time. Ordinary pending
      // items (waiting their sequential turn) have counter 0 and are NEVER
      // swept here (dispatching them all in parallel is exactly the bug this
      // predicate exists to avoid); a manual resume also zeroes the counter,
      // so its resets cannot be mistaken for armed retries. ONE timer per run
      // (the redispatch primitive handles batch vs single itself), fired at
      // the earliest overdue/pending next-attempt time.
      const armed = items.filter(
        (i) =>
          i.status === RUN_ITEM_STATUS.PENDING &&
          (i.retry_attempt_count ?? 0) > 0 &&
          !!i.retry_next_attempt_at &&
          !i.outcome
      );
      if (armed.length > 0) {
        const now = Date.now();
        const dueTimes = armed.map((i) => Date.parse(i.retry_next_attempt_at as string) || now);
        const delayMs = Math.max(0, Math.min(...dueTimes) - now);
        const nextAttempt =
          Math.max(...armed.map((i) => i.retry_attempt_count ?? 0)) + 1;
        logger.info('[diag-gateway] migration_execution_driver recovery_retry_rearmed', {
          projectId: ref.projectId,
          runId: ref.runId,
          armedCount: armed.length,
          delayMs,
          nextAttempt,
        });
        const timer = deps.scheduleRetryTimer ?? defaultScheduleRetryTimer;
        timer(delayMs, () => {
          void redispatchAfterTransientFailure(scope, ref.runId, nextAttempt, deps).catch(
            (error) => {
              logger.error('[diag-gateway] migration_execution_driver recovery_retry_crashed', {
                projectId: ref.projectId,
                runId: ref.runId,
                error: error instanceof Error ? error.message : 'Unknown error',
              });
            }
          );
        });
        retriesRearmed += armed.length;
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
    retriesRearmed,
    callbacksReconciled,
  });
  return { recovered, rekicked, retriesRearmed, callbacksReconciled };
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
  outcome: string = 'failed',
  // Robustness R2: the failure classification to persist alongside the halt
  // ('transient_upstream' for an exhausted retry budget, 'real' when the IVS
  // classifier said so, null/omitted when unknown).
  failureClass: string | null = null
): Promise<void> {
  logger.warn('[diag-gateway] migration_execution_driver halt_run', {
    projectId: scope.projectId,
    runId,
    runItemId,
    itemStatus,
    outcome,
    errorDetail,
    failureClass,
  });
  await safePatchItem(deps, scope.projectId, runItemId, {
    status: itemStatus,
    outcome,
    error_detail: errorDetail,
    ...(failureClass ? { failure_class: failureClass } : {}),
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

/** Retry-once wrapper for the break-glass decision-log PATCH (2026-08-07):
 * the override audit trail (which divergent tables were waived past) is what
 * the downstream reconcile uses for echo attribution — a single AMS blip
 * must not silently lose it. */
async function patchRunWithRetry(
  deps: MigrationDriverDeps,
  projectId: string,
  runId: string,
  patch: MigrationExecutionRun
): Promise<void> {
  try {
    await deps.patchMigrationExecutionRun(projectId, runId, patch);
  } catch {
    await new Promise((resolve) => setTimeout(resolve, PATCH_RETRY_DELAY_MS));
    await deps.patchMigrationExecutionRun(projectId, runId, patch);
  }
}

/** One in-process retry after a short pause (2026-08-07): a single AMS blip
 * during a state PATCH used to silently drop the write — the run-item then
 * carried stale status/outcome and the next advance mis-decided. One retry
 * absorbs the blip class; a second failure still logs loudly. */
const PATCH_RETRY_DELAY_MS = 400;

async function safePatchItem(
  deps: MigrationDriverDeps,
  projectId: string,
  runItemId: string,
  patch: MigrationExecutionRunItem
): Promise<void> {
  try {
    await deps.patchMigrationExecutionRunItem(projectId, runItemId, patch);
  } catch (firstError) {
    logger.warn('[diag-gateway] migration_execution_driver patch_item_retrying', {
      projectId,
      runItemId,
      error: firstError instanceof Error ? firstError.message : 'Unknown error',
    });
    await new Promise((resolve) => setTimeout(resolve, PATCH_RETRY_DELAY_MS));
    try {
      await deps.patchMigrationExecutionRunItem(projectId, runItemId, patch);
    } catch (error) {
      logger.error('[diag-gateway] migration_execution_driver patch_item_failed', {
        projectId,
        runItemId,
        retried: true,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
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
  } catch (firstError) {
    logger.warn('[diag-gateway] migration_execution_driver patch_run_retrying', {
      projectId,
      runId,
      error: firstError instanceof Error ? firstError.message : 'Unknown error',
    });
    await new Promise((resolve) => setTimeout(resolve, PATCH_RETRY_DELAY_MS));
    try {
      await deps.patchMigrationExecutionRun(projectId, runId, patch);
    } catch (error) {
      logger.error('[diag-gateway] migration_execution_driver patch_run_failed', {
        projectId,
        runId,
        retried: true,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
}
