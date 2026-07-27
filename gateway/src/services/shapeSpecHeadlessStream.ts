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
function stripShapeSpecPrefix(message: string): string {
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
    // Turn 1: the spec text, session_mode 'new'.
    let response = await input.openStream({
      company: input.company,
      project: input.project,
      message: stripShapeSpecPrefix(input.generatedSpecText),
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
    // batch (and we have not captured the folder), answer it and resume.
    while (state.pendingQuestions && state.pendingQuestions.length > 0 && !state.specName) {
      if (rounds >= MAX_RESUME_ROUNDS) {
        return {
          ok: false,
          specName: null,
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
