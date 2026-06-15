/**
 * Tests — Discovery-Review field-defect fixes (direct fix to committed Spec 3).
 *
 * Two defects, each pinned here:
 *
 *   D1 — Raw JSON leaked into the chat. The coordinator's narration coercion fell
 *        through to `JSON.stringify(value)` whenever the LLM submitted a terminal
 *        value that was NOT a valid mutation intent (an empty-ids apply-decision,
 *        or a hallucinated `type` like `request-guidance`). It now:
 *          - routes the new `{type:'clarify', message}` answer to a `narrated`
 *            outcome whose text IS the message, and
 *          - routes ANY other junk/empty value to a `narrated` outcome whose text
 *            is the fixed friendly prose fallback — and NEVER a raw-JSON dump
 *            (no `{"type"` marker can reach a narration turn).
 *
 *   D2 — Live-conflict chunk items carry the deterministic conflict facts the
 *        always-actionable frontend renders its source-pick controls from. The
 *        agenda sequencer now populates `ref.conflicts` for live-conflict-section
 *        items (per-attr competing `{value,source}` + the `getSimilarConflicts`
 *        similarity-class size) — sourced from `conflict_state` + the PURE Spec 0
 *        read, never recomputed.
 *
 * All LLM calls are mocked at the `ArchitectLlmClient` boundary (the chassis test
 * pattern); the thread store is stubbed via the coordinator deps so no real I/O
 * fires. The orchestrator is NEVER invoked here (no confirm) so no write path is
 * exercised — these prove the PROPOSE/narrate boundary only.
 */

import type {
  ArchitectLlmClient,
  CallLlmToolLoopArgs,
  CallLlmToolLoopResponse,
} from '../../architectConversation/architectLlmClient';
import { SUBMIT_ANSWER_TOOL_NAME } from '../../architectConversation/llmLoopRunner';
import {
  answerTurn,
  narrationFrom,
  parseProposedIntent,
  type ReviewCoordinatorDeps,
} from '../reviewConversationCoordinator';
import {
  ReviewDecisionOrchestrator,
  type ReviewOrchestratorDeps,
} from '../reviewDecisionOrchestrator';
import { buildAgenda } from '../agendaSequencer';
import type { FullReviewModelWire, ReviewModelNode } from '../reviewModelFull';
import type { NarrationTurn, SelectedScanSet } from '../reviewTurnShape';

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
 * Two live-conflict candidates sharing the SAME `framework` competing source-set
 * (so the similarity class is 2), plus one plain candidate (no conflict).
 */
function buildModel(): FullReviewModelWire {
  const nodes: ReviewModelNode[] = [
    node({
      id: 'c-conflict',
      candidate_type: 'logical_data_entity',
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
    node({
      id: 'd-conflict',
      candidate_type: 'logical_data_entity',
      scan_kind: 'code',
      run_id: CODE_RUN,
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
    node({ id: 'c-plain', candidate_type: 'endpoint', scan_kind: 'code', run_id: CODE_RUN }),
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
    aggregations: { total_candidates: 3, total_findings: 0 },
  };
}

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

/** An LLM whose single round returns the given terminal submit_structured_answer value. */
function llmProposing(value: unknown): ArchitectLlmClient {
  return {
    async callLlmToolLoop(_args: CallLlmToolLoopArgs): Promise<CallLlmToolLoopResponse> {
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
}

/** A real orchestrator over a mocked fetch — used ONLY to assert NO write fires. */
function makeOrchestrator(): {
  orchestrator: ReviewDecisionOrchestrator;
  fetchCalls: Array<{ url: string; method: string }>;
} {
  const fetchCalls: Array<{ url: string; method: string }> = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    fetchCalls.push({ url, method: (init?.method as string) ?? 'GET' });
    return {
      ok: true,
      status: 200,
      json: async () => ({ updated_count: 1 }),
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

async function deps(orchestrator: ReviewDecisionOrchestrator): Promise<{
  deps: ReviewCoordinatorDeps;
  appended: unknown[];
}> {
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
// D1 — the JSON leak is dead; clarify + junk both narrate as prose
// ---------------------------------------------------------------------------

describe('Discovery-Review defect 1 — no raw JSON can reach a narration turn', () => {
  it('a {type:"clarify", message} answer → a narrated outcome whose narration text IS the message (not JSON)', async () => {
    const model = buildModel();
    const { orchestrator, fetchCalls } = makeOrchestrator();
    const { deps: d } = await deps(orchestrator);

    const clarifyMessage =
      'Which interface do you mean — there are two named OrderService in this chunk?';
    const client = llmProposing({ type: 'clarify', message: clarifyMessage });

    const outcome = await answerTurn(
      { ...CTX(model), userMessage: 'reject the orphaned one', llmClient: client },
      d,
    );

    expect(outcome.kind).toBe('narrated');
    if (outcome.kind !== 'narrated') throw new Error('expected narrated');
    // The narration text is EXACTLY the clarify message — never the JSON object.
    expect(outcome.narrationTurn.text).toBe(clarifyMessage);
    expect(outcome.narrationTurn.text).not.toContain('{"type"');
    expect(outcome.narrationTurn.text).not.toContain('clarify');
    // It is a plain narration — NOT a pending-confirmation (no write proposed).
    expect(outcome.chunkTurn).toBeNull();
    // The clarify is NOT a mutation intent (so it can never become a write).
    expect(parseProposedIntent({ type: 'clarify', message: clarifyMessage })).toBeNull();
    expect(fetchCalls.length).toBe(0);
  });

  it('a hallucinated intent type ({type:"request-guidance"}) → a narrated FALLBACK, never a raw-JSON dump', async () => {
    const model = buildModel();
    const { orchestrator, fetchCalls } = makeOrchestrator();
    const { deps: d } = await deps(orchestrator);

    const client = llmProposing({ type: 'request-guidance', foo: { bar: 1 } });
    const outcome = await answerTurn(
      { ...CTX(model), userMessage: 'help', llmClient: client },
      d,
    );

    expect(outcome.kind).toBe('narrated');
    if (outcome.kind !== 'narrated') throw new Error('expected narrated');
    // Friendly prose fallback — and CRUCIALLY no raw-JSON marker.
    expect(outcome.narrationTurn.text).not.toContain('{"type"');
    expect(outcome.narrationTurn.text).not.toContain('request-guidance');
    expect(outcome.narrationTurn.text).toContain('act on any item in the list below');
    expect(fetchCalls.length).toBe(0);
  });

  it('an empty-ids apply-decision (parses to null) → a narrated FALLBACK, never a raw-JSON dump or a pending gate', async () => {
    const model = buildModel();
    const { orchestrator, fetchCalls } = makeOrchestrator();
    const { deps: d } = await deps(orchestrator);

    // The empty-ids apply-decision is the exact junk the LLM was pushed into
    // emitting. parseProposedIntent rejects it (→ null → narration).
    const junk = { type: 'apply-decision', seedCandidateIds: [], findingIds: [], action: 'approved' };
    expect(parseProposedIntent(junk)).toBeNull();

    const client = llmProposing(junk);
    const outcome = await answerTurn(
      { ...CTX(model), userMessage: 'approve those', llmClient: client },
      d,
    );

    expect(outcome.kind).toBe('narrated');
    if (outcome.kind !== 'narrated') throw new Error('expected narrated');
    expect(outcome.narrationTurn.text).not.toContain('{"type"');
    expect(outcome.narrationTurn.text).not.toContain('apply-decision');
    expect(outcome.narrationTurn.text).toContain('Approve, Reject, Defer');
    // No write, no pending gate — purely narration.
    expect(fetchCalls.length).toBe(0);
  });

  it('narrationFrom unit contract: string→string, clarify→message, narration/message/text→that, junk→fallback (never JSON)', () => {
    expect(narrationFrom('hello there')).toBe('hello there');
    expect(narrationFrom({ type: 'clarify', message: 'which one?' })).toBe('which one?');
    expect(narrationFrom({ narration: 'narr' })).toBe('narr');
    expect(narrationFrom({ message: 'msg' })).toBe('msg');
    expect(narrationFrom({ text: 'txt' })).toBe('txt');

    // Junk shapes: a hallucinated type, a clarify with no message, a bare object,
    // null, a number — all return the fallback prose and NONE return JSON.
    for (const junk of [
      { type: 'request-guidance' },
      { type: 'clarify' },
      { type: 'apply-decision', seedCandidateIds: [] },
      {},
      null,
      42,
    ]) {
      const out = narrationFrom(junk);
      expect(out).not.toContain('{');
      expect(out).not.toContain('"type"');
      expect(out).toContain('act on any item in the list below');
    }
  });
});

// ---------------------------------------------------------------------------
// D2 — live-conflict chunk items carry deterministic conflict facts
// ---------------------------------------------------------------------------

describe('Discovery-Review defect 2 — live-conflict chunk items carry conflict facts', () => {
  it("a live-conflict node's agenda item carries conflicts (attr + competing {value,source} + similarCount) from conflict_state + getSimilarConflicts", () => {
    const model = buildModel();
    const agenda = buildAgenda(model);

    // The live-conflict candidate appears INLINE at its architectural section
    // (logical-data), carrying its conflict facts — no conflicts-first band.
    const cItem = agenda.find((a) => a.ref.id === 'c-conflict');
    expect(cItem).toBeDefined();
    expect(cItem!.section).toBe('logical-data');

    const conflicts = cItem!.ref.conflicts;
    expect(conflicts).toBeDefined();
    expect(conflicts).toHaveLength(1);
    const fact = conflicts![0];
    expect(fact.attr).toBe('framework');
    // The competing values come straight from conflict_state.conflicts[attr].
    expect(fact.competing).toEqual([
      { value: 'JAX-RS', source: 'src-jaxrs' },
      { value: 'Spring MVC', source: 'src-spring' },
    ]);
    // The similarity class is c-conflict + d-conflict (same attr + source-set) = 2,
    // which is the >= 2 threshold that enables the frontend's "resolve all" offer.
    expect(fact.similarCount).toBe(2);
  });

  it('a non-conflict candidate item carries NO conflicts field (the controls render only for live conflicts)', () => {
    const model = buildModel();
    const agenda = buildAgenda(model);
    const plain = agenda.find((a) => a.ref.id === 'c-plain');
    expect(plain).toBeDefined();
    expect(plain!.ref.conflicts).toBeUndefined();
  });

  it('falls back to the unresolved attrs (conflicts minus conflict_resolutions) when live_conflict_attrs is absent', () => {
    const model = buildModel();
    const cNode = model.nodes.find((n) => n.id === 'c-conflict')!;
    // Simulate a model where the precomputed live_conflict_attrs is empty but the
    // raw conflicts map is present and unresolved — the sequencer must still emit
    // the fact by deriving live = conflicts keys with no resolution entry.
    cNode.conflict_state = {
      has_live_conflict: true,
      live_conflict_attrs: [],
      conflicts: {
        framework: [
          { value: 'JAX-RS', source: 'src-jaxrs' },
          { value: 'Spring MVC', source: 'src-spring' },
        ],
      },
      conflict_resolutions: null,
    };

    const agenda = buildAgenda(model);
    const cItem = agenda.find((a) => a.ref.id === 'c-conflict');
    expect(cItem!.ref.conflicts).toBeDefined();
    expect(cItem!.ref.conflicts).toHaveLength(1);
    expect(cItem!.ref.conflicts![0].attr).toBe('framework');
  });
});
