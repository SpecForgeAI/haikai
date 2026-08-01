/**
 * Endpoint Runtime Matcher
 *
 * Binds aggregated `HttpRuntimeObservation` data (grouped by
 * `method + normalizedPath`) to deterministic code-discovered
 * `endpoints` candidates.
 *
 * Match preference order (per spec):
 *   1. Tier 1 — Exact normalized-path match (the candidate's
 *      `pathTemplate` is normalized with the same `normalizePath` used
 *      on log lines, then compared verbatim) →
 *      `matchConfidence: 'high'`, `matchReason: 'exact_normalized_path'`.
 *   2. Tier 2 — Equivalent placeholder match (different placeholder names
 *      accepted via `arePathsEquivalentByPlaceholder`) →
 *      `matchConfidence: 'medium'`, `matchReason: 'equivalent_placeholders'`.
 *   3. Tier 3 — Suffix match (only runs when Tier 1 and Tier 2 returned
 *      empty AND `maxLogPathPrefixSegments > 0`). The candidate template
 *      matches the LAST K segments of the log's normalized path where
 *      K = candidate's segment count; the log may carry up to
 *      `maxLogPathPrefixSegments` leading proxy-prefix segments above
 *      that. Guardrail: the candidate template's first non-empty
 *      segment MUST be a literal (rejects shapes like `/{id}/foo`).
 *      → `matchConfidence: 'low'`, `matchReason: 'suffix_match'`.
 *
 * Method-equality rule:
 *   - HTTP method must match (case-insensitive).
 *   - Cross-method matching is REJECTED when the code candidate's method
 *     is known and differs from the observation's method.
 *   - Cross-method matching is ALLOWED only when the code candidate's
 *     method is unknown / missing (no `data.method` value).
 *
 * Multi-candidate disambiguation:
 *   - Tier 1 always beats Tier 2 which always beats Tier 3.
 *   - If multiple candidates win at the same tier and one is strictly
 *     more specific (fewer placeholders, or — as a tiebreaker — more
 *     literal segments), pick it.
 *   - Otherwise the observation is flagged ambiguous and is NOT attached
 *     to any candidate (recorded in `ambiguousObservations`).
 *
 * Per-candidate aggregate merge:
 *   - After the per-aggregate matching loop produces a
 *     `MatchedRuntimeEvidence[]`, multiple aggregates may now point at
 *     the same candidate (e.g. one tier-1 exact `/job/123/succinct`
 *     entry and one tier-3 suffix `/ui/job/123/succinct` entry both
 *     resolve to the same `/job/{id}/succinct` candidate).
 *   - We fold the array through a `Map<candidateId, MatchedRuntimeEvidence>`:
 *       SUM counts (`observedUsageCount`, `totalLogRequests`, the
 *         four status buckets, `sourceLogFileCount`);
 *       UNION the time window (`firstSeen = min`, `lastSeen = max`);
 *       re-aggregate `topStatusCodes` (sum per status, sort desc);
 *       the highest-confidence contributor wins for `matchConfidence`,
 *         `matchReason`, `normalizedLogPath`, `codePathTemplate`;
 *       same-confidence tie: first-encountered wins (deterministic via
 *         Map iteration order over aggregates).
 *
 * No-usage output:
 *   - Every endpoint candidate that did not receive a matched aggregate
 *     produces a `NoUsageRuntimeEvidence` row with all counts zeroed and
 *     a non-judgemental note (per spec, this is "no usage observed",
 *     never "unused").
 */

import {
  EndpointRuntimeAggregate,
  MatchedRuntimeEvidence,
  NoUsageRuntimeEvidence,
} from './httpRuntimeObservation';
import { DiscoveryCandidate } from '../../types/candidate';
import {
  arePathsEquivalentByPlaceholder,
  normalizePath,
} from './endpointPathNormalizer';

interface CandidateRecord {
  candidate: DiscoveryCandidate;
  /** Normalized form of the candidate's pathTemplate. */
  normalizedTemplate: string;
  /** Original (un-normalized) pathTemplate, preserved for display. */
  originalTemplate: string;
  /** Uppercased method, or undefined when the candidate's method is unknown/missing. */
  method?: string;
  /** Number of placeholder segments in the original template. Used for specificity comparison. */
  placeholderCount: number;
  /** Number of literal (non-placeholder, non-empty) segments. Used as specificity tiebreaker. */
  literalCount: number;
  /** Non-empty segments of the normalized template, used for tier-3 suffix matching. */
  normalizedSegments: string[];
}

const PLACEHOLDER_SEGMENT_REGEX = /^\{[^/{}]+\}$/;

type MatchReason =
  | 'exact_normalized_path'
  | 'equivalent_placeholders'
  | 'suffix_match';

const CONFIDENCE_RANK: Record<'high' | 'medium' | 'low', number> = {
  high: 3,
  medium: 2,
  low: 1,
};

/**
 * Pull the path template from a candidate's `data` blob.
 *
 * Hotfix (Image #5 — Fix 1): the canonical field is `pathTemplate`, but
 * the Spring Classic adapter writes `fullPath` and the AngularJS adapter
 * writes `url`. The fallback chain keeps the matcher binding evidence
 * to those candidates instead of treating them as "no usage observed"
 * just because the field name differs. The existing string + non-empty
 * guard is preserved so non-string / empty values still return undefined.
 *
 * 2026-08-01: `path_or_address` added as the FINAL fallback — it is the
 * canonical post-merge / save-back slot, so a run whose endpoint
 * candidates are merged-shaped stored EVERY path there and the matcher
 * dropped all of them (matchedEndpoints: 0). Original precedence is
 * unchanged, so raw adapter candidates are unaffected.
 */
function readPathTemplate(c: DiscoveryCandidate): string | undefined {
  const data = c.data as Record<string, unknown> | undefined;
  if (!data) return undefined;
  const v = data.pathTemplate ?? data.fullPath ?? data.path ?? data.url ?? data.path_or_address;
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/**
 * 2026-08-01: merged/save-back-shaped candidates carry the verb under the
 * canonical `operation_verb` (plus legacy snake/camel `http_method` /
 * `httpMethod` variants) rather than `method`. Same precedence rule as
 * {@link readPathTemplate}: original key first, canonical fallbacks after.
 */
function readMethod(c: DiscoveryCandidate): string | undefined {
  const data = c.data as Record<string, unknown> | undefined;
  if (!data) return undefined;
  const v = data.method ?? data.operation_verb ?? data.httpMethod ?? data.http_method;
  if (typeof v !== 'string') return undefined;
  const trimmed = v.trim();
  if (!trimmed) return undefined;
  return trimmed.toUpperCase();
}

function describeSpecificity(template: string): {
  placeholderCount: number;
  literalCount: number;
} {
  const segs = template.split('/');
  let placeholderCount = 0;
  let literalCount = 0;
  for (const s of segs) {
    if (s === '') continue; // skip leading/trailing empty segments produced by the split
    if (PLACEHOLDER_SEGMENT_REGEX.test(s)) placeholderCount += 1;
    else literalCount += 1;
  }
  return { placeholderCount, literalCount };
}

function nonEmptySegments(path: string): string[] {
  return path.split('/').filter((s) => s !== '');
}

function buildCandidateRecord(c: DiscoveryCandidate): CandidateRecord | null {
  const original = readPathTemplate(c);
  if (!original) return null;
  const normalized = normalizePath(original);
  const { placeholderCount, literalCount } = describeSpecificity(original);
  return {
    candidate: c,
    normalizedTemplate: normalized,
    originalTemplate: original,
    method: readMethod(c),
    placeholderCount,
    literalCount,
    normalizedSegments: nonEmptySegments(normalized),
  };
}

function methodCompatible(record: CandidateRecord, observationMethod: string): boolean {
  if (!record.method) return true; // unknown/missing method on candidate → cross-method allowed
  return record.method === observationMethod;
}

/**
 * Returns the strictly more specific record if one exists, else null.
 * "Strictly more specific" means fewer placeholders, or — when placeholder
 * counts are tied — more literal segments. If neither dominates, null.
 */
function strictlyMoreSpecific(
  a: CandidateRecord,
  b: CandidateRecord,
): CandidateRecord | null {
  if (a.placeholderCount < b.placeholderCount) return a;
  if (b.placeholderCount < a.placeholderCount) return b;
  if (a.literalCount > b.literalCount) return a;
  if (b.literalCount > a.literalCount) return b;
  return null;
}

/**
 * From a list of records that all matched at the same tier, pick the
 * strictly-most-specific one. Returns null when no single record dominates
 * (i.e. the match is ambiguous).
 */
function pickBest(records: CandidateRecord[]): CandidateRecord | null {
  if (records.length === 0) return null;
  if (records.length === 1) return records[0];

  let best: CandidateRecord = records[0];
  for (let i = 1; i < records.length; i++) {
    const challenger: CandidateRecord = records[i];
    const winner: CandidateRecord | null = strictlyMoreSpecific(best, challenger);
    if (winner === null) {
      // Ambiguous — neither is more specific than the other
      return null;
    }
    best = winner;
  }

  // Final pass: best must be strictly more specific than EVERY other record
  for (const other of records) {
    if (other === best) continue;
    const winner: CandidateRecord | null = strictlyMoreSpecific(best, other);
    if (winner !== best) return null;
  }
  return best;
}

function confidenceFor(reason: MatchReason): 'high' | 'medium' | 'low' {
  if (reason === 'exact_normalized_path') return 'high';
  if (reason === 'equivalent_placeholders') return 'medium';
  return 'low';
}

function buildMatchedEvidence(
  aggregate: EndpointRuntimeAggregate,
  record: CandidateRecord,
  reason: MatchReason,
): MatchedRuntimeEvidence {
  return {
    candidateId: record.candidate.id,
    candidateType: 'endpoints',
    method: aggregate.method,
    codePathTemplate: record.originalTemplate,
    normalizedLogPath: aggregate.normalizedPath,
    totalLogRequests: aggregate.totalLogRequests,
    observedUsageCount: aggregate.observedUsageCount,
    status2xxCount: aggregate.status2xxCount,
    status3xxCount: aggregate.status3xxCount,
    status4xxCount: aggregate.status4xxCount,
    status5xxCount: aggregate.status5xxCount,
    topStatusCodes: aggregate.topStatusCodes,
    firstSeen: aggregate.firstSeen,
    lastSeen: aggregate.lastSeen,
    sourceLogFileCount: aggregate.sourceLogFileCount,
    matchConfidence: confidenceFor(reason),
    matchReason: reason,
  };
}

function buildNoUsageEvidence(c: DiscoveryCandidate): NoUsageRuntimeEvidence {
  return {
    candidateId: c.id,
    candidateType: 'endpoints',
    observedUsageCount: 0,
    status2xxCount: 0,
    status3xxCount: 0,
    status4xxCount: 0,
    status5xxCount: 0,
    totalLogRequests: 0,
    noUsageObserved: true,
    note: 'No matching log observations in processed log window',
  };
}

/**
 * Tier-3 per-segment compare over the LAST K segments of the log path.
 *
 * Uses the same placeholder-equivalence rule used elsewhere: a placeholder
 * on either side dominates a literal on the other in the same position.
 */
function suffixSegmentsMatch(
  candidateSegments: string[],
  logSegments: string[],
): boolean {
  const k = candidateSegments.length;
  if (k === 0) return false;
  if (logSegments.length < k) return false;
  const offset = logSegments.length - k;
  for (let i = 0; i < k; i++) {
    const candSeg = candidateSegments[i];
    const logSeg = logSegments[offset + i];
    const candIsPlaceholder = PLACEHOLDER_SEGMENT_REGEX.test(candSeg);
    const logIsPlaceholder = PLACEHOLDER_SEGMENT_REGEX.test(logSeg);
    if (candIsPlaceholder || logIsPlaceholder) continue;
    if (candSeg !== logSeg) return false;
  }
  return true;
}

/**
 * Literal-first-segment guardrail: candidates whose first non-empty
 * normalized segment is a placeholder (e.g. `/{id}/foo`) are NOT eligible
 * for tier-3 suffix matching.
 */
function passesSuffixGuardrail(candidateSegments: string[]): boolean {
  if (candidateSegments.length === 0) return false;
  return !PLACEHOLDER_SEGMENT_REGEX.test(candidateSegments[0]);
}

function mergeTopStatusCodes(
  a: Array<{ status: number; count: number }>,
  b: Array<{ status: number; count: number }>,
): Array<{ status: number; count: number }> {
  const sums = new Map<number, number>();
  for (const e of a) sums.set(e.status, (sums.get(e.status) ?? 0) + e.count);
  for (const e of b) sums.set(e.status, (sums.get(e.status) ?? 0) + e.count);
  return Array.from(sums.entries())
    .map(([status, count]) => ({ status, count }))
    .sort((x, y) => y.count - x.count);
}

function minIso(a?: string, b?: string): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}

function maxIso(a?: string, b?: string): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

function mergeMatched(
  existing: MatchedRuntimeEvidence,
  incoming: MatchedRuntimeEvidence,
): MatchedRuntimeEvidence {
  const existingRank = CONFIDENCE_RANK[existing.matchConfidence];
  const incomingRank = CONFIDENCE_RANK[incoming.matchConfidence];
  // First-encountered wins on tie (`existing` was first into the Map).
  const winner = incomingRank > existingRank ? incoming : existing;

  return {
    candidateId: existing.candidateId,
    candidateType: existing.candidateType,
    method: winner.method,
    codePathTemplate: winner.codePathTemplate,
    normalizedLogPath: winner.normalizedLogPath,
    totalLogRequests: existing.totalLogRequests + incoming.totalLogRequests,
    observedUsageCount: existing.observedUsageCount + incoming.observedUsageCount,
    status2xxCount: existing.status2xxCount + incoming.status2xxCount,
    status3xxCount: existing.status3xxCount + incoming.status3xxCount,
    status4xxCount: existing.status4xxCount + incoming.status4xxCount,
    status5xxCount: existing.status5xxCount + incoming.status5xxCount,
    topStatusCodes: mergeTopStatusCodes(existing.topStatusCodes, incoming.topStatusCodes),
    firstSeen: minIso(existing.firstSeen, incoming.firstSeen),
    lastSeen: maxIso(existing.lastSeen, incoming.lastSeen),
    sourceLogFileCount: existing.sourceLogFileCount + incoming.sourceLogFileCount,
    matchConfidence: winner.matchConfidence,
    matchReason: winner.matchReason,
  };
}

export interface MatchAggregatesOptions {
  /**
   * Maximum number of leading proxy-prefix segments tolerated by the
   * Tier-3 suffix matcher. `0` disables Tier 3 entirely. Expected range
   * `[0..5]`; defensively clamped at the call site (the orchestrator
   * handles the canonical clamp; this module only enforces non-negative).
   */
  maxLogPathPrefixSegments?: number;
}

/**
 * Match aggregated runtime observations to deterministic code-discovered
 * endpoint candidates. Returns the matched evidence (folded per
 * candidate — see header), the no-usage evidence for endpoint
 * candidates that were not bound to any aggregate, and any aggregates
 * that produced multiple equally-specific matches (those are flagged
 * ambiguous and intentionally NOT attached to any candidate).
 */
export function matchAggregatesToCandidates(
  aggregates: Map<string, EndpointRuntimeAggregate>,
  candidates: DiscoveryCandidate[],
  options: MatchAggregatesOptions = {},
): {
  matched: MatchedRuntimeEvidence[];
  noUsage: NoUsageRuntimeEvidence[];
  ambiguousObservations: EndpointRuntimeAggregate[];
} {
  const rawM = options.maxLogPathPrefixSegments ?? 0;
  const maxLogPathPrefixSegments =
    Number.isInteger(rawM) && rawM >= 0 ? rawM : 0;

  // Filter to endpoint candidates with usable pathTemplate
  const records: CandidateRecord[] = [];
  for (const c of candidates) {
    if (c.candidateType !== 'endpoints') continue;
    const record = buildCandidateRecord(c);
    if (record) records.push(record);
  }

  const perCandidate = new Map<string, MatchedRuntimeEvidence>();
  const ambiguousObservations: EndpointRuntimeAggregate[] = [];

  for (const aggregate of aggregates.values()) {
    const observationMethod = aggregate.method.toUpperCase();
    const observationNormalized = aggregate.normalizedPath;

    // Tier 1 — exact normalized-path match
    const exactRecords: CandidateRecord[] = [];
    // Tier 2 — equivalent placeholder match
    const equivRecords: CandidateRecord[] = [];

    for (const r of records) {
      if (!methodCompatible(r, observationMethod)) continue;
      if (r.normalizedTemplate === observationNormalized) {
        exactRecords.push(r);
      } else if (
        arePathsEquivalentByPlaceholder(r.normalizedTemplate, observationNormalized)
      ) {
        equivRecords.push(r);
      }
    }

    let chosen: CandidateRecord | null = null;
    let reason: MatchReason | null = null;
    let tierPool: CandidateRecord[] = [];

    if (exactRecords.length > 0) {
      chosen = pickBest(exactRecords);
      reason = 'exact_normalized_path';
      tierPool = exactRecords;
    } else if (equivRecords.length > 0) {
      chosen = pickBest(equivRecords);
      reason = 'equivalent_placeholders';
      tierPool = equivRecords;
    } else if (maxLogPathPrefixSegments > 0) {
      // Tier 3 — suffix match. Only runs when Tier 1 AND Tier 2 returned
      // empty AND M > 0.
      const logSegments = nonEmptySegments(observationNormalized);
      const suffixRecords: CandidateRecord[] = [];
      for (const r of records) {
        if (!methodCompatible(r, observationMethod)) continue;
        const candSegments = r.normalizedSegments;
        if (candSegments.length === 0) continue;
        if (!passesSuffixGuardrail(candSegments)) continue;
        if (logSegments.length < candSegments.length) continue;
        const prefixSize = logSegments.length - candSegments.length;
        if (prefixSize === 0) continue; // would already have matched at tier 1/2
        if (prefixSize > maxLogPathPrefixSegments) continue;
        if (suffixSegmentsMatch(candSegments, logSegments)) {
          suffixRecords.push(r);
        }
      }
      if (suffixRecords.length > 0) {
        chosen = pickBest(suffixRecords);
        reason = 'suffix_match';
        tierPool = suffixRecords;
      }
    }

    if (chosen && reason) {
      const evidence = buildMatchedEvidence(aggregate, chosen, reason);
      const existing = perCandidate.get(chosen.candidate.id);
      if (existing) {
        perCandidate.set(chosen.candidate.id, mergeMatched(existing, evidence));
      } else {
        perCandidate.set(chosen.candidate.id, evidence);
      }
    } else if (tierPool.length > 0) {
      // Had multiple winners with no clear specificity ordering → ambiguous
      ambiguousObservations.push(aggregate);
    }
  }

  const matched: MatchedRuntimeEvidence[] = Array.from(perCandidate.values());
  const matchedCandidateIds = new Set<string>(perCandidate.keys());

  // Build noUsage rows for every endpoint candidate (with a usable template)
  // that was NOT attached to any aggregate.
  const noUsage: NoUsageRuntimeEvidence[] = [];
  for (const r of records) {
    if (matchedCandidateIds.has(r.candidate.id)) continue;
    noUsage.push(buildNoUsageEvidence(r.candidate));
  }

  return { matched, noUsage, ambiguousObservations };
}
