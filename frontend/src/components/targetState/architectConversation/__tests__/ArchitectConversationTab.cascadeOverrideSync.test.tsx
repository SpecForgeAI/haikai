/**
 * Regression test: write paths sync the local captured-decisions snapshot.
 *
 * Bug (2026-06-01): overriding a cascaded decision (e.g. build.tool
 * "Gradle 8" -> "Maven 3.9") persisted server-side but the on-screen
 * "Decisions captured" panel kept showing the proposed default and the cascade
 * override block stayed open, because `handleOverrideCascade` neither mirrored
 * the new value into `capturedDecisions` nor cleared `pendingCascade`. This
 * test drives the answer -> cascade-summary -> override flow and asserts the
 * panel updates to the overridden value AND the interactive cascade controls
 * are dismissed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mock the API client (declared BEFORE the component import).
// ---------------------------------------------------------------------------

vi.mock('../../../../api/architectConversationApi', () => ({
  loadConversation: vi.fn(),
  openConversation: vi.fn(),
  closeConversation: vi.fn(),
  captureAnswer: vi.fn(),
  acceptCascadeBatch: vi.fn(),
  overrideCascade: vi.fn(),
  revisePriorAnswer: vi.fn(),
  pinException: vi.fn(),
  fetchNextQuestion: vi.fn(),
  fetchPromptReadyOutput: vi.fn(),
  fetchQuestionLibraryScopes: vi.fn(),
  getActiveTargetArchitectureId: vi.fn(),
  OPT_OUT_ANSWER_VALUE: '(not used)',
  ALLOWED_SCOPE_REF_TYPES: [
    'service',
    'interface',
    'endpoint',
    'physical_data_entity',
    'physical_data_attribute',
    'method',
    'class',
  ],
  ArchitectConversationApiError: class extends Error {},
}));

// Imports AFTER the mock.
// Spec 2026-06-05-architect-tier-gating (Half B): the tab now reads the
// cached target model via useArchitecture() to derive the default tier set.
// Provide an empty-entities model so the derivation fails open (asks all).
vi.mock('../../../../contexts/ArchitectureContext', () => ({
  useArchitecture: (() => {
    // Stable reference so the tab's tier-derivation useMemo deps don't churn
    // across renders (a fresh object each call re-fires the next-question effect).
    const m = { model: { metaModel: { entities: { services: [], app_components: [] } } } };
    return () => m;
  })(),
}));

import { ArchitectConversationTab } from '../ArchitectConversationTab';
import {
  loadConversation,
  captureAnswer,
  overrideCascade,
  fetchNextQuestion,
  fetchQuestionLibraryScopes,
} from '../../../../api/architectConversationApi';
import type {
  AnswerQuestionResponse,
  ConversationEnvelope,
  OverrideCascadeResponse,
  PendingQuestion,
} from '../../../../api/architectConversationApi';

const PROJECT_ID = 'proj-1';
const TARGET_ID = 'target-1';

beforeEach(() => {
  vi.clearAllMocks();

  vi.mocked(fetchQuestionLibraryScopes).mockResolvedValue({});

  // Open session, just the open turn, no decisions captured yet.
  vi.mocked(loadConversation).mockResolvedValue({
    threadId: 'thr-1',
    turns: [{ kind: 'open', sessionId: 'sess-1', openedBy: 'user-1' }],
    currentSession: {
      sessionId: 'sess-1',
      status: 'open',
      openedBy: 'user-1',
      openedAt: '2026-06-01T00:00:00Z',
    },
    capturedDecisions: [],
  } as ConversationEnvelope);

  // The walk first serves the parent runtime question; after it is answered the
  // walk has nothing else to serve (keeps the input bar out of the way).
  // fetchNextQuestion now returns { question, phase } (Spec 2026-06-06 TG1).
  vi.mocked(fetchNextQuestion)
    .mockResolvedValueOnce({
      question: {
        decisionCode: 'service.runtime',
        group: 'A',
        orderInGroup: 1,
        promptText: 'What runtime should target services use?',
        staticContextLeadIn: null,
        expectedAnswerShape: 'single-choice',
        choices: ['Java 21'],
        defaultsWhenUnchanged: 'current runtime',
        optional: false,
      } as PendingQuestion,
      phase: 'preset-walk',
    })
    .mockResolvedValue({ question: null, phase: 'open-available' });

  // Answering the runtime question captures it and proposes a build.tool cascade.
  vi.mocked(captureAnswer).mockResolvedValue({
    outcome: 'captured',
    questionTurn: {
      kind: 'question',
      decisionCode: 'service.runtime',
      promptText: 'What runtime should target services use?',
      roundIndex: 1,
    },
    answerTurn: {
      kind: 'answer',
      decisionCode: 'service.runtime',
      answerText: 'Java 21',
      roundIndex: 1,
    },
    decisionCapturedTurn: {
      kind: 'decision-captured',
      decisionId: 'dec-runtime',
      decisionCode: 'service.runtime',
      scope: { kind: 'architecture' },
      answerValue: 'Java 21',
      standardsLookupRef: null,
    },
    cascadeSummaryTurn: {
      kind: 'cascade-summary',
      cascadedDecisions: [
        {
          decisionCode: 'build.tool',
          proposedValue: 'Gradle 8',
          sourceStandardId: 'std.build.v1',
        },
      ],
    },
    mappingMutationSummaryTurn: null,
  } as AnswerQuestionResponse);

  // The override write returns the persisted Maven value.
  vi.mocked(overrideCascade).mockResolvedValue({
    decisionCapturedTurn: {
      kind: 'decision-captured',
      decisionId: 'dec-buildtool',
      decisionCode: 'build.tool',
      scope: { kind: 'architecture' },
      answerValue: 'Maven 3.9',
      standardsLookupRef: 'std.build.v1',
    },
    cascadeOverriddenTurn: {
      kind: 'cascade-overridden',
      cascadedDecisions: [
        {
          decisionCode: 'build.tool',
          answerValue: 'Maven 3.9',
          wasOverridden: true,
          overrideReason: 'We standardise on Maven',
        },
      ],
    },
  } as OverrideCascadeResponse);
});

afterEach(() => cleanup());

function renderTab() {
  return render(
    <ArchitectConversationTab
      projectId={PROJECT_ID}
      selectedTargetArchitectureId={TARGET_ID}
      currentUserId="user-1"
    />,
  );
}

describe('ArchitectConversationTab — cascade override state sync', () => {
  it('reflects the overridden value in the summary panel and dismisses the cascade block', async () => {
    renderTab();

    // 1. Answer the parent question to trigger the cascade summary.
    // Single-choice question: click the choice to answer (no LLM round-trip).
    fireEvent.click(
      await screen.findByTestId('architect-conversation-choice-Java 21'),
    );

    // 2. The interactive cascade override control appears for build.tool.
    const overrideBtn = await screen.findByTestId(
      'architect-conversation-cascade-override-button-build.tool',
    );
    fireEvent.click(overrideBtn);

    // 3. Enter the new value + reason and submit the override.
    fireEvent.change(
      screen.getByTestId('architect-conversation-cascade-override-value-build.tool'),
      { target: { value: 'Maven 3.9' } },
    );
    fireEvent.change(
      screen.getByTestId('architect-conversation-cascade-override-reason-build.tool'),
      { target: { value: 'We standardise on Maven' } },
    );
    fireEvent.click(
      screen.getByTestId('architect-conversation-cascade-override-submit-build.tool'),
    );

    // 4. The override was sent with the NEW value (not the proposed default).
    await waitFor(() => {
      expect(overrideCascade).toHaveBeenCalledTimes(1);
    });
    expect(vi.mocked(overrideCascade).mock.calls[0][2]).toMatchObject({
      overrideValue: 'Maven 3.9',
      overrideReason: 'We standardise on Maven',
    });

    // 5. The "Decisions captured" panel now shows build.tool = Maven 3.9
    //    (the core regression: previously it kept showing the Gradle 8 default).
    const row = await screen.findByTestId(
      'architect-conversation-summary-row-build.tool',
    );
    expect(row).toHaveTextContent('Maven 3.9');
    expect(row).not.toHaveTextContent('Gradle 8');

    // 6. The interactive cascade override block is dismissed (now read-only),
    //    not left open showing the proposed default.
    expect(
      screen.queryByTestId('architect-conversation-cascade-override-button-build.tool'),
    ).toBeNull();
    expect(
      screen.queryByTestId('architect-conversation-cascade-accept-all'),
    ).toBeNull();
  });

  it('overriding one proposal in a multi-proposal cascade keeps the siblings actionable', async () => {
    // A 2-proposal cascade (mirrors the real "3 downstream decisions" case):
    // overriding one must NOT dismiss the whole block or drop the siblings.
    vi.mocked(captureAnswer).mockResolvedValue({
      outcome: 'captured',
      questionTurn: {
        kind: 'question',
        decisionCode: 'service.runtime',
        promptText: 'What runtime should target services use?',
        roundIndex: 1,
      },
      answerTurn: {
        kind: 'answer',
        decisionCode: 'service.runtime',
        answerText: 'Java 21',
        roundIndex: 1,
      },
      decisionCapturedTurn: {
        kind: 'decision-captured',
        decisionId: 'dec-runtime',
        decisionCode: 'service.runtime',
        scope: { kind: 'architecture' },
        answerValue: 'Java 21',
        standardsLookupRef: null,
      },
      cascadeSummaryTurn: {
        kind: 'cascade-summary',
        cascadedDecisions: [
          { decisionCode: 'build.tool', proposedValue: 'Gradle 8', sourceStandardId: 'std.build.v1' },
          { decisionCode: 'testing.unit', proposedValue: 'JUnit 5', sourceStandardId: 'std.testing.v1' },
        ],
      },
      mappingMutationSummaryTurn: null,
    } as AnswerQuestionResponse);

    renderTab();

    // Single-choice question: click the choice to answer (no LLM round-trip).
    fireEvent.click(
      await screen.findByTestId('architect-conversation-choice-Java 21'),
    );

    // Override ONLY build.tool.
    fireEvent.click(
      await screen.findByTestId('architect-conversation-cascade-override-button-build.tool'),
    );
    fireEvent.change(
      screen.getByTestId('architect-conversation-cascade-override-value-build.tool'),
      { target: { value: 'Maven 3.9' } },
    );
    fireEvent.change(
      screen.getByTestId('architect-conversation-cascade-override-reason-build.tool'),
      { target: { value: 'We standardise on Maven' } },
    );
    fireEvent.click(
      screen.getByTestId('architect-conversation-cascade-override-submit-build.tool'),
    );

    // build.tool's override is reflected in the panel...
    const row = await screen.findByTestId(
      'architect-conversation-summary-row-build.tool',
    );
    expect(row).toHaveTextContent('Maven 3.9');

    // ...build.tool is removed from the still-open cascade...
    await waitFor(() => {
      expect(
        screen.queryByTestId('architect-conversation-cascade-override-button-build.tool'),
      ).toBeNull();
    });

    // ...but the sibling (testing.unit) stays actionable and the block is NOT
    // dismissed (this is the regression the first fix introduced and this guards).
    expect(
      screen.getByTestId('architect-conversation-cascade-override-button-testing.unit'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('architect-conversation-cascade-accept-all'),
    ).toBeInTheDocument();
  });
});
