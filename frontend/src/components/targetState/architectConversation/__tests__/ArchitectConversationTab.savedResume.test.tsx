/**
 * ArchitectConversationTab -- saved-conversation view-only landing + resume.
 *
 * Spec: 2026-06-26-target-conversation-save-resume-plan-sourcing (FR6),
 * Task Group 4.1 / 4.4 / 4.5.
 *
 * Covers (2 tests):
 *   1. When the selected draft is a SAVED conversation (`conversationSavedAt`
 *      non-null) and there is no active session, the tab lands VIEW-ONLY (the
 *      transcript pane renders) with an explicit "Reopen / continue" CTA and a
 *      distinct "Start new conversation" secondary action -- NOT the fresh
 *      "Start conversation" CTA.
 *   2. Clicking "Reopen / continue" resumes the walk via the existing start
 *      path (`openConversation`).
 *
 * Mock surface mirrors `ArchitectConversationTab.prefillBanner.test.tsx`.
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
  answerQuestion: vi.fn(),
  acceptCascadeBatch: vi.fn(),
  overrideCascade: vi.fn(),
  revisePriorAnswer: vi.fn(),
  pinException: vi.fn(),
  getActiveTargetArchitectureId: vi.fn(),
  fetchNextQuestion: vi.fn().mockResolvedValue({ question: null, phase: 'preset-walk' }),
  fetchQuestionLibraryScopes: vi.fn().mockResolvedValue({}),
  ALLOWED_SCOPE_REF_TYPES: ['service'],
  OPT_OUT_ANSWER_VALUE: '(not used)',
  ArchitectConversationApiError: class extends Error {},
}));

vi.mock('../../../../contexts/ArchitectureContext', () => ({
  useArchitecture: (() => {
    const m = { model: { metaModel: { entities: { services: [], app_components: [] } } } };
    return () => m;
  })(),
  useActiveArchitectureId: () => null,
}));

import { ArchitectConversationTab } from '../ArchitectConversationTab';
import {
  loadConversation,
  openConversation,
  type ConversationEnvelope,
} from '../../../../api/architectConversationApi';

const PROJECT_ID = 'proj-saved-resume-1';
const TARGET_ARCH_ID = 'target-saved-resume-1';

function buildSavedEnvelope(): ConversationEnvelope {
  return {
    threadId: 'thr-saved-1',
    // No active session on this thread -- the prior session is gone, but the
    // conversation was SAVED (marker carried by the prop below).
    currentSession: null,
    turns: [
      { kind: 'open', sessionId: 'sess-old-1', openedBy: 'user-A' },
    ],
    capturedDecisions: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => cleanup());

describe('ArchitectConversationTab -- saved-conversation view-only resume (FR6)', () => {
  it('lands view-only with "Reopen / continue" (not a fresh start) for a saved conversation', async () => {
    vi.mocked(loadConversation).mockResolvedValue(buildSavedEnvelope());

    render(
      <ArchitectConversationTab
        projectId={PROJECT_ID}
        selectedTargetArchitectureId={TARGET_ARCH_ID}
        currentUserId="user-A"
        conversationSavedAt="2026-06-25T10:00:00Z"
      />,
    );

    // View-only transcript pane is rendered.
    await screen.findByTestId('architect-conversation-transcript');

    // The resume affordance is present...
    expect(
      screen.getByTestId('architect-conversation-reopen-continue-button'),
    ).toHaveTextContent('Reopen / continue');
    expect(
      screen.getByTestId('architect-conversation-start-new-button'),
    ).toHaveTextContent('Start new conversation');

    // ...and the fresh-start CTA is NOT the landing state.
    expect(
      screen.queryByTestId('architect-conversation-start-button'),
    ).toBeNull();
  });

  it('resumes the walk via the existing start path when "Reopen / continue" is clicked', async () => {
    vi.mocked(loadConversation).mockResolvedValue(buildSavedEnvelope());
    vi.mocked(openConversation).mockResolvedValue({
      sessionId: 'sess-new-1',
      openTurn: { kind: 'open', sessionId: 'sess-new-1', openedBy: 'user-A' },
      tierConfirmationTurn: null,
    } as unknown as Awaited<ReturnType<typeof openConversation>>);

    render(
      <ArchitectConversationTab
        projectId={PROJECT_ID}
        selectedTargetArchitectureId={TARGET_ARCH_ID}
        currentUserId="user-A"
        conversationSavedAt="2026-06-25T10:00:00Z"
      />,
    );

    const reopen = await screen.findByTestId(
      'architect-conversation-reopen-continue-button',
    );
    fireEvent.click(reopen);

    await waitFor(() => {
      expect(openConversation).toHaveBeenCalledWith(
        PROJECT_ID,
        TARGET_ARCH_ID,
        expect.objectContaining({ openedBy: 'user-A' }),
      );
    });
  });
});
