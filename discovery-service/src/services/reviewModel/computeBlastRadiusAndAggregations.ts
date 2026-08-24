/**
 * Surface-only blast-radius + aggregation computation (Spec 1, Group 2).
 *
 * Pure. Operates ONLY on the in-memory nodes/edges/findings the builder already
 * produced — never re-reads candidates, never mutates status. The blast radius
 * is a HYPOTHETICAL "would affect" set (Spec 1 never executes a reject; that is
 * Spec 2). The output shapes are exactly what Spec 2's preview→confirm renders.
 */

import type {
  BlastRadiusDependent,
  BlastRadiusEntry,
  EdgeKind,
  NodeMetric,
  ReviewFindingNode,
  ReviewModelAggregations,
  ReviewModelEdge,
  ReviewModelNode,
} from './types';

// ---------------------------------------------------------------------------
// Blast radius (Tasks 2.2 + 2.3)
// ---------------------------------------------------------------------------

/**
 * The logical↔physical MAPPING edge kinds. The blast-radius cascade intentionally
 * does NOT cross these (Spec 2026-06-08, "don't cross layers on approve"):
 * approving/rejecting a LOGICAL entity must NOT cascade into the PHYSICAL layer
 * (and vice-versa) — logical and physical are reviewed as SEPARATE families, so a
 * 1-entity/10-attribute logical family no longer drags in all 130 columns of a
 * name-matched table. The mapping edges REMAIN in `model.edges` (the gateway
 * surfaces the connection as an informational cross-layer note on the chunk + the
 * cross-scan links agenda section); ONLY the blast-radius traversal skips them.
 * Both the same-run mapping edges and the synthetic cross-scan edges
 * (`scanSelection.computeCrossScanEdges`) carry these two kinds.
 */
const CROSS_LAYER_MAPPING_EDGE_KINDS: ReadonlySet<EdgeKind> = new Set<EdgeKind>([
  'logical_data_entity_physical_data_entities',
  'logical_data_attribute_physical_data_attributes',
]);

/**
 * Adjacency from a node id to its outgoing edges (direction `from_id`→`to_id`),
 * EXCLUDING the logical↔physical mapping edges so the blast-radius cascade stays
 * within a single layer (see {@link CROSS_LAYER_MAPPING_EDGE_KINDS}).
 */
function buildOutAdjacency(
  edges: readonly ReviewModelEdge[],
): Map<string, Array<{ to: string; kind: EdgeKind }>> {
  const out = new Map<string, Array<{ to: string; kind: EdgeKind }>>();
  for (const e of edges) {
    if (CROSS_LAYER_MAPPING_EDGE_KINDS.has(e.edge_kind)) continue; // never cross layers
    let list = out.get(e.from_id);
    if (!list) {
      list = [];
      out.set(e.from_id, list);
    }
    list.push({ to: e.to_id, kind: e.edge_kind });
  }
  return out;
}

/**
 * Downward transitive closure from `startId` following edge direction. Returns
 * the dependent set (EXCLUDING the start node), each dependent tagged with the
 * edge_kind + immediate predecessor that FIRST reached it. Cycle-safe via the
 * visited-set: a node is recorded once (its first-reaching edge) and never
 * re-expanded, so a relationship cycle cannot loop forever.
 */
function downwardClosure(
  startId: string,
  outAdj: Map<string, Array<{ to: string; kind: EdgeKind }>>,
): BlastRadiusDependent[] {
  const dependents: BlastRadiusDependent[] = [];
  const visited = new Set<string>([startId]); // never re-add / re-expand the start
  // BFS queue holding the node to expand.
  const queue: string[] = [startId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const neighbours = outAdj.get(current);
    if (!neighbours) continue;
    for (const { to, kind } of neighbours) {
      if (visited.has(to)) continue; // already reached (or the start) ⇒ skip
      visited.add(to);
      dependents.push({
        dependent_id: to,
        via_edge_kind: kind,
        via_predecessor_id: current,
      });
      queue.push(to);
    }
  }
  return dependents;
}

/**
 * Compute, per candidate, the surface-only downward blast radius + the advisory
 * would-be-orphan parents.
 *
 * Would-be-orphan (child→parent, advisory ONLY): a parent is flagged when, under
 * the hypothesis that THIS candidate is rejected on top of the already-rejected
 * set, EVERY one of that parent's `parent_child` children is in the reject set.
 * The parent is NEVER added to the hard downward radius.
 */
export function computeBlastRadii(
  nodes: readonly ReviewModelNode[],
  edges: readonly ReviewModelEdge[],
): BlastRadiusEntry[] {
  const outAdj = buildOutAdjacency(edges);

  // Index parent → its structural children (parent_child edges only).
  const childrenByParent = new Map<string, string[]>();
  // Index child → its structural parent (for the orphan check).
  const parentByChild = new Map<string, string>();
  for (const e of edges) {
    if (e.edge_kind !== 'parent_child') continue;
    let kids = childrenByParent.get(e.from_id);
    if (!kids) {
      kids = [];
      childrenByParent.set(e.from_id, kids);
    }
    kids.push(e.to_id);
    parentByChild.set(e.to_id, e.from_id);
  }

  // The currently-rejected node set (read-only — from persisted review_status).
  const rejectedNow = new Set<string>(
    nodes.filter((n) => n.review_status === 'rejected').map((n) => n.id),
  );

  const out: BlastRadiusEntry[] = [];
  for (const node of nodes) {
    const dependents = downwardClosure(node.id, outAdj);

    // Would-be-orphan advisory: parents whose ALL children fall in the reject
    // set { already-rejected } ∪ { this candidate } ∪ { its downward dependents
    // that are structural children }. We consider the candidate itself + the
    // already-rejected set (Spec 1 surfaces what a reject of THIS candidate would
    // imply; the hard cascade is Spec 2). A parent qualifies when every one of
    // its children is in that set.
    const rejectSet = new Set<string>(rejectedNow);
    rejectSet.add(node.id);
    // Candidate parents to test: the structural parents of every node in the
    // reject set (only those can become orphaned by this reject).
    const wouldBeOrphaned: string[] = [];
    const seenParents = new Set<string>();
    for (const rejectedId of rejectSet) {
      const parent = parentByChild.get(rejectedId);
      if (!parent || seenParents.has(parent)) continue;
      seenParents.add(parent);
      // The parent itself must NOT be in the reject set (a rejected parent is not
      // "orphaned" — it is gone).
      if (rejectSet.has(parent)) continue;
      const kids = childrenByParent.get(parent) ?? [];
      if (kids.length === 0) continue;
      if (kids.every((k) => rejectSet.has(k))) {
        wouldBeOrphaned.push(parent);
      }
    }

    out.push({
      candidate_id: node.id,
      dependents,
      would_be_orphaned_parent_ids: wouldBeOrphaned,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Aggregations (Task 2.4)
// ---------------------------------------------------------------------------

/** Increment a `<label> → count` bucket. */
function bump(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1;
}

/**
 * Compute the aggregation dimensions over the unified candidate + finding set,
 * plus per-node degree + blast-radius size. The live-conflict partition uses the
 * node's precomputed `has_live_conflict` (which matches the grid's
 * `getUnresolvedConflicts` predicate exactly).
 */
export function computeAggregations(
  nodes: readonly ReviewModelNode[],
  edges: readonly ReviewModelEdge[],
  findings: readonly ReviewFindingNode[],
  blastRadius: readonly BlastRadiusEntry[],
  /** Relationship-row candidate count (graph edges, still selectable rows). */
  relationshipRowCount = 0,
): ReviewModelAggregations {
  const by_candidate_type: Record<string, number> = {};
  const by_review_status: Record<string, number> = {};
  const by_source_tier: Record<string, number> = {};
  const by_conflict_state: Record<'live_conflict' | 'clean', number> = { live_conflict: 0, clean: 0 };
  const by_merge_group: Record<'merged' | 'singleton', number> = { merged: 0, singleton: 0 };
  const by_scan_kind: Record<string, number> = {};
  const by_operation: Record<string, number> = {};

  // "merged" = a node whose identity key is shared by ≥2 nodes in the unified
  // set (the merge-group dimension keys on identity, mirroring Spec 0's merge).
  const keyCounts = new Map<string, number>();
  for (const n of nodes) keyCounts.set(n.merge_group_key, (keyCounts.get(n.merge_group_key) ?? 0) + 1);

  const sourceTierLabels = new Set<string>();
  let committed_count = 0;
  let actionable_count = 0;
  let live_conflict_count = 0;

  for (const n of nodes) {
    bump(by_candidate_type, n.candidate_type);
    bump(by_review_status, n.review_status);
    bump(by_source_tier, n.source_tier);
    sourceTierLabels.add(n.source_tier);
    bump(by_scan_kind, n.scan_kind);
    bump(by_operation, n.operation);

    if (n.conflict_state.has_live_conflict) {
      by_conflict_state.live_conflict += 1;
      live_conflict_count += 1;
    } else {
      by_conflict_state.clean += 1;
    }

    if ((keyCounts.get(n.merge_group_key) ?? 0) >= 2) by_merge_group.merged += 1;
    else by_merge_group.singleton += 1;

    if (n.committed) committed_count += 1;
    else actionable_count += 1;
  }

  // Findings dimensions.
  const findings_by_severity: Record<string, number> = {};
  const findings_by_review_status: Record<string, number> = {};
  for (const f of findings) {
    bump(findings_by_severity, f.severity);
    bump(findings_by_review_status, f.review_status);
  }

  // Per-node degree + blast-radius size.
  const node_metrics: Record<string, NodeMetric> = {};
  for (const n of nodes) {
    node_metrics[n.id] = { in_degree: 0, out_degree: 0, blast_radius_size: 0 };
  }
  for (const e of edges) {
    if (node_metrics[e.from_id]) node_metrics[e.from_id].out_degree += 1;
    if (node_metrics[e.to_id]) node_metrics[e.to_id].in_degree += 1;
  }
  for (const entry of blastRadius) {
    if (node_metrics[entry.candidate_id]) {
      node_metrics[entry.candidate_id].blast_radius_size = entry.dependents.length;
    }
  }

  return {
    total_candidates: nodes.length,
    total_candidates_all_types: nodes.length + relationshipRowCount,
    total_findings: findings.length,
    by_candidate_type,
    by_review_status,
    by_source_tier,
    by_conflict_state,
    by_merge_group,
    by_scan_kind,
    by_operation,
    findings_by_severity,
    findings_by_review_status,
    committed_count,
    actionable_count,
    live_conflict_count,
    source_tier_labels: [...sourceTierLabels],
    node_metrics,
  };
}
