/**
 * Tests — Coordinator immediate-apply + scope branch + next-chunk / exhaustion
 * (Spec 2026-06-06-discovery-review-room-agenda-redesign-2, Task Group 4).
 *
 * The 2026-06-06 redesign retires the per-chunk + per-conflict confirm gate. These
 * focused tests pin ONLY the critical Task-Group-4 coordinator behaviours:
 *
 *   1. `apply-decision` (`scope:'cascade'`) applies IMMEDIATELY — no
 *      pending-confirmation — and carries the NEXT agenda chunk in the `'applied'`
 *      outcome (`advanced === true`).
 *   2. `apply-decision` (`scope:'family'`) applies IMMEDIATELY too, writing EXACTLY
 *      the `deriveFamilyForSeed` id set (seed ∪ direct parent_child children) — the
 *      off-family cascade is NOT written.
 *   3. `apply-decision` (`scope:'cascade'`) writes the resolver's FULL touched set
 *      (the off-family node IS written) — the family-vs-cascade contrast.
 *   4. `resolve-conflict` applies immediately and returns the SAME chunk REFRESHED
 *      with the conflict cleared, WITHOUT advancing (`advanced === false`).
 *   5. `resolve-conflicts-by-pattern` applies immediately + refreshes in place
 *      (no advance).
 *   6. When a disposition exhausts the agenda (`nextChunk === null`), a terminal
 *      Save `pending-confirmation` turn is appended (the ONLY surviving gate).
 *
 * All LLM is bypassed (the deterministic `captureDeterministicTurn` path); the
 * orchestrator's writes are mocked at the `fetch` boundary; the thread store is
 * stubbed so the appended turns are observable without I/O.
 */

import {
  captureDeterministicTurn,
  deriveFamilyForSeed,
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

/**
 * TWO self-contained families (no off-family cascade):
 *   - Family 1: entity `e1` (Order) + attributes `e1a` / `e1b`.
 *   - Family 2: entity `e2` (Item)  + attribute  `e2a`.
 * `e1` sorts before `e2` by name (Order < Item? No — "Item" < "Order"), so name
 * order is asserted-agnostically: we identify chunks by their parent id, not order.
 */
function twoFamilies(): FullReviewModelWire {
  const nodes: ReviewModelNode[] = [
    node({ id: 'e1', candidate_type: 'logical_data_entity', name: 'AAA-Order' }),
    node({ id: 'e1a', candidate_type: 'logical_data_attribute', name: 'a' }),
    node({ id: 'e1b', candidate_type: 'logical_data_attribute', name: 'b' }),
    node({ id: 'e2', candidate_type: 'logical_data_entity', name: 'ZZZ-Item' }),
    node({ id: 'e2a', candidate_type: 'logical_data_attribute', name: 'a' }),
  ];
  return {
    scan_selection: [{ run_id: CODE_RUN, scan_kind: 'code' }],
    nodes,
    edges: [
      parentChildEdge('e1', 'e1a'),
      parentChildEdge('e1', 'e1b'),
      parentChildEdge('e2', 'e2a'),
    ],
    findings: [],
    blast_radius: [
      {
        candidate_id: 'e1',
        dependents: [
          { dependent_id: 'e1a', via_edge_kind: 'parent_child', via_predecessor_id: 'e1' },
          { dependent_id: 'e1b', via_edge_kind: 'parent_child', via_predecessor_id: 'e1' },
        ],
        would_be_orphaned_parent_ids: [],
      },
      { candidate_id: 'e1a', dependents: [], would_be_orphaned_parent_ids: [] },
      { candidate_id: 'e1b', dependents: [], would_be_orphaned_parent_ids: [] },
      {
        candidate_id: 'e2',
        dependents: [
          { dependent_id: 'e2a', via_edge_kind: 'parent_child', via_predecessor_id: 'e2' },
        ],
        would_be_orphaned_parent_ids: [],
      },
      { candidate_id: 'e2a', dependents: [], would_be_orphaned_parent_ids: [] },
    ],
    aggregations: { total_candidates: 5, total_findings: 0 },
  };
}

/** A SINGLE self-contained family (entity + attr) — deciding it exhausts the agenda. */
function loneFamily(): FullReviewModelWire {
  const nodes: ReviewModelNode[] = [
    node({ id: 'lone', candidate_type: 'logical_data_entity', name: 'Order' }),
    node({ id: 'lone-a', candidate_type: 'logical_data_attribute', name: 'a' }),
  ];
  return {
    scan_selection: [{ run_id: CODE_RUN, scan_kind: 'code' }],
    nodes,
    edges: [parentChildEdge('lone', 'lone-a')],
    findings: [],
    blast_radius: [
      {
        candidate_id: 'lone',
        dependents: [
          { dependent_id: 'lone-a', via_edge_kind: 'parent_child', via_predecessor_id: 'lone' },
        ],
        would_be_orphaned_parent_ids: [],
      },
      { candidate_id: 'lone-a', dependents: [], would_be_orphaned_parent_ids: [] },
    ],
    aggregations: { total_candidates: 2, total_findings: 0 },
  };
}

/**
 * A family (interface + endpoint) whose interface's blast radius ALSO reaches a
 * self-contained `logical_data_entity` off-family (via `endpoint_data_effects`).
 * `scope:'cascade'` pulls `far-entity`; `scope:'family'` does NOT.
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
 * A live-conflict family (interface `ci` + endpoint `ce`; the endpoint has a live
 * `framework` conflict) PLUS a second plain family so the agenda has a next chunk.
 * Resolving the conflict must NOT advance — it re-renders the conflict family with
 * the conflict cleared.
 */
function conflictModel(): FullReviewModelWire {
  const nodes: ReviewModelNode[] = [
    node({ id: 'ci', candidate_type: 'interface', name: 'Api' }),
    node({
      id: 'ce',
      candidate_type: 'endpoint',
      name: 'GetX',
      conflict_state: {
        has_live_conflict: true,
        live_conflict_attrs: ['framework'],
        conflicts: {
          framework: [
            { value: 'JAX-RS', source: 'src-jaxrs' },
            { value: 'Spring MVC', source: 'src-spring' },
          ],
        },
        conflict_resolutions: null,
      },
    }),
    node({ id: 'p2', candidate_type: 'interface', name: 'Other' }),
    node({ id: 'p2e', candidate_type: 'endpoint', name: 'GetY' }),
  ];
  return {
    scan_selection: [{ run_id: CODE_RUN, scan_kind: 'code' }],
    nodes,
    edges: [parentChildEdge('ci', 'ce'), parentChildEdge('p2', 'p2e')],
    findings: [],
    blast_radius: [
      { candidate_id: 'ci', dependents: [{ dependent_id: 'ce', via_edge_kind: 'parent_child', via_predecessor_id: 'ci' }], would_be_orphaned_parent_ids: [] },
      { candidate_id: 'ce', dependents: [], would_be_orphaned_parent_ids: [] },
      { candidate_id: 'p2', dependents: [{ dependent_id: 'p2e', via_edge_kind: 'parent_child', via_predecessor_id: 'p2' }], would_be_orphaned_parent_ids: [] },
      { candidate_id: 'p2e', dependents: [], would_be_orphaned_parent_ids: [] },
    ],
    aggregations: { total_candidates: 4, total_findings: 0 },
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

const CTX = (model: FullReviewModelWire) => ({
  projectId: PROJECT,
  architectureId: ARCH,
  runId: CODE_RUN,
  model,
  scanPair: SCAN_PAIR,
});

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
    newId: () => 'save-pending-fixed',
  };
  return { deps: d, appended };
}

async function propose(
  model: FullReviewModelWire,
  intent: ProposedReviewIntent,
  d: ReviewCoordinatorDeps,
) {
  return captureDeterministicTurn(
    { ...CTX(model), action: { kind: 'propose-intent', intent, userText: 'act' } },
    d,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('coordinator immediate-apply + scope branch + auto-advance (Task Group 4)', () => {
  // 1 -------------------------------------------------------------------------
  it('apply-decision (scope:cascade) applies immediately and carries the NEXT chunk in the applied outcome', async () => {
    const model = twoFamilies();
    const { orchestrator, fetchCalls } = makeOrchestrator();
    const { deps: d } = await deps(orchestrator);

    // Decide family 1 (seed e1; full cascade). It is self-contained → writes the
    // whole family. The agenda still has family 2, so a next chunk comes back.
    const outcome = await propose(
      model,
      { kind: 'apply-decision', seedCandidateIds: ['e1'], findingIds: [], action: 'approved', scope: 'cascade' },
      d,
    );

    expect(outcome.kind).toBe('applied');
    if (outcome.kind !== 'applied') throw new Error('expected applied');
    // Applied immediately — exactly one write.
    expect(fetchCalls.length).toBe(1);
    // A disposition auto-advances and carries the NEXT chunk (family 2).
    expect(outcome.advanced).toBe(true);
    expect(outcome.terminalSaveTurn).toBeNull();
    expect(outcome.nextChunk).not.toBeNull();
    // The next chunk is family 2 (the just-decided family 1 is deduped out).
    expect(outcome.nextChunk?.family?.parentId).toBe('e2');
    expect(outcome.nextChunk?.items.map((it) => it.id)).toEqual(['e2', 'e2a']);
  });

  // 2 -------------------------------------------------------------------------
  it('apply-decision (scope:family) applies immediately writing EXACTLY the deriveFamilyForSeed set (no off-family cascade)', async () => {
    const model = familyEscapingToNode();
    const { orchestrator, fetchCalls } = makeOrchestrator();
    const { deps: d } = await deps(orchestrator);

    const outcome = await propose(
      model,
      { kind: 'apply-decision', seedCandidateIds: ['iface'], findingIds: [], action: 'approved', scope: 'family' },
      d,
    );

    expect(outcome.kind).toBe('applied');
    expect(fetchCalls.length).toBe(1);
    const body = fetchCalls[0].body as { candidate_ids: string[]; review_status: string };
    // EXACTLY the family set (seed ∪ direct parent_child children) — `far-entity`
    // (off-family cascade) is NOT written.
    const expectedFamily = deriveFamilyForSeed(['iface'], model);
    expect(new Set(body.candidate_ids)).toEqual(expectedFamily);
    expect(new Set(body.candidate_ids)).toEqual(new Set(['iface', 'ep']));
    expect(body.candidate_ids).not.toContain('far-entity');
    expect(body.review_status).toBe('approved');
  });

  // 3 -------------------------------------------------------------------------
  it('apply-decision (scope:cascade) on the SAME seed writes the resolver FULL touched set (the off-family node IS written)', async () => {
    const model = familyEscapingToNode();
    const { orchestrator, fetchCalls } = makeOrchestrator();
    const { deps: d } = await deps(orchestrator);

    const outcome = await propose(
      model,
      { kind: 'apply-decision', seedCandidateIds: ['iface'], findingIds: [], action: 'approved', scope: 'cascade' },
      d,
    );

    expect(outcome.kind).toBe('applied');
    expect(fetchCalls.length).toBe(1);
    const body = fetchCalls[0].body as { candidate_ids: string[] };
    // The FULL cascade — `far-entity` IS written (the contrast with scope:family).
    expect(new Set(body.candidate_ids)).toEqual(new Set(['iface', 'ep', 'far-entity']));
  });

  // 4 -------------------------------------------------------------------------
  it('resolve-conflict applies immediately and returns the SAME chunk REFRESHED (conflict cleared), WITHOUT advancing', async () => {
    const model = conflictModel();
    const { orchestrator, fetchCalls } = makeOrchestrator();
    const { deps: d } = await deps(orchestrator);

    const outcome = await propose(
      model,
      { kind: 'resolve-conflict', candidateId: 'ce', attr: 'framework', chosenValue: 'JAX-RS', chosenSource: 'src-jaxrs' },
      d,
    );

    expect(outcome.kind).toBe('applied');
    if (outcome.kind !== 'applied') throw new Error('expected applied');
    // ONE PATCH fired (the immediate resolve).
    expect(fetchCalls.length).toBe(1);
    expect(fetchCalls[0].method).toBe('PATCH');
    expect(fetchCalls[0].url).toContain('/resolve-conflict');
    // A conflict does NOT advance — it re-renders the SAME chunk in place.
    expect(outcome.advanced).toBe(false);
    expect(outcome.terminalSaveTurn).toBeNull();
    // The refreshed chunk is the SAME family (still contains `ce`) with the conflict
    // cleared — the pick-a-source control is gone (no `conflicts` on the item).
    expect(outcome.nextChunk?.items.map((it) => it.id)).toContain('ce');
    const ceItem = outcome.nextChunk?.items.find((it) => it.id === 'ce');
    expect(ceItem?.conflicts ?? []).toHaveLength(0);
  });

  // 5 -------------------------------------------------------------------------
  it('resolve-conflicts-by-pattern applies immediately and refreshes in place (no advance)', async () => {
    // Two members of the same `framework` similarity class so the bulk is offered.
    const model = conflictModel();
    // Give the second family's endpoint the SAME live conflict so the class is ≥2.
    const p2e = model.nodes.find((n) => n.id === 'p2e')!;
    p2e.conflict_state = {
      has_live_conflict: true,
      live_conflict_attrs: ['framework'],
      conflicts: {
        framework: [
          { value: 'JAX-RS-2', source: 'src-jaxrs' },
          { value: 'Spring MVC-2', source: 'src-spring' },
        ],
      },
      conflict_resolutions: null,
    };

    const { orchestrator, fetchCalls } = makeOrchestrator();
    const { deps: d } = await deps(orchestrator);

    const outcome = await propose(
      model,
      { kind: 'resolve-conflicts-by-pattern', candidateId: 'ce', attr: 'framework', chosenSource: 'src-jaxrs', classCandidateIds: [] },
      d,
    );

    expect(outcome.kind).toBe('applied');
    if (outcome.kind !== 'applied') throw new Error('expected applied');
    expect(outcome.advanced).toBe(false);
    // ONE PATCH per class member (ce + p2e), immediately.
    expect(fetchCalls.length).toBe(2);
    for (const c of fetchCalls) {
      expect(c.method).toBe('PATCH');
      expect((c.body as { chosen_source: string }).chosen_source).toBe('src-jaxrs');
    }
  });

  // 6 -------------------------------------------------------------------------
  it('a disposition that EXHAUSTS the agenda returns nextChunk === null and appends a terminal Save pending-confirmation', async () => {
    const model = loneFamily();
    const { orchestrator, fetchCalls } = makeOrchestrator();
    const { deps: d, appended } = await deps(orchestrator);

    // Deciding the only family leaves the agenda empty → exhaustion.
    const outcome = await propose(
      model,
      { kind: 'apply-decision', seedCandidateIds: ['lone'], findingIds: [], action: 'approved', scope: 'cascade' },
      d,
    );

    expect(outcome.kind).toBe('applied');
    if (outcome.kind !== 'applied') throw new Error('expected applied');
    expect(fetchCalls.length).toBe(1); // the apply
    expect(outcome.advanced).toBe(true);
    // Exhausted → no next chunk + a terminal Save Yes/No on the outcome.
    expect(outcome.nextChunk).toBeNull();
    expect(outcome.terminalSaveTurn).not.toBeNull();
    expect(outcome.terminalSaveTurn?.kind).toBe('pending-confirmation');
    expect(outcome.terminalSaveTurn?.intent).toEqual({ kind: 'save' });
    // The terminal Save turn was ALSO appended to the transcript (so a reload shows it).
    const appendedSave = appended.find(
      (t): t is { kind: string; intent: { kind: string } } =>
        typeof t === 'object' && t !== null && (t as { kind?: unknown }).kind === 'pending-confirmation',
    );
    expect(appendedSave?.intent.kind).toBe('save');
  });
});
