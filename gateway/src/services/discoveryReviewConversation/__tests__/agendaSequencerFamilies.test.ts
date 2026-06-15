/**
 * Tests — Family-aware agenda chunking in the discovery-review sequencer
 * (Spec 2026-06-05-review-room-agenda-redesign, Task Group 1).
 *
 * These pin the re-derivation of parent-FAMILY chunks from the review model's
 * `parent_child` edges. The sequencer stays a PURE function of model + cursor
 * (no fetch, no LLM, no I/O), so every test is a direct call to `buildAgenda` /
 * `getReviewChunk`.
 *
 * Coverage (6 focused tests — the critical behaviours only):
 *   1. A `parent_child` family yields ONE chunk = parent + ALL its direct
 *      children (never split across chunks).
 *   2. A LARGE family (40 children) is ONE chunk — NOT sliced at the legacy 15.
 *   3. A family with ANY live-conflict member ranks into the conflicts band and
 *      stays ONE intact chunk; children sub-ordered conflicts-first then
 *      alphabetical; parent first.
 *   4. Orphans (no `parent_child` edge in either direction) are grouped by type
 *      AFTER the multi-node families within a band.
 *   5. A shared entity bound by an endpoint (relationship-row edge, NOT
 *      `parent_child`) appears ONCE in its OWN family — never pulled into the
 *      endpoint's family.
 *   6. Findings + cross-scan links stay their OWN sections (not folded into a
 *      family chunk).
 */

import { buildAgenda, getReviewChunk } from '../agendaSequencer';
import type {
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
    candidate_type: 'logical_data_entity',
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

/** A live-conflict node on a single attribute (`framework`, two competing sources). */
function conflictNode(partial: Partial<ReviewModelNode> & { id: string }): ReviewModelNode {
  return node({
    ...partial,
    conflict_state: {
      has_live_conflict: true,
      live_conflict_attrs: ['framework'],
      conflicts: {
        framework: [
          { value: 'A', source: 'src-a' },
          { value: 'B', source: 'src-b' },
        ],
      },
      conflict_resolutions: null,
    },
  });
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

/** Assemble a model with sensible empty defaults + a zero-blast entry per node. */
function model(
  nodes: ReviewModelNode[],
  edges: ReviewModelEdge[] = [],
  extra: Partial<FullReviewModelWire> = {},
): FullReviewModelWire {
  return {
    scan_selection: [{ run_id: CODE_RUN, scan_kind: 'code' }],
    nodes,
    edges,
    findings: [],
    blast_radius: nodes.map((n) => ({
      candidate_id: n.id,
      dependents: [],
      would_be_orphaned_parent_ids: [],
    })),
    aggregations: { total_candidates: nodes.length, total_findings: 0 },
    ...extra,
  };
}

/** Walk every chunk the sequencer yields from cursor 0 to exhaustion. */
function allChunks(m: FullReviewModelWire) {
  const chunks = [];
  let cursor: number | null = 0;
  // Guard against an accidental infinite loop in a broken implementation.
  for (let guard = 0; guard < 1000 && cursor !== null; guard += 1) {
    const { chunk } = getReviewChunk(m, cursor);
    chunks.push(chunk);
    cursor = chunk.nextCursor;
  }
  return chunks;
}

const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('agenda sequencer — parent-family chunking', () => {
  // 1 -------------------------------------------------------------------------
  it('a parent_child family is ONE chunk = parent + ALL its direct children (never split)', () => {
    const m = model(
      [
        node({ id: 'entity', candidate_type: 'logical_data_entity', name: 'Order' }),
        node({ id: 'attr-b', candidate_type: 'logical_data_attribute', name: 'b' }),
        node({ id: 'attr-a', candidate_type: 'logical_data_attribute', name: 'a' }),
        node({ id: 'attr-c', candidate_type: 'logical_data_attribute', name: 'c' }),
      ],
      [
        parentChildEdge('entity', 'attr-a'),
        parentChildEdge('entity', 'attr-b'),
        parentChildEdge('entity', 'attr-c'),
      ],
    );

    const chunks = allChunks(m);
    // Exactly one chunk holds the whole family (no findings/cross-scan here).
    expect(chunks).toHaveLength(1);
    const chunk = chunks[0];
    // Parent FIRST, then children alphabetical (no conflicts → pure alpha).
    expect(ids(chunk.items)).toEqual(['entity', 'attr-a', 'attr-b', 'attr-c']);
    // The chunk is self-terminating (nextCursor null) — the family is whole.
    expect(chunk.nextCursor).toBeNull();
    expect(chunk.agendaTotal).toBe(4);
  });

  // 2 -------------------------------------------------------------------------
  it('a LARGE family (40 children) is ONE chunk — NOT sliced at the legacy 15', () => {
    const children: ReviewModelNode[] = [];
    const edges: ReviewModelEdge[] = [];
    for (let i = 0; i < 40; i += 1) {
      // Zero-pad so alphabetical name order is deterministic + asserts cleanly.
      const idx = String(i).padStart(2, '0');
      children.push(node({ id: `attr-${idx}`, candidate_type: 'logical_data_attribute', name: `f${idx}` }));
      edges.push(parentChildEdge('entity', `attr-${idx}`));
    }
    const m = model([node({ id: 'entity', candidate_type: 'logical_data_entity' }), ...children], edges);

    const chunks = allChunks(m);
    // ONE chunk for the whole 41-node family — never split at 15.
    expect(chunks).toHaveLength(1);
    expect(chunks[0].items).toHaveLength(41);
    expect(chunks[0].items[0].id).toBe('entity'); // parent first
    expect(chunks[0].nextCursor).toBeNull();
  });

  // 3 -------------------------------------------------------------------------
  it('a conflicted family is shown INLINE at its architectural section (no conflicts-first band), intact, children conflicts-first then alphabetical', () => {
    // Two interface families, one with a conflicted child. With the architectural
    // order there is NO conflicts-first band — both sit in `interfaces-endpoints`
    // (ordered by name), and the conflicted child still sub-orders to the top of
    // its family with its conflict facts intact (inline).
    const m = model(
      [
        node({ id: 'p-plain', candidate_type: 'interface', name: 'PlainIface' }),
        node({ id: 'plain-ep', candidate_type: 'endpoint', name: 'ep' }),
        node({ id: 'p-conf', candidate_type: 'interface', name: 'ConfIface' }),
        node({ id: 'ch-z', candidate_type: 'endpoint', name: 'zeta' }),
        conflictNode({ id: 'ch-conf', candidate_type: 'endpoint', name: 'mu' }),
        node({ id: 'ch-a', candidate_type: 'endpoint', name: 'alpha' }),
      ],
      [
        parentChildEdge('p-plain', 'plain-ep'),
        parentChildEdge('p-conf', 'ch-z'),
        parentChildEdge('p-conf', 'ch-conf'),
        parentChildEdge('p-conf', 'ch-a'),
      ],
    );

    const chunks = allChunks(m);
    expect(chunks).toHaveLength(2);

    // Both families are in the SAME architectural section (interfaces-endpoints),
    // ordered by name: ConfIface < PlainIface.
    const first = chunks[0];
    expect(first.section).toBe('interfaces-endpoints');
    // Parent first; then children conflicts-first (ch-conf) then alphabetical
    // (alpha=ch-a, zeta=ch-z). The family stays one intact chunk.
    expect(ids(first.items)).toEqual(['p-conf', 'ch-conf', 'ch-a', 'ch-z']);
    // The conflicted child carries its deterministic conflict facts INLINE.
    expect(first.items.find((it) => it.id === 'ch-conf')?.conflicts?.[0].attr).toBe('framework');

    const second = chunks[1];
    expect(second.section).toBe('interfaces-endpoints');
    expect(ids(second.items)).toEqual(['p-plain', 'plain-ep']);
  });

  // 4 -------------------------------------------------------------------------
  it('orphans are grouped by type AFTER the multi-node families within a section', () => {
    // One multi-node family + two orphan types in the SAME (interfaces-endpoints)
    // section. The family chunk precedes the orphan chunks, and orphans group by
    // candidate_type. (Services are excluded from the agenda, so we use orphan
    // endpoints + orphan interfaces here.)
    const m = model(
      [
        node({ id: 'p', candidate_type: 'interface', name: 'Iface' }),
        node({ id: 'p-ep', candidate_type: 'endpoint', name: 'ep' }),
        // orphans (no parent_child edge in either direction), same section
        node({ id: 'orphan-iface-1', candidate_type: 'interface', name: 'SoloIfaceA' }),
        node({ id: 'orphan-iface-2', candidate_type: 'interface', name: 'SoloIfaceB' }),
        node({ id: 'orphan-ep-out', candidate_type: 'endpoint', name: 'OutboundEp' }),
      ],
      [parentChildEdge('p', 'p-ep')],
    );

    const chunks = allChunks(m);
    // [family] then orphans grouped by type: endpoint(s) then interface(s)
    // (alphabetical candidate_type order).
    expect(chunks).toHaveLength(3);

    // Chunk 0: the multi-node family (parent + its endpoint).
    expect(ids(chunks[0].items)).toEqual(['p', 'p-ep']);

    // After the family come the orphans grouped by type. endpoint < interface.
    expect(ids(chunks[1].items)).toEqual(['orphan-ep-out']);
    expect(ids(chunks[2].items).sort()).toEqual(['orphan-iface-1', 'orphan-iface-2']);
    // Every orphan item sits in a chunk that comes AFTER the family chunk.
    expect(chunks[0].cursor).toBe(0);
    expect(chunks.slice(1).every((c) => c.cursor >= 2)).toBe(true);
  });

  // 5 -------------------------------------------------------------------------
  it('a shared entity bound by an endpoint (relationship-row edge, NOT parent_child) appears ONCE in its own family — never pulled into the endpoint family', () => {
    // interface --parent_child--> endpoint ; endpoint --endpoint_data_effects--> entity
    // The entity is a SEPARATE family (the data-binding edge is a relationship
    // row, not structural nesting), reviewed exactly once.
    const m = model(
      [
        node({ id: 'iface', candidate_type: 'interface', name: 'Api' }),
        node({ id: 'ep', candidate_type: 'endpoint', name: 'GetOrder' }),
        node({ id: 'entity', candidate_type: 'logical_data_entity', name: 'Order' }),
        node({ id: 'attr', candidate_type: 'logical_data_attribute', name: 'id' }),
      ],
      [
        parentChildEdge('iface', 'ep'),
        // relationship-row edge — MUST NOT pull the entity into the iface family
        {
          edge_kind: 'endpoint_data_effects',
          from_id: 'ep',
          to_id: 'entity',
          relationship_candidate_id: 'rel-ep-entity',
          cross_scan: false,
        },
        parentChildEdge('entity', 'attr'),
      ],
    );

    const chunks = allChunks(m);
    // Two structural families: {iface, ep} and {entity, attr}. The entity is NOT
    // a member of the iface/ep family.
    expect(chunks).toHaveLength(2);

    const ifaceChunk = chunks.find((c) => c.items.some((it) => it.id === 'iface'))!;
    const entityChunk = chunks.find((c) => c.items.some((it) => it.id === 'entity'))!;
    expect(ifaceChunk).not.toBe(entityChunk);
    expect(ids(ifaceChunk.items).sort()).toEqual(['ep', 'iface']);
    expect(ids(entityChunk.items).sort()).toEqual(['attr', 'entity']);

    // The entity appears EXACTLY once across the whole agenda.
    const agenda = buildAgenda(m);
    expect(agenda.filter((a) => a.ref.id === 'entity')).toHaveLength(1);
  });

  // 6 -------------------------------------------------------------------------
  it('findings + cross-scan links stay their OWN sections (not folded into a family chunk)', () => {
    const m = model(
      [
        node({ id: 'entity', candidate_type: 'logical_data_entity', name: 'Order' }),
        node({ id: 'attr', candidate_type: 'logical_data_attribute', name: 'id' }),
        node({ id: 'd-phys', candidate_type: 'physical_data_entity', name: 'ORDERS', scan_kind: 'database', run_id: 'run-db' }),
      ],
      [
        parentChildEdge('entity', 'attr'),
        // a cross-scan logical↔physical link
        {
          edge_kind: 'logical_data_entity_physical_data_entities',
          from_id: 'entity',
          to_id: 'd-phys',
          relationship_candidate_id: 'rel-x',
          cross_scan: true,
        },
      ],
      {
        scan_selection: [
          { run_id: CODE_RUN, scan_kind: 'code' },
          { run_id: 'run-db', scan_kind: 'database' },
        ],
        findings: [
          {
            id: 'f-high',
            review_status: 'pending_review',
            severity: 'high',
            category: 'data',
            finding_type: 'stored_proc',
            candidate_link_ids: ['entity'],
            run_id: CODE_RUN,
            scan_kind: 'code',
          },
        ],
      },
    );

    const chunks = allChunks(m);

    // The finding is NOT inside the family chunk — it has its own section.
    const familyChunk = chunks.find((c) => c.items.some((it) => it.id === 'entity'))!;
    expect(familyChunk.section).toBe('logical-data');
    expect(familyChunk.items.every((it) => it.itemType === 'candidate')).toBe(true);

    const findingChunk = chunks.find((c) => c.section === 'findings-by-severity');
    expect(findingChunk).toBeDefined();
    expect(ids(findingChunk!.items)).toEqual(['f-high']);

    // The cross-scan link is its OWN section, AFTER physical-data and BEFORE findings.
    const crossScanChunk = chunks.find((c) => c.section === 'cross-scan-links')!;
    expect(crossScanChunk).toBeDefined();
    expect(crossScanChunk.items[0].name).toContain('↔');

    // Findings are the LAST section (the architectural walk ends with evidence).
    expect(chunks[chunks.length - 1].section).toBe('findings-by-severity');
  });
});

describe('agenda sequencer — type-level bulk on orphan-by-type chunks (2026-06-09)', () => {
  it('an orphan-by-type candidate chunk carries typeBulk with the WHOLE-model actionable count, NOT just the visible slice', () => {
    // 20 orphan business_logics (no parent_child) → spread across 2 chunks (15 + 5).
    const methods = Array.from({ length: 20 }, (_, i) =>
      node({ id: `m-${i}`, candidate_type: 'business_logics', name: `method${String(i).padStart(2, '0')}` }),
    );
    const m = model(methods);
    const chunks = allChunks(m);

    // Two orphan-by-type chunks (15 + 5), both carrying the type-level bulk.
    const orphanChunks = chunks.filter((c) => c.typeBulk);
    expect(orphanChunks).toHaveLength(2);
    for (const c of orphanChunks) {
      expect(c.typeBulk).toEqual({
        candidateType: 'business_logics',
        scanScope: 'code',
        actionableCount: 20, // the WHOLE-model count, NOT the visible 15 / 5
      });
      expect(c.typeBulkActions).toEqual(['approved', 'rejected', 'deferred']);
    }
  });

  it('decided/committed candidates of the type are EXCLUDED from the actionable count', () => {
    const m = model([
      node({ id: 'a', candidate_type: 'business_logics', name: 'a' }),
      node({ id: 'b', candidate_type: 'business_logics', name: 'b' }),
      node({ id: 'c', candidate_type: 'business_logics', name: 'c', review_status: 'approved' }),
      node({ id: 'd', candidate_type: 'business_logics', name: 'd', committed: true }),
    ]);
    const chunk = getReviewChunk(m, 0).chunk;
    // a + b are actionable; c (approved) and d (committed) are not.
    expect(chunk.typeBulk?.actionableCount).toBe(2);
  });

  it('a FAMILY chunk does NOT carry typeBulk', () => {
    const m = model(
      [
        node({ id: 'entity', candidate_type: 'logical_data_entity', name: 'Order' }),
        node({ id: 'attr', candidate_type: 'logical_data_attribute', name: 'id' }),
      ],
      [parentChildEdge('entity', 'attr')],
    );
    const chunk = getReviewChunk(m, 0).chunk;
    expect(chunk.family).toBeDefined();
    expect(chunk.typeBulk).toBeUndefined();
    expect(chunk.typeBulkActions).toBeUndefined();
  });
});

describe('agenda sequencer — findings bulk + decided-finding dedup (2026-06-09)', () => {
  function finding(id: string, severity: string, reviewStatus = 'pending_review') {
    return {
      id,
      review_status: reviewStatus,
      severity,
      category: 'data',
      finding_type: 'risky_dependency',
      candidate_link_ids: [],
      run_id: CODE_RUN,
      scan_kind: 'code' as const,
    };
  }

  it('a findings chunk carries findingsBulk with the whole-scan actionable count + the three actions', () => {
    const findings = Array.from({ length: 5 }, (_, i) => finding(`f-${i}`, 'high'));
    const m = model([], [], { findings });
    const chunk = getReviewChunk(m, 0).chunk;

    expect(chunk.section).toBe('findings-by-severity');
    expect(chunk.findingsBulk).toEqual({ scanScope: 'code', actionableCount: 5 });
    expect(chunk.findingsBulkActions).toEqual(['approved', 'rejected', 'deferred']);
    // It is NOT a candidate/family bulk.
    expect(chunk.typeBulk).toBeUndefined();
    expect(chunk.family).toBeUndefined();
  });

  it('DECIDED findings are dropped from the agenda and excluded from the actionable count', () => {
    const m = model([], [], {
      findings: [
        finding('f-live-1', 'high'),
        finding('f-live-2', 'medium'),
        finding('f-approved', 'high', 'approved'),
        finding('f-rejected', 'low', 'rejected'),
      ],
    });
    const chunk = getReviewChunk(m, 0).chunk;
    // Only the two live findings remain in the chunk + the count.
    expect(ids(chunk.items).sort()).toEqual(['f-live-1', 'f-live-2']);
    expect(chunk.findingsBulk?.actionableCount).toBe(2);
  });
});

describe('agenda sequencer — cross-layer (logical↔physical) mapping note (Spec 2026-06-08)', () => {
  // Mapping edges run logical (from_id) → physical (to_id); cross_scan when the
  // logical (code) and physical (DB) sides come from different runs.
  function mappingEdge(ldeId: string, pdeId: string): ReviewModelEdge {
    return {
      edge_kind: 'logical_data_entity_physical_data_entities',
      from_id: ldeId,
      to_id: pdeId,
      relationship_candidate_id: `xscan:${ldeId}:${pdeId}`,
      cross_scan: true,
    };
  }

  it('a PHYSICAL-entity family carries the note with the mapped LOGICAL entities + their disposition tally', () => {
    const m = model(
      [
        // The physical table family (parent + 2 columns), DB scan.
        node({ id: 'pde', candidate_type: 'physical_data_entities', name: 'ORDERS', scan_kind: 'database', run_id: 'run-db' }),
        node({ id: 'col1', candidate_type: 'physical_data_attributes', name: 'id', scan_kind: 'database', run_id: 'run-db' }),
        node({ id: 'col2', candidate_type: 'physical_data_attributes', name: 'total', scan_kind: 'database', run_id: 'run-db' }),
        // Two logical entities mapped to it: one APPROVED, one still pending (code scan).
        node({ id: 'lde1', candidate_type: 'logical_data_entities', name: 'Order', review_status: 'approved' }),
        node({ id: 'lde2', candidate_type: 'logical_data_entities', name: 'OrderView', review_status: 'pending_review' }),
      ],
      [
        parentChildEdge('pde', 'col1'),
        parentChildEdge('pde', 'col2'),
        mappingEdge('lde1', 'pde'),
        mappingEdge('lde2', 'pde'),
      ],
    );

    // Code-scan families precede the DB-scan physical family, so find it by parent.
    const chunk = allChunks(m).find((c) => c.family?.parentId === 'pde');
    expect(chunk).toBeDefined();
    const clm = chunk!.crossLayerMapping;
    expect(clm).toBeDefined();
    expect(clm!.parentLayer).toBe('physical');
    expect(new Set(clm!.counterpartNames)).toEqual(new Set(['Order', 'OrderView']));
    // The "you already approved/rejected N" tally over the mapped logical entities.
    expect(clm!.mappedDecisions).toEqual({ approved: 1, rejected: 0, deferred: 0, pending: 1 });
  });

  it('a LOGICAL-entity family carries the note naming the mapped PHYSICAL entities (no disposition tally)', () => {
    const m = model(
      [
        node({ id: 'lde', candidate_type: 'logical_data_entities', name: 'Order' }),
        node({ id: 'attr', candidate_type: 'logical_data_attributes', name: 'total' }),
        node({ id: 'pde', candidate_type: 'physical_data_entities', name: 'ORDERS', scan_kind: 'database', run_id: 'run-db' }),
      ],
      [parentChildEdge('lde', 'attr'), mappingEdge('lde', 'pde')],
    );

    const chunk = allChunks(m).find((c) => c.family?.parentId === 'lde');
    expect(chunk).toBeDefined();
    const clm = chunk!.crossLayerMapping;
    expect(clm).toBeDefined();
    expect(clm!.parentLayer).toBe('logical');
    expect(clm!.counterpartNames).toEqual(['ORDERS']);
    // A logical parent reports no disposition tally (the physical side is reviewed later).
    expect(clm!.mappedDecisions).toBeUndefined();
  });

  it('a family with NO cross-layer mapping carries NO cross-layer note', () => {
    const m = model(
      [
        node({ id: 'lde', candidate_type: 'logical_data_entities', name: 'Order' }),
        node({ id: 'attr', candidate_type: 'logical_data_attributes', name: 'total' }),
      ],
      [parentChildEdge('lde', 'attr')],
    );
    const chunk = allChunks(m).find((c) => c.family?.parentId === 'lde');
    expect(chunk).toBeDefined();
    expect(chunk!.crossLayerMapping).toBeUndefined();
  });
});
