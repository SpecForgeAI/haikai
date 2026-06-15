/**
 * Task Group 4 (Spec 0 — Unique, Aggregate Discovery Candidates):
 * focused tests for the merge/conflict Finding builders. One Finding per merge
 * group (surviving candidate + collapsed `_mergedFrom` ids + per-source
 * contribution) and one per detected conflict (`attr` + competing
 * `{value, source}[]`), reusing/extending the existing `candidate_conflict`
 * emission shape.
 *
 * Kept to a tight focused set (2-8 tests).
 */

import {
  buildMergeGroupFinding,
  buildMergeConflictFinding,
} from '../mergeFindingBuilders';

describe('buildMergeGroupFinding', () => {
  it('records the survivor + all collapsed source ids + per-source contribution', () => {
    const finding = buildMergeGroupFinding({
      survivorId: 'survivor-1',
      survivorName: 'GET /users/{id}',
      candidateType: 'endpoints',
      mergedFromIds: ['survivor-1', 'wadl-1', 'wadl-2'],
      perSourceContribution: [
        { candidateId: 'survivor-1', sources: ['spring-classic-jaxrs'] },
        { candidateId: 'wadl-1', sources: ['rest-wadl-pack'] },
        { candidateId: 'wadl-2', sources: ['rest-wadl-pack'] },
      ],
    });

    // Reuses the candidate_conflict finding TYPE (shared AMS dedupe semantics).
    expect(finding.findingType).toBe('candidate_conflict');
    expect(finding.category).toBe('ambiguity');
    // Links the survivor AND every collapsed source candidate.
    const linkedIds = finding.links!.map((l) => l.targetId).sort();
    expect(linkedIds).toEqual(['survivor-1', 'wadl-1', 'wadl-2']);
    finding.links!.forEach((l) => expect(l.targetType).toBe('discovery_candidate'));
    // Per-source contribution + mergedFrom carried in detailJson for the audit.
    const detail = finding.detailJson as Record<string, unknown>;
    expect(detail.survivorId).toBe('survivor-1');
    expect(detail.mergedFromIds).toEqual(['survivor-1', 'wadl-1', 'wadl-2']);
    expect(Array.isArray(detail.perSourceContribution)).toBe(true);
  });

  it('emits from the merge stage (distinct from the legacy dedup stage)', () => {
    const finding = buildMergeGroupFinding({
      survivorId: 's',
      survivorName: 'n',
      candidateType: 'service',
      mergedFromIds: ['s', 'x'],
      perSourceContribution: [],
    });
    expect(finding.createdByStage).toBe('discoveryV3Pipeline.merge');
  });
});

describe('buildMergeConflictFinding', () => {
  it('records the conflicted attr and each competing {value, source}', () => {
    const finding = buildMergeConflictFinding({
      survivorId: 'survivor-9',
      survivorName: 'PaymentService',
      attr: 'owner',
      competingValues: [
        { value: 'team-alpha', source: 'spring-classic-adapter' },
        { value: 'team-beta', source: 'rest-wadl-pack' },
      ],
    });

    expect(finding.findingType).toBe('candidate_conflict');
    // Links the surviving candidate.
    expect(finding.links!.map((l) => l.targetId)).toContain('survivor-9');
    const detail = finding.detailJson as Record<string, unknown>;
    expect(detail.attr).toBe('owner');
    const competing = detail.competingValues as Array<{ value: unknown; source: string }>;
    expect(competing).toHaveLength(2);
    const byValue = new Map(competing.map((c) => [c.value, c.source]));
    expect(byValue.get('team-alpha')).toBe('spring-classic-adapter');
    expect(byValue.get('team-beta')).toBe('rest-wadl-pack');
    // The attr + sources are mentioned in the human-readable summary.
    expect(finding.summary).toContain('owner');
  });
});
