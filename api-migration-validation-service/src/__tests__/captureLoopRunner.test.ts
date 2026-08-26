/**
 * captureLoopRunner + tool-registry guardrail tests.
 *
 * Covers spec sub-task 5.1 -- the focused 2-8 tests for the LLM tool-call
 * loop and the 8-tool registry. Specifically:
 *
 *   1. Happy path: one round-trip, tool call dispatched, result fed back,
 *      loop terminates when `record_capture_note` (terminal) is called.
 *   2. 12-round hard cap fires and emits `retry_exhausted` diagnostic.
 *   3. 30s per-tool-call timeout fires and emits `llm_generation_failure`
 *      diagnostic.
 *   4. 5min scenario wall-clock fires and marks scenario `executed_error`
 *      (verified via the `wall_clock_exceeded` outcome reason).
 *   5. `execute_http_request` rejects mutating verbs when
 *      `mutating_calls_confirmed=false`.
 *   6. `run_readonly_sql` rejects `DELETE FROM x; SELECT 1;` (statement
 *      parser blocks non-single-SELECT).
 *   7. Tool outputs flow through the redactor before being yielded to the
 *      LLM (verified by inspecting the tool-result content fed back to the
 *      assistant on the next round).
 *
 * Spec: 2026-05-15 API Behaviour Baseline Capture Service -- Task Group 5
 * sub-task 5.1.
 */

import { runScenarioLoop } from '../services/captureLoopRunner';
import { LlmRelayError } from '../services/gatewayClient';
import {
  ALL_TOOLS,
  ToolValidationError,
  type ArchModelToolWriteSurface,
  type ToolExecutionContext,
  type ToolRegistryEntry,
} from '../services/tools';
import { recordCaptureNoteTool } from '../services/tools/record_capture_note';
import { executeHttpRequestTool } from '../services/tools/execute_http_request';
import { runReadonlySqlTool } from '../services/tools/run_readonly_sql';
import { REDACTED_PLACEHOLDER } from '../services/redactor';
import { runManager } from '../services/runManager';
import type { CaptureSession } from '../types/captureSession';
import type { OperationDto } from '../services/archModelClient';
import type { AssistantMessage, ChatMessage } from '../types/llm';

// --------------------------------------------------------------------------
// Test fixtures: minimal context the runner / tools need.
// --------------------------------------------------------------------------

function buildSession(overrides: Partial<CaptureSession> = {}): CaptureSession {
  return {
    id: 'session-1',
    projectId: 'proj-1',
    architectureId: 'arch-1',
    name: 'test-session',
    status: 'running',
    envName: 'non-prod',
    apiBaseUrl: 'https://api.example.test',
    authType: 'bearer',
    authConfigRedactedJson: null,
    defaultHeadersRedactedJson: null,
    oasSpecRefsJson: null,
    dbConfigRedactedJson: null,
    mutatingCallsConfirmed: false,
    startedAt: null,
    completedAt: null,
    errorMessage: null,
    createdAt: '2026-05-15T00:00:00Z',
    updatedAt: '2026-05-15T00:00:00Z',
    ...overrides,
  };
}

function buildOperation(overrides: Partial<OperationDto> = {}): OperationDto {
  return {
    id: 'op-row-1',
    session_id: 'session-1',
    operation_id: 'getThings',
    method: 'GET',
    path: '/things',
    summary: 'List things',
    description: null,
    included: true,
    safe_to_execute: true,
    request_schema_json: null,
    response_schema_json: null,
    oas_operation_json: {},
    created_at: '2026-05-15T00:00:00Z',
    updated_at: '2026-05-15T00:00:00Z',
    ...overrides,
  };
}

interface MockArchClient extends ArchModelToolWriteSurface {
  createDiagnostic: jest.Mock;
  createScenario: jest.Mock;
  createCapture: jest.Mock;
}

function buildMockArchClient(): MockArchClient {
  let nextId = 1;
  return {
    createScenario: jest.fn(async () => ({ id: `scenario-${nextId++}` })) as unknown as MockArchClient['createScenario'],
    createDiagnostic: jest.fn(async () => ({ id: `diag-${nextId++}` })) as unknown as MockArchClient['createDiagnostic'],
    createCapture: jest.fn(async () => ({ id: `capture-${nextId++}` })) as unknown as MockArchClient['createCapture'],
  } as MockArchClient;
}

function buildContext(overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext {
  const arch = buildMockArchClient();
  const op = buildOperation();
  return {
    session: buildSession(),
    oasInventory: {
      title: 'Test',
      version: '1.0.0',
      operations: [
        {
          operationId: 'getThings',
          method: 'get',
          path: '/things',
          summary: 'List things',
          description: null,
          requestSchema: null,
          responseSchema: null,
          oasOperation: {} as never,
        },
      ],
    },
    operationsByOasId: new Map([[op.operation_id, op]]),
    secrets: { sessionId: 'session-1', api: { type: 'none' }, loadedAt: Date.now() },
    httpExecutor: null,
    dbAdapter: null,
    archModelClient: arch,
    currentScenarioId: 'scenario-current',
    retryCount: 0,
    ...overrides,
  };
}

/**
 * Build a stub gateway client whose `callLlmToolLoop` returns a queued
 * sequence of assistant messages. Each call pops the next message; the
 * test fails if the sequence is exhausted (loop went deeper than expected).
 */
function buildStubGateway(messages: AssistantMessage[]): {
  callLlmToolLoop: jest.Mock;
  recordedRequests: Array<{ messages: ChatMessage[] }>;
} {
  const recorded: Array<{ messages: ChatMessage[] }> = [];
  const queue = [...messages];
  const callLlmToolLoop = jest.fn(async (req: { messages: ChatMessage[] }) => {
    recorded.push({ messages: [...req.messages] });
    const next = queue.shift();
    if (!next) throw new Error('stub gateway: no more queued assistant messages');
    return { message: next };
  });
  return { callLlmToolLoop, recordedRequests: recorded };
}

function makeAssistant(toolCalls: AssistantMessage['tool_calls']): AssistantMessage {
  return {
    role: 'assistant',
    content: null,
    tool_calls: toolCalls,
  };
}

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

describe('captureLoopRunner -- happy path', () => {
  it('dispatches one tool call, feeds result back, and terminates on record_capture_note', async () => {
    const ctx = buildContext();
    const stubGateway = buildStubGateway([
      // Round 1: assistant asks the runner to call list_oas_operations.
      makeAssistant([
        {
          id: 'call-1',
          type: 'function',
          function: { name: 'list_oas_operations', arguments: '{}' },
        },
      ]),
      // Round 2: assistant calls the terminal tool.
      makeAssistant([
        {
          id: 'call-2',
          type: 'function',
          function: {
            name: 'record_capture_note',
            arguments: JSON.stringify({
              message: 'happy path captured',
              diagnosticType: 'endpoint_skipped',
            }),
          },
        },
      ]),
    ]);

    const outcome = await runScenarioLoop({
      context: ctx,
      initialMessages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'user' },
      ],
      tools: ALL_TOOLS,
      gatewayClient: stubGateway,
      archModelClient: ctx.archModelClient as unknown as { createDiagnostic: typeof ctx.archModelClient.createDiagnostic },
    });

    expect(outcome.reason).toBe('completed');
    expect(outcome.roundsUsed).toBe(2);
    expect(outcome.diagnosticId).toBeNull();

    // Verified shape of round-trips: round 1 saw initial messages only;
    // round 2 saw initial + assistant + tool-result messages.
    expect(stubGateway.callLlmToolLoop).toHaveBeenCalledTimes(2);
    const round1Messages = stubGateway.recordedRequests[0].messages;
    const round2Messages = stubGateway.recordedRequests[1].messages;
    expect(round1Messages).toHaveLength(2); // initial system + user
    expect(round2Messages).toHaveLength(4); // + assistant + tool result
    expect(round2Messages[2].role).toBe('assistant');
    expect(round2Messages[3].role).toBe('tool');
    expect(round2Messages[3].tool_call_id).toBe('call-1');
    // record_capture_note (terminal) was actually invoked -- diagnostic
    // write was issued via the AMS client.
    const archMock = ctx.archModelClient as unknown as MockArchClient;
    expect(archMock.createDiagnostic).toHaveBeenCalledTimes(1);
  });
});

describe('captureLoopRunner -- 12-round hard cap', () => {
  // 2026-08-26 accounting fix: research rounds are FREE, so the cap test
  // must spin on a NON-research tool. A bare unknown-args call to the
  // scenario-candidate recorder still counts (identity decides, not
  // success) — exactly the round-burning churn Kiro's Issue 3 observed.
  const buildNonResearchAssistant = (n: number): AssistantMessage =>
    makeAssistant([
      {
        id: `call-${n}`,
        type: 'function',
        function: { name: 'record_scenario_candidate', arguments: '{}' },
      },
    ]);
  const buildResearchAssistant = (n: number): AssistantMessage =>
    makeAssistant([
      {
        id: `research-${n}`,
        type: 'function',
        function: { name: 'list_oas_operations', arguments: '{}' },
      },
    ]);

  it('emits retry_exhausted diagnostic and returns reason=round_limit_exhausted', async () => {
    const ctx = buildContext();
    const stubGateway = buildStubGateway([
      buildNonResearchAssistant(1),
      buildNonResearchAssistant(2),
      buildNonResearchAssistant(3),
    ]);

    const outcome = await runScenarioLoop({
      context: ctx,
      initialMessages: [{ role: 'user', content: 'go' }],
      tools: ALL_TOOLS,
      gatewayClient: stubGateway,
      archModelClient: ctx.archModelClient as unknown as { createDiagnostic: typeof ctx.archModelClient.createDiagnostic },
      roundLimit: 3,
    });

    expect(outcome.reason).toBe('round_limit_exhausted');
    expect(outcome.roundsUsed).toBe(3);
    expect(outcome.researchRounds).toBe(0);
    const archMock = ctx.archModelClient as unknown as MockArchClient;
    expect(archMock.createDiagnostic).toHaveBeenCalledTimes(1);
    const diagnosticBody = archMock.createDiagnostic.mock.calls[0][1] as { diagnostic_type: string };
    expect(diagnosticBody.diagnostic_type).toBe('retry_exhausted');
  });

  it('research rounds are FREE against the cap (2026-08-26 accounting fix)', async () => {
    const ctx = buildContext();
    // Four research rounds — beyond the roundLimit of 2 — then the terminal
    // note. Under the old all-rounds accounting this aborted at round 2 as
    // retry_exhausted; research-is-free lets the scenario complete.
    const stubGateway = buildStubGateway([
      buildResearchAssistant(1),
      buildResearchAssistant(2),
      buildResearchAssistant(3),
      buildResearchAssistant(4),
      makeAssistant([
        {
          id: 'call-final',
          type: 'function',
          function: {
            name: 'record_capture_note',
            arguments: JSON.stringify({
              message: 'captured after legitimate research',
              diagnosticType: 'endpoint_skipped',
            }),
          },
        },
      ]),
    ]);

    const outcome = await runScenarioLoop({
      context: ctx,
      initialMessages: [{ role: 'user', content: 'go' }],
      tools: ALL_TOOLS,
      gatewayClient: stubGateway,
      archModelClient: ctx.archModelClient as unknown as { createDiagnostic: typeof ctx.archModelClient.createDiagnostic },
      roundLimit: 2,
    });

    expect(outcome.reason).toBe('completed');
    expect(outcome.roundsUsed).toBe(5);
    expect(outcome.researchRounds).toBe(4);
  });

  it('the research-round ceiling backstops an all-research spin, naming the knob', async () => {
    const ctx = buildContext();
    const stubGateway = buildStubGateway([
      buildResearchAssistant(1),
      buildResearchAssistant(2),
      buildResearchAssistant(3),
    ]);

    const outcome = await runScenarioLoop({
      context: ctx,
      initialMessages: [{ role: 'user', content: 'go' }],
      tools: ALL_TOOLS,
      gatewayClient: stubGateway,
      archModelClient: ctx.archModelClient as unknown as { createDiagnostic: typeof ctx.archModelClient.createDiagnostic },
      roundLimit: 12,
      researchRoundCeiling: 2,
    });

    expect(outcome.reason).toBe('round_limit_exhausted');
    expect(outcome.researchRounds).toBe(2);
    const archMock = ctx.archModelClient as unknown as MockArchClient;
    const diagnosticBody = archMock.createDiagnostic.mock.calls[0][1] as { message: string };
    expect(diagnosticBody.message).toContain('LLM_SCENARIO_RESEARCH_ROUND_CEILING');
  });
});

describe('captureLoopRunner -- per-tool-call timeout', () => {
  it('emits llm_generation_failure diagnostic when a tool exceeds the per-call timeout', async () => {
    const ctx = buildContext();
    // Custom slow tool that never resolves -- the timeout must fire.
    const slowTool: ToolRegistryEntry = {
      name: 'slow_tool',
      description: 'never resolves',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      handler: () =>
        new Promise((_resolve) => {
          /* deliberately never resolves */
        }),
    };
    const stubGateway = buildStubGateway([
      makeAssistant([
        {
          id: 'call-slow',
          type: 'function',
          function: { name: 'slow_tool', arguments: '{}' },
        },
      ]),
    ]);

    const outcome = await runScenarioLoop({
      context: ctx,
      initialMessages: [{ role: 'user', content: 'go' }],
      tools: [slowTool, recordCaptureNoteTool],
      gatewayClient: stubGateway,
      archModelClient: ctx.archModelClient as unknown as { createDiagnostic: typeof ctx.archModelClient.createDiagnostic },
      toolCallTimeoutMs: 50,
    });

    expect(outcome.reason).toBe('tool_call_timeout');
    const archMock = ctx.archModelClient as unknown as MockArchClient;
    expect(archMock.createDiagnostic).toHaveBeenCalledTimes(1);
    const diagnosticBody = archMock.createDiagnostic.mock.calls[0][1] as { diagnostic_type: string };
    expect(diagnosticBody.diagnostic_type).toBe('llm_generation_failure');
  });
});

describe('captureLoopRunner -- 5min scenario wall-clock', () => {
  it('aborts the scenario when the wall-clock cap is exceeded', async () => {
    const ctx = buildContext();
    // Tool intentionally sleeps so wall-clock elapses on the next iteration.
    const sleepTool: ToolRegistryEntry = {
      name: 'sleep_tool',
      description: 'consumes wall-clock',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      handler: () => new Promise((resolve) => setTimeout(() => resolve({}), 60)),
    };
    // Two non-terminal rounds; each call to the sleep tool consumes ~60ms,
    // so by the second iteration the 50ms wall-clock cap is exceeded.
    const stubGateway = buildStubGateway([
      makeAssistant([
        { id: 'c1', type: 'function', function: { name: 'sleep_tool', arguments: '{}' } },
      ]),
      makeAssistant([
        { id: 'c2', type: 'function', function: { name: 'sleep_tool', arguments: '{}' } },
      ]),
    ]);

    const outcome = await runScenarioLoop({
      context: ctx,
      initialMessages: [{ role: 'user', content: 'go' }],
      tools: [sleepTool, recordCaptureNoteTool],
      gatewayClient: stubGateway,
      archModelClient: ctx.archModelClient as unknown as { createDiagnostic: typeof ctx.archModelClient.createDiagnostic },
      scenarioWallClockMs: 50,
      toolCallTimeoutMs: 1000,
      roundLimit: 99,
    });

    expect(outcome.reason).toBe('wall_clock_exceeded');
    const archMock = ctx.archModelClient as unknown as MockArchClient;
    expect(archMock.createDiagnostic).toHaveBeenCalled();
    const diagnosticBody = archMock.createDiagnostic.mock.calls[0][1] as {
      diagnostic_type: string;
      detail_json: { reason: string };
    };
    expect(diagnosticBody.diagnostic_type).toBe('retry_exhausted');
    expect(diagnosticBody.detail_json.reason).toBe('wall_clock_exceeded');
  });
});

describe('execute_http_request -- mutating verb gating', () => {
  // The rewritten handler in spec 2026-05-16 collapsed the previous 3-gate
  // chain into a single combined check: `included AND (safe_to_execute OR
  // mutating_calls_confirmed)`. To exercise the mutating-call guardrail we
  // must therefore force `safe_to_execute=false` (so neither half of the OR
  // is satisfied when confirmation is also absent); the failure now surfaces
  // as `operation_not_executable`. The handler also drives the attempt
  // counter from `runManager`, which throws if no live run is registered for
  // the session -- so we start/end a runManager entry around the assertion.
  it('rejects mutating verbs when mutating_calls_confirmed=false', async () => {
    const ctx = buildContext({
      session: buildSession({ mutatingCallsConfirmed: false }),
      operationsByOasId: new Map([
        [
          'createThing',
          buildOperation({
            operation_id: 'createThing',
            method: 'POST',
            path: '/things',
            included: true,
            safe_to_execute: false,
          }),
        ],
      ]),
      httpExecutor: {
        request: jest.fn(),
        requestWithAuthOverride: jest.fn(),
        setAuth: jest.fn(),
        dispose: jest.fn(),
      },
    });

    if (runManager.has(ctx.session.id)) runManager.end(ctx.session.id);
    runManager.start({
      sessionId: ctx.session.id,
      projectId: ctx.session.projectId,
      architectureId: ctx.session.architectureId,
    });
    try {
      await expect(
        executeHttpRequestTool.handler(
          {
            operationId: 'createThing',
            method: 'post',
            path: '/things',
          },
          ctx,
        ),
      ).rejects.toMatchObject({
        name: 'ToolValidationError',
        reason: 'operation_not_executable',
      });
      // The HTTP executor MUST not have been touched.
      expect((ctx.httpExecutor as unknown as { request: jest.Mock }).request).not.toHaveBeenCalled();
    } finally {
      runManager.end(ctx.session.id);
    }
  });
});

describe('run_readonly_sql -- statement parser', () => {
  it('rejects DELETE FROM x; SELECT 1; (multi-statement / forbidden keyword)', async () => {
    const ctx = buildContext({
      session: buildSession({
        dbConfigRedactedJson: {
          dbType: 'postgres',
          host: 'h',
          port: 5432,
          database: 'd',
          username: 'u',
        },
      }),
      // Mock dbAdapter -- if the guard fails, the adapter MUST not be called.
      dbAdapter: {
        testConnection: jest.fn(),
        listMetadata: jest.fn(),
        runReadonlySelect: jest.fn(),
        sampleValues: jest.fn(),
        countRows: jest.fn(),
        fetchOrderedRows: jest.fn(),
        dispose: jest.fn(),
      },
    });

    await expect(
      runReadonlySqlTool.handler(
        { sql: 'DELETE FROM x; SELECT 1;' },
        ctx,
      ),
    ).rejects.toBeInstanceOf(ToolValidationError);
    expect((ctx.dbAdapter as unknown as { runReadonlySelect: jest.Mock }).runReadonlySelect).not.toHaveBeenCalled();
  });
});

describe('captureLoopRunner -- redactor on tool output', () => {
  it('passes tool outputs through the redactor before sending back to the LLM', async () => {
    const ctx = buildContext();
    // Custom tool that returns a payload containing secret-named fields --
    // the runner must redact them before they appear in the next round's
    // tool-result message.
    const leakyTool: ToolRegistryEntry = {
      name: 'leaky_tool',
      description: 'returns a payload with secret-named fields',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      handler: async () => ({
        ok: true,
        data: { user: 'alice', password: 'plaintext-leak', apiKey: 'sk-leak' },
      }),
    };

    const stubGateway = buildStubGateway([
      makeAssistant([
        { id: 'c1', type: 'function', function: { name: 'leaky_tool', arguments: '{}' } },
      ]),
      makeAssistant([
        {
          id: 'c2',
          type: 'function',
          function: {
            name: 'record_capture_note',
            arguments: JSON.stringify({ message: 'done' }),
          },
        },
      ]),
    ]);

    const outcome = await runScenarioLoop({
      context: ctx,
      initialMessages: [{ role: 'user', content: 'go' }],
      tools: [leakyTool, recordCaptureNoteTool],
      gatewayClient: stubGateway,
      archModelClient: ctx.archModelClient as unknown as { createDiagnostic: typeof ctx.archModelClient.createDiagnostic },
    });

    expect(outcome.reason).toBe('completed');
    // The second round's tool message MUST contain redacted placeholders --
    // not the raw plaintext secret values.
    const round2Messages = stubGateway.recordedRequests[1].messages;
    const toolResultMessage = round2Messages.find((m) => m.role === 'tool');
    expect(toolResultMessage).toBeDefined();
    const content = toolResultMessage?.content ?? '';
    expect(content).not.toContain('plaintext-leak');
    expect(content).not.toContain('sk-leak');
    expect(content).toContain(REDACTED_PLACEHOLDER);
  });
});

describe('captureLoopRunner -- cancellation', () => {
  it('returns reason=cancelled and emits a cancelled diagnostic when the abort signal fires between rounds', async () => {
    const ctx = buildContext();
    const controller = new AbortController();

    const stubGateway = buildStubGateway([
      makeAssistant([
        {
          id: 'call-1',
          type: 'function',
          function: { name: 'list_oas_operations', arguments: '{}' },
        },
      ]),
    ]);
    // Abort the signal as soon as the first LLM round completes, before the
    // runner re-enters the while-loop for round 2.
    stubGateway.callLlmToolLoop.mockImplementationOnce(async (req: { messages: ChatMessage[] }) => {
      controller.abort();
      return {
        message: makeAssistant([
          {
            id: 'call-1',
            type: 'function',
            function: { name: 'list_oas_operations', arguments: '{}' },
          },
        ]),
      };
    });

    const outcome = await runScenarioLoop({
      context: ctx,
      initialMessages: [{ role: 'system', content: 'start' }],
      tools: ALL_TOOLS,
      gatewayClient: stubGateway,
      archModelClient: ctx.archModelClient as unknown as { createDiagnostic: typeof ctx.archModelClient.createDiagnostic },
      abortSignal: controller.signal,
    });

    expect(outcome.reason).toBe('cancelled');
    expect(outcome.diagnosticId).not.toBeNull();
    const archClient = ctx.archModelClient as MockArchClient;
    const diagCall = archClient.createDiagnostic.mock.calls.find(
      (call: unknown[]) => (call[1] as { detail_json?: { reason?: string } }).detail_json?.reason === 'cancelled',
    );
    expect(diagCall).toBeDefined();
  });
});

describe('captureLoopRunner -- LLM per-day quota (Spec 2026-07-22)', () => {
  it('returns reason=llm_daily_limit (terminal, non-retryable) when the relay reports the daily limit', async () => {
    const ctx = buildContext();
    const stubGateway = buildStubGateway([]);
    stubGateway.callLlmToolLoop.mockRejectedValueOnce(
      new LlmRelayError(
        'LLM tool-loop relay failed (HTTP 429, reason=llm_daily_limit): per day quota',
        'llm_daily_limit',
        429,
        null,
      ),
    );

    const outcome = await runScenarioLoop({
      context: ctx,
      initialMessages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'user' },
      ],
      tools: ALL_TOOLS,
      gatewayClient: stubGateway,
      archModelClient: ctx.archModelClient as unknown as { createDiagnostic: typeof ctx.archModelClient.createDiagnostic },
    });

    expect(outcome.reason).toBe('llm_daily_limit');
    const archMock = ctx.archModelClient as unknown as MockArchClient;
    const dailyDiag = (archMock.createDiagnostic.mock.calls as unknown[][]).find(
      (call) => (call[1] as { detail_json?: { reason?: string } }).detail_json?.reason === 'llm_daily_limit',
    );
    expect(dailyDiag).toBeDefined();
  });

  it('a plain per-minute rate_limited relay error stays llm_relay_error (retryable), not terminal', async () => {
    const ctx = buildContext();
    const stubGateway = buildStubGateway([]);
    stubGateway.callLlmToolLoop.mockRejectedValueOnce(
      new LlmRelayError('rate limited', 'rate_limited', 429, null),
    );

    const outcome = await runScenarioLoop({
      context: ctx,
      initialMessages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'user' },
      ],
      tools: ALL_TOOLS,
      gatewayClient: stubGateway,
      archModelClient: ctx.archModelClient as unknown as { createDiagnostic: typeof ctx.archModelClient.createDiagnostic },
    });

    expect(outcome.reason).toBe('llm_relay_error');
  });
});

// --------------------------------------------------------------------------
// Fired-attempt budget (2026-08-08 Retry-uncovered budget fix): the budget
// counts ONLY execute_http_request calls at the TARGET operation; research
// tools and other endpoints are free; the over-budget call is refused (never
// fired) and the loop ends with `attempt_budget_exhausted`.
// --------------------------------------------------------------------------

describe('captureLoopRunner -- fired-attempt budget', () => {
  function budgetFakes(): {
    fakeHttp: ToolRegistryEntry;
    fakeList: ToolRegistryEntry;
    firedPaths: string[];
    listCalls: number[];
  } {
    const firedPaths: string[] = [];
    const listCalls: number[] = [];
    const fakeHttp: ToolRegistryEntry = {
      name: 'execute_http_request',
      description: 'fake http',
      parameters: { type: 'object', properties: {} },
      handler: async (args) => {
        firedPaths.push(String(args.path));
        return { status: 404 };
      },
    };
    const fakeList: ToolRegistryEntry = {
      name: 'list_oas_operations',
      description: 'fake research',
      parameters: { type: 'object', properties: {} },
      handler: async () => {
        listCalls.push(1);
        return { operations: [] };
      },
    };
    return { fakeHttp, fakeList, firedPaths, listCalls };
  }

  const httpCall = (id: string, method: string, path: string) => ({
    id,
    type: 'function' as const,
    function: {
      name: 'execute_http_request',
      arguments: JSON.stringify({ method, path }),
    },
  });
  const listCall = (id: string) => ({
    id,
    type: 'function' as const,
    function: { name: 'list_oas_operations', arguments: '{}' },
  });

  it('research and other-endpoint requests are FREE; only target hits count; the over-budget call is refused', async () => {
    const { fakeHttp, fakeList, firedPaths, listCalls } = budgetFakes();
    const gateway = buildStubGateway([
      // Round 1: research + a NON-target request (a list fetch) — both free.
      makeAssistant([listCall('c1'), httpCall('c2', 'GET', '/orders')]),
      // Round 2: first fired attempt at the target (template match).
      makeAssistant([httpCall('c3', 'GET', '/orders/123')]),
      // Round 3: second fired attempt — budget (2) now exhausted.
      makeAssistant([httpCall('c4', 'GET', '/orders/456')]),
      // Round 4: third attempt must be REFUSED and end the loop.
      makeAssistant([httpCall('c5', 'GET', '/orders/789')]),
    ]);

    const outcome = await runScenarioLoop({
      context: buildContext(),
      initialMessages: [{ role: 'user', content: 'repair' }],
      tools: [fakeHttp, fakeList],
      gatewayClient: gateway,
      archModelClient: buildMockArchClient(),
      roundLimit: 50,
      firedAttemptBudget: {
        method: 'GET',
        pathTemplate: '/orders/{orderId}',
        maxAttempts: 2,
      },
    });

    expect(outcome.reason).toBe('attempt_budget_exhausted');
    expect(outcome.firedAttempts).toBe(2);
    // The refused call was NEVER executed: only the free /orders fetch and
    // the two in-budget target hits reached the tool.
    expect(firedPaths).toEqual(['/orders', '/orders/123', '/orders/456']);
    expect(listCalls).toHaveLength(1);
    expect(outcome.errorMessage).toContain('budget exhausted');
    // 4 LLM rounds were issued (the refusal happens IN round 4, then ends).
    expect(gateway.recordedRequests).toHaveLength(4);
  });

  it('a loop WITHOUT a firedAttemptBudget never counts or refuses (firedAttempts stays 0)', async () => {
    const { fakeHttp, firedPaths } = budgetFakes();
    const terminal: ToolRegistryEntry = {
      name: 'record_capture_note',
      description: 'fake terminal',
      parameters: { type: 'object', properties: {} },
      handler: async () => ({ ok: true }),
      terminal: true,
    };
    const gateway = buildStubGateway([
      makeAssistant([httpCall('c1', 'GET', '/orders/123')]),
      makeAssistant([
        {
          id: 'c2',
          type: 'function' as const,
          function: { name: 'record_capture_note', arguments: '{}' },
        },
      ]),
    ]);

    const outcome = await runScenarioLoop({
      context: buildContext(),
      initialMessages: [{ role: 'user', content: 'go' }],
      tools: [fakeHttp, terminal],
      gatewayClient: gateway,
      archModelClient: buildMockArchClient(),
      roundLimit: 10,
    });

    expect(outcome.reason).toBe('completed');
    expect(outcome.firedAttempts).toBe(0);
    expect(firedPaths).toEqual(['/orders/123']);
  });
});
