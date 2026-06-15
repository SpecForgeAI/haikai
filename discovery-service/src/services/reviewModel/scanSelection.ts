/**
 * Scan-selection union + cross-scan edges + findings bridge (Spec 1, Group 3).
 *
 * Pure. The union itself (candidates + findings across ≤1 code + ≤1 DB run) is
 * driven by the builder's per-run loop; this module provides:
 *   - {@link buildFindingNodes}: bridge findings → candidate nodes via
 *     `DiscoveryFindingDto.links[]` (`target_type === 'discovery_candidate'` →
 *     `target_id`), carrying the Spec F review status / severity / category;
 *   - {@link computeCrossScanEdges}: the cross-scan logical↔physical edges (only
 *     when BOTH a code run and a DB run are present), honoring the meta-model's
 *     EXPLICIT non-1:1 mapping (never assume 1:1).
 */

import { normalizeName } from '../prompts/dedup';
import type { SurvivorIndex } from './buildReviewModel';
import type {
  ReviewFindingNode,
  ReviewModelEdge,
  ReviewModelNode,
  ScanKind,
  ScanRunInput,
} from './types';

// ---------------------------------------------------------------------------
// Findings bridge (Task 3.4)
// ---------------------------------------------------------------------------

/**
 * Build one {@link ReviewFindingNode} per finding across all selected runs,
 * carrying its review status / severity / category and the candidate node ids it
 * links to. The candidate links resolve via `DiscoveryFindingDto.links[]` where
 * `target_type === 'discovery_candidate'` → `target_id`; only links whose target
 * is actually a node in the model are carried (a link to a non-node target is
 * dropped, since the model has no such node to bridge to).
 */
export function buildFindingNodes(
  runs: readonly ScanRunInput[],
  nodeIds: ReadonlySet<string>,
): ReviewFindingNode[] {
  const out: ReviewFindingNode[] = [];
  for (const run of runs) {
    for (const f of run.findings) {
      const candidate_link_ids: string[] = [];
      for (const link of f.links ?? []) {
        if (link.targetType === 'discovery_candidate' && nodeIds.has(link.targetId)) {
          if (!candidate_link_ids.includes(link.targetId)) {
            candidate_link_ids.push(link.targetId);
          }
        }
      }
      out.push({
        id: f.id,
        review_status: f.reviewStatus,
        severity: f.severity,
        category: f.category,
        finding_type: f.findingType,
        candidate_link_ids,
        run_id: run.run_id,
        scan_kind: run.scan_kind,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Cross-scan logical↔physical edges (Task 3.3)
// ---------------------------------------------------------------------------

/** Index nodes of a given (scan_kind, candidate_type) by normalized name → ids. */
function indexByName(
  nodes: readonly ReviewModelNode[],
  scanKind: ScanKind,
  candidateType: string,
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const n of nodes) {
    if (n.scan_kind !== scanKind) continue;
    if (n.candidate_type !== candidateType) continue;
    const key = normalizeName(n.name);
    let ids = out.get(key);
    if (!ids) {
      ids = [];
      out.set(key, ids);
    }
    ids.push(n.id);
  }
  return out;
}

/**
 * Compute cross-scan logical↔physical edges spanning a code run's logical
 * entities ↔ a DB run's physical entities (only when BOTH a code run and a DB
 * run are present).
 *
 * The two scans live in SEPARATE runs, so there is no relationship-row candidate
 * bridging them — the edge is synthesized by matching a code-scan logical entity
 * to DB-scan physical entities BY NAME (normalized DTO type name ↔ table name),
 * exactly as the in-run `logical_data_entity_physical_data_entities` resolves its
 * physical side by table name.
 *
 * Non-1:1 is HONORED: a logical entity matching N physical entities emits N
 * edges (and vice versa); we never collapse to a single mapping. The edge
 * `relationship_candidate_id` is a synthetic `xscan:<from>:<to>` id (there is no
 * underlying candidate row), and `cross_scan` is TRUE.
 */
export function computeCrossScanEdges(
  runs: readonly ScanRunInput[],
  _survivors: SurvivorIndex,
  nodes: readonly ReviewModelNode[],
): ReviewModelEdge[] {
  const kinds = new Set<ScanKind>(runs.map((r) => r.scan_kind));
  if (!(kinds.has('code') && kinds.has('database'))) {
    // Single-run (or two same-kind, which the endpoint rejects): no cross-scan.
    return [];
  }

  const edges: ReviewModelEdge[] = [];

  // --- Entity-level: code logical_data_entities ↔ DB physical_data_entities ---
  const physEntitiesByName = indexByName(nodes, 'database', 'physical_data_entities');
  for (const n of nodes) {
    if (n.scan_kind !== 'code' || n.candidate_type !== 'logical_data_entities') continue;
    const matches = physEntitiesByName.get(normalizeName(n.name));
    if (!matches) continue;
    for (const physId of matches) {
      edges.push({
        edge_kind: 'logical_data_entity_physical_data_entities',
        from_id: n.id,
        to_id: physId,
        relationship_candidate_id: `xscan:${n.id}:${physId}`,
        cross_scan: true,
      });
    }
  }

  // --- Attribute-level: code logical_data_attributes ↔ DB physical_data_attributes ---
  const physAttrsByName = indexByName(nodes, 'database', 'physical_data_attributes');
  for (const n of nodes) {
    if (n.scan_kind !== 'code' || n.candidate_type !== 'logical_data_attributes') continue;
    const matches = physAttrsByName.get(normalizeName(n.name));
    if (!matches) continue;
    for (const physId of matches) {
      edges.push({
        edge_kind: 'logical_data_attribute_physical_data_attributes',
        from_id: n.id,
        to_id: physId,
        relationship_candidate_id: `xscan:${n.id}:${physId}`,
        cross_scan: true,
      });
    }
  }

  return edges;
}
