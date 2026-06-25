/**
 * Open-phase UI tests — Architect Conversation Open-Ended LLM Phase
 * (Spec 2026-06-06-architect-conversation-open-ended-phase, Task Group 6.1).
 *
 * The open phase begins STRICTLY after the deterministic preset walk exhausts,
 * driven by the `phase: 'open-available'` signal off `fetchNextQuestion`. These
 * focused tests lock the frontend acceptance criteria:
 *
 *   1. Layer 1 (ConversationMainPane): the five new open-phase turn kinds render
 *      via the `TurnView` switch (open-phase-prompt + suggested areas;
 *      user-raised-topic; option-proposal; user-pick; free-form-discussion).
 *   2. Layer 1: the option-proposal pick UI for USER-RAISED topics has NO
 *      "Not applicable to this migration" opt-out (P4 — suppressed here), BUT a
 *      "something else…" free-text escape IS present; `selectionMode` single vs
 *      multi is respected.
 *   3. Layer 1: a PRESET question still carries the universal opt-out (the
 *      invariant is preserved — suppression is open-phase only).
 *   4. Layer 2 (ArchitectConversationTab): the open-phase surface appears ONLY
 *      post-walk (`phase: 'open-available'`), NOT mid-walk; engaging it fetches
 *      the suggested-areas prompt and reveals the free-form/topic controls.
 *
 * LLM is irrelevant on the frontend; the gateway open-phase calls are mocked at
 * the `architectConversationApi` boundary (consistent with the colocated suites).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from '@testing-library/react';

import { ConversationMainPane, type OpenPhasePaneState } from '../ConversationMainPane';
import {
  OPT_OUT_ANSWER_VALUE,
  type ConversationTurn,
  type OptionProposalTurn,
  type PendingQuestion,
} from '../../../../api/architectConversationApi';

afterEach(() => cleanup());

// ===========================================================================
// Layer 1 — ConversationMainPane renders the open-phase turns + pick UI.
// ===========================================================================

const paneBaseProps = {
  pendingQuestion: null,
  pendingCascadeSummary: null,
  cascadeBusy: false,
  cascadeError: null,
  answerBusy: false,
  answerError: null,
  onCaptureAnswer: vi.fn(),
  onAcceptCascadeAll: vi.fn(),
  onOverrideCascade: vi.fn(),
} as const;

function openPhase(overrides: Partial<OpenPhasePaneState> = {}): OpenPhasePaneState {
  return {
    active: true,
    subPhase: 'decisions',
    busy: false,
    error: null,
    onRaiseTopic: vi.fn(),
    onPickOption: vi.fn(),
    onDiscuss: vi.fn(),
    onDoneWithDecisions: vi.fn(),
    onDoneAndClose: vi.fn(),
    ...overrides,
  };
}

const promptTurn: ConversationTurn = {
  kind: 'open-phase-prompt',
  promptText: 'We have covered the standard decisions. Any other areas?',
  suggestedAreas: [
    { label: 'Batch processing strategy', rationale: 'nightly Sybase jobs found' },
    { label: 'Caching approach' },
  ],
};

function singleProposal(): OptionProposalTurn {
  return {
    kind: 'option-proposal',
    topicLabel: 'Batch processing strategy',
    selectionMode: 'single',
    options: [
      { value: 'Spring Batch' },
      { value: 'Quartz scheduler', label: 'Quartz' },
    ],
    allowFreeTextEscape: true,
    freeTextEscapeLabel: 'Something else…',
  };
}

describe('ConversationMainPane — open-phase turn rendering', () => {
  it('renders the open-phase prompt turn with its suggested candidate areas', () => {
    render(
      <ConversationMainPane
        {...paneBaseProps}
        turns={[promptTurn]}
        openPhase={openPhase()}
      />,
    );
    expect(
      screen.getByTestId('architect-conversation-turn-open-phase-prompt'),
    ).toBeInTheDocument();
    // Both proactively-suggested areas (P3) surface.
    const areas = screen.getAllByTestId('architect-conversation-suggested-area');
    expect(areas).toHaveLength(2);
    expect(screen.getByText('Batch processing strategy')).toBeInTheDocument();
  });

  it('renders the user-raised-topic, user-pick, and free-form-discussion turns', () => {
    const turns: ConversationTurn[] = [
      { kind: 'user-raised-topic', topicLabel: 'Batch processing strategy' },
      {
        kind: 'user-pick',
        topicLabel: 'Batch processing strategy',
        decisionCode: 'adhoc.batch-processing-strategy',
        selectedValues: ['Spring Batch'],
      },
      { kind: 'free-form-discussion', speaker: 'user', messageText: 'What about retries?' },
      {
        kind: 'free-form-discussion',
        speaker: 'assistant',
        messageText: 'Retries are handled per job.',
      },
    ];
    render(
      <ConversationMainPane {...paneBaseProps} turns={turns} openPhase={openPhase()} />,
    );
    expect(
      screen.getByTestId('architect-conversation-turn-user-raised-topic'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('architect-conversation-turn-user-pick'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('architect-conversation-turn-free-form-user'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('architect-conversation-turn-free-form-assistant'),
    ).toBeInTheDocument();
  });

  it('option-proposal for a user-raised topic has NO "Not applicable" opt-out but HAS a "something else…" escape', () => {
    const onPickOption = vi.fn();
    render(
      <ConversationMainPane
        {...paneBaseProps}
        turns={[singleProposal()]}
        openPhase={openPhase({ onPickOption })}
      />,
    );
    // The proposal renders and is the latest -> actionable.
    expect(
      screen.getByTestId('architect-conversation-turn-option-proposal'),
    ).toBeInTheDocument();

    // CRITICAL invariant: the universal preset opt-out is SUPPRESSED for
    // user-raised options (P4) — that control must NOT be present here.
    expect(
      screen.queryByTestId('architect-conversation-not-needed'),
    ).toBeNull();

    // The "something else…" free-text escape IS present.
    expect(
      screen.getByTestId('architect-conversation-option-something-else'),
    ).toBeInTheDocument();

    // A single-select pick fires onPickOption with the chosen value (no free text).
    fireEvent.click(screen.getByTestId('architect-conversation-option-Spring Batch'));
    expect(onPickOption).toHaveBeenCalledWith(
      'Batch processing strategy',
      ['Spring Batch'],
      undefined,
    );

    // The "something else…" escape captures a verbatim free-text answer instead.
    fireEvent.click(screen.getByTestId('architect-conversation-option-something-else'));
    fireEvent.change(
      screen.getByTestId('architect-conversation-option-free-text-input'),
      { target: { value: 'Custom Kafka pipeline' } },
    );
    fireEvent.click(
      screen.getByTestId('architect-conversation-option-free-text-submit'),
    );
    expect(onPickOption).toHaveBeenLastCalledWith(
      'Batch processing strategy',
      undefined,
      'Custom Kafka pipeline',
    );
  });

  it('respects multi-select: toggles then confirms the selected set', () => {
    const onPickOption = vi.fn();
    const multi: OptionProposalTurn = {
      kind: 'option-proposal',
      topicLabel: 'Cross-cutting concerns',
      selectionMode: 'multi',
      options: [{ value: 'Tracing' }, { value: 'Audit logging' }, { value: 'Rate limiting' }],
      allowFreeTextEscape: true,
    };
    render(
      <ConversationMainPane
        {...paneBaseProps}
        turns={[multi]}
        openPhase={openPhase({ onPickOption })}
      />,
    );
    fireEvent.click(screen.getByTestId('architect-conversation-option-Tracing'));
    fireEvent.click(screen.getByTestId('architect-conversation-option-Audit logging'));
    // A toggle does NOT submit for multi-select.
    expect(onPickOption).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('architect-conversation-option-submit-multi'));
    expect(onPickOption).toHaveBeenCalledWith(
      'Cross-cutting concerns',
      ['Tracing', 'Audit logging'],
      undefined,
    );
  });

  it('keeps the universal "Not applicable" opt-out on PRESET questions (invariant preserved)', () => {
    const presetQuestion: PendingQuestion = {
      // NON-versioned preset question (was `build.tool`, now a versioned code
      // rendering the dedicated framework+version control); the universal
      // opt-out invariant applies to every NON-versioned preset question.
      decisionCode: 'db.migrations',
      group: 'C',
      orderInGroup: 2,
      promptText: 'What schema-migration tool?',
      staticContextLeadIn: null,
      expectedAnswerShape: 'single-choice',
      choices: ['Flyway 10', 'Liquibase 4'],
      defaultsWhenUnchanged: 'current tool',
      optional: false,
    };
    const onCaptureAnswer = vi.fn();
    render(
      <ConversationMainPane
        {...paneBaseProps}
        turns={[]}
        pendingQuestion={presetQuestion}
        onCaptureAnswer={onCaptureAnswer}
      />,
    );
    // Preset question still shows the universal opt-out, and it captures the marker.
    const optOut = screen.getByTestId('architect-conversation-not-needed');
    expect(optOut).toBeInTheDocument();
    fireEvent.click(optOut);
    expect(onCaptureAnswer).toHaveBeenCalledWith('db.migrations', OPT_OUT_ANSWER_VALUE, 'N/A');
  });
});

// ===========================================================================
// Layer 2 — ArchitectConversationTab surfaces the open phase strictly post-walk.
// ===========================================================================

vi.mock('../../../../api/architectConversationApi', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../api/architectConversationApi')
  >('../../../../api/architectConversationApi');
  return {
    // Keep the real OPT_OUT_ANSWER_VALUE constant for the Layer-1 isolated tests.
    OPT_OUT_ANSWER_VALUE: actual.OPT_OUT_ANSWER_VALUE,
    ALLOWED_SCOPE_REF_TYPES: actual.ALLOWED_SCOPE_REF_TYPES,
    ArchitectConversationApiError: actual.ArchitectConversationApiError,
    loadConversation: vi.fn(),
    openConversation: vi.fn(),
    closeConversation: vi.fn(),
    captureAnswer: vi.fn(),
    acceptCascadeBatch: vi.fn(),
    overrideCascade: vi.fn(),
    revisePriorAnswer: vi.fn(),
    pinException: vi.fn(),
    fetchQuestionLibraryScopes: vi.fn().mockResolvedValue({}),
    fetchNextQuestion: vi.fn(),
    fetchPromptReadyOutput: vi.fn(),
    // The five open-phase client functions (Task Group 6.8).
    beginOpenPhase: vi.fn(),
    raiseOpenPhaseTopic: vi.fn(),
    pickOpenPhaseOption: vi.fn(),
    discussOpenPhase: vi.fn(),
    summariseOpenPhaseDiscussion: vi.fn(),
  };
});

vi.mock('../../../../contexts/ArchitectureContext', () => ({
  // Empty-entities model -> tier derivation fails open (asks everything); a
  // stable reference avoids re-firing the next-question effect each render.
  useArchitecture: (() => {
    const m = { model: { metaModel: { entities: { services: [], app_components: [] } } } };
    return () => m;
  })(),
  // Spec 4 (Task Group 6): the tab reads the CURRENT architecture id via this
  // hook for the vulnerability-reduction fetch; null => the reduction hook
  // degrades to a null delta (non-blocking no-op for these unrelated tests).
  useActiveArchitectureId: () => null,
}));

import { ArchitectConversationTab } from '../ArchitectConversationTab';
import {
  beginOpenPhase,
  fetchNextQuestion,
  loadConversation,
} from '../../../../api/architectConversationApi';

const PROJECT_ID = 'proj-open-phase';
const TARGET = 'arch-open-phase';

function openEnvelope(turns: ConversationTurn[] = []) {
  return {
    threadId: 'thr-open',
    turns: [{ kind: 'open', sessionId: 's1', openedBy: 'u1' }, ...turns],
    currentSession: {
      sessionId: 's1',
      status: 'open',
      openedBy: 'u1',
      openedAt: '2026-06-06T00:00:00Z',
    },
    capturedDecisions: [],
  };
}

describe('ArchitectConversationTab — open-phase surfaces strictly post-walk', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadConversation).mockResolvedValue(openEnvelope() as never);
  });

  it('does NOT surface the open phase mid-walk (a question is still pending)', async () => {
    // phase: preset-walk while a question is returned.
    vi.mocked(fetchNextQuestion).mockResolvedValue({
      question: {
        decisionCode: 'service.language',
        group: 'A',
        orderInGroup: 1,
        promptText: 'Which language?',
        staticContextLeadIn: null,
        expectedAnswerShape: 'free-text',
        choices: null,
        defaultsWhenUnchanged: 'no change',
        optional: false,
      },
      phase: 'preset-walk',
    } as never);

    render(
      <ArchitectConversationTab
        projectId={PROJECT_ID}
        selectedTargetArchitectureId={TARGET}
        currentUserId="u1"
      />,
    );

    // The pending question renders (mid-walk)...
    expect(
      await screen.findByTestId(
        'architect-conversation-pending-question-service.language',
      ),
    ).toBeInTheDocument();
    // ...and the open-phase "explore other areas" affordance is ABSENT mid-walk.
    expect(
      screen.queryByTestId('architect-conversation-open-phase-available'),
    ).toBeNull();
  });

  it('surfaces the open-phase affordance post-walk, and engaging it fetches the suggested-areas prompt + reveals the topic controls', async () => {
    // phase: open-available once the walk exhausts (no question).
    vi.mocked(fetchNextQuestion).mockResolvedValue({
      question: null,
      phase: 'open-available',
    } as never);
    vi.mocked(beginOpenPhase).mockResolvedValue({
      outcome: 'prompt',
      openPhasePromptTurn: promptTurn,
    } as never);

    render(
      <ArchitectConversationTab
        projectId={PROJECT_ID}
        selectedTargetArchitectureId={TARGET}
        currentUserId="u1"
      />,
    );

    // The OPTIONAL open-phase affordance appears strictly post-walk.
    const engage = await screen.findByTestId(
      'architect-conversation-open-phase-engage',
    );
    expect(engage).toBeInTheDocument();

    // Engaging it calls the gateway begin route + appends the suggested-areas prompt.
    fireEvent.click(engage);
    await waitFor(() => {
      expect(beginOpenPhase).toHaveBeenCalledWith(PROJECT_ID, TARGET);
    });
    expect(
      await screen.findByTestId('architect-conversation-turn-open-phase-prompt'),
    ).toBeInTheDocument();

    // Sub-phase (a) controls (the topic input + "Done with decisions") are live;
    // the free-form discussion input is NOT shown until (b).
    expect(
      screen.getByTestId('architect-conversation-open-phase-topic-input'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('architect-conversation-open-phase-done-decisions'),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('architect-conversation-open-phase-discuss-input'),
    ).toBeNull();
  });

  it('"Done with decisions" transitions sub-phase (a) -> (b), revealing the free-form chat + "Done / Close"', async () => {
    vi.mocked(fetchNextQuestion).mockResolvedValue({
      question: null,
      phase: 'open-available',
    } as never);
    vi.mocked(beginOpenPhase).mockResolvedValue({
      outcome: 'prompt',
      openPhasePromptTurn: promptTurn,
    } as never);

    render(
      <ArchitectConversationTab
        projectId={PROJECT_ID}
        selectedTargetArchitectureId={TARGET}
        currentUserId="u1"
      />,
    );

    fireEvent.click(
      await screen.findByTestId('architect-conversation-open-phase-engage'),
    );
    // Explicit transition (never inferred): click "Done with decisions".
    fireEvent.click(
      await screen.findByTestId('architect-conversation-open-phase-done-decisions'),
    );

    // Sub-phase (b): the free-form chat input + "Done / Close" appear; the topic
    // input is gone.
    expect(
      await screen.findByTestId('architect-conversation-open-phase-discuss-input'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('architect-conversation-open-phase-done-close'),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('architect-conversation-open-phase-topic-input'),
    ).toBeNull();
  });
});
