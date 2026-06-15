/**
 * FRONTEND MIRROR unit tests for `resolveBulkActionSet`
 * (`frontend/src/components/Discovery/resolveBulkActionSet.ts`).
 *
 * Spec: 2026-06-05-reject-cascade-correctness (Task Groups 2 + 3). The gateway home
 * is the CANONICAL copy; this file is the frontend half of the per-mirror
 * reject-only coverage and runs the IDENTICAL cases the gateway file
 * (`gateway/src/services/discovery/__tests__/resolveBulkActionSet.test.ts`) runs.
 * The `it` bodies are byte-for-byte identical to the gateway block; only the
 * fixtures differ in shape (the frontend `ReviewModel` node + aggregations carry a
 * few more required fields), and they build the SAME graph. The shared-fixture
 * PARITY test that diff-asserts identical OUTPUT across both copies is Task Group 4.
 *
 * No frontend resolver test existed before this spec (requirements Q5); this is
 * the new file the mirror's exclusivity + relationship-surfacing logic is guarded by.
 *
 * Group 3 (relationship surfacing + marking) deliberately ADDS the referencing
 * relationship-row candidates to the resolved REJECT set, so the Group-2
 * exclusivity assertions focus on NODE membership (via `isRelationshipRow` /
 * `nodeIdsOf`) and the relationship rows themselves are asserted in the Group-3
 * block -- identical to the gateway home.
 */

import { resolveBulkActionSet } from './resolveBulkActionSet';
import type {
  ReviewModel,
  ReviewModelBlastRadiusEntry,
  ReviewModelEdge,
  ReviewModelNode,
} from '../../api/discoveryApi';

// ---------------------------------------------------------------------------
// Fixtures (frontend `ReviewModel` shape; same graphs as the gateway file)
// ---------------------------------------------------------------------------

/** A minimal but type-complete frontend review-model node (id + persisted status). */
function node(id: string, review_status = 'pending_review'): ReviewModelNode {
  return {
    id,
    review_status,
    committed: false,
    conflict_state: { has_live_conflict: false },
  };
}

/** Whole-run aggregation scalars (only the required fields + the two totals). */
function aggregations(total_candidates: number, total_findings: number) {
  return {
    total_candidates,
    total_findings,
    committed_count: 0,
    actionable_count: total_candidates,
    live_conflict_count: 0,
  };
}

/**
 * The relationship-row ids the Group-3 surfacing legitimately ADDS to a reject set
 * over the fixtures below (every `rel-*` / `mv-*` id is a relationship-ROW
 * candidate, never a node). The Group-2 node assertions filter these out so they
 * keep testing exclusivity; the rows are asserted in Group 3.
 */
const isRelationshipRow = (id: string): boolean => /^(rel-|mv-)/.test(id);
const nodeIdsOf = (r: ReturnType<typeof resolveBulkActionSet>): string[] =>
  r.candidates.map((c) => c.candidate_id).filter((id) => !isRelationshipRow(id));

/**
 * Shared-entity fixture (the gap-1 case). A `logical_data_entity` `ent` is bound
 * by TWO endpoints `ep1` + `ep2` via `endpoint_data_effects`, and `ent` owns an
 * attribute `attr` via `parent_child`:
 *
 *   ep1 --endpoint_data_effects--> ent --parent_child--> attr
 *   ep2 --endpoint_data_effects--> ent
 *
 * `blast_radius` is the FULL downward transitive closure per node (exactly what
 * discovery-service's `downwardClosure` emits): ep1/ep2 each reach `ent` (its own
 * in-edge) AND `attr` (tagged predecessor `ent`). The in-adjacency `edges` carry
 * both endpoint->ent references so the resolver can ask "are ALL of ent's
 * referencers rejected?". `nodes` optionally seed the already-persisted-rejected
 * half (default all `pending_review`).
 */
function buildSharedEntityModel(
  overrides: { ep2Status?: string } = {},
): ReviewModel {
  const blast_radius: ReviewModelBlastRadiusEntry[] = [
    {
      candidate_id: 'ep1',
      dependents: [
        { dependent_id: 'ent', via_edge_kind: 'endpoint_data_effects', via_predecessor_id: 'ep1' },
        { dependent_id: 'attr', via_edge_kind: 'parent_child', via_predecessor_id: 'ent' },
      ],
      would_be_orphaned_parent_ids: [],
    },
    {
      candidate_id: 'ep2',
      dependents: [
        { dependent_id: 'ent', via_edge_kind: 'endpoint_data_effects', via_predecessor_id: 'ep2' },
        { dependent_id: 'attr', via_edge_kind: 'parent_child', via_predecessor_id: 'ent' },
      ],
      would_be_orphaned_parent_ids: [],
    },
    {
      candidate_id: 'ent',
      dependents: [
        { dependent_id: 'attr', via_edge_kind: 'parent_child', via_predecessor_id: 'ent' },
      ],
      would_be_orphaned_parent_ids: [],
    },
    { candidate_id: 'attr', dependents: [], would_be_orphaned_parent_ids: [] },
  ];
  const edges: ReviewModelEdge[] = [
    { edge_kind: 'endpoint_data_effects', from_id: 'ep1', to_id: 'ent', relationship_candidate_id: 'rel-ep1-ent' },
    { edge_kind: 'endpoint_data_effects', from_id: 'ep2', to_id: 'ent', relationship_candidate_id: 'rel-ep2-ent' },
    { edge_kind: 'parent_child', from_id: 'ent', to_id: 'attr', relationship_candidate_id: 'attr' },
  ];
  const nodes: ReviewModelNode[] = [
    node('ep1'),
    node('ep2', overrides.ep2Status ?? 'pending_review'),
    node('ent'),
    node('attr'),
  ];
  return { nodes, aggregations: aggregations(4, 0), blast_radius, findings: [], edges };
}

/**
 * Peer-relationship fixture. A logical entity<->entity relationship
 * (`logical_data_entity_relationships`) `entA --> entB`, plus a PHYSICAL
 * entity<->entity instance on the SAME edge kind `phA --> phB` (the verified
 * physical symmetry: there is no separate `physical_data_entity_relationships`
 * kind -- physical entity relationships fold into `logical_data_entity_relationships`).
 * Rejecting one endpoint must NEVER pull the far entity into the reject set.
 */
function buildPeerRelationshipModel(): ReviewModel {
  const blast_radius: ReviewModelBlastRadiusEntry[] = [
    {
      candidate_id: 'entA',
      dependents: [
        { dependent_id: 'entB', via_edge_kind: 'logical_data_entity_relationships', via_predecessor_id: 'entA' },
      ],
      would_be_orphaned_parent_ids: [],
    },
    { candidate_id: 'entB', dependents: [], would_be_orphaned_parent_ids: [] },
    {
      candidate_id: 'phA',
      dependents: [
        { dependent_id: 'phB', via_edge_kind: 'logical_data_entity_relationships', via_predecessor_id: 'phA' },
      ],
      would_be_orphaned_parent_ids: [],
    },
    { candidate_id: 'phB', dependents: [], would_be_orphaned_parent_ids: [] },
  ];
  const edges: ReviewModelEdge[] = [
    { edge_kind: 'logical_data_entity_relationships', from_id: 'entA', to_id: 'entB', relationship_candidate_id: 'rel-AB' },
    { edge_kind: 'logical_data_entity_relationships', from_id: 'phA', to_id: 'phB', relationship_candidate_id: 'rel-phAB' },
  ];
  const nodes: ReviewModelNode[] = [node('entA'), node('entB'), node('phA'), node('phB')];
  return { nodes, aggregations: aggregations(4, 0), blast_radius, findings: [], edges };
}

/**
 * A cyclic OWNED-BY relationship graph: three services in a `data_movements`
 * cycle s1 -> s2 -> s3 -> s1. Each node has exactly ONE referencer of that kind
 * (its predecessor in the cycle), so seeding any one and rejecting drives the
 * whole cycle in -- the fixpoint must terminate (visited-set) and be deterministic.
 */
function buildCyclicRelationshipModel(): ReviewModel {
  const blast_radius: ReviewModelBlastRadiusEntry[] = [
    {
      candidate_id: 's1',
      dependents: [
        { dependent_id: 's2', via_edge_kind: 'data_movements', via_predecessor_id: 's1' },
        { dependent_id: 's3', via_edge_kind: 'data_movements', via_predecessor_id: 's2' },
      ],
      would_be_orphaned_parent_ids: [],
    },
    {
      candidate_id: 's2',
      dependents: [
        { dependent_id: 's3', via_edge_kind: 'data_movements', via_predecessor_id: 's2' },
        { dependent_id: 's1', via_edge_kind: 'data_movements', via_predecessor_id: 's3' },
      ],
      would_be_orphaned_parent_ids: [],
    },
    {
      candidate_id: 's3',
      dependents: [
        { dependent_id: 's1', via_edge_kind: 'data_movements', via_predecessor_id: 's3' },
        { dependent_id: 's2', via_edge_kind: 'data_movements', via_predecessor_id: 's1' },
      ],
      would_be_orphaned_parent_ids: [],
    },
  ];
  const edges: ReviewModelEdge[] = [
    { edge_kind: 'data_movements', from_id: 's1', to_id: 's2', relationship_candidate_id: 'mv-12' },
    { edge_kind: 'data_movements', from_id: 's2', to_id: 's3', relationship_candidate_id: 'mv-23' },
    { edge_kind: 'data_movements', from_id: 's3', to_id: 's1', relationship_candidate_id: 'mv-31' },
  ];
  const nodes: ReviewModelNode[] = [node('s1'), node('s2'), node('s3')];
  return { nodes, aggregations: aggregations(3, 0), blast_radius, findings: [], edges };
}

// ---------------------------------------------------------------------------
// Spec 2026-06-05-reject-cascade-correctness (Task Group 2): reject-only
// exclusivity in the cascade walk. IDENTICAL cases to the gateway home.
//
// These assertions test EXCLUSIVITY (which NODES enter/leave the reject set);
// the additive Group-3 relationship rows are filtered out via `isRelationshipRow`
// so the exclusivity intent is asserted independently of the marking (Group 3 is
// asserted in the next block).
// ---------------------------------------------------------------------------

describe('resolveBulkActionSet — reject-only exclusivity (Group 2)', () => {
  it('SHARED entity survives (with its attributes) when only ONE of its two referencing endpoints is rejected', () => {
    const model = buildSharedEntityModel();

    const result = resolveBulkActionSet({ seedCandidateIds: ['ep1'], action: 'rejected' }, model);

    const ids = nodeIdsOf(result);
    // Only the rejected endpoint is in the NODE set: `ent` has a surviving
    // referencer (ep2), so it stays OUT -- and `attr`, reachable only THROUGH the
    // surviving `ent`, stays out too.
    expect(ids).toEqual(['ep1']);
    expect(ids).not.toContain('ent');
    expect(ids).not.toContain('attr');
  });

  it('SHARED entity (and its attributes) is pulled in when ALL of its referencing endpoints are rejected', () => {
    const model = buildSharedEntityModel();

    const result = resolveBulkActionSet(
      { seedCandidateIds: ['ep1', 'ep2'], action: 'rejected' },
      model,
    );

    const ids = nodeIdsOf(result);
    // Both referencers rejected ⇒ the shared entity is exclusive to the reject set
    // and is pulled in, and its attribute cascades via parent_child.
    expect(new Set(ids)).toEqual(new Set(['ep1', 'ep2', 'ent', 'attr']));
    // `ent` is recorded as cascaded via the owned-by edge kind.
    const ent = result.candidates.find((c) => c.candidate_id === 'ent');
    expect(ent?.provenance).toBe('cascaded');
    expect(ent?.via_edge_kind).toBe('endpoint_data_effects');
    // `attr` cascaded via parent_child from `ent`.
    const attr = result.candidates.find((c) => c.candidate_id === 'attr');
    expect(attr?.via_edge_kind).toBe('parent_child');
    expect(attr?.via_predecessor_id).toBe('ent');
  });

  it('exclusivity union: an already-persisted `rejected` referencer (node review_status) counts, so rejecting the remaining endpoint pulls the shared entity in', () => {
    // ep2 is ALREADY rejected (persisted). Rejecting ep1 alone now makes ALL of
    // ent's referencers rejected (ep1 this action ∪ ep2 already-rejected).
    const model = buildSharedEntityModel({ ep2Status: 'rejected' });

    const result = resolveBulkActionSet({ seedCandidateIds: ['ep1'], action: 'rejected' }, model);

    const ids = nodeIdsOf(result);
    // ent + attr are pulled in via the union; ep2 is NOT re-added (it was not a
    // seed this action and is not reached as a dependent of ep1).
    expect(new Set(ids)).toEqual(new Set(['ep1', 'ent', 'attr']));
    expect(ids).not.toContain('ep2');
  });

  it('REJECT-ONLY: Approve over the SAME shared-entity fixture cascades fully (no exclusivity)', () => {
    const model = buildSharedEntityModel();

    const result = resolveBulkActionSet({ seedCandidateIds: ['ep1'], action: 'approved' }, model);

    // The pre-change cascade: ep1's full downward closure (ent + attr) is pulled
    // in regardless of the surviving ep2 -- exclusivity is reject-only. Approve
    // surfaces no relationship rows, so the whole candidate set is the three nodes.
    expect(new Set(result.candidates.map((c) => c.candidate_id))).toEqual(
      new Set(['ep1', 'ent', 'attr']),
    );
  });

  it('REJECT-ONLY: Defer over the SAME shared-entity fixture cascades fully (no exclusivity)', () => {
    const model = buildSharedEntityModel();

    const result = resolveBulkActionSet({ seedCandidateIds: ['ep1'], action: 'deferred' }, model);

    expect(new Set(result.candidates.map((c) => c.candidate_id))).toEqual(
      new Set(['ep1', 'ent', 'attr']),
    );
  });

  it('PEER rule: rejecting one endpoint of a logical_data_entity_relationships edge NEVER pulls the far entity (logical AND physical, same edge kind)', () => {
    const model = buildPeerRelationshipModel();

    // Logical peer: reject entA ⇒ entB must NOT be pulled in.
    const logical = resolveBulkActionSet({ seedCandidateIds: ['entA'], action: 'rejected' }, model);
    expect(nodeIdsOf(logical)).toEqual(['entA']);
    expect(nodeIdsOf(logical)).not.toContain('entB');

    // Physical peer (same edge kind -- the verified physical symmetry): reject phA
    // ⇒ phB must NOT be pulled in.
    const physical = resolveBulkActionSet({ seedCandidateIds: ['phA'], action: 'rejected' }, model);
    expect(nodeIdsOf(physical)).toEqual(['phA']);
    expect(nodeIdsOf(physical)).not.toContain('phB');
  });

  it('is cycle-safe over a cyclic OWNED-BY relationship graph: terminates with a stable, deterministic reject set', () => {
    const model = buildCyclicRelationshipModel();

    // Seeding s1 drives the whole data_movements cycle in (each node's single
    // referencer becomes rejected in turn); the fixpoint must terminate.
    const result = resolveBulkActionSet({ seedCandidateIds: ['s1'], action: 'rejected' }, model);

    expect(new Set(nodeIdsOf(result))).toEqual(new Set(['s1', 's2', 's3']));
    // total_candidates now also counts the three surfaced data_movements rows
    // (mv-12/mv-23/mv-31) -- the three cycle nodes + their three relationship rows.
    expect(result.counts.total_candidates).toBe(6);
    // Determinism: a second identical call yields structurally-equal output.
    const again = resolveBulkActionSet({ seedCandidateIds: ['s1'], action: 'rejected' }, model);
    expect(again).toEqual(result);
  });

  it('degrades to the pre-change cascade when `edges`/`nodes` are ABSENT (absence-tolerant, no throw)', () => {
    // A model with the immediate-chain blast_radius but NO edges/nodes -- some
    // callers omit them. With no in-adjacency, exclusivity is a no-op and reject
    // cascades exactly as before (seed -> depA -> depB). No edges => Group 3
    // surfaces nothing either.
    const model = {
      nodes: [],
      aggregations: aggregations(3, 0),
      blast_radius: [
        {
          candidate_id: 'seed',
          dependents: [
            { dependent_id: 'depA', via_edge_kind: 'parent_child', via_predecessor_id: 'seed' },
          ],
          would_be_orphaned_parent_ids: [],
        },
        {
          candidate_id: 'depA',
          dependents: [
            { dependent_id: 'depB', via_edge_kind: 'endpoint_data_effects', via_predecessor_id: 'depA' },
          ],
          would_be_orphaned_parent_ids: [],
        },
        { candidate_id: 'depB', dependents: [], would_be_orphaned_parent_ids: [] },
      ],
      findings: [],
    } as unknown as ReviewModel; // edges deliberately omitted

    const result = resolveBulkActionSet({ seedCandidateIds: ['seed'], action: 'rejected' }, model);

    expect(result.candidates.map((c) => c.candidate_id)).toEqual(['seed', 'depA', 'depB']);
  });
});

// ---------------------------------------------------------------------------
// Spec 2026-06-05-reject-cascade-correctness (Task Group 3): reject-only
// relationship surfacing + marking. IDENTICAL cases to the gateway home.
// ---------------------------------------------------------------------------

describe('resolveBulkActionSet — reject-only relationship surfacing + marking (Group 3)', () => {
  it('surfaces + marks every rejected node’s referencing relationship-row candidates, and the "+N relationships dropped" count is correct', () => {
    // Reject BOTH endpoints of the shared entity: `ent` is pulled in (all its
    // referencers rejected), so the relationship ROWS that bind it -- the two
    // `endpoint_data_effects` rows `rel-ep1-ent` + `rel-ep2-ent` -- must be
    // surfaced as cascade members and included in the flat candidate-id set. The
    // `parent_child` ent->attr edge is NOT a relationship-row kind, so its
    // `relationship_candidate_id` (`attr`, the child) is NOT surfaced as a
    // relationship row (attr is already a node in the set via the parent_child
    // cascade).
    const model = buildSharedEntityModel();

    const result = resolveBulkActionSet(
      { seedCandidateIds: ['ep1', 'ep2'], action: 'rejected' },
      model,
    );

    const ids = result.candidates.map((c) => c.candidate_id);
    // The four nodes (ep1, ep2, ent, attr) PLUS the two referencing relationship
    // rows that bound the rejected `ent`.
    expect(new Set(ids)).toEqual(
      new Set(['ep1', 'ep2', 'ent', 'attr', 'rel-ep1-ent', 'rel-ep2-ent']),
    );
    // Both relationship-row candidate ids are in the FLAT candidate-id set the
    // resolver yields (the ids the atomic cascade endpoint persists `rejected`).
    const flatCandidateIds = result.candidates.map((c) => c.candidate_id);
    expect(flatCandidateIds).toContain('rel-ep1-ent');
    expect(flatCandidateIds).toContain('rel-ep2-ent');
    // Each surfaced relationship row is a CASCADE member tagged with a rejected
    // node it referenced + the relationship-row edge kind. (`rel-ep1-ent` is
    // attributed to `ep1` -- the first rejected node the edge is incident to in
    // resolution order -- which is one of the edge's two rejected endpoints.)
    const relRow = result.candidates.find((c) => c.candidate_id === 'rel-ep1-ent');
    expect(relRow?.provenance).toBe('cascaded');
    expect(relRow?.via_edge_kind).toBe('endpoint_data_effects');
    expect(relRow?.via_predecessor_id).toBe('ep1');
    // "+N relationships dropped" = the count of surfaced relationship-row
    // cascade members; here exactly the two endpoint_data_effects rows.
    const relationshipRowsDropped = result.candidates.filter(
      (c) =>
        c.provenance === 'cascaded' &&
        (c.candidate_id === 'rel-ep1-ent' || c.candidate_id === 'rel-ep2-ent'),
    ).length;
    expect(relationshipRowsDropped).toBe(2);
  });

  it('PEER row is surfaced + marked when one endpoint is rejected even though the far entity SURVIVES (logical AND physical, same edge kind)', () => {
    const model = buildPeerRelationshipModel();

    // Logical peer: reject entA. entB (the far entity) must NOT be in the set, but
    // the relationship ROW `rel-AB` MUST be surfaced + marked rejected.
    const logical = resolveBulkActionSet({ seedCandidateIds: ['entA'], action: 'rejected' }, model);
    const logicalIds = logical.candidates.map((c) => c.candidate_id);
    expect(logicalIds).toContain('rel-AB'); // the row candidate is marked
    expect(logicalIds).not.toContain('entB'); // the far entity survives
    expect(new Set(logicalIds)).toEqual(new Set(['entA', 'rel-AB']));
    const logicalRow = logical.candidates.find((c) => c.candidate_id === 'rel-AB');
    expect(logicalRow?.provenance).toBe('cascaded');
    expect(logicalRow?.via_edge_kind).toBe('logical_data_entity_relationships');

    // Physical peer (same edge kind -- the verified physical symmetry): reject phA.
    // phB survives; the relationship ROW `rel-phAB` is surfaced + marked.
    const physical = resolveBulkActionSet({ seedCandidateIds: ['phA'], action: 'rejected' }, model);
    const physicalIds = physical.candidates.map((c) => c.candidate_id);
    expect(physicalIds).toContain('rel-phAB');
    expect(physicalIds).not.toContain('phB');
    expect(new Set(physicalIds)).toEqual(new Set(['phA', 'rel-phAB']));
  });

  it('REJECT-ONLY: Approve over the SAME shared-entity fixture surfaces NO relationship rows', () => {
    const model = buildSharedEntityModel();

    const result = resolveBulkActionSet({ seedCandidateIds: ['ep1', 'ep2'], action: 'approved' }, model);

    const ids = result.candidates.map((c) => c.candidate_id);
    // The pre-change cascade only (nodes); NO relationship-row candidate ids.
    expect(ids).not.toContain('rel-ep1-ent');
    expect(ids).not.toContain('rel-ep2-ent');
    expect(new Set(ids)).toEqual(new Set(['ep1', 'ep2', 'ent', 'attr']));
  });

  it('REJECT-ONLY: Defer over the SAME peer fixture surfaces NO relationship rows', () => {
    const model = buildPeerRelationshipModel();

    const result = resolveBulkActionSet({ seedCandidateIds: ['entA'], action: 'deferred' }, model);

    const ids = result.candidates.map((c) => c.candidate_id);
    // Defer keeps the pre-change cascade -- the peer edge adds entB as a plain
    // dependent (no exclusivity, no surfacing); NO `rel-AB` row candidate.
    expect(ids).not.toContain('rel-AB');
    expect(new Set(ids)).toEqual(new Set(['entA', 'entB']));
  });

  it('skips an edge with an absent / empty relationship_candidate_id (guarded, no phantom candidate)', () => {
    // A single owned-by edge ep->ent whose relationship_candidate_id is EMPTY:
    // rejecting ep pulls ent in (sole referencer), but the empty-id edge must NOT
    // surface a phantom relationship-row candidate.
    const model: ReviewModel = {
      nodes: [node('ep'), node('ent')],
      aggregations: aggregations(2, 0),
      blast_radius: [
        {
          candidate_id: 'ep',
          dependents: [
            { dependent_id: 'ent', via_edge_kind: 'endpoint_data_effects', via_predecessor_id: 'ep' },
          ],
          would_be_orphaned_parent_ids: [],
        },
        { candidate_id: 'ent', dependents: [], would_be_orphaned_parent_ids: [] },
      ],
      findings: [],
      edges: [
        { edge_kind: 'endpoint_data_effects', from_id: 'ep', to_id: 'ent', relationship_candidate_id: '' },
      ],
    };

    const result = resolveBulkActionSet({ seedCandidateIds: ['ep'], action: 'rejected' }, model);

    // ep + ent only; the empty relationship_candidate_id contributes NOTHING.
    expect(new Set(result.candidates.map((c) => c.candidate_id))).toEqual(new Set(['ep', 'ent']));
    expect(result.candidates.every((c) => c.candidate_id !== '')).toBe(true);
  });
});
