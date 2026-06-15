import { Router, Request, Response } from 'express';
import {
  probeApiConnection as defaultProbeApiConnection,
  type ProbeApiConnectionResult,
} from '../services/httpExecutor';
import type { ApiAuthSecret } from '../types/secrets';

/**
 * Stateless "test API connection" endpoint.
 *
 * Spec: 2026-05-25 API Test Harness -- wizard pre-flight connection test.
 *
 * Unlike the session-bound `POST /capture-sessions/:id/test-api-connection`
 * (which needs an already-created AMS session row + an in-memory secrets
 * bundle keyed by session id), this endpoint probes a target DIRECTLY from
 * the request body. It exists so the wizard can offer a "Test connection"
 * button BEFORE a session has been created and secrets staged.
 *
 *   - No session lookup.
 *   - No `secretsStore` write -- the secret material in the body is held in
 *     memory only for the duration of the single probe call, NEVER persisted
 *     to AMS / disk and NEVER logged (the shared executor's interceptors emit
 *     redacted header NAMES only; this route never logs the body).
 *   - Reuses the EXACT same request-building + probe path as the session-bound
 *     test (the shared `probeApiConnection` helper in `httpExecutor.ts`).
 *
 * Mounted under the same `/api-migration-validation/api` prefix as the other
 * action routers, so the wire path is:
 *   POST /api-migration-validation/api/test-connection
 *
 * Request body:
 *   {
 *     baseUrl: string,
 *     auth: {
 *       type: 'none' | 'bearer' | 'basic' | 'header',
 *       token?: string,            // bearer
 *       headerName?: string,       // header
 *       headerValue?: string,      // header
 *       username?: string,         // basic
 *       password?: string          // basic
 *     },
 *     defaultHeaders?: { name: string, value: string }[]
 *   }
 *
 * The wizard's `'header'` auth type maps onto the internal `custom_header`
 * `ApiAuthSecret` variant (a single arbitrary `headerName: headerValue`).
 *
 * Response body:
 *   { success: boolean, status: number, durationMs: number, error?: string }
 *
 * `success` mirrors the session-bound test: a reachable target (any 2xx-4xx
 * status) is a success; a 5xx or a transport failure is not. A transport
 * failure (DNS / connection refused / timeout) returns `success=false`,
 * `status=0`, and a redacted-safe `error` string.
 */

export interface TestConnectionActionDeps {
  /**
   * Probe override. Tests inject a fake to avoid a real network call;
   * production uses the shared `probeApiConnection` helper that the
   * session-bound tests also use.
   */
  probeApiConnection?: (args: {
    baseUrl: string;
    auth: ApiAuthSecret;
    defaultHeaders: Record<string, string>;
  }) => Promise<ProbeApiConnectionResult>;
}

/** Wizard-facing auth shape (camelCase, with the `'header'` convenience type). */
interface TestConnectionAuthBody {
  type?: 'none' | 'bearer' | 'basic' | 'header';
  token?: string;
  headerName?: string;
  headerValue?: string;
  username?: string;
  password?: string;
}

interface TestConnectionBody {
  baseUrl?: string;
  auth?: TestConnectionAuthBody;
  defaultHeaders?: Array<{ name?: string; value?: string }>;
}

function fail(res: Response, status: number, message: string): void {
  res.status(status).json({ error: { code: status, message } });
}

/**
 * Normalize the wizard's auth body into the internal {@link ApiAuthSecret}.
 * The wizard uses `'header'` + `{ token }`; the internal model uses
 * `custom_header` + `{ headerName, headerValue }` and `bearer` +
 * `{ bearerToken }`. Unknown / missing types fall back to `none` so a
 * malformed body still produces a clean unauthenticated probe rather than a
 * 400 (the goal is reachability feedback, not strict schema policing).
 */
function normalizeAuth(auth: TestConnectionAuthBody | undefined): ApiAuthSecret {
  if (!auth || typeof auth !== 'object') return { type: 'none' };
  switch (auth.type) {
    case 'bearer':
      return { type: 'bearer', bearerToken: auth.token };
    case 'basic':
      return { type: 'basic', username: auth.username, password: auth.password };
    case 'header':
      // Wizard's custom-header variant -> internal `custom_header`.
      return {
        type: 'custom_header',
        headerName: auth.headerName,
        headerValue: auth.headerValue,
      };
    case 'none':
    default:
      return { type: 'none' };
  }
}

/**
 * Collapse the wizard's `{ name, value }[]` default-header list into the
 * `Record<string, string>` the executor expects. Entries with a non-empty
 * string name are kept; later duplicates win.
 */
function normalizeDefaultHeaders(
  headers: Array<{ name?: string; value?: string }> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!Array.isArray(headers)) return out;
  for (const h of headers) {
    if (h && typeof h.name === 'string' && h.name.length > 0) {
      out[h.name] = typeof h.value === 'string' ? h.value : '';
    }
  }
  return out;
}

export function buildTestConnectionActionRouter(
  deps: TestConnectionActionDeps = {},
): Router {
  const router = Router({ mergeParams: true });
  const probe = deps.probeApiConnection ?? defaultProbeApiConnection;

  // --------------------------------------------------------------------
  // POST /api/test-connection
  // --------------------------------------------------------------------
  router.post('/api/test-connection', async (req: Request, res: Response) => {
    const body = (req.body || {}) as TestConnectionBody;
    if (typeof body.baseUrl !== 'string' || body.baseUrl.length === 0) {
      return fail(res, 400, 'baseUrl is required');
    }

    const auth = normalizeAuth(body.auth);
    const defaultHeaders = normalizeDefaultHeaders(body.defaultHeaders);

    try {
      const result = await probe({ baseUrl: body.baseUrl, auth, defaultHeaders });
      return res.status(200).json({
        // A reachable target (any non-5xx status) is a success -- mirrors the
        // session-bound test's `>= 200 && < 500` posture.
        success: result.status >= 200 && result.status < 500,
        status: result.status,
        durationMs: result.durationMs,
      });
    } catch (err) {
      // Transport-level failure (DNS / connection refused / timeout). We
      // return 200 with a structured `success=false` envelope so the wizard
      // can render a clean "could not connect" message rather than treating
      // it as an HTTP error of its own request. The error message is the
      // axios message (host/code), which carries no secret material.
      const message = err instanceof Error ? err.message : 'connection failed';
      return res.status(200).json({
        success: false,
        status: 0,
        durationMs: 0,
        error: message,
      });
    }
  });

  return router;
}

/**
 * Default-deps router used by the production entry point. Tests build their
 * own with `buildTestConnectionActionRouter({ ...overrides })`.
 */
export const testConnectionActionRouter = buildTestConnectionActionRouter();
