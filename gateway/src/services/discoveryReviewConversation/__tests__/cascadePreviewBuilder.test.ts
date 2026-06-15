/**
 * Tests — the gateway-only rich cascade-preview builder
 * (Spec 2026-06-06-discovery-review-room-agenda-redesign-2, S2 / Task Group 2).
 *
 * The builder is PURE + CYCLE-SAFE and reuses the parity-tested resolver
 * `resolveBulkActionSet` AS-IS for the full-cascade reach. These 5 focused tests
 * pin ONLY the critical contract:
 *
 *   1. The per-type breakdown groups by `candidate_type` with the correct
 *      full-cascade `count` per type.
 *   2. `total` equals the full-cascade distinct-candidate count (== Σ byType.count).
 *   3. The three already-* sub-counts reflect each member's `review_status`
 *      independently (an approved member, a rejected member, a deferred member,
 *      and a pending member counted into NONE of the already-* buckets).
 *   4. The builder is CYCLE-SAFE on a model with a `parent_child` cycle (it
 *      terminates and returns a finite preview).
 *   5. A seed with no cascade (a lone family-of-one) yields a single-type preview
 *      of `total: 1`.
 */

import { buildCascadePreview } from '../cascadePreviewBuilder';
import type {
  BlastRadiusEntry,
  FullReviewModelWire,
  ReviewModelEdge,
  ReviewModelNode,
} from '../reviewModelFull';

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

const CODE_RUN = 'run-code';

function node(partial: Partial<ReviewModelNode> & { id: string }): ReviewModelNode {
  return {
    candidate_type: 'logical_data_attribute',
    name: partial.id,
    review_status: 'pending_review',
    committed: false,
    conflict_state: {
      has_live_conflict: false,
      live_conflict_attrs: [],
      conflicts: null,
      conflict_resolutions: null,
    },
    merge_group_key: partial.id,
    source_tier: 'code',
    scan_kind: 'code',
    run_id: CODE_RUN,
    ...partial,
  };
}

function parentChildEdge(parentId: string, childId: string): ReviewModelEdge {
  return {
    edge_kind: 'parent_child',
    from_id: parentId,
    to_id: childId,
    relationship_candidate_id: childId,
    cross_scan: false,
  };
}

/**
 * Assemble a model. `blast_radius` is given EXPLICITLY here (unlike the agenda
 * tests' zero-blast default) because the builder's whole job is to render the
 * full CASCADE — the cascade reach comes from `blast_radius[].dependents`, which
 * the resolver walks. A helper derives a downward blast radius straight from the
 * `parent_child` edges so the seed parent's "Approve All" pulls in its subtree.
 */
function model(
  nodes: ReviewModelNode[],
  edges: ReviewModelEdge[] = [],
  blast_radius?: BlastRadiusEntry[],
): FullReviewModelWire {
  return {
    scan_selection: [{ run_id: CODE_RUN, scan_kind: 'code' }],
    nodes,
    edges,
    findings: [],
    blast_radius: blast_radius ?? deriveBlastFromParentChild(nodes, edges),
    aggregations: { total_candidates: nodes.length, total_findings: 0 },
  };
}

/**
 * Derive a surface-only blast radius from `parent_child` edges: each parent's
 * radius is its DIRECT children (one BFS hop). The resolver does the transitive
 * walk, so chaining parent→child→grandchild radii gives the full subtree. This
 * mirrors how Spec 1 populates `blast_radius` for structural nesting.
 */
function deriveBlastFromParentChild(
  nodes: ReviewModelNode[],
  edges: ReviewModelEdge[],
): BlastRadiusEntry[] {
  const childrenByParent = new Map<string, string[]>();
  for (const e of edges) {
    if (e.edge_kind !== 'parent_child') continue;
    const bucket = childrenByParent.get(e.from_id);
    if (bucket) bucket.push(e.to_id);
    else childrenByParent.set(e.from_id, [e.to_id]);
  }
  return nodes.map((n) => ({
    candidate_id: n.id,
    dependents: (childrenByParent.get(n.id) ?? []).map((childId) => ({
      dependent_id: childId,
      via_edge_kind: 'parent_child' as const,
      via_predecessor_id: n.id,
    })),
    would_be_orphaned_parent_ids: [],
  }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('cascade-preview builder (Task Group 2)', () => {
  // 1 + 2 ---------------------------------------------------------------------
  it('groups the full cascade by candidate_type with correct per-type count, and total == sum of counts', () => {
    // interface(seed) → 2 endpoints (parent_child); each endpoint → 1 entity
    // (relationship-row edge that ALSO carries a blast dependent); entity → 2 attrs.
    const m = model(
      [
        node({ id: 'iface', candidate_type: 'interface', name: 'My Interface' }),
        node({ id: 'ep-1', candidate_type: 'endpoint', name: 'GET /a' }),
        node({ id: 'ep-2', candidate_type: 'endpoint', name: 'GET /b' }),
        node({ id: 'entity', candidate_type: 'logical_data_entity', name: 'Order' }),
        node({ id: 'attr-1', candidate_type: 'logical_data_attribute', name: 'id' }),
        node({ id: 'attr-2', candidate_type: 'logical_data_attribute', name: 'total' }),
      ],
      [
        parentChildEdge('iface', 'ep-1'),
        parentChildEdge('iface', 'ep-2'),
        parentChildEdge('entity', 'attr-1'),
        parentChildEdge('entity', 'attr-2'),
      ],
      // Explicit blast: iface → its 2 endpoints; ep-1 → entity (data binding);
      // entity → its 2 attrs. The resolver walks transitively from the iface seed.
      [
        {
          candidate_id: 'iface',
          dependents: [
            { dependent_id: 'ep-1', via_edge_kind: 'parent_child', via_predecessor_id: 'iface' },
            { dependent_id: 'ep-2', via_edge_kind: 'parent_child', via_predecessor_id: 'iface' },
          ],
          would_be_orphaned_parent_ids: [],
        },
        {
          candidate_id: 'ep-1',
          dependents: [
            {
              dependent_id: 'entity',
              via_edge_kind: 'endpoint_data_effects',
              via_predecessor_id: 'ep-1',
            },
          ],
          would_be_orphaned_parent_ids: [],
        },
        { candidate_id: 'ep-2', dependents: [], would_be_orphaned_parent_ids: [] },
        {
          candidate_id: 'entity',
          dependents: [
            { dependent_id: 'attr-1', via_edge_kind: 'parent_child', via_predecessor_id: 'entity' },
            { dependent_id: 'attr-2', via_edge_kind: 'parent_child', via_predecessor_id: 'entity' },
          ],
          would_be_orphaned_parent_ids: [],
        },
      ],
    );

    const preview = buildCascadePreview(['iface'], m);

    // total = the full cascade = iface + 2 endpoints + 1 entity + 2 attrs = 6.
    expect(preview.total).toBe(6);
    // total always equals the sum of the per-type counts.
    const summed = preview.byType.reduce((acc, row) => acc + row.count, 0);
    expect(summed).toBe(preview.total);

    // Per-type counts, keyed for an order-independent assertion.
    const byType = Object.fromEntries(preview.byType.map((r) => [r.type, r.count]));
    expect(byType).toEqual({
      interface: 1,
      endpoint: 2,
      logical_data_entity: 1,
      logical_data_attribute: 2,
    });
  });

  // 3 -------------------------------------------------------------------------
  it('the three already-* sub-counts reflect each member review_status independently', () => {
    // One entity (seed) with four attribute children, one already in each terminal
    // disposition + one pending. The attribute row must show 1/1/1 already-* and
    // the pending one in none.
    const m = model(
      [
        node({ id: 'entity', candidate_type: 'logical_data_entity', review_status: 'pending_review' }),
        node({ id: 'a-appr', candidate_type: 'logical_data_attribute', review_status: 'approved' }),
        node({ id: 'a-rej', candidate_type: 'logical_data_attribute', review_status: 'rejected' }),
        node({ id: 'a-def', candidate_type: 'logical_data_attribute', review_status: 'deferred' }),
        node({ id: 'a-pend', candidate_type: 'logical_data_attribute', review_status: 'pending_review' }),
      ],
      [
        parentChildEdge('entity', 'a-appr'),
        parentChildEdge('entity', 'a-rej'),
        parentChildEdge('entity', 'a-def'),
        parentChildEdge('entity', 'a-pend'),
      ],
    );

    const preview = buildCascadePreview(['entity'], m);

    expect(preview.total).toBe(5); // entity + 4 attrs

    const entityRow = preview.byType.find((r) => r.type === 'logical_data_entity');
    expect(entityRow).toEqual({
      type: 'logical_data_entity',
      count: 1,
      alreadyApproved: 0,
      alreadyRejected: 0,
      alreadyDeferred: 0,
    });

    const attrRow = preview.byType.find((r) => r.type === 'logical_data_attribute');
    // 4 attribute members: one already approved, one rejected, one deferred, one
    // pending (counted into none of the already-* buckets).
    expect(attrRow).toEqual({
      type: 'logical_data_attribute',
      count: 4,
      alreadyApproved: 1,
      alreadyRejected: 1,
      alreadyDeferred: 1,
    });
  });

  // 4 -------------------------------------------------------------------------
  it('is cycle-safe on a model with a parent_child cycle (terminates, finite preview)', () => {
    // A → B → A `parent_child` cycle (and matching cyclic blast radii). A naive
    // walk would loop forever; the resolver's visited-set bounds it, and the
    // builder's single linear pass over the touched set terminates.
    const m = model(
      [
        node({ id: 'A', candidate_type: 'interface' }),
        node({ id: 'B', candidate_type: 'endpoint' }),
      ],
      [parentChildEdge('A', 'B'), parentChildEdge('B', 'A')],
      [
        {
          candidate_id: 'A',
          dependents: [{ dependent_id: 'B', via_edge_kind: 'parent_child', via_predecessor_id: 'A' }],
          would_be_orphaned_parent_ids: [],
        },
        {
          candidate_id: 'B',
          dependents: [{ dependent_id: 'A', via_edge_kind: 'parent_child', via_predecessor_id: 'B' }],
          would_be_orphaned_parent_ids: [],
        },
      ],
    );

    const preview = buildCascadePreview(['A'], m);

    // Both nodes are touched exactly once despite the cycle.
    expect(preview.total).toBe(2);
    const byType = Object.fromEntries(preview.byType.map((r) => [r.type, r.count]));
    expect(byType).toEqual({ interface: 1, endpoint: 1 });
  });

  // 5 -------------------------------------------------------------------------
  it('a seed with no cascade yields a single-type preview of total 1', () => {
    const m = model([node({ id: 'orphan', candidate_type: 'service', name: 'Lonely' })], []);

    const preview = buildCascadePreview(['orphan'], m);

    expect(preview.total).toBe(1);
    expect(preview.byType).toEqual([
      {
        type: 'service',
        count: 1,
        alreadyApproved: 0,
        alreadyRejected: 0,
        alreadyDeferred: 0,
      },
    ]);
  });
});
