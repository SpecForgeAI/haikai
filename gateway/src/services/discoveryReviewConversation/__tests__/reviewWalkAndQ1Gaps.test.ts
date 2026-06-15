/**
 * Tests — Task Group 6 strategic GAP coverage for the confirm-box-removal + rich
 * cascade-chunk redesign (Spec 2026-06-06-discovery-review-room-agenda-redesign-2).
 *
 * The TG1-5 unit suites already pin each step in isolation (turn shape, the
 * cascade-preview builder, the agenda dedup, the single immediate-apply/advance
 * step, the four buttons + summary in the room). These tests fill the END-TO-END
 * and CONTRACT gaps that no single-step unit test exercises:
 *
 *   1. THE ONE-CLICK-PER-FAMILY WALK: apply → auto-advance → next chunk → apply →
 *      … → agenda EXHAUSTED → terminal Save. A multi-family agenda is decided one
 *      family per click; each `'applied'` outcome carries the NEXT chunk until the
 *      last apply exhausts the agenda and appends the terminal Save Yes/No.
 *   2. `scope:'family'` leaves the cascaded logical entities/attributes to arrive
 *      as their OWN later chunk (they are NOT decided now), whereas `scope:'cascade'`
 *      decides them now so they do NOT get their own later chunk — the exact
 *      carried-forward decision #2 of the spec, asserted on the auto-advance chunk.
 *   3. CRITICAL Q1 — "already-decided members are NOT re-actioned": a
 *      PARTIALLY-approved family kept as a chunk; a Reject-All / Defer-All MUST NOT
 *      send the already-approved member ids to the AMS applicator (which would
 *      OVERWRITE an approved member to rejected/deferred — a requirement
 *      violation). The coordinator intersects the disposition write-set with the
 *      actionable (pending, non-committed) members, so the already-approved member
 *      is EXCLUDED from `candidate_ids`. Approve-All over the same family likewise
 *      omits the already-approved member (the applicator would no-op it anyway, but
 *      the write-set must not carry it). A reject-surfaced relationship-ROW (a
 *      non-node id) is STILL sent (it is not an already-decided family member).
 *
 * All LLM is bypassed (the deterministic `captureDeterministicTurn` path); the
 * orchestrator's writes are observed at the `fetch` boundary; the thread store is
 * stubbed so the appended turns are observable without I/O.
 */

import {
  captureDeterministicTurn,
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
import type { ProposedReviewIntent, SelectedScanSet } from '../reviewTurnShape';

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
    now: () => new Date('2026-06-06T00:00:00.000Z'),
  };
  return { orchestrator: new ReviewDecisionOrchestrator(orchDeps), fetchCalls };
}

let saveIdCounter = 0;
async function deps(orchestrator: ReviewDecisionOrchestrator) {
  const appended: unknown[] = [];
  const { runArchitectQuestionLoop } = await import('../../architectConversation/llmLoopRunner');
  const d: ReviewCoordinatorDeps = {
    orchestrator,
    appendTurn: async (_p: string, _r: string, turn: unknown) => {
      appended.push(turn);
    },
    loadConversation: async () => ({ schemaVersion: 1, threadId: 't', turns: [] }),
    runLoop: runArchitectQuestionLoop,
    newId: () => `save-pending-${(saveIdCounter += 1)}`,
  };
  return { deps: d, appended };
}

function propose(
  model: FullReviewModelWire,
  intent: ProposedReviewIntent,
  d: ReviewCoordinatorDeps,
) {
  return captureDeterministicTurn(
    {
      projectId: PROJECT,
      architectureId: ARCH,
      runId: CODE_RUN,
      model,
      scanPair: SCAN_PAIR,
      action: { kind: 'propose-intent', intent, userText: 'act' },
    },
    d,
  );
}

const bodyOf = (call: { body: unknown }) =>
  call.body as { candidate_ids: string[]; review_status: string };

// ---------------------------------------------------------------------------
// 1. The one-click-per-family WALK to exhaustion + terminal Save.
// ---------------------------------------------------------------------------

/**
 * THREE self-contained families (entity + attrs), so deciding each via a full
 * cascade leaves the others, and the THIRD apply exhausts the agenda. The frontend
 * carries the prior outcome's `nextChunk` to re-render, but the SERVER is the
 * source of the cursor: after each apply the coordinator re-derives the agenda over
 * the (simulated) decided model, so we always seed the NEXT apply from the
 * `nextChunk.family.parentId` the previous apply returned.
 */
function threeFamilies(): FullReviewModelWire {
  const nodes: ReviewModelNode[] = [
    node({ id: 'A', candidate_type: 'logical_data_entity', name: 'AAA' }),
    node({ id: 'A-a', candidate_type: 'logical_data_attribute', name: 'a' }),
    node({ id: 'B', candidate_type: 'logical_data_entity', name: 'BBB' }),
    node({ id: 'B-a', candidate_type: 'logical_data_attribute', name: 'a' }),
    node({ id: 'C', candidate_type: 'logical_data_entity', name: 'CCC' }),
    node({ id: 'C-a', candidate_type: 'logical_data_attribute', name: 'a' }),
  ];
  return {
    scan_selection: [{ run_id: CODE_RUN, scan_kind: 'code' }],
    nodes,
    edges: [parentChildEdge('A', 'A-a'), parentChildEdge('B', 'B-a'), parentChildEdge('C', 'C-a')],
    findings: [],
    blast_radius: [
      { candidate_id: 'A', dependents: [{ dependent_id: 'A-a', via_edge_kind: 'parent_child', via_predecessor_id: 'A' }], would_be_orphaned_parent_ids: [] },
      { candidate_id: 'A-a', dependents: [], would_be_orphaned_parent_ids: [] },
      { candidate_id: 'B', dependents: [{ dependent_id: 'B-a', via_edge_kind: 'parent_child', via_predecessor_id: 'B' }], would_be_orphaned_parent_ids: [] },
      { candidate_id: 'B-a', dependents: [], would_be_orphaned_parent_ids: [] },
      { candidate_id: 'C', dependents: [{ dependent_id: 'C-a', via_edge_kind: 'parent_child', via_predecessor_id: 'C' }], would_be_orphaned_parent_ids: [] },
      { candidate_id: 'C-a', dependents: [], would_be_orphaned_parent_ids: [] },
    ],
    aggregations: { total_candidates: 6, total_findings: 0 },
  };
}

describe('redesign-2 GAP — one-click-per-family walk to exhaustion + terminal Save (TG6)', () => {
  it('decides 3 families one click at a time: each apply auto-advances to the next family, the last exhausts the agenda and appends the terminal Save', async () => {
    // The SERVER re-derives the live agenda each call. To simulate the real client,
    // mutate the SAME model's nodes to decided between applies (the route re-fetches
    // a fresh model that reflects the just-applied write). We thread that by marking
    // the written ids approved on the shared model object before the next propose.
    const model = threeFamilies();
    const { orchestrator, fetchCalls } = makeOrchestrator();
    const { deps: d, appended } = await deps(orchestrator);

    const markDecided = (ids: string[], status: string) => {
      for (const n of model.nodes) if (ids.includes(n.id)) n.review_status = status;
    };

    // The walk: seed each apply from the family the PREVIOUS apply auto-advanced to.
    // Family order by name: A, B, C.
    let seed = 'A';
    const visited: string[] = [];
    for (let step = 0; step < 3; step += 1) {
      const outcome = await propose(
        model,
        { kind: 'apply-decision', seedCandidateIds: [seed], findingIds: [], action: 'approved', scope: 'cascade' },
        d,
      );
      expect(outcome.kind).toBe('applied');
      if (outcome.kind !== 'applied') throw new Error('expected applied');
      expect(outcome.advanced).toBe(true);

      // Reflect the write on the shared model so the next agenda derivation drops it.
      const written = bodyOf(fetchCalls[fetchCalls.length - 1]).candidate_ids;
      markDecided(written, 'approved');
      visited.push(seed);

      if (step < 2) {
        // Not yet exhausted: the outcome carries the NEXT family + NO terminal Save.
        expect(outcome.terminalSaveTurn).toBeNull();
        expect(outcome.nextChunk).not.toBeNull();
        seed = outcome.nextChunk!.family!.parentId;
      } else {
        // The LAST apply exhausted the agenda: no next chunk + a terminal Save.
        expect(outcome.nextChunk).toBeNull();
        expect(outcome.terminalSaveTurn).not.toBeNull();
        expect(outcome.terminalSaveTurn?.intent).toEqual({ kind: 'save' });
      }
    }

    // Each family was visited exactly once, in deterministic agenda (name) order.
    expect(visited).toEqual(['A', 'B', 'C']);
    // Exactly three applies fired (one per family) + the terminal Save was appended.
    const applyCalls = fetchCalls.filter((c) => c.url.includes('/bulk-review-cascade'));
    expect(applyCalls).toHaveLength(3);
    const appendedSave = appended.find(
      (t): t is { kind: string; intent: { kind: string } } =>
        typeof t === 'object' && t !== null && (t as { kind?: unknown }).kind === 'pending-confirmation',
    );
    expect(appendedSave?.intent.kind).toBe('save');
  });
});

// ---------------------------------------------------------------------------
// 2. scope:'family' leaves the cascaded entities as their OWN later chunk;
//    scope:'cascade' decides them now (no later chunk).
// ---------------------------------------------------------------------------

/**
 * An interface family (iface + endpoint) whose endpoint data-binds to an OFF-family
 * `logical_data_entity` (which itself parents an attribute). `scope:'cascade'` on
 * the iface pulls the entity + attr now; `scope:'family'` decides ONLY iface+ep,
 * leaving the entity family to arrive as the next chunk.
 */
function ifaceBindingToEntityFamily(): FullReviewModelWire {
  const nodes: ReviewModelNode[] = [
    node({ id: 'iface', candidate_type: 'interface', name: 'Api' }),
    node({ id: 'ep', candidate_type: 'endpoint', name: 'GetOrder' }),
    node({ id: 'entity', candidate_type: 'logical_data_entity', name: 'Order' }),
    node({ id: 'attr', candidate_type: 'logical_data_attribute', name: 'id' }),
  ];
  return {
    scan_selection: [{ run_id: CODE_RUN, scan_kind: 'code' }],
    nodes,
    edges: [
      parentChildEdge('iface', 'ep'),
      parentChildEdge('entity', 'attr'),
    ],
    findings: [],
    blast_radius: [
      {
        candidate_id: 'iface',
        dependents: [
          { dependent_id: 'ep', via_edge_kind: 'parent_child', via_predecessor_id: 'iface' },
          { dependent_id: 'entity', via_edge_kind: 'endpoint_data_effects', via_predecessor_id: 'iface' },
        ],
        would_be_orphaned_parent_ids: [],
      },
      { candidate_id: 'ep', dependents: [], would_be_orphaned_parent_ids: [] },
      {
        candidate_id: 'entity',
        dependents: [{ dependent_id: 'attr', via_edge_kind: 'parent_child', via_predecessor_id: 'entity' }],
        would_be_orphaned_parent_ids: [],
      },
      { candidate_id: 'attr', dependents: [], would_be_orphaned_parent_ids: [] },
    ],
    aggregations: { total_candidates: 4, total_findings: 0 },
  };
}

describe('redesign-2 GAP — scope:family vs scope:cascade: who decides the cascaded entity (TG6)', () => {
  it('scope:family decides ONLY iface+ep and the cascaded entity family ARRIVES as the next chunk (still pending)', async () => {
    const model = ifaceBindingToEntityFamily();
    const { orchestrator, fetchCalls } = makeOrchestrator();
    const { deps: d } = await deps(orchestrator);

    const outcome = await propose(
      model,
      { kind: 'apply-decision', seedCandidateIds: ['iface'], findingIds: [], action: 'approved', scope: 'family' },
      d,
    );
    expect(outcome.kind).toBe('applied');
    if (outcome.kind !== 'applied') throw new Error('expected applied');

    // ONLY the iface family was written (the entity is NOT cascaded by a family apply).
    expect(new Set(bodyOf(fetchCalls[0]).candidate_ids)).toEqual(new Set(['iface', 'ep']));

    // The cascaded entity family is STILL pending → it is exactly the next chunk.
    expect(outcome.advanced).toBe(true);
    expect(outcome.terminalSaveTurn).toBeNull();
    expect(outcome.nextChunk).not.toBeNull();
    expect(outcome.nextChunk?.family?.parentId).toBe('entity');
    expect(outcome.nextChunk?.items.map((it) => it.id)).toEqual(['entity', 'attr']);
  });

  it('scope:cascade decides iface+ep+entity+attr NOW, so the entity does NOT get its own later chunk (agenda exhausted)', async () => {
    const model = ifaceBindingToEntityFamily();
    const { orchestrator, fetchCalls } = makeOrchestrator();
    const { deps: d } = await deps(orchestrator);

    const outcome = await propose(
      model,
      { kind: 'apply-decision', seedCandidateIds: ['iface'], findingIds: [], action: 'approved', scope: 'cascade' },
      d,
    );
    expect(outcome.kind).toBe('applied');
    if (outcome.kind !== 'applied') throw new Error('expected applied');

    // The FULL cascade was written — the entity + its attr are decided NOW.
    expect(new Set(bodyOf(fetchCalls[0]).candidate_ids)).toEqual(
      new Set(['iface', 'ep', 'entity', 'attr']),
    );

    // Nothing is left pending → the entity does NOT get its own chunk; the agenda
    // is exhausted and the terminal Save is appended.
    expect(outcome.nextChunk).toBeNull();
    expect(outcome.terminalSaveTurn).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. CRITICAL Q1 — already-decided members are NOT re-actioned (the fix).
// ---------------------------------------------------------------------------

/**
 * A PARTIALLY-approved family: parent pending; one child already APPROVED; one
 * child pending. A Reject-All / Defer-All must not flip the already-approved child.
 */
function partiallyApprovedFamily(): FullReviewModelWire {
  const nodes: ReviewModelNode[] = [
    node({ id: 'p', candidate_type: 'interface', name: 'Iface', review_status: 'pending_review' }),
    node({ id: 'c-appr', candidate_type: 'endpoint', name: 'aaa', review_status: 'approved' }),
    node({ id: 'c-pend', candidate_type: 'endpoint', name: 'bbb', review_status: 'pending_review' }),
  ];
  return {
    scan_selection: [{ run_id: CODE_RUN, scan_kind: 'code' }],
    nodes,
    edges: [parentChildEdge('p', 'c-appr'), parentChildEdge('p', 'c-pend')],
    findings: [],
    blast_radius: [
      {
        candidate_id: 'p',
        dependents: [
          { dependent_id: 'c-appr', via_edge_kind: 'parent_child', via_predecessor_id: 'p' },
          { dependent_id: 'c-pend', via_edge_kind: 'parent_child', via_predecessor_id: 'p' },
        ],
        would_be_orphaned_parent_ids: [],
      },
      { candidate_id: 'c-appr', dependents: [], would_be_orphaned_parent_ids: [] },
      { candidate_id: 'c-pend', dependents: [], would_be_orphaned_parent_ids: [] },
    ],
    aggregations: { total_candidates: 3, total_findings: 0 },
  };
}

/**
 * A family being REJECTED that also has an incident relationship-ROW edge to a
 * surviving entity. On reject the resolver surfaces the ROW candidate `rel-row`
 * (a NON-node id). One child is already APPROVED — it must be dropped — while the
 * surfaced relationship row MUST still be sent (it is not a decided family member).
 */
function partiallyApprovedFamilyWithRejectRow(): FullReviewModelWire {
  const nodes: ReviewModelNode[] = [
    node({ id: 'p', candidate_type: 'interface', name: 'Iface', review_status: 'pending_review' }),
    node({ id: 'c-appr', candidate_type: 'endpoint', name: 'aaa', review_status: 'approved' }),
    node({ id: 'bound-entity', candidate_type: 'logical_data_entity', name: 'Order', review_status: 'pending_review' }),
  ];
  return {
    scan_selection: [{ run_id: CODE_RUN, scan_kind: 'code' }],
    nodes,
    edges: [
      parentChildEdge('p', 'c-appr'),
      {
        edge_kind: 'interface_logical_entities',
        from_id: 'p',
        to_id: 'bound-entity',
        relationship_candidate_id: 'rel-row',
        cross_scan: false,
      },
    ],
    findings: [],
    blast_radius: [
      {
        candidate_id: 'p',
        dependents: [{ dependent_id: 'c-appr', via_edge_kind: 'parent_child', via_predecessor_id: 'p' }],
        would_be_orphaned_parent_ids: [],
      },
      { candidate_id: 'c-appr', dependents: [], would_be_orphaned_parent_ids: [] },
      { candidate_id: 'bound-entity', dependents: [], would_be_orphaned_parent_ids: [] },
    ],
    aggregations: { total_candidates: 3, total_findings: 0 },
  };
}

describe('redesign-2 GAP — CRITICAL Q1: already-decided members are NOT re-actioned (TG6)', () => {
  it('REJECT ALL on a partially-approved family EXCLUDES the already-approved member from the write-set (it is not flipped to rejected)', async () => {
    const model = partiallyApprovedFamily();
    const { orchestrator, fetchCalls } = makeOrchestrator();
    const { deps: d } = await deps(orchestrator);

    await propose(
      model,
      { kind: 'apply-decision', seedCandidateIds: ['p'], findingIds: [], action: 'rejected', scope: 'cascade' },
      d,
    );

    const body = bodyOf(fetchCalls[0]);
    // The already-approved child is NEVER sent — so the AMS applicator (which would
    // OVERWRITE an approved row to rejected) cannot flip it.
    expect(body.candidate_ids).not.toContain('c-appr');
    // Only the actionable (pending) members are rejected.
    expect(new Set(body.candidate_ids)).toEqual(new Set(['p', 'c-pend']));
    expect(body.review_status).toBe('rejected');
  });

  it('DEFER ALL (scope:family) on a partially-approved family likewise EXCLUDES the already-approved member', async () => {
    const model = partiallyApprovedFamily();
    const { orchestrator, fetchCalls } = makeOrchestrator();
    const { deps: d } = await deps(orchestrator);

    await propose(
      model,
      { kind: 'apply-decision', seedCandidateIds: ['p'], findingIds: [], action: 'deferred', scope: 'family' },
      d,
    );

    const body = bodyOf(fetchCalls[0]);
    expect(body.candidate_ids).not.toContain('c-appr');
    expect(new Set(body.candidate_ids)).toEqual(new Set(['p', 'c-pend']));
    expect(body.review_status).toBe('deferred');
  });

  it('APPROVE ALL on a partially-approved family OMITS the already-approved member from the write-set (no redundant re-action)', async () => {
    const model = partiallyApprovedFamily();
    const { orchestrator, fetchCalls } = makeOrchestrator();
    const { deps: d } = await deps(orchestrator);

    await propose(
      model,
      { kind: 'apply-decision', seedCandidateIds: ['p'], findingIds: [], action: 'approved', scope: 'cascade' },
      d,
    );

    const body = bodyOf(fetchCalls[0]);
    // The applicator would no-op an already-approved member anyway, but the
    // write-set must not carry an already-decided member at all (Q1 uniformly).
    expect(body.candidate_ids).not.toContain('c-appr');
    expect(new Set(body.candidate_ids)).toEqual(new Set(['p', 'c-pend']));
  });

  it('REJECT ALL drops the already-approved NODE member but STILL sends the reject-surfaced relationship-ROW (a non-node id is not a decided member)', async () => {
    const model = partiallyApprovedFamilyWithRejectRow();
    const { orchestrator, fetchCalls } = makeOrchestrator();
    const { deps: d } = await deps(orchestrator);

    await propose(
      model,
      { kind: 'apply-decision', seedCandidateIds: ['p'], findingIds: [], action: 'rejected', scope: 'cascade' },
      d,
    );

    const body = bodyOf(fetchCalls[0]);
    // The already-approved node child is excluded…
    expect(body.candidate_ids).not.toContain('c-appr');
    // …but the surfaced relationship-ROW candidate (a NON-node id) is STILL marked
    // rejected — it is not an already-decided family member.
    expect(body.candidate_ids).toContain('rel-row');
    expect(new Set(body.candidate_ids)).toEqual(new Set(['p', 'rel-row']));
  });
});
