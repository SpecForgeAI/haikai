/**
 * Tests — Architect-Conversation LLM Loop Runner
 * Spec 2026-05-24-target-state-architect-conversation, Task Group 2.
 *
 * Per tasks.md §2.1 — 4-8 focused backend tests. All LLM calls mocked at the
 * `ArchitectLlmClient.callLlmToolLoop` boundary (per Q26 — no live LLM tests).
 */

import {
  QUESTION_LIBRARY,
  QuestionLibraryEntry,
} from '../../../config/architect-conversation/questionLibrary';
import type {
  ArchitectLlmClient,
  CallLlmToolLoopArgs,
  CallLlmToolLoopResponse,
} from '../architectLlmClient';
import {
  ARCHITECT_LOOP_PER_CALL_TIMEOUT_MS,
  ARCHITECT_LOOP_ROUND_LIMIT,
  ARCHITECT_LOOP_WALL_CLOCK_MS,
  ArchitectToolRegistryEntry,
  LoopAnswerOk,
  LoopErrorResult,
  LoopResult,
  runArchitectQuestionLoop,
  SUBMIT_ANSWER_TOOL_NAME,
} from '../llmLoopRunner';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Build an LLM client whose `callLlmToolLoop` returns a sequence of canned
 * responses (one per round) in order. After the sequence is exhausted, returns
 * an empty-tool-calls assistant message so the runner's "no tool call detected"
 * nudge path kicks in (used by the round-budget test).
 */
function sequencedClient(
  responses: CallLlmToolLoopResponse[],
  fallback?: CallLlmToolLoopResponse,
): { client: ArchitectLlmClient; callCount: () => number; lastArgs: () => CallLlmToolLoopArgs | null } {
  let i = 0;
  let lastArgs: CallLlmToolLoopArgs | null = null;
  const client: ArchitectLlmClient = {
    async callLlmToolLoop(args: CallLlmToolLoopArgs): Promise<CallLlmToolLoopResponse> {
      lastArgs = args;
      if (i < responses.length) {
        return responses[i++];
      }
      i += 1;
      return (
        fallback ?? {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [],
          },
        }
      );
    },
    async callSingleShot(): Promise<{ content: string }> {
      throw new Error('callSingleShot should not be invoked in this test');
    },
  };
  return {
    client,
    callCount: () => i,
    lastArgs: () => lastArgs,
  };
}

/**
 * Build a `submit_structured_answer` assistant message carrying the given
 * value and (optional) proposed cascades.
 */
function submitAnswerResponse(
  value: unknown,
  proposedCascades?: Array<{ decisionCode: string; proposedValue: unknown }>,
  id = 'call-1',
): CallLlmToolLoopResponse {
  return {
    message: {
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id,
          type: 'function',
          function: {
            name: SUBMIT_ANSWER_TOOL_NAME,
            arguments: JSON.stringify({
              value,
              ...(proposedCascades ? { proposedCascades } : {}),
            }),
          },
        },
      ],
    },
  };
}

/** A simple "I need more context" non-terminal response used by the ambiguity test. */
function nonTerminalToolCall(toolName: string, args: Record<string, unknown> = {}): CallLlmToolLoopResponse {
  return {
    message: {
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'call-tool',
          type: 'function',
          function: {
            name: toolName,
            arguments: JSON.stringify(args),
          },
        },
      ],
    },
  };
}

/** Fetch the canonical Group A.1 entry as a baseline for tests. */
function getServiceLanguageEntry(): QuestionLibraryEntry {
  const entry = QUESTION_LIBRARY.find((e) => e.code === 'service.language');
  if (!entry) throw new Error('Fixture sanity: service.language entry missing from library.');
  return entry;
}

// ---------------------------------------------------------------------------
// Test 1 — 5-round cap. After 5 LLM rounds without a terminal submit, the
// loop emits an `error` result with errorKind = 'round-budget-exhausted'.
// ---------------------------------------------------------------------------

describe('runArchitectQuestionLoop — round budget exhaustion', () => {
  it('emits round-budget-exhausted after the round limit when the LLM never submits', async () => {
    const entry = getServiceLanguageEntry();
    // Every response is a no-tool-call assistant message, so the loop will
    // keep iterating until the round budget is exhausted.
    const emptyResponse: CallLlmToolLoopResponse = {
      message: { role: 'assistant', content: 'Still thinking...', tool_calls: [] },
    };
    const { client, callCount } = sequencedClient([], emptyResponse);

    const result = await runArchitectQuestionLoop({
      entry,
      userResponse: 'something other than no-change',
      capturedDecisionsContext: '',
      inlineCascadeSeedMap: '',
      llmClient: client,
    });

    expect(result.outcome).toBe('error');
    const err = result as LoopErrorResult;
    expect(err.errorKind).toBe('round-budget-exhausted');
    expect(err.roundsUsed).toBe(ARCHITECT_LOOP_ROUND_LIMIT);
    expect(callCount()).toBe(ARCHITECT_LOOP_ROUND_LIMIT);
    expect(err.errorMessage).toContain(String(ARCHITECT_LOOP_ROUND_LIMIT));
  });
});

// ---------------------------------------------------------------------------
// Test 2 — 30s per-call timeout. A mocked LLM call that exceeds the cap
// yields an `error` result with errorKind = 'llm-call-timeout'.
// ---------------------------------------------------------------------------

describe('runArchitectQuestionLoop — per-call timeout', () => {
  it('emits llm-call-timeout when a single LLM call exceeds the per-call cap', async () => {
    jest.useFakeTimers();
    try {
      const entry = getServiceLanguageEntry();

      const client: ArchitectLlmClient = {
        // Return a promise that never settles within the test — the runner's
        // withTimeout race will trip the per-call cap first.
        callLlmToolLoop: () =>
          new Promise<CallLlmToolLoopResponse>(() => {
            /* never resolves */
          }),
        callSingleShot: async () => {
          throw new Error('callSingleShot should not be invoked in this test');
        },
      };

      // Use a short per-call cap to keep the test fast; the production constant
      // is asserted by name in the call-shape inspection below.
      const SHORT_CALL_CAP_MS = 50;
      const promise = runArchitectQuestionLoop({
        entry,
        userResponse: 'java 21 please',
        capturedDecisionsContext: '',
        inlineCascadeSeedMap: '',
        llmClient: client,
        perCallTimeoutMs: SHORT_CALL_CAP_MS,
        wallClockMs: 10_000, // generous wall-clock so the per-call cap fires first
      });

      // Advance just past the per-call cap so the synthetic timeout fires.
      await Promise.resolve();
      jest.advanceTimersByTime(SHORT_CALL_CAP_MS + 1);

      const result: LoopResult = await promise;
      expect(result.outcome).toBe('error');
      const err = result as LoopErrorResult;
      expect(err.errorKind).toBe('llm-call-timeout');
      expect(err.errorMessage).toContain(`${SHORT_CALL_CAP_MS}ms`);
      expect(err.roundsUsed).toBe(1);
    } finally {
      jest.useRealTimers();
    }

    // Sanity: the production constant matches the Q2 spec value (30s).
    expect(ARCHITECT_LOOP_PER_CALL_TIMEOUT_MS).toBe(30_000);
  });
});

// ---------------------------------------------------------------------------
// Test 3 — 2-minute wall-clock per question. A loop whose elapsed time
// exceeds the cap emits errorKind = 'wall-clock-exceeded'.
// ---------------------------------------------------------------------------

describe('runArchitectQuestionLoop — wall-clock cap', () => {
  it('emits wall-clock-exceeded when elapsed time crosses the cap between rounds', async () => {
    const entry = getServiceLanguageEntry();
    const WALL_CLOCK_CAP_MS = 1_000;

    // Deterministic clock: starts at 0, advances by 600ms each .now() call.
    // The runner reads .now() three times for the first 'while' iteration
    // (top-of-loop wall-clock check, elapsed compute, post-round duration)
    // so this synthetic clock guarantees the cap is crossed before the second
    // iteration starts.
    let tick = 0;
    const now = () => {
      const t = tick;
      tick += 600;
      return t;
    };

    // First round: an empty-tool-calls assistant — keeps the loop iterating.
    const { client } = sequencedClient(
      [
        {
          message: { role: 'assistant', content: 'Still working', tool_calls: [] },
        },
      ],
      {
        message: { role: 'assistant', content: 'Still working', tool_calls: [] },
      },
    );

    const result = await runArchitectQuestionLoop({
      entry,
      userResponse: 'kotlin please',
      capturedDecisionsContext: '',
      inlineCascadeSeedMap: '',
      llmClient: client,
      wallClockMs: WALL_CLOCK_CAP_MS,
      now,
    });

    expect(result.outcome).toBe('error');
    const err = result as LoopErrorResult;
    expect(err.errorKind).toBe('wall-clock-exceeded');
    expect(err.errorMessage).toContain(`${WALL_CLOCK_CAP_MS}ms`);

    // Sanity: the production constant matches the Q2 spec value (2 minutes).
    expect(ARCHITECT_LOOP_WALL_CLOCK_MS).toBe(120_000);
  });
});

// ---------------------------------------------------------------------------
// Test 4 — Happy path. Mocked LLM submits a valid structured answer on
// round 1; the loop exits with the typed answer and the LLM is invoked once.
// ---------------------------------------------------------------------------

describe('runArchitectQuestionLoop — happy path', () => {
  it('returns the parsed structured answer when the LLM submits a valid value on round 1', async () => {
    const entry = getServiceLanguageEntry();
    const { client, callCount } = sequencedClient([
      submitAnswerResponse('Java 21', [
        { decisionCode: 'service.runtime', proposedValue: 'Eclipse Temurin 21' },
        { decisionCode: 'testing.unit', proposedValue: 'JUnit 5' },
      ]),
    ]);

    const result = await runArchitectQuestionLoop({
      entry,
      userResponse: 'we want Java 21',
      capturedDecisionsContext: '(no prior decisions)',
      inlineCascadeSeedMap: '(service.runtime cascade omitted for brevity)',
      llmClient: client,
    });

    expect(result.outcome).toBe('answer');
    const ok = result as LoopAnswerOk;
    expect(ok.answerValue).toBe('Java 21');
    expect(ok.proposedCascades).not.toBeNull();
    expect(ok.proposedCascades).toEqual([
      { decisionCode: 'service.runtime', proposedValue: 'Eclipse Temurin 21' },
      { decisionCode: 'testing.unit', proposedValue: 'JUnit 5' },
    ]);
    expect(ok.roundsUsed).toBe(1);
    expect(ok.defaultUnchangedPath).toBe(false);
    expect(callCount()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Test 5 — Default-when-unchanged short-circuit. User response "no change"
// triggers the short-circuit; the LLM is NOT invoked and the loop returns
// the library entry's `defaultsWhenUnchanged` value.
// ---------------------------------------------------------------------------

describe('runArchitectQuestionLoop — default-when-unchanged', () => {
  it('short-circuits the LLM and returns defaultsWhenUnchanged for a "no change" response', async () => {
    const entry = getServiceLanguageEntry();
    let llmCalls = 0;
    const client: ArchitectLlmClient = {
      async callLlmToolLoop() {
        llmCalls += 1;
        throw new Error('LLM should not be called on the default-when-unchanged short-circuit path');
      },
      async callSingleShot(): Promise<{ content: string }> {
        throw new Error('callSingleShot should not be invoked in this test');
      },
    };

    const result = await runArchitectQuestionLoop({
      entry,
      userResponse: 'No Change',
      capturedDecisionsContext: '',
      inlineCascadeSeedMap: '',
      llmClient: client,
    });

    expect(result.outcome).toBe('answer');
    const ok = result as LoopAnswerOk;
    expect(ok.answerValue).toBe(entry.defaultsWhenUnchanged);
    expect(ok.proposedCascades).toBeNull();
    expect(ok.roundsUsed).toBe(0);
    expect(ok.defaultUnchangedPath).toBe(true);
    expect(llmCalls).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Test 6 — Ambiguity triggers another round within budget. Round 1 surfaces
// a non-terminal tool call (the LLM is gathering context); round 2 submits
// a valid structured answer. Loop succeeds and reports `roundsUsed = 2`.
// ---------------------------------------------------------------------------

describe('runArchitectQuestionLoop — ambiguity then resolution within budget', () => {
  it('iterates a second round when the first round is a non-terminal tool call', async () => {
    const entry = getServiceLanguageEntry();

    // Register a context-gathering tool whose handler returns a hint string.
    const lookupCalls: Array<Record<string, unknown>> = [];
    const lookupTool: ArchitectToolRegistryEntry = {
      name: 'lookup_current_state',
      definition: {
        type: 'function',
        function: {
          name: 'lookup_current_state',
          description: 'Look up the current-state value for the question.',
          parameters: {
            type: 'object',
            properties: { decisionCode: { type: 'string' } },
            required: ['decisionCode'],
          },
        },
      },
      handler: async (args) => {
        lookupCalls.push(args);
        return { currentValue: 'Java 17' };
      },
    };

    const { client, callCount } = sequencedClient([
      // Round 1: ambiguity — call the lookup tool first.
      nonTerminalToolCall('lookup_current_state', { decisionCode: 'service.language' }),
      // Round 2: terminal submit with the resolved value.
      submitAnswerResponse('Java 17'),
    ]);

    const result = await runArchitectQuestionLoop({
      entry,
      userResponse: 'keep what we have',
      capturedDecisionsContext: '',
      inlineCascadeSeedMap: '',
      llmClient: client,
      tools: [lookupTool],
    });

    expect(result.outcome).toBe('answer');
    const ok = result as LoopAnswerOk;
    expect(ok.answerValue).toBe('Java 17');
    expect(ok.roundsUsed).toBe(2);
    expect(callCount()).toBe(2);
    expect(lookupCalls).toEqual([{ decisionCode: 'service.language' }]);
  });
});

// ---------------------------------------------------------------------------
// Test 7 — External abort signal. The signal is raised between rounds; the
// loop exits with errorKind = 'aborted' on the next iteration.
// ---------------------------------------------------------------------------

describe('runArchitectQuestionLoop — external abort signal', () => {
  it('emits an aborted error result when the signal fires between rounds', async () => {
    const entry = getServiceLanguageEntry();
    const controller = new AbortController();

    // Round 1: non-terminal tool call so the loop iterates again. Between
    // round 1 and round 2 the test aborts the signal; the loop sees it at
    // the top of round 2 and exits cleanly.
    const abortAfterRound1Tool: ArchitectToolRegistryEntry = {
      name: 'noop',
      definition: {
        type: 'function',
        function: {
          name: 'noop',
          description: 'No-op tool used to drive the loop through to round 2.',
          parameters: { type: 'object', properties: {} },
        },
      },
      handler: async () => {
        controller.abort();
        return { acknowledged: true };
      },
    };

    const { client, callCount } = sequencedClient([
      nonTerminalToolCall('noop'),
      // The second response should never be consumed because the loop aborts
      // before issuing round 2.
      submitAnswerResponse('Java 21'),
    ]);

    const result = await runArchitectQuestionLoop({
      entry,
      userResponse: 'java please',
      capturedDecisionsContext: '',
      inlineCascadeSeedMap: '',
      llmClient: client,
      tools: [abortAfterRound1Tool],
      abortSignal: controller.signal,
    });

    expect(result.outcome).toBe('error');
    const err = result as LoopErrorResult;
    expect(err.errorKind).toBe('aborted');
    expect(err.roundsUsed).toBe(1);
    expect(callCount()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Test 8 — Submit-answer parse failure on round 1 triggers retry; the loop
// recovers within budget when round 2 submits a valid value. This covers
// the "structured-output parse-recover" pattern called out in the spec.
// ---------------------------------------------------------------------------

describe('runArchitectQuestionLoop — submit-answer parse recovery', () => {
  it('rejects an invalid single-choice value and recovers on the next round', async () => {
    const entry = getServiceLanguageEntry();
    const { client, callCount } = sequencedClient([
      // Round 1: invalid value (not in choices).
      submitAnswerResponse('Brainfuck 0.1', undefined, 'call-bad'),
      // Round 2: a valid choice.
      submitAnswerResponse('Java 21', undefined, 'call-good'),
    ]);

    const result = await runArchitectQuestionLoop({
      entry,
      userResponse: 'java please',
      capturedDecisionsContext: '',
      inlineCascadeSeedMap: '',
      llmClient: client,
    });

    expect(result.outcome).toBe('answer');
    const ok = result as LoopAnswerOk;
    expect(ok.answerValue).toBe('Java 21');
    expect(ok.roundsUsed).toBe(2);
    expect(callCount()).toBe(2);
  });
});
