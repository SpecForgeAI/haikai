/**
 * Task Group 3 — Scan-Selection Union + Cross-Scan Edges + Findings Bridge.
 *
 * Focused tests:
 *   (a) candidates + findings unioned across one code-kind run + one DB-kind run,
 *       node ids stay globally unique (AMS candidate ids);
 *   (b) with BOTH runs present, a `logical_data_entity_physical_data_entities`
 *       cross-scan edge links the code-scan logical entity ↔ the DB-scan physical
 *       entity (non-1:1 honored — one logical entity mapping to TWO physical
 *       entities produces TWO edges, never collapsed to 1:1);
 *   (c) with ONLY one run, NO cross-scan edge is produced and the full single-run
 *       model still computes;
 *   (d) findings bridge to candidates via `DiscoveryFindingDto.links[]` where
 *       `target_type === 'discovery_candidate'` → `target_id`, carrying Spec F
 *       `review_status`.
 */

import { buildReviewModel } from '../buildReviewModel';
import type { ScanRunInput } from '../types';
import type { DiscoveryCandidate } from '../../../types/candidate';
import type { DiscoveryFindingDto, DiscoveryFindingLinkDto } from '../../archModelClient';

function candidate(
  partial: Partial<DiscoveryCandidate> & Pick<DiscoveryCandidate, 'id' | 'candidateType' | 'name'>,
): DiscoveryCandidate {
  return {
    runId: 'run-x',
    confidence: 0.9,
    status: 'pending_review',
    sourceClusterIds: [],
    data: {},
    synthesizedAt: '2026-06-02T00:00:00Z',
    operation: 'create',
    ...partial,
  };
}

function physicalEntity(id: string, name: string, db = 'orders'): DiscoveryCandidate {
  return candidate({
    id,
    candidateType: 'physical_data_entities',
    name,
    runId: 'run-db',
    data: { database_name: db, physical_type: 'table' },
  });
}

function link(targetId: string, targetType = 'discovery_candidate'): DiscoveryFindingLinkDto {
  return {
    id: `lnk-${targetId}`,
    findingId: 'f',
    linkType: 'affects',
    targetType,
    targetId,
    label: null,
    createdAt: 'x',
  };
}

function finding(
  partial: Partial<DiscoveryFindingDto> & Pick<DiscoveryFindingDto, 'id'>,
): DiscoveryFindingDto {
  return {
    runId: 'run-db',
    projectId: 'p',
    architectureId: 'a',
    findingType: 'stored_procedure',
    category: 'data_layer',
    severity: 'medium',
    confidence: null,
    reviewStatus: 'pending_review',
    previousReviewStatus: null,
    title: 't',
    summary: null,
    detailJson: null,
    source: null,
    createdByStage: null,
    createdAt: 'x',
    updatedAt: 'x',
    reviewedAt: null,
    reviewerNotes: null,
    links: [],
    ...partial,
  };
}

// ===========================================================================
// (a) Two-run union with globally-unique ids
// ===========================================================================

describe('Group 3 — scan-selection union', () => {
  test('unions candidates + findings across a code run and a DB run; ids stay unique', () => {
    const codeSvc = candidate({ id: 'c-svc', candidateType: 'service', name: 'OrderService', runId: 'run-code' });
    const codeLde = candidate({
      id: 'c-lde',
      candidateType: 'logical_data_entities',
      name: 'Order',
      runId: 'run-code',
    });
    const dbTable = physicalEntity('d-tbl', 'Order');
    const dbFinding = finding({ id: 'f-db', links: [link('d-tbl')] });

    const model = buildReviewModel([
      { run_id: 'run-code', scan_kind: 'code', candidates: [codeSvc, codeLde], findings: [] },
      { run_id: 'run-db', scan_kind: 'database', candidates: [dbTable], findings: [dbFinding] },
    ]);

    expect(model.nodes.map((n) => n.id).sort()).toEqual(['c-lde', 'c-svc', 'd-tbl']);
    // node ids unique
    expect(new Set(model.nodes.map((n) => n.id)).size).toBe(model.nodes.length);
    // scan_kind carried from the originating run
    expect(model.nodes.find((n) => n.id === 'd-tbl')!.scan_kind).toBe('database');
    expect(model.nodes.find((n) => n.id === 'c-svc')!.scan_kind).toBe('code');
    // findings unioned
    expect(model.findings.map((f) => f.id)).toEqual(['f-db']);
  });
});

// ===========================================================================
// (b) Cross-scan logical↔physical edges (non-1:1 honored)
// ===========================================================================

describe('Group 3 — cross-scan logical↔physical edges', () => {
  test('links a code-scan logical entity to a DB-scan physical entity by name', () => {
    const lde = candidate({
      id: 'lde-order',
      candidateType: 'logical_data_entities',
      name: 'Order',
      runId: 'run-code',
    });
    const tbl = physicalEntity('pde-order', 'Order');

    const model = buildReviewModel([
      { run_id: 'run-code', scan_kind: 'code', candidates: [lde], findings: [] },
      { run_id: 'run-db', scan_kind: 'database', candidates: [tbl], findings: [] },
    ]);

    const cross = model.edges.filter(
      (e) => e.edge_kind === 'logical_data_entity_physical_data_entities' && e.cross_scan,
    );
    expect(cross).toHaveLength(1);
    expect(cross[0].from_id).toBe('lde-order'); // logical
    expect(cross[0].to_id).toBe('pde-order'); // physical
  });

  test('non-1:1: one logical entity mapping to TWO physical entities produces TWO edges', () => {
    const lde = candidate({
      id: 'lde-order',
      candidateType: 'logical_data_entities',
      name: 'Order',
      runId: 'run-code',
    });
    // Two physical tables named `Order` across two databases (non-1:1).
    const tblA = physicalEntity('pde-a', 'Order', 'orders_a');
    const tblB = physicalEntity('pde-b', 'Order', 'orders_b');

    const model = buildReviewModel([
      { run_id: 'run-code', scan_kind: 'code', candidates: [lde], findings: [] },
      { run_id: 'run-db', scan_kind: 'database', candidates: [tblA, tblB], findings: [] },
    ]);

    const cross = model.edges.filter(
      (e) => e.edge_kind === 'logical_data_entity_physical_data_entities' && e.cross_scan,
    );
    expect(cross.map((e) => e.to_id).sort()).toEqual(['pde-a', 'pde-b']);
    expect(cross.every((e) => e.from_id === 'lde-order')).toBe(true);
  });
});

// ===========================================================================
// (c) Single-run degrades cleanly (no cross-scan edges)
// ===========================================================================

describe('Group 3 — single-run degradation', () => {
  test('a single code run produces NO cross-scan edge and still computes fully', () => {
    const lde = candidate({
      id: 'lde-only',
      candidateType: 'logical_data_entities',
      name: 'Order',
      runId: 'run-code',
    });
    const attr = candidate({
      id: 'attr-only',
      candidateType: 'logical_data_attributes',
      name: 'total',
      parentCandidateId: 'lde-only',
      runId: 'run-code',
    });
    const model = buildReviewModel([
      { run_id: 'run-code', scan_kind: 'code', candidates: [lde, attr], findings: [] },
    ]);
    expect(model.edges.filter((e) => e.cross_scan)).toHaveLength(0);
    // Intra-scan structural edge still present.
    expect(model.edges.filter((e) => e.edge_kind === 'parent_child')).toHaveLength(1);
    expect(model.aggregations.total_candidates).toBe(2);
  });
});

// ===========================================================================
// (d) Findings bridge to candidates via links[]
// ===========================================================================

describe('Group 3 — findings bridge', () => {
  test('finding links resolve to candidate node ids and carry Spec F review_status', () => {
    const svc = candidate({ id: 'svc-1', candidateType: 'service', name: 'Svc', runId: 'run-code' });
    const f = finding({
      id: 'f-1',
      runId: 'run-code',
      severity: 'high',
      reviewStatus: 'approved',
      category: 'integration',
      links: [link('svc-1'), link('not-a-node'), link('svc-1', 'discovery_decision_task')],
    });

    const model = buildReviewModel([
      { run_id: 'run-code', scan_kind: 'code', candidates: [svc], findings: [f] },
    ]);

    expect(model.findings).toHaveLength(1);
    const fn = model.findings[0];
    expect(fn.review_status).toBe('approved');
    expect(fn.severity).toBe('high');
    expect(fn.category).toBe('integration');
    // Only the discovery_candidate link that targets a real node is carried.
    expect(fn.candidate_link_ids).toEqual(['svc-1']);
  });
});
