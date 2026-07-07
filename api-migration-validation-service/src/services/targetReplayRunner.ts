import { archModelClient as defaultArchModelClient } from './archModelClient';
import { redactUrl } from './redactor';
import { normaliseBodyForAms } from './amsBodyEnvelope';
import type {
  BaselineDto,
  BaselineItemDto,
  CaptureDto,
  CaptureSessionDto,
} from './archModelClient';
import { secretsStore as defaultSecretsStore, SecretsStore } from './secretsStore';
import { runManager as defaultRunManager, RunManager } from './runManager';
import {
  createSessionHttpExecutor,
  type SessionHttpExecutor,
  rawBodyOf,
} from './httpExecutor';
import { runDiff as defaultRunDiff, type DiffRunnerDeps } from './diffRunner';
import { resolveNonDeterministicEndpointKeys as defaultResolveNdKeys } from './nonDeterministicEndpointKeys';
import {
  replaySequenceItem,
  type SequenceReplayDeps,
} from './sequenceReplayRunner';
import type { ApiAuthSecret } from '../types/secrets';
import {
  TARGET_REPLAY_CONSECUTIVE_FAILURE_ABORT as DEFAULT_TRANSPORT_FAILURE_THRESHOLD,
  LLM_TOOL_CALL_TIMEOUT_MS as DEFAULT_PER_ITEM_TIMEOUT_MS,
} from '../config';
import { createTracer } from '../trace';

// Haikai workflow trace logger (OFF by default; no-op unless HAIKAI_TRACE
// is set). See docs/trace-logging.md. The target replay is the target-side
// arm of reconcile; project + arch group the migration, the replay session
// id is the sub-thread.
const trace = createTracer('capture-svc');

/**
 * Target replay runner. Deterministically replays an existing
 * current-state baseline's accepted items against a new target API URL and
 * persists the responses as a paired target baseline.
 *
 * Spec: 2026-05-25 API Test Harness -- Target-Side Capture -- Task Group 3.
 *
 * Why a separate runner (not the existing orchestrator):
 *   - No LLM tool loop. The source baseline already encodes the operation
 *     and scenario set; replay is purely "rebuild request, send to new URL,
 *     persist response". None of the 10 LLM tools are invoked. No DB
 *     sampling. No OAS parsing.
 *   - The dispatch happens at the route handler. `POST /target-capture-
 *     sessions/:id/start` calls {@link runTargetReplay}; the existing
 *     `POST /capture-sessions/:id/start` continues to call
 *     `orchestrateCaptureSession`. The `kind` discriminator on the session
 *     row is the source of truth for which path to take.
 *
 * Reused infrastructure (kind-agnostic, ZERO modification needed):
 *   - `httpExecutor.ts`         -- per-session axios wrapper, takes target
 *                                  URL + target auth.
 *   - `runManager.ts`           -- lifecycle handle, cancel signalling.
 *   - `secretsStore.ts`         -- in-memory target-side auth bundle.
 *   - `redactor.ts`             -- (used transitively by httpExecutor).
 *   - `startupReconciliation.ts`-- target sessions inherit the existing
 *                                  `secrets_lost_during_run` behaviour.
 *
 * Consecutive-failure abort policy (accepted Q6):
 *   - HTTP 4xx / 5xx are NOT failures -- they're data the diff engine
 *     wants. Persist them, emit a `replay_non_2xx` diagnostic, continue.
 *     The counter RESETS to zero on any successful HTTP response (any
 *     status code).
 *   - Transport-level failures (network error, DNS error, connection
 *     refused, timeout) ARE counted toward the threshold.
 *   - On reaching the threshold (default 10, configurable via
 *     `TARGET_REPLAY_CONSECUTIVE_FAILURE_ABORT`), the runner aborts the
 *     session with `error_message='target_unreachable'`.
 *
 * Mutating-call gate (accepted Q6):
 *   - If the source item method is mutating (`POST|PUT|PATCH|DELETE`) AND
 *     the target session has `mutating_calls_confirmed=false`, the item is
 *     skipped with a `mutating_skipped` diagnostic. No HTTP call is made.
 *
 * Auto-accept on the target side (accepted Q4):
 *   - Every persisted target capture is immediately PATCHed to
 *     `accepted=true` + `accepted_at=now`, and promoted to an
 *     `api_behaviour_baseline_items` row on the new target baseline. The
 *     reviewer can manually flip individual items back to rejected via the
 *     existing `CaptureReviewPanel` toggle.
 */

/**
 * Thrown when the consecutive transport-level failure threshold is reached.
 * The route handler catches this and marks the session as
 * `failed` with `error_message='target_unreachable'`.
 */
export class TransportFailureThresholdExceededError extends Error {
  public readonly threshold: number;
  public readonly lastErrorCode: string | null;

  constructor(threshold: number, lastErrorCode: string | null) {
    super(
      `Target replay aborted: ${threshold} consecutive transport-level failures` +
        (lastErrorCode ? ` (last: ${lastErrorCode})` : ''),
    );
    this.name = 'TransportFailureThresholdExceededError';
    this.threshold = threshold;
    this.lastErrorCode = lastErrorCode;
  }
}

export type TargetReplayDiagnosticType =
  | 'mutating_skipped'
  | 'replay_non_2xx'
  | 'replay_transport_failure'
  | 'replay_cancelled'
  // Stateful-sequence diagnostics (Spec D, Task Group 3). A sequence is
  // inherently mutating: it requires mutating_calls_confirmed to replay.
  | 'sequence_skipped'
  | 'sequence_setup_failed'
  | 'sequence_cleanup_failed'
  | 'sequence_residual_pollution';

export interface TargetReplayDiagnostic {
  diagnosticType: TargetReplayDiagnosticType;
  message: string;
  itemId?: string;
  method?: string;
  path?: string;
  responseStatus?: number;
  errorCode?: string | null;
}

export interface TargetReplayOutcome {
  sessionId: string;
  targetBaselineId: string;
  itemsTotal: number;
  itemsReplayed: number;
  itemsSkipped: number;
  itemsFailed: number;
  finalStatus: 'completed' | 'failed' | 'cancelled';
  errorMessage: string | null;
  diagnostics: TargetReplayDiagnostic[];
}

/**
 * Injectable deps for {@link runTargetReplay}. Production callers pass nothing
 * (defaults wire to the singletons); tests inject mocks.
 */
export interface TargetReplayDeps {
  archModelClient?: typeof defaultArchModelClient;
  secretsStore?: SecretsStore;
  runManager?: RunManager;
  /**
   * Override for the http executor factory. Tests inject a stub returning a
   * mocked `request()`; production callers leave this undefined and the
   * default factory builds a real per-session axios executor.
   */
  createHttpExecutor?: (args: {
    auth: ApiAuthSecret;
    baseURL: string;
    timeoutMs: number;
    defaultHeaders: Record<string, string>;
  }) => SessionHttpExecutor;
  /**
   * Override for the consecutive transport-level failure threshold.
   * Defaults to {@link TARGET_REPLAY_CONSECUTIVE_FAILURE_ABORT} (env var).
   */
  transportFailureThreshold?: number;
  /** Override the per-item timeout. Defaults to {@link LLM_TOOL_CALL_TIMEOUT_MS}. */
  perItemTimeoutMs?: number;
  /**
   * Wall-clock time provider (test-injectable). Defaults to `Date.now`.
   * Tests stub this to make captured timestamps deterministic.
   */
  now?: () => number;
  /**
   * Override for the auto-trigger diff runner. Tests inject a stub to assert
   * the trigger fires (or throws) without actually executing the runner.
   *
   * Spec: 2026-05-25 Diff Engine -- Task Group 3 (auto-trigger at the
   * happy-path tail of the replay). The optional second `deps` arg carries
   * the FU-1 `nonDeterministicEndpointKeys` seam (Spec 2026-06-16).
   */
  runDiffFn?: (diffId: string, deps?: DiffRunnerDeps) => Promise<void>;
  /**
   * Override for the `non_deterministic_endpoint` -> `${METHOD}|${path}`
   * bridge that populates the runner's `nonDeterministicEndpointKeys` seam
   * (Spec 2026-06-16 FU-1). Tests inject a stub; the default resolves it from
   * the discovery signal. Fail-soft: a rejection degrades to strict (G1).
   */
  resolveNonDeterministicEndpointKeys?: typeof defaultResolveNdKeys;
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const TRANSPORT_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'ETIMEDOUT',
  'ECONNRESET',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
]);

/**
 * Classify an axios error as a transport-level failure (counts toward the
 * abort threshold) versus an HTTP response failure (does NOT -- those land
 * via the request resolving with a 4xx/5xx status because `httpExecutor`
 * sets `validateStatus: () => true`).
 *
 * Transport-level failures are typified by:
 *   - axios error has NO `response` field (request never completed)
 *   - axios `code` in the canonical Node socket-error set
 *
 * Returns the error code string when it's a transport failure, or null
 * when it's something else (e.g. an axios internal logic error -- treat
 * those as transport failures too so a misbehaving target doesn't loop
 * forever).
 */
function classifyError(err: unknown): {
  isTransportFailure: boolean;
  code: string | null;
} {
  const e = err as { code?: string; response?: unknown; message?: string };
  // axios sets `response` only when the server actually responded; absence
  // means the request never completed -- transport-level by definition.
  const hasResponse = !!e?.response;
  const code = typeof e?.code === 'string' ? e.code : null;
  if (hasResponse) {
    // The httpExecutor uses validateStatus: () => true, so this branch
    // would only be hit on a downstream throw -- treat as non-transport
    // (we already have data).
    return { isTransportFailure: false, code };
  }
  if (code && TRANSPORT_ERROR_CODES.has(code)) {
    return { isTransportFailure: true, code };
  }
  // Unknown error shape with no HTTP response -- safest to treat as
  // transport so we don't hide a runaway loop.
  return { isTransportFailure: true, code };
}

interface ItemRequestShape {
  method: string;
  path: string;
  query?: Record<string, unknown>;
  headers?: Record<string, string>;
  body?: unknown;
}

/**
 * Extract the request shape from a baseline item. Baseline items persist
 * the request alongside the response, but the source persists it under
 * `request_json` which is the merged `{ query, headers, body }` blob the
 * orchestrator writes (see `captureSessionFullFlow.e2e.test.ts` line 753).
 */
function extractItemRequest(item: BaselineItemDto): ItemRequestShape {
  const req = (item.request_json ?? {}) as Record<string, unknown>;
  const query = (req.query ?? undefined) as Record<string, unknown> | undefined;
  const headers = (req.headers ?? undefined) as Record<string, string> | undefined;
  const body = req.body;
  return {
    method: (item.method ?? 'GET').toUpperCase(),
    path: item.path ?? '/',
    query,
    headers,
    body,
  };
}

/**
 * Drive a single target-side replay run end to end.
 *
 * Lifecycle:
 *   1. Load the target session via `archModelClient.getCaptureSession`,
 *      verify `kind='target'` and `source_baseline_id` is present.
 *   2. Load the source baseline + its accepted baseline items.
 *   3. Resolve target URL from session config + target auth from
 *      `secretsStore`.
 *   4. Create a NEW target baseline (`kind='target'`,
 *      `paired_with_baseline_id=<source>`, `status='draft'`).
 *   5. For each item: enforce the mutating-call gate, send via the
 *      per-session http executor, persist a new capture row, auto-accept
 *      it, promote to a baseline-item on the target baseline.
 *   6. Reset / increment the transport-failure counter per step's outcome;
 *      throw {@link TransportFailureThresholdExceededError} on threshold.
 *   7. After all items processed: PATCH session to `completed`, PATCH
 *      target baseline to `status='active'`, purge secrets via
 *      `secretsStore.purge`.
 *   8. Throughout: respect `runManager.cancel(sessionId)` -- checked
 *      between items; on cancel, mark session `cancelled` and exit cleanly.
 */
export async function runTargetReplay(
  sessionId: string,
  deps: TargetReplayDeps = {},
): Promise<TargetReplayOutcome> {
  const archModelClient = deps.archModelClient ?? defaultArchModelClient;
  const secretsStore = deps.secretsStore ?? defaultSecretsStore;
  const runManager = deps.runManager ?? defaultRunManager;
  const transportFailureThreshold =
    typeof deps.transportFailureThreshold === 'number'
      ? deps.transportFailureThreshold
      : DEFAULT_TRANSPORT_FAILURE_THRESHOLD;
  const perItemTimeoutMs =
    typeof deps.perItemTimeoutMs === 'number'
      ? deps.perItemTimeoutMs
      : DEFAULT_PER_ITEM_TIMEOUT_MS;
  const now = deps.now ?? (() => Date.now());

  const diagnostics: TargetReplayDiagnostic[] = [];
  let session: CaptureSessionDto | undefined;
  let sourceBaseline: BaselineDto | undefined;
  let items: BaselineItemDto[] = [];
  let targetBaseline: BaselineDto | null = null;
  let executor: SessionHttpExecutor | null = null;
  let itemsReplayed = 0;
  let itemsSkipped = 0;
  let itemsFailed = 0;
  let consecutiveTransportFailures = 0;
  let lastTransportErrorCode: string | null = null;

  // Helper: emit + persist diagnostic. Persistence to AMS is best-effort;
  // a write failure should not derail the run.
  async function emitDiagnostic(
    diag: TargetReplayDiagnostic,
    sessionRow: CaptureSessionDto | undefined,
  ): Promise<void> {
    diagnostics.push(diag);
    if (!sessionRow) return;
    try {
      await archModelClient.createDiagnostic(sessionRow.project_id, {
        session_id: sessionRow.id,
        diagnostic_type:
          diag.diagnosticType === 'mutating_skipped' ||
          diag.diagnosticType === 'sequence_skipped'
            ? 'endpoint_skipped'
            : 'failed_request',
        message: diag.message,
        detail_json: {
          itemId: diag.itemId ?? null,
          method: diag.method ?? null,
          path: diag.path ?? null,
          responseStatus: diag.responseStatus ?? null,
          errorCode: diag.errorCode ?? null,
          diagnosticType: diag.diagnosticType,
        },
      });
    } catch (err) {
      console.warn(
        `[targetReplayRunner] failed to persist diagnostic ${diag.diagnosticType}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  try {
    // ------------------------------------------------------------------
    // 1) Load the target session and validate kind / pairing
    // ------------------------------------------------------------------
    // We cannot fetch with just sessionId -- AMS requires projectId. We
    // do a "discover the projectId" via the cross-project running-status
    // list isn't realistic here; the route handler will have just created
    // (or already PATCHed) the session row, so we need the projectId
    // either threaded via deps or already-known via the request. In
    // practice the runner is spawned from the `/start` handler, which
    // already has the session row from its own fetch. To keep the
    // runner's signature minimal we expect the route handler to have
    // already verified the session exists; the runner re-fetches via
    // session id alone by exploiting the per-project endpoint. We use
    // the running-sessions cross-project list as a discovery probe.
    //
    // BUT the more economical contract: the route handler already calls
    // `archModelClient.getCaptureSession(projectId, sessionId)` to verify
    // the session. To avoid duplicating that, we ALSO accept a "session
    // fetcher" override -- production callers wire it via the route
    // handler. Since we don't have it injectable in the contract, we
    // resolve via the cross-project sessions-by-status list filtered by
    // id. This is best-effort; in production the route handler will have
    // pinned the session in 'running' state before invoking us.
    //
    // Cleaner: simply iterate the cross-project running list once. It's
    // small in practice (handful of sessions) and only invoked at the
    // start of a replay.
    const runningSessions = await archModelClient.listAllCaptureSessionsByStatus('running');
    const found = runningSessions.find((s) => s.id === sessionId);
    if (!found) {
      throw new Error(
        `target-replay: session ${sessionId} not found in 'running' state ` +
          `(route handler must transition the session to 'running' before invoking the runner)`,
      );
    }
    session = found;
    if (session.kind !== 'target') {
      throw new Error(
        `target-replay: session ${sessionId} has kind='${
          session.kind ?? 'current'
        }', expected 'target'`,
      );
    }
    if (!session.source_baseline_id) {
      throw new Error(
        `target-replay: session ${sessionId} has no source_baseline_id ` +
          `(invariant violation -- AMS service layer should have rejected creation)`,
      );
    }
    if (!session.api_base_url) {
      throw new Error(
        `target-replay: session ${sessionId} has no api_base_url`,
      );
    }
    const secrets = secretsStore.get(sessionId);
    if (!secrets) {
      throw new Error(
        `target-replay: secrets bundle missing for session ${sessionId}`,
      );
    }
    const projectId = session.project_id;

    // ------------------------------------------------------------------
    // 2) Load the source baseline + accepted items
    // ------------------------------------------------------------------
    sourceBaseline = await archModelClient.getBaseline(
      projectId,
      session.source_baseline_id,
    );
    if (sourceBaseline.kind === 'target') {
      throw new Error(
        `target-replay: source baseline ${session.source_baseline_id} ` +
          `has kind='target' -- can only replay from a 'current' baseline`,
      );
    }
    items = await archModelClient.listBaselineItems(
      projectId,
      session.source_baseline_id,
    );

    console.log(
      `[targetReplayRunner] op=start session=${sessionId.slice(0, 8)} ` +
        `source_baseline=${session.source_baseline_id.slice(0, 8)} ` +
        `items=${items.length} target_url=${session.api_base_url}`,
    );

    // SUMMARY: target replay is the target-side arm of reconcile.
    trace.step(
      `reconcile started — replaying ${items.length} source items against ${session.api_base_url}`,
      { project: projectId, arch: session.architecture_id, session: sessionId },
    );

    // ------------------------------------------------------------------
    // 3) Create the target baseline (draft -- finalised to active on
    //    successful completion)
    // ------------------------------------------------------------------
    targetBaseline = await archModelClient.createBaseline(projectId, {
      project_id: projectId,
      architecture_id: session.architecture_id,
      session_id: session.id,
      name:
        sourceBaseline.name != null
          ? `${sourceBaseline.name} (target)`
          : 'target-replay',
      status: 'draft',
      accepted_capture_count: 0,
      operation_count: items.length,
      notes: null,
      kind: 'target',
      paired_with_baseline_id: session.source_baseline_id,
    });

    // ------------------------------------------------------------------
    // 4) Set up the per-session HTTP executor against the target URL
    // ------------------------------------------------------------------
    const httpFactory =
      deps.createHttpExecutor ??
      ((args) => createSessionHttpExecutor(args));
    executor = httpFactory({
      auth: secrets.api,
      baseURL: session.api_base_url,
      timeoutMs: perItemTimeoutMs,
      defaultHeaders: session.default_headers_redacted_json ?? {},
    });

    // ------------------------------------------------------------------
    // 5) Iterate items: replay or skip; persist captures + auto-accept;
    //    promote to baseline-items.
    // ------------------------------------------------------------------
    for (const item of items) {
      // Cancellation check between items. The runManager.abortController
      // is also signalled to the in-flight http call, but we still poll
      // here so a cancel landing between items terminates promptly.
      const runState = runManager.get(sessionId);
      if (runState && runState.abortController.signal.aborted) {
        await emitDiagnostic(
          {
            diagnosticType: 'replay_cancelled',
            message: 'Target replay cancelled mid-run',
            itemId: item.id,
          },
          session,
        );
        // Drop out of the loop; the finally block tears down the executor
        // and the cleanup tail patches the session to `cancelled`.
        await archModelClient.patchCaptureSession(projectId, sessionId, {
          status: 'cancelled',
          completed_at: new Date(now()).toISOString(),
        });
        return {
          sessionId,
          targetBaselineId: targetBaseline.id,
          itemsTotal: items.length,
          itemsReplayed,
          itemsSkipped,
          itemsFailed,
          finalStatus: 'cancelled',
          errorMessage: null,
          diagnostics,
        };
      }

      const req = extractItemRequest(item);

      // ----------------------------------------------------------------
      // SEQUENCE DISPATCH (Spec D, Task Group 3). A baseline item whose
      // sequence_json is non-null is an ordered setup -> act -> cleanup
      // HTTP chain captured atomically as ONE oracle unit. Hand it to the
      // deterministic ordered-step sub-runner, which runs the steps in
      // order, resolves $<step>.<jsonpath> refs from earlier LIVE responses,
      // asserts setup statuses, promotes the ACT response to a target
      // baseline-item (so the existing auto-diff fully diffs it), and runs
      // cleanup best-effort. NON-sequence items fall through to the existing
      // single-shot path BYTE-FOR-BYTE unchanged.
      if (item.sequence_json != null) {
        const seqDeps: SequenceReplayDeps = { archModelClient, now };
        const seqResult = await replaySequenceItem(
          item,
          session,
          targetBaseline,
          executor,
          seqDeps,
        );
        // Fold the sub-runner diagnostics into the run + persist each one.
        for (const d of seqResult.diagnostics) {
          await emitDiagnostic(d, session);
        }
        // Counter accounting mirrors the single-shot path: a skipped
        // sequence counts as skipped; a setup failure as failed; an act that
        // replayed (and was diffed) as replayed. Cleanup failure / residual
        // pollution are FLAGGED (diagnostics above) but never change the
        // replayed/failed verdict (best-effort isolation, R5/R6).
        if (seqResult.skipped) {
          itemsSkipped += 1;
        } else if (seqResult.setupFailed) {
          itemsFailed += 1;
        } else if (seqResult.actReplayed) {
          itemsReplayed += 1;
        }
        continue;
      }

      const isMutating = MUTATING_METHODS.has(req.method);
      const mutatingConfirmed = session.mutating_calls_confirmed === true;

      if (isMutating && !mutatingConfirmed) {
        itemsSkipped += 1;
        await emitDiagnostic(
          {
            diagnosticType: 'mutating_skipped',
            message:
              `Skipped mutating source item ${req.method} ${req.path} -- ` +
              `target session has mutating_calls_confirmed=false`,
            itemId: item.id,
            method: req.method,
            path: req.path,
          },
          session,
        );
        continue;
      }

      // --- Send the request ---
      const requestStartedAt = now();
      let capture: CaptureDto | null = null;
      try {
        const response = await executor.request({
          method: req.method as never,
          url: req.path,
          params: req.query,
          headers: req.headers,
          data: req.body,
        });
        // Successful HTTP response (any status code 100-599 since
        // validateStatus: () => true). Reset the counter.
        consecutiveTransportFailures = 0;
        lastTransportErrorCode = null;

        capture = await archModelClient.createCapture(projectId, {
          session_id: session.id,
          scenario_id: item.scenario_id,
          operation_id: item.operation_id,
          attempt_number: 1,
          request_method: req.method,
          request_path: req.path,
          // Issue 1: AMS REQUIRES a non-blank request_url_redacted (else 400).
          request_url_redacted: redactUrl(
            ((session.api_base_url ?? '').replace(/\/+$/, '') +
              (req.path.startsWith('/') ? req.path : `/${req.path}`)) ||
            req.path),
          request_query_json: req.query ?? null,
          request_headers_redacted_json: req.headers ?? null,
          request_body_json: normaliseBodyForAms(req.body),
          response_status: response.status,
          response_headers_redacted_json:
            response.headers && typeof response.headers === 'object'
              ? (Object.fromEntries(
                  Object.entries(response.headers).map(([k, v]) => [
                    k,
                    Array.isArray(v) ? v.join(', ') : String(v ?? ''),
                  ]),
                ) as Record<string, string>)
              : null,
          response_body_json: normaliseBodyForAms(response.data),
          // Spec 2026-07-06-j: target-side bodies persist unredacted, so the
          // raw wire text rides verbatim (strict byte verdicts need BOTH
          // sides). Null when the executor could not retain it.
          response_body_raw: rawBodyOf(response),
          duration_ms: now() - requestStartedAt,
          error_type: null,
          error_message: null,
          captured_at: new Date(now()).toISOString(),
        });

        // Auto-accept -- target captures land accepted by design.
        await archModelClient.patchCapture(projectId, capture.id, {
          accepted: true,
          accepted_at: new Date(now()).toISOString(),
        });

        // Promote to baseline-item on the target baseline.
        await archModelClient.createBaselineItem(projectId, {
          baseline_id: targetBaseline.id,
          capture_id: capture.id,
          operation_id: item.operation_id,
          scenario_id: item.scenario_id,
          method: req.method,
          path: req.path,
          scenario_name: item.scenario_name,
          request_json: {
            query: req.query ?? null,
            headers: req.headers ?? null,
            body: req.body ?? null,
          },
          response_status: response.status,
          response_json: {
            headers: capture.response_headers_redacted_json,
            body: capture.response_body_json,
          },
          // Spec 2026-07-06-j: byte-verdict input for the strict profile.
          response_body_raw: rawBodyOf(response),
          business_notes: null,
        });

        itemsReplayed += 1;

        // Non-2xx is data, but we still surface a diagnostic so the
        // reviewer can spot the obvious-broken responses faster.
        if (response.status < 200 || response.status >= 300) {
          await emitDiagnostic(
            {
              diagnosticType: 'replay_non_2xx',
              message: `Target replied with non-2xx status ${response.status} for ${req.method} ${req.path}`,
              itemId: item.id,
              method: req.method,
              path: req.path,
              responseStatus: response.status,
            },
            session,
          );
        }
      } catch (err) {
        const { isTransportFailure, code } = classifyError(err);
        itemsFailed += 1;
        if (isTransportFailure) {
          consecutiveTransportFailures += 1;
          lastTransportErrorCode = code;
          await emitDiagnostic(
            {
              diagnosticType: 'replay_transport_failure',
              message:
                `Transport-level failure on ${req.method} ${req.path}` +
                (code ? ` (${code})` : '') +
                ` -- consecutive=${consecutiveTransportFailures}/${transportFailureThreshold}`,
              itemId: item.id,
              method: req.method,
              path: req.path,
              errorCode: code,
            },
            session,
          );
          if (consecutiveTransportFailures >= transportFailureThreshold) {
            throw new TransportFailureThresholdExceededError(
              transportFailureThreshold,
              lastTransportErrorCode,
            );
          }
        } else {
          // Should not happen given httpExecutor's validateStatus: () => true,
          // but defensively treat as a per-item failure that does NOT count
          // toward the transport-level threshold.
          await emitDiagnostic(
            {
              diagnosticType: 'replay_non_2xx',
              message: `Non-transport error on ${req.method} ${req.path}: ${
                err instanceof Error ? err.message : String(err)
              }`,
              itemId: item.id,
              method: req.method,
              path: req.path,
              errorCode: code,
            },
            session,
          );
        }
      }
    }

    // ------------------------------------------------------------------
    // 6) Mark session completed + finalise target baseline to active.
    // ------------------------------------------------------------------
    await archModelClient.patchCaptureSession(projectId, sessionId, {
      status: 'completed',
      completed_at: new Date(now()).toISOString(),
      error_message: null,
    });
    await archModelClient.patchBaseline(projectId, targetBaseline.id, {
      status: 'active',
      accepted_capture_count: itemsReplayed,
      operation_count: items.length,
    });

    // ------------------------------------------------------------------
    // 7) Auto-trigger the diff engine as a background task.
    //
    // Spec: 2026-05-25 Diff Engine -- Task Group 3 (accepted Q4: direct
    // local invocation, NOT a self-HTTP call). Fail-soft: the replay
    // session has ALREADY been patched to completed and the target
    // baseline finalised to active above; the manual Recompute button on
    // the Drift report tab is the user-visible fallback if the auto-spawn
    // fails.
    //
    // The runner reuses runManager with diffId in the sessionId slot --
    // see diffRunner.ts. We register the live entry HERE so cancel()
    // can signal abort to the in-flight runner; runDiff's finally block
    // calls runManager.end(diffId).
    // ------------------------------------------------------------------
    const runDiffFn = deps.runDiffFn ?? defaultRunDiff;
    const resolveNonDeterministicEndpointKeys =
      deps.resolveNonDeterministicEndpointKeys ?? defaultResolveNdKeys;
    try {
      const diff = await archModelClient.createDiff(projectId, {
        project_id: projectId,
        architecture_id: session.architecture_id,
        source_baseline_id: session.source_baseline_id as string,
        target_baseline_id: targetBaseline.id,
        status: 'computing',
      });
      try {
        if (!runManager.has(diff.id)) {
          runManager.start({
            sessionId: diff.id,
            projectId,
            architectureId: session.architecture_id,
          });
        }
      } catch {
        // Already-running protection -- a concurrent recompute is fine,
        // we simply skip our spawn.
      }
      // Resolve the FU-1 `endpoint_signal` volatility keys from the discovery
      // signal so the auto-diff is value-tolerant for
      // `non_deterministic_endpoint`-flagged operations. `items` IS the source
      // baseline-item set (loaded at step 3), so the produced keys are the
      // diff's own concrete operation keys. Fail-soft = strict (G1).
      let nonDeterministicEndpointKeys = new Set<string>();
      try {
        nonDeterministicEndpointKeys = await resolveNonDeterministicEndpointKeys(
          projectId,
          session.architecture_id,
          items,
        );
      } catch (err) {
        console.warn(
          `[targetReplayRunner] op=nd_keys_resolve_failed diffId=${diff.id} err=${
            err instanceof Error ? err.message : String(err)
          } -- diff will run strict`,
        );
      }
      // Fire-and-forget: do NOT await. Replay returns immediately
      // regardless of diff outcome.
      runDiffFn(diff.id, { nonDeterministicEndpointKeys }).catch((err) => {
        console.error(
          `[targetReplayRunner] op=auto_diff_trigger_failed diffId=${diff.id} err=${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });
    } catch (err) {
      console.error(
        `[targetReplayRunner] op=auto_diff_create_failed err=${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    console.log(
      `[targetReplayRunner] op=complete session=${sessionId.slice(0, 8)} ` +
        `replayed=${itemsReplayed} skipped=${itemsSkipped} failed=${itemsFailed}`,
    );

    // SUMMARY: target replay completed -- itemsReplayed is the truthful
    // count of source items re-driven against the target; failed/skipped
    // carry the rest. The diff (auto-triggered above) emits its own
    // reconcile COMPLETED line with the break count.
    if (itemsReplayed > 0) {
      trace.ok(
        `reconcile COMPLETED — ${itemsReplayed}/${items.length} replayed, ` +
          `${itemsFailed} failed, ${itemsSkipped} skipped`,
        { project: projectId, arch: session.architecture_id, session: sessionId },
      );
    } else {
      trace.fail(
        `reconcile COMPLETED but 0/${items.length} replayed — ` +
          `${itemsFailed} failed, ${itemsSkipped} skipped`,
        { project: projectId, arch: session.architecture_id, session: sessionId },
      );
    }

    return {
      sessionId,
      targetBaselineId: targetBaseline.id,
      itemsTotal: items.length,
      itemsReplayed,
      itemsSkipped,
      itemsFailed,
      finalStatus: 'completed',
      errorMessage: null,
      diagnostics,
    };
  } catch (err) {
    const isThreshold = err instanceof TransportFailureThresholdExceededError;
    const errorMessage = isThreshold ? 'target_unreachable' : (err instanceof Error ? err.message : String(err));
    console.error(
      `[targetReplayRunner] op=fail session=${sessionId.slice(0, 8)} reason=${errorMessage}`,
    );
    // SUMMARY: replay failed. session may be undefined if the very first
    // load threw -- fall back to the sessionId-only corr in that case.
    trace.fail(`reconcile FAILED — ${errorMessage}`, {
      project: (session as CaptureSessionDto | undefined)?.project_id,
      arch: (session as CaptureSessionDto | undefined)?.architecture_id,
      session: sessionId,
    });
    // Best-effort terminal state -- if AMS is unreachable here the session
    // stays running and startup reconciliation catches it on next boot.
    try {
      // Need a session row to know the projectId. We may have one already.
      const projectId =
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (session as CaptureSessionDto | undefined)?.project_id;
      if (projectId) {
        await archModelClient.patchCaptureSession(projectId, sessionId, {
          status: 'failed',
          completed_at: new Date(now()).toISOString(),
          error_message: errorMessage,
        });
      }
    } catch (patchErr) {
      console.error(
        `[targetReplayRunner] fail-state PATCH failed: ${
          patchErr instanceof Error ? patchErr.message : String(patchErr)
        }`,
      );
    }
    return {
      sessionId,
      targetBaselineId: targetBaseline?.id ?? '',
      itemsTotal: 0,
      itemsReplayed,
      itemsSkipped,
      itemsFailed,
      finalStatus: 'failed',
      errorMessage,
      diagnostics,
    };
  } finally {
    if (executor) {
      try {
        executor.dispose();
      } catch {
        // Pool teardown errors don't matter.
      }
    }
    // Purge in-memory secrets + end the runManager handle. Both are
    // idempotent.
    try {
      secretsStore.purge(sessionId);
    } catch {
      // ignore
    }
    if (runManager.has(sessionId)) {
      runManager.end(sessionId);
    }
  }
}
