/**
 * Pack-output post-processing helpers.
 *
 * Runs between Stage 2 (pack/contract candidate emission) and Stage 3 (LLM
 * gap-fill) in `discoveryV3Pipeline.ts`. Two passes:
 *
 *   1. `filterNonExternalInterfaces` — Drops `interfaces`-typed candidates
 *      whose source markers indicate INTERNAL wiring (configuration classes,
 *      XML <bean> definitions, AOP aspects, bare Java service-API interface
 *      keywords, @Bean methods on @Configuration). The architecture
 *      meta-model's "Interface" is reserved for EXTERNAL surfaces only
 *      (REST controllers, Feign clients, WADL REST_API, messaging listeners
 *      exposed externally, etc.). Internal Java `interface`-keyword types
 *      and Spring wiring are NOT interfaces in the meta-model sense.
 *
 *   2. `dedupPackCandidates` — Collapses duplicate candidates across packs
 *      (e.g. springClassic + xsd-schema-pack + rest-wadl-pack all picking up
 *      the same endpoint). Uses entity-type-aware uniqueness keys:
 *        - endpoints: (verb, path, parentInterface)
 *        - everything else: (type, normalizedName)
 *      First occurrence wins so the most-confident pack emission survives.
 *
 * Both are pure functions returning new arrays (inputs untouched).
 */

import type { DiscoveryCandidate } from '../types/candidate';
import { normalizeName } from './prompts/dedup';

// ---------------------------------------------------------------------------
// Internal-interface filter
// ---------------------------------------------------------------------------

/**
 * Spring Classic marker values on `data.springConfigKind` that indicate the
 * candidate represents INTERNAL Spring wiring rather than an external surface.
 * Each value corresponds to a distinct emission site in the springClassic
 * adapter (see `extensionPacks/frameworkAdapters/springClassic/index.ts`).
 */
const INTERNAL_SPRING_CONFIG_KINDS = new Set<string>([
  'configuration',   // @Configuration class
  'xml-context',     // applicationContext.xml metadata
  'xml-bean',        // <bean id="..."> from XML
  'service-api',     // bare Java `interface` keyword (DAO, Repository, service API)
  'aop-aspect',      // @Aspect class
]);

/**
 * Spring Boot marker values on `data.interfaceSubtype` that indicate the
 * candidate represents INTERNAL Spring wiring. `'spring-bean-definition'` is
 * emitted by the springBoot adapter for each @Bean method on @Configuration
 * — internal wiring, not an external contract.
 */
const INTERNAL_INTERFACE_SUBTYPES = new Set<string>([
  'spring-bean-definition',
]);

export interface FilterInterfacesResult<T extends DiscoveryCandidate> {
  /** Candidates that survived the filter. */
  kept: T[];
  /** How many `interfaces` candidates were dropped. */
  droppedCount: number;
  /** Per-marker breakdown for logging. */
  droppedByMarker: Record<string, number>;
}

/**
 * Drop `interfaces`-typed candidates whose `data` markers identify them as
 * internal Spring wiring. Non-`interfaces` candidates pass through unchanged.
 *
 * Default-keep: an `interfaces` candidate with NO matching internal marker is
 * kept. This is intentional — future packs emitting external interfaces (e.g.
 * messaging-pack with `interfaceSubtype: 'jms-queue'`) don't need to opt in
 * to a whitelist; they just avoid the explicit drop-list values above.
 */
export function filterNonExternalInterfaces<T extends DiscoveryCandidate>(
  candidates: readonly T[],
): FilterInterfacesResult<T> {
  const kept: T[] = [];
  const droppedByMarker: Record<string, number> = {};
  let droppedCount = 0;
  for (const cand of candidates) {
    if (cand.candidateType !== 'interfaces') {
      kept.push(cand);
      continue;
    }
    const data = (cand.data || {}) as Record<string, unknown>;
    const springConfigKind = data.springConfigKind;
    if (
      typeof springConfigKind === 'string' &&
      INTERNAL_SPRING_CONFIG_KINDS.has(springConfigKind)
    ) {
      droppedCount += 1;
      droppedByMarker[`springConfigKind:${springConfigKind}`] =
        (droppedByMarker[`springConfigKind:${springConfigKind}`] ?? 0) + 1;
      continue;
    }
    const interfaceSubtype = data.interfaceSubtype;
    if (
      typeof interfaceSubtype === 'string' &&
      INTERNAL_INTERFACE_SUBTYPES.has(interfaceSubtype)
    ) {
      droppedCount += 1;
      droppedByMarker[`interfaceSubtype:${interfaceSubtype}`] =
        (droppedByMarker[`interfaceSubtype:${interfaceSubtype}`] ?? 0) + 1;
      continue;
    }
    kept.push(cand);
  }
  return { kept, droppedCount, droppedByMarker };
}

// ---------------------------------------------------------------------------
// Entity-aware dedup across pack candidates
// ---------------------------------------------------------------------------

export interface DedupPackResult<T extends DiscoveryCandidate> {
  kept: T[];
  droppedCount: number;
  droppedByType: Record<string, number>;
}

/**
 * Build the entity-aware uniqueness key for a pack candidate.
 *
 * - `endpoints`: `(verb, path, parentInterface)` where each component falls
 *   back through the variant shapes used by different packs:
 *     verb         = data.httpMethod | data.operation_verb
 *     path         = data.fullPath  | data.path_or_address
 *     parentIface  = data.controllerClassName | parentCandidateId
 *   If verb/path can't be extracted, falls back to `normalizedName`-only
 *   (which on the springBoot/springClassic/WADL packs is already
 *   `${verb} ${path}` so semantic dedup still works).
 *
 * - All other types: `(candidateType, normalizedName)`. Matches the rule
 *   "Type + name should be unique" — collapses cross-pack duplicates by name
 *   regardless of source file path.
 */
function buildEntityAwareDedupKey(cand: DiscoveryCandidate): string {
  const SEP = '\u0000';
  if (cand.candidateType === 'endpoints') {
    const data = (cand.data || {}) as Record<string, unknown>;
    const verb = String(
      (data.httpMethod as string | undefined) ??
      (data.operation_verb as string | undefined) ??
      '',
    ).trim().toUpperCase();
    const path = String(
      (data.fullPath as string | undefined) ??
      (data.path_or_address as string | undefined) ??
      '',
    ).trim();
    const parentInterface = String(
      (data.controllerClassName as string | undefined) ??
      cand.parentCandidateId ??
      '',
    ).trim();
    if (verb && path) {
      return `endpoints${SEP}${verb}${SEP}${path}${SEP}${parentInterface}`;
    }
    // Fallback: rely on `name` (typically `${verb} ${path}` already).
    return `endpoints${SEP}${normalizeName(cand.name)}${SEP}${parentInterface}`;
  }
  return `${cand.candidateType}${SEP}${normalizeName(cand.name)}`;
}

/**
 * Collapse duplicate pack candidates by entity-aware key. First occurrence
 * wins (deterministic in array order). Used after Stage 2 to clean up the
 * pack output before it reaches the LLM gap-fill stage and Stage 4 persist.
 */
export function dedupPackCandidates<T extends DiscoveryCandidate>(
  candidates: readonly T[],
): DedupPackResult<T> {
  const seen = new Set<string>();
  const kept: T[] = [];
  const droppedByType: Record<string, number> = {};
  let droppedCount = 0;
  for (const cand of candidates) {
    const key = buildEntityAwareDedupKey(cand);
    if (seen.has(key)) {
      droppedCount += 1;
      droppedByType[cand.candidateType] =
        (droppedByType[cand.candidateType] ?? 0) + 1;
      continue;
    }
    seen.add(key);
    kept.push(cand);
  }
  return { kept, droppedCount, droppedByType };
}

// ---------------------------------------------------------------------------
// Visible-for-testing
// ---------------------------------------------------------------------------

/**
 * Test-only export of the dedup key builder. Lets unit tests assert key
 * shape without re-running the full dedup loop.
 */
export const __testing = {
  buildEntityAwareDedupKey,
  INTERNAL_SPRING_CONFIG_KINDS,
  INTERNAL_INTERFACE_SUBTYPES,
};
