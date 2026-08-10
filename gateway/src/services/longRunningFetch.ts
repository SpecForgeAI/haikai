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
 */
const longRunningAgent = new Agent({
  headersTimeout: 0,
  bodyTimeout: 0,
  keepAliveTimeout: 60_000,
});

/**
 * `fetch` wired for a long-running call: the shared no-timeout agent plus a
 * default overall AbortSignal (caller-supplied signal wins).
 */
export async function longRunningFetch(
  url: string,
  init?: RequestInit
): Promise<Response> {
  return fetch(url, {
    ...init,
    signal: init?.signal ?? AbortSignal.timeout(longFetchTimeoutMs()),
    // undici's non-standard fetch option — typed on RequestInit only in
    // undici's own types, not lib.dom's.
    dispatcher: longRunningAgent,
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
