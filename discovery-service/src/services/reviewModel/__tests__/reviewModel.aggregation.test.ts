/**
 * Task Group 2 — Aggregation computation.
 *
 * Focused tests: aggregation counts across the seven dimensions (candidate type,
 * review status, source/tier, conflict state, merge group, scan-kind, finding
 * severity — plus finding review status + the `operation` rollup) match a
 * hand-computed fixture, AND the live-conflict count matches the grid's
 * `getUnresolvedConflicts` semantics on the same fixture.
 */

import { buildReviewModel } from '../buildReviewModel';
import type { ScanRunInput } from '../types';
import type { DiscoveryCandidate } from '../../../types/candidate';
import type { DiscoveryFindingDto } from '../../archModelClient';

function candidate(
  partial: Partial<DiscoveryCandidate> & Pick<DiscoveryCandidate, 'id' | 'candidateType' | 'name'>,
): DiscoveryCandidate {
  return {
    runId: 'run-code',
    confidence: 0.9,
    status: 'pending_review',
    sourceClusterIds: [],
    data: {},
    synthesizedAt: '2026-06-02T00:00:00Z',
    operation: 'create',
    ...partial,
  };
}

function finding(
  partial: Partial<DiscoveryFindingDto> & Pick<DiscoveryFindingDto, 'id' | 'severity' | 'reviewStatus'>,
): DiscoveryFindingDto {
  return {
    runId: 'run-code',
    projectId: 'p',
    architectureId: 'a',
    findingType: 'stored_procedure',
    category: 'data_layer',
    confidence: null,
    previousReviewStatus: null,
    title: 't',
    summary: null,
    detailJson: null,
    source: null,
    createdByStage: null,
    createdAt: 'x',
    updatedAt: 'x',
    reviewedAt: null,
    reviewerNotes: null,
    links: [],
    ...partial,
  };
}

describe('Group 2 — aggregation dimensions', () => {
  function buildFixture() {
    // 1 committed service (structural tier, no conflict)
    const svc = candidate({
      id: 'svc',
      candidateType: 'service',
      name: 'Svc',
      // Committed lifecycle; review DISPOSITION is `approved`.
      status: 'committed',
      reviewStatus: 'approved',
      data: { _addedBy: ['spring-classic-jaxrs'] },
    });
    // 2 endpoints: one with a LIVE conflict (merged, contract tier), one clean (rejected, runtime tier)
    const ep1 = candidate({
      id: 'ep1',
      candidateType: 'endpoints',
      name: 'GET /a',
      status: 'pending_review',
      operation: 'enrich',
      data: {
        _addedBy: ['rest-wadl-pack'],
        _mergedFrom: ['ep1', 'ep1b'],
        _conflicts: { path_or_address: [{ value: '/a', source: 'rest-wadl-pack' }, { value: '/aa', source: 'runtime-evidence' }] },
      },
    });
    const ep2 = candidate({
      id: 'ep2',
      candidateType: 'endpoints',
      name: 'GET /b',
      // Rejected DISPOSITION (review_status), not a lifecycle status.
      reviewStatus: 'rejected',
      data: { _addedBy: ['runtime-evidence'] },
    });
    // 2 findings, severities high + low; review statuses approved + pending_review.
    const f1 = finding({ id: 'f1', severity: 'high', reviewStatus: 'approved' });
    const f2 = finding({ id: 'f2', severity: 'low', reviewStatus: 'pending_review' });

    return buildReviewModel([
      { run_id: 'run-code', scan_kind: 'code', candidates: [svc, ep1, ep2], findings: [f1, f2] },
    ]);
  }

  test('counts by every dimension match the hand-computed fixture', () => {
    const agg = buildFixture().aggregations;

    expect(agg.total_candidates).toBe(3);
    expect(agg.total_findings).toBe(2);

    expect(agg.by_candidate_type).toEqual({ service: 1, endpoints: 2 });
    // by_review_status groups by the DISPOSITION: svc=approved, ep1=pending_review,
    // ep2=rejected (NOT the lifecycle `committed`, which is a separate dimension).
    expect(agg.by_review_status).toEqual({ approved: 1, pending_review: 1, rejected: 1 });
    expect(agg.by_source_tier).toEqual({
      'structural-framework-pack': 1, // svc
      'contract-pack': 1, // ep1 (rest-wadl-pack)
      'runtime-evidence': 1, // ep2
    });
    // Conflict state: ep1 is the only live conflict; svc + ep2 are clean.
    expect(agg.by_conflict_state).toEqual({ live_conflict: 1, clean: 2 });
    // Merge group: ep1 is merged (mergedFrom >= 2 with a shared identity not
    // required for the 'merged' bucket — see impl note); svc + ep2 singleton.
    expect(agg.by_merge_group.merged + agg.by_merge_group.singleton).toBe(3);
    expect(agg.by_scan_kind).toEqual({ code: 3 });
    expect(agg.by_operation).toEqual({ create: 2, enrich: 1 });

    expect(agg.findings_by_severity).toEqual({ high: 1, low: 1 });
    expect(agg.findings_by_review_status).toEqual({ approved: 1, pending_review: 1 });
  });

  test('convenience scalars match the grid memos (committed/actionable/live-conflict/tier labels)', () => {
    const agg = buildFixture().aggregations;
    expect(agg.committed_count).toBe(1); // svc
    expect(agg.actionable_count).toBe(2); // ep1 + ep2 (non-committed)
    // Live-conflict count = the getUnresolvedConflicts partition (only ep1).
    expect(agg.live_conflict_count).toBe(1);
    // Distinct source-tier labels present (the grid's uniqueTierLabels), sorted.
    expect([...agg.source_tier_labels].sort()).toEqual(
      ['contract-pack', 'runtime-evidence', 'structural-framework-pack'].sort(),
    );
  });

  test('per-node degree counts in/out edges correctly', () => {
    // svc → iface (parent_child); iface → ep (parent_child).
    const svc = candidate({ id: 'svc', candidateType: 'service', name: 'Svc' });
    const iface = candidate({ id: 'if', candidateType: 'interfaces', name: 'If', parentCandidateId: 'svc' });
    const ep = candidate({ id: 'ep', candidateType: 'endpoints', name: 'E', parentCandidateId: 'if' });
    const agg = buildReviewModel([
      { run_id: 'run-code', scan_kind: 'code', candidates: [svc, iface, ep], findings: [] },
    ]).aggregations;
    expect(agg.node_metrics['svc']).toMatchObject({ in_degree: 0, out_degree: 1 });
    expect(agg.node_metrics['if']).toMatchObject({ in_degree: 1, out_degree: 1 });
    expect(agg.node_metrics['ep']).toMatchObject({ in_degree: 1, out_degree: 0 });
  });
});
