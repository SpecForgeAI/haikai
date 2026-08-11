/**
 * Long-running sidecar fetch (2026-08-11 — the AMVS sibling of the gateway's
 * longRunningFetch, per the helper-exists-sibling-missed rule).
 *
 * The AMVS→sidecar calls (keyset page reads, counts, metadata) ran as bare
 * `fetch` — capped at undici's 300s headersTimeout. Keyset page queries get
 * progressively SLOWER as the tuple predicate walks deeper into a big ASE
 * table (datetime-suffixed PKs index worst), and the first page past ~5
 * minutes killed the load at a clean multiple of pageRows — the live
 * truncated-load shape (5,000 / 11,500 / 1,500 / 500 rows).
 *
 * BOTH knobs are required: the AbortSignal caps the overall wait, and the
 * dispatcher Agent disables the per-request socket timeouts (the signal
 * alone still dies at undici's 300s default). Fail loud, never degrade: a
 * dispatcher that cannot construct throws at the call site.
 */
import { Agent } from 'undici';

/** Default overall cap for one sidecar call: 6 hours. */
export const LONG_FETCH_TIMEOUT_MS = 21_600_000;

/** `SIDECAR_FETCH_TIMEOUT_MS` override, read at CALL time; defensive
 * fallback on a non-numeric/non-positive value. */
export function longFetchTimeoutMs(): number {
  const raw = process.env.SIDECAR_FETCH_TIMEOUT_MS;
  if (raw !== undefined) {
    const n = parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return LONG_FETCH_TIMEOUT_MS;
}

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
        "without it this sidecar call would run on undici's 300s socket " +
        'defaults and die mid-page. Reinstall dependencies (npm install; ' +
        'undici is a direct, exact-pinned dependency). Cause: ' +
        (err instanceof Error ? err.message : String(err))
    );
  }
  return cachedAgent;
}

/** `fetch` wired for a long-running sidecar call. */
export async function longRunningFetch(
  url: string,
  init?: RequestInit
): Promise<Response> {
  const dispatcher = longRunningDispatcher();
  return fetch(url, {
    ...init,
    signal: init?.signal ?? AbortSignal.timeout(longFetchTimeoutMs()),
    // undici's non-standard fetch option (typed only in undici's own types).
    dispatcher,
  } as RequestInit);
}
