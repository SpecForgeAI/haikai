/**
 * Question-driver tests — the fix for the conversation deadlock.
 *
 * Before this work the conversation opened a session but NO question was ever
 * presented (the input bar derived its pending code from a transcript turn that
 * only appeared AFTER answering). These tests lock the new behaviour: once a
 * session is open, the gateway-driven next question is presented and the answer
 * input is reachable, and submitting advances the walk.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from '@testing-library/react';

vi.mock('../../../../api/architectConversationApi', () => ({
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
  OPT_OUT_ANSWER_VALUE: '(not used)',
  ALLOWED_SCOPE_REF_TYPES: ['service'],
  ArchitectConversationApiError: class extends Error {},
}));

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
  // Spec 4 (Task Group 6): the tab reads the CURRENT architecture id via this
  // hook for the vulnerability-reduction fetch; null => the reduction hook
  // degrades to a null delta (non-blocking no-op for these unrelated tests).
  useActiveArchitectureId: () => null,
}));

import { ArchitectConversationTab } from '../ArchitectConversationTab';
import {
  captureAnswer,
  fetchNextQuestion,
  loadConversation,
} from '../../../../api/architectConversationApi';

const PROJECT_ID = 'proj-qd';
const TARGET = 'arch-qd';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadConversation).mockResolvedValue({
    threadId: 'thr',
    turns: [{ kind: 'open', sessionId: 's1', openedBy: 'u1' }],
    currentSession: {
      sessionId: 's1',
      status: 'open',
      openedBy: 'u1',
      openedAt: '2026-06-01T00:00:00Z',
    },
    capturedDecisions: [],
  } as never);
  // fetchNextQuestion now returns { question, phase } (Spec 2026-06-06 open-ended
  // phase, TG1.5 wire mirror). A pending question -> phase: 'preset-walk'.
  vi.mocked(fetchNextQuestion).mockResolvedValue({
    question: {
      // NON-versioned free-text fixture (was `service.language`, now a
      // versioned code rendering the dedicated framework+version control;
      // that surface is covered by VersionedAnswerControl.test.tsx).
      decisionCode: 'service.processModel',
      group: 'A',
      orderInGroup: 4,
      promptText: 'Which process model will the target service use?',
      staticContextLeadIn: 'Service process model.',
      expectedAnswerShape: 'free-text',
      choices: null,
      defaultsWhenUnchanged: 'no change',
      optional: false,
    },
    phase: 'preset-walk',
  } as never);
});

afterEach(() => cleanup());

describe('Architect conversation question driver', () => {
  it('presents the next question + the answer input once a session is open (deadlock fix)', async () => {
    render(
      <ArchitectConversationTab
        projectId={PROJECT_ID}
        selectedTargetArchitectureId={TARGET}
        currentUserId="u1"
      />,
    );

    // The pending question prompt renders (it never did in the broken version).
    expect(
      await screen.findByTestId(
        'architect-conversation-pending-question-service.processModel',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Which process model will the target service use?'),
    ).toBeInTheDocument();

    // The answer input bar is reachable. For a free-text question the custom
    // text input is the primary control.
    expect(
      screen.getByTestId('architect-conversation-input-bar'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('architect-conversation-custom-input'),
    ).toBeInTheDocument();
  });

  it('submits the answer for the pending decision code and advances the walk', async () => {
    vi.mocked(captureAnswer).mockResolvedValue({ outcome: 'captured' } as never);

    render(
      <ArchitectConversationTab
        projectId={PROJECT_ID}
        selectedTargetArchitectureId={TARGET}
        currentUserId="u1"
      />,
    );

    const input = await screen.findByTestId(
      'architect-conversation-custom-input',
    );
    fireEvent.change(input, { target: { value: 'single-process' } });
    fireEvent.click(
      screen.getByTestId('architect-conversation-custom-submit'),
    );

    await waitFor(() => {
      expect(captureAnswer).toHaveBeenCalledWith(
        PROJECT_ID,
        TARGET,
        expect.objectContaining({
          decisionCode: 'service.processModel',
          value: 'single-process',
        }),
      );
    });

    // The walk advances: next-question is re-fetched after the answer is captured
    // (once on open, again after the submit).
    await waitFor(() => {
      expect(vi.mocked(fetchNextQuestion).mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });
});
