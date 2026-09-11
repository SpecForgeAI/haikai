/**
 * Stakeholder migration progress report API client (2026-08-16).
 *
 * Thin typed seam over the gateway's deterministic progress-summary
 * aggregation:
 *
 *   GET /api/v1/projects/{projectId}/architectures/{architectureId}
 *       /migration-books-of-work/{bookId}/progress-summary
 *
 * The response is built natively in the gateway (TypeScript) and is idiomatic
 * camelCase — mirroring the send/dispose responses in
 * `migrationReconciliationApi.ts`, NOT the snake_case AMS proxies. The gateway
 * reads only persisted data (reports, pack, runs, breaks, baseline, decisions,
 * discovery roll-ups) — no credentials, no LLM — and fails soft per block:
 * a missing report nulls that block (rendered as the grey
 * `[TBC - execute migration plan]` cells) and appends a warning.
 *
 * Conventions mirror `migrationReconciliationApi.ts` for URL building
 * (`encodeURIComponent`), `GATEWAY_BASE`, and structured error parsing on a
 * non-2xx response (rejected promise carrying the server message).
 */
import type { DbEngineKey } from './dbEngines';

const GATEWAY_BASE = import.meta.env.VITE_GATEWAY_BASE_URL ?? '';

// ============================================================================
// DTOs (mirror gateway/src/services/migrationProgressSummary.ts verbatim)
// ============================================================================

/** `failed` renders like `not_started` (error X, very light red) but keeps the honest word. */
export type ProgressStageStatus =
  | 'complete'
  | 'in_progress'
  | 'not_started'
  | 'failed';

export type ProgressStageKey =
  | 'db_discovery'
  | 'code_discovery'
  | 'live_behaviour'
  | 'target_conversation'
  | 'plan_created'
  | 'plan_executed'
  | 'reconciliation';

export interface ProgressStageDto {
  key: ProgressStageKey;
  label: string;
  status: ProgressStageStatus;
  /** Up to two short fact lines, already worded for the cell. */
  facts: string[];
}

export interface DbSectionTotalsDto {
  tables: number | null;
  rows: number | null;
  views: number | null;
  procs: number | null;
  /**
   * Stored-proc program Spec 5 (2026-09-09): the CATALOG routine count —
   * procs + functions + triggers as the scan found them. Current state = the
   * in-scope `db_routines` rows; target state = the RECONCILED routines (so
   * the Matching? cell reads "every routine the target owes is proven").
   */
  routines: number | null;
}

export interface DbSectionDto {
  /** Foundations Spec 4: explicit excluded-from-reconciliation slice. */
  scope_receipt?: {
    excluded_count: number;
    volatile_count: number;
    note: string;
  } | null;
  current: DbSectionTotalsDto;
  /** Null until execution produced reports — render TBC. */
  target: DbSectionTotalsDto | null;
  /** Worst -> best; sums to `current.tables` when both are present. */
  buckets: {
    failedToLoad: number;
    rowCountMismatch: number;
    dataMismatch: number;
    fullyReconciled: number;
  } | null;
  /**
   * MIGRATED counts (2026-08-16, positive phrasing): views/procs with an
   * approved translation, out of `current.views`/`current.procs`.
   *
   * `procsMigrated` is SUPERSEDED by `procsMigratedReconciled` (Spec 5,
   * 2026-09-09) but stays populated on the wire for one release — the UI
   * falls back to it when the richer cell is absent.
   */
  viewsMigrated: number | null;
  procsMigrated: number | null;
  /**
   * Stored-proc program Spec 5: "migrated" is not the bar — RECONCILED is.
   * `reconciled` of `total` in-scope routines, `pct` pre-computed server-side
   * (null when `total` is 0). Null on an older gateway -> the UI falls back to
   * the `procsMigrated` / `current.procs` pair.
   */
  procsMigratedReconciled: {
    reconciled: number;
    total: number;
    pct: number | null;
  } | null;
  /**
   * Worst -> best routine buckets; the six in-scope buckets sum to the same
   * `total` as `procsMigratedReconciled`. `movedToCode` / `dropped` are the
   * dispositioned OUT-of-scope routines (rendered as a small grey aside, never
   * inside the strip). Null until the proc parity data plane produced reports.
   */
  procBuckets: {
    notCaptured: number;
    divergent: number;
    unverified: number;
    notMigrated: number;
    reconciledWithWaivers: number;
    fullyReconciled: number;
    movedToCode: number;
    dropped: number;
  } | null;
}

export interface ServiceSectionTotalsDto {
  interfaces: number | null;
  endpoints: number | null;
}

export interface ServiceSectionDto {
  current: ServiceSectionTotalsDto;
  /** Null until the service plane deployed — render TBC. */
  target: ServiceSectionTotalsDto | null;
  /** Worst -> best; sums to `current.endpoints` when both are present. */
  buckets: {
    failedToMigrate: number;
    failedReconciliation: number;
    fullyReconciled: number;
  } | null;
  perOperation: {
    replayed: number;
    matching: number;
    underInvestigation: number;
    accepted: number;
    fixed: number;
  } | null;
}

export interface MigrationProgressSummaryDto {
  productName: string | null;
  currentStateLabel: string | null;
  targetStateLabel: string | null;
  scope: { db: boolean; service: boolean };
  /** True once every in-scope plane's latest run is deployed. */
  executed: boolean;
  stages: ProgressStageDto[];
  db: DbSectionDto | null;
  service: ServiceSectionDto | null;
  warnings: string[];
}

// ============================================================================
// Client
// ============================================================================

async function readServerMessage(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as { error?: unknown; message?: unknown };
    if (typeof body.error === 'string' && body.error.length > 0) return body.error;
    if (typeof body.message === 'string' && body.message.length > 0) return body.message;
    return null;
  } catch {
    return null;
  }
}

/**
 * Fetch the deterministic stakeholder progress summary for one book of work.
 * Computed on the fly server-side (no stored report row); refreshing the page
 * recomputes it. A non-2xx rejects so the page can surface an error state.
 */
export async function getMigrationProgressSummary(
  projectId: string,
  architectureId: string,
  bookId: string,
): Promise<MigrationProgressSummaryDto> {
  const url =
    `${GATEWAY_BASE}/api/v1/projects/${encodeURIComponent(projectId)}` +
    `/architectures/${encodeURIComponent(architectureId)}` +
    `/migration-books-of-work/${encodeURIComponent(bookId)}/progress-summary`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    const serverMessage = await readServerMessage(res);
    throw new Error(
      serverMessage ||
        `Failed to read the migration progress summary: ${res.status} ${res.statusText}`,
    );
  }
  return (await res.json()) as MigrationProgressSummaryDto;
}

// ============================================================================
// Manual reconciliation trigger (2026-08-16)
// ============================================================================

export interface ManualDbBlockDto {
  dbType: DbEngineKey;
  host: string;
  port: number;
  database: string;
  schema?: string | null;
  username: string;
  password: string;
}

export interface ManualAuthDto {
  type: 'none' | 'bearer' | 'api_key_header' | 'api_key_query' | 'basic' | 'custom_header';
  bearerToken?: string;
  headerName?: string;
  headerValue?: string;
  queryParamName?: string;
  queryParamValue?: string;
  username?: string;
  password?: string;
}

/**
 * Request body for the manual reconciliation kick. Credential blocks are
 * OPTIONAL — the gateway falls back to the run's already-registered in-memory
 * credentials, so a re-run doesn't force re-typing. Everything sent lands in
 * the gateway's in-memory stores only: never persisted, never logged.
 */
export interface StartReconciliationRequestDto {
  run_data_parity: boolean;
  run_api_reconcile: boolean;
  /**
   * Stored-proc program Spec 5 (2026-09-09): re-run the PROC PARITY comparator
   * (purpose `manual`) over the pack's translate-dispositioned routines against
   * the pinned proc baseline. Needs the TARGET DB credentials only — the oracle
   * is the pinned baseline, so no source side is replayed.
   */
  run_proc_parity: boolean;
  /** CURRENT-state (source) DB credentials — the data-parity source side. */
  source_db?: ManualDbBlockDto | null;
  /** TARGET DB credentials — parity target side + reconcile state snapshots. */
  target_db?: ManualDbBlockDto | null;
  /** TARGET service auth (the replay target). */
  api?: ManualAuthDto | null;
  /** TARGET service base URL (blank = the run's persisted value). */
  target_base_url?: string | null;
  /** CURRENT-state service details (source-side registration). */
  source_api?: { current_base_url?: string; api?: ManualAuthDto | null } | null;
  /**
   * Operator-sanctioned supersede: terminally dispose the previous
   * reconcile's unresolved breaks (wont_report + audit detail) instead of
   * blocking on the latch — for re-runs after a broken reconcile left
   * artifact breaks.
   */
  supersede_open_breaks?: boolean;
}

export type ManualRecOutcomeDto =
  | { status: 'started'; detail: string }
  | { status: 'blocked'; reason: string };

export interface StartReconciliationResultDto {
  dataParity: ManualRecOutcomeDto | null;
  apiReconcile: ManualRecOutcomeDto | null;
  /**
   * Spec 5 (2026-09-09): the proc-parity kick. `blocked` carries the named
   * synchronous precondition (no pinned proc baseline / no target creds / no
   * target build); null when the checkbox was not ticked. Optional so an older
   * gateway response still types.
   */
  procParity?: ManualRecOutcomeDto | null;
}

/**
 * Kick the selected reconciliation(s). Both engines run in the BACKGROUND
 * (minutes-to-hours on big systems): a 202 means started/blocked per rec —
 * refresh the progress report to see results land. A 400 (bad input) or
 * 5xx rejects with the server message.
 */
export async function startManualReconciliation(
  projectId: string,
  architectureId: string,
  bookId: string,
  body: StartReconciliationRequestDto,
): Promise<StartReconciliationResultDto> {
  const url =
    `${GATEWAY_BASE}/api/v1/projects/${encodeURIComponent(projectId)}` +
    `/architectures/${encodeURIComponent(architectureId)}` +
    `/migration-books-of-work/${encodeURIComponent(bookId)}/reconciliation/run`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const serverMessage = await readServerMessage(res);
    throw new Error(
      serverMessage || `Failed to start the reconciliation: ${res.status} ${res.statusText}`,
    );
  }
  return (await res.json()) as StartReconciliationResultDto;
}

// ---------------------------------------------------------------------------
// Log-replay reconciliation — ROUND 2 (CSD Spec 7/8, 2026-08-18)
// ---------------------------------------------------------------------------

export interface LogReplayReconcileRequestDto {
  corpus_id?: string | null;
  current: {
    base_url: string;
    api: StartReconciliationRequestDto['api'];
    db?: StartReconciliationRequestDto['source_db'] | null;
  };
  target: {
    base_url: string;
    api: StartReconciliationRequestDto['api'];
    db?: StartReconciliationRequestDto['target_db'] | null;
  };
}

export interface LogReplayReconcileResultDto {
  ok: boolean;
  error: string | null;
  corpus_id: string | null;
  log_replay_baseline_id: string | null;
  current_side: {
    itemsTotal: number;
    itemsReplayed: number;
    itemsSkipped: number;
    itemsFailed: number;
  } | null;
  diff_id: string | null;
  target_baseline_id: string | null;
  diff_items: number;
  breaks: number;
}

/**
 * Run reconciliation round 2: the staged log corpus replays against BOTH
 * systems at S0 (phase A current-side -> log_replay baseline; phase B the
 * existing headless target replay + diff, tagged purpose=log_replay_round2).
 * SYNCHRONOUS — the call returns the verdict (minutes for large corpora;
 * the modal shows a running state).
 */
export async function runLogReplayReconciliation(
  projectId: string,
  architectureId: string,
  body: LogReplayReconcileRequestDto,
): Promise<LogReplayReconcileResultDto> {
  const url =
    `${GATEWAY_BASE}/api/v1/projects/${encodeURIComponent(projectId)}` +
    `/architectures/${encodeURIComponent(architectureId)}` +
    `/log-replay-reconcile/run`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const parsed = (await res.json().catch(() => null)) as LogReplayReconcileResultDto | null;
  if (!res.ok) {
    throw new Error(
      parsed?.error || `Failed to run the log-replay reconciliation: ${res.status}`,
    );
  }
  return parsed as LogReplayReconcileResultDto;
}
