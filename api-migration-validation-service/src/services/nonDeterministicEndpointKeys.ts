import { archModelClient as defaultArchModelClient } from './archModelClient';
import type {
  BaselineItemDto,
  DiscoveryCandidateDto,
  DiscoveryFindingDto,
} from './archModelClient';

/**
 * Finding -> `${METHOD}|${path}` bridge for the reconcile diff's
 * `endpoint_signal` volatility tolerance.
 *
 * Spec: 2026-06-16 Reconcile-Time Determinism & Volatile-Value Handling --
 * FU-1.
 *
 * ## Why this exists
 *
 * The diff runner exposes an injectable `nonDeterministicEndpointKeys:
 * Set<"${METHOD}|${path}">`. When a source operation's key is in the set the
 * WHOLE response is value-tolerant (presence / shape STILL compared), tagged
 * `endpoint_signal`. The set defaults EMPTY = strict (G1, today's behaviour).
 * Until this bridge ran, the set was never populated, so `endpoint_signal`
 * was inert in production. This module builds the set from the discovery
 * signal so a production reconcile actually fires the tolerance.
 *
 * ## The signal & the resolution path (candidate-link, no AMS change)
 *
 * The `non_deterministic_endpoint` signal (built by spec
 * 2026-05-30-oracle-integrity-determinism, emitted by the discovery-service
 * `nonDeterministicEndpointScanner`) is an `evidence_gap` discovery finding
 * with `detail_json.gapType === 'non_deterministic_endpoint'`. The finding
 * does NOT itself carry the HTTP `METHOD|path` -- it `supports`-LINKS to the
 * endpoint's discovery candidate (a `discovery_candidate` of type
 * `endpoints`), which DOES carry the route in its `data` JSONB
 * (`httpMethod` / `operation_verb` + `fullPath` / `path_or_address`, with the
 * candidate `name` -- typically `"${verb} ${path}"` -- as a final fallback).
 * This mirrors the discovery dedup keying in
 * `discovery-service/.../packPostProcess.ts`.
 *
 * AMS exposes findings + candidates only RUN-SCOPED (no architecture-wide
 * finding search), so the bridge enumerates the architecture's discovery runs,
 * then per run lists `evidence_gap` findings linked to a `discovery_candidate`
 * and resolves each via the run's `endpoints` candidates.
 *
 * ## Template-vs-concrete matching (the load-bearing safety property)
 *
 * The candidate `fullPath` is a route TEMPLATE with path-variable
 * placeholders (e.g. `/users/{userId}`), but the baseline item `path` the
 * diff keys on is the CONCRETE captured request path (e.g. `/users/42`). A
 * naive exact-string compare of the template against concrete paths would
 * silently never match a parameterised endpoint. So instead of guessing,
 * the bridge takes the diff's OWN source baseline items and emits the
 * CONCRETE `${METHOD}|${path}` key for each item whose method + path
 * structurally matches a flagged route template (segment count + literal /
 * single-placeholder-segment match -- the same deterministic matching a web
 * framework router uses, NOT a fuzzy matcher). The produced keys are
 * therefore byte-identical to the diff runner's own `operationKey(item)`
 * (`${method.toUpperCase()}|${item.path}`), so tolerance cannot silently
 * miss.
 *
 * ## Safety invariants (this seam only ever ADDS tolerance)
 *
 * - A finding that cannot be resolved to a concrete `METHOD|path` (no
 *   candidate link, no route, or no matching source item) is DROPPED, logged,
 *   and contributes NO key -- it can never widen tolerance.
 * - Any AMS read error is fail-soft: the bridge logs and returns whatever it
 *   resolved (often an empty set), so a discovery-read outage degrades to the
 *   strict G1 default rather than a wrong tolerance.
 * - The emitted keys are exact concrete operation keys; presence / shape
 *   diffs on a tolerated operation STILL break (that is enforced downstream
 *   in the comparator, unchanged here).
 */

const NON_DETERMINISTIC_GAP_TYPE = 'non_deterministic_endpoint';

export interface NonDeterministicEndpointKeysDeps {
  archModelClient?: Pick<
    typeof defaultArchModelClient,
    'listDiscoveryRuns' | 'listFindingsForRun' | 'listCandidatesForRun'
  >;
}

/**
 * One flagged endpoint route resolved from a `non_deterministic_endpoint`
 * finding: an uppercased HTTP method (or `null` when the candidate carried no
 * verb -- match any method) and a route-template path.
 */
interface FlaggedRoute {
  method: string | null;
  template: string;
}

/** A `non_deterministic_endpoint` evidence-gap finding? */
function isNonDeterministicFinding(f: DiscoveryFindingDto): boolean {
  if (f.finding_type !== 'evidence_gap') return false;
  const detail = f.detail_json;
  return (
    !!detail &&
    typeof detail === 'object' &&
    (detail as Record<string, unknown>).gapType === NON_DETERMINISTIC_GAP_TYPE
  );
}

/** The `supports`-linked `discovery_candidate` target id, or null. */
function supportsCandidateId(f: DiscoveryFindingDto): string | null {
  for (const link of f.links ?? []) {
    if (
      link.link_type === 'supports' &&
      link.target_type === 'discovery_candidate' &&
      typeof link.target_id === 'string' &&
      link.target_id.length > 0
    ) {
      return link.target_id;
    }
  }
  return null;
}

/**
 * Resolve an `endpoints` candidate to a {@link FlaggedRoute}, mirroring the
 * route-slot precedence in `discovery-service/.../packPostProcess.ts`:
 *   verb = data.httpMethod | data.operation_verb
 *   path = data.fullPath   | data.path_or_address
 * Falls back to the candidate `name` (typically `"${verb} ${path}"`) when the
 * `data` slots are absent. Returns null when no path can be extracted -- an
 * unresolvable candidate must NOT widen tolerance.
 */
function routeFromCandidate(c: DiscoveryCandidateDto): FlaggedRoute | null {
  const data = (c.data ?? {}) as Record<string, unknown>;
  const verbRaw =
    (typeof data.httpMethod === 'string' && data.httpMethod) ||
    (typeof data.operation_verb === 'string' && data.operation_verb) ||
    '';
  const pathRaw =
    (typeof data.fullPath === 'string' && data.fullPath) ||
    (typeof data.path_or_address === 'string' && data.path_or_address) ||
    '';
  let method = verbRaw.trim().toUpperCase() || null;
  let template = pathRaw.trim();

  if (!template && typeof c.name === 'string') {
    // Fallback: the name is typically `"${verb} ${path}"`.
    const parts = c.name.trim().split(/\s+/);
    if (parts.length >= 2 && /^[A-Z]+$/i.test(parts[0])) {
      method = method ?? parts[0].toUpperCase();
      template = parts.slice(1).join(' ');
    } else if (parts.length === 1 && parts[0].startsWith('/')) {
      template = parts[0];
    }
  }
  if (!template) return null;
  return { method, template };
}

/**
 * Normalise a path into comparable segments. Leading / trailing slashes are
 * stripped and a missing leading slash is tolerated, so the matcher does not
 * hinge on slash bookkeeping. An empty path -> `[]` (the root).
 */
function pathSegments(p: string): string[] {
  return p.split('/').filter((s) => s.length > 0);
}

/** Is a route-template segment a path-variable placeholder? */
function isPlaceholder(seg: string): boolean {
  // Spring `{id}`, Rails `:id`, oat++ `{id}` etc. all reduce to "this segment
  // matches exactly one concrete segment".
  return (
    (seg.startsWith('{') && seg.endsWith('}')) ||
    seg.startsWith(':') ||
    seg === '*'
  );
}

/**
 * Deterministic structural route match: does the concrete `path` match the
 * route `template`? Same segment count, each template segment either a
 * literal equal to the concrete segment or a single-segment placeholder.
 * This is exact router semantics, NOT a fuzzy heuristic.
 */
function routeMatches(template: string, concretePath: string): boolean {
  const t = pathSegments(template);
  const c = pathSegments(concretePath);
  if (t.length !== c.length) return false;
  for (let i = 0; i < t.length; i += 1) {
    if (isPlaceholder(t[i])) continue;
    if (t[i] !== c[i]) return false;
  }
  return true;
}

/**
 * Build the `${METHOD}|${path}` operation key for a source baseline item,
 * keyed EXACTLY as the diff runner's `operationKey` does
 * (`${(method ?? 'GET').toUpperCase()}|${path ?? '/'}`).
 */
function operationKeyOf(item: BaselineItemDto): string {
  const method = (item.method ?? 'GET').toUpperCase();
  const path = item.path ?? '/';
  return `${method}|${path}`;
}

/**
 * Resolve the architecture's `non_deterministic_endpoint` discovery findings
 * into the set of CONCRETE `${METHOD}|${path}` operation keys present among
 * the given source baseline items. See the module doc for the full contract.
 *
 * @param projectId      project the diff belongs to
 * @param architectureId architecture the diff belongs to
 * @param sourceItems    the diff's source (current-state) baseline items --
 *                       the concrete operations the produced keys must match
 * @returns a set of concrete operation keys; EMPTY when there is no signal or
 *          nothing resolves (strict default, G1)
 */
export async function resolveNonDeterministicEndpointKeys(
  projectId: string,
  architectureId: string,
  sourceItems: BaselineItemDto[],
  deps: NonDeterministicEndpointKeysDeps = {},
): Promise<Set<string>> {
  const archModelClient = deps.archModelClient ?? defaultArchModelClient;
  const keys = new Set<string>();

  if (sourceItems.length === 0) return keys;

  let runs;
  try {
    runs = await archModelClient.listDiscoveryRuns(projectId, architectureId);
  } catch (err) {
    // Fail-soft: a discovery-read outage degrades to strict, never a wrong
    // tolerance.
    console.warn(
      `[nonDeterministicEndpointKeys] op=runs_fetch_failed ` +
        `arch=${architectureId.slice(0, 8)} err=${
          err instanceof Error ? err.message : String(err)
        } -- degrading to strict`,
    );
    return keys;
  }

  const flaggedRoutes: FlaggedRoute[] = [];
  let droppedUnresolved = 0;

  for (const run of runs) {
    let findings: DiscoveryFindingDto[];
    try {
      findings = await archModelClient.listFindingsForRun(
        projectId,
        architectureId,
        run.id,
        { findingType: 'evidence_gap', linkedTargetType: 'discovery_candidate' },
      );
    } catch (err) {
      console.warn(
        `[nonDeterministicEndpointKeys] op=findings_fetch_failed ` +
          `run=${run.id.slice(0, 8)} err=${
            err instanceof Error ? err.message : String(err)
          } -- skipping run`,
      );
      continue;
    }

    const ndFindings = findings.filter(isNonDeterministicFinding);
    if (ndFindings.length === 0) continue;

    // Resolve candidate ids lazily: only load this run's endpoint candidates
    // when at least one finding needs them.
    let candidateById: Map<string, DiscoveryCandidateDto> | null = null;
    const loadCandidates = async (): Promise<Map<string, DiscoveryCandidateDto>> => {
      if (candidateById) return candidateById;
      const map = new Map<string, DiscoveryCandidateDto>();
      try {
        const cands = await archModelClient.listCandidatesForRun(
          projectId,
          architectureId,
          run.id,
          'endpoints',
        );
        for (const c of cands) map.set(c.id, c);
      } catch (err) {
        console.warn(
          `[nonDeterministicEndpointKeys] op=candidates_fetch_failed ` +
            `run=${run.id.slice(0, 8)} err=${
              err instanceof Error ? err.message : String(err)
            } -- findings in this run will be dropped`,
        );
      }
      candidateById = map;
      return map;
    };

    for (const finding of ndFindings) {
      const candidateId = supportsCandidateId(finding);
      if (!candidateId) {
        droppedUnresolved += 1;
        console.warn(
          `[nonDeterministicEndpointKeys] op=drop reason=no_candidate_link ` +
            `finding=${finding.id.slice(0, 8)}`,
        );
        continue;
      }
      const cands = await loadCandidates();
      const candidate = cands.get(candidateId);
      if (!candidate) {
        droppedUnresolved += 1;
        console.warn(
          `[nonDeterministicEndpointKeys] op=drop reason=candidate_not_found ` +
            `finding=${finding.id.slice(0, 8)} candidate=${candidateId.slice(0, 8)}`,
        );
        continue;
      }
      const route = routeFromCandidate(candidate);
      if (!route) {
        droppedUnresolved += 1;
        console.warn(
          `[nonDeterministicEndpointKeys] op=drop reason=no_route_on_candidate ` +
            `finding=${finding.id.slice(0, 8)} candidate=${candidateId.slice(0, 8)}`,
        );
        continue;
      }
      flaggedRoutes.push(route);
    }
  }

  if (flaggedRoutes.length === 0) {
    if (droppedUnresolved > 0) {
      console.log(
        `[nonDeterministicEndpointKeys] op=resolved arch=${architectureId.slice(0, 8)} ` +
          `keys=0 dropped_unresolved=${droppedUnresolved}`,
      );
    }
    return keys;
  }

  // Match each flagged route template against the diff's concrete source
  // operations and emit the CONCRETE operation key (byte-identical to the
  // runner's own `operationKey`). A flagged route that matches no source item
  // contributes no key (dropped, logged below).
  let matchedRoutes = 0;
  for (const route of flaggedRoutes) {
    let matchedThisRoute = 0;
    for (const item of sourceItems) {
      const itemMethod = (item.method ?? 'GET').toUpperCase();
      if (route.method && route.method !== itemMethod) continue;
      const itemPath = item.path ?? '/';
      if (!routeMatches(route.template, itemPath)) continue;
      keys.add(operationKeyOf(item));
      matchedThisRoute += 1;
    }
    if (matchedThisRoute > 0) {
      matchedRoutes += 1;
    } else {
      console.warn(
        `[nonDeterministicEndpointKeys] op=drop reason=no_matching_source_item ` +
          `route=${route.method ?? '*'}|${route.template}`,
      );
    }
  }

  console.log(
    `[nonDeterministicEndpointKeys] op=resolved arch=${architectureId.slice(0, 8)} ` +
      `flagged_routes=${flaggedRoutes.length} matched_routes=${matchedRoutes} ` +
      `keys=${keys.size} dropped_unresolved=${droppedUnresolved}`,
  );

  return keys;
}
