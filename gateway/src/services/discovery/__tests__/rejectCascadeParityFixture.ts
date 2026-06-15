/**
 * SHARED CANONICAL FIXTURE for the reject-cascade behavioral PARITY guard
 * (Spec 2026-06-05-reject-cascade-correctness, Task Group 4.2).
 *
 * The two `resolveBulkActionSet` copies are a declared BYTE-FOR-BYTE LOGIC MIRROR:
 *   - gateway (CANONICAL): `gateway/src/services/discovery/resolveBulkActionSet.ts`
 *   - frontend  (MIRROR) : `frontend/src/components/Discovery/resolveBulkActionSet.ts`
 * The frontend cannot import gateway source across the build boundary, so the two
 * copies cannot be proven identical by a shared code import. Instead BOTH mirrors
 * are run, in their OWN test runner (gateway jest + frontend vitest), against this
 * ONE shared input, and EACH diff-asserts its output against the ONE shared
 * {@link PARITY_EXPECTED} snapshot below. Because both assert byte-equal against
 * the SAME expected object, any behavioral drift in either copy fails its own
 * parity assertion — a real behavioral-equivalence check, not merely shape.
 *
 * This is the established cross-package contract idiom (see
 * `frontend/src/api/__tests__/scopeRefType.contractWithGateway.test.ts`, which
 * reaches into the gateway tree for its canonical JSON): the frontend parity test
 * imports THIS module via a relative `../../../../gateway/...` path
 * (`resolveJsonModule`/`esModuleInterop` are on in both tsconfigs; this is plain
 * TS data, no JSON loader needed).
 *
 * WHY THIS ONE INPUT IS SUFFICIENT (it is the rich combined case, not a re-cover
 * of every per-mirror unit case — those live in each mirror's own unit suite):
 * a single `action: 'rejected'` over a model carrying `edges`, node `review_status`,
 * AND all three load-bearing reject behaviours at once —
 *   1. EXCLUSIVITY (a SHARED `logical_data_entity` `ent` referenced by TWO endpoints
 *      `ep1`+`ep2`, only `ep1` seeded ⇒ `ent` SURVIVES; its `attr`, reachable only
 *      THROUGH the surviving `ent`, survives too),
 *   2. the PEER rule (a `logical_data_entity_relationships` `entA→entB`; rejecting
 *      `entA` NEVER pulls the far `entB`, but the relationship ROW `rel-AB` is still
 *      surfaced + marked),
 *   3. a CYCLE (`s1→s2→s3→s1` via `data_movements`; seeding `s1` drives the whole
 *      owned-by cycle in via the monotone fixpoint, which must terminate), and
 *   4. Group-3 SURFACING + MARKING (every rejected node's incident relationship-row
 *      candidate ids appear in the resolved set + the flat candidate-id list).
 *
 * The expected output is FULLY DETERMINISTIC: `touched` is an insertion-ordered Map
 * (seeds first in input order, then cascade in BFS discovery order, then the
 * Group-3 surfaced rows in `[...touched.keys()]` × `edges`-array order), so the
 * snapshot pins exact ordering, not just set membership.
 */

import type { ReviewModelWire } from '../reviewModelWire';

// ---------------------------------------------------------------------------
// Minimal structural shapes so this fixture is assignable to BOTH the gateway
// `ReviewModelWire` AND the frontend `ReviewModel` input types WITHOUT importing
// either frontend type into the gateway tree. Each node carries the SUPERSET of
// fields the two input types require (the frontend node needs `committed` +
// `conflict_state`; the gateway node reads only `id` + `review_status`); the
// extra fields are harmless passthrough on the gateway side.
// ---------------------------------------------------------------------------

/** The whole-run aggregation scalars (superset of both mirrors' required fields). */
const AGGREGATIONS = {
  // Deliberately DIFFERENT from the touched counts so the snapshot proves the
  // resolver forwards the whole-run "of N" context verbatim (not the touched size).
  total_candidates: 12,
  total_findings: 3,
  committed_count: 0,
  actionable_count: 12,
  live_conflict_count: 0,
} as const;

/** A type-complete node usable by both input shapes (id + status + the frontend extras). */
function parityNode(id: string, review_status = 'pending_review') {
  return {
    id,
    review_status,
    committed: false,
    conflict_state: { has_live_conflict: false },
  };
}

/**
 * The shared seed selection + action. Three seeds, ONE per sub-graph, all rejected
 * in the single call — exclusivity, peer, and cycle exercised together.
 */
export const PARITY_INPUT = {
  seedCandidateIds: ['ep1', 'entA', 's1'] as const,
  action: 'rejected' as const,
};

/**
 * The shared review model. Edge-array ORDER is load-bearing for the deterministic
 * Group-3 surfacing order, so it is fixed here and mirrored by the snapshot:
 *   1. ep1 -> ent   (endpoint_data_effects, rel-ep1-ent)
 *   2. ep2 -> ent   (endpoint_data_effects, rel-ep2-ent)   [ep2 survives]
 *   3. ent -> attr  (parent_child, attr)                   [NOT a relationship-row kind]
 *   4. entA -> entB (logical_data_entity_relationships, rel-AB)  [peer]
 *   5. s1 -> s2     (data_movements, mv-12)                [cycle]
 *   6. s2 -> s3     (data_movements, mv-23)                [cycle]
 *   7. s3 -> s1     (data_movements, mv-31)                [cycle]
 * `blast_radius` is the full downward closure per node (what discovery-service's
 * `downwardClosure` emits). All nodes are `pending_review` (the already-rejected
 * union path is exhaustively covered by the per-mirror unit suites; the parity
 * guard keeps a single unambiguous deterministic snapshot).
 */
export const PARITY_REVIEW_MODEL = {
  blast_radius: [
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
    {
      candidate_id: 'entA',
      dependents: [
        { dependent_id: 'entB', via_edge_kind: 'logical_data_entity_relationships', via_predecessor_id: 'entA' },
      ],
      would_be_orphaned_parent_ids: [],
    },
    { candidate_id: 'entB', dependents: [], would_be_orphaned_parent_ids: [] },
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
  ],
  findings: [],
  aggregations: AGGREGATIONS,
  edges: [
    { edge_kind: 'endpoint_data_effects', from_id: 'ep1', to_id: 'ent', relationship_candidate_id: 'rel-ep1-ent' },
    { edge_kind: 'endpoint_data_effects', from_id: 'ep2', to_id: 'ent', relationship_candidate_id: 'rel-ep2-ent' },
    { edge_kind: 'parent_child', from_id: 'ent', to_id: 'attr', relationship_candidate_id: 'attr' },
    { edge_kind: 'logical_data_entity_relationships', from_id: 'entA', to_id: 'entB', relationship_candidate_id: 'rel-AB' },
    { edge_kind: 'data_movements', from_id: 's1', to_id: 's2', relationship_candidate_id: 'mv-12' },
    { edge_kind: 'data_movements', from_id: 's2', to_id: 's3', relationship_candidate_id: 'mv-23' },
    { edge_kind: 'data_movements', from_id: 's3', to_id: 's1', relationship_candidate_id: 'mv-31' },
  ],
  nodes: [
    parityNode('ep1'),
    parityNode('ep2'),
    parityNode('ent'),
    parityNode('attr'),
    parityNode('entA'),
    parityNode('entB'),
    parityNode('s1'),
    parityNode('s2'),
    parityNode('s3'),
  ],
};

/**
 * The ONE canonical expected output BOTH resolvers must produce verbatim.
 *
 * Reject NODE set (post-exclusivity): ep1, entA, s1, s2, s3.
 *   - `ent` SURVIVES (surviving referencer ep2) and so `attr` (reachable only
 *     through the surviving `ent`) survives — exclusivity.
 *   - `entB` SURVIVES (peer rule never pulls the far entity).
 *   - the whole `s1→s2→s3→s1` data_movements cycle is pulled in (each node's sole
 *     in-cycle referencer rejects in turn) and TERMINATES (fixpoint + visited-set).
 * Group-3 SURFACED relationship rows (insertion order = rejectedNodeIds order ×
 * edges-array order, de-duped):
 *   rel-ep1-ent (incident to rejected ep1), rel-AB (incident to rejected entA),
 *   mv-12 + mv-31 (both incident to rejected s1), mv-23 (incident to rejected s2).
 *   `rel-ep2-ent` is NOT surfaced (incident only to the survivors ep2 + ent); the
 *   `parent_child` ent->attr edge is NOT a relationship-row kind so its
 *   `relationship_candidate_id` is never surfaced as a row.
 */
export const PARITY_EXPECTED = {
  action: 'rejected',
  seedCandidateIds: ['ep1', 'entA', 's1'],
  candidates: [
    // Seeds (input order).
    { candidate_id: 'ep1', provenance: 'seed', via_edge_kind: null, via_predecessor_id: null },
    { candidate_id: 'entA', provenance: 'seed', via_edge_kind: null, via_predecessor_id: null },
    { candidate_id: 's1', provenance: 'seed', via_edge_kind: null, via_predecessor_id: null },
    // Cycle nodes pulled in by the exclusivity-gated BFS (discovery order s2 then s3).
    { candidate_id: 's2', provenance: 'cascaded', via_edge_kind: 'data_movements', via_predecessor_id: 's1' },
    { candidate_id: 's3', provenance: 'cascaded', via_edge_kind: 'data_movements', via_predecessor_id: 's2' },
    // Group-3 surfaced relationship rows (rejectedNodeIds order × edges order).
    { candidate_id: 'rel-ep1-ent', provenance: 'cascaded', via_edge_kind: 'endpoint_data_effects', via_predecessor_id: 'ep1' },
    { candidate_id: 'rel-AB', provenance: 'cascaded', via_edge_kind: 'logical_data_entity_relationships', via_predecessor_id: 'entA' },
    { candidate_id: 'mv-12', provenance: 'cascaded', via_edge_kind: 'data_movements', via_predecessor_id: 's1' },
    { candidate_id: 'mv-31', provenance: 'cascaded', via_edge_kind: 'data_movements', via_predecessor_id: 's1' },
    { candidate_id: 'mv-23', provenance: 'cascaded', via_edge_kind: 'data_movements', via_predecessor_id: 's2' },
  ],
  findings: [],
  counts: {
    total_candidates: 10, // 5 nodes + 5 surfaced relationship rows
    seed_candidates: 3, // ep1, entA, s1
    cascaded_candidates: 7, // s2, s3, rel-ep1-ent, rel-AB, mv-12, mv-31, mv-23
    total_findings: 0,
    run_total_candidates: 12, // from aggregations.total_candidates (NOT the touched size)
    run_total_findings: 3, // from aggregations.total_findings
  },
};

/**
 * The flat marked candidate-id set the resolver yields (the ids the EXISTING atomic
 * cascade bulk-review endpoint persists `rejected`). Pinned separately so the
 * parity test can diff-assert "the flat marked candidate-id set" explicitly per the
 * Task 4.2 brief (candidates, findings, the flat marked candidate-id set, counts).
 */
export const PARITY_EXPECTED_FLAT_CANDIDATE_IDS = [
  'ep1',
  'entA',
  's1',
  's2',
  's3',
  'rel-ep1-ent',
  'rel-AB',
  'mv-12',
  'mv-31',
  'mv-23',
];

/** The gateway-typed view of the shared model (the frontend imports the same value, typed to its own `ReviewModel`). */
export const PARITY_REVIEW_MODEL_GATEWAY: ReviewModelWire =
  PARITY_REVIEW_MODEL as unknown as ReviewModelWire;
