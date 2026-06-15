/**
 * Tests for Surface 3 -- Start-conversation flow.
 *
 * Spec: 2026-05-24 Target State Architect-Persona Conversation -- Commit 5 (5.3)
 *
 * Covers (4 tests):
 *   1. Active target with no prior session shows "Start conversation" button.
 *   2. Clicking the button writes an `open` turn (with `sessionId` +
 *      `openedBy`) via the conversation API.
 *   3. Active target with a prior closed session shows read-only prior
 *      transcript + "Start new conversation" button.
 *   4. Starting a new conversation appends a new logical session inside the
 *      same thread file (new `open` POST against same thread id).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

vi.mock('../../../../api/architecturesApi', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../api/architecturesApi')
  >('../../../../api/architecturesApi');
  return {
    ...actual,
    getElementsInventory: vi.fn().mockResolvedValue({ domains: [] }),
  };
});

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
}));

import { ArchitectConversationTab } from '../ArchitectConversationTab';
import {
  loadConversation,
  openConversation,
} from '../../../../api/architectConversationApi';

const PROJECT_ID = 'proj-start-conv-1';
const TARGET_ARCH_ID = 'target-start-conv-1';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('ArchitectConversationTab -- Start Conversation (Spec 3, Commit 5, Surface 3)', () => {
  it('shows the "Start conversation" CTA when an active target has no prior session', async () => {
    vi.mocked(loadConversation).mockResolvedValue({
      threadId: 'thr-1',
      turns: [],
      currentSession: null,
      capturedDecisions: [],
    });

    render(
      <ArchitectConversationTab
        projectId={PROJECT_ID}
        selectedTargetArchitectureId={TARGET_ARCH_ID}
        currentUserId="user-A"
      />,
    );

    expect(
      await screen.findByTestId('architect-conversation-start-button'),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('architect-conversation-start-new-button'),
    ).toBeNull();
  });

  it('writes an open turn via the conversation API on click', async () => {
    vi.mocked(loadConversation).mockResolvedValue({
      threadId: 'thr-2',
      turns: [],
      currentSession: null,
      capturedDecisions: [],
    });
    vi.mocked(openConversation).mockResolvedValue({
      sessionId: 'sess-new-1',
      openTurn: {
        kind: 'open',
        sessionId: 'sess-new-1',
        openedBy: 'user-A',
      },
    });

    render(
      <ArchitectConversationTab
        projectId={PROJECT_ID}
        selectedTargetArchitectureId={TARGET_ARCH_ID}
        currentUserId="user-A"
      />,
    );

    fireEvent.click(
      await screen.findByTestId('architect-conversation-start-button'),
    );

    await waitFor(() => {
      expect(openConversation).toHaveBeenCalledWith(
        PROJECT_ID,
        TARGET_ARCH_ID,
        {
          openedBy: 'user-A',
          // Spec 2026-06-05-architect-tier-gating (Half B): the open body now
          // carries the derived technology-tier set. The mocked model has no
          // components, so the derivation fails open to all-true (ask all).
          relevanceContext: {
            hasUiTier: true,
            hasServiceTier: true,
            hasPersistenceTier: true,
          },
        },
      );
    });

    // The new open turn appears in the transcript.
    await waitFor(() => {
      expect(
        screen.getByTestId('architect-conversation-turn-open'),
      ).toBeInTheDocument();
    });
  });

  it('shows a "Start new conversation" button when a prior session is closed', async () => {
    vi.mocked(loadConversation).mockResolvedValue({
      threadId: 'thr-3',
      turns: [
        {
          kind: 'open',
          sessionId: 'sess-old-1',
          openedBy: 'user-A',
        },
        {
          kind: 'close',
          sessionId: 'sess-old-1',
          closeReason: 'completed-by-user',
          summaryMarkdown: '# Prior session summary\n- service.language = Java 21',
        },
      ],
      currentSession: {
        sessionId: 'sess-old-1',
        status: 'closed',
        openedBy: 'user-A',
        openedAt: '2026-05-24T08:00:00Z',
      },
      capturedDecisions: [],
    });

    render(
      <ArchitectConversationTab
        projectId={PROJECT_ID}
        selectedTargetArchitectureId={TARGET_ARCH_ID}
        currentUserId="user-A"
      />,
    );

    expect(
      await screen.findByTestId('architect-conversation-start-new-button'),
    ).toBeInTheDocument();
    // The prior transcript is rendered read-only above the CTA.
    expect(
      screen.getByTestId('architect-conversation-turn-open'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('architect-conversation-turn-close'),
    ).toBeInTheDocument();
  });

  it('starting a new conversation appends a new logical session via openConversation', async () => {
    vi.mocked(loadConversation).mockResolvedValue({
      threadId: 'thr-4',
      turns: [
        {
          kind: 'open',
          sessionId: 'sess-old-2',
          openedBy: 'user-B',
        },
        {
          kind: 'close',
          sessionId: 'sess-old-2',
          closeReason: 'completed-by-user',
          summaryMarkdown: '# Old summary',
        },
      ],
      currentSession: {
        sessionId: 'sess-old-2',
        status: 'closed',
        openedBy: 'user-B',
        openedAt: '2026-05-24T08:00:00Z',
      },
      capturedDecisions: [],
    });
    vi.mocked(openConversation).mockResolvedValue({
      sessionId: 'sess-new-3',
      openTurn: {
        kind: 'open',
        sessionId: 'sess-new-3',
        openedBy: 'user-A',
      },
    });

    render(
      <ArchitectConversationTab
        projectId={PROJECT_ID}
        selectedTargetArchitectureId={TARGET_ARCH_ID}
        currentUserId="user-A"
      />,
    );

    fireEvent.click(
      await screen.findByTestId('architect-conversation-start-new-button'),
    );

    await waitFor(() => {
      expect(openConversation).toHaveBeenCalledWith(
        PROJECT_ID,
        TARGET_ARCH_ID,
        {
          openedBy: 'user-A',
          // Spec 2026-06-05-architect-tier-gating (Half B): the open body now
          // carries the derived technology-tier set. The mocked model has no
          // components, so the derivation fails open to all-true (ask all).
          relevanceContext: {
            hasUiTier: true,
            hasServiceTier: true,
            hasPersistenceTier: true,
          },
        },
      );
    });
  });

  it('renders the tier-confirmation turn on a fresh open (it must not be dropped from the optimistic append)', async () => {
    vi.mocked(loadConversation).mockResolvedValue({
      threadId: 'thr-5',
      turns: [
        { kind: 'open', sessionId: 'sess-old-3', openedBy: 'user-B' },
        {
          kind: 'close',
          sessionId: 'sess-old-3',
          closeReason: 'completed-by-user',
          summaryMarkdown: '# Old',
        },
      ],
      currentSession: {
        sessionId: 'sess-old-3',
        status: 'closed',
        openedBy: 'user-B',
        openedAt: '2026-05-24T08:00:00Z',
      },
      capturedDecisions: [],
    });
    // The gateway returns the tier-confirmation turn alongside the open turn.
    vi.mocked(openConversation).mockResolvedValue({
      sessionId: 'sess-new-4',
      openTurn: { kind: 'open', sessionId: 'sess-new-4', openedBy: 'user-A' },
      tierConfirmationTurn: {
        kind: 'tier-confirmation',
        derivedTiers: { hasUiTier: true, hasServiceTier: true, hasPersistenceTier: true },
        confirmedTiers: { hasUiTier: true, hasServiceTier: true, hasPersistenceTier: true },
      },
    });

    render(
      <ArchitectConversationTab
        projectId={PROJECT_ID}
        selectedTargetArchitectureId={TARGET_ARCH_ID}
        currentUserId="user-A"
      />,
    );

    fireEvent.click(
      await screen.findByTestId('architect-conversation-start-new-button'),
    );

    // The tier-confirmation turn must appear in the transcript (the "which
    // technology tiers are in play?" step that precedes the first preset question).
    expect(
      await screen.findByTestId('architect-conversation-turn-tier-confirmation'),
    ).toBeInTheDocument();
  });
});
