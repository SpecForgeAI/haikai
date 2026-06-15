/**
 * Unit + wire-shape CONTRACT tests for `resolveBulkActionSet` -- the shared PURE
 * cascade-set resolver (Spec 2, Task Group 4).
 *
 * Spec: 2026-06-02-cascade-aware-bulk-review-and-reject-suppression
 * (Resolved Decision 8 -- ONE pure function consumed by both the grid's confirm
 * modal and Spec 3's server-side coordinator).
 *
 * Two concerns are covered:
 *   1. Resolver correctness (the unit tests): seed + transitive dependents +
 *      linked findings; cascade provenance (`via_edge_kind` + `via_predecessor_id`);
 *      net counts vs `blast_radius` / `aggregations`; cycle-safety; seed-only;
 *      and the NON-NODE (relationship-row / edge) seed surviving as a direct
 *      candidate (the "Approve Filtered (26)" -> 0 bug fix).
 *   2. Wire-shape parity (the contract test): the snake_case `ReviewModel` fields
 *      the resolver consumes are pinned via `REVIEW_MODEL_WIRE_FIELDS` against a
 *      built sample, mirroring `scopeRefType.contractWithGateway.test.ts` so the
 *      gateway home and the frontend Group-5 MIRROR cannot silently diverge.
 *      Spec 2026-06-05-reject-cascade-correctness (Task Group 1) extends this to
 *      pin the new top-level `edges` (the raw in-adjacency graph) + `nodes`
 *      (each node's persisted `review_status`) the reject-exclusivity walk reads.
 *
 * A third concern is added by Spec 2026-06-05-reject-cascade-correctness (Task
 * Group 2): REJECT-ONLY exclusivity in the cascade walk -- a shared entity with a
 * surviving referencer SURVIVES; a peer (entity<->entity) relationship never pulls
 * the far entity; Approve/Defer are unchanged; the walk stays cycle-safe. The
 * SAME cases run on the frontend mirror (a NEW file beside the frontend resolver),
 * byte-for-byte.
 *
 * A fourth concern is added by Spec 2026-06-05-reject-cascade-correctness (Task
 * Group 3): REJECT-ONLY relationship surfacing + marking -- for every node in the
 * FINAL reject set, the referencing relationship-ROW candidates (via
 * `relationship_candidate_id`) are surfaced as cascade members + flow into the flat
 * candidate-id set the resolver yields (so they are persisted `rejected`). Peer
 * rows are surfaced even when the far entity survives; Approve/Defer add no
 * relationship marking. The SAME cases run on the frontend mirror.
 *
 * NOTE (Group 3 interaction with the pre-existing Group 1/2 assertions): Group 3
 * deliberately ADDS the referencing relationship-row candidates to the resolved
 * REJECT set. Several Group 1/2 fixtures (`buildAcyclicModel`,
 * `buildSharedEntityModel`, `buildCyclicRelationshipModel`) contain
 * relationship-row edges incident to rejected nodes, so a reject over them now
 * also surfaces those rows -- the Group-2 EXCLUSIVITY logic is unchanged (the far
 * entity / shared entity still resolves identically); only the additive Group-3
 * relationship marking appears. The Group 1/2 reject assertions below were updated
 * to focus on their original concern (the NODE/finding membership) and stay
 * tolerant of the additive relationship rows (`isRelationshipRow` filters them);
 * the relationship rows themselves are asserted in the Group 3 block.
 */

import { resolveBulkActionSet } from '../resolveBulkActionSet';
import {
  REVIEW_MODEL_WIRE_FIELDS,
  POINTS_WRAPPER_TYPES,
  type BlastRadiusEntry,
  type ReviewFindingNode,
  type ReviewModelEdge,
  type ReviewModelNode,
  type ReviewModelWire,
} from '../reviewModelWire';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * The relationship-row ids the Group-3 surfacing legitimately ADDS to a reject set
 * over the fixtures below (every `rel-*` / `mv-*` id is a relationship-ROW
 * candidate, never a node). The Group 1/2 node/finding assertions filter these out
 * so they keep testing their original concern; the rows are asserted in Group 3.
 */
const isRelationshipRow = (id: string): boolean => /^(rel-|mv-)/.test(id);

/**
 * A small acyclic model:
 *
 *   seed --parent_child--> depA --endpoint_data_effects--> depB
 *   sibling   (no dependents, not reachable from seed)
 *
 * Findings:
 *   f-seed  links [seed]
 *   f-depB  links [depB]
 *   f-multi links [sibling, depA]   (pulled in via depA when seed acts)
 *   f-none  links [sibling]         (NOT pulled in by a seed-only-on-`seed` act)
 *   f-orphan links []               (never pulled in)
 *
 * The raw `edges` mirror the two cascade edges in `blast_radius` (each carrying a
 * `relationship_candidate_id`), and `nodes` carry each node's persisted
 * `review_status` (all `pending_review` here) -- the Spec
 * 2026-06-05-reject-cascade-correctness in-adjacency + already-rejected seeds the
 * reject-exclusivity walk (Groups 2-3) reads.
 */
function buildAcyclicModel(): ReviewModelWire {
  const blast_radius: BlastRadiusEntry[] = [
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
        {
          dependent_id: 'depB',
          via_edge_kind: 'endpoint_data_effects',
          via_predecessor_id: 'depA',
        },
      ],
      would_be_orphaned_parent_ids: [],
    },
    { candidate_id: 'depB', dependents: [], would_be_orphaned_parent_ids: [] },
    { candidate_id: 'sibling', dependents: [], would_be_orphaned_parent_ids: [] },
  ];

  const findings: ReviewFindingNode[] = [
    { id: 'f-seed', candidate_link_ids: ['seed'] },
    { id: 'f-depB', candidate_link_ids: ['depB'] },
    { id: 'f-multi', candidate_link_ids: ['sibling', 'depA'] },
    { id: 'f-none', candidate_link_ids: ['sibling'] },
    { id: 'f-orphan', candidate_link_ids: [] },
  ];

  // Raw in-adjacency graph (mirrors the two cascade edges above).
  const edges: ReviewModelEdge[] = [
    {
      edge_kind: 'parent_child',
      from_id: 'seed',
      to_id: 'depA',
      relationship_candidate_id: 'depA',
    },
    {
      edge_kind: 'endpoint_data_effects',
      from_id: 'depA',
      to_id: 'depB',
      relationship_candidate_id: 'rel-eff-depA-depB',
    },
  ];

  // Minimal per-node view (id + persisted review_status).
  const nodes: ReviewModelNode[] = [
    { id: 'seed', review_status: 'pending_review' },
    { id: 'depA', review_status: 'pending_review' },
    { id: 'depB', review_status: 'pending_review' },
    { id: 'sibling', review_status: 'pending_review' },
  ];

  return {
    blast_radius,
    findings,
    aggregations: { total_candidates: 4, total_findings: 5 },
    edges,
    nodes,
  };
}

/**
 * A CYCLIC model: a -> b -> c -> a (each via parent_child). A naive recursive
 * walk would loop forever; the resolver's visited-set must terminate and return
 * each node exactly once.
 */
function buildCyclicModel(): ReviewModelWire {
  const blast_radius: BlastRadiusEntry[] = [
    {
      candidate_id: 'a',
      dependents: [{ dependent_id: 'b', via_edge_kind: 'parent_child', via_predecessor_id: 'a' }],
      would_be_orphaned_parent_ids: [],
    },
    {
      candidate_id: 'b',
      dependents: [{ dependent_id: 'c', via_edge_kind: 'parent_child', via_predecessor_id: 'b' }],
      would_be_orphaned_parent_ids: [],
    },
    {
      candidate_id: 'c',
      dependents: [{ dependent_id: 'a', via_edge_kind: 'parent_child', via_predecessor_id: 'c' }],
      would_be_orphaned_parent_ids: [],
    },
  ];
  const edges: ReviewModelEdge[] = [
    { edge_kind: 'parent_child', from_id: 'a', to_id: 'b', relationship_candidate_id: 'b' },
    { edge_kind: 'parent_child', from_id: 'b', to_id: 'c', relationship_candidate_id: 'c' },
    { edge_kind: 'parent_child', from_id: 'c', to_id: 'a', relationship_candidate_id: 'a' },
  ];
  const nodes: ReviewModelNode[] = [
    { id: 'a', review_status: 'pending_review' },
    { id: 'b', review_status: 'pending_review' },
    { id: 'c', review_status: 'pending_review' },
  ];
  return {
    blast_radius,
    findings: [],
    aggregations: { total_candidates: 3, total_findings: 0 },
    edges,
    nodes,
  };
}

// ---------------------------------------------------------------------------
// Spec 2026-06-05-reject-cascade-correctness (Task Group 2) fixtures
// ---------------------------------------------------------------------------

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
): ReviewModelWire {
  const blast_radius: BlastRadiusEntry[] = [
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
    { id: 'ep1', review_status: 'pending_review' },
    { id: 'ep2', review_status: overrides.ep2Status ?? 'pending_review' },
    { id: 'ent', review_status: 'pending_review' },
    { id: 'attr', review_status: 'pending_review' },
  ];
  return {
    blast_radius,
    findings: [],
    aggregations: { total_candidates: 4, total_findings: 0 },
    edges,
    nodes,
  };
}

/**
 * Peer-relationship fixture. A logical entity<->entity relationship
 * (`logical_data_entity_relationships`) `entA --> entB`, plus a PHYSICAL
 * entity<->entity instance on the SAME edge kind `phA --> phB` (the verified
 * physical symmetry: there is no separate `physical_data_entity_relationships`
 * kind -- physical entity relationships fold into `logical_data_entity_relationships`).
 * Rejecting one endpoint must NEVER pull the far entity into the reject set.
 */
function buildPeerRelationshipModel(): ReviewModelWire {
  const blast_radius: BlastRadiusEntry[] = [
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
  const nodes: ReviewModelNode[] = [
    { id: 'entA', review_status: 'pending_review' },
    { id: 'entB', review_status: 'pending_review' },
    { id: 'phA', review_status: 'pending_review' },
    { id: 'phB', review_status: 'pending_review' },
  ];
  return {
    blast_radius,
    findings: [],
    aggregations: { total_candidates: 4, total_findings: 0 },
    edges,
    nodes,
  };
}

/**
 * A cyclic OWNED-BY relationship graph: three services in a `data_movements`
 * cycle s1 -> s2 -> s3 -> s1. Each node has exactly ONE referencer of that kind
 * (its predecessor in the cycle), so seeding any one and rejecting drives the
 * whole cycle in -- the fixpoint must terminate (visited-set) and be deterministic.
 */
function buildCyclicRelationshipModel(): ReviewModelWire {
  const blast_radius: BlastRadiusEntry[] = [
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
  const nodes: ReviewModelNode[] = [
    { id: 's1', review_status: 'pending_review' },
    { id: 's2', review_status: 'pending_review' },
    { id: 's3', review_status: 'pending_review' },
  ];
  return {
    blast_radius,
    findings: [],
    aggregations: { total_candidates: 3, total_findings: 0 },
    edges,
    nodes,
  };
}

// ---------------------------------------------------------------------------
// 1. Resolver correctness
// ---------------------------------------------------------------------------

describe('resolveBulkActionSet — cascade resolution', () => {
  it('resolves seed + transitive dependents + each touched candidate’s linked findings', () => {
    const model = buildAcyclicModel();

    const result = resolveBulkActionSet({ seedCandidateIds: ['seed'], action: 'rejected' }, model);

    // seed -> depA -> depB (transitive); `sibling` is unreachable. (Group 3 also
    // surfaces the `endpoint_data_effects` row depA->depB referencing the rejected
    // depB -- filtered out here so this stays a pure node-cascade assertion.)
    const candidateIds = result.candidates
      .map((c) => c.candidate_id)
      .filter((id) => !isRelationshipRow(id));
    expect(candidateIds).toEqual(['seed', 'depA', 'depB']);
    expect(candidateIds).not.toContain('sibling');

    // Linked findings of the three touched candidates: f-seed (seed),
    // f-depB (depB), f-multi (via depA). f-none links only `sibling`; f-orphan
    // links nothing.
    const findingIds = result.findings.map((f) => f.finding_id).sort();
    expect(findingIds).toEqual(['f-depB', 'f-multi', 'f-seed']);
    expect(findingIds).not.toContain('f-none');
    expect(findingIds).not.toContain('f-orphan');

    // The chosen action is echoed.
    expect(result.action).toBe('rejected');
  });

  it('records cascade provenance (via_edge_kind + via_predecessor_id, seed vs cascaded) per item', () => {
    const model = buildAcyclicModel();

    const result = resolveBulkActionSet({ seedCandidateIds: ['seed'], action: 'deferred' }, model);

    const byId = new Map(result.candidates.map((c) => [c.candidate_id, c]));

    // Seed has no edge provenance.
    expect(byId.get('seed')).toMatchObject({
      provenance: 'seed',
      via_edge_kind: null,
      via_predecessor_id: null,
    });
    // depA pulled in from seed via parent_child.
    expect(byId.get('depA')).toMatchObject({
      provenance: 'cascaded',
      via_edge_kind: 'parent_child',
      via_predecessor_id: 'seed',
    });
    // depB pulled in from depA via endpoint_data_effects.
    expect(byId.get('depB')).toMatchObject({
      provenance: 'cascaded',
      via_edge_kind: 'endpoint_data_effects',
      via_predecessor_id: 'depA',
    });

    // Finding provenance: f-multi was pulled in via depA (the touched candidate
    // in its link list), NOT via the untouched `sibling`.
    const fMulti = result.findings.find((f) => f.finding_id === 'f-multi');
    expect(fMulti?.via_candidate_id).toBe('depA');
  });

  it('derives net counts that match the resolved set and the aggregations scalars', () => {
    const model = buildAcyclicModel();

    const result = resolveBulkActionSet({ seedCandidateIds: ['seed'], action: 'approved' }, model);

    expect(result.counts).toEqual({
      total_candidates: 3, // seed + depA + depB
      seed_candidates: 1,
      cascaded_candidates: 2,
      total_findings: 3, // f-seed + f-depB + f-multi
      run_total_candidates: 4, // from aggregations.total_candidates
      run_total_findings: 5, // from aggregations.total_findings
    });
    // Internal consistency: counts agree with the arrays the helper returned.
    expect(result.counts.total_candidates).toBe(result.candidates.length);
    expect(result.counts.total_findings).toBe(result.findings.length);
    expect(result.counts.seed_candidates + result.counts.cascaded_candidates).toBe(
      result.candidates.length,
    );
  });

  it('is cycle-safe: a cyclic dependency graph terminates with each node once', () => {
    const model = buildCyclicModel();

    const result = resolveBulkActionSet({ seedCandidateIds: ['a'], action: 'rejected' }, model);

    // a -> b -> c -> (a already visited). All three present, no duplicates,
    // no infinite loop (the test simply returning proves termination). The cyclic
    // model's only edges are `parent_child` (NOT a relationship-row kind), so
    // Group 3 surfaces nothing -- the candidate set is exactly the three nodes.
    expect(result.candidates.map((c) => c.candidate_id)).toEqual(['a', 'b', 'c']);
    expect(result.counts.total_candidates).toBe(3);
    expect(result.counts.cascaded_candidates).toBe(2); // b + c
  });

  it('returns just the seed (plus its referencing relationship row) for a node with no dependents', () => {
    const model = buildAcyclicModel();

    // depB has no DEPENDENTS (empty blast-radius entry), and its only finding is
    // f-depB. Rejecting it surfaces NO node cascade -- but Group 3 DOES surface the
    // `endpoint_data_effects` row depA->depB that references the rejected depB
    // (its target endpoint is gone). The node arm is still seed-only.
    const result = resolveBulkActionSet({ seedCandidateIds: ['depB'], action: 'rejected' }, model);

    // Node arm: just the depB seed, no node cascade.
    const nodeCandidates = result.candidates.filter((c) => !isRelationshipRow(c.candidate_id));
    expect(nodeCandidates).toEqual([
      { candidate_id: 'depB', provenance: 'seed', via_edge_kind: null, via_predecessor_id: null },
    ]);
    // Group-3 arm: the single referencing relationship row, marked + tagged with
    // the rejected node it references.
    const relRows = result.candidates.filter((c) => isRelationshipRow(c.candidate_id));
    expect(relRows).toEqual([
      {
        candidate_id: 'rel-eff-depA-depB',
        provenance: 'cascaded',
        via_edge_kind: 'endpoint_data_effects',
        via_predecessor_id: 'depB',
      },
    ]);
    // depB's single linked finding is included; no finding cascade beyond it.
    expect(result.findings).toEqual([{ finding_id: 'f-depB', via_candidate_id: 'depB' }]);
    expect(result.counts).toMatchObject({
      total_candidates: 2, // depB + the surfaced relationship row
      seed_candidates: 1,
      cascaded_candidates: 1,
      total_findings: 1,
    });
  });

  it('is pure: repeated calls on a frozen model yield identical output and do not mutate inputs', () => {
    const model = buildAcyclicModel();
    Object.freeze(model);
    Object.freeze(model.blast_radius);
    Object.freeze(model.findings);
    Object.freeze(model.edges);
    Object.freeze(model.nodes);

    const input = { seedCandidateIds: ['seed'] as const, action: 'rejected' as const };
    const first = resolveBulkActionSet(input, model);
    const second = resolveBulkActionSet(input, model);

    // Deterministic: same input -> structurally-equal output.
    expect(second).toEqual(first);
    // The seed-id input array is not consumed/mutated.
    expect(input.seedCandidateIds).toEqual(['seed']);
  });

  it('dedupes seed ids but RETAINS a non-node seed (no longer dropped) as a direct candidate', () => {
    const model = buildAcyclicModel();

    const result = resolveBulkActionSet(
      // duplicate `seed`, plus a relationship-row id that has NO node (no
      // blast-radius entry) in the model -- it must survive, not be dropped.
      { seedCandidateIds: ['seed', 'seed', 'rel-not-a-node'], action: 'rejected' },
      model,
    );

    // Both distinct seeds are retained (deduped); the non-node seed is kept.
    expect(result.seedCandidateIds).toEqual(['seed', 'rel-not-a-node']);
    expect(result.counts.seed_candidates).toBe(2);
    // The NODE cascade from the real `seed` still resolves fully (seed -> depA ->
    // depB); the non-node seed `rel-not-a-node` adds itself but no dependents.
    // (Group 3 additionally surfaces the depA->depB relationship-row candidate
    // `rel-eff-depA-depB` -- excluded here so this stays a node-cascade +
    // non-node-seed-retention assertion; the seeded `rel-not-a-node` is KEPT.)
    expect(
      result.candidates
        .map((c) => c.candidate_id)
        .filter((id) => id !== 'rel-eff-depA-depB'),
    ).toEqual([
      'seed',
      'rel-not-a-node',
      'depA',
      'depB',
    ]);
  });

  // --------------------------------------------------------------------------
  // Bug 1 regression: a SEED that is a relationship-row candidate type
  // (logical_data_entity_relationships / interface_logical_entities) is an EDGE
  // in Spec 1's review model, NOT a node, so it has no blast-radius entry. The
  // old resolver DROPPED such seeds, so "Approve Filtered (26)" over 26
  // relationship rows resolved to ZERO. They must now survive as DIRECT
  // candidates (provenance 'seed', no edge, no cascade, no derived findings).
  // --------------------------------------------------------------------------
  it('keeps relationship-row (non-node) seeds as direct candidates so a relationship-only filter resolves to a NON-ZERO set (Bug 1)', () => {
    // A model whose blast_radius covers ONLY node candidates; the 3 seeded ids
    // are all relationship rows (edges), absent from blast_radius entirely.
    const model: ReviewModelWire = {
      blast_radius: [
        { candidate_id: 'node-lde-1', dependents: [], would_be_orphaned_parent_ids: [] },
      ],
      // A finding that links a NODE candidate, NOT any of the relationship rows
      // -- so the relationship-only seed pulls NO findings.
      findings: [{ id: 'f-node', candidate_link_ids: ['node-lde-1'] }],
      aggregations: { total_candidates: 1, total_findings: 1 },
      // The relationship rows are EDGES referencing the node (not nodes); their
      // `relationship_candidate_id` is the seeded row id.
      edges: [
        {
          edge_kind: 'logical_data_entity_relationships',
          from_id: 'node-lde-1',
          to_id: 'node-lde-other',
          relationship_candidate_id: 'rel-lde-rel-1',
        },
        {
          edge_kind: 'interface_logical_entities',
          from_id: 'node-iface-1',
          to_id: 'node-lde-1',
          relationship_candidate_id: 'rel-iface-lde-1',
        },
      ],
      nodes: [{ id: 'node-lde-1', review_status: 'pending_review' }],
    };

    const relationshipSeedIds = [
      'rel-lde-rel-1', // logical_data_entity_relationships
      'rel-lde-rel-2',
      'rel-iface-lde-1', // interface_logical_entities
    ];

    // APPROVE so no Group-3 relationship surfacing runs (this is a non-node-seed
    // retention assertion, independent of reject marking).
    const result = resolveBulkActionSet(
      { seedCandidateIds: relationshipSeedIds, action: 'approved' },
      model,
    );

    // Non-zero: all three relationship rows survive as DIRECT seed candidates.
    expect(result.counts.total_candidates).toBe(3);
    expect(result.counts.seed_candidates).toBe(3);
    expect(result.counts.cascaded_candidates).toBe(0);
    expect(result.candidates.map((c) => c.candidate_id)).toEqual(relationshipSeedIds);
    // Each is a direct seed with NO edge provenance (it was not reached via an edge).
    for (const c of result.candidates) {
      expect(c.provenance).toBe('seed');
      expect(c.via_edge_kind).toBeNull();
      expect(c.via_predecessor_id).toBeNull();
    }
    // No cascade and NO derived findings (the finding links a node, not an edge id).
    expect(result.findings).toEqual([]);
    expect(result.counts.total_findings).toBe(0);
    // The retained seed list echoes every relationship-row id (none dropped).
    expect(result.seedCandidateIds).toEqual(relationshipSeedIds);
  });
});

// ---------------------------------------------------------------------------
// 2. Wire-shape CONTRACT test (drift guard)
// ---------------------------------------------------------------------------

describe('resolveBulkActionSet — ReviewModel wire-shape contract', () => {
  /**
   * Why this test exists: the resolver is the CANONICAL home, and Group 5 adds a
   * byte-for-byte logic MIRROR on the frontend against the SAME snake_case wire
   * types (the frontend cannot import gateway source across the build boundary).
   * Parity is held by THIS contract -- not a code import -- exactly as
   * `scopeRefType.contractWithGateway.test.ts` holds the ScopeRefType union. If a
   * field the resolver reads is renamed in Spec 1's `reviewModel/types.ts` (or the
   * frontend mirror drifts), the pinned paths below stop matching a built sample
   * and this test fails loudly.
   */

  it('pins the exact snake_case field paths the resolver consumes on a built sample', () => {
    const model = buildAcyclicModel();

    // Top-level model keys.
    for (const key of REVIEW_MODEL_WIRE_FIELDS.model) {
      expect(model).toHaveProperty(key);
    }

    // Each blast-radius entry exposes the keys the cascade walk reads.
    expect(model.blast_radius.length).toBeGreaterThan(0);
    for (const entry of model.blast_radius) {
      for (const key of REVIEW_MODEL_WIRE_FIELDS.blastRadiusEntry) {
        expect(entry).toHaveProperty(key);
      }
    }

    // Each dependent exposes the provenance keys the resolver propagates.
    const dependents = model.blast_radius.flatMap((e) => e.dependents);
    expect(dependents.length).toBeGreaterThan(0);
    for (const dep of dependents) {
      for (const key of REVIEW_MODEL_WIRE_FIELDS.blastRadiusDependent) {
        expect(dep).toHaveProperty(key);
      }
    }

    // Each finding node exposes the id + the candidate-link join the resolver uses.
    expect(model.findings.length).toBeGreaterThan(0);
    for (const finding of model.findings) {
      for (const key of REVIEW_MODEL_WIRE_FIELDS.findingNode) {
        expect(finding).toHaveProperty(key);
      }
    }
  });

  // -------------------------------------------------------------------------
  // Spec 2026-06-05-reject-cascade-correctness (Task Group 1): the new
  // top-level `edges` (raw in-adjacency graph) + `nodes` (each node's persisted
  // `review_status`) the reject-exclusivity walk reads. Purely additive
  // plumbing of data the discovery-service model already builds.
  // -------------------------------------------------------------------------

  it('exposes the new top-level `edges` array with edge_kind / from_id / to_id / relationship_candidate_id on each edge', () => {
    const model = buildAcyclicModel();

    expect(Array.isArray(model.edges)).toBe(true);
    expect(model.edges.length).toBeGreaterThan(0);
    for (const edge of model.edges) {
      for (const key of REVIEW_MODEL_WIRE_FIELDS.edge) {
        expect(edge).toHaveProperty(key);
      }
      // The relationship_candidate_id links the edge to its row candidate (the id
      // the resolver surfaces + marks for a rejected node) -- a non-empty string.
      expect(typeof edge.relationship_candidate_id).toBe('string');
      expect(edge.relationship_candidate_id.length).toBeGreaterThan(0);
    }
  });

  it('exposes the new top-level `nodes` array with id / review_status on each node', () => {
    const model = buildAcyclicModel();

    expect(Array.isArray(model.nodes)).toBe(true);
    expect(model.nodes.length).toBeGreaterThan(0);
    for (const node of model.nodes) {
      for (const key of REVIEW_MODEL_WIRE_FIELDS.node) {
        expect(node).toHaveProperty(key);
      }
      // review_status is the persisted AMS value the exclusivity union seeds the
      // already-rejected half from -- a string.
      expect(typeof node.review_status).toBe('string');
    }
  });

  it('keeps a NON-NODE seed (a relationship-row id with no blast_radius entry) as a direct candidate on a built sample (contract for the Bug 1 fix)', () => {
    // The wire shape carries blast_radius ONLY for node candidates. A seed id
    // absent from blast_radius is a relationship-row / edge candidate; the
    // resolver must keep it (provenance 'seed'), proving the contract both copies
    // share retains non-node seeds rather than dropping them. (Approve so no
    // Group-3 reject surfacing perturbs the seed-only shape.)
    const model = buildAcyclicModel();
    const nonNodeSeedId = 'rel-iface-lde-contract';
    // Sanity: the id is genuinely NOT a model node in the built sample.
    expect(
      model.blast_radius.some((e) => e.candidate_id === nonNodeSeedId),
    ).toBe(false);

    const result = resolveBulkActionSet(
      { seedCandidateIds: [nonNodeSeedId], action: 'approved' },
      model,
    );

    expect(result.candidates).toEqual([
      {
        candidate_id: nonNodeSeedId,
        provenance: 'seed',
        via_edge_kind: null,
        via_predecessor_id: null,
      },
    ]);
    expect(result.seedCandidateIds).toEqual([nonNodeSeedId]);
    expect(result.counts.total_candidates).toBe(1);
    expect(result.counts.seed_candidates).toBe(1);
  });

  it('declares the field manifest as snake_case (the AMS/discovery wire default) — no camelCase drift', () => {
    const allFields = [
      ...REVIEW_MODEL_WIRE_FIELDS.model,
      ...REVIEW_MODEL_WIRE_FIELDS.blastRadiusEntry,
      ...REVIEW_MODEL_WIRE_FIELDS.blastRadiusDependent,
      ...REVIEW_MODEL_WIRE_FIELDS.findingNode,
      ...REVIEW_MODEL_WIRE_FIELDS.edge,
      ...REVIEW_MODEL_WIRE_FIELDS.node,
    ];
    for (const field of allFields) {
      // snake_case: lower-case words separated by underscores, no upper-case.
      expect(field).toMatch(/^[a-z]+(_[a-z]+)*$/);
    }
  });

  it('mirrors Spec 1’s POINTS_WRAPPER_TYPES exclusion set verbatim (shared vocabulary parity)', () => {
    // The review model already excludes these as nodes, so the resolver never
    // sees one as a candidate; pinning the set keeps the shared vocabulary aligned
    // with discovery-service/src/services/reviewModel/types.ts.
    expect([...POINTS_WRAPPER_TYPES].sort()).toEqual(
      ['app_business_points', 'application_points', 'business_points', 'data_entity_points'].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// 3. Spec 2026-06-05-reject-cascade-correctness (Task Group 2): reject-only
//    exclusivity in the cascade walk. IDENTICAL cases run on the frontend mirror
//    (frontend/src/components/Discovery/resolveBulkActionSet.test.ts).
//
//    These assertions test EXCLUSIVITY (which NODES enter/leave the reject set);
//    the additive Group-3 relationship rows are filtered out via `isRelationshipRow`
//    so the exclusivity intent is asserted independently of the marking (Group 3 is
//    asserted in section 4).
// ---------------------------------------------------------------------------

const nodeIdsOf = (r: ReturnType<typeof resolveBulkActionSet>): string[] =>
  r.candidates.map((c) => c.candidate_id).filter((id) => !isRelationshipRow(id));

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
      aggregations: { total_candidates: 3, total_findings: 0 },
    } as unknown as ReviewModelWire; // edges + nodes deliberately omitted

    const result = resolveBulkActionSet({ seedCandidateIds: ['seed'], action: 'rejected' }, model);

    expect(result.candidates.map((c) => c.candidate_id)).toEqual(['seed', 'depA', 'depB']);
  });
});

// ---------------------------------------------------------------------------
// 4. Spec 2026-06-05-reject-cascade-correctness (Task Group 3): reject-only
//    relationship surfacing + marking. For every node in the FINAL reject set,
//    the referencing relationship-ROW candidates (via `relationship_candidate_id`)
//    are surfaced as cascade members + flow into the flat candidate-id set the
//    resolver yields (so they are persisted `rejected`). IDENTICAL cases run on
//    the frontend mirror (frontend/src/components/Discovery/resolveBulkActionSet.test.ts).
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
    const model: ReviewModelWire = {
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
      aggregations: { total_candidates: 2, total_findings: 0 },
      edges: [
        { edge_kind: 'endpoint_data_effects', from_id: 'ep', to_id: 'ent', relationship_candidate_id: '' },
      ],
      nodes: [
        { id: 'ep', review_status: 'pending_review' },
        { id: 'ent', review_status: 'pending_review' },
      ],
    };

    const result = resolveBulkActionSet({ seedCandidateIds: ['ep'], action: 'rejected' }, model);

    // ep + ent only; the empty relationship_candidate_id contributes NOTHING.
    expect(new Set(result.candidates.map((c) => c.candidate_id))).toEqual(new Set(['ep', 'ent']));
    expect(result.candidates.every((c) => c.candidate_id !== '')).toBe(true);
  });
});
