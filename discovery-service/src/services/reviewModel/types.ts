/**
 * Deterministic review-model + cascade/dependency-graph + aggregation types
 * (Spec 1 — Deterministic Review Model + Cascade/Dependency Graph + Aggregation
 * Backbone, of the discovery-review-unification program F → 0 → 1 → 2 → 3).
 *
 * This module DEFINES the in-memory model object the read endpoint serializes.
 * It is computed LIVE on read from the AMS candidates + findings and is NEVER
 * persisted (no graph table, no AMS schema change). The whole model is a pure
 * function of its inputs (no I/O, no LLM, no mutation of candidate/finding rows).
 *
 * The shape is deliberately downstream-ready:
 *   - Spec 2 (cascade-aware bulk apply, preview→confirm) consumes
 *     `blast_radius` (per-dependent edge provenance) verbatim.
 *   - Spec 3 (conversational Architect persona) consumes the unified node/finding
 *     set + `aggregations` as its shared backbone.
 *
 * WIRE FORMAT: AMS speaks snake_case at the wire by default (repo `CLAUDE.md`),
 * so every field that crosses the read endpoint is snake_case. These TypeScript
 * interfaces are written snake_case so the model object serializes verbatim with
 * `JSON.stringify` / `res.json(model)` — there is NO camelCase→snake_case mapper
 * on the way out.
 *
 * Reuses the Spec 0 primitives directly (NEVER re-derives identity / tier /
 * conflict logic):
 *   - `candidateIdentity.ts`  — `buildIdentityKey`, `classifySourceTier`,
 *                               `SOURCE_TIER_RANK`, `readAddedBy`, `SourceTier`.
 *   - `candidateMerge.ts` shape — the `CandidateMergeData` conflict/provenance/
 *                               merge-group lens in `../../types/candidate`.
 *   - `candidateReconcile.ts` — the name→survivor resolution rule + drop-orphan
 *                               behaviour mirrored by the relationship-row edges.
 */

import type {
  CandidateType,
  CandidateOperation,
  ConflictingValue,
  ConflictResolution,
} from '../../types/candidate';
import type { SourceTier } from '../candidateIdentity';

// ===========================================================================
// Shared vocabulary
// ===========================================================================

/**
 * The Spec F review-status vocabulary, shared by BOTH candidates and findings.
 * AMS may persist legacy aliases on candidate rows (`proposed`/`accepted`);
 * `pending_review` is the canonical "needs review" value. The model carries the
 * value verbatim (a `string` widening is intentional so any future status value
 * round-trips without a type bump) but documents the canonical set here.
 */
export type ReviewStatus =
  | 'pending_review'
  | 'approved'
  | 'rejected'
  | 'deferred';

/** The originating scan kind of the run a node/finding came from. */
export type ScanKind = 'code' | 'database';

// ===========================================================================
// Edge taxonomy (the `edge_kind` discriminator)
// ===========================================================================

/**
 * The typed-edge discriminator. `parent_child` is the structural
 * `parentCandidateId` edge; the remaining six are the relationship-row kinds
 * enumerated in `../../types/candidate` (note `data_movements` REUSES the
 * existing outbound-integration relationship type — it is NOT a new type).
 *
 * Per-kind direction (`from_id` → `to_id`):
 *   - `parent_child`                                   : parent → child
 *   - `interface_logical_entities`                     : interface → logical entity
 *   - `endpoint_data_effects`                          : endpoint → data entity
 *   - `logical_data_entity_physical_data_entities`     : logical entity → physical entity
 *   - `logical_data_attribute_physical_data_attributes`: logical attribute → physical attribute
 *   - `logical_data_entity_relationships`              : parent entity → child entity
 *   - `data_movements`                                 : source (endpoint/service) → target
 */
export type EdgeKind =
  | 'parent_child'
  | 'interface_logical_entities'
  | 'endpoint_data_effects'
  | 'logical_data_entity_physical_data_entities'
  | 'logical_data_attribute_physical_data_attributes'
  | 'logical_data_entity_relationships'
  | 'data_movements';

/** The six relationship-row candidate types that map 1:1 to an `EdgeKind`. */
export const RELATIONSHIP_EDGE_KINDS: ReadonlySet<CandidateType> = new Set<CandidateType>([
  'interface_logical_entities',
  'endpoint_data_effects',
  'logical_data_entity_physical_data_entities',
  'logical_data_attribute_physical_data_attributes',
  'logical_data_entity_relationships',
  'data_movements',
]);

/**
 * The polymorphic `*_points` wrapper types — backend auto-managed, NEVER nodes
 * or edges anywhere in the graph. Candidates of these types are excluded from
 * the node-set entirely. (Discovery never actually mints these as candidates,
 * but the exclusion is defensive + self-documenting.)
 */
export const POINTS_WRAPPER_TYPES: ReadonlySet<string> = new Set<string>([
  'application_points',
  'data_entity_points',
  'business_points',
  'app_business_points',
]);

// ===========================================================================
// Nodes
// ===========================================================================

/**
 * The conflict lens carried on each node — the Spec 0 `CandidateMergeData`
 * subset the grid + Spec 3 read, surfaced verbatim from `data._conflicts` /
 * `data._conflictResolutions`. `has_live_conflict` is the precomputed predicate
 * that MUST match the grid's `getUnresolvedConflicts` (a `_conflicts[attr]` with
 * no matching `_conflictResolutions[attr]`).
 */
export interface NodeConflictState {
  /** TRUE iff ≥1 attribute has an unresolved conflict (matches `getUnresolvedConflicts`). */
  has_live_conflict: boolean;
  /** The attribute names that are still live (unresolved) conflicts. */
  live_conflict_attrs: string[];
  /** The raw Spec 0 `data._conflicts` map (or `null` when absent). */
  conflicts: Record<string, ConflictingValue[]> | null;
  /** The raw Spec 0 `data._conflictResolutions` map (or `null` when absent). */
  conflict_resolutions: Record<string, ConflictResolution> | null;
}

/** The Spec 0 provenance lens carried on each node. */
export interface NodeProvenance {
  /** Union of contributing source labels (`data._addedBy`, array-normalized). */
  added_by: string[];
  /** Ids of the source candidates folded into this survivor (`data._mergedFrom`). */
  merged_from: string[];
}

/**
 * One review-model node — one per candidate (EXCLUDING `*_points` wrappers).
 * All attributes are read via the reused Spec 0 primitives.
 */
export interface ReviewModelNode {
  /** AMS candidate id — globally unique, used as the node id across runs. */
  id: string;
  /** The candidate's meta-model type. */
  candidate_type: CandidateType;
  /** Display name. */
  name: string;
  /**
   * A CLASS-QUALIFIED display name for method-level candidates (`business_logics`),
   * e.g. `OrderService.createView`, built from `data.className` + `name`. Present
   * ONLY when the candidate carries a `className` (the meta-model method is
   * signature-less, so this is the human-distinguishing context the review room
   * shows so same-named methods in DIFFERENT classes are not mistaken for
   * duplicates). Absent for candidates with no class context; consumers fall back
   * to `name`.
   */
  qualified_name?: string;
  /**
   * The Spec F review status. Sourced from the candidate's persisted `status`
   * (read-only — Spec 1 never writes it). Carried as the canonical vocabulary
   * value; widened to `string` for forward tolerance of any AMS value.
   */
  review_status: string;
  /**
   * TRUE when the candidate has been promoted to the canonical model
   * (`status === 'committed'`). Drives the grid's committed/actionable counts.
   */
  committed: boolean;
  /** The Spec 0 conflict lens (precomputed live-conflict predicate + raw maps). */
  conflict_state: NodeConflictState;
  /** The Spec 0 provenance lens. */
  provenance: NodeProvenance;
  /**
   * The identity key this candidate's merge group collapsed under
   * (`buildIdentityKey`). Nodes sharing a key are the same real element across
   * sources — the merge-group aggregation dimension keys on this.
   */
  merge_group_key: string;
  /** The candidate operation dimension (`create`/`enrich`/`link`; default `create`). */
  operation: CandidateOperation;
  /** The source tier of the best `_addedBy` label (`classifySourceTier`). */
  source_tier: SourceTier;
  /** The originating scan kind (the run this candidate belongs to). */
  scan_kind: ScanKind;
  /** The run id this candidate belongs to (for two-run union disambiguation). */
  run_id: string;
}

// ===========================================================================
// Edges
// ===========================================================================

/**
 * One typed directed edge. `edge_kind` is the discriminator; `from_id`/`to_id`
 * are node ids with the per-kind direction documented on {@link EdgeKind}.
 *
 * `relationship_candidate_id` is the id of the relationship-ROW candidate that
 * produced the edge (absent for `parent_child`, which is derived from the child
 * candidate's `parentCandidateId` and so carries the CHILD id there for trace).
 *
 * `cross_scan` is TRUE only for logical↔physical edges that span the code run
 * and the DB run (computed only when both runs are present).
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
  /** TRUE for a cross-scan (code↔DB) logical↔physical edge. */
  cross_scan: boolean;
}

// ===========================================================================
// Findings
// ===========================================================================

/** One review-model finding node, unioned alongside the candidate nodes. */
export interface ReviewFindingNode {
  /** AMS finding id. */
  id: string;
  /** The Spec F review status (candidate-parity vocabulary). */
  review_status: string;
  /** Severity (AMS verbatim, e.g. `info`/`low`/`medium`/`high`/`critical`). */
  severity: string;
  /** Category (AMS verbatim). */
  category: string;
  /** Finding type (AMS verbatim). */
  finding_type: string;
  /**
   * The candidate node ids this finding links to, resolved from
   * `DiscoveryFindingDto.links[]` where `target_type === 'discovery_candidate'`
   * → `target_id`. Empty when the finding links to no candidate.
   */
  candidate_link_ids: string[];
  /** The run id this finding belongs to. */
  run_id: string;
  /** The originating scan kind of the run this finding belongs to. */
  scan_kind: ScanKind;
}

// ===========================================================================
// Blast radius (surface-only — Group 2)
// ===========================================================================

/**
 * One dependent reached by a candidate's reject/defer blast radius, recording
 * WHICH edge pulled it in (the shape Spec 2's preview→confirm renders).
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
 * closure of dependents a reject/defer WOULD affect (Spec 1 NEVER mutates
 * status — this is hypothetical), plus the advisory would-be-orphan parents.
 */
export interface BlastRadiusEntry {
  /** The candidate whose hypothetical reject this radius describes. */
  candidate_id: string;
  /**
   * The transitive set of dependents in the downward closure, each tagged with
   * the edge that pulled it in. Cycle-safe (visited-set). EXCLUDES the candidate
   * itself.
   */
  dependents: BlastRadiusDependent[];
  /**
   * ADVISORY-ONLY: parent ids that would be left with ALL children rejected if
   * this candidate (plus the rest of the reject set) were rejected. NEVER part
   * of the hard downward radius; child→parent is advisory only.
   */
  would_be_orphaned_parent_ids: string[];
}

// ===========================================================================
// Aggregations (Group 2)
// ===========================================================================

/** Per-node degree + blast-radius size, keyed by node id. */
export interface NodeMetric {
  /** Count of edges pointing INTO this node. */
  in_degree: number;
  /** Count of edges pointing OUT of this node. */
  out_degree: number;
  /** Size of this node's downward blast-radius dependent set. */
  blast_radius_size: number;
}

/**
 * The precomputed aggregation dimensions over the unified candidate + finding
 * set. Every map is `<bucket label> → count`. Counts are deterministic.
 */
export interface ReviewModelAggregations {
  /** Total candidate node count (excludes findings). */
  total_candidates: number;
  /** Total candidate count of ALL selectable types — nodes PLUS
   *  relationship-row candidates (endpoint_data_effects etc., which the
   *  graph models as edges). The bulk-action preview's "x of N" must use
   *  THIS (2026-08-24: a select-all of 1407 candidates rendered as
   *  "1407 of 820" because the node-only total excluded 586 effect
   *  rows — numerator and denominator counted different populations). */
  total_candidates_all_types: number;
  /** Total finding count. */
  total_findings: number;

  /** Candidate counts by `candidate_type`. */
  by_candidate_type: Record<string, number>;
  /** Candidate counts by `review_status`. */
  by_review_status: Record<string, number>;
  /** Candidate counts by source tier (`SourceTier`). */
  by_source_tier: Record<string, number>;
  /**
   * Candidate counts by conflict state: the two buckets `live_conflict` and
   * `clean` (matches the grid's `getUnresolvedConflicts` partition exactly).
   */
  by_conflict_state: Record<'live_conflict' | 'clean', number>;
  /**
   * Candidate counts by merge group: the two buckets `merged` (a node whose
   * identity key is shared by ≥2 nodes) and `singleton`.
   */
  by_merge_group: Record<'merged' | 'singleton', number>;
  /** Candidate counts by `scan_kind`. */
  by_scan_kind: Record<string, number>;
  /**
   * Candidate counts by `operation` (`create`/`enrich`/`link`). Cheap extra
   * rollup — NOT load-bearing.
   */
  by_operation: Record<string, number>;

  /** Finding counts by `severity`. */
  findings_by_severity: Record<string, number>;
  /** Finding counts by `review_status`. */
  findings_by_review_status: Record<string, number>;

  /**
   * Convenience scalars the grid header reads directly (kept in sync with the
   * grid's existing memos):
   *   - `committed` candidates,
   *   - `actionable` (non-committed) candidates,
   *   - `live_conflict` candidates (unresolved-conflict count),
   *   - the distinct source-tier labels present (the grid's `uniqueTierLabels`).
   */
  committed_count: number;
  actionable_count: number;
  live_conflict_count: number;
  source_tier_labels: string[];

  /** Per-node degree + blast-radius size, keyed by node id. */
  node_metrics: Record<string, NodeMetric>;
}

// ===========================================================================
// Top-level model
// ===========================================================================

/**
 * The complete deterministic review model returned by the read endpoint. The
 * scan selection that produced it is echoed in `scan_selection` so consumers
 * can confirm which run(s) were unioned.
 */
export interface ReviewModel {
  /** The run ids that were unioned, plus their kinds, in selection order. */
  scan_selection: Array<{ run_id: string; scan_kind: ScanKind }>;
  /** One node per candidate (excludes `*_points`). */
  nodes: ReviewModelNode[];
  /** The full typed-edge set (structural + relationship-row + cross-scan). */
  edges: ReviewModelEdge[];
  /** The unioned finding nodes. */
  findings: ReviewFindingNode[];
  /** Per-candidate surface-only blast radius (Group 2). */
  blast_radius: BlastRadiusEntry[];
  /** The precomputed aggregation dimensions (Group 2). */
  aggregations: ReviewModelAggregations;
}

// ===========================================================================
// Builder input shapes
// ===========================================================================

/**
 * One selected run's fetched inputs, tagged with its kind. The endpoint
 * (Group 4) fetches these via `archModelClient` and hands them to the builder;
 * the builder is pure over this shape so it is trivially unit-testable.
 */
export interface ScanRunInput {
  /** The run id. */
  run_id: string;
  /** The run's `discovery_kind` (code XOR database). */
  scan_kind: ScanKind;
  /** The run's candidates (as fetched / camelCase `DiscoveryCandidate`). */
  candidates: import('../../types/candidate').DiscoveryCandidate[];
  /** The run's findings (as fetched / camelCase `DiscoveryFindingDto`). */
  findings: import('../archModelClient').DiscoveryFindingDto[];
}
