/**
 * Migration Reconciliation -- headless validation-service driver (gateway).
 *
 * Drives the existing `api-migration-validation-service` reconciler HEADLESSLY
 * server-side, mirroring the human session harness (create target session ->
 * load secrets -> start -> the runner fire-and-forgets `runTargetReplay` which
 * auto-triggers `runDiff`). The engine body is REUSED unchanged; this module is
 * only the server-side trigger + the completion read-back.
 *
 * Two reconcile shapes share this driver:
 *   - FULL-baseline reconcile (Group 2): replay the WHOLE pinned baseline and
 *     read back EVERY drifting diff_item as a break (NO deferred-exclusion --
 *     CD-B). The lifecycle is: create -> /secrets -> /start (202) -> poll the
 *     session to a terminal status -> resolve the freshest target baseline for
 *     our session -> poll its diff to `completed` -> read the diff_items.
 *   - SCOPED re-reconcile (Group 4): drives the SAME full replay+diff (the
 *     engine has no per-operation entry point), then the CALLER scopes the
 *     judgement to JUST the affected `source_baseline_item_id`s.
 *
 * Credentials (CD-2): the gateway loads the run's in-memory target creds into
 * the validation service's own `secretsStore` via the session `/secrets` route;
 * they are never persisted, never logged. The `target_base_url` comes from the
 * `deployed` callback (location != access).
 *
 * Every transport is injected ({@link ReconciliationValidationDeps}) so the
 * driver is unit-testable with mocks and no live network is reached.
 *
 * Spec: Migration Reconciliation + Bug Loop (2026-06-14, Spec 4 of 4) --
 * Task Groups 2 + 4.
 */

import { getConfig } from '../config';
import { logger } from './logger';
import type { TargetApiAuthSecret } from './migrationTargetCredentialsStore';

// ============================================================================
// Wire types (subset of the validation-service + AMS DTOs we drive / read)
// ============================================================================

/** A drifting `api_behaviour_diff_item` -- the raw break record. */
export interface ReconciliationDiffItem {
  id: string;
  diff_id?: string;
  method?: string | null;
  path?: string | null;
  scenario_name?: string | null;
  source_baseline_item_id?: string | null;
  target_baseline_item_id?: string | null;
  status_classification?: string | null;
  body_classification?: string | null;
  /**
   * Per-dimension header classification (Spec 2026-06-17). One of
   * `header_match` / `header_value_drift` / `header_presence_drift`, or null when
   * the header dimension was SKIPPED (a side lacked the `{ headers, body }`
   * wrapper -- graceful degrade, no false break). A presence drift always breaks;
   * a value drift breaks unless every changed header name is allowlisted-volatile
   * (the comparator tags those `declared` on `body_diff_json.header_entries`,
   * which the gateway volatility pass reads).
   */
  header_classification?: string | null;
  source_response_status?: number | null;
  target_response_status?: number | null;
  body_diff_json?: Record<string, unknown> | null;
  notes?: string | null;
}

/** The completed reconcile result the driver returns. */
export interface ReconciliationResult {
  /** TRUE only when the full lifecycle reached a finished diff. */
  ok: boolean;
  /** The validation-service target session id (diagnostics). */
  sessionId: string | null;
  /** The diff row id (diagnostics). */
  diffId: string | null;
  /** The persisted target baseline id (diagnostics). */
  targetBaselineId: string | null;
  /** EVERY diff_item the diff produced (drift filtering is the caller's job). */
  diffItems: ReconciliationDiffItem[];
  /** A failure reason when `ok=false` (session failed / diff failed / timeout). */
  error?: string | null;
}

/** A minimal validation-service session row (status polling). */
interface ValidationSessionRow {
  id?: string;
  status?: string | null;
  error_message?: string | null;
  session_id?: string | null;
}

/** A minimal AMS baseline row (resolving the freshest target baseline). */
interface BaselineRow {
  id?: string;
  session_id?: string | null;
  status?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

/** A minimal validation-service diff status row. */
interface DiffStatusRow {
  diffId?: string;
  status?: string | null;
  error_message?: string | null;
}

// ============================================================================
// Injectable transport surface (the DI seam for tests)
// ============================================================================

/** All side-effecting calls the reconcile driver makes (mocked in tests). */
export interface ReconciliationValidationDeps {
  /** POST a target capture session; returns the created session id. */
  createTargetSession(args: {
    projectId: string;
    architectureId: string;
    sourceBaselineId: string;
    targetApiBaseUrl: string;
  }): Promise<string>;
  /** POST the run's target creds into the validation-service secretsStore. */
  loadSecrets(args: { sessionId: string; projectId: string; api: TargetApiAuthSecret }): Promise<void>;
  /** POST /start -- fire-and-forget the replay (auto-triggers the diff). */
  startSession(args: { sessionId: string; projectId: string }): Promise<void>;
  /** GET the validation-service session status (polling). */
  getSessionStatus(args: { sessionId: string; projectId: string }): Promise<ValidationSessionRow>;
  /** GET the AMS target baselines paired with the source baseline. */
  listTargetBaselines(args: {
    projectId: string;
    sourceBaselineId: string;
  }): Promise<BaselineRow[]>;
  /** GET the AMS diff for a target baseline (null when none yet). */
  getDiffByTargetBaseline(args: {
    projectId: string;
    targetBaselineId: string;
  }): Promise<DiffStatusRow | null>;
  /** GET the validation-service diff status (polling). */
  getDiffStatus(args: { diffId: string; projectId: string }): Promise<DiffStatusRow>;
  /** GET the AMS diff_items for a diff. */
  listDiffItems(args: { projectId: string; diffId: string }): Promise<ReconciliationDiffItem[]>;
  /** Sleep between poll iterations (test-injectable -- no real wait in tests). */
  sleep(ms: number): Promise<void>;
  /** Wall-clock provider (test-injectable). */
  now(): number;
}

/** Polling / timeout knobs (overridable in tests for instant runs). */
export interface ReconciliationPollOptions {
  /** Max wall-clock for the whole reconcile (default 15 min). */
  timeoutMs?: number;
  /** Delay between poll iterations (default 2s). */
  pollIntervalMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 2000;

const SESSION_TERMINAL = new Set(['completed', 'failed', 'cancelled']);
const DIFF_TERMINAL = new Set(['completed', 'failed']);

// ============================================================================
// Default (production) transport -- HTTP against validation-service + AMS
// ============================================================================

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/** Build the default production transport (real fetch against 8092 + AMS). */
export function defaultReconciliationValidationDeps(): ReconciliationValidationDeps {
  const validationBase = () => getConfig().apiMigrationValidationServiceBaseUrl;
  const amsBase = () => getConfig().architectureModelServiceBaseUrl;

  return {
    async createTargetSession(args) {
      const url = `${validationBase()}/api-migration-validation/api/target-capture-sessions`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          projectId: args.projectId,
          architectureId: args.architectureId,
          sourceBaselineId: args.sourceBaselineId,
          targetApiBaseUrl: args.targetApiBaseUrl,
          // Allow replaying mutating ops against the target -- a like-for-like
          // reconcile MUST exercise every captured operation.
          mutatingCallsConfirmed: true,
        }),
      });
      const body = (await readJson(response)) as { id?: string } | null;
      if (!response.ok || !body?.id) {
        throw new Error(`create target session failed (status ${response.status})`);
      }
      return body.id;
    },

    async loadSecrets(args) {
      const url =
        `${validationBase()}/api-migration-validation/api/target-capture-sessions/` +
        `${encodeURIComponent(args.sessionId)}/secrets?projectId=${encodeURIComponent(args.projectId)}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        // The validation service holds this in-memory only; never logged here.
        body: JSON.stringify({ api: args.api }),
      });
      if (!response.ok) {
        throw new Error(`load secrets failed (status ${response.status})`);
      }
    },

    async startSession(args) {
      const url =
        `${validationBase()}/api-migration-validation/api/target-capture-sessions/` +
        `${encodeURIComponent(args.sessionId)}/start?projectId=${encodeURIComponent(args.projectId)}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({}),
      });
      if (!response.ok) {
        throw new Error(`start session failed (status ${response.status})`);
      }
    },

    async getSessionStatus(args) {
      const url =
        `${validationBase()}/api-migration-validation/api/target-capture-sessions/` +
        `${encodeURIComponent(args.sessionId)}/status?projectId=${encodeURIComponent(args.projectId)}`;
      const response = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
      return ((await readJson(response)) ?? {}) as ValidationSessionRow;
    },

    async listTargetBaselines(args) {
      const url =
        `${amsBase()}/api/projects/${encodeURIComponent(args.projectId)}` +
        `/api-behaviour/baselines/${encodeURIComponent(args.sourceBaselineId)}/target-baselines`;
      const response = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
      const body = await readJson(response);
      return (Array.isArray(body) ? body : []) as BaselineRow[];
    },

    async getDiffByTargetBaseline(args) {
      const url =
        `${amsBase()}/api/projects/${encodeURIComponent(args.projectId)}` +
        `/api-behaviour/diffs/by-target/${encodeURIComponent(args.targetBaselineId)}`;
      const response = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
      if (response.status === 404) return null;
      return ((await readJson(response)) ?? null) as DiffStatusRow | null;
    },

    async getDiffStatus(args) {
      const url =
        `${validationBase()}/api-migration-validation/api/diffs/` +
        `${encodeURIComponent(args.diffId)}/status?projectId=${encodeURIComponent(args.projectId)}`;
      const response = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
      return ((await readJson(response)) ?? {}) as DiffStatusRow;
    },

    async listDiffItems(args) {
      const url =
        `${amsBase()}/api/projects/${encodeURIComponent(args.projectId)}` +
        `/api-behaviour/diffs/${encodeURIComponent(args.diffId)}/items`;
      const response = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
      const body = await readJson(response);
      return (Array.isArray(body) ? body : []) as ReconciliationDiffItem[];
    },

    sleep(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    },

    now() {
      return Date.now();
    },
  };
}

// ============================================================================
// The headless reconcile lifecycle
// ============================================================================

/**
 * Drive ONE headless reconcile end-to-end: create the target session, load the
 * run's creds, start the replay (which auto-diffs), poll to completion, and read
 * back EVERY diff_item. The caller maps / scopes the diff_items to breaks.
 *
 * Never throws -- a failure at any step returns `{ ok:false, error }` so the
 * caller can isolate it (mark the reconcile as needing attention) without
 * crashing the build-results door.
 */
export async function runHeadlessReconcile(
  args: {
    projectId: string;
    architectureId: string;
    sourceBaselineId: string;
    targetBaseUrl: string;
    api: TargetApiAuthSecret;
  },
  deps: ReconciliationValidationDeps,
  options: ReconciliationPollOptions = {}
): Promise<ReconciliationResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const deadline = deps.now() + timeoutMs;

  let sessionId: string | null = null;
  try {
    // 1. Create + configure the target session.
    sessionId = await deps.createTargetSession({
      projectId: args.projectId,
      architectureId: args.architectureId,
      sourceBaselineId: args.sourceBaselineId,
      targetApiBaseUrl: args.targetBaseUrl,
    });
    await deps.loadSecrets({ sessionId, projectId: args.projectId, api: args.api });

    // 2. Start the replay (fire-and-forget on the validation service; auto-diffs).
    await deps.startSession({ sessionId, projectId: args.projectId });

    logger.info('[diag-gateway] migration_reconciliation replay_started', {
      projectId: args.projectId,
      sessionId,
      sourceBaselineId: args.sourceBaselineId,
    });

    // 3. Poll the session to a terminal status.
    let sessionStatus = '';
    for (;;) {
      const row = await deps.getSessionStatus({ sessionId, projectId: args.projectId });
      sessionStatus = row.status ?? '';
      if (SESSION_TERMINAL.has(sessionStatus)) {
        if (sessionStatus !== 'completed') {
          return {
            ok: false,
            sessionId,
            diffId: null,
            targetBaselineId: null,
            diffItems: [],
            error: row.error_message ?? `reconcile session ended ${sessionStatus}`,
          };
        }
        break;
      }
      if (deps.now() >= deadline) {
        return {
          ok: false,
          sessionId,
          diffId: null,
          targetBaselineId: null,
          diffItems: [],
          error: 'reconcile session poll timed out',
        };
      }
      await deps.sleep(pollIntervalMs);
    }

    // 4. Resolve the freshest target baseline for THIS session.
    const targetBaselines = await deps.listTargetBaselines({
      projectId: args.projectId,
      sourceBaselineId: args.sourceBaselineId,
    });
    const ours = pickFreshestForSession(targetBaselines, sessionId);
    if (!ours?.id) {
      return {
        ok: false,
        sessionId,
        diffId: null,
        targetBaselineId: null,
        diffItems: [],
        error: 'no target baseline produced by the reconcile',
      };
    }
    const targetBaselineId = ours.id;

    // 5. Resolve the auto-created diff + poll it to terminal.
    let diffId: string | null = null;
    for (;;) {
      const diff = await deps.getDiffByTargetBaseline({
        projectId: args.projectId,
        targetBaselineId,
      });
      if (diff?.diffId) {
        diffId = diff.diffId;
        if (DIFF_TERMINAL.has(diff.status ?? '')) {
          if ((diff.status ?? '') !== 'completed') {
            // Confirm via the live status (the by-target row may be stale).
            const live = await deps.getDiffStatus({ diffId, projectId: args.projectId });
            if ((live.status ?? '') !== 'completed') {
              return {
                ok: false,
                sessionId,
                diffId,
                targetBaselineId,
                diffItems: [],
                error: live.error_message ?? `diff ended ${live.status ?? 'failed'}`,
              };
            }
          }
          break;
        }
        // Diff exists but still computing -- poll its live status.
        const live = await deps.getDiffStatus({ diffId, projectId: args.projectId });
        if (DIFF_TERMINAL.has(live.status ?? '')) {
          if ((live.status ?? '') !== 'completed') {
            return {
              ok: false,
              sessionId,
              diffId,
              targetBaselineId,
              diffItems: [],
              error: live.error_message ?? `diff ended ${live.status ?? 'failed'}`,
            };
          }
          break;
        }
      }
      if (deps.now() >= deadline) {
        return {
          ok: false,
          sessionId,
          diffId,
          targetBaselineId,
          diffItems: [],
          error: 'reconcile diff poll timed out',
        };
      }
      await deps.sleep(pollIntervalMs);
    }

    // 6. Read back every diff_item (the raw break records).
    const diffItems = await deps.listDiffItems({ projectId: args.projectId, diffId: diffId as string });

    logger.info('[diag-gateway] migration_reconciliation replay_complete', {
      projectId: args.projectId,
      sessionId,
      diffId,
      targetBaselineId,
      diffItemCount: diffItems.length,
    });

    return {
      ok: true,
      sessionId,
      diffId,
      targetBaselineId,
      diffItems,
      error: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown reconcile error';
    logger.error('[diag-gateway] migration_reconciliation replay_failed', {
      projectId: args.projectId,
      sessionId,
      error: message,
    });
    return {
      ok: false,
      sessionId,
      diffId: null,
      targetBaselineId: null,
      diffItems: [],
      error: message,
    };
  }
}

/**
 * Pick the freshest target baseline that belongs to our reconcile session. The
 * replay runner stamps `session_id` on the target baseline it creates; prefer
 * the exact session match, falling back to the most-recently-updated baseline
 * if (older AMS rows) the session id was not echoed.
 */
function pickFreshestForSession(
  baselines: BaselineRow[],
  sessionId: string
): BaselineRow | null {
  const sorter = (a: BaselineRow, b: BaselineRow): number => {
    const at = a.updated_at ?? a.created_at ?? '';
    const bt = b.updated_at ?? b.created_at ?? '';
    return bt.localeCompare(at); // newest first
  };
  const exact = baselines.filter((b) => b.session_id === sessionId).sort(sorter);
  if (exact.length > 0) return exact[0];
  const any = baselines.slice().sort(sorter);
  return any.length > 0 ? any[0] : null;
}

/**
 * Classify a diff_item as a BREAK. A break is any diff_item where ANY response
 * dimension drifted -- it is NOT a clean match. `source_only` (the operation
 * absent in the target) and `target_only` both count as breaks. This is the
 * truthful signal: a deferred / un-migrated story whose behaviour is absent or
 * divergent surfaces here exactly like any other deviation (CD-B).
 *
 * Spec 2026-06-17 (Reconcile Full-Response Fidelity): registers the NEW
 * dimensions as breaks too --
 *   - the body dimension now breaks on `body_ordering_drift` (a non-volatile
 *     array reorder), in addition to the existing `body_value_drift` /
 *     `body_shape_drift`;
 *   - the header dimension (`header_value_drift` / `header_presence_drift`)
 *     registers as a break. `header_classification` is null when the dimension
 *     was SKIPPED (a side lacked the `{ headers, body }` wrapper -- graceful
 *     degrade, no false break) or `header_match` when headers matched.
 *
 * A `header_value_drift` break is CREATED even when the changed header name is
 * allowlisted-volatile; the volatile DOWN-RANK to `expected_volatile` happens
 * AFTER creation in the gateway auto-disposition pass
 * (create-then-auto-dispose, never silently suppressed).
 */
export function isDiffItemABreak(item: ReconciliationDiffItem): boolean {
  const status = item.status_classification ?? '';
  const body = item.body_classification ?? null;
  const header = item.header_classification ?? null;

  // The header dimension is a NEW also-breaks dimension (Spec 2026-06-17): any
  // classification other than `header_match` / null (skipped -- graceful
  // degrade) registers as a break.
  if (header !== null && header !== 'header_match') return true;

  // Status + body preserve EXACTLY the original predicate: a clean status/body
  // match is `status_match && body_match`; anything else (incl. the new
  // `body_ordering_drift`, which is not `body_match`) is a break.
  if (status === 'status_match' && body === 'body_match') return false;
  return true;
}
