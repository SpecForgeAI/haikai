/**
 * Tests — Open-Phase Capture Path (route level)
 * Spec 2026-06-06-architect-conversation-open-ended-phase, Task Group 4 (4.1).
 *
 * The dedicated `/open-phase/*` capture path writes user-raised decisions as
 * `adhoc.<slug>` rows and free-form notes as per-note-unique `note.<slug>` rows
 * via `postCapturedDecision` (mocked at the AMS writer boundary here). The LLM
 * is mocked at the `ArchitectLlmClient` boundary (the established pattern) by
 * swapping `deps.llmClient` with a canned tool-call client. Grounding +
 * append + loadConversation are stubbed so the tests are hermetic.
 *
 * 6 focused tests (within the 4.1 cap):
 *   1. `/open-phase/pick` writes an `adhoc.<slug>` ARCHITECTURE-scoped row with
 *      NO scopeRefType/scopeRefId and the distinct `architect-adhoc-decision`
 *      createdByTask.
 *   2. `/open-phase/pick` does NOT 404 on the non-library `adhoc.*` code
 *      (contrast: `/capture` on a non-library code hard-404s).
 *   3. `/open-phase/summarise` writes per-note UNIQUE `note.<slug>` codes (two
 *      distinct notes → two distinct codes, no mutual supersession) with the
 *      distinct `architect-discussion-note` createdByTask.
 *   4. `/open-phase/pick` free-text escape is captured verbatim as the answer.
 *   5. `/open-phase/begin` appends the `open-phase-prompt` turn verbatim.
 *   6. the preset `/capture` route STILL hard-404s on a non-library code (the
 *      invariant the new path exists to bypass).
 */

import request from 'supertest';
import express from 'express';

import { architectConversationRouter } from '../routes/architectConversation';
import {
  setArchitectConversationDeps,
  resetArchitectConversationDeps,
} from '../routes/architectConversation';
import type {
  ArchitectLlmClient,
  CallLlmToolLoopArgs,
  CallLlmToolLoopResponse,
} from '../services/architectConversation/architectLlmClient';
import type { CreateCapturedDecisionRequestBody } from '../services/architectConversation/targetStateCapturedDecisionsWriter';
import type { TargetStateCapturedDecision } from '../services/targetStateCapturedDecisionsClient';

jest.mock('../services/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PROJECT_ID = '550e8400-e29b-41d4-a716-446655440000';
const TARGET_ID = 'tgt-arch-open-phase';

/**
 * An LLM client that returns a canned tool-call response per tool name. The
 * route's coordinator handlers call exactly one tool per request.
 */
function cannedToolClient(
  byTool: Record<string, unknown>,
): ArchitectLlmClient {
  return {
    async callLlmToolLoop(args: CallLlmToolLoopArgs): Promise<CallLlmToolLoopResponse> {
      // The open-phase loop pins toolChoice to { type:'function', function:{name} }.
      const choice = args.toolChoice;
      const toolName =
        choice && typeof choice === 'object' && 'function' in choice
          ? (choice as { function: { name: string } }).function.name
          : null;
      if (toolName && byTool[toolName] !== undefined) {
        return {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call-1',
                type: 'function',
                function: { name: toolName, arguments: JSON.stringify(byTool[toolName]) },
              },
            ],
          },
        };
      }
      // Free-form reply path (toolChoice 'none') or unknown — return plain text.
      return { message: { role: 'assistant', content: 'ok', tool_calls: [] } };
    },
    async callSingleShot() {
      throw new Error('callSingleShot should not be invoked in this test');
    },
  };
}

/** A `postCapturedDecision` stub that records every write + echoes a row. */
function recordingWriter(): {
  fn: jest.Mock;
  calls: CreateCapturedDecisionRequestBody[];
} {
  const calls: CreateCapturedDecisionRequestBody[] = [];
  const fn = jest.fn(
    async (
      _projectId: string,
      targetArchitectureId: string,
      body: CreateCapturedDecisionRequestBody,
    ): Promise<TargetStateCapturedDecision> => {
      calls.push(body);
      return {
        decisionId: `dec-${calls.length}`,
        projectId: _projectId,
        targetArchitectureId,
        decisionCode: body.decisionCode,
        scopeKind: body.scopeKind,
        scopeRefType: body.scopeRefType ?? null,
        scopeRefId: body.scopeRefId ?? null,
        answerValue: body.answerValue,
        answerSummary: body.answerSummary ?? null,
        standardsLookupRef: null,
        conversationThreadId: body.conversationThreadId ?? null,
        conversationTurnRef: null,
        createdAt: '2026-06-06T00:00:00Z',
        createdByTask: body.createdByTask,
        supersededById: null,
      };
    },
  );
  return { fn: fn as unknown as jest.Mock, calls };
}

function buildApp(): express.Application {
  const app = express();
  app.use(express.json());
  app.use('/api', architectConversationRouter);
  return app;
}

describe('Open-phase capture path (Spec 2026-06-06, Task Group 4)', () => {
  let appendedTurns: unknown[];

  beforeEach(() => {
    appendedTurns = [];
    setArchitectConversationDeps({
      // Hermetic: no real grounding fetch, no real thread store.
      resolveOpenPhaseGrounding: (async () => 'GROUNDING') as never,
      appendTurn: (async (_p: string, _t: string, turn: unknown) => {
        appendedTurns.push(turn);
      }) as never,
      loadConversation: (async () => ({
        schemaVersion: 1 as const,
        threadId: 'thr-open-phase',
        turns: appendedTurns,
      })) as never,
    });
  });

  afterEach(() => {
    resetArchitectConversationDeps();
    jest.clearAllMocks();
  });

  // 1 — adhoc decision write shape.
  it('POST /open-phase/pick writes an adhoc.<slug> architecture-scoped row (distinct createdByTask, no element ref)', async () => {
    const writer = recordingWriter();
    setArchitectConversationDeps({
      postCapturedDecision: writer.fn as never,
      llmClient: cannedToolClient({
        'capture-user-decision': {
          topicLabel: 'Batch processing',
          selectedValues: ['Spring Batch'],
          answerSummary: 'Use Spring Batch',
        },
      }),
    });

    const res = await request(buildApp())
      .post(
        `/api/projects/${PROJECT_ID}/target-architectures/${TARGET_ID}/architect-conversation/open-phase/pick`,
      )
      .send({ topicLabel: 'Batch processing', selectedValues: ['Spring Batch'] });

    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe('captured');
    expect(writer.calls).toHaveLength(1);
    const body = writer.calls[0];
    expect(body.decisionCode).toBe('adhoc.batch-processing');
    expect(body.scopeKind).toBe('architecture');
    // Architecture-wide: no element ref (S1).
    expect(body.scopeRefType ?? null).toBeNull();
    expect(body.scopeRefId ?? null).toBeNull();
    expect(body.createdByTask).toBe('architect-adhoc-decision');
    expect(body.answerValue).toBe('Spring Batch');
    // A decision-captured turn is appended (transcript record).
    expect(appendedTurns.some((t) => (t as { kind?: string }).kind === 'decision-captured')).toBe(
      true,
    );
    // The user-pick turn is appended too.
    expect(appendedTurns.some((t) => (t as { kind?: string }).kind === 'user-pick')).toBe(true);
  });

  // 2 — the NEW path does NOT 404 on the non-library adhoc.* code.
  it('POST /open-phase/pick does NOT 404 on the non-library adhoc.* code', async () => {
    const writer = recordingWriter();
    setArchitectConversationDeps({
      postCapturedDecision: writer.fn as never,
      llmClient: cannedToolClient({
        'capture-user-decision': {
          topicLabel: 'Totally novel topic not in the library',
          selectedValues: ['Option A'],
        },
      }),
    });

    const res = await request(buildApp())
      .post(
        `/api/projects/${PROJECT_ID}/target-architectures/${TARGET_ID}/architect-conversation/open-phase/pick`,
      )
      .send({ topicLabel: 'Totally novel topic not in the library', selectedValues: ['Option A'] });

    expect(res.status).not.toBe(404);
    expect(res.status).toBe(200);
    expect(writer.calls[0].decisionCode.startsWith('adhoc.')).toBe(true);
  });

  // 3 — note writes: per-note unique codes, distinct createdByTask, no supersession.
  it('POST /open-phase/summarise writes per-note UNIQUE note.<slug> rows (no mutual supersession)', async () => {
    const writer = recordingWriter();
    // Two free-form-discussion turns so the route reconstructs a transcript.
    appendedTurns.push(
      { kind: 'free-form-discussion', speaker: 'user', messageText: 'Cutover must be a holiday' },
      { kind: 'free-form-discussion', speaker: 'assistant', messageText: 'Noted.' },
    );
    setArchitectConversationDeps({
      postCapturedDecision: writer.fn as never,
      llmClient: cannedToolClient({
        'record-discussion-note': {
          notes: [
            { topicLabel: 'Cutover window', noteText: 'Must cut over on a bank holiday.' },
            { topicLabel: 'Cutover window', noteText: 'Freeze code two weeks prior.' },
            { topicLabel: 'Data retention', noteText: 'Keep 7 years for compliance.' },
          ],
        },
      }),
    });

    const res = await request(buildApp())
      .post(
        `/api/projects/${PROJECT_ID}/target-architectures/${TARGET_ID}/architect-conversation/open-phase/summarise`,
      )
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe('notes');
    expect(writer.calls).toHaveLength(3);
    const codes = writer.calls.map((c) => c.decisionCode);
    // Two notes on the SAME topic must NOT collide → distinct codes.
    expect(new Set(codes).size).toBe(3);
    expect(codes).toEqual([
      'note.cutover-window-1',
      'note.cutover-window-2',
      'note.data-retention-3',
    ]);
    // All notes carry the distinct note createdByTask + architecture scope.
    for (const c of writer.calls) {
      expect(c.createdByTask).toBe('architect-discussion-note');
      expect(c.scopeKind).toBe('architecture');
    }
  });

  // 4 — free-text escape captured verbatim.
  it('POST /open-phase/pick captures the free-text "something else…" answer verbatim', async () => {
    const writer = recordingWriter();
    setArchitectConversationDeps({
      postCapturedDecision: writer.fn as never,
      llmClient: cannedToolClient({
        'capture-user-decision': {
          topicLabel: 'Messaging',
          selectedValues: [],
          freeTextValue: 'Bespoke gRPC streaming bus',
        },
      }),
    });

    const res = await request(buildApp())
      .post(
        `/api/projects/${PROJECT_ID}/target-architectures/${TARGET_ID}/architect-conversation/open-phase/pick`,
      )
      .send({ topicLabel: 'Messaging', freeTextValue: 'Bespoke gRPC streaming bus' });

    expect(res.status).toBe(200);
    expect(writer.calls[0].answerValue).toBe('Bespoke gRPC streaming bus');
  });

  // 5 — begin appends the open-phase-prompt turn.
  it('POST /open-phase/begin appends the open-phase-prompt turn with suggested areas', async () => {
    setArchitectConversationDeps({
      llmClient: cannedToolClient({
        'suggest-candidate-areas': {
          promptText: 'Other areas to decide?',
          areas: [{ label: 'Batch processing strategy' }, { label: 'Caching layer' }],
        },
      }),
    });

    const res = await request(buildApp())
      .post(
        `/api/projects/${PROJECT_ID}/target-architectures/${TARGET_ID}/architect-conversation/open-phase/begin`,
      )
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe('prompt');
    expect(res.body.openPhasePromptTurn.kind).toBe('open-phase-prompt');
    expect(res.body.openPhasePromptTurn.suggestedAreas).toHaveLength(2);
    expect(appendedTurns.some((t) => (t as { kind?: string }).kind === 'open-phase-prompt')).toBe(
      true,
    );
  });

  // 6 — INVARIANT: the preset /capture route STILL hard-404s on a non-library code.
  it('the preset /capture route STILL hard-404s on a non-library code (the path the new route bypasses)', async () => {
    const res = await request(buildApp())
      .post(
        `/api/projects/${PROJECT_ID}/target-architectures/${TARGET_ID}/architect-conversation/capture`,
      )
      .send({ sessionId: 's1', decisionCode: 'adhoc.something', value: 'x' });

    expect(res.status).toBe(404);
    expect(res.body.error).toContain('Question library entry not found');
  });
});
