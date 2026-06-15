/**
 * Tests — Family-aware chunk turn + family-bulk intent (Spec
 * 2026-06-05-review-room-agenda-redesign, Task Group 2).
 *
 * Group 2 makes the chunk-summary turn FAMILY-AWARE (an additive, optional
 * `family = { parentId, childIds }` + a `familyBulkActions` flag) and proves the
 * family-level bulk disposition is representable on the EXISTING `apply-decision`
 * intent by seeding the family PARENT (the cascade pulls the `parent_child`
 * children), flowing UNCHANGED into the atomic `bulk-review-cascade` apply path.
 *
 * The sequencer is a PURE function of model + cursor, so the turn-shape tests are
 * direct `getReviewChunk` calls; the family-bulk apply test drives the
 * coordinator's deterministic `captureDeterministicTurn` path with the
 * orchestrator's write mocked at the `fetch` boundary (no real I/O).
 *
 * Coverage (4 focused tests):
 *   1. A FAMILY chunk turn carries `family = { parentId, childIds }` + the
 *      `familyBulkActions` Approve/Reject/Defer flag, with the parent as the
 *      first item and the children as the rest.
 *   2. A NON-family chunk (orphan-by-type / findings / cross-scan) validates with
 *      `family` + `familyBulkActions` ABSENT (the additive-optional contract).
 *   3. A family-bulk APPROVE-all intent seeds the PARENT and flows into the
 *      existing `apply-decision` → `bulk-review-cascade` path acting on the WHOLE
 *      family (parent + children pulled by the parent_child cascade).
 *   4. The seed-parent representation is EXACT for the Group 3 confirm-skip: the
 *      resolved touched set for the family-bulk seed == the rendered family ids,
 *      so the bulk is fully visible (a precondition Group 3's skip relies on).
 */

import { getReviewChunk } from '../agendaSequencer';
import {
  captureDeterministicTurn,
  deriveFamilyForSeed,
  type ReviewCoordinatorDeps,
} from '../reviewConversationCoordinator';
import { preview } from '../reviewTools';
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

/**
 * A model with ONE structural family (entity `Order` + attributes `a`/`b`) whose
 * blast radius walks `parent_child` (the parent's reject/approve pulls both
 * children, mirroring Spec 1's downward closure). No off-screen dependents — the
 * family is self-contained.
 */
function familyModel(): FullReviewModelWire {
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
        // The parent's downward closure reaches BOTH attributes via parent_child.
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

/** An orphan-only model (two field-less top-level entities, no parent_child). */
function orphanModel(): FullReviewModelWire {
  const nodes: ReviewModelNode[] = [
    node({ id: 'orphan-1', candidate_type: 'business_logics', name: 'Svc1' }),
    node({ id: 'orphan-2', candidate_type: 'business_logics', name: 'Svc2' }),
  ];
  return {
    scan_selection: [{ run_id: CODE_RUN, scan_kind: 'code' }],
    nodes,
    edges: [],
    findings: [],
    blast_radius: nodes.map((n) => ({
      candidate_id: n.id,
      dependents: [],
      would_be_orphaned_parent_ids: [],
    })),
    aggregations: { total_candidates: 2, total_findings: 0 },
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
      json: async () => ({ updated_candidate_count: 3, updated_finding_count: 0, updated_count: 3 }),
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('family-aware chunk turn + family-bulk intent (Task Group 2)', () => {
  // 1 -------------------------------------------------------------------------
  it('a FAMILY chunk turn carries family = { parentId, childIds } + familyBulkActions (parent first, children the rest)', () => {
    const chunk = getReviewChunk(familyModel(), 0).chunk;

    // The new family metadata is present + names the parent within `items`.
    expect(chunk.family).toEqual({ parentId: 'entity', childIds: ['attr-a', 'attr-b'] });
    // The parent is the FIRST item; the children are the remaining items.
    expect(chunk.items[0].id).toBe('entity');
    expect(chunk.items.slice(1).map((it) => it.id)).toEqual(['attr-a', 'attr-b']);
    // The family-bulk control flag offers all three dispositions.
    expect(chunk.familyBulkActions).toEqual(['approved', 'rejected', 'deferred']);
  });

  // 2 -------------------------------------------------------------------------
  it('a NON-family chunk (orphans-by-type) validates with family + familyBulkActions ABSENT (additive-optional)', () => {
    const chunk = getReviewChunk(orphanModel(), 0).chunk;

    // Orphans are grouped by type — NOT a family — so the new fields stay absent.
    expect(chunk.family).toBeUndefined();
    expect(chunk.familyBulkActions).toBeUndefined();
    // It is still a valid chunk turn carrying its items.
    expect(chunk.items.map((it) => it.id)).toEqual(['orphan-1', 'orphan-2']);
  });

  // 3 -------------------------------------------------------------------------
  it('a family-bulk APPROVE-all intent seeds the PARENT and flows into apply-decision → bulk-review-cascade over the WHOLE family', async () => {
    const model = familyModel();
    const { orchestrator, fetchCalls } = makeOrchestrator();
    const { deps: d } = await deps(orchestrator);

    // The frontend proposes the family bulk by seeding the family PARENT id into
    // the EXISTING apply-decision intent (no new apply path). The cascade pulls
    // the parent_child children, so the whole family is dispositioned in one apply.
    const chunk = getReviewChunk(model, 0).chunk;
    const parentId = chunk.family!.parentId;

    const outcome = await captureDeterministicTurn(
      {
        ...CTX(model),
        action: {
          kind: 'propose-intent',
          intent: { kind: 'apply-decision', seedCandidateIds: [parentId], findingIds: [], action: 'approved' },
          userText: 'approve all in this family',
        },
      },
      d,
    );

    // The family bulk is fully visible (the cascade stays inside the family), so
    // Group 3's confirm-skip applies it immediately via the SAME orchestrator —
    // EXACTLY ONE write, to the unchanged atomic bulk-review-cascade endpoint.
    expect(outcome.kind === 'applied' || outcome.kind === 'pending-confirmation').toBe(true);
    expect(fetchCalls.length).toBe(1);
    expect(fetchCalls[0].method).toBe('POST');
    expect(fetchCalls[0].url).toContain('/candidates/bulk-review-cascade');
    const body = fetchCalls[0].body as { candidate_ids: string[]; review_status: string };
    // The apply acts on the WHOLE family (parent + both attributes via cascade).
    expect(new Set(body.candidate_ids)).toEqual(new Set(['entity', 'attr-a', 'attr-b']));
    expect(body.review_status).toBe('approved');
  });

  // 4 -------------------------------------------------------------------------
  it('the seed-PARENT representation is EXACT for the confirm-skip: resolved touched set == the rendered family ids', () => {
    const model = familyModel();
    const chunk = getReviewChunk(model, 0).chunk;
    const renderedIds = new Set(chunk.items.map((it) => it.id));

    // Seeding the parent → resolveBulkActionSet pulls the parent_child children.
    const resolved = preview([chunk.family!.parentId], 'approved', model);
    const touched = new Set(resolved.candidates.map((c) => c.candidate_id));

    // The re-derived family (server-side) equals the rendered family equals the
    // resolved touched set — the exactness the Group 3 subset test depends on.
    const derived = deriveFamilyForSeed([chunk.family!.parentId], model);
    expect(derived).toEqual(renderedIds);
    expect(touched).toEqual(renderedIds);
  });
});
