/**
 * Tests — Immediate-apply for chunk dispositions (Spec
 * 2026-06-06-discovery-review-room-agenda-redesign-2, Task Group 4; supersedes the
 * cascade-aware confirm-SKIP behaviour from 2026-06-05-review-room-agenda-redesign
 * Task Group 3).
 *
 * The off-screen confirm gate is RETIRED: every `apply-decision` (whatever its
 * cascade reaches) now applies IMMEDIATELY — the click IS the confirmation — and
 * returns an `'applied'` outcome with NO `pending-confirmation` turn. The only
 * surviving gate is the terminal Save (covered elsewhere). The cascade reach is
 * unchanged: a `scope:'cascade'` apply still writes the resolver's FULL touched
 * set (seed + everything the cascade pulls, on- or off-screen).
 *
 * The exported PURE helpers `deriveFamilyForSeed` + `partitionOverage` survive
 * (their unit contracts are still pinned here); they are no longer used to decide
 * whether to gate, only to describe an apply's reach.
 *
 * All LLM is bypassed (the deterministic `captureDeterministicTurn` path); the
 * orchestrator's write is mocked at the `fetch` boundary.
 *
 * Coverage (6 focused tests):
 *   1. A single NON-cascading row applies immediately (no pending turn, one write).
 *   2. A family bulk whose touched set ⊆ the family applies immediately over the
 *      whole family.
 *   3. A family APPROVE whose cascade ESCAPES the family STILL applies immediately
 *      (no gate) — the FULL touched set (incl. the off-screen node) is written.
 *   4. A family REJECT that surfaces relationship-ROW candidates STILL applies
 *      immediately (no gate) — the surfaced row id is written in the FULL set.
 *   5. `partitionOverage` unit contract: node-id-set membership splits the two
 *      figures; ids inside the family count toward neither.
 *   6. The apply carries the FULL touched set to the unchanged bulk-review-cascade
 *      endpoint (the same writer).
 */

import {
  captureDeterministicTurn,
  deriveFamilyForSeed,
  partitionOverage,
  type ReviewCoordinatorDeps,
} from '../reviewConversationCoordinator';
import {
  ReviewDecisionOrchestrator,
  type ReviewOrchestratorDeps,
} from '../reviewDecisionOrchestrator';
import type {
  FullReviewModelWire,
  ReviewModelEdge,
  ReviewModelNode,
} from '../reviewModelFull';
import type { SelectedScanSet } from '../reviewTurnShape';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PROJECT = 'proj-1';
const ARCH = 'arch-1';
const CODE_RUN = 'run-code';

const SCAN_PAIR: SelectedScanSet = {
  runs: [{ runId: CODE_RUN, scanKind: 'code', serviceId: null }],
  primaryRunId: CODE_RUN,
};

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

function parentChildEdge(parentId: string, childId: string): ReviewModelEdge {
  return {
    edge_kind: 'parent_child',
    from_id: parentId,
    to_id: childId,
    relationship_candidate_id: childId,
    cross_scan: false,
  };
}

/** A single standalone node (no children, no edges, no cascade). */
function soloModel(): FullReviewModelWire {
  return {
    scan_selection: [{ run_id: CODE_RUN, scan_kind: 'code' }],
    nodes: [node({ id: 'solo', candidate_type: 'service', name: 'OutboundEp' })],
    edges: [],
    findings: [],
    blast_radius: [{ candidate_id: 'solo', dependents: [], would_be_orphaned_parent_ids: [] }],
    aggregations: { total_candidates: 1, total_findings: 0 },
  };
}

/**
 * A self-contained family: entity + two attributes, the parent's blast radius
 * walking parent_child to BOTH children (nothing off-screen).
 */
function selfContainedFamily(): FullReviewModelWire {
  const nodes: ReviewModelNode[] = [
    node({ id: 'entity', candidate_type: 'logical_data_entity', name: 'Order' }),
    node({ id: 'attr-a', candidate_type: 'logical_data_attribute', name: 'a' }),
    node({ id: 'attr-b', candidate_type: 'logical_data_attribute', name: 'b' }),
  ];
  return {
    scan_selection: [{ run_id: CODE_RUN, scan_kind: 'code' }],
    nodes,
    edges: [parentChildEdge('entity', 'attr-a'), parentChildEdge('entity', 'attr-b')],
    findings: [],
    blast_radius: [
      {
        candidate_id: 'entity',
        dependents: [
          { dependent_id: 'attr-a', via_edge_kind: 'parent_child', via_predecessor_id: 'entity' },
          { dependent_id: 'attr-b', via_edge_kind: 'parent_child', via_predecessor_id: 'entity' },
        ],
        would_be_orphaned_parent_ids: [],
      },
      { candidate_id: 'attr-a', dependents: [], would_be_orphaned_parent_ids: [] },
      { candidate_id: 'attr-b', dependents: [], would_be_orphaned_parent_ids: [] },
    ],
    aggregations: { total_candidates: 3, total_findings: 0 },
  };
}

/**
 * A family (interface + endpoint) whose interface's blast radius ALSO reaches a
 * `logical_data_entity` in a DIFFERENT family (via `endpoint_data_effects`) — so
 * an apply over the family escapes it: the entity is a NODE off-screen.
 */
function familyEscapingToNode(): FullReviewModelWire {
  const nodes: ReviewModelNode[] = [
    node({ id: 'iface', candidate_type: 'interface', name: 'Api' }),
    node({ id: 'ep', candidate_type: 'endpoint', name: 'GetOrder' }),
    node({ id: 'far-entity', candidate_type: 'logical_data_entity', name: 'Order' }),
  ];
  return {
    scan_selection: [{ run_id: CODE_RUN, scan_kind: 'code' }],
    nodes,
    edges: [parentChildEdge('iface', 'ep')],
    findings: [],
    blast_radius: [
      {
        candidate_id: 'iface',
        dependents: [
          { dependent_id: 'ep', via_edge_kind: 'parent_child', via_predecessor_id: 'iface' },
          // The interface's apply reaches a NODE outside its family.
          { dependent_id: 'far-entity', via_edge_kind: 'endpoint_data_effects', via_predecessor_id: 'iface' },
        ],
        would_be_orphaned_parent_ids: [],
      },
      { candidate_id: 'ep', dependents: [], would_be_orphaned_parent_ids: [] },
      { candidate_id: 'far-entity', dependents: [], would_be_orphaned_parent_ids: [] },
    ],
    aggregations: { total_candidates: 3, total_findings: 0 },
  };
}

/**
 * A family (interface + endpoint) with an incident relationship-ROW edge
 * (`interface_logical_entities`, `relationship_candidate_id: 'rel-row'`) to a
 * SURVIVING entity. On REJECT, Spec A's resolver SURFACES `rel-row` (an EDGE
 * candidate, NOT a node) in the touched set.
 */
function familyWithRelationshipRow(): FullReviewModelWire {
  const nodes: ReviewModelNode[] = [
    node({ id: 'iface', candidate_type: 'interface', name: 'Api' }),
    node({ id: 'ep', candidate_type: 'endpoint', name: 'GetOrder' }),
    // A surviving entity the interface references via a relationship ROW.
    node({ id: 'bound-entity', candidate_type: 'logical_data_entity', name: 'Order' }),
  ];
  return {
    scan_selection: [{ run_id: CODE_RUN, scan_kind: 'code' }],
    nodes,
    edges: [
      parentChildEdge('iface', 'ep'),
      // The relationship-ROW edge: its relationship_candidate_id is the ROW
      // candidate id (NOT a node). Surfaced + marked on REJECT only.
      {
        edge_kind: 'interface_logical_entities',
        from_id: 'iface',
        to_id: 'bound-entity',
        relationship_candidate_id: 'rel-row',
        cross_scan: false,
      },
    ],
    findings: [],
    blast_radius: [
      {
        candidate_id: 'iface',
        // Only the parent_child child is a blast dependent — the far entity is NOT
        // pulled in (it survives); the ROW is surfaced via the raw edge on reject.
        dependents: [
          { dependent_id: 'ep', via_edge_kind: 'parent_child', via_predecessor_id: 'iface' },
        ],
        would_be_orphaned_parent_ids: [],
      },
      { candidate_id: 'ep', dependents: [], would_be_orphaned_parent_ids: [] },
      { candidate_id: 'bound-entity', dependents: [], would_be_orphaned_parent_ids: [] },
    ],
    aggregations: { total_candidates: 3, total_findings: 0 },
  };
}

function makeOrchestrator(): {
  orchestrator: ReviewDecisionOrchestrator;
  fetchCalls: Array<{ url: string; method: string; body: unknown }>;
} {
  const fetchCalls: Array<{ url: string; method: string; body: unknown }> = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    fetchCalls.push({
      url,
      method: (init?.method as string) ?? 'GET',
      body: init?.body ? JSON.parse(init.body as string) : null,
    });
    return {
      ok: true,
      status: 200,
      json: async () => ({ updated_candidate_count: 1, updated_finding_count: 0, updated_count: 1 }),
      text: async () => '',
    } as unknown as Response;
  }) as unknown as typeof fetch;
  const orchDeps: ReviewOrchestratorDeps = {
    fetchImpl,
    appendTurn: async () => {},
    now: () => new Date('2026-06-05T00:00:00.000Z'),
  };
  return { orchestrator: new ReviewDecisionOrchestrator(orchDeps), fetchCalls };
}

const CTX = (model: FullReviewModelWire) => ({
  projectId: PROJECT,
  architectureId: ARCH,
  runId: CODE_RUN,
  model,
  scanPair: SCAN_PAIR,
});

async function deps(orchestrator: ReviewDecisionOrchestrator) {
  const { runArchitectQuestionLoop } = await import('../../architectConversation/llmLoopRunner');
  const d: ReviewCoordinatorDeps = {
    orchestrator,
    appendTurn: async () => {},
    loadConversation: async () => ({ schemaVersion: 1, threadId: 't', turns: [] }),
    runLoop: runArchitectQuestionLoop,
    newId: () => 'pending-fixed',
  };
  return { deps: d };
}

/** Propose an apply-decision via the deterministic (no-LLM) path. */
async function propose(
  model: FullReviewModelWire,
  seedCandidateIds: string[],
  action: 'approved' | 'rejected' | 'deferred',
  d: ReviewCoordinatorDeps,
) {
  return captureDeterministicTurn(
    {
      ...CTX(model),
      action: {
        kind: 'propose-intent',
        intent: { kind: 'apply-decision', seedCandidateIds, findingIds: [], action },
        userText: 'act',
      },
    },
    d,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('immediate-apply for chunk dispositions (Task Group 4)', () => {
  // 1 -------------------------------------------------------------------------
  it('a single NON-cascading row applies immediately (no pending turn, one write)', async () => {
    const model = soloModel();
    const { orchestrator, fetchCalls } = makeOrchestrator();
    const { deps: d } = await deps(orchestrator);

    const outcome = await propose(model, ['solo'], 'rejected', d);

    // The click IS the confirmation: applied immediately, NO pending-confirmation.
    expect(outcome.kind).toBe('applied');
    if (outcome.kind !== 'applied') throw new Error('expected applied');
    expect(outcome.appliedTurn.kind).toBe('decision-applied');
    // A disposition auto-advances (it carries the next chunk; here the agenda is
    // exhausted after the only row, so nextChunk is null + a terminal Save is appended).
    expect(outcome.advanced).toBe(true);
    // Exactly one write fired (the immediate apply).
    expect(fetchCalls.length).toBe(1);
    expect(fetchCalls[0].url).toContain('/candidates/bulk-review-cascade');
    expect((fetchCalls[0].body as { review_status: string }).review_status).toBe('rejected');
  });

  // 2 -------------------------------------------------------------------------
  it('a family bulk whose touched set ⊆ the family applies immediately over the whole family', async () => {
    const model = selfContainedFamily();
    const { orchestrator, fetchCalls } = makeOrchestrator();
    const { deps: d } = await deps(orchestrator);

    // Seed the PARENT — the cascade pulls both attributes, all inside the family.
    const outcome = await propose(model, ['entity'], 'approved', d);

    expect(outcome.kind).toBe('applied');
    if (outcome.kind !== 'applied') throw new Error('expected applied');
    expect(fetchCalls.length).toBe(1);
    const body = fetchCalls[0].body as { candidate_ids: string[] };
    expect(new Set(body.candidate_ids)).toEqual(new Set(['entity', 'attr-a', 'attr-b']));
  });

  // 3 -------------------------------------------------------------------------
  it('a family APPROVE whose cascade ESCAPES the family STILL applies immediately (no gate) over the FULL touched set', async () => {
    const model = familyEscapingToNode();
    const { orchestrator, fetchCalls } = makeOrchestrator();
    const { deps: d } = await deps(orchestrator);

    // Seed the interface — the cascade reaches `far-entity` (a NODE outside the
    // iface/ep family). With the gate retired, this applies immediately.
    const outcome = await propose(model, ['iface'], 'approved', d);

    expect(outcome.kind).toBe('applied');
    if (outcome.kind !== 'applied') throw new Error('expected applied');
    // EXACTLY ONE write — the FULL cascade touched set (incl. the off-screen node).
    expect(fetchCalls.length).toBe(1);
    const body = fetchCalls[0].body as { candidate_ids: string[]; review_status: string };
    expect(new Set(body.candidate_ids)).toEqual(new Set(['iface', 'ep', 'far-entity']));
    expect(body.review_status).toBe('approved');
  });

  // 4 -------------------------------------------------------------------------
  it('a family REJECT that surfaces relationship-ROW candidates STILL applies immediately (no gate), writing the surfaced row in the FULL set', async () => {
    const model = familyWithRelationshipRow();
    const { orchestrator, fetchCalls } = makeOrchestrator();
    const { deps: d } = await deps(orchestrator);

    // REJECT: Spec A surfaces the relationship ROW (`rel-row`, an EDGE candidate).
    // With the gate retired, this applies immediately over the FULL touched set.
    const outcome = await propose(model, ['iface'], 'rejected', d);

    expect(outcome.kind).toBe('applied');
    if (outcome.kind !== 'applied') throw new Error('expected applied');
    expect(fetchCalls.length).toBe(1);
    const body = fetchCalls[0].body as { candidate_ids: string[]; review_status: string };
    // The full reject touched set includes the family + the surfaced relationship row.
    expect(new Set(body.candidate_ids)).toEqual(new Set(['iface', 'ep', 'rel-row']));
    expect(body.review_status).toBe('rejected');
  });

  // 5 -------------------------------------------------------------------------
  it('partitionOverage unit contract: node-id membership splits beyond vs relationships; in-family ids count toward neither', () => {
    const model = familyWithRelationshipRow();
    const family = deriveFamilyForSeed(['iface'], model); // { iface, ep }

    // Touched set: two in-family nodes + one off-screen node + one edge (row) id.
    const touched = ['iface', 'ep', 'bound-entity', 'rel-row'];
    const overage = partitionOverage(touched, family, model);

    // iface + ep are in-family (neither figure); bound-entity is a node off-screen
    // (+1 beyond); rel-row is NOT a node (a relationship-row edge) (+1 dropped).
    expect(overage).toEqual({ beyondFamilyCount: 1, relationshipsDroppedCount: 1 });
  });

  // 6 -------------------------------------------------------------------------
  it('the apply carries the FULL touched set to the unchanged bulk-review-cascade endpoint (the same writer)', async () => {
    const model = selfContainedFamily();
    const { orchestrator, fetchCalls } = makeOrchestrator();
    const { deps: d } = await deps(orchestrator);

    await propose(model, ['entity'], 'deferred', d);

    // The apply drove the SAME atomic writer with the FULL resolved set.
    expect(fetchCalls.length).toBe(1);
    expect(fetchCalls[0].method).toBe('POST');
    expect(fetchCalls[0].url).toContain('/candidates/bulk-review-cascade');
    const body = fetchCalls[0].body as { candidate_ids: string[]; review_status: string };
    expect(new Set(body.candidate_ids)).toEqual(new Set(['entity', 'attr-a', 'attr-b']));
    expect(body.review_status).toBe('deferred');
  });
});
