import { MAX_RESPONSE_BODY_BYTES } from '../config';
import axios, {
  AxiosError,
  AxiosInstance,
  AxiosRequestConfig,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from 'axios';
import { redactHeaders, redactJson, redactLogString, redactUrl } from './redactor';
import type { ApiAuthSecret, SecretsBundle } from '../types/secrets';

/**
 * Per-session HTTP executor. Wraps axios with two interceptors:
 *
 *   (1) Request -- inject auth from the in-memory secrets bundle. Header
 *       names go on the wire; logs ALWAYS see only the redacted form.
 *   (2) Response -- truncate bodies above the configured size cap (so a 10MB
 *       JSON dump from a misconfigured "list everything" call doesn't fill
 *       AMS storage), and emit a single redacted log line per call.
 *
 * The factory below returns a fresh axios instance per session id. This
 * isolates auth bundles -- no risk of leaking session A's bearer token onto
 * session B's call -- and lets the loop runner dispose of an instance
 * cleanly when a session terminates.
 *
 * Spec: 2026-05-15 API Behaviour Baseline Capture Service -- Task Group 4.
 */

export interface HttpExecutorOptions {
  /** Base URL applied to every request unless overridden. */
  baseURL?: string;
  /** Per-call timeout in ms. Spec uses LLM_TOOL_CALL_TIMEOUT_MS for tool calls. */
  timeoutMs: number;
  /** Soft cap on response body size. Default 256 KB. */
  maxResponseBytes?: number;
  /** Default headers added to every request (typically the redacted defaults from session config). */
  defaultHeaders?: Record<string, string>;
}

/**
 * Truncation marker placed in `data` when the response body exceeds
 * `maxResponseBytes`. The marker is JSON-shaped so downstream consumers can
 * detect it without sniffing string content.
 */
export interface ResponseTruncationMarker {
  __truncated: true;
  reason: 'response_too_large';
  originalBytes: number;
  capBytes: number;
  /** First chunk of the raw body, redacted. */
  preview: string;
}

// Item #5 (2026-08-27): the cap is CONFIG (default 8MB), no longer a
// hardcoded 256KB — full bodies below the cap are stored so reconciliation
// compares real content, never marker-to-marker.
const DEFAULT_MAX_RESPONSE_BYTES = MAX_RESPONSE_BODY_BYTES;

/**
 * Mutate-in-place auth injection on an axios InternalAxiosRequestConfig --
 * `headers` is a required field on the internal config type, so we copy
 * onto it rather than reassigning to keep axios's type contract happy.
 */
function applyAuthToConfig(
  config: InternalAxiosRequestConfig,
  auth: ApiAuthSecret,
): InternalAxiosRequestConfig {
  const params = new URLSearchParams();
  if (config.params && typeof config.params === 'object') {
    for (const [k, v] of Object.entries(config.params as Record<string, unknown>)) {
      params.set(k, String(v));
    }
  }

  switch (auth.type) {
    case 'none':
      break;
    case 'bearer':
      if (auth.bearerToken) {
        config.headers.set('Authorization', `Bearer ${auth.bearerToken}`);
      }
      break;
    case 'api_key_header':
    case 'custom_header':
      if (auth.headerName && auth.headerValue !== undefined) {
        config.headers.set(auth.headerName, auth.headerValue);
      }
      break;
    case 'api_key_query':
      if (auth.queryParamName && auth.queryParamValue !== undefined) {
        params.set(auth.queryParamName, auth.queryParamValue);
      }
      break;
    case 'basic':
      if (auth.username !== undefined && auth.password !== undefined) {
        const encoded = Buffer.from(`${auth.username}:${auth.password}`).toString('base64');
        config.headers.set('Authorization', `Basic ${encoded}`);
      }
      break;
  }

  if (params.toString().length > 0) {
    config.params = Object.fromEntries(params.entries());
  }
  return config;
}

/**
 * Truncate a response body if it exceeds the configured cap. Returns the
 * truncation marker (replaces `data`) along with a synthetic `data` object
 * that downstream code can JSON-serialise without surprise.
 */
function maybeTruncateResponse(
  response: AxiosResponse,
  capBytes: number,
): AxiosResponse {
  let serialised: string;
  try {
    serialised = typeof response.data === 'string'
      ? response.data
      : JSON.stringify(response.data);
  } catch {
    serialised = String(response.data);
  }
  const byteLen = Buffer.byteLength(serialised, 'utf8');
  if (byteLen <= capBytes) return response;
  const previewRaw = serialised.slice(0, Math.max(0, Math.floor(capBytes / 2)));
  const marker: ResponseTruncationMarker = {
    __truncated: true,
    reason: 'response_too_large',
    originalBytes: byteLen,
    capBytes,
    preview: redactLogString(previewRaw),
  };
  return {
    ...response,
    data: marker,
  };
}

/**
 * Response augmented with the RAW body text exactly as received on the wire
 * (Spec 2026-07-06-j — strict byte verdicts). `rawBody` is attached by the
 * executor's response interceptor BEFORE parsing/truncation; `null` when the
 * body was not a string (streams) or exceeded the size cap. Read it via
 * {@link rawBodyOf} — consumers of `data` are unchanged.
 */
export interface RawAwareResponse<T = unknown> extends AxiosResponse<T> {
  rawBody?: string | null;
}

/** The raw wire body attached by the executor, or null when unavailable. */
export function rawBodyOf(response: AxiosResponse | null | undefined): string | null {
  if (!response) return null;
  const raw = (response as RawAwareResponse).rawBody;
  return typeof raw === 'string' ? raw : null;
}

export interface SessionHttpExecutor {
  request<T = unknown>(config: AxiosRequestConfig): Promise<AxiosResponse<T>>;
  /**
   * Issue ONE request with a SCOPED auth override. The session auth is swapped
   * for `authOverride` for the duration of this single call and restored
   * immediately afterwards (in a `finally`, so even a thrown request restores
   * it) -- the override can NEVER leak onto a subsequent normal capture. This
   * is the seam the session-level auth-negative probes use to deliberately send
   * with no auth (`{ type: 'none' }`) or a bad/garbage bearer token despite the
   * session auto-injecting the valid ssoToken. The executor's
   * `validateStatus: () => true` already lets the resulting 401/403 land as a
   * normal resolved response (a captured row, not a throw).
   *
   * Spec: 2026-06-17 Oracle Coverage Scoring -- scoped auth-override seam.
   */
  requestWithAuthOverride<T = unknown>(
    config: AxiosRequestConfig,
    authOverride: ApiAuthSecret,
  ): Promise<AxiosResponse<T>>;
  /** Replace the auth bundle in-place (re-entry path). */
  setAuth(auth: ApiAuthSecret): void;
  dispose(): void;
}

/**
 * Build a per-session executor. The auth bundle is captured by reference
 * via the closure so that calls to `setAuth` on the returned executor swap
 * what the request interceptor sees on the NEXT call.
 */
export function createSessionHttpExecutor(
  initial: { auth: ApiAuthSecret } & HttpExecutorOptions,
): SessionHttpExecutor {
  const maxResponseBytes = initial.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  let currentAuth: ApiAuthSecret = initial.auth;

  const client: AxiosInstance = axios.create({
    baseURL: initial.baseURL,
    timeout: initial.timeoutMs,
    headers: { ...initial.defaultHeaders },
    // Reject every status code except 2xx ourselves -- callers want the
    // raw 4xx / 5xx response shape captured rather than a thrown error.
    validateStatus: () => true,
    // Spec 2026-07-06-j: identity transform preserves the RAW wire text --
    // the response interceptor below re-parses JSON itself and attaches the
    // raw string as `rawBody`, so every existing `data` consumer is
    // unchanged while strict byte verdicts become possible.
    transformResponse: [(data) => data],
  });

  client.interceptors.request.use((config: InternalAxiosRequestConfig) => {
    const withAuth = applyAuthToConfig(config, currentAuth);
    const method = (withAuth.method ?? 'GET').toString().toUpperCase();
    const url = withAuth.url ?? '';
    const safeUrl = redactUrl(url);
    // The InternalAxiosRequestConfig.headers type is AxiosHeaders; cast to
    // the plain bag the redactor expects -- redactHeaders is defensive
    // about missing fields.
    const safeHeaders = redactHeaders(
      withAuth.headers as unknown as Record<string, string | string[] | undefined>,
    );
    console.log(
      JSON.stringify({
        type: 'http_request',
        method,
        url: safeUrl,
        headerNames: Object.keys(safeHeaders),
        timestamp: new Date().toISOString(),
      }),
    );
    return withAuth;
  });

  client.interceptors.response.use(
    (response) => {
      // Spec 2026-07-06-j: the identity transform above delivered the RAW
      // wire text in `data`. Attach it as `rawBody` (size-capped), then
      // restore the pre-existing `data` contract by parsing JSON bodies
      // ourselves (parse failure leaves the string -- exactly what axios's
      // default transform does).
      if (typeof response.data === 'string') {
        const rawText = response.data as string;
        (response as RawAwareResponse).rawBody =
          Buffer.byteLength(rawText, 'utf8') <= maxResponseBytes ? rawText : null;
        const contentType = String(
          (response.headers as Record<string, unknown> | undefined)?.['content-type'] ?? '',
        );
        const looksJson =
          contentType.includes('json') ||
          /^\s*[{[]/.test(rawText);
        if (looksJson && rawText.trim().length > 0) {
          try {
            response.data = JSON.parse(rawText);
          } catch {
            // keep the string body (axios default behaviour on parse failure)
          }
        }
      } else {
        (response as RawAwareResponse).rawBody = null;
      }
      const truncated = maybeTruncateResponse(response, maxResponseBytes);
      (truncated as RawAwareResponse).rawBody = (response as RawAwareResponse).rawBody;
      const safeBody = redactJson(truncated.data);
      const safeHeaders = redactHeaders(
        truncated.headers as unknown as Record<string, string | string[] | undefined>,
      );
      const previewBytes = JSON.stringify(safeBody).length;
      console.log(
        JSON.stringify({
          type: 'http_response',
          method: response.config?.method?.toUpperCase() ?? '?',
          url: redactUrl(response.config?.url ?? ''),
          status: truncated.status,
          previewBytes,
          headerNames: Object.keys(safeHeaders),
          timestamp: new Date().toISOString(),
        }),
      );
      return truncated;
    },
    (err: AxiosError) => Promise.reject(err),
  );

  const doRequest = <T>(config: AxiosRequestConfig): Promise<AxiosResponse<T>> =>
    client.request<T>(config) as Promise<AxiosResponse<T>>;

  return {
    request: doRequest,
    requestWithAuthOverride: async <T>(
      config: AxiosRequestConfig,
      authOverride: ApiAuthSecret,
    ): Promise<AxiosResponse<T>> => {
      // Scope the override to this single call: capture the session auth,
      // swap in the override, ALWAYS restore in `finally` so neither a normal
      // 401/403 response nor a transport throw can leak the override onto a
      // later normal capture.
      const sessionAuth = currentAuth;
      currentAuth = authOverride;
      try {
        return await doRequest<T>(config);
      } finally {
        currentAuth = sessionAuth;
      }
    },
    setAuth: (auth: ApiAuthSecret) => {
      currentAuth = auth;
    },
    dispose: () => {
      // Axios instances don't hold persistent connections we own, but we
      // null out the auth so any captured closure can't read it. The
      // adapter-level keep-alive sockets are managed by Node's HTTP pools.
      currentAuth = { type: 'none' };
    },
  };
}

/** Exported for use in `SecretsBundle` aware factories (Group 5). */
export function buildAuthFromSecrets(secrets: SecretsBundle): ApiAuthSecret {
  return secrets.api;
}

// ---------------------------------------------------------------------------
// Shared connection probe
//
// A single GET against the base URL, applying the in-memory auth bundle and
// any default headers, returning the observed status + wall-clock duration.
// This is the EXACT probe the session-bound `test-api-connection` and
// `target-capture-sessions/:id/test-connection` actions perform; it is
// factored here so the new STATELESS `POST /api/test-connection` wizard
// pre-flight endpoint reuses the same request-building + redacted-logging
// path rather than duplicating it divergently.
//
// Secrets in `auth` / `defaultHeaders` are in-memory only -- the underlying
// executor's interceptors emit ONLY redacted header names, never values, and
// this helper never logs the auth bundle itself.
//
// Spec: 2026-05-15 API Behaviour Baseline Capture Service -- Task Group 4
// (probe); reused by the 2026-05-25 API Test Harness wizard pre-flight
// stateless test-connection endpoint.
// ---------------------------------------------------------------------------

export interface ProbeApiConnectionArgs {
  baseUrl: string;
  auth: ApiAuthSecret;
  defaultHeaders?: Record<string, string>;
  /** Per-call timeout in ms. Defaults to 10s (matches the session-bound probes). */
  timeoutMs?: number;
}

export interface ProbeApiConnectionResult {
  status: number;
  durationMs: number;
}

/**
 * Issue a single GET on `baseUrl` with the supplied auth + default headers,
 * returning the observed HTTP status and elapsed wall-clock time. Any
 * status (2xx-5xx) resolves -- the executor's `validateStatus: () => true`
 * means a 401/403/404/500 is a reachable-target signal, not a throw. Only a
 * transport failure (DNS / connection refused / timeout) rejects, and the
 * caller decides how to surface that.
 *
 * The executor is disposed in a `finally` so the captured auth closure is
 * nulled out immediately after the probe completes.
 */
export async function probeApiConnection(
  args: ProbeApiConnectionArgs,
): Promise<ProbeApiConnectionResult> {
  const exec = createSessionHttpExecutor({
    auth: args.auth,
    baseURL: args.baseUrl,
    timeoutMs: args.timeoutMs ?? 10_000,
    defaultHeaders: args.defaultHeaders ?? {},
  });
  const t0 = Date.now();
  try {
    // A simple GET on the base URL is the minimal redacted-logged probe
    // call. We tolerate any 2xx-5xx status -- the goal is to confirm
    // reachability + auth wiring, not a specific success code.
    const resp = await exec.request({ method: 'GET', url: '/' });
    return { status: resp.status, durationMs: Date.now() - t0 };
  } finally {
    exec.dispose();
  }
}
