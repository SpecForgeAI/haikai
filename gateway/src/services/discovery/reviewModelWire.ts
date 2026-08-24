/**
 * Review-model WIRE types consumed by the cascade-set resolver (Spec 2,
 * Task Group 4 of the discovery-review-unification program F -> 0 -> 1 -> 2 -> 3).
 *
 * Spec: 2026-06-02-cascade-aware-bulk-review-and-reject-suppression.
 *
 * These are the snake_case fields the gateway's `resolveBulkActionSet` reads off
 * the deterministic `ReviewModel` that Spec 1 computes LIVE on read in the
 * discovery-service and serializes verbatim over
 * `GET .../discovery/runs/:runId/review-model` (proxied by the gateway). AMS /
 * discovery-service speak snake_case at the wire by default (repo `CLAUDE.md`),
 * so the model object serializes verbatim with `JSON.stringify` -- there is NO
 * camelCase->snake_case mapper on the way out, and these interfaces are written
 * snake_case to match it field-for-field.
 *
 * SOURCE OF TRUTH for the shape is Spec 1's
 * `discovery-service/src/services/reviewModel/types.ts`. This module is a
 * deliberate, MINIMAL gateway-local MIRROR of the subset the resolver touches
 * (`blast_radius[].dependents`, `findings[].candidate_link_ids`, the node ids,
 * the raw `edges` in-adjacency, the per-node `review_status`, and the
 * `aggregations` count scalars). The gateway does NOT import the
 * discovery-service source across the package boundary; parity with Spec 1 (and,
 * crucially, with the frontend MIRROR that Group 5 adds under
 * `frontend/src/api/discoveryApi.ts`) is held by the wire-shape CONTRACT TEST in
 * `__tests__/resolveBulkActionSet.test.ts`, not by a code import -- exactly the
 * idiom `frontend/src/api/__tests__/scopeRefType.contractWithGateway.test.ts`
 * establishes for cross-package wire shapes.
 *
 * The resolver is the CANONICAL home (Decision 8): Spec 3's server-side coordinator
 * (`gateway/src/services/architectConversation/...`) imports it directly, and the
 * frontend grid mirrors the identical pure logic against these SAME wire types.
 */

// ===========================================================================
// Edge taxonomy (the `via_edge_kind` / `edge_kind` discriminator)
// ===========================================================================

/**
 * The typed-edge discriminator. `parent_child` is the structural
 * `parentCandidateId` edge; the remaining six are the relationship-row kinds.
 * Verbatim mirror of Spec 1's `EdgeKind` (`reviewModel/types.ts`).
 *
 * Per-kind direction (`from_id` -> `to_id`):
 *   - `parent_child`                                   : parent -> child
 *   - `interface_logical_entities`                     : interface -> logical entity
 *   - `endpoint_data_effects`                          : endpoint -> data entity
 *   - `logical_data_entity_physical_data_entities`     : logical entity -> physical entity
 *   - `logical_data_attribute_physical_data_attributes`: logical attribute -> physical attribute
 *   - `logical_data_entity_relationships`              : parent entity -> child entity
 *   - `data_movements`                                 : source (endpoint/service) -> target
 */
export type EdgeKind =
  | 'parent_child'
  | 'interface_logical_entities'
  | 'endpoint_data_effects'
  | 'logical_data_entity_physical_data_entities'
  | 'logical_data_attribute_physical_data_attributes'
  | 'logical_data_entity_relationships'
  | 'data_movements';

/**
 * The polymorphic `*_points` wrapper types -- backend auto-managed, NEVER nodes
 * or edges anywhere in the graph (the review model already excludes them, so the
 * resolver never sees one as a candidate node). Mirror of Spec 1's
 * `POINTS_WRAPPER_TYPES`; carried here so the resolver / its tests can assert the
 * exclusion holds and the shared vocabulary stays self-documenting.
 */
export const POINTS_WRAPPER_TYPES: ReadonlySet<string> = new Set<string>([
  'application_points',
  'data_entity_points',
  'business_points',
  'app_business_points',
]);

/**
 * The chosen review action. The same Spec F vocabulary is shared by BOTH
 * candidates and findings; `pending_review` is not a bulk-apply target (the user
 * bulk Approves / Rejects / Defers), so the action union is the three terminal
 * dispositions only. (The atomic AMS endpoint validates the same set.)
 */
export type BulkReviewAction = 'approved' | 'rejected' | 'deferred';

// ===========================================================================
// Raw edge graph (the IN-adjacency input the reject-exclusivity walk builds)
// ===========================================================================

/**
 * One typed directed edge of the review-model graph. Verbatim mirror of the
 * relevant subset of Spec 1's `ReviewModelEdge`
 * (`discovery-service/src/services/reviewModel/types.ts`). `edge_kind` is the
 * discriminator; `from_id`/`to_id` are node ids with the per-kind direction
 * documented on {@link EdgeKind}.
 *
 * The reject-cascade resolver reads the raw `edges` array (NOT a precomputed
 * referencer map) and builds its OWN in-adjacency at resolve time, so a node is
 * pulled into the reject set only when ALL of its referencing predecessors (of a
 * given relationship-row edge kind) are also being rejected. `relationship_candidate_id`
 * is the id of the relationship-ROW candidate that produced the edge -- the link
 * the resolver follows to SURFACE + MARK the referencing relationship rows of a
 * rejected node (no reconstruction by name).
 */
export interface ReviewModelEdge {
  /** The edge discriminator. */
  edge_kind: EdgeKind;
  /** Source node id (direction per {@link EdgeKind}). */
  from_id: string;
  /** Target node id (direction per {@link EdgeKind}). */
  to_id: string;
  /**
   * Id of the candidate that produced this edge: the relationship-row candidate
   * for relationship edges, or the child candidate for a `parent_child` edge.
   */
  relationship_candidate_id: string;
}

// ===========================================================================
// Nodes (the already-persisted-rejected seed source)
// ===========================================================================

/**
 * The MINIMAL per-node view the resolver consumes: the node `id` plus its
 * persisted `review_status`. Reject exclusivity evaluates over
 * {already-persisted-rejected} ∪ {this action's rejected seeds + cascade}; the
 * already-rejected half is seeded from the nodes whose `review_status` is
 * already `rejected`. A MINIMAL mirror of Spec 1's `ReviewModelNode` (only the
 * two fields the resolver reads -- the full node carries far more).
 */
export interface ReviewModelNode {
  /** AMS candidate id -- globally unique node id across runs. */
  id: string;
  /**
   * The Spec F review status (verbatim AMS value). Nodes whose value is already
   * `rejected` seed the already-persisted-rejected half of the exclusivity union.
   */
  review_status: string;
}

// ===========================================================================
// Blast radius (the cascade input the resolver walks)
// ===========================================================================

/**
 * One dependent reached by a candidate's reject/defer blast radius, recording
 * WHICH edge pulled it in. Verbatim mirror of Spec 1's `BlastRadiusDependent`.
 */
export interface BlastRadiusDependent {
  /** The dependent candidate id reached by the closure. */
  dependent_id: string;
  /** The `edge_kind` of the edge that pulled this dependent into the radius. */
  via_edge_kind: EdgeKind;
  /** The immediate predecessor node id that reached this dependent. */
  via_predecessor_id: string;
}

/**
 * The surface-only blast radius for a single candidate: the downward transitive
 * closure of dependents a reject/defer WOULD affect. Verbatim mirror of Spec 1's
 * `BlastRadiusEntry` (the resolver reads `candidate_id` + `dependents`; the
 * advisory `would_be_orphaned_parent_ids` is carried for shape parity but is NOT
 * part of the hard touched set).
 */
export interface BlastRadiusEntry {
  /** The candidate whose hypothetical reject this radius describes. */
  candidate_id: string;
  /** The transitive dependents, each tagged with the edge that pulled it in. */
  dependents: BlastRadiusDependent[];
  /** ADVISORY-ONLY would-be-orphan parent ids (NOT part of the hard radius). */
  would_be_orphaned_parent_ids: string[];
}

// ===========================================================================
// Findings (the linked-finding cascade arm)
// ===========================================================================

/**
 * One review-model finding node. The resolver reads `id` (to add the finding to
 * the touched set) and `candidate_link_ids` (the `target_type==='discovery_candidate'`
 * join Spec 1 resolved) to decide which findings a touched candidate pulls in.
 * Mirror of the subset of Spec 1's `ReviewFindingNode` the resolver consumes.
 */
export interface ReviewFindingNode {
  /** AMS finding id. */
  id: string;
  /**
   * The candidate node ids this finding links to (Spec 1 resolves these from
   * `links[]` where `target_type === 'discovery_candidate'`). A finding is pulled
   * into the touched set when ANY of these ids is a touched candidate. Empty when
   * the finding links to no candidate.
   */
  candidate_link_ids: string[];
}

// ===========================================================================
// Aggregations (the net-count cross-check)
// ===========================================================================

/**
 * The precomputed aggregation scalars the resolver reads to populate / cross-check
 * the preview's net counts. A MINIMAL mirror of Spec 1's `ReviewModelAggregations`
 * (the resolver derives its touched-set counts directly from the walk; these
 * whole-run scalars let the preview show "x of N" context). All optional so a
 * partial wire payload still parses (absence-tolerant), matching how the frontend
 * client copy types only the scalars it consumes.
 */
export interface ReviewModelAggregations {
  /** Total candidate node count (excludes findings). */
  total_candidates?: number;
  /** Nodes PLUS relationship-row candidates — the selectable-row total the
   *  bulk preview's "x of N" uses (node-only total undercounts). */
  total_candidates_all_types?: number;
  /** Total finding count. */
  total_findings?: number;
  /** Committed candidates across the whole run. */
  committed_count?: number;
  /** Non-committed (actionable) candidates across the whole run. */
  actionable_count?: number;
  /** Unresolved-conflict candidates across the whole run. */
  live_conflict_count?: number;
}

// ===========================================================================
// Top-level model (the resolver's single input)
// ===========================================================================

/**
 * The subset of the deterministic `ReviewModel` wire shape the resolver consumes.
 * Spec 1's discovery-service returns the FULL model (nodes, edges, findings,
 * blast_radius, aggregations); the resolver reads `blast_radius` (the cascade),
 * `findings` (the linked-finding arm), `aggregations` (the net-count context),
 * the raw `edges` (the in-adjacency the reject-exclusivity walk builds), and the
 * minimal `nodes` (each node's persisted `review_status` seeding the
 * already-rejected half of the exclusivity union). Untyped fields on the wire
 * are simply ignored, so this narrow view parses the full payload unchanged.
 */
export interface ReviewModelWire {
  /** Per-candidate surface-only blast radius (Spec 1 Group 2). */
  blast_radius: BlastRadiusEntry[];
  /** The unioned finding nodes (with their `candidate_link_ids`). */
  findings: ReviewFindingNode[];
  /** The precomputed aggregation scalars. */
  aggregations: ReviewModelAggregations;
  /**
   * The raw typed-edge graph. The reject-cascade resolver builds its OWN
   * in-adjacency from these at resolve time (no precomputed referencer map) and
   * follows each edge's `relationship_candidate_id` to surface + mark the
   * referencing relationship rows of a rejected node.
   */
  edges: ReviewModelEdge[];
  /**
   * The minimal per-node view (`id` + `review_status`). The resolver seeds the
   * already-persisted-rejected half of the reject-exclusivity union from the
   * nodes whose `review_status` is already `rejected`.
   */
  nodes: ReviewModelNode[];
}

// ===========================================================================
// Wire-shape contract manifest (drift guard)
// ===========================================================================

/**
 * The EXACT snake_case field paths the resolver depends on, declared as a runtime
 * manifest so the wire-shape CONTRACT TEST can pin them. If a field is renamed in
 * Spec 1's `reviewModel/types.ts` (or the frontend Group-5 mirror drifts), the
 * contract test that asserts these paths exist on a built sample fails loudly --
 * the two pure copies (gateway home + frontend mirror) cannot silently diverge.
 *
 * Mirrors the spirit of `scopeRefType.contractWithGateway.test.ts`: one declared
 * source of truth for the shared shape, drift caught at test-time.
 */
export const REVIEW_MODEL_WIRE_FIELDS = {
  /** Top-level keys the resolver reads off the model. */
  model: ['blast_radius', 'findings', 'aggregations', 'edges', 'nodes'] as const,
  /** Keys the resolver reads off each `blast_radius[]` entry. */
  blastRadiusEntry: ['candidate_id', 'dependents'] as const,
  /** Keys the resolver reads off each `blast_radius[].dependents[]` entry. */
  blastRadiusDependent: ['dependent_id', 'via_edge_kind', 'via_predecessor_id'] as const,
  /** Keys the resolver reads off each `findings[]` entry. */
  findingNode: ['id', 'candidate_link_ids'] as const,
  /** Keys the resolver reads off each `edges[]` entry (the in-adjacency + marking link). */
  edge: ['edge_kind', 'from_id', 'to_id', 'relationship_candidate_id'] as const,
  /** Keys the resolver reads off each `nodes[]` entry (the already-rejected seed). */
  node: ['id', 'review_status'] as const,
} as const;
