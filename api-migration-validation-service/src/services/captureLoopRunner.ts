import {
  LLM_SCENARIO_ROUND_LIMIT,
  LLM_SCENARIO_WALL_CLOCK_MS,
  LLM_TOOL_CALL_TIMEOUT_MS,
} from '../config';
import { gatewayClient as defaultGatewayClient, GatewayClient, LlmRelayError } from './gatewayClient';
import { archModelClient as defaultArchModelClient } from './archModelClient';
import { redactJson } from './redactor';
import {
  ALL_TOOLS,
  buildToolDefinitions,
  buildToolRegistry,
  ToolValidationError,
} from './tools';
import type { ToolExecutionContext, ToolRegistryEntry } from './tools';
import type {
  AssistantMessage,
  ChatMessage,
  ToolCall,
} from '../types/llm';

/**
 * Per-scenario LLM tool-call loop. Mediates the conversation between the
 * gateway-relayed LLM and the eight tools registered in `tools/index.ts`.
 *
 * Hard limits enforced (from `config.ts`, all spec-fixed):
 *   - 12 rounds per scenario        -> `retry_exhausted` diagnostic
 *   - 30s per individual tool call  -> `llm_generation_failure` diagnostic
 *   - 5min wall-clock per scenario  -> scenario marked `executed_error`
 *
 * On any limit breach: emit the appropriate diagnostic via
 * `archModelClient.createDiagnostic`, mark the scenario `executed_error`
 * (left to the orchestrator -- this runner returns a `LoopOutcome` shape so
 * the caller can decide), and continue. The runner NEVER aborts the
 * session-wide run on a single scenario failure.
 *
 * The LLM is the planner. It NEVER executes HTTP or SQL directly -- only by
 * emitting `tool_calls` against the registered tools. This module's
 * `executeToolCall` is the only path from an assistant message to a side
 * effect.
 *
 * Spec: 2026-05-15 API Behaviour Baseline Capture Service -- Task Group 5.
 */

export type LoopOutcomeReason =
  | 'completed'
  | 'round_limit_exhausted'
  | 'wall_clock_exceeded'
  | 'tool_call_timeout'
  | 'llm_relay_error'
  // The provider's per-DAY token quota is exhausted (Spec 2026-07-22). Terminal
  // and non-retryable: the orchestrator stops the whole capture on this.
  | 'llm_daily_limit'
  // The fired-attempt budget against the TARGET operation is exhausted
  // (2026-08-08 closure budget fix): the operator's "attempts" number counts
  // requests actually fired at the target, never research tool calls.
  | 'attempt_budget_exhausted'
  | 'cancelled';

export interface LoopOutcome {
  reason: LoopOutcomeReason;
  /** Number of LLM round-trips actually issued before termination. */
  roundsUsed: number;
  /**
   * Number of `execute_http_request` calls fired at the target operation
   * (always 0 when no `firedAttemptBudget` was configured).
   */
  firedAttempts: number;
  /** Wall-clock duration of the scenario in milliseconds. */
  durationMs: number;
  /** Final assistant message (if any -- absent if loop never reached one). */
  finalMessage: AssistantMessage | null;
  /** Diagnostic id emitted on limit breach (null on `completed`). */
  diagnosticId: string | null;
  /** Last error if the loop terminated abnormally. */
  errorMessage: string | null;
}

export interface RunScenarioArgs {
  /** Pre-built execution context shared across all tool invocations. */
  context: ToolExecutionContext;
  /** Initial messages -- system prompt, scenario prompt, etc. */
  initialMessages: ChatMessage[];
  /** Optional override of the tool list (test-only). */
  tools?: ReadonlyArray<ToolRegistryEntry>;
  /** Optional override of the gateway client (test-only). */
  gatewayClient?: Pick<GatewayClient, 'callLlmToolLoop'>;
  /** Optional override of arch-model client (test-only). */
  archModelClient?: { createDiagnostic: typeof defaultArchModelClient.createDiagnostic };
  /** Optional limit overrides (test-only -- production reads from config). */
  roundLimit?: number;
  toolCallTimeoutMs?: number;
  scenarioWallClockMs?: number;
  /** Optional model name forwarded to the LLM relay. */
  model?: string;
  /**
   * Optional per-session abort signal. When provided and aborted (e.g. via
   * `runManager.cancel(sessionId)`), the loop terminates between rounds
   * with a `cancelled` diagnostic and returns `LoopOutcome.reason='cancelled'`.
   */
  abortSignal?: AbortSignal;
  /**
   * Optional fired-attempt budget (2026-08-08 closure budget fix): counts
   * ONLY `execute_http_request` calls whose method + path hit the TARGET
   * operation (template match — `/orders/12345` counts against
   * `/orders/{id}`). Research tools (contract reading, DB sampling, source
   * search) and requests at OTHER endpoints (list fetches, create-then-act
   * prerequisites) are free. When the (max+1)th matching call arrives it is
   * refused with an explanatory tool error and the loop terminates with
   * `attempt_budget_exhausted` after the round completes.
   */
  firedAttemptBudget?: {
    method: string;
    pathTemplate: string;
    maxAttempts: number;
  };
}

/**
 * Segment-wise template match for the fired-attempt budget: a `{param}` /
 * `:param` template segment matches exactly one non-empty concrete segment;
 * literal segments compare case-insensitively. An exact string match short
 * circuits (covers non-templated operations).
 */
export function pathHitsTemplate(concretePath: string, templatePath: string): boolean {
  const norm = (p: string): string[] =>
    (p || '').split('?')[0].split('/').filter((s) => s.length > 0);
  const concrete = norm(concretePath);
  const template = norm(templatePath);
  if (concrete.length !== template.length) return false;
  return template.every((tSeg, i) => {
    if (/^\{.+\}$/.test(tSeg) || tSeg.startsWith(':')) return concrete[i].length > 0;
    return tSeg.toLowerCase() === concrete[i].toLowerCase();
  });
}

/**
 * Promise.race against a timer: resolves with the wrapped promise if it
 * settles first, throws a synthetic Error tagged `__toolCallTimeout` if
 * the timer fires. The runner catches the tagged error and emits the
 * `llm_generation_failure` diagnostic.
 */
function withTimeout<T>(p: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`Tool call '${label}' exceeded the ${timeoutMs}ms timeout.`) as Error & { __toolCallTimeout?: boolean };
      err.__toolCallTimeout = true;
      reject(err);
    }, timeoutMs);
  });
  return Promise.race([p, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}

/**
 * Run a single per-scenario LLM tool-call loop. Returns a `LoopOutcome`
 * describing termination cause; the orchestrator decides what to do with
 * the scenario (mark `executed_success`, `executed_error`, etc).
 */
export async function runScenarioLoop(args: RunScenarioArgs): Promise<LoopOutcome> {
  const {
    context,
    initialMessages,
    tools = ALL_TOOLS,
    gatewayClient = defaultGatewayClient,
    archModelClient = defaultArchModelClient,
    roundLimit = LLM_SCENARIO_ROUND_LIMIT,
    toolCallTimeoutMs = LLM_TOOL_CALL_TIMEOUT_MS,
    scenarioWallClockMs = LLM_SCENARIO_WALL_CLOCK_MS,
    model,
    abortSignal,
    firedAttemptBudget,
  } = args;

  const registry = buildToolRegistry(tools);
  const toolDefinitions = buildToolDefinitions(tools);

  const startedAt = Date.now();
  const messages: ChatMessage[] = [...initialMessages];
  let roundsUsed = 0;
  let firedAttempts = 0;
  let finalMessage: AssistantMessage | null = null;

  /** True when a tool call fires at the budget's target operation. */
  const hitsTarget = (parsedArgs: Record<string, unknown>): boolean => {
    if (!firedAttemptBudget) return false;
    const method = typeof parsedArgs.method === 'string' ? parsedArgs.method : '';
    const path = typeof parsedArgs.path === 'string' ? parsedArgs.path : '';
    return (
      method.toUpperCase() === firedAttemptBudget.method.toUpperCase() &&
      pathHitsTemplate(path, firedAttemptBudget.pathTemplate)
    );
  };

  while (true) {
    // ---- Cancellation: per-session abort signal raised between rounds ----
    if (abortSignal?.aborted) {
      const diagnosticId = await safeRecordDiagnostic(archModelClient, context, {
        diagnostic_type: 'retry_exhausted',
        message: `Scenario cancelled after ${roundsUsed} rounds via session abort signal.`,
        detail_json: { reason: 'cancelled', roundsUsed },
      });
      return {
        reason: 'cancelled',
        roundsUsed,
        firedAttempts,
        durationMs: Date.now() - startedAt,
        finalMessage,
        diagnosticId,
        errorMessage: `Scenario cancelled after ${roundsUsed} rounds.`,
      };
    }

    // ---- Limit 1: wall-clock cap (5 minutes per scenario) ----
    const elapsed = Date.now() - startedAt;
    if (elapsed >= scenarioWallClockMs) {
      const diagnosticId = await safeRecordDiagnostic(archModelClient, context, {
        diagnostic_type: 'retry_exhausted',
        message: `Scenario wall-clock cap (${scenarioWallClockMs}ms) reached after ${roundsUsed} rounds; aborting scenario.`,
        detail_json: { reason: 'wall_clock_exceeded', roundsUsed, scenarioWallClockMs },
      });
      return {
        reason: 'wall_clock_exceeded',
        roundsUsed,
        firedAttempts,
        durationMs: Date.now() - startedAt,
        finalMessage,
        diagnosticId,
        errorMessage: `Scenario wall-clock exceeded after ${roundsUsed} rounds.`,
      };
    }

    // ---- Limit 2: round-count cap (12 rounds per scenario) ----
    if (roundsUsed >= roundLimit) {
      const diagnosticId = await safeRecordDiagnostic(archModelClient, context, {
        diagnostic_type: 'retry_exhausted',
        message: `Scenario round-count cap (${roundLimit} rounds) reached without a terminal tool call; aborting scenario.`,
        detail_json: { reason: 'round_limit_exhausted', roundsUsed, roundLimit },
      });
      return {
        reason: 'round_limit_exhausted',
        roundsUsed,
        firedAttempts,
        durationMs: Date.now() - startedAt,
        finalMessage,
        diagnosticId,
        errorMessage: `Scenario aborted after ${roundsUsed} rounds (limit ${roundLimit}).`,
      };
    }

    // ---- LLM round-trip via gateway relay ----
    let assistant: AssistantMessage;
    try {
      // The gateway is itself a thin pass-through; cap the per-round HTTP
      // wait by `toolCallTimeoutMs` so a hung provider doesn't burn a
      // whole tool-call slot.
      const relayResult = await gatewayClient.callLlmToolLoop({
        messages,
        tools: toolDefinitions,
        toolChoice: 'auto',
        model,
        timeoutMs: toolCallTimeoutMs,
      });
      assistant = relayResult.message;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Per-DAY provider quota (Spec 2026-07-22): terminal + non-retryable.
      // Return a distinct outcome so the orchestrator STOPS the whole capture
      // (the operator resumes after reset via "Retry uncovered APIs").
      const isDailyLimit =
        err instanceof LlmRelayError && err.reason === 'llm_daily_limit';
      const diagnosticId = await safeRecordDiagnostic(archModelClient, context, {
        diagnostic_type: 'llm_generation_failure',
        message: isDailyLimit
          ? `LLM per-day token quota reached in round ${roundsUsed + 1}: ${message}`
          : `LLM relay call failed in round ${roundsUsed + 1}: ${message}`,
        detail_json: {
          reason: isDailyLimit ? 'llm_daily_limit' : 'llm_relay_error',
          roundsUsed: roundsUsed + 1,
        },
      });
      return {
        reason: isDailyLimit ? 'llm_daily_limit' : 'llm_relay_error',
        roundsUsed: roundsUsed + 1,
        firedAttempts,
        durationMs: Date.now() - startedAt,
        finalMessage,
        diagnosticId,
        errorMessage: message,
      };
    }
    roundsUsed += 1;
    finalMessage = assistant;
    messages.push({
      role: 'assistant',
      content: assistant.content,
      tool_calls: assistant.tool_calls,
    });

    const toolCalls = assistant.tool_calls ?? [];

    // ---- Termination: assistant returns no tool calls (final answer) ----
    if (toolCalls.length === 0) {
      return {
        reason: 'completed',
        roundsUsed,
        firedAttempts,
        durationMs: Date.now() - startedAt,
        finalMessage,
        diagnosticId: null,
        errorMessage: null,
      };
    }

    // ---- Dispatch each tool call ----
    let terminalCalled = false;
    let attemptBudgetExhausted = false;
    for (const call of toolCalls) {
      const tool = registry.get(call.function.name);
      let resultText: string;
      if (!tool) {
        // Unknown tool -- feed an error back to the LLM so it can recover.
        resultText = JSON.stringify({
          error: `Unknown tool '${call.function.name}'.`,
        });
      } else {
        // Parse arguments. Malformed JSON arguments come back as a tool
        // error rather than aborting the scenario -- the LLM gets a chance
        // to re-issue the call with valid JSON.
        let parsedArgs: Record<string, unknown> = {};
        try {
          parsedArgs = call.function.arguments
            ? (JSON.parse(call.function.arguments) as Record<string, unknown>)
            : {};
        } catch (err) {
          resultText = JSON.stringify({
            error: 'Tool call arguments were not valid JSON.',
            detail: err instanceof Error ? err.message : String(err),
          });
          messages.push(buildToolMessage(call, resultText));
          continue;
        }

        // ---- Fired-attempt budget (2026-08-08): only requests fired at the
        // TARGET operation consume the budget; research stays free. The over-
        // budget call is refused (never silently fired) and ends the loop
        // after this round so every tool call still gets a response.
        if (
          firedAttemptBudget &&
          tool.name === 'execute_http_request' &&
          hitsTarget(parsedArgs)
        ) {
          if (firedAttempts >= firedAttemptBudget.maxAttempts) {
            attemptBudgetExhausted = true;
            resultText = JSON.stringify({
              error: {
                reason: 'attempt_budget_exhausted',
                message:
                  `The fired-attempt budget (${firedAttemptBudget.maxAttempts}) for ` +
                  `${firedAttemptBudget.method.toUpperCase()} ${firedAttemptBudget.pathTemplate} ` +
                  'is exhausted; this request was NOT sent.',
              },
            });
            messages.push(buildToolMessage(call, resultText));
            continue;
          }
          firedAttempts += 1;
        }

        try {
          // Per-tool 30s hard cap. Breach => emit `llm_generation_failure`
          // diagnostic and abort the scenario.
          const raw = await withTimeout(
            tool.handler(parsedArgs, context),
            toolCallTimeoutMs,
            tool.name,
          );
          // Redaction-before-LLM contract: the runner is the choke point.
          // Even tools that already redact internally pass through here so
          // there is exactly one trusted boundary.
          const safe = redactJson(raw);
          resultText = JSON.stringify(safe);
          if (tool.terminal) terminalCalled = true;
        } catch (err) {
          const isTimeout = (err as { __toolCallTimeout?: boolean }).__toolCallTimeout === true;
          if (isTimeout) {
            const diagnosticId = await safeRecordDiagnostic(archModelClient, context, {
              diagnostic_type: 'llm_generation_failure',
              message: `Tool '${tool.name}' exceeded the ${toolCallTimeoutMs}ms per-call timeout.`,
              detail_json: { reason: 'tool_call_timeout', tool: tool.name, toolCallTimeoutMs },
            });
            return {
              reason: 'tool_call_timeout',
              roundsUsed,
              firedAttempts,
              durationMs: Date.now() - startedAt,
              finalMessage,
              diagnosticId,
              errorMessage: `Tool '${tool.name}' timed out at ${toolCallTimeoutMs}ms.`,
            };
          }
          // Validation / runtime errors are fed back to the LLM as a tool
          // result so the model can recover (request a different tool /
          // narrower args). This is intentional -- the spec wants the
          // model to learn from constrained errors, NOT have the loop
          // hard-fail on every tool throw.
          const reason = err instanceof ToolValidationError ? err.reason : 'tool_runtime_error';
          const message = err instanceof Error ? err.message : String(err);
          resultText = JSON.stringify({
            error: { reason, message },
          });
        }
      }
      messages.push(buildToolMessage(call, resultText));
    }

    if (terminalCalled) {
      return {
        reason: 'completed',
        roundsUsed,
        firedAttempts,
        durationMs: Date.now() - startedAt,
        finalMessage,
        diagnosticId: null,
        errorMessage: null,
      };
    }

    if (attemptBudgetExhausted && firedAttemptBudget) {
      const diagnosticId = await safeRecordDiagnostic(archModelClient, context, {
        diagnostic_type: 'retry_exhausted',
        message:
          `Fired-attempt budget (${firedAttemptBudget.maxAttempts}) for ` +
          `${firedAttemptBudget.method.toUpperCase()} ${firedAttemptBudget.pathTemplate} ` +
          `exhausted after ${roundsUsed} rounds.`,
        detail_json: {
          reason: 'attempt_budget_exhausted',
          roundsUsed,
          firedAttempts,
          maxAttempts: firedAttemptBudget.maxAttempts,
        },
      });
      return {
        reason: 'attempt_budget_exhausted',
        roundsUsed,
        firedAttempts,
        durationMs: Date.now() - startedAt,
        finalMessage,
        diagnosticId,
        errorMessage: `Fired-attempt budget exhausted after ${firedAttempts} attempts.`,
      };
    }
  }
}

function buildToolMessage(call: ToolCall, content: string): ChatMessage {
  return {
    role: 'tool',
    tool_call_id: call.id,
    name: call.function.name,
    content,
  };
}

/**
 * Best-effort diagnostic write. NEVER throws -- a failing diagnostic must
 * not break the loop teardown. Returns the new diagnostic id, or null on
 * failure (logged).
 */
async function safeRecordDiagnostic(
  client: { createDiagnostic: typeof defaultArchModelClient.createDiagnostic },
  ctx: ToolExecutionContext,
  body: { diagnostic_type: string; message: string; detail_json: unknown },
): Promise<string | null> {
  try {
    const created = await client.createDiagnostic(ctx.session.projectId, {
      session_id: ctx.session.id,
      operation_id: null,
      scenario_id: ctx.currentScenarioId,
      diagnostic_type: body.diagnostic_type as Parameters<typeof defaultArchModelClient.createDiagnostic>[1]['diagnostic_type'],
      message: body.message,
      detail_json: body.detail_json,
    });
    return created.id;
  } catch (err) {
    console.error(
      `[captureLoopRunner] Failed to record diagnostic: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}
