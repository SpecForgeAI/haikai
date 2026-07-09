/**
 * Endpoint-scope helpers for SCOPED replay + diff runs (Spec 2026-07-06-i —
 * Parity Verify Loop & Execution Gates; SHARED COMPONENT with Spec F's
 * affected-consumer revalidation — build once here).
 *
 * A scope is a list of normalised `"METHOD /path/template"` keys. Matching is
 * template-tolerant in BOTH directions: a scope key may carry `{param}`
 * segments (committed-model templates) while the item path is concrete, or
 * vice versa (a concrete scope key against a templated baseline path).
 *
 * The scope also rides the diff row as the AUDIT blob
 * `endpoint_scope_json = { keys, purpose }` (AMS changeset 208) so a
 * scoped-clean diff never masquerades as full-surface-clean.
 */

/** Normalise one scope key: upper-case verb, single space, no trailing `/`. */
export function normalizeEndpointKey(method: string, path: string): string {
  const verb = (method ?? '').trim().toUpperCase();
  const cleaned = (path ?? '').trim().split('?')[0].replace(/\/+$/, '') || '/';
  return `${verb} ${cleaned}`;
}

/**
 * Parse a raw scope payload (route body / persisted diff blob) into a clean
 * key list. Accepts an array of `"METHOD /path"` strings; anything else
 * yields null (= UNSCOPED, full surface — the safe default).
 */
export function parseEndpointScopeKeys(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const keys: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string') continue;
    const spaceAt = entry.indexOf(' ');
    if (spaceAt <= 0) continue;
    keys.push(normalizeEndpointKey(entry.slice(0, spaceAt), entry.slice(spaceAt + 1)));
  }
  return keys.length > 0 ? keys : null;
}

/** One path segment matches when either side is a `{param}` template slot. */
function segmentMatches(a: string, b: string): boolean {
  if (a === b) return true;
  const aParam = /^\{.+\}$/.test(a);
  const bParam = /^\{.+\}$/.test(b);
  return aParam || bParam;
}

/** Template-tolerant path equality (both sides may carry `{param}` slots). */
export function pathsMatch(a: string, b: string): boolean {
  const clean = (p: string): string[] =>
    (p.split('?')[0].replace(/\/+$/, '') || '/').split('/').filter((s) => s.length > 0);
  const as = clean(a);
  const bs = clean(b);
  if (as.length !== bs.length) return false;
  for (let i = 0; i < as.length; i++) {
    if (!segmentMatches(as[i], bs[i])) return false;
  }
  return true;
}

/**
 * True when (method, path) falls inside the scope. A null/empty scope means
 * UNSCOPED — everything matches (full surface).
 */
export function scopeMatches(
  scopeKeys: string[] | null | undefined,
  method: string,
  path: string,
): boolean {
  if (!scopeKeys || scopeKeys.length === 0) return true;
  const verb = (method ?? '').trim().toUpperCase();
  for (const key of scopeKeys) {
    const spaceAt = key.indexOf(' ');
    if (spaceAt <= 0) continue;
    if (key.slice(0, spaceAt).toUpperCase() !== verb) continue;
    if (pathsMatch(key.slice(spaceAt + 1), path ?? '')) return true;
  }
  return false;
}

/**
 * Build the diff-row audit blob. Returns null when the run is a plain
 * unscoped parity run (today's semantics — the column stays null).
 */
export function buildEndpointScopeBlob(
  scopeKeys: string[] | null,
  purpose: string | null,
): Record<string, unknown> | null {
  if (!scopeKeys && !purpose) return null;
  return { keys: scopeKeys ?? null, purpose: purpose ?? 'parity' };
}

/** Read the key list back off a persisted diff blob (null = full surface). */
export function scopeKeysFromBlob(blob: unknown): string[] | null {
  if (!blob || typeof blob !== 'object' || Array.isArray(blob)) return null;
  return parseEndpointScopeKeys((blob as Record<string, unknown>).keys);
}
