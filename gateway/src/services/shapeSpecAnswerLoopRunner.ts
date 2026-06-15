/**
 * Shape-Spec Answer Loop Runner (Spec 2026-06-14, Task Group 4).
 *
 * The bounded LLM tool-loop that answers ONE shape-spec `questions` batch from
 * the migration context, for the headless auto-answerer. It REUSES the architect
 * open-phase CHASSIS as the PATTERN (`openPhaseLoopRunner.ts`):
 *   - the `ArchitectLlmClient` seam (`callLlmToolLoop`) -- the LLM boundary
 *     mocked in every test;
 *   - the SAME hard limits (`ARCHITECT_LOOP_*`: 5 rounds / 30s per call / 120s
 *     wall, imported from `llmLoopRunner.ts`, not re-declared);
 *   - the SAME `withTimeout` synthetic-timer race;
 *   - the SAME never-throw structured-result discipline.
 *
 * It does NOT reuse the four architect-domain tools. It carries its OWN single
 * tool, `answer-shape-spec-question`: given a streamed shape-spec QUESTION + the
 * implementation-ready spec text + oracle grounding, emit an ANSWER STRING + a
 * short rationale -- DECIDING, NEVER abstaining (the LOCK). There is no
 * human-in-the-loop during the automated migration run, so the system prompt
 * forbids "I don't know" / "ask a human" / "defer" answers: the answerer is the
 * migration's automated spec-shaping decision-maker and always chooses the most
 * faithful like-for-like answer.
 *
 * never-abstain INVARIANT: because abstention is forbidden, a bounded-loop
 * FAILURE (timeout / malformed / relay error) does NOT surface as an error that
 * would stall the run. Instead {@link answerShapeSpecQuestions} substitutes a
 * concrete, conservative like-for-like fallback answer so the resume always
 * carries a real answer string. (The failure is logged; the decision rationale
 * records that the fallback was used.)
 *
 * Spec: Migrate Button + Migration Execution Driver + External Shape-Spec
 * Auto-Answerer (2026-06-14, Spec 3 of 4) -- Task Group 4.
 */

import type {
  ArchitectChatMessage,
  ArchitectLlmClient,
  ArchitectToolCall,
  ArchitectToolDefinition,
  CallLlmToolLoopResponse,
} from './architectConversation/architectLlmClient';
import {
  ARCHITECT_LOOP_PER_CALL_TIMEOUT_MS,
  ARCHITECT_LOOP_WALL_CLOCK_MS,
} from './architectConversation/llmLoopRunner';
import { logger } from './logger';

// ---------------------------------------------------------------------------
// Tool name. Kebab per the existing convention; the LLM tool-call wire is
// name-agnostic.
// ---------------------------------------------------------------------------

export const SHAPE_SPEC_ANSWER_TOOL = 'answer-shape-spec-question';

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/** One shape-spec question off the stream (`questions` event item). */
export interface ShapeSpecQuestion {
  id: string;
  question: string;
}

/** A single auto-answer decision (the CD-4 log-entry shape). */
export interface ShapeSpecAnswerDecision {
  question: string;
  answer: string;
  rationale: string;
}

/** The parsed, validated tool payload. */
interface AnswerToolPayload {
  answer: string;
  rationale: string;
}

interface AnswerLoopErrorResult {
  outcome: 'error';
  errorKind:
    | 'llm-call-timeout'
    | 'wall-clock-exceeded'
    | 'llm-call-failed'
    | 'tool-output-malformed';
  errorMessage: string;
}

interface AnswerLoopOkResult {
  outcome: 'ok';
  payload: AnswerToolPayload;
}

type AnswerLoopResult = AnswerLoopOkResult | AnswerLoopErrorResult;

// ---------------------------------------------------------------------------
// withTimeout -- synthetic timer race (structurally identical to the open-phase
// helper; kept local so this module is independent of the runner's private copy).
// ---------------------------------------------------------------------------

interface TimeoutTaggedError extends Error {
  __shapeSpecAnswerTimeout?: boolean;
}

function withTimeout<T>(p: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const err = new Error(
        `Shape-spec answer call '${label}' exceeded the ${timeoutMs}ms per-call timeout.`
      ) as TimeoutTaggedError;
      err.__shapeSpecAnswerTimeout = true;
      reject(err);
    }, timeoutMs);
  });
  return Promise.race([p, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}

function isTimeoutError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as TimeoutTaggedError).__shapeSpecAnswerTimeout === true
  );
}

// ---------------------------------------------------------------------------
// Tool definition + prompt assembly
// ---------------------------------------------------------------------------

function answerToolDef(): ArchitectToolDefinition {
  return {
    type: 'function',
    function: {
      name: SHAPE_SPEC_ANSWER_TOOL,
      description:
        'Answer ONE shape-spec clarifying question for the migration. You MUST ' +
        'commit to a concrete answer grounded in the implementation-ready spec ' +
        'text and the migration context. NEVER abstain, never say "I don\'t know", ' +
        'never ask for human input, never defer the decision. Always choose the ' +
        'most faithful like-for-like answer (reproduce the current-state behaviour ' +
        'exactly unless the spec explicitly says otherwise).',
      parameters: {
        type: 'object',
        properties: {
          answer: {
            type: 'string',
            description:
              'The concrete answer to the question (a direct, committed decision). ' +
              'MUST be non-empty.',
          },
          rationale: {
            type: 'string',
            description:
              'A short one-line rationale for the answer, grounded in the spec / context.',
          },
        },
        required: ['answer'],
      },
    },
  };
}

/**
 * The system prompt encodes the LOCK: the answerer is the migration's automated
 * spec-shaping decision-maker; it always chooses the most faithful like-for-like
 * answer and NEVER abstains / asks for human input.
 */
function systemMessage(): ArchitectChatMessage {
  return {
    role: 'system',
    content:
      "You are the migration's AUTOMATED spec-shaping decision-maker. A software-" +
      'architect service is shaping an implementation spec for a like-for-like ' +
      'migration of an existing service, and it is asking clarifying questions. ' +
      'There is NO human in the loop: you must answer every question yourself. ' +
      'ALWAYS choose the most faithful like-for-like answer -- reproduce the ' +
      'current-state behaviour exactly unless the spec explicitly states a change. ' +
      'You MUST respond by calling the answer-shape-spec-question tool with a ' +
      'concrete, non-empty answer. NEVER abstain, NEVER reply "I don\'t know", ' +
      'NEVER ask for human input, NEVER defer the decision.',
  };
}

function groundingMessage(specText: string, grounding: string): ArchitectChatMessage {
  return {
    role: 'user',
    content:
      'IMPLEMENTATION-READY SPEC (the primary ground -- the agreed scope, ' +
      `acceptance criteria, and test pack for this story):\n${specText}\n\n` +
      `ADDITIONAL MIGRATION CONTEXT (product/migration goal + discovery findings):\n${grounding}`,
  };
}

function questionMessage(question: ShapeSpecQuestion): ArchitectChatMessage {
  return {
    role: 'user',
    content:
      `The shape-spec service asked: "${question.question}"\n` +
      `Answer it now with the most faithful like-for-like decision. Call the ` +
      `'${SHAPE_SPEC_ANSWER_TOOL}' tool. Do NOT abstain.`,
  };
}

// ---------------------------------------------------------------------------
// Parse + validate the tool call.
// ---------------------------------------------------------------------------

function parseToolArguments(
  call: ArchitectToolCall
): { ok: true; args: Record<string, unknown> } | { ok: false; reason: string } {
  if (!call.function.arguments) {
    return { ok: true, args: {} };
  }
  try {
    const parsed = JSON.parse(call.function.arguments) as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, reason: 'Tool arguments JSON parsed to a non-object value.' };
    }
    return { ok: true, args: parsed as Record<string, unknown> };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `Tool arguments were not valid JSON: ${message}` };
  }
}

function findToolCall(
  response: CallLlmToolLoopResponse,
  toolName: string
): ArchitectToolCall | null {
  const calls = response.message.tool_calls ?? [];
  return calls.find((c) => c.function.name === toolName) ?? null;
}

function asNonEmptyString(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v : null;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface AnswerShapeSpecQuestionsOptions {
  /** The LLM client (mocked at this boundary in all tests). */
  llmClient: ArchitectLlmClient;
  /** The combined `/agent-os:shape-spec ...` body (the primary ground). */
  specText: string;
  /** The composed migration grounding (product/goal + findings). */
  grounding: string;
  /** The `questions` batch off the stream. */
  questions: ShapeSpecQuestion[];
  /** Optional model name forwarded to the LLM relay. */
  model?: string;
  /** Test-only limit overrides (production reads the ARCHITECT_LOOP_* constants). */
  perCallTimeoutMs?: number;
  wallClockMs?: number;
  /** Optional clock for deterministic tests. */
  now?: () => number;
}

// ---------------------------------------------------------------------------
// The bounded single-question round.
// ---------------------------------------------------------------------------

/**
 * A concrete, conservative fallback answer used ONLY when the bounded loop fails
 * (timeout / relay error / malformed). The never-abstain LOCK means the run must
 * still proceed with a real answer string, so we commit to the safest
 * like-for-like default rather than stalling.
 */
function fallbackAnswer(question: ShapeSpecQuestion): ShapeSpecAnswerDecision {
  return {
    question: question.question,
    answer:
      'Preserve the current-state behaviour exactly (like-for-like): keep the ' +
      'existing contract, data shapes, and semantics unchanged for this concern.',
    rationale:
      'Automated like-for-like default applied: the decision model was ' +
      'unavailable within budget, so the most faithful no-change answer was chosen.',
  };
}

async function answerOneQuestion(
  opts: AnswerShapeSpecQuestionsOptions,
  question: ShapeSpecQuestion
): Promise<AnswerLoopResult> {
  const now = opts.now ?? Date.now;
  const perCallTimeoutMs = opts.perCallTimeoutMs ?? ARCHITECT_LOOP_PER_CALL_TIMEOUT_MS;
  const wallClockMs = opts.wallClockMs ?? ARCHITECT_LOOP_WALL_CLOCK_MS;
  const startedAt = now();

  const messages: ArchitectChatMessage[] = [
    systemMessage(),
    groundingMessage(opts.specText, opts.grounding),
    questionMessage(question),
  ];

  let relayResult: CallLlmToolLoopResponse;
  try {
    relayResult = await withTimeout(
      opts.llmClient.callLlmToolLoop({
        messages,
        tools: [answerToolDef()],
        toolChoice: { type: 'function', function: { name: SHAPE_SPEC_ANSWER_TOOL } },
        model: opts.model,
        timeoutMs: perCallTimeoutMs,
      }),
      perCallTimeoutMs,
      `shape-spec-answer:${question.id}`
    );
  } catch (err) {
    if (isTimeoutError(err)) {
      return {
        outcome: 'error',
        errorKind: 'llm-call-timeout',
        errorMessage: `Shape-spec answer for '${question.id}' exceeded the ${perCallTimeoutMs}ms per-call timeout.`,
      };
    }
    const message = err instanceof Error ? err.message : String(err);
    return {
      outcome: 'error',
      errorKind: 'llm-call-failed',
      errorMessage: `Shape-spec answer for '${question.id}' LLM relay call failed: ${message}`,
    };
  }

  if (now() - startedAt >= wallClockMs) {
    return {
      outcome: 'error',
      errorKind: 'wall-clock-exceeded',
      errorMessage: `Shape-spec answer for '${question.id}' wall-clock cap (${wallClockMs}ms) reached.`,
    };
  }

  const call = findToolCall(relayResult, SHAPE_SPEC_ANSWER_TOOL);
  if (!call) {
    return {
      outcome: 'error',
      errorKind: 'tool-output-malformed',
      errorMessage: `Model did not call the required '${SHAPE_SPEC_ANSWER_TOOL}' tool.`,
    };
  }
  const parsed = parseToolArguments(call);
  if (!parsed.ok) {
    return {
      outcome: 'error',
      errorKind: 'tool-output-malformed',
      errorMessage: `Shape-spec answer arguments malformed: ${parsed.reason}`,
    };
  }
  const answer = asNonEmptyString(parsed.args.answer);
  if (!answer) {
    return {
      outcome: 'error',
      errorKind: 'tool-output-malformed',
      errorMessage: 'Shape-spec answer was empty (the answerer must never abstain).',
    };
  }
  const rationale =
    asNonEmptyString(parsed.args.rationale) ?? 'Faithful like-for-like decision.';
  return { outcome: 'ok', payload: { answer, rationale } };
}

// ---------------------------------------------------------------------------
// Public entry: answer a whole batch (one decision per question), NEVER abstain.
// ---------------------------------------------------------------------------

/**
 * Answer every question in a `questions` batch. Returns one
 * {@link ShapeSpecAnswerDecision} per question, IN ORDER -- always a concrete
 * answer (the never-abstain LOCK): on a bounded-loop failure for any single
 * question, a conservative like-for-like fallback answer is substituted (the
 * failure is logged) rather than the run stalling.
 *
 * NEVER throws.
 */
export async function answerShapeSpecQuestions(
  opts: AnswerShapeSpecQuestionsOptions
): Promise<ShapeSpecAnswerDecision[]> {
  const decisions: ShapeSpecAnswerDecision[] = [];
  for (const question of opts.questions) {
    let result: AnswerLoopResult;
    try {
      result = await answerOneQuestion(opts, question);
    } catch (err) {
      // Defensive: answerOneQuestion is never-throw, but the LOCK means we still
      // commit to a fallback rather than propagating.
      logger.warn('[diag-gateway] shape_spec_auto_answerer answer_unexpected_throw', {
        questionId: question.id,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
      decisions.push(fallbackAnswer(question));
      continue;
    }

    if (result.outcome === 'ok') {
      decisions.push({
        question: question.question,
        answer: result.payload.answer,
        rationale: result.payload.rationale,
      });
    } else {
      logger.warn('[diag-gateway] shape_spec_auto_answerer answer_fallback', {
        questionId: question.id,
        errorKind: result.errorKind,
        errorMessage: result.errorMessage,
      });
      decisions.push(fallbackAnswer(question));
    }
  }
  return decisions;
}
