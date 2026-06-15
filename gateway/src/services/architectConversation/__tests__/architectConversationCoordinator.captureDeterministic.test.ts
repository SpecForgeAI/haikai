/**
 * Tests for `captureDeterministicAnswer` -- the no-LLM click-to-answer capture
 * path added 2026-06-01. The user picks an option / types a custom value / opts
 * out, and the frontend sends the EXACT value; this path captures it directly
 * (no LLM loop) and returns the same `captured` outcome shape as
 * `answerQuestion`.
 */

import { captureDeterministicAnswer } from '../architectConversationCoordinator';
import type { QuestionLibraryEntry } from '../../../config/architect-conversation/questionLibrary';

const ENTRY = {
  code: 'build.tool',
  group: 'G',
  orderInGroup: 1,
  prompt: 'What build tool should target services use?',
  staticContextLeadIn: 'The build tool each service uses.',
  expectedAnswerShape: 'single-choice',
  choices: ['Gradle 8', 'Maven 3.9'],
  defaultsWhenUnchanged: 'current tool',
  cascades: [],
  allowedExceptionScopes: ['service'],
} as unknown as QuestionLibraryEntry;

describe('captureDeterministicAnswer (no-LLM click-to-answer capture)', () => {
  it('captures the exact value via the orchestrator, appends question + answer turns, and returns a captured outcome', async () => {
    const appendTurn = jest.fn().mockResolvedValue(undefined);
    const decisionCapturedTurn = {
      kind: 'decision-captured',
      decisionId: 'd1',
      decisionCode: 'build.tool',
      scope: { kind: 'architecture' },
      answerValue: 'Maven 3.9',
      standardsLookupRef: null,
    };
    const capturePrimaryAnswer = jest.fn().mockResolvedValue({
      decision: { decisionId: 'd1', decisionCode: 'build.tool', answerValue: 'Maven 3.9' },
      decisionCapturedTurn,
      cascadeSummaryTurn: null,
      pendingCascadeProposals: [],
    });

    const outcome = await captureDeterministicAnswer(
      {
        projectId: 'p1',
        targetArchitectureId: 't1',
        sessionId: 's1',
        conversationThreadId: 'thr1',
        entry: ENTRY,
        value: 'Maven 3.9',
        answerText: 'Maven 3.9',
      },
      {
        // Partial orchestrator -- only the two methods this path uses.
        orchestrator: { capturePrimaryAnswer, appendErrorTurn: jest.fn() } as never,
        appendTurn: appendTurn as never,
        // No mappingMutationOrchestrator -> mutation step is skipped.
      },
    );

    // The exact user-chosen value reaches the orchestrator (no LLM parse).
    expect(capturePrimaryAnswer).toHaveBeenCalledTimes(1);
    expect(capturePrimaryAnswer).toHaveBeenCalledWith(
      expect.objectContaining({
        entry: ENTRY,
        answerValue: 'Maven 3.9',
        defaultUnchangedPath: false,
      }),
    );

    // Question + answer transcript turns are appended.
    expect(appendTurn).toHaveBeenCalledWith(
      'p1',
      't1',
      expect.objectContaining({ kind: 'question', decisionCode: 'build.tool' }),
    );
    expect(appendTurn).toHaveBeenCalledWith(
      'p1',
      't1',
      expect.objectContaining({ kind: 'answer', answerText: 'Maven 3.9' }),
    );

    // Captured outcome carries the decision-captured turn.
    expect(outcome.kind).toBe('captured');
    if (outcome.kind === 'captured') {
      expect(outcome.decisionCapturedTurn).toBe(decisionCapturedTurn);
      expect(outcome.cascadeSummaryTurn).toBeNull();
    }
  });

  it('passes a multi-choice array straight through and defaults the answer-turn text to String(value)', async () => {
    const appendTurn = jest.fn().mockResolvedValue(undefined);
    const capturePrimaryAnswer = jest.fn().mockResolvedValue({
      decision: { decisionId: 'd2', decisionCode: 'api.protocol', answerValue: '["REST/JSON","gRPC"]' },
      decisionCapturedTurn: {
        kind: 'decision-captured',
        decisionId: 'd2',
        decisionCode: 'api.protocol',
        scope: { kind: 'architecture' },
        answerValue: '["REST/JSON","gRPC"]',
        standardsLookupRef: null,
      },
      cascadeSummaryTurn: null,
      pendingCascadeProposals: [],
    });

    await captureDeterministicAnswer(
      {
        projectId: 'p1',
        targetArchitectureId: 't1',
        sessionId: 's1',
        conversationThreadId: 'thr1',
        entry: { ...ENTRY, code: 'api.protocol', expectedAnswerShape: 'multi-choice' } as unknown as QuestionLibraryEntry,
        value: ['REST/JSON', 'gRPC'],
        // answerText deliberately omitted to exercise the String(value) fallback.
      },
      {
        orchestrator: { capturePrimaryAnswer, appendErrorTurn: jest.fn() } as never,
        appendTurn: appendTurn as never,
      },
    );

    expect(capturePrimaryAnswer).toHaveBeenCalledWith(
      expect.objectContaining({ answerValue: ['REST/JSON', 'gRPC'] }),
    );
    expect(appendTurn).toHaveBeenCalledWith(
      'p1',
      't1',
      expect.objectContaining({ kind: 'answer', answerText: String(['REST/JSON', 'gRPC']) }),
    );
  });
});
