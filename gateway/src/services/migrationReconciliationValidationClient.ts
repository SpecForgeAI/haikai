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
import type { SupportedDbEngine } from './dbMigrationPack/dbCredentialBlock';

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
  /**
   * POST a target capture session; returns the created session id.
   * `dbConfig` (Spec 2026-07-06-n, Tier-1 batch) is the OPTIONAL target-DB
   * connection CONFIG (no password) persisted redacted on the session row —
   * with the in-memory password from loadSecrets it enables the replay
   * runner's state-delta snapshots around mutating replays.
   */
  createTargetSession(args: {
    projectId: string;
    architectureId: string;
    sourceBaselineId: string;
    targetApiBaseUrl: string;
    dbConfig?: Record<string, unknown> | null;
  }): Promise<string>;
  /**
   * POST the run's target creds into the validation-service secretsStore.
   * `dbPassword` (optional) rides the same in-memory-only bundle.
   */
  loadSecrets(args: {
    sessionId: string;
    projectId: string;
    api: TargetApiAuthSecret;
    dbPassword?: string | null;
  }): Promise<void>;
  /**
   * POST /start -- fire-and-forget the replay (auto-triggers the diff).
   * `endpointScope` / `purpose` (Spec 2026-07-06-i) request a SCOPED replay:
   * only baseline items matching the `"METHOD /path/template"` keys are
   * replayed and the auto-created diff carries the scope as its
   * `endpoint_scope_json` audit blob. Absent = full replay (legacy).
   */
  startSession(args: {
    sessionId: string;
    projectId: string;
    endpointScope?: string[] | null;
    purpose?: string | null;
  }): Promise<void>;
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

/** First non-empty string among the candidates (wire-case-tolerant reads). */
function firstString(...candidates: unknown[]): string | null {
  for (const c of candidates) {
    if (typeof c === 'string' && c.length > 0) return c;
  }
  return null;
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
          // Spec 2026-07-06-n (Tier-1 batch): OPTIONAL target-DB connection
          // config (NO password) — enables state-delta snapshots.
          ...(args.dbConfig ? { dbConfigRedactedJson: args.dbConfig } : {}),
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
        body: JSON.stringify({
          api: args.api,
          ...(args.dbPassword ? { db: { password: args.dbPassword } } : {}),
        }),
      });
      if (!response.ok) {
        throw new Error(`load secrets failed (status ${response.status})`);
      }
    },

    async startSession(args) {
      const url =
        `${validationBase()}/api-migration-validation/api/target-capture-sessions/` +
        `${encodeURIComponent(args.sessionId)}/start?projectId=${encodeURIComponent(args.projectId)}`;
      // Spec 2026-07-06-i: thread the optional scoped-replay args. An empty
      // body is byte-identical to the legacy full replay.
      const startBody: Record<string, unknown> = {};
      if (args.endpointScope && args.endpointScope.length > 0) {
        startBody.endpointScope = args.endpointScope;
      }
      if (args.purpose) {
        startBody.purpose = args.purpose;
      }
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(startBody),
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
      // AMS speaks snake_case and the diff row's identifier is plain `id`
      // (ApiBehaviourDiffDto — there is NO diffId/diff_id field on the wire).
      // Live failure 2026-08-17: reading only `diffId` here made every
      // COMPLETED diff invisible, so the reconcile polled the full 15-minute
      // deadline and "timed out" on a diff that finished in seconds. Coerce
      // tolerantly (snake, camel) per the dual-tolerance wire idiom.
      const body = (await readJson(response)) as Record<string, unknown> | null;
      if (!body || typeof body !== 'object') return null;
      const diffId = firstString(body.id, body.diff_id, body.diffId);
      const status = firstString(body.status);
      const errorMessage = firstString(body.error_message, body.errorMessage);
      if (!diffId && !status) return null;
      return {
        ...(diffId ? { diffId } : {}),
        status: status ?? null,
        error_message: errorMessage ?? null,
      };
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
      // LOUD on failure (2026-08-17): this used to coerce ANY non-array body
      // — including AMS error responses — to `[]`, which the driver then
      // recorded as a CLEAN reconcile with zero breaks. A failed read must
      // fail the reconcile visibly, never impersonate an empty diff.
      if (!response.ok) {
        throw new Error(`AMS diff-items read failed (status ${response.status})`);
      }
      const body = await readJson(response);
      if (!Array.isArray(body)) {
        throw new Error('AMS diff-items read returned a non-array body');
      }
      return body as ReconciliationDiffItem[];
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
    /**
     * Spec 2026-07-06-i: OPTIONAL scoped replay — `"METHOD /path/template"`
     * keys. Absent = full replay (legacy, byte-identical).
     */
    endpointScope?: string[] | null;
    /** Spec 2026-07-06-i: run purpose ('parity' | 'drift_check') on the diff blob. */
    purpose?: string | null;
    /**
     * Spec 2026-07-06-n (Tier-1 batch): OPTIONAL target-DB credentials.
     * Config (no password) rides the session create; the password rides the
     * in-memory secrets load. Absent = no state snapshots (deltas stay null,
     * `state_unverified` — fail-closed, visible).
     */
    db?: {
      dbType: SupportedDbEngine;
      host: string;
      port: number;
      database: string;
      schema?: string | null;
      username: string;
      password: string;
    } | null;
  },
  deps: ReconciliationValidationDeps,
  options: ReconciliationPollOptions = {}
): Promise<ReconciliationResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const deadline = deps.now() + timeoutMs;

  let sessionId: string | null = null;
  try {
    // 1. Create + configure the target session. The DB CONFIG (no password)
    // rides the session row; the password rides the in-memory secrets load.
    const dbConfig = args.db
      ? {
          dbType: args.db.dbType,
          host: args.db.host,
          port: args.db.port,
          database: args.db.database,
          schema: args.db.schema ?? null,
          username: args.db.username,
        }
      : null;
    sessionId = await deps.createTargetSession({
      projectId: args.projectId,
      architectureId: args.architectureId,
      sourceBaselineId: args.sourceBaselineId,
      targetApiBaseUrl: args.targetBaseUrl,
      dbConfig,
    });
    await deps.loadSecrets({
      sessionId,
      projectId: args.projectId,
      api: args.api,
      dbPassword: args.db?.password ?? null,
    });

    // 2. Start the replay (fire-and-forget on the validation service; auto-diffs).
    await deps.startSession({
      sessionId,
      projectId: args.projectId,
      endpointScope: args.endpointScope ?? null,
      purpose: args.purpose ?? null,
    });

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

    // A completed diff over a replayed baseline ALWAYS yields at least one
    // item per operation pair — zero items from a completed diff means the
    // read went wrong (wrong diff id, wire drift, AMS hiccup), not that the
    // reconcile was clean. Refuse to report it as a successful reconcile
    // (2026-08-17: the "ended but no rec anywhere" failure class).
    if (diffItems.length === 0) {
      return {
        ok: false,
        sessionId,
        diffId,
        targetBaselineId,
        diffItems: [],
        error:
          'completed diff returned zero diff items — treating as a failed read, not a clean reconcile',
      };
    }

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
 *
 * Spec 2026-07-06-i (amendment: state parity in the verdict) registers TWO
 * further dimensions read off the persisted `body_diff_json` blob:
 *   - `state_classification` (Spec N): `state_drift` AND `state_unverified`
 *     both break — a write whose DB effect diverged, or could not be
 *     verified, must surface visibly (FAIL CLOSED), never silently pass.
 *     The blob key is only stamped for mutating scenarios where at least one
 *     side measured a delta, so read-only items are untouched.
 *   - `byte_classification` (Spec J, strict profile only): `byte_drift`
 *     breaks. `raw_unavailable` does NOT break here — it is a visible
 *     degradation the verdict layer reports, not a measured divergence.
 */
export function isDiffItemABreak(item: ReconciliationDiffItem): boolean {
  const status = item.status_classification ?? '';
  const body = item.body_classification ?? null;
  const header = item.header_classification ?? null;

  // The header dimension is a NEW also-breaks dimension (Spec 2026-06-17): any
  // classification other than `header_match` / null (skipped -- graceful
  // degrade) registers as a break.
  if (header !== null && header !== 'header_match') return true;

  // State + byte dimensions (Spec 2026-07-06-i) ride the persisted diff blob.
  const blob = (item.body_diff_json ?? {}) as Record<string, unknown>;
  const state = typeof blob.state_classification === 'string' ? blob.state_classification : null;
  if (state === 'state_drift' || state === 'state_unverified') return true;
  const byte = typeof blob.byte_classification === 'string' ? blob.byte_classification : null;
  if (byte === 'byte_drift') return true;

  // Status + body preserve EXACTLY the original predicate: a clean status/body
  // match is `status_match && body_match`; anything else (incl. the new
  // `body_ordering_drift`, which is not `body_match`) is a break.
  if (status === 'status_match' && body === 'body_match') return false;
  return true;
}
