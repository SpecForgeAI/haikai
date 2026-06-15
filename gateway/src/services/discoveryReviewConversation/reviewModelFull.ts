/**
 * Full review-model WIRE shape consumed by the discovery-review conversation
 * (Spec 3 — capstone). A gateway-local SUPERSET of the resolver's minimal
 * `discovery/reviewModelWire.ts` view: it adds the node-level fields the agenda
 * sequencer + the read-only tools read (nodes with `conflict_state`,
 * `candidate_type`, `scan_kind`, `run_id`; finding nodes with `severity`; the
 * full `aggregations`). The resolver's `ReviewModelWire` is structurally a
 * subset of this shape, so a `FullReviewModelWire` value is assignable to it —
 * the `preview` tool hands this straight to `resolveBulkActionSet`.
 *
 * SOURCE OF TRUTH for the shape is Spec 1's
 * `discovery-service/src/services/reviewModel/types.ts`. This module is a
 * deliberate, MINIMAL gateway-local MIRROR of the subset the conversation
 * touches. The gateway does NOT import the discovery-service source across the
 * package boundary; the agenda-ordering tests pin the field paths the
 * sequencer depends on against a built fixture.
 *
 * WIRE FORMAT: snake_case verbatim (AMS/discovery-service speak snake_case at
 * the wire; the model serializes with `JSON.stringify` — there is NO mapper).
 * These interfaces are written snake_case to match field-for-field.
 *
 * NO NEW COMPUTATION (per Decision 10 / Out of Scope): the conversation reads
 * `conflict_state.has_live_conflict`, per-candidate `blast_radius`, and the
 * `aggregations` Spec 1 already computed — it never re-derives any of them.
 */

import type {
  BlastRadiusEntry,
  EdgeKind,
  ReviewFindingNode as ResolverFindingNode,
  ReviewModelAggregations as ResolverAggregations,
  ReviewModelWire,
} from '../discovery/reviewModelWire';

export type { EdgeKind, BlastRadiusEntry };

/** The originating scan kind of a node/finding's run. */
export type ScanKind = 'code' | 'database';

/**
 * The Spec 0 conflict lens carried on each node (the subset the conversation
 * reads). `has_live_conflict` is the precomputed predicate the agenda
 * sequencer keys "live conflicts" off — it MUST NOT be recomputed here.
 */
export interface NodeConflictState {
  /** TRUE iff ≥1 attribute has an unresolved conflict (Spec 1 precomputed). */
  has_live_conflict: boolean;
  /** The attribute names that are still live (unresolved) conflicts. */
  live_conflict_attrs: string[];
  /** The raw Spec 0 `data._conflicts` map (or null when absent). */
  conflicts: Record<string, Array<{ value: unknown; source: string }>> | null;
  /** The raw Spec 0 `data._conflictResolutions` map (or null when absent). */
  conflict_resolutions: Record<
    string,
    { chosenValue: unknown; chosenSource: string; resolvedBy: string; resolvedAt: string }
  > | null;
}

/** One review-model node (one per candidate, EXCLUDING `*_points` wrappers). */
export interface ReviewModelNode {
  /** AMS candidate id — globally unique node id across runs. */
  id: string;
  /** The candidate's meta-model type. */
  candidate_type: string;
  /** Display name. */
  name: string;
  /**
   * Class-qualified display name for method-level candidates (`business_logics`),
   * e.g. `OrderService.createView`. Present only when the candidate carries a
   * className; the agenda uses it as the chunk row label so same-named methods in
   * different classes are visibly distinct. Absent → fall back to `name`.
   */
  qualified_name?: string;
  /** The Spec F review status (verbatim AMS value). */
  review_status: string;
  /** TRUE when promoted to the canonical model (`status === 'committed'`). */
  committed: boolean;
  /** The Spec 0 conflict lens (precomputed predicate + raw maps). */
  conflict_state: NodeConflictState;
  /** The merge-group identity key this node collapsed under. */
  merge_group_key: string;
  /** The source tier of the best `_addedBy` label. */
  source_tier: string;
  /** The originating scan kind. */
  scan_kind: ScanKind;
  /** The run id this candidate belongs to. */
  run_id: string;
}

/** One review-model finding node (the subset the conversation reads). */
export interface ReviewModelFindingNode extends ResolverFindingNode {
  /** The Spec F review status. */
  review_status: string;
  /** Severity (AMS verbatim, e.g. info/low/medium/high/critical). */
  severity: string;
  /** Category (AMS verbatim). */
  category: string;
  /** Finding type (AMS verbatim). */
  finding_type: string;
  /** The run id this finding belongs to. */
  run_id: string;
  /** The originating scan kind. */
  scan_kind: ScanKind;
}

/** One typed directed edge (the subset the cross-scan section reads). */
export interface ReviewModelEdge {
  edge_kind: EdgeKind;
  from_id: string;
  to_id: string;
  relationship_candidate_id: string;
  /** TRUE for a cross-scan (code↔DB) logical↔physical edge. */
  cross_scan: boolean;
}

/** The full aggregations dimension set (superset of the resolver's view). */
export interface FullReviewModelAggregations extends ResolverAggregations {
  by_candidate_type?: Record<string, number>;
  by_review_status?: Record<string, number>;
  by_conflict_state?: Record<string, number>;
  by_scan_kind?: Record<string, number>;
  findings_by_severity?: Record<string, number>;
  findings_by_review_status?: Record<string, number>;
  node_metrics?: Record<
    string,
    { in_degree: number; out_degree: number; blast_radius_size: number }
  >;
}

/**
 * The full review-model wire shape the conversation consumes. A SUPERSET of the
 * resolver's `ReviewModelWire` (which needs `blast_radius` + `findings` +
 * `aggregations` + the raw `edges` in-adjacency + the per-node `review_status`),
 * so `toResolverModel` below is a no-op widening cast.
 */
export interface FullReviewModelWire {
  scan_selection?: Array<{ run_id: string; scan_kind: ScanKind }>;
  nodes: ReviewModelNode[];
  edges: ReviewModelEdge[];
  findings: ReviewModelFindingNode[];
  blast_radius: BlastRadiusEntry[];
  aggregations: FullReviewModelAggregations;
}

/**
 * Narrow a full review model to the resolver's input view. The resolver reads
 * `blast_radius`, `findings`, `aggregations`, the raw `edges` (the in-adjacency
 * the reject-exclusivity walk builds), and the per-node `review_status` (seeding
 * the already-rejected half of the exclusivity union) — all present on the full
 * shape — so this is a structural widening, not a copy.
 *
 * The full `edges` carry an extra `cross_scan` flag and the full `nodes` carry
 * many more fields than the resolver's minimal `{ id, review_status }` view; both
 * are structurally assignable to the narrower resolver shapes (passthrough
 * values, no excess-property check). The forward is pure passthrough — no
 * transform.
 */
export function toResolverModel(model: FullReviewModelWire): ReviewModelWire {
  return {
    blast_radius: model.blast_radius ?? [],
    findings: model.findings ?? [],
    aggregations: model.aggregations ?? {},
    edges: model.edges ?? [],
    nodes: model.nodes ?? [],
  };
}
