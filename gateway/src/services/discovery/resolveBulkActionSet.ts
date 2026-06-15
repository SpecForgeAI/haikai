/**
 * `resolveBulkActionSet` -- the shared PURE cascade-set resolver (Spec 2,
 * Task Group 4 of the discovery-review-unification program F -> 0 -> 1 -> 2 -> 3).
 *
 * Spec: 2026-06-02-cascade-aware-bulk-review-and-reject-suppression
 * (Resolved Decision 8: ONE pure function consumed by both the grid's confirm
 * modal and Spec 3's server-side coordinator -- not two divergent copies).
 *
 * Given a SEED selection of candidate ids + the chosen review action and Spec 1's
 * deterministic `ReviewModel` (snake_case wire shape, already computed and
 * serialized -- this function does NO fetch), it returns the FULL touched set the
 * cascade-aware bulk apply would act on:
 *
 *   - the seed candidates, plus
 *   - every transitive DEPENDENT reached through `blast_radius[].dependents`
 *     (each tagged with the edge that pulled it in -- `via_edge_kind` +
 *     `via_predecessor_id`), plus
 *   - every FINDING whose `candidate_link_ids` include a touched candidate
 *     (the `target_type='discovery_candidate'` join Spec 1 resolved), each tagged
 *     with which touched candidate pulled it in,
 *
 * with per-item cascade PROVENANCE (seed vs cascaded, and via which edge) and net
 * counts derived from `blast_radius` / `aggregations`.
 *
 * REJECT-ONLY EXCLUSIVITY (Spec 2026-06-05-reject-cascade-correctness, Group 2):
 * for `action === 'rejected'` the cascade walk additionally enforces exclusivity
 * over the five "owned-by" relationship-row edge kinds: a node reached via such an
 * edge is pulled into the reject set ONLY when ALL of its referencing predecessors
 * (of that edge kind) are themselves rejected -- evaluated over the union
 * {already-persisted-rejected (node `review_status`)} ∪ {this action's seeds +
 * cascade}. A shared node with >=1 surviving referencer SURVIVES, and so do the
 * dependents only reachable THROUGH it (a dependent is admitted only when its own
 * reaching predecessor is in the reject set). Approve and Defer cascade behaviour
 * is UNCHANGED (the original surface->blast_radius BFS runs verbatim for them).
 *
 * REJECT-ONLY RELATIONSHIP SURFACING + MARKING (Spec
 * 2026-06-05-reject-cascade-correctness, Group 3): for `action === 'rejected'`,
 * AFTER the FINAL post-exclusivity reject set is settled, every relationship-ROW
 * candidate that REFERENCES a rejected node is surfaced as a cascade member and
 * folded into the resolved candidate set (so "+N relationships dropped" is real
 * data and each row is persisted `rejected` via the SAME atomic cascade endpoint).
 * A rejected node's referencing rows are found by the raw `edges`: every edge whose
 * `from_id` OR `to_id` is the rejected node and whose `edge_kind` is a relationship
 * -ROW kind contributes its `relationship_candidate_id` (no reconstruction by
 * name). This covers BOTH the peer `logical_data_entity_relationships` rows (whose
 * far entity is NOT pulled in) AND the owned-by rows. Approve and Defer add NO
 * relationship marking (unchanged).
 *
 * PURITY CONTRACT (load-bearing -- do NOT break):
 *   - No React, no I/O, no network, no LLM, no clock, no global state.
 *   - A pure function of (`{ seedCandidateIds, action }`, `reviewModel`).
 *   - Cycle-safe: a visited-set guards against infinite recursion on a cyclic
 *     dependency graph (the graph CAN be cyclic; Spec 1's blast radius is
 *     surface-only per candidate, so the resolver does the transitive walk). The
 *     reject-exclusivity walk is a monotone fixpoint over an only-growing reject
 *     set, also bounded by the same visited-set.
 *
 * This is the CANONICAL home. Spec 3's coordinator
 * (`gateway/src/services/architectConversation/...`) imports it directly; the
 * frontend grid MIRRORS the identical logic against the SAME snake_case wire
 * types (Group 5), guarded by the Group-4 wire-shape contract test + the Spec
 * 2026-06-05-reject-cascade-correctness shared-fixture parity test.
 */

import type {
  BulkReviewAction,
  EdgeKind,
  ReviewModelEdge,
  ReviewModelWire,
} from './reviewModelWire';

/**
 * The resolver's edge-kind type, aliased locally so the reject-exclusivity logic
 * below is BYTE-FOR-BYTE IDENTICAL to the frontend mirror (which binds this alias
 * to its own `ReviewModelEdgeKind`). This single alias line is the ONLY
 * type-binding seam between the two copies; every line of the algorithm that
 * follows is identical text.
 */
type ResolverEdgeKind = EdgeKind;

// ---------------------------------------------------------------------------
// Reject-exclusivity edge taxonomy (Spec 2026-06-05-reject-cascade-correctness)
// ---------------------------------------------------------------------------

/**
 * The five "owned-by" relationship-row edge kinds that cascade WITH exclusivity
 * for a reject: a node reached via one of these (many-to-one) edges is pulled into
 * the reject set ONLY when ALL of its referencing predecessors of that edge kind
 * are also being rejected. Mirror of Spec 1's `RELATIONSHIP_EDGE_KINDS`
 * (`discovery-service/src/services/reviewModel/types.ts`) MINUS the peer
 * `logical_data_entity_relationships` kind (handled below). Inlined as a local
 * snake_case set so both resolver mirrors stay self-contained + byte-for-byte
 * identical (neither imports the discovery-service source across its build
 * boundary).
 */
const OWNED_BY_RELATIONSHIP_EDGE_KINDS: ReadonlySet<ResolverEdgeKind> =
  new Set<ResolverEdgeKind>([
    'interface_logical_entities',
    'endpoint_data_effects',
    'logical_data_entity_physical_data_entities',
    'logical_data_attribute_physical_data_attributes',
    'data_movements',
  ]);

/**
 * The PEER (entity<->entity) relationship-row edge kind. Rejecting one endpoint
 * must DROP the relationship ROW (surfaced + marked in Group 3) but NEVER pull the
 * opposite entity into the reject set -- so the exclusivity walk simply never adds
 * the far entity via this edge kind (it is NOT one of the owned-by kinds above).
 *
 * Physical-symmetry finding (verified against
 * `discovery-service/src/services/reviewModel/buildReviewModel.ts:319-335`): there
 * is NO separate `physical_data_entity_relationships` edge kind in production code
 * -- the physical entity<->entity relationship FOLDS INTO
 * `logical_data_entity_relationships` ("BOTH logical-to-logical AND
 * physical-to-physical land on this type"). So this single peer rule covers BOTH
 * the logical and physical entity<->entity relationship; there is no second edge
 * kind to special-case.
 */
const PEER_RELATIONSHIP_EDGE_KIND: ResolverEdgeKind = 'logical_data_entity_relationships';

/**
 * The SIX relationship-ROW edge kinds = the five owned-by kinds U the one peer
 * kind. Verbatim mirror of Spec 1's `RELATIONSHIP_EDGE_KINDS`
 * (`discovery-service/src/services/reviewModel/types.ts`). An edge of one of these
 * kinds was produced by a relationship-ROW candidate, and the edge's
 * `relationship_candidate_id` is that row candidate's id (NOT so for the seventh
 * `EdgeKind`, `parent_child`, whose `relationship_candidate_id` is the CHILD
 * candidate's id, not a relationship row -- which is why `parent_child` is
 * EXCLUDED here).
 *
 * Group 3 (Spec 2026-06-05-reject-cascade-correctness) uses this set to SURFACE +
 * MARK, for every node in the FINAL reject set, the referencing relationship-row
 * candidates: every edge whose `from_id` OR `to_id` is a rejected node and whose
 * `edge_kind` is one of these six contributes its `relationship_candidate_id` to
 * the reject set (so "+N relationships dropped" is real data and the row is
 * persisted `rejected`). This covers BOTH the peer
 * `logical_data_entity_relationships` rows (whose far entity is NOT pulled in) AND
 * the owned-by rows -- the row candidate is ALWAYS surfaced + marked.
 */
const RELATIONSHIP_ROW_EDGE_KINDS: ReadonlySet<ResolverEdgeKind> =
  new Set<ResolverEdgeKind>([
    ...OWNED_BY_RELATIONSHIP_EDGE_KINDS,
    PEER_RELATIONSHIP_EDGE_KIND,
  ]);

// ---------------------------------------------------------------------------
// Public input / output shapes
// ---------------------------------------------------------------------------

/** The seed selection + the chosen action the resolver expands into a full set. */
export interface ResolveBulkActionSetInput {
  /**
   * The candidate ids the user seeded the action from (the grid's scope, or the
   * coordinator's targeted ids). De-duplicated internally; order-insensitive.
   */
  seedCandidateIds: readonly string[];
  /** The chosen review disposition (Approve / Reject / Defer). */
  action: BulkReviewAction;
}

/**
 * How a candidate entered the touched set:
 *   - `seed`     : it was in `seedCandidateIds`.
 *   - `cascaded` : it was reached transitively through `blast_radius` dependents.
 *
 * A candidate that is BOTH seeded and reachable as a dependent is recorded as
 * `seed` (the explicit user selection wins; provenance is then `null`).
 */
export type CandidateProvenanceKind = 'seed' | 'cascaded';

/** One candidate in the resolved touched set, with cascade provenance. */
export interface ResolvedCandidate {
  /** The candidate (node) id. */
  candidate_id: string;
  /** Whether this candidate was a seed or pulled in by cascade. */
  provenance: CandidateProvenanceKind;
  /**
   * The `edge_kind` of the edge that first pulled this candidate into the set.
   * `null` for a seed candidate (it was not reached via an edge).
   */
  via_edge_kind: EdgeKind | null;
  /**
   * The immediate predecessor candidate id that first reached this dependent.
   * `null` for a seed candidate.
   */
  via_predecessor_id: string | null;
}

/**
 * One finding in the resolved touched set. Findings are always CASCADED (Decision
 * 7: linked findings are cascade dependents pulled in via the candidate join),
 * so the provenance records which touched candidate pulled the finding in.
 */
export interface ResolvedFinding {
  /** The finding id. */
  finding_id: string;
  /**
   * The touched candidate whose `candidate_link_ids` pulled this finding in.
   * (When a finding links to several touched candidates, the FIRST encountered
   * in deterministic walk order is recorded -- the finding is in the set once.)
   */
  via_candidate_id: string;
}

/** Net counts for the preview header, derived from the resolved set + aggregations. */
export interface ResolvedBulkActionCounts {
  /** Distinct candidates in the touched set (seed + cascaded). */
  total_candidates: number;
  /** Of `total_candidates`, how many were seeds. */
  seed_candidates: number;
  /** Of `total_candidates`, how many were pulled in by cascade. */
  cascaded_candidates: number;
  /** Distinct linked findings in the touched set. */
  total_findings: number;
  /**
   * The whole-run candidate total from `aggregations.total_candidates` (the "of N"
   * context the preview shows), or `null` when the wire omitted it.
   */
  run_total_candidates: number | null;
  /**
   * The whole-run finding total from `aggregations.total_findings`, or `null`
   * when the wire omitted it.
   */
  run_total_findings: number | null;
}

/** The full deterministic touched set the bulk apply / preview consumes. */
export interface ResolvedBulkActionSet {
  /** The chosen action, echoed for the caller's convenience. */
  action: BulkReviewAction;
  /**
   * The de-duplicated seed ids retained (in first-seen input order). EVERY seed
   * id is retained now -- including a seed id with no model node (a
   * relationship-row / edge candidate, which Spec 1 represents as an EDGE, not a
   * node). Only exact duplicates are collapsed.
   */
  seedCandidateIds: string[];
  /** The full candidate touched set (seed + cascaded), deterministically ordered. */
  candidates: ResolvedCandidate[];
  /** The full linked-finding touched set, deterministically ordered. */
  findings: ResolvedFinding[];
  /** Net counts for the preview header. */
  counts: ResolvedBulkActionCounts;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/** A single dependent under consideration during the reject-exclusivity walk. */
interface RejectDependent {
  dependent_id: string;
  via_edge_kind: ResolverEdgeKind;
  via_predecessor_id: string;
}

/**
 * Resolve the full cascade-aware touched set for a seed selection + action over
 * Spec 1's review model. PURE -- see the module-level purity contract.
 *
 * Algorithm (deterministic, cycle-safe):
 *   1. Seed the touched-candidate set from `seedCandidateIds` (provenance `seed`).
 *      EVERY seed id is kept as a DIRECT candidate (provenance `seed`,
 *      `via_edge_kind: null`, `via_predecessor_id: null`) -- including a seed id
 *      that is NOT a model node. Spec 1's review model represents the
 *      relationship-row candidate types (`logical_data_entity_relationships`,
 *      `interface_logical_entities`, ...) as EDGES, not nodes, so they carry NO
 *      `blast_radius` entry; dropping them (the old behaviour) made a filter of
 *      only-relationship rows -- e.g. "Approve Filtered (26)" over 26
 *      logical_data_entity_relationships -- resolve to ZERO. A non-node seed
 *      contributes ONLY itself to the touched set (counted in
 *      `total_candidates`/`seed_candidates`) with NO cascade and NO derived
 *      findings: it has no blast-radius entry so the walk in step 2 is a no-op
 *      for it, and the finding join in step 3 is candidate-NODE based, so an edge
 *      id never appears in any finding's `candidate_link_ids`.
 *   2. Transitively expand via `blast_radius[].dependents`:
 *      - APPROVE / DEFER (unchanged): a plain BFS -- pop a candidate, look up its
 *        blast-radius entry, and for each dependent not yet seen add it with
 *        provenance `cascaded` + the edge that pulled it in, then enqueue it.
 *      - REJECT (Spec 2026-06-05-reject-cascade-correctness, Group 2): the same
 *        BFS but exclusivity-gated. A dependent is admitted only when (a) its own
 *        reaching predecessor (`via_predecessor_id`) is in the reject set -- so a
 *        dependent reachable only THROUGH a survivor also survives -- and (b), for
 *        the five owned-by relationship-row edge kinds, ALL of its referencing
 *        predecessors of that edge kind (from the raw-`edges` in-adjacency) are in
 *        the reject set {already-persisted-rejected} U {touched-so-far}. A
 *        dependent reached via the peer `logical_data_entity_relationships` edge is
 *        NEVER added (the far entity survives; the row is surfaced/marked in Group
 *        3). `parent_child` keeps its single-parent cascade (gated only by (a), so
 *        rejecting an entity still rejects its attributes, while a surviving
 *        entity's attributes survive). Because eligibility depends on the EVOLVING
 *        reject set, not-yet-eligible dependents are DEFERRED and re-evaluated as
 *        the set grows (a monotone fixpoint).
 *      A visited-set (`touched`) makes both variants safe on a cyclic graph (each
 *      id is processed once). A non-node seed has no entry, so the walk is a no-op
 *      for it.
 *   2b. REJECT-ONLY relationship surfacing + marking (Spec
 *      2026-06-05-reject-cascade-correctness, Group 3): once the reject set in (2)
 *      is FINAL, surface every relationship-ROW candidate that references a rejected
 *      node. A rejected node's referencing rows = every edge whose `from_id` OR
 *      `to_id` is that node and whose `edge_kind` is one of the six relationship-row
 *      kinds; each such edge's `relationship_candidate_id` is added to the touched
 *      set as a cascade member (de-duped against ids already present). This covers
 *      BOTH peer rows (the far entity stayed OUT in (2), but its row IS surfaced +
 *      marked) and owned-by rows. The added ids ride the SAME resolved
 *      `candidates[]` -> flat `candidate_ids[]` the atomic cascade endpoint persists
 *      `rejected`. No-op for Approve / Defer (no relationship marking).
 *   3. For every touched candidate, add each finding whose `candidate_link_ids`
 *      include it (recorded once, tagged with the first touched candidate that
 *      pulled it in).
 *   4. Derive net counts from the resolved set + `aggregations`.
 *
 * The seed-only case (a candidate with no dependents and no linked findings)
 * returns just that candidate and zero findings.
 */
export function resolveBulkActionSet(
  input: ResolveBulkActionSetInput,
  reviewModel: ReviewModelWire,
): ResolvedBulkActionSet {
  const { seedCandidateIds, action } = input;

  const blastRadius = reviewModel.blast_radius ?? [];
  const findings = reviewModel.findings ?? [];
  const aggregations = reviewModel.aggregations ?? {};
  // The raw typed-edge graph + the minimal per-node view. BOTH default to `[]`:
  // the frontend `ReviewModel.edges` is OPTIONAL and some callers omit `edges` /
  // `nodes`, so an absent graph must degrade to the pre-Spec
  // 2026-06-05-reject-cascade-correctness behaviour (no in-adjacency => no
  // exclusivity gating, identical to today) rather than throw.
  const edges = reviewModel.edges ?? [];
  const nodes = reviewModel.nodes ?? [];

  // Index blast-radius entries by the candidate they describe (O(1) lookup).
  const blastByCandidate = new Map(
    blastRadius.map((entry) => [entry.candidate_id, entry]),
  );

  // Per-resolve IN-adjacency (referencer map) built from the raw `edges`: node id
  // -> the edges pointing INTO it (`to_id === node`). The reject-exclusivity walk
  // asks "are ALL my referencing predecessors of edge kind K rejected?" by reading
  // the predecessors here, so each mirror builds its OWN map (no precomputed
  // referencer map crosses the wire). Pure + absence-tolerant (empty when no
  // `edges`).
  const referencersByNode = new Map<string, ReviewModelEdge[]>();
  for (const edge of edges) {
    const list = referencersByNode.get(edge.to_id);
    if (list) list.push(edge);
    else referencersByNode.set(edge.to_id, [edge]);
  }

  // The already-persisted-rejected half of the exclusivity union: nodes whose
  // persisted `review_status` is already `rejected` (seeded from the new `nodes`
  // array). A referencer that is already rejected counts as "rejected" (NOT
  // surviving), so it never blocks a shared node from being pulled in.
  const alreadyRejected = new Set<string>();
  for (const node of nodes) {
    if (node.review_status === 'rejected') alreadyRejected.add(node.id);
  }

  // Touched candidates, keyed by id, preserving the resolution provenance. A
  // seed wins over a later cascaded discovery of the same id (the explicit user
  // selection is recorded as `seed`).
  const touched = new Map<string, ResolvedCandidate>();

  // De-duplicated seed list, in first-seen input order. EVERY seed is retained
  // (node or non-node); only exact duplicates collapse.
  const resolvedSeedIds: string[] = [];

  // 1. Seed. Keep EVERY seed -- including a non-node (relationship-row / edge)
  //    seed, which has no `blast_radius` entry. It contributes itself with no
  //    cascade (step 2 finds no entry) and no findings (step 3's join is
  //    node-based), but it MUST count and survive into the touched set.
  for (const seedId of seedCandidateIds) {
    if (touched.has(seedId)) continue; // already seeded (dup in input)
    touched.set(seedId, {
      candidate_id: seedId,
      provenance: 'seed',
      via_edge_kind: null,
      via_predecessor_id: null,
    });
    resolvedSeedIds.push(seedId);
  }

  // A dependent is in the reject set iff it is already-persisted-rejected OR it
  // has been pulled into `touched` (this action's seeds + accreted cascade). The
  // reject set only GROWS, which is what makes the fixpoint terminate.
  const isInRejectSet = (id: string): boolean =>
    touched.has(id) || alreadyRejected.has(id);

  // Exclusivity predicate: a node reached via `viaEdgeKind` has ALL its referencing
  // predecessors of THAT edge kind in the reject set. (Only asked for owned-by
  // kinds, so there is >=1 such referencer -- the dependent's own in-edge -- and
  // the `.every` is never vacuously true on an empty list.)
  const allReferencersRejected = (
    nodeId: string,
    viaEdgeKind: ResolverEdgeKind,
  ): boolean =>
    (referencersByNode.get(nodeId) ?? [])
      .filter((edge) => edge.edge_kind === viaEdgeKind)
      .every((edge) => isInRejectSet(edge.from_id));

  // Whether a (non-peer, not-yet-visited) reject dependent is eligible to be added
  // NOW: its reaching predecessor must be rejected (so a dependent reachable only
  // through a survivor stays out), and -- for owned-by relationship-row edges --
  // ALL of its referencing predecessors of that edge kind must be rejected (so a
  // shared node with a surviving referencer stays out). `parent_child` (and any
  // non-relationship-row kind) is gated only by the predecessor rule.
  const isEligibleNow = (dependent: RejectDependent): boolean => {
    if (!isInRejectSet(dependent.via_predecessor_id)) return false;
    if (OWNED_BY_RELATIONSHIP_EDGE_KINDS.has(dependent.via_edge_kind)) {
      return allReferencersRejected(dependent.dependent_id, dependent.via_edge_kind);
    }
    return true;
  };

  if (action === 'rejected') {
    // 2. (REJECT) Exclusivity-gated transitive expansion -- a monotone fixpoint.
    //    `touched` doubles as the visited-set (each id added once) so a cyclic
    //    graph terminates; the reject set only grows, so deferred dependents are
    //    re-tested until no further node unlocks. Deterministic: the queue is FIFO
    //    in BFS discovery order, and `deferred` is scanned in insertion order.
    const queue: string[] = [...resolvedSeedIds];
    // Dependents not (yet) eligible: a surviving referencer / predecessor may
    // itself be rejected later, unlocking them. Kept for re-evaluation as the set
    // grows. A peer dependent is NEVER deferred (it must never be added).
    const deferred: RejectDependent[] = [];

    // Add a newly-eligible dependent to the touched set + the BFS queue.
    const admit = (dependent: RejectDependent): void => {
      touched.set(dependent.dependent_id, {
        candidate_id: dependent.dependent_id,
        provenance: 'cascaded',
        via_edge_kind: dependent.via_edge_kind,
        via_predecessor_id: dependent.via_predecessor_id,
      });
      queue.push(dependent.dependent_id);
    };

    // Decide one dependent: admit it now, defer it, or drop it (peer / visited).
    const consider = (dependent: RejectDependent): void => {
      if (touched.has(dependent.dependent_id)) return; // visited (cycle-safe)
      if (dependent.via_edge_kind === PEER_RELATIONSHIP_EDGE_KIND) return; // peer: far entity survives
      if (isEligibleNow(dependent)) admit(dependent);
      else deferred.push(dependent); // may unlock once its blockers reject
    };

    // Fixpoint: drain the BFS queue, then re-test the deferred set against the now-
    // larger reject set; repeat while either makes progress. Bounded by `touched`.
    for (;;) {
      while (queue.length > 0) {
        const currentId = queue.shift() as string;
        const entry = blastByCandidate.get(currentId);
        if (!entry) continue; // non-node / edge seed: no dependents
        for (const dependent of entry.dependents ?? []) {
          consider(dependent);
        }
      }
      // Re-test deferred dependents now that the reject set may have grown. Any
      // that became eligible are admitted (which re-fills the queue); already-
      // touched ones are pruned. Loop again only if progress was made.
      let progressed = false;
      const stillDeferred: RejectDependent[] = [];
      for (const dependent of deferred) {
        if (touched.has(dependent.dependent_id)) continue; // admitted via another path
        if (isEligibleNow(dependent)) {
          admit(dependent);
          progressed = true;
        } else {
          stillDeferred.push(dependent);
        }
      }
      deferred.length = 0;
      deferred.push(...stillDeferred);
      if (!progressed && queue.length === 0) break; // fixpoint reached
    }

    // 2b. (REJECT) Relationship surfacing + marking (Spec
    //     2026-06-05-reject-cascade-correctness, Group 3). The reject set in
    //     `touched` is now FINAL. For EVERY node in it, surface the
    //     relationship-ROW candidates that REFERENCE it: scan the raw `edges` for
    //     every edge whose `from_id` OR `to_id` is the rejected node AND whose
    //     `edge_kind` is one of the six relationship-row kinds, and add the edge's
    //     `relationship_candidate_id` to `touched` as a cascade member. The link
    //     edge -> row candidate is the `relationship_candidate_id` itself (no
    //     reconstruction by name). This is what makes "+N relationships dropped"
    //     real data AND pushes the row id into the resolved `candidates[]` -> the
    //     flat `candidate_ids[]` the atomic cascade endpoint persists `rejected`.
    //
    //     - PEER (`logical_data_entity_relationships`): the far entity stayed OUT
    //       of the reject set in (2), but its relationship ROW is still surfaced +
    //       marked here (the rejected endpoint is one of the edge's two nodes).
    //     - OWNED-BY: the row that bound the rejected node is surfaced + marked.
    //     A relationship-candidate id already in `touched` (e.g. it was itself a
    //     seed) is skipped (de-dupe); an absent/empty `relationship_candidate_id`
    //     edge is skipped (guard). Snapshot the rejected ids first so growing
    //     `touched` while iterating it is safe + deterministic (the newly-added row
    //     candidates are NOT nodes, so they reference nothing to re-scan).
    const rejectedNodeIds = [...touched.keys()];
    for (const nodeId of rejectedNodeIds) {
      for (const edge of edges) {
        if (edge.from_id !== nodeId && edge.to_id !== nodeId) continue; // not incident
        if (!RELATIONSHIP_ROW_EDGE_KINDS.has(edge.edge_kind)) continue; // not a relationship row
        const rowId = edge.relationship_candidate_id;
        if (!rowId) continue; // absent / empty relationship_candidate_id: skip
        if (touched.has(rowId)) continue; // already in the set (seed or prior surface)
        touched.set(rowId, {
          candidate_id: rowId,
          provenance: 'cascaded',
          via_edge_kind: edge.edge_kind,
          via_predecessor_id: nodeId,
        });
      }
    }
  } else {
    // 2. (APPROVE / DEFER -- UNCHANGED) Transitive expansion via blast-radius
    //    dependents. BFS over a work queue; `touched` doubles as the visited-set so
    //    a cyclic graph terminates. A seed with no blast-radius entry (a non-node /
    //    edge candidate) is skipped by the `if (!entry) continue` guard, so it
    //    contributes no dependents. NO relationship surfacing/marking runs here --
    //    Group 3 is reject-only.
    const queue: string[] = [...resolvedSeedIds];
    while (queue.length > 0) {
      const currentId = queue.shift() as string;
      const entry = blastByCandidate.get(currentId);
      if (!entry) continue;
      for (const dependent of entry.dependents ?? []) {
        if (touched.has(dependent.dependent_id)) continue; // visited (cycle-safe)
        touched.set(dependent.dependent_id, {
          candidate_id: dependent.dependent_id,
          provenance: 'cascaded',
          via_edge_kind: dependent.via_edge_kind,
          via_predecessor_id: dependent.via_predecessor_id,
        });
        queue.push(dependent.dependent_id);
      }
    }
  }

  // 3. Linked findings: a finding is pulled in if ANY of its `candidate_link_ids`
  //    is a touched candidate. Recorded once, tagged with the first touched
  //    candidate (in the finding's link order) that pulled it in. Iterating the
  //    findings array (not the candidate set) keeps the output order stable and
  //    independent of touched-set iteration order. (A non-node seed never matches
  //    here -- findings link candidate NODE ids, never edge ids.)
  const resolvedFindings: ResolvedFinding[] = [];
  const seenFindingIds = new Set<string>();
  for (const finding of findings) {
    if (seenFindingIds.has(finding.id)) continue;
    const viaCandidateId = (finding.candidate_link_ids ?? []).find((cid) =>
      touched.has(cid),
    );
    if (viaCandidateId === undefined) continue; // links no touched candidate
    seenFindingIds.add(finding.id);
    resolvedFindings.push({
      finding_id: finding.id,
      via_candidate_id: viaCandidateId,
    });
  }

  // Deterministic candidate ordering: seeds first (in input order), then cascaded
  // dependents in BFS discovery order. `touched` is a Map, which preserves
  // insertion order -- seeds were inserted before any cascaded dependent, and
  // dependents in BFS order -- so iterating it yields exactly that ordering.
  const candidates = [...touched.values()];

  const seedCount = candidates.filter((c) => c.provenance === 'seed').length;
  const cascadedCount = candidates.length - seedCount;

  const counts: ResolvedBulkActionCounts = {
    total_candidates: candidates.length,
    seed_candidates: seedCount,
    cascaded_candidates: cascadedCount,
    total_findings: resolvedFindings.length,
    run_total_candidates:
      typeof aggregations.total_candidates === 'number'
        ? aggregations.total_candidates
        : null,
    run_total_findings:
      typeof aggregations.total_findings === 'number'
        ? aggregations.total_findings
        : null,
  };

  return {
    action,
    seedCandidateIds: resolvedSeedIds,
    candidates,
    findings: resolvedFindings,
    counts,
  };
}
