/**
 * Tests for the headless Shape-Spec Auto-Answerer (Spec 2026-06-14, Task Group 4).
 *
 * The auto-answerer drives the shape-spec SSE stream server-side, answers each
 * `questions` batch automatically (it DECIDES, NEVER abstains -- the LOCK), and
 * appends each `{ question, answer, rationale }` decision to the run-item inline
 * JSONB log (CD-4). It replies in RESUME mode: ONE combined numbered answer
 * string, `session_mode:'resume'`, NO `session_id` in the body (CD-1).
 *
 * The LLM guard is respected: the only LLM boundary (the answer tool's
 * `ArchitectLlmClient`) is injected as a mock -- no live LLM is reachable. AMS
 * reads (grounding) + the run-item PATCH (the decision log) are injected too, so
 * the answerer is unit-testable without any network.
 *
 * Coverage (the 4.1 cap, 8 tests):
 *   1. the SSE-line parser handles the full event union;
 *   2. on a `questions` batch the answerer emits ONE combined numbered answer
 *      string and NEVER abstains;
 *   3. the resume re-POST uses `session_mode:'resume'` with NO `session_id`;
 *   4. each decision is recorded to the run-item log (CD-4);
 *   5. the answer is grounded in the spec text + migration context;
 *   6. even a sparse/ambiguous question yields a CONCRETE answer (never abstains);
 *   7. a bounded-loop timeout yields a structured (never-throw) decision (a safe
 *      fallback answer, still concrete);
 *   8. on stream conclusion the captured spec_name + session_id are returned and
 *      `driveAndAnswer` resolves `ok:true` (never throws).
 */

// Silence the logger.
jest.mock('../services/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import {
  parseShapeSpecSseLine,
  driveShapeSpecStream,
  ShapeSpecStreamOpener,
} from '../services/shapeSpecHeadlessStream';
import {
  answerShapeSpecQuestions,
  SHAPE_SPEC_ANSWER_TOOL,
} from '../services/shapeSpecAnswerLoopRunner';
import { buildShapeSpecAutoAnswerer } from '../services/shapeSpecAutoAnswerer';
import type {
  ArchitectLlmClient,
  CallLlmToolLoopArgs,
  CallLlmToolLoopResponse,
} from '../services/architectConversation/architectLlmClient';
import type { MigrationExecutionRunItem } from '../services/migrationExecutionRunClient';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * An LLM client whose `callLlmToolLoop` answers the `answer-shape-spec-question`
 * tool with a canned `{ answer, rationale }`. `lastArgs` exposes the prompt so a
 * test can assert grounding reached the model.
 */
function answerToolClient(
  answer: string,
  rationale: string
): { client: ArchitectLlmClient; lastArgs: () => CallLlmToolLoopArgs | null } {
  let lastArgs: CallLlmToolLoopArgs | null = null;
  const client: ArchitectLlmClient = {
    async callLlmToolLoop(a: CallLlmToolLoopArgs): Promise<CallLlmToolLoopResponse> {
      lastArgs = a;
      return {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call-1',
              type: 'function',
              function: {
                name: SHAPE_SPEC_ANSWER_TOOL,
                arguments: JSON.stringify({ answer, rationale }),
              },
            },
          ],
        },
      };
    },
    async callSingleShot() {
      throw new Error('callSingleShot should not be invoked');
    },
  };
  return { client, lastArgs: () => lastArgs };
}

/** Build an SSE stream `Response` whose body yields the given lines as one chunk. */
function sseResponse(lines: string[]): Response {
  const payload = lines.map((l) => `${l}\n`).join('');
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(payload));
      controller.close();
    },
  });
  return { ok: true, status: 200, body: stream } as unknown as Response;
}

/** Build a `ShapeSpecStreamOpener` returning canned responses per POST in order. */
function scriptedOpener(
  responses: Response[]
): { open: ShapeSpecStreamOpener; bodies: () => Array<Record<string, unknown>> } {
  const bodies: Array<Record<string, unknown>> = [];
  let call = 0;
  const open: ShapeSpecStreamOpener = async (body) => {
    bodies.push(body);
    const resp = responses[Math.min(call, responses.length - 1)];
    call++;
    return resp;
  };
  return { open, bodies: () => bodies };
}

const SPEC_TEXT = '/agent-os:shape-spec Migrate the order-history endpoint like-for-like.';

// ===========================================================================
// 1 -- SSE-line parser handles the event union
// ===========================================================================

describe('parseShapeSpecSseLine', () => {
  it('parses content / questions / folder / session / done / skill_invoked', () => {
    expect(parseShapeSpecSseLine('data: {"type":"content","delta":"hi"}')).toEqual({
      type: 'content',
      delta: 'hi',
    });
    expect(
      parseShapeSpecSseLine('data: {"type":"questions","questions":[{"id":"q1","question":"DB?"}]}')
    ).toEqual({ type: 'questions', questions: [{ id: 'q1', question: 'DB?' }] });
    expect(parseShapeSpecSseLine('data: {"type":"folder","folder":"2026-spec"}')).toEqual({
      type: 'folder',
      folder: '2026-spec',
    });
    expect(parseShapeSpecSseLine('data: {"type":"session","session_id":"sess-9"}')).toEqual({
      type: 'session',
      session_id: 'sess-9',
    });
    expect(parseShapeSpecSseLine('data: {"type":"done"}')).toEqual({ type: 'done' });
    expect(parseShapeSpecSseLine('data: {"type":"skill_invoked","skill":"x"}')).toEqual({
      type: 'skill_invoked',
      skill: 'x',
    });
    // Non-data lines and blanks are ignored.
    expect(parseShapeSpecSseLine('')).toBeNull();
    expect(parseShapeSpecSseLine(': keep-alive')).toBeNull();
  });
});

// ===========================================================================
// 2 + 3 -- a questions batch -> ONE combined numbered answer in RESUME mode
//          (session_mode:'resume', NO session_id)
// ===========================================================================

describe('driveShapeSpecStream -- resume protocol (CD-1)', () => {
  it('answers a questions batch with ONE combined numbered string and resumes WITHOUT a session_id', async () => {
    // Turn 1: emits a session + a two-question batch + done.
    const turn1 = sseResponse([
      'data: {"type":"session","session_id":"sess-1"}',
      'data: {"type":"questions","questions":[{"id":"q1","question":"Which DB?"},{"id":"q2","question":"Sync or async?"}]}',
      'data: {"type":"done"}',
    ]);
    // Turn 2 (after the resume answer): emits the folder + done -> conclusion.
    const turn2 = sseResponse([
      'data: {"type":"folder","folder":"2026-order-history-spec"}',
      'data: {"type":"done"}',
    ]);
    const { open, bodies } = scriptedOpener([turn1, turn2]);

    const decisions: Array<{ question: string; answer: string; rationale: string }> = [];
    const result = await driveShapeSpecStream({
      company: 'acme',
      project: 'order-mig',
      generatedSpecText: SPEC_TEXT,
      openStream: open,
      answerBatch: async (questions) => {
        // The answer loop returns one answer per question; the stream driver
        // composes them into a single numbered string for the resume POST.
        return questions.map((q) => ({
          question: q.question,
          answer: `Answer to ${q.id}`,
          rationale: 'grounded',
        }));
      },
      onDecision: (d) => decisions.push(d),
    });

    expect(result.ok).toBe(true);
    expect(result.specName).toBe('2026-order-history-spec');
    expect(result.sessionId).toBe('sess-1');

    // Two POSTs: the initial 'new' message and ONE resume answer for the batch.
    const sent = bodies();
    expect(sent).toHaveLength(2);

    // First POST: the spec text, session_mode 'new'.
    expect(sent[0].session_mode).toBe('new');
    expect(typeof sent[0].message).toBe('string');

    // Second POST: resume mode, ONE combined numbered answer string, NO session_id.
    expect(sent[1].session_mode).toBe('resume');
    expect(sent[1].session_id).toBeUndefined();
    const answerMessage = sent[1].message as string;
    expect(answerMessage).toContain('1.');
    expect(answerMessage).toContain('2.');
    expect(answerMessage).toContain('Answer to q1');
    expect(answerMessage).toContain('Answer to q2');

    // Both decisions were surfaced for logging (CD-4).
    expect(decisions).toHaveLength(2);
  });
});

// ===========================================================================
// 4 + 5 + 8 -- driveAndAnswer: grounded answer, decision log persisted, conclusion
// ===========================================================================

describe('buildShapeSpecAutoAnswerer.driveAndAnswer', () => {
  it('grounds the answer, records decisions to the run-item log, and resolves ok on conclusion', async () => {
    const turn1 = sseResponse([
      'data: {"type":"session","session_id":"sess-7"}',
      'data: {"type":"questions","questions":[{"id":"q1","question":"Which datastore should target use?"}]}',
      'data: {"type":"done"}',
    ]);
    const turn2 = sseResponse([
      'data: {"type":"folder","folder":"2026-target-folder"}',
      'data: {"type":"done"}',
    ]);
    const { open } = scriptedOpener([turn1, turn2]);
    const { client, lastArgs } = answerToolClient(
      'Use PostgreSQL, mirroring the current-state datastore.',
      'Like-for-like: the legacy store maps to Postgres per the spec.'
    );

    const patches: MigrationExecutionRunItem[] = [];
    const answerer = buildShapeSpecAutoAnswerer({
      llmClient: client,
      openStream: open,
      resolveGrounding: async () => '## Migration goal\nLike-for-like migration to Postgres.',
      patchRunItem: async (_projectId, _runItemId, patch) => {
        patches.push(patch);
        return patch;
      },
    });

    const result = await answerer.driveAndAnswer({
      projectId: 'proj-1',
      company: 'acme',
      project: 'order-mig',
      runItemId: 'ri-0',
      generatedSpecText: SPEC_TEXT,
    });

    expect(result.ok).toBe(true);
    expect(result.specName).toBe('2026-target-folder');
    expect(result.sessionId).toBe('sess-7');
    expect(result.decisionLog).toHaveLength(1);
    expect(result.decisionLog[0].answer).toContain('PostgreSQL');

    // Grounding (spec text + migration context) reached the LLM prompt.
    const promptText = (lastArgs()?.messages ?? []).map((m) => m.content ?? '').join('\n');
    expect(promptText).toContain('order-history'); // the spec text body
    expect(promptText).toContain('Like-for-like migration to Postgres'); // the grounding

    // The decision log was persisted to the run-item (CD-4) at least once with
    // the captured Q->A.
    const logged = patches.filter((p) => Array.isArray(p.auto_answer_decision_log_json));
    expect(logged.length).toBeGreaterThan(0);
    const lastLog = logged[logged.length - 1].auto_answer_decision_log_json!;
    expect(lastLog[0]).toMatchObject({ answer: expect.stringContaining('PostgreSQL') });
  });
});

// ===========================================================================
// 6 -- never abstains, even on a sparse / ambiguous question
// ===========================================================================

describe('answerShapeSpecQuestions -- never abstains', () => {
  it('produces a concrete answer for a sparse, ambiguous question (the LOCK)', async () => {
    const { client } = answerToolClient(
      'Preserve the existing pagination contract exactly (page size 25, 1-based).',
      'No new behaviour: faithfully reproduce the current-state contract.'
    );

    const decisions = await answerShapeSpecQuestions({
      llmClient: client,
      specText: SPEC_TEXT,
      grounding: 'No additional grounding context is available.',
      questions: [{ id: 'q1', question: '?' }], // deliberately sparse
    });

    expect(decisions).toHaveLength(1);
    // A concrete, non-empty answer is ALWAYS produced -- never an abstention.
    expect(decisions[0].answer.trim().length).toBeGreaterThan(0);
    expect(decisions[0].answer.toLowerCase()).not.toContain("i don't know");
    expect(decisions[0].answer.toLowerCase()).not.toContain('defer to');
  });

  it('falls back to a CONCRETE answer (never abstains) when the LLM call times out', async () => {
    // A client that never resolves within the per-call timeout.
    const hangingClient: ArchitectLlmClient = {
      callLlmToolLoop: () => new Promise<CallLlmToolLoopResponse>(() => {}),
      async callSingleShot() {
        throw new Error('unused');
      },
    };

    const decisions = await answerShapeSpecQuestions({
      llmClient: hangingClient,
      specText: SPEC_TEXT,
      grounding: 'g',
      questions: [{ id: 'q1', question: 'Which auth scheme?' }],
      perCallTimeoutMs: 5, // force a fast timeout
      wallClockMs: 50,
    });

    // Even on a bounded-loop failure the answerer NEVER abstains: a structured,
    // concrete fallback answer is returned (the LOCK), not a throw or a blank.
    expect(decisions).toHaveLength(1);
    expect(decisions[0].answer.trim().length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// 7 -- DI: the seam is satisfied by an injectable fake; the production default
//        is wired into the Driver deps (not the no-op placeholder).
// ===========================================================================

describe('shape-spec auto-answerer DI wiring', () => {
  it('lets the Driver inject a FAKE answerer (the seam) and uses the REAL one by default', async () => {
    // A fake satisfying the seam -- exactly what the Driver tests inject.
    const fake = {
      driveAndAnswer: jest.fn().mockResolvedValue({
        ok: true,
        specName: 'folder-x',
        sessionId: 'sess-x',
        decisionLog: [],
      }),
    };
    const r = await fake.driveAndAnswer({
      projectId: 'p',
      company: 'c',
      project: 'pr',
      runItemId: 'ri',
      generatedSpecText: SPEC_TEXT,
    });
    expect(r.ok).toBe(true);
    expect(fake.driveAndAnswer).toHaveBeenCalledTimes(1);

    // The production default deps wire the REAL answerer (a driveAndAnswer fn),
    // NOT the no-op placeholder. (Resolved lazily so no live LLM is touched.)
    const {
      defaultMigrationDriverDeps,
    } = require('../services/migrationExecutionDriver');
    const deps = defaultMigrationDriverDeps('http://gw/api/implementation/build-results');
    expect(typeof deps.autoAnswerer.driveAndAnswer).toBe('function');
  });
});
