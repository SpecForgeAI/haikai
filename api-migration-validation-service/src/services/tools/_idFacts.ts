/**
 * Identifier harvesting helpers shared by `execute_http_request` (the
 * cross-scenario id-reuse learned-fact harvest) and the Spec D sequence
 * ref-derived volatility derivation (`extractIdentifierPaths`).
 *
 * The id-ish key regex `/(^id$|Id$|_id$|^key$|Key$)/i` is the SINGLE source of
 * truth for "what looks like a generated identifier" so the learned-fact
 * harvest and the sequence volatile-path derivation can never drift.
 *
 * Spec: 2026-05-16 API Behaviour Capture Fixes (Kiro #2 id reuse).
 * Spec: 2026-06-18 Stateful Sequence Scenarios (Spec D) -- Task Group 2
 *   reuses the SAME id-ish shape to derive expected-volatile generated-id
 *   paths from a mutating act/setup response (R3, ref-derived volatility).
 */

/** The id-ish key shape. SINGLE source of truth (see module docs). */
export const ID_KEY = /(^id$|Id$|_id$|^key$|Key$)/i;

/**
 * Kiro #2 (cross-scenario id reuse): harvest up to ~5 candidate identifiers
 * from a SUCCESSFUL (2xx), already-redacted response body so the orchestrator
 * can thread REAL ids the API has actually emitted into LATER scenarios.
 *
 * Walks the object/array (bounded depth + count) for keys matching the id-ish
 * shape whose value is a string or number. Each match becomes `<key>=<value>`.
 * The caller wraps these into an `OK id: ...` learned fact.
 *
 * Defensive contract (mirrors `extractErrorSummary`): NEVER throws, returns an
 * empty array when the body is not an object/array or holds no id-ish keys.
 */
export function extractIdentifierFacts(body: unknown): string[] {
  const out: string[] = [];
  try {
    if (body === null || typeof body !== 'object') return out;
    const MAX_FACTS = 5;
    const MAX_DEPTH = 6;
    const MAX_NODES = 400;
    let nodesVisited = 0;
    const seen = new Set<string>();

    const walk = (value: unknown, depth: number): void => {
      if (out.length >= MAX_FACTS) return;
      if (depth > MAX_DEPTH) return;
      if (value === null || typeof value !== 'object') return;
      if (nodesVisited >= MAX_NODES) return;
      nodesVisited += 1;

      if (Array.isArray(value)) {
        for (const item of value) {
          if (out.length >= MAX_FACTS) return;
          walk(item, depth + 1);
        }
        return;
      }

      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (out.length >= MAX_FACTS) return;
        if (ID_KEY.test(k) && (typeof v === 'string' || typeof v === 'number')) {
          const fact = `${k}=${String(v)}`;
          if (!seen.has(fact)) {
            seen.add(fact);
            out.push(fact);
          }
        } else if (v !== null && typeof v === 'object') {
          walk(v, depth + 1);
        }
      }
    };

    walk(body, 0);
  } catch {
    // Defensive: a malformed body must never break the learned-fact harvest.
    return out;
  }
  return out;
}

/**
 * Spec D (R3) sibling of {@link extractIdentifierFacts}: harvest the
 * JSON-Pointer PATHS (not `key=value` strings) of id-ish fields in an
 * already-redacted response body. A generated id in a mutating response is
 * expected-volatile by construction, so its PATH is recorded into the source
 * item's `volatile_paths_json` envelope (the form the diff engine consumes).
 *
 * Mirrors {@link extractIdentifierFacts}'s bounded walk + the SAME `ID_KEY`
 * regex, but emits a normalised RFC-6901 pointer per id-ish leaf (e.g.
 * `/id`, `/data/0/id`). Paths are de-duplicated and returned in first-seen
 * order. Bounded to MAX_NODES so a pathological body cannot stall pin-time.
 *
 * Defensive contract: NEVER throws; returns an empty array for a non-object /
 * primitive body or one with no id-ish keys.
 */
export function extractIdentifierPaths(body: unknown): string[] {
  const out: string[] = [];
  try {
    if (body === null || typeof body !== 'object') return out;
    const MAX_PATHS = 16;
    const MAX_DEPTH = 6;
    const MAX_NODES = 400;
    let nodesVisited = 0;
    const seen = new Set<string>();

    const encode = (token: string): string =>
      token.replace(/~/g, '~0').replace(/\//g, '~1');

    const walk = (value: unknown, pointer: string, depth: number): void => {
      if (out.length >= MAX_PATHS) return;
      if (depth > MAX_DEPTH) return;
      if (value === null || typeof value !== 'object') return;
      if (nodesVisited >= MAX_NODES) return;
      nodesVisited += 1;

      if (Array.isArray(value)) {
        value.forEach((item, i) => {
          if (out.length >= MAX_PATHS) return;
          walk(item, `${pointer}/${i}`, depth + 1);
        });
        return;
      }

      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (out.length >= MAX_PATHS) return;
        const childPointer = `${pointer}/${encode(k)}`;
        if (ID_KEY.test(k) && (typeof v === 'string' || typeof v === 'number')) {
          if (!seen.has(childPointer)) {
            seen.add(childPointer);
            out.push(childPointer);
          }
        } else if (v !== null && typeof v === 'object') {
          walk(v, childPointer, depth + 1);
        }
      }
    };

    walk(body, '', 0);
  } catch {
    return out;
  }
  return out;
}
