/**
 * Migration Reconciliation Break-Store Client (gateway -> AMS).
 *
 * The thin, typed seam over the AMS break <-> bug lifecycle + disposition
 * endpoints (Liquibase changeset 183 / `MigrationReconciliationBreakController`)
 * the gateway reconcile + bug loop (Specs 4, Task Groups 2/3/4) reads and
 * mutates. A "break" == a drifting `api_behaviour_diff_item`: the migrated
 * target diverged from the pinned current-state oracle for the same request.
 *
 * Endpoints (all AMS-direct, under `/api/projects/{projectId}`):
 *   - POST   .../migration-execution-runs/{runId}/reconciliation-breaks
 *            bulk-create breaks from a completed reconcile result (keyed on the
 *            run + pinned baseline + each `source_baseline_item_id` scope key);
 *   - GET    .../migration-execution-runs/{runId}/reconciliation-breaks
 *            read a run's breaks (oldest-first) for the review surface;
 *   - GET    .../reconciliation-breaks/by-bug-id/{bugId}
 *            resolve the breaks behind a bug-fix callback (Group 4);
 *   - GET    .../reconciliation-breaks?source_baseline_item_id=...
 *            resolve break(s) for a replayable source operation (CD-6 key);
 *   - PATCH  .../reconciliation-breaks/{breakId}
 *            update a break's disposition / flags (null-guarded boxed types);
 *   - PATCH  .../reconciliation-breaks/{breakId}/attempt
 *            increment the circuit-breaker attempt counter;
 *   - PATCH  .../reconciliation-breaks/{breakId}/circuit-breaker
 *            trip the breaker / escalate to human review;
 *   - POST   .../reconciliation-breaks/mark-sent
 *            stamp the `bug_id` on a batch + move them to `sent_as_bug`.
 *
 * Wire shape is snake_case (the AMS global default). These functions are the DI
 * seam the reconcile driver + bug loop mock in unit tests; they throw a typed
 * {@link MigrationBreakStoreError} on a non-2xx so a single failure can be
 * isolated without aborting the whole loop.
 *
 * Spec: Migration Reconciliation + Bug Loop (2026-06-14, Spec 4 of 4) --
 * Task Groups 2/3/4.
 */

import { getConfig } from '../config';
import { logger } from './logger';

// ============================================================================
// Disposition lifecycle vocabulary (mirror MigrationReconciliationBreakStatus)
// ============================================================================

/** The break disposition-lifecycle status values (AMS TEXT column). */
export const BREAK_DISPOSITION = {
  // --- machine states (deploy -> reconcile -> bug -> re-reconcile loop) ---
  OPEN: 'open',
  SENT_AS_BUG: 'sent_as_bug',
  FIXED_CONFIRMED: 'fixed_confirmed',
  STILL_BROKEN: 'still_broken',
  CIRCUIT_BROKEN_ESCALATED: 'circuit_broken_escalated',
  // --- human dispositions (terminal; never re-run) ---
  ACCEPTED: 'accepted',
  WONT_REPORT: 'wont_report',
  INTENTIONAL_DEVIATION: 'intentional_deviation',
  // --- D6: machine-set terminal disposition for a recognised net_new endpoint ---
  // A `target_only` diff whose normalised `<METHOD> <path>` matches an explicit
  // `net_new_operations` entry is auto-recognised as the ADDITIVE endpoint (NOT a
  // deviation -- distinct from `intentional_deviation`). It is set by the gateway
  // post-diff auto-disposition pass (machine, not human), is terminal (never
  // re-run), but stays human-overridable via the existing disposition path. A
  // plain TEXT value -- NO changeset (mirrors AMS `MigrationReconciliationBreakStatus`).
  EXPECTED_NET_NEW: 'expected_net_new',
  // --- 2026-06-16: machine-set terminal disposition for a volatile-only break ---
  // A break whose body diverged ENTIRELY on legitimately-volatile JSON paths
  // (measured by the capture-time probe, signalled by `non_deterministic_endpoint`,
  // or operator-declared) is auto-recognised as expected non-determinism. Set by the
  // gateway post-diff `expected_volatile` auto-disposition pass (machine, not human),
  // is terminal (never re-run), but stays human-overridable via the existing
  // disposition path. A deliberately-changed NON-volatile value still breaks (the
  // load-bearing oracle invariant). Plain TEXT -- NO changeset (mirrors AMS
  // `MigrationReconciliationBreakStatus.EXPECTED_VOLATILE`).
  EXPECTED_VOLATILE: 'expected_volatile',
  // --- 2026-06-16: machine-set DOWN-RANK marker for a heuristic-only break ---
  // A break justified ONLY by conservative timestamp/UUID heuristics is NOT
  // auto-terminated (a guess must never silently absorb a real break). It is
  // down-ranked to `info` and stays OPEN + visible (it is NOT terminal). Plain
  // TEXT -- NO changeset; an `info` break is just an `open` break carrying a
  // visible down-rank marker for the review surface.
  INFO: 'info',
} as const;

/** The terminal human dispositions: once set, never sent, never re-run (CD-A). */
export const TERMINAL_HUMAN_DISPOSITIONS: readonly string[] = [
  BREAK_DISPOSITION.ACCEPTED,
  BREAK_DISPOSITION.WONT_REPORT,
  BREAK_DISPOSITION.INTENTIONAL_DEVIATION,
];

/** The terminal lifecycle states (closed-clean OR escalated). */
export const TERMINAL_DISPOSITIONS: readonly string[] = [
  ...TERMINAL_HUMAN_DISPOSITIONS,
  BREAK_DISPOSITION.FIXED_CONFIRMED,
  BREAK_DISPOSITION.CIRCUIT_BROKEN_ESCALATED,
  // D6: an auto-recognised net_new endpoint is terminal (never sent, never
  // re-run) -- like a human disposition but machine-set.
  BREAK_DISPOSITION.EXPECTED_NET_NEW,
  // 2026-06-16: an auto-recognised volatile-only break is terminal (machine-set,
  // human-overridable). `info` is deliberately NOT terminal -- it stays open.
  BREAK_DISPOSITION.EXPECTED_VOLATILE,
];

// ============================================================================
// Wire types (snake_case -- mirror MigrationReconciliationBreakDto)
// ============================================================================

/** A single behavioural BREAK in a reconcile run (AMS changeset 183). */
export interface MigrationReconciliationBreak {
  id?: string;
  run_id?: string | null;
  /** The kind='current' baseline this was reconciled against (CD-1 oracle). */
  pinned_baseline_id?: string | null;
  /** The replayable source baseline_item behind the break (CD-6 scope key). */
  source_baseline_item_id?: string | null;
  /** The referenced api_behaviour_diff_item (soft ref; no payload duplication). */
  diff_item_id?: string | null;
  /** Inline break detail (method/path/summary/diff) for the review surface. */
  detail_json?: Record<string, unknown> | null;
  disposition_status?: string | null;
  bug_id?: string | null;
  /** The circuit-breaker attempt counter (boxed; defaults 0). */
  attempt_count?: number | null;
  circuit_broken?: boolean | null;
  needs_human?: boolean | null;
  error_detail?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

/** Typed AMS break-store error carrying the upstream status + body. */
export class MigrationBreakStoreError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown
  ) {
    super(`AMS break-store request failed with status ${status}`);
    this.name = 'MigrationBreakStoreError';
  }
}

// ============================================================================
// Helpers
// ============================================================================

async function readBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    try {
      return await response.text();
    } catch {
      return undefined;
    }
  }
}

function baseUrl(): string {
  return getConfig().architectureModelServiceBaseUrl;
}

// ============================================================================
// Endpoints
// ============================================================================

/**
 * POST .../migration-execution-runs/{runId}/reconciliation-breaks -- bulk-create
 * the breaks from a completed reconcile result. The `runId` binds every break;
 * each carries the pinned-baseline oracle anchor + a `source_baseline_item_id`
 * scope key. Returns the persisted breaks (with their AMS ids).
 */
export async function createReconciliationBreaks(
  projectId: string,
  runId: string,
  breaks: MigrationReconciliationBreak[]
): Promise<MigrationReconciliationBreak[]> {
  const url =
    `${baseUrl()}/api/projects/${encodeURIComponent(projectId)}` +
    `/migration-execution-runs/${encodeURIComponent(runId)}/reconciliation-breaks`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ breaks }),
  });
  const body = await readBody(response);
  if (!response.ok) {
    logger.warn('[diag-gateway] migration_reconciliation create_breaks AMS non-OK', {
      projectId,
      runId,
      status: response.status,
    });
    throw new MigrationBreakStoreError(response.status, body);
  }
  return (Array.isArray(body) ? body : []) as MigrationReconciliationBreak[];
}

/**
 * GET .../migration-execution-runs/{runId}/reconciliation-breaks -- read a run's
 * breaks (oldest-first) for the review surface + the idempotency check.
 */
export async function getReconciliationBreaksForRun(
  projectId: string,
  runId: string
): Promise<MigrationReconciliationBreak[]> {
  const url =
    `${baseUrl()}/api/projects/${encodeURIComponent(projectId)}` +
    `/migration-execution-runs/${encodeURIComponent(runId)}/reconciliation-breaks`;
  const response = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
  const body = await readBody(response);
  if (!response.ok) {
    throw new MigrationBreakStoreError(response.status, body);
  }
  return (Array.isArray(body) ? body : []) as MigrationReconciliationBreak[];
}

/**
 * GET .../reconciliation-breaks/by-bug-id/{bugId} -- resolve the breaks behind a
 * bug-fix callback (Group 4 scoped re-reconcile).
 */
export async function getReconciliationBreaksByBugId(
  projectId: string,
  bugId: string
): Promise<MigrationReconciliationBreak[]> {
  const url =
    `${baseUrl()}/api/projects/${encodeURIComponent(projectId)}` +
    `/reconciliation-breaks/by-bug-id/${encodeURIComponent(bugId)}`;
  const response = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
  const body = await readBody(response);
  if (!response.ok) {
    throw new MigrationBreakStoreError(response.status, body);
  }
  return (Array.isArray(body) ? body : []) as MigrationReconciliationBreak[];
}

/**
 * GET .../reconciliation-breaks?source_baseline_item_id=... -- resolve break(s)
 * for a replayable source operation (the CD-6 scoped-re-reconcile key).
 */
export async function getReconciliationBreaksBySourceItem(
  projectId: string,
  sourceBaselineItemId: string
): Promise<MigrationReconciliationBreak[]> {
  const url =
    `${baseUrl()}/api/projects/${encodeURIComponent(projectId)}` +
    `/reconciliation-breaks?source_baseline_item_id=${encodeURIComponent(sourceBaselineItemId)}`;
  const response = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
  const body = await readBody(response);
  if (!response.ok) {
    throw new MigrationBreakStoreError(response.status, body);
  }
  return (Array.isArray(body) ? body : []) as MigrationReconciliationBreak[];
}

/**
 * PATCH .../reconciliation-breaks/{breakId} -- update a break's disposition /
 * flags. Omitted fields are no-ops (AMS null-guards every boxed column per
 * `project_primitive_double_dto_overwrite.md`).
 */
export async function patchReconciliationBreak(
  projectId: string,
  breakId: string,
  patch: MigrationReconciliationBreak
): Promise<MigrationReconciliationBreak> {
  const url =
    `${baseUrl()}/api/projects/${encodeURIComponent(projectId)}` +
    `/reconciliation-breaks/${encodeURIComponent(breakId)}`;
  const response = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(patch),
  });
  const body = await readBody(response);
  if (!response.ok) {
    throw new MigrationBreakStoreError(response.status, body);
  }
  return body as MigrationReconciliationBreak;
}

/**
 * PATCH .../reconciliation-breaks/{breakId}/attempt -- increment the
 * circuit-breaker attempt counter (non-destructive of the other columns).
 */
export async function incrementReconciliationBreakAttempt(
  projectId: string,
  breakId: string
): Promise<MigrationReconciliationBreak> {
  const url =
    `${baseUrl()}/api/projects/${encodeURIComponent(projectId)}` +
    `/reconciliation-breaks/${encodeURIComponent(breakId)}/attempt`;
  const response = await fetch(url, {
    method: 'PATCH',
    headers: { Accept: 'application/json' },
  });
  const body = await readBody(response);
  if (!response.ok) {
    throw new MigrationBreakStoreError(response.status, body);
  }
  return body as MigrationReconciliationBreak;
}

/**
 * PATCH .../reconciliation-breaks/{breakId}/circuit-breaker -- trip the breaker /
 * escalate a break to human review (the bounded re-run round tripped or a
 * failed/rejected bug outcome arrived).
 */
export async function tripReconciliationBreakCircuitBreaker(
  projectId: string,
  breakId: string,
  args: { circuitBroken: boolean; needsHuman: boolean; errorDetail?: string | null }
): Promise<MigrationReconciliationBreak> {
  const url =
    `${baseUrl()}/api/projects/${encodeURIComponent(projectId)}` +
    `/reconciliation-breaks/${encodeURIComponent(breakId)}/circuit-breaker`;
  const response = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      circuit_broken: args.circuitBroken,
      needs_human: args.needsHuman,
      error_detail: args.errorDetail ?? null,
    }),
  });
  const body = await readBody(response);
  if (!response.ok) {
    throw new MigrationBreakStoreError(response.status, body);
  }
  return body as MigrationReconciliationBreak;
}

/**
 * POST .../reconciliation-breaks/mark-sent -- stamp the bug-report correlation
 * id on a user-selected batch + move them to `sent_as_bug` (attempt 1). One
 * report per batch (CD-5). Returns the updated breaks.
 */
export async function markReconciliationBreaksSent(
  projectId: string,
  bugId: string,
  breakIds: string[]
): Promise<MigrationReconciliationBreak[]> {
  const url =
    `${baseUrl()}/api/projects/${encodeURIComponent(projectId)}` +
    `/reconciliation-breaks/mark-sent`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ bug_id: bugId, break_ids: breakIds }),
  });
  const body = await readBody(response);
  if (!response.ok) {
    logger.warn('[diag-gateway] migration_reconciliation mark_sent AMS non-OK', {
      projectId,
      bugId,
      status: response.status,
    });
    throw new MigrationBreakStoreError(response.status, body);
  }
  return (Array.isArray(body) ? body : []) as MigrationReconciliationBreak[];
}
