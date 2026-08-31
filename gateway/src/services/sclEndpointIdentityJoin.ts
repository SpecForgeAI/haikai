/**
 * Join SCL corpus stories to committed endpoint element ids (2026-08-30).
 *
 * ## The problem this solves
 *
 * A generated migration book carries TWO independent traceability currencies
 * that were never reconciled:
 *
 *  - The stories that do the implementation work are scoped by SCL contract
 *    key (`scl_contract_keys`) — on a live book, dozens of stories carrying
 *    hundreds of distinct contract keys across the controller classes: a
 *    clean partition.
 *  - Behaviour baselines, capture coverage and parity verification are scoped
 *    by committed endpoint element id (`apiEndpointIds`).
 *
 * `buildCorpusEndpointGroupItems` set `apiEndpointIds: []` on every corpus
 * story, on the stated grounds that element ids are "not trivially derivable
 * from SCL symbols". The consequences were real and silent:
 *
 *  1. `migrationCodeExecutionGate` only considers stories WITH endpoint ids
 *     (`markers.apiEndpointIds.length > 0`), so every implementation story
 *     was invisible to the endpoint coverage gate.
 *  2. "Which story implements endpoint X?" had no mechanical answer, so
 *     parity verification could not be scoped per story and had to be
 *     deferred to one unscoped full-surface sweep at the end of the stream.
 *
 * ## What this module does
 *
 * Resolves endpoint ids by normalised route identity (verb + path), falling
 * back to endpoint NAME when a route has no path. It is deliberately
 * conservative: a route that does not resolve is REPORTED, never guessed at.
 * The output distinguishes three states so the caller can be honest about
 * each:
 *
 *  - `endpointIds`     — routes that resolved to committed endpoints
 *  - `unresolved`      — routes that resolved to nothing (a real gap: the
 *                        story declares a route the committed model does not
 *                        contain)
 *  - `joinable: false` — the story declared no routes at all, so
 *                        route-joining is not applicable. This is the
 *                        `web.xml` servlet case: the route lives in a
 *                        deployment descriptor, not on the class, so NO
 *                        derivation from SCL symbols can recover it. This is
 *                        NOT the same as "no endpoints" and must never be
 *                        reported as a gap.
 */

import type { SclHttpRoute } from './sclCorpusPlanner';

/** The subset of a committed endpoint row this join needs. */
export interface JoinableEndpoint {
  id: string;
  name: string;
  verb: string | null;
  path: string | null;
}

export interface SclEndpointJoinResult {
  /** Committed endpoint ids this story implements (deterministic order). */
  endpointIds: string[];
  /** Declared routes that matched no committed endpoint. */
  unresolved: SclHttpRoute[];
  /**
   * False when the story declared NO routes, so route identity cannot apply.
   * Callers must not treat this as an unresolved gap.
   */
  joinable: boolean;
}

/**
 * Canonical path form: leading slash, no trailing slash, collapsed separators,
 * path variables reduced to a positional wildcard so `/users/{id}` and
 * `/users/:userId` and `/users/*` all agree.
 */
export function normalisePath(path: string | null | undefined): string | null {
  if (path == null) return null;
  let value = path.trim();
  if (value.length === 0) return null;
  // Strip a scheme+host if a full URL was recorded.
  value = value.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/]+/, '');
  // Drop query string and fragment.
  value = value.replace(/[?#].*$/, '');
  // Path variables -> a single stable token.
  value = value.replace(/\{[^}]*\}/g, '{}');
  value = value.replace(/:[A-Za-z_][A-Za-z0-9_]*/g, '{}');
  value = value.replace(/\*+/g, '{}');
  // Collapse duplicate slashes, normalise ends.
  value = value.replace(/\/{2,}/g, '/');
  if (!value.startsWith('/')) value = `/${value}`;
  if (value.length > 1) value = value.replace(/\/+$/, '');
  return value.toLowerCase();
}

function normaliseVerb(verb: string | null | undefined): string | null {
  if (verb == null) return null;
  const value = verb.trim().toUpperCase();
  return value.length > 0 ? value : null;
}

function normaliseName(name: string | null | undefined): string | null {
  if (name == null) return null;
  const value = name.trim().toLowerCase();
  return value.length > 0 ? value : null;
}

/**
 * Resolve a story's declared routes against the committed endpoint surface.
 *
 * Matching, in order of decreasing strictness:
 *   1. verb + path both present and equal
 *   2. path equal, and the route declares no verb (or the endpoint does not)
 *   3. no path on the route: endpoint NAME equals the route's verb-less token
 */
export function joinSclStoryToEndpoints(args: {
  routes: SclHttpRoute[] | undefined | null;
  endpoints: JoinableEndpoint[];
}): SclEndpointJoinResult {
  const routes = args.routes ?? [];
  if (routes.length === 0) {
    return { endpointIds: [], unresolved: [], joinable: false };
  }

  const byVerbPath = new Map<string, string[]>();
  const byPath = new Map<string, string[]>();
  const byName = new Map<string, string[]>();
  const push = (map: Map<string, string[]>, key: string | null, id: string) => {
    if (key == null) return;
    const list = map.get(key);
    if (list) list.push(id);
    else map.set(key, [id]);
  };

  for (const endpoint of args.endpoints) {
    const verb = normaliseVerb(endpoint.verb);
    const path = normalisePath(endpoint.path);
    if (path != null) {
      push(byPath, path, endpoint.id);
      if (verb != null) push(byVerbPath, `${verb} ${path}`, endpoint.id);
    }
    push(byName, normaliseName(endpoint.name), endpoint.id);
  }

  const matched = new Set<string>();
  const unresolved: SclHttpRoute[] = [];

  for (const route of routes) {
    const verb = normaliseVerb(route.verb);
    const path = normalisePath(route.path);

    let hits: string[] | undefined;
    if (verb != null && path != null) hits = byVerbPath.get(`${verb} ${path}`);
    if (!hits && path != null) hits = byPath.get(path);
    if (!hits && path == null && verb != null) hits = byName.get(normaliseName(verb)!);

    if (hits && hits.length > 0) {
      for (const id of hits) matched.add(id);
    } else {
      unresolved.push(route);
    }
  }

  return {
    endpointIds: [...matched].sort(),
    unresolved,
    joinable: true,
  };
}
