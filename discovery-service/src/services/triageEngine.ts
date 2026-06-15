/**
 * Candidate Triage Engine (Phase 1b)
 *
 * A standalone, pure function that partitions candidate relationships
 * into three confidence-based buckets and detects competing relationships.
 *
 * Data flow position: 1b linker rules -> **triage engine** -> accepted/ambiguous/discarded
 *
 * The triage engine:
 * 1. Partitions candidates into accepted / ambiguous / discarded buckets
 *    based on the AUTO_ACCEPT_THRESHOLD and AMBIGUOUS_THRESHOLD constants.
 * 2. Detects competing relationships within the ambiguous bucket:
 *    candidates sharing the same sourceAtomId AND same relationshipType
 *    are grouped together. Groups with 2+ candidates become
 *    `resolve_competing_relationships` DecisionTasks; single-candidate
 *    groups become individual `confirm_relationship` DecisionTasks.
 * 3. (Increment 14) Applies a log corroboration confidence boost for
 *    relationships where contributing atoms include log-derived evidence.
 *
 * This function has no I/O dependencies -- it is a pure, testable unit.
 */

import { CandidateRelationship, EvidenceAtom } from '../types';
import { AUTO_ACCEPT_THRESHOLD, AMBIGUOUS_THRESHOLD } from '../constants/linkerDefaults';
import {
  LOG_CORROBORATION_CONFIDENCE_BOOST,
  LOG_MAX_CONFIDENCE_CAP,
} from '../constants/logEnrichmentDefaults';

/**
 * Result of the candidate triage process.
 */
export interface TriageResult {
  /** Candidates with confidence >= AUTO_ACCEPT_THRESHOLD -- ready for direct persistence */
  accepted: CandidateRelationship[];

  /** Candidates with confidence >= AMBIGUOUS_THRESHOLD and < AUTO_ACCEPT_THRESHOLD -- need DecisionTasks */
  ambiguous: CandidateRelationship[];

  /** Candidates with confidence < AMBIGUOUS_THRESHOLD -- dropped, not persisted */
  discarded: CandidateRelationship[];

  /**
   * Competing relationship groups within the ambiguous bucket.
   * Key format: "sourceAtomId::relationshipType"
   * Only groups with 2+ candidates are included (these become resolve_competing_relationships tasks).
   * Single-candidate groups are not included (they become individual confirm_relationship tasks).
   */
  competingGroups: Map<string, CandidateRelationship[]>;
}

/**
 * Partitions candidate relationships into confidence-based buckets
 * and detects competing relationships among the ambiguous candidates.
 *
 * When atoms are provided, applies a log corroboration confidence boost
 * (Increment 14) for relationships where at least one contributing atom
 * has `source: "log"`.
 *
 * @param candidates - Array of candidate relationships from all linker rules
 * @param atoms - Optional array of evidence atoms for log corroboration check
 * @returns TriageResult with accepted, ambiguous, discarded buckets and competing groups
 */
export function triageCandidates(
  candidates: CandidateRelationship[],
  atoms?: EvidenceAtom[]
): TriageResult {
  const accepted: CandidateRelationship[] = [];
  const ambiguous: CandidateRelationship[] = [];
  const discarded: CandidateRelationship[] = [];

  // Step 1: Partition candidates into three buckets based on confidence thresholds
  for (const candidate of candidates) {
    if (candidate.confidence >= AUTO_ACCEPT_THRESHOLD) {
      accepted.push(candidate);
    } else if (candidate.confidence >= AMBIGUOUS_THRESHOLD) {
      ambiguous.push(candidate);
    } else {
      discarded.push(candidate);
    }
  }

  // Step 2: Detect competing relationships within the ambiguous bucket.
  // Group ambiguous candidates by sourceAtomId + relationshipType.
  const groupMap = new Map<string, CandidateRelationship[]>();

  for (const candidate of ambiguous) {
    const groupKey = `${candidate.sourceAtomId}::${candidate.relationshipType}`;
    const group = groupMap.get(groupKey);
    if (group) {
      group.push(candidate);
    } else {
      groupMap.set(groupKey, [candidate]);
    }
  }

  // Step 3: Filter to only groups with 2+ candidates (actual competing relationships).
  // Single-candidate groups are non-competing and will become individual confirm_relationship tasks.
  const competingGroups = new Map<string, CandidateRelationship[]>();

  for (const [key, group] of groupMap) {
    if (group.length >= 2) {
      competingGroups.set(key, group);
    }
  }

  // =========================================================================
  // Step 4 (Increment 14): Log corroboration confidence boost
  // =========================================================================
  // When atoms are provided, boost confidence for relationships where at
  // least one contributing atom (sourceAtomId or targetAtomId) has source: "log".
  // This is additive -- existing triage logic above remains untouched.
  if (atoms && atoms.length > 0) {
    applyLogCorroborationBoost(accepted, atoms);
    applyLogCorroborationBoost(ambiguous, atoms);
  }

  return {
    accepted,
    ambiguous,
    discarded,
    competingGroups,
  };
}

/**
 * Applies the log corroboration confidence boost to candidate relationships.
 *
 * For each relationship, checks whether its sourceAtomId or targetAtomId
 * references an atom with `source: "log"`. If so, adds
 * LOG_CORROBORATION_CONFIDENCE_BOOST to the relationship's confidence,
 * capped at LOG_MAX_CONFIDENCE_CAP.
 *
 * @param relationships - Array of candidate relationships to potentially boost
 * @param atoms - Array of evidence atoms to check for log source
 */
function applyLogCorroborationBoost(
  relationships: CandidateRelationship[],
  atoms: EvidenceAtom[]
): void {
  // Build a set of atom IDs that have source: "log" for O(1) lookup
  const logAtomIds = new Set<string>();
  for (const atom of atoms) {
    if (atom.source === 'log') {
      logAtomIds.add(atom.id);
    }
  }

  if (logAtomIds.size === 0) return;

  for (const rel of relationships) {
    const hasLogAtom = logAtomIds.has(rel.sourceAtomId) || logAtomIds.has(rel.targetAtomId);
    if (hasLogAtom) {
      rel.confidence = Math.min(
        rel.confidence + LOG_CORROBORATION_CONFIDENCE_BOOST,
        LOG_MAX_CONFIDENCE_CAP
      );
    }
  }
}
