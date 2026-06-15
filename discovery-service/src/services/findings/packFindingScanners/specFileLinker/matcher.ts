/**
 * Match priority engine for the `specFileLinker` scanner sub-module.
 *
 * Spec: agent-os/specs/2026-05-17-spec-file-auto-linking-phase-3/spec.md
 *
 * Pure, side-effect-free matching of a parsed OAS spec against the
 * upstream interface-candidate set using the P-2 priority ladder.
 *
 * Public API:
 *   matchSpecToInterface(spec, candidates)
 *     -> { matched, competingMatches, heuristic }
 *
 * Match priority order (P-2), verbatim from the spec. First match wins;
 * once a priority level yields a unique match, lower-priority levels
 * are NOT consulted:
 *  1. `info.title` exact match against `candidate.name` (case-sensitive).
 *  2. `paths` common base prefix match against `candidate.data.basePath`
 *     (Spring Boot adapter captures this from `@RequestMapping`).
 *  3. springdoc tag match: any of `tags[].name` against
 *     `candidate.data.openApiTag`.
 *
 * Ambiguity and orphan handling:
 *  - Exactly one candidate matches at the first non-empty priority level
 *    -> `{ matched: <candidate>, competingMatches: [], heuristic }`.
 *  - More than one candidate matches at the SAME priority level
 *    -> `{ matched: null, competingMatches: [...], heuristic }`. Caller
 *    emits `oas_spec_ambiguous_match` and leaves `spec_link` null on ALL
 *    involved candidates -- the matcher never guesses past ambiguity.
 *  - No candidate matches at any of the three levels
 *    -> `{ matched: null, competingMatches: [], heuristic: null }`.
 *    Caller emits `oas_spec_orphan`.
 *
 * Input contract:
 *  - `spec.parsed`: the parsed OAS object (from `signatureDetector`).
 *  - `spec.filePath`: repo-relative path of the spec file (for log lines
 *    and finding records only -- not used in match logic itself).
 *  - `candidates`: the interface-candidate set. Caller is responsible
 *    for filtering to `candidateType === 'interfaces'` and to the
 *    service-root scope (the matcher trusts the input set).
 *
 * Output contract:
 *  - `matched`: the unique winning candidate, or `null`.
 *  - `competingMatches`: candidates that competed at the matched level
 *    (length >= 2 for ambiguous; length 0 for unique-match or orphan).
 *  - `heuristic`: which priority level produced the result, or `null`
 *    for orphan.
 *
 * Side effects: NONE. No I/O. No mutation of inputs.
 *
 * Design-point references: P-2 (priority ladder, first match wins).
 */

import type { DiscoveryCandidate } from '../../../../types/candidate';

// ----------------------------------------------------------------------------
// Public types
// ----------------------------------------------------------------------------

export type MatchHeuristic = 'title' | 'base_path' | 'tag';

export interface SpecMatchInput {
  parsed: Record<string, unknown>;
  filePath: string;
}

export interface SpecMatchResult {
  /** The unique matched candidate, or `null` when ambiguous / orphan. */
  matched: DiscoveryCandidate | null;
  /**
   * The candidate set that competed at the matched priority level.
   * `length >= 2` for ambiguous, `length === 0` for orphan, `length === 0`
   * (NOT 1) for a unique match -- the unique match is on `matched`.
   */
  competingMatches: DiscoveryCandidate[];
  /**
   * Which heuristic produced the match (or the ambiguity). `null` when
   * the spec is an orphan (no level matched).
   */
  heuristic: MatchHeuristic | null;
}

// ----------------------------------------------------------------------------
// Internal helpers
// ----------------------------------------------------------------------------

function getDataString(cand: DiscoveryCandidate, key: string): string | null {
  const v = cand.data?.[key];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/** Title heuristic: case-sensitive exact match against `candidate.name`. */
function matchByTitle(
  title: string | null,
  candidates: DiscoveryCandidate[],
): DiscoveryCandidate[] {
  if (!title) return [];
  return candidates.filter((c) => c.name === title);
}

/**
 * Base-path heuristic. Compute the longest shared prefix across the spec's
 * `paths` keys; match any candidate whose `data.basePath` equals that
 * prefix (post-normalisation: trailing slash trimmed, both sides start
 * with `/`).
 *
 * Implementation note: with the Petstore fixture's three paths
 * `/api/v1/pets`, `/api/v1/pets/{petId}`, `/api/v1/pets/{petId}/photos`,
 * the longest shared prefix is `/api/v1/pets`. That matches a candidate
 * whose Spring Boot `@RequestMapping("/api/v1/pets")` was captured as
 * `data.basePath = '/api/v1/pets'`.
 */
function commonPathPrefix(pathKeys: string[]): string | null {
  if (pathKeys.length === 0) return null;
  if (pathKeys.length === 1) {
    // Single path -- use everything up to the last `/` (or the whole
    // thing if there is no nested segment).
    const only = pathKeys[0];
    if (!only.startsWith('/')) return null;
    const lastSlash = only.lastIndexOf('/');
    if (lastSlash <= 0) return only;
    return only.slice(0, lastSlash);
  }
  // Multi-path: walk segment by segment.
  const segmented = pathKeys.map((p) => p.split('/'));
  const first = segmented[0];
  let lastCommonIdx = 0;
  for (let i = 1; i < first.length; i++) {
    const seg = first[i];
    const allMatch = segmented.every((arr) => arr[i] === seg);
    if (!allMatch) break;
    lastCommonIdx = i;
  }
  if (lastCommonIdx === 0) return null; // only the leading empty segment matches -- not useful
  // Reconstruct the prefix from the first path up to lastCommonIdx.
  const prefix = first.slice(0, lastCommonIdx + 1).join('/');
  return prefix.length > 0 ? prefix : null;
}

function normalisePath(p: string): string {
  if (!p) return '';
  let out = p.trim();
  if (out.length > 1 && out.endsWith('/')) out = out.slice(0, -1);
  return out;
}

function matchByBasePath(
  parsed: Record<string, unknown>,
  candidates: DiscoveryCandidate[],
): DiscoveryCandidate[] {
  const paths = parsed.paths;
  if (!paths || typeof paths !== 'object' || Array.isArray(paths)) return [];
  const pathKeys = Object.keys(paths as Record<string, unknown>);
  const prefix = commonPathPrefix(pathKeys);
  if (!prefix) return [];
  const normalisedPrefix = normalisePath(prefix);
  if (!normalisedPrefix) return [];
  return candidates.filter((c) => {
    const bp = getDataString(c, 'basePath');
    if (!bp) return false;
    return normalisePath(bp) === normalisedPrefix;
  });
}

/**
 * Tag heuristic: any of the spec's `tags[].name` values match a candidate's
 * `data.openApiTag`.
 */
function matchByTag(
  parsed: Record<string, unknown>,
  candidates: DiscoveryCandidate[],
): DiscoveryCandidate[] {
  const tags = parsed.tags;
  if (!Array.isArray(tags)) return [];
  const tagNames = new Set<string>();
  for (const t of tags) {
    if (t && typeof t === 'object' && !Array.isArray(t)) {
      const name = (t as Record<string, unknown>).name;
      if (typeof name === 'string' && name.length > 0) {
        tagNames.add(name);
      }
    }
  }
  if (tagNames.size === 0) return [];
  return candidates.filter((c) => {
    const tag = getDataString(c, 'openApiTag');
    return tag != null && tagNames.has(tag);
  });
}

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

/**
 * Match a parsed OAS spec to the interface-candidate set using the
 * three-priority order. Pure; no I/O; no mutation of inputs.
 */
export function matchSpecToInterface(
  spec: SpecMatchInput,
  candidates: DiscoveryCandidate[],
): SpecMatchResult {
  // Priority 1: info.title exact match.
  const info = spec.parsed.info;
  let title: string | null = null;
  if (info && typeof info === 'object' && !Array.isArray(info)) {
    const t = (info as Record<string, unknown>).title;
    if (typeof t === 'string') title = t;
  }
  const titleMatches = matchByTitle(title, candidates);
  if (titleMatches.length === 1) {
    return { matched: titleMatches[0], competingMatches: [], heuristic: 'title' };
  }
  if (titleMatches.length > 1) {
    return { matched: null, competingMatches: titleMatches, heuristic: 'title' };
  }

  // Priority 2: paths base-prefix match.
  const basePathMatches = matchByBasePath(spec.parsed, candidates);
  if (basePathMatches.length === 1) {
    return {
      matched: basePathMatches[0],
      competingMatches: [],
      heuristic: 'base_path',
    };
  }
  if (basePathMatches.length > 1) {
    return {
      matched: null,
      competingMatches: basePathMatches,
      heuristic: 'base_path',
    };
  }

  // Priority 3: tags[].name match against candidate.data.openApiTag.
  const tagMatches = matchByTag(spec.parsed, candidates);
  if (tagMatches.length === 1) {
    return { matched: tagMatches[0], competingMatches: [], heuristic: 'tag' };
  }
  if (tagMatches.length > 1) {
    return { matched: null, competingMatches: tagMatches, heuristic: 'tag' };
  }

  // Orphan: nothing matched at any level.
  return { matched: null, competingMatches: [], heuristic: null };
}
