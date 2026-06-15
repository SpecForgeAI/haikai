/**
 * Architect-Conversation LLM Loop Runner — Target State Architect-Persona Conversation
 * (Spec 3, Commit 2)
 *
 * Spec: 2026-05-24-target-state-architect-conversation
 *
 * Simplified gateway-native port of
 * `api-migration-validation-service/src/services/captureLoopRunner.ts` (reference
 * only — NOT a runtime dependency). Drops the diagnostic-emission and redactor
 * concerns from that service (per Q1 option b — those belong to the capture
 * service's audit pipeline, not here) and keeps the load-bearing pattern:
 *
 *   - Multi-round per question with hard limits (Q2):
 *       5 LLM rounds per question
 *       30s per individual LLM call
 *       2-minute wall clock per question
 *   - Tool-call shape mirrored from the OpenAI / Azure OpenAI provider.
 *   - Structured-answer parse-recover pattern: on `parseStructuredAnswer`
 *     rejection, feed the rejection reason back to the LLM as a tool result
 *     so the model can re-issue within budget.
 *   - Stateless driver: takes the library entry + user response + tool
 *     registry + (optional) abort signal, runs to completion per question.
 *
 * Failure modes surface as structured `LoopResult` values, NOT thrown
 * exceptions. The orchestrator (Commit 3) translates each failure shape into
 * the corresponding `error` turn payload in the closed 13-kind turn union
 * (see spec §"Conversation transcript turn shape").
 *
 * IMPORTANT: This commit (Commit 2) wires NO decision capture, NO standards
 * seed-map cascade plumbing, NO mapping mutations. Those land in Commits 3
 * and 4. The runner returns a typed answer (when the LLM submits one) and a
 * cascade proposal payload (when present on the terminal tool call); the
 * orchestrator is the only writer.
 *
 * The LLM is mocked at the `ArchitectLlmClient.callLlmToolLoop` boundary in
 * every test (per Q26). The runner accepts an injected client so production
 * wiring (gateway LLM relay) and tests (mocks) share one type.
 */

import type { QuestionLibraryEntry } from '../../config/architect-conversation/questionLibrary';
import type {
  ArchitectChatMessage,
  ArchitectLlmClient,
  ArchitectToolCall,
  ArchitectToolDefinition,
  CallLlmToolLoopResponse,
} from './architectLlmClient';
import {
  ParsedAnswer,
  parseStructuredAnswer,
} from './structuredAnswerParser';

// ---------------------------------------------------------------------------
// Hard limits (per Q2 — simplified port from
// api-migration-validation-service/src/services/captureLoopRunner.ts)
// ---------------------------------------------------------------------------

/** Max LLM round-trips per question before the loop emits a round-budget error. */
export const ARCHITECT_LOOP_ROUND_LIMIT = 5;

/** Per-individual-LLM-call hard timeout in milliseconds. */
export const ARCHITECT_LOOP_PER_CALL_TIMEOUT_MS = 30_000;

/** Per-question wall-clock cap in milliseconds (2 minutes). */
export const ARCHITECT_LOOP_WALL_CLOCK_MS = 120_000;

/**
 * Case-insensitive markers that short-circuit the LLM entirely and return the
 * library entry's `defaultsWhenUnchanged`. Per spec §"Decision capture flow":
 * the decision is captured (not skipped) — the orchestrator (Commit 3) writes
 * the `defaultsWhenUnchanged` value via Spec 2's POST endpoint.
 */
const NO_CHANGE_MARKERS = new Set(['no change', 'no-change', 'unchanged']);

/**
 * Reserved tool name the LLM uses to submit a parsed structured answer. The
 * runner detects this name in the assistant's `tool_calls` array and treats
 * it as the terminal step (no further rounds). Callers MUST NOT register a
 * handler under this name — `runArchitectQuestionLoop` injects its own
 * recogniser. Reserved tool names are rejected at registry-merge time.
 */
export const SUBMIT_ANSWER_TOOL_NAME = 'submit_structured_answer';

// ---------------------------------------------------------------------------
// Tool registry (pluggable; Commit 3 wires decision-capture + cascade tools)
// ---------------------------------------------------------------------------

export interface ArchitectToolExecutionContext {
  /** The library entry currently being answered. */
  entry: QuestionLibraryEntry;
  /** Conversation round 1-based at the moment the tool was dispatched. */
  roundIndex: number;
}

export type ArchitectToolHandler = (
  args: Record<string, unknown>,
  ctx: ArchitectToolExecutionContext,
) => Promise<unknown>;

export interface ArchitectToolRegistryEntry {
  name: string;
  definition: ArchitectToolDefinition;
  handler: ArchitectToolHandler;
}

// ---------------------------------------------------------------------------
// Result discriminator
// ---------------------------------------------------------------------------

export type LoopErrorKind =
  | 'round-budget-exhausted'
  | 'llm-call-timeout'
  | 'wall-clock-exceeded'
  | 'aborted'
  | 'llm-call-failed'
  | 'submit-answer-malformed';

export interface LoopAnswerOk {
  outcome: 'answer';
  /** The parsed, structured answer the LLM submitted (or the default-when-unchanged value). */
  answerValue: unknown;
  /**
   * Optional cascade proposal payload the LLM attached to its terminal tool
   * call. Shape mirrors the library entry's `cascades[]` for the orchestrator
   * to render a `cascade-summary` turn. NULL when the LLM did not propose
   * cascades (single-question answer with no downstream pre-fill, or the
   * default-when-unchanged short-circuit path).
   */
  proposedCascades: ProposedCascade[] | null;
  roundsUsed: number;
  durationMs: number;
  /** True when the path short-circuited the LLM entirely (no rounds used). */
  defaultUnchangedPath: boolean;
}

export interface LoopErrorResult {
  outcome: 'error';
  errorKind: LoopErrorKind;
  errorMessage: string;
  roundsUsed: number;
  durationMs: number;
  /** Optional hint surfaced to the orchestrator for the `error` turn payload. */
  recoverableHint?: string;
}

export type LoopResult = LoopAnswerOk | LoopErrorResult;

/**
 * Cascade proposal carried back from the LLM's terminal tool call. The
 * `sourceStandardId` is sourced from the library entry's matching cascade
 * declaration at orchestration time (Commit 3) — the LLM proposes
 * `decisionCode` + `value` only.
 */
export interface ProposedCascade {
  decisionCode: string;
  proposedValue: unknown;
}

// ---------------------------------------------------------------------------
// Runner args
// ---------------------------------------------------------------------------

export interface RunArchitectQuestionLoopArgs {
  /** Library entry being answered this round group. */
  entry: QuestionLibraryEntry;
  /**
   * Raw free-text from the user. Special string values trigger the
   * default-when-unchanged short-circuit (see `NO_CHANGE_MARKERS`).
   */
  userResponse: string;
  /**
   * Captured-decisions context so far, resolved via Spec 2's resolver.
   * Forwarded verbatim into the LLM prompt by the runner; opaque to the
   * loop runner itself.
   */
  capturedDecisionsContext: string;
  /**
   * Inline cascade seed map for THIS question (sourced from the library
   * entry's `cascades[]` at orchestration time). Forwarded verbatim.
   */
  inlineCascadeSeedMap: string;
  /** LLM client (mocked at this boundary in all tests per Q26). */
  llmClient: ArchitectLlmClient;
  /**
   * Pluggable tool registry. Group 3 will populate this with decision-capture
   * and cascade-propose tools. The reserved `submit_structured_answer` tool
   * name is rejected if the caller registers it — the runner owns that name.
   */
  tools?: ArchitectToolRegistryEntry[];
  /** Optional external abort signal (e.g. user-cancel from the chat UI). */
  abortSignal?: AbortSignal;
  /** Optional limit overrides (test-only — production reads from the constants). */
  roundLimit?: number;
  perCallTimeoutMs?: number;
  wallClockMs?: number;
  /** Optional model name forwarded to the LLM relay. */
  model?: string;
  /** Optional clock for deterministic tests (defaults to Date.now). */
  now?: () => number;
}

// ---------------------------------------------------------------------------
// withTimeout — synthetic timer race; tagged Error for the runner to detect.
// ---------------------------------------------------------------------------

interface TimeoutTaggedError extends Error {
  __architectLlmTimeout?: boolean;
}

function withTimeout<T>(p: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const err = new Error(
        `LLM call '${label}' exceeded the ${timeoutMs}ms per-call timeout.`,
      ) as TimeoutTaggedError;
      err.__architectLlmTimeout = true;
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
    (err as TimeoutTaggedError).__architectLlmTimeout === true
  );
}

// ---------------------------------------------------------------------------
// Tool definitions injected by the runner
// ---------------------------------------------------------------------------

function buildSubmitAnswerToolDefinition(
  entry: QuestionLibraryEntry,
): ArchitectToolDefinition {
  return {
    type: 'function',
    function: {
      name: SUBMIT_ANSWER_TOOL_NAME,
      description:
        `Submit the final structured answer for decision code '${entry.code}'. ` +
        `The 'value' field MUST match expectedAnswerShape='${entry.expectedAnswerShape}'. ` +
        `Optionally attach 'proposedCascades' as an array of { decisionCode, proposedValue }.`,
      parameters: {
        type: 'object',
        properties: {
          value: {
            description:
              'The parsed answer payload. For single-choice/multi-choice this MUST be a member of the entry choices.',
          },
          proposedCascades: {
            type: 'array',
            description:
              'Optional cascade proposals. Each entry: { decisionCode, proposedValue }.',
            items: {
              type: 'object',
              properties: {
                decisionCode: { type: 'string' },
                proposedValue: {},
              },
              required: ['decisionCode'],
            },
          },
        },
        required: ['value'],
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Prompt assembly
// ---------------------------------------------------------------------------

function buildInitialMessages(args: RunArchitectQuestionLoopArgs): ArchitectChatMessage[] {
  const { entry, userResponse, capturedDecisionsContext, inlineCascadeSeedMap } = args;

  // Per Q17: the prompt string itself is NEVER paraphrased. If a
  // `discoveryContextLead` is present it is prepended verbatim. The library
  // entry's `prompt` string is forwarded as-is to the LLM.
  const promptWithLead = entry.discoveryContextLead
    ? `${entry.discoveryContextLead}\n\n${entry.prompt}`
    : entry.prompt;

  const systemMessage: ArchitectChatMessage = {
    role: 'system',
    content:
      `You are the architect-conversation assistant for decision code '${entry.code}'. ` +
      `Parse the user's free-text response into a structured answer matching ` +
      `expectedAnswerShape='${entry.expectedAnswerShape}'` +
      (entry.choices ? ` with allowed values ${JSON.stringify(entry.choices)}` : '') +
      `. When the answer is unambiguous, call the '${SUBMIT_ANSWER_TOOL_NAME}' tool. ` +
      `When uncertain, you MAY use registered tools to gather more context within the round budget.`,
  };

  const userMessage: ArchitectChatMessage = {
    role: 'user',
    content:
      `Question prompt (DO NOT paraphrase):\n${promptWithLead}\n\n` +
      `User response:\n${userResponse}\n\n` +
      `Captured-decisions context so far:\n${capturedDecisionsContext}\n\n` +
      `Inline cascade seed map for this question:\n${inlineCascadeSeedMap}`,
  };

  return [systemMessage, userMessage];
}

// ---------------------------------------------------------------------------
// Tool registry build
// ---------------------------------------------------------------------------

function buildRegistry(
  callerTools: ArchitectToolRegistryEntry[] | undefined,
): {
  registry: Map<string, ArchitectToolHandler>;
  definitions: ArchitectToolDefinition[];
  reservedNameConflict: string | null;
} {
  const registry = new Map<string, ArchitectToolHandler>();
  const definitions: ArchitectToolDefinition[] = [];
  let reservedNameConflict: string | null = null;

  if (callerTools) {
    for (const t of callerTools) {
      if (t.name === SUBMIT_ANSWER_TOOL_NAME) {
        reservedNameConflict = t.name;
        continue;
      }
      registry.set(t.name, t.handler);
      definitions.push(t.definition);
    }
  }
  return { registry, definitions, reservedNameConflict };
}

// ---------------------------------------------------------------------------
// Argument parsing for tool calls (errors are fed back to the LLM)
// ---------------------------------------------------------------------------

function parseToolArguments(call: ArchitectToolCall): {
  ok: true;
  args: Record<string, unknown>;
} | {
  ok: false;
  reason: string;
} {
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

function buildToolResultMessage(call: ArchitectToolCall, content: string): ArchitectChatMessage {
  return {
    role: 'tool',
    tool_call_id: call.id,
    name: call.function.name,
    content,
  };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function runArchitectQuestionLoop(
  args: RunArchitectQuestionLoopArgs,
): Promise<LoopResult> {
  const now = args.now ?? Date.now;
  const roundLimit = args.roundLimit ?? ARCHITECT_LOOP_ROUND_LIMIT;
  const perCallTimeoutMs = args.perCallTimeoutMs ?? ARCHITECT_LOOP_PER_CALL_TIMEOUT_MS;
  const wallClockMs = args.wallClockMs ?? ARCHITECT_LOOP_WALL_CLOCK_MS;

  const startedAt = now();

  // -----------------------------------------------------------------------
  // Default-when-unchanged short-circuit — no LLM round consumed.
  // -----------------------------------------------------------------------
  const normalised = args.userResponse.trim().toLowerCase();
  if (NO_CHANGE_MARKERS.has(normalised)) {
    return {
      outcome: 'answer',
      answerValue: args.entry.defaultsWhenUnchanged,
      proposedCascades: null,
      roundsUsed: 0,
      durationMs: now() - startedAt,
      defaultUnchangedPath: true,
    };
  }

  // -----------------------------------------------------------------------
  // Pre-loop pre-flight: aborted up-front, registry name conflicts.
  // -----------------------------------------------------------------------
  if (args.abortSignal?.aborted) {
    return {
      outcome: 'error',
      errorKind: 'aborted',
      errorMessage: 'Loop aborted before first round via external signal.',
      roundsUsed: 0,
      durationMs: now() - startedAt,
    };
  }

  const { registry, definitions, reservedNameConflict } = buildRegistry(args.tools);
  if (reservedNameConflict) {
    return {
      outcome: 'error',
      errorKind: 'submit-answer-malformed',
      errorMessage:
        `Caller registered a tool named '${reservedNameConflict}' which is reserved by the runner.`,
      roundsUsed: 0,
      durationMs: now() - startedAt,
      recoverableHint: `Rename the tool away from '${SUBMIT_ANSWER_TOOL_NAME}' and retry.`,
    };
  }

  const submitTool = buildSubmitAnswerToolDefinition(args.entry);
  const allToolDefinitions: ArchitectToolDefinition[] = [submitTool, ...definitions];

  const messages: ArchitectChatMessage[] = buildInitialMessages(args);
  let roundsUsed = 0;

  while (true) {
    // ---- Abort between rounds ----
    if (args.abortSignal?.aborted) {
      return {
        outcome: 'error',
        errorKind: 'aborted',
        errorMessage: `Loop aborted after ${roundsUsed} round(s) via external signal.`,
        roundsUsed,
        durationMs: now() - startedAt,
      };
    }

    // ---- Wall-clock ----
    const elapsed = now() - startedAt;
    if (elapsed >= wallClockMs) {
      return {
        outcome: 'error',
        errorKind: 'wall-clock-exceeded',
        errorMessage:
          `Per-question wall-clock cap (${wallClockMs}ms) reached after ${roundsUsed} round(s).`,
        roundsUsed,
        durationMs: elapsed,
      };
    }

    // ---- Round-budget ----
    if (roundsUsed >= roundLimit) {
      return {
        outcome: 'error',
        errorKind: 'round-budget-exhausted',
        errorMessage:
          `Round budget (${roundLimit}) exhausted without a terminal '${SUBMIT_ANSWER_TOOL_NAME}' call.`,
        roundsUsed,
        durationMs: now() - startedAt,
      };
    }

    // ---- LLM round-trip ----
    let relayResult: CallLlmToolLoopResponse;
    try {
      relayResult = await withTimeout(
        args.llmClient.callLlmToolLoop({
          messages,
          tools: allToolDefinitions,
          toolChoice: 'auto',
          model: args.model,
          timeoutMs: perCallTimeoutMs,
        }),
        perCallTimeoutMs,
        `architect-conversation:${args.entry.code}:round${roundsUsed + 1}`,
      );
    } catch (err) {
      if (isTimeoutError(err)) {
        return {
          outcome: 'error',
          errorKind: 'llm-call-timeout',
          errorMessage:
            `LLM call exceeded the ${perCallTimeoutMs}ms per-call timeout on round ${roundsUsed + 1}.`,
          roundsUsed: roundsUsed + 1,
          durationMs: now() - startedAt,
        };
      }
      const message = err instanceof Error ? err.message : String(err);
      return {
        outcome: 'error',
        errorKind: 'llm-call-failed',
        errorMessage: `LLM relay call failed on round ${roundsUsed + 1}: ${message}`,
        roundsUsed: roundsUsed + 1,
        durationMs: now() - startedAt,
      };
    }
    roundsUsed += 1;

    const assistant = relayResult.message;
    messages.push({
      role: 'assistant',
      content: assistant.content,
      tool_calls: assistant.tool_calls,
    });

    const toolCalls = assistant.tool_calls ?? [];

    if (toolCalls.length === 0) {
      // The assistant returned a free-form message without calling the
      // submit tool. Surface a tool-style nudge as a synthetic user prompt
      // and let the next round handle it (within budget). This matches the
      // structured-output parse-recover pattern of captureLoopRunner.
      messages.push({
        role: 'user',
        content:
          `No tool call detected. You MUST call '${SUBMIT_ANSWER_TOOL_NAME}' with the parsed answer ` +
          `or use a registered tool to gather more context. Try again.`,
      });
      continue;
    }

    // ---- Dispatch each tool call ----
    let answerSubmitted: { value: unknown; proposedCascades: ProposedCascade[] | null } | null = null;
    let answerRejectionReason: string | null = null;

    for (const call of toolCalls) {
      // Reserved terminal tool — parse and validate.
      if (call.function.name === SUBMIT_ANSWER_TOOL_NAME) {
        const parsedArgs = parseToolArguments(call);
        if (!parsedArgs.ok) {
          messages.push(
            buildToolResultMessage(
              call,
              JSON.stringify({ accepted: false, reason: parsedArgs.reason }),
            ),
          );
          answerRejectionReason = parsedArgs.reason;
          continue;
        }
        const rawValue = (parsedArgs.args as { value?: unknown }).value;
        const validated: ParsedAnswer = parseStructuredAnswer(rawValue, args.entry);
        if (!validated.ok) {
          messages.push(
            buildToolResultMessage(
              call,
              JSON.stringify({ accepted: false, reason: validated.reason }),
            ),
          );
          answerRejectionReason = validated.reason;
          continue;
        }

        const cascadesRaw = (parsedArgs.args as { proposedCascades?: unknown }).proposedCascades;
        const cascades = normaliseProposedCascades(cascadesRaw);

        messages.push(
          buildToolResultMessage(call, JSON.stringify({ accepted: true })),
        );
        answerSubmitted = { value: validated.value, proposedCascades: cascades };
        // Continue the for-loop to drain remaining tool calls (they'll be
        // best-effort, but the terminal answer is locked).
        continue;
      }

      // Registered tool dispatch.
      const handler = registry.get(call.function.name);
      if (!handler) {
        messages.push(
          buildToolResultMessage(
            call,
            JSON.stringify({ error: `Unknown tool '${call.function.name}'.` }),
          ),
        );
        continue;
      }

      const parsedArgs = parseToolArguments(call);
      if (!parsedArgs.ok) {
        messages.push(
          buildToolResultMessage(
            call,
            JSON.stringify({ error: parsedArgs.reason }),
          ),
        );
        continue;
      }

      try {
        const ctx: ArchitectToolExecutionContext = {
          entry: args.entry,
          roundIndex: roundsUsed,
        };
        const toolResult = await withTimeout(
          handler(parsedArgs.args, ctx),
          perCallTimeoutMs,
          `architect-conversation:tool:${call.function.name}`,
        );
        messages.push(buildToolResultMessage(call, JSON.stringify(toolResult ?? null)));
      } catch (err) {
        if (isTimeoutError(err)) {
          return {
            outcome: 'error',
            errorKind: 'llm-call-timeout',
            errorMessage:
              `Tool '${call.function.name}' exceeded the ${perCallTimeoutMs}ms timeout.`,
            roundsUsed,
            durationMs: now() - startedAt,
          };
        }
        const message = err instanceof Error ? err.message : String(err);
        // Tool runtime errors are fed back to the LLM so it can recover within
        // budget — mirrors captureLoopRunner's recoverable-error pattern.
        messages.push(
          buildToolResultMessage(
            call,
            JSON.stringify({ error: { reason: 'tool_runtime_error', message } }),
          ),
        );
      }
    }

    if (answerSubmitted) {
      return {
        outcome: 'answer',
        answerValue: answerSubmitted.value,
        proposedCascades: answerSubmitted.proposedCascades,
        roundsUsed,
        durationMs: now() - startedAt,
        defaultUnchangedPath: false,
      };
    }

    // If we got here, the LLM either issued non-terminal tool calls (gathering
    // context) or attempted a terminal submit that failed validation. Either
    // way the loop iterates — limits will catch runaway loops.
    if (answerRejectionReason !== null) {
      // Append an explicit nudge so the LLM sees the rejection as a
      // user-context message rather than only via the tool result.
      messages.push({
        role: 'user',
        content:
          `Your previous '${SUBMIT_ANSWER_TOOL_NAME}' call was rejected: ${answerRejectionReason} ` +
          `Re-issue the call with a valid value.`,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Cascade payload normaliser
// ---------------------------------------------------------------------------

function normaliseProposedCascades(raw: unknown): ProposedCascade[] | null {
  if (raw === undefined || raw === null) return null;
  if (!Array.isArray(raw)) return null;
  const out: ProposedCascade[] = [];
  for (const candidate of raw as unknown[]) {
    if (!candidate || typeof candidate !== 'object') continue;
    const obj = candidate as Record<string, unknown>;
    const decisionCode = typeof obj.decisionCode === 'string' ? obj.decisionCode : null;
    if (!decisionCode) continue;
    out.push({
      decisionCode,
      proposedValue: obj.proposedValue,
    });
  }
  return out.length > 0 ? out : null;
}
