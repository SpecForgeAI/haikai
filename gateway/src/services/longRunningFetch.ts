/**
 * Long-running DB-plane fetch (2026-08-10, work-machine port).
 *
 * The DB-plane calls into AMVS — bulk data load, schema-apply (structural +
 * post-load), parity reconcile — legitimately run for HOURS on real data.
 * The previous bare `fetch` calls died at undici's DEFAULTS: the live data
 * load failed with a bare `fetch failed` at 5m25s (headersTimeout 300s).
 *
 * BOTH knobs are required:
 *   - an explicit AbortSignal caps the overall wait at
 *     {@link longFetchTimeoutMs} (default 6h, `DB_PLANE_FETCH_TIMEOUT_MS`
 *     override, read at CALL time);
 *   - a dispatcher Agent with headersTimeout/bodyTimeout DISABLED — the
 *     signal alone still dies at undici's 300s headers default.
 */
import { Agent } from 'undici';

/** Default overall cap for one long-running DB-plane call: 6 hours. */
export const LONG_FETCH_TIMEOUT_MS = 21_600_000;

/** The effective cap — `DB_PLANE_FETCH_TIMEOUT_MS` override, read at call
 * time so a deployment can retune without a code change; defensive fallback
 * on a non-numeric/non-positive value. */
export function longFetchTimeoutMs(): number {
  const raw = process.env.DB_PLANE_FETCH_TIMEOUT_MS;
  if (raw !== undefined) {
    const n = parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return LONG_FETCH_TIMEOUT_MS;
}

/**
 * One shared agent for the DB-plane calls: per-request timeouts disabled
 * (the AbortSignal owns the cap), keep-alive at 60s so idle sockets are
 * still recycled between the long calls.
 *
 * FAIL LOUD, NEVER DEGRADE (2026-08-10, work-machine hardening): an earlier
 * local variant require()'d undici inside a catch and silently fell back to
 * signal-only when the module was missing (Node bundles undici internally
 * but does not expose it to require) — which still dies at undici's 300s
 * socket default, reproducing the exact 5m33s failure the module exists to
 * prevent. A dispatcher we cannot build is BROKEN, not degraded: the static
 * import above fails the gateway at boot if the package is missing, and
 * {@link longRunningDispatcher} throws an actionable error on construction
 * failure — resolved BEFORE the request is built, so the failure surfaces
 * at the call site, never mid-run as a mystery timeout.
 */
let cachedAgent: Agent | null = null;

export function longRunningDispatcher(
  build: () => Agent = () =>
    new Agent({ headersTimeout: 0, bodyTimeout: 0, keepAliveTimeout: 60_000 })
): Agent {
  if (cachedAgent) return cachedAgent;
  try {
    cachedAgent = build();
  } catch (err) {
    throw new Error(
      'longRunningDispatcher: the undici Agent could not be constructed — ' +
        'without it this DB-plane call would run on undici\'s 300s socket ' +
        'defaults and die mid-run. Reinstall gateway dependencies ' +
        "(npm install; undici is a direct, exact-pinned dependency). Cause: " +
        (err instanceof Error ? err.message : String(err))
    );
  }
  return cachedAgent;
}

/**
 * `fetch` wired for a long-running call: the shared no-timeout agent plus a
 * default overall AbortSignal (caller-supplied signal wins).
 */
export async function longRunningFetch(
  url: string,
  init?: RequestInit
): Promise<Response> {
  // Resolve the dispatcher BEFORE building the request — a broken dispatcher
  // must fail here, at the call site, with the actionable message.
  const dispatcher = longRunningDispatcher();
  return fetch(url, {
    ...init,
    signal: init?.signal ?? AbortSignal.timeout(longFetchTimeoutMs()),
    // undici's non-standard fetch option — typed on RequestInit only in
    // undici's own types, not lib.dom's.
    dispatcher,
  } as RequestInit);
}

/** POST a JSON body with the long-running wiring; JSON Accept header set. */
export async function longRunningPostJson(
  url: string,
  body: unknown
): Promise<Response> {
  return longRunningFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
}
