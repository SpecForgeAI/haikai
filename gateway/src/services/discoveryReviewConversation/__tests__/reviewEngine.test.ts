/**
 * Tests — Discovery-Review Conversation Engine (Spec 3 — capstone, Task Group 2.1;
 * immediate-apply contract per 2026-06-06-discovery-review-room-agenda-redesign-2
 * Task Group 4).
 *
 * The oracle-safety heart of the whole spec. All LLM calls are mocked at the
 * `ArchitectLlmClient.callLlmToolLoop` boundary (the chassis test pattern); the
 * orchestrator's writes are mocked at the `fetch` boundary; the thread store is
 * stubbed via the coordinator deps so no real I/O fires.
 *
 * 2026-06-06 redesign-2 (Task Group 4): the per-chunk + per-conflict confirm gate
 * is RETIRED. Chunk dispositions (`apply-decision`) and conflict resolutions apply
 * IMMEDIATELY — the click/proposal IS the confirmation — returning an `'applied'`
 * outcome with NO `pending-confirmation` turn. The numbers the transcript records
 * are STILL deterministic (from `resolveBulkActionSet` / the conflict reads), never
 * LLM-asserted — that oracle-safety property is what these tests pin. The only
 * surviving gate (the terminal Save) is covered in `reviewTerminalSave.test.ts`.
 *
 * Coverage (8 focused tests):
 *   1. THE deterministic-counts proof: a mocked LLM proposing an apply-decision
 *      (lying about the count) APPLIES immediately, and the transcript's preview
 *      counts come from `resolveBulkActionSet`, NOT the LLM.
 *   2. The deterministic apply writes the FULL touched set (seed + cascade) — the
 *      LLM's bogus number never reaches the write.
 *   3. A deterministic apply (the no-LLM path) fires EXACTLY ONE orchestrator write
 *      over the full touched set + linked findings, immediately (no confirm step).
 *   4. The same immediate-apply holds for a REJECT proposed via the deterministic
 *      click path (no LLM involved).
 *   5. (retained) A natural-language "no" against a pending intent cancels with NO
 *      write (the `confirmPending` cancel path, still used by the terminal Save).
 *   6. Read-only tools are callable and never write.
 *   7. Deterministic agenda ordering: live conflicts → high-blast-radius →
 *      remaining-by-type → findings-by-severity → cross-scan links, code before DB.
 *   8. Bulk-resolve-by-pattern: a class of ≥2 APPLIES immediately (one same-source
 *      resolve PATCH per member, each to its OWN value) and refreshes in place; a
 *      class of 1 does NOT apply and errors back asking to resolve singly.
 */

import type {
  ArchitectLlmClient,
  CallLlmToolLoopArgs,
  CallLlmToolLoopResponse,
} from '../../architectConversation/architectLlmClient';
import { SUBMIT_ANSWER_TOOL_NAME } from '../../architectConversation/llmLoopRunner';
import {
  answerTurn,
  captureDeterministicTurn,
  confirmPending,
  type ReviewCoordinatorDeps,
} from '../reviewConversationCoordinator';
import {
  ReviewDecisionOrchestrator,
  type ReviewOrchestratorDeps,
} from '../reviewDecisionOrchestrator';
import { buildAgenda, getReviewChunk } from '../agendaSequencer';
import {
  getConflictSet,
  getSimilarConflicts,
  preview,
  selectScans,
} from '../reviewTools';
import type {
  FullReviewModelWire,
  ReviewModelNode,
} from '../reviewModelFull';
import type { SelectedScanSet } from '../reviewTurnShape';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PROJECT = 'proj-1';
const ARCH = 'arch-1';
const CODE_RUN = 'run-code';
const DB_RUN = 'run-db';

const SCAN_PAIR: SelectedScanSet = {
  runs: [
    { runId: CODE_RUN, scanKind: 'code', serviceId: null },
    { runId: DB_RUN, scanKind: 'database', serviceId: null },
  ],
  primaryRunId: CODE_RUN,
};

/** Build a node with sensible defaults; override what each test needs. */
function node(partial: Partial<ReviewModelNode> & { id: string }): ReviewModelNode {
  return {
    candidate_type: 'service',
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

/**
 * A rich fixture exercising every agenda section across both scans + a cross-
 * scan link. `c-iface` (code) has a high blast radius pulling in `c-dep`.
 */
function buildModel(): FullReviewModelWire {
  const nodes: ReviewModelNode[] = [
    // code: a live conflict on `framework` (JAX-RS vs Spring MVC)
    node({
      id: 'c-conflict',
      candidate_type: 'service',
      scan_kind: 'code',
      run_id: CODE_RUN,
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
    // code: a high-blast-radius interface (pulls in c-dep)
    node({ id: 'c-iface', candidate_type: 'interface', scan_kind: 'code', run_id: CODE_RUN }),
    // code: the dependent (cascaded by c-iface)
    node({ id: 'c-dep', candidate_type: 'endpoint', scan_kind: 'code', run_id: CODE_RUN }),
    // code: a remaining plain candidate
    node({ id: 'c-plain', candidate_type: 'logical_data_entity', scan_kind: 'code', run_id: CODE_RUN }),
    // db: a live conflict on `framework` SAME source-set as c-conflict (class member)
    node({
      id: 'd-conflict',
      candidate_type: 'physical_data_entity',
      scan_kind: 'database',
      run_id: DB_RUN,
      conflict_state: {
        has_live_conflict: true,
        live_conflict_attrs: ['framework'],
        conflicts: {
          framework: [
            { value: 'JAX-RS-db', source: 'src-jaxrs' },
            { value: 'Spring MVC-db', source: 'src-spring' },
          ],
        },
        conflict_resolutions: null,
      },
    }),
    // db: a remaining plain candidate
    node({ id: 'd-plain', candidate_type: 'physical_data_attribute', scan_kind: 'database', run_id: DB_RUN }),
  ];

  return {
    scan_selection: [
      { run_id: CODE_RUN, scan_kind: 'code' },
      { run_id: DB_RUN, scan_kind: 'database' },
    ],
    nodes,
    edges: [
      // cross-scan logical↔physical link (LAST in the agenda)
      {
        edge_kind: 'logical_data_entity_physical_data_entities',
        from_id: 'c-plain',
        to_id: 'd-plain',
        relationship_candidate_id: 'rel-1',
        cross_scan: true,
      },
    ],
    findings: [
      {
        id: 'f-high',
        review_status: 'pending_review',
        severity: 'high',
        category: 'data',
        finding_type: 'stored_proc',
        candidate_link_ids: ['c-iface'],
        run_id: CODE_RUN,
        scan_kind: 'code',
      },
      {
        id: 'f-low',
        review_status: 'pending_review',
        severity: 'low',
        category: 'data',
        finding_type: 'index',
        candidate_link_ids: [],
        run_id: CODE_RUN,
        scan_kind: 'code',
      },
    ],
    blast_radius: [
      { candidate_id: 'c-conflict', dependents: [], would_be_orphaned_parent_ids: [] },
      {
        candidate_id: 'c-iface',
        dependents: [
          { dependent_id: 'c-dep', via_edge_kind: 'endpoint_data_effects', via_predecessor_id: 'c-iface' },
        ],
        would_be_orphaned_parent_ids: [],
      },
      { candidate_id: 'c-dep', dependents: [], would_be_orphaned_parent_ids: [] },
      { candidate_id: 'c-plain', dependents: [], would_be_orphaned_parent_ids: [] },
      { candidate_id: 'd-conflict', dependents: [], would_be_orphaned_parent_ids: [] },
      { candidate_id: 'd-plain', dependents: [], would_be_orphaned_parent_ids: [] },
    ],
    aggregations: {
      total_candidates: 6,
      total_findings: 2,
    },
  };
}

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

/** An LLM whose single round returns the given terminal submit_structured_answer value. */
function llmProposing(value: unknown): { client: ArchitectLlmClient; callCount: () => number } {
  let calls = 0;
  const client: ArchitectLlmClient = {
    async callLlmToolLoop(_args: CallLlmToolLoopArgs): Promise<CallLlmToolLoopResponse> {
      calls += 1;
      return {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call-1',
              type: 'function',
              function: {
                name: SUBMIT_ANSWER_TOOL_NAME,
                arguments: JSON.stringify({ value }),
              },
            },
          ],
        },
      };
    },
    async callSingleShot() {
      throw new Error('callSingleShot must not be called');
    },
  };
  return { client, callCount: () => calls };
}


/** Build a real orchestrator over a mocked fetch so writes are observable + never real HTTP. */
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
    now: () => new Date('2026-06-02T00:00:00.000Z'),
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

// makeDeps is async because it imports the loop runner; wrap construction.
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
    newId: () => 'pending-fixed',
  };
  return { deps: d, appended };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Discovery-Review engine — immediate-apply + the deterministic backbone', () => {
  // 1 + 2 ---------------------------------------------------------------------
  it('a mocked LLM proposing an apply-decision APPLIES immediately, and the transcript counts come from the resolver, NOT the LLM', async () => {
    const model = buildModel();
    const { orchestrator, fetchCalls } = makeOrchestrator();
    const { deps: d } = await deps(orchestrator);

    // The LLM proposes approving c-iface AND lies about the count in a way the
    // transcript must ignore (the counts come from resolveBulkActionSet, not the
    // LLM). c-iface cascades to c-dep.
    const { client } = llmProposing({
      type: 'apply-decision',
      seedCandidateIds: ['c-iface'],
      findingIds: [],
      action: 'approved',
      bogusCount: 999, // the LLM cannot inject a count — proven below
    });

    const outcome = await answerTurn(
      { ...CTX(model), userMessage: 'approve the interface', llmClient: client },
      d,
    );

    // The disposition applied IMMEDIATELY (no pending-confirmation), and EXACTLY
    // ONE mutation fetch fired.
    expect(outcome.kind).toBe('applied');
    if (outcome.kind !== 'applied') throw new Error('expected applied');
    expect(outcome.advanced).toBe(true);
    expect(fetchCalls.length).toBe(1);

    // Deterministic counts on the preview turn: c-iface (seed) + c-dep (cascaded)
    // = 2 candidates; f-high is linked to c-iface = 1 finding. The LLM's 999 is
    // nowhere.
    expect(outcome.previewTurn).toEqual(
      expect.objectContaining({
        totalCandidates: 2,
        seedCandidates: 1,
        cascadedCandidates: 1,
        totalFindings: 1,
      }),
    );

    // The write carried the FULL touched set + linked finding — never the bogus 999.
    const body = fetchCalls[0].body as { candidate_ids: string[]; finding_ids: string[]; review_status: string };
    expect(new Set(body.candidate_ids)).toEqual(new Set(['c-iface', 'c-dep']));
    expect(body.finding_ids).toEqual(['f-high']);
    expect(body.review_status).toBe('approved');
  });

  // 3 ------------------------------------------------------------------------
  it('a deterministic apply fires EXACTLY ONE orchestrator write over the full touched set + findings, immediately (no confirm step)', async () => {
    const model = buildModel();
    const { orchestrator, fetchCalls } = makeOrchestrator();
    const { deps: d } = await deps(orchestrator);

    const applied = await captureDeterministicTurn(
      {
        ...CTX(model),
        action: {
          kind: 'propose-intent',
          intent: { kind: 'apply-decision', seedCandidateIds: ['c-iface'], findingIds: [], action: 'approved' },
          userText: 'approve it',
        },
      },
      d,
    );

    expect(applied.kind).toBe('applied');
    // EXACTLY ONE write, to the atomic bulk-review-cascade endpoint, carrying
    // the FULL touched set (seed c-iface + cascaded c-dep) + the linked finding.
    expect(fetchCalls.length).toBe(1);
    expect(fetchCalls[0].method).toBe('POST');
    expect(fetchCalls[0].url).toContain('/candidates/bulk-review-cascade');
    const body = fetchCalls[0].body as { candidate_ids: string[]; finding_ids: string[]; review_status: string };
    expect(new Set(body.candidate_ids)).toEqual(new Set(['c-iface', 'c-dep']));
    expect(body.finding_ids).toEqual(['f-high']);
    expect(body.review_status).toBe('approved');
  });

  // 4 ------------------------------------------------------------------------
  it('a REJECT proposed via the deterministic click path applies immediately (no LLM involved)', async () => {
    const model = buildModel();
    const { orchestrator, fetchCalls } = makeOrchestrator();
    const { deps: d } = await deps(orchestrator);

    const applied = await captureDeterministicTurn(
      {
        ...CTX(model),
        action: {
          kind: 'propose-intent',
          intent: { kind: 'apply-decision', seedCandidateIds: ['c-iface'], findingIds: [], action: 'rejected' },
          userText: 'reject this',
        },
      },
      d,
    );
    expect(applied.kind).toBe('applied');
    expect(fetchCalls.length).toBe(1);
    expect((fetchCalls[0].body as { review_status: string }).review_status).toBe('rejected');
  });

  // 4b -----------------------------------------------------------------------
  it('apply-decision-by-type APPROVES every still-actionable candidate of the (type, scan) in ONE write — the "Approve all N" control', async () => {
    // 4 business_logics orphans in the code run: 2 actionable, 1 already approved,
    // 1 committed. The type-level bulk must touch ONLY the 2 actionable ones.
    const typeModel: FullReviewModelWire = {
      scan_selection: [{ run_id: CODE_RUN, scan_kind: 'code' }],
      nodes: [
        node({ id: 'bl-1', candidate_type: 'business_logics', name: 'createView' }),
        node({ id: 'bl-2', candidate_type: 'business_logics', name: 'deleteFilter' }),
        node({ id: 'bl-approved', candidate_type: 'business_logics', name: 'old', review_status: 'approved' }),
        node({ id: 'bl-committed', candidate_type: 'business_logics', name: 'frozen', committed: true }),
        // A different type — must be untouched.
        node({ id: 'svc-x', candidate_type: 'service', name: 'OrderService' }),
      ],
      edges: [],
      findings: [],
      blast_radius: [],
      aggregations: { total_candidates: 5, total_findings: 0 },
    };
    const { orchestrator, fetchCalls } = makeOrchestrator();
    const { deps: d } = await deps(orchestrator);

    const applied = await captureDeterministicTurn(
      {
        ...CTX(typeModel),
        action: {
          kind: 'propose-intent',
          intent: {
            kind: 'apply-decision-by-type',
            candidateType: 'business_logics',
            scanScope: 'code',
            action: 'approved',
          },
          userText: 'approve all business_logics',
        },
      },
      d,
    );

    expect(applied.kind).toBe('applied');
    if (applied.kind !== 'applied') throw new Error('expected applied');
    // The preview reports the 2 actionable as seeds, NO cascade.
    expect(applied.previewTurn).toEqual(
      expect.objectContaining({ totalCandidates: 2, seedCandidates: 2, cascadedCandidates: 0 }),
    );
    // EXACTLY ONE write (all in the code run), carrying ONLY the 2 actionable ids —
    // the already-approved + committed + different-type nodes are excluded.
    expect(fetchCalls.length).toBe(1);
    const body = fetchCalls[0].body as { candidate_ids: string[]; review_status: string };
    expect(new Set(body.candidate_ids)).toEqual(new Set(['bl-1', 'bl-2']));
    expect(body.review_status).toBe('approved');
  });

  // 4c -----------------------------------------------------------------------
  it('apply-decision-findings APPROVES every still-actionable finding of the scan in ONE write (findings/bulk-review), excluding decided ones', async () => {
    const findingsModel: FullReviewModelWire = {
      scan_selection: [{ run_id: CODE_RUN, scan_kind: 'code' }],
      nodes: [],
      edges: [],
      findings: [
        { id: 'f-1', review_status: 'pending_review', severity: 'high', category: 'data', finding_type: 'risky_dependency', candidate_link_ids: [], run_id: CODE_RUN, scan_kind: 'code' },
        { id: 'f-2', review_status: 'pending_review', severity: 'medium', category: 'data', finding_type: 'risky_dependency', candidate_link_ids: [], run_id: CODE_RUN, scan_kind: 'code' },
        { id: 'f-done', review_status: 'approved', severity: 'high', category: 'data', finding_type: 'risky_dependency', candidate_link_ids: [], run_id: CODE_RUN, scan_kind: 'code' },
      ],
      blast_radius: [],
      aggregations: { total_candidates: 0, total_findings: 3 },
    };
    const { orchestrator, fetchCalls } = makeOrchestrator();
    const { deps: d } = await deps(orchestrator);

    const applied = await captureDeterministicTurn(
      {
        ...CTX(findingsModel),
        action: {
          kind: 'propose-intent',
          intent: { kind: 'apply-decision-findings', scanScope: 'code', action: 'approved' },
          userText: 'approve all findings',
        },
      },
      d,
    );

    expect(applied.kind).toBe('applied');
    if (applied.kind !== 'applied') throw new Error('expected applied');
    expect(applied.previewTurn).toEqual(
      expect.objectContaining({ totalCandidates: 0, totalFindings: 2 }),
    );
    // EXACTLY ONE write, to the findings bulk-review endpoint, carrying ONLY the 2
    // actionable findings (the already-approved f-done is excluded).
    expect(fetchCalls.length).toBe(1);
    expect(fetchCalls[0].url).toContain('/findings/bulk-review');
    const body = fetchCalls[0].body as { ids: string[]; review_status: string };
    expect(new Set(body.ids)).toEqual(new Set(['f-1', 'f-2']));
    expect(body.review_status).toBe('approved');
  });

  // 5 ------------------------------------------------------------------------
  it('a "no" / changed-intent cancels with NO write (the confirmPending cancel path, now used by the terminal Save)', async () => {
    const model = buildModel();
    const { orchestrator, fetchCalls } = makeOrchestrator();
    const { deps: d } = await deps(orchestrator);

    const cancelled = await confirmPending(
      {
        projectId: PROJECT,
        architectureId: ARCH,
        runId: CODE_RUN,
        pendingId: 'pending-fixed',
        intent: { kind: 'save' },
        confirmation: { kind: 'natural-language', text: 'actually no, leave it' },
        model,
      },
      d,
    );
    expect(cancelled.kind).toBe('cancelled');
    expect(fetchCalls.length).toBe(0);
  });

  // 6 ------------------------------------------------------------------------
  it('read-only tools are callable and never write (pure reads over the model snapshot)', () => {
    const model = buildModel();

    const scans = selectScans({ ...SCAN_PAIR, model });
    expect(scans.resolved_scan_selection).toHaveLength(2);

    const chunk = getReviewChunk(model, 0).chunk;
    expect(chunk.items.length).toBeGreaterThan(0);

    const prev = preview(['c-iface'], 'approved', model);
    expect(prev.counts.total_candidates).toBe(2); // c-iface + cascaded c-dep

    const conflicts = getConflictSet('c-conflict', model);
    expect(conflicts.live_conflict_attrs).toEqual(['framework']);

    const sim = getSimilarConflicts('c-conflict', 'framework', model);
    expect(sim.member_count).toBe(2); // c-conflict + d-conflict (same source-set)
    // None of these touched a network — they are pure functions of the model.
  });

  // 7 ------------------------------------------------------------------------
  it('the agenda walks the ARCHITECTURAL order (interfaces → logical → physical → cross-scan → business-logic → findings), excludes services, conflicts inline', () => {
    const model = buildModel();
    const agenda = buildAgenda(model);
    const sections = agenda.map((a) => a.section);

    // The user-defined `service` (c-conflict) is EXCLUDED from the conversation
    // agenda (defined pre-scan), so its conflict never reaches the walk.
    expect(agenda.some((a) => a.ref.id === 'c-conflict')).toBe(false);

    // Architectural section order: interfaces-endpoints → logical-data →
    // physical-data → cross-scan-links → (business-logic) → findings.
    const firstIface = sections.indexOf('interfaces-endpoints');
    const firstLogical = sections.indexOf('logical-data');
    const firstPhysical = sections.indexOf('physical-data');
    const firstCrossScan = sections.indexOf('cross-scan-links');
    const firstFindings = sections.indexOf('findings-by-severity');
    expect(firstIface).toBe(0); // interfaces & endpoints come FIRST
    expect(firstLogical).toBeGreaterThan(firstIface);
    expect(firstPhysical).toBeGreaterThan(firstLogical);
    expect(firstCrossScan).toBeGreaterThan(firstPhysical); // mapping AFTER physical
    expect(firstFindings).toBeGreaterThan(firstCrossScan); // findings LAST
    expect(agenda[agenda.length - 1].section).toBe('findings-by-severity');

    // The conflicted DB entity (d-conflict) appears INLINE in physical-data — NOT
    // hoisted into a conflicts-first band (which no longer exists).
    expect(agenda.find((a) => a.ref.id === 'd-conflict')?.section).toBe('physical-data');

    // Findings follow the table's severity → category order (high before low).
    const findingItems = agenda.filter((a) => a.ref.itemType === 'finding');
    expect(findingItems.map((f) => f.ref.id)).toEqual(['f-high', 'f-low']);

    // Chunk size is bounded and never the firehose.
    const chunk = getReviewChunk(model, 0, 15).chunk;
    expect(chunk.items.length).toBeLessThanOrEqual(15);
    expect(chunk.agendaTotal).toBe(agenda.length);
  });

  // 8 ------------------------------------------------------------------------
  it('bulk-resolve-by-pattern: a class of ≥2 APPLIES immediately (one same-source resolve per member) + refreshes in place; a class of 1 errors and does NOT apply', async () => {
    const model = buildModel();

    // (a) class of 2 (c-conflict + d-conflict on `framework`, same source-set).
    {
      const { orchestrator, fetchCalls } = makeOrchestrator();
      const { deps: d } = await deps(orchestrator);

      const applied = await captureDeterministicTurn(
        {
          ...CTX(model),
          action: {
            kind: 'propose-intent',
            intent: {
              kind: 'resolve-conflicts-by-pattern',
              candidateId: 'c-conflict',
              attr: 'framework',
              chosenSource: 'src-jaxrs',
              classCandidateIds: [],
            },
          },
        },
        d,
      );
      // It applied IMMEDIATELY (no pending-confirmation) and did NOT advance — a
      // conflict re-renders the SAME chunk in place (Q4).
      expect(applied.kind).toBe('applied');
      if (applied.kind !== 'applied') throw new Error('expected applied');
      expect(applied.advanced).toBe(false);
      expect(applied.appliedTurn.kind).toBe('bulk-pattern-resolved');

      // ONE resolve-conflict PATCH per member, each to its OWN value from src-jaxrs
      // (never a shared literal).
      expect(fetchCalls.length).toBe(2); // one PATCH per class member
      const patchedValues = fetchCalls.map((c) => (c.body as { chosen_value: unknown }).chosen_value);
      // c-conflict's JAX-RS value vs d-conflict's JAX-RS-db value — NOT identical.
      expect(new Set(patchedValues)).toEqual(new Set(['JAX-RS', 'JAX-RS-db']));
      for (const c of fetchCalls) {
        expect(c.method).toBe('PATCH');
        expect(c.url).toContain('/resolve-conflict');
        expect((c.body as { chosen_source: string }).chosen_source).toBe('src-jaxrs');
      }

      // Spec 2026-06-08 (Bug 1): each member is written to its OWN run, NOT the
      // scan-set's primary run (CODE_RUN) — else AMS rejects the cross-run write
      // with "Candidate X does not belong to run Y" (HTTP 400). c-conflict ∈
      // CODE_RUN, d-conflict ∈ DB_RUN. (Before the fix, d-conflict PATCHed to
      // CODE_RUN, which a mocked fetch would 200 but real AMS would 400.)
      const cConflictCall = fetchCalls.find((c) => c.url.includes('/candidates/c-conflict/'));
      const dConflictCall = fetchCalls.find((c) => c.url.includes('/candidates/d-conflict/'));
      expect(cConflictCall?.url).toContain(
        `/discovery/runs/${CODE_RUN}/candidates/c-conflict/resolve-conflict`,
      );
      expect(dConflictCall?.url).toContain(
        `/discovery/runs/${DB_RUN}/candidates/d-conflict/resolve-conflict`,
      );
    }

    // (b) class of 1: clone the model with ONLY c-conflict having the conflict.
    {
      const soloModel = buildModel();
      // Remove d-conflict's live conflict so the class collapses to size 1.
      const dNode = soloModel.nodes.find((n) => n.id === 'd-conflict')!;
      dNode.conflict_state = {
        has_live_conflict: false,
        live_conflict_attrs: [],
        conflicts: null,
        conflict_resolutions: null,
      };

      const { orchestrator, fetchCalls } = makeOrchestrator();
      const { deps: d } = await deps(orchestrator);
      const outcome = await captureDeterministicTurn(
        {
          ...CTX(soloModel),
          action: {
            kind: 'propose-intent',
            intent: {
              kind: 'resolve-conflicts-by-pattern',
              candidateId: 'c-conflict',
              attr: 'framework',
              chosenSource: 'src-jaxrs',
              classCandidateIds: [],
            },
          },
        },
        d,
      );
      // The bulk prompt is NOT applied for a class of 1 — it errors back asking
      // to resolve singly, and NO write fires.
      expect(outcome.kind).toBe('error');
      expect(fetchCalls.length).toBe(0);
      if (outcome.kind === 'error') {
        expect(outcome.errorTurn.errorMessage).toContain('only 1 member');
      }
    }
  });

  it('apply-decision: a cascade spanning runs applies ONE bulk-review-cascade PER run, each to its OWN run URL (Bug 1 — no silent cross-run under-apply)', async () => {
    const { orchestrator, fetchCalls } = makeOrchestrator();
    // Two candidates in DIFFERENT runs of the scan set; the scan-set primary is CODE_RUN.
    const outcome = await orchestrator.applyDecision({
      projectId: PROJECT,
      architectureId: ARCH,
      runId: CODE_RUN, // scan-set primary
      candidateIds: ['c-code', 'c-db'],
      findingIds: [],
      action: 'approved',
      runIdByCandidateId: { 'c-code': CODE_RUN, 'c-db': DB_RUN },
      runIdByFindingId: {},
    });

    expect(outcome.kind).toBe('applied');

    // One POST per run — NOT a single primary-run call that silently skips c-db.
    const cascadeCalls = fetchCalls.filter((c) => c.url.includes('/bulk-review-cascade'));
    expect(cascadeCalls.length).toBe(2);

    const codeCall = cascadeCalls.find((c) => c.url.includes(`/runs/${CODE_RUN}/`));
    const dbCall = cascadeCalls.find((c) => c.url.includes(`/runs/${DB_RUN}/`));
    expect(codeCall).toBeDefined();
    expect(dbCall).toBeDefined();
    // Each run's POST carries ONLY that run's candidate (correct run-scoping).
    expect((codeCall!.body as { candidate_ids: string[] }).candidate_ids).toEqual(['c-code']);
    expect((dbCall!.body as { candidate_ids: string[] }).candidate_ids).toEqual(['c-db']);

    // The applied count SUMS across the per-run applies (1 + 1 from the mocked fetch).
    if (outcome.kind === 'applied') {
      expect(outcome.turn.appliedCandidateCount).toBe(2);
    }
  });

  it('save: a multi-run scan set saves EVERY run (Bug 2 — no primary-only under-save)', async () => {
    const { orchestrator, fetchCalls } = makeOrchestrator();
    const outcome = await orchestrator.save({
      projectId: PROJECT,
      architectureId: ARCH,
      runId: CODE_RUN, // scan-set primary
      runIds: [CODE_RUN, DB_RUN],
    });

    expect(outcome.kind).toBe('applied');
    // One MCP save_approved_candidates call PER run — not a single primary-run save.
    const saveCalls = fetchCalls.filter((c) => c.url.includes('/save_approved_candidates'));
    expect(saveCalls.length).toBe(2);
    const savedRunIds = saveCalls.map((c) => (c.body as { runId: string }).runId);
    expect(savedRunIds).toContain(CODE_RUN);
    expect(savedRunIds).toContain(DB_RUN);
  });

  it('save: a single-run save (no runIds) saves ONLY the primary run (back-compat)', async () => {
    const { orchestrator, fetchCalls } = makeOrchestrator();
    const outcome = await orchestrator.save({
      projectId: PROJECT,
      architectureId: ARCH,
      runId: CODE_RUN,
    });

    expect(outcome.kind).toBe('applied');
    const saveCalls = fetchCalls.filter((c) => c.url.includes('/save_approved_candidates'));
    expect(saveCalls.length).toBe(1);
    expect((saveCalls[0].body as { runId: string }).runId).toBe(CODE_RUN);
  });
});
