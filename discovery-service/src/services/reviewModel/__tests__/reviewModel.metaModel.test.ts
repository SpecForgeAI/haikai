/**
 * Task Group 7 — Cross-Stack Verification & Gap Analysis.
 *
 * Meta-model conformance for the logical↔physical boundary. The logical and
 * physical layers are EXPLICITLY mapped (non-1:1) and that mapping is a typed
 * MODEL EDGE (`logical_data_entity_physical_data_entities` /
 * `logical_data_attribute_physical_data_attributes`) — but per Spec 2026-06-08
 * ("don't cross layers on approve") the blast-radius cascade intentionally does
 * NOT traverse that mapping: rejecting/approving a LOGICAL data entity stays in the
 * logical layer (its attributes via `parent_child`, the endpoints referencing it
 * via `endpoint_data_effects`), and NEVER drags the physical entity (and its 130
 * columns) into the same touched set. The connection is preserved as a model edge
 * (the gateway surfaces it as a cross-layer note on the chunk + the cross-scan
 * links agenda section) — it is simply not part of the cascade.
 *
 * These tests therefore assert BOTH halves of that contract:
 *   (a) the logical↔physical mapping EDGE is emitted (non-1:1 honored — one LDE →
 *       TWO physical entities → TWO edges); AND
 *   (b) the physical entity is NOT in the LDE's blast radius (layers don't cascade).
 * Within-layer fan-out (attributes via `parent_child`, the inbound endpoint effect)
 * is unchanged and still asserted.
 *
 * Driven through the full `buildReviewModel` so the real edge resolution +
 * closure are exercised. Pure; no I/O.
 */

import { buildReviewModel } from '../buildReviewModel';
import type { ScanRunInput } from '../types';
import type { DiscoveryCandidate } from '../../../types/candidate';

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

function codeRun(candidates: DiscoveryCandidate[]): ScanRunInput {
  return { run_id: 'run-code', scan_kind: 'code', candidates, findings: [] };
}

/** A DB-scan physical entity (its identity key folds in db/type). */
function physicalEntity(id: string, name: string, db = 'orders'): DiscoveryCandidate {
  return candidate({
    id,
    candidateType: 'physical_data_entities',
    name,
    runId: 'run-db',
    data: { database_name: db, physical_type: 'table' },
  });
}

function radiusFor(model: ReturnType<typeof buildReviewModel>, id: string) {
  return model.blast_radius.find((b) => b.candidate_id === id);
}

// ===========================================================================
// The headline scenario: an LDE's blast radius fans out across the WITHIN-LAYER
// typed edges, but the logical↔physical mapping edge is NOT traversed.
// ===========================================================================

describe('Group 7 — meta-model traversal: rejecting a logical data entity', () => {
  /**
   * Build a single-run code-scan model where the LDE `Order` is referenced by:
   *   - two attributes        (parent_child: Order → total, Order → status);
   *   - one physical mapping  (logical_data_entity_physical_data_entities: in-run,
   *                            Order → ORDERS table — code scan also discovered the
   *                            JPA @Entity, so the physical entity + mapping row are
   *                            in the SAME run here);
   *   - one endpoint effect   (endpoint_data_effects: GET /orders → Order).
   * Rejecting `Order` reaches its attributes (parent_child) but NOT the physical
   * entity (the logical↔physical mapping is intentionally not cascaded).
   */
  function buildLdeFanOut() {
    const lde = candidate({ id: 'lde', candidateType: 'logical_data_entities', name: 'Order' });
    const attrTotal = candidate({
      id: 'attr-total',
      candidateType: 'logical_data_attributes',
      name: 'total',
      parentCandidateId: 'lde',
    });
    const attrStatus = candidate({
      id: 'attr-status',
      candidateType: 'logical_data_attributes',
      name: 'status',
      parentCandidateId: 'lde',
    });
    // The persisted physical entity the LDE maps to (in-run, code scan discovered
    // the @Entity), keyed by db+type+table-name.
    const pde = physicalEntity('pde-orders', 'ORDERS');
    // The logical↔physical mapping ROW (references the LDE by name + the table by
    // name). Direction: logical → physical.
    const mapping = candidate({
      id: 'map-1',
      candidateType: 'logical_data_entity_physical_data_entities',
      name: 'Order → ORDERS',
      operation: 'link',
      data: { logicalEntityName: 'Order', physicalTableName: 'ORDERS' },
    });
    // The endpoint + its effect referencing the LDE by name. Direction:
    // endpoint → data entity.
    const ep = candidate({ id: 'ep', candidateType: 'endpoints', name: 'GET /orders' });
    const effect = candidate({
      id: 'eff',
      candidateType: 'endpoint_data_effects',
      name: 'GET /orders → Order (read)',
      parentCandidateId: 'ep',
      data: { endpointName: 'GET /orders', dataEntityName: 'Order' },
    });
    return buildReviewModel([
      codeRun([lde, attrTotal, attrStatus, pde, mapping, ep, effect]),
    ]);
  }

  test('the LDE blast radius reaches its attributes (parent_child) but NOT the physical entity — the logical↔physical mapping edge EXISTS yet is not cascaded', () => {
    const model = buildLdeFanOut();

    // The logical↔physical mapping EDGE is still emitted from the LDE (the
    // connection is preserved in the model — only the cascade skips it).
    const fromLde = model.edges.filter((e) => e.from_id === 'lde');
    const kindsFromLde = new Set(fromLde.map((e) => e.edge_kind));
    expect(kindsFromLde).toContain('parent_child'); // → attributes
    expect(kindsFromLde).toContain('logical_data_entity_physical_data_entities'); // → physical (edge present)

    const r = radiusFor(model, 'lde');
    expect(r).toBeDefined();
    const byDep = new Map(r!.dependents.map((d) => [d.dependent_id, d]));

    // (a) attributes reached via parent_child, predecessor = the LDE (within-layer).
    expect(byDep.get('attr-total')).toMatchObject({
      via_edge_kind: 'parent_child',
      via_predecessor_id: 'lde',
    });
    expect(byDep.get('attr-status')).toMatchObject({
      via_edge_kind: 'parent_child',
      via_predecessor_id: 'lde',
    });

    // (b) the physical entity is NOT in the radius — the logical↔physical mapping
    // is NOT traversed (clean layer separation; it is reviewed as its own family).
    expect(byDep.has('pde-orders')).toBe(false);

    // The full dependent set is exactly the within-layer attributes. (The endpoint
    // is upstream — the effect edge points endpoint → entity — see the next test.)
    expect(new Set(byDep.keys())).toEqual(new Set(['attr-total', 'attr-status']));
    expect(byDep.has('lde')).toBe(false);
  });

  test('the endpoint effect edge is INBOUND to the LDE (endpoint→entity): rejecting the ENDPOINT reaches the LDE + its WITHIN-LAYER sub-tree (attributes), NOT the physical mapping', () => {
    const model = buildLdeFanOut();

    // The effect edge resolves endpoint → data entity (the meta-model direction):
    // the endpoint that references the LDE depends on it, so the edge runs
    // endpoint → LDE, and the LDE is in the ENDPOINT's blast radius (not vice
    // versa). This confirms `endpoint_data_effects` direction + name-resolution.
    const effectEdge = model.edges.find((e) => e.edge_kind === 'endpoint_data_effects');
    expect(effectEdge).toMatchObject({ from_id: 'ep', to_id: 'lde' });

    const epRadius = radiusFor(model, 'ep')!;
    const ids = new Set(epRadius.dependents.map((d) => d.dependent_id));
    // Rejecting the endpoint reaches the LDE (via the effect edge) and then the
    // LDE's WITHIN-LAYER sub-tree (its attributes). The physical entity is NOT
    // reached — the logical↔physical mapping is not part of the cascade.
    expect(ids).toEqual(new Set(['lde', 'attr-total', 'attr-status']));
    expect(ids.has('pde-orders')).toBe(false);
    // The LDE was pulled in specifically via the endpoint_data_effects edge.
    const ldeDep = epRadius.dependents.find((d) => d.dependent_id === 'lde');
    expect(ldeDep).toMatchObject({ via_edge_kind: 'endpoint_data_effects', via_predecessor_id: 'ep' });
  });

  test('non-1:1 mapping: BOTH physical mapping EDGES are emitted (non-1:1 honored), but NEITHER physical entity enters the LDE blast radius (layers reviewed separately)', () => {
    const lde = candidate({ id: 'lde', candidateType: 'logical_data_entities', name: 'Order' });
    // The same logical Order maps to TWO physical tables (e.g. a header + lines
    // split, or two databases) — the EXPLICIT non-1:1 the meta-model mandates.
    const pdeA = physicalEntity('pde-a', 'ORDER_HEADER', 'orders');
    const pdeB = physicalEntity('pde-b', 'ORDER_LINE', 'orders');
    const mapA = candidate({
      id: 'map-a',
      candidateType: 'logical_data_entity_physical_data_entities',
      name: 'Order → ORDER_HEADER',
      operation: 'link',
      data: { logicalEntityName: 'Order', physicalTableName: 'ORDER_HEADER' },
    });
    const mapB = candidate({
      id: 'map-b',
      candidateType: 'logical_data_entity_physical_data_entities',
      name: 'Order → ORDER_LINE',
      operation: 'link',
      data: { logicalEntityName: 'Order', physicalTableName: 'ORDER_LINE' },
    });

    const model = buildReviewModel([codeRun([lde, pdeA, pdeB, mapA, mapB])]);

    // BOTH mapping edges emitted from the one LDE (non-1:1 honored — the connection
    // is preserved in the model for the cross-layer note + cross-scan section).
    const mapEdges = model.edges.filter(
      (e) => e.edge_kind === 'logical_data_entity_physical_data_entities',
    );
    expect(mapEdges.map((e) => e.to_id).sort()).toEqual(['pde-a', 'pde-b']);
    expect(mapEdges.every((e) => e.from_id === 'lde')).toBe(true);

    // The LDE's blast radius reaches NEITHER physical entity — the logical↔physical
    // mapping is not cascaded, so the only dependents would be within-layer (here
    // there are none, so the radius is empty).
    const r = radiusFor(model, 'lde')!;
    const ids = new Set(r.dependents.map((d) => d.dependent_id));
    expect(ids.has('pde-a')).toBe(false);
    expect(ids.has('pde-b')).toBe(false);
    expect(ids.size).toBe(0);
  });
});

// ===========================================================================
// qualified_name — class-qualified display for method-level candidates so
// same-named methods in DIFFERENT classes are not mistaken for duplicates.
// ===========================================================================

describe('node.qualified_name (business_logics class context)', () => {
  it('sets qualified_name = `ClassName.methodName` when the candidate carries data.className', () => {
    const m = buildReviewModel([
      codeRun([
        candidate({
          id: 'bl-1',
          candidateType: 'business_logics',
          name: 'createView',
          data: { className: 'OrderService' },
        }),
      ]),
    ]);
    const node = m.nodes.find((n) => n.id === 'bl-1')!;
    expect(node.name).toBe('createView');
    expect(node.qualified_name).toBe('OrderService.createView');
  });

  it('leaves qualified_name undefined when there is no className', () => {
    const m = buildReviewModel([
      codeRun([
        candidate({ id: 'bl-2', candidateType: 'business_logics', name: 'process', data: {} }),
      ]),
    ]);
    const node = m.nodes.find((n) => n.id === 'bl-2')!;
    expect(node.qualified_name).toBeUndefined();
  });

  it('does NOT qualify an ENTITY whose className equals its own name (no redundant "Name.Name")', () => {
    const m = buildReviewModel([
      codeRun([
        candidate({
          id: 'ent-1',
          candidateType: 'logical_data_entities',
          name: 'HierarchyViewResponse',
          data: { className: 'HierarchyViewResponse' },
        }),
      ]),
    ]);
    const node = m.nodes.find((n) => n.id === 'ent-1')!;
    expect(node.name).toBe('HierarchyViewResponse');
    expect(node.qualified_name).toBeUndefined();
  });
});
