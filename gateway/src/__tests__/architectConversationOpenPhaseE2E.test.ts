/**
 * End-to-end open-phase flow — ONE route-level HTTP test (required by S7).
 * Spec 2026-06-06-architect-conversation-open-ended-phase, Task Group 7 (7.2).
 *
 * This is the single comprehensive flow the spec mandates. It exercises the
 * WHOLE open phase through the REAL Express routes + the REAL coordinator
 * sub-phase handlers + the REAL `openPhaseLoopRunner` tool parsing + the REAL
 * `openPhaseCodes` derivation + the REAL `buildTargetStateDecisionsPromptText`
 * renderer, in one continuous flow against a SINGLE durable transcript:
 *
 *   1. preset walk EXHAUSTS  → GET /next-question returns
 *        `{ question: null, phase: 'open-available' }`
 *      (every library code already "answered", so `selectNextQuestion` → null).
 *   2. POST /open-phase/begin        → `open-phase-prompt` turn + suggested areas (P3).
 *   3. POST /open-phase/raise-topic  → user-raised topic + `option-proposal`
 *        (single-select, "something else…" escape, NO "Not applicable" — P4).
 *   4. POST /open-phase/pick         → first-class `adhoc.<slug>` decision WRITTEN
 *        (architecture scope, no element ref, distinct `createdByTask`) — the NEW
 *        capture path that does NOT 404 on the non-library code.
 *   5. POST /open-phase/discuss      → a free-form round (user + assistant turns).
 *   6. POST /open-phase/summarise    → per-topic `note.<slug>` rows WRITTEN
 *        (per-note unique codes, no mutual supersession, distinct `createdByTask`).
 *   7. POST /close                   → the existing close turn (the open phase is
 *        an OPTIONAL prelude to the unchanged close).
 *   8. GET  /prompt-ready-output     → the REAL renderer over the rows actually
 *        written above shows BOTH new sections:
 *        `### Additional / user-raised decisions` AND `### Free-form discussion notes`.
 *
 * The LLM is mocked ONLY at the `ArchitectLlmClient` boundary (`deps.llmClient`)
 * — every tool call is satisfied by a canned per-tool response keyed off the
 * pinned `toolChoice`. The AMS writer/loader seams (`postCapturedDecision`,
 * `loadConversation`, `loadCapturedDecisions`, `resolveOpenPhaseGrounding`,
 * `appendTurn`) are stubbed in-memory so the flow is hermetic but the routing,
 * coordination, code derivation, write shape, and rendering are all REAL.
 *
 * Critically the write→read-back→render loop is genuine: the recording
 * `postCapturedDecision` accumulates the rows it is asked to write, and the same
 * accumulator backs `loadCapturedDecisions`, so step 8's `prompt-ready-output`
 * renders the EXACT rows steps 4 + 6 produced.
 */

import request from 'supertest';
import express from 'express';

import {
  architectConversationRouter,
  setArchitectConversationDeps,
  resetArchitectConversationDeps,
} from '../routes/architectConversation';
import type {
  ArchitectLlmClient,
  CallLlmToolLoopArgs,
  CallLlmToolLoopResponse,
} from '../services/architectConversation/architectLlmClient';
import type { CreateCapturedDecisionRequestBody } from '../services/architectConversation/targetStateCapturedDecisionsWriter';
import type { TargetStateCapturedDecision } from '../services/targetStateCapturedDecisionsClient';
import type { ConversationTurn } from '../services/architectConversation/turnShape';

jest.mock('../services/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// ---------------------------------------------------------------------------
// Fixtures + helpers
// ---------------------------------------------------------------------------

const PROJECT_ID = '550e8400-e29b-41d4-a716-446655440000';
const TARGET_ID = 'tgt-arch-open-phase-e2e';

const BASE =
  `/api/projects/${PROJECT_ID}/target-architectures/${TARGET_ID}/architect-conversation`;

/**
 * Canned per-tool LLM client (the ONLY mock at the `ArchitectLlmClient`
 * boundary). The open-phase loop pins `toolChoice` to
 * `{ type:'function', function:{ name } }` for the four tool calls, and uses
 * `toolChoice: 'none'` for the free-form discussion reply. We key off the pinned
 * tool name; the free-form path returns plain assistant text.
 */
function cannedToolClient(byTool: Record<string, unknown>): ArchitectLlmClient {
  return {
    async callLlmToolLoop(args: CallLlmToolLoopArgs): Promise<CallLlmToolLoopResponse> {
      const choice = args.toolChoice;
      const toolName =
        choice && typeof choice === 'object' && 'function' in choice
          ? (choice as { function: { name: string } }).function.name
          : null;
      if (toolName && byTool[toolName] !== undefined) {
        return {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: `call-${toolName}`,
                type: 'function',
                function: { name: toolName, arguments: JSON.stringify(byTool[toolName]) },
              },
            ],
          },
        };
      }
      // Free-form discussion reply (toolChoice 'none').
      return {
        message: {
          role: 'assistant',
          content: 'A phased cut-over with a read-only freeze is typical here.',
          tool_calls: [],
        },
      };
    },
    async callSingleShot() {
      throw new Error('callSingleShot must not be invoked in the open-phase E2E');
    },
  };
}

/**
 * One canned client covering EVERY tool the flow hits — `begin`, `raise-topic`,
 * `pick`, and `summarise` each pin a different tool, so a single map suffices
 * for the whole walk.
 */
function fullFlowLlmClient(): ArchitectLlmClient {
  return cannedToolClient({
    // begin → suggested candidate areas (P3).
    'suggest-candidate-areas': {
      promptText:
        "We've covered the standard decisions — are there other areas you'd like to decide?",
      areas: [
        { label: 'Batch processing strategy', rationale: 'nightly Sybase jobs found in discovery' },
        { label: 'Caching layer' },
      ],
    },
    // raise-topic → a SINGLE-select proposal with the free-text escape; a "Not
    // applicable" option is INCLUDED here on purpose to prove the loop FILTERS
    // it out (P4) before it ever reaches the transcript.
    'propose-options-for-topic': {
      topicLabel: 'Batch processing',
      selectionMode: 'single',
      options: [
        { value: 'Spring Batch' },
        { value: 'Quartz scheduler', label: 'Quartz' },
        { value: 'Not applicable' },
      ],
    },
    // pick → the structured first-class decision (the user chose Spring Batch).
    'capture-user-decision': {
      topicLabel: 'Batch processing',
      selectedValues: ['Spring Batch'],
      answerSummary: 'Adopt Spring Batch for the nightly jobs',
    },
    // summarise → two notes on the SAME topic + one on another → three distinct
    // per-note-unique codes (no mutual supersession).
    'record-discussion-note': {
      notes: [
        { topicLabel: 'Cutover window', noteText: 'Must cut over on a bank holiday.' },
        { topicLabel: 'Cutover window', noteText: 'Freeze code two weeks prior.' },
        { topicLabel: 'Data retention', noteText: 'Keep 7 years for compliance.' },
      ],
    },
  });
}

/**
 * A `postCapturedDecision` stub that records every write AND accumulates an
 * echoed row so the SAME accumulator can back `loadCapturedDecisions` — this is
 * what makes step 8's render genuinely end-to-end (it renders the EXACT rows the
 * pick + summarise routes wrote).
 */
function recordingWriterWithStore(): {
  fn: jest.Mock;
  writes: CreateCapturedDecisionRequestBody[];
  rows: TargetStateCapturedDecision[];
} {
  const writes: CreateCapturedDecisionRequestBody[] = [];
  const rows: TargetStateCapturedDecision[] = [];
  const fn = jest.fn(
    async (
      projectId: string,
      targetArchitectureId: string,
      body: CreateCapturedDecisionRequestBody,
    ): Promise<TargetStateCapturedDecision> => {
      writes.push(body);
      const row: TargetStateCapturedDecision = {
        decisionId: `dec-${rows.length + 1}`,
        projectId,
        targetArchitectureId,
        decisionCode: body.decisionCode,
        scopeKind: body.scopeKind,
        scopeRefType: body.scopeRefType ?? null,
        scopeRefId: body.scopeRefId ?? null,
        answerValue: body.answerValue,
        answerSummary: body.answerSummary ?? null,
        standardsLookupRef: body.standardsLookupRef ?? null,
        conversationThreadId: body.conversationThreadId ?? null,
        conversationTurnRef: null,
        createdAt: '2026-06-06T00:00:00Z',
        createdByTask: body.createdByTask,
        supersededById: null,
      };
      rows.push(row);
      return row;
    },
  );
  return { fn: fn as unknown as jest.Mock, writes, rows };
}

function buildApp(): express.Application {
  const app = express();
  app.use(express.json());
  app.use('/api', architectConversationRouter);
  return app;
}

// ---------------------------------------------------------------------------
// The single end-to-end flow
// ---------------------------------------------------------------------------

describe('Open-phase END-TO-END flow (Spec 2026-06-06, Task Group 7)', () => {
  let appendedTurns: ConversationTurn[];
  let writer: ReturnType<typeof recordingWriterWithStore>;

  beforeEach(() => {
    appendedTurns = [];
    writer = recordingWriterWithStore();
    setArchitectConversationDeps({
      llmClient: fullFlowLlmClient(),
      postCapturedDecision: writer.fn as never,
      // Hermetic grounding — the composer/fetch shell is unit-tested in TG2; here
      // we hand the handlers a fixed grounding string so the flow is I/O-free.
      resolveOpenPhaseGrounding: (async () =>
        '## Captured decisions so far\n`db.engine` = Postgres 18') as never,
      // Durable transcript: append accumulates; load echoes the accumulator so
      // discuss/summarise reconstruct the free-form history from real turns.
      appendTurn: (async (_p: string, _t: string, turn: ConversationTurn) => {
        appendedTurns.push(turn);
      }) as never,
      loadConversation: (async () => ({
        schemaVersion: 1 as const,
        threadId: 'thr-open-phase-e2e',
        turns: appendedTurns,
      })) as never,
      // Read-back for next-question AND prompt-ready-output renders the rows the
      // open-phase routes actually wrote (write → read-back → render is real).
      loadCapturedDecisions: (async () => writer.rows) as never,
    });
  });

  afterEach(() => {
    resetArchitectConversationDeps();
    jest.clearAllMocks();
  });

  it('walks exhaust → begin → topic → pick → discuss → summarise → close → BOTH prompt-ready sections present', async () => {
    const app = buildApp();

    // -- Step 1: the preset walk is EXHAUSTED → phase is `open-available`. -----
    // The phase rides the next-question response and is `open-available`
    // STRICTLY when `selectNextQuestion` → null (every library code answered).
    // We drive the genuine exhaustion branch by backing next-question's read
    // with a full answered-set (one architecture-wide preset row per library
    // code) so the route's `selectNextQuestion` returns null for real.
    const { QUESTION_LIBRARY } = await import(
      '../config/architect-conversation/questionLibrary'
    );
    const presetRows: TargetStateCapturedDecision[] = QUESTION_LIBRARY.map((e, i) => ({
      decisionId: `preset-${i}`,
      projectId: PROJECT_ID,
      targetArchitectureId: TARGET_ID,
      decisionCode: e.code,
      scopeKind: 'architecture',
      scopeRefType: null,
      scopeRefId: null,
      answerValue: 'x',
      answerSummary: null,
      standardsLookupRef: null,
      conversationThreadId: null,
      conversationTurnRef: null,
      createdAt: '2026-06-06T00:00:00Z',
      createdByTask: 'architect-persona-conversation',
      supersededById: null,
    }));
    setArchitectConversationDeps({
      loadCapturedDecisions: (async () => presetRows) as never,
    });

    const nextRes = await request(app).get(`${BASE}/next-question`);
    expect(nextRes.status).toBe(200);
    expect(nextRes.body.question).toBeNull();
    expect(nextRes.body.phase).toBe('open-available');

    // Restore the open-phase read-back (the rows the open phase will write) for
    // the rest of the flow + the final render.
    setArchitectConversationDeps({
      loadCapturedDecisions: (async () => writer.rows) as never,
    });

    // -- Step 2: begin the open phase → prompt + suggested areas (P3). --------
    const beginRes = await request(app).post(`${BASE}/open-phase/begin`).send({});
    expect(beginRes.status).toBe(200);
    expect(beginRes.body.outcome).toBe('prompt');
    expect(beginRes.body.openPhasePromptTurn.kind).toBe('open-phase-prompt');
    expect(beginRes.body.openPhasePromptTurn.suggestedAreas).toHaveLength(2);

    // -- Step 3: the user raises a topic → option proposal (single + escape). --
    const topicRes = await request(app)
      .post(`${BASE}/open-phase/raise-topic`)
      .send({ topicLabel: 'Batch processing', topicText: 'how to migrate nightly jobs?' });
    expect(topicRes.status).toBe(200);
    expect(topicRes.body.outcome).toBe('proposed');
    expect(topicRes.body.userRaisedTopicTurn.kind).toBe('user-raised-topic');
    const proposal = topicRes.body.optionProposalTurn;
    expect(proposal.kind).toBe('option-proposal');
    expect(proposal.selectionMode).toBe('single');
    // P4: the "Not applicable" option the LLM emitted is FILTERED OUT by the loop.
    const optionValues = (proposal.options as Array<{ value: string }>).map((o) =>
      o.value.toLowerCase().replace(/[\s_-]+/g, ''),
    );
    expect(optionValues).not.toContain('notapplicable');
    expect(proposal.options).toEqual([
      { value: 'Spring Batch' },
      { value: 'Quartz scheduler', label: 'Quartz' },
    ]);
    // S4: a "something else…" free-text escape IS offered (no opt-out modelled).
    expect(proposal.allowFreeTextEscape).toBe(true);

    // -- Step 4: the user PICKS → first-class adhoc.<slug> decision WRITTEN. ---
    const pickRes = await request(app)
      .post(`${BASE}/open-phase/pick`)
      .send({ topicLabel: 'Batch processing', selectedValues: ['Spring Batch'] });
    expect(pickRes.status).toBe(200);
    // The NEW capture path does NOT 404 on the non-library adhoc.* code.
    expect(pickRes.status).not.toBe(404);
    expect(pickRes.body.outcome).toBe('captured');
    expect(pickRes.body.userPickTurn.kind).toBe('user-pick');
    expect(pickRes.body.userPickTurn.decisionCode).toBe('adhoc.batch-processing');

    // The written decision row: adhoc.<slug>, architecture scope, no element ref,
    // distinct createdByTask; the raw answerValue persists verbatim.
    const adhocWrite = writer.writes.find((w) => w.decisionCode.startsWith('adhoc.'));
    expect(adhocWrite).toBeDefined();
    expect(adhocWrite?.decisionCode).toBe('adhoc.batch-processing');
    expect(adhocWrite?.scopeKind).toBe('architecture');
    expect(adhocWrite?.scopeRefType ?? null).toBeNull();
    expect(adhocWrite?.scopeRefId ?? null).toBeNull();
    expect(adhocWrite?.createdByTask).toBe('architect-adhoc-decision');
    expect(adhocWrite?.answerValue).toBe('Spring Batch');

    // -- Step 5: a free-form discussion round (sub-phase b). ------------------
    const discussRes = await request(app)
      .post(`${BASE}/open-phase/discuss`)
      .send({ userMessage: 'What about the cut-over window for the legacy scheduler?' });
    expect(discussRes.status).toBe(200);
    expect(discussRes.body.outcome).toBe('replied');
    expect(discussRes.body.userTurn.kind).toBe('free-form-discussion');
    expect(discussRes.body.userTurn.speaker).toBe('user');
    expect(discussRes.body.assistantTurn.speaker).toBe('assistant');

    // -- Step 6: summarise the discussion → per-topic note.<slug> rows WRITTEN. -
    const summRes = await request(app).post(`${BASE}/open-phase/summarise`).send({});
    expect(summRes.status).toBe(200);
    expect(summRes.body.outcome).toBe('notes');
    expect(summRes.body.notes).toHaveLength(3);

    // Per-note UNIQUE codes — two notes on the SAME topic do NOT collide.
    const noteWrites = writer.writes.filter((w) => w.decisionCode.startsWith('note.'));
    expect(noteWrites).toHaveLength(3);
    const noteCodes = noteWrites.map((w) => w.decisionCode);
    expect(new Set(noteCodes).size).toBe(3);
    expect(noteCodes).toEqual([
      'note.cutover-window-1',
      'note.cutover-window-2',
      'note.data-retention-3',
    ]);
    for (const w of noteWrites) {
      expect(w.createdByTask).toBe('architect-discussion-note');
      expect(w.scopeKind).toBe('architecture');
    }

    // -- Step 7: close the conversation (the open phase is an optional prelude). -
    const openTurnIdx = appendedTurns.findIndex((t) => t.kind === 'open');
    // (No `open` turn was appended in this hermetic flow — close still succeeds
    // with a caller-supplied sessionId, the existing close contract.)
    expect(openTurnIdx).toBe(-1);
    const closeRes = await request(app)
      .post(`${BASE}/close`)
      .send({
        sessionId: 's-e2e',
        closeReason: 'completed-by-user',
        summaryMarkdown: '## Summary\nOpen phase complete.',
      });
    expect(closeRes.status).toBe(200);
    expect(closeRes.body.closeTurn.kind).toBe('close');
    expect(appendedTurns.some((t) => t.kind === 'close')).toBe(true);

    // -- Step 8: BOTH new prompt-ready sections present in the REAL renderer. --
    // The rows the pick + summarise routes wrote are read back and rendered by
    // the real `buildTargetStateDecisionsPromptText` (via the prompt-ready route).
    const promptRes = await request(app).get(`${BASE}/prompt-ready-output`);
    expect(promptRes.status).toBe(200);
    const text: string = promptRes.body.promptReadyOutput;

    // BOTH additive sections present (the only PM-facing change — Q2c).
    expect(text).toContain('### Additional / user-raised decisions');
    expect(text).toContain('### Free-form discussion notes');

    // The first-class user-raised decision is citable verbatim. The renderer
    // prefers `answerSummary` over `answerValue` (the documented
    // `<decisionCode> = <answerSummary|answerValue>` shape).
    expect(text).toContain(
      '`adhoc.batch-processing` = Adopt Spring Batch for the nightly jobs',
    );

    // All three per-note rows render under the notes section (none superseded).
    expect(text).toContain('`note.cutover-window-1`');
    expect(text).toContain('`note.cutover-window-2`');
    expect(text).toContain('`note.data-retention-3`');
    expect(text).toContain('Must cut over on a bank holiday.');
    expect(text).toContain('Keep 7 years for compliance.');

    // Section ordering: user-raised decisions precede the free-form notes.
    expect(text.indexOf('### Additional / user-raised decisions')).toBeLessThan(
      text.indexOf('### Free-form discussion notes'),
    );

    // The whole open-phase transcript survived as durable turns (reopen-safe).
    const kinds = appendedTurns.map((t) => t.kind);
    expect(kinds).toEqual(
      expect.arrayContaining([
        'open-phase-prompt',
        'user-raised-topic',
        'option-proposal',
        'user-pick',
        'decision-captured',
        'free-form-discussion',
        'close',
      ]),
    );
  });
});
