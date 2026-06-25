/**
 * QuestionLibraryScopesRuntimeFetch tests
 *
 * Spec: 2026-05-25 Four-Spec Hardening Pass -- Item 4 (Group 3, frontend tests).
 *
 * Three focused tests within the spec-total 4-frontend cap (this file owns
 * 3 of the 4 frontend slots; the remaining 1 is in
 * `TargetArchitectureWorkspace.elementCountBadge.test.tsx`):
 *
 *   1. Architect Conversation tab calls `fetchQuestionLibraryScopes` on mount.
 *   2. Exception sub-dialog renders with the correct scopes for a sample
 *      decision code (sourced from the runtime-fetched map, not the deleted
 *      static mirror).
 *   3. Fetch-failure path: the exception sub-dialog still OPENS but the
 *      picker is disabled and the "no exception scopes available -- try
 *      again later" message is visible; the user can cancel out cleanly.
 *
 * Mock surface mirrors the existing colocated ArchitectConversationTab test.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks (declared BEFORE imports)
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
  fetchQuestionLibraryScopes: vi.fn(),
  fetchNextQuestion: vi.fn(),
  fetchPromptReadyOutput: vi.fn(),
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

vi.mock('../../../../api/architecturesApi', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../api/architecturesApi')
  >('../../../../api/architecturesApi');
  return {
    ...actual,
    getElementsInventory: vi.fn().mockResolvedValue({ domains: [] }),
  };
});

// Imports AFTER mocks.
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
  fetchNextQuestion,
  fetchQuestionLibraryScopes,
  loadConversation,
} from '../../../../api/architectConversationApi';

const PROJECT_ID = 'proj-scopes-1';
const TARGET_ARCH_ID = 'target-arch-scopes-1';
const CURRENT_USER_ID = 'user-1';

const SAMPLE_SCOPE_MAP = {
  'service.framework': { allowedExceptionScopes: ['service'] as const },
  'db.engine': {
    allowedExceptionScopes: ['physical_data_entity', 'physical_data_attribute'] as const,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  // The input bar + "Set exception" chip now render off the gateway-driven
  // pending question (not a transcript turn). Default it to the sample code the
  // exception-dialog tests resolve scopes for.
  // fetchNextQuestion now returns { question, phase } (Spec 2026-06-06 open-ended
  // phase, TG1.5 wire mirror). A pending question -> phase: 'preset-walk'.
  vi.mocked(fetchNextQuestion).mockResolvedValue({
    question: {
      decisionCode: 'service.framework',
      group: 'A',
      orderInGroup: 1,
      promptText: 'Which framework?',
      staticContextLeadIn: null,
      expectedAnswerShape: 'free-text',
      choices: null,
      defaultsWhenUnchanged: 'no change',
    },
    phase: 'preset-walk',
  } as never);
  vi.mocked(loadConversation).mockResolvedValue({
    threadId: 'thr-1',
    turns: [],
    currentSession: null,
    capturedDecisions: [],
  } as never);
});

afterEach(() => {
  cleanup();
});

describe('ArchitectConversationTab question-library scope fetch (Four-Spec Hardening Pass, Item 4)', () => {
  it('calls fetchQuestionLibraryScopes on mount', async () => {
    vi.mocked(fetchQuestionLibraryScopes).mockResolvedValue(
      SAMPLE_SCOPE_MAP as never,
    );

    render(
      <ArchitectConversationTab
        projectId={PROJECT_ID}
        selectedTargetArchitectureId={TARGET_ARCH_ID}
        currentUserId={CURRENT_USER_ID}
      />,
    );

    await waitFor(() => {
      expect(fetchQuestionLibraryScopes).toHaveBeenCalledTimes(1);
    });
  });
});

describe('ExceptionSubDialog scope rendering (Four-Spec Hardening Pass, Item 4)', () => {
  it('renders the exception sub-dialog with the scopes resolved from the runtime-fetched map for a sample decision code', async () => {
    // Seed the tab with a conversation that has an unanswered `question`
    // turn so the input + "Set exception" button reach the screen, then
    // open the exception sub-dialog by clicking the button.
    vi.mocked(fetchQuestionLibraryScopes).mockResolvedValue(
      SAMPLE_SCOPE_MAP as never,
    );
    vi.mocked(loadConversation).mockResolvedValue({
      threadId: 'thr-2',
      turns: [
        {
          kind: 'open',
          sessionId: 'sess-1',
          openedBy: CURRENT_USER_ID,
        },
        {
          kind: 'question',
          sessionId: 'sess-1',
          decisionCode: 'service.framework',
          prompt: 'Which framework?',
        },
      ],
      currentSession: {
        sessionId: 'sess-1',
        status: 'open',
        openedBy: CURRENT_USER_ID,
        openedAt: '2026-05-25T08:00:00Z',
      },
      capturedDecisions: [],
    } as never);

    render(
      <ArchitectConversationTab
        projectId={PROJECT_ID}
        selectedTargetArchitectureId={TARGET_ARCH_ID}
        currentUserId={CURRENT_USER_ID}
      />,
    );

    // Wait for the scope-map fetch to settle before clicking.
    await waitFor(() => {
      expect(fetchQuestionLibraryScopes).toHaveBeenCalled();
    });

    // The per-element exception control now lives behind the "Advanced" toggle.
    fireEvent.click(
      await screen.findByTestId('architect-conversation-advanced-toggle'),
    );
    const exceptionBtn = await screen.findByTestId(
      'architect-conversation-chip-set-exception',
    );
    fireEvent.click(exceptionBtn);

    // The exception sub-dialog opens.
    const dialog = await screen.findByTestId(
      'architect-conversation-exception-sub-dialog',
    );
    expect(dialog).toBeInTheDocument();

    // The dialog's prose surface confirms it carries the scopes from
    // SAMPLE_SCOPE_MAP['service.framework'] -> ['service'].
    expect(dialog.textContent).toContain('service');
    // The graceful-degrade message must NOT appear on the success path.
    expect(
      screen.queryByTestId(
        'architect-conversation-exception-scopes-unavailable',
      ),
    ).toBeNull();
  });
});

describe('ExceptionSubDialog fetch-failure graceful-degrade (Four-Spec Hardening Pass, Item 4)', () => {
  it('opens the exception sub-dialog with the picker disabled and the "no exception scopes available -- try again later" message when the runtime fetch failed; cancel-out works', async () => {
    vi.mocked(fetchQuestionLibraryScopes).mockRejectedValue(
      new Error('network failure'),
    );
    vi.mocked(loadConversation).mockResolvedValue({
      threadId: 'thr-3',
      turns: [
        {
          kind: 'open',
          sessionId: 'sess-2',
          openedBy: CURRENT_USER_ID,
        },
        {
          kind: 'question',
          sessionId: 'sess-2',
          decisionCode: 'service.framework',
          prompt: 'Which framework?',
        },
      ],
      currentSession: {
        sessionId: 'sess-2',
        status: 'open',
        openedBy: CURRENT_USER_ID,
        openedAt: '2026-05-25T08:00:00Z',
      },
      capturedDecisions: [],
    } as never);

    render(
      <ArchitectConversationTab
        projectId={PROJECT_ID}
        selectedTargetArchitectureId={TARGET_ARCH_ID}
        currentUserId={CURRENT_USER_ID}
      />,
    );

    // Wait for the fetch to settle (and fail).
    await waitFor(() => {
      expect(fetchQuestionLibraryScopes).toHaveBeenCalled();
    });

    // Open the exception sub-dialog -- it must STILL open on fetch failure.
    // The control now lives behind the "Advanced" toggle.
    fireEvent.click(
      await screen.findByTestId('architect-conversation-advanced-toggle'),
    );
    const exceptionBtn = await screen.findByTestId(
      'architect-conversation-chip-set-exception',
    );
    fireEvent.click(exceptionBtn);

    const dialog = await screen.findByTestId(
      'architect-conversation-exception-sub-dialog',
    );
    expect(dialog).toBeInTheDocument();

    // The degrade message renders.
    const degradeMsg = await screen.findByTestId(
      'architect-conversation-exception-scopes-unavailable',
    );
    expect(degradeMsg.textContent).toContain(
      'no exception scopes available -- try again later',
    );

    // The Pin-exception submit button is disabled.
    const submit = screen.getByTestId(
      'architect-conversation-exception-submit',
    ) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    // The user can cancel out cleanly.
    const cancel = screen.getByTestId(
      'architect-conversation-exception-cancel',
    );
    fireEvent.click(cancel);
    await waitFor(() => {
      expect(
        screen.queryByTestId('architect-conversation-exception-sub-dialog'),
      ).toBeNull();
    });
  });
});
