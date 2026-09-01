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
 *  - `joinable: false` — NO join of any kind applied (neither routes nor the
 *                        class tier below). This is NOT the same as "no
 *                        endpoints" and must never be reported as a gap.
 *
 * ## The class tier (2026-09-01, last-resort)
 *
 * This header used to claim the `web.xml` servlet case was unrecoverable —
 * "the route lives in a deployment descriptor, not on the class, so NO
 * derivation from SCL symbols can recover it". That became false when the
 * 2026-07-23 commit change started persisting each endpoint's owning class
 * into `protocol_metadata_json.className`: stories already carry their
 * declaring `controllerClass`, so a SECOND identity axis exists.
 *
 * Class identity is deliberately WEAKER than route identity and must never
 * read as a route match: one class can own many endpoints, and a row-budget
 * "part 2 of 3" story implements only some of them — attaching all would be
 * wrong. The tier therefore applies ONLY when (a) the story declared no
 * routes at all (route identity had nothing to say), and (b) the class
 * resolves to EXACTLY ONE committed endpoint — a 1:many class is refused
 * rather than claimed. Results are reported separately (`resolvedByClass`)
 * so consumers can tell the axes apart.
 */

import type { SclHttpRoute } from './sclCorpusPlanner';

/** The subset of a committed endpoint row this join needs. */
export interface JoinableEndpoint {
  id: string;
  name: string;
  verb: string | null;
  path: string | null;
  /**
   * Owning class from the committed endpoint's
   * `protocol_metadata_json.className`, when present (2026-09-01). Optional so
   * existing callers and test fixtures are unaffected; absent simply means the
   * class tier cannot consider this endpoint.
   */
  className?: string | null;
}

export interface SclEndpointJoinResult {
  /** Committed endpoint ids this story implements (deterministic order). */
  endpointIds: string[];
  /** Declared routes that matched no committed endpoint. */
  unresolved: SclHttpRoute[];
  /**
   * False when NO join of any kind applied — the story declared no routes AND
   * the class tier declined. Callers must not treat this as an unresolved gap.
   */
  joinable: boolean;
  /**
   * True when the ids came from the LAST-RESORT class tier (no routes
   * declared; the controller class resolved to exactly one committed
   * endpoint). Class identity is weaker than route identity, so it is
   * reported separately and must never read as a route match.
   */
  resolvedByClass: boolean;
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

/** Trim + case-fold a class name; null when absent/blank. */
function normaliseClassName(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * The class tier's resolver: the story's controller class against the
 * committed endpoints' owning classes. Returns the endpoint ids ONLY on a
 * unique 1:1 hit — a class owning several endpoints is refused (a split
 * story implements only some of them; claiming all would be wrong), and a
 * class matching nothing returns null so the caller stays not-joinable.
 */
function resolveByControllerClass(
  controllerClass: string | null | undefined,
  endpoints: JoinableEndpoint[]
): string[] | null {
  const wanted = normaliseClassName(controllerClass);
  if (wanted == null) return null;
  const hits = endpoints
    .filter((endpoint) => normaliseClassName(endpoint.className) === wanted)
    .map((endpoint) => endpoint.id);
  return hits.length === 1 ? hits : null;
}

/**
 * Resolve a story's declared routes against the committed endpoint surface.
 *
 * Matching, in order of decreasing strictness:
 *   1. verb + path both present and equal
 *   2. path equal, and the route declares no verb (or the endpoint does not)
 *   3. no path on the route: endpoint NAME equals the route's verb-less token
 *   4. LAST-RESORT class tier (no routes at all): the story's controller
 *      class resolves to exactly one committed endpoint (see the header).
 */
export function joinSclStoryToEndpoints(args: {
  routes: SclHttpRoute[] | undefined | null;
  endpoints: JoinableEndpoint[];
  /** The story's declaring controller class, for the last-resort class tier. */
  controllerClass?: string | null;
}): SclEndpointJoinResult {
  const routes = args.routes ?? [];
  if (routes.length === 0) {
    const byClass = resolveByControllerClass(args.controllerClass, args.endpoints);
    if (byClass != null) {
      return { endpointIds: byClass, unresolved: [], joinable: true, resolvedByClass: true };
    }
    return { endpointIds: [], unresolved: [], joinable: false, resolvedByClass: false };
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
    resolvedByClass: false,
  };
}
