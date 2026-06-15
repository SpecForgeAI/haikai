/**
 * Tests — Discovery-Review Conversation HTTP routes, END-TO-END through the real
 * Express router (Spec 3 — capstone, Task Group 5.3 cross-stack seams).
 *
 * Spec: 2026-06-02-conversational-discovery-review-architect
 *       + 2026-06-05-review-room-agenda-redesign (Task Group 3: the `/capture`
 *         confirm-skip seam — a fully-visible apply returns an `applied` outcome
 *         over HTTP rather than a `pending-confirmation`).
 *
 * WHY THIS FILE EXISTS (the 5.2 gap analysis). Groups 1-4 prove the pieces in
 * isolation: the AMS service stamps camelCase (`DiscoveryCandidateResolveConflictTest`),
 * the gateway proxy forwards snake_case + passes the AMS camelCase response
 * through (`discovery-resolve-conflict-proxy.test.ts`), the coordinator opens the
 * confirmation gate and the orchestrator is the sole writer (`reviewEngine.test.ts`),
 * and the room renders the deterministic counts (`DiscoveryReviewRoom.test.tsx`).
 * But the ROUTE layer (Group 3.4 — `discoveryReviewConversationRouter`) had ZERO
 * tests: nothing exercised the actual HTTP boundary the frontend `discoveryReviewApi`
 * client calls, where request intent-parsing meets the coordinator/orchestrator and
 * the real AMS write body is built. These five tests close the genuine cross-stack
 * seams the spec's Test Plan prioritises:
 *
 *   1. resolve-conflict END-TO-END camelCase seam — `/confirm` with a SINGLE
 *      `resolve-conflict` intent issues EXACTLY ONE PATCH to `.../resolve-conflict`
 *      carrying the snake_case body (`chosen_value`/`chosen_source`/`resolved_by`/
 *      `resolved_at`); AMS's camelCase `data._conflictResolutions` response surfaces
 *      a `conflict-resolved` applied turn. (The single resolveConflict orchestrator
 *      body is asserted NOWHERE else — only the bulk-pattern path's `chosen_value`
 *      is checked in reviewEngine test 8.) snake_case at the wire stops at the
 *      request boundary; camelCase lives inside `data` — the exact place a mistake
 *      would silently break the grid + the conversation conflict reader.
 *   2. THE oracle gate at the HTTP boundary — `/answer` with a mocked LLM proposing
 *      an apply-decision that ESCAPES its family returns a `pending-confirmation`
 *      outcome carrying the DETERMINISTIC counts, and NO mutation fetch fires.
 *   3. the ONLY write path end-to-end — `/answer` (propose) -> `/confirm` (click)
 *      issues EXACTLY ONE POST to `bulk-review-cascade` whose snake_case body
 *      carries the FULL deterministic touched set (seed + cascaded), proving the
 *      route forwards the coordinator's `_fullCandidateIds` (a seam no route test
 *      exercised).
 *   4. the gate's negative path over HTTP — `/confirm` with an NL "no" cancels with
 *      NO write.
 *   5. CASCADE-AWARE confirm-skip over HTTP — `/capture` propose-intent (the NO-LLM
 *      path) of a single FULLY-VISIBLE row applies immediately, returning an
 *      `applied` outcome (NOT `pending-confirmation`) and firing exactly one
 *      `bulk-review-cascade` write (the click is the confirmation; Task Group 3).
 *
 * SEAM DISCIPLINE: the review MODEL fetch is stubbed via the route dep
 * `fetchReviewModel` (no discovery-service network); the LLM is mocked at the
 * `ArchitectLlmClient` boundary via the route dep `llmClient`; the orchestrator's
 * AMS writes are observed by stubbing `global.fetch` (the same seam the chassis
 * writer uses). The thread store is stubbed via the coordinator deps so NO real
 * thread I/O fires. NOTHING here hits a real network or disk.
 */

import request from 'supertest';
import express from 'express';

import {
  discoveryReviewConversationRouter,
  setDiscoveryReviewConversationDeps,
  resetDiscoveryReviewConversationDeps,
  parseScanPair,
  additionalRunIdsOf,
} from '../routes/discoveryReviewConversation';
import { defaultReviewCoordinatorDeps } from '../services/discoveryReviewConversation/reviewConversationCoordinator';
import { ReviewDecisionOrchestrator } from '../services/discoveryReviewConversation/reviewDecisionOrchestrator';
import { SUBMIT_ANSWER_TOOL_NAME } from '../services/architectConversation/llmLoopRunner';
import type {
  ArchitectLlmClient,
  CallLlmToolLoopArgs,
  CallLlmToolLoopResponse,
} from '../services/architectConversation/architectLlmClient';
import type {
  FullReviewModelWire,
  ReviewModelNode,
} from '../services/discoveryReviewConversation/reviewModelFull';

jest.mock('../services/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// ---------------------------------------------------------------------------
// Fixtures — a small review model with a live conflict + a high-blast-radius
// interface that cascades onto a dependent (so the touched set != the seed).
// ---------------------------------------------------------------------------

const PROJECT_ID = '550e8400-e29b-41d4-a716-446655440000';
const ARCH_ID = 'arch-test-default';
const CODE_RUN = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const AMS_BASE = 'http://localhost:8080';
const amsCandidates =
  `${AMS_BASE}/api/model/projects/${PROJECT_ID}/architectures/${ARCH_ID}` +
  `/discovery/runs/${CODE_RUN}/candidates`;

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

function buildModel(): FullReviewModelWire {
  const nodes: ReviewModelNode[] = [
    // A live conflict on `framework` (JAX-RS vs Spring MVC) — single-resolve target.
    node({
      id: 'c-conflict',
      candidate_type: 'service',
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
    // A high-blast-radius interface that cascades onto c-dep.
    node({ id: 'c-iface', candidate_type: 'interface' }),
    node({ id: 'c-dep', candidate_type: 'endpoint' }),
  ];
  return {
    scan_selection: [{ run_id: CODE_RUN, scan_kind: 'code' }],
    nodes,
    edges: [],
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
    ],
    aggregations: { total_candidates: 3, total_findings: 1 },
  };
}

/** A mocked LLM whose single round returns the given terminal submit value. */
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
              function: { name: SUBMIT_ANSWER_TOOL_NAME, arguments: JSON.stringify({ value }) },
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

const mockFetch = jest.fn();

/**
 * Wire the route deps for a test: a real coordinator (so the gate + orchestrator
 * run for real) over a real orchestrator whose AMS writes go through the mocked
 * `global.fetch`; the thread appends are stubbed; the review model is stubbed; the
 * LLM is the supplied mock. `fetchCalls` records every AMS/MCP write the
 * orchestrator issued so we can assert the exact body + URL + count.
 */
function wireDeps(llmClient: ArchitectLlmClient): { fetchCalls: Array<{ url: string; method: string; body: unknown }> } {
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
      json: async () => ({
        updated_candidate_count: 2,
        updated_finding_count: 1,
        updated_count: 2,
        // AMS stamps camelCase keys INSIDE data — echoed verbatim by the proxy/orchestrator.
        data: {
          framework: 'JAX-RS',
          _conflictResolutions: {
            framework: {
              chosenValue: 'JAX-RS',
              chosenSource: 'src-jaxrs',
              resolvedBy: 'architect-review-conversation',
              resolvedAt: '2026-06-02T00:00:00.000Z',
            },
          },
        },
      }),
      text: async () => '',
    } as unknown as Response;
  }) as unknown as typeof fetch;

  const orchestrator = new ReviewDecisionOrchestrator({
    fetchImpl,
    appendTurn: async () => {},
    now: () => new Date('2026-06-02T00:00:00.000Z'),
  });

  setDiscoveryReviewConversationDeps({
    coordinatorDeps: {
      ...defaultReviewCoordinatorDeps,
      orchestrator,
      appendTurn: async () => {},
      loadConversation: async () => ({ schemaVersion: 1, threadId: 't', turns: [] }),
      newId: () => 'pending-fixed',
    },
    loadConversation: async () => ({ schemaVersion: 1, threadId: 't', turns: [] }),
    llmClient,
    fetchReviewModel: async () => buildModel(),
  });

  return { fetchCalls };
}

const CONV_BASE =
  `/api/v1/discovery-review/projects/${PROJECT_ID}/architectures/${ARCH_ID}` +
  `/runs/${CODE_RUN}/review-conversation`;

describe('Discovery-Review Conversation Routes — cross-stack seams (Spec 3, Task Group 5.3)', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as { requestId?: string }).requestId = 'test-request-id';
      next();
    });
    app.use('/api/v1/discovery-review', discoveryReviewConversationRouter);
    mockFetch.mockReset();
    // global.fetch is unused by these tests (the orchestrator uses the injected
    // fetchImpl), but stub it so an accidental real call would be observable.
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    resetDiscoveryReviewConversationDeps();
  });

  // 1 — resolve-conflict END-TO-END camelCase seam ---------------------------
  it('POST /confirm with a single resolve-conflict intent issues ONE snake_case PATCH to /resolve-conflict and surfaces a conflict-resolved turn', async () => {
    const { fetchCalls } = wireDeps(llmProposing(null));

    const res = await request(app)
      .post(`${CONV_BASE}/confirm`)
      .send({
        pendingId: 'pending-fixed',
        intent: {
          kind: 'resolve-conflict',
          candidateId: 'c-conflict',
          attr: 'framework',
          chosenValue: 'JAX-RS',
          chosenSource: 'src-jaxrs',
        },
        confirmation: { kind: 'click' },
        scanPair: { runs: [{ runId: CODE_RUN, scanKind: 'code', serviceId: null }], primaryRunId: CODE_RUN },
      });

    expect(res.status).toBe(200);
    expect(res.body.kind).toBe('applied');
    // The applied turn is `conflict-resolved` (NOT decision-applied) and echoes
    // the chosen source the frontend reads.
    expect(res.body.appliedTurn.kind).toBe('conflict-resolved');
    expect(res.body.appliedTurn.attr).toBe('framework');
    expect(res.body.appliedTurn.chosenSource).toBe('src-jaxrs');

    // EXACTLY ONE write — a PATCH to the candidate's /resolve-conflict path.
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].method).toBe('PATCH');
    expect(fetchCalls[0].url).toBe(`${amsCandidates}/c-conflict/resolve-conflict`);

    // CRITICAL: the body keys are snake_case (the AMS wire). camelCase lives ONLY
    // inside `data._conflictResolutions` which AMS stamps — never on the request.
    const body = fetchCalls[0].body as Record<string, unknown>;
    expect(body).toMatchObject({
      attr: 'framework',
      chosen_value: 'JAX-RS',
      chosen_source: 'src-jaxrs',
      resolved_by: 'architect-review-conversation',
    });
    expect(typeof body.resolved_at).toBe('string');
    // No camelCase request keys leaked.
    expect(body).not.toHaveProperty('chosenValue');
    expect(body).not.toHaveProperty('chosenSource');
    expect(body).not.toHaveProperty('resolvedBy');
  });

  // 2 — immediate-apply at the HTTP boundary -------------------------------
  //     2026-06-06 redesign (`discovery-review-room-agenda-redesign-2`): the
  //     per-decision confirm gate is REMOVED — an apply-decision (whether a
  //     deterministic /capture button or an LLM /answer proposal) applies NOW.
  //     The gate survives ONLY for the terminal Save. The write set is still
  //     the deterministic resolver touched set; the LLM cannot inject it.
  it('POST /answer with a mocked LLM proposing apply-decision applies IMMEDIATELY (an applied outcome, NOT a confirm gate) and fires ONE bulk-review-cascade with the DETERMINISTIC touched set', async () => {
    const { fetchCalls } = wireDeps(
      llmProposing({
        type: 'apply-decision',
        seedCandidateIds: ['c-iface'],
        findingIds: [],
        action: 'approved',
        bogusCount: 999, // the LLM cannot inject a count — proven by the write set below
      }),
    );

    const res = await request(app)
      .post(`${CONV_BASE}/answer`)
      .send({
        userMessage: 'approve the interface',
        scanPair: { runs: [{ runId: CODE_RUN, scanKind: 'code', serviceId: null }], primaryRunId: CODE_RUN },
      });

    expect(res.status).toBe(200);
    // No gate any more — the proposal applies immediately.
    expect(res.body.kind).toBe('applied');
    // EXACTLY ONE write: the atomic bulk-review-cascade over the FULL deterministic
    // touched set (seed c-iface + cascaded c-dep, a node OUTSIDE its family) + the
    // linked finding f-high — snake_case body. The LLM's bogus 999 is nowhere.
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].method).toBe('POST');
    expect(fetchCalls[0].url).toBe(`${amsCandidates}/bulk-review-cascade`);
    const body = fetchCalls[0].body as {
      candidate_ids: string[];
      finding_ids: string[];
      review_status: string;
    };
    expect(new Set(body.candidate_ids)).toEqual(new Set(['c-iface', 'c-dep']));
    expect(body.finding_ids).toEqual(['f-high']);
    expect(body.review_status).toBe('approved');
  });

  // 3 — /confirm still cancels on a natural-language "no" --------------------
  //     (the /confirm endpoint survives for the terminal Save; a "no" is a
  //     no-op write. The old propose->confirm gate for apply-decision is gone,
  //     folded into the immediate-apply test above.)
  it('POST /confirm with a natural-language "no" cancels with NO write', async () => {
    const { fetchCalls } = wireDeps(llmProposing(null));

    const res = await request(app)
      .post(`${CONV_BASE}/confirm`)
      .send({
        pendingId: 'pending-fixed',
        intent: { kind: 'apply-decision', seedCandidateIds: ['c-iface'], findingIds: [], action: 'approved' },
        confirmation: { kind: 'natural-language', text: 'actually no, leave it' },
        scanPair: { runs: [{ runId: CODE_RUN, scanKind: 'code', serviceId: null }], primaryRunId: CODE_RUN },
      });

    expect(res.status).toBe(200);
    expect(res.body.kind).toBe('cancelled');
    expect(fetchCalls).toHaveLength(0);
  });

  // 5 — CASCADE-AWARE confirm-skip over HTTP (the NO-LLM /capture path) --------
  it('POST /capture propose-intent of a single FULLY-VISIBLE row applies immediately (an applied outcome, NOT pending-confirmation) and fires ONE bulk-review-cascade', async () => {
    const { fetchCalls } = wireDeps(llmProposing(null));

    const res = await request(app)
      .post(`${CONV_BASE}/capture`)
      .send({
        action: 'propose-intent',
        // c-conflict is a single non-cascading row (no parent_child children, no
        // cascade) → fully visible → the gate is SKIPPED and the apply fires now.
        intent: { kind: 'apply-decision', seedCandidateIds: ['c-conflict'], findingIds: [], action: 'rejected' },
        userText: 'reject this one',
        scanPair: { runs: [{ runId: CODE_RUN, scanKind: 'code', serviceId: null }], primaryRunId: CODE_RUN },
      });

    expect(res.status).toBe(200);
    // The cascade-aware gate SKIPS for a fully-visible row — the click is the
    // confirmation, so the route returns an `applied` outcome over HTTP (Task
    // Group 3), NOT a pending-confirmation, and the apply fired exactly once.
    expect(res.body.kind).toBe('applied');
    expect(res.body.appliedTurn.kind).toBe('decision-applied');
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].method).toBe('POST');
    expect(fetchCalls[0].url).toBe(`${amsCandidates}/bulk-review-cascade`);
    const body = fetchCalls[0].body as { candidate_ids: string[]; review_status: string };
    expect(body.candidate_ids).toEqual(['c-conflict']);
    expect(body.review_status).toBe('rejected');
  });
});
// ---------------------------------------------------------------------------
// Per-service scan selection (`2026-06-05-per-service-scan-selection`, Task Group
// 2): `parseScanPair` produces the N-run `SelectedScanSet` and the conversation
// routes forward the FULL additional-run-id set (every run beyond the primary)
// to the discovery-service review-model fetch, keeping `primaryRunId` as the
// `:runId` path anchor.
// ---------------------------------------------------------------------------

describe('Per-service scan selection — N-run gateway plumbing (Task Group 2)', () => {
  const UI_RUN = 'run-ui-0001';
  const API_RUN = 'run-api-0001';
  const DB_RUN = 'run-db-0001';

  it('parseScanPair parses a 3-run SelectedScanSet (2 code + 1 DB) and preserves primaryRunId', () => {
    const set = parseScanPair(
      {
        scanPair: {
          runs: [
            { runId: UI_RUN, scanKind: 'code', serviceId: 'svc-ui' },
            { runId: API_RUN, scanKind: 'code', serviceId: 'svc-api' },
            { runId: DB_RUN, scanKind: 'database', serviceId: 'svc-db' },
          ],
          primaryRunId: API_RUN,
        },
      },
      API_RUN, // the :runId path anchor
    );

    expect(set.primaryRunId).toBe(API_RUN);
    expect(set.runs).toHaveLength(3);
    expect(set.runs.filter((r) => r.scanKind === 'code')).toHaveLength(2);
    expect(set.runs.filter((r) => r.scanKind === 'database')).toHaveLength(1);
    // primaryRunId is the thread anchor and appears among the selected runs.
    expect(set.runs.map((r) => r.runId)).toContain(API_RUN);
    // The additional-run-id set is every run beyond the primary (order preserved).
    expect(additionalRunIdsOf(set)).toEqual([UI_RUN, DB_RUN]);
  });

  it('parseScanPair back-fills the primary run when the body omits it (anchor always present)', () => {
    const set = parseScanPair(
      { scanPair: { runs: [{ runId: DB_RUN, scanKind: 'database', serviceId: null }], primaryRunId: API_RUN } },
      API_RUN,
    );
    // The :runId anchor is back-filled so the set is always self-consistent.
    expect(set.primaryRunId).toBe(API_RUN);
    expect(set.runs.map((r) => r.runId)).toContain(API_RUN);
    expect(additionalRunIdsOf(set)).toEqual([DB_RUN]);
  });

  it('POST /start forwards the FULL additional-run-id set (>1 extra) to fetchReviewModel, keeping runId as the primary', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/v1/discovery-review', discoveryReviewConversationRouter);

    const seen: Array<{ runId: string; additionalRunIds: readonly string[] }> = [];
    setDiscoveryReviewConversationDeps({
      coordinatorDeps: {
        ...defaultReviewCoordinatorDeps,
        appendTurn: async () => {},
        loadConversation: async () => ({ schemaVersion: 1, threadId: 't', turns: [] }),
        newId: () => 'pending-fixed',
      },
      loadConversation: async () => ({ schemaVersion: 1, threadId: 't', turns: [] }),
      llmClient: llmProposing(null),
      fetchReviewModel: async (args) => {
        seen.push({ runId: args.runId, additionalRunIds: args.additionalRunIds });
        return buildModel();
      },
    });

    // The path :runId is API_RUN (the primary); the set carries TWO extra runs.
    const res = await request(app)
      .post(
        `/api/v1/discovery-review/projects/${PROJECT_ID}/architectures/${ARCH_ID}` +
          `/runs/${API_RUN}/review-conversation/start`,
      )
      .send({
        openedBy: 'architect@example.com',
        scanPair: {
          runs: [
            { runId: UI_RUN, scanKind: 'code', serviceId: 'svc-ui' },
            { runId: API_RUN, scanKind: 'code', serviceId: 'svc-api' },
            { runId: DB_RUN, scanKind: 'database', serviceId: 'svc-db' },
          ],
          primaryRunId: API_RUN,
        },
      });

    expect(res.status).toBe(200);
    expect(seen).toHaveLength(1);
    // primaryRunId stays the path anchor; the FULL additional-run-id set rides
    // alongside (more than one extra — proving it is not capped at a single
    // secondRunId).
    expect(seen[0].runId).toBe(API_RUN);
    expect(new Set(seen[0].additionalRunIds)).toEqual(new Set([UI_RUN, DB_RUN]));
  });
});
