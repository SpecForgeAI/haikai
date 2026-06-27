/**
 * Tests -- Mapping Mutation Orchestrator + Coordinator wiring
 * Spec 2026-05-24-target-state-architect-conversation, Task Group 4.
 *
 * Per tasks.md §4.1 (gateway side of the AMS + gateway split):
 *
 *   Gateway Test 7: orchestrator invokes the new endpoint after Spec 2 POST
 *     and appends a `mapping-mutation-summary` turn carrying
 *     `affectedMappings`, `mappingTypeChanges`, `notesDecorations`,
 *     `tableSetSummary`.
 *   + 3 additional gateway tests covering the failure-no-rollback path, the
 *     cascade-accept-batch one-per-decision invocation pattern, and the
 *     exception-pinning element-scoped invocation.
 *
 * Mocking conventions:
 * - The AMS apply-mapping-mutations endpoint is mocked at the
 *   `applyMappingMutationsForDecision` writer boundary.
 * - The Spec-2 captured-decisions POST is mocked at the
 *   `postCapturedDecision` writer boundary (mirrors Commit-3 tests).
 * - Spec-2's `appendTurn` thread-store helper is mocked at the
 *   `targetStateConversationStore` import (signature unchanged per Q3 -- we
 *   only stub the function, never extend its arguments).
 */

import {
  QUESTION_LIBRARY,
  QuestionLibraryEntry,
} from '../../../config/architect-conversation/questionLibrary';
import { MAPPING_MUTATION_RULES } from '../../../config/architect-conversation/mappingMutationRules';
import type { ArchitectLlmClient, CallLlmToolLoopArgs, CallLlmToolLoopResponse } from '../architectLlmClient';
import { SUBMIT_ANSWER_TOOL_NAME } from '../llmLoopRunner';
import { DecisionCaptureOrchestrator, DecisionCaptureDeps } from '../decisionCaptureOrchestrator';
import { answerQuestion, CoordinatorDeps } from '../architectConversationCoordinator';
import type { CreateCapturedDecisionRequestBody } from '../targetStateCapturedDecisionsWriter';
import type { TargetStateCapturedDecision } from '../../targetStateCapturedDecisionsClient';
import {
  MappingMutationOrchestrator,
  MAPPING_MUTATION_ERROR_KIND,
} from '../mappingMutationOrchestrator';
import {
  ApplyMappingMutationsError,
  ApplyMappingMutationsRequestBody,
  ApplyMappingMutationsResponseBody,
} from '../applyMappingMutationsClient';
import type {
  ErrorTurn,
  MappingMutationSummaryTurn,
} from '../turnShape';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getEntry(code: string): QuestionLibraryEntry {
  const entry = QUESTION_LIBRARY.find((e) => e.code === code);
  if (!entry) throw new Error(`Fixture sanity: ${code} entry missing from library.`);
  return entry;
}

interface PostCall {
  projectId: string;
  targetArchitectureId: string;
  body: CreateCapturedDecisionRequestBody;
}

interface AppendCall {
  projectId: string;
  targetArchitectureId: string;
  turn: unknown;
}

interface MutationCall {
  projectId: string;
  targetArchitectureId: string;
  decisionId: string;
  body: ApplyMappingMutationsRequestBody;
}

function makeRecordingDeps(): {
  captureDeps: DecisionCaptureDeps;
  postCalls: PostCall[];
  appendCalls: AppendCall[];
} {
  const postCalls: PostCall[] = [];
  const appendCalls: AppendCall[] = [];
  let postCount = 0;

  const captureDeps: DecisionCaptureDeps = {
    async postCapturedDecision(projectId, targetArchitectureId, body) {
      const currentIndex = postCount;
      postCount += 1;
      postCalls.push({ projectId, targetArchitectureId, body });
      const synth: TargetStateCapturedDecision = {
        decisionId: `decision-${currentIndex + 1}`,
        projectId,
        targetArchitectureId,
        decisionCode: body.decisionCode,
        scopeKind: body.scopeKind,
        scopeRefType: body.scopeRefType ?? null,
        scopeRefId: body.scopeRefId ?? null,
        answerValue: body.answerValue,
        answerSummary: body.answerSummary ?? null,
        standardsLookupRef: body.standardsLookupRef ?? null,
        conversationThreadId: body.conversationThreadId ?? null,
        conversationTurnRef: body.conversationTurnRef ?? null,
        createdAt: '2026-05-24T00:00:00Z',
        createdByTask: body.createdByTask,
        supersededById: null,
      };
      return synth;
    },
    async appendTurn(projectId, targetArchitectureId, turn) {
      appendCalls.push({ projectId, targetArchitectureId, turn });
    },
    async loadConversation(_projectId, _targetArchitectureId) {
      return { schemaVersion: 1, threadId: 'thread-abc', turns: [] };
    },
    newId: () => `id-${postCount}-${Math.random().toString(36).slice(2, 8)}`,
  };
  return { captureDeps, postCalls, appendCalls };
}

/**
 * Build a mutation orchestrator with a stubbed AMS-endpoint client. Returns
 * the orchestrator + the call recorder + a setter so the test can swap in a
 * different response per call (e.g. a 500 error on the 2nd call).
 */
function makeMutationOrchestrator(options: {
  responsePerCall?: ApplyMappingMutationsResponseBody[];
  throwOnNth?: { n: number; err: unknown };
}): {
  orchestrator: MappingMutationOrchestrator;
  mutationCalls: MutationCall[];
} {
  const mutationCalls: MutationCall[] = [];
  let mutationCount = 0;

  const orchestrator = new MappingMutationOrchestrator({
    appendTurn: async () => {
      // appendTurn for the mutation orchestrator is wired through the same
      // recording dep map -- we'd want to inspect both paths, but cleanest is
      // to share the recorder. The closure here is overwritten by the test
      // setup below via the bind helper.
    },
    rules: MAPPING_MUTATION_RULES,
    async applyMutations(projectId, targetArchitectureId, decisionId, body) {
      const currentIndex = mutationCount;
      mutationCount += 1;
      mutationCalls.push({ projectId, targetArchitectureId, decisionId, body });
      if (options.throwOnNth && options.throwOnNth.n === currentIndex) {
        throw options.throwOnNth.err;
      }
      const synth: ApplyMappingMutationsResponseBody = options.responsePerCall?.[currentIndex] ?? {
        affectedMappings: 3,
        mappingTypeChanges: 1,
        notesDecorations: 3,
        tableSetSummary: [
          { tableSet: 'interface', affectedMappings: 2, mappingTypeChanges: 1, notesDecorations: 2 },
          { tableSet: 'endpoint', affectedMappings: 1, mappingTypeChanges: 0, notesDecorations: 1 },
        ],
      };
      return synth;
    },
  });

  return { orchestrator, mutationCalls };
}

/**
 * Wrap a mutation orchestrator so its appendTurn shares the recorder used by
 * the capture deps. The orchestrator is constructed up-front; this helper
 * overrides its internal deps to thread the recorder through.
 */
function bindMutationAppend(
  orchestrator: MappingMutationOrchestrator,
  appendCalls: AppendCall[],
): MappingMutationOrchestrator {
  // The orchestrator constructor's `deps.appendTurn` is replaced via the
  // private `deps` field; we re-build via the constructor with the existing
  // applyMutations + rules + a new appendTurn closure.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const oldDeps = (orchestrator as any).deps;
  return new MappingMutationOrchestrator({
    appendTurn: async (projectId, targetArchitectureId, turn) => {
      appendCalls.push({ projectId, targetArchitectureId, turn });
    },
    rules: oldDeps.rules,
    applyMutations: oldDeps.applyMutations,
  });
}

/** Single-response LLM mock that submits the given answer value. */
function singleAnswerLlmClient(value: unknown): ArchitectLlmClient {
  let called = 0;
  return {
    async callLlmToolLoop(_args: CallLlmToolLoopArgs): Promise<CallLlmToolLoopResponse> {
      called += 1;
      if (called > 1) {
        return { message: { role: 'assistant', content: null, tool_calls: [] } };
      }
      return {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call-1',
              type: 'function',
              function: {
                name: SUBMIT_ANSWER_TOOL_NAME,
                arguments: JSON.stringify({ value }),
              },
            },
          ],
        },
      };
    },
    async callSingleShot(): Promise<{ content: string }> {
      throw new Error('callSingleShot should not be invoked in this test');
    },
  };
}

// ---------------------------------------------------------------------------
// Test 1 -- Coordinator invokes the mutation endpoint after Spec 2 POST and
// appends a mapping-mutation-summary turn carrying the per-table-set counts.
//
// Answering `api.protocol = REST` triggers the api.protocol mapping rule:
// affectedTableSets = ['interface', 'endpoint'], change = 'replaced_by'.
// ---------------------------------------------------------------------------

describe('answerQuestion -- post-capture mapping-mutation invocation', () => {
  it('invokes apply-mapping-mutations after the captured-decision POST and appends a mapping-mutation-summary turn', async () => {
    const entry = getEntry('api.protocol');
    const { captureDeps, postCalls, appendCalls } = makeRecordingDeps();
    const orchestrator = new DecisionCaptureOrchestrator(captureDeps);

    const { orchestrator: rawMutationOrch, mutationCalls } = makeMutationOrchestrator({
      responsePerCall: [
        {
          affectedMappings: 4,
          mappingTypeChanges: 2,
          notesDecorations: 4,
          tableSetSummary: [
            { tableSet: 'interface', affectedMappings: 2, mappingTypeChanges: 1, notesDecorations: 2 },
            { tableSet: 'endpoint', affectedMappings: 2, mappingTypeChanges: 1, notesDecorations: 2 },
          ],
        },
      ],
    });
    const mutationOrchestrator = bindMutationAppend(rawMutationOrch, appendCalls);

    const coordDeps: CoordinatorDeps = {
      orchestrator,
      mappingMutationOrchestrator: mutationOrchestrator,
      appendTurn: captureDeps.appendTurn,
    };

    const outcome = await answerQuestion(
      {
        projectId: 'p-1',
        targetArchitectureId: 't-1',
        sessionId: 'session-1',
        conversationThreadId: 'thread-abc',
        entry,
        userResponse: 'REST please',
        capturedDecisionsContext: '',
        inlineCascadeSeedMap: '',
        // multi-choice prompt -- the LLM submits an array.
        llmClient: singleAnswerLlmClient(['REST/JSON']),
        roundIndex: 1,
      },
      coordDeps,
    );

    expect(outcome.kind).toBe('captured');
    if (outcome.kind !== 'captured') throw new Error('unreachable');

    // The captured-decision POST happened.
    expect(postCalls).toHaveLength(1);
    expect(postCalls[0].body.decisionCode).toBe('api.protocol');

    // The mutation invocation happened exactly once, for the just-written
    // decision id, with the rule subset for api.protocol forwarded verbatim.
    expect(mutationCalls).toHaveLength(1);
    expect(mutationCalls[0].decisionId).toBe('decision-1');
    expect(mutationCalls[0].body).toEqual({
      affectedTableSets: ['interface', 'endpoint'],
      defaultMappingTypeChange: 'replaced_by',
      scopeBoundary: 'parent-not-leaf',
      elementRefType: null,
      elementRefId: null,
    });

    // The mapping-mutation-summary turn was appended last with the AMS
    // response values verbatim.
    const summaryTurn = outcome.mappingMutationSummaryTurn as MappingMutationSummaryTurn | null;
    expect(summaryTurn).not.toBeNull();
    expect(summaryTurn!.kind).toBe('mapping-mutation-summary');
    expect(summaryTurn!.affectedMappings).toBe(4);
    expect(summaryTurn!.mappingTypeChanges).toBe(2);
    expect(summaryTurn!.notesDecorations).toBe(4);
    expect(summaryTurn!.tableSetSummary).toHaveLength(2);
    expect(summaryTurn!.tableSetSummary[0]).toEqual({
      tableSet: 'interface',
      affectedMappings: 2,
      mappingTypeChanges: 1,
      notesDecorations: 2,
    });

    // Append sequence: question, answer, decision-captured (no cascades on
    // api.protocol primary for this fixture), mapping-mutation-summary.
    const turnKinds = appendCalls.map((c) => (c.turn as { kind: string }).kind);
    // api.protocol's library entry HAS cascades -- cascade-summary appears.
    expect(turnKinds).toContain('mapping-mutation-summary');
    expect(turnKinds.indexOf('mapping-mutation-summary'))
      .toBeGreaterThan(turnKinds.indexOf('decision-captured'));
  });
});

// ---------------------------------------------------------------------------
// Test 2 -- Mutation failure appends an error turn with
// errorKind='mapping-mutation-failed' and the captured decision is NOT rolled
// back (the captured-decision POST already succeeded; the orchestrator must
// not undo it).
// ---------------------------------------------------------------------------

describe('answerQuestion -- mutation failure does not roll back the captured decision', () => {
  it('surfaces an error turn with mapping-mutation-failed and leaves the captured decision intact', async () => {
    const entry = getEntry('db.engine');
    const { captureDeps, postCalls, appendCalls } = makeRecordingDeps();
    const orchestrator = new DecisionCaptureOrchestrator(captureDeps);

    const { orchestrator: rawMutationOrch, mutationCalls } = makeMutationOrchestrator({
      throwOnNth: { n: 0, err: new ApplyMappingMutationsError(503, 'AMS unavailable') },
    });
    const mutationOrchestrator = bindMutationAppend(rawMutationOrch, appendCalls);

    const coordDeps: CoordinatorDeps = {
      orchestrator,
      mappingMutationOrchestrator: mutationOrchestrator,
      appendTurn: captureDeps.appendTurn,
    };

    const outcome = await answerQuestion(
      {
        projectId: 'p-1',
        targetArchitectureId: 't-1',
        sessionId: 'session-1',
        conversationThreadId: 'thread-abc',
        entry,
        userResponse: 'Postgres 18',
        capturedDecisionsContext: '',
        inlineCascadeSeedMap: '',
        llmClient: singleAnswerLlmClient('Postgres'),
        roundIndex: 1,
      },
      coordDeps,
    );

    expect(outcome.kind).toBe('captured');
    if (outcome.kind !== 'captured') throw new Error('unreachable');

    // Captured decision POSTed successfully -- it must NOT have been rolled
    // back (no DELETE/PATCH follow-up by design).
    expect(postCalls).toHaveLength(1);
    expect(outcome.capture.decision.decisionId).toBe('decision-1');

    // Mutation call attempted once and threw.
    expect(mutationCalls).toHaveLength(1);

    // The summary turn is null on the error path.
    expect(outcome.mappingMutationSummaryTurn).toBeNull();

    // The outcome's mappingMutation discriminator is 'error' with the
    // mapping-mutation-failed errorKind.
    expect(outcome.mappingMutation).not.toBeNull();
    expect(outcome.mappingMutation!.kind).toBe('error');
    if (outcome.mappingMutation!.kind !== 'error') throw new Error('unreachable');
    const errorTurn = outcome.mappingMutation!.errorTurn as ErrorTurn;
    expect(errorTurn.kind).toBe('error');
    expect(errorTurn.errorKind).toBe(MAPPING_MUTATION_ERROR_KIND);
    expect(errorTurn.errorMessage).toContain('HTTP 503');

    // The error turn was appended to the transcript (after the captured turn).
    const turnKinds = appendCalls.map((c) => (c.turn as { kind: string }).kind);
    expect(turnKinds).toContain('decision-captured');
    expect(turnKinds).toContain('error');
    expect(turnKinds.indexOf('error')).toBeGreaterThan(turnKinds.indexOf('decision-captured'));
  });
});

// ---------------------------------------------------------------------------
// Test 3 -- Cascade-accept-batch path: per task §4.5 the orchestrator runs
// once per cascaded decision id. We exercise this by walking the
// captureDeps cascade batch and invoking the mutation orchestrator per
// returned row.
// ---------------------------------------------------------------------------

describe('cascade-accept-batch -- one mutation call per cascaded decision id', () => {
  it('invokes apply-mapping-mutations exactly once for each cascaded decision row', async () => {
    const { captureDeps, appendCalls } = makeRecordingDeps();
    const orchestrator = new DecisionCaptureOrchestrator(captureDeps);
    const entry = getEntry('service.language');
    // service.language cascades to: service.runtime, testing.unit, dto.style, build.tool
    // (4 entries) -- accept the full batch.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const proposals = (orchestrator as any).constructor === DecisionCaptureOrchestrator
      ? // computeCascadeProposals is exported but invoking via the helper here keeps the test focused
        (await import('../decisionCaptureOrchestrator')).computeCascadeProposals(entry, { framework: 'Java', version: '21' })
      : [];

    expect(proposals.length).toBe(4);

    const batchOutcome = await orchestrator.acceptCascadeBatch({
      projectId: 'p-1',
      targetArchitectureId: 't-1',
      sessionId: 'session-1',
      conversationThreadId: 'thread-abc',
      proposals,
    });

    // Now drive the mutation orchestrator per row -- this mirrors what the
    // future UI batch-coordinator does in production.
    const { orchestrator: rawMutationOrch, mutationCalls } = makeMutationOrchestrator({});
    const mutationOrchestrator = bindMutationAppend(rawMutationOrch, appendCalls);
    for (const decision of batchOutcome.decisions) {
      await mutationOrchestrator.applyForCapturedDecision({
        projectId: 'p-1',
        targetArchitectureId: 't-1',
        decisionId: decision.decisionId,
        decisionCode: decision.decisionCode,
      });
    }

    // 4 cascaded rows -> 4 mutation invocations.
    expect(mutationCalls).toHaveLength(4);
    const decisionIds = mutationCalls.map((c) => c.decisionId);
    expect(new Set(decisionIds).size).toBe(4); // unique ids
    // Codes line up with the cascades (notes-only for these specific codes).
    const decisionCodes = mutationCalls.map((c) => c.body.defaultMappingTypeChange);
    // service.runtime, testing.unit, dto.style, build.tool are all notes-only
    // in MAPPING_MUTATION_RULES per the Commit 1 config.
    expect(decisionCodes).toEqual(['none', 'none', 'none', 'none']);
  });
});

// ---------------------------------------------------------------------------
// Test 4 -- Exception-pinning: when the captured decision was a per-element
// exception, the mutation orchestrator invocation carries elementRefType +
// elementRefId so AMS narrows the affected set to a single row.
// ---------------------------------------------------------------------------

describe('exception-pinned -- mutation call carries elementRef narrowing', () => {
  it('forwards elementRefType + elementRefId on the mutation request body', async () => {
    const { captureDeps, appendCalls } = makeRecordingDeps();
    const orchestrator = new DecisionCaptureOrchestrator(captureDeps);
    const entry = getEntry('service.framework');

    const pinOutcome = await orchestrator.pinException({
      projectId: 'p-1',
      targetArchitectureId: 't-1',
      sessionId: 'session-1',
      conversationThreadId: 'thread-abc',
      entry,
      scope: { kind: 'element', refType: 'service', refId: 'service-legacy-1' },
      answerValue: 'Spring Classic 5.3 (legacy retained)',
    });

    const { orchestrator: rawMutationOrch, mutationCalls } = makeMutationOrchestrator({});
    const mutationOrchestrator = bindMutationAppend(rawMutationOrch, appendCalls);

    await mutationOrchestrator.applyForCapturedDecision({
      projectId: 'p-1',
      targetArchitectureId: 't-1',
      decisionId: pinOutcome.decision.decisionId,
      decisionCode: pinOutcome.decision.decisionCode,
      elementRef: { refType: 'service', refId: 'service-legacy-1' },
    });

    expect(mutationCalls).toHaveLength(1);
    expect(mutationCalls[0].body).toEqual({
      affectedTableSets: ['service'],
      defaultMappingTypeChange: 'keep-equivalent',
      scopeBoundary: 'parent-not-leaf',
      elementRefType: 'service',
      elementRefId: 'service-legacy-1',
    });
  });
});
