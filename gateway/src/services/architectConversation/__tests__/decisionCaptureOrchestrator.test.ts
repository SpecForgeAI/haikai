/**
 * Tests — Decision Capture Orchestrator + Coordinator
 * Spec 2026-05-24-target-state-architect-conversation, Task Group 3.
 *
 * Per tasks.md §3.1 — 4-8 focused backend tests covering standards seed-map
 * cascade pre-fill AND decision capture (Backend Test Groups 3 + 4 combined).
 *
 * - LLM is mocked at the `ArchitectLlmClient` boundary (the Group 2 mock seam).
 * - Spec 2's POST captured-decisions endpoint is mocked at the
 *   `postCapturedDecision` writer boundary so no real HTTP fires.
 * - Spec 2's `appendTurn` thread-store helper is mocked at the
 *   `targetStateConversationStore` import (signature unchanged per Q3 — we
 *   only stub the function, never extend its arguments).
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
import { SUBMIT_ANSWER_TOOL_NAME } from '../llmLoopRunner';
import {
  ARCHITECT_CONVERSATION_TASK_NAME,
  DecisionCaptureDeps,
  DecisionCaptureOrchestrator,
  computeAffectedDownstreamCodes,
  computeCascadeProposals,
} from '../decisionCaptureOrchestrator';
import { answerQuestion, captureDeterministicAnswer, CoordinatorDeps } from '../architectConversationCoordinator';
import type { CreateCapturedDecisionRequestBody } from '../targetStateCapturedDecisionsWriter';
import type { TargetStateCapturedDecision } from '../../targetStateCapturedDecisionsClient';
import type {
  CascadeAcceptedTurn,
  CascadeOverriddenTurn,
  CascadeSummaryTurn,
  DecisionCapturedTurn,
  EditSupersededTurn,
  SystemSkipTurn,
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

/**
 * Build a thin recording wrapper around the orchestrator deps. The `postFn`
 * shapes the returned captured-decision row from the request body so callers
 * can drive multiple sequential POSTs without re-stubbing per call.
 */
function makeRecordingDeps(
  options: {
    /** Override the generated rows (one per POST). Defaults to a synthesised row that mirrors the request body. */
    rowOverrides?: Array<Partial<TargetStateCapturedDecision>>;
    /** Sequence of synthetic UUIDs used for shared `conversationTurnRef` values etc. */
    idSequence?: string[];
    /** If set, the Nth POST (0-indexed) throws this error instead of returning. */
    throwOnNthPost?: { n: number; err: unknown };
  } = {},
): {
  deps: DecisionCaptureDeps;
  postCalls: PostCall[];
  appendCalls: AppendCall[];
} {
  const postCalls: PostCall[] = [];
  const appendCalls: AppendCall[] = [];
  const ids = options.idSequence ? [...options.idSequence] : [];
  let postCount = 0;

  const deps: DecisionCaptureDeps = {
    async postCapturedDecision(projectId, targetArchitectureId, body) {
      const currentIndex = postCount;
      postCount += 1;
      postCalls.push({ projectId, targetArchitectureId, body });
      if (options.throwOnNthPost && options.throwOnNthPost.n === currentIndex) {
        throw options.throwOnNthPost.err;
      }
      const override = options.rowOverrides?.[currentIndex] ?? {};
      const synth: TargetStateCapturedDecision = {
        decisionId: override.decisionId ?? `decision-${currentIndex + 1}`,
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
        ...override,
      };
      return synth;
    },
    async appendTurn(projectId, targetArchitectureId, turn) {
      appendCalls.push({ projectId, targetArchitectureId, turn });
    },
    async loadConversation(_projectId, _targetArchitectureId) {
      return { schemaVersion: 1, threadId: 'thread-abc', turns: [] };
    },
    newId: () => {
      if (ids.length > 0) return ids.shift() as string;
      return `id-${postCount}-${Math.random().toString(36).slice(2, 8)}`;
    },
  };

  return { deps, postCalls, appendCalls };
}

/** Build a single-response LLM mock that submits the given answer value. */
function singleAnswerLlmClient(value: unknown): ArchitectLlmClient {
  let called = 0;
  return {
    async callLlmToolLoop(_args: CallLlmToolLoopArgs): Promise<CallLlmToolLoopResponse> {
      called += 1;
      if (called > 1) {
        // Shouldn't happen in these tests; emit an empty response to surface the bug.
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
// Test 1 — Happy path per-question + cascade-summary computation
//
// Answering `service.language` with the versioned {framework:'Java',
// version:'21'} value (the bare-stem object the frontend control emits) fires
// the inline cascade seed map for `service.runtime` -> Eclipse Temurin,
// `testing.unit` -> JUnit, `dto.style` -> Java records, `build.tool` -> Gradle
// (each carrying the entry's `sourceStandardId`). The deterministic capture
// path (the real versioned-code path) writes ONE captured-decision row (the
// primary answer; cascades are NOT yet written) and emits a `cascade-summary`
// turn carrying all 4 proposals.
// ---------------------------------------------------------------------------

describe('answerQuestion — primary answer with cascade summary', () => {
  it('writes the primary decision row and emits a cascade-summary turn listing all 4 cascades', async () => {
    const entry = getEntry('service.language');
    const { deps, postCalls, appendCalls } = makeRecordingDeps();
    const orchestrator = new DecisionCaptureOrchestrator(deps);

    const coordDeps: CoordinatorDeps = {
      orchestrator,
      appendTurn: deps.appendTurn,
    };

    const outcome = await captureDeterministicAnswer(
      {
        projectId: 'p-1',
        targetArchitectureId: 't-1',
        sessionId: 'session-1',
        conversationThreadId: 'thread-abc',
        entry,
        // The versioned { framework, version } object the frontend control
        // emits (this is the real versioned-code path).
        value: { framework: 'Java', version: '21' },
        answerText: 'Java 21',
        roundIndex: 1,
      },
      coordDeps,
    );

    expect(outcome.kind).toBe('captured');
    if (outcome.kind !== 'captured') throw new Error('unreachable');

    // Exactly ONE POST — the primary answer. Cascades are NOT yet written.
    expect(postCalls).toHaveLength(1);
    expect(postCalls[0].body).toMatchObject({
      decisionCode: 'service.language',
      scopeKind: 'architecture',
      answerValue: JSON.stringify({ framework: 'Java', version: '21' }),
      standardsLookupRef: null,
      conversationTurnRef: null,
      createdByTask: ARCHITECT_CONVERSATION_TASK_NAME,
      conversationThreadId: 'thread-abc',
    });

    // Cascade summary turn lists all 4 proposals with their sourceStandardId.
    expect(outcome.cascadeSummaryTurn).not.toBeNull();
    const summary = outcome.cascadeSummaryTurn as CascadeSummaryTurn;
    expect(summary.kind).toBe('cascade-summary');
    expect(summary.cascadedDecisions).toEqual([
      {
        decisionCode: 'service.runtime',
        proposedValue: 'Eclipse Temurin',
        sourceStandardId: 'std.runtime.v1',
      },
      {
        decisionCode: 'testing.unit',
        proposedValue: 'JUnit',
        sourceStandardId: 'std.testing.unit.v1',
      },
      {
        decisionCode: 'dto.style',
        proposedValue: 'Java records',
        sourceStandardId: 'std.dto.v1',
      },
      {
        decisionCode: 'build.tool',
        proposedValue: 'Gradle',
        sourceStandardId: 'std.build.v1',
      },
    ]);

    // Coordinator emits: question, answer; orchestrator emits:
    // decision-captured, cascade-summary. Order is preserved.
    const turnKinds = appendCalls.map((c) => (c.turn as { kind: string }).kind);
    expect(turnKinds).toEqual(['question', 'answer', 'decision-captured', 'cascade-summary']);

    // The pendingCascadeProposals are surfaced for the UX accept-batch path.
    expect(outcome.capture.pendingCascadeProposals).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// Test 2 — Every cascaded row carries the inline `sourceStandardId` in
// `standardsLookupRef` per Q9 audit continuity.
// ---------------------------------------------------------------------------

describe('acceptCascadeBatch — sourceStandardId carried on every cascaded row', () => {
  it('records standardsLookupRef from the library entry on each cascaded POST body', async () => {
    const { deps, postCalls } = makeRecordingDeps({
      idSequence: ['turn-ref-shared-1'],
    });
    const orchestrator = new DecisionCaptureOrchestrator(deps);
    const entry = getEntry('service.language');

    const proposals = computeCascadeProposals(entry, { framework: 'Java', version: '21' });
    expect(proposals.length).toBeGreaterThan(0);

    await orchestrator.acceptCascadeBatch({
      projectId: 'p-1',
      targetArchitectureId: 't-1',
      sessionId: 'session-1',
      conversationThreadId: 'thread-abc',
      proposals,
    });

    // Every POSTed row carries its cascade entry's literal sourceStandardId.
    const standardsRefs = postCalls.map((c) => c.body.standardsLookupRef);
    expect(standardsRefs).toEqual([
      'std.runtime.v1',
      'std.testing.unit.v1',
      'std.dto.v1',
      'std.build.v1',
    ]);

    // Every POSTed row also carries the cascade's downstream decisionCode.
    const decisionCodes = postCalls.map((c) => c.body.decisionCode);
    expect(decisionCodes).toEqual([
      'service.runtime',
      'testing.unit',
      'dto.style',
      'build.tool',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Test 3 — Cascade accept-batch: N sequential POSTs all sharing the same
// `conversationTurnRef` value per Q10.
// ---------------------------------------------------------------------------

describe('acceptCascadeBatch — shared conversationTurnRef', () => {
  it('writes N rows that all carry the same conversationTurnRef value', async () => {
    const SHARED_REF = 'shared-turn-ref-uuid';
    const { deps, postCalls, appendCalls } = makeRecordingDeps({
      idSequence: [SHARED_REF],
    });
    const orchestrator = new DecisionCaptureOrchestrator(deps);
    const entry = getEntry('service.language');
    const proposals = computeCascadeProposals(entry, { framework: 'Java', version: '21' });

    const outcome = await orchestrator.acceptCascadeBatch({
      projectId: 'p-1',
      targetArchitectureId: 't-1',
      sessionId: 'session-1',
      conversationThreadId: 'thread-abc',
      proposals,
    });

    expect(outcome.sharedConversationTurnRef).toBe(SHARED_REF);
    expect(postCalls).toHaveLength(proposals.length);
    for (const call of postCalls) {
      expect(call.body.conversationTurnRef).toBe(SHARED_REF);
    }

    // The cascade-accepted turn is the last append and lists each entry with
    // wasOverridden:false.
    const turnKinds = appendCalls.map((c) => (c.turn as { kind: string }).kind);
    // N decision-captured turns then one cascade-accepted turn.
    expect(turnKinds.slice(-1)).toEqual(['cascade-accepted']);
    const acceptedTurn = appendCalls[appendCalls.length - 1].turn as CascadeAcceptedTurn;
    expect(acceptedTurn.cascadedDecisions).toHaveLength(proposals.length);
    for (const e of acceptedTurn.cascadedDecisions) {
      expect(e.wasOverridden).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Test 4 — Per-cascade override: records that single decision with
// `wasOverridden: true` and an `overrideReason`; the other N-1 cascades
// capture normally.
// ---------------------------------------------------------------------------

describe('overrideCascade — single-row override with reason', () => {
  it('writes one row with the override value and reason; the cascade-overridden turn carries wasOverridden:true', async () => {
    const { deps, postCalls, appendCalls } = makeRecordingDeps();
    const orchestrator = new DecisionCaptureOrchestrator(deps);
    const entry = getEntry('service.language');

    const proposals = computeCascadeProposals(entry, { framework: 'Java', version: '21' });
    expect(proposals.length).toBeGreaterThanOrEqual(2);

    // Accept the first N-1 proposals normally.
    const accepted = proposals.slice(0, -1);
    await orchestrator.acceptCascadeBatch({
      projectId: 'p-1',
      targetArchitectureId: 't-1',
      sessionId: 'session-1',
      conversationThreadId: 'thread-abc',
      proposals: accepted,
    });

    // Override the last proposal (e.g. user picks Maven instead of Gradle).
    const lastProposal = proposals[proposals.length - 1];
    const overrideValue = 'Maven 3.9';
    const overrideReason = 'Existing Maven monorepo tooling — not migrating off it for v1.';

    const overrideOutcome = await orchestrator.overrideCascade({
      projectId: 'p-1',
      targetArchitectureId: 't-1',
      sessionId: 'session-1',
      conversationThreadId: 'thread-abc',
      proposal: lastProposal,
      overrideValue,
      overrideReason,
    });

    // The override POST is the last one. Its body carries the override value
    // and the override reason in `answerSummary`. It still records the
    // cascade's sourceStandardId for audit continuity.
    const overrideCall = postCalls[postCalls.length - 1];
    expect(overrideCall.body).toMatchObject({
      decisionCode: lastProposal.decisionCode,
      answerValue: overrideValue,
      answerSummary: overrideReason,
      standardsLookupRef: lastProposal.sourceStandardId,
      scopeKind: 'architecture',
    });

    // The cascade-overridden turn captures wasOverridden:true + the reason.
    const overrideTurn = overrideOutcome.cascadeOverriddenTurn as CascadeOverriddenTurn;
    expect(overrideTurn.kind).toBe('cascade-overridden');
    expect(overrideTurn.cascadedDecisions).toHaveLength(1);
    expect(overrideTurn.cascadedDecisions[0]).toMatchObject({
      decisionCode: lastProposal.decisionCode,
      answerValue: overrideValue,
      wasOverridden: true,
      overrideReason,
    });

    // The full append sequence ends with: decision-captured (for override),
    // cascade-overridden.
    const turnKinds = appendCalls.map((c) => (c.turn as { kind: string }).kind);
    expect(turnKinds.slice(-2)).toEqual(['decision-captured', 'cascade-overridden']);
  });
});

// ---------------------------------------------------------------------------
// Test 5 — Default-when-unchanged path: picking "no change" writes a real
// decision row with `answerValue = defaultsWhenUnchanged` (not a skip).
// ---------------------------------------------------------------------------

describe('answerQuestion — default-when-unchanged path captures a real row', () => {
  it('writes the defaultsWhenUnchanged value to a real captured-decision row (not a system-skip)', async () => {
    const entry = getEntry('service.language');
    const { deps, postCalls, appendCalls } = makeRecordingDeps();
    const orchestrator = new DecisionCaptureOrchestrator(deps);

    // The loop runner short-circuits the LLM on "no change" — so the LLM
    // client should not be invoked at all. We supply a throwing client to
    // assert it.
    const throwingLlm: ArchitectLlmClient = {
      callLlmToolLoop: async () => {
        throw new Error('LLM should not be called for default-when-unchanged path');
      },
      callSingleShot: async () => {
        throw new Error('callSingleShot should not be invoked in this test');
      },
    };

    const outcome = await answerQuestion(
      {
        projectId: 'p-1',
        targetArchitectureId: 't-1',
        sessionId: 'session-1',
        conversationThreadId: 'thread-abc',
        entry,
        userResponse: 'no change',
        capturedDecisionsContext: '',
        inlineCascadeSeedMap: '',
        llmClient: throwingLlm,
        roundIndex: 1,
      },
      { orchestrator, appendTurn: deps.appendTurn },
    );

    expect(outcome.kind).toBe('captured');
    if (outcome.kind !== 'captured') throw new Error('unreachable');

    // Exactly ONE POST — the primary answer carrying the defaultsWhenUnchanged
    // value as a real captured row.
    expect(postCalls).toHaveLength(1);
    expect(postCalls[0].body.answerValue).toBe(entry.defaultsWhenUnchanged);
    expect(outcome.defaultUnchangedPath).toBe(true);

    // The cascade entry's `valueByTriggerValue` map does NOT include the
    // string "current language + version" — so no cascade-summary turn fires.
    expect(outcome.cascadeSummaryTurn).toBeNull();

    // Append sequence: question, answer, decision-captured. No system-skip.
    const turnKinds = appendCalls.map((c) => (c.turn as { kind: string }).kind);
    expect(turnKinds).toEqual(['question', 'answer', 'decision-captured']);
  });
});

// ---------------------------------------------------------------------------
// Test 6 — Revision after answer: editing a prior answer writes a new
// superseding POST (insert-only per settled decision #10) and emits an
// `edit-superseded` turn with originalDecisionId, newDecisionId, and the Q6
// affectedDownstreamCodes[] banner payload.
// ---------------------------------------------------------------------------

describe('revisePriorAnswer — superseding POST + Q6 banner payload', () => {
  it('writes a new superseding row and emits edit-superseded with the affected downstream codes', async () => {
    const ORIGINAL_ID = 'decision-original';
    const NEW_ID = 'decision-new-superseding';
    const { deps, postCalls, appendCalls } = makeRecordingDeps({
      rowOverrides: [{ decisionId: NEW_ID }],
    });
    const orchestrator = new DecisionCaptureOrchestrator(deps);
    const entry = getEntry('service.language');

    const outcome = await orchestrator.revisePriorAnswer({
      projectId: 'p-1',
      targetArchitectureId: 't-1',
      sessionId: 'session-1',
      conversationThreadId: 'thread-abc',
      entry,
      originalDecisionId: ORIGINAL_ID,
      newAnswerValue: 'Kotlin 2.0',
    });

    // Exactly ONE POST — the new superseding row.
    expect(postCalls).toHaveLength(1);
    expect(postCalls[0].body).toMatchObject({
      decisionCode: 'service.language',
      scopeKind: 'architecture',
      answerValue: 'Kotlin 2.0',
      createdByTask: ARCHITECT_CONVERSATION_TASK_NAME,
    });
    expect(outcome.decision.decisionId).toBe(NEW_ID);

    // The edit-superseded turn carries both ids and the Q6 banner payload.
    const editTurn = outcome.editSupersededTurn as EditSupersededTurn;
    expect(editTurn.kind).toBe('edit-superseded');
    expect(editTurn.originalDecisionId).toBe(ORIGINAL_ID);
    expect(editTurn.newDecisionId).toBe(NEW_ID);
    // service.language declares cascades to service.runtime, testing.unit, dto.style, build.tool.
    expect(editTurn.affectedDownstreamCodes).toEqual([
      'service.runtime',
      'testing.unit',
      'dto.style',
      'build.tool',
    ]);

    // Append sequence: decision-captured, edit-superseded.
    const turnKinds = appendCalls.map((c) => (c.turn as { kind: string }).kind);
    expect(turnKinds).toEqual(['decision-captured', 'edit-superseded']);

    // Sanity: the helper used to compute the banner agrees with the turn.
    expect(computeAffectedDownstreamCodes(entry)).toEqual(editTurn.affectedDownstreamCodes);
  });
});

// ---------------------------------------------------------------------------
// Test 7 — Relevance auto-skip: a library entry whose `relevanceCondition`
// returns false silently POSTs `answerValue = 'not_applicable'` plus appends
// a `system-skip` turn with `relevanceReason`. The LLM is NOT invoked.
// ---------------------------------------------------------------------------

describe('answerQuestion — relevance auto-skip', () => {
  it('writes a not_applicable row and emits a system-skip turn when the relevance predicate returns false', async () => {
    const entry = getEntry('ui.framework');
    expect(entry.relevanceCondition).toBeDefined();
    expect(
      entry.relevanceCondition!({ hasUiTier: false, hasServiceTier: true, hasPersistenceTier: true }),
    ).toBe(false);

    const { deps, postCalls, appendCalls } = makeRecordingDeps();
    const orchestrator = new DecisionCaptureOrchestrator(deps);

    // The LLM is NOT invoked on the auto-skip path — supply a throwing
    // client so the assertion is implicit.
    const throwingLlm: ArchitectLlmClient = {
      callLlmToolLoop: async () => {
        throw new Error('LLM should not be called on the auto-skip path');
      },
      callSingleShot: async () => {
        throw new Error('callSingleShot should not be invoked in this test');
      },
    };

    const outcome = await answerQuestion(
      {
        projectId: 'p-1',
        targetArchitectureId: 't-1',
        sessionId: 'session-1',
        conversationThreadId: 'thread-abc',
        entry,
        userResponse: 'irrelevant — this is auto-skipped',
        capturedDecisionsContext: '',
        inlineCascadeSeedMap: '',
        llmClient: throwingLlm,
        relevanceContext: { hasUiTier: false, hasServiceTier: true, hasPersistenceTier: true },
        roundIndex: 1,
      },
      { orchestrator, appendTurn: deps.appendTurn },
    );

    expect(outcome.kind).toBe('skipped');
    if (outcome.kind !== 'skipped') throw new Error('unreachable');

    // Exactly ONE POST — the not_applicable row.
    expect(postCalls).toHaveLength(1);
    expect(postCalls[0].body).toMatchObject({
      decisionCode: 'ui.framework',
      scopeKind: 'architecture',
      answerValue: 'not_applicable',
    });
    expect(postCalls[0].body.answerSummary).toContain('auto-skipped: ui.framework');

    // Only a system-skip turn fires — no question/answer turns appear on the
    // transcript for skipped questions (per Q7 — silently skip).
    const systemSkipTurn = outcome.systemSkipTurn as SystemSkipTurn;
    expect(systemSkipTurn.kind).toBe('system-skip');
    expect(systemSkipTurn.decisionCode).toBe('ui.framework');
    expect(systemSkipTurn.relevanceReason).toContain('auto-skipped: ui.framework');

    const turnKinds = appendCalls.map((c) => (c.turn as { kind: string }).kind);
    expect(turnKinds).toEqual(['system-skip']);
  });
});

// ---------------------------------------------------------------------------
// Sanity coverage — the `DecisionCapturedTurn` carries the standardsLookupRef
// pulled from the captured-decision row when the row had one (cascades) and
// `null` otherwise (primary answers, revisions). This anchors the audit
// linkage that downstream consumers (the resolver + Spec 4 prompts) rely on.
// ---------------------------------------------------------------------------

describe('DecisionCapturedTurn standardsLookupRef passthrough', () => {
  it('passes through the standardsLookupRef from the captured-decision row onto the decision-captured turn', async () => {
    const { deps, appendCalls } = makeRecordingDeps();
    const orchestrator = new DecisionCaptureOrchestrator(deps);
    const entry = getEntry('service.language');
    const proposals = computeCascadeProposals(entry, { framework: 'Java', version: '21' });

    await orchestrator.acceptCascadeBatch({
      projectId: 'p-1',
      targetArchitectureId: 't-1',
      sessionId: 'session-1',
      conversationThreadId: 'thread-abc',
      proposals: [proposals[0]], // service.runtime -> Eclipse Temurin (stem)
    });

    const decisionTurn = appendCalls.find(
      (c) => (c.turn as { kind: string }).kind === 'decision-captured',
    )?.turn as DecisionCapturedTurn | undefined;
    expect(decisionTurn).toBeDefined();
    expect(decisionTurn!.standardsLookupRef).toBe('std.runtime.v1');
  });
});

// ---------------------------------------------------------------------------
// Spec 2026-06-26-target-conversation-versioned-answer-bare-stem-ux, Task Group 2
// computeCascadeProposals derives the trigger key from value.framework for a
// versioned { framework, version } object answer (previously such objects failed
// the typeof === 'string' guard and returned [], leaving versioned cascades
// dead). Cascades remain EDITABLE PROPOSALS (PendingCascadeProposal[]) computed
// purely -- never silent commits. Keep to a focused set per tasks.md 2.1.
// ---------------------------------------------------------------------------

describe('computeCascadeProposals -- versioned {framework, version} object answers', () => {
  it('fires cascades keyed off value.framework (the bare stem) for an object answer', () => {
    const entry = getEntry('service.language');
    const proposals = computeCascadeProposals(entry, { framework: 'Java', version: '21.0.5' });
    // Keyed under 'Java' -> the 4 service.language cascades with STEMMED seeds.
    expect(proposals).toEqual([
      { decisionCode: 'service.runtime', proposedValue: 'Eclipse Temurin', sourceStandardId: 'std.runtime.v1' },
      { decisionCode: 'testing.unit', proposedValue: 'JUnit', sourceStandardId: 'std.testing.unit.v1' },
      { decisionCode: 'dto.style', proposedValue: 'Java records', sourceStandardId: 'std.dto.v1' },
      { decisionCode: 'build.tool', proposedValue: 'Gradle', sourceStandardId: 'std.build.v1' },
    ]);
  });

  it('a bare-stem STRING answer resolves identically to the object answer', () => {
    const entry = getEntry('service.language');
    const fromString = computeCascadeProposals(entry, 'Java');
    const fromObject = computeCascadeProposals(entry, { framework: 'Java', version: '21' });
    expect(fromString).toEqual(fromObject);
    expect(fromString).toHaveLength(4);
  });

  it('a plain-string trigger on a NON-versioned source still resolves (no regression)', () => {
    // service.config is single-choice + NOT versioned: its string answer keys
    // the cascade exactly as before the engine fix.
    const entry = getEntry('service.config');
    const proposals = computeCascadeProposals(entry, 'env vars + 12-factor');
    expect(proposals).toEqual([
      { decisionCode: 'secrets.management', proposedValue: 'Vault injector', sourceStandardId: 'std.secrets.v1' },
    ]);
  });

  it('the two flipped-to-versioned source cascades still fire from an object answer', () => {
    // logging.framework -> logging.format (trigger stem unchanged: 'pino').
    const logging = getEntry('logging.framework');
    expect(computeCascadeProposals(logging, { framework: 'pino', version: '9' })).toEqual([
      { decisionCode: 'logging.format', proposedValue: 'JSON one-line', sourceStandardId: 'std.logging.format.v1' },
    ]);
    // interservice.asyncBus -> interservice.messageFormat (re-keyed Kafka 3.7 -> Kafka).
    const bus = getEntry('interservice.asyncBus');
    expect(computeCascadeProposals(bus, { framework: 'Kafka', version: '3.7' })).toEqual([
      { decisionCode: 'interservice.messageFormat', proposedValue: 'Avro + Schema Registry', sourceStandardId: 'std.async.format.v1' },
    ]);
  });

  it('genuinely unkeyable values short-circuit to [] (no cascades, no throw)', () => {
    const entry = getEntry('service.language');
    expect(computeCascadeProposals(entry, 42)).toEqual([]);
    expect(computeCascadeProposals(entry, null)).toEqual([]);
    expect(computeCascadeProposals(entry, ['Java', '21'])).toEqual([]); // arrays are not keyable
    expect(computeCascadeProposals(entry, { version: '21' })).toEqual([]); // object missing framework
    // An unknown stem yields no proposals (partial-function skip preserved).
    expect(computeCascadeProposals(entry, { framework: 'COBOL', version: '85' })).toEqual([]);
  });

  it('returns editable PROPOSALS (PendingCascadeProposal[]) and writes NOTHING', () => {
    const entry = getEntry('service.language');
    const { deps, postCalls } = makeRecordingDeps();
    const proposals = computeCascadeProposals(entry, { framework: 'Java', version: '21' });
    // Pure computation: no captured-decision row is written.
    expect(postCalls).toHaveLength(0);
    expect(deps.postCapturedDecision).toBeDefined();
    for (const p of proposals) {
      expect(typeof p.decisionCode).toBe('string');
      expect(typeof p.sourceStandardId).toBe('string');
      expect(p).toHaveProperty('proposedValue');
    }
  });
});

