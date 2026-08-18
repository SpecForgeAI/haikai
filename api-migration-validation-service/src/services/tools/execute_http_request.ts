import { AxiosError, AxiosResponse } from 'axios';
import { ToolHandler, ToolRegistryEntry, ToolValidationError } from './toolTypes';
import { extractIdentifierFacts } from './_idFacts';
import { redactHeaders, redactJson, redactUrl } from '../redactor';
import { rawBodyOf } from '../httpExecutor';
import { persistableRawBody } from '../rawBodyPolicy';
import { HttpMethod } from '../../types/oas';
import { runManager } from '../runManager';
import { LLM_HTTP_ATTEMPTS_PER_SCENARIO } from '../../config';
import {
  runVolatilityProbe,
  volatilityEnvelopeToWire,
} from '../volatilityProbe';
import { coerceAuthMode, resolveAuthOverride } from '../authOverride';
import { createTracer } from '../../trace';
import { normaliseBodyForAms } from '../amsBodyEnvelope';
import {
  EffectScopeIndex,
  StateSnapshot,
  computeStateDelta,
  effectTablesFor,
  fetchEffectScopeIndex,
  keyHintFromResponse,
  snapshotEffectTables,
} from '../stateDelta';

// Haikai workflow trace logger (OFF by default; no-op unless HAIKAI_TRACE is
// set). See docs/trace-logging.md. DETAIL events live on the capture
// internals -- the path we debug when a capture run goes wrong.
const trace = createTracer('capture-svc');

/**
 * Fix 6: distill a SHORT one-line cause from a non-2xx HTML/text error body.
 *
 * A Tomcat / Jersey target buries the real fault (e.g. "Invalid format:
 * 20240131 is malformed at...") inside an HTML 415/500 error page or a long
 * stack-trace text block. The LLM (and the operator reviewing captures) would
 * otherwise have to dig through escaped HTML to find it. This collapses the
 * body to a single readable line so it can be surfaced both on the persisted
 * capture row's `error_message` AND on the tool's LLM-facing return.
 *
 * Defensive contract (mirrors `normaliseBodyForAms`): NEVER throws, returns
 * `null` when there is nothing useful to surface (2xx, non-string body, empty
 * body). Only meaningful for a non-2xx string body. Caps at ~300 chars.
 */
function extractErrorSummary(body: unknown, status: number): string | null {
  try {
    if (status >= 200 && status < 300) return null;
    if (typeof body !== 'string') return null;
    const raw = body.trim();
    if (raw.length === 0) return null;

    const MAX = 300;
    const cap = (s: string): string =>
      s.length > MAX ? `${s.slice(0, MAX - 1).trimEnd()}…` : s;
    const collapse = (s: string): string =>
      s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

    // 1. Prefer a Tomcat / Jersey HTML error page's <title> -- it carries the
    //    status line + a short reason ("HTTP Status 415 - Unsupported...").
    const titleMatch = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (titleMatch) {
      const title = collapse(titleMatch[1]);
      if (title.length > 0) return cap(title);
    }

    // 2. Tomcat's <p><b>Message</b> ... </p> / <b>Description</b> rows hold
    //    the buried real fault (e.g. "Invalid format: 20240131 is malformed").
    //    Capture the run of text AFTER a Message/Description label.
    const labelMatch = raw.match(
      /(?:message|description)\b[^>]*>?\s*([\s\S]{1,600})/i,
    );
    if (labelMatch) {
      const labelled = collapse(labelMatch[1]);
      if (labelled.length > 0) return cap(labelled);
    }

    // 3. Fall back to the first meaningful (non-empty, post-tag-strip) line.
    for (const line of raw.split(/\r?\n/)) {
      const cleaned = collapse(line);
      if (cleaned.length > 0) return cap(cleaned);
    }

    // 4. Nothing line-oriented survived -- collapse the whole thing.
    const whole = collapse(raw);
    return whole.length > 0 ? cap(whole) : null;
  } catch {
    // Defensive: a malformed body must never break capture persistence.
    return null;
  }
}

/**
 * Verbs for which the executor defaults a Content-Type even when the request
 * carries NO body. A Tomcat / Jersey target rejects a body-less PUT / POST /
 * PATCH with no Content-Type as HTTP 415 (the #3 failure: setFavourite /
 * unsetFavourite / revertFilterPromotionRequest), so we default it for every
 * mutating verb -- not only when a body is present.
 *
 * Spec: 2026-06-19 Request Contract from Code Evidence -- Task Group 4 (R4).
 */
const CONTENT_TYPE_DEFAULTING_VERBS: ReadonlySet<string> = new Set([
  'put',
  'post',
  'patch',
]);

/**
 * Verbs whose effect-table state is snapshotted around the call
 * (Spec 2026-07-06-n). Mutating verbs only — a GET has no state to delta.
 */
const STATE_DELTA_VERBS: ReadonlySet<string> = new Set([
  'post',
  'put',
  'patch',
  'delete',
]);

/**
 * Single-entry per-session effect-scope cache (Spec 2026-07-06-n). ONE
 * committed-model read per capture session, re-fetched when the session id
 * changes — session-scoped, honouring the "tools MUST NOT cache anything
 * across sessions" contract while avoiding a full-model fetch per mutating
 * call. `index: null` = the read failed (deltas stay null; the diff verdict
 * degrades VISIBLY to `state_unverified`).
 */
let effectScopeCache: { sessionId: string; index: EffectScopeIndex | null } | null = null;

async function effectScopeForSession(
  ctx: Parameters<ToolHandler>[1],
): Promise<EffectScopeIndex | null> {
  if (effectScopeCache && effectScopeCache.sessionId === ctx.session.id) {
    return effectScopeCache.index;
  }
  const index = await fetchEffectScopeIndex(
    ctx.session.projectId,
    ctx.session.architectureId,
  );
  effectScopeCache = { sessionId: ctx.session.id, index };
  return index;
}

/**
 * Resolve the request media type the executor should default for one
 * operation, reading the (capture-time-enriched) OAS operation off the
 * in-memory inventory by operationId. The enriched `request_contract`
 * content-type lands on `oasOperation.requestBody.content` (see
 * `requestContractEnrichment.ts`), so the first content media-type key IS
 * the code-evidence-or-contract request media type. Returns null when the
 * operation is absent or carries no request media type -- the caller then
 * falls back to `application/json` (R4).
 *
 * Pure + total: never throws; a malformed inventory shape yields null.
 */
function resolveOperationContentType(
  ctx: Parameters<ToolHandler>[1],
  operationId: string,
): string | null {
  try {
    const ops = ctx.oasInventory?.operations;
    if (!Array.isArray(ops)) return null;
    const op = ops.find((o) => o.operationId === operationId);
    const reqBody = (op?.oasOperation as { requestBody?: unknown } | undefined)?.requestBody;
    if (!reqBody || typeof reqBody !== "object") return null;
    const content = (reqBody as { content?: unknown }).content;
    if (!content || typeof content !== "object") return null;
    const keys = Object.keys(content as Record<string, unknown>);
    for (const k of keys) {
      if (typeof k === "string" && k.trim().length > 0) return k;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Resolve the preferred `Accept` media type for a content-negotiated twin
 * operation (Spec 2026-07-23, XML3): the FIRST `produces` member of the
 * `x-amvs-content` block `synthesiseOperationFromEndpoint` stamps onto rows
 * synthesised from a discriminator-suffixed endpoint. Returns null for every
 * other operation (no block -> no Accept defaulting -> wire behaviour
 * unchanged). Pure + total: never throws; malformed shapes yield null.
 */
function resolveOperationProduces(
  ctx: Parameters<ToolHandler>[1],
  operationId: string,
): string | null {
  try {
    const ops = ctx.oasInventory?.operations;
    if (!Array.isArray(ops)) return null;
    const op = ops.find((o) => o.operationId === operationId);
    const block = (op?.oasOperation as { 'x-amvs-content'?: unknown } | undefined)?.[
      'x-amvs-content'
    ];
    if (!block || typeof block !== 'object') return null;
    const produces = (block as { produces?: unknown }).produces;
    if (!Array.isArray(produces)) return null;
    const first = produces.find((m) => typeof m === 'string' && m.trim().length > 0);
    return typeof first === 'string' ? first.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Tool: `execute_http_request`
 *
 * The only path the LLM has into a real HTTP call. Hard gates:
 *   1. The operation MUST exist in `api_behaviour_operations` for the
 *      session AND have `included = TRUE`.
 *   2. The operation must be executable: either `safe_to_execute = TRUE`
 *      OR the session was started with `mutating_calls_confirmed = true`.
 *      (Predecessor spec's third "mutating-verb" gate was dead code -- the
 *      `safe_to_execute` flag is only set TRUE for non-mutating verbs UNLESS
 *      the user has confirmed mutating calls at session start. Fix:
 *      `included AND (safe_to_execute OR mutating_calls_confirmed)`.)
 *   3. The per-tool 30s timeout is enforced by the loop runner via the
 *      executor's per-call axios timeout.
 *   4. Up to `LLM_HTTP_ATTEMPTS_PER_SCENARIO` (default 3) attempts per
 *      scenario. The counter lives on `runManager.scenarioHttpAttempts`
 *      and is incremented at the TOP of the handler (before any gate)
 *      so that even early-failed attempts consume budget.
 *
 * Outcomes -- every attempt persists a capture row to AMS via
 * `ctx.archModelClient.createCapture`, regardless of success/failure:
 *   - 2xx / non-2xx with HTTP response: `response_status`, redacted headers,
 *     redacted body, `duration_ms` populated.
 *   - Transport / auth failure (no HTTP response): `response_status = null`,
 *     `response_headers_redacted_json = null`, `response_body_json = null`,
 *     `error_type` + `error_message` populated from the caught AxiosError.
 *
 * The redacted shapes (`redactHeaders` / `redactJson`) are built once and
 * reused for BOTH the LLM-facing return value AND the persisted capture
 * row -- DO NOT redact twice.
 *
 * Returns a captured request/response shape (HEADERS / BODY are redacted
 * BEFORE being returned to the loop runner; the runner sends this back to
 * the LLM, so the LLM never sees plaintext secrets) AND includes the
 * persisted `captureId` so the LLM can correlate.
 *
 * Spec: 2026-05-15 API Behaviour Baseline Capture Service -- Task Group 5
 *       (initial tool wiring).
 * Spec: 2026-05-16 API Behaviour Capture Fixes -- auto-persist every attempt,
 *       combined mutating-call gate, counter on runManager (Decisions D2-D4,
 *       D7).
 * Spec: 2026-06-16 Reconcile-Time Determinism & Volatile-Value Handling --
 *       misleading-COMPLETED follow-up: bump `runManager.scenarioCapturesPersisted`
 *       only when `createCapture` SUCCEEDS, and emit a `failed_request`
 *       diagnostic when the HTTP attempt produced no response or when
 *       `createCapture` throws, so a no-capture-yet-"completed" scenario is
 *       auditable and is counted as errored by the orchestrator, not captured.
 * Spec: 2026-06-17 Oracle Coverage Scoring -- optional `authMode` arg
 *       (`session` | `none` | `bad_token`) routes the SINGLE call through the
 *       executor's SCOPED auth-override seam so a deliberate no-auth / bad-token
 *       request lands as a normal (401/403) captured row. When absent the
 *       normal auth path is byte-for-byte unchanged.
 */

/**
 * Best-effort `failed_request` diagnostic for a no-capture HTTP attempt.
 * NEVER throws -- a failing diagnostic write must not mask the underlying
 * HTTP / persistence error that the LLM and orchestrator need to see.
 */
async function safeRecordFailedRequest(
  ctx: Parameters<ToolHandler>[1],
  detail: {
    operationRowId: string | null;
    operationId: string;
    method: string;
    path: string;
    attemptNumber: number;
    phase: 'http_no_response' | 'create_capture_failed';
    errorType: string | null;
    errorMessage: string | null;
  },
): Promise<void> {
  try {
    await ctx.archModelClient.createDiagnostic(ctx.session.projectId, {
      session_id: ctx.session.id,
      scenario_id: ctx.currentScenarioId,
      operation_id: detail.operationRowId,
      diagnostic_type: 'failed_request',
      message:
        detail.phase === 'create_capture_failed'
          ? `Capture persistence failed for ${detail.method} ${detail.path} ` +
            `(attempt ${detail.attemptNumber}): ${detail.errorMessage ?? 'unknown error'}.`
          : `HTTP request produced no response for ${detail.method} ${detail.path} ` +
            `(attempt ${detail.attemptNumber}): ${detail.errorType ?? 'transport_failure'}.`,
      detail_json: {
        phase: detail.phase,
        operation_id: detail.operationId,
        method: detail.method,
        path: detail.path,
        attempt_number: detail.attemptNumber,
        error_type: detail.errorType,
        error_message: detail.errorMessage,
      },
    });
  } catch (diagErr) {
    // eslint-disable-next-line no-console
    console.warn(
      'execute_http_request: failed to write failed_request diagnostic',
      diagErr instanceof Error ? diagErr.message : String(diagErr),
    );
  }
}

const handler: ToolHandler = async (args, ctx) => {
  // Stable corr bag for every trace call: project + arch are the
  // workflow-spanning key, session is this capture's sub-thread.
  const corr = {
    project: ctx.session.projectId,
    arch: ctx.session.architectureId,
    session: ctx.session.id,
  };

  if (!ctx.httpExecutor) {
    throw new ToolValidationError(
      'execute_http_request',
      'no_http_executor',
      'No HTTP executor is bound to this capture session run.',
    );
  }
  const operationId = typeof args.operationId === 'string' ? args.operationId : null;
  const method = typeof args.method === 'string' ? args.method.toLowerCase() : null;
  const path = typeof args.path === 'string' ? args.path : null;
  if (!operationId || !method || !path) {
    throw new ToolValidationError(
      'execute_http_request',
      'missing_args',
      '`operationId`, `method`, and `path` are required.',
    );
  }

  // ---- Optional scoped auth override (`session` | `none` | `bad_token`).
  // Defaults to `session` (the normal auto-injected auth) when absent so the
  // common path is byte-for-byte unchanged. The override, when present, is
  // applied to THIS single call only via the executor's
  // `requestWithAuthOverride` seam (swap-before / restore-immediately-after),
  // so a no-auth / bad-token request can never leak onto a later capture.
  const authMode = coerceAuthMode(args.authMode);
  const authOverride = resolveAuthOverride(authMode);

  // ---- Attempt counter: increment FIRST so every entry (even ones that
  // fail at a gate) consumes a slot. Source of truth is `runManager`; the
  // legacy `ctx.retryCount` field is no longer read here.
  const attemptNumber = runManager.incrementHttpAttempts(ctx.session.id);

  // ---- Gate 1: operation must be persisted for this session
  const persisted = ctx.operationsByOasId.get(operationId);
  if (!persisted) {
    throw new ToolValidationError(
      'execute_http_request',
      'operation_not_persisted',
      `operationId='${operationId}' does not exist in this session's operations table.`,
    );
  }
  if (persisted.included !== true) {
    throw new ToolValidationError(
      'execute_http_request',
      'operation_not_included',
      `operationId='${operationId}' is not marked included for this session.`,
    );
  }

  // ---- Gate 2 (combined): the operation must be executable, either
  // because it's marked `safe_to_execute = TRUE` (non-mutating verb under
  // default policy) OR because the session has `mutatingCallsConfirmed`.
  // The previous code had two independent gates here; the second one was
  // dead because `safe_to_execute = FALSE` for any mutating verb without
  // confirmation, so confirmation could never unlock anything.
  const safeToExecute = persisted.safe_to_execute === true;
  const mutatingConfirmed = ctx.session.mutatingCallsConfirmed === true;
  if (!safeToExecute && !mutatingConfirmed) {
    // DETAIL: the mutating-gate decision -- this attempt is NOT executed
    // because the operation is unsafe and mutating calls were not confirmed.
    trace.detail(
      'capture.gate.skip',
      {
        reason: 'mutating_not_confirmed',
        op: `${method.toUpperCase()} ${path}`,
        operationId,
        safeToExecute,
        mutatingConfirmed,
      },
      corr,
    );
    throw new ToolValidationError(
      'execute_http_request',
      'operation_not_executable',
      `operationId='${operationId}' is not executable: ` +
        `safe_to_execute=${String(persisted.safe_to_execute)} ` +
        `and session.mutatingCallsConfirmed=${String(ctx.session.mutatingCallsConfirmed)}. ` +
        `Confirm mutating calls at session start to execute mutating verbs.`,
    );
  }

  // ---- Gate 3: retry budget. Use the freshly-incremented counter so the
  // 4th attempt is the one that trips the cap, not the 3rd.
  if (attemptNumber > LLM_HTTP_ATTEMPTS_PER_SCENARIO) {
    // Best-effort diagnostic so the operator-facing review surface shows
    // why this scenario halted. Failure to write the diagnostic must NOT
    // mask the budget-exhausted error to the LLM, so swallow + log.
    try {
      await ctx.archModelClient.createDiagnostic(ctx.session.projectId, {
        session_id: ctx.session.id,
        scenario_id: ctx.currentScenarioId,
        operation_id: persisted.id,
        diagnostic_type: 'retry_exhausted',
        message:
          `HTTP attempt budget exhausted for scenario: ` +
          `attempt ${attemptNumber} > cap ${LLM_HTTP_ATTEMPTS_PER_SCENARIO}.`,
        detail_json: {
          attempt_number: attemptNumber,
          cap: LLM_HTTP_ATTEMPTS_PER_SCENARIO,
          operation_id: operationId,
          method: method.toUpperCase(),
          path,
        },
      });
    } catch (diagErr) {
      // Diagnostics are best-effort; budget-exhausted error still surfaces.
      // eslint-disable-next-line no-console
      console.warn(
        'execute_http_request: failed to write retry_exhausted diagnostic',
        diagErr,
      );
    }
    throw new ToolValidationError(
      'execute_http_request',
      'retry_budget_exhausted',
      `Maximum of ${LLM_HTTP_ATTEMPTS_PER_SCENARIO} HTTP attempts per scenario reached (attempt ${attemptNumber}).`,
    );
  }

  // ---- Build + execute request
  const queryParams = (args.query && typeof args.query === 'object') ? args.query as Record<string, unknown> : undefined;
  const headers = (args.headers && typeof args.headers === 'object') ? args.headers as Record<string, string> : undefined;
  const body = args.body !== undefined ? args.body : undefined;

  // ---- Fix 4 (2026-05-16) + Task Group 4 (2026-06-19): default a Content-Type
  // for the LLM-driven request path where the caller did not set one. A Tomcat
  // / Jersey target rejects a request with no Content-Type as HTTP 415
  // (Unsupported Media Type), so the capture LLM's request fails AVOIDABLY. We
  // default it HERE (the LLM-driven request path) rather than in the shared
  // `httpExecutor` -- the bare connection probe + target replay also flow
  // through that executor and must NOT be force-defaulted.
  //
  // The default now fires when EITHER the request carries a body OR the verb is
  // mutating (PUT / POST / PATCH) regardless of body. The body-less branch is
  // the #3 fix: a body-less PUT (setFavourite / unsetFavourite /
  // revertFilterPromotionRequest) otherwise reaches the target with no
  // Content-Type and is rejected 415. The media type is sourced from the
  // (capture-time `request_contract`-enriched) operation contract
  // (`oasOperation.requestBody.content`), falling back to `application/json`
  // (R4).
  //
  // The check is case-INSENSITIVE on the caller's header keys (HTTP header
  // names are case-insensitive; a caller-set `content-type`, `Content-Type`,
  // or `CONTENT-TYPE` must all be preserved, not overridden).
  //
  // The caller-set Content-Type is honored ONLY when its VALUE is a
  // syntactically valid `type/subtype` media type. The LLM sometimes emits an
  // enum-style constant name instead -- e.g. Spring's `APPLICATION_JSON`
  // (the constant NAME, whose value is actually `application/json`), picked up
  // from an OAS/discovery finding or its Java priors. The target cannot parse
  // that as a media type and rejects the request 415 / 500. Such a value is
  // treated as UNSET: the bad header is stripped (so it never reaches the wire)
  // and the contract-resolved default below fills in the correct media type.
  // ONLY Content-Type is validated this way -- every other header (auth,
  // custom, correlation ids, ...) passes through verbatim and untouched.
  let effectiveHeaders: Record<string, string> | undefined = headers;
  const callerContentTypeEntry = headers
    ? Object.entries(headers).find(([k]) => k.toLowerCase() === 'content-type')
    : undefined;
  const callerContentTypeIsValidMediaType =
    !!callerContentTypeEntry &&
    typeof callerContentTypeEntry[1] === 'string' &&
    /^[\w.+-]+\/[\w.+-]+/.test(callerContentTypeEntry[1].trim());

  // Drop a present-but-invalid caller Content-Type so it cannot reach the wire
  // (and so the defaulting below is free to replace it). A valid caller value
  // is preserved verbatim, including its original key casing.
  if (callerContentTypeEntry && !callerContentTypeIsValidMediaType) {
    effectiveHeaders = Object.fromEntries(
      Object.entries(headers ?? {}).filter(
        ([k]) => k.toLowerCase() !== 'content-type',
      ),
    );
  }

  const shouldDefaultContentType =
    body !== undefined || CONTENT_TYPE_DEFAULTING_VERBS.has(method);
  if (shouldDefaultContentType && !callerContentTypeIsValidMediaType) {
    const mediaType =
      resolveOperationContentType(ctx, operationId) ?? 'application/json';
    effectiveHeaders = { ...(effectiveHeaders ?? {}), 'Content-Type': mediaType };
  }

  // ---- Accept defaulting for content-negotiated twins (Spec 2026-07-23,
  // XML3). ONLY operations synthesised from a discriminator-suffixed endpoint
  // carry an `x-amvs-content` block; for those, defaulting Accept from
  // `produces` is what actually elicits the twin's response variant (an XML
  // twin without Accept: application/xml just gets JSON back — capturing the
  // WRONG behaviour under the twin's identity). Ordinary OAS-parsed
  // operations have no block, so their wire behaviour is byte-identical to
  // before. A caller-set Accept always wins.
  const callerSetAccept = effectiveHeaders
    ? Object.keys(effectiveHeaders).some((k) => k.toLowerCase() === 'accept')
    : false;
  if (!callerSetAccept) {
    const produces = resolveOperationProduces(ctx, operationId);
    if (produces) {
      effectiveHeaders = { ...(effectiveHeaders ?? {}), Accept: produces };
    }
  }

  // ---- Spec 2026-07-06-n: PRE-call state snapshot for a MUTATING call.
  //
  // Response parity alone cannot prove a write endpoint — the target can
  // return the right response and write the wrong rows. When (a) a DB
  // adapter is bound to this session, (b) the verb is mutating AND the
  // session confirmed mutating calls, and (c) the committed model names
  // this operation's effect tables (endpoint_data_effects write edges),
  // snapshot those tables BEFORE the call; the matching post-call snapshot
  // below yields `state_delta_json` on the capture row. Every guard-miss
  // and every failure leaves the delta null — the reconcile verdict then
  // degrades VISIBLY to `state_unverified`, never a silent pass. An
  // auth-override attempt (deliberate 401/403 negative) is not snapshotted,
  // mirroring the volatility-probe posture.
  let stateEffectTables: string[] = [];
  let preStateSnapshot: StateSnapshot | null = null;
  if (
    ctx.dbAdapter &&
    mutatingConfirmed &&
    STATE_DELTA_VERBS.has(method) &&
    !authOverride
  ) {
    try {
      const scope = await effectScopeForSession(ctx);
      stateEffectTables = scope ? effectTablesFor(scope, method, path) : [];
      if (stateEffectTables.length > 0) {
        preStateSnapshot = await snapshotEffectTables(ctx.dbAdapter, stateEffectTables);
      }
    } catch (snapErr) {
      // eslint-disable-next-line no-console
      console.warn(
        `execute_http_request: pre-call state snapshot failed for session=${ctx.session.id} ` +
          `op=${method.toUpperCase()} ${path} -- state delta left null (state_unverified)`,
        snapErr instanceof Error ? snapErr.message : String(snapErr),
      );
      preStateSnapshot = null;
    }
  }

  const start = Date.now();
  let response: AxiosResponse<unknown> | null = null;
  let errorType: string | null = null;
  let errorMessage: string | null = null;
  try {
    const requestConfig = {
      url: path,
      method: method as HttpMethod,
      params: queryParams,
      headers: effectiveHeaders,
      data: body,
    };
    // When an auth override is active, route through the SCOPED override seam
    // (swap session auth for this single call, restore immediately after) so
    // the no-auth / bad-token state can never leak onto a later normal
    // capture. The normal (`session`) path is byte-for-byte unchanged.
    response = authOverride
      ? await ctx.httpExecutor.requestWithAuthOverride(requestConfig, authOverride)
      : await ctx.httpExecutor.request(requestConfig);
  } catch (err) {
    const axiosErr = err as AxiosError;
    // If the axios error carries a response (e.g. an HTTP 4xx/5xx
    // surfaced as a throw because of a validateStatus override), treat
    // that as a "meaningful non-2xx" outcome rather than a transport
    // failure. By default in this service, axios uses the standard
    // `validateStatus = status < 500` policy, so most non-2xx responses
    // arrive without throwing; this branch handles either possibility
    // without losing the response payload.
    if (axiosErr && axiosErr.response) {
      response = axiosErr.response as AxiosResponse<unknown>;
    } else {
      errorType = axiosErr?.code ?? axiosErr?.name ?? 'UnknownError';
      errorMessage = axiosErr?.message ?? String(err);
    }
  }
  const durationMs = Date.now() - start;

  // DETAIL: every HTTP attempt -- op / method / path / status / durationMs.
  // This is the per-attempt breadcrumb that reconstructs a capture run.
  trace.detail(
    'capture.http',
    {
      op: `${method.toUpperCase()} ${path}`,
      method: method.toUpperCase(),
      path,
      status: response ? response.status : null,
      durationMs,
      attemptNumber,
      authMode,
    },
    corr,
  );

  // DETAIL: a transport / auth failure produced NO HTTP response -- surface
  // the error so the 401-×N pattern (the original bug) is self-diagnosing.
  if (!response && (errorType || errorMessage)) {
    trace.detail(
      'capture.http.fail',
      {
        op: `${method.toUpperCase()} ${path}`,
        method: method.toUpperCase(),
        path,
        status: null,
        errorType,
        errorMessage,
        attemptNumber,
      },
      corr,
    );
  }

  // ---- Build redacted shapes ONCE (reused for both the LLM-facing return
  // value AND the persisted capture row -- DO NOT redact twice).
  const safeRequestHeaders = redactHeaders(effectiveHeaders ?? {});
  const safeRequestBody = body !== undefined ? redactJson(body) : null;
  const safeResponseHeaders = response
    ? redactHeaders(response.headers as unknown as Record<string, string | string[] | undefined>)
    : null;
  const safeResponseBody = response ? redactJson(response.data) : null;

  // ---- Fix 6: distill a SHORT one-line cause from a non-2xx HTML/text error
  // body (e.g. a Tomcat 415/500 page burying the real fault). Computed from
  // the redacted body so no secret leaks into the summary. Surfaced in TWO
  // places: (a) the persisted capture row's `error_message` (so it's
  // available for baseline comparison / operator review) and (b) the tool's
  // LLM-facing return as `response.errorSummary` (Fix 8). `null` when there's
  // nothing useful (2xx, non-string body, empty).
  const errorSummary = response
    ? extractErrorSummary(safeResponseBody, response.status)
    : null;

  // DETAIL: the FULL (secret-redacted) request + response for this attempt, so a
  // failing call can be replayed OUTSIDE the app (curl / Postman). The auth
  // secret value is masked here -- supply the real ssoToken yourself when
  // replaying. This is what makes "test GET 200 but all real calls fail"
  // self-diagnosing (you see the exact URL / body / content-type / fault).
  trace.detail(
    'capture.http.full',
    {
      op: `${method.toUpperCase()} ${path}`,
      request: {
        method: method.toUpperCase(),
        baseUrl: ctx.session.apiBaseUrl ?? null,
        path,
        query: queryParams ?? null,
        headers: safeRequestHeaders,
        body: safeRequestBody,
      },
      response: response
        ? { status: response.status, headers: safeResponseHeaders, body: safeResponseBody, errorSummary }
        : { status: null, errorType, errorMessage },
      attemptNumber,
    },
    corr,
  );

  // The capture FK columns require a non-null `scenario_id`. The
  // orchestrator pre-creates one scenario per included operation before
  // entering the loop, so `currentScenarioId` is always set in production.
  // Guard defensively for the test/regression case so we throw a clear
  // error rather than emit a malformed row.
  if (!ctx.currentScenarioId) {
    throw new ToolValidationError(
      'execute_http_request',
      'missing_scenario_id',
      'execute_http_request called with ctx.currentScenarioId=null; orchestrator must set this before invoking the tool.',
    );
  }

  // ---- Capture-time volatility probe (FU-2 wiring).
  //
  // This is the probe's home: `ctx.httpExecutor` is the live executor against
  // the CURRENT system and the scenario request (method/path/query/headers/
  // body) is right here -- the only moment the current system is authoritative
  // and callable. Run the empirical k-repeat self-diff and carry the envelope
  // onto the capture row so it survives the frontend-driven Save-as-baseline
  // promotion onto the source baseline item's volatile_paths_json (AMS
  // changeset 187/188). Spec: 2026-06-16 Reconcile-Time Determinism &
  // Volatile-Value Handling -- FU-2.
  //
  // Guards:
  //   - only probe a SUCCESSFUL (2xx) response: a non-2xx / error body is not
  //     the captured oracle worth measuring, and re-hitting a failing endpoint
  //     k more times is wasteful + noisy. A non-2xx response leaves the
  //     envelope null = strict (the backward-compat default, G1);
  //   - only probe when the request actually produced a response (a transport
  //     failure has nothing to self-diff);
  //   - the probe enforces the mutating-scenario guard itself: when
  //     `mutatingConfirmed` is true OR the method is POST/PUT/PATCH/DELETE it
  //     makes NO replay calls and returns a `not_probed` envelope;
  //   - any probe error is non-fatal: a probe failure must never fail the
  //     capture (the envelope simply stays null = strict, G1).
  //   - an auth-override attempt (`none` / `bad_token`) is NEVER probed: it is
  //     a deliberate negative whose 401/403 is not a 2xx oracle anyway, and we
  //     must not replay it k more times with the wrong auth.
  let volatilePathsJson: Record<string, unknown> | null = null;
  const responseIs2xx =
    response !== null && response.status >= 200 && response.status < 300;
  if (response && responseIs2xx && !authOverride) {
    try {
      const envelope = await runVolatilityProbe(
        {
          method: method.toUpperCase(),
          path,
          query: queryParams,
          headers: effectiveHeaders,
          body,
        },
        {
          executor: ctx.httpExecutor,
          mutatingConfirmed: ctx.session.mutatingCallsConfirmed === true,
        },
      );
      volatilePathsJson = volatilityEnvelopeToWire(envelope);
    } catch (probeErr) {
      // Non-fatal: leave the envelope null (strict comparison). Log the
      // category only -- never the response body.
      // eslint-disable-next-line no-console
      console.warn(
        `execute_http_request: volatility probe failed for session=${ctx.session.id} ` +
          `op=${persisted.id} -- envelope left null (strict)`,
        probeErr instanceof Error ? probeErr.message : String(probeErr),
      );
    }
  }

  // ---- Spec 2026-07-06-n: POST-call state snapshot + delta. Runs only when
  // the pre-call snapshot succeeded (same tables, same adapter). The keyed
  // ladder rung uses an id-ish value from the (redacted) response body when
  // one is exposed — recorded on the delta's `strategy` so the coverage
  // level is explicit. Failures leave the delta null (state_unverified).
  let stateDeltaJson: Record<string, unknown> | null = null;
  if (preStateSnapshot && ctx.dbAdapter) {
    try {
      const keyHint = response ? keyHintFromResponse(safeResponseBody) : null;
      const postStateSnapshot = await snapshotEffectTables(
        ctx.dbAdapter,
        stateEffectTables,
        keyHint,
      );
      stateDeltaJson = computeStateDelta(
        preStateSnapshot,
        postStateSnapshot,
      ) as unknown as Record<string, unknown>;
    } catch (snapErr) {
      // eslint-disable-next-line no-console
      console.warn(
        `execute_http_request: post-call state snapshot failed for session=${ctx.session.id} ` +
          `op=${method.toUpperCase()} ${path} -- state delta left null (state_unverified)`,
        snapErr instanceof Error ? snapErr.message : String(snapErr),
      );
      stateDeltaJson = null;
    }
  }

  // ---- Persist the capture row. One row per attempt regardless of outcome.
  // `accepted` is intentionally omitted so AMS applies its default (null);
  // `false` is reserved for explicit reviewer rejection.
  //
  // Cast the redacted-headers shape to AMS's expected `Record<string, string>`
  // -- `redactHeaders` returns `Record<string, string | string[]>` to
  // preserve multi-valued headers; AMS stores them as a JSON blob anyway,
  // so the runtime shape is preserved through the JSON round-trip.
  // Issue 1: AMS REQUIRES a non-blank `request_url_redacted` on every
  // createCapture -- a blank/missing value is rejected HTTP 400, which silently
  // fails ALL capture persistence (every scenario "errors", 0 captured). Build
  // it from the session base URL + path; auth secrets live in headers (redacted
  // separately), not in base+path.
  const urlBase = (ctx.session.apiBaseUrl ?? '').replace(/\/+$/, '');
  const requestUrlRedacted = redactUrl(
    (path.startsWith('/') ? `${urlBase}${path}` : `${urlBase}/${path}`) || path || 'unknown',
  );

  // Fix 6 (persist side): for a non-2xx response, prefer the distilled
  // `errorSummary` for the capture row's `error_message` so the buried fault
  // is available for baseline comparison / operator review (it was `null` on
  // the response/non-2xx path before). A transport failure (no response) keeps
  // the caught-error `errorMessage`.
  const persistedErrorMessage = errorMessage ?? errorSummary;

  const captureBody = {
    session_id: ctx.session.id,
    scenario_id: ctx.currentScenarioId,
    operation_id: persisted.id,
    attempt_number: attemptNumber,
    request_method: method.toUpperCase(),
    request_path: path,
    request_url_redacted: requestUrlRedacted,
    request_query_json: queryParams ?? null,
    request_headers_redacted_json:
      safeRequestHeaders as unknown as Record<string, string> | null,
    // Issue 2: wrap non-object bodies so AMS Map<String,Object> can hold them.
    request_body_json: normaliseBodyForAms(safeRequestBody),
    response_status: response ? response.status : null,
    response_headers_redacted_json: response
      ? (safeResponseHeaders as unknown as Record<string, string> | null)
      : null,
    response_body_json: normaliseBodyForAms(safeResponseBody),
    // Spec 2026-07-06-j: the RAW wire body, persisted ONLY when redaction was
    // a no-op on it (rawBodyPolicy) — strict byte verdicts where trustworthy,
    // `raw unavailable` (null) everywhere else, secrets never in raw storage.
    response_body_raw: response
      ? persistableRawBody(rawBodyOf(response), response.data, safeResponseBody)
      : null,
    // Spec 2026-07-06-n: effect-table state delta measured around this
    // mutating call; null = not captured (state_unverified at reconcile).
    state_delta_json: stateDeltaJson,
    duration_ms: durationMs,
    error_type: errorType,
    error_message: persistedErrorMessage,
    captured_at: new Date().toISOString(),
    volatile_paths_json: volatilePathsJson,
  };

  let captureId: string;
  try {
    const persistedCapture = await ctx.archModelClient.createCapture(
      ctx.session.projectId,
      captureBody,
    );
    captureId = persistedCapture.id;
  } catch (err) {
    // Capture persistence failed -- this attempt produced NO durable capture
    // row. Surface a `failed_request` diagnostic so a scenario that later
    // closes `completed` with zero captures is auditable (defense in depth
    // against the misleading-COMPLETED bug), then rethrow so the loop
    // runner's existing tool-error path surfaces this to the LLM. Do NOT
    // bump `scenarioCapturesPersisted` -- nothing was persisted.
    const createCaptureMessage = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error(
      `execute_http_request: createCapture failed for session=${ctx.session.id} attempt=${attemptNumber}`,
      err,
    );
    // DETAIL: createCapture failure -- the HTTP attempt had a response (or
    // not) but the durable capture row was NOT written.
    trace.detail(
      'capture.http.fail',
      {
        op: `${method.toUpperCase()} ${path}`,
        method: method.toUpperCase(),
        path,
        status: response ? response.status : null,
        phase: 'create_capture_failed',
        errorMessage: createCaptureMessage,
        attemptNumber,
      },
      corr,
    );
    await safeRecordFailedRequest(ctx, {
      operationRowId: persisted.id,
      operationId,
      method: method.toUpperCase(),
      path,
      attemptNumber,
      phase: 'create_capture_failed',
      errorType: 'create_capture_failed',
      errorMessage: createCaptureMessage,
    });
    throw err;
  }

  // DETAIL: the capture row was durably persisted to AMS.
  trace.detail(
    'capture.persisted',
    {
      op: `${method.toUpperCase()} ${path}`,
      method: method.toUpperCase(),
      path,
      status: response ? response.status : null,
      captureId,
      attemptNumber,
    },
    corr,
  );

  // A capture row was durably persisted -- credit this scenario with one
  // captured row. The orchestrator reads `scenarioCapturesPersisted` after
  // the per-scenario loop exits and only counts the scenario as captured
  // when this is > 0 (misleading-COMPLETED fix).
  runManager.incrementCapturesPersisted(ctx.session.id);

  // Record this capture's id + HTTP status (null on a transport failure) in
  // attempt order so the orchestrator can, after the per-scenario loop exits,
  // pick the ONE canonical capture matching the scenario's intended outcome
  // and reject-and-hide the LLM's intermediate fumbles (e.g. a malformed-date
  // 400 it later corrected to a 200). Intent-driven canonical capture.
  runManager.recordScenarioCapture(
    ctx.session.id,
    captureId,
    response ? response.status : null,
    {
      method: method.toUpperCase(),
      path,
      query: queryParams ?? null,
      headers: safeRequestHeaders as unknown as Record<string, string> | null,
      body: safeRequestBody,
      responseStatus: response ? response.status : null,
      responseHeaders: safeResponseHeaders as unknown as Record<string, string> | null,
      responseBody: safeResponseBody,
    },
  );

  // ---- Cross-scenario learning. Record concise, secret-redacted lines on the
  // session-level `learnedFacts` so the orchestrator threads them into LATER
  // scenario prompts and the LLM stops re-guessing what already worked / kept
  // failing. Every harvest below is best-effort -- a learning write must NEVER
  // fail a capture. Three flavours, each self-describing via its prefix:
  //
  //   - `OK <METHOD path> -> <status> ...` (fix 5): a request that returned 2xx
  //     is a known-good example -- reuse its value formats / date patterns / ids.
  //   - `OK id: <key>=<value> (from ...)` (Kiro #2): an identifier surfaced by a
  //     SUCCESSFUL response is a REAL id to chain into a later detail call --
  //     prefer it over a fresh DB lookup or a guess that gets "not a valid id".
  //   - `FAILED: <METHOD path> ... -> <status> <summary>` (Kiro #1): an input the
  //     API REJECTED -- avoid it on later scenarios (the LLM was correcting a
  //     date format on one endpoint then re-guessing ISO on the next).
  //
  // An auth-override attempt's outcome is NOT harvested as a learned fact: a
  // deliberate 401/403 from a no-auth/bad-token probe is not a real API
  // rejection to teach later scenarios to avoid.
  if (!authOverride && responseIs2xx) {
    // (1) known-good REQUEST fact (fix 5).
    try {
      const factParts = [`OK ${method.toUpperCase()} ${path} -> ${response?.status}`];
      if (queryParams && Object.keys(queryParams).length > 0) {
        factParts.push(`query=${JSON.stringify(queryParams)}`);
      }
      if (safeRequestBody && typeof safeRequestBody === 'object') {
        factParts.push(`body=${JSON.stringify(safeRequestBody)}`);
      }
      runManager.recordLearnedFact(ctx.session.id, factParts.join(' ').slice(0, 240));
    } catch {
      /* best-effort */
    }

    // (2) up to ~5 candidate identifiers from the SUCCESSFUL response body
    // (Kiro #2). Defensive: `extractIdentifierFacts` never throws; the harvest
    // is additionally wrapped so a learning failure can never fail a capture.
    //
    // Compensation exception (CSD Spec 3): identifiers minted by a MUTATING
    // response reference rows the scenario bracket will UNDO — teaching later
    // scenarios those ids would send them to entities that no longer exist.
    // Ids harvested from reads (S0 data) stay valid and are still recorded.
    const suppressIdHarvest =
      ctx.compensationActive === true && STATE_DELTA_VERBS.has(method.toLowerCase());
    if (!suppressIdHarvest) {
      try {
        const provenance = `${method.toUpperCase()} ${path}`;
        for (const idFact of extractIdentifierFacts(safeResponseBody)) {
          runManager.recordLearnedFact(
            ctx.session.id,
            `OK id: ${idFact} (from ${provenance})`.slice(0, 240),
          );
        }
      } catch {
        /* best-effort */
      }
    }
  } else if (!authOverride && response && errorSummary) {
    // (3) known-bad fact for a non-2xx response with a distilled cause (Kiro
    // #1). Teaches LATER scenarios which input/format the API rejected so the
    // LLM does not re-guess the same malformed value.
    try {
      const failParts = [`FAILED: ${method.toUpperCase()} ${path}`];
      if (queryParams && Object.keys(queryParams).length > 0) {
        failParts.push(`query=${JSON.stringify(queryParams)}`);
      }
      failParts.push(`-> ${response.status} ${errorSummary}`);
      runManager.recordLearnedFact(ctx.session.id, failParts.join(' ').slice(0, 240));
    } catch {
      /* best-effort */
    }
  }

  // ---- Defense in depth: even though the capture row WAS persisted, a
  // transport / auth failure (no HTTP response) means the scenario has no
  // usable oracle. Emit a `failed_request` diagnostic so the per-scenario
  // failure reason is visible in the operator-facing Diagnostics list.
  if (!response && (errorType || errorMessage)) {
    await safeRecordFailedRequest(ctx, {
      operationRowId: persisted.id,
      operationId,
      method: method.toUpperCase(),
      path,
      attemptNumber,
      phase: 'http_no_response',
      errorType,
      errorMessage,
    });
  }

  return {
    captureId,
    operationId,
    method: method.toUpperCase(),
    path,
    request: {
      query: queryParams ?? null,
      headers: safeRequestHeaders,
      body: safeRequestBody,
    },
    response: response
      ? {
          status: response.status,
          headers: safeResponseHeaders ?? {},
          body: safeResponseBody,
          // Fix 8: surface the distilled one-line cause so the LLM reads a
          // legible error instead of digging through escaped HTML. `null`
          // for a 2xx / non-distillable body.
          errorSummary,
        }
      : null,
    error: errorType
      ? { type: errorType, message: errorMessage }
      : null,
    durationMs,
    attemptNumber,
  };
};

export const executeHttpRequestTool: ToolRegistryEntry = {
  name: 'execute_http_request',
  description:
    'Execute one HTTP request against the configured non-prod API. Operation must be marked included; the operation must be safe_to_execute OR the session must have mutating_calls_confirmed=true. Auth is injected from in-memory secrets. Up to LLM_HTTP_ATTEMPTS_PER_SCENARIO attempts per scenario (default 3). Every attempt -- 2xx, non-2xx, transport failure -- is auto-persisted as a capture row to AMS and the persisted captureId is returned in the tool result.',
  parameters: {
    type: 'object',
    properties: {
      operationId: { type: 'string', description: 'OAS operationId (must match a persisted, included operation).' },
      method: { type: 'string', description: 'HTTP verb (lowercase); must match the OAS operation.' },
      path: { type: 'string', description: 'Resolved URL path (no scheme/host).' },
      query: { type: 'object', description: 'Optional query parameters.' },
      headers: {
        type: 'object',
        description:
          'Optional ad-hoc headers (do NOT include auth headers). For Content-Type, pass the media-type value (e.g. application/json), not a constant name like APPLICATION_JSON.',
      },
      body: {
        description:
          'Optional request body. A JSON object for JSON operations. When the ' +
          "operation's request content-type is XML (see get_oas_operation_detail " +
          'requestBody.content), pass the body as ONE raw XML string instead — ' +
          'it is sent verbatim with the XML Content-Type.',
      },
      authMode: {
        type: 'string',
        enum: ['session', 'none', 'bad_token'],
        description:
          "Optional, SCOPED to this single call. 'session' (default) uses the session's auto-injected auth. 'none' sends with NO auth and 'bad_token' sends a garbage bearer token -- both for deliberate auth-negative coverage (expect a 401/403). The override never leaks onto a later call.",
      },
    },
    required: ['operationId', 'method', 'path'],
    additionalProperties: false,
  },
  handler,
};
