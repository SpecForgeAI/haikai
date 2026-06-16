/**
 * Migration Reconciliation Driver (gateway-hosted; the deploy -> reconcile ->
 * bug -> re-reconcile loop).
 *
 * Fills the two seams Spec 3 left in the build-results door:
 *   - the `deployed` (no bug_id) -> FULL-baseline reconcile trigger
 *     ({@link triggerFullBaselineReconcile}, Group 2);
 *   - the `bug_id` callback -> SCOPED re-reconcile + circuit breaker
 *     ({@link handleBugCallback}, Group 4).
 * PLUS the human-gated bug send + non-sent dispositions (Group 3):
 *   - {@link sendBugForBreaks} (the human gate -- nothing auto-sends), and
 *   - {@link disposeBreaks} (terminal human dispositions, oracle unchanged).
 *
 * GOVERNING CORRECTIONS (locked):
 *   - CD-A: the oracle is ALWAYS the pinned current-state baseline; ANY target
 *     deviation is a break. Intentional / deferred deviations are handled by
 *     HUMAN DISPOSITION (`accepted / wont_report / intentional_deviation`),
 *     never by changing the oracle.
 *   - CD-B: the FULL pinned baseline is replayed; there is NO deferred-exclusion.
 *     Deferred / un-migrated stories surface as breaks and are disposed.
 *
 * Everything external is injected ({@link ReconciliationDriverDeps}) so the
 * driver is unit-testable with mocks; no live LLM is reached (the bug send is a
 * plain authed proxy POST, not an LLM call).
 *
 * Spec: Migration Reconciliation + Bug Loop (2026-06-14, Spec 4 of 4) --
 * Task Groups 2 + 3 + 4.
 *
 * Spec: Reconcile-Time Determinism & Volatile-Value Handling (2026-06-16) --
 * Task Group 4 adds the post-diff `expected_volatile` auto-disposition pass
 * ({@link autoDisposeVolatileBreaks}, sibling to {@link autoDisposeNetNewTargetOnly}),
 * the retroactive human-declared-path re-disposition ({@link declareVolatilePaths}),
 * and the `expected_volatile` run-summary count.
 */

import { logger } from './logger';
import { createTracer } from '../trace';

// Haikai workflow trace (OFF unless HAIKAI_TRACE set). SUMMARY for the reconcile
// + bug loop; DETAIL for per-break, auto-disposition and the verdict (bug)
// round-trip — where reconcile failures hide. See docs/trace-logging.md.
const trace = createTracer('gateway');
import {
  MigrationExecutionRun,
  patchMigrationExecutionRun,
  RUN_STATUS,
} from './migrationExecutionRunClient';
import {
  MigrationReconciliationBreak,
  BREAK_DISPOSITION,
  TERMINAL_DISPOSITIONS,
  createReconciliationBreaks,
  getReconciliationBreaksForRun,
  getReconciliationBreaksByBugId,
  markReconciliationBreaksSent,
  patchReconciliationBreak,
  incrementReconciliationBreakAttempt,
  tripReconciliationBreakCircuitBreaker,
} from './migrationReconciliationBreakClient';
import {
  ReconciliationValidationDeps,
  ReconciliationPollOptions,
  ReconciliationDiffItem,
  ReconciliationResult,
  runHeadlessReconcile,
  isDiffItemABreak,
  defaultReconciliationValidationDeps,
} from './migrationReconciliationValidationClient';
import {
  migrationTargetCredentialsStore,
  TargetApiAuthSecret,
} from './migrationTargetCredentialsStore';
import { request as defaultImplRequest } from './implementationLlmProxyClient';
import { getConfig } from '../config';
import {
  ReconcileBookOfWorkItem,
  NetNewOperationLookup,
  buildNetNewOperationLookup,
  matchTargetOnlyOperation,
} from './migrationReconciliationNetNewMatch';
import {
  classifyBreakVolatility,
  VolatilitySource,
} from './migrationReconciliationVolatilityDisposition';

// ============================================================================
// Run-state status (Spec-4 extension of the Spec-3 RUN_STATUS vocabulary)
// ============================================================================

/**
 * The two Spec-4 reconcile run-states layered on the Spec-3 lifecycle. Held as
 * TEXT (the run `status` column is plain TEXT; the AMS service validates the
 * Spec-3 enum but reconcile sets these via the same column):
 *   - `reconciling`            -- the full-baseline reconcile is in flight;
 *   - `reconciled`             -- the reconcile finished + breaks were recorded;
 *   - `needs_target_credentials` -- creds absent at callback time (CD-2 pause);
 *   - `reconcile_failed`       -- the headless reconcile failed mid-run.
 */
export const RECONCILE_RUN_STATUS = {
  RECONCILING: 'reconciling',
  RECONCILED: 'reconciled',
  NEEDS_TARGET_CREDENTIALS: 'needs_target_credentials',
  RECONCILE_FAILED: 'reconcile_failed',
} as const;

/** Default circuit-breaker cap: a break may be re-run at most this many times. */
export const DEFAULT_CIRCUIT_BREAKER_MAX_ATTEMPTS = 3;

// ============================================================================
// Injectable dependency surface (the DI seam for tests)
// ============================================================================

/** The reconcile driver's injectable surface. */
export interface ReconciliationDriverDeps {
  // --- break store (AMS changeset 183) ---
  createReconciliationBreaks: typeof createReconciliationBreaks;
  getReconciliationBreaksForRun: typeof getReconciliationBreaksForRun;
  getReconciliationBreaksByBugId: typeof getReconciliationBreaksByBugId;
  markReconciliationBreaksSent: typeof markReconciliationBreaksSent;
  patchReconciliationBreak: typeof patchReconciliationBreak;
  incrementReconciliationBreakAttempt: typeof incrementReconciliationBreakAttempt;
  tripReconciliationBreakCircuitBreaker: typeof tripReconciliationBreakCircuitBreaker;
  // --- run state (AMS changeset 182) ---
  patchMigrationExecutionRun: typeof patchMigrationExecutionRun;
  // --- the headless reconciler (validation-service + AMS reads) ---
  runHeadlessReconcile: typeof runHeadlessReconcile;
  validationDeps: ReconciliationValidationDeps;
  /** Resolve the architecture id for the pinned baseline (AMS baseline read). */
  resolveArchitectureForBaseline(projectId: string, baselineId: string): Promise<string | null>;
  /** Read the run's captured target creds (CD-2; undefined => pause). */
  getTargetCredentials(runId: string): TargetApiAuthSecret | undefined;
  /** The authed outbound seam for POST /api/v2/bugs (no new transport). */
  implRequest: typeof defaultImplRequest;
  /** Poll knobs (instant in tests). */
  pollOptions?: ReconciliationPollOptions;
  /** The circuit-breaker max-attempts cap (configurable per CD-6). */
  circuitBreakerMaxAttempts: number;
  /**
   * D6: read the run's book-of-work `net_new` items for the post-diff
   * auto-disposition match. Returns the minimal per-item shape the match needs
   * (`provenance` / `kind` / `netNewOperations` + identity). Failure-isolated by
   * the caller (a read failure just skips the pass -- breaks stay open).
   */
  loadReconcileBookOfWork(projectId: string, bookOfWorkId: string): Promise<ReconcileBookOfWorkItem[]>;
}

/** Resolve the architecture id off an AMS baseline row (default transport). */
async function defaultResolveArchitectureForBaseline(
  projectId: string,
  baselineId: string
): Promise<string | null> {
  const url =
    `${getConfig().architectureModelServiceBaseUrl}` +
    `/api/projects/${encodeURIComponent(projectId)}/api-behaviour/baselines/${encodeURIComponent(baselineId)}`;
  try {
    const response = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
    if (!response.ok) return null;
    const body = (await response.json()) as { architecture_id?: string | null } | null;
    return body?.architecture_id ?? null;
  } catch (error) {
    logger.warn('[diag-gateway] migration_reconciliation resolve_architecture_failed', {
      projectId,
      baselineId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return null;
  }
}

/**
 * D6: read the run's book-of-work blob and project each item down to the minimal
 * {@link ReconcileBookOfWorkItem} the net_new match needs. Tolerates snake_case
 * (AMS wire) + camelCase (mirrors the shape-spec handler's blob-read pattern).
 * Only the fields the match reads are surfaced; everything else is ignored.
 */
async function defaultLoadReconcileBookOfWork(
  projectId: string,
  bookOfWorkId: string
): Promise<ReconcileBookOfWorkItem[]> {
  const url =
    `${getConfig().architectureModelServiceBaseUrl}` +
    `/api/projects/${encodeURIComponent(projectId)}/migration-books-of-work/${encodeURIComponent(bookOfWorkId)}`;
  const response = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
  if (!response.ok) {
    throw new MigrationReconcileBookReadError(response.status);
  }
  const dto = (await response.json()) as {
    book_of_work_json?: { items?: unknown[] } | null;
  } | null;
  const rawItems = (dto?.book_of_work_json?.items as unknown[]) || [];
  const items: ReconcileBookOfWorkItem[] = [];
  for (const raw of rawItems) {
    if (!raw || typeof raw !== 'object') continue;
    const obj = raw as Record<string, unknown>;
    const netNewOps =
      (obj.net_new_operations as string[] | null | undefined) ??
      (obj.netNewOperations as string[] | null | undefined) ??
      null;
    items.push({
      id: String(obj.id ?? ''),
      title: String(obj.title ?? ''),
      workItemId: (obj.workItemId as string | null | undefined) ?? null,
      provenance: (obj.provenance as string | null | undefined) ?? null,
      kind: (obj.kind as string | null | undefined) ?? null,
      netNewOperations: Array.isArray(netNewOps) ? netNewOps : null,
    });
  }
  return items;
}

/** Thin typed error so a book-of-work read failure is logged + skipped, not thrown. */
class MigrationReconcileBookReadError extends Error {
  constructor(public readonly status: number) {
    super(`AMS book-of-work read failed with status ${status}`);
    this.name = 'MigrationReconcileBookReadError';
  }
}

/** Build the default (production) reconcile-driver deps. */
export function defaultReconciliationDriverDeps(): ReconciliationDriverDeps {
  return {
    createReconciliationBreaks,
    getReconciliationBreaksForRun,
    getReconciliationBreaksByBugId,
    markReconciliationBreaksSent,
    patchReconciliationBreak,
    incrementReconciliationBreakAttempt,
    tripReconciliationBreakCircuitBreaker,
    patchMigrationExecutionRun,
    runHeadlessReconcile,
    validationDeps: defaultReconciliationValidationDeps(),
    resolveArchitectureForBaseline: defaultResolveArchitectureForBaseline,
    getTargetCredentials: (runId: string) => migrationTargetCredentialsStore.get(runId),
    implRequest: defaultImplRequest,
    circuitBreakerMaxAttempts: DEFAULT_CIRCUIT_BREAKER_MAX_ATTEMPTS,
    loadReconcileBookOfWork: defaultLoadReconcileBookOfWork,
  };
}

// ============================================================================
// Group 2 -- deployed -> FULL-baseline reconcile
// ============================================================================

/** The outcome of the full-baseline reconcile trigger. */
export type FullReconcileResult =
  | { status: 'reconciled'; breakCount: number; expectedNetNewCount: number; expectedVolatileCount: number }
  | { status: 'already_reconciled' }
  | { status: 'needs_target_credentials' }
  | { status: 'no_pinned_baseline' }
  | { status: 'reconcile_failed'; error: string };

/**
 * Map a diff_item to the break wire row. Only the SOFT reference + the inline
 * detail are carried (no break-payload duplication beyond the review snapshot).
 *
 * The `body_diff_json` snapshot carries the validation-service's `{ entries,
 * volatility_sources? }` shape VERBATIM -- the volatile-path metadata the
 * post-diff `expected_volatile` pass ({@link autoDisposeVolatileBreaks}) reads
 * off the break without re-walking the bodies.
 */
function diffItemToBreak(
  item: ReconciliationDiffItem,
  runId: string,
  pinnedBaselineId: string | null
): MigrationReconciliationBreak {
  return {
    run_id: runId,
    pinned_baseline_id: pinnedBaselineId,
    source_baseline_item_id: item.source_baseline_item_id ?? null,
    diff_item_id: item.id,
    disposition_status: BREAK_DISPOSITION.OPEN,
    attempt_count: 0,
    circuit_broken: false,
    needs_human: false,
    detail_json: {
      operation: `${(item.method ?? 'GET').toUpperCase()} ${item.path ?? '/'}`,
      method: item.method ?? null,
      path: item.path ?? null,
      scenario_name: item.scenario_name ?? null,
      status_classification: item.status_classification ?? null,
      body_classification: item.body_classification ?? null,
      source_response_status: item.source_response_status ?? null,
      target_response_status: item.target_response_status ?? null,
      body_diff_json: item.body_diff_json ?? null,
      notes: item.notes ?? null,
    },
  };
}

/**
 * Trigger the FULL-baseline reconcile on the `deployed` (no bug_id) outcome
 * (Group 2 -- fills the Driver `TODO(Spec 4)`).
 *
 * Reads the run's pinned `kind='current'` baseline (CD-1 oracle anchor) and
 * drives the headless reconciler against `target_base_url`. Replays the WHOLE
 * pinned baseline -- NOT scoped to migrated specs -- so deferred / un-migrated
 * stories surface as breaks too (CD-B). On completion, EVERY drifting diff_item
 * is mapped to a break and bulk-persisted keyed on run + source_baseline_item_id.
 *
 * IDEMPOTENT (CD-6): a re-fired `deployed` for a run that already has persisted
 * breaks (or is mid-reconcile) does NOT start a second concurrent reconcile.
 *
 * CREDS-ABSENT PAUSE (CD-2): if no target creds are registered for the run, the
 * run PAUSES in `needs_target_credentials` for the user to re-enter -- nothing
 * crashes and creds are never stored.
 *
 * Never throws -- a failure is captured on the run + returned, so the
 * build-results door still acknowledges.
 */
export async function triggerFullBaselineReconcile(
  run: MigrationExecutionRun,
  deps: ReconciliationDriverDeps
): Promise<FullReconcileResult> {
  const projectId = run.project_id ?? '';
  const runId = run.id ?? '';
  const pinnedBaselineId = run.pinned_current_baseline_id ?? null;
  const targetBaseUrl = run.target_base_url ?? null;

  if (!pinnedBaselineId) {
    // The oracle anchor is set at Migrate, which hard-blocks without one -- so
    // this is a hard signal, not a recoverable state.
    logger.error('[diag-gateway] migration_reconciliation no_pinned_baseline', {
      projectId,
      runId,
    });
    return { status: 'no_pinned_baseline' };
  }
  if (!targetBaseUrl) {
    logger.error('[diag-gateway] migration_reconciliation no_target_base_url', {
      projectId,
      runId,
    });
    return { status: 'reconcile_failed', error: 'no target_base_url on the run' };
  }

  // --- Idempotency: do not start a second reconcile for the same run. ---
  // A run already mid-reconcile or already carrying breaks is a no-op.
  if (run.status === RECONCILE_RUN_STATUS.RECONCILING) {
    logger.info('[diag-gateway] migration_reconciliation already_reconciling', { projectId, runId });
    return { status: 'already_reconciled' };
  }
  try {
    const existing = await deps.getReconciliationBreaksForRun(projectId, runId);
    if (existing.length > 0) {
      logger.info('[diag-gateway] migration_reconciliation already_reconciled', {
        projectId,
        runId,
        existingBreaks: existing.length,
      });
      return { status: 'already_reconciled' };
    }
  } catch (error) {
    // A read failure here should not block the reconcile; log + continue.
    logger.warn('[diag-gateway] migration_reconciliation existing_breaks_read_failed', {
      projectId,
      runId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }

  // --- Creds-absent pause (CD-2). ---
  const api = deps.getTargetCredentials(runId);
  if (!api) {
    logger.warn('[diag-gateway] migration_reconciliation needs_target_credentials', {
      projectId,
      runId,
    });
    await safePatchRun(deps, projectId, runId, {
      status: RECONCILE_RUN_STATUS.NEEDS_TARGET_CREDENTIALS,
    });
    return { status: 'needs_target_credentials' };
  }

  // --- Resolve the architecture for the pinned baseline (replay needs it). ---
  const architectureId = await deps.resolveArchitectureForBaseline(projectId, pinnedBaselineId);
  if (!architectureId) {
    logger.error('[diag-gateway] migration_reconciliation architecture_unresolved', {
      projectId,
      runId,
      pinnedBaselineId,
    });
    await safePatchRun(deps, projectId, runId, { status: RECONCILE_RUN_STATUS.RECONCILE_FAILED });
    return { status: 'reconcile_failed', error: 'could not resolve architecture for the pinned baseline' };
  }

  // --- Mark reconciling (the idempotency latch) + drive the reconcile. ---
  await safePatchRun(deps, projectId, runId, { status: RECONCILE_RUN_STATUS.RECONCILING });

  logger.info('[diag-gateway] migration_reconciliation full_reconcile_start', {
    projectId,
    runId,
    pinnedBaselineId,
    architectureId,
  });

  const reconcileCorr = { run: runId, project: projectId, arch: architectureId };
  trace.step('reconcile started — full baseline', reconcileCorr);

  const result: ReconciliationResult = await deps.runHeadlessReconcile(
    {
      projectId,
      architectureId,
      sourceBaselineId: pinnedBaselineId,
      targetBaseUrl,
      api,
    },
    deps.validationDeps,
    deps.pollOptions ?? {}
  );

  if (!result.ok) {
    logger.error('[diag-gateway] migration_reconciliation full_reconcile_failed', {
      projectId,
      runId,
      error: result.error ?? 'unknown',
    });
    trace.fail(`reconcile FAILED — ${result.error ?? 'unknown'}`, reconcileCorr);
    await safePatchRun(deps, projectId, runId, { status: RECONCILE_RUN_STATUS.RECONCILE_FAILED });
    return { status: 'reconcile_failed', error: result.error ?? 'reconcile failed' };
  }

  // --- Map EVERY drifting diff_item to a break (CD-B: full baseline). ---
  const breakRows = result.diffItems
    .filter(isDiffItemABreak)
    .map((item) => diffItemToBreak(item, runId, pinnedBaselineId));

  let createdBreaks: MigrationReconciliationBreak[] = [];
  if (breakRows.length > 0) {
    try {
      createdBreaks = await deps.createReconciliationBreaks(projectId, runId, breakRows);
      for (const b of createdBreaks) {
        const detail = (b.detail_json ?? {}) as Record<string, unknown>;
        trace.detail(
          'reconcile.break',
          {
            breakId: b.id ?? null,
            op: detail.method && detail.path ? `${detail.method} ${detail.path}` : (detail.summary ?? null),
            kind: detail.kind ?? null,
            severity: detail.severity ?? null,
            volatilitySource: detail.volatility_source ?? null,
            sourceBaselineItemId: b.source_baseline_item_id ?? null,
            disposition: b.disposition_status ?? null,
          },
          reconcileCorr,
        );
      }
    } catch (error) {
      logger.error('[diag-gateway] migration_reconciliation persist_breaks_failed', {
        projectId,
        runId,
        breakCount: breakRows.length,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      await safePatchRun(deps, projectId, runId, { status: RECONCILE_RUN_STATUS.RECONCILE_FAILED });
      return { status: 'reconcile_failed', error: 'failed to persist breaks' };
    }
  }

  // --- D6: post-diff net_new target_only auto-disposition pass (gateway-only).
  // The diff above stayed a PURE current-state diff (no provenance knowledge);
  // here -- AFTER the breaks are created (visible + auditable) -- a target_only
  // break whose normalised <METHOD> <path> matches an explicit net_new_operations
  // entry is auto-recognised as the ADDITIVE endpoint and dispositioned to
  // `expected_net_new`. This only RECORDS the additive endpoint; the pinned
  // current-state oracle is NEVER narrowed. Failure-isolated: it never fails the
  // reconcile (a match-source read error just leaves the target_only break open).
  const autoRecognisedCount = await autoDisposeNetNewTargetOnly(
    run,
    createdBreaks,
    deps
  );

  // --- 2026-06-16: post-diff `expected_volatile` auto-disposition pass.
  // SIBLING to the net_new pass above -- runs AFTER breaks are created so the
  // diff engine stays volatility-agnostic. Per break, reads the volatility
  // metadata the validation-service stamped on `detail_json.body_diff_json`
  // (`{ entries, volatility_sources }`) and:
  //   - divergence ENTIRELY on auto-terminal volatile paths -> PATCH
  //     `expected_volatile`, needs_human=false, audit note (paths + sources);
  //   - heuristic-only justification -> down-rank to `info`, stays open;
  //   - mixed (a non-volatile entry survived) -> stays open (real break);
  //   - no volatility metadata (non_json / not_probed / null) -> no disposition.
  // Nothing is ever DROPPED -- every outcome is a visible terminal or a visible
  // open break (the load-bearing invariant). Failure-isolated like the net_new
  // pass (a single PATCH failure just leaves the affected break open).
  const volatileDisposition = await autoDisposeVolatileBreaks(run, createdBreaks, deps);

  await safePatchRun(deps, projectId, runId, { status: RECONCILE_RUN_STATUS.RECONCILED });

  logger.info('[diag-gateway] migration_reconciliation full_reconcile_complete', {
    projectId,
    runId,
    diffItemCount: result.diffItems.length,
    breakCount: breakRows.length,
    netNewAutoRecognised: autoRecognisedCount,
    expectedVolatile: volatileDisposition.expectedVolatileCount,
    volatileDownRankedInfo: volatileDisposition.infoCount,
  });

  trace.detail(
    'reconcile.autoDisposition',
    {
      diffItemCount: result.diffItems.length,
      breakCount: breakRows.length,
      expectedNetNew: autoRecognisedCount,
      expectedVolatile: volatileDisposition.expectedVolatileCount,
      volatileDownRankedInfo: volatileDisposition.infoCount,
    },
    reconcileCorr,
  );
  const openBreaks = breakRows.length - autoRecognisedCount - volatileDisposition.expectedVolatileCount;
  trace.ok(`reconcile COMPLETED — ${breakRows.length} breaks (${openBreaks} open after auto-disposition)`, reconcileCorr);

  return {
    status: 'reconciled',
    breakCount: breakRows.length,
    expectedNetNewCount: autoRecognisedCount,
    expectedVolatileCount: volatileDisposition.expectedVolatileCount,
  };
}

/**
 * D6: the post-diff auto-disposition pass. For each CREATED `target_only` break
 * (a diff item with null `source_baseline_item_id`), compute its normalised
 * `<METHOD> <path>` key and match it against the run's book-of-work `net_new`
 * items' explicit `net_new_operations` (the AUTHORITATIVE, human-owned match
 * source). On a UNIQUE match the break is immediately PATCHed to the terminal
 * `expected_net_new` disposition (`needs_human=false`) with a `detail_json` audit
 * note naming the matched work item; an AMBIGUOUS match leaves the break `open`
 * but records the attempt; NO match leaves the break exactly as today.
 *
 * Only `target_only` breaks are considered -- ordinary breaks are never touched.
 * Returns the number of breaks auto-recognised (for the completion log). NEVER
 * throws: the whole pass is failure-isolated (a match-source read error or a
 * single PATCH failure just leaves the affected break open).
 */
async function autoDisposeNetNewTargetOnly(
  run: MigrationExecutionRun,
  createdBreaks: MigrationReconciliationBreak[],
  deps: ReconciliationDriverDeps
): Promise<number> {
  const projectId = run.project_id ?? '';
  const runId = run.id ?? '';
  const bookOfWorkId = run.book_of_work_id ?? '';

  // Only target_only breaks (null source_baseline_item_id) are candidates.
  const candidates = createdBreaks.filter(
    (b) => b.id && (b.source_baseline_item_id ?? null) === null
  );
  if (candidates.length === 0) return 0;
  if (!bookOfWorkId) {
    // No book of work on the run -> nothing to match against; leave breaks open.
    return 0;
  }

  // Read the run's book of work ONCE and build the net_new lookup. A read
  // failure must NOT fail the reconcile -- the target_only breaks just stay open.
  let lookup: NetNewOperationLookup;
  try {
    const bookItems = await deps.loadReconcileBookOfWork(projectId, bookOfWorkId);
    lookup = buildNetNewOperationLookup(bookItems);
  } catch (error) {
    logger.warn('[diag-gateway] migration_reconciliation net_new_book_read_failed', {
      projectId,
      runId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return 0;
  }
  // No net_new + api operations registered -> nothing can match; skip the writes.
  if (lookup.byKey.size === 0 && lookup.byPath.size === 0) return 0;

  let autoRecognised = 0;
  for (const brk of candidates) {
    const detail = (brk.detail_json ?? {}) as Record<string, unknown>;
    // Prefer the explicit method/path on the detail snapshot; fall back to
    // re-parsing the `operation` string `diffItemToBreak` already wrote.
    const method = (detail.method as string | null | undefined) ?? null;
    const path = (detail.path as string | null | undefined) ?? null;
    const match = matchTargetOnlyOperation(method, path, lookup);

    if (match.outcome === 'no_match') {
      // Leave the break exactly as today: a normal open break. No write.
      continue;
    }

    if (match.outcome === 'auto_recognised') {
      // CREATE-THEN-AUTO-DISPOSE: the break already exists; PATCH it terminal.
      const auditedDetail: Record<string, unknown> = {
        ...detail,
        net_new_match: {
          outcome: 'auto_recognised',
          matched_operation: match.key,
          matched_work_item_id: match.owner.workItemId,
          matched_book_item_id: match.owner.bookItemId,
          matched_work_item_title: match.owner.title,
          recognised_at: new Date().toISOString(),
          note:
            `Auto-recognised as an additive net_new endpoint: matched work item ` +
            `"${match.owner.title}"${match.owner.workItemId ? ` (${match.owner.workItemId})` : ''} ` +
            `via operation ${match.key}. The pinned current-state baseline is unchanged.`,
        },
      };
      await safePatchBreak(deps, projectId, brk.id as string, {
        disposition_status: BREAK_DISPOSITION.EXPECTED_NET_NEW,
        needs_human: false,
        detail_json: auditedDetail,
      });
      autoRecognised += 1;
      continue;
    }

    // AMBIGUOUS: leave it OPEN, but record WHY it was not auto-recognised so the
    // human sees the attempt (disposition is deliberately omitted from the patch
    // so the break stays in its created `open` state).
    const ambiguousDetail: Record<string, unknown> = {
      ...detail,
      net_new_match: {
        outcome: 'ambiguous',
        reason: match.reason,
        attempted_operation: match.key,
        candidate_work_item_ids: match.owners.map((o) => o.workItemId),
        candidate_operations: match.owners.map((o) => o.operationRaw),
        recognised_at: new Date().toISOString(),
        note:
          match.reason === 'multiple_owners'
            ? `Operation ${match.key} matched MULTIPLE net_new work items; left open for human disposition.`
            : `No exact net_new match for ${match.key}; a net_new work item declares a ` +
              `different method on the same path. Left open for human disposition.`,
      },
    };
    await safePatchBreak(deps, projectId, brk.id as string, {
      detail_json: ambiguousDetail,
    });
  }

  if (autoRecognised > 0) {
    logger.info('[diag-gateway] migration_reconciliation net_new_auto_recognised', {
      projectId,
      runId,
      autoRecognised,
      targetOnlyCandidates: candidates.length,
    });
  }
  return autoRecognised;
}

// ============================================================================
// 2026-06-16 -- post-diff `expected_volatile` auto-disposition pass
// ============================================================================

/** A volatility-disposition audit note recorded on a break's detail_json. */
function buildVolatilityAuditNote(
  outcome: 'expected_volatile' | 'info',
  sources: VolatilitySource[],
  paths: string[]
): Record<string, unknown> {
  const sourceList = sources.join(', ');
  const pathList = paths.length > 0 ? paths.join(', ') : '(whole-response)';
  const note =
    outcome === 'expected_volatile'
      ? `Auto-recognised as expected non-determinism: the body diverged ONLY on ` +
        `legitimately-volatile path(s) [${pathList}] (source: ${sourceList}). The pinned ` +
        `current-state oracle is unchanged; a deliberately-changed non-volatile value ` +
        `would still break. Human-overridable back to open via the disposition path.`
      : `Down-ranked to info: the divergence is justified ONLY by a conservative ` +
        `heuristic on path(s) [${pathList}] (source: ${sourceList}). A guess must never ` +
        `auto-close a break, so this stays OPEN for human review.`;
  return {
    outcome,
    sources,
    paths,
    recognised_at: new Date().toISOString(),
    note,
  };
}

/** The tally the `expected_volatile` pass returns for the run summary + log. */
export interface VolatileDispositionTally {
  /** Breaks auto-dispositioned to the terminal `expected_volatile`. */
  expectedVolatileCount: number;
  /** Breaks down-ranked to `info` (heuristic-only); they stay open. */
  infoCount: number;
}

/**
 * 2026-06-16: the post-diff `expected_volatile` auto-disposition pass (sibling to
 * {@link autoDisposeNetNewTargetOnly}). For each CREATED break, reads the
 * volatility metadata the validation-service stamped on
 * `detail_json.body_diff_json` (`{ entries, volatility_sources }`) and:
 *
 *   - ENTIRELY-VOLATILE (every justifying source is `probed` / `probed_partial`
 *     / `endpoint_signal` / `declared`, no surviving non-volatile drift) -> PATCH
 *     to the terminal `expected_volatile`, `needs_human=false`, audit note listing
 *     the tolerated paths + source(s) (reuses the net_new audit-note format);
 *   - HEURISTIC-ONLY -> down-rank to `info` (PATCH `disposition_status='info'`),
 *     stays OPEN -- a guess never auto-terminates;
 *   - MIXED (a non-volatile entry survived -> the comparator left a real
 *     `body_value_drift` / `body_shape_drift`) -> stays `open`; the volatile
 *     paths are still recorded on detail_json for the human;
 *   - NO volatility metadata (`non_json` / `not_probed` / `null`) -> strict, left
 *     exactly as today (no write).
 *
 * The INVARIANT (G2): no break ever DISAPPEARS -- every volatility outcome is
 * either `expected_volatile` (visible terminal) or stays open (`info` or the
 * untouched created state). NEVER throws: the whole pass is failure-isolated.
 */
export async function autoDisposeVolatileBreaks(
  run: MigrationExecutionRun,
  createdBreaks: MigrationReconciliationBreak[],
  deps: ReconciliationDriverDeps
): Promise<VolatileDispositionTally> {
  const projectId = run.project_id ?? '';
  const runId = run.id ?? '';

  let expectedVolatileCount = 0;
  let infoCount = 0;

  for (const brk of createdBreaks) {
    if (!brk.id) continue;
    // Never re-touch a break already in a terminal disposition (e.g. the net_new
    // pass above already auto-recognised it). The two passes are disjoint in
    // practice (net_new acts on target_only breaks which carry no source body
    // diff), but this guards the invariant explicitly.
    if ((TERMINAL_DISPOSITIONS as readonly string[]).includes(brk.disposition_status ?? '')) {
      continue;
    }

    const detail = (brk.detail_json ?? {}) as Record<string, unknown>;
    const classification = classifyBreakVolatility(detail);

    if (classification.outcome === 'none') {
      // No volatility metadata -> strict; leave the break exactly as today.
      continue;
    }

    if (classification.outcome === 'expected_volatile') {
      const auditedDetail: Record<string, unknown> = {
        ...detail,
        volatility_match: buildVolatilityAuditNote(
          'expected_volatile',
          classification.sources,
          classification.paths
        ),
      };
      await safePatchBreak(deps, projectId, brk.id, {
        disposition_status: BREAK_DISPOSITION.EXPECTED_VOLATILE,
        needs_human: false,
        detail_json: auditedDetail,
      });
      expectedVolatileCount += 1;
      continue;
    }

    if (classification.outcome === 'info') {
      // Heuristic-only -> down-rank to `info` (stays open + visible). A guess
      // never auto-terminates -- we move it to `info` and record the heuristic
      // paths so the human sees them in the same drawer.
      const auditedDetail: Record<string, unknown> = {
        ...detail,
        volatility_match: buildVolatilityAuditNote(
          'info',
          classification.sources,
          classification.paths
        ),
      };
      await safePatchBreak(deps, projectId, brk.id, {
        disposition_status: BREAK_DISPOSITION.INFO,
        needs_human: false,
        detail_json: auditedDetail,
      });
      infoCount += 1;
      continue;
    }

    // MIXED: a non-volatile entry survived -> stays `open` (the no-override
    // guard G3). Record the partial allowance so the human sees which paths were
    // tolerated, but DO NOT change the disposition.
    const mixedDetail: Record<string, unknown> = {
      ...detail,
      volatility_match: {
        outcome: 'mixed',
        sources: classification.sources,
        paths: classification.paths,
        recognised_at: new Date().toISOString(),
        note:
          `Some path(s) [${classification.paths.join(', ') || '(none)'}] are volatile ` +
          `(source: ${classification.sources.join(', ')}), but a NON-volatile value also ` +
          `diverged -- the non-volatile divergence is a real break. Left open for human review.`,
      },
    };
    await safePatchBreak(deps, projectId, brk.id, {
      detail_json: mixedDetail,
    });
  }

  if (expectedVolatileCount > 0 || infoCount > 0) {
    logger.info('[diag-gateway] migration_reconciliation volatile_auto_disposed', {
      projectId,
      runId,
      expectedVolatile: expectedVolatileCount,
      downRankedInfo: infoCount,
      breakCount: createdBreaks.length,
    });
  }

  return { expectedVolatileCount, infoCount };
}

/**
 * 2026-06-16: RETROACTIVELY apply a human-declared volatile path to the CURRENT
 * run (Q3). A path declared through the EXISTING break-detail / disposition UI is
 * persisted alongside the operation's other tolerated paths (tagged `declared`)
 * and applied IMMEDIATELY -- not forward-only. This re-evaluates and re-disposes
 * the ALREADY-OPEN breaks on the named operation:
 *
 *   - for each currently-OPEN break on the operation, the newly-declared path(s)
 *     are merged into the break's `body_diff_json` -- any value/order entry whose
 *     `path` is now declared is RE-TAGGED `volatilitySource='declared'` (so it no
 *     longer counts as a real drift), the distinct `volatility_sources` set is
 *     re-derived, and the body_classification is recomputed (`body_match` when
 *     the only remaining entries are tolerated). The break is then re-classified
 *     by {@link classifyBreakVolatility} and re-dispositioned exactly like the
 *     post-diff pass (terminal `expected_volatile`, `info`, or left open).
 *
 * This is the GATEWAY side of the retroactive declare (the frontend that captures
 * the declaration + persists it on the envelope is Group 5). It re-uses the
 * existing PATCH path -- no new AMS endpoint, no new mechanism. NEVER throws.
 *
 * The set of operations is matched on the SAME normalised `<METHOD> <path>` the
 * breaks carry on `detail_json.operation`. `breaks` is the current run's break
 * set (the caller reads it via `getReconciliationBreaksForRun`).
 */
export async function declareVolatilePaths(
  args: {
    projectId: string;
    /** The operation the human declared the path(s) on: `<METHOD> <path>`. */
    operation: string;
    /** The newly-declared JSON-Pointer path(s) (normalised, e.g. `/createdAt`). */
    declaredPaths: string[];
    /** The current run's breaks (the retroactive re-disposition scope). */
    breaks: MigrationReconciliationBreak[];
  },
  deps: ReconciliationDriverDeps
): Promise<{ reEvaluated: number; expectedVolatile: number; info: number }> {
  const declared = new Set(args.declaredPaths.filter((p) => typeof p === 'string' && p.length > 0));
  const operationKey = (args.operation ?? '').trim().toUpperCase();

  let reEvaluated = 0;
  let expectedVolatile = 0;
  let info = 0;

  for (const brk of args.breaks) {
    if (!brk.id) continue;
    // Only re-dispose breaks that are still OPEN -- a human-disposed / terminal
    // break is never silently re-touched (the no-silent-override invariant).
    if ((brk.disposition_status ?? '') !== BREAK_DISPOSITION.OPEN) continue;

    const detail = (brk.detail_json ?? {}) as Record<string, unknown>;
    const op = String(detail.operation ?? '').trim().toUpperCase();
    if (op !== operationKey) continue;
    if (declared.size === 0) continue;

    // Merge the declared path(s) into the break's body_diff_json by re-tagging
    // matching entries `declared`, then re-derive the volatility metadata.
    const merged = applyDeclaredPathsToDetail(detail, declared);
    if (!merged.changed) {
      // The declared path matched no entry on this break -> nothing to re-dispose.
      continue;
    }
    reEvaluated += 1;

    const classification = classifyBreakVolatility(merged.detail);

    if (classification.outcome === 'expected_volatile') {
      const auditedDetail: Record<string, unknown> = {
        ...merged.detail,
        volatility_match: buildVolatilityAuditNote(
          'expected_volatile',
          classification.sources,
          classification.paths
        ),
      };
      await safePatchBreak(deps, args.projectId, brk.id, {
        disposition_status: BREAK_DISPOSITION.EXPECTED_VOLATILE,
        needs_human: false,
        detail_json: auditedDetail,
      });
      expectedVolatile += 1;
    } else if (classification.outcome === 'info') {
      const auditedDetail: Record<string, unknown> = {
        ...merged.detail,
        volatility_match: buildVolatilityAuditNote(
          'info',
          classification.sources,
          classification.paths
        ),
      };
      await safePatchBreak(deps, args.projectId, brk.id, {
        disposition_status: BREAK_DISPOSITION.INFO,
        needs_human: false,
        detail_json: auditedDetail,
      });
      info += 1;
    } else {
      // MIXED / none after the merge -> persist the re-tagged detail so the human
      // sees the declared allowance, but leave the break open (a non-volatile
      // entry still survives).
      await safePatchBreak(deps, args.projectId, brk.id, {
        detail_json: merged.detail,
      });
    }
  }

  logger.info('[diag-gateway] migration_reconciliation volatile_declared_retroactive', {
    projectId: args.projectId,
    operation: args.operation,
    declaredPaths: args.declaredPaths,
    reEvaluated,
    expectedVolatile,
    info,
  });

  return { reEvaluated, expectedVolatile, info };
}

/**
 * Re-tag any `body_diff_json` entry whose `path` is in `declaredPaths` as
 * `volatilitySource='declared'` (so it is treated as tolerated), then re-derive
 * `volatility_sources` and `body_classification`. Returns a NEW detail object;
 * `changed=false` when no entry matched (so the caller can skip the write).
 *
 * Mirrors the validation-service comparator's classification semantics: a
 * tolerated value entry does NOT count toward drift; shape entries (key add /
 * remove / type change) ALWAYS break (volatility never tolerates shape).
 */
function applyDeclaredPathsToDetail(
  detail: Record<string, unknown>,
  declaredPaths: Set<string>
): { detail: Record<string, unknown>; changed: boolean } {
  const bodyDiff = (detail.body_diff_json ?? null) as Record<string, unknown> | null;
  const entries = bodyDiff && Array.isArray(bodyDiff.entries) ? (bodyDiff.entries as unknown[]) : null;
  if (!entries) {
    return { detail, changed: false };
  }

  let changed = false;
  const reTagged = entries.map((e) => {
    if (!e || typeof e !== 'object') return e;
    const entry = { ...(e as Record<string, unknown>) };
    const kind = entry.kind;
    const path = entry.path;
    // Only VALUE diffs can be tolerated by a declared path; shape diffs always
    // break (key add/remove/type change). An already-tagged entry is untouched.
    if (
      kind === 'value_changed' &&
      typeof path === 'string' &&
      declaredPaths.has(path) &&
      entry.volatilitySource === undefined
    ) {
      entry.volatilitySource = 'declared';
      changed = true;
    }
    return entry;
  });

  if (!changed) {
    return { detail, changed: false };
  }

  // Re-derive the distinct volatility_sources + the body_classification.
  const sources: string[] = [];
  let hasShape = false;
  let hasUntoleratedValue = false;
  for (const e of reTagged) {
    if (!e || typeof e !== 'object') continue;
    const entry = e as Record<string, unknown>;
    const tag = entry.volatilitySource;
    if (typeof tag === 'string' && !sources.includes(tag)) sources.push(tag);
    const kind = entry.kind;
    if (kind === 'key_added' || kind === 'key_removed' || kind === 'type_changed') {
      hasShape = true;
    } else if (kind === 'value_changed' && tag === undefined) {
      hasUntoleratedValue = true;
    }
  }

  const bodyClassification = hasShape
    ? 'body_shape_drift'
    : hasUntoleratedValue
      ? 'body_value_drift'
      : 'body_match';

  const newBodyDiff: Record<string, unknown> = {
    ...(bodyDiff as Record<string, unknown>),
    entries: reTagged,
    ...(sources.length > 0 ? { volatility_sources: sources } : {}),
  };

  return {
    detail: {
      ...detail,
      body_diff_json: newBodyDiff,
      body_classification: bodyClassification,
    },
    changed: true,
  };
}

// ============================================================================
// Group 3 -- human-gated bug send + non-sent dispositions
// ============================================================================

/** The snake_case CreateBugRequest body (CD-3 -- matches the pinned doc). */
export interface CreateBugRequestBody {
  company: string;
  project: string;
  bug_type: string;
  title: string;
  bug_description: string;
  callback_url?: string | null;
  attachments?: Array<{ filename: string; content_type: string; data: string }>;
}

/** The outcome of a bug send. */
export type SendBugResult =
  | { status: 'sent'; bugId: string; breakCount: number }
  | { status: 'no_breaks' }
  | { status: 'send_failed'; error: string };

/** Build one BreakEvidence entry from a break's persisted detail snapshot. */
function breakToEvidence(b: MigrationReconciliationBreak): Record<string, unknown> {
  const detail = (b.detail_json ?? {}) as Record<string, unknown>;
  return {
    operation: detail.operation ?? `${detail.method ?? 'GET'} ${detail.path ?? '/'}`,
    request: detail.request ?? null,
    expected_response: {
      status: detail.source_response_status ?? null,
    },
    actual_response: {
      status: detail.target_response_status ?? null,
    },
    diff: detail.body_diff_json ?? detail.notes ?? null,
  };
}

/** One prose line per break for the single `bug_description` (CD-5). */
function breakToProseLine(b: MigrationReconciliationBreak): string {
  const detail = (b.detail_json ?? {}) as Record<string, unknown>;
  const op = (detail.operation as string) ?? `${detail.method ?? 'GET'} ${detail.path ?? '/'}`;
  const src = detail.source_response_status ?? 'n/a';
  const tgt = detail.target_response_status ?? 'n/a';
  return `${op} — current=${String(src)} target=${String(tgt)} — please investigate.`;
}

/**
 * The HUMAN GATE (Group 3): send the user-SELECTED batch of breaks as ONE bug
 * report (CD-4 + CD-5). Builds a snake_case `CreateBugRequest` (CD-3) with one
 * prose entry per break + a `breaks.json` `BreakEvidence[]` attachment + the
 * gateway's own `callback_url`, POSTs it via the authed proxy seam (no LLM),
 * then stamps the returned `bug_id` on the breaks (`sent_as_bug`, attempt 1).
 *
 * Nothing auto-sends -- this is invoked only by the explicit user action. The
 * external service assigns + returns the `bug_id`.
 */
export async function sendBugForBreaks(
  args: {
    projectId: string;
    company: string;
    project: string;
    breaks: MigrationReconciliationBreak[];
    callbackUrl: string;
    title?: string;
  },
  deps: ReconciliationDriverDeps
): Promise<SendBugResult> {
  const sendable = args.breaks.filter(
    (b) => b.id && !(TERMINAL_DISPOSITIONS as readonly string[]).includes(b.disposition_status ?? '')
  );
  if (sendable.length === 0) {
    return { status: 'no_breaks' };
  }

  const bugDescription = sendable.map(breakToProseLine).join('\n');
  const evidence = sendable.map(breakToEvidence);
  const breaksJson = JSON.stringify(evidence);
  const body: CreateBugRequestBody = {
    company: args.company,
    project: args.project,
    bug_type: 'reconciliation',
    title:
      args.title ??
      `Reconciliation breaks (${sendable.length}) — migrated target diverges from current-state baseline`,
    bug_description: bugDescription,
    // Send Haikai's build-results URL on EVERY bug report while the
    // verification service is external (CD-3).
    callback_url: args.callbackUrl,
    attachments: [
      {
        filename: 'breaks.json',
        content_type: 'application/json',
        // base64 the lossless evidence array (BugAttachment.data is base64).
        data: Buffer.from(breaksJson, 'utf-8').toString('base64'),
      },
    ],
  };

  const verdictCorr = { project: args.project };
  trace.detail(
    'reconcile.verdict.request',
    {
      endpoint: 'POST /api/v2/bugs',
      bugType: body.bug_type,
      breakCount: sendable.length,
      title: body.title,
    },
    verdictCorr,
  );
  let bugId: string;
  try {
    const response = await deps.implRequest('/api/v2/bugs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body,
    });
    const json = (await response.json().catch(() => null)) as
      | { bug_id?: string; bugId?: string }
      | null;
    const resolvedBugId = json?.bug_id ?? json?.bugId ?? null;
    trace.detail(
      'reconcile.verdict.response',
      { status: response.status, ok: response.ok, bugId: resolvedBugId },
      verdictCorr,
    );
    if (!response.ok || !resolvedBugId) {
      logger.error('[diag-gateway] migration_reconciliation bug_send_non_ok', {
        projectId: args.projectId,
        status: response.status,
      });
      trace.fail(`verdict (bug) send failed — status ${response.status}`, verdictCorr);
      return { status: 'send_failed', error: `bug send returned status ${response.status}` };
    }
    bugId = resolvedBugId;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('[diag-gateway] migration_reconciliation bug_send_failed', {
      projectId: args.projectId,
      error: message,
    });
    return { status: 'send_failed', error: message };
  }

  // Stamp the bug_id on the breaks (sent_as_bug, attempt 1) -- the AMS mark-sent
  // endpoint does the disposition transition + attempt stamp atomically.
  try {
    await deps.markReconciliationBreaksSent(
      args.projectId,
      bugId,
      sendable.map((b) => b.id as string)
    );
  } catch (error) {
    logger.error('[diag-gateway] migration_reconciliation mark_sent_failed', {
      projectId: args.projectId,
      bugId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    // The bug WAS sent; surface the persistence failure but report sent.
  }

  logger.info('[diag-gateway] migration_reconciliation bug_sent', {
    projectId: args.projectId,
    bugId,
    breakCount: sendable.length,
  });
  trace.ok(`verdict posted — bug ${bugId} (${sendable.length} breaks)`, {
    bug: bugId,
    project: args.project,
  });
  return { status: 'sent', bugId, breakCount: sendable.length };
}

/** The disposition the human assigns to a non-sent break. */
export type NonSentDisposition =
  | typeof BREAK_DISPOSITION.ACCEPTED
  | typeof BREAK_DISPOSITION.WONT_REPORT
  | typeof BREAK_DISPOSITION.INTENTIONAL_DEVIATION
  // D6/D7: a human may also re-classify a break INTO `expected_net_new` (e.g. the
  // auto-match missed) or OUT of it (the auto-match was wrong -> back to a real
  // disposition) via the same path. No new mechanism.
  | typeof BREAK_DISPOSITION.EXPECTED_NET_NEW
  // 2026-06-16: a human may also re-classify INTO / OUT of `expected_volatile`
  // (override the auto-rule) or back to `open` via the same disposition path.
  | typeof BREAK_DISPOSITION.EXPECTED_VOLATILE
  | typeof BREAK_DISPOSITION.OPEN;

const VALID_NON_SENT_DISPOSITIONS = new Set<string>([
  BREAK_DISPOSITION.ACCEPTED,
  BREAK_DISPOSITION.WONT_REPORT,
  BREAK_DISPOSITION.INTENTIONAL_DEVIATION,
  // D6/D7: human override moves a break into/out of `expected_net_new`.
  BREAK_DISPOSITION.EXPECTED_NET_NEW,
  // 2026-06-16: human override into/out of `expected_volatile` and back to `open`
  // (the human-overridable terminal-state requirement -- a wrong auto-recognition
  // can be reversed with one action via this same path).
  BREAK_DISPOSITION.EXPECTED_VOLATILE,
  BREAK_DISPOSITION.OPEN,
]);

/** The outcome of a disposition assignment. */
export type DisposeResult =
  | { status: 'disposed'; count: number }
  | { status: 'invalid_disposition' };

/**
 * Assign a TERMINAL human disposition to breaks the human will NOT send (Group
 * 3): `accepted` | `wont_report` | `intentional_deviation`. This is how
 * intentional deviations (edited specs / deferred stories) are handled WITHOUT
 * changing the oracle (CD-A). Each break is PATCHed to the disposition; nothing
 * is sent and nothing is re-run.
 */
export async function disposeBreaks(
  args: {
    projectId: string;
    breakIds: string[];
    disposition: string;
    errorDetail?: string | null;
  },
  deps: ReconciliationDriverDeps
): Promise<DisposeResult> {
  if (!VALID_NON_SENT_DISPOSITIONS.has(args.disposition)) {
    return { status: 'invalid_disposition' };
  }
  let count = 0;
  for (const breakId of args.breakIds) {
    try {
      await deps.patchReconciliationBreak(args.projectId, breakId, {
        disposition_status: args.disposition,
        // Disposed deviations need no human queue + are not broken-open.
        needs_human: false,
        error_detail: args.errorDetail ?? null,
      });
      count += 1;
    } catch (error) {
      logger.warn('[diag-gateway] migration_reconciliation dispose_break_failed', {
        projectId: args.projectId,
        breakId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
  logger.info('[diag-gateway] migration_reconciliation breaks_disposed', {
    projectId: args.projectId,
    disposition: args.disposition,
    count,
  });
  return { status: 'disposed', count };
}

// ============================================================================
// Group 4 -- bug_id callback -> scoped re-reconcile + circuit breaker
// ============================================================================

/** The outcome of a bug-fix callback. */
export type BugCallbackResult =
  | { status: 'fixed_confirmed'; breakCount: number }
  | { status: 'still_broken'; breakCount: number }
  | { status: 'circuit_broken_escalated'; breakCount: number }
  | { status: 'escalated_no_rerun'; breakCount: number }
  | { status: 'noop_idempotent' }
  | { status: 'unknown_bug' }
  | { status: 'needs_target_credentials' }
  | { status: 'reconcile_failed'; error: string };

/**
 * Handle a `bug_id` build-results callback (Group 4 -- fills the bug_id seam).
 *
 *   - `deployed` (a fix redeploy) -> SCOPED re-reconcile of ONLY that bug's
 *     breaks (resolved via each `source_baseline_item_id`): drive a fresh
 *     replay+diff against `target_base_url`, then judge ONLY the affected source
 *     operations. Clean -> `fixed_confirmed`. Still broken -> attempt++ and the
 *     circuit breaker is checked: under the cap -> `still_broken` (eligible for
 *     a human re-send -- the Group 3 gate still applies, NO auto-send); on trip
 *     -> `circuit_broken_escalated` + needs_human (terminal, NO auto-loop).
 *   - `failed` / `rejected` -> terminal `circuit_broken_escalated` + needs_human
 *     (no re-run).
 *
 * IDEMPOTENT (CD-6): a duplicate callback whose breaks are ALL already terminal
 * is a no-op. Never throws.
 */
export async function handleBugCallback(
  args: {
    projectId: string;
    runId: string | null;
    bugId: string;
    // `deployed` triggers the scoped re-reconcile; any other terminal outcome
    // (failed | error | rejected | fix_unserved | not_fixed) escalates inline.
    outcome: string;
    targetBaseUrl: string | null;
    pinnedBaselineId: string | null;
    summary?: string | null;
  },
  deps: ReconciliationDriverDeps
): Promise<BugCallbackResult> {
  const { projectId, bugId, outcome } = args;

  // Resolve that bug's breaks.
  let breaks: MigrationReconciliationBreak[];
  try {
    breaks = await deps.getReconciliationBreaksByBugId(projectId, bugId);
  } catch (error) {
    logger.error('[diag-gateway] migration_reconciliation bug_breaks_read_failed', {
      projectId,
      bugId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return { status: 'reconcile_failed', error: 'failed to read the bug breaks' };
  }
  if (breaks.length === 0) {
    logger.warn('[diag-gateway] migration_reconciliation unknown_bug', { projectId, bugId });
    return { status: 'unknown_bug' };
  }

  // Idempotency: a callback whose breaks are ALL already terminal is a no-op.
  const nonTerminal = breaks.filter(
    (b) => !(TERMINAL_DISPOSITIONS as readonly string[]).includes(b.disposition_status ?? '')
  );
  if (nonTerminal.length === 0) {
    logger.info('[diag-gateway] migration_reconciliation bug_callback_noop_idempotent', {
      projectId,
      bugId,
      outcome,
    });
    return { status: 'noop_idempotent' };
  }

  // --- any non-deployed terminal outcome: escalate without a re-run. ---
  // (failed | error | rejected | fix_unserved | not_fixed)
  if (outcome !== 'deployed') {
    for (const b of nonTerminal) {
      if (!b.id) continue;
      await safeTrip(deps, projectId, b.id, {
        circuitBroken: true,
        needsHuman: true,
        errorDetail: args.summary ?? `Bug ${outcome}: no re-run, escalated to human review.`,
      });
    }
    logger.info('[diag-gateway] migration_reconciliation bug_escalated_no_rerun', {
      projectId,
      bugId,
      outcome,
      breakCount: nonTerminal.length,
    });
    return { status: 'escalated_no_rerun', breakCount: nonTerminal.length };
  }

  // --- deployed: SCOPED re-reconcile of ONLY this bug's breaks. ---
  const pinnedBaselineId = args.pinnedBaselineId;
  const targetBaseUrl = args.targetBaseUrl;
  if (!pinnedBaselineId || !targetBaseUrl) {
    return { status: 'reconcile_failed', error: 'missing pinned baseline or target_base_url for re-reconcile' };
  }

  const api = args.runId ? deps.getTargetCredentials(args.runId) : undefined;
  if (!api) {
    logger.warn('[diag-gateway] migration_reconciliation rereconcile_needs_credentials', {
      projectId,
      bugId,
      runId: args.runId,
    });
    return { status: 'needs_target_credentials' };
  }

  const architectureId = await deps.resolveArchitectureForBaseline(projectId, pinnedBaselineId);
  if (!architectureId) {
    return { status: 'reconcile_failed', error: 'could not resolve architecture for the pinned baseline' };
  }

  // The set of affected source operations (the CD-6 scope keys).
  const affectedSourceItemIds = new Set(
    nonTerminal
      .map((b) => b.source_baseline_item_id)
      .filter((v): v is string => typeof v === 'string' && v.length > 0)
  );

  logger.info('[diag-gateway] migration_reconciliation scoped_rereconcile_start', {
    projectId,
    bugId,
    affectedSourceOps: affectedSourceItemIds.size,
  });

  // Drive a fresh replay+diff (the engine has no per-operation entry point);
  // the JUDGEMENT below is scoped to ONLY the affected source operations.
  const result = await deps.runHeadlessReconcile(
    { projectId, architectureId, sourceBaselineId: pinnedBaselineId, targetBaseUrl, api },
    deps.validationDeps,
    deps.pollOptions ?? {}
  );
  if (!result.ok) {
    logger.error('[diag-gateway] migration_reconciliation scoped_rereconcile_failed', {
      projectId,
      bugId,
      error: result.error ?? 'unknown',
    });
    return { status: 'reconcile_failed', error: result.error ?? 'scoped re-reconcile failed' };
  }

  // Which of the affected source operations STILL drift after the fix?
  const stillDriftingSourceItemIds = new Set(
    result.diffItems
      .filter(isDiffItemABreak)
      .map((item) => item.source_baseline_item_id)
      .filter((v): v is string => typeof v === 'string' && affectedSourceItemIds.has(v))
  );

  let anyStillBroken = false;
  let anyTripped = false;

  for (const b of nonTerminal) {
    if (!b.id) continue;
    const sourceItemId = b.source_baseline_item_id ?? '';
    const stillBroken = !sourceItemId || stillDriftingSourceItemIds.has(sourceItemId);

    if (!stillBroken) {
      // The scoped re-reconcile is now clean for this break -> confirm the fix.
      await safePatchBreak(deps, projectId, b.id, {
        disposition_status: BREAK_DISPOSITION.FIXED_CONFIRMED,
        needs_human: false,
        error_detail: null,
      });
      continue;
    }

    // Still broken -> increment the attempt counter, then check the breaker.
    anyStillBroken = true;
    let attemptCount = (b.attempt_count ?? 0) + 1;
    try {
      const updated = await deps.incrementReconciliationBreakAttempt(projectId, b.id);
      if (typeof updated.attempt_count === 'number') attemptCount = updated.attempt_count;
    } catch (error) {
      logger.warn('[diag-gateway] migration_reconciliation increment_attempt_failed', {
        projectId,
        breakId: b.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    if (attemptCount >= deps.circuitBreakerMaxAttempts) {
      // TRIP: escalate to human review (terminal, NO auto-loop).
      anyTripped = true;
      trace.warn(
        `circuit breaker tripped after ${attemptCount} attempts (cap ${deps.circuitBreakerMaxAttempts}) — escalated to human review`,
        { run: args.runId ?? undefined, bug: bugId, project: projectId },
      );
      await safeTrip(deps, projectId, b.id, {
        circuitBroken: true,
        needsHuman: true,
        errorDetail:
          `Circuit breaker tripped after ${attemptCount} attempts ` +
          `(cap ${deps.circuitBreakerMaxAttempts}); escalated to human review.`,
      });
    } else {
      // Under the cap -> reopen as still_broken (eligible for a HUMAN re-send;
      // the Group 3 gate still applies -- we do NOT auto-send).
      await safePatchBreak(deps, projectId, b.id, {
        disposition_status: BREAK_DISPOSITION.STILL_BROKEN,
        needs_human: false,
      });
    }
  }

  if (anyTripped) {
    logger.info('[diag-gateway] migration_reconciliation circuit_broken_escalated', {
      projectId,
      bugId,
      breakCount: nonTerminal.length,
    });
    return { status: 'circuit_broken_escalated', breakCount: nonTerminal.length };
  }
  if (anyStillBroken) {
    logger.info('[diag-gateway] migration_reconciliation rereconcile_still_broken', {
      projectId,
      bugId,
      breakCount: nonTerminal.length,
    });
    return { status: 'still_broken', breakCount: nonTerminal.length };
  }

  logger.info('[diag-gateway] migration_reconciliation rereconcile_fixed_confirmed', {
    projectId,
    bugId,
    breakCount: nonTerminal.length,
  });
  return { status: 'fixed_confirmed', breakCount: nonTerminal.length };
}

// ============================================================================
// Internal safe-patch helpers (failure isolation)
// ============================================================================

async function safePatchRun(
  deps: ReconciliationDriverDeps,
  projectId: string,
  runId: string,
  patch: MigrationExecutionRun
): Promise<void> {
  try {
    await deps.patchMigrationExecutionRun(projectId, runId, patch);
  } catch (error) {
    logger.warn('[diag-gateway] migration_reconciliation patch_run_failed', {
      projectId,
      runId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

async function safePatchBreak(
  deps: ReconciliationDriverDeps,
  projectId: string,
  breakId: string,
  patch: MigrationReconciliationBreak
): Promise<void> {
  try {
    await deps.patchReconciliationBreak(projectId, breakId, patch);
  } catch (error) {
    logger.warn('[diag-gateway] migration_reconciliation patch_break_failed', {
      projectId,
      breakId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

async function safeTrip(
  deps: ReconciliationDriverDeps,
  projectId: string,
  breakId: string,
  args: { circuitBroken: boolean; needsHuman: boolean; errorDetail?: string | null }
): Promise<void> {
  try {
    await deps.tripReconciliationBreakCircuitBreaker(projectId, breakId, args);
  } catch (error) {
    logger.warn('[diag-gateway] migration_reconciliation trip_breaker_failed', {
      projectId,
      breakId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

// Keep RUN_STATUS referenced for downstream callers that thread Spec-3 states.
export { RUN_STATUS };
