/**
 * Task Group 1 — Review-Model Types + Pure Node-Set + Typed-Edge Builder.
 *
 * Focused tests for the FOUNDATION behaviours only (the full edgeKind taxonomy,
 * cross-scan, blast-radius, and aggregation are covered in Groups 2-3):
 *   (a) each candidate becomes a node carrying review status, `committed`,
 *       conflict flags (from `data._conflicts`/`_conflictResolutions`),
 *       provenance (`_addedBy`/`_mergedFrom`), merge-group key, `operation`,
 *       candidate type, source tier (via `classifySourceTier`), and scan-kind;
 *   (b) a structural `parentCandidateId` → one `parent_child` edge, parent→child;
 *   (c) a name-keyed relationship row (`interface_logical_entities`) resolves its
 *       endpoint BY NAME → survivor via `buildIdentityKey`, and a row resolving
 *       to NO survivor is DROPPED (orphan), mirroring `candidateReconcile.ts`;
 *   (d) `*_points` rows produce NO node and NO edge.
 *   (e) every relationship-ROW edge kind carries `relationship_candidate_id` =
 *       the producing row candidate's id (Spec 2026-06-05-reject-cascade-
 *       correctness Task 4.3 gap-fill — the link the resolver's Group-3 surfacing
 *       follows).
 *
 * The module under test is PURE (no I/O), so these are plain unit tests.
 */

import { buildReviewModel } from '../buildReviewModel';
import type { ScanRunInput } from '../types';
import type { DiscoveryCandidate } from '../../../types/candidate';
import type { DiscoveryFindingDto } from '../../archModelClient';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function candidate(
  partial: Partial<DiscoveryCandidate> & Pick<DiscoveryCandidate, 'id' | 'candidateType' | 'name'>,
): DiscoveryCandidate {
  return {
    runId: 'run-code',
    confidence: 0.9,
    status: 'pending_review',
    sourceClusterIds: [],
    data: {},
    synthesizedAt: '2026-06-02T00:00:00Z',
    operation: 'create',
    ...partial,
  };
}

function codeRun(
  candidates: DiscoveryCandidate[],
  findings: DiscoveryFindingDto[] = [],
): ScanRunInput {
  return { run_id: 'run-code', scan_kind: 'code', candidates, findings };
}

// ===========================================================================
// (a) Node attributes
// ===========================================================================

describe('Group 1 — node-set attributes', () => {
  test('each candidate becomes a node carrying all reused-primitive attributes', () => {
    const svc = candidate({
      id: 'svc-1',
      candidateType: 'service',
      name: 'OrderService',
      // A committed candidate: lifecycle `status` is committed; its review
      // DISPOSITION (`reviewStatus`) is `approved` (you commit an approved row).
      status: 'committed',
      reviewStatus: 'approved',
      operation: 'enrich',
      data: {
        _addedBy: ['spring-classic-jaxrs'],
        _mergedFrom: ['svc-1', 'svc-1b'],
        _conflicts: {
          description: [
            { value: 'A', source: 'spring-classic-jaxrs' },
            { value: 'B', source: 'rest-wadl-pack' },
          ],
        },
      },
    });

    const model = buildReviewModel([codeRun([svc])]);

    expect(model.nodes).toHaveLength(1);
    const node = model.nodes[0];
    expect(node.id).toBe('svc-1');
    expect(node.candidate_type).toBe('service');
    expect(node.name).toBe('OrderService');
    // review_status is the DISPOSITION (approved), distinct from the committed
    // lifecycle flag below.
    expect(node.review_status).toBe('approved');
    expect(node.committed).toBe(true);
    expect(node.operation).toBe('enrich');
    // Source tier via classifySourceTier of the best _addedBy label.
    expect(node.source_tier).toBe('structural-framework-pack');
    expect(node.scan_kind).toBe('code');
    // Provenance lens straight off the merge keys.
    expect(node.provenance.added_by).toEqual(['spring-classic-jaxrs']);
    expect(node.provenance.merged_from).toEqual(['svc-1', 'svc-1b']);
    // Live conflict: `description` is conflicted with no resolution.
    expect(node.conflict_state.has_live_conflict).toBe(true);
    expect(node.conflict_state.live_conflict_attrs).toEqual(['description']);
    expect(node.conflict_state.conflicts).not.toBeNull();
    expect(node.conflict_state.conflict_resolutions).toBeNull();
  });

  test('a resolved conflict is NOT a live conflict (matches getUnresolvedConflicts)', () => {
    const svc = candidate({
      id: 'svc-2',
      candidateType: 'service',
      name: 'PayService',
      data: {
        _conflicts: {
          description: [
            { value: 'A', source: 'spring-classic-jaxrs' },
            { value: 'B', source: 'rest-wadl-pack' },
          ],
        },
        _conflictResolutions: {
          description: {
            chosenValue: 'A',
            chosenSource: 'spring-classic-jaxrs',
            resolvedBy: 'user-1',
            resolvedAt: '2026-06-02T01:00:00Z',
          },
        },
      },
    });

    const model = buildReviewModel([codeRun([svc])]);
    const node = model.nodes[0];
    expect(node.conflict_state.has_live_conflict).toBe(false);
    expect(node.conflict_state.live_conflict_attrs).toEqual([]);
    expect(node.conflict_state.conflict_resolutions).not.toBeNull();
  });
});

// ===========================================================================
// (b) Structural parent_child edge
// ===========================================================================

describe('Group 1 — structural parent_child edge', () => {
  test('a candidate with parentCandidateId emits one parent→child edge', () => {
    const iface = candidate({ id: 'iface-1', candidateType: 'interfaces', name: 'OrderController' });
    const ep = candidate({
      id: 'ep-1',
      candidateType: 'endpoints',
      name: 'GET /orders',
      parentCandidateId: 'iface-1',
    });

    const model = buildReviewModel([codeRun([iface, ep])]);

    const structural = model.edges.filter((e) => e.edge_kind === 'parent_child');
    expect(structural).toHaveLength(1);
    expect(structural[0].from_id).toBe('iface-1'); // parent
    expect(structural[0].to_id).toBe('ep-1'); // child
    expect(structural[0].relationship_candidate_id).toBe('ep-1'); // child carries the FK
    expect(structural[0].cross_scan).toBe(false);
  });

  test('a parentCandidateId pointing at a non-node (e.g. a *_points wrapper) emits no edge', () => {
    const ep = candidate({
      id: 'ep-2',
      candidateType: 'endpoints',
      name: 'GET /a',
      parentCandidateId: 'missing-parent',
    });
    const model = buildReviewModel([codeRun([ep])]);
    expect(model.edges.filter((e) => e.edge_kind === 'parent_child')).toHaveLength(0);
  });
});

// ===========================================================================
// (c) Name-keyed relationship-row edge → survivor + drop-orphan
// ===========================================================================

describe('Group 1 — relationship-row edge with name→survivor resolution', () => {
  test('interface_logical_entities resolves its logical-entity endpoint BY NAME to the survivor', () => {
    const iface = candidate({ id: 'iface-3', candidateType: 'interfaces', name: 'UserController' });
    const lde = candidate({ id: 'lde-1', candidateType: 'logical_data_entities', name: 'UserDto' });
    // The relationship row references the logical entity BY NAME (lower/space
    // tolerant — `buildIdentityKey` normalizes), and references the interface by
    // its parentCandidateId (the interface side).
    const rel = candidate({
      id: 'rel-1',
      candidateType: 'interface_logical_entities',
      name: 'UserController → UserDto',
      parentCandidateId: 'iface-3',
      data: { logicalEntityName: 'userdto' },
    });

    const model = buildReviewModel([codeRun([iface, lde, rel])]);

    const ile = model.edges.filter((e) => e.edge_kind === 'interface_logical_entities');
    expect(ile).toHaveLength(1);
    expect(ile[0].from_id).toBe('iface-3'); // interface
    expect(ile[0].to_id).toBe('lde-1'); // resolved survivor by name
    expect(ile[0].relationship_candidate_id).toBe('rel-1');
  });

  test('a relationship row whose endpoint resolves to NO survivor is DROPPED (orphan)', () => {
    const iface = candidate({ id: 'iface-4', candidateType: 'interfaces', name: 'GhostController' });
    const rel = candidate({
      id: 'rel-2',
      candidateType: 'interface_logical_entities',
      name: 'GhostController → MissingDto',
      parentCandidateId: 'iface-4',
      data: { logicalEntityName: 'MissingDto' }, // no logical_data_entities survivor of that name
    });

    const model = buildReviewModel([codeRun([iface, rel])]);
    expect(model.edges.filter((e) => e.edge_kind === 'interface_logical_entities')).toHaveLength(0);
  });
});

// ===========================================================================
// (d) *_points wrappers are never nodes or edges
// ===========================================================================

describe('Group 1 — *_points wrappers excluded', () => {
  test('application_points / data_entity_points candidates produce no node and no edge', () => {
    const svc = candidate({ id: 'svc-3', candidateType: 'service', name: 'Svc' });
    // Cast through unknown — these types are not in CandidateType, mirroring how
    // the backend never mints them as candidates; the builder must still exclude
    // anything whose type is in POINTS_WRAPPER_TYPES defensively.
    const ap = {
      ...candidate({ id: 'ap-1', candidateType: 'service', name: 'ap' }),
      candidateType: 'application_points',
    } as unknown as DiscoveryCandidate;
    const dep = {
      ...candidate({ id: 'dep-1', candidateType: 'service', name: 'dep', parentCandidateId: 'svc-3' }),
      candidateType: 'data_entity_points',
    } as unknown as DiscoveryCandidate;

    const model = buildReviewModel([codeRun([svc, ap, dep])]);

    expect(model.nodes.map((n) => n.id)).toEqual(['svc-3']);
    // No structural edge from the excluded data_entity_points child either.
    expect(model.edges).toHaveLength(0);
  });
});

// ===========================================================================
// (e) Every relationship-ROW edge kind carries relationship_candidate_id =
//     the producing ROW candidate's id (Spec 2026-06-05-reject-cascade-
//     correctness, Task 4.3 gap-fill).
//
// The reject-cascade resolver's Group-3 SURFACING + MARKING follows EVERY
// relationship-row edge's `relationship_candidate_id` to the row candidate it must
// mark `rejected` for a rejected node (no reconstruction by name). The existing
// (b)/(c) cases pin this for `parent_child` + `interface_logical_entities` only;
// the kinds the resolver surfaces most heavily — `endpoint_data_effects`,
// `data_movements`, `logical_data_entity_relationships` — were not pinned. These
// focused cases close that gap so a future change cannot silently emit a
// relationship-row edge with the WRONG (or empty) `relationship_candidate_id` and
// thereby break the resolver's marking link unnoticed.
// ===========================================================================

describe('Group 1 — relationship_candidate_id links every relationship-row edge to its row candidate', () => {
  test('endpoint_data_effects edge carries the effect ROW candidate id (the marking link)', () => {
    const ep = candidate({ id: 'ep-eff', candidateType: 'endpoints', name: 'GET /orders' });
    const lde = candidate({ id: 'lde-eff', candidateType: 'logical_data_entities', name: 'OrderDto' });
    const eff = candidate({
      id: 'eff-row',
      candidateType: 'endpoint_data_effects',
      name: 'GET /orders → OrderDto (read)',
      parentCandidateId: 'ep-eff',
      data: { endpointName: 'GET /orders', dataEntityName: 'OrderDto' },
    });

    const model = buildReviewModel([codeRun([ep, lde, eff])]);

    const edge = model.edges.find((e) => e.edge_kind === 'endpoint_data_effects');
    expect(edge).toBeDefined();
    expect(edge!.from_id).toBe('ep-eff'); // endpoint
    expect(edge!.to_id).toBe('lde-eff'); // resolved data entity by name
    // The link the resolver follows to surface + mark the row candidate.
    expect(edge!.relationship_candidate_id).toBe('eff-row');
  });

  test('data_movements edge carries the movement ROW candidate id (the marking link)', () => {
    const src = candidate({ id: 'svc-src', candidateType: 'service', name: 'OrderService' });
    const dst = candidate({ id: 'svc-dst', candidateType: 'service', name: 'PaymentService' });
    const mv = candidate({
      id: 'mv-row',
      candidateType: 'data_movements',
      name: 'OrderService → PaymentService',
      data: { sourceServiceName: 'OrderService', targetName: 'PaymentService' },
    });

    const model = buildReviewModel([codeRun([src, dst, mv])]);

    const edge = model.edges.find((e) => e.edge_kind === 'data_movements');
    expect(edge).toBeDefined();
    expect(edge!.from_id).toBe('svc-src'); // source service
    expect(edge!.to_id).toBe('svc-dst'); // resolved target service by name
    expect(edge!.relationship_candidate_id).toBe('mv-row');
  });

  test('logical_data_entity_relationships (peer) edge carries the relationship ROW candidate id (the marking link)', () => {
    const a = candidate({ id: 'lde-a', candidateType: 'logical_data_entities', name: 'Owner' });
    const b = candidate({ id: 'lde-b', candidateType: 'logical_data_entities', name: 'Pet' });
    const rel = candidate({
      id: 'rel-row',
      candidateType: 'logical_data_entity_relationships',
      name: 'Owner → Pet (one-to-many)',
      data: { sourceEntity: 'Owner', targetEntity: 'Pet' },
    });

    const model = buildReviewModel([codeRun([a, b, rel])]);

    const edge = model.edges.find((e) => e.edge_kind === 'logical_data_entity_relationships');
    expect(edge).toBeDefined();
    expect(edge!.from_id).toBe('lde-a'); // source entity
    expect(edge!.to_id).toBe('lde-b'); // target entity
    // The peer row is surfaced + marked even though the far entity survives — the
    // resolver needs this id present on the edge.
    expect(edge!.relationship_candidate_id).toBe('rel-row');
  });

  test('across a mixed model EVERY relationship-row edge carries a non-empty relationship_candidate_id equal to its row candidate id', () => {
    // One node-set + rows of two different relationship-row kinds.
    const ep = candidate({ id: 'm-ep', candidateType: 'endpoints', name: 'GET /a' });
    const lde1 = candidate({ id: 'm-lde1', candidateType: 'logical_data_entities', name: 'Alpha' });
    const lde2 = candidate({ id: 'm-lde2', candidateType: 'logical_data_entities', name: 'Beta' });
    const eff = candidate({
      id: 'm-eff',
      candidateType: 'endpoint_data_effects',
      name: 'GET /a → Alpha',
      parentCandidateId: 'm-ep',
      data: { endpointName: 'GET /a', dataEntityName: 'Alpha' },
    });
    const rel = candidate({
      id: 'm-rel',
      candidateType: 'logical_data_entity_relationships',
      name: 'Alpha → Beta',
      data: { sourceEntity: 'Alpha', targetEntity: 'Beta' },
    });

    const model = buildReviewModel([codeRun([ep, lde1, lde2, eff, rel])]);

    // The six relationship-row kinds the resolver surfaces/marks (everything that
    // is NOT a structural `parent_child` edge). For each such edge, the
    // relationship_candidate_id must be a non-empty string (the resolver guards
    // against empty, but the builder should never emit empty for a real row).
    const relationshipRowKinds = new Set([
      'interface_logical_entities',
      'endpoint_data_effects',
      'logical_data_entity_physical_data_entities',
      'logical_data_attribute_physical_data_attributes',
      'logical_data_entity_relationships',
      'data_movements',
    ]);
    const rowEdges = model.edges.filter((e) => relationshipRowKinds.has(e.edge_kind));
    expect(rowEdges.length).toBeGreaterThan(0);
    for (const edge of rowEdges) {
      expect(typeof edge.relationship_candidate_id).toBe('string');
      expect(edge.relationship_candidate_id.length).toBeGreaterThan(0);
    }
    // Spot-check the two emitted rows map to their producing candidate ids.
    const byKind = new Map(model.edges.map((e) => [e.edge_kind, e]));
    expect(byKind.get('endpoint_data_effects')!.relationship_candidate_id).toBe('m-eff');
    expect(byKind.get('logical_data_entity_relationships')!.relationship_candidate_id).toBe('m-rel');
  });
});
