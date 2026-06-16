import { AxiosError, AxiosResponse } from 'axios';
import { ToolHandler, ToolRegistryEntry, ToolValidationError } from './toolTypes';
import { redactHeaders, redactJson } from '../redactor';
import { HttpMethod } from '../../types/oas';
import { runManager } from '../runManager';
import { LLM_HTTP_ATTEMPTS_PER_SCENARIO } from '../../config';
import {
  runVolatilityProbe,
  volatilityEnvelopeToWire,
} from '../volatilityProbe';

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
 */

const handler: ToolHandler = async (args, ctx) => {
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

  const start = Date.now();
  let response: AxiosResponse<unknown> | null = null;
  let errorType: string | null = null;
  let errorMessage: string | null = null;
  try {
    response = await ctx.httpExecutor.request({
      url: path,
      method: method as HttpMethod,
      params: queryParams,
      headers,
      data: body,
    });
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

  // ---- Build redacted shapes ONCE (reused for both the LLM-facing return
  // value AND the persisted capture row -- DO NOT redact twice).
  const safeRequestHeaders = redactHeaders(headers ?? {});
  const safeRequestBody = body !== undefined ? redactJson(body) : null;
  const safeResponseHeaders = response
    ? redactHeaders(response.headers as unknown as Record<string, string | string[] | undefined>)
    : null;
  const safeResponseBody = response ? redactJson(response.data) : null;

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
  let volatilePathsJson: Record<string, unknown> | null = null;
  const responseIs2xx =
    response !== null && response.status >= 200 && response.status < 300;
  if (response && responseIs2xx) {
    try {
      const envelope = await runVolatilityProbe(
        {
          method: method.toUpperCase(),
          path,
          query: queryParams,
          headers,
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

  // ---- Persist the capture row. One row per attempt regardless of outcome.
  // `accepted` is intentionally omitted so AMS applies its default (null);
  // `false` is reserved for explicit reviewer rejection.
  //
  // Cast the redacted-headers shape to AMS's expected `Record<string, string>`
  // -- `redactHeaders` returns `Record<string, string | string[]>` to
  // preserve multi-valued headers; AMS stores them as a JSON blob anyway,
  // so the runtime shape is preserved through the JSON round-trip.
  const captureBody = {
    session_id: ctx.session.id,
    scenario_id: ctx.currentScenarioId,
    operation_id: persisted.id,
    attempt_number: attemptNumber,
    request_method: method.toUpperCase(),
    request_path: path,
    request_query_json: queryParams ?? null,
    request_headers_redacted_json:
      safeRequestHeaders as unknown as Record<string, string> | null,
    request_body_json: safeRequestBody,
    response_status: response ? response.status : null,
    response_headers_redacted_json: response
      ? (safeResponseHeaders as unknown as Record<string, string> | null)
      : null,
    response_body_json: safeResponseBody,
    duration_ms: durationMs,
    error_type: errorType,
    error_message: errorMessage,
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
    // Rethrow so the loop runner's existing tool-error path surfaces this
    // to the LLM; do NOT silently swallow.
    // eslint-disable-next-line no-console
    console.error(
      `execute_http_request: createCapture failed for session=${ctx.session.id} attempt=${attemptNumber}`,
      err,
    );
    throw err;
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
      headers: { type: 'object', description: 'Optional ad-hoc headers (do NOT include auth headers).' },
      body: { description: 'Optional JSON body.' },
    },
    required: ['operationId', 'method', 'path'],
    additionalProperties: false,
  },
  handler,
};
