/**
 * Universal, identity-keyed, cross-source candidate MERGE engine
 * (Spec 0 — Unique, Aggregate Discovery Candidates).
 *
 * REPLACES the parent-inclusive dedup-DROP (`packPostProcess.dedupPackCandidates`,
 * wired at `discoveryV3Pipeline.ts:985`). Where the old pass DROPPED later
 * occurrences of a key (and folded the parent interface into the endpoint key,
 * so the same verb+path under a generic WADL interface / no parent / a specific
 * controller never collapsed — root cause #1), this engine GROUPS every source's
 * view of one real architecture element under a single identity key
 * (`buildIdentityKey`) and FOLDS them into ONE surviving candidate:
 *
 *   - UNIONs every `data` attribute across the grouped sources;
 *   - gap-fills an absent attribute slot, and picks the canonical slot for
 *     EQUAL competing values, by SOURCE PRECEDENCE
 *     (structural framework pack > contract pack > runtime evidence > LLM);
 *   - HOLDS differing present values as `_conflicts` (NEVER auto-resolved by
 *     precedence — a real value conflict for the reviewer);
 *   - collapses media-type variants of one method+path into ONE endpoint with
 *     UNIONed `consumes`/`produces`/`headers`/`params`;
 *   - records full provenance (`_addedBy: string[]`, `_mergedFrom`,
 *     `_attributeProvenance`) inside the candidate `data` JSONB passthrough;
 *   - normalizes the JAX-RS endpoint field names to the save-back canonical
 *     slots (`httpMethod` -> `operation_verb`, `fullPath` -> `path_or_address` —
 *     root cause #2, merge side).
 *
 * Pure / NO I/O — fully unit-testable. It returns the merged array plus
 * per-merge-group and per-conflict metadata for the Group 4 Findings emission.
 *
 * SCOPE: merged types are `endpoints`, `interfaces`, `logical_data_entities`,
 * `physical_data_entities`, `service`, and `business_logics` (method-level — added
 * so the same class+method emitted by both a framework adapter AND the LLM
 * gap-fill collapses to one; keyed on className+methodName so distinct-class
 * methods are never fused). `class` is NOT merged or minted. Every OTHER type
 * passes through UNTOUCHED (same object identity preserved), and attributes /
 * relationship-link rows reconcile as a CONSEQUENCE of their parents (Group 3),
 * not as independent identity groups here.
 *
 * REFERENCE SEMANTICS: the survivor reuses the highest-precedence source
 * candidate's OBJECT (mutated in place), so its `id` is stable and Stage 2.5
 * runtime evidence (which matches/enriches by candidate `id` via
 * `applyRuntimeEvidenceToCandidates`) keeps finding it after the merge.
 *
 * The conflict/provenance shape is self-contained in `data` and is reusable by a
 * later spec (Spec 3) — it is NOT coupled to any UI or pipeline concern.
 */

import type {
  ConflictingValue,
  DiscoveryCandidate,
  CandidateType,
} from '../types/candidate';
import {
  buildIdentityKey,
  classifySourceTier,
  readAddedBy,
  sourceLabelRank,
  SOURCE_TIER_RANK,
} from './candidateIdentity';

// ---------------------------------------------------------------------------
// Which candidate types the engine MERGES (everything else passes through).
// ---------------------------------------------------------------------------

const MERGEABLE_TYPES = new Set<CandidateType>([
  'endpoints',
  'interfaces',
  'logical_data_entities',
  'physical_data_entities',
  'data_entity', // physical_data_entities is sometimes emitted as data_entity
  'service',
  // Method-level candidates: the SAME class+method emitted by a framework adapter
  // AND the LLM gap-fill is the same method and must collapse to one. The identity
  // key (`candidateIdentity.ts`) is className+methodName, so distinct methods in
  // DIFFERENT classes are never fused. The merge unions `data` + provenance and
  // keeps the highest-precedence (pack) survivor's id stable.
  'business_logics',
]);

/**
 * `data` keys that are MERGE METADATA, not mergeable attributes. Excluded from
 * attribute union / conflict detection (they are managed by the engine itself).
 */
const RESERVED_DATA_KEYS = new Set<string>([
  '_addedBy',
  '_mergedFrom',
  '_attributeProvenance',
  '_conflicts',
  '_conflictResolutions',
]);

/**
 * `data` keys whose values are UNIONed (deduplicated set-union) across grouped
 * sources rather than precedence-picked or conflicted. These are the list-shaped
 * discriminator fields the JAX-RS detector splits media-type / param variants on
 * — under OAS they are attributes of ONE operation, so the merge collapses the
 * variants and UNIONs the lists (overriding the discriminator split).
 */
const UNION_LIST_KEYS = new Set<string>([
  'consumes',
  'produces',
  'headers',
  'params',
]);

/**
 * Endpoint field-name normalization (root cause #2). The JAX-RS detector writes
 * camelCase `httpMethod`/`fullPath`; the save-back's canonical slots are
 * `operation_verb`/`path_or_address`. The merge folds the camelCase source keys
 * onto the canonical keys (and drops the camelCase originals) so the canonical
 * slots are populated before persist. Map of source key -> canonical key.
 */
const ENDPOINT_FIELD_ALIASES: Record<string, string> = {
  httpMethod: 'operation_verb',
  fullPath: 'path_or_address',
};

// ---------------------------------------------------------------------------
// Result + metadata shapes
// ---------------------------------------------------------------------------

/** Per-merge-group audit record (one per surviving candidate that folded >1 source). */
export interface MergeGroup {
  /** Identity key the group collapsed under. */
  identityKey: string;
  /** Candidate type of the group. */
  candidateType: CandidateType;
  /** The surviving candidate's id. */
  survivorId: string;
  /** The surviving candidate's display name. */
  survivorName: string;
  /** Ids of ALL source candidates folded into the survivor (includes the survivor's own id). */
  mergedFromIds: string[];
  /** Per-source contribution: source candidate id -> its source label(s). */
  perSourceContribution: Array<{ candidateId: string; sources: string[] }>;
}

/** One detected attribute conflict (one per conflicted attribute per survivor). */
export interface MergeConflict {
  /** Identity key of the survivor carrying the conflict. */
  identityKey: string;
  /** The surviving candidate's id. */
  survivorId: string;
  /** The surviving candidate's display name. */
  survivorName: string;
  /** The conflicted attribute name (canonical key). */
  attr: string;
  /** The competing values, one per distinct present value, each tagged with its source. */
  competingValues: ConflictingValue[];
}

export interface MergeResult {
  /** The merged candidate array (survivors + untouched pass-through candidates). */
  merged: DiscoveryCandidate[];
  /** Per-merge-group audit metadata (groups that folded >= 2 sources). */
  mergeGroups: MergeGroup[];
  /** Per-conflict metadata for the Group 4 per-conflict Findings. */
  conflicts: MergeConflict[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Stable structural equality for attribute values (handles arrays/objects). */
function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  // NaN-safe + structural: stable JSON of normalized form.
  try {
    return stableStringify(a) === stableStringify(b);
  } catch {
    return false;
  }
}

/** Deterministic JSON stringify with sorted object keys (stable across sources). */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(',')}}`;
}

/** Is a value "present" (worth contributing to the union / conflict pool)? */
function isPresent(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string' && value.trim() === '') return false;
  if (Array.isArray(value) && value.length === 0) return false;
  return true;
}

/** Canonicalize a `data` attribute key (applies the endpoint field-name aliases). */
function canonicalAttrKey(rawKey: string): string {
  return ENDPOINT_FIELD_ALIASES[rawKey] ?? rawKey;
}

/** Union two list-shaped values into a deduplicated array (string-stable order preserved). */
function unionLists(existing: unknown, incoming: unknown): unknown[] {
  const out: unknown[] = [];
  const seen = new Set<string>();
  const push = (v: unknown): void => {
    const key = stableStringify(v);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(v);
    }
  };
  const consume = (v: unknown): void => {
    if (Array.isArray(v)) v.forEach(push);
    else if (isPresent(v)) push(v);
  };
  consume(existing);
  consume(incoming);
  return out;
}

/**
 * Pick the best (highest-precedence) source label for a candidate, used to tag
 * that candidate's contributed attributes. Falls back to `'unknown-source'`.
 */
function bestLabelFor(candidate: DiscoveryCandidate): string {
  const labels = readAddedBy(candidate);
  if (labels.length === 0) return 'unknown-source';
  return [...labels].sort((a, b) => sourceLabelRank(a) - sourceLabelRank(b))[0];
}

/** Sort a group's candidates by source precedence (highest first), id as tiebreaker. */
function sortByPrecedence(group: DiscoveryCandidate[]): DiscoveryCandidate[] {
  return [...group].sort((a, b) => {
    const ra = sourceLabelRank(bestLabelFor(a));
    const rb = sourceLabelRank(bestLabelFor(b));
    if (ra !== rb) return ra - rb;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

// ---------------------------------------------------------------------------
// Per-attribute pool record
// ---------------------------------------------------------------------------

interface AttrContribution {
  value: unknown;
  source: string;
  rank: number;
}

// ---------------------------------------------------------------------------
// Core merge of one identity group
// ---------------------------------------------------------------------------

function mergeGroup(
  identityKey: string,
  group: DiscoveryCandidate[],
): {
  survivor: DiscoveryCandidate;
  mergeGroup: MergeGroup | null;
  conflicts: MergeConflict[];
} {
  const ordered = sortByPrecedence(group);
  // The survivor reuses the highest-precedence source's OBJECT (stable id,
  // mutated in place). Reference semantics: Stage 2.5 finds it by this id.
  const survivor = ordered[0];
  const survivorData = (survivor.data || {}) as Record<string, unknown>;

  // --- Provenance accumulation -------------------------------------------
  // Seed from each contributing candidate's EXISTING `_mergedFrom` so a re-merge
  // (e.g. the Phase-2 LLM fold-in re-running over already-merged pack survivors)
  // PRESERVES the earlier audit trail rather than overwriting it with just the
  // survivor id. `_addedBy` already unions via `readAddedBy` (array-tolerant).
  const addedBySet = new Set<string>();
  const mergedFromSet = new Set<string>();
  const mergedFromIds: string[] = [];
  const addMergedFrom = (id: string): void => {
    if (!mergedFromSet.has(id)) {
      mergedFromSet.add(id);
      mergedFromIds.push(id);
    }
  };
  const perSourceContribution: MergeGroup['perSourceContribution'] = [];
  for (const c of ordered) {
    addMergedFrom(c.id);
    const cData = (c.data || {}) as Record<string, unknown>;
    const priorMergedFrom = cData._mergedFrom;
    if (Array.isArray(priorMergedFrom)) {
      for (const id of priorMergedFrom) {
        if (typeof id === 'string') addMergedFrom(id);
      }
    }
    const labels = readAddedBy(c);
    labels.forEach((l) => addedBySet.add(l));
    perSourceContribution.push({ candidateId: c.id, sources: labels });
  }

  // --- Attribute pools ----------------------------------------------------
  // For UNION list keys: accumulate a deduplicated union.
  const unionPools = new Map<string, unknown[]>();
  // For scalar/object keys: accumulate one contribution per source.
  const scalarPools = new Map<string, AttrContribution[]>();

  for (const c of ordered) {
    const cData = (c.data || {}) as Record<string, unknown>;
    const label = bestLabelFor(c);
    const rank = SOURCE_TIER_RANK[classifySourceTier(label)];
    for (const rawKey of Object.keys(cData)) {
      if (RESERVED_DATA_KEYS.has(rawKey)) continue;
      const value = cData[rawKey];
      if (!isPresent(value)) continue;
      const key = canonicalAttrKey(rawKey);

      if (UNION_LIST_KEYS.has(key)) {
        const existing = unionPools.get(key) ?? [];
        unionPools.set(key, unionLists(existing, value));
        continue;
      }

      const pool = scalarPools.get(key) ?? [];
      pool.push({ value, source: label, rank });
      scalarPools.set(key, pool);
    }
  }

  // --- Resolve scalar pools into canonical slots / conflicts -------------
  const attributeProvenance: Record<string, string> = {};
  const conflicts: Record<string, ConflictingValue[]> = {};
  const conflictMeta: MergeConflict[] = [];

  for (const [key, contributions] of scalarPools.entries()) {
    // Distinct present values across sources (first source wins the label per value).
    const distinct: ConflictingValue[] = [];
    for (const contrib of contributions) {
      if (!distinct.some((d) => valuesEqual(d.value, contrib.value))) {
        distinct.push({ value: contrib.value, source: contrib.source });
      }
    }
    // Highest-precedence contribution (pool order is precedence-sorted because
    // `ordered` is; but be explicit and pick by min rank, id-stable).
    const best = [...contributions].sort((a, b) => a.rank - b.rank)[0];

    if (distinct.length <= 1) {
      // Agreement (or single source): canonical slot = the value; provenance =
      // the highest-precedence contributor of THAT value.
      survivorData[key] = best.value;
      attributeProvenance[key] = best.source;
    } else {
      // True conflict: HOLD all competing values, NEVER auto-resolve by
      // precedence. The canonical slot still carries the highest-precedence
      // value so downstream has a value, but the unresolved conflict gates
      // clean-approve in the grid.
      survivorData[key] = best.value;
      attributeProvenance[key] = best.source;
      conflicts[key] = distinct;
      conflictMeta.push({
        identityKey,
        survivorId: survivor.id,
        survivorName: survivor.name,
        attr: key,
        competingValues: distinct,
      });
    }
  }

  // --- Apply UNION list pools (no conflict — they are attributes) --------
  for (const [key, list] of unionPools.entries()) {
    survivorData[key] = list;
    attributeProvenance[key] = attributeProvenance[key] ?? 'merged-union';
  }

  // --- Drop the camelCase endpoint originals now that canonical slots are set
  for (const aliasKey of Object.keys(ENDPOINT_FIELD_ALIASES)) {
    if (aliasKey in survivorData) {
      delete survivorData[aliasKey];
    }
  }

  // --- Write provenance metadata into the survivor's data ----------------
  survivorData._addedBy = [...addedBySet].sort();
  survivorData._mergedFrom = mergedFromIds;
  survivorData._attributeProvenance = attributeProvenance;
  if (Object.keys(conflicts).length > 0) {
    survivorData._conflicts = conflicts;
  }
  survivor.data = survivorData;

  // --- confidence = max() of contributing source confidences -------------
  survivor.confidence = ordered.reduce(
    (mx, c) => (typeof c.confidence === 'number' && c.confidence > mx ? c.confidence : mx),
    typeof survivor.confidence === 'number' ? survivor.confidence : 0,
  );

  const groupMeta: MergeGroup | null =
    ordered.length >= 2
      ? {
          identityKey,
          candidateType: survivor.candidateType,
          survivorId: survivor.id,
          survivorName: survivor.name,
          mergedFromIds,
          perSourceContribution,
        }
      : null;

  return { survivor, mergeGroup: groupMeta, conflicts: conflictMeta };
}

// ---------------------------------------------------------------------------
// Public entrypoint
// ---------------------------------------------------------------------------

/**
 * Merge a candidate array by per-type identity key. Returns the merged array
 * (survivors + untouched pass-through candidates, in stable first-seen order)
 * plus per-merge-group and per-conflict metadata.
 *
 * @param candidates input candidates (packs + Stage-2 contract, or the merged
 *   set + folded-in LLM/runtime contributions). Input array not mutated; the
 *   SURVIVOR objects ARE mutated in place (reference semantics for Stage 2.5).
 */
export function mergeCandidates(
  candidates: readonly DiscoveryCandidate[],
): MergeResult {
  // Group mergeable candidates by identity key, preserving first-seen order of
  // the groups so the merged array order is deterministic.
  const groups = new Map<string, DiscoveryCandidate[]>();
  const groupOrder: string[] = [];
  // Pass-through candidates (non-v1 types) keep their slot via a sentinel marker
  // in the output order list so overall ordering is stable.
  const merged: DiscoveryCandidate[] = [];
  const mergeGroups: MergeGroup[] = [];
  const conflicts: MergeConflict[] = [];

  // Two-pass: (1) bucket, recording the FIRST output position each group/pass
  // candidate should occupy; (2) emit in that order.
  type Slot = { kind: 'group'; key: string } | { kind: 'passthrough'; cand: DiscoveryCandidate };
  const slots: Slot[] = [];
  const seenGroupKeys = new Set<string>();

  for (const cand of candidates) {
    if (!MERGEABLE_TYPES.has(cand.candidateType)) {
      slots.push({ kind: 'passthrough', cand });
      continue;
    }
    const key = buildIdentityKey(cand);
    if (!groups.has(key)) {
      groups.set(key, []);
      groupOrder.push(key);
    }
    groups.get(key)!.push(cand);
    if (!seenGroupKeys.has(key)) {
      seenGroupKeys.add(key);
      slots.push({ kind: 'group', key });
    }
  }

  for (const slot of slots) {
    if (slot.kind === 'passthrough') {
      merged.push(slot.cand);
      continue;
    }
    const group = groups.get(slot.key)!;
    const { survivor, mergeGroup: gm, conflicts: gc } = mergeGroup(slot.key, group);
    merged.push(survivor);
    if (gm) mergeGroups.push(gm);
    conflicts.push(...gc);
  }

  return { merged, mergeGroups, conflicts };
}
