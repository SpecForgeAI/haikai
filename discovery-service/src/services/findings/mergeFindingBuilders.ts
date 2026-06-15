/**
 * Merge / conflict Finding builders for the universal candidate merge
 * (Spec 0 — Unique, Aggregate Discovery Candidates, Task Group 4).
 *
 * Oracle completeness — NOTHING is silently lost when the merge collapses 2-3
 * partial duplicates into one truthful candidate:
 *
 *   - `buildMergeGroupFinding`   — ONE Finding per merge group. Records the
 *     surviving candidate, the collapsed source-candidate ids (`_mergedFrom`),
 *     and the per-source contribution, so the audit trail shows exactly which
 *     source candidates folded into the survivor.
 *   - `buildMergeConflictFinding`— ONE Finding per detected attribute conflict.
 *     Records the conflicted `attr` and each competing `{ value, source }`, so a
 *     reviewer can see every value that was held rather than silently dropped.
 *
 * Both EXTEND the existing Stage-4 `candidate_conflict` emission SHAPE (the same
 * `findingType: 'candidate_conflict'` / `category: 'ambiguity'` family, and the
 * SAME `FindingEmitInput -> caller-emit` path every other source uses — see
 * `discoveryV3Pipeline.ts` ~1387-1404 and `emissionSources.buildCandidateConflictFinding`)
 * rather than inventing a new emission path. They are co-located here (next to,
 * not inside, the 1.4k-line `emissionSources.ts`) because they are specific to
 * the merge feature and consume the merge engine's `MergeGroup` / `MergeConflict`
 * metadata shapes directly.
 */

import type { FindingEmitInput } from './FindingEmitter';
import type { DiscoveryFindingLinkPayload } from '../archModelClient';
import type { ConflictingValue } from '../../types/candidate';

/**
 * One Finding per merge group. Links the surviving candidate AND every collapsed
 * source candidate (so the Findings tab can pivot from any folded id to the
 * group); carries `mergedFromIds` + `perSourceContribution` in `detailJson`.
 */
export function buildMergeGroupFinding(args: {
  survivorId: string;
  survivorName: string;
  candidateType: string;
  /** Ids of ALL source candidates folded into the survivor (includes the survivor). */
  mergedFromIds: string[];
  /** Per-source contribution: each folded candidate id and its source label(s). */
  perSourceContribution: Array<{ candidateId: string; sources: string[] }>;
}): FindingEmitInput {
  // Link the survivor + every distinct collapsed source candidate id.
  const linkedIds = Array.from(new Set(args.mergedFromIds));
  const links: DiscoveryFindingLinkPayload[] = linkedIds.map((id) => ({
    linkType: id === args.survivorId ? 'supports' : 'related_to',
    targetType: 'discovery_candidate' as const,
    targetId: id,
  }));
  const collapsedCount = Math.max(0, args.mergedFromIds.length - 1);
  return {
    findingType: 'candidate_conflict',
    category: 'ambiguity',
    severity: 'medium',
    title: `Merged ${args.candidateType} candidate: ${args.survivorName}`,
    summary:
      `${collapsedCount + 1} source candidate(s) for the same ${args.candidateType} ` +
      `('${args.survivorName}') were merged into one. Surviving id '${args.survivorId}'; ` +
      `collapsed ${collapsedCount} duplicate(s). Attribute-level findings from every source ` +
      `were aggregated onto the survivor with full provenance.`,
    detailJson: {
      survivorId: args.survivorId,
      survivorName: args.survivorName,
      candidateType: args.candidateType,
      mergedFromIds: args.mergedFromIds,
      perSourceContribution: args.perSourceContribution,
    },
    source: 'pipeline_dedup',
    createdByStage: 'discoveryV3Pipeline.merge',
    links,
  };
}

/**
 * One Finding per detected attribute conflict. Records the conflicted `attr` and
 * each competing `{ value, source }` so no evidence is silently lost; links the
 * surviving candidate the conflict lives on.
 */
export function buildMergeConflictFinding(args: {
  survivorId: string;
  survivorName: string;
  attr: string;
  competingValues: ConflictingValue[];
}): FindingEmitInput {
  const links: DiscoveryFindingLinkPayload[] = [
    {
      linkType: 'supports',
      targetType: 'discovery_candidate',
      targetId: args.survivorId,
    },
  ];
  const sourceList = args.competingValues.map((c) => c.source).join(', ');
  return {
    findingType: 'candidate_conflict',
    category: 'ambiguity',
    severity: 'medium',
    title: `Attribute conflict on ${args.survivorName}: ${args.attr}`,
    summary:
      `The merged candidate '${args.survivorName}' has ${args.competingValues.length} competing ` +
      `value(s) for attribute '${args.attr}' across sources (${sourceList}). The values are HELD ` +
      `for review and were NOT auto-resolved; the candidate cannot be clean-approved until the ` +
      `conflict is resolved.`,
    detailJson: {
      survivorId: args.survivorId,
      survivorName: args.survivorName,
      attr: args.attr,
      competingValues: args.competingValues,
    },
    source: 'pipeline_dedup',
    createdByStage: 'discoveryV3Pipeline.merge',
    links,
  };
}
