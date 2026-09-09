/**
 * LLM tool loop for ROUTINE scenarios (Spec 3, 2026-09-09).
 *
 * A DB-native sibling of `captureLoopRunner.runScenarioLoop`: the same
 * mechanics (relay round-trips, tool registry, research rounds free against
 * the budget cap, wall clock, abort, terminal tool) over a proc-specific
 * context — no OAS inventory, no HTTP executor, no API session. Kept
 * separate on purpose (DB-only migrations must not depend on the API path).
 */

import { gatewayClient as defaultGatewayClient, type GatewayClient } from '../gatewayClient';
import { redactJson } from '../redactor';
import type { AssistantMessage, ChatMessage, ToolDefinition } from '../../types/llm';
import { ToolValidationError } from '../tools/toolTypes';
import type { DbAdapter } from '../db/DbAdapter';
import type { RoutineInvocationEnvelope } from '../db/routineEnvelope';
import type { ProcBehaviourClientSurface } from '../procBehaviourClient';
import type { ScenarioPlan } from './routineScenarioSeeds';
import type { ProcScenarioDto, RoutineCatalogRow } from './types';

export interface ProcFireResult {
  capture_id: string | null;
  envelopes: RoutineInvocationEnvelope[];
  state_delta: Record<string, unknown> | null;
  bracket: string;
  accepted: boolean;
  refused_reason: string | null;
}

export interface ProcToolContext {
  projectId: string;
  architectureId: string;
  sessionId: string;
  routine: RoutineCatalogRow;
  routinesByName: Map<string, RoutineCatalogRow>;
  dbAdapter: DbAdapter | null;
  limits: { maxRows: number; timeoutSeconds: number };
  plan: ScenarioPlan;
  currentScenarioId: string | null;
  attemptsFired: number;
  attemptsBudget: number;
  learnedFacts: string[];
  client: ProcBehaviourClientSurface;
  /** Orchestrator-owned: brackets, fires, persists the capture, returns the envelope(s). */
  fire: (args: { scenario: ProcScenarioDto }) => Promise<ProcFireResult>;
  noteSink: { last: string | null };
}

export type ProcToolHandler = (args: Record<string, unknown>, ctx: ProcToolContext) => Promise<unknown>;

export interface ProcToolEntry {
  name: string;
  description: string;
  parameters: { type: 'object'; properties: Record<string, unknown>; required?: string[]; additionalProperties?: boolean };
  handler: ProcToolHandler;
  terminal?: boolean;
  research?: boolean;
}

export type ProcLoopReason =
  | 'completed'
  | 'round_limit_exhausted'
  | 'wall_clock_exceeded'
  | 'tool_call_timeout'
  | 'llm_relay_error'
  | 'llm_daily_limit'
  | 'attempt_budget_exhausted'
  | 'cancelled';

export interface ProcLoopOutcome {
  reason: ProcLoopReason;
  roundsUsed: number;
  researchRounds: number;
  firedAttempts: number;
  durationMs: number;
  errorMessage: string | null;
  finalMessage: AssistantMessage | null;
}

export interface RunProcScenarioLoopArgs {
  context: ProcToolContext;
  initialMessages: ChatMessage[];
  tools: ReadonlyArray<ProcToolEntry>;
  gatewayClient?: Pick<GatewayClient, 'callLlmToolLoop'>;
  roundLimit: number;
  researchRoundCeiling: number;
  toolCallTimeoutMs: number;
  scenarioWallClockMs: number;
  model?: string;
  abortSignal?: AbortSignal;
}

export function buildProcToolDefinitions(tools: ReadonlyArray<ProcToolEntry>): ToolDefinition[] {
  return tools.map((t) => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

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

export class ProcAttemptBudgetExhausted extends Error {
  constructor(budget: number) {
    super(`The fired-attempt budget for this scenario (${budget}) is exhausted; close the scenario with record_routine_note.`);
    this.name = 'ProcAttemptBudgetExhausted';
  }
}

export async function runProcScenarioLoop(args: RunProcScenarioLoopArgs): Promise<ProcLoopOutcome> {
  const {
    context,
    initialMessages,
    tools,
    gatewayClient = defaultGatewayClient,
    roundLimit,
    researchRoundCeiling,
    toolCallTimeoutMs,
    scenarioWallClockMs,
    model,
    abortSignal,
  } = args;
  const registry = new Map(tools.map((t) => [t.name, t]));
  const definitions = buildProcToolDefinitions(tools);
  const messages: ChatMessage[] = [...initialMessages];
  const startedAt = Date.now();
  let roundsUsed = 0;
  let researchRounds = 0;
  let finalMessage: AssistantMessage | null = null;
  const outcome = (reason: ProcLoopReason, errorMessage: string | null): ProcLoopOutcome => ({
    reason,
    roundsUsed,
    researchRounds,
    firedAttempts: context.attemptsFired,
    durationMs: Date.now() - startedAt,
    errorMessage,
    finalMessage,
  });

  while (true) {
    if (abortSignal?.aborted) return outcome('cancelled', 'Scenario cancelled via session abort signal.');
    if (Date.now() - startedAt > scenarioWallClockMs) return outcome('wall_clock_exceeded', `Scenario wall-clock exceeded after ${roundsUsed} rounds.`);
    const budgetRounds = roundsUsed - researchRounds;
    if (budgetRounds >= roundLimit) {
      return outcome('round_limit_exhausted', `Scenario aborted after ${budgetRounds} budget rounds (limit ${roundLimit}; ${researchRounds} research rounds free).`);
    }
    if (researchRounds >= researchRoundCeiling) {
      return outcome('round_limit_exhausted', `Scenario aborted at the research-round ceiling (${researchRoundCeiling}).`);
    }

    let assistant: AssistantMessage;
    try {
      const relay = await gatewayClient.callLlmToolLoop({
        messages,
        tools: definitions,
        toolChoice: 'auto',
        model,
        timeoutMs: toolCallTimeoutMs,
      });
      assistant = relay.message;
    } catch (err) {
      const reason = (err as { reason?: string }).reason;
      const message = err instanceof Error ? err.message : String(err);
      if (reason === 'daily_limit' || /daily/i.test(message)) return outcome('llm_daily_limit', message);
      return outcome('llm_relay_error', message);
    }
    roundsUsed += 1;
    finalMessage = assistant;
    messages.push({ role: 'assistant', content: assistant.content, tool_calls: assistant.tool_calls });

    const calls = assistant.tool_calls ?? [];
    if (calls.length === 0) return outcome('completed', null);

    let allResearch = true;
    let terminal = false;
    let budgetExhausted = false;
    for (const call of calls) {
      const tool = registry.get(call.function.name);
      let result: unknown;
      if (!tool) {
        allResearch = false;
        result = { error: `Unknown tool '${call.function.name}'.` };
      } else {
        if (!tool.research) allResearch = false;
        let parsed: Record<string, unknown> = {};
        try {
          parsed = call.function.arguments ? (JSON.parse(call.function.arguments) as Record<string, unknown>) : {};
        } catch {
          result = { error: 'Tool arguments were not valid JSON.' };
        }
        if (result === undefined) {
          try {
            result = await withTimeout(tool.handler(parsed, context), toolCallTimeoutMs, tool.name);
            if (tool.terminal) terminal = true;
          } catch (err) {
            if ((err as { __toolCallTimeout?: boolean }).__toolCallTimeout) {
              return outcome('tool_call_timeout', err instanceof Error ? err.message : String(err));
            }
            if (err instanceof ProcAttemptBudgetExhausted) {
              budgetExhausted = true;
              result = { error: err.message, reason: 'attempt_budget_exhausted' };
            } else if (err instanceof ToolValidationError) {
              result = { error: err.message, reason: err.reason, tool: err.toolName };
            } else {
              result = { error: err instanceof Error ? err.message : String(err) };
            }
          }
        }
      }
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        name: call.function.name,
        content: JSON.stringify(redactJson(result)),
      });
    }
    if (allResearch) researchRounds += 1;
    if (terminal) return outcome('completed', null);
    if (budgetExhausted) return outcome('attempt_budget_exhausted', 'Fired-attempt budget exhausted.');
  }
}
