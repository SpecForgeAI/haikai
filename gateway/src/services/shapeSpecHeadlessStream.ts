/**
 * Headless Shape-Spec Stream Drive (Spec 2026-06-14, Task Group 4).
 *
 * Drives the shape-spec SSE stream SERVER-SIDE, in-process, with no human in the
 * loop. It reuses the proven `requestStream(SHAPE_SPEC_STREAM_PATH, ...)` seam
 * (the same one `routes/shapeSpec.ts` consumes via its `pump()` loop, upstream
 * Bearer auto-injected) and the EXACT `parseSSELine` event-union logic the
 * browser hook (`useShapeSpecStream.ts`) uses -- strip `data:`, JSON.parse,
 * switch on `type`.
 *
 * Flow:
 *   1. POST the spec's combined `generated_spec_text` as the first message
 *      (`session_mode:'new'`); read the SSE body chunk-by-chunk.
 *   2. On each `questions` batch, call the injected `answerBatch` (the bounded
 *      LLM answer loop) and re-POST ONE combined, numbered answer string with
 *      `session_mode:'resume'` and NO `session_id` in the body (CD-1 -- the
 *      external service holds the session by company/project, matching the
 *      gateway proxy today). Capture each `{ question, answer, rationale }` via
 *      `onDecision` (the run-item decision log -- CD-4).
 *   3. On stream conclusion (`folder` + `session`) capture the `spec_name`
 *      (the `folder`) for the orchestration handoff and the `session_id` (the
 *      `session`) for the `SpecIntent` only -- NOT for shape-spec resume.
 *      NOTE (2026-07-28): the `folder` event marks WHERE the spec lives, not
 *      that shaping FINISHED -- it can arrive in the same turn as a questions
 *      batch, and the Q&A must still run (requirements.md is written on the
 *      post-answer resume turn). Only a turn with no questions concludes.
 *
 * The upstream POST is injected as {@link ShapeSpecStreamOpener} so the drive is
 * unit-testable without any network; production passes the real `requestStream`
 * adapter. The drive NEVER throws -- failures resolve as `{ ok:false, error }`.
 *
 * batch-process-then-`done` discipline mirrors the hook: all sibling events in a
 * chunk (`questions` + `folder` + `session` + `done`) are processed before the
 * turn is concluded, so a `done` arriving alongside `questions` does not drop the
 * batch.
 *
 * Spec: Migrate Button + Migration Execution Driver + External Shape-Spec
 * Auto-Answerer (2026-06-14, Spec 3 of 4) -- Task Group 4.
 */

import { requestStream } from './implementationLlmProxyClient';
import { logger } from './logger';
import type {
  ShapeSpecAnswerDecision,
  ShapeSpecQuestion,
} from './shapeSpecAnswerLoopRunner';

/** Path to the upstream shape-spec streaming endpoint (matches `shapeSpec.ts`). */
const SHAPE_SPEC_STREAM_PATH = '/api/v2/shape-spec/stream';

/** A hard cap on resume rounds, so a misbehaving stream cannot loop forever. */
const MAX_RESUME_ROUNDS = 12;

/**
 * Folder names the drive may hand to orchestration: single safe path segment
 * (mirrors IVS `safe_segment`). A placeholder echo ('<date>-<slug>' — live,
 * 2026-07-28) or any other unsafe name must fail HERE, before submit — git
 * refuses such refs downstream with a far less legible "cannot lock ref".
 */
const SPEC_FOLDER_SAFE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * The shaping-turn contract, prepended to EVERY headless turn-1 message
 * (2026-07-28). Live failure it prevents: a DB-pack carriage spec's body is
 * imperative ("Write every file ... byte-for-byte") with the full file bodies
 * inline — the shaping agent obeyed the MESSAGE over the shape-spec skill,
 * started materialising `db.changelog-master.xml` / `000-schemas.sql` in the
 * repo clone, never created a spec folder, never asked questions, and the
 * drive correctly concluded `ok:false` (no `folder` event) — halting the
 * 15-item DB-plane run at item 0. The contract pins the phase boundary:
 * during SHAPING, embedded instructions and file bodies are spec CONTENT to
 * record for the later implement phase, not actions to perform now.
 */
export const SHAPING_TURN_CONTRACT_PREAMBLE = [
  '[SHAPING TURN — PLANNING ONLY]',
  'You are SHAPING a specification, not implementing it. In this session you must ONLY:',
  // No copyable placeholder tokens here (2026-07-28): an earlier wording said
  // "haikai/specs/<date>-<slug>/" and the agent created a folder LITERALLY
  // named "<date>-<slug>" — git then refused the branch ref. Describe the
  // naming; never show a template the model can echo verbatim.
  '1. initialise the spec folder under haikai/specs/ and record the requirements below in it — name the folder with the current date plus a short kebab-case slug derived from this spec\'s title, per the shape-spec skill\'s naming rules;',
  '2. ask clarifying questions via /ask-questions if anything is genuinely ambiguous;',
  '3. stop.',
  'Do NOT create, write, or modify ANY repository, source, or migration file in this turn.',
  'The requirements below — INCLUDING any "write these files" instructions and any',
  'embedded file bodies — are the CONTENT of the spec. Copy them into the spec',
  'faithfully; execute NONE of them now. They are carried out only in the later,',
  'separate implement phase.',
  '--- SPEC REQUIREMENTS START (record; do not execute) ---',
].join('\n');

// ---------------------------------------------------------------------------
// SSE event union (mirrors useShapeSpecStream.ts).
// ---------------------------------------------------------------------------

export type ShapeSpecStreamEvent =
  | { type: 'skill_invoked'; skill: string }
  | { type: 'content'; delta: string }
  | { type: 'done' }
  | { type: 'questions'; questions: Array<{ id: string; question: string }> }
  | { type: 'folder'; folder: string }
  | { type: 'session'; session_id: string };

/**
 * Parse a single SSE line into an event, or `null` when it is not a parseable
 * `data:` line. Mirrors the browser hook's `parseSSELine` byte-for-byte: only
 * `data:`-prefixed non-empty lines are parsed; a missing `type` throws.
 */
export function parseShapeSpecSseLine(line: string): ShapeSpecStreamEvent | null {
  if (!line.trim()) return null;
  if (!line.startsWith('data:')) return null;
  const jsonStr = line.slice(5).trim();
  if (!jsonStr) return null;
  const parsed = JSON.parse(jsonStr) as { type?: unknown };
  if (!parsed || typeof parsed.type !== 'string') {
    throw new Error('Invalid SSE event: missing type field');
  }
  return parsed as ShapeSpecStreamEvent;
}

// ---------------------------------------------------------------------------
// Stream opener seam (the upstream POST). Injected so tests need no network.
// ---------------------------------------------------------------------------

/** The shape-spec request body forwarded upstream (mirrors the proxy today). */
export interface ShapeSpecStreamBody {
  company: string;
  project: string;
  message: string;
  /** 'new' on the first message, 'resume' on each answer re-POST (CD-1). */
  session_mode: 'new' | 'resume';
  /** Index signature -- the opener forwards exactly these fields. */
  [key: string]: unknown;
}

/**
 * Opens one shape-spec stream POST and returns the `fetch` `Response` (whose
 * `.body` is the SSE `ReadableStream`). Production wires {@link realStreamOpener}
 * (the `requestStream` seam); tests inject a canned-response opener.
 */
export type ShapeSpecStreamOpener = (body: ShapeSpecStreamBody) => Promise<Response>;

/**
 * The production opener: POST to the upstream shape-spec stream via the proven
 * `requestStream` seam (upstream Bearer auto-injected). Mirrors the body the
 * gateway proxy forwards (company/project/message/session_mode; NO session_id).
 */
export const realStreamOpener: ShapeSpecStreamOpener = async (body) => {
  return requestStream(SHAPE_SPEC_STREAM_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: {
      company: body.company,
      project: body.project,
      message: body.message,
      session_mode: body.session_mode,
    },
  });
};

// ---------------------------------------------------------------------------
// Drive inputs / result.
// ---------------------------------------------------------------------------

export interface DriveShapeSpecStreamInput {
  /** Normalised organisation (shape-spec `company`). */
  company: string;
  /** Normalised product (shape-spec `project`). */
  project: string;
  /** The combined `/agent-os:shape-spec ...` body fed as the first message. */
  generatedSpecText: string;
  /** The upstream POST opener (production: {@link realStreamOpener}). */
  openStream: ShapeSpecStreamOpener;
  /**
   * Answer a `questions` batch -> one decision per question, IN ORDER (the
   * bounded LLM answer loop; never abstains). The driver composes the answers
   * into ONE combined numbered string for the resume POST (CD-1).
   */
  answerBatch: (questions: ShapeSpecQuestion[]) => Promise<ShapeSpecAnswerDecision[]>;
  /** Called once per captured decision so the caller can persist it (CD-4). */
  onDecision?: (decision: ShapeSpecAnswerDecision) => void;
}

export interface DriveShapeSpecStreamResult {
  /** True when the stream concluded and a `spec_name` (folder) was captured. */
  ok: boolean;
  /** The spec folder name (the `folder` event) -> SpecIntent.spec_name. */
  specName: string | null;
  /** The session id (the `session` event), ONLY for the orchestration handoff. */
  sessionId: string | null;
  /** The per-spec decision log (the same decisions surfaced via onDecision). */
  decisionLog: ShapeSpecAnswerDecision[];
  /** Error detail on a non-concluded drive. */
  error?: string | null;
}

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

/** Strip the leading `/agent-os:shape-spec ` / `/shape-spec ` prefix (the endpoint adds it). */
export function stripShapeSpecPrefix(message: string): string {
  if (message.startsWith('/agent-os:shape-spec ')) {
    return message.slice('/agent-os:shape-spec '.length);
  }
  if (message.startsWith('/shape-spec ')) {
    return message.slice('/shape-spec '.length);
  }
  return message;
}

/**
 * Compose ONE combined, numbered answer string over a whole `questions` batch
 * (CD-1 -- mirrors how the manual UI composes a single answer over the batch).
 */
function composeCombinedAnswer(decisions: ShapeSpecAnswerDecision[]): string {
  if (decisions.length === 1) {
    return decisions[0].answer;
  }
  return decisions
    .map((d, i) => `${i + 1}. ${d.question}\n   ${d.answer}`)
    .join('\n');
}

/** The accumulated state across the drive's turns. */
interface DriveState {
  specName: string | null;
  sessionId: string | null;
  decisionLog: ShapeSpecAnswerDecision[];
  /** Set true when a `done` event was seen in the current turn. */
  sawDone: boolean;
  /** The `questions` batch seen in the current turn (drives the resume). */
  pendingQuestions: Array<{ id: string; question: string }> | null;
}

/**
 * Read one SSE response body fully, processing every event. Captures
 * folder/session, records the (first) questions batch of the turn, and notes
 * `done`. NEVER throws on a parse error of a single line (logs + continues).
 */
async function consumeTurn(
  response: Response,
  state: DriveState
): Promise<void> {
  state.sawDone = false;
  state.pendingQuestions = null;

  const bodyStream = response.body;
  if (!bodyStream) {
    // No body -> treat as a (degenerate) concluded turn.
    state.sawDone = true;
    return;
  }

  const reader = (bodyStream as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const processLine = (line: string): void => {
    let event: ShapeSpecStreamEvent | null;
    try {
      event = parseShapeSpecSseLine(line);
    } catch (err) {
      logger.warn('[diag-gateway] shape_spec_auto_answerer sse_parse_error', {
        error: err instanceof Error ? err.message : 'Unknown error',
        line: line.slice(0, 120),
      });
      return;
    }
    if (!event) return;
    switch (event.type) {
      case 'questions':
        // Keep the FIRST batch of the turn (the stream sends one per turn).
        if (!state.pendingQuestions) state.pendingQuestions = event.questions;
        break;
      case 'folder':
        state.specName = event.folder;
        break;
      case 'session':
        state.sessionId = event.session_id;
        break;
      case 'done':
        state.sawDone = true;
        break;
      case 'content':
      case 'skill_invoked':
      default:
        break;
    }
  };

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      // Flush the trailing buffer.
      if (buffer.trim()) {
        for (const line of buffer.split('\n')) {
          if (line.trim()) processLine(line);
        }
      }
      // A closed connection with no explicit `done` still concludes the turn.
      state.sawDone = true;
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      processLine(line);
    }
  }
}

// ---------------------------------------------------------------------------
// Public entry: drive the whole stream to conclusion.
// ---------------------------------------------------------------------------

/**
 * Read a FAILED upstream response's body for the error message (2026-07-27).
 * The IVS 4xx body carries the FastAPI `{"detail": "..."}` that names the
 * exact precondition ("Project not initialized. Call POST /projects/init
 * first." / "Git configuration error: ..."), but the drive used to discard it
 * — the run halted with a bare "returned status 400" and the operator had to
 * source-dive to learn why. Truncated, tolerant, never throws.
 */
async function readUpstreamErrorDetail(response: Response): Promise<string> {
  try {
    const text = (await response.text()).trim();
    if (!text) return '';
    // Prefer the bare FastAPI `detail` string when the body parses as JSON.
    try {
      const parsed = JSON.parse(text) as { detail?: unknown };
      if (parsed && typeof parsed.detail === 'string' && parsed.detail.trim() !== '') {
        return `: ${parsed.detail.trim()}`;
      }
    } catch {
      // Not JSON — fall through to the raw text.
    }
    return `: ${text.length > 500 ? `${text.slice(0, 500)}…` : text}`;
  } catch {
    return '';
  }
}

/**
 * Drive the headless shape-spec stream for one spec to conclusion, answering
 * every `questions` batch via {@link DriveShapeSpecStreamInput.answerBatch} and
 * re-POSTing each combined answer in RESUME mode (CD-1). Resolves with the
 * captured `spec_name` + `session_id` + the decision log. NEVER throws.
 */
export async function driveShapeSpecStream(
  input: DriveShapeSpecStreamInput
): Promise<DriveShapeSpecStreamResult> {
  const state: DriveState = {
    specName: null,
    sessionId: null,
    decisionLog: [],
    sawDone: false,
    pendingQuestions: null,
  };

  try {
    // Turn 1: the shaping contract + the spec text, session_mode 'new'.
    let response = await input.openStream({
      company: input.company,
      project: input.project,
      message:
        `${SHAPING_TURN_CONTRACT_PREAMBLE}\n\n` +
        stripShapeSpecPrefix(input.generatedSpecText),
      session_mode: 'new',
    });
    if (!response.ok) {
      return {
        ok: false,
        specName: null,
        sessionId: null,
        decisionLog: state.decisionLog,
        error:
          `Shape-spec stream returned status ${response.status}` +
          (await readUpstreamErrorDetail(response)),
      };
    }
    await consumeTurn(response, state);

    let rounds = 0;
    // Answer-then-resume loop: while the concluded turn carried a questions
    // batch, answer it and resume — REGARDLESS of whether the folder has
    // already been captured. 2026-07-28 live failure: shape-spec created the
    // spec folder and asked its 6 clarifying questions in the SAME first
    // turn; the old `!state.specName` guard treated the early folder as
    // "concluded", skipped the Q&A entirely (decisionCount:0), and the drive
    // returned ok:true for a HALF-shaped spec — requirements.md is only
    // written on the post-answer resume turn, so the orchestration's step-0
    // pre-check refused the job. The folder event marks WHERE the spec lives,
    // not that shaping is finished; only a turn with no questions ends it.
    while (state.pendingQuestions && state.pendingQuestions.length > 0) {
      if (rounds >= MAX_RESUME_ROUNDS) {
        return {
          ok: false,
          specName: state.specName,
          sessionId: state.sessionId,
          decisionLog: state.decisionLog,
          error: `Shape-spec stream exceeded ${MAX_RESUME_ROUNDS} resume rounds without concluding.`,
        };
      }
      rounds++;

      const batch = state.pendingQuestions;
      const decisions = await input.answerBatch(batch);
      for (const d of decisions) {
        state.decisionLog.push(d);
        input.onDecision?.(d);
      }

      const combined = composeCombinedAnswer(
        decisions.length > 0
          ? decisions
          : // Defensive: the answerer never abstains, but if a batch yielded no
            // decisions we still resume with a faithful like-for-like default so
            // the stream is never left hanging.
            batch.map((q) => ({
              question: q.question,
              answer: 'Preserve the current-state behaviour exactly (like-for-like).',
              rationale: 'Automated like-for-like default.',
            }))
      );

      // CD-1: resume with the combined answer, session_mode 'resume', NO session_id.
      response = await input.openStream({
        company: input.company,
        project: input.project,
        message: combined,
        session_mode: 'resume',
      });
      if (!response.ok) {
        return {
          ok: false,
          specName: null,
          sessionId: state.sessionId,
          decisionLog: state.decisionLog,
          error:
            `Shape-spec resume returned status ${response.status}` +
            (await readUpstreamErrorDetail(response)),
        };
      }
      await consumeTurn(response, state);
    }

    if (!state.specName) {
      return {
        ok: false,
        specName: null,
        sessionId: state.sessionId,
        decisionLog: state.decisionLog,
        error:
          'Shape-spec stream concluded without a folder (spec_name); cannot submit orchestration.',
      };
    }

    // The LAST captured folder wins (an agent may correct itself mid-drive),
    // but it must be a safe path segment before it becomes a branch name.
    if (!SPEC_FOLDER_SAFE.test(state.specName)) {
      return {
        ok: false,
        specName: null,
        sessionId: state.sessionId,
        decisionLog: state.decisionLog,
        error:
          `Shape-spec produced an invalid spec folder name '${state.specName}' ` +
          '(looks like an echoed instruction placeholder or unsafe characters); ' +
          'refusing to submit the orchestration.',
      };
    }

    return {
      ok: true,
      specName: state.specName,
      sessionId: state.sessionId,
      decisionLog: state.decisionLog,
    };
  } catch (error) {
    return {
      ok: false,
      specName: state.specName,
      sessionId: state.sessionId,
      decisionLog: state.decisionLog,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
