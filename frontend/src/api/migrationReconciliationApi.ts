/**
 * Migration Reconciliation review API client.
 *
 * Spec: 2026-06-14 Migration Reconciliation + Bug Loop (Spec 4 of 4) --
 * Task Group 5 (Frontend reconciliation review surface).
 *
 * The thin, typed seam over the gateway's reconciliation-review routes (all
 * book-of-work-run-scoped, under
 * `/api/v1/projects/{projectId}/migration-execution-runs/{runId}/`):
 *
 *   - GET    .../reconciliation-breaks
 *            list the run's breaks (the review surface);
 *   - POST   .../reconciliation-breaks/send
 *            the HUMAN GATE -- send the user-SELECTED breaks as ONE bug report
 *            (CD-4 + CD-5). Nothing auto-sends;
 *   - POST   .../reconciliation-breaks/dispose
 *            assign a TERMINAL human disposition (accepted | wont_report |
 *            intentional_deviation) to breaks the human will NOT send. The
 *            current-state oracle is NEVER mutated (CD-A) -- this is how
 *            intentional / deferred deviations are recorded;
 *   - POST   .../target-credentials
 *            register the run's target-env credentials (CD-2). Held in-memory
 *            for the run only, NEVER persisted, NEVER logged.
 *
 * Wire format note:
 *   The gateway proxies the AMS break-store rows through verbatim, so the GET
 *   shape is snake_case (the AMS global default) -- exactly like Spec 3's
 *   run-state read (`MigrationExecutionRunDto` in
 *   `migrationDeliveryDashboardApi.ts`). This module therefore exports the
 *   snake_case break shape directly (no wire->camel mapper) to match the Spec 3
 *   run-progress precedent the reconciliation panel sits alongside. The send +
 *   dispose responses are built natively in the gateway (TypeScript) and are
 *   already idiomatic camelCase.
 *
 * A "break" == a drifting `api_behaviour_diff_item`: the migrated target
 * diverged from the pinned current-state oracle for the same request.
 *
 * Conventions mirror `migrationDeliveryDashboardApi.ts` for URL building
 * (`encodeURIComponent`), `GATEWAY_BASE`, and structured error parsing on a
 * non-2xx response (rejected promise carrying the server message).
 */

const GATEWAY_BASE = import.meta.env.VITE_GATEWAY_BASE_URL ?? '';

// ============================================================================
// Disposition lifecycle vocabulary (mirror the gateway/AMS break status set)
// ============================================================================

/**
 * The break disposition-lifecycle status values (AMS TEXT column). Mirrors the
 * gateway's `BREAK_DISPOSITION` constant.
 */
export const BREAK_DISPOSITION = {
  // --- machine states (deploy -> reconcile -> bug -> re-reconcile loop) ---
  OPEN: 'open',
  SENT_AS_BUG: 'sent_as_bug',
  FIXED_CONFIRMED: 'fixed_confirmed',
  STILL_BROKEN: 'still_broken',
  CIRCUIT_BROKEN_ESCALATED: 'circuit_broken_escalated',
  // --- human dispositions (terminal; never re-run -- CD-A) ---
  ACCEPTED: 'accepted',
  WONT_REPORT: 'wont_report',
  INTENTIONAL_DEVIATION: 'intentional_deviation',
  // --- D6: machine-set terminal for an additive net_new endpoint's
  // target_only diff. The gateway post-diff auto-disposition pass sets this
  // (needs_human=false) when a target_only break's <METHOD> <path> uniquely
  // matches a net_new work item's net_new_operations. It is ADDITIVE (brand-new
  // functionality), NOT a DEVIATION from existing behaviour -- so it is distinct
  // from intentional_deviation. A human may still re-classify it (D7).
  EXPECTED_NET_NEW: 'expected_net_new',
} as const;

/** The terminal human dispositions accepted by the dispose route (CD-A). */
export type ReconciliationDisposition =
  | 'accepted'
  | 'wont_report'
  | 'intentional_deviation';

/**
 * The terminal break states: once a break is in one of these it is never sent
 * and never re-run. Drives the disable-selection logic in the review surface.
 *
 * `expected_net_new` (D6) is terminal in the same gateway/idempotent-callback
 * sense (never re-run), but unlike the human terminals it is MACHINE-set by the
 * auto-disposition pass, so the review surface keeps it overridable (D7) -- the
 * panel selectability rule special-cases it.
 */
export const TERMINAL_BREAK_STATES: readonly string[] = [
  BREAK_DISPOSITION.ACCEPTED,
  BREAK_DISPOSITION.WONT_REPORT,
  BREAK_DISPOSITION.INTENTIONAL_DEVIATION,
  BREAK_DISPOSITION.FIXED_CONFIRMED,
  BREAK_DISPOSITION.CIRCUIT_BROKEN_ESCALATED,
  BREAK_DISPOSITION.EXPECTED_NET_NEW,
];

// ============================================================================
// Wire types (snake_case -- mirror the AMS MigrationReconciliationBreakDto,
// proxied through the gateway verbatim like Spec 3's run-state read).
// ============================================================================

/**
 * A single behavioural BREAK in a reconcile run (AMS changeset 183).
 *
 * `detail_json` carries the inline break detail (method/path/summary/diff) for
 * the review surface so the table never needs an extra fetch. A break ==
 * a drifting `api_behaviour_diff_item` (the `diff_item_id` soft-references the
 * existing row; no payload is duplicated).
 */
export interface MigrationReconciliationBreakDto {
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

/** The send-route result (the gateway builds this natively -- camelCase). */
export type SendReconciliationBreaksResult =
  | { status: 'sent'; bugId: string; breakCount: number }
  | { status: 'no_breaks' }
  | { status: 'send_failed'; error: string };

/** The dispose-route result (the gateway builds this natively -- camelCase). */
export interface DisposeReconciliationBreaksResult {
  status: 'disposed';
  count: number;
}

/** The target-credentials registration result. */
export interface RegisterTargetCredentialsResult {
  runId: string;
  registered: boolean;
}

/** The auth-secret bundle for a run's target env (CD-2; never persisted). */
export interface TargetApiAuthSecret {
  type:
    | 'none'
    | 'bearer'
    | 'api_key_header'
    | 'api_key_query'
    | 'basic'
    | 'custom_header';
  token?: string;
  header_name?: string;
  query_param?: string;
  username?: string;
  password?: string;
  value?: string;
}

// ============================================================================
// Helpers
// ============================================================================

function runScopedUrl(projectId: string, runId: string, suffix: string): string {
  return (
    `${GATEWAY_BASE}/api/v1/projects/${encodeURIComponent(projectId)}` +
    `/migration-execution-runs/${encodeURIComponent(runId)}${suffix}`
  );
}

async function readServerMessage(res: Response): Promise<string> {
  try {
    const errorBody = (await res.json()) as {
      message?: string;
      error?: string | { message?: string };
    };
    const nested =
      typeof errorBody.error === 'object' && errorBody.error
        ? errorBody.error.message
        : typeof errorBody.error === 'string'
          ? errorBody.error
          : '';
    return errorBody.message || nested || '';
  } catch {
    return '';
  }
}

// ============================================================================
// API functions
// ============================================================================

/**
 * List the run's reconciliation breaks (oldest-first) for the review surface.
 *
 * GET /api/v1/projects/{projectId}/migration-execution-runs/{runId}/reconciliation-breaks
 *
 * Returns the snake_case break rows (proxied from AMS verbatim, like the Spec 3
 * run-state read). A non-2xx rejects so the caller can surface an error.
 */
export async function getReconciliationBreaks(
  projectId: string,
  runId: string,
): Promise<MigrationReconciliationBreakDto[]> {
  const url = runScopedUrl(projectId, runId, '/reconciliation-breaks');
  const res = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    const serverMessage = await readServerMessage(res);
    throw new Error(
      serverMessage ||
        `Failed to read reconciliation breaks for run ${runId}: ${res.status} ${res.statusText}`,
    );
  }
  const body = (await res.json()) as unknown;
  return Array.isArray(body) ? (body as MigrationReconciliationBreakDto[]) : [];
}

/**
 * The HUMAN GATE: send the user-SELECTED breaks as ONE bug report (CD-4 + CD-5).
 *
 * POST /api/v1/projects/{projectId}/migration-execution-runs/{runId}/reconciliation-breaks/send
 *
 * Sending creates a bug for the external implementation/verification service to
 * fix (the breaks become `sent_as_bug`, attempt 1). Nothing auto-sends -- this is
 * the only send path. The current-state oracle is unchanged either way (CD-A).
 *
 * Body is snake_case (`break_ids`); the gateway re-validates the selection
 * server-side. Maps the documented statuses to the result union rather than
 * throwing on 4xx so the caller can surface `no_breaks` / `send_failed`
 * conversationally; only a network-layer failure rejects.
 */
export async function sendReconciliationBreaksAsBugs(
  projectId: string,
  runId: string,
  args: {
    company: string;
    project: string;
    breakIds: string[];
    title?: string;
  },
): Promise<SendReconciliationBreaksResult> {
  const url = runScopedUrl(projectId, runId, '/reconciliation-breaks/send');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      company: args.company,
      project: args.project,
      break_ids: args.breakIds,
      ...(args.title ? { title: args.title } : {}),
    }),
  });
  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    // fall through to the status-based fallback below
  }
  const obj = (payload ?? {}) as Record<string, unknown>;
  if (res.ok && obj.status === 'sent') {
    return {
      status: 'sent',
      bugId: String(obj.bugId ?? ''),
      breakCount: typeof obj.breakCount === 'number' ? obj.breakCount : 0,
    };
  }
  if (obj.status === 'no_breaks') {
    return { status: 'no_breaks' };
  }
  return {
    status: 'send_failed',
    error:
      typeof obj.error === 'string' && obj.error
        ? obj.error
        : `Failed to send the bug report: ${res.status} ${res.statusText}`,
  };
}

/**
 * Assign a TERMINAL human disposition to breaks the human will NOT send (CD-A).
 *
 * POST /api/v1/projects/{projectId}/migration-execution-runs/{runId}/reconciliation-breaks/dispose
 *
 * A disposition records an intentional / accepted / deferred deviation that will
 * NOT be sent as a bug; the current-state oracle is NEVER mutated. The breaks
 * become terminal (not sent, not re-run). Body is snake_case (`break_ids`,
 * `disposition`). A non-2xx rejects so the caller can surface the error.
 */
export async function disposeReconciliationBreaks(
  projectId: string,
  runId: string,
  args: {
    breakIds: string[];
    disposition: ReconciliationDisposition;
    errorDetail?: string | null;
  },
): Promise<DisposeReconciliationBreaksResult> {
  const url = runScopedUrl(projectId, runId, '/reconciliation-breaks/dispose');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      break_ids: args.breakIds,
      disposition: args.disposition,
      ...(args.errorDetail !== undefined
        ? { error_detail: args.errorDetail }
        : {}),
    }),
  });
  if (!res.ok) {
    const serverMessage = await readServerMessage(res);
    throw new Error(
      serverMessage ||
        `Failed to dispose the reconciliation breaks: ${res.status} ${res.statusText}`,
    );
  }
  const body = (await res.json()) as Partial<DisposeReconciliationBreaksResult>;
  return { status: 'disposed', count: body.count ?? 0 };
}

/**
 * Register the run's target-env credentials for the reconcile (CD-2).
 *
 * POST /api/v1/projects/{projectId}/migration-execution-runs/{runId}/target-credentials
 *
 * The reconcile PAUSES in a `needs_target_credentials` state when creds are
 * absent at callback time (restart / long-running run). This registers them so
 * the run can re-enter. Held in-memory for the run only -- NEVER persisted,
 * NEVER logged. `type:'none'` is allowed for an unauthenticated like-for-like
 * target. A non-2xx rejects so the caller can surface the validation error.
 */
export async function registerTargetCredentials(
  projectId: string,
  runId: string,
  api: TargetApiAuthSecret,
): Promise<RegisterTargetCredentialsResult> {
  const url = runScopedUrl(projectId, runId, '/target-credentials');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ api }),
  });
  if (!res.ok) {
    const serverMessage = await readServerMessage(res);
    throw new Error(
      serverMessage ||
        `Failed to register target credentials for run ${runId}: ${res.status} ${res.statusText}`,
    );
  }
  const body = (await res.json()) as Partial<RegisterTargetCredentialsResult>;
  return { runId: body.runId ?? runId, registered: body.registered ?? true };
}
