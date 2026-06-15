/**
 * Tests — Open-Phase Sibling LLM Loop Runner
 * Spec 2026-06-06-architect-conversation-open-ended-phase, Task Group 3 (3.1).
 *
 * Scope: the SIBLING open-phase loop's four tools + the SAME hard-limit / abort
 * reuse → `error` result. The LLM is mocked at the `ArchitectLlmClient`
 * boundary (the established pattern). We do NOT re-test the preset loop here.
 *
 * 8 focused tests (the 3.1 cap):
 *   1. `suggest-candidate-areas` dispatch → parsed areas + prompt.
 *   2. `propose-options-for-topic` SINGLE shape + NO "Not applicable".
 *   3. `propose-options-for-topic` MULTI shape.
 *   4. `capture-user-decision` dispatch (free-text escape).
 *   5. `record-discussion-note` dispatch (per-topic notes).
 *   6. per-call TIMEOUT → `llm-call-timeout` error result (reuses withTimeout).
 *   7. external ABORT → `aborted` error result.
 *   8. malformed tool output → `tool-output-malformed` error result.
 */

import type {
  ArchitectLlmClient,
  CallLlmToolLoopArgs,
  CallLlmToolLoopResponse,
} from '../architectLlmClient';
import {
  ARCHITECT_LOOP_PER_CALL_TIMEOUT_MS,
  ARCHITECT_LOOP_WALL_CLOCK_MS,
} from '../llmLoopRunner';
import {
  CAPTURE_USER_DECISION_TOOL,
  PROPOSE_OPTIONS_FOR_TOPIC_TOOL,
  RECORD_DISCUSSION_NOTE_TOOL,
  SUGGEST_CANDIDATE_AREAS_TOOL,
  captureUserDecision,
  proposeOptionsForTopic,
  recordDiscussionNotes,
  suggestCandidateAreas,
  type OpenPhaseLoopErrorResult,
} from '../openPhaseLoopRunner';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A client whose `callLlmToolLoop` returns a single canned tool-call response. */
function toolCallClient(
  toolName: string,
  args: unknown,
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
              function: { name: toolName, arguments: JSON.stringify(args) },
            },
          ],
        },
      };
    },
    async callSingleShot() {
      throw new Error('callSingleShot should not be invoked in this test');
    },
  };
  return { client, lastArgs: () => lastArgs };
}

const GROUNDING = '## Captured decisions so far\n`db.engine` = Postgres 18';

// ---------------------------------------------------------------------------
// 1 — suggest-candidate-areas
// ---------------------------------------------------------------------------

describe('openPhaseLoopRunner — suggest-candidate-areas', () => {
  it('dispatches the tool and returns the parsed areas + prompt text', async () => {
    const { client, lastArgs } = toolCallClient(SUGGEST_CANDIDATE_AREAS_TOOL, {
      promptText: 'Other areas to decide?',
      areas: [
        { label: 'Batch processing strategy', rationale: 'Legacy nightly jobs detected' },
        { label: 'Caching layer' },
        { junk: 'ignored — no label' },
      ],
    });

    const result = await suggestCandidateAreas({ llmClient: client, grounding: GROUNDING });

    expect(result.outcome).toBe('ok');
    if (result.outcome !== 'ok') return;
    expect(result.payload.promptText).toBe('Other areas to decide?');
    expect(result.payload.areas).toEqual([
      { label: 'Batch processing strategy', rationale: 'Legacy nightly jobs detected' },
      { label: 'Caching layer' },
    ]);
    // The tool is pinned via toolChoice and grounding reaches the prompt.
    expect(lastArgs()?.toolChoice).toEqual({
      type: 'function',
      function: { name: SUGGEST_CANDIDATE_AREAS_TOOL },
    });
    const userContent = (lastArgs()?.messages ?? [])
      .map((m) => m.content ?? '')
      .join('\n');
    expect(userContent).toContain('Postgres 18');
  });
});

// ---------------------------------------------------------------------------
// 2 — propose-options-for-topic (single) + NO "Not applicable"
// ---------------------------------------------------------------------------

describe('openPhaseLoopRunner — propose-options-for-topic (single)', () => {
  it('returns a single-select proposal and filters out any "Not applicable" option (P4)', async () => {
    const { client } = toolCallClient(PROPOSE_OPTIONS_FOR_TOPIC_TOOL, {
      topicLabel: 'Batch processing strategy',
      selectionMode: 'single',
      options: [
        { value: 'Spring Batch' },
        { value: 'Quartz scheduler', label: 'Quartz' },
        { value: 'Not applicable' }, // must be dropped (P4)
        { value: 'not_applicable' }, // must be dropped (P4)
      ],
    });

    const result = await proposeOptionsForTopic({
      llmClient: client,
      grounding: GROUNDING,
      topicLabel: 'Batch processing strategy',
    });

    expect(result.outcome).toBe('ok');
    if (result.outcome !== 'ok') return;
    expect(result.payload.selectionMode).toBe('single');
    expect(result.payload.options).toEqual([
      { value: 'Spring Batch' },
      { value: 'Quartz scheduler', label: 'Quartz' },
    ]);
    // No "Not applicable" sentinel survives.
    const values = result.payload.options.map((o) => o.value.toLowerCase());
    expect(values.some((v) => v.replace(/[\s_-]+/g, '') === 'notapplicable')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3 — propose-options-for-topic (multi)
// ---------------------------------------------------------------------------

describe('openPhaseLoopRunner — propose-options-for-topic (multi)', () => {
  it('returns a multi-select proposal verbatim', async () => {
    const { client } = toolCallClient(PROPOSE_OPTIONS_FOR_TOPIC_TOOL, {
      topicLabel: 'Observability stack',
      selectionMode: 'multi',
      options: [{ value: 'Prometheus' }, { value: 'Grafana' }, { value: 'OpenTelemetry' }],
    });

    const result = await proposeOptionsForTopic({
      llmClient: client,
      grounding: GROUNDING,
      topicLabel: 'Observability stack',
    });

    expect(result.outcome).toBe('ok');
    if (result.outcome !== 'ok') return;
    expect(result.payload.selectionMode).toBe('multi');
    expect(result.payload.options.map((o) => o.value)).toEqual([
      'Prometheus',
      'Grafana',
      'OpenTelemetry',
    ]);
  });
});

// ---------------------------------------------------------------------------
// 4 — capture-user-decision (free-text escape)
// ---------------------------------------------------------------------------

describe('openPhaseLoopRunner — capture-user-decision', () => {
  it('dispatches the tool and returns the structured pick (free-text escape)', async () => {
    const { client } = toolCallClient(CAPTURE_USER_DECISION_TOOL, {
      topicLabel: 'Batch processing strategy',
      selectedValues: [],
      freeTextValue: 'Custom event-driven pipeline on Kafka',
      answerSummary: 'Event-driven batch via Kafka',
    });

    const result = await captureUserDecision({
      llmClient: client,
      grounding: GROUNDING,
      topicLabel: 'Batch processing strategy',
      freeTextValue: 'Custom event-driven pipeline on Kafka',
    });

    expect(result.outcome).toBe('ok');
    if (result.outcome !== 'ok') return;
    expect(result.payload.topicLabel).toBe('Batch processing strategy');
    expect(result.payload.freeTextValue).toBe('Custom event-driven pipeline on Kafka');
    expect(result.payload.selectedValues).toEqual([]);
    expect(result.payload.answerSummary).toBe('Event-driven batch via Kafka');
  });
});

// ---------------------------------------------------------------------------
// 5 — record-discussion-note (per-topic notes)
// ---------------------------------------------------------------------------

describe('openPhaseLoopRunner — record-discussion-note', () => {
  it('dispatches the tool and returns per-topic structured notes', async () => {
    const { client } = toolCallClient(RECORD_DISCUSSION_NOTE_TOOL, {
      notes: [
        { topicLabel: 'Cutover window', noteText: 'Must cut over on a bank holiday.' },
        { topicLabel: 'Data retention', noteText: 'Keep 7 years for compliance.' },
        { topicLabel: 'incomplete' }, // dropped (no noteText)
      ],
    });

    const result = await recordDiscussionNotes({
      llmClient: client,
      grounding: GROUNDING,
      transcript: 'user: ...\nassistant: ...',
    });

    expect(result.outcome).toBe('ok');
    if (result.outcome !== 'ok') return;
    expect(result.payload.notes).toEqual([
      { topicLabel: 'Cutover window', noteText: 'Must cut over on a bank holiday.' },
      { topicLabel: 'Data retention', noteText: 'Keep 7 years for compliance.' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// 6 — per-call timeout → llm-call-timeout (reuses withTimeout/abort mechanics)
// ---------------------------------------------------------------------------

describe('openPhaseLoopRunner — per-call timeout', () => {
  it('emits llm-call-timeout when the single LLM call exceeds the per-call cap', async () => {
    jest.useFakeTimers();
    try {
      const client: ArchitectLlmClient = {
        callLlmToolLoop: () =>
          new Promise<CallLlmToolLoopResponse>(() => {
            /* never resolves */
          }),
        callSingleShot: async () => {
          throw new Error('not used');
        },
      };

      const SHORT_CALL_CAP_MS = 50;
      const promise = suggestCandidateAreas({
        llmClient: client,
        grounding: GROUNDING,
        perCallTimeoutMs: SHORT_CALL_CAP_MS,
        wallClockMs: 10_000,
      });

      await Promise.resolve();
      jest.advanceTimersByTime(SHORT_CALL_CAP_MS + 1);

      const result = await promise;
      expect(result.outcome).toBe('error');
      const err = result as OpenPhaseLoopErrorResult;
      expect(err.errorKind).toBe('llm-call-timeout');
      expect(err.errorMessage).toContain(`${SHORT_CALL_CAP_MS}ms`);
    } finally {
      jest.useRealTimers();
    }

    // Sanity: the SAME hard limits as the preset loop are reused.
    expect(ARCHITECT_LOOP_PER_CALL_TIMEOUT_MS).toBe(30_000);
    expect(ARCHITECT_LOOP_WALL_CLOCK_MS).toBe(120_000);
  });
});

// ---------------------------------------------------------------------------
// 7 — external abort → aborted
// ---------------------------------------------------------------------------

describe('openPhaseLoopRunner — external abort', () => {
  it('emits an aborted error result when the signal is already raised', async () => {
    const controller = new AbortController();
    controller.abort();
    let called = 0;
    const client: ArchitectLlmClient = {
      async callLlmToolLoop() {
        called += 1;
        return { message: { role: 'assistant', content: null, tool_calls: [] } };
      },
      async callSingleShot() {
        throw new Error('not used');
      },
    };

    const result = await proposeOptionsForTopic({
      llmClient: client,
      grounding: GROUNDING,
      topicLabel: 'X',
      abortSignal: controller.signal,
    });

    expect(result.outcome).toBe('error');
    const err = result as OpenPhaseLoopErrorResult;
    expect(err.errorKind).toBe('aborted');
    // Aborted up-front → the LLM is never called.
    expect(called).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 8 — malformed tool output → tool-output-malformed
// ---------------------------------------------------------------------------

describe('openPhaseLoopRunner — malformed tool output', () => {
  it('maps a malformed tool payload to a tool-output-malformed error result', async () => {
    // `options` is required to be a non-empty array — send a non-array.
    const { client } = toolCallClient(PROPOSE_OPTIONS_FOR_TOPIC_TOOL, {
      topicLabel: 'Batch',
      selectionMode: 'single',
      options: 'not-an-array',
    });

    const result = await proposeOptionsForTopic({
      llmClient: client,
      grounding: GROUNDING,
      topicLabel: 'Batch',
    });

    expect(result.outcome).toBe('error');
    const err = result as OpenPhaseLoopErrorResult;
    expect(err.errorKind).toBe('tool-output-malformed');
  });
});
