/**
 * Frontend tests — Architect Tier-Gating (Spec 2026-06-05-architect-tier-gating,
 * Half B, Task Group 4): the tier-confirmation turn RENDER + confirm/adjust UI.
 *
 * Two layers:
 *
 *   1. ConversationMainPane in isolation — the `tier-confirmation` turn renders
 *      the derived tiers + a toggle per technology tier (UI / Service /
 *      Persistence) seeded from `confirmedTiers`, plus a Confirm action that
 *      hands the chosen set up via `onConfirmTiers`. Toggling UI off then
 *      confirming yields `hasUiTier:false`.
 *
 *   2. ArchitectConversationTab integration — the turn surfaces at open before
 *      the first question; confirming the derived set as-is threads the derived
 *      flags into the subsequent `next-question`; toggling UI off + confirming
 *      causes the subsequent `next-question` to carry `hasUiTier:false`.
 *
 * IN-SESSION ONLY (Decision 1): no persistence is asserted — only the in-session
 * threading into `fetchNextQuestion`.
 *
 * GOTCHA (mock completeness): the `architectConversationApi` factory lists EVERY
 * export the tab imports (copied from TierGating.test.tsx). `useArchitecture` is
 * a `vi.fn()` so each test can vary the model. "tier" here is the architectural
 * TECHNOLOGY tier (UI / Service / Persistence), NOT `DiscoveryRunDto.tier`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from '@testing-library/react';

import { ConversationMainPane } from '../ConversationMainPane';
import type {
  ConversationTurn,
  TierFlags,
} from '../../../../api/architectConversationApi';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const ALL_TRUE: TierFlags = {
  hasUiTier: true,
  hasServiceTier: true,
  hasPersistenceTier: true,
};

const SERVICE_PERSISTENCE: TierFlags = {
  hasUiTier: false,
  hasServiceTier: true,
  hasPersistenceTier: true,
};

function tierConfirmationTurn(
  derived: TierFlags,
  confirmed: TierFlags = derived,
): ConversationTurn {
  return { kind: 'tier-confirmation', derivedTiers: derived, confirmedTiers: confirmed };
}

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

afterEach(() => cleanup());

// ===========================================================================
// Layer 1 — ConversationMainPane renders the tier-confirmation turn.
// ===========================================================================

describe('ConversationMainPane — tier-confirmation turn render + confirm/adjust', () => {
  it('renders the detected tiers with a toggle per tier, seeded from confirmedTiers', () => {
    render(
      <ConversationMainPane
        {...paneBaseProps}
        turns={[tierConfirmationTurn(ALL_TRUE)]}
        confirmedTiers={ALL_TRUE}
        onConfirmTiers={vi.fn()}
      />,
    );

    // The confirmation turn renders.
    expect(
      screen.getByTestId('architect-conversation-turn-tier-confirmation'),
    ).toBeInTheDocument();

    // A toggle per technology tier, each seeded ON from the all-true set.
    const uiToggle = screen.getByTestId('architect-conversation-tier-toggle-hasUiTier');
    const svcToggle = screen.getByTestId(
      'architect-conversation-tier-toggle-hasServiceTier',
    );
    const persistToggle = screen.getByTestId(
      'architect-conversation-tier-toggle-hasPersistenceTier',
    );
    expect(uiToggle).toHaveAttribute('aria-checked', 'true');
    expect(svcToggle).toHaveAttribute('aria-checked', 'true');
    expect(persistToggle).toHaveAttribute('aria-checked', 'true');

    // Confirm control present.
    expect(
      screen.getByTestId('architect-conversation-tier-confirm'),
    ).toBeInTheDocument();
  });

  it('describes the derived tiers in the prompt (Service + Persistence, UI absent)', () => {
    render(
      <ConversationMainPane
        {...paneBaseProps}
        turns={[tierConfirmationTurn(SERVICE_PERSISTENCE)]}
        confirmedTiers={SERVICE_PERSISTENCE}
        onConfirmTiers={vi.fn()}
      />,
    );

    // Prompt names the derived tiers; the UI toggle seeds OFF.
    expect(screen.getByText(/Service Tier and Persistence Tier/)).toBeInTheDocument();
    expect(
      screen.getByTestId('architect-conversation-tier-toggle-hasUiTier'),
    ).toHaveAttribute('aria-checked', 'false');
  });

  it('confirming the seeded set as-is hands that exact set to onConfirmTiers', () => {
    const onConfirmTiers = vi.fn();
    render(
      <ConversationMainPane
        {...paneBaseProps}
        turns={[tierConfirmationTurn(SERVICE_PERSISTENCE)]}
        confirmedTiers={SERVICE_PERSISTENCE}
        onConfirmTiers={onConfirmTiers}
      />,
    );

    fireEvent.click(screen.getByTestId('architect-conversation-tier-confirm'));
    expect(onConfirmTiers).toHaveBeenCalledWith(SERVICE_PERSISTENCE);
  });

  it('toggling UI off then confirming hands hasUiTier:false up (the others unchanged)', () => {
    const onConfirmTiers = vi.fn();
    render(
      <ConversationMainPane
        {...paneBaseProps}
        turns={[tierConfirmationTurn(ALL_TRUE)]}
        confirmedTiers={ALL_TRUE}
        onConfirmTiers={onConfirmTiers}
      />,
    );

    fireEvent.click(
      screen.getByTestId('architect-conversation-tier-toggle-hasUiTier'),
    );
    fireEvent.click(screen.getByTestId('architect-conversation-tier-confirm'));

    expect(onConfirmTiers).toHaveBeenCalledWith({
      hasUiTier: false,
      hasServiceTier: true,
      hasPersistenceTier: true,
    });
  });

  // Spec 2026-06-06 fix: clicking Confirm must visibly resolve — the button is
  // replaced by a "Confirmed" marker and the toggles lock (previously the button
  // stayed put and looked inert).
  it('clicking Confirm replaces the button with a "Confirmed" marker and locks the toggles', () => {
    const onConfirmTiers = vi.fn();
    render(
      <ConversationMainPane
        {...paneBaseProps}
        turns={[tierConfirmationTurn(ALL_TRUE)]}
        confirmedTiers={ALL_TRUE}
        onConfirmTiers={onConfirmTiers}
      />,
    );

    // Before: the Confirm button is present; no Confirmed marker yet.
    expect(
      screen.getByTestId('architect-conversation-tier-confirm'),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('architect-conversation-tier-confirmed'),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('architect-conversation-tier-confirm'));

    // After: the chosen set was handed up; the button is gone, replaced by the
    // "Confirmed" marker; the toggles are now disabled (locked).
    expect(onConfirmTiers).toHaveBeenCalledWith(ALL_TRUE);
    expect(
      screen.queryByTestId('architect-conversation-tier-confirm'),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId('architect-conversation-tier-confirmed'),
    ).toHaveTextContent('Confirmed');
    expect(
      screen.getByTestId('architect-conversation-tier-toggle-hasUiTier'),
    ).toBeDisabled();
  });
});

// ===========================================================================
// Layer 2 — ArchitectConversationTab threads the confirmed set into
// next-question (in-session only).
// ===========================================================================

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

const mockUseArchitecture = vi.fn();
vi.mock('../../../../contexts/ArchitectureContext', () => ({
  useArchitecture: () => mockUseArchitecture(),
}));

import { ArchitectConversationTab } from '../ArchitectConversationTab';
import {
  fetchNextQuestion,
  loadConversation,
} from '../../../../api/architectConversationApi';

const PROJECT_ID = 'proj-tier-confirm';
const TARGET = 'arch-tier-confirm';

function modelOf(
  services: Array<{ id: string; app_component_id?: string }>,
  appComponents: Array<{ id: string; tech_type?: string }>,
) {
  return {
    model: { metaModel: { entities: { services, app_components: appComponents } } },
  };
}

/** An OPEN session whose transcript carries the tier-confirmation turn. */
function openEnvelopeWithTierTurn(derived: TierFlags) {
  return {
    threadId: 'thr',
    turns: [
      { kind: 'open', sessionId: 's1', openedBy: 'u1' },
      { kind: 'tier-confirmation', derivedTiers: derived, confirmedTiers: derived },
    ],
    currentSession: {
      sessionId: 's1',
      status: 'open',
      openedBy: 'u1',
      openedAt: '2026-06-05T00:00:00Z',
    },
    capturedDecisions: [],
  };
}

describe('ArchitectConversationTab — tier-confirmation turn surfaces + threads the chosen set', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // fetchNextQuestion now returns { question, phase } (Spec 2026-06-06 TG1).
    vi.mocked(fetchNextQuestion).mockResolvedValue({
      question: null,
      phase: 'open-available',
    });
  });

  it('surfaces the tier-confirmation turn at open before any question is answered', async () => {
    mockUseArchitecture.mockReturnValue(
      modelOf(
        [{ id: 'svc-api', app_component_id: 'ac-api' }],
        [{ id: 'ac-api', tech_type: 'Service Tier' }],
      ),
    );
    vi.mocked(loadConversation).mockResolvedValue(
      openEnvelopeWithTierTurn({
        hasUiTier: false,
        hasServiceTier: true,
        hasPersistenceTier: false,
      }) as never,
    );

    render(
      <ArchitectConversationTab
        projectId={PROJECT_ID}
        selectedTargetArchitectureId={TARGET}
        currentUserId="u1"
      />,
    );

    expect(
      await screen.findByTestId('architect-conversation-turn-tier-confirmation'),
    ).toBeInTheDocument();
  });

  it('confirming the derived set as-is threads the derived flags into next-question', async () => {
    mockUseArchitecture.mockReturnValue(
      modelOf(
        [
          { id: 'svc-api', app_component_id: 'ac-api' },
          { id: 'svc-db', app_component_id: 'ac-db' },
        ],
        [
          { id: 'ac-api', tech_type: 'Service Tier' },
          { id: 'ac-db', tech_type: 'Persistence Tier' },
        ],
      ),
    );
    vi.mocked(loadConversation).mockResolvedValue(
      openEnvelopeWithTierTurn(SERVICE_PERSISTENCE) as never,
    );

    render(
      <ArchitectConversationTab
        projectId={PROJECT_ID}
        selectedTargetArchitectureId={TARGET}
        currentUserId="u1"
      />,
    );

    fireEvent.click(
      await screen.findByTestId('architect-conversation-tier-confirm'),
    );

    // Every next-question (the on-open fetch + the post-confirm re-fetch) carries
    // the derived Service+Persistence flags.
    await waitFor(() => {
      expect(fetchNextQuestion).toHaveBeenCalledWith(
        PROJECT_ID,
        TARGET,
        SERVICE_PERSISTENCE,
      );
    });
    for (const call of vi.mocked(fetchNextQuestion).mock.calls) {
      expect(call[2]).toEqual(SERVICE_PERSISTENCE);
    }
  });

  it('toggling UI off then confirming makes the subsequent next-question carry hasUiTier:false', async () => {
    // Derived set is all-true (empty/ambiguous model fails open), so UI starts ON.
    mockUseArchitecture.mockReturnValue(modelOf([], []));
    vi.mocked(loadConversation).mockResolvedValue(
      openEnvelopeWithTierTurn(ALL_TRUE) as never,
    );

    render(
      <ArchitectConversationTab
        projectId={PROJECT_ID}
        selectedTargetArchitectureId={TARGET}
        currentUserId="u1"
      />,
    );

    // On-open fetch carries the all-true default.
    await waitFor(() => {
      expect(fetchNextQuestion).toHaveBeenCalledWith(PROJECT_ID, TARGET, ALL_TRUE);
    });

    // Toggle UI off, then confirm.
    fireEvent.click(
      await screen.findByTestId('architect-conversation-tier-toggle-hasUiTier'),
    );
    fireEvent.click(screen.getByTestId('architect-conversation-tier-confirm'));

    // The post-confirm next-question carries the user-adjusted set (UI skipped).
    await waitFor(() => {
      expect(fetchNextQuestion).toHaveBeenLastCalledWith(PROJECT_ID, TARGET, {
        hasUiTier: false,
        hasServiceTier: true,
        hasPersistenceTier: true,
      });
    });
  });
});
