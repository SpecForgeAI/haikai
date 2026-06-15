/**
 * Task Group 2 — Surface-Only Blast-Radius computation.
 *
 * Focused tests:
 *   (a) downward transitive closure over a multi-hop chain (service → interface
 *       → endpoint → logical entity → attribute) returns the correct dependent
 *       set;
 *   (b) each dependent records WHICH edge pulled it in (edge_kind + immediate
 *       predecessor);
 *   (c) a relationship CYCLE terminates (visited-set), no infinite loop;
 *   (d) the would-be-orphan advisory fires ONLY when ALL of a parent's children
 *       are rejected, and the parent is NEVER added to the hard downward radius;
 *   (e) status is NEVER mutated (the model is read-only).
 *
 * Driven through the full `buildReviewModel` so the closure is exercised against
 * the real edge set.
 */

import { buildReviewModel } from '../buildReviewModel';
import type { ScanRunInput } from '../types';
import type { DiscoveryCandidate } from '../../../types/candidate';

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

function codeRun(candidates: DiscoveryCandidate[]): ScanRunInput {
  return { run_id: 'run-code', scan_kind: 'code', candidates, findings: [] };
}

/** The dependents of a given candidate in the computed model. */
function radiusFor(model: ReturnType<typeof buildReviewModel>, id: string) {
  return model.blast_radius.find((b) => b.candidate_id === id);
}

// ===========================================================================
// (a) + (b) Multi-hop downward closure + per-dependent edge provenance
// ===========================================================================

describe('Group 2 — downward transitive closure', () => {
  // service ──parent_child──▶ interface ──parent_child──▶ endpoint
  //   endpoint ──endpoint_data_effects──▶ logical entity
  //   logical entity ──parent_child──▶ logical attribute
  function buildChain() {
    const svc = candidate({ id: 'svc', candidateType: 'service', name: 'OrderService' });
    const iface = candidate({
      id: 'iface',
      candidateType: 'interfaces',
      name: 'OrderController',
      parentCandidateId: 'svc',
    });
    const ep = candidate({
      id: 'ep',
      candidateType: 'endpoints',
      name: 'GET /orders',
      parentCandidateId: 'iface',
    });
    const lde = candidate({ id: 'lde', candidateType: 'logical_data_entities', name: 'OrderDto' });
    const attr = candidate({
      id: 'attr',
      candidateType: 'logical_data_attributes',
      name: 'total',
      parentCandidateId: 'lde',
    });
    const effect = candidate({
      id: 'eff',
      candidateType: 'endpoint_data_effects',
      name: 'GET /orders → OrderDto (read)',
      parentCandidateId: 'ep',
      data: { endpointName: 'GET /orders', dataEntityName: 'OrderDto' },
    });
    return buildReviewModel([codeRun([svc, iface, ep, lde, attr, effect])]);
  }

  test('rejecting the service reaches interface, endpoint, logical entity, and attribute', () => {
    const model = buildChain();
    const r = radiusFor(model, 'svc');
    expect(r).toBeDefined();
    const ids = new Set(r!.dependents.map((d) => d.dependent_id));
    expect(ids).toEqual(new Set(['iface', 'ep', 'lde', 'attr']));
    // The candidate itself is never in its own dependent set.
    expect(ids.has('svc')).toBe(false);
  });

  test('each dependent records the edge_kind + immediate predecessor that pulled it in', () => {
    const model = buildChain();
    const r = radiusFor(model, 'svc')!;
    const byDep = new Map(r.dependents.map((d) => [d.dependent_id, d]));
    expect(byDep.get('iface')).toMatchObject({ via_edge_kind: 'parent_child', via_predecessor_id: 'svc' });
    expect(byDep.get('ep')).toMatchObject({ via_edge_kind: 'parent_child', via_predecessor_id: 'iface' });
    expect(byDep.get('lde')).toMatchObject({
      via_edge_kind: 'endpoint_data_effects',
      via_predecessor_id: 'ep',
    });
    expect(byDep.get('attr')).toMatchObject({ via_edge_kind: 'parent_child', via_predecessor_id: 'lde' });
  });

  test('node_metrics records blast_radius_size matching the dependent count', () => {
    const model = buildChain();
    expect(model.aggregations.node_metrics['svc'].blast_radius_size).toBe(4);
    expect(model.aggregations.node_metrics['attr'].blast_radius_size).toBe(0);
  });
});

// ===========================================================================
// (c) Cycle termination
// ===========================================================================

describe('Group 2 — cycle safety', () => {
  test('a relationship cycle terminates (visited-set) and excludes the start node', () => {
    // A → B → C → A via logical_data_entity_relationships (logical-to-logical).
    const a = candidate({ id: 'A', candidateType: 'logical_data_entities', name: 'A' });
    const b = candidate({ id: 'B', candidateType: 'logical_data_entities', name: 'B' });
    const c = candidate({ id: 'C', candidateType: 'logical_data_entities', name: 'C' });
    const ab = candidate({
      id: 'ab',
      candidateType: 'logical_data_entity_relationships',
      name: 'A → B',
      data: { sourceEntity: 'A', targetEntity: 'B' },
    });
    const bc = candidate({
      id: 'bc',
      candidateType: 'logical_data_entity_relationships',
      name: 'B → C',
      data: { sourceEntity: 'B', targetEntity: 'C' },
    });
    const ca = candidate({
      id: 'ca',
      candidateType: 'logical_data_entity_relationships',
      name: 'C → A',
      data: { sourceEntity: 'C', targetEntity: 'A' },
    });

    const model = buildReviewModel([codeRun([a, b, c, ab, bc, ca])]);
    const r = radiusFor(model, 'A')!;
    const ids = new Set(r.dependents.map((d) => d.dependent_id));
    // B and C are reachable; A is excluded (start node), even though the cycle
    // returns to A — the visited-set prevents re-adding it / looping forever.
    expect(ids).toEqual(new Set(['B', 'C']));
  });
});

// ===========================================================================
// (d) Would-be-orphan advisory
// ===========================================================================

describe('Group 2 — would-be-orphan advisory', () => {
  test('fires only when ALL of a parent\'s children are rejected; parent NOT in hard radius', () => {
    // parent has two children; only one is rejected ⇒ NOT orphaned.
    const parent = candidate({ id: 'p', candidateType: 'logical_data_entities', name: 'P' });
    const c1 = candidate({
      id: 'c1',
      candidateType: 'logical_data_attributes',
      name: 'c1',
      parentCandidateId: 'p',
      reviewStatus: 'rejected',
    });
    const c2 = candidate({
      id: 'c2',
      candidateType: 'logical_data_attributes',
      name: 'c2',
      parentCandidateId: 'p',
      status: 'pending_review',
    });
    const partial = buildReviewModel([codeRun([parent, c1, c2])]);
    // Considering c1's hypothetical reject: parent P still has c2 ⇒ not orphaned.
    expect(radiusFor(partial, 'c1')!.would_be_orphaned_parent_ids).toEqual([]);

    // Now BOTH children rejected ⇒ rejecting c1 (its sibling c2 already rejected)
    // leaves P with all children rejected ⇒ P is advisory would-be-orphaned.
    const c2b = candidate({
      id: 'c2',
      candidateType: 'logical_data_attributes',
      name: 'c2',
      parentCandidateId: 'p',
      reviewStatus: 'rejected',
    });
    const allRejected = buildReviewModel([codeRun([parent, c1, c2b])]);
    const r = radiusFor(allRejected, 'c1')!;
    expect(r.would_be_orphaned_parent_ids).toEqual(['p']);
    // The parent is NEVER part of the hard downward radius.
    expect(r.dependents.map((d) => d.dependent_id)).not.toContain('p');
  });
});

// ===========================================================================
// (e) Status is never mutated
// ===========================================================================

describe('Group 2 — read-only (status never mutated)', () => {
  test('input candidate.status is unchanged after building the model', () => {
    const svc = candidate({ id: 's', candidateType: 'service', name: 'S', status: 'pending_review' });
    const child = candidate({
      id: 'k',
      candidateType: 'interfaces',
      name: 'K',
      parentCandidateId: 's',
      status: 'pending_review',
    });
    buildReviewModel([codeRun([svc, child])]);
    expect(svc.status).toBe('pending_review');
    expect(child.status).toBe('pending_review');
  });
});
